"""Freeway guide signs, inferred from where OpenStreetMap says the exits are and where they go.

No public inventory of California's freeway signs exists to read: Caltrans publishes its
bridges, postmiles and the state highway network (gisdata.dot.ca.gov), not its sign panels or
the structures they hang on, and Mapillary's sign detections place a point within 8 m a third
to a half of the time (the street lights and meters measured that). What is mapped, and well,
is what the signs say: an exit is a ``highway=motorway_junction`` node carrying its number
(``ref``), and the ramp leaving it carries ``destination``, ``destination:ref`` and
``destination:street`` -- the legend of the sign over the lane, transcribed by mappers driving
past it. So the signs are drawn from those, set out the way the California MUTCD (2014 rev. 8,
chapters 2D and 2E) sets out a freeway's guide signs:

* the **exit direction** sign, at the exit: the exit number on a tab, the routes' shields, the
  places, and an arrow; over the lanes where the road is three lanes or more, at the right
  shoulder otherwise (2E.36, overhead where there are three lanes or more);
* the **advance guide** sign half a mile before it (2E.33), the same legend with ``1/2 MILE``;
* the **gore** sign, ``EXIT`` and its number, where the ramp parts from the road (2E.37);
* a **route marker** after each entrance, the road's shields with their cardinal direction
  (2D.10, the reassurance assembly). OpenStreetMap does not tag a way's direction, so it is
  the way's bearing read against the route's number: odd routes run north and south, even
  ones east and west -- unless the route's own exit signs (``destination:ref=I 880 North``)
  say otherwise, as they do for I-880, I-680 and CA 237.

Where OpenStreetMap maps a sign gantry (``man_made=gantry``) near an overhead sign, the sign
hangs from it. Every record says it is inferred, from which nodes and ways; nothing here is a
measurement of a panel.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from itertools import pairwise

MAINLINE = {"motorway", "trunk"}
LINKS = {"motorway_link", "trunk_link"}
LANE_M = 3.66
#: Where each sign stands along the road, in metres before (negative) or after the exit's node.
EXIT_DIRECTION_M = 60.0
ADVANCE_M = 805.0              # half a mile
GORE_M = 45.0
ROUTE_MARKER_M = 300.0
#: A sign this close to another junction's exit sign is not put up: it would read as theirs.
CLEAR_OF_OTHER_EXIT_M = 150.0
ROUTE_MARKER_SPACING_M = 800.0
GANTRY_SNAP_M = 80.0
BASIS = ("inferred: OpenStreetMap exit node and ramp destination tags, laid out per the "
         "California MUTCD guide sign rules; not a surveyed panel")

_NETWORK = {"I": "I", "IH": "I", "US": "US", "CA": "CA", "SR": "CA", "CR": "county"}
_ROUTE = re.compile(r"^\s*(I|IH|US|CA|SR|CR)[\s-]*([0-9]+[A-Z]?)(?:\s+(North|South|East|West|N|S|E|W)\b)?",
                    re.IGNORECASE)
_CARDINAL = {"n": "NORTH", "s": "SOUTH", "e": "EAST", "w": "WEST", "north": "NORTH",
             "south": "SOUTH", "east": "EAST", "west": "WEST"}


@dataclass
class Osm:
    """The freeway network: its nodes' positions, its ways, its exits and its gantries."""

    nodes: dict[int, tuple[float, float]] = field(default_factory=dict)
    ways: dict[int, dict] = field(default_factory=dict)          # id -> {"tags", "nodes"}
    junctions: dict[int, dict] = field(default_factory=dict)     # node id -> tags
    gantries: list[tuple[float, float]] = field(default_factory=list)


def from_overpass(elements: list[dict]) -> Osm:
    """An Overpass ``out body geom`` answer as an :class:`Osm`."""
    osm = Osm()
    for e in elements:
        tags = e.get("tags") or {}
        if e["type"] == "node":
            osm.nodes[e["id"]] = (e["lon"], e["lat"])
            if tags.get("highway") == "motorway_junction":
                osm.junctions[e["id"]] = tags
            if tags.get("man_made") == "gantry":
                osm.gantries.append((e["lon"], e["lat"]))
        elif e["type"] == "way":
            geometry = e.get("geometry") or []
            for nid, g in zip(e.get("nodes") or [], geometry, strict=False):
                if g:
                    osm.nodes.setdefault(nid, (g["lon"], g["lat"]))
            if tags.get("man_made") == "gantry" and geometry:
                pts = [(g["lon"], g["lat"]) for g in geometry if g]
                osm.gantries.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
            elif tags.get("highway") in MAINLINE | LINKS:
                osm.ways[e["id"]] = {"tags": tags, "nodes": list(e.get("nodes") or [])}
    return osm


