"""A carriageway drawn from a prior may not run under a building."""

from __future__ import annotations

from smc.facades.geometry import LocalFrame
from smc.facts.clearance import WALL_MARGIN_M, BuildingClearance


def _square(lon0: float, lat0: float, w_m: float) -> list[list[float]]:
    dlon, dlat = w_m / 88_000.0, w_m / 111_320.0
    return [[lon0, lat0], [lon0 + dlon, lat0], [lon0 + dlon, lat0 + dlat], [lon0, lat0 + dlat], [lon0, lat0]]


def test_an_alley_between_two_houses_is_bounded_by_their_walls():
    frame = LocalFrame(37.80, -122.42)
    # An alley running east along lat 37.80; a house 3 m to its north and one 3 m to its south.
    north = {"kind": "building", "points": _square(-122.42, 37.80 + 3.0 / 111_320.0, 20.0)}
    south = {"kind": "building", "points": _square(-122.42, 37.80 - 23.0 / 111_320.0, 20.0)}
    clearance = BuildingClearance([north, south, {"kind": "street", "points": []}], frame)
    assert clearance.walls == 8
    lon, lat = -122.42 + 10.0 / 88_000.0, 37.80
    left, right, walled = clearance.half_widths(lon, lat, 1.0, 0.0, half=5.6, minimum=1.2)
    assert walled
    assert abs(left - (3.0 - WALL_MARGIN_M)) < 0.05 and abs(right - (3.0 - WALL_MARGIN_M)) < 0.05
    # Out in the open the prior stands untouched.
    left, right, walled = clearance.half_widths(-122.41, 37.79, 1.0, 0.0, half=5.6, minimum=1.2)
    assert (left, right, walled) == (5.6, 5.6, False)
    # Never narrower than the minimum, whatever the wall says.
    tight = BuildingClearance([{"kind": "building", "points": _square(-122.42, 37.80 + 0.5 / 111_320.0, 20.0)}], frame)
    left, _, walled = tight.half_widths(lon, lat, 1.0, 0.0, half=5.6, minimum=1.2)
    assert walled and left == 1.2
