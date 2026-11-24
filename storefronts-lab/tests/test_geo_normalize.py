import pytest

from kerbfront.geo import Frame, ang_diff, bearing, ccw, signed_area
from kerbfront.normalize import name_sim, parse_address, same_address, street_key


def test_bearings_are_compass():
    assert bearing(0, 1) == pytest.approx(0)
    assert bearing(1, 0) == pytest.approx(90)
    assert bearing(0, -1) == pytest.approx(180)
    assert bearing(-1, 0) == pytest.approx(270)
    assert ang_diff(10, 350) == pytest.approx(20)
    assert ang_diff(350, 10) == pytest.approx(-20)


def test_frame_round_trip_and_ccw():
    f = Frame(37.80, -122.44)
    x, y = f.xy(-122.43, 37.81)
    lon, lat = f.lonlat(x, y)
    assert (lon, lat) == pytest.approx((-122.43, 37.81), abs=1e-9)
    assert 870 < x < 890 and 1105 < y < 1120     # ~0.01 deg lon/lat at SF latitude
    cw = [(0, 0), (0, 1), (1, 1), (1, 0)]
    assert signed_area(ccw(cw)) > 0


@pytest.mark.parametrize("text,expect", [
    ("2001-2005 Chestnut St #A", (2001, 2005, "CHESTNUT ST", "#A", False)),
    ("1830   UNION ST", (1830, None, "UNION ST", None, False)),
    ("2064 Union St 2nd Flr", (2064, None, "UNION ST", "2ND FLR", True)),
    ("2155 Union St Ste 201", (2155, None, "UNION ST", "STE 201", True)),
    ("3200 Van Ness Avenue", (3200, None, "VAN NESS AVE", None, False)),
])
def test_parse_address(text, expect):
    a = parse_address(text)
    assert (a["number"], a["number_hi"], a["street"], a["unit"], a["upper_floor"]) == expect


def test_suite_is_not_upper_floor_but_is_flagged():
    a = parse_address("2155 Union St Ste 5")
    assert not a["upper_floor"] and a["suite"]


def test_same_address_overlaps_ranges():
    assert same_address(parse_address("2001-2005 Chestnut St"), parse_address("2003 Chestnut Street"))
    assert not same_address(parse_address("2001 Chestnut St"), parse_address("2001 Lombard St"))
    assert street_key("Chestnut Street") == "CHESTNUT ST"


def test_name_similarity():
    assert name_sim("PACIFIC CATCH, INC.", "Pacific Catch") == 1.0
    assert name_sim("The Roaming Goat", "ROAMING GOAT") == 1.0
    assert name_sim("Sweetgreen San Francisco Chestnut", "Sweetgreen") >= 0.9
    assert name_sim("Joybird", "Williams-Sonoma") < 0.5
