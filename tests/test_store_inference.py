"""Retail privacy/service geometry, source openings, queues and actual walking surfaces."""

from __future__ import annotations

import copy
import json
import runpy
import subprocess
from pathlib import Path

import pytest
from shapely import affinity
from shapely.geometry import LineString, box, mapping, shape

from smc.interiors.stores import StoreInput, infer_store, validate_store

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "docs/inferred-stores"


@pytest.fixture(scope="module")
def cohort():
    m = json.loads((LAB / "manifest.json").read_text())
    return m, {
        r["id"]: json.loads((LAB / r["file"]).read_text()) for r in m["houses"] if r["passed"]
    }


def test_fixed_cohort_keeps_failures_and_tests_all_programs(cohort):
    m, stores = cohort
    assert m["total"] == 19 and len(m["houses"]) == 19
    synthetic = [r for r in m["houses"] if not r["id"].startswith("retail-osm-")]
    assert len(synthetic) == 9 and all(r["passed"] for r in synthetic)
    assert len([r for r in m["houses"] if r["id"].startswith("retail-osm-")]) == 10
    for row in m["houses"]:
        if not row["passed"]:
            assert row["reason"]
    for h in stores.values():
        assert validate_store(h)["passed"], h["id"]


def test_groceries_have_distinct_stocked_departments_and_chain_checkouts(cohort):
    for h in cohort[1].values():
        items = [o for f in h["storeys"] for o in f["objects"]]
        assert {"toilet", "bath_sink", "dry_storage"} <= {o["role"] for o in items}
        section_ids = {s["id"] for s in h["sections"]}
        assert "checkout" in section_ids
        if h["kind"] == "grocery":
            assert {"produce", "bakery", "frozen", "dairy", "meat_and_deli"} <= section_ids
        for o in items:
            if o["role"] in {"gondola_shelf", "refrigerated_case", "drink_cooler", "freezer_case"}:
                assert o["stock"] and all(
                    r["bottom_m"] + r["height_m"] <= o["size_m"][1] for r in o["stock"]
                )
    assert cohort[1]["retail-two-entrances"]["validation"]["metrics"]["self_checkouts"] == 0
    assert cohort[1]["retail-supermarket"]["validation"]["metrics"]["self_checkouts"] > 0


def test_unseen_shapes_and_multiple_source_openings_are_not_widened():
    p = affinity.rotate(box(0, 0, 22, 29), -17, origin=(0, 0))
    source = [
        affinity.rotate(LineString([(3, 0), (5.4, 0)]), -17, origin=(0, 0)),
        affinity.rotate(LineString([(22, 8), (22, 10.4)]), -17, origin=(0, 0)),
    ]
    h = infer_store(
        StoreInput(
            "unseen-two-entries",
            p,
            entrances=tuple(
                {"segment": mapping(s), "measured": True, "source_id": "caller"} for s in source
            ),
            chain="whole_foods",
        )
    )
    doors = [o for f in h["storeys"] for o in f["openings"] if o.get("entrance")]
    assert len(doors) == 2
    for o, src in zip(doors, source, strict=True):
        assert shape(o["segment"]).length == pytest.approx(src.length)
        assert shape(o["segment"]).centroid.distance(src.centroid) == pytest.approx(0.15)
        assert o["source_opening"]["measured"] is True and o["measured"] is False


def test_missing_departments_blocked_doors_and_floating_stock_are_rejected(cohort):
    original = cohort[1]["retail-supermarket"]
    h = copy.deepcopy(original)
    f = h["storeys"][-1]
    f["objects"] = [o for o in f["objects"] if o["role"] != "freezer_case"]
    assert any("departments" in e for e in validate_store(h)["errors"])
    h = copy.deepcopy(original)
    f = h["storeys"][-1]
    item = next(o for o in f["objects"] if o.get("stock"))
    item["stock"][0]["bottom_m"] = item["size_m"][1]
    assert any("stock floats" in e for e in validate_store(h)["errors"])
    h = copy.deepcopy(original)
    f = h["storeys"][-1]
    item = f["objects"][0]
    door = next(o for o in f["openings"] if o.get("entrance"))
    item["footprint"] = door["clearance"]
    assert any("blocked store entry" in e for e in validate_store(h)["errors"])


def test_parking_source_ramp_grade_and_lift_are_validated(cohort):
    h = copy.deepcopy(cohort[1]["retail-two-parking-levels"])
    assert len(h["ramps"]) == 2 and len(h["stairs"]) == 2
    assert h["elevators"][0]["levels"] == [0, 1, 2]
    h["ramps"][0]["slope"] = 0.2
    assert "invalid vehicle ramp slope" in validate_store(h)["errors"]
    h = copy.deepcopy(cohort[1]["retail-two-parking-levels"])
    h["elevators"] = []
    assert "no cart/passenger lift from parking" in validate_store(h)["errors"]


