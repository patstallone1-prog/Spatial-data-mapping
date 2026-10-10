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
        for name in ("frontageFitFor", "frontageNormalFor", "frontageWindowsOnEdge", "houseCertainty")
    )
    code += """
      const entry = {way:{osm_id:1,height_m:6,points:[[0,0],[10,0],[10,10]]}};
      const forward=frontageWindowsOnEdge(entry,[0,0],[10,0],10,2);
      const reverse=frontageWindowsOnEdge(entry,[10,0],[0,0],10,2);
      if(forward[0].u!==2 || forward[0].v!==3 || reverse[0].u!==5) throw Error("reversed or wrong elevation");
      if(reverse[0].design.shape!=="panoramic" || reverse[0].w!==3) throw Error("style lost");
      FRONTAGE_FITS.buildings[1].openings.push({kind:'window',u:1,v:5.3,w:1,h:2});
      if(frontageWindowsOnEdge(entry,[0,0],[10,0],10,0).length!==1)throw Error('window cut by roof accepted');
      FRONTAGE_FITS.buildings[1].openings.pop();
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
    function frontageFitFor(){return {a:[0,0],b:[10,0],front_normal_enu:[0,-1]};}
    function xy(x,y){return [x,y];}
    const normal={getX:()=>0,getZ:i=>i<3 ? 1 : -1};
    const position={getX:i=>i%3,getZ:i=>i<3 ? 0 : -4};
    const geometry={getAttribute:name=>name==='normal' ? normal : position};
    """
        + _extract("frontageNormalFor", _page_js())
        + _extract("frontageWallTriangles", _page_js())
        + """
    const parts=frontageWallTriangles({},geometry,[0,1,2,3,4,5]);
    if(JSON.stringify(parts.flatMap(p=>p.indices))!=='[0,1,2,3,4,5]')throw Error('lost triangles');
    if(!parts[0].front || parts[1].front)throw Error('back wall claimed observed');
    """
    )
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr


def test_flat_photo_doors_never_float_and_controls_cannot_override_rendered_ground():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = """
      let fit={a:[0,0],b:[10,0],front_normal_enu:[0,-1],height_m:9,openings:[]},ground=0,drawn=[];
      const BUILDING_LIFT_M=2;
      function frontageFitFor(){return fit;}function xy(x,y){return [x,y];}
      function terrainGroundAt(){return ground;}
      function photoOpeningTexture(){return {};}
      function planePart(g,x,y,z,w,h){const mesh={userData:{}};drawn.push([y,w,h]);return mesh;}
    """ + _extract("frontageNormalFor", _page_js()) + _extract("photoOpeningParts", _page_js()) + """
      fit.openings=[{id:'entry',kind:'door',u:1,v:.1524,w:1,h:2.1}];
      ground=2;photoOpeningParts({},{});
      if(drawn.length!==1)throw Error('at-grade door suppressed');
      fit.openings[0].v=.1525;photoOpeningParts({},{});
      if(drawn.length!==1)throw Error('six-inch cap exceeded');
      fit.openings[0].v=3;fit.openings[0].recess={render_steps:true};photoOpeningParts({},{});
      if(drawn.length!==1)throw Error('metadata-only stairs rendered floating panel');
      fit.ground_reference={frame:'relative_to_facade_foot',source:'test',outside_ground_m:3};
      photoOpeningParts({},{});
      if(drawn.length!==1)throw Error('control ignored actual rendered ground');
      fit.openings[0].v=0;fit.openings[0].render_allowed=false;photoOpeningParts({},{});
      if(drawn.length!==1)throw Error('rejected door rendered');
    """
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr


def test_existing_bay_returns_keep_window_fragments_and_never_claim_party_or_back_walls():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = """
      const fit={a:[0,0],b:[10,0],front_normal_enu:[0,-1],openings:[
        {id:'window',kind:'window',u:3,v:3,w:2,h:2,design:{vertical_bars:[.5]}}
      ]};
      function frontageFitFor(){return fit;}function xy(x,y){return [x,y];}
      const entry={way:{},local:[[0,-.81],[3,-.81],[4,0],[5,0],[6,-.81],[10,-.81],[10,-10],[0,-10],[0,-.81]].reverse()};
    """ + _extract("frontageNormalFor", _page_js()) + _extract("frontageWindowsOnEdge", _page_js()) + """
      const L=Math.hypot(1,.81);
      const left=frontageWindowsOnEdge(entry,[4,0],[3,-.81],L,0);
      const middle=frontageWindowsOnEdge(entry,[5,0],[4,0],1,0);
      if(left?.length!==1 || middle?.length!==1)throw Error('canonical bay window lost');
      if(left[0].frameLeft!==false || middle[0].frameRight!==false)throw Error('extra seam frame invented');
      if(left[0].sourceOpeningId!==middle[0].sourceOpeningId)throw Error('one observed window became different identities');
      if(frontageWindowsOnEdge(entry,[10,-10],[10,-.81],9.19,0)!==null)throw Error('party wall claimed');
      if(frontageWindowsOnEdge(entry,[0,-10],[10,-10],10,0)!==null)throw Error('back wall claimed');
      const main=frontageWindowsOnEdge(entry,[3,-.81],[0,-.81],3,0);
      if(main?.length)throw Error('nonoverlapping front surface gained window');
    """
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr


