"""Metric scale recovery — the load-bearing module.

Monocular structure-from-motion recovers geometry only up to an unknown scale factor. Every
Tier B number the product sells is metric. So the entire coarse-geometry tier rests on this
one estimate, and the published evidence agrees: UrbanVGGT's ablation found metric scale
calibration to be the single most critical component of an otherwise similar pipeline.

Five independent sources can supply scale, and they fail in genuinely different ways, which is
the reason to fuse rather than pick one:

* **Stereo baseline** — exact and independent of the scene, but only on the vehicle rig, and
  its precision collapses as range squared.
* **Camera height** — available to a wearer, needs a visible ground plane, and inherits the
  error in the assumed eye height.
* **Metric depth model** — always available, degrades past ~20 m, and is biased by scene
  content rather than by geometry.
* **Known-dimension objects** — very precise when a standard object is in frame and correctly
  identified, and catastrophically wrong when it is misidentified.
* **GNSS baseline over a pass** — unbiased over long runs, useless over short ones.

They are fused by inverse-variance weighting after robust outlier rejection, and the result
carries a consistency test. **Disagreement is reported, never averaged away.** Two sources
that disagree beyond their stated uncertainties mean one of them is wrong, and quietly
returning the mean of a right answer and a wrong one is how a pipeline produces a confident,
incorrect measurement — the exact failure the re-spec's "measurement wins, flag the conflict"
rule exists to prevent.
"""

from __future__ import annotations

import enum
import math
from dataclasses import dataclass, field

import numpy as np


class ScaleSource(enum.StrEnum):
    STEREO_BASELINE = "stereo_baseline"
    CAMERA_HEIGHT = "camera_height"
    METRIC_DEPTH = "metric_depth"
    KNOWN_OBJECT = "known_object"
    GNSS_BASELINE = "gnss_baseline"


#: Sources whose error is independent of the reconstruction itself. At least one is required
#: before a scale estimate may be called measured — the others can all be wrong together if the
#: reconstruction is wrong, and would then agree with each other convincingly.
_INDEPENDENT_SOURCES = frozenset({ScaleSource.STEREO_BASELINE, ScaleSource.KNOWN_OBJECT})


@dataclass(frozen=True, slots=True)
class ScaleObservation:
    """One estimate of the metric scale factor, with its uncertainty.

    ``scale`` multiplies reconstruction units to give metres, so 1.0 means the reconstruction
    is already metric.
    """

    source: ScaleSource
    scale: float
    sigma: float
    #: Free-text identity of the supporting evidence, for provenance.
    evidence: str = ""

    def __post_init__(self) -> None:
        if not math.isfinite(self.scale) or self.scale <= 0.0:
            raise ValueError(f"scale must be finite and positive, got {self.scale}")
        if not math.isfinite(self.sigma) or self.sigma <= 0.0:
            raise ValueError(f"sigma must be finite and positive, got {self.sigma}")

    @property
    def precision(self) -> float:
        return 1.0 / (self.sigma**2)


@dataclass(frozen=True, slots=True)
class ScaleEstimate:
    """A fused scale, and everything needed to decide whether to trust it."""

    scale: float
    sigma: float
    used: tuple[ScaleObservation, ...]
    rejected: tuple[ScaleObservation, ...] = ()
    #: Reduced chi-squared of the used observations about the fused value.
    chi2_reduced: float = 0.0
    flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def consistent(self) -> bool:
        """Whether the sources agree within their stated uncertainties."""
        return "scale_disagreement" not in self.flags

    @property
    def has_independent_anchor(self) -> bool:
        return any(o.source in _INDEPENDENT_SOURCES for o in self.used)

    @property
    def relative_sigma(self) -> float:
        return self.sigma / self.scale

    def depth_tolerance_at(self, range_m: float) -> float:
        """Metric error contributed by scale uncertainty alone at a given range.

        Scale error is *multiplicative*: it grows linearly with distance. A 2% scale error is
        3 cm at 1.5 m and 24 cm at 12 m, which is why a scale estimate that looks acceptable
        on a nearby test object can still fail Tier B at kerb range.
        """
        return range_m * self.relative_sigma

    def max_range_for_tolerance(self, tolerance_m: float) -> float:
        """Range beyond which scale uncertainty alone breaches a tolerance."""
        if tolerance_m <= 0:
            raise ValueError("tolerance_m must be positive")
        if self.relative_sigma == 0.0:
            return math.inf
        return tolerance_m / self.relative_sigma


