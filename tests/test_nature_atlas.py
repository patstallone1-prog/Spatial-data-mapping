"""Landscape evidence, stable vegetation and shared-edge regression contracts."""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from smc.terrain.nature import validate_layers, write_array
from tests.test_world_object_renderer import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def test_unknown_canopy_is_not_falsely_empty():
    height = np.ones((2, 2))
    cover = np.array([[0, 11], [42, 71]], dtype=np.uint8)
    canopy = np.array([[255, 0], [80, 10]], dtype=np.uint8)
    report = validate_layers(height, cover, canopy)
    assert report["canopy_unknown_nodes"] == 1
    with pytest.raises(ValueError, match="explicitly unknown"):
        validate_layers(height, cover, np.full((2, 2), 254))


def test_invalid_dem_is_not_published_as_flat_land():
    with pytest.raises(ValueError, match="elevation"):
        validate_layers(np.full((2, 2), np.nan), np.zeros((2, 2)), np.zeros((2, 2)))


def test_binary_encoding_is_lossless_deterministic_little_endian(tmp_path):
    values = np.array([[-104, 116872], [0, 933]], dtype="<i4")
    first = write_array(tmp_path / "a.bin", values)
    second = write_array(tmp_path / "b.bin", values)
    assert first["sha256"] == second["sha256"]
    assert gzip.decompress((tmp_path / "a.bin").read_bytes()) == values.tobytes()


