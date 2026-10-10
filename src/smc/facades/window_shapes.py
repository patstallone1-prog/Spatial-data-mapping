"""Conservative image-space arch proposals, not measured three-dimensional openings."""

import cv2
import numpy as np


def arched_profile(bgr: np.ndarray) -> dict | None:
    """Require both curved crown and jambs; reflections/curtains alone are insufficient.

    Distance-transform support is tested in three independent arc sectors and
    compared to a straight lintel. Dimensions remain those of the registered
    opening prior, and a positive result still requires photographic review.
    """
    if not bgr.size or min(bgr.shape[:2]) < 24:
        return None
    h, w = bgr.shape[:2]
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(grey, 60, 150)
    if not edges.any():
        return None
    distance = cv2.distanceTransform(255 - edges, cv2.DIST_L2, 3)
    tolerance = max(1.5, min(w, h) * 0.025)
    gx = cv2.Sobel(grey, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(grey, cv2.CV_32F, 0, 1)
    angles = np.arctan2(gy, gx)
    oriented = []
    for angle in np.arange(12) * np.pi / 12:
        aligned = (edges > 0) & (np.abs(np.cos(angles - angle)) >= np.cos(np.pi / 6))
        oriented.append(cv2.distanceTransform((~aligned).astype(np.uint8), cv2.DIST_L2, 3))

    def support(xs, ys, normals=None):
        x = np.clip(np.rint(xs).astype(int), 0, w - 1)
        y = np.clip(np.rint(ys).astype(int), 0, h - 1)
        if normals is None:
            values = distance[y, x]
        else:
            bins = np.rint((normals % np.pi) * 12 / np.pi).astype(int) % 12
            values = np.array([oriented[b][yy, xx] for b, yy, xx in zip(bins, y, x, strict=True)])
        return float((values <= tolerance).mean())

    best = None
    for inset in (0.025, 0.05, 0.075):
        xs = np.linspace(inset * w, (1 - inset) * w - 1, 51)
        unit = np.linspace(-1, 1, len(xs))
        for top in (0.015, 0.04, 0.075):
            for rise in np.linspace(0.22, 0.60, 20):
                crown = h * (top + rise * (1 - np.sqrt(1 - unit**2)))
                slope = rise * h / ((xs[-1] - xs[0]) / 2) * unit / np.sqrt(np.maximum(1e-6, 1 - unit**2))
                normals = np.arctan2(np.ones(51), -slope)
                scores = [support(xs[s], crown[s], normals[s]) for s in np.array_split(np.arange(51), 3)]
                curved = support(xs, crown, normals)
                lintel = support(xs[5:-5], np.full(41, h * top))
                jamb_y = np.linspace(h * (top + rise), h * 0.94, 31)
                jambs = min(support(np.full(31, xs[0]), jamb_y), support(np.full(31, xs[-1]), jamb_y))
                if min(scores) < 0.70 or curved < 0.84 or jambs < 0.65 or lintel > 0.60:
                    continue
                score = curved + jambs - lintel
                if best is None or score > best[0]:
                    best = (score, {
                        "shape": "arched",
                        "arch_spring_fraction": round(float(1 - rise), 3),
                        "shape_basis": "curved_image_edge_and_jamb_support_on_registered_box",
                        "shape_requires_review": True,
                        "arc_support": round(curved, 3),
                        "jamb_support": round(jambs, 3),
                    })
    return best[1] if best else None
