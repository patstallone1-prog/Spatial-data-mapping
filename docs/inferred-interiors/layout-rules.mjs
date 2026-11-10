// Layout rules every generated house passes through as it is loaded (kerbside-adapter.mjs), so a
// fix reaches every published house at once, with no new run of the interior engine.
//
// 1. Nothing stands across a stair's way on or off: an inner wall crossing the landing at the top
//    of a flight (on the storey it arrives at) or at its foot is cut away there, so it is neither
//    drawn nor walked into.
// 2. A table leaves a way past it. Of its two pairs of opposite sides, the pair with the least room
//    must have at least MIN_PASS_M clear on one side. It does not stand in a door's swing or over a
//    stairwell, and it does not overlap a wall or another piece. A table that fails is moved, with
//    its chairs and whatever is on it, to the nearest place in its room that passes. It is turned
//    only by a quarter, a half or three quarters, and only where no unturned place passes. A table
//    with nowhere to go is left out.
//
// Plan coordinates are the house's own: x east, z north (position_m is [x, y, z]; footprints and
// segments are [x, z]). rotation_deg turns a piece counter-clockwise in that plan (the renderer
// sets rotation.y = -rotation_deg).

export const STAIR_LANDING_M = 0.9;     // how far past the top (or foot) of a flight is kept clear
export const MIN_PASS_M = 0.75;         // the way past a table: a walker (0.5 m) with a margin
export const SEARCH_RADIUS_M = 3.5;
export const SEARCH_STEP_M = 0.15;
const RAY_M = 2.5;
const TABLES = { dining_table: ["dining_chair"], coffee_table: [], desk: ["office_chair"] };
const NOT_FOR_TABLES = new Set(["hallway", "stair", "closet", "full_bathroom", "toilet", "utility"]);

// ---- small geometry --------------------------------------------------------------------------
const ringOf = (poly) => poly?.coordinates?.[0] || [];
function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const inPoly = (x, z, poly) => !!poly && inRing(x, z, ringOf(poly)) && !poly.coordinates.slice(1).some((r) => inRing(x, z, r));
function edges(ring) { const out = []; for (let i = 0; i < ring.length - 1; i += 1) out.push([ring[i], ring[i + 1]]); return out; }
function centroid(ring) {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}
const cross = (ax, az, bx, bz) => ax * bz - az * bx;
//: Where a ray from p along d first meets segment ab (its distance along d), or Infinity.
function rayHit(px, pz, dx, dz, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], den = cross(dx, dz, ex, ez);
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = cross(a[0] - px, a[1] - pz, ex, ez) / den, u = cross(a[0] - px, a[1] - pz, dx, dz) / den;
  return t >= -1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? Math.max(0, t) : Infinity;
}
function segmentsCross(a, b, c, d) {
  const d1 = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]), d2 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const d3 = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]), d4 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && Math.abs(d1) > 1e-12 && Math.abs(d2) > 1e-12;
}
//: The parts of segment ab outside the rectangle (centre c, unit axes u and v, half sizes hu, hv).
function clipOutside(a, b, c, u, v, hu, hv) {
  const loc = (p) => [(p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1], (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]];
  const [ax, ay] = loc(a), [bx, by] = loc(b), dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax + hu], [dx, hu - ax], [-dy, ay + hv], [dy, hv - ay]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return [[a, b]]; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return [[a, b]]; if (r > t0) t0 = r; } else { if (r < t0) return [[a, b]]; if (r < t1) t1 = r; }
  }
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const out = [];
  if (t0 > 1e-6) out.push([a, at(t0)]);
  if (t1 < 1 - 1e-6) out.push([at(t1), b]);
  return out.filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05);
}

