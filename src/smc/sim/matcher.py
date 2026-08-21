"""A matcher oracle for simulation.

**This is not a feature matcher and must never ship.** It establishes correspondences by
consulting the rendered world buffer — that is, by knowing the answer. Production is ALIKED
(BSD-3) plus LightGlue (Apache-2.0), which have to earn their matches from pixels.

It exists so the rest of the pipeline can be tested for correctness *today*: PnP conditioning,
covariance, sigma propagation, the prior-displacement guard, retrieval integration, and the
capture and ingest layers around them. What it deliberately cannot tell you is whether real
matching survives a repetitive streetscape — the open question named in docs/07-status.md.
Every accuracy figure produced with this matcher is an upper bound.

It is honest in two respects that matter: it only returns points genuinely visible in the query
view, and it injects a controllable rate of wrong matches, because a downstream stage that
cannot tolerate outliers would look perfect against a clean oracle and fail immediately on
real matching.
"""

from __future__ import annotations

import numpy as np

from smc.mapping.retrieval import ReferenceFrame
from smc.render.raster import RenderResult


class OracleMatcher:
    """Correspondences read from the query's world buffer."""

    name = "oracle"

    def __init__(
        self,
        query_render: RenderResult,
        *,
        tolerance_m: float = 0.35,
        outlier_rate: float = 0.15,
        max_matches: int = 300,
        seed: int = 0,
    ) -> None:
        self._render = query_render
        self._tolerance_m = tolerance_m
        self._outlier_rate = outlier_rate
        self._max_matches = max_matches
        self._rng = np.random.default_rng(seed)

        finite = np.isfinite(query_render.depth)
        self._pixel_ys, self._pixel_xs = np.nonzero(finite)
        self._visible_world = query_render.world[finite]

    def match(
        self, query_keypoints: np.ndarray, reference: ReferenceFrame
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return indices into ``query_keypoints`` and into the reference's points.

        ``query_keypoints`` is expected to be the pixel grid this matcher was built from, which
        the pipeline supplies via :meth:`keypoints`.
        """
        if len(self._visible_world) == 0:
            return np.zeros(0, dtype=int), np.zeros(0, dtype=int)

        query_idx: list[int] = []
        ref_idx: list[int] = []
        budget = min(self._max_matches, len(reference.points_world))
        candidates = self._rng.choice(len(reference.points_world), size=budget, replace=False)

        for r in candidates:
            target = reference.points_world[r]
            distances = np.linalg.norm(self._visible_world - target, axis=1)
            nearest = int(np.argmin(distances))
            if distances[nearest] > self._tolerance_m:
                continue
            if self._rng.random() < self._outlier_rate:
                # A plausible-looking wrong match, the kind real matching produces on a
                # repeating facade — not random noise, which RANSAC finds trivially easy.
                nearest = int(self._rng.integers(0, len(self._visible_world)))
            query_idx.append(nearest)
            ref_idx.append(int(r))

        return np.array(query_idx, dtype=int), np.array(ref_idx, dtype=int)

    def keypoints(self) -> np.ndarray:
        """Pixel coordinates the match indices refer to."""
        return np.c_[self._pixel_xs.astype(np.float64), self._pixel_ys.astype(np.float64)]
