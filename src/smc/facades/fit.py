"""Constrained photo-front visual specifications, never replacements for canonical facts.

Image boxes have metric coordinates only through their explicit facade/camera prior.
Independent ground/curb controls may tighten uncertainty, but absent controls cannot
be invented. Depth, hidden stairs and wall material remain inferred unless corroborated.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from smc.facades.opening_reasoning import reason_opening, reason_proposals
from smc.facades.survey import openings as dark_openings


def storey_constraint(height: float, levels: int | None, rows: list[float]) -> dict:
    if not math.isfinite(height) or height <= 0:
        raise ValueError("finite positive building height required")
    if levels is not None:
        if not isinstance(levels, int) or levels <= 0 or not 2.3 <= height / levels <= 7:
            return {"status": "conflict", "reason": "height_vs_levels", "height_m": height}
        return {
            "status": "prior_constrained",
            "storeys": levels,
            "storey_height_m": height / levels,
            "basis": "supplied_height_and_levels",
        }
    gaps = np.diff(sorted(rows))
    gaps = gaps[(gaps >= 2.3) & (gaps <= 7)]
    if len(gaps):
        return {
            "status": "inferred",
            "storey_height_m": float(np.median(gaps)),
            "basis": "image_window_row_spacing",
            "storeys": None,
        }
    return {"status": "unknown", "storeys": None, "storey_height_m": None}


def opening_design(bgr: np.ndarray, width: float, height: float) -> dict:
    """Read long/wide shape and visible frame subdivisions; never guess hidden panes."""
    if width <= 0 or height <= 0 or not bgr.size:
        raise ValueError("nonempty opening and positive dimensions required")
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(grey, 60, 150)
    h, w = grey.shape
    lines = cv2.HoughLinesP(
        edges,
        1,
        math.pi / 180,
        max(8, min(w, h) // 4),
        minLineLength=max(6, min(w, h) // 3),
        maxLineGap=3,
    )
    vertical, horizontal = [], []
    for x0, y0, x1, y1 in [] if lines is None else lines[:, 0]:
        if abs(x1 - x0) < 0.05 * w and abs(y1 - y0) > 0.6 * h:
            x = (x0 + x1) / 2 / w
            if 0.15 < x < 0.85 and all(abs(x - v) > 0.09 for v in vertical):
                vertical.append(float(x))
        if abs(y1 - y0) < 0.05 * h and abs(x1 - x0) > 0.6 * w:
            y = (y0 + y1) / 2 / h
            if 0.15 < y < 0.85 and all(abs(y - v) > 0.09 for v in horizontal):
                horizontal.append(float(y))
    vertical, horizontal = sorted(vertical)[:5], sorted(horizontal)[:5]
    shape = (
        "panoramic" if width / height >= 1.9 else "tall" if height / width >= 1.7 else "standard"
    )
    return {
        "shape": shape,
        "vertical_bars": vertical,
        "horizontal_bars": horizontal,
        "style": "divided_panes" if vertical or horizontal else "undivided_or_unresolved",
        "grade": "image_inferred_not_exact_manufacturer_type",
    }


def entry_recess(door: dict, controls: dict, storey: dict) -> dict:
    """A category is appearance; a flight requires observed/controlled rise and depth."""
    if door.get("kind") == "garage_candidate":
        return {"render_steps": False, "reason": "vehicle_opening_is_not_a_pedestrian_stairwell"}
    evidence = controls.get("recess") or {}
    hidden = evidence.get("door_visible") is False
    if evidence.get("door_id") != door["id"]:
        evidence = {}
    category = evidence.get("category", "unknown")
    if category not in {"short", "long", "overhang", "unknown"}:
        raise ValueError("invalid entrance recess category")
    result = {
        "category": category,
        "door_id": door["id"],
        "grade": "inferred_visual",
        "render_steps": False,
        "reason": "depth_and_threshold_not_supported",
    }
    # A door or category alone is not staircase evidence. Model scores are not
    # probabilities; an image-bound visible-stair review is required separately.
    stairs = evidence.get("stairs") or {}
    if not stairs.get("visible") or not stairs.get("image_sha256") or not stairs.get("reviewer"):
        return {**result, "reason": "visible_stair_evidence_missing"}
    if controls.get("image_sha256") and stairs["image_sha256"] != controls["image_sha256"]:
        return {**result, "reason": "stairs_from_different_image"}
    if hidden and category != "long":
        return {**result, "reason": "hidden_door_requires_visible_ascending_long_flight"}
    depth, rise = evidence.get("depth_m"), evidence.get("rise_m")
    second = storey.get("storey_height_m")
    if hidden and rise is None and storey.get("status") == "prior_constrained" and second:
        rise = second
        result["threshold_basis"] = "inferred_second_storey_bottom_from_visible_stairs"
    else:
        result["threshold_basis"] = "observed_door_threshold_on_prior_geometry"
    if category == "unknown" or not all(
        isinstance(v, (float, int)) and math.isfinite(v) for v in (depth, rise)
    ):
        return result
    if not 0 < depth <= 8 or not 0 <= rise <= 4.5:
        return {**result, "reason": "invalid_recess_dimensions"}
    # Four tread depths of landing, and all geometry inward from the wall.
    observed_count = stairs.get("count")
    if hidden and not stairs.get("count_complete"):
        observed_count = None  # An ascending fragment is not a complete storey-height flight.
    steps = (
        observed_count
        if isinstance(observed_count, int) and 1 <= observed_count <= 30
        else math.ceil(rise / 0.18)
        if rise >= 0.08
        else 0
    )
    if steps and not 0.10 <= rise / steps <= 0.23:
        return {**result, "reason": "implausible_riser_height"}
    required = steps * 0.30 + 1.20
    second_floor = bool(category == "long" and second and abs(rise - second) <= 0.30)
    if required > depth or (category == "short" and steps > 6):
        return {**result, "reason": "flight_does_not_fit_or_category_conflict"}
    if not evidence.get("supported_by"):
        return {**result, "reason": "recess_evidence_missing"}
    return {
        **result,
        "render_steps": steps > 0,
        "steps": steps,
        "rise_m": rise,
        "step_rise_m": rise / max(1, steps),
        "depth_m": depth,
        "landing_depth_m": 1.20,
        "second_floor_supported": second_floor,
        "supported_by": evidence["supported_by"],
        "stairs_evidence": stairs,
        "door_visibility": "hidden_inferred" if hidden else "observed",
        "landing_alignment": "second_storey_bottom" if second_floor else "door_threshold",
        "reason": None,
    }


def reviewed_details(controls: dict, width: float, height: float, storey: dict) -> list[dict]:
    """Accept visible detail annotations, explicitly inferring unmeasured depth/elevation.

    A detector label alone never authorizes geometry or a material/style. Source
    pixels remain private; every control must bind to the same image as the fit.
    """
    accepted = []
    for detail in controls.get("reviewed_details", []):
        if (
            detail.get("image_sha256") != controls.get("image_sha256")
            or not detail.get("reviewer")
            or not detail.get("visible")
            or detail.get("kind") not in {"fire_escape", "balcony"}
            or detail.get("material") not in {"metal", "wood", "concrete", "stone"}
            or detail.get("style") not in {"vertical_bars", "lattice", "solid_panel"}
        ):
            continue
        values = [detail.get(k) for k in ("u", "v", "w", "h", "depth_m")]
        if not all(isinstance(v, (float, int)) and math.isfinite(v) for v in values):
            continue
        u, v, w, h, depth = values
        if not (0 <= u < u + w <= width and 0 <= v < v + h <= height - 0.15 and 0 < depth <= 2.5):
            continue
        story = storey.get("storey_height_m")
        if detail.get("height_basis") == "nearest_storey_bottom":
            if not story or storey.get("status") != "prior_constrained":
                continue
            platforms = [round(v / story) * story]
            if detail["kind"] == "fire_escape":
                platforms = [
                    i * story
                    for i in range(max(1, round(v / story)), math.floor((v + h) / story) + 1)
                ]
        else:
            platforms = detail.get("platform_heights_m", [])
        if not platforms or not all(
            isinstance(y, (float, int)) and math.isfinite(y) and 0 < y <= height - 1.2
            for y in platforms
        ):
            continue
        colour = detail.get("colour", "")
        if (
            len(colour) != 7
            or not colour.startswith("#")
            or any(c.lower() not in "0123456789abcdef" for c in colour[1:])
        ):
            continue
        platforms = sorted(set(platforms))
        accepted.append(
            {
                **detail,
                "platform_heights_m": platforms,
                "render": True,
                "certainty": "photo_visible_style; prior_inferred_depth_and_elevation",
                "collision": "canonical_only",
                "exact_style": False,
            }
        )
    return accepted


def extract_front(
    bgr: np.ndarray, labels: np.ndarray, width: float, height: float, controls: dict | None = None
) -> dict:
    controls = controls or {}
    if bgr.shape[:2] != labels.shape or width <= 0 or height <= 0:
        raise ValueError("photo and semantic mask must share positive facade dimensions")
    ppm_x, ppm_y = bgr.shape[1] / width, bgr.shape[0] / height
    observations = []
    # New upstream detector proposals are optional, image-bound by the caller.
    # They replace dark blobs, which routinely confuse fire escapes with windows.
    details = controls.get("detector_proposals")
    if details is not None:
        details = reason_proposals(
            bgr,
            details,
            width,
            height,
            image_sha256=controls.get("image_sha256"),
            reviews=controls.get("step_reviews"),
        )
    if details is not None:
        for item in details:
            kind = item.get("kind")
            if kind not in {"window", "door", "garage door"}:
                continue
            box = item.get("box", [])
            if len(box) != 4 or not all(
                isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in box
            ):
                continue
            x0, y0, x1, y1 = box
            if x1 <= x0 or y1 <= y0:
                continue
            observations.append(
                (
                    "window" if kind == "window" else "door",
                    x0 * width,
                    (1 - y1) * height,
                    (x1 - x0) * width,
                    (y1 - y0) * height,
                    float(item["score"]),
                )
            )
    # ADE20K class ids are pinned with the model manifest in the filter evidence.
    for label, kind in () if details is not None else ((8, "window"), (14, "door")):
        binary = (labels == label).astype(np.uint8)
        count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        for x, y, w, h, area in stats[1:count]:
            if w / ppm_x < 0.22 or h / ppm_y < 0.35 or area / (w * h) < 0.35:
                continue
            observations.append(
                (
                    kind,
                    x / ppm_x,
                    (bgr.shape[0] - y - h) / ppm_y,
                    w / ppm_x,
                    h / ppm_y,
                    min(0.85, area / (w * h)),
                )
            )
    # Dark-opening detector is an independent appearance proposal, not ground truth.
    for o in (
        []
        if details is not None
        else dark_openings(bgr, np.ones(labels.shape, bool), min(ppm_x, ppm_y))
    ):
        if not observations or o.kind == "window":
            observations.append((o.kind, o.u, o.v, o.w, o.h, min(0.65, o.confidence)))
    found = []
    for kind, u, v, w, h, confidence in sorted(observations, key=lambda x: x[5], reverse=True):
        if u < 0.08 or u + w > width - 0.08 or v < 0 or v + h > height - 0.15:
            continue
        if kind == "window" and (w > 6 or h > 4 or v < 0.35):
            continue
        if kind != "window" and (v > 1.7 or h < 1.5 or h > 4):
            continue
        if any(
            abs(u + w / 2 - o["u"] - o["w"] / 2) < min(w, o["w"]) * 0.7
            and abs(v + h / 2 - o["v"] - o["h"] / 2) < min(h, o["h"]) * 0.7
            for o in found
        ):
            continue
        x0, x1 = round(u * ppm_x), round((u + w) * ppm_x)
        y0, y1 = round((height - v - h) * ppm_y), round((height - v) * ppm_y)
        design = opening_design(bgr[y0:y1, x0:x1], w, h)
        found.append(
            {
                "id": f"opening-{len(found)}",
                "kind": kind,
                "u": round(u, 3),
                "v": round(v, 3),
                "w": round(w, 3),
                "h": round(h, 3),
                "confidence": float(confidence),
                "design": design,
                "grade": "image_on_prior_geometry",
                "position_sigma_m": max(0.50, 1 / min(ppm_x, ppm_y)),
            }
        )
    rows = []
    for o in sorted((o for o in found if o["kind"] == "window"), key=lambda o: o["v"]):
        centre = o["v"] + o["h"] / 2
        if not rows or abs(centre - rows[-1]) > 0.8:
            rows.append(centre)
    storey = storey_constraint(height, controls.get("levels"), rows)
    decorative = []
    for item in details or []:
        if item.get("kind") not in {"fire escape", "balcony", "stairs", "canopy"}:
            continue
        box = item.get("box", [])
        if len(box) != 4 or not all(
            isinstance(v, (float, int)) and math.isfinite(v) and 0 <= v <= 1 for v in box
        ):
            continue
        x0, y0, x1, y1 = box
        if x1 <= x0 or y1 <= y0:
            continue
        decorative.append(
            {
                "kind": "opening_review_candidate"
                if item["kind"] == "stairs"
                and item.get("opening_reasoning", {}).get("class") != "stair_recess_candidate"
                else item["kind"],
                "source_kind": item["kind"],
                "opening_reasoning": item.get("opening_reasoning"),
                "box": box,
                "score": item["score"],
                "u": x0 * width,
                "v": (1 - y1) * height,
                "w": (x1 - x0) * width,
                "h": (y1 - y0) * height,
                "material": "unknown",
                "style": "unknown",
                "depth_m": None,
                "certainty": "unreviewed_visible_object_proposal",
                "render": False,
            }
        )
    architecture = np.isin(labels, [1, 25, 0])
    # Only confidently labelled wall pixels, not windows, doors, plants, sky, poles.
    pixels = bgr[architecture]
    appearance = {
        "colour": None,
        "grade": "image_colour_not_albedo",
        "material": controls.get("material", "unknown"),
    }
    if len(pixels) >= 100:
        luma = pixels.mean(axis=1)
        pixels = pixels[(luma > 40) & (luma < 235)]
        if len(pixels) >= 100:
            rgb = np.median(pixels[:, ::-1], axis=0).astype(int)
            appearance["colour"] = "#" + "".join(f"{v:02x}" for v in rgb)
    for door in (o for o in found if o["kind"] == "door"):
        x0, x1 = round(door["u"] * ppm_x), round((door["u"] + door["w"]) * ppm_x)
        y0, y1 = (
            round((height - door["v"] - door["h"]) * ppm_y),
            round((height - door["v"]) * ppm_y),
        )
        source = next(
            (
                p["kind"]
                for p in details or []
                if p["kind"] in {"door", "garage door"}
                and abs(p["box"][0] * width - door["u"]) < 0.02
                and abs((p["box"][2] - p["box"][0]) * width - door["w"]) < 0.02
            ),
            "door",
        )
        recess_control = controls.get("recess") or {}
        review = (
            recess_control.get("stairs") if recess_control.get("door_id") == door["id"] else None
        )
        decision = reason_opening(
            bgr[y0:y1, x0:x1],
            door["w"],
            door["h"],
            source,
            image_sha256=controls.get("image_sha256"),
            step_review=review,
        )
        door["opening_reasoning"] = decision
        if decision["class"] == "garage_candidate":
            door["kind"] = "garage_candidate"
            door["type_requires_review"] = True
            door["recess"] = {
                "render_steps": False,
                "reason": "vehicle_opening_candidate_requires_separate_entry_evidence",
            }
        else:
            door["recess"] = entry_recess(door, controls, storey)
    hidden_entry = controls.get("hidden_entrance")
    if (
        hidden_entry
        and hidden_entry.get("door_visible") is False
        and storey["status"] == "prior_constrained"
    ):
        u, w = hidden_entry.get("u"), hidden_entry.get("w")
        if (
            all(isinstance(n, (int, float)) and math.isfinite(n) for n in (u, w))
            and 0.08 <= u < u + w <= width - 0.08
        ):
            door = {
                "id": hidden_entry.get("door_id", "hidden-entry"),
                "kind": "door",
                "u": u,
                "v": storey["storey_height_m"],
                "w": w,
                "h": 2.1,
                "grade": "hidden_door_inferred_from_reviewed_ascending_stairs",
                "certainty": "inferred_not_observed",
                "position_sigma_m": 0.5,
            }
            recess = entry_recess(door, {**controls, "recess": hidden_entry}, storey)
            if recess["render_steps"] and door["v"] + door["h"] <= height - 0.15:
                door["recess"] = recess
                found.append(door)
    # Curb controls must declare matching units/datum. Never compare two unrelated z values.
    ground = controls.get("ground_reference")
    checks = []
    if ground:
        if ground.get("frame") != "relative_to_facade_foot" or not ground.get("source"):
            checks.append("ground_datum_or_provenance_missing")
        else:
            threshold = ground.get("threshold_m")
            if threshold is not None:
                for o in found:
                    if o["kind"] == "door" and abs(o["v"] - threshold) > ground.get(
                        "tolerance_m", 0.5
                    ):
                        checks.append(f"threshold_conflict:{o['id']}")
    if storey["status"] == "conflict":
        checks.append(storey["reason"])
    return {
        "schema": "kerbside.facade_fit/1",
        "width_m": width,
        "height_m": height,
        "openings": sorted(found, key=lambda o: (o["v"], o["u"])),
        "appearance": appearance,
        "storey_constraint": storey,
        "ground_reference": ground,
        "details": decorative + reviewed_details(controls, width, height, storey),
        "certainty": {
            "front": "unreviewed_image_on_prior",
            "height": "canonical_prior",
            "depth": "unknown",
            "appearance": "image_inferred",
            "unseen_sides": "procedural_inferred",
        },
        "conflicts": checks,
        "geometry_grade": "visual_on_canonical_prior",
        "canonical_geometry_modified": False,
        "unseen_sides": "inferred",
        "inch_accuracy_verified": False,
        "opening_logic_schema": "kerbside.opening_reasoning/1",
        "opening_decisions": [
            p["opening_reasoning"] for p in details or [] if p.get("opening_reasoning")
        ],
    }
