import json
from pathlib import Path

import pytest

from smc.buildings.lidar_heights import AGREE_M, adopt_lidar_height

ROOT = Path(__file__).resolve().parents[1]


def test_a_lidar_roof_confirms_a_mapped_height_it_agrees_with():
    way = {"height_m": 9.0, "height_source": "osm_height"}
    assert adopt_lidar_height(way, {"height_m": 9.6, "roof_points": 400}) == "confirmed"
    assert way == {"height_m": 9.6, "height_source": "lidar_region", "height_osm_m": 9.0,
                   "height_points": 400}


def test_a_mapped_height_the_lidar_disagrees_with_stands():
    way = {"height_m": 9.0, "height_source": "osm_height"}
    assert adopt_lidar_height(way, {"height_m": 9.0 + AGREE_M + 1, "roof_points": 400}) == "disagrees"
    assert way["height_source"] == "osm_height" and way["height_m"] == 9.0
    assert way["height_lidar_m"] == 13.0


@pytest.mark.parametrize("source", [None, "inferred_default", "osm_levels"])
def test_a_guess_takes_the_lidar(source):
    way = {"height_m": 6.0, "height_source": source}
    assert adopt_lidar_height(way, {"height_m": 14.2, "roof_points": 90}) == "adopted"
    assert way["height_source"] == "lidar_region" and "height_osm_m" not in way


def test_the_page_still_treats_a_confirmed_height_as_stated():
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "|| feature.height_osm_m != null;" in page
    assert '"height_osm_m"' in page


@pytest.mark.parametrize("region", ["sf-mission", "sf-haight-castro", "sf-sunset"])
def test_san_francisco_regions_draw_measured_roofs(region):
    path = ROOT / "docs/app-regions" / region / "sf-corridor-3d.json"
    if not path.exists():
        pytest.skip("app region not published")
    buildings = [w for w in json.loads(path.read_text())["ways"] if w.get("kind") == "building"]
    measured = sum(w.get("height_source") == "lidar_region" for w in buildings)
    assert measured / len(buildings) >= 0.75
