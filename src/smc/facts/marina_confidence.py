"""Confidence that each Marina intersection and kerb island is drawn as it is on the street.

Every score is built from independent evidence, each piece listed beside it so a score can be
checked by hand. The model's own drawing is never evidence for itself: a score says how much
of what the page draws at a place is backed by the city's records, the survey, the aerial
photographs and OpenStreetMap agreeing with each other.

Islands (``island_confidence``)
    Prior from how the island is known: seen raised in the 0.25 m aerial photographs (with the
    survey's kerb, or from the photograph alone), closed in the survey but not seen, or a survey
    fragment the photographs could not confirm. Raised by a lidar median reading on it, a
    crossing that lands on it, a kerb ramp on it, the survey's kerb around a photograph-only
    outline; lowered for a sliver no one could stand on. Combined in log-odds.

Intersections (``intersection_confidence``)
    Prior 0.5. Raised by the city's centreline network having a node within a few metres, the
    same number of legs in both, a known traffic control (stop signs on the approaches), the
    city's crosswalk inventory at the junction, the survey's kerbs in each corner between legs,
    and kerb ramps at those corners.

Surroundings (``area_confidence``, 25 m round the point)
    The share of the kerb the survey covers, the junctions and islands within reach (the weakest
    of the islands counts), the crossings recorded by the city that OpenStreetMap also has, and
    kerb ramps where corners are.

Accuracy (``calibration``)
    Islands: the lidar's reading on an island (raised or flat) is the truth where there is one;
    the score without the lidar is checked against it (AUC, and the share raised in each band).
    Intersections: each source is held out in turn and the score from the rest is asked to rank
    the junctions it supports above those it does not (an AUC; 0.5 is no better than chance).
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

#: [south, west, north, east]: City mode's area (module 30 CITY_AREA).
MARINA_BBOX = (37.7983, -122.4478, 37.8082, -122.4310)
AREA_RADIUS_M = 25.0
#: Survey lines whose island the owner's photographs confirmed (module 15
#: CONFIRMED_SURVEY_ISLAND_LINES).
OWNER_CONFIRMED_LINES = frozenset({4137})

#: How often each kind is raised where the lidar read it (Marina, 2026-11-26, on the island
#: itself): aerial-confirmed 13 of 13, survey fragments the photographs could not confirm 15 of
#: 15, the photograph's outline alone 3 of 4. The unconfirmed fragments are not mostly wrong,
#: as their old 0.4 said: the photograph missed them (trees, shadow, a low kerb). Set a little
#: under the measured rates for the islands the lidar did not read, which are smaller, off the
#: long medians it follows.
ISLAND_PRIORS = {
    "owner_photo": 0.95,
    "survey_aerial_confirmed": 0.90,
    "survey_unconfirmed": 0.80,
    "survey_closed": 0.75,
    "aerial": 0.60,
}
#: Larger than this is not a traffic island (a park's outline, a block the survey closed).
ISLAND_MAX_M2 = 1500.0
ISLAND_WEIGHTS = {"lidar": 1.6, "lidar_flat": -2.0, "crossing": 0.5, "ramp": 0.7, "kerb": 0.6, "sliver": -1.2,
                  "oversize": -4.0}
JUNCTION_WEIGHTS = {"centreline": 1.1, "legs": 0.7, "control": 0.6, "crosswalk": 0.5,
                    "kerbs": 1.0, "ramps": 0.6}


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def _sigmoid(v: float) -> float:
    return 1 / (1 + math.exp(-v))


class Frame:
    """Metres east/north of the Marina's middle (equirectangular; under 1 cm error in 2 km)."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111_320.0 * math.cos(math.radians(lat0))
        self.ky = 110_574.0

    def xy(self, lon: float, lat: float) -> tuple[float, float]:
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)


def _seg_dist(px: float, py: float, a: Sequence[float], b: Sequence[float]) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _line_dist(px: float, py: float, line: Sequence[Sequence[float]]) -> float:
    if len(line) == 1:
        return math.hypot(px - line[0][0], py - line[0][1])
    return min(_seg_dist(px, py, line[i - 1], line[i]) for i in range(1, len(line)))


def _in_ring(px: float, py: float, ring: Sequence[Sequence[float]]) -> bool:
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def _ring_area(ring: Sequence[Sequence[float]]) -> float:
    return abs(sum(ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1] for i in range(len(ring)))) / 2


