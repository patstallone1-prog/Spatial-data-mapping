"""What to photograph next, by what is missing rather than by how many photographs exist.

The catalogue's capture policy was a density target: aim for about a dozen eligible frames in
each H3 cell and treat a cell that has them as done. It is the obvious policy and it is wrong in
both directions at once. A block face with forty frames that all face the buildings has no
photograph of its kerb and the target calls it finished; a face with four frames that see the
kerb from two angles with a metre of baseline between them is measurable and the target calls it
starved.

Counting frames measures effort. What matters is whether the kerb along a given block face can
be measured, and the marginal value of one more photograph is how much closer a well-chosen one
would get us. On a face that is already measurable that is nearly zero however few frames it
has, and on a face that has never seen its own kerb it stays high however many.

Readiness is deliberately multiplicative. Measuring a kerb needs a view of it, a second view to
triangulate against, and a trustworthy position for both; missing any one of those cannot be
made up by a surplus of the others, and an arithmetic mean would let it. A geometric mean gives
the answer a surveyor would: the weakest necessary ingredient sets the result.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

#: What a block face needs before its kerb can be measured, and how much each counts. These
#: multiply rather than add.
READINESS = {
    "kerb_view": 0.34,
    "geometry": 0.26,
    "pose": 0.18,
    "along": 0.14,
    "angles": 0.08,
}

#: Longest run of a block face with no photograph looking at it before the face counts as
#: gappy. Twelve metres is about three parking spaces -- a kerb cut can hide in less.
STATION_GAP_M = 12.0

#: A frame contributes to the "seen from several angles" term only if it actually sees the kerb.
#: Diversity among frames that are all looking at the sky is not diversity.
ANGLE_MIN_KERB = 0.10

#: The floor no term is allowed below, so that one missing ingredient drives readiness towards
#: zero without taking the arithmetic with it.
FLOOR = 1e-3


@dataclass
class FaceEvidence:
    """Everything known about one side of one block, from the frames standing on it."""

    segment_id: str
    side: int
    street_name: str | None = None
    length_m: float = 0.0
    frames: int = 0
    #: The best few looks at the kerb, best first. One good look is worth far more than the
    #: twentieth mediocre one, so only the top handful are combined.
    kerb_views: tuple[float, ...] = ()
    best_geometry: float = 0.0
    best_pose: float = 0.0
    has_metric: bool = False
    #: Stations, in metres along the segment, of the frames that actually see the kerb.
    kerb_stations: tuple[float, ...] = ()
    #: Headings of those same frames, in degrees.
    kerb_headings: tuple[float, ...] = ()


def _combine_views(views: tuple[float, ...], take: int = 3) -> float:
    """How well the kerb is seen, from the best few looks at it.

    Independent-looking rather than additive: three frames that each half-see the kerb are
    better than one, but not three times better, and a hundred of them are not better than four.
    """
    best = sorted(views, reverse=True)[:take]
    if not best:
        return 0.0
    missed = 1.0
    for view in best:
        missed *= (1.0 - min(0.98, max(0.0, view)))
    return 1.0 - missed


def _along_cover(stations: tuple[float, ...], length_m: float) -> float:
    """Whether the looks are spread along the face or piled up at one end.

    Forty frames taken from a single parked car cover one point of a ninety metre block. The
    measure is the longest unphotographed run, because that is what a missing kerb cut hides in.
    """
    if length_m <= 0:
        return 0.0
    if not stations:
        return 0.0
    marks = sorted(set(round(s, 1) for s in stations))
    gaps = [marks[0], max(0.0, length_m - marks[-1])]
    gaps += [b - a for a, b in zip(marks, marks[1:])]
    worst = max(gaps)
    return max(0.0, min(1.0, 1.0 - (worst - STATION_GAP_M) / max(length_m, 1.0))) \
        if worst > STATION_GAP_M else 1.0


def _angle_cover(headings: tuple[float, ...]) -> float:
    """Distinct 45-degree sectors the kerb has been seen from, out of the three that help.

    Not eight: a kerb is a line, and looking at it from behind is not a new view of it. Three
    sectors -- ahead, across, behind -- is what a walk down one side of a street produces.
    """
    if not headings:
        return 0.0
    sectors = {int(h % 360 // 45) for h in headings}
    return min(1.0, len(sectors) / 3.0)


def readiness_terms(face: FaceEvidence) -> dict[str, float]:
    return {
        "kerb_view": _combine_views(face.kerb_views),
        "geometry": face.best_geometry,
        "pose": face.best_pose,
        "along": _along_cover(face.kerb_stations, face.length_m),
        "angles": _angle_cover(face.kerb_headings),
    }


def readiness(terms: dict[str, float]) -> float:
    """Weighted geometric mean: the weakest necessary ingredient sets the answer."""
    total = 0.0
    for name, weight in READINESS.items():
        total += weight * math.log(max(FLOOR, min(1.0, terms.get(name, 0.0))))
    return math.exp(total)


def with_ideal_frame(face: FaceEvidence, terms: dict[str, float]) -> dict[str, float]:
    """The same face after one more well-chosen photograph.

    Well-chosen means aimed at whatever is missing: it looks at the kerb, it stands where the
    longest gap is, it faces a sector nothing has faced, and it brings a partner at a usable
    baseline. It is one frame, so it cannot fix everything -- the point of the exercise is that
    on a face which already has what it needs, this changes almost nothing.
    """
    improved = dict(terms)
    improved["kerb_view"] = _combine_views(face.kerb_views + (0.55,))
    improved["geometry"] = max(terms["geometry"], 0.62)
    improved["pose"] = max(terms["pose"], 0.55)
    if face.length_m > 0:
        gap_fill = face.kerb_stations + (_worst_gap_midpoint(face),)
        improved["along"] = _along_cover(gap_fill, face.length_m)
    improved["angles"] = _angle_cover(face.kerb_headings + (_missing_sector(face),))
    return improved


def _worst_gap_midpoint(face: FaceEvidence) -> float:
    marks = sorted(set(face.kerb_stations))
    if not marks:
        return face.length_m / 2.0
    best_at, best_gap = face.length_m / 2.0, 0.0
    edges = [(0.0, marks[0]), (marks[-1], face.length_m)] + list(zip(marks, marks[1:]))
    for a, b in edges:
        if b - a > best_gap:
            best_gap, best_at = b - a, (a + b) / 2.0
    return best_at


def _missing_sector(face: FaceEvidence) -> float:
    seen = {int(h % 360 // 45) for h in face.kerb_headings}
    for sector in range(8):
        if sector not in seen:
            return sector * 45.0 + 22.5
    return 22.5


def marginal_value(face: FaceEvidence) -> tuple[float, float, str]:
    """Readiness now, the gain from one more good frame, and what that frame is for."""
    terms = readiness_terms(face)
    now = readiness(terms)
    after = readiness(with_ideal_frame(face, terms))
    gain = max(0.0, after - now)
    # What the next frame is for: the term whose own improvement would move readiness most.
    need = "kerb_view"
    best = -1.0
    for name in READINESS:
        trial = dict(terms)
        trial[name] = with_ideal_frame(face, terms)[name]
        lift = readiness(trial) - now
        if lift > best:
            best, need = lift, name
    if face.frames == 0:
        need = "no photograph at all"
    return now, gain, need
