"""Which scans belong in the world: §A4's filter, geometric where metadata cannot be trusted.

Titles lie and most captures are untitled, so the tests are on the geometry:

* **extent** -- after the up axis is found, a scan under ``MOVABLE_MAX_M`` across is an object
  someone could carry off (a chair, a statue on a plinth, a skull on a bench);
* **enclosure** -- rays cast straight up from the scan's footprint: a room is closed above over
  most of it, an exterior is open to the sky. This separates "inside of a room" from "outside of
  a building" better than anything in the metadata;
* a closed-above scan up to ``ROOM_MAX_M`` across is a single room; larger and closed above is an
  interior space (a hall, a station concourse) -- kept, and marked as an interior.

Per the operator's decision (docs/24, 2026-09-29) a home someone published under a free licence
is kept and placed on that home; residential scans are therefore not dropped here, only tagged.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MOVABLE_MAX_M = 3.0
ROOM_MAX_M = 10.0
BUILDING_MIN_HEIGHT_M = 4.0
CLOSED_ABOVE_SHARE = 0.6


@dataclass(frozen=True)
class Verdict:
    kind: str        # exterior | interior_space | single_room | movable_object | unreadable
    keep: bool
    extent_m: tuple[float, float, float]
    closed_above: float
    up_axis: str
    reason: str

    def to_json(self) -> dict:
        return {"kind": self.kind, "keep": self.keep,
                "extent_m": [round(v, 2) for v in self.extent_m],
                "closed_above": round(self.closed_above, 3), "up_axis": self.up_axis,
                "reason": self.reason}


def up_axis(points: np.ndarray) -> int:
    """For files that do not say (OBJ, PLY): the up axis is the one whose lowest slice holds the
    most of the scan -- the ground under an exterior, the floor of a room, each the largest
    level surface in a capture. Ties go to z, the scanners' convention."""
    shares = []
    for axis in range(3):
        values = points[:, axis]
        span = float(np.ptp(values))
        shares.append(float(np.mean(values <= values.min() + 0.03 * span)) if span else 0.0)
    best = int(np.argmax(shares))
    return 2 if shares[2] >= 0.9 * shares[best] else best


def enclosure(points: np.ndarray, up: int, cell: float = 0.25) -> float:
    """Share of the footprint's cells with something overhead above head height."""
    plan_axes = [a for a in range(3) if a != up]
    xy = points[:, plan_axes]
    z = points[:, up]
    floor = float(np.percentile(z, 2))
    keys = np.floor((xy - xy.min(axis=0)) / cell).astype(np.int64)
    ids = keys[:, 0] * 1_000_003 + keys[:, 1]
    occupied = np.unique(ids)
    overhead = np.unique(ids[z > floor + 2.0])
    return float(len(overhead) / max(len(occupied), 1))


def classify(points: np.ndarray, scale_to_m: float = 1.0, up: int | None = None) -> Verdict:
    """``up`` is the file's own up axis where its format fixes one (glTF: y; LAS: z)."""
    pts = np.asarray(points, dtype=np.float64) * scale_to_m
    if len(pts) < 50:
        return Verdict("unreadable", False, (0.0, 0.0, 0.0), 0.0, "?", "too few points")
    up = up_axis(pts) if up is None else up
    plan_axes = [a for a in range(3) if a != up]
    extent = np.ptp(pts, axis=0)
    width = float(max(extent[plan_axes]))
    height = float(extent[up])
    closed = enclosure(pts, up)
    dims = (float(extent[plan_axes[0]]), float(extent[plan_axes[1]]), height)
    axis_name = "xyz"[up]
    if width < MOVABLE_MAX_M and height < MOVABLE_MAX_M:
        return Verdict("movable_object", False, dims, closed, axis_name,
                       f"under {MOVABLE_MAX_M} m in every direction: an object, not a place")
    if closed >= CLOSED_ABOVE_SHARE:
        if width <= ROOM_MAX_M:
            return Verdict("single_room", False, dims, closed, axis_name,
                           "closed above and room-sized: the inside of one room")
        return Verdict("interior_space", True, dims, closed, axis_name,
                       "closed above and larger than a room: an interior space")
    if height < BUILDING_MIN_HEIGHT_M and width < ROOM_MAX_M:
        return Verdict("movable_object", False, dims, closed, axis_name,
                       "open above, low and small: street furniture or an object")
    return Verdict("exterior", True, dims, closed, axis_name, "open above: an exterior")