def _perimeter(ring: Sequence[Sequence[float]]) -> float:
    return sum(math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]) for i in range(len(ring)))


def _resample(line: Sequence[Sequence[float]], step: float = 1.0) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for i in range(1, len(line)):
        (ax, ay), (bx, by) = line[i - 1], line[i]
        n = max(1, math.ceil(math.hypot(bx - ax, by - ay) / step))
        out.extend((ax + (bx - ax) * k / n, ay + (by - ay) * k / n) for k in range(n))
    if line:
        out.append((line[-1][0], line[-1][1]))
    return out


@dataclass
class Evidence:
    """The places and records the scores are built from, in metres (Frame.xy)."""

    islands: list[dict[str, Any]] = field(default_factory=list)       # {ring, basis, lines, id}
    junctions: list[dict[str, Any]] = field(default_factory=list)     # {x, y, a, b}
    streets: list[list[tuple[float, float]]] = field(default_factory=list)
    crossings: list[list[tuple[float, float]]] = field(default_factory=list)
    kerbs: list[list[tuple[float, float]]] = field(default_factory=list)   # the survey's kerb lines
    ramps: list[tuple[float, float]] = field(default_factory=list)
    lidar_medians: list[list[tuple[float, float]]] = field(default_factory=list)     # read raised
    lidar_flat: list[list[tuple[float, float]]] = field(default_factory=list)        # read as paint
    crosswalks: list[tuple[float, float]] = field(default_factory=list)    # the city's inventory
    stop_signs: list[tuple[float, float]] = field(default_factory=list)
    centreline_nodes: list[tuple[float, float, int]] = field(default_factory=list)  # x, y, legs


def island_basis(island: dict[str, Any]) -> str:
    if OWNER_CONFIRMED_LINES.intersection(island.get("lines") or []):
        return "owner_photo"
    basis = str(island.get("basis") or "survey_unconfirmed")
    if basis == "survey_unconfirmed" and island.get("closed_in_survey"):
        return "survey_closed"
    return basis if basis in ISLAND_PRIORS else "survey_unconfirmed"


def island_evidence(island: dict[str, Any], ev: Evidence) -> dict[str, float]:
    ring = island["ring"]
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    box = (min(xs) - 3, min(ys) - 3, max(xs) + 3, max(ys) + 3)
    near = lambda pts: any(box[0] <= x <= box[2] and box[1] <= y <= box[3] for x, y in pts)  # noqa: E731

    def on_or_by(px: float, py: float, reach: float) -> bool:
        return _in_ring(px, py, ring) or _line_dist(px, py, [*list(ring), ring[0]]) <= reach

    out: dict[str, float] = {}
    # A raised median the lidar read, along the island: a third of its readings on it or by it.
    lidar = 0.0
    for line in ev.lidar_medians:
        if not near(line):
            continue
        pts = _resample(line, 1.0)
        share = sum(on_or_by(x, y, 1.0) for x, y in pts) / max(1, len(pts))
        lidar = max(lidar, min(1.0, share * 3))
    out["lidar"] = lidar
    # Read along the island as paint and nowhere raised: the lidar says it is flat.
    flat = 0.0
    if lidar < 0.5:
        for line in ev.lidar_flat:
            if not near(line):
                continue
            pts = _resample(line, 1.0)
            share = sum(on_or_by(x, y, 1.0) for x, y in pts) / max(1, len(pts))
            flat = max(flat, min(1.0, share * 3))
    out["lidar_flat"] = flat
    # A mapped crossing whose end lands on it or within 2.5 m.
    out["crossing"] = 1.0 if any(on_or_by(*c[0], 2.5) or on_or_by(*c[-1], 2.5)
                                 for c in ev.crossings if near(c)) else 0.0
    out["ramp"] = 1.0 if any(on_or_by(x, y, 2.0) for x, y in ev.ramps
                             if box[0] <= x <= box[2] and box[1] <= y <= box[3]) else 0.0
    # The survey's kerb round an outline the photograph drew (for a survey island this is the
    # island itself, and says nothing more).
    if island["basis"] == "aerial":
        edge = _resample([*list(ring), ring[0]], 1.0)
        kerb_lines = [k for k in ev.kerbs if near(k)]
        covered = sum(any(_line_dist(x, y, k) <= 1.0 for k in kerb_lines) for x, y in edge)
        out["kerb"] = covered / max(1, len(edge))
    else:
        out["kerb"] = 0.0
    area = _ring_area(ring)
    width = 2 * area / max(_perimeter(ring), 1e-6)
    out["sliver"] = 1.0 if area < 1.5 or width < 0.5 else 0.0
    out["oversize"] = 1.0 if area > ISLAND_MAX_M2 else 0.0
    return out


