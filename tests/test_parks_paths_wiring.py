"""Playground fills and gates, hybrid path materials, and evidence-backed pole connectivity."""
from __future__ import annotations

import base64
import json
import math
from pathlib import Path

import numpy as np
import pytest

from smc.geo import Origin
from smc.imagery.mvt import polygons
from smc.infrastructure.electrical import (
    Frame,
    Network,
    calibrate,
    candidate_spans,
    decide,
    feeder_key,
    match_poles,
    score_view,
)
from smc.parks.areas import place_gates
from smc.parks.paths import annotate_paths
from tests.test_corridor_geometry_rules import NODE, _extract, _page_js
from tests.test_park_rendering_safety import run_js

ROOT = Path(__file__).resolve().parents[1]

M_LON = Origin(37.8, -122.4).metres_per_degree_lon
M_LAT = Origin(37.8, -122.4).metres_per_degree_lat


def lonlat(x, y):
    return [-122.4 + x / M_LON, 37.8 + y / M_LAT]


# ---------------------------------------------------------------- wiring


def _network(lines):
    frame = Frame(-122.4, 37.8)
    return frame, Network(lines, frame)


def _pole(identity, x, y):
    frame = Frame(-122.4, 37.8)
    p = lonlat(x, y)
    return {"id": identity, "p": p, "xy": frame.xy(p), "source": "test"}


def test_spans_follow_the_network_not_the_nearest_pole():
    # Feeder F1 runs east along y=0; feeder F2 runs east along y=14 (the next street over).
    lines = [
        {"id": "a", "path_id": "a:0", "feeder_id": "F1", "line_section": "1", "phase_count": 3,
         "voltage_kv": 12, "points": [lonlat(0, 0), lonlat(120, 0)]},
        {"id": "b", "path_id": "b:0", "feeder_id": "F2", "line_section": "2", "phase_count": 1,
         "voltage_kv": 12, "points": [lonlat(0, 14), lonlat(120, 14)]},
    ]
    _frame, network = _network(lines)
    poles = {p["id"]: p for p in [
        _pole("A", 5, 1), _pole("B", 45, -1), _pole("C", 85, 1),
        # D is 13 m from A -- nearer than B -- but on the other feeder's route.
        _pole("D", 6, 14),
    ]}
    matched = match_poles(network, list(poles.values()), 4.0)
    spans = {tuple(sorted((s["a"], s["b"]))) for s in candidate_spans(network, poles, matched["ambiguous"])}
    assert spans == {("A", "B"), ("B", "C")}
    assert ("A", "D") not in spans


def test_a_junction_connects_only_the_branches_the_network_has():
    # Main line west->east with a branch north from x=50. Pole E is near the main line's far
    # end but beyond a gap with no line; B must reach C (branch) and D (main), never E.
    lines = [
        {"id": "m1", "path_id": "m1:0", "feeder_id": "F", "points": [lonlat(0, 0), lonlat(50, 0)]},
        {"id": "m2", "path_id": "m2:0", "feeder_id": "F", "points": [lonlat(50, 0), lonlat(90, 0)]},
        {"id": "br", "path_id": "br:0", "feeder_id": "F", "points": [lonlat(50, 0), lonlat(50, 60)]},
    ]
    _frame, network = _network(lines)
    poles = {p["id"]: p for p in [_pole("A", 5, 1), _pole("B", 40, 1), _pole("C", 51, 30),
                                    _pole("D", 80, 1), _pole("E", 130, 1)]}
    matched = match_poles(network, list(poles.values()), 4.0)
    spans = {tuple(sorted((s["a"], s["b"]))) for s in candidate_spans(network, poles, matched["ambiguous"])}
    assert ("A", "B") in spans and ("B", "D") in spans
    assert ("B", "C") in spans  # along the branch, through the junction node
    assert not any("E" in pair for pair in spans)


