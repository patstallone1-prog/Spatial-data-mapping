"""Read untagged park paths' surfaces from the ground in front of cameras that walked them.

    set -a; source .env.local; set +a
    python scripts/classify_path_imagery.py [--region sf-sunset]

Only paths still unknown after official RPD materials and explicit OpenStreetMap tags are
read. A photograph counts when its camera is on the path (within 3 m of the line) and, for a
flat camera, facing along it. Mapillary's own segmentation of the ground just ahead says
paved (road/sidewalk), natural (terrain) or sand. Consecutive photographs that agree make a
run; where runs disagree the path is split between them. Automated, so capped below a
reviewed reading (smc.parks.surfaces).

Output: data/park_paths/<region>/imagery.json, read by tools/build_park_evidence.py.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path

import numpy as np

from smc.imagery.segmentation_cache import SegmentationCache, decode, images_in_box
from smc.parks.paths import official_paths

ROOT = Path(__file__).resolve().parents[1]
REGIONS = ("sf-corridor", "sf-haight-castro", "sf-mission", "sf-sunset", "oakland-downtown",
           "berkeley-downtown", "san-jose-downtown", "palo-alto-downtown")
GROUND = {3: "paved", 4: "paved", 5: "ground", 6: "sand"}
ON_PATH_M = 3.0
RUN_REACH_M = 12.0


def folder(region: str) -> Path:
    return ROOT / "docs" if region == "sf-corridor" else ROOT / "docs/regions" / region


def ground_reading(record: dict) -> tuple[str | None, float]:
    labels = decode(record)
    rows, cols = labels.shape
    if record["camera"] == "spherical":
        # Ahead and behind, 30-55 degrees below the horizon: the path 1.5-3.5 m away.
        r0, r1 = int(0.66 * rows), int(0.80 * rows)
        window = np.hstack([labels[r0:r1, int(0.44 * cols):int(0.56 * cols)],
                            labels[r0:r1, :int(0.06 * cols)], labels[r0:r1, int(0.94 * cols):]])
    else:
        window = labels[int(0.78 * rows):int(0.97 * rows), int(0.38 * cols):int(0.62 * cols)]
    counts = Counter(GROUND.get(int(v)) for v in window.ravel())
    counts.pop(None, None)
    total = sum(counts.values())
    if total < 0.3 * window.size:
        return None, 0.0
    material, n = counts.most_common(1)[0]
    share = n / total
    return (material, share) if share >= 0.55 else (None, share)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", action="append")
    args = parser.parse_args()
    # Its own file: the span build appends to the shared one and may be running alongside.
    cache = SegmentationCache(ROOT / "data/electrical/imagery-cache/segmentation-paths.jsonl")
    inventory = json.loads(gzip.decompress((ROOT / "data/sf_rpd/inventory.json.gz").read_bytes()))
    official = official_paths(inventory)
    sweep = None
    for region in args.region or REGIONS:
        world = json.loads((folder(region) / "sf-corridor-3d.json").read_text())
        source_file = ROOT / "data/park_paths" / region / "surfaces.json"
        source = json.loads(source_file.read_text()) if source_file.exists() else {"ways": {}}
        box = world["bbox"]
        lat0, lon0 = box["south"], box["west"]
        kx, ky = 111_320 * math.cos(math.radians(lat0)), 110_540

        def xy(p, lon0=lon0, lat0=lat0, kx=kx, ky=ky):
            return ((p[0] - lon0) * kx, (p[1] - lat0) * ky)

        targets = []
        for way in world["ways"]:
            if way.get("kind") != "path" or len(way.get("points", [])) < 2:
                continue
            identity = str(way["osm_id"])
            tags = source["ways"].get(identity, {}).get("tags", {})
            if tags.get("surface") or way.get("surface") or tags.get("footway") == "sidewalk":
                continue
            lons = [p[0] for p in way["points"]]
            lats = [p[1] for p in way["points"]]
            if any(min(q[0] for q in o["ring"]) <= max(lons) and max(q[0] for q in o["ring"]) >= min(lons)
                   and min(q[1] for q in o["ring"]) <= max(lats) and max(q[1] for q in o["ring"]) >= min(lats)
                   for o in official):
                continue  # RPD's own record will decide it
            targets.append((identity, [xy(p) for p in way["points"]], way["points"]))
        # Where photographs were taken near those paths.
        index = []
        if region == "sf-corridor":
            import pyarrow.parquet as pq

            if sweep is None:
                sweep = pq.read_table(
                    ROOT / "data/sf_corridor_mapillary_dense/observations/external-000.parquet",
                    columns=["provider", "provider_image_id", "provider_sequence_id", "latitude",
                             "longitude", "heading_deg", "projection_type", "eligible"]).to_pylist()
            index = [{"id": r["provider_image_id"], "lon": r["longitude"], "lat": r["latitude"],
                      "heading": r["heading_deg"], "sequence": r["provider_sequence_id"],
                      "camera": "spherical" if r["projection_type"] == "spherical" else "perspective"}
                     for r in sweep if r["provider"] == "mapillary" and r["eligible"]]
        else:
            step, cells = 0.0015, set()
            for _, _, points in targets:
                for p in points:
                    cells.add((math.floor(p[0] / step), math.floor(p[1] / step)))
            cache_file = ROOT / "data/electrical/imagery-cache" / f"{region}-paths-index.json"
            if cache_file.exists():
                index = json.loads(cache_file.read_text())
            else:
                boxes = [(i * step, j * step, (i + 1) * step, (j + 1) * step) for i, j in sorted(cells)]
                with ThreadPoolExecutor(8) as pool:
                    for n, found in enumerate(pool.map(lambda box: images_in_box(*box), boxes), 1):
                        index.extend(found)
                        if n % 50 == 0:
                            print(f"  {region}: image index {n}/{len(boxes)} cells", flush=True)
                index = list({r["id"]: r for r in index}.values())
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(json.dumps(index))
        grid: dict[tuple, list] = {}
        for image in index:
            image["xy"] = xy((image["lon"], image["lat"]))
            grid.setdefault((int(image["xy"][0] // 20), int(image["xy"][1] // 20)), []).append(image)
        picks: dict[str, list] = {}
        for identity, line, _ in targets:
            chain = [0.0]
            for a, b in pairwise(line):
                chain.append(chain[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
            seen = set()
            for k, (a, b) in enumerate(pairwise(line)):
                for gx in range(int(min(a[0], b[0]) // 20) - 1, int(max(a[0], b[0]) // 20) + 2):
                    for gy in range(int(min(a[1], b[1]) // 20) - 1, int(max(a[1], b[1]) // 20) + 2):
                        for image in grid.get((gx, gy), []):
                            if image["id"] in seen:
                                continue
                            dx, dy = b[0] - a[0], b[1] - a[1]
                            span = math.hypot(dx, dy) or 1e-9
                            t = max(0, min(1, ((image["xy"][0] - a[0]) * dx + (image["xy"][1] - a[1]) * dy) / span ** 2))
                            d = math.hypot(image["xy"][0] - a[0] - t * dx, image["xy"][1] - a[1] - t * dy)
                            if d > ON_PATH_M:
                                continue
                            if image["camera"] != "spherical" and image.get("heading") is not None:
                                along = math.degrees(math.atan2(dx, dy))
                                off = abs((image["heading"] - along + 540) % 360 - 180)
                                if min(off, 180 - off) > 35:
                                    continue
                            seen.add(image["id"])
                            picks.setdefault(identity, []).append((chain[k] + t * span, image))
        wanted = [image["id"] for rows in picks.values() for _, image in rows]
        print(f"{region}: {len(targets)} untagged paths, {len(picks)} with photographs on them, "
              f"{len(wanted)} photographs", flush=True)
        cache.ensure(wanted, progress=lambda n, t, region=region: print(f"  {region}: {n}/{t}", flush=True))
        out, readings = {}, Counter()
        for identity, rows in picks.items():
            stations = []
            for station, image in sorted(rows, key=lambda r: r[0]):
                record = cache.get(image["id"])
                if not record:
                    continue
                material, share = ground_reading(record)
                readings[material or "unclear"] += 1
                if material:
                    stations.append((station, material, image["id"], record.get("sequence"), share))
            runs = []
            for station in stations:
                if runs and runs[-1]["material"] == station[1]:
                    runs[-1]["stations"].append(station)
                else:
                    runs.append({"material": station[1], "stations": [station]})
            length = max(r[0] for r in rows) + RUN_REACH_M
            evidence = []
            for i, run in enumerate(runs):
                first, last = run["stations"][0][0], run["stations"][-1][0]
                lo = max(0.0, first - RUN_REACH_M)
                hi = last + RUN_REACH_M
                if i > 0:
                    lo = max(lo, (runs[i - 1]["stations"][-1][0] + first) / 2)
                if i + 1 < len(runs):
                    hi = min(hi, (last + runs[i + 1]["stations"][0][0]) / 2)
                sequences = sorted({s[3] for s in run["stations"] if s[3]})
                evidence.append({"lo": round(lo, 2), "hi": round(min(hi, length), 2),
                                 "material": run["material"],
                                 "basis": "imagery_auto_multiview" if len(sequences) > 1 else "imagery_auto_single",
                                 "sequences": sequences, "images": [s[2] for s in run["stations"]],
                                 "mean_share": round(float(np.mean([s[4] for s in run["stations"]])), 2)})
            if evidence:
                out[identity] = evidence
        target = ROOT / "data/park_paths" / region / "imagery.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"schema": "kerbside.path_imagery/1",
                                      "built_at": datetime.now(UTC).isoformat(),
                                      "classifier": "mapillary_segmentation_ground_ahead",
                                      "readings": dict(readings), "ways": out},
                                     separators=(",", ":")) + "\n")
        print(f"{region}: {len(out)} paths read from photographs; readings {dict(readings)}", flush=True)


if __name__ == "__main__":
    main()
