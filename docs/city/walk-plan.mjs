// A walker's plan for the next few seconds (2026-11-26).
//
// Someone walking near you used to decide everything a frame at a time: a step round whoever was
// in the way when they got there, a stop when a car was on them, and the kerb found when their
// foot was over it -- which showed as small jumps, stops dead and a body popping up onto the
// pavement. Now every PLAN.every_s each near walker looks PLAN.horizon_s ahead along their own
// route, in three dimensions:
//
//   - the ground under it (its slope, and the kerbs: a rise or drop over a short run is a step),
//     from which their pace through it (Tobler's walking function: slower uphill, a little
//     faster gently down, slower down a steep one) and where each step comes;
//   - who and what will be where they will be (people and cars carried on as they are going),
//     against three lines: straight on, a pace to the right, a pace to the left. The clearest
//     is the plan; the next clearest is the alternative they change to, eased, if the plan goes
//     bad before the next look;
//   - and where nothing clears -- a car across the crosswalk, a knot of people on a narrow
//     pavement -- a stop: where it starts (a little short of the trouble) and how long it lasts
//     (until the trouble has gone by), not a halt found by bumping into it.
//
// Pure (no page, no three.js): what it is given is all it knows. The view runs it for the walkers
// it draws near you and keeps nothing else: a plan is a few dozen numbers.

export const PLAN = Object.freeze({
  every_s: 2.0,        // a fresh look this often (each walker at their own moment)
  horizon_s: 6.0,      // how far ahead in time
  sample_m: 0.5,       // the route read every this many metres
  sides: [0, 0.55, -0.55],   // straight on, a pace to the right, a pace to the left
  side_cost: 0.35,     // what leaving the line costs (people keep to their line when they can)
  clear_m: 0.75,       // closer than this to someone at the same moment is a conflict
  car_clear_m: 1.1,    // ... to a car's side
  step_m: 0.07,        // a rise or drop this much within one sample is a kerb step
  max_step_m: 0.55,    // more than this is a wall, not a step: the route is not read past it
  step_ease_m: 0.45,   // the body is raised (or let down) over this much of the approach
  stop_short_m: 0.6,   // a stop is made this far short of the trouble
  stop_most_s: 4.5,    // and lasts at most this long before they look again
  look_people: 12,     // the nearest this many people are weighed
});

//: Tobler's walking function as a share of the pace on the flat: ``grade`` is rise over run.
export function slopePace(grade) {
  const v = (g) => Math.exp(-3.5 * Math.abs(g + 0.05));
  return Math.max(0.45, Math.min(1.12, v(Number.isFinite(grade) ? grade : 0) / v(0)));
}

//: The route ahead read in 3D. ``along(m)``: the point m metres ahead on it ({x, z} or null where
//: it ends); ``ground(x, z)``: the height there. Returns [{m, x, z, y, grade, pace}] and the steps
//: on it ([{m, rise}]: up positive), the read stopped at a wall or the route's end.
export function readAhead(along, ground, metres, sample = PLAN.sample_m) {
  const pts = [], steps = [];
  let prev = null;
  for (let m = 0; m <= metres + 1e-6; m += sample) {
    const p = along(m);
    if (!p) break;
    const y = ground(p.x, p.z);
    if (!Number.isFinite(y)) break;
    let grade = 0;
    if (prev) {
      const run = Math.max(0.05, Math.hypot(p.x - prev.x, p.z - prev.z)), rise = y - prev.y;
      if (Math.abs(rise) > PLAN.max_step_m) break;
      if (Math.abs(rise) >= PLAN.step_m) steps.push({ m: m - sample / 2, rise: +rise.toFixed(3) });
      // (A kerb's rise is a step, not a slope: the slope is read from what is left of it.)
      else grade = rise / run;
    }
    const pt = { m, x: p.x, z: p.z, y, grade, pace: slopePace(grade) };
    pts.push(pt); prev = pt;
  }
  return { pts, steps };
}

//: When the walker gets to each point (seconds from now) at ``speed`` on the flat, slowed and
//: hurried by the slope and held a moment at each step (``step_s``).
function arrivals(pts, steps, speed, step_s = 0.18) {
  const t = [0];
  let k = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const run = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    let dt = run / Math.max(0.2, speed * pts[i].pace);
    while (k < steps.length && steps[k].m <= pts[i].m) { dt += step_s; k += 1; }
    t.push(t[i - 1] + dt);
  }
  return t;
}

const CAR_HALF_W_M = 0.9;
//: Where a mover ({x, z, vx, vz}) is ``t`` seconds on, going as it is going.
const at = (o, t) => [o.x + (o.vx || 0) * t, o.z + (o.vz || 0) * t];

