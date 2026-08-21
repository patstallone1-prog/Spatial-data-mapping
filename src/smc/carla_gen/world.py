"""Assemble a simulated corridor and its ground truth.

This is the bridge between the sampling model and everything downstream. It lays out block
faces along a corridor, samples the geometry on each, builds the meshes, and emits the exact
:class:`~smc.facts.truth.GroundTruthFact` set the checker will score served facts against.

The truth is emitted from the same parameters the meshes are built from, so an error in the
render cannot silently become an error in the truth — and :func:`verify_mesh_fidelity` closes
the loop by recovering curb height back out of the vertices and comparing.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from smc import geo, units
from smc.carla_gen import distributions as dist
from smc.carla_gen.geometry import Mesh, build_dome_field, build_segment_mesh, measure_curb_height
from smc.carla_gen.profile import DEFAULT_PROFILE, CurbHeightClass, CurbProfile
from smc.facts.schema import FactClass
from smc.facts.truth import GroundTruthFact

#: Curb-height bucket edges (re-spec 8.3 Tier B).
_LOW_MAX_M = units.inches(3.0)
_STANDARD_MAX_M = units.inches(7.0)


def curb_height_bucket(height_m: float) -> CurbHeightClass:
    """Bucket a continuous height. The graded quantity is the bucket, not the millimetre."""
    if height_m < units.inches(0.75):
        return CurbHeightClass.FLUSH
    if height_m < _LOW_MAX_M:
        return CurbHeightClass.LOW
    if height_m < _STANDARD_MAX_M:
        return CurbHeightClass.STANDARD
    return CurbHeightClass.HIGH


@dataclass(frozen=True, slots=True)
class PlacedRamp:
    ramp: dist.CurbRamp
    #: Station along the corridor, metres from the corridor origin.
    station_m: float


@dataclass(frozen=True, slots=True)
class CorridorSegment:
    segment: dist.SidewalkSegment
    start_station_m: float
    ramps: tuple[PlacedRamp, ...] = ()


@dataclass(frozen=True, slots=True)
class Corridor:
    """A simulated stretch of street with everything on it."""

    corridor_id: str
    origin: geo.Origin
    world_seed: int
    segments: tuple[CorridorSegment, ...]
    #: Lateral offset of the kerb line from the corridor centreline, metres.
    kerb_offset_m: float = 6.0

    @property
    def length_m(self) -> float:
        return max(
            (cs.start_station_m + cs.segment.length_m for cs in self.segments), default=0.0
        )

    def position_at(self, station_m: float, lateral_m: float = 0.0) -> tuple[float, float]:
        """Corridor station to (lat, lon). The corridor runs due east from its origin."""
        return geo.enu_to_geodetic(self.origin, station_m, self.kerb_offset_m + lateral_m)


def build_corridor(
    corridor_id: str,
    origin: geo.Origin,
    world_seed: int,
    *,
    n_blocks: int = 8,
    block_length_m: float = 110.0,
    profile: CurbProfile = DEFAULT_PROFILE,
) -> Corridor:
    """Lay out block faces along a corridor, with a corner at each block boundary."""
    if n_blocks < 1:
        raise ValueError("n_blocks must be at least 1")
    segments: list[CorridorSegment] = []
    station = 0.0

    for i in range(n_blocks):
        block_id = f"{corridor_id}:blk{i:03d}"
        block = dist.sample_block_face(world_seed, block_id, profile)
        segment = dist.sample_sidewalk_segment(
            world_seed, block, f"{block_id}:seg", block_length_m, profile
        )
        corner_ramps = dist.sample_corner(world_seed, block, f"{block_id}:cor", profile)

        placed: list[PlacedRamp] = []
        for j, ramp in enumerate(corner_ramps):
            # Corner ramps sit at the far end of the block face, a few metres apart.
            offset = block_length_m - 8.0 + j * 5.0
            placed.append(PlacedRamp(ramp=ramp, station_m=offset))

        segments.append(
            CorridorSegment(
                segment=segment, start_station_m=station, ramps=tuple(placed)
            )
        )
        station += block_length_m

    return Corridor(
        corridor_id=corridor_id, origin=origin, world_seed=world_seed, segments=tuple(segments)
    )


def build_meshes(corridor: Corridor) -> list[Mesh]:
    """Every mesh in the corridor, in the corridor's local frame."""
    meshes: list[Mesh] = []
    for cs in corridor.segments:
        local_ramps = [(pr.station_m, pr.ramp) for pr in cs.ramps]
        mesh = build_segment_mesh(cs.segment, local_ramps)
        # Translate into corridor coordinates.
        shifted = mesh.vertices.copy()
        shifted[:, 0] += cs.start_station_m
        meshes.append(Mesh(vertices=shifted, faces=mesh.faces, name=mesh.name))
        for pr in cs.ramps:
            domes = build_dome_field(pr.ramp)
            if len(domes.vertices):
                dv = domes.vertices.copy()
                dv[:, 0] += cs.start_station_m + pr.station_m
                meshes.append(Mesh(vertices=dv, faces=domes.faces, name=domes.name))
    return meshes


