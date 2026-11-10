// The party's world: one authoritative set of books, records and laws that every player in a
// party acts on through ``submit(player, command, args)`` -- held by one browser (the party's
// host, or yours alone) and shown to the rest. Pure, as core.mjs is (tests/city.test.mjs).
//
// It follows the Python core (smc.city.world) and adds what the viewer needs: jobs at the
// buildings in front of you and pay with tax withheld, shopping with sales tax, cars with their
// fees, bridge tolls by FasTrak or invoice, carpool and express lanes, speed cameras, parking,
// bills that turn into notices, real estate with its transfer and property taxes, measures a
// party can vote into force within the platform's limits -- and a body: health, stamina and
// strength, what you carry, the shops' wares and services, things on the pavement to pick up, bus
// and taxi rides and delivery gigs.

import {
  Billing, Ledger, LedgerError, PropertyError, Registry, applyExertion, applyUse, carriedKg, carryCapacity, cityTime, expressPrice,
  fuelPrice, incomeTax, itemTax, jurisdictionAt, newVitals, payrollTax, propertyTax, salesRate, salesTax, shiftTask, storesAt, strikeEnergy,
  strikeWear, tollAmount, transferTax, vehicleFees, vitalsStep, withholding,
} from "./core.mjs";
import { homePrices, mortgageTerms, neighbourhoodAt } from "./market.mjs";
import { hash32 as hash, rng } from "./people.mjs";
import { injuryFor, vehicleDamage, vehicleState } from "./fleet.mjs";
import { canLift, swingOf, throwOf } from "./handling.mjs";

const rngOnce = (...parts) => rng(...parts)();
//: What a vehicle weighs (kg), for the energy of its impact, by its kind.
const VEHICLE_KG = { car: 1500, truck: 2600, van: 2500, bus: 13000 };

export const AUTHORITIES = {
  "authority:bata": "Bay Area Toll Authority",
  "authority:ggbhtd": "Golden Gate Bridge District",
  "authority:express": "Bay Area Express Lanes",
  "authority:sfmta": "Municipal Transportation Agency",
  "authority:dmv": "California DMV",
  "authority:ftb": "Franchise Tax Board",
  "authority:irs": "Internal Revenue Service",
  "authority:ssa": "Social Security and Medicare",
  "authority:edd": "Employment Development Department",
  "authority:court": "Superior Court",
};
const DAY = 86_400_000;

export class CityError extends Error {}

export class CityWorld {
  constructor(R, { now = Date.now(), seed = "city" } = {}) {
    this.R = R; this.seed = seed; this.now = now;
    this.ledger = new Ledger(); this.billing = new Billing(this.ledger); this.registry = new Registry(this.ledger);
    this.players = new Map(); this.offers = new Map(); this.measures = new Map(); this.laws = {}; this.events = [];
    this.items = new Map(); this.found = new Set();   // things on the ground; found things already picked up
    this.damage = new Map();                           // things struck: how much they have taken, and broken ones
    this.market = { taken: new Set() };                // homes bought or let off the market
    this.harm = new Map();                             // people hurt and cars damaged: the city's residents', and what became of them
    this.seq = 0; this.lastStep = now;
    for (const id of Object.keys(AUTHORITIES)) this.ledger.open(id, "authority");
    for (const c of R.jurisdictions.cities) this.ledger.open(`treasury:${c.id}`, "treasury");
    for (const c of R.jurisdictions.counties) this.ledger.open(`treasury:${c.id}`, "treasury");
    this.ledger.open(`treasury:${R.jurisdictions.state}`, "treasury");
    this.ledger.open("business:dealership", "business");
    this.ledger.open("business:landlords", "business");
    this.ledger.open("business:fuel", "business");
    this.ledger.open("business:taxi", "business");
    this.ledger.open("business:hospital", "business");
    this.ledger.open("business:bank", "business");
    this.ledger.open("business:residents", "business");
  }
  get time() { return cityTime(this.now, this.R.clock.zone); }
  id(prefix) { return `${prefix}:${(++this.seq).toString(36)}`; }
  log(kind, data = {}) { const e = { t: this.now, kind, ...data }; this.events.push(e); if (this.events.length > 300) this.events.shift(); return e; }
  treasury(id) { return `treasury:${id}`; }
  player(pid) { const p = this.players.get(pid); if (!p) throw new CityError("join the city first"); return p; }
  where(p) { return jurisdictionAt(this.R, p.lon ?? -122.4194, p.lat ?? 37.7749, p.county); }

  //: Every command a player can send. Unknown commands, and anything a player may not do, come
  //: back as {ok: false, error}; nothing is thrown at the caller.
  submit(pid, command, args = {}) {
    const fn = this[`cmd_${command}`];
    if (typeof fn !== "function" || !COMMANDS.has(command)) return { ok: false, error: `no such command: ${command}` };
    if (command !== "join" && !this.players.has(pid)) return { ok: false, error: "join the city first" };
    if (this.players.has(pid)) {
      const p = this.players.get(pid);
      if (args.at) Object.assign(p, pick(args.at, ["x", "z", "lon", "lat", "county"]));
      p.seen = this.now;
    }
    try {
      const result = { ok: true, ...(fn.call(this, pid, args) || {}) };
      const p = this.players.get(pid);
      if (p) handsCheck(p);
      return result;
    }
    catch (error) {
      if (error instanceof CityError || error instanceof LedgerError || error instanceof PropertyError) return { ok: false, error: error.message };
      throw error;
    }
  }

  // ---- arriving -------------------------------------------------------------------------------
  cmd_join(pid, { name = "Player", home = null, at = {} } = {}) {
    if (this.players.has(pid)) throw new CityError("already here");
    const account = this.ledger.open(`player:${pid}`, "player");
    this.ledger.mint(account, this.R.start.balance, "starter_grant", { at: this.now, key: `grant:${pid}` });
    const p = { id: pid, name, account, joined: this.now, resident_since: this.now, home: null, job: null, clocked: null,
      ytd: { year: this.time.year, wages: 0, withheld: 0 }, fastrak: null, driving: null, parked: {}, ...pick(at, ["x", "z", "lon", "lat", "county"]),
      vitals: newVitals(this.R, this.now), inventory: {}, worn: {}, resting: false, seen: this.now, delivery: null, ride: null, fainted: null, rx: 0,
      hands: null, errand: null, mortgages: [], lease: null, injuries: [], task: null };
    this.players.set(pid, p);
    if (home) {
      // A room in the building you start beside, its first week free (rent after: rent_due).
      const room = `room:${home.id}:${pid}`;
      this.registry.register(room, "room", "business:landlords", { building: home.id, address: home.name || null }, this.now);
      this.registry.lease(room, "business:landlords", account, this.now + this.R.start.free_room_days * DAY, 0, this.now);
      p.home = { room, building: home.id, x: home.x, z: home.z, paid_until: this.now + this.R.start.free_room_days * DAY };
    }
    this.log("join", { player: pid });
    return { balance: this.ledger.balance(account), home: p.home };
  }
  //: A player's saved self from their own browser, brought into a party's world: the same
  //: balance (minted once as an import), the vehicles and the job.
  cmd_import(pid, { saved }) {
    const p = this.player(pid);
    if (p.imported || !saved) throw new CityError("nothing to bring");
    const extra = Math.max(0, Math.min(saved.balance | 0, 5_000_000_00) - this.ledger.balance(p.account));
    if (extra) this.ledger.mint(p.account, extra, "import", { at: this.now, key: `import:${pid}` });
    for (const v of saved.vehicles || []) {
      if (this.registry.assets.has(v.id) || !this.R.vehicles.models[v.attrs?.model]) continue;
      this.registry.register(v.id, "vehicle", p.account, v.attrs, this.now);
    }
    if (saved.job) p.job = saved.job;
    if (saved.fastrak) { p.fastrak = { ...saved.fastrak, balance: 0 }; }
    if (saved.vitals) p.vitals = { ...p.vitals, ...pick(saved.vitals, ["health", "stamina", "strength", "at", "day", "walked", "worked_out"]) };
    for (const [id, n] of Object.entries(saved.inventory || {})) if (this.R.items[id] && !this.R.items[id].parcel) p.inventory[id] = Math.min(50, n | 0);
    p.imported = true;
    return this.cmd_status(pid);
  }
  cmd_status(pid) {
    const p = this.player(pid);
    const here = this.where(p);
    return {
      name: p.name, balance: this.ledger.balance(p.account), owed: this.billing.owed(p.account), where: here.name, chain: here.chain,
      home: p.home, job: p.job, clocked: p.clocked, fastrak: p.fastrak, ytd: p.ytd, driving: p.driving,
      vehicles: this.registry.owned(p.account, "vehicle").map(slim), holds: this.registry.held(p.account).map(slim),
      properties: this.registry.owned(p.account, "building").map(slim), bills: this.billing.open(p.account),
      sales_rate: salesRate(this.R, here.chain, this.laws), resident_days: (this.now - p.resident_since) / DAY,
      vitals: p.vitals, inventory: p.inventory, worn: p.worn, carry: this.carry(p), resting: p.resting, delivery: p.delivery, ride: p.ride, fainted: p.fainted,
      hands: p.hands, errand: p.errand, mortgages: p.mortgages || [], lease: p.lease, homes: this.registry.owned(p.account, "home").map(slim),
    };
  }
  carry(p) { return { kg: carriedKg(this.R, p.inventory), capacity: Math.round(carryCapacity(this.R, p.vitals.strength, p.inventory) * 10) / 10 }; }

  // ---- work -----------------------------------------------------------------------------------
  cmd_take_job(pid, { role, place }) {
    const spec = this.R.jobs.roles[role];
    if (!spec || !this.R.jobs.player_jobs.includes(role)) throw new CityError("that job is not open to players");
    if (!place?.id || !spec.at.some((k) => (place.keys || []).includes(k))) throw new CityError(`a ${spec.title.toLowerCase()} works at ${spec.at.join(" or ")}`);
    const p = this.player(pid);
    p.job = { role, title: spec.title, pay: spec.pay, place: { id: place.id, x: place.x, z: place.z, name: place.name || null }, employer: `business:${place.id}` };
    this.ledger.open(p.job.employer, "business");
    this.log("hired", { player: pid, role });
    return { job: p.job };
  }
  cmd_quit_job(pid) { const p = this.player(pid); if (p.clocked) this.cmd_clock_out(pid); p.job = null; return {}; }
  cmd_clock_in(pid, args = {}) {
    const p = this.player(pid);
    if (!p.job) throw new CityError("no job to go to");
    if (Math.hypot((p.x ?? 1e9) - p.job.place.x, (p.z ?? 1e9) - p.job.place.z) > this.R.jobs.workplace_reach_m) throw new CityError("go to work first");
    p.clocked = { since: this.now, paid_to: this.now, spots: args.spots || null, task: null, next_task: this.now + 8000, done: 0, idle: 0, tasks_total: 0 };
    return { clocked: p.clocked };
  }
  cmd_clock_out(pid) {
    const p = this.player(pid);
    if (!p.clocked) throw new CityError("not at work");
    this.payWork(p, true);
    p.clocked = null;
    return { balance: this.ledger.balance(p.account) };
  }
  //: Pay for the time worked since the last pay: by the employer, out of what the business takes
  //: in (minted as its takings, since the NPC economy is not yet one book with the players'), with
  //: income and payroll taxes withheld by the cumulative method.
  payWork(p, final = false) {
    if (!p.clocked || !p.job) return null;
    const every = this.R.jobs.pay_every_minutes * 60_000;
    const span = this.now - p.clocked.paid_to;
    if (!final && span < every) return null;
    if (Math.hypot((p.x ?? 1e9) - p.job.place.x, (p.z ?? 1e9) - p.job.place.z) > this.R.jobs.workplace_reach_m * 2) {
      // Walked off the job: paid to now and clocked out.
      final = true;
    }
    // Pay is for work done: a stretch with no task done earns nothing, and three in a row send you home.
    const windows = Math.max(1, Math.floor(span / every));
    const worked = (p.clocked.done || 0) > 0;
    p.clocked.done = 0;
    p.clocked.idle = worked ? 0 : (p.clocked.idle || 0) + windows;
    let sentHome = false;
    if (!worked && p.clocked.idle >= this.R.work_tasks.idle_windows_to_dismiss) { final = true; sentHome = true; }
    const gross = worked ? Math.round(p.job.pay * span / 3_600_000) : 0;
    p.clocked.paid_to = this.now;
    if (final) { p.clocked = null; if (sentHome) { p.sent_home = this.now; this.log("sent_home", { player: p.id }); } }
    if (gross <= 0) return null;
    const year = this.time.year;
    if (p.ytd.year !== year) p.ytd = { year, wages: 0, withheld: 0 };
    const w = withholding(this.R, p.ytd.wages, gross);
    const employer = p.job.employer;
    this.ledger.mint(employer, gross, "npc_income", { at: this.now, memo: "takings" });
    const here = this.where(p);
    this.ledger.post([[employer, -gross], [p.account, w.net], ["authority:irs", w.federal], ["authority:ftb", w.state],
      ["authority:ssa", w.social + w.medicare], ["authority:edd", w.disability]].filter(([, v]) => v !== 0),
      { kind: "wage", memo: `${p.job.title}, ${(span / 60_000).toFixed(0)} min`, at: this.now });
    p.ytd.wages += gross; p.ytd.withheld += w.total;
    this.log("paid", { player: p.id, gross, net: w.net, where: here.name });
    return { gross, ...w };
  }

