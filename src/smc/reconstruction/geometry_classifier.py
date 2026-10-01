"""Which geometry family an object is fitted in -- decided by what it is *and* its shape.

What something is called narrows the choice; it does not make it. A kerb is always a swept
section, a building always structured architecture. A bench could be any of three: a straight
or curved seat of constant section is a sweep, a concrete block is a box, and an ornate one is
a surface. So for anything whose name does not settle it, the measured points are asked: do
they run along an axis with the same section all the way (sweep)? Do a few fitted solids
account for them to tolerance (primitives)? If neither, the surface is kept as measured.

A primitive that does not fit to tolerance is never drawn as one -- that is the one rule the
old catalogue could not keep.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass

import numpy as np

from smc.geometry.base import GeometryFamily
from smc.geometry.primitives import fit_assembly
from smc.geometry.spline import CurveSamples, fit_path

#: What a name settles, when it settles anything.
SEMANTIC_FAMILY: dict[str, GeometryFamily] = {
    **{k: GeometryFamily.SPLINE_EXTRUSION for k in (
        "curb", "kerb", "sidewalk_edge", "median", "fence", "rail", "railing", "guardrail",
        "lane_marking", "retaining_wall", "barrier", "wall_low")},
    **{k: GeometryFamily.PARAMETRIC_BUILDING for k in ("building", "facade")},
    **{k: GeometryFamily.FREEFORM_MESH for k in ("sculpture", "rock", "playground")},
}
#: Names that suggest primitives -- still checked against tolerance.
PRIMITIVE_TYPES = frozenset({"pole", "bollard", "hydrant", "trash_can", "planter", "cabinet",
                             "post", "street_lamp", "sign_post"})
#: How well a primitive assembly has to fit before an object may be drawn as one.
PRIMITIVE_TOLERANCE_M = 0.03
#: An object is a sweep if its axis is this many times longer than its section is wide, and
#: every third of it has a section this similar to the others.
SWEEP_MIN_ELONGATION = 2.5
SWEEP_MIN_SECTION_IOU = 0.6
SECTION_CELL_M = 0.04


@dataclass(frozen=True)
class FamilyChoice:
    family: GeometryFamily
    reason: str
    rejected: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class SweepEvidence:
    axis_length_m: float
    section_width_m: float
    section_iou: float

    @property
    def elongation(self) -> float:
        return self.axis_length_m / max(self.section_width_m, 1e-6)


AXIS_CELL_M = 0.1


def plan_decimate(xy: np.ndarray, cell_m: float = AXIS_CELL_M) -> tuple[np.ndarray, np.ndarray]:
    """One point per plan cell (the mean of its points) and how many it stands for.

    An object's axis is a property of its plan shape, which a ten-centimetre grid of its
    points describes as well as all of them do -- at a hundredth of the cost of fitting.
    """
    keys = np.floor(xy / cell_m).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.reshape(-1)
    sums = np.zeros((len(counts), 2))
    np.add.at(sums, inverse, xy)
    return sums / counts[:, None], counts


def fit_axis(points: np.ndarray):  # -> PathFit
    """The curve an object's plan runs along."""
    centres, counts = plan_decimate(np.asarray(points, dtype=np.float64)[:, :2])
    weight = np.minimum(1.0, counts / max(float(np.median(counts)), 1.0))
    return fit_path(CurveSamples(np.column_stack([centres, np.zeros(len(centres))]), weight))


