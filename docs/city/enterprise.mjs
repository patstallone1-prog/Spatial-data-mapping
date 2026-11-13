// Businesses, the law and careers (docs/37-business-legal-and-careers-plan.md): a player leases a
// storefront or buys a building, registers a business there, stocks it, prices it, sets its hours
// and hires people -- NPCs from the candidates the district offers, or another player in the party
// -- and the business runs hour by hour while the city goes on: customers by the hour of the day,
// shared with its rivals, put off by its prices and drawn by its name; staff working the duties in
// the owner's order, and quitting when they are worked too hard for too little. An NPC's shop can
// be bought, its books modelled, with the seller financing most of it.
//
// A fine opens a case. It can be paid, contested, or taken to a lawyer at one of the map's real law
// offices -- whose people are invented, never the office's real ones. A case left unpaid past its
// late penalty becomes a summons. The verdict is a weighted chance tilted by the lawyer's skill,
// the evidence and the record (section 3.4); jail is a time skip told as what happened inside.
//
// A shift is experience: tasks done, shifts on time, promotions; a recruiter finds better jobs.
//
// Pure, as world.mjs is: installed on CityWorld's prototype (installEnterprise, at the end of
// world.mjs) and tested in tests/city_enterprise.test.mjs.

import { LedgerError, cityTime, inHours, itemTax, loanPayment, storesAt, withholding } from "./core.mjs";
import { FIRST, LAST, hash32 as hash, rng } from "./people.mjs";

const DAY = 86_400_000, HOUR = 3_600_000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pickW = (r, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries.at(-1)[0];
};
//: How names are compared: case, punctuation and the words every firm has are left out.
export function nameKey(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/\b(the|inc|llc|llp|co|corp|ltd|of)\b/g, " ").replace(/[^a-z0-9]+/g, "");
}

//: The commands this adds to the world's.
export const ENTERPRISE_COMMANDS = ["lease_storefront", "end_storefront", "register_business", "fund_business", "withdraw_business",
  "order_stock", "set_prices", "set_hours", "set_duties", "hire", "accept_employment", "decline_employment", "fire", "schedule",
  "order_staff", "set_wage", "post_opening", "close_opening", "headhunt_staff", "appraise_business", "buy_business", "close_business",
  "hire_lawyer", "attend_court", "expunge", "headhunt", "take_offer", "dismiss_offer", "acknowledge_release", "lawyers", "candidates"];

// ---- the business model (pure functions of the rules) ---------------------------------------------

//: A kind's customer pattern: "food", "grocery", "retail" or "night".
export function groupOf(R, kind) { return R.business.curve_by_kind[kind] || "retail"; }
const byGroup = (table, g) => table[g] ?? table.default;
//: The roles a business of ``kind`` hires: those whose workplaces include it (a shop assistant if none).
export function rolesFor(R, kind) {
  const out = Object.entries(R.jobs.roles).filter(([, s]) => (s.at || []).includes(`shop:${kind}`)).map(([id]) => id);
  return out.length ? out : ["clerk"];
}
//: The going rate for a role at a shop (an hour, real San Francisco wages), and the least anyone is paid.
export function goingRate(R, role) { return Math.round(R.jobs.roles[role].pay * R.business.staff.wage_scale); }
export function leastWage(R) { return Math.round(R.jobs.minimum_wage * R.business.staff.wage_scale); }
//: The items a business of ``kind`` sells.
export function itemsFor(R, kind) { return (R.stores.kinds[kind]?.items || []).filter((id) => R.items[id] && !R.items[id].parcel); }
//: What one unit costs the shop from its wholesaler.
export function unitCost(R, id) {
  const it = R.items[id], share = R.business.wholesale_share[it.kind] ?? R.business.wholesale_share.default;
  return Math.max(1, Math.round(it.price * share));
}
//: The licences a kind needs, each {id, name, fee}.
export function licencesFor(R, kind, area = 100) {
  const out = [];
  for (const [id, L] of Object.entries(R.business.licences)) {
    if (L.for !== "*" && !(L.for || []).includes(kind)) continue;
    let fee = L.fee_base;
    if (L.size_factor_max) fee = Math.round(fee * (1 + (L.size_factor_max - 1) * clamp((area || 100) / L.full_size_m2, 0, 1)));
    out.push({ id, name: L.name, fee });
  }
  return out;
}
//: Demand for an item at a price factor: pf^elasticity (pf 1 is the list price).
export function priceDemand(R, id, pf) {
  const e = R.business.elasticity[R.items[id]?.kind] ?? R.business.elasticity.default;
  return Math.pow(clamp(pf, 0.2, 5), e);
}

//: One hour of a business: who is on, what customers come, what labour goes where, and what sells.
//: ``b`` is the business (its stock is taken from unless ``unlimited``); ``t`` the city time at the
//: middle of the hour. Returns the hour's numbers; nothing is posted to the books here.
export function hourOf(R, b, t, { unlimited = false, first = false, last = false, extra = 0 } = {}) {
  const B = R.business, g = groupOf(R, b.kind);
  const open = b.status === "open" && isOpen(b.hours, t);
  const on = (b.staff || []).filter((s) => !s.player && onShift(s, t) && (s.home_until || 0) <= t.ms && !(s.left));
  // The late: low morale makes someone miss the first hour of their shift.
  const here = on.filter((s) => !(s.morale < B.staff.late_below && shiftHour(s, t) === 0));
  const out = { open, on: here.length, wages: {}, visits: 0, wanted: 0, served: 0, lost: 0, units: {}, sales: 0, tax: 0, cogs: 0, stockout: 0,
    clean_need: 0, clean_done: 0, understaffed: false, opened_late: false };
  for (const s of here) out.wages[s.id] = s.wage;
  let labour = extra; const ordered = {};
  for (const s of here) {
    const l = (0.6 + 0.4 * (s.skill ?? 0.5)) * (s.order?.kind === "break" && s.order.until > t.ms - HOUR / 2 ? 0.75 : 1);
    if (s.order && s.order.until > t.ms - HOUR / 2 && s.order.kind !== "break") ordered[s.order.kind] = (ordered[s.order.kind] || 0) + l;
    else labour += l;
  }
  if (!open) return out;
  // Customers: the kind's busiest hour, shaped by this hour, the name, the prices and the rivals.
  const curve = B.hour_curves[g][t.hour] ?? 0;
  const items = itemsFor(R, b.kind).filter((id) => unlimited || (b.stock?.[id] || 0) > 0);
  const pull = items.length ? items.reduce((s, id) => s + priceDemand(R, id, b.prices?.[id] ?? 1), 0) / items.length : 0;
  const q = Math.pow(clamp(b.reputation ?? B.reputation.start, 1, 100) / B.reputation.start, 0.8);
  const share = 1 / (1 + Math.max(0, b.rivals || 0) * B.rival_share);
  out.visits = (B.visits_peak[b.kind] ?? B.visits_peak.default) * curve * q * share * pull;
  out.wanted = out.visits * byGroup(B.conversion, g);
  // The duties in the owner's order; someone told to do one does it first.
  const D = B.duty_hours, basket = byGroup(B.basket, g), servePer = byGroup(B.serve_per_staff_hour, g);
  const need = { serve: out.wanted / servePer, restock: out.wanted * basket / D.restock_per_units, clean: D.clean_per_open_hour,
    deliver: 0.25, open_close: first || last ? D.open_close : 0 };
  const done = { serve: ordered.serve || 0, restock: ordered.restock || 0, clean: ordered.clean || 0, deliver: 0, open_close: 0 };
  let left = labour;
  for (const duty of b.duties || B.duties) {
    const give = Math.min(Math.max(0, need[duty] - done[duty]), left);
    done[duty] += give; left -= give;
  }
  if (first && need.open_close > 0 && done.open_close < need.open_close * 0.5) { out.opened_late = true; out.wanted *= 0.4; }
  const capacity = done.serve * servePer;
  out.served = Math.min(out.wanted, capacity);
  out.lost = out.wanted - out.served;
  out.understaffed = out.lost > 0.5;
  out.clean_need = need.clean; out.clean_done = Math.min(need.clean, done.clean);
  // What they buy: a basket each, shared among what is on the shelves by price; less where the
  // shelves were not kept filled; a little more with deliveries run.
  const shelf = need.restock > 0 ? 0.5 + 0.5 * Math.min(1, done.restock / need.restock) : 1;
  const lift = (b.duties || B.duties).includes("deliver") && done.deliver >= need.deliver ? 1 + B.deliver_lift : 1;
  const units = out.served * basket * shelf * lift;
  if (!items.length) { out.stockout = units; return out; }
  const weights = items.map((id) => [id, priceDemand(R, id, b.prices?.[id] ?? 1)]);
  const wsum = weights.reduce((s, [, w]) => s + w, 0);
  b.carry ||= {};
  for (const [id, w] of weights) {
    const want = units * w / wsum + (b.carry[id] || 0);
    let n = Math.floor(want);
    b.carry[id] = want - n;
    if (!unlimited && n > (b.stock[id] || 0)) { out.stockout += n - b.stock[id]; n = b.stock[id]; }
    if (n <= 0) continue;
    if (!unlimited) b.stock[id] -= n;
    const price = Math.round(R.items[id].price * (b.prices?.[id] ?? 1)) * n;
    out.units[id] = n; out.sales += price; out.cogs += unitCost(R, id) * n;
    out.tax += itemTax(R, b.chain || [], R.items[id], price, b.laws || {});
  }
  return out;
}
//: Whether a business keeping ``hours`` ([open, close], close past 24 for after midnight) is open at ``t``.
export function isOpen(hours, t) {
  const [o, c] = hours;
  return inHours([[o, c > 24 ? c - 24 : c]], t);
}
//: Whether staff member ``s`` is on shift at ``t`` (shifts: [{days: [0-6], from, to}], to past 24 runs on).
export function onShift(s, t) { return shiftHour(s, t) >= 0; }
function shiftHour(s, t) {
  for (const sh of s.shifts || []) {
    const h = t.hour + (t.minute % 60) / 60;
    if (sh.days.includes(t.weekday) && h >= sh.from && h < Math.min(24, sh.to)) return Math.floor(h - sh.from);
    if (sh.to > 24 && sh.days.includes((t.weekday + 6) % 7) && h < sh.to - 24) return Math.floor(h + 24 - sh.from);
  }
  return -1;
}
//: The staff an NPC shop of ``kind`` keeps (for its modelled books): one a role, two at a busy kind.
function defaultStaff(R, kind, seed) {
  const g = groupOf(R, kind), roles = rolesFor(R, kind).filter((r) => R.jobs.player_jobs.includes(r) || R.jobs.roles[r]);
  const H = [Math.max(6, hoursFor(R, kind)[0] - 1), hoursFor(R, kind)[1]];
  const split = H[1] - H[0] > 9 ? [[H[0], H[0] + Math.ceil((H[1] - H[0]) / 2)], [H[0] + Math.ceil((H[1] - H[0]) / 2), H[1]]] : [H];
  const out = [];
  const per = g === "retail" ? 1 : 2;
  for (const [i, sh] of split.entries()) for (let k = 0; k < per; k += 1) {
    const role = roles[(i + k) % roles.length], r = rng(seed, "staff", i, k);
    out.push({ id: `staff:${seed}:${i}:${k}`, name: personName(r), role, wage: goingRate(R, role), skill: 0.4 + 0.4 * r(), morale: R.business.staff.morale_start,
      shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: sh[0], to: sh[1] }] });
  }
  return out;
}
//: A kind's usual hours.
export function hoursFor(R, kind) {
  const g = groupOf(R, kind);
  return g === "night" ? [16, 26] : g === "food" ? [7, 21] : g === "grocery" ? [7, 23] : [10, 19];
}
//: A shop's typical week, modelled (an NPC's books, before buying it): sales, cost of goods,
//: wages, rent and profit, with ``noise`` (seeded) week to week.
export function modelWeek(R, place, kind, { rivals = 1, week = 0 } = {}) {
  const b = { id: place.id, kind, status: "open", hours: hoursFor(R, kind), prices: {}, stock: {}, reputation: R.business.reputation.start,
    rivals, chain: place.chain || [], staff: defaultStaff(R, kind, place.id), duties: R.business.duties };
  const start = Date.UTC(2026, 0, 5, 8);   // a Monday, Pacific midnight
  const sum = { sales: 0, cogs: 0, wages: 0, tax: 0, rent: R.business.storefront_lease_per_week, units: 0, served: 0, lost: 0 };
  for (let h = 0; h < 24 * 7; h += 1) {
    const t = cityTime(start + h * HOUR + HOUR / 2, R.clock.zone);
    const o = hourOf(R, b, t, { unlimited: true, first: t.hour === b.hours[0], last: (t.hour + 1) % 24 === b.hours[1] % 24 });
    sum.sales += o.sales; sum.cogs += o.cogs; sum.tax += o.tax; sum.served += o.served; sum.lost += o.lost;
    for (const v of Object.values(o.wages)) sum.wages += v;
    for (const n of Object.values(o.units)) sum.units += n;
  }
  const noise = 0.85 + 0.3 * rng("week", place.id, week)();
  for (const k of ["sales", "cogs", "tax", "units", "served"]) sum[k] = Math.round(sum[k] * noise);
  sum.profit = sum.sales - sum.cogs - sum.wages - sum.rent;
  return sum;
}

