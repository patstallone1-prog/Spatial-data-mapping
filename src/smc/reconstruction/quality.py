"""Evidence gates for publishing visual detail without overstating accuracy."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from smc.reconstruction.contracts import LOD_BUDGET_BYTES, PILOT_CHUNKS, sha256_file
from smc.reconstruction.glb import inspect_glb


def _distribution(values: list[float], *, minimum: int) -> tuple[float, float]:
    if len(values) < minimum or not all(math.isfinite(v) and v >= 0 for v in values):
        raise ValueError(f"needs at least {minimum} finite non-negative independent samples")
    return float(np.median(values)), float(np.percentile(values, 95))


def evaluate_metrics(metrics: dict[str, Any]) -> list[str]:
    failures: list[str] = []

    def check_distribution(name: str, minimum: int, median_limit: float, p95_limit: float) -> None:
        try:
            median, p95 = _distribution(metrics.get(name) or [], minimum=minimum)
        except ValueError as exc:
            failures.append(f"{name}: {exc}")
            return
        if median > median_limit or p95 > p95_limit:
            failures.append(f"{name}: median={median:.3f}, p95={p95:.3f}")

    check_distribution("held_out_edge_error_px", 300, 2.0, 5.0)
    check_distribution("controlled_camera_translation_error_m", 20, 0.15, 0.50)
    residual = metrics.get("facade_residual_error_m") or []
    if len(residual) < 100 or any(not math.isfinite(x) or x < 0 for x in residual):
        failures.append("facade_residual_error_m: needs 100 valid lidar comparisons")
    elif float(np.mean(residual)) > 0.05 or float(np.percentile(residual, 95)) > 0.15:
        failures.append("facade residual exceeds MAE 0.05 m or P95 0.15 m")
    if float(metrics.get("maximum_seam_gap_m", math.inf)) > 0.01:
        failures.append("visual cell or canonical-surface seam gap exceeds 0.01 m")
    masks = metrics.get("dynamic_mask_confusion") or {}
    tp, fp, fn = (int(masks.get(key, 0)) for key in ("tp", "fp", "fn"))
    if tp < 100 or tp / max(tp + fp, 1) < 0.98 or tp / max(tp + fn, 1) < 0.95:
        failures.append("dynamic mask precision <0.98, recall <0.95, or sample too small")
    if int(metrics.get("published_unredacted_face_or_plate_count", -1)) != 0:
        failures.append("unredacted face or plate in published audit")
    if float(metrics.get("material_macro_f1", 0.0)) < 0.85:
        failures.append("material macro-F1 below 0.85")
    if not metrics.get("material_building_and_block_disjoint", False):
        failures.append("material evaluation is not building and block disjoint")
    if float(metrics.get("visible_facade_observed_fraction", 0.0)) < 0.70:
        failures.append("observed visible facade area below 70%")
    if not metrics.get("all_texels_provenanced", False):
        failures.append("not every visual texel carries coverage provenance")
    if float(metrics.get("desktop_fps", 0.0)) < 60 or float(metrics.get("mobile_fps", 0.0)) < 30:
        failures.append("pilot frame rate below 60 desktop / 30 mobile FPS")
    if int(metrics.get("desktop_decoded_mb", 10_000)) > 350 or int(metrics.get("mobile_decoded_mb", 10_000)) > 180:
        failures.append("decoded tile memory exceeds 350 MB desktop / 180 MB mobile")
    return failures


def evaluate_promotion(output_dir: Path, benchmark_path: Path,
                       metrics_path: Path) -> list[str]:
    benchmark = json.loads(benchmark_path.read_text())
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    failures = evaluate_metrics(metrics)
    held = benchmark.get("held_out_observations") or []
    if len(held) < 300 or any(not row.get("image_sha256") for row in held):
        failures.append("benchmark lacks 300 verified image-byte hashes")
    truth = benchmark.get("truth") or {}
    for field in ("rtk_lidar_checkpoints", "building_disjoint_material_labels",
                  "human_reviewed_dynamic_masks", "fixed_near_field_cameras"):
        if not truth.get(field):
            failures.append(f"benchmark lacks {field}")
    for key in PILOT_CHUNKS:
        path = output_dir / key / "cell.json"
        if not path.exists():
            failures.append(f"{key}: missing cell manifest")
            continue
        cell = json.loads(path.read_text())
        if cell.get("quality_state") != "promoted":
            failures.append(f"{key}: cell is not promoted")
        if cell.get("vertical_datum") == "unverified":
            failures.append(f"{key}: vertical datum unverified")
        if cell.get("missing_inputs"):
            failures.append(f"{key}: missing {', '.join(cell['missing_inputs'])}")
        for level, budget in LOD_BUDGET_BYTES.items():
            asset = cell.get("lod_assets", {}).get(str(level))
            if not asset:
                failures.append(f"{key}: missing visual LOD{level}")
                continue
            target = output_dir / key / asset["url"]
            if not target.is_file() or target.stat().st_size > budget:
                failures.append(f"{key}: missing or oversized LOD{level}")
                continue
            if target.stat().st_size != asset["bytes"] or sha256_file(target) != asset["sha256"]:
                failures.append(f"{key}: LOD{level} hash mismatch")
                continue
            glb = inspect_glb(target)
            if level > 0 and not {"EXT_meshopt_compression", "KHR_texture_basisu"} <= set(
                glb.get("extensionsUsed") or []
            ):
                failures.append(f"{key}: LOD{level} lacks meshopt/KTX2")
    return failures
