"""A photograph of a house front, squared up from the photograph itself.

The run's photographs come with a solved camera pose and are rectified onto the wall by
projection (smc.facades.rectify). A photograph someone takes on the pavement has a phone's GPS --
five to twelve metres out -- and a compass heading, not a pose: projected from those, the wall
would land metres from where it is. So it is squared up from what it shows: the vertical edges of
the front all meet at one vanishing point and its horizontal edges at another, and the
homography that sends those two points to infinity along the image's axes makes every vertical
edge vertical and every horizontal one horizontal -- the front as an elevation, up to a scale
along each axis. Where the front starts and stops in that elevation (``extents``) and the
house's width and height from the map (its footprint's front wall, the lidar's height) give the
scale: metres, as the run's own rectified fronts are.
"""

from __future__ import annotations

import math

import cv2
import numpy as np


def line_segments(bgr: np.ndarray, min_len: float = 40.0) -> np.ndarray:
    """Straight edges: (x1, y1, x2, y2) rows."""
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    lines = lsd.detect(grey)[0]
    if lines is None:
        return np.zeros((0, 4))
    lines = lines[:, 0, :]
    lengths = np.hypot(lines[:, 2] - lines[:, 0], lines[:, 3] - lines[:, 1])
    return lines[lengths >= min_len]


def _homogeneous_line(segment: np.ndarray) -> np.ndarray:
    a = np.array([segment[0], segment[1], 1.0])
    b = np.array([segment[2], segment[3], 1.0])
    line = np.cross(a, b)
    return line / (np.linalg.norm(line[:2]) + 1e-12)


def vanishing_point(segments: np.ndarray, iterations: int = 2000, threshold_deg: float = 1.5,
                    seed: int = 7) -> tuple[np.ndarray, int]:
    """The point most of the segments point at (RANSAC on pairs), refined by least squares."""
    if len(segments) < 2:
        raise ValueError("not enough edges for a vanishing point")
    rng = np.random.default_rng(seed)
    lines = np.array([_homogeneous_line(s) for s in segments])
    mids = np.stack([(segments[:, 0] + segments[:, 2]) / 2, (segments[:, 1] + segments[:, 3]) / 2], axis=1)
    dirs = np.stack([segments[:, 2] - segments[:, 0], segments[:, 3] - segments[:, 1]], axis=1)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    weights = np.hypot(segments[:, 2] - segments[:, 0], segments[:, 3] - segments[:, 1])
    limit = math.sin(math.radians(threshold_deg))

    def agreement(vp: np.ndarray) -> np.ndarray:
        # The angle between each segment and the line from its middle to the point.
        if abs(vp[2]) < 1e-9:
            to = np.tile(vp[:2] / (np.linalg.norm(vp[:2]) + 1e-12), (len(mids), 1))
        else:
            to = vp[:2] / vp[2] - mids
            to /= np.linalg.norm(to, axis=1, keepdims=True) + 1e-12
        return np.abs(dirs[:, 0] * to[:, 1] - dirs[:, 1] * to[:, 0])

    best, best_score = None, -1.0
    for _ in range(iterations):
        i, j = rng.choice(len(lines), 2, replace=False)
        vp = np.cross(lines[i], lines[j])
        if np.linalg.norm(vp) < 1e-12:
            continue
        vp = vp / np.linalg.norm(vp)
        score = weights[agreement(vp) < limit].sum()
        if score > best_score:
            best, best_score = vp, score
    inliers = agreement(best) < limit
    # Least squares: the point closest to every inlier's line.
    _, _, vt = np.linalg.svd(lines[inliers] * weights[inliers, None])
    refined = vt[-1]
    return refined / np.linalg.norm(refined), int(inliers.sum())


def rectifying_homography(vp_vertical: np.ndarray, vp_horizontal: np.ndarray, centre: tuple[float, float]) -> np.ndarray:
    """The homography sending the horizontal vanishing point to (1, 0, 0), the vertical one to
    (0, 1, 0) and the image centre to the origin: verticals vertical, horizontals horizontal."""
    v = vp_vertical / np.linalg.norm(vp_vertical)
    h = vp_horizontal / np.linalg.norm(vp_horizontal)
    c = np.array([centre[0], centre[1], 1.0])
    m = np.stack([h, v, c], axis=1)
    H = np.linalg.inv(m)
    # Keep the orientation: up stays up, left stays left.
    test = H @ np.array([centre[0] + 10, centre[1], 1.0])
    if test[0] / test[2] < 0:
        H = np.diag([-1.0, 1.0, 1.0]) @ H
    test = H @ np.array([centre[0], centre[1] + 10, 1.0])
    if test[1] / test[2] < 0:
        H = np.diag([1.0, -1.0, 1.0]) @ H
    return H


def squared_up(bgr: np.ndarray, max_side: int = 2400) -> dict:
    """The photograph as an elevation (up to a scale per axis): the warped image, the homography
    and how many edges agreed on each vanishing point."""
    segments = line_segments(bgr)
    angles = np.degrees(np.arctan2(segments[:, 3] - segments[:, 1], segments[:, 2] - segments[:, 0])) % 180
    vertical = segments[np.abs(angles - 90) < 25]
    horizontal = segments[(angles < 25) | (angles > 155)]
    vp_v, n_v = vanishing_point(vertical)
    vp_h, n_h = vanishing_point(horizontal)
    h, w = bgr.shape[:2]
    H = rectifying_homography(vp_v, vp_h, (w / 2, h / 2))
    corners = cv2.perspectiveTransform(np.float32([[[0, 0]], [[w, 0]], [[w, h]], [[0, h]]]), H)[:, 0, :]
    # The near half of a steep upward view is magnified most; the box of the warped photograph,
    # clipped to a sane multiple of the photograph so a vanishing point near the frame cannot
    # blow it up.
    x0, y0 = corners.min(axis=0)
    x1, y1 = corners.max(axis=0)
    scale = max_side / max(x1 - x0, y1 - y0)
    S = np.array([[scale, 0, -x0 * scale], [0, scale, -y0 * scale], [0, 0, 1]])
    size = (int((x1 - x0) * scale), int((y1 - y0) * scale))
    warped = cv2.warpPerspective(bgr, S @ H, size, flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    return {"image": warped, "H": S @ H, "vertical_edges": n_v, "horizontal_edges": n_h,
            "vp_vertical": vp_v.tolist(), "vp_horizontal": vp_h.tolist()}


def elevation_matrix(H: np.ndarray, extents: tuple[float, float, float, float],
                     width_m: float, height_m: float, pixels_per_m: float = 40.0) -> tuple[np.ndarray, tuple[int, int]]:
    """The homography from the photograph to its front's elevation in metres (``extents``: left,
    top, right, bottom in the squared-up image's pixels), and the elevation's size."""
    left, top, right, bottom = extents
    out_w, out_h = round(width_m * pixels_per_m), round(height_m * pixels_per_m)
    A = np.array([[out_w / (right - left), 0, -left * out_w / (right - left)],
                  [0, out_h / (bottom - top), -top * out_h / (bottom - top)], [0, 0, 1]])
    return A @ H, (out_w, out_h)


def elevation(bgr: np.ndarray, H: np.ndarray, extents: tuple[float, float, float, float],
              width_m: float, height_m: float, pixels_per_m: float = 40.0) -> np.ndarray:
    """The front cut out of a squared-up photograph and scaled to metres -- what the run's
    rectified fronts are."""
    M, size = elevation_matrix(H, extents, width_m, height_m, pixels_per_m)
    return cv2.warpPerspective(bgr, M, size, flags=cv2.INTER_AREA, borderValue=(0, 0, 0))
