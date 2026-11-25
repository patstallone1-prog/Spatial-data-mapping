"""Storefronts read from photographs (the kerbfront lab's Opus readings) as the app's plans
(smc.exteriors.observed), and the renderer drawing what was read (renderer.mjs drawObserved)."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from smc.exteriors.observed import assign, load_models, match_edge, observed_plan, plans_for_world

ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "src/smc/exteriors/renderer.mjs"
PUBLISH = ROOT / "scripts/publish_store_exteriors.py"
THREE = ROOT / "docs/vendor/three-0.160.0/three.module.min.js"
READINGS = ROOT / "storefronts-lab/models/auto-opus"

LON, LAT = -122.4360, 37.8005
KX = 111_320.0 * math.cos(math.radians(LAT))


def lonlat(x, y, lon=LON, lat=LAT):
    return [lon + x / (111_320.0 * math.cos(math.radians(lat))), lat + y / 111_320.0]


def way(ring_xy, osm_id=900, height=11.0):
    pts = [lonlat(x, y) for x, y in ring_xy]
    return {"kind": "building", "osm_id": osm_id, "points": [*pts, pts[0]], "height_m": height,
            "height_source": "osm_height", "centroid": lonlat(10, 5)}


#: An 20 x 10 m block; the street is to the south (y < 0).
CCW = [(0, 0), (20, 0), (20, 10), (0, 10)]


def model(shift=(0.6, -0.4), storefronts=None, osm_id="900"):
    """A lab model on the city's footprint: the same block, 0.7 m off OpenStreetMap's, in the lab's
    counter-clockwise local frame around its own origin."""
    origin = lonlat(-3, 2)
    ox, oy = (origin[0] - LON) * KX, (origin[1] - LAT) * 111_320
    fp = [[x + shift[0] - ox, y + shift[1] - oy] for x, y in CCW]
    sf = {
        "id": "sf-cafe", "name": "Cafe Lumen", "category": "cafe", "edge": 0, "u0": 2.0, "u1": 11.0, "band_h": 4.1,
        "material": "tile", "door_style": "timber_glazed",
        "palette": {"wall": "#2f4b3c", "accent": "#c9a227", "frame": "#1b1d1c", "letter": "#f3ead2", "glass": "#3a4a50"},
        "openings": [{"id": "g0", "kind": "window", "u": 2.3, "v": 0.6, "w": 3.5, "h": 2.6},
                     {"id": "d0", "kind": "door", "u": 6.2, "v": 0.0, "w": 1.1, "h": 2.4},
                     {"id": "g1", "kind": "window", "u": 7.6, "v": 0.6, "w": 3.1, "h": 2.6}],
        "signs": [{"id": "s0", "kind": "fascia", "text": "CAFE LUMEN", "u": 3.0, "v": 3.35, "w": 6.0, "h": 0.55}],
        "awnings": [{"id": "a0", "kind": "shed", "u0": 2.1, "u1": 10.9, "v": 3.2, "depth_m": 1.0, "drop_m": 0.4,
                     "colour": "#2f4b3c", "valance_text": "COFFEE  BAKERY"}],
        "extra_signs": [{"id": "b0", "kind": "blade", "u": 10.6, "v": 2.6, "w": 0.6, "h": 0.6, "bg": "#c9a227",
                         "layers": [{"type": "text", "text": "CL", "x": 0.5, "y": 0.5, "size": 0.6, "fill": "#2f4b3c"}]},
                        {"id": "b1", "kind": "board", "u": 3.0, "v": 1.2, "w": 0.6, "h": 0.9, "bg": "#1b1d1c"}],
        "lights": [{"kind": "gooseneck", "u": 4.0, "v": 3.9}, {"kind": "string", "u0": 2.5, "u1": 10.5, "v": 3.0}],
        "evidence": {"kind": "observed", "read_by": "claude-opus-5-5", "confidence": 0.7, "frames": ["f1", "f2"],
                     "how": "kerbfront opus"},
    }
    walls = [{"edge": 0, "pilasters": [{"u": [2.0, 11.0], "v0": 0, "v1": 4.3, "w": 0.35, "colour": "#5e8c7b"}],
              "friezes": [{"u0": 0, "u1": 20, "v": 3.95, "h": 0.2, "colour": "#2f5a4c", "motif": "dentil"}],
              "openings": []}]
    return {"schema": "kerbfront.building/1", "id": "cafe-lumen", "app_building": osm_id, "origin_lon_lat": origin,
            "footprint": fp, "storefronts": storefronts if storefronts is not None else [sf], "walls": walls,
            "photos": [{"frame_id": "f1", "captured_at": "2024-05-01T00:00:00+00:00"}]}


def test_a_read_wall_lands_on_the_canonical_edge_it_lies_on_and_keeps_what_was_read():
    plan = observed_plan(way(CCW), model())
    assert plan["validation"]["passed"], plan["validation"]
    (f,) = plan["facades"]
    assert f["edge"] == 0 and f["name"] == "Cafe Lumen" and f["role"] == "public"
    # Re-measured on OpenStreetMap's edge: the lab's wall starts 0.6 m further east.
    assert f["u0"] == pytest.approx(2.6, abs=0.01) and f["u1"] == pytest.approx(11.6, abs=0.01)
    door = next(o for o in f["openings"] if o["component_kind"] == "door")
    assert door["u"] == pytest.approx(6.8, abs=0.01) and door["evidence"]["observed"]
    assert f["band_height_m"] == 4.1 and f["palette"]["wall"] == "#2f4b3c" and f["palette"]["accent"] == "#c9a227"
    assert f["material"] == "tile" and f["door_style"] == "timber_glazed"
    assert [s["text"] for s in f["signs"]] == ["CAFE LUMEN"]  # the read sign only, none invented
    obs = f["observed"]
    assert obs["awnings"][0]["u0"] == pytest.approx(2.7, abs=0.01)
    assert {s["kind"] for s in obs["extra_signs"]} == {"blade", "board"}
    assert next(s for s in obs["extra_signs"] if s["kind"] == "blade")["u"] == pytest.approx(11.2, abs=0.01)
    assert len(obs["lights"]) == 2 and obs["pilasters"][0]["u"] == pytest.approx([2.6, 11.6], abs=0.01)
    assert obs["friezes"][0]["u0"] == pytest.approx(2.6, abs=0.01)  # clipped to the shop's span
    assert plan["observed_source"]["model"] == "cafe-lumen" and plan["canonical_geometry_modified"] is False


def test_a_clockwise_shell_runs_the_other_way_and_the_far_wall_never_matches():
    cw = [(0, 0), (0, 10), (20, 10), (20, 0)]
    plan = observed_plan(way(cw), model())
    (f,) = plan["facades"]
    ring = plan["footprint"]["coordinates"][0]
    a, b = ring[f["edge"]], ring[f["edge"] + 1]
    assert a[1] == pytest.approx(b[1], abs=0.01) and a[0] > b[0]  # the south wall, east to west
    length = math.dist(a, b)
    assert f["u0"] == pytest.approx(length - 11.6, abs=0.01) and f["u1"] == pytest.approx(length - 2.6, abs=0.01)
    door = next(o for o in f["openings"] if o["component_kind"] == "door")
    assert door["u"] == pytest.approx(length - 6.8 - 1.1, abs=0.01)
    # The north wall is parallel and 10 m off: never the read wall's match.
    m = model()
    from shapely.geometry import shape

    from smc.interiors.kerbside import mapped_geometry
    shell = mapped_geometry(way(CCW))
    poly = shape(shell["footprint"])
    em = match_edge(m, 0, list(poly.exterior.coords), shell["origin_lon_lat"], not poly.exterior.is_ccw)
    assert em.edge == 0 and em.step == 1.0


def test_a_shop_read_without_a_door_gets_one_inferred_in_its_glazing():
    m = model()
    sf = m["storefronts"][0]
    sf["openings"] = [{"id": "g0", "kind": "window", "u": 2.1, "v": 0.5, "w": 8.8, "h": 2.6}]
    plan = observed_plan(way(CCW), m)
    (f,) = plan["facades"]
    window, door = (next(o for o in f["openings"] if o["component_kind"] == k) for k in ("window", "door"))
    assert window["trimmed_for_inferred_entry"] and window["read_w"] == pytest.approx(8.8, abs=0.01)
    assert door["evidence"]["inferred"] and not door["evidence"]["observed"]
    assert door["u"] >= window["u"] + window["w"]


def test_a_corner_shop_is_one_tenant_and_a_sliver_without_a_door_is_left_out():
    m = model()
    base = m["storefronts"][0]
    side = {**base, "id": "sf-side", "edge": 1, "u0": 1.0, "u1": 7.0, "openings": [], "signs": [], "awnings": [],
            "extra_signs": [], "lights": []}
    sliver = {**base, "id": "sf-sliver", "name": "Key Cutter", "u0": 11.0, "u1": 12.0, "openings": [
        {"id": "w", "kind": "window", "u": 11.1, "v": 0.5, "w": 0.8, "h": 2.0}], "signs": [], "awnings": [],
        "extra_signs": [], "lights": []}
    m["storefronts"] = [base, side, sliver]
    plan = observed_plan(way(CCW), m)
    names = [(f["name"], f["role"]) for f in plan["facades"]]
    assert names == [("Cafe Lumen", "public"), ("Cafe Lumen", "secondary")]


def test_a_reading_on_the_neighbouring_osm_building_goes_to_that_building():
    # OpenStreetMap splits the block: the read wall lies on the east building's edge.
    west = way([(0, 0), (9, 0), (9, 10), (0, 10)], osm_id=900)
    east = way([(9, 0), (20, 0), (20, 10), (9, 10)], osm_id=901)
    m = model()
    m["storefronts"][0].update(u0=9.4, u1=18.0, openings=[{"id": "d", "kind": "door", "u": 12.0, "v": 0, "w": 1.0, "h": 2.3}],
                               signs=[], awnings=[], extra_signs=[], lights=[])
    world = {"ways": [west, east]}
    found = assign({"900": m}, {"900": west, "901": east})
    assert set(found) == {"901"}
    plans, rejected, unplaced = plans_for_world(world, {"900": m})
    assert set(plans) == {"901"} and not rejected and not unplaced
    assert plans["901"]["facades"][0]["u0"] == pytest.approx(1.0, abs=0.01)


def test_the_tacolicious_block_is_read_as_its_three_shops():
    models = load_models(READINGS)
    world = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    key = "272691788"
    if key not in models or not any(str(w.get("osm_id")) == key for w in world["ways"]):
        pytest.skip("the Chestnut Street reading or its building is not in this checkout")
    plans, _, _ = plans_for_world(world, {key: models[key]})
    names = {f["name"] for f in plans[key]["facades"]}
    assert {"Tacolicious", "Rolo", "Cleaners"} <= names
    assert any(f.get("observed", {}).get("awnings") for f in plans[key]["facades"])


def test_the_publisher_republishes_only_worlds_a_reading_lands_on():
    import importlib.util

    spec = importlib.util.spec_from_file_location("publish_store_exteriors", PUBLISH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    readings = {"900": model()}
    assert mod.read_digest({"ways": []}, readings) is None
    here = mod.read_digest({"ways": [way(CCW)]}, readings)
    assert here and here == mod.read_digest({"ways": [way(CCW)]}, readings)
    changed = model()
    changed["storefronts"][0]["name"] = "Cafe Lumen II"
    assert mod.read_digest({"ways": [way(CCW)]}, {"900": changed}) != here


PROBE = r"""
import {pathToFileURL} from 'node:url';
const THREE = await import(pathToFileURL(process.argv[2]).href);
const {createExteriorRenderer, OBSERVED_MAX_PX} = await import(pathToFileURL(process.argv[3]).href);
const canvases = [];
const ctx = () => new Proxy({measureText: t => ({width: String(t).length * 10})}, {get: (o, k) => k in o ? o[k] : () => {}, set: () => true});
globalThis.document = {createElement: () => {const c = {width: 1, height: 1, getContext: ctx}; canvases.push(c); return c;}};
const plan = JSON.parse(process.argv[4]);
const r = await createExteriorRenderer(THREE, {}, '');
const group = new THREE.Group(); r.mount(group, plan);
const f = plan.facades[0], L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
const t = [(f.b[0] - f.a[0]) / L, (f.b[1] - f.a[1]) / L];
let out = 0, awning = 0, textFront = 0;
group.updateMatrixWorld(true);
group.traverse(o => {
  if (!o.geometry) return; const a = o.geometry.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i) - f.a[0], y = -a.getZ(i) - f.a[1], d = x * f.normal[0] + y * f.normal[1], u = x * t[0] + y * t[1];
    out = Math.max(out, d);
    if (d > 0.9 && a.getY(i) > 2.7 && a.getY(i) < 3.3 && u > f.u0 && u < f.u1) awning++;
    if (o.material.map && d > 1.0) textFront++;
  }
});
console.log(JSON.stringify({out, awning, textFront, biggest: Math.max(...canvases.map(c => Math.max(c.width, c.height))), cap: OBSERVED_MAX_PX}));
"""


@pytest.mark.skipif(not shutil.which("node") or not THREE.exists(), reason="needs node and the vendored three.js")
def test_the_renderer_draws_the_read_awning_blade_and_lettering_in_front_of_the_shop(tmp_path):
    plan = observed_plan(way(CCW), model())
    probe = tmp_path / "probe.mjs"
    probe.write_text(PROBE)
    got = json.loads(subprocess.check_output(["node", str(probe), str(THREE), str(RENDERER), json.dumps(plan)], text=True))
    assert got["awning"] > 0  # the shed awning's front edge, 1 m out at 2.8 m
    assert got["textFront"] > 0  # the valance lettering, in front of the awning's edge
    assert 1.0 <= got["out"] < 1.5  # nothing reaches past the blade and the awning
    assert got["biggest"] <= got["cap"]  # sign art stays small
