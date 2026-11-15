// Selling what you own: which things may be sold, to whom, for what, and what it costs (the
// object lab's plan, section 6). Pure (tests/city_resale.test.mjs); the commands that move the
// money and the thing are commerce.mjs's.
//
// Eligibility is the thing's, not just its kind's: whose it is, who holds it, its condition, its
// seal, whether it is someone's delivery or on consignment already. Each channel trades money for
// time and trouble: a second-hand counter pays at once and least; a specialist (a hardware store
// for tools, an auto-parts counter for car parts, a jeweller) pays more for what it knows; a shop
// on consignment sells it for you, slower, for a commission; a listing on the board waits for a
// buyer near you; a shipped listing reaches further, for a commission and the carrier; a recycler
// pays by the kilo for material. An offer is a buyer's, backed by what it can spend and what it has
// bought today -- not the shop price less a fixed share -- quoted with an expiry, the same quote
// however often you ask until it expires (seeded by the thing, the channel and the hour).
//
// Money is in minor units throughout; the rules' amounts here are whole currency units (``*_kcr``),
// turned to minor units by ``R.money``. Commission is the platform's fee, not a tax; sales tax is
// the jurisdiction's, collected from the buyer on top, and charged on the item only (the carrier's
// pass-through charge is not taxed under the game's policy -- recorded on every receipt).

import { rng } from "./people.mjs";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const C = (R) => R.commerce.resale;

//: The resale group of item ``sku`` (rules commerce.resale.groups, first match), or "none".
export function resaleGroup(R, sku) {
  const it = R.items[sku];
  if (!it) return "none";
  for (const [id, g] of Object.entries(C(R).groups)) {
    const m = g.match || {};
    if (m.skus?.includes(sku)) return id;
  }
  for (const [id, g] of Object.entries(C(R).groups)) {
    const m = g.match || {};
    if (m.kinds?.includes(it.kind) || m.materials?.includes(it.material_of) || (m.tools && it.tool) || (m.wear && it.wear) || (m.service && it.service)) return id;
  }
  return "none";
}

//: The share of a new one's price a thing in condition ``integrity`` (0-1) is worth (rules
//: commerce.resale.condition_curve: [[integrity, share], ...] from the top down).
export function conditionShare(R, integrity) {
  const curve = C(R).condition_curve;
  if (integrity >= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i += 1) {
    const [a, sa] = curve[i - 1], [b, sb] = curve[i];
    if (integrity >= b) return sb + (sa - sb) * ((integrity - b) / Math.max(1e-9, a - b));
  }
  return curve[curve.length - 1][1];
}

//: Whether ``thing`` (a things.mjs record) may be sold by ``account`` through ``channel``:
//: { ok, reason }. ``custody``: the registry's word for it when it is a registered asset.
export function eligibility(R, thing, account, channel, { custody = "owner" } = {}) {
  const it = R.items[thing.sku] || {};
  const group = resaleGroup(R, thing.sku), g = C(R).groups[group];
  if (!g || !g.channels?.length) return { ok: false, reason: `${it.name || thing.sku} is not sold second-hand${g?.note ? `: ${g.note}` : ""}` };
  if (thing.owner !== account) return { ok: false, reason: thing.job ? "it is someone's delivery: hand it over" : "it is not yours to sell" };
  if (thing.at.kind !== "held" || thing.at.holder !== account) return { ok: false, reason: thing.at.kind === "consigned" ? "it is on consignment already" : "carry it to sell it" };
  if (custody !== "owner") return { ok: false, reason: `it is ${custody}: it must be back with its owner first` };
  if (thing.reserved) return { ok: false, reason: "it is promised to a buyer already" };
  if (thing.box?.contents?.length && channel !== "recycler") return { ok: false, reason: "empty it first" };
  if (!g.channels.includes(channel)) return { ok: false, reason: `${(C(R).channels[channel]?.name || channel).toLowerCase()} does not take ${it.name?.toLowerCase() || thing.sku}` };
  if (g.sealed_only && (thing.opened || (thing.condition?.integrity ?? 1) < 0.95)) return { ok: false, reason: "only sealed, unopened groceries are bought back" };
  if (channel !== "recycler" && (thing.condition?.integrity ?? 1) <= 0.05) return { ok: false, reason: "it is broken: a recycler takes it by weight" };
  if (g.inspect_only && channel !== "specialist" && channel !== "recycler") return { ok: false, reason: g.note || "it needs a specialist's inspection" };
  return { ok: true, group };
}

