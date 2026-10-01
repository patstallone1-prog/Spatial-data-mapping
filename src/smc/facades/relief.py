"""How far each part of a wall stands out of, or sits back into, its plane: a plane sweep.

The facade survey rectifies every view onto the wall's plane. A bay window standing 0.65 m out
of that plane is then in a different place in each view -- the views disagree about it -- and
agree about it on the plane 0.65 m out instead. So the same views are rectified onto a stack
of planes parallel to the wall, and every patch of the wall takes the offset at which its views
agree best. That offset, per patch, is the facade's measured relief against the existing wall
plane: exactly the ``(u, v, offset, weight)`` samples
:func:`smc.geometry.building.elements_from_residual` turns into bay windows, recesses and
cornices, and whose shallow remainder becomes texture.

Weights are honest about what a street photograph can do: a patch the views barely prefer one
offset for, or with no texture to match on (a blank render), gets little or none.
"""

from __future__ import annotations

import dataclasses

import cv2
import numpy as np

from smc.facades.geometry import Camera, Wall
from smc.facades.rectify import rectify_wall

#: Offsets swept, metres along the wall's outward normal (positive stands out of the wall).
OFFSETS = np.round(np.arange(-0.4, 0.81, 0.1), 2)
PATCH_M = 0.4
MIN_TEXTURE = 0.012
MIN_VIEWS = 2
#: A 10 cm change of plane has to move a wall point by at least this many pixels between the
#: views, or the sweep cannot tell 10 cm apart and is not run. The resolution is chosen to
#: meet it, up to MAX_PIXELS_PER_M.
MIN_SHIFT_PX = 1.0
MIN_PIXELS_PER_M = 8.0
MAX_PIXELS_PER_M = 40.0
#: Most of a real wall reads at one offset -- its plane. Where that is not zero the footprint's
#: edge is not where the facade is, and the offset is kept as the wall's measured position
#: (``plane_offset_m``); the relief is measured from it. A median at the sweep's ends is the
#: facade lying outside the range, and relief whose offsets spread wider than MAX_SPREAD_M
#: measured the poses, not the wall.
MAX_PLANE_SHIFT_M = 0.35
MAX_SPREAD_M = 0.25
#: Only confident samples are returned for elements to be made from.
MIN_WEIGHT = 0.35


def resolution_for(views: list[tuple[np.ndarray, Camera]], wall: Wall) -> float | None:
    """Pixels per metre at which a 10 cm plane shift moves the wall by MIN_SHIFT_PX between the
    most widely separated pair of views, or None if no resolution up to MAX_PIXELS_PER_M does.

    Moving the plane by d along its normal moves where a camera's ray meets it by d tan(theta),
    theta the ray's angle from the normal; two cameras disagree by d |tan a - tan b|."""
    mx, my = wall.midpoint
    nx, ny = wall.normal
    tx, ty = -ny, nx
    tans = []
    for _image, camera in views:
        dx, dy = mx - camera.x, my - camera.y
        standoff = abs(dx * nx + dy * ny)
        if standoff < 1e-6:
            continue
        tans.append((dx * tx + dy * ty) / standoff)
    if len(tans) < MIN_VIEWS:
        return None
    spread = max(tans) - min(tans)
    if spread <= 1e-6:
        return None
    ppm = MIN_SHIFT_PX / (0.1 * spread)
    if ppm > MAX_PIXELS_PER_M:
        return None
    return max(MIN_PIXELS_PER_M, ppm)


