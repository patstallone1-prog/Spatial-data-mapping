#!/usr/bin/env python3
"""Index every geometrically usable street-front view; write review crops, never thin sources.

Example: --data-root /path/to/existing/catalogue --regions sf-corridor --landmarks
         --sample 24 --watch-seconds 3600
Outputs are private build artifacts, NOT automatically published textures or geometry.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import fcntl
import hashlib
import html
import inspect
import itertools
import json
import math
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from smc.facades.scheduling import fair_batch  # noqa: E402
from smc.facades.selection_cache import compatible_selection  # noqa: E402
from smc.imagery.frontage_sources import (  # noqa: E402
    RESTRICTED_DATASETS,
    SUPPORTED_PROVIDERS,
    provider_for,
    read_source_pixels,
    source_block_reason,
)
from smc.imagery.http import HttpClient  # noqa: E402
from smc.imagery.schema import Observation  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.reconstruction.pixel_store import CanonicalPixels, LocalBlobStore  # noqa: E402
from smc.storage.working_set import WorkingSet  # noqa: E402

WORKSPACE = None

METHOD = "frontage-v3"
LANDMARK_API = "https://sfplanninggis.org/arcgiswa/rest/services/PlanningData/MapServer/11/query"
CELL = 40.0


#: Photographs fetched, rectified and screened at once. The work is mostly waiting on the network:
#: one at a time, the machine sat idle while 720 photographs an hour trickled through.
SCREEN_WORKERS = 8
#: A photograph that will not download is tried this many times, this far apart, then left.
MAX_DOWNLOAD_ATTEMPTS = 3
DOWNLOAD_RETRY_AFTER_S = 3600


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


def resolved_pixel_density(predicted_ppm: float, metadata_width: int, decoded_width: int) -> float:
    """Thumbnail resolution cannot inherit the full camera's sampling density."""
    if not all(math.isfinite(v) and v > 0 for v in (predicted_ppm, metadata_width, decoded_width)):
        raise ValueError("positive source resolution required")
    return predicted_ppm * min(1.0, decoded_width / metadata_width)


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
    from smc.facades.grounding import TerrainReference, street_readable_wall

    terrain_path = page.parent / "sf-corridor-terrain.json"
    terrain_binary = terrain_path.with_suffix(".bin")
    terrain = (
        TerrainReference(terrain_path)
        if terrain_path.exists() and terrain_binary.exists()
        else None
    )
    stamp = {
        "method": METHOD,
        "implementation_sha256": args.code_hash,
        "selection_sha256": getattr(args, "selection_hash", args.code_hash),
        "policy": dataclasses.asdict(policy),
        "date": now.date().isoformat(),
        "world_sha256": file_hash(page),
        "terrain_sha256": file_hash(terrain_path) if terrain else None,
        "terrain_pixels_sha256": file_hash(terrain_binary) if terrain else None,
        "catalogs": [file_hash(p) for p in catalogs],
        "poses_sha256": args.pose_hash,
        "building_limit": args.limit,
        "landmarks_sha256": file_hash(args.output / "sources/sf-landmarks.geojson")
        if landmarks
        else None,
    }
    run_id = hashlib.sha256(json.dumps(stamp, sort_keys=True).encode()).hexdigest()[:20]
    folder = args.output / region / run_id
    reusable = compatible_selection((args.output / region).resolve(), stamp, args.code_hash)
    if not reusable and WORKSPACE and WORKSPACE.ready():
        reusable = compatible_selection(WORKSPACE.archive / region, stamp, args.code_hash)
        if reusable:
            reusable["folder"] = str(WORKSPACE.stage_database(Path(reusable["folder"])))
    if reusable:
        print(f"{region}: verified compatible selection resumed ({reusable['run']})", flush=True)
        return reusable
    folder.mkdir(parents=True, exist_ok=True)
    emit(folder / "run.json", stamp)
    database = folder / "selection.sqlite"
    if WORKSPACE and not database.exists():
        WORKSPACE.stage_database(WORKSPACE.archive / region / run_id)
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
            if source_block_reason(row["provider"]):
                date_counts["restricted_source"] += 1
                continue
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
            wall = street_readable_wall(wall)
            mx, my = wall.midpoint
            indices = {
                n for cell in cells([(mx, my)], policy.max_distance_m) for n in grid.get(cell, ())
            }
            for n in sorted(indices):
                row, camera, posed = observations[n]
                dx, dy = camera.x - mx, camera.y - my
                dist = math.hypot(dx, dy)
                if dist > policy.max_distance_m or dx * wall.normal[0] + dy * wall.normal[1] < max(
                    policy.min_distance_m, dist * math.cos(math.radians(policy.entrance_angle_deg))
                ):
                    rejected["distance_or_oblique_prefilter"] += 1
                    continue
                camera, ground_reference = (
                    terrain.ground_camera(camera, wall, frame)
                    if terrain
                    else (camera, {"status": "unknown"})
                )
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
                        "ground_reference": ground_reference,
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
            if WORKSPACE:
                WORKSPACE.checkpoint_database(database)
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
    if WORKSPACE:
        WORKSPACE.checkpoint_database(database)
    return summary


