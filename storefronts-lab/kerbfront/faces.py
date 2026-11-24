"""Building faces: which footprint edges front which street, and which way they look.

A face is one simplified footprint edge, counter-clockwise, so its outward normal is the right
hand of the edge direction. An edge is *exposed* when points just outside it are not inside a
neighbouring footprint (otherwise it is a party wall); an exposed edge is a *street face* when
a ray along its normal meets a named street centreline within ``STREET_RANGE_M`` that runs
roughly parallel to it. Photo filters score frames against these faces.
"""

from __future__ import annotations

import ast
import json
import math
from dataclasses import asdict, dataclass

from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import nearest_points
from shapely.strtree import STRtree

from .geo import Frame, bearing, ccw, unit
from .normalize import street_key

STREET_RANGE_M = 45.0
PARALLEL_DEG = 30.0
MIN_EDGE_M = 1.5


@dataclass
class Building:
    id: str
    poly: Polygon               # local metres
    height_m: float | None
    ground_m: float | None
    mblr: str | None
    source: str = "datasf:ynuv-fyni"


@dataclass
class Face:
    id: str
    building_id: str
    edge: int
    p0: tuple[float, float]
    p1: tuple[float, float]
    length_m: float
    edge_bearing: float
    normal_bearing: float
    role: str                    # street | open | party
    street: str | None
    street_dist_m: float | None
    exposed: float

    @property
    def mid(self) -> tuple[float, float]:
        return ((self.p0[0] + self.p1[0]) / 2, (self.p0[1] + self.p1[1]) / 2)

    @property
    def normal(self) -> tuple[float, float]:
        tx, ty = unit(self.p1[0] - self.p0[0], self.p1[1] - self.p0[1])
        return ty, -tx

    def to_json(self) -> dict:
        d = asdict(self)
        d["p0"] = [round(v, 3) for v in self.p0]
        d["p1"] = [round(v, 3) for v in self.p1]
        return d


def _geom(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return ast.literal_eval(value)


def buildings_from_datasf(rows: list[dict], frame: Frame) -> list[Building]:
    out = []
    for r in rows:
        g = shape(_geom(r["shape"]))
        polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        big = max(polys, key=lambda p: p.area)
        ring = [frame.xy(x, y) for x, y in big.exterior.coords]
        poly = Polygon(ring)
        if not poly.is_valid:
            poly = poly.buffer(0)
            if poly.geom_type != "Polygon":
                continue
        h = r.get("hgt_median_m")
        out.append(Building(r["sf16_bldgid"], poly, float(h) if h else None,
                            float(r["gnd_min_m"]) if r.get("gnd_min_m") else None, r.get("mblr")))
    return out


def streets_from_osm(streets: list[dict], frame: Frame) -> list[tuple[str, LineString]]:
    out = []
    for s in streets:
        name = street_key(s["tags"].get("name"))
        if name and len(s["geometry"]) >= 2:
            out.append((name, LineString([frame.xy(x, y) for x, y in s["geometry"]])))
    return out


def _simplified_ring(poly: Polygon) -> list[tuple[float, float]]:
    simple = poly.simplify(0.3, preserve_topology=True)
    if simple.geom_type != "Polygon" or simple.is_empty:
        simple = poly
    return ccw(list(simple.exterior.coords))


def faces_of(b: Building, neighbours: STRtree, neighbour_polys: list[Polygon],
             streets: list[tuple[str, LineString]], street_tree: STRtree | None) -> list[Face]:
    ring = _simplified_ring(b.poly)
    faces = []
    for i, p0 in enumerate(ring):
        p1 = ring[(i + 1) % len(ring)]
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if L < MIN_EDGE_M:
            continue
        tx, ty = unit(p1[0] - p0[0], p1[1] - p0[1])
        nx, ny = ty, -tx
        # exposure: points 0.6 m outside the edge that fall in no other footprint
        free = 0
        samples = 5
        for k in range(samples):
            f = 0.1 + 0.8 * k / (samples - 1)
            q = Point(p0[0] + tx * L * f + nx * 0.6, p0[1] + ty * L * f + ny * 0.6)
            hits = [neighbour_polys[j] for j in neighbours.query(q)]
            if not any(h.contains(q) and h is not b.poly for h in hits):
                free += 1
        exposed = free / samples
        mx, my = p0[0] + tx * L / 2, p0[1] + ty * L / 2
        street, dist = None, None
        if exposed >= 0.5 and street_tree is not None:
            ray = LineString([(mx, my), (mx + nx * STREET_RANGE_M, my + ny * STREET_RANGE_M)])
            for j in street_tree.query(ray):
                name, line = streets[j]
                inter = ray.intersection(line)
                if inter.is_empty:
                    continue
                hit = nearest_points(Point(mx, my), inter)[1]
                d = Point(mx, my).distance(hit)
                # local street direction at the crossing
                s = line.project(hit)
                a, c = line.interpolate(max(0, s - 3)), line.interpolate(s + 3)
                sb = bearing(c.x - a.x, c.y - a.y)
                eb = bearing(tx, ty)
                off = abs(((sb - eb + 90) % 180) - 90)
                if off <= PARALLEL_DEG and (dist is None or d < dist):
                    street, dist = name, d
        role = "street" if street else ("open" if exposed >= 0.5 else "party")
        faces.append(Face(f"{b.id}:{i}", b.id, i, p0, p1, L, bearing(tx, ty), bearing(nx, ny),
                          role, street, round(dist, 2) if dist is not None else None, exposed))
    return faces


def build_faces(buildings: list[Building], streets: list[tuple[str, LineString]]) -> list[Face]:
    polys = [b.poly for b in buildings]
    tree = STRtree(polys)
    st = STRtree([s[1] for s in streets]) if streets else None
    out = []
    for b in buildings:
        out.extend(faces_of(b, tree, polys, streets, st))
    return out
