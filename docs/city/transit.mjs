// Buses on the real routes. Where Muni's timetable for the district is to hand
// (docs/city/muni-routes.json, scripts/build_muni_routes.py), each route and direction is run as
// the timetable runs it: its own stops in its own order, one bus for each trip, leaving the first
// stop at the minute it is timetabled to -- every six minutes on the 22 at noon on a weekday,
// every half hour on the owl at three in the morning, none on the 30X at the weekend -- with its
// number and where it is going on its sign. Any other route: its stops in the district
// (docs/transit-stops.json, from SFMTA's GTFS) put in order along it and joined by the streets,
// buses out and back every few minutes. Where each bus is follows from the clock, so a party
// sees the same buses at the same stops without sending a byte (tests/city.test.mjs).

import { cityTime } from "./core.mjs";
import { LANE, alongRoute } from "./people.mjs";

//: A bus keeps to its lane, clear of the cars parked at the kerb (people.mjs LANE) -- never the
//: parking lane, except at a stop: there, where the street has a parking lane, it pulls in to
//: the kerb (a stop's kerb is kept clear of parked cars) and straight back out into its lane
//: when it leaves, over ``pull_m`` either side; where there is none, its lane is at the kerb
//: already and it stands in it.
export const BUS_KERB_M = 1.45;
export function busSide(pull) {
  const w = Math.max(0, Math.min(1, pull)), e = w * w * (3 - 2 * w);
  return (half, cls, park) => {
    const lane = LANE(half, cls, park), parked = park === true || (park === null && cls === "residential");
    const kerb = parked ? Math.max(lane, half - BUS_KERB_M) : lane;
    return lane + (kerb - lane) * e;
  };
}

//: The district's bus lines from ``stops`` ([{id, name, lon, lat, routes, modes}]) on ``streets``;
//: with ``timetable`` (muni-routes.json), its routes as it runs them and the rest out and back.
export function buildLines(R, stops, streets, toXZ, timetable = null) {
  const T = R.transit_lines, byRoute = new Map();
  const lines = timetable ? timetabledLines(R, timetable, streets, toXZ) : [];
  const timed = new Set(lines.map((l) => l.route));
  for (const stop of stops) {
    if (!(stop.modes || []).includes("bus")) continue;
    const [x, z] = toXZ(stop.lon, stop.lat);
    const node = streets.nearest(x, z, "drive", 60);
    if (node === null || node === undefined) continue;
    for (const route of stop.routes || []) {
      if (timed.has(route)) continue;
      if (!byRoute.has(route)) byRoute.set(route, []);
      byRoute.get(route).push({ id: stop.id, name: stop.name, x, z, node });
    }
  }
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
      const at = alongRoute(on.leg, on.off, busSide(1));
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
    lines.push({ route, stops: clusters, timeline, cycle: t, buses, pull_m: T.pull_m ?? 18 });
  }
  return lines;
}
//: The timetabled lines: each entry of ``timetable.lines`` whose stops stand on ``streets``, one
//: way, from its first stop to its last; its trips leave the first at the timetable's minutes
//: (``schedule``), and take the timetable's time to the last (each leg's drive stretched or
//: shrunk to it, at a speed a bus keeps).
function timetabledLines(R, timetable, streets, toXZ) {
  const T = R.transit_lines, out = [];
  timetable.lines.forEach((entry, i) => {
    const kept = [];
    entry.stops.forEach((s, k) => {
      const [x, z] = toXZ(s.lon, s.lat);
      const node = streets.nearest(x, z, "drive", 60);
      if (node === null || node === undefined) return;
      const pole = { id: s.id, name: s.name, x, z, node };
      kept.push({ x, z, name: s.name, poles: [pole], node, minute: entry.minutes[k] });
    });
    // Joined by the streets, as far as they go unbroken.
    const legs = [];
    for (let k = 0; k + 1 < kept.length; k += 1) {
      const leg = streets.route(kept[k].node, kept[k + 1].node, "drive");
      if (!leg || leg.length > 3000) break;
      legs.push({ leg, off: Math.min(10, leg.length * 0.3), stop: k, next: k + 1 });
    }
    if (!legs.length) return;
    const stops = kept.slice(0, legs.length + 1);
    // The drives: the timetable's minutes from the first stop to the last, less the stands at the
    // stops between, shared by length -- at no less than 2.5 m/s nor more than 13.
    const lens = legs.map((L, k) => L.leg.length - L.off + (legs[k + 1] ? legs[k + 1].off : 0));
    const total = lens.reduce((a, b) => a + b, 0);
    const timed = (stops[stops.length - 1].minute - stops[0].minute) * 60 - T.dwell_s * (stops.length - 2);
    const speed = Math.max(2.5, Math.min(13, timed > 0 ? total / timed : T.speed_ms));
    const timeline = [];
    let t = 0;
    for (let k = 0; k < stops.length; k += 1) {
      const L = legs[k], prev = legs[k - 1];
      const at = L ? alongRoute(L.leg, L.off, busSide(1)) : alongRoute(prev.leg, prev.leg.length, busSide(1));
      timeline.push({ kind: "dwell", stop: k, t0: t, t1: t + T.dwell_s, at, pole: { x: stops[k].x, z: stops[k].z } });
      t += T.dwell_s;
      if (!L) break;
      const after = legs[k + 1] || null, length = lens[k], secs = Math.max(4, length / speed);
      timeline.push({ kind: "drive", stop: k, next: k + 1, leg: L.leg, from: L.off, after: after?.leg || null, afterOff: after?.off || 0, length, t0: t, t1: t + secs });
      t += secs;
    }
    out.push({ route: entry.route, stops, timeline, cycle: t, buses: null, pull_m: T.pull_m ?? 18,
      sign: { route: entry.route, name: entry.name, to: entry.headsign },
      schedule: { key: `${entry.route}-${entry.direction}-${i}`, zone: timetable.zone || R.clock?.zone || "America/Los_Angeles", departs: entry.departs, lead: T.dwell_s } });
  });
  return out;
}