def test_photo_front_orientation_handles_both_footprint_windings_and_reversed_endpoints():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = """
      const fit={a:[0,0],b:[10,0],canonical_footprint:[[0,0],[10,0],[10,8],[0,8]],
        height_m:8,openings:[{id:'d',kind:'door',u:2,v:0,w:1,h:2.1},
        {id:'w',kind:'window',u:3,v:3,w:2,h:2}],front_normal_enu:[0,-1]};
      const BUILDING_LIFT_M=0,drawn=[];
      function xy(x,y){return [x,y];}function frontageFitFor(){return fit;}
      function terrainGroundAt(){return 0;}function photoOpeningTexture(){return {};}
      function planePart(g,x,y,z,w,h){const m={userData:{}};drawn.push([x,z]);return m;}
    """ + "\n".join(_extract(name, _page_js()) for name in (
        "frontageNormalFor", "frontageWindowsOnEdge", "photoOpeningParts", "frontageWallTriangles"
    )) + """
      let entry={way:{},local:[[0,0],[10,0],[10,-8],[0,-8]]};
      if(frontageNormalFor(fit)?.[1]!==1)throw Error('forward normal wrong');
      photoOpeningParts({},{});if(drawn[0][1]<=0)throw Error('door placed inside wall');
      if(frontageWindowsOnEdge(entry,[0,0],[10,0],10,0)?.length!==1)throw Error('forward front lost');
      fit.a=[10,0];fit.b=[0,0];fit.canonical_footprint.reverse();
      if(frontageNormalFor(fit)?.[1]!==1)throw Error('clockwise normal wrong');
      entry.local=[[0,0],[10,0],[10,-8],[0,-8]].reverse();
      if(frontageWindowsOnEdge(entry,[10,0],[0,0],10,0)?.length!==1)throw Error('clockwise front lost');
      // A different physical front: reverse winding and put the interior north
      // of the plane. The camera-facing side is now south, independent of order.
      fit.a=[0,0];fit.b=[10,0];fit.canonical_footprint=[[0,0],[10,0],[10,-8],[0,-8]];
      fit.front_normal_enu=[0,1];entry.local=[[0,0],[10,0],[10,8],[0,8]];
      photoOpeningParts({},{});if(drawn[1][1]>=0)throw Error('opposite-front door buried');
      if(frontageWindowsOnEdge(entry,[0,0],[10,0],10,0)?.length!==1)throw Error('opposite front lost');
      delete fit.front_normal_enu;
      if(frontageNormalFor(fit)?.[1]!==-1)throw Error('legacy exact-footprint fallback wrong');
      fit.front_normal_enu=[0,-1];
      if(frontageNormalFor(fit)!==null)throw Error('normal contradicting footprint accepted');
      fit.front_normal_enu=[0,10];if(frontageNormalFor(fit)!==null)throw Error('nonunit normal accepted');
      fit.front_normal_enu=[0,1];fit.a=[NaN,0];
      if(frontageNormalFor(fit)!==null)throw Error('nonfinite front accepted');
      fit.a=[0,0];fit.canonical_footprint=[null,[10,0],[10,-8]];
      if(frontageNormalFor(fit)!==null)throw Error('invalid footprint accepted');
      delete fit.front_normal_enu;delete fit.canonical_footprint;
      if(frontageNormalFor(fit)!==null)throw Error('unbound orientation guessed');
    """
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("region", [
    "sf-corridor", "sf-mission", "sf-haight-castro", "sf-sunset", "oakland-downtown",
    "berkeley-downtown", "palo-alto-downtown", "san-jose-downtown",
])
def test_real_regional_footprints_keep_their_outward_photo_fronts(region):
    """Real geometry orientation audit, not a photographic accuracy certificate."""
    import math
    from pathlib import Path

    if not shutil.which("node"):
        pytest.skip("Node required")
    root = Path(__file__).resolve().parents[1]
    model = root / ("docs/sf-corridor-3d.json" if region == "sf-corridor"
                    else f"docs/app-regions/{region}/sf-corridor-3d.json")
    payload = json.loads(model.read_text())
    bbox = payload["bbox"]
    lat, lon = (bbox["north"] + bbox["south"]) / 2, (bbox["east"] + bbox["west"]) / 2
    scale = 111320 * math.cos(math.radians(lat))
    cases = []
    for way in payload["ways"]:
        if way.get("kind") != "building" or len(way.get("points", [])) < 4:
            continue
        ring = way["points"]
        local = [[(x-lon)*scale, -(y-lat)*111320] for x, y in ring]
        signed = sum(p[0]*q[1]-q[0]*p[1] for p, q in zip(local, local[1:]+local[:1], strict=True))
        if abs(signed) < .01:
            continue
        i = max(range(len(local)), key=lambda j: math.dist(local[j], local[(j+1) % len(local)]))
        p, q = local[i], local[(i+1) % len(local)]
        length = math.dist(p, q)
        if length < 1:
            continue
        ex, ez = (q[0]-p[0])/length, (q[1]-p[1])/length
        nx, nz = (ez, -ex) if signed > 0 else (-ez, ex)
        cases.append({"fit": {"a": ring[i], "b": ring[(i+1) % len(ring)],
                               "canonical_footprint": ring, "front_normal_enu": [nx, -nz],
                               "openings": [{"kind": "window", "u": .3*length, "v": 1, "w": .4*length, "h": 1}]},
                      "entry": {"way": {}, "local": local}, "p": p, "q": q, "length": length})
        if len(cases) == 12:
            break
    assert len(cases) == 12, f"insufficient real footprint cases in {region}"
    script = (f"const cases={json.dumps(cases)},lon={lon},lat={lat},scale={scale};\n"
              "function xy(x,y){return [(x-lon)*scale,(y-lat)*111320];}\n"
              "let fit;function frontageFitFor(){return fit;}\n"
              + _extract("frontageNormalFor", _page_js()) + _extract("frontageWindowsOnEdge", _page_js())
              + """
      for(const c of cases) {
        fit=c.fit;
        if(!frontageNormalFor(fit))throw Error('valid regional normal rejected');
        if(frontageWindowsOnEdge(c.entry,c.p,c.q,c.length,0)?.length!==1)throw Error('regional front window lost');
        fit.canonical_footprint.reverse();c.entry.local.reverse();
        if(!frontageNormalFor(fit))throw Error('winding reversal flipped physical normal');
        if(frontageWindowsOnEdge(c.entry,c.q,c.p,c.length,0)?.length!==1)throw Error('reversed regional front window lost');
      }
    """)
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, f"{region}: {result.stderr}"


