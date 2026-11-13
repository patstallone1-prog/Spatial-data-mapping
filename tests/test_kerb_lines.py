"""The lidar's median lines kept out of junctions (smc.regions.kerb_lines)."""

import math
from pathlib import Path

from smc.regions.kerb_lines import clip_lidar_kerb_lines

ROOT = Path(__file__).resolve().parents[1]

LON0, LAT0 = -122.4363, 37.7999
MX, MY = 111_320.0 * math.cos(math.radians(LAT0)), 110_540.0


def ll(x, y):
    return [LON0 + x / MX, LAT0 + y / MY]


def street(name, a, b, road_m=10.0, **extra):
    return {"kind": "street", "name": name, "points": [ll(*a), ll(*b)], "road_m": road_m, **extra}


WAYS = [
    street("Lombard Street", (-200, 0), (200, 0), 20.0),
    street("Fillmore Street", (0, -100), (0, 100), 12.0),          # crosses at x = 0
    street(None, (60, -30), (60, 30), 3.3, service="driveway"),    # a driveway: not a junction
]


def median(x0, x1, step=5.0):
    n = int((x1 - x0) / step)
    return {"c": "curb", "r": "median", "s": "lidar", "p": [ll(x0 + i * step, 0.0) for i in range(n + 1)]}


def xs(line):
    return [round((p[0] - LON0) * MX) for p in line["p"]]


def test_a_median_line_stops_short_of_the_cross_street_and_its_crosswalk():
    out, stats = clip_lidar_kerb_lines([median(-100, 100)], WAYS)
    assert stats["cut_at_junctions"] == 1 and len(out) == 2
    west, east = sorted(out, key=lambda c: xs(c)[0])
    # Fillmore's kerb is 6 m from its middle; the crosswalk and a step beyond, 4 m more.
    assert max(xs(west)) <= -10 and min(xs(east)) >= 10
    # The driveway at x = 60 does not cut it.
    assert max(xs(east)) == 100


def test_the_surveyed_island_is_not_drawn_twice_and_other_lines_are_left_alone():
    surveyed = {"c": "curb", "r": "island", "p": [ll(20, 1.0), ll(150, 1.0)]}
    lidar_copy = {"c": "curb", "r": "island", "s": "lidar", "p": [ll(25 + i * 5, 1.3) for i in range(20)]}
    block = {"c": "curb", "r": "block", "p": [ll(-50, 12), ll(50, 12)]}
    out, stats = clip_lidar_kerb_lines([surveyed, lidar_copy, block], WAYS)
    assert stats["duplicates"] == 1
    assert out == [surveyed, block]


def test_an_island_read_wide_over_a_painted_strip_is_not_a_second_island():
    """Fillmore at Bay: the lidar's plateau ran on past the surveyed island's far kerb over a
    painted strip in the lanes. Its near edge was the island's kerb (dropped as a copy); its far
    edge, zigzagging 3 to 6 m out in the road, was drawn as an island kerb of its own."""
    surveyed = {"c": "curb", "r": "island", "p": [ll(20, 0.5), ll(150, 0.5), ll(150, -0.5), ll(20, -0.5), ll(20, 0.5)]}
    far_edge = {"c": "curb", "r": "island", "s": "lidar",
                "p": [ll(25 + i * 5, 4.0 + (1.5 if i % 2 else 0.0)) for i in range(20)]}
    out, stats = clip_lidar_kerb_lines([surveyed, far_edge], WAYS)
    assert out == [surveyed] and stats["duplicates"] == 1


def test_a_lidar_island_where_the_survey_has_none_is_kept():
    surveyed = {"c": "curb", "r": "island", "p": [ll(20, 30.0), ll(150, 30.0)]}
    own = {"c": "curb", "r": "island", "s": "lidar", "p": [ll(25 + i * 5, 1.0) for i in range(20)]}
    # A surveyed kerb across the lidar line (a cross street's island end) is not the same island.
    across = {"c": "curb", "r": "island", "p": [ll(60, -3.0), ll(60, 3.0)]}
    out, stats = clip_lidar_kerb_lines([surveyed, across, own], WAYS)
    assert out == [surveyed, across, own] and stats["duplicates"] == 0


def test_a_piece_left_by_the_junction_cut_on_the_surveyed_island_is_dropped():
    """The copy test ran on the whole line before the cut: a line mostly through the junction
    passed it, and the piece the cut left lay on the surveyed island's kerb."""
    surveyed = {"c": "curb", "r": "island", "p": [ll(10, 1.0), ll(60, 1.0)]}
    through = {"c": "curb", "r": "island", "s": "lidar",
               "p": [ll(-60 + i * 5, 1.2 if i * 5 - 60 >= 10 else 9.0) for i in range(25)]}
    out, stats = clip_lidar_kerb_lines([surveyed, through], WAYS)
    kept = [c for c in out if c.get("s") == "lidar"]
    assert kept and all(max(xs(c)) < 0 for c in kept), "nothing of it is left along the surveyed island"
    assert stats["duplicates"] == 1


def test_the_lidar_median_pass_and_the_tool_both_clip():
    measure = (ROOT / "scripts/measure_medians_lidar.py").read_text(encoding="utf-8")
    assert "clip_lidar_kerb_lines(" in measure
    tool = (ROOT / "tools/clip_lidar_kerb_lines.py").read_text(encoding="utf-8")
    assert "clip_lidar_kerb_lines(official.get(\"curb_lines\", []), ways)" in tool and "build_window_cells.py" in tool
