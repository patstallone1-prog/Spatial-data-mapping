"""The walker on hills and stairs, the GPS leash, and bus zones that stop at the crossings."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_pace_slows_uphill_and_on_steep_descents() -> None:
    js = _page_js()
    script = _extract("toblerPace", js) + """
        console.log(JSON.stringify([0, 0.1, 0.2, 0.3, -0.05, -0.3].map((g) => +toblerPace(g).toFixed(3))));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    level, up10, up20, up30, gentle_down, steep_down = json.loads(out.stdout)
    assert abs(level - 1) < 1e-6
    assert up10 < 0.75 and up20 < up10 and up30 < up20, "every step up the hill is slower"
    assert gentle_down > 1, "a gentle slope down is a little quicker"
    assert steep_down < 0.7


def test_cliffs_are_not_walked_and_stairs_are_climbed_tread_by_tread() -> None:
    js = _page_js()
    pace = _extract("walkPace", js)
    assert "grade > MAX_WALK_GRADE || grade < -MAX_DROP_GRADE" in pace
    assert 'here.kind === "terrain" && ahead.kind === "terrain"' in pace, "only plain ground is a cliff"
    assert "factor = Math.min(factor, STAIR_PACE)" in pace
    info = _extract("walkerGroundInfo", js)
    assert 'return { y: stair, kind: "stairs" }' in info
    assert "if (outsideTerrainGrid(x, z))" in info and "drawnGroundAt(x, z)" in info, "never under the hills drawn beyond the grid"
    assert js.count("frontStairSurface.stairs = true") == 2 and "door.stoopSurface.stairs = true" in js
    stairs = json.loads((ROOT / "docs/sf-corridor-stairs.json").read_text())
    assert stairs["schema"] == "kerbside.public_stairs/1" and len(stairs["stairs"]) > 100
    assert 'fetch(asset("sf-corridor-stairs.json")' in js


def test_the_walker_is_left_where_you_put_it_until_r_or_reset() -> None:
    js = _page_js()
    assert "if (!gps.target || held.size || !GPS_LEASH.on) return false;" in _extract("followGps", js)
    assert "if (travel && GPS_LEASH) GPS_LEASH.on = false;" in _extract("goTo", js)
    assert "GPS_LEASH.on = false;   // walking yourself" in _extract("stepAvatar", js)
    assert 'e.key !== "r" && e.key !== "R"' in js and "returnToGps()" in js
    assert "GPS_LEASH.on = true;" in _extract("returnToGps", js)
    page = (ROOT / "docs/app-model.html").read_text()
    assert "<dt><kbd>R</kbd></dt>" in page


def test_bus_zones_stop_at_junctions_and_crossings_and_keep_one_side() -> None:
    js = _page_js()
    pieces = _extract("busZonePieces", js)
    assert "!insideJunctionBox(px, pz) && !onCrossingGround(px, pz, 0.4)" in pieces
    assert "sideOf(k) === side" in pieces and "insideCarriageway(px, pz, 0)" in pieces
    paint = _extract("addBusZonePaint", js)
    assert "for (const run of busZonePieces(raw))" in paint
    # The bike-lane offset is the whole stretch's, decided by most of it.
    assert "inLane >= run.length * 0.6 ? BIKE_LANE_M + 0.35 : 0" in paint
