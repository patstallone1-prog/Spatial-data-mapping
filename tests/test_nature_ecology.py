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
        # The trunk's foot is sunk a little (bark only), so on a slope it stands in the ground.
        assert record["minY"] >= -0.04 and record["maxY"] <= 1.000001
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


def test_litter_lies_under_its_tree_by_species_and_logs_only_in_a_stand():
    result = node("""
const a=e.litterScatter(120,340,6,'oak',{forest:.9}),b=e.litterScatter(120,340,6,'oak',{forest:.9});
let far=0,logsLone=0,logsStand=0;
for(let i=0;i<400;i++){const s=e.litterScatter(i*13.7,i*7.1,5,'redwood',{forest:1});logsStand+=s.logs.length;
 logsLone+=e.litterScatter(i*13.7,i*7.1,5,'redwood',{forest:0}).logs.length;
 for(const p of s.patches)if(Math.hypot(p.x-i*13.7,p.y-i*7.1)>5*1.15+1e-9)far++;}
console.log(JSON.stringify({same:JSON.stringify(a)===JSON.stringify(b),kinds:[e.litterKind('oak'),e.litterKind('eucalyptus'),e.litterKind('redwood'),e.litterKind('cypress')],
 far,logsLone,logsStand,patches:a.patches.length}));
""")
    assert result["same"]
    assert result["kinds"] == ["leaf_litter", "eucalyptus_litter", "needle_duff", "needle_duff"]
    assert result["far"] == 0 and result["patches"] >= 3
    assert result["logsLone"] == 0 and 20 < result["logsStand"] < 120


def test_a_painted_leaf_has_a_blade_its_teeth_and_veins_to_the_margin():
    r = node("""
    let s = 0; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const out = {};
    for (const form of ["broad", "street", "narrow", "oak"]) {
      const o = g.leafOutline(form, rnd);
      const widest = Math.max(...o.map(([x]) => Math.abs(x)));
      out[form] = { n: o.length, widest, base: g.leafHalfWidth(form, 0), tip: g.leafHalfWidth(form, 1),
        mid: g.leafHalfWidth(form, g.LEAF_FORMS[form].widest), veins: g.LEAF_FORMS[form].veins, teeth: g.LEAF_FORMS[form].teeth };
    }
    console.log(JSON.stringify(out));
    """)
    for form, f in r.items():
        assert f["base"] == 0 and f["tip"] == 0, form
        assert f["widest"] == pytest.approx(f["mid"], rel=0.12), form
        assert f["veins"] >= 6
    assert r["narrow"]["mid"] < 0.5 * r["broad"]["mid"], "a lanceolate blade is narrow"
    assert r["street"]["teeth"] > 0 and r["broad"]["teeth"] == 0


def test_every_fallen_trunk_blocks_but_the_undergrowth_does_not():
    r = node("""
    const log = { x: 0, z: 0, dx: 3, dz: 0, r: 0.25 };
    // The thinnest log the landscape lays down, over many trees.
    let thinnest = 9;
    for (let i = 0; i < 400; i++) for (const l of e.litterScatter(i * 7.3, i * 3.1, 6, 'oak', { forest: 1 }).logs) thinnest = Math.min(thinnest, l.radius);
    console.log(JSON.stringify({ on: n.logHit(log, 1, 0.2, 0.25), end: n.logHit(log, 3.3, 0, 0.25),
      past: n.logHit(log, 3.8, 0, 0.25), beside: n.logHit(log, 0, 0.6, 0.25), threshold: n.LOG_BLOCKS_RADIUS_M, thinnest }));
    """)
    assert r["on"] and r["end"] and not r["past"] and not r["beside"]
    assert r["threshold"] <= r["thinnest"], "every fallen trunk is climbed round, the thin ones too"
    runtime = (ROOT / "docs/nature-runtime.mjs").read_text()
    assert "if(log.radius>=LOG_BLOCKS_RADIUS_M)obstacles.push(" in runtime
    floor = (ROOT / "docs/forest-floor.mjs").read_text()
    blocked = floor.split("blockedAt(x,z,r=.25)")[1][:900]
    assert "d.plants" not in blocked and "d.branches" not in blocked, "plants, grass and branches never block"
    assert "for(const v of d.logs)" in blocked, "the near floor's own logs block where they are drawn"
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "natureWorld.deadwoodBlocked(nextX, nextZ, WALKER_DEADWOOD_RADIUS_M)" in page
    assert "!natureWorld.deadwoodBlocked(p.x, p.z, WALKER_DEADWOOD_RADIUS_M)" in page, "never trapped inside one"


