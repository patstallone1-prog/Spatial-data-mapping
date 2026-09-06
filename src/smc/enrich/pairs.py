"""Which photographs can be used together, and what for.

The catalogue holds 386,624 frames and treats each as a thing on its own. Most of what they are
worth is in the relationships: two frames two metres apart triangulate, two frames eight years
apart show what changed, and two frames from different providers corroborate each other in a
way two frames from one drive never can.

The measure that matters for geometry is not the distance between the cameras. It is the angle
they subtend at whatever they are both looking at. Two cameras two metres apart are excellent
for a shopfront eight metres away and nearly useless for a tower four hundred metres off, and
the same pair is either depending on the subject. So the subject distance is estimated from the
street's own cross-section -- which the official geometry now gives us -- and the parallax
computed from that.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

#: Below this the two views are the same view and triangulate nothing.
MIN_PARALLAX_DEG = 4.0
#: Above this the two views look different enough that feature matching starts to fail before
#: the geometry gets any better.
MAX_PARALLAX_DEG = 32.0
#: Where the parallax is ideal: far enough apart to fix a depth, near enough to still match.
BEST_PARALLAX_DEG = 14.0
#: What a street-level camera is usually looking at, when the street's own geometry cannot say.
DEFAULT_SUBJECT_DISTANCE_M = 12.0
#: Two frames further apart along the street than this share too little to pair.
MAX_STATION_GAP_M = 25.0
#: How many neighbours one frame is compared against. Downtown a twenty-five metre window can
#: hold thousands of frames, and the nearest few dozen contain every pair worth having.
MAX_CANDIDATES = 60


@dataclass(frozen=True)
class Frame:
    """The little of an observation this needs: where it is, where it looks, and when."""

    uid: str
    provider: str
    x: float
    y: float
    heading_deg: float | None
    captured_at: float | None
    spherical: bool
    station_m: float
    subject_distance_m: float


def subject_distance(camera_offset_m: float | None,
                     carriageway_m: float | None,
                     sidewalk_m: float | None) -> float:
    """How far the thing being photographed probably is, across the street.

    A street-level camera is mostly looking at the frontage on one side or the other. The near
    facade stands at half a carriageway plus a footway from the centreline, so the distance to
    it is that, less however far off the centreline the camera itself was standing.

    Where the street's cross-section is unknown this falls back to twelve metres, which is a
    typical San Francisco frontage-to-kerb-to-camera distance and is at least honest about
    being a default.
    """
    if carriageway_m is None:
        return DEFAULT_SUBJECT_DISTANCE_M
    facade_offset = carriageway_m / 2.0 + (sidewalk_m if sidewalk_m else 3.0)
    distance = facade_offset - abs(camera_offset_m or 0.0)
    # A camera standing beyond the facade line, or on top of it, has no sensible subject
    # distance -- that is a placement error, not a very close building.
    return distance if 2.0 <= distance <= 60.0 else DEFAULT_SUBJECT_DISTANCE_M


def parallax_deg(baseline_m: float, distance_m: float) -> float:
    """Angle two cameras subtend at their subject."""
    if distance_m <= 0:
        return 0.0
    return math.degrees(2.0 * math.atan(baseline_m / (2.0 * distance_m)))


def parallax_quality(angle_deg: float) -> float:
    """How good that angle is for fixing a depth, 0 to 1.

    Zero below four degrees and above thirty-two: too small and the rays are parallel, too
    large and the two images no longer look like the same wall. It peaks in between rather than
    rising forever, which is the thing a raw baseline gets wrong.
    """
    if not (MIN_PARALLAX_DEG <= angle_deg <= MAX_PARALLAX_DEG):
        return 0.0
    if angle_deg <= BEST_PARALLAX_DEG:
        span = BEST_PARALLAX_DEG - MIN_PARALLAX_DEG
        return (angle_deg - MIN_PARALLAX_DEG) / span
    span = MAX_PARALLAX_DEG - BEST_PARALLAX_DEG
    return (MAX_PARALLAX_DEG - angle_deg) / span


def view_overlap(a: Frame, b: Frame) -> float:
    """Whether the two frames can be looking at the same thing at all, 0 to 1.

    A panorama sees in every direction, so it always can. Two perspective cameras pointing
    ninety degrees apart cannot, however close together they are -- and a baseline computed
    between them describes a pair that shares no pixels.
    """
    if a.spherical or b.spherical:
        return 1.0
    if a.heading_deg is None or b.heading_deg is None:
        return 0.0
    delta = abs((a.heading_deg - b.heading_deg + 180.0) % 360.0 - 180.0)
    if delta >= 90.0:
        return 0.0
    return math.cos(math.radians(delta))


def baseline_m(a: Frame, b: Frame) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


@dataclass(frozen=True)
class Pair:
    other_uid: str
    baseline_m: float
    parallax_deg: float
    overlap: float
    geometry_score: float
    days_apart: float | None
    cross_provider: bool


def evaluate(a: Frame, b: Frame) -> Pair | None:
    """Score one candidate pairing, or None when the two cannot be used together."""
    overlap = view_overlap(a, b)
    if overlap <= 0.0:
        return None
    distance = min(a.subject_distance_m, b.subject_distance_m)
    base = baseline_m(a, b)
    if base < 0.15:
        return None                      # the same frame twice, or two cameras on one rig
    angle = parallax_deg(base, distance)
    days = (abs(a.captured_at - b.captured_at) / 86400.0
            if a.captured_at is not None and b.captured_at is not None else None)
    return Pair(
        other_uid=b.uid,
        baseline_m=base,
        parallax_deg=angle,
        overlap=overlap,
        geometry_score=parallax_quality(angle) * overlap,
        days_apart=days,
        cross_provider=a.provider != b.provider,
    )


def best_pairs(frame: Frame, candidates: list[Frame]) -> dict:
    """The most useful partners for one frame, by what each is useful *for*.

    Three different questions, three different answers. The best pair for geometry wants a
    parallax in the usable band. The best pair for corroboration wants a different provider,
    because two frames from one drive share whatever was wrong with that drive. The best pair
    for change wants the largest gap in time from nearly the same place, which is the opposite
    of what geometry wants.
    """
    scored = [p for p in (evaluate(frame, other) for other in candidates) if p is not None]
    if not scored:
        return {"n_candidates": 0}

    usable = [p for p in scored if p.geometry_score > 0]
    geometry = max(usable, key=lambda p: p.geometry_score, default=None)
    cross = max((p for p in usable if p.cross_provider),
                key=lambda p: p.geometry_score, default=None)
    temporal = max((p for p in scored if p.days_apart is not None and p.baseline_m < 15.0),
                   key=lambda p: p.days_apart, default=None)

    return {
        "n_candidates": len(scored),
        "n_usable_geometry": len(usable),
        "n_baseline_1_to_3m": sum(1 for p in scored if 1.0 <= p.baseline_m <= 3.0),
        "geometry_uid": geometry.other_uid if geometry else None,
        "geometry_baseline_m": round(geometry.baseline_m, 3) if geometry else None,
        "geometry_parallax_deg": round(geometry.parallax_deg, 2) if geometry else None,
        "geometry_score": round(geometry.geometry_score, 4) if geometry else None,
        "cross_provider_uid": cross.other_uid if cross else None,
        "cross_provider_baseline_m": round(cross.baseline_m, 3) if cross else None,
        "temporal_uid": temporal.other_uid if temporal else None,
        "temporal_days": round(temporal.days_apart, 1) if temporal else None,
        "temporal_distance_m": round(temporal.baseline_m, 2) if temporal else None,
    }