  // ---- buying, carrying, using -----------------------------------------------------------------
  //: Buying at a store in ``place``: ``qty`` of an item it sells, with its tax. A service (a
  //: doctor's visit, a workout, a haircut, a night's stay) is had there and then; anything else is
  //: carried if you can carry it, or eaten or used on the spot with ``use``.
  cmd_buy(pid, { item, place, qty = 1, use = false }) {
    const spec = this.R.items[item];
    if (!spec || spec.parcel) throw new CityError(`nothing called ${item} is sold`);
    const store = storesAt(this.R, place?.keys || []).find((st) => st.items.includes(item));
    if (!store) throw new CityError(`${spec.name.toLowerCase()} is not sold here`);
    const p = this.player(pid);
    if (place.x !== undefined && p.x !== undefined && Math.hypot(p.x - place.x, p.z - place.z) > this.R.stores.reach_m * 2) throw new CityError("walk up to the shop first");
    qty = Math.max(1, Math.min(spec.service ? 1 : 20, qty | 0));
    if (spec.needs === "prescription" && (p.rx || 0) < qty) throw new CityError("that needs a doctor's prescription: see a doctor at a clinic first");
    if (spec.workout && p.vitals.stamina < Math.abs(spec.use?.stamina || 0)) throw new CityError("too tired to work out: eat something or rest first");
    const consumed = Boolean(spec.service || (use && spec.use));
    if (!consumed) {
      const c = this.carry(p);
      if (c.kg + (spec.kg || 0) * qty > c.capacity) throw new CityError(`too heavy to carry: ${c.kg} of ${c.capacity} kg already (strength carries more)`);
    }
    const here = this.where(p);
    const price = spec.price * qty;
    const tax = itemTax(this.R, here.chain, spec, price, this.laws);
    const shop = this.ledger.open(`business:${place.id}`, "business");
    this.ledger.pay(p.account, [[shop, price], [this.treasury(here.city || here.county), tax]].filter(([, v]) => v > 0),
      { kind: "purchase", memo: `${qty > 1 ? qty + " x " : ""}${spec.name}`, at: this.now });
    if (spec.needs === "prescription") p.rx -= qty;
    let effect = null;
    if (consumed) for (let i = 0; i < qty; i += 1) effect = this.useEffect(p, spec);
    else p.inventory[item] = (p.inventory[item] || 0) + qty;
    if (spec.grants === "prescription") p.rx = (p.rx || 0) + 2;
    this.log("purchase", { player: pid, item, qty, price, store: store.kind });
    return { item, qty, price, tax, rate: salesRate(this.R, here.chain, this.laws), store: store.name, effect, vitals: p.vitals, carry: this.carry(p) };
  }
  useEffect(p, spec) {
    const before = p.vitals;
    p.vitals = applyUse(this.R, before, spec.use || {}, { workout: Boolean(spec.workout), day: this.time.day });
    return Object.fromEntries(["health", "stamina", "strength"].map((k) => [k, Math.round((p.vitals[k] - before[k]) * 10) / 10]).filter(([, d]) => d));
  }
  //: Using what you carry: food and drink, medicine -- or putting on clothes. Tools are kept for
  //: building and repairs.
  //: What a blow with your hands is: fists, the tool you hold, or another thing held, swung
  //: (handling.mjs swingOf: soft things and two-handed lumps do not swing).
  blowWith(p) {
    const held = p.hands && p.inventory[p.hands] > 0 ? p.hands : null;
    const sw = swingOf(this.R, held, p.vitals.strength);
    if (!sw.ok) throw new CityError(sw.reason);
    return sw;
  }
  //: A fragile thing that hit something breaks: one fewer, and what it breaks into on the ground.
  shatter(p, item) {
    const spec = this.R.items[item];
    take(p.inventory, item, 1); handsCheck(p);
    const into = this.R.handling.materials[spec?.material_of]?.breaks_to;
    if (into && this.R.items[into] && into !== item) {
      const id = this.id("item");
      this.items.set(id, { id, item: into, qty: 1, x: p.x ?? 0, z: p.z ?? 0, by: "debris", at: this.now });
    }
  }
  //: A throw of what is in your hand toward ``to`` (where the viewer worked out it lands), and
  //: anyone it hit on the way. It lands there whole, breaks (glass, a pot) or spills (a drink).
  cmd_throw(pid, { item = null, to, hit = null, witnesses = 0 } = {}) {
    const p = this.player(pid);
    item = item || p.hands;
    if (!item || !(p.inventory[item] > 0)) throw new CityError("nothing in your hand to throw: pick something on the bar (1-8)");
    if (this.R.items[item]?.parcel) throw new CityError("the parcel is someone's delivery: hand it over, do not throw it");
    const t = throwOf(this.R, item, p.vitals.strength);
    if (!t.ok) throw new CityError(t.reason);
    if (!to || !Number.isFinite(to.x) || !Number.isFinite(to.z)) throw new CityError("throw where?");
    // No further than the throw goes (with a little slack for a slope).
    const d = p.x === undefined ? 0 : Math.hypot(to.x - p.x, to.z - p.z);
    if (d > t.range * 1.3 + 2) to = { x: p.x + (to.x - p.x) * (t.range / d), z: p.z + (to.z - p.z) * (t.range / d) };
    take(p.inventory, item, 1); handsCheck(p);
    for (const slot of Object.keys(p.worn)) if (p.worn[slot] === item && !p.inventory[item]) p.worn[slot] = null;
    p.vitals = { ...p.vitals, stamina: Math.max(0, p.vitals.stamina - (0.3 + t.energy / 300)) };
    const out = { item, speed: t.speed, energy: Math.round(t.energy), lands: t.lands, at: to };
    const landed = t.lands === "whole" ? item : t.lands === "breaks" ? t.breaksTo : null;
    if (landed && this.R.items[landed]) {
      const id = this.id("item");
      this.items.set(id, { id, item: landed, qty: 1, x: to.x, z: to.z, by: pid, at: this.now });
      if (this.items.size > 400) this.items.delete(this.items.keys().next().value);
      out.dropped = id; out.landed = landed;
    }
    if (hit?.id) out.hit = this.cmd_strike_person(pid, { npc: hit, witnesses, thrown: { item, joules: t.energy } });
    this.log("throw", { player: pid, item, lands: t.lands, hit: hit?.id || null });
    return out;
  }
  //: The shop's checkout: everything in the basket at once, with the sales tax, if you can pay for
  //: all of it and carry it; else nothing is bought.
  cmd_checkout(pid, { place, cart = [] } = {}) {
    const p = this.player(pid);
    const lines = (cart || []).map((l) => ({ item: l.item, qty: Math.max(1, Math.min(20, l.qty | 0)) })).filter((l) => this.R.items[l.item]);
    if (!lines.length) throw new CityError("the basket is empty");
    if (place?.x !== undefined && p.x !== undefined && Math.hypot(p.x - place.x, p.z - place.z) > this.R.stores.reach_m * 2) throw new CityError("walk up to the shop first");
    const stores = storesAt(this.R, place?.keys || []);
    const here = this.where(p);
    let price = 0, tax = 0, kg = 0;
    for (const l of lines) {
      const spec = this.R.items[l.item];
      if (spec.parcel || !stores.some((st) => st.items.includes(l.item))) throw new CityError(`${spec.name.toLowerCase()} is not sold here`);
      if (spec.needs === "prescription" && (p.rx || 0) < l.qty) throw new CityError(`${spec.name.toLowerCase()} needs a doctor's prescription: see a doctor at a clinic first`);
      if (spec.service) l.qty = 1;
      l.price = spec.price * l.qty; l.tax = itemTax(this.R, here.chain, spec, l.price, this.laws);
      price += l.price; tax += l.tax;
      if (!spec.service) {
        kg += (spec.kg || 0) * l.qty;
        const lift = canLift(this.R, l.item, p.vitals.strength);
        if (!lift.ok) throw new CityError(lift.reason);
      }
    }
    const c = this.carry(p);
    if (c.kg + kg > c.capacity) throw new CityError(`too heavy to carry it all: ${c.kg} of ${c.capacity} kg already, and the basket is ${Math.round(kg * 10) / 10} kg`);
    const balance = this.ledger.balance(p.account);
    if (balance < price + tax) throw new CityError(`not enough credits: the total is ${this.R.fmt(price + tax)} and you have ${this.R.fmt(balance)}`);
    const shop = this.ledger.open(`business:${place.id}`, "business");
    this.ledger.pay(p.account, [[shop, price], [this.treasury(here.city || here.county), tax]].filter(([, v]) => v > 0),
      { kind: "purchase", memo: lines.map((l) => `${l.qty > 1 ? l.qty + " x " : ""}${this.R.items[l.item].name}`).join(", ").slice(0, 120), at: this.now });
    const effects = [];
    for (const l of lines) {
      const spec = this.R.items[l.item];
      if (spec.service) { effects.push([l.item, this.useEffect(p, spec)]); if (spec.grants === "prescription") p.rx = (p.rx || 0) + 2; }
      else p.inventory[l.item] = (p.inventory[l.item] || 0) + l.qty;
      if (spec.needs === "prescription") p.rx -= l.qty;
    }
    this.log("checkout", { player: pid, lines: lines.length, price, tax });
    return { lines, price, tax, total: price + tax, effects, balance: this.ledger.balance(p.account), carry: this.carry(p), vitals: p.vitals };
  }
  cmd_use(pid, { item }) {
    const p = this.player(pid);
    const spec = this.R.items[item];
    if (!spec || !(p.inventory[item] > 0)) throw new CityError("you are not carrying that");
    if (spec.wear) {
      const was = p.worn[spec.wear];
      p.worn[spec.wear] = was === item ? null : item;
      return { worn: p.worn, wearing: p.worn[spec.wear] === item };
    }
    if (!spec.use) throw new CityError(spec.tool ? `a ${spec.name.toLowerCase()} is kept for ${spec.tool === "build" ? "building" : spec.tool === "repair" ? "repairs" : spec.tool}: carry it` : `nothing to do with ${spec.name.toLowerCase()} but carry it`);
    take(p.inventory, item, 1);
    const effect = this.useEffect(p, spec);
    return { item, effect, vitals: p.vitals };
  }
  //: Putting something down where you stand, for anyone to pick up.
  cmd_drop(pid, { item, qty = 1 }) {
    const p = this.player(pid);
    const spec = this.R.items[item];
    qty = Math.max(1, qty | 0);
    if (!spec || !(p.inventory[item] >= qty)) throw new CityError("you are not carrying that");
    if (spec.parcel) throw new CityError("the parcel is someone's delivery: hand it over, or cancel the gig");
    take(p.inventory, item, qty);
    for (const slot of Object.keys(p.worn)) if (p.worn[slot] === item && !p.inventory[item]) p.worn[slot] = null;
    const id = this.id("item");
    this.items.set(id, { id, item, qty, x: p.x ?? 0, z: p.z ?? 0, by: pid, at: this.now });
    if (this.items.size > 400) this.items.delete(this.items.keys().next().value);
    return { dropped: id };
  }
  //: Picking up what lies within reach: something dropped, or a thing found on the pavement
  //: (``found``: the district's own, seeded by its day; each is picked up once).
  cmd_pick_up(pid, { id, found = null }) {
    const p = this.player(pid);
    let thing = this.items.get(id);
    if (!thing && found) {
      if (this.found.has(found.id)) throw new CityError("someone has picked that up already");
      // Found on the pavement, or a part a crash left in the road.
      const debris = Object.values(this.R.found.debris || {});
      if (!this.R.found.items.includes(found.item) && !debris.includes(found.item)) throw new CityError("nothing like that lies here");
      thing = { id: found.id, item: found.item, qty: 1, x: found.x, z: found.z, found: true };
    }
    if (!thing) throw new CityError("nothing there to pick up");
    if (Math.hypot((p.x ?? 1e9) - thing.x, (p.z ?? 1e9) - thing.z) > 4) throw new CityError("too far to reach");
    const c = this.carry(p);
    // One thing too heavy for you to lift at all, or more than you can carry with the rest.
    const lift = canLift(this.R, thing.item, p.vitals.strength, c.kg, c.capacity, thing.qty);
    if (!lift.ok) throw new CityError(lift.reason);
    p.inventory[thing.item] = (p.inventory[thing.item] || 0) + thing.qty;
    if (thing.found) { this.found.add(thing.id); if (this.found.size > 2000) this.found.delete(this.found.values().next().value); }
    else this.items.delete(thing.id);
    return { item: thing.item, qty: thing.qty, carry: this.carry(p), class: lift.class };
  }
  //: Handing something to another player.
  cmd_give_item(pid, { to, item, qty = 1 }) {
    const p = this.player(pid), q = this.player(to);
    const spec = this.R.items[item];
    qty = Math.max(1, qty | 0);
    if (!spec || !(p.inventory[item] >= qty) || spec.parcel) throw new CityError("you are not carrying that to give");
    const c = this.carry(q);
    if (c.kg + (spec.kg || 0) * qty > c.capacity) throw new CityError(`${q.name} cannot carry any more`);
    take(p.inventory, item, qty);
    q.inventory[item] = (q.inventory[item] || 0) + qty;
    return { to: q.name, item, qty };
  }