def island_confidence(island: dict[str, Any], ev: Evidence, drop: str | None = None) -> tuple[float, dict[str, float]]:
    evidence = island_evidence(island, ev)
    v = _logit(ISLAND_PRIORS[island["basis"]])
    for key, w in ISLAND_WEIGHTS.items():
        if key != drop:
            v += w * evidence[key]
    return _sigmoid(v), evidence


def _legs_at(x: float, y: float, streets: Iterable[Sequence[Sequence[float]]], reach: float = 8.0) -> list[float]:
    """The bearings of the streets leaving (x, y): each line passing within ``reach`` gives one
    leg per side of the point it continues to (a street through the junction is two legs)."""
    bearings: list[float] = []
    for line in streets:
        pts = list(line)
        best = None
        for i in range(1, len(pts)):
            d = _seg_dist(x, y, pts[i - 1], pts[i])
            if d <= reach and (best is None or d < best[0]):
                best = (d, i)
        if best is None:
            continue
        i = best[1]
        for far in (pts[:i][::-1], pts[i:]):
            for px, py in far:
                if math.hypot(px - x, py - y) > reach + 4:
                    bearings.append(math.atan2(py - y, px - x))
                    break
    # Legs within 25 degrees are one (a street split in two ways).
    bearings.sort()
    merged: list[float] = []
    for b in bearings:
        if merged and abs(math.remainder(b - merged[-1], 2 * math.pi)) < math.radians(25):
            continue
        merged.append(b)
    if len(merged) > 1 and abs(math.remainder(merged[0] - merged[-1], 2 * math.pi)) < math.radians(25):
        merged.pop()
    return merged


def intersection_evidence(j: dict[str, Any], ev: Evidence) -> dict[str, float]:
    x, y = j["x"], j["y"]
    out: dict[str, float] = {}
    nearest = min(((math.hypot(cx - x, cy - y), legs) for cx, cy, legs in ev.centreline_nodes),
                  default=(math.inf, 0))
    d, city_legs = nearest
    out["centreline"] = 1.0 if d <= 4 else 0.5 if d <= 10 else 0.0
    legs = _legs_at(x, y, ev.streets)
    j["legs"] = len(legs)
    out["legs"] = 1.0 if d <= 10 and city_legs == len(legs) else 0.0
    stops = sum(1 for sx, sy in ev.stop_signs if math.hypot(sx - x, sy - y) <= 30)
    out["control"] = 1.0 if legs and stops >= len(legs) else 0.5 if stops else 0.0
    # (The inventory's point is the junction's: within 15 m. At 30 m every Marina junction had one.)
    out["crosswalk"] = 1.0 if any(math.hypot(cx - x, cy - y) <= 15 for cx, cy in ev.crosswalks) else 0.0
    # The survey's kerb in each corner between two legs, 6 to 20 m out along its bisector.
    corners = 0
    have = 0
    ramps = 0
    near_kerbs = [k for k in ev.kerbs if any(abs(px - x) < 30 and abs(py - y) < 30 for px, py in k)]
    for i, b in enumerate(legs):
        nb = legs[(i + 1) % len(legs)] if len(legs) > 1 else b + math.pi
        gap = (nb - b) % (2 * math.pi)
        if gap < math.radians(30):
            continue
        corners += 1
        mid = b + gap / 2
        probes = [(x + math.cos(mid) * r, y + math.sin(mid) * r) for r in (6, 9, 12, 15, 20)]
        if any(any(_line_dist(px, py, k) <= 4.0 for k in near_kerbs) for px, py in probes):
            have += 1
        cx, cy = x + math.cos(mid) * 9, y + math.sin(mid) * 9
        if any(math.hypot(rx - cx, ry - cy) <= 9 for rx, ry in ev.ramps):
            ramps += 1
    out["kerbs"] = have / corners if corners else 0.0
    out["ramps"] = ramps / corners if corners else 0.0
    return out


