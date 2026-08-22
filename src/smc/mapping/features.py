"""Local feature detection and matching — real pixels, no oracle.

This replaces :class:`~smc.sim.matcher.OracleMatcher`, which read correspondences from the
renderer's depth buffer. Everything here earns its matches from image content alone, which
means every accuracy figure downstream stops being an upper bound and starts being a
measurement.

**On the detector choice.** Production intent is ALIKED (BSD-3) plus LightGlue (Apache-2.0);
both need PyTorch and downloaded weights. SIFT and ORB ship inside OpenCV, need no weights, run
on a CPU, and are the honest classical baseline the learned pair is measured against. They are
also licence-clean, which is not a footnote in this project: SIFT's patent expired in 2020 and
ORB is BSD, whereas the SuperPoint/SuperGlue pairing that most tutorials reach for is licensed
for non-commercial research only.

Starting classical is deliberate rather than a compromise. If the pipeline cannot anchor with
SIFT, the problem is unlikely to be the detector, and swapping in a learned front end would
hide that rather than fix it.

**Matching is deliberately conservative.** Three filters run in series and each throws away good
matches to remove bad ones:

* **Lowe's ratio test** — a descriptor whose best and second-best matches are similarly good is
  ambiguous, and on a street of repeating windows that is the common case, not the exception.
* **Mutual nearest neighbour** — a match must be each side's best. One-directional matching
  quietly maps many query points onto one reference point.
* **Geometric verification** — a fundamental-matrix RANSAC pass before the correspondences ever
  reach PnP.

Being conservative costs yield and buys the thing that matters: a frame that fails to anchor is
withheld, whereas a frame anchored on false matches poisons every fact triangulated from it and
nothing downstream can detect it afterwards.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass

import numpy as np

from smc.mapping.retrieval import ReferenceFrame


class Detector(enum.StrEnum):
    SIFT = "sift"
    ORB = "orb"


@dataclass(frozen=True, slots=True)
class FeatureConfig:
    detector: Detector = Detector.SIFT
    max_features: int = 2000
    #: Lowe's ratio. 0.75 is the usual default; lower is stricter.
    ratio: float = 0.75
    #: Require each match to be the other side's best too.
    mutual: bool = True
    #: Fundamental-matrix RANSAC threshold, pixels. None disables geometric verification.
    geometric_threshold_px: float | None = 2.5
    #: Below this many surviving matches the pair is not worth passing to PnP.
    min_matches: int = 12
    #: SIFT contrast threshold. Lower finds more features on flat surfaces like concrete.
    contrast_threshold: float = 0.02
    #: Edge threshold. Kerb lines are edges, so this is loosened from the OpenCV default.
    edge_threshold: float = 12.0


@dataclass(frozen=True, slots=True)
class Features:
    """Detected keypoints and their descriptors for one image."""

    keypoints: np.ndarray  # (N, 2) pixel coordinates
    descriptors: np.ndarray  # (N, D)
    responses: np.ndarray  # (N,) detector strength
    detector: Detector

    def __len__(self) -> int:
        return len(self.keypoints)

    @property
    def is_binary(self) -> bool:
        """ORB descriptors are binary and need Hamming distance, not L2."""
        return self.detector is Detector.ORB


def _grayscale(image: np.ndarray) -> np.ndarray:
    array = np.asarray(image)
    if array.ndim == 3:
        array = array @ np.array([0.114, 0.587, 0.299])  # OpenCV order is BGR-ish; luma is luma
    return np.clip(array, 0, 255).astype(np.uint8)


def detect(image: np.ndarray, config: FeatureConfig | None = None) -> Features:
    """Detect and describe features in an image.

    Raises if OpenCV is absent rather than silently degrading: a pipeline that quietly falls
    back to a weaker detector would produce accuracy numbers nobody could interpret.
    """
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "feature detection needs opencv-python-headless; install it or select the "
            "simulation oracle explicitly"
        ) from exc

    config = config or FeatureConfig()
    gray = _grayscale(image)

    if config.detector is Detector.SIFT:
        engine = cv2.SIFT_create(
            nfeatures=config.max_features,
            contrastThreshold=config.contrast_threshold,
            edgeThreshold=config.edge_threshold,
        )
    else:
        engine = cv2.ORB_create(nfeatures=config.max_features)

    keypoints, descriptors = engine.detectAndCompute(gray, None)
    if descriptors is None or len(keypoints) == 0:
        empty_dim = 128 if config.detector is Detector.SIFT else 32
        return Features(
            keypoints=np.zeros((0, 2)),
            descriptors=np.zeros((0, empty_dim), dtype=np.float32),
            responses=np.zeros(0),
            detector=config.detector,
        )

    return Features(
        keypoints=np.array([kp.pt for kp in keypoints], dtype=np.float64),
        descriptors=np.asarray(descriptors),
        responses=np.array([kp.response for kp in keypoints], dtype=np.float64),
        detector=config.detector,
    )


def match_features(
    query: Features, reference: Features, config: FeatureConfig | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """Match two feature sets. Returns aligned index arrays into each."""
    import cv2

    config = config or FeatureConfig()
    if len(query) == 0 or len(reference) == 0:
        return np.zeros(0, dtype=int), np.zeros(0, dtype=int)
    if query.detector is not reference.detector:
        raise ValueError(
            f"cannot match {query.detector} against {reference.detector} descriptors"
        )

    norm = cv2.NORM_HAMMING if query.is_binary else cv2.NORM_L2
    matcher = cv2.BFMatcher(norm)

    def ratio_filtered(src: np.ndarray, dst: np.ndarray) -> dict[int, int]:
        pairs = matcher.knnMatch(src.astype(np.float32 if norm == cv2.NORM_L2 else np.uint8), 
                                 dst.astype(np.float32 if norm == cv2.NORM_L2 else np.uint8), k=2)
        keep: dict[int, int] = {}
        for candidates in pairs:
            if len(candidates) < 2:
                continue
            best, second = candidates[0], candidates[1]
            if best.distance < config.ratio * second.distance:
                keep[best.queryIdx] = best.trainIdx
        return keep

    forward = ratio_filtered(query.descriptors, reference.descriptors)
    if config.mutual:
        backward = ratio_filtered(reference.descriptors, query.descriptors)
        forward = {q: r for q, r in forward.items() if backward.get(r) == q}

    if not forward:
        return np.zeros(0, dtype=int), np.zeros(0, dtype=int)

    query_idx = np.array(sorted(forward), dtype=int)
    ref_idx = np.array([forward[i] for i in query_idx], dtype=int)

    if config.geometric_threshold_px is not None and len(query_idx) >= 8:
        query_idx, ref_idx = _geometric_filter(
            query.keypoints[query_idx],
            reference.keypoints[ref_idx],
            query_idx,
            ref_idx,
            config.geometric_threshold_px,
        )

    return query_idx, ref_idx


def _geometric_filter(
    query_points: np.ndarray,
    reference_points: np.ndarray,
    query_idx: np.ndarray,
    ref_idx: np.ndarray,
    threshold_px: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Drop matches inconsistent with a single epipolar geometry.

    A cheap, strong prior: two views of one rigid scene are related by a fundamental matrix, and
    a repeating-facade mismatch usually is not. Runs before PnP so the pose solver receives a
    cleaner set than the descriptors alone produce.
    """
    import cv2

    fundamental, mask = cv2.findFundamentalMat(
        query_points.astype(np.float32),
        reference_points.astype(np.float32),
        cv2.FM_RANSAC,
        threshold_px,
        0.995,
    )
    if fundamental is None or mask is None:
        return query_idx, ref_idx
    keep = mask.ravel().astype(bool)
    if keep.sum() < 8:
        return query_idx, ref_idx
    return query_idx[keep], ref_idx[keep]


