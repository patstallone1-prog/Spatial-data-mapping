"""The street as a sequence of measured cross-sections.

A street used to be a centreline and a width, and the width was then divided by a lane count:
parking was whatever the count left over, a bike lane was a fixed strip against the kerb, and
the double yellow was in the middle of the road whether or not the parking was the same on both
sides. This module makes the allocation an explicit, checkable object instead.

At every station along a street there is a :class:`Station`: the two kerbs (or the kerb and the
median edge, on a divided road), and an ordered list of :class:`Band` s from the left kerb to
the right that must add up to the width between them. The bands that are *known* -- parking
from the city's policies or from parked cars seen in imagery, bike and transit lanes from the
map, medians, bus zones -- are placed first; the travel lanes are what is left, and they are
not divided by arithmetic but chosen from a short list of hypotheses scored against width
priors, the map's lane count and the neighbouring stations. A station whose width cannot be
closed by any hypothesis is ``unresolved`` and says so; the renderer then paints nothing there,
which is the correct picture of what is known.

Nothing here is a tier or a provenance in the :mod:`smc.facts.schema` sense -- those say what
may be *claimed*. Each band carries a ``grade`` saying where its number came from
(:class:`SourceGrade`), which is the other axis and must not be confused with the first.
"""

from __future__ import annotations

import enum
import itertools
import math
from dataclasses import dataclass, field, replace


class SourceGrade(enum.StrEnum):
    """Where a number came from, strongest first. Not the claim tier."""

    SURVEY = "survey"      # the city's own surveyed geometry or dimensional record
    LIDAR = "lidar"        # a metric sensor: aerial or ground lidar
    IMAGE = "image"        # measured from photographs
    MAPPED = "mapped"      # OpenStreetMap / Overture / a GIS layer without survey accuracy
    INFERRED = "inferred"  # a prior, a neighbour, a default


class Kind(enum.StrEnum):
    PARKING = "parking"
    BIKE = "bike"
    BUFFER = "buffer"
    TRANSIT = "transit"
    TRAVEL = "travel"
    TURN = "turn"
    MEDIAN = "median"
    SHOULDER = "shoulder"
    LOADING = "loading"
    UNRESOLVED = "unresolved"


#: Plausible widths per band kind, metres: (floor, ideal, ceiling). A travel lane in San
#: Francisco is ten to twelve feet; a parallel parking lane seven to eight; a class II bike
#: lane five to seven. These are *priors* the solver scores against, never widths it assigns.
PRIORS: dict[Kind, tuple[float, float, float]] = {
    Kind.TRAVEL: (2.7, 3.3, 4.9),
    Kind.TURN: (2.7, 3.1, 3.7),
    Kind.BIKE: (1.4, 1.7, 2.3),
    Kind.BUFFER: (0.5, 0.9, 1.5),
    Kind.TRANSIT: (3.0, 3.4, 4.0),
    Kind.PARKING: (2.0, 2.3, 2.7),
    Kind.SHOULDER: (0.3, 0.6, 1.5),
    Kind.LOADING: (2.0, 2.4, 3.0),
    Kind.MEDIAN: (0.3, 1.2, 8.0),
}
#: Angled and perpendicular parking are their own priors; the band keeps its type.
ANGLED_PARKING_PRIOR = (4.6, 5.2, 5.8)
PERPENDICULAR_PARKING_PRIOR = (5.0, 5.5, 6.2)

#: Single-letter codes for the page payload; the page decodes them (CROSS_SECTION_CODES).
KIND_CODE: dict[Kind, str] = {
    Kind.PARKING: "p", Kind.BIKE: "b", Kind.BUFFER: "f", Kind.TRANSIT: "x", Kind.TRAVEL: "t",
    Kind.TURN: "n", Kind.MEDIAN: "m", Kind.SHOULDER: "h", Kind.LOADING: "l", Kind.UNRESOLVED: "u",
}
GRADE_CODE: dict[SourceGrade, str] = {
    SourceGrade.SURVEY: "S", SourceGrade.LIDAR: "L", SourceGrade.IMAGE: "I",
    SourceGrade.MAPPED: "M", SourceGrade.INFERRED: "N",
}
STATUS_CODE: dict[str, str] = {"resolved": "r", "partial": "p", "unresolved": "u"}
#: Reason codes: the page shows the sentence; the payload carries the code.
REASON_CODES: dict[str, str] = {
    "map says": "count",          # the map's lane count and the widths disagree
    "no lane hypothesis": "nohyp",
    "nameless connector": "connector",
    "no room for a travel lane": "noroom",
    "parking dropped": "parkdrop",
    "parking assumed": "parkassume",
    "boundary steps": "step",
    "median edge": "median",
}


