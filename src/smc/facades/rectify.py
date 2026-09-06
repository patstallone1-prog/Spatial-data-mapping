"""Lift one wall out of the photographs, square on.

The wall is a plane in the world and we know where it is; the camera is a pose and a lens and
we know those too. So rather than warping a quadrilateral -- which is only right for a pinhole
and is wrong everywhere on a panorama -- every output pixel is turned back into a point on the
wall, projected, and sampled. That is exact for both camera models and costs one numpy grid.

One photograph is almost never enough. A car-mounted camera eight metres from a shopfront with
a seventy degree lens sees eleven metres of frontage and under four metres of height: not one
storey of a building whose wall is sixteen metres long. So a wall is composed from several
frames, and every pixel takes the median of the views that could see it. That is what makes an
orthophoto of a facade, and it is also what removes the parked van -- present in one frame,
absent in the next three, and outvoted.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass

import cv2
import numpy as np

from smc.facades.geometry import Camera, Wall, project

#: Output resolution. Fifty pixels to the metre puts a window mullion on two or three pixels,
#: which is about as fine as street-level imagery of a facade twenty metres away can support.
PIXELS_PER_M = 50.0
# A texture is shipped to every visitor of the map and stored in every clone of the repository
# forever, so it is sized for a building seen from the street rather than for inspection. Six
# hundred and forty pixels across a fifteen-metre frontage is forty to the metre, which is
# finer than the imagery supports at twenty metres anyway.
MAX_EDGE_PX = 640
MIN_EDGE_PX = 48


@dataclass(frozen=True)
class View:
    """One photograph's contribution to a wall. ``image`` is BGR, row zero at the top."""

    image: np.ndarray
    mask: np.ndarray
    weight: float

    @property
    def coverage(self) -> float:
        return float(self.mask.mean())


@dataclass(frozen=True)
class Composite:
    image: np.ndarray
    mask: np.ndarray
    views: int
    coverage: float
    visible_height_m: float
    agreement: float
    """How closely the surviving views agree, 0 to 1.

    This is the only check available on whether the geometry was right. Nothing in the
    catalogue records a camera's pitch -- it is present on 1,215 frames out of 273,277 -- so a
    dashcam tilted fifteen degrees down is indistinguishable, from its metadata, from one held
    level, and rectifying a wall out of it samples the roadway instead. What gives it away is
    that two photographs taken from different places then disagree completely, where two
    photographs of the same brickwork agree closely. Agreement is therefore a measurement of
    whether we found the wall, and it costs nothing but the views we already fetched.
    """
    rejected: int = 0


def output_size(wall: Wall, pixels_per_m: float = PIXELS_PER_M) -> tuple[int, int]:
    return (
        int(np.clip(round(wall.length_m * pixels_per_m), MIN_EDGE_PX, MAX_EDGE_PX)),
        int(np.clip(round(wall.height_m * pixels_per_m), MIN_EDGE_PX, MAX_EDGE_PX)),
    )


def _grid(wall: Wall, out_w: int, out_h: int) -> np.ndarray:
    ax, ay = wall.a
    bx, by = wall.b
    s = (np.arange(out_w, dtype=np.float64) + 0.5) / out_w
    # Row zero is the top of the wall, which is how an image is stored and how a texture is
    # sampled; getting this upside down produces buildings standing on their cornices.
    t = 1.0 - (np.arange(out_h, dtype=np.float64) + 0.5) / out_h
    ss, tt = np.meshgrid(s, t)
    x = ax + (bx - ax) * ss
    y = ay + (by - ay) * ss
    z = tt * wall.height_m
    return np.stack([x.ravel(), y.ravel(), z.ravel()], axis=1)