def export_ground_truth(corridor: Corridor) -> list[GroundTruthFact]:
    """The exact answer key for the corridor."""
    facts: list[GroundTruthFact] = []

    def add(
        feature_id: str,
        fact_class: FactClass,
        value: float | bool | str,
        unit: str | None,
        station_m: float,
        lateral_m: float = 0.0,
    ) -> None:
        lat, lon = corridor.position_at(station_m, lateral_m)
        facts.append(
            GroundTruthFact(
                feature_id=feature_id,
                fact_class=fact_class,
                value=value,
                unit=unit,
                lat=lat,
                lon=lon,
                source="simulation",
            )
        )

    for cs in corridor.segments:
        seg = cs.segment
        mid = cs.start_station_m + seg.length_m / 2.0
        fid = seg.segment_id

        add(fid, FactClass.SIDEWALK_PRESENT, True, None, mid)
        add(fid, FactClass.SIDEWALK_WIDTH, seg.total_width_m, "m", mid)
        add(fid, FactClass.SIDEWALK_CLEAR_WIDTH, seg.min_clear_width_m, "m", mid)
        add(fid, FactClass.SIDEWALK_CROSS_SLOPE, seg.cross_slope, "ratio", mid)
        add(fid, FactClass.SURFACE_CLASS, str(seg.surface), None, mid)
        add(fid, FactClass.CURB_PRESENT, seg.block.curb_height_m > units.inches(0.75), None, mid)
        add(fid, FactClass.CURB_HEIGHT, seg.block.curb_height_m, "m", mid)
        add(
            fid,
            FactClass.CURB_HEIGHT_BUCKET,
            str(curb_height_bucket(seg.block.curb_height_m)),
            None,
            mid,
        )

        for k, lc in enumerate(seg.level_changes):
            if lc.height_m > units.LEVEL_CHANGE_PASSABLE_M:
                add(
                    f"{fid}:lc{k}",
                    FactClass.LEVEL_CHANGE_HEIGHT,
                    lc.height_m,
                    "m",
                    cs.start_station_m + lc.s_m,
                )
        for k, ob in enumerate(seg.obstructions):
            add(
                f"{fid}:obs{k}",
                FactClass.OBSTRUCTION_PRESENT,
                True,
                None,
                cs.start_station_m + ob.s_m,
            )
        for k, ap in enumerate(seg.aprons):
            add(
                f"{fid}:apron{k}",
                FactClass.DRIVEWAY_APRON_PRESENT,
                True,
                None,
                cs.start_station_m + ap.s_m,
            )

        # A corner with no ramp is itself a fact, and the most commercially useful one.
        if not cs.ramps:
            corner_station = cs.start_station_m + seg.length_m - 6.0
            add(f"{fid}:corner", FactClass.RAMP_PRESENT, False, None, corner_station)

        for pr in cs.ramps:
            r = pr.ramp
            s = cs.start_station_m + pr.station_m
            add(r.ramp_id, FactClass.RAMP_PRESENT, True, None, s)
            add(r.ramp_id, FactClass.RAMP_RUNNING_SLOPE, r.running_slope, "ratio", s)
            add(r.ramp_id, FactClass.RAMP_CROSS_SLOPE, r.cross_slope, "ratio", s)
            add(r.ramp_id, FactClass.RAMP_WIDTH, r.width_m, "m", s)
            add(
                r.ramp_id,
                FactClass.DETECTABLE_WARNING_PRESENT,
                r.detectable_warning,
                None,
                s,
            )
            if r.lip_height_m > units.LEVEL_CHANGE_PASSABLE_M:
                add(f"{r.ramp_id}:lip", FactClass.LEVEL_CHANGE_HEIGHT, r.lip_height_m, "m", s)

    return facts


@dataclass(frozen=True, slots=True)
class FidelityReport:
    """Whether the rendered geometry actually carries the sampled parameters."""

    checked: int
    max_error_m: float
    failures: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return not self.failures


def verify_mesh_fidelity(corridor: Corridor, tolerance_m: float = 1e-3) -> FidelityReport:
    """Recover curb height from the meshes and compare against what was sampled.

    Ground truth is only ground truth if the render agrees with it. This closes the loop.
    """
    failures: list[str] = []
    worst = 0.0
    checked = 0

    for cs in corridor.segments:
        local_ramps = [(pr.station_m, pr.ramp) for pr in cs.ramps]
        mesh = build_segment_mesh(cs.segment, local_ramps)
        # Sample away from ramps and joints, where the section is the plain curb profile.
        for frac in (0.15, 0.35, 0.55):
            station = cs.segment.length_m * frac
            try:
                measured = measure_curb_height(mesh, station, tol_m=1e-3)
            except ValueError:
                continue
            checked += 1
            error = abs(measured - cs.segment.block.curb_height_m)
            worst = max(worst, error)
            if error > tolerance_m:
                failures.append(
                    f"{cs.segment.segment_id}@{station:.1f}m: "
                    f"mesh {measured:.4f} m vs sampled {cs.segment.block.curb_height_m:.4f} m"
                )

    return FidelityReport(checked=checked, max_error_m=worst, failures=tuple(failures))
