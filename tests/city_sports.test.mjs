// People on the courts (docs/city/sports.mjs): the number fits the sport and changes from hour
// to hour, some hours a court is empty, players stay on the court and move as the game does, and
// anyone over waits at the side.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SIDELINE_MAX, SPORTS, courtSession, joinsGame, playPose, playersOf, sidelinePose, sportOf } from "../docs/city/sports.mjs";

const court = (s, l, w, a = 0.4) => ({ x: 100, z: -50, a, l, w, s });
const TENNIS = court("tennis", 23.8, 11), FULL = court("basketball", 28, 15), HALF = court("basketball_half", 12, 11);
//: A point in the court's own axes (u along, v across).
function local(C, x, z) {
  const dx = x - C.x, dz = z - C.z, ux = Math.cos(C.a), uz = -Math.sin(C.a), vx = -Math.sin(C.a), vz = -Math.cos(C.a);
  return [dx * ux + dz * uz, dx * vx + dz * vz];
}

test("an hour on a court is empty or a game of a size the sport has; the sizes vary and are the same for everyone", () => {
  for (const [sport, id] of [["tennis", "court:tennis:a"], ["basketball", "court:basketball:b"], ["basketball_half", "court:basketball_half:c"]]) {
    const sizes = new Map();
    let empty = 0, total = 0;
    for (let day = 0; day < 60; day += 1) for (let h = 8; h < 20; h += 1) {
      const s = courtSession(id, sport, day, h * 60 + 17);
      assert.deepEqual(s, courtSession(id, sport, day, h * 60 + 55), "the whole hour is one game");
      total += 1;
      if (!s.n) { empty += 1; continue; }
      assert.ok(SPORTS[sport].valid.includes(s.n), `${sport} ${s.n}`);
      sizes.set(s.n, (sizes.get(s.n) || 0) + 1);
    }
    assert.ok(empty / total > 0.1 && empty / total < 0.5, `${sport}: empty ${empty} of ${total}`);
    assert.ok(sizes.size >= 3, `${sport}: more than one size of game (${[...sizes.keys()]})`);
  }
  assert.equal(courtSession("c", "tennis", 3, 3 * 60).n, 0, "nobody plays at three in the morning");
  assert.ok(Math.max(...Array.from({ length: 200 }, (_, d) => courtSession("t", "tennis", d, 600).n)) <= 4);
  assert.equal(sportOf("curling"), SPORTS.other);
});

test("of those at a court the game takes a number the sport allows; the rest wait; nobody joins an empty hour", () => {
  assert.equal(playersOf("tennis", 3, 4), 2, "three at tennis: two play");
  assert.equal(playersOf("tennis", 9, 4), 4);
  assert.equal(playersOf("tennis", 9, 2), 2, "a singles hour stays singles");
  assert.equal(playersOf("basketball", 7, 10), 7);
  assert.equal(playersOf("basketball_half", 9, 6), 6);
  assert.equal(playersOf("tennis", 0, 4), 0);
  let joined = 0, asked = 0;
  for (let d = 0; d < 40; d += 1) for (let h = 8; h < 20; h += 1) for (let p = 0; p < 5; p += 1) {
    const ok = joinsGame("court:t", "tennis", d, h * 60, `p${p}`);
    if (!courtSession("court:t", "tennis", d, h * 60).n) assert.equal(ok, false);
    asked += 1; joined += ok ? 1 : 0;
  }
  assert.ok(joined > asked * 0.25 && joined < asked * 0.75);
});

test("players stay on their court and on their own side of the net, and the game moves them", () => {
  for (const n of [1, 2, 4]) {
    const seen = Array.from({ length: n }, () => ({ minV: Infinity, maxV: -Infinity, swings: 0 }));
    for (let sec = 36000; sec < 36000 + 240; sec += 0.25) for (let i = 0; i < n; i += 1) {
      const p = playPose(TENNIS, n, i, sec, "k");
      const [u, v] = local(TENNIS, p.x, p.z);
      assert.ok(Math.abs(u) <= TENNIS.l / 2 + 0.01 && Math.abs(v) <= TENNIS.w / 2 + 0.01, `on the court: ${u}, ${v}`);
      if (n > 1) assert.equal(Math.sign(u), i % 2 ? 1 : -1, "never across the net");
      assert.ok(p.speed < 9, `no faster than a sprint: ${p.speed}`);
      seen[i].minV = Math.min(seen[i].minV, v); seen[i].maxV = Math.max(seen[i].maxV, v);
      if (p.gesture) seen[i].swings += 1;
    }
    for (const s of seen) assert.ok(s.swings > 0, "everyone swings or serves");
    if (n > 1) assert.ok(seen.some((s) => s.maxV - s.minV > 3), "the rally moves them across the court");
  }
});

test("basketball: alone they shoot around; a game goes end to end on a full court and stays at the one hoop on a half", () => {
  const solo = [];
  for (let sec = 0; sec < 60; sec += 0.25) solo.push(playPose(HALF, 1, 0, 40000 + sec, "k"));
  assert.ok(solo.some((p) => p.gesture?.kind === "shoot") && solo.some((p) => p.moving) && solo.some((p) => !p.moving));
  let left = 0, right = 0, shots = 0, guards = 0;
  for (let sec = 0; sec < 120; sec += 0.25) for (let i = 0; i < 6; i += 1) {
    const p = playPose(FULL, 6, i, 50000 + sec, "g");
    const [u, v] = local(FULL, p.x, p.z);
    assert.ok(Math.abs(u) <= FULL.l / 2 + 0.01 && Math.abs(v) <= FULL.w / 2 + 0.01);
    assert.ok(p.speed < 11, `${p.speed}`);
    if (u < -3) left += 1; if (u > 3) right += 1;
    if (p.gesture?.kind === "shoot") shots += 1; if (p.gesture?.kind === "guard") guards += 1;
  }
  assert.ok(left > 200 && right > 200, "both ends of the court are played at");
  assert.ok(shots > 0 && guards > 0);
  for (let sec = 0; sec < 60; sec += 0.5) for (let i = 0; i < 4; i += 1) {
    const [u, v] = local(HALF, ...Object.values(playPose(HALF, 4, i, 52000 + sec, "h")).slice(0, 2));
    assert.ok(Math.abs(u) <= HALF.l / 2 + 0.01 && Math.abs(v) <= HALF.w / 2 + 0.01);
  }
  // Two players are never on the same spot.
  for (let sec = 0; sec < 30; sec += 1) {
    const at = Array.from({ length: 6 }, (_, i) => playPose(FULL, 6, i, 50000 + sec, "g"));
    for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) assert.ok(Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z) > 0.15, `${i} and ${j} at ${sec}`);
  }
});

test("those waiting stand outside the lines, facing the game", () => {
  for (let k = 0; k < SIDELINE_MAX; k += 1) {
    const p = sidelinePose(TENNIS, k, `p${k}`);
    const [u, v] = local(TENNIS, p.x, p.z);
    assert.ok(Math.abs(v) > TENNIS.w / 2 + 0.5 && Math.abs(u) < TENNIS.l / 2);
    assert.equal(p.moving, false);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    assert.ok(fx * (TENNIS.x - p.x) + fz * (TENNIS.z - p.z) > 0, "facing the court");
  }
});