class OpenCVMatcher:
    """A real :class:`~smc.mapping.anchoring.FeatureMatcher`.

    Holds the query image's features once and matches them against each retrieved reference.
    Reference frames must carry ``local_descriptors``; a frame seeded without them cannot be
    matched against and is skipped rather than silently contributing nothing.
    """

    def __init__(self, query_image: np.ndarray, config: FeatureConfig | None = None) -> None:
        self._config = config or FeatureConfig()
        self._features = detect(query_image, self._config)
        self.name = f"opencv:{self._config.detector}"

    @property
    def features(self) -> Features:
        return self._features

    def keypoints(self) -> np.ndarray:
        """Pixel coordinates the match indices refer to."""
        return self._features.keypoints

    def match(
        self, query_keypoints: np.ndarray, reference: ReferenceFrame
    ) -> tuple[np.ndarray, np.ndarray]:
        descriptors = reference.local_descriptors
        if descriptors is None or len(descriptors) == 0:
            return np.zeros(0, dtype=int), np.zeros(0, dtype=int)

        reference_features = Features(
            keypoints=reference.points_2d,
            descriptors=descriptors,
            responses=np.zeros(len(descriptors)),
            detector=self._config.detector,
        )
        query_idx, ref_idx = match_features(self._features, reference_features, self._config)
        if len(query_idx) < self._config.min_matches:
            return np.zeros(0, dtype=int), np.zeros(0, dtype=int)
        return query_idx, ref_idx


def match_statistics(
    query: Features, reference: Features, config: FeatureConfig | None = None
) -> dict[str, float]:
    """Diagnostics for one pair. Used by the calibration harness."""
    config = config or FeatureConfig()
    query_idx, _ = match_features(query, reference, config)
    return {
        "query_features": float(len(query)),
        "reference_features": float(len(reference)),
        "matches": float(len(query_idx)),
        "match_rate": float(len(query_idx) / max(len(query), 1)),
    }
