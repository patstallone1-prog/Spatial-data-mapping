"""Bridge reviewed dense-mesh labels to existing geometry families.

This adapter consumes instance labels from a segmentation/review stage; it does
not claim that unlabeled triangles have been semantically recognized. Unknown
faces remain in a review mesh. Freeform surfaces preserve upstream topology.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

import numpy as np

from smc.geometry.base import GeometryFamily, TriMesh
from smc.geometry.building import ParametricBuilding
from smc.geometry.freeform import FreeformMesh
from smc.reconstruction.contracts import SourceRights, build_uses
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.geometry_classifier import choose_family
from smc.reconstruction.geometry_fit import Decision, FitOutcome, decide, fit_building, fit_object
from smc.reconstruction.object_cloud import ObjectCloud
from smc.world.object import Evidence, EvidenceRef, WorldObject

SEMANTICS = frozenset({"facade", "roof", "curb", "sidewalk", "bench", "fence",
                       "pole", "sign", "utility_equipment", "vegetation", "freeform"})


@dataclass(frozen=True)
class DenseSegment:
    object_id: str
    canonical_id: str
    semantic_type: str
    mesh: TriMesh


def split_dense_mesh(mesh: TriMesh, face_labels: np.ndarray,
                     instances: dict[int, dict[str, str]]) -> tuple[list[DenseSegment], TriMesh]:
    """One reviewed instance per triangle. -1 means unknown, not discarded.

    Sharing vertices between partitions is allowed and does not move a seam.
    Faces cannot belong to overlapping instances or dynamic objects.
    """
    labels = np.asarray(face_labels)
    if labels.shape != (len(mesh.faces),) or labels.dtype.kind not in "iu":
        raise ValueError("one integer instance label is required per dense face")
    if (labels < -1).any() or set(map(int, labels)) - {-1} - instances.keys():
        raise ValueError("unknown instance label in dense mesh")
    if mesh.empty or (mesh.face_areas() <= 1e-10).any():
        raise ValueError("dense mesh is empty or contains degenerate faces")
    seen: set[str] = set()

    def subset(mask: np.ndarray) -> TriMesh:
        faces = mesh.faces[mask]
        used, inverse = np.unique(faces, return_inverse=True)
        return TriMesh(mesh.vertices[used], inverse.reshape(-1, 3),
                       mesh.normals[used] if mesh.normals is not None else None,
                       mesh.uvs[used] if mesh.uvs is not None else None)

    result = []
    for label in sorted(set(map(int, labels)) - {-1}):
        info = instances[label]
        if info.get("semantic_type") not in SEMANTICS:
            raise ValueError("unreviewed/dynamic/unsupported semantic class")
        object_id, canonical_id = info.get("object_id", ""), info.get("canonical_id", "")
        if not object_id or not canonical_id or object_id in seen:
            raise ValueError("instances need unique stable IDs and canonical references")
        seen.add(object_id)
        result.append(DenseSegment(object_id, canonical_id, info["semantic_type"],
                                   subset(labels == label)))
    return result, subset(labels == -1)


def fit_dense_segment(segment: DenseSegment, frame: EnuFrame,
                      refs: tuple[EvidenceRef, ...], *, independent_views: int,
                      prior: ParametricBuilding | None = None,
                      residuals: dict[int, np.ndarray] | None = None,
                      material: str = "unknown") -> list[FitOutcome]:
    """Fit regular objects; keep a curved bench/unknown shape's dense triangles.

    Facades must cite an anchored prior and independently derived residuals.
    Roofs/sidewalks remain review-only freeform candidates until boundary gates
    approve them. Point count is not treated as independent camera count.
    """
    if independent_views < 3 or not refs or any(r.kind != "photogrammetry" for r in refs):
        raise ValueError("dense fitting requires photogrammetric evidence from >=3 views")
    if segment.semantic_type == "facade":
        if prior is None or residuals is None:
            raise ValueError("facade fitting needs canonical prior and measured residual samples")
        outcome = fit_building(prior, residuals, refs, frame, material=material)
        return [replace(outcome, evidence=replace(outcome.evidence,
                                                  independent_sources=independent_views))]
    points = segment.mesh.vertices
    semantics = {"utility_equipment": "cabinet", "sign": "sign_post"}
    kind = semantics.get(segment.semantic_type, segment.semantic_type)
    if kind in {"roof", "sidewalk", "vegetation", "freeform"}:
        family = GeometryFamily.FREEFORM_MESH
    else:
        family = choose_family(kind, points).family
    if family is GeometryFamily.FREEFORM_MESH:
        # Never run the legacy custom voxel closer on a mesh already reconstructed
        # by a dense engine. Fit RMS stays unknown until independent validation.
        evidence = Evidence(refs, "image", len(points), independent_views, coverage=0.0)
        return [FitOutcome(segment.semantic_type, FreeformMesh(segment.mesh), evidence,
                           family, "reviewed partition of upstream dense mesh", frame, material,
                           parameters={"canonical_id": segment.canonical_id})]
    cloud = ObjectCloud(frame, points, np.ones(len(points)),
                        np.zeros(len(points), dtype=np.int64), refs)
    outcomes = fit_object(cloud, kind, material=material, family=family)
    return [replace(outcome, semantic_type=segment.semantic_type,
                    evidence=replace(outcome.evidence, independent_sources=independent_views))
            for outcome in outcomes]


def promotion_failures(audit: dict[str, Any], *, canonical_hash: str,
                       candidate_hash: str) -> list[str]:
    """Per-object gates in addition to family confidence, bound to exact artifacts.

    Audits are produced by independent validation jobs, not by a mesh generator.
    A passing audit is necessary, not sufficient: the existing decide() confidence
    policy must also pass. Missing and non-finite metrics always refuse promotion.
    """
    failures = []
    if audit.get("canonical_sha256_before") != canonical_hash or \
            audit.get("canonical_sha256_after") != canonical_hash:
        failures.append("canonical geometry changed or hash evidence missing")
    if audit.get("candidate_sha256") != candidate_hash:
        failures.append("audit does not match candidate")
    for gate in ("source_provenance_valid", "license_valid", "privacy_review_passed",
                 "collision_sanity_passed", "surface_continuity_passed",
                 "performance_budget_passed", "semantic_review_passed"):
        if audit.get(gate) is not True:
            failures.append(gate)
    if not audit.get("validator_run_id") or not audit.get("validation_source_locators"):
        failures.append("independent validation provenance missing")
    for name in ("lidar_error_m", "geometry_residual_m"):
        samples = np.asarray(audit.get(name, []), dtype=np.float64)
        if samples.ndim != 1 or len(samples) < 20 or not np.isfinite(samples).all() or \
                (samples < 0).any():
            failures.append(f"{name}: needs >=20 finite independent comparisons")
        elif float(samples.mean()) > 0.05 or float(np.percentile(samples, 95)) > 0.15:
            failures.append(f"{name}: exceeds MAE 0.05 m or P95 0.15 m")
    gap = audit.get("maximum_seam_gap_m")
    if not isinstance(gap, (int, float)) or not np.isfinite(gap) or not 0 <= gap <= 0.01:
        failures.append("seam gap must be measured and <=0.01 m")
    views = audit.get("independent_view_count", 0)
    if not isinstance(views, int) or views < 3:
        failures.append("fewer than three independent views")
    return failures


def decide_dense(outcome: FitOutcome, *, object_id: str, existing: WorldObject,
                 audit: dict[str, Any], canonical_hash: str, candidate_hash: str,
                 rights: dict[str, SourceRights]) -> Decision:
    """No new geometry enters the served inventory unless *all* gates pass.

    Failed attempts return the identical prior, not a weakened or duplicated one.
    Candidate generation is kept separate from this promotion entry point.
    """
    failures = promotion_failures(audit, canonical_hash=canonical_hash,
                                  candidate_hash=candidate_hash)
    if len(canonical_hash) != 64 or len(candidate_hash) != 64:
        failures.append("invalid artifact hash")
    if audit.get("object_id") != object_id or audit.get("canonical_id") != existing.id:
        failures.append("audit does not match stable object/canonical IDs")
    if outcome.semantic_type != existing.semantic_type:
        failures.append("candidate cannot replace a different semantic object (e.g. roof for whole house)")
    if existing.anchor != (outcome.frame.lon, outcome.frame.lat, outcome.frame.height_m):
        failures.append("candidate and canonical object use different frames")
    for ref in outcome.evidence.refs:
        source = rights.get(ref.source_id)
        if source is None or source.license_id != ref.license_id:
            failures.append("unregistered or mismatched source license")
            continue
        try:
            source.require(*build_uses("cv_processing", "derived_mesh", "texture_baking",
                                       "persistent_hosting", "redistribution"))
        except ValueError as exc:
            failures.append(str(exc))
    if not outcome.evidence.refs:
        failures.append("no source evidence")
    coverage = audit.get("observed_surface_fraction")
    if not isinstance(coverage, (int, float)) or not np.isfinite(coverage) or \
            not 0.7 <= coverage <= 1:
        failures.append("observed surface fraction must be >=0.7 and <=1")
    if failures:
        return Decision(existing, "kept_existing", "; ".join(failures))
    residual = np.asarray(audit["geometry_residual_m"], dtype=np.float64)
    evidence = replace(outcome.evidence, fit_rms_m=float(np.sqrt(np.mean(residual ** 2))),
                       fit_max_m=float(residual.max()), coverage=coverage,
                       inlier_fraction=float((residual <= 0.15).mean()),
                       lidar_disagreement_m=float(np.mean(audit["lidar_error_m"])))
    decision = decide(replace(outcome, evidence=evidence), object_id=object_id, existing=existing)
    if decision.outcome.startswith("accepted_"):
        flags = (*decision.object.flags, "reconstruction_promoted")
        if isinstance(outcome.geometry, ParametricBuilding):
            flags = (*flags, "mixed_prior_with_measured_detail")
        fit = replace(decision.object.fit, parameters={
            **decision.object.fit.parameters, "promotion_audit": {
                "validator_run_id": audit["validator_run_id"],
                "canonical_sha256": canonical_hash, "candidate_sha256": candidate_hash,
                "validation_source_locators": audit["validation_source_locators"],
            }})
        return replace(decision, object=replace(decision.object, flags=flags, fit=fit))
    return decision
