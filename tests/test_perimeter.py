"""The country round a region: the map's coastline flooded from known water, the leak into
land refused, and the bridges' vertices told over water from over land."""

from __future__ import annotations

import numpy as np

from smc.terrain.perimeter import bridges, classify, flood, frame_for, rasterise_lines

FRAME = {"mid_lon": -122.4, "mid_lat": 37.8, "metres_per_lon": 88_000.0, "metres_per_lat": 111_320.0,
         "x0": -2000.0, "y0": -2000.0, "step_m": 40.0, "cols": 100, "rows": 100}


def lonlat(x: float, y: float) -> list[float]:
    return [-122.4 + x / 88_000.0, 37.8 + y / 111_320.0]


def _way(points, tags, kind="way"):
    return {"type": kind, "tags": tags, "geometry": [{"lon": p[0], "lat": p[1]} for p in points]}


def test_a_coastline_splits_the_box_and_the_flood_stays_on_its_side_islands_included():
    # A shore running north-south at x = 0: town to the west, bay to the east; an island ringed
    # by coastline out in the bay; a lake polygon in the town.
    shore = _way([lonlat(0, -3000), lonlat(0, 3000)], {"natural": "coastline"})
    island = _way([lonlat(800, 400), lonlat(1200, 400), lonlat(1200, 800), lonlat(800, 800), lonlat(800, 400)], {"natural": "coastline"})
    lake = _way([lonlat(-1500, -1500), lonlat(-1100, -1500), lonlat(-1100, -1100), lonlat(-1500, -1100), lonlat(-1500, -1500)], {"natural": "water"})
    seeds = np.zeros((100, 100), dtype=bool)
    seeds[50, 90] = True                                   # one cell of known water, far out in the bay
    water, counts = classify([shore, island, lake], FRAME, seeds, buildings=[])
    assert water[50, 90] and water[50, 60] and not water[50, 10]           # bay east, town west
    assert not water[65, 75]                                              # inside the island: land
    assert water[15, 15]                                                  # the lake, from its polygon
    assert counts["bodies"] == 1 and counts["bodies_rejected_as_land"] == 0
    assert 0.35 < water.mean() < 0.55


def test_a_body_with_the_regions_buildings_in_it_is_land_the_flood_leaked_into():
    shore = _way([lonlat(0, -3000), lonlat(0, 3000)], {"natural": "coastline"})
    seeds = np.zeros((100, 100), dtype=bool)
    seeds[50, 10] = True                                   # a spurious low cell in the town
    seeds[50, 90] = True                                   # and the bay
    houses = [lonlat(-1800 + 10 * i, -500 + 20 * i) for i in range(60)]      # all in the town
    water, counts = classify([shore], FRAME, seeds, buildings=houses)
    assert counts["bodies"] == 2 and counts["bodies_rejected_as_land"] == 1
    assert water[50, 90] and not water[50, 10]


def test_a_bridge_is_sampled_along_its_length_and_knows_where_it_is_over_water():
    shore = _way([lonlat(0, -3000), lonlat(0, 3000)], {"natural": "coastline"})
    seeds = np.zeros((100, 100), dtype=bool)
    seeds[50, 90] = True
    water, _ = classify([shore], FRAME, seeds, buildings=[])
    span = _way([lonlat(-600, 0), lonlat(1600, 0)], {"bridge": "yes", "highway": "motorway", "lanes": "5"})
    out = bridges([span], FRAME, water)
    assert len(out) == 1 and out[0]["lanes"] == 5
    assert len(out[0]["points"]) > 40                      # densified to the cell size
    over = out[0]["over_water"]
    assert not over[0] and over[-1] and 0.6 < sum(over) / len(over) < 0.8


def test_rasterised_walls_are_eight_connected_so_no_flood_slips_through():
    diagonal = [[lonlat(-3000, -3000), lonlat(3000, 3000)]]
    wall = rasterise_lines(diagonal, FRAME)
    seeds = np.zeros((100, 100), dtype=bool)
    seeds[5, 90] = True                                    # south-east corner
    water = flood(seeds, wall)
    assert water[5, 90] and not water[90, 5]               # never reaches the north-west
    frame = frame_for({"south": 37.79, "west": -122.41, "north": 37.81, "east": -122.39}, FRAME)
    assert frame["cols"] > 400 and frame["rows"] > 400     # five miles each way at 40 m