// ---- 1. the stairs' ways on and off ----------------------------------------------------------
//: The clear rectangles at the top of each flight (on its upper storey) and at its foot.
export function stairLandings(house) {
  const out = [];
  for (const s of house.stairs || []) {
    const steps = s.steps || [];
    if (steps.length < 2) continue;
    const width = (s.flight_width_m || 1) + 0.1, tread = s.tread_m || 0.27;
    const ends = [
      { level: s.to_level, step: steps.at(-1), prev: steps.at(-2) },   // off at the top
      { level: s.from_level, step: steps[0], prev: steps[1] },         // on at the foot
    ];
    for (const e of ends) {
      const c = centroid(ringOf(e.step.footprint)), p = centroid(ringOf(e.prev.footprint));
      let ux = c[0] - p[0], uz = c[1] - p[1];
      const L = Math.hypot(ux, uz);
      if (L < 1e-6) continue;
      ux /= L; uz /= L;
      // From the step's own edge out over the landing.
      const near = tread / 2 - 0.05, far = tread / 2 + STAIR_LANDING_M;
      const mid = (near + far) / 2;
      out.push({ stair: s.id, level: e.level, centre: [c[0] + ux * mid, c[1] + uz * mid], u: [ux, uz], v: [-uz, ux], hu: (far - near) / 2, hv: width / 2 });
    }
  }
  return out;
}
function clearStairLandings(house, report) {
  const landings = stairLandings(house);
  for (const f of house.storeys || []) {
    const here = landings.filter((l) => l.level === f.level);
    if (!here.length) continue;
    const walls = [];
    for (const w of f.walls || []) {
      let pieces = edges(w.segment.coordinates);
      // Only a wall across the way: one running along it (the stairwell's sides, a hallway's
      // walls) stays.
      for (const l of here) pieces = pieces.flatMap(([a, b]) => {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, along = Math.abs(((b[0] - a[0]) * l.u[0] + (b[1] - a[1]) * l.u[1]) / L);
        return along > 0.5 ? [[a, b]] : clipOutside(a, b, l.centre, l.u, l.v, l.hu, l.hv);
      });
      const before = edges(w.segment.coordinates);
      if (pieces.length === before.length && pieces.every(([a, b], i) => a === before[i][0] && b === before[i][1])) { walls.push(w); continue; }
      report.stair_walls_cut += 1;
      for (const [a, b] of pieces) walls.push({ ...w, segment: { type: "LineString", coordinates: [a, b] }, cut_for_stair: true });
    }
    f.walls = walls;
  }
}

// ---- 2. tables -------------------------------------------------------------------------------
//: A table with what goes with it: the chairs drawn up to it and the things standing on it.
function tableGroups(f) {
  const groups = [];
  for (const t of f.objects || []) {
    const chairs = TABLES[t.role];
    if (!chairs || t.support?.kind !== "floor") continue;
    const tc = [t.position_m[0], t.position_m[2]], tr = ringOf(t.footprint);
    const reach = Math.max(...tr.map((p) => Math.hypot(p[0] - tc[0], p[1] - tc[1]))) + 0.75;
    const members = (f.objects || []).filter((o) => o !== t && (o.support?.kind === "object" && o.support.id === t.id
      || chairs.includes(o.role) && o.room_id === t.room_id && Math.hypot(o.position_m[0] - tc[0], o.position_m[2] - tc[1]) <= reach));
    groups.push({ table: t, members, centre: tc });
  }
  // A chair goes with one table only: the nearest.
  const claimed = new Map();
  for (const g of groups) for (const m of g.members) {
    const d = Math.hypot(m.position_m[0] - g.centre[0], m.position_m[2] - g.centre[1]);
    if (!claimed.has(m) || claimed.get(m).d > d) claimed.set(m, { g, d });
  }
  for (const g of groups) g.members = g.members.filter((m) => claimed.get(m).g === g);
  return groups;
}
//: The group's outline in the table's own axes (turned ``quarter`` quarter turns more), about c.
function groupBox(g, quarter, c) {
  const deg = (g.table.rotation_deg || 0) + quarter * 90, th = deg * Math.PI / 180;
  const u = [Math.cos(th), Math.sin(th)], v = [-Math.sin(th), Math.cos(th)];
  const back = (quarter * Math.PI) / 2;
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const o of [g.table, ...g.members]) {
    if (o.support?.kind !== "floor") continue;
    for (const p of ringOf(o.footprint)) {
      // Turn the point with the group, then read it in the turned table's axes.
      const rx = p[0] - g.centre[0], rz = p[1] - g.centre[1];
      const qx = rx * Math.cos(back) - rz * Math.sin(back), qz = rx * Math.sin(back) + rz * Math.cos(back);
      const a = qx * u[0] + qz * u[1], b = qx * v[0] + qz * v[1];
      lo = [Math.min(lo[0], a), Math.min(lo[1], b)]; hi = [Math.max(hi[0], a), Math.max(hi[1], b)];
    }
  }
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
  const centre = [c[0] + u[0] * mid[0] + v[0] * mid[1], c[1] + u[1] * mid[0] + v[1] * mid[1]];
  return { centre, u, v, hu: (hi[0] - lo[0]) / 2, hv: (hi[1] - lo[1]) / 2 };
}
const corners = (b) => [[1, 1], [-1, 1], [-1, -1], [1, -1], [1, 1]].map(([i, j]) => [b.centre[0] + b.u[0] * b.hu * i + b.v[0] * b.hv * j, b.centre[1] + b.u[1] * b.hu * i + b.v[1] * b.hv * j]);

