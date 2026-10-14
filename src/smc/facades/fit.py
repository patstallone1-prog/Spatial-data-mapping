"""Constrained photo-front visual specifications, never replacements for canonical facts.

Image boxes have metric coordinates only through their explicit facade/camera prior.
Independent ground/curb controls may tighten uncertainty, but absent controls cannot
be invented. Depth, hidden stairs and wall material remain inferred unless corroborated.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from smc.facades.appearance_bands import appearance_bands, colour_sample, window_trim
from smc.facades.architecture_logic import canonical_front_binding, door_access, repeated_forms
from smc.facades.coarse_openings import (
    assign_roles,
    complete_columns,
    default_panes,
    duplicate_neighbours,
    group_windows,
    mirror_floors,
    share_window_detail,
)
from smc.facades.edge_support import opening_sanity, refine_opening
from smc.facades.entry_inference import infer_entries, primary_entry
from smc.facades.house_extent import assigned_house, isolate
from smc.facades.opening_reasoning import reason_opening, reason_proposals
from smc.facades.outcrops import infer_candidates, reviewed_outcrops
from smc.facades.survey import openings as dark_openings
from smc.facades.window_shapes import arched_profile


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
            "visual_storey_height_m": round(height / levels, 1),
            "visual_rounding_sigma_m": 0.05,
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


#: Panes narrower than this are not panes: two lines this close are the two edges of one bar.
MIN_PANE_M = 0.22
#: A line counts as a bar when it runs this much of the way from one side of the window to the
#: other, parallel to the frame's other pair of sides.
BAR_SPAN = 0.6


def pane_lines(bgr: np.ndarray, width: float, height: float) -> tuple[list[float], list[float]]:
    """Lines running between the sides of a window -- mullions and muntins -- as fractions.

    A bar is a straight edge across the glass from one side of the frame to the other: in the
    columns (rows) of the window's gradient, a column where an edge is present in most rows. The
    two edges of one bar, and a line within a narrow pane of the frame, are one bar or none.
    """
    if not bgr.size or min(bgr.shape[:2]) < 12:
        return [], []
    grey = cv2.GaussianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), (3, 3), 0).astype(float)
    h, w = grey.shape
    found = []
    # The frame's own sides are not bars: nothing within 15% of a jamb or 8% of a head or sill.
    for axis, size, metres, edge in ((1, w, width, 0.15), (0, h, height, 0.08)):
        grad = np.abs(cv2.Sobel(grey, cv2.CV_64F, 1 if axis == 1 else 0, 0 if axis == 1 else 1, ksize=3))
        inner = grad[max(1, h // 10):h - max(1, h // 10), :] if axis == 1 else grad[:, max(1, w // 10):w - max(1, w // 10)]
        strong = inner > max(18.0, np.percentile(inner, 80))
        # Coverage of each column (axis 1) or row (axis 0), a pixel either side allowed.
        coverage = strong.mean(axis=0 if axis == 1 else 1)
        coverage = np.maximum.reduce([coverage, np.roll(coverage, 1), np.roll(coverage, -1)])
        min_gap = max(2, int(MIN_PANE_M / metres * size))
        frame = max(min_gap, int(edge * size) + 1)
        bars: list[float] = []
        for i in np.argsort(-coverage):
            if coverage[i] < BAR_SPAN:
                break
            t = i / size
            if not frame <= i <= size - frame or any(abs(i - b * size) < min_gap for b in bars):
                continue
            bars.append(t)
        found.append(sorted(float(round(b, 3)) for b in bars)[:5])
    return found[0], found[1]


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
    # Transoms close to a lintel are often too short/thin for Hough's 60%-span
    # rule. Neutral frame-colour ridges are complementary cues, not pane colour:
    # yellow blinds and nearly uniform bright reflections cannot supply them.
    neutral = (bgr.min(axis=2) >= 165) & ((bgr.max(axis=2).astype(int) - bgr.min(axis=2)) < 40)
    if min(h, w) >= 20 and neutral.mean() < 0.70:
        for axis, bars in ((0, horizontal), (1, vertical)):
            mask = neutral[:, max(1, w // 10):w - max(1, w // 10)] if axis == 0 else neutral[max(1, h // 10):h - max(1, h // 10), :]
            coverage = mask.mean(axis=1 if axis == 0 else 0)
            indices = np.flatnonzero(coverage >= 0.70)
            for cluster in np.split(indices, np.flatnonzero(np.diff(indices) > 1) + 1):
                if not len(cluster):
                    continue
                size = h if axis == 0 else w
                t = float(np.median(cluster) / size)
                margin = 0.08 if axis == 0 else 0.15
                if margin < t < 1 - margin and len(cluster) / size < 0.12 and all(abs(t - old) > 0.07 for old in bars):
                    bars.append(t)
        vertical, horizontal = sorted(vertical)[:5], sorted(horizontal)[:5]
    # And any line running between the window's sides the frame finds, parallel or perpendicular
    # to them, a pane's width or more from the others.
    lines_v, lines_h = pane_lines(bgr, width, height)
    for bars, extra, size in ((vertical, lines_v, width), (horizontal, lines_h, height)):
        for t in extra:
            if all(abs(t - b) * size >= MIN_PANE_M for b in bars):
                bars.append(t)
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
    evidence = next(
        (r for r in controls.get("recesses", []) if r.get("door_id") == door["id"]),
        controls.get("recess") or {},
    )
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
    second = storey.get("visual_storey_height_m", storey.get("storey_height_m"))
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


#: A French window's height, and the deck under a balcony's rail.
FRENCH_WINDOW_M = 2.2
RAIL_ABOVE_DECK_M = 1.05


def windows_behind_balconies(found: list[dict], details: list[dict], width: float, height: float) -> list[dict]:
    """The French windows a photograph's balconies (and fire escapes) are reached through.

    A balcony up the front is stepped onto from a window or a door behind it -- there is no other
    way onto it -- but its railing stands across the glass, and the detector sees the railing and
    not the window. Where it found a balcony and no window behind it, a window is inferred there:
    in the columns the other floors' windows stand in, or evenly across a wide balcony; its sill
    on the balcony's deck (a rail's height under the rail's top), as tall as a French window or
    as the floor allows. Marked inferred (``size_inferred``), never measured.
    """
    windows = [o for o in found if o.get("kind") == "window"]
    balconies = []
    for item in details:
        # A fire escape's landings are stepped onto from windows too.
        if item.get("kind") not in {"balcony", "fire escape"}:
            continue
        box = item.get("box", [])
        if len(box) != 4:
            continue
        x0, y0, x1, y1 = box
        # One landing, not a whole escape up the front: a box a storey tall or more is the stair.
        if item["kind"] == "fire escape" and (y1 - y0) * height > 2.0:
            continue
        u, w = x0 * width, (x1 - x0) * width
        rail_top = (1 - y0) * height
        deck = max((1 - y1) * height, rail_top - RAIL_ABOVE_DECK_M)
        if deck < 1.8 or w < 0.6:
            continue           # the ground floor's railings are fences and stoops, not balconies
        balconies.append({"u": u, "w": w, "deck": deck, "score": float(item.get("score", 0.3))})
    out = []
    for b in sorted(balconies, key=lambda b: -b["w"]):
        above = [o["deck"] for o in balconies if o["deck"] > b["deck"] + 1.5]
        ceiling = min([*above, height - 0.4]) - 0.3
        top = min(b["deck"] + FRENCH_WINDOW_M, ceiling)
        if top - b["deck"] < 1.2:
            continue
        columns = sorted({(round(o["u"], 2), round(o["w"], 2)) for o in windows
                          if b["u"] - 0.2 <= o["u"] + o["w"] / 2 <= b["u"] + b["w"] + 0.2})
        if not columns:
            n = max(1, round(b["w"] / 2.6))
            each = min(1.5, 0.8 * b["w"] / n)
            columns = [(b["u"] + b["w"] * (k + 0.5) / n - each / 2, each) for k in range(n)]
        for u, w in columns:
            centre = u + w / 2
            if any(abs(centre - (o["u"] + o["w"] / 2)) < max(w, o["w"]) * 0.6
                   and min(top, o["v"] + o["h"]) - max(b["deck"], o["v"]) > 0.3 * (top - b["deck"])
                   for o in [*found, *out] if o.get("kind") == "window"):
                continue
            if u < 0.05 or u + w > width - 0.05:
                continue
            out.append({
                "id": f"opening-balcony-{len(found) + len(out)}", "kind": "window",
                "u": round(u, 3), "v": round(b["deck"], 3), "w": round(w, 3), "h": round(top - b["deck"], 3),
                "confidence": round(min(0.5, b["score"]), 3),
                "design": {"shape": "tall", "vertical_bars": [0.5], "horizontal_bars": [],
                           "style": "french_window_behind_balcony",
                           "grade": "inferred_from_the_balcony_in_front_of_it"},
                "grade": "inferred_behind_balcony", "size_inferred": "french_window_behind_balcony",
                "position_sigma_m": 0.5, "size_anomaly_requires_review": False, "type_requires_review": False,
            })
    return out


def extract_front(
    bgr: np.ndarray, labels: np.ndarray, width: float, height: float, controls: dict | None = None
) -> dict:
    controls = controls or {}
    if bgr.shape[:2] != labels.shape or width <= 0 or height <= 0:
        raise ValueError("photo and semantic mask must share positive facade dimensions")
    # First, which house in the frame is this one (house_extent): the next house's door, gate,
    # stair and windows are put aside before anything is read.
    house = assigned_house(bgr, labels, width, controls.get("detector_proposals"))
    bgr, labels, proposals, house = isolate(bgr, labels, width, controls.get("detector_proposals"), house)
    if proposals is not None:
        controls = {**controls, "detector_proposals": proposals}
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
            if kind not in {"window", "door", "garage door", "gated_entry_candidate"}:
                continue
            box = item.get("box", [])
            if len(box) != 4 or not all(
                isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in box
            ):
                continue
            x0, y0, x1, y1 = box
            if x1 <= x0 or y1 <= y0:
                continue
            # A gate stands at the pavement: one the detector finds two metres up the front is a
            # balcony's railing (the same rule the segmentation's gates are held to, below).
            if kind == "gated_entry_candidate" and (1 - y1) * height > 0.6:
                continue
            edge = refine_opening(bgr, box)
            item["edge_support"] = edge
            item["source_box"] = box
            item["box"] = edge["box"]
            x0, y0, x1, y1 = edge["box"]
            observations.append(
                (
                    kind if kind in {"window", "gated_entry_candidate"} else "door",
                    x0 * width,
                    (1 - y1) * height,
                    (x1 - x0) * width,
                    (y1 - y0) * height,
                    float(item["score"]),
                )
            )
    # ADE20K class ids are pinned with the model manifest in the filter evidence.
    semantic_sources = ((8, "window"), (14, "door"), (32, "gated_entry_candidate"))
    for label, kind in semantic_sources:
        if details is not None and kind != "gated_entry_candidate":
            continue
        binary = (labels == label).astype(np.uint8)
        count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        for x, y, w, h, area in stats[1:count]:
            if w / ppm_x < 0.22 or h / ppm_y < 0.35 or area / (w * h) < 0.35:
                continue
            if kind == "gated_entry_candidate" and not (
                0.5 <= w / ppm_x <= 2.5
                and h / ppm_y >= 1.5
                and (bgr.shape[0] - y - h) / ppm_y <= 0.6
            ):
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
        if o.kind == "window":
            px0 = max(0, round(o.u * ppm_x))
            px1 = min(labels.shape[1], round((o.u + o.w) * ppm_x))
            py0 = max(0, round((height - o.v - o.h) * ppm_y))
            py1 = min(labels.shape[0], round((height - o.v) * ppm_y))
            region = labels[py0:py1, px0:px1]
            if not region.size or (region == 8).mean() < 0.15:
                box = [
                    o.u / width,
                    (height - o.v - o.h) / height,
                    (o.u + o.w) / width,
                    (height - o.v) / height,
                ]
                support = refine_opening(bgr, box)
                if support["supported_sides"] < 4 or o.v < 1.7:
                    continue  # No semantic identity and no supported upper perimeter.
        if not observations or o.kind == "window":
            observations.append((o.kind, o.u, o.v, o.w, o.h, min(0.65, o.confidence)))
    found = []
    for kind, u, v, w, h, confidence in sorted(observations, key=lambda x: x[5], reverse=True):
        margin = 0.08 if kind == "window" else 0
        if u < margin or u + w > width - margin or v < 0 or v + h > height - 0.15:
            continue
        if kind == "window" and v < 0.35:
            continue
        # A door's height is read off a photograph that often clips its foot: 1.2 m of door is
        # still a door (coarse first; the entry pass decides what it is).
        if kind != "window" and (h < 1.2 or h > 4):
            continue
        # Nearly the whole width of the front at the ground is its plinth or its shopfront, not a
        # door or a garage (the HABS validation found foundation bands read as full-width garages).
        if kind != "window" and w > 0.85 * width and not controls.get("ground_floor_business"):
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
        if kind == "window":
            patch = bgr[y0:y1, x0:x1]
            curve = arched_profile(patch)
            if curve:
                design.update(curve)
            pad = max(1, min(patch.shape[:2]) // 10)
            if min(patch.shape[:2]) > 2 * pad:
                rgb = np.median(patch[pad:-pad, pad:-pad, ::-1].reshape(-1, 3), axis=0).astype(int)
                design["observed_glass_or_contents_colour"] = "#" + "".join(f"{v:02x}" for v in rgb)
                design["glass_rendering"] = "clear_neutral_no_photographed_contents"
        if kind != "window":
            design["colour"] = colour_sample(
                bgr[y0:y1, x0:x1], np.isin(labels[y0:y1, x0:x1], [0, 1, 14, 25, 32])
            )
            design["colour_basis"] = "observed_image_colour_not_albedo"
            cues = reason_opening(bgr[y0:y1, x0:x1], w, h, "door")["pixel_cues"]
            design["panel_style"] = (
                "sectional_grid"
                if cues["panel_grid"]
                else "horizontal_sections"
                if len(cues["horizontal"]) >= 3
                else "unresolved"
            )
            design["panel_lines"] = cues
            # An arched head: an entry's arch (a garage door is a rectangle of panels).
            arch = arched_profile(bgr[y0:y1, x0:x1])
            if arch:
                design["head"] = "arched"
                design["head_basis"] = arch["shape_basis"]
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
                "size_anomaly_requires_review": bool(w > 6 or h > 4),
                "type_requires_review": kind == "gated_entry_candidate",
                "image_edge_support": next(
                    (
                        p.get("edge_support")
                        for p in details or []
                        if abs(p["box"][0] * width - u) < 0.02
                        and abs((p["box"][2] - p["box"][0]) * width - w) < 0.02
                    ),
                    None,
                ),
            }
        )
    found += windows_behind_balconies(found, details or [], width, height)
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
    for opening in found:
        x0 = round(opening["u"] * ppm_x)
        x1 = round((opening["u"] + opening["w"]) * ppm_x)
        y0 = round((height - opening["v"] - opening["h"]) * ppm_y)
        y1 = round((height - opening["v"]) * ppm_y)
        architecture[
            max(0, y0) : min(labels.shape[0], y1), max(0, x0) : min(labels.shape[1], x1)
        ] = False
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
        recess_control = next(
            (r for r in controls.get("recesses", []) if r.get("door_id") == door["id"]),
            controls.get("recess") or {},
        )
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
                "v": storey["visual_storey_height_m"],
                "w": w,
                "h": 2.1,
                "grade": "hidden_door_inferred_from_reviewed_ascending_stairs",
                "certainty": "inferred_not_observed",
                "position_sigma_m": 0.5,
                "design": {
                    "shape": "inferred_hidden_door",
                    "vertical_bars": [],
                    "horizontal_bars": [],
                },
            }
            recess = entry_recess(door, {**controls, "recess": hidden_entry}, storey)
            if recess["render_steps"] and door["v"] + door["h"] <= height - 0.15:
                door["recess"] = recess
                found.append(door)
    # How each pedestrian door is reached -- gate, long or short stair, alcove or flush -- read
    # from the photograph and its segmentation (entry_inference). A stair seen under a door's
    # threshold is the evidence a reviewer used to be asked to certify; it is measured here, and
    # still has to pass the same access check below.
    gates_seen = [{"u": o["u"], "v": o["v"], "w": o["w"], "h": o["h"]} for o in found
                  if o["kind"] == "gated_entry_candidate"]
    # A door the detector called a garage door, a car's width, is not the way in on foot.
    walkable = [o for o in found if not ((o.get("opening_reasoning") or {}).get("original_label")
                                         == "garage door" and o["w"] >= 1.7)]
    entries = infer_entries(
        bgr, labels, width, height, walkable,
        storey_height_m=storey.get("visual_storey_height_m") or storey.get("storey_height_m"),
        gate_proposals=gates_seen, image_sha256=controls.get("image_sha256"),
    )
    for entry in entries["entries"]:
        door = next((o for o in found if o["id"] == entry["door_id"]), None)
        if door is None and entry.get("hidden_door"):
            door = {
                "id": entry["door_id"], "kind": "door", "u": entry["u"], "v": entry["threshold_m"],
                "w": entry["w"], "h": 2.1, "grade": "hidden_door_inferred_from_visible_flight",
                "certainty": "inferred_not_observed", "position_sigma_m": 0.5,
                "design": {"shape": "inferred_hidden_door", "vertical_bars": [], "horizontal_bars": []},
            }
            if door["v"] + door["h"] > height - 0.15:
                continue
            found.append(door)
        if door is None:
            continue
        door["entry"] = entry
        if entry.get("recess") and not (door.get("recess") or {}).get("render_steps"):
            door["recess"] = entry["recess"]
    for gate in (o for o in found if o["kind"] == "gated_entry_candidate"):
        # The gate is part of the entry it stands in front of, not an opening of its own.
        gate["type_requires_review"] = False
        gate["absorbed_into_entry"] = next(
            (e["door_id"] for e in entries["entries"] if e.get("gate")
             and gate["u"] < e["gate"]["u"] + e["gate"]["w"] and gate["u"] + gate["w"] > e["gate"]["u"]),
            None,
        )
    # Coarse to fine: every rectangle is a window, a garage or an entrance from its shape and
    # height, and a detected bay holds a window on each storey (coarse_openings).
    assign_roles(found, entries, width, height, storey)
    found.extend(group_windows(found, details, width, height, storey))
    # And a window the front's own column grid puts where the photograph saw none -- not where it
    # plainly saw bare wall (ADE20K wall, building, house).
    bare = np.isin(labels, [0, 1, 25])

    def blank_wall(box: dict) -> float:
        x0, x1 = max(0, round(box["u"] * ppm_x)), min(labels.shape[1], round((box["u"] + box["w"]) * ppm_x))
        y0 = max(0, round((height - box["v"] - box["h"]) * ppm_y))
        y1 = min(labels.shape[0], round((height - box["v"]) * ppm_y))
        region = bare[y0:y1, x0:x1]
        return float(region.mean()) if region.size else 0.0

    columns = complete_columns(found, width, height, blank_wall)
    found.extend(columns)
    # Curb controls must declare matching units/datum. Never compare two unrelated z values.
    ground = controls.get("ground_reference")
    for opening in found:
        if opening["kind"] in {"door", "gated_entry_candidate", "garage_candidate"}:
            opening["access_check"] = door_access(opening, ground, controls.get("image_sha256"))
            opening["render_allowed"] = opening["access_check"]["render_allowed"]
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
    appearance.update(
        appearance_bands(bgr, labels, height, storey, found, {**controls, "facade_width_m": width})
    )
    sanity = opening_sanity(found)
    for opening in found:
        if opening["kind"] == "window":
            trim = window_trim(bgr, opening, width, height, appearance["bands"])
            if trim:
                opening["design"]["trim"] = trim
    # Fine detail last. A plain window on a floor of matching ones is one of them; one of the same
    # shape as a well-read one takes its panes and trim; of two stacked or side by side (a bay on
    # two storeys, a wrap-around window), the surer is drawn in both places; and a window with
    # nothing read or to copy is divided at the default pane width.
    mirrored = mirror_floors(found)
    shared = share_window_detail(found)
    duplicated = duplicate_neighbours(found)
    defaulted = default_panes(found)
    for opening in found:
        if opening.get("size_from"):
            opening["u"] = round(min(max(opening["u"], 0.08), width - 0.08 - opening["w"]), 3)
            opening["v"] = round(min(max(opening["v"], 0.35), height - 0.15 - opening["h"]), 3)
    fit = {
        "house_extent": house,
        "front_geometry_binding": canonical_front_binding(controls.get("canonical_front_geometry"), width),
        "sanity_checks": sanity,
        "schema": "kerbside.facade_fit/1",
        "width_m": width,
        "height_m": height,
        "openings": sorted(found, key=lambda o: (o["v"], o["u"])),
        "appearance": appearance,
        "storey_constraint": storey,
        "ground_reference": ground,
        "details": decorative + reviewed_details(controls, width, height, storey),
        "outcrops": reviewed_outcrops(controls, width, height),
        "outcrop_candidates": infer_candidates(found, controls.get("image_sha256")),
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
        "entries": entries,
        "primary_entry": primary_entry(entries),
        "coarse_openings": {
            "schema": "kerbside.coarse_openings/1",
            "roles": {r: sum(1 for o in found if o.get("role") == r)
                      for r in sorted({o.get("role", "none") for o in found})},
            "windows_from_groups": sum(1 for o in found if o.get("size_inferred")) - len(columns),
            "windows_from_column_symmetry": len(columns),
            "windows_given_detail": shared,
            "windows_mirrored_from_their_floor": mirrored,
            "windows_duplicated_from_a_neighbour": duplicated,
            "windows_given_default_panes": defaulted,
        },
        "opening_decisions": [
            p["opening_reasoning"] for p in details or [] if p.get("opening_reasoning")
        ],
    }
    fit["architectural_logic"] = {"repeated_forms": repeated_forms(fit)}
    return fit
