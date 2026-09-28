"""Ground-plane road measurements from reviewed, calibrated image masks.

The semantic model supplies instance masks; this module measures geometry only.
It does not call an uncalibrated image a metric observation, and it never infers
parking from a single parked-looking frame or paint from OSM policy tags.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise

import cv2
import numpy as np


@dataclass(frozen=True)
class PaintSegment:
    start_xy: tuple[float, float]
    end_xy: tuple[float, float]
    width_m: float
    length_m: float
    colour: str
    confidence: float


def _ground_contours(mask: np.ndarray, image_to_enu: np.ndarray,
                     min_pixels: int = 12) -> list[np.ndarray]:
    if mask.ndim != 2 or image_to_enu.shape != (3, 3):
        raise ValueError("binary mask and 3x3 image-to-ENU homography required")
    if not np.isfinite(image_to_enu).all() or abs(np.linalg.det(image_to_enu)) < 1e-12:
        raise ValueError("unstable image-to-ENU homography")
    contours, _ = cv2.findContours((mask > 0).astype(np.uint8),
                                    cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    result = []
    for contour in contours:
        if cv2.contourArea(contour) < min_pixels:
            continue
        ground = cv2.perspectiveTransform(contour.astype(np.float64),
                                           image_to_enu.astype(np.float64))[:, 0, :]
        if np.isfinite(ground).all():
            result.append(ground)
    return result


def _signed_curb_distance(point: np.ndarray, curb: np.ndarray) -> float:
    """Signed nearest distance: positive to the left of oriented curb polyline."""
    best = (math.inf, 0.0)
    for a, b in pairwise(curb):
        direction = b - a
        squared = float(direction @ direction)
        if squared < 1e-10:
            continue
        t = min(1.0, max(0.0, float((point - a) @ direction) / squared))
        offset = point - (a + t * direction)
        distance = float(np.linalg.norm(offset))
        signed = float(np.linalg.det(np.stack([direction, offset]))) / math.sqrt(squared)
        if distance < best[0]:
            best = (distance, signed)
    return best[1]


def vehicle_roadside_reach(mask: np.ndarray, image_to_enu: np.ndarray,
                           curb_line_enu: np.ndarray, road_side_sign: int) -> float | None:
    """Furthest vehicle-mask point from the kerb on its specified road side."""
    curb = np.asarray(curb_line_enu, dtype=float)
    if curb.ndim != 2 or curb.shape[0] < 2 or curb.shape[1] != 2:
        raise ValueError("curb_line_enu needs at least two 2D points")
    if road_side_sign not in (-1, 1):
        raise ValueError("road_side_sign must be -1 or 1")
    reaches = []
    for polygon in _ground_contours(mask, image_to_enu):
        if cv2.contourArea(polygon.astype(np.float32)) < 1.0:
            continue
        distances = [road_side_sign * _signed_curb_distance(p, curb) for p in polygon]
        # Reject a mask on the other side of the kerb, not a width of zero.
        if max(distances) > 0.3 and min(distances) > -0.8:
            reaches.append(max(distances))
    return max(reaches) if reaches else None


def extract_lane_paint(mask: np.ndarray, image_to_enu: np.ndarray,
                       colour: str, confidence: float) -> list[PaintSegment]:
    """Measure slender painted components, excluding wide crossing/stop bars.

    An instance remains a segment, not a claimed solid/dashed lane category;
    continuity requires longitudinal aggregation over independently seen frames.
    """
    if colour not in {"white", "yellow"} or not 0 <= confidence <= 1:
        raise ValueError("paint needs white/yellow class and calibrated confidence")
    segments = []
    for polygon in _ground_contours(mask, image_to_enu):
        centroid = polygon.mean(axis=0)
        centered = polygon - centroid
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        axis = vt[0]
        along = centered @ axis
        across = centered @ vt[1]
        lo, hi = np.percentile(along, [2, 98])
        width = float(np.percentile(across, 98) - np.percentile(across, 2))
        length = float(hi - lo)
        if not (length >= 1.5 and 0.025 <= width <= 0.45 and length / width >= 4):
            continue
        start, end = centroid + lo * axis, centroid + hi * axis
        segments.append(PaintSegment(tuple(map(float, start)), tuple(map(float, end)),
                                     round(width, 3), round(length, 3), colour, confidence))
    return segments
