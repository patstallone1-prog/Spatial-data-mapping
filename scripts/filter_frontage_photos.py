#!/usr/bin/env python3
"""Index every geometrically usable street-front view; write review crops, never thin sources.

Example: --data-root /path/to/existing/catalogue --regions sf-corridor --landmarks
         --sample 24 --watch-seconds 3600
Outputs are private build artifacts, NOT automatically published textures or geometry.
"""

from __future__ import annotations

import argparse
import dataclasses
import fcntl
import hashlib
import html
import itertools
import json
import math
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import zlib
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.config import load_env_file  # noqa: E402
from smc.facades.frontage import (  # noqa: E402
    FrontagePolicy,
    apply_review,
    assess_view,
    date_gate,
    frontage_envelopes,
)
from smc.facades.geometry import Camera, LocalFrame  # noqa: E402
from smc.facades.poses import _pose  # noqa: E402
from smc.facades.rectify import rectify_wall  # noqa: E402
from smc.imagery.http import HttpClient  # noqa: E402
from smc.imagery.schema import Observation  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.reconstruction.pixel_store import CanonicalPixels, LocalBlobStore  # noqa: E402

METHOD = "frontage-v3"
LANDMARK_API = "https://sfplanninggis.org/arcgiswa/rest/services/PlanningData/MapServer/11/query"
CELL = 40.0