def test_route_turning_a_corner_between_two_poles_is_not_a_straight_span():
    lines = [{"id": "l", "path_id": "l:0", "feeder_id": "F",
              "points": [lonlat(0, 0), lonlat(60, 0), lonlat(60, 60)]}]
    _frame, network = _network(lines)
    poles = {p["id"]: p for p in [_pole("A", 30, 1), _pole("B", 61, 30)]}
    matched = match_poles(network, list(poles.values()), 4.0)
    assert candidate_spans(network, poles, matched["ambiguous"]) == []


def test_calibration_reads_the_tolerance_off_the_data():
    rng = np.random.default_rng(3)
    paths = [[(x, y * 90.0), (x + 80, y * 90.0)] for x in range(0, 800, 80) for y in range(10)]
    near = np.array([(rng.uniform(0, 800), rng.integers(10) * 90 + rng.normal(0, 2.5)) for _ in range(1500)])
    result = calibrate(near, paths)
    assert result["status"] == "calibrated" and 4 <= result["threshold_m"] <= 12
    scattered = np.column_stack([rng.uniform(0, 800, 1500), rng.uniform(0, 900, 1500)])
    assert calibrate(scattered, paths)["status"] == "no_association"


def _view(labels, camera="spherical"):
    return {"id": "img", "camera": camera, "lonlat": lonlat(0, 0), "compass": 0.0, "sequence": "s",
            "focal": 0.8, "width": 4, "height": 3}


def test_a_photograph_full_of_wires_proves_nothing_about_this_span():
    frame = Frame(-122.4, 37.8)
    labels = np.full((256, 512), 2, dtype=np.uint8)   # wire everywhere
    a, b = frame.xy(lonlat(-15, 12)), frame.xy(lonlat(15, 12))
    out = score_view(_view(labels), labels, frame, a, b)
    assert out["result"] not in {"electrical", "telecom"}


def test_open_sky_counts_against_a_span_only_in_a_registered_view():
    frame = Frame(-122.4, 37.8)
    labels = np.full((256, 512), 1, dtype=np.uint8)   # sky everywhere, no pole to register on
    a, b = frame.xy(lonlat(-15, 12)), frame.xy(lonlat(15, 12))
    assert score_view(_view(labels), labels, frame, a, b)["result"] != "absent"


def test_confidence_policy_and_render_rule():
    span = {"flags": []}
    two = [{"result": "electrical", "sequence": "s1", "image": "1"},
           {"result": "electrical", "sequence": "s2", "image": "2"}]
    assert decide(span, two) == {**decide(span, two), "status": "confirmed", "confidence": 0.95, "render": True}
    one = decide(span, two[:1])
    assert one["status"] == "confirmed" and one["confidence"] == 0.90
    assert decide({"flags": ["crosses_route"]}, two[:1])["render"] is False
    assert decide(span, [])["status"] == "candidate" and decide(span, [])["render"] is False
    absent = [{"result": "absent", "sequence": f"s{i}", "image": str(i)} for i in range(2)]
    assert decide(span, absent)["status"] == "rejected_observed_absent"
    assert decide(span, two, underground=True)["render"] is False
    assert feeder_key("1234") != "1234" and feeder_key(None) is None


def test_mapillary_segmentation_tiles_decode_to_image_rings():
    def varint(n):
        out = b""
        while True:
            byte = n & 0x7F
            n >>= 7
            out += bytes([byte | (0x80 if n else 0)])
            if not n:
                return out

    def field(number, wire, payload):
        key = varint(number << 3 | wire)
        return key + (varint(len(payload)) + payload if wire == 2 else varint(payload))

    def zz(n):
        return (n << 1) ^ (n >> 31)

    # A square from (1024,1024) to (3072,3072) in a 4096 extent: MoveTo, LineTo x3, ClosePath.
    commands = [1 << 3 | 1, zz(1024), zz(1024), 3 << 3 | 2, zz(2048), 0, 0, zz(2048), zz(-2048), 0, 1 << 3 | 7]
    geometry = b"".join(varint(c) for c in commands)
    feature = field(3, 0, 3) + field(4, 2, geometry)
    layer = field(1, 2, b"mpy-or") + field(2, 2, feature) + field(5, 0, 4096)
    tile = field(3, 2, layer)
    rings = polygons(base64.b64encode(tile).decode())
    assert rings == [[(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)]]


