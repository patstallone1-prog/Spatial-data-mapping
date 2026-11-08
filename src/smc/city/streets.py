"""The street network people and vehicles move on: the region's real streets, as a graph.

Built from the same payload the viewer draws (``sf-corridor-3d.json``): every ``street`` way is
a run of edges for driving (one way where OSM says so) and walking; footpaths, sidewalks and
crossings are walking edges. Coordinates are metres east and north of the region's centre.
Nodes are the ways' own points, merged where two ways share one (within ``SNAP_M``), which is
where the ways join.

Each edge carries its road class, which is what the law's speed limits are set by.
"""

from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass, field

SNAP_M = 0.75
WALK_MS = 1.35
WALK_KINDS = frozenset({"path", "sidewalk", "crossing", "cycleway"})


@dataclass(frozen=True)
class Edge:
    to: int
    length_m: float
    road_class: str
    drive: bool
    walk: bool
    way: int | None = None


@dataclass
class StreetGraph:
    origin: tuple[float, float]  # lon, lat of (0, 0)
    xy: list[tuple[float, float]] = field(default_factory=list)
    edges: list[list[Edge]] = field(default_factory=list)
    _index: dict[tuple[int, int], int] = field(default_factory=dict)
    _grid: dict[tuple[int, int], list[int]] = field(default_factory=dict)
    grid_m: float = 50.0
    #: mode -> the nodes of the largest connected network for it (``connect_up``): a footpath
    #: across a park that touches no street is not somewhere a trip can start or end.
    reach: dict[str, set[int]] = field(default_factory=dict)

    # ---- coordinates ---------------------------------------------------------------------
    def to_xy(self, lon: float, lat: float) -> tuple[float, float]:
        lon0, lat0 = self.origin
        return ((lon - lon0) * 111_320.0 * math.cos(math.radians(lat0)), (lat - lat0) * 111_320.0)

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        lon0, lat0 = self.origin
        return (lon0 + x / (111_320.0 * math.cos(math.radians(lat0))), lat0 + y / 111_320.0)

    # ---- building ------------------------------------------------------------------------
    def node(self, x: float, y: float) -> int:
        key = (round(x / SNAP_M), round(y / SNAP_M))
        found = self._index.get(key)
        if found is not None:
            return found
        n = len(self.xy)
        self.xy.append((x, y))
        self.edges.append([])
        self._index[key] = n
        self._grid.setdefault((int(x // self.grid_m), int(y // self.grid_m)), []).append(n)
        return n

    def connect(self, a: int, b: int, *, road_class: str, drive: bool, walk: bool, oneway: bool,
                way: int | None = None) -> None:
        if a == b:
            return
        length = math.dist(self.xy[a], self.xy[b])
        self.edges[a].append(Edge(b, length, road_class, drive, walk, way))
        # Against a one-way street a car may not go; a person on its pavement may.
        self.edges[b].append(Edge(a, length, road_class, drive and not oneway, walk, way))

    def add_line(self, points: list[tuple[float, float]], **kind) -> None:
        nodes = [self.node(*self.to_xy(lon, lat)) for lon, lat in points]
        for a, b in itertools.pairwise(nodes):
            self.connect(a, b, **kind)

    @property
    def size(self) -> int:
        return len(self.xy)

    def connect_up(self) -> StreetGraph:
        """Find each mode's largest network; trips start and end only on it."""
        for mode in ("walk", "drive"):
            seen: set[int] = set()
            best: set[int] = set()
            for start in range(self.size):
                if start in seen or not any(getattr(e, mode) for e in self.edges[start]):
                    continue
                # Driving networks are directed; joining both directions finds what hangs together.
                part, todo = {start}, [start]
                while todo:
                    n = todo.pop()
                    for e in self.edges[n]:
                        if e.to not in part and (getattr(e, mode) or (mode == "drive" and e.drive is False and any(
                                b.to == n and b.drive for b in self.edges[e.to]))):
                            part.add(e.to)
                            todo.append(e.to)
                seen |= part
                if len(part) > len(best):
                    best = part
            self.reach[mode] = best
        return self

    # ---- finding -------------------------------------------------------------------------
    def nearest(self, x: float, y: float, *, mode: str = "walk", reach_m: float = 400.0) -> int | None:
        best, best_d = None, reach_m
        cx, cy = int(x // self.grid_m), int(y // self.grid_m)
        rings = int(reach_m // self.grid_m) + 1
        for ring in range(rings + 1):
            for gx in range(cx - ring, cx + ring + 1):
                for gy in range(cy - ring, cy + ring + 1):
                    if max(abs(gx - cx), abs(gy - cy)) != ring:
                        continue
                    for n in self._grid.get((gx, gy), ()):
                        if mode in self.reach and n not in self.reach[mode]:
                            continue
                        if not any(getattr(e, mode) for e in self.edges[n]):
                            continue
                        d = math.dist((x, y), self.xy[n])
                        if d < best_d:
                            best, best_d = n, d
            if best is not None and best_d <= ring * self.grid_m:
                break
        return best

    def route(self, start: int, goal: int, *, mode: str, speed_ms=None, max_ms: float = 30.0) -> list[int] | None:
        """The quickest path by ``mode`` ("walk" or "drive"), as nodes. ``speed_ms(edge)`` sets each
        edge's speed (the law's limit for its class); walking is at a walker's pace."""
        if start == goal:
            return [start]
        pace = (lambda e: WALK_MS) if mode == "walk" else (speed_ms or (lambda e: 13.0))
        top = WALK_MS if mode == "walk" else max_ms
        gx, gy = self.xy[goal]
        best = {start: 0.0}
        came: dict[int, int] = {}
        frontier = [(0.0, start)]
        while frontier:
            _, n = heapq.heappop(frontier)
            if n == goal:
                path = [n]
                while n in came:
                    n = came[n]
                    path.append(n)
                return path[::-1]
            here = best[n]
            for e in self.edges[n]:
                if not getattr(e, mode):
                    continue
                t = here + e.length_m / max(0.5, pace(e))
                if t < best.get(e.to, math.inf):
                    best[e.to] = t
                    came[e.to] = n
                    x, y = self.xy[e.to]
                    heapq.heappush(frontier, (t + math.hypot(gx - x, gy - y) / top, e.to))
        return None

    def edge(self, a: int, b: int, mode: str) -> Edge:
        for e in self.edges[a]:
            if e.to == b and getattr(e, mode):
                return e
        raise KeyError((a, b, mode))


def road_class(way: dict) -> str:
    service = way.get("service")
    if service in ("driveway", "parking_aisle", "drive-through", "access"):
        return "service"
    if service == "alley":
        return "shared"
    lanes = int(way.get("lanes") or 0)
    if way.get("busway") or lanes >= 3 or (way.get("road_m") or 0) >= 14:
        return "arterial"
    return "residential"


def graph_from_payload(payload: dict) -> StreetGraph:
    """The region's streets and footways as one graph (its ways' own points, joined where shared)."""
    bbox = payload["bbox"]
    graph = StreetGraph(((bbox["west"] + bbox["east"]) / 2, (bbox["south"] + bbox["north"]) / 2))
    for way in payload.get("ways", ()):
        kind = way.get("kind")
        points = way.get("points") or []
        if len(points) < 2:
            continue
        if kind == "street" and way.get("tunnel_kind") != "underground":
            graph.add_line(points, road_class=road_class(way), drive=True, walk=True,
                           oneway=way.get("osm_oneway") == "yes", way=way.get("osm_id"))
        elif kind in WALK_KINDS:
            graph.add_line(points, road_class="shared", drive=False, walk=True, oneway=False,
                           way=way.get("osm_id"))
    return graph.connect_up()


def grid_graph(blocks: int = 6, block_m: float = 100.0) -> StreetGraph:
    """A small street grid for tests and empty districts: avenues every other street are arterial."""
    graph = StreetGraph((-122.4, 37.79))
    for i in range(blocks + 1):
        for j in range(blocks):
            for a, b in (((i, j), (i, j + 1)), ((j, i), (j + 1, i))):
                na = graph.node(a[0] * block_m, a[1] * block_m)
                nb = graph.node(b[0] * block_m, b[1] * block_m)
                graph.connect(na, nb, road_class="arterial" if i % 3 == 0 else "residential", drive=True,
                              walk=True, oneway=False)
    return graph.connect_up()
