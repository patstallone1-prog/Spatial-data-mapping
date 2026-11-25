#!/usr/bin/env python3
"""Give the buildings nobody measured a height, and roofs a shape: City3D, then 3dfier, then the atlas.

    python scripts/fill_building_heights.py sf-corridor [oakland-downtown ...]
        [--roofs]        also read roof shapes for buildings with none (slow: City3D on each)
        [--limit N]      measure at most N buildings per region (a trial)
        [--ids a,b]      only these OSM ids
        [--apply-only]   do not measure: apply what was measured before, and the atlas

Which buildings: those whose height is a guess (smc.buildings.height_fill.FILLABLE: the 10.5 m
default, a regional median, none). With --roofs, also every building with no roof shape -- none
from OpenStreetMap (sf-corridor-building-shapes.json) and none from the lidar measurer
(sf-corridor-roof-shapes.json).

How, cell by cell (CELL_M), with the region's 3DEP lidar (smc.lidar.ept, never cached):
  * City3D (tools from scripts/install_building_tools.sh) on each building alone: its returns
    within REACH_M of the footprint, in metres over the ground at its foot, and its outline ->
    an LoD2 model -> a height (its top) and a roof (its upward faces).
  * 3dfier on the whole cell: the cell's returns as LAS and the footprints as GeoJSON -> the
    roof's and the ground's percentiles per building -> an LoD1.2 height, and flat/pitched.
  * The GlobalBuildingAtlas cut (scripts/fetch_gba_heights.py) for what neither measured.

Writes:
  data/regions/<name>/lidar/height_fill.json      every reading, by source (gitignored); the
                                                  builder adopts it (build_sf_corridor_3d.py)
  the payloads (docs/(app-)regions/<name>/sf-corridor-3d.json, docs/sf-corridor-3d.json for the
  root): filled heights, by smc.buildings.height_fill.fill_heights -- the builder's own step
  sf-corridor-roof-shapes.json beside each payload: City3D's and 3dfier's pitched roofs added
  for buildings that had no shape (the lidar measurer's entries are kept as they are)
"""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.buildings.height_fill import (  # noqa: E402
    GbaIndex,
    city3d_reading,
    fill_heights,
    fillable,
    roof_entry,
    tdf_reading,
)
from smc.lidar.ept import CLASS_GROUND, EptReader  # noqa: E402

_spec = importlib.util.spec_from_file_location("measure_roof_shapes", ROOT / "scripts" / "measure_roof_shapes.py")
roofs_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(roofs_mod)

TOOLS = Path(os.environ.get("KERBSIDE_TOOLS", Path.home() / ".kerbside-tools")) / "bin"
CITY3D = TOOLS / "city3d"
TDF = TOOLS / "3dfier"
GBA = ROOT / "data" / "gba" / "w125_n40_w120_n35-regions.json.gz"
CELL_M = 120.0
REACH_M = 20.0
FOOT_M = 3.0
RESOLUTION_M = 0.15
CITY3D_TIMEOUT_S = float(os.environ.get("KERBSIDE_CITY3D_TIMEOUT", "90"))
CITY3D_MIN_POINTS = 20   # per roof plane, at THIN_M (40 at full density in City3D's example)
CITY3D_PIXEL_M = 0.15
#: City3D finds roof planes in a few points per square metre as well as in the seventy 3DEP
#: flies: one return per THIN_M cell (the highest) keeps every plane and cuts its time tenfold.
THIN_M = float(os.environ.get("KERBSIDE_CITY3D_THIN", "0.3"))
#: 3dfier's percentiles, as its CSV-BUILDINGS-MULTIPLE writes them.
TDF_CONFIG = """input_polygons:
  - datasets:
      - {polygons}
    uniqueid: fid
    lifting: Building
lifting_options:
  Building:
    roof:
      height: percentile-90
      use_LAS_classes: {roof_classes}
    ground:
      height: percentile-10
      use_LAS_classes: [2]
    lod: 1
input_elevation:
  - datasets:
      - {points}
    omit_LAS_classes: [3, 4, 5, 7, 18]
    thinning: 1
options:
  building_radius_vertex_elevation: 3.0
  radius_vertex_elevation: 1.0
  threshold_jump_edges: 0.5
"""


