"""Is a crossing painted? Read off the aerial photograph with three answers, never a guess.

A test bench only: nothing here changes a lane or a crossing the page draws. It reads the
photograph (smc.imagery.ortho, NOAA's 0.25 m mosaic in San Francisco and the East Bay) along a
mapped crossing and answers ``paint``, ``no_paint`` or ``unknown``:

* **The pattern.** San Francisco's continental crosswalk is bars two feet wide two feet apart,
  across the walk: along the crossing the brightness rises and falls with a period of about
  1.2 m (about five pixels at 0.25 m -- readable). The plain style is two 12-inch lines along
  the edges of the walk (a pixel wide here -- marginal), looked for as bright ridges at the
  walk's edges.
* **Quality gates.** Pixels under canopy (near-infrared vegetation index), in shadow (dark),
  blown out (saturated) or with no valid source are counted; a crossing with too many of them
  is ``unknown``. A photograph coarser than ``MAX_GSD_M`` is ``unknown`` throughout -- NAIP's
  0.6 m cannot show either style.
* **Geometry gates.** Bars must stand across the whole walk: the profiles of its two halves
  must agree (``MIN_HALF_AGREEMENT``), and the period must be a crosswalk's.
* **No paint** only when nothing bright stands anywhere in the walk or along its edges and the
  road there is clean, unshaded asphalt.
* **Asphalt gate.** The photograph is an ordinary orthophoto, not a true one: downtown, a tall
  building leans over the street and its roof covers the crossing. A walk whose surface is not
  asphalt-grey (``ROAD_LUMA``) is ``unknown`` -- a white roof read as clean road was most of the
  first run's wrong "no paint" answers.
* **Yellow.** School crossings are yellow continental bars: paint is read in the red-and-green
  channel, where white and yellow paint are both bright and asphalt is not.

Scores are kept so the thresholds can be set for precision on a tuning half and measured on
the other (scripts/test_paint_crosswalks.py).
"""

from __future__ import annotations

import math

import numpy as np

#: Sampling of the walk: a decimetre-ish grid, finer than the photograph.
STEP_M = 0.125
#: Half the walk's width looked in for bars, and out to where edge lines would be.
BAR_HALF_M = 1.2
EDGE_IN_M, EDGE_OUT_M = 1.0, 2.4
#: The crosswalk bar period: SF continental is 2 ft + 2 ft (1.22 m); others 0.9-1.6 m.
PERIOD_M = (0.9, 1.6)
MAX_GSD_M = 0.35
#: Gates: shares of the walk's pixels.
MAX_CANOPY_SHARE = 0.15
MAX_SHADOW_SHARE = 0.35
MAX_GLARE_SHARE = 0.25
SHADOW_LUMA = 55.0
GLARE_LUMA = 250.0
NDVI_CANOPY = 0.25
MIN_HALF_AGREEMENT = 0.5
#: The road under a crossing, in the paint channel (its 30th percentile): asphalt and concrete,
#: not a roof's white membrane nor a shadowed facade.
ROAD_LUMA = (45.0, 205.0)
#: Paint is bright: its 95th percentile in the paint channel.
MIN_PAINT_LUMA = 150.0
#: A road bare of paint has nothing periodic in it either.
MAX_BARE_PERIOD_SHARE = 0.2


def _luma(rgb: np.ndarray) -> np.ndarray:
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]


def _paint_channel(rgb: np.ndarray) -> np.ndarray:
    """Red and green: white paint and yellow paint both bright, grey asphalt not."""
    return 0.5 * (rgb[0] + rgb[1])


def sample_walk(img: dict, a_utm: tuple[float, float], b_utm: tuple[float, float], half_m: float) -> dict | None:
    """The photograph resampled on the walk's own grid: rows across (-half..half), columns along
    the crossing from a to b (kerb to kerb, a metre short of each)."""
    from scipy.ndimage import map_coordinates

    ax, ay = a_utm
    bx, by = b_utm
    length = math.hypot(bx - ax, by - ay)
    if length < 3.0:
        return None
    ux, uy = (bx - ax) / length, (by - ay) / length
    vx, vy = -uy, ux
    along = np.arange(1.0, length - 1.0, STEP_M)
    across = np.arange(-half_m, half_m + STEP_M / 2, STEP_M)
    A, B = np.meshgrid(along, across)
    X = ax + A * ux + B * vx
    Y = ay + A * uy + B * vy
    w, _s, _, n = img["bounds"]
    px = img["pixel_m"]
    cols = (X - w) / px
    rows = (n - Y) / px
    coords = np.array([rows.ravel(), cols.ravel()])
    rgb = np.stack([map_coordinates(img["rgb"][k].astype(np.float32), coords, order=1).reshape(A.shape) for k in range(3)])
    valid = map_coordinates(img["valid"].astype(np.float32), coords, order=0).reshape(A.shape) > 0.5
    nir = None if img.get("nir") is None else map_coordinates(img["nir"].astype(np.float32), coords, order=1).reshape(A.shape)
    return {"rgb": rgb, "nir": nir, "valid": valid, "along": along, "across": across, "length_m": length}