def test_both_tree_systems_use_the_painted_leaves_and_their_relief():
    veg = (ROOT / "docs/vegetation-geometry.mjs").read_text()
    assert "leafCardTextures(THREE,{form:leafForm,layout:'crown'" in veg and "normalMap:normalOf(species)" in veg
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert 'vegetationLibrary.leafCardTextures(THREE, { form: "street", layout: "spray"' in page
    assert "normalMap: leafNormal" in page


def test_bark_tubes_are_round_in_metres_and_wrap_the_tile_whole():
    r = node("""const out={position:[],normal:[],uv:[]};
    // A unit tree stretched 2 wide and 8 tall: a ring round in metres is not round in units.
    g.barkTube(out,[[0,0,0],[0,.5,0],[0,1,0]],[.1,.08,.05],[2,8],{sides:8,size:[2,8]});
    const P=out.position,N=out.normal,U=out.uv,dist=[],norms=[],us=[];
    for(let i=0;i<P.length/3;i++){const y=P[i*3+1]*8,x=P[i*3]*2,z=P[i*3+2]*2;
      const r=(y<.01?.1:y>7.99?.05:.08)*2;dist.push(Math.hypot(x,z)/r);norms.push(Math.hypot(N[i*3],N[i*3+1],N[i*3+2]));us.push(U[i*2]);}
    console.log(JSON.stringify({n:P.length/3,dmin:Math.min(...dist),dmax:Math.max(...dist),nmin:Math.min(...norms),nmax:Math.max(...norms),umax:Math.max(...us)}))""")
    assert r["n"] == 2 * 8 * 6
    assert r["dmin"] == pytest.approx(1, abs=1e-6) and r["dmax"] == pytest.approx(1, abs=1e-6)
    assert r["nmin"] == pytest.approx(1, abs=1e-6) and r["nmax"] == pytest.approx(1, abs=1e-6)
    assert r["umax"] >= 1 and r["umax"] == round(r["umax"])


def test_every_limb_starts_on_its_trunk_and_the_trunk_stands_in_the_ground():
    r = node("""const bad=[],feet=[];
    for(const species of Object.keys(e.SPECIES))for(let v=0;v<4;v++){
      const {skeleton}=g.botanicalGeometry(species,v),[trunk,...limbs]=skeleton;feet.push(trunk.points[0][1]);
      // The nearest point of the trunk's axis to a limb's root, and the trunk's radius there.
      const onTrunk=(p)=>{let best=Infinity;for(let i=1;i<trunk.points.length;i++){
        const a=trunk.points[i-1],b=trunk.points[i],d=b.map((x,k)=>x-a[k]),len2=d.reduce((s,x)=>s+x*x,0)||1;
        const t=Math.max(0,Math.min(1,p.reduce((s,x,k)=>s+(x-a[k])*d[k],0)/len2));
        const q=a.map((x,k)=>x+d[k]*t),r=trunk.radii[i-1]+(trunk.radii[i]-trunk.radii[i-1])*t;
        best=Math.min(best,Math.hypot(...p.map((x,k)=>x-q[k]))-r);}return best;};
      for(const limb of limbs){const gap=onTrunk(limb.points[0]);if(gap>1e-6)bad.push([species,v,+gap.toFixed(4)]);}}
    console.log(JSON.stringify({bad:bad.slice(0,8),count:bad.length,feet:Math.max(...feet)}))""")
    assert r["count"] == 0, r["bad"]
    assert r["feet"] < 0
