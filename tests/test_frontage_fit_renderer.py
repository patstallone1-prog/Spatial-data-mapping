import json
import shutil
import subprocess

import pytest

from tests.test_world_object_renderer import _extract, _page_js


def test_only_reviewed_fits_map_to_correct_edge_with_same_window_design():
    if not shutil.which("node"):
        pytest.skip("Node required")
    fit = {
        "height_m": 6,
        "review_status": "reviewed_inferred_visual_parameters",
        "canonical_geometry_modified": False,
        "conflicts": [],
        "canonical_footprint": [[0, 0], [10, 0], [10, 10]],
        "a": [0, 0],
        "b": [10, 0],
        "openings": [
            {
                "kind": "window",
                "u": 2,
                "v": 1,
                "w": 3,
                "h": 1,
                "design": {"shape": "panoramic", "vertical_bars": [0.2, 0.6]},
            }
        ],
    }
    code = (
        "const FRONTAGE_FITS="
        + json.dumps({"schema": "kerbside.facade_fits/1", "buildings": {"1": fit}})
        + ";\n"
    )
    code += "function xy(x,y){return [x,y];}\n"
    code += "\n".join(
        _extract(name, _page_js())
        for name in ("frontageFitFor", "frontageWindowsOnEdge", "houseCertainty")
    )
    code += """
      const entry = {way:{osm_id:1,height_m:6,points:[[0,0],[10,0],[10,10]]}};
      const forward=frontageWindowsOnEdge(entry,[0,0],[10,0],10,2);
      const reverse=frontageWindowsOnEdge(entry,[10,0],[0,0],10,2);
      if(forward[0].u!==2 || forward[0].v!==3 || reverse[0].u!==5) throw Error("reversed or wrong elevation");
      if(reverse[0].design.shape!=="panoramic" || reverse[0].w!==3) throw Error("style lost");
      if(reverse[0].design.vertical_bars[0]!==.8) throw Error("mullions not mirrored");
      if(frontageFitFor({...entry.way,points:[[0,0],[9,0],[9,10]]})!==null) throw Error("stale footprint accepted");
      if(frontageWindowsOnEdge(entry,[0,0],[0,10],10,0)!==null) throw Error("party wall claimed");
      if(frontageFitFor({osm_id:1,height_m:7})!==null) throw Error("stale height accepted");
      FRONTAGE_FITS.buildings[1].openings.push({kind:"garage_candidate",recess:{render_steps:true}});
      if(frontageFitFor(entry.way)!==null) throw Error("garage stair conflict rendered");
      FRONTAGE_FITS.buildings[1].openings.pop();
      FRONTAGE_FITS.buildings[1].review_status="needs_visual_alignment_review";
      if(frontageFitFor(entry.way)!==null) throw Error("unreviewed promoted");
      const MATERIAL_ASSIGNMENTS={assigned:{}};
      if(!houseCertainty(entry.way).front.includes("inferred")) throw Error("unknown facade claimed reviewed");
      if(houseCertainty(entry.way).metricAccuracy!=="not inch-verified") throw Error("invented precision");
    """
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr


def test_reviewed_front_partition_keeps_every_triangle_and_does_not_claim_back_wall():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = (
        """
    function frontageFitFor(){return {a:[0,0],b:[10,0]};}
    function xy(x,y){return [x,y];}
    const normal={getX:()=>0,getZ:i=>i<3 ? 1 : -1};
    const position={getX:i=>i%3,getZ:i=>i<3 ? 0 : -4};
    const geometry={getAttribute:name=>name==='normal' ? normal : position};
    """
        + _extract("frontageWallTriangles", _page_js())
        + """
    const parts=frontageWallTriangles({},geometry,[0,1,2,3,4,5]);
    if(JSON.stringify(parts.flatMap(p=>p.indices))!=='[0,1,2,3,4,5]')throw Error('lost triangles');
    if(!parts[0].front || parts[1].front)throw Error('back wall claimed observed');
    """
    )
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr


def test_opening_texture_cache_preserves_observed_colour_and_panel_locations():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = (
        """
    const PHOTO_OPENING_TEXTURES=new Map(),homeDesignMaterials=new Map();
    let cleared=0;const ctx={fillRect(){},clearRect(){cleared++;},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
    const document={createElement:()=>({getContext:()=>ctx})};
    const THREE={CanvasTexture:class{constructor(canvas){this.canvas=canvas;}},
      MeshStandardMaterial:class{constructor(config){Object.assign(this,config);}},SRGBColorSpace:'srgb'};
    """
        + "\n".join(
            _extract(name, _page_js()) for name in ("photoOpeningTexture", "homeDesignMaterial")
        )
        + """
    const a=photoOpeningTexture('garage',{colour:'#123456',panel_lines:{horizontal:[.3]}});
    const b=photoOpeningTexture('garage',{colour:'#123457',panel_lines:{horizontal:[.3]}});
    const c=photoOpeningTexture('garage',{colour:'#123456',panel_lines:{horizontal:[.6]}});
    if(a===b || a===c)throw Error('distinct observed colour/panels merged');
    if(a!==photoOpeningTexture('garage',{colour:'#123456',panel_lines:{horizontal:[.3]}}))throw Error('cache missed');
    if(homeDesignMaterial({glass_colour:'#ffff00'})!==homeDesignMaterial({glass_colour:'#112234'}))throw Error('source contents colour baked into glass');
    if(!cleared)throw Error('opaque contents retained');
    """
    )
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr


def test_bay_windows_follow_projection_without_adding_mullions_at_face_seams():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = (
        "\n".join(_extract(name, _page_js()) for name in ("wallPanels", "homeOutcropSurfaces"))
        + """
    const window={u:2,v:3,w:6,h:1,design:{vertical_bars:[.5]}};
    const bay={id:'bay',u:2,v:2,w:6,h:4,profile:[[2,0],[3,1],[7,1],[8,0]]};
    const result=homeOutcropSurfaces([0,0],1,0,0,-1,[bay],[window]);
    if(result.flatWindows.length || result.surfaces.length!==3)throw Error('flat ghost window retained');
    const openings=result.surfaces.flatMap(s=>s.windows);
    if(openings.filter(o=>o.frameLeft).length!==1 || openings.filter(o=>o.frameRight).length!==1)throw Error('seam mullions invented');
    if(result.caps[0].plan.some(p=>p[1]>1.0001))throw Error('projection overflow');
    """
    )
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
