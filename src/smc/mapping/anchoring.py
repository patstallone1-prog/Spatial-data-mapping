"""The anchoring stack — Step 3 of the fusion engine.

Rough GPS puts a capture on approximately the right block. This turns that into a sub-metre
pose with a heading, by matching the query against already-anchored reference frames whose
keypoints carry known 3D positions, and solving PnP on the correspondences that survive.

Two design choices are worth stating, because both are the difference between a number and a
trustworthy number:

**Correspondences are pooled across several reference frames, not taken from the best one.**
A single reference gives a geometrically weak configuration — its points tend to lie in a thin
slab in front of one camera — and PnP is poorly conditioned on exactly that. Pooling three or
four references from different vantages conditions the problem properly and, more importantly,
makes a single bad reference outvotable instead of decisive.

**Reference uncertainty propagates.** A reference frame is itself only anchored to some sigma,
and a query anchored against it cannot be better. The result's sigma is the solver's own
uncertainty combined with the references it stood on, so error cannot be laundered into
precision by chaining. This is the mechanism that keeps a long chain of mutually anchored
frames from drifting into confident nonsense.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol, runtime_checkable

import numpy as np

from smc import geo
from smc.mapping.pose import (
    Pose,
    pose_covariance,
    position_sigma_m,
    ransac_pnp,
)
from smc.mapping.retrieval import DescriptorIndex, ReferenceFrame

if TYPE_CHECKING:
    from collections.abc import Sequence


@runtime_checkable
class FeatureMatcher(Protocol):
    """Local feature matching between a query and a reference frame.

    Production pairing is **ALIKED (BSD-3) + LightGlue (Apache-2.0)**. SuperPoint and SuperGlue
    are deliberately excluded: they are the default in almost every tutorial and both are
    licensed for non-commercial research only.
    """

    name: str

    def match(
        self, query_keypoints: np.ndarray, reference: ReferenceFrame
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return ``(query_indices, reference_indices)`` of mutual matches."""
        ...


@dataclass(frozen=True, slots=True)
class AnchorResult:
    lat: float
    lon: float
    altitude_m: float
    heading_deg: float
    position_sigma_m: float
    inlier_count: int
    rms_px: float
    reference_ids: tuple[str, ...]
    pose: Pose
    flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_submetre(self) -> bool:
        return self.position_sigma_m < 1.0

    @property
    def tier_b_capable(self) -> bool:
        """Whether this pose is good enough to carry coarse geometry (re-spec 8.3 Tier B)."""
        return self.position_sigma_m <= 1.0 and self.inlier_count >= 20


@dataclass(frozen=True, slots=True)
class AnchoringConfig:
    max_references: int = 4
    min_similarity: float = 0.55
    min_correspondences: int = 12
    ransac_threshold_px: float = 3.0
    min_inliers: int = 15
    #: Reject a pose whose refined position moves further than this from the GPS prior.
    max_prior_displacement_m: float = 40.0
    pixel_sigma: float = 1.0


