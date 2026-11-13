"""The arrows steer the walker as a person walks: round a curve as wide as its speed (never a spin
on the spot), Down turning round in about two steps, and the view easing round behind."""

from __future__ import annotations

import json
import math
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _walk(keys: list[str], seconds: float, speed: float = 1.4, eyes: bool = False) -> dict:
    js = _page_js()
    consts = "\n".join(line for line in js.splitlines()
                       if line.startswith(("const WALK_TURN_", "const WALK_SIDE_", "const WALK_BACK_",
                                           "const WALK_VIEW_", "let walkTurnBack")))
    script = consts + """
class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
const THREE = { Vector3 };
const held = new Set(__KEYS__);
const avatar = { rotation: { y: 0 } };
const state = { firstPerson: __EYES__, yaw: Math.PI };
const dragging = false;
const animateAvatar = () => {};
""".replace("__KEYS__", json.dumps(keys)).replace("__EYES__", json.dumps(eyes)) \
        + _extract("walkTurn", js) + _extract("walkSteer", js) + """
let x = 0, z = 0, path = 0, firstStep = null, viewRate = 0, lastYaw = state.yaw;
const dt = 1 / 60, speed = __SPEED__;
for (let t = 0; t < __SECONDS__; t += dt) {
  const s = walkSteer(dt, speed);
  if (!s) continue;
  const d = s.pace * speed * dt;
  x += s.way.x * d; z += s.way.z * d; path += d;
  if (firstStep === null && Math.abs(Math.atan2(Math.sin(avatar.rotation.y - Math.PI), Math.cos(avatar.rotation.y - Math.PI))) < 1e-6) firstStep = t;
  viewRate = Math.max(viewRate, Math.abs(state.yaw - lastYaw) / dt); lastYaw = state.yaw;
}
console.log(JSON.stringify({ x, z, path, yaw: avatar.rotation.y, turnedAt: firstStep, view: state.yaw, viewRate }));
""".replace("__SPEED__", str(speed)).replace("__SECONDS__", str(seconds))
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _radius(keys: list[str], speed: float) -> float:
    """The curve's radius: the distance walked over the angle turned (under half a turn)."""
    arc = _walk(keys, 0.5, speed)
    return arc["path"] / abs(math.atan2(math.sin(arc["yaw"]), math.cos(arc["yaw"])))


def test_left_or_right_alone_walks_a_curve_not_a_spin_on_the_spot() -> None:
    quarter = _walk(["ArrowRight"], 0.5)
    assert quarter["path"] > 0.3, "turning moves the walker forward round the curve"
    assert _radius(["ArrowRight"], 1.4) >= 0.5 - 1e-6


def test_the_turn_is_as_wide_as_the_speed_and_narrower_than_it_was() -> None:
    """The walk's speeds: a stroll, the first-person walk (5.36 m/s) and the street-level orbit
    (8.94 m/s). The radius grows with the speed; on average it is smaller than the curves the
    one turn rate (1.8 rad/s) swept: 0.8, 3.0 and 5.0 m with Up, 1.2, 2.1 and 3.5 m without."""
    speeds = [1.4, 3.0, 5.36, 8.94]
    up = [_radius(["ArrowUp", "ArrowLeft"], v) for v in speeds]
    alone = [_radius(["ArrowLeft"], v) for v in speeds]
    assert up == sorted(up) and alone == sorted(alone), "wider the faster"
    assert up[2] == pytest.approx(0.45 * 5.36, rel=0.05), "in proportion, where it is not held"
    old_up, old_alone = [v / 1.8 for v in (1.4, 5.36, 8.94)], [1.2, 0.7 * 5.36 / 1.8, 0.7 * 8.94 / 1.8]
    assert sum(up[i] for i in (0, 2, 3)) < 0.8 * sum(old_up)
    assert sum(alone[i] for i in (0, 2, 3)) < 0.8 * sum(old_alone)
    assert max(up + alone) <= 3.0 + 1e-6


def test_down_turns_round_in_about_two_steps_on_the_spot() -> None:
    back = _walk(["ArrowDown"], 1.5)
    assert back["turnedAt"] is not None and 0.45 < back["turnedAt"] < 0.75
    turning = _walk(["ArrowDown"], 0.4)
    assert turning["path"] < 0.2, "a pivot, not a wide loop"


def test_the_view_follows_the_turn_slower_than_the_body() -> None:
    """Seen from behind and from the walker's eyes, the view eases round after the turn and never
    swings faster than its most -- it wheeled round with the body, or a step behind it."""
    for eyes, most in ((False, 1.4), (True, 3.0)):
        turn = _walk(["ArrowUp", "ArrowRight"], 0.4, 5.36, eyes)
        facing = turn["yaw"] + math.pi
        lag = abs(math.atan2(math.sin(facing - turn["view"]), math.cos(facing - turn["view"])))
        assert lag > 0.1, "the view comes round behind the body"
        assert turn["viewRate"] <= most + 1e-6
        back = _walk(["ArrowDown"], 2.5, 5.36, eyes)
        assert back["viewRate"] <= most + 1e-6


def test_up_with_a_side_still_walks_the_full_pace_curve() -> None:
    curve = _walk(["ArrowUp", "ArrowLeft"], 0.5)
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
const activeGuest = { ready: true };
""".replace("__POLE__", json.dumps(pole)) + _extract("knockRoundObject", js) + _extract("slidePastObjects", js) + """
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
