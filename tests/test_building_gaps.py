"""Buildings OSM is missing, added from DataSF footprints (smc.regions.building_gaps)."""

from pathlib import Path

from smc.regions.building_gaps import fill_building_gaps, missing_buildings

ROOT = Path(__file__).resolve().parents[1]


def square(x, y, d):
    return [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]


def footprint(x, y, d, height=9.0, bid="1"):
    return {"sf16_bldgid": bid, "hgt_median_m": str(height), "shape": {"type": "Polygon", "coordinates": [square(x, y, d)]}}


def test_a_footprint_osm_has_no_building_for_is_added_once():
    ways = [{"kind": "building", "osm_id": 1, "points": square(-122.4340, 37.7990, 0.0003)}]
    rows = [
        footprint(-122.43398, 37.79902, 0.00025, bid="10"),      # inside the OSM building: covered
        footprint(-122.4330, 37.7990, 0.0003, bid="11"),         # an empty lot in OSM: added
        footprint(-122.4320, 37.7990, 0.00004, bid="12"),        # a shed: too small
        footprint(-122.4310, 37.7990, 0.0003, height=2.0, bid="13"),  # a wall or canopy: too low
    ]
    added = missing_buildings(ways, rows)
    assert [w["tags"]["source"] for w in added] == ["datasf:ynuv-fyni"]
    w = added[0]
    assert w["kind"] == "building" and w["osm_id"] < 0 and w["height_m"] == 9.0
    assert w["points"][0] == w["points"][-1] and len(w["points"]) == 5
    assert fill_building_gaps(ways, rows) == 1
    assert fill_building_gaps(ways, rows) == 0          # idempotent


def test_open_ground_drawn_on_the_map_is_left_open():
    ways = [{"kind": "sidewalk", "points": square(-122.4331, 37.7989, 0.0005)}]
    assert missing_buildings(ways, [footprint(-122.4330, 37.7990, 0.0003)]) == []


def test_the_tool_and_the_corridor_build_both_fill_from_the_cache():
    tool = (ROOT / "tools/fill_building_gaps.py").read_text(encoding="utf-8")
    assert "fill_building_gaps(payload[\"ways\"], footprints)" in tool
    build = (ROOT / "scripts/build_sf_corridor_3d.py").read_text(encoding="utf-8")
    assert "datasf-footprints-marina.json" in build and "fill_building_gaps(ways, gap_rows)" in build
    # Before the shopfronts are attached, so a business in an added building finds it.
    assert build.index("fill_building_gaps(ways, gap_rows)") < build.index("shopfronts = attach_shopfronts(ways)")