def parse_routes(text: str | None) -> list[dict]:
    """``"I 280 South;CA 1"`` -> the shields: network, number and, where given, direction."""
    out = []
    for part in re.split(r"[;,]", text or ""):
        m = _ROUTE.match(part)
        if not m:
            continue
        net = _NETWORK[m.group(1).upper()]
        if net == "county":
            continue
        shield = {"net": net, "ref": m.group(2).upper()}
        if m.group(3):
            shield["dir"] = _CARDINAL[m.group(3).lower()]
        out.append(shield)
    return out


def signed_axes(osm: Osm) -> dict[tuple[str, str], str]:
    """Each route's signed axis, "NS" or "EW", from the directions its ramps' signs give it
    (``destination:ref=I 880 North``). The number's parity is the rule and has exceptions
    (I-880 and I-680 are signed north and south, CA 237 east and west); the signs are not."""
    votes: dict[tuple[str, str], dict[str, int]] = {}
    for way in osm.ways.values():
        for shield in parse_routes(way["tags"].get("destination:ref")):
            if "dir" in shield:
                axis = "NS" if shield["dir"] in ("NORTH", "SOUTH") else "EW"
                tally = votes.setdefault((shield["net"], shield["ref"]), {})
                tally[axis] = tally.get(axis, 0) + 1
    return {route: max(tally, key=tally.get) for route, tally in votes.items()}


def cardinal(shield: dict, bearing: float, axes: dict | None = None) -> str:
    """The direction a route is signed for a carriageway on this bearing."""
    axis = (axes or {}).get((shield["net"], shield["ref"]))
    if axis is None:
        axis = "NS" if int(re.match(r"\d+", shield["ref"]).group()) % 2 else "EW"
    if axis == "NS":
        return "NORTH" if math.cos(math.radians(bearing)) >= 0 else "SOUTH"
    return "EAST" if math.sin(math.radians(bearing)) >= 0 else "WEST"


def _metres(a, b) -> tuple[float, float]:
    k = 111320.0
    return ((b[0] - a[0]) * k * math.cos(math.radians((a[1] + b[1]) / 2)), (b[1] - a[1]) * k)


def _dist(a, b) -> float:
    return math.hypot(*_metres(a, b))


def _bearing(a, b) -> float:
    dx, dy = _metres(a, b)
    return math.degrees(math.atan2(dx, dy)) % 360


def _lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


