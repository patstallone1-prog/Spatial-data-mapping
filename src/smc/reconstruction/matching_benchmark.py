"""ID-corresponded held-out metric scoring, never nearest-reference fitting.

The frozen manifest names every attempted case/checkpoint before reconstruction.
Missing predictions and unidentifiable cases stay in both denominators. Finite
error quantiles are conditional and labelled as such; all-attempt quantiles use
infinite error for failures (JSON null when that quantile is unbounded).
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter

import numpy as np


def assert_holdout_disjoint(inputs: list[dict], withheld: list[dict]) -> None:
    """Reject image aliases and sequence/date leakage, not only observation IDs."""
    fields = (
        ("observation_uid", "observation_uid"),
        ("image_sha256", "image_sha256"),
        ("pixel_sha256", "pixel_sha256"),
        ("sequence_id", "provider_sequence_id"),
    )
    for a, b in fields:
        left = {str(r[a]) for r in inputs if r.get(a)}
        right = {str(r.get(b) or r.get(a)) for r in withheld if r.get(b) or r.get(a)}
        if left & right:
            raise ValueError(f"held-out benchmark leakage via {a}")
    dates = {str(r["captured_at"])[:10] for r in inputs if r.get("captured_at")}
    if dates & {str(r["captured_at"])[:10] for r in withheld if r.get("captured_at")}:
        raise ValueError("held-out benchmark leakage via capture date")


def validate_benchmark(manifest: dict, fitting: dict[str, dict]) -> None:
    if manifest.get("coordinate_frame") != "local_ENU_m":
        raise ValueError("benchmark requires explicitly shared local_ENU_m frame")
    threshold = manifest.get("threshold_m", 0)
    if not np.isfinite(threshold) or threshold <= 0:
        raise ValueError("frozen positive metric threshold required")
    cases = manifest["cases"]
    if not cases or len({c["case_id"] for c in cases}) != len(cases):
        raise ValueError("benchmark needs unique attempted case IDs")
    for case in cases:
        config = fitting.get(case["case_id"], {})
        controls = config.get("controls", [])
        relations = config.get("relations", [])
        fit_ids = {r["track_id"] for r in controls}
        fit_sources = {r["source_id"] for r in [*controls, *relations]}
        checkpoints = case.get("checkpoints", [])
        if len({c["track_id"] for c in checkpoints}) != len(checkpoints):
            raise ValueError("duplicate held-out checkpoint")
        for point in checkpoints:
            if point["track_id"] in fit_ids or point["source_id"] in fit_sources:
                raise ValueError("held-out checkpoint used to fit or select geometry")
            synthetic = manifest.get("purpose") == "synthetic_regression_only"
            methods = {"analytic"} if synthetic else {"survey", "lidar"}
            correspondence = "analytic_id" if synthetic else "independent_reviewed_id"
            if (
                point.get("method") not in methods
                or point.get("correspondence") != correspondence
                or point.get("independent") is not True
                or len(point.get("evidence_sha256", "")) != 64
                or not point.get("source_id")
                or np.shape(point.get("xyz")) != (3,)
                or not np.isfinite(point["xyz"]).all()
            ):
                raise ValueError("independent survey/lidar checkpoint with reviewed ID required")


def evaluate(manifest: dict, predictions: dict[str, dict], fitting: dict[str, dict]) -> dict:
    validate_benchmark(manifest, fitting)
    planned = {c["case_id"] for c in manifest["cases"]}
    if set(predictions) - planned or set(fitting) - planned:
        raise ValueError("prediction/fitting cases absent from frozen benchmark")
    errors, outcomes, successes, points_within, reconstructed = [], Counter(), 0, 0, 0
    rows, case_max_errors = [], []
    for case in manifest["cases"]:
        result = predictions.get(case["case_id"], {})
        status = result.get("status", "not_attempted")
        outcomes[status] += 1
        good = status == "reconstructed"
        reconstructed += int(good)
        case_errors = []
        for checkpoint in case.get("checkpoints", []):
            estimate = result.get("points", {}).get(checkpoint["track_id"]) if good else None
            error = float("inf")
            if estimate is not None and np.shape(estimate) == (3,) and np.isfinite(estimate).all():
                error = float(np.linalg.norm(np.array(estimate) - checkpoint["xyz"]))
            case_errors.append(error)
            points_within += int(error <= manifest["threshold_m"])
        passed = bool(case_errors and max(case_errors) <= manifest["threshold_m"])
        case_max_errors.append(max(case_errors) if case_errors else float("inf"))
        successes += int(passed)
        errors.extend(case_errors)
        rows.append(
            {
                "case_id": case["case_id"],
                "status": status,
                "checkpoints": len(case_errors),
                "within_threshold": passed,
                "unscored_missing_truth": not bool(case_errors),
            }
        )
    finite = np.array([x for x in errors if np.isfinite(x)])

    def all_quantile(q):
        # Equal case weighting: a dense successful cell cannot drown out many
        # unsupported/failed streets with fewer (or zero) checkpoint samples.
        value = sorted(case_max_errors)[max(0, int(np.ceil(q * len(case_max_errors))) - 1)]
        return float(value) if np.isfinite(value) else None

    n = len(manifest["cases"])
    return {
        "schema_version": 1,
        "benchmark_id": manifest["benchmark_id"],
        "manifest_sha256": hashlib.sha256(
            json.dumps(manifest, sort_keys=True).encode()
        ).hexdigest(),
        "purpose": manifest.get("purpose", "independent_metric_benchmark"),
        "threshold_m": manifest["threshold_m"],
        "attempted_cases": n,
        "reconstructed_cases": reconstructed,
        "reconstruction_rate": reconstructed / n,
        "successful_cases": successes,
        "successful_reconstruction_rate": successes / n,
        "target_success_rate": 0.25,
        "target_met_on_this_benchmark": successes / n >= 0.25,
        "field_accuracy_claim": False,  # Diagnostic result, never automatic promotion.
        "has_independent_metric_truth": bool(errors)
        and manifest.get("purpose") != "synthetic_regression_only",
        "planned_checkpoints": len(errors),
        "finite_predictions": len(finite),
        "within_threshold_all_checkpoints": points_within / len(errors) if errors else 0.0,
        "conditional_finite_median_m": float(np.median(finite)) if len(finite) else None,
        "conditional_finite_p90_m": float(np.percentile(finite, 90)) if len(finite) else None,
        "all_attempts_median_m": all_quantile(0.5),
        "all_attempts_p90_m": all_quantile(0.9),
        "all_attempts_error_definition": "per-case worst checkpoint; missing truth/geometry = infinity",
        "unbounded_quantile_representation": "null; failures count as infinite error",
        "outcomes": dict(outcomes),
        "cases": rows,
        "publishable": False,
    }
