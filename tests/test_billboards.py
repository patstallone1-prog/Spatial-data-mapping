import json
import shutil
import subprocess

import pytest

from smc.billboards import billboard_geometry, enrich_advertisement, metres, safe_website
from tests.test_world_object_renderer import _extract, _page_js


def test_display_dimensions_are_not_support_height():
    geometry = billboard_geometry({"size": "4*3", "height": "6", "sides": "2", "direction": "W"})
    assert (geometry["width_m"], geometry["height_m"], geometry["bottom_m"]) == (4, 3, 3)
    assert geometry["azimuth_deg"] == 270 and geometry["sides"] == 2
    assert geometry["dimensions_basis"] == "osm_size_tag"


def test_tagged_total_and_minimum_height_resolve_actual_face():
    geometry = billboard_geometry({"width": "25 ft", "height": "6", "min_height": "2"})
    assert geometry["width_m"] == 7.62 and geometry["height_m"] == 4 and geometry["bottom_m"] == 2
    assert billboard_geometry({"height": "3", "min_height": "0"})["bottom_m"] == 0
    assert metres("14 ft") == pytest.approx(4.2672)
    assert metres("NaN") is None and metres("1000000") is None


def test_default_is_horizontal_and_explicitly_inferred_roof_mount():
    geometry = billboard_geometry({"location": "roof"})
    assert geometry["width_m"] > 2 * geometry["height_m"]
    assert geometry["height_basis"] == "inferred_mount_height"
    assert "not_measured" in geometry["dimensions_basis"]
    bulletin = billboard_geometry({"width": "48 ft", "height": "12"})
    assert bulletin["height_m"] == pytest.approx(4.2672)
    assert bulletin["bottom_m"] == pytest.approx(7.7328)


@pytest.mark.parametrize(
    "value",
    [
        "javascript:alert(1)",
        "data:text/html,a",
        "https://u:p@example.org",
        "https://example.org\n",
        "file:///a",
        "//example.org",
    ],
)
def test_unsafe_links_rejected(value):
    assert safe_website(value) is None


def test_source_metadata_is_retained_and_missing_advertiser_is_not_invented():
    original = {
        "id": "osm:ad_panel:node:1",
        "ad_kind": "billboard",
        "p": [1, 2],
        "tags": {"advertising": "billboard"},
    }
    result = enrich_advertisement(
        original, {"size": "4x3", "support": "wall_mounted", "website": "https://example.org"}
    )
    assert result["p"] == original["p"] and result["website"] == "https://example.org"
    assert (
        result["tags"]["size"] == "4x3" and result["display_geometry"]["support"] == "wall_mounted"
    )
    assert enrich_advertisement(original)["website"] == "https://www.openstreetmap.org/node/1"
    assert "display_geometry" not in original


def run_js(names, body):
    if not shutil.which("node"):
        pytest.skip("Node required")
    source = "\n".join(_extract(n, _page_js()) for n in names) + body
    result = subprocess.run(["node", "-e", source], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_overlay_contains_image_without_stretching_and_cover_is_explicit():
    result = run_js(
        ["billboardImagePlacement"],
        """
      console.log(JSON.stringify([billboardImagePlacement(100,100,400,200),
        billboardImagePlacement(100,100,400,200,'cover')]));
    """,
    )
    assert result == [[100, 0, 200, 200], [0, -100, 400, 400]]


def test_clicks_only_visible_unoccluded_faces_and_support_attached_regions():
    result = run_js(
        ["safeBillboardWebsite", "activateBillboard"],
        """
      const opened=[],scene={visible:true,isScene:true},face={visible:true,parent:scene,userData:{href:'https://example.org'}};
      const billboardFaces=[],activeGuest={ready:true,api:{billboardFaces:[face]},root:scene};
      const groups={mapped3d:{},ground:{},furniture:{}},terrainTiles=[],window={open:(...args)=>opened.push(args)};
      let blocked=false;
      const caster={intersectObjects:(objects)=>objects.includes(face)?[{object:face,distance:10}]:
        blocked ? [{object:{parent:scene,visible:true},distance:2}] : []};
      const clear=activateBillboard(caster);blocked=true;const occluded=activateBillboard(caster);
      blocked=false;face.visible=false;const hidden=activateBillboard(caster);
      face.visible=true;face.parent=null;const detached=activateBillboard(caster);
      console.log(JSON.stringify({clear,occluded,hidden,detached,opened}));
    """,
    )
    assert result["clear"] and not any(result[k] for k in ("occluded", "hidden", "detached"))
    assert result["opened"] == [["https://example.org/", "_blank", "noopener,noreferrer"]]


def test_billboard_path_replaces_tiny_ad_panel_and_keeps_clicks_before_walking():
    source = _page_js()
    assert "billboards: addBillboards(billboards,creatives)" in source
    assert "const posts = stops.concat(smallAds)" in source
    assert "if(e.button===0 && activateBillboard(ray))return;" in source
    assert "billboardFaces," in source


def test_two_sided_wall_board_has_real_dimensions_and_independent_faces():
    result = run_js(
        ["safeBillboardWebsite", "billboardSpec", "addBillboards"],
        """
      class Group {constructor(){this.children=[];this.position={set:(x,y,z)=>{this.xyz=[x,y,z];}};this.rotation={y:0};this.userData={};}
        add(o){o.parent=this;this.children.push(o);}}
      class Mesh extends Group {constructor(g,m){super();this.geometry=g;this.material=m;}}
      class Geometry {constructor(...dimensions){this.dimensions=dimensions;}}
      const THREE={Group,Mesh,BoxGeometry:Geometry,PlaneGeometry:Geometry,CylinderGeometry:Geometry,
        MeshStandardMaterial:class{constructor(options){Object.assign(this,options);}},FrontSide:'front'};
      const groups={furniture:new Group()},billboardFrameMaterial={},billboardFaces=[];
      function billboardAnchor(){return {x:12,y:7,z:4};}function furnitureBearing(){return 0;}
      function billboardTexture(){return null;}
      const count=addBillboards([{id:'osm:ad_panel:node:1',ad_kind:'billboard',p:[0,0],
        display_geometry:{width_m:4,height_m:3,bottom_m:2,sides:2,support:'wall_mounted',azimuth_deg:90}}]);
      const board=groups.furniture.children[0];
      console.log(JSON.stringify({count,position:board.xyz,yaw:board.rotation.y,
        children:board.children.length,faces:billboardFaces.map(f=>({dimensions:f.geometry.dimensions,
          position:f.xyz,yaw:f.rotation.y,side:f.material.side,href:f.userData.href}))}));
    """,
    )
    assert result["count"] == 1 and result["children"] == 3
    assert result["position"] == [12, 7, 4] and result["yaw"] == pytest.approx(1.57079632679)
    assert [f["dimensions"] for f in result["faces"]] == [[4, 3], [4, 3]]
    assert [f["yaw"] for f in result["faces"]] == pytest.approx([0, 3.14159265359])
    assert all(f["side"] == "front" for f in result["faces"])
