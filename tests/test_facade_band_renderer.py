import json
import shutil
import subprocess

import pytest

from tests.test_world_object_renderer import _extract, _page_js


def run(body, names):
    if not shutil.which("node"):
        pytest.skip("Node required")
    js = "\n".join(_extract(n, _page_js()) for n in names) + body
    result = subprocess.run(["node", "-e", js], text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_band_materials_colours_propagate_around_building_and_gaps_use_fallback():
    result = run(
        """
      const MATERIALS=[{name:'brick',rough:.8},{name:'stucco',rough:.9}];
      const PHOTO_CLASS_TO_MATERIAL={brick:'brick',stucco_render:'stucco'};
      function frontageFitFor(){return {appearance:{bands:[
        {bottom_m:0,top_m:3,colour:'#884433',material:'brick'},
        {bottom_m:3,top_m:6,colour:'#ddeedd',material:'stucco_render'}]}};}
      const fallback={material:{name:'concrete'},height:9,tint:123,bottom:0,top:9};
      const bands=facadeAppearanceBands({},fallback);
      console.log(JSON.stringify(bands.map(b=>[b.bottom,b.top,b.material.name,b.tint,b.otherSidesBasis])));
    """,
        ("facadeAppearanceBands",),
    )
    assert result[0][:4] == [0, 3, "brick", 0x884433]
    assert result[1][:4] == [3, 6, "stucco", 0xDDEEDD]
    assert result[2][:4] == [6, 9, "concrete", 123]
    assert all(r[4] == "inferred_same_height_band" for r in result)


def test_clipping_preserves_wall_surface_and_no_seam_gap_or_new_caps():
    result = run(
        """
      class Attribute{constructor(a,s){this.array=a;this.itemSize=s;this.count=a.length/s;}getX(i){return this.array[i*this.itemSize];}getY(i){return this.array[i*this.itemSize+1];}getZ(i){return this.array[i*this.itemSize+2];}}
      class Geometry{constructor(){this.a={};}getAttribute(n){return this.a[n];}setAttribute(n,a){this.a[n]=a;return this;}}
      const THREE={BufferGeometry:Geometry,Float32BufferAttribute:Attribute};
      const g=new Geometry();g.setAttribute('position',new Attribute([0,12,0,10,12,0,10,18,0,0,18,0],3));
      g.setAttribute('normal',new Attribute([0,0,1,0,0,1,0,0,1,0,0,1],3));g.setAttribute('uv',new Attribute([0,0,1,0,1,1,0,1],2));
      const parts=[clipFacadeBand(g,[0,1,2,0,2,3],12,15),clipFacadeBand(g,[0,1,2,0,2,3],15,18)];
      const area=part=>{const a=part.getAttribute('position').array;let sum=0;for(let i=0;i<a.length;i+=9){sum+=Math.abs((a[i+3]-a[i])*(a[i+7]-a[i+1])-(a[i+6]-a[i])*(a[i+4]-a[i+1]))/2;}return sum;};
      console.log(JSON.stringify(parts.map(p=>({area:area(p),ys:p.getAttribute('position').array.filter((v,i)=>i%3===1),uvs:p.getAttribute('uv').array}))));
    """,
        ("clipFacadeBand",),
    )
    assert sum(p["area"] for p in result) == pytest.approx(60)
    assert max(result[0]["ys"]) == min(result[1]["ys"]) == 15
    assert all(0 <= v <= 1 for p in result for v in p["uvs"])


def test_single_full_height_band_survives_and_roundoff_never_extends_above_roof():
    result = run(
        """
      const MATERIALS=[{name:'brick'}],PHOTO_CLASS_TO_MATERIAL={brick:'brick'};
      function frontageFitFor(){return {appearance:{bands:[{bottom_m:0,top_m:6.005,material:'brick',colour:'#884433',front_basis:'reviewed'}]}};}
      console.log(JSON.stringify(facadeAppearanceBands({}, {height:6,tint:123,material:{name:'stucco'}})));
    """,
        ("facadeAppearanceBands",),
    )
    assert len(result) == 1
    assert result[0]["top"] == 6 and result[0]["frontBasis"] == "reviewed"
    assert result[0]["material"]["name"] == "brick"
    assert "appearanceBands.some(b=>b.frontBasis)" in _page_js()


def test_far_window_trim_cache_separates_otherwise_identical_windows():
    result = run(
        """
      const draws=[],homeDesignMaterials=new Map(),homeDecalMaterial={};
      const document={createElement:()=>({getContext:()=>({set fillStyle(c){draws.push(c);},fillRect(){},clearRect(){}})})};
      const THREE={CanvasTexture:class {constructor(c){this.canvas=c;}},MeshStandardMaterial:class {constructor(o){Object.assign(this,o);}},SRGBColorSpace:'srgb'};
      const white={vertical_bars:[.5],trim:{colour:'#ffffff'}},red={vertical_bars:[.5],trim:{colour:'#aa3333'}};
      const a=homeDesignMaterial(white),b=homeDesignMaterial(red);
      console.log(JSON.stringify({same:a===b,reused:a===homeDesignMaterial(white),draws}));
    """,
        ("homeWindowArchSpring", "homeDesignMaterial"),
    )
    assert not result["same"] and result["reused"]
    assert result["draws"] == ["#ffffff", "rgba(231,240,243,0.12)", "#ffffff", "#aa3333", "rgba(231,240,243,0.12)", "#aa3333"]


def test_near_shell_preserves_bands_trims_and_disposes_owned_materials():
    shell = _extract("buildHomeShell", _page_js())
    assert "spec.appearanceBands" in shell
    assert "Math.max(y0,low)" in shell and "Math.min(y1,high)" in shell
    assert "bandMaterials[i]" in shell and "trimMaterials.get(trimColour)" in shell
    assert "...bandMaterials,...trimMaterials.values()" in shell


def test_storefront_overlay_does_not_repaint_observed_wall_band():
    result = run(
        """
      const quads=[],panels=[],PHOTO_CLASS_TO_MATERIAL={brick:'brick'},STOREFRONT_STANDALONE_MAX_M=6.5,STOREFRONT_BAND_M=3.9,STOREFRONT_VARIANTS=4;
      const THREE={Color:class{constructor(c){this.c=c;}getHex(){return Number.parseInt(this.c.slice(1),16);}clone(){return this;}multiplyScalar(){return this;}}};
      function bestFacadeWall(){return {span:8,yaw:0};}function shopBays(){return [{trade:'shop',share:8,centre:0}];}
      function frontageFitFor(){return {appearance:{bands:[{bottom_m:0,top_m:4,colour:'#884433',material:'brick'}]}};}
      function storefrontColour(){throw Error('observed colour overwritten');}function awningSink(){return {};}
      function wallPoint(w,a){return {x:a,z:0};}function awningQuad(...x){quads.push(x);}
      function storefrontTexture(...x){return x;}function planePart(...x){panels.push(x);}function random(){return 0;}
      addStorefronts({}, {}, 1, 9, 0xffffff);
      console.log(JSON.stringify({quads:quads.length,texture:panels[0][6],panelHeight:panels[0][5]}));
    """,
        ("addStorefronts",),
    )
    assert result["quads"] == 0
    assert result["texture"] == ["shop", 0, 0x884433, False, True]
    assert result["panelHeight"] < 4
