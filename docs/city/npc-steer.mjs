// How the city's people find their way where they are walked step by step: round the aisles of
// the shop you are in, clear of one another, in line at a till or a door, and round something in
// the way before they walk into it.
//
//   - NavGrid: a room's floor as squares a person can stand on (a shop plan's own walkable test,
//     store-room.mjs canWalkStore), and the way across it (A*, eight ways, then pulled straight
//     wherever the way is clear) -- with what costs more today (someone standing there) costing more.
//   - Queue: a line at a point -- a till, a door -- one behind the other a pace apart, along the
//     way they come from; the front one is served, the rest move up.
//   - steer(): one step of everyone walked: toward the next point of their way, apart from whoever
//     is too near (each a little to their right meeting head on), and, looking ahead, round
//     whoever stands in their way -- the way planned again round them before they get there; held
//     too long, the step they were on is given up (``blocked``) for their task to try another.
//   - Task: a few things to do in order ({x, z, dwell, kind}), each tried twice, a different one
//     in its place (``alt``) or skipped when it cannot be reached; done when the last is.
//   - swerveAhead() / doorHolds(): the same looking ahead for those walking the street (view.mjs),
//     who are placed along their day's way and only offset from it.
// Pure (tests/city_npc_steer.test.mjs).

export const STEER = {
  speed: 1.15,          // m/s, a shopper's walk
  radius: 0.28,         // a body's half width
  apart_m: 0.62,        // nearer than this, two step apart
  look_m: 1.6,          // how far ahead someone looks for a body in the way
  replan_s: 0.7,        // held this long behind someone, the way is planned again round them
  give_up_s: 6,         // held this long, the step is given up
  arrive_m: 0.22,
  queue_gap_m: 0.72,
};

// ---- the floor ------------------------------------------------------------------------------------

export class NavGrid {
  //: The floor between (x0, z0) and (x1, z1) in squares of ``cell`` m; ``free(x, z)``: whether
  //: someone may stand there.
  constructor({ x0, x1, z0, z1, cell = 0.3, free }) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell)); this.nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    this.ok = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j += 1) for (let i = 0; i < this.nx; i += 1) {
      const c = this.center(i, j);
      this.ok[j * this.nx + i] = free(c.x, c.z) ? 1 : 0;
    }
    this.extra = new Float32Array(this.nx * this.nz);
  }
  center(i, j) { return { x: this.x0 + (i + 0.5) * this.cell, z: this.z0 + (j + 0.5) * this.cell }; }
  cellOf(x, z) { return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)]; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }
  open(i, j) { return this.inside(i, j) && this.ok[j * this.nx + i] === 1; }
  freeAt(x, z) { const [i, j] = this.cellOf(x, z); return this.open(i, j); }
  //: The open square nearest (x, z) (within ``reach`` squares), as its centre; null if none.
  nearestFree(x, z, reach = 8) {
    const [ci, cj] = this.cellOf(x, z);
    if (this.open(ci, cj)) return { x, z };
    for (let r = 1; r <= reach; r += 1) {
      let best = null, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j += 1) for (let i = ci - r; i <= ci + r; i += 1) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !this.open(i, j)) continue;
        const c = this.center(i, j), d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      if (best) return best;
    }
    return null;
  }
  //: Whether the straight line from a to b keeps to open squares (and to squares costing nothing extra).
  clear(ax, az, bx, bz, strict = true) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let k = 0; k <= n; k += 1) {
      const [i, j] = this.cellOf(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
      if (!this.open(i, j) || (strict && this.extra[j * this.nx + i] > 0)) return false;
    }
    return true;
  }
  //: A cost laid on the squares round (x, z) for a while (someone standing there): ``r`` m round.
  weigh(x, z, r = 0.45, w = 6) {
    const [ci, cj] = this.cellOf(x, z), k = Math.ceil(r / this.cell);
    for (let j = cj - k; j <= cj + k; j += 1) for (let i = ci - k; i <= ci + k; i += 1) if (this.inside(i, j)) this.extra[j * this.nx + i] = Math.max(this.extra[j * this.nx + i], w);
  }
  unweigh() { this.extra.fill(0); }
  //: The way from a to b: a few points, the first past a, the last b (or the open square nearest
  //: it). Null when there is none.
  path(ax, az, bx, bz) {
    const s = this.nearestFree(ax, az), g = this.nearestFree(bx, bz);
    if (!s || !g) return null;
    const [si, sj] = this.cellOf(s.x, s.z), [gi, gj] = this.cellOf(g.x, g.z), nx = this.nx, N = nx * this.nz;
    const start = sj * nx + si, goal = gj * nx + gi;
    const gScore = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), shut = new Uint8Array(N);
    const heap = [[0, start]];
    gScore[start] = 0;
    const H = (n) => Math.hypot((n % nx) - gi, Math.floor(n / nx) - gj);
    while (heap.length) {
      // (A small binary heap: rooms are a few thousand squares.)
      const [, cur] = heapPop(heap);
      if (cur === goal) break;
      if (shut[cur]) continue;
      shut[cur] = 1;
      const ci = cur % nx, cj = (cur - ci) / nx;
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (!this.open(i, j)) continue;
        // (No cutting a corner between two blocked squares.)
        if (di && dj && (!this.open(ci + di, cj) || !this.open(ci, cj + dj))) continue;
        const n = j * nx + i, step = (di && dj ? Math.SQRT2 : 1) + this.extra[n];
        const t = gScore[cur] + step;
        if (t < gScore[n]) { gScore[n] = t; from[n] = cur; heapPush(heap, [t + H(n), n]); }
      }
    }
    if (start !== goal && from[goal] < 0) return null;
    const cells = [];
    for (let n = goal; n >= 0; n = n === start ? -1 : from[n]) cells.push(n);
    cells.reverse();
    const pts = cells.map((n) => this.center(n % nx, Math.floor(n / nx)));
    pts[pts.length - 1] = { x: g.x, z: g.z };
    // Pulled straight: from each point, on to the furthest one in clear sight.
    const out = [];
    let at = { x: ax, z: az }, k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let m = pts.length - 1; m > k + 1; m -= 1) if (this.clear(at.x, at.z, pts[m].x, pts[m].z, true)) { far = m; break; }
      out.push(pts[far]); at = pts[far]; k = far;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }
}
function heapPush(h, x) { h.push(x); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
  return top;
}

