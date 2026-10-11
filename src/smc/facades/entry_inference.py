"""How a house is entered, read from its front photograph: gate, stair, alcove, door.

A front door in San Francisco is rarely a flat door in a flat wall. It is behind an iron gate at
the pavement, or at the top of a long stair to the floor over the garage, or up a few steps that
take up a hill, or set back in a shallow alcove out of the rain. The renderer drew none of that
from a photograph: a door needed a person to certify the stairs under it, and a gate was a
"candidate" nobody looked at, so most doors were left out and the gates with them.

This reads the entries from the image and its segmentation (ADE20K classes, pinned with the
model in the filter's evidence) on the facade's metric frame (u along the wall from its left
end, v up from its foot, metres), and says, per pedestrian entry:

  kind        long_stair   threshold 1.6 m or more up, or a tall flight below it: the floor
                           over a garage, often a full storey -- ``to_second_storey`` then
              short_stair  a few steps, up to 1.6 m: a stoop, or a door uphill of the pavement
              flat_alcove  at the pavement, set back in the wall: its width is measured from
                           the shadowed reveals beside the door, its depth inferred from that
              flush        at the pavement, in the plane of the wall
  gate        a gate in a fence or railing in front of the entry, if there is one: its width,
              height, style (bars, pickets or a solid panel) and colour
  fences      the other runs of fence along the front

Everything is measured on the facade's canonical prior (its known width and height), so a
threshold or a width is good to the photo's resolution on that prior, not surveyed. A tall
flight with no door seen at its top gives a hidden door there.
"""

from __future__ import annotations

import cv2
import numpy as np

SCHEMA = "kerbside.entry_inference/1"
AUTOMATIC_REVIEWER = "automatic:entry_inference/1"

#: ADE20K class ids (0-based) as the filter's segmentation model writes them.
WALL_CLASSES = (0, 1, 25)          # wall, building, house
DOOR_CLASSES = (14, 58)            # door, screen door
STAIR_CLASSES = (53, 59, 121)      # stairs, stairway, step
RAIL_CLASSES = (38, 95)            # railing, bannister
FENCE_CLASSES = (32,)              # fence

STEP_RISE_M = 0.18
STEP_TREAD_M = 0.30
LANDING_M = 1.20
#: At or above this a door is up a long flight; between the two, a short one.
LONG_STAIR_M = 1.6
SHORT_STAIR_M = 0.25
#: A raised door with no flight seen below it is an entry up a hidden stair only this high: higher
#: it is a balcony or a French door, not a front door.
UNSEEN_STAIR_MAX_M = 2.6
#: Fence and gate heights we believe; anything else is not a fence.
FENCE_HEIGHT_M = (0.6, 2.6)
#: A gate leaf's width.
GATE_WIDTH_M = (0.9, 1.8)
#: A pedestrian door's width: narrower is a column or a sliver, wider a garage or a shopfront.
DOOR_WIDTH_M = (0.55, 1.9)