def sweep_evidence(points: np.ndarray) -> SweepEvidence | None:
    """Does the object run along an axis with one section? Measured, not assumed."""
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 30:
        return None
    try:
        axis = fit_axis(pts)
    except ValueError:
        return None
    path = axis.path
    if path.length < 0.5:
        return None
    lateral, s = signed_lateral(pts[:, :2], path.points[:, :2])
    width = float(np.percentile(lateral, 98) - np.percentile(lateral, 2))
    thirds = np.quantile(s, [0.0, 1 / 3, 2 / 3, 1.0])
    sections = []
    for a, b in itertools.pairwise(thirds):
        band = (s >= a) & (s <= b)
        cells = {(int(u), int(v)) for u, v in zip(np.floor(lateral[band] / SECTION_CELL_M),
                                                  np.floor(pts[band, 2] / SECTION_CELL_M),
                                                  strict=True)}
        sections.append(cells)
    ious = []
    for i in range(3):
        for j in range(i + 1, 3):
            union = len(sections[i] | sections[j])
            ious.append(len(sections[i] & sections[j]) / union if union else 0.0)
    return SweepEvidence(path.length, width, float(min(ious)))


def signed_lateral(xy: np.ndarray, line: np.ndarray, chunk: int = 2048
                   ) -> tuple[np.ndarray, np.ndarray]:
    """Signed distance of each point from a polyline (positive to its left), and the arc
    position of its foot."""
    a, b = line[:-1], line[1:]
    d = b - a
    seg_len = np.linalg.norm(d, axis=1)
    s0 = np.concatenate([[0.0], np.cumsum(seg_len)])[:-1]
    seg = np.maximum(seg_len * seg_len, 1e-18)
    lateral = np.empty(len(xy))
    along = np.empty(len(xy))
    for start in range(0, len(xy), chunk):
        p = xy[start:start + chunk]
        rel = p[:, None, :] - a[None]
        t = np.clip(np.einsum("nsk,sk->ns", rel, d) / seg, 0.0, 1.0)
        foot = a[None] + t[..., None] * d[None]
        dist = np.linalg.norm(p[:, None, :] - foot, axis=2)
        j = np.argmin(dist, axis=1)
        rows = np.arange(len(p))
        cross = d[j, 0] * rel[rows, j, 1] - d[j, 1] * rel[rows, j, 0]
        lateral[start:start + chunk] = np.where(cross >= 0, 1.0, -1.0) * dist[rows, j]
        along[start:start + chunk] = s0[j] + t[rows, j] * seg_len[j]
    return lateral, along


def choose_family(semantic_type: str, points: np.ndarray | None = None) -> FamilyChoice:
    """The family to fit an object in, and why."""
    if semantic_type in SEMANTIC_FAMILY:
        family = SEMANTIC_FAMILY[semantic_type]
        return FamilyChoice(family, f"a {semantic_type} is always a {family}")
    if points is None or len(points) < 12:
        return FamilyChoice(GeometryFamily.FREEFORM_MESH, "too few points to judge its shape")
    rejected: list[tuple[str, str]] = []
    if semantic_type not in PRIMITIVE_TYPES:
        sweep = sweep_evidence(points)
        if sweep is not None and sweep.elongation >= SWEEP_MIN_ELONGATION \
                and sweep.section_iou >= SWEEP_MIN_SECTION_IOU:
            return FamilyChoice(
                GeometryFamily.SPLINE_EXTRUSION,
                f"runs {sweep.axis_length_m:.2f} m along an axis, {sweep.elongation:.1f}x its "
                f"section, with the same section along it (IoU {sweep.section_iou:.2f})")
        rejected.append(("spline_extrusion", "no constant section along an axis" if sweep
                         else "no axis"))
    fitted = fit_assembly(points, PRIMITIVE_TOLERANCE_M)
    if fitted is not None:
        assembly, rms = fitted
        return FamilyChoice(GeometryFamily.PRIMITIVE_ASSEMBLY,
                            f"{len(assembly.parts)} fitted part(s) to {rms * 100:.1f} cm rms",
                            tuple(rejected))
    rejected.append(("primitive_assembly",
                     f"no assembly fits to {PRIMITIVE_TOLERANCE_M * 100:.0f} cm"))
    return FamilyChoice(GeometryFamily.FREEFORM_MESH, "kept as its measured surface",
                        tuple(rejected))