def review_samples(args, summaries, policy):
    """Fetch bounded best-first private evidence; store exact pixels once, retain aliases."""
    providers = {}
    store = LocalBlobStore(args.output / "pixel-store")
    reviews = json.loads(args.reviews.read_text()) if args.reviews else {}
    screen = None
    if args.pixel_screen:
        from smc.facades.frontage_pixels import FrontagePixelScreen

        screen = getattr(args, "screen_instance", None)
        if screen is None:
            screen = FrontagePixelScreen(
                args.model_cache or args.output / "model-cache",
                device=getattr(args, "device", "cpu"),
            )
            args.screen_instance = screen
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
    # A contributor's machine screens exactly the photographs it claimed (--work-file).
    for work in getattr(args, "work_rows", None) or []:
        row = {**work["row"], "candidates": [work["candidate"]]}
        rows.append((row, work["candidate"], work["region"], work["run_id"]))
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
    # A photograph that would not download is tried again an hour later, three times in all, and
    # then left: the same seventy failing frames were being retried in every batch, a third of it.
    now = datetime.now(UTC)

    def retry_due(r):
        if r.get("status") != "download_or_decode_failed":
            return False
        if r.get("download_attempts", 1) >= MAX_DOWNLOAD_ATTEMPTS:
            return False
        try:
            last = datetime.fromisoformat(str(r["last_attempt_at"]))
        except (KeyError, ValueError):
            return True
        return (now - last).total_seconds() >= DOWNLOAD_RETRY_AFTER_S

    seen_views = {
        (
            r["region"],
            r["building_id"],
            r.get("candidate", {}).get("observation", {}).get("observation_uid"),
        )
        for r in records
        if not retry_due(r)
    }
    # Photographs handed to contributors' machines (scripts/contributor_coordinator.py) are theirs
    # until their results come back or the hand-out lapses: not screened twice.
    assigned_path = args.output / "contrib-assigned.json"
    try:
        assigned = {tuple(k) for k in json.loads(assigned_path.read_text())["keys"]}
    except (OSError, ValueError, KeyError, TypeError):
        assigned = set()
    pending = []
    for row, candidate, region, run_id in rows:
        queued_providers = set()
        for candidate in row["candidates"]:
            key = (region, str(row["building_id"]), candidate["observation"]["observation_uid"])
            if key in assigned and not getattr(args, "work_rows", None):
                continue
            if (
                region,
                row["building_id"],
                candidate["observation"]["observation_uid"],
            ) not in seen_views and candidate["observation"]["provider"] not in queued_providers:
                pending.append((row, candidate, region, run_id))
                queued_providers.add(candidate["observation"]["provider"])
    batch = fair_batch(pending, records, args.sample)
    batch_groups = Counter()
    emit(args.output / "pixel-worker.json", {
        "status": "screening", "pid": os.getpid(), "at": datetime.now(UTC),
        "configured_batch_size": args.sample, "selected": len(batch),
        "pending_city_provider_queues": {
            f"{region}/{provider}": count for (region, provider), count in
            Counter((p[2], p[1]["observation"]["provider"]) for p in pending).items()
        },
        "supported_providers": SUPPORTED_PROVIDERS,
        "automatically_publishes": False,
    })
    def screen_one(row, candidate, region, run_id):
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
                return previous, False
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
            provider_name = obs["provider"]
            provider_key = (provider_name, obs["provider_instance"])
            with provider_lock:
                if provider_key not in providers:
                    providers[provider_key] = provider_for(*provider_key)
            observation = Observation(
                **{f.name: obs[f.name] for f in dataclasses.fields(Observation) if f.name in obs}
            )
            # JSON timestamps need restoring before provider use.
            from smc.facades.frontage import capture_date

            observation.captured_at = capture_date(obs["captured_at"])
            raw = read_source_pixels(providers[provider_key], observation)
            with tempfile.NamedTemporaryFile(dir=samples, suffix=".image") as fh:
                fh.write(raw)
                fh.flush()
                os.fsync(fh.fileno())
                pixels = CanonicalPixels.from_image(Path(fh.name))
            digest = pixels.sha256
            pixel_key = store.put_if_absent(digest, zlib.compress(pixels.payload(), 6))
            if WORKSPACE:
                WORKSPACE.copy_file(store.root / pixel_key)
            alias = {
                "observation_uid": uid,
                "pixel_sha256": digest,
                "raw_sha256": hashlib.sha256(raw).hexdigest(),
                "observation": obs,
                "rights_status": "conditional_attribution_share_alike"
                if "-SA-" in obs["license_id"] else "conditional_attribution",
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
            source_ppm = resolved_pixel_density(
                candidate["pixels_per_m"], camera.width, pixels.width
            )
            camera = dataclasses.replace(
                camera,
                width=pixels.width,
                height=pixels.height,
                focal_px=camera.focal_px * pixels.width / camera.width if camera.focal_px else None,
            )
            from smc.facades.geometry import Wall

            wall = Wall(**candidate["wall"])
            if source_ppm < policy.min_pixels_per_m:
                report.update(
                    status="pixel_rejected",
                    pixel_sha256=digest,
                    pixel_screen={
                        "pass": False,
                        "reasons": ["resolved_source_too_coarse"],
                        "resolved_pixels_per_m": source_ppm,
                    },
                )
                emit(report_path, report)
                return report, True
            ppm = min(35, source_ppm, 1400 / max(wall.length_m, wall.height_m))
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
                    "ground_reference": candidate.get("ground_reference"),
                    "crop": str((WORKSPACE.archive / report_path.relative_to(args.output)).with_suffix(".jpg")
                                if WORKSPACE else report_path.with_suffix(".jpg")),
                    "pixel_frame_coverage": view.coverage,
                    "resolved_pixels_per_m": source_ppm,
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
                # One model on the GPU: the photographs take turns here, and only here.
                with screen_lock:
                    measured = screen.screen(view.image, view.mask)
                labels = measured.pop("labels")
                cv2.imwrite(str(report_path.with_suffix(".labels.png")), labels.astype(np.uint8))
                from smc.facades.frontage_pixels import view_gate

                extra = view_gate(
                    measured.get("details", {}), candidate, report["rectilinearity_heuristic"]
                )
                measured["reasons"] = [*measured["reasons"], *extra]
                measured["pass"] = not measured["reasons"]
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
            attempts = 1
            if report_path.exists():
                with contextlib.suppress(OSError, ValueError, AttributeError):
                    earlier = json.loads(report_path.read_text())
                    if earlier.get("status") == "download_or_decode_failed":
                        attempts = earlier.get("download_attempts", 1) + 1
            report.update({"status": "download_or_decode_failed", "error_type": type(exc).__name__,
                           "download_attempts": attempts, "last_attempt_at": datetime.now(UTC)})
        emit(report_path, report)
        return report, True

    def progress(report, region, obs, row):
        batch_groups[f"{region}/{obs['provider']}"] += 1
        emit(args.output / "pixel-progress.json", {
            "at": datetime.now(UTC), "pid": os.getpid(), "status": "screening",
            "processed_in_batch": sum(batch_groups.values()), "selected": len(batch),
            "city_provider_processed": dict(batch_groups), "last": report["review_key"],
            "automatically_publishes": False,
        })
        print(f"review {region}/{row['building_id']}: {report['status']}", flush=True)

    provider_lock, screen_lock = threading.Lock(), threading.Lock()
    with ThreadPoolExecutor(max_workers=SCREEN_WORKERS) as pool:
        futures = {}
        for row, candidate, region, run_id in batch:
            if shutil.disk_usage(args.output).free < 4 * 1024**3:
                emit(
                    args.output / "pixel-worker.json",
                    {
                        "status": "paused_disk_reserve",
                        "reserve_bytes": 4 * 1024**3,
                        "remaining_candidates": len(pending),
                        "pid": os.getpid(),
                    },
                )
                break  # Capacity is not a failed source, empty measurement, or rejection.
            futures[pool.submit(screen_one, row, candidate, region, run_id)] = (row, candidate, region)
        for future in as_completed(futures):
            row, candidate, region = futures[future]
            report, fresh = future.result()
            records.append(report)
            if fresh:
                progress(report, region, candidate["observation"], row)
    from smc.facades.frontage_retention import prune_rejected

    # In durable mode even rejected scratch pixels stay until the complete
    # batch's archival acknowledgement. The checkpoint owns local cleanup.
    cleanup = (prune_rejected(args.output) if WORKSPACE is None else
               {"files_removed": 0, "basis": "deferred_to_verified_external_batch_ack"})
    emit(args.output / "retention.json", cleanup)
    for r in records:
        if r["status"] == "pixel_rejected" and WORKSPACE is None:
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


def selection_fingerprint():
    return hashlib.sha256((
        "".join(inspect.getsource(function) for function in (
            cells, crosses, blocked_sightline, matching_landmark, paths_for, camera_for, scan_region,
            source_block_reason,
        )) + "".join(file_hash(ROOT / path) for path in (
            "src/smc/facades/frontage.py", "src/smc/facades/grounding.py",
        )) + json.dumps(RESTRICTED_DATASETS, sort_keys=True)
    ).encode()).hexdigest()


def main():
    global WORKSPACE
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
    parser.add_argument(
        "--entrance-angle",
        type=float,
        default=40,
        help="views up to this angle are kept only when their pixels show the entrance",
    )
    parser.add_argument("--watch-seconds", type=int, default=0)
    parser.add_argument("--device", choices=["cpu", "mps", "cuda", "auto"], default="cpu")
    parser.add_argument(
        "--strict-houses",
        action="store_true",
        help="require full predicted frontage and <=35 degrees at facade edges; minimum two visible storeys remains an image-review gate",
    )
    parser.add_argument(
        "--model-cache",
        type=Path,
        help="reuse a local/cloud-mounted model cache without duplicate downloads",
    )
    parser.add_argument(
        "--work-file",
        type=Path,
        help="screen exactly these claimed photographs (a contributor's machine) and stop",
    )
    parser.add_argument("--local-working-set", type=Path,
                        help="Internal active batch/state; external output receives verified checkpoints only")
    parser.add_argument("--storage-volume", type=Path)
    parser.add_argument("--volume-uuid")
    args = parser.parse_args()
    if args.sample < 0 or (args.limit is not None and args.limit <= 0) or args.watch_seconds < 0:
        parser.error("invalid bounds")
    use_certifi()
    if args.env_file:
        load_env_file(args.env_file)
    if args.local_working_set:
        if not args.storage_volume or not args.volume_uuid:
            parser.error("local working set requires explicit external volume and UUID")
        WORKSPACE = WorkingSet(args.local_working_set, args.output.resolve(), args.storage_volume, args.volume_uuid)
        WORKSPACE.seed_metadata()
        args.output = WORKSPACE.local
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
    policy = FrontagePolicy(
        max_angle_deg=args.max_angle,
        entrance_angle_deg=max(args.max_angle, args.entrance_angle),
        max_edge_angle_deg=35 if args.strict_houses else 55,
        min_frame_coverage=1 if args.strict_houses else 0.90,
    )
    implementation = [
        Path(__file__),
        ROOT / "src/smc/facades/frontage.py",
        ROOT / "src/smc/facades/frontage_pixels.py",
        ROOT / "src/smc/facades/frontage_retention.py",
        ROOT / "src/smc/facades/grounding.py",
        ROOT / "src/smc/facades/scheduling.py",
        ROOT / "src/smc/imagery/frontage_sources.py",
        ROOT / "src/smc/facades/selection_cache.py",
        ROOT / "src/smc/imagery/pandaset.py",
        ROOT / "src/smc/imagery/archive.py",
    ]
    args.code_hash = hashlib.sha256(
        "".join(file_hash(p) for p in implementation).encode()
    ).hexdigest()
    args.selection_hash = selection_fingerprint()
    if args.work_file:
        # A contributor's batch: no catalogues scanned, no watching; the claimed rows, screened.
        args.work_rows = json.loads(args.work_file.read_text())
        args.sample = args.sample or len(args.work_rows)
        counts = review_samples(args, [], policy)
        emit(args.output / "status.json", {"status": "work_file_complete", "pid": os.getpid(),
                                           "at": datetime.now(UTC), "review": dict(counts)})
        return
    while True:
        if WORKSPACE and not WORKSPACE.can_begin():
            emit(args.output / "storage-status.json", {"state":"pending_external_checkpoint",
                 "current_batch_retained_locally":True,"new_batches_started":False})
            if not args.watch_seconds:
                return
            time.sleep(args.watch_seconds)
            continue
        if WORKSPACE:
            if not WORKSPACE.checkpoint("resume-pending", clean_pixels=True):
                if not args.watch_seconds:
                    return
                time.sleep(args.watch_seconds)
                continue
            WORKSPACE.seed_metadata()
            assigned = WORKSPACE.archive / "contrib-assigned.json"
            if assigned.exists():
                WORKSPACE._copy(assigned, args.output / assigned.name, WORKSPACE.ready)
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
        summaries = []
        for region in args.regions:
            summaries.append(scan_region(args, region, poses, landmarks, now, policy))
            if WORKSPACE and not WORKSPACE.ready():
                break  # Finish local selection, not another region after eject.
        if WORKSPACE and not WORKSPACE.ready():
            continue
        counts = review_samples(args, summaries, policy) if args.sample else {}
        if WORKSPACE:
            checkpoint = WORKSPACE.checkpoint(now.isoformat(), clean_pixels=True)
            if checkpoint:
                WORKSPACE.prune_stale_databases({Path(s["folder"]) for s in summaries if s.get("folder")})
            emit(args.output / "storage-status.json", {"state":"checkpointed" if checkpoint else "pending_external_checkpoint",
                 "current_batch_retained_locally":not checkpoint,"new_batches_started":False})
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
