"""The street as measured cross-sections: the bands between the kerbs must add up, be chosen
from plausible hypotheses rather than by arithmetic, and refuse when they cannot."""

from __future__ import annotations

import math

from smc.facts.cross_section import (
    Band,
    Kind,
    LaneEnd,
    SourceGrade,
    Station,
    allocate,
    fit_longitudinal,
    lane_ends,
    match_junction,
    width_penalty,
)


def parking(width=2.3, grade=SourceGrade.INFERRED, conf=0.5):
    return Band(Kind.PARKING, width, grade, conf, subtype="parallel")


def bike(width=1.7):
    return Band(Kind.BIKE, width, SourceGrade.MAPPED, 0.8, subtype="lane")


def test_the_bands_close_the_width_and_the_yellow_sits_in_the_traffic():
    """Polk: 13.4 m kerb to kerb, parking both sides, two-way. Two lanes, and the centre
    boundary is in the middle of the traffic -- which here is the middle of the road."""
    bands, status, reasons, _ = allocate(13.4, [parking()], [parking()], oneway=False, lanes_tag=2)
    assert status == "resolved", reasons
    assert [b.kind for b in bands] == [Kind.PARKING, Kind.TRAVEL, Kind.TRAVEL, Kind.PARKING]
    assert abs(sum(b.width_m for b in bands) - 13.4) < 1e-9
    assert [b.direction for b in bands if b.kind is Kind.TRAVEL] == [-1, 1]
    st = Station(0, 0, 0, 6.7, -6.7, SourceGrade.SURVEY, bands, status)
    centre = dict(st.boundaries())["travel|travel"]
    assert abs(centre) < 1e-9


def test_parking_on_one_side_moves_the_centre_off_the_middle_of_the_road():
    bands, status, _, _ = allocate(12.0, [], [parking(2.4)], oneway=False, lanes_tag=2)
    assert status == "resolved"
    st = Station(0, 0, 0, 6.0, -6.0, SourceGrade.SURVEY, bands, status)
    centre = dict(st.boundaries())["travel|travel"]
    # Travel spans +6.0 .. -3.6; its middle is +1.2 (left of the road's middle).
    assert abs(centre - 1.2) < 1e-9


def test_lanes_are_chosen_from_hypotheses_not_by_dividing():
    """17.6 m one-way with no tag: four 4.4 m lanes and five 3.5 m lanes both close the width;
    the priors prefer five. The old code said four because 17.6 >= 13.8."""
    bands, status, _, _ = allocate(17.6, [], [], oneway=True)
    assert status == "resolved"
    assert sum(1 for b in bands if b.kind is Kind.TRAVEL) == 5


def test_the_map_lane_count_is_believed_where_the_widths_allow_it():
    bands, status, _, _ = allocate(17.6, [], [], oneway=True, lanes_tag=4)
    assert status == "resolved"
    assert sum(1 for b in bands if b.kind is Kind.TRAVEL) == 4


def test_a_nameless_connector_gets_no_lanes_from_its_width():
    bands, status, reasons, _ = allocate(17.6, [], [], oneway=True, named=False)
    assert status == "unresolved" and not any(b.kind is Kind.TRAVEL for b in bands), reasons


def test_a_narrow_two_way_street_is_one_shared_lane_with_no_centre_line():
    bands, status, _, _ = allocate(6.8, [parking(conf=0.5)], [parking(conf=0.4)], oneway=False)
    travel = [b for b in bands if b.kind is Kind.TRAVEL]
    assert status == "partial" and len(travel) == 1 and travel[0].direction == 0


def test_inferred_parking_gives_way_when_there_is_no_room_for_a_lane():
    """A 6.8 m residential street: parking both sides leaves 2.2 m, which is not a lane. The
    inferred parking on one side is dropped and the station is partial with the reason."""
    bands, status, reasons, _ = allocate(6.8, [parking(conf=0.5)], [parking(conf=0.4)], oneway=False)
    assert status == "partial"
    assert any("parking dropped" in r for r in reasons)
    assert sum(1 for b in bands if b.kind is Kind.PARKING) == 1


def test_measured_parking_is_not_dropped_and_the_station_refuses_instead():
    bands, status, _reasons, score = allocate(
        4.4, [parking(grade=SourceGrade.IMAGE, conf=0.9)], [parking(grade=SourceGrade.IMAGE, conf=0.9)],
        oneway=False)
    assert status == "unresolved"
    assert any(b.kind is Kind.UNRESOLVED for b in bands)
    assert math.isinf(score)


def test_a_bike_lane_between_parking_and_traffic_keeps_its_arrangement():
    """Kerb -> parking -> bike -> traffic: the fixed bands are given from the kerb inward and
    come back in that order."""
    bands, status, _, _ = allocate(13.4, [parking(), bike()], [parking()], oneway=False, lanes_tag=2)
    assert status == "resolved"
    assert [b.kind for b in bands] == [Kind.PARKING, Kind.BIKE, Kind.TRAVEL, Kind.TRAVEL, Kind.PARKING]


def test_marked_boundaries_pull_the_hypothesis_to_them():
    """A 10.6 m one-way road with a line painted 3.0 m from the left kerb: three lanes
    (3.53 m) score close to two (5.3 m, out of range) -- the mark settles it at three and
    the boundaries land on the mark."""
    bands, status, _, _ = allocate(10.6, [], [], oneway=True, boundary_marks_m=[2.3], left_kerb_m=5.3)
    assert status == "resolved"
    assert sum(1 for b in bands if b.kind is Kind.TRAVEL) == 3


