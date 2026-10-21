"""Canonical facade positions and physical walking tested independently of the UI."""

import json
import subprocess
from pathlib import Path

import pytest
from shapely.geometry import LineString, shape

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "docs/inferred-interiors"


def test_envelopes_use_the_published_shell_height_and_openings():
    inputs = json.loads((LAB / "inputs.json").read_text())
    actual = json.loads(
        subprocess.check_output(
            ["node", "scripts/export_interior_envelopes.mjs", str(LAB / "inputs.json")],
            cwd=ROOT,
            text=True,
        )
    )
    saved = json.loads((LAB / "envelopes.json").read_text())
    assert actual == saved, "facade source changed; regenerate snapshots before serving"
    assert len(saved["canonical_rules_sha256"]) == 64
    for row in inputs:
        if not row.get("osm_id"):
            continue
        h = json.loads((LAB / f"{row['id']}.json").read_text())
        e = h["envelope"]
        assert e == saved["buildings"][row["id"]]
        assert h["total_height_m"] == pytest.approx(e["shell_top_y_m"] - e["floor_y_m"])
        assert e["windows"]
        for w in e["windows"]:
            a, b = w["a"], w["b"]
            line = LineString([a, b])
            assert shape(h["storeys"][0]["footprint"]).boundary.distance(line) < 0.001
            ux, uy = (b[0] - a[0]) / line.length, (b[1] - a[1]) / line.length
            pane = LineString(
                [
                    (a[0] + ux * w["u"], a[1] + uy * w["u"]),
                    (a[0] + ux * (w["u"] + w["w"]), a[1] + uy * (w["u"] + w["w"])),
                ]
            )
            for f in h["storeys"]:
                for o in f["objects"]:
                    base = o["position_m"][1]
                    if base + o["size_m"][1] > w["v"] + 0.02 and base < w["v"] + w["h"]:
                        assert not shape(o["footprint"]).intersects(pane.buffer(0.23, cap_style=2))


def test_real_photo_balconies_keep_their_canonical_platforms(tmp_path):
    page = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    rows = []
    for key in ("263276308", "263276306"):
        way = next(w for w in page["ways"] if str(w.get("osm_id")) == key)
        rows.append({"id": "osm-" + key, "osm_id": key, "origin_lon_lat": way["centroid"]})
    path = tmp_path / "balconies.json"
    path.write_text(json.dumps(rows))
    result = json.loads(
        subprocess.check_output(
            ["node", "scripts/export_interior_envelopes.mjs", str(path)], cwd=ROOT, text=True
        )
    )
    assert [len(result["buildings"][r["id"]]["balconies"]) for r in rows] == [7, 4]
    for r in rows:
        e = result["buildings"][r["id"]]
        assert any(w["grade"] == "image_on_prior_geometry" for w in e["windows"])
        for b in e["balconies"]:
            assert b["depth_m"] == 0.9
            assert b["grade"] == "image_proposal_not_measured"
            assert b["elevation_m"] >= 0


def test_tour_can_stand_in_every_occupied_room_and_cannot_cross_walls():
    script = """
import fs from 'node:fs';
import {TourWorld,inPolygon} from './docs/inferred-interiors/tour-world.mjs';
const manifest=JSON.parse(fs.readFileSync('./docs/inferred-interiors/manifest.json'));
let rooms=0;for(const record of manifest.houses){if(!record.passed)throw Error('failed house');
const h=JSON.parse(fs.readFileSync('./docs/inferred-interiors/'+record.file)),w=new TourWorld(h);
for(const f of h.storeys)for(const r of f.rooms){if(['closet','stair'].includes(r.kind))continue;
const p=w.spawn(f.level,r.id);
if(!w.clear(p.x,p.z,p.y)||!inPolygon(p.x,p.z,r.polygon))throw Error('unsafe spawn '+r.id);rooms++;
const moved=w.move(p,100,0);if(!inPolygon(moved.x,moved.z,f.inside))throw Error('escaped shell');
}
}console.log(JSON.stringify({rooms}));
"""
    result = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", script], cwd=ROOT, text=True, timeout=120
        )
    )
    assert result["rooms"] > 150


def test_walking_can_ascend_and_descend_every_serialized_stair():
    script = """
import fs from 'node:fs';
import {TourWorld} from './docs/inferred-interiors/tour-world.mjs';
const manifest=JSON.parse(fs.readFileSync('./docs/inferred-interiors/manifest.json'));
let flights=0;
const centre=s=>{const p=s.footprint.coordinates[0].slice(0,-1);return {
 x:p.reduce((sum,p)=>sum+p[0],0)/p.length,
 z:p.reduce((sum,p)=>sum+p[1],0)/p.length,y:s.top_m};};
for(const record of manifest.houses){
 const h=JSON.parse(fs.readFileSync('./docs/inferred-interiors/'+record.file));
 const w=new TourWorld(h);
 for(const stair of h.stairs){
  let p=centre(stair.steps[0]);
  for(const step of [...stair.steps.slice(1),...stair.steps.slice().reverse().slice(1)]){
   const q=centre(step);p=w.move(p,q.x-p.x,q.z-p.z);
   if(Math.hypot(p.x-q.x,p.z-q.z)>.05||Math.abs(p.y-q.y)>.02)
    throw Error('blocked stair flight '+h.id+' '+stair.id);
  }flights++;
 }
}console.log(JSON.stringify({flights}));
"""
    result = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", script], cwd=ROOT, text=True, timeout=120
        )
    )
    assert result["flights"] >= 15