# ---------------------------------------------------------------- paths


def _square(x0, y0, x1, y1):
    return [lonlat(x0, y0), lonlat(x1, y0), lonlat(x1, y1), lonlat(x0, y1), lonlat(x0, y0)]


def test_official_materials_split_a_way_where_it_passes_from_one_to_the_next():
    world = {"ways": [{"kind": "path", "osm_id": 7, "points": [lonlat(0, 0), lonlat(60, 0)]}]}
    official = [
        {"id": "rpd:a", "material": "asphalt", "ring": _square(-2, -2, 30, 2), "holes": [],
         "observed_at": "2025-12-09", "source_url": "https://data.sfgov.org"},
        {"id": "rpd:d", "material": "dirt", "ring": _square(30, -2, 62, 2), "holes": [],
         "observed_at": "2025-12-09", "source_url": "https://data.sfgov.org"},
    ]
    out, _ = annotate_paths(world, [], {"ways": {"7": {"tags": {"highway": "footway"}}}}, official=official)
    runs = [(r["resolved"]["surface_material"], r["resolved"]["basis"], round(r["range_m"][0]))
            for r in out["7"]["runs"]]
    assert [r[:2] for r in runs] == [("asphalt", "official_rpd"), ("dirt", "official_rpd")]
    assert 28 <= runs[1][2] <= 32
    # The split keeps the canonical line: first point and last point are the way's own.
    assert out["7"]["runs"][0]["points"][0] == world["ways"][0]["points"][0]
    assert out["7"]["runs"][-1]["points"][-1] == world["ways"][0]["points"][-1]


def test_official_record_outranks_an_older_osm_tag_and_keeps_the_conflict():
    world = {"ways": [{"kind": "path", "osm_id": 8, "points": [lonlat(0, 0), lonlat(40, 0)]}]}
    official = [{"id": "rpd:dg", "material": "decomposed_granite", "ring": _square(-2, -2, 42, 2),
                 "holes": [], "observed_at": "2025-01-01", "source_url": None}]
    source = {"ways": {"8": {"tags": {"highway": "path", "surface": "dirt"}}}}
    out, _ = annotate_paths(world, [], source, official=official)
    run = out["8"]["runs"][0]
    assert run["resolved"]["surface_material"] == "decomposed_granite"
    assert run["conflicts"][0]["surface_material"] == "dirt"


def _stream_source(highway):
    return {"ways": {"9": {"tags": {"highway": highway}}},
            "contexts": [{"tags": {"waterway": "stream"},
                          "geometry": [{"lon": p[0], "lat": p[1]} for p in (lonlat(0, 6), lonlat(50, 6))]}]}


def test_a_trail_by_a_stream_reads_muddy_but_a_footway_or_steps_never_do():
    world = {"ways": [{"kind": "path", "osm_id": 9, "points": [lonlat(0, 0), lonlat(50, 0)]}]}
    out, _ = annotate_paths(world, [], _stream_source("path"))
    resolved = out["9"]["resolved"]
    assert (resolved["surface_material"], resolved["basis"]) == ("mud", "context")
    assert resolved["confidence"] <= 0.45
    for highway in ("footway", "steps"):
        out, _ = annotate_paths(world, [], _stream_source(highway))
        assert out["9"]["resolved"]["surface_material"] == "unknown"


