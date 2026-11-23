// Fences on property lines (docs/property-fences.json, tools/build_property_fences.py): which
// stretches of a line actually carry fence once the buildings and streets standing there are
// known, and where its gates are.
//
// A gate that was surveyed or mapped is kept where it is. The rest are inferred, and only have to
// be logical: on the side people arrive from (the page scores each spot: beside a footway, facing
// a street, not at a corner), never two side by side (GATE.min_apart_m), and never further apart
// along one fence than GATE.max_between_m -- a long fence has several.
//
// Everything is in the page's flat metres ([x, z]); nothing here touches the scene.

export const GATE = {
  //: The most fence between two ways in (m): a longer stretch gets another gate.
  max_between_m: 80,
  //: No two gates nearer than this (m, in a straight line).
  min_apart_m: 15,
  //: A gate stands this far from a fence's end or a corner of it at least (m).
  corner_m: 2.5,
  //: A recorded gate further than this from any fence drawn is not one of this fence's (m).
  snap_m: 5,
  walk_w: 1.5,
  drive_w: 6,
  //: The shortest fence that gets a gate of its own (m).
  least_fence_m: 6,
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

//: A polyline's length and the running length at each point.
function measure(points) {
  const s = [0];
  for (let i = 1; i < points.length; i += 1) s.push(s[i - 1] + dist(points[i - 1], points[i]));
  return s;
}
//: The point `d` along a measured polyline, and the way it runs there ([x, z, ux, uz]).
export function pointAlong(points, s, d) {
  const total = s[s.length - 1];
  const at = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < s.length - 1 && s[i] < at) i += 1;
  const span = s[i] - s[i - 1] || 1, t = (at - s[i - 1]) / span, a = points[i - 1], b = points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / span, (b[1] - a[1]) / span];
}

//: The stretches of `lines` (polylines; a ring is one that ends where it began) that carry fence:
//: walked a `step` at a time, a sample is fence unless `blocked(x, z, ux, uz)` says something else
//: is the barrier there (a building's wall, a roadway, a fence already drawn). Stretches shorter
//: than `least` are dropped; a gap shorter than `bridge` between two stretches is closed.
export function fenceRuns(lines, { blocked = () => false, step = 1, least = 2, bridge = 2.2 } = {}) {
  const runs = [];
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    const s = measure(line), total = s[s.length - 1];
    if (!(total > least)) continue;
    const n = Math.max(1, Math.round(total / step)), marks = [];
    for (let k = 0; k <= n; k += 1) {
      const d = (k / n) * total, [x, z, ux, uz] = pointAlong(line, s, d);
      marks.push({ d, free: !blocked(x, z, ux, uz) });
    }
    // Stretches of free samples, as [from, to] along the line.
    let spans = [], from = null;
    for (let k = 0; k < marks.length; k += 1) {
      if (marks[k].free && from === null) from = marks[k].d;
      if ((!marks[k].free || k === marks.length - 1) && from !== null) {
        const to = marks[k].free ? marks[k].d : marks[k - 1].d;
        spans.push([from, to]); from = null;
      }
    }
    const joined = [];
    for (const span of spans) {
      const last = joined[joined.length - 1];
      if (last && span[0] - last[1] <= bridge) last[1] = span[1]; else joined.push(span.slice());
    }
    const closed = dist(line[0], line[line.length - 1]) < 0.01;
    // The line's own corners inside a stretch are kept: a fence turns where its line turns.
    const stretch = (a, b) => {
      const pts = [pointAlong(line, s, a).slice(0, 2)];
      for (let i = 1; i < line.length - 1; i += 1) if (s[i] > a + 0.05 && s[i] < b - 0.05) pts.push(line[i]);
      pts.push(pointAlong(line, s, b).slice(0, 2));
      return pts;
    };
    // Round a ring, the stretch that ends where the ring began and the one that begins there are one.
    let wrap = null;
    if (closed && joined.length > 1 && joined[0][0] <= 1e-6 && joined[joined.length - 1][1] >= total - 1e-6) wrap = [joined.pop(), joined.shift()];
    if (wrap && wrap[0][1] - wrap[0][0] + wrap[1][1] - wrap[1][0] >= least) {
      const head = stretch(wrap[0][0], wrap[0][1]), tail = stretch(wrap[1][0], wrap[1][1]);
      runs.push({ points: [...head, line[0], ...tail.slice(1)].filter((p, i, all) => !i || dist(p, all[i - 1]) > 1e-9), whole: false });
    }
    for (const [a, b] of joined) {
      if (b - a < least) continue;
      runs.push({ points: stretch(a, b), whole: closed && a <= 1e-6 && b >= total - 1e-6 });
    }
  }
  return runs;
}

//: Where a run turns by more than a little: gates keep clear of those (and of its ends).
function corners(points, s) {
  const out = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
    const turn = Math.abs(Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz));
    if (turn > 0.5) out.push(s[i]);
  }
  return out;
}