def intersection_confidence(j: dict[str, Any], ev: Evidence, drop: str | None = None) -> tuple[float, dict[str, float]]:
    evidence = intersection_evidence(j, ev)
    v = _logit(0.5) - 1.6        # nothing but OpenStreetMap's node: about one in four
    for key, w in JUNCTION_WEIGHTS.items():
        if key != drop:
            v += w * evidence[key]
    return _sigmoid(v), evidence


def area_confidence(x: float, y: float, ev: Evidence, junction_scores: Sequence[tuple[float, float, float]],
                    island_scores: Sequence[tuple[float, float, float]], radius: float = AREA_RADIUS_M) -> tuple[float, dict[str, float]]:
    """How much of the ground within ``radius`` is backed: the survey's kerb along the streets
    there, the junctions and islands there, the crossings the city and OpenStreetMap both have,
    and ramps at the corners."""
    # The kerb: points 4 to 8 m either side of each street centreline sample within the circle,
    # each covered if a survey kerb line runs within 3 m of it.
    near_kerbs = [k for k in ev.kerbs if any(math.hypot(px - x, py - y) < radius + 15 for px, py in k)]
    probes = 0
    covered = 0
    for line in ev.streets:
        if not any(math.hypot(px - x, py - y) < radius + 40 for px, py in line):
            continue
        pts = _resample(line, 4.0)
        for i in range(1, len(pts)):
            (ax, ay), (bx, by) = pts[i - 1], pts[i]
            if math.hypot(bx - x, by - y) > radius:
                continue
            L = math.hypot(bx - ax, by - ay) or 1
            nx, ny = -(by - ay) / L, (bx - ax) / L
            for side in (-1, 1):
                ok = False
                for off in (4, 6, 8):
                    px, py = bx + nx * side * off, by + ny * side * off
                    if any(_line_dist(px, py, k) <= 3.0 for k in near_kerbs):
                        ok = True
                        break
                probes += 1
                covered += ok
    kerb = covered / probes if probes else 0.0
    js = [s for jx, jy, s in junction_scores if math.hypot(jx - x, jy - y) <= radius]
    isl = [s for ix, iy, s in island_scores if math.hypot(ix - x, iy - y) <= radius]
    osm_ends = [c[0] for c in ev.crossings] + [c[-1] for c in ev.crossings]
    city = [c for c in ev.crosswalks if math.hypot(c[0] - x, c[1] - y) <= radius]
    agree = sum(1 for cx, cy in city if any(math.hypot(ox - cx, oy - cy) <= 25 for ox, oy in osm_ends))
    crossings = agree / len(city) if city else 0.5
    parts = {
        "kerb": kerb,
        "junctions": sum(js) / len(js) if js else 0.5,
        "islands": min(isl) if isl else 1.0,
        "crossings": crossings,
    }
    weights = {"kerb": 0.45, "junctions": 0.25, "islands": 0.15, "crossings": 0.15}
    return sum(parts[k] * w for k, w in weights.items()), parts


def auc(scores: Sequence[float], labels: Sequence[bool]) -> float | None:
    pos = [s for s, lab in zip(scores, labels, strict=False) if lab]
    neg = [s for s, lab in zip(scores, labels, strict=False) if not lab]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def calibration(ev: Evidence) -> dict[str, Any]:
    """Each source held out in turn: does the score from the rest rank the places it supports
    above the others?"""
    out: dict[str, Any] = {"islands": {}, "intersections": {}}
    # The lidar as the truth where it ran: the score without the lidar, against what it read.
    read = [(i, island_evidence(i, ev)) for i in ev.islands if i["area_m2"] <= ISLAND_MAX_M2]
    covered = [(i, e) for i, e in read if e["lidar"] >= 0.5 or e["lidar_flat"] >= 0.5]
    if covered:
        def without_lidar(i: dict[str, Any]) -> float:
            e = island_evidence(i, ev)
            v = _logit(ISLAND_PRIORS[i["basis"]])
            v += sum(w * e[k] for k, w in ISLAND_WEIGHTS.items() if k not in ("lidar", "lidar_flat"))
            return _sigmoid(v)
        scores = [without_lidar(i) for i, _ in covered]
        labels = [e["lidar"] >= 0.5 for _, e in covered]
        out["islands"]["lidar_read"] = {
            "islands": len(covered), "raised": sum(labels),
            "raised_share": round(sum(labels) / len(labels), 3),
            "mean_predicted_without_lidar": round(sum(scores) / len(scores), 3),
        }
        by_band: dict[str, list[int]] = {}
        for sc, lab in zip(scores, labels, strict=False):
            by_band.setdefault(band(sc), [0, 0])
            by_band[band(sc)][0] += 1
            by_band[band(sc)][1] += int(lab)
        out["islands"]["lidar_truth"] = {
            "auc": auc(scores, labels), "covered": len(covered),
            "raised_share_by_band": {b: {"islands": n, "raised": k, "share": round(k / n, 2)} for b, (n, k) in by_band.items()},
        }
    for key in ("centreline", "kerbs", "crosswalk", "control", "ramps"):
        scores, labels = [], []
        for j in ev.junctions:
            s, e = intersection_confidence(j, ev, drop=key)
            scores.append(s)
            labels.append(e[key] >= 0.5)
        out["intersections"][key] = {"auc": auc(scores, labels), "supported": sum(labels), "of": len(labels)}
    return out


