"""What a wall's photographs say about the building behind it: the facade survey.

The fingerprint (:mod:`smc.facades.fingerprint`) reduces a building to a handful of numbers
for choosing a material. Interiors need the wall itself: where each window is and how big,
how many storeys there are and how far apart, where the door is, whether the ground floor is a
shop, and how tall the building actually stands in the photographs. This module measures all
of that from one wall's composite -- the views of it rectified square-on, aligned against each
other and medianed (:func:`smc.facades.rectify.compose`) -- so a single mis-posed frame or a
parked van does not put a window where there is none.

Everything is in the wall's own metres: ``u`` along it from its first corner, ``v`` up from
its foot. What is measured and what is inferred are kept apart: a window's box is measured; a
storey's floor line is inferred from the window rows and an assumed sill, and is labelled so.

The roofline is measured only where the photographs saw sky above the wall. Where they did not
-- a tall building from across a narrow street -- the survey records the highest point it did
see as a *lower bound*, and says that is what it is.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

#: A window, measured: at least this wide and tall, at most this -- anything larger is a
#: shopfront or a curtain wall, measured as such.
WINDOW_MIN_M = (0.35, 0.5)
WINDOW_MAX_M = (4.0, 3.5)
#: A dark region filling less of its own bounding box than this is a shadow or a tree.
MIN_FILL = 0.5
#: Openings reaching within this of the wall's foot and at least DOOR_MIN_H_M tall are doors;
#: those also wider than STOREFRONT_MIN_W_M are shopfronts.
GROUND_REACH_M = 0.45
DOOR_MIN_H_M = 1.8
STOREFRONT_MIN_W_M = 2.2
#: Window boxes whose centres lie within this of each other vertically are one row.
ROW_TOLERANCE_M = 0.8
#: The assumed height of a sill above its floor, for the *inferred* floor lines only.
ASSUMED_SILL_M = 0.9
#: Sky must fill this share of a row's seen pixels, over ROOF_ROWS_M of rows, to be sky.
SKY_SHARE = 0.55
ROOF_ROWS_M = 0.75


def _hls(bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rgb = bgr[..., ::-1].astype(np.float64) / 255.0
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    light = (mx + mn) / 2.0
    delta = mx - mn
    sat = np.where(delta <= 1e-6, 0.0, delta / np.maximum(1e-6, 1.0 - np.abs(2 * light - 1)))
    return rgb, light, np.clip(sat, 0.0, 1.0)


def sky_mask(bgr: np.ndarray) -> np.ndarray:
    """Pale, blue-leaning, smooth: the sky the camera saw above a roof."""
    rgb, light, sat = _hls(bgr)
    blueish = rgb[..., 2] >= rgb[..., 0] + 0.02
    bright = light > 0.62
    gy, gx = np.gradient(light)
    smooth = np.hypot(gx, gy) < 0.035
    return blueish & bright & (sat < 0.8) & smooth


#: A composite whose strong edges are less axis-aligned than this was not seen square-on.
MIN_RECTILINEARITY = 0.4
#: A wall whose visible part is more than this share foliage is a tree, not a facade.
MAX_VEGETATION_SHARE = 0.3


def vegetation_share(bgr: np.ndarray, seen: np.ndarray) -> float:
    """Share of the seen wall that is foliage: green-dominant and textured."""
    rgb, light, _sat = _hls(bgr)
    green = (rgb[..., 1] > rgb[..., 0] + 0.03) & (rgb[..., 1] > rgb[..., 2] + 0.01) & \
        (light > 0.08) & (light < 0.8)
    return float((green & seen).sum() / max(1, seen.sum()))


def rectilinearity(bgr: np.ndarray, seen: np.ndarray) -> float:
    """Share of the wall's strong edges that run within 8 degrees of horizontal or vertical.

    A facade seen square-on is lines at right angles: window frames, floor lines, corners. A
    frame whose pose is off by a few degrees or metres projects the street onto the wall's plane
    instead, and converging verticals, parked cars and foliage come out as edges at every angle.
    Random texture scores about 0.18; a square-on facade well over 0.4.
    """
    _rgb, light, _sat = _hls(bgr)
    gx = cv2.Sobel(light, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(light, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    inner = cv2.erode(seen.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    strong = inner & (mag > max(0.08, float(np.percentile(mag[inner], 80)) if inner.any() else 1))
    if strong.sum() < 50:
        return 0.0
    angle = np.degrees(np.arctan2(gy[strong], gx[strong])) % 90.0
    return float(((angle < 8.0) | (angle > 82.0)).mean())


def upside_down(bgr: np.ndarray, seen: np.ndarray) -> bool:
    """Sky in the bottom third of a wall is a frame whose orientation is wrong."""
    h = bgr.shape[0]
    bottom = slice(int(h * 2 / 3), h)
    sky = sky_mask(bgr[bottom]) & seen[bottom]
    return float(sky.sum() / max(1, seen[bottom].sum())) > 0.2


#: Openings are judged against the wall immediately around them, over this many metres: a
#: daylit window is darker than its own frame and reveal, not necessarily than the whole wall.
LOCAL_WINDOW_M = 2.5
LOCAL_CONTRAST = 0.07


def glazing_mask(bgr: np.ndarray, seen: np.ndarray, pixels_per_m: float = 8.0) -> np.ndarray:
    """Openings: darker than the wall around them by a margin, or blue-grey glass darker than
    its surroundings. The surroundings are a local mean over the seen pixels only, so the black
    outside the composite does not pull it down."""
    rgb, light, sat = _hls(bgr)
    size = max(3, int(LOCAL_WINDOW_M * pixels_per_m) | 1)
    weight = cv2.blur(seen.astype(np.float64), (size, size))
    local = cv2.blur(np.where(seen, light, 0.0), (size, size)) / np.maximum(weight, 1e-6)
    dark = light < local - LOCAL_CONTRAST
    glassy = (rgb[..., 2] > rgb[..., 0] + 0.04) & (sat < 0.35) & (light < local - 0.03)
    mask = (dark | glassy) & seen & (weight > 0.5)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    return mask.astype(bool)


@dataclass(frozen=True)
class Opening:
    kind: str          # window | door | storefront
    u: float
    v: float
    w: float
    h: float
    fill: float
    confidence: float

    def to_json(self) -> list:
        return [self.kind, round(self.u, 2), round(self.v, 2), round(self.w, 2), round(self.h, 2),
                round(self.confidence, 2)]


@dataclass(frozen=True)
class WallSurvey:
    """Measurements of one wall. ``roofline_m`` is measured only when ``roof_seen``."""

    length_m: float
    modelled_height_m: float
    visible_height_m: float
    roofline_m: float | None
    roof_seen: bool
    openings: tuple[Opening, ...]
    rows: tuple[tuple[float, float, int], ...]
    storey_m: float | None
    storeys: int | None
    floor_lines_m: tuple[float, ...]
    ground: str
    glazing: float
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "len": round(self.length_m, 2), "modelled_h": round(self.modelled_height_m, 2),
            "visible_h": round(self.visible_height_m, 2),
            "roofline_m": None if self.roofline_m is None else round(self.roofline_m, 2),
            "roof_seen": self.roof_seen,
            "openings": [o.to_json() for o in self.openings],
            "rows": [[round(a, 2), round(b, 2), n] for a, b, n in self.rows],
            "storey_m": None if self.storey_m is None else round(self.storey_m, 2),
            "storeys": self.storeys,
            # Inferred, from the window rows and an assumed sill: labelled so wherever used.
            "floor_lines_inferred_m": [round(f, 2) for f in self.floor_lines_m],
            "ground": self.ground, "glazing": round(self.glazing, 3),
        }
        if self.notes:
            out["notes"] = list(self.notes)
        return out


def roofline(bgr: np.ndarray, seen: np.ndarray, pixels_per_m: float
             ) -> tuple[float | None, bool, float]:
    """Height (m above the foot) where the building stops and the sky starts.

    Returns ``(height, seen_sky, highest_seen)``. ``seen_sky`` False means the photographs did
    not reach the top, and ``height`` is then None: ``highest_seen`` is a lower bound only.
    """
    h = bgr.shape[0]
    sky = sky_mask(bgr) & seen
    seen_rows = seen.sum(axis=1)
    share = np.where(seen_rows > 0, sky.sum(axis=1) / np.maximum(seen_rows, 1), 0.0)
    rows_seen = np.flatnonzero(seen_rows > seen.shape[1] * 0.2)
    highest = (h - rows_seen.min()) / pixels_per_m if rows_seen.size else 0.0
    need = max(2, int(ROOF_ROWS_M * pixels_per_m))
    # Row 0 is the top. Walk down from the top while the rows are sky; the roofline is the
    # first run of `need` rows that are not.
    skyish = share >= SKY_SHARE
    run = 0
    top_sky_end = None
    for r in range(h):
        if seen_rows[r] <= seen.shape[1] * 0.2:
            continue
        if skyish[r]:
            run += 1
            top_sky_end = r
        elif run >= need:
            break
        else:
            run = 0
            top_sky_end = None
    if top_sky_end is None or run < need:
        return None, False, highest
    return (h - (top_sky_end + 1)) / pixels_per_m, True, highest


def _runs(values: np.ndarray, threshold: float) -> list[tuple[int, int]]:
    """Index ranges [a, b) where ``values`` stays above ``threshold``."""
    above = np.concatenate([[False], values > threshold, [False]])
    edges = np.flatnonzero(np.diff(above.astype(np.int8)))
    return list(zip(edges[::2], edges[1::2], strict=True))


def _smooth(values: np.ndarray, width: int) -> np.ndarray:
    if width <= 1 or len(values) < width:
        return values
    return np.convolve(values, np.ones(width) / width, mode="same")


def openings(bgr: np.ndarray, seen: np.ndarray, pixels_per_m: float,
             below_m: float | None = None) -> list[Opening]:
    """Every window, door and shopfront the composite shows, as boxes in wall metres.

    Found the way a facade is built, in rows and columns: the bands of height where openings
    concentrate (a storey's windows), then within each band the runs along the wall where they
    do (each window). Connected-component blobs would do it too on a clean drawing; in a street
    photograph neighbouring windows join through dark frames, fire escapes and shadow into one
    irregular shape, and are lost.
    """
    h, w = bgr.shape[:2]
    dark = glazing_mask(bgr, seen, pixels_per_m)
    if below_m is not None:
        dark[: int(max(0, h - below_m * pixels_per_m))] = False
    seen_rows = np.maximum(seen.sum(axis=1), 1)
    rows = _smooth(dark.sum(axis=1) / seen_rows, 3)
    rows[seen.sum(axis=1) < 0.2 * w] = 0.0
    if not rows.any():
        return []
    row_threshold = max(0.1, 0.45 * float(np.percentile(rows[rows > 0], 95)))
    found: list[Opening] = []
    for top, bottom in _runs(rows, row_threshold):
        band_h = (bottom - top) / pixels_per_m
        if band_h < WINDOW_MIN_M[1]:
            continue
        band = dark[top:bottom]
        band_seen = np.maximum(seen[top:bottom].sum(axis=0), 1)
        cols = _smooth(band.sum(axis=0) / band_seen, 3)
        cols[seen[top:bottom].sum(axis=0) < 0.5 * (bottom - top)] = 0.0
        for left, right in _runs(cols, 0.4):
            width_m = (right - left) / pixels_per_m
            if width_m < WINDOW_MIN_M[0]:
                continue
            # The opening's own height within the band: where this column run is dark.
            sub = dark[top:bottom, left:right]
            own = _runs(_smooth(sub.mean(axis=1), 3), 0.35)
            if not own:
                continue
            a, b = max(own, key=lambda r: r[1] - r[0])
            y0, y1 = top + a, top + b
            height_m = (y1 - y0) / pixels_per_m
            fill = float(dark[y0:y1, left:right].mean())
            if height_m < WINDOW_MIN_M[1] or fill < 0.45:
                continue
            v = (h - y1) / pixels_per_m
            u = left / pixels_per_m
            if v <= GROUND_REACH_M and height_m >= DOOR_MIN_H_M:
                kind = "storefront" if width_m >= STOREFRONT_MIN_W_M else "door"
            elif width_m <= WINDOW_MAX_M[0] and height_m <= WINDOW_MAX_M[1]:
                kind = "window"
            elif v < 1.5:
                kind = "storefront"
            else:
                continue
            confidence = min(1.0, fill) * (0.6 if v < 2.0 else 1.0)
            found.append(Opening(kind, u, v, width_m, height_m, fill, float(confidence)))
    return sorted(found, key=lambda o: (o.v, o.u))


def window_rows(found: list[Opening]) -> list[tuple[float, float, int]]:
    """Windows grouped into rows by the height of their centres: (bottom, top, count)."""
    windows = sorted((o for o in found if o.kind == "window"), key=lambda o: o.v + o.h / 2)
    rows: list[list[Opening]] = []
    for o in windows:
        centre = o.v + o.h / 2
        if rows and abs(centre - np.median([r.v + r.h / 2 for r in rows[-1]])) <= ROW_TOLERANCE_M:
            rows[-1].append(o)
        else:
            rows.append([o])
    return [(float(np.median([o.v for o in r])), float(np.median([o.v + o.h for o in r])), len(r))
            for r in rows]


def storey_period(bgr: np.ndarray, seen: np.ndarray, pixels_per_m: float,
                  below_m: float | None = None) -> float | None:
    """Storey height from the autocorrelation of the wall's row brightness, between 2.6 m and
    6 m, or None when the wall does not repeat."""
    _rgb, light, _sat = _hls(bgr)
    h = bgr.shape[0]
    rows_seen = seen.sum(axis=1)
    usable = rows_seen > 0.3 * seen.shape[1]
    if below_m is not None:
        usable[: int(max(0, h - below_m * pixels_per_m))] = False
    profile = np.where(usable, (light * seen).sum(axis=1) / np.maximum(rows_seen, 1), np.nan)
    profile = profile[usable]
    n = len(profile)
    if n < int(3 * 2.6 * pixels_per_m):
        return None  # fewer than three storeys in view: no period worth trusting
    x = profile - profile.mean()
    ac = np.correlate(x, x, mode="full")[n - 1:]
    if ac[0] <= 1e-9:
        return None
    ac = ac / ac[0]
    lo, hi = int(2.6 * pixels_per_m), min(n - 1, int(6.0 * pixels_per_m))
    if hi <= lo + 2:
        return None
    k = int(np.argmax(ac[lo:hi])) + lo
    return k / pixels_per_m if ac[k] >= 0.25 else None


def survey_wall(bgr: np.ndarray, seen: np.ndarray, pixels_per_m: float, *,
                modelled_height_m: float) -> WallSurvey:
    """Measure one wall's composite (rectified taller than the wall, to catch the roof)."""
    h, w = bgr.shape[:2]
    notes: list[str] = []
    top, roof_seen, highest = roofline(bgr, seen, pixels_per_m)
    found = openings(bgr, seen, pixels_per_m, below_m=top)
    rows = window_rows(found)
    storey = None
    if len(rows) >= 2:
        gaps = np.diff([a for a, _, _ in rows])
        gaps = gaps[(gaps > 2.3) & (gaps < 6.0)]
        storey = float(np.median(gaps)) if gaps.size else None
    if storey is None:
        # No window rows to measure between -- a curtain wall, ribbon glazing -- but a facade
        # still repeats once a storey: read the period of its brightness, row by row.
        storey = storey_period(bgr, seen, pixels_per_m, below_m=top)
        if storey is not None:
            notes.append("storey spacing from the facade's repeat, not from window rows")
    storeys = None
    if storey and roof_seen and top:
        storeys = max(1, round(top / storey))  # no ceiling: as many as the height holds
    elif rows and roof_seen:
        # One storey per window row, and one more for a ground floor of doors and shopfronts
        # below the first row.
        street_only = any(o.kind in ("door", "storefront") for o in found) and rows[0][0] > 2.0
        storeys = len(rows) + (1 if street_only else 0)
    floors = tuple(max(0.0, a - ASSUMED_SILL_M) for a, _, _ in rows)
    street = [o for o in found if o.v < 3.0]
    if any(o.kind == "storefront" for o in street):
        ground = "storefront"
    elif street:
        ground = "residential"
    elif seen[int(h - min(h, 3 * pixels_per_m)):].mean() > 0.5:
        ground = "blank"
    else:
        ground = "unknown"
        notes.append("the ground floor was not in view")
    if not roof_seen:
        notes.append("roofline not seen: highest point in view is a lower bound")
    wall_px = seen.sum()
    glass = glazing_mask(bgr, seen, pixels_per_m)
    glazing = float(glass.sum() / wall_px) if wall_px else 0.0
    return WallSurvey(w / pixels_per_m, modelled_height_m, highest, top, roof_seen,
                      tuple(found), tuple(rows), storey, storeys, floors, ground, glazing,
                      tuple(notes))


def combine_building(walls: list[dict], measured_height_m: float | None = None,
                     height_source: str | None = None) -> dict[str, Any]:
    """One building's summary from its walls' surveys: the photographed height where any wall
    saw its roof, the storey spacing its walls agree on, the storey count -- from the
    photographed height, or else from the building's measured (lidar or tagged) height over the
    photographed spacing -- and what its ground floor is. Nothing here has a ceiling."""
    roofs = [w["roofline_m"] for w in walls if w.get("roof_seen") and w.get("roofline_m")]
    lower = [w["visible_h"] for w in walls if w.get("visible_h")]
    storeys = [w["storeys"] for w in walls if w.get("storeys")]
    spacing = [w["storey_m"] for w in walls if w.get("storey_m")]
    grounds = [w["ground"] for w in walls if w.get("ground") not in (None, "unknown")]
    out: dict[str, Any] = {
        "photo_height_m": round(float(np.median(roofs)), 2) if roofs else None,
        "height_lower_bound_m": round(float(max(lower)), 2) if lower and not roofs else None,
        "storeys": int(np.bincount(storeys).argmax()) if storeys else None,
        "storey_m": round(float(np.median(spacing)), 2) if spacing else None,
        "ground": max(set(grounds), key=grounds.count) if grounds else "unknown",
        "walls_surveyed": len(walls),
        "openings": sum(len(w.get("openings", [])) for w in walls),
    }
    if out["storeys"] is None and out["storey_m"] and measured_height_m:
        out["storeys"] = max(1, round(measured_height_m / out["storey_m"]))
        out["storeys_from"] = f"{height_source or 'measured'} height / photographed storey spacing"
    elif out["storeys"] is not None:
        out["storeys_from"] = "photographed roofline and storey spacing"
    return out