//: What a table must keep clear of on storey f, but for the group's own pieces.
function obstaclesFor(house, f, g) {
  const own = new Set([g.table, ...g.members]);
  const segs = [], zones = [];
  for (const ring of f.inside?.coordinates || []) segs.push(...edges(ring));
  for (const w of f.walls || []) segs.push(...edges(w.segment.coordinates));
  for (const o of f.objects || []) if (!own.has(o) && o.support?.kind === "floor" && (o.size_m?.[1] ?? 1) > 0.05) segs.push(...edges(ringOf(o.footprint)));
  for (const s of house.stairs || []) if (s.from_level === f.level || s.to_level === f.level) {
    const poly = s.from_level === f.level ? s.footprint : (s.slab_opening || s.footprint);
    segs.push(...edges(ringOf(poly))); zones.push(poly);
  }
  for (const h of f.slab_holes || []) { segs.push(...edges(ringOf(h))); zones.push(h); }
  for (const o of f.openings || []) if (o.clearance) zones.push(o.clearance);
  return { segs, zones };
}
//: How much room the box has on each side: [+u, -u, +v, -v], the least along each side.
function sideRoom(b, segs) {
  const sides = [[b.u, b.hu, b.v, b.hv], [[-b.u[0], -b.u[1]], b.hu, b.v, b.hv], [b.v, b.hv, b.u, b.hu], [[-b.v[0], -b.v[1]], b.hv, b.u, b.hu]];
  return sides.map(([n, h, t, ht]) => {
    let least = RAY_M;
    const k = Math.max(2, Math.ceil((2 * ht) / 0.1));
    for (let i = 0; i <= k; i += 1) {
      const s = -ht + 0.02 + ((2 * ht - 0.04) * i) / k;
      const px = b.centre[0] + n[0] * h + t[0] * s, pz = b.centre[1] + n[1] * h + t[1] * s;
      for (const [a, c] of segs) least = Math.min(least, rayHit(px, pz, n[0], n[1], a, c));
      if (least <= 0) return 0;
    }
    return least;
  });
}
//: Whether the group may stand as box b: inside, overlapping nothing, out of door swings and
//: stairwells, and with a way past on the tighter pair of sides.
function placeable(b, f, room, ob) { return whyNot(b, f, room, ob) === null; }
//: Why the group may not stand as box b (null where it may).
function whyNot(b, f, room, ob) {
  const shrunk = { ...b, hu: Math.max(0.01, b.hu - 0.02), hv: Math.max(0.01, b.hv - 0.02) }, cs = corners(shrunk);
  if (!cs.every((p) => inPoly(p[0], p[1], f.inside))) return "outside";
  if (room && !inPoly(b.centre[0], b.centre[1], room.polygon)) return "other room";
  const sides = edges(cs);
  for (const [a, c] of ob.segs) {
    if (inRing(a[0], a[1], cs) || inRing(c[0], c[1], cs)) return "overlaps";
    for (const [p, q] of sides) if (segmentsCross(a, c, p, q)) return "overlaps";
  }
  for (const z of ob.zones) {
    const zr = ringOf(z);
    if (cs.some((p) => inPoly(p[0], p[1], z)) || zr.some((p) => inRing(p[0], p[1], cs))) return "in a door swing or stairwell";
    for (const [a, c] of edges(zr)) for (const [p, q] of sides) if (segmentsCross(a, c, p, q)) return "in a door swing or stairwell";
  }
  const [pu, nu, pv, nv] = sideRoom(b, ob.segs);
  const tighter = pu + nu <= pv + nv ? [pu, nu] : [pv, nv];
  return Math.max(...tighter) >= MIN_PASS_M ? null : "no way past";
}
//: Move and turn every piece of the group: turned ``quarter`` quarter turns about the table's
//: centre, then shifted by (dx, dz).
function moveGroup(g, quarter, dx, dz) {
  const th = (quarter * Math.PI) / 2, c = Math.cos(th), s = Math.sin(th), [cx, cz] = g.centre;
  const tf = (p) => { const rx = p[0] - cx, rz = p[1] - cz; return [cx + rx * c - rz * s + dx, cz + rx * s + rz * c + dz]; };
  for (const o of [g.table, ...g.members]) {
    const [x, z] = tf([o.position_m[0], o.position_m[2]]);
    o.position_m = [x, o.position_m[1], z];
    o.footprint = { ...o.footprint, coordinates: o.footprint.coordinates.map((r) => r.map(tf)) };
    if (Array.isArray(o.interaction_point_m)) o.interaction_point_m = tf(o.interaction_point_m);
    o.rotation_deg = (((o.rotation_deg || 0) + quarter * 90) % 360 + 360) % 360;
    o.layout_rule = quarter || dx || dz ? "moved_for_passage" : o.layout_rule;
  }
}
function placeTables(house, f, report) {
  for (const g of tableGroups(f)) {
    const ob = obstaclesFor(house, f, g), room = (f.rooms || []).find((r) => r.id === g.table.room_id) || null;
    report.tables += 1;
    const why = whyNot(groupBox(g, 0, g.centre), f, room, ob);
    if (why === null) continue;
    report.why = report.why || {};
    report.why[why] = (report.why[why] || 0) + 1;
    let found = null;
    const offsets = [];
    for (let x = -SEARCH_RADIUS_M; x <= SEARCH_RADIUS_M + 1e-9; x += SEARCH_STEP_M)
      for (let z = -SEARCH_RADIUS_M; z <= SEARCH_RADIUS_M + 1e-9; z += SEARCH_STEP_M)
        if (Math.hypot(x, z) <= SEARCH_RADIUS_M) offsets.push([x, z, Math.hypot(x, z)]);
    offsets.sort((a, b) => a[2] - b[2]);
    // Unturned first, at any distance; turned only where unturned has nowhere.
    for (const rooms of [room ? [room] : [], (f.rooms || []).filter((r) => r !== room && !NOT_FOR_TABLES.has(r.kind))]) {
      for (const quarter of [0, 1, 3, 2]) {
        for (const [dx, dz] of offsets) {
          const c = [g.centre[0] + dx, g.centre[1] + dz];
          const target = rooms.find((r) => inPoly(c[0], c[1], r.polygon));
          if (!target || !placeable(groupBox(g, quarter, c), f, target, ob)) continue;
          found = { quarter, dx, dz }; break;
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) {
      // Nowhere passes: the table and what goes with it are left out rather than block the way.
      const gone = new Set([g.table, ...g.members]);
      f.objects = f.objects.filter((o) => !gone.has(o));
      report.tables_removed += 1;
      continue;
    }
    moveGroup(g, found.quarter, found.dx, found.dz);
    report.tables_moved += 1;
    if (found.quarter) report.tables_turned += 1;
  }
}

//: The house as the rules have it: a corrected copy (the original is left as it was) with a
//: ``layout_rules`` report of what was changed.
export function applyLayoutRules(house) {
  const out = structuredClone(house);
  const report = { stair_walls_cut: 0, tables: 0, tables_moved: 0, tables_turned: 0, tables_removed: 0 };
  try {
    clearStairLandings(out, report);
    for (const f of out.storeys || []) placeTables(out, f, report);
  } catch (error) {
    report.error = String(error?.message || error);
    return Object.assign(structuredClone(house), { layout_rules: report });
  }
  out.layout_rules = report;
  return out;
}
