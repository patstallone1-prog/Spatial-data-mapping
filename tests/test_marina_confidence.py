"""The Marina confidence scores (smc.facts.marina_confidence; docs/74) and the parking census's
side rule (tools/build_parking_census.py; docs/75)."""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

from smc.facts.marina_confidence import (
    Evidence,
    area_confidence,
    auc,
    band,
    intersection_confidence,
    island_basis,
    island_confidence,
)

ROOT = Path(__file__).resolve().parents[1]


def _square(x: float, y: float, w: float, h: float) -> list[tuple[float, float]]:
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def _island(basis: str = "survey_aerial_confirmed", ring=None, lines=()) -> dict:
    return {"ring": ring or _square(0, 0, 20, 3), "basis": basis, "lines": list(lines), "id": 1}


def test_an_island_read_raised_by_the_lidar_scores_above_one_read_flat() -> None:
    raised = Evidence(lidar_medians=[[(0, 1.5), (20, 1.5)]])
    flat = Evidence(lidar_flat=[[(0, 1.5), (20, 1.5)]])
    island = _island("survey_unconfirmed")
    p_raised, e_raised = island_confidence(dict(island), raised)
    p_flat, e_flat = island_confidence(dict(island), flat)
    assert e_raised["lidar"] == 1.0 and e_flat["lidar_flat"] == 1.0
    assert p_raised > 0.9 > 0.55 > p_flat


def test_island_basis_owner_photo_and_closed_survey() -> None:
    assert island_basis({"lines": [4137], "basis": "survey_unconfirmed"}) == "owner_photo"
    assert island_basis({"lines": [1], "basis": "survey_unconfirmed", "closed_in_survey": True}) == "survey_closed"
    assert island_basis({"lines": [1], "basis": "made_up"}) == "survey_unconfirmed"


def test_a_park_sized_outline_is_not_a_confident_island() -> None:
    park = _island("survey_unconfirmed", ring=_square(0, 0, 100, 40))
    p, e = island_confidence(park, Evidence())
    assert e["oversize"] == 1.0 and band(p) == "low"


def test_a_sliver_is_marked_down() -> None:
    sliver = _island("survey_aerial_confirmed", ring=_square(0, 0, 4, 0.3))
    whole = _island("survey_aerial_confirmed")
    assert island_confidence(sliver, Evidence())[0] < island_confidence(whole, Evidence())[0]


def _crossroads_evidence(with_city: bool) -> Evidence:
    ev = Evidence(streets=[[(-60, 0), (60, 0)], [(0, -60), (0, 60)]])
    if with_city:
        ev.centreline_nodes = [(0.5, 0.5, 4)]
        ev.crosswalks = [(5, 0)]
        ev.stop_signs = [(10, 3), (-10, -3), (3, -10), (-3, 10)]
        # The survey's kerbs round each corner, 7 m back.
        for sx in (-1, 1):
            for sy in (-1, 1):
                ev.kerbs.append([(sx * 7, sy * 40), (sx * 7, sy * 7), (sx * 40, sy * 7)])
                ev.ramps.append((sx * 6.5, sy * 6.5))
    return ev


def test_a_junction_every_source_agrees_on_is_high_and_a_bare_one_low() -> None:
    j = {"x": 0.0, "y": 0.0}
    p_all, e_all = intersection_confidence(dict(j), _crossroads_evidence(True))
    p_none, _ = intersection_confidence(dict(j), _crossroads_evidence(False))
    assert e_all["centreline"] == 1.0 and e_all["legs"] == 1.0 and e_all["kerbs"] == 1.0
    assert band(p_all) == "high" and band(p_none) == "low"


def test_area_confidence_reads_the_kerb_round_the_point() -> None:
    ev = _crossroads_evidence(True)
    with_kerb, parts = area_confidence(0, 0, ev, [(0, 0, 0.9)], [])
    bare, _ = area_confidence(0, 0, _crossroads_evidence(False), [(0, 0, 0.3)], [])
    assert parts["kerb"] > 0.5 and with_kerb > bare


def test_auc_ranks() -> None:
    assert auc([0.9, 0.8, 0.2, 0.1], [True, True, False, False]) == 1.0
    assert auc([0.1, 0.2, 0.8, 0.9], [True, True, False, False]) == 0.0
    assert auc([0.5], [True]) is None


def test_the_shipped_scores_are_calibrated_and_complete() -> None:
    """The page reads docs/marina-confidence.json: every intersection and island has both scores,
    and the held-out checks rank better than chance for the main sources."""
    data = json.loads((ROOT / "docs" / "marina-confidence.json").read_text())
    assert data["schema"].startswith("kerbside.marina_confidence/")
    places = data["intersections"] + data["islands"]
    assert len(data["intersections"]) >= 80 and len(data["islands"]) >= 40
    for place in places:
        assert 0.0 <= place["confidence"] <= 1.0 and 0.0 <= place["area_confidence"] <= 1.0
        assert place["band"] == band(place["confidence"])
    cal = data["calibration"]
    assert cal["islands"]["lidar_truth"]["auc"] >= 0.7
    for source in ("centreline", "kerbs", "crosswalk"):
        assert cal["intersections"][source]["auc"] >= 0.7, source


def _census_module():
    spec = importlib.util.spec_from_file_location("build_parking_census", ROOT / "tools" / "build_parking_census.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_census_sides_follow_the_count_against_the_room() -> None:
    census = _census_module()
    length = 150.0
    room = (length - 2 * census.CORNER_CLEAR_M) / census.SPACE_M       # a side with no driveways
    # Most of both sides' room filled: both sides.
    sides, sure, _ = census.sides_for(round(room * 1.5), length, 0.0, 0.0)
    assert sides == [1, -1] and sure == census.BOTH_SIDES_ACCURACY
    # A third of it: one side, the one with fewer driveways.
    sides, _, info = census.sides_for(round(room * 0.6), length, 30.0, 0.0)
    assert sides == [-1] and info["room_right"] > info["room_left"]
    # Nought counted: no parking.
    assert census.sides_for(0, length, 0.0, 0.0)[0] == []


def test_census_side_of_a_point_is_left_or_right_of_the_line() -> None:
    census = _census_module()
    line = [(0.0, 0.0), (10.0, 0.0)]      # running east
    assert census._side_of(5.0, 3.0, line)[0] == 1      # north of it: left
    assert census._side_of(5.0, -3.0, line)[0] == -1
    assert math.isclose(census._side_of(5.0, -3.0, line)[1], 3.0)


def test_the_shipped_census_has_sides_for_its_blocks() -> None:
    data = json.loads((ROOT / "docs" / "sf-corridor-parking-census.json").read_text())
    assert data["schema"] == "kerbside.parking_census/1"
    segs = data["segments"]
    assert len(segs) > 1000
    assert all(set(s["sides"]) <= {1, -1} for s in segs)
    assert all(len(s["p"]) >= 2 for s in segs)
    assert data["source"]["both_sides_share"] == 0.40
