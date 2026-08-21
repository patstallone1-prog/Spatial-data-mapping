"""Ground truth — deliberately a different type from :class:`~smc.facts.schema.WorldFact`.

Truth has no confidence, no provenance and no corroboration count, because it is not an
estimate and is never served. Reusing the served type for truth would make it possible to
compare a fact against itself and to leak a truth row into the product, and it would give the
tier invariants nothing to protect. The checker's whole job is to hold two different things
side by side.
"""

from __future__ import annotations

from dataclasses import dataclass

from smc.facts.schema import FactClass, Tier, tier_for_class


@dataclass(frozen=True, slots=True)
class GroundTruthFact:
    """An exact value at an exact place, from simulation, survey, or municipal record."""

    feature_id: str
    fact_class: FactClass
    value: float | bool | str
    unit: str | None
    lat: float
    lon: float
    #: How the truth was obtained: "simulation", "rtk_survey", "tape", "municipal".
    source: str

    @property
    def tier(self) -> Tier:
        return tier_for_class(self.fact_class)

    def error_against(self, observed: float | bool | str) -> float | None:
        """Signed error for numeric facts; ``None`` for categorical ones (use ``matches``)."""
        if isinstance(self.value, (bool, str)):
            return None
        if isinstance(observed, (bool, str)):
            raise TypeError(f"{self.fact_class} is numeric but observed value was {observed!r}")
        return float(observed) - float(self.value)

    def matches(self, observed: float | bool | str) -> bool:
        """Exact match for categorical and boolean facts."""
        if isinstance(self.value, (bool, str)):
            return self.value == observed
        raise TypeError(f"{self.fact_class} is numeric; use error_against")
