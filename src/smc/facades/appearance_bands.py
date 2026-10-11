"""Independent facade-height appearance bands and conservative white-window trim.

Colour is observed image colour, not calibrated albedo. Unknown floor materials
remain unknown; an existing whole-building label is not repeated as floor truth.
"""

from __future__ import annotations

import math
import re
from itertools import pairwise

import cv2
import numpy as np

SCHEMA = "kerbside.facade_appearance_bands/1"
MATERIALS = {
    "unknown",
    "stucco_render",
    "concrete",
    "brick",
    "painted_brick",
    "stone",
    "wood_siding",
    "vinyl_siding",
    "metal_panel",
    "glass",
    "ceramic_tile",
}

# A visual consistency default, not a measured paint/material classification.
# Ordinary image exposure differences must not give every storey its own paint.
DISTINCT_COLOUR_DELTA_E = 25.0
#: How much of a lightness difference counts. Shade, a porch roof or the sun on the upper floors
#: changes how light a wall looks far more than its hue or how saturated it is: a cream house's
#: ground floor in shadow is a darker cream, not a different paint.
LIGHTNESS_WEIGHT = 0.35
#: Below this chroma both colours are greys, where lightness is all that tells white from charcoal.
NEUTRAL_CHROMA = 12.0


def lighting_tolerant_difference(a, b) -> float:
    """Lab difference with lightness discounted, except between near-neutral colours.

    Two samples of one paint under different light differ mostly in L*; two paints differ in hue
    and chroma. Between greys there is no hue to go by, so a large lightness gap (white against
    charcoal) still counts for most of its size.
    """
    dl = float(a[0] - b[0])
    hue_chroma = float(np.hypot(a[1] - b[1], a[2] - b[2]))
    if max(float(np.hypot(a[1], a[2])), float(np.hypot(b[1], b[2]))) < NEUTRAL_CHROMA:
        return max(hue_chroma, 0.6 * abs(dl))
    return float(np.hypot(hue_chroma, LIGHTNESS_WEIGHT * dl))