def reason_code(reason: str) -> str:
    for needle, code in REASON_CODES.items():
        if needle in reason:
            return code
    return "other"


#: A hypothesis must close the width to this or the station is unresolved.
CLOSE_TOLERANCE_M = 0.15
#: A boundary that moves sideways more than this between neighbouring stations is a step, and
#: a step must be explained by something that changed (a band appearing or ending, the kerb
#: moving at a bulb-out) or the stations are marked partial.
STEP_M = 0.6
#: The kerb has to move this much between stations for a boundary step to be "the kerb".
KERB_STEP_M = 0.4
#: Stations along the street.
STATION_M = 4.0


@dataclass(frozen=True)
class Band:
    kind: Kind
    width_m: float
    grade: SourceGrade
    confidence: float
    sigma_m: float = 0.3
    source: str = ""
    #: For parking: parallel | angled | perpendicular; for bike: lane | track | buffered.
    subtype: str = ""
    #: Which way traffic in this band moves relative to the way: +1 with it, -1 against, 0 n/a.
    direction: int = 0

    def to_json(self) -> list:
        """``[kind, width, grade, confidence, direction, subtype]`` -- positional, because a
        street has fifty of these and the page carries two thousand streets."""
        out: list = [KIND_CODE[self.kind], round(self.width_m, 2), GRADE_CODE[self.grade],
                     round(self.confidence, 2), self.direction]
        if self.subtype:
            out.append(self.subtype)
        return out


@dataclass
class Station:
    s_m: float
    lon: float
    lat: float
    #: Signed offsets from the way's own line, positive to the left of travel.
    left_kerb_m: float
    right_kerb_m: float
    kerb_grade: SourceGrade
    bands: list[Band] = field(default_factory=list)
    status: str = "unresolved"      # resolved | partial | unresolved
    reasons: list[str] = field(default_factory=list)
    score: float = math.inf

    @property
    def width_m(self) -> float:
        return self.left_kerb_m - self.right_kerb_m

    @property
    def residual_m(self) -> float:
        return sum(b.width_m for b in self.bands) - self.width_m

    def boundaries(self) -> list[tuple[str, float]]:
        """The lateral offsets between bands, left to right, each labelled by the pair it
        separates: ``"parking|travel"``. Offsets are positive to the left of travel."""
        out: list[tuple[str, float]] = []
        edge = self.left_kerb_m
        for i in range(len(self.bands) - 1):
            edge -= self.bands[i].width_m
            out.append((f"{self.bands[i].kind.value}|{self.bands[i + 1].kind.value}", edge))
        return out

    def to_json(self) -> list:
        """``[s, left, right, kerb grade, status, bands, reason codes]``."""
        out: list = [round(self.s_m, 1), round(self.left_kerb_m, 2), round(self.right_kerb_m, 2),
                     GRADE_CODE[self.kerb_grade], STATUS_CODE[self.status],
                     [b.to_json() for b in self.bands]]
        if self.reasons:
            out.append(sorted({reason_code(r) for r in self.reasons}))
        return out


def prior_for(band: Band) -> tuple[float, float, float]:
    if band.kind is Kind.PARKING:
        if band.subtype == "angled":
            return ANGLED_PARKING_PRIOR
        if band.subtype == "perpendicular":
            return PERPENDICULAR_PARKING_PRIOR
    return PRIORS.get(band.kind, (0.3, 1.0, 8.0))


def width_penalty(kind: Kind, width_m: float, subtype: str = "") -> float:
    """Zero at the ideal, one at the floor or ceiling, infinite beyond a margin past them."""
    floor, ideal, ceiling = prior_for(Band(kind, width_m, SourceGrade.INFERRED, 0.0, subtype=subtype))
    if width_m < floor - 0.15 or width_m > ceiling + 0.3:
        return math.inf
    if width_m < ideal:
        return ((ideal - width_m) / max(ideal - floor, 0.01)) ** 2
    return ((width_m - ideal) / max(ceiling - ideal, 0.01)) ** 2


@dataclass(frozen=True)
class Hypothesis:
    forward: int
    backward: int
    centre_turn: bool = False
    #: One lane used in both directions: the narrow two-way street with no centre line.
    shared: bool = False

    @property
    def travel(self) -> int:
        if self.shared:
            return 1
        return self.forward + self.backward + (1 if self.centre_turn else 0)


