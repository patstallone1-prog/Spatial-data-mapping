"""Fuse reviewed, surface-rectified views into non-publishable evidence atlases.

This consumes registration output; it never estimates geometry or modifies a
canonical feature. KTX2/GLB compilation is deliberately a separate promotion step.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from smc.reconstruction.contracts import (
    SURFACE_SCHEMA,
    Coverage,
    load_rights,
    sha256_file,
    stable_id,
)
from smc.reconstruction.fusion import SurfaceView, complete_surface, fuse_views


def fuse_rectified_manifest(manifest_path: Path, rights_path: Path,
                            output_dir: Path, benchmark_path: Path | None = None) -> Path:
    """Write RGB, coverage, packed per-texel source IDs, and metadata.

    Every supplied view has to be registered to the same canonical face, carry
    reviewed exclusion masks, and pass source-rights and byte-hash checks.
    Returned Parquet is intermediate evidence, not a served visual cell.
    """
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema_version") != 1 or not manifest.get("surfaces"):
        raise ValueError("rectified manifest needs schema_version=1 and surfaces")
    rights = load_rights(rights_path)
    held_out = set()
    if benchmark_path is not None:
        benchmark = json.loads(benchmark_path.read_text())
        held_out = {row["observation_uid"] for row in benchmark["held_out_observations"]}
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    seen_faces: set[tuple[str, str]] = set()
    for surface in manifest["surfaces"]:
        feature_id = str(surface["canonical_feature_id"])
        face_id = str(surface["canonical_face_id"])
        key = (feature_id, face_id)
        if key in seen_faces:
            raise ValueError(f"duplicate canonical face {key}")
        seen_faces.add(key)
        views: list[SurfaceView] = []
        source_index: list[dict[str, str]] = []
        seen_observations: set[str] = set()
        licenses: set[str] = set()
        times: list[datetime] = []
        for item in surface["views"]:
            observation_uid = str(item["observation_uid"])
            if observation_uid in held_out or observation_uid in seen_observations:
                raise ValueError(f"held-out or duplicate observation: {observation_uid}")
            seen_observations.add(observation_uid)
            if not item.get("privacy_reviewed"):
                raise ValueError(f"unreviewed privacy mask: {item['observation_uid']}")
            source = rights[str(item["source_id"])]
            source.require("cv_processing", "texture_baking", "persistent_hosting",
                           "redistribution", "commercial_use")
            if item["license_id"] != source.license_id:
                raise ValueError("source license does not match rights registry")
            image_path = Path(item["image_path"])
            mask_path = Path(item["visibility_mask_path"])
            if sha256_file(image_path) != item["image_sha256"]:
                raise ValueError(f"image hash mismatch: {item['observation_uid']}")
            if sha256_file(mask_path) != item["visibility_mask_sha256"]:
                raise ValueError(f"mask hash mismatch: {item['observation_uid']}")
            bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
            mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
            if bgr is None or mask is None or set(np.unique(mask)) - {0, 255}:
                raise ValueError("rectified image or binary mask is invalid")
            views.append(SurfaceView(
                cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), mask == 255,
                float(item["weight"]), float(item["pixels_per_m"]),
                str(item["observation_uid"]), str(item["sequence_id"]),
            ))
            licenses.add(source.license_id)
            source_index.append({
                "observation_uid": observation_uid,
                "source_id": source.source_id,
                "license_id": source.license_id,
                "attribution": source.attribution,
            })
            times.append(datetime.fromisoformat(item["captured_at"].replace("Z", "+00:00")))
            if times[-1].tzinfo is None:
                raise ValueError("capture timestamps must include a timezone")
        if not views:
            raise ValueError(f"no views for {key}")
        fused = fuse_views(views, output_pixels_per_m=float(surface["pixels_per_m"]))
        completed = complete_surface(fused, material=str(surface.get("material", "unknown")))
        # Each bit names one reviewed observation. Pack along the view axis to
        # support arbitrarily many source cameras without lossy uint64 limits.
        source_bits = np.packbits(np.stack([view.visible for view in views], axis=-1), axis=-1)
        source_bits[completed.coverage > Coverage.MULTIVIEW_OBSERVATION] = 0
        surface_id = stable_id(manifest["cell_id"], feature_id, face_id)
        atlas = output_dir / f"{surface_id}.png"
        coverage = output_dir / f"{surface_id}-coverage.npz"
        if not cv2.imwrite(str(atlas), cv2.cvtColor(completed.rgb, cv2.COLOR_RGB2BGR)):
            raise OSError(f"could not write {atlas}")
        np.savez_compressed(coverage, classes=completed.coverage, source_bits=source_bits,
                            support_count=completed.support_count)
        (output_dir / f"{surface_id}-sources.json").write_text(json.dumps({
            "sources_in_bit_order": source_index,
            "rgb_sha256": sha256_file(atlas),
            "coverage_sha256": sha256_file(coverage),
        }, indent=2) + "\n")
        fractions = completed.fractions()
        rows.append({
            "schema_version": 1,
            "cell_id": str(manifest["cell_id"]),
            "surface_id": surface_id,
            "canonical_feature_id": feature_id,
            "canonical_face_id": face_id,
            "semantic_class": str(surface["semantic_class"]),
            "material_probabilities_json": json.dumps(surface.get("material_probabilities", {})),
            "geometry_confidence": float(surface.get("geometry_confidence", 0.0)),
            "direct_fraction": fractions["direct_observation"],
            "multiview_fraction": fractions["multiview_observation"],
            "inferred_fraction": sum(fractions[name] for name in (
                "same_surface_completion", "procedural_material", "generative_visual")),
            "unknown_fraction": fractions["unknown"],
            "provenance": "reviewed_rectified_surface_views",
            "source_observation_ids": [view.observation_id for view in views],
            "source_license_ids": sorted(licenses),
            "observed_from": min(times),
            "observed_to": max(times),
            "source_run_id": str(manifest["run_id"]),
        })
    output = output_dir / "surface-metadata.parquet"
    pq.write_table(pa.Table.from_pylist(rows, schema=SURFACE_SCHEMA), output)
    return output