//: A shop plan's floor (store-room.mjs / grocery-room.mjs, x across from the middle, z in from
//: the front) for its customers: ``canWalk(plan, x, z, behind)``.
export function storeNav(plan, canWalk, cell = 0.3) {
  return new NavGrid({ x0: -plan.width / 2, x1: plan.width / 2, z0: 0, z1: plan.depth, cell, free: (x, z) => canWalk(plan, x, z, false) });
}

// ---- a line -----------------------------------------------------------------------------------------

export class Queue {
  //: A line at ``head`` ({x, z}: where the one being served stands), running back along ``back``
  //: (a unit {x, z}) a pace apart; ``turn``: where it turns when the room runs out (a unit {x, z}).
  constructor(head, back, { gap = STEER.queue_gap_m, most = 8, free = null } = {}) {
    this.head = head; this.back = back; this.gap = gap; this.most = most; this.free = free; this.ids = [];
  }
  join(id) { if (!this.ids.includes(id)) this.ids.push(id); return this.ids.indexOf(id); }
  leave(id) { const i = this.ids.indexOf(id); if (i >= 0) this.ids.splice(i, 1); }
  place(id) { return this.ids.indexOf(id); }
  get length() { return this.ids.length; }
  full() { return this.ids.length >= this.most; }
  //: Where the ``k``th in line stands; past where the floor is open, the line bends to the side.
  spot(k) {
    let x = this.head.x + this.back.x * this.gap * k, z = this.head.z + this.back.z * this.gap * k;
    if (this.free && k > 0 && !this.free(x, z)) {
      for (const s of [1, -1]) {
        const sx = x + this.back.z * s * this.gap, sz = z - this.back.x * s * this.gap;
        if (this.free(sx, sz)) { x = sx; z = sz; break; }
      }
    }
    return { x, z };
  }
}

// ---- walking ----------------------------------------------------------------------------------------

