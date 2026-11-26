"""Junction paint (2026-11-25 inspection of the Marina's complex crossroads).

- Lane arrows on north-south streets pointed backwards (their turn hooks mirrored): the plane's
  turn was -atan2(dx, -dy), right only east and west.
- On a two-way street the turn:lanes arrows were spread over every lane, oncoming ones too.
- The double yellow, lane lines and bike lanes ran through mapped crosswalks the junction test
  did not see (mid-block, T-junctions, skewed corners): they stop at the crosswalk's paint now.
"""
import json
import math
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")


def run(script: str):
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_lane_arrows_point_the_way_the_traffic_goes_whichever_way_the_street_runs() -> None:
    js = _page_js()
    spins = run("\n".join([
        _extract("turnArrowSpin", js),
        "const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-2, 1]];",
        "console.log(JSON.stringify(dirs.map(([dx, dy]) => turnArrowSpin(dx, dy))));",
    ]))
    for (dx, dy), phi in zip([(1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-2, 1)], spins, strict=True):
        # The plane's +y (the head) after rotation.z = phi then rotation.x = -pi/2, on the ground
        # (x, z): (-sin phi, -cos phi). The traffic's way in the page: (dx, -dy) (z = -y).
        n = math.hypot(dx, dy)
        assert (-math.sin(phi)) == pytest.approx(dx / n, abs=1e-9)
        assert (-math.cos(phi)) == pytest.approx(-dy / n, abs=1e-9)
        # Its right-hand side (the plane's +x: (cos phi, -sin phi)) is the driver's right.
        rx, rz = math.cos(phi), -math.sin(phi)
        assert rx * (dy / n) + rz * (dx / n) == pytest.approx(1.0, abs=1e-9)  # right of (dx,-dy) is (dy,dx)
    assert "mesh.rotation.z = turnArrowSpin(x2 - x1, y2 - y1);" in js


def test_two_way_street_arrows_go_in_its_forward_lanes_only() -> None:
    js = _page_js()
    out = run("\n".join([
        "function travelSpan(way, w) { return [w / 2, -w / 2]; }",
        "function laneOffsets(w, n) { const out = []; for (let i = 0; i < n; i += 1) out.push(w / 2 - (i + 0.5) * (w / n)); return out; }",
        "function onewaySign(way) { return way.oneway ? 1 : 0; }",
        _extract("turnArrowLanes", js),
        "console.log(JSON.stringify({",
        "  bay: turnArrowLanes({ lanes: 5, lanes_fwd: 3 }, 17.5, 3),",
        "  laguna: turnArrowLanes({ lanes: 2 }, 7.0, 2),",
        "  oneway: turnArrowLanes({ lanes: 3, oneway: 'yes' }, 10.5, 3),",
        "}));",
    ]))
    # Bay Street: five lanes, three forward -- the three right-hand lanes, 3.5 m each.
    assert out["bay"]["laneWidth"] == pytest.approx(3.5)
    # Lane centres 7, 3.5, 0, -3.5, -7 from the left: the forward three are the right-hand three.
    assert out["bay"]["offsets"] == pytest.approx([0.0, -3.5, -7.0])
    assert all(o < 1.75 for o in out["bay"]["offsets"]), "none in the oncoming lanes"
    # Two tokens on a two-way street of two lanes: both in its right half, left to right.
    assert all(o < 0 for o in out["laguna"]["offsets"])
    assert out["laguna"]["offsets"][0] > out["laguna"]["offsets"][1]
    # A one-way street's arrows span the whole road, as before.
    assert out["oneway"]["offsets"] == pytest.approx([3.5, 0.0, -3.5])


def test_road_lines_stop_at_a_mapped_crosswalk_wherever_it_is() -> None:
    js = _page_js()
    out = run("\n".join([
        "function xy(x, y) { return [x, y]; }",
        "const CROSSING_DEDUPE_CELL_M = 4.0, mappedCrossingGrid = new Map(), CROSSING_LINE_CLEAR_M = 0.6, mappedCrossingCover = new Map();",
        *[_extract(n, js) for n in ("crossingDrawPose", "indexMappedCrossing", "onMappedCrossing", "wayLength", "lerpLonLat",
                                    "densifyWay", "splitAtMappedCrossings")],
        # A crosswalk across a street running north (y), mid-block at y = 50, 3 m wide.
        "indexMappedCrossing([[-6, 50], [6, 50]], 3.0);",
        "const runs = splitAtMappedCrossings([[1, 0], [1, 100]]);",
        "console.log(JSON.stringify({ runs: runs.map((r) => [r[0][1], r[r.length - 1][1]]),",
        "  on: onMappedCrossing(1, -50), beside: onMappedCrossing(1, -53), off: onMappedCrossing(8, -50) }));",
    ]))
    assert len(out["runs"]) == 2
    (a0, a1), (b0, b1) = out["runs"]
    assert a0 == pytest.approx(0) and b1 == pytest.approx(100)
    # The gap: the crosswalk's 3 m and the clear margin either side.
    assert a1 <= 50 - 1.5 - 0.5 and b0 >= 50 + 1.5 + 0.5
    assert out["on"] is True and out["beside"] is False and out["off"] is False


def test_lines_and_bike_lanes_use_the_crosswalk_cut() -> None:
    js = _page_js()
    runs = js[js.index("function markingRunsClearOfJunctions("):]
    assert 'onMappedCrossing(x, -y)' in runs[:4000]
    assert "for (const piece of splitAtMappedCrossings(run.points))" in js
    assert "indexMappedCrossing(span, crossingWidth);" in js
