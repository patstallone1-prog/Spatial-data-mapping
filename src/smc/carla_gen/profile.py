"""Sampling profiles for pedestrian right-of-way geometry.

A simulation whose curbs are all a compliant six inches is worse than useless: the fusion
engine will pass every gate against it and then fail on a real street, because the facts that
matter commercially are precisely the non-compliant ones. The value of this module is that it
models the *distribution* of real-world geometry, including how often it is out of spec.

Provenance discipline
---------------------
Two kinds of number live here and they must never be confused:

* ``STANDARD`` — fixed by ADA/PROWAG. These are facts. See :mod:`smc.units`.
* ``ESTIMATE`` — plausible engineering priors for how often reality departs from the standard.
  These are *not* measured. They are the weakest link in every accuracy claim derived from
  simulation, and they exist to be replaced.

:func:`ProfileAudit.report` exposes exactly which fields are which, so no gate result can be
quoted without knowing how much of it rests on guesses. Replace estimates with a measured
profile via :func:`CurbProfile.from_municipal_survey` before any number leaves the building.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field, fields
from typing import Literal

from smc import units

Confidence = Literal["STANDARD", "ESTIMATE", "MEASURED"]


class CurbHeightClass(enum.StrEnum):
    """The buckets the product is graded on (respec 8.3, Tier B)."""

    FLUSH = "flush"
    LOW = "low"
    STANDARD = "standard"
    HIGH = "high"


class SurfaceClass(enum.StrEnum):
    CONCRETE = "concrete"
    ASPHALT = "asphalt"
    BRICK = "brick"
    UNPAVED = "unpaved"
    BROKEN = "broken"


class RampStyle(enum.StrEnum):
    """Geometry families. Style drives flare presence and landing shape."""

    PERPENDICULAR = "perpendicular"
    PARALLEL = "parallel"
    DIAGONAL = "diagonal"
    BUILT_UP = "built_up"
    NONE = "none"


@dataclass(frozen=True, slots=True)
class CurbHeightProfile:
    """Curb height as a class mixture with per-class continuous spread.

    Height is strongly correlated along a block face because a block face is usually one pour.
    That correlation is applied in :mod:`smc.carla_gen.distributions`, not here; this profile
    describes the population, not any one block.
    """

    class_weights: dict[CurbHeightClass, float] = field(
        default_factory=lambda: {
            CurbHeightClass.FLUSH: 0.08,
            CurbHeightClass.LOW: 0.14,
            CurbHeightClass.STANDARD: 0.64,
            CurbHeightClass.HIGH: 0.14,
        }
    )
    flush_range_m: tuple[float, float] = (0.0, units.inches(0.75))
    low_range_m: tuple[float, float] = (units.inches(0.75), units.inches(3.0))
    standard_mean_m: float = units.inches(6.0)
    standard_sd_m: float = units.inches(0.6)
    high_range_m: tuple[float, float] = (units.inches(7.0), units.inches(10.0))
    #: Within-block SD once the block's pour height is fixed. Small by construction.
    within_block_sd_m: float = units.inches(0.25)


@dataclass(frozen=True, slots=True)
class RampProfile:
    """Curb ramp geometry, modelled as compliant population plus a non-compliant tail."""

    style_weights: dict[RampStyle, float] = field(
        default_factory=lambda: {
            RampStyle.PERPENDICULAR: 0.52,
            RampStyle.PARALLEL: 0.18,
            RampStyle.DIAGONAL: 0.20,
            RampStyle.BUILT_UP: 0.10,
        }
    )
    #: Fraction of ramps whose running slope exceeds the 8.33% limit.
    running_slope_noncompliance: float = 0.28
    running_slope_compliant_mean: float = 0.071
    running_slope_compliant_sd: float = 0.010
    #: Excess over the limit for the non-compliant tail, exponentially distributed.
    running_slope_excess_scale: float = 0.022

    cross_slope_noncompliance: float = 0.34
    cross_slope_compliant_mean: float = 0.014
    cross_slope_compliant_sd: float = 0.005
    cross_slope_excess_scale: float = 0.013

    width_mean_m: float = units.inches(48)
    width_sd_m: float = units.inches(6)
    width_min_m: float = units.inches(30)

    flare_slope_mean: float = 0.093
    flare_slope_sd: float = 0.018

    landing_present_p: float = 0.72
    landing_depth_mean_m: float = units.inches(52)
    landing_depth_sd_m: float = units.inches(8)

    #: Truncated domes. Presence is era-dependent; this is the modern baseline.
    detectable_warning_p_modern: float = 0.88
    detectable_warning_p_legacy: float = 0.21
    #: Year after which detectable warnings are near-universal on new construction.
    modern_construction_year: int = 2005

    #: The gutter lip — a vertical discontinuity at the ramp toe. This is the Tier C killer:
    #: it is the single most common real mobility barrier and the hardest thing to measure.
    lip_present_p: float = 0.41
    lip_scale_m: float = units.inches(0.35)
    lip_max_m: float = units.inches(2.0)


@dataclass(frozen=True, slots=True)
class SidewalkProfile:
    """Sidewalk running surface: width, cross slope, condition, and joint displacement."""

    width_mean_m: float = units.feet(5.0)
    width_sd_m: float = units.feet(1.1)
    width_min_m: float = units.feet(3.0)
    width_max_m: float = units.feet(20.0)

    #: Obstructions (poles, hydrants, signs, planters) that reduce clear width below total.
    obstruction_rate_per_m: float = 0.035
    obstruction_intrusion_mean_m: float = 0.34
    obstruction_intrusion_sd_m: float = 0.16

    cross_slope_compliant_mean: float = 0.015
    cross_slope_compliant_sd: float = 0.005
    cross_slope_noncompliance: float = 0.31
    cross_slope_excess_scale: float = 0.012

    surface_weights: dict[SurfaceClass, float] = field(
        default_factory=lambda: {
            SurfaceClass.CONCRETE: 0.72,
            SurfaceClass.ASPHALT: 0.13,
            SurfaceClass.BRICK: 0.06,
            SurfaceClass.UNPAVED: 0.03,
            SurfaceClass.BROKEN: 0.06,
        }
    )

    #: Panel joints. Spacing sets how many candidate level changes exist per metre.
    joint_spacing_mean_m: float = 1.52
    joint_spacing_sd_m: float = 0.25
    #: Vertical displacement at a joint, lognormal: most are nothing, a tail is a trip hazard.
    joint_displacement_log_mean: float = -7.3
    joint_displacement_log_sd: float = 1.15
    joint_displacement_max_m: float = units.inches(2.5)
    #: Root heave clusters displacement rather than spreading it evenly.
    heave_cluster_rate_per_m: float = 0.006
    heave_cluster_multiplier: float = 4.2

    driveway_apron_rate_per_m: float = 0.018
    apron_cross_slope_mean: float = 0.061
    apron_cross_slope_sd: float = 0.022


@dataclass(frozen=True, slots=True)
class BlockProfile:
    """Block-face level structure: construction era and build quality."""

    #: Beta(a, b) over build quality; drives compliance and condition jointly.
    quality_alpha: float = 2.4
    quality_beta: float = 2.0
    construction_year_min: int = 1935
    construction_year_max: int = 2024
    #: Blocks are rebuilt piecewise; this is P(a segment differs from its block's era).
    resurfacing_p: float = 0.17
    #: How strongly block quality shifts non-compliance. 0 = no effect, 1 = full swing.
    quality_compliance_gain: float = 0.75


@dataclass(frozen=True, slots=True)
class CurbProfile:
    """A complete jurisdiction profile."""

    name: str = "default-us-urban"
    block: BlockProfile = field(default_factory=BlockProfile)
    curb: CurbHeightProfile = field(default_factory=CurbHeightProfile)
    ramp: RampProfile = field(default_factory=RampProfile)
    sidewalk: SidewalkProfile = field(default_factory=SidewalkProfile)

    @classmethod
    def from_municipal_survey(cls, name: str, **overrides: object) -> CurbProfile:
        """Build a profile from measured data.

        The intended path off the estimates. Every field supplied here should be reclassified
        as ``MEASURED`` in :data:`PROVENANCE` when it lands, so :class:`ProfileAudit` reports
        the shrinking share of guesswork honestly.
        """
        base = cls(name=name)
        for key, value in overrides.items():
            if not hasattr(base, key):
                raise AttributeError(f"unknown profile field: {key}")
            object.__setattr__(base, key, value)
        return base


# --- Provenance -------------------------------------------------------------------------

#: Field-path -> (confidence, source). Any field absent from this map is treated as ESTIMATE,
#: so forgetting to register a new field fails safe rather than overstating confidence.
PROVENANCE: dict[str, tuple[Confidence, str]] = {
    "curb.standard_mean_m": ("STANDARD", "respec 8.1a: typical curb height ~6 in"),
    "ramp.width_mean_m": ("STANDARD", "PROWAG minimum clear width 48 in"),
    "ramp.modern_construction_year": ("STANDARD", "detectable warnings in wide use post-2005"),
    "sidewalk.width_min_m": ("STANDARD", "ADA minimum clear width 36 in"),
}


@dataclass(frozen=True, slots=True)
class ProfileAudit:
    """Which parts of a profile are standards and which are guesses."""

    standard: tuple[str, ...]
    estimate: tuple[str, ...]
    measured: tuple[str, ...]

    @property
    def estimate_fraction(self) -> float:
        total = len(self.standard) + len(self.estimate) + len(self.measured)
        return len(self.estimate) / total if total else 0.0

    def report(self) -> str:
        lines = [
            f"profile audit: {len(self.standard)} standard, "
            f"{len(self.measured)} measured, {len(self.estimate)} estimated "
            f"({self.estimate_fraction:.0%} estimated)",
        ]
        if self.estimate:
            lines.append("  estimated (not measured — do not quote gates as validated):")
            lines.extend(f"    {path}" for path in self.estimate)
        return "\n".join(lines)


def audit(profile: CurbProfile) -> ProfileAudit:
    """Classify every numeric field of a profile by provenance."""
    buckets: dict[Confidence, list[str]] = {"STANDARD": [], "ESTIMATE": [], "MEASURED": []}
    for section in ("block", "curb", "ramp", "sidewalk"):
        sub = getattr(profile, section)
        for f in fields(sub):
            path = f"{section}.{f.name}"
            confidence = PROVENANCE.get(path, ("ESTIMATE", "unregistered"))[0]
            buckets[confidence].append(path)
    return ProfileAudit(
        standard=tuple(buckets["STANDARD"]),
        estimate=tuple(buckets["ESTIMATE"]),
        measured=tuple(buckets["MEASURED"]),
    )


DEFAULT_PROFILE = CurbProfile()