def _hypotheses(oneway: bool, max_lanes: int = 6) -> list[Hypothesis]:
    out: list[Hypothesis] = []
    if oneway:
        for n in range(1, max_lanes + 1):
            out.append(Hypothesis(n, 0))
    else:
        out.append(Hypothesis(0, 0, shared=True))
        for f in range(1, max_lanes + 1):
            for b in range(1, max_lanes + 1):
                out.append(Hypothesis(f, b))
                out.append(Hypothesis(f, b, centre_turn=True))
    return out


def _with_assumed_parking(side: list[Band], assumed: Band) -> list[Band]:
    """Parking the policies missed goes where parking goes: at the kerb, unless the kerb
    carries a protected bike track, in which case the parked cars are what protects it."""
    if side and side[0].kind is Kind.BIKE and side[0].subtype == "track":
        after = 1
        if len(side) > 1 and side[1].kind is Kind.BUFFER:
            after = 2
        return [*side[:after], assumed, *side[after:]]
    return [assumed, *list(side)]


def allocate(
    width_m: float,
    fixed_left: list[Band],
    fixed_right: list[Band],
    *,
    oneway: bool,
    lanes_tag: int | None = None,
    lanes_forward_tag: int | None = None,
    lanes_backward_tag: int | None = None,
    named: bool = True,
    boundary_marks_m: list[float] | None = None,
    left_kerb_m: float | None = None,
) -> tuple[list[Band], str, list[str], float]:
    """Divide what the fixed bands leave between the kerbs into travel lanes.

    ``fixed_left`` runs from the left kerb inward; ``fixed_right`` from the right kerb inward
    (so both lists start at their kerb). Returns ``(bands left→right, status, reasons, score)``.

    The lanes are not ``remaining / count``: each hypothesis (forward lanes, backward lanes,
    a centre turn lane or not) is scored on how far its lane widths sit from the priors, on
    disagreement with the map's lane count where there is one, and -- where marked boundaries
    were measured -- on how far the hypothesis's boundaries fall from them. The best closes
    the width by construction; where no hypothesis has lanes inside the plausible range the
    station is unresolved and gets no travel bands at all.
    """
    reasons: list[str] = []
    fixed = sum(b.width_m for b in fixed_left) + sum(b.width_m for b in fixed_right)
    remaining = width_m - fixed
    fixed_left = list(fixed_left)
    fixed_right = list(fixed_right)
    # No room for a lane and the parking: a parking band that is only inferred gives way first,
    # the weaker side first.
    while remaining < PRIORS[Kind.TRAVEL][0] - 0.15:
        droppable = [
            (side, i, b) for side, bands in (("L", fixed_left), ("R", fixed_right))
            for i, b in enumerate(bands)
            if b.kind is Kind.PARKING and b.grade is SourceGrade.INFERRED
        ]
        if not droppable:
            break
        side, i, band = min(droppable, key=lambda t: t[2].confidence)
        (fixed_left if side == "L" else fixed_right).pop(i)
        remaining += band.width_m
        reasons.append(f"no room for a lane and {side.lower()}-side parking; parking dropped")
    if remaining < PRIORS[Kind.TRAVEL][0] - 0.15:
        return [*fixed_left, Band(Kind.UNRESOLVED, max(0.0, remaining), SourceGrade.INFERRED, 0.0), *list(reversed(fixed_right))], "unresolved", [*reasons, "no room for a travel lane"], math.inf

    # A nameless way is a connector through a junction -- a slip, a turning link, the piece of
    # the Embarcadero's box OpenStreetMap draws as its own way -- and its width says nothing
    # about lanes: at 17.6 m it read as four, and three white lines ran through the crossroads.
    if not named and lanes_tag is None:
        return [*fixed_left, Band(Kind.UNRESOLVED, remaining, SourceGrade.INFERRED, 0.0), *list(reversed(fixed_right))], "unresolved", \
            [*reasons, "nameless connector: lanes are not inferred from its width"], math.inf
    hyps = _hypotheses(oneway)

    # The parking the city's policies did not record. A 13 m one-way street tagged with two
    # lanes has parking down both sides whatever the policy file says; two 6.5 m lanes are not
    # a hypothesis. So each side without a parking band may be given one, inferred, at a cost
    # -- and the cost is paid only where it lets the map's count close the width.
    assumed_variants: list[tuple[list[Band], list[Band], float, list[str]]] = [(fixed_left, fixed_right, 0.0, [])]
    if lanes_tag is not None:
        assumed = Band(Kind.PARKING, PRIORS[Kind.PARKING][1], SourceGrade.INFERRED, 0.35,
                       sigma_m=0.35, source="width leaves room; no policy record", subtype="parallel")
        no_left = not any(b.kind is Kind.PARKING for b in fixed_left)
        no_right = not any(b.kind is Kind.PARKING for b in fixed_right)
        with_left = _with_assumed_parking(fixed_left, assumed)
        with_right = _with_assumed_parking(fixed_right, assumed)
        if no_left:
            assumed_variants.append((with_left, fixed_right, 1.0, ["left parking assumed: the width leaves room and the policies say nothing"]))
        if no_right:
            assumed_variants.append((fixed_left, with_right, 1.0, ["right parking assumed: the width leaves room and the policies say nothing"]))
        if no_left and no_right:
            assumed_variants.append((with_left, with_right, 1.6, ["parking assumed both sides: the width leaves room and the policies say nothing"]))

    best: tuple[float, Hypothesis, list[Band], list[Band], list[Band], list[str]] | None = None
    for variant_left, variant_right, variant_cost, variant_reasons in assumed_variants:
      remaining = width_m - sum(b.width_m for b in variant_left) - sum(b.width_m for b in variant_right)
      if remaining < PRIORS[Kind.TRAVEL][0] - 0.15:
        continue
      for h in hyps:
          n = h.travel
          lane_w = remaining / n
          if h.shared:
              kind_w = [(Kind.TRAVEL, lane_w)]
          else:
              kind_w = [(Kind.TRAVEL, lane_w)] * (h.forward + h.backward)
              if h.centre_turn:
                  kind_w = [*kind_w, (Kind.TURN, lane_w)]
          score = sum(width_penalty(k, w) for k, w in kind_w) / n
          if not math.isfinite(score):
              continue
          if h.shared:
              # Only where two lanes will not fit: a shared lane on a wide street is wrong.
              score += 0.5 + (1.0 if remaining >= 2 * PRIORS[Kind.TRAVEL][0] else 0.0)
              if lanes_tag is not None:
                  score += abs(1 - lanes_tag) * 1.5
          if lanes_tag is not None:
              score += abs(n - lanes_tag) * 2.0
          if lanes_forward_tag is not None:
              score += abs(h.forward - lanes_forward_tag) * 1.5
          if lanes_backward_tag is not None:
              score += abs(h.backward - lanes_backward_tag) * 1.5
          if not oneway and h.backward != h.forward and lanes_forward_tag is None \
                  and lanes_backward_tag is None:
              score += 0.8 * abs(h.backward - h.forward)
          if h.centre_turn:
              # A two-way left-turn lane is rare on these streets; an uneven split is not.
              score += 1.0 + (1.0 if lanes_tag is not None and lanes_tag % 2 == 0 else 0.0)
          # Simplicity: fewer lanes when the widths are equally plausible.
          score += 0.05 * n
          travel_bands: list[Band] = []
          if h.shared:
              travel_bands.append(Band(Kind.TRAVEL, lane_w, SourceGrade.INFERRED, 0.6, direction=0,
                                       subtype="shared"))
          for _ in range(h.backward):
              travel_bands.append(Band(Kind.TRAVEL, lane_w, SourceGrade.INFERRED, 0.6, direction=-1))
          if h.centre_turn:
              travel_bands.append(Band(Kind.TURN, lane_w, SourceGrade.INFERRED, 0.5))
          for _ in range(h.forward):
              travel_bands.append(Band(Kind.TRAVEL, lane_w, SourceGrade.INFERRED, 0.6, direction=1))
          score += variant_cost
          if boundary_marks_m and left_kerb_m is not None:
              # Marked boundaries dominate: every measured mark should sit on a hypothesis
              # boundary, and every hypothesis boundary near a mark is snapped to it.
              edge = left_kerb_m - sum(b.width_m for b in variant_left)
              edges = []
              for b in travel_bands[:-1]:
                  edge -= b.width_m
                  edges.append(edge)
              miss = 0.0
              for m in boundary_marks_m:
                  miss += min([abs(m - e) for e in edges] or [1.0])
              score += 2.0 * miss / max(len(boundary_marks_m), 1)
          if best is None or score < best[0]:
              best = (score, h, travel_bands, variant_left, variant_right, variant_reasons)
    if best is None:
        remaining = width_m - fixed
        return [*fixed_left, Band(Kind.UNRESOLVED, max(0.0, remaining), SourceGrade.INFERRED, 0.0), *list(reversed(fixed_right))], "unresolved", [*reasons, "no lane hypothesis closes the width"], math.inf

    score, h, travel_bands, fixed_left, fixed_right, variant_reasons = best
    reasons = reasons + variant_reasons
    grade = SourceGrade.MAPPED if lanes_tag is not None else SourceGrade.INFERRED
    travel_bands = [replace(b, grade=grade, confidence=0.8 if lanes_tag is not None else 0.6)
                    for b in travel_bands]
    bands = fixed_left + travel_bands + list(reversed(fixed_right))
    status = "resolved"
    if lanes_tag is not None and h.travel != lanes_tag:
        reasons.append(f"map says {lanes_tag} lanes, widths say {h.travel}")
        status = "partial"
    if reasons and status == "resolved":
        status = "partial"
    return bands, status, reasons, score