// ---- the law (pure) -------------------------------------------------------------------------------

//: The verdict's weights (plan section 3.4) for a lawyer of ``skill`` on a case with ``evidence``
//: (0-1) and ``priors`` (record lines): each outcome's base weight tilted toward the favourable end
//: by skill and back by the evidence and the record, then normalised. Jail only for criminal charges.
export function verdictWeights(R, { skill, evidence = 0.5, priors = 0, criminal = false }) {
  const L = R.business.law;
  const x = skill - 0.5 - 0.4 * (evidence - 0.5) - 0.15 * priors;
  const ws = L.outcomes.filter((o) => criminal || !o.criminal_only).map((o) => [o.id, o.weight * Math.exp(L.k * x * (2 * o.f - 1))]);
  const total = ws.reduce((s, [, w]) => s + w, 0);
  return Object.fromEntries(ws.map(([id, w]) => [id, w / total]));
}
//: The odds shown before hiring: "likely", "even" or "unlikely" for a good result (dismissed,
//: acquitted or reduced) -- never the numbers.
export function oddsLabel(R, weights) {
  const good = R.business.law.outcomes.filter((o) => o.f >= 0.7).reduce((s, o) => s + (weights[o.id] || 0), 0);
  const [likely, even] = R.business.law.odds;
  return good >= likely ? "likely" : good >= even ? "even" : "unlikely";
}
//: How strong the evidence on a bill is: its best witness.
export function evidenceScore(R, evidence = []) {
  const E = R.business.law.evidence;
  let best = E.none;
  for (const e of evidence || []) {
    const s = String(e).toLowerCase();
    for (const [k, v] of Object.entries(E)) if (k !== "none" && s.includes(k)) best = Math.max(best, v);
  }
  return best;
}
const personName = (r) => `${FIRST[Math.floor(r() * FIRST.length) % FIRST.length]} ${LAST[Math.floor(r() * LAST.length) % LAST.length]}`;
//: The lawyers at a law office: invented people, seeded by the place -- names from the roster's
//: lists, a firm-style surname pair, years, a skill never shown, and a record drawn honestly from
//: that skill. A name that is a real tenant's (``tenants``, name keys) is drawn again.
export function lawyersAt(R, place, tenants = new Set()) {
  const L = R.business.law, r = rng("lawyers", place.id);
  const n = L.per_office[0] + Math.floor(r() * (L.per_office[1] - L.per_office[0] + 1));
  const out = [], used = new Set();
  for (let i = 0; i < n; i += 1) {
    const role = i === 0 && n >= 4 ? "public" : pickW(r, Object.entries(L.role_weights).filter(([k]) => k !== "public"));
    let name, firm, tries = 0;
    do {
      name = personName(r);
      const l2 = LAST[Math.floor(r() * LAST.length) % LAST.length];
      firm = `${name.split(" ")[1]} & ${l2}`;
      tries += 1;
    } while (tries < 20 && (used.has(name) || tenants.has(nameKey(name)) || tenants.has(nameKey(firm)) || name.split(" ")[1] === firm.split(" & ")[1]));
    used.add(name);
    const years = 1 + Math.floor(r() * 35);
    const skill = role === "public" ? 0.3 + 0.3 * r() : clamp(0.1 + 0.65 * (r() + r() + r()) / 3 + 0.2 * years / 35, 0.05, 0.98);
    const cases = years * (6 + Math.floor(r() * 10));
    const p = 0.25 + 0.55 * skill, sd = Math.sqrt(cases * p * (1 - p));
    const gauss = (r() + r() + r() + r() - 2) * Math.sqrt(3);
    const wins = clamp(Math.round(cases * p + gauss * sd), 0, cases);
    const pleas = Math.round((cases - wins) * (0.4 + 0.2 * r()));
    const spec = L.roles[role];
    const unit = R.money(25);
    const price = spec.fee_base ? Math.max(unit, Math.round(spec.fee_base * (0.6 + 1.4 * skill) * (1 + years / 40) / unit) * unit) : 0;
    out.push({ id: `lawyer:${place.id}:${i}`, name, firm: `${firm}`, role, title: spec.title, takes: spec.takes, years, skill,
      record: { cases, wins, pleas, losses: cases - wins - pleas }, price });
  }
  return out;
}
//: The case class of a bill's kind: criminal, traffic or civil.
export const chargeClass = (R, kind) => R.business.law.charges[kind] || "civil";
//: Metres between two lon/lat points (near enough for a city).
function metres(a, b) {
  const k = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return Math.hypot((a.lon - b.lon) * 111_320 * k, (a.lat - b.lat) * 110_540);
}

// ---- installing ------------------------------------------------------------------------------------