class Network:
    def __init__(self, osm: Osm):
        self.osm = osm
        self.mainline = {wid: w for wid, w in osm.ways.items()
                         if w["tags"].get("highway") in MAINLINE and len(w["nodes"]) >= 2
                         and all(n in osm.nodes for n in w["nodes"])}
        self.links = {wid: w for wid, w in osm.ways.items()
                      if w["tags"].get("highway") in LINKS and len(w["nodes"]) >= 2
                      and all(n in osm.nodes for n in w["nodes"])}
        self.on_mainline: dict[int, list[tuple[int, int]]] = {}
        self.ending_at: dict[int, list[int]] = {}
        self.starting_at: dict[int, list[int]] = {}
        for wid, w in self.mainline.items():
            for i, n in enumerate(w["nodes"]):
                self.on_mainline.setdefault(n, []).append((wid, i))
            self.ending_at.setdefault(w["nodes"][-1], []).append(wid)
            self.starting_at.setdefault(w["nodes"][0], []).append(wid)
        self.link_starting: dict[int, list[int]] = {}
        for wid, w in self.links.items():
            self.link_starting.setdefault(w["nodes"][0], []).append(wid)

    def pt(self, node: int):
        return self.osm.nodes[node]

    def _pick(self, candidates: list[int], ref: str | None) -> int | None:
        if not candidates:
            return None
        same = [c for c in candidates if self.mainline[c]["tags"].get("ref") == ref]
        return (same or candidates)[0]

    def walk(self, wid: int, index: int, metres: float) -> dict | None:
        """The point ``metres`` along the carriageway from vertex ``index`` of way ``wid``:
        upstream when negative. Follows the way's predecessors or successors (one-way, so their
        order is the direction of travel), keeping to the same route where the road divides."""
        way = self.mainline[wid]
        ref = way["tags"].get("ref")
        left = abs(metres)
        path_ways = [wid]
        seen = {wid}
        while True:
            nodes = way["nodes"]
            if metres < 0:
                steps = range(index, 0, -1)
                for i in steps:
                    a, b = self.pt(nodes[i - 1]), self.pt(nodes[i])
                    d = _dist(a, b)
                    if d >= left and d > 0:
                        return {"p": _lerp(b, a, left / d), "bearing": _bearing(a, b), "way": wid,
                                "ways": path_ways}
                    left -= d
                nxt = self._pick([w for w in self.ending_at.get(nodes[0], []) if w not in seen], ref)
                if nxt is None:
                    return None
                wid, way = nxt, self.mainline[nxt]
                index = len(way["nodes"]) - 1
            else:
                for i in range(index, len(nodes) - 1):
                    a, b = self.pt(nodes[i]), self.pt(nodes[i + 1])
                    d = _dist(a, b)
                    if d >= left and d > 0:
                        return {"p": _lerp(a, b, left / d), "bearing": _bearing(a, b), "way": wid,
                                "ways": path_ways}
                    left -= d
                nxt = self._pick([w for w in self.starting_at.get(nodes[-1], []) if w not in seen], ref)
                if nxt is None:
                    return None
                wid, way = nxt, self.mainline[nxt]
                index = 0
            seen.add(wid)
            path_ways.append(wid)

    def along_link(self, wid: int, metres: float):
        nodes = self.links[wid]["nodes"]
        left = metres
        for i in range(len(nodes) - 1):
            a, b = self.pt(nodes[i]), self.pt(nodes[i + 1])
            d = _dist(a, b)
            if d >= left and d > 0:
                return _lerp(a, b, left / d)
            left -= d
        return self.pt(nodes[-1])

    def legend_tags(self, wid: int) -> dict:
        """A ramp's destination tags: its own, or the first of the ramps it leads on to that has
        them (a ramp is often split at its first bridge, and only one piece carries them)."""
        seen, current = set(), wid
        for _ in range(4):
            tags = self.links[current]["tags"]
            if any(k.startswith("destination") for k in tags):
                return tags
            seen.add(current)
            after = [w for w in self.link_starting.get(self.links[current]["nodes"][-1], [])
                     if w not in seen]
            if len(after) != 1:
                break
            current = after[0]
        return self.links[wid]["tags"]


def _lanes(tags: dict) -> int:
    try:
        return max(1, int(str(tags.get("lanes", "")).split(";")[0]))
    except ValueError:
        return 3 if tags.get("highway") == "motorway" else 2


def _deck(tags: dict) -> bool:
    try:
        layer = int(tags.get("layer", 0))
    except ValueError:
        layer = 0
    return tags.get("bridge") not in (None, "no") or layer > 0


def _places(text: str | None, limit: int = 2) -> list[str]:
    return [p.strip() for p in re.split(r";", text or "") if p.strip()][:limit]


def _record(net: Network, kind: str, at: dict, legend: dict, source: dict, mount: str) -> dict:
    tags = net.mainline[at["way"]]["tags"]
    lanes = _lanes(tags)
    return {
        "id": f"{kind}:{source['junction'] if 'junction' in source else source['link']}",
        "kind": kind, "p": [round(at["p"][0], 7), round(at["p"][1], 7)],
        "bearing": round(at["bearing"], 1), "lanes": lanes, "width_m": round(lanes * LANE_M, 1),
        "deck": _deck(tags), "mount": mount, "legend": legend,
        "source": {**source, "way": at["way"]}, "basis": BASIS,
    }


