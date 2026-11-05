"""Storm drains and sewer lids as they are built, and where the water goes after it goes in.

**Forms.** A drain is drawn as what it is:

* ``curb_grate`` -- a combination inlet: an opening in the kerb face over a grate in the gutter
  (San Francisco's standard catch basin, Caltrans GO/GDO, and the default for an inlet a city
  publishes without its type: the commonest Bay Area inlet);
* ``curb_opening`` -- an opening in the kerb face with no grate (SF "Curb Inlet: Drain w/ no
  grate", Caltrans A2);
* ``grate`` -- a flat grate in the gutter or the road (Caltrans G1-G4, drop inlets, area drains,
  drain boxes), and ``round_grate`` -- a manhole with a grated cover;
* ``trench`` -- a long narrow slot grate across a plaza or a track (trench and track drains).

A sewer lid (``lid``) is a solid cast-iron cover, fixed in the road: it is an object, but not a
movable one. Records that are not a surface inlet at all (SF's model-only pseudo drains, wet
wells, green-infrastructure points, tree wells, scuppers, culvert wing walls) are not drawn.

**Routes.** Each drain carries where its water goes, on the best evidence there is:

* San Jose's storm network is published with the asset at both ends of every main, so a drain's
  water is followed main by main to the outfall it leaves by (``published network``);
* Palo Alto publishes the pipes without their direction: the water is taken along the network
  to the nearest outfall it reaches (``published pipes, direction inferred``);
* San Francisco's sewer is combined, and the SFPUC publishes no mains: a catch basin's water goes
  by its watershed (from its neighbourhood) to the treatment plant that watershed drains to, and
  in a storm past it to the overflow and outfall (``SFPUC watershed``);
* everywhere else a storm drain empties to the nearest creek or culvert it can reach, else the
  Bay (``nearest receiving water``).
"""

from __future__ import annotations

import heapq
import math
from collections import defaultdict
from itertools import pairwise

SKIP_TYPES = ("psuedo", "pseudo", "wetwell", "lid /", "bubbler", "tree well", "scupper", "wing wall")


def drain_form(node: dict) -> str | None:
    """What a drain is built as, from the city's own type where it gives one."""
    text = str(node.get("type") or "").lower()
    if any(s in text for s in SKIP_TYPES):
        return None
    if node.get("kind") == "manhole":
        return "lid"
    if "no grate" in text or "a2 drain" in text or text in {"curb", "kerb", "curb_inlet", "kerb_inlet"}:
        return "curb_opening"
    if "trench" in text or "track drain" in text or text in {"slot", "channel"}:
        return "trench"
    if "mh inlet" in text or "grated cover" in text:
        return "round_grate"
    if ("grate inlet" in text or "drop inlet" in text or "area drain" in text or "drain box" in text
            or "switchbox" in text or "hinged mh" in text or text in {"grate", "grating"}):
        return "grate"
    return "curb_grate"


# -- San Francisco: the watershed each neighbourhood's combined sewer drains to ------------------

SF_WESTSIDE = {"Outer Richmond", "Inner Richmond", "Seacliff", "Lincoln Park", "Golden Gate Park",
               "Sunset/Parkside", "Inner Sunset", "Lakeshore", "West of Twin Peaks",
               "Oceanview/Merced/Ingleside"}
SF_NORTH_SHORE = {"Marina", "Russian Hill", "North Beach", "Chinatown", "Nob Hill", "Pacific Heights",
                  "Presidio Heights", "Presidio"}
SF_ISLAIS = {"Glen Park", "Bernal Heights", "Excelsior", "Outer Mission", "Portola", "McLaren Park"}
SF_SOUTH = {"Visitacion Valley"}

SOUTHEAST = "Southeast Treatment Plant (SFPUC, 750 Phelps St)"
OCEANSIDE = "Oceanside Treatment Plant (SFPUC)"
NORTH_POINT = "North Point Wet-Weather Facility (SFPUC)"


