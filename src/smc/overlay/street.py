"""Overlaying captures onto a standard street map.

The anchoring stack returns a pose in a metric local frame. That is not yet a *place*: nothing
in it says which street this is, which side of it the camera was on, or which direction the
footway runs. Everything downstream needs those, and they all come from the same operation —
snapping the pose to the street network.

Three things depend on it, and they are the reason this module is not cosmetic:

* **Measurement becomes well posed.** Fitting a kerb needs to know which lateral direction is
  across the footway and roughly where the roadway edge is. Searching for the kerb line works
  (:func:`~smc.measure.planes.estimate_kerb_offset`) but the map already knows, and a supplied
  answer cannot be fooled by an unusual cross-section.
* **Facts get a stable identity.** A fact keyed to "OSM way 12345, station 47 m, north side"
  survives re-observation by a different contributor months later; one keyed to a bare
  coordinate does not, and corroboration across contributors is the whole product.
* **3D rendering lands where it should.** The map frame gives a consistent along/across/up
  basis per street, so geometry measured on separate passes composites into one surface
  instead of a fan of slightly rotated copies.

The reference geometry is OSM or Overture transportation, both **ODbL**. It is used here as a
*reference* — to place and orient measurements — and never merged into the served facts. A
segment id may be recorded; segment geometry may not be copied. That boundary is what keeps the
facts table a Produced Work.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from smc import geo


@dataclass(frozen=True, slots=True)
class StreetSegment:
    """A street centreline as a polyline in a local ENU frame.

    ``segment_id`` is the upstream identity (an OSM way, an Overture id) and is the only part
    of the reference data that may be carried into a served fact.
    """

    segment_id: str
    #: (N, 2) east/north vertices in metres.
    vertices: np.ndarray
    #: Carriageway width, kerb to kerb.
    roadway_width_m: float = 9.0
    name: str = ""

    def __post_init__(self) -> None:
        vertices = np.asarray(self.vertices, dtype=np.float64).reshape(-1, 2)
        if len(vertices) < 2:
            raise ValueError("a street segment needs at least two vertices")
        object.__setattr__(self, "vertices", vertices)

    @property
    def length_m(self) -> float:
        return float(np.linalg.norm(np.diff(self.vertices, axis=0), axis=1).sum())

    def project(self, east: float, north: float) -> tuple[float, float, float]:
        """Closest point on the centreline: (station, signed lateral offset, bearing).

        Lateral offset is positive to the left of the direction of travel. Sign matters — it is
        what distinguishes the two sides of the street, which carry different footways with
        different kerbs.
        """
        point = np.array([east, north], dtype=np.float64)
        best = (math.inf, 0.0, 0.0, 0.0)
        travelled = 0.0

        for start, end in zip(self.vertices[:-1], self.vertices[1:], strict=True):
            edge = end - start
            length = float(np.linalg.norm(edge))
            if length < 1e-9:
                continue
            direction = edge / length
            t = float(np.clip((point - start) @ direction, 0.0, length))
            closest = start + direction * t
            distance = float(np.linalg.norm(point - closest))
            if distance < best[0]:
                # 2-D scalar cross product gives the side. Written out rather than via
                # np.cross, which dropped 2-D input in NumPy 2.
                delta = point - closest
                offset = float(direction[0] * delta[1] - direction[1] * delta[0])
                lateral = math.copysign(distance, offset if offset != 0 else 1.0)
                bearing = math.degrees(math.atan2(direction[0], direction[1])) % 360.0
                best = (distance, travelled + t, lateral, bearing)
            travelled += length

        return best[1], best[2], best[3]

    def point_at(self, station_m: float) -> tuple[np.ndarray, np.ndarray]:
        """Position and unit direction at a station along the centreline."""
        travelled = 0.0
        for start, end in zip(self.vertices[:-1], self.vertices[1:], strict=True):
            edge = end - start
            length = float(np.linalg.norm(edge))
            if length < 1e-9:
                continue
            if travelled + length >= station_m:
                direction = edge / length
                return start + direction * (station_m - travelled), direction
            travelled += length
        direction = self.vertices[-1] - self.vertices[-2]
        return self.vertices[-1], direction / max(float(np.linalg.norm(direction)), 1e-9)

    def kerb_offset(self, side: int) -> float:
        """Lateral offset of the kerb line from the centreline, signed by side.

        The hint measurement needs. Half the carriageway is a coarse answer and a good one:
        being right to a few tens of centimetres removes the ambiguity that actually breaks
        plane fitting, which is which surface is which.
        """
        if side not in (-1, 1):
            raise ValueError("side must be -1 (right) or +1 (left)")
        return side * self.roadway_width_m / 2.0


@dataclass(frozen=True, slots=True)
class MapFrame:
    """A street-aligned basis: along the kerb, across the footway, up.

    Measurements taken in this frame compose across passes. Measurements taken in each camera's
    own frame do not.
    """

    origin_e: float
    origin_n: float
    along: np.ndarray
    across: np.ndarray
    segment_id: str
    side: int

    def to_local(self, points_enu: np.ndarray) -> np.ndarray:
        """ENU points into the street frame: +x along, +y across, +z up."""
        points = np.asarray(points_enu, dtype=np.float64).reshape(-1, 3)
        shifted = points[:, :2] - np.array([self.origin_e, self.origin_n])
        return np.c_[shifted @ self.along, shifted @ self.across, points[:, 2]]

    def to_enu(self, points_local: np.ndarray) -> np.ndarray:
        points = np.asarray(points_local, dtype=np.float64).reshape(-1, 3)
        east = self.origin_e + points[:, 0] * self.along[0] + points[:, 1] * self.across[0]
        north = self.origin_n + points[:, 0] * self.along[1] + points[:, 1] * self.across[1]
        return np.c_[east, north, points[:, 2]]


@dataclass(frozen=True, slots=True)
class SnapResult:
    """Where a pose sits on the street network."""

    segment: StreetSegment
    station_m: float
    lateral_offset_m: float
    bearing_deg: float
    side: int
    frame: MapFrame

    @property
    def feature_id(self) -> str:
        """Stable identity for a fact: segment, station bucket, side.

        Bucketed to five metres so two contributors measuring the same kerb months apart agree
        on the identity, which is what lets their observations corroborate rather than pile up
        as separate near-duplicate facts.
        """
        bucket = int(self.station_m // 5.0) * 5
        side = "L" if self.side > 0 else "R"
        return f"{self.segment.segment_id}:{bucket:05d}:{side}"

    @property
    def kerb_offset_hint_m(self) -> float:
        """Where the kerb line sits along the map frame's across axis.

        A property of the street, not of the observer: the kerb is half a carriageway from the
        centreline whether the camera is in the near lane, the far lane, or on the footway. An
        earlier version subtracted the observer's own lateral offset, which produced negative
        hints for a camera standing outside the carriageway and would have split the point
        cloud on the wrong side.
        """
        return self.segment.roadway_width_m / 2.0


class StreetMap:
    """A small street network in one local ENU frame."""

    def __init__(self, origin: geo.Origin, segments: list[StreetSegment] | None = None) -> None:
        self._origin = origin
        self._segments = list(segments or [])

    def __len__(self) -> int:
        return len(self._segments)

    @property
    def origin(self) -> geo.Origin:
        return self._origin

    def add(self, segment: StreetSegment) -> None:
        self._segments.append(segment)

    def snap(self, lat: float, lon: float, *, max_distance_m: float = 40.0) -> SnapResult | None:
        """Snap a position to the nearest street, or ``None`` if nothing is near enough.

        Refusing beyond ``max_distance_m`` matters: a capture in a park or a plaza has no street
        to belong to, and forcing it onto the nearest one would attach its measurements to a
        kerb it never saw.
        """
        east, north = geo.geodetic_to_enu(self._origin, lat, lon)
        best: SnapResult | None = None
        best_distance = math.inf

        for segment in self._segments:
            station, lateral, bearing = segment.project(east, north)
            distance = abs(lateral)
            if distance >= best_distance or distance > max_distance_m:
                continue
            position, direction = segment.point_at(station)
            across = np.array([-direction[1], direction[0]])
            side = 1 if lateral >= 0 else -1
            # The across axis always points from the roadway toward this side's footway.
            oriented = across * side
            best_distance = distance
            best = SnapResult(
                segment=segment,
                station_m=station,
                lateral_offset_m=lateral,
                bearing_deg=bearing,
                side=side,
                frame=MapFrame(
                    origin_e=float(position[0]),
                    origin_n=float(position[1]),
                    along=direction,
                    across=oriented,
                    segment_id=segment.segment_id,
                    side=side,
                ),
            )
        return best


def corridor_street_map(corridor: object) -> StreetMap:
    """The street map for a simulated corridor.

    In production this is built from Overture transportation or an Overpass query. Here the
    corridor's own centreline is used, which keeps the simulation honest about the *interface*
    without pretending to test map ingestion.
    """
    length = float(getattr(corridor, "length_m", 100.0))
    segment = StreetSegment(
        segment_id=f"sim:{getattr(corridor, 'corridor_id', 'corridor')}",
        vertices=np.array([[0.0, -4.5], [length, -4.5]]),
        roadway_width_m=9.0,
        name="simulated corridor",
    )
    return StreetMap(corridor.origin, [segment])  # type: ignore[attr-defined]