def roof_classes(cloud) -> list[int]:
    """Which returns can be roofs. Santa Clara's survey labels buildings (class 6) and vegetation
    apart; San Francisco's and Alameda's label only ground and "unclassified" (1), trees and roofs
    alike. Where a cell's survey has building labels, only those are roofs."""
    above = cloud.classification[cloud.classification != CLASS_GROUND]
    if above.size and float((above == 6).mean()) >= 0.15:
        return [6]
    return [1, 6]


def _enu(lon: float, lat: float, lat0: float, lon0: float) -> tuple[float, float]:
    ky = 111_320.0
    return (lon - lon0) * ky * math.cos(math.radians(lat0)), (lat - lat0) * ky


def _ring_enu(points, lat0, lon0):
    ring = [_enu(p[0], p[1], lat0, lon0) for p in points]
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    # counter-clockwise, the way both programs expect an outer ring
    area2 = sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))
    return ring if area2 > 0 else ring[::-1]


def _inside_mask(ring, e, n):
    inside = np.zeros(e.shape, dtype=bool)
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        cross = ((yi > n) != (yj > n)) & (e < (xj - xi) * (n - yi) / ((yj - yi) or 1e-12) + xi)
        inside ^= cross
        j = i
    return inside


def _thin(pts: np.ndarray, cell: float) -> np.ndarray:
    """The highest return in each cell x cell column (and every return when cell is 0)."""
    if cell <= 0 or pts.shape[0] == 0:
        return pts
    ij = np.floor(pts[:, :2] / cell).astype(np.int64)
    order = np.lexsort((-pts[:, 2], ij[:, 1], ij[:, 0]))
    ij, pts = ij[order], pts[order]
    first = np.ones(len(pts), dtype=bool)
    first[1:] = np.any(ij[1:] != ij[:-1], axis=1)
    return pts[first]


# ---- City3D -------------------------------------------------------------------------------------

