"""Confidence, corroboration, and freshness decay.

The promotion rule from the re-spec, made executable: a fact is served as measured and
high-confidence only after N *independent* contributors corroborate it and it clears its tier's
bar. Below that it is inferred, or withheld.

Independence is counted by contributor, not by frame. A single wearer walking a block at 4 Hz
produces dozens of views of the same curb, and they share a device, a calibration, a moment of
weather, and one GNSS bias — the correlated bias being the reason a long burst cannot average
its way to accuracy. Treating those as dozens of corroborations would manufacture confidence
out of a single observer, which is the most dangerous failure mode available to a system whose
whole pitch is corroborated measurement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from smc.facts.schema import Provenance, Tier


@dataclass(frozen=True, slots=True)
class Observation:
    """One contributor's measurement of one fact."""

    contributor_id: str
    value: float
    #: Reported 1-sigma uncertainty of this observation.
    sigma: float
    observed_at: datetime
    #: Reprojection or fit residual, in pixels. High residual means poor geometry.
    residual_px: float = 0.0
    #: Relative uncertainty of the metric scale this observation was reconstructed under.
    scale_relative_sigma: float = 0.0

    def __post_init__(self) -> None:
        if self.sigma <= 0:
            raise ValueError("sigma must be positive")
        if self.observed_at.tzinfo is None:
            raise ValueError("observed_at must be timezone-aware")


@dataclass(frozen=True, slots=True)
class FusedValue:
    """The result of fusing observations of one fact."""

    value: float
    sigma: float
    confidence: float
    provenance: Provenance
    corroboration_count: int
    contributor_count: int
    freshest_at: datetime
    flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def servable_as_measured(self) -> bool:
        return self.provenance is Provenance.MEASURED


@dataclass(frozen=True, slots=True)
class ConfidenceModel:
    """Turns a set of observations into a confidence and a provenance."""

    #: Independent contributors required before a fact may be called measured.
    min_contributors_for_measured: int = 3
    #: Residual above which geometry is considered poor.
    residual_tolerance_px: float = 2.0
    #: Scale uncertainty above which no geometric fact should be called measured.
    max_scale_relative_sigma: float = 0.05
    #: Time over which confidence decays to 1/e without re-observation.
    freshness_tau: timedelta = timedelta(days=45)
    #: Confidence floor below which a fact is withheld rather than served.
    withhold_below: float = 0.15

    def fuse(
        self, observations: list[Observation], *, tier: Tier, now: datetime | None = None
    ) -> FusedValue:
        if not observations:
            raise ValueError("at least one observation is required")
        now = now or datetime.now(UTC)

        contributors = {o.contributor_id for o in observations}
        # Down-weight repeat views from one contributor: they are correlated, not independent.
        weights = []
        per_contributor: dict[str, int] = {}
        for obs in observations:
            per_contributor[obs.contributor_id] = per_contributor.get(obs.contributor_id, 0) + 1
        for obs in observations:
            n = per_contributor[obs.contributor_id]
            # sqrt(n) rather than n: repeat views do add some information, just not n times it.
            weights.append((1.0 / obs.sigma**2) / math.sqrt(n))

        total_weight = sum(weights)
        value = sum(w * o.value for w, o in zip(weights, observations, strict=True)) / total_weight
        sigma = math.sqrt(1.0 / total_weight)

        freshest = max(o.observed_at for o in observations)
        flags: list[str] = []

        confidence = self._corroboration_term(len(contributors))
        confidence *= self._geometry_term(observations)
        confidence *= self._scale_term(observations)
        confidence *= self._freshness_term(freshest, now)

        worst_scale = max(o.scale_relative_sigma for o in observations)
        if worst_scale > self.max_scale_relative_sigma:
            flags.append("scale_uncertain")

        provenance = Provenance.INFERRED
        if (
            tier is not Tier.C
            and len(contributors) >= self.min_contributors_for_measured
            and worst_scale <= self.max_scale_relative_sigma
        ):
            provenance = Provenance.MEASURED

        if tier is Tier.C:
            # Advisory only, whatever the evidence says. The schema enforces this too; doing it
            # here as well means a bad value never reaches the constructor.
            confidence = min(confidence, 0.45)
            flags.append("advisory_verify_on_vehicle")

        if confidence < self.withhold_below:
            flags.append("withhold")

        return FusedValue(
            value=value,
            sigma=sigma,
            confidence=round(confidence, 4),
            provenance=provenance,
            corroboration_count=len(observations),
            contributor_count=len(contributors),
            freshest_at=freshest,
            flags=tuple(flags),
        )

    def _corroboration_term(self, contributors: int) -> float:
        """Saturating in the number of independent contributors.

        Diminishing returns are the honest shape: the second independent view is worth far more
        than the tenth, and no number of views overcomes a systematic error they all share.
        """
        n = self.min_contributors_for_measured
        return 1.0 - math.exp(-contributors / max(n, 1) * 1.6)

    def _geometry_term(self, observations: list[Observation]) -> float:
        median_residual = sorted(o.residual_px for o in observations)[len(observations) // 2]
        return 1.0 / (1.0 + (median_residual / self.residual_tolerance_px) ** 2)

    def _scale_term(self, observations: list[Observation]) -> float:
        worst = max(o.scale_relative_sigma for o in observations)
        if worst <= 0.0:
            return 1.0
        return 1.0 / (1.0 + (worst / self.max_scale_relative_sigma) ** 2)

    def _freshness_term(self, freshest: datetime, now: datetime) -> float:
        age = (now - freshest).total_seconds()
        if age <= 0:
            return 1.0
        return math.exp(-age / self.freshness_tau.total_seconds())


def disagreement_flag(
    measured: float, reference: float, tolerance: float, label: str
) -> str | None:
    """Flag a conflict between a measurement and a reference, keeping the measurement.

    The re-spec's rule in one function: when a fresh measurement disagrees with the map or the
    building code, the measurement wins and the disagreement is recorded. A missing curb ramp
    that the code says must exist is the single most valuable fact the database can hold, and
    reconciling it back to the standard destroys it.
    """
    if abs(measured - reference) <= tolerance:
        return None
    return f"conflict:{label}:measured={measured:.4f}:reference={reference:.4f}"