class AnchoringPipeline:
    """Retrieval, matching, PnP, and the conversion back to latitude and longitude."""

    def __init__(
        self,
        index: DescriptorIndex,
        matcher: FeatureMatcher,
        intrinsics: np.ndarray,
        origin: geo.Origin,
        config: AnchoringConfig | None = None,
    ) -> None:
        self._index = index
        self._matcher = matcher
        self._k = np.asarray(intrinsics, dtype=np.float64)
        self._origin = origin
        self._config = config or AnchoringConfig()

    def anchor(
        self,
        descriptor: np.ndarray,
        keypoints: np.ndarray,
        prior_lat: float,
        prior_lon: float,
        prior_sigma_m: float,
        *,
        rng: np.random.Generator | None = None,
    ) -> AnchorResult | None:
        """Anchor one capture, or return ``None`` if it cannot be anchored confidently.

        Refusing is a first-class outcome. An unanchored frame is simply held back, whereas a
        confidently wrong pose corrupts every fact triangulated from it, and nothing downstream
        can detect that afterwards.
        """
        cfg = self._config
        radius = self._index.radius_for_sigma(prior_sigma_m)
        hits = self._index.search(
            descriptor,
            prior_lat,
            prior_lon,
            radius_m=radius,
            top_k=cfg.max_references,
            min_similarity=cfg.min_similarity,
        )
        if not hits:
            return None

        world_points: list[np.ndarray] = []
        pixels: list[np.ndarray] = []
        used: list[ReferenceFrame] = []

        for hit in hits:
            query_idx, ref_idx = self._matcher.match(keypoints, hit.frame)
            if len(query_idx) == 0:
                continue
            world_points.append(hit.frame.points_world[ref_idx])
            pixels.append(keypoints[query_idx])
            used.append(hit.frame)

        if not world_points:
            return None
        points = np.vstack(world_points)
        uv = np.vstack(pixels)
        if len(points) < cfg.min_correspondences:
            return None

        result = ransac_pnp(
            points,
            uv,
            self._k,
            threshold_px=cfg.ransac_threshold_px,
            min_inliers=cfg.min_inliers,
            rng=rng,
        )
        if result is None:
            return None

        centre = result.pose.camera_centre
        lat, lon = geo.enu_to_geodetic(self._origin, float(centre[0]), float(centre[1]))

        flags: list[str] = []
        displacement = geo.distance_m(prior_lat, prior_lon, lat, lon)
        if displacement > cfg.max_prior_displacement_m:
            # Moving this far from the prior means the retrieval matched a different place.
            # Perceptual aliasing in repetitive streetscapes is the normal cause.
            return None
        if displacement > 3.0 * max(prior_sigma_m, 1.0):
            flags.append("large_prior_correction")

        covariance = pose_covariance(
            points[result.inliers],
            uv[result.inliers],
            self._k,
            result.pose,
            pixel_sigma=cfg.pixel_sigma,
        )
        solver_sigma = position_sigma_m(covariance)
        reference_sigma = self._combined_reference_sigma(used)
        total_sigma = math.sqrt(solver_sigma**2 + reference_sigma**2)

        if not math.isfinite(total_sigma):
            return None
        if total_sigma > prior_sigma_m:
            # Anchoring that makes the estimate worse is not anchoring.
            flags.append("no_improvement_over_prior")

        return AnchorResult(
            lat=lat,
            lon=lon,
            altitude_m=float(centre[2]),
            heading_deg=self._heading_from_pose(result.pose),
            position_sigma_m=total_sigma,
            inlier_count=result.inlier_count,
            rms_px=result.rms_px,
            reference_ids=tuple(f.frame_id for f in used),
            pose=result.pose,
            flags=tuple(flags),
        )

    @staticmethod
    def _combined_reference_sigma(references: Sequence[ReferenceFrame]) -> float:
        """Inverse-variance combination of the references' own uncertainties.

        Not the minimum, and not the mean. Several well-anchored references genuinely constrain
        better than one, but the result can never be better than the best of them by more than
        their independent information allows.
        """
        if not references:
            return math.inf
        precision = sum(1.0 / max(r.position_sigma_m, 1e-6) ** 2 for r in references)
        return math.sqrt(1.0 / precision)

    @staticmethod
    def _heading_from_pose(pose: Pose) -> float:
        """Compass heading of the camera's optical axis, degrees clockwise from north.

        The optical axis is +z in the camera frame; rotating it into the world frame and taking
        its east/north components gives the bearing. Recovering heading at all is half the value
        of anchoring — a position without an orientation cannot say which side of the street a
        curb is on.
        """
        forward_world = pose.rotation.T @ np.array([0.0, 0.0, 1.0])
        bearing = math.degrees(math.atan2(forward_world[0], forward_world[1]))
        return bearing % 360.0
