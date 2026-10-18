import json
import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LIGHTS = runpy.run_path(str(ROOT / "scripts/ingest_streetlights.py"))


def sj(**row):
    return {"OBJECTID": 1, "BADGEID": "P1", "LIGHTSTATUS": "EXISTING", "ISDUPLICATE": "No",
            "POLEUSE": "ST LIGHT ONLY", "lon": -121.89, "lat": 37.33, **row}


def test_san_jose_roadway_light_is_a_mast_arm_and_building_lights_are_not_poles():
    records = LIGHTS["san_jose_records"]([
        sj(LIGHTFIXTURETYPE="ROADWAY-LED", MOUNTTYPE="MAST ARM"),
        sj(BADGEID="P2", LIGHTFIXTURETYPE="SOFFIT", MOUNTTYPE="SOFFIT"),
        sj(BADGEID="P3", LIGHTFIXTURETYPE="UPLIGHT", MOUNTTYPE="UPLIGHT"),
        sj(BADGEID="P4", LIGHTFIXTURETYPE="ROADWAY-LED", MOUNTTYPE="MAST ARM", LIGHTSTATUS="REMOVED"),
        sj(BADGEID="P5", LIGHTFIXTURETYPE="ROADWAY-LED", MOUNTTYPE="MAST ARM",
           POLEUSE="ST LIGHT & TRAFFIC SIGNAL"),
    ])
    assert [r["id"] for r in records] == ["sanjose:streetlight:P1"]
    assert records[0]["form"] == "mast_arm" and records[0]["provenance"] == "official_asset_point"


def test_san_jose_two_fixtures_on_one_pole_draw_one_pole_with_its_arm():
    records = LIGHTS["san_jose_records"]([
        sj(LIGHTFIXTURETYPE="POST TOP-ACORN", MOUNTTYPE="POST TOP"),
        sj(OBJECTID=2, LIGHTFIXTURETYPE="ROADWAY-LED", MOUNTTYPE="MAST ARM"),
    ])
    assert len(records) == 1 and records[0]["form"] == "mast_arm"


def bk(**row):
    return {"facilityid": "S1", "installed": "YES", "the_geom": {"type": "Point", "coordinates": [-122.27, 37.87]},
            "pole_mater": "Metal", "mounting_h": "25-30 feet", "arm_length": "6", "heads": "Single", **row}


@pytest.mark.parametrize("row, form, finish", [
    ({}, "mast_arm", "galvanized_steel"),
    ({"pole_mater": "Wood"}, "mast_arm", "wood"),
    ({"mounting_h": "< 25 feet", "arm_length": "2"}, "post_top", "dark_steel"),
    ({"mounting_h": "< 25 feet", "arm_length": "2", "heads": "Twin"}, "twin_pendant", "dark_steel"),
])
def test_berkeley_forms(row, form, finish):
    (record,) = LIGHTS["berkeley_records"]([bk(**row)])
    assert (record["form"], record["finish"]) == (form, finish)


def test_berkeley_heights_are_the_middle_of_the_band():
    (record,) = LIGHTS["berkeley_records"]([bk()])
    assert record["height_m"] == round(27.5 * 0.3048, 2) and record["arm_m"] == round(6 * 0.3048, 2)


@pytest.mark.parametrize("region, per_km", [("san-jose-downtown", 10), ("berkeley-downtown", 10)])
def test_cities_that_publish_their_lights_draw_them(region, per_km):
    furniture = json.loads((ROOT / "docs/regions" / region / "sf-corridor-furniture.json").read_text())
    lights = furniture["geometry_based"]["street_lights"]
    assert len(lights) > per_km * 50
    assert all(light["provenance"] == "official_asset_point" for light in lights)
