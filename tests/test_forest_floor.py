"""The near forest floor, the globe the view zooms out to, and the teleport map's pure parts."""

from __future__ import annotations

import hashlib
import itertools
import json
import shutil
import struct
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def node(code):
    if not shutil.which("node"):
        pytest.skip("Node required for the shared renderer modules")
    preamble = "".join(
        f"import * as {alias} from {json.dumps((ROOT / 'docs' / file).as_uri())};\n"
        for alias, file in [("f", "forest-floor.mjs"), ("g", "globe.mjs"), ("t", "teleport-map.mjs")]
    )
    result = subprocess.run(["node", "--input-type=module", "-e", preamble + code],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


CELL = """
const habitat=f=>({forest:f,scrub:.1,grass:Math.max(0,.9-f),barren:0,wetland:0,developed:0,canopy:f*80});
const ctx=(f,cover)=>({ground:(x,y)=>({height:10+x*.05,p:[x,-y],water:false,cover,natural:null}),
  ecology:()=>({habitat:habitat(f),moisture:.6,lon:-122.47,lat:37.78}),blocked:()=>false,
  trees:[{x:5,y:5,radius:5,height:20,species:'oak',forest:f}]});
"""


def test_each_leaf_lies_on_its_own_and_thickest_under_the_crown():
    r = node(CELL + """
const a=f.floorCell(0,0,12,ctx(.85,42)),b=f.floorCell(0,0,12,ctx(.85,42));
const under=a.leaves.filter(l=>Math.hypot(l.x-5,l.y-5)<4).length/(Math.PI*16);
let area=0;for(let x=.125;x<12;x+=.25)for(let y=.125;y<12;y+=.25)if(Math.hypot(x-5,y-5)>8)area+=.0625;
const open=a.leaves.filter(l=>Math.hypot(l.x-5,l.y-5)>8).length/area;
// No two leaves share a slot: each is its own draw, never a stamped patch.
const keys=new Set(a.leaves.map(l=>`${l.x.toFixed(3)}:${l.y.toFixed(3)}`));
console.log(JSON.stringify({same:JSON.stringify(a)===JSON.stringify(b),under,open,unique:keys.size===a.leaves.length,
  kinds:[...new Set(a.leaves.map(l=>l.kind))],groundOk:a.leaves.every(l=>Math.abs(l.ground-(10+l.x*.05))<.02)}));
""")
    assert r["same"] and r["unique"] and r["groundOk"]
    assert r["under"] > 1.3 * r["open"] > 0
    assert set(r["kinds"]) <= {"oak", "lance", "broad", "sickle", "bark", "pine", "sprig"}


def test_wild_grass_fills_meadows_and_wood_gaps_but_not_lawns_or_bushes():
    r = node(CELL + """
const meadow=f.floorCell(24,0,12,ctx(.1,71)),lawn=f.floorCell(24,0,12,ctx(.1,21)),wood=f.floorCell(0,0,12,ctx(.85,42));
const clash=wood.grass.filter(g=>wood.plants.some(p=>Math.hypot(p.x-g.x,p.y-g.y)<p.radius*.6)).length;
console.log(JSON.stringify({meadow:meadow.grass.length,lawn:lawn.grass.length,wood:wood.grass.length,plants:wood.plants.length,
  clash,models:[...new Set(wood.plants.map(p=>p.model))],kinds:[...new Set(meadow.grass.map(g=>g.kind))]}));
""")
    assert r["meadow"] > 150 and r["lawn"] == 0 and r["wood"] > 20
    assert r["clash"] <= r["wood"] * 0.05
    assert r["plants"] > 20
    manifest = json.loads((ROOT / "docs/nature/models/manifest.json").read_text())
    assert set(r["models"]) <= set(manifest["models"])
    assert "wild_oat" in r["kinds"]


def test_grass_clumps_stand_unit_high_for_the_sway_shader():
    r = node("""
const out={};for(const k of Object.keys(f.WILD_GRASS)){const d=f.wildGrassGeometry(k,1,1),l=f.wildGrassGeometry(k,1,0);
  const ys=d.position.filter((_,i)=>i%3===1);out[k]={top:Math.max(...ys),bottom:Math.min(...ys),tris:d.index.length/3,light:l.index.length/3,
  colours:d.colour.length===d.position.length};}
console.log(JSON.stringify(out));
""")
    for kind, g in r.items():
        assert abs(g["top"] - 1) < 1e-9 and g["bottom"] >= -1e-9, kind
        assert g["colours"] and g["light"] < g["tris"] / 3, kind


def test_every_understorey_kind_has_a_scan_or_grass_and_the_scans_are_cc0():
    r = node("""console.log(JSON.stringify({scan:f.SCAN_FOR,grass:f.GRASS_FOR}))""")
    ecology = (ROOT / "docs/nature-ecology.mjs").read_text()
    kinds = ["fern", "thimbleberry", "huckleberry", "sorrel", "coffeeberry", "toyon", "coyote_brush",
             "sagebrush", "sedge", "bunchgrass"]
    manifest = json.loads((ROOT / "docs/nature/models/manifest.json").read_text())
    for kind in kinds:
        assert f"{kind}:" in ecology
        assert kind in r["scan"] or kind in r["grass"]
        if kind in r["scan"]:
            assert r["scan"][kind] in manifest["models"]
    for name, record in manifest["models"].items():
        assert record["license"] == "CC0-1.0", name
        for item in (record, record.get("far") or {}):
            if item:
                data = (ROOT / "docs/nature/models" / item["file"]).read_bytes()
                assert hashlib.sha256(data).hexdigest() == item["sha256"], item["file"]


def test_globe_frame_puts_the_page_origin_under_the_camera_and_east_east():
    r = node("""console.log(JSON.stringify({up:g.directionToGeographic([0,1,0],-122.44,37.8),
  east:g.directionToGeographic([1,0,0],-122.44,37.8),north:g.directionToGeographic([0,0,-1],-122.44,37.8),
  horizon:g.horizonDistance(10000)}))""")
    assert r["up"] == pytest.approx([-122.44, 37.8])
    assert r["east"][1] == pytest.approx(0, abs=1e-9) and r["east"][0] == pytest.approx(-32.44)
    assert r["north"][0] == pytest.approx(57.56) and r["north"][1] == pytest.approx(52.2)
    assert 356000 < r["horizon"] < 358000


def test_world_mask_is_the_recorded_land_and_water():
    record = json.loads((ROOT / "docs/world/land-mask.json").read_text())
    data = (ROOT / "docs/world" / record["file"]).read_bytes()
    assert hashlib.sha256(data).hexdigest() == record["sha256"]
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", data[16:24])
    assert (width, height) == (record["width"], record["height"]) == (8192, 4096)
    assert "public domain" in record["license"]


def test_teleport_map_widens_with_the_hop_and_the_trip_fits_the_streaming_time():
    r = node("""console.log(JSON.stringify({short:t.mapSpanFor(800),mid:t.mapSpanFor(8000),long:t.mapSpanFor(200000),T:t.TELEPORT_TIMES}))""")
    assert r["short"] == 5000 and r["mid"] == pytest.approx(19200) and r["long"] == 90000
    times = r["T"]
    order = ["dark", "mapIn", "widen", "hop", "land", "close", "back"]
    assert all(times[a] < times[b] for a, b in itertools.pairwise(order))
    assert 6.5 <= times["back"] <= 7.5 and times["maxHold"] >= times["back"]


def test_page_wires_the_floor_globe_and_trip():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    for needle in ['"forest-floor.mjs?rev=__FOREST_FLOOR_HASH__"', '"globe.mjs?rev=__GLOBE_HASH__"',
                   '"teleport-map.mjs?rev=__TELEPORT_MAP_HASH__"', "forestFloor:forestFloorLibrary",
                   "function fitViewToAltitude()", "TELEPORT_MAP_M", "plantsReadyAt"]:
        assert needle in source
    page = (ROOT / "docs/app-model.html").read_text()
    assert "__FOREST_FLOOR_HASH__" not in page and "__GLOBE_HASH__" not in page
    release = json.loads((ROOT / "docs/runtime-release.json").read_text())
    for name in ["forest-floor.mjs", "globe.mjs", "teleport-map.mjs", "world/land-mask.png", "nature/models/manifest.json"]:
        assert release["runtime_assets_sha256"][name] == hashlib.sha256((ROOT / "docs" / name).read_bytes()).hexdigest()
