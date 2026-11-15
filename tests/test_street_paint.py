"""The city's stop signs, cleaned into paint facts, and the page's use of them."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from smc.paint.clean import SCHEMA, clean_stop_signs, facing_degrees, paint_document, street_key
from smc.renderer.template import renderer_source

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def _row(lon: float = -122.4395, lat: float = 37.8004, **fields: str) -> dict:
    return {"objectid": "1", "street": "CHESTNUT", "x_street": "PIERCE", "st_facing": "EB",
            "shape": {"type": "Point", "coordinates": [lon, lat]}, **fields}


def test_a_row_becomes_one_approach_with_a_bearing_and_street_keys() -> None:
    stops, dropped = clean_stop_signs([_row(street="CHESTNUT ST", x_street="PIERCE ST")])
    assert stops == [{"p": [-122.4395, 37.8004], "facing": 90.0, "street": "CHESTNUT", "cross": "PIERCE", "id": "1"}]
    assert dropped == {}


def test_rows_the_page_could_trip_over_are_dropped_and_counted() -> None:
    rows = [
        _row(),
        _row(objectid="2"),                                   # the same approach listed again
        _row(-122.43951, 37.80041, objectid="3"),             # and again, redigitised a metre off
        _row(objectid="4", st_facing="WB"),                   # the opposite approach: kept
        _row(objectid="5", st_facing=""),                     # no facing
        _row(objectid="6", st_facing="??"),
        {"objectid": "7", "street": "CHESTNUT", "st_facing": "EB"},          # no position
        _row(-121.9, 37.3, objectid="8"),                     # San Jose
        _row(objectid="9", street=""),                        # no street
        _row(-122.4412, 37.8002, objectid="10", x_street="SCOTT"),  # the next junction: kept
    ]
    stops, dropped = clean_stop_signs(rows)
    assert [s["id"] for s in stops] == ["10", "1", "4"] or sorted(s["id"] for s in stops) == ["1", "10", "4"]
    assert dropped == {"duplicate": 2, "no_facing": 2, "no_position": 1, "no_street": 1, "outside_city": 1}


def test_facings_and_street_keys() -> None:
    assert facing_degrees("NB") == 0.0 and facing_degrees(" sb ") == 180.0 and facing_degrees("NE") == 45.0
    assert facing_degrees(None) is None and facing_degrees("X") is None
    assert street_key("O'Farrell Street") == "OFARRELL"
    assert street_key("03RD ST") == "3RD"
    assert street_key("Van Ness Avenue") == "VAN NESS"
    assert street_key("Park") == "PARK"


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_python_and_the_page_agree_on_a_street_key() -> None:
    names = ["Chestnut Street", "22ND ST", "03RD ST", "O'Farrell Street", "Van Ness Avenue", "The Embarcadero",
             "Avenue of the Palms", "Park", "MARTIN LUTHER KING JR DR", "Saint-Joseph's Avenue", ""]
    script = ("import { streetKey } from './docs/street-paint.mjs';"
              f"console.log(JSON.stringify({json.dumps(names)}.map(streetKey)));")
    out = subprocess.run([NODE, "--input-type=module", "-"], input=script, capture_output=True, text=True,
                         cwd=ROOT, timeout=60)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == [street_key(name) for name in names]


def test_the_document_says_where_it_came_from_and_what_was_dropped() -> None:
    stops, dropped = clean_stop_signs([_row(), _row(objectid="2")])
    doc = paint_document(stops, dropped, "2026-09-30")
    assert doc["schema"] == SCHEMA == "kerbside.street_paint/1"
    assert doc["cleaned"] == {"kept": 1, "dropped": {"duplicate": 1}}
    assert doc["sources"][0]["url"].endswith("4542-gpa3") and "Public Domain" in doc["sources"][0]["licence"]


def test_the_published_file_is_the_saved_rows_cleaned() -> None:
    rows = json.loads((ROOT / "data/sf_public_works/stop_signs.json").read_text())
    stops, dropped = clean_stop_signs(rows)
    doc = json.loads((ROOT / "docs/street-paint.json").read_text())
    assert doc["stop_approaches"] == stops and doc["cleaned"]["dropped"] == dropped
    # Most of the city's rows survive; the Marina has its share.
    assert len(stops) > 0.9 * len(rows)
    assert sum(1 for s in stops if -122.45 < s["p"][0] < -122.42 and 37.795 < s["p"][1] < 37.808) > 100


def _function(js: str, name: str) -> str:
    start = js.index(f"function {name}(")
    return js[start:js.index("\n}\n", start)]


def test_every_paint_pass_claims_on_one_plan_and_it_is_laid_once() -> None:
    js = renderer_source()
    assert 'import(sharedAsset("street-paint.mjs?rev=__STREET_PAINT_HASH__"))' in js
    furniture = _function(js, "renderStreetFurniture")
    # The city's records are noted, then: arrows, red zones, stop boxes, legends -- and one lay.
    order = ["noteCityStopApproach(record)", "const paintPlan = newPaintPlan();", 'kind: "arrow", fixed: true',
             "addBusZonePaint(", "claimStopZones(paintPlan)", "paintRoadLegends(paintPlan)", "layStreetPaint(paintPlan)"]
    at = [furniture.index(piece) for piece in order]
    assert at == sorted(at)
    assert 'fetch(sharedAsset("street-paint.json")' in js
    # No pass lays paint of its own any more.
    stops = _function(js, "addTransitStops")
    assert "stopZones.push(" in stops and "new THREE.Mesh(" not in stops
    legends = _function(js, "paintRoadLegends")
    assert "plan.claim(" in legends and "groups.furniture.add" not in legends
    # A stop the city records is painted without a mapped crosswalk; a signalled junction's is a line only.
    assert "unmarkedStopLineAlong(a, at, (o0 + o1) / 2, onRoad)" in legends and "signalled.has(junctionKey(a))" in legends
    zones = _function(js, "claimStopZones")
    assert 'plan.overlapping(box, "zone", 1.0)' in zones and "within: home.id" in zones


def test_paint_put_down_as_one_thing_is_clipped_whole() -> None:
    js = renderer_source()
    lay = _function(js, "layStreetPaint")
    assert 'geometry.setAttribute("clipAt", new THREE.Float32BufferAttribute(list.at, 2))' in lay
    assert "material.userData.wholeClip = true" in lay
    assert "groundLiftAt(x, z) + ROAD_TOP_M + lift" in lay and "/ 0.5" in lay
    red = _function(js, "addBusZonePaint")
    assert "mesh.material.userData.wholeClip = true" in red and "liftedOntoGround: true" in red
    # Whole by its clipAt whether or not the mesh is instanced.
    clip = _function(js, "applyBoxClip")
    assert "${whole?'detailPosition=vec4(clipAt.x,0.0,clipAt.y,1.0);':'#ifdef USE_INSTANCING" in clip
