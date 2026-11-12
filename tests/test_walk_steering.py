"""The arrows steer the walker as a person walks: Left or Right alone walks a tight curve (never
a spin on the spot), and Down turns round in about one step."""

from __future__ import annotations

import json
import math
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _walk(keys: list[str], seconds: float, speed: float = 1.4) -> dict:
    js = _page_js()
    consts = "\n".join(line for line in js.splitlines()
                       if line.startswith(("const WALK_TURN_RATE", "const WALK_SIDE_", "const WALK_BACK_",
                                           "const WALK_VIEW_FOLLOW", "let walkTurnBack")))
    script = consts + """
class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
const THREE = { Vector3 };
const held = new Set(__KEYS__);
const avatar = { rotation: { y: 0 } };
const state = { firstPerson: false, yaw: Math.PI };
const dragging = false;
const animateAvatar = () => {};
""".replace("__KEYS__", json.dumps(keys)) + _extract("walkSteer", js) + """
let x = 0, z = 0, path = 0, firstStep = null;
const dt = 1 / 60, speed = __SPEED__;
for (let t = 0; t < __SECONDS__; t += dt) {
  const s = walkSteer(dt, speed);
  if (!s) continue;
  const d = s.pace * speed * dt;
  x += s.way.x * d; z += s.way.z * d; path += d;
  if (firstStep === null && Math.abs(Math.atan2(Math.sin(avatar.rotation.y - Math.PI), Math.cos(avatar.rotation.y - Math.PI))) < 1e-6) firstStep = t;
}
console.log(JSON.stringify({ x, z, path, yaw: avatar.rotation.y, turnedAt: firstStep }));
""".replace("__SPEED__", str(speed)).replace("__SECONDS__", str(seconds))
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_left_or_right_alone_walks_a_curve_not_a_spin_on_the_spot() -> None:
    quarter = _walk(["ArrowRight"], 0.5)
    assert quarter["path"] > 0.3, "turning moves the walker forward round the curve"
    # The curve's radius: the distance walked over the angle turned (under half a turn here).
    arc = _walk(["ArrowRight"], 1.0)
    turned = abs(math.atan2(math.sin(arc["yaw"]), math.cos(arc["yaw"])))
    assert 0.9 < arc["path"] / turned < 1.6


def test_down_turns_round_in_about_one_step_on_the_spot() -> None:
    back = _walk(["ArrowDown"], 1.0)
    assert back["turnedAt"] is not None and back["turnedAt"] < 0.45
    turning = _walk(["ArrowDown"], 0.3)
    assert turning["path"] < 0.2, "a pivot, not a wide loop"


def test_up_with_a_side_still_walks_the_full_pace_curve() -> None:
    curve = _walk(["ArrowUp", "ArrowLeft"], 0.5)
    assert curve["path"] == pytest.approx(0.7, abs=0.05)
