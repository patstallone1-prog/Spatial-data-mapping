// A crash on the street, cleared up as one is (crash.mjs has the numbers and the shapes): the
// wrecks stand where they stopped and the hurt lie where they fell, the traffic goes round and
// other drivers take another street; an ambulance comes for the hurt -- its crew out with a
// stretcher, the casualty lifted on and carried in -- and a tow truck for each wreck -- boom down,
// cable out, hooked, its end lifted and drawn up -- and each drives off with what it came for.
// When the last has gone the books are told (world.mjs clearCrash): the hurt in hospital, each
// of the city's cars as new and stood at the nearest mechanic's. Walk or drive away while it is
// still there and it is cleared the same way at once, unseen.
//
// The page's (view.mjs makes one): what it needs of the page is handed in. A scene is made by
// what the frame sees -- a wreck that stands, someone down who is to be carried -- so one left
// from an earlier visit is picked up again.

import { CRASH, clearedUnseen, stretcherAt, towAt, workAt } from "./crash.mjs";
import { DRIVE_LANE, alongRoute, hash32 } from "./people.mjs";

//: How near a scene a wreck or a casualty must be to belong to it, how fast a response drives,
//: how short of the scene it stops, and how far it drives off before it is gone (m, m/s).
export const SCENE = { join_m: 32, speed_ms: 13, leave_ms: 9, short_m: 11, off_m: 260, leave_most_s: 75, crew: 2, beacon_hz: 1.6 };

