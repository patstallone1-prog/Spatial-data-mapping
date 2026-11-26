"""A kerb is stepped up in a stride, not jumped (2026-11-25).

``stepAhead`` (module 26) finds a step in the walker's way: a rise up to STEP_UP_MAX_M (down to
STEP_DOWN_MAX_M) that is level again beyond -- a kerb, a doorstep -- and where its edge is. A
slope is not a step, nor a wall. ``walkPace`` returns it at STEP_PACE (never blocked), the stair
clip plays a stride of it, and the figure is carried up over STEP_EASE_S.
"""
import json
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")


def run(script: str):
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_kerb_is_a_step_a_slope_and_a_wall_are_not() -> None:
    js = _page_js()
    out = run("\n".join([
        "const STEP_MIN_M = 0.05, STEP_UP_MAX_M = 0.55, STEP_DOWN_MAX_M = 0.7, STEP_LEVEL_M = 0.1, PACE_PROBE_M = 0.6;",
        "let ground = () => 0;",
        "function walkerGroundInfo(x, z) { return { y: ground(x, z), kind: 'terrain' }; }",
        _extract("stepAhead", js),
        "const move = { x: 1, z: 0 }, at = (x) => ({ y: ground(x, 0), kind: 'terrain' });",
        "const res = {};",
        # A kerb 0.15 m high 0.32 m ahead.
        "ground = (x) => (x >= 0.32 ? 0.15 : 0); res.kerb = stepAhead(0, 0, move, at(0), at(0.6));",
        # A tall San Francisco kerb on a hill, 0.5 m: still a step.
        "ground = (x) => (x >= 0.2 ? 0.5 : 0); res.tall = stepAhead(0, 0, move, at(0), at(0.6));",
        # Down off the kerb.
        "ground = (x) => (x >= 0.25 ? -0.18 : 0); res.down = stepAhead(0, 0, move, at(0), at(0.6));",
        # A steep slope: rising all the way, so not level beyond.
        "ground = (x) => x * 0.6; res.slope = stepAhead(0, 0, move, at(0), at(0.6));",
        # A wall-high rise is not stepped.
        "ground = (x) => (x >= 0.3 ? 0.9 : 0); res.wall = stepAhead(0, 0, move, at(0), at(0.6));",
        # Level ground.
        "ground = () => 0; res.level = stepAhead(0, 0, move, at(0), at(0.6));",
        "console.log(JSON.stringify(res));",
    ]))
    assert out["kerb"]["rise"] == pytest.approx(0.15) and 0.25 <= out["kerb"]["edge"] <= 0.45
    assert out["tall"]["rise"] == pytest.approx(0.5)
    assert out["down"]["rise"] == pytest.approx(-0.18)
    assert out["slope"] is None and out["wall"] is None and out["level"] is None


def test_walk_pace_steps_a_kerb_and_the_figure_is_carried_up() -> None:
    js = _page_js()
    pace = js[js.index("function walkPace("):]
    pace = pace[:pace.index("\nfunction ")]
    assert "const step = !crossing && !stairs ? stepAhead(x, z, move, here, ahead) : null;" in pace
    assert "if (step) return { factor: STEP_PACE, stairs: false, grade: 0, step };" in pace
    # Before the slope rule (which turned a walker along anything steeper than it).
    assert pace.index("if (step) return") < pace.index("MAX_WALK_GRADE")
    assert "if (pace.step) walkerStepAhead(pace.step);" in js
    assert "walkerStepShown(groundY, moving);" in js
    assert "if (model) walkerStepLift(model);" in js
    # Stairs play the stair clip (motion capture) where it is loaded.
    assert 'setAvatarAction((avatar.userData.grade || 0) >= 0 ? "StairsUp" : "StairsDown")' in js


def test_the_stair_clips_are_built_for_every_body() -> None:
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    moves = json.loads((root / "docs/city/models/moves/moves.json").read_text())
    for body, target in moves["targets"].items():
        assert {"StairsUp", "StairsDown"} <= set(target["moves"]), body
        assert target["moves"]["StairsUp"]["loops"] is True
        assert (root / "docs/city/models/moves" / target["file"]).stat().st_size == target["bytes"]
