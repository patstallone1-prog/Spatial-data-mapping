"""Generic interiors fitted to real buildings by their proportions, and the doors into them.

A layout template (:mod:`smc.interiors.schema`) is a real plan of somewhere else: a Swiss
apartment building, a single dwelling. Nothing says what is inside a building in San Francisco,
so what it is given is the plan whose *shape* fits it best -- not stretched to fit, which turns
a bedroom into a corridor, but chosen for its proportions and, where the building is several
plans long, repeated along it as real buildings repeat their units:

* every template is reduced to its ground storey in the frame of its own smallest enclosing
  rectangle, ``l`` by ``w`` (``l >= w``);
* a building's footprint gets the same rectangle, ``L`` by ``W``;
* each candidate is tried both ways round and tiled ``nx`` by ``ny`` times, nx = round(L / l);
  the stretch left is ``sx = L / (nx l)`` and ``sy = W / (ny w)``, and the template with the
  least ``|log sx| + |log sy|`` (a little against tiling and storey mismatch) wins;
* dwellings (ResPlan units) for houses -- small footprints, three storeys or fewer -- and whole
  buildings (Swiss Dwellings) for everything larger.

The stretch is recorded with every fit, so how well a building's proportions were met is a
number, not a claim. Everything here is ``inferred``: a stand-in for an interior nobody
surveyed, never presented as the building's own.

Doors, in order of evidence: an ``entrance`` a mapper put on the building's outline in
OpenStreetMap; a door or shopfront the facade survey photographed; otherwise one inferred at the
middle of the wall nearest a street.
"""

from __future__ import annotations

import gzip
import json
import math
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from smc.geometry.primitives import min_area_rectangle

#: A house is a footprint this small with this few storeys: it gets a dwelling, not a block.
HOUSE_MAX_AREA_M2 = 250.0
HOUSE_MAX_STOREYS = 3
#: Templates kept per source: chosen to cover every proportion and size the buildings have.
POOL_PER_SOURCE = 700
#: Small costs against repeating a plan and against a storey count unlike the building's.
TILE_PENALTY = 0.03
STOREY_PENALTY = 0.01
MIN_EDGE_M = 1.5
DOOR_WIDTH_M = 1.0
#: An OSM entrance this close to an outline edge belongs to that edge.
ENTRANCE_SNAP_M = 1.5
KINDS = ("living", "kitchen", "bedroom", "bathroom", "corridor", "stair", "storage", "balcony",
         "shaft", "elevator", "dining", "office", "commercial", "outdoor", "other")
SOURCE_CODES = {"osm": 0, "photo": 1, "inferred": 2}


@dataclass
class Template:
    """A template's ground storey in its own rectangle's frame (x along ``l``)."""

    id: str
    source: str
    license: str
    attribution: str
    length: float
    width: float
    area: float
    storeys: int
    storey_h: float
    rooms: list[tuple[str, np.ndarray]]
    doors: list[tuple[float, float, float, float]]   # x, y, width, angle (rad)
    quality: float = 0.0
    extra: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        def flat(poly: np.ndarray) -> list[int]:
            return [round(float(v) * 100) for v in poly.ravel()]

        return {"id": self.id, "src": self.source,
                "l": round(self.length, 2), "w": round(self.width, 2),
                "storeys": self.storeys, "storey_h": round(self.storey_h, 2),
                "rooms": [[KINDS.index(k if k in KINDS else "other"), flat(p)]
                          for k, p in self.rooms],
                "doors": [[round(x, 2), round(y, 2), round(wd, 2), round(a, 3)]
                          for x, y, wd, a in self.doors]}


def _simplify(poly: np.ndarray, tol: float = 0.05) -> np.ndarray:
    """Drop vertices that lie within ``tol`` of the line through their neighbours."""
    pts = poly
    changed = True
    while changed and len(pts) > 3:
        changed = False
        keep = []
        n = len(pts)
        for i in range(n):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
            ab, ac = b - a, c - a
            length = np.hypot(*ac)
            off = abs(ab[0] * ac[1] - ab[1] * ac[0]) / length if length > 1e-9 else 0.0
            if off < tol and len(pts) - (n - len(keep) - 1) > 3 and keep and i < n - 1:
                changed = True
                continue
            keep.append(b)
        pts = np.asarray(keep)
    return pts


def normalise(raw: dict) -> Template | None:
    """A template record (``templates.jsonl.gz`` line) as its ground storey in rectangle frame."""
    storeys = raw.get("storeys") or []
    if not storeys:
        return None
    ground = min(storeys, key=lambda s: s.get("level", 0))
    rooms = [(r["kind"], np.asarray(r["poly"], float)) for r in ground.get("rooms", [])
             if len(r.get("poly", [])) >= 3]
    if not rooms:
        return None
    outline = np.vstack([p for _, p in rooms]
                        + [np.asarray(s["poly"], float) for s in ground.get("structure", [])
                           if len(s.get("poly", [])) >= 3])
    centre, yaw, length, width = min_area_rectangle(outline)
    if width > length:
        length, width, yaw = width, length, yaw + math.pi / 2
    if width < MIN_EDGE_M:
        return None
    c, s = math.cos(-yaw), math.sin(-yaw)

    def local(poly: np.ndarray) -> np.ndarray:
        d = poly - centre
        return np.column_stack([c * d[:, 0] - s * d[:, 1], s * d[:, 0] + c * d[:, 1]])

    doors = []
    for opening in ground.get("openings", []):
        if opening.get("kind") not in ("door", "entrance") or len(opening.get("poly", [])) < 3:
            continue
        poly = local(np.asarray(opening["poly"], float))
        oc, oyaw, ol, ow = min_area_rectangle(poly)
        if ow > ol:
            ol, oyaw = ow, oyaw + math.pi / 2
        doors.append((float(oc[0]), float(oc[1]), float(opening.get("width") or ol),
                      float(oyaw)))
    descriptors = raw.get("descriptors") or {}
    heights = [h for h in descriptors.get("storey_heights_m") or [] if h]
    kinds = {k for k, _ in rooms}
    # A plan with named living rooms and doors is a better stand-in than one of shafts.
    quality = len(doors) * 0.2 + len(kinds & {"living", "kitchen", "bedroom", "bathroom"}) \
        - 0.05 * sum(1 for k, _ in rooms if k == "shaft")
    return Template(
        id=raw["id"], source=raw["source"], license=raw.get("license", ""),
        attribution=raw.get("attribution", ""), length=float(length), width=float(width),
        area=float(length * width), storeys=int(descriptors.get("storeys") or len(storeys)),
        storey_h=float(np.median(heights)) if heights else 2.8,
        rooms=[(k, np.round(_simplify(local(p)), 2)) for k, p in rooms], doors=doors,
        quality=quality)


