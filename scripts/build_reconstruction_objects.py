#!/usr/bin/env python3
"""Fit reviewed dense instances; write an isolated candidate release, never live assets.

The bundle references an immutable dense NPZ (vertices, faces, face_labels),
reviewed instances, the original input manifest and per-object validator audits.
No giant dense mesh is sent to consumers and no failed candidate removes a prior.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402

from smc.geometry.base import TriMesh, geometry_to_json  # noqa: E402
from smc.geometry.building import ParametricBuilding  # noqa: E402
from smc.reconstruction.colmap_runner import preflight_inputs  # noqa: E402
from smc.reconstruction.contracts import load_rights, sha256_file  # noqa: E402
from smc.reconstruction.semantic_objects import (  # noqa: E402
    decide_dense,
    fit_dense_segment,
    split_dense_mesh,
)
from smc.world.compile import write_glb  # noqa: E402
from smc.world.coverage import coverage_report  # noqa: E402
from smc.world.object import EvidenceRef, GeometryBasis, WorldObject  # noqa: E402


def candidate_geometry_hash(geometry) -> str:
    payload = json.dumps(geometry_to_json(geometry), sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(payload).hexdigest()


def build(bundle_path: Path, canonical: Path, existing_path: Path, rights_path: Path,
          benchmark: Path, output: Path) -> dict:
    document = json.loads(bundle_path.read_text())
    if document.get("schema") != "kerbside.dense_instances/1":
        raise ValueError("unsupported dense-instance bundle schema")
    canonical_hash = sha256_file(canonical)
    if document.get("canonical_sha256") != canonical_hash:
        raise ValueError("dense bundle canonical hash mismatch")
    inputs = Path(document["inputs"])
    dense_path = Path(document["dense_npz"])
    for target, expected in ((inputs, document["inputs_sha256"]),
                             (dense_path, document["dense_npz_sha256"]),
                             (existing_path, document["existing_sha256"])):
        if sha256_file(target) != expected:
            raise ValueError(f"bundle input checksum mismatch: {target}")
    rows, frame = preflight_inputs(inputs, rights_path, benchmark)
    if document.get("coordinate_frame") != "ENU_m_WGS84_ellipsoid" or \
            document.get("enu_origin_wgs84") != [frame.lon, frame.lat, frame.height_m]:
        raise ValueError("dense evidence frame does not match aligned cameras")
    observations = {row.observation_uid: row for row in rows}
    rights = load_rights(rights_path)
    with np.load(dense_path, allow_pickle=False) as arrays:
        mesh = TriMesh(arrays["vertices"], arrays["faces"],
                       arrays.get("normals"), arrays.get("uvs"))
        instances = {int(label): record for label, record in document["instances"].items()}
        segments, unknown = split_dense_mesh(mesh, arrays["face_labels"], instances)
    existing = {}
    for line in existing_path.read_text().splitlines():
        obj = WorldObject.from_json(json.loads(line))
        if obj.id in existing:
            raise ValueError("duplicate canonical object ID")
        existing[obj.id] = obj
    if len({segment.canonical_id for segment in segments}) != len(segments):
        raise ValueError("aggregate same-building facade partitions before fitting; duplicate prior")
    output.mkdir(parents=True, exist_ok=False)
    decisions = []
    accepted_ids = set()
    effective = dict(existing)
    with (output / "attempts.jsonl").open("x") as journal:
        for segment in segments:
            record = next(row for row in instances.values() if row["object_id"] == segment.object_id)
            prior = existing.get(segment.canonical_id)
            event = {"object_id": segment.object_id, "canonical_id": segment.canonical_id,
                     "semantic_type": segment.semantic_type, "outcome": "kept_existing"}
            try:
                if prior is None:
                    raise ValueError("no canonical object: send new detection to review first")
                observed = [observations[uid] for uid in record["observation_uids"]]
                if len({row.observation_uid for row in observed}) != len(observed):
                    raise ValueError("duplicate observation support")
                views = len({row.sequence_id for row in observed})
                refs = tuple(EvidenceRef("photogrammetry", row.source_id,
                                         f"{dense_path}#{row.observation_uid}", row.license_id,
                                         count=1) for row in observed)
                residuals = {int(edge): np.asarray(samples, dtype=np.float64)
                             for edge, samples in record.get("facade_residuals", {}).items()}
                outcomes = fit_dense_segment(
                    segment, frame, refs, independent_views=views,
                    prior=prior.geometry if isinstance(prior.geometry, ParametricBuilding) else None,
                    residuals=residuals if residuals else None,
                    material=record.get("material", prior.material),
                )
                if len(outcomes) != 1:
                    raise ValueError("multi-part fit requires separate support-object audits")
                outcome = outcomes[0]
                audit = record.get("audit", {})
                if audit.get("independent_view_count") != views:
                    raise ValueError("audit view count disagrees with source sequence support")
                decision = decide_dense(
                    outcome, object_id=prior.id, existing=prior, audit=audit,
                    canonical_hash=canonical_hash,
                    candidate_hash=candidate_geometry_hash(outcome.geometry), rights=rights,
                )
                event.update(outcome=decision.outcome, reason=decision.reason)
                if decision.outcome.startswith("accepted_"):
                    write_glb(decision.object, output / f"object-{len(decisions)}.glb")
                    effective[prior.id] = decision.object
                    accepted_ids.add(prior.id)
            except (ValueError, KeyError, OSError) as exc:
                event["reason"] = str(exc)
            journal.write(json.dumps(event, allow_nan=False) + "\n")
            journal.flush()
            os.fsync(journal.fileno())
            decisions.append(event)
    if sha256_file(canonical) != canonical_hash:
        raise ValueError("canonical changed during fitting; candidate release rejected")
    with (output / "world_objects.jsonl").open("x") as stream:
        for obj in effective.values():
            stream.write(json.dumps(obj.to_json(), allow_nan=False) + "\n")
    summary = {"schema": "kerbside.object_candidate_release/1",
               "bundle_sha256": sha256_file(bundle_path), "canonical_sha256": canonical_hash,
               "existing_sha256": sha256_file(existing_path),
               "attempts": len(decisions), "accepted": sum(
                   row["outcome"].startswith("accepted_") for row in decisions),
               "unknown_faces_for_review": len(unknown.faces),
               "objects": len(effective), "promotion_state": "candidate_only",
               "consumer": "existing WorldObject JSONL + accepted object GLB",
               "attribution": [{"source_id": source_id, "license_id": license_id,
                                "attribution": attribution} for source_id, license_id, attribution
                               in sorted({(row.source_id, row.license_id, row.attribution) for row in rows})],
               "appearance": "unchanged; dense colours/atlas baking not compiled by this adapter"}
    inventory = []
    for obj in effective.values():
        if obj.id in accepted_ids or "reconstruction_promoted" in obj.flags:
            tier = "mixed_prior_with_measured_detail" if isinstance(
                obj.geometry, ParametricBuilding) else "reconstructed"
        elif obj.basis is GeometryBasis.UNRESOLVED:
            tier = "unresolved"
        elif obj.basis is GeometryBasis.MEASURED:
            tier = "measured_spline" if obj.family == "spline_extrusion" else "measured_other"
        elif obj.family == "primitive_assembly" and obj.evidence.grade == "mapped":
            tier = "mapped_primitive"
        else:
            tier = "prior" if obj.basis is GeometryBasis.PRIOR else "procedural"
        inventory.append({"id": obj.id, "category": obj.semantic_type,
                          "geometry": tier, "appearance": "unknown"})
    summary["coverage"] = coverage_report(inventory)
    summary["coverage"]["scope"] = "complete supplied WorldObject inventory, not entire city"
    (output / "release.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--canonical", required=True, type=Path)
    parser.add_argument("--existing", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--rights", type=Path, default=ROOT / "data/reconstruction/source_rights.json")
    parser.add_argument("--benchmark", type=Path, default=ROOT / "data/reconstruction/pilot_benchmark.json")
    args = parser.parse_args()
    print(json.dumps(build(args.bundle, args.canonical, args.existing, args.rights,
                           args.benchmark, args.out), indent=2))


if __name__ == "__main__":
    main()