def _period_score(profile: np.ndarray) -> tuple[float, float]:
    """How much of the profile's variation is at a crosswalk's period: (share of power, period m)."""
    x = profile - profile.mean()
    if len(x) < 16 or not np.any(x):
        return 0.0, 0.0
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), d=STEP_M)
    band = (freqs >= 1 / PERIOD_M[1]) & (freqs <= 1 / PERIOD_M[0])
    total = spec[1:].sum()
    if total <= 0 or not band.any():
        return 0.0, 0.0
    k = int(np.argmax(np.where(band, spec, 0)))
    return float(spec[band].sum() / total), float(1 / freqs[k]) if freqs[k] > 0 else 0.0


def crossing_paint(img: dict, a_utm: tuple[float, float], b_utm: tuple[float, float], *,
                   paint_score: float = 0.35, no_paint_contrast: float = 25.0) -> dict:
    """``paint`` | ``no_paint`` | ``unknown`` for the crossing from a to b, with its scores."""
    if img is None or img.get("gsd_m", 1.0) > MAX_GSD_M:
        return {"answer": "unknown", "why": "photograph too coarse"}
    walk = sample_walk(img, a_utm, b_utm, EDGE_OUT_M)
    if walk is None:
        return {"answer": "unknown", "why": "crossing too short"}
    across = walk["across"]
    luma = _paint_channel(walk["rgb"])
    inner = np.abs(across) <= BAR_HALF_M
    edges = (np.abs(across) >= EDGE_IN_M) & (np.abs(across) <= EDGE_OUT_M)
    valid = walk["valid"]
    if valid[inner].mean() < 0.9:
        return {"answer": "unknown", "why": "outside the photograph"}
    zone = luma[inner]
    shadow = float((zone < SHADOW_LUMA).mean())
    glare = float((zone >= GLARE_LUMA).mean())
    canopy = 0.0
    if walk["nir"] is not None:
        red = walk["rgb"][0][inner]
        nir = walk["nir"][inner]
        ndvi = (nir - red) / np.maximum(nir + red, 1.0)
        canopy = float((ndvi > NDVI_CANOPY).mean())
    scores = {"shadow": round(shadow, 3), "glare": round(glare, 3), "canopy": round(canopy, 3)}
    if canopy > MAX_CANOPY_SHARE:
        return {"answer": "unknown", "why": "under canopy", **scores}
    if shadow > MAX_SHADOW_SHARE:
        return {"answer": "unknown", "why": "in shadow", **scores}
    if glare > MAX_GLARE_SHARE:
        return {"answer": "unknown", "why": "glare", **scores}
    # Bars: the profile along the walk, and its two halves across agreeing.
    half_a = luma[(across >= -BAR_HALF_M) & (across < 0)].mean(axis=0)
    half_b = luma[(across > 0) & (across <= BAR_HALF_M)].mean(axis=0)
    profile = zone.mean(axis=0)
    share, period = _period_score(profile)
    agree = float(np.corrcoef(half_a - half_a.mean(), half_b - half_b.mean())[0, 1]) if half_a.std() > 0 and half_b.std() > 0 else 0.0
    road = float(np.percentile(zone, 30))
    bright = float(np.percentile(zone, 95))
    contrast = bright - road
    if not ROAD_LUMA[0] <= road <= ROAD_LUMA[1]:
        return {"answer": "unknown", "why": "not road surface", **scores, "road_luma": round(road, 1)}
    # Edge lines: a bright ridge running along the walk at either edge, in most of its length.
    ridge = 0.0
    for sign in (-1, 1):
        rows = np.where((np.sign(across) == sign) & edges)[0]
        if rows.size:
            band = luma[rows]
            peak = band.max(axis=0)
            ridge = max(ridge, float((peak - road > 40).mean()))
    scores.update({"period_share": round(share, 3), "period_m": round(period, 2), "half_agreement": round(agree, 3),
                   "contrast": round(contrast, 1), "edge_ridge": round(ridge, 3), "road_luma": round(road, 1)})
    scores["bright"] = round(bright, 1)
    if share >= paint_score and agree >= MIN_HALF_AGREEMENT and contrast >= 40 and bright >= MIN_PAINT_LUMA:
        return {"answer": "paint", "style": "continental", **scores}
    if ridge >= 0.7 and contrast < 40:
        return {"answer": "paint", "style": "lines", **scores}
    if contrast <= no_paint_contrast and ridge < 0.2 and shadow < 0.05 and share < MAX_BARE_PERIOD_SHARE:
        return {"answer": "no_paint", **scores}
    return {"answer": "unknown", "why": "not clear either way", **scores}