def rectify_wall(
    image: np.ndarray,
    camera: Camera,
    wall: Wall,
    *,
    weight: float = 1.0,
    pixels_per_m: float = PIXELS_PER_M,
) -> View | None:
    """Sample ``wall`` out of one ``image``, or None if it lands nowhere."""
    if wall.length_m <= 0 or wall.height_m <= 0:
        return None
    out_w, out_h = output_size(wall, pixels_per_m)

    points = _grid(wall, out_w, out_h)
    u, v, valid = project(camera, points)

    source = image
    if camera.spherical:
        inside = u[valid]
        # A wall behind the camera straddles the seam at the back of the panorama: half its
        # columns come out near zero and half near the full width. Sampling that directly
        # sweeps the whole image sideways and returns a streak of the entire street. Rolling
        # the panorama half a turn puts the seam behind the camera instead.
        if inside.size and (inside.max() - inside.min()) > camera.width * 0.5:
            shift = camera.width // 2
            source = np.roll(image, shift, axis=1)
            u = np.mod(u + shift, camera.width)

    if not valid.any():
        return None
    map_x = np.where(valid, u, -1.0).astype(np.float32).reshape(out_h, out_w)
    map_y = np.where(valid, v, -1.0).astype(np.float32).reshape(out_h, out_w)
    out = cv2.remap(
        source, map_x, map_y, interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0),
    )
    return View(image=out, mask=valid.reshape(out_h, out_w), weight=weight)


#: How far a view may be nudged to line up with the others, as a fraction of the wall. Frames
#: sit three to eight metres from where their GPS says, and two frames wrong in opposite
#: directions put the same window two metres apart on the wall. Past a fifth of the wall the
#: match is more likely a different window than the same one.
MAX_ALIGN_FRACTION = 0.2


