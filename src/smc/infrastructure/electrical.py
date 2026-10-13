"""Which observed poles are electrically connected: PG&E's network, the poles, the photographs.

Connectivity is never ``pole -> nearest pole``. PG&E's GRIP LineDetail polylines say where
distribution line sections run. Each observed pole is placed on the sections that pass within
an *empirically calibrated* tolerance, and two poles are candidates for a span only when they
are next to each other along that network: walking the line from one pole, the other is the
first pole reached on that branch. A junction connects only the branches the network has.

GRIP has no overhead/underground field, so a candidate is not a wire. A span is drawn only when
photographs show a conductor where the span would be seen, tested by projecting the span into
each image against Mapillary's own segmentation, with a sham span turned through ninety degrees
as the control. Open sky exactly where the conductor would have to be is evidence that there is
none (undergrounded, or the poles are not connected). Logical spans are kept apart from the
catenaries the renderer hangs between them.
"""

from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from dataclasses import dataclass
from itertools import pairwise

import numpy as np

#: The two conductor bands seen from the street. Primary distribution sits at the top of a
#: San Francisco pole (crossarm and insulators, roughly 8.5-12.5 m); communications cables
#: are attached lower down (roughly 4.5-7 m). A band, not a height: pole heights are unknown.
ELECTRICAL_BAND_M = (7.4, 12.8)
TELECOM_BAND_M = (4.4, 6.9)
CAMERA_HEIGHT_M = 2.0
#: Shorter than this, two "poles" are almost always one pole detected twice (or a pole and the
#: streetlight beside it), not the two ends of a span.
MIN_SPAN_M, MAX_SPAN_M = 12.0, 95.0
#: Photograph-triangulated pole detections this close together are one physical pole.
MERGE_POLES_M = 6.0
#: Walking the network from a pole, how far to look for the next pole.
MAX_WALK_M = 110.0
#: A pole this far to one side of the line's drawn route is on that side of the street.
SIDE_M = 2.5


@dataclass(frozen=True)
class Frame:
    lon0: float
    lat0: float

    @property
    def kx(self) -> float:
        return 111_320.0 * math.cos(math.radians(self.lat0))

    @property
    def ky(self) -> float:
        return 110_540.0

    def xy(self, lonlat) -> tuple[float, float]:
        return ((lonlat[0] - self.lon0) * self.kx, (lonlat[1] - self.lat0) * self.ky)

    def lonlat(self, x: float, y: float) -> list[float]:
        return [round(self.lon0 + x / self.kx, 7), round(self.lat0 + y / self.ky, 7)]


def project(point, polyline) -> dict:
    """Closest point of a polyline: offset, distance along, and which side (+left/-right)."""
    along, best = 0.0, None
    for a, b in pairwise(polyline):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if length <= 0:
            continue
        t = max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length ** 2))
        x, y = a[0] + t * dx, a[1] + t * dy
        offset = math.hypot(point[0] - x, point[1] - y)
        if best is None or offset < best["offset_m"]:
            side = (dx * (point[1] - a[1]) - dy * (point[0] - a[0])) / length
            best = {"offset_m": offset, "along_m": along + t * length, "side_m": side}
        along += length
    if best is None:
        raise ValueError("zero-length route")
    return best


def _segments(paths: list[list]) -> np.ndarray:
    return np.vstack([np.hstack([np.asarray(p[:-1]), np.asarray(p[1:])]) for p in paths if len(p) > 1])


def nearest_offsets(points: np.ndarray, segments: np.ndarray, chunk: int = 256) -> np.ndarray:
    a, b = segments[:, :2], segments[:, 2:]
    d = b - a
    l2 = (d ** 2).sum(1) + 1e-12
    out = np.empty(len(points))
    for i in range(0, len(points), chunk):
        p = points[i:i + chunk, None, :]
        t = np.clip(((p - a) * d).sum(2) / l2, 0, 1)
        c = a + d * t[..., None]
        out[i:i + chunk] = np.sqrt(((p - c) ** 2).sum(2)).min(1)
    return out


