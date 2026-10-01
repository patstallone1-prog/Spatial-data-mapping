"""From an object's evidence to its accepted geometry -- or to an honest refusal.

Three steps, kept apart so each can be checked on its own:

1. **Fit** (:func:`fit_curb_line`, :func:`fit_object`, :func:`fit_building`): the family's
   fitter runs on the object's cloud and reports its residuals.
2. **Judge** (:func:`confidence_for`): how far to trust the fit, from how much evidence there
   is, how strong its source, how well it fitted, how much of the object it covers, and how it
   agrees with lidar where lidar exists. Capped by the grade of the best source.
3. **Decide** (:func:`decide`): high confidence is drawn in full; medium confidence is drawn
   simplified, because the evidence supports the gist and not the detail; low confidence is
   not drawn at all -- the existing geometry stays, or the object is recorded as unresolved.
   A fit never displaces existing geometry that is more trusted than it is, and where the
   two disagree the disagreement is recorded on the one kept.

Nothing is invented to make a scene complete. An unresolved object is a finding.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np

from smc.geometry.base import GeometryFamily, Param, TriMesh
from smc.geometry.building import (
    Facade,
    ParametricBuilding,
    elements_from_residual,
)
from smc.geometry.extrusion import (
    ProfileKey,
    SplineExtrusion,
    kerb_profile,
    profile_from_points,
)
from smc.geometry.freeform import FreeformMesh, reconstruct_surface
from smc.geometry.primitives import fit_assembly
from smc.geometry.simplify import simplify_to_tolerance, surface_distance
from smc.geometry.spline import CurveSamples, PathFit, PiecewisePath, fit_paths
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.geometry_classifier import (
    PRIMITIVE_TOLERANCE_M,
    FamilyChoice,
    choose_family,
    fit_axis,
    signed_lateral,
)
from smc.reconstruction.object_cloud import ObjectCloud
from smc.world.object import (
    GRADE_CAP,
    Detail,
    Evidence,
    EvidenceRef,
    FitRecord,
    GeometryBasis,
    WorldObject,
    now,
    software_version,
)

#: Confidence at or above which geometry is drawn in full, and at or above which it is drawn
#: simplified. Below MEDIUM it is not drawn.
HIGH = 0.7
MEDIUM = 0.4
#: A new fit has to beat existing geometry by this much to replace it: a tie keeps what is
#: there, so a re-run with equal evidence does not churn the world.
REPLACE_MARGIN = 0.05
#: What each family's fit is judged against (rms, metres), and how many observations it takes
#: before more stop adding much.
FAMILY_TOLERANCE_M = {GeometryFamily.SPLINE_EXTRUSION: 0.05,
                      GeometryFamily.PRIMITIVE_ASSEMBLY: PRIMITIVE_TOLERANCE_M,
                      GeometryFamily.FREEFORM_MESH: 0.04,
                      GeometryFamily.PARAMETRIC_BUILDING: 0.10}
FAMILY_SUPPORT_N = {GeometryFamily.SPLINE_EXTRUSION: 20,
                    GeometryFamily.PRIMITIVE_ASSEMBLY: 50,
                    GeometryFamily.FREEFORM_MESH: 200,
                    GeometryFamily.PARAMETRIC_BUILDING: 200}
#: The grade an evidence kind supplies (smc.facts.cross_section.SourceGrade values).
EVIDENCE_GRADE = {"survey_line": "survey", "survey_points": "survey", "lidar_points": "lidar",
                  "lidar_kerb_station": "lidar", "image": "image", "photogrammetry": "image",
                  "fixture": "image", "osm": "mapped", "existing_geometry": "mapped",
                  "catalogue": "inferred"}
GRADE_ORDER = ("survey", "lidar", "image", "mapped", "inferred")
#: A kerb's plan position decides where it is; its height is a secondary dimension. An
#: inferred height costs this share of the confidence rather than capping it at "inferred".
INFERRED_HEIGHT_FACTOR = 0.85
#: A swept object's section is traced on a grid this fine and simplified to this tolerance.
SECTION_CELL_M = 0.015
SECTION_TOLERANCE_M = 0.01
#: Medium-confidence sweeps are drawn with their path simplified to this.
CONSERVATIVE_PATH_M = 0.05


def strongest_grade(refs: tuple[EvidenceRef, ...]) -> str:
    grades = {EVIDENCE_GRADE[r.kind] for r in refs}
    return next((g for g in GRADE_ORDER if g in grades), "inferred")


@dataclass(frozen=True)
class FitOutcome:
    """A fitted geometry and the evidence it was fitted to, before any decision."""

    semantic_type: str
    geometry: Any
    evidence: Evidence
    family: GeometryFamily
    method: str
    frame: EnuFrame
    material: str = "concrete"
    parameters: dict[str, Any] = field(default_factory=dict)
    problems: tuple[str, ...] = ()
    secondary_factor: float = 1.0
    choice: FamilyChoice | None = None


def confidence_for(evidence: Evidence, family: GeometryFamily, *,
                   secondary_factor: float = 1.0) -> float:
    """How far to trust a fit. Every factor is between 0 and 1; the product is capped by the
    strongest grade of evidence behind the shape."""
    if evidence.exact:
        support = 1.0  # a survey is one complete observation of the whole object
    else:
        support = 1.0 - math.exp(-evidence.observation_count / FAMILY_SUPPORT_N[family])
    tolerance = FAMILY_TOLERANCE_M[family]
    quality = 1.0 if evidence.fit_rms_m is None else \
        math.exp(-0.5 * (evidence.fit_rms_m / tolerance) ** 2)
    inliers = 1.0 if evidence.inlier_fraction is None else \
        min(1.0, max(0.0, (evidence.inlier_fraction - 0.5) / 0.4))
    coverage = 0.5 + 0.5 * evidence.coverage
    lidar = 1.0 if evidence.lidar_disagreement_m is None else \
        math.exp(-0.5 * (evidence.lidar_disagreement_m / 0.1) ** 2)
    diversity = min(1.0, 0.7 + 0.15 * max(evidence.independent_sources, 1)) \
        if not evidence.exact else 1.0
    value = GRADE_CAP[evidence.grade] * support * quality * inliers * coverage * lidar \
        * diversity * secondary_factor
    return float(min(max(value, 0.0), GRADE_CAP[evidence.grade]))


# ------------------------------------------------------------------------------ curbs ----


def fit_curb_line(samples: CurveSamples, refs: tuple[EvidenceRef, ...], frame: EnuFrame, *,
                  height: Param, side: int, material: str = "concrete",
                  lidar_disagreement_m: float | None = None) -> list[FitOutcome]:
    """Kerbs from measured points along them: one outcome per continuous run.

    ``height`` carries its own grade -- lidar where the block was measured, the corridor
    median where it was not -- and ``side`` says which side of the samples' direction the
    footway is on. The path is whatever the samples describe; there is no corner type.
    """
    outcomes: list[FitOutcome] = []
    for fit in fit_paths(samples):
        geometry = SplineExtrusion(
            fit.path, (ProfileKey(0.0, kerb_profile(height.value, side=side)),),
            params={"height": height, "side": Param(float(side), "inferred", None,
                                                    "which side the footway is on")})
        observed = fit.observed_fraction
        evidence = Evidence(
            refs=refs, grade=strongest_grade(refs),
            observation_count=int(fit.inlier.sum()),
            independent_sources=len({r.source_id for r in refs if r.observational}),
            fit_rms_m=fit.rms_m, fit_max_m=fit.max_m, inlier_fraction=fit.inlier_fraction,
            coverage=observed, exact=samples.exact,
            lidar_disagreement_m=lidar_disagreement_m)
        method = ("interpolating fit through surveyed vertices (smc.geometry.spline._fit_exact)"
                  if samples.exact else
                  "robust MLS path fit with fillet/sharp corner selection "
                  "(smc.geometry.spline._fit_open)")
        outcomes.append(FitOutcome(
            "curb", geometry, evidence, GeometryFamily.SPLINE_EXTRUSION, method, frame, material,
            parameters={"path": fit.summary()}, problems=fit.problems,
            secondary_factor=1.0 if height.grade in ("lidar", "survey", "image")
            else INFERRED_HEIGHT_FACTOR))
    return outcomes


# ------------------------------------------------------------------ anything else ----


def _fit_sweep(cloud: ObjectCloud) -> tuple[SplineExtrusion, PathFit, float]:
    """A swept object from its points: the axis they run along, and the section they share.

    The section is what is present along most of the axis. Parts that are present only here
    and there -- a bench's legs -- are left out of it and fitted separately by the caller.
    """
    pts = cloud.points
    # The object's foot: its lowest points, bar a stray or two. (A percentile of *all* its
    # points would sit partway up whatever reaches the ground -- a bench's legs.)
    base = float(np.partition(pts[:, 2], min(5, len(pts) - 1))[min(5, len(pts) - 1)])
    axis = fit_axis(pts)
    lateral, s = signed_lateral(pts[:, :2], axis.path.points[:, :2])
    up = pts[:, 2] - base
    # Finer than the thinnest part a street object has (a 4 cm seat, a 2 cm rail).
    cell = SECTION_CELL_M
    slices = np.clip(((s - s.min()) / max(np.ptp(s), 1e-9) * 12).astype(int), 0, 11)
    keys = np.floor(np.column_stack([lateral, up]) / cell).astype(np.int64)
    occupancy: dict[tuple[int, int], set[int]] = {}
    for key, sl in zip(map(tuple, keys), slices, strict=True):
        occupancy.setdefault(key, set()).add(int(sl))
    persistent = {k for k, sl in occupancy.items() if len(sl) >= 0.6 * 12}
    keep = np.array([tuple(k) in persistent for k in keys])
    section = profile_from_points(np.column_stack([lateral[keep], up[keep]]), cell_m=cell,
                                  tolerance_m=SECTION_TOLERANCE_M)
    path = PiecewisePath(np.column_stack([axis.path.points[:, :2],
                                          np.full(len(axis.path.points), base)]),
                         axis.path.breaks, axis.path.observed, axis.path.support)
    sweep = SplineExtrusion(path, (ProfileKey(0.0, section),), caps=True,
                            params={"length_m": Param(path.length, "image"),
                                    "section_width_m": Param(float(np.ptp(section.array[:, 0])),
                                                             "image"),
                                    "section_height_m": Param(float(section.array[:, 1].max()),
                                                              "image")})
    d = surface_distance(pts[keep], sweep.to_mesh())
    return sweep, axis, float(np.sqrt(np.mean(d * d)))


def fit_object(cloud: ObjectCloud, semantic_type: str, *, material: str = "concrete",
               family: GeometryFamily | None = None) -> list[FitOutcome]:
    """Fit one object in the family its name and shape call for. Returns the object and, for
    a sweep with parts off its section (a bench's legs), those parts as their own outcomes."""
    choice = choose_family(semantic_type, cloud.points) if family is None else \
        FamilyChoice(family, "family given by the caller")
    grade = strongest_grade(cloud.refs)
    sources = len({r.source_id for r in cloud.refs if r.observational})
    outcomes: list[FitOutcome] = []

    def evidence(rms: float, inliers: float, coverage: float = 1.0,
                 count: int | None = None) -> Evidence:
        return Evidence(cloud.refs, grade, len(cloud) if count is None else count, sources,
                        rms, None, inliers, coverage, cloud.exact)

    if choice.family is GeometryFamily.SPLINE_EXTRUSION:
        sweep, axis, rms = _fit_sweep(cloud)
        outcomes.append(FitOutcome(
            semantic_type, sweep, evidence(rms, axis.inlier_fraction, axis.observed_fraction),
            choice.family, "axis by robust MLS path fit; section = persistent occupancy along it",
            cloud.frame, material, {"axis": axis.summary()}, axis.problems, choice=choice))
        # What the section left out is fitted on its own: a sweep must not smear a leg along
        # the whole length, and must not silently drop it either.
        mesh = sweep.to_mesh()
        off = surface_distance(cloud.points, mesh) > 0.05
        for part in _clusters(cloud.points[off], 0.15):
            if len(part) < 20:
                continue
            fitted = fit_assembly(part, PRIMITIVE_TOLERANCE_M)
            if fitted is None:
                surface = reconstruct_surface(part, 0.03)
                gap = surface_distance(part, surface)
                geometry, rms_p, fam = FreeformMesh(surface), float(np.sqrt(np.mean(gap * gap))), \
                    GeometryFamily.FREEFORM_MESH
            else:
                geometry, rms_p, fam = fitted[0], fitted[1], GeometryFamily.PRIMITIVE_ASSEMBLY
            outcomes.append(FitOutcome(
                f"{semantic_type}_support", geometry, evidence(rms_p, 1.0, 1.0, len(part)), fam,
                "off-section cluster fitted on its own", cloud.frame, material,
                choice=FamilyChoice(fam, "part of a sweep's evidence off its section")))
        return outcomes
    if choice.family is GeometryFamily.PRIMITIVE_ASSEMBLY:
        fitted = fit_assembly(cloud.points, PRIMITIVE_TOLERANCE_M)
        if fitted is not None:
            assembly, rms = fitted
            return [FitOutcome(semantic_type, assembly, evidence(rms, 1.0), choice.family,
                               "least-squares primitives (smc.geometry.primitives)", cloud.frame,
                               material, choice=choice)]
        choice = FamilyChoice(GeometryFamily.FREEFORM_MESH,
                              "named like a primitive but no primitive fits to tolerance",
                              choice.rejected)
    if choice.family is GeometryFamily.FREEFORM_MESH:
        mesh = reconstruct_surface(cloud.points, 0.03)
        d = surface_distance(cloud.points, mesh)
        return [FitOutcome(semantic_type, FreeformMesh(mesh), evidence(
            float(np.sqrt(np.mean(d * d))), float((d < 0.1).mean())), choice.family,
            "voxel closing + naive surface nets (smc.geometry.freeform)", cloud.frame,
            material, choice=choice)]
    raise ValueError(f"{semantic_type}: buildings are fitted with fit_building")


def _clusters(points: np.ndarray, reach: float) -> list[np.ndarray]:
    """Single-linkage clusters at ``reach``, on a voxel grid of that size."""
    if not len(points):
        return []
    keys = np.floor(points / reach).astype(np.int64)
    cells: dict[tuple[int, int, int], list[int]] = {}
    for i, k in enumerate(map(tuple, keys)):
        cells.setdefault(k, []).append(i)
    label: dict[tuple[int, int, int], int] = {}
    groups: list[list[int]] = []
    for start in cells:
        if start in label:
            continue
        label[start] = len(groups)
        stack, members = [start], []
        while stack:
            c = stack.pop()
            members.extend(cells[c])
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        n = (c[0] + dx, c[1] + dy, c[2] + dz)
                        if n in cells and n not in label:
                            label[n] = label[start]
                            stack.append(n)
        groups.append(members)
    return [points[g] for g in groups]


def fit_building(prior: ParametricBuilding, residuals: dict[int, np.ndarray],
                 refs: tuple[EvidenceRef, ...], frame: EnuFrame, *,
                 material: str = "wall") -> FitOutcome:
    """The existing building, plus what its measured surfaces add to each wall.

    ``residuals`` maps a footprint edge to ``(u, v, offset, weight)`` samples of the measured
    surface against that wall's plane. The footprint, height and placement stay the prior's:
    a scan adds a bay window to a building without being trusted to move it.
    """
    facades: list[Facade] = []
    grade = strongest_grade(refs)
    total = 0
    residual_rms: list[float] = []
    for k in range(len(prior.footprint)):
        base = prior.facade_for(k)
        samples = residuals.get(k)
        if samples is None or not len(samples):
            facades.append(base)
            continue
        elements, appearance = elements_from_residual(
            base, samples, grade=grade, evidence=tuple(r.locator for r in refs))
        total += len(samples)
        left = appearance.offset_m[np.isfinite(appearance.offset_m)]
        if left.size:
            residual_rms.append(float(np.sqrt(np.mean(left * left))))
        facades.append(replace(base, elements=(*base.elements, *elements), grade=grade))
    building = replace(prior, facades=tuple(facades))
    evidence = Evidence(refs, grade, total, len({r.source_id for r in refs if r.observational}),
                        max(residual_rms) if residual_rms else None, None, None,
                        min(1.0, len(residuals) / max(len(prior.footprint), 1)))
    return FitOutcome("building", building, evidence, GeometryFamily.PARAMETRIC_BUILDING,
                      "prior footprint + facade residual elements (elements_from_residual)",
                      frame, material, problems=tuple(building.validate()))


# ---------------------------------------------------------------------------- decide ----


@dataclass(frozen=True)
class Decision:
    object: WorldObject
    outcome: str  # accepted_full | accepted_conservative | kept_existing | refused
    reason: str


def _conservative(geometry: Any) -> Any:
    if isinstance(geometry, SplineExtrusion):
        return replace(geometry, path=geometry.path.simplified(CONSERVATIVE_PATH_M))
    if isinstance(geometry, FreeformMesh):
        return FreeformMesh(simplify_to_tolerance(geometry.mesh, 0.05).mesh, geometry.params)
    if isinstance(geometry, ParametricBuilding):
        facades = tuple(replace(f, elements=tuple(e for e in f.elements if e.confidence >= HIGH))
                        for f in geometry.facades)
        return replace(geometry, facades=facades)
    return geometry


def disagreement_m(a: WorldObject, b: WorldObject) -> float | None:
    """How far apart two objects' surfaces are, where both have geometry."""
    if a.geometry is None or b.geometry is None:
        return None
    ma, mb = a.geometry.to_mesh(), b.geometry.to_mesh()
    if isinstance(ma, TriMesh) and isinstance(mb, TriMesh) and not ma.empty and not mb.empty:
        return float(np.median(surface_distance(ma.vertices, mb)))
    return None


def decide(outcome: FitOutcome, *, object_id: str, existing: WorldObject | None = None,
           tolerance_m: float | None = None) -> Decision:
    """Accept, simplify, keep what exists, or refuse -- never invent."""
    confidence = confidence_for(outcome.evidence, outcome.family,
                                secondary_factor=outcome.secondary_factor)
    flags = tuple(f"fit_problem:{p}" for p in outcome.problems)
    if outcome.problems:
        confidence *= 0.5
    fit = FitRecord(outcome.method, software_version(), now(),
                    {**outcome.parameters,
                     **({"family_choice": outcome.choice.reason} if outcome.choice else {})})
    anchor = (outcome.frame.lon, outcome.frame.lat, outcome.frame.height_m)
    candidate = WorldObject(object_id, outcome.semantic_type, outcome.geometry,
                            GeometryBasis.MEASURED, round(confidence, 4), outcome.evidence,
                            anchor, outcome.material, Detail.FULL, fit, flags,
                            (existing.id,) if existing is not None else ())
    tolerance = tolerance_m if tolerance_m is not None else FAMILY_TOLERANCE_M[outcome.family]
    if existing is not None and existing.confidence + REPLACE_MARGIN >= confidence:
        apart = disagreement_m(candidate, existing)
        kept = existing
        if apart is not None and apart > tolerance:
            kept = existing.with_conflict(
                f"{object_id} (confidence {confidence:.2f}) disagrees by {apart:.2f} m")
        return Decision(kept, "kept_existing",
                        f"existing {existing.basis} geometry at {existing.confidence:.2f} is at "
                        f"least as trusted as the fit at {confidence:.2f}")
    if confidence >= HIGH:
        return Decision(candidate, "accepted_full", f"confidence {confidence:.2f} >= {HIGH}")
    if confidence >= MEDIUM:
        simple = replace(candidate, geometry=_conservative(outcome.geometry),
                         detail=Detail.CONSERVATIVE)
        return Decision(simple, "accepted_conservative",
                        f"confidence {confidence:.2f}: the gist is supported, not the detail")
    if existing is not None:
        return Decision(replace(existing, flags=(*existing.flags,
                                                 f"refused_candidate:{object_id}")),
                        "kept_existing", f"fit refused at confidence {confidence:.2f}")
    unresolved = WorldObject(object_id, outcome.semantic_type, None, GeometryBasis.UNRESOLVED,
                             round(confidence, 4), outcome.evidence, anchor, outcome.material,
                             Detail.NONE, fit, (*flags, "refused"))
    return Decision(unresolved, "refused",
                    f"confidence {confidence:.2f} < {MEDIUM}: nothing drawn, evidence kept")
