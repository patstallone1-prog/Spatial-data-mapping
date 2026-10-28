"""Independent household, source-alignment, split-level and complete-tour acceptance."""

from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path

import pytest
from shapely.geometry import box, shape

from smc.interiors.inference import HouseInput, StoreyInput, infer_house
from smc.interiors.inference.garages import garage_plans
from smc.interiors.inference.residential_validate import validate_residential

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "docs/inferred-residential"


@pytest.fixture(scope="module")
def generated():
    m = json.loads((LAB / "manifest.json").read_text())
    return m, {
        r["id"]: json.loads((LAB / r["file"]).read_text()) for r in m["houses"] if r["passed"]
    }


def test_fixed_programs_cover_all_family_and_car_counts_without_dropping_failures(generated):
    manifest, houses = generated
    assert manifest["total"] == 20 and len(manifest["houses"]) == 20
    inputs = json.loads((LAB / "inputs.json").read_text())
    assert len({r["id"] for r in inputs}) == 20
    synthetic = [r for r in manifest["houses"] if not r["id"].startswith("residential-osm-")]
    assert len(synthetic) == 12 and all(r["passed"] for r in synthetic)
    assert {h.get("households", 1) for h in houses.values()} >= {1, 2, 3, 4, 5}
    assert {g["capacity"] for h in houses.values() for g in h.get("garages", [])} >= {1, 2, 3, 4}
    for r in manifest["houses"]:
        if not r["passed"]:
            assert r.get("reason")


def test_each_family_has_private_furnished_services_storage_and_separate_entrance(generated):
    for h in generated[1].values():
        if not h.get("residential_units"):
            continue
        assert validate_residential(h)["passed"], h["id"]
        rooms = {r["id"]: r for f in h["storeys"] for r in f["rooms"]}
        for u in h["residential_units"]:
            own = {k: r for k, r in rooms.items() if r.get("unit_id") == u["id"]}
            kinds = {r["kind"] for r in own.values()}
            assert {"kitchen", "living", "dining", "full_bathroom"} <= kinds
            assert kinds & {"bedroom", "primary_bedroom"}
            contents = [o for f in h["storeys"] for o in f["objects"] if o["room_id"] in own]
            roles = {o["role"] for o in contents}
            assert {
                "sink_counter",
                "cooker",
                "refrigerator",
                "toilet",
                "bath_sink",
                "bath_shower",
                "bed",
            } <= roles
            assert roles & {"dresser", "closet_rail", "wardrobe", "storage_cabinet"}
            assert u["entrance_ids"]
        if h["households"] > 1:
            assert any(r["kind"] == "communal_lobby" for r in rooms.values())
            assert any(
                o["role"] == "washing_machine" and rooms[o["room_id"]].get("unit_id") is None
                for f in h["storeys"]
                for o in f["objects"]
            )


def test_private_service_or_ownership_corruption_cannot_pass(generated):
    source = generated[1]["residential-four-family"]
    h = copy.deepcopy(source)
    unit = h["residential_units"][0]["id"]
    room = next(
        r
        for f in h["storeys"]
        for r in f["rooms"]
        if r.get("unit_id") == unit and r["kind"] == "full_bathroom"
    )
    room["unit_id"] = h["residential_units"][1]["id"]
    assert any("unit lacks" in e for e in validate_residential(h)["errors"])
    h = copy.deepcopy(source)
    door = next(o for f in h["storeys"] for o in f["openings"] if o.get("unit_entrance"))
    door["leaf_count"] = 0
    assert "apartment entrance lacks a private door" in validate_residential(h)["errors"]
    h = copy.deepcopy(source)
    doors = [o for o in h["storeys"][0]["openings"] if o.get("unit_entrance")]
    doors[0]["rooms"] = [doors[0]["rooms"][0], doors[1]["rooms"][0]]
    assert "door connects separate families directly" in validate_residential(h)["errors"]