def calibrate(poles: np.ndarray, paths: list[list], *, max_m: int = 16, ratio_floor: float = 1.5,
              sample: int = 4000, seed: int = 7) -> dict:
    """The matching tolerance, measured rather than assumed.

    Real pole-to-route offsets are compared with offsets to the *same* network shifted a few
    tens of metres in odd directions (a null in which the network still follows streets but has
    no relation to these poles). Where the real distribution stops exceeding the null by
    ``ratio_floor`` is where a pole stops being evidence of that route.
    """
    if len(poles) == 0 or not paths:
        return {"status": "no_data", "threshold_m": None}
    rng = np.random.default_rng(seed)
    pick = poles[rng.choice(len(poles), min(sample, len(poles)), replace=False)]
    segments = _segments(paths)
    real = nearest_offsets(pick, segments)
    shifts = [(37, 0.4), (61, 1.9), (83, 3.3), (47, 4.6), (71, 5.6)]
    null = np.concatenate([
        nearest_offsets(pick, segments + np.tile([r * math.cos(a), r * math.sin(a)], 2))
        for r, a in shifts])
    bins = np.arange(0, max_m + 1, 1.0)
    real_hist = np.histogram(real, bins)[0].astype(float)
    null_hist = np.histogram(null, bins)[0] / len(shifts)
    ratio = real_hist / np.maximum(null_hist, 1)
    smooth = np.convolve(ratio, np.ones(3) / 3, mode="same")
    if smooth[:4].mean() < ratio_floor:
        return {"status": "no_association", "threshold_m": None, "ratio": ratio.round(2).tolist()}
    threshold = next((float(b) for b in range(3, max_m) if smooth[b] < ratio_floor), float(max_m))
    threshold = min(max(threshold, 4.0), 12.0)
    return {
        "status": "calibrated", "threshold_m": threshold, "basis": "real_vs_shifted_network_null",
        "ratio_floor": ratio_floor, "samples": len(pick), "bins_m": bins[:-1].tolist(),
        "real": real_hist.astype(int).tolist(), "null": np.round(null_hist, 1).tolist(),
        "ratio": ratio.round(2).tolist(),
    }


