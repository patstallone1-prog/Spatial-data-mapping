// The body's moves (docs/city/body-moves.mjs): a jump bends down before it goes up, a punch is a
// straight blow from a guard, a held swing winds up and comes through the target -- and none of
// them jumps from one pose to another between two frames.
import test from "node:test";
import assert from "node:assert/strict";
import { JUMP, PUNCH, SWING, jumpAir, jumpCrouch, jumpGrab, jumpLand, punchPose, swingPose } from "../docs/city/body-moves.mjs";

const samples = (f, n = 100) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const smooth = (poses, keys, most) => {
  for (let i = 1; i < poses.length; i += 1) for (const k of keys) {
    const step = Math.abs(poses[i][k] - poses[i - 1][k]);
    assert.ok(step < most, `${k} jumps ${step.toFixed(3)} between samples ${i - 1} and ${i}`);
  }
};

test("a jump bends down into the knees, arms back, before it leaves the ground", () => {
  const start = jumpCrouch(0, 0.4), bottom = jumpCrouch(1, 0.4);
  assert.equal(start.drop, 0);
  assert.ok(bottom.drop >= 0.12 && bottom.drop <= 0.26, `crouch drop ${bottom.drop}`);
  assert.ok(bottom.thigh > 0.4 && bottom.shin < -0.7, "the knees bend");
  assert.ok(bottom.upper < -0.5, "the arms go back");
  assert.ok(jumpCrouch(1, 0.6).drop > jumpCrouch(1, 0.1).drop, "a bigger jump loads deeper");
  assert.ok(JUMP.crouch_s >= 0.15 && JUMP.crouch_s <= 0.35);
  smooth(samples((t) => jumpCrouch(t, 0.4)), ["drop", "thigh", "shin", "upper"], 0.08);
});

test("in the air the arms come up through take-off and the knees lift at the top", () => {
  const off = jumpAir(1), top = jumpAir(0), down = jumpAir(-1);
  assert.ok(off.upper > 1.0, "arms swung up at take-off");
  assert.ok(Math.abs(off.thigh) < 0.05, "legs straight leaving the ground");
  assert.ok(top.thigh > 0.4 && top.shin < -0.6, "knees up at the top");
  assert.ok(down.thigh > 0.1 && down.upper < off.upper, "reaching for the ground, arms lower");
});

test("the landing gives at the knees and stands back up", () => {
  const most = Math.max(...samples((t) => jumpLand(t, 0.5).drop));
  assert.ok(most > 0.1, `landing give ${most}`);
  assert.ok(jumpLand(1, 0.5).drop < 1e-6, "stood up again");
  smooth(samples((t) => jumpLand(t, 0.5)), ["drop", "thigh", "shin"], 0.12);
});

test("a jump onto a fence reaches both hands high to grab it", () => {
  const grab = jumpGrab(1, 0.6);
  assert.ok(grab.upper > 2.6, "the arms overhead at the grab");
  assert.ok(grab.both);
  assert.ok(jumpGrab(0.5).thigh > 0.3, "the knees up as it flies");
});

test("an empty-handed X is a straight punch from a guard, fast out and slower back", () => {
  const guard = punchPose(0), hit = punchPose(PUNCH.hit, Math.PI / 2), end = punchPose(1);
  assert.ok(guard.rFore > 1.6 && guard.lFore > 1.6, "both fists up at the chin");
  assert.ok(Math.abs(hit.rUpper - Math.PI / 2) < 0.05, "the arm out at the target's height");
  assert.ok(hit.rFore < 0.2, "the elbow straight at the blow");
  assert.ok(hit.twist < -0.3, "the shoulder turned into it");
  assert.ok(Math.abs(end.rFore - guard.rFore) < 0.05 && Math.abs(end.rUpper - guard.rUpper) < 0.05, "back to the guard");
  assert.ok(end.lFore > 1.6, "the other hand stays up");
  assert.ok(PUNCH.hit < 0.5, "out faster than back");
  assert.ok(PUNCH.dur_s <= 0.45);
  // A low target: the fist goes out lower, never down at the feet.
  assert.ok(punchPose(PUNCH.hit, 0.3).rUpper >= 0.9);
  smooth(samples((t) => punchPose(t)), ["rUpper", "rFore", "twist"], 0.25);
});

test("a held swing winds up over the shoulder and comes through the target", () => {
  const top = swingPose(0.38, 1.2), hit = swingPose(SWING.hit, 1.2), on = swingPose(0.78, 1.2), end = swingPose(1, 1.2);
  assert.ok(top.rUpper > 2.4 && top.twist > 0.4, "wound up, shoulders turned away");
  assert.ok(Math.abs(hit.rUpper - 1.2) < 0.05, "at the target's height at the blow");
  assert.ok(hit.twist < 0 && hit.lean < -0.1, "turned through and into it");
  assert.ok(on.rUpper < hit.rUpper && on.twist < hit.twist, "follows through past the target");
  assert.ok(Math.abs(end.twist) < 1e-6 && Math.abs(end.lean) < 1e-6, "recovered");
  assert.ok(SWING.dur_s > PUNCH.dur_s, "a swing takes longer than a punch");
  const two = swingPose(0.38, 1.2, true);
  assert.ok(two.lUpper > 2.0, "both hands on a two-handed swing");
  smooth(samples((t) => swingPose(t, 1.2)), ["rUpper", "rFore", "twist", "lean"], 0.3);
});