def sf_watershed(neighbourhood: str | None, lat: float) -> str:
    n = neighbourhood or ""
    if n in SF_WESTSIDE:
        return "Westside"
    if n in SF_NORTH_SHORE or (n == "Financial District/South Beach" and lat > 37.792):
        return "North Shore"
    if n in SF_ISLAIS or (n == "Bayview Hunters Point" and lat >= 37.725):
        return "Islais Creek"
    if n == "Bayview Hunters Point":
        return "Yosemite"
    if n in SF_SOUTH:
        return "Sunnydale"
    if n == "Treasure Island":
        return "Treasure Island"
    return "Channel"


def sf_route(watershed: str) -> dict:
    """Where a San Francisco catch basin's water goes: the combined sewer, its watershed's
    transport and storage box, the plant, and in a storm the overflow (SFPUC Sewer System
    Improvement Program watershed descriptions)."""
    if watershed == "Westside":
        return {"to": OCEANSIDE, "system": "combined", "basis": "SFPUC watershed",
                "via": ["catch basin", "combined sewer main", "Westside Transport/Storage Box",
                        "Westside Pump Station", OCEANSIDE],
                "outfall": "Southwest Ocean Outfall (4.5 miles out into the Pacific)",
                "storm": "past the transport box's capacity: Ocean Beach overflow structures"}
    if watershed == "North Shore":
        return {"to": SOUTHEAST, "system": "combined", "basis": "SFPUC watershed",
                "via": ["catch basin", "combined sewer main", "North Shore Transport/Storage Box",
                        "North Shore Pump Station", "Channel Force Main", SOUTHEAST],
                "outfall": "Southeast Bay Outfall (San Francisco Bay)",
                "storm": f"in wet weather: {NORTH_POINT}, out to the Bay off Piers 33 and 35"}
    if watershed == "Treasure Island":
        return {"to": "Treasure Island Wastewater Treatment Plant", "system": "combined",
                "basis": "SFPUC watershed", "via": ["catch basin", "sewer main",
                                                     "Treasure Island Wastewater Treatment Plant"],
                "outfall": "San Francisco Bay"}
    box = {"Channel": "Channel Transport/Storage Box", "Islais Creek": "Islais Creek Transport/Storage Box",
           "Yosemite": "Yosemite Transport/Storage Box", "Sunnydale": "Sunnydale Transport/Storage Box"}[watershed]
    return {"to": SOUTHEAST, "system": "combined", "basis": "SFPUC watershed",
            "via": ["catch basin", "combined sewer main", box, SOUTHEAST],
            "outfall": "Southeast Bay Outfall (San Francisco Bay)",
            "storm": f"past the {box}'s capacity: the {watershed} overflow structures to the Bay"}


# -- geometry ---------------------------------------------------------------------------------------

def dist_m(a, b) -> float:
    k = 111320.0
    return math.hypot((b[0] - a[0]) * k * math.cos(math.radians(a[1])), (b[1] - a[1]) * 111320.0)


