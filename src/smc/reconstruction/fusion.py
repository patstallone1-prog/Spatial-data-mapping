"""Surface-space image fusion and provenance-preserving completion.

Inputs are already rectified onto the same canonical surface.  This module never
uses completed pixels to estimate geometry or material truth.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

from smc.reconstruction.contracts import Coverage


@dataclass(frozen=True)
class SurfaceView:
    image: np.ndarray  # RGB uint8
    visible: np.ndarray  # bool; excludes occlusion, privacy, sky, and dynamic objects
    weight: float
    pixels_per_m: float
    observation_id: str
    sequence_id: str

    def validate(self, shape: tuple[int, int] | None = None) -> None:
        if self.image.ndim != 3 or self.image.shape[2] != 3 or self.image.dtype != np.uint8:
            raise ValueError("view image must be RGB uint8")
        if self.visible.shape != self.image.shape[:2] or self.visible.dtype != np.bool_:
            raise ValueError("view visibility must be a matching bool mask")
        if shape is not None and self.visible.shape != shape:
            raise ValueError("views must share a rectified atlas shape")
        if self.weight <= 0 or self.pixels_per_m <= 0:
            raise ValueError("view weight and sampling density must be positive")


@dataclass(frozen=True)
class FusedSurface:
    rgb: np.ndarray
    coverage: np.ndarray  # uint8 Coverage values, never inferred as observed
    support_count: np.ndarray
    source_observations: tuple[str, ...]

    def fractions(self) -> dict[str, float]:
        total = self.coverage.size
        return {kind.name.lower(): float(np.count_nonzero(self.coverage == kind)) / total
                for kind in Coverage}


def mask_temporary_objects(class_masks: dict[str, np.ndarray],
                           reprojection_sigma_px: float, *,
                           permanent_mask: np.ndarray | None = None) -> np.ndarray:
    """Return a conservative exclusion mask for a single rectified view."""
    if reprojection_sigma_px < 0 or not math.isfinite(reprojection_sigma_px):
        raise ValueError("reprojection uncertainty must be finite and non-negative")
    transient = {"person", "face", "license_plate", "car", "bus", "truck", "bicycle",
                 "scooter", "temporary_construction", "sky", "reflection", "border"}
    if not class_masks:
        raise ValueError("a reviewed or model-produced segmentation is required")
    shapes = {mask.shape for mask in class_masks.values()}
    if len(shapes) != 1 or any(mask.dtype != np.bool_ for mask in class_masks.values()):
        raise ValueError("class masks must have one shared bool shape")
    blocked = np.zeros(next(iter(shapes)), dtype=np.uint8)
    for name in transient:
        if name in class_masks:
            blocked |= class_masks[name].astype(np.uint8)
    radius = max(2, math.ceil(2.0 * reprojection_sigma_px))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    blocked = cv2.dilate(blocked, kernel).astype(bool)
    if permanent_mask is not None:
        if permanent_mask.shape != blocked.shape or permanent_mask.dtype != np.bool_:
            raise ValueError("permanent mask has wrong shape or dtype")
        # Privacy redaction always wins; a reviewed permanent object may override a
        # vehicle-like detection caused by a model error.
        privacy = np.zeros_like(blocked)
        for name in ("face", "license_plate", "person"):
            if name in class_masks:
                privacy |= cv2.dilate(class_masks[name].astype(np.uint8), kernel).astype(bool)
        blocked = (blocked & ~permanent_mask) | privacy
    return blocked


def _normalize_exposure(images: np.ndarray, masks: np.ndarray) -> np.ndarray:
    """Align overlapping views to the first well-covered view in linear-light RGB."""
    out = images.astype(np.float32) / 255.0
    out = np.power(out, 2.2)
    reference = int(np.argmax(masks.reshape(len(masks), -1).sum(axis=1)))
    for i in range(len(masks)):
        if i == reference:
            continue
        overlap = masks[reference] & masks[i]
        if overlap.sum() < 100:
            continue
        source_median = np.median(out[i][overlap], axis=0)
        target_median = np.median(out[reference][overlap], axis=0)
        gain = np.clip(target_median / np.maximum(source_median, 1e-3), 0.75, 1.33)
        out[i] = np.clip(out[i] * gain, 0.0, 1.0)
    return out


def fuse_views(views: list[SurfaceView], *, output_pixels_per_m: float) -> FusedSurface:
    if not views:
        raise ValueError("at least one rectified view is required")
    shape = views[0].visible.shape
    for view in views:
        view.validate(shape)
    finest = max(view.pixels_per_m for view in views)
    if output_pixels_per_m > 1.25 * finest + 1e-6:
        raise ValueError("output exceeds the 1.25x observed sampling limit")
    masks = np.stack([view.visible for view in views])
    images = _normalize_exposure(np.stack([view.image for view in views]), masks)
    weights = np.array([view.weight for view in views], dtype=np.float32)
    height, width = shape
    result = np.zeros((height, width, 3), dtype=np.float32)
    # A weighted median resists transient colour outliers; only distinct capture
    # sequences count as independent multiview evidence.
    for channel in range(3):
        values = images[..., channel]
        order = np.argsort(values, axis=0)
        sorted_values = np.take_along_axis(values, order, axis=0)
        sorted_weights = np.take_along_axis(np.where(masks, weights[:, None, None], 0.0), order, axis=0)
        half = sorted_weights.sum(axis=0) / 2.0
        index = (np.cumsum(sorted_weights, axis=0) < half).sum(axis=0)
        result[..., channel] = np.take_along_axis(sorted_values, index[None], axis=0)[0]
    result = np.power(np.clip(result, 0.0, 1.0), 1.0 / 2.2)
    support = masks.sum(axis=0).astype(np.uint16)
    sequence_count = np.zeros(shape, dtype=np.uint16)
    for sequence in sorted({view.sequence_id for view in views}):
        sequence_count += np.any(masks[[i for i, view in enumerate(views)
                                         if view.sequence_id == sequence]], axis=0)
    coverage = np.zeros(shape, dtype=np.uint8)
    coverage[support > 0] = Coverage.DIRECT_OBSERVATION
    coverage[sequence_count >= 2] = Coverage.MULTIVIEW_OBSERVATION
    return FusedSurface(
        np.round(result * 255).astype(np.uint8), coverage, support,
        tuple(sorted({view.observation_id for view in views})),
    )


def complete_surface(fused: FusedSurface, *, material: str = "unknown",
                     generative_rgb: np.ndarray | None = None,
                     generative_mask: np.ndarray | None = None,
                     max_patch_area: int = 256) -> FusedSurface:
    """Fill only visual holes and retain their exact provenance class."""
    rgb = fused.rgb.copy()
    coverage = fused.coverage.copy()
    missing = coverage == Coverage.UNKNOWN
    if not missing.any():
        return fused
    count, labels, stats, _ = cv2.connectedComponentsWithStats(missing.astype(np.uint8), 8)
    small = np.zeros_like(missing, dtype=np.uint8)
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        # A closed small hole surrounded by real pixels can be reconstructed from
        # the same surface; holes at atlas borders are left for a material fallback.
        if area <= max_patch_area and x > 0 and y > 0 and x + w < rgb.shape[1] and y + h < rgb.shape[0]:
            small[labels == label] = 1
    if small.any():
        rgb = cv2.inpaint(rgb, small, 3, cv2.INPAINT_TELEA)
        coverage[small.astype(bool)] = Coverage.SAME_SURFACE_COMPLETION
    missing = coverage == Coverage.UNKNOWN
    if missing.any() and material != "unknown" and np.any(coverage <= Coverage.MULTIVIEW_OBSERVATION):
        observed = coverage == Coverage.DIRECT_OBSERVATION
        observed |= coverage == Coverage.MULTIVIEW_OBSERVATION
        colour = np.median(rgb[observed], axis=0).astype(np.uint8)
        rgb[missing] = colour
        coverage[missing] = Coverage.PROCEDURAL_MATERIAL
    missing = coverage == Coverage.UNKNOWN
    if missing.any() and generative_rgb is not None:
        if generative_rgb.shape != rgb.shape or generative_mask is None or generative_mask.shape != missing.shape:
            raise ValueError("generative completion shape or mask is invalid")
        use = missing & generative_mask.astype(bool)
        rgb[use] = generative_rgb[use]
        coverage[use] = Coverage.GENERATIVE_VISUAL
    return FusedSurface(rgb, coverage, fused.support_count.copy(), fused.source_observations)
