// Buses on the real routes: each route's stops in the district (docs/transit-stops.json, from
// SFMTA's GTFS), put in order along the route and joined by the streets; buses out and back on a
// timetable, stopping at every stop. Where each bus is follows from the clock, so a party sees
// the same buses at the same stops without sending a byte (tests/city.test.mjs).

import { alongRoute } from "./people.mjs";

const DRIVE_SIDE = (half) => Math.max(1.7, half - 1.8);

//: The district's bus lines from ``stops`` ([{id, name, lon, lat, routes, modes}]) on ``streets``.
export function buildLines(R, stops, streets, toXZ) {
  const T = R.transit_lines, byRoute = new Map();
  for (const stop of stops) {
    if (!(stop.modes || []).includes("bus")) continue;
    const [x, z] = toXZ(stop.lon, stop.lat);
    const node = streets.nearest(x, z, "drive", 60);
    if (node === null || node === undefined) continue;
    for (const route of stop.routes || []) {
      if (!byRoute.has(route)) byRoute.set(route, []);
      byRoute.get(route).push({ id: stop.id, name: stop.name, x, z, node });
    }
  }
  const lines = [];
  for (const [route, list] of byRoute) {
    // The two sides of the street are one stop for the order along the route.
    const clusters = [];
    for (const s of list) {
      const c = clusters.find((k) => Math.hypot(k.x - s.x, k.z - s.z) < T.stop_cluster_m);
      if (c) { c.poles.push(s); c.x = c.poles.reduce((a, p) => a + p.x, 0) / c.poles.length; c.z = c.poles.reduce((a, p) => a + p.z, 0) / c.poles.length; }
      else clusters.push({ x: s.x, z: s.z, name: s.name, poles: [s] });
    }
    if (clusters.length < T.min_stops) continue;
    // In order along the route: by where each stands on the line the stops make (its main axis).
    const mx = clusters.reduce((a, c) => a + c.x, 0) / clusters.length, mz = clusters.reduce((a, c) => a + c.z, 0) / clusters.length;
    let sxx = 0, sxz = 0, szz = 0;
    for (const c of clusters) { const dx = c.x - mx, dz = c.z - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz), ax = Math.cos(angle), az = Math.sin(angle);
    clusters.sort((a, b) => (a.x - mx) * ax + (a.z - mz) * az - ((b.x - mx) * ax + (b.z - mz) * az));
    for (const c of clusters) {
      c.node = streets.nearest(c.x, c.z, "drive", 60);
      const pole = c.poles.reduce((best, p) => (Math.hypot(p.x - c.x, p.z - c.z) < Math.hypot(best.x - c.x, best.z - c.z) ? p : best), c.poles[0]);
      c.name = pole.name;
    }
    // Out to the far end and back, stopping at each stop both ways. A bus stands a few metres past
    // the stop's corner, at the kerb (a far-side stop), not on the junction itself.
    const order = [...clusters.keys(), ...[...clusters.keys()].reverse().slice(1)];
    const legs = [];
    let ok = true;
    for (let k = 0; k + 1 < order.length; k += 1) {
      const leg = streets.route(clusters[order[k]].node, clusters[order[k + 1]].node, "drive");
      if (!leg || leg.length > 6000) { ok = false; break; }
      legs.push({ leg, off: Math.min(10, leg.length * 0.3), stop: order[k], next: order[k + 1] });
    }
    if (!ok || !legs.length) continue;
    const timeline = [];
    let t = 0;
    for (let k = 0; k < order.length; k += 1) {
      // Standing on the leg about to be driven (the last stop: on the first leg, where the cycle starts again).
      const on = legs[k] || legs[0];
      const at = alongRoute(on.leg, on.off, DRIVE_SIDE);
      const c = clusters[order[k]];
      const pole = c.poles.reduce((best, q) => (Math.hypot(q.x - at.x, q.z - at.z) < Math.hypot(best.x - at.x, best.z - at.z) ? q : best), c.poles[0]);
      timeline.push({ kind: "dwell", stop: order[k], t0: t, t1: t + T.dwell_s, at, pole: { x: pole.x, z: pole.z } });
      t += T.dwell_s;
      if (k === legs.length) break;
      const L = legs[k], after = legs[k + 1] || legs[0];
      const length = L.leg.length - L.off + after.off;
      const secs = Math.max(4, length / T.speed_ms);
      timeline.push({ kind: "drive", stop: L.stop, next: L.next, leg: L.leg, from: L.off, after: after.leg, afterOff: after.off, length, t0: t, t1: t + secs });
      t += secs;
    }
    if (t < 60) continue;
    const buses = Math.max(1, Math.round(t / (T.headway_min * 60)));
    lines.push({ route, stops: clusters, timeline, cycle: t, buses });
  }
  return lines;
}
//: Every bus at ``ms``: where it is, which way it faces, and whether it is standing at a stop.
//: ``lag`` (bus id -> seconds): how far behind the timetable a bus is running, held at a stop.
export function busesAt(lines, ms, lag = null) {
  const out = [];
  for (const line of lines) {
    for (let j = 0; j < line.buses; j += 1) {
      const id = `bus:${line.route}:${j}`;
      const t = ms / 1000 - (lag?.get(id) || 0);
      const phase = ((t + j * line.cycle / line.buses) % line.cycle + line.cycle) % line.cycle;
      const tl = line.timeline;
      let lo = 0, hi = tl.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tl[m].t0 <= phase) lo = m; else hi = m - 1; }
      const seg = tl[lo];
      if (seg.kind === "dwell") {
        const pos = seg.at;
        const next = tl[lo + 1]?.next ?? tl[1]?.next ?? null;
        out.push({ id, route: line.route, model: "bus", x: pos.x, z: pos.z, yaw: pos.yaw, speed: 0, moving: false, dwelling: true, stop: seg.stop, pole: seg.pole,
          stopName: line.stops[seg.stop].name, next, nextName: next !== null ? line.stops[next].name : null, leaves: (seg.t1 - phase) });
      } else {
        // Along the leg from where it stood, past the next stop's corner to where it stands there.
        const d = seg.length * (phase - seg.t0) / (seg.t1 - seg.t0), rest = seg.leg.length - seg.from;
        const pos = d < rest ? alongRoute(seg.leg, seg.from + d, DRIVE_SIDE) : alongRoute(seg.after, d - rest, DRIVE_SIDE);
        out.push({ id, route: line.route, model: "bus", x: pos.x, z: pos.z, yaw: pos.yaw, speed: seg.length / (seg.t1 - seg.t0), moving: true, dwelling: false,
          stop: null, next: seg.next, nextName: line.stops[seg.next].name, leaves: 0 });
      }
    }
  }
  return out;
}
//: The bus stops of the lines, for drawing and for waiting at: [{x, z, name, routes}].
export function stopsOf(lines) {
  const out = [];
  for (const line of lines) for (const c of line.stops) {
    const near = out.find((s) => Math.hypot(s.x - c.x, s.z - c.z) < 30);
    if (near) { if (!near.routes.includes(line.route)) near.routes.push(line.route); } else out.push({ x: c.x, z: c.z, name: c.name, routes: [line.route] });
  }
  return out;
}