def test_unknown_garage_levels_are_not_invented():
    h = infer_store(
        StoreInput(
            "unknown-parking",
            box(0, 0, 21, 28),
            parking={"kind": "garage", "levels": None, "evidence": [{"source": "operator"}]},
        )
    )
    assert len(h["storeys"]) == 1 and not h["ramps"] and not h["stairs"]
    assert h["parking"]["levels"] is None and "unresolved" in h["parking"]["render_status"]


def test_bad_inputs_reject_instead_of_repairing_source():
    with pytest.raises(ValueError, match="levels"):
        StoreInput("bad", box(0, 0, 30, 30), parking={"kind": "garage", "levels": 1.5})
    with pytest.raises(ValueError, match="outline"):
        StoreInput("bad", box(0, 0, 30, 30), entrances=({"point": [5, 5]},))
    with pytest.raises(ValueError, match="own source footprint"):
        StoreInput("bad", box(0, 0, 30, 30), parking={"kind": "garage", "levels": 2})


def test_local_rebuild_cannot_replace_shell_or_parking(cohort):
    api = runpy.run_path(str(ROOT / "scripts/serve_interior_lab.py"))
    result = api["store_request"](
        {
            "id": "retail-corner-snacks",
            "chain": "safeway",
            "footprint": mapping(box(0, 0, 100, 100)),
            "parking": {"kind": "garage", "levels": 4},
        }
    )
    assert shape(result["storeys"][0]["footprint"]).area == 126
    assert len(result["storeys"]) == 1 and result["style"]["chain"] == "safeway"
    with pytest.raises(ValueError, match="known retail"):
        api["store_request"]({"id": "unregistered"})


def test_real_javascript_walks_rooms_ramps_stairs_lift_and_surface_entry():
    script = r"""
import fs from 'node:fs';
import {TourWorld,inPolygon} from './docs/inferred-interiors/tour-world.mjs';
const m=JSON.parse(fs.readFileSync('docs/inferred-stores/manifest.json'));
let rooms=0,ramps=0,stairs=0,lifts=0,outdoor=0;
const centre=g=>{const p=g.coordinates[0].slice(0,-1);
return {x:p.reduce((s,q)=>s+q[0],0)/p.length,z:p.reduce((s,q)=>s+q[1],0)/p.length};
};

for(const r of m.houses.filter(r=>r.passed)){
 const h=JSON.parse(fs.readFileSync('docs/inferred-stores/'+r.file)),world=new TourWorld(h);
 for(const f of h.storeys)for(const r of f.rooms){const p=world.spawn(f.level,r.id);
if(!world.clear(p.x,p.z,p.y)||
!inPolygon(p.x,p.z,r.polygon))throw Error('spawn '+r.id);
rooms++;
}
 for(const ramp of h.ramps){let p={x:ramp.start_m[0],z:ramp.start_m[1],y:ramp.bottom_m};
  for(const t of [...Array.from({length:120},
(_,
i)=>(i+1)/120),
...Array.from({length:120},
(_,
i)=>1-(i+1)/120)]){
   const x=ramp.start_m[0]+(ramp.end_m[0]-ramp.start_m[0])*t,
z=ramp.start_m[1]+(ramp.end_m[1]-ramp.start_m[1])*t;

   p=world.move(p,x-p.x,z-p.z);const y=ramp.bottom_m+t*(ramp.top_m-ramp.bottom_m);
   if(Math.hypot(p.x-x,p.z-z)>.05||
Math.abs(p.y-y)>.03)throw Error('ramp '+h.id+' '+t+' '+JSON.stringify(p));

  }ramps++;
 }
 for(const stair of h.stairs){let p={...centre(stair.steps[0].footprint),
y:stair.steps[0].top_m};

  for(const s of [...stair.steps.slice(1),...stair.steps.slice().reverse().slice(1)]){
   const q=centre(s.footprint);p=world.move(p,q.x-p.x,q.z-p.z);
   if(Math.hypot(p.x-q.x,p.z-q.z)>.06||Math.abs(p.y-s.top_m)>.03)throw Error('stair '+h.id);
  }stairs++;
 }
 for(const lift of h.elevators||
[]){const a=lift.door_segment.coordinates,
c={x:(a[0][0]+a[1][0])/2,
z:(a[0][1]+a[1][1])/2,
y:h.storeys[0].elevation_m};

  const p=world.liftStop(c,h.storeys.length-1);
if(p.y!==0||
!world.clear(p.x,p.z,p.y))throw Error('lift');
lifts++;

 }
 const f=h.storeys.at(-1);
 if(f.outdoor_areas){const door=f.openings.find(o=>o.entrance),
c=centre({coordinates:[[...door.segment.coordinates,
door.segment.coordinates[0]]]});

  let p={x:c.x,z:-4,y:0};for(let i=0;i<70;i++)p=world.move(p,0,.1);
  if(p.z<2.8)throw Error('outdoor entry blocked '+JSON.stringify(p));outdoor++;
 }
}
console.log(JSON.stringify({rooms,ramps,stairs,lifts,outdoor}));
"""
    result = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", script], cwd=ROOT, text=True, timeout=180
        )
    )
    assert (
        result["rooms"] >= 50
        and result["ramps"] >= 5
        and result["stairs"] >= 5
        and result["lifts"] == 2
        and result["outdoor"] == 1
    )


