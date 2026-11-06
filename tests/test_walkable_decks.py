"""Bridges and highways are structures a person stands on, not road paint over the ground.

Run, not read: the page's own deck registry (registerElevatedSegment, elevatedDecksAt), what a
deck is (structureKindOf: a bridge, or a highway's deck by name, by OpenStreetMap layer, or as an
unnamed ramp chained to a freeway's deck), and the walker's choice of level (walkerGroundInfo):
up onto a deck within a step of the feet, under a viaduct otherwise, onto a span over the water
when jumping there.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from test_street_infill import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is needed to run the renderer's own code")


def _run(body: str) -> dict:
    js = _page_js()
    names = ["elevatedCellM", "registerElevatedSegment", "isHighwayName", "structureKindOf",
             "highwayRampWays", "elevatedDecksAt", "walkerGroundInfo"]
    code = "\n".join([
        "const ROAD_TOP_M = 0.12; var ELEVATED_ROADS; let water = false;",
        "const DATA = { ways: globalThis.WAYS || [] };",
        "function groundLiftAt() { return 0; }",
        "function mappedWaterAt() { return water; }",
        "function pavementSurfaceAt() { return null; }",
        "function outsideTerrainGrid() { return false; }",
        "function tunnelSurfaceAt() { return null; }",
        *(_extract(n, js) for n in names),
        body,
    ])
    out = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout)


def test_a_deck_knows_whether_it_is_a_bridge_or_a_highway():
    result = _run("""
const fwy = { kind: "street", bridge: true, name: "Central Freeway", points: [[0, 0], [1, 0]] };
const ramp = { kind: "street", bridge: true, name: null, points: [[1, 0], [2, 0]] };
const rampOfRamp = { kind: "street", bridge: true, name: null, points: [[2, 0], [3, 0]] };
const stacked = { kind: "street", bridge: true, name: null, layer: "2", points: [[9, 9], [9, 8]] };
const creek = { kind: "street", bridge: true, name: "Mission Creek Bridge", points: [[5, 5], [6, 5]] };
const footbridge = { kind: "street", bridge: true, name: null, points: [[7, 7], [8, 7]] };
DATA.ways.push(fwy, ramp, rampOfRamp, stacked, creek, footbridge);
console.log(JSON.stringify([fwy, ramp, rampOfRamp, stacked, creek, footbridge].map(structureKindOf)
  .concat([isHighwayName("I-280"), isHighwayName("US 101"), isHighwayName("Market Street")])));
""")
    assert result == ["highway", "highway", "highway", "highway", "bridge", "bridge", True, True, False]


def test_the_walker_climbs_onto_a_deck_walks_under_a_viaduct_and_lands_on_a_span():
    result = _run("""
// A viaduct 8 m up and, stacked over it, a flyover 16 m up; a ramp rising from the ground.
registerElevatedSegment(0, 0, 8, 100, 0, 8, 6, { kind: "highway", name: "James Lick Freeway", reach: 7 });
registerElevatedSegment(0, 0, 16, 100, 0, 16, 5, { kind: "highway", name: null, reach: 5 });
registerElevatedSegment(0, 40, 0.2, 100, 40, 9.2, 5, { kind: "highway", name: "ramp", reach: 5 });
registerElevatedSegment(0, 80, 60, 100, 80, 60, 10, { kind: "bridge", name: "Golden Gate Bridge", reach: 13, walkway: 10, walkTop: 0.22 });
const at = (x, z, feet) => { const g = walkerGroundInfo(x, z, feet); return [g.kind, +g.y.toFixed(2), g.structure ?? null]; };
const out = {
  under: at(50, 0, 0),            // on the street under both decks
  lower: at(50, 0, 8),            // on the viaduct: the flyover is overhead
  upper: at(50, 0, 16),           // on the flyover
  rampFoot: at(1, 40, 0),         // the ramp's foot, level with the street: the street
  rampUp: at(60, 40, 5.6),        // walked up to 6 m: on the ramp
  jumpOverLand: at(50, 0, null),  // a jump with no height over land: the ground, not a deck
};
water = true;
out.jumpOverWater = at(50, 80, null);   // a jump to a span over the water: its deck
out.walkway = at(50, 91.5, 60.2);       // past the roadway, on the walkway kerb
console.log(JSON.stringify(out));
""")
    assert result["under"][0] == "terrain" and result["under"][1] < 1
    assert result["lower"] == ["highway", 8, "James Lick Freeway"]
    assert result["upper"][0] == "highway" and result["upper"][1] == 16
    assert result["rampFoot"][0] == "terrain"
    assert result["rampUp"][0] == "highway" and 5 < result["rampUp"][1] < 6.5
    assert result["jumpOverLand"][0] == "terrain"
    assert result["jumpOverWater"] == ["bridge", 60, "Golden Gate Bridge"]
    assert result["walkway"] == ["bridge", 60.22, "Golden Gate Bridge"]


def test_the_bay_bridges_register_named_decks_and_a_jump_lands_on_them():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    for key in ["golden_gate", "bay_west", "bay_east", "richmond"]:
        assert f'deckName = named.get("{key}").find((w) => w.name)?.name' in source
    assert "elevatedDecksAt(landing.x,landing.z).length\n      ? null : groundLiftAt(landing.x,landing.z)" in source
    assert "structuresAt" in source and "elevatedDecksAt, structuresAt, walkerGroundInfo" in source