def emit(path: Path, value):
    """Atomic status/checkpoint; an interruption must not masquerade as completion."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w") as fh:
        json.dump(value, fh, default=str, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(temporary, path)


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for part in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def cells(points, margin=0):
    x, y = zip(*points, strict=True)
    for i in range(math.floor((min(x) - margin) / CELL), math.floor((max(x) + margin) / CELL) + 1):
        for j in range(
            math.floor((min(y) - margin) / CELL), math.floor((max(y) + margin) / CELL) + 1
        ):
            yield i, j


def crosses(a, b, c, d):
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    return orient(a, b, c) * orient(a, b, d) < -1e-7 and orient(c, d, a) * orient(c, d, b) < -1e-7


def blocked_sightline(camera, wall, building_index, rings, building_grid):
    """Reject a view when another building intersects ANY of three facade rays."""
    eye = (camera.x, camera.y)
    for target in (wall.a, wall.midpoint, wall.b):
        for idx in {i for cell in cells([eye, target]) for i in building_grid.get(cell, ())}:
            if idx == building_index:
                continue
            ring = rings[idx]
            if cv2.pointPolygonTest(np.asarray(ring, np.float32), eye, False) >= 0:
                return True
            if any(crosses(eye, target, ring[k - 1], ring[k]) for k in range(len(ring))):
                return True
    return False


def landmark_records(output: Path, refresh=False):
    path = output / "sources" / "sf-landmarks.geojson"
    if refresh or not path.exists():
        data = HttpClient(max_attempts=3).get_json(
            LANDMARK_API,
            params={
                "f": "geojson",
                "where": "1=1",
                "outFields": "name,landmarkno,address,largephoto,thumbail,status,desdoc",
                "outSR": 4326,
            },
        )
        if not data.get("features") or data.get("exceededTransferLimit") or data.get("error"):
            raise ValueError("landmark inventory incomplete; cannot grant recency exemptions")
        emit(path, data)
        emit(
            output / "sources" / "sf-landmarks-rights.json",
            {
                "source": LANDMARK_API,
                "fetched_at": datetime.now(UTC),
                "photo_links": [
                    {
                        **f["properties"],
                        "pixel_reuse_rights": "unknown",
                        "status_for_filter": "rights_review_required",
                    }
                    for f in data["features"]
                    if f["properties"].get("largephoto")
                ],
                "note": "Designation is geometry/provenance, not a license for linked photographs.",
            },
        )
    return json.loads(path.read_text())["features"]


def matching_landmark(building, records):
    # Only adopted individual landmarks. Broad districts/centroid-nearby matching would
    # exempt unrelated houses. Require the building centre AND all facade corners inside.
    points = [building["centroid"], *building["points"][:-1]]
    for feature in records:
        prop, geom = feature["properties"], feature["geometry"]
        if prop.get("status") != "Adopted" or not prop.get("landmarkno"):
            continue
        polygons = (
            [geom["coordinates"]]
            if geom["type"] == "Polygon"
            else (geom["coordinates"] if geom["type"] == "MultiPolygon" else [])
        )
        for rings in polygons:
            exterior = np.asarray(rings[0], np.float32)
            # Translate before float32: raw lon/lat loses centimetres/metres of precision.
            origin = np.asarray(rings[0][0], np.float64)
            exterior = (np.asarray(rings[0], np.float64) - origin).astype(np.float32)
            holes = [(np.asarray(r, np.float64) - origin).astype(np.float32) for r in rings[1:]]
            if all(
                cv2.pointPolygonTest(exterior, tuple(np.asarray(p) - origin), False) >= 0
                and not any(
                    cv2.pointPolygonTest(h, tuple(np.asarray(p) - origin), False) >= 0
                    for h in holes
                )
                for p in points
            ):
                return {
                    "landmark_id": prop["landmarkno"],
                    "name": prop["name"],
                    "source": LANDMARK_API,
                    "historical_not_current_truth": True,
                }
    return None


def paths_for(data_root, region):
    catalog = data_root / (
        "data/sf_corridor" if region == "sf-corridor" else f"data/regions/{region}/catalog"
    )
    page = (
        ROOT / "docs/sf-corridor-3d.json"
        if region == "sf-corridor"
        else ROOT / f"docs/app-regions/{region}/sf-corridor-3d.json"
    )
    if not page.exists():
        page = ROOT / f"docs/regions/{region}/sf-corridor-3d.json"
    return page, sorted((catalog / "observations").glob("*.parquet"))


def camera_for(row, frame, pose):
    width, height = row.get("original_width"), row.get("original_height")
    heading = row.get("heading_deg")
    if not width or not height or heading is None or row.get("projection_type") == "unknown":
        return None, False
    x, y = frame.to_xy(row["longitude"], row["latitude"])
    spherical = row.get("projection_type") == "spherical"
    hfov = row.get("horizontal_fov")
    hfov = math.radians(hfov) if hfov and 20 < hfov < 160 else math.radians(70)
    camera = Camera(
        x,
        y,
        row.get("estimated_camera_height") or 2.4,
        math.radians(heading),
        width,
        height,
        spherical,
        None if spherical else hfov,
    )
    posed = False
    if pose is not None:
        camera = dataclasses.replace(
            camera,
            rotation=pose.rotation,
            spherical=pose.spherical,
            width=pose.width or width,
            height=pose.height or height,
            focal_px=pose.focal_px(pose.width or width, pose.height or height),
            k1=pose.k1,
            k2=pose.k2,
        )
        posed = camera.spherical or camera.focal_px is not None
    elif row.get("pitch_deg") is not None and row.get("roll_deg") is not None:
        # Do not silently assume level. Convert reported yaw/pitch/roll into the same
        # OpenSfM world-to-camera convention used by project()/rectify_wall().
        yaw, pitch, roll = (
            camera.yaw_rad,
            math.radians(row["pitch_deg"]),
            math.radians(row["roll_deg"]),
        )
        forward = np.array(
            [math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)]
        )
        right = np.array([math.cos(yaw), -math.sin(yaw), 0])
        down = np.cross(forward, right)
        r, d = (
            math.cos(roll) * right + math.sin(roll) * down,
            -math.sin(roll) * right + math.cos(roll) * down,
        )
        camera = dataclasses.replace(camera, rotation=tuple(np.vstack([r, d, forward]).ravel()))
        # Metadata angles aren't an independently solved pose; retain review-only status.
    return camera, posed


def scan_region(args, region, poses, landmarks, now, policy):
    page, catalogs = paths_for(args.data_root, region)
    if not page.exists() or not catalogs:
        return {"status": "missing_input", "region": region}
    stamp = {
        "method": METHOD,
        "implementation_sha256": args.code_hash,
        "policy": dataclasses.asdict(policy),
        "date": now.date().isoformat(),
        "world_sha256": file_hash(page),
        "catalogs": [file_hash(p) for p in catalogs],
        "poses_sha256": args.pose_hash,
        "building_limit": args.limit,
        "landmarks_sha256": file_hash(args.output / "sources/sf-landmarks.geojson")
        if landmarks
        else None,
    }
    run_id = hashlib.sha256(json.dumps(stamp, sort_keys=True).encode()).hexdigest()[:20]
    folder = args.output / region / run_id
    folder.mkdir(parents=True, exist_ok=True)
    emit(folder / "run.json", stamp)
    database = folder / "selection.sqlite"
    if (folder / "summary.json").exists() and database.exists():
        previous = json.loads((folder / "summary.json").read_text())
        if previous.get("status") == "indexed":
            print(f"{region}: unchanged completed selection resumed ({run_id})", flush=True)
            return previous
    conn = sqlite3.connect(database)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS buildings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
    )
    done = {r[0] for r in conn.execute("SELECT id FROM buildings")}
    payload = json.loads(page.read_text())
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["north"] + bbox["south"]) / 2, (bbox["east"] + bbox["west"]) / 2)
    buildings = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("osm_id")]
    # Occlusion always considers the entire city even in a bounded validation run.
    rings = [[frame.to_xy(*p) for p in b["points"]] for b in buildings]
    building_grid, road_grid = defaultdict(list), defaultdict(list)
    for i, ring in enumerate(rings):
        for cell in cells(ring):
            building_grid[cell].append(i)
    for way in payload["ways"]:
        if way.get("kind") != "street" or way.get("tags", {}).get("access") in {"private", "no"}:
            continue
        line = [frame.to_xy(*p) for p in way.get("points", [])]
        for a, b in itertools.pairwise(line):
            for cell in cells([a, b], 40):
                road_grid[cell].append((a, b, way.get("name") or "unnamed public street"))
    observations = []
    grid = defaultdict(list)
    source_counts, date_counts = Counter(), Counter()
    seen = set()
    for catalog in catalogs:
        for row in (
            r
            for batch in pq.ParquetFile(catalog).iter_batches(batch_size=4096)
            for r in batch.to_pylist()
        ):
            uid = row["observation_uid"]
            if uid in seen:
                continue
            seen.add(uid)
            source_counts[row["provider"]] += 1
            # Recent records first; old records still needed for matched landmark exceptions.
            issue = date_gate(row.get("captured_at"), now, policy)
            if issue and not (landmarks and issue == "older_than_ten_years"):
                date_counts[issue] += 1
                continue
            pose = (
                poses.get(str(row["provider_image_id"])) if row["provider"] == "mapillary" else None
            )
            camera, posed = camera_for(row, frame, pose)
            if camera is None:
                date_counts["camera_metadata_unknown"] += 1
                continue
            grid[(math.floor(camera.x / CELL), math.floor(camera.y / CELL))].append(
                len(observations)
            )
            observations.append((row, camera, posed))
    print(
        f"{region}: {sum(source_counts.values()):,} source frames; "
        f"{len(observations):,} candidate cameras; {len(done)} resumed buildings",
        flush=True,
    )
    for i, building in enumerate(buildings):
        if args.limit and i >= args.limit:
            break
        key = str(building["osm_id"])
        if key in done:
            continue
        while shutil.disk_usage(args.output).free < 4 * 1024**3:
            print("Disk reserve reached; checkpoint retained, waiting for space", flush=True)
            emit(
                args.output / "status.json",
                {
                    "status": "paused_disk_reserve",
                    "region": region,
                    "pid": os.getpid(),
                    "run": run_id,
                    "at": datetime.now(UTC),
                },
            )
            if not args.watch_seconds:
                raise RuntimeError("disk reserve reached; rerun to resume")
            time.sleep(60)
        candidates, rejected = [], Counter()
        landmark = matching_landmark(building, landmarks) if region.startswith("sf-") else None
        nearby_roads = {
            segment for cell in cells(rings[i], 40) for segment in road_grid.get(cell, ())
        }
        frontages = frontage_envelopes(
            rings[i], float(building.get("height_m") or 10.5), i, sorted(nearby_roads)
        )
        if not frontages:
            rejected["no_complete_street_frontage"] += 1
        for wall, road in frontages:
            mx, my = wall.midpoint
            indices = {
                n for cell in cells([(mx, my)], policy.max_distance_m) for n in grid.get(cell, ())
            }
            for n in sorted(indices):
                row, camera, posed = observations[n]
                dx, dy = camera.x - mx, camera.y - my
                dist = math.hypot(dx, dy)
                if dist > policy.max_distance_m or dx * wall.normal[0] + dy * wall.normal[1] < max(
                    policy.min_distance_m, dist * math.cos(math.radians(policy.max_angle_deg))
                ):
                    rejected["distance_or_oblique_prefilter"] += 1
                    continue
                result = assess_view(
                    wall, camera, row, now=now, policy=policy, landmark=landmark, posed=posed
                )
                if result["geometry_pass"] and blocked_sightline(
                    camera, wall, i, rings, building_grid
                ):
                    result["geometry_pass"] = False
                    result["reasons"].append("building_blocks_sightline")
                if not result["geometry_pass"]:
                    rejected.update(result["reasons"])
                    continue
                # Retain EVERY passing distinct view, never a top-N/spatial-thinning limit.
                candidates.append(
                    {
                        **result,
                        "observation": row,
                        "street": road[1],
                        "wall": dataclasses.asdict(wall),
                        "camera": dataclasses.asdict(camera),
                    }
                )
        candidates.sort(key=lambda r: r["rank"], reverse=True)
        record = {
            "building_id": key,
            "address": building.get("address"),
            "name": building.get("name"),
            "archetype": building.get("archetype"),
            "candidates": candidates,
            "rejections": dict(rejected),
            "landmark": landmark,
        }
        conn.execute("INSERT INTO buildings VALUES (?,?)", (key, json.dumps(record, default=str)))
        conn.commit()
        if i % 100 == 0:
            print(
                f"{region}: {i + 1}/{len(buildings)} buildings, "
                f"latest={len(candidates)} passing views",
                flush=True,
            )
            emit(
                args.output / "status.json",
                {
                    "status": "scanning",
                    "region": region,
                    "run": run_id,
                    "processed": i + 1,
                    "total": len(buildings),
                    "at": datetime.now(UTC),
                },
            )
    total_candidates, covered, known_pose, full, reasons = 0, 0, 0, 0, Counter()
    for (text,) in conn.execute("SELECT payload FROM buildings"):
        row = json.loads(text)
        covered += bool(row["candidates"])
        total_candidates += len(row["candidates"])
        full += sum(c["full_front_in_frame"] for c in row["candidates"])
        known_pose += sum(c["pose_status"] == "provider_solved" for c in row["candidates"])
        reasons.update(row["rejections"])
    summary = {
        "region": region,
        "status": "indexed",
        "run": run_id,
        "folder": str(folder),
        "buildings": min(args.limit or len(buildings), len(buildings)),
        "buildings_with_candidates": covered,
        "candidate_pairs": total_candidates,
        "full_front_pairs": full,
        "posed_pairs": known_pose,
        "source_frames": dict(source_counts),
        "source_rejections": dict(date_counts),
        "pair_rejections": dict(reasons),
        "verified_pairs": 0,
        "note": "Geometry-selected candidates, not occlusion/privacy-certified or measured meshes.",
    }
    emit(folder / "summary.json", summary)
    conn.close()
    return summary


def review_samples(args, summaries, policy):
    """Fetch bounded best-first private evidence; store exact pixels once, retain aliases."""
    providers = {}
    store = LocalBlobStore(args.output / "pixel-store")
    reviews = json.loads(args.reviews.read_text()) if args.reviews else {}
    screen = None
    if args.pixel_screen:
        from smc.facades.frontage_pixels import FrontagePixelScreen

        screen = FrontagePixelScreen(args.model_cache or args.output / "model-cache")
        emit(args.output / "sources/pixel-screen-model.json", screen.manifest)
    rows = []
    for summary in summaries:
        if summary.get("status") != "indexed":
            continue
        with sqlite3.connect(Path(summary["folder"]) / "selection.sqlite") as conn:
            for (text,) in conn.execute("SELECT payload FROM buildings"):
                row = json.loads(text)
                if row["candidates"]:
                    rows.append((row, row["candidates"][0], summary["region"], summary["run"]))
    rows.sort(key=lambda r: (r[1]["pose_status"] == "provider_solved", *r[1]["rank"]), reverse=True)
    samples = args.output / "review"
    samples.mkdir(parents=True, exist_ok=True)
    # Keep the entire review journal; each hourly cycle advances to new evidence,
    # rather than redownloading the same rejected top 24 photographs forever.
    records = []
    for path in sorted(samples.glob("*.json")):
        previous = json.loads(path.read_text())
        if isinstance(previous, dict) and previous.get("building_id"):
            previous.setdefault("review_key", path.stem)
            records.append(previous)
    seen_views = {
        (
            r["region"],
            r["building_id"],
            r.get("candidate", {}).get("observation", {}).get("observation_uid"),
        )
        for r in records
        if r.get("status") != "download_or_decode_failed"
    }
    pending = []
    for row, candidate, region, run_id in rows:
        for candidate in row["candidates"]:
            if (
                region,
                row["building_id"],
                candidate["observation"]["observation_uid"],
            ) not in seen_views:
                pending.append((row, candidate, region, run_id))
                break
    for row, candidate, region, run_id in pending[: args.sample]:
        obs = candidate["observation"]
        uid = obs["observation_uid"]
        report_path = samples / f"{region}-{row['building_id']}-{uid[:16]}.json"
        if report_path.exists() and not args.reviews:
            previous = json.loads(report_path.read_text())
            if (
                previous.get("selection_run") == run_id
                and previous.get("candidate", {}).get("observation", {}).get("observation_uid")
                == uid
                and previous.get("status") != "download_or_decode_failed"
                and (not args.pixel_screen or previous.get("pixel_screen"))
            ):
                records.append(previous)
                continue
        report = {
            "region": region,
            "selection_run": run_id,
            "building_id": row["building_id"],
            "address": row["address"],
            "candidate": candidate,
            "status": "not_downloaded",
            "review_key": report_path.stem,
        }
        try:
            if shutil.disk_usage(args.output).free < 4 * 1024**3:
                raise RuntimeError("disk reserve reached; no more pixels downloaded")
            provider_name = obs["provider"]
            if provider_name not in providers:
                if provider_name == "mapillary":
                    from smc.imagery.mapillary import MapillaryProvider

                    providers[provider_name] = MapillaryProvider()
                elif provider_name == "kartaview":
                    from smc.imagery.kartaview import KartaViewProvider

                    providers[provider_name] = KartaViewProvider()
                elif provider_name == "panoramax":
                    from smc.imagery.panoramax import PanoramaxProvider

                    providers[provider_name] = PanoramaxProvider(endpoint=obs["provider_instance"])
                else:
                    raise ValueError("no verified pixel adapter for this provider")
            observation = Observation(
                **{f.name: obs[f.name] for f in dataclasses.fields(Observation) if f.name in obs}
            )
            # JSON timestamps need restoring before provider use.
            from smc.facades.frontage import capture_date

            observation.captured_at = capture_date(obs["captured_at"])
            asset = providers[provider_name].resolve_image(observation)
            raw = HttpClient(max_attempts=2).fetch(asset.url)
            with tempfile.NamedTemporaryFile(dir=samples, suffix=".image") as fh:
                fh.write(raw)
                fh.flush()
                pixels = CanonicalPixels.from_image(Path(fh.name))
            digest = pixels.sha256
            store.put_if_absent(digest, zlib.compress(pixels.payload(), 6))
            alias = {
                "observation_uid": uid,
                "pixel_sha256": digest,
                "raw_sha256": hashlib.sha256(raw).hexdigest(),
                "observation": obs,
                "rights_status": "conditional_attribution_share_alike",
                "publication": "private_review_only",
            }
            # Multiple aliases survive even when exact pixels match. No similar-view dedupe.
            alias_id = hashlib.sha256(
                json.dumps(alias, default=str, sort_keys=True).encode()
            ).hexdigest()
            emit(args.output / "aliases" / f"{uid}-{alias_id[:16]}.json", alias)
            image = np.frombuffer(pixels.samples, np.uint8).reshape(
                pixels.height, pixels.width, pixels.channels
            )
            if pixels.bits_per_channel != 8 or pixels.channels != 3:
                raise ValueError(
                    "review renderer supports RGB8 only; canonical blob retained losslessly"
                )
            camera = Camera(**candidate["camera"])
            camera = dataclasses.replace(
                camera,
                width=pixels.width,
                height=pixels.height,
                focal_px=camera.focal_px * pixels.width / camera.width if camera.focal_px else None,
            )
            from smc.facades.geometry import Wall

            wall = Wall(**candidate["wall"])
            ppm = min(35, candidate["pixels_per_m"], 1400 / max(wall.length_m, wall.height_m))
            view = rectify_wall(image[..., ::-1], camera, wall, pixels_per_m=ppm, exact=True)
            if view is None:
                raise ValueError("no facade pixels in resolved image")
            cv2.imwrite(str(report_path.with_suffix(".jpg")), view.image)
            # Include context above/around the canonical prior: an incorrect height must
            # not hide a missing upper storey from the reviewer.
            tangent = np.asarray(wall.b) - np.asarray(wall.a)
            context_wall = dataclasses.replace(
                wall,
                a=tuple(np.asarray(wall.a) - tangent * 0.12),
                b=tuple(np.asarray(wall.b) + tangent * 0.12),
                height_m=wall.height_m * 1.35 + 5,
            )
            context_ppm = min(ppm, 1400 / max(context_wall.length_m, context_wall.height_m))
            context = rectify_wall(
                image[..., ::-1], camera, context_wall, pixels_per_m=context_ppm, exact=True
            )
            if context:
                cv2.imwrite(str(report_path.with_suffix(".context.jpg")), context.image)
            # Heuristics screen, NEVER verify. Cars/people require image-bound human/model masks.
            from smc.facades.survey import rectilinearity, vegetation_share

            report.update(
                {
                    "status": "awaiting_review",
                    "pixel_sha256": digest,
                    "crop": str(report_path.with_suffix(".jpg")),
                    "pixel_frame_coverage": view.coverage,
                    "vegetation_heuristic": vegetation_share(view.image, view.mask),
                    "rectilinearity_heuristic": rectilinearity(view.image, view.mask),
                }
            )
            report["candidate"] = apply_review(
                candidate,
                image_sha256=digest,
                review=reviews.get(f"{region}:{row['building_id']}"),
                policy=policy,
            )
            if screen:
                measured = screen.screen(view.image, view.mask)
                labels = measured.pop("labels")
                cv2.imwrite(str(report_path.with_suffix(".labels.png")), labels.astype(np.uint8))
                report["pixel_screen"] = measured
                if not measured["pass"]:
                    report["status"] = "pixel_rejected"
                elif report["candidate"]["pose_status"] == "provider_solved":
                    report["status"] = "screened_candidate_needs_privacy_and_identity_review"
                else:
                    report["status"] = "screened_candidate_needs_pose_review"
            if report["candidate"]["verified"]:
                # Human review cannot override a failed pixel screen without an explicit
                # new review/version; fail closed on model-vs-review conflict.
                if not screen or report["pixel_screen"]["pass"]:
                    report["status"] = "verified"
                else:
                    report["candidate"]["verified"] = False
        except Exception as exc:
            # Never write signed URLs/tokens from provider exception messages into logs.
            report.update({"status": "download_or_decode_failed", "error_type": type(exc).__name__})
        emit(report_path, report)
        records.append(report)
        print(f"review {region}/{row['building_id']}: {report['status']}", flush=True)
    from smc.facades.frontage_retention import prune_rejected

    cleanup = prune_rejected(args.output)
    emit(args.output / "retention.json", cleanup)
    for r in records:
        if r["status"] == "pixel_rejected":
            r["local_pixels_deleted"] = True
    emit(samples / "index.json", records)
    cards = []
    for r in records:
        address = (r.get("address") or {}).get("formatted") or r["building_id"]
        candidate = r["candidate"]
        key = r.get("review_key") or f"{r['region']}-{r['building_id']}"
        credit = candidate["observation"].get("attribution") or "Attribution unknown"
        reasons = (r.get("pixel_screen") or {}).get("reasons", [])
        photograph = (
            "<p>Rejected pixels removed; audit metadata retained.</p>"
            if r.get("local_pixels_deleted")
            else f'<a href="{key}.context.jpg"><img src="{key}.context.jpg" alt="Facade context" /></a>'
            f'<a href="{key}.jpg">Canonical-prior crop</a> · '
        )
        cards.append(
            f"<article><h2>{html.escape(address)}</h2><p>{html.escape(r['status'])}"
            f" — {html.escape(', '.join(reasons))}</p>"
            f"<p>{candidate['angle_deg']}° · {candidate['distance_m']} m · "
            f"{html.escape(str(candidate['observation']['captured_at']))}</p>"
            + photograph
            + f'<a href="{key}.json">Evidence</a>'
            f"<p>{html.escape(credit)}</p></article>"
        )
    gallery = (
        '<!doctype html><meta charset="utf-8"><title>Frontage photo screening</title>'
        "<style>body{font:16px system-ui;background:#eee;padding:24px}main{display:grid;"
        "grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}article{"
        "background:white;padding:16px}img{width:100%;max-height:500px;object-fit:contain}"
        "h2{font-size:18px}</style><h1>Private frontage screening</h1>"
        "<p>Screened candidates are NOT approved textures or measured geometry. "
        "Check full-front identity, occlusion, source rights and privacy before publication.</p>"
        "<main>" + "".join(cards) + "</main>"
    )
    (samples / "index.html").write_text(gallery, encoding="utf-8")
    return Counter(r["status"] for r in records)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=ROOT)
    parser.add_argument("--regions", nargs="+", default=["sf-corridor"])
    parser.add_argument("--output", type=Path, default=ROOT / "build/frontage-filter")
    parser.add_argument("--poses", type=Path)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--landmarks", action="store_true")
    parser.add_argument("--refresh-landmarks", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sample", type=int, default=0)
    parser.add_argument(
        "--pixel-screen",
        action="store_true",
        help="use pinned MIT UperNet weights for sky/tree/dynamic-object screening",
    )
    parser.add_argument("--reviews", type=Path)
    parser.add_argument("--max-angle", type=float, default=35)
    parser.add_argument("--watch-seconds", type=int, default=0)
    parser.add_argument(
        "--model-cache",
        type=Path,
        help="reuse a local/cloud-mounted model cache without duplicate downloads",
    )
    args = parser.parse_args()
    if args.sample < 0 or (args.limit is not None and args.limit <= 0) or args.watch_seconds < 0:
        parser.error("invalid bounds")
    use_certifi()
    if args.env_file:
        load_env_file(args.env_file)
    args.output.mkdir(parents=True, exist_ok=True)
    # The same output cannot have two writers, even if a watcher/restart overlaps.
    lock = (args.output / ".worker.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("a frontage worker already owns this output")
    emit(
        args.output / "worker.json",
        {
            "pid": os.getpid(),
            "started_at": datetime.now(UTC),
            "code_root": str(ROOT),
            "regions": args.regions,
            "watch_seconds": args.watch_seconds,
        },
    )
    policy = FrontagePolicy(max_angle_deg=args.max_angle)
    implementation = [
        Path(__file__),
        ROOT / "src/smc/facades/frontage.py",
        ROOT / "src/smc/facades/frontage_pixels.py",
        ROOT / "src/smc/facades/frontage_retention.py",
    ]
    args.code_hash = hashlib.sha256(
        "".join(file_hash(p) for p in implementation).encode()
    ).hexdigest()
    while True:
        now = datetime.now(UTC)
        poses = {}
        pose_path = (
            args.poses or args.data_root / "data/observation_enrichment/mapillary_poses.jsonl"
        )
        args.pose_hash = file_hash(pose_path) if pose_path.exists() else None
        if pose_path.exists():
            with pose_path.open() as fh:
                for line in fh:
                    try:
                        raw = json.loads(line)
                        # Fisheye is not the perspective model implemented by this rectifier.
                        if raw.get("camera_type") in (
                            "spherical",
                            "equirectangular",
                            "perspective",
                        ):
                            poses[str(raw["id"])] = _pose(raw)
                    except (ValueError, KeyError, TypeError):
                        continue
        landmarks = landmark_records(args.output, args.refresh_landmarks) if args.landmarks else []
        summaries = [scan_region(args, r, poses, landmarks, now, policy) for r in args.regions]
        counts = review_samples(args, summaries, policy) if args.sample else {}
        emit(
            args.output / "status.json",
            {
                "status": "waiting_for_new_catalogues" if args.watch_seconds else "complete",
                "pid": os.getpid(),
                "at": datetime.now(UTC),
                "regions": summaries,
                "review": dict(counts),
                "policy": dataclasses.asdict(policy),
                "watch_seconds": args.watch_seconds,
            },
        )
        if not args.watch_seconds:
            return
        # Standard worker sleep, not an interactive agent wait. Rebuild only changed runs;
        # run keys include catalog/geometry/pose/policy hashes and UTC date.
        time.sleep(args.watch_seconds)
        current_code = hashlib.sha256(
            "".join(file_hash(p) for p in implementation).encode()
        ).hexdigest()
        if current_code != args.code_hash:
            emit(
                args.output / "status.json",
                {
                    "status": "stopped_code_changed_restart_required",
                    "pid": os.getpid(),
                    "at": datetime.now(UTC),
                },
            )
            print(
                "Worker source changed; stopped at a safe checkpoint, restart required", flush=True
            )
            return


if __name__ == "__main__":
    main()