def test_inventory_identity_does_not_share_garage_between_tenants():
    inventory = json.loads((ROOT / "data/grocery-stores/inventory.json").read_text())
    rows = inventory["stores"]
    assert len(rows) > 1000 and len(inventory["counties"]) == 9
    assert {r["county"] for r in rows} == {c + " County" for c in inventory["counties"]}
    known = [r for r in rows if r["parking"]["evidence"]]
    assert known and all(r["name"] not in {"Donna\u2019s Tamales", "Genji Sushi"} for r in known)
    for r in known:
        assert r["parking"]["levels"] is None
        assert all(e["source_url"] and e["measured"] is False for e in r["parking"]["evidence"])


def test_http_rebuild_dispatches_retail_without_restaurant_input():
    import threading
    import urllib.request
    from http.server import ThreadingHTTPServer

    api = runpy.run_path(str(ROOT / "scripts/serve_interior_lab.py"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), api["Handler"])
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    override = LAB / "overrides/retail-corner-snacks.json"
    previous = override.read_bytes() if override.exists() else None
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/api/infer-store",
            data=json.dumps({"id": "retail-corner-snacks", "chain": "whole_foods"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            assert response.status == 200
            h = json.load(response)
        assert h["schema"] == "kerbside.inferred_store/1" and h["validation"]["passed"]
        assert shape(h["storeys"][0]["footprint"]).area == 126
    finally:
        server.shutdown()
        server.server_close()
        if previous is None:
            override.unlink(missing_ok=True)
        else:
            override.write_bytes(previous)


def test_publishing_preserves_existing_houses_and_omits_failures(cohort, tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    path = site / "map-overlay.json"
    path.write_text(json.dumps({"buildings": {"existing": {"file": "retained.json"}}}))
    builder = runpy.run_path(str(ROOT / "scripts/build_inferred_stores.py"))
    count = builder["publish"](LAB, site)
    overlay = json.loads(path.read_text())["buildings"]
    assert count == 8 and overlay["existing"]["file"] == "retained.json"
    assert "256067716" not in overlay and "265674114" not in overlay


def test_recorded_vehicle_entry_controls_ramp_side_and_keeps_source_height(tmp_path):
    p = box(0, 0, 40, 42)
    source = {
        "segment": mapping(LineString([(32, 0), (38, 0)])),
        "height_m": 2.6,
        "source_id": "unseen-supplied-gate",
        "measured": True,
    }
    h = infer_store(
        StoreInput(
            "unseen-vehicle-gate",
            p,
            entrances=({"point": [12, 0]},),
            parking={
                "kind": "garage",
                "levels": 2,
                "footprint": mapping(p),
                "vehicle_entrance": source,
            },
        )
    )
    door = next(o for o in h["storeys"][-1]["openings"] if o.get("garage_entrance"))
    assert door["height_m"] == 2.6 and door["width_m"] == 6
    assert shape(door["segment"]).centroid.y == pytest.approx(0.15)
    assert door["source_opening"]["measured"] is True and door["measured"] is False
    path = tmp_path / "source-gate.json"
    path.write_text(json.dumps(h))
    script = r"""
import fs from 'node:fs';
import {TourWorld} from './docs/inferred-interiors/tour-world.mjs';
const h=JSON.parse(fs.readFileSync(process.argv[1])),w=new TourWorld(h);
for(const r of h.ramps){
 let p={x:r.start_m[0],z:r.start_m[1],y:r.bottom_m};
 for(let i=1;i<=120;i++){
  const t=i/120,x=r.start_m[0]+(r.end_m[0]-r.start_m[0])*t;
  const z=r.start_m[1]+(r.end_m[1]-r.start_m[1])*t;
  p=w.move(p,x-p.x,z-p.z);
  if(Math.hypot(p.x-x,p.z-z)>.03)throw Error('source-aligned ramp blocked');
 }
}
"""
    subprocess.check_call(["node", "--input-type=module", "-e", script, str(path)], cwd=ROOT)


def test_detached_staff_room_and_vehicle_landing_overlap_are_rejected(cohort):
    original = cohort[1]["retail-supermarket"]
    h = copy.deepcopy(original)
    toilet = next(r for r in h["storeys"][0]["rooms"] if r["kind"] == "toilet")
    h["storeys"][0]["openings"] = [
        o for o in h["storeys"][0]["openings"] if toilet["id"] not in o["rooms"]
    ]
    assert "room lacks a route to a pedestrian entrance" in validate_store(h)["errors"]
    h = cohort[1]["retail-two-parking-levels"]
    top = h["storeys"][-1]
    vehicle = next(r for r in top["rooms"] if r["kind"] == "vehicle_ramp_landing")
    for room in top["rooms"]:
        if room["kind"] in {"stockroom", "sales_floor"}:
            assert shape(room["polygon"]).intersection(shape(vehicle["polygon"])).area < 0.001
    assert any(vehicle["id"] in wall["rooms"] for wall in top["walls"])
