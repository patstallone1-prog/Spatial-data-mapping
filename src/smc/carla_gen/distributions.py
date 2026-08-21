"""Hierarchical sampling of pedestrian right-of-way geometry.

Sampling is hierarchical and *deterministic given an identity*, and both properties matter.

Hierarchical, because a block face is normally a single concrete pour: its curb height is
correlated along its whole length, its build quality drives compliance and condition together,
and its construction era decides whether detectable warnings exist at all. Sampling every
feature independently would produce a street that looks like noise, and a fusion engine tuned
against noise learns nothing about corroboration — the very thing multi-view fusion exists to
exploit.

Deterministic, because the engine's central claim is that repeated independent passes over the
same spot raise confidence. Testing that claim requires the second pass to observe *the same
curb*. Geometry is therefore derived from a hash of (world seed, feature identity), not from a
running stream, so any drive down a block at any time in any process reproduces it exactly.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from smc import units
from smc.carla_gen.profile import (
    DEFAULT_PROFILE,
    CurbHeightClass,
    CurbProfile,
    RampStyle,
    SurfaceClass,
)

if TYPE_CHECKING:
    from collections.abc import Sequence


def rng_for(world_seed: int, *identity: str | int) -> np.random.Generator:
    """A generator bound to a feature's identity rather than to call order.

    Two drives past the same curb must sample the same curb, in any order, in any process.
    """
    key = "|".join(str(part) for part in (world_seed, *identity)).encode()
    digest = hashlib.blake2b(key, digest_size=8).digest()
    return np.random.default_rng(int.from_bytes(digest, "big"))


def _truncated_normal(
    rng: np.random.Generator, mean: float, sd: float, low: float, high: float
) -> float:
    """Normal draw rejected into [low, high]; falls back to the midpoint if it cannot land."""
    if low > high:
        raise ValueError(f"empty support [{low}, {high}]")
    for _ in range(32):
        value = float(rng.normal(mean, sd))
        if low <= value <= high:
            return value
    return float(np.clip(mean, low, high))


def _shift_noncompliance(base_p: float, quality: float, gain: float) -> float:
    """Modulate a non-compliance rate by block build quality.

    ``quality`` is 0 (worst) to 1 (best). A high-quality block departs from the standard less
    often; a poor one more. ``gain`` of 0 disables the coupling entirely.
    """
    return float(np.clip(base_p * (1.0 + gain * (1.0 - 2.0 * quality)), 0.0, 1.0))


def _weighted_choice(rng: np.random.Generator, weights: dict[str, float]) -> str:
    keys = list(weights)
    values = np.array([weights[k] for k in keys], dtype=float)
    total = values.sum()
    if total <= 0:
        raise ValueError("weights must sum to a positive value")
    return str(rng.choice(keys, p=values / total))


def _sample_slope(
    rng: np.random.Generator,
    *,
    noncompliance_p: float,
    compliant_mean: float,
    compliant_sd: float,
    excess_scale: float,
    limit: float,
) -> float:
    """Slope as a two-population mixture: compliant body, exponential tail past the limit.

    Modelling the tail explicitly is the point. A gate that only ever sees compliant slopes
    cannot measure whether the engine can tell 8.0% from 9.5%, which is the distinction the
    whole ramp-classification bar rests on.
    """
    if rng.random() < noncompliance_p:
        return float(limit + rng.exponential(excess_scale))
    return _truncated_normal(rng, compliant_mean, compliant_sd, 0.0, limit)


# --- Sampled entities -------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class BlockFace:
    """Latent state shared by everything on one block face."""

    block_id: str
    quality: float
    construction_year: int
    curb_height_class: CurbHeightClass
    curb_height_m: float
    surface: SurfaceClass

    @property
    def is_modern(self) -> bool:
        return self.construction_year >= 2005


@dataclass(frozen=True, slots=True)
class LevelChange:
    """A vertical discontinuity. ``cause`` is retained so the exporter can explain a hazard."""

    s_m: float
    height_m: float
    cause: str

    @property
    def is_trip_hazard(self) -> bool:
        return self.height_m > units.LEVEL_CHANGE_PASSABLE_M

    @property
    def requires_ramp(self) -> bool:
        return self.height_m > units.LEVEL_CHANGE_RAMP_REQUIRED_M


@dataclass(frozen=True, slots=True)
class Obstruction:
    s_m: float
    intrusion_m: float
    kind: str


@dataclass(frozen=True, slots=True)
class DrivewayApron:
    s_m: float
    width_m: float
    cross_slope: float


@dataclass(frozen=True, slots=True)
class SidewalkSegment:
    """One run of sidewalk along a block face, with everything on it."""

    segment_id: str
    block: BlockFace
    length_m: float
    total_width_m: float
    cross_slope: float
    surface: SurfaceClass
    level_changes: tuple[LevelChange, ...]
    obstructions: tuple[Obstruction, ...]
    aprons: tuple[DrivewayApron, ...]

    @property
    def min_clear_width_m(self) -> float:
        """Narrowest point — the number a wheelchair or robot actually has to fit through."""
        if not self.obstructions:
            return self.total_width_m
        worst = max(o.intrusion_m for o in self.obstructions)
        return max(0.0, self.total_width_m - worst)

    @property
    def worst_level_change_m(self) -> float:
        return max((lc.height_m for lc in self.level_changes), default=0.0)

    @property
    def passable_ada(self) -> bool:
        return (
            self.min_clear_width_m >= units.CLEAR_WIDTH_MIN_ADA_M
            and self.worst_level_change_m <= units.LEVEL_CHANGE_RAMP_REQUIRED_M
        )


@dataclass(frozen=True, slots=True)
class CurbRamp:
    """A curb ramp with the geometry the robot API is asked to report."""

    ramp_id: str
    block: BlockFace
    style: RampStyle
    running_slope: float
    cross_slope: float
    width_m: float
    flare_slope: float
    landing_depth_m: float | None
    detectable_warning: bool
    lip_height_m: float
    curb_height_m: float

    @property
    def running_slope_compliant(self) -> bool:
        return self.running_slope <= units.RAMP_RUNNING_SLOPE_MAX

    @property
    def cross_slope_compliant(self) -> bool:
        return self.cross_slope <= units.CROSS_SLOPE_MAX

    @property
    def fully_compliant(self) -> bool:
        return (
            self.running_slope_compliant
            and self.cross_slope_compliant
            and self.width_m >= units.CLEAR_WIDTH_MIN_ADA_M
            and self.lip_height_m <= units.LEVEL_CHANGE_PASSABLE_M
            and self.detectable_warning
        )


# --- Samplers ---------------------------------------------------------------------------


def sample_block_face(
    world_seed: int, block_id: str, profile: CurbProfile = DEFAULT_PROFILE
) -> BlockFace:
    """Sample the latent state of one block face."""
    rng = rng_for(world_seed, "block", block_id)
    bp = profile.block
    cp = profile.curb

    quality = float(rng.beta(bp.quality_alpha, bp.quality_beta))
    year = int(rng.integers(bp.construction_year_min, bp.construction_year_max + 1))
    # Blocks get rebuilt piecewise. A resurfaced face carries a modern construction date
    # regardless of when the street was laid out, which is what decides detectable warnings.
    if rng.random() < bp.resurfacing_p:
        year = int(rng.integers(2006, bp.construction_year_max + 1))
        quality = float(np.clip(quality + 0.25, 0.0, 1.0))

    height_class = CurbHeightClass(_weighted_choice(rng, dict(cp.class_weights)))
    match height_class:
        case CurbHeightClass.FLUSH:
            height = float(rng.uniform(*cp.flush_range_m))
        case CurbHeightClass.LOW:
            height = float(rng.uniform(*cp.low_range_m))
        case CurbHeightClass.STANDARD:
            height = _truncated_normal(
                rng, cp.standard_mean_m, cp.standard_sd_m, units.inches(4.0), units.inches(7.0)
            )
        case CurbHeightClass.HIGH:
            height = float(rng.uniform(*cp.high_range_m))

    # Poor blocks skew toward degraded surfaces; good blocks toward concrete.
    weights = dict(profile.sidewalk.surface_weights)
    weights[SurfaceClass.BROKEN] *= 1.0 + 2.0 * (1.0 - quality)
    weights[SurfaceClass.CONCRETE] *= 0.5 + quality
    surface = SurfaceClass(_weighted_choice(rng, {str(k): v for k, v in weights.items()}))

    return BlockFace(
        block_id=block_id,
        quality=quality,
        construction_year=year,
        curb_height_class=height_class,
        curb_height_m=height,
        surface=surface,
    )


def sample_sidewalk_segment(
    world_seed: int,
    block: BlockFace,
    segment_id: str,
    length_m: float,
    profile: CurbProfile = DEFAULT_PROFILE,
) -> SidewalkSegment:
    """Sample one run of sidewalk, conditioned on its block face."""
    if length_m <= 0:
        raise ValueError("length_m must be positive")
    rng = rng_for(world_seed, "segment", segment_id)
    sp = profile.sidewalk
    gain = profile.block.quality_compliance_gain

    width = _truncated_normal(rng, sp.width_mean_m, sp.width_sd_m, sp.width_min_m, sp.width_max_m)
    cross_slope = _sample_slope(
        rng,
        noncompliance_p=_shift_noncompliance(sp.cross_slope_noncompliance, block.quality, gain),
        compliant_mean=sp.cross_slope_compliant_mean,
        compliant_sd=sp.cross_slope_compliant_sd,
        excess_scale=sp.cross_slope_excess_scale,
        limit=units.CROSS_SLOPE_MAX,
    )

    level_changes = _sample_level_changes(rng, block, length_m, profile)
    obstructions = _sample_obstructions(rng, length_m, width, profile)
    aprons = _sample_aprons(rng, length_m, width, profile)

    return SidewalkSegment(
        segment_id=segment_id,
        block=block,
        length_m=length_m,
        total_width_m=width,
        cross_slope=cross_slope,
        surface=block.surface,
        level_changes=level_changes,
        obstructions=obstructions,
        aprons=aprons,
    )


def _sample_level_changes(
    rng: np.random.Generator, block: BlockFace, length_m: float, profile: CurbProfile
) -> tuple[LevelChange, ...]:
    """Displacement at panel joints, with root-heave clustering.

    Most joints are flat. The distribution is lognormal so the common case is far below the
    quarter-inch threshold and the tail reaches genuine barriers — which is what makes Tier C
    honest: the engine should find these hard, because they are.
    """
    sp = profile.sidewalk
    changes: list[LevelChange] = []

    s = 0.0
    while s < length_m:
        spacing = max(0.3, float(rng.normal(sp.joint_spacing_mean_m, sp.joint_spacing_sd_m)))
        s += spacing
        if s >= length_m:
            break
        height = float(rng.lognormal(sp.joint_displacement_log_mean, sp.joint_displacement_log_sd))
        # Poor blocks displace more.
        height *= 1.0 + 1.5 * (1.0 - block.quality)
        height = min(height, sp.joint_displacement_max_m)
        changes.append(LevelChange(s_m=s, height_m=height, cause="joint"))

    n_clusters = int(rng.poisson(sp.heave_cluster_rate_per_m * length_m))
    for _ in range(n_clusters):
        centre = float(rng.uniform(0.0, length_m))
        height = min(
            float(rng.lognormal(sp.joint_displacement_log_mean, sp.joint_displacement_log_sd))
            * sp.heave_cluster_multiplier,
            sp.joint_displacement_max_m,
        )
        changes.append(LevelChange(s_m=centre, height_m=height, cause="root_heave"))

    return tuple(sorted(changes, key=lambda lc: lc.s_m))


def _sample_obstructions(
    rng: np.random.Generator, length_m: float, width_m: float, profile: CurbProfile
) -> tuple[Obstruction, ...]:
    sp = profile.sidewalk
    kinds = ("pole", "hydrant", "sign", "planter", "bus_shelter", "scooter")
    count = int(rng.poisson(sp.obstruction_rate_per_m * length_m))
    out: list[Obstruction] = []
    for _ in range(count):
        intrusion = _truncated_normal(
            rng,
            sp.obstruction_intrusion_mean_m,
            sp.obstruction_intrusion_sd_m,
            0.05,
            max(0.06, width_m * 0.9),
        )
        out.append(
            Obstruction(
                s_m=float(rng.uniform(0.0, length_m)),
                intrusion_m=intrusion,
                kind=str(rng.choice(kinds)),
            )
        )
    return tuple(sorted(out, key=lambda o: o.s_m))


def _sample_aprons(
    rng: np.random.Generator, length_m: float, width_m: float, profile: CurbProfile
) -> tuple[DrivewayApron, ...]:
    """Driveway aprons — a cross-slope spike that reads as a ramp to a naive classifier."""
    sp = profile.sidewalk
    count = int(rng.poisson(sp.driveway_apron_rate_per_m * length_m))
    out: list[DrivewayApron] = []
    for _ in range(count):
        out.append(
            DrivewayApron(
                s_m=float(rng.uniform(0.0, length_m)),
                width_m=float(rng.uniform(2.7, 6.1)),
                cross_slope=max(
                    0.0, float(rng.normal(sp.apron_cross_slope_mean, sp.apron_cross_slope_sd))
                ),
            )
        )
    return tuple(sorted(out, key=lambda a: a.s_m))


def sample_curb_ramp(
    world_seed: int,
    block: BlockFace,
    ramp_id: str,
    profile: CurbProfile = DEFAULT_PROFILE,
) -> CurbRamp:
    """Sample one curb ramp, conditioned on its block face."""
    rng = rng_for(world_seed, "ramp", ramp_id)
    rp = profile.ramp
    gain = profile.block.quality_compliance_gain

    style = RampStyle(_weighted_choice(rng, {str(k): v for k, v in rp.style_weights.items()}))

    running = _sample_slope(
        rng,
        noncompliance_p=_shift_noncompliance(rp.running_slope_noncompliance, block.quality, gain),
        compliant_mean=rp.running_slope_compliant_mean,
        compliant_sd=rp.running_slope_compliant_sd,
        excess_scale=rp.running_slope_excess_scale,
        limit=units.RAMP_RUNNING_SLOPE_MAX,
    )
    cross = _sample_slope(
        rng,
        noncompliance_p=_shift_noncompliance(rp.cross_slope_noncompliance, block.quality, gain),
        compliant_mean=rp.cross_slope_compliant_mean,
        compliant_sd=rp.cross_slope_compliant_sd,
        excess_scale=rp.cross_slope_excess_scale,
        limit=units.CROSS_SLOPE_MAX,
    )

    width = _truncated_normal(
        rng, rp.width_mean_m, rp.width_sd_m, rp.width_min_m, units.inches(96)
    )
    flare = max(0.0, float(rng.normal(rp.flare_slope_mean, rp.flare_slope_sd)))

    landing: float | None = None
    if rng.random() < rp.landing_present_p:
        landing = _truncated_normal(
            rng,
            rp.landing_depth_mean_m,
            rp.landing_depth_sd_m,
            units.inches(24),
            units.inches(90),
        )

    dw_p = rp.detectable_warning_p_modern if block.is_modern else rp.detectable_warning_p_legacy
    detectable_warning = bool(rng.random() < dw_p)

    lip = 0.0
    if rng.random() < _shift_noncompliance(rp.lip_present_p, block.quality, gain):
        lip = min(float(rng.exponential(rp.lip_scale_m)), rp.lip_max_m)

    return CurbRamp(
        ramp_id=ramp_id,
        block=block,
        style=style,
        running_slope=running,
        cross_slope=cross,
        width_m=width,
        flare_slope=flare,
        landing_depth_m=landing,
        detectable_warning=detectable_warning,
        lip_height_m=lip,
        curb_height_m=block.curb_height_m,
    )


def sample_corner(
    world_seed: int,
    block: BlockFace,
    corner_id: str,
    profile: CurbProfile = DEFAULT_PROFILE,
) -> Sequence[CurbRamp]:
    """Sample the ramps at one corner.

    A corner has zero ramps (a real and common failure), one diagonal serving both crossings,
    or two perpendicular ramps. Zero-ramp corners must exist in the simulation or recall on
    ``missing ramp`` can never be measured.
    """
    rng = rng_for(world_seed, "corner", corner_id)
    # Older, poorer corners are likelier to have no ramp at all.
    p_none = float(np.clip(0.30 * (1.0 - block.quality) + (0.18 if not block.is_modern else 0.0),
                           0.0, 0.9))
    if rng.random() < p_none:
        return ()
    if rng.random() < 0.28:
        return (sample_curb_ramp(world_seed, block, f"{corner_id}:diag", profile),)
    return (
        sample_curb_ramp(world_seed, block, f"{corner_id}:a", profile),
        sample_curb_ramp(world_seed, block, f"{corner_id}:b", profile),
    )