def _in_bbox(lon: float, lat: float, bbox: Sequence[float] = MARINA_BBOX, pad: float = 0.0004) -> bool:
    s, w, n, e = bbox
    return w - pad <= lon <= e + pad and s - pad <= lat <= n + pad


def load_evidence(root: Path, bbox: Sequence[float] = MARINA_BBOX) -> tuple[Evidence, Frame]:
    s, w, n, e = bbox
    frame = Frame((s + n) / 2, (w + e) / 2)
    ev = Evidence()
    inb = lambda pts: any(_in_bbox(p[0], p[1], bbox) for p in pts)  # noqa: E731
    to = lambda pts: [frame.xy(p[0], p[1]) for p in pts]  # noqa: E731
    seen_ways: set[Any] = set()
    junctions: dict[tuple[int, int], dict[str, Any]] = {}
    for cell in sorted((root / "docs/cells/sf-corridor-3d").glob("*.json")):
        data = json.loads(cell.read_text())
        for _, way in data.get("ways", []):
            pts = way.get("points") or []
            if len(pts) < 2 or not inb(pts):
                continue
            key = way.get("osm_id") or (way.get("kind"), tuple(map(tuple, pts[:2])))
            if key in seen_ways:
                continue
            seen_ways.add(key)
            if way.get("kind") == "street" and not way.get("service"):
                ev.streets.append(to(pts))
            elif way.get("kind") == "crossing":
                ev.crossings.append(to(pts))
        for _, j in data.get("intersections", []):
            if not _in_bbox(j["lon"], j["lat"], bbox, 0):
                continue
            x, y = frame.xy(j["lon"], j["lat"])
            junctions.setdefault((round(x / 3), round(y / 3)), {"x": x, "y": y, "a": j.get("a"), "b": j.get("b"),
                                                               "lon": j["lon"], "lat": j["lat"]})
    # One junction per corner of the streets: points within 12 m are one (two OSM nodes of a
    # divided street's crossing).
    kept: list[dict[str, Any]] = []
    for j in junctions.values():
        if not any(math.hypot(k["x"] - j["x"], k["y"] - j["y"]) < 12 for k in kept):
            kept.append(j)
    ev.junctions = kept
    for cell in sorted((root / "docs/cells/sf-corridor-official").glob("*.json")):
        data = json.loads(cell.read_text())
        for _, line in data.get("curb_lines", []):
            if inb(line["p"]):
                ev.kerbs.append(to(line["p"]))
        for _, ramp in data.get("curb_ramps", []):
            if _in_bbox(ramp["p"][0], ramp["p"][1], bbox):
                ev.ramps.append(frame.xy(*ramp["p"]))
    pw = root / "data/sf_public_works"
    lidar_read: list[list[tuple[float, float]]] = []
    for line in json.loads((pw / "medians_lidar.json").read_text())["lines"]:
        if not inb(line["p"]):
            continue
        lidar_read.append(_resample(to(line["p"]), 2.0))
        if (line.get("rise_m") or 0) >= 0.05:
            ev.lidar_medians.append(to(line["p"]))
        else:
            ev.lidar_flat.append(to(line["p"]))
    for c in json.loads((pw / "crosswalks.json").read_text()):
        if _in_bbox(c["p"][0], c["p"][1], bbox):
            ev.crosswalks.append(frame.xy(*c["p"]))
    for st in json.loads((pw / "stop_signs.json").read_text()):
        coords = (st.get("shape") or st.get("point") or {}).get("coordinates")
        if not coords:
            continue
        lon, lat = coords
        if _in_bbox(lon, lat, bbox):
            ev.stop_signs.append(frame.xy(lon, lat))
    # The city's centreline network: a node is where two or more of its lines end.
    ends: dict[tuple[int, int], list[tuple[float, float, float]]] = {}
    for line in json.loads((pw / "centrelines.json").read_text()):
        pts = line["points"]
        if not inb(pts):
            continue
        xy = to(pts)
        for end, _nxt in ((xy[0], xy[1]), (xy[-1], xy[-2])):
            ends.setdefault((round(end[0] / 2), round(end[1] / 2)), []).append(end)
    for group in ends.values():
        if len(group) >= 2:
            ev.centreline_nodes.append((sum(p[0] for p in group) / len(group),
                                        sum(p[1] for p in group) / len(group), len(group)))
    isl = json.loads((root / "docs/sf-corridor-islands.json").read_text())
    for k, island in enumerate(isl.get("islands", [])):
        if not inb(island["p"]):
            continue
        ring = to(island["p"])
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        lon = sum(p[0] for p in island["p"]) / len(island["p"])
        lat = sum(p[1] for p in island["p"]) / len(island["p"])
        covered = any(math.hypot(x - cx, y - cy) < 15 for line in lidar_read for x, y in line)
        ev.islands.append({"id": k, "ring": ring, "x": cx, "y": cy, "lon": lon, "lat": lat, "lidar_covered": covered,
                           "lines": island.get("lines") or [], "basis": island_basis(island),
                           "survey_basis": island.get("basis"), "area_m2": round(_ring_area(ring), 1)})
    return ev, frame