  // ---- the body ---------------------------------------------------------------------------------
  //: What you have done since the last report: metres walked and seconds sprinted (at most what
  //: the time allows); walking on gets you up from a rest.
  cmd_exert(pid, { walked_m = 0, sprint_s = 0, seconds = 5 }) {
    const p = this.player(pid);
    const span = Math.max(0, Math.min(60, Number(seconds) || 0));
    const walked = Math.max(0, Math.min(Number(walked_m) || 0, span * 3));
    p.vitals = vitalsStep(this.R, p.vitals, this.now, this.vitalsContext(p));
    p.vitals = applyExertion(this.R, p.vitals, { walked_m: walked, sprint_s: Math.max(0, Math.min(Number(sprint_s) || 0, span)), day: this.time.day });
    if (walked > 3 && p.resting) p.resting = false;
    return { vitals: p.vitals };
  }
  //: Hurt: a crash, a fall. At most so much at once.
  cmd_hurt(pid, { amount = 0, cause = "accident" }) {
    const p = this.player(pid);
    const loss = Math.max(0, Math.min(40, Number(amount) || 0));
    p.vitals = { ...p.vitals, health: Math.max(0, p.vitals.health - loss) };
    this.log("hurt", { player: pid, loss, cause });
    if (p.vitals.health <= 0) this.faint(p, cause);
    return { vitals: p.vitals, fainted: p.fainted };
  }
  //: Resting where you are, or in bed at home: stamina comes back faster until you move on.
  cmd_rest(pid, { on = true, bed = null } = {}) {
    const p = this.player(pid);
    // Lying down takes a bed (the viewer finds one within reach); getting up does not.
    if (on && !bed) throw new CityError("you need a bed to rest: go in (Enter at a door) and stand by a bed");
    p.vitals = vitalsStep(this.R, p.vitals, this.now, this.vitalsContext(p));
    p.resting = Boolean(on);
    return { resting: p.resting, home: this.atHome(p) };
  }
  atHome(p) { return Boolean(p.home && p.x !== undefined && Math.hypot(p.x - p.home.x, p.z - p.home.z) <= this.R.vitals.home_reach_m); }
  vitalsContext(p) {
    const away = this.now - (p.seen ?? this.now) > 90_000;
    return { home: this.atHome(p), resting: Boolean(p.resting) && !away, working: Boolean(p.clocked), away };
  }
  //: Out cold: taken home (or to the clinic, without one) by ambulance, woken weak, and billed.
  faint(p, cause) {
    const V = this.R.vitals.health;
    p.vitals = { ...p.vitals, health: V.wake_health, stamina: Math.max(p.vitals.stamina, V.wake_stamina) };
    if (p.clocked) this.payWork(p, true);
    p.resting = false; p.ride = null;
    if (p.driving) {
      // The car is left where it stopped.
      const a = this.registry.get(p.driving.vehicle);
      a.attrs.x = p.x; a.attrs.z = p.z;
      p.parked[a.id] = { since: this.now, metered: false, offstreet: false, paid_until: this.now, tickets: 0, x: p.x, z: p.z };
      p.driving = null;
    }
    const where = p.home ? { x: p.home.x, z: p.home.z, place: "home" } : { x: p.x, z: p.z, place: "the clinic" };
    p.fainted = { at: this.now, cause, ...where };
    if (where.x !== undefined) { p.x = where.x; p.z = where.z; }
    const bill = this.billing.issue({ payer: p.account, payee: "business:hospital", kind: "medical", amount: V.hospital_bill,
      memo: `Ambulance and care (${cause})`, at: this.now, due_days: 30, penalties: [Math.round(V.hospital_bill * 0.1)] });
    this.log("fainted", { player: p.id, cause, bill: bill.id });
    return bill;
  }

  // ---- getting about ----------------------------------------------------------------------------
  //: Boarding a bus (the fare paid at the door) or getting into a taxi (the meter starts).
  cmd_board(pid, { kind, vehicle = null }) {
    const p = this.player(pid);
    if (p.driving) throw new CityError("park your car first");
    if (p.ride) throw new CityError("you are riding already");
    if (!["bus", "taxi"].includes(kind)) throw new CityError("only buses and taxis take fares");
    const T = this.R.transit;
    if (kind === "bus") this.ledger.transfer(p.account, T.payee.bus, T.bus_fare, { kind: "fare", memo: "Bus fare", at: this.now });
    p.resting = false;
    p.ride = { kind, vehicle, since: this.now, x: p.x, z: p.z, fare: kind === "bus" ? T.bus_fare : 0 };
    return { ride: p.ride };
  }
  //: Getting off: a taxi's fare by the kilometres the ride came to (no more than the time allows).
  cmd_alight(pid, { km = 0 } = {}) {
    const p = this.player(pid);
    if (!p.ride) throw new CityError("not riding");
    const T = this.R.transit, ride = p.ride;
    p.ride = null;
    if (ride.kind !== "taxi") return { fare: ride.fare, kind: ride.kind };
    const hours = (this.now - ride.since) / 3_600_000;
    const dist = Math.max(0, Math.min(Number(km) || 0, hours * 90 + 0.5));
    const fare = T.taxi_flag + Math.round(T.taxi_per_km * dist);
    try { this.ledger.transfer(p.account, T.payee.taxi, fare, { kind: "fare", memo: `Taxi, ${dist.toFixed(1)} km`, at: this.now }); }
    catch { this.billing.issue({ payer: p.account, payee: T.payee.taxi, kind: "fare", amount: fare, memo: `Taxi fare, ${dist.toFixed(1)} km`, at: this.now, due_days: 7, penalties: [Math.round(fare * 0.5)] }); }
    return { fare, kind: "taxi", km: dist };
  }
  //: A delivery gig: a parcel from the shop beside you to a home, paid on handing it over.
  cmd_take_delivery(pid, { place, to }) {
    const p = this.player(pid);
    const D = this.R.delivery;
    if (p.delivery) throw new CityError("finish the delivery you have first");
    if (!place || !D.from.some((k) => (place.keys || []).includes(k))) throw new CityError("no deliveries go out from here");
    if (Math.hypot((p.x ?? 1e9) - place.x, (p.z ?? 1e9) - place.z) > this.R.stores.reach_m * 2) throw new CityError("walk up to the shop first");
    if (!to?.id || to.x === undefined) throw new CityError("no address to deliver to");
    const metres = Math.hypot(to.x - place.x, to.z - place.z);
    if (metres < D.distance_m[0] * 0.5 || metres > D.distance_m[1] * 1.6) throw new CityError("that address is out of the delivery area");
    const c = this.carry(p);
    if (c.kg + this.R.items.parcel.kg > c.capacity) throw new CityError("you cannot carry the parcel: put something down");
    const km = metres / 1000;
    p.delivery = { id: this.id("delivery"), from: { id: place.id, name: place.name || null, x: place.x, z: place.z }, to: { id: to.id, name: to.name || null, x: to.x, z: to.z },
      km, pay: D.base_pay + Math.round(D.pay_per_km * km), taken: this.now, due: this.now + (D.minutes + D.minutes_per_km * km) * 60_000 };
    p.inventory.parcel = (p.inventory.parcel || 0) + 1;
    return { delivery: p.delivery };
  }
  cmd_deliver(pid) {
    const p = this.player(pid);
    const d = p.delivery;
    if (!d) throw new CityError("no delivery to make");
    if (d.stage === "pickup") throw new CityError(`pick the order up at ${d.from.name || "the shop"} first`);
    if (Math.hypot((p.x ?? 1e9) - d.to.x, (p.z ?? 1e9) - d.to.z) > this.R.delivery.reach_m) throw new CityError("this is not the address");
    const late = this.now > d.due;
    const pay = late ? Math.round(d.pay / 2) : d.pay;
    const shop = this.ledger.open(`business:${d.from.id}`, "business");
    this.ledger.mint(shop, pay, "npc_income", { at: this.now, memo: "delivery fee" });
    this.ledger.transfer(shop, p.account, pay, { kind: "gig", memo: `Delivery to ${d.to.name || "an address"}${late ? " (late)" : ""}`, at: this.now });
    take(p.inventory, "parcel", 1);
    p.delivery = null;
    if (d.task && p.task?.id === d.task) p.task = null;
    this.log("delivered", { player: pid, pay, late });
    return { pay, late, balance: this.ledger.balance(p.account) };
  }
  cmd_cancel_delivery(pid) {
    const p = this.player(pid);
    if (!p.delivery) throw new CityError("no delivery to cancel");
    if (p.delivery.stage !== "pickup") take(p.inventory, "parcel", 1);
    if (p.task?.id === p.delivery.task) p.task = null;
    p.delivery = null;
    return {};
  }
  cmd_give_money(pid, { to, amount }) {
    const p = this.player(pid), q = this.player(to);
    this.ledger.transfer(p.account, q.account, Math.round(amount), { kind: "gift", at: this.now });
    return { balance: this.ledger.balance(p.account) };
  }

