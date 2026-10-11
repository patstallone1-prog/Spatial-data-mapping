"""Which house in the photograph is the one being fitted -- the first thing read off a front.

A front's photograph is the building's own wall projected out of a street-level panorama, by the
panorama's position and heading. A metre or two of GPS error is enough to slide the neighbour into
the frame: on 2432 Bryant Street the left quarter of the crop was the Victorian next door, and its
gated stair was given to the turquoise house as its entry. So before any opening is read, the crop
is split into houses and everything but the one assigned is put aside:

  boundaries   a column where the wall's colour changes and stays changed -- in the upper half of
               the front and in the lower half both (a shadow, a downpipe or a garage door does not
               run the full height) -- with wall on both sides of it
  the house    the run between boundaries over the middle of the crop, which is where the filter
               aimed: it must be most of the expected wall to be believed
  placement    a house found with both its edges is stretched to the wall's width; with one edge,
               that edge is put at the wall's end and the rest of the frame is left unseen

What is put aside is masked out (grey pixels, labelled sky) and its detections dropped, so no
door, gate, stair or window of the next house can be read as this one's.
"""

from __future__ import annotations

from itertools import pairwise

import cv2
import numpy as np

from smc.facades.appearance_bands import lighting_tolerant_difference

SCHEMA = "kerbside.house_extent/1"
#: ADE20K classes that are a building's wall.
WALL_CLASSES = (0, 1, 25)
#: The masked-out part of the frame: sky, so it is never read as wall.
SKY_CLASS = 2
#: How far either side of a column its colour is pooled (metres).
SIDE_M = 0.6
#: A wall colour change this large (Lab, light discounted) in both halves of the front is a boundary between houses.
BOUNDARY_DELTA_E = 15.0
BOUNDARY_DELTA_E_EACH_HALF = 10.0
ONE_HALF_FACTOR = 1.5
#: Boundaries closer than this together are one; nearer the frame's edge than this are not read.
MIN_SEPARATION_M = 1.0
EDGE_MARGIN_FRACTION = 0.06
#: The assigned house must be at least this much of the expected wall.
MIN_HOUSE_FRACTION = 0.45
#: Stretch beyond which a two-edged house is not believed to be this building.
MAX_STRETCH = 1.45


