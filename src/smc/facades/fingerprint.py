"""Measure a facade fingerprint from a rectified wall patch.

The patch is the wall seen square-on at a known scale (smc.facades.rectify), with a mask of
the pixels that are the wall. Everything here is a plain statistic over those pixels; nothing
is learned, so the numbers mean the same thing for every building and for every render in
the catalogue (smc.facades.match).
"""

from __future__ import annotations

import numpy as np

from smc.facades.match import Fingerprint

#: A wall sampled from fewer pixels than this is a smear of whatever is beside it.
MIN_WALL_PIXELS = 400


def _rgb_to_hls(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Hue in degrees, lightness and saturation, per pixel, from RGB in 0..1."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    light = (mx + mn) / 2.0
    delta = mx - mn
    sat = np.where(delta <= 1e-6, 0.0,
                   delta / np.maximum(1e-6, 1.0 - np.abs(2.0 * light - 1.0)))
    hue = np.zeros_like(light)
    nz = delta > 1e-6
    rr = np.where(nz, (mx - r) / np.maximum(delta, 1e-6), 0.0)
    gg = np.where(nz, (mx - g) / np.maximum(delta, 1e-6), 0.0)
    bb = np.where(nz, (mx - b) / np.maximum(delta, 1e-6), 0.0)
    hue = np.where(mx == r, bb - gg, np.where(mx == g, 2.0 + rr - bb, 4.0 + gg - rr))
    hue = (hue / 6.0) % 1.0 * 360.0
    return np.where(nz, hue, 0.0), light, np.clip(sat, 0.0, 1.0)


def _period_per_m(profile: np.ndarray, pixels_per_m: float) -> float | None:
    """How many repeats per metre a 1-D lightness profile shows, from its autocorrelation.

    The first clear peak of the autocorrelation past the trivial one is the period; a wall
    without a repeat (a blank flank, a curtain wall of even glass) has none.
    """
    n = len(profile)
    if n < int(pixels_per_m * 4):
        return None
    x = profile - profile.mean()
    if np.abs(x).max() < 1e-6:
        return None
    ac = np.correlate(x, x, mode="full")[n - 1:]
    ac /= max(ac[0], 1e-9)
    lo = max(2, int(pixels_per_m * 2.2))       # no storey is shorter than this, nor a bay
    hi = min(n - 1, int(pixels_per_m * 8.0))   # or every eight metres
    if hi <= lo + 2:
        return None
    window = ac[lo:hi]
    k = int(np.argmax(window)) + lo
    if window.max() < 0.25:
        return None
    return pixels_per_m / k


def fingerprint_patch(patch_bgr: np.ndarray, mask: np.ndarray, pixels_per_m: float) -> Fingerprint | None:
    """One view's fingerprint, or None when too little of the wall is in it."""
    if mask.sum() < MIN_WALL_PIXELS:
        return None
    rgb = patch_bgr[..., ::-1].astype(np.float64) / 255.0
    _hue, light, sat = _rgb_to_hls(rgb)
    wall = mask.astype(bool)
    median = np.median(rgb[wall].reshape(-1, 3), axis=0)
    mh, ml, ms = _rgb_to_hls(median[None, None, :])
    # Glazing: darker than the wall by a margin, or blue-grey and reflective.
    blue_grey = (rgb[..., 2] > rgb[..., 0] + 0.04) & (sat < 0.35)
    dark = light < np.clip(ml - 0.18, 0.08, 0.5)
    glazing = float(((dark | blue_grey) & wall).sum() / wall.sum())
    # Texture: the render between the windows, not the windows' edges -- the median gradient
    # of lightness over the wall's own pixels. Stucco is near zero; brick and siding are not.
    gy, gx = np.gradient(light)
    grad = np.hypot(gx, gy)
    render = wall & ~(dark | blue_grey)
    texture = float(np.clip(np.median(grad[render if render.sum() > 50 else wall]) * 6.0, 0.0, 1.0))
    sd = float(np.clip(light[wall].std(), 0.0, 1.0))
    # Storey and bay rhythm from the masked lightness profiles.
    masked = np.where(wall, light, 0.0)
    row_n = wall.sum(axis=1)
    col_n = wall.sum(axis=0)
    rows = (masked.sum(axis=1) / np.maximum(row_n, 1))[row_n > 0]
    cols = (masked.sum(axis=0) / np.maximum(col_n, 1))[col_n > 0]
    return Fingerprint(
        lightness=float(ml.ravel()[0]), saturation=float(ms.ravel()[0]), hue=float(mh.ravel()[0]),
        glazing=glazing, texture=texture, sd=sd,
        storeys_per_m=_period_per_m(rows, pixels_per_m) if rows.size else None,
        bays_per_m=_period_per_m(cols, pixels_per_m) if cols.size else None,
    )


def combine(views: list[Fingerprint]) -> Fingerprint | None:
    """Several views of one building into one fingerprint: medians, so one bad view -- a
    parked van, a shadow -- does not carry."""
    if not views:
        return None
    def med(name: str) -> float:
        return float(np.median([getattr(v, name) for v in views]))
    def med_opt(name: str) -> float | None:
        vals = [getattr(v, name) for v in views if getattr(v, name) is not None]
        return float(np.median(vals)) if vals else None
    hues = np.radians([v.hue for v in views])
    hue = float(np.degrees(np.arctan2(np.sin(hues).mean(), np.cos(hues).mean())) % 360.0)
    return Fingerprint(med("lightness"), med("saturation"), hue, med("glazing"), med("texture"),
                       med("sd"), med_opt("storeys_per_m"), med_opt("bays_per_m"), len(views))
