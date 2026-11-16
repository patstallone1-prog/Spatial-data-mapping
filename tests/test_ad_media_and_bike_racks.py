"""The city's advertising signs and bicycle racks: imported, merged and drawn the right way round."""
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from tests.test_world_object_renderer import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def _script(path):
    name = path.stem
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ads = _script(ROOT / "scripts/build_ad_media.py")
racks = _script(ROOT / "scripts/build_bike_racks.py")


def _permit(record_id, lon, lat, **extra):
    return {"record_id": record_id, "status": "Permitted", "name": "1 Main St", "p": [lon, lat], **extra}


def test_permits_join_the_mapped_boards_and_two_at_an_address_are_one_two_faced_sign():
    document = {"bbox": {"west": -122.5, "east": -122.3, "south": 37.7, "north": 37.9}, "inferred": {"ad_panels": [
        {"id": "osm:ad_panel:node:1", "ad_kind": "billboard", "p": [-122.4, 37.8]}]}}
    rows = [_permit("A", -122.4001, 37.8),          # ~9 m from the mapped board: that board
            _permit("B", -122.41, 37.81), _permit("C", -122.41002, 37.81001),   # one address
            _permit("D", -122.6, 37.8)]              # outside the world
    stats = ads.merge(document, rows)
    assert stats == {"added": 1, "matched_mapped_boards": 1}
    mapped, sign = document["inferred"]["ad_panels"]
    assert mapped["permit_record"] == "A"
    assert sign["id"] == "sfplanning:gas:B" and sign["permit_records"] == ["B", "C"]
    geometry = sign["display_geometry"]
    assert geometry["support"] == "auto" and geometry["sides"] == 2
    assert (geometry["width_m"], geometry["height_m"]) == (7.62, 3.66)
    assert geometry["dimensions_basis"] == "inferred_standard_poster_for_permitted_sign"
    # Merging again changes nothing.
    before = json.dumps(document, sort_keys=True)
    ads.merge(document, rows)
    assert json.dumps(document, sort_keys=True) == before


def test_a_removed_sign_is_not_drawn_and_no_contact_details_are_kept():
    assert ads.standing(_permit("A", 0, 0))
    assert not ads.standing(_permit("B", 0, 0, description="Removed per photos provided by sign company."))
    assert not ads.standing({**_permit("C", 0, 0), "status": "Withdrawn"})
    assert "planner" not in ads.FIELDS.lower()


def test_racks_on_the_street_are_kept_and_those_inside_are_not():
    rows = [
        {"objectid": "1", "placement": "SIDEWALK", "racks": "2", "spaces": "4", "shape": {"coordinates": [-122.43, 37.80]}},
        {"objectid": "2", "placement": "ROADWAY", "racks": "8", "spaces": "16", "install_yr": "2019", "shape": {"coordinates": [-122.42, 37.76]}},
        {"objectid": "3", "placement": "GARAGE", "racks": "10", "shape": {"coordinates": [-122.41, 37.78]}},
        {"objectid": "4", "placement": "SIDEWALK", "racks": "1", "shape": None},
        {"objectid": "5", "placement": "SIDEWALK", "racks": "1", "shape": {"coordinates": [-121.9, 37.33]}},   # San Jose
    ]
    out = racks.records(rows)
    assert [r["id"] for r in out] == ["datasf:bike_rack:1", "datasf:bike_rack:2"]
    assert out[0]["placement"] == "sidewalk" and out[0]["racks"] == 2 and out[0]["spaces"] == 4
    assert out[1]["placement"] == "roadway" and out[1]["year"] == 2019