def read_templates(path: Path) -> Iterator[Template]:
    with gzip.open(path, "rt") as stream:
        for line in stream:
            template = normalise(json.loads(line))
            if template is not None:
                yield template


def pool(templates: Iterable[Template], size: int = POOL_PER_SOURCE) -> list[Template]:
    """At most ``size`` templates covering the spread of proportions and sizes: binned by aspect
    ratio and log area, the best of each bin first, round-robin until full."""
    bins: dict[tuple[int, int], list[Template]] = {}
    for t in templates:
        key = (int(min(t.length / t.width, 4.0) * 4), int(math.log(max(t.area, 1.0)) * 4))
        bins.setdefault(key, []).append(t)
    for members in bins.values():
        members.sort(key=lambda t: -t.quality)
    chosen: list[Template] = []
    depth = 0
    while len(chosen) < size and any(len(m) > depth for m in bins.values()):
        for members in bins.values():
            if len(members) > depth and len(chosen) < size:
                chosen.append(members[depth])
        depth += 1
    return chosen


@dataclass(frozen=True)
class Fit:
    template: int
    rotated: bool
    nx: int
    ny: int
    sx: float
    sy: float
    cost: float


def best_fit(length: float, width: float, storeys: int, library: list[Template],
             candidates: np.ndarray) -> Fit:
    """The template (index into ``library``, among ``candidates``) that fits an L x W
    rectangle with the least stretch, tiled and either way round."""
    ls = np.array([library[i].length for i in candidates])
    ws = np.array([library[i].width for i in candidates])
    st = np.array([library[i].storeys for i in candidates])
    best: Fit | None = None
    for rotated, along, across in ((False, ls, ws), (True, ws, ls)):
        nx = np.maximum(1, np.round(length / along))
        ny = np.maximum(1, np.round(width / across))
        sx = length / (nx * along)
        sy = width / (ny * across)
        cost = (np.abs(np.log(sx)) + np.abs(np.log(sy)) + TILE_PENALTY * (nx * ny - 1)
                + STOREY_PENALTY * np.abs(st - storeys))
        k = int(np.argmin(cost))
        if best is None or cost[k] < best.cost:
            best = Fit(int(candidates[k]), rotated, int(nx[k]), int(ny[k]), float(sx[k]),
                       float(sy[k]), float(cost[k]))
    assert best is not None
    return best


def footprint_rectangle(local: np.ndarray) -> tuple[np.ndarray, float, float, float]:
    centre, yaw, length, width = min_area_rectangle(local)
    if width > length:
        length, width, yaw = width, length, yaw + math.pi / 2
    return centre, yaw, length, width


def ring_area(ring: np.ndarray) -> float:
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * abs(float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)))


def nearest_edge(ring: np.ndarray, point: np.ndarray) -> tuple[int, float, float]:
    """(edge index i -- from ring[i] to ring[i+1] --, t along it, distance) nearest a point."""
    best = (0, 0.5, math.inf)
    for i in range(len(ring) - 1):
        a, b = ring[i], ring[i + 1]
        ab = b - a
        denom = float(ab @ ab)
        if denom < 1e-9:
            continue
        t = float(np.clip((point - a) @ ab / denom, 0.0, 1.0))
        d = float(np.hypot(*(a + ab * t - point)))
        if d < best[2]:
            best = (i, t, d)
    return best


def door_edges(ring: np.ndarray, street_points: np.ndarray) -> list[int]:
    """Outline edges (at least 2 m long) in the order a door is most likely on them: nearest a
    street first, a long edge facing the street before a short one a little closer."""
    scored = []
    for i in range(len(ring) - 1):
        a, b = ring[i], ring[i + 1]
        length = float(np.hypot(*(b - a)))
        if length < 2.0:
            continue
        mid = (a + b) / 2
        d = float(np.min(np.hypot(*(street_points - mid).T))) if len(street_points) else 0.0
        scored.append((d - 0.2 * min(length, 15.0), i))
    return [i for _, i in sorted(scored)]


def point_in_ring(ring: np.ndarray, x: float, y: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def outside_point(ring: np.ndarray, edge: int, t: float, out_m: float = 0.8) -> np.ndarray:
    """The point ``out_m`` outside the outline from (edge, t)."""
    a, b = ring[edge], ring[edge + 1]
    d = b - a
    n = np.array([-d[1], d[0]]) / max(float(np.hypot(*d)), 1e-9)
    p = a + d * t
    if point_in_ring(ring, *(p + n * 0.3)):
        n = -n
    return p + n * out_m
