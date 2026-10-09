"""Auditable opening priors plus pixel cues; never standard-size geometry substitution.

Garage dimensions are a soft prior, not a code requirement. Image-reviewed steps
leading to a pedestrian door beat that prior. Lines alone cannot distinguish
treads from garage panels, and detector scores are not calibrated certainty.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

SCHEMA = "kerbside.opening_reasoning/1"
GARAGE_REFERENCE_M = {"width": 8 * 0.3048, "height": 7 * 0.3048}
GARAGE_PRIOR_SOURCE = (
    "https://www.clopaydoor.com/residential/buyingguide/how-to-install-garage-door"
)


def normalize_label(label: str) -> str:
    words = list(dict.fromkeys(str(label).lower().split()))
    value = " ".join(words)
    return (
        value
        if value in {"window", "door", "garage door", "stairs", "fire escape", "balcony", "canopy"}
        else str(label).lower().strip()
    )


def line_evidence(image: np.ndarray) -> dict:
    """Report repeated panel lines, NOT a staircase certification."""
    horizontal, vertical = [], []
    if not image.size or min(image.shape[:2]) < 16:
        return {"panel_grid": False, "horizontal": [], "vertical": []}
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    grey = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(grey)
    h, w = grey.shape
    lines = cv2.HoughLinesP(
        cv2.Canny(grey, 35, 100),
        1,
        math.pi / 180,
        max(6, min(w, h) // 7),
        minLineLength=max(5, min(w, h) // 7),
        maxLineGap=max(2, min(w, h) // 12),
    )
    for x0, y0, x1, y1 in [] if lines is None else lines[:, 0]:
        if abs(y1 - y0) <= max(2, h * 0.035) and abs(x1 - x0) >= w * 0.45:
            at = (y0 + y1) / 2 / h
            if 0.08 < at < 0.92 and all(abs(at - v) > 0.07 for v in horizontal):
                horizontal.append(float(at))
        if abs(x1 - x0) <= max(2, w * 0.035) and abs(y1 - y0) >= h * 0.18:
            at = (x0 + x1) / 2 / w
            if 0.08 < at < 0.92 and all(abs(at - v) > 0.07 for v in vertical):
                vertical.append(float(at))
    return {
        "panel_grid": len(horizontal) >= 2 and len(vertical) >= 1,
        "horizontal": sorted(horizontal),
        "vertical": sorted(vertical),
    }


def reason_opening(
    image: np.ndarray,
    width_m: float,
    height_m: float,
    source_label: str,
    *,
    image_sha256: str | None = None,
    step_review: dict | None = None,
    associated_door: bool = False,
) -> dict:
    if not all(math.isfinite(v) and v > 0 for v in (width_m, height_m)):
        raise ValueError("finite positive opening dimensions required")
    label = normalize_label(source_label)
    cues = line_evidence(image)
    review = step_review or {}
    count = review.get("count")
    has_tread = (
        isinstance(count, int) and not isinstance(count, bool) and count >= 1
    ) or review.get("at_least_one_tread") is True
    reviewed_steps = bool(
        image_sha256
        and review.get("image_sha256") == image_sha256
        and review.get("visible")
        and review.get("reviewer")
        and has_tread
        and review.get("at_door_threshold")
        and review.get("pedestrian_door_visible")
    )
    aspect = width_m / height_m
    # Broad, deliberately tolerant bands cover unusual/custom and double garages.
    # These dimensions come from canonical-prior rectification, not measured door edges.
    garage_size = 1.9 <= width_m <= 6.5 and 1.5 <= height_m <= 3.3 and 0.9 <= aspect <= 3.2
    narrow_leaf = 0.5 <= width_m <= 1.85 and height_m >= 1.65 and aspect < 0.9
    result = {
        "schema": SCHEMA,
        "original_label": source_label,
        "class": "unknown",
        "certainty": "inferred_rule_screen_not_measured",
        "reasons": [],
        "dimensions_m": {"width": width_m, "height": height_m},
        "garage_reference_m": GARAGE_REFERENCE_M,
        "garage_prior_source": GARAGE_PRIOR_SOURCE,
        "garage_size_plausible": garage_size,
        "narrow_door_plausible": narrow_leaf,
        "pixel_cues": cues,
        "steps_reviewed": reviewed_steps,
        "associated_door": associated_door,
        "rules_out_garage": False,
        "render_steps": False,
    }
    if reviewed_steps:
        result.update(
            {
                "class": "stair_recess_candidate",
                "certainty": "image_reviewed_not_measured",
                "rules_out_garage": True,
                "reasons": ["visible_tread_to_pedestrian_door_threshold"],
            }
        )
        if not narrow_leaf:
            result["reasons"].append("observed_entrance_overrides_standard_size_prior")
    elif garage_size and (
        cues["panel_grid"] or (len(cues["horizontal"]) >= 3 and not associated_door)
    ):
        result.update(
            {
                "class": "garage_candidate",
                "reasons": [
                    "garage_scale_and_rectangular_panel_grid"
                    if cues["panel_grid"]
                    else "garage_scale_repeated_sections_without_pedestrian_door"
                ],
            }
        )
        if label == "stairs":
            result["reasons"].append("stair_label_conflicts_with_panelled_vehicle_opening")
    elif label == "garage door" and garage_size:
        result.update(
            {
                "class": "garage_candidate",
                "reasons": ["garage_label_and_plausible_vehicle_opening_size"],
            }
        )
    elif label == "door" and narrow_leaf:
        result.update(
            {
                "class": "pedestrian_entry_candidate",
                "reasons": ["narrow_tall_door_not_typical_vehicle_opening"],
            }
        )
    elif label == "stairs":
        if associated_door and width_m <= 1.85 and cues["horizontal"]:
            result["class"] = "stair_recess_candidate"
            result["reasons"].append("narrow_step_region_at_detected_door_needs_tread_review")
        result["reasons"].append("detector_or_horizontal_lines_do_not_prove_visible_treads")
    else:
        result["reasons"].append("insufficient_or_conflicting_opening_evidence")
    return result


def reason_proposals(
    image: np.ndarray,
    proposals: list[dict],
    width_m: float,
    height_m: float,
    *,
    image_sha256: str | None = None,
    reviews: dict | None = None,
) -> list[dict]:
    """Keep raw detections intact; attach reasoning and sibling-door relationships."""
    h, w = image.shape[:2]
    valid = []
    for source_index, item in enumerate(proposals):
        box = item.get("box", [])
        if len(box) != 4 or not all(
            isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in box
        ):
            continue
        x0, y0, x1, y1 = box
        if x0 >= x1 or y0 >= y1:
            continue
        valid.append(
            {**item, "kind": normalize_label(item.get("kind", "")), "proposal_index": source_index}
        )
    doors = [
        p
        for p in valid
        if p["kind"] == "door"
        and 0.5 <= (p["box"][2] - p["box"][0]) * width_m <= 1.85
        and (p["box"][3] - p["box"][1]) * height_m >= 1.65
    ]
    result = []
    for item in valid:
        if item["kind"] not in {"door", "garage door", "stairs"}:
            result.append(item)
            continue
        x0, y0, x1, y1 = item["box"]
        linked = any(
            min(x1, d["box"][2]) - max(x0, d["box"][0])
            >= min(x1 - x0, d["box"][2] - d["box"][0]) * 0.5
            and abs(y0 - d["box"][3]) * height_m <= 0.5
            for d in doors
        )
        left, top = max(0, round(x0 * w)), max(0, round(y0 * h))
        right, bottom = min(w, round(x1 * w)), min(h, round(y1 * h))
        decision = reason_opening(
            image[top:bottom, left:right],
            (x1 - x0) * width_m,
            (y1 - y0) * height_m,
            item.get("kind", ""),
            image_sha256=image_sha256,
            step_review=(reviews or {}).get(str(item["proposal_index"])),
            associated_door=linked,
        )
        result.append({**item, "opening_reasoning": decision})
    return result
