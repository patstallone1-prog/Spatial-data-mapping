"""Give the road back the fills that lie on it.

tools/infer_ground_gaps.py fills the ground nothing describes from what is nearest it, and a gap
in the road surface -- the flare where a slip lane joins a street, the mouth of a junction --
whose nearest described neighbour is a footway or a median island became *paving*: a slab in the
traffic lanes that the cars and the bike lane run straight across (Fillmore and Bay, 2026-11-14:
"part of the kerb island may not exist ... even cars drive through").

The kerb settles it. A piece of a fill that can be reached from a street's centre line without
crossing a kerb, and lies within the street's width of it (plus a junction's flare), is the
street's surface: it is redrawn as asphalt. The rest of the fill keeps its kind. Kerbs are the
survey's curb lines and the islands' rings (sf-corridor-official.json, sf-corridor-islands.json).

    python3 tools/inferred_roadway_to_asphalt.py DIR [DIR ...]

DIR holds sf-corridor-3d.json, sf-corridor-official.json and sf-corridor-ground.json (and
optionally sf-corridor-islands.json); a sibling app-sf-corridor-ground.json with the same
``inferred`` is rewritten to match. Idempotent: a second run finds nothing more to move.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

PX_PER_M = 2
#: How far past half the street's width the road may reach: a junction's flare, a slip lane
#: widening into the street it joins.
FLARE_M = 3.0
#: Window round a fill in which its kerbs and streets are drawn.
MARGIN_M = 25.0
#: A piece smaller than this is not worth a ring (m^2).
MIN_PIECE_M2 = 1.0
MOVED_KINDS = {"paving", "grass", "service"}


def _frame(bbox: dict) -> tuple[float, float, float, float]:
    lat0 = (bbox["south"] + bbox["north"]) / 2
    lon0 = (bbox["west"] + bbox["east"]) / 2
    return lon0, lat0, 111_320.0 * math.cos(math.radians(lat0)), 111_320.0


class Index:
    """Polylines in metres, filed by 50 m cell."""

    CELL = 50.0

    def __init__(self) -> None:
        self.cells: dict[tuple[int, int], list[int]] = {}
        self.items: list[tuple[np.ndarray, float]] = []

    def add(self, pts: np.ndarray, value: float = 0.0) -> None:
        i = len(self.items)
        self.items.append((pts, value))
        lo, hi = pts.min(0), pts.max(0)
        for cx in range(int(lo[0] // self.CELL), int(hi[0] // self.CELL) + 1):
            for cy in range(int(lo[1] // self.CELL), int(hi[1] // self.CELL) + 1):
                self.cells.setdefault((cx, cy), []).append(i)

    def query(self, lo: np.ndarray, hi: np.ndarray) -> list[tuple[np.ndarray, float]]:
        seen: set[int] = set()
        for cx in range(int(lo[0] // self.CELL), int(hi[0] // self.CELL) + 1):
            for cy in range(int(lo[1] // self.CELL), int(hi[1] // self.CELL) + 1):
                seen.update(self.cells.get((cx, cy), ()))
        return [self.items[i] for i in sorted(seen)]


def roadway_split(ring_m: np.ndarray, kerbs: Index, streets: Index) -> tuple[np.ndarray, np.ndarray, tuple] | None:
    """The fill's mask and the part of it on a street's surface, in a window round it."""
    lo = ring_m.min(0) - MARGIN_M
    hi = ring_m.max(0) + MARGIN_M
    near_streets = streets.query(lo, hi)
    if not near_streets:
        return None
    w = int(math.ceil((hi[0] - lo[0]) * PX_PER_M)) + 1
    h = int(math.ceil((hi[1] - lo[1]) * PX_PER_M)) + 1
    to_px = lambda pts: np.round((pts - lo) * PX_PER_M).astype(np.int32).reshape(-1, 1, 2)
    fill = np.zeros((h, w), np.uint8)
    cv2.fillPoly(fill, [to_px(ring_m)], 1)
    reach = np.zeros((h, w), np.uint8)
    seeds = np.zeros((h, w), np.uint8)
    for pts, half in near_streets:
        cv2.polylines(reach, [to_px(pts)], False, 1, thickness=max(1, int(round(2 * (half + FLARE_M) * PX_PER_M))))
        cv2.polylines(seeds, [to_px(pts)], False, 1, thickness=1)
    barrier = np.zeros((h, w), np.uint8)
    for pts, closed in kerbs.query(lo, hi):
        cv2.polylines(barrier, [to_px(pts)], bool(closed), 1, thickness=2)
    open_ = (reach > 0) & (barrier == 0)
    count, labels = cv2.connectedComponents(open_.astype(np.uint8), connectivity=4)
    if count <= 1:
        return fill, np.zeros_like(fill), (lo,)
    seeded = np.zeros(count, bool)
    seeded[np.unique(labels[(seeds > 0) & open_])] = True
    seeded[0] = False
    road = seeded[labels]
    # The kerb line's own two pixels go with whichever side holds the most of the fill nearby:
    # grown by a pixel, the road takes the kerb under it rather than leave a seam of paving.
    road = cv2.dilate(road.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))) > 0
    road &= (reach > 0)
    return fill, (fill > 0) & road, (lo,)


def mask_rings(mask: np.ndarray, lo: np.ndarray, to_lonlat) -> list[list[list[float]]]:
    out = []
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        if cv2.contourArea(contour) < MIN_PIECE_M2 * PX_PER_M ** 2:
            continue
        simple = cv2.approxPolyDP(contour, 1.0, True).reshape(-1, 2)
        if len(simple) < 3:
            continue
        ring = [to_lonlat(lo[0] + c / PX_PER_M, lo[1] + r / PX_PER_M) for c, r in simple]
        ring.append(ring[0])
        out.append(ring)
    return out


def process(directory: Path) -> dict:
    roads = json.loads((directory / "sf-corridor-3d.json").read_text())
    official = json.loads((directory / "sf-corridor-official.json").read_text())
    ground_path = directory / "sf-corridor-ground.json"
    ground = json.loads(ground_path.read_text())
    lon0, lat0, kx, ky = _frame(roads["bbox"])
    to_m = lambda pts: np.array([[(p[0] - lon0) * kx, (p[1] - lat0) * ky] for p in pts], np.float64)
    to_lonlat = lambda x, y: [round(lon0 + x / kx, 6), round(lat0 + y / ky, 6)]

    streets = Index()
    for way in roads.get("ways", []):
        if way.get("kind") != "street" or len(way.get("points") or []) < 2 or way.get("tunnel"):
            continue
        width = way.get("road_m") or 3.3 * (way.get("lanes") or 2)
        streets.add(to_m(way["points"]), width / 2)
    kerbs = Index()
    for line in official.get("curb_lines", []):
        if len(line.get("p") or []) >= 2:
            kerbs.add(to_m(line["p"]), 0.0)
    islands_path = directory / "sf-corridor-islands.json"
    if islands_path.exists():
        for island in json.loads(islands_path.read_text()).get("islands", []):
            if island.get("basis") == "survey_unconfirmed" and not island.get("closed_in_survey"):
                continue
            if len(island.get("p") or []) >= 4:
                kerbs.add(to_m(island["p"]), 1.0)

    out, stats = [], {"rings": 0, "moved_whole": 0, "split": 0, "asphalt_m2": 0.0}
    for item in ground.get("inferred", []):
        # A piece an earlier run left ("kerbside": true) reaches a pixel under the road it was
        # cut from, grown to tuck under it: already settled.
        if item.get("k") not in MOVED_KINDS or len(item.get("p") or []) < 4 or item.get("kerbside"):
            out.append(item)
            continue
        stats["rings"] += 1
        ring_m = to_m(item["p"])
        found = roadway_split(ring_m, kerbs, streets)
        if not found or not found[1].any():
            out.append(item)
            continue
        fill, road, (lo,) = found
        area = float(fill.sum()) or 1.0
        on_road = float(road.sum())
        stats["asphalt_m2"] += on_road / PX_PER_M ** 2
        if on_road / area >= 0.9:
            out.append({**item, "k": "asphalt", "was": item["k"]})
            stats["moved_whole"] += 1
            continue
        if on_road < MIN_PIECE_M2 * PX_PER_M ** 2:
            out.append(item)
            continue
        stats["split"] += 1
        # Each piece grown a pixel so it tucks under its neighbour, as the inferred rings are.
        grow = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        road_grown = cv2.dilate(road.astype(np.uint8), grow)
        rest = ((fill > 0) & ~road).astype(np.uint8)
        for ring in mask_rings(road_grown & fill, lo, to_lonlat):
            out.append({"k": "asphalt", "was": item["k"], "p": ring})
        for ring in mask_rings(cv2.dilate(rest, grow) & fill, lo, to_lonlat):
            out.append({**item, "p": ring, "kerbside": True})
    ground["inferred"] = out
    ground_path.write_text(json.dumps(ground, separators=(",", ":")))
    app = directory / "app-sf-corridor-ground.json"
    if app.exists():
        app_ground = json.loads(app.read_text())
        app_ground["inferred"] = out
        app.write_text(json.dumps(app_ground, separators=(",", ":")))
    stats["asphalt_m2"] = round(stats["asphalt_m2"], 1)
    return stats


def main() -> None:
    for arg in sys.argv[1:]:
        print(arg, json.dumps(process(Path(arg))))


if __name__ == "__main__":
    main()
