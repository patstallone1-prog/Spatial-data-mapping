#!/usr/bin/env python3
"""Read every building's roof shape off the region's lidar, and publish the ones worth drawing.

    python scripts/measure_roof_shapes.py berkeley-downtown [palo-alto-downtown ...]

For each building in the region's payload (docs/app-regions/<name>/sf-corridor-3d.json, else
docs/regions/<name>/...), the lidar returns inside its footprint are fitted with planes and read
as flat, shed, gable, hip or unknown (smc.lidar.roofs.roof_shape), abstaining on small
footprints, sparse returns and canopy. The lidar is fetched cell by cell (CELL_M) and never
cached, so a region costs no disk.

Writes:

  data/regions/<name>/lidar/roof_shapes.json     every building's reading, with its planes'
                                                 counts (gitignored; for review)
  docs/(app-)regions/<name>/sf-corridor-roof-shapes.json
                                                 the hips only, as a roof the page draws on an
                                                 outline with no OpenStreetMap shape

Why hips only (tested 2026-11-08 against 263 Berkeley roofs labelled by eye from NOAA's 0.25 m
photographs, 135 used to tune and 128 held out; see cloud/docs/roofs-ramps-paint-tests.md):
flat was right 94-97% of the time, but the page draws flat already; hip was right 64% of the
time held out (76% over both), the rest being roofs with crossing ridges -- pitched all the
same; no flat roof was ever read as hip. A hipped roof drawn there is closer to the house
than the flat box it replaces. Gable was right 0 of 5 and is not drawn.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.lidar.ept import SF_DATASET, EptReader  # noqa: E402
from smc.lidar.roofs import OSM_SHAPE, roof_shape  # noqa: E402

CELL_M = 120.0
REACH_M = 20.0
RESOLUTION_M = 0.15
SCHEMA = "kerbside.roof_shapes/1"
#: What is published for the page to draw.
DRAWN = {"hip"}


def dataset_of(name: str) -> str:
    caps = ROOT / "data" / "regions" / name / "capabilities.json"
    if caps.exists():
        for c in json.loads(caps.read_text()).get("lidar", {}).get("collections", []):
            if c.get("coverage", 0) >= 0.9:
                return c["dataset"]
    return SF_DATASET


def payload_of(name: str) -> tuple[Path, dict]:
    for base in ("app-regions", "regions"):
        path = ROOT / "docs" / base / name / "sf-corridor-3d.json"
        if path.exists():
            return path, json.loads(path.read_text())
    raise SystemExit(f"{name}: no payload")


def min_rectangle(ring: list[list[float]]) -> list[list[float]]:
    """The smallest rectangle round a footprint, as a closed [lon, lat] ring."""
    lat0, lon0 = ring[0][1], ring[0][0]
    ky = 111_320.0
    kx = ky * math.cos(math.radians(lat0))
    pts = [((lon - lon0) * kx, (lat - lat0) * ky) for lon, lat in ring]
    best = None
    for i in range(len(pts) - 1):
        dx, dy = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        ux, uy = dx / length, dy / length
        a = [x * ux + y * uy for x, y in pts]
        b = [-x * uy + y * ux for x, y in pts]
        area = (max(a) - min(a)) * (max(b) - min(b))
        if best is None or area < best[0]:
            best = (area, ux, uy, min(a), max(a), min(b), max(b))
    _, ux, uy, a0, a1, b0, b1 = best
    corners = [(a0, b0), (a1, b0), (a1, b1), (a0, b1), (a0, b0)]
    return [[round(lon0 + (a * ux - b * uy) / kx, 7), round(lat0 + (a * uy + b * ux) / ky, 7)] for a, b in corners]


def measure(name: str) -> dict:
    path, payload = payload_of(name)
    buildings = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("points") and w.get("osm_id")]
    lat0 = sum(b["centroid"][1] for b in buildings) / len(buildings)
    lon0 = sum(b["centroid"][0] for b in buildings) / len(buildings)
    ky = 111_320.0
    kx = ky * math.cos(math.radians(lat0))
    cells: dict[tuple[int, int], list[dict]] = {}
    for b in buildings:
        key = (int(((b["centroid"][0] - lon0) * kx) // CELL_M), int(((b["centroid"][1] - lat0) * ky) // CELL_M))
        cells.setdefault(key, []).append(b)
    dataset = dataset_of(name)
    reader = EptReader(dataset, cache=False)
    out: dict[str, dict] = {}
    started = time.time()
    for n, ((cx, cy), members) in enumerate(sorted(cells.items())):
        clon = lon0 + (cx + 0.5) * CELL_M / kx
        clat = lat0 + (cy + 0.5) * CELL_M / ky
        for attempt in range(3):
            try:
                cloud = reader.around(clat, clon, CELL_M / 2 + REACH_M, resolution_m=RESOLUTION_M)
                break
            except Exception as exc:   # the network: try again, then record the gap
                if attempt == 2:
                    print(f"  cell {cx}:{cy}: {exc}", flush=True)
                    cloud = None
                time.sleep(5 * (attempt + 1))
        for b in members:
            if cloud is None or not len(cloud):
                out[str(b["osm_id"])] = {"shape": "unknown", "abstain": "no lidar"}
                continue
            r = roof_shape(cloud, b["points"])
            out[str(b["osm_id"])] = r
        if n % 20 == 0:
            print(f"  {name}: cell {n + 1}/{len(cells)}, {time.time() - started:.0f} s", flush=True)
    counts = Counter(r["shape"] + (f"/{r['abstain']}" if r.get("abstain") else "") for r in out.values())
    lidar_dir = ROOT / "data" / "regions" / name / "lidar"
    lidar_dir.mkdir(parents=True, exist_ok=True)
    (lidar_dir / "roof_shapes.json").write_text(json.dumps({
        "region": name, "dataset": dataset, "counts": dict(counts), "buildings": out}))
    by_id = {str(b["osm_id"]): b for b in buildings}
    for base in ("app-regions", "regions"):
        payload_path = ROOT / "docs" / base / name / "sf-corridor-3d.json"
        if not payload_path.exists():
            continue
        here = payload if payload_path == path else json.loads(payload_path.read_text())
        own = {str(w["osm_id"]): w for w in here["ways"] if w.get("kind") == "building" and w.get("osm_id")}
        drawn = {}
        for key, r in out.items():
            b = own.get(key)
            if r["shape"] not in DRAWN or b is None or b["points"] != by_id[key]["points"]:
                continue
            height = float(b.get("height_m") or 0)
            roof_h = min(float(r.get("roof_height_m") or 0), height * 0.5) if height else float(r.get("roof_height_m") or 0)
            if roof_h < 0.8:
                continue
            drawn[key] = {"guard": {"n": len(b["points"]), "first": b["points"][0]}, "roof": OSM_SHAPE[r["shape"]],
                          "roof_height_m": round(roof_h, 2), "pitch_deg": r.get("pitch_deg"),
                          "outer": min_rectangle(b["points"])}
        (payload_path.parent / "sf-corridor-roof-shapes.json").write_text(json.dumps({
            "schema": SCHEMA, "bbox": here["bbox"], "grade": "lidar-inferred",
            "source": f"USGS 3DEP {dataset}: planes fitted to the returns inside each footprint (smc.lidar.roofs)",
            "drawn": sorted(DRAWN), "tested": "hip right 64% held out, 76% overall; never a flat roof (cloud/docs/roofs-ramps-paint-tests.md)",
            "buildings": drawn}, separators=(",", ":")) + "\n")
        print(f"  {base}/{name}: {len(drawn)} hipped roofs published", flush=True)
    return dict(counts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("regions", nargs="+")
    args = parser.parse_args()
    for name in args.regions:
        print(name, measure(name), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
