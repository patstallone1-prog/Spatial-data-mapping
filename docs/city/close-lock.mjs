// The close lock: inside the full-detail ring, everyone and everything moves only as it could.
//
// The reality lock (detail.mjs lockedForm) keeps a thing's drawing from changing while you look
// at it. This keeps the thing itself honest, near you:
//
// - Nothing appears there. A person, a rider or a car is taken up when it reaches the outer
//   rings (it is kept track of out there, and drawn from the moderate ring in); one that the
//   city would put down inside the close ring is not drawn at all -- unless it comes out of
//   somewhere it could have been all along: a door, a car beside it, a shop you can see into.
//   It is drawn once it has gone out past the ring, and comes back in the usual way.
// - Nothing vanishes there. One whose day takes it indoors, or into a car, or off the list, walks
//   (or rolls) to where it was going, and goes only once it is there -- at a door or beside a car.
//   Anywhere else it stays until it is out past the ring.
// - Nothing catches up. One that has fallen behind its day (held at a kerb, stuck behind a van,
//   put back by a crowd) goes on at its own pace from where it is. It is not put where its day
//   says it should be, and is not hurried there faster than it moves, until it is out past the
//   ring; from there its day has it as before.
//
// A scene cut -- the city first built round you, a jump across the map, a long gap between
// frames -- is not a thing appearing: what is round you then is taken as it is.

//: ``ring``: the close ring per kind (m), measured straight from you -- the full ring's size, but
//: not stretched by where you look: turning round does not let anyone jump behind your back.
//: ``exit``: a share past it before one is let go (so one on the edge does not flick in and out).
//: ``portal_m``: how near a wall (a door) or a car one must be to come out of it or go into it.
//: ``car_portal_m``: the same for a car (a garage, a drive).
//: ``catch_up``: the most a share over its own pace one may go -- a brisker step, not a run.
//: ``arrive_m``: as near as this to where it was going, one going in is in.
//: ``cut_jump_m`` / ``cut_gap_ms``: a focus jump or a frame gap past these is a scene cut.
//: ``settle_m``: the most anything else may move one close by in a frame after the lock has.
//: ``walk_lag_s``: how far behind on its walk (s) one close by may be held (fleet.mjs holdWalk).
//: ``stuck_ms`` / ``stuck_share``: one held back (or going in) that has made under this share of
//: its way for this long -- walking into a wall -- goes in there, if it is a wall it can go into.
export const CLOSE = {
  ring: { people: 82, cars: 100 },
  exit: 1.12,
  portal_m: 1.6,
  car_portal_m: 2.5,
  catch_up: 1.1,
  arrive_m: 0.35,
  cut_jump_m: 40,
  cut_gap_ms: 2500,
  stuck_ms: 1500,
  walk_lag_s: 3600,
  settle_m: 0.75,
  stuck_share: 0.25,
};

//: The paces things move at when nothing better is known (m/s).
export const PACE = { people: 1.35, bike: 6.5, cars: 14 };

// Under ``stuck_share`` of the way it could have gone, for ``stuck_ms``: stuck (into a wall).
function stuckFor(r, max, now) {
  const moved = r.px === undefined ? max : Math.hypot(r.x - r.px, r.z - r.pz);
  if (moved >= max * CLOSE.stuck_share) r.since = now;
  else if (r.since === undefined) r.since = now;
  return now - r.since;
}

// Along its own way (``r.walk``) toward ``target`` (a distance along it) by up to ``max``: false
// once it is there (or the way cannot be followed).
function alongWay(r, e, target, max, along) {
  const w = r.walk;
  if (!w || !along || Math.abs(target - w.d) <= 0.05) return false;
  const d = w.d + Math.sign(target - w.d) * Math.min(max, Math.abs(target - w.d));
  const p = along(w, d);
  if (!p || !Number.isFinite(p.x)) { r.walk = null; return false; }
  w.d = d;
  const dx = p.x - r.x, dz = p.z - r.z;
  r.x = p.x; r.z = p.z;
  e.x = r.x; e.z = r.z; e.moving = true;
  if (Math.hypot(dx, dz) > 0.005) e.yaw = Math.atan2(-dx, -dz);
  return true;
}

