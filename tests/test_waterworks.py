"""Water above and below the street: drains drawn as they are built, where their water goes,
streams, sewer lids, tanks and treatment plants (smc.waterworks)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from smc.renderer.template import renderer_source
from smc.waterworks.drains import (
    PointGrid,
    drain_form,
    follow_published,
    receiving_water,
    sf_route,
    sf_watershed,
    stream_points,
    toward_outfalls,
)
from smc.waterworks.osm import OsmWater, _num, assign_to_plants, ring_area_m2

ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "src/smc/waterworks/renderer.mjs"
THREE = ROOT / "docs/vendor/three-0.160.0/three.module.min.js"


def test_each_drain_is_drawn_as_the_city_says_it_is_built():
    form = lambda t, kind="catch_basin": drain_form({"kind": kind, "type": t})  # noqa: E731
    assert form("Catch Basin Drain") == "curb_grate"
    assert form("36in Square CB with Curb Inlet (IN-GO)") == "curb_grate"
    assert form("Caltrans GDO Combination Inlet") == "curb_grate"
    assert form("Curb Inlet: Drain w/ no grate") == "curb_opening"
    assert form("Caltrans G2 Grate Inlet") == "grate" and form("Drop Inlet") == "grate"
    assert form("Trench Drain") == "trench" and form("Track Drain") == "trench"
    assert form("MH Inlet: Grated Cover") == "round_grate"
    # Not surface inlets at all: never drawn.
    for t in ("Psuedo Drain for Model ONLY", "Wetwell", "LID / Other surface flow inlet point",
              "Tree Well; drains soil of tree planter", "Scupper-Hole in wall for surface flow"):
        assert form(t) is None, t
    # A city's inlet with no type is the commonest kind; a manhole is a lid.
    assert form(None, "inlet") == "curb_grate"
    assert form(None, "manhole") == "lid"


def test_a_san_francisco_drain_goes_to_its_watersheds_plant():
    assert sf_watershed("Marina", 37.80) == "North Shore"
    assert sf_watershed("Outer Richmond", 37.78) == "Westside"
    assert sf_watershed("Mission", 37.76) == "Channel"
    assert sf_watershed("Bayview Hunters Point", 37.72) == "Yosemite"
    west = sf_route("Westside")
    assert "Oceanside" in west["to"] and "Pacific" in west["outfall"] and west["system"] == "combined"
    north = sf_route("North Shore")
    assert "Southeast" in north["to"] and "North Point" in north["storm"]
    assert all("catch basin" == sf_route(w)["via"][0] for w in ("Channel", "Islais Creek", "Sunnydale"))


def test_a_published_network_is_followed_main_by_main_to_its_outfall():
    net = {"nodes": [{"id": "i", "kind": "inlet", "p": [0, 0]}, {"id": "m", "kind": "manhole", "p": [0, 0.001]},
                     {"id": "o", "kind": "outfall", "p": [0, 0.002]}],
           "links": [{"up": "i", "down": "m", "length_m": 40, "street": "ALMADEN BLVD"},
                     {"up": "m", "down": "o", "length_m": 70, "street": "ALMADEN BLVD"}]}
    path = follow_published(net, "i")
    assert path["end"] == "o" and path["end_kind"] == "outfall" and path["length_m"] == 110
    assert path["mains"] == 2 and path["under_streets"] == ["Almaden Blvd"]
    # Pipes with no direction: toward the nearest outfall along them.
    nxt = toward_outfalls(net)
    assert nxt["i"] == ("m", 110) and nxt["m"][0] == "o"


def test_a_storm_drain_with_no_network_empties_to_the_nearest_creek():
    streams = [{"c": [[-122.0, 37.0], [-122.0, 37.01]], "name": "Matadero Creek", "kind": "stream", "under": False}]
    grid = PointGrid(stream_points(streams), cell_deg=0.005)
    near = receiving_water([-122.001, 37.005], grid)
    assert near["receiving"] == "Matadero Creek" and near["receiving_m"] < 120
    assert receiving_water([-121.5, 37.5], grid)["receiving"] == "San Francisco Bay"


def test_a_plants_round_tanks_are_clarifiers_and_digesters():
    ring = [[-122.40, 37.74], [-122.39, 37.74], [-122.39, 37.75], [-122.40, 37.75]]
    water = OsmWater(plants=[{"id": "p", "kind": "wastewater", "c": ring, "p": [-122.395, 37.745]}],
                     tanks=[{"id": "a", "p": [-122.395, 37.745], "diameter_m": 30, "under": False, "kind": "tank"},
                            {"id": "b", "p": [-122.396, 37.746], "diameter_m": 14, "height_m": 12, "under": False,
                             "kind": "tank", "content": "sewage"},
                            {"id": "c", "p": [-122.30, 37.70], "diameter_m": 30, "under": False, "kind": "tank"}])
    assign_to_plants(water)
    kinds = {t["id"]: t["kind"] for t in water.tanks}
    assert kinds == {"a": "clarifier", "b": "digester", "c": "tank"}
    assert _num("40 ft") == pytest.approx(12.192) and _num("3.5;4") == 3.5 and _num("yes") is None
    assert ring_area_m2([[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]]) == pytest.approx(111320 * 110540 * 1e-6 * 0.999, rel=0.01)


def test_the_page_loads_the_waterworks_with_the_street_furniture():
    source = renderer_source()
    assert 'const LAZY_COMPANIONS = { furniture: ["highway_signs", "highway_tolls", "waterworks"] };' in source
    assert 'registerLazyLayer("waterworks", async () => {' in source
    assert "const WATERWORKS_TILE_PATH = /^waterworks\\/[a-z0-9-]+\\.json$/;" in source
    assert "kerb:(x,z,reach)=>nearestKerbAt(x,z,reach)" in source
    manifest = ROOT / "docs/waterworks.manifest.json"
    if manifest.exists():
        index = json.loads(manifest.read_text())
        assert index["schema"] == "kerbside.waterworks_tiles/1"
        assert (ROOT / "docs/waterworks-renderer.mjs").read_text() == RENDERER.read_text()


def _node(code: str) -> dict:
    if not shutil.which("node"):
        pytest.skip("Node required for the renderer")
    preamble = (f"import * as W from {json.dumps(RENDERER.as_uri())};\n"
                f"import * as THREE from {json.dumps(THREE.as_uri())};\n")
    out = subprocess.run(["node", "--input-type=module", "-e", preamble + code], capture_output=True, text=True,
                         check=True)
    return json.loads(out.stdout)


def test_a_curb_inlet_sits_in_the_gutter_and_the_water_runs_down_to_it():
    r = _node("""
