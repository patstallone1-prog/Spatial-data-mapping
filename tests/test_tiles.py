"""The visual tile tree: where the tiles are, how wrong they are, and what is in them."""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path

import pytest

from smc.tiles.compile import assets_for, oriented_box, ring_area_m2, simplify, way_in_box
from smc.tiles.tree import (
    DEEPEST_BUILT,
    MAX_DEPTH,
    Frame,
    TileId,
    error_at,
    refine_distance_m,
    screen_error,
    tile_at,
    tile_box,
    tiles_covering,
)

ROOT = Path(__file__).resolve().parents[1]
BAY = Frame(-122.601, 37.253, -121.784, 37.952).squared()


def test_the_root_is_square_and_every_tile_of_a_depth_tiles_it():
    assert abs((BAY.east - BAY.west) * BAY.metres_per_lon - (BAY.north - BAY.south) * BAY.metres_per_lat) < 1.0
    assert 70_000 < BAY.span_m < 90_000
    for depth in (0, 1, 3):
        boxes = [tile_box(BAY, TileId(depth, x, y))
                 for y in range(2 ** depth) for x in range(2 ** depth)]
        assert len(boxes) == 4 ** depth
        # They cover the root exactly and do not overlap: the areas add up.
        area = sum((b.east - b.west) * (b.north - b.south) for b in boxes)
        assert abs(area - (BAY.east - BAY.west) * (BAY.north - BAY.south)) < 1e-9


def test_a_point_lands_in_the_tile_that_contains_it_at_every_depth():
    lon, lat = -122.2725, 37.8050              # downtown Oakland
    for depth in range(MAX_DEPTH + 1):
        tile = tile_at(BAY, depth, lon, lat)
        box = tile_box(BAY, tile)
        assert box.west <= lon <= box.east and box.south <= lat <= box.north
        if depth:
            assert tile.parent == tile_at(BAY, depth - 1, lon, lat)
            assert tile in tile.parent.children


def test_a_box_is_covered_by_the_tiles_that_touch_it():
    box = {"west": -122.45, "south": 37.78, "east": -122.39, "north": 37.81}
    tiles = list(tiles_covering(BAY, 6, box))
    assert tiles, "a region has to fall in some tile"
    for corner in ((box["west"], box["south"]), (box["east"], box["north"]),
                   (box["west"], box["north"]), (box["east"], box["south"])):
        assert tile_at(BAY, 6, *corner) in tiles


def test_the_error_falls_with_depth_and_decides_when_each_thing_appears():
    errors = [error_at(d) for d in range(MAX_DEPTH + 1)]
    assert errors == sorted(errors, reverse=True), errors
    # A child must be better than its parent, or refining would never help.
    assert all(a > b for a, b in itertools.pairwise(errors))
    # What the depths mean, at a 900 px view and 50 degrees: the skyline from eight
    # kilometres, real footprints inside a kilometre, and the leaf only when you are on it.
    shown = {d: refine_distance_m(d, 3.0, 900, 50) for d in range(MAX_DEPTH + 1)}
    assert 7_000 < shown[1] < 9_000
    assert 900 < shown[5] < 1_100
    assert shown[MAX_DEPTH] < 60


def test_screen_error_is_the_error_projected_and_falls_off_with_distance():
    # A metre of error at a kilometre, in a 900 px view at 50 degrees, is about a pixel.
    one = screen_error(1.0, 1000.0, 900, 50)
    assert 0.9 < one < 1.1
    # Twice as far is half as wrong; twice the error is twice as wrong.
    assert screen_error(1.0, 2000.0, 900, 50) == pytest.approx(one / 2)
    assert screen_error(2.0, 1000.0, 900, 50) == pytest.approx(one * 2)
    # And the refine distance is the inverse of it: at that distance the error is the budget.
    for depth in range(MAX_DEPTH + 1):
        at = refine_distance_m(depth, 3.0, 900, 50)
        assert screen_error(error_at(depth), at, 900, 50) == pytest.approx(3.0)


def test_douglas_peucker_keeps_the_shape_and_drops_what_cannot_be_seen():
    box = Frame(-122.41, 37.79, -122.40, 37.80)
    # A straight run with a wobble smaller than the tolerance, and one bigger.
    def at(x_m, y_m):
        return [box.west + x_m / box.metres_per_lon, box.south + y_m / box.metres_per_lat]
    line = [at(0, 0), at(25, 0.3), at(50, 0), at(75, 6.0), at(100, 0)]
    kept = simplify(line, 1.0, box)
    assert len(kept) == 4 and kept[0] == line[0] and kept[-1] == line[-1]
    assert line[1] not in kept and line[3] in kept          # the wobble goes, the bend stays
    assert simplify(line, 12.0, box) == [line[0], line[-1]]