def _node(source):
    if not shutil.which("node"):
        pytest.skip("Node required")
    result = subprocess.run(["node", "-e", source], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_racks_stand_along_the_kerb_on_the_pavement_and_across_it_in_a_corral():
    # A street along x, its kerb at z = 5 (the pavement beyond, z > 5); buildings from z = 9.
    js = "\n".join(_extract(n, _page_js()) for n in ["placeCityBikeRacks"]) + """
      const BIKE_RACK={height:0.9,half:0.275,pipe:0.03,row:2.4,corral:0.9,slot:0.16};
      let bikeRackStats={};const ROAD_TOP_M=0.06,KERB_FALLBACK=0.126;
      const xy=(lon,lat)=>[lon,lat];
      const nearestKerbAt=(x,z)=>({x,z:5,nx:0,nz:1,ax:1,az:0,half:5});
      const streetSquareKerb=(k)=>k;
      const insideCarriageway=(x,z)=>z<5,insideJunctionBox=()=>false,onCrossingGround=()=>false,insideBikeLane=()=>false;
      const buildingAt=(x,z)=>z>9,pavementTopAt=()=>0.19,groundLiftAt=()=>0;
      const out=placeCityBikeRacks([{id:'s',p:[0,-7],racks:2,placement:'sidewalk'},{id:'c',p:[40,-7],racks:3,placement:'roadway'}]);
      console.log(JSON.stringify(out.map(r=>({id:r.id,x:r.x,z:r.z,ux:Math.cos(r.yaw),uz:-Math.sin(r.yaw),corral:r.corral,
        slots:r.slots.map(s=>({x:s.x,z:s.z,fx:-Math.sin(s.yaw),fz:-Math.cos(s.yaw),lock:[s.lock.x,s.lock.z]}))}))));
    """
    out = _node(js)
    side = [r for r in out if not r["corral"]]
    corral = [r for r in out if r["corral"]]
    assert len(side) == 2 and len(corral) == 3
    for r in side:
        # On the pavement, about a metre in from the kerb, its U along the kerb.
        assert 5.7 < r["z"] < 6.3 and abs(r["ux"]) == pytest.approx(1) and abs(r["uz"]) < 1e-9
        # A bicycle each side of it, along the kerb, one facing each way; the lock between.
        assert sorted(round(s["z"] - r["z"], 2) for s in r["slots"]) == [-0.16, 0.16]
        assert sorted(round(s["fx"]) for s in r["slots"]) == [-1, 1]
        for s in r["slots"]:
            assert min(r["z"], s["z"]) - 1e-6 <= s["lock"][1] <= max(r["z"], s["z"]) + 1e-6
    assert abs(side[0]["x"] - side[1]["x"]) == pytest.approx(2.4)
    for r in corral:
        # In the parking lane, its U across the kerb, the bicycles' front wheels to the kerb.
        assert 3.5 < r["z"] < 5 and abs(r["uz"]) == pytest.approx(1) and abs(r["ux"]) < 1e-9
        assert all(round(s["fz"]) == 1 for s in r["slots"])


def test_ad_faces_are_laid_out_for_their_shape():
    js = "\n".join(_extract(n, _page_js()) for n in ["billboardImagePlacement", "composeAdFace"]) + """
      const calls=[];const ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(){},
        createLinearGradient(){return {addColorStop(){}};},drawImage(img,...a){calls.push(a.map(v=>Math.round(v)));}};
      composeAdFace(ctx,{},2000,874,2048,984,'contain',[0.5,0.5]);   // a billboard
      const wide=calls.splice(0);
      composeAdFace(ctx,{},2000,874,1000,1480,'contain',[0.2,0.4]);   // a shelter's light box
      console.log(JSON.stringify({wide,tall:calls}));
    """
    out = _node(js)
    # Wide: the backdrop, then all of the picture inside the face.
    x, y, w, h = out["wide"][-1]
    assert x >= 0 and y >= 0 and x + w <= 2048 and y + h <= 984 and w == 2048
    # Tall: the focus filling the top, then the whole picture across the foot, inside the face.
    top, band = out["tall"]
    assert top[3] < 1480 and top[2] > 1000
    assert band[0] > 0 and band[0] + band[2] < 1000 and band[1] + band[3] < 1480 and band[2] / band[3] == pytest.approx(2000 / 874, rel=0.01)


def test_the_billboard_builder_keeps_to_its_creative_registry() -> None:
    builder = (ROOT / "scripts/build_billboards.py").read_text()
    assert 'manifest.get("schema") != "kerbside.billboard_creatives/1"' in builder
    assert "data/billboard-creatives.json" in builder
    registry = json.loads((ROOT / "data/billboard-creatives.json").read_text())
    assert registry["schema"] == "kerbside.billboard_creatives/1" and registry["boards"]
