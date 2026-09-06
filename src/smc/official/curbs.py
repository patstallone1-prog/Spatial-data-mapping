"""Curb-to-curb width, measured across the city's own curb lines.

Everything upstream of this measured a street by taking a centreline and pushing half a width
out on either side. That is wrong in a specific and visible way: a street is not one width. It
narrows at a bulb-out, widens at a turning pocket, and opens out entirely at an intersection,
and a constant offset draws none of it.

San Francisco maps the curbs themselves. Given the two curb faces of a block and the centreline
between them, the width at any point along the street is just the distance from one to the
other -- so this samples along the street and reads it off, producing a profile rather than a
number.

Two properties of the source drive the shape of the code. Fifty-six per cent of curb lines carry
no side-of-street value and seventeen per cent carry no CNN, so neither can be relied on: the
side is worked out geometrically instead, from which hand of the centreline the line falls on.
And the lines are sparse -- five vertices for a thirty-metre block face is typical -- so they
have to be resampled before they can be read at a station, or the profile inherits the vertex
spacing rather than the shape of the kerb.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from smc.official.join import project_to_polyline

#: How often the width is read along a street. Two metres is finer than a bulb-out and coarser
#: than the noise in a hand-digitised curb line.
STATION_STEP_M = 2.0
#: How far either side of a station a curb vertex may sit and still describe it.
STATION_WINDOW_M = 3.0
#: Resampling interval along a curb line before it is binned.
DENSIFY_STEP_M = 1.0
#: A curb further than this from the centreline belongs to a different street.
MAX_OFFSET_M = 40.0
#: Narrower than this and the two "faces" are the same line found twice.
MIN_WIDTH_M = 2.5
MAX_WIDTH_M = 60.0


def curb_role(curb_type: str | None) -> str:
    """What a curb line is: a block face, a traffic island, or something else.

    The type codes matter because only block faces bound a carriageway. An island's curb sits
    in the middle of the road, and pairing one against a block face measures the distance from
    the kerb to the median -- a real number, and not the width of the street.
    """
    code = (curb_type or "").strip().upper()
    if code.startswith("ISL"):
        return "island"
    if code.startswith("BLK"):
        return "block"
    if code.startswith("NBLK"):
        return "non_block"
    return "other"


def densify(points: list[tuple[float, float]],
            step_m: float = DENSIFY_STEP_M) -> list[tuple[float, float]]:
    """Resample a polyline in local metres so vertices are no further apart than ``step_m``."""
    if len(points) < 2:
        return list(points)
    out: list[tuple[float, float]] = [points[0]]
    for a, b in zip(points, points[1:]):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length <= 1e-9:
            continue
        steps = max(1, int(math.ceil(length / step_m)))
        for i in range(1, steps + 1):
            t = i / steps
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


@dataclass(frozen=True)
class Sample:
    """The street's cross-section at one station along a segment."""

    station_m: float
    left_offset_m: float | None
    right_offset_m: float | None
    n_left: int
    n_right: int

    @property
    def width_m(self) -> float | None:
        if self.left_offset_m is None or self.right_offset_m is None:
            return None
        width = self.left_offset_m + self.right_offset_m
        return width if MIN_WIDTH_M <= width <= MAX_WIDTH_M else None


def offsets_along(centreline: np.ndarray,
                  points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Curb points as ``(station, signed offset)`` against a centreline, both in metres.

    Offset is positive to the left of the direction of travel, matching the sign convention the
    rest of the codebase uses for sides of a street.
    """
    out = []
    for x, y in points:
        distance, station, side = project_to_polyline(centreline, x, y)
        if distance > MAX_OFFSET_M:
            continue
        out.append((station, distance * side))
    return out


def width_profile(
    centreline: np.ndarray,
    left_points: list[tuple[float, float]],
    right_points: list[tuple[float, float]],
    *,
    step_m: float = STATION_STEP_M,
    window_m: float = STATION_WINDOW_M,
) -> list[Sample]:
    """Sample the carriageway width along a segment.

    At each station the curb points within a window are gathered and their offsets reduced by
    median. The median is doing real work: a curb line clipped at an intersection leaves a few
    points trailing off at a wild offset, and a mean would carry them into the answer.
    """
    length = float(np.linalg.norm(np.diff(centreline, axis=0), axis=1).sum())
    if length < step_m:
        return []
    left = offsets_along(centreline, left_points)
    right = offsets_along(centreline, right_points)

    samples: list[Sample] = []
    station = 0.0
    while station <= length:
        near_left = [abs(o) for s, o in left if abs(s - station) <= window_m and o > 0]
        near_right = [abs(o) for s, o in right if abs(s - station) <= window_m and o < 0]
        samples.append(Sample(
            station_m=round(station, 2),
            left_offset_m=float(np.median(near_left)) if near_left else None,
            right_offset_m=float(np.median(near_right)) if near_right else None,
            n_left=len(near_left),
            n_right=len(near_right),
        ))
        station += step_m
    return samples


def summarise(samples: list[Sample]) -> dict:
    """The profile reduced to numbers worth storing beside a street.

    ``width_p10`` and ``width_p90`` are the point of this: a street whose tenth and ninetieth
    percentile widths differ by three metres has a bulb-out or a turning pocket in it, and that
    is exactly the variation a single width was throwing away.
    """
    widths = sorted(s.width_m for s in samples if s.width_m is not None)
    if not widths:
        return {"n": 0}
    n = len(widths)
    return {
        "n": n,
        "median_m": round(widths[n // 2], 3),
        "min_m": round(widths[0], 3),
        "max_m": round(widths[-1], 3),
        "p10_m": round(widths[int(n * 0.1)], 3),
        "p90_m": round(widths[int(n * 0.9)], 3),
        "coverage": round(n / max(1, len(samples)), 3),
    }
