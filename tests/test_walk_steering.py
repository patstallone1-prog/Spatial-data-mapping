"""The arrows steer the walker as a person walks. Standing or slow, Left or Right steps round
where you stand (a quarter turn a step); on the move, round a curve as wide as the speed, a
sprinter's tighter and quicker than it was; Down turns round in one step slow and two at a sprint.
The view eases round behind."""

from __future__ import annotations

import json
import math
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _walk(keys: list[str], seconds: float, speed: float = 1.4, eyes: bool = False,
          before: list[tuple[list[str], float]] | None = None) -> dict:
    """``keys`` held for ``seconds`` (measured), after the phases ``before`` (not measured)."""
    js = _page_js()
    consts = "\n".join(line for line in js.splitlines()
                       if line.startswith(("const WALK_TURN_", "const WALK_SIDE_", "const WALK_BACK_",
                                           "const WALK_VIEW_", "const WALK_STEP_", "const WALK_WAY_",
                                           "let walkTurnBack", "let walkWayOn")))
    phases = [*(before or []), (keys, seconds)]
    script = consts + """
class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
const THREE = { Vector3 };
const held = new Set();
const avatar = { rotation: { y: 0 }, userData: {} };
const state = { firstPerson: __EYES__, yaw: Math.PI };
const dragging = false;
const animateAvatar = () => {};
""".replace("__EYES__", json.dumps(eyes)) + _extract("walkTurn", js) + _extract("walkSteer", js) + """
const phases = __PHASES__, dt = 1 / 60, speed = __SPEED__;
let x, z, path, firstStep, viewRate, lastYaw, start;
for (const [i, [keys, seconds]] of phases.entries()) {
  held.clear(); for (const k of keys) held.add(k);
  const last = i === phases.length - 1;
  if (last) { x = 0; z = 0; path = 0; firstStep = null; viewRate = 0; lastYaw = state.yaw; start = avatar.rotation.y; }
  for (let t = 0; t < seconds; t += dt) {
    const s = walkSteer(dt, speed);
    if (!s || !last) continue;
    const d = s.pace * speed * dt;
    x += s.way.x * d; z += s.way.z * d; path += d;
    const back = start + Math.PI;
    if (firstStep === null && Math.abs(Math.atan2(Math.sin(avatar.rotation.y - back), Math.cos(avatar.rotation.y - back))) < 1e-6) firstStep = t;
    viewRate = Math.max(viewRate, Math.abs(state.yaw - lastYaw) / dt); lastYaw = state.yaw;
  }
}
const turned = Math.atan2(Math.sin(avatar.rotation.y - start), Math.cos(avatar.rotation.y - start));
console.log(JSON.stringify({ x, z, path, yaw: avatar.rotation.y, turned, turnedAt: firstStep, view: state.yaw, viewRate }));
""".replace("__PHASES__", json.dumps(phases)).replace("__SPEED__", str(speed))
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


UP_TO_SPEED = [(["ArrowUp"], 2.5)]


def _radius(keys: list[str], speed: float) -> float:
    """The curve's radius, on the move: the distance walked over the angle turned."""
    arc = _walk(keys, 0.3, speed, before=UP_TO_SPEED)
    return arc["path"] / abs(arc["turned"])


def test_standing_left_or_right_is_a_step_turn_where_you_stand() -> None:
    """A quarter turn is one step (a third of a second), the feet carrying you a hand's breadth --
    not a loop round a curve, and stepped, not spun (stepTurn drives the walk clip)."""
    quarter = _walk(["ArrowRight"], 0.34)
    assert abs(quarter["turned"]) == pytest.approx(math.pi / 2, abs=0.12)
    assert quarter["path"] < 0.05
    # Up with a side from standing: round first, then off the new way.
    off = _walk(["ArrowUp", "ArrowLeft"], 0.34)
    assert abs(off["turned"]) > 1.3 and off["path"] < 0.35


def test_on_the_move_the_turn_is_as_wide_as_the_speed_and_a_sprint_turns_quicker() -> None:
    speeds = [1.4, 3.0, 5.36, 8.94]
    up = [_radius(["ArrowUp", "ArrowLeft"], v) for v in speeds]
    assert up == sorted(up), "wider the faster"
    assert up[1] == pytest.approx(0.3 * 3.0, rel=0.08), "in proportion, where it is not held"
    assert max(up) <= 2.0 + 1e-6
    # A sprint's quarter turn: a few steps still, but quicker than the 0.71 s it took (2.2 rad/s).
    sprint = _walk(["ArrowUp", "ArrowLeft"], 0.5, 6.0, before=UP_TO_SPEED)
    assert abs(sprint["turned"]) > math.pi / 2 * 0.95
    assert abs(sprint["turned"]) < math.pi * 0.6, "still a curve of a few steps, not a pivot"


