"""Freeway guide signs: what is inferred from OpenStreetMap's exits, where it stands, and how the
page draws and loads it (smc.highways)."""

import json
import math
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from smc.highways.signs import Osm, cardinal, from_overpass, infer_signs, parse_routes
from smc.renderer.template import renderer_source

ROOT = Path(__file__).resolve().parents[1]
THREE = ROOT / "tools/unreal/node_modules/three/build/three.module.js"
NODE = shutil.which("node")
LAT0, LON0 = 37.70, -122.40
M_LAT = 1 / 111320


def north(m: float, east_m: float = 0.0) -> tuple[float, float]:
    return (LON0 + east_m / (111320 * math.cos(math.radians(LAT0))), LAT0 + m * M_LAT)


def freeway(ref="US 101", lanes="4", destination_ref="I 280 South", junction_ref="432B", gantry=None):
    """A northbound freeway 2 km long, an exit at 1,200 m and an entrance joining at 300 m."""
    osm = Osm()
    main = []
    for i in range(0, 2001, 100):
        osm.nodes[1000 + i] = north(i)
        main.append(1000 + i)
    osm.ways[1] = {"tags": {"highway": "motorway", "ref": ref, "lanes": lanes, "oneway": "yes"}, "nodes": main}
    osm.junctions[2200] = {"highway": "motorway_junction", "ref": junction_ref}
    osm.ways[2] = {"tags": {"highway": "motorway_link", "destination": "Daly City;San Jose;Colma",
                            "destination:ref": destination_ref}, "nodes": [2200, 9001, 9002]}
    osm.nodes[9001], osm.nodes[9002] = north(1300, 25), north(1400, 60)
    osm.ways[3] = {"tags": {"highway": "motorway_link"}, "nodes": [8001, 8002, 1300]}
    osm.nodes[8001], osm.nodes[8002] = north(100, 80), north(200, 30)
    if gantry:
        osm.gantries.append(gantry)
    return osm


def by_kind(signs):
    out = {}
    for s in signs:
        out.setdefault(s["kind"], []).append(s)
    return out


def test_an_exit_has_its_direction_advance_and_gore_signs_where_the_rules_put_them():
    signs = by_kind(infer_signs(freeway()))
    direction = signs["exit_direction"][0]
    # 60 m before the exit's node, on the carriageway, facing the traffic that reads it.
    assert direction["p"][1] == pytest.approx(LAT0 + 1140 * M_LAT, abs=2 * M_LAT)
    assert direction["bearing"] == pytest.approx(0, abs=0.5)
    assert direction["mount"] == "overhead" and direction["lanes"] == 4
    assert direction["legend"]["tab"] == "EXIT 432B"
    assert direction["legend"]["shields"] == [{"net": "I", "ref": "280", "dir": "SOUTH"}]
    assert direction["legend"]["lines"] == ["Daly City", "San Jose"]       # two places, as signed
    assert direction["legend"]["arrow"] == "down"
    advance = signs["advance_guide"][0]
    assert advance["p"][1] == pytest.approx(LAT0 + (1200 - 805) * M_LAT, abs=2 * M_LAT)
    assert advance["legend"]["distance"] == "1/2 MILE" and advance["legend"]["arrow"] is None
    gore = signs["gore"][0]
    assert gore["legend"]["lines"] == ["EXIT", "432B"]
    assert gore["p"][1] > LAT0 + 1200 * M_LAT and gore["p"][0] > LON0     # past the split, on the ramp's side
    assert all("inferred" in s["basis"] for s in infer_signs(freeway()))


def test_a_two_lane_road_signs_its_exit_at_the_shoulder_with_the_arrow_up_and_right():
    direction = by_kind(infer_signs(freeway(lanes="2")))["exit_direction"][0]
    assert direction["mount"] == "roadside" and direction["legend"]["arrow"] == "up_right"


def test_each_entrance_gets_a_route_marker_with_the_direction_the_road_is_signed():
    marker = by_kind(infer_signs(freeway()))["route_marker"][0]
    assert marker["legend"]["shields"] == [{"net": "US", "ref": "101", "dir": "NORTH"}]
    assert marker["p"][1] == pytest.approx(LAT0 + 600 * M_LAT, abs=2 * M_LAT)


def test_a_route_signed_against_its_numbers_parity_takes_its_signs_word_for_it():
    # I-880 is even and signed north and south: its ramps say so, and the marker follows them.
    osm = freeway(ref="I 880", destination_ref="I 880 North")
    assert by_kind(infer_signs(osm))["route_marker"][0]["legend"]["shields"][0]["dir"] == "NORTH"
    assert cardinal({"net": "I", "ref": "880"}, 20) == "EAST"        # the parity rule alone
    assert cardinal({"net": "CA", "ref": "1"}, 200) == "SOUTH"


def test_an_overhead_sign_hangs_from_a_mapped_gantry_nearby():
    gantry = north(1170, 12)
    direction = by_kind(infer_signs(freeway(gantry=gantry)))["exit_direction"][0]
    assert direction["structure"] == "osm_gantry"
    assert direction["p"][1] == pytest.approx(gantry[1], abs=2 * M_LAT)
    assert direction["p"][0] == pytest.approx(LON0, abs=1e-6)          # on the carriageway's line


def test_an_advance_sign_that_would_stand_at_another_exit_is_left_out():
    osm = freeway()
    osm.junctions[1400] = {"highway": "motorway_junction", "ref": "431"}
    osm.ways[4] = {"tags": {"highway": "motorway_link", "destination": "Brisbane"}, "nodes": [1400, 9101]}
    osm.nodes[9101] = north(500, 40)
    signs = by_kind(infer_signs(osm))
    assert {s["source"]["junction"] for s in signs["exit_direction"]} == {1400, 2200}
    assert signs.get("advance_guide", []) == []   # 2200's lands on 431's sign


