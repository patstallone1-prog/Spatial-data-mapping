"""From a reconstruction to world-facts.

This is the step between a solved pose and something sellable. Everything upstream — anchoring,
scale, triangulation — exists to put metric 3D points in a known frame; nothing before this
turns them into "the kerb here is six inches and the footway is 1.5 m wide".

Uncertainty is carried, not asserted. Every measurement combines three error sources that
behave differently, and keeping them apart is what makes the tier boundaries defensible rather
than decorative:

* **Plane fit residual** — how well the surface is actually planar. Fixed size, in metres.
* **Scale uncertainty** — *multiplicative*, so it grows linearly with the dimension measured.
  A 1% scale error is 1.5 mm on a kerb and 15 mm on a 1.5 m footway.
* **Position uncertainty** — where the whole measurement sits on the map, which matters for
  serving it, not for the dimension itself.

A kerb height is a small dimension measured over a short span, so the fit dominates. A cross
slope is a tiny rise over a short run, so it is hopeless — which is the arithmetic behind Tier C
being advisory rather than a rule someone chose.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from smc import units
from smc.carla_gen.profile import CurbHeightClass
from smc.carla_gen.world import curb_height_bucket
from smc.facts.schema import (
    FactClass,
    Provenance,
    Tier,
    WorldFact,
    tier_for_class,
    utcnow,
)
from smc.measure.planes import (
    KerbPlanes,
    perpendicular_extent,
    slope_uncertainty,
    split_kerb_planes,
)


@dataclass(frozen=True, slots=True)
class MeasurementConfig:
    plane_threshold_m: float = 0.02
    #: Relative uncertainty of the metric scale the reconstruction was solved under.
    scale_relative_sigma: float = 0.01
    #: Minimum points on a surface before a measurement is reported at all.
    min_surface_points: int = 40
    #: Horizontal direction across the footway, in the corridor frame.
    cross_axis: tuple[float, float, float] = (0.0, 1.0, 0.0)
    #: Sidewalk widths beyond this are rejected as a segmentation failure, not a wide footway.
    max_plausible_width_m: float = 12.0


@dataclass(frozen=True, slots=True)
class KerbMeasurement:
    height_m: float
    sigma_m: float
    bucket: CurbHeightClass
    #: Lateral position of the kerb line in the corridor frame.
    kerb_offset_m: float

    @property
    def present(self) -> bool:
        return self.height_m > units.inches(0.75)

    @property
    def bucket_is_confident(self) -> bool:
        """Whether the measurement sits clear of its bucket edges by more than its sigma."""
        edges = (units.inches(0.75), units.inches(3.0), units.inches(7.0))
        return all(abs(self.height_m - edge) > 2.0 * self.sigma_m for edge in edges)


@dataclass(frozen=True, slots=True)
class SidewalkMeasurement:
    width_m: float
    width_sigma_m: float
    cross_slope: float
    cross_slope_sigma: float
    surface_rms_m: float
    point_count: int

    @property
    def meets_ada_width(self) -> bool:
        return self.width_m >= units.CLEAR_WIDTH_MIN_ADA_M

    @property
    def cross_slope_is_decidable(self) -> bool:
        """Whether the measurement can distinguish compliant from not.

        Almost always false from crowdsourced RGB, and saying so explicitly is the point.
        """
        return abs(self.cross_slope - units.CROSS_SLOPE_MAX) > 2.0 * self.cross_slope_sigma


@dataclass(frozen=True, slots=True)
class CrossSection:
    """Everything measurable at one place along the kerb."""

    station_m: float
    kerb: KerbMeasurement | None
    sidewalk: SidewalkMeasurement | None
    planes: KerbPlanes | None
    flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return self.kerb is not None and self.sidewalk is not None


def measure_cross_section(
    points: np.ndarray,
    station_m: float,
    *,
    config: MeasurementConfig | None = None,
    rng: np.random.Generator | None = None,
    kerb_offset_hint: float | None = None,
) -> CrossSection:
    """Measure kerb and footway from the reconstructed points around one station.

    ``kerb_offset_hint`` comes from the street map when one is available; see
    :mod:`smc.overlay.street`.
    """
    config = config or MeasurementConfig()
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    flags: list[str] = []

    if len(points) < config.min_surface_points:
        return CrossSection(station_m, None, None, None, ("too_few_points",))

    planes = split_kerb_planes(
        points,
        threshold_m=config.plane_threshold_m,
        rng=rng,
        cross_axis=np.array(config.cross_axis, dtype=np.float64),
        kerb_offset_hint=kerb_offset_hint,
    )
    if planes is None:
        return CrossSection(station_m, None, None, None, ("no_surfaces_found",))
    if not planes.planes_are_parallel:
        # A driveway apron or a ramp; the surfaces genuinely are not parallel there.
        flags.append("surfaces_not_parallel")

    cross_axis = np.array(config.cross_axis, dtype=np.float64)
    walk_points = planes.walk_points

    if len(walk_points) < config.min_surface_points:
        return CrossSection(station_m, None, None, planes, (*flags, "walk_surface_too_sparse"))

    # --- Kerb -----------------------------------------------------------------------------
    # The step is a difference of two plane heights, so both fits contribute; scale error acts
    # multiplicatively on the height itself.
    fit_sigma = math.hypot(planes.road.rms_m, planes.walk.rms_m)
    height_sigma = math.hypot(fit_sigma, planes.step_m * config.scale_relative_sigma)
    kerb = KerbMeasurement(
        height_m=planes.step_m,
        sigma_m=height_sigma,
        bucket=curb_height_bucket(planes.step_m),
        kerb_offset_m=planes.kerb_offset_m,
    )

    # --- Footway --------------------------------------------------------------------------
    width, _, _ = perpendicular_extent(walk_points, cross_axis)
    if width < units.inches(12):
        # A surface with almost no lateral extent is not a footway seen badly, it is a
        # different surface entirely. Report the failure rather than a width of zero.
        flags.append("degenerate_width")
        return CrossSection(station_m, kerb, None, planes, tuple(flags))
    if width > config.max_plausible_width_m:
        flags.append("implausible_width")
        return CrossSection(station_m, kerb, None, planes, tuple(flags))

    width_sigma = math.hypot(planes.walk.rms_m, width * config.scale_relative_sigma)
    cross_slope = planes.walk.slope_along(cross_axis)
    sidewalk = SidewalkMeasurement(
        width_m=width,
        width_sigma_m=width_sigma,
        cross_slope=cross_slope,
        cross_slope_sigma=slope_uncertainty(planes.walk, width),
        surface_rms_m=planes.walk.rms_m,
        point_count=len(walk_points),
    )
    if not sidewalk.cross_slope_is_decidable:
        flags.append("cross_slope_indecisive")

    return CrossSection(station_m, kerb, sidewalk, planes, tuple(flags))


def to_world_facts(
    section: CrossSection,
    *,
    feature_id: str,
    lat: float,
    lon: float,
    position_sigma_m: float,
    source_run_id: str,
    corroboration_count: int,
    confidence: float,
    observed_at: datetime | None = None,
) -> list[WorldFact]:
    """Serialise a measured cross-section into servable facts.

    Provenance is decided per fact rather than per section. A kerb *presence* and a kerb
    *height* come from the same fit and are not equally trustworthy, and Tier C facts are
    demoted to advisory here as well as in the schema — belt and braces on the rule most likely
    to be lost in a refactor.
    """
    if not section.ok:
        return []
    observed_at = observed_at or utcnow()
    facts: list[WorldFact] = []
    kerb = section.kerb
    walk = section.sidewalk
    assert kerb is not None and walk is not None

    def add(fact_class: FactClass, value: float | bool | str, unit: str | None,
            *, measured: bool, conf: float, flags: tuple[str, ...] = ()) -> None:
        tier = tier_for_class(fact_class)
        provenance = (
            Provenance.MEASURED if measured and tier is not Tier.C else Provenance.INFERRED
        )
        capped = min(conf, 0.45) if tier is Tier.C else conf
        facts.append(
            WorldFact(
                fact_id=f"{source_run_id}:{feature_id}:{fact_class}",
                feature_id=feature_id,
                fact_class=fact_class,
                tier=tier,
                provenance=provenance,
                confidence=round(capped, 4),
                value=value,
                unit=unit,
                lat=lat,
                lon=lon,
                position_sigma_m=position_sigma_m,
                observed_at=observed_at,
                corroboration_count=max(1, corroboration_count),
                source_run_id=source_run_id,
                flags=(*section.flags, *flags),
            )
        )

    add(FactClass.CURB_PRESENT, kerb.present, None, measured=True, conf=confidence)
    add(FactClass.CURB_HEIGHT, kerb.height_m, "m", measured=True, conf=confidence)
    add(
        FactClass.CURB_HEIGHT_BUCKET,
        str(kerb.bucket),
        None,
        measured=kerb.bucket_is_confident,
        conf=confidence if kerb.bucket_is_confident else confidence * 0.6,
        flags=() if kerb.bucket_is_confident else ("near_bucket_edge",),
    )
    add(FactClass.SIDEWALK_PRESENT, True, None, measured=True, conf=confidence)
    add(FactClass.SIDEWALK_WIDTH, walk.width_m, "m", measured=True, conf=confidence)
    add(
        FactClass.SIDEWALK_CROSS_SLOPE,
        walk.cross_slope,
        "ratio",
        measured=False,
        conf=confidence,
        flags=() if walk.cross_slope_is_decidable else ("below_measurement_resolution",),
    )
    return facts