def run_city3d(cloud, ring, work: Path, classes: list[int] | None = None) -> dict | None:
    """One building through City3D: its returns over the ground at its foot, and its outline."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    x0, x1, y0, y1 = min(xs) - FOOT_M, max(xs) + FOOT_M, min(ys) - FOOT_M, max(ys) + FOOT_M
    box = (cloud.east >= x0) & (cloud.east <= x1) & (cloud.north >= y0) & (cloud.north <= y1)
    e, n, u, c = cloud.east[box], cloud.north[box], cloud.up[box], cloud.classification[box]
    if e.size < CITY3D_MIN_POINTS * 2:
        return {"failed": "too few returns", "points": int(e.size)}
    ground = u[c == CLASS_GROUND]
    if ground.size < 8:
        return {"failed": "no ground at the foot"}
    base = float(np.median(ground))
    # Ground returns only outside the outline: they pin the model's foot to the ground, and
    # none inside is left for City3D to take for a roof (a shed's yard read as its roof).
    outside = ~_inside_mask(ring, e, n)
    keep = (u - base >= -0.3) & (np.isin(c, classes or [1, 6]) | ((c == CLASS_GROUND) & outside))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    pts = _thin(np.column_stack((e[keep] - cx, n[keep] - cy, u[keep] - base)), THIN_M)
    if pts.shape[0] < CITY3D_MIN_POINTS * 2:
        return {"failed": "too few returns", "points": int(pts.shape[0])}
    ply, obj, out = work / "b.ply", work / "b_footprint.obj", work / "b_result.obj"
    for f in (out,):
        f.unlink(missing_ok=True)
    with ply.open("w") as fh:
        fh.write(f"ply\nformat ascii 1.0\nelement vertex {pts.shape[0]}\nproperty float x\nproperty float y\nproperty float z\nend_header\n")
        np.savetxt(fh, pts, fmt="%.3f")
    with obj.open("w") as fh:
        for x, y in ring:
            fh.write(f"v {x - cx:.3f} {y - cy:.3f} 0\n")
        fh.write("f " + " ".join(str(i + 1) for i in range(len(ring))) + "\n")
    try:
        r = subprocess.run([str(CITY3D), str(ply), str(obj), str(out), str(CITY3D_MIN_POINTS), str(CITY3D_PIXEL_M)],
                           capture_output=True, text=True, timeout=CITY3D_TIMEOUT_S, cwd=work)
    except subprocess.TimeoutExpired:
        return {"failed": f"timed out at {CITY3D_TIMEOUT_S:.0f} s"}
    if r.returncode != 0 or not out.exists():
        tail = (r.stderr or r.stdout or "").strip().splitlines()[-1:] or ["no output"]
        return {"failed": tail[0][:120]}
    reading = city3d_reading(out.read_text())
    if reading is None:
        return {"failed": "no roof in the model"}
    reading["points"] = int(pts.shape[0])
    return reading


# ---- 3dfier -------------------------------------------------------------------------------------

def run_3dfier(cloud, members, rings, work: Path, classes: list[int] | None = None) -> dict[str, dict]:
    """A whole cell through 3dfier: its returns as LAS, its footprints as GeoJSON."""
    import laspy
    las_path, poly_path, cfg_path, csv_path = work / "cell.las", work / "cell.geojson", work / "cell.yml", work / "cell.csv"
    for f in (csv_path,):
        f.unlink(missing_ok=True)
    header = laspy.LasHeader(point_format=1, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.array([0.0, 0.0, 0.0])
    las = laspy.LasData(header)
    las.x, las.y, las.z = cloud.east, cloud.north, cloud.up
    las.classification = cloud.classification.astype(np.uint8)
    las.write(str(las_path))
    feats = [{"type": "Feature", "properties": {"fid": str(b["osm_id"])},
              "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring] + [list(ring[0])]]}}
             for b, ring in zip(members, rings, strict=True)]
    poly_path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    cfg_path.write_text(TDF_CONFIG.format(polygons=poly_path, points=las_path, roof_classes=classes or [1, 6]))
    try:
        r = subprocess.run([str(TDF), str(cfg_path), "--CSV-BUILDINGS-MULTIPLE", str(csv_path)],
                           capture_output=True, text=True, timeout=600, cwd=work)
    except subprocess.TimeoutExpired:
        return {}
    if r.returncode != 0 or not csv_path.exists():
        print(f"    3dfier: {(r.stderr or r.stdout).strip().splitlines()[-1:]}", flush=True)
        return {}
    out = {}
    lines = csv_path.read_text().splitlines()
    head = [h.strip().lower() for h in lines[0].split(",")]
    for line in lines[1:]:
        row = dict(zip(head, (v.strip() for v in line.split(",")), strict=False))
        key = row.get("id") or row.get("fid")
        if key is None:
            continue
        reading = tdf_reading(_tdf_columns(row))
        if reading:
            out[key] = reading
    return out


def _tdf_columns(row: dict) -> dict:
    """3dfier's CSV-BUILDINGS-MULTIPLE columns (id, ground-0.00 ... ground-0.50, roof-0.00 ...
    roof-0.99) in the names tdf_reading takes: the ground at its 10th percentile, as 3dfier's own
    LoD1.2 lifts it, and the roof's percentiles as they are."""
    out = {k: v for k, v in row.items() if k.startswith("roof-")}
    if "ground-0.10" in row:
        out["ground"] = row["ground-0.10"]
    return out


# ---- one region ---------------------------------------------------------------------------------

def shaped_ids(path: Path) -> set[str]:
    """Buildings that already have a roof shape: OpenStreetMap's, or the lidar measurer's."""
    out = set()
    for name in ("sf-corridor-building-shapes.json", "sf-corridor-roof-shapes.json"):
        f = path.parent / name
        if f.exists():
            out |= set((json.loads(f.read_text()).get("buildings") or {}).keys())
    return out