def test_down_is_a_one_step_turn_slow_and_a_two_step_pivot_at_a_sprint() -> None:
    standing = _walk(["ArrowDown"], 1.0)
    assert standing["turnedAt"] is not None and standing["turnedAt"] < 0.45
    stood = _walk(["ArrowDown"], 0.38)
    assert stood["path"] < 0.05, "on the spot"
    sprinting = _walk(["ArrowDown"], 1.5, 6.0, before=UP_TO_SPEED)
    assert sprinting["turnedAt"] is not None and 0.6 < sprinting["turnedAt"] < 0.85
    carried = _walk(["ArrowDown"], 0.7, 6.0, before=UP_TO_SPEED)
    assert 0.3 < carried["path"] < 1.8, "the way on carries a sprinter a little through the pivot"


def test_the_view_follows_the_turn_slower_than_the_body() -> None:
    """Seen from behind and from the walker's eyes, the view eases round after the turn and never
    swings faster than its most -- it wheeled round with the body, or a step behind it."""
    for eyes, most in ((False, 1.4), (True, 3.0)):
        turn = _walk(["ArrowUp", "ArrowRight"], 0.4, 5.36, eyes, before=UP_TO_SPEED)
        facing = turn["yaw"] + math.pi
        lag = abs(math.atan2(math.sin(facing - turn["view"]), math.cos(facing - turn["view"])))
        assert lag > 0.1, "the view comes round behind the body"
        assert turn["viewRate"] <= most + 1e-6
        back = _walk(["ArrowDown"], 2.5, 5.36, eyes)
        assert back["viewRate"] <= most + 1e-6


def test_up_with_a_side_on_the_move_walks_the_full_pace_curve() -> None:
    curve = _walk(["ArrowUp", "ArrowLeft"], 0.5, before=UP_TO_SPEED)
    assert curve["path"] == pytest.approx(0.7, abs=0.05)


def _walk_into(pole: list[float], aim_z: float = 0.0, seconds: float = 4.0) -> dict:
    """Walk +x from the origin, toward aim_z, past a thing outlined by `pole` (x0, z0, x1, z1)."""
    js = _page_js()
    consts = "\n".join(line for line in js.splitlines()
                       if line.startswith(("const KNOCK_ROUND_", "const WALKER_RADIUS_M")))
    script = consts + """
const [x0, z0, x1, z1] = __POLE__;
const pts = [x0, z0, x1, z0, x1, z1, x0, z1];
// A box, and a circle of radius r touching it (what the object catalogue's colliders answer).
const touches = (x, z, r) => Math.hypot(x - Math.max(x0, Math.min(x1, x)), z - Math.max(z0, Math.min(z1, z))) < r;
var objectProximity = { blocked: (x, z, r) => touches(x, z, r) ? { pts } : null };
const activeGuest = null;
// Open street: no building near (walkerStepIntoBuilding asks these).
const guestUnder = () => null, firstBuildingCollision = () => null, walkerFootprintBlocked = () => false;
""".replace("__POLE__", json.dumps(pole)) + _extract("knockRoundObject", js) + _extract("slidePastObjects", js) \
        + _extract("walkerStepIntoBuilding", js) + """
let x = 0, z = 0, stuck = 0, inside = false;
const step = 1.4 / 60;
for (let t = 0; t < __SECONDS__; t += 1 / 60) {
  const len = Math.hypot(10 - x, __AIM__ - z), tx = x + (10 - x) / len * step, tz = z + (__AIM__ - z) / len * step;
  const hit = objectProximity.blocked(tx, tz, WALKER_RADIUS_M);
  let to = [tx, tz];
  if (hit) to = slidePastObjects(x, z, tx, tz, false, hit);
  if (!to) { stuck += 1; continue; }
  [x, z] = to;
  if (objectProximity.blocked(x, z, WALKER_RADIUS_M)) inside = true;
}
console.log(JSON.stringify({ x, z, stuck, inside }));
""".replace("__SECONDS__", str(seconds)).replace("__AIM__", str(aim_z))
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_pole_met_head_on_knocks_the_walker_round_it() -> None:
    """Walking straight into a pole stopped the walker dead: the slide only tried the world's two
    axes, and the one across the step was no move at all."""
    pole = [2.0, -0.1, 2.2, 0.1]
    head_on = _walk_into(pole)
    assert head_on["x"] > 4.5 and head_on["stuck"] == 0 and not head_on["inside"]
    # Knocked aside, not sent off down the street.
    assert abs(head_on["z"]) < 0.8
    # Off-centre, round the side the walker was already nearer.
    glancing = _walk_into([2.0, -0.05, 2.2, 0.15], aim_z=-0.1)
    assert glancing["x"] > 4.5 and not glancing["inside"]


def test_a_long_fence_is_still_a_wall_not_knocked_round() -> None:
    fence = _walk_into([2.0, -3.0, 2.1, 3.0], seconds=2.0)
    assert fence["x"] < 2.0 and not fence["inside"]
