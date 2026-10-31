"""Overture's features in the shape of an Overpass answer, for the cells Overpass fails."""
import json
import runpy
from pathlib import Path

from smc.imagery.region import BBox
from smc.regions import overture_osm as ov

ROOT = Path(__file__).resolve().parents[1]


def test_roads_take_the_tags_the_builder_reads():
    assert ov.road_tags("primary", "link", "Doolittle Dr") == {"highway": "primary_link", "name": "Doolittle Dr"}
    assert ov.road_tags("footway", "sidewalk", None) == {"highway": "footway", "footway": "sidewalk"}
    assert ov.road_tags("footway", "crosswalk", None) == {"highway": "footway", "footway": "crossing"}
    assert ov.road_tags("service", "driveway", None) == {"highway": "service", "service": "driveway"}
    assert ov.road_tags("unknown", None, None) == {"highway": "road"}
    assert ov.road_tags("track", None, None) is None            # not asked of Overpass either
    flags = [{"values": ["is_bridge"], "between": None}, {"values": ["is_tunnel"], "between": [0.2, 0.4]}]
    assert ov.road_tags("motorway", None, None, flags) == {"highway": "motorway", "bridge": "yes"}


def test_buildings_and_water():
    assert ov.building_tags(None, 9.5, 3, None, "flat", None) == {
        "building": "yes", "height": "9.50", "building:levels": "3", "roof:shape": "flat"}
    assert ov.water_tags("physical", "bay", "San Francisco Bay") == {"natural": "water", "name": "San Francisco Bay"}
    assert ov.water_tags("human_made", "swimming_pool", None) is None
    poly = {"type": "MultiPolygon", "coordinates": [[[[0, 0], [1, 0], [1, 1], [0, 0]], [[.2, .2], [.3, .2], [.2, .3]]]]}
    assert ov.rings(poly) == [[[0, 0], [1, 0], [1, 1], [0, 0]]]  # the courtyard is not a building


class FakeDuck:
    """Answers each theme's query with prepared rows, last column the GeoJSON."""

    def __init__(self, rows):
        self.rows, self.sql = rows, []

    def execute(self, sql):
        self.sql.append(sql)
        theme = next(t for t in self.rows if f"theme={t}/" in sql)
        self._out = self.rows[theme]
        return self

    def fetchall(self):
        return self._out


def test_features_go_through_the_builders_own_reading():
    line = json.dumps({"type": "LineString", "coordinates": [[-122.25, 37.74], [-122.249, 37.741]]})
    square = json.dumps({"type": "Polygon", "coordinates": [[[-122.2501, 37.7401], [-122.2499, 37.7401],
                                                             [-122.2499, 37.7403], [-122.2501, 37.7403],
                                                             [-122.2501, 37.7401]]]})
    con = FakeDuck({
        "transportation": [("r1", "residential", None, "Island Dr", None, line)],
        "buildings": [("b1", "house", 7.0, 2, None, None, None, square)],
        "base": [],
    })
    bbox = BBox(south=37.73, west=-122.26, north=37.75, east=-122.23)
    found = ov.elements(bbox, con=con)
    assert ov.summary(found) == {"streets": 1, "buildings": 1, "water": 0}
    assert all("bbox.xmin <= -122.23" in sql and ov.RELEASE in sql for sql in con.sql)
    builder = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"), run_name="kerbside_builder")
    kinds = sorted(w.get("kind") for w in builder["osm_ways_from"]({"elements": found}, bbox))
    assert kinds == ["building", "street"]
