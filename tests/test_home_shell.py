"""Physical visual openings, not view-dependent facade masking."""
import hashlib
import json
import math
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


def test_interior_floors_and_window_rows_respect_existing_storey_inventory():
    counts = run_js(["homeStoreyCount"], """
      console.log(JSON.stringify([
        homeStoreyCount({way:{tags:{}},fit:[0,0,0,0,0,0,0,0,0,6]},38.38),
        homeStoreyCount({way:{tags:{'building:levels':'3'}},fit:[0,0,0,0,0,0,0,0,0,4]},12),
        homeStoreyCount({way:{tags:{}},fit:[0,0,0,0,0,0,0,0,0,1]},38.38)]));
    """)
    assert counts == [6, 3, 12]


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


def test_junction_signal_anchor_can_reach_pavement_without_entering_building():
    out = run_js(["nearestGroundOffRoad", "furnitureAnchor"], """
      const FURNITURE_SNAP_REACH_M=12,FURNITURE_KERB_SETBACK_M=0.45;
      const ROAD_TOP_M=0.1,KERB_FALLBACK=0.126;
      function xy(x,y){return [x,y];}
      function insideBikeLane(){return false;}
      function insideCarriageway(x,z){return Math.hypot(x,z)<15;}
      function insideJunctionBox(){return false;}
      function nearestKerbAt(){return null;}
      function buildingAt(x,z){return x>0;}
      function pavementTopAt(){return 0.226;}
      function groundLiftAt(){return 7;}
      console.log(JSON.stringify([furnitureAnchor({p:[0,0]}),
        furnitureAnchor({p:[0,0]},32)]));
    """)
    assert out[0] is None
    assert out[1]["x"] <= 0
    assert math.hypot(out[1]["x"], out[1]["z"]) >= 15
    assert out[1]["y"] == pytest.approx(7.226)


def test_address_arrival_stays_outside_house_and_faces_its_door():
    out = run_js(["addressLanding"], """
      const state={yaw:0,look:1};
      const d={cx:5,cz:0,nx:0,nz:1};
      const footprintById=new Map([['1',{doors:[d]}]]);
      function buildingAt(x,z){return z>=0?{osm_id:1}:null;}
      function eligibleLanding(p){return {fallback:true};}
      const THREE={Vector3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}}};
      const p=addressLanding({x:5,z:5});
      console.log(JSON.stringify({p,forward:[-Math.sin(state.yaw),-Math.cos(state.yaw)],look:state.look}));
    """)
    assert out["p"] == {"x": 5, "y": 0, "z": -1.5}
    assert out["forward"] == pytest.approx([0, 1])
    assert out["look"] == 0


def test_all_app_regions_have_usable_provenance_tagged_interior_plans():
    index = json.loads((ROOT / "docs/app-regions.json").read_text())
    for region in index["regions"]:
        if not region.get("built"):
            continue
        page = ROOT / "docs" / region["path"]
        # Oakland has its expanded local payload; the others reuse their own
        # regional source assets, never SF building IDs.
        directory = page.parent
        if region["name"] not in ("sf-corridor", "oakland-downtown"):
            directory = ROOT / "docs/regions" / region["name"]
        data = json.loads((directory / "sf-corridor-interiors.json").read_text())
        assert data["region"] == region["name"]
        assert data["buildings"] and data["library"] and data["sources"]
        for record in data["buildings"].values():
            assert 0 <= record[0] < len(data["library"])
            for edge, t, width, source in record[13]:
                assert edge >= 0 and 0 <= t <= 1 and width > 0 and source in (0, 1, 2)


def test_furniture_retries_away_from_foyer_but_never_spills_outside_room():
    out = run_js(["furnishingPlacement"], """
      function pointInRing(x,z,r){return x>r[0][0]&&x<r[2][0]&&z>r[0][1]&&z<r[2][1];}
      function insideFootprint(e,x,z){return x>0&&x<10&&z>0&&z<8;}
      const room=[[0,0],[10,0],[10,8],[0,8]];
      const entry={accessZones:[[[4,0],[6,0],[6,8],[4,8]]]};
      console.log(JSON.stringify([furnishingPlacement(entry,room,[1.7,0.9],[]),
        furnishingPlacement(entry,[[0,0],[0.7,0],[0.7,8],[0,8]],[1.7,0.9],[])]));
    """)
    assert out[0] is not None
    assert out[0]["cx"] < 4 or out[0]["cx"] > 6
    assert out[1] is None


