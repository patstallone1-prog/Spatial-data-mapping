// The people near you move like people (docs/city/clips.mjs): walks and runs whose feet stay put
// on the pavement, everyday actions that stay inside what a body can do, and a person's movement
// that changes from one thing to the next without a jerk.
import assert from "node:assert/strict";
import test from "node:test";
import { CLIPS, FADE_S, blendPose, GAITS, HIP, LIMITS, POSE_CHANNELS, REST, cadence, clipFor, gaitFor, makeBlend, newPose, sampleClip, stepBlend, strideLength, sweepOf } from "../docs/city/clips.mjs";

const NAMES = Object.keys(CLIPS);
const LOCO = NAMES.filter((n) => CLIPS[n].locomotion);
const at = (name, phase) => sampleClip(name, phase, newPose());
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy || 1);
};
const range = (name, ch) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < 200; i += 1) { const v = at(name, i / 200)[ch]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };

test("a pose has the twelve channels and starts at rest", () => {
  assert.equal(POSE_CHANNELS.length, 12);
  assert.deepEqual(newPose(), { ...REST });
  for (const c of POSE_CHANNELS) assert.ok(LIMITS[c][0] <= REST[c] && REST[c] <= LIMITS[c][1], c);
  for (const n of ["walk", "stroll", "brisk", "jog", "run", "walk_phone", "walk_text", "walk_carry", "walk_bag", "limp", "idle", "wait", "talk", "phone", "film", "watch", "wave", "hail", "cower", "help", "sit", "sit_phone", "lean_wall", "startle", "sidestep"]) assert.ok(CLIPS[n], n);
});

test("every clip stays inside what a body can do, at 200 points through it", () => {
  for (const n of NAMES) for (let i = 0; i <= 200; i += 1) {
    const p = at(n, i / 200);
    for (const c of POSE_CHANNELS) {
      assert.ok(Number.isFinite(p[c]), `${n} ${c}`);
      assert.ok(p[c] >= LIMITS[c][0] - 1e-9 && p[c] <= LIMITS[c][1] + 1e-9, `${n} ${c} ${p[c]} at ${i / 200}`);
    }
  }
});

test("nobody's foot goes more than 2 cm into the ground while standing, sitting or crouching", () => {
  for (const n of NAMES.filter((x) => !CLIPS[x].locomotion)) for (let i = 0; i < 200; i += 1) {
    const p = at(n, i / 200), hip = HIP + p.bob;
    for (const leg of [p.legL, p.legR]) assert.ok(hip - HIP * Math.cos(leg) > -0.02, `${n} at ${i / 200}: ${hip - HIP * Math.cos(leg)}`);
  }
});

test("a looping clip has no pop at the loop point: the same value and slope either side of it", () => {
  const h = 1e-4;
  for (const n of NAMES.filter((x) => CLIPS[x].loop)) {
    const z = at(n, 0), end = at(n, 1 - 1e-9), r = at(n, h), l = at(n, 1 - h), mid = at(n, 0.5);
    for (const c of POSE_CHANNELS) {
      assert.ok(Math.abs(end[c] - z[c]) < 1e-6, `${n} ${c} value ${end[c]} vs ${z[c]}`);
      const right = (r[c] - z[c]) / h, left = (z[c] - l[c]) / h;
      assert.ok(Math.abs(right - left) < 0.05 * (1 + Math.abs(right)), `${n} ${c} slope ${left} vs ${right}`);
      assert.ok(Number.isFinite(mid[c]));
    }
  }
});

test("the curves are smooth everywhere, not just at the loop: no step between neighbouring samples", () => {
  for (const n of NAMES) for (let i = 0; i < 2000; i += 1) {
    const a = at(n, i / 2000), b = at(n, (i + 1) / 2000);
    for (const c of POSE_CHANNELS) assert.ok(Math.abs(b[c] - a[c]) < 0.03, `${n} ${c} at ${i / 2000}`);
  }
});

test("walking, the legs take turns and the arms swing against them unless the hand holds something", () => {
  for (const n of LOCO) {
    const L = [], R = [], AL = [], AR = [];
    for (let i = 0; i < 200; i += 1) { const p = at(n, i / 200); L.push(p.legL); R.push(p.legR); AL.push(p.armL); AR.push(p.armR); }
    assert.ok(corr(L, R) < -0.8, `${n} legs alternate: ${corr(L, R)}`);
    if (n !== "limp") for (let i = 0; i < 200; i += 1) assert.ok(Math.abs(at(n, i / 200).legR - at(n, i / 200 + 0.5).legL) < 1e-9, `${n} legR is legL half a cycle on`);
    if (!CLIPS[n].holds.includes("armL")) assert.ok(corr(AL, L) < -0.8, `${n} left arm against the left leg: ${corr(AL, L)}`);
    if (!CLIPS[n].holds.includes("armR")) assert.ok(corr(AR, R) < -0.8, `${n} right arm against the right leg: ${corr(AR, R)}`);
  }
  assert.deepEqual([...CLIPS.walk_phone.holds], ["armR"]);
  assert.deepEqual([...CLIPS.walk_carry.holds], ["armL", "armR"]);
});