  // ---- vehicles -------------------------------------------------------------------------------
  cmd_buy_vehicle(pid, { model, used_years = 0 }) {
    const spec = this.R.vehicles.models[model];
    if (!spec || ["bus", "patrol"].includes(model)) throw new CityError("the dealership does not sell that");
    const p = this.player(pid);
    const here = this.where(p);
    let share = 1;
    for (const [age, s] of this.R.vehicles.used_share_by_age) if (used_years >= age) share = s;
    const price = Math.round(spec.price * share);
    const tax = salesTax(this.R, here.chain, price, "taxable", this.laws);
    const fees = vehicleFees(this.R, price);
    const vid = this.id(`vehicle:${model}`);
    this.registry.register(vid, "vehicle", "business:dealership", { model, value: price, year: this.time.year - used_years,
      plate: plate(vid), odometer_km: used_years * 14000, fuel_l: 30, registered_until: this.now + 365 * DAY, x: p.x, z: p.z }, this.now);
    try {
      this.registry.sell(vid, "business:dealership", p.account, price, { at: this.now,
        taxes: [[this.treasury(here.city || here.county), tax], ["authority:dmv", fees.total]] });
    } catch (error) { this.registry.assets.delete(vid); throw error; }
    // A new car is built outside the city: the dealership pays the factory.
    if (!used_years) this.ledger.burn("business:dealership", Math.round(price * 0.88), "vehicle_manufacture", { at: this.now });
    this.log("vehicle", { player: pid, vehicle: vid, price });
    return { vehicle: vid, price, tax, fees };
  }
  cmd_offer(pid, { asset, to, price = 0, kind = "sale", hours = 2 }) {
    const p = this.player(pid), q = this.player(to);
    const a = this.registry.get(asset);
    if (a.owner !== p.account || a.custody !== "owner") throw new CityError("only an owner holding it can offer it");
    const offer = { id: this.id("offer"), asset, from: pid, to, price: Math.round(price), kind, hours, at: this.now };
    this.offers.set(offer.id, offer);
    return { offer: offer.id, to: q.name };
  }
  cmd_accept(pid, { offer: id }) {
    const o = this.offers.get(id);
    if (!o || o.to !== pid) throw new CityError("no such offer to you");
    const p = this.player(o.from), q = this.player(pid);
    const a = this.registry.get(o.asset);
    const here = this.where(q);
    if (o.kind === "sale") {
      const taxes = a.kind === "vehicle" ? [[this.treasury(here.city || here.county), salesTax(this.R, here.chain, o.price, "taxable", this.laws)]]
        : a.kind === "building" ? this.transferTaxLines(here, o.price) : [];
      this.registry.sell(o.asset, p.account, q.account, o.price, { at: this.now, taxes, key: id });
      if (a.kind === "vehicle") a.attrs.value = Math.max(a.attrs.value, o.price);
    } else if (o.kind === "gift") this.registry.gift(o.asset, p.account, q.account, this.now);
    else if (o.kind === "loan") this.registry.lend(o.asset, p.account, q.account, this.now + o.hours * 3_600_000, this.now);
    else if (o.kind === "lease") this.registry.lease(o.asset, p.account, q.account, this.now + o.hours * 3_600_000, o.price, this.now);
    this.offers.delete(id);
    this.log("transfer", { asset: o.asset, kind: o.kind, from: o.from, to: pid, price: o.price });
    return { asset: slim(a) };
  }
  cmd_decline(pid, { offer: id }) { const o = this.offers.get(id); if (!o || (o.to !== pid && o.from !== pid)) throw new CityError("no such offer"); this.offers.delete(id); return {}; }
  cmd_return(pid, { asset }) { const p = this.player(pid); this.registry.giveBack(asset, p.account, this.now); return {}; }
  cmd_take(pid, { asset, witnesses = 0 }) {
    const p = this.player(pid);
    const a = this.registry.get(asset);
    const t = this.registry.take(asset, p.account, this.now);
    const evidence = [...(a.kind === "vehicle" ? ["the car's alarm"] : []), ...Array.from({ length: witnesses }, (_, i) => `witness ${i + 1}`)];
    let bill = null;
    if (evidence.length) {
      bill = this.fine(p, "theft", `Theft of ${asset}`, evidence);
      // Found and given back by the police after a while.
      a.recover_at = this.now + 20 * 60_000;
    }
    this.log("theft", { asset, by: pid, seen: evidence.length });
    return { owner: t.owner, evidence, bill: bill?.id || null };
  }
  //: Getting into a car: yours, one lent or leased to you -- or another's, which is theft.
  cmd_drive(pid, { vehicle }) {
    const p = this.player(pid);
    const a = this.registry.get(vehicle);
    if (a.kind !== "vehicle") throw new CityError("not a vehicle");
    if (a.custody === "impounded") throw new CityError("it is impounded: pay the tow and storage to release it");
    if (a.holder !== p.account) throw new CityError("not yours to drive");
    if (a.attrs.registered_until && a.attrs.registered_until < this.now) throw new CityError("its registration has run out");
    if (a.attrs.in_shop_until > this.now) throw new CityError(`it is in the body shop until ${new Date(a.attrs.in_shop_until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    p.driving = { vehicle, since: this.now, km: 0 };
    delete p.parked[vehicle];
    return { driving: p.driving, model: a.attrs.model, plate: a.attrs.plate };
  }
  //: Getting out: the car is parked where it stands; on a metered street the meter runs until
  //: you pay it (pay_meter) or drive off, and a meter run out gets a ticket.
  cmd_park(pid, { metered = false, offstreet = false, x, z, km = 0, litres = 0 }) {
    const p = this.player(pid);
    if (!p.driving) throw new CityError("not driving");
    const a = this.registry.get(p.driving.vehicle);
    a.attrs.odometer_km = (a.attrs.odometer_km || 0) + km;
    a.attrs.fuel_l = Math.max(0, (a.attrs.fuel_l ?? 30) - litres);
    a.attrs.x = x; a.attrs.z = z;
    p.parked[a.id] = { since: this.now, metered, offstreet, paid_until: this.now, tickets: 0, x, z };
    p.driving = null;
    return { parked: a.id, metered };
  }
  cmd_pay_meter(pid, { vehicle, hours }) {
    const p = this.player(pid);
    const spot = p.parked[vehicle];
    if (!spot?.metered) throw new CityError("not at a meter");
    const here = this.where(p);
    const rate = this.laws.meter_rate_per_hour !== undefined ? this.R.money(this.laws.meter_rate_per_hour) : this.R.enforcement.parking.meter_rate_per_hour;
    const amount = Math.round(rate * hours);
    const tax = spot.offstreet ? Math.round(amount * (this.R.taxes.local.parking_tax[here.city] || 0)) : 0;
    this.ledger.pay(p.account, [["authority:sfmta", amount], [this.treasury(here.city || here.county), tax]], { kind: "parking", at: this.now });
    spot.paid_until = Math.max(spot.paid_until, this.now) + hours * 3_600_000;
    return { paid_until: spot.paid_until, amount, tax };
  }
  cmd_refuel(pid, { vehicle, litres }) {
    const p = this.player(pid);
    const a = this.registry.get(vehicle);
    if (a.holder !== p.account) throw new CityError("not yours");
    const spec = this.R.vehicles.models[a.attrs.model];
    const here = this.where(p);
    const price = fuelPrice(this.R, here.chain, this.laws);
    const space = Math.max(0, 50 - (a.attrs.fuel_l ?? 0));
    const l = Math.min(space, litres);
    if (spec.fuel === "electric") {
      const cost = Math.round(l * 1.6 * price.electric_per_kwh);
      this.ledger.transfer(p.account, "business:fuel", cost, { kind: "charge", at: this.now });
      a.attrs.fuel_l = (a.attrs.fuel_l || 0) + l;
      return { litres: l, cost };
    }
    const excise = l * price.excise_per_litre, sales = l * price.sales_per_litre, cost = l * price.per_litre;
    this.ledger.pay(p.account, [["business:fuel", cost - excise - sales], [`treasury:${this.R.jurisdictions.state}`, excise], [this.treasury(here.city || here.county), sales]].map(([a2, v]) => [a2, Math.round(v)]), { kind: "fuel", at: this.now });
    a.attrs.fuel_l = (a.attrs.fuel_l || 0) + l;
    return { litres: l, cost: Math.round(cost), tax: Math.round(excise + sales) };
  }

  // ---- the road's charges -------------------------------------------------------------------
  cmd_get_fastrak(pid) {
    const p = this.player(pid);
    if (p.fastrak) throw new CityError("you have a tag already");
    const deposit = this.R.tolls.fastrak.deposit;
    this.ledger.transfer(p.account, "authority:bata", deposit, { kind: "fastrak", memo: "prepaid tolls", at: this.now });
    p.fastrak = { tag: plate(`tag:${pid}`), balance: deposit, flex: 1 };
    return { fastrak: p.fastrak };
  }
  cmd_set_flex(pid, { occupants }) { const p = this.player(pid); if (!p.fastrak) throw new CityError("no tag"); p.fastrak.flex = Math.max(1, Math.min(3, occupants | 0)); return { fastrak: p.fastrak }; }
  //: A FasTrak account pays from its prepaid balance, topped up from your own when it runs low.
  chargeTag(p, amount, authority, memo) {
    const tag = p.fastrak;
    if (tag.balance < amount + this.R.tolls.fastrak.low_balance) {
      const top = Math.max(this.R.tolls.fastrak.top_up, amount);
      this.ledger.transfer(p.account, "authority:bata", top, { kind: "fastrak", memo: "automatic top-up", at: this.now });
      tag.balance += top;
    }
    tag.balance -= amount;
    if (authority !== "authority:bata") this.ledger.transfer("authority:bata", authority, amount, { kind: "toll", memo, at: this.now });
    return { amount, paid_by: "fastrak" };
  }
  //: A car drove through a bridge's toll gantry the way it pays: FasTrak charges the tag, and
  //: without one an invoice is mailed to the owner of the plate.
  cmd_toll(pid, { gantry, name, occupants = 1, key }) {
    const p = this.player(pid);
    const plaza = this.R.tolls.plazas.find((x) => new RegExp(x.match, "i").test(name || ""));
    if (!plaza) throw new CityError(`no toll is charged at ${name}`);
    const vehicle = p.driving?.vehicle ? this.registry.get(p.driving.vehicle) : null;
    if (!vehicle) throw new CityError("not driving");
    const flex = p.fastrak ? Math.min(occupants, p.fastrak.flex || occupants) : occupants;
    const charge = tollAmount(this.R, plaza, { fastrak: Boolean(p.fastrak), occupants: flex, time: this.time, laws: this.laws });
    const ownerAccount = vehicle.owner;
    let result;
    if (p.fastrak) result = this.chargeTag(p, charge.amount, charge.authority, plaza.name);
    else {
      const bill = this.billing.issue({ payer: ownerAccount, payee: charge.authority, kind: "toll_invoice", amount: charge.amount,
        memo: `${plaza.name} toll, plate ${vehicle.attrs.plate}`, at: this.now, due_days: this.R.tolls.invoice_due_days,
        penalties: this.R.tolls.violation_penalties, evidence: ["plate photograph"], key });
      result = { amount: charge.amount, paid_by: "invoice", bill: bill.id };
    }
    this.log("toll", { player: pid, plaza: plaza.name, ...result, carpool: charge.carpool });
    return { ...result, carpool: charge.carpool, plaza: plaza.name };
  }
  //: A stretch driven in a managed lane: in a carpool lane short of its occupancy, a violation;
  //: in an express lane, the price for the stretch (on the tag, or a toll evasion notice).
  //: A carpool lane short of its riders is a moving violation: charged only where it was seen
  //: (``witness``: a camera with the car in its field of view, or a patrol car near -- see
  //: enforcement.mjs), never by the lane alone.
  cmd_lane(pid, { segment, kind, minimum = 2, occupants = 1, km = 0, active = true, key, witness = null }) {
    const p = this.player(pid);
    if (!active) return { charged: 0 };
    const vehicle = p.driving?.vehicle ? this.registry.get(p.driving.vehicle) : null;
    if (!vehicle) throw new CityError("not driving");
    const declared = p.fastrak ? Math.min(occupants, p.fastrak.flex || 1) : occupants;
    if (kind === "hov") {
      if (occupants >= minimum) return { charged: 0, ok_lane: true };
      if (!seenBy(witness)) return { charged: 0, unseen: true };
      const bill = this.fine(p, "hov_violation", `Carpool lane with ${occupants} aboard (${minimum}+ required), ${segment}`, [evidenceOf(witness)], key, vehicle.owner);
      return { charged: bill.amount, bill: bill.id };
    }
    const price = expressPrice(this.R, this.time, km, declared, minimum);
    if (!price) return { charged: 0, ok_lane: true };
    if (p.fastrak) return { charged: price, ...this.chargeTag(p, price, "authority:express", `Express lane ${segment}`) };
    const bill = this.billing.issue({ payer: vehicle.owner, payee: "authority:express", kind: "toll_evasion", amount: price + this.R.managed_lanes.express_no_tag_penalty,
      memo: `Express lane without FasTrak, ${segment}`, at: this.now, due_days: this.R.tolls.invoice_due_days, penalties: this.R.tolls.violation_penalties,
      evidence: ["plate photograph"], key });
    return { charged: bill.amount, bill: bill.id };
  }
  //: Speeding, ``over_mph`` over the limit, seen: by a speed camera with the car in its field of
  //: view (charged where the city runs them), or by a patrol car near (anywhere). Unseen, nothing.
  cmd_speed_camera(pid, { over_mph, mph, camera, key, witness = null }) {
    const p = this.player(pid);
    const S = this.R.enforcement.speed_camera;
    const here = this.where(p);
    const seen = witness || (camera ? { kind: "camera", id: camera } : null);
    if (!seenBy(seen)) return { charged: 0, unseen: true };
    const police = seen.kind === "police";
    if (!police && !S.jurisdictions.some((j) => here.chain.includes(j))) return { charged: 0 };
    let fine = 0;
    for (const [over, amount] of S.tiers) if (over_mph >= over) fine = amount;
    if (mph >= 100) fine = S.at_100_mph;
    if (!fine) return { charged: 0 };
    const vehicle = p.driving?.vehicle ? this.registry.get(p.driving.vehicle) : null;
    const bill = this.billing.issue({ payer: vehicle?.owner || p.account, payee: police ? "authority:court" : "authority:sfmta", kind: police ? "speeding" : "speed_camera", amount: fine,
      memo: `${Math.round(mph)} mph, ${Math.round(over_mph)} over, ${police ? `stopped by patrol ${seen.id}` : `camera ${seen.id}`}`, at: this.now, due_days: this.R.enforcement.notice_due_days,
      penalties: [Math.round(fine * this.R.enforcement.late_penalty_share)], evidence: [evidenceOf(seen)], key });
    this.log("speeding", { player: pid, over_mph, fine });
    return { charged: fine, bill: bill.id };
  }
  fine(p, kind, memo, evidence, key = null, payer = null) {
    const amount = this.R.fines[kind];
    return this.billing.issue({ payer: payer || p.account, payee: "authority:court", kind, amount, memo, at: this.now,
      due_days: this.R.enforcement.notice_due_days, penalties: [Math.round(amount * this.R.enforcement.late_penalty_share)], evidence, key });
  }
  cmd_pay_bill(pid, { bill }) {
    const p = this.player(pid);
    const b = this.billing.bills.get(bill);
    if (!b || b.payer !== p.account) throw new CityError("not your bill");
    const paid = this.billing.pay(bill, p.account, this.now);
    // A car impounded for tickets is released once they are paid.
    for (const v of this.registry.owned(p.account, "vehicle")) {
      if (v.custody === "impounded" && !this.billing.open(p.account).some((x) => x.kind === "parking" || x.kind === "tow")) this.registry.release(v.id, "authority:sfmta", this.now);
    }
    return { bill: paid, balance: this.ledger.balance(p.account) };
  }
  //: Contesting a notice: a hearing in two weeks; without enough evidence it is dismissed.
  cmd_contest(pid, { bill }) {
    const p = this.player(pid);
    const b = this.billing.bills.get(bill);
    if (!b || b.payer !== p.account || b.status !== "open") throw new CityError("not an open bill of yours");
    if (!CITATIONS.includes(b.kind)) throw new CityError("that is not a citation");
    b.hearing = this.now + this.R.enforcement.contest.hearing_days * DAY;
    b.due = Math.max(b.due, b.hearing + DAY);
    return { hearing: b.hearing };
  }

  // ---- real estate ----------------------------------------------------------------------------
  //: What a building is worth: its floor area at the area's price, and whose it is.
  appraise(building) {
    const RE = this.R.real_estate;
    const here = jurisdictionAt(this.R, building.lon, building.lat, building.county);
    const per = (RE.per_m2[building.use] ?? RE.per_m2.residential) * (RE.county_scale[here.county] ?? 1);
    const floor = Math.max(40, (building.area || 80) * Math.max(1, building.floors || 1));
    return { value: this.R.money(Math.round(per * floor / 1000) * 1000), here, floor_m2: Math.round(floor) };
  }
  ensureBuilding(building) {
    const id = `building:${building.id}`;
    if (!this.registry.assets.has(id)) {
      const { value } = this.appraise(building);
      this.registry.register(id, "building", "business:landlords", { name: building.name || null, use: building.use, assessed: value,
        lon: building.lon, lat: building.lat, county: building.county || null, area: building.area, floors: building.floors, bought: null }, 0);
    }
    return this.registry.get(id);
  }
  transferTaxLines(here, price) {
    const t = transferTax(this.R, here.chain, price);
    return [[this.treasury(here.county), t.county], [this.treasury(here.city || here.county), t.city]];
  }
  //: Buying a building from its NPC landlord at the appraised price: the seller pays the transfer
  //: taxes out of the price; the assessed value becomes the price (Proposition 13).
  cmd_buy_building(pid, { building }) {
    const p = this.player(pid);
    const a = this.ensureBuilding(building);
    if (a.owner !== "business:landlords") throw new CityError("its owner is not selling");
    const { value, here } = this.appraise(building);
    const t = transferTax(this.R, here.chain, value);
    this.registry.sell(a.id, "business:landlords", p.account, value, { at: this.now });
    this.ledger.pay("business:landlords", [[this.treasury(here.county), t.county], [this.treasury(here.city || here.county), t.city]], { kind: "transfer_tax", memo: a.id, at: this.now });
    a.attrs.assessed = value; a.attrs.bought = this.now; a.attrs.rent_paid_to = this.now;
    this.log("property", { player: pid, building: a.id, price: value });
    return { building: slim(a), price: value, transfer_tax: t };
  }
  cmd_sell_building(pid, { building }) {
    const p = this.player(pid);
    const a = this.registry.get(`building:${building.id}`);
    if (a.owner !== p.account) throw new CityError("not yours");
    const { value, here } = this.appraise(building);
    const t = transferTax(this.R, here.chain, value);
    this.ledger.mint("business:landlords", value, "external_trade", { at: this.now, memo: "buyer's mortgage" });
    this.registry.sell(a.id, p.account, "business:landlords", value, { at: this.now });
    this.ledger.pay(p.account, [[this.treasury(here.county), t.county], [this.treasury(here.city || here.county), t.city]], { kind: "transfer_tax", memo: a.id, at: this.now });
    return { price: value, transfer_tax: t };
  }

  // ---- in your hands -----------------------------------------------------------------------------
  //: Taking something out of the bag into your hands (what you strike with, or hand over).
  cmd_hold(pid, { item }) {
    const p = this.player(pid);
    if (!(p.inventory[item] > 0)) throw new CityError("you are not carrying that");
    p.hands = item;
    return { hands: p.hands };
  }
  cmd_stow(pid) { const p = this.player(pid); p.hands = null; return { hands: null }; }

  // ---- striking things ----------------------------------------------------------------------------
  //: A blow at a thing within reach (``target``: its key, archetype and place), with what is in
  //: your hands -- or, at the wheel, the car's impact (``energy``, no more than the car moving at
  //: its top speed could carry). The thing breaks once the energy it has taken reaches its break
  //: energy. Breaking what is not yours, seen, is vandalism: a fine and the repair.
  cmd_strike(pid, { target, energy = null, witnesses = 0 }) {
    const p = this.player(pid);
    let spec = this.R.objects?.[target?.archetype] || target?.spec;
    if (!target?.key || !spec?.break_j) throw new CityError("nothing there that breaks");
    if (p.x !== undefined && Math.hypot(p.x - target.x, p.z - target.z) > (energy ? 9 : this.R.tools.reach_m * 2)) throw new CityError("out of reach");
    const prior = this.damage.get(target.key);
    if (prior?.broken) throw new CityError("it is broken already");
    // The Presidio's dead trees, felled for the forestry task: a dry pole, and no vandalism.
    const F = this.R.tasks?.forestry, box = F?.area.bbox;
    const forestry = p.task?.kind === "forestry" && String(target.archetype).startsWith("vegetation.tree") && box
      && p.lat >= box[0] && p.lat <= box[2] && p.lon >= box[1] && p.lon <= box[3];
    if (forestry) { spec = { ...spec, break_j: F.dead_tree_break_j, name: "Dead tree" }; target = { ...target, own: true }; }
    let tool = "fists", joules;
    if (energy) {
      const v = p.driving ? this.registry.get(p.driving.vehicle) : null;
      if (!v) throw new CityError("not driving");
      const model = this.R.vehicles.models[v.attrs.model];
      const cap = 0.5 * (VEHICLE_KG[model.kind] || 1500) * (model.top_kmh / 3.6) ** 2;
      tool = "vehicle"; joules = Math.min(Number(energy) || 0, cap);
    } else {
      const blow = this.blowWith(p);
      tool = blow.kind;
      const tired = p.vitals.stamina < this.R.vitals.stamina.low ? 0.6 : 1;
      joules = strikeEnergy(this.R, tool, p.vitals.strength, spec.material, blow.joules) * tired;
      p.vitals = { ...p.vitals, stamina: Math.max(0, p.vitals.stamina - (0.25 + (blow.joules ?? this.R.tools.kinds[tool].energy_j) / 400)) };
      if (blow.breaks) this.shatter(p, p.hands);
    }
    const wear = strikeWear(this.R, joules, spec.break_j);
    const d = prior || { key: target.key, archetype: target.archetype, name: spec.name, material: spec.material, x: target.x, z: target.z, wear: 0, break_j: spec.break_j };
    d.wear = Math.min(spec.break_j, d.wear + wear);
    d.last = this.now;
    this.damage.set(target.key, d);
    // Bare hands on glass or steel hurt.
    const hurt = tool === "fists" ? this.R.tools.kinds.fists.hurts?.[spec.material] || 0 : 0;
    if (hurt) p.vitals = { ...p.vitals, health: Math.max(0, p.vitals.health - hurt) };
    const out = { tool, joules: Math.round(joules), wear: Math.round(d.wear), break_j: spec.break_j, share: d.wear / spec.break_j, broken: false, hurt };
    if (d.wear >= spec.break_j) {
      d.broken = this.now; d.by = pid;
      out.broken = true;
      // What it breaks into: lumber from wood cut with a saw or an axe, or scrap on the ground.
      const yields = this.R.tools.kinds[tool]?.yields?.[spec.material];
      const salvage = yields || this.R.damage.salvage[spec.material];
      if (salvage && this.R.items[salvage]) {
        const id = this.id("item");
        this.items.set(id, { id, item: salvage, qty: 1 + (target.archetype.startsWith("vegetation.tree") ? 3 : 0), x: target.x + 0.6, z: target.z + 0.4, by: "debris", at: this.now });
        out.salvage = salvage;
      }
      const seen = Math.max(0, Math.min(5, witnesses | 0));
      if (seen && !target.own) {
        const fine = this.fine(p, "vandalism", `Vandalism: ${spec.name}`, Array.from({ length: seen }, (_, i) => `witness ${i + 1}`), `vandal:${target.key}`, p.account);
        const cost = this.R.damage.repair_cost[target.archetype] ?? this.R.damage.repair_cost.default;
        this.billing.issue({ payer: p.account, payee: "authority:court", kind: "restitution", amount: cost, memo: `Repair of ${spec.name.toLowerCase()}`, at: this.now,
          due_days: this.R.enforcement.notice_due_days, penalties: [Math.round(cost * 0.1)], key: `restitution:${target.key}` });
        out.fine = fine.amount; out.restitution = cost;
      }
      this.log("broken", { player: pid, key: target.key, archetype: target.archetype, tool });
      if (forestry && !p.task.felled.includes(target.key)) {
        p.task.felled.push(target.key); p.task.progress = p.task.felled.length;
        out.task = { felled: p.task.felled.length, need: p.task.need };
        if (p.task.felled.length >= p.task.need) out.task = { ...out.task, ...this.payTask(p) };
      }
    }
    if (p.vitals.health <= 0) this.faint(p, "injury");
    return out;
  }


  // ---- hurt and broken ------------------------------------------------------------------------------
  //: The record of a resident or a car of the city's that has come to harm (made on first harm).
  harmed(id, kind, name = null) {
    let h = this.harm.get(id);
    if (!h) {
      h = kind === "vehicle" ? { id, kind, name, condition: 100, state: "fine", history: [] } : { id, kind, name, health: this.R.harm.npc_health, injuries: [], history: [] };
      this.harm.set(id, h);
      if (this.harm.size > 4000) {
        // The longest mended go first.
        const old = [...this.harm.values()].filter((x) => (x.out_until || 0) < this.now - DAY && x !== h).sort((a, b) => (a.last || 0) - (b.last || 0))[0];
        if (old) this.harm.delete(old.id);
      }
    }
    h.last = this.now;
    return h;
  }
  note(h, text) { h.history.push({ t: this.now, text }); if (h.history.length > 30) h.history.shift(); }
  //: Someone hurt: so much health gone, the injury recorded, down where they fell for a minute or
  //: so, then in hospital, then home until mended -- by how bad it is.
  hurtPerson(h, injury, at, cause) {
    const H = this.R.harm;
    h.health = Math.max(0, h.health - injury.health);
    h.injuries.push({ type: injury.type, severity: injury.severity, at: this.now, cause });
    if (h.injuries.length > 12) h.injuries.shift();
    const serious = injury.hospital_h > 0 || h.health <= 0;
    if (serious || injury.severity >= 2) {
      h.down_until = this.now + H.down_s * 1000; h.at = { x: at.x, z: at.z, yaw: at.yaw || 0 };
      const hospital = (h.health <= 0 ? Math.max(48, injury.hospital_h) : injury.hospital_h) * 3_600_000;
      h.out_until = h.down_until + hospital + injury.recover_h * 3_600_000;
      h.hospital_until = h.down_until + hospital;
      h.state = hospital ? "hospital" : "recovering";
    }
    if (h.health <= 0) h.health = 30;
    this.note(h, `${cause}: ${injury.type}${injury.hospital_h ? `, taken to hospital` : ""}`);
  }
  //: A car of the city's damaged: its condition down by the impact; broken or wrecked, it stays
  //: where it stopped until towed, and is in the body shop a day.
  damageVehicle(h, speed, at, cause) {
    const V = this.R.harm.vehicle;
    const d = vehicleDamage(this.R, h.condition, speed);
    h.condition = d.condition; h.state = d.state;
    if (d.state === "broken" || d.state === "wrecked") {
      h.at = { x: at.x, z: at.z, yaw: at.yaw || 0 };
      h.tow_at = this.now + V.tow_after_min * 60_000;
      h.out_until = h.tow_at + V.repair_hours * 3_600_000;
    }
    this.note(h, `${cause}: ${d.loss}% damage, ${d.state}`);
    return d;
  }
  //: A blow to someone: hurt by the energy of it; they hit back, run, or (a police officer)
  //: arrest you; seen, or reported by them, it is a battery.
  cmd_strike_person(pid, { npc, witnesses = 0, thrown = null }) {
    const p = this.player(pid);
    if (!npc?.id) throw new CityError("nobody there");
    if (!thrown && p.x !== undefined && npc.x !== undefined && Math.hypot(p.x - npc.x, p.z - npc.z) > this.R.tools.reach_m * 2) throw new CityError("out of reach");
    // A thrown thing (cmd_throw), or a blow with what is in your hand.
    const blow = thrown ? { kind: "thrown", joules: thrown.joules } : this.blowWith(p);
    const tool = blow.kind;
    const spec = this.R.tools.kinds[tool] || this.R.tools.kinds.fists;
    const [lo, hi] = this.R.tools.strength_scale;
    const joules = blow.joules ?? spec.energy_j * (lo + (hi - lo) * Math.max(0, Math.min(100, p.vitals.strength)) / 100);
    if (!thrown) p.vitals = { ...p.vitals, stamina: Math.max(0, p.vitals.stamina - (0.4 + joules / 400)) };
    const weapon = thrown ? `a thrown ${this.R.items[thrown.item]?.name.toLowerCase() || "thing"}` : tool === "fists" ? null : `a ${this.R.items[p.hands]?.name.toLowerCase() || tool}`;
    if (blow.breaks) this.shatter(p, p.hands);
    const h = this.harmed(npc.id, "person", npc.name || null);
    if (h.down_until > this.now) throw new CityError("they are down already");
    const injury = injuryFor(this.R, { joules, seed: `${npc.id}:${this.now}` });
    this.hurtPerson(h, injury, npc, `struck by ${p.name}${weapon ? ` with ${weapon}` : ""}`);
    const down = h.down_until > this.now;
    const r = rng(npc.id, this.now, "response");
    let response = down ? "down" : "flee", hurt = 0;
    if (npc.role === "police") response = "arrest";
    else if (!down && r() < this.R.harm.retaliate_chance) {
      response = "hit back";
      const [a, b] = this.R.harm.retaliate_health;
      hurt = Math.round(a + r() * (b - a));
      p.vitals = { ...p.vitals, health: Math.max(0, p.vitals.health - hurt) };
      const mine = injuryFor(this.R, { joules: 30 + hurt * 4, seed: `${pid}:${this.now}` });
      p.injuries.push({ type: mine.type, severity: mine.severity, at: this.now, cause: `hit back by ${npc.name || "them"}` });
    }
    // Seen, reported by them, or a police officer: a battery citation, and the bill for their care.
    let fine = 0, restitution = 0;
    if (witnesses > 0 || response !== "down" || npc.role === "police") {
      fine = this.fine(p, "battery", `Battery on ${npc.name || "a resident"}`, [npc.role === "police" ? "the arresting officer" : witnesses ? `${witnesses} witness${witnesses > 1 ? "es" : ""}` : "the victim's report"], `battery:${npc.id}:${Math.floor(this.now / 60000)}`).amount;
      if (injury.bill) { restitution = injury.bill; this.billing.issue({ payer: p.account, payee: "business:hospital", kind: "restitution", amount: injury.bill, memo: `Care for ${npc.name || "a resident"}: ${injury.type}`, at: this.now, due_days: 30, penalties: [Math.round(injury.bill * 0.1)] }); }
    }
    if (p.vitals.health <= 0) this.faint(p, "a fight");
    this.log("struck_person", { player: pid, npc: npc.id, injury: injury.type, response });
    return { tool, joules: Math.round(joules), injury, health: h.health, down, response, hurt, fine, restitution, vitals: p.vitals };
  }
  //: A collision on the street. ``kind``: "hit_by_car" (a car of the city's hit you), "hit_person"
  //: (your car hit someone), "hit_vehicle" (your car and one of the city's). ``speed``: the
  //: impact in m/s; ``other``: the speed of the other car, for who was at fault.
  cmd_collision(pid, { kind, speed = 0, npc = null, vehicle = null, other = 0, at = {} }) {
    const p = this.player(pid);
    speed = Math.max(0, Math.min(45, Number(speed) || 0));
    const place = { x: npc?.x ?? vehicle?.x ?? p.x, z: npc?.z ?? vehicle?.z ?? p.z, yaw: vehicle?.yaw ?? npc?.yaw ?? 0 };
    const out = { kind, speed };
    const mine = p.driving ? this.registry.get(p.driving.vehicle) : null;
    const damageMine = (v) => {
      if (!mine) return null;
      const d = vehicleDamage(this.R, mine.attrs.condition ?? 100, v);
      mine.attrs.condition = d.condition; mine.attrs.state = d.state;
      if (d.state === "wrecked" && !(mine.attrs.in_shop_until > this.now)) {
        mine.attrs.in_shop_until = this.now + this.R.harm.vehicle.repair_hours * 3_600_000;
        this.billing.issue({ payer: p.account, payee: "business:dealership", kind: "repair", amount: Math.round((100 - d.condition) * this.R.harm.vehicle.repair_per_point),
          memo: `Body shop: ${mine.attrs.plate}`, at: this.now, due_days: 14, penalties: [] });
      }
      return d;
    };
    if (kind === "hit_by_car") {
      const injury = injuryFor(this.R, { speed, seed: `${pid}:${this.now}` });
      p.vitals = { ...p.vitals, health: Math.max(0, p.vitals.health - Math.min(95, injury.health)) };
      p.injuries.push({ type: injury.type, severity: injury.severity, at: this.now, cause: `hit by a car at ${Math.round(speed * 2.237)} mph` });
      if (vehicle?.id) { const h = this.harmed(vehicle.id, "vehicle", vehicle.plate || null); out.vehicle = this.damageVehicle(h, speed * 0.35, place, `hit ${p.name}`); }
      out.injury = injury; out.paid_by = "the driver's insurer";
      if (p.vitals.health <= 0) out.bill = this.faint(p, "hit by a car").amount;
    } else if (kind === "hit_person") {
      if (!npc?.id) throw new CityError("nobody hit");
      const h = this.harmed(npc.id, "person", npc.name || null);
      const injury = injuryFor(this.R, { speed, seed: `${npc.id}:${this.now}` });
      this.hurtPerson(h, injury, place, `hit by ${p.name}'s car at ${Math.round(speed * 2.237)} mph`);
      out.injury = injury; out.mine = damageMine(speed * 0.3);
      if (injury.bill) out.bill = this.billing.issue({ payer: p.account, payee: "business:hospital", kind: "liability", amount: injury.bill,
        memo: `${npc.name || "A pedestrian"}'s care: ${injury.type}`, at: this.now, due_days: 30, penalties: [Math.round(injury.bill * 0.1)] }).amount;
    } else if (kind === "hit_vehicle") {
      if (!vehicle?.id) throw new CityError("no car hit");
      const h = this.harmed(vehicle.id, "vehicle", vehicle.plate || null);
      out.vehicle = this.damageVehicle(h, speed, place, `hit by ${p.name}'s car`);
      out.mine = damageMine(speed);
      const H = this.R.harm;
      const loss = Math.round(Math.max(0, speed - this.R.vitals.health.crash_over_ms) * H.driver_crash_health_per_ms);
      if (loss) {
        p.vitals = { ...p.vitals, health: Math.max(0, p.vitals.health - loss) };
        const injury = injuryFor(this.R, { speed: speed * 0.5, seed: `${pid}:${this.now}` });
        if (injury.severity >= 2) p.injuries.push({ type: injury.type, severity: injury.severity, at: this.now, cause: "a car crash" });
        out.hurt = loss;
      }
      if (vehicle.driver && speed * 0.5 >= 2.5) {
        const dh = this.harmed(vehicle.driver, "person", vehicle.driverName || null);
        const di = injuryFor(this.R, { speed: speed * 0.5, seed: `${vehicle.driver}:${this.now}` });
        dh.injuries.push({ type: di.type, severity: di.severity, at: this.now, cause: "a car crash" }); this.note(dh, `in a crash: ${di.type}`);
        out.driverInjury = di;
      }
      // At fault: the faster of the two (a parked or stopped car never is).
      if (speed > 0.5 && Number(other) < speed) {
        const cost = Math.round(out.vehicle.loss * H.vehicle.repair_per_point);
        if (cost) out.bill = this.billing.issue({ payer: p.account, payee: "business:dealership", kind: "liability", amount: cost,
          memo: `Repair of ${vehicle.plate || "a car"} (${out.vehicle.state})`, at: this.now, due_days: 30, penalties: [Math.round(cost * 0.1)] }).amount;
      }
      if (p.vitals.health <= 0) this.faint(p, "a car crash");
    } else throw new CityError("no such collision");
    this.log("collision", { player: pid, kind, speed });
    return { ...out, vitals: p.vitals, injuries: p.injuries.slice(-3) };
  }
  //: The online store: anything a shop in the city sells, brought to you wherever you are, at
  //: twice the shop price (rules.json online_store).
  cmd_buy_online(pid, { item, qty = 1 }) {
    const S = this.R.online_store, spec = this.R.items[item];
    if (!spec || spec.parcel || spec.service || S.exclude_needs.includes(spec.needs)) throw new CityError(`${spec?.name || item} is not sold online`);
    if (!Object.values(this.R.stores.kinds).some((k) => k.items?.includes(item))) throw new CityError(`no shop in the city sells ${spec.name.toLowerCase()}`);
    const p = this.player(pid);
    qty = Math.max(1, Math.min(20, qty | 0));
    const c = this.carry(p);
    if (c.kg + (spec.kg || 0) * qty > c.capacity) throw new CityError(`too heavy to carry: ${c.kg} of ${c.capacity} kg already`);
    const here = this.where(p);
    const price = Math.round(spec.price * S.markup * qty * 100) / 100;
    const tax = itemTax(this.R, here.chain, spec, price, this.laws);
    const shop = this.ledger.open(S.payee, "business");
    this.ledger.pay(p.account, [[shop, price], [this.treasury(here.city || here.county), tax]].filter(([, v]) => v > 0),
      { kind: "purchase", memo: `Online: ${qty > 1 ? qty + " x " : ""}${spec.name}`, at: this.now });
    p.inventory[item] = (p.inventory[item] || 0) + qty;
    this.log("purchase", { player: pid, item, qty, price, store: "online" });
    return { item, qty, price, tax, store: "Online store", carry: this.carry(p) };
  }
  // ---- the task board -------------------------------------------------------------------------------
  //: Taking a task off the board (one at a time). The board's offers are made in the viewer from
  //: the district (a courier's pickup and drop-off, the Presidio's dead trees, the Marina walk);
  //: the pay is held to the rules'.
  cmd_take_task(pid, { task }) {
    const p = this.player(pid), T = this.R.tasks;
    if (p.task) throw new CityError("finish or drop the task you have first");
    const round = T.rounds?.kinds?.[task?.kind];
    if (!task?.kind || (!T[task.kind] && !round)) throw new CityError("no such task");
    const t = { id: this.id("task"), kind: task.kind, title: String(task.title || (T[task.kind] || round).name || task.kind).slice(0, 120), taken: this.now, progress: 0 };
    if (task.kind === "courier") {
      if (p.delivery) throw new CityError("finish the delivery you have first");
      const C = T.courier, from = task.from, to = task.to;
      if (!from?.id || !to?.id || from.x === undefined || to.x === undefined) throw new CityError("no pickup or address");
      const km = (Math.hypot(from.x - (p.x ?? from.x), from.z - (p.z ?? from.z)) + Math.hypot(to.x - from.x, to.z - from.z)) / 1000;
      t.pay = C.pay_base + Math.round(C.pay_per_km * Math.min(4, km));
      p.delivery = { id: this.id("delivery"), stage: "pickup", task: t.id, from: { id: from.id, name: from.name || null, x: from.x, z: from.z },
        to: { id: to.id, name: to.name || null, x: to.x, z: to.z }, km, pay: t.pay, taken: this.now, due: this.now + (C.minutes + C.minutes_per_km * km) * 60_000 };
      t.steps = [`Pick up the order at ${from.name || "the shop"}`, `Deliver it to ${to.name || "the address"}`];
    } else if (task.kind === "forestry") {
      t.pay = T.forestry.pay; t.need = T.forestry.trees; t.felled = []; t.steps = [`Get an axe or a saw (a hardware store, or the online store)`, `Go to ${T.forestry.area.name}`, `Fell ${T.forestry.trees} dead trees there`];
    } else if (task.kind === "sightseeing") {
      t.pay = T.sightseeing.pay; t.visited = []; t.steps = T.sightseeing.stops.map((s) => `Visit ${s.name}`);
    } else if (round) {
      // A round: its stops come with the offer (places round you); the pay is the rules' own.
      const RD = T.rounds, stops = Array.isArray(task.stops) ? task.stops : [];
      if (stops.length < 2 || stops.length > RD.max_stops) throw new CityError("a round has 2 to " + RD.max_stops + " stops");
      const clean = stops.map((s) => ({ name: String(s?.name || "a stop").slice(0, 80), at: [Number(s?.at?.[0]), Number(s?.at?.[1])] }));
      if (clean.some((s) => !Number.isFinite(s.at[0]) || !Number.isFinite(s.at[1]))) throw new CityError("a stop with no place");
      const metres = (a, b) => Math.hypot((a[1] - b[1]) * 88_000, (a[0] - b[0]) * 111_000);
      let km = 0;
      for (let i = 1; i < clean.length; i += 1) km += metres(clean[i - 1].at, clean[i].at) / 1000;
      if (km > 8) throw new CityError("those stops are too far apart for one round");
      t.pay = this.R.money(round.pay_base + round.pay_per_stop * clean.length + RD.pay_per_km * Math.min(4, km));
      t.stops = clean; t.ordered = Boolean(round.ordered); t.visited = []; t.km = km;
      t.steps = clean.map((s) => `${round.verb ? `${round.verb} ` : ""}${s.name}`);
    } else throw new CityError("no such task");
    p.task = t;
    return { task: t, delivery: p.delivery };
  }
  cmd_cancel_task(pid) {
    const p = this.player(pid);
    if (!p.task) throw new CityError("no task");
    if (p.task.kind === "courier" && p.delivery?.task === p.task.id) { if (p.delivery.stage === "carry") take(p.inventory, "parcel", 1); p.delivery = null; }
    p.task = null;
    return {};
  }
  //: The courier's pickup: the order handed over at the shop.
  cmd_collect_delivery(pid) {
    const p = this.player(pid), d = p.delivery;
    if (!d || d.stage !== "pickup") throw new CityError("nothing to pick up");
    if (Math.hypot((p.x ?? 1e9) - d.from.x, (p.z ?? 1e9) - d.from.z) > this.R.tasks.courier.reach_m) throw new CityError("this is not the shop");
    const c = this.carry(p);
    if (c.kg + this.R.items.parcel.kg > c.capacity) throw new CityError("you cannot carry the order: put something down");
    d.stage = "carry";
    p.inventory.parcel = (p.inventory.parcel || 0) + 1;
    if (p.task?.id === d.task) p.task.progress = 1;
    return { delivery: d };
  }
  //: A stop on the Marina walk reached.
  //: A stop reached: on the Marina walk, or on a round (in turn, where its stops are ordered).
  cmd_task_visit(pid, { stop }) {
    const p = this.player(pid), t = p.task, T = this.R.tasks;
    const round = T.rounds?.kinds?.[t?.kind];
    if (t?.kind !== "sightseeing" && !round) throw new CityError("not on a walk or a round");
    const stops = round ? t.stops : T.sightseeing.stops, reach = round ? T.rounds.reach_m : T.sightseeing.reach_m;
    const i = stop | 0, s = stops[i];
    if (!s) throw new CityError("no such stop");
    if (round && t.ordered && i !== t.visited.length) throw new CityError(`first: ${t.steps[t.visited.length]}`);
    const m = Math.hypot(((p.lon ?? 0) - s.at[1]) * 88_000, ((p.lat ?? 0) - s.at[0]) * 111_000);
    if (m > reach * 1.5) throw new CityError(`${s.name} is ${Math.round(m)} m away`);
    if (!t.visited.includes(i)) t.visited.push(i);
    t.progress = t.visited.length;
    if (t.visited.length >= stops.length) return { ...this.payTask(p), visited: t.visited };
    return { visited: t.visited, task: t };
  }
  payTask(p) {
    const t = p.task, payer = this.ledger.open(`business:task:${t.kind}`, "business");
    this.ledger.mint(payer, t.pay, "npc_income", { at: this.now, memo: t.title });
    this.ledger.transfer(payer, p.account, t.pay, { kind: "gig", memo: t.title, at: this.now });
    this.log("task_done", { player: p.id, kind: t.kind, pay: t.pay });
    p.task = null;
    return { done: true, pay: t.pay, title: t.title, balance: this.ledger.balance(p.account) };
  }
  // ---- a shift's work ------------------------------------------------------------------------------
  //: The task in front of you started (you are at its spot) and finished (after its time there).
  cmd_task(pid, { done = false }) {
    const p = this.player(pid);
    const task = p.clocked?.task;
    if (!task) throw new CityError("no task right now");
    const reach = this.R.work_tasks.task_reach_m * 2;
    if (task.x !== undefined && Math.hypot((p.x ?? 1e9) - task.x, (p.z ?? 1e9) - task.z) > reach) throw new CityError(`${task.label.toLowerCase()}: go to the spot first`);
    if (!done) { task.started = this.now; return { task }; }
    if (!task.started || this.now - task.started < task.seconds * 800) throw new CityError("not finished yet: keep at it");
    const [lo, hi] = task.tip;
    const tip = this.R.money(Math.round(lo + (hi - lo) * ((hash(task.id) % 1000) / 1000)));
    if (tip > 0) {
      const shop = this.ledger.open(p.job.employer, "business");
      this.ledger.mint(shop, tip, "npc_income", { at: this.now, memo: "tips" });
      this.ledger.transfer(shop, p.account, tip, { kind: "tip", memo: task.label, at: this.now });
    }
    p.clocked.done = (p.clocked.done || 0) + 1;
    p.clocked.tasks_total = (p.clocked.tasks_total || 0) + 1;
    p.clocked.task = null;
    p.clocked.next_task = this.now + this.taskGap(p);
    return { tip, done: p.clocked.tasks_total };
  }
  taskGap(p) {
    const [a, b] = this.R.work_tasks.every_s;
    return (a + (b - a) * ((hash(`${p.id}:${p.clocked?.tasks_total || 0}`) % 1000) / 1000)) * 1000;
  }
  nextTask(p) {
    const c = p.clocked;
    if (!c || c.task || this.now < (c.next_task || 0)) return;
    const n = (c.tasks_total || 0) + (c.skipped || 0);
    const t = shiftTask(this.R, p.job.role, (hash(`${p.id}:${c.since}:${n}`) % 1000) / 1000);
    const spot = c.spots?.[t.where] || c.spots?.counter || null;
    c.task = { id: `${p.id}:${c.since}:${n}`, ...t, x: spot?.x, z: spot?.z, since: this.now };
  }