//: One step for everyone walked (``agents``: {id, x, z, yaw, path: [{x, z}], goal, hold, v}):
//: on toward the next point of their way, apart from one another, round whoever is in the way.
//: Sets ``moving``, and ``blocked`` (s held) -- the way planned again round the blocker at
//: STEER.replan_s, ``stuck`` true at STEER.give_up_s for the task to deal with.
export function steer(agents, dt, grid, S = STEER) {
  for (const a of agents) {
    a.moving = false;
    if (a.hold || !a.path?.length) { a.blocked = 0; continue; }
    const p = a.path[0], dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz);
    if (d < S.arrive_m) { a.path.shift(); if (!a.path.length) { a.blocked = 0; continue; } }
    const q = a.path[0], tx = q.x - a.x, tz = q.z - a.z, td = Math.hypot(tx, tz) || 1;
    let vx = (tx / td) * S.speed * (a.pace || 1), vz = (tz / td) * S.speed * (a.pace || 1);
    // Looking ahead: someone in the way, near and slower (standing, or in line).
    let blocker = null, bd = S.look_m;
    for (const o of agents) {
      if (o === a) continue;
      const ox = o.x - a.x, oz = o.z - a.z, along = (ox * tx + oz * tz) / td, side = Math.abs((ox * tz - oz * tx) / td);
      if (along <= 0 || along > bd || side > S.radius * 2.2) continue;
      const theirs = o.moving ? (o.vx * tx + o.vz * tz) / td : 0;
      if (theirs > S.speed * 0.7) continue;   // going our way at a walk: following, not blocked
      blocker = o; bd = along;
    }
    if (blocker) {
      a.blocked = (a.blocked || 0) + dt;
      // Slowing behind them; and soon a way round, planned before reaching them.
      const k = Math.max(0, (bd - S.radius * 2.4) / S.look_m);
      vx *= k; vz *= k;
      // (Planned again every so often while held: each time round everyone standing near the way.)
      if (a.blocked - (a.replanned || 0) > S.replan_s && grid && a.goal) {
        grid.unweigh();
        for (const o of agents) if (o !== a && !o.moving && Math.hypot(o.x - a.x, o.z - a.z) < S.look_m * 3) grid.weigh(o.x, o.z, S.radius * 2.4 + grid.cell * 0.5);
        const round = grid.path(a.x, a.z, a.goal.x, a.goal.z);
        grid.unweigh();
        if (round?.length) a.path = round;
        a.replanned = a.blocked;
      }
      if (a.blocked > S.give_up_s) a.stuck = true;
    } else { a.blocked = 0; a.replanned = 0; }
    // Apart: nobody stands in anybody (meeting head on, each a little to their right).
    let px = 0, pz = 0;
    for (const o of agents) {
      if (o === a) continue;
      const ox = a.x - o.x, oz = a.z - o.z, od = Math.hypot(ox, oz);
      if (od >= S.apart_m || od < 1e-4) continue;
      const push = (S.apart_m - od) * (o.moving ? 1.2 : 2.2);
      px += (ox / od) * push; pz += (oz / od) * push;
      if (o.moving && o.vx * vx + o.vz * vz < 0) { px += (vz / S.speed) * 0.35; pz += (-vx / S.speed) * 0.35; }
    }
    vx += px; vz += pz;
    const v = Math.hypot(vx, vz), top = S.speed * 1.3 * (a.pace || 1);
    if (v > top) { vx *= top / v; vz *= top / v; }
    let nx = a.x + vx * dt, nz = a.z + vz * dt;
    // Never through a shelf: along it, or stopped.
    if (grid && !grid.freeAt(nx, nz)) {
      if (grid.freeAt(nx, a.z)) nz = a.z; else if (grid.freeAt(a.x, nz)) nx = a.x; else { nx = a.x; nz = a.z; }
    }
    const moved = Math.hypot(nx - a.x, nz - a.z);
    a.vx = (nx - a.x) / Math.max(dt, 1e-3); a.vz = (nz - a.z) / Math.max(dt, 1e-3);
    a.x = nx; a.z = nz;
    if (moved > 0.02 * dt) { a.moving = true; a.yaw = Math.atan2(-a.vx, -a.vz); }
  }
}

// ---- a few things to do -----------------------------------------------------------------------------

//: A task: things to do in order ({x, z, dwell (s), kind, face?}), with ``alt(step)``: another
//: like it to try when one cannot be reached (another shelf of the same, another till).
export function task(steps, alt = null) { return { steps: steps.slice(), i: 0, tries: 0, dwell: 0, alt, done: false, log: [] }; }

