"""Pulling camera poses back onto the streets they were taken from.

A provider's position is a guess with a metre or several of slack in it, and the slack is not
symmetric: a camera can be wrong along the street without anyone noticing, and wrong across it
in ways that put it through a shopfront. The street network now says where the kerbs are and
how wide the right of way is, and those are hard constraints. A camera did not photograph this
street from inside the building beside it.

Two constraints, and neither invents anything:

  A frame outside the right of way is wrong, because the right of way is where the street is.
  It is pulled to the edge, not to the middle -- pulling it to the middle would assert a
  position nobody measured, while pulling it to the edge asserts only the bound that was
  violated.

  A vehicle does not zigzag. Where a sequence runs along a street, its distance from the
  centreline should vary smoothly, and a single frame jumping three metres sideways between two
  frames that did not is that frame's fix being wrong rather than the vehicle swerving.

What this deliberately does not do is look at the photographs. Matching a detected kerb in an
image against the kerb line we now hold would refine a pose far better than any prior can, and
it needs a segmentation pass that does not exist yet. Everything here is a bound or a
smoothness assumption, which is worth having and is a different and weaker thing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

#: How far outside the recorded right of way a camera may sit before it is treated as wrong.
#: Right of way is recorded as one width and taken as symmetric about the centreline, so a
#: metre of slack absorbs the asymmetry rather than blaming the camera for it.
ROW_TOLERANCE_M = 1.0
#: Frames either side used when smoothing a sequence's distance from the centreline.
SMOOTHING_WINDOW = 5
#: A lateral correction larger than this is not a GPS error being fixed; it is a frame that
#: belongs to a different street, and moving it would be worse than leaving it alone.
MAX_CORRECTION_M = 12.0
#: How closely a sequence's headings must follow the street before it counts as driven along
#: it. A walking capture looking into shopfronts should not have its heading straightened.
ALIGNED_SEQUENCE_TOLERANCE_DEG = 35.0


@dataclass(frozen=True)
class PoseFix:
    """One frame's corrected offset from the street centreline, and why it moved."""

    lateral_m: float
    corrected_m: float
    reason: str | None
    #: How well the corrected position is known across the street, one sigma.
    sigma_m: float

    @property
    def moved_m(self) -> float:
        return abs(self.corrected_m - self.lateral_m)


def clamp_to_right_of_way(lateral_m: float, right_of_way_m: float | None,
                          *, tolerance_m: float = ROW_TOLERANCE_M) -> tuple[float, str | None]:
    """Bring a camera inside the right of way, if the right of way is known and it is outside."""
    if right_of_way_m is None:
        return lateral_m, None
    limit = right_of_way_m / 2.0 + tolerance_m
    if abs(lateral_m) <= limit:
        return lateral_m, None
    if abs(lateral_m) - limit > MAX_CORRECTION_M:
        # Far outside: this frame is on another street, and the join was wrong rather than the
        # fix. Correcting it would move a good position onto a street it never saw.
        return lateral_m, "outside by more than a correction can explain"
    return math.copysign(limit, lateral_m), "outside the right of way"


def smooth_lateral(offsets: list[float], *, window: int = SMOOTHING_WINDOW) -> list[float]:
    """Median-filter a sequence's distances from the centreline.

    Median rather than mean: one frame with a badly wrong fix should be outvoted by its
    neighbours, not averaged into them.
    """
    if len(offsets) < 3:
        return list(offsets)
    half = max(1, window // 2)
    out = []
    for i in range(len(offsets)):
        low, high = max(0, i - half), min(len(offsets), i + half + 1)
        out.append(float(np.median(offsets[low:high])))
    return out


def bearing_delta_deg(a: float, b: float) -> float:
    """Smallest angle between two bearings, 0 to 180."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def sequence_follows_street(headings: list[float], street_bearing_deg: float) -> bool:
    """Whether a run of frames was driven along this street rather than pointed across it.

    Either direction counts: a camera driving south down a street laid out north is following
    it. What does not count is a capture pointed at the frontage, which is a walking survey and
    whose headings carry real information that straightening would destroy.
    """
    usable = [h for h in headings if h is not None]
    if len(usable) < 3:
        return False
    aligned = sum(
        1 for h in usable
        if min(bearing_delta_deg(h, street_bearing_deg),
               bearing_delta_deg(h, (street_bearing_deg + 180.0) % 360.0))
        <= ALIGNED_SEQUENCE_TOLERANCE_DEG
    )
    return aligned / len(usable) >= 0.7


def refine_sequence(
    offsets: list[float],
    right_of_way_m: list[float | None],
    *,
    smooth: bool,
) -> list[PoseFix]:
    """Correct one run of frames along one street.

    Bounds first, then smoothing: a frame pulled inside the right of way should take part in
    its neighbours' median rather than dragging it outward from where it never was.
    """
    bounded, reasons = [], []
    for lateral, row in zip(offsets, right_of_way_m, strict=True):
        value, reason = clamp_to_right_of_way(lateral, row)
        bounded.append(value)
        reasons.append(reason)

    smoothed = smooth_lateral(bounded) if smooth else bounded
    out = []
    for original, corrected, reason in zip(offsets, smoothed, reasons, strict=True):
        moved = abs(corrected - original)
        if reason is None and moved > 0.05:
            reason = "smoothed against its neighbours"
        # The correction is not free information. A position that had to be moved two metres
        # was two metres wrong, and is not suddenly known to a centimetre afterwards -- the
        # residual uncertainty is at least the size of the move.
        out.append(PoseFix(lateral_m=original, corrected_m=corrected, reason=reason,
                           sigma_m=max(0.5, moved)))
    return out
