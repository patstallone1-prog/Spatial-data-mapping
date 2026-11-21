// The shop floor you walk (the page's half of shopping.mjs): the products drawn on the shelves are
// the shop's stock -- walk up to one, G takes it into your basket (and it is gone from the shelf
// for everyone); a basket or a cart from by the door; pay at a staffed lane while its cashier is
// on, or at a self-checkout; walk out with unpaid things and the basket stays at the door. And
// the other shoppers in the room are walked the same way (npc-steer.mjs): a few shelves each,
// then in line at a till, round one another and round you.
//
// The page makes one (view.mjs) and tells it what the room is (``room``: a fitted shop room's
// plan and frame; ``fitted``: a fitted interior, its stock and tills registered by the hooks).
// Coordinates: the page's (x, z); a room's plan is x across from its middle, z in from its front
// (``F.at(z, x)`` to the page, ``F.local(x, z)`` back).

import { lanePoints } from "./grocery-room.mjs";
import { Queue, runTask, steer, storeNav, task } from "./npc-steer.mjs";
import { canWalkStore } from "./store-room.mjs";
import { carrierSpec, trolleyLoad } from "./shopping.mjs";
import { hash32, rng } from "./people.mjs";

export const REACH_M = 1.35, TILL_M = 1.4, DOOR_M = 2.6;
const HIDE = { x: 0, y: -50, z: 0 };