test("from a stroll to a run the stride, the arms, the lean and the bounce all grow, and a run bounces twice a stride", () => {
  const order = ["stroll", "walk", "brisk", "jog", "run"];
  for (const ch of ["legL", "armL", "bob"]) for (let i = 1; i < order.length; i += 1) assert.ok(range(order[i], ch) > range(order[i - 1], ch), `${ch}: ${order[i - 1]} < ${order[i]}`);
  for (let i = 1; i < order.length; i += 1) assert.ok(at(order[i], 0.3).lean > at(order[i - 1], 0.3).lean, `lean ${order[i]}`);
  for (const n of order) {
    let peaks = 0;
    for (let i = 0; i < 400; i += 1) { const a = at(n, (i - 1) / 400).bob, b = at(n, i / 400).bob, c = at(n, (i + 1) / 400).bob; if (b > a && b >= c) peaks += 1; }
    assert.equal(peaks, 2, `${n} bob peaks`);
  }
  // A runner's arms are carried forward (bent), not hanging.
  assert.ok(at("run", 0).armL + at("run", 0.4).armL < 2 * -0.3);
});

test("the planted foot does not slide: over its stance it moves less than 1 cm, for heights 1.5-1.95 m and speeds 0.6-5 m/s", () => {
  for (const n of LOCO) {
    const sw = sweepOf(n);
    for (const height of [1.5, 1.62, 1.75, 1.85, 1.95]) for (const speed of [0.6, 1, 1.35, 1.8, 2.5, 3.6, 5]) {
      const f = cadence(n, speed, height), L = HIP * height / 1.75;
      assert.ok(Math.abs(f * strideLength(n, height) - speed) < 1e-9, "cadence x stride is the speed");
      // The foot in the world along the heading: the hips carried forward at speed, the foot
      // behind them by L sin(leg). Walked through the stance in 400 steps, from foot-down to foot-up.
      let t = 0, phase = sw.from;
      const start = -L * Math.sin(at(n, phase).legL);
      for (let i = 0; i < 400; i += 1) { t += sw.duty / f / 400; phase = sw.from + t * f; }
      const end = speed * t - L * Math.sin(at(n, phase).legL);
      assert.ok(Math.abs(end - start) < 0.01, `${n} ${height} m ${speed} m/s: ${end - start}`);
    }
  }
  // Taller people take longer strides and so fewer of them.
  assert.ok(cadence("walk", 1.35, 1.95) < cadence("walk", 1.35, 1.5));
  // A sensible walk: about one stride a second at 1.35 m/s, a run under two a second at 5 m/s.
  assert.ok(Math.abs(cadence("walk", 1.35, 1.75) - 1) < 0.1);
  assert.ok(cadence("run", 5, 1.75) > 1.4 && cadence("run", 5, 1.75) < 2.1);
  // A standing clip goes round once in its length.
  assert.equal(cadence("idle"), 1 / CLIPS.idle.duration_s);
});

test("faster never means a slower gait", () => {
  let last = 0;
  for (let v = 0; v <= 8; v += 0.01) { const r = GAITS.indexOf(gaitFor(v)); assert.ok(r >= last, `${v}`); last = r; }
  assert.equal(gaitFor(0.5), "stroll"); assert.equal(gaitFor(1.35), "walk"); assert.equal(gaitFor(1.9), "brisk"); assert.equal(gaitFor(3), "jog"); assert.equal(gaitFor(5), "run");
});

const MAX_STEP = { rad: 0.25, m: 0.03 };
const jump = (a, b) => { let r = 0, m = 0; for (const c of POSE_CHANNELS) { const d = Math.abs(a[c] - b[c]); if (c === "sway" || c === "bob") m = Math.max(m, d); else r = Math.max(r, d); } return [r, m]; };

