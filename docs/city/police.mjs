// The police on the street (2026-11-24): who calls them, the car that comes, the chase, the stop.
//
// law.mjs decides what is a crime and how it is caught; this is what you see of it.
//
//   A witness       -- a bystander as their temperament has it, weighed by how bad it was; the one
//                      you hurt, once you have gone -- takes out their phone (the "phone" clip) and
//                      talks. Ten seconds and it is through; come at them first and it is not.
//   The car         is the nearest of the city's patrols where it is on its round, else one out of
//                      the station: by the streets, siren wailing and lights going, faster than
//                      the traffic. Not there the moment it is called.
//   At the scene    it looks for you. In sight, on foot: the officer gets out and runs you down.
//                      Driving: it follows. Pull over and you are cited -- or, for something you
//                      can be arrested for, taken out of the car, handcuffed, walked to the patrol
//                      car's back door and put in, and driven off; once it is out of sight you are
//                      home, booked and released with a court date. Drive on and the officer, close
//                      enough, reads your plate. Get far enough away and they lose you.
//
// createPolice(api) is the view's (view.mjs passes what it needs); the decisions are law.mjs's.
import { callPlan, callStep, crimeOf, pickUnit, pursuitStep, sirenSpeed, stopOutcome } from "./law.mjs";

const OFFICERS = ["Ramirez", "Chen", "O'Brien", "Nguyen", "Okafor", "Kowalski", "Delgado", "Park", "Sullivan", "Haddad"];
const FIRST = ["Maria", "David", "Kevin", "Linh", "Grace", "Tom", "Ana", "Joon", "Erin", "Sami"];

//: Where along a polyline ``pts`` ([[x, z], ...], with cumulative lengths ``s``) distance ``d``
//: is: {x, z, yaw}.
export function alongTrail(pts, s, d) {
  if (pts.length < 2) return { x: pts[0][0], z: pts[0][1], yaw: 0 };
  d = Math.max(0, Math.min(s[s.length - 1], d));
  let i = 1;
  while (i < s.length - 1 && s[i] < d) i += 1;
  const a = pts[i - 1], b = pts[i], L = s[i] - s[i - 1] || 1, k = (d - s[i - 1]) / L;
  return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, yaw: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) };
}
//: The light bar's flash at time ``t`` (s): [red, blue] 0..1 -- a double flash each side, the
//: sides taking turns (the "wig-wag" pattern of a modern bar), 1.6 times a second.
export function barFlash(t) {
  const u = (t * 1.6) % 1, pulse = (x) => (x % 0.25 < 0.09 ? 1 : 0);
  return u < 0.5 ? [pulse(u), 0] : [0, pulse(u - 0.5)];
}