//: The timetable each day of the week runs (Sunday first), as muni-routes.json names them.
const DAY_KIND = ["sunday", "weekday", "weekday", "weekday", "weekday", "weekday", "saturday"];
let dayMemo = { key: "", value: null };
//: The city's day at ``sec`` (s since epoch): its midnight (s since epoch) and weekday (Sunday 0).
export function serviceDay(sec, zone) {
  const key = `${zone}:${Math.floor(sec / 60)}`;
  if (dayMemo.key === key) return dayMemo.value;
  // In whole seconds: the clock's own, so a trip's start (and its id) is the same whenever asked.
  const whole = Math.floor(sec), t = cityTime(whole * 1000, zone);
  const value = { start: whole - Math.round(t.minute * 60), weekday: t.weekday };
  dayMemo = { key, value };
  return value;
}
//: A timetabled line's trips, ``back`` days before ``sec``'s to ``ahead`` after: [{id, start}],
//: ``start`` when the trip's timeline begins (s since epoch: its stand at the first stop).
function tripsAround(line, sec, back = 1, ahead = 0) {
  const S = line.schedule, today = serviceDay(sec, S.zone), out = [];
  for (let d = -back; d <= ahead; d += 1) {
    const start = today.start + d * 86400, kind = DAY_KIND[((today.weekday + d) % 7 + 7) % 7];
    for (const m of S.departs[kind] || []) {
      const at = start + m * 60 - S.lead;
      out.push({ id: `bus:${line.route}:${S.key}:${at}`, start: at });
    }
  }
  return out;
}
//: The line's buses out at ``sec`` (s since epoch): [{id, phase}], ``phase`` the seconds into the
//: line's timeline. A timetabled line has one for each trip on the road; another, ``buses`` going
//: round, evenly spaced.
export function busPhases(line, sec) {
  if (line.schedule) {
    return tripsAround(line, sec).filter((trip) => sec >= trip.start && sec < trip.start + line.cycle).map((trip) => ({ id: trip.id, phase: sec - trip.start }));
  }
  const out = [];
  for (let j = 0; j < line.buses; j += 1) out.push({ id: `bus:${line.route}:${j}`, phase: ((sec + j * line.cycle / line.buses) % line.cycle + line.cycle) % line.cycle });
  return out;
}
//: When the line's buses next stand at the timeline's ``seg`` (a dwell), from ``sec`` on: the
//: times (s since epoch) each begins standing there, soonest first, ``count`` of them -- one there
//: already counts (its time is then before ``sec``). Within ``horizon`` seconds.
export function arrivalsAt(line, seg, sec, count = 2, horizon = 4 * 3600) {
  const dur = seg.t1 - seg.t0, out = [];
  if (line.schedule) {
    for (const trip of tripsAround(line, sec, 1, 1)) {
      const at = trip.start + seg.t0;
      if (at + dur > sec && at < sec + horizon) out.push({ id: trip.id, at });
    }
  } else {
    for (const { id, phase } of busPhases(line, sec)) {
      const C = line.cycle;
      out.push({ id, at: phase >= seg.t0 && phase < seg.t1 ? sec - (phase - seg.t0) : sec + ((seg.t0 - phase) % C + C) % C });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, count);
}
//: Every bus at ``ms``: where it is, which way it faces, and whether it is standing at a stop.
//: ``lag`` (bus id -> seconds): how far behind the timetable a bus is running, held at a stop.
export function busesAt(lines, ms, lag = null) {
  const out = [];
  for (const line of lines) {
    for (const bus of busPhases(line, ms / 1000)) {
      const id = bus.id;
      let phase = bus.phase - (lag?.get(id) || 0);
      if (line.schedule) { if (phase < 0) phase = 0; } else phase = (phase % line.cycle + line.cycle) % line.cycle;
      const tl = line.timeline;
      let lo = 0, hi = tl.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tl[m].t0 <= phase) lo = m; else hi = m - 1; }
      const seg = tl[lo];
      if (seg.kind === "dwell") {
        const pos = seg.at;
        // (A timetabled bus at its last stop goes no further: nothing next.)
        const next = tl[lo + 1]?.next ?? (line.schedule ? null : tl[1]?.next ?? null);
        out.push({ id, route: line.route, sign: line.sign || null, model: "bus", x: pos.x, z: pos.z, yaw: pos.yaw, speed: 0, moving: false, dwelling: true, stop: seg.stop, pole: seg.pole,
          stopName: line.stops[seg.stop].name, next, nextName: next !== null ? line.stops[next].name : null, leaves: (seg.t1 - phase) });
      } else {
        // Along the leg from where it stood, past the next stop's corner to where it stands there.
        const d = seg.length * (phase - seg.t0) / (seg.t1 - seg.t0), rest = seg.leg.length - seg.from;
        // Out from the kerb as it leaves the stop, in to it as it comes up to the next.
        const P = line.pull_m ?? 18, side = busSide(Math.max(1 - d / P, 1 - (seg.length - d) / P));
        const pos = d < rest || !seg.after ? alongRoute(seg.leg, seg.from + d, side) : alongRoute(seg.after, d - rest, side);
        out.push({ id, route: line.route, sign: line.sign || null, model: "bus", x: pos.x, z: pos.z, yaw: pos.yaw, speed: seg.length / (seg.t1 - seg.t0), moving: true, dwelling: false,
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

// ---- the edge of the world ------------------------------------------------------------------------
//: City mode holds one area (module 30 cityLock: the Marina) but the buses run Muni's real routes
//: (muni-routes.json, kept whole), which go on out of it. Riding one, you are set down at the last
//: stop inside the area, with this, and the bus goes on along its route without you. (The walker
//: and the car stop at the area's edge with the same words.) The switch is the Explore / City
//: one in the panel the ☰ City button opens.
export const BOUNDARY_MESSAGE = "World boundary reached. To keep exploring, switch modes: open ☰ City and choose Explore.";
//: For each drive of the line's timeline (keyed "stop>next"): whether it goes out of the area
//: (``inArea(x, z)``) anywhere between the two stops' stands, or ends outside it. Kept on the line.
export function exitsOf(line, inArea) {
  if (line._exits && line._exitsFor === inArea) return line._exits;
  const out = new Map(), tl = line.timeline;
  for (let i = 0; i < tl.length; i += 1) {
    const s = tl[i];
    if (s.kind !== "drive") continue;
    let leaves = false;
    const pts = (route, from, to) => { for (let k = 0; k < route.pts.length && !leaves; k += 1) if (route.s[k] >= from - 1e-6 && route.s[k] <= to + 1e-6 && !inArea(route.pts[k][0], route.pts[k][1])) leaves = true; };
    pts(s.leg, s.from, s.leg.length);
    if (s.after) pts(s.after, 0, s.afterOff);
    const stand = tl[i + 1]?.kind === "dwell" ? tl[i + 1].at : null;
    if (stand && !inArea(stand.x, stand.z)) leaves = true;
    const key = `${s.stop}>${s.next}`;
    out.set(key, Boolean(out.get(key)) || leaves);
  }
  line._exits = out; line._exitsFor = inArea;
  return out;
}
//: Whether a rider on ``bus`` (busesAt's) is to be set down for the edge of the area: at the stop
//: it stands at, when the way on from it leaves the area ({stop, pole, name, here: true}); or,
//: the bus already outside it, at the last stop it stood at inside ({stop, pole, name, here:
//: false}: you are put back there). Null while the ride stays inside.
export function boundaryStop(line, bus, inArea) {
  if (!line || !bus || !inArea) return null;
  const exits = exitsOf(line, inArea), stand = (k) => line.timeline.find((s) => s.kind === "dwell" && s.stop === k);
  const at = (k, here) => { const d = stand(k); return d ? { stop: k, pole: d.pole, at: d.at, name: line.stops[k]?.name || null, here, message: BOUNDARY_MESSAGE } : null; };
  if (bus.dwelling) {
    if (bus.next === null || bus.next === undefined) return null;
    return exits.get(`${bus.stop}>${bus.next}`) ? at(bus.stop, true) : null;
  }
  if (inArea(bus.x, bus.z)) return null;
  // Gone out: the last stop before this drive, inside, along the timeline back from it.
  const tl = line.timeline;
  let i = tl.findIndex((s) => s.kind === "drive" && s.next === bus.next);
  for (; i >= 0; i -= 1) if (tl[i].kind === "dwell" && inArea(tl[i].at.x, tl[i].at.z)) return at(tl[i].stop, false);
  return null;
}