const kerb = {x: 10, z: 0, nx: 1, nz: 0, ax: 0, az: 1};
const seat = W.seatDrain("curb_grate", 9.7, 0.2, kerb);
const open = W.seatDrain("curb_opening", 9.7, 0.2, kerb);
const far = W.seatDrain("grate", 2, 0, kerb);
// The street falls to the south (+z): the gutter north of the drain drains into it.
const sides = W.uphillSides(seat, (x, z) => -0.05 * z);
process.stdout.write(JSON.stringify({seat, open, far, sides}));
""")
    assert r["seat"]["atKerb"] and r["seat"]["x"] < 10 and r["seat"]["kx"] == 10
    assert r["open"]["x"] == 10
    assert not r["far"]["atKerb"]
    assert [s["side"] for s in r["sides"]] == [-1]


def test_the_renderer_draws_each_kind_and_keeps_routes():
    r = _node("""
const tile = {schema: "kerbside.waterworks/1", routes: [{to: "Southeast Treatment Plant", basis: "SFPUC watershed"}],
  streams: [{id: "s", k: "stream", w: 2, c: [[0, 0], [0, 0.0005], [0.0003, 0.001]]},
            {id: "u", k: "stream", w: 2, under: true, c: [[0, 0], [0, 0.001]]}],
  drains: [{id: "d1", p: [0.0001, 0], f: "curb_grate", s: "combined", r: 0},
           {id: "d2", p: [0.0002, 0], f: "trench", s: "storm"}],
  lids: [{id: "l1", p: [0.0003, 0], f: "lid", s: "combined", inferred: true, r: 0}],
  tanks: [{id: "t", p: [0.001, 0.001], diameter_m: 20, kind: "tank"},
          {id: "w", p: [0.002, 0.001], diameter_m: 10, kind: "tower"},
          {id: "c", p: [0.003, 0.001], diameter_m: 30, kind: "clarifier"}],
  basins: [{id: "b", p: [0.004, 0.0015], c: [[0.004, 0.001], [0.0045, 0.001], [0.0045, 0.002], [0.004, 0.002]]}],
  plants: [{id: "p", name: "Southeast Treatment Plant", kind: "wastewater"}], underground: [{id: "r", kind: "reservoir"}]};
