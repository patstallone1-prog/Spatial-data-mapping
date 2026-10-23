"""Municipal slabs resolve run-offs, never invent pavement or fence through paint."""
import copy
import gzip
import json
import math
from pathlib import Path

import pytest
from shapely.geometry import LineString, Point, Polygon

from smc.parks.courts import compile_courts
from tests.test_corridor_geometry_rules import _extract, _page_js
from tests.test_pins_and_zoom import run_js

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def evidence():
    ground = json.loads((ROOT / "docs/app-sf-corridor-ground.json").read_text())
    before = copy.deepcopy(ground)
    inventory = json.loads(gzip.decompress((ROOT / "data/sf_rpd/inventory.json.gz").read_bytes()))
    reviews = json.loads((ROOT / "data/park_courts/reviews.json").read_text())
    result = compile_courts(inventory, ground, reviews)
    assert ground == before, "source ground and rejected observations remain recoverable"
    return result


def test_moscone_has_two_pairs_of_tennis_not_an_extra_court_on_grass(evidence):
    west = [c for c in evidence["courts"] if -122.4346 < c["c"][0] < -122.4340 and 37.8015 < c["c"][1] < 37.8023]
    assert sorted(c["s"] for c in west) == ["basketball", "tennis", "tennis"]
    assert all(c.get("pad_id") for c in west)
    assert all(c["l"] == 23.77 and c["w"] == 10.97 for c in west if c["s"] == "tennis")
    assert any(r["reason"] == "source_pitch_disputed" for r in evidence["review"])


def test_published_court_evidence_is_current_and_each_slab_has_supported_paint(evidence):
    assert json.loads((ROOT / "docs/sf-corridor-parks.json").read_text())["court_layout"] == evidence
    assert {p["id"] for p in evidence["pads"]} == {c["pad_id"] for c in evidence["courts"] if c.get("pad_id")}


def test_slab_fences_never_cross_playing_rectangles_and_no_dark_bridge_over_empty_corner(evidence):
    kx = 111320 * math.cos(math.radians(37.8))
    def xy(p):
        return ((p[0] + 122.43) * kx, (p[1] - 37.8) * 110540)

    courts = [c for c in evidence["courts"] if c.get("pad_id")]
    for c in courts:
        x, y = xy(c["c"])
        u, v = (math.cos(c["a"]), math.sin(c["a"])), (-math.sin(c["a"]), math.cos(c["a"]))
        paint = Polygon([(x + a * u[0] * c["l"] / 2 + b * v[0] * c["w"] / 2,
                          y + a * u[1] * c["l"] / 2 + b * v[1] * c["w"] / 2)
                         for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]])
        pad = next(p for p in evidence["pads"] if p["id"] == c["pad_id"])
        slab = Polygon([xy(p) for p in pad["p"]])
        assert slab.buffer(.15).covers(paint)
        for p in evidence["pads"]:
            for run in p["fence_runs"]:
                assert LineString([xy(q) for q in run["p"]]).intersection(paint.buffer(-.15)).length == 0
    empty = Point(xy([-122.434179, 37.802062]))
    assert not any(Polygon([xy(q) for q in p["p"]]).contains(empty) for p in evidence["pads"])
    assert not any(c["id"] == "c0" for c in evidence["court_complexes"])


def test_mac_consumes_court_evidence_but_quest_keeps_its_current_ground():
    result = run_js('const BUILD_WINDOW=null;' + _extract('applyCourtLayout', _page_js()) + '''
const ground={courts:[{c:[1,2]}],pitches:[],court_complexes:[]};
const evidence={court_layout:{schema:'kerbside.park_courts/1',courts:[{c:[3,4]}],pads:[],pitches:[],court_complexes:[]}};
console.log(JSON.stringify({quest:applyCourtLayout(ground,evidence,true)===ground,
 mac:applyCourtLayout(ground,evidence,false).courts[0].c,
 fallback:applyCourtLayout(ground,null,false)===ground}));
''')
    assert result == {"quest": True, "mac": [3, 4], "fallback": True}


def test_unreviewed_and_unsupported_regions_keep_all_source_courts():
    ground = {"courts": [{"c": [-122., 37.], "s": "tennis", "a": 0, "l": 23.77, "w": 10.97}],
              "pitches": [], "court_complexes": []}
    result = compile_courts({"objects": []}, ground)
    assert result["courts"] == ground["courts"]
    assert result["pads"] == []


def test_lighting_masts_never_become_cell_towers_and_poles_stay_outside_paint():
    js = _page_js()
    result = run_js('const xy=(lon,lat)=>[lon,lat];' + _extract('courtPainter', js) +
        _extract('communicationMast', js) + _extract('parkLightingRecords', js) +
        _extract('courtEquipmentClear', js) + '''
const light={id:'lamp',tags:{'tower:type':'lighting'}},comm={tags:{'tower:type':'communication'}};
const ground={courts:[{s:'tennis',c:[0,0],a:Math.PI/6,l:23.77,w:10.97}]};
console.log(JSON.stringify({lightAsMast:communicationMast(light,false),questLegacy:communicationMast(light,true),
 comm:communicationMast(comm,false),unknown:communicationMast({},false),
 lights:parkLightingRecords({comm_towers:[light]},false).length,
 questLights:parkLightingRecords({comm_towers:[light]},true).length,
 center: courtEquipmentClear(0,0,ground),outside:courtEquipmentClear(50,50,ground)}));
''')
    assert result == {"lightAsMast": False, "questLegacy": True, "comm": True, "unknown": False,
                      "lights": 1, "questLights": 0, "center": False, "outside": True}


def test_ingestion_distinguishes_communication_lighting_and_unknown_masts():
    from tests.test_street_furniture import _module
    module = _module()
    rows = module.records_from_osm([{"type": "node", "id": n, "lon": -122.43, "lat": 37.8,
                                    "tags": {"man_made": "mast", **tags}}
                                   for n, tags in enumerate([{"tower:type": "lighting"},
                                                           {"tower:type": "communication"}, {}])])
    assert len(rows["lighting_masts"]) == 1 and len(rows["comm_towers"]) == 1
    assert rows["lighting_masts"][0]["tags"]["tower:type"] == "lighting"
