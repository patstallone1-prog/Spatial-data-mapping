"""Diagnostic point-to-curb alignment, never an independent accuracy measurement.

Fit camera east/north shift and radial distance scale against *fixed* reference
segments. A straight curb cannot separate height/scale bias from translation:
report the data Jacobian's null space, not the optimizer's spurious certainty.
No prior is added to manufacture rank and no result is a publishable world-fact.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import least_squares


def error_stats(values: np.ndarray) -> dict:
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if not len(values):
        return {"n": 0, "mae_m": None, "abs_p50_m": None, "abs_p90_m": None}
    return {
        "n": len(values),
        "mae_m": float(np.mean(np.abs(values))),
        "abs_p50_m": float(np.median(np.abs(values))),
        "abs_p90_m": float(np.percentile(np.abs(values), 90)),
    }


def nearest_segments(points: np.ndarray, segments: np.ndarray) -> tuple:
    """Exact finite-segment distances; bounded batches avoid an all-city NxM array."""
    points, segments = np.asarray(points, float), np.asarray(segments, float)
    if segments.shape != (len(segments), 2, 2) or not len(segments):
        raise ValueError("nonempty (n, 2, 2) reference segments required")
    if not np.isfinite(segments).all():
        raise ValueError("nonfinite reference")
    delta = segments[:, 1] - segments[:, 0]
    length2 = np.sum(delta * delta, axis=1)
    if np.any(length2 < 1e-10):
        raise ValueError("zero-length reference segment")
    ids, distances, parameters = [], [], []
    for first in range(0, len(points), 128):
        rel = points[first : first + 128, None, :] - segments[None, :, 0, :]
        t = np.sum(rel * delta, axis=2) / length2
        offset = rel - np.clip(t, 0, 1)[:, :, None] * delta
        d2 = np.sum(offset * offset, axis=2)
        idx = np.argmin(d2, axis=1)
        row = np.arange(len(idx))
        ids.extend(idx)
        distances.extend(np.sqrt(d2[row, idx]))
        parameters.extend(t[row, idx])
    return np.asarray(ids, int), np.asarray(distances), np.asarray(parameters)


def fit_camera(
    points: np.ndarray,
    camera: np.ndarray,
    segments: np.ndarray,
    *,
    max_match_m: float = 8.0,
    shift_bound_m: float = 6.0,
    scale_bounds: tuple[float, float] = (0.5, 1.5),
) -> dict:
    """Oracle fit to known curb lines. Freeze associations before optimization.

    Radial scale is *compatible with* a height error on a flat road; segmentation,
    pitch, road slope and reference error can cause it too. Never call it a measured
    camera height. Adjacent pixels are not independent surveyed control points.
    """
    points, camera, segments = map(lambda a: np.asarray(a, float), (points, camera, segments))
    base = {"purpose": "oracle_alignment_diagnostic", "publishable": False}
    if points.ndim != 2 or points.shape[1] != 2 or not np.isfinite(points).all():
        raise ValueError("finite (n, 2) points required")
    if camera.shape != (2,) or not np.isfinite(camera).all():
        raise ValueError("finite camera east/north required")
    ids, distance, t = nearest_segments(points, segments)
    keep = (distance <= max_match_m) & (t > 0) & (t < 1)
    base.update(
        {
            "points_total": len(points),
            "points_matched": int(keep.sum()),
            "raw_all_points": error_stats(distance),
        }
    )
    if keep.sum() < 12:
        return {**base, "status": "insufficient_support"}
    pts, refs = points[keep], segments[ids[keep]]
    delta = refs[:, 1] - refs[:, 0]
    normal = np.column_stack((-delta[:, 1], delta[:, 0]))
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    radial = pts - camera
    # Linear system: n.shift + n.radial * (scale - 1) + signed_offset = 0.
    design = np.column_stack((normal, np.sum(normal * radial, axis=1)))
    offset = np.sum((pts - refs[:, 0]) * normal, axis=1)
    fit = least_squares(
        lambda x: design @ x + offset,
        [0.0, 0.0, 0.0],
        # SciPy rescales robust-loss Jacobians in place. Never let it
        # mutate the matrix also used to evaluate our residual function.
        jac=lambda _: design.copy(),
        bounds=(
            [-shift_bound_m, -shift_bound_m, scale_bounds[0] - 1],
            [shift_bound_m, shift_bound_m, scale_bounds[1] - 1],
        ),
        loss="soft_l1",
        f_scale=0.15,
    )
    residual = design @ fit.x + offset
    # Use inliers only: one erroneous cross-street association must not cure rank loss.
    inliers = np.abs(residual) <= 0.35
    # Express scale in metres at a typical observed distance for comparable singular values.
    radius = max(1.0, float(np.median(np.linalg.norm(radial, axis=1))))
    normalized = design[inliers] / np.array([1.0, 1.0, radius])
    if len(normalized) < 12:
        return {**base, "status": "insufficient_inliers", "oracle_residual": error_stats(residual)}
    _, singular, vt = np.linalg.svd(normalized, full_matrices=False)
    rank = int(np.sum(singular > max(1e-8, singular[0] * 0.02)))
    null = vt[rank:]
    identified = [bool(not len(null) or np.linalg.norm(null[:, j]) < 0.05) for j in range(3)]
    hit_bound = bool(np.any(np.abs(fit.active_mask) > 0))
    return {
        **base,
        "status": "identified" if rank == 3 and not hit_bound else "ambiguous",
        "rank": rank,
        "singular_values": singular.tolist(),
        "parameters_identified": dict(zip(("east", "north", "scale"), identified, strict=True)),
        "bound_hit": hit_bound,
        "inliers": int(inliers.sum()),
        "candidate_shift_m": fit.x[:2].tolist(),
        "candidate_scale": float(1 + fit.x[2]),
        "raw_matched_points": error_stats(distance[keep]),
        "oracle_residual": error_stats(residual),
        "warning": "fitted reference is not held-out truth; scale is not proven height bias",
    }
