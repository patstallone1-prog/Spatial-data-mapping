// Things in the world's books (the object lab's plan, sections 3-6): records for the things that
// need one (things.mjs), what each is for (uses.mjs), what comes of an act on one (outcomes.mjs),
// and selling it again (resale.mjs) -- installed on CityWorld as enterprise.mjs is, its commands
// added to the world's and its state saved with it (tests/city_commerce.test.mjs).
//
// The joins, in short:
//   - a delivery's parcel is a real package of the shop's own goods, owned by the customer from the
//     moment it is paid for, carried in the courier's custody, its pay held until it is handed over
//     sealed (a tampered one is refused; a damaged or spilled one is paid less);
//   - putting a thing down, picking it up, handing it over or throwing it moves its record with it;
//     what is inside goes too, and is weighed with it;
//   - a crash yields nothing to pick up, and one incident is one bill however often it is reported;
//   - breaking what is not yours yields litter, never goods;
//   - every sale is the thing's own: one buyer, one record, one entry in the books.

import { Things, ThingError, conditionBand } from "./things.mjs";
import { Outcomes, droppedPackage, eventRng, reclaim, wheelRemoval, deviceState, containerContents } from "./outcomes.mjs";
import { verbsOf, repairKit, comfortOf, recipeFor } from "./uses.mjs";
import { eligibility, offerFor, shippingQuote, shippedReceipt, listingChance, consignChance, resaleGroup } from "./resale.mjs";
import { salesRate, storesAt } from "./core.mjs";
import { rng } from "./people.mjs";
import { vehicleState } from "./fleet.mjs";

export const COMMERCE_COMMANDS = ["inspect", "apply", "remove_part", "sell_quote", "sell", "list_item", "unlist", "accept_buyer", "decline_buyer",
  "ship_listing", "consign", "collect_consigned"];
const HOUR = 3_600_000, DAY = 86_400_000;