  // ---- errands -------------------------------------------------------------------------------------
  //: A neighbour's errand: what they want from the shops, and where to bring it.
  cmd_take_errand(pid, { to, items }) {
    const p = this.player(pid);
    const E = this.R.errands;
    if (p.errand) throw new CityError("finish the errand you have first");
    if (!Array.isArray(items) || !items.length || items.length > 3 || !items.every((i) => E.items.includes(i))) throw new CityError("that is not an errand anyone asks for");
    if (!to?.id || to.x === undefined) throw new CityError("no address");
    const metres = p.x === undefined ? 600 : Math.hypot(to.x - p.x, to.z - p.z);
    const km = Math.min(E.distance_m[1] * 1.6, Math.max(E.distance_m[0] * 0.5, metres)) / 1000;
    p.errand = { id: this.id("errand"), to: { id: to.id, name: to.name || null, x: to.x, z: to.z, who: to.who || null }, items: [...items], km,
      fee: E.fee_base + Math.round(E.fee_per_km * km), taken: this.now };
    return { errand: p.errand };
  }
  cmd_deliver_errand(pid) {
    const p = this.player(pid);
    const e = p.errand;
    if (!e) throw new CityError("no errand to finish");
    if (Math.hypot((p.x ?? 1e9) - e.to.x, (p.z ?? 1e9) - e.to.z) > this.R.errands.reach_m) throw new CityError("this is not the address");
    const need = {};
    for (const i of e.items) need[i] = (need[i] || 0) + 1;
    const missing = Object.entries(need).filter(([i, n]) => !((p.inventory[i] || 0) >= n)).map(([i]) => this.R.items[i].name.toLowerCase());
    if (missing.length) throw new CityError(`still to buy: ${missing.join(", ")}`);
    let spent = 0;
    for (const [i, n] of Object.entries(need)) { take(p.inventory, i, n); spent += this.R.items[i].price * n; if (p.hands === i && !p.inventory[i]) p.hands = null; }
    const here = this.where(p);
    const back = spent + salesTax(this.R, here.chain, spent, "taxable", this.laws);
    const pay = back + e.fee;
    this.ledger.mint("business:residents", pay, "npc_income", { at: this.now, memo: "an errand paid for" });
    this.ledger.transfer("business:residents", p.account, pay, { kind: "gig", memo: `Errand for ${e.to.who || e.to.name || "a neighbour"}`, at: this.now });
    p.errand = null;
    return { pay, reimbursed: back, fee: e.fee };
  }
  cmd_cancel_errand(pid) { const p = this.player(pid); if (!p.errand) throw new CityError("no errand"); p.errand = null; return {}; }

