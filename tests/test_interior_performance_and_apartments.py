"""Exact geometry reuse and independent multi-floor apartment configuration checks."""

from __future__ import annotations

import copy
import json
import runpy
import subprocess
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from pathlib import Path

import pytest
from shapely import affinity, set_precision
from shapely.geometry import box, shape
from shapely.ops import unary_union

from smc.interiors.inference import HouseInput, StoreyInput, infer_house
from smc.interiors.inference.furnish import oriented_box
from smc.interiors.inference.memo import geometry_cached, inference_session
from smc.interiors.inference.partition import subdivide
from smc.interiors.inference.residential import _allocations
from smc.interiors.inference.residential_validate import validate_residential

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/apartment-configurations.json"


@pytest.fixture(scope="module")
def apartments():
    inputs = json.loads(FIXTURES.read_text())
    return inputs, {r["id"]: infer_house(HouseInput.from_json(r)) for r in inputs}


def test_memo_is_request_local_nested_bounded_and_cleared_on_failure():
    calls = []

    @geometry_cached(limit=2)
    def area(w):
        calls.append(w)
        return box(0, 0, w, 5).area

    @inference_session
    def nested(w):
        return area(w)

    @inference_session
    def solve(w):
        assert area(w) == nested(w)
        return area(w)

    assert solve(3) == 15 and calls == [3]
    assert solve(3) == 15 and calls == [3, 3]

    @inference_session
    def broken():
        area(7)
        raise ValueError("discard request")

    with pytest.raises(ValueError):
        broken()
    assert solve(7) == 35 and calls.count(7) == 2
    before = len(calls)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(solve, [8, 8])) == [40, 40]
    assert len(calls) == before + 2

    @inference_session
    def bounded():
        for i in (1, 2, 3, 1):
            area(i)

    before = len(calls)
    bounded()
    assert calls[before:] == [1, 2, 3, 1]


def test_cached_box_uses_exact_original_geometry_and_partition_lists_are_private():
    @inference_session
    def probe():
        for angle in (0, 27, -90, 33.1234):
            expected = affinity.translate(
                affinity.rotate(box(-0.65, -0.8, 0.65, 0.8), angle, origin=(0, 0)), 3.2, -1.1
            )
            assert oriented_box(3.2, -1.1, 1.3, 1.6, angle).equals_exact(expected, 0)
        p = box(0, 0, 10, 7)
        hall = box(0, -1, 10, 0)
        first, _ = subdivide([p], hall, 2)
        expected = [q.wkb for q in first]
        first.pop()
        second, _ = subdivide([p], hall, 2)
        assert [q.wkb for q in second] == expected

    probe()


def test_cached_and_uncached_house_inference_match_every_serialized_field():
    spec = HouseInput("unseen-memo-equivalence", box(0, 0, 11, 13), (StoreyInput(2.9),), bedrooms=2)
    optimized = infer_house(spec)
    reference = infer_house.__wrapped__(spec)
    assert json.dumps(optimized, sort_keys=True) == json.dumps(reference, sort_keys=True)


def test_all_apartment_programs_keep_source_area_private_services_and_floor_ownership(apartments):
    inputs, houses = apartments
    for spec in inputs:
        h = houses[spec["id"]]
        report = validate_residential(h)
        assert report["passed"], (h["id"], report["errors"])
        assert len(h["residential_units"]) == spec["households"]
        assert report["metrics"]["private_kitchens"] == spec["households"]
        assert report["metrics"]["private_full_bathrooms"] >= spec["households"]
        for f, labels in zip(h["storeys"], spec["units_by_floor"], strict=True):
            actual = {r["unit_id"] for r in f["rooms"] if r.get("unit_id")}
            assert actual == {h["id"] + ":unit:" + label for label in labels}
            expected = shape(f["inside"])
            actual = unary_union([shape(r["polygon"]) for r in f["rooms"]])
            assert actual.symmetric_difference(expected).area < 0.002
            assert all(
                shape(f["footprint"]).buffer(0.002).covers(shape(r["polygon"])) for r in f["rooms"]
            )