def test_furniture_rotates_to_fit_a_narrow_room_and_searches_clipped_intersection():
    out = run_js(["furnishingPlacement"], """
      function pointInRing(x,z,r){return x>r[0][0]&&x<r[2][0]&&z>r[0][1]&&z<r[2][1];}
      function insideFootprint(e,x,z){return x>6&&x<9&&z>0&&z<1.95;}
      const entry={minX:6,maxX:9,minZ:0,maxZ:1.95,accessZones:[]};
      console.log(JSON.stringify(furnishingPlacement(entry,[[0,0],[10,0],[10,1.95],[0,1.95]],
        [1.5,2.0],[])));
    """)
    assert out is not None
    assert 7.15 < out["cx"] < 7.85
    assert out["yaw"] == pytest.approx(1.5707963267948966)


def test_vallejo_concave_home_has_safe_living_and_bedroom_furnishings():
    data = json.loads((ROOT / "docs/sf-corridor-interiors.json").read_text())
    fit = data["buildings"]["288529259"]
    plan = data["library"][fit[0]]
    way = next(w for w in json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())["ways"]
               if str(w.get("osm_id")) == "288529259")
    lon, lat, yaw = fit[4], fit[5], math.radians(fit[6])
    east = 111320 * math.cos(math.radians(lat))
    ring = [[(x - lon) * east, -(y - lat) * 111320] for x, y in way["points"]]
    rooms = []
    for kind, flat in plan["rooms"]:
        points = []
        for k in range(0, len(flat), 2):
            u = flat[k] / 100 * fit[7] / plan["l"]
            v = flat[k + 1] / 100 * fit[8] / plan["w"]
            points.append([u * math.cos(yaw) - v * math.sin(yaw),
                           -(u * math.sin(yaw) + v * math.cos(yaw))])
        rooms.append({"kind": data["kinds"][kind], "pts": points})
    entry = {"local": ring, "accessZones": []}
    for axis, index in (("X", 0), ("Z", 1)):
        entry[f"min{axis}"] = min(p[index] for p in ring)
        entry[f"max{axis}"] = max(p[index] for p in ring)
    out = run_js(["insideFootprint", "pointInRing", "furnishingPlacement"],
                 f"const entry={json.dumps(entry)};const rooms={json.dumps(rooms)};" + """
      const sizes={living:[1.7,.9],bedroom:[1.5,2]};
      console.log(JSON.stringify(rooms.filter(r=>sizes[r.kind] &&
        furnishingPlacement(entry,r.pts,sizes[r.kind],[])).map(r=>r.kind)));
    """)
    assert "living" in out and out.count("bedroom") >= 2


def test_sparse_grass_raster_conservatively_covers_every_ring_bound():
    out = run_js(["grassRasterRows"], """
      function xy(x,y){return [x,y];}
      console.log(JSON.stringify(grassRasterRows([
        [[2,2],[4,2],[4,4],[2,4]],[[3,3],[5,3],[5,5],[3,5]]],0,0,20,20,1)));
    """)
    assert all(not row for row in out[:1] + out[6:])
    assert out[3] == [[1, 6]]
    for y in (2, 3, 4):
        for x in (2, 3, 4):
            assert any(a <= x < b for a, b in out[y])


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
    assert len(manifest["assets"]) >= 30
    roles = {asset["role"] for asset in manifest["assets"]}
    for role in ("sofa", "bed", "dresser", "nightstand", "tv_stand", "coffee_table", "ceiling_lamp", "bulb"):
        assert role in roles, role
    for asset in manifest["assets"]:
        # Poly Haven's are CC0; Google's scans are CC BY and carry their credit.
        assert asset["license"] in ("CC0-1.0", "CC-BY-4.0")
        if asset["license"] == "CC-BY-4.0":
            assert "Google" in asset["attribution"] and asset["source"].startswith("https://")
        for file in asset["files"]:
            data = (root / file["path"]).read_bytes()
            assert len(data) == file["bytes"]
            assert hashlib.sha256(data).hexdigest() == file["sha256"]
        model = root / asset["model"]
        if model.suffix == ".glb":
            assert model.read_bytes()[:4] == b"glTF"
            continue
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