test(`changing what someone does cross-fades: no change bigger than ${MAX_STEP.rad} rad or ${MAX_STEP.m * 100} cm in a 1/60 s frame`, () => {
  const dt = 1 / 60, pairs = [["walk", "sit"], ["run", "idle"], ["idle", "run"], ["sit", "hail"], ["talk", "cower"], ["walk", "jog"], ["help", "walk_text"], ["wave", "lean_wall"]];
  for (const [a, b] of pairs) {
    const st = makeBlend(), out = newPose(), prev = newPose(), opts = { speed: 1.35, height: 1.75, seed: 7 };
    for (let i = 0; i < 90; i += 1) { opts.speed = CLIPS[a].locomotion ? (a === "run" ? 4.5 : 1.35) : 0; stepBlend(st, a, dt, out, opts); }
    for (let i = 0; i < 90; i += 1) {
      Object.assign(prev, out);
      opts.speed = b === "run" ? 4.5 : b === "jog" ? 2.6 : 1.35;
      stepBlend(st, b, dt, out, opts);
      const [r, m] = jump(prev, out);
      assert.ok(r <= MAX_STEP.rad && m <= MAX_STEP.m, `${a} -> ${b} frame ${i}: ${r} rad ${m} m`);
    }
    // Then it is the new clip.
    assert.equal(st.cur, b); assert.equal(st.fade, 1);
  }
  // Changing again half way through a fade starts from where it got to.
  const st = makeBlend(), out = newPose(), prev = newPose(), opts = { seed: 3, speed: 1.35, height: 1.75 };
  for (let i = 0; i < 60; i += 1) stepBlend(st, "walk", dt, out, opts);
  for (let i = 0; i < 7; i += 1) stepBlend(st, "sit", dt, out, opts);
  Object.assign(prev, out); stepBlend(st, "hail", dt, out, opts);
  const [r] = jump(prev, out); assert.ok(r <= MAX_STEP.rad, `mid-fade switch ${r}`);
  assert.ok(FADE_S > 0.15 && FADE_S < 0.4);
});

test("a startle plays once over what was underneath and then lets go", () => {
  const dt = 1 / 60, opts = { seed: 5, speed: 0, height: 1.7 };
  const A = makeBlend(), B = makeBlend(), pa = newPose(), pb = newPose();
  for (let i = 0; i < 60; i += 1) { stepBlend(A, "idle", dt, pa, opts); stepBlend(B, "idle", dt, pb, opts); }
  let differs = 0;
  for (let i = 0; i < 120; i += 1) {
    stepBlend(A, "startle", dt, pa, opts); stepBlend(B, "idle", dt, pb, opts);
    const [r] = jump(pa, pb);
    if (i * dt < CLIPS.startle.duration_s - 0.1) { if (r > 0.3) differs += 1; }
    else if (i * dt > CLIPS.startle.duration_s + dt) assert.ok(r < 1e-9, `back to idle at ${i}: ${r}`);
  }
  assert.ok(differs > 10, "the arms went up");
  assert.equal(A.shot, null); assert.equal(A.cur, "idle");
  // Asked for again it plays again only after something else was asked for.
  stepBlend(A, "idle", dt, pa, opts); stepBlend(A, "startle", dt, pa, opts); assert.equal(A.shot, "startle");
  // Laid over a walk: the legs keep walking.
  const W = makeBlend(), pw = newPose(), wopts = { seed: 5, speed: 1.35, height: 1.75 };
  for (let i = 0; i < 30; i += 1) stepBlend(W, "walk", dt, pw, wopts);
  const legs = [];
  for (let i = 0; i < 30; i += 1) { stepBlend(W, "startle", dt, pw, wopts); legs.push(pw.legL); }
  assert.ok(Math.max(...legs) - Math.min(...legs) > 0.1);
});

test("every pose stepBlend writes is inside the limits, even with a one-shot laid over a run", () => {
  const st = makeBlend(), out = newPose(), opts = { seed: 9, speed: 5, height: 1.9 };
  for (let i = 0; i < 600; i += 1) {
    stepBlend(st, i % 120 < 60 ? "run" : i % 120 === 60 ? "startle" : "cower", 1 / 60, out, opts);
    for (const c of POSE_CHANNELS) assert.ok(out[c] >= LIMITS[c][0] && out[c] <= LIMITS[c][1], `${c} ${out[c]}`);
  }
});