export function createPolice(api) {
  const { THREE, R, group, notify, send, me, car, speedLimitAt, streets, alongRoute, lane, patrolCars, stationAt, exitCar, entering, placeAvatar, avatarVisible, homeAt, groundAt, fmt, faceYaw } = api;
  const L = R.law, D = L.dispatch, Q = L.pursuit, A = L.arrest;
  const crimes = [];          // offences waiting on a witness: {id, offence, kind, x, z, t0, victim, plate, considered, callers}
  const units = new Map();    // cars sent: id -> unit
  const hidden = new Set();   // the city's own patrol cars taken off their round while they answer
  let arrest = null, siren = null, cuffs = null, pose = null;
  const busy = () => new Set([...units.values()].map((u) => u.fromId));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const focus = () => (car.active ? car : me());
  const nameFor = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `${FIRST[h % FIRST.length]} ${OFFICERS[(h >>> 5) % OFFICERS.length]}`; };

  // ---- what they saw, and who calls ---------------------------------------------------------
  //: An offence of yours just done (the world's record: {id, crime, severity}), where it was.
  //: ``victim``: the one it was done to ({id, name}: they may call); ``plate``: the car's; a patrol
  //: car near sees it itself.
  function crime(o, at, { victim = null, plate = null, alarm = false, unseenVictim = false } = {}) {
    if (!o?.id) return;
    const c = { id: o.id, offence: o.id, kind: o.crime, severity: o.severity, x: at.x, z: at.z, t0: performance.now(), victim, plate, alarm, considered: new Set(), callers: new Map(), reported: false, told: false };
    crimes.push(c);
    if (crimes.length > 8) crimes.shift();
    // A victim in a car (the other driver in a crash) calls from it: not drawn, but timed the same.
    if (victim && unseenVictim) { const plan = callPlan(R, c.kind, { role: "victim", seed: `${c.id}:victim` }); if (plan.calls) c.callers.set(`victim:${victim.id}`, { plan, unseen: true, name: victim.name, role: "victim" }); }
    // An officer who saw it.
    const near = [...units.values(), ...patrolCars()].map((u) => ({ id: u.id, x: u.x, z: u.z, unit: units.has(u.id) })).find((u) => dist(u, at) <= R.enforcement.witness.police_reach_m);
    if (near) seenByPolice(c, near);
  }
  //: Seen by an officer: it is theirs at once -- reported, and after you from where they are.
  function seenByPolice(c, u) {
    c.reported = true;
    send("report_crime", { offence: c.offence, by: { kind: "police", name: nameFor(u.id) } }).catch(() => {});
    const unit = units.get(u.id) || startUnit({ id: u.id, x: u.x, z: u.z, from: units.has(u.id) ? "unit" : "patrol" }, c, null);
    if (unit) { unit.offences.add(c.offence); unit.kinds.set(c.offence, c.kind); if (unit.phase === "coming" || unit.phase === "search" || unit.phase === "leaving") beginPursuit(unit); }
  }
  //: Speeding seen by a patrol car (enforcement.mjs witnessOf, the world's speed_camera): after you.
  function speeding(o, seen) {
    const c = { id: o.id, offence: o.id, kind: "speeding", severity: 1, x: focus().x, z: focus().z, t0: performance.now(), considered: new Set(), callers: new Map(), reported: true };
    const unit = units.get(seen.id) || startUnit({ id: seen.id, x: seen.x, z: seen.z, from: "patrol" }, c, null);
    if (unit) { unit.offences.add(o.id); unit.kinds.set(o.id, "speeding"); if (unit.phase !== "pursuit" && unit.phase !== "stop" && unit.phase !== "arrest") { beginPursuit(unit); notify("Lights and a siren behind you: a patrol car. Pull over (stop) -- or don't."); } }
  }
  //: The people near you, a frame on (the view's crowd loop): those who saw something of yours
  //: decide whether to call (law.mjs callPlan, by who they are and how bad it was), and a caller
  //: is drawn getting their phone out and talking. ``entry``: their frame's entry (moved, posed).
  function personFrame(id, entry, mindOf, dt, down = false) {
    if (!crimes.length) return false;
    let mind = null;
    const you = focus();
    let posed = false;
    for (const c of crimes) {
      if (c.reported) continue;
      if (!c.considered.has(id) && Math.hypot(entry.x - c.x, entry.z - c.z) < 24 && performance.now() - c.t0 < 30_000) {
        c.considered.add(id);
        const role = c.victim && String(c.victim.id) === String(id) ? "victim" : "bystander";
        if (c.callers.size < 3) {
          mind ||= typeof mindOf === "function" ? mindOf() : mindOf;
          const plan = callPlan(R, c.kind, { role, temperament: mind, alarm: c.alarm, fought: role === "victim", seed: `${c.id}:${id}` });
          if (plan.calls) c.callers.set(id, { plan, name: entry.person?.name || "someone", role });
        }
      }
      const k = c.callers.get(id);
      if (!k || down) continue;
      const d = Math.hypot(entry.x - you.x, entry.z - you.z), was = k.plan.state;
      callStep(R, k.plan, dt, { attacker_m: d });
      if (k.plan.state === "phone" || k.plan.state === "talking") {
        k.at ||= { x: entry.x, z: entry.z };
        entry.x = k.at.x; entry.z = k.at.z; entry.moving = false; entry.gesture = { kind: "phone", f: 0.5 };
        entry.activity = k.plan.state === "talking" ? "calling 911" : "getting their phone out";
        entry.yaw = Math.atan2(-(you.x - entry.x), -(you.z - entry.z));
        posed = true;
        if (was !== k.plan.state && k.plan.state === "phone" && d < 60 && !c.told) { c.told = true; notify(k.role === "victim" ? `${k.name} has their phone out: they're calling the police.` : "Someone who saw it has their phone out."); }
        if (was === "talking" && k.plan.state === "phone" && d < 4) notify("You came at them: the call is cut off. They'll try again.");
      }
      if (k.plan.state === "reported") report(c, k);
    }
    return posed;
  }
  //: Callers no one draws (a driver in their car): timed the same, from where it happened.
  function stepUnseen(dt) {
    const you = focus();
    for (const c of crimes) for (const k of c.callers.values()) if (k.unseen && !c.reported) {
      callStep(R, k.plan, dt, { attacker_m: Math.hypot(you.x - c.x, you.z - c.z) });
      if (k.plan.state === "reported") report(c, k);
    }
  }
  async function report(c, k) {
    if (c.reported) return;
    c.reported = true;
    const fled = Math.hypot(focus().x - c.x, focus().z - c.z) > 40;
    const r = await send("report_crime", { offence: c.offence, by: { kind: k.role === "victim" ? "victim" : "witness", name: k.name }, call_s: k.plan.talked_s, plate: c.plate || null, fled });
    if (!r.ok) return;
    if (r.mailed) { notify(`${k.role === "victim" ? "The other driver" : "A witness"} gave 911 your plate: a ${fmt(r.mailed)} notice is in the post.`); return; }
    if (r.dispatch) dispatch(c);
  }

  // ---- the car that comes -------------------------------------------------------------------
  function routeBetween(a, b) {
    const s = streets();
    if (!s) return null;
    const na = s.nearest(a.x, a.z, "drive", 220), nb = s.nearest(b.x, b.z, "drive", 180);
    if (na === null || na === undefined || nb === null || nb === undefined) return null;
    if (na === nb) return null;
    return s.route(na, nb, "drive");
  }
  function startUnit(from, c, route) {
    if (units.has(from.id)) return units.get(from.id);
    const u = { id: from.id === "patrol:station" ? `patrol:unit:${c.id}` : from.id, fromId: from.id, from: from.from, name: nameFor(from.id), phase: "coming", route, d: 0, v: 0,
      x: from.x, z: from.z, yaw: from.yaw || 0, siren: true, offences: new Set([c.offence]), kinds: new Map([[c.offence, c.kind]]), crime: c, t: 0, officer: null, P: null, trail: null, plateRead: false };
    units.set(u.id, u);
    if (from.from === "patrol") hidden.add(from.id);
    return u;
  }
  //: A call through: the nearest patrol from where it is, by the streets to the scene.
  function dispatch(c) {
    for (const u of units.values()) if (u.crime === c || u.offences.has(c.offence)) return u;
    const at = { x: c.x, z: c.z };
    const pick = pickUnit(patrolCars(), at, stationAt(), busy());
    if (!pick) return null;
    const route = routeBetween(pick, at);
    if (!route) return null;
    const u = startUnit({ id: pick.id, x: pick.x, z: pick.z, from: pick.from }, c, route);
    notify(`A patrol car is on its way, siren on (${Math.round(route.length / 10) * 10} m off).`);
    return u;
  }
  function beginPursuit(u) {
    const you = focus();
    u.phase = "pursuit"; u.P = { t: 0, plate_s: 0, far_s: 0, still_s: 0, plate: u.plateRead }; u.siren = true;
    u.trail = { pts: [[u.x, u.z], [you.x, you.z]], s: [0, Math.hypot(you.x - u.x, you.z - u.z)] };
    u.d = 0; u.route = null;
  }
  function addTrail(u, p) {
    const T = u.trail, last = T.pts[T.pts.length - 1], step = Math.hypot(p.x - last[0], p.z - last[1]);
    if (step < 1.5) return;
    T.pts.push([p.x, p.z]); T.s.push(T.s[T.s.length - 1] + step);
    // (What is well behind the car is let go: the trail stays short however long the chase.)
    if (T.pts.length > 400) { const cut = 100, s0 = T.s[cut]; T.pts.splice(0, cut); T.s.splice(0, cut); for (let i = 0; i < T.s.length; i += 1) T.s[i] -= s0; u.d = Math.max(0, u.d - s0); }
  }
  //: A way off from where the car is, 300-500 m by the streets (null where there is none).
  function routeAway(u) {
    for (let k = 0; k < 8; k += 1) {
      const ang = k * 0.8 + u.t, to = { x: u.x + Math.cos(ang) * 420, z: u.z + Math.sin(ang) * 420 }, r = routeBetween(u, to);
      if (r && r.length >= 120) return r;
    }
    return null;
  }
  function leave(u) {
    u.phase = "leaving"; u.siren = false; u.officer = null;
    const route = routeAway(u);
    if (!route) { done(u); return; }
    u.route = route; u.d = 0; u.v = Math.max(u.v, 3);
  }
  function done(u) { units.delete(u.id); hidden.delete(u.fromId); }

  //: Each car a frame on: by the route (coming, leaving), along your trail (a chase), stopped.
  function stepUnit(u, dt) {
    u.t += dt;
    const you = focus();
    if (u.phase === "coming" || u.phase === "leaving") {
      const R0 = u.route, left = R0.length - u.d;
      const limit = speedLimitAt(u.x, u.z);
      const want = Math.min(u.phase === "coming" ? sirenSpeed(R, limit) : limit, Math.max(2, left / 1.4));
      u.v += Math.max(-8 * dt, Math.min(4 * dt, want - u.v));
      u.d = Math.min(R0.length, u.d + Math.max(0, u.v) * dt);
      const p = alongRoute(R0, u.d, lane);
      u.x = p.x; u.z = p.z; u.yaw = p.yaw;
      const sees = dist(u, you) < D.sees_m;
      if (u.phase === "coming" && sees && u.crime && !u.lost) { beginPursuit(u); return; }
      if (left <= 0.5) {
        if (u.phase === "leaving") { done(u); return; }
        u.phase = "search"; u.v = 0; u.t = 0;
        if (dist(u, you) < 120) notify("The patrol car has pulled up where it happened.");
      }
    } else if (u.phase === "search") {
      if (dist(u, you) < D.sees_m) { beginPursuit(u); return; }
      if (u.t > D.search_s) lost(u);
    } else if (u.phase === "pursuit") pursue(u, dt);
    else if (u.phase === "stop") stopped(u, dt);
  }
  function pursue(u, dt) {
    const you = focus(), driving = car.active;
    addTrail(u, you);
    const T = u.trail, end = T.s[T.s.length - 1], gap = end - u.d;
    if (driving && u.officer) { u.officer = null; }
    if (!driving && !u.officer) {
      // You on foot: the car by the streets to the nearest of them to you, then the officer out.
      u.reroute = (u.reroute || 0) - dt;
      if (u.reroute <= 0 || !u.route) { u.reroute = 2.5; u.route = routeBetween(u, you); u.d = 0; }
      const left = u.route ? u.route.length - u.d : 0;
      if (u.route && left > 1) {
        u.v += Math.max(-9 * dt, Math.min(5 * dt, Math.min(sirenSpeed(R, speedLimitAt(u.x, u.z)), left / 1.4) - u.v));
        u.d = Math.min(u.route.length, u.d + Math.max(0, u.v) * dt);
        const p = alongRoute(u.route, u.d, lane); u.x = p.x; u.z = p.z; u.yaw = p.yaw;
      }
      if (dist(u, you) < 30 || !u.route || left < 6) { u.officer = { x: u.x + Math.cos(u.yaw) * 1.1, z: u.z - Math.sin(u.yaw) * 1.1, yaw: u.yaw, moving: true, run: true }; u.v = 0; notify(`"Police! Stop right there!" An officer is out of the car and after you.`); }
    } else if (driving) {
      // Behind you at a car's length or two: faster than you when far, never into you.
      const yourV = driving ? Math.abs(car.speed) : 1.5;
      const want = Math.max(0, Math.min(D.siren_ms[1] + 4, yourV + 3 + (gap - 9) * 0.45));
      u.v += Math.max(-9 * dt, Math.min(5 * dt, want - u.v));
      u.d = Math.min(end - (driving ? 8 : 4), u.d + Math.max(0, u.v) * dt);
      const p = alongTrail(T.pts, T.s, u.d);
      u.x = p.x; u.z = p.z; u.yaw = p.yaw;
    }
    let gapNow = dist(u, you);
    if (u.officer && !driving) {
      const o = u.officer, d = dist(o, you), st = Math.min(d, Q.officer_run_ms * dt);
      o.x += ((you.x - o.x) / (d || 1)) * st; o.z += ((you.z - o.z) / (d || 1)) * st; o.yaw = Math.atan2(-(you.x - o.x), -(you.z - o.z)); o.moving = true; o.run = true;
      gapNow = dist(o, you);
    }
    const ev = pursuitStep(R, u.P, dt, { gap_m: gapNow, driving, speed: driving ? Math.abs(car.speed) : 2, sees: gapNow < D.sees_m * 1.6 });
    if (ev === "plate" && !u.plateRead) {
      u.plateRead = true;
      send("plate_read", { offences: [...u.offences], officer: { name: u.name } }).then((r) => {
        if (r.ok) notify(`Officer ${u.name} read your plate as you drove off: ${r.fines.map((f) => `${f.kind.replace(/_/g, " ")} ${fmt(f.amount)}`).join(", ")} -- and a summons to court for evading.`);
      });
    } else if (ev === "pulled_over") startStop(u);
    else if (ev === "caught") startStop(u, true);
    else if (ev === "lost") lost(u);
  }
  function lost(u) {
    if (u.lost) return;
    u.lost = true;
    send("police_lost", { offences: [...u.offences] }).then((r) => {
      if (r.ok && r.named?.length) notify("They lost you -- but the one you hurt gave the police your description: a summons will follow.");
      else if (r.ok) notify("The patrol car has lost you.");
    });
    leave(u);
  }

  // ---- stopped: a citation, or the arrest ---------------------------------------------------
  function startStop(u, onFoot = false) {
    u.phase = "stop"; u.v = 0; u.t = 0;
    const outcome = stopOutcome(R, [...u.offences].map((id) => ({ crime: u.kinds.get(id) || "speeding" })), { resisting: u.plateRead || u.resisting });
    u.stop = { outcome, step: onFoot ? (outcome === "arrest" ? "grab" : "talk") : "out", t: 0 };
    if (!u.officer) u.officer = { x: u.x, z: u.z, yaw: u.yaw, moving: false };
    u.officer.run = false;
    if (outcome === "arrest") { arrest = u; notify(`Officer ${u.name}: "Hands where I can see them!"`); }
    else notify(`Officer ${u.name} walks up. "License and registration."`);
  }
  //: Where the officer stands to you: at your driver's door in the car, beside you on foot.
  const doorOf = (yaw, at, side = 1) => ({ x: at.x - Math.cos(yaw) * 1.5 * side, z: at.z + Math.sin(yaw) * 1.5 * side });
  function walkTo(o, to, speed, dt) { const d = dist(o, to); if (d < 0.05) { o.moving = false; return true; } const st = Math.min(d, speed * dt); o.x += ((to.x - o.x) / d) * st; o.z += ((to.z - o.z) / d) * st; o.yaw = Math.atan2(-(to.x - o.x), -(to.z - o.z)); o.moving = st > 1e-4; return d - st < 0.05; }
  function stopped(u, dt) {
    const S = u.stop, o = u.officer, you = me();
    S.t += dt;
    // Driving off from the stop: the chase again, and running from it is a crime of its own.
    if ((S.step === "out" || S.step === "talk") && car.active && Math.abs(car.speed) > 2.5) {
      u.resisting = true; u.phase = "pursuit"; u.stop = null; if (arrest === u) arrest = null;
      u.officer = null; beginPursuit(u); notify("You pulled away from the stop: they're after you.");
      return;
    }
    if (S.step === "out") {
      const at = car.active ? car : you, door = car.active ? doorOf(car.yaw, car) : { x: you.x + 0.9, z: you.z };
      if (walkTo(o, door, Q.officer_walk_ms, dt)) {
        if (S.outcome === "cite") { S.step = "talk"; S.t = 0; }
        else if (car.active) { if (S.t > 2 && !S.asked) { S.asked = true; notify(`"Step out of the vehicle."`); exitCar(); } }
        else if (!entering()) { S.step = "grab"; S.t = 0; }
        o.yaw = Math.atan2(-(at.x - o.x), -(at.z - o.z));
      }
      return;
    }
    if (S.step === "talk") {
      o.moving = false; o.yaw = Math.atan2(-(you.x - o.x), -(you.z - o.z));
      if (S.t > 1 && !S.sent) {
        S.sent = true;
        send("police_stop", { offences: [...u.offences], outcome: "cite", officer: { name: u.name } }).then((r) => {
          notify(r.ok ? `Officer ${u.name} writes you up: ${r.fines.map((f) => `${f.kind.replace(/_/g, " ")} ${fmt(f.amount)}`).join(", ")}. "Drive safely."` : r.error);
        });
      }
      if (S.t > 5) { S.step = "back"; S.t = 0; }
      return;
    }
    if (S.step === "back") { if (walkTo(o, { x: u.x, z: u.z }, Q.officer_walk_ms, dt)) { u.officer = null; leave(u); } return; }
    arrested(u, dt);
  }
  //: The arrest, step by step (the steps' lengths in seconds): a hand on your arm (grab), the
  //: cuffs on behind your back (cuff), walked to the car's back door (escort), put in (seat),
  //: the car off with you in it (away) -- and, once it is out of sight, home (respawn).
  function arrested(u, dt) {
    const S = u.stop, o = u.officer, you = me();
    const behind = (yaw, at, m) => ({ x: at.x + Math.sin(yaw) * m, z: at.z + Math.cos(yaw) * m });
    if (S.step === "grab") {
      S.yaw ??= Math.atan2(-(u.x - you.x), -(u.z - you.z)) + Math.PI;   // facing away from the car: hands to the roof
      const to = behind(S.yaw, you, 0.62);
      walkTo(o, to, Q.officer_walk_ms * 1.4, dt);
      o.gesture = { kind: "grab", f: Math.min(1, S.t / 0.8) };
      faceYaw?.(S.yaw);
      pose = { kind: "hands_up", f: Math.min(1, S.t / 0.6) };
      if (S.t > 1.3) { S.step = "cuff"; S.t = 0; book(u); }
    } else if (S.step === "cuff") {
      o.moving = false; o.gesture = { kind: "cuffing", f: Math.min(1, S.t / 0.5) };
      pose = { kind: "cuffed", f: Math.min(1, S.t / 0.9) };
      if (S.t > 0.9) cuffsOn(true);
      if (S.t > 2.8) { S.step = "escort"; S.t = 0; const side = 1; S.door = { x: u.x - Math.cos(u.yaw) * 1.25 * side + Math.sin(u.yaw) * 0.55, z: u.z + Math.sin(u.yaw) * 1.25 * side + Math.cos(u.yaw) * 0.55 }; }
    } else if (S.step === "escort") {
      const d = dist(you, S.door), st = Math.min(d, 1.05 * dt), yaw = Math.atan2(-(S.door.x - you.x), -(S.door.z - you.z));
      const nx = you.x + ((S.door.x - you.x) / (d || 1)) * st, nz = you.z + ((S.door.z - you.z) / (d || 1)) * st;
      placeAvatar(nx, groundAt(nx, nz), nz, yaw);
      api.animateWalk?.(st, Math.sin(-yaw), Math.cos(-yaw));
      const at = behind(yaw, { x: nx, z: nz }, 0.55);
      o.x = at.x + Math.cos(yaw) * 0.35; o.z = at.z - Math.sin(yaw) * 0.35; o.yaw = yaw; o.moving = st > 1e-4; o.gesture = { kind: "grab", f: 1 };
      pose = { kind: "cuffed", f: 1 };
      if (d < 0.08) { S.step = "seat"; S.t = 0; }
    } else if (S.step === "seat") {
      faceYaw?.(u.yaw - Math.PI / 2);
      pose = { kind: "seated_cuffed", f: Math.min(1, S.t / 1.2) };
      o.gesture = { kind: "grab", f: 1 };
      if (S.t > 1.4) { S.step = "away"; S.t = 0; S.scene = { x: you.x, z: you.z }; avatarVisible(false); cuffsOn(false); notify("Put in the back of the patrol car."); }
    } else if (S.step === "away") {
      if (o && walkTo(o, doorOf(u.yaw, u, -1), Q.officer_walk_ms * 1.3, dt)) u.officer = null;
      if (!u.officer && !S.leaving) { S.leaving = true; u.siren = false; u.leaveRoute = routeAway(u); u.d = 0; u.v = 0; }
      if (u.leaveRoute) {
        const R0 = u.leaveRoute; u.v = Math.min(u.v + 3 * dt, speedLimitAt(u.x, u.z)); u.d = Math.min(R0.length, u.d + u.v * dt);
        const p = alongRoute(R0, u.d, lane); u.x = p.x; u.z = p.z; u.yaw = p.yaw;
      }
      // The car with you in it, out of sight: home.
      if (S.t > 2 && (dist(u, S.scene) > A.out_of_sight_m || S.t > A.out_of_sight_s)) respawn(u);
    }
  }
  //: Booked: the world's arrest (law.mjs cmd_police_stop) as the cuffs go on.
  function book(u) {
    send("police_stop", { offences: [...u.offences], outcome: "arrest", resisting: u.plateRead || u.resisting, officer: { name: u.name } }).then((r) => {
      u.booked = r.ok ? r : { fines: [], total: 0, court: null, error: r.error };
    });
  }
  function respawn(u) {
    const r = u.booked || {};
    const home = homeAt();
    pose = null; arrest = null;
    placeAvatar(home.x, groundAt(home.x, home.z), home.z, home.yaw || 0);
    avatarVisible(true);
    done(u);
    const when = r.court ? new Date(r.court).toLocaleString("en-US", { timeZone: R.clock?.zone || "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
    notify(`Booked at Northern Station and released ${home.label || "home"}. On your record: arrested${r.fines?.length ? ` for ${r.fines.map((f) => f.kind.replace(/_/g, " ")).join(", ")} (${fmt(r.total)} in fines)` : ""}.${when ? ` Your court date: ${when}, at the Superior Court -- the summons is in your messages.` : ""}`);
  }
  //: Struck an officer (or done in front of one), at arm's length: arrested there and then.
  function arrestNow(offence, officerAt) {
    const c = { id: offence.id, offence: offence.id, kind: offence.crime, severity: offence.severity, x: officerAt.x, z: officerAt.z, t0: performance.now(), considered: new Set(), callers: new Map(), reported: true };
    const u = startUnit({ id: `patrol:foot:${offence.id}`, x: officerAt.x, z: officerAt.z, from: "foot" }, c, null);
    u.officer = { x: officerAt.x, z: officerAt.z, yaw: 0, moving: false, gesture: null };
    // (No car of their own here: the one they call takes you, pulled up beside you.)
    const you = me(); u.x = you.x + 4; u.z = you.z + 4; u.yaw = 0; u.from = "called";
    startStop(u, true);
  }

  // ---- drawn ----------------------------------------------------------------------------------
  //: The cars answering, for the street's wheels (drawn as the city's patrol cars are).
  function vehicles() {
    const out = [];
    for (const u of units.values()) if (u.from !== "foot") out.push({ id: u.id, model: "patrol", x: u.x, z: u.z, yaw: u.yaw, speed: u.v, moving: u.v > 0.2, shade: 0, siren: u.siren, braking: u.phase === "stop" });
    return out;
  }
  //: The officers on foot, for the crowd (in uniform: role police).
  function people() {
    const out = [];
    for (const u of units.values()) {
      const o = u.officer;
      if (!o) continue;
      out.push({ id: `officer:${u.id}`, x: o.x, z: o.z, yaw: o.yaw, moving: Boolean(o.moving), speed: o.run ? Q.officer_run_ms : Q.officer_walk_ms, activity: o.run ? "running after you" : u.stop?.step === "talk" ? "talking with you" : "on duty",
        gesture: o.gesture || null, person: { id: `officer:${u.fromId}`, name: `Officer ${u.name}`, role: "police", age: 34, pace: 1.4 }, role: "police" });
    }
    return out;
  }
  // The light bar: a black bar on the roof with a red lamp on the left, a blue on the right, and
  // a glow round each when it flashes (an additive sprite: no light of its own, so no shader
  // recompiles -- freeze-investigation).
  const bars = [];
  function barMesh() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.09, 0.26), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }));
    const lamp = (c) => new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.22), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55 }));
    const red = lamp(0xff1a1a), blue = lamp(0x1a4dff);
    red.position.set(-0.32, 0.075, 0); blue.position.set(0.32, 0.075, 0);
    const glowTex = (() => { const cv = globalThis.document.createElement("canvas"); cv.width = cv.height = 64; const x = cv.getContext("2d"); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
    const glow = (c) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    const gr = glow(0xff2a2a), gb = glow(0x2a5aff);
    gr.position.set(-0.34, 0.1, 0); gb.position.set(0.34, 0.1, 0); gr.scale.setScalar(2.2); gb.scale.setScalar(2.2);
    for (const m of [base, red, blue]) { m.castShadow = false; m.receiveShadow = false; }
    g.add(base, red, blue, gr, gb);
    g.userData = { red, blue, gr, gb };
    group.add(g);
    return g;
  }
  //: Each patrol car in ``list`` (the street's wheels) with its bar on its roof; flashing on the
  //: ones with their siren on.
  function drawBars(list, roofOf) {
    let n = 0;
    const t = performance.now() / 1000;
    for (const v of list) {
      if (v.model !== "patrol") continue;
      const g = bars[n] || (bars[n] = barMesh());
      n += 1;
      g.visible = true;
      const y = groundAt(v.x, v.z) + roofOf("patrol");
      g.position.set(v.x, y, v.z); g.rotation.set(0, v.yaw || 0, 0);
      const [r, b] = v.siren ? barFlash(t + (v.id.length % 7) * 0.11) : [0, 0], U = g.userData;
      U.red.material.opacity = 0.35 + 0.65 * r; U.blue.material.opacity = 0.35 + 0.65 * b;
      U.red.material.color.setRGB(0.35 + 0.65 * r, 0.03, 0.03); U.blue.material.color.setRGB(0.03, 0.12, 0.35 + 0.65 * b);
      U.gr.material.opacity = r * 0.9; U.gb.material.opacity = b * 0.9;
      if (n >= 12) break;
    }
    for (let i = n; i < bars.length; i += 1) bars[i].visible = false;
    sirenSound(list);
  }
  // The siren: a wail (the pitch swept up and down over four seconds) while coming, the faster
  // yelp in a chase, loudest near (WebAudio; silent until the page may play sound).
  function sirenSound(list) {
    const you = focus();
    let near = null, nd = Infinity;
    for (const v of list) if (v.siren) { const d = Math.hypot(v.x - you.x, v.z - you.z); if (d < nd) { nd = d; near = v; } }
    if (!near || nd > 600) { if (siren) siren.gain.gain.value = 0; return; }
    try {
      if (!siren) {
        const ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
        const osc = ac.createOscillator(), osc2 = ac.createOscillator(), gain = ac.createGain(), mix = ac.createGain();
        osc.type = "sawtooth"; osc2.type = "square"; mix.gain.value = 0.5; gain.gain.value = 0;
        osc.connect(mix); osc2.connect(mix); mix.connect(gain); gain.connect(ac.destination);
        osc.start(); osc2.start();
        siren = { ac, osc, osc2, gain };
      }
      if (siren.ac.state === "suspended") siren.ac.resume().catch(() => {});
      const t = siren.ac.currentTime, chase = units.get(near.id)?.phase === "pursuit";
      const k = chase ? 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 0.36) : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 4);
      const f = 640 + 820 * k;
      siren.osc.frequency.setTargetAtTime(f, t, 0.02); siren.osc2.frequency.setTargetAtTime(f * 1.003, t, 0.02);
      siren.gain.gain.setTargetAtTime(Math.min(0.12, 0.12 / (1 + nd / 30)), t, 0.1);
    } catch { /* no sound here */ }
  }
  // The cuffs: two steel rings and their chain, between your wrists, while you wear them.
  function cuffsOn(on) {
    if (on && !cuffs) {
      cuffs = new THREE.Group();
      const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.25 });
      const ring = () => new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.008, 6, 14), steel);
      const a = ring(), b = ring(), link = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 5), steel);
      a.position.x = -0.05; b.position.x = 0.05; link.rotation.z = Math.PI / 2;
      cuffs.add(a, b, link); cuffs.userData.rings = [a, b];
      group.add(cuffs);
    }
    if (cuffs) cuffs.visible = on;
  }
  //: The cuffs between the hands (world positions, from the avatar's hand bones).
  function placeCuffs(r, l) {
    if (!cuffs?.visible || !r || !l) return;
    cuffs.position.set((r.x + l.x) / 2, (r.y + l.y) / 2, (r.z + l.z) / 2);
    cuffs.lookAt(r.x, r.y, r.z); cuffs.rotateY(Math.PI / 2);
  }

  //: A frame: the callers no one draws, each car, the lights.
  function frame(dt) {
    stepUnseen(dt);
    for (const u of [...units.values()]) { try { stepUnit(u, dt); } catch (error) { console.warn("kerbside: a patrol car stopped", error); done(u); } }
    const now = performance.now();
    while (crimes.length && now - crimes[0].t0 > 180_000) crimes.shift();
  }
  return {
    crime, speeding, personFrame, frame, vehicles, people, drawBars, placeCuffs, arrestNow, dispatch,
    hidden: (id) => hidden.has(id),
    get locked() { return Boolean(arrest && arrest.stop && arrest.stop.step !== "out"); },
    get pose() { return pose; },
    get active() { return units.size > 0; },
    near: (at, m = 45) => [...units.values()].some((u) => Math.hypot(u.x - at.x, u.z - at.z) < m),
    units: () => [...units.values()].map((u) => ({ id: u.id, phase: u.phase, x: u.x, z: u.z, v: u.v, siren: u.siren, officer: u.officer ? { ...u.officer } : null, stop: u.stop ? { ...u.stop } : null, offences: [...u.offences], plateRead: u.plateRead })),
    crimes: () => crimes.map((c) => ({ id: c.id, kind: c.kind, reported: c.reported, callers: [...c.callers.entries()].map(([id, k]) => ({ id, role: k.role, state: k.plan.state, talked_s: k.plan.talked_s })) })),
  };
}