def test_a_building_becomes_the_rectangle_that_fits_it_at_its_own_angle():
    box = Frame(-122.41, 37.79, -122.40, 37.80)
    def at(x_m, y_m):
        return [box.west + x_m / box.metres_per_lon, box.south + y_m / box.metres_per_lat]
    # A 40 x 10 m block turned thirty degrees off the axes.
    angle = math.radians(30)
    corners = [(0, 0), (40, 0), (40, 10), (0, 10)]
    ring = [at(x * math.cos(angle) - y * math.sin(angle) + 100,
               x * math.sin(angle) + y * math.cos(angle) + 100) for x, y in corners]
    assert ring_area_m2(ring, box) == pytest.approx(400, rel=0.02)
    cx, cy, half_a, half_b, bearing = oriented_box(ring, box)
    sides = sorted((half_a * 2, half_b * 2))
    assert sides[0] == pytest.approx(10, abs=0.5) and sides[1] == pytest.approx(40, abs=0.5)
    assert math.hypot(cx - 100 - (20 * math.cos(angle) - 5 * math.sin(angle)),
                      cy - 100 - (20 * math.sin(angle) + 5 * math.cos(angle))) < 0.5
    # The bearing is the block's own, to a right angle.
    assert min(abs((math.degrees(bearing) - 30) % 90), 90 - abs((math.degrees(bearing) - 30) % 90)) < 1.0


def test_a_tile_carries_a_whole_picture_of_its_square_and_less_of_it_when_it_is_coarser():
    box = Frame(-122.41, 37.79, -122.40, 37.80)
    def at(x_m, y_m):
        return [box.west + x_m / box.metres_per_lon, box.south + y_m / box.metres_per_lat]
    def block(x, y, w, h, height):
        return {"kind": "building", "height_m": height,
                "points": [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h), at(x, y)]}
    ways = [block(0, 0, 60, 40, 30),          # a big one: in at every depth
            block(200, 200, 8, 8, 6),         # a garage: only when the error is small
            {"kind": "street", "road_m": 20.0, "points": [at(0, 100), at(400, 100)]},
            {"kind": "street", "road_m": 6.0, "points": [at(100, 0), at(100, 400)]}]
    coarse = assets_for(ways, box, 2)
    fine = assets_for(ways, box, 4)
    deep = assets_for(ways, box, 6)
    # Coarse: the big block as a box, and only the wide road.
    assert len(coarse["massing"]) == 1 and len(coarse["roads_major"]) == 1
    # Finer: both buildings as boxes, both roads.
    assert len(fine["massing"]) == 2 and len(fine["roads"]) == 2
    # Deep: the buildings are their own footprints, not boxes.
    assert "massing" not in deep and len(deep["buildings"]) == 2 and len(deep["roads"]) == 2
    # Every depth draws roads *and* buildings: a tile is never half a picture.
    for assets in (coarse, fine, deep):
        assert any(k in assets for k in ("massing", "buildings")) and any("road" in k for k in assets)


def test_a_way_belongs_to_a_tile_it_crosses_even_with_no_vertex_in_it():
    box = Frame(-122.41, 37.79, -122.40, 37.80)
    through = {"kind": "street", "points": [[-122.42, 37.795], [-122.39, 37.795]]}
    past = {"kind": "street", "points": [[-122.42, 37.85], [-122.39, 37.85]]}
    assert way_in_box(through, box) and not way_in_box(past, box)


@pytest.mark.skipif(not (ROOT / "docs" / "tiles" / "index.json").exists(), reason="no tile tree built")
def test_the_built_tree_is_whole_and_every_child_is_reachable_from_the_root():
    index = json.loads((ROOT / "docs" / "tiles" / "index.json").read_text())
    tiles = {t["id"]: t for t in index["tiles"]}
    assert "0/0/0" in tiles, "the Bay Area is always there"
    assert index["max_depth"] == DEEPEST_BUILT
    seen = set()
    stack = ["0/0/0"]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        tile = tiles[current]
        depth = int(current.split("/")[0])
        assert tile["geometric_error_m"] == pytest.approx(error_at(depth))
        for child in tile["children"]:
            assert child in tiles, f"{current} names a child that is not in the tree: {child}"
            assert int(child.split("/")[0]) == depth + 1
            stack.append(child)
    assert seen == set(tiles), "every tile has to be reachable from the root, or it is never drawn"
    # And every asset the index prices is really there, at the size it says.
    for tile in tiles.values():
        for name, meta in (tile["assets"] or {}).items():
            path = ROOT / "docs" / "tiles" / meta["url"]
            assert path.exists(), f"{tile['id']} {name} is missing"
            assert path.stat().st_size == meta["bytes"]