def _grey(view: "View") -> np.ndarray:
    """A view as float32 luma, with the unseen parts set to its own mean.

    Zeroing them instead would put a hard edge at the mask boundary, and phase correlation
    would happily lock onto that edge rather than onto the building.
    """
    grey = cv2.cvtColor(view.image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    if view.mask.any():
        grey[~view.mask] = float(grey[view.mask].mean())
    return grey


def align(views: list["View"]) -> list["View"]:
    """Shift each view onto the best-placed one before merging them.

    Rectification puts every view on the same plane, so what is left between them is very
    nearly a translation -- and it is not small. A GPS fix good to five metres moves a facade
    five metres sideways, which at fifty pixels to the metre is a quarter of a wall. Taking the
    median of that does not remove the error, it averages it, and the result is the smeared
    double-exposure that a facade built from raw poses actually looks like.
    """
    if len(views) < 2:
        return views
    order = sorted(range(len(views)), key=lambda i: -views[i].weight)
    reference = _grey(views[order[0]])
    window = cv2.createHanningWindow((reference.shape[1], reference.shape[0]), cv2.CV_32F)
    limit = MAX_ALIGN_FRACTION * reference.shape[1]

    out = [views[order[0]]]
    for i in order[1:]:
        view = views[i]
        (dx, dy), response = cv2.phaseCorrelate(_grey(view), reference, window)
        if response < 0.05 or math.hypot(dx, dy) > limit:
            out.append(view)          # nothing trustworthy to shift by; leave it where it is
            continue
        matrix = np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]], dtype=np.float32)
        size = (view.image.shape[1], view.image.shape[0])
        shifted = cv2.warpAffine(view.image, matrix, size, flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
        moved_mask = cv2.warpAffine(view.mask.astype(np.uint8), matrix, size,
                                    flags=cv2.INTER_NEAREST, borderValue=0).astype(bool)
        out.append(View(image=shifted, mask=moved_mask, weight=view.weight))
    return out


#: A view whose pixels sit further than this from the consensus, on a 0-255 scale, is not
#: looking at the same thing as the others. Forty is a long way: two photographs of one wall in
#: different light differ by perhaps fifteen, while a photograph of the road differs by eighty.
MAX_RESIDUAL = 40.0


def _residuals(stack, masks, reference) -> np.ndarray:
    out = np.zeros(len(stack), dtype=np.float32)
    for i in range(len(stack)):
        overlap = masks[i] & np.isfinite(reference[..., 0])
        if overlap.sum() < 32:
            out[i] = np.inf
            continue
        out[i] = float(np.abs(stack[i][overlap] - reference[overlap]).mean())
    return out


def compose(views: list[View], wall: Wall, *, reject: bool = True) -> Composite | None:
    """Merge several views of one wall into a single orthophoto.

    Where three or more frames saw a pixel, the median wins: that is what throws out the van,
    the wheelie bin and the passing cyclist, none of which are in the same place twice. Where
    only one or two did, the better-placed frame wins, because a median of two is a blend and a
    blend of two viewpoints of the same brickwork is a blur.

    With three or more views the consensus is also used to throw out whole frames: any view
    that disagrees with the others is a frame whose pose was wrong, and keeping it would smear
    a picture of the roadway across the building.
    """
    usable = align([v for v in views if v.mask.any()])
    if reject and len(usable) >= 3:
        stack = np.stack([v.image.astype(np.float32) for v in usable])
        masks = np.stack([v.mask for v in usable])
        blocked = np.where(masks[..., None], stack, np.nan)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            consensus = np.nanmedian(blocked, axis=0)
        residual = _residuals(stack, masks, consensus)
        kept = [v for v, r in zip(usable, residual) if r <= MAX_RESIDUAL]
        # Never reject everything: if no view agrees with the consensus there is no consensus,
        # and the wall should fail the agreement gate rather than silently keep one frame.
        if len(kept) >= 2:
            usable = kept
    if not usable:
        return None
    out_h, out_w = usable[0].image.shape[:2]
    stack = np.stack([v.image.astype(np.float32) for v in usable])
    masks = np.stack([v.mask for v in usable])
    weights = np.array([v.weight for v in usable], dtype=np.float32)

    count = masks.sum(axis=0)
    result = np.zeros((out_h, out_w, 3), dtype=np.float32)

    many = count >= 3
    if many.any():
        blocked = np.where(masks[..., None], stack, np.nan)
        with warnings.catch_warnings():
            # Columns no view saw are all-NaN by construction; they are masked out below.
            warnings.simplefilter("ignore", RuntimeWarning)
            median = np.nanmedian(blocked, axis=0)
        result[many] = median[many]

    few = (count >= 1) & ~many
    if few.any():
        # Highest-weight frame that actually saw each pixel.
        ranked = np.argsort(-weights)
        chosen = np.full((out_h, out_w), -1, dtype=np.int32)
        for i in ranked:
            take = few & (chosen < 0) & masks[i]
            chosen[take] = i
        for i in range(len(usable)):
            take = chosen == i
            if take.any():
                result[take] = stack[i][take]

    mask = count >= 1
    coverage = float(mask.mean())
    if coverage <= 0.0:
        return None

    if len(usable) >= 2:
        blocked = np.where(masks[..., None], stack, np.nan)
        spread = float(np.nanmean(np.abs(blocked - result[None, ...])[~np.isnan(blocked)]))
        agreement = max(0.0, 1.0 - spread / 96.0)
    else:
        # A single view agrees with itself, which tells us nothing. Say so rather than
        # flattering it with a perfect score.
        agreement = 0.0

    # How far up the wall survived. Counting from the pavement, the last row that is mostly
    # inside some photograph is the top of what was actually seen; above that is nothing.
    rows_complete = mask.mean(axis=1) > 0.90
    visible_rows = 0
    for row in range(out_h - 1, -1, -1):
        if not rows_complete[row]:
            break
        visible_rows += 1

    return Composite(
        image=np.clip(result, 0, 255).astype(np.uint8),
        mask=mask,
        views=len(usable),
        coverage=coverage,
        visible_height_m=wall.height_m * visible_rows / out_h,
        agreement=agreement,
        rejected=len([v for v in views if v.mask.any()]) - len(usable),
    )


def fill_gaps(composite: Composite, wall: Wall) -> np.ndarray:
    """Wash whatever no camera saw in the colour of what they did.

    Every alternative is worse. Leaving it black makes a real facade look burnt; continuing the
    window pattern upwards invents storeys that may not exist. A flat wash reads as a building
    whose upper floors we have not photographed, which is exactly what it is. Small holes --
    the gap between two frames, a column the mask missed -- are closed by inpainting instead,
    since those are genuinely surrounded by the wall they belong to.
    """
    out = composite.image.copy()
    holes = (~composite.mask).astype(np.uint8)
    if not holes.any():
        return out

    height = out.shape[0]
    seen_rows = int(round(height * composite.visible_height_m / max(wall.height_m, 1e-6)))
    if 0 < seen_rows < height:
        band = out[height - seen_rows: height - seen_rows + max(1, seen_rows // 6)]
        seen = composite.mask[height - seen_rows: height - seen_rows + max(1, seen_rows // 6)]
        sample = band[seen] if seen.any() else band.reshape(-1, 3)
        if sample.size:
            out[: height - seen_rows] = sample.mean(axis=0).astype(out.dtype)
        holes[: height - seen_rows] = 0

    if holes.any():
        out = cv2.inpaint(out, holes, 4, cv2.INPAINT_TELEA)
    return out