def test_pilot_uses_all_canonical_vertices_instead_of_four_corner_proxy():
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "tools/preview_photo_fronts.py").read_text()
    assert "points[(i+1)%points.length]" in source and "points[(i+1)%4]" not in source
    assert "canonical_front_footprint_uv" in source and "new THREE.ShapeGeometry(roofShape)" in source
    assert "new THREE.BoxGeometry(w,.14,d)" not in source


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
            _extract(name, _page_js()) for name in ("photoOpeningTexture", "homeWindowArchSpring", "homeDesignMaterial")
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


def test_photo_residual_never_compounds_an_existing_canonical_bay_or_offset_wall():
    if not shutil.which("node"):
        pytest.skip("Node required")
    code = """
      const fit={a:[0,0],b:[10,0],height_m:9,outcrops:[
        {id:'bay',render:true,property_sha256:'hash',property_source:'parcel',
         u:2,v:3,w:6,h:2,depth_m:.6,profile:[[2,0],[3,.6],[7,.6],[8,0]]}
      ]};
      function frontageFitFor(){return fit;}function xy(x,y){return [x,y];}
      const entry={way:{},local:[[0,0],[10,0],[10,-10],[0,-10]]};
    """ + _extract("frontageOutcropsOnEdge", _page_js()) + """
      if(frontageOutcropsOnEdge(entry,[0,0],[10,0],10,0).length!==1)throw Error('flat residual lost');
      entry.local=[[0,0],[3,0],[4,.7],[6,.7],[7,0],[10,0],[10,-10],[0,-10]];
      if(frontageOutcropsOnEdge(entry,[0,0],[10,0],10,0).length)throw Error('duplicate projection on prior bay');
      entry.local=[[0,0],[10,0],[10,-10],[0,-10]];
      if(frontageOutcropsOnEdge(entry,[0,.2],[10,.2],10,0).length)throw Error('residual on offset face');
      fit.outcrops[0].canonical_relief_overlap=true;
      if(frontageOutcropsOnEdge(entry,[0,0],[10,0],10,0).length)throw Error('prior conflict ignored');
    """
    result = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
