"""The photo gate (smc.measure.photo_gate, docs/38): nothing measured from a photograph reaches
the production street payload until the method has been proven against hand-checked truth."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from smc.measure.photo_gate import (
    MIN_SCORED_FACES,
    admit_parking,
    band_problem,
    confirm_boundaries,
    score_method,
)

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "docs" / "sf-corridor-3d.json"
STRATA = ["bike", "divided", "oneway", "twoway_residential", "wide_arterial"]


def band(width=2.1, vehicles=12, dates=4, sigma=0.08, status="measured", sources=("m1",)):
    return {"status": status, "width_m": width, "sigma_m": sigma, "vehicles": vehicles,
            "dates": dates, "source_asset_ids": list(sources)}


def proven(n=MIN_SCORED_FACES, miss=0.1):
    """A benchmark of n faces with truth, and photo bands that each miss it by ``miss``."""
    faces, measured = [], {}
    for i in range(n):
        faces.append({"stratum": STRATA[i % 5], "cnn": f"c{i}",
                      "truth": {"parking_left_m": 2.1, "parking_right_m": 2.2}})
        measured[f"c{i}:1"] = band(2.1 + miss)
        measured[f"c{i}:-1"] = band(2.2 - miss)
    return faces, measured


def test_an_unsound_band_is_named_for_why():
    assert band_problem(band()) is None
    assert "too few" in band_problem(band(vehicles=5))
    assert "too few" in band_problem(band(dates=2))
    assert "reach" in band_problem(band(width=3.6))
    assert "reach" in band_problem(band(width=1.2))
    assert "spread" in band_problem(band(sigma=0.4))
    assert "source" in band_problem(band(sources=()))
    assert "status" in band_problem(band(status="too_few"))


def test_the_gate_is_shut_until_the_method_is_scored_on_enough_faces():
    faces, measured = proven(MIN_SCORED_FACES - 1)
    admitted, report = admit_parking(measured, faces)
    assert not report.open and "unproven" in report.reason
    assert admitted == {} and report.held == {"gate shut": len(measured)}
    # A measured absence is a photo claim too and waits with the rest.
    _, report = admit_parking({"c0:1": {"status": "none"}}, faces)
    assert report.held == {"gate shut": 1}


def test_a_proven_method_admits_only_sound_bands():
    faces, measured = proven()
    measured["extra:1"] = band(vehicles=3)
    admitted, report = admit_parking(measured, faces)
    assert report.open and report.scored_sides == 2 * MIN_SCORED_FACES
    assert "extra:1" not in admitted and report.held == {"too few vehicles or dates": 1}
    assert report.admitted == len(admitted) == 2 * MIN_SCORED_FACES


def test_a_method_that_misses_the_truth_stays_shut():
    faces, measured = proven(miss=0.4)
    report = score_method(faces, measured)
    assert not report.open and "fails" in report.reason
    # One stratum alone does not prove the method on the others.
    faces, measured = proven()
    for f in faces:
        f["stratum"] = "oneway"
    assert "strata" in score_method(faces, measured).reason


def test_paint_confirms_mapped_boundaries_and_never_adds_one():
    out = confirm_boundaries([3.5, 0.0, -3.5], [3.42, -0.1, 6.8])
    assert out["confirmed"] == [0.0, 3.5]
    assert out["unconfirmed"] == [-3.5]
    assert out["unmatched_stripes"] == [6.8]


def test_the_build_holds_back_unproven_photo_bands():
    from smc.facts.build_cross_sections import parking_band_for_side
    from smc.facts.cross_section import SourceGrade
    measured = {"sfcnn:1:1": band()}
    admitted, report = admit_parking(measured)          # the committed benchmark
    assert not report.open, "the committed benchmark has no scored photo truth yet"
    way = {"cnn": "sfcnn:1", "parking_sides": [1]}
    assert parking_band_for_side(way, 1, admitted).grade is SourceGrade.INFERRED


def test_the_production_payload_has_no_photo_bands_while_the_gate_is_shut():
    """The street payload's bands carry their grade; an "I" (image) band may only be there once
    the committed benchmark proves the method."""
    if not PAGE.exists():
        pytest.skip("no built corridor payload")
    page = json.loads(PAGE.read_text(encoding="utf-8"))
    grades = Counter()
    for way in page["ways"]:
        for row in way.get("xs") or []:
            for b in row[5] if len(row) > 5 else []:
                grades[(b[0], b[2])] += 1
            grades[("kerb", row[3])] += 1
    photo = {k: n for k, n in grades.items() if k[1] == "I"}
    _, report = admit_parking({})
    if not report.open:
        assert photo == {}, f"photo-graded bands in production with the gate shut: {photo}"
    # Lane paint never sets a travel lane, gate or no gate.
    assert ("t", "I") not in grades
