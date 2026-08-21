"""Parametric geometry for sampled right-of-way features.

CARLA cannot supply this. In OpenDRIVE standalone mode sidewalk height is hard-coded — the
format carries no height for RoadRunner to export, so CARLA fixes one value to guarantee
collisions. Randomised curb geometry therefore has to be built as real triangle meshes and
imported as props; see ``docs/05-carla-harness.md``.

The construction is a loft: a lateral cross-section is evaluated at each station along the
kerb line and consecutive sections are stitched. Every quantity the fusion engine is graded
on — curb height, sidewalk width, cross slope, ramp running slope, joint displacement — is a
literal dimension of the resulting mesh, not an annotation attached to it. That is what makes
the render usable as ground truth: a measurement taken off the imagery and the sampled
parameter are the same number by construction, and :mod:`tests.test_geometry` asserts it by
recovering the parameters back out of the vertices.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from smc.carla_gen.distributions import CurbRamp, SidewalkSegment

if TYPE_CHECKING:
    from collections.abc import Sequence

#: Lateral width of the gutter pan between the road edge and the curb face.
GUTTER_WIDTH_M: float = 0.45
#: Stations are emitted at least this densely so slopes render smoothly.
DEFAULT_STATION_STEP_M: float = 0.25
#: A level change is modelled as a step over this longitudinal distance (a joint, not a ramp).
JOINT_STEP_LENGTH_M: float = 0.02


@dataclass(frozen=True, slots=True)
class Mesh:
    """A triangle mesh in a local frame: +x along the kerb, +y into the sidewalk, +z up."""

    vertices: np.ndarray  # (N, 3) float64
    faces: np.ndarray  # (M, 3) int64
    name: str = "feature"

    def __post_init__(self) -> None:
        if self.vertices.ndim != 2 or self.vertices.shape[1] != 3:
            raise ValueError(f"vertices must be (N, 3), got {self.vertices.shape}")
        if self.faces.ndim != 2 or self.faces.shape[1] != 3:
            raise ValueError(f"faces must be (M, 3), got {self.faces.shape}")
        if len(self.faces) and int(self.faces.max()) >= len(self.vertices):
            raise ValueError("face references a vertex index that does not exist")

    @property
    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        return self.vertices.min(axis=0), self.vertices.max(axis=0)


@dataclass(frozen=True, slots=True)
class CrossSection:
    """Lateral profile at one station, as (offset from kerb line, height) pairs.

    Offsets increase away from the roadway. The first point is the gutter, at road level.
    """

    station_m: float
    points: tuple[tuple[float, float], ...]

    @property
    def curb_height_m(self) -> float:
        """Height of the curb face — the rise between the gutter and the top of the curb."""
        return self.points[2][1] - self.points[0][1]

    @property
    def sidewalk_width_m(self) -> float:
        return self.points[-1][0] - self.points[2][0]


def cross_section_at(
    station_m: float,
    segment: SidewalkSegment,
    ramps: Sequence[tuple[float, CurbRamp]] = (),
    *,
    height_offset_m: float = 0.0,
) -> CrossSection:
    """Evaluate the lateral profile at one station.

    ``ramps`` are ``(centre station, ramp)`` pairs. Inside a ramp's run the curb face collapses
    toward its gutter lip and the walking surface takes the ramp's running slope; outside it the
    section is the segment's ordinary curb-and-walk profile. ``height_offset_m`` applies a
    vertical step for joint displacement.
    """
    curb_height = segment.block.curb_height_m
    walk_width = segment.total_width_m
    cross_slope = segment.cross_slope

    for centre_m, ramp in ramps:
        run_length = max(0.15, (curb_height - ramp.lip_height_m) / max(ramp.running_slope, 1e-6))
        half = ramp.width_m / 2.0
        offset = abs(station_m - centre_m)
        if offset <= half:
            # Across the ramp mouth the curb is cut down to the gutter lip.
            curb_height = ramp.lip_height_m
            cross_slope = ramp.cross_slope
            walk_width = max(walk_width, ramp.width_m * 0.5 + run_length * 0.0)
            break
        if offset <= half + run_length * 0.35:
            # Flared sides: the curb recovers linearly across the flare.
            t = (offset - half) / max(run_length * 0.35, 1e-6)
            curb_height = ramp.lip_height_m + t * (segment.block.curb_height_m - ramp.lip_height_m)
            break

    z0 = height_offset_m
    return CrossSection(
        station_m=station_m,
        points=(
            (0.0, z0),  # gutter, at road level
            (GUTTER_WIDTH_M, z0),  # foot of the curb face
            (GUTTER_WIDTH_M, z0 + curb_height),  # top of the curb face
            (GUTTER_WIDTH_M + walk_width, z0 + curb_height + walk_width * cross_slope),
        ),
    )


def station_grid(segment: SidewalkSegment, step_m: float = DEFAULT_STATION_STEP_M) -> np.ndarray:
    """Stations along the segment, refined around every feature that needs resolution.

    A uniform grid would alias out exactly the geometry that matters: a 6 mm joint step and a
    ramp's slope break are both narrower than a comfortable render step. Feature stations are
    inserted explicitly rather than hoping the grid lands on them.
    """
    if step_m <= 0:
        raise ValueError("step_m must be positive")
    stations = [np.arange(0.0, segment.length_m, step_m), np.array([segment.length_m])]
    for lc in segment.level_changes:
        stations.append(np.array([lc.s_m - JOINT_STEP_LENGTH_M, lc.s_m, lc.s_m + 1e-4]))
    for apron in segment.aprons:
        half = apron.width_m / 2.0
        stations.append(np.array([apron.s_m - half, apron.s_m, apron.s_m + half]))
    grid = np.concatenate(stations)
    grid = grid[(grid >= 0.0) & (grid <= segment.length_m)]
    return np.unique(np.round(grid, 6))


def cumulative_step_at(segment: SidewalkSegment, station_m: float) -> float:
    """Total vertical displacement accumulated by joint steps up to a station.

    Joint displacement is cumulative along a walk — successive panels step up and down relative
    to their neighbours. Modelling it as an absolute offset from a flat datum instead would make
    every step measurable from a single view, which is precisely the error Tier C warns against.
    """
    total = 0.0
    for lc in segment.level_changes:
        if lc.s_m <= station_m:
            # Alternate sign so displacement is a local discontinuity, not a monotonic ramp.
            total += lc.height_m if hash(lc.cause + str(round(lc.s_m, 3))) % 2 else -lc.height_m
    return total


def build_segment_mesh(
    segment: SidewalkSegment,
    ramps: Sequence[tuple[float, CurbRamp]] = (),
    *,
    step_m: float = DEFAULT_STATION_STEP_M,
) -> Mesh:
    """Loft a segment's cross-sections into a triangle mesh."""
    stations = station_grid(segment, step_m)
    sections = [
        cross_section_at(
            float(s), segment, ramps, height_offset_m=cumulative_step_at(segment, float(s))
        )
        for s in stations
    ]

    n_lateral = len(sections[0].points)
    vertices = np.array(
        [[sec.station_m, off, z] for sec in sections for off, z in sec.points], dtype=np.float64
    )

    faces: list[tuple[int, int, int]] = []
    for i in range(len(sections) - 1):
        base_a = i * n_lateral
        base_b = (i + 1) * n_lateral
        for j in range(n_lateral - 1):
            a0, a1 = base_a + j, base_a + j + 1
            b0, b1 = base_b + j, base_b + j + 1
            faces.append((a0, b0, b1))
            faces.append((a0, b1, a1))

    return Mesh(
        vertices=vertices,
        faces=np.array(faces, dtype=np.int64),
        name=f"segment_{segment.segment_id}",
    )