class ScaleEstimator:
    """Robust inverse-variance fusion of scale observations."""

    def __init__(
        self,
        *,
        outlier_threshold_mad: float = 3.5,
        disagreement_chi2: float = 4.0,
        require_independent_anchor: bool = True,
    ) -> None:
        self._outlier_threshold = outlier_threshold_mad
        self._disagreement_chi2 = disagreement_chi2
        self._require_independent = require_independent_anchor

    def fuse(self, observations: list[ScaleObservation]) -> ScaleEstimate:
        if not observations:
            raise ValueError("at least one scale observation is required")

        kept, rejected = self._reject_outliers(observations)
        # Outlier rejection can only be trusted with enough votes to form a consensus.
        if len(kept) < 2:
            kept, rejected = observations, []

        precisions = np.array([o.precision for o in kept])
        scales = np.array([o.scale for o in kept])
        total_precision = float(precisions.sum())
        fused = float((precisions * scales).sum() / total_precision)
        sigma = float(math.sqrt(1.0 / total_precision))

        chi2 = float(
            sum(((o.scale - fused) / o.sigma) ** 2 for o in kept)
        )
        dof = max(1, len(kept) - 1)
        chi2_reduced = chi2 / dof

        flags: list[str] = []
        if chi2_reduced > self._disagreement_chi2:
            # Do not average a right answer with a wrong one and call it measured.
            flags.append("scale_disagreement")
            # Inflate the uncertainty to reflect the scatter actually observed, rather than
            # the optimistic value the weights alone imply.
            sigma *= math.sqrt(chi2_reduced)
        if rejected:
            flags.append("scale_outliers_rejected")
        if self._require_independent and not any(
            o.source in _INDEPENDENT_SOURCES for o in kept
        ):
            flags.append("no_independent_scale_anchor")

        return ScaleEstimate(
            scale=fused,
            sigma=sigma,
            used=tuple(kept),
            rejected=tuple(rejected),
            chi2_reduced=chi2_reduced,
            flags=tuple(flags),
        )

    def _reject_outliers(
        self, observations: list[ScaleObservation]
    ) -> tuple[list[ScaleObservation], list[ScaleObservation]]:
        """Median-absolute-deviation rejection.

        MAD rather than a standard-deviation rule because a single badly misidentified object
        can be wrong by a factor of two, and that one observation would inflate an SD-based
        threshold enough to shelter itself.
        """
        if len(observations) < 3:
            return list(observations), []

        scales = np.array([o.scale for o in observations])
        median = float(np.median(scales))
        mad = float(np.median(np.abs(scales - median)))
        if mad == 0.0:
            return list(observations), []

        # 1.4826 makes MAD a consistent estimator of sigma for normal data.
        robust_sigma = 1.4826 * mad
        kept: list[ScaleObservation] = []
        rejected: list[ScaleObservation] = []
        for obs in observations:
            if abs(obs.scale - median) / robust_sigma > self._outlier_threshold:
                rejected.append(obs)
            else:
                kept.append(obs)
        return kept, rejected


# --- Source constructors ------------------------------------------------------------------


def from_stereo_baseline(
    measured_units: float, true_baseline_m: float, sigma_units: float
) -> ScaleObservation:
    """Scale from a rigid stereo pair of known separation. The vehicle rig's anchor."""
    if measured_units <= 0:
        raise ValueError("measured_units must be positive")
    scale = true_baseline_m / measured_units
    return ScaleObservation(
        source=ScaleSource.STEREO_BASELINE,
        scale=scale,
        sigma=scale * (sigma_units / measured_units),
        evidence=f"baseline {true_baseline_m:.3f} m",
    )


def from_camera_height(
    measured_units: float, assumed_height_m: float, height_sigma_m: float
) -> ScaleObservation:
    """Scale from the camera's height above the fitted ground plane.

    The wearer's counterpart to the stereo baseline, and the method UrbanVGGT found decisive.
    Its accuracy is bounded by how well eye height is known — which a short calibration walk
    can pin down far better than a population average, and should.
    """
    if measured_units <= 0:
        raise ValueError("measured_units must be positive")
    scale = assumed_height_m / measured_units
    return ScaleObservation(
        source=ScaleSource.CAMERA_HEIGHT,
        scale=scale,
        sigma=scale * (height_sigma_m / assumed_height_m),
        evidence=f"camera height {assumed_height_m:.3f} m",
    )


def from_known_object(
    measured_units: float, true_size_m: float, size_sigma_m: float, label: str
) -> ScaleObservation:
    """Scale from an object of standard dimensions — a curb face, a dome field, a sign.

    Precise when the identification is right and badly wrong when it is not, which is why the
    fuser rejects outliers before weighting rather than after.
    """
    if measured_units <= 0:
        raise ValueError("measured_units must be positive")
    scale = true_size_m / measured_units
    return ScaleObservation(
        source=ScaleSource.KNOWN_OBJECT,
        scale=scale,
        sigma=scale * (size_sigma_m / true_size_m),
        evidence=label,
    )


def from_gnss_baseline(
    measured_units: float, gnss_distance_m: float, position_sigma_m: float
) -> ScaleObservation:
    """Scale from distance travelled between two fixes.

    Two fixes with independent errors give a distance whose sigma is sqrt(2) times the position
    sigma, so this is worthless over short runs and only becomes informative once the travelled
    distance is large compared with the position noise.
    """
    if measured_units <= 0:
        raise ValueError("measured_units must be positive")
    if gnss_distance_m <= 0:
        raise ValueError("gnss_distance_m must be positive")
    scale = gnss_distance_m / measured_units
    distance_sigma = position_sigma_m * math.sqrt(2.0)
    return ScaleObservation(
        source=ScaleSource.GNSS_BASELINE,
        scale=scale,
        sigma=scale * (distance_sigma / gnss_distance_m),
        evidence=f"{gnss_distance_m:.1f} m travelled",
    )


def from_metric_depth(
    measured_units: float, predicted_depth_m: float, relative_sigma: float = 0.10
) -> ScaleObservation:
    """Scale from a metric monocular depth model (DA3METRIC-LARGE and similar).

    Relative uncertainty rather than absolute because these models' error scales with predicted
    depth, and it should be widened beyond about 20 m where they are known to degrade.
    """
    if measured_units <= 0 or predicted_depth_m <= 0:
        raise ValueError("measured_units and predicted_depth_m must be positive")
    scale = predicted_depth_m / measured_units
    return ScaleObservation(
        source=ScaleSource.METRIC_DEPTH,
        scale=scale,
        sigma=scale * relative_sigma,
        evidence=f"predicted {predicted_depth_m:.2f} m",
    )