const place = (lon, lat) => ({x: lon * 88000, z: -lat * 111000});
const kerb = (x, z) => ({x: x, z: z + 0.2, nx: 0, nz: 1, ax: 1, az: 0});
const g = W.buildWaterworks(THREE, [tile], {place, ground: () => 0, kerb, document: null,
  kerbSegments: () => [[0, 0, 40, 0, 5]]});
const near = g.userData.near(8.8, 0, 3);
const surfaces = [...new Set(g.children.map(c => c.userData.surface))].sort();
process.stdout.write(JSON.stringify({summary: g.userData.summary, near, surfaces}));
""")
    s = r["summary"]
    assert s["streams"] == 1 and s["drains"] == 2 and s["lids"] == 1 and s["lids_inferred"] == 1
    assert s["tanks"] == 1 and s["towers"] == 1 and s["clarifiers"] == 1 and s["basins"] == 1
    assert s["plants"] == 1 and s["underground"] == 1 and s["gutters_m"] > 0
    assert r["near"][0]["route"]["to"] == "Southeast Treatment Plant"
    assert {"waterworks:sewer_lid", "waterworks:storm_drain", "waterworks:gutter", "waterworks:stream",
            "waterworks:water_tank", "waterworks:clarifier", "waterworks:treatment_basin"} <= set(r["surfaces"])


def test_the_build_files_each_thing_by_its_tile_to_a_tenth_of_a_metre():
    import importlib.util

    from smc.waterworks import MANIFEST_SCHEMA, SCHEMA

    spec = importlib.util.spec_from_file_location("build_waterworks", ROOT / "scripts/build_waterworks.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    assert SCHEMA == "kerbside.waterworks/1" and MANIFEST_SCHEMA == "kerbside.waterworks_tiles/1"
    assert build.tile_of(-122.4417, 37.8046) == (-1225, 378)
    row = build._compact({"id": "x", "p": [-122.44171234, 37.80461234], "c": [[1.12345678, 2.12345678]]})
    assert row["p"] == [-122.441712, 37.804612] and row["c"] == [[1.123457, 2.123457]]
    inside = build.Area([(-122.45, 37.80, -122.43, 37.81)])
    assert inside(-122.44, 37.805) and not inside(-122.40, 37.805)
    routes = build.Routes()
    assert routes.add({"to": "a"}) == 0 and routes.add({"to": "b"}) == 1 and routes.add({"to": "a"}) == 0
    assert build.city_of("san-francisco:catch_basin:N-1") == "san-francisco" and build.city_of("osm:n1") is None


def test_the_gutter_pan_lies_clear_of_the_road_and_its_drain_on_the_pan():
    # On a hill the road (cut on the terrain grid) and a pan a few millimetres over the ground
    # crossed between their vertices, and the asphalt broke the grey pan into jagged pieces along
    # the kerb. It is laid GUTTER_LIFT_M over the road, a vertex a metre, with the drain on it.
    r = _node("""
const tile = {schema: "kerbside.waterworks/1", drains: [{id: "d1", p: [0.0001, 0], f: "curb_grate", s: "storm"}]};
const place = (lon, lat) => ({x: lon * 88000, z: -lat * 111000});
const kerb = (x, z) => ({x: x, z: 5, nx: 0, nz: 1, ax: 1, az: 0});
const ground = (x, z) => 0.08 * x;
const g = W.buildWaterworks(THREE, [tile], {place, ground, kerb, document: null, roadTop: 0.06,
  kerbSegments: () => [[0, 0, 40, 0, 5]]});
const pan = g.children.find(c => c.name === "waterworks-gutters");
const p = pan.geometry.getAttribute("position");
let low = Infinity, xs = new Set();
for (let i = 0; i < p.count; i += 1) { low = Math.min(low, p.getY(i) - ground(p.getX(i), p.getZ(i)) - 0.06); xs.add(Math.round(p.getX(i))); }
process.stdout.write(JSON.stringify({low, lift: W.GUTTER_LIFT_M, vertices: xs.size}));
""")
    assert r["lift"] == 0.03
    assert r["low"] >= 0.03 - 1e-6, "every vertex of the pan over the road by the lift"
    assert r["vertices"] >= 40, "a vertex a metre along the kerb"
    source = RENDERER.read_text()
    assert "road + GUTTER_LIFT_M + 0.017" in source and "road + GUTTER_LIFT_M + 0.006" in source