export function installEnterprise(CityWorld, CityError) {
  const W = CityWorld.prototype;
  const fail = (m) => { throw new CityError(m); };
  const BR = (w) => w.R.business;

  W.enterpriseInit = function () {
    this.biz = new Map(); this.cases = new Map(); this.openings = new Map(); this.storefronts = new Map();
    this.tenantNames = new Set();   // the map's real tenants (name keys): told by the view, not saved
  };
  //: The view tells the world the real tenants' names it has seen, so a business or a lawyer is
  //: never given one.
  W.knowTenants = function (names) { for (const n of names || []) { const k = nameKey(n); if (k.length > 2) this.tenantNames.add(k); } };
  W.enterpriseJSON = function () {
    return { biz: [...this.biz.values()], cases: [...this.cases.values()], openings: [...this.openings.values()], storefronts: [...this.storefronts.values()] };
  };
  W.enterpriseLoad = function (o = {}) {
    this.enterpriseInit();
    for (const b of o.biz || []) this.biz.set(b.id, b);
    for (const c of o.cases || []) this.cases.set(c.id, c);
    for (const x of o.openings || []) this.openings.set(x.id, x);
    for (const s of o.storefronts || []) this.storefronts.set(s.place.id, s);
  };
  //: A player business at a place, if one is open there.
  W.bizAt = function (placeId) { const b = this.biz.get(`biz:${placeId}`); return b && b.status === "open" ? b : null; };
  W.isFirm = function (account) { return typeof account === "string" && account.startsWith("firm:biz:"); };
  W.ownBiz = function (p, id) {
    const b = this.biz.get(id);
    if (!b || b.owner !== p.account || ["closed", "repossessed", "evicted"].includes(b.status)) fail("not a business of yours");
    return b;
  };
  W.near = function (p, place, reach) {
    if (p.x === undefined || place?.x === undefined) return true;
    return Math.hypot(p.x - place.x, p.z - place.z) <= reach;
  };
  const slimPlace = (pl) => ({ id: String(pl.id), x: pl.x, z: pl.z, name: pl.name || null, keys: [...(pl.keys || [])], lon: pl.lon, lat: pl.lat, county: pl.county || null, area: pl.area || null });

  // ---- a player's business as a shop: its wares, its prices, its till -------------------------------
  W.storesHere = function (place) {
    const b = this.bizAt(place?.id);
    if (!b) return storesAt(this.R, place?.keys || []);
    return [{ kind: b.kind, name: b.name, items: itemsFor(this.R, b.kind).filter((id) => (b.stock[id] || 0) > 0), business: b.id }];
  };
  W.priceAt = function (place, id) {
    const b = this.bizAt(place?.id), it = this.R.items[id];
    return b ? Math.round(it.price * (b.prices[id] ?? 1)) : it.price;
  };
  W.tillOf = function (place) {
    const b = this.bizAt(place?.id);
    return b ? b.account : this.ledger.open(`business:${place.id}`, "business");
  };
  W.stockCheck = function (place, lines) {
    const b = this.bizAt(place?.id);
    if (!b) return;
    for (const l of lines) if (!this.R.items[l.item].service && (b.stock[l.item] || 0) < l.qty) fail(`${b.name} has only ${b.stock[l.item] || 0} ${this.R.items[l.item].name.toLowerCase()} left`);
  };
  W.soldHere = function (place, lines) {
    const b = this.bizAt(place?.id);
    if (!b) return;
    for (const l of lines) {
      if (this.R.items[l.item].service) continue;
      b.stock[l.item] -= l.qty;
      b.today.cogs += unitCost(this.R, l.item) * l.qty;
      b.today.player_sales = (b.today.player_sales || 0) + l.price;
    }
  };

  // ---- premises ---------------------------------------------------------------------------------
  //: A vacant storefront (a place for shops with none in it), leased a week ahead with a week's deposit.
  W.cmd_lease_storefront = function (pid, { place }) {
    const p = this.player(pid), B = BR(this);
    if (!place?.id) fail("which storefront?");
    const keys = place.keys || [];
    if (keys.some((k) => k.startsWith("shop:"))) fail("that storefront is let already: buy the business instead");
    if (!keys.some((k) => ["use:retail", "use:restaurant", "use:office", "use:hotel"].includes(k))) fail("that is not a storefront");
    if (this.storefronts.has(String(place.id))) fail("that storefront is let already");
    if (!this.near(p, place, this.R.stores.reach_m * 4)) fail("walk up to it first");
    const rent = B.storefront_lease_per_week, deposit = rent * B.lease_deposit_weeks;
    this.ledger.transfer(p.account, "business:landlords", rent + deposit, { kind: "lease", memo: `storefront ${place.name || place.id}, a week ahead and a deposit`, at: this.now });
    const s = { place: slimPlace(place), holder: p.account, pid, paid_to: this.now + 7 * DAY, deposit, missed: 0, since: this.now };
    this.storefronts.set(s.place.id, s);
    this.log("storefront", { player: pid, place: s.place.id });
    return { storefront: s };
  };
  W.cmd_end_storefront = function (pid, { place }) {
    const p = this.player(pid), s = this.storefronts.get(String(place?.id ?? place));
    if (!s || s.holder !== p.account) fail("not a storefront of yours");
    if (this.bizAt(s.place.id)) fail("close the business there first");
    this.storefronts.delete(s.place.id);
    this.ledger.transfer("business:landlords", p.account, s.deposit, { kind: "deposit", memo: "storefront deposit back", at: this.now });
    return { returned: s.deposit };
  };

  // ---- registering --------------------------------------------------------------------------------
  W.cmd_register_business = function (pid, { place, kind, name, rivals = 1 }) {
    const p = this.player(pid), B = BR(this), R = this.R;
    if (!place?.id) fail("where?");
    const id = `biz:${place.id}`;
    if (this.biz.get(id) && this.biz.get(id).status === "open") fail("there is a business there already");
    const store = this.storefronts.get(String(place.id));
    const owned = this.registry.assets.get(`building:${place.id}`)?.owner === p.account;
    if (!owned && store?.holder !== p.account) fail("lease the storefront or buy the building first");
    if (!R.stores.kinds[kind] || R.stores.kinds[kind].counter) fail("not a kind of business you can open");
    const nm = String(name || "").trim().replace(/\s+/g, " ");
    if (nm.length < 2 || nm.length > B.name_max) fail(`a name of 2 to ${B.name_max} letters`);
    const key = nameKey(nm);
    if (this.tenantNames.has(key)) fail("that is a real business's name: choose your own");
    for (const o of this.biz.values()) if (o.status === "open" && nameKey(o.name) === key) fail("another business has that name");
    const here = this.where(p);
    const lic = licencesFor(R, kind, place.area);
    const fees = lic.reduce((s, l) => s + l.fee, 0);
    if (this.ledger.balance(p.account) < fees) fail(`the licences come to ${R.fmt(fees)}: ${lic.map((l) => l.name.toLowerCase()).join(", ")}`);
    this.ledger.transfer(p.account, this.treasury(here.city || here.county), fees, { kind: "licence", memo: lic.map((l) => l.name).join(", "), at: this.now });
    const account = this.ledger.open(`firm:${id}`, "business");
    const t = this.time;
    const b = { id, place: slimPlace(place), kind, name: nm, owner: p.account, owner_pid: pid, account, chain: here.chain, city: here.city || null,
      county: here.county, premises: owned ? "owned" : "lease", stock: {}, prices: {}, hours: hoursFor(R, kind), duties: [...B.duties],
      staff: [], reputation: B.reputation.start, licences: Object.fromEntries(lic.map((l) => [l.id, this.now + B.renew_days * DAY])),
      books: [], today: freshDay(t.day), sim_to: hourFloor(this.now), incoming: [], loan: null, status: "open", opened: this.now,
      rivals: Math.max(0, rivals | 0), headhunted_until: 0 };
    this.biz.set(id, b);
    if (!this.registry.assets.has(id)) this.registry.register(id, "business", p.account, { name: nm, kind, place: b.place.id }, this.now);
    else { const a = this.registry.get(id); a.owner = a.holder = p.account; a.custody = "owner"; a.attrs = { name: nm, kind, place: b.place.id }; }
    this.log("business", { player: pid, business: id, kind });
    return { business: this.bizView(b), fees };
  };
  W.cmd_fund_business = function (pid, { business, amount }) {
    const p = this.player(pid), b = this.ownBiz(p, business), a = Math.round(amount);
    if (!(a > 0)) fail("how much?");
    this.ledger.transfer(p.account, b.account, a, { kind: "owner_funds", memo: b.name, at: this.now });
    return { balance: this.ledger.balance(b.account) };
  };
  W.cmd_withdraw_business = function (pid, { business, amount }) {
    const p = this.player(pid), b = this.ownBiz(p, business), a = Math.round(amount);
    if (!(a > 0)) fail("how much?");
    this.ledger.transfer(b.account, p.account, a, { kind: "owner_draw", memo: b.name, at: this.now });
    return { balance: this.ledger.balance(b.account) };
  };

  // ---- stock, prices, hours, duties ----------------------------------------------------------------
  //: Stock from the wholesaler: paid now from the business's account, on the shelves the next morning.
  W.cmd_order_stock = function (pid, { business, items = {} }) {
    const p = this.player(pid), b = this.ownBiz(p, business), R = this.R;
    const sold = new Set(itemsFor(R, b.kind));
    const lines = Object.entries(items).map(([id, n]) => [id, Math.max(0, Math.min(500, n | 0))]).filter(([, n]) => n > 0);
    if (!lines.length) fail("order something");
    for (const [id] of lines) if (!sold.has(id)) fail(`a ${R.stores.kinds[b.kind].name.toLowerCase()} does not sell ${R.items[id]?.name.toLowerCase() || id}`);
    const cost = lines.reduce((s, [id, n]) => s + unitCost(R, id) * n, 0);
    if (this.ledger.balance(b.account) < cost) fail(`the order is ${R.fmt(cost)} and the business has ${R.fmt(this.ledger.balance(b.account))}: fund it first`);
    this.ledger.burn(b.account, cost, "external_supplier", { at: this.now, memo: `stock for ${b.name}` });
    const t = this.time, at = nextHourAt(this.now, t, BR(this).delivery_hour);
    b.incoming.push({ at, items: Object.fromEntries(lines), cost });
    b.today.ordered = (b.today.ordered || 0) + cost;
    return { cost, arrives: at };
  };
  W.cmd_set_prices = function (pid, { business, prices = {} }) {
    const p = this.player(pid), b = this.ownBiz(p, business), [lo, hi] = BR(this).price_factor;
    const sold = new Set(itemsFor(this.R, b.kind));
    for (const [id, f] of Object.entries(prices)) if (sold.has(id) && Number.isFinite(+f)) b.prices[id] = Math.round(clamp(+f, lo, hi) * 100) / 100;
    return { prices: b.prices };
  };
  W.cmd_set_hours = function (pid, { business, open, close }) {
    const p = this.player(pid), b = this.ownBiz(p, business);
    const o = Math.round(+open), c = Math.round(+close);
    if (!(o >= 0 && o < 24 && c > o && c <= o + 24)) fail("open and close as hours of the day (close past midnight as 25, 26...)");
    b.hours = [o, c];
    return { hours: b.hours };
  };
  W.cmd_set_duties = function (pid, { business, duties = [] }) {
    const p = this.player(pid), b = this.ownBiz(p, business), all = BR(this).duties;
    if (duties.length !== all.length || !all.every((d) => duties.includes(d))) fail(`the duties in order: ${all.join(", ")}`);
    b.duties = [...duties];
    return { duties: b.duties };
  };

  // ---- staff -----------------------------------------------------------------------------------------
  //: The people the district has to hire for a business: skill, reliability and the wage they ask.
  //: A headhunter's (headhunt_staff) are better.
  W.candidatesFor = function (b) {
    const R = this.R, S = BR(this).staff, t = this.time, roles = rolesFor(R, b.kind);
    const hunted = this.now < (b.headhunted_until || 0);
    const taken = new Set((b.staff || []).map((s) => s.id));
    const out = [];
    for (let i = 0; i < S.candidates; i += 1) {
      const r = rng("candidate", b.id, t.day, hunted ? "hh" : "", i);
      const role = roles[Math.floor(r() * roles.length) % roles.length];
      const skill = clamp(0.15 + 0.7 * r() + (hunted ? S.headhunted_skill : 0), 0, 1);
      const ask = Math.max(leastWage(R), Math.round(goingRate(R, role) * (S.ask_low + S.ask_skill * skill)));
      const id = `cand:${b.id}:${t.day}:${hunted ? "hh" : ""}${i}`;
      if (taken.has(id)) continue;
      out.push({ id, name: personName(r), role, title: R.jobs.roles[role].title, skill: Math.round(skill * 100) / 100,
        reliability: Math.round((0.6 + 0.4 * r()) * 100) / 100, ask, km: Math.round(r() * S.reach_km * 10) / 10, headhunted: hunted });
    }
    return out;
  };
  W.cmd_candidates = function (pid, { business }) { const b = this.ownBiz(this.player(pid), business); return { candidates: this.candidatesFor(b) }; };
  //: A new hire's shift when none is given: eight hours (or what is left of the day) starting where
  //: the opening hours are least covered by the staff already there.
  W.defaultShift = function (b) {
    const [o, c] = b.hours, len = Math.min(8, c - o);
    const cover = (hr) => b.staff.filter((s) => (s.shifts || []).some((sh) => sh.from <= hr && hr < sh.to)).length;
    let best = o, bestN = Infinity;
    for (let start = o; start + len <= c; start += 1) {
      let n = 0; for (let hr = start; hr < start + len; hr += 1) n += cover(hr);
      if (n < bestN) { bestN = n; best = start; }
    }
    return [{ days: [0, 1, 2, 3, 4, 5, 6], from: best, to: best + len }];
  };
  const cleanShifts = (shifts) => (shifts || []).map((s) => ({ days: [...new Set((s.days || [0, 1, 2, 3, 4, 5, 6]).map((d) => d | 0).filter((d) => d >= 0 && d < 7))],
    from: clamp(Math.round(+s.from), 0, 23), to: clamp(Math.round(+s.to), 1, 30) })).filter((s) => s.to > s.from && s.days.length);
  //: Hiring: an NPC candidate at their asking wage or more, or an offer to another player.
  W.cmd_hire = function (pid, { business, candidate = null, player = null, role = null, wage = null, shifts = null }) {
    const p = this.player(pid), b = this.ownBiz(p, business), R = this.R, S = BR(this).staff;
    const sh = cleanShifts(shifts || this.defaultShift(b));
    if (!sh.length) fail("give them a shift");
    if (player) {
      const q = this.players.get(player);
      if (!q || player === pid) fail("no such player here");
      const r = role || rolesFor(R, b.kind)[0];
      if (!rolesFor(R, b.kind).includes(r)) fail("not a role this business has");
      const pay = Math.max(leastWage(R), Math.round(wage ?? goingRate(R, r)));
      q.employment_offers = (q.employment_offers || []).filter((o) => o.expires > this.now && o.business !== b.id);
      const offer = { id: this.id("hireoffer"), business: b.id, name: b.name, role: r, title: R.jobs.roles[r].title, pay, shifts: sh, from: pid, expires: this.now + 2 * DAY };
      q.employment_offers.push(offer);
      this.log("job_offer", { from: pid, to: player, business: b.id });
      return { offered: offer };
    }
    const c = this.candidatesFor(b).find((x) => x.id === candidate);
    if (!c) fail("that candidate is not looking any more");
    const pay = Math.round(wage ?? c.ask);
    if (pay < c.ask) fail(`${c.name.split(" ")[0]} asks at least ${R.fmt(c.ask)} an hour`);
    if (c.headhunted) {
      const fee = Math.round(pay * S.month_hours * S.headhunter_share);
      const agency = this.ledger.open("firm:staffing", "business");
      this.ledger.transfer(b.account, agency, fee, { kind: "headhunter", memo: `${c.name} for ${b.name}`, at: this.now });
      b.today.fees = (b.today.fees || 0) + fee;
    }
    const s = { id: c.id, name: c.name, role: c.role, title: c.title, wage: pay, skill: c.skill, reliability: c.reliability, morale: S.morale_start,
      shifts: sh, hired: this.now, holiday: 0, ytd: { year: this.time.year, wages: 0, withheld: 0 }, order: null, home_until: 0, notice: null };
    b.staff.push(s);
    this.log("hired_staff", { business: b.id, staff: s.id });
    return { staff: s };
  };
  //: A player taking a job at another player's business: an offer made to them, or an opening posted.
  W.cmd_accept_employment = function (pid, { offer = null, opening = null }) {
    const p = this.player(pid);
    let o;
    if (offer) { o = (p.employment_offers || []).find((x) => x.id === offer && x.expires > this.now); if (!o) fail("that offer has gone"); }
    else if (opening) { o = this.openings.get(opening); if (!o) fail("that opening has been filled"); }
    else fail("which offer?");
    const b = this.bizAt(o.business.replace(/^biz:/, ""));
    if (!b) fail("that business has closed");
    if (b.owner === p.account) fail("you own it");
    this.recordCheck(p, o.role);
    if (p.clocked) this.cmd_clock_out(pid);
    this.leaveStaff(p);
    p.job = { role: o.role, title: o.title, pay: o.pay, place: { id: b.place.id, x: b.place.x, z: b.place.z, name: b.name }, employer: b.account, business: b.id, level: 0, shifts: o.shifts };
    b.staff.push({ id: `player:${pid}`, player: pid, name: p.name, role: o.role, title: o.title, wage: o.pay, skill: 0.5, morale: BR(this).staff.morale_start, shifts: o.shifts, hired: this.now, holiday: 0 });
    p.employment_offers = (p.employment_offers || []).filter((x) => x.id !== offer);
    if (opening) this.openings.delete(opening);
    this.log("hired", { player: pid, role: o.role, business: b.id });
    return { job: p.job };
  };
  W.cmd_decline_employment = function (pid, { offer }) {
    const p = this.player(pid);
    p.employment_offers = (p.employment_offers || []).filter((x) => x.id !== offer);
    return {};
  };
  //: A player leaving a player business's staff (a new job, jail, quitting).
  W.leaveStaff = function (p) {
    const b = p.job?.business ? this.biz.get(p.job.business) : null;
    if (b) b.staff = b.staff.filter((s) => s.player !== p.id);
  };
  //: Firing pays out the day's shift worked and the holiday pay accrued.
  W.cmd_fire = function (pid, { business, staff }) {
    const p = this.player(pid), b = this.ownBiz(p, business);
    const s = b.staff.find((x) => x.id === staff);
    if (!s) fail("not on your staff");
    this.letGo(b, s, "fired");
    return { staff: b.staff };
  };
  W.letGo = function (b, s, why) {
    if (s.player) {
      const q = this.players.get(s.player);
      if (q && q.job?.business === b.id) { if (q.clocked) this.payWork(q, true); q.clocked = null; q.job = null; q.let_go = { business: b.name, why, at: this.now }; }
    } else {
      const owed = (b.today.wages?.[s.id] || 0) + Math.round(s.holiday || 0);
      if (owed > 0 && this.payStaff(b, s, owed, `${s.name}: the last pay and holiday pay`) !== null) b.today.staff_wages = (b.today.staff_wages || 0) + owed;
      if (b.today.wages) delete b.today.wages[s.id];
    }
    b.staff = b.staff.filter((x) => x !== s);
    this.log("staff_left", { business: b.id, staff: s.id, why });
  };
  //: An NPC's wage: from the business to the residents, with the taxes withheld; a business that
  //: cannot pay owes it as a bill (and its people's morale falls).
  W.payStaff = function (b, s, gross, memo) {
    if (gross <= 0) return 0;
    const year = this.time.year;
    if (!s.ytd || s.ytd.year !== year) s.ytd = { year, wages: 0, withheld: 0 };
    const w = withholding(this.R, s.ytd.wages, gross);
    try {
      this.ledger.post([[b.account, -gross], ["business:residents", w.net], ["authority:irs", w.federal], ["authority:ftb", w.state],
        ["authority:ssa", w.social + w.medicare], ["authority:edd", w.disability]].filter(([, v]) => v !== 0), { kind: "wage", memo, at: this.now });
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e;
      this.billing.issue({ payer: b.account, payee: "business:residents", kind: "wages", amount: gross, memo: `Unpaid wages: ${memo}`, at: this.now, due_days: 7, penalties: [Math.round(gross * 0.1)] });
      s.morale = Math.max(0, (s.morale ?? 50) - 10);
      return null;
    }
    s.ytd.wages += gross; s.ytd.withheld += w.total;
    return w.total;
  };
  W.cmd_schedule = function (pid, { business, staff, shifts }) {
    const p = this.player(pid), b = this.ownBiz(p, business), s = b.staff.find((x) => x.id === staff);
    if (!s) fail("not on your staff");
    const sh = cleanShifts(shifts);
    if (!sh.length) fail("give them a shift (or let them go)");
    s.shifts = sh;
    if (s.player) { const q = this.players.get(s.player); if (q?.job?.business === b.id) q.job.shifts = sh; }
    return { staff: s };
  };
  //: Standing in the shop, an order to one of the staff: serve, restock, clean, a break, go home.
  W.cmd_order_staff = function (pid, { business, staff, order }) {
    const p = this.player(pid), b = this.ownBiz(p, business), s = b.staff.find((x) => x.id === staff), S = BR(this).staff;
    if (!s || s.player) fail("not one of your NPC staff");
    if (!this.near(p, b.place, this.R.stores.reach_m * 4)) fail("be in the shop to give orders");
    if (!onShift(s, cityTime(this.now, this.R.clock.zone))) fail(`${s.name.split(" ")[0]} is not on shift`);
    if (order === "go_home") { s.home_until = dayEnd(this.now, this.time); s.order = null; }
    else if (["serve", "restock", "clean", "break"].includes(order)) {
      s.order = { kind: order, until: this.now + HOUR };
      if (order === "break" && !(s.breaks_today >= 2)) { s.morale = clamp((s.morale ?? 50) + S.break_point, 0, 100); s.breaks_today = (s.breaks_today || 0) + 1; }
    } else fail("serve, restock, clean, break or go_home");
    return { staff: s };
  };
  //: A raise (or a cut) moves morale with it.
  W.setWage = function (b, s, wage) {
    const share = (wage - s.wage) / Math.max(1, s.wage);
    s.morale = clamp((s.morale ?? 50) + share * BR(this).staff.raise_point_per_share, 0, 100);
    s.wage = wage;
  };
  W.cmd_set_wage = function (pid, { business, staff, wage }) {
    const p = this.player(pid), b = this.ownBiz(p, business), s = b.staff.find((x) => x.id === staff);
    if (!s || s.player) fail("not one of your NPC staff");
    const w = Math.round(+wage);
    if (!(w >= leastWage(this.R))) fail(`at least the minimum wage, ${this.R.fmt(leastWage(this.R))} an hour`);
    this.setWage(b, s, w);
    return { staff: s };
  };
  W.cmd_post_opening = function (pid, { business, role, wage = null, shifts = null }) {
    const p = this.player(pid), b = this.ownBiz(p, business), R = this.R;
    if (!rolesFor(R, b.kind).includes(role)) fail("not a role this business has");
    const pay = Math.max(leastWage(R), Math.round(wage ?? goingRate(R, role)));
    const sh = cleanShifts(shifts || this.defaultShift(b));
    const o = { id: this.id("opening"), business: b.id, name: b.name, role, title: R.jobs.roles[role].title, pay, shifts: sh, place: b.place, posted: this.now };
    this.openings.set(o.id, o);
    return { opening: o };
  };
  W.cmd_close_opening = function (pid, { opening }) {
    const p = this.player(pid), o = this.openings.get(opening);
    if (!o || this.biz.get(o.business)?.owner !== p.account) fail("not an opening of yours");
    this.openings.delete(opening);
    return {};
  };
  W.cmd_headhunt_staff = function (pid, { business }) {
    const p = this.player(pid), b = this.ownBiz(p, business);
    b.headhunted_until = this.now + 2 * DAY;
    return { candidates: this.candidatesFor(b) };
  };

  // ---- buying an NPC's business ---------------------------------------------------------------------
  W.appraiseBusiness = function (place, rivals = 1) {
    const R = this.R, Bu = BR(this).buying;
    const kind = storesAt(R, place.keys || []).find((s) => !R.stores.kinds[s.kind].counter)?.kind;
    if (!kind) fail("there is no business there to buy");
    const pl = { ...place, chain: jurisdictionChain(this, place) };
    const books = [];
    for (let wk = Bu.books_weeks; wk >= 1; wk -= 1) books.push({ week: -wk, ...modelWeek(R, pl, kind, { rivals, week: wk }) });
    const year = Math.round(books.reduce((s, x) => s + x.profit, 0) / books.length * 52);
    const stockCost = Math.round(books.reduce((s, x) => s + x.cogs, 0) / books.length * Bu.stock_weeks);
    const asking = year > 0 ? Math.round(year * Bu.profit_multiple) + stockCost : stockCost + Bu.key_fee.fee_base;
    return { kind, books, year_profit: year, stock_cost: stockCost, asking, down: Math.round(asking * Bu.down_share),
      monthly: loanPayment(asking - Math.round(asking * Bu.down_share), Bu.rate, Bu.months / 12), months: Bu.months, rate: Bu.rate };
  };
  W.cmd_appraise_business = function (pid, { place, rivals = 1 }) {
    this.player(pid);
    if (this.bizAt(place?.id)) fail("a player runs that business");
    return { appraisal: this.appraiseBusiness(place, rivals) };
  };
  //: Buying an NPC's shop: its staff and stock with it, the lease carried on, 30% down and the
  //: rest paid to the seller monthly (financed), or all at once.
  W.cmd_buy_business = function (pid, { place, financed = true, name = null, rivals = 1 }) {
    const p = this.player(pid), R = this.R, B = BR(this);
    if (!place?.id) fail("which business?");
    if (this.bizAt(place.id)) fail("a player runs that business");
    if (!this.near(p, place, R.stores.reach_m * 4)) fail("walk up to it first");
    const a = this.appraiseBusiness(place, rivals);
    const seller = this.ledger.open(`business:${place.id}`, "business");
    const pay = financed ? a.down : a.asking;
    if (this.ledger.balance(p.account) < pay) fail(`${financed ? "the down payment" : "the price"} is ${R.fmt(pay)}`);
    this.ledger.transfer(p.account, seller, pay, { kind: "business_sale", memo: `${place.name || place.id}${financed ? ", down payment" : ""}`, at: this.now });
    const id = `biz:${place.id}`, here = this.where(p), t = this.time;
    const staff = defaultStaff(R, a.kind, place.id).map((s) => ({ ...s, hired: this.now, holiday: 0, ytd: { year: t.year, wages: 0, withheld: 0 }, reliability: 0.85, order: null, home_until: 0, notice: null }));
    const stock = {};
    const items = itemsFor(R, a.kind);
    const perItem = items.length ? a.stock_cost / items.length : 0;
    for (const it of items) stock[it] = Math.max(4, Math.round(perItem / unitCost(R, it)));
    const account = this.ledger.open(`firm:${id}`, "business");
    const b = { id, place: slimPlace(place), kind: a.kind, name: String(name || place.name || R.stores.kinds[a.kind].name).slice(0, B.name_max), owner: p.account, owner_pid: pid,
      account, chain: here.chain, city: here.city || null, county: here.county, premises: "lease", stock, prices: {}, hours: hoursFor(R, a.kind), duties: [...B.duties], staff,
      reputation: B.reputation.start, licences: Object.fromEntries(licencesFor(R, a.kind, place.area).map((l) => [l.id, this.now + B.renew_days * DAY])),
      books: [], today: freshDay(t.day), sim_to: hourFloor(this.now), incoming: [], status: "open", opened: this.now, rivals: Math.max(0, rivals | 0), headhunted_until: 0, bought: { price: a.asking, at: this.now },
      loan: financed ? { seller, principal: a.asking - a.down, monthly: a.monthly, left: a.months, next_due: this.now + 30 * DAY, missed: 0 } : null };
    this.biz.set(id, b);
    this.storefronts.set(b.place.id, { place: b.place, holder: p.account, pid, paid_to: this.now + 7 * DAY, deposit: B.storefront_lease_per_week * B.lease_deposit_weeks, missed: 0, since: this.now });
    if (this.registry.assets.has(id)) { const as = this.registry.get(id); as.owner = as.holder = p.account; as.custody = "owner"; }
    else this.registry.register(id, "business", p.account, { name: b.name, kind: b.kind, place: b.place.id }, this.now);
    this.log("business_bought", { player: pid, business: id, price: a.asking });
    return { business: this.bizView(b), paid: pay, appraisal: a };
  };
  W.cmd_close_business = function (pid, { business }) {
    const p = this.player(pid), b = this.ownBiz(p, business);
    this.closeDay(b);
    for (const s of [...b.staff]) this.letGo(b, s, "the business closed");
    for (const [id, o] of this.openings) if (o.business === b.id) this.openings.delete(id);
    const left = this.ledger.balance(b.account);
    if (left > 0) this.ledger.transfer(b.account, p.account, left, { kind: "owner_draw", memo: `${b.name} closed`, at: this.now });
    b.status = "closed"; b.closed = this.now;
    return { returned: left };
  };

  // ---- the hours going by ---------------------------------------------------------------------------
  W.enterpriseStep = function () {
    for (const b of this.biz.values()) if (b.status === "open") this.runBusiness(b);
    this.lawStep();
    for (const p of this.players.values()) {
      if (p.job_offers?.length) p.job_offers = p.job_offers.filter((o) => o.expires > this.now);
      if (p.employment_offers?.length) p.employment_offers = p.employment_offers.filter((o) => o.expires > this.now);
      if (p.probation && this.now > p.probation.until) p.probation = null;
    }
  };
  W.runBusiness = function (b) {
    const R = this.R, B = BR(this);
    const limit = hourFloor(this.now);
    if (b.sim_to < limit - 14 * DAY) b.sim_to = limit - 14 * DAY;   // away a long time: the last fortnight only
    while (b.sim_to < limit) {
      const t = cityTime(b.sim_to + HOUR / 2, R.clock.zone);
      if (t.day !== b.today.day) this.closeDay(b, t);
      for (const inc of b.incoming) if (inc.at <= b.sim_to + HOUR) { for (const [id, n] of Object.entries(inc.items)) b.stock[id] = (b.stock[id] || 0) + n; inc.done = true; }
      b.incoming = b.incoming.filter((x) => !x.done);
      b.laws = this.laws;
      const live = b.sim_to + HOUR >= limit;
      const o = hourOf(R, b, t, { first: t.hour === b.hours[0] % 24, last: (t.hour + 1) % 24 === b.hours[1] % 24, extra: live ? this.handsIn(b) : 0 });
      delete b.laws;
      const d = b.today;
      d.visits += o.visits; d.wanted += o.wanted; d.served += o.served; d.lost += o.lost; d.sales += o.sales; d.tax += o.tax; d.cogs += o.cogs;
      d.stockout += o.stockout; d.clean_need += o.clean_need; d.clean_done += o.clean_done; if (o.understaffed) d.understaffed += 1; if (o.opened_late) d.late_open += 1;
      for (const [id, n] of Object.entries(o.units)) d.units += n;
      for (const [sid, w] of Object.entries(o.wages)) d.wages[sid] = (d.wages[sid] || 0) + w;
      b.sim_to += HOUR;
      if (b.status !== "open") break;
    }
    // The lease (weekly), the licences (yearly), the seller's loan (monthly).
    const lease = this.storefronts.get(b.place.id);
    if (lease && b.premises === "lease" && this.now >= lease.paid_to) {
      const rent = B.storefront_lease_per_week;
      const from = this.ledger.balance(b.account) >= rent ? b.account : this.ledger.balance(b.owner) >= rent ? b.owner : null;
      if (from) { this.ledger.transfer(from, "business:landlords", rent, { kind: "rent", memo: `storefront, ${b.name}`, at: this.now }); b.today.rent += rent; lease.missed = 0; }
      else {
        lease.missed += 1;
        this.billing.issue({ payer: b.account, payee: "business:landlords", kind: "rent", amount: rent, memo: `Storefront rent, ${b.name}`, at: this.now, due_days: 7, penalties: [Math.round(rent * 0.1)] });
        if (lease.missed >= B.evict_after_missed) { this.closeDay(b); for (const s of [...b.staff]) this.letGo(b, s, "evicted"); b.status = "evicted"; this.storefronts.delete(b.place.id); this.log("evicted", { business: b.id }); return; }
      }
      lease.paid_to += 7 * DAY;
    }
    for (const [id, until] of Object.entries(b.licences)) {
      if (this.now < until) continue;
      const L = licencesFor(R, b.kind, b.place.area).find((l) => l.id === id);
      b.licences[id] = this.now + B.renew_days * DAY;
      if (!L) continue;
      const to = this.treasury(b.city || b.county);
      try { this.ledger.transfer(b.account, to, L.fee, { kind: "licence", memo: `${L.name} renewed, ${b.name}`, at: this.now }); b.today.fees += L.fee; }
      catch { this.billing.issue({ payer: b.account, payee: to, kind: "licence", amount: L.fee, memo: `${L.name} renewal, ${b.name}`, at: this.now, due_days: 30, penalties: [Math.round(L.fee * 0.25)] }); }
    }
    const loan = b.loan;
    if (loan && loan.left > 0 && this.now >= loan.next_due) {
      const from = this.ledger.balance(b.account) >= loan.monthly ? b.account : this.ledger.balance(b.owner) >= loan.monthly ? b.owner : null;
      if (from) { this.ledger.transfer(from, loan.seller, loan.monthly, { kind: "loan", memo: `${b.name}: payment to the seller`, at: this.now }); loan.left -= 1; loan.missed = 0; b.today.fees += loan.monthly; }
      else {
        loan.missed += 1;
        if (loan.missed >= B.buying.repossess_after_missed) { this.repossess(b); return; }
      }
      loan.next_due += 30 * DAY;
      if (loan.left <= 0) b.loan = null;
    }
  };
  W.repossess = function (b) {
    this.closeDay(b);
    for (const s of [...b.staff].filter((x) => x.player)) this.letGo(b, s, "the business went back to its seller");
    b.status = "repossessed"; b.owner = b.loan.seller; b.loan = null;
    const a = this.registry.assets.get(b.id);
    if (a) { a.owner = a.holder = b.owner; this.registry.note(a, "repossessed", null, b.owner, this.now); }
    this.storefronts.delete(b.place.id);
    this.log("repossessed", { business: b.id });
  };
  //: Players working in the shop now (the owner standing in it, player staff clocked in): a pair
  //: of hands each at the counter.
  W.handsIn = function (b) {
    let n = 0;
    for (const p of this.players.values()) {
      if (this.now - (p.seen || 0) > 5 * 60_000 || p.x === undefined) continue;
      const working = p.account === b.owner || (p.job?.business === b.id && p.clocked);
      if (working && Math.hypot(p.x - b.place.x, p.z - b.place.z) <= this.R.stores.reach_m * 4) n += 0.8;
    }
    return n;
  };
  //: A day's books: the takings in (and their sales tax out to the city), the wages paid with their
  //: taxes withheld, reputation and morale moved, the line in the books, and on Mondays the week.
  W.closeDay = function (b, t = null) {
    const R = this.R, B = BR(this), d = b.today;
    if (d.sales + d.tax > 0) {
      this.ledger.mint(b.account, d.sales + d.tax, "npc_income", { at: this.now, memo: `${b.name}: the day's takings` });
      if (d.tax > 0) this.ledger.transfer(b.account, this.treasury(b.city || b.county), d.tax, { kind: "sales_tax", memo: `${b.name}: sales tax remitted`, at: this.now });
    }
    // Wages paid (an unpaid day is a bill, owed, and in the books when it is paid).
    let wages = 0, withheld = 0, unpaid = 0;
    for (const [sid, gross] of Object.entries(d.wages)) {
      const s = b.staff.find((x) => x.id === sid);
      if (!s || gross <= 0) continue;
      const held = this.payStaff(b, s, gross, `${s.name}, ${s.title || s.role}`);
      if (held === null) { unpaid += gross; continue; }
      withheld += held; wages += gross;
      s.holiday = (s.holiday || 0) + gross * B.staff.holiday_share;
    }
    // Reputation: served well, kept clean, not out of stock; drifting back toward the start.
    const Rp = B.reputation;
    if (d.wanted > 1) {
      const servedShare = d.served / d.wanted, clean = d.clean_need > 0 ? d.clean_done / d.clean_need : 1;
      const out = d.units + d.stockout > 0 ? d.stockout / (d.units + d.stockout) : 0;
      b.reputation = clamp(b.reputation + (servedShare - Rp.served_target) * Rp.per_served_point + (clean - 0.5) * 2 * Rp.clean_point - out * Rp.stockout_point * 3
        + (Rp.start - b.reputation) * Rp.drift * 0.1, 0, 100);
    }
    // Morale: understaffed days and pay under the going rate wear it down; otherwise it recovers.
    const S = B.staff;
    for (const s of [...b.staff]) {
      if (s.player) continue;
      s.breaks_today = 0;
      if (!d.wages[s.id] && !s.notice) continue;
      const going = R.jobs.roles[s.role] ? goingRate(R, s.role) : s.wage;
      let m = s.morale ?? S.morale_start;
      if (d.understaffed > 2) m -= S.understaffed_point * Math.min(3, d.understaffed / 3);
      if (s.wage < going) m -= S.underpaid_point * Math.min(2.5, (going - s.wage) / going * 10);
      else if (!(d.understaffed > 2)) m += S.recovery_point;
      s.morale = clamp(m, 0, 100);
      if (s.morale < S.quit_below && !s.notice) { s.notice = this.now + S.notice_days * DAY; this.log("notice", { business: b.id, staff: s.id }); b.notices = (b.notices || 0) + 1; }
      if (s.notice && this.now >= s.notice) this.letGo(b, s, "quit");
    }
    wages += d.staff_wages || 0;
    const sales = d.sales + (d.player_sales || 0);
    const day = { day: d.day, sales, tax: d.tax, cogs: d.cogs, wages, withheld, unpaid, rent: d.rent, fees: d.fees, ordered: d.ordered || 0,
      profit: sales - d.cogs - wages - d.rent - d.fees, visits: Math.round(d.visits), served: Math.round(d.served), lost: Math.round(d.lost),
      stockout: d.stockout, reputation: Math.round(b.reputation) };
    if (sales || wages || d.rent || d.fees || d.visits) { b.books.push(day); if (b.books.length > B.buying.books_weeks * 7) b.books.shift(); }
    if (t && t.weekday === 1 && b.books.length) {
      const wk = b.books.slice(-7), sum = (k) => wk.reduce((s, x) => s + (x[k] || 0), 0);
      b.week = { to: d.day, sales: sum("sales"), cogs: sum("cogs"), wages: sum("wages"), rent: sum("rent"), fees: sum("fees"), profit: sum("profit"), served: sum("served"), lost: sum("lost"), reputation: Math.round(b.reputation), at: this.now };
      this.log("business_week", { business: b.id, profit: b.week.profit });
    }
    b.today = freshDay(t ? t.day : this.time.day);
    return day;
  };
  //: What the panels show of a business.
  W.bizView = function (b) {
    return { ...b, balance: this.ledger.balance(b.account), candidates: undefined, roles: rolesFor(this.R, b.kind), items: itemsFor(this.R, b.kind),
      stars: Math.round(b.reputation / 20 * 2) / 2 };
  };
  //: A player's businesses, cases, record and offers, for the status (and the profile).
  W.enterpriseStatus = function (p) {
    const businesses = [...this.biz.values()].filter((b) => b.owner === p.account && b.status === "open").map((b) => this.bizView(b));
    const cases = [...this.cases.values()].filter((c) => c.pid === p.id && !c.closed);
    return { businesses, cases, record: p.record || [], former_inmate: Boolean(p.former_inmate), job_offers: p.job_offers || [], employment_offers: p.employment_offers || [],
      released: p.released || null, probation: p.probation || null, experience: p.experience || {}, reliability: p.reliability || null,
      storefronts: [...this.storefronts.values()].filter((s) => s.holder === p.account), openings: [...this.openings.values()] };
  };

  // ---- the law --------------------------------------------------------------------------------------
  //: The record lines that count as priors: criminal convictions.
  W.priorsOf = function (p) { return (p.record || []).filter((l) => l.class === "criminal" && l.charge !== "former_inmate").length; };
  //: A fine opens a case (a second offence on probation doubles it).
  W.openCase = function (p, bill) {
    if (!bill || bill.case || !p) return null;
    if (p.probation && this.now < p.probation.until && bill.issued === this.now) { bill.owed += bill.amount; bill.amount *= 2; bill.penalties = bill.penalties.map((x) => x * 2); bill.memo = `${bill.memo} (doubled: on probation)`; }
    const c = { id: this.id("case"), pid: p.id, bill: bill.id, charge: bill.kind, class: chargeClass(this.R, bill.kind), memo: bill.memo,
      evidence: evidenceScore(this.R, bill.evidence), priors: this.priorsOf(p), opened: this.now, court: null, lawyer: null, verdict: null, closed: null };
    bill.case = c.id;
    this.cases.set(c.id, c);
    return c;
  };
  W.caseOf = function (p, id) { const c = this.cases.get(id); if (!c || c.pid !== p.id || c.closed) fail("not an open case of yours"); return c; };
  //: The lawyers at a law office, with each one's odds on a case of yours (if given).
  W.cmd_lawyers = function (pid, { place, case: cid = null }) {
    const p = this.player(pid);
    if (!(place?.keys || []).includes("shop:law_office")) fail("that is not a law office");
    const c = cid ? this.caseOf(p, cid) : null;
    const list = lawyersAt(this.R, place, this.tenantNames).map((l) => ({ ...l, skill: undefined, price: this.lawyerPrice(p, l, c),
      odds: c && l.takes.includes(c.class) ? oddsLabel(this.R, verdictWeights(this.R, { skill: l.skill, evidence: c.evidence, priors: c.priors, criminal: c.class === "criminal" })) : null,
      free: l.role === "public" && this.ledger.balance(p.account) < this.R.business.law.roles.public.means_under.balance }));
    return { lawyers: list, self_odds: c ? oddsLabel(this.R, verdictWeights(this.R, { skill: this.R.business.law.self_skill, evidence: c.evidence, priors: c.priors, criminal: c.class === "criminal" })) : null };
  };
  W.lawyerPrice = function (p, l, c) {
    if (l.role === "public") return 0;
    const pr = c?.class === "criminal" ? 1 + this.R.business.law.priors_price_share * this.priorsOf(p) : 1;
    const unit = this.R.money(25);
    return Math.round(l.price * pr / unit) * unit;
  };
  //: Hiring a lawyer for a case: their retainer to the firm, a court date set (2-14 days on; the
  //: public defender, busy, a couple more). Another player can not be your lawyer.
  W.cmd_hire_lawyer = function (pid, { place, lawyer, case: cid, player = null }) {
    const p = this.player(pid), R = this.R, L = R.business.law;
    if (player) fail("another player can not be your lawyer while verdicts are a weighted chance");
    if (!(place?.keys || []).includes("shop:law_office")) fail("lawyers are hired at a law office");
    if (!this.near(p, place, R.stores.reach_m * 4)) fail("go into the law office first");
    const c = this.caseOf(p, cid);
    if (c.verdict) fail("that case has been decided");
    const l = lawyersAt(R, place, this.tenantNames).find((x) => x.id === lawyer);
    if (!l) fail("no such lawyer there");
    if (!l.takes.includes(c.class)) fail(`${l.name} does not take ${c.class} cases`);
    const price = this.lawyerPrice(p, l, c);
    if (l.role === "public" && this.ledger.balance(p.account) >= L.roles.public.means_under.balance) fail(`the public defender is for those with less than ${R.fmt(L.roles.public.means_under.balance)}`);
    if (price > 0) {
      const firm = this.ledger.open(`firm:law:${place.id}`, "business");
      this.ledger.transfer(p.account, firm, price, { kind: "retainer", memo: `${l.name}, ${l.title.toLowerCase()}`, at: this.now });
    }
    const [a, b2] = L.court_days, r = rng("court", c.id)();
    const days = a + Math.floor(r * (b2 - a + 1)) + (L.roles[l.role].prep_days || 0);
    c.lawyer = { id: l.id, name: l.name, firm: l.firm, title: l.title, skill: l.skill, place: slimPlace(place), price };
    c.court = Math.max(c.court || 0, this.now + days * DAY);
    const bill = this.billing.bills.get(c.bill);
    if (bill && bill.status === "open") bill.due = Math.max(bill.due, c.court + DAY);   // no late penalty while in court
    this.log("lawyer", { player: pid, case: c.id });
    return { case: c, court: this.courthouse(), price };
  };
  W.courthouse = function () { return { ...this.R.business.law.courthouse }; };
  //: Going to court yourself on the day (or contesting a summons without a lawyer).
  //: The hearing is held at the courthouse -- or, where the district shown is not the real
  //: courthouse's, at its civic building nearest the real one (``court``, chosen by the view).
  W.cmd_attend_court = function (pid, { case: cid, court = null }) {
    const p = this.player(pid), L = this.R.business.law, c = this.caseOf(p, cid);
    if (!c.court) fail("that case has no court date: hire a lawyer, or contest it");
    const [from, to] = L.attend_hours;
    if (this.now < c.court + from * HOUR) fail(`the hearing is ${new Date(c.court).toISOString().slice(0, 16).replace("T", " ")} (UTC); come back then`);
    if (this.now > c.court + to * HOUR) fail("the hearing has been held");
    if (court && (court.keys || []).includes("use:civic")) { if (!this.near(p, court, L.courthouse.reach_m)) fail(`go to the court first: ${court.name || "the civic building"}`); }
    else if (p.lon !== undefined && p.lat !== undefined && metres({ lon: p.lon, lat: p.lat }, L.courthouse) > L.courthouse.reach_m) fail(`go to the courthouse first: ${L.courthouse.address}`);
    return this.decide(p, c, false);
  };
  //: The verdict: a weighted chance (plan 3.4), and what it means for the fine, the record and you.
  W.decide = function (p, c, absent) {
    const R = this.R, L = R.business.law;
    let skill = c.lawyer ? c.lawyer.skill : L.self_skill;
    if (absent) skill *= L.absent_share;
    const ws = verdictWeights(R, { skill, evidence: c.evidence, priors: this.priorsOf(p), criminal: c.class === "criminal" });
    const id = pickW(rng("verdict", this.seed, c.id), Object.entries(ws));
    const o = L.outcomes.find((x) => x.id === id);
    const bill = this.billing.bills.get(c.bill);
    c.verdict = { outcome: id, name: o.name, absent, at: this.now };
    const line = (outcome, extra = {}) => { (p.record ||= []).push({ charge: c.charge, class: c.class, outcome, at: this.now, case: c.id, ...extra }); };
    if (id === "dismissed" || id === "acquitted") { if (bill) this.billing.dismiss(bill.id, this.now, o.name.toLowerCase()); }
    else if (id === "reduced") {
      if (bill && bill.status === "open") { bill.owed = Math.max(0, Math.round(bill.amount * o.fine_share) - bill.paid); if (bill.owed === 0) { bill.status = "paid"; bill.settled = this.now; } bill.memo = `${bill.memo} (reduced in court)`; }
      if (c.class === "criminal") line("reduced");
    } else if (id === "record") line("convicted");
    else if (id === "probation") { line("probation"); p.probation = { until: this.now + o.probation_days * DAY, case: c.id }; }
    else if (id === "jail") { if (bill) this.billing.dismiss(bill.id, this.now, "time served"); this.jail(p, c); }
    if (bill && bill.status === "open") bill.due = Math.max(this.now + 7 * DAY, bill.due);
    c.closed = this.now;
    this.log("verdict", { player: p.id, case: c.id, outcome: id });
    return { verdict: c.verdict, case: c, released: id === "jail" ? p.released : null };
  };
  //: Jail as a time skip: the sentence passes at once and is told as what happened inside, and
  //: you come out changed by it -- health, stamina and strength -- with the crime and "former
  //: inmate" on the record; a long sentence costs the job.
  W.jail = function (p, c) {
    const R = this.R, L = R.business.law;
    const [a, b] = L.jail_days[c.charge] || L.jail_days.default;
    const r = rng("jail", this.seed, c.id);
    const days = a + Math.floor(r() * (b - a + 1));
    const events = [];
    const n = Math.min(days, 2 + Math.floor(days / 3), 8);
    const daysAt = [...new Set(Array.from({ length: n }, () => 1 + Math.floor(r() * days)))].sort((x, y) => x - y);
    const before = { health: p.vitals.health, stamina: p.vitals.stamina, strength: p.vitals.strength };
    const v = { ...p.vitals };
    for (const d of daysAt) {
      const pickId = pickW(r, R.business.jail_story.map((s) => [s.id, s.weight]));
      const e = R.business.jail_story.find((x) => x.id === pickId);
      events.push({ day: d, id: e.id, text: e.text.replace("{d}", String(d)) });
      for (const k of ["health", "stamina", "strength"]) v[k] = clamp(v[k] + e[k], k === "strength" ? R.vitals.strength.minimum : 5, R.vitals.max);
    }
    // Days of strength fading inside, as outside.
    v.strength = clamp(v.strength - R.vitals.strength.decay_per_day * days * 0.3, R.vitals.strength.minimum, R.vitals.max);
    p.vitals = { ...v, at: this.now };
    (p.record ||= []).push({ charge: c.charge, class: c.class, outcome: "jail", days, at: this.now, case: c.id });
    if (!p.former_inmate) p.record.push({ charge: "former_inmate", class: "criminal", outcome: "released", at: this.now, case: c.id });
    p.former_inmate = true;
    let lostJob = null;
    if (p.clocked) p.clocked = null;
    if (p.driving) p.driving = null;
    if (days >= L.lose_job_days && p.job) { lostJob = p.job.title; this.leaveStaff(p); p.job = null; }
    p.released = { days, charge: c.charge, events, before, after: { health: v.health, stamina: v.stamina, strength: v.strength }, lost_job: lostJob, at: this.now };
    this.log("jail", { player: p.id, days });
    return p.released;
  };
  W.cmd_acknowledge_release = function (pid) { const p = this.player(pid); p.released = null; return {}; };
  //: Cases the city takes to court: a fine left unpaid past its late penalty becomes a summons; a
  //: hearing missed goes ahead without you, at half your lawyer's skill.
  W.lawStep = function () {
    const L = this.R.business.law;
    for (const bill of this.billing.bills.values()) {
      if (bill.status !== "open" || !bill.collections || !bill.payer.startsWith("player:")) continue;
      const p = this.players.get(bill.payer.slice(7));
      if (!p) continue;
      const c = bill.case ? this.cases.get(bill.case) : this.openCase(p, bill);
      if (!c || c.closed || c.court) continue;
      c.court = this.now + L.summons_days * DAY; c.summons = true;
      this.log("summons", { player: p.id, case: c.id });
    }
    for (const c of this.cases.values()) {
      if (c.closed) continue;
      const bill = this.billing.bills.get(c.bill);
      if (bill && bill.status !== "open" && !c.verdict) {
        // Paid (or dismissed at a contest hearing) before it came to court.
        c.closed = this.now;
        const p = this.players.get(c.pid);
        if (p && bill.status === "paid" && c.class === "criminal") (p.record ||= []).push({ charge: c.charge, class: c.class, outcome: "paid", at: this.now, case: c.id });
        continue;
      }
      if (c.court && this.now > c.court + L.attend_hours[1] * HOUR) { const p = this.players.get(c.pid); if (p) this.decide(p, c, true); }
    }
  };
  //: Some roles check the record (a theft or battery within two years).
  W.recordCheck = function (p, role) {
    const L = this.R.business.law, since = this.now - L.record_years * 365 * DAY;
    if (!L.record_checks.roles.includes(role)) return;
    const hit = (p.record || []).find((l) => L.record_checks.charges.includes(l.charge) && l.at >= since);
    if (hit) fail(`the ${this.R.jobs.roles[role].title.toLowerCase()} job checks records: a ${hit.charge} conviction within ${L.record_years} years`);
  };
  //: Expungement at a law office: lines over two years old cleared, for its fee.
  W.cmd_expunge = function (pid, { place }) {
    const p = this.player(pid), R = this.R, L = R.business.law;
    if (!(place?.keys || []).includes("shop:law_office")) fail("expungement is done at a law office");
    if (!this.near(p, place, R.stores.reach_m * 4)) fail("go into the law office first");
    const since = this.now - L.record_years * 365 * DAY;
    const old = (p.record || []).filter((l) => l.at < since);
    if (!old.length) fail(`nothing on your record is over ${L.record_years} years old`);
    const firm = this.ledger.open(`firm:law:${place.id}`, "business");
    this.ledger.transfer(p.account, firm, L.expunge.fee_base, { kind: "expungement", memo: `${old.length} record lines`, at: this.now });
    p.record = p.record.filter((l) => l.at >= since);
    if (!p.record.some((l) => l.charge === "former_inmate")) p.former_inmate = false;
    return { cleared: old.length, record: p.record };
  };

  // ---- careers --------------------------------------------------------------------------------------
  //: The shift a job has around ``now``: {start, end} (ms), the one under way or the next to come.
  W.shiftNear = function (job, now = this.now) {
    if (!job) return null;
    const R = this.R, spec = R.jobs.roles[job.role];
    const shifts = job.shifts || (spec?.shifts || []).map(([from, to]) => ({ days: spec.days === "weekdays" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6], from, to }));
    let best = null;
    for (let dd = -1; dd <= 7; dd += 1) {
      const t = cityTime(now + dd * DAY, R.clock.zone);
      const midnight = now + dd * DAY - (t.minute * 60_000);
      for (const s of shifts) {
        if (!s.days.includes(t.weekday)) continue;
        const start = midnight + s.from * HOUR, end = midnight + s.to * HOUR;
        if (end <= now) continue;
        if (!best || start < best.start) best = { start, end };
      }
      if (best && best.start <= now + DAY) break;
    }
    return best;
  };
  //: Clocking in on time or late: late past the grace, 15 minutes' pay docked once and logged.
  W.clockedIn = function (p) {
    const C = BR(this).careers, sh = this.shiftNear(p.job);
    if (!sh || !p.clocked) return;
    p.clocked.shift = sh;
    if (this.now > sh.start + C.late_grace_minutes * 60_000 && this.now < sh.end) {
      p.clocked.late = true;
      p.clocked.dock = Math.round(p.job.pay * C.late_dock_minutes / 60);
      this.log("late", { player: p.id, minutes: Math.round((this.now - sh.start) / 60_000) });
    }
  };
  //: A shift done: counted, on time or not, and after enough good ones, a promotion.
  W.shiftDone = function (p, c) {
    const C = BR(this).careers;
    if (!c || this.now - c.since < C.shift_min_minutes * 60_000) return null;
    const rel = (p.reliability ||= { shifts: 0, on_time: 0, since_promotion: 0, on_time_since: 0 });
    rel.shifts += 1; rel.since_promotion += 1;
    if (!c.late) { rel.on_time += 1; rel.on_time_since += 1; }
    if (!p.job) return null;
    const level = p.job.level || 0;
    if (rel.since_promotion >= C.promote_shifts && rel.on_time_since / rel.since_promotion >= C.promote_reliability && level < C.max_level) {
      const titles = C.levels[p.job.role];
      p.job.level = level + 1;
      p.job.pay = Math.round(p.job.pay * (1 + C.level_raise));
      p.job.title = titles?.[level + 1] || (level === 0 ? `Senior ${p.job.title.toLowerCase()}` : "Shift lead");
      rel.since_promotion = 0; rel.on_time_since = 0;
      p.promoted = { title: p.job.title, pay: p.job.pay, at: this.now };
      if (p.job.business) { const b = this.biz.get(p.job.business), s = b?.staff.find((x) => x.player === p.id); if (s) { s.wage = p.job.pay; s.title = p.job.title; } }
      this.log("promoted", { player: p.id, title: p.job.title });
      return p.promoted;
    }
    return null;
  };
  //: What pay a role gets at a place: the role's at the level, and the employer's own premium.
  W.payAt = function (role, place, level = 0) {
    const C = BR(this).careers, base = this.R.jobs.roles[role].pay;
    const premium = 0.95 + 0.17 * rng("premium", place.id, role)();
    return Math.round(base * Math.pow(1 + C.level_raise, level) * premium);
  };
  //: A recruiter's offers: the best-paying openings within reach that pay at least 10% more than
  //: now (with a step up in your own role if you have the experience); fewer with priors.
  W.cmd_headhunt = function (pid, { places = [], place = null }) {
    const p = this.player(pid), R = this.R, H = BR(this).headhunter, C = BR(this).careers;
    if (place && !(place.keys || []).includes("shop:staffing")) fail("that is not a staffing agency");
    const now = p.job ? p.job.pay : R.jobs.minimum_wage;
    const floor = Math.round(now * (1 + H.above_share));
    const rel = p.reliability, good = !rel || rel.shifts === 0 || rel.on_time / rel.shifts >= C.promote_reliability;
    const exp = p.experience || {};
    const options = [];
    for (const pl of places) {
      if (!(pl.km === undefined || pl.km <= H.reach_km) || pl.id === p.job?.place?.id || this.bizAt(pl.id)) continue;
      for (const role of R.jobs.player_jobs) {
        const spec = R.jobs.roles[role];
        if (!spec.at.some((k) => (pl.keys || []).includes(k))) continue;
        try { this.recordCheck(p, role); } catch { continue; }
        let level = role === p.job?.role ? p.job.level || 0 : 0;
        if (role === p.job?.role && (exp[role] || 0) >= H.level_up_tasks && good) level = Math.min(C.max_level, level + 1);
        const pay = this.payAt(role, pl, level);
        if (pay < floor) continue;
        const titles = C.levels[role];
        options.push({ role, level, pay, title: titles?.[level] || (level ? `Senior ${spec.title.toLowerCase()}` : spec.title), place: slimPlace(pl) });
      }
    }
    for (const o of this.openings.values()) {
      if (o.pay < floor || this.biz.get(o.business)?.owner === p.account) continue;
      try { this.recordCheck(p, o.role); } catch { continue; }
      options.push({ role: o.role, level: 0, pay: o.pay, title: o.title, place: o.place, opening: o.id, business: o.business, shifts: o.shifts });
    }
    options.sort((a, b) => b.pay - a.pay);
    const seen = new Set(), picked = [];
    const most = Math.max(0, H.offers - this.priorsOf(p));
    for (const o of options) { const k = `${o.role}:${o.place.id}`; if (seen.has(o.role) || seen.has(k)) continue; seen.add(o.role); seen.add(k); picked.push(o); if (picked.length >= most) break; }
    const S = BR(this).staff;
    p.job_offers = picked.map((o) => ({ ...o, id: this.id("recruit"), fee: Math.round(o.pay * S.month_hours * H.fee_share), expires: this.now + H.expire_days * DAY }));
    return { offers: p.job_offers };
  };
  //: Taking a recruiter's offer: the job, and the recruiter's fee from your pay as it comes.
  W.cmd_take_offer = function (pid, { offer }) {
    const p = this.player(pid), o = (p.job_offers || []).find((x) => x.id === offer && x.expires > this.now);
    if (!o) fail("that offer has gone");
    this.recordCheck(p, o.role);
    if (o.opening) {
      const r = this.cmd_accept_employment(pid, { opening: o.opening });
      p.job.fee_due = { agency: this.ledger.open("firm:staffing", "business"), left: o.fee };
      p.job_offers = [];
      return r;
    }
    if (p.clocked) this.cmd_clock_out(pid);
    this.leaveStaff(p);
    p.job = { role: o.role, title: o.title, pay: o.pay, level: o.level, place: { id: o.place.id, x: o.place.x, z: o.place.z, name: o.place.name || null },
      employer: `business:${o.place.id}`, fee_due: { agency: this.ledger.open("firm:staffing", "business"), left: o.fee } };
    this.ledger.open(p.job.employer, "business");
    p.job_offers = [];
    this.log("hired", { player: pid, role: o.role, recruiter: true });
    return { job: p.job };
  };
  W.cmd_dismiss_offer = function (pid, { offer }) { const p = this.player(pid); p.job_offers = (p.job_offers || []).filter((x) => x.id !== offer); return {}; };
}

// ---- small helpers ------------------------------------------------------------------------------------
function freshDay(day) { return { day, visits: 0, wanted: 0, served: 0, lost: 0, sales: 0, tax: 0, cogs: 0, units: 0, stockout: 0, clean_need: 0, clean_done: 0, understaffed: 0, late_open: 0, wages: {}, rent: 0, fees: 0, ordered: 0 }; }
function hourFloor(ms) { return Math.floor(ms / HOUR) * HOUR; }
//: The next time it is ``hour`` o'clock in the city after ``now`` (the next morning's delivery).
function nextHourAt(now, t, hour) {
  const midnight = now - t.minute * 60_000;
  const today = midnight + hour * HOUR;
  return today > now ? today : today + DAY;
}
function dayEnd(now, t) { return now - t.minute * 60_000 + DAY; }
function jurisdictionChain(w, place) {
  if (place.lon === undefined) return [];
  try { return w.where({ lon: place.lon, lat: place.lat, county: place.county }).chain; } catch { return []; }
}