//: A buyer's offer for ``thing`` through ``channel`` (minor units), with why. ``ctx``: { bought
//: (how many like it the buyer took today), budget (minor units it has left today), hour (the
//: hour number: the quote holds for its hours), seed }.
export function offerFor(R, thing, channel, ctx = {}) {
  const S = C(R), ch = S.channels[channel], it = R.items[thing.sku] || {};
  const why = [];
  if (channel === "recycler") {
    const kg = it.kg || 0, rate = ch.per_kg_kcr[it.material_of] ?? 0;
    const dirty = thing.latent?.contamination || 0;
    const gross = R.money(rate * kg * (1 - dirty));
    const amount = Math.max(0, gross - R.money(ch.handling_kcr * Math.min(1, kg / 10)));
    why.push(`${kg} kg of ${it.material_of || "material"} at ${R.fmt(R.money(rate))}/kg`, dirty > 0.05 ? "less for dirt" : "clean");
    return { amount: Math.min(amount, ctx.budget ?? amount), why, expires_h: ch.quote_hours, channel };
  }
  const integrity = thing.condition?.integrity ?? 1;
  let value = it.price * conditionShare(R, integrity);
  why.push(`${Math.round(conditionShare(R, integrity) * 100)}% of new for its condition`);
  // What a buyer must spend to make it right comes off (a missing part, a hidden fault found).
  const missing = 1 - (thing.latent?.completeness ?? 1);
  if (missing > 0.05) { value *= 1 - missing; why.push("parts missing"); }
  if (thing.latent?.fault && thing.tested) { value *= 0.35; why.push("a fault found on testing"); }
  else if (thing.latent?.fault === "hidden" && channel === "specialist") { value *= 0.4; why.push("the specialist's test finds a fault"); }
  // The buyer's own: its share, less the more it has bought of this kind today.
  const share = ch.share ?? 1;
  const glut = Math.pow(ch.glut ?? 0.8, ctx.bought || 0);
  if ((ctx.bought || 0) > 0) why.push(`it has bought ${ctx.bought} like it today`);
  // A little of the buyer's own mind, the same for this thing all this hour.
  const r = rng(ctx.seed || "city", "offer", thing.id, channel, ctx.hour || 0);
  const mood = 1 + ((r() - 0.5) * (ch.spread ?? 0.12));
  let amount = Math.round(value * share * glut * mood);
  if (ctx.budget !== undefined && amount > ctx.budget) { amount = Math.max(0, ctx.budget); why.push("all the cash it has left today"); }
  return { amount, why, expires_h: ch.quote_hours ?? 2, channel };
}

//: The carrier's quote for a package (minor units): chargeable kg = max(actual, volume x dim
//: factor); base + per kg (whole kilos, rounded up) + per km. Over the size limit: null (cargo or
//: local pickup only).
export function shippingQuote(R, { kg, dims_m = [0.3, 0.2, 0.1], km }) {
  const ch = C(R).channels.shipped;
  if (Math.max(...dims_m) > ch.max_side_m || kg > ch.max_kg) return null;
  const vol = dims_m[0] * dims_m[1] * dims_m[2];
  const chargeable = Math.max(kg, vol * ch.dim_factor_kg_m3);
  return R.money(ch.base_kcr) + R.money(ch.per_kg_kcr) * Math.ceil(chargeable - 1e-9) + Math.round(R.money(ch.per_km_kcr) * km);
}

//: A shipped sale's receipt: the item ``price``, the jurisdiction's ``taxRate`` on the item only,
//: the platform's commission on the item only, the carrier's ``ship``. Every amount whole minor
//: units; the five lines sum to what the buyer pays (seller + commission + carrier + tax).
export function shippedReceipt(R, { price, taxRate, ship }) {
  const ch = C(R).channels.shipped;
  const tax = Math.floor(price * taxRate + 0.5 + 1e-7);
  const commission = Math.floor(price * ch.commission + 0.5 + 1e-7);
  return { item: price, seller: price - commission, commission, carrier: ship, tax, total: price + ship + tax, policy: ch.tax_policy };
}

//: A local listing's chance of a buyer turning up in an hour, by how its asking price stands to
//: what such a thing fetches (``fair``): at fair, the channel's base rate; dearer, less; cheaper,
//: more (capped).
export function listingChance(R, ask, fair) {
  const ch = C(R).channels.listing;
  if (!(fair > 0)) return 0;
  const k = ask / fair;
  return clamp(ch.base_per_hour * Math.pow(Math.max(0.2, k), -ch.price_elasticity), 0, ch.max_per_hour);
}

//: A consignment's chance of selling in a day at the shop's price ``ask`` against ``fair``.
export function consignChance(R, ask, fair) {
  const ch = C(R).channels.consignment;
  if (!(fair > 0)) return 0;
  return clamp(ch.sell_per_day * Math.pow(Math.max(0.2, ask / fair), -ch.price_elasticity), 0, 0.9);
}