def test_car_bays_and_columns_fit_without_moving_recorded_doors(generated):
    for h in generated[1].values():
        for g in h.get("garages", []):
            f = h["storeys"][g["level"]]
            doors = [
                o for o in f["openings"] if o.get("garage_entrance") and g["room_id"] in o["rooms"]
            ]
            assert len(doors) == 1
            assert doors[0]["width_m"] == pytest.approx(shape(g["source_segment"]).length)
            assert doors[0]["height_m"] == pytest.approx(g["source_opening"].get("h", 2.4))
            assert doors[0]["threshold_m"] == pytest.approx(g["source_opening"].get("v", 0))
            for bay in g["parking_bays"]:
                car = next(o for o in f["objects"] if o["id"] == bay["car_id"])
                assert shape(bay["footprint"]).covers(shape(car["footprint"]))
                assert car["role"] == "parked_car"
            if g["capacity"] >= 2:
                assert g["structure"]["support_ids"]
    h = copy.deepcopy(generated[1]["residential-four-car-floor"])
    beam = next(o for o in h["storeys"][0]["objects"] if o["role"] == "structural_beam")
    beam["position_m"][1] += 0.2
    assert "garage beam floats above/beside its supports" in validate_residential(h)["errors"]
    h = copy.deepcopy(generated[1]["residential-one-car-attached"])
    door = next(o for o in h["storeys"][0]["openings"] if o.get("garage_entrance"))
    door["height_m"] -= 0.3
    assert (
        "garage door height/threshold disagrees with its source"
        in validate_residential(h)["errors"]
    )


@pytest.fixture(scope="module")
def lower_garage():
    spec = HouseInput(
        "unseen-lower-garage",
        box(0, 0, 14, 15),
        (StoreyInput(3), StoreyInput(2.8)),
        entrance=(0.8, 0),
        garages=(
            {
                "a": [0, 0],
                "b": [14, 0],
                "u": 5.7,
                "w": 2.6,
                "h": 2.4,
                "v": -0.58,
                "measured": True,
                "source_id": "caller-measurement",
            },
        ),
        garage_cars=1,
    )
    return infer_house(spec)


def test_lower_garage_uses_real_slab_height_steps_and_preserves_source_evidence(lower_garage):
    h = lower_garage
    assert validate_residential(h)["passed"]
    g = h["garages"][0]
    assert g["source_opening"]["measured"] is True
    room = next(r for r in h["storeys"][0]["rooms"] if r["id"] == g["room_id"])
    assert room["elevation_m"] == -0.58
    changes = h["storeys"][0]["level_changes"]
    assert len(changes) == 1 and changes[0]["riser_count"] == 4
    broken = copy.deepcopy(h)
    broken["storeys"][0]["level_changes"] = []
    assert (
        "lower garage slab is missing pedestrian threshold steps"
        in validate_residential(broken)["errors"]
    )


def test_multiple_gates_allocate_requested_tandem_capacity_and_missing_evidence_fails():
    with pytest.raises(ValueError, match="recorded garage openings"):
        HouseInput("missing", box(0, 0, 12, 12), (StoreyInput(3),), garage_cars=2)
    s = HouseInput(
        "two-gates",
        box(0, 0, 20, 17),
        (StoreyInput(3.1), StoreyInput(2.9)),
        entrance=(9, 0),
        garage_mode="floor",
        garage_cars=4,
        garages=(
            {"a": [0, 0], "b": [20, 0], "u": 2.7, "w": 2.6, "h": 2.4},
            {"a": [0, 0], "b": [20, 0], "u": 12.7, "w": 2.6, "h": 2.4},
        ),
    )
    assert [p["capacity"] for p in garage_plans(s)] == [2, 2]
    h = infer_house(s)
    assert h["validation"]["passed"] and h["validation"]["metrics"]["garage_cars"] == 4


@pytest.fixture(scope="module")
def stacked_duplexes():
    return infer_house(
        HouseInput(
            "unseen-stacked-duplexes",
            box(0, 0, 16, 16),
            tuple(StoreyInput(3) for _ in range(4)),
            households=2,
            entrance=(0.8, 0),
        )
    )


def test_homes_can_span_floors_without_using_the_other_familys_rooms(stacked_duplexes):
    h = stacked_duplexes
    assert h["validation"]["passed"]
    assert [u["levels"] for u in h["residential_units"]] == [[0, 1], [2, 3]]
    assert h["validation"]["metrics"]["private_kitchens"] == 2
    assert h["validation"]["metrics"]["private_full_bathrooms"] == 2
    assert sum(s.get("communal") is False for s in h["stairs"]) == 2


