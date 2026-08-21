"""The served world-fact.

Two rules from the re-spec are enforced here as validators rather than left to convention,
because both are the kind of rule that survives review and then quietly dies in a migration:

* **Tier C is never measured.** Fine vertical geometry — quarter-inch level changes,
  sub-percent slopes — is beyond reliable crowdsourced RGB. Those facts may be served only as
  low-confidence advisories that tell the vehicle to check for itself. A ``Tier.C`` fact
  claiming ``Provenance.MEASURED`` is rejected at construction.
* **Disagreement is preserved, not smoothed.** When a measurement contradicts the map or the
  building code, the measurement wins and the conflict is recorded in ``flags``. A broken curb
  is the most valuable fact in the database; rounding it back to the code ideal destroys the
  only thing a robot could not have assumed on its own.
"""

from __future__ import annotations

import enum
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Tier(enum.StrEnum):
    """Accuracy tier. Sets what may be claimed about a fact (re-spec 8.3)."""

    A = "A"  # semantic presence
    B = "B"  # coarse geometry
    C = "C"  # hazard-grade fine geometry — advisory only


class Provenance(enum.StrEnum):
    MEASURED = "measured"
    INFERRED = "inferred"


class FactClass(enum.StrEnum):
    CURB_PRESENT = "curb_present"
    CURB_HEIGHT = "curb_height"
    CURB_HEIGHT_BUCKET = "curb_height_bucket"
    RAMP_PRESENT = "ramp_present"
    RAMP_RUNNING_SLOPE = "ramp_running_slope"
    RAMP_CROSS_SLOPE = "ramp_cross_slope"
    RAMP_WIDTH = "ramp_width"
    DETECTABLE_WARNING_PRESENT = "detectable_warning_present"
    SIDEWALK_PRESENT = "sidewalk_present"
    SIDEWALK_WIDTH = "sidewalk_width"
    SIDEWALK_CLEAR_WIDTH = "sidewalk_clear_width"
    SIDEWALK_CROSS_SLOPE = "sidewalk_cross_slope"
    SURFACE_CLASS = "surface_class"
    OBSTRUCTION_PRESENT = "obstruction_present"
    LEVEL_CHANGE_HEIGHT = "level_change_height"
    DRIVEWAY_APRON_PRESENT = "driveway_apron_present"


#: Which tier each class belongs to. Presence is cheap; fine vertical geometry is not.
_TIER_BY_CLASS: dict[FactClass, Tier] = {
    FactClass.CURB_PRESENT: Tier.A,
    FactClass.RAMP_PRESENT: Tier.A,
    FactClass.SIDEWALK_PRESENT: Tier.A,
    FactClass.SURFACE_CLASS: Tier.A,
    FactClass.OBSTRUCTION_PRESENT: Tier.A,
    FactClass.DRIVEWAY_APRON_PRESENT: Tier.A,
    FactClass.DETECTABLE_WARNING_PRESENT: Tier.A,
    FactClass.CURB_HEIGHT_BUCKET: Tier.B,
    FactClass.CURB_HEIGHT: Tier.B,
    FactClass.SIDEWALK_WIDTH: Tier.B,
    FactClass.SIDEWALK_CLEAR_WIDTH: Tier.B,
    FactClass.RAMP_WIDTH: Tier.B,
    FactClass.RAMP_RUNNING_SLOPE: Tier.B,
    FactClass.RAMP_CROSS_SLOPE: Tier.C,
    FactClass.SIDEWALK_CROSS_SLOPE: Tier.C,
    FactClass.LEVEL_CHANGE_HEIGHT: Tier.C,
}

#: Ceiling on confidence for advisory facts. Above this a Tier C fact reads as a guarantee.
TIER_C_MAX_CONFIDENCE: float = 0.5


def tier_for_class(fact_class: FactClass) -> Tier:
    return _TIER_BY_CLASS[fact_class]


class WorldFact(BaseModel):
    """One assertion about one place, with everything needed to judge whether to trust it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    fact_id: str
    feature_id: str = Field(description="Stable identity of the physical thing described.")
    fact_class: FactClass
    tier: Tier
    provenance: Provenance
    confidence: float = Field(ge=0.0, le=1.0)

    value: float | bool | str
    unit: str | None = Field(default=None, description="SI unit, or None for boolean/categorical.")

    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)
    position_sigma_m: float = Field(ge=0.0, description="1-sigma horizontal position error.")

    observed_at: datetime
    corroboration_count: int = Field(ge=0, description="Independent contributors supporting it.")
    source_run_id: str
    flags: tuple[str, ...] = ()

    @model_validator(mode="after")
    def _check_tier_invariants(self) -> WorldFact:
        expected = tier_for_class(self.fact_class)
        if self.tier is not expected:
            raise ValueError(
                f"{self.fact_class} belongs to tier {expected}, not {self.tier}"
            )
        if self.tier is Tier.C:
            if self.provenance is Provenance.MEASURED:
                raise ValueError(
                    f"{self.fact_class} is Tier C: hazard-grade geometry is beyond reliable "
                    "crowdsourced RGB and may only be served as an inferred advisory"
                )
            if self.confidence > TIER_C_MAX_CONFIDENCE:
                raise ValueError(
                    f"Tier C confidence {self.confidence} exceeds the advisory ceiling "
                    f"{TIER_C_MAX_CONFIDENCE}"
                )
        if self.provenance is Provenance.MEASURED and self.corroboration_count < 1:
            raise ValueError("a measured fact needs at least one contributing observation")
        return self

    @property
    def is_advisory(self) -> bool:
        return self.tier is Tier.C

    def with_conflict(self, note: str) -> WorldFact:
        """Record that this measurement disagrees with a reference, keeping the measurement."""
        return self.model_copy(update={"flags": (*self.flags, f"conflict:{note}")})


def utcnow() -> datetime:
    return datetime.now(UTC)
