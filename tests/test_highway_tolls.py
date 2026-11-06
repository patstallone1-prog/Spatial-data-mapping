"""Toll plazas and gantries: which of OpenStreetMap's toll elements are a road's, which way each
faces and how wide it spans, and that the renderer stands each on its road."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.highways.tolls import TollOsm, infer_tolls  # noqa: E402

NODE = shutil.which("node")
THREE = ROOT / "tools/unreal/node_modules/three/build/three.module.js"


def north(m: float, east_m: float = 0.0) -> tuple[float, float]:
    return (-122.3 + east_m / 88000.0, 37.8 + m / 111320.0)


def plaza() -> TollOsm:
    osm = TollOsm()
    # A five-lane freeway running west (bearing 270), and a park road far away.
    for i, e in enumerate(range(0, -1001, -100)):
        osm.nodes[i] = north(0, e)
    osm.roads[1] = {"tags": {"highway": "motorway", "lanes": "5", "ref": "I 80", "bridge": "no"}, "nodes": list(range(11))}
    osm.gantries.append({"id": 50, "p": north(2, -400), "tags": {"highway": "toll_gantry", "name": "Bay Bridge Toll"}})
    osm.booths.append({"id": 60, "p": north(-3, -380), "tags": {"barrier": "toll_booth"}})
    osm.booths.append({"id": 61, "p": north(3, -385), "tags": {"barrier": "toll_booth"}})
    osm.booths.append({"id": 70, "p": north(5000, 3000), "tags": {"barrier": "toll_booth", "name": "Park entrance"}})
    canopy = [north(-12, -390), north(-12, -370), north(12, -370), north(12, -390), north(-12, -390)]
    osm.booth_ways.append({"id": 80, "points": canopy, "tags": {"barrier": "toll_booth", "building": "roof", "layer": "1"}})
    return osm


def test_a_freeways_tolls_are_found_faced_and_sized_and_a_parks_kiosk_is_not() -> None:
    records = {r["id"]: r for r in infer_tolls(plaza())}
    assert set(records) == {"gantry/50", "booth/60", "booth/61", "canopy/80"}   # not the park's booth
    g = records["gantry/50"]
    assert g["kind"] == "toll_gantry" and g["name"] == "Bay Bridge Toll"
    assert g["bearing"] == pytest.approx(270, abs=0.5) and g["lanes"] == 5 and g["width_m"] == pytest.approx(18.3)
    # Booths near each other are one plaza, named for the bridge's gantry beside them.
    assert records["booth/60"]["plaza"] == records["booth/61"]["plaza"]
    assert records["booth/60"]["name"] == "Bay Bridge Toll"
    assert records["canopy/80"]["kind"] == "toll_canopy" and len(records["canopy/80"]["outline"]) == 5
    assert all(r["basis"].startswith("inferred:") for r in records.values())


@pytest.mark.skipif(NODE is None or not THREE.exists(), reason="node and three are needed to run the renderer")
def test_the_renderer_stands_a_gantry_over_every_lane_and_a_booth_on_its_island() -> None:
    records = infer_tolls(plaza())
    code = f"""
import * as THREE from {json.dumps(THREE.as_uri())};
const m = await import({json.dumps((ROOT / "src/smc/highways/toll_renderer.mjs").as_uri())});
const records = {json.dumps(records)};
const place = (lon, lat) => ({{ x: (lon + 122.3) * 88000, z: -(lat - 37.8) * 111320 }});
const group = m.buildTolls(THREE, records, {{ place, ground: () => 10, decks: () => [], document: null }});
const gantry = group.children.find((c) => c.userData.kind === "toll_gantry");
const readers = gantry.children.filter((c) => c.userData.surface === "furniture:toll_reader");
const truss = gantry.children.filter((c) => c.userData.surface === "furniture:toll_gantry");
const lowestTruss = Math.min(...truss.filter((t) => t.scale.x > 10).map((t) => t.position.y - t.scale.y / 2));
const booth = group.children.find((c) => c.userData.kind === "toll_booth");
const nose = booth.children.find((c) => c.userData.surface === "furniture:toll_attenuator");
const canopy = group.children.find((c) => c.userData.surface === "furniture:toll_canopy" && c.geometry?.type === "ExtrudeGeometry");
canopy.geometry.computeBoundingBox();
console.log(JSON.stringify({{ summary: group.userData.summary, readers: readers.length, y: gantry.position.y,
  rotation: gantry.rotation.y, clearance: lowestTruss, span: Math.max(...truss.map((t) => t.scale.x)),
  nose: nose.position.z, canopyBottom: canopy.position.y }}));
"""
    out = subprocess.run([NODE, "--input-type=module", "-e", code], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[-2000:]
    r = json.loads(out.stdout)
    assert r["summary"]["counts"] == {"toll_gantry": 1, "toll_booth": 2, "toll_canopy": 1}
    assert r["readers"] == 5                               # one over each lane
    assert r["y"] == 10                                    # on the road
    assert r["clearance"] >= 6.0                           # Caltrans clearance under the truss
    assert r["span"] > 18.3 + 2 * 3.0                      # the carriageway and both shoulders
    assert r["nose"] > 0                                   # the attenuator meets the oncoming traffic
    assert r["canopyBottom"] == pytest.approx(10 + 5.6)


def test_the_page_loads_the_tolls_with_the_street_furniture() -> None:
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert 'registerLazyLayer("highway_tolls", async () => {' in page
    assert 'const module=await import(sharedAsset(`highway-toll-renderer.mjs?v=' in page
    published = json.loads((ROOT / "docs/highway-tolls.json").read_text())
    assert published["schema"] == "kerbside.highway_tolls/1" and published["kinds"]["toll_gantry"] >= 10
    assert (ROOT / "docs/highway-toll-renderer.mjs").read_text() == (ROOT / "src/smc/highways/toll_renderer.mjs").read_text()


def test_the_build_script_publishes_the_records_and_its_renderer(tmp_path, monkeypatch) -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_highway_tolls

    monkeypatch.setattr(build_highway_tolls, "OUT", tmp_path / "highway-tolls.json")
    monkeypatch.setattr(build_highway_tolls, "RENDERER", tmp_path / "highway-toll-renderer.mjs")
    body = build_highway_tolls.publish(infer_tolls(plaza()), (-122.4, 37.7, -122.2, 37.9))
    written = json.loads((tmp_path / "highway-tolls.json").read_text())
    assert written == body and written["kinds"] == {"toll_booth": 2, "toll_canopy": 1, "toll_gantry": 1}
    renderer = (tmp_path / "highway-toll-renderer.mjs").read_bytes()
    assert renderer == (ROOT / "src/smc/highways/toll_renderer.mjs").read_bytes()
    assert written["renderer_sha256"] == build_highway_tolls.sha256(tmp_path / "highway-toll-renderer.mjs")
