"""No sign stands inside another, none stands on a crossing, and every corner has its names.

Plates on one post are stacked, each at its own height whichever way it faces; plates on posts
side by side are kept apart; a post is never on a crossing's paint or its kerb ramp; and each
junction of two named streets gets one post on one corner with a blade along each street.
"""

from __future__ import annotations

import itertools
import json
import math
import re
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

CONSTS = ("SIGN_CELL_M", "SIGN_PLATE_CLEAR_M", "SIGN_CROSSING_CLEAR_M", "PLATE_GAP_M",
          "CURB_RAMP_DEPTH_M", "CURB_RAMP_FLARE_M", "CROSSING_DEDUPE_CELL_M", "JUNCTION_CELL_M",
          "PLATE_MIN_BOTTOM_M")
FUNCTIONS = ("distanceToSegmentSquared", "pointInRing", "segmentGap2D", "plateRect", "platesMeet",
             "signCellsOf", "plateClash", "registerPlate", "placePlate", "rampFootprint",
             "rampGridNow", "onCrossingGround", "approachPlacement", "bladeName", "onewaySign",
             "approachLegs", "cornerStreetNameSigns")
PREAMBLE = """
let signPlateGrid = new Map();
const signStats = { lowered: 0, cornerPosts: 0 };
const tactileWarningPads = [];
const crossingDrawGrid = new Map();
let rampGrid = null;
let junctionVertexGrid = null;
function insideCarriageway() { return false; }
function insideJunctionBox() { return false; }
function buildingAt() { return null; }
function isUnmarkedService() { return false; }
function isTunnelWay() { return false; }
function renderedRoadWidth() { return 10; }
function lonLatFromXZ(x, z) { return [x, z]; }
"""


def _run(body: str) -> dict:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {n} = [^;]+;", js).group(0) for n in CONSTS)
    suffixes = re.search(r"const BLADE_SUFFIXES = \{[^}]+\};", js).group(0)
    script = "\n".join([PREAMBLE, consts, suffixes, *(_extract(n, js) for n in FUNCTIONS), body])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _disjoint(intervals: list[list[float]]) -> bool:
    intervals = sorted(intervals)
    return all(a[1] <= b[0] + 1e-9 for a, b in itertools.pairwise(intervals))


def test_plates_on_one_post_each_have_their_own_height_whichever_way_they_face() -> None:
    result = _run("""
    const post = {};
    const placed = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.3].map((yaw) =>
      placePlate(post, Math.sin(yaw) * 0.05, Math.cos(yaw) * 0.05, yaw, 0.76, 0.76, 2.81, 0.9));
    console.log(JSON.stringify(placed.map((r) => r && [r.bottom, r.top])));
    """)
    plates = [r for r in result if r]
    assert len(plates) >= 2
    assert _disjoint(plates), "two plates on one post share a height"
    assert all(bottom >= 0.9 - 1e-9 for bottom, _ in plates)


def test_plates_on_two_posts_side_by_side_never_meet() -> None:
    # Two posts 0.6 m apart, each with a 0.9 m plate running toward the other at one height.
    result = _run("""
    const a = placePlate({}, 0, 0, 0, 0.9, 0.3, 2.5, 0.9);
    const b = placePlate({}, 0.6, 0, 0, 0.9, 0.3, 2.5, 0.9);
    const far = placePlate({}, 5, 0, 0, 0.9, 0.3, 2.5, 0.9);
    console.log(JSON.stringify({ a: [a.bottom, a.top], b: [b.bottom, b.top], far: [far.bottom, far.top],
      meet: platesMeet(a, b) }));
    """)
    assert not result["meet"]
    assert _disjoint([result["a"], result["b"]]), "the second plate must go under the first"
    assert result["far"] == result["a"], "a plate with nothing near it is not moved"


