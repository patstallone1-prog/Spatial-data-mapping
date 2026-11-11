"""Buildings OSM is missing, added from DataSF footprints (smc.regions.building_gaps)."""

import json
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


def test_a_footprint_listed_twice_is_one_building():
    twice = [footprint(-122.4330, 37.7990, 0.0003, bid="11")] * 2
    ways = []
    assert fill_building_gaps(ways, twice) == 1
    corridor = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())["ways"]
    ids = [w["osm_id"] for w in corridor if w.get("kind") == "building" and w.get("osm_id") is not None]
    assert len(ids) == len(set(ids))


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


def test_overture_footprints_fill_the_rest_of_the_map_and_keep_off_the_street():
    from smc.regions.building_gaps import median_height, overture_rows

    ways = [
        {"kind": "building", "osm_id": 1, "points": square(-122.0800, 37.4000, 0.0003), "height_m": 8.0},
        {"kind": "street", "name": "Castro Street", "road_m": 14.0, "points": [[-122.0790, 37.3995], [-122.0790, 37.4010]]},
    ]
    def geo(x, y, d):
        return json.dumps({"type": "Polygon", "coordinates": [square(x, y, d)]})
    records = [
        ("ovt-1", None, None, "Microsoft ML Buildings", geo(-122.0780, 37.4000, 0.0003)),   # an empty lot in OSM: added
        ("ovt-2", 11.0, None, "OpenStreetMap", geo(-122.0770, 37.4000, 0.0003)),            # OSM's own: left
        ("ovt-3", None, 2, "Microsoft ML Buildings", geo(-122.07905, 37.4001, 0.0001)),     # on the carriageway: left
    ]
    rows = overture_rows(records, fallback_m=median_height(ways))
    assert [r["area_id"] for r in rows] == ["ovt-1", "ovt-3"]
    added = missing_buildings(ways, rows)
    assert len(added) == 1
    assert added[0]["source"] == "overture:Microsoft ML Buildings" and added[0]["height_source"] == "regional_median_estimate"
    assert added[0]["height_m"] == 8.0 and added[0]["osm_id"] < 0


def test_the_whole_map_is_filled_through_the_asset_map():
    tool = (ROOT / "tools/fill_building_gaps_regions.py").read_text(encoding="utf-8")
    assert "fill_building_gaps(ways, fetch_footprints(part, cache))" in tool
    assert "overture_rows(overture_in(con, parquet, bbox), fallback_m=median_height(ways))" in tool
    assert 'files[key] = chunk' in tool and "store.put_file(chunk, out" in tool


def test_a_footprint_traced_over_the_streets_edge_is_left_out_and_pruned():
    from smc.regions.building_gaps import prune_on_road

    street = {"kind": "street", "name": "Polk Street", "road_m": 14.0, "points": [[-122.4200, 37.7990], [-122.4200, 37.8010]]}
    # Its middle is off the road, but its west corners are 5 m into the carriageway.
    over = footprint(-122.42005, 37.8000, 0.0002, bid="21")
    clear = footprint(-122.4198, 37.8000, 0.0002, bid="22")
    assert [w["osm_id"] for w in missing_buildings([street], [over, clear])] == [missing_buildings([street], [clear])[0]["osm_id"]]
    # A payload filled before the rule: the added one on the road goes, OSM's stays.
    added = missing_buildings([], [over])[0]
    osm = {**added, "osm_id": 5, "source": None, "tags": {"building": "yes"}}
    ways = [street, added, osm]
    assert prune_on_road(ways) == 1 and ways == [street, osm]
    tool = (ROOT / "tools/fill_building_gaps_regions.py").read_text(encoding="utf-8")
    assert 'return {"pruned": prune_on_road(ways)}' in tool