export function crashScenes({ THREE, group, groundAt, streets, traffic, focus, unseenAt, notify, clear, mechanicNear, dims, shut }) {
  const scenes = [];
  const root = new THREE.Group(); root.name = "city-crash-scenes"; group.add(root);
  const mat = (color, more = {}) => new THREE.MeshLambertMaterial({ color, ...more });
  // The gear, made once: a crew member (uniformed, a head), the stretcher, the truck's boom,
  // its cable and hook, and the beacons' lamps.
  const GEO = {
    body: new THREE.CapsuleGeometry(0.2, 0.95, 4, 8).translate(0, 0.72, 0),
    head: new THREE.SphereGeometry(0.115, 10, 8).translate(0, 1.56, 0),
    bed: new THREE.BoxGeometry(0.56, 0.06, 1.9),
    legs: new THREE.BoxGeometry(0.5, 1, 0.04),
    boom: new THREE.BoxGeometry(0.16, 0.16, 2.6).translate(0, 0, 1.3),
    post: new THREE.BoxGeometry(0.3, 1.15, 0.3).translate(0, 0.575, 0),
    cable: new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, -0.5, 0),
    hook: new THREE.TorusGeometry(0.09, 0.025, 6, 10, Math.PI * 1.5),
    lamp: new THREE.BoxGeometry(0.5, 0.12, 0.22),
  };
  const MAT = {
    medic: mat(0x1f3a5c), skin: mat(0xb5876a), bed: mat(0xe9e6df), frame: mat(0x8a8f96), steel: mat(0x33383e), cable: mat(0x1c1e21),
    red: new THREE.MeshBasicMaterial({ color: 0xff2a1e, toneMapped: false }), amber: new THREE.MeshBasicMaterial({ color: 0xffa51e, toneMapped: false }), dark: mat(0x40181a),
  };

  // ---- the scene ---------------------------------------------------------------------------------
  const near = (x, z) => scenes.find((s) => !s.cleared && Math.hypot(s.x - x, s.z - z) < SCENE.join_m);
  function sceneAt(x, z, now) {
    let s = near(x, z);
    if (!s) {
      s = { id: `scene:${Math.round(now)}:${scenes.length}`, x, z, t0: now, wrecks: new Map(), casualties: new Map(), ambulance: null, trucks: [], cleared: false, unseen: 0, called: false, lastShut: -1e9, seen: now };
      scenes.push(s);
    }
    return s;
  }
  //: A wreck the frame has found standing (``v``: {id, x, z, yaw, model}), or someone down who is
  //: to be carried (``q``: {id, x, z, yaw}): theirs is the scene near them, or a new one.
  function wreck(v, now) {
    const s = sceneAt(v.x, v.z, now), w = s.wrecks.get(v.id);
    if (w) { w.seen = now; return s; }
    s.wrecks.set(v.id, { id: v.id, x: v.x, z: v.z, yaw: v.yaw || 0, model: v.model, seen: now, truck: null, gone: false });
    return s;
  }
  function casualty(q, now) {
    const s = sceneAt(q.x, q.z, now), c = s.casualties.get(q.id);
    if (c) { c.seen = now; return s; }
    s.casualties.set(q.id, { id: q.id, x: q.x, z: q.z, yaw: q.yaw || 0, seen: now, loaded: false });
    return s;
  }

  // ---- the vehicles that come ------------------------------------------------------------------
  //: A way in for a response vehicle: from a few blocks off (``from``: [nearest, furthest] m) to
  //: the street by the scene. Null where the streets give none.
  function wayIn(s, from, tag) {
    const S = streets();
    if (!S) return null;
    const b = S.nearest(s.x, s.z, "drive", 140);
    if (b === null || b === undefined) return null;
    // The block the scene is on: the way in is to whichever end of it takes the way past the
    // scene itself (a way to the nearest corner stopped a block short of a crash in mid-block).
    const ends = [b];
    let nearEdge = null;
    for (const e of S.edges[b] || []) { const p = S.nodes[b], q = S.nodes[e.to], d = distTo(s.x, s.z, p.x, p.z, q.x, q.z).d; if (!nearEdge || d < nearEdge.d) nearEdge = { d, to: e.to }; }
    if (nearEdge) ends.push(nearEdge.to);
    let best = null;
    for (let k = 0; k < 14; k += 1) {
      const ang = (hash32(s.id, tag, "from", k) % 6283) / 1000, r = from[0] + (hash32(s.id, tag, "far", k) % Math.max(1, from[1] - from[0]));
      const a = S.nearest(s.x + Math.cos(ang) * r, s.z + Math.sin(ang) * r, "drive", 140);
      if (a === null || a === undefined || ends.includes(a)) continue;
      for (const end of ends) {
        const route = S.route(a, end, "drive");
        if (!route || route.length < 120 || route.length > 1200) continue;
        const by = passes(route, s.x, s.z);
        // (Nearest the scene first; of those as near, the shortest way.)
        if (!best || by.d < best.by.d - 3 || (by.d < best.by.d + 3 && route.length < best.route.length)) best = { route, by };
      }
    }
    if (!best) return null;
    best.route.stopAt = best.by.s;
    return best.route;
  }
  //: How near a way passes (x, z), and how far along it that is.
  function passes(route, x, z) {
    let best = { d: Infinity, s: route.length };
    for (let i = 0; i + 1 < route.pts.length; i += 1) {
      const p = route.pts[i], q = route.pts[i + 1], hit = distTo(x, z, p[0], p[1], q[0], q[1]);
      if (hit.d < best.d) best = { d: hit.d, s: route.s[i] + hit.t * (route.s[i + 1] - route.s[i]) };
    }
    return best;
  }
  const distTo = (x, z, ax, az, bx, bz) => { const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz || 1, t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / L2)); return { d: Math.hypot(x - ax - ux * t, z - az - uz * t), t }; };
  //: ... and a way off again: on from where it stands to a street a few blocks away.
  function wayOff(v, tag) {
    const S = streets();
    if (!S) return null;
    const a = S.nearest(v.x, v.z, "drive", 120);
    if (a === null || a === undefined) return null;
    for (let k = 0; k < 10; k += 1) {
      const ang = (hash32(v.id, tag, "off", k) % 6283) / 1000, b = S.nearest(v.x + Math.cos(ang) * 380, v.z + Math.sin(ang) * 380, "drive", 160);
      if (b === null || b === undefined || b === a) continue;
      const route = S.route(a, b, "drive");
      if (route && route.length > 150) return route;
    }
    return null;
  }
  function responder(s, model, from, tag, now) {
    const route = wayIn(s, from, tag);
    if (!route) return null;
    return { id: `${tag}:${s.id}`, model, shade: 0.5, route, d: 0, v: SCENE.speed_ms * 0.6, phase: "coming", x: 0, z: 0, yaw: 0, at: 0, since: now, gear: null, moving: true, speed: 0, response: true };
  }
  //: A response vehicle driven along its way: at its speed, behind whatever is in its lane, and
  //: stopped ``short`` of the way's end when it is coming. True when it has got there.
  function drive(v, dt, top, short) {
    const R0 = v.route, here = alongRoute(R0, v.d, DRIVE_LANE);
    // (Coming, it stops ``short`` of where its way passes the scene; leaving, it goes to the end.)
    const left = (short ? Math.min(R0.length, (R0.stopAt ?? R0.length) - short) : R0.length) - v.d;
    let want = Math.max(short ? 0 : 2, Math.min(top, left / 1.5));
    // Stood behind the traffic a while (which may itself be stood for it): it goes on through,
    // its lights going, as the traffic would make way for it.
    v.stood = v.v < 0.5 && left > 4 ? (v.stood || 0) + dt : 0;
    if (v.stood > 5) v.through = 6;
    v.through = Math.max(0, (v.through || 0) - dt);
    const fx = -Math.sin(here.yaw), fz = -Math.cos(here.yaw);
    for (const o of traffic()) {
      if (o.id === v.id || o.id === v.towing) continue;
      const dx = o.x - here.x, dz = o.z - here.z;
      if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
      const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      // (Not behind the wrecks it has come for: it pulls up to them.)
      if (fwd > 0 && fwd < 24 && lat < 1.7 && !o.wrecked && !o.response && !(v.through > 0)) want = Math.min(want, Math.max(0, (fwd - 7) / 1.5));
    }
    v.v += Math.max(-8 * dt, Math.min(3 * dt, want - v.v));
    v.d = Math.min(R0.length, v.d + Math.max(0, v.v) * dt);
    const p = alongRoute(R0, v.d, DRIVE_LANE);
    v.x = p.x; v.z = p.z; v.yaw = p.yaw; v.speed = Math.abs(v.v); v.moving = v.speed > 0.2; v.braking = want < v.v - 0.1;
    return left <= 0.6;
  }

  // ---- the gear, drawn --------------------------------------------------------------------------
  function ambulanceGear() {
    const g = new THREE.Group();
    const crew = Array.from({ length: SCENE.crew }, () => { const m = new THREE.Group(); m.add(new THREE.Mesh(GEO.body, MAT.medic), new THREE.Mesh(GEO.head, MAT.skin)); g.add(m); return m; });
    const stretcher = new THREE.Group(); stretcher.add(new THREE.Mesh(GEO.bed, MAT.bed));
    const legs = [new THREE.Mesh(GEO.legs, MAT.frame), new THREE.Mesh(GEO.legs, MAT.frame)]; legs[0].position.z = -0.7; legs[1].position.z = 0.7; stretcher.add(...legs); g.add(stretcher);
    const lamps = [new THREE.Mesh(GEO.lamp, MAT.red), new THREE.Mesh(GEO.lamp, MAT.red)]; g.add(...lamps);
    root.add(g);
    return { g, crew, stretcher, legs, lamps };
  }
  function truckGear() {
    const g = new THREE.Group();
    const post = new THREE.Mesh(GEO.post, MAT.steel), boom = new THREE.Mesh(GEO.boom, MAT.steel), cable = new THREE.Mesh(GEO.cable, MAT.cable), hook = new THREE.Mesh(GEO.hook, MAT.steel);
    const lamps = [new THREE.Mesh(GEO.lamp, MAT.amber), new THREE.Mesh(GEO.lamp, MAT.amber)];
    g.add(post, boom, cable, hook, ...lamps);
    root.add(g);
    return { g, post, boom, cable, hook, lamps };
  }
  const drop = (gear) => { if (gear) gear.g.removeFromParent(); };
  const beacon = (lamps, on, off, now, phase = 0) => { const k = Math.floor(now / 1000 * SCENE.beacon_hz * 2 + phase) % 2; lamps[0].material = k ? on : off; lamps[1].material = k ? off : on; };
  //: The point ``back`` metres behind a vehicle's middle and ``side`` to its right, on the ground.
  const behind = (v, back, side = 0) => { const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw); return { x: v.x - fx * back - fz * side, z: v.z - fz * back + fx * side }; };

  function stepAmbulance(s, dt, now) {
    const a = s.ambulance, D = dims.ambulance || [2.1, 2.5, 5.6];
    a.gear ||= ambulanceGear();
    const G = a.gear, list = [...s.casualties.values()];
    if (a.phase === "coming" && (drive(a, dt, SCENE.speed_ms, SCENE.short_m) || now - a.since > 90_000)) { a.phase = "working"; a.at = now; a.v = 0; a.moving = false; a.speed = 0; if (s.near) notify("The ambulance has pulled up."); }
    else if (a.phase === "working") {
      const w = workAt((now - a.at) / 1000, list.length, CRASH.load_s);
      for (let i = 0; i < list.length; i += 1) if (i < w.i || w.done) list[i].loaded = true;
      if (w.done) {
        clear({ people: list.map((c) => c.id) });
        a.phase = "leaving"; a.left = now; a.route = wayOff(a, "amb") || a.route; a.d = 0; a.v = 1;
        if (!a.route) a.phase = "gone";
        if (s.near && list.length) notify(list.length > 1 ? `The ambulance takes ${list.length} to hospital.` : "The ambulance takes them to hospital.");
      } else a.work = w;
    } else if (a.phase === "leaving") { if (drive(a, dt, SCENE.leave_ms + 3, 0) || (a.d > SCENE.off_m && unseenAt(a.x, a.z)) || now - a.left > SCENE.leave_most_s * 1000) a.phase = "gone"; }
    // The crew and the stretcher: from the doors at the back to the casualty and back.
    const y = groundAt(a.x, a.z), doors = behind(a, D[2] / 2 + 0.9), work = a.phase === "working" && a.work && !a.work.done ? a.work : null;
    const c = work ? list[work.i] : null, st = work ? stretcherAt(work.k) : null;
    G.stretcher.visible = Boolean(work); for (const m of G.crew) m.visible = Boolean(work);
    if (work && c) {
      const tx = c.x, tz = c.z, sx = doors.x + (tx - doors.x) * st.reach, sz = doors.z + (tz - doors.z) * st.reach, gy = groundAt(sx, sz);
      const heading = Math.atan2(-(tx - doors.x), -(tz - doors.z));
      G.stretcher.position.set(sx, gy + st.lift, sz); G.stretcher.rotation.y = heading;
      for (const leg of G.legs) { leg.scale.y = Math.max(0.1, st.lift); leg.position.y = -st.lift / 2; }
      G.stretcher.visible = !st.in;
      // (One at the head and one at the foot, bent to it while they lift.)
      G.crew.forEach((m, k) => { const off = (k ? 1 : -1) * 1.15; m.position.set(sx - Math.sin(heading) * off, gy, sz - Math.cos(heading) * off); m.rotation.y = heading + (k ? Math.PI : 0); m.rotation.x = st.lift < 0.5 ? 0.5 : 0; m.visible = !st.in; });
      c.pose = st.carried ? { x: sx, z: sz, lift: st.lift + 0.12, yaw: heading, hidden: st.in } : null;
    }
    G.lamps.forEach((l, k) => l.position.set(a.x + (k ? 0.45 : -0.45) * Math.cos(a.yaw), y + D[1] + 0.08, a.z - (k ? 0.45 : -0.45) * Math.sin(a.yaw)));
    G.lamps.forEach((l) => { l.rotation.y = a.yaw; });
    beacon(G.lamps, MAT.red, MAT.dark, now);
    if (a.phase === "gone") { drop(a.gear); a.gear = null; }
  }

  function stepTruck(s, t, dt, now) {
    const D = dims.tow_truck || dims.pickup || [2, 1.9, 5.9], w = s.wrecks.get(t.wreck);
    t.gear ||= truckGear();
    const G = t.gear, WD = (w && dims[w.model]) || dims.sedan;
    if (t.phase === "coming") {
      // (It stops with its back to the wreck: a little past it, so the cable runs straight.)
      if (drive(t, dt, SCENE.speed_ms, -(D[2] / 2 + WD[2] / 2 + 2.5)) || now - t.since > 90_000) { t.phase = "working"; t.at = now; t.v = 0; t.moving = false; t.speed = 0; if (s.near) notify("A tow truck has pulled up."); }
    } else if (t.phase === "working") {
      const k = workAt((now - t.at) / 1000, 1, CRASH.hook_s);
      t.tow = towAt(k.k);
      if (k.done) { t.phase = "leaving"; t.left = now; t.route = wayOff(t, "tow") || t.route; t.d = 0; t.v = 1; t.towing = t.wreck; if (s.near) notify("The tow truck takes it to the mechanic's."); }
    } else if (t.phase === "leaving") {
      if (drive(t, dt, SCENE.leave_ms, 0) || (t.d > SCENE.off_m && unseenAt(t.x, t.z)) || !t.route || now - t.left > SCENE.leave_most_s * 1000) {
        t.phase = "gone";
        if (w && !w.gone) { w.gone = true; clear({ vehicles: [w.id], shop: mechanicNear(w) }); }
      }
    }
    // The boom over the truck's tail, its cable to the wreck's near end, and the wreck drawn up.
    const y = groundAt(t.x, t.z), tail = behind(t, D[2] / 2 - 0.5), tow = t.phase === "coming" ? towAt(0) : t.phase === "working" ? t.tow || towAt(0) : towAt(1);
    G.post.position.set(tail.x, y + D[1] * 0.45, tail.z); G.post.rotation.y = t.yaw;
    const top = y + D[1] * 0.45 + 1.1;
    G.boom.position.set(tail.x, top, tail.z); G.boom.rotation.set(0, t.yaw, 0, "YXZ"); G.boom.rotation.x = -0.25 - 0.5 * (1 - tow.boom);
    const tipBack = Math.cos(G.boom.rotation.x) * 2.6, tipUp = -Math.sin(G.boom.rotation.x) * 2.6, tip = behind(t, D[2] / 2 - 0.5 + tipBack), tipY = top + tipUp;
    if (w && t.phase !== "coming" && !w.gone) {
      // The wreck's end nearest the truck is the one hooked: lifted, and the car drawn up behind.
      // (Whichever end of it is towards the truck: one facing the other way is towed backwards.)
      const gap = D[2] / 2 + WD[2] / 2 + 0.9, to = behind(t, gap);
      w.rev ??= Math.abs(shortTurn(w.yaw, t.yaw)) > Math.PI / 2;
      const end = w.rev ? -1 : 1, yawTo = t.yaw + (w.rev ? Math.PI : 0), k = tow.draw;
      w.pose = tow.hooked ? { x: w.x + (to.x - w.x) * k, z: w.z + (to.z - w.z) * k, yaw: w.yaw + shortTurn(w.yaw, yawTo) * k, pitch: end * 0.16 * tow.lift, lift: 0.34 * tow.lift } : null;
      const wx = w.pose ? w.pose.x : w.x, wz = w.pose ? w.pose.z : w.z, wyaw = w.pose ? w.pose.yaw : w.yaw;
      const nose = { x: wx - end * Math.sin(wyaw) * (WD[2] / 2 - 0.2), z: wz - end * Math.cos(wyaw) * (WD[2] / 2 - 0.2) };
      const hy = groundAt(nose.x, nose.z) + 0.45 + (w.pose ? w.pose.lift : 0);
      // (The cable: from the boom's tip toward the hook point by how far it has been run out.)
      const hx = tip.x + (nose.x - tip.x) * tow.cable, hz = tip.z + (nose.z - tip.z) * tow.cable, hyy = tipY + (hy - tipY) * tow.cable;
      const len = Math.hypot(hx - tip.x, hyy - tipY, hz - tip.z) || 0.01;
      G.cable.visible = G.hook.visible = true;
      G.cable.position.set(tip.x, tipY, tip.z); G.cable.scale.set(1, len, 1);
      G.cable.quaternion.setFromUnitVectors(DOWN, V.set(hx - tip.x, hyy - tipY, hz - tip.z).normalize());
      G.hook.position.set(hx, hyy - 0.08, hz); G.hook.rotation.y = t.yaw;
    } else { G.cable.visible = G.hook.visible = false; }
    G.lamps.forEach((l, k) => { l.position.set(t.x + (k ? 0.4 : -0.4) * Math.cos(t.yaw) - Math.sin(t.yaw) * 0.2, y + D[1] + 0.06, t.z - (k ? 0.4 : -0.4) * Math.sin(t.yaw) - Math.cos(t.yaw) * 0.2); l.rotation.y = t.yaw; });
    beacon(G.lamps, MAT.amber, MAT.steel, now, 1);
    if (t.phase === "gone") { drop(t.gear); t.gear = null; }
  }
  const DOWN = new THREE.Vector3(0, -1, 0), V = new THREE.Vector3();
  const shortTurn = (from, to) => ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  // ---- each frame -------------------------------------------------------------------------------
  function step(dt, now, tsec) {
    const you = focus();
    for (const s of scenes) {
      if (s.cleared) continue;
      const far = Math.hypot(s.x - you.x, s.z - you.z), age = (now - s.t0) / 1000;
      s.near = far < 70;
      s.unseen = far > CRASH.leave_m && unseenAt(s.x, s.z) ? s.unseen + dt : 0;
      // Left behind: cleared at once, as it would have been.
      if (clearedUnseen({ far, unseen: s.unseen, age })) { finish(s, true); continue; }
      // What the books no longer have standing (cleared some other way) is gone from it.
      for (const [id, w] of s.wrecks) if (!w.gone && now - w.seen > 4000 && !w.truck) s.wrecks.delete(id);
      for (const [id, c] of s.casualties) if (!c.loaded && now - c.seen > 4000) s.casualties.delete(id);
      const wrecks = [...s.wrecks.values()].filter((w) => !w.gone), hurt = [...s.casualties.values()].filter((c) => !c.loaded);
      if (!s.called && age > CRASH.call_s && (wrecks.length || hurt.length)) { s.called = true; if (s.near) notify(hurt.length ? "Someone has rung for an ambulance." : "Someone has rung for a tow truck."); }
      if (s.called) {
        if (hurt.length && !s.ambulance) s.ambulance = responder(s, "ambulance", CRASH.ambulance_from_m, `amb${s.rounds = (s.rounds || 0) + 1}`, now) || { phase: "none", at: now };
        // (No way in for one: the hurt are taken as if it had come, after the time it would take.)
        if (s.ambulance?.phase === "none" && now - s.ambulance.at > 40_000) { clear({ people: hurt.map((c) => c.id) }); for (const c of hurt) c.loaded = true; s.ambulance = null; }
        // A truck a wreck: the first once the hurt are being seen to, the next a little after.
        const waiting = wrecks.filter((w) => !w.truck);
        const busy = s.ambulance && s.ambulance.phase === "coming";
        if (waiting.length && !busy && now - (s.lastTruck || 0) > 9000) {
          const w = waiting[0], t = responder(s, "tow_truck", CRASH.tow_from_m, `tow${s.trucks.length}`, now);
          s.lastTruck = now;
          if (t) { t.wreck = w.id; w.truck = t.id; s.trucks.push(t); }
          else if (age > 60) { w.gone = true; clear({ vehicles: [w.id], shop: mechanicNear(w) }); }
        }
      }
      if (s.ambulance && s.ambulance.phase !== "none") { stepAmbulance(s, dt, now); if (s.ambulance.phase === "gone") s.ambulance = null; }
      for (const t of s.trucks) if (t.phase !== "gone") stepTruck(s, t, dt, now);
      // The block it is on, known shut while a wreck stands in it.
      if (wrecks.length && tsec - s.lastShut > CRASH.shut_every_s) { s.lastShut = tsec; shut(s.x, s.z, tsec + CRASH.shut_for_s); }
      const live = s.trucks.some((t) => t.phase !== "gone") || s.ambulance;
      if (!wrecks.length && !hurt.length && !live && age > 3) finish(s, false);
    }
    for (let i = scenes.length - 1; i >= 0; i -= 1) if (scenes[i].cleared && now - scenes[i].clearedAt > 5000) scenes.splice(i, 1);
  }
  //: A scene over. ``unseen``: nobody watched it cleared -- everything still in it goes at once.
  function finish(s, unseen) {
    if (unseen) {
      const vehicles = [...s.wrecks.values()].filter((w) => !w.gone), people = [...s.casualties.values()].filter((c) => !c.loaded).map((c) => c.id);
      // (Each car to the mechanic nearest where it stood.)
      for (const w of vehicles) clear({ vehicles: [w.id], shop: mechanicNear(w) });
      if (people.length) clear({ people });
    }
    drop(s.ambulance?.gear); for (const t of s.trucks) drop(t.gear);
    s.cleared = true; s.clearedAt = performance.now(); s.ambulance = null; s.trucks = [];
  }

  return {
    wreck, casualty, step,
    //: The response vehicles on the street now, for the page to draw and the traffic to see.
    vehicles() { const out = []; for (const s of scenes) { if (s.cleared) continue; if (s.ambulance && s.ambulance.route && s.ambulance.phase !== "gone") out.push(s.ambulance); for (const t of s.trucks) if (t.phase !== "gone") out.push(t); } return out; },
    //: A wreck's place while a truck has it (drawn up behind the truck, its end lifted), or null.
    wreckPose(id) { for (const s of scenes) { const w = s.wrecks.get(id); if (w) { if (w.gone) return { hidden: true }; if (!w.pose) return null; const t = s.trucks.find((x) => x.wreck === id); if (t && t.phase === "leaving") { const D = dims.tow_truck || dims.pickup, WD = dims[w.model] || dims.sedan, to = behind(t, D[2] / 2 + WD[2] / 2 + 0.9); return { x: to.x, z: to.z, yaw: t.yaw + (w.rev ? Math.PI : 0), pitch: (w.rev ? -1 : 1) * 0.16, lift: 0.34 }; } return w.pose; } } return null; },
    //: A casualty's place while the crew has them (on the stretcher; ``hidden`` once inside), or null.
    casualtyPose(id) { for (const s of scenes) { const c = s.casualties.get(id); if (c) return c.loaded ? { hidden: true } : c.pose || null; } return null; },
    has: (id) => scenes.some((s) => !s.cleared && (s.wrecks.has(id) || s.casualties.has(id))),
    report: () => scenes.map((s) => ({ id: s.id, at: [Math.round(s.x), Math.round(s.z)], age: Math.round((performance.now() - s.t0) / 1000), wrecks: [...s.wrecks.values()].map((w) => ({ id: w.id, truck: w.truck, gone: w.gone })), casualties: [...s.casualties.values()].map((c) => ({ id: c.id, loaded: c.loaded })), ambulance: s.ambulance?.phase || null, trucks: s.trucks.map((t) => t.phase), called: s.called, cleared: s.cleared })),
    clearAll() { for (const s of scenes) if (!s.cleared) finish(s, true); },
  };
}