class PointGrid:
    def __init__(self, items, cell_deg: float = 0.002, key=lambda it: it["p"]):
        self.cell, self.key = cell_deg, key
        self.cells: dict[tuple[int, int], list] = defaultdict(list)
        for it in items:
            p = key(it)
            self.cells[(int(p[0] // cell_deg), int(p[1] // cell_deg))].append(it)

    def near(self, p, reach_m: float):
        span = max(1, math.ceil(reach_m / (self.cell * 88000)))
        i, j = int(p[0] // self.cell), int(p[1] // self.cell)
        for di in range(-span, span + 1):
            for dj in range(-span, span + 1):
                for it in self.cells.get((i + di, j + dj), ()):
                    d = dist_m(self.key(it), p)
                    if d <= reach_m:
                        yield d, it

    def nearest(self, p, reach_m: float):
        best = min(self.near(p, reach_m), default=None, key=lambda t: t[0])
        return best[1] if best else None


def stream_points(streams: list[dict], step_m: float = 25.0) -> list[dict]:
    """Points along every waterway (culverts included: a storm main empties into one as readily
    as into the open creek), for the nearest-receiving-water route."""
    out = []
    for s in streams:
        for a, b in pairwise(s["c"]):
            n = max(1, int(dist_m(a, b) // step_m))
            for k in range(n):
                t = k / n
                out.append({"p": [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
                            "name": s.get("name") or "", "kind": s["kind"], "under": s["under"]})
    return out


def receiving_water(p, grid: PointGrid | None, reach_m: float = 1500.0) -> dict:
    hit = grid.nearest(p, reach_m) if grid else None
    if hit is None:
        return {"receiving": "San Francisco Bay", "receiving_m": None}
    name = hit["name"] or f"an unnamed {hit['kind']}"
    return {"receiving": name + (" (in its culvert)" if hit["under"] else ""),
            "receiving_m": round(dist_m(p, hit["p"]))}


# -- routes through a published network --------------------------------------------------------------

_INDEX: dict[int, tuple] = {}


def _index(network: dict) -> tuple[dict, dict]:
    key = id(network)
    if key not in _INDEX:
        down = defaultdict(list)
        for link in network["links"]:
            down[link["up"]].append(link)
        _INDEX[key] = (down, {n["id"]: n for n in network["nodes"]})
    return _INDEX[key]


def entry_node(network: dict, node: dict, grid: PointGrid, reach_m: float = 40.0) -> str | None:
    """Where an inlet's water joins the mains: the inlet itself where a main leaves it, else
    the nearest node a main leaves (its lateral is not published)."""
    down, _ = _index(network)
    if down.get(node["id"]):
        return node["id"]
    best = None
    for d, other in grid.near(node["p"], reach_m):
        if down.get(other["id"]) and (best is None or d < best[0]):
            best = (d, other["id"])
    return best[1] if best else None


def follow_published(network: dict, start: str, cap: int = 5000) -> dict | None:
    """Main by main downstream from a node, as the city drew each main (up to down), to where
    no main leaves: the outfall, or the end of what is published."""
    down, by_id = _index(network)
    node, seen, length, hops, through = start, {start}, 0.0, 0, []
    while down.get(node) and hops < cap:
        link = min(down[node], key=lambda ln: ln.get("diameter_m") or 9)   # the main, not an overflow
        node = link["down"]
        length += link.get("length_m", 0.0)
        hops += 1
        street = str(link.get("street") or "").strip().title()
        if street and (not through or through[-1] != street):
            through.append(street)
        if node in seen:
            break
        seen.add(node)
    if hops == 0:
        return None
    end = by_id.get(node, {})
    return {"end": node, "end_kind": end.get("kind", "junction"), "end_p": end.get("p"),
            "length_m": round(length), "mains": hops, "under_streets": through[:8]}


def toward_outfalls(network: dict) -> dict[str, tuple[str, float]]:
    """For a network published without direction: every node's next node on its shortest way
    along the pipes to an outfall (Dijkstra from all outfalls at once)."""
    adj = defaultdict(list)
    for link in network["links"]:
        adj[link["up"]].append((link["down"], link.get("length_m", 1.0)))
        adj[link["down"]].append((link["up"], link.get("length_m", 1.0)))
    outfalls = [n["id"] for n in network["nodes"] if n["kind"] == "outfall"]
    best = {o: 0.0 for o in outfalls}
    nxt: dict[str, tuple[str, float]] = {o: (o, 0.0) for o in outfalls}
    heap = [(0.0, o) for o in outfalls]
    while heap:
        d, node = heapq.heappop(heap)
        if d > best.get(node, math.inf):
            continue
        for other, w in adj[node]:
            nd = d + w
            if nd < best.get(other, math.inf):
                best[other] = nd
                nxt[other] = (node, nd)
                heapq.heappush(heap, (nd, other))
    return nxt
