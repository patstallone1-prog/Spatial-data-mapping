"""The gate a photo measurement passes before it reaches the production street payload.

Imagery can measure two things on a street (scripts/measure_road_imagery.py): where parked
cars stand (a parking band per block face) and where lane paint lies. Both are easy to get
confidently wrong -- one day's cars, a crooked van, a shadow read as paint, a camera whose
registration drifted by half a lane -- so nothing measured from a photograph is believed on
its own say-so. docs/38 sets out what is allowed and why; this module is the rule.

Parking bands may enter, one face at a time, when *all* of these hold:

* the measurement itself is sound: ``status == "measured"``, at least ``MIN_VEHICLES`` parked
  vehicles over ``MIN_DATES`` capture dates (smc.measure.parking_band), a width a parked car
  can actually occupy, a spread no wider than the benchmark tolerance, and named source assets
  (whose CV rights the measuring script has already checked);
* the method has been proven: the lane benchmark (data/sf_corridor/benchmarks/lane_faces.json)
  holds hand-checked parking truth on enough faces across enough strata, the photo method has
  been scored against it, and it came out within ``PARKING_TOL_M`` on nearly all of them.

Until the method is proven the gate is shut and every photo band is held back: the face keeps
its policy prior, graded inferred. A measured *absence* ("none": cars seen, none parked) is a
photo claim too and is held back on the same terms -- removing a parking lane that exists is
as much a hallucination as inventing one.

Lane paint never sets a lane count or a lane width. It may only confirm a boundary the map
already implies (``confirm_boundaries``); a stripe with no mapped boundary near it is reported,
never drawn.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from smc.measure.parking_band import MAX_REACH_M, MIN_BAND_M, MIN_DATES, MIN_VEHICLES

ROOT = Path(__file__).resolve().parents[3]
BENCHMARK = ROOT / "data" / "sf_corridor" / "benchmarks" / "lane_faces.json"

#: The benchmark tolerance the photo method is held to (tests/test_lane_benchmark.py).
PARKING_TOL_M = 0.25
#: Faces with hand-checked parking truth *and* a photo measurement to score against it.
MIN_SCORED_FACES = 12
#: ... spread across this many of the benchmark's five strata.
MIN_STRATA = 3
#: Share of scored sides that must land within tolerance, and the worst miss allowed at all.
MIN_WITHIN_SHARE = 0.9
MAX_MISS_M = 2 * PARKING_TOL_M
#: A band whose own spread is wider than the tolerance cannot be said to meet it.
MAX_SIGMA_M = PARKING_TOL_M
#: A paint stripe confirms a mapped boundary when it lies this close to it.
CONFIRM_M = 0.30


@dataclass
class GateReport:
    """What the gate decided, for the build summary and the doc."""

    open: bool
    reason: str
    scored_sides: int = 0
    within_sides: int = 0
    strata: list[str] = field(default_factory=list)
    admitted: int = 0
    held: dict[str, int] = field(default_factory=dict)

    def hold(self, why: str) -> None:
        self.held[why] = self.held.get(why, 0) + 1


def band_problem(band: dict) -> str | None:
    """Why one measured band is not sound on its own terms, or None when it is."""
    if band.get("status") != "measured":
        return f"status {band.get('status')!r}"
    width = band.get("width_m")
    if not isinstance(width, (int, float)) or not MIN_BAND_M <= width <= MAX_REACH_M:
        return "width outside a parked car's reach"
    if int(band.get("vehicles") or 0) < MIN_VEHICLES or int(band.get("dates") or 0) < MIN_DATES:
        return "too few vehicles or dates"
    if float(band.get("sigma_m") or 0.0) > MAX_SIGMA_M:
        return "spread wider than the benchmark tolerance"
    if not band.get("source_asset_ids"):
        return "no named source asset"
    return None


def benchmark_faces(path: Path = BENCHMARK) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("faces", [])


def score_method(faces: list[dict], measured: dict) -> GateReport:
    """Score the photo bands against the benchmark's hand-checked parking truth; open the gate
    only when the method has been shown to hold."""
    scored = within = 0
    worst = 0.0
    strata: set[str] = set()
    scored_faces: set[str] = set()
    for face in faces:
        truth, cnn = face.get("truth") or {}, face.get("cnn")
        if not cnn:
            continue
        for side, key in ((1, "parking_left_m"), (-1, "parking_right_m")):
            want = truth.get(key)
            band = measured.get(f"{cnn}:{side}")
            if want is None or not band or band_problem(band):
                continue
            miss = abs(float(band["width_m"]) - float(want))
            scored += 1
            within += miss <= PARKING_TOL_M
            worst = max(worst, miss)
            strata.add(str(face.get("stratum")))
            scored_faces.add(str(cnn))
    report = GateReport(False, "", scored, within, sorted(strata))
    faces_scored = len(scored_faces)
    if faces_scored < MIN_SCORED_FACES:
        report.reason = (f"method unproven: {faces_scored} benchmark faces scored, "
                         f"need {MIN_SCORED_FACES}")
    elif len(strata) < MIN_STRATA:
        report.reason = f"method unproven: {len(strata)} strata scored, need {MIN_STRATA}"
    elif within < MIN_WITHIN_SHARE * scored:
        report.reason = f"method fails: {within} of {scored} sides within {PARKING_TOL_M} m"
    elif worst > MAX_MISS_M:
        report.reason = f"method fails: worst miss {worst:.2f} m"
    else:
        report.open = True
        report.reason = f"method proven: {within} of {scored} sides within {PARKING_TOL_M} m"
    return report


def admit_parking(measured: dict | None, faces: list[dict] | None = None) -> tuple[dict, GateReport]:
    """The photo parking bands the production payload may use, and why the rest were held.

    The returned table has only sound, proven measurements; every other face falls back to the
    policy prior in build_cross_sections.parking_band_for_side.
    """
    measured = measured or {}
    report = score_method(benchmark_faces() if faces is None else faces, measured)
    admitted: dict = {}
    for key, band in measured.items():
        if not report.open:
            report.hold("gate shut")
            continue
        problem = band_problem(band)
        if problem:
            report.hold(problem)
            continue
        admitted[key] = band
        report.admitted += 1
    return admitted, report


def confirm_boundaries(boundaries_m: list[float], stripes_m: list[float]) -> dict:
    """Which mapped lane boundaries (offsets from the centreline, metres) a photo stripe
    confirms, and which stripes have no mapped boundary to confirm. Stripes never add or move
    a boundary; an unmatched one is an anomaly to look at, not a lane to draw."""
    confirmed = sorted({b for b in boundaries_m if any(abs(b - s) <= CONFIRM_M for s in stripes_m)})
    unmatched = sorted(s for s in stripes_m if all(abs(b - s) > CONFIRM_M for b in boundaries_m))
    return {"confirmed": confirmed, "unconfirmed": sorted(set(boundaries_m) - set(confirmed)),
            "unmatched_stripes": unmatched}
