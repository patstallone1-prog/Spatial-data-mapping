// The living city's rules and books, with nothing drawn: the currency, the clock, which city and
// county a place is in, every tax, the ledger, bills and notices, who owns and who holds what,
// bridge tolls and managed lanes, and the water. Pure -- the viewer draws from it, and Node
// tests it (tests/city_core.test.mjs). The rules themselves are data: docs/city/rules.json, the
// same file the Python core reads (smc.city.rules).
//
// Every amount is an integer of the currency's smallest unit (cents of a Credit); the rules file
// writes them in whole Credits and loadRules converts them once.

export const SCHEMA = "kerbside.city_rules/1";

// ---- money ---------------------------------------------------------------------------------------

export function makeCurrency(spec) {
  const unit = 10 ** spec.minor_units;
  return {
    ...spec, unit,
    money: (amount) => Math.round(Number(amount) * unit),
    format(minor) {
      const sign = minor < 0 ? "-" : "";
      const whole = Math.abs(minor) / unit;
      return `${sign}${spec.symbol}${whole.toLocaleString("en-US", { minimumFractionDigits: spec.minor_units, maximumFractionDigits: spec.minor_units })}`;
    },
  };
}

const MONEY_KEYS = new Set(["balance", "room_rent_per_day", "standard_deduction", "wage_base", "additional_over",
  "fastrak", "invoice", "deposit", "low_balance", "top_up", "violation_fine", "express_no_tag_penalty", "base", "max",
  "meter_rate_per_hour", "expired_meter", "no_parking", "tow_fee", "storage_per_day", "at_100_mph", "price", "pay",
  "registration_fee", "chp_fee", "minimum_wage", "pretax_per_gallon", "state_excise_per_gallon",
  "federal_excise_per_gallon", "electric_per_kwh", "peak_per_km", "offpeak_per_km", "bus_fare", "taxi_flag", "taxi_per_km",
  "base_pay", "pay_per_km", "hospital_bill", "storefront_lease_per_week"]);

//: The rules file, checked, with every amount in minor units and lookups built.
export function loadRules(json) {
  if (json?.schema !== SCHEMA) throw new Error(`not ${SCHEMA}`);
  const cur = makeCurrency(json.currency);
  const R = structuredClone(json);
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (MONEY_KEYS.has(k) && typeof v === "number") o[k] = cur.money(v);
      else walk(v);
    }
  };
  for (const key of ["start", "tolls", "managed_lanes", "enforcement", "items", "transit", "delivery", "business"]) walk(R[key]);
  R.vitals.health.hospital_bill = cur.money(json.vitals.health.hospital_bill);
  walk(R.vehicles.models); walk(R.jobs); walk(R.taxes.income); walk(R.taxes.payroll);
  walk(R.taxes.vehicle); walk(R.taxes.fuel);
  for (const key of ["violation_penalties"]) R.tolls[key] = R.tolls[key].map(cur.money);
  R.taxes.vehicle.improvement_fee = json.taxes.vehicle.improvement_fee.map(([v, fee]) => [cur.money(v), cur.money(fee)]);
  for (const side of ["federal", "state"]) {
    R.taxes.income[side].brackets = json.taxes.income[side].brackets.map(([at, rate]) => [cur.money(at), rate]);
  }
  for (const spec of Object.values(R.taxes.transfer.city)) spec.tiers = spec.tiers.map(([at, rate]) => [cur.money(at), rate]);
  R.taxes.property.parcel_tax = Object.fromEntries(Object.entries(json.taxes.property.parcel_tax).map(([k, v]) => [k, cur.money(v)]));
  R.enforcement.speed_camera.tiers = json.enforcement.speed_camera.tiers.map(([mph, fine]) => [mph, cur.money(fine)]);
  R.fines = Object.fromEntries(Object.entries(json.fines).map(([k, v]) => [k, cur.money(v)]));
  R.currency = cur;
  R.money = cur.money;
  R.fmt = cur.format;
  return R;
}

// ---- the clock -----------------------------------------------------------------------------------

