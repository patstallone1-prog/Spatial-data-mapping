"""Continuous habitat, bounded botanical geometry and non-mutating city clearance."""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]


def node(code):
    if not shutil.which("node"):
        pytest.skip("Node required for shared renderer kernel")
    preamble = "".join(
        f"import * as {alias} from {json.dumps((ROOT / 'docs' / file).as_uri())};\n"
        for alias, file in [
            ("e", "nature-ecology.mjs"),
            ("g", "vegetation-geometry.mjs"),
            ("n", "nature-runtime.mjs"),
        ]
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", preamble + code],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def test_habitat_gradients_have_no_density_cell_or_class_edge_jump():
    result = node("""
const cover=new Uint8Array(64),canopy=new Uint8Array(64);
for(let y=0;y<8;y++)for(let x=0;x<8;x++){cover[y*8+x]=x<4?42:31;canopy[y*8+x]=x<4?80:0;}
const a=e.habitatMixture(cover,canopy,8,8,3.4999,3),b=e.habitatMixture(cover,canopy,8,8,3.5001,3);
let stragglers=0;for(let r=0;r<50;r++)for(let c=0;c<20;c++){
 const a=n.treeCandidate(c,r,()=>({cover:31,water:false,canopy:12,habitat:{forest:.2,scrub:.1,canopy:12}}));if(a)stragglers++;
}
console.log(JSON.stringify({difference:Math.abs(a.forest-b.forest),stragglers,
 field:Math.abs(e.field(99.999,30)-e.field(100.001,30))}));
""")
    assert result["difference"] < 0.001
    assert result["field"] < 0.001
    assert 40 < result["stragglers"] < 400


def test_groves_cluster_without_creating_a_monoculture_or_fake_census():
    result = node("""
let same=0,total=0;const counts={};for(let y=0;y<3000;y+=17)for(let x=0;x<3000;x+=17){
 const s=e.speciesAt(x,y,-122.47,37.795,{forest:1});counts[s]=(counts[s]||0)+1;
 if(s===e.speciesAt(x+8,y,-122.47,37.795,{forest:1}))same++;total++;
}
console.log(JSON.stringify({same:same/total,counts,total}));
""")
    assert 0.50 < result["same"] < 0.95
    assert len(result["counts"]) >= 4
    assert 0.25 < result["counts"]["eucalyptus"] / result["total"] < 0.60


def test_rebuilt_botanical_forms_obey_the_advertised_clearance_bounds():
    result = node("""
const records=Object.keys(e.SPECIES).map(s=>{const model=g.botanicalGeometry(s,0),other=g.botanicalGeometry(s,1);
 let maxR=0,minY=1,maxY=0;for(const p of [model.bark.position,model.leaf.position])for(let i=0;i<p.length;i+=3){maxR=Math.max(maxR,Math.hypot(p[i],p[i+2]));minY=Math.min(minY,p[i+1]);maxY=Math.max(maxY,p[i+1]);}
 return {s,maxR,minY,maxY,distinct:JSON.stringify(model.leaf.position)!==JSON.stringify(other.leaf.position),vertices:model.leaf.position.length/3};});
console.log(JSON.stringify(records));
""")
    for record in result:
        assert record["maxR"] <= 1.000001
        assert record["minY"] >= -1e-8 and record["maxY"] <= 1.000001
        assert record["distinct"] and record["vertices"] > 500


def test_subtraction_cuts_plant_triangles_at_wall_not_whole_tree_or_anchor():
    result = node("""
const a={position:{size:3,array:[-2,1,0,2,1,0,0,1,2]},uv:{size:2,array:[0,0,1,0,.5,1]}};
const ring=[[0,-1],[3,-1],[3,3]],planes=g.trianglePrismPlanes(ring,0,4),result=g.clipOutsidePrisms(a,[planes]);
const above={position:{size:3,array:[.3,5,0,1,5,0,.3,5,.5]}};
let inside=0;for(let i=0;i<result.position.length;i+=9){const p=[0,1,2].map(k=>(result.position[i+k]+result.position[i+3+k]+result.position[i+6+k])/3);
 if(planes.every(a=>a[0]*p[0]+a[1]*p[1]+a[2]*p[2]+a[3]>1e-6))inside++;
}
console.log(JSON.stringify({inside,vertices:result.position.length/3,uv:result.uv.length,
 above:g.clipOutsidePrisms(above,[planes]).position.length,unchanged:a.position.array[0]===-2}));
""")
    assert result["inside"] == 0
    assert result["vertices"] >= 3 and result["uv"] == result["vertices"] * 2
    assert result["above"] == 9 and result["unchanged"]


def test_published_ecology_assets_match_sources_and_checksums():
    base = ROOT / "docs/nature"
    manifest = json.loads((base / "ecology.json").read_text())
    assert manifest["canonical_geometry_modified"] is False
    assert manifest["street_tree_locations_modified"] is False
    sources = json.loads((base / "manifest.json").read_text())
    assert manifest["source_cover_sha256"] == sources["arrays"]["cover"]["sha256"]
    assert manifest["source_canopy_sha256"] == sources["arrays"]["canopy"]["sha256"]
    for key in ("floor", "clearance"):
        record = manifest[key]
        encoded = (base / record["file"]).read_bytes()
        assert hashlib.sha256(encoded).hexdigest() == record["sha256"]
        assert len(gzip.decompress(encoded)) == record["decoded_bytes"]
    assert manifest["clearance"]["decoded_bytes"] < 12_000_000
    assert (
        hashlib.sha256((base / "paths.json").read_bytes()).hexdigest()
        == manifest["clearance"]["paths_manifest_sha256"]
    )


def test_floor_colours_include_brown_forest_and_distinct_nonforest_types():
    pytest.importorskip("rasterio")
    pytest.importorskip("scipy")
    spec = importlib.util.spec_from_file_location(
        "ecology_builder", ROOT / "scripts/build_nature_ecology.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    colours = {}
    for cover in [11, 21, 31, 41, 42, 43, 52, 71, 90, 95]:
        pixels = module.floor_pixels(
            np.full((5, 5), cover, np.uint8), np.full((5, 5), 75 if cover == 21 else 0, np.uint8)
        )
        colours[cover] = pixels[2, 2, :3].tolist()
    assert colours[42][0] > colours[42][1] > colours[42][2]
    assert colours[21][0] > colours[21][1] > colours[21][2]
    assert colours[11] == [44, 97, 135]
    assert len({tuple(rgb) for rgb in colours.values()}) >= 7


def test_street_tree_layout_and_near_far_ground_sampling_share_one_source():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "treeBuildingPrisms" in source and "clipOutsidePrisms(attributes,clipping[i])" in source
    assert "dummy.position.set(x, 0, -y);" in source
    assert "random(i * 7 + kind.length)" in source
    runtime = (ROOT / "docs/nature-runtime.mjs").read_text()
    assert "diffuseColor.rgb=sourceCover.rgb" in runtime
    assert "atlas.farBlocked(sx,sy)" in runtime
    assert "new THREE.ConeGeometry" not in runtime


def test_release_fingerprints_every_new_runtime_dependency():
    release = json.loads((ROOT / "docs/runtime-release.json").read_text())
    for name in [
        "nature-runtime.mjs",
        "nature-ecology.mjs",
        "vegetation-geometry.mjs",
        "foliage-motion.mjs",
        "nature/ecology.json",
    ]:
        assert (
            release["runtime_assets_sha256"][name]
            == hashlib.sha256((ROOT / "docs" / name).read_bytes()).hexdigest()
        )


def test_wall_coplanar_triangles_are_not_duplicated_and_interior_is_removed():
    result = node("""
const planes=g.trianglePrismPlanes([[0,0],[3,0],[0,3]],0,3);
const source=(p)=>({position:{array:p,size:3}});
const wall=g.clipOutsidePrisms(source([0,1,.2,0,2,.2,0,1,.8]),[planes]);
const inside=g.clipOutsidePrisms(source([.2,1,.2,.3,1,.2,.2,1,.3]),[planes]);
console.log(JSON.stringify({wall:wall.position.length,inside:inside.position.length}));
""")
    assert result == {"wall": 9, "inside": 0}


def test_every_zoom_range_has_a_visible_representation_without_a_fade_hole():
    result = node("""
let missing=0;for(let d=0;d<30000;d+=7){const w=n.plantLODWeights(d);
 if(Math.abs(w.reduce((a,b)=>a+b,0)-1)>1e-9||w.some(a=>a<0))missing++;
}console.log(JSON.stringify({missing,near:n.plantLODWeights(50),far:n.plantLODWeights(20000)}));
""")
    assert result == {"missing": 0, "near": [1, 0, 0], "far": [0, 0, 1]}


def test_published_forest_pixels_are_soil_brown_and_water_is_unchanged():
    base = ROOT / "docs/nature"
    source = json.loads((base / "manifest.json").read_text())
    ecology = json.loads((base / "ecology.json").read_text())
    cover = np.frombuffer(
        gzip.decompress((base / source["arrays"]["cover"]["file"]).read_bytes()), np.uint8
    )
    pixels = np.frombuffer(
        gzip.decompress((base / ecology["floor"]["file"]).read_bytes()), np.uint8
    ).reshape(-1, 4)
    assert np.all(pixels[cover == 11, :3] == [44, 97, 135])
    for kind in [41, 42, 43]:
        forest = pixels[cover == kind, :3]
        assert len(forest) > 100
        assert np.mean((forest[:, 0] > forest[:, 1]) & (forest[:, 1] > forest[:, 2])) > 0.95


def test_dry_woodlands_do_not_get_a_moist_redwood_understory():
    result = node("""
const kinds=new Set();let water=0;for(let x=0;x<2000;x+=4){
 const sample={cover:41,water:false,canopy:70,moisture:.1,habitat:{canopy:70,forest:1,scrub:0,grass:0,wetland:0}};
 const a=e.undergrowthAt(x,30,sample);if(a)kinds.add(a.kind);
 if(e.undergrowthAt(x,30,{...sample,water:true}))water++;
}console.log(JSON.stringify({kinds:[...kinds],water}));
""")
    assert result["water"] == 0
    assert "fern" not in result["kinds"] and "sorrel" not in result["kinds"]
    assert len(result["kinds"]) >= 1