def measure(name: str, args) -> dict:
    path, payload = roofs_mod.payload_of(name)
    buildings = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("points") and w.get("osm_id")]
    want_h = {str(b["osm_id"]) for b in buildings if fillable(b)}
    want_r = (({str(b["osm_id"]) for b in buildings} - shaped_ids(path)) if args.roofs else set())
    ids = set(args.ids.split(",")) if args.ids else None
    store = ROOT / "data" / "regions" / name / "lidar" / "height_fill.json"
    done = json.loads(store.read_text()) if store.exists() else {"city3d": {}, "3dfier": {}}
    # Measured already by both programs: not again. (City3D is the slow one and runs once per
    # building; 3dfier, a cell at a time, runs again for any building it has no reading for.)
    targets = [b for b in buildings if (str(b["osm_id"]) in want_h | want_r) and (ids is None or str(b["osm_id"]) in ids)
               and not (str(b["osm_id"]) in done["city3d"] and str(b["osm_id"]) in done["3dfier"])]
    if args.limit:
        targets = targets[: args.limit]
    print(f"{name}: {len(want_h)} heights to fill, {len(want_r)} roofs to read; measuring {len(targets)}", flush=True)
    if not targets or args.apply_only:
        return done
    lat0 = sum(b["centroid"][1] for b in targets) / len(targets)
    lon0 = sum(b["centroid"][0] for b in targets) / len(targets)
    cells: dict[tuple[int, int], list] = {}
    for b in targets:
        x, y = _enu(b["centroid"][0], b["centroid"][1], lat0, lon0)
        cells.setdefault((int(x // CELL_M), int(y // CELL_M)), []).append(b)
    reader = EptReader(roofs_mod.dataset_of(name), cache=False)
    started = time.time()
    work = Path(tempfile.mkdtemp(prefix="heightfill-"))
    try:
        for k, ((cx, cy), members) in enumerate(sorted(cells.items())):
            clon = lon0 + (cx + 0.5) * CELL_M / (111_320.0 * math.cos(math.radians(lat0)))
            clat = lat0 + (cy + 0.5) * CELL_M / 111_320.0
            span = max(CELL_M / 2, max(max(abs(_enu(p[0], p[1], clat, clon)[0]), abs(_enu(p[0], p[1], clat, clon)[1]))
                                         for b in members for p in b["points"])) + REACH_M
            cloud = None
            t0 = time.time()
            for attempt in range(3):
                try:
                    cloud = reader.around(clat, clon, span, resolution_m=RESOLUTION_M)
                    break
                except Exception as exc:   # the network: try again, then record the gap
                    if attempt == 2:
                        print(f"  cell {cx}:{cy}: {exc}", flush=True)
                    time.sleep(5 * (attempt + 1))
            if cloud is None or not len(cloud):
                for b in members:
                    done["city3d"][str(b["osm_id"])] = {"failed": "no lidar"}
                continue
            fetched = time.time() - t0
            rings = [_ring_enu(b["points"], cloud.origin_lat, cloud.origin_lon) for b in members]
            classes = roof_classes(cloud)
            t1 = time.time()
            for b, ring in zip(members, rings, strict=True):
                if str(b["osm_id"]) not in done["city3d"]:
                    done["city3d"][str(b["osm_id"])] = run_city3d(cloud, ring, work, classes) or {"failed": "nothing"}
            t2 = time.time()
            done["3dfier"].update(run_3dfier(cloud, members, rings, work, classes))
            print(f"    lidar {fetched:.0f} s ({len(cloud)} returns), City3D {t2 - t1:.0f} s, 3dfier {time.time() - t2:.0f} s", flush=True)
            store.parent.mkdir(parents=True, exist_ok=True)
            store.write_text(json.dumps(done))
            print(f"  {name}: cell {k + 1}/{len(cells)} ({len(members)} buildings), {time.time() - started:.0f} s", flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return done


def load_gba() -> GbaIndex | None:
    if not GBA.exists():
        print(f"  (no atlas: run scripts/fetch_gba_heights.py for {GBA.relative_to(ROOT)})", flush=True)
        return None
    with gzip.open(GBA, "rt", encoding="utf-8") as fh:
        return GbaIndex(json.load(fh)["buildings"])


def readings_of(done: dict) -> dict[str, dict]:
    """Only successful readings: a failure is no reading."""
    return {src: {k: v for k, v in (done.get(src) or {}).items() if v.get("height_m") is not None}
            for src in ("city3d", "3dfier")}


def apply(name: str, done: dict, gba: GbaIndex | None, roofs: bool) -> dict:
    readings = readings_of(done)
    summary = {}
    for path in roofs_mod.payload_paths(name):
        if not path.exists():
            continue
        payload = json.loads(path.read_text())
        counts = fill_heights(payload["ways"], readings, gba)
        if any(counts[k] for k in ("city3d", "3dfier", "gba")):
            path.write_text(json.dumps(payload, separators=(",", ":")) + ("\n" if path.read_text().endswith("\n") else ""))
        summary[str(path.relative_to(ROOT))] = counts
        if roofs:
            summary[str(path.relative_to(ROOT)) + " roofs"] = publish_roofs(path, payload, readings)
    return summary


def publish_roofs(path: Path, payload: dict, readings: dict) -> dict:
    """Add City3D's (else 3dfier's) pitched roofs to sf-corridor-roof-shapes.json, for buildings
    with no shape; the lidar measurer's own entries stay as they are."""
    f = path.parent / "sf-corridor-roof-shapes.json"
    shapes = json.loads(f.read_text()) if f.exists() else {
        "schema": roofs_mod.SCHEMA, "bbox": payload["bbox"], "grade": "lidar-inferred", "buildings": {}}
    taken = shaped_ids(path)
    # Where measure_roof_shapes.py has read this region (its "drawn" list is in the file), it has
    # already judged every roof and published only the hips it trusts: 3dfier's coarser
    # flat/pitched verdict is not put over that. City3D's model is, where it has one.
    sources = ("city3d",) if "drawn" in shapes else ("city3d", "3dfier")
    added = Counter()
    for b in payload["ways"]:
        key = str(b.get("osm_id"))
        if b.get("kind") != "building" or not b.get("points") or key in taken:
            continue
        for src in sources:
            r = readings[src].get(key)
            entry = roof_entry(src, r, b.get("height_m")) if r else None
            if entry:
                entry.update({"guard": {"n": len(b["points"]), "first": b["points"][0]},
                              "outer": roofs_mod.min_rectangle(b["points"])})
                shapes["buildings"][key] = entry
                added[f"{src}:{entry['roof']}"] += 1
                break
    if added:
        shapes.setdefault("added_by", {})["fill_building_heights"] = (
            "City3D LoD2 roof faces (gabled/hipped/skillion), else a 3dfier pitched reading drawn hipped")
        f.write_text(json.dumps(shapes, separators=(",", ":")) + "\n")
    return dict(added)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("regions", nargs="+")
    ap.add_argument("--roofs", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--ids", default="")
    ap.add_argument("--apply-only", action="store_true")
    ap.add_argument("--no-apply", action="store_true")
    args = ap.parse_args()
    if not args.apply_only:
        for tool in (CITY3D, TDF):
            if not tool.exists():
                raise SystemExit(f"{tool} is missing: run scripts/install_building_tools.sh")
    gba = None if args.no_apply else load_gba()
    for name in args.regions:
        done = measure(name, args)
        c = Counter("ok" if v.get("height_m") is not None else v.get("failed", "?") for v in done["city3d"].values())
        print(f"  city3d: {dict(c)}; 3dfier: {len(done['3dfier'])} readings", flush=True)
        if not args.no_apply:
            print(json.dumps(apply(name, done, gba, True), indent=1), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