def _snap_to_gantry(net: Network, record: dict) -> None:
    if record["mount"] != "overhead" or not net.osm.gantries:
        return
    p = tuple(record["p"])
    best = min(net.osm.gantries, key=lambda g: _dist(g, p))
    if _dist(best, p) > GANTRY_SNAP_M:
        return
    # The gantry's own position across the road, carried onto the carriageway's line.
    way = net.mainline[record["source"]["way"]]["nodes"]
    best_pt, best_d = None, 1e9
    for a, b in pairwise(way):
        pa, pb = net.pt(a), net.pt(b)
        dx, dy = _metres(pa, pb)
        gx, gy = _metres(pa, best)
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, (gx * dx + gy * dy) / L2))
        q = _lerp(pa, pb, t)
        if _dist(q, best) < best_d:
            best_pt, best_d = q, _dist(q, best)
    if best_pt is not None and best_d < 40:
        record["p"] = [round(best_pt[0], 7), round(best_pt[1], 7)]
        record["structure"] = "osm_gantry"


def infer_signs(osm: Osm) -> list[dict]:
    """Every exit's direction, advance and gore signs, and a route marker after each entrance."""
    net = Network(osm)
    signs: list[dict] = []
    exit_points: list[tuple[int, tuple[float, float]]] = []
    for jid, jtags in sorted(osm.junctions.items()):
        occurrences = [(w, i) for w, i in net.on_mainline.get(jid, []) if i > 0]
        exits = net.link_starting.get(jid, [])
        if not occurrences or not exits:
            continue
        wid, index = occurrences[0]
        tags = net.legend_tags(exits[0])
        number = (jtags.get("ref") or tags.get("junction:ref") or "").strip()
        shields = parse_routes(tags.get("destination:ref"))
        places = _places(tags.get("destination")) or _places(jtags.get("exit_to"))
        street = _places(tags.get("destination:street"), 1)
        if not places and not shields and not street:
            places = _places(jtags.get("name"), 1)
        source = {"junction": jid, "link": exits[0]}
        lanes = _lanes(net.mainline[wid]["tags"])
        mount = "overhead" if lanes >= 3 else "roadside"
        if places or shields or street:
            legend = {"tab": f"EXIT {number}" if number else None, "shields": shields,
                      "lines": places + [s for s in street if s not in places],
                      "arrow": "down" if mount == "overhead" else "up_right"}
            at = net.walk(wid, index, -EXIT_DIRECTION_M)
            if at:
                signs.append(_record(net, "exit_direction", at, legend, source, mount))
                exit_points.append((jid, tuple(at["p"])))
            ahead = net.walk(wid, index, -ADVANCE_M)
            if ahead:
                signs.append(_record(net, "advance_guide", ahead,
                                     {**legend, "arrow": None, "distance": "1/2 MILE"}, source, mount))
        # The gore: between the ramp and the road, a little way past where they part.
        on_road = net.walk(wid, index, GORE_M)
        if on_road:
            ramp = net.along_link(exits[0], GORE_M)
            gore = {**on_road, "p": _lerp(on_road["p"], ramp, 0.5)}
            signs.append(_record(net, "gore", gore, {"tab": None, "lines": ["EXIT", number] if number else ["EXIT"]},
                                 source, "gore"))
    # An advance sign that lands on another exit's sign is dropped: it would read as that exit's.
    signs = [s for s in signs if s["kind"] != "advance_guide" or not any(
        j != s["source"]["junction"] and _dist(p, s["p"]) < CLEAR_OF_OTHER_EXIT_M for j, p in exit_points)]
    markers: list[dict] = []
    axes = signed_axes(osm)
    for lid, link in sorted(net.links.items()):
        end = link["nodes"][-1]
        joins = [(w, i) for w, i in net.on_mainline.get(end, []) if i < len(net.mainline[w]["nodes"]) - 1]
        if not joins or net.on_mainline.get(link["nodes"][0]):
            continue
        wid, index = joins[0]
        at = net.walk(wid, index, ROUTE_MARKER_M)
        if not at:
            continue
        shields = parse_routes(net.mainline[at["way"]]["tags"].get("ref"))
        if not shields:
            continue
        if any(_dist(m["p"], at["p"]) < ROUTE_MARKER_SPACING_M
               and abs((m["bearing"] - at["bearing"] + 180) % 360 - 180) < 45 for m in markers):
            continue
        for shield in shields:
            shield["dir"] = cardinal(shield, at["bearing"], axes)
        markers.append(_record(net, "route_marker", at, {"shields": shields}, {"link": lid}, "roadside"))
    signs += markers
    for record in signs:
        _snap_to_gantry(net, record)
    return signs