  // ---- homes: buying and renting -------------------------------------------------------------------
  //: A listing checked against the market: that it is listed this week, and its price.
  checkListing(listing) {
    if (!listing?.home || !listing.type || !(listing.sqft > 0)) throw new CityError("no such listing");
    if (this.market.taken.has(listing.home)) throw new CityError("that home is taken");
    const week = Math.floor(this.time.day / 7);
    const rate = this.R.housing.listing_rate[listing.type];
    const roll = rngOnce(listing.home, "listed", week);
    const kind = roll < rate.sale ? "sale" : roll < rate.sale + rate.rent ? "rent" : null;
    if (kind !== listing.kind) throw new CityError("that home is no longer listed");
    const hood = neighbourhoodAt(this.R, listing.lon, listing.lat, listing.county);
    const prices = homePrices(this.R, { id: listing.home, sqft: listing.sqft, type: listing.type }, hood);
    return { price: this.R.money(kind === "sale" ? prices.sale : prices.rent), hood };
  }
  homeAsset(listing, price) {
    const id = `home:${listing.home}`;
    if (!this.registry.assets.has(id)) {
      this.registry.register(id, "home", "business:landlords", { building: listing.building, label: listing.label, address: listing.address, type: listing.type,
        beds: listing.beds, sqft: listing.sqft, x: listing.x, z: listing.z, lon: listing.lon, lat: listing.lat, county: listing.county || null, assessed: price }, this.now);
    }
    return this.registry.get(id);
  }
  moveIn(p, a) {
    p.home = { room: a.id, building: a.attrs.building, x: a.attrs.x, z: a.attrs.z, paid_until: Infinity, address: a.attrs.address, label: a.attrs.label, kind: a.kind };
  }
  //: Buying a home on the market: outright, or with a mortgage (20% down and the closing costs
  //: now; a payment every 30 days). The seller pays the transfer taxes; the assessed value
  //: becomes the price (Proposition 13). You move in.
  cmd_buy_home(pid, { listing, mortgage = true }) {
    const p = this.player(pid);
    if (listing?.kind !== "sale") throw new CityError("that home is for rent");
    const { price } = this.checkListing(listing);
    const terms = mortgageTerms(this.R, price);
    const here = jurisdictionAt(this.R, listing.lon, listing.lat, listing.county);
    const a = this.homeAsset(listing, price);
    if (a.owner !== "business:landlords") throw new CityError("its owner is not selling");
    const upfront = mortgage ? terms.upfront : price + terms.closing;
    if (this.ledger.balance(p.account) < upfront) throw new CityError(`you need ${this.R.fmt(upfront)} ${mortgage ? "for the down payment and closing" : "to buy it outright"}`);
    if (mortgage) this.ledger.mint(p.account, terms.loan, "external_trade", { at: this.now, memo: `mortgage on ${a.attrs.address || a.id}` });
    this.ledger.transfer(p.account, "business:bank", terms.closing, { kind: "closing", memo: a.id, at: this.now });
    this.registry.sell(a.id, "business:landlords", p.account, price, { at: this.now });
    const t = transferTax(this.R, here.chain, price);
    this.ledger.pay("business:landlords", [[this.treasury(here.county), t.county], [this.treasury(here.city || here.county), t.city]], { kind: "transfer_tax", memo: a.id, at: this.now });
    a.attrs.assessed = price; a.attrs.bought = this.now; a.attrs.price = price;
    if (mortgage) p.mortgages = [...(p.mortgages || []), { home: a.id, loan: terms.loan, owed: terms.loan, monthly: terms.monthly, next: this.now + 30 * DAY, missed: 0 }];
    this.market.taken.add(listing.home);
    this.moveIn(p, a);
    this.log("home", { player: pid, home: a.id, price, mortgage });
    return { home: slim(a), price, terms: mortgage ? terms : null, transfer_tax: t };
  }
  //: Renting a home on the market: a month ahead and a month's deposit; rent every 30 days.
  cmd_rent_home(pid, { listing }) {
    const p = this.player(pid);
    if (listing?.kind !== "rent") throw new CityError("that home is for sale");
    const { price: rent } = this.checkListing(listing);
    const L = this.R.housing.lease;
    const a = this.homeAsset(listing, 0);
    if (a.owner !== "business:landlords" || a.custody !== "owner") throw new CityError("it is let already");
    const deposit = rent * L.deposit_months;
    if (this.ledger.balance(p.account) < rent + deposit) throw new CityError(`you need ${this.R.fmt(rent + deposit)}: the first month and a deposit`);
    if (p.lease) this.endLease(p, "moved out");
    this.ledger.transfer(p.account, "business:landlords", deposit, { kind: "deposit", memo: a.id, at: this.now });
    this.registry.lease(a.id, "business:landlords", p.account, this.now + 30 * DAY, rent, this.now);
    p.lease = { home: a.id, rent, deposit, next: this.now + 30 * DAY, missed: 0 };
    this.market.taken.add(listing.home);
    this.moveIn(p, a);
    return { home: slim(a), rent, deposit };
  }
  endLease(p, reason) {
    const a = this.registry.assets.get(p.lease.home);
    if (a && a.holder === p.account) this.registry.giveBack(a.id, p.account, this.now);
    if (reason !== "evicted" && p.lease.deposit) this.ledger.transfer("business:landlords", p.account, p.lease.deposit, { kind: "deposit", memo: "deposit returned", at: this.now });
    if (p.home?.room === p.lease.home) p.home = null;
    this.log("lease_end", { player: p.id, home: p.lease.home, reason });
    p.lease = null;
  }
  cmd_end_lease(pid) { const p = this.player(pid); if (!p.lease) throw new CityError("no lease"); this.endLease(p, "moved out"); return {}; }
  //: Selling a home you own back into the market at its value now; the mortgage is paid off from
  //: the price, and you pay the transfer taxes.
  cmd_sell_home(pid, { home }) {
    const p = this.player(pid);
    const a = this.registry.get(home);
    if (a.owner !== p.account || a.kind !== "home") throw new CityError("not your home");
    const hood = neighbourhoodAt(this.R, a.attrs.lon, a.attrs.lat, a.attrs.county);
    const price = this.R.money(homePrices(this.R, { id: a.id.slice(5), sqft: a.attrs.sqft, type: a.attrs.type }, hood).sale);
    const here = jurisdictionAt(this.R, a.attrs.lon, a.attrs.lat, a.attrs.county);
    const t = transferTax(this.R, here.chain, price);
    this.ledger.mint("business:landlords", price, "external_trade", { at: this.now, memo: "buyer's funds" });
    this.registry.sell(a.id, p.account, "business:landlords", price, { at: this.now });
    this.ledger.pay(p.account, [[this.treasury(here.county), t.county], [this.treasury(here.city || here.county), t.city]], { kind: "transfer_tax", memo: a.id, at: this.now });
    const m = (p.mortgages || []).find((x) => x.home === a.id);
    if (m) { this.ledger.burn(p.account, Math.min(m.owed, this.ledger.balance(p.account)), "system_fee", { at: this.now, memo: "mortgage paid off" }); p.mortgages = p.mortgages.filter((x) => x !== m); }
    if (p.home?.room === a.id) p.home = null;
    this.market.taken.delete(a.id.slice(5));
    return { price, transfer_tax: t };
  }
  //: Each 30 days: the mortgage payment and the rent, billed; missed ones counted, and at the
  //: limit, foreclosure or eviction.
  housingMonth(p) {
    for (const m of p.mortgages || []) {
      while (this.now >= m.next) {
        const interest = Math.round(m.owed * this.R.housing.mortgage.rate / 12);
        m.owed = Math.max(0, m.owed + interest - m.monthly);
        this.billing.issue({ payer: p.account, payee: "business:bank", kind: "mortgage", amount: m.monthly, memo: `Mortgage payment, ${m.home}`, at: m.next, due_days: 15, penalties: [Math.round(m.monthly * 0.05)], key: `mortgage:${m.home}:${m.next}` });
        m.next += 30 * DAY;
      }
      m.missed = this.billing.open(p.account).filter((b) => b.kind === "mortgage" && b.memo.endsWith(m.home) && this.now > b.due).length;
      if (m.missed >= this.R.housing.mortgage.missed_to_foreclose) {
        const a = this.registry.get(m.home);
        if (a.owner === p.account) this.registry.gift(a.id, p.account, "business:bank", this.now);
        for (const b of this.billing.open(p.account)) if (b.kind === "mortgage" && b.memo.endsWith(m.home)) this.billing.dismiss(b.id, this.now, "foreclosed");
        if (p.home?.room === m.home) p.home = null;
        p.mortgages = p.mortgages.filter((x) => x !== m);
        this.log("foreclosure", { player: p.id, home: m.home });
      }
    }
    const l = p.lease;
    if (l) {
      while (this.now >= l.next) {
        this.billing.issue({ payer: p.account, payee: "business:landlords", kind: "rent", amount: l.rent, memo: `Rent, ${l.home}`, at: l.next, due_days: 5, penalties: [Math.round(l.rent * 0.05)], key: `rent:${l.home}:${l.next}` });
        const a = this.registry.assets.get(l.home);
        if (a) a.until = l.next + 30 * DAY;
        l.next += 30 * DAY;
      }
      l.missed = this.billing.open(p.account).filter((b) => b.kind === "rent" && b.memo === `Rent, ${l.home}` && this.now > b.due).length;
      if (l.missed >= this.R.housing.lease.missed_to_evict) this.endLease(p, "evicted");
    }
  }