test("clipFor reads each thing a person can be doing, and leaves the falls, rides and sports to view.mjs", () => {
  const still = (activity, extra = {}) => clipFor({ moving: false, activity, ...extra }, 1);
  const going = (activity, speed = 1.35, extra = {}) => clipFor({ moving: true, speed, activity, ...extra }, 1);
  assert.equal(still("talking with you"), "talk");
  assert.equal(still("waiting to cross"), "wait");
  assert.equal(still("getting out of the way"), "sidestep");
  assert.equal(still("running from it"), "cower");
  assert.ok(["jog", "run"].includes(going("running from it")));
  assert.equal(going("running from it", 5), "run");
  assert.equal(still("going to help"), "help");
  assert.ok(["brisk", "jog", "run"].includes(going("going to help", 1.2)));
  assert.equal(still("helping"), "help");
  assert.equal(still("calling 911"), "phone");
  assert.equal(going("calling 911"), "walk_phone");
  assert.equal(still("filming it"), "film");
  assert.equal(still("watching"), "watch");
  assert.ok(["sit", "sit_phone"].includes(still("Lunch at the cafe on Chestnut")));
  assert.ok(["sit", "sit_phone"].includes(still("having breakfast")));
  assert.ok(["idle", "lean_wall"].includes(still("on a break")));
  assert.ok(["idle", "sit"].includes(still("work at the bank", { indoors: "bank" })));
  assert.ok(["idle", "watch", "phone"].includes(still("something nobody planned for")));
  assert.ok(["idle", "watch", "phone"].includes(still(undefined)));
  // Gestures: the sports are view.mjs's own; a phone or a camera is a clip.
  for (const kind of ["shoot", "serve", "swing", "guard"]) assert.equal(clipFor({ moving: false, gesture: { kind, f: 0.3 } }), null);
  assert.equal(clipFor({ moving: false, gesture: { kind: "phone" } }), "phone");
  assert.equal(clipFor({ moving: true, gesture: { kind: "phone" } }), "walk_phone");
  assert.equal(clipFor({ moving: false, gesture: { kind: "film" } }), "film");
  // Lying hurt or riding: none.
  assert.equal(clipFor({ down: true, moving: false }), null);
  assert.equal(clipFor({ ride: "bike", moving: true, speed: 4 }), null);
  // Walking: by speed (or the person's pace), hurt or carrying.
  assert.equal(clipFor({ moving: true, speed: 5 }, 1), "run");
  assert.equal(clipFor({ moving: true, speed: 3 }, 1), "jog");
  assert.equal(clipFor({ moving: true, injured: true, speed: 1.2 }, 1), "limp");
  assert.equal(clipFor({ moving: true, carrying: true, speed: 1.2 }, 1), "walk_carry");
  const walkers = Array.from({ length: 4000 }, (_, i) => clipFor({ moving: true, person: { pace: 1.35 } }, i * 2654435761));
  for (const c of walkers) assert.ok(CLIPS[c]?.locomotion, c);
  const onPhone = walkers.filter((c) => c === "walk_phone" || c === "walk_text").length / walkers.length;
  assert.ok(onPhone > 0.09 && onPhone < 0.16, `one walker in eight on their phone: ${onPhone}`);
  assert.ok(walkers.includes("walk_bag") && walkers.includes("walk"));
  // The same person the same way every time; people stand about differently.
  for (let i = 0; i < 200; i += 1) assert.equal(clipFor({ moving: false, seed: i }), clipFor({ moving: false, seed: i }));
  const standers = new Set(Array.from({ length: 200 }, (_, i) => clipFor({ moving: false, seed: i * 7919 })));
  assert.ok(standers.size >= 3, [...standers].join());
  for (const n of [...standers, ...walkers]) assert.ok(CLIPS[n]);
});

test("people idle differently: the same seed the same movement, different seeds out of step", () => {
  const go = (seed) => { const st = makeBlend(), out = newPose(); for (let i = 0; i < 100; i += 1) stepBlend(st, "idle", 1 / 60, out, { seed }); return { ...out }; };
  assert.deepEqual(go(42), go(42));
  const poses = Array.from({ length: 12 }, (_, i) => go(i * 101 + 1));
  const sways = new Set(poses.map((p) => p.sway.toFixed(4)));
  assert.ok(sways.size > 8, `${sways.size} different`);
  const turned = poses.filter((p) => Math.abs(p.headYaw) > 0.05).length;
  assert.ok(turned > 0 && turned < poses.length, "some are looking aside, not all");
});

test("the per-frame functions write into the pose they are given and allocate nothing to speak of", () => {
  const out = newPose(), st = makeBlend(), opts = { speed: 1.35, height: 1.75, seed: 1 }, entry = { moving: true, speed: 1.3, activity: "walking to work", seed: 3 };
  assert.equal(sampleClip("walk", 0.3, out), out);
  assert.equal(stepBlend(st, "walk", 1 / 60, out, opts), out);
  const a = newPose(), b = newPose();
  assert.equal(blendPose(a, b, 0.5, out), out);
  const names = NAMES;
  for (let i = 0; i < 5000; i += 1) { sampleClip(names[i % names.length], i / 977, out); stepBlend(st, names[(i >> 7) % names.length], 1 / 60, out, opts); clipFor(entry); }
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i += 1) {
    sampleClip(names[i % names.length], i / 977, out);
    stepBlend(st, names[(i >> 7) % names.length], 1 / 60, out, opts);
    clipFor(entry);
  }
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(grown < 32 * 1024 * 1024, `heap grew ${grown} bytes`);
  for (const c of POSE_CHANNELS) assert.ok(Number.isFinite(out[c]));
});
