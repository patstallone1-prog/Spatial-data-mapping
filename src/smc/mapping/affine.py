"""Affine view simulation — bridging the vantage gap.

The measured failure this exists to fix: a reference index built from a roadway survey anchors
roadway captures to 34 mm and footway captures **not at all**, zero of fifteen. SIFT tolerates
roughly 30 degrees of viewpoint change on a planar surface; a camera on a car dash and a camera
on a wearer's face, four metres apart laterally and a third of a metre higher, exceed that
against an oblique kerb and facade.

The classical fix is ASIFT: rather than hoping the descriptor is invariant to viewpoint,
*simulate* the viewpoints. Warp the reference image through a range of camera tilts and
rotations, detect features on each warp, and map their coordinates back to the original frame.
The index then holds, for one physical place, descriptors as they would appear from several
directions — so a query taken from any of them has something to match.

The trade is explicit and it is the right way round for this system:

* Index build costs one detection pass per simulated view. That happens once, offline, on the
  survey pass, on a machine with time to spare.
* Query cost is unchanged. The wearer's phone still detects once.
* The index grows by roughly the number of simulated views. Storage is cheap; a corridor that
  cannot be anchored at all is not.

This does not replace surveying the footway. It reduces how often you must: a rig that drives
the lane can now anchor captures from the pavement, and a corridor that matters enough gets
walked as well.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from smc.mapping.features import FeatureConfig, Features, detect


@dataclass(frozen=True, slots=True)
class AffineView:
    """One simulated viewpoint: a tilt away from frontal, rotated to a compass direction."""

    #: Tilt factor. 1.0 is the original view; larger is a more oblique viewing angle.
    tilt: float
    #: Rotation of the tilt axis, degrees.
    longitude_deg: float

    @property
    def is_identity(self) -> bool:
        return abs(self.tilt - 1.0) < 1e-6 and abs(self.longitude_deg) < 1e-6

    @property
    def viewing_angle_deg(self) -> float:
        """Angle away from frontal that this tilt corresponds to."""
        return math.degrees(math.acos(1.0 / max(self.tilt, 1.0)))


def default_views(max_tilt: float = 2.0, tilt_steps: int = 2) -> tuple[AffineView, ...]:
    """A reduced ASIFT sampling: the frontal view plus a ring of tilts.

    Full ASIFT samples tilts in powers of sqrt(2) up to 8, with longitude steps that get finer
    as tilt grows — dozens of views per image. That is built for matching arbitrary photographs
    of the same building. Here the geometry is known and constrained: the query is a camera at
    human or dash height looking along a street, so the useful tilts are moderate and the
    interesting rotations are roughly horizontal. Two tilts at four longitudes covers the
    roadway-to-footway gap at a fraction of the cost.
    """
    views = [AffineView(1.0, 0.0)]
    for step in range(1, tilt_steps + 1):
        tilt = 1.0 + (max_tilt - 1.0) * step / tilt_steps
        longitudes = np.arange(0.0, 180.0, 180.0 / (2 * step + 2))
        views.extend(AffineView(tilt, float(lon)) for lon in longitudes)
    return tuple(views)


def simulate_view(image: np.ndarray, view: AffineView) -> tuple[np.ndarray, np.ndarray]:
    """Warp an image to a simulated viewpoint.

    Returns the warped image and the 2x3 affine that maps original pixels into it, so detected
    keypoints can be mapped back to where they actually are in the reference frame.
    """
    import cv2

    array = np.asarray(image)
    if view.is_identity:
        return array, np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])

    height, width = array.shape[:2]
    transform = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
    working = array

    if view.longitude_deg != 0.0:
        rotation = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), view.longitude_deg, 1.0)
        corners = np.array(
            [[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float64
        )
        rotated = corners @ rotation[:, :2].T + rotation[:, 2]
        low = rotated.min(axis=0)
        high = rotated.max(axis=0)
        rotation[:, 2] -= low
        size = (int(np.ceil(high[0] - low[0])), int(np.ceil(high[1] - low[1])))
        working = cv2.warpAffine(working, rotation, size, flags=cv2.INTER_LINEAR)
        transform = rotation

    if view.tilt > 1.0:
        # A tilt compresses one axis. Blurring first is not optional: subsampling a sharp image
        # aliases, and aliased detail produces keypoints that exist in the warp and nowhere in
        # the real world.
        sigma = 0.8 * math.sqrt(view.tilt**2 - 1.0)
        working = cv2.GaussianBlur(working, (0, 0), sigmaX=sigma, sigmaY=0.01)
        working = cv2.resize(
            working,
            (round(working.shape[1] / view.tilt), working.shape[0]),
            interpolation=cv2.INTER_LINEAR,
        )
        scale = np.array([[1.0 / view.tilt, 0.0, 0.0], [0.0, 1.0, 0.0]])
        transform = _compose(scale, transform)

    return working, transform


def _compose(second: np.ndarray, first: np.ndarray) -> np.ndarray:
    """Compose two 2x3 affines: apply ``first``, then ``second``."""
    a = np.vstack([first, [0.0, 0.0, 1.0]])
    b = np.vstack([second, [0.0, 0.0, 1.0]])
    return (b @ a)[:2]


def _invert(transform: np.ndarray) -> np.ndarray:
    import cv2

    return cv2.invertAffineTransform(transform)


def detect_multi_view(
    image: np.ndarray,
    config: FeatureConfig | None = None,
    views: tuple[AffineView, ...] | None = None,
) -> Features:
    """Detect features across simulated viewpoints, in original-image coordinates.

    Every keypoint is reported at its true position in the reference frame, whichever simulated
    view found it — so downstream PnP receives ordinary 2D-3D correspondences and never needs to
    know this happened.
    """
    config = config or FeatureConfig()
    views = views or default_views()

    keypoints: list[np.ndarray] = []
    descriptors: list[np.ndarray] = []
    responses: list[np.ndarray] = []

    for view in views:
        warped, transform = simulate_view(image, view)
        found = detect(warped, config)
        if len(found) == 0:
            continue
        inverse = _invert(transform)
        points = found.keypoints @ inverse[:, :2].T + inverse[:, 2]

        # A warp can push keypoints outside the original frame; those have no real position.
        height, width = np.asarray(image).shape[:2]
        inside = (
            (points[:, 0] >= 0) & (points[:, 0] < width)
            & (points[:, 1] >= 0) & (points[:, 1] < height)
        )
        keypoints.append(points[inside])
        descriptors.append(found.descriptors[inside])
        responses.append(found.responses[inside])

    if not keypoints:
        return detect(image, config)

    return Features(
        keypoints=np.vstack(keypoints),
        descriptors=np.vstack(descriptors),
        responses=np.concatenate(responses),
        detector=config.detector,
    )