def node(code: str) -> dict:
    if not shutil.which("node"):
        pytest.skip("Node is needed for the shared browser landscape kernel")
    preamble = f"import * as n from {json.dumps((ROOT / 'docs/nature-runtime.mjs').as_uri())};\n"
    result = subprocess.run(
        ["node", "--input-type=module", "-e", preamble + code],
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


def test_trees_cross_density_cells_without_overlapping_or_load_order_dependence():
    result = node("""
const sample=()=>({cover:42,canopy:85,water:false});
const all=[];for(let r=-4;r<42;r++)for(let c=-4;c<42;c++){
  const a=n.acceptedTree(c,r,sample);if(a)all.push(a);
}
let overlap=0;for(let i=0;i<all.length;i++)for(let j=0;j<i;j++){
  if(Math.hypot(all[i].x-all[j].x,all[i].y-all[j].y)<all[i].radius+all[j].radius)overlap++;
}
const reverse=[];for(let r=41;r>=-4;r--)for(let c=41;c>=-4;c--){
  const a=n.acceptedTree(c,r,sample);if(a)reverse.push(a.id);
}
console.log(JSON.stringify({count:all.length,overlap,
 same:JSON.stringify(all.map(a=>a.id).sort())===JSON.stringify(reverse.sort()),
 boundary:all.some(a=>Math.abs(a.x-100)<a.radius)}));
""")
    assert result["count"] > 300
    assert result["overlap"] == 0
    assert result["same"] and result["boundary"]


def test_water_unknown_and_road_clearances_never_get_trees():
    result = node("""
let bad=0;for(let c=0;c<100;c++){
 if(n.acceptedTree(c,0,()=>({cover:42,canopy:null,water:false})))bad++;
 if(n.acceptedTree(c,0,()=>({cover:42,canopy:80,water:true})))bad++;
 if(n.acceptedTree(c,0,()=>({cover:24,canopy:80,water:false})))bad++;
 if(n.acceptedTree(c,0,()=>({cover:42,canopy:80,water:false}),()=>true))bad++;
}console.log(JSON.stringify({bad}));
""")
    assert result["bad"] == 0


def test_coarse_physics_is_the_rendered_triangle_not_a_different_bilinear_patch():
    result = node("""
const f={cols:5,rows:5},data=new Int32Array(25);data[24]=10000;
console.log(JSON.stringify({height:n.coarseHeight(data,f,120,40),
 missing:n.bilinear([255,255,255,255],2,2,.5,.5,255),
 canopy:n.bilinear([0,100,0,100],2,2,.5,.5,255)}));
""")
    assert result == {"height": 25, "missing": None, "canopy": 50}


def test_nature_water_colour_matches_the_canonical_city_water_material():
    result = node("console.log(JSON.stringify(n.COVER_COLOURS[11].map(v=>Math.round(v*255))));")
    assert result == [44, 97, 135]
    assert "const TERRAIN_SEA = new THREE.Color(0x2c6187);" in _page_js()


def test_non_city_cover_uses_source_class_and_retains_no_atlas_fallback():
    result = node(
        """
const midLon=0,midLat=0,metersPerLon=1,metersPerLat=1;
const TERRAIN_PLATE={legacyGrass:true},natureLibrary=n;
const THREE={Color:class{setRGB(...rgb){return rgb;}}};
function inCity(){return false;}
let cover=42,NATURE={local:(...p)=>p,sample:()=>({cover})};
"""
        + _extract("terrainLandColourAt", _page_js())
        + """
const forest=terrainLandColourAt(1,2);cover=71;const grass=terrainLandColourAt(1,2);
NATURE.sample=()=>null;const missingPixel=terrainLandColourAt(1,2)===TERRAIN_PLATE;
NATURE=null;const absent=terrainLandColourAt(1,2)===TERRAIN_PLATE;
 console.log(JSON.stringify({forest:JSON.stringify(forest)===JSON.stringify(n.linearColour([.30,.23,.17])),
 distinct:JSON.stringify(forest)!==JSON.stringify(grass),missingPixel,absent}));
"""
    )
    assert result == {"forest": True, "distinct": True, "missingPixel": True, "absent": True}


def test_picking_rejects_hidden_coarse_and_city_owned_landscape():
    result = node("""
const box={x:0,y:0,z:10,w:10};
console.log(JSON.stringify({city:n.visibleNatureGround(5,5,false,[box],false),
 fine:n.visibleNatureGround(20,20,false,[box],true),
 hiddenCoarse:n.visibleNatureGround(20,20,true,[box],true),
 coarse:n.visibleNatureGround(20,20,true,[box],false)}));
""")
    assert result == {"city": False, "fine": True, "hiddenCoarse": False, "coarse": True}


def test_path_clearance_index_preserves_signed_outer_edge_tile_coordinates():
    result = node("""
console.log(JSON.stringify({north:n.pathTileCoordinates('9--1'),
 west:n.pathTileCoordinates('-1-5'),corner:n.pathTileCoordinates('-1--2')}));
""")
    assert result == {"north": [9, -1], "west": [-1, 5], "corner": [-1, -2]}


def test_fine_physics_uses_triangles_and_zero_residual_on_cell_edges():
    result = node("""
const f={cols:101,rows:101},heights=new Int32Array(10201);
const tile={c:0,r:0,cols:201,rows:201,data:new Int32Array(40401)};
tile.data.fill(10000);tile.data[101*201+101]=20000;
console.log(JSON.stringify({edge:n.fineHeight(tile,heights,f,0,1000),
 interior:n.fineHeight(tile,heights,f,1007.5,1002.5),
 blendEdge:n.fineHeight(tile,heights,f,40,1000)}));
""")
    assert result == {"edge": 0, "interior": 125, "blendEdge": 50}


def test_nature_backed_host_and_guest_use_one_orthometric_height_reference():
    result = node(
        """
let NATURE={},ATTACH=null;const EARTH_FLAT_M=3000,EARTH_RADIUS_M=6371000;
"""
        + _extract("earthDrop", _page_js())
        + """
const host=earthDrop(60000,20000);NATURE=null;ATTACH={natureBacked:true};
const guest=earthDrop(60000,20000);ATTACH=null;
console.log(JSON.stringify({host,guest,legacy:earthDrop(60000,20000)>100}));
"""
    )
    assert result == {"host": 0, "guest": 0, "legacy": True}


def test_guest_boundary_join_is_continuous_without_moving_its_measured_geometry():
    result = node(
        """
const SEA_Y=.1;function earthDrop(){return 0;}function rawTerrainHeightAt(){return 200;}
const activeGuest={ready:true,box:[0,0,10,10],oy:10,api:{groundLiftAt:()=>100}};
function hostToGuest(g,x,z){return [x,z];}
"""
        + _extract("natureVisualHeightAt", _page_js())
        + """
console.log(JSON.stringify({edge:natureVisualHeightAt(10,5,200,false),
 half:natureVisualHeightAt(70,5,200,false),far:natureVisualHeightAt(130,5,200,false),
 sea:natureVisualHeightAt(10,5,200,true)}));
"""
    )
    assert result == {"edge": 110, "half": 155, "far": 200, "sea": 0.1}


def test_missing_city_edge_does_not_flatten_distant_hills_to_sea_level():
    result = node(
        """
const f={cols:2,rows:2,x0:0,y0:0,step_m:1,base_m:0,nodata:-32768};
const TERRAIN_FRAME=f,TERRAIN={data:new Int16Array(4).fill(-32768)};
const OPEN_WATER_GROUND_M=0,midLon=0,midLat=0,metersPerLon=1,metersPerLat=1;
function pageToTerrain(x,z){return [x,z];}
let NATURE={local:(...p)=>p,sample:()=>({height:450})};
"""
        + _extract("rawTerrainHeightAt", _page_js())
        + """
const far=rawTerrainHeightAt(500,500),supplied=rawTerrainHeightAt(500,500,430);
const nearMissing=rawTerrainHeightAt(2.5,.5);TERRAIN.data.fill(2000);
const measured=rawTerrainHeightAt(.5,.5);NATURE=null;
console.log(JSON.stringify({far,supplied,nearMissing,measured,legacy:rawTerrainHeightAt(500,500)}));
"""
    )
    assert result == {"far": 450, "supplied": 430, "nearMissing": 450, "measured": 20, "legacy": 20}


def test_refinement_rebases_existing_city_meshes_once_without_losing_storeys_or_triangles():
    result = node(
        """
let ground=100;function rawTerrainHeightAt(x,z){return ground+x;}
class Matrix4{constructor(){this.elements=Array(16).fill(0);}}
const THREE={Matrix4};
function surface(ys,meta){const p={count:ys.length,getX:i=>i*5,getZ:i=>0,
 getY:i=>ys[i],setY:(i,y)=>{ys[i]=y;}};
 return {isMesh:true,userData:meta,ys,geometry:{getAttribute:()=>p,index:{count:6},
 computeVertexNormals(){},computeBoundingSphere(){}}};}
const road=surface([1,2],{natureBases:new Float32Array(2)});
const house=surface([1,11],{natureBuildings:[{ring:[[0,0],[5,0]],base:0,first:0,end:2}]});
const mass={isMesh:true,userData:{natureMassing:new Float32Array(1)},count:1,
 values:Array(16).fill(0),getMatrixAt(i,m){m.elements=this.values.slice();},
 setMatrixAt(i,m){this.values=m.elements.slice();},instanceMatrix:{},computeBoundingSphere(){}};
mass.values[12]=5;mass.values[13]=2;
const TILES=new Map([['a',{bbox:[0,0,1,1],group:{traverse:fn=>[road,house,mass].forEach(fn)}}]]);
"""
        + _extract("syncNatureTileHeights", _page_js())
        + """
syncNatureTileHeights([[0,0,1,1]]);ground=200;syncNatureTileHeights([[0,0,1,1]]);
console.log(JSON.stringify({road:road.ys,house:house.ys,massing:mass.values[13],triangles:road.geometry.index.count}));
"""
    )
    assert result == {"road": [201, 207], "house": [201, 211], "massing": 207, "triangles": 6}


def test_runtime_is_fingerprinted_and_not_an_older_regional_template():
    builder = (ROOT / "tools/build_app_worlds.py").read_text()
    assert 'DOCS / "nature-runtime.mjs"' in builder
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert 'import(sharedAsset("nature-runtime.mjs"))' in source
    assert "if (PERIMETER && !NATURE)" in source


def test_paths_are_attributed_separate_from_canonical_city_measurements():
    base = ROOT / "docs/nature"
    manifest = json.loads((base / "paths.json").read_text())
    assert "openstreetmap.org/copyright" in manifest["source"]
    assert "ODbL" in manifest["license"]
    for record in manifest["tiles"].values():
        encoded = (base / record["file"]).read_bytes()
        assert hashlib.sha256(encoded).hexdigest() == record["sha256"]
        assert len(gzip.decompress(encoded)) == record["decoded_bytes"]


def test_published_atlas_covers_every_cell_and_has_identical_shared_edges():
    base = ROOT / "docs/nature"
    manifest = json.loads((base / "manifest.json").read_text())
    frame = manifest["frame"]
    assert manifest["canonical_city_geometry_modified"] is False
    for record in manifest["arrays"].values():
        encoded = (base / record["file"]).read_bytes()
        assert hashlib.sha256(encoded).hexdigest() == record["sha256"]
        assert len(gzip.decompress(encoded)) == record["decoded_bytes"]
    tiles = {(t["c"], t["r"]): t for t in manifest["detail"]["tiles"]}
    expected = {
        (c, r)
        for r in range(0, (frame["rows"] - 1) * 4, 200)
        for c in range(0, (frame["cols"] - 1) * 4, 200)
    }
    assert set(tiles) == expected
    edges = {}
    for key, record in tiles.items():
        encoded = (base / record["file"]).read_bytes()
        assert hashlib.sha256(encoded).hexdigest() == record["sha256"]
        data = np.frombuffer(gzip.decompress(encoded), dtype="<i4")
        assert data.size == record["cols"] * record["rows"]
        grid = data.reshape(record["rows"], record["cols"])
        edges[key] = [grid[0].copy(), grid[-1].copy(), grid[:, 0].copy(), grid[:, -1].copy()]
    for (c, r), sides in edges.items():
        if (c + 200, r) in edges:
            np.testing.assert_array_equal(sides[3], edges[c + 200, r][2])
        if (c, r + 200) in edges:
            np.testing.assert_array_equal(sides[1], edges[c, r + 200][0])