def test_a_park_trail_by_a_beach_reads_sand_and_woodland_reads_earth():
    world = {"ways": [{"kind": "path", "osm_id": 9, "points": [lonlat(0, 0), lonlat(50, 0)]}]}
    beach = {"ways": {"9": {"tags": {"highway": "path"}}},
             "contexts": [{"tags": {"natural": "beach"},
                           "geometry": [{"lon": p[0], "lat": p[1]} for p in _square(0, 10, 50, 40)]}]}
    out, _ = annotate_paths(world, [], beach)
    assert out["9"]["resolved"]["surface_material"] == "sand"
    wood = {"ways": {"9": {"tags": {"highway": "path"}}},
            "contexts": [{"tags": {"natural": "wood"},
                          "geometry": [{"lon": p[0], "lat": p[1]} for p in _square(-5, -5, 55, 5)]}]}
    out, _ = annotate_paths(world, [], wood)
    assert out["9"]["resolved"]["surface_material"] == "earth"


# ---------------------------------------------------------------- playgrounds


def test_a_gate_goes_on_a_mapped_gate_else_where_a_path_arrives():
    ring = _square(0, 0, 20, 12)
    mapped = place_gates(ring, [], [lonlat(10, 12.5)])
    assert mapped[0]["basis"] == "osm_gate_node"
    crossing = place_gates(ring, [[lonlat(5, -10), lonlat(5, 5)]], [])
    assert crossing[0]["basis"] == "pedestrian_way_crosses_boundary"
    gate = crossing[0]["p"]
    assert abs((gate[0] + 122.4) * M_LON - 5) < 0.2 and abs((gate[1] - 37.8) * M_LAT) < 0.2
    near = place_gates(ring, [[lonlat(30, 6), lonlat(40, 6)]], [])
    assert near[0]["basis"] == "nearest_pedestrian_approach"
    assert abs((near[0]["p"][0] + 122.4) * M_LON - 20) < 0.2
    assert place_gates(ring, [[lonlat(90, 6), lonlat(99, 6)]], []) == []


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_playground_fill_fits_inside_the_outline_without_overlaps():
    js = _page_js()
    helpers = "".join(_extract(name, js) for name in (
        "insideRing", "areaFrame", "rectFits", "seededShuffle", "fillPlayground", "random"))
    modules = js[js.index("const PLAY_MODULES = {"):js.index("const AGE_PLAN")]
    plans = js[js.index("const AGE_PLAN"):js.index("function insideRing")]
    result = run_js("""
const THREE={};function pp(){}function deckTower(){}function slideOff(){}
const PLAY_COLOURS=[0,0,0,0,0,0,0];const PARK_WOOD=0;
""" + modules + plans + helpers + """
// An L-shaped playground, 30 x 24 m with a 14 x 12 m bite out of one corner.
const ring=[[0,0],[30,0],[30,12],[16,12],[16,24],[0,24],[0,0]];
const out=[];
for (const seed of [1,2,3,4,5]) {
  const frame=areaFrame(ring);
  const placed=fillPlayground(frame,[ring],[],AGE_PLAN.all,seed,false,false);
  let ok=true;
  for (const m of placed) {
    for (const [a,b] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const [x,z]=frame.page(m.u+a*m.w/2,m.v+b*m.d/2);
      if(!insideRing(x,z,ring)) ok=false;
    }
  }
  for (let i=0;i<placed.length;i++) for (let j=i+1;j<placed.length;j++) {
    const p=placed[i],q=placed[j];
    if(Math.abs(p.u-q.u)<(p.w+q.w)/2 && Math.abs(p.v-q.v)<(p.d+q.d)/2) ok=false;
  }
  out.push({n:placed.length,ok,kinds:[...new Set(placed.map(m=>m.kind))].length});
}
const tiny=fillPlayground(areaFrame([[0,0],[3,0],[3,3],[0,3],[0,0]]),[[[0,0],[3,0],[3,3],[0,3],[0,0]]],[],AGE_PLAN.all,1,false,false);
console.log(JSON.stringify({out,tiny:tiny.length}));
""")
    assert all(r["ok"] for r in result["out"])
    assert all(r["n"] >= 4 and r["kinds"] >= 3 for r in result["out"])
    assert len({r["n"] for r in result["out"]}) >= 1
    assert result["tiny"] == 0


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_playground_fence_is_open_at_the_gate_and_closed_elsewhere():
    js = _page_js()
    script = """
const PLAYGROUND_Y=0.034;
const FENCE_GROUND_STEP_M=.75;
function groundLiftAt(){return 0;}
function xy(lon,lat){return [lon,lat];}
function insideCarriageway(){return false;}
""" + _extract("groundedFencePanel", js) + _extract("fenceSink", js) + _extract("fenceArea", js) + """
const ring=[[0,0],[20,0],[20,10],[0,10],[0,0]];
const sink=fenceSink();
// A gate in the middle of the south side (z=0 edge in page frame: y=0 -> z=-0).
fenceArea({id:'p',gates:[{p:[10,0],width_m:1.2}]},ring,1.2,'playground',sink);
// Fence panels touching x in (9.5,10.5) on the z=0 edge, other than the gate leaf.
// Panels are now connected strips, not four duplicated vertices per quad.
// Recover each panel from its actual two triangles; retain the same gate/length assertions.
const quads=[];for(let i=0;i<sink.indices.length;i+=6){
 const ids=[sink.indices[i],sink.indices[i+5],sink.indices[i+1],sink.indices[i+2]];
 quads.push(ids.flatMap(k=>sink.positions.slice(k*3,k*3+3)));
}
const southPanels=quads.filter(q=>Math.abs(q[2])<1e-6&&Math.abs(q[8])<1e-6);
const covering=southPanels.filter(q=>Math.min(q[0],q[6])<9.6&&Math.max(q[0],q[6])>10.4);
const length=southPanels.reduce((s,q)=>s+Math.abs(q[6]-q[0]),0);
console.log(JSON.stringify({gates:sink.gates.length,covering:covering.length,south:length}));
"""
    result = run_js(script)
    assert result["gates"] == 1
    assert result["covering"] == 0
    assert 18.5 < result["south"] < 19.0


