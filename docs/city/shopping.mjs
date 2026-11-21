// Shopping in person: a basket or a cart from the door, each thing taken off the shelf it stands
// on, and paid for at a staffed lane or a self-checkout -- the shop's stock and the ownership
// moving with the goods, not with a catalogue.
//
// What is whose, and when:
//   - On the shelf a thing is the shop's. Taken off it (``shelf_take``) it is in your basket, your
//     cart or your hands -- still the shop's, and still counted off its shelf, so nobody else can
//     take that one. Put back (``shelf_return``), it is on the shelf again.
//   - Paid for (``pay_lane``), it is yours: the till takes the money and the tax through the
//     world's own checkout (world.mjs cmd_checkout: the ledger, the tax, the business's stock and
//     books), and it goes into your inventory. What will not fit in what you can carry is bagged
//     and left at the shop's door for you (an item on the ground there, yours: pick it up, or stow
//     it in your car).
//   - Walked out with unpaid (``trolley_leave``, the page calls it at the door), the basket is left
//     by the door and its goods go back on the shelves.
//
// A resident's shop faces SHELF_UNITS of each thing it sells and fills its shelves again through
// the day (RESTOCK_PER_HOUR); a player's business sells only what it has in stock, less what other
// shoppers already have in their baskets. Pure: installed on CityWorld's prototype, as enterprise.mjs is
// (tests/city_shopping.test.mjs).

import { canLift } from "./handling.mjs";

export const SHOPPING_COMMANDS = ["shop_carrier", "shelf_take", "shelf_return", "pay_lane", "trolley_leave"];

//: What you carry the shopping in: your hands (a couple of things), a basket or a cart (the
//: rules' own fixtures: rules.json fixtures.shopping_basket / shopping_cart containers).
export const HANDS = { units: 2, max_kg: 8 };
export const SHELF_UNITS = 24, RESTOCK_PER_HOUR = 8, SHELF_REACH_M = 45;
//: A basket left with nobody about (the page gone, the player off the city) is cleared after this.
export const TROLLEY_STALE_MS = 2 * 3600_000;
const HOUR = 3600_000;

//: The limits of carrier ``kind`` from the rules: {units, max_kg, kg (its own weight)}.
export function carrierSpec(R, kind) {
  if (!kind || kind === "hands") return { units: HANDS.units, max_kg: HANDS.max_kg, kg: 0 };
  const f = R.fixtures?.[kind === "cart" ? "shopping_cart" : "shopping_basket"];
  if (!f?.container) return null;
  return { units: f.container.slots, max_kg: f.container.max_kg, kg: f.kg || 0 };
}
//: What is in a trolley: {units, kg}.
export function trolleyLoad(R, lines = {}) {
  let units = 0, kg = 0;
  for (const [id, n] of Object.entries(lines)) { units += n; kg += (R.items[id]?.kg || 0) * n; }
  return { units, kg: Math.round(kg * 100) / 100 };
}
//: Whether ``n`` more of ``item`` go in ``carrier`` already holding ``lines``: null, or why not.
export function roomFor(R, carrier, lines, item, n = 1) {
  const spec = carrierSpec(R, carrier), load = trolleyLoad(R, lines), kg = (R.items[item]?.kg || 0) * n;
  if (!spec) return "no such basket";
  if (load.units + n > spec.units) return carrier === "hands" ? "your hands are full: take a basket or a cart from the door" : `the ${carrier} is full (${spec.units} things)`;
  if (load.kg + kg > spec.max_kg + 1e-9) return carrier === "hands" ? "too much to hold in your hands: take a basket or a cart" : `too heavy for the ${carrier} (${spec.max_kg} kg)`;
  return null;
}
//: A trolley's lines for the world's checkout: at most 20 of a thing a line (cmd_checkout's).
export function checkoutLines(lines = {}) {
  const out = [];
  for (const [item, n0] of Object.entries(lines)) for (let n = n0; n > 0; n -= 20) out.push({ item, qty: Math.min(20, n) });
  return out;
}

