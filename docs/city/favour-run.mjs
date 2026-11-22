// A favour being done, as you see it (npc-favours.mjs decides it; this walks it): the one who said
// yes steps aside, waits, or comes along with you -- carrying, beside you -- then goes back to
// their day, the time it took them lost from it (their walk held the while: view.mjs holdWalk,
// so they arrive late where they were going). Done, the world is told how long it took
// (``favour_done``) and says what it cost them.
//
// The page calls ``drive`` for each person it draws: true when this one is doing your favour
// (their drawn place, pose and what they are doing set here). Minutes are the fleet's (real) minutes.

import { FAVOURS } from "./npc-favours.mjs";

const FOLLOW = { carry: 1.25, move_house: 1.1, come: 1.0, ride: 1.1 };

export function favourRun({ send, notify, onLift = null, now = () => performance.now(), inCar = () => false }) {
  let job = null;
  const ease = (a, b, k) => a + (b - a) * k;
  //: A favour granted (``favour``: the world's record) of the one drawn at ``at`` ({x, z, yaw}),
  //: with you at ``you``.
  function start(favour, at, you) {
    if (job) finish("superseded");
    const F = FAVOURS[favour.kind];
    const away = Math.atan2(at.x - you.x, at.z - you.z);
    job = { favour, npc: favour.npc, name: favour.name, kind: favour.kind, phase: "doing", t0: now(), x: at.x, z: at.z, yaw: at.yaw ?? 0,
      // Stepping aside: a step and a half off the line between you, on their side of it.
      aside: { x: at.x + Math.cos(away) * 1.6, z: at.z - Math.sin(away) * 1.6 }, spot: { x: at.x, z: at.z },
      limit: Math.max(15_000, F.minutes * 60_000 * 2.5), left: false };
    if (favour.kind === "ride") onLift?.(job);
    return job;
  }
  //: The favour over: "done" (it was done), or called off. They go back to their day.
  async function finish(why = "done") {
    if (!job || job.phase === "returning") return null;
    const j = job;
    j.phase = "returning"; j.back = { t: now(), x: j.x, z: j.z };
    const held = (now() - j.t0) / 60_000;
    const r = await send("favour_done", { id: j.favour.id, held });
    if (r?.ok) {
      const first = j.name.split(" ")[0];
      notify(`${why === "done" ? `${first} has gone back to what they were doing.` : `${first} goes back to their day.`}${r.cost?.text ? ` ${r.cost.text}` : ""}`);
    }
    return r;
  }
  //: Whoever is doing the favour, this frame: ``entry`` (drawn), ``pos`` (where their day has
  //: them), ``you``, ``dt`` (s); ``hold(pos)``: keep their day's walk waiting. True: overridden.
  function drive(entry, pos, you, dt, hold) {
    if (!job || entry.id !== job.npc) return false;
    const t = now(), F = FAVOURS[job.kind];
    if (job.phase === "returning") {
      // Back to where their day has them now, at a walk; then they are theirs again.
      const d = Math.hypot(pos.x - job.back.x, pos.z - job.back.z), k = Math.min(1, ((t - job.back.t) / 1000) * 1.4 / Math.max(0.5, d));
      entry.x = ease(job.back.x, pos.x, k); entry.z = ease(job.back.z, pos.z, k);
      entry.moving = k < 1; entry.activity = "back to their day";
      if (k < 1) entry.yaw = Math.atan2(-(pos.x - job.back.x), -(pos.z - job.back.z));
      if (k >= 1) job = null;
      return true;
    }
    hold?.(pos);
    if (t - job.t0 > job.limit) { finish("timeout"); return true; }
    let tx = job.x, tz = job.z, face = null, activity = F.label;
    if (job.kind === "make_way") { tx = job.aside.x; tz = job.aside.z; activity = "stepping aside for you"; if (t - job.t0 > 12_000) finish(); }
    else if (job.kind === "wait" || job.kind === "hold_door") {
      tx = job.spot.x; tz = job.spot.z; face = you; activity = job.kind === "wait" ? "waiting for you" : "holding the door";
      const d = Math.hypot(you.x - tx, you.z - tz);
      if (d > 5) job.left = true;
      if ((job.left && d < 2.5) || t - job.t0 > Math.max(20_000, F.minutes * 60_000)) finish();
    } else {
      // Coming along: a pace behind you (carrying: with a hand on it), beside you walking.
      const back = FOLLOW[job.kind] || 1.1, fx = -Math.sin(you.yaw ?? 0), fz = -Math.cos(you.yaw ?? 0);
      const side = job.kind === "come" ? 0.55 : 0.25;
      tx = you.x - fx * back + fz * side; tz = you.z - fz * back - fx * side;
      activity = job.kind === "carry" || job.kind === "move_house" ? "helping you carry" : job.kind === "ride" ? "giving you a lift" : "walking with you";
      if (job.kind === "carry" || job.kind === "move_house") entry.gesture = { kind: "carry", f: 0.6 };
      if (inCar() && job.kind !== "ride") finish();
    }
    const dx = tx - job.x, dz = tz - job.z, d = Math.hypot(dx, dz), step = Math.min(d, (d > 3 ? 2.6 : 1.6) * dt);
    if (d > 0.05) { job.x += (dx / d) * step; job.z += (dz / d) * step; job.yaw = Math.atan2(-dx, -dz); }
    if (d > 40) { job.x = tx; job.z = tz; }   // (left far behind: they catch up)
    if (face && d < 0.1) job.yaw = Math.atan2(-(face.x - job.x), -(face.z - job.z));
    entry.x = job.x; entry.z = job.z; entry.yaw = job.yaw; entry.moving = d > 0.08; entry.activity = activity;
    return true;
  }
  //: What you can say to them meanwhile.
  function actions() {
    if (!job || job.phase === "returning") return [];
    const first = job.name.split(" ")[0];
    return [{ id: "favour", label: job.kind === "wait" || job.kind === "make_way" || job.kind === "hold_door" ? `Thanks, ${first}` : `That's all, thanks ${first}`, key: "", run: () => finish() }];
  }
  return { start, finish, drive, actions, active: () => job, helping: (id) => Boolean(job && job.npc === id) };
}
