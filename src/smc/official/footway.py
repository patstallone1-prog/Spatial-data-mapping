"""Bounding a measured footway by where the footway is legally allowed to be.

Our aerial-lidar footway widths run half a metre wide of San Francisco's own survey on average,
and the average is not the interesting part: the median error is only a quarter of a metre while
the mean is more than twice that, because a sixth of the measurements are wrong by more than two
metres in one direction. Where the city says 3.35 m we say 6.46 m.

The cause is not noise. The measurement finds the flat walkable ground beside the kerb and
follows it as far as it stays flat -- and beside a plaza, a forecourt or a setback lobby, that
keeps going well past the property line. The lidar is measuring exactly what it was asked to;
the question was wrong.

A footway runs from the kerb to the edge of the right of way. Both of those are now recorded:
the kerb as mapped linework, the right of way as a dimension in feet and inches off a named
sheet. So the measurement can be bounded by them -- not corrected to them, bounded by them,
which is a different and weaker claim that happens to be the true one.
"""

from __future__ import annotations

from dataclasses import dataclass

#: A right of way is recorded as a single width, so the property line is taken as half of it
#: either side of the centreline. Real streets are not always symmetric about their centreline
#: -- a widening on one side is not shared with the other -- so this is a bound with a tolerance
#: rather than a measurement, and the tolerance is generous on purpose.
ASYMMETRY_ALLOWANCE_M = 1.0
#: Below this the bound is not believable: it would put the kerb within a metre and a half of
#: the property line, which is not a street cross-section. It usually means the right of way is
#: not symmetric about its centreline on this block, and the whole bound rests on assuming that
#: it is -- so the safe reading is that neither record can police the other here. Clipping is
#: destructive and a bound resting on an assumption should decline rather than guess.
MIN_PLAUSIBLE_FOOTWAY_M = 1.5


@dataclass(frozen=True)
class Bounded:
    """One footway measurement, with the bound that applies to it."""

    measured_m: float
    bound_m: float | None
    """How wide the footway could be here at most, from the kerb to the right-of-way edge."""
    bounded_m: float
    """The measurement, clipped. Equal to ``measured_m`` where no bound applies."""
    clipped: bool
    reason: str | None


def bound_footway(
    measured_m: float,
    *,
    right_of_way_m: float | None,
    curb_offset_m: float | None,
    allowance_m: float = ASYMMETRY_ALLOWANCE_M,
) -> Bounded:
    """Clip a measured footway to the width the right of way leaves for it.

    ``curb_offset_m`` is how far the kerb sits from the street centreline on this side, which
    the curb-line profile measures directly. What is left between that and the edge of the right
    of way is all the footway there can be.

    A measurement inside the bound is returned untouched. Widening one to meet the bound would
    be inventing pavement, and the fact that a footway measures narrower than the law allows is
    ordinary -- a planting strip, a building line set back, a kerb that was rebuilt inboard.
    """
    if right_of_way_m is None or curb_offset_m is None:
        return Bounded(measured_m, None, measured_m, False, "no bound available")

    bound = right_of_way_m / 2.0 - abs(curb_offset_m) + allowance_m
    if bound < MIN_PLAUSIBLE_FOOTWAY_M:
        # The kerb sits at or past the recorded property line. One of the two records is wrong
        # about this block and neither can be used to bound the other.
        return Bounded(measured_m, bound, measured_m, False, "kerb at or past the row edge")
    if measured_m <= bound:
        return Bounded(measured_m, bound, measured_m, False, None)
    return Bounded(measured_m, bound, bound, True, "measurement ran past the row edge")
