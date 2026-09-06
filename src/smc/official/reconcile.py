"""Holding the city's records and our own measurements side by side.

The temptation with an authoritative source is to let it win. That is wrong here, and not for
sentimental reasons: an as-built drawing describes the day it was drawn and a LiDAR return
describes last year's flight, so when they disagree the disagreement is the finding. It may
mean the street was resurfaced, or the curb was rebuilt, or the record is stale, or two
vertical datums have been mixed. Replacing one number with the other destroys the only evidence
that any of that happened.

So nothing here overwrites anything. Every pairing produces an agreement or a conflict, both
keep both values, and the summary is an error distribution rather than a corrected table.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from smc.official.schema import OfficialGeometryFact, rank

#: How far a measurement may sit from a centreline and still be about that street. Half a
#: typical San Francisco right of way plus the footway behind it.
MATCH_RADIUS_M = 25.0


@dataclass(frozen=True)
class Comparison:
    """One official value against one observed value, with both kept."""

    feature_id: str
    fact_class: str
    official_value: float
    official_source: str
    official_status: str
    observed_value: float
    observed_source: str
    observed_sigma: float | None
    difference: float
    """Observed minus official, in the fact's unit."""
    conflict: bool
    """True when the two differ by more than their combined uncertainty allows."""

    @property
    def winner(self) -> str:
        """Which source ranks higher. Ranking is for rendering; it is not a verdict."""
        return (self.observed_source
                if rank(self.observed_source) <= rank(self.official_status)
                else self.official_status)


@dataclass
class Reconciliation:
    comparisons: list[Comparison] = field(default_factory=list)
    unmatched_official: int = 0
    unmatched_observed: int = 0

    def summary(self) -> dict:
        """Mean absolute error, bias and conflict rate, per fact class.

        This is the number worth having. It says how far the pipeline's own answers sit from
        the city's, in metres, which is a claim about accuracy that nothing else in this
        project has been able to make.
        """
        by_class: dict[str, list[Comparison]] = defaultdict(list)
        for row in self.comparisons:
            by_class[row.fact_class].append(row)

        out = {}
        for fact_class, rows in sorted(by_class.items()):
            differences = sorted(r.difference for r in rows)
            absolute = sorted(abs(d) for d in differences)
            n = len(differences)
            out[fact_class] = {
                "n": n,
                "mae_m": round(sum(absolute) / n, 4),
                "bias_m": round(sum(differences) / n, 4),
                "median_error_m": round(differences[n // 2], 4),
                "p90_abs_error_m": round(absolute[int(n * 0.9)], 4) if n >= 10 else None,
                "conflicts": sum(1 for r in rows if r.conflict),
                "conflict_rate": round(sum(1 for r in rows if r.conflict) / n, 3),
            }
        return {
            "by_class": out,
            "unmatched_official": self.unmatched_official,
            "unmatched_observed": self.unmatched_observed,
        }


def is_conflict(official: float, observed: float, sigma: float | None,
                official_sigma: float | None, *, k: float = 3.0) -> bool:
    """Whether two values disagree by more than their stated uncertainties permit.

    Three sigma, combined in quadrature, with a floor so that two sources both claiming
    millimetre precision cannot manufacture a conflict out of nothing.
    """
    combined = math.hypot(sigma or 0.0, official_sigma or 0.0)
    return abs(observed - official) > max(k * combined, 0.02)


def compare_widths(
    official_facts: list[OfficialGeometryFact],
    observations: list[dict],
    *,
    locate,
    fact_class,
    value_key: str,
    sigma_key: str | None = None,
    observed_source: str = "field_observation",
) -> Reconciliation:
    """Match observed cross-sections to official facts by street segment, and difference them.

    ``locate`` turns an observation's ``(lon, lat)`` into a feature id and side, or None when
    it does not fall on any known segment. Only official facts that are *observations* of the
    world take part -- a Better Streets Plan minimum is not something a LiDAR return can be
    wrong about.

    ``fact_class`` is required rather than inferred. Filtering only by feature id and letting
    the best-ranked fact win compared a footway measurement against a right-of-way width
    wherever a segment had one and not the other, and produced a confident seventeen-metre
    error that was really a category mistake.
    """
    by_feature: dict[str, list[OfficialGeometryFact]] = defaultdict(list)
    for fact in official_facts:
        if (fact.fact_class == fact_class and fact.is_observation
                and isinstance(fact.value, (int, float))):
            by_feature[fact.feature_id].append(fact)

    out = Reconciliation()
    matched_features: set[str] = set()

    for observation in observations:
        observed = observation.get(value_key)
        if observed is None:
            continue
        placed = locate(observation.get("lon"), observation.get("lat"))
        if placed is None:
            out.unmatched_observed += 1
            continue
        feature_id, side = placed
        candidates = by_feature.get(feature_id, [])
        if not candidates:
            out.unmatched_observed += 1
            continue
        # Prefer a fact recorded for this side of the street; fall back to one that covers both.
        sided = [f for f in candidates if f.side == side] or \
                [f for f in candidates if f.side == 0] or candidates
        best = min(sided, key=lambda f: rank(f.document_status))
        matched_features.add(feature_id)

        sigma = observation.get(sigma_key) if sigma_key else None
        difference = float(observed) - float(best.value)
        out.comparisons.append(Comparison(
            feature_id=feature_id,
            fact_class=str(best.fact_class),
            official_value=float(best.value),
            official_source=best.document_id,
            official_status=str(best.document_status),
            observed_value=float(observed),
            observed_source=observed_source,
            observed_sigma=sigma,
            difference=round(difference, 4),
            conflict=is_conflict(float(best.value), float(observed), sigma,
                                 best.horizontal_sigma_m),
        ))

    out.unmatched_official = len(set(by_feature) - matched_features)
    return out