def test_width_penalty_is_zero_at_the_ideal_and_infinite_beyond_the_range():
    assert width_penalty(Kind.TRAVEL, 3.3) == 0.0
    assert 0 < width_penalty(Kind.TRAVEL, 2.9) < 1.0
    assert math.isinf(width_penalty(Kind.TRAVEL, 2.2))
    assert math.isinf(width_penalty(Kind.TRAVEL, 5.5))
    assert math.isfinite(width_penalty(Kind.TRAVEL, 4.8))


def test_an_unexplained_sideways_step_makes_both_stations_partial():
    def station(s, left, right, bands):
        return Station(s, 0, 0, left, right, SourceGrade.SURVEY, bands, "resolved")

    two = [Band(Kind.TRAVEL, 3.3, SourceGrade.INFERRED, 0.6, direction=-1),
           Band(Kind.TRAVEL, 3.3, SourceGrade.INFERRED, 0.6, direction=1)]
    steady = [station(0, 3.3, -3.3, two), station(4, 3.3, -3.3, two)]
    assert fit_longitudinal(steady) == 0
    # The same two lanes but the whole allocation shifted 1 m with the kerbs where they were.
    shifted = [Band(Kind.TRAVEL, 4.3, SourceGrade.INFERRED, 0.6, direction=-1),
               Band(Kind.TRAVEL, 2.3, SourceGrade.INFERRED, 0.6, direction=1)]
    stepped = [station(0, 3.3, -3.3, two), station(4, 3.3, -3.3, shifted)]
    assert fit_longitudinal(stepped) == 1
    assert all(s.status == "partial" for s in stepped)
    # A bulb-out explains a step: the kerb moved.
    bulb = [station(0, 3.3, -3.3, two), station(4, 3.3, -2.3, [two[0], Band(Kind.TRAVEL, 2.3, SourceGrade.INFERRED, 0.6, direction=1)])]
    assert fit_longitudinal(bulb) == 0


def test_lane_ends_and_a_junction_that_drops_a_lane_without_arrows():
    two = [Band(Kind.TRAVEL, 3.3, SourceGrade.INFERRED, 0.6, direction=-1),
           Band(Kind.TRAVEL, 3.3, SourceGrade.INFERRED, 0.6, direction=1),
           Band(Kind.TRAVEL, 3.3, SourceGrade.INFERRED, 0.6, direction=1)]
    st = Station(0, 0, 0, 5, -5, SourceGrade.SURVEY, two, "resolved")
    ends = lane_ends([st], "left|through")
    assert [e.end for e in ends] == ["start", "end"]
    assert ends[1].forward == 2 and ends[1].backward == 1 and ends[1].turns == ["left", "through"]
    # Across the box the continuation has one lane each way and this leg has no arrows.
    plain = LaneEnd("end", 3, 2, 1, [])
    other = LaneEnd("start", 2, 1, 1, [])
    assert match_junction([("Gough Street", plain), ("Gough Street", other)])
    assert not match_junction([("Gough Street", ends[1]), ("Gough Street", other)])


def test_parking_the_policies_missed_is_assumed_rather_than_a_six_metre_lane():
    """A 13 m one-way street tagged lanes=2 with no parking record: two 6.5 m lanes are not a
    hypothesis, and three 4.3 m lanes contradict the map. Parking both sides, inferred and
    said so, lets the map's two lanes close the width."""
    bands, status, reasons, _ = allocate(13.0, [], [], oneway=True, lanes_tag=2)
    assert [b.kind for b in bands] == [Kind.PARKING, Kind.TRAVEL, Kind.TRAVEL, Kind.PARKING], bands
    assert all(b.grade is SourceGrade.INFERRED and b.confidence < 0.5 for b in bands if b.kind is Kind.PARKING)
    assert status == "partial" and any("assumed" in r for r in reasons)


def test_the_payload_form_is_positional_and_decodable():
    bands, status, reasons, _ = allocate(13.0, [], [], oneway=True, lanes_tag=2)
    st = Station(12.0, -122.4, 37.79, 6.5, -6.5, SourceGrade.SURVEY, bands, status, reasons)
    row = st.to_json()
    assert row[:5] == [12.0, 6.5, -6.5, "S", "p"]
    assert [b[0] for b in row[5]] == ["p", "t", "t", "p"]
    assert row[6] == ["parkassume"]


def test_assumed_parking_goes_at_the_kerb_outside_a_bike_lane_and_inside_a_track():
    bands, _, _, _ = allocate(13.4, [bike()], [], oneway=False, lanes_tag=2)
    assert [b.kind for b in bands][:2] == [Kind.PARKING, Kind.BIKE]
    track = Band(Kind.BIKE, 1.7, SourceGrade.MAPPED, 0.8, subtype="track")
    bands, _, _, _ = allocate(13.4, [track], [], oneway=False, lanes_tag=2)
    assert [b.kind for b in bands][:2] == [Kind.BIKE, Kind.PARKING]


def test_a_measured_parking_band_outranks_the_policy_prior_and_a_measured_absence_removes_it():
    from smc.facts.build_cross_sections import parking_band_for_side

    way = {"cnn": "sfcnn:1", "parking_sides": [1, -1]}
    measured = {"sfcnn:1:1": {"status": "measured", "width_m": 2.14, "sigma_m": 0.06,
                              "vehicles": 23, "dates": 5},
                "sfcnn:1:-1": {"status": "none"}}
    left = parking_band_for_side(way, 1, measured)
    assert left.grade is SourceGrade.IMAGE and left.width_m == 2.14 and left.confidence == 0.9
    assert parking_band_for_side(way, -1, measured) is None
    prior = parking_band_for_side(way, 1, {})
    assert prior.grade is SourceGrade.INFERRED and prior.width_m == 2.3
    assert parking_band_for_side({"cnn": "sfcnn:2"}, 1, {}) is None