export function shopFloor({ THREE, R, send, notify, getView, self, kit = null, sync = () => {} }) {
  const S = { place: null, F: null, plan: null, floorY: 0, parent: null, items: [], tills: [], carrier: null, mesh: null, meshKind: null, agents: new Map(), grid: null, queues: [], seen: 0 };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), ZERO = new THREE.Vector3(0, 0, 0);
  const trolley = () => { const p = self(); return p?.trolley && S.place && String(p.trolley.place) === String(S.place.id) ? p.trolley : null; };
  const name = (sku) => R.items[sku]?.name || sku;
  const priceOf = (sku) => { const w = getView(); return w?.priceAt ? w.priceAt(S.place, sku) : R.items[sku]?.price || 0; };

  // ---- the room -----------------------------------------------------------------------------------
  //: A shop room (view.mjs buildRoom): ``F`` its frame, ``plan`` its store plan, ``parent`` the
  //: group the page draws in (the carried basket goes in it).
  function room(place, F, plan, parent) {
    close(true);
    Object.assign(S, { place, F, plan, floorY: F.y, parent, items: [], tills: [], agents: new Map(), queues: [], hideLeft: {} });
    S.grid = storeNav(plan, canWalkStore, 0.3);
    // The tills: each staffed lane (its shopper's place, its cashier's), each self-checkout, a
    // small shop's counter.
    for (const f of plan.fixtures || []) {
      if (f.role === "checkout") {
        const pts = lanePoints(f);
        S.tills.push({ kind: "staffed", lane: f.lane, local: pts.shopper, cashier: pts.cashier, at: F.at(pts.shopper.z, pts.shopper.x), cashierAt: F.at(pts.cashier.z, pts.cashier.x) });
      } else if (f.role === "self_checkout") {
        const s = S.grid.nearestFree(f.x - Math.sin(f.yaw) * (f.deep / 2 + 0.4), f.z - Math.cos(f.yaw) * (f.deep / 2 + 0.4)) || { x: f.x, z: f.z };
        S.tills.push({ kind: "self", local: s, at: F.at(s.z, s.x), kiosk: f.kiosk });
      } else if (f.role === "till" || f.role === "counter") {
        const s = S.grid.nearestFree(f.side ? f.x - f.side * (f.w / 2 + 0.45) : f.x, f.side ? f.z : f.z - f.d / 2 - 0.45) || { x: f.x, z: f.z - 0.8 };
        S.tills.push({ kind: "staffed", lane: 1, local: s, cashier: { x: f.x + (f.side || 0) * 0.75, z: f.side ? f.z : f.z + 0.7 }, at: F.at(s.z, s.x) });
      }
    }
    // A line at each till, back from where the shopper stands, toward the floor.
    for (const t of S.tills) {
      const back = t.kind === "staffed" && t.lane ? { x: 0, z: 1 } : { x: 0, z: 1 };
      t.queue = new Queue(t.local, back, { free: (x, z) => S.grid.freeAt(x, z), most: 6 });
    }
  }
  //: A fitted interior's shop (Codex's engine): its stock and its tills come by the hooks.
  function fitted(place) {
    if (S.place?.id === place.id && !S.F) return;
    close(true);
    Object.assign(S, { place, F: null, plan: null, parent: null, items: [], tills: [], agents: new Map(), queues: [], grid: null, hideLeft: {} });
  }
  //: Products drawn on a shelf: ``stock`` (objects.mjs instanced), ``list`` their placements in
  //: ``obj``'s frame ({x, y, z, yaw}), ``have`` of them drawn. Some may be off the shelf already
  //: (the world's shelfState): those are not drawn.
  function stocked(sku, stock, list, have, obj) {
    if (!S.place) return;
    obj.updateWorldMatrix(true, false);
    S.hideLeft ||= {};
    if (S.hideLeft[sku] === undefined) S.hideLeft[sku] = getView()?.shelfState?.(S.place)?.taken?.[sku] || 0;
    const made = [];
    for (let k = 0; k < have; k += 1) {
      const q = list[k], w = V.set(q.x, q.y, q.z).applyMatrix4(obj.matrixWorld).clone();
      made.push({ sku, stock, k, local: q, x: w.x, y: w.y, z: w.z, gone: false, n: have });
    }
    S.items.push(...made);
    // Off the shelf already (bought, or in someone's basket): from the end of the run, so the front stays faced.
    for (let k = made.length - 1; k >= 0 && S.hideLeft[sku] > 0; k -= 1) { hide(made[k]); S.hideLeft[sku] -= 1; }
  }
  const hide = (item) => { item.gone = true; M.compose(V.set(HIDE.x, HIDE.y, HIDE.z), Q.identity(), ZERO); item.stock.set(item.k, M); item.stock.count(item.n); };
  const show = (item) => { item.gone = false; E.set(0, item.local.yaw, 0); Q.setFromEuler(E); M.compose(V.set(item.local.x, item.local.y, item.local.z), Q, ONE); item.stock.set(item.k, M); item.stock.count(item.n); };
  //: A fitted interior's till (retail-fixtures.mjs): ``obj`` the fixture, its role.
  function till(obj, { role }) {
    if (!S.place || S.F) return;
    obj.updateWorldMatrix(true, false);
    const w = new THREE.Vector3(0, 0, 0).applyMatrix4(obj.matrixWorld);
    S.tills.push({ kind: role === "self_checkout" ? "self" : "staffed", lane: S.tills.length + 1, at: { x: w.x, z: w.z }, fitted: true });
  }

  // ---- you ----------------------------------------------------------------------------------------
  //: The product within reach in front of you: {item, d} or null.
  function near(here, yaw) {
    if (!S.place) return null;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bd = REACH_M;
    for (const it of S.items) {
      if (it.gone) continue;
      const dx = it.x - here.x, dz = it.z - here.z, d = Math.hypot(dx, dz);
      if (d > bd || (d > 0.35 && (dx * fx + dz * fz) / d < 0.25)) continue;
      best = it; bd = d;
    }
    return best ? { item: best, d: bd } : null;
  }
  const tillNear = (here) => S.tills.find((t) => Math.hypot(t.at.x - here.x, t.at.z - here.z) < TILL_M) || null;
  //: Whether a staffed lane has its cashier now: the first lane always, the others through the
  //: busy hours (a supermarket opens lanes as the day fills).
  const laneOpen = (t, hour) => t.kind === "self" || t.lane <= 1 || (hour >= 10 && hour < 20 && t.lane <= 1 + Math.floor((Math.min(hour, 23 - hour) - 6) / 2));
  async function take(it) {
    const r = await send("shelf_take", { place: S.place, item: it.sku });
    if (!r.ok) { notify(r.error); return r; }
    hide(it);
    const t = r.trolley, load = trolleyLoad(R, t.lines), sub = Object.entries(t.lines).reduce((a, [id, n]) => a + priceOf(id) * n, 0);
    notify(`${name(it.sku)} — ${R.fmt(priceOf(it.sku))}. ${t.carrier === "hands" ? "In your hands" : `In your ${t.carrier}`}: ${load.units} ${load.units === 1 ? "thing" : "things"}, ${R.fmt(sub)} before tax.`);
    carry(t.carrier);
    return r;
  }
  async function putBack(sku) {
    const r = await send("shelf_return", { place: S.place, item: sku });
    if (!r.ok) { notify(r.error); return r; }
    const it = [...S.items].reverse().find((x) => x.sku === sku && x.gone);
    if (it) show(it);
    notify(`Put the ${name(sku).toLowerCase()} back.`);
    return r;
  }
  async function pay(t, hour) {
    if (t.kind === "staffed" && !laneOpen(t, hour)) { notify(`Lane ${t.lane} is closed: try an open lane or the self-checkouts.`); return null; }
    const r = await send("pay_lane", { place: S.place, lane: t.kind });
    if (!r.ok) { notify(r.error); return r; }
    const n = r.lines.reduce((a, l) => a + l.qty, 0);
    notify(`${t.kind === "self" ? "Scanned and paid" : "Paid"} ${R.fmt(r.total)}${r.tax ? ` (${R.fmt(r.tax)} of it tax)` : ""} for ${n} ${n === 1 ? "thing" : "things"}: yours, in your inventory (I).${r.bags?.length ? ` ${r.bags.reduce((a, b) => a + b.qty, 0)} more than you can carry are bagged by the door: pick them up (G) or stow them in your car.` : ""}`);
    sync(true);
    return r;
  }
  async function carrier(kind) {
    const r = await send("shop_carrier", { place: S.place, carrier: kind });
    if (!r.ok) { notify(r.error); return r; }
    carry(kind);
    notify(kind === "hands" ? "Put the basket back." : `Took a ${kind}. Walk up to anything on the shelves and G takes it.`);
    return r;
  }
  //: What you can do here, for the page's prompt: taking, putting back, a basket, paying.
  function actions(here, yaw, hour = 12) {
    // (A fitted interior with nothing of its own on a shelf and no till: bought from the counter, as before.)
    if (!S.place || (!S.items.length && !S.tills.length && !trolley())) return [];
    const out = [], t = trolley(), lines = t?.lines || {}, n = Object.values(lines).reduce((a, b) => a + b, 0);
    const it = near(here, yaw);
    if (it) {
      const spec = R.items[it.item.sku];
      out.push({ id: "shelf", label: `Take: ${spec?.name || it.item.sku} ${R.fmt(priceOf(it.item.sku))}`, key: "G", run: () => take(it.item) });
    }
    const atDoor = S.F ? S.F.local(here.x, here.z).u < DOOR_M : false;
    if ((!t || t.carrier === "hands") && (atDoor || !S.F)) {
      out.push({ id: "basket", label: "Take a basket", key: "", run: () => carrier("basket") });
      if (S.plan?.grocery || !S.F) out.push({ id: "cart", label: "Take a cart", key: "", run: () => carrier("cart") });
    }
    const tl = tillNear(here);
    if (tl && n) {
      const sub = Object.entries(lines).reduce((a, [id, k]) => a + priceOf(id) * k, 0);
      out.push({ id: "pay", label: tl.kind === "self" ? `Self-checkout: scan ${n} for ${R.fmt(sub)} + tax` : laneOpen(tl, hour) ? `Pay at ${S.plan?.grocery || tl.fitted ? `lane ${tl.lane}` : "the till"}: ${n} for ${R.fmt(sub)} + tax` : `Lane ${tl.lane} is closed`, key: "Enter", run: () => pay(tl, hour) });
    }
    if (n) {
      const last = Object.keys(lines).at(-1);
      const load = trolleyLoad(R, lines), spec = carrierSpec(R, t.carrier);
      out.push({ id: "trolley", label: `${t.carrier === "hands" ? "In your hands" : `Your ${t.carrier}`}: ${n} · ${load.kg} of ${spec.max_kg} kg — put back the ${name(last).toLowerCase()}`, key: "", run: () => putBack(last) });
    }
    return out;
  }
  //: Walking out: what is unpaid goes back (the page calls this at the door).
  async function close(quiet = false) {
    const p = self(), had = p?.trolley && S.place && String(p.trolley.place) === String(S.place.id) && Object.keys(p.trolley.lines).length;
    if (S.place && p?.trolley) {
      const r = await send("trolley_leave", { place: S.place });
      if (!quiet && had && r?.ok) notify(`You leave the ${p.trolley?.carrier === "hands" ? "things" : p.trolley?.carrier || "basket"} by the door: what you had not paid for goes back on the shelves.`);
    }
    S.mesh?.removeFromParent(); S.mesh = null; S.meshKind = null;
    S.place = null; S.F = null; S.plan = null; S.items = []; S.tills = []; S.agents = new Map(); S.grid = null;
  }

  // ---- the basket or cart in front of you ---------------------------------------------------------
  function carry(kind) {
    if (S.meshKind === kind) return;
    S.mesh?.removeFromParent(); S.mesh = null; S.meshKind = kind;
    if (!kit || kind === "hands" || !S.parent) return;
    const sku = kind === "cart" ? "shopping_cart" : "shopping_basket";
    kit.build(sku, { tier: "near" }).then((g) => {
      if (!g || S.meshKind !== kind || !S.place) return;
      g.traverse((o) => { if (o.isMesh) o.userData.sharedModel = true; });
      g.userData.shared = true;
      S.mesh = g; S.parent.parent?.add(g);
    }).catch(() => {});
  }
  //: Each frame: the basket held a little in front and to the right; the cart pushed ahead.
  function frame(you) {
    if (!S.mesh || !S.place) return;
    const fx = -Math.sin(you.yaw), fz = -Math.cos(you.yaw), rx = -fz, rz = fx;
    const cart = S.meshKind === "cart", ahead = cart ? 0.85 : 0.32, side = cart ? 0 : 0.26;
    S.mesh.position.set(you.x + fx * ahead + rx * side, S.floorY + (cart ? 0 : 0.42), you.z + fz * ahead + rz * side);
    S.mesh.rotation.y = you.yaw + (cart ? Math.PI : 0);
  }

  // ---- the other shoppers -------------------------------------------------------------------------
  //: Someone the page draws in this room (``entry``, its x/z as their day has them): walked here
  //: instead -- staff at the tills or stocking shelves, shoppers round the shelves to a till and
  //: back. ``you``: the player (in the way like anyone). Returns true when it placed them.
  function walk(entry, you, dt, hour) {
    if (!S.F || !S.grid || !entry.indoors || String(entry.indoors) !== String(S.place.id)) return false;
    const F = S.F;
    let a = S.agents.get(entry.id);
    if (!a) {
      const staff = String(entry.person?.work) === String(S.place.id);
      const at = F.local(entry.x, entry.z), spot = S.grid.nearestFree(at.v, at.u) || S.grid.nearestFree(S.plan.doorX, 0.7) || { x: 0, z: 1 };
      a = { id: entry.id, x: spot.x, z: spot.z, yaw: 0, staff, pace: 0.85 + (hash32(entry.id) % 30) / 100, n: S.agents.size };
      a.t = staff ? staffTask(a) : shopperTask(a);
      S.agents.set(entry.id, a);
    }
    a.touched = S.seen;
    const st = a.t && runTask(a, a.t, dt, S.grid);
    // Out of a line once past its step; in one while on it.
    if (a.q && a.q !== st?.queue) { a.q.queue.leave(a.id); a.q = null; }
    if (st?.queue) { a.q = st.queue; lineUp(a, st); }
    if (a.t?.done) a.t = a.staff ? staffTask(a) : shopperTask(a);
    const pos = F.at(a.z, a.x), ahead = F.at(a.z - Math.cos(a.yaw) * 0.5, a.x - Math.sin(a.yaw) * 0.5);
    entry.x = pos.x; entry.z = pos.z;
    entry.yaw = Math.atan2(-(ahead.x - pos.x), -(ahead.z - pos.z));
    entry.moving = a.moving; entry.gesture = st?.reach && !a.moving ? { kind: "reach", f: 0.5 } : null;
    entry.activity = st?.label || (a.staff ? "at work" : "shopping");
    return true;
  }
  //: Once a frame, after every one drawn in the room is placed: the steps.
  function step(you, dt) {
    if (!S.grid) return;
    S.seen += 1;
    const list = [];
    for (const [id, a] of S.agents) { if (a.touched < S.seen - 2) { S.agents.delete(id); for (const t of S.tills) t.queue.leave(id); continue; } list.push(a); }
    // You are in the way like anyone (and, at a till, in its line).
    const me = S.F.local(you.x, you.z), body = { id: "you", x: me.v, z: me.u, moving: Boolean(you.moving), vx: 0, vz: 0 };
    for (const t of S.tills) { const d = Math.hypot(t.local.x - body.x, t.local.z - body.z); if (d < 0.9) t.queue.join("you"); else if (t.queue.place("you") >= 0 && d > 2) t.queue.leave("you"); }
    steer([...list, body], dt, S.grid);
  }
  function shopperTask(a) {
    const r = rng(a.id, S.place.id, S.seen), shelves = (S.plan.shelves || []).filter((s) => s.section !== "checkout");
    const front = (sh) => S.grid.nearestFree(sh.x - Math.sin(sh.yaw) * (sh.deep / 2 + 0.45), sh.z - Math.cos(sh.yaw) * (sh.deep / 2 + 0.45));
    const steps = [];
    for (let k = 0, n = 2 + Math.floor(r() * 3); k < n && shelves.length; k += 1) {
      const sh = shelves[Math.floor(r() * shelves.length)], s = front(sh);
      if (s) steps.push({ x: s.x, z: s.z, dwell: 2.5 + r() * 4, face: sh.yaw + Math.PI, reach: true, label: "looking along the shelves" });
    }
    const tills = S.tills.filter((t) => t.kind === "self" || t.lane <= 2);
    const tl = tills.length ? tills[Math.floor(r() * tills.length)] : null;
    if (tl) steps.push({ x: tl.local.x, z: tl.local.z + S.queues.length * 0, dwell: 4 + r() * 3, queue: tl, label: tl.kind === "self" ? "scanning their shopping" : "paying" });
    const out = S.grid.nearestFree(S.plan.doorX, 0.8);
    if (out) steps.push({ x: out.x, z: out.z, dwell: 0.5, label: "heading out", leave: true });
    // Another shelf of the same section when one cannot be reached; another till when its line is too long.
    return task(steps, (st) => {
      if (st.queue) { const other = S.tills.find((t) => t !== st.queue && !t.queue.full()); return other ? { ...st, x: other.local.x, z: other.local.z, queue: other } : null; }
      const sh = shelves[Math.floor(r() * shelves.length)], s = sh && front(sh);
      return s ? { ...st, x: s.x, z: s.z, face: sh.yaw + Math.PI } : null;
    });
  }
  function staffTask(a) {
    // The first staff at the lanes, a cashier to each; the rest filling the shelves from the back.
    const staffed = S.tills.filter((t) => t.kind === "staffed" && t.cashier), k = [...S.agents.values()].filter((x) => x.staff && x !== a).length;
    if (k < staffed.length) { const c = S.grid.nearestFree(staffed[k].cashier.x, staffed[k].cashier.z, 3) || staffed[k].cashier; return task([{ x: c.x, z: c.z, dwell: 1e9, label: "on the till", staffPost: true }]); }
    const r = rng(a.id, S.seen), part = (S.plan.fixtures || []).find((f) => f.role === "partition");
    const back = S.grid.nearestFree(part ? part.door : 0, part ? part.z - 0.6 : S.plan.depth - 1) || { x: 0, z: S.plan.depth - 1 };
    const shelves = S.plan.shelves || [], sh = shelves[Math.floor(r() * shelves.length)];
    const s = sh && S.grid.nearestFree(sh.x - Math.sin(sh.yaw) * (sh.deep / 2 + 0.45), sh.z - Math.cos(sh.yaw) * (sh.deep / 2 + 0.45));
    return task([{ x: back.x, z: back.z, dwell: 3, label: "fetching stock from the back" }, ...(s ? [{ x: s.x, z: s.z, dwell: 8, face: sh.yaw + Math.PI, reach: true, label: "stocking the shelves" }] : [])]);
  }
  // In line at a till: where their place in it is; served only at the front.
  function lineUp(a, st) {
    const q = st.queue.queue, k = q.join(a.id);
    const spot = q.spot(k);
    // (A new place in the line, a new way to it; the same one, kept.)
    if (st.x !== spot.x || st.z !== spot.z) { st.x = spot.x; st.z = spot.z; a.goal = null; }
    if (k > 0) { a.t.dwell = 0; st.label = "waiting in line"; }
    else st.label = st.queue.kind === "self" ? "scanning their shopping" : "paying";
  }

  return { room, fitted, stocked, till, near, actions, take, close, frame, walk, step, active: () => Boolean(S.place), counterItems: () => S.items.length, has: (sku) => S.items.some((x) => x.sku === sku), state: () => ({ place: S.place?.id || null, items: S.items.length, gone: S.items.filter((x) => x.gone).length, tills: S.tills.map((t) => ({ kind: t.kind, lane: t.lane, line: t.queue?.ids.slice() || [] })), agents: [...S.agents.values()].map((a) => ({ id: a.id, x: a.x, z: a.z, staff: a.staff, step: a.t?.i, label: a.t?.steps[a.t.i]?.label })) }) };
}