def fit_longitudinal(stations: list[Station]) -> int:
    """Walk the stations in order and mark unexplained sideways steps in any boundary.

    A boundary that moves more than STEP_M between neighbours is fine where a band began or
    ended between them, or the kerb itself moved (a bulb-out, a pocket); otherwise both
    stations become ``partial`` with the reason recorded. Returns how many steps were flagged.
    """
    flagged = 0
    for a, b in itertools.pairwise(stations):
        if a.status == "unresolved" or b.status == "unresolved":
            continue
        kinds_a = [x.kind for x in a.bands]
        kinds_b = [x.kind for x in b.bands]
        if kinds_a != kinds_b:
            continue  # a band appeared or ended: the step is explained by the change itself
        kerb_moved = abs(a.left_kerb_m - b.left_kerb_m) > KERB_STEP_M \
            or abs(a.right_kerb_m - b.right_kerb_m) > KERB_STEP_M
        if kerb_moved:
            continue
        for (label, ea), (_, eb) in zip(a.boundaries(), b.boundaries(), strict=False):
            if abs(ea - eb) > STEP_M:
                for st in (a, b):
                    if st.status == "resolved":
                        st.status = "partial"
                    st.reasons.append(f"{label} boundary steps {abs(ea - eb):.2f} m with nothing to explain it")
                flagged += 1
                break
    return flagged


