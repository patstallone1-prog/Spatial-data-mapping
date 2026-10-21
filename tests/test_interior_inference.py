"""Acceptance, corruption and integration probes for the bounded interior pilot."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

pytest.importorskip("shapely")

from shapely.geometry import box, shape

from smc.interiors.inference import HouseInput, StoreyInput, infer_house
from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.model import polygon
from smc.interiors.inference.style import house_style
from smc.interiors.inference.validate import validate_house

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "docs/inferred-interiors"


@pytest.fixture(scope="module")
def houses():
    manifest = json.loads((PILOT / "manifest.json").read_text())
    assert len(manifest["houses"]) == 16
    assert manifest["passed"] == 16
    return [json.loads((PILOT / row["file"]).read_text()) for row in manifest["houses"]]


def test_all_sixteen_houses_are_connected_and_physically_valid(houses):
    for house in houses:
        report = validate_house(house)
        assert report["passed"], (house["id"], report["errors"])
        assert report["metrics"]["coverage_min"] > 0.9999
        assert report["metrics"]["connected_rooms"] == report["metrics"]["room_count"]
        assert report["metrics"]["hallway_area_fraction_max"] < 0.32
        assert house["grade"] == "inferred" and house["measured"] is False
    assert sum(h["id"].startswith("osm-") for h in houses) == 8
    assert {len(h["storeys"]) for h in houses} == {1, 2, 3}


@pytest.mark.parametrize("index", [0, 4, 6, 11])
def test_fresh_engine_output_matches_contract_without_address_rules(index):
    inputs = json.loads((PILOT / "inputs.json").read_text())
    house = infer_house(HouseInput.from_json(inputs[index]))
    assert validate_house(house)["passed"]
    assert house["provenance"]["not_an_as_built_survey"]


def test_setback_storeys_share_stairs_and_preserve_given_heights():
    spec = HouseInput(
        "setback-probe",
        box(0, 0, 12, 10),
        (StoreyInput(3.1), StoreyInput(2.7, box(0, 0, 10, 10))),
        bedrooms=3,
        total_height_m=5.8,
    )
    house = infer_house(spec)
    assert house["total_height_m"] == pytest.approx(5.8)
    assert [f["elevation_m"] for f in house["storeys"]] == [0, 3.1]
    assert house["stairs"][0]["steps"][-1]["top_m"] == pytest.approx(3.1)
    assert shape(house["stairs"][0]["footprint"]).within(box(0, 0, 10, 10))


def test_corrupt_table_support_is_detected(houses):
    house = copy.deepcopy(houses[0])
    prop = next(o for o in house["storeys"][0]["objects"] if o["support"]["kind"] == "object")
    prop["position_m"][1] += 0.12
    assert any("floating/intersecting tabletop" in e for e in validate_house(house)["errors"])


def test_blocked_door_and_missing_bed_are_detected(houses):
    house = copy.deepcopy(houses[0])
    floor = house["storeys"][0]
    bed = next(o for o in floor["objects"] if o["role"] == "bed")
    door = next(o for o in floor["openings"] if bed["room_id"] in o["rooms"])
    bed["footprint"] = door["clearance"]
    assert any("blocked door" in e for e in validate_house(house)["errors"])
    floor["objects"] = [o for o in floor["objects"] if o["id"] != bed["id"]]
    assert any("missing required furniture" in e for e in validate_house(house)["errors"])


def test_missing_stair_slab_cut_is_detected(houses):
    house = copy.deepcopy(houses[1])
    house["storeys"][1]["slab_holes"] = []
    assert any("aligned stair opening" in e for e in validate_house(house)["errors"])


def test_economics_change_allowance_without_changing_house_palette():
    low = house_style("stable-id", 120, 200)
    high = house_style("stable-id", 120, 1200)
    assert low["id"] == high["id"] and low["walls"] == high["walls"]
    assert low["furnishing_budget_usd"] < high["furnishing_budget_usd"]
    assert len(set(low["walls"])) == 4
    assert house_style("stable-id", 120, None)["neighborhood_price_per_sqft"] is None
    catalog = Catalog()
    assert catalog.choose("sofa", low, (2.2, 0.85, 0.85), "same") != catalog.choose(
        "sofa", high, (2.2, 0.85, 0.85), "same"
    )


def test_invalid_geometry_heights_and_units_fail_explicitly():
    with pytest.raises(ValueError, match="valid finite"):
        polygon([[0, 0], [4, 4], [0, 4], [4, 0]])
    with pytest.raises(ValueError, match="sum"):
        HouseInput("height", box(0, 0, 10, 10), (StoreyInput(3),), total_height_m=4)
    with pytest.raises(ValueError, match="finite"):
        HouseInput("nan", box(0, 0, 10, 10), (StoreyInput(math.nan),))
    with pytest.raises(ValueError, match="local metres"):
        HouseInput.from_json({"id": "feet", "units": "feet"})
    with pytest.raises(ValueError, match="feasible"):
        infer_house(HouseInput("thin", box(0, 0, 2, 30), (StoreyInput(2.8),)))


def test_all_local_library_files_have_verified_hashes_and_sources():
    directory = ROOT / "docs/interior-assets"
    manifest = json.loads((directory / "manifest.json").read_text())
    assert len(manifest["assets"]) >= 78
    assert not manifest["expansion"]["failures"]
    for asset in manifest["assets"]:
        assert asset["source"].startswith("https://")
        assert min(asset["dimensions_m"]) > 0
        for file in asset["files"]:
            payload = (directory / file["path"]).read_bytes()
            assert hashlib.sha256(payload).hexdigest() == file["sha256"]
    assert len({a["source"].split("/")[2] for a in manifest["assets"]}) >= 3


@pytest.mark.skipif(shutil.which("node") is None, reason="node validates the map adapter")
def test_map_adapter_transforms_stair_heights_and_collisions_by_level(houses):
    house = houses[1]
    test_points = []
    for floor in house["storeys"]:
        p = shape(
            next(r["polygon"] for r in floor["rooms"] if r["kind"] == "hallway")
        ).representative_point()
        test_points.append([p.x, p.y, floor["elevation_m"]])
    script = """
      import {mountGeneratedInterior} from './docs/inferred-interiors/kerbside-adapter.mjs';
      let input='';for await(const chunk of process.stdin)input+=chunk;
      const {house,points}=JSON.parse(input);let feet=10;
      const pointInRing=(x,y,ring)=>{
        let inside=false;
        for(let i=0,j=ring.length-1;i<ring.length;j=i++){
          const a=ring[i],b=ring[j];
          if((a[1]>y)!=(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
        }
        return inside;
      };
      const group={position:{set(){}},scale:{z:1}};
      const build=()=>({group,doors:[],segments:house.storeys.map(f=>(
        {level:f.level,line:[0,0,1,0]}
      ))});
      const result=mountGeneratedInterior({},house,{}, {
        origin:[100,200],floorY:10,feetY:()=>feet,pointInRing
      },build);
      for(const [level,[x,y,e]] of points.entries()){
        feet=10+e;
        if(Math.abs(result.floorSurface(100+x,-200-y)-(10+e))>.001)throw Error('wrong floor');
        if(result.rooms.some(r=>r.level!==level))throw Error('wrong room level');
      }
      for(const stair of house.stairs)for(const step of stair.steps){
        const r=step.footprint.coordinates[0].slice(0,-1);
        const x=r.reduce((s,p)=>s+p[0],0)/r.length,y=r.reduce((s,p)=>s+p[1],0)/r.length;
        feet=10+step.top_m-.1;
        if(Math.abs(result.floorSurface(100+x,-200-y)-(10+step.top_m))>.001){
          throw Error('wrong stair');
        }
      }
      console.log('ok');
    """
    result = subprocess.run(
        [shutil.which("node"), "--input-type=module", "-e", script],
        input=json.dumps({"house": house, "points": test_points}),
        text=True,
        capture_output=True,
        cwd=ROOT,
        check=False,
    )
    assert result.returncode == 0, result.stderr