  // ---- the party's own measures ---------------------------------------------------------------
  cmd_propose(pid, { key, value }) {
    const spec = this.R.initiatives.adjustable[key];
    if (!spec) throw new CityError("that is not something a measure can change");
    if (!(value >= spec.min && value <= spec.max)) throw new CityError(`${spec.label} must be between ${spec.min} and ${spec.max}`);
    this.player(pid);
    const m = { id: this.id("measure"), key, value, label: spec.label, by: pid, at: this.now, closes: this.now + this.R.initiatives.vote_minutes * 60_000, votes: { [pid]: true }, status: "open" };
    this.measures.set(m.id, m);
    return { measure: m };
  }
  cmd_vote(pid, { measure, yes }) {
    const m = this.measures.get(measure);
    if (!m || m.status !== "open") throw new CityError("no open measure");
    this.player(pid);
    m.votes[pid] = Boolean(yes);
    return { measure: m };
  }
  tally(m) {
    const voters = Object.keys(m.votes).length, yes = Object.values(m.votes).filter(Boolean).length;
    const quorum = voters >= Math.max(1, Math.ceil(this.players.size * this.R.initiatives.quorum_share));
    m.status = quorum && yes / voters > this.R.initiatives.pass_share ? "passed" : "failed";
    if (m.status === "passed") this.laws[m.key] = m.value;
    this.log("measure", { measure: m.id, status: m.status, key: m.key, value: m.value });
    return m;
  }

