"""Where a city's parcels, parks and trees come from, and what happens when they do not come.

Three cities outside San Francisco had no ground cover at all -- San Jose none of any kind,
Berkeley and Palo Alto parks without parcels or trees -- because the only adapter the builder
had was Socrata's, and Palo Alto and San Jose keep their records on ArcGIS. This is that
adapter, and the rule that a network failure is not an answer.
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "src"))

ground = importlib.import_module("build_ground_cover")
measure = importlib.import_module("measure_region_lidar")


def test_every_arcgis_city_names_a_service_and_a_layer_for_what_it_claims():
    for city, kinds in ground.ARCGIS_SOURCES.items():
        assert ground.CITY_SOURCES.get(city, {}).get("arcgis"), f"{city} is not routed to ArcGIS"
        for kind, spec in kinds.items():
            if not isinstance(spec, dict):
                continue            # a recorded gap, e.g. parks that are points not polygons
            assert kind in ("parks", "parcels", "trees"), kind
            assert spec["service"].startswith("https://"), spec
            assert isinstance(spec["layer"], int), spec
            if kind == "trees":
                assert spec.get("species") and spec.get("dbh"), spec
            else:
                assert spec.get("name"), spec


def test_a_city_on_arcgis_is_not_read_through_the_socrata_path():
    """The two portals answer different shapes; asking one in the other's language gets nothing."""
    for city in ground.ARCGIS_SOURCES:
        assert not ground.CITY_SOURCES[city].get("host"), city


def test_a_polygon_layer_and_a_point_layer_come_back_in_the_shapes_the_builder_reads(monkeypatch, tmp_path):
    """Whichever portal a city keeps, a shape is {geom, name} and a tree is {lon, lat, ...}."""
    pages = {
        "parcels": {"type": "FeatureCollection", "properties": {},
                    "features": [{"geometry": {"type": "Polygon", "coordinates": [[[0, 0]]]},
                                  "properties": {"APN": "123"}}]},
        "trees": {"type": "FeatureCollection", "properties": {},
                  "features": [{"geometry": {"type": "Point", "coordinates": [-121.9, 37.33]},
                                "properties": {"SPP": "PLAT", "DBH": "12"}}]},
    }
    kind_now = {"k": "parcels"}

    class Answer:
        def read(self):
            return json.dumps(pages[kind_now["k"]]).encode()

    monkeypatch.setattr(ground.urllib.request, "urlopen", lambda *a, **k: Answer())
    monkeypatch.setattr(ground, "CACHE", tmp_path)
    box = {"south": 37.32, "west": -121.91, "north": 37.35, "east": -121.87}

    rows = ground.fetch_arcgis("parcels", "san-jose", box, lambda *a: None)
    assert rows == [{"geom": {"type": "Polygon", "coordinates": [[[0, 0]]]}, "name": "123"}]

    kind_now["k"] = "trees"
    rows = ground.fetch_arcgis("trees", "san-jose", box, lambda *a: None)
    assert rows == [{"lon": -121.9, "lat": 37.33, "species": "PLAT", "dbh": "12"}]


def test_a_service_that_refuses_is_a_gap_with_a_reason_not_an_empty_answer(monkeypatch, tmp_path):
    def refuse(*a, **k):
        raise OSError("connection reset")

    monkeypatch.setattr(ground.urllib.request, "urlopen", refuse)
    monkeypatch.setattr(ground, "CACHE", tmp_path)
    ground.DATASF_REFUSED.clear()
    rows = ground.fetch_arcgis("parcels", "san-jose", {"south": 0, "west": 0, "north": 1, "east": 1},
                               lambda *a: None)
    assert rows == []
    assert "parcels" in ground.DATASF_REFUSED
    # And nothing was cached, so the next run asks again rather than believing the gap.
    assert not (tmp_path / "parcels.json").exists()


def test_a_cell_the_network_lost_is_not_a_cell_that_was_measured():
    """DNS failed for a few minutes and 670 cells across three regions were written off.

    Each was journalled as an answer -- streets {}, buildings {} -- and every later run
    skipped it as done. A transport failure says nothing about the lidar, so it is marked to
    be tried again; a refusal that is really about the data is not.
    """
    assert measure.transient("<urlopen error [Errno 8] nodename nor servname provided, or not known>")
    assert measure.transient("Remote end closed connection without response")
    assert measure.transient("<urlopen error [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred>")
    assert measure.transient("HTTP Error 503: Service Unavailable")
    # Not everything is the network's fault.
    assert not measure.transient("no such dataset")
    assert not measure.transient("the collection does not cover this cell")
