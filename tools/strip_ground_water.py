"""Cut the water out of the ground the page fills in.

The gap inference (tools/infer_ground_gaps.py) reads a capture of the rendered world, and where
the region drew no water -- the estuary off Jack London Square -- the water was bare ground to
it, and a stretch of bare ground that large became lawn: a third of a square kilometre of grass
over the estuary. Port parcels drawn as plazas reached into it as well. This takes the region's
own water (visual_landwater: its water polygons and the sea side of its coastlines, never what a
building, a car park, a street or a pier stands on) out of the ``inferred`` and ``plazas`` rings
of each ground file beside it.

    .venv/bin/python tools/strip_ground_water.py REGION_DIR [...]

REGION_DIR holds sf-corridor-3d.json, sf-corridor-terrain.json/.bin and the ground files;
docs/ is the San Francisco corridor. Run tools/build_window_cells.py after it.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from shapely import contains_xy
from shapely.geometry import MultiPolygon, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.terrain.visual_support import visual_landwater  # noqa: E402
from smc.terrain.waterline import rasterise  # noqa: E402

GROUND_FILES = ("sf-corridor-ground.json", "app-sf-corridor-ground.json")
STRIPPED = ("inferred", "plazas")
#: A fill keeps its last metre of shore: the mask is a 2 m grid, and its edge is not the bank.
SHORE_KEEP_CELLS = 1
#: Pieces smaller than this after the cut are dropped (m^2).
MIN_PIECE_M2 = 1.0


def water_shape(region: Path) -> tuple[object, dict] | tuple[None, None]:
    """The region's open water as one lon/lat shape, and the terrain frame."""
    meta_path, bin_path = region / "sf-corridor-terrain.json", region / "sf-corridor-terrain.bin"
    payload_path = region / "sf-corridor-3d.json"
    if not (meta_path.exists() and bin_path.exists() and payload_path.exists()):
        return None, None
    meta = json.loads(meta_path.read_text())
    frame = meta["frame"]
    cm = np.fromfile(bin_path, "<i2").reshape(frame["rows"], frame["cols"])
    payload = json.loads(payload_path.read_text())
    water = visual_landwater(payload, meta, cm) == 1
    piers = [w["points"] for w in payload.get("ways", [])
             if w.get("kind") == "pier" and len(w.get("points") or []) >= 4]
    if piers:
        water &= ~cv2.dilate(rasterise(piers, frame).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    if SHORE_KEEP_CELLS:
        size = 2 * SHORE_KEEP_CELLS + 1
        water = cv2.erode(water.astype(np.uint8), np.ones((size, size), np.uint8)).astype(bool)
    contours, hierarchy = cv2.findContours(water.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, frame

    def lonlat(contour: np.ndarray) -> list[tuple[float, float]]:
        # A cell's corner, not its centre: column c spans x0 + c*step .. x0 + (c+1)*step.
        pts = contour.reshape(-1, 2).astype(float)
        east = frame["x0"] + pts[:, 0] * frame["step_m"]
        north = frame["y0"] + pts[:, 1] * frame["step_m"]
        return list(zip(frame["mid_lon"] + east / frame["metres_per_lon"],
                        frame["mid_lat"] + north / frame["metres_per_lat"]))

    shapes = []
    for i, contour in enumerate(contours):
        if hierarchy[0][i][3] != -1 or len(contour) < 3:
            continue
        holes = []
        child = hierarchy[0][i][2]
        while child != -1:
            if len(contours[child]) >= 3:
                holes.append(lonlat(contours[child]))
            child = hierarchy[0][child][0]
        shape = Polygon(lonlat(contour), holes).buffer(0)
        if not shape.is_empty:
            shapes.append(shape)
    return unary_union(shapes), frame


def without_holes(shape) -> list[Polygon]:
    """A ring in the ground files has no holes: cut a holed polygon until none has one."""
    polys = list(shape.geoms) if isinstance(shape, MultiPolygon) else [shape] if isinstance(shape, Polygon) else \
        [g for g in getattr(shape, "geoms", []) if isinstance(g, Polygon)]
    out = []
    while polys:
        poly = polys.pop()
        if not isinstance(poly, Polygon) or poly.is_empty:
            continue
        if not poly.interiors:
            out.append(poly)
            continue
        cx = poly.interiors[0].centroid.x
        minx, miny, maxx, maxy = poly.bounds
        for half in (box(minx - 1, miny - 1, cx, maxy + 1), box(cx, miny - 1, maxx + 1, maxy + 1)):
            piece = poly.intersection(half)
            polys.extend(piece.geoms if hasattr(piece, "geoms") else [piece])
    return [p for p in out if isinstance(p, Polygon)]


def strip(ground: dict, water, frame: dict) -> dict:
    """Cut ``water`` out of the ground's fills; returns counts of what changed."""
    m2 = frame["metres_per_lon"] * frame["metres_per_lat"]
    report = {}
    for key in STRIPPED:
        rows, kept, cut_m2, touched = ground.get(key) or [], [], 0.0, 0
        for item in rows:
            ring = item.get("p") if isinstance(item, dict) else None
            if not ring or len(ring) < 4:
                kept.append(item)
                continue
            poly = Polygon(ring)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if not poly.intersects(water):
                kept.append(item)
                continue
            rest = poly.difference(water)
            cut = poly.area - rest.area
            if cut * m2 < 0.5:
                kept.append(item)
                continue
            touched += 1
            cut_m2 += cut * m2
            pieces = sorted((p for p in without_holes(rest) if p.area * m2 >= MIN_PIECE_M2),
                            key=lambda p: -p.area)
            for n, piece in enumerate(pieces):
                coords = [[round(x, 6), round(y, 6)] for x, y in piece.exterior.coords]
                row = dict(item, p=coords)
                if n and "id" in row:
                    row["id"] = f"{row['id']}~{n}"
                kept.append(row)
        ground[key] = kept
        report[key] = {"touched": touched, "water_cut_m2": round(cut_m2), "rings": len(kept)}
    return report


def wet_share(ground: dict, water, key: str = "inferred") -> float:
    """Share of sample points of the fills that lie on the water (a check, not a cut)."""
    points = []
    for item in ground.get(key) or []:
        for x, y in item.get("p", [])[:-1]:
            points.append((x, y))
    if not points or water is None:
        return 0.0
    xs, ys = np.array(points).T
    return float(contains_xy(water, xs, ys).mean())


def main() -> None:
    for name in sys.argv[1:]:
        region = Path(name)
        water, frame = water_shape(region)
        if water is None:
            print(f"{region}: no terrain or no water, skipped")
            continue
        for file in GROUND_FILES:
            path = region / file
            if not path.exists():
                continue
            ground = json.loads(path.read_text())
            report = strip(ground, water, frame)
            path.write_text(json.dumps(ground, separators=(",", ":")))
            print(f"{path}: {json.dumps(report)}")


if __name__ == "__main__":
    main()