def consistent_house_colours(
    bands: list[dict], *, ground_floor_business: bool = False
) -> list[dict]:
    """Keep observations, but share the dominant colour absent strong contrary evidence.

    Unknown materials do not establish a material change. A mapped business's
    bottom band, independently different materials, and clearly different colours
    remain independent. Compare to one dominant anchor, not successive neighbours:
    otherwise a gradual chain could incorrectly merge very different end colours.
    """
    result = [{**band, "observed_colour": band.get("colour")} for band in bands]

    def lab(colour):
        if not isinstance(colour, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", colour):
            return None
        rgb = np.array([[[int(colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]]], np.float32)
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[0, 0]

    def business(band):
        return ground_floor_business and band["bottom_m"] == 0

    candidates = [band for band in result if not business(band) and lab(band["colour"]) is not None]
    if not candidates:
        return result
    anchor = max(
        candidates,
        key=lambda b: (b["top_m"] - b["bottom_m"]) * max(0, b.get("wall_pixel_fraction", 1)),
    )
    anchor_lab = lab(anchor["colour"])
    for band in result:
        material, anchor_material = (
            band.get("material", "unknown"),
            anchor.get("material", "unknown"),
        )
        known_difference = material != anchor_material and "unknown" not in {
            material,
            anchor_material,
        }
        sample = lab(band["colour"])
        if business(band):
            reason = "business_ground_floor"
        elif known_difference:
            reason = "different_observed_material"
        elif sample is not None and lighting_tolerant_difference(sample, anchor_lab) > DISTINCT_COLOUR_DELTA_E:
            reason = "clearly_different_colour"
        else:
            band["colour"] = anchor["colour"]
            reason = "shared_house_colour; visual_default_not_albedo_measurement"
        band["colour_policy_reason"] = reason
    return result


def appearance_result(bands: list[dict], controls: dict, boundaries_basis: str) -> dict:
    return {
        "schema": SCHEMA,
        "bands": consistent_house_colours(
            bands, ground_floor_business=controls.get("ground_floor_business") is True
        ),
        "boundaries_basis": boundaries_basis,
        "colour_policy": "dominant_house_colour_unless_business_material_or_strong_colour_difference/2",
        "colour_difference": "lab_lightness_discounted_except_neutrals",
        "distinct_colour_delta_e76": DISTINCT_COLOUR_DELTA_E,
    }


def colour_sample(image: np.ndarray, mask: np.ndarray) -> str | None:
    pixels = image[mask]
    if len(pixels) < 100:
        return None
    luma = pixels.mean(axis=1)
    pixels = pixels[(luma > 35) & (luma < 245)]
    if len(pixels) < 100:
        return None
    rgb = np.median(pixels[:, ::-1], axis=0).astype(int)
    return "#" + "".join(f"{v:02x}" for v in rgb)


def colour_transitions(image: np.ndarray, architecture: np.ndarray) -> list[tuple[int, int]]:
    """Conservative sustained wall-colour changes, not inferred storey counts.

    Require two substantial, internally consistent wall regions and an abrupt
    boundary. Gradual lighting gradients and sparsely visible walls abstain.
    These remain private review proposals: a shadow can still be a false band.
    """
    h, w = architecture.shape
    rows = np.full((h, 3), np.nan)
    for y in range(h):
        pixels = image[y, architecture[y]]
        if len(pixels) >= max(8, w * 0.20):
            rows[y] = np.median(pixels[:, ::-1], axis=0)
    good = np.isfinite(rows).all(axis=1)
    if good.mean() < 0.65:
        return []
    lab = np.full_like(rows, np.nan)
    lab[good] = cv2.cvtColor(rows[good].astype(np.uint8)[None], cv2.COLOR_RGB2LAB)[0]
    minimum = max(12, round(h * 0.18))

    def split(lo: int, hi: int, depth: int = 0) -> list[tuple[int, int]]:
        best, score = None, 0
        pad = max(2, round(h * 0.025))
        for cut in range(lo + minimum, hi - minimum + 1):
            a, b = lab[lo:cut], lab[cut:hi]
            a, b = a[np.isfinite(a).all(axis=1)], b[np.isfinite(b).all(axis=1)]
            if len(a) < (cut - lo) * 0.65 or len(b) < (hi - cut) * 0.65:
                continue
            ca, cb = np.median(a, axis=0), np.median(b, axis=0)
            delta = float(np.linalg.norm(ca - cb))
            if delta < 24:
                continue
            if (
                min(
                    (np.linalg.norm(a - ca, axis=1) < 18).mean(),
                    (np.linalg.norm(b - cb, axis=1) < 18).mean(),
                )
                < 0.80
            ):
                continue
            before, after = lab[cut - pad : cut], lab[cut : cut + pad]
            if not np.isfinite(before).all() or not np.isfinite(after).all():
                continue
            if np.linalg.norm(np.median(before, axis=0) - np.median(after, axis=0)) < 24:
                continue
            # Prefer the actual sharp edge, not an equally coloured partition a
            # few pixels beside it (a plateau of identical whole-region medians).
            edge = np.linalg.norm(lab[cut - 1] - lab[cut])
            if not math.isfinite(edge) or edge < 16:
                continue
            value = delta + edge * 0.5
            if value > score:
                best, score = cut, value
        if best is None or depth >= 2:
            return [(lo, hi)]
        return split(lo, best, depth + 1) + split(best, hi, depth + 1)

    intervals = split(0, h)
    return intervals if len(intervals) > 1 else []


def appearance_bands(
    image: np.ndarray,
    labels: np.ndarray,
    height_m: float,
    storey: dict,
    openings: list[dict],
    controls: dict,
) -> dict:
    if image.shape[:2] != labels.shape or not math.isfinite(height_m) or height_m <= 0:
        raise ValueError("registered image/mask and positive height required")
    explicit = controls.get("appearance_bands")
    if explicit is not None:
        bands = []
        for band in explicit:
            low, high = band.get("bottom_m"), band.get("top_m")
            if (
                not all(isinstance(v, (float, int)) and math.isfinite(v) for v in (low, high))
                or not 0 <= low < high <= height_m
                or not band.get("reviewer")
                or not isinstance(band.get("image_sha256"), str)
                or not band["image_sha256"]
                or band.get("image_sha256") != controls.get("image_sha256")
                or band.get("material", "unknown") not in MATERIALS
                or (
                    band.get("colour") is not None
                    and (
                        not isinstance(band["colour"], str)
                        or not re.fullmatch(r"#[0-9a-fA-F]{6}", band["colour"])
                    )
                )
            ):
                raise ValueError(
                    "appearance band needs image-bound reviewed bounds/material/colour"
                )
            bands.append(
                {
                    **band,
                    "front_basis": "reviewed_image_region",
                    "other_sides_basis": "inferred_same_height_band",
                }
            )
        bands.sort(key=lambda b: b["bottom_m"])
        if any(a["top_m"] > b["bottom_m"] + 1e-6 for a, b in pairwise(bands)):
            raise ValueError("overlapping appearance bands")
        return appearance_result(bands, controls, "reviewed_height_intervals")
    levels = storey.get("storeys") if storey.get("status") == "prior_constrained" else None
    h, w = image.shape[:2]
    architecture = np.isin(labels, [0, 1, 25])
    # Windows, doors and their trim must not pull the wall's colour toward white/black.
    facade_width = controls.get("facade_width_m")
    if openings and (not isinstance(facade_width, (int, float)) or facade_width <= 0):
        raise ValueError("positive registered facade width required for openings")
    for opening in openings:
        x0 = max(0, int(opening["u"] / facade_width * w) - 3)
        x1 = min(w, int((opening["u"] + opening["w"]) / facade_width * w) + 3)
        y0 = max(0, int((height_m - opening["v"] - opening["h"]) / height_m * h) - 3)
        y1 = min(h, int((height_m - opening["v"]) / height_m * h) + 3)
        architecture[y0:y1, x0:x1] = False
    intervals = (
        [(round(h * i / levels), round(h * (i + 1) / levels)) for i in range(levels)]
        if levels
        else colour_transitions(image, architecture)
    )
    bands = []
    for y0, y1 in reversed(intervals):
        low, high = height_m * (1 - y1 / h), height_m * (1 - y0 / h)
        # Stay away from cornices/awnings at either boundary.
        pad = max(1, (y1 - y0) // 12)
        mask = architecture[y0 + pad : y1 - pad]
        sample = colour_sample(image[y0 + pad : y1 - pad], mask)
        bands.append(
            {
                "bottom_m": low,
                "top_m": high,
                "colour": sample,
                "material": "unknown",
                "material_basis": "unknown; whole_building_classifier_not_floor_truth",
                "wall_pixel_fraction": float(mask.mean()) if mask.size else 0,
                "front_basis": "image_colour_on_storey_prior_not_albedo"
                if levels
                else "inferred_wall_colour_transition_not_measured_floor",
                "other_sides_basis": "inferred_same_height_band",
            }
        )
    return appearance_result(
        bands,
        controls,
        "canonical_height_and_levels_prior"
        if levels
        else "image_wall_colour_transition_on_height_prior; no invented storeys",
    )


def window_trim(
    image: np.ndarray, opening: dict, width_m: float, height_m: float, bands: list[dict]
) -> dict | None:
    h, w = image.shape[:2]
    x0, x1 = round(opening["u"] / width_m * w), round((opening["u"] + opening["w"]) / width_m * w)
    y0, y1 = (
        round((height_m - opening["v"] - opening["h"]) / height_m * h),
        round((height_m - opening["v"]) / height_m * h),
    )
    patch = image[max(0, y0) : min(h, y1), max(0, x0) : min(w, x1)]
    if not patch.size or min(patch.shape[:2]) < 12:
        return None
    ph, pw = patch.shape[:2]
    thickness = max(1, round(min(ph, pw) * 0.12))
    white = (patch.min(axis=2) > 160) & (patch.max(axis=2) - patch.min(axis=2) < 30)
    strips = [white[:thickness], white[-thickness:], white[:, :thickness], white[:, -thickness:]]
    if (
        sum(s.mean() > 0.25 for s in strips) < 2
        or white[thickness:-thickness, thickness:-thickness].mean() > 0.70
    ):
        return None
    ring = np.ones((ph, pw), bool)
    ring[thickness:-thickness, thickness:-thickness] = False
    pixels = patch[ring & white]
    if len(pixels) < 20:
        return None
    rgb = np.median(pixels[:, ::-1], axis=0).astype(int)
    colour = "#" + "".join(f"{v:02x}" for v in rgb)
    wall = next(
        (
            b.get("colour")
            for b in bands
            if b["bottom_m"] <= opening["v"] + opening["h"] / 2 < b["top_m"]
        ),
        None,
    )
    if wall:
        wall_rgb = np.array([int(wall[i : i + 2], 16) for i in (1, 3, 5)], np.uint8)
        lab = cv2.cvtColor(np.array([[rgb, wall_rgb]], np.uint8), cv2.COLOR_RGB2LAB)[0].astype(
            float
        )
        if np.linalg.norm(lab[0] - lab[1]) < 18:
            return None
    return {"colour": colour, "width_m": 0.06, "basis": "image_inferred_white_trim; width_inferred"}
