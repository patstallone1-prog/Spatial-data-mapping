// Nobody walks backwards (docs/city/stride.mjs): a body that turns round and steps the way it faces.
import assert from "node:assert/strict";
import test from "node:test";
import { STRIDE, strideStep } from "../docs/city/stride.mjs";

const fwd = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
//: Runs a person whose place goes ``path(t)`` for ``secs``, returns each frame's body and step.
function run(path, secs, { dt = 1 / 60, speed = 1.35, start } = {}) {
  let st = start ? { ...start } : null;
  const frames = [];
  for (let t = 0; t <= secs; t += dt) {
    const e = path(t);
    const was = st ? { x: st.x, z: st.z } : null;
    st = strideStep(st, { moving: true, speed, ...e }, dt, speed);
    if (was) frames.push({ t, st: { ...st }, mx: st.x - was.x, mz: st.z - was.z });
  }
  return frames;
}

test("a walker going straight faces the way they go and keeps up", () => {
  const f = run((t) => ({ x: 0, z: -1.35 * t, yaw: 0 }), 5);
  const last = f.at(-1);
  assert.ok(Math.abs(last.st.yaw) < 0.05);
  assert.ok(Math.hypot(last.st.x, last.st.z + 1.35 * 5) < 0.6, "within a stride of where they are");
});

test("never a step backwards or sideways: every step is along the way the body faces", () => {
  // Their place doubles back half way (a crossing's path turning back, a detour undone).
  const f = run((t) => ({ x: 0, z: t < 3 ? -1.35 * t : -1.35 * 3 + 1.35 * (t - 3), yaw: t < 3 ? 0 : Math.PI }), 7);
  for (const q of f) {
    const m = Math.hypot(q.mx, q.mz);
    if (m < 1e-4) continue;
    const [fx, fz] = fwd(q.st.yaw);
    assert.ok((q.mx * fx + q.mz * fz) / m > 0.999, `at ${q.t.toFixed(2)} s a step ${(q.mx * fx + q.mz * fz) / m} off the facing`);
  }
  // They stopped, turned round and went back.
  const back = f.at(-1);
  assert.ok(Math.abs(Math.abs(back.st.yaw) - Math.PI) < 0.1, `facing ${back.st.yaw}`);
  assert.ok(back.st.z > -1.35 * 3 + 2, "on their way back");
  const slowest = Math.min(...f.filter((q) => q.t > 3 && q.t < 4.5).map((q) => q.st.v));
  assert.ok(slowest < STRIDE.pivot_below_ms, "nearly stopped to turn round");
});

test("the faster they go, the wider they turn", () => {
  const rate = (v) => {
    // Going -z at speed v; their place turns a right angle to +x.
    const st = { x: 0, z: 0, yaw: 0, v };
    const after = strideStep({ ...st }, { x: 3, z: 0, yaw: -Math.PI / 2, moving: true, speed: v }, 0.1, v);
    return Math.abs(after.yaw) / 0.1;
  };
  const walk = rate(1.35), run_ = rate(3.5);
  assert.ok(walk / 1.35 > run_ / 3.5, "turn radius widens with speed");
  assert.ok(rate(0.1) >= STRIDE.pivot_rad_s - 1e-9, "on the spot when nearly stopped");
});

test("someone far from their body (a teleport, just come into view) is put there", () => {
  const st = strideStep({ x: 0, z: 0, yaw: 0, v: 1 }, { x: 20, z: 0, yaw: 1, moving: true }, 1 / 60);
  assert.deepEqual([st.x, st.z, st.yaw], [20, 0, 1]);
});
