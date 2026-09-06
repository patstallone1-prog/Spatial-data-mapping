"""Putting a coordinate on the city's street network.

Everything official is keyed to a CNN -- San Francisco's street centreline network id -- and
everything of ours is keyed to a latitude and longitude or to an OpenStreetMap way. This is the
join between them, and it is the part most likely to be quietly wrong: a footway matched to the
street behind it instead of the one it runs along puts a surveyed width on the wrong pavement,
and nothing downstream would notice.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict

import numpy as np

from smc.facades.geometry import LocalFrame
from smc.official.crs import geojson_points
from smc.official.extract import segment_id

#: How far a point may sit from a centreline and still be on that street: half a wide San
#: Francisco right of way, plus the footway behind it.
MATCH_RADIUS_M = 25.0


def project_to_polyline(vertices: np.ndarray, x: float, y: float) -> tuple[float, float, int]:
    """``(distance, station, side)`` from a point to a polyline, all in metres."""
    point = np.array([x, y])
    starts, ends = vertices[:-1], vertices[1:]
    edges = ends - starts
    lengths = np.linalg.norm(edges, axis=1)
    keep = lengths > 1e-9
    if not keep.any():
        return math.inf, 0.0, 0
    starts, edges, lengths = starts[keep], edges[keep], lengths[keep]
    directions = edges / lengths[:, None]
    t = np.clip(((point - starts) * directions).sum(axis=1), 0.0, lengths)
    closest = starts + directions * t[:, None]
    distances = np.linalg.norm(point - closest, axis=1)
    i = int(distances.argmin())
    delta = point - closest[i]
    cross = directions[i, 0] * delta[1] - directions[i, 1] * delta[0]
    station = float(lengths[:i].sum() + t[i])
    return float(distances[i]), station, (1 if cross >= 0 else -1)


class CentrelineIndex:
    """Nearest street segment to a point, and which side of it.

    A flat scan over two thousand segments for each of ten thousand measurements is twenty
    million polyline projections, which is minutes. The segments go into a coarse grid first,
    so each lookup touches the handful that could possibly be nearest.
    """

    CELL_M = 60.0

    def __init__(self, frame: LocalFrame) -> None:
        self.frame = frame
        self.segments: dict[str, np.ndarray] = {}
        self.names: dict[str, str] = {}
        self.grid: dict[tuple[int, int], list[str]] = defaultdict(list)

    @classmethod
    def from_rows(cls, rows: list[dict], frame: LocalFrame,
                  *, geometry_key: str = "line") -> "CentrelineIndex":
        index = cls(frame)
        for row in rows:
            points = geojson_points(row.get(geometry_key) or {})
            if len(points) < 2 or row.get("cnn") is None:
                continue
            name = " ".join(str(row.get(k) or "") for k in ("street", "st_type")).strip()
            index.add(segment_id(row["cnn"]), points, name)
        return index

    @classmethod
    def from_centrelines(cls, centrelines: list[dict], frame: LocalFrame) -> "CentrelineIndex":
        index = cls(frame)
        for row in centrelines:
            index.add(row["id"], [tuple(p) for p in row["points"]], row.get("name", ""))
        return index

    def add(self, feature_id: str, points, name: str = "") -> None:
        local = np.array([self.frame.to_xy(lon, lat) for lon, lat in points])
        self.segments[feature_id] = local
        self.names[feature_id] = name
        for x, y in local:
            self.grid[(int(x // self.CELL_M), int(y // self.CELL_M))].append(feature_id)

    def _nearby(self, x: float, y: float) -> list[str]:
        """Candidate segments near a point, in a fixed order.

        Sorted, because ties are real: a point equidistant from two centrelines picks whichever
        came first, and iterating a set meant that was whichever the hash happened to yield.
        Two runs over identical inputs disagreed on a few hundred segments, which is a small
        error and an unacceptable property for a table other things are built from.
        """
        cell = (int(x // self.CELL_M), int(y // self.CELL_M))
        found: set[str] = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                found.update(self.grid.get((cell[0] + dx, cell[1] + dy), ()))
        return sorted(found)

    def locate(self, lon: float | None, lat: float | None) -> tuple[str, int] | None:
        """``(feature_id, side)`` for a coordinate, or None if no street is near enough."""
        found = self.locate_full(lon, lat)
        return None if found is None else (found[0], found[2])

    def locate_full(self, lon: float | None,
                    lat: float | None) -> tuple[str, float, int, float] | None:
        """``(feature_id, station_m, side, distance_m)``, or None."""
        if lon is None or lat is None:
            return None
        x, y = self.frame.to_xy(lon, lat)
        best = None
        best_distance = math.inf
        for feature in self._nearby(x, y):
            distance, station, side = project_to_polyline(self.segments[feature], x, y)
            if distance < best_distance:
                best, best_distance = (feature, station, side, distance), distance
        if best is None or best_distance > MATCH_RADIUS_M:
            return None
        return best

    def locate_way(self, points, *, samples: int = 7) -> tuple[str, int, float] | None:
        """Which segment an entire way belongs to: ``(feature_id, side, distance_m)``.

        A single midpoint is not enough. A footway that clips the corner of an intersection has
        its midpoint nearest the cross street, and matching on that would hang the wrong
        street's surveyed width on it. Sampling along the way and taking the segment that wins
        most often is stable against that.
        """
        if len(points) < 2:
            return None
        step = max(1, len(points) // samples)
        votes: Counter = Counter()
        sides: defaultdict = defaultdict(Counter)
        distances: defaultdict = defaultdict(list)
        for lon, lat in points[::step]:
            found = self.locate_full(lon, lat)
            if found is None:
                continue
            feature, _station, side, distance = found
            votes[feature] += 1
            sides[feature][side] += 1
            distances[feature].append(distance)
        if not votes:
            return None
        feature, _ = votes.most_common(1)[0]
        side, _ = sides[feature].most_common(1)[0]
        ordered = sorted(distances[feature])
        return feature, side, ordered[len(ordered) // 2]
