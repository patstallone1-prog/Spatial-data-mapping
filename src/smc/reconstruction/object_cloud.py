"""Everything that saw one object, in one frame: the input to fitting its geometry.

Reconstruction here is object-centric. The city is not one mesh to be trusted wholesale; each
object -- a kerb, a bench, a facade -- asks every source what it saw of *that object*, and
gets back points in the object's own east/north/up frame, each point remembering which piece
of evidence it came from. The geometry is then fitted to that cloud and nothing else.

A source that did not see the object says so and why. The photogrammetry source currently
always does: no reconstructed surfaces exist in this repository yet
(``docs/photogrammetry-audit-2026-09.md``), and returning nothing with that reason is the
honest answer until they do.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from smc.reconstruction.geo import EnuFrame
from smc.world.object import EvidenceRef


@dataclass(frozen=True)
class ObjectRegion:
    """Where to look for one object: a frame, and a plan footprint in it (metres)."""

    frame: EnuFrame
    footprint: np.ndarray  # (k, 2) local east/north polygon or polyline
    halo_m: float = 1.0
    semantic_type: str = "unknown"

    def contains(self, local_xy: np.ndarray) -> np.ndarray:
        lo = self.footprint.min(axis=0) - self.halo_m
        hi = self.footprint.max(axis=0) + self.halo_m
        return ((local_xy >= lo) & (local_xy <= hi)).all(axis=1)


@dataclass(frozen=True)
class ObjectCloud:
    """Points on one object, local metres, each tagged with the evidence it came from."""

    frame: EnuFrame
    points: np.ndarray
    weight: np.ndarray
    source: np.ndarray
    refs: tuple[EvidenceRef, ...]
    exact: bool = False

    def __post_init__(self) -> None:
        pts = np.asarray(self.points, dtype=np.float64).reshape(-1, 3)
        n = len(pts)
        object.__setattr__(self, "points", pts)
        object.__setattr__(self, "weight", np.asarray(self.weight, dtype=np.float64).reshape(n))
        object.__setattr__(self, "source", np.asarray(self.source, dtype=np.int64).reshape(n))
        if n and (int(self.source.max()) >= len(self.refs) or int(self.source.min()) < 0):
            raise ValueError("a point cites evidence that is not in the cloud's reference list")

    def __len__(self) -> int:
        return len(self.points)

    @classmethod
    def from_lonlat(cls, frame: EnuFrame, lonlath: np.ndarray, ref: EvidenceRef,
                    weight: np.ndarray | None = None, exact: bool = False) -> ObjectCloud:
        pts = np.asarray(lonlath, dtype=np.float64).reshape(-1, 3)
        local = np.array([frame.to_enu(lon, lat, h) for lon, lat, h in pts]) if len(pts) \
            else np.zeros((0, 3))
        w = np.ones(len(pts)) if weight is None else weight
        return cls(frame, local, w, np.zeros(len(pts), dtype=np.int64), (ref,), exact)

    def merged(self, other: ObjectCloud) -> ObjectCloud:
        """Both clouds in this cloud's frame, their evidence lists concatenated."""
        if other.frame == self.frame:
            moved = other.points
        else:
            # Back to WGS84 through the other frame's origin, then into this one. At object
            # scale the local-tangent approximation is millimetre-exact.
            lat0 = np.radians(other.frame.lat)
            per_lat = 111_132.954 - 559.822 * np.cos(2 * lat0)
            per_lon = 111_412.84 * np.cos(lat0)
            lon = other.frame.lon + other.points[:, 0] / per_lon
            lat = other.frame.lat + other.points[:, 1] / per_lat
            h = other.frame.height_m + other.points[:, 2]
            moved = np.array([self.frame.to_enu(a, b, c)
                              for a, b, c in zip(lon, lat, h, strict=True)])
        return ObjectCloud(self.frame, np.vstack([self.points, moved]),
                           np.concatenate([self.weight, other.weight]),
                           np.concatenate([self.source, other.source + len(self.refs)]),
                           self.refs + other.refs, self.exact and other.exact)

    def subset(self, mask: np.ndarray) -> ObjectCloud:
        return ObjectCloud(self.frame, self.points[mask], self.weight[mask], self.source[mask],
                           self.refs, self.exact)

    def evidence_counts(self) -> dict[int, int]:
        values, counts = np.unique(self.source, return_counts=True)
        return {int(v): int(c) for v, c in zip(values, counts, strict=True)}


class ObservationSource(Protocol):
    """Anything that can say what it saw of one object."""

    name: str

    def observe(self, region: ObjectRegion) -> ObjectCloud | None: ...

    def why_not(self, region: ObjectRegion) -> str: ...


@dataclass
class PointSource:
    """Points already in hand (a lidar cell, a fused cloud, a fixture), tagged with one ref."""

    name: str
    frame: EnuFrame
    points: np.ndarray
    ref: EvidenceRef
    weight: np.ndarray | None = None

    def observe(self, region: ObjectRegion) -> ObjectCloud | None:
        cloud = ObjectCloud(self.frame, self.points,
                            np.ones(len(self.points)) if self.weight is None else self.weight,
                            np.zeros(len(self.points), dtype=np.int64), (self.ref,))
        if cloud.frame != region.frame:
            cloud = ObjectCloud(region.frame, np.zeros((0, 3)), np.zeros(0),
                                np.zeros(0, dtype=np.int64), cloud.refs).merged(cloud)
        inside = region.contains(cloud.points[:, :2])
        return cloud.subset(inside) if inside.any() else None

    def why_not(self, region: ObjectRegion) -> str:
        return f"{self.name}: no points within {region.halo_m} m of the object"


@dataclass
class PhotogrammetrySource:
    """Fused photogrammetric surfaces. There are none yet, and this says so."""

    name: str = "photogrammetry"
    surfaces: list[ObjectCloud] = field(default_factory=list)

    def observe(self, region: ObjectRegion) -> ObjectCloud | None:
        for cloud in self.surfaces:
            if cloud.frame == region.frame:
                inside = region.contains(cloud.points[:, :2])
                if inside.any():
                    return cloud.subset(inside)
        return None

    def why_not(self, region: ObjectRegion) -> str:
        if not self.surfaces:
            return ("photogrammetry: no reconstructed surfaces exist in this repository "
                    "(docs/photogrammetry-audit-2026-09.md)")
        return "photogrammetry: no reconstructed surface covers the object"


def gather(region: ObjectRegion, sources: list[ObservationSource]
           ) -> tuple[ObjectCloud | None, list[tuple[str, str]]]:
    """Ask every source what it saw of the object. Returns the merged cloud and, for every
    source that saw nothing, its reason -- recorded, not dropped."""
    cloud: ObjectCloud | None = None
    silent: list[tuple[str, str]] = []
    for source in sources:
        seen = source.observe(region)
        if seen is None or not len(seen):
            silent.append((source.name, source.why_not(region)))
            continue
        cloud = seen if cloud is None else cloud.merged(seen)
    return cloud, silent
