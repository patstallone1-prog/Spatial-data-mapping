#!/usr/bin/env python3
"""Survey every photographed wall of a region: windows, storeys, entrances, photographed height.

The rerun of the photographs for the interior pass (``docs/24-scans-interiors-and-reconstruction
-readiness.md`` §A7). For each building wall with cameras in front of it, the best views (up to
eight) are rectified square-on -- *taller* than the wall's modelled height, so the roofline and
the sky above it are in frame -- aligned against each other, medianed, and measured by
:mod:`smc.facades.survey`.

Output: ``<official>/facade_survey.json`` keyed by OpenStreetMap id, each building with its
walls (openings, window rows, storey spacing, roofline or lower bound, ground-floor use, the
frames used and their licences) and a summary. Resumable: every ``--checkpoint`` buildings a part
is written under ``build/facade-survey/<region>/``; a restart picks up from the parts. Images come
through the facade extractor's cache.

    nohup .venv/bin/python scripts/build_facade_survey.py --region sf-corridor --workers 4 \\
        > build/facade-survey-sf-corridor.log 2>&1 &
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import dataclasses
import json
import math
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import build_facades as facades  # noqa: E402
import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.config import load_env_file  # noqa: E402
from smc.facades.fingerprint import view_quality  # noqa: E402
from smc.facades.geometry import Camera, LocalFrame, score_view, walls_of  # noqa: E402
from smc.facades.poses import PoseStore  # noqa: E402
from smc.facades.rectify import compose, rectify_wall  # noqa: E402
from smc.facades.relief import choose_for_relief, sweep  # noqa: E402
from smc.facades.survey import (  # noqa: E402
    MAX_VEGETATION_SHARE,
    MIN_RECTILINEARITY,
    combine_building,
    rectilinearity,
    survey_wall,
    upside_down,
    vegetation_share,
)
from smc.geometry.building import Facade, elements_from_residual  # noqa: E402
from smc.imagery.region import SF_CORRIDOR  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.regions.paths import region_paths  # noqa: E402

use_certifi()
load_env_file(ROOT / ".env.local")
POSES = ROOT / "data" / "observation_enrichment" / "mapillary_poses.jsonl"
RELIEF = ROOT / "data" / "facade_relief"  # set per region in main()

PIXELS_PER_M = 8.0
VIEWS_PER_WALL = 8
#: Two views checked against each other is the least a measurement is made from, and they
#: have to agree as well as the facade extractor requires (build_facades.MIN_AGREEMENT): a
#: composite of frames that did not see the same thing measures nothing.
MIN_VIEWS = 2
MIN_AGREEMENT = facades.MIN_AGREEMENT
#: The wall is rectified this much taller than its modelled height (and at least TALL_EXTRA_M
#: taller): the modelled height can be wrong, and the roofline is only measured if the sky above
#: it is in the frame.
TALL_FACTOR = 1.35
TALL_EXTRA_M = 5.0
#: No ceiling on how tall the frame goes -- a supertall tower is surveyed to its top. Very tall
#: walls get fewer pixels per metre instead, so no composite is more than this many rows.
MAX_ROWS = 3000
#: The survey method's version. Results are resumed only from a run of the same version: a
#: changed method must not inherit the old one's measurements. 2: walls sampled at exactly the
#: scale they are read at (version 1 clamped them to 48-640 px, mis-measuring every wall under
#: 6 m or over 80 m); relief swept in strips.
METHOD_VERSION = 2
MAX_WALL_M = 90.0
#: The relief sweep may draw on this many of a wall's candidate frames (the survey uses the
#: VIEWS_PER_WALL most square-on); it wants the widest spread of angles, not the squarest.
RELIEF_POOL = 24
NOTE = ("Facade survey (scripts/build_facade_survey.py, smc.facades.survey): per wall the "
        "openings [kind, u, v, w, h, confidence] in wall metres (u along the wall from a, v up "
        "from its foot), window rows [bottom, top, count], storey spacing and count, roofline "
        "(measured only where roof_seen; otherwise visible_h is a lower bound), inferred floor "
        "lines (window rows less an assumed 0.9 m sill), ground-floor use, glazing share, and "
        "the frames, providers and licences the composite was made from.")


def draw_survey(image, measured, path: Path, modelled_h: float,
                ppm: float = PIXELS_PER_M) -> None:
    """The composite with what was measured on it: openings boxed by kind, the roofline in red
    (or the lower bound dashed), the modelled height in blue."""
    import cv2

    path.parent.mkdir(parents=True, exist_ok=True)
    out = image.copy()
    h = out.shape[0]
    colours = {"window": (0, 220, 0), "door": (0, 160, 255), "storefront": (255, 0, 255)}
    for o in measured.openings:
        x0, x1 = int(o.u * ppm), int((o.u + o.w) * ppm)
        y1, y0 = h - int(o.v * ppm), h - int((o.v + o.h) * ppm)
        cv2.rectangle(out, (x0, y0), (x1, y1), colours[o.kind], 1)
    y = h - int(modelled_h * ppm)
    cv2.line(out, (0, y), (out.shape[1], y), (255, 120, 0), 1)  # modelled height
    if measured.roofline_m is not None:
        y = h - int(measured.roofline_m * ppm)
        cv2.line(out, (0, y), (out.shape[1], y), (0, 0, 255), 2)
    big = cv2.resize(out, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(path), big)
    # The raw composite and its mask beside it, so the measurement can be re-run offline.
    cv2.imwrite(str(path.with_suffix(".png")).replace(".png", ".raw.png"), image)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--region", default=SF_CORRIDOR.name)
    ap.add_argument("--limit", type=int, default=None, help="cap the buildings attempted")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--checkpoint", type=int, default=50)
    ap.add_argument("--redo", action="store_true")
    ap.add_argument("--allow-level-cameras", action="store_true",
                    help="also use frames with no solved orientation, assumed level and upright "
                         "(off by default: those produced slanted and upside-down walls)")
    ap.add_argument("--debug-dir", type=Path, default=None,
                    help="write each composite with its measured openings drawn on, "
                         "to check by eye")
    args = ap.parse_args()
    paths = region_paths(args.region, work=f"facade-survey/{args.region}")
    out_path = paths.official / "facade_survey.json"
    global RELIEF
    RELIEF = paths.official / "facade_relief"
    parts = paths.work / f"v{METHOD_VERSION}"
    parts.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def progress(message: str) -> None:
        print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)

    payload = json.loads(paths.page.read_text())
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0)
    buildings = [w for w in payload["ways"]
                 if w.get("kind") == "building" and w.get("osm_id") is not None]
    done: dict[str, dict] = {}
    if out_path.exists():
        previous = json.loads(out_path.read_text())
        if previous.get("method_version") == METHOD_VERSION:
            done.update(previous.get("buildings", {}))
        else:
            progress(f"{out_path.name} is from method version "
                     f"{previous.get('method_version', 1)}; surveying afresh")
    for part in sorted(parts.glob("part-*.json")):
        try:
            done.update(json.loads(part.read_text()))
        except json.JSONDecodeError:
            part.unlink()
    progress(f"{args.region}: {len(buildings)} buildings, {len(done)} surveyed already")

    rows = pq.read_table(paths.observations, columns=[
        "observation_uid", "provider", "provider_sequence_id", "provider_image_id", "latitude",
        "longitude", "heading_deg", "horizontal_fov", "projection_type", "original_width",
        "original_height", "eligible", "estimated_camera_height", "license_id", "attribution",
        "contributor_identifier"]).to_pydict()
    cameras: dict[int, Camera] = {}
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i in range(len(rows["observation_uid"])):
        if not rows["eligible"][i] or rows["heading_deg"][i] is None:
            continue
        camera = facades.camera_for(rows, i, frame)
        if camera is not None:
            cameras[i] = camera
            grid[(int(camera.x // 40), int(camera.y // 40))].append(i)
    progress(f"{len(cameras)} usable cameras")

    jobs = []
    for index, building in enumerate(buildings):
        key = str(building["osm_id"])
        if key in done and not args.redo:
            continue
        ring = [frame.to_xy(lon, lat) for lon, lat in building["points"]]
        height = float(building.get("height_m") or 10.5)
        wall_jobs = []
        for wall in walls_of(ring, height, index):
            if wall.length_m > MAX_WALL_M:
                continue
            cx, cy = wall.midpoint
            nearby = [i for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                      for i in grid.get((int(cx // 40) + dx, int(cy // 40) + dy), ())]
            scored = sorted(((s * (1.0 if cameras[i].spherical else facades.PERSPECTIVE_TRUST), i)
                             for i in nearby
                             if (s := score_view(wall, cameras[i])) is not None), reverse=True)
            if len(scored) >= MIN_VIEWS:
                wall_jobs.append((wall, scored[:RELIEF_POOL]))
        if wall_jobs:
            jobs.append((key, building, wall_jobs))
        if args.limit and len(jobs) >= args.limit:
            break
    progress(f"{len(jobs)} buildings with at least one wall in view of two cameras")

    # The solved orientation of every Mapillary frame a wall would use, fetched once and
    # journaled; a frame without one is only used with --allow-level-cameras.
    store = PoseStore(POSES)
    wanted = {str(rows["provider_image_id"][i]) for _k, _b, walls in jobs
              for _w, scored in walls for _s, i in scored if rows["provider"][i] == "mapillary"}
    store.fetch(sorted(wanted), progress=progress)
    solved = 0
    for i, camera in list(cameras.items()):
        pose = store.get(str(rows["provider_image_id"][i])) \
            if rows["provider"][i] == "mapillary" else None
        if pose is None:
            if not args.allow_level_cameras:
                cameras.pop(i)
            continue
        width, height = pose.width or camera.width, pose.height or camera.height
        cameras[i] = dataclasses.replace(camera, rotation=pose.rotation, spherical=pose.spherical,
                                         width=width, height=height,
                                         focal_px=pose.focal_px(width, height),
                                         k1=pose.k1, k2=pose.k2)
        solved += 1
    progress(f"{solved} cameras carry a solved orientation; "
             f"{len(cameras) - solved} level-assumed cameras kept")
    jobs = [(key, b, [(w, [(s, i) for s, i in scored if i in cameras]) for w, scored in walls])
            for key, b, walls in jobs]
    jobs = [(key, b, [(w, sc) for w, sc in walls if len(sc) >= MIN_VIEWS])
            for key, b, walls in jobs]
    jobs = [job for job in jobs if job[2]]
    progress(f"{len(jobs)} buildings keep a wall with two posed views")

    counters: Counter[str] = Counter()

    def survey_building(job) -> tuple[str, dict, Counter]:
        key, _building, wall_jobs = job
        seen: Counter[str] = Counter()
        walls_out = []
        for wall, scored in wall_jobs:
            tall = dataclasses.replace(wall, height_m=max(wall.height_m * TALL_FACTOR,
                                                          wall.height_m + TALL_EXTRA_M))
            ppm = min(PIXELS_PER_M, MAX_ROWS / tall.height_m)
            views, used, pairs = [], [], []
            for score, i in scored[:VIEWS_PER_WALL]:
                image = facades.fetch_image(rows["provider"][i], rows["provider_sequence_id"][i],
                                            rows["provider_image_id"][i])
                if image is None:
                    continue
                camera = cameras[i]
                ah, aw = image.shape[:2]
                if (aw, ah) != (camera.width, camera.height):
                    # A resized rendition: the same camera, its pixel measures scaled.
                    scale = aw / camera.width
                    camera = dataclasses.replace(
                        camera, width=aw, height=ah,
                        focal_px=None if camera.focal_px is None else camera.focal_px * scale)
                view = rectify_wall(image, camera, tall, weight=score, pixels_per_m=ppm,
                                    exact=True)
                if view is None or view.coverage < 0.05:
                    continue
                # The same test every photo job here applies, to the wall itself: the part
                # below its modelled top. Sky above that is what the tall frame is for; sky,
                # street or tree *in* the wall means the frame did not see it.
                cut = view.image.shape[0] - int(wall.height_m * ppm)
                below_img, below_mask = view.image[max(cut, 0):], view.mask[max(cut, 0):]
                quality = view_quality(below_img, below_mask)
                if not quality["usable"]:
                    seen["view rejected: did not see the wall"] += 1
                    continue
                if vegetation_share(below_img, below_mask.astype(bool)) > MAX_VEGETATION_SHARE:
                    seen["view rejected: the wall is behind a tree"] += 1
                    continue
                views.append(view)
                used.append(i)
                pairs.append((image, camera))
            if len(views) < MIN_VIEWS:
                seen["wall: fewer than two views saw it"] += 1
                continue
            composite = compose(views, tall)
            if composite is None or composite.views < MIN_VIEWS:
                seen["wall: the views did not compose"] += 1
                continue
            if composite.agreement < MIN_AGREEMENT:
                seen["wall: the views disagree (a pose is wrong)"] += 1
                continue
            mask = composite.mask.astype(bool)
            cut = composite.image.shape[0] - int(wall.height_m * ppm)
            square = rectilinearity(composite.image[max(cut, 0):], mask[max(cut, 0):])
            if args.debug_dir is not None:
                draw_survey(composite.image, survey_wall(composite.image, mask, ppm,
                                                         modelled_height_m=wall.height_m),
                            args.debug_dir / f"{square:.2f}_{key}-{wall.wall_index}.jpg",
                            wall.height_m, ppm)
            if upside_down(composite.image, mask):
                seen["wall: the composite is upside down"] += 1
                continue
            if square < MIN_RECTILINEARITY:
                seen["wall: not seen square-on (edges not at right angles)"] += 1
                continue
            measured = survey_wall(composite.image, composite.mask.astype(bool), ppm,
                                   modelled_height_m=wall.height_m)
            # The relief: how far each patch stands out of or back into the wall's plane.
            # Only views solved in one reconstruction are compared: across two, the poses were
            # never registered to each other and their disagreement is not the wall's relief.
            pool = [i for _s, i in scored]
            candidates = []
            for i in pool:
                pose = store.get(str(rows["provider_image_id"][i]))
                candidates.append((cameras[i], pose.merge_cc if pose else None))
            chosen = choose_for_relief(candidates, wall)
            same = []
            for k in chosen:
                i = pool[k]
                image = facades.fetch_image(rows["provider"][i], rows["provider_sequence_id"][i],
                                            rows["provider_image_id"][i])
                if image is None:
                    continue
                camera = cameras[i]
                ah, aw = image.shape[:2]
                if (aw, ah) != (camera.width, camera.height):
                    scale = aw / camera.width
                    camera = dataclasses.replace(
                        camera, width=aw, height=ah,
                        focal_px=None if camera.focal_px is None else camera.focal_px * scale)
                same.append((image, camera))
            relief, why = sweep(same, wall)
            if relief is None:
                seen[f"wall relief refused: {why}"] += 1
            relief_record: dict = {"samples": 0}
            if relief is not None and len(relief):
                RELIEF.mkdir(parents=True, exist_ok=True)
                name = f"{key}-{wall.wall_index}.npz"
                np.savez_compressed(RELIEF / name, samples=relief.astype(np.float16))
                facade = Facade(wall.wall_index, tuple(wall.a), tuple(wall.b), 0.0,
                                wall.height_m)
                found, _appearance = elements_from_residual(
                    facade, relief.astype(np.float64), grade="image",
                    evidence=tuple(str(rows["observation_uid"][i]) for i in used))
                relief_record = {"samples": len(relief), "file": name,
                                 "plane_offset_m": float(why.split("=")[-1]),
                                 "swept_to_m": float(why.split(" m;")[0].split()[-1]),
                                 "views": len(same),
                                 "elements": [e.to_json() for e in found]}
                seen["wall relief measured"] += 1
            a_lon, a_lat = frame.to_lonlat(*wall.a)
            b_lon, b_lat = frame.to_lonlat(*wall.b)
            walls_out.append({
                "i": wall.wall_index,
                "a": [round(a_lon, 7), round(a_lat, 7)], "b": [round(b_lon, 7), round(b_lat, 7)],
                "normal_deg": round(math.degrees(math.atan2(wall.normal[0], wall.normal[1])) % 360,
                                    1),
                **measured.to_json(),
                "square_on": round(square, 3),
                "pixels_per_m": round(ppm, 2),
                "relief": relief_record,
                "views": composite.views, "agreement": round(composite.agreement, 3),
                "coverage": round(composite.coverage, 3),
                "frames": [rows["observation_uid"][i] for i in used],
                "providers": sorted({rows["provider"][i] for i in used}),
                "licenses": sorted({rows["license_id"][i] for i in used if rows["license_id"][i]}),
                "attribution": sorted({rows["attribution"][i] or rows["contributor_identifier"][i]
                                       or "" for i in used} - {""}),
            })
            seen["wall surveyed"] += 1
        found = {"b": combine_building(walls_out, _building.get("height_m"),
                                       _building.get("height_source")),
                 "walls": walls_out} if walls_out else {}
        return key, found, seen

    pending: dict[str, dict] = {}
    part_number = len(list(parts.glob("part-*.json")))

    def flush() -> None:
        nonlocal part_number
        if pending:
            (parts / f"part-{part_number:05d}.json").write_text(json.dumps(pending))
            part_number += 1
            pending.clear()
        out_path.write_text(json.dumps({"keyed_by": "osm_id", "note": NOTE,
                                        "method_version": METHOD_VERSION,
                                        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                                      time.gmtime()),
                                        "buildings": done}, separators=(",", ":")))

    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n, (key, found, seen) in enumerate(pool.map(survey_building, jobs), start=1):
            counters.update(seen)
            if found:
                done[key] = found
                pending[key] = found
                counters["building surveyed"] += 1
            else:
                counters["building: no wall surveyable"] += 1
            if len(pending) >= args.checkpoint:
                flush()
            if n % 100 == 0:
                progress(f"  {n}/{len(jobs)} buildings, {dict(counters)}")
    flush()
    heights = sum(1 for v in done.values() if v.get("b", {}).get("photo_height_m"))
    progress(f"wrote {out_path}: {len(done)} buildings ({heights} with a photographed height); "
             f"{dict(counters)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
