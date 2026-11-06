"""Toll plazas and toll gantries on the Bay's bridges and freeways, from OpenStreetMap.

What is mapped, and well, is where the tolls are taken:

* ``highway=toll_gantry``: the overhead readers that take every Bay Area bridge toll since the
  bridges went to all-electronic tolling (the Bay Area Toll Authority's seven state-owned
  bridges and the Golden Gate). Mapped as a point on the carriageway, named for the bridge.
* ``barrier=toll_booth``: a booth, as a point on a lane, or as an outline (the booth's own
  ``building=yes``), and the plaza's canopy over the lanes (``building=roof``, usually with
  ``layer=1``).

Neither carries which way the traffic runs or how wide the road is. Those come from the
freeway the gantry or booth stands on: the nearest motorway, trunk, primary or link way within
reach, its bearing at that point, and its lanes (``lanes``, else a class default). A booth
point only counts as a road toll when it stands on such a road or within reach of a bridge's
gantry; the rest of ``barrier=toll_booth`` in OpenStreetMap is park and car-park entrances.

Every record says it is inferred and from which OpenStreetMap elements; none is a measurement
of a structure. The geometry drawn is the Caltrans standard (6.1 m clearance under a gantry,
3.66 m lanes, a booth on a raised island with an impact attenuator at its nose).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import pairwise

from .signs import LANE_M, _bearing, _dist, _lanes

ROADS = {"motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"}
#: A gantry or booth this close to a road's centreline stands on it.
ON_ROAD_M = 25.0
#: A booth this close to a bridge's gantry is part of that bridge's plaza.
PLAZA_REACH_M = 900.0
#: Booths this close together are one plaza.
PLAZA_CLUSTER_M = 160.0
BASIS = ("inferred: OpenStreetMap toll_gantry / toll_booth elements, oriented and sized from the "
         "freeway they stand on; drawn to Caltrans standard dimensions, not surveyed")


@dataclass
class TollOsm:
    """The roads near the tolls and the toll elements themselves."""
    nodes: dict[int, tuple[float, float]] = field(default_factory=dict)
    roads: dict[int, dict] = field(default_factory=dict)            # way id -> {tags, nodes}
    gantries: list[dict] = field(default_factory=list)              # {id, p, tags}
    booths: list[dict] = field(default_factory=list)                # {id, p, tags}
    booth_ways: list[dict] = field(default_factory=list)            # {id, points, tags}


def _project(p, a, b) -> tuple[float, float]:
    """Distance from p to segment ab in metres, and t along it."""
    k = 111320.0
    c = math.cos(math.radians(p[1]))
    ax, ay = (a[0] - p[0]) * k * c, (a[1] - p[1]) * k
    bx, by = (b[0] - p[0]) * k * c, (b[1] - p[1]) * k
    dx, dy = bx - ax, by - ay
    n = dx * dx + dy * dy
    t = 0.0 if n == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / n))
    return math.hypot(ax + dx * t, ay + dy * t), t


def nearest_road(osm: TollOsm, p, reach: float = ON_ROAD_M) -> dict | None:
    """The road way under p: its id, bearing there, lanes and distance."""
    best = None
    for wid, way in osm.roads.items():
        pts = [osm.nodes[n] for n in way["nodes"] if n in osm.nodes]
        for a, b in pairwise(pts):
            if abs(a[1] - p[1]) > 0.01 and abs(b[1] - p[1]) > 0.01:
                continue
            d, _t = _project(p, a, b)
            if d <= reach and (best is None or d < best["d"]):
                best = {"way": wid, "d": d, "bearing": _bearing(a, b), "tags": way["tags"]}
    return best


def _width(tags: dict) -> float:
    return round(_lanes(tags) * LANE_M, 1)


def _road_fields(road: dict | None) -> dict:
    if not road:
        return {}
    tags = road["tags"]
    return {"bearing": round(road["bearing"], 1), "lanes": _lanes(tags), "width_m": _width(tags),
            "road": tags.get("ref") or tags.get("name"), "road_way": road["way"],
            "deck": tags.get("bridge") not in (None, "no")}


def _centroid(points):
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def infer_tolls(osm: TollOsm) -> list[dict]:
    """Gantries, booths (grouped into plazas) and plaza canopies, as records the page draws."""
    out: list[dict] = []
    named_gantries = []
    for g in osm.gantries:
        road = nearest_road(osm, g["p"])
        if road is None:
            continue
        name = g["tags"].get("name")
        out.append({"id": f"gantry/{g['id']}", "kind": "toll_gantry", "p": [round(g["p"][0], 7), round(g["p"][1], 7)],
                    "name": name, "operator": g["tags"].get("operator"), **_road_fields(road),
                    "source": {"node": g["id"]}, "basis": BASIS})
        named_gantries.append((g["p"], name))

    def plaza_name(p):
        near = [(d, n) for q, n in named_gantries if (d := _dist(p, q)) <= PLAZA_REACH_M]
        return min(near)[1] if near else None

    # Booth outlines first: a booth drawn as a building, and the canopies over the lanes.
    for w in osm.booth_ways:
        pts = w["points"]
        if len(pts) < 3:
            continue
        c = _centroid(pts)
        road = nearest_road(osm, c, reach=60.0)
        name = plaza_name(c)
        if road is None and name is None:
            continue  # a car park's or a park's kiosk
        roof = w["tags"].get("building") == "roof"
        out.append({"id": f"{'canopy' if roof else 'booth_building'}/{w['id']}",
                    "kind": "toll_canopy" if roof else "toll_booth_building",
                    "p": [round(c[0], 7), round(c[1], 7)],
                    "outline": [[round(x, 7), round(y, 7)] for x, y in pts], "name": name,
                    **_road_fields(road), "source": {"way": w["id"]}, "basis": BASIS})

    # Booth points: on a road, or by a bridge's gantry. Grouped into plazas by nearness.
    booths = []
    for b in osm.booths:
        road = nearest_road(osm, b["p"])
        name = plaza_name(b["p"])
        if road is None and name is None:
            continue
        booths.append((b, road, name))
    plazas: list[list] = []
    for item in booths:
        home = next((pl for pl in plazas if any(_dist(item[0]["p"], o[0]["p"]) <= PLAZA_CLUSTER_M for o in pl)), None)
        if home is None:
            plazas.append([item])
        else:
            home.append(item)
    for plaza in plazas:
        bearing_road = next((r for _b, r, _n in plaza if r), None)
        name = next((n for _b, _r, n in plaza if n), None)
        pid = f"plaza/{min(b['id'] for b, _r, _n in plaza)}"
        for b, road, _n in plaza:
            fields = _road_fields(road or bearing_road)
            out.append({"id": f"booth/{b['id']}", "kind": "toll_booth", "p": [round(b["p"][0], 7), round(b["p"][1], 7)],
                        "plaza": pid, "name": name, **fields, "source": {"node": b["id"]}, "basis": BASIS})
    return sorted(out, key=lambda r: r["id"])