def _runs(flags: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    runs, start = [], None
    for i, on in enumerate([*list(flags), False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if i - start >= min_len:
                runs.append((start, i))
            start = None
    return runs


def _hex(rgb) -> str:
    return "#" + "".join(f"{int(max(0, min(255, v))):02x}" for v in rgb)


def _style(bgr: np.ndarray, mask: np.ndarray, width_m: float) -> dict:
    """Bars (iron), pickets (boards with gaps) or a solid panel, from its stripes.

    Across a gate the brightness of each column of it alternates, bar and gap; how often it
    crosses its own middle is the number of stripes. Dark stripes on light are iron bars, light
    boards with dark gaps are pickets, and no stripes is a solid panel.
    """
    if not mask.any() or width_m <= 0:
        return {"style": "solid", "colour": None}
    ys, xs = np.nonzero(mask)
    patch = bgr[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    sub = mask[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    grey = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
    counts = sub.sum(axis=0)
    columns = (grey * sub).sum(axis=0) / np.maximum(1, counts)
    columns = columns[counts > 0]
    pixels = patch[sub > 0]
    rgb = np.median(pixels[:, ::-1], axis=0) if len(pixels) >= 10 else None
    colour = _hex(rgb) if rgb is not None else None
    if columns.size < 4:
        return {"style": "solid", "colour": colour}
    dark_part = float(np.percentile(columns, 20))
    light_part = float(np.percentile(columns, 80))
    # Halfway between the bars and the gaps, not the median: with more gap than bar the median
    # is the gap's own brightness, and nothing crosses it.
    middle = (dark_part + light_part) / 2
    signs = np.sign(columns - middle)
    signs = signs[signs != 0]
    crossings = int(np.count_nonzero(np.diff(signs)))
    stripes_per_m = crossings / 2 / max(0.3, width_m)
    contrast = float(columns.std())
    if stripes_per_m >= 3 and contrast >= 12:
        # Thin dark members in a light field are bars; broad light members are boards.
        dark_share = float((columns < middle).mean())
        style = "bars" if dark_part < 90 and dark_share <= 0.5 else "pickets"
        if style == "bars" and dark_part < 60:
            colour = _hex([dark_part] * 3)
    else:
        style = "solid"
    return {"style": style, "colour": colour, "stripes_per_m": round(stripes_per_m, 2),
            "stripe_contrast": round(contrast, 1)}


def fence_runs(bgr: np.ndarray, labels: np.ndarray, width: float, height: float,
               flights: list[dict] | None = None) -> list[dict]:
    """The fence along the foot of the front, as runs along the wall.

    A railing counts as fence only away from a flight: beside a stair it is the stair's.
    """
    h, w = labels.shape
    ppm_x, ppm_y = w / width, h / height
    band_top = max(0, h - round(FENCE_HEIGHT_M[1] * ppm_y))
    rails = np.isin(labels, RAIL_CLASSES)
    for f in flights or []:
        x0, x1 = max(0, round((f["u"] - 0.3) * ppm_x)), min(w, round((f["u"] + f["w"] + 0.3) * ppm_x))
        rails[:, x0:x1] = False
    fence = np.isin(labels, FENCE_CLASSES) | rails
    band = fence[band_top:]
    if not band.any():
        return []
    columns = band.mean(axis=0) >= 0.18
    runs = []
    for c0, c1 in _runs(columns, max(2, round(0.4 * ppm_x))):
        part = band[:, c0:c1]
        tops = [np.argmax(part[:, j]) for j in range(part.shape[1]) if part[:, j].any()]
        if not tops:
            continue
        top_px = band_top + float(np.median(tops))
        fence_h = (h - top_px) / ppm_y
        u0, u1 = c0 / ppm_x, c1 / ppm_x
        if not FENCE_HEIGHT_M[0] <= fence_h <= FENCE_HEIGHT_M[1]:
            continue
        mask = np.zeros_like(fence)
        mask[band_top:, c0:c1] = band[:, c0:c1]
        look = _style(bgr, mask, u1 - u0)
        # A car or a bus in front of the house reads as "fence" to the model: wide, solid, no
        # bars. A real solid run that wide is a wall, and a garden wall is not a gate.
        if look["style"] == "solid" and (u1 - u0) > max(4.5, 0.6 * width):
            continue
        runs.append({"u": round(u0, 3), "w": round(u1 - u0, 3), "h": round(fence_h, 3),
                     **look, "fill": round(float(part.mean()), 3)})
    return runs


def stair_regions(labels: np.ndarray, width: float, height: float) -> list[dict]:
    """Connected flights: stair pixels, with any railing that touches them."""
    h, w = labels.shape
    ppm_x, ppm_y = w / width, h / height
    stairs = np.isin(labels, STAIR_CLASSES).astype(np.uint8)
    rails = np.isin(labels, RAIL_CLASSES).astype(np.uint8)
    grown = cv2.dilate(stairs, np.ones((3, 3), np.uint8))
    flight = np.maximum(stairs, rails & grown)
    count, _, stats, _ = cv2.connectedComponentsWithStats(flight, 8)
    out = []
    for x, y, bw, bh, area in stats[1:count]:
        if area / (ppm_x * ppm_y) < 0.12:
            continue
        out.append({"u": x / ppm_x, "w": bw / ppm_x, "v": (h - y - bh) / ppm_y,
                    "top": (h - y) / ppm_y, "area_m2": area / (ppm_x * ppm_y)})
    return out


def reveal_widths(bgr: np.ndarray, labels: np.ndarray, door: dict, width: float, height: float) -> dict:
    """The shadowed jambs either side of a door at the pavement: an alcove's sides.

    In daylight the sides of a recess are darker than the wall's face. The columns next to the
    door, over its height, that stay well below the wall's own brightness are the reveal; the
    door and both reveals are the alcove's width.
    """
    h, w = labels.shape
    ppm_x, ppm_y = w / width, h / height
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    y0 = max(0, round((height - door["v"] - door["h"]) * ppm_y))
    y1 = min(h, round((height - door["v"]) * ppm_y))
    x0 = max(0, round(door["u"] * ppm_x))
    x1 = min(w, round((door["u"] + door["w"]) * ppm_x))
    if y1 - y0 < 4 or x1 - x0 < 2:
        return {"left_m": 0.0, "right_m": 0.0, "header_dark": False}
    wall = np.isin(labels[y0:y1], WALL_CLASSES)
    rows = grey[y0:y1]
    wall_level = float(np.median(rows[wall])) if wall.sum() > 20 else float(np.median(rows))
    limit = 0.72 * wall_level
    reach = round(1.2 * ppm_x)

    def side(indices):
        count = 0
        for x in indices:
            if not 0 <= x < w:
                break
            if float(np.median(rows[:, x])) < limit:
                count += 1
            else:
                break
        return count / ppm_x

    left = side(range(x0 - 1, x0 - 1 - reach, -1))
    right = side(range(x1, x1 + reach))
    head_y0 = max(0, y0 - round(0.35 * ppm_y))
    header = grey[head_y0:y0, x0:x1]
    header_dark = bool(header.size and float(np.median(header)) < limit)
    return {"left_m": round(left, 3), "right_m": round(right, 3), "header_dark": header_dark,
            "wall_luminance": round(wall_level, 1)}


def _recess_for_stairs(door_id: str, rise: float, image_sha256: str | None, basis: str) -> dict:
    """The automatic counterpart of an image-reviewed stair: same fields, same checks."""
    steps = max(1, round(rise / STEP_RISE_M))
    return {
        "category": "long" if rise >= LONG_STAIR_M else "short",
        "door_id": door_id,
        "grade": "inferred_visual",
        "render_steps": True,
        "steps": steps,
        "rise_m": rise,
        "step_rise_m": rise / steps,
        "depth_m": round(steps * STEP_TREAD_M + LANDING_M, 3),
        "landing_depth_m": LANDING_M,
        "supported_by": basis,
        "stairs_evidence": {"visible": True, "image_sha256": image_sha256,
                            "reviewer": AUTOMATIC_REVIEWER, "basis": basis},
        "door_visibility": "observed",
        "landing_alignment": "door_threshold",
        "reason": None,
    }


def infer_entries(
    bgr: np.ndarray,
    labels: np.ndarray,
    width: float,
    height: float,
    openings: list[dict],
    *,
    storey_height_m: float | None = None,
    gate_proposals: list[dict] | None = None,
    image_sha256: str | None = None,
) -> dict:
    """Entries, gate and fences for one front. ``openings`` are the fit's, in metres."""
    if bgr.shape[:2] != labels.shape or width <= 0 or height <= 0:
        raise ValueError("photo and labels must share a positive facade frame")
    flights = stair_regions(labels, width, height)
    fences = fence_runs(bgr, labels, width, height, flights)
    # A gate the detector saw: gate-sized, standing on the ground.
    gates_seen = [g for g in (gate_proposals or []) if all(isinstance(g.get(k), (int, float)) for k in ("u", "w", "h"))
                  and 0.6 <= g["w"] <= 2.5 and g["h"] >= 1.0 and g.get("v", 0) <= 1.0]
    doors = [o for o in openings if o.get("kind") == "door"
             and all(isinstance(o.get(k), (int, float)) for k in ("u", "v", "w", "h"))
             and DOOR_WIDTH_M[0] <= o["w"] <= DOOR_WIDTH_M[1]]
    entries = []
    used_flights = set()
    for door in doors:
        threshold = max(0.0, float(door["v"]))
        centre = door["u"] + door["w"] / 2
        below = [i for i, f in enumerate(flights)
                 if f["u"] - 0.6 <= centre <= f["u"] + f["w"] + 0.6
                 and abs(f["top"] - threshold) <= max(0.8, 0.35 * threshold)]
        used_flights.update(below)
        flight_top = max((flights[i]["top"] for i in below), default=0.0)
        rise = max(threshold, flight_top if threshold >= SHORT_STAIR_M else 0.0)
        entry = {"door_id": door["id"], "u": door["u"], "w": door["w"], "threshold_m": round(rise, 3),
                 "stair_pixels": bool(below)}
        lower_door = any(o is not door and o["v"] < door["v"] - 0.5 for o in doors)
        if not below and rise >= SHORT_STAIR_M and (rise > UNSEEN_STAIR_MAX_M or lower_door):
            # Up the wall with nothing seen under it, or above another door: a balcony door.
            entry["kind"] = "upper_door"
            entries.append(entry)
            continue
        if rise >= LONG_STAIR_M or (below and flight_top >= LONG_STAIR_M):
            entry["kind"] = "long_stair"
        elif rise >= SHORT_STAIR_M or below:
            entry["kind"] = "short_stair"
            rise = max(rise, STEP_RISE_M)
        else:
            reveals = reveal_widths(bgr, labels, door, width, height)
            side = reveals["left_m"] + reveals["right_m"]
            entry["reveals"] = reveals
            if side >= 0.25 or (reveals["header_dark"] and side >= 0.1):
                alcove_w = min(door["w"] + 2.4, max(door["w"] + 0.2, door["w"] + side))
                entry["kind"] = "flat_alcove"
                entry["alcove"] = {
                    "u": round(door["u"] - reveals["left_m"], 3),
                    "width_m": round(alcove_w, 3),
                    "width_basis": "measured_shadowed_reveals_on_prior",
                    # A front alcove is about as deep as it is wide, within the depth a house
                    # gives up to one: not measured -- a single photograph has no depth.
                    "depth_m": round(min(1.8, max(0.9, 0.55 * alcove_w + 0.45)), 3),
                    "depth_basis": "inferred_from_width_prior",
                }
            else:
                entry["kind"] = "flush"
        if entry["kind"] in {"long_stair", "short_stair"}:
            entry["threshold_m"] = round(rise, 3)
            entry["to_second_storey"] = bool(storey_height_m and rise >= 0.7 * storey_height_m)
            entry["recess"] = _recess_for_stairs(
                door["id"], rise, image_sha256,
                "segmentation_stair_pixels_and_door_threshold" if below else "door_threshold_on_prior")
            entry["recess_width_m"] = round(max(door["w"] + 0.4, max(
                (flights[i]["w"] for i in below), default=0.0)), 3)
        entries.append(entry)
    # A tall flight with no door seen at its top: the door is up there, out of sight.
    for i, f in enumerate(flights):
        if i in used_flights or f["top"] < LONG_STAIR_M or f["v"] > 0.5:
            continue
        if f["u"] < 0.08 or f["u"] + f["w"] > width - 0.08:
            continue
        door_id = f"hidden-entry-{i}"
        entries.append({
            "door_id": door_id, "u": round(f["u"] + f["w"] / 2 - 0.5, 3), "w": 1.0,
            "kind": "long_stair", "threshold_m": round(f["top"], 3), "stair_pixels": True,
            "hidden_door": True,
            "to_second_storey": bool(storey_height_m and f["top"] >= 0.7 * storey_height_m),
            "recess": {**_recess_for_stairs(door_id, f["top"], image_sha256,
                                            "segmentation_flight_without_visible_door"),
                       "door_visibility": "hidden_inferred"},
            "recess_width_m": round(max(1.4, f["w"]), 3),
        })
    # The gate: a fence run, or the detector's gate, across the front of an entry.
    for entry in entries:
        lo, hi = entry["u"] - 0.8, entry["u"] + entry["w"] + 0.8
        run = next((r for r in fences if r["u"] < hi and r["u"] + r["w"] > lo), None)
        seen = next((g for g in gates_seen if g["u"] < hi and g["u"] + g["w"] > lo), None)
        if not run and not seen:
            continue
        gate_w = min(GATE_WIDTH_M[1], max(GATE_WIDTH_M[0], seen["w"] if seen else entry.get("recess_width_m")
                                          or entry.get("alcove", {}).get("width_m") or entry["w"] + 0.3))
        gate_h = run["h"] if run else min(2.2, max(1.2, float(seen.get("h", 1.8))))
        # Where the detector saw the gate, it stands there; otherwise in front of the door.
        middle = seen["u"] + seen["w"] / 2 if seen else entry["u"] + entry["w"] / 2
        entry["gate"] = {
            "u": round(middle - gate_w / 2, 3), "w": round(gate_w, 3),
            "h": round(gate_h, 3),
            "style": (run or {}).get("style", "bars"), "colour": (run or {}).get("colour"),
            "basis": "segmentation_fence_run" if run else "detector_entrance_gate",
            "opens": True,
        }
    other_fences = [r for r in fences if not any(
        e.get("gate") and r["u"] < e["gate"]["u"] + e["gate"]["w"] and r["u"] + r["w"] > e["gate"]["u"]
        for e in entries)]
    return _plain({
        "schema": SCHEMA,
        "entries": entries,
        "fences": fences,
        "fences_without_gate": other_fences,
        "flights": [{k: round(v, 3) for k, v in f.items()} for f in flights],
        "certainty": "image_on_prior_geometry; depth inferred; not surveyed",
    })


def _plain(value):
    """NumPy numbers as Python ones: the fits are JSON, and json writes a numpy float as text."""
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return round(float(value), 4)
    return value


def primary_entry(result: dict) -> dict | None:
    """The house's front entry: a gated or stair entry before a flush door, then the widest."""
    rank = {"long_stair": 3, "short_stair": 2, "flat_alcove": 2, "flush": 1}
    entries = [e for e in result.get("entries") or [] if e.get("kind") in rank]
    if not entries:
        return None
    return max(entries, key=lambda e: (bool(e.get("gate")), rank.get(e["kind"], 0), e["w"]))