const PARTS = new Map();
//: The city's local time at ``ms``: the day (counted in local days), the minute of the day, the
//: weekday (0 Sunday) and the calendar, in the rules' time zone.
export function cityTime(ms, zone = "America/Los_Angeles") {
  let f = PARTS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric",
      day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    PARTS.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const year = +p.year, month = +p.month, date = +p.day, hour = +p.hour % 24, minute = +p.minute, second = +p.second;
  const day = Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { ms, year, month, date, hour, minute: hour * 60 + minute + second / 60, weekday, day,
    label: `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday]} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}
export const isWeekday = (t) => t.weekday >= 1 && t.weekday <= 5;
export function inHours(hours, t) {
  const h = t.minute / 60;
  return hours.some(([a, b]) => (a <= b ? h >= a && h < b : h >= a || h < b));
}

// ---- where a place is ----------------------------------------------------------------------------

//: The jurisdictions over (lon, lat), nearest first: city (if any), county, state, nation.
export function jurisdictionAt(R, lon, lat, fallbackCounty = null) {
  const J = R.jurisdictions;
  const city = J.cities.find((c) => lon >= c.box[0] && lat >= c.box[1] && lon <= c.box[2] && lat <= c.box[3]) || null;
  const county = city?.county || (fallbackCounty && `county:${String(fallbackCounty).replace(/^county:/, "").replace(/-county$/, "")}`) || "county:san-francisco";
  const chain = [city?.id, county, J.state, J.nation].filter(Boolean);
  const countyName = J.counties.find((c) => c.id === county)?.name || county;
  return { city: city?.id || null, county, chain, name: city ? city.name : `${countyName} County` };
}
//: The first value in ``table`` along a jurisdiction chain.
export function along(table, chain, fallback = undefined) {
  for (const id of chain) if (table && Object.prototype.hasOwnProperty.call(table, id)) return table[id];
  return fallback;
}

// ---- taxes ---------------------------------------------------------------------------------------

//: To the nearest minor unit, a half always up (as sales tax is rounded), and safe from the float
//: error that left 8.625% of 100.00 at 8.62.
export const roundHalfUp = (v) => Math.floor(v + 0.5 + 1e-7);
//: Tax on ``income`` (minor units) by marginal brackets [[from, rate], ...].
export function bracketTax(brackets, income) {
  let tax = 0;
  for (let i = 0; i < brackets.length; i += 1) {
    const [from, rate] = brackets[i];
    const to = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (income <= from) break;
    tax += (Math.min(income, to) - from) * rate;
  }
  return Math.round(tax);
}
//: A year's income tax on ``wages``: federal and state, each after its standard deduction.
export function incomeTax(R, wages) {
  const I = R.taxes.income;
  const federal = bracketTax(I.federal.brackets, Math.max(0, wages - I.federal.standard_deduction));
  const state = bracketTax(I.state.brackets, Math.max(0, wages - I.state.standard_deduction));
  return { federal, state, total: federal + state };
}
//: A year's payroll taxes on ``wages``.
export function payrollTax(R, wages) {
  const P = R.taxes.payroll;
  const social = Math.round(Math.min(wages, P.social_security.wage_base) * P.social_security.rate);
  const medicare = Math.round(wages * P.medicare.rate + Math.max(0, wages - P.medicare.additional_over) * P.medicare.additional_rate);
  const disability = Math.round(wages * P.state_disability.rate);
  return { social, medicare, disability, total: social + medicare + disability };
}
//: What to hold back from a paycheque of ``gross`` when ``ytd`` has been earned already this
//: year: the year's tax on everything to date, less the tax on what came before (the cumulative
//: method, so a year's withholding adds up to the year's tax however the pay arrives).
export function withholding(R, ytd, gross) {
  const a = incomeTax(R, ytd), b = incomeTax(R, ytd + gross);
  const pa = payrollTax(R, ytd), pb = payrollTax(R, ytd + gross);
  const out = { federal: b.federal - a.federal, state: b.state - a.state, social: pb.social - pa.social,
    medicare: pb.medicare - pa.medicare, disability: pb.disability - pa.disability };
  out.total = Object.values(out).reduce((s, v) => s + v, 0);
  out.net = gross - out.total;
  return out;
}
//: The sales tax rate in force along ``chain``, and a party's measures on top (``laws``).
export function salesRate(R, chain, laws = {}) {
  return Math.max(R.taxes.sales.state_base, along(R.taxes.sales.by_jurisdiction, chain, R.taxes.sales.state_base) + (laws.sales_rate_add || 0));
}
export function salesTax(R, chain, amount, kind = "taxable", laws = {}) {
  if (R.taxes.sales.exempt.includes(kind)) return 0;
  return roundHalfUp(amount * salesRate(R, chain, laws));
}
export function propertyTax(R, chain, assessed) {
  const P = R.taxes.property;
  const rate = along(P.total_rate, chain, P.base_rate);
  const ad_valorem = Math.round(assessed * rate);
  const parcel = along(P.parcel_tax, chain, 0);
  return { rate, ad_valorem, parcel, total: ad_valorem + parcel };
}
//: Transfer taxes when real estate sells for ``price``: the county's and the city's (on the whole
//: value at the rate of the tier it falls in, as San Francisco's and Oakland's are).
export function transferTax(R, chain, price) {
  const T = R.taxes.transfer;
  const county = Math.round(price * T.county_rate);
  const spec = along(T.city, chain, null);
  let city = 0;
  if (spec) {
    let rate = 0;
    for (const [from, r] of spec.tiers) if (price >= from) rate = r;
    city = Math.round(price * rate);
  }
  return { county, city, total: county + city };
}
//: A year's California vehicle fees on a car worth ``value``.
export function vehicleFees(R, value) {
  const V = R.taxes.vehicle;
  const license = Math.round(value * V.license_fee_rate);
  let improvement = 0;
  for (const [from, fee] of V.improvement_fee) if (value >= from) improvement = fee;
  return { license, registration: V.registration_fee, chp: V.chp_fee, improvement,
    total: license + V.registration_fee + V.chp_fee + improvement };
}
//: Fuel at the pump along ``chain``: a litre's price and what in it is tax.
export function fuelPrice(R, chain, laws = {}) {
  const F = R.taxes.fuel, gal = F.litres_per_gallon;
  const base = F.pretax_per_gallon + F.state_excise_per_gallon + F.federal_excise_per_gallon;
  const sales = base * salesRate(R, chain, laws);
  return { per_litre: Math.round((base + sales) / gal), excise_per_litre: Math.round((F.state_excise_per_gallon + F.federal_excise_per_gallon) / gal),
    sales_per_litre: Math.round(sales / gal), electric_per_kwh: F.electric_per_kwh };
}

// ---- the ledger ----------------------------------------------------------------------------------

export const ISSUER = "system:issuer";
export const MINT_REASONS = new Set(["starter_grant", "npc_wage", "npc_income", "external_trade", "public_contract", "import"]);
export const BURN_REASONS = new Set(["external_supplier", "vehicle_manufacture", "public_service", "fuel", "system_fee"]);

export class LedgerError extends Error {}

//: Double-entry books: every entry sums to zero and applies whole; no account but the issuer
//: goes below zero; a request with a key it has seen is the same request and pays once.
export class Ledger {
  constructor() { this.accounts = new Map([[ISSUER, { kind: "issuer", balance: 0 }]]); this.journal = []; this.keys = new Map(); this.seq = 0; }
  open(id, kind = "player") { if (!this.accounts.has(id)) this.accounts.set(id, { kind, balance: 0 }); return id; }
  balance(id) { return this.accounts.get(id)?.balance ?? 0; }
  post(lines, { kind = "transfer", memo = "", key = null, at = 0 } = {}) {
    if (key && this.keys.has(key)) return this.keys.get(key);
    let sum = 0;
    for (const [account, amount] of lines) {
      if (!Number.isInteger(amount)) throw new LedgerError(`not a whole amount: ${amount}`);
      if (!this.accounts.has(account)) throw new LedgerError(`no account ${account}`);
      sum += amount;
    }
    if (sum !== 0) throw new LedgerError("an entry must sum to zero");
    const after = new Map();
    for (const [account, amount] of lines) after.set(account, (after.get(account) ?? this.balance(account)) + amount);
    for (const [account, balance] of after) {
      if (balance < 0 && account !== ISSUER) throw new LedgerError(`${account} cannot pay ${-(balance - this.balance(account))}`);
    }
    for (const [account, balance] of after) this.accounts.get(account).balance = balance;
    const entry = { seq: ++this.seq, at, kind, memo, lines: lines.map(([a, v]) => [a, v]) };
    this.journal.push(entry);
    if (this.journal.length > 4000) this.journal.splice(0, this.journal.length - 3000);
    if (key) this.keys.set(key, entry);
    return entry;
  }
  transfer(from, to, amount, opts = {}) {
    if (from === ISSUER || to === ISSUER) throw new LedgerError("only mint and burn move the issuer's money");
    if (!(amount > 0)) throw new LedgerError("a transfer is of more than nothing");
    return this.post([[from, -amount], [to, amount]], opts);
  }
  //: A payment split several ways: [[to, amount], ...] from one payer, in one entry.
  pay(from, splits, opts = {}) {
    const lines = splits.filter(([, v]) => v > 0);
    const total = lines.reduce((s, [, v]) => s + v, 0);
    if (!total) return null;
    return this.post([[from, -total], ...lines], opts);
  }
  mint(to, amount, reason, opts = {}) {
    if (!MINT_REASONS.has(reason)) throw new LedgerError(`no money is made for ${reason}`);
    return this.post([[ISSUER, -amount], [to, amount]], { kind: `mint:${reason}`, ...opts });
  }
  burn(from, amount, reason, opts = {}) {
    if (!BURN_REASONS.has(reason)) throw new LedgerError(`no money is destroyed for ${reason}`);
    return this.post([[from, -amount], [ISSUER, amount]], { kind: `burn:${reason}`, ...opts });
  }
  supply() { return -this.balance(ISSUER); }
  check() {
    let sum = 0;
    for (const a of this.accounts.values()) sum += a.balance;
    if (sum !== 0) throw new LedgerError(`the books do not balance by ${sum}`);
  }
  toJSON() { return { seq: this.seq, accounts: [...this.accounts], journal: this.journal.slice(-400) }; }
  static fromJSON(o) {
    const l = new Ledger();
    l.accounts = new Map(o.accounts.map(([id, a]) => [id, { ...a }]));
    l.journal = o.journal || []; l.seq = o.seq || 0;
    l.check();
    return l;
  }
}

// ---- bills and notices ---------------------------------------------------------------------------

//: Tolls, fines, rent and taxes owed: each a bill with a payee, a due date and, if left unpaid,
//: the penalties that follow in turn.
export class Billing {
  constructor(ledger) { this.ledger = ledger; this.bills = new Map(); this.seq = 0; }
  issue({ payer, payee, kind, amount, memo = "", at, due_days = 21, penalties = [], evidence = [], key = null }) {
    if (key) for (const b of this.bills.values()) if (b.key === key) return b;
    const bill = { id: `bill:${++this.seq}`, payer, payee, kind, memo, amount, owed: amount, issued: at,
      due: at + due_days * 86_400_000, due_days, penalties: penalties.slice(), stage: 0, status: "open", evidence, key, paid: 0 };
    this.bills.set(bill.id, bill);
    return bill;
  }
  open(payer) { return [...this.bills.values()].filter((b) => b.payer === payer && b.status === "open"); }
  owed(payer) { return this.open(payer).reduce((s, b) => s + b.owed, 0); }
  pay(id, from, at = 0) {
    const bill = this.bills.get(id);
    if (!bill || bill.status !== "open") throw new LedgerError("no such bill open");
    const amount = Math.min(bill.owed, this.ledger.balance(from));
    if (amount <= 0) throw new LedgerError("nothing to pay it with");
    this.ledger.transfer(from, bill.payee, amount, { kind: `bill:${bill.kind}`, memo: bill.memo, at, key: `${id}:${bill.paid + amount}` });
    bill.owed -= amount; bill.paid += amount;
    if (bill.owed === 0) { bill.status = "paid"; bill.settled = at; }
    return bill;
  }
  //: Past their due date, unpaid bills move to their next notice: a penalty added, a new due date.
  sweep(at) {
    const changed = [];
    for (const bill of this.bills.values()) {
      if (bill.status !== "open" || at < bill.due) continue;
      if (bill.stage < bill.penalties.length) {
        bill.owed += bill.penalties[bill.stage];
        bill.stage += 1;
        bill.due = at + bill.due_days * 86_400_000;
        changed.push(bill);
      } else if (bill.status === "open" && !bill.collections) { bill.collections = true; changed.push(bill); }
    }
    return changed;
  }
  dismiss(id, at, reason) {
    const bill = this.bills.get(id);
    if (bill && bill.status === "open") { bill.status = "dismissed"; bill.settled = at; bill.reason = reason; }
    return bill;
  }
  toJSON() { return { seq: this.seq, bills: [...this.bills.values()] }; }
  static fromJSON(o, ledger) { const b = new Billing(ledger); b.seq = o.seq || 0; for (const x of o.bills || []) b.bills.set(x.id, { ...x }); return b; }
}

// ---- who owns and who holds what -----------------------------------------------------------------

export class PropertyError extends Error {}
//: Title and possession kept apart: an owner, whoever has it now, and on what terms (the
//: owner's, a loan, a lease, stolen, impounded). Every change is in the thing's history.
export class Registry {
  constructor(ledger) { this.ledger = ledger; this.assets = new Map(); }
  register(id, kind, owner, attrs = {}, at = 0) {
    if (this.assets.has(id)) throw new PropertyError(`${id} is registered already`);
    const a = { id, kind, owner, holder: owner, custody: "owner", attrs: { ...attrs }, history: [] };
    this.assets.set(id, a);
    this.note(a, "grant", null, owner, at);
    return a;
  }
  get(id) { const a = this.assets.get(id); if (!a) throw new PropertyError(`no ${id}`); return a; }
  note(a, kind, from, to, at, extra = {}) { a.history.push({ kind, from, to, at, ...extra }); if (a.history.length > 40) a.history.shift(); }
  owned(owner, kind = null) { return [...this.assets.values()].filter((a) => a.owner === owner && (!kind || a.kind === kind)); }
  held(holder) { return [...this.assets.values()].filter((a) => a.holder === holder); }
  //: A sale: title, money and its taxes in one entry, or nothing at all.
  sell(id, seller, buyer, price, { taxes = [], at = 0, key = null } = {}) {
    const a = this.get(id);
    if (a.owner !== seller) throw new PropertyError("only the owner sells it");
    if (a.custody !== "owner" || a.holder !== seller) throw new PropertyError("it must be back with its owner to be sold");
    const extra = taxes.reduce((s, [, v]) => s + v, 0);
    if (this.ledger.balance(buyer) < price + extra) throw new PropertyError("the buyer cannot pay");
    const entry = price > 0 || extra > 0 ? this.ledger.post([[buyer, -(price + extra)], ...(price > 0 ? [[seller, price]] : []), ...taxes.filter(([, v]) => v > 0)],
      { kind: "sale", memo: id, at, key }) : null;
    a.owner = a.holder = buyer; a.custody = "owner";
    this.note(a, "sale", seller, buyer, at, { price });
    return entry;
  }
  gift(id, owner, to, at = 0) {
    const a = this.get(id);
    if (a.owner !== owner || a.custody !== "owner") throw new PropertyError("only an owner holding it gives it away");
    a.owner = a.holder = to; this.note(a, "gift", owner, to, at);
  }
  lend(id, owner, to, until, at = 0) {
    const a = this.get(id);
    if (a.owner !== owner || a.custody !== "owner") throw new PropertyError("only an owner holding it lends it");
    a.holder = to; a.custody = "loan"; a.until = until; this.note(a, "loan", owner, to, at);
  }
  lease(id, owner, to, until, rent, at = 0) {
    const a = this.get(id);
    if (a.owner !== owner || a.custody !== "owner") throw new PropertyError("only an owner holding it leases it");
    if (rent > 0) this.ledger.transfer(to, owner, rent, { kind: "rent", memo: id, at });
    a.holder = to; a.custody = "lease"; a.until = until; this.note(a, "lease", owner, to, at, { rent });
  }
  giveBack(id, holder, at = 0) {
    const a = this.get(id);
    if (a.holder !== holder || !["loan", "lease"].includes(a.custody)) throw new PropertyError("only who borrowed it hands it back");
    a.holder = a.owner; a.custody = "owner"; delete a.until; this.note(a, "return", holder, a.owner, at);
  }
  take(id, taker, at = 0) {
    const a = this.get(id);
    if (["parcel", "building"].includes(a.kind)) throw new PropertyError("land is not carried off");
    if (a.holder === taker) throw new PropertyError("it is yours to hand already");
    const from = a.holder; a.holder = taker; a.custody = "stolen"; this.note(a, "theft", from, taker, at);
    return { owner: a.owner, from, taker };
  }
  recover(id, by, at = 0) { const a = this.get(id); a.holder = a.owner; a.custody = "owner"; this.note(a, "recovered", by, a.owner, at); }
  impound(id, by, reason, at = 0) { const a = this.get(id); a.holder = by; a.custody = "impounded"; this.note(a, "impound", a.owner, by, at, { reason }); }
  release(id, by, at = 0) { const a = this.get(id); if (a.custody !== "impounded") throw new PropertyError("not impounded"); a.holder = a.owner; a.custody = "owner"; this.note(a, "release", by, a.owner, at); }
  toJSON() { return [...this.assets.values()]; }
  static fromJSON(list, ledger) { const r = new Registry(ledger); for (const a of list || []) r.assets.set(a.id, structuredClone(a)); return r; }
}

// ---- bridge tolls --------------------------------------------------------------------------------

export function tollPlaza(R, name) {
  return R.tolls.plazas.find((p) => new RegExp(p.match, "i").test(name || "")) || null;
}
//: What one crossing costs: with or without a FasTrak tag, and as a carpool in the hours.
export function tollAmount(R, plaza, { fastrak, occupants = 1, time, laws = {} }) {
  let amount = fastrak ? plaza.fastrak : plaza.invoice;
  const pool = plaza.carpool;
  const hours = R.tolls.carpool_hours, weekday = !R.tolls.carpool_weekdays_only || isWeekday(time);
  const share = laws.toll_carpool_share ?? pool?.share;
  let carpool = false;
  if (pool && fastrak && occupants >= pool.occupants && weekday && inHours(hours, time)) { amount = Math.round(amount * share); carpool = true; }
  return { amount, carpool, authority: plaza.authority, name: plaza.name };
}
//: The gantries a car passed between two positions, in their tolled direction (each gantry is
//: on the carriageway that pays; its bearing is the way the traffic runs).
export function gantriesCrossed(gantries, a, b, reach) {
  const out = [];
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  if (len < 1e-6) return out;
  for (const g of gantries) {
    // The gantry as a line across the road, its normal along the traffic.
    const nx = Math.sin(g.bearing * Math.PI / 180), nz = -Math.cos(g.bearing * Math.PI / 180);
    const sa = (a.x - g.x) * nx + (a.z - g.z) * nz, sb = (b.x - g.x) * nx + (b.z - g.z) * nz;
    if (!(sa < 0 && sb >= 0)) continue;
    const t = sa / (sa - sb), px = a.x + dx * t, pz = a.z + dz * t;
    const across = Math.abs((px - g.x) * -nz + (pz - g.z) * nx);
    if (across <= Math.max(reach, (g.width || 0) / 2 + 4)) out.push(g);
  }
  return out;
}

// ---- carpool and express lanes -------------------------------------------------------------------

//: The managed lanes in page metres, found by position: which segment a car is on, how far across
//: it (from the left edge in the way's direction) and so which lane.
export class LaneIndex {
  constructor(R, lanes, project, cell = 200) {
    this.R = R; this.cell = cell; this.grid = new Map(); this.segments = [];
    for (const lane of lanes) {
      const pts = lane.p.map(([lon, lat]) => project(lon, lat));
      const seg = { ...lane, pts };
      this.segments.push(seg);
      for (let i = 1; i < pts.length; i += 1) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell / 2)));
        for (let k = 0; k <= steps; k += 1) {
          const key = `${Math.floor((ax + (bx - ax) * k / steps) / cell)},${Math.floor((az + (bz - az) * k / steps) / cell)}`;
          if (!this.grid.has(key)) this.grid.set(key, new Set());
          this.grid.get(key).add(seg);
        }
      }
    }
  }
  //: The managed segment a car at (x, z) heading ``heading`` (radians, as yaw: 0 = -z) is in a
  //: managed lane of, and which lane; null when it is in none.
  at(x, z, heading) {
    // The squares round about too: a carriageway's lanes reach past the square its line is in.
    const near = new Set();
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (const s of this.grid.get(`${cx + i},${cz + j}`) || []) near.add(s);
    if (!near.size) return null;
    const hx = -Math.sin(heading), hz = -Math.cos(heading);
    let best = null;
    for (const seg of near) {
      const width = seg.lanes * this.R.managed_lanes.lane_width_m;
      for (let i = 1; i < seg.pts.length; i += 1) {
        const [ax, az] = seg.pts[i - 1], [bx, bz] = seg.pts[i];
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
        if (len2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        const len = Math.sqrt(len2), ux = dx / len, uz = dz / len;
        if (ux * hx + uz * hz < 0.6) continue;  // driving the other way, or across
        // Left of the centreline is positive: the left normal of (ux, uz) in x-right, z-down.
        const side = (x - ax) * uz - (z - az) * ux;
        const along = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (along > width / 2 + 1) continue;
        const fromLeft = width / 2 - side;
        const lane = Math.max(0, Math.min(seg.lanes - 1, Math.floor(fromLeft / this.R.managed_lanes.lane_width_m)));
        const d = along;
        if (!best || d < best.d) best = { d, seg, lane, managed: seg.managed.includes(lane) };
      }
    }
    return best;
  }
  //: Whether a segment's lane is managed now (carpool hours), and what it asks of a car.
  rule(seg, time) {
    const hours = seg.hours;
    const active = !hours || ((!seg.weekdays || isWeekday(time)) && inHours(hours, time));
    return { active, kind: seg.kind, minimum: seg.min || this.R.managed_lanes.default_minimum };
  }
}
//: An express lane's price for ``km`` driven solo: by the hour's congestion, between the base
//: and the cap; carpools by their share.
export function expressPrice(R, time, km, occupants, minimum) {
  const E = R.managed_lanes.express;
  const peak = isWeekday(time) && inHours([[6, 9.5], [15.5, 19]], time);
  let price = Math.min(E.max, E.base + Math.round(km * (peak ? E.peak_per_km : E.offpeak_per_km)));
  if (occupants >= Math.max(3, minimum)) price = Math.round(price * E.hov3_share);
  else if (occupants >= 2 && minimum <= 2) price = 0;
  else if (occupants >= 2) price = Math.round(price * E.hov2_share);
  return price;
}

// ---- the water ----------------------------------------------------------------------------------

//: Which water this is. ``inland`` is a body the map closes in (a pond, a lake, a fountain's
//: basin); open water is the Bay or the ocean, told apart by where it is.
export function waterClass(R, { lon, lat, inland = false, basin = false, stream = false, name = "" }) {
  const W = R.water;
  if (basin) return "fountain";
  if (stream) return "fresh_stream";
  if (/reservoir/i.test(name)) return "reservoir";
  for (const zone of W.zones) {
    if (zone.names && new RegExp(zone.names, "i").test(name)) return zone.class;
  }
  if (inland) return "fresh_lake";
  for (const zone of W.zones) {
    if (!zone.box) continue;
    const [w, s, e, n] = zone.box;
    if (lon >= w && lon <= e && lat >= s && lat <= n) return zone.class;
  }
  return "bay";
}
//: Salinity, density (kg/m3) and how fast plain steel rusts there, relative to fresh water.
export function waterProperties(R, cls, { lon = null, lat = null } = {}) {
  const W = R.water, c = W.classes[cls] || W.classes.bay;
  let salinity = c.salinity;
  if (lon !== null) {
    for (const zone of W.zones) {
      if (zone.class !== cls || !zone.box || zone.salinity === undefined) continue;
      const [w, s, e, n] = zone.box;
      if (lon >= w && lon <= e && lat >= s && lat <= n) { salinity = zone.salinity; break; }
    }
  }
  const density = W.fresh_density + W.density_per_salinity * salinity;
  return { class: cls, name: c.name, salinity, density, corrosion: c.corrosion, colour: c.colour };
}
//: How a body of ``density`` (kg/m3) floats in water of ``water.density``: the share of it under
//: the surface (1 or more: it sinks), and the lift a cubic metre of it gets.
export function buoyancy(water, density) {
  const submerged = density / water.density;
  return { floats: submerged < 1, submerged: Math.min(1, submerged), net_n_per_m3: (water.density - density) * 9.81 };
}

// ---- health, stamina, strength -------------------------------------------------------------------

const HOUR = 3_600_000;
const clampBar = (R, v) => Math.max(0, Math.min(R.vitals.max, v));
//: A new arrival's bars.
export function newVitals(R, now) {
  return { ...R.vitals.start, at: now, day: null, walked: 0, worked_out: 0 };
}
//: The bars lived from ``v.at`` to ``to``: stamina down through the waking day (and faster at
//: work), back at night -- faster asleep at home or resting; health wearing slowly, quickly with
//: no stamina left, mending in sleep; strength fading. In steps of at most a quarter hour, by the
//: city's own clock. Time away (``away``) is lived as a day is: awake by day, at home by night.
export function vitalsStep(R, v, to, { home = false, resting = false, working = false, away = false } = {}) {
  const V = R.vitals;
  let t = Math.max(v.at ?? to, to - V.offline_catch_up_days * 86_400_000);
  const out = { ...v };
  while (t < to) {
    const dt = Math.min(HOUR / 4, to - t), h = dt / HOUR;
    const clock = cityTime(t + dt / 2, R.clock.zone);
    const night = inHours([V.night_hours], clock);
    const atHome = home || away;
    if (resting || night) {
      const rate = night && atHome ? V.stamina.home_recovery_per_hour : resting ? V.stamina.rest_recovery_per_hour : V.stamina.night_recovery_per_hour;
      out.stamina += rate * h;
      if (night && out.stamina > 0) out.health += V.health.sleep_recovery_per_hour * h;
    } else {
      out.stamina -= (V.stamina.awake_decay_per_hour + (working ? V.stamina.work_per_hour : 0)) * h;
    }
    out.health -= V.health.decay_per_day / 24 * h;
    if (out.stamina <= 0) out.health -= V.health.exhausted_loss_per_hour * h;
    out.strength = Math.max(V.strength.minimum, out.strength - V.strength.decay_per_day / 24 * h);
    out.stamina = clampBar(R, out.stamina); out.health = clampBar(R, out.health);
    t += dt;
  }
  out.at = Math.max(v.at ?? to, to);
  return out;
}
//: What using an item (or a service) does to the bars. A workout's strength is capped a day.
export function applyUse(R, v, use, { workout = false, day = null } = {}) {
  const out = { ...v };
  if (day !== null && out.day !== day) { out.day = day; out.walked = 0; out.worked_out = 0; }
  for (const bar of ["health", "stamina"]) if (use[bar]) out[bar] = clampBar(R, out[bar] + use[bar]);
  if (use.strength) {
    const room = workout ? Math.max(0, R.vitals.strength.workout_daily_cap - (out.worked_out || 0)) : use.strength;
    const gain = Math.min(use.strength, room);
    out.strength = clampBar(R, out.strength + gain);
    if (workout) out.worked_out = (out.worked_out || 0) + gain;
  }
  return out;
}
//: Effort since the last report: metres walked build a little strength (capped a day), seconds of
//: sprinting cost stamina.
export function applyExertion(R, v, { walked_m = 0, sprint_s = 0, day = null } = {}) {
  const S = R.vitals;
  const out = { ...v };
  if (day !== null && out.day !== day) { out.day = day; out.walked = 0; out.worked_out = 0; }
  const gain = Math.min(walked_m / 1000 * S.strength.walk_per_km, Math.max(0, S.strength.walk_daily_cap - (out.walked || 0)));
  out.walked = (out.walked || 0) + gain;
  out.strength = clampBar(R, out.strength + gain);
  out.stamina = clampBar(R, out.stamina - sprint_s * S.stamina.sprint_per_second);
  return out;
}
//: How the bars let you move: slowed when spent, and whether you may sprint.
export function walkFactor(R, v, sprinting) {
  const S = R.vitals.stamina;
  if (v.stamina < S.low) return { factor: S.slow_factor, sprint: false };
  return sprinting ? { factor: S.sprint_factor, sprint: true } : { factor: 1, sprint: false };
}
//: How many kilograms you can carry: by strength, more with a backpack.
export function carryCapacity(R, strength, inventory = {}) {
  const C = R.vitals.carry;
  let extra = 0;
  for (const [id, n] of Object.entries(inventory)) if (n > 0 && R.items[id]?.carry_kg) extra = Math.max(extra, R.items[id].carry_kg);
  return C.base_kg + strength * C.per_strength_kg + extra;
}
export function carriedKg(R, inventory = {}) {
  let kg = 0;
  for (const [id, n] of Object.entries(inventory)) kg += (R.items[id]?.kg || 0) * n;
  return Math.round(kg * 100) / 100;
}

// ---- stores ------------------------------------------------------------------------------------

//: The stores in a place, by its keys (shop:cafe, use:restaurant, ...): [{kind, name, items}].
export function storesAt(R, keys) {
  const have = new Set(keys);
  return Object.entries(R.stores.kinds).filter(([, s]) => s.at.some((k) => have.has(k)))
    .map(([kind, s]) => ({ kind, name: s.name, items: s.items.filter((id) => R.items[id]) }));
}
//: The store kinds a tenant's name tells (a clinic, a gym), where the map's tag does not.
export function tenantKinds(R, name) {
  if (!name) return [];
  return Object.entries(R.stores.names).filter(([, pattern]) => new RegExp(`\\b(${pattern})`, "i").test(name)).map(([kind]) => kind);
}
//: The tax on an item bought where ``chain`` holds: sales tax by its kind, or the hotel tax.
export function itemTax(R, chain, item, amount, laws = {}) {
  if (item.tax === "hotel_tax") return roundHalfUp(amount * along(R.taxes.local.hotel_tax, chain, 0));
  return salesTax(R, chain, amount, item.kind, laws);
}