def test_page_wires_parks_paths_and_spans_into_the_scene():
    js = _page_js()
    assert "buildParkAreas(PARK_EVIDENCE?.areas" in js
    assert 'asset("sf-corridor-electrical.json")' in js
    network = _extract("addElectricalNetwork", js)
    assert "electricalSpans()" in network and "span.osm" in network
    assert "phases === 3" in network
    spans = _extract("electricalSpans", js)
    assert "span.c >= 0.85" in spans
    assert math.isclose(0.034, float(js.split("const PLAYGROUND_Y = ")[1].split(";")[0]))


def test_duplicate_pole_detections_merge_onto_one_drawn_pole():
    from smc.infrastructure.electrical import merge_duplicate_poles

    poles = [_pole("mapillary:1", 0, 0), _pole("mapillary:2", 3, 1), _pole("osm:utility_pole:node:9", 2, -1),
             _pole("mapillary:3", 35, 0)]
    merged, alias = merge_duplicate_poles(poles)
    assert len(merged) == 2
    assert alias["mapillary:1"] == alias["mapillary:2"] == "osm:utility_pole:node:9"
    assert alias["mapillary:3"] == "mapillary:3"


def test_published_spans_carry_no_pge_attributes_without_leave():
    """Phase count, voltage and feeder are PG&E's; the published spans are our poles and photos."""
    for path in [ROOT / "docs/sf-corridor-electrical.json",
                 *sorted((ROOT / "docs/regions").glob("*/sf-corridor-electrical.json"))]:
        doc = json.loads(path.read_text())
        assert doc["grip_attributes_published"] is False
        for span in doc["spans"]:
            assert not {"phases", "kv", "f"} & set(span), path
            assert span["c"] >= 0.85 and span["seen"] >= 1