def band(p: float) -> str:
    return "high" if p >= 0.8 else "medium" if p >= 0.55 else "low"


def build(root: Path) -> dict[str, Any]:
    ev, _ = load_evidence(root)
    islands = []
    for island in ev.islands:
        p, e = island_confidence(island, ev)
        island["p"] = p
        islands.append({"id": island["id"], "lon": round(island["lon"], 7), "lat": round(island["lat"], 7),
                        "lines": island["lines"], "basis": island["basis"], "area_m2": island["area_m2"],
                        "confidence": round(p, 3), "band": band(round(p, 3)),
                        "evidence": {k: round(v, 2) for k, v in e.items()}})
    junctions = []
    for j in ev.junctions:
        p, e = intersection_confidence(j, ev)
        j["p"] = p
        junctions.append({"streets": [j["a"], j["b"]], "lon": round(j["lon"], 7), "lat": round(j["lat"], 7),
                          "legs": j.get("legs"), "confidence": round(p, 3), "band": band(round(p, 3)),
                          "evidence": {k: round(v, 2) for k, v in e.items()}})
    jscores = [(j["x"], j["y"], j["p"]) for j in ev.junctions]
    iscores = [(i["x"], i["y"], i["p"]) for i in ev.islands]
    for out, src in zip(junctions, ev.junctions, strict=False):
        a, parts = area_confidence(src["x"], src["y"], ev, jscores, iscores)
        out["area_confidence"] = round(a, 3)
        out["area_band"] = band(round(a, 3))
        out["area_evidence"] = {k: round(v, 2) for k, v in parts.items()}
    for out, src in zip(islands, ev.islands, strict=False):
        a, parts = area_confidence(src["x"], src["y"], ev, jscores, iscores)
        out["area_confidence"] = round(a, 3)
        out["area_band"] = band(round(a, 3))
        out["area_evidence"] = {k: round(v, 2) for k, v in parts.items()}
    summary = {
        "intersections": len(junctions),
        "islands": len(islands),
        "bands": {
            "intersections": {b: sum(1 for j in junctions if j["band"] == b) for b in ("high", "medium", "low")},
            "islands": {b: sum(1 for i in islands if i["band"] == b) for b in ("high", "medium", "low")},
        },
    }
    return {
        "schema": "kerbside.marina_confidence/1",
        "bbox": list(MARINA_BBOX),
        "area_radius_m": AREA_RADIUS_M,
        "about": (__doc__ or "").strip().split("\n\n")[0],
        "weights": {"islands": {"priors": ISLAND_PRIORS, "evidence": ISLAND_WEIGHTS},
                    "intersections": JUNCTION_WEIGHTS},
        "summary": summary,
        "calibration": calibration(ev),
        "intersections": junctions,
        "islands": islands,
    }