def test_route_text_is_read_whatever_the_mapper_wrote():
    assert parse_routes("I-280 S;CA 1 North;SR 85; CR G4") == [
        {"net": "I", "ref": "280", "dir": "SOUTH"}, {"net": "CA", "ref": "1", "dir": "NORTH"},
        {"net": "CA", "ref": "85"}]


def test_overpass_answers_become_the_same_network():
    elements = [
        {"type": "node", "id": 5, "lon": -122.4, "lat": 37.7, "tags": {"highway": "motorway_junction", "ref": "7"}},
        {"type": "node", "id": 6, "lon": -122.41, "lat": 37.71, "tags": {"man_made": "gantry"}},
        {"type": "way", "id": 1, "tags": {"highway": "motorway", "ref": "I 80"}, "nodes": [5, 7],
         "geometry": [{"lon": -122.4, "lat": 37.7}, {"lon": -122.4, "lat": 37.71}]},
        {"type": "way", "id": 9, "tags": {"highway": "primary"}, "nodes": [7, 8],
         "geometry": [{"lon": -122.4, "lat": 37.71}, {"lon": -122.39, "lat": 37.71}]},
    ]
    osm = from_overpass(elements)
    assert set(osm.ways) == {1} and 5 in osm.junctions and osm.gantries == [(-122.41, 37.71)]
    assert osm.nodes[7] == (-122.4, 37.71)


def test_the_page_reads_only_this_sites_sign_tiles_and_its_own_renderer():
    page = renderer_source()
    literal = re.search(r"const HIGHWAY_SIGN_TILE_PATH = /(.+)/;", page).group(1).replace("\\\\", "\\")
    pattern = re.compile(literal)
    assert pattern.match("highway-signs/w1225-n377.json")
    for foreign in ("https://x.invalid/highway-signs/a.json", "../highway-signs/a.json",
                    "highway-signs/../../a.json", "highway-signs/a.json?x=1", "regions/x/a.json"):
        assert not pattern.match(foreign), foreign
    assert 'import(sharedAsset(`highway-sign-renderer.mjs?v=' in page
    # They are street furniture: they open with it, and the home screen waits for both.
    assert 'const LAZY_COMPANIONS = { furniture: ["highway_signs", "highway_tolls", "waterworks"] };' in page
    assert '["highway_signs", "freeway signs"]' in page


needs_three = pytest.mark.skipif(NODE is None or not THREE.exists(), reason="node and tools/unreal three.js needed")


@needs_three
def test_the_renderer_stands_each_sign_facing_its_traffic_at_its_clearance():
    renderer = ROOT / "src/smc/highways/renderer.mjs"
    signs = [
        {"id": "a", "kind": "exit_direction", "p": [0, 0], "bearing": 90, "lanes": 4, "width_m": 14.6,
         "deck": False, "mount": "overhead",
         "legend": {"tab": "EXIT 7", "shields": [{"net": "I", "ref": "80", "dir": "EAST"}],
                    "lines": ["Oakland"], "arrow": "down"}},
        {"id": "b", "kind": "route_marker", "p": [100, 0], "bearing": 0, "lanes": 3, "width_m": 11,
         "deck": True, "mount": "roadside", "legend": {"shields": [{"net": "US", "ref": "101", "dir": "NORTH"}]}},
    ]
    js = f"""
import * as THREE from {json.dumps(THREE.as_uri())};
import {{ buildHighwaySigns }} from {json.dumps(renderer.as_uri())};
const ctx = new Proxy({{}}, {{ get: (t, k) => k === 'measureText' ? (s) => ({{ width: s.length * 70 }})
  : (k in t ? t[k] : () => {{}}), set: (t, k, v) => (t[k] = v, true) }});
const document = {{ createElement: () => ({{ width: 0, height: 0, getContext: () => ctx }}) }};
const group = buildHighwaySigns(THREE, {json.dumps(signs)}, {{ document,
  place: (lon, lat) => ({{ x: lon, z: -lat }}), ground: () => 10, decks: (x) => x > 50 ? [18] : [] }});
group.updateMatrixWorld(true);
const out = group.children.map((frame) => {{
  const face = frame.children.find((c) => c.userData.surface === 'furniture:highway_sign');
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(face.getWorldQuaternion(new THREE.Quaternion()));
  const box = new THREE.Box3().setFromObject(face);
  return {{ kind: frame.userData.kind, normal: [n.x, n.z], bottom: box.min.y, parts: frame.children.length }};
}});
console.log(JSON.stringify({{ out, summary: group.userData.summary }}));
"""
    result = json.loads(subprocess.check_output([NODE, "--input-type=module", "-e", js], text=True))
    direction, marker = result["out"]
    # Eastbound traffic reads a face turned west, 5.3 m clear above the road.
    assert direction["normal"] == pytest.approx([-1, 0], abs=1e-6)
    assert direction["bottom"] == pytest.approx(10 + 5.3, abs=0.05)
    assert direction["parts"] >= 5            # panel, tab, truss and two posts
    # Northbound, on a viaduct: the marker stands on the deck, not the ground below it.
    assert marker["normal"] == pytest.approx([0, 1], abs=1e-6)
    assert marker["bottom"] == pytest.approx(18 + 2.1, abs=0.05)
    assert result["summary"]["drawn"] == 2
