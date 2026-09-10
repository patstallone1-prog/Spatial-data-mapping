"""Where the courts are, how they lie, and how many fit.

OpenStreetMap maps a sports pitch as a polygon with a ``sport`` tag. What it does not
consistently map is how many courts are inside that polygon: sometimes every tennis court is its
own way, and sometimes a whole fenced block of six is a single one. Drawing one court per polygon
gets Alice Marble wrong in the first case and in the second.

So the count is measured rather than assumed. A pitch polygon has an orientation and two
dimensions -- the smallest rectangle that contains it -- and a court has a regulation size. The
number of courts in a pitch is how many regulation courts fit in that rectangle, which is a
division. Everything drawn afterwards hangs off the same rectangle: the courts run along the
pitch's own long axis, at the pitch's own bearing, at the size the sport is actually played at.

Dimensions below are the playing surface and the surround, both in metres, from the governing
bodies: ITF for tennis, FIBA for basketball, USA Pickleball, FIVB for volleyball. The surround is
what sets the spacing between adjacent courts, because that is what sets it in life.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Sport:
    key: str
    #: The playing surface: the outside of the outermost line.
    play_l: float
    play_w: float
    #: The pad a single court occupies including its run-off, which is what sets the pitch of a
    #: row of courts.
    pad_l: float
    pad_w: float
    #: Courts of this sport come in blocks; a field does not.
    tiles: bool = True
    #: Ball sports played to a fence are fenced; a field is not.
    fenced: bool = True
    #: The smallest ground this game is actually played on. Defaults to the regulation court cut
    #: by MIN_FIT, but a five-a-side pitch is a fraction of a full one and is still a pitch.
    min_l: float = 0.0
    min_w: float = 0.0


SPORTS: dict[str, Sport] = {
    # ITF: 23.77 x 10.97 doubles, with 6.40 behind each baseline and 3.66 either side.
    "tennis": Sport("tennis", 23.77, 10.97, 34.75, 17.07),
    # FIBA 28 x 15; American outdoor courts are commonly the NBA 28.65 x 15.24.
    "basketball": Sport("basketball", 28.65, 15.24, 32.0, 19.0),
    # Most of what a city tags `sport=basketball` is one hoop on a schoolyard slab, not a full
    # court. Drawing those as full courts would put a second key and a halfway line on ground
    # that has neither, so a half court is its own thing with its own markings.
    "basketball_half": Sport("basketball_half", 15.24, 15.24, 17.0, 17.0),
    # Smaller again: a hoop on a slab in a schoolyard, nine metres square. It is a real place
    # people shoot at a real basket, and it has no lines on it, so it gets none.
    "basketball_hoop": Sport("basketball_hoop", 24.0, 14.0, 24.0, 14.0, tiles=False,
                             min_l=4.5, min_w=3.0),
    # USA Pickleball: 44 x 20 feet of court in a 64 x 34 foot minimum.
    "pickleball": Sport("pickleball", 13.41, 6.10, 19.51, 10.36),
    # FIVB 18 x 9 with a 3 m free zone.
    "volleyball": Sport("volleyball", 18.0, 9.0, 24.0, 15.0),
    # A field is fitted to the ground it is on rather than tiled into it, and it is not fenced.
    # The minimum is a small-sided pitch, because most of the soccer played in this corridor is
    # played on one.
    "soccer": Sport("soccer", 100.0, 64.0, 106.0, 70.0, tiles=False, fenced=False,
                    min_l=20.0, min_w=11.0),
}

#: What to draw when the polygon is too small for the real thing. A slab that will not hold a
#: full basketball court will hold a half court, and one too small even for that still has a
#: basket on it. Each step down is a smaller claim about what is there, never a larger one.
FALLBACK = {"basketball": "basketball_half", "basketball_half": "basketball_hoop"}

#: What the ``sport`` tag says, mapped onto what we can draw. OpenStreetMap uses semicolons for
#: a court that is lined for more than one game; the first one we recognise wins, because that is
#: the one the surface is coloured for.
SPORT_ALIASES = {
    "tennis": "tennis",
    "basketball": "basketball",
    "pickleball": "pickleball",
    "volleyball": "volleyball",
    "beachvolleyball": "volleyball",
    "soccer": "soccer",
    "football": "soccer",
    "multi": "basketball",
}

#: A pitch this much smaller than one regulation court is not that sport's court. Playgrounds and
#: schoolyards carry a `sport` tag over a patch far too small to be the game, and drawing a full
#: tennis court on a twelve metre square is worse than drawing nothing.
MIN_FIT = 0.62

#: The strip of surface left between a court's outermost line and the edge of its slab. Outdoor
#: courts in a city are built tight -- this is the paint's own margin, not a run-off zone -- but
#: it must not be nothing, or the sideline sits exactly on the fence line.
RUN_OFF_M = 0.8


def resolve_sport(tag: str | None) -> str | None:
    if not tag:
        return None
    for part in str(tag).replace(",", ";").split(";"):
        key = part.strip().lower().replace("_", "").replace(" ", "")
        if key in SPORT_ALIASES:
            return SPORT_ALIASES[key]
    return None


def _hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Andrew's monotone chain. The oriented rectangle only depends on the hull."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def half(seq):
        out: list[tuple[float, float]] = []
        for p in seq:
            while len(out) >= 2:
                (ax, ay), (bx, by) = out[-2], out[-1]
                if (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) > 0:
                    break
                out.pop()
            out.append(p)
        return out

    return half(pts)[:-1] + half(reversed(pts))[:-1]


@dataclass(frozen=True)
class Rect:
    cx: float
    cy: float
    #: Bearing of the long axis, radians, in the local metric frame.
    angle: float
    length: float
    width: float


def oriented_rect(points: list[tuple[float, float]]) -> Rect | None:
    """The smallest-area rectangle containing a ring, in the frame the points are given in.

    Rotating calipers by way of the standard result that a minimum-area enclosing rectangle has
    one side flush with an edge of the convex hull -- so trying every hull edge is exact, not an
    approximation, and a pitch hull has a dozen edges.
    """
    hull = _hull([(float(x), float(y)) for x, y in points])
    if len(hull) < 3:
        return None
    best: Rect | None = None
    best_area = float("inf")
    for i in range(len(hull)):
        ax, ay = hull[i]
        bx, by = hull[(i + 1) % len(hull)]
        edge = math.hypot(bx - ax, by - ay)
        if edge < 1e-9:
            continue
        ux, uy = (bx - ax) / edge, (by - ay) / edge
        vx, vy = -uy, ux
        us = [(px - ax) * ux + (py - ay) * uy for px, py in hull]
        vs = [(px - ax) * vx + (py - ay) * vy for px, py in hull]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        area = (u1 - u0) * (v1 - v0)
        if area >= best_area:
            continue
        best_area = area
        mu, mv = (u0 + u1) / 2, (v0 + v1) / 2
        cx, cy = ax + ux * mu + vx * mv, ay + uy * mu + vy * mv
        du, dv = u1 - u0, v1 - v0
        if du >= dv:
            best = Rect(cx, cy, math.atan2(uy, ux), du, dv)
        else:
            best = Rect(cx, cy, math.atan2(uy, ux) + math.pi / 2, dv, du)
    return best


def layout_courts(sport: str, rect: Rect) -> list[tuple[str, Rect]]:
    """The courts inside one pitch polygon: where each sits, and which way it faces.

    A block of tennis courts is laid out the way it is built -- side by side across the short
    axis, end to end along the long one -- so the count is the rectangle divided by the pad and
    the positions follow from it. Where the pitch holds only one court the pad does not apply and
    the court is simply centred, because a lone court is usually mapped tight to its own fence.

    Each court comes back with the kind of court it is, which is not always the kind of pitch it
    was tagged: a basketball polygon too short for a full court is a half court.
    """
    spec = SPORTS.get(sport)
    if spec is None:
        return []
    min_l = spec.min_l or spec.play_l * MIN_FIT
    min_w = spec.min_w or spec.play_w * MIN_FIT

    if not spec.tiles:
        # A field takes the ground it is given: fitted to the polygon, kept to the proportions of
        # the game, and clamped to the sizes the laws allow.
        if rect.length < min_l or rect.width < min_w:
            return []
        # A field is inset from its polygon by the run-off round it; a slab in a schoolyard is
        # the slab, so it is inset by almost nothing. play_l/play_w are the ceiling either way.
        inset = 4.0 if spec.play_l > 40 else 0.4
        length = min(max(rect.length - inset, min_l), spec.play_l)
        width = min(max(rect.width - inset, min_w), spec.play_w)
        if spec.play_l > 40:
            width = min(width, length * 0.75)   # a pitch is longer than it is wide
        return [(sport, Rect(rect.cx, rect.cy, rect.angle, length, width))]

    # Two ways round: courts running along the pitch's long axis, or across it. A row of tennis
    # courts is nearly always shoulder to shoulder across the short axis, but a long thin pitch
    # can be either, so both are tried and the one that fits more courts wins.
    # Scored (how close to regulation, how many), and in that order. Counting alone was the
    # right rule while every court came out regulation-sized whatever the ground was; now that a
    # court is cut to fit, counting alone would take two squeezed courts over one proper one --
    # a forty by twenty-four metre slab holds one basketball court, not two at four-fifths size.
    # A court is a built thing at a known size, so the layout that keeps it nearest that size
    # wins, and the count only separates layouts that are equally close.
    best: list[Rect] = []
    best_score = (0.0, 0)
    for turned in (False, True):
        span_l = rect.width if turned else rect.length
        span_w = rect.length if turned else rect.width
        if span_l < min_l or span_w < min_w:
            continue
        # A single court is allowed to be short of its full run-off; a second one is not, because
        # two courts sharing less than the pad between them do not exist.
        rows = 1 + int(max(0.0, span_l - spec.pad_l) // spec.pad_l)
        cols = 1 + int(max(0.0, span_w - spec.pad_w) // spec.pad_w)
        if rows * cols > 24:                    # a defence against a mis-tagged park polygon
            continue
        step_l = span_l / rows
        step_w = span_w / cols
        # A court is never bigger than the ground it is painted on.
        #
        # This used to hand back spec.play_l by spec.play_w whatever the polygon measured, and
        # the only thing standing between a small slab and a regulation court was MIN_FIT -- so
        # any pitch down to 62% of full size got a full-size court laid over it. Helen Wills
        # Playground is 25.6 m of basketball court and was given the NBA's 28.65: three metres
        # of court, both keys and both baskets, hanging outside the polygon. The fence follows
        # the polygon, because that is where the fence is, so it ran across the court in front
        # of each hoop.
        #
        # Undersized outdoor courts are the normal case in this city rather than the exception,
        # so the court is scaled to the ground instead of being refused. Both dimensions take
        # the same factor: a court with its length cut and its width kept is not a smaller court,
        # it is a wrongly proportioned one, and the key and the arc stop matching the baseline.
        room_l = max(0.0, step_l - RUN_OFF_M)
        room_w = max(0.0, step_w - RUN_OFF_M)
        fit = min(1.0, room_l / spec.play_l, room_w / spec.play_w)
        if fit < MIN_FIT:
            continue
        play_l = spec.play_l * fit
        play_w = spec.play_w * fit
        angle = rect.angle + (math.pi / 2 if turned else 0.0)
        ux, uy = math.cos(angle), math.sin(angle)
        vx, vy = -uy, ux
        courts: list[Rect] = []
        for r in range(rows):
            for c in range(cols):
                du = (r + 0.5) * step_l - span_l / 2
                dv = (c + 0.5) * step_w - span_w / 2
                courts.append(Rect(rect.cx + ux * du + vx * dv,
                                   rect.cy + uy * du + vy * dv,
                                   angle, play_l, play_w))
        score = (round(fit, 6), len(courts))
        if score > best_score:
            best_score = score
            best = courts
    if not best and sport in FALLBACK:
        return layout_courts(FALLBACK[sport], rect)
    return [(sport, court) for court in best]
