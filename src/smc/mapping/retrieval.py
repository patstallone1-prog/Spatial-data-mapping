"""Image retrieval — finding which captures show the same place.

Step 4 of the fusion engine. The production descriptor is MegaLoc (DINOv2-base with a SALAD
aggregation layer, state of the art across visual place recognition, landmark retrieval, and
visual localization on LaMAR). The index itself is provider-agnostic: descriptors are unit
vectors and search is cosine similarity, so the maths is identical whether the backend is FAISS
or the exact NumPy path used here.

FAISS is optional on purpose. An exact search over a pilot corridor's descriptors is
milliseconds and is *exactly* correct, which makes it the right thing to test recall against;
FAISS is an optimisation for a later index size, not a dependency for correctness.

A geographic prefilter runs before descriptor search. Even a 5 m position is enough to exclude
almost the whole database, and doing so removes the failure mode that matters most here:
matching a query to a visually identical location somewhere else in the city. Repetitive
streetscapes make that failure common, not exotic.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from smc import geo


@dataclass(frozen=True, slots=True)
class ReferenceFrame:
    """An already-anchored frame, with the 3D structure it observed.

    ``points_world`` and ``points_2d`` are the correspondences a query frame can inherit: match
    the query against this frame's keypoints, and the matched keypoints carry known 3D
    positions, which is what makes PnP possible without any depth sensor.
    """

    frame_id: str
    lat: float
    lon: float
    descriptor: np.ndarray
    points_world: np.ndarray
    points_2d: np.ndarray
    #: How well this reference is itself anchored. Error propagates.
    position_sigma_m: float = 0.5
    source: str = "owned"

    def __post_init__(self) -> None:
        descriptor = np.asarray(self.descriptor, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(descriptor))
        if norm < 1e-9:
            raise ValueError("descriptor has zero norm")
        object.__setattr__(self, "descriptor", descriptor / norm)
        points_world = np.asarray(self.points_world, dtype=np.float64).reshape(-1, 3)
        points_2d = np.asarray(self.points_2d, dtype=np.float64).reshape(-1, 2)
        if len(points_world) != len(points_2d):
            raise ValueError("points_world and points_2d must have the same length")
        object.__setattr__(self, "points_world", points_world)
        object.__setattr__(self, "points_2d", points_2d)


@dataclass(frozen=True, slots=True)
class RetrievalHit:
    frame: ReferenceFrame
    similarity: float
    distance_m: float


class DescriptorIndex:
    """Geographic prefilter, then cosine similarity over descriptors."""

    def __init__(self, frames: list[ReferenceFrame] | None = None) -> None:
        self._frames: list[ReferenceFrame] = list(frames or [])

    def __len__(self) -> int:
        return len(self._frames)

    def add(self, frame: ReferenceFrame) -> None:
        self._frames.append(frame)

    def search(
        self,
        descriptor: np.ndarray,
        lat: float,
        lon: float,
        *,
        radius_m: float = 60.0,
        top_k: int = 10,
        min_similarity: float = 0.5,
    ) -> list[RetrievalHit]:
        """Candidates near ``(lat, lon)``, ranked by descriptor similarity.

        ``radius_m`` should be set from the *query's* position uncertainty, not from a constant.
        Too tight and a genuinely correct match outside the radius is never considered; too
        loose and the perceptual-aliasing failure comes back.
        """
        if not self._frames:
            return []
        query = np.asarray(descriptor, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(query))
        if norm < 1e-9:
            raise ValueError("query descriptor has zero norm")
        query = query / norm

        hits: list[RetrievalHit] = []
        for frame in self._frames:
            distance = geo.distance_m(lat, lon, frame.lat, frame.lon)
            if distance > radius_m:
                continue
            if frame.descriptor.shape != query.shape:
                raise ValueError(
                    f"descriptor dimension mismatch: index {frame.descriptor.shape}, "
                    f"query {query.shape}"
                )
            similarity = float(np.dot(query, frame.descriptor))
            if similarity >= min_similarity:
                hits.append(RetrievalHit(frame, similarity, distance))

        hits.sort(key=lambda h: h.similarity, reverse=True)
        return hits[:top_k]

    def radius_for_sigma(self, position_sigma_m: float, *, n_sigma: float = 3.0) -> float:
        """Search radius that will contain the true position with high probability."""
        if position_sigma_m < 0:
            raise ValueError("position_sigma_m must be non-negative")
        return max(15.0, n_sigma * position_sigma_m)