def build_dome_field(ramp: CurbRamp, *, spacing_m: float = 0.0413) -> Mesh:
    """Truncated-dome detectable warning field.

    Domes are 0.9 in across and 0.2 in high. At any realistic capture distance they are below
    the resolution of the imagery, which is the point: the sim contains them so the engine's
    claim to detect them can be *falsified*, not so it can succeed.
    """
    from smc import units

    if not ramp.detectable_warning:
        return Mesh(np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64), f"domes_{ramp.ramp_id}")

    radius = units.DOME_DIAMETER_M / 2.0
    height = units.DOME_HEIGHT_M
    depth = units.inches(24)
    n_x = max(1, int(ramp.width_m / spacing_m))
    n_y = max(1, int(depth / spacing_m))

    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    for ix in range(n_x):
        for iy in range(n_y):
            cx = (ix + 0.5) * spacing_m - ramp.width_m / 2.0
            cy = GUTTER_WIDTH_M + (iy + 0.5) * spacing_m
            apex = len(verts)
            verts.append((cx, cy, ramp.lip_height_m + height))
            ring_start = len(verts)
            n_ring = 6
            for k in range(n_ring):
                angle = 2.0 * np.pi * k / n_ring
                verts.append(
                    (cx + radius * np.cos(angle), cy + radius * np.sin(angle), ramp.lip_height_m)
                )
            for k in range(n_ring):
                faces.append((apex, ring_start + k, ring_start + (k + 1) % n_ring))

    return Mesh(
        vertices=np.array(verts, dtype=np.float64),
        faces=np.array(faces, dtype=np.int64),
        name=f"domes_{ramp.ramp_id}",
    )


def measure_curb_height(mesh: Mesh, station_m: float, tol_m: float = 0.05) -> float:
    """Recover curb height from mesh vertices — the inverse of the generator.

    Used by the tests to prove the mesh faithfully carries the sampled parameter, and by the
    ground-truth exporter to assert the same thing before publishing a fact.
    """
    near = mesh.vertices[np.abs(mesh.vertices[:, 0] - station_m) <= tol_m]
    if len(near) == 0:
        raise ValueError(f"no vertices within {tol_m} m of station {station_m}")
    face_column = near[np.abs(near[:, 1] - GUTTER_WIDTH_M) < 1e-6]
    if len(face_column) < 2:
        raise ValueError("curb face not found in section")
    return float(face_column[:, 2].max() - face_column[:, 2].min())