def travel_count(station: Station) -> int:
    return sum(1 for b in station.bands if b.kind in (Kind.TRAVEL, Kind.TURN))


@dataclass
class LaneEnd:
    """The lanes a way presents at one of its ends, for the junction to match."""

    end: str                      # "start" | "end"
    travel: int
    forward: int
    backward: int
    turns: list[str]              # turn:lanes tokens, forward lanes only, or empty


def lane_ends(stations: list[Station], turns: str | None) -> list[LaneEnd]:
    """The lanes at each end of a way, from its first and last resolved station."""
    out: list[LaneEnd] = []
    tokens = [t for t in (turns or "").split("|") if turns] if turns else []
    for label, pick in (("start", stations), ("end", list(reversed(stations)))):
        st = next((s for s in pick if s.status != "unresolved"), None)
        if st is None:
            continue
        fwd = sum(1 for b in st.bands if b.kind is Kind.TRAVEL and b.direction == 1)
        back = sum(1 for b in st.bands if b.kind is Kind.TRAVEL and b.direction == -1)
        out.append(LaneEnd(label, travel_count(st), fwd, back, tokens if label == "end" else []))
    return out


def match_junction(ends: list[tuple[str, LaneEnd]]) -> list[str]:
    """Check the lane ends meeting at one junction against each other.

    Two legs of one street meeting across the box should present the same lanes to each other
    unless the incoming leg says with turn arrows where the difference goes. Returns the
    reasons found; an empty list is a junction the lanes carry through.
    """
    reasons: list[str] = []
    by_name: dict[str, list[LaneEnd]] = {}
    for name, end in ends:
        by_name.setdefault(name, []).append(end)
    for name, legs in by_name.items():
        if len(legs) != 2:
            continue
        a, b = legs
        # What leaves one leg forward should arrive on the other; a drop needs arrows.
        if a.forward != b.backward and not a.turns and a.end == "end":
            reasons.append(f"{name}: {a.forward} lanes in, {b.backward} out, no turn arrows")
        if b.forward != a.backward and not b.turns and b.end == "end":
            reasons.append(f"{name}: {b.forward} lanes in, {a.backward} out, no turn arrows")
    return reasons