// Where a walk drawn ``left`` m short of its day is along its way, and where that way ends.
function wayOf(w, left) {
  const L = w.pave?.length || 0, dir = w.dir || 1;
  if (!(L > 0)) return null;
  const d = Math.max(0, Math.min(L, (w.d ?? 0) - dir * left));
  return { key: w.key, pave: w.pave, d, end: w.round ? 0 : dir > 0 ? L : 0 };
}

function towards(rec, x, z, max) {
  const dx = x - rec.x, dz = z - rec.z, d = Math.hypot(dx, dz);
  if (d <= max || d < 1e-9) { rec.x = x; rec.z = z; return d; }
  rec.x += (dx / d) * max; rec.z += (dz / d) * max;
  return d - max;
}

//: A lock for one kind of thing ("people" or "cars"). ``portal(x, z, entry)``: whether one may
//: come out of, or go into, somewhere at (x, z). ``inClose(x, z)``: whether (x, z) is inside the
//: close ring, ``share`` its multiple (exit: 1.12). Entries carry ``id``, ``x``, ``z`` and
//: optionally ``yaw``, ``moving``, ``speed``, ``person.pace``; ``free(entry)`` says one moves by
//: its own physics already (thrown, falling, carried) and is only followed.
//: ``along(walk, d)``: where along a walk's way (``walk.pave``) distance ``d`` is ({x, z}); with it,
//: one whose day has gone on to another walk (or off the list) while it is still on its own way
//: finishes that way first -- to its door, or back round to where its round began.
//: ``release(entry)``: one drawn close by is out past the ring again (its day has it from here).
export function closeLock(kind, { portal = () => false, inClose, free = () => false, pace = null, along = null, release = null } = {}) {
  const recs = new Map();
  const stats = { withheld: 0, ghosts: 0, held: 0, admitted: 0, cuts: 0, jumpsNear: 0, wentIn: 0, settled: 0, jumpsStopped: 0 };
  const drawnAt = new Map();   // id -> where it was drawn last frame {x, z, t}
  let focusWas = null, lastAt = -Infinity, cutNow = true, cutFrame = false;
  const own = (e) => pace?.(e) ?? Math.max(e.speed || 0, e.person?.pace || (kind === "cars" ? PACE.cars : PACE.people));
  return {
    stats,
    records: recs,
    //: The focus this frame: a jump or a gap is a scene cut (everything round you taken as it is).
    frame(focus, now) {
      if (!focusWas || now - lastAt > CLOSE.cut_gap_ms || Math.hypot(focus.x - focusWas.x, focus.z - focusWas.z) > CLOSE.cut_jump_m) cutNow = true;
      focusWas = { x: focus.x, z: focus.z }; lastAt = now;
    },
    cut() { cutNow = true; },
    //: This frame's entries, as they may be drawn: those withheld left out, the rest moved no
    //: further than they can go, and those gone from the list but not yet where they were going
    //: added back (``ghost``). ``dt`` in seconds.
    step(list, dt, now) {
      const cut = cutNow;
      cutFrame = cut;
      if (cut) { cutNow = false; stats.cuts += 1; for (const r of recs.values()) r.withheld = false; }
      const out = [];
      const seen = new Set();
      stats.withheld = 0; stats.ghosts = 0; stats.held = 0;
      for (const e of list) {
        if (e.id === undefined || e.id === null) { out.push(e); continue; }
        seen.add(e.id);
        let r = recs.get(e.id);
        const near = inClose(e.x, e.z, 1);
        if (!r) {
          if (near && !cut && !portal(e.x, e.z, e)) {
            recs.set(e.id, { withheld: true, x: e.x, z: e.z, t: now });
            stats.withheld += 1;
            continue;
          }
          recs.set(e.id, { x: e.x, z: e.z, t: now, wx: e.x, wz: e.z, entry: e, drawn: true, walk: e.walk?.key ? wayOf(e.walk, 0) : null });
          stats.admitted += 1;
          out.push(e);
          continue;
        }
        if (r.withheld) {
          // Withheld until its day has it out past the ring: then it comes in like anyone.
          if (near) { r.x = e.x; r.z = e.z; r.t = now; stats.withheld += 1; continue; }
          r.withheld = false; r.x = e.x; r.z = e.z; r.t = now; r.walk = e.walk?.key ? wayOf(e.walk, 0) : null;
        }
        r.wx = e.x; r.wz = e.z; r.entry = e; r.drawn = true;
        const span = Math.min(0.25, Math.max(dt, (now - r.t) / 1000, 1 / 240));
        r.t = now;
        // (Close if drawn close, or if its day has it close: one drawn out past the ring whose day
        // puts it near you walks in from where it is -- it is not set down by you.)
        const close = inClose(r.x, r.z, CLOSE.exit) || near;
        if (!close || cut || free(e)) {
          if (r.close) { r.close = false; release?.(e); }
          r.x = e.x; r.z = e.z; r.lag = 0; r.px = undefined; r.since = undefined; r.walk = null; out.push(e); continue;
        }
        r.close = true;
        // Close: from where it was drawn, no faster than it goes.
        const max = own(e) * CLOSE.catch_up * span + 0.002;
        // (Walked into a wall it can go into, and getting nowhere: in it goes, and is not drawn
        // again until its day has it out past the ring.)
        if (r.lag > 0.05 && stuckFor(r, r.lastMax ?? max, now) > CLOSE.stuck_ms && portal(r.x, r.z, e)) {
          r.withheld = true; r.drawn = false; r.since = undefined; stats.wentIn += 1; continue;
        }
        r.px = r.x; r.pz = r.z; r.lastMax = max;
        // On its own way and well short of its day (or its day gone on to another walk): along
        // that way -- round the corner, not through it -- to where its day is on it, or to its end.
        const ow = r.walk, same = Boolean(ow && e.walk?.key === ow.key);
        if (ow && (!same || Math.abs(e.walk.d - ow.d) > 2) && alongWay(r, e, same ? e.walk.d : ow.end, max, along)) {
          r.lag = same ? Math.abs(e.walk.d - ow.d) : Math.hypot(r.wx - r.x, r.wz - r.z);
          e.lagM = r.lag; e.ownWay = !same;
          stats.held += 1; if (r.lag > 3) stats.jumpsNear += 1;
          out.push(e); continue;
        }
        const left = towards(r, e.x, e.z, max);
        r.lag = left;
        r.walk = e.walk?.key && e.walk.pave ? wayOf(e.walk, left) : null;
        if (left > 0.005) e.lagM = left;   // (how far behind its day it is drawn)
        if (left > 0.05) {
          stats.held += 1;
          if (left > 3) stats.jumpsNear += 1;
          const dx = e.x - r.x, dz = e.z - r.z;
          e.x = r.x; e.z = r.z;
          // Facing the way it is really going (it walks there; it is not slid).
          if (e.moving !== false && Math.hypot(dx, dz) > 0.05) e.yaw = Math.atan2(-dx, -dz);
        }
        out.push(e);
      }
      // Gone from the list: near, it goes on to where it was going, and is gone only there.
      for (const [id, r] of recs) {
        if (seen.has(id)) continue;
        if (r.withheld || !r.drawn) { if (now - r.t > 60_000) recs.delete(id); continue; }
        const close = inClose(r.x, r.z, CLOSE.exit);
        if (!close || cut) { recs.delete(id); if (r.close) release?.(r.entry); continue; }
        r.close = true;
        const span = Math.min(0.25, Math.max(dt, (now - r.t) / 1000, 1 / 240));
        r.t = now;
        const e = r.entry;
        const max = own(e) * span + 0.002;
        const stuck = stuckFor(r, r.lastMax ?? max, now) > CLOSE.stuck_ms;
        r.px = r.x; r.pz = r.z; r.lastMax = max;
        if (r.walk && alongWay(r, e, r.walk.end, max, along)) {
          if (Math.abs(r.walk.d - r.walk.end) <= 0.05 && portal(r.x, r.z, e)) { recs.delete(id); continue; }
          e.ghost = true; stats.ghosts += 1; out.push(e);
          continue;
        }
        r.walk = null;
        const left = towards(r, r.wx, r.wz, max);
        if ((left <= CLOSE.arrive_m || stuck) && portal(r.x, r.z, e)) { recs.delete(id); if (stuck) stats.wentIn += 1; continue; }
        const dx = r.wx - r.x, dz = r.wz - r.z;
        e.x = r.x; e.z = r.z; e.ghost = true;
        e.moving = left > CLOSE.arrive_m;
        if (e.moving && Math.hypot(dx, dz) > 0.05) e.yaw = Math.atan2(-dx, -dz);
        if (!e.moving) { e.speed = 0; if (kind === "cars") e.parked = true; }
        stats.ghosts += 1;
        out.push(e);
      }
      if (recs.size > 20000) for (const [id, r] of recs) if (now - r.t > 10_000) recs.delete(id);
      return out;
    },
    //: After everything else has had its say this frame (kept apart, out of a clump, round a
    //: shop floor, a stride): one close by moved more than ``settle_m`` from where the lock had it
    //: is put back there; a smaller nudge stands, and the lock takes it as where it is.
    //: And whatever it came by, nobody is drawn inside the ring further from where they were
    //: drawn last frame than they could have gone (``now`` in ms).
    settle(list, now) {
      for (const e of list) {
        if (e.id === undefined || e.id === null) continue;
        const r = recs.get(e.id);
        if (r?.drawn && r.close && !free(e)) {
          if (Math.hypot(e.x - r.x, e.z - r.z) > CLOSE.settle_m) { e.x = r.x; e.z = r.z; stats.settled += 1; }
          else { r.x = e.x; r.z = e.z; }
        }
        const was = drawnAt.get(e.id);
        if (was && !cutFrame && !free(e) && now - was.t < 250 && (inClose(e.x, e.z, 1) || inClose(was.x, was.z, 1))) {
          const most = own(e) * CLOSE.catch_up * Math.min(0.25, Math.max(1 / 240, (now - was.t) / 1000)) + CLOSE.settle_m;
          const d = Math.hypot(e.x - was.x, e.z - was.z);
          if (d > most) {
            e.x = was.x + ((e.x - was.x) / d) * most; e.z = was.z + ((e.z - was.z) / d) * most;
            if (r) { r.x = e.x; r.z = e.z; }
            stats.jumpsStopped += 1;
          }
        }
        if (was) { was.x = e.x; was.z = e.z; was.t = now; } else drawnAt.set(e.id, { x: e.x, z: e.z, t: now });
      }
      if (drawnAt.size > 20000) for (const [id, w] of drawnAt) if (now - w.t > 5000) drawnAt.delete(id);
    },
    //: The ones drawn furthest behind their day just now: [{id, lag}] (for the detail panel).
    lagging(n = 8) {
      const out = [];
      for (const [id, r] of recs) if (r.drawn && r.wx !== undefined) { const lag = Math.hypot(r.wx - r.x, r.wz - r.z); if (lag > 0.05) out.push({ id, lag: +lag.toFixed(2), ghost: Boolean(r.entry?.ghost), activity: r.entry?.activity || null, moving: r.entry?.moving !== false, walk: Boolean(r.entry?.walk), x: +r.x.toFixed(1), z: +r.z.toFixed(1) }); }
      return out.sort((a, b) => b.lag - a.lag).slice(0, n);
    },
    //: Whether ``id`` is held back from its day this frame (drawn short of where it should be).
    behind: (id) => recs.get(id)?.drawn && (Math.hypot((recs.get(id).wx ?? 0) - recs.get(id).x, (recs.get(id).wz ?? 0) - recs.get(id).z) > 0.05),
  };
}