//: How a line ``side`` metres to the right of the route fares: its worst closeness to anyone at
//: the same moment (``conflict``: the first time and place it is too close, or null) and its cost.
function weighLine(pts, times, side, people, cars, free) {
  let cost = Math.abs(side) * PLAN.side_cost, conflict = null;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i], t = times[i];
    // The right of the route here: across its heading, from this point to the next (or the last).
    const q = pts[Math.min(pts.length - 1, i + 1)], r = pts[Math.max(0, i - 1)];
    const hx = q.x - r.x, hz = q.z - r.z, hl = Math.hypot(hx, hz) || 1;
    const x = p.x + (-hz / hl) * side, z = p.z + (hx / hl) * side;
    if (side && free && !free(x, z)) { cost += 2; if (!conflict) conflict = { i, t, m: p.m, kind: "wall", until: Infinity }; continue; }
    for (const o of people) {
      const [ox, oz] = at(o, t), d = Math.hypot(ox - x, oz - z);
      if (d < PLAN.clear_m) {
        cost += (PLAN.clear_m - d) * 3 / (1 + t * 0.4);
        if (!conflict) conflict = { i, t, m: p.m, kind: "person", until: t + 1.2 };
      }
    }
    for (const c of cars) {
      // The car as it is: a body CAR_HALF_W_M either side of a line its length long, along its way
      // (a circle its length across stopped people on the pavement for a car going by in the lane).
      const [cx, cz] = at(c, t), cv = Math.hypot(c.vx || 0, c.vz || 0);
      const hx = (c.vx || 0) / cv, hz = (c.vz || 0) / cv, reach = Math.max(0, (c.half || 2.2) - CAR_HALF_W_M);
      const along = Math.max(-reach, Math.min(reach, (x - cx) * hx + (z - cz) * hz));
      const d = Math.hypot(x - cx - hx * along, z - cz - hz * along) - CAR_HALF_W_M;
      if (d < PLAN.car_clear_m) {
        cost += (PLAN.car_clear_m - d) * 6 / (1 + t * 0.3);
        // How long the car takes to clear the spot: its length over its speed, and a little.
        if (!conflict || conflict.kind !== "car") conflict = { i, t, m: p.m, kind: "car", until: t + (2 * (c.half || 2.2) + PLAN.car_clear_m * 2) / cv + 0.4 };
      }
    }
  }
  return { side, cost, conflict };
}

//: The plan: ``me`` {speed} on the flat (m/s); ``along``, ``ground`` as readAhead's; ``people``
//: and ``cars`` [{x, z, vx, vz, half?}] (near them, going as they are going); ``free(x, z)``:
//: whether a step aside to there is somewhere to walk. Returns {pts, steps, times, side, alt, stop,
//: lines} -- ``side`` the line taken, ``alt`` the next best, ``stop`` {m, for_s, kind} or null.
export function planWalk(me, { along, ground, people = [], cars = [], free = null }) {
  const speed = Math.max(0.3, me.speed || 1.3);
  const { pts, steps } = readAhead(along, ground, speed * PLAN.horizon_s * 1.15);
  if (pts.length < 2) return { pts, steps, times: [0], side: 0, alt: 0, stop: null, lines: [] };
  const times = arrivals(pts, steps, speed);
  // The nearest few only: the rest are too far to matter in six seconds.
  const near = people.length > PLAN.look_people
    ? people.map((o) => [Math.hypot(o.x - pts[0].x, o.z - pts[0].z), o]).sort((a, b) => a[0] - b[0]).slice(0, PLAN.look_people).map(([, o]) => o)
    : people;
  // A car standing still -- parked at the kerb, waiting at a light -- is not coming: the pavement
  // and the crosswalk are kept from it already. Only the ones moving are weighed.
  const moving = cars.filter((c) => Math.hypot(c.vx || 0, c.vz || 0) > 0.3);
  const lines = PLAN.sides.map((s) => weighLine(pts, times, s, near, moving, free)).sort((a, b) => a.cost - b.cost);
  const best = lines[0], alt = lines[1] || best;
  // Nothing clear: stop short of the trouble on the best line, for as long as it lasts.
  let stop = null;
  if (best.conflict && best.conflict.kind !== "wall" && best.cost > 1.2) {
    const c = best.conflict;
    const m = Math.max(0, c.m - PLAN.stop_short_m - (c.kind === "car" ? 0.6 : 0));
    // (Already at it: the stop is now; it lasts until the trouble is by, from when they get there.)
    const reach = times[Math.max(0, pts.findIndex((p) => p.m >= m))] || 0;
    stop = { m: +m.toFixed(2), for_s: +Math.min(PLAN.stop_most_s, Math.max(0.6, c.until - reach)).toFixed(2), kind: c.kind };
  }
  return { pts, steps, times, side: best.side, alt: alt.side, stop, lines: lines.map((l) => ({ side: l.side, cost: +l.cost.toFixed(3), conflict: l.conflict?.kind || null })) };
}

//: The body's lift at ``m`` metres along a plan's route (``steps`` from it): over the last
//: step_ease_m before a kerb up, risen to meet it; over the first after a kerb down, let down to
//: it -- so the figure goes up and down a kerb in a step, never popped up a frame. ``ground`` at the
//: walker already includes the kerb once they are over it.
export function stepLift(steps, m, ease = PLAN.step_ease_m) {
  const smooth = (u) => u * u * (3 - 2 * u);
  for (const s of steps) {
    if (s.rise > 0 && m > s.m - ease && m < s.m) return s.rise * smooth((m - (s.m - ease)) / ease);
    if (s.rise < 0 && m >= s.m && m < s.m + ease) return -s.rise * (1 - smooth((m - s.m) / ease));
  }
  return 0;
}

//: The pace share at ``m`` along the plan (its slope's), for the walk's own clock.
export function paceAt(plan, m) {
  const pts = plan?.pts;
  if (!pts?.length) return 1;
  for (let i = 1; i < pts.length; i += 1) if (pts[i].m >= m) return pts[i].pace;
  return pts[pts.length - 1].pace;
}