def test_no_post_on_a_crossing_or_its_kerb_ramp() -> None:
    result = _run("""
    // A 1.5 m pad at the kerb (z = 0), the footway toward +z; the crossing runs out to -z.
    tactileWarningPads.push([[0, 0], [1.5, 0], [1.5, 0.91], [0, 0.91]]);
    crossingDrawGrid.set("0:-3", [{ x: 0.75, z: -6, bearing: Math.PI / 2, length: 12, width: 3 }]);
    const at = (x, z) => onCrossingGround(x, z);
    console.log(JSON.stringify({ pad: at(0.75, 0.4), ramp: at(0.75, 1.3), flare: at(-0.3, 1.2),
      paint: at(0.75, -5), clear: at(4, 3), beside: at(2.6, 0.5) }));
    """)
    assert result["pad"] and result["ramp"] and result["flare"] and result["paint"]
    assert not result["clear"] and not result["beside"]


def test_an_approach_sign_steps_back_off_the_crossing() -> None:
    result = _run("""
    const leg = { ux: 0, uz: 1, half: 5, inbound: true };
    const other = { ux: 1, uz: 0, half: 5, inbound: true };
    const junction = { x: 0, z: 0 };
    const before = approachPlacement(junction, leg, [leg, other]);
    // A crossing and its ramps across the approach exactly where the sign would have stood.
    crossingDrawGrid.set("0:1", [{ x: 0, z: before.z, bearing: 0, length: 16, width: 3 }]);
    rampGrid = null;
    const after = approachPlacement(junction, leg, [leg, other]);
    console.log(JSON.stringify({ before, after, clear: !onCrossingGround(after.x, after.z) }));
    """)
    assert result["clear"]
    assert result["after"]["z"] > result["before"]["z"], "it moves back along the approach"


def test_each_junction_of_two_named_streets_gets_one_post_with_a_blade_along_each() -> None:
    result = _run("""
    // Hyde Street runs north-south, Bush Street east-west; they cross at the origin.
    const hyde = { kind: "street", name: "Hyde Street" };
    const bush = { kind: "street", name: "Bush Street" };
    const ns = [[0, -60], [0, 0], [0, 60]], ew = [[-60, 0], [0, 0], [60, 0]];
    junctionVertexGrid = new Map();
    const put = (way, pts) => pts.forEach(([x, z], i) => {
      const key = `${Math.floor(x / JUNCTION_CELL_M)}:${Math.floor(z / JUNCTION_CELL_M)}`;
      if (!junctionVertexGrid.has(key)) junctionVertexGrid.set(key, []);
      junctionVertexGrid.get(key).push({ way, pts, i, x, z });
    });
    put(hyde, ns); put(bush, ew);
    const blades = cornerStreetNameSigns();
    console.log(JSON.stringify(blades.map((b) => ({ p: b.p, label: b.label, bearing: b.bearing, blade: b.blade }))));
    """)
    assert len(result) == 2, "one post, two blades"
    assert result[0]["p"] == result[1]["p"], "both blades are on one post"
    assert {b["label"] for b in result} == {"HYDE ST", "BUSH ST"}
    assert {b["blade"] for b in result} == {0, 1}, "the two blades are at different heights"
    for b in result:
        yaw = math.radians(b["bearing"])
        normal = (math.sin(yaw), math.cos(yaw))
        street = (0.0, 1.0) if b["label"] == "HYDE ST" else (1.0, 0.0)
        # The blade runs along its street: its face is square to the street's direction.
        assert abs(normal[0] * street[0] + normal[1] * street[1]) < 1e-6, b


def test_the_page_draws_every_plate_through_the_one_placement_and_no_all_way_plaques() -> None:
    js = _page_js()
    assert 'label: "ALL WAY"' not in js, "no ALL WAY plaque is inferred"
    assert '!["all_way", "street_name"].includes(plateStyleFor(s))' in js
    assert "addOfficialSignPlates(officialSigns.concat(osmApproach, generic, corners), signalHeads)" in js
    assert "topsByFacing" not in js, "plates are one stack per post, not one per facing"
    body = _extract("addOfficialSignPlates", js)
    assert "placePlate(" in body and "registerPlate(" in body and "clearPostSpot(" in body
    panels = _extract("addInstancedFurniturePanels", js)
    assert "placePlate(" in panels and "plateClash(" in panels
    assert 'placed.sign_audit = auditSignPlates(plates.spots);' in js