export function installShopping(CityWorld, CityError) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };

  //: A shop's shelves: {taken: {sku: n} (off the shelf: in baskets, or sold and not yet filled
  //: again), held: {sku: n} (in baskets, unpaid), t (last filled)}.
  W.shelfRecord = function (place, make = true) {
    const id = String(place?.id ?? "");
    if (!id) return null;
    this.shelves ||= new Map();
    let s = this.shelves.get(id);
    if (!s && make) { s = { taken: {}, held: {}, t: this.now }; this.shelves.set(id, s); if (this.shelves.size > 600) this.shelves.delete(this.shelves.keys().next().value); }
    if (s) restock.call(this, s);
    return s || null;
  };
  // The shelves filled again for the time since they last were: never below what is in baskets.
  function restock(s) {
    const hours = (this.now - s.t) / HOUR;
    if (hours <= 0) return;
    const back = Math.floor(hours * RESTOCK_PER_HOUR);
    if (back < 1) return;
    for (const [sku, n] of Object.entries(s.taken)) {
      const left = Math.max(s.held[sku] || 0, n - back);
      if (left > 0) s.taken[sku] = left; else delete s.taken[sku];
    }
    s.t = this.now;
  }
  //: How many of ``item`` stand on ``place``'s shelves for someone to take now.
  W.onShelf = function (place, item) {
    const s = this.shelfRecord(place, false), b = this.bizAt?.(place?.id);
    if (b) return Math.max(0, (b.stock?.[item] || 0) - (s?.held[item] || 0));
    return Math.max(0, SHELF_UNITS - (s?.taken[item] || 0));
  };
  //: What the page needs to draw a shop's shelves as they are: {taken: {sku: n}}, for a player's
  //: business what it has run out of as taken too.
  W.shelfState = function (place) {
    const s = this.shelfRecord(place, false), b = this.bizAt?.(place?.id), taken = { ...(s?.taken || {}) };
    if (b) for (const st of this.storesHere(place)) for (const id of st.items) taken[id] = Math.max(0, SHELF_UNITS - this.onShelf(place, id));
    return { taken };
  };
  const sellsHere = function (place, item) {
    const spec = this.R.items[item];
    if (!spec || spec.service || spec.parcel) return false;
    return this.storesHere(place).some((st) => st.items.includes(item));
  };
  const near = function (p, place) {
    if (place?.x === undefined || p.x === undefined) return true;
    return Math.hypot(p.x - place.x, p.z - place.z) <= SHELF_REACH_M;
  };
  //: Your trolley, here: the one you have at ``place``, a fresh one (your hands) if you have none,
  //: and anything left in one at another shop (or left too long) put back first.
  const trolleyAt = function (p, place) {
    const t = p.trolley;
    if (t && (String(t.place) !== String(place.id) || this.now - t.at > TROLLEY_STALE_MS)) putBack.call(this, p);
    p.trolley ||= { place: String(place.id), carrier: "hands", lines: {}, at: this.now };
    return p.trolley;
  };
  // Everything unpaid in ``p``'s trolley back on its shop's shelves.
  function putBack(p) {
    const t = p.trolley;
    if (!t) return 0;
    const s = this.shelfRecord({ id: t.place }, false);
    let n = 0;
    for (const [sku, k] of Object.entries(t.lines)) {
      n += k;
      if (!s) continue;
      s.held[sku] = Math.max(0, (s.held[sku] || 0) - k); if (!s.held[sku]) delete s.held[sku];
      if (!this.bizAt?.(t.place)) { s.taken[sku] = Math.max(0, (s.taken[sku] || 0) - k); if (!s.taken[sku]) delete s.taken[sku]; }
    }
    p.trolley = null;
    return n;
  }

  //: Taking a basket or a cart at the door (``carrier``: basket | cart), or putting it back
  //: (hands): what is in it goes with it into the new one, if it fits.
  W.cmd_shop_carrier = function (pid, { place, carrier = "basket" } = {}) {
    const p = this.player(pid);
    if (!place?.id || !this.storesHere(place).length) fail("this is not a shop");
    if (!near(p, place)) fail("walk into the shop first");
    if (!["hands", "basket", "cart"].includes(carrier)) fail("a basket or a cart");
    const t = trolleyAt.call(this, p, place), spec = carrierSpec(this.R, carrier), load = trolleyLoad(this.R, t.lines);
    if (!spec) fail("this shop has no baskets");
    if (load.units > spec.units || load.kg > spec.max_kg) fail(`what you have will not go in ${carrier === "hands" ? "your hands" : `a ${carrier}`}`);
    t.carrier = carrier; t.at = this.now;
    return { trolley: t };
  };
  //: One thing off the shelf into your basket (``qty``, a few at once).
  W.cmd_shelf_take = function (pid, { place, item, qty = 1 } = {}) {
    const p = this.player(pid);
    qty = Math.max(1, Math.min(10, qty | 0));
    if (!place?.id) fail("which shop?");
    if (!near(p, place)) fail("walk into the shop first");
    const spec = this.R.items[item];
    if (!spec || !sellsHere.call(this, place, item)) fail(`${spec ? spec.name.toLowerCase() : "that"} is not sold here`);
    const lift = canLift(this.R, item, p.vitals.strength);
    if (!lift.ok) fail(lift.reason);
    const left = this.onShelf(place, item);
    if (left < qty) fail(left ? `only ${left} left on the shelf` : `the shelf is empty: no ${spec.name.toLowerCase()} till it is filled again`);
    const t = trolleyAt.call(this, p, place), why = roomFor(this.R, t.carrier, t.lines, item, qty);
    if (why) fail(why);
    const s = this.shelfRecord(place);
    s.held[item] = (s.held[item] || 0) + qty;
    if (!this.bizAt?.(place.id)) s.taken[item] = (s.taken[item] || 0) + qty;
    t.lines[item] = (t.lines[item] || 0) + qty; t.at = this.now;
    return { trolley: t, left: left - qty, load: trolleyLoad(this.R, t.lines) };
  };
  //: Putting something back on its shelf (``qty``, or "all" of it).
  W.cmd_shelf_return = function (pid, { place, item, qty = 1 } = {}) {
    const p = this.player(pid), t = p.trolley;
    if (!t || String(t.place) !== String(place?.id) || !(t.lines[item] > 0)) fail("you have none of that from here");
    const n = qty === "all" ? t.lines[item] : Math.max(1, Math.min(t.lines[item], qty | 0));
    const s = this.shelfRecord(place);
    s.held[item] = Math.max(0, (s.held[item] || 0) - n); if (!s.held[item]) delete s.held[item];
    if (!this.bizAt?.(place.id)) { s.taken[item] = Math.max(0, (s.taken[item] || 0) - n); if (!s.taken[item]) delete s.taken[item]; }
    t.lines[item] -= n; if (!t.lines[item]) delete t.lines[item];
    t.at = this.now;
    return { trolley: t, returned: n };
  };
  //: Paying for what is in your trolley at a till: ``lane`` "staffed" (a cashier rings it up) or
  //: "self" (you scan it yourself; anything that needs ID checked wants a staffed lane). What you
  //: cannot carry is bagged at the door.
  W.cmd_pay_lane = function (pid, { place, lane = "staffed" } = {}) {
    const p = this.player(pid), t = p.trolley;
    if (!t || String(t.place) !== String(place?.id) || !Object.keys(t.lines).length) fail("nothing to pay for: take what you want off the shelves first");
    if (lane === "self") for (const id of Object.keys(t.lines)) if (this.R.items[id]?.needs) fail(`${this.R.items[id].name} needs a cashier to check your ID: pay at a staffed lane`);
    const s = this.shelfRecord(place), lines = { ...t.lines };
    // The world's checkout counts stock against what is on hand: what is in this trolley is
    // released first (and taken back if the payment fails).
    for (const [sku, n] of Object.entries(lines)) { s.held[sku] = Math.max(0, (s.held[sku] || 0) - n); if (!s.held[sku]) delete s.held[sku]; }
    let r;
    try { r = this.cmd_checkout(pid, { place, cart: checkoutLines(lines), overflow: "bag" }); }
    catch (error) { for (const [sku, n] of Object.entries(lines)) s.held[sku] = (s.held[sku] || 0) + n; throw error; }
    t.lines = {}; t.at = this.now;
    this.log("pay_lane", { player: pid, place: String(place.id), lane, units: Object.values(lines).reduce((a, b) => a + b, 0) });
    return { ...r, lane, trolley: t };
  };
  //: Walking out of the shop: what is unpaid goes back on the shelves and the basket by the door.
  W.cmd_trolley_leave = function (pid, { place = null } = {}) {
    const p = this.player(pid);
    if (place && p.trolley && String(p.trolley.place) !== String(place.id)) return { returned: 0 };
    return { returned: putBack.call(this, p) };
  };

  // Kept with the world.
  const toJSON = W.toJSON;
  W.toJSON = function () { const o = toJSON.call(this); if (this.shelves?.size) o.shelves = [...this.shelves]; return o; };
  const fromJSON = CityWorld.fromJSON;
  CityWorld.fromJSON = function (R, o) { const w = fromJSON.call(this, R, o); w.shelves = new Map(o.shelves || []); return w; };
}