def test_single_irregular_apartment_retains_concavities(apartments):
    h = apartments[1]["irregular-single-apartment"]
    own = unary_union(
        [
            set_precision(shape(r["polygon"]), 1e-7)
            for r in h["storeys"][0]["rooms"]
            if r.get("unit_id")
        ]
    )
    assert own.geom_type == "Polygon"
    assert own.area / own.minimum_rotated_rectangle.area < 0.93
    assert not own.covers(box(10.5, 12.5, 14.5, 15.5))


def test_two_homes_per_hall_side_on_each_of_two_floors(apartments):
    h = apartments[1]["eight-double-loaded"]
    assert len(h["residential_units"]) == 8
    for f in h["storeys"]:
        mid = shape(f["footprint"]).centroid.y
        centres = []
        for uid in {r["unit_id"] for r in f["rooms"] if r.get("unit_id")}:
            p = unary_union([shape(r["polygon"]) for r in f["rooms"] if r.get("unit_id") == uid])
            centres.append(p.centroid.y)
        assert sum(y < mid for y in centres) == sum(y > mid for y in centres) == 2
        assert sum(o.get("unit_entrance", False) for o in f["openings"]) == 4
    assert len(h["stairs"]) == 1 and h["stairs"][0]["communal"]


def test_stacked_and_mixed_duplex_programs_keep_distinct_households(apartments):
    stacked = apartments[1]["three-stacked-apartments"]
    assert [u["levels"] for u in stacked["residential_units"]] == [[0], [1], [2]]
    mixed = apartments[1]["mixed-duplex-and-singles"]
    assert {u["id"].split(":")[-1]: u["levels"] for u in mixed["residential_units"]} == {
        "duplex": [0, 1],
        "lower": [0],
        "upper": [1],
    }
    assert sum(s.get("unit_id") == mixed["id"] + ":unit:duplex" for s in mixed["stairs"]) == 1
    asymmetric = apartments[1]["four-below-two-duplexes"]
    assert sorted(len(u["levels"]) for u in asymmetric["residential_units"]) == [1, 1, 2, 2]


def test_allocation_enumerates_only_feasible_compositions_without_changing_rank():
    spec = HouseInput("allocation-order", box(0, 0, 30, 30), (StoreyInput(3),) * 3, households=5)
    expected = []
    for counts in product(range(6), repeat=3):
        if sum(counts) == 5 and all(counts):
            expected.append((max(counts) - min(counts) + sum(n * n for n in counts) * 0.1, counts))
    assert _allocations(spec, False) == [c for _, c in sorted(expected)[:3]]
    large = HouseInput("allocation-large", box(0, 0, 50, 50), (StoreyInput(3),) * 6, households=20)
    assert len(_allocations(large, False)) == 3


def test_invalid_identity_programs_and_wrong_floor_ledgers_are_rejected(apartments):
    base = copy.deepcopy(apartments[0][1])
    base["units_by_floor"] = [["A"], ["B"], ["A"]]
    base["households"] = 2
    with pytest.raises(ValueError, match="contiguous"):
        HouseInput.from_json(base)
    base["units_by_floor"] = ["A", "B", "C"]
    with pytest.raises(ValueError, match="lists"):
        HouseInput.from_json(base)
    base["units_by_floor"] = [["A"], ["A"], ["A"]]
    base["households"] = 1
    base["units_per_floor"] = [1, 1, 0]
    with pytest.raises(ValueError, match="allocate"):
        HouseInput.from_json(base)
    h = copy.deepcopy(apartments[1]["eight-double-loaded"])
    h["residential_units"][0]["levels"] = [1]
    assert "unit floor ownership ledger disagrees" in validate_residential(h)["errors"]
    h = copy.deepcopy(apartments[1]["eight-double-loaded"])
    h["apartment_program"]["units_by_floor"][0][0] = "foreign"
    assert "apartment program disagrees with floor ownership" in validate_residential(h)["errors"]


