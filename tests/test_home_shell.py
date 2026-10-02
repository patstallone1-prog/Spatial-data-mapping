"""Physical visual openings, not view-dependent facade masking."""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_world_object_renderer import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def run_js(names, body):
    if not shutil.which("node"):
        pytest.skip("Node required")
    script = "\n".join(_extract(name, _page_js()) for name in names) + "\n" + body
    result = subprocess.run(["node", "-e", script], text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def test_wall_panels_do_not_bridge_any_window_or_door():
    holes = [{"u": 1, "v": 0, "w": 1, "h": 2.1}, {"u": 4, "v": 0.8, "w": 1.4, "h": 1.5},
             {"u": 4.8, "v": 1.8, "w": 1.0, "h": 1.0}]
    panels = run_js(["wallPanels"], f"console.log(JSON.stringify(wallPanels(10, 0, 3, {json.dumps(holes)})))")
    area = 0
    for a, b, c, d in panels:
        assert 0 <= a < c <= 10 and 0 <= b < d <= 3
        area += (c - a) * (d - b)
        for hole in holes:
            assert min(c, hole["u"] + hole["w"]) <= max(a, hole["u"]) + 1e-9 or \
                min(d, hole["v"] + hole["h"]) <= max(b, hole["v"]) + 1e-9
    assert area == pytest.approx(30 - 2.1 - 2.1 - 1.0 + 0.3)


@pytest.mark.parametrize("height", [2.4, 2.7, 4.2, 5.5, 7.1, 13.0, 34.0])
def test_whole_windows_fit_non_integer_storeys(height):
    windows = run_js(["regularHomeWindows"], f"""
      function random(s) {{ return (Math.sin(s) + 1) / 2; }}
      console.log(JSON.stringify(regularHomeWindows(9.7, 42, {42 + height}, 72)));
    """)
    for o in windows:
        assert 0.1 <= o["u"] and o["u"] + o["w"] <= 9.6
        assert o["v"] >= 42 and o["v"] + o["h"] <= 42 + height - 0.1


def test_foyer_removes_partition_and_collision_together():
    out = run_js(["clipOutsideZones"], """
      function pointInRing(x,z,r) { return x>2 && x<4 && z>0 && z<5; }
      console.log(JSON.stringify(clipOutsideZones([0,2,6,2], [[[2,0],[4,0],[4,5],[2,5]]])));
    """)
    assert out == [[0, 2, 2, 2], [4, 2, 6, 2]]


def test_retiring_shell_restores_exact_city_batch():
    out = run_js(["setBatchedHomeVisible"], """
      const index = {array:new Uint32Array([0,1,2,3,4,5]), needsUpdate:false};
      const BUILDING_VISUAL_RANGES=new Map([['1',[{mesh:{geometry:{getIndex:()=>index}},
        start:3,indices:[3,4,5]}]]]);
      setBatchedHomeVisible(1,false); const hidden=Array.from(index.array);
      setBatchedHomeVisible(1,true);
      console.log(JSON.stringify({hidden,restored:Array.from(index.array)}));
    """)
    assert out == {"hidden": [0, 1, 2, 3, 3, 3], "restored": [0, 1, 2, 3, 4, 5]}


def test_recess_is_not_house_entry_until_past_landing():
    out = run_js(["insideEntranceRecess"], """
      const entry={doors:[{cx:5,cz:0,ux:1,uz:0,nx:0,nz:1,
        stoopPlan:{width:1.4,depth:2.7}}]};
      console.log(JSON.stringify([insideEntranceRecess(entry,5,1),
        insideEntranceRecess(entry,5,2.7),insideEntranceRecess(entry,5,3.1),
        insideEntranceRecess(null,5,1)]));
    """)
    assert out == [True, True, False, False]


def test_front_and_landing_both_reach_recessed_door():
    out = run_js(["nearestDoor"], """
      const DOOR_REACH_M=1.8,DOOR_DRAW_M=60;
      const avatar={position:{x:5,z:4}};
      const d={cx:5,cz:0,nx:0,nz:1,mesh:{},stoopPlan:{depth:4}};
      function doorsNear(){return [d];}
      console.log(JSON.stringify(nearestDoor()===d));
    """)
    assert out


def test_closed_recess_is_accessible_but_leaf_and_returns_stop_walker():
    # Use the existing collision harness so this also exercises swept substeps.
    from tests.test_walking_and_interiors import TestWalls
    out = TestWalls()._run("""
      entry.doors=[{edge:0,t0:0.4,t1:0.6,width:2,open:false,
        cx:5,cz:0,ux:1,uz:0,nx:0,nz:1,stoopPlan:{depth:3}}];
      moveWalker(0,7);
      console.log(JSON.stringify([avatar.position.x,avatar.position.z]));
    """)
    assert out[0] == pytest.approx(5)
    assert out[1] == pytest.approx(2.7)


def test_open_foyer_and_connection_stay_inside_property():
    out = run_js(["insideFootprint", "entryAccessZones"], """
      const entry={local:[[0,0],[10,0],[10,10],[0,10],[0,0]],minX:0,maxX:10,minZ:0,maxZ:10,
        doors:[{mesh:{},cx:5,cz:0,width:1,nx:0,nz:1}]};
      const rooms=[{kind:'living',pts:[[2,3],[8,3],[8,8],[2,8]]}];
      console.log(JSON.stringify(entryAccessZones(entry,rooms)));
    """)
    assert len(out) == 2
    assert max(p[0] for p in out[0]) - min(p[0] for p in out[0]) == pytest.approx(2.8)
    assert all(0 <= x <= 10 and 0 <= z <= 10 for zone in out for x, z in zone)


def test_stair_aperture_uses_stair_width_not_narrower_door_width():
    from tests.test_walking_and_interiors import TestWalls
    out = TestWalls()._run("""
      entry.doors=[{edge:0,t0:0.4,t1:0.6,width:2,open:false,
        cx:5,cz:0,ux:1,uz:0,nx:0,nz:1,stoopPlan:{depth:3,width:2.4}}];
      avatar.position.x=4.15;
      moveWalker(0,3);
      console.log(JSON.stringify([avatar.position.x,avatar.position.z]));
    """)
    assert out == pytest.approx([4.15, 1])


def test_photo_openings_reversed_wall_keeps_original_edge_coordinates():
    from scripts.build_home_openings import compile_openings
    from smc.reconstruction.geo import EnuFrame
    frame = EnuFrame(-122.41, 37.79, 0)
    points = [[-122.41,37.79], [-122.4099,37.79], [-122.4099,37.7901],
              [-122.41,37.7901], [-122.41,37.79]]
    ring = [list(frame.to_enu(*p, 0)[:2]) for p in points]
    row = {"id":"building:1", "status":"accepted", "source_hash":"test",
           "object":{"id":"building:1", "anchor":[-122.41,37.79,0],
                     "geometry":{"facades":[{"start":ring[1],"end":ring[0],
                      "elements":[{"kind":"window","u":1,"v":1,"w":1,"h":1,
                                   "confidence":0.9}]}]}}}
    result = compile_openings([row], {"1":{"points":points,"height_m":3}})
    window = result["buildings"]["1"]["walls"]["0"][0]
    import math
    assert window[0] == pytest.approx(math.dist(ring[0],ring[1]) - 2, abs=0.001)
    assert result["buildings"]["1"]["grade"] == "image_on_prior_geometry"
    rejected = {**row, "status":"rejected"}
    assert not compile_openings([row,rejected], {"1":{"points":points,"height_m":3}})["buildings"]


def test_imported_furniture_hashes_and_gltf_dependencies():
    root = ROOT / "docs/interior-assets"
    manifest = json.loads((root / "manifest.json").read_text())
    assert len(manifest["assets"]) >= 4
    for asset in manifest["assets"]:
        assert asset["license"] == "CC0-1.0"
        for file in asset["files"]:
            data = (root / file["path"]).read_bytes()
            assert len(data) == file["bytes"]
            assert hashlib.sha256(data).hexdigest() == file["sha256"]
        model = root / asset["model"]
        gltf = json.loads(model.read_text())
        for row in gltf.get("buffers", []) + gltf.get("images", []):
            assert (model.parent / row["uri"]).is_file()


def test_window_has_one_registry_and_two_sided_transparency():
    js = _page_js()
    assert 'depthWrite: false, side: THREE.DoubleSide' in js
    shell = _extract("buildHomeShell", js)
    assert 'windowRegistry.push(pane.userData)' in shell
    assert 'camera.position' not in shell
    assert 'wallPanels(length, bottom, top, [...cuts, ...windows])' in shell
    assert 'setBatchedHomeVisible(id, false)' in shell
    assert 'if (!entry.homeShell)' in _extract("buildInterior", js)