def _lab(bgr: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(float) * np.array([100 / 255, 1, 1]) - np.array(
        [0, 128, 128])


def _wall_mask(labels: np.ndarray, proposals: list[dict] | None) -> np.ndarray:
    mask = np.isin(labels, WALL_CLASSES)
    h, w = labels.shape
    for p in proposals or []:
        if p.get("kind") not in {"window", "door", "garage door"}:
            continue
        x0, y0, x1, y1 = p.get("box", [0, 0, 0, 0])
        mask[max(0, int(y0 * h)):min(h, int(y1 * h) + 1), max(0, int(x0 * w)):min(w, int(x1 * w) + 1)] = False
    return mask


def boundaries(bgr: np.ndarray, labels: np.ndarray, width: float, proposals: list[dict] | None = None) -> list[dict]:
    """Columns where one house's wall gives way to another's, strongest first."""
    h, w = labels.shape
    ppm = w / width
    side = max(3, int(SIDE_M * ppm))
    lab = _lab(bgr)
    mask = _wall_mask(labels, proposals)
    halves = [(int(h * 0.1), int(h * 0.5)), (int(h * 0.5), int(h * 0.92))]
    found = []
    step = max(1, int(0.1 * ppm))
    for x in range(max(side, int(w * EDGE_MARGIN_FRACTION)), min(w - side, int(w * (1 - EDGE_MARGIN_FRACTION))), step):
        deltas = []
        for r0, r1 in halves:
            left, right = mask[r0:r1, x - side:x], mask[r0:r1, x:x + side]
            if left.mean() < 0.25 or right.mean() < 0.25:
                continue  # this half is mostly door, window or garden here
            a = np.median(lab[r0:r1, x - side:x][left], axis=0)
            b = np.median(lab[r0:r1, x:x + side][right], axis=0)
            # Hue and chroma, not the light: a shadow across one wall is not a second house.
            deltas.append(lighting_tolerant_difference(a, b))
        # Seen in both halves, or -- where one half is all garage door -- half again as strong.
        if (len(deltas) == 2 and min(deltas) >= BOUNDARY_DELTA_E_EACH_HALF and max(deltas) >= BOUNDARY_DELTA_E) \
                or (len(deltas) == 1 and deltas[0] >= ONE_HALF_FACTOR * BOUNDARY_DELTA_E):
            found.append({"column": x, "u": x / ppm, "delta_e": round(min(deltas), 1)})
    # One boundary per change. A change registers over a run of columns, as strongly across the
    # middle of the run as anywhere: the boundary is the middle of the strongest part of the run.
    runs: list[list[dict]] = []
    for b in found:
        if runs and b["column"] - runs[-1][-1]["column"] <= 2 * step:
            runs[-1].append(b)
        else:
            runs.append([b])
    centres = []
    for run in runs:
        peak = max(b["delta_e"] for b in run)
        top = [b for b in run if b["delta_e"] >= peak - 1.0]
        mid = top[len(top) // 2]
        centres.append({**mid, "column": (top[0]["column"] + top[-1]["column"]) // 2,
                        "u": (top[0]["u"] + top[-1]["u"]) / 2, "delta_e": peak})
    kept: list[dict] = []
    for b in sorted(centres, key=lambda b: -b["delta_e"]):
        if all(abs(b["u"] - k["u"]) >= MIN_SEPARATION_M for k in kept):
            kept.append(b)
    return sorted(kept, key=lambda b: b["u"])


def assigned_house(bgr: np.ndarray, labels: np.ndarray, width: float,
                   proposals: list[dict] | None = None) -> dict:
    """The run of the frame that is the assigned house, in columns, and how it was found."""
    w = labels.shape[1]
    cuts = boundaries(bgr, labels, width, proposals)
    if not cuts:
        return {"schema": SCHEMA, "status": "whole_frame", "boundaries": [], "columns": [0, w]}
    edges = [0] + [b["column"] for b in cuts] + [w]
    runs = list(pairwise(edges))
    middle = w / 2
    c0, c1 = next(((a, b) for a, b in runs if a <= middle < b), max(runs, key=lambda r: r[1] - r[0]))
    status = "segmented"
    if (c1 - c0) / w < MIN_HOUSE_FRACTION:
        status = "boundaries_not_believed"
        c0, c1 = 0, w
    return {"schema": SCHEMA, "status": status, "boundaries": cuts, "columns": [int(c0), int(c1)],
            "left_edge_seen": c0 > 0, "right_edge_seen": c1 < w}


def isolate(bgr: np.ndarray, labels: np.ndarray, width: float, proposals: list[dict] | None,
            house: dict) -> tuple[np.ndarray, np.ndarray, list[dict] | None, dict]:
    """The frame with only the assigned house in it, where it belongs on the wall."""
    h, w = labels.shape
    c0, c1 = house["columns"]
    info = {**house, "placement": "unchanged"}
    if house["status"] != "segmented" or (c0, c1) == (0, w):
        return bgr, labels, proposals, info
    seen = c1 - c0
    out_bgr = np.full_like(bgr, 128)
    out_labels = np.full_like(labels, SKY_CLASS)
    left, right = house["left_edge_seen"], house["right_edge_seen"]
    if left and right and 1 / MAX_STRETCH <= w / seen <= MAX_STRETCH:
        # Both edges seen: the house is the wall, end to end.
        out_bgr = cv2.resize(bgr[:, c0:c1], (w, h), interpolation=cv2.INTER_LINEAR)
        out_labels = cv2.resize(labels[:, c0:c1], (w, h), interpolation=cv2.INTER_NEAREST)
        scale, shift, placement = w / seen, -c0, "stretched_between_both_edges"
    elif left:
        # Its left end seen: that is the wall's left end; the rest of the wall is out of frame.
        take = min(seen, w)
        out_bgr[:, :take] = bgr[:, c0:c0 + take]
        out_labels[:, :take] = labels[:, c0:c0 + take]
        scale, shift, placement = 1.0, -c0, "left_edge_at_wall_start"
    else:
        take = min(seen, w)
        out_bgr[:, w - take:] = bgr[:, c1 - take:c1]
        out_labels[:, w - take:] = labels[:, c1 - take:c1]
        scale, shift, placement = 1.0, w - c1, "right_edge_at_wall_end"
    kept, dropped = [], 0
    for p in proposals or []:
        box = p.get("box")
        if not box or len(box) != 4:
            continue
        centre = (box[0] + box[2]) / 2 * w
        if not c0 <= centre < c1:
            dropped += 1
            continue
        if placement == "stretched_between_both_edges":
            x0, x1 = ((box[0] * w - c0) * scale) / w, ((box[2] * w - c0) * scale) / w
        else:
            x0, x1 = (box[0] * w + shift) / w, (box[2] * w + shift) / w
        kept.append({**p, "box": [max(0.0, x0), box[1], min(1.0, x1), box[3]],
                     "house_extent_source_box": box})
    info.update(placement=placement, proposals_dropped=dropped,
                seen_fraction=round(seen / w, 3), columns_metres=[round(c0 / w * width, 2), round(c1 / w * width, 2)])
    return out_bgr, out_labels, (kept if proposals is not None else None), info
