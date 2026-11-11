"""The walker on hills and stairs, the GPS leash, and bus zones that stop at the crossings."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_pace_slows_uphill_and_quickens_downhill_the_steeper_it_is() -> None:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [0-9.]+;", js).group(0)
                       for name in ("DOWNHILL_PACE_MAX", "DOWNHILL_FULL_GRADE", "UPHILL_PACE_MIN", "UPHILL_FULL_GRADE"))
    script = consts + "\n" + _extract("toblerPace", js) + """
        console.log(JSON.stringify([0, 0.1, 0.2, 0.3, -0.05, -0.3, -0.6, -1.0, 0.6].map((g) => +toblerPace(g).toFixed(3))));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    level, up10, up20, up30, gentle_down, steep_down, steeper_down, steepest_down, up60 = json.loads(out.stdout)
    assert abs(level - 1) < 1e-6
    assert 0.8 < up10 < 0.9 and up20 < up10 and up30 < up20, "steeper up is slower, in proportion"
    assert up30 == up60 == 0.6, "to a floor at a steep hill"
    assert 1 < gentle_down < steep_down < steeper_down, "every step down the hill is quicker"
    assert steeper_down == steepest_down <= 1.5, "to a limit"


def test_the_view_looks_straight_up_and_down() -> None:
    js = _page_js()
    assert "const LOOK_LIMIT = 1.55;" in js
    assert "state.look = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, state.look - dy * 0.004));" in js
    # Orbiting, the drag stops at the lowest pitch and at the ground: it no longer tilts the
    # view up past it, which swung a drag that met the street round to the sky.
    assert "ORBIT_MIN_PITCH - v" not in js
    assert "if (!(cameraOnGround && v < state.pitch)) state.pitch = Math.max(ORBIT_MIN_PITCH, Math.min(1.28, v));" in js
    assert "state.tilt = 0;" in js
    # Looked at along cos/sin rather than tan, so straight up does not fly off to infinity.
    assert "Math.cos(state.look)" in _extract("placeCamera", js)


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
    assert "if (travel && GPS_LEASH) GPS_LEASH.on = false;" in _extract("goToNow", js)
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


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_one_bus_stop_listed_in_pieces_is_painted_as_one_zone() -> None:
    js = _page_js()
    join = _extract("joinBusZones", js)
    assert "records = joinBusZones(records);" in _extract("addBusZonePaint", js)
    # Lombard at Fillmore: a 3 m piece, 3 m gap, a 13 m piece (one stop); Fillmore's two pieces
    # 6 m apart (a driveway between: two zones); and one zone listed for two time windows.
    script = (
        "const BUS_ZONE_JOIN_M = 4.0; const xy = (x, y) => [x, -y];\n" + join + "\n"
        "const z = (street, side, line) => ({ street_name: street, side_of_street: side, lines: [line] });\n"
        "const out = joinBusZones([\n"
        "  z('LOMBARD ST', 'W', [[-7, 6], [-10, 6]]), z('LOMBARD ST', 'W', [[-26, 4], [-13, 6]]),\n"
        "  z('FILLMORE ST', 'W', [[36, -19], [35, -15]]), z('FILLMORE ST', 'W', [[37, -25], [38, -31]]),\n"
        "  z('GREENWICH ST', 'W', [[172, -72], [141, -77]]), z('GREENWICH ST', 'W', [[172, -72], [141, -77]]),\n"
        "]);\n"
        "console.log(JSON.stringify(out.map((r) => [r.street_name, r.lines[0]])));\n"
    )
    out = json.loads(subprocess.run([NODE, "-e", script], check=True, capture_output=True, text=True).stdout)
    lombard = [line for street, line in out if street == "LOMBARD ST"]
    assert len(lombard) == 1 and len(lombard[0]) == 4
    assert {tuple(lombard[0][0]), tuple(lombard[0][-1])} == {(-7, 6), (-26, 4)}
    assert sum(1 for street, _ in out if street == "FILLMORE ST") == 2
    assert sum(1 for street, _ in out if street == "GREENWICH ST") == 1
