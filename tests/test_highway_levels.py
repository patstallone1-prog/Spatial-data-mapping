"""Interchanges solved as a whole: decks on several levels clear each other, ramps meet their
parents exactly, no grade is steeper than the road allows, and a deck clears the street under it.

Run, not read: the page's own solveDeckLevels, on an interchange laid out like the Mission's
Hairball -- a freeway on layer 1, a connector over it on layer 2, and a flyover over both on
layer 3 -- and on the checks doc 34 asks of every interchange before it ships.
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


def _solve(body: str) -> dict:
    code = "\n".join([_extract("solveDeckLevels", _page_js()), body])
    out = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout)


HAIRBALL = """
const ground = () => 0;
// The freeway east-west, its ends on the street; a connector over it north-south, from the
// street up and back down; a flyover over both on the diagonal, its ends on the connector.
const decks = [
  { id: "freeway", pts: [[-300, 0], [300, 0]], layer: 1, highway: true, mainline: true, ends: ["W", "E"] },
  { id: "connector", pts: [[0, -260], [0, 260]], layer: 2, highway: true, mainline: false, ends: ["S", "N"] },
  { id: "flyover-a", pts: [[-280, -280], [0, 0]], layer: 3, highway: true, mainline: false, ends: ["SW", "mid"] },
  { id: "flyover-b", pts: [[0, 0], [280, 280]], layer: 3, highway: true, mainline: false, ends: ["mid", "NE"] },
];
const pins = new Map([["W", 0], ["E", 0], ["S", 0], ["N", 0], ["SW", 0], ["NE", 0]]);
const solved = solveDeckLevels(decks, { ground, pins });
const h = (id, x, z) => solved.profiles.get(id)(x, z);
"""


def test_an_interchange_clears_every_level_and_keeps_every_grade() -> None:
    r = _solve(HAIRBALL + """
console.log(JSON.stringify({ report: solved.report,
  freeway: h("freeway", 0, 0), connector: h("connector", 0, 0), flyover: h("flyover-a", -0.01, -0.01),
  ends: [h("freeway", -300, 0), h("connector", 0, 260), h("flyover-a", -280, -280)],
  joint: [h("flyover-a", 0, 0), h("flyover-b", 0, 0)] }));
""")
    rep = r["report"]
    assert rep["crossings"] >= 3
    assert rep["minClearance"] >= 6.6 - 0.05            # every crossing a level apart
    assert rep["maxGradeOver"] <= 0.002                 # 6% on the freeway, 8% on ramps
    assert rep["endGap"] <= 1e-9                        # ramps meet their parents exactly
    # The levels stack in their order, and the ends stand on the street.
    assert 0 < r["freeway"] < r["connector"] - 6.5 < r["flyover"] - 13.1
    assert r["ends"] == [0, 0, 0]
    assert r["joint"][0] == pytest.approx(r["joint"][1], abs=1e-9)


def test_a_deck_clears_the_street_it_passes_over() -> None:
    r = _solve("""
const ground = () => 0;
const decks = [{ id: "bridge", pts: [[-150, 0], [150, 0]], layer: 1, highway: true, mainline: true, ends: ["a", "b"],
  controls: [{ x: 40, z: 0, target: 6.0 }] }];
const solved = solveDeckLevels(decks, { ground, pins: new Map([["a", 0], ["b", 0]]) });
console.log(JSON.stringify({ report: solved.report, at: solved.profiles.get("bridge")(40, 0) }));
""")
    assert r["report"]["streetControls"] == 1
    assert r["at"] >= 6.0 - 0.05 and r["report"]["minStreetMargin"] >= -0.05
    assert r["report"]["maxGradeOver"] <= 0.002


def test_the_page_solves_its_interchanges_and_reports_what_it_reached() -> None:
    js = _page_js()
    assert "const solved = solveDeckLevels(decks, { ground: (x, z) => groundLiftAt(x, z), pins, level: DECK_LEVEL_M," in js
    assert "if (CENTRAL_SOLVED.has(way)) return CENTRAL_SOLVED.get(way);" in js
    # Stacked connectors (layer 2 and up) are decks now, not street on the ground.
    assert "!/Transbay|Bus Ramp/i.test(way.name || \"\"));" in js
    assert "get deckLevels() { return DECK_LEVEL_REPORT; }," in js
    # A deck's edge stops the walker on that deck, and only there.
    assert "function deckEdgeSegmentsNear(x, z, feet)" in js


def test_a_decks_edges_stop_the_walker_on_it_and_nowhere_else() -> None:
    """On a deck 8 m up: both edges are walls. On the street under it: none. Where a ramp carries
    on beside the deck at its height: that edge is open."""
    js = _page_js()
    code = "\n".join([
        "const ROAD_TOP_M = 0.06; var ELEVATED_ROADS;",
        "function groundLiftAt() { return 0; }",
        *(_extract(n, js) for n in ["elevatedCellM", "registerElevatedSegment", "elevatedDecksAt", "deckEdgeSegmentsNear"]),
        """
registerElevatedSegment(0, 0, 8, 60, 0, 8, 4, { kind: "highway", reach: 4 });
const on = deckEdgeSegmentsNear(30, 0, 8), under = deckEdgeSegmentsNear(30, 0, 0.1);
const side = (segs) => [...new Set(segs.map((s) => Math.sign(s[1])))].sort();
// A ramp leaving along the north edge, at the deck's height, from x = 20 to 40.
registerElevatedSegment(20, 9, 8, 40, 9, 8, 4, { kind: "highway", reach: 4 });
const withRamp = deckEdgeSegmentsNear(30, 0, 8).filter((s) => Math.abs(s[1]) < 4.5 && Math.abs(s[3]) < 4.5);
const northOpen = !withRamp.some((s) => s[1] > 0 && s[0] >= 21 && s[2] <= 39);
console.log(JSON.stringify({ on: on.length, sides: side(on), under: under.length, northOpen,
  southStill: withRamp.some((s) => s[1] < 0 && s[0] >= 21 && s[2] <= 39) }));
""",
    ])
    out = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[-2000:]
    r = json.loads(out.stdout)
    assert r["on"] > 0 and r["sides"] == [-1, 1]
    assert r["under"] == 0
    assert r["northOpen"] and r["southStill"]