class Network:
    """GRIP line sections as a graph: a section's ends join others of the same feeder."""

    def __init__(self, lines: list[dict], frame: Frame, snap_m: float = 1.5):
        self.edges = []
        for line in lines:
            pts = [frame.xy(p) for p in line["points"]]
            length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in pairwise(pts))
            if length < 0.5:
                continue
            self.edges.append({**line, "xy": pts, "length": length, "stations": []})
        grid: dict[tuple, list] = defaultdict(list)
        self.nodes: list[list] = []  # node -> [(edge index, end 0|1)]
        self.ends: dict[tuple[int, int], int] = {}
        for i, edge in enumerate(self.edges):
            for end, (x, y) in ((0, edge["xy"][0]), (1, edge["xy"][-1])):
                key = (int(x // snap_m), int(y // snap_m))
                node = None
                for gx in (key[0] - 1, key[0], key[0] + 1):
                    for gy in (key[1] - 1, key[1], key[1] + 1):
                        for candidate, cx, cy, feeder in grid[(gx, gy)]:
                            if feeder == edge.get("feeder_id") and math.hypot(cx - x, cy - y) <= snap_m:
                                node = candidate
                if node is None:
                    node = len(self.nodes)
                    self.nodes.append([])
                    grid[key].append((node, x, y, edge.get("feeder_id")))
                self.nodes[node].append((i, end))
                self.ends[(i, end)] = node
        self.cell = 40.0
        self.index: dict[tuple, set] = defaultdict(set)
        for i, edge in enumerate(self.edges):
            for a, b in pairwise(edge["xy"]):
                for gx in range(int(min(a[0], b[0]) // self.cell) - 1, int(max(a[0], b[0]) // self.cell) + 2):
                    for gy in range(int(min(a[1], b[1]) // self.cell) - 1, int(max(a[1], b[1]) // self.cell) + 2):
                        self.index[(gx, gy)].add(i)

    def near(self, x: float, y: float) -> set:
        return self.index.get((int(x // self.cell), int(y // self.cell)), set())


def merge_duplicate_poles(poles: list[dict], radius_m: float = MERGE_POLES_M) -> tuple[list[dict], dict]:
    """One record per physical pole.

    Mapillary places a map feature per detection cluster, and one pole is often several
    features a few metres apart (nearest-neighbour distances peak at 3-4 m, far closer than
    poles stand). Mapped (OpenStreetMap) poles anchor their clusters; each cluster is
    represented by the existing record nearest its centre, so its id is still a pole the
    page draws. Returns the representatives and {member id: representative id}.
    """
    order = sorted(poles, key=lambda p: (not str(p["id"]).startswith("osm:"), str(p["id"])))
    clusters: list[dict] = []
    grid: dict[tuple, list] = defaultdict(list)
    for pole in order:
        x, y = pole["xy"]
        key = (int(x // radius_m), int(y // radius_m))
        home = None
        for gx in (key[0] - 1, key[0], key[0] + 1):
            for gy in (key[1] - 1, key[1], key[1] + 1):
                for cluster in grid[(gx, gy)]:
                    cx, cy = cluster["seed"]
                    if math.hypot(cx - x, cy - y) <= radius_m and (home is None or math.hypot(
                            cx - x, cy - y) < math.hypot(home["seed"][0] - x, home["seed"][1] - y)):
                        home = cluster
        if home is None:
            home = {"seed": (x, y), "members": []}
            clusters.append(home)
            grid[key].append(home)
        home["members"].append(pole)
    representatives, alias = [], {}
    for cluster in clusters:
        members = cluster["members"]
        mx = sum(m["xy"][0] for m in members) / len(members)
        my = sum(m["xy"][1] for m in members) / len(members)
        osm = [m for m in members if str(m["id"]).startswith("osm:")]
        pick = min(osm or members, key=lambda m: math.hypot(m["xy"][0] - mx, m["xy"][1] - my))
        representatives.append({**pick, "detections": len(members)})
        for m in members:
            alias[m["id"]] = pick["id"]
    return representatives, alias


def match_poles(network: Network, poles: list[dict], threshold_m: float,
                rival_m: float = 2.0) -> dict:
    """Place each pole on every route within the tolerance, keeping only near-best routes.

    A pole that is near-equally close to two different feeders is ambiguous: a junction or a
    parallel route. It keeps both memberships and its spans need stronger photographic proof.
    """
    ambiguous = set()
    for pole in poles:
        x, y = pole["xy"]
        choices = []
        for i in network.near(x, y):
            projection = project((x, y), network.edges[i]["xy"])
            if projection["offset_m"] <= threshold_m:
                choices.append((projection["offset_m"], i, projection))
        if not choices:
            continue
        best = min(c[0] for c in choices)
        kept = [c for c in choices if c[0] <= best + rival_m]
        feeders = {network.edges[i].get("feeder_id") for _, i, _ in kept}
        if len(feeders) > 1:
            ambiguous.add(pole["id"])
        for _, i, projection in kept:
            network.edges[i]["stations"].append({"pole": pole["id"], **projection})
    for edge in network.edges:
        edge["stations"].sort(key=lambda s: (s["along_m"], s["pole"]))
    return {"ambiguous": ambiguous,
            "matched": {s["pole"] for e in network.edges for s in e["stations"]}}


def _side(station: dict) -> int:
    return 0 if abs(station["side_m"]) <= SIDE_M else (1 if station["side_m"] > 0 else -1)


def _walk(network: Network, edge_index: int, along: float, direction: int, side: int,
          skip: str) -> list[tuple[dict, float, int, list]]:
    """The first pole on each branch, walking the network from a station in one direction.

    Returns (station, network distance, edge, edges walked). Poles on the far side of the
    route are passed over unless nothing on this side is reached on that branch first.
    """
    found = []
    stack = [(edge_index, along, direction, 0.0, [edge_index])]
    seen = set()
    while stack:
        i, at, sense, walked, trail = stack.pop()
        if (i, sense) in seen and walked > 0:
            continue
        seen.add((i, sense))
        edge = network.edges[i]
        stations = [s for s in edge["stations"] if s["pole"] != skip
                    and (s["along_m"] > at + 1e-6 if sense > 0 else s["along_m"] < at - 1e-6)]
        stations.sort(key=lambda s: s["along_m"] * sense)
        same = [s for s in stations if side == 0 or _side(s) in (0, side)]
        pick = same[0] if same else (stations[0] if stations else None)
        if pick is not None:
            found.append((pick, walked + abs(pick["along_m"] - at), i, trail))
            continue
        walked += (edge["length"] - at) if sense > 0 else at
        if walked > MAX_WALK_M:
            continue
        node = network.ends[(i, 1 if sense > 0 else 0)]
        for j, end in network.nodes[node]:
            if j == i:
                continue
            stack.append((j, 0.0 if end == 0 else network.edges[j]["length"], 1 if end == 0 else -1,
                          walked, [*trail, j]))
    return found


def candidate_spans(network: Network, poles: dict, ambiguous: set) -> list[dict]:
    pairs: dict[tuple, dict] = {}
    for i, edge in enumerate(network.edges):
        for station in edge["stations"]:
            side = _side(station)
            for direction in (1, -1):
                for other, walked, j, trail in _walk(network, i, station["along_m"], direction, side,
                                                     station["pole"]):
                    a, b = poles[station["pole"]], poles[other["pole"]]
                    straight = math.hypot(a["xy"][0] - b["xy"][0], a["xy"][1] - b["xy"][1])
                    key = tuple(sorted((a["id"], b["id"])))
                    reasons = []
                    if not MIN_SPAN_M <= straight <= MAX_SPAN_M:
                        continue
                    if walked > 1.25 * straight + 6:
                        # The route turns a corner between them: a pole is missing at the bend.
                        continue
                    if side and _side(other) and _side(other) != side:
                        reasons.append("crosses_route")
                    if {a["id"], b["id"]} & ambiguous:
                        reasons.append("ambiguous_feeder_membership")
                    if len(trail) > 1:
                        reasons.append("spans_section_boundary")
                    first, last = network.edges[i], network.edges[j]
                    record = pairs.get(key)
                    if record is None or walked < record["network_m"]:
                        pairs[key] = {
                            "a": key[0], "b": key[1], "length_m": round(straight, 2),
                            "network_m": round(walked, 2), "flags": sorted(set(reasons)),
                            "feeder": first.get("feeder_id"),
                            "sections": sorted({str(first.get("line_section")), str(last.get("line_section"))}),
                            "phase_count": first.get("phase_count") or last.get("phase_count"),
                            "voltage_kv": first.get("voltage_kv") or last.get("voltage_kv"),
                            "grip_ids": sorted({first["id"], last["id"]}),
                        }
    return list(pairs.values())


# ---------------------------------------------------------------- photographic confirmation

def _project_view(view: dict, cam: tuple, point: tuple, height_m: float) -> tuple[float, float] | None:
    dx, dy = point[0] - cam[0], point[1] - cam[1]
    distance = math.hypot(dx, dy)
    if distance < 3.0 or distance > 45.0:
        return None
    bearing = math.degrees(math.atan2(dx, dy))
    delta = (bearing - view["compass"] + 540.0) % 360.0 - 180.0
    elevation = math.atan2(height_m - CAMERA_HEIGHT_M, distance)
    if view["camera"] == "spherical":
        return (0.5 + delta / 360.0) % 1.0, 0.5 - math.degrees(elevation) / 180.0
    rad = math.radians(delta)
    if math.cos(rad) < 0.3:
        return None
    width, height = view.get("width") or 4, view.get("height") or 3
    focal = view.get("focal") or 0.85
    scale = max(width, height)
    u = 0.5 + focal * scale / width * math.tan(rad)
    v = 0.5 - focal * scale / height * math.tan(elevation) / math.cos(rad)
    if not 0.02 <= u <= 0.98:
        return None
    return u, v


def _band(labels: np.ndarray, view: dict, cam, point, band, column_px: int = 1):
    top = _project_view(view, cam, point, band[1])
    bottom = _project_view(view, cam, point, band[0])
    if top is None or bottom is None:
        return None
    rows, cols = labels.shape
    c = int(top[0] * cols)
    r0, r1 = int(max(0.0, top[1]) * rows) - 2, int(min(1.0, bottom[1]) * rows) + 2
    if r1 <= max(r0, 0) or r0 >= rows:
        return None
    window = labels[max(r0, 0):min(r1, rows), max(c - column_px, 0):min(c + column_px + 1, cols)]
    if window.size == 0:
        return None
    return {"wire": bool((window == 2).any()), "sky": float((window == 1).mean())}


def _column_angle(view: dict, u: float) -> float:
    if view["camera"] == "spherical":
        return (u - 0.5) * 360.0
    width, height = view.get("width") or 4, view.get("height") or 3
    return math.degrees(math.atan((u - 0.5) * width / ((view.get("focal") or 0.85) * max(width, height))))


def register(view: dict, labels: np.ndarray, cam, poles_xy, search_deg: float = 7.0) -> float | None:
    """The heading correction that puts a segmented pole where an endpoint pole projects.

    Camera positions and photograph-triangulated poles are each a few metres out, which at
    street distances is degrees of heading and the difference between a wire and open sky.
    An endpoint registers when a segmented pole stands within ``search_deg`` of where it
    projects AND spans most of the height range it should: a pole far behind the projected
    one is short in the image and does not register. None when no endpoint registers.
    """
    rows, cols = labels.shape
    best = None
    for pole in poles_xy:
        base = _project_view(view, cam, pole, 0.3)
        top = _project_view(view, cam, pole, 8.5)
        if base is None or top is None:
            continue
        r0, r1 = max(0, int(top[1] * rows)), min(rows, int(base[1] * rows))
        if r1 - r0 < 4:
            continue
        expected = _column_angle(view, base[0])
        for c in range(cols):
            angle = _column_angle(view, (c + 0.5) / cols)
            shift = (angle - expected + 540) % 360 - 180
            if abs(shift) > search_deg:
                continue
            share = float((labels[r0:r1, c] == 9).mean())
            if share >= 0.4 and (best is None or abs(shift) < abs(best)):
                best = shift
    return best


def score_view(view: dict, labels: np.ndarray, frame: Frame, a_xy, b_xy) -> dict:
    """Does this photograph show a conductor along the span, and not along a sham span?"""
    cam = frame.xy(view["lonlat"])
    correction = register(view, labels, cam, [a_xy, b_xy])
    if correction is not None:
        view = {**view, "compass": view["compass"] + correction}
    column_px = 1 if view["camera"] == "spherical" else 2

    def run(p, q):
        tallies = {"in_view": 0, "electrical": 0, "telecom": 0, "clear_sky": 0}
        for t in (0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85):
            point = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
            upper = _band(labels, view, cam, point, ELECTRICAL_BAND_M, column_px)
            if upper is None:
                continue
            lower = _band(labels, view, cam, point, TELECOM_BAND_M, column_px)
            tallies["in_view"] += 1
            tallies["electrical"] += upper["wire"]
            tallies["telecom"] += bool(lower and lower["wire"])
            tallies["clear_sky"] += (not upper["wire"]) and upper["sky"] >= 0.9
        return tallies

    real = run(a_xy, b_xy)
    mx, my = (a_xy[0] + b_xy[0]) / 2, (a_xy[1] + b_xy[1]) / 2
    hx, hy = (b_xy[0] - a_xy[0]) / 2, (b_xy[1] - a_xy[1]) / 2
    sham = run((mx + hy, my - hx), (mx - hy, my + hx))
    n = real["in_view"]
    out = {"image": view["id"], "sequence": view.get("sequence"), "captured_at": view.get("captured_at"),
           "in_view": n, "electrical": real["electrical"], "telecom": real["telecom"],
           "clear_sky": real["clear_sky"], "sham_in_view": sham["in_view"],
           "sham_electrical": sham["electrical"], "sham_telecom": sham["telecom"],
           "registered": correction is not None,
           "heading_correction_deg": None if correction is None else round(correction, 1)}
    if n < 3:
        out["result"] = "not_in_view"
        return out

    def fraction(tally, key):
        return tally[key] / tally["in_view"] if tally["in_view"] else 0.0

    def beats_sham(key):
        # The sham span is the control. A photograph so full of wires that a span turned
        # through ninety degrees also "has" one shows nothing about this span. Unregistered,
        # the span may be drawn degrees from where it is, so it has to win by more.
        need, margin = (0.5, 0.3) if correction is not None else (0.75, 0.45)
        return fraction(real, key) >= need and fraction(real, key) - fraction(sham, key) >= margin

    if beats_sham("electrical"):
        out["result"] = "electrical"
    elif beats_sham("telecom"):
        out["result"] = "telecom"
    elif (correction is not None and real["electrical"] == 0 and real["telecom"] == 0
          and real["clear_sky"] / n >= 0.6):
        # Open sky where the conductor would have to be counts only in a registered view.
        out["result"] = "absent"
    else:
        out["result"] = "inconclusive"
    return out


def choose_images(index: list[dict], frame: Frame, a_xy, b_xy, limit: int = 5) -> list[dict]:
    """Up to ``limit`` photographs that look at the span, from different sequences first."""
    mx, my = (a_xy[0] + b_xy[0]) / 2, (a_xy[1] + b_xy[1]) / 2
    rows = []
    for image in index:
        x, y = image["xy"]
        distance = project((x, y), [a_xy, b_xy])["offset_m"]
        if not 3.0 <= distance <= 30.0:
            continue
        if image["camera"] != "spherical" and image.get("heading") is not None:
            bearing = math.degrees(math.atan2(mx - x, my - y))
            if abs((bearing - image["heading"] + 540) % 360 - 180) > 50:
                continue
        rows.append((distance, -(image.get("year") or 0), image))
    rows.sort(key=lambda r: (r[0], r[1]))
    chosen, sequences = [], set()
    for _, _, image in rows:
        if image.get("sequence") in sequences:
            continue
        sequences.add(image.get("sequence"))
        chosen.append(image)
        if len(chosen) == limit:
            return chosen
    for _, _, image in rows:
        if image not in chosen:
            chosen.append(image)
            if len(chosen) == limit:
                break
    return chosen


def decide(span: dict, views: list[dict], *, underground: bool = False) -> dict:
    """Status, wire type and confidence from network, poles and photographs.

    Network + two matched poles but no photograph is a *candidate* (~0.75) and is not drawn.
    One clear photograph confirms (~0.90); two independent sequences (~0.95). Open sky where
    the conductor would be, from two sequences and none showing it, rejects the span.
    """
    by_result: dict[str, set] = defaultdict(set)
    for view in views:
        by_result[view["result"]].add(view.get("sequence") or view["image"])
    positive = by_result["electrical"] | by_result["telecom"]
    absent = by_result["absent"] - positive
    flagged = bool(span["flags"])
    wire_type = ("electrical" if by_result["electrical"] else "telecom" if by_result["telecom"]
                 else "unknown_overhead")
    if underground:
        status, confidence = "rejected_underground", 0.0
    elif len(positive) >= 2 and len(positive) > len(absent):
        status, confidence = "confirmed", 0.88 if flagged else 0.95
    elif len(positive) == 1 and not absent and not flagged:
        status, confidence = "confirmed", 0.90
    elif len(positive) == 1 and not absent:
        status, confidence = "candidate", 0.70
    elif len(absent) >= 2 and not positive:
        status, confidence = "rejected_observed_absent", 0.10
    elif positive and absent:
        status, confidence = "conflicting", 0.50
    else:
        status, confidence = "candidate", 0.60 if flagged else 0.75
    return {"status": status, "confidence": confidence, "wire_type": wire_type,
            "positive_sequences": len(positive), "absent_sequences": len(absent),
            "render": status == "confirmed" and wire_type in {"electrical", "telecom"}}


def feeder_key(feeder) -> str | None:
    """Spans of one feeder group together without publishing PG&E's own feeder identifier."""
    if feeder in (None, ""):
        return None
    return hashlib.sha256(f"kerbside-feeder:{feeder}".encode()).hexdigest()[:10]
