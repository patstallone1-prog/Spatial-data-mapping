"""Bounded OpenCV opening-edge support; abstain rather than invent a rectangle.

Grounded detector proposals locate candidate objects. Canny + probabilistic Hough
lines refine only a nearby supported perimeter. Texture lines alone are not doors,
garage openings or stairs. Input is registered facade space, not arbitrary camera
pixels. None of these pixel measurements establish independent metric truth.
"""

from __future__ import annotations

import math

import cv2
import numpy as np


def refine_opening(image: np.ndarray, box: list[float]) -> dict:
    h, w = image.shape[:2]
    x0, y0, x1, y1 = np.array(box) * [w, h, w, h]
    bw, bh = x1 - x0, y1 - y0
    fallback = {"box": box, "basis": "detector_box_unresolved_edges", "supported_sides": 0}
    if min(bw, bh) < 12:
        return fallback
    pad = max(4, round(min(bw, bh) * 0.12))
    left, top = max(0, math.floor(x0 - pad)), max(0, math.floor(y0 - pad))
    right, bottom = min(w, math.ceil(x1 + pad)), min(h, math.ceil(y1 + pad))
    grey = cv2.cvtColor(image[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(grey, 40, 120)
    lines = cv2.HoughLinesP(
        edges,
        1,
        math.pi / 180,
        max(8, round(min(bw, bh) * 0.15)),
        minLineLength=max(8, round(min(bw, bh) * 0.4)),
        maxLineGap=3,
    )
    candidates = [[], [], [], []]  # left, top, right, bottom
    for a, b, c, d in [] if lines is None else lines[:, 0]:
        a, c = a + left, c + left
        b, d = b + top, d + top
        dx, dy = abs(c - a), abs(d - b)
        if dx <= max(2, dy * 0.08) and dy >= bh * 0.50:
            at = (a + c) / 2
            for side, expected in ((0, x0), (2, x1)):
                if abs(at - expected) <= bw * 0.12:
                    candidates[side].append((dy / bh - abs(at - expected) / bw, at))
        if dy <= max(2, dx * 0.08) and dx >= bw * 0.50:
            at = (b + d) / 2
            for side, expected in ((1, y0), (3, y1)):
                if abs(at - expected) <= bh * 0.12:
                    candidates[side].append((dx / bw - abs(at - expected) / bh, at))
    count = sum(bool(c) for c in candidates)
    if count != 4:
        return {
            **fallback,
            "supported_sides": count,
            "reason": "incomplete_or_nonrectangular_perimeter",
        }
    a, b, c, d = [max(options)[1] for options in candidates]
    if c <= a or d <= b:
        return fallback
    return {
        "box": [a / w, b / h, c / w, d / h],
        "basis": "four_supported_nearby_image_edges",
        "supported_sides": 4,
        "pixel_boundary_sigma": max(2, min(bw, bh) * 0.02),
        "metric_basis": "registered_facade_prior_not_independent_measurement",
    }


def opening_sanity(openings: list[dict]) -> dict:
    """Same-style column alignment is evidence, never permission to snap a window."""
    comparisons = []
    windows = [o for o in openings if o["kind"] == "window"]
    for i, a in enumerate(windows):
        for b in windows[i + 1 :]:
            if abs(a["v"] - b["v"]) < 1.5:
                continue
            if a.get("design", {}).get("shape") != b.get("design", {}).get("shape"):
                continue
            centres = abs(a["u"] + a["w"] / 2 - b["u"] - b["w"] / 2)
            if centres > max(a["w"], b["w"]) * 0.75:
                continue
            residual = abs(a["u"] - b["u"])
            comparisons.append(
                {
                    "a": a["id"],
                    "b": b["id"],
                    "left_edge_residual_m": residual,
                    "status": "consistent" if residual <= 0.25 else "review_alignment_anomaly",
                }
            )
    return {
        "geometry_modified": False,
        "window_columns": comparisons,
        "neighbour_priors": "not used to overwrite this house's observed entrance",
    }