  // ---- time -----------------------------------------------------------------------------------
  //: The world brought up to ``now``: pay for work, rent, notices for bills gone unpaid, property
  //: tax at its installments, rent from tenants, cars the police found, parking run out, votes.
  step(now) {
    const before = this.time;
    this.now = Math.max(this.now, now);
    const t = this.time;
    for (const p of this.players.values()) {
      this.payWork(p);
      if (!p.vitals) { p.vitals = newVitals(this.R, this.now); p.inventory = p.inventory || {}; p.worn = p.worn || {}; }
      p.vitals = vitalsStep(this.R, p.vitals, this.now, this.vitalsContext(p));
      if (p.vitals.health <= 0) this.faint(p, p.vitals.stamina <= 0 ? "exhaustion" : "illness");
      if (p.clocked) this.nextTask(p);
      this.housingMonth(p);
      // The room: after its free week, a day's rent each day, or a notice.
      if (p.home && this.now > p.home.paid_until) {
        const days = Math.ceil((this.now - p.home.paid_until) / DAY);
        const rent = days * this.R.start.room_rent_per_day;
        try { this.ledger.transfer(p.account, "business:landlords", rent, { kind: "rent", at: this.now }); }
        catch { this.billing.issue({ payer: p.account, payee: "business:landlords", kind: "rent", amount: rent, memo: "room rent", at: this.now, due_days: 3, penalties: [Math.round(rent * 0.1)] }); }
        p.home.paid_until += days * DAY;
      }
      // Parking: a meter run out is a ticket an hour; three unpaid and the car is towed.
      for (const [vid, spot] of Object.entries(p.parked)) {
        if (!spot.metered || this.now < spot.paid_until + 3_600_000 * (spot.tickets + 1)) continue;
        spot.tickets += 1;
        const owner = this.registry.get(vid).owner;
        this.billing.issue({ payer: owner, payee: "authority:sfmta", kind: "parking", amount: this.R.enforcement.parking.expired_meter,
          memo: `Expired meter, plate ${this.registry.get(vid).attrs.plate}`, at: this.now, due_days: this.R.enforcement.notice_due_days,
          penalties: [this.R.enforcement.parking.expired_meter], evidence: ["parking control officer"] });
        if (spot.tickets >= this.R.enforcement.parking.tow_after_unpaid && this.registry.get(vid).custody === "owner") {
          this.registry.impound(vid, "authority:sfmta", "unpaid parking", this.now);
          this.billing.issue({ payer: owner, payee: "authority:sfmta", kind: "tow", amount: this.R.enforcement.parking.tow_fee + this.R.enforcement.parking.storage_per_day,
            memo: "Tow and a day's storage", at: this.now, due_days: 7, penalties: [this.R.enforcement.parking.storage_per_day * 7] });
          delete p.parked[vid];
        }
      }
    }
    for (const a of this.registry.assets.values()) {
      if (a.recover_at && this.now >= a.recover_at && a.custody === "stolen") { this.registry.recover(a.id, "police", this.now); delete a.recover_at; this.log("recovered", { asset: a.id }); }
      if (["loan", "lease"].includes(a.custody) && a.until && this.now > a.until && a.kind !== "room" && a.kind !== "home") this.registry.giveBack(a.id, a.holder, this.now);
      if ((a.kind === "building" || a.kind === "home") && a.owner.startsWith("player:")) this.buildingYear(a, before, t);
    }
    // Public works mend what was broken, after a while.
    for (const [key, d] of this.damage) {
      const hours = this.R.damage.repair_hours[d.archetype] ?? this.R.damage.repair_hours.default;
      if (d.broken ? this.now - d.broken > hours * 3_600_000 : this.now - d.last > DAY) this.damage.delete(key);
    }
    for (const b of this.billing.bills.values()) {
      if (b.hearing && this.now >= b.hearing && b.status === "open") {
        if (b.evidence.length < this.R.enforcement.contest.dismissed_without) this.billing.dismiss(b.id, this.now, "not enough evidence at the hearing");
        else b.hearing_held = true;
        delete b.hearing;
      }
    }
    this.billing.sweep(this.now);
    for (const m of this.measures.values()) if (m.status === "open" && this.now >= m.closes) this.tally(m);
    this.lastStep = this.now;
  }
  //: A player's building: its tenants' rent each day, and the property tax bills when they fall due.
  buildingYear(a, before, t) {
    const days = Math.floor((this.now - (a.attrs.rent_paid_to || this.now)) / DAY);
    if (days >= 1 && a.kind === "building") {
      const rent = Math.round(a.attrs.assessed * this.R.real_estate.rent_yield / 365 * days);
      this.ledger.mint(a.owner, rent, "npc_income", { at: this.now, memo: `rent, ${a.attrs.name || a.id}` });
      a.attrs.rent_paid_to += days * DAY;
    }
    for (const inst of this.R.taxes.property.installments) {
      const crossed = before.month !== t.month && t.month === inst.due_month || (before.day < t.day && t.month === inst.due_month && t.date === inst.due_day);
      const key = `property:${a.id}:${t.year}:${inst.due_month}`;
      if (!crossed) continue;
      const here = jurisdictionAt(this.R, a.attrs.lon, a.attrs.lat, a.attrs.county);
      const tax = propertyTax(this.R, here.chain, a.attrs.assessed);
      this.billing.issue({ payer: a.owner, payee: this.treasury(here.county), kind: "property_tax", amount: Math.round(tax.total * inst.share),
        memo: `Property tax installment, ${a.attrs.name || a.id}`, at: this.now, due_days: 40, penalties: [Math.round(tax.total * inst.share * this.R.taxes.property.late_penalty)], key });
    }
  }
  //: A year's taxes on a wage, for the panel: what is withheld and what it comes to.
  taxSummary(pid) {
    const p = this.player(pid);
    const it = incomeTax(this.R, p.ytd.wages), pt = payrollTax(this.R, p.ytd.wages);
    return { year: p.ytd.year, wages: p.ytd.wages, withheld: p.ytd.withheld, income: it, payroll: pt };
  }
  metrics() {
    return { players: this.players.size, supply: this.ledger.supply(), bills: [...this.billing.bills.values()].filter((b) => b.status === "open").length,
      assets: this.registry.assets.size, laws: { ...this.laws }, measures: [...this.measures.values()].filter((m) => m.status === "open").length };
  }

  // ---- what a party sees, and saving ----------------------------------------------------------
  toJSON() {
    return { v: 1, seed: this.seed, now: this.now, seq: this.seq, ledger: this.ledger.toJSON(), billing: this.billing.toJSON(),
      registry: this.registry.toJSON(), players: [...this.players.values()], offers: [...this.offers.values()],
      measures: [...this.measures.values()], laws: this.laws, items: [...this.items.values()], found: [...this.found],
      damage: [...this.damage.values()], market: { taken: [...this.market.taken] }, harm: [...this.harm.values()] };
  }
  static fromJSON(R, o) {
    const w = new CityWorld(R, { now: o.now, seed: o.seed });
    w.seq = o.seq || 0;
    w.ledger = Ledger.fromJSON(o.ledger);
    w.billing = Billing.fromJSON(o.billing, w.ledger);
    w.registry = Registry.fromJSON(o.registry, w.ledger);
    w.players = new Map((o.players || []).map((p) => [p.id, p]));
    w.offers = new Map((o.offers || []).map((x) => [x.id, x]));
    w.measures = new Map((o.measures || []).map((x) => [x.id, x]));
    w.laws = o.laws || {};
    w.items = new Map((o.items || []).map((x) => [x.id, x]));
    w.found = new Set(o.found || []);
    w.damage = new Map((o.damage || []).map((d) => [d.key, d]));
    w.market = { taken: new Set(o.market?.taken || []) };
    w.harm = new Map((o.harm || []).map((h) => [h.id, h]));
    for (const p of w.players.values()) {
      // Saved before bodies and bags: what was bought is carried.
      if (!p.vitals) p.vitals = newVitals(R, o.now);
      if (!p.inventory) { p.inventory = {}; for (const [k, n] of Object.entries(p.goods || {})) if (R.items[k]) p.inventory[k] = n; delete p.goods; }
      p.worn = p.worn || {};
      p.injuries = p.injuries || [];
    }
    return w;
  }
  //: One player's own record, to carry into a party's world.
  savedSelf(pid) {
    const p = this.players.get(pid);
    if (!p) return null;
    return { balance: this.ledger.balance(p.account), job: p.job, fastrak: p.fastrak ? { tag: p.fastrak.tag, flex: p.fastrak.flex } : null,
      vehicles: this.registry.owned(p.account, "vehicle").map((v) => ({ id: v.id, attrs: v.attrs })), vitals: p.vitals,
      inventory: Object.fromEntries(Object.entries(p.inventory || {}).filter(([k]) => k !== "parcel")) };
  }
}

const COMMANDS = new Set(["join", "import", "status", "take_job", "quit_job", "clock_in", "clock_out", "buy", "give_money",
  "buy_vehicle", "offer", "accept", "decline", "return", "take", "drive", "park", "pay_meter", "refuel", "get_fastrak", "set_flex",
  "toll", "lane", "speed_camera", "pay_bill", "contest", "buy_building", "sell_building", "propose", "vote",
  "use", "drop", "pick_up", "give_item", "exert", "hurt", "rest", "board", "alight", "take_delivery", "deliver", "cancel_delivery",
  "hold", "stow", "strike", "task", "take_errand", "deliver_errand", "cancel_errand", "buy_home", "rent_home", "end_lease", "sell_home",
  "strike_person", "collision", "buy_online", "take_task", "cancel_task", "collect_delivery", "task_visit", "throw", "checkout"]);
export const PLAYER_COMMANDS = [...COMMANDS];

function take(inv, item, n) { inv[item] = (inv[item] || 0) - n; if (inv[item] <= 0) delete inv[item]; }
//: The hands let go of what is no longer carried.
function handsCheck(p) { if (p.hands && !(p.inventory[p.hands] > 0)) p.hands = null; }
//: The notices that can be contested.
export const CITATIONS = ["speed_camera", "speeding", "hov_violation", "theft", "parking", "toll_evasion"];
//: A moving violation's witness: a camera that had the car in view, or a patrol car near.
function seenBy(w) { return Boolean(w && (w.kind === "camera" || w.kind === "police") && w.id); }
function evidenceOf(w) { return w.kind === "police" ? "patrol officer" : "camera"; }
function pick(o, keys) { const out = {}; for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) out[k] = o[k]; return out; }
function slim(a) { return { id: a.id, kind: a.kind, owner: a.owner, holder: a.holder, custody: a.custody, attrs: a.attrs }; }
function plate(id) {
  let h = 0; for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const L = "ABCDEFGHJKLMNPRSTUVWXYZ";
  return `${1 + (h % 9)}${L[(h >>> 4) % L.length]}${L[(h >>> 9) % L.length]}${L[(h >>> 14) % L.length]}${String((h >>> 3) % 1000).padStart(3, "0")}`;
}