//: The gates of one property's fence.
//:
//: `runs` are fenceRuns' (each `{ points, whole }`); `known` the recorded gates (`{ x, z, w }`);
//: `score(x, z, ux, uz)` how good a place for a way in a spot is (higher is better; -Infinity
//: never) -- the page's knowledge of footways, streets and doors. Returns `{ run, at, w, x, z,
//: basis }` (``at``: metres along that run), recorded ones first.
export function placeGates(runs, { known = [], score = () => 0, rules = GATE, drive = false } = {}) {
  const R = { ...GATE, ...rules }, gates = [];
  const M = runs.map((run) => { const s = measure(run.points); return { s, total: s[s.length - 1], corners: corners(run.points, s) }; });
  const fenceLength = M.reduce((a, m) => a + m.total, 0);
  if (!(fenceLength >= R.least_fence_m)) return gates;
  const apart = (x, z, least = R.min_apart_m) => gates.every((g) => Math.hypot(g.x - x, g.z - z) >= least);
  const fits = (i, at, w) => {
    const m = M[i], clear = R.corner_m + w / 2;
    // (A fence all the way round has no ends to keep clear of.)
    if (!runs[i].whole && (at < clear || at > m.total - clear)) return false;
    return m.corners.every((c) => Math.abs(c - at) >= clear);
  };
  // Recorded gates: on the fence where they were recorded, the first of any two side by side.
  for (const k of known) {
    let best = null;
    runs.forEach((run, i) => {
      const m = M[i];
      for (let d = 0; d <= m.total; d += 0.5) {
        const [x, z] = pointAlong(run.points, m.s, d), off = Math.hypot(x - k.x, z - k.z);
        if (off <= R.snap_m && (!best || off < best.off)) best = { off, run: i, at: d, x, z };
      }
    });
    const w = Math.max(1, Math.min(R.drive_w, k.w || R.walk_w));
    if (best && apart(best.x, best.z, Math.max(3, w))) gates.push({ run: best.run, at: best.at, w, x: best.x, z: best.z, basis: "recorded", src: k.src });
  }
  const width = drive ? R.drive_w : R.walk_w;
  // The best spot of a stretch [from, to] of run i that is clear of corners and of other gates.
  const bestIn = (i, from, to) => {
    let best = null;
    const run = runs[i], m = M[i];
    for (let d = from; d <= to; d += 1) {
      if (!fits(i, d, width)) continue;
      const [x, z, ux, uz] = pointAlong(run.points, m.s, d);
      if (!apart(x, z)) continue;
      const v = score(x, z, ux, uz);
      if (!(v > -Infinity)) continue;
      // (Equal scores: the middle of the stretch, so a lone gate is not at one end.)
      const mid = -Math.abs(d - (from + to) / 2) * 1e-3;
      if (!best || v + mid > best.v) best = { v: v + mid, at: d, x, z };
    }
    return best;
  };
  // No way in at all: the best place anywhere on the fence.
  if (!gates.length) {
    let best = null;
    runs.forEach((_, i) => { const b = bestIn(i, 0, M[i].total); if (b && (!best || b.v > best.v)) best = { ...b, run: i }; });
    if (best) gates.push({ run: best.run, at: best.at, w: width, x: best.x, z: best.z, basis: "inferred_best_approach" });
  }
  // Then no stretch of fence longer than the most allowed between two ways in.
  for (let guard = 0; guard < 200; guard += 1) {
    let worst = null;
    runs.forEach((run, i) => {
      const m = M[i], cuts = gates.filter((g) => g.run === i).map((g) => g.at).sort((a, b) => a - b);
      const marks = run.whole && cuts.length ? [...cuts, cuts[0] + m.total] : [0, ...cuts, m.total];
      for (let k = 1; k < marks.length; k += 1) {
        const len = marks[k] - marks[k - 1];
        if (len > R.max_between_m && (!worst || len > worst.len)) worst = { len, run: i, from: marks[k - 1], to: marks[k] };
      }
    });
    if (!worst) break;
    const m = M[worst.run], quarter = worst.len / 4;
    // (A ring's stretch may run past its start: looked for in two pieces.)
    const pieces = worst.to > m.total ? [[worst.from + quarter, Math.min(m.total, worst.to - quarter)], [0, worst.to - m.total - quarter]] : [[worst.from + quarter, worst.to - quarter]];
    let best = null;
    for (const [a, b] of pieces) { if (b < a) continue; const q = bestIn(worst.run, a, b); if (q && (!best || q.v > best.v)) best = q; }
    if (!best) {
      // Nowhere scored in the middle half: the middle itself, if it is clear of the others.
      const mid = ((worst.from + worst.to) / 2) % m.total, [x, z] = pointAlong(runs[worst.run].points, m.s, mid);
      if (!apart(x, z, 3)) break;
      best = { at: mid, x, z };
    }
    gates.push({ run: worst.run, at: best.at, w: width, x: best.x, z: best.z, basis: "inferred_max_fence_between" });
  }
  return gates;
}

//: A run with its gates cut out of it: the stretches of fence left (`panels`, polylines) and each
//: opening's two posts (`openings`: `{ a, b, w, basis }`, a and b the post positions).
export function cutGates(run, gates) {
  const s = measure(run.points), total = s[s.length - 1];
  const cuts = gates.map((g) => ({ lo: Math.max(0, g.at - g.w / 2), hi: Math.min(total, g.at + g.w / 2), g })).sort((p, q) => p.lo - q.lo);
  const panels = [], openings = [];
  const piece = (a, b) => {
    if (b - a < 0.2) return;
    const pts = [pointAlong(run.points, s, a).slice(0, 2)];
    for (let i = 1; i < run.points.length - 1; i += 1) if (s[i] > a + 0.05 && s[i] < b - 0.05) pts.push(run.points[i]);
    pts.push(pointAlong(run.points, s, b).slice(0, 2));
    panels.push(pts);
  };
  let at = 0;
  for (const c of cuts) {
    if (c.lo > at) piece(at, c.lo);
    openings.push({ a: pointAlong(run.points, s, c.lo).slice(0, 2), b: pointAlong(run.points, s, c.hi).slice(0, 2), w: c.hi - c.lo, basis: c.g.basis });
    at = Math.max(at, c.hi);
  }
  if (at < total) piece(at, total);
  return { panels, openings };
}