export function installCommerce(CityWorld, CityError) {
  const W = CityWorld.prototype;
  const fail = (m) => { throw new CityError(m); };
  const T = (w) => (w._things ||= new Things(w.R, { seed: w.seed }));
  const O = (w) => (w._outcomes ||= new Outcomes());
  const K = (w) => (w._commerce ||= { listings: new Map(), quotes: new Map(), rapport: {}, skills: {}, cash: {}, bought: {}, quoted: {}, consigned: new Map(), seq: 0 });
  const U = (w) => w.R.commerce.uses;
  const S = (w) => w.R.commerce.resale;
  const name = (w, sku) => (w.R.items[sku]?.name || sku).toLowerCase();
  const take = (inv, item, n = 1) => { inv[item] = (inv[item] || 0) - n; if (inv[item] <= 0) delete inv[item]; };
  const give = (inv, item, n = 1) => { inv[item] = (inv[item] || 0) + n; };
  const near = (p, x, z, reach) => p.x === undefined || x === undefined || Math.hypot(p.x - x, p.z - z) <= reach;
  const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof ThingError) fail(e.message); throw e; } };
  W.thingBook = function () { return T(this); };
  W.skillOf = function (pid, k) { return K(this).skills[pid]?.[k] || 0; };
  W.rapportOf = function (pid, npc) { return K(this).rapport[`${pid}|${npc}`] || 0; };
  W.listingsOf = function (pid) { return [...K(this).listings.values()].filter((l) => l.pid === pid && l.status !== "done"); };
  W.consignedOf = function (pid) { return [...K(this).consigned.values()].filter((c) => c.pid === pid && c.status !== "done"); };
  const learn = (w, pid, k, by) => { const s = (K(w).skills[pid] ||= {}); s[k] = Math.min(w.R.commerce.outcomes.skill_max, (s[k] || 0) + by); return s[k]; };

  //: The record of the unit of ``sku`` the player acts on: ``thing`` if named (and theirs), else
  //: the one they hold (made now for a plain unit).
  W.unitOf = function (p, sku, thing = null) {
    const B = T(this);
    if (thing) {
      const th = B.all.get(thing);
      if (!th || th.at.kind !== "held" || th.at.holder !== p.account) fail("you are not carrying that");
      return th;
    }
    if (!(p.inventory[sku] > 0)) fail("you are not carrying that");
    return guard(() => B.ensure(p.account, sku, p.inventory[sku], { t: this.now }));
  };

  // ---- the books agree after every command ----------------------------------------------------------
  const submit = W.submit;
  W.submit = function (pid, command, args = {}) {
    const out = submit.call(this, pid, command, args);
    const p = this.players.get(pid);
    if (p) T(this).reconcile(p.account, p.inventory, this.now);
    return out;
  };
  //: What you carry weighs what is in your bags and boxes too (lab plan 4: nested bags cannot hide
  //: weight); a delivery's parcel weighs its package and its goods.
  const carry = W.carry;
  W.carry = function (p) {
    const c = carry.call(this, p), B = T(this);
    let extra = 0;
    for (const th of B.heldBy(p.account)) if (th.box) extra += B.massOf(th) - (this.R.items[th.sku]?.kg || 0);
    return { ...c, kg: Math.round((c.kg + extra) * 100) / 100 };
  };
  const ctxOf = W.vitalsContext;
  W.vitalsContext = function (p) {
    const c = ctxOf.call(this, p);
    if (c.home) c.comfort = this.comfortAt(p).rest_bonus;
    return c;
  };
  W.comfortAt = function (p) {
    const home = p.home?.building || null;
    const placed = home ? [...T(this).all.values()].filter((t) => t.at.kind === "placed" && t.at.home === home && t.owner === p.account).map((t) => t.sku) : [];
    return { ...comfortOf(this.R, placed), placed };
  };

  // ---- a delivery is a real package ------------------------------------------------------------------
  //: What a shop's order is: one to three of the things it sells (seeded by the delivery), each in
  //: its packaging, in the package that suits them (a pizza box; a paper bag with sealed meal boxes
  //: and soup cups; a grocery tote; a shipping box).
  W.packOrder = function (p, d, keys = null) {
    const B = T(this), R = this.R;
    const stores = keys?.length ? storesAt(R, keys) : [];
    let pool = stores.flatMap((st) => st.items).filter((id) => R.items[id] && !R.items[id].service && !R.items[id].parcel && !R.items[id].container && R.items[id].kg > 0 && R.items[id].kg <= 5 && (R.items[id].length_m || 0) <= 0.44);
    if (!pool.length) pool = (R.stores.kinds.restaurant?.items || []).filter((id) => R.items[id] && !R.items[id].service);
    const r = rng(this.seed, "order", d.id);
    const n = 1 + Math.floor(r() * 3), lines = [];
    for (let k = 0; k < n; k += 1) lines.push(pool[Math.floor(r() * pool.length) % pool.length]);
    const food = lines.every((id) => ["prepared_food"].includes(R.items[id].kind) || R.items[id].material_of === "food" || R.items[id].material_of === "liquid");
    const pizza = lines.every((id) => /pizza/.test(id));
    const groceries = lines.every((id) => R.items[id].kind === "groceries");
    const big = lines.some((id) => (R.items[id].length_m || 0) > 0.3) || lines.reduce((s, id) => s + R.items[id].kg, 0) > 5;
    const pack = pizza && lines.length === 1 ? "pizza_box" : food ? "paper_food_bag" : groceries ? "grocery_tote" : big ? "shipping_box_medium" : "shipping_box_small";
    const customer = this.ledger.open(`resident:${d.to.id}`, "resident");
    const parcel = guard(() => B.make("parcel", { owner: customer, at: { kind: "held", holder: p.account }, t: this.now,
      box: { contents: [], seal: "open" }, extra: { pack, job: d.id } }));
    const packed = [];
    for (const id of lines) {
      const soupy = /soup|chowder|ramen|pho|curry|tikka|chow_mein/.test(id);
      const inner = R.items[id].kind === "prepared_food" && pack === "paper_food_bag" ? (soupy ? "soup_cup" : R.items[id].material_of === "liquid" ? null : "sealed_meal_box") : null;
      // In its packaging, the order's own goods. What does not fit is not sent (and not charged):
      // never a substitute.
      const it = B.make(id, { owner: customer, at: { kind: "held", holder: "packing" }, t: this.now });
      let holder = null;
      try {
        if (inner) { holder = B.make(inner, { owner: customer, at: { kind: "held", holder: "packing" }, t: this.now }); B.move(holder, { kind: "in", parent: parcel.id }, { t: this.now, why: "packed" }); }
        B.move(it, { kind: "in", parent: (holder || parcel).id }, { t: this.now, why: "packed" });
        if (holder) holder.box.seal = "intact";
        packed.push(id);
      } catch (e) {
        if (!(e instanceof ThingError)) throw e;
        B.end(it, "did not fit", this.now); if (holder) B.end(holder, "did not fit", this.now);
      }
    }
    lines.splice(0, lines.length, ...packed);
    parcel.box.seal = "intact";
    d.package = parcel.id; d.pack = pack; d.lines = lines;
    // The customer pays the shop for the goods (it is the city's money coming in), and the courier's
    // pay is held for them until the package is in their hands.
    const goods = lines.reduce((s, id) => s + R.items[id].price, 0);
    const shop = this.ledger.open(`business:${d.from.id}`, "business");
    if (goods > 0) this.ledger.mint(shop, goods, "npc_income", { at: this.now, memo: `order ${d.id}`, key: `order:${d.id}` });
    d.escrow = this.ledger.open(`escrow:${d.id}`, "escrow");
    this.ledger.mint(d.escrow, d.pay, "npc_income", { at: this.now, memo: `delivery pay held, ${d.id}`, key: `escrow:${d.id}` });
    return parcel;
  };
  const takeDelivery = W.cmd_take_delivery;
  W.cmd_take_delivery = function (pid, args) {
    const out = takeDelivery.call(this, pid, args), p = this.player(pid);
    this.packOrder(p, p.delivery, args.place?.keys);
    return { ...out, delivery: p.delivery };
  };
  const collect = W.cmd_collect_delivery;
  W.cmd_collect_delivery = function (pid, args) {
    const out = collect.call(this, pid, args), p = this.player(pid);
    this.packOrder(p, p.delivery, args?.keys || null);
    return { ...out, delivery: p.delivery };
  };
  //: Handing it over: to the address, sealed. A seal broken on the way is refused; a damaged
  //: package or a spill is accepted and paid less (lab plan 4: pay for the work actually done).
  W.cmd_deliver = function (pid) {
    const p = this.player(pid), d = p.delivery, B = T(this);
    if (!d) fail("no delivery to make");
    if (d.stage === "pickup") fail(`pick the order up at ${d.from.name || "the shop"} first`);
    if (!near(p, d.to.x, d.to.z, this.R.delivery.reach_m)) fail("this is not the address");
    const parcel = d.package && B.all.get(d.package);
    if (parcel && (parcel.at.kind !== "held" || parcel.at.holder !== p.account)) fail("you have put the order down: pick it up first");
    const late = this.now > d.due;
    let share = late ? 0.5 : 1, verdict = "accepted";
    if (parcel) {
      const spilled = (function walk(t) { return t.spilled || (t.box?.contents || []).some((c) => B.all.has(c) && walk(B.all.get(c))); })(parcel);
      if (parcel.box.seal !== "intact") { share = 0; verdict = "refused: the seal was broken"; }
      else if (spilled) { share *= 0.5; verdict = "accepted, with a spill"; }
      else if (parcel.condition.integrity < 0.9) { share *= 0.75; verdict = "accepted, the package damaged"; }
    }
    const pay = Math.round(d.pay * share);
    const escrow = d.escrow || this.ledger.open(`escrow:${d.id}`, "escrow");
    if (!d.escrow) this.ledger.mint(escrow, d.pay, "npc_income", { at: this.now, memo: "delivery pay", key: `escrow:${d.id}` });
    if (pay > 0) this.ledger.transfer(escrow, p.account, pay, { kind: "gig", memo: `Delivery to ${d.to.name || "an address"}${late ? " (late)" : ""}`, at: this.now, key: `paid:${d.id}` });
    const left = this.ledger.balance(escrow);
    if (left > 0) this.ledger.burn(escrow, left, "external_supplier", { at: this.now, memo: "pay not earned, back to the customer", key: `refund:${d.id}` });
    take(p.inventory, "parcel", 1);
    if (parcel) {
      if (share > 0) { parcel.at = { kind: "held", holder: parcel.owner }; parcel.job = null; B.end(parcel, "delivered", this.now); }
      else B.end(parcel, "refused", this.now);
    }
    p.delivery = null;
    if (d.task && p.task?.id === d.task) p.task = null;
    this.log("delivered", { player: pid, pay, late, verdict });
    return { pay, late, verdict, balance: this.ledger.balance(p.account) };
  };
  const endDelivery = (w, p, why) => {
    const d = p.delivery, B = T(w);
    if (d?.package && B.all.has(d.package)) B.end(d.package, why, w.now);
    if (d?.escrow) { const left = w.ledger.balance(d.escrow); if (left > 0) w.ledger.burn(d.escrow, left, "external_supplier", { at: w.now, memo: "delivery cancelled", key: `refund:${d.id}` }); }
  };
  const cancelDelivery = W.cmd_cancel_delivery;
  W.cmd_cancel_delivery = function (pid) { const p = this.player(pid); endDelivery(this, p, "cancelled: back to the shop"); return cancelDelivery.call(this, pid); };
  const cancelTask = W.cmd_cancel_task;
  W.cmd_cancel_task = function (pid) { const p = this.player(pid); if (p.task?.kind === "courier" && p.delivery?.task === p.task.id) endDelivery(this, p, "cancelled: back to the shop"); return cancelTask.call(this, pid); };

  // ---- a thing's record goes where the thing goes --------------------------------------------------------
  //: Putting down: the record (and what is in it) on the ground; a delivery may be put down too,
  //: and stays the customer's in your care (only you or they may lift it).
  W.cmd_drop = function (pid, { item, qty = 1, thing = null }) {
    const p = this.player(pid), spec = this.R.items[item], B = T(this);
    qty = Math.max(1, qty | 0);
    if (!spec || !(p.inventory[item] >= qty)) fail("you are not carrying that");
    const ids = [];
    for (let k = 0; k < qty; k += 1) {
      const recs = B.heldBy(p.account, item);
      const th = thing && k === 0 ? recs.find((r) => r.id === thing) : recs.find((r) => !r.job) || recs[0];
      if (th) { guard(() => B.move(th, { kind: "ground", x: p.x ?? 0, z: p.z ?? 0 }, { t: this.now, why: "put down" })); ids.push(th.id); }
    }
    take(p.inventory, item, qty);
    for (const slot of Object.keys(p.worn)) if (p.worn[slot] === item && !p.inventory[item]) p.worn[slot] = null;
    const id = this.id("item");
    this.items.set(id, { id, item, qty, x: p.x ?? 0, z: p.z ?? 0, by: pid, at: this.now, things: ids, look: ids.length === 1 ? B.all.get(ids[0])?.pack || null : null });
    if (this.items.size > 400) this.items.delete(this.items.keys().next().value);
    return { dropped: id };
  };
  const pickUp = W.cmd_pick_up;
  W.cmd_pick_up = function (pid, args) {
    const p = this.player(pid), B = T(this);
    const lying = this.items.get(args.id);
    if (lying?.things?.length) {
      for (const tid of lying.things) {
        const th = B.all.get(tid);
        if (th?.job && th.at.kind === "ground") {
          const d = p.delivery;
          if (!d || d.id !== th.job) fail("that is someone's order: only its courier may carry it");
        }
      }
    }
    // A found container is the city's (left out for whoever wants it): its record is made once.
    const out = pickUp.call(this, pid, args);
    if (lying?.things?.length) for (const tid of lying.things) { const th = B.all.get(tid); if (th && th.at.kind === "ground") guard(() => B.move(th, { kind: "held", holder: p.account }, { t: this.now, why: "picked up" })); if (th && !th.job && th.owner === null) th.owner = p.account; }
    if (args.found?.box) {
      // A box or bag left out: its contents were drawn when it was placed (the view's seed), and are
      // made into records now, the same for whoever opens it.
      const F = this.R.commerce.outcomes.found_containers;
      if (F.kinds.includes(out.item) && !B.all.has(`found:${args.found.id}`)) {
        const box = guard(() => B.make(out.item, { id: `found:${args.found.id}`, owner: p.account, at: { kind: "held", holder: p.account }, t: this.now }));
        const r = rng(this.seed, "found-box", args.found.id);
        const n = F.per[0] + Math.floor(r() * (F.per[1] - F.per[0] + 1));
        for (const sku of containerContents(F.pool, n, r)) {
          const c = B.make(sku, { owner: p.account, at: { kind: "held", holder: "packing" }, t: this.now });
          try { B.move(c, { kind: "in", parent: box.id }, { t: this.now, why: "found inside" }); } catch { B.end(c, "did not fit", this.now); }
        }
        if (box.box.seal === "intact") box.box.seal = "open";
      }
    }
    return out;
  };
  const giveItem = W.cmd_give_item;
  W.cmd_give_item = function (pid, args) {
    const p = this.player(pid), B = T(this);
    const recs = B.heldBy(p.account, args.item).filter((r) => !r.job);
    const th = args.thing ? recs.find((r) => r.id === args.thing) : recs[0];
    if (B.heldBy(p.account, args.item).some((r) => r.job) && !recs.length) fail("that is someone's order: hand it over at its address");
    const out = giveItem.call(this, pid, args);
    const q = this.player(args.to);
    if (th) { th.at = { kind: "held", holder: q.account }; if (th.owner === p.account) th.owner = q.account; th.v += 1; B.note(th, this.now, "given"); }
    return out;
  };
  const throwIt = W.cmd_throw;
  W.cmd_throw = function (pid, args = {}) {
    const p = this.player(pid), B = T(this), item = args.item || p.hands;
    const recs = item ? B.heldBy(p.account, item) : [];
    if (recs.some((r) => r.job) && recs.every((r) => r.job)) fail("that is someone's order: hand it over, do not throw it");
    const th = recs.find((r) => !r.job) || null;
    const out = throwIt.call(this, pid, args);
    if (th) {
      if (out.dropped && out.landed === item) {
        guard(() => B.move(th, { kind: "ground", x: out.at.x, z: out.at.z }, { t: this.now, why: "thrown" }));
        const lying = this.items.get(out.dropped); if (lying) lying.things = [th.id];
        // What is inside a thrown box takes the fall (from about the throw's height).
        if (th.box?.contents?.length) this.fallOf(th, 1.8, `throw:${th.id}:${th.v}`);
      } else B.end(th, out.lands === "spills" ? "spilled" : "broke", this.now);
    }
    return out;
  };
  //: A box that falls: each package of food in it intact, damaged or spilled (outcomes
  //: droppedPackage), drawn once for the fall.
  W.fallOf = function (box, height, eventId) {
    const B = T(this);
    return O(this).once(eventId, () => {
      const results = [];
      const walk = (t) => {
        for (const c of t.box?.contents || []) {
          const inner = B.all.get(c);
          if (!inner) continue;
          const food = ["prepared_food", "groceries"].includes(this.R.items[inner.sku]?.kind) || inner.box;
          if (food) {
            const r = eventRng(this.seed, inner.id, inner.v, eventId);
            const out = droppedPackage({ height, sealed: (inner.box?.seal || t.box?.seal) === "intact", fragile: this.R.items[inner.sku]?.material_of === "liquid", soft: false }, r());
            if (out.result === "package_damaged") B.mark(inner, { condition: { integrity: Math.max(0, inner.condition.integrity - this.R.commerce.outcomes.package_damage) } }, { t: this.now, why: "dropped" });
            if (out.result === "spilled") B.mark(inner, { spilled: true, condition: { integrity: 0.2 } }, { t: this.now, why: "spilled" });
            results.push({ thing: inner.id, sku: inner.sku, result: out.result });
          }
          if (inner.box) walk(inner);
        }
      };
      walk(box);
      if (results.some((x) => x.result !== "intact")) B.mark(box, { condition: { integrity: Math.max(0, box.condition.integrity - 0.15) } }, { t: this.now, why: "dropped" });
      return { results };
    });
  };
  const useIt = W.cmd_use;
  W.cmd_use = function (pid, args) {
    const p = this.player(pid), B = T(this);
    const th = B.heldBy(p.account, args.item)[0] || null;
    if (th?.job) fail("that is someone's order");
    if (th?.box?.seal === "intact") fail(`the ${name(this, th.sku)} is sealed: open it first`);
    const out = useIt.call(this, pid, args);
    if (th && out.effect && !(p.inventory[args.item] >= B.heldBy(p.account, args.item).length)) B.end(th, "used", this.now);
    return out;
  };

  // ---- breaking and crashing: believable, once -----------------------------------------------------
  //: One incident, one result: the same collision reported again (by the next frames, by both
  //: cars) is not hurt, billed or fined again. A crash with packages in your arms drops them.
  const collision = W.cmd_collision;
  W.cmd_collision = function (pid, args = {}) {
    const p = this.player(pid);
    const other = args.vehicle?.id || args.npc?.id || "none";
    const key = `collision:${pid}:${args.kind}:${other}:${Math.floor(this.now / 15_000)}`;
    return O(this).once(key, () => {
      const out = collision.call(this, pid, args);
      if (args.kind === "hit_by_car" && (Number(args.speed) || 0) > 2) {
        for (const th of T(this).heldBy(p.account)) if (th.box?.contents?.length) this.fallOf(th, 1.1, `${key}:${th.id}`);
      }
      return { ...out, items: [] };
    });
  };
  //: Taking a car is blocked by its lock without bolt cutters in hand (they cut it).
  const takeIt = W.cmd_take;
  W.cmd_take = function (pid, args) {
    const p = this.player(pid), a = this.registry.assets.get(args.asset);
    if (a?.attrs?.locked) {
      if (p.hands !== U(this).lock.cut_by) fail(`it is locked: it takes ${name(this, U(this).lock.cut_by)} to cut a lock`);
      const lock = T(this).all.get(a.attrs.locked);
      if (lock) T(this).end(lock, "cut", this.now);
      a.attrs.locked = null;
    }
    return takeIt.call(this, pid, args);
  };
  const drive = W.cmd_drive;
  W.cmd_drive = function (pid, args) {
    const a = this.registry.assets.get(args.vehicle);
    if (a && (a.attrs.wheels ?? 4) < 4) fail("it has a wheel off: fit a car tyre (and have a wrench)");
    if (a?.attrs?.locked && a.owner === this.player(pid).account) fail("unlock it first (the lock is on it)");
    return drive.call(this, pid, args);
  };

  // ---- looking at a thing --------------------------------------------------------------------------
  W.cmd_inspect = function (pid, { item, thing = null }) {
    const p = this.player(pid), th = this.unitOf(p, item, thing), it = this.R.items[th.sku] || {};
    const L = th.latent || {}, seen = [];
    if (L.age > 0.4) seen.push("well used"); else if (L.age > 0.15) seen.push("some wear"); else seen.push("nearly new");
    if (L.corrosion > 0.2) seen.push("rust on it");
    if (L.completeness < 0.95) seen.push("a part missing");
    if (L.contamination > 0.1) seen.push("grubby");
    if (th.box) seen.push(th.box.contents.length ? `${th.box.contents.length} thing${th.box.contents.length > 1 ? "s" : ""} inside${th.box.seal === "intact" ? ", sealed" : ""}` : "empty");
    const device = it.device || U(this).inspect.testers[th.sku] ? deviceState(L, Boolean(th.tested)) : null;
    return { thing: th.id, sku: th.sku, condition: conditionBand(th.condition.integrity), integrity: th.condition.integrity, seen, device, group: resaleGroup(this.R, th.sku),
      charge: th.charge ?? null, uses_left: th.uses_left ?? null, fill: th.fill || null, lit: Boolean(th.lit), job: th.job || null, history: th.log.slice(-6) };
  };
  //: The verbs a carried thing has now (the bag's buttons), from uses.mjs.
  W.verbsFor = function (pid, item, ctx = {}) {
    const p = this.player(pid), B = T(this);
    const th = B.heldBy(p.account, item)[0] || null;
    const mine = this.registry.held(p.account).filter((a) => a.kind === "vehicle" && a.attrs.x !== undefined && near(p, a.attrs.x, a.attrs.z, U(this).install.reach_m));
    return verbsOf(this.R, item, th, p, { atHome: this.atHome(p), nearCar: mine[0] || null, ...ctx });
  };

  // ---- doing something with it ---------------------------------------------------------------------
  W.cmd_apply = function (pid, args = {}) {
    const p = this.player(pid), verb = args.verb, sku = args.item;
    const fn = VERBS[verb];
    if (!fn) fail("you cannot do that with it");
    if (verb !== "unlock" && !(p.inventory[sku] > 0)) fail("you are not carrying that");
    return fn.call(this, p, sku, args);
  };
  const ownCarNear = (w, p, id = null) => {
    const list = w.registry.held(p.account).filter((a) => a.kind === "vehicle" && a.custody === "owner" && a.owner === p.account && (!id || a.id === id));
    const a = list.find((x) => x.attrs.x !== undefined && near(p, x.attrs.x, x.attrs.z, U(w).install.reach_m));
    if (!a) fail("stand by a car of yours (parked, within a few metres)");
    if (p.driving?.vehicle === a.id) fail("get out of it first");
    return a;
  };
  const VERBS = {
    read(p, sku) {
      const spec = U(this).read[sku]; if (!spec) fail("nothing to read");
      const th = this.unitOf(p, sku), first = !th.read;
      th.read = true; th.v += 1;
      const effect = spec.stamina ? this.useEffect(p, { use: { stamina: first ? spec.stamina : spec.stamina / 2 } }) : {};
      const out = { item: sku, minutes: spec.minutes, effect, first };
      if (spec.reading && first) out.reading = learn(this, p.id, "reading", spec.reading);
      if (spec.map) { p.knows_map = true; out.map = true; }
      if (spec.news) {
        const kinds = {};
        for (const e of this.events) if (e.t > this.now - DAY) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
        out.news = { day: this.time.day, kinds };
      }
      return out;
    },
    place(p, sku, { thing = null } = {}) {
      if (U(this).place.comfort[sku] === undefined) fail("that is not for putting up at home");
      if (!p.home || !this.atHome(p)) fail("at home only: go in at your home first");
      const th = this.unitOf(p, sku, thing);
      guard(() => T(this).move(th, { kind: "placed", home: p.home.building, x: p.x, z: p.z }, { t: this.now, why: "put up at home" }));
      take(p.inventory, sku, 1);
      return { placed: th.id, comfort: this.comfortAt(p) };
    },
    unplace(p, sku, { thing }) {
      const th = T(this).all.get(thing);
      if (!th || th.at.kind !== "placed" || th.owner !== p.account) fail("nothing of yours put up there");
      if (!this.atHome(p)) fail("at home only");
      guard(() => T(this).move(th, { kind: "held", holder: p.account }, { t: this.now, why: "taken down" }));
      give(p.inventory, th.sku, 1);
      return { item: th.sku, comfort: this.comfortAt(p) };
    },
    gift(p, sku, { npc = null, thing = null } = {}) {
      const G = U(this).gift;
      if (G.rapport[sku] === undefined) fail("that is not much of a gift");
      if (!npc?.id) fail("give it to whom? stand by someone");
      if (!near(p, npc.x, npc.z, G.reach_m * 2)) fail("closer: hand it to them");
      const th = this.unitOf(p, sku, thing);
      if (th.condition.integrity < 0.45) fail("it is too worn to give");
      const fresh = (p.fresh_until || 0) > this.now;
      const key = `${p.id}|${npc.id}`, R0 = K(this).rapport;
      const gain = G.rapport[sku] * (fresh ? 1 + G.fresh_bonus : 1);
      R0[key] = Math.round(((R0[key] || 0) + gain) * 10) / 10;
      th.owner = `npc:${npc.id}`; T(this).end(th, "given", this.now);
      take(p.inventory, sku, 1);
      const t = this.openThread?.(`npc:people:${p.id}`, () => ({ tab: "npc", kind: "people", name: "People you know", members: [p.id] }));
      if (t) this.post(t, { from: "npc", name: npc.name || "A neighbour", text: `Thank you for the ${name(this, sku)}${npc.name ? "" : ""} -- that's kind of you.` });
      return { to: npc.name || null, rapport: R0[key], gain };
    },
    install(p, sku, { vehicle = null, thing = null } = {}) {
      const spec = U(this).install.vehicle[sku]; if (!spec) fail("that does not fit a car");
      const a = ownCarNear(this, p, vehicle);
      if (spec.tool && !(p.inventory[spec.tool] > 0)) fail(`fitting it needs a ${name(this, spec.tool)}`);
      if (spec.wheel && (a.attrs.wheels ?? 4) >= 4) fail("all four wheels are on");
      const th = this.unitOf(p, sku, thing);
      const gain = spec.condition * (th.condition.integrity ?? 1);
      a.attrs.condition = Math.min(100, Math.round((a.attrs.condition ?? 100) + gain));
      a.attrs.state = vehicleState(this.R, a.attrs.condition);
      if (spec.wheel) a.attrs.wheels = (a.attrs.wheels ?? 4) + 1;
      T(this).move(th, { kind: "vehicle", vehicle: a.id }, { t: this.now, why: "fitted" });
      take(p.inventory, sku, 1);
      learn(this, p.id, "mechanic", this.R.commerce.outcomes.skill_per_job);
      return { vehicle: a.id, condition: a.attrs.condition, wheels: a.attrs.wheels ?? 4 };
    },
    repair(p, sku, { target = null } = {}) {
      const Rp = U(this).repair;
      const d = target?.key ? this.damage.get(target.key) : null;
      if (!d) fail("nothing broken there");
      if (!near(p, d.x, d.z, Rp.reach_m * 2)) fail("closer: within reach of it");
      const kit = repairKit(this.R, d.material, p.inventory, { high: Rp.high.includes(d.archetype) });
      if (kit.missing) fail(`mending it needs ${kit.missing}`);
      take(p.inventory, kit.material, 1);
      const before = d.wear;
      d.wear = Math.max(0, d.wear - d.break_j * Rp.share_per_use);
      d.last = this.now;
      const mended = d.wear <= 0;
      const out = { mended, share: d.wear / d.break_j, used: kit.material, tool: kit.tool };
      // Your own damage mended: the court's bill for the repair is reduced by what you did, and
      // dismissed when it is whole again. Someone else's: public works pays you a share.
      const bill = [...this.billing.bills.values()].find((b) => b.key === `restitution:${d.key}` && b.payer === p.account && b.status === "open");
      if (bill) {
        if (mended) { this.billing.dismiss(bill.id, this.now, "mended by the one who broke it"); out.restitution = "dismissed"; }
        else { bill.owed = Math.max(0, Math.round(bill.owed * (d.wear / Math.max(1, before)))); out.restitution = bill.owed; }
      } else if (mended && d.by !== p.id) {
        const cost = this.R.damage.repair_cost[d.archetype] ?? this.R.damage.repair_cost.default;
        const pay = Math.round(cost * Rp.public_pay_share);
        this.ledger.mint(p.account, pay, "public_contract", { at: this.now, memo: `Public works: mended ${d.name || "it"}`, key: `mend:${d.key}:${d.broken || d.last}` });
        out.paid = pay;
      }
      if (mended) this.damage.delete(d.key);
      learn(this, p.id, "repair", this.R.commerce.outcomes.skill_per_job);
      return out;
    },
    cook(p, sku) {
      if (!this.atHome(p)) fail("cook at home");
      const rc = recipeFor(this.R, sku, p.inventory);
      if (!rc) fail("not enough to cook with");
      for (const [k, n] of Object.entries(rc.from)) take(p.inventory, k, n);
      give(p.inventory, rc.makes, rc.qty);
      return { makes: rc.makes, qty: rc.qty, minutes: U(this).cook.minutes };
    },
    groom(p, sku) {
      const n = U(this).groom.uses[sku]; if (!n) fail("not for that");
      const th = this.unitOf(p, sku);
      th.uses_left = (th.uses_left ?? n) - 1; th.opened = true; th.v += 1;
      p.fresh_until = this.now + U(this).groom.fresh_hours * HOUR;
      if (th.uses_left <= 0) { T(this).end(th, "used up", this.now); take(p.inventory, sku, 1); }
      return { fresh_until: p.fresh_until, uses_left: Math.max(0, th.uses_left) };
    },
    fill(p, sku, { water = false } = {}) {
      const l = U(this).fill.holds_l[sku]; if (l === undefined) fail("it holds no water");
      if (!this.atHome(p) && !water) fail("fill it at home, or at a drinking fountain");
      const th = this.unitOf(p, sku);
      if (th.condition.integrity < 0.2) fail("it is broken");
      th.fill = { what: "water", l }; th.v += 1;
      return { fill: th.fill };
    },
    drink_fill(p, sku) {
      const th = this.unitOf(p, sku);
      if (!(th.fill?.l > 0)) fail("it is empty");
      const D = U(this).fill.drink, part = Math.min(1, th.fill.l / 0.5);
      const effect = this.useEffect(p, { use: { stamina: D.stamina * part, health: D.health * part } });
      th.fill = null; th.v += 1;
      return { effect };
    },
    light(p, sku, { thing = null } = {}) {
      const spec = U(this).light.items[sku]; if (!spec || spec.placed) fail("it does not light that way");
      const th = this.unitOf(p, sku, thing);
      if (th.lit) {
        const hours = (this.now - th.lit) / HOUR;
        th.charge = Math.max(0, (th.charge ?? 1) - hours / spec.hours);
        th.lit = null; th.v += 1;
        return { lit: false, charge: th.charge };
      }
      if (spec.needs && !(p.inventory[spec.needs] > 0)) fail(`lighting it needs a ${name(this, spec.needs)}`);
      if ((th.charge ?? 1) <= 0) fail("it is flat: charge it, or fit batteries");
      th.lit = this.now; th.v += 1;
      return { lit: true, charge: th.charge ?? 1, hours: (th.charge ?? 1) * spec.hours };
    },
    charge(p, sku, { device = null } = {}) {
      const C = U(this).charge, from = C.from[sku];
      if (!from) fail("that charges nothing");
      const dev = device || Object.keys(C.devices).find((d) => p.inventory[d] > 0 && (!from.only || from.only.includes(d)));
      if (!dev || !(p.inventory[dev] > 0)) fail("nothing of yours to charge");
      if (from.only && !from.only.includes(dev)) fail(`${name(this, sku)} do not fit a ${name(this, dev)}`);
      if (from.at === "home" && !this.atHome(p)) fail("plug it in at home");
      const th = this.unitOf(p, dev);
      if (from.charges) {
        const src = this.unitOf(p, sku);
        src.charges_left = (src.charges_left ?? from.charges) - 1; src.v += 1;
        if (src.charges_left <= 0) { T(this).end(src, "used up", this.now); take(p.inventory, sku, 1); }
      }
      if (th.lit) th.lit = this.now;
      th.charge = 1; th.v += 1;
      return { device: dev, charge: 1 };
    },
    lock(p, sku, { vehicle = null } = {}) {
      if (!U(this).lock.items.includes(sku)) fail("that locks nothing");
      const a = ownCarNear(this, p, vehicle);
      if (a.attrs.locked) fail("it is locked already");
      const th = this.unitOf(p, sku);
      T(this).move(th, { kind: "vehicle", vehicle: a.id }, { t: this.now, why: "locked on" });
      take(p.inventory, sku, 1);
      a.attrs.locked = th.id;
      return { vehicle: a.id, locked: true };
    },
    unlock(p, _sku, { vehicle = null } = {}) {
      const a = ownCarNear(this, p, vehicle);
      const th = a.attrs.locked && T(this).all.get(a.attrs.locked);
      if (!th) fail("it is not locked");
      T(this).move(th, { kind: "held", holder: p.account }, { t: this.now, why: "unlocked" });
      give(p.inventory, th.sku, 1);
      a.attrs.locked = null;
      return { vehicle: a.id, locked: false, item: th.sku };
    },
    mail(p, sku, { to = null, text = "" } = {}) {
      const M = U(this).mail;
      if (!M.items.includes(sku)) fail("you cannot post that");
      if (!(p.inventory[M.needs] > 0)) fail(`posting it needs a ${name(this, M.needs)}`);
      if (!to || !this.players.has(to) || to === p.id) fail("post it to whom? (another player)");
      const th = this.unitOf(p, sku);
      T(this).end(th, "posted", this.now);
      take(p.inventory, sku, 1); take(p.inventory, M.needs, 1);
      const t = this.dm?.(p.id, to);
      if (t) this.post(t, { from: "system", text: `${p.name} sent you a ${name(this, sku)}${text ? `: "${String(text).slice(0, 200)}"` : "."}` });
      return { to, item: sku };
    },
    clean(p, sku, { litter = [] } = {}) {
      const C = U(this).clean;
      if (sku !== C.tool) fail("sweep with a broom");
      if (!(p.inventory[C.bag] > 0)) fail("you need a trash bag to sweep into");
      const bag = this.unitOf(p, C.bag);
      if (bag.box?.seal === "intact") fail("the bag is tied shut");
      let n = 0, kg = 0;
      for (const id of (litter || []).slice(0, 12)) {
        const x = this.items.get(id);
        if (!x || !C.litter.includes(x.item) || !near(p, x.x, x.z, C.reach_m) || (x.by !== "litter" && x.by !== "debris")) continue;
        this.items.delete(id); n += 1; kg += (this.R.items[x.item]?.kg || 0) * x.qty;
      }
      if (!n) fail("nothing here to sweep up");
      bag.box.loose_kg = Math.round(((bag.box.loose_kg || 0) + kg) * 100) / 100; bag.v += 1;
      const pay = Math.round(this.R.money(C.pay_per_item_kcr) * n);
      this.ledger.mint(p.account, pay, "public_contract", { at: this.now, memo: `Street cleaning: ${n} piece${n > 1 ? "s" : ""} of litter` });
      return { swept: n, kg, pay };
    },
    disassemble(p, sku, { thing = null } = {}) {
      const D = U(this).disassemble, yields = D.yields[sku];
      if (!yields) fail("it does not come apart into anything useful");
      const tool = D.tools.find((t) => p.inventory[t] > 0);
      if (!tool) fail("taking it apart needs a tool");
      const th = this.unitOf(p, sku, thing);
      if (th.owner !== p.account) fail("it is not yours to take apart");
      const ev = `apart:${th.id}:${th.v}`;
      const out = O(this).once(ev, () => {
        const r = eventRng(this.seed, th.id, th.v, ev), got = {};
        for (const [k, n] of Object.entries(yields)) {
          if (this.R.items[k]?.material_of === "lumber") {
            const res = reclaim({ portions: Math.max(0, Math.round(n * (th.latent?.completeness ?? 1))), quality: th.latent?.quality, corrosion: th.latent?.corrosion, tool: ["saw", "crowbar"].includes(tool) ? 0.9 : 0.5 }, r);
            if (res.usable) got[k] = (got[k] || 0) + res.usable;
            if (res.damaged) got[`${k}:damaged`] = res.damaged;
          } else got[k] = n;
        }
        return { got };
      });
      T(this).end(th, "taken apart", this.now); take(p.inventory, sku, 1);
      for (const [k, n] of Object.entries(out.got)) {
        const [id, dmg] = k.split(":");
        give(p.inventory, id, n);
        if (dmg) for (let i = 0; i < n; i += 1) T(this).make(id, { owner: p.account, at: { kind: "held", holder: p.account }, t: this.now, condition: { integrity: 0.5, wetness: 0, cleanliness: 0.7 } });
      }
      return { ...out, tool };
    },
    open(p, sku, { thing = null } = {}) {
      const th = this.unitOf(p, sku, thing);
      if (!th.box) fail("it does not open");
      if (th.job) fail("that is someone's order: hand it over sealed");
      if (th.owner !== p.account) fail("it is not yours to open");
      th.box.seal = th.box.seal === "intact" ? "broken" : th.box.seal; th.opened = true; th.v += 1;
      return { thing: th.id, inside: th.box.contents.map((c) => T(this).all.get(c)?.sku).filter(Boolean) };
    },
    pack(p, sku, { what, what_thing = null, thing = null } = {}) {
      const box = this.unitOf(p, sku, thing);
      if (!box.box) fail("it holds nothing");
      if (box.job) fail("that is someone's order");
      if (!what || !(p.inventory[what] > 0) || (what === sku && p.inventory[what] < 2 && !what_thing)) fail("put what in it?");
      const inner = what_thing ? T(this).all.get(what_thing) : (T(this).heldBy(p.account, what).find((r) => r.id !== box.id && !r.job) || T(this).make(what, { owner: p.account, at: { kind: "held", holder: p.account }, t: this.now }));
      if (!inner || inner.id === box.id) fail("put what in it?");
      if (inner.job) fail("that is someone's order");
      guard(() => T(this).move(inner, { kind: "in", parent: box.id }, { t: this.now, why: "packed" }));
      take(p.inventory, what, 1);
      if (p.hands === what && !p.inventory[what]) p.hands = null;
      return { box: box.id, inside: box.box.contents.length, kg: T(this).massOf(box) };
    },
    unpack(p, sku, { thing = null } = {}) {
      const box = this.unitOf(p, sku, thing);
      if (!box.box?.contents?.length) fail("it is empty");
      if (box.job) fail("that is someone's order");
      if (box.box.seal === "intact") fail("it is sealed: open it first");
      const out = [];
      for (const c of box.box.contents.slice()) {
        const th = T(this).all.get(c);
        if (!th) continue;
        guard(() => T(this).move(th, { kind: "held", holder: p.account }, { t: this.now, why: "unpacked" }));
        if (th.spilled) { T(this).end(th, "spilled", this.now); continue; }
        give(p.inventory, th.sku, 1); out.push(th.sku);
      }
      return { out };
    },
    seal(p, sku, { thing = null } = {}) {
      const box = this.unitOf(p, sku, thing);
      if (!this.R.items[sku]?.container?.seals) fail("it does not seal");
      if (!box.box.contents.length) fail("seal it once something is in it");
      box.box.seal = "intact"; box.v += 1;
      return { box: box.id, sealed: true };
    },
    test(p, sku) {
      const tester = U(this).inspect.testers[sku];
      if (tester && !(p.inventory[tester] > 0)) fail(`testing it needs a ${name(this, tester)}`);
      const th = this.unitOf(p, sku);
      th.tested = true; th.v += 1;
      return { device: deviceState(th.latent, true) };
    },
    phone(p, sku) {
      const th = this.unitOf(p, sku);
      if ((th.charge ?? 1) <= 0) fail("the phone is flat: charge it");
      return { messages: true };
    },
    inspect(p, sku, args) { return this.cmd_inspect(p.id, { item: sku, thing: args.thing }); },
    consume(p, sku) { return this.cmd_use(p.id, { item: sku }); },
    wear(p, sku) { return this.cmd_use(p.id, { item: sku }); },
  };

  //: Taking a wheel off a car of yours (lab plan 5: an authorised removal): by the car's state and
  //: rust, your skill and the tool, drawn once for each attempt; nothing comes of a car with none left.
  W.cmd_remove_part = function (pid, { vehicle, part = "wheel" }) {
    const p = this.player(pid), a = ownCarNear(this, p, vehicle), Wh = this.R.commerce.outcomes.wheel;
    if (part !== "wheel") fail("only a wheel comes off that way");
    const tool = Object.keys(Wh.tools).find((t) => p.inventory[t] > 0);
    if (!tool) fail("taking a wheel off needs a wrench");
    a.attrs.wheel_tries = (a.attrs.wheel_tries || 0) + 1;
    const ev = `wheel:${a.id}:${a.attrs.wheel_tries}`;
    const wheels = a.attrs.wheels ?? 4;
    const res = O(this).once(ev, () => {
      const r = eventRng(this.seed, a.id, a.attrs.wheel_tries, ev);
      const corrosion = rng(this.seed, "latent", a.id)() * 0.35;
      return wheelRemoval({ wheelsLeft: wheels, condition: (a.attrs.condition ?? 100) / 100, skill: this.skillOf(pid, "mechanic"), tool: Wh.tools[tool], corrosion }, r(), r());
    });
    p.vitals = { ...p.vitals, stamina: Math.max(0, p.vitals.stamina - 3) };
    if (res.result === "usable" || res.result === "damaged") {
      a.attrs.wheels = wheels - 1;
      give(p.inventory, "car_tire", 1);
      T(this).make("car_tire", { owner: p.account, at: { kind: "held", holder: p.account }, t: this.now,
        condition: { integrity: res.result === "usable" ? Math.max(0.5, (a.attrs.condition ?? 100) / 100) : 0.3, wetness: 0, cleanliness: 0.6 }, extra: { from: a.id } });
    }
    learn(this, pid, "mechanic", this.R.commerce.outcomes.skill_per_job / 2);
    return { ...res, wheels: a.attrs.wheels ?? 4, tool, minutes: Wh.minutes };
  };

  // ---- selling it again -----------------------------------------------------------------------------
  const dayKey = (w) => w.time.day;
  //: The channels a place offers for a thing of group ``group``.
  W.channelsAt = function (place, group) {
    const C = S(this).channels, kinds = storesAt(this.R, place?.keys || []).map((s) => s.kind), out = [];
    if (kinds.some((k) => C.pawn.at.includes(k))) out.push("pawn");
    if (kinds.some((k) => (C.specialist.by_group[group] || []).includes(k))) out.push("specialist");
    if (kinds.some((k) => C.consignment.at.includes(k))) out.push("consignment");
    if (kinds.some((k) => C.recycler.at.includes(k))) out.push("recycler");
    return out;
  };
  W.cmd_sell_quote = function (pid, { item, thing = null, channel, place = null }) {
    const p = this.player(pid), th = this.unitOf(p, item, thing), Rr = S(this);
    const ok = eligibility(this.R, th, p.account, channel);
    if (!ok.ok) fail(ok.reason);
    if (["pawn", "specialist", "recycler", "consignment"].includes(channel)) {
      if (!place?.id || !near(p, place.x, place.z, Rr.reach_m * 3)) fail("at the shop: walk up to it");
      if (!this.channelsAt(place, ok.group).includes(channel)) fail(`${Rr.channels[channel].name.toLowerCase()} is not done here`);
    }
    const hour = Math.floor(this.now / HOUR), k = K(this);
    const qid = `quote:${th.id}:${channel}:${place?.id || "-"}:${Math.floor(hour / (Rr.channels[channel].quote_hours || 2))}`;
    const old = k.quotes.get(qid);
    if (old && old.expires > this.now && old.v === th.v) return { quote: old };
    const qk = `${pid}:${dayKey(this)}`;
    k.quoted[qk] = (k.quoted[qk] || 0) + 1;
    if (k.quoted[qk] > Rr.quotes_per_day * 4) fail("enough asking for today: the buyers will not quote again until tomorrow");
    const buyer = `${place?.id || channel}:${dayKey(this)}`;
    const cash = Rr.channels[channel].cash_kcr ? this.R.money(Rr.channels[channel].cash_kcr) - (k.cash[buyer] || 0) : undefined;
    const offer = offerFor(this.R, th, channel, { bought: k.bought[`${buyer}:${th.sku}`] || 0, budget: cash, hour, seed: this.seed });
    if (channel === "specialist" && th.latent?.fault === "hidden") th.tested = true;
    const quote = { id: qid, pid, thing: th.id, sku: th.sku, v: th.v, channel, place: place ? { id: place.id, name: place.name || null, x: place.x, z: place.z } : null,
      amount: offer.amount, why: offer.why, expires: this.now + (offer.expires_h || 2) * HOUR };
    if (channel === "consignment") { quote.ask = Math.round(offer.amount); quote.commission = Rr.channels.consignment.commission; quote.days = Rr.channels.consignment.days; }
    k.quotes.set(qid, quote);
    if (k.quotes.size > 400) k.quotes.delete(k.quotes.keys().next().value);
    return { quote };
  };
  //: Taking a buyer's quote at a counter (second-hand, specialist, recycler): paid at once.
  W.cmd_sell = function (pid, { quote: qid }) {
    const p = this.player(pid), k = K(this), q = k.quotes.get(qid);
    if (!q || q.pid !== pid) fail("no such offer");
    if (q.expires < this.now) fail("that offer has run out: ask again");
    if (!["pawn", "specialist", "recycler"].includes(q.channel)) fail("that is not sold over the counter");
    const B = T(this), th = B.all.get(q.thing);
    if (!th || th.v !== q.v) fail("it has changed since the offer: ask again");
    const ok = eligibility(this.R, th, p.account, q.channel);
    if (!ok.ok) fail(ok.reason);
    if (q.place && !near(p, q.place.x, q.place.z, S(this).reach_m * 3)) fail("at the shop: walk back to it");
    const buyer = `${q.place?.id || q.channel}:${dayKey(this)}`;
    const shop = this.ledger.open(`business:${q.place?.id || q.channel}`, "business");
    // The shop buys with what it took today (its till), and the rest of its day's cash from its own trade.
    const till = this.ledger.balance(shop), fromTill = Math.min(till, q.amount), fresh = q.amount - fromTill;
    if (fresh > 0) this.ledger.mint(shop, fresh, "external_trade", { at: this.now, memo: "second-hand purchases", key: `buy:${qid}:${th.v}` });
    if (q.amount > 0) this.ledger.transfer(shop, p.account, q.amount, { kind: "resale", memo: `Sold: ${this.R.items[th.sku].name} (${S(this).channels[q.channel].name})`, at: this.now, key: `sold:${qid}:${th.v}` });
    k.cash[buyer] = (k.cash[buyer] || 0) + q.amount;
    k.bought[`${buyer}:${th.sku}`] = (k.bought[`${buyer}:${th.sku}`] || 0) + 1;
    guard(() => B.move(th, q.channel === "recycler" ? { kind: "shelf", place: "recycling" } : { kind: "shelf", place: q.place?.id || q.channel }, { t: this.now, why: `sold (${q.channel})` }));
    th.owner = shop;
    if (q.channel === "recycler") B.end(th, "recycled", this.now);
    take(p.inventory, th.sku, 1);
    if (p.hands === th.sku && !p.inventory[th.sku]) p.hands = null;
    k.quotes.delete(qid);
    this.log("resold", { player: pid, sku: th.sku, channel: q.channel, amount: q.amount });
    return { amount: q.amount, channel: q.channel, balance: this.ledger.balance(p.account) };
  };
  //: A listing: on the board (a local buyer comes for it, no fees) or shipped (a buyer further off
  //: pays the carrier and the tax; 8% commission). The thing is promised while it is listed.
  W.cmd_list_item = function (pid, { item, thing = null, channel = "listing", price }) {
    const p = this.player(pid), th = this.unitOf(p, item, thing), Rr = S(this);
    if (!["listing", "shipped"].includes(channel)) fail("list it on the board, or shipped");
    const ok = eligibility(this.R, th, p.account, channel);
    if (!ok.ok) fail(ok.reason);
    const ask = Math.round(Number(price));
    const it = this.R.items[th.sku];
    if (!(ask >= this.R.money(1)) || ask > Math.max(this.R.money(5), it.price * 5)) fail(`ask between ${this.R.fmt(this.R.money(1))} and ${this.R.fmt(Math.max(this.R.money(5), it.price * 5))}`);
    if (channel === "shipped" && (it.length_m > Rr.channels.shipped.max_side_m || it.kg > Rr.channels.shipped.max_kg)) fail("too big to ship: list it on the board for collection");
    if (this.listingsOf(pid).length >= 8) fail("eight listings at a time");
    const k = K(this), id = `listing:${(++k.seq).toString(36)}`;
    const fair = offerFor(this.R, th, "listing", { seed: this.seed, hour: 0 }).amount;
    th.reserved = id; th.v += 1;
    k.listings.set(id, { id, pid, thing: th.id, sku: th.sku, channel, price: ask, fair, listed: this.now, until: this.now + Rr.channels[channel].days * DAY, status: "listed", lastRoll: this.now });
    return { listing: k.listings.get(id) };
  };
  W.cmd_unlist = function (pid, { listing }) {
    const k = K(this), l = k.listings.get(listing);
    if (!l || l.pid !== pid || l.status === "done") fail("no such listing");
    const th = T(this).all.get(l.thing);
    if (th) { th.reserved = null; th.v += 1; }
    if (l.escrow) { const left = this.ledger.balance(l.escrow); if (left > 0) this.ledger.burn(l.escrow, left, "external_supplier", { at: this.now, memo: "listing withdrawn: the buyer refunded", key: `unlist:${l.id}` }); }
    l.status = "done"; l.ended = "withdrawn";
    return {};
  };
  const marketThread = (w, pid) => w.openThread?.(`npc:market:${pid}`, () => ({ tab: "npc", kind: "market", name: "Buyers", members: [pid] }));
  W.cmd_accept_buyer = function (pid, { listing }) {
    const p = this.player(pid), k = K(this), l = k.listings.get(listing), B = T(this);
    if (!l || l.pid !== pid || l.status !== "buyer") fail("no buyer waiting");
    const th = B.all.get(l.thing);
    if (!th || th.at.kind !== "held" || th.at.holder !== p.account) fail("you are not carrying it any more");
    if (l.channel === "listing") {
      this.ledger.mint(p.account, l.price, "external_trade", { at: this.now, memo: `Sold on the board: ${this.R.items[l.sku].name}`, key: `board:${l.id}` });
      th.owner = `npc:${l.buyer.id}`; th.reserved = null; B.end(th, "sold", this.now); take(p.inventory, l.sku, 1);
      l.status = "done"; l.ended = "sold";
      this.log("resold", { player: pid, sku: l.sku, channel: "listing", amount: l.price });
      return { sold: true, amount: l.price };
    }
    // Shipped: the buyer pays now into escrow; you pack it in a box or envelope, seal it, and hand it
    // to the carrier (Print and ship) to be paid.
    const km = l.buyer.km, it = this.R.items[l.sku];
    const ship = shippingQuote(this.R, { kg: (it.kg || 0) + 0.3, dims_m: [it.length_m, it.length_m * 0.7, it.length_m * 0.4], km });
    if (ship === null) fail("too big to ship");
    const rate = salesRate(this.R, this.where(p).chain, this.laws);
    l.receipt = shippedReceipt(this.R, { price: l.price, taxRate: rate, ship });
    l.escrow = this.ledger.open(`escrow:${l.id}`, "escrow");
    this.ledger.mint(l.escrow, l.receipt.total, "external_trade", { at: this.now, memo: `buyer's payment held: ${it.name}`, key: `escrow:${l.id}` });
    l.status = "to_ship"; l.ship_by = this.now + 2 * DAY;
    return { to_ship: true, receipt: l.receipt };
  };
  W.cmd_decline_buyer = function (pid, { listing }) {
    const l = K(this).listings.get(listing);
    if (!l || l.pid !== pid || l.status !== "buyer") fail("no buyer waiting");
    l.status = "listed"; l.buyer = null; l.lastRoll = this.now;
    return {};
  };
  //: Handing a shipped sale to the carrier: sealed in a box or envelope it fits. The buyer's money
  //: is paid out in its five parts, once.
  W.cmd_ship_listing = function (pid, { listing, place = null }) {
    const p = this.player(pid), k = K(this), l = k.listings.get(listing), B = T(this);
    if (!l || l.pid !== pid || l.status !== "to_ship") fail("nothing sold to ship");
    if (!place?.id || !(place.keys || []).includes("shop:print_ship") || !near(p, place.x, place.z, S(this).reach_m * 3)) fail("hand it to the carrier at a Print and ship counter");
    const th = B.all.get(l.thing);
    if (!th || th.at.kind !== "in") fail("pack it first: in a shipping box or a padded envelope, then seal it");
    const box = B.all.get(th.at.parent);
    if (!box || box.at.kind !== "held" || box.at.holder !== p.account || box.box.seal !== "intact" || !/shipping_box|padded_envelope/.test(box.sku)) fail("seal it in a shipping box or a padded envelope you carry");
    const r = l.receipt, here = this.where(p);
    const lines = [[p.account, r.seller], [this.ledger.open("business:platform", "business"), r.commission], [this.ledger.open("business:carrier", "business"), r.carrier], [this.treasury(here.city || here.county), r.tax]].filter(([, v]) => v > 0);
    this.ledger.pay(l.escrow, lines, { kind: "resale", memo: `Shipped: ${this.R.items[l.sku].name}`, at: this.now, key: `shipped:${l.id}` });
    th.owner = `npc:${l.buyer.id}`; th.reserved = null;
    B.end(box, "shipped", this.now);
    take(p.inventory, box.sku, 1);
    l.status = "done"; l.ended = "shipped";
    this.log("resold", { player: pid, sku: l.sku, channel: "shipped", amount: r.seller });
    return { receipt: r, balance: this.ledger.balance(p.account) };
  };
  //: Consignment: the thing left at the shop, priced; sold for you at its chance a day, less the
  //: shop's commission; back to collect after its days if it does not sell.
  W.cmd_consign = function (pid, { item, thing = null, place, price = null }) {
    const p = this.player(pid), th = this.unitOf(p, item, thing), C = S(this).channels.consignment;
    const ok = eligibility(this.R, th, p.account, "consignment");
    if (!ok.ok) fail(ok.reason);
    if (!place?.id || !near(p, place.x, place.z, S(this).reach_m * 3) || !this.channelsAt(place, ok.group).includes("consignment")) fail("a shop that takes consignments: walk up to it");
    const fair = offerFor(this.R, th, "consignment", { seed: this.seed, hour: 0 }).amount;
    const ask = price ? Math.round(Number(price)) : fair;
    if (!(ask > 0)) fail("at what price?");
    const k = K(this), id = `consign:${(++k.seq).toString(36)}`;
    guard(() => T(this).move(th, { kind: "consigned", place: place.id }, { t: this.now, why: "on consignment" }));
    take(p.inventory, th.sku, 1);
    if (p.hands === th.sku && !p.inventory[th.sku]) p.hands = null;
    k.consigned.set(id, { id, pid, thing: th.id, sku: th.sku, place: { id: place.id, name: place.name || null, x: place.x, z: place.z }, price: ask, fair, since: this.now, until: this.now + C.days * DAY, status: "listed", lastRoll: this.now });
    return { consignment: k.consigned.get(id) };
  };
  W.cmd_collect_consigned = function (pid, { consignment }) {
    const p = this.player(pid), c = K(this).consigned.get(consignment);
    if (!c || c.pid !== pid || c.status === "done") fail("nothing of yours there");
    if (c.status === "sold") fail("it sold: the money is in your account");
    if (!near(p, c.place.x, c.place.z, S(this).reach_m * 3)) fail(`collect it at ${c.place.name || "the shop"}`);
    const th = T(this).all.get(c.thing);
    if (th) { guard(() => T(this).move(th, { kind: "held", holder: p.account }, { t: this.now, why: "collected" })); give(p.inventory, th.sku, 1); }
    c.status = "done"; c.ended = "collected";
    return { item: c.sku };
  };
  //: The hours go by: buyers turn up for listings, consigned things sell, unshipped sales lapse.
  W.commerceStep = function () {
    const k = K(this), Rr = S(this);
    for (const l of k.listings.values()) {
      if (l.status === "done") continue;
      if (l.status === "to_ship" && this.now > l.ship_by) {
        const left = this.ledger.balance(l.escrow); if (left > 0) this.ledger.burn(l.escrow, left, "external_supplier", { at: this.now, memo: "not shipped in time: refunded", key: `lapse:${l.id}` });
        const th = T(this).all.get(l.thing); if (th) { th.reserved = null; th.v += 1; }
        l.status = "done"; l.ended = "lapsed";
        continue;
      }
      if (l.status !== "listed") continue;
      if (this.now > l.until) { const th = T(this).all.get(l.thing); if (th) { th.reserved = null; th.v += 1; } l.status = "done"; l.ended = "expired"; continue; }
      const hours = Math.floor((this.now - l.lastRoll) / HOUR);
      if (hours < 1) continue;
      const chance = l.channel === "shipped" ? Math.min(Rr.channels.shipped.max_per_hour, listingChance(this.R, l.price, l.fair) * (Rr.channels.shipped.base_per_hour / Rr.channels.listing.base_per_hour)) : listingChance(this.R, l.price, l.fair);
      const r = rng(this.seed, "buyer", l.id, Math.floor(l.lastRoll / HOUR));
      let found = false;
      for (let h = 0; h < Math.min(hours, 72) && !found; h += 1) if (r() < chance) found = true;
      l.lastRoll += hours * HOUR;
      if (!found) continue;
      const [lo, hi] = Rr.channels.shipped.km;
      l.buyer = { id: `buyer:${l.id}`, name: ["Sam", "Alex", "Jordan", "Riley", "Morgan", "Casey", "Taylor"][Math.floor(r() * 7)], km: Math.round((lo + r() * (hi - lo)) * 10) / 10 };
      l.status = "buyer";
      const t = marketThread(this, l.pid);
      if (t) this.post(t, { from: "npc", name: l.buyer.name, text: l.channel === "listing" ? `Hi -- I'd like your ${name(this, l.sku)} for ${this.R.fmt(l.price)}. I'm nearby and can collect.` : `I'll buy your ${name(this, l.sku)} for ${this.R.fmt(l.price)}, shipped ${l.buyer.km} km. I pay the postage and the tax.`,
        choices: [{ id: "yes", label: "Sell it", act: { cmd: "accept_buyer", args: { listing: l.id } }, only: l.pid }, { id: "no", label: "Not to them", act: { cmd: "decline_buyer", args: { listing: l.id } }, only: l.pid }] });
    }
    for (const c of k.consigned.values()) {
      if (c.status !== "listed") continue;
      const days = Math.floor((this.now - c.lastRoll) / DAY);
      if (days >= 1) {
        const r = rng(this.seed, "consigned", c.id, Math.floor(c.lastRoll / DAY));
        const chance = consignChance(this.R, c.price, c.fair);
        let sold = false;
        for (let d = 0; d < Math.min(days, 30) && !sold; d += 1) if (r() < chance) sold = true;
        c.lastRoll += days * DAY;
        if (sold) {
          const p = this.players.get(c.pid), C = Rr.channels.consignment;
          const shopCut = Math.round(c.price * C.commission);
          const shop = this.ledger.open(`business:${c.place.id}`, "business");
          this.ledger.mint(shop, c.price, "external_trade", { at: this.now, memo: `consignment sale ${c.id}`, key: `consign:${c.id}` });
          if (p) this.ledger.transfer(shop, p.account, c.price - shopCut, { kind: "resale", memo: `Sold on consignment: ${this.R.items[c.sku].name} (less ${Math.round(C.commission * 100)}%)`, at: this.now, key: `consign-paid:${c.id}` });
          const th = T(this).all.get(c.thing); if (th) { th.owner = shop; T(this).end(th, "sold", this.now); }
          c.status = "sold"; c.paid = c.price - shopCut;
          const t = marketThread(this, c.pid);
          if (t) this.post(t, { from: "npc", name: c.place.name || "The shop", text: `Your ${name(this, c.sku)} sold for ${this.R.fmt(c.price)}: ${this.R.fmt(c.paid)} to you after our ${Math.round(C.commission * 100)}%.` });
          continue;
        }
      }
      if (this.now > c.until && c.status === "listed") {
        c.status = "returned";
        const t = marketThread(this, c.pid);
        if (t) this.post(t, { from: "npc", name: c.place.name || "The shop", text: `Your ${name(this, c.sku)} did not sell in ${S(this).channels.consignment.days} days: collect it at ${c.place.name || "the shop"}.` });
      }
    }
    // Lights burn down while lit; phones drain.
    T(this).sweep(this.now);
  };
  const step = W.step;
  W.step = function (now) { step.call(this, now); this.commerceStep(); };

  // ---- saved with the world -----------------------------------------------------------------------
  const toJSON = W.toJSON;
  W.toJSON = function () {
    const o = toJSON.call(this), k = K(this);
    o.things = T(this).toJSON();
    o.outcomes = O(this).toJSON();
    o.commerce = { listings: [...k.listings.values()], consigned: [...k.consigned.values()], rapport: k.rapport, skills: k.skills, cash: k.cash, bought: k.bought, seq: k.seq };
    return o;
  };
  const fromJSON = CityWorld.fromJSON;
  CityWorld.fromJSON = function (R, o) {
    const w = fromJSON.call(this, R, o);
    w._things = Things.fromJSON(o.things, R, { seed: w.seed });
    w._outcomes = Outcomes.fromJSON(o.outcomes);
    const c = o.commerce || {};
    w._commerce = { listings: new Map((c.listings || []).map((l) => [l.id, l])), quotes: new Map(), rapport: c.rapport || {}, skills: c.skills || {}, cash: c.cash || {}, bought: c.bought || {}, quoted: {},
      consigned: new Map((c.consigned || []).map((x) => [x.id, x])), seq: c.seq || 0 };
    return w;
  };
}