def test_real_tour_can_stand_in_each_room_walk_stairs_and_reach_lower_garage(
    lower_garage, stacked_duplexes, tmp_path
):
    lower = tmp_path / "lower.json"
    lower.write_text(json.dumps([lower_garage, stacked_duplexes]))
    script = r"""
import fs from 'node:fs';
import {TourWorld,inPolygon} from './docs/inferred-interiors/tour-world.mjs';
const m=JSON.parse(fs.readFileSync('docs/inferred-residential/manifest.json'));
const houses=m.houses.filter(r=>r.passed).map(r=>
 JSON.parse(fs.readFileSync('docs/inferred-residential/'+r.file)));
houses.push(...JSON.parse(fs.readFileSync(process.argv[1])));
let rooms=0,flights=0,changes=0;
const centre=s=>{const p=s.footprint.coordinates[0].slice(0,-1);return {
 x:p.reduce((a,p)=>a+p[0],0)/p.length,
 z:p.reduce((a,p)=>a+p[1],0)/p.length,y:s.top_m};};
for(const h of houses){const world=new TourWorld(h);
 for(const f of h.storeys)for(const r of f.rooms){if(['stair','closet'].includes(r.kind))continue;
  const p=world.spawn(f.level,r.id);if(!world.clear(p.x,p.z,p.y)||!inPolygon(p.x,p.z,r.polygon))
   throw Error('unsafe spawn '+r.id);rooms++;}
 const stairs=[...h.stairs,...h.storeys.flatMap(f=>f.level_changes||[])];
 for(const stair of stairs){
  let p=centre(stair.steps[0]);
  for(const s of [...stair.steps.slice(1),...stair.steps.slice().reverse().slice(1)]){
   const q=centre(s);p=world.move(p,q.x-p.x,q.z-p.z);
   if(Math.hypot(p.x-q.x,p.z-q.z)>.06||Math.abs(p.y-q.y)>.025)
    throw Error('blocked flight '+h.id+' '+stair.id);
  }flights++;if(stair.to_elevation_m<0)changes++;
 }
}console.log(JSON.stringify({rooms,flights,changes}));
"""
    result = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", script, str(lower)],
            cwd=ROOT,
            text=True,
            timeout=180,
        )
    )
    assert result["rooms"] > 200 and result["flights"] >= 10 and result["changes"] >= 1


def test_program_endpoint_keeps_source_geometry_and_heights():
    import runpy

    api = runpy.run_path(str(ROOT / "scripts/serve_interior_lab.py"))
    h = api["residential_request"](
        {
            "id": "residential-duplex-one-floor",
            "households": 2,
            "footprint": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
            },
            "storeys": [{"height_m": 6}],
            "entrance": [50, 0],
        }
    )
    assert shape(h["storeys"][0]["footprint"]).area == pytest.approx(210)
    assert h["storeys"][0]["height_m"] == 3.1
    assert h["validation"]["passed"] and h["households"] == 2
    with pytest.raises(ValueError, match="known residential"):
        api["residential_request"]({"id": "unregistered"})


def test_map_adapter_uses_the_same_lower_garage_surface(lower_garage, tmp_path):
    path = tmp_path / "source.json"
    path.write_text(json.dumps(lower_garage))
    script = r"""
import fs from 'node:fs';
import {TourWorld,inRing} from './docs/inferred-interiors/tour-world.mjs';
import {mountGeneratedInterior} from './docs/inferred-interiors/kerbside-adapter.mjs';
const h=JSON.parse(fs.readFileSync(process.argv[1])),world=new TourWorld(h);
const g=h.garages[0],p=world.spawn(0,g.room_id);
const built=()=>({group:{position:{set(){}},scale:{}},doors:[],segments:[]});
const context={origin:[100,200],floorY:30,feetY:()=>30+p.y,pointInRing:inRing};
const adapter=mountGeneratedInterior({},h,{},context,built);
console.log(JSON.stringify({height:adapter.floorSurface(100+p.x,-200-p.z),expected:30+p.y}));
"""
    result = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", script, str(path)], cwd=ROOT, text=True
        )
    )
    assert result["height"] == pytest.approx(result["expected"])


def test_canonical_garage_export_retains_map_positions_and_evidence():
    output = json.loads(
        subprocess.check_output(
            [
                "node",
                "scripts/export_interior_envelopes.mjs",
                str(ROOT / "docs/inferred-interiors/inputs.json"),
                "--with-garages",
            ],
            cwd=ROOT,
            text=True,
        )
    )
    garages = [(e, g) for e in output["buildings"].values() for g in e["garages"]]
    assert len(garages) >= 3
    for e, g in garages:
        from shapely.geometry import LineString

        assert shape(e["footprint"]).boundary.distance(LineString([g["a"], g["b"]])) < 0.001
        assert g["source_id"] and g["basis"] in {
            "kerb_cut_projection",
            "photographed_on_prior_geometry",
        }
        assert g["measured"] is False
