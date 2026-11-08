"""The landscape's towns: every OSM building beyond the built regions, and the highways to them."""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
from pathlib import Path

from tests.test_nature_atlas import node

ROOT = Path(__file__).resolve().parents[1]


def _builder():
    spec = importlib.util.spec_from_file_location("build_nature_buildings", ROOT / "scripts/build_nature_buildings.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_kbl2_round_trips_through_the_runtime_decoder(tmp_path):
    build = _builder()
    # Two buildings in tile (2, 16): a gabled house and a flat-roofed block, in eighths of a metre.
    house = [(400, 400), (480, 400), (480, 480), (400, 480)]
    block = [(800, 800), (1200, 800), (1200, 1000), (1000, 1100), (800, 1000)]
    data = build.encode([(1, 65, 1, "a", house), (3, 110, 2, "b", block)])
    (tmp_path / "t.bin").write_bytes(data)
    result = node(f"""
import fs from 'node:fs';
const out=n.decodeNatureBuildings(fs.readFileSync({json.dumps(str(tmp_path / "t.bin"))}),2,16);
console.log(JSON.stringify(out));""")
    assert [(b["kind"], b["height"], b["roof"]) for b in result] == [(1, 6.5, 1), (3, 11.0, 2)]
    # (v / 8) - 50 + tile corner
    assert result[0]["ring"][0] == [2 * 4000 + 400 / 8 - 50, 16 * 4000 + 400 / 8 - 50]
    assert result[1]["ring"][3] == [2 * 4000 + 1000 / 8 - 50, 16 * 4000 + 1100 / 8 - 50]


def test_house_geometry_stands_on_its_lowest_corner_with_a_gable_and_windows():
    result = node("""
const house={kind:1,height:6.5,roof:0,ring:[[0,0],[12,0],[12,8],[0,8]]};
const a=n.natureBuildingArrays([house],(x,y)=>({p:[x,-y],height:x*.2}));
const ys=[];for(let i=1;i<a.position.length;i+=3)ys.push(a.position[i]);
const walls=a.facade.filter((v,i)=>i%3===0&&v>=0).length;
console.log(JSON.stringify({drawn:a.drawn,min:Math.min(...ys),max:Math.max(...ys),walls,tris:a.index.length/3}));""")
    assert result["drawn"] == 1
    assert abs(result["min"] - (-0.4)) < 1e-9  # the lowest ground, sunk 0.4 m
    # The uphill side keeps a storey: eave over the highest corner, then the ridge over that.
    assert result["max"] > 2.4 + 2.6
    assert result["walls"] == 16  # four walls of four vertices, with windows
    assert result["tris"] == 8 + 4 + 2  # walls, two roof slopes, two gable ends


def test_a_building_across_a_cliff_is_left_out_and_an_l_shape_gets_a_flat_roof():
    result = node("""
const cliff=n.natureBuildingArrays([{kind:1,height:6,roof:0,ring:[[0,0],[10,0],[10,10],[0,10]]}],(x,y)=>({p:[x,y],height:x*3}));
const ell=[[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]];
const flat=n.natureBuildingArrays([{kind:3,height:8,roof:2,ring:ell}],(x,y)=>({p:[x,y],height:0}));
console.log(JSON.stringify({cliff:cliff.drawn,tris:flat.index.length/3,ear:n.earcut(ell).length/3}));""")
    assert result["cliff"] == 0
    assert result["ear"] == 4
    assert result["tris"] == 12 + 4


def test_highways_are_laid_and_sized_by_their_lanes_but_tunnels_are_not():
    result = node("""
const w={kind:'motorway',width_m:7,width_source:'inferred',trail:false,source_tags:{lanes:'4'}};
console.log(JSON.stringify({roads:['motorway','trunk','motorway_link'].map(k=>n.NATURE_ROADS.has(k)),
  width:n.inferredWidth(w),bare:n.inferredWidth({...w,source_tags:{}}),
  tunnel:n.natureTunnel({source_tags:{tunnel:'yes'}}),bridge:n.natureTunnel({source_tags:{bridge:'yes'}})}));""")
    assert result["roads"] == [True, True, True]
    assert abs(result["width"] - (4 * 3.6 + 3.5)) < 1e-9
    assert result["bare"] == 15
    assert result["tunnel"] is True and result["bridge"] is False


def test_published_tiles_match_their_manifest():
    manifest = json.loads((ROOT / "docs/nature/buildings.json").read_text())
    assert manifest["license"] == "ODbL-1.0"
    total = 0
    for record in manifest["tiles"].values():
        raw = (ROOT / "docs/nature" / record["file"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == record["sha256"]
        decoded = gzip.decompress(raw)
        assert len(decoded) == record["decoded_bytes"] and decoded[:4] == b"KBL2"
        total += record["buildings"]
    assert total == manifest["buildings"]