//: Whether one at (x, z) could come out of or go into somewhere: a building's wall within
//: ``reach`` (its door is along it), probed round in eight directions -- ``footprintAt``(x, z) is
//: the place there, or null.
export function byWall(footprintAt, x, z, reach) {
  if (!footprintAt) return false;
  if (footprintAt(x, z)) return true;
  for (let k = 0; k < 8; k += 1) {
    const a = (k * Math.PI) / 4;
    for (const d of [reach * 0.5, reach]) if (footprintAt(x + Math.cos(a) * d, z + Math.sin(a) * d)) return true;
  }
  return false;
}

// ---- ground ahead -----------------------------------------------------------------------------------
//: In the close ring each walker's way ahead is looked along (``ahead_m``, ten feet, in ``step_m``
//: steps); where the ground there rises or falls by more than ``rough_m`` (a few millimetres) the
//: ground under them is read again every ``fine_m`` they move instead of every ``coarse_m``, so a
//: foot is never set below a kerb's edge or a slope it has walked onto. The look ahead is taken
//: again each ``relook_m`` they go, or ``relook_ms``.
export const GROUND_AHEAD = { ahead_m: 3.048, step_m: 0.25, rough_m: 0.004, fine_m: 0.004, coarse_m: 0.1, relook_m: 0.5, relook_ms: 400 };