def test_real_tour_can_visit_all_new_apartments_and_walk_shared_and_private_stairs(
    apartments, tmp_path
):
    path = tmp_path / "programs.json"
    path.write_text(json.dumps(list(apartments[1].values())))
    script = r"""
import fs from 'node:fs';
import {TourWorld,inPolygon} from './docs/inferred-interiors/tour-world.mjs';
const houses=JSON.parse(fs.readFileSync(process.argv[1]));let rooms=0,stairs=0;
const centre=g=>{const p=g.coordinates[0].slice(0,-1);return {
 x:p.reduce((s,q)=>s+q[0],0)/p.length,z:p.reduce((s,q)=>s+q[1],0)/p.length};};
for(const h of houses){const world=new TourWorld(h);
 for(const f of h.storeys)for(const room of f.rooms){
  if(['closet','stair'].includes(room.kind))continue;
  const p=world.spawn(f.level,room.id);
  if(!world.clear(p.x,p.z,p.y)||!inPolygon(p.x,p.z,room.polygon))throw Error(room.id);
  rooms++;
 }
 for(const stair of h.stairs){
  let p={...centre(stair.steps[0].footprint),y:stair.steps[0].top_m};
  for(const s of [...stair.steps.slice(1),...stair.steps.slice().reverse().slice(1)]){
   const q=centre(s.footprint);p=world.move(p,q.x-p.x,q.z-p.z);
   if(Math.hypot(p.x-q.x,p.z-q.z)>.06||Math.abs(p.y-s.top_m)>.03)
    throw Error('blocked stairs '+h.id+' '+stair.id);
  }stairs++;
 }
}console.log(JSON.stringify({rooms,stairs}));
"""
    result = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", script, str(path)],
            cwd=ROOT,
            text=True,
            timeout=120,
        )
    )
    assert result["rooms"] > 150 and result["stairs"] >= 10


def test_rotated_irregular_program_and_source_windows_survive(apartments):
    from shapely.geometry import Point, mapping

    row = copy.deepcopy(apartments[0][4])
    row["id"] = "unseen-rotated-uneven-apartments"
    row["footprint"] = mapping(affinity.rotate(shape(row["footprint"]), 23, origin=(0, 0)))
    row["entrance"] = next(iter(affinity.rotate(Point(row["entrance"]), 23, origin=(0, 0)).coords))
    h = infer_house(HouseInput.from_json(row))
    assert validate_residential(h)["passed"]
    assert shape(h["storeys"][0]["footprint"]).equals_exact(shape(row["footprint"]), 0)
    row = copy.deepcopy(apartments[0][0])
    window = {
        "id": "supplied-window",
        "kind": "window",
        "edge": 0,
        "a": [0, 0],
        "b": [15, 0],
        "u": 9,
        "w": 1.1,
        "v": 0.9,
        "h": 1.2,
    }
    row["envelope"] = {"windows": [window], "balconies": []}
    h = infer_house(HouseInput.from_json(row))
    for key in ("a", "b", "u", "w", "v", "h"):
        assert h["envelope"]["windows"][0][key] == window[key]


def test_rebuild_accepts_floor_program_without_replacing_source_shell(apartments, tmp_path):
    from shapely.geometry import mapping

    api = runpy.run_path(str(ROOT / "scripts/serve_interior_lab.py"))
    request = api["residential_request"]
    # An isolated input tree avoids changing any published lab data or running server.
    folder = tmp_path / "docs/inferred-residential"
    folder.mkdir(parents=True)
    source = copy.deepcopy(apartments[0][4])
    source.pop("units_by_floor")
    source.pop("apartment_layout")
    (folder / "inputs.json").write_text(json.dumps([source]))
    request.__globals__["ROOT"] = tmp_path
    h = request(
        {
            "id": source["id"],
            "households": 3,
            "apartment_layout": "shared_hall",
            "units_by_floor": [["solo"], ["left", "right"]],
            "units_per_floor": [1, 2],
            "footprint": mapping(box(0, 0, 100, 100)),
            "storeys": [{"height_m": 6}],
            "envelope": {"windows": []},
        }
    )
    assert validate_residential(h)["passed"]
    assert h["input_evidence"]["footprint"] == source["footprint"]
    assert h["input_evidence"]["storeys"] == source["storeys"]
    assert h["apartment_program"]["units_per_floor"] == [1, 2]
    with pytest.raises(ValueError, match="known residential"):
        request({"id": "unregistered"})