def _normalised_grey(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    if mask.any():
        mu, sd = grey[mask].mean(), grey[mask].std()
        grey = (grey - mu) / max(sd, 1e-3)
    return grey


#: The sweep holds a cost for every offset at every pixel, so a long or tall wall at the
#: resolution relief needs (up to 40 px/m) would hold gigabytes. It is swept in vertical strips
#: of at most this many pixels, overlapping by a patch so no strip edge falls inside a patch,
#: and the whole wall's checks are made on the strips joined back together.
TILE_PIXELS = 1_500_000
#: And a wall is swept from the ground up to at most this many pixels in all: at the resolution
#: 10 cm needs, a tower's full face is tens of millions, for a measurement that street views
#: of a tower's upper floors rarely support. What was swept is returned with the samples, so
#: the relief is a measurement of that part of the wall and says so.
WALL_PIXELS = 3_000_000


def _sweep_strip(views: list[tuple[np.ndarray, Camera]], wall: Wall, ppm: float,
                 patch_px: int) -> tuple[np.ndarray, np.ndarray, np.ndarray] | str:
    """Best offset, its weight and whether any offset was measurable, per pixel of one strip
    of wall -- or the reason there is nothing."""
    nx, ny = wall.normal
    costs = []
    ref0 = None
    shape = None
    for d in OFFSETS:
        shifted = dataclasses.replace(wall, a=(wall.a[0] + nx * d, wall.a[1] + ny * d),
                                      b=(wall.b[0] + nx * d, wall.b[1] + ny * d))
        stack, masks = [], []
        for image, camera in views:
            view = rectify_wall(image, camera, shifted, pixels_per_m=ppm, exact=True)
            if view is None:
                continue
            if shape is None:
                shape = view.mask.shape
            if view.mask.shape != shape:
                continue
            stack.append(_normalised_grey(view.image, view.mask))
            masks.append(view.mask)
        if len(stack) < MIN_VIEWS:
            return "fewer than two views hold the shifted plane"
        # Cost: one minus the patch-wise zero-mean normalised cross-correlation of every view
        # with the first (the most square-on), averaged. NCC ignores the gain and offset of
        # brightness between views -- the exposure and the angle of the light change as the
        # camera moves round the wall -- which a plain variance across views does not.
        k = (patch_px, patch_px)
        ref, ref_mask = stack[0], masks[0].astype(np.float32)
        mu_r = cv2.blur(ref, k)
        var_r = cv2.blur(ref * ref, k) - mu_r * mu_r
        score_sum = np.zeros(ref.shape, np.float32)
        total = np.zeros(ref.shape, np.float32)
        for other, other_mask in zip(stack[1:], masks[1:], strict=True):
            both = ref_mask * other_mask.astype(np.float32)
            mu_o = cv2.blur(other, k)
            var_o = cv2.blur(other * other, k) - mu_o * mu_o
            cov = cv2.blur(ref * other, k) - mu_r * mu_o
            ncc = cov / np.sqrt(np.maximum(var_r * var_o, 1e-9))
            good = cv2.blur(both, k) > 0.9
            score_sum += np.where(good, ncc, 0.0).astype(np.float32)
            total += good
        ncc_mean = score_sum / np.maximum(total, 1e-6)
        costs.append(np.where(total >= 1, 1.0 - ncc_mean, np.inf).astype(np.float32))
        if abs(d) < 1e-9:
            ref0 = ref
    cost = np.stack(costs)                     # (offsets, h, w)
    best = np.argmin(cost, axis=0)
    rows, cols = np.indices(best.shape)
    c0 = cost[best, rows, cols]
    ok = np.isfinite(c0)
    # Sub-step refinement: a parabola through the best offset and its neighbours.
    left = cost[np.clip(best - 1, 0, len(OFFSETS) - 1), rows, cols]
    right = cost[np.clip(best + 1, 0, len(OFFSETS) - 1), rows, cols]
    denom = left - 2 * c0 + right
    with np.errstate(invalid="ignore", divide="ignore"):
        shift = np.where(np.isfinite(denom) & (denom > 1e-9), 0.5 * (left - right) / denom, 0.0)
    step_m = float(OFFSETS[1] - OFFSETS[0])
    offset = OFFSETS[best] + np.clip(shift, -0.5, 0.5) * step_m
    # Weight: how decisively the best offset beat the rest, and whether there was texture.
    # The median over the offsets that could be scored -- only where at least one could, so a
    # pixel no offset saw is simply undecided rather than a warning per pixel.
    finite = np.isfinite(cost)
    seen = finite.any(axis=0)
    typical = np.full(c0.shape, np.nan, dtype=np.float32)
    typical[seen] = np.nanmedian(np.where(finite, cost, np.nan)[:, seen], axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        decisive = np.clip((typical - c0) / np.maximum(typical, 1e-6), 0.0, 1.0)
    gy, gx = np.gradient(ref0 / 8.0)
    texture = cv2.blur(np.hypot(gx, gy), (patch_px, patch_px))
    weight = np.where(ok & (texture > MIN_TEXTURE), np.nan_to_num(decisive), 0.0)
    return offset.astype(np.float32), weight.astype(np.float32), ok


def _strip(wall: Wall, u0: float, u1: float) -> Wall:
    """The part of ``wall`` between u0 and u1 metres along it."""
    (ax, ay), (bx, by) = wall.a, wall.b
    length = wall.length_m
    t0, t1 = u0 / length, u1 / length
    return dataclasses.replace(wall, a=(ax + (bx - ax) * t0, ay + (by - ay) * t0),
                               b=(ax + (bx - ax) * t1, ay + (by - ay) * t1))


def sweep(views: list[tuple[np.ndarray, Camera]], wall: Wall,
          tile_pixels: int = TILE_PIXELS) -> tuple[np.ndarray | None, str]:
    """``(u, v, offset_m, weight)`` samples over the wall, one per patch with a verdict.

    ``views`` are the images and posed cameras that already passed the survey's gates for this
    wall. Returns the samples, or None with the reason no relief could be measured.
    """
    if len(views) < MIN_VIEWS:
        return None, "fewer than two views from one reconstruction"
    ppm = resolution_for(views, wall)
    if ppm is None:
        return None, "the views are too close together to resolve 10 cm"
    patch_px = max(3, int(PATCH_M * ppm) | 1)
    width_px = max(1, round(wall.length_m * ppm))
    swept_m = min(wall.height_m, WALL_PIXELS / width_px / ppm)
    if swept_m < 2.0:
        return None, "the wall is too long to sweep at the resolution 10 cm needs"
    wall = dataclasses.replace(wall, height_m=swept_m)
    height_px = max(1, round(wall.height_m * ppm))
    strip_px = max(4 * patch_px, tile_pixels // height_px)
    pad = patch_px
    offsets, weights, oks = [], [], []
    for c0 in range(0, width_px, strip_px):
        c1 = min(width_px, c0 + strip_px)
        a, b = max(0, c0 - pad), min(width_px, c1 + pad)
        part = _sweep_strip(views, _strip(wall, a / ppm, b / ppm), ppm, patch_px)
        if isinstance(part, str):
            return None, part
        offset, weight, ok = (arr[:, c0 - a:c0 - a + (c1 - c0)] for arr in part)
        offsets.append(offset)
        weights.append(weight)
        oks.append(ok)
    offset = np.concatenate(offsets, axis=1)
    weight = np.concatenate(weights, axis=1)
    h = offset.shape[0]
    confident = weight >= MIN_WEIGHT
    if confident.sum() < 50:
        return None, "too few patches with a confident offset"
    # The self-check: the wall's own plane must come out near zero.
    median = float(np.median(offset[confident]))
    spread = float(1.4826 * np.median(np.abs(offset[confident] - median)))
    if spread > MAX_SPREAD_M:
        return None, "the offsets scatter too widely to be relief"
    if abs(median) > MAX_PLANE_SHIFT_M:
        return None, "the facade lies outside the swept range of the footprint's wall"
    # One sample per patch, not per pixel: neighbouring pixels share a patch's verdict.
    step = patch_px
    grid = np.zeros_like(confident)
    grid[step // 2::step, step // 2::step] = True
    keep = confident & grid
    rows, cols = np.nonzero(keep)
    u = (cols + 0.5) / ppm
    v = (h - rows - 0.5) / ppm
    samples = np.column_stack([u, v, offset[keep] - median, weight[keep]]).astype(np.float32)
    return samples, f"measured to {swept_m:.1f} m; plane_offset_m={median:.3f}"


def choose_for_relief(candidates: list[tuple[Camera, str | None]], wall: Wall,
                      limit: int = 5) -> list[int]:
    """Indices of the candidate views to sweep: from the one reconstruction whose views look at
    the wall from the widest spread of angles, the two extremes and the most square-on between.

    The survey chooses views that face the wall squarely, which are exactly the views with the
    least parallax between them; depth comes from views that see it from either side."""
    mx, my = wall.midpoint
    nx, ny = wall.normal
    tx, ty = -ny, nx
    groups: dict[str, list[tuple[float, int]]] = {}
    for index, (camera, component) in enumerate(candidates):
        if component is None:
            continue
        dx, dy = mx - camera.x, my - camera.y
        standoff = abs(dx * nx + dy * ny)
        if standoff < 1e-6:
            continue
        groups.setdefault(component, []).append(((dx * tx + dy * ty) / standoff, index))
    best: list[int] = []
    best_spread = 0.0
    for members in groups.values():
        if len(members) < MIN_VIEWS:
            continue
        members.sort()
        spread = members[-1][0] - members[0][0]
        if spread > best_spread:
            picks = [members[0][1], members[-1][1]]
            middle = sorted(members, key=lambda m: abs(m[0]))
            for _t, index in middle:
                if index not in picks and len(picks) < limit:
                    picks.append(index)
            best, best_spread = picks, spread
    return best