//: One step of ``t`` for agent ``a`` on ``grid``: plans the way to the step it is on, waits there
//: its dwell, then the next; a step that cannot be reached (no way, or ``a.stuck``) is tried
//: again, then swapped for its ``alt``, then skipped. Returns the step it is on (or null, done).
export function runTask(a, t, dt, grid) {
  if (t.done) return null;
  const st = t.steps[t.i];
  if (!st) { t.done = true; return null; }
  const fail = (why) => {
    t.log.push({ i: t.i, why });
    a.stuck = false; a.blocked = 0; a.path = null; a.goal = null;
    t.tries += 1;
    if (t.tries === 1) return st;                       // once more, from where they are now
    const other = t.alt?.(st, t.tries);
    if (other && t.tries < 4) { t.steps[t.i] = other; return other; }
    t.i += 1; t.tries = 0; t.dwell = 0;                 // given up: on with the rest
    return t.steps[t.i] || null;
  };
  if (st.wait) { a.path = null; a.goal = null; return st; }   // held by something outside (a queue's front)
  if (!a.goal || a.goal.x !== st.x || a.goal.z !== st.z) {
    a.goal = { x: st.x, z: st.z };
    a.path = grid ? grid.path(a.x, a.z, st.x, st.z) : [{ x: st.x, z: st.z }];
    if (!a.path) return fail("no way there");
  }
  if (a.stuck) return fail("held up");
  const there = Math.hypot(st.x - a.x, st.z - a.z) < STEER.arrive_m * 2 || (!a.path?.length && Math.hypot(st.x - a.x, st.z - a.z) < 0.6);
  if (!there) { if (!a.path?.length) return fail("lost the way"); return st; }
  a.path = null;
  if (st.face !== undefined) a.yaw = st.face;
  t.dwell += dt;
  if (t.dwell < (st.dwell || 0)) return st;
  t.i += 1; t.tries = 0; t.dwell = 0; a.goal = null;
  if (t.i >= t.steps.length) { t.done = true; return null; }
  return t.steps[t.i];
}

// ---- the street: looking ahead, in line at a door ---------------------------------------------------

//: The step aside (m, + to the walker's right) a walker going ``yaw`` from (x, z) takes for
//: whoever stands in their way within ``look`` m ahead (``others``: {x, z, moving}), chosen early
//: and to the side with more room (``free(x, z)``: whether the walker may step there). 0: none needed.
export function swerveAhead(x, z, yaw, others, { look = 3.2, half = 0.5, free = null, me = null } = {}) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
  let need = 0, nearest = Infinity, left = 0, right = 0;
  for (const o of others) {
    if (o === me || o.moving) continue;
    const ox = o.x - x, oz = o.z - z, along = ox * fx + oz * fz;
    if (along < 0.3 || along > look) continue;
    const side = ox * rx + oz * rz;
    if (Math.abs(side) < half * 2.6) { if (side >= 0) right += 1; else left += 1; }
    if (Math.abs(side) >= half * 1.6 || along >= nearest) continue;
    nearest = along;
    need = side;
  }
  if (nearest === Infinity) return 0;
  // To the side away from them, or the emptier side when they are dead ahead.
  let s = Math.abs(need) > 0.12 ? -Math.sign(need) : left <= right ? -1 : 1;
  const by = half * 1.6 - Math.abs(need) + 0.1;
  if (free && !free(x + rx * s * by + fx * nearest, z + rz * s * by + fz * nearest)) s = -s;
  if (free && !free(x + rx * s * by + fx * nearest, z + rz * s * by + fz * nearest)) return 0;
  // Sooner the nearer: all of it within a metre and a half, eased in from ``look``.
  const k = Math.min(1, (look - nearest) / Math.max(0.1, look - 1.5));
  return s * by * k;
}

//: Who waits their turn at a door: of those in a doorway (``through``) going the same way through
//: the same door, the one furthest on goes, and each behind them within ``gap`` waits. Returns
//: the set of ids that wait.
export function doorHolds(entries, { gap = 0.85, door_m = 2.2 } = {}) {
  const at = entries.filter((e) => e.through && !e.down);
  const holds = new Set();
  for (let i = 0; i < at.length; i += 1) for (let j = 0; j < at.length; j += 1) {
    if (i === j) continue;
    const a = at[i], b = at[j];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d > door_m || Math.cos(a.yaw - b.yaw) < 0.5) continue;
    // b is ahead of a (a walks toward b), close: a waits.
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    if (dx * fx + dz * fz > 0 && d < gap + 0.6) holds.add(a.id);
  }
  // Coming the other way through it: whoever is further from the door's middle steps back.
  return holds;
}