//: Whether the ground ahead of one at (x, z) facing ``yaw`` (0 faces -z) changes by more than
//: ``rough_m`` within ``ahead_m``: [rough, rise], rise the most it differs from where they stand.
export function groundAhead(groundAt, x, z, yaw, G = GROUND_AHEAD) {
  const fx = -Math.sin(yaw || 0), fz = -Math.cos(yaw || 0);
  const y0 = groundAt(x, z);
  if (!Number.isFinite(y0)) return [true, Infinity];
  let lo = y0, hi = y0;
  for (let s = G.step_m; s <= G.ahead_m + 1e-6; s += G.step_m) {
    const y = groundAt(x + fx * s, z + fz * s);
    if (!Number.isFinite(y)) continue;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const rise = hi - lo;
  return [rise > G.rough_m, rise];
}

//: The ground under each one near you, read as often as the ground ahead of them asks: ``ground``
//: is the exact reading (the page's walker ground). Kept per id: [x, z, y, rough, lookX, lookZ, lookT].
export function feetTracker(ground, G = GROUND_AHEAD) {
  const feet = new Map();
  const stats = { reads: 0, looks: 0, rough: 0, fine: 0 };
  return {
    stats,
    //: The ground under ``p`` ({id, x, z, yaw}); ``close``: in the close ring (looked ahead for).
    at(p, now, close = true) {
      let f = feet.get(p.id);
      if (!f) { if (feet.size > 8000) feet.clear(); f = [NaN, NaN, 0, false, NaN, NaN, -Infinity]; feet.set(p.id, f); }
      if (close && (!(Math.hypot(p.x - f[4], p.z - f[5]) < G.relook_m) || now - f[6] > G.relook_ms)) {
        f[3] = groundAhead(ground, p.x, p.z, p.yaw, G)[0]; f[4] = p.x; f[5] = p.z; f[6] = now; stats.looks += 1; if (f[3]) stats.rough += 1;
      }
      if (!close) f[3] = false;
      const every = f[3] ? G.fine_m : G.coarse_m;
      if (f[3]) stats.fine += 1;
      if (!(Math.abs(f[0] - p.x) < every && Math.abs(f[1] - p.z) < every)) {
        f[2] = ground(p.x, p.z); f[0] = p.x; f[1] = p.z; stats.reads += 1;
      }
      return f[2];
    },
    rough: (id) => Boolean(feet.get(id)?.[3]),
    clear: () => feet.clear(),
  };
}
