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
  fuelPrice, incomeTax, itemTax, jurisdictionAt, newVitals, payrollTax, propertyTax, salesRate, salesTax, storesAt, tollAmount,
  transferTax, vehicleFees, vitalsStep, withholding,
} from "./core.mjs";

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
    try { return { ok: true, ...(fn.call(this, pid, args) || {}) }; }
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
      vitals: newVitals(this.R, this.now), inventory: {}, worn: {}, resting: false, seen: this.now, delivery: null, ride: null, fainted: null, rx: 0 };
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
  cmd_clock_in(pid) {
    const p = this.player(pid);
    if (!p.job) throw new CityError("no job to go to");
    if (Math.hypot((p.x ?? 1e9) - p.job.place.x, (p.z ?? 1e9) - p.job.place.z) > this.R.jobs.workplace_reach_m) throw new CityError("go to work first");
    p.clocked = { since: this.now, paid_to: this.now };
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
    const gross = Math.round(p.job.pay * span / 3_600_000);
    p.clocked.paid_to = this.now;
    if (final) p.clocked = null;
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
      if (!this.R.found.items.includes(found.item)) throw new CityError("nothing like that lies here");
      thing = { id: found.id, item: found.item, qty: 1, x: found.x, z: found.z, found: true };
    }
    if (!thing) throw new CityError("nothing there to pick up");
    if (Math.hypot((p.x ?? 1e9) - thing.x, (p.z ?? 1e9) - thing.z) > 4) throw new CityError("too far to reach");
    const spec = this.R.items[thing.item];
    const c = this.carry(p);
    if (c.kg + (spec.kg || 0) * thing.qty > c.capacity) throw new CityError(`too heavy to carry: ${c.kg} of ${c.capacity} kg already`);
    p.inventory[thing.item] = (p.inventory[thing.item] || 0) + thing.qty;
    if (thing.found) { this.found.add(thing.id); if (this.found.size > 2000) this.found.delete(this.found.values().next().value); }
    else this.items.delete(thing.id);
    return { item: thing.item, qty: thing.qty, carry: this.carry(p) };
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
  cmd_rest(pid, { on = true } = {}) {
    const p = this.player(pid);
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
    if (Math.hypot((p.x ?? 1e9) - d.to.x, (p.z ?? 1e9) - d.to.z) > this.R.delivery.reach_m) throw new CityError("this is not the address");
    const late = this.now > d.due;
    const pay = late ? Math.round(d.pay / 2) : d.pay;
    const shop = this.ledger.open(`business:${d.from.id}`, "business");
    this.ledger.mint(shop, pay, "npc_income", { at: this.now, memo: "delivery fee" });
    this.ledger.transfer(shop, p.account, pay, { kind: "gig", memo: `Delivery to ${d.to.name || "an address"}${late ? " (late)" : ""}`, at: this.now });
    take(p.inventory, "parcel", 1);
    p.delivery = null;
    this.log("delivered", { player: pid, pay, late });
    return { pay, late, balance: this.ledger.balance(p.account) };
  }
  cmd_cancel_delivery(pid) {
    const p = this.player(pid);
    if (!p.delivery) throw new CityError("no delivery to cancel");
    take(p.inventory, "parcel", 1);
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
  cmd_lane(pid, { segment, kind, minimum = 2, occupants = 1, km = 0, active = true, key }) {
    const p = this.player(pid);
    if (!active) return { charged: 0 };
    const vehicle = p.driving?.vehicle ? this.registry.get(p.driving.vehicle) : null;
    if (!vehicle) throw new CityError("not driving");
    const declared = p.fastrak ? Math.min(occupants, p.fastrak.flex || 1) : occupants;
    if (kind === "hov") {
      if (occupants >= minimum) return { charged: 0, ok_lane: true };
      const bill = this.fine(p, "hov_violation", `Carpool lane with ${occupants} aboard (${minimum}+ required), ${segment}`, ["officer"], key, vehicle.owner);
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
  //: A speed camera saw the car ``over_mph`` over the limit.
  cmd_speed_camera(pid, { over_mph, mph, camera, key }) {
    const p = this.player(pid);
    const S = this.R.enforcement.speed_camera;
    const here = this.where(p);
    if (!S.jurisdictions.some((j) => here.chain.includes(j))) return { charged: 0 };
    let fine = 0;
    for (const [over, amount] of S.tiers) if (over_mph >= over) fine = amount;
    if (mph >= 100) fine = S.at_100_mph;
    if (!fine) return { charged: 0 };
    const vehicle = p.driving?.vehicle ? this.registry.get(p.driving.vehicle) : null;
    const bill = this.billing.issue({ payer: vehicle?.owner || p.account, payee: "authority:sfmta", kind: "speed_camera", amount: fine,
      memo: `${Math.round(mph)} mph, ${Math.round(over_mph)} over, camera ${camera}`, at: this.now, due_days: this.R.enforcement.notice_due_days,
      penalties: [Math.round(fine * this.R.enforcement.late_penalty_share)], evidence: ["camera"], key });
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
    if (!["speed_camera", "hov_violation", "theft", "parking", "toll_evasion"].includes(b.kind)) throw new CityError("that is not a citation");
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
      if (["loan", "lease"].includes(a.custody) && a.until && this.now > a.until && a.kind !== "room") this.registry.giveBack(a.id, a.holder, this.now);
      if (a.kind === "building" && a.owner.startsWith("player:")) this.buildingYear(a, before, t);
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
    if (days >= 1) {
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
      measures: [...this.measures.values()], laws: this.laws, items: [...this.items.values()], found: [...this.found] };
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
    for (const p of w.players.values()) {
      // Saved before bodies and bags: what was bought is carried.
      if (!p.vitals) p.vitals = newVitals(R, o.now);
      if (!p.inventory) { p.inventory = {}; for (const [k, n] of Object.entries(p.goods || {})) if (R.items[k]) p.inventory[k] = n; delete p.goods; }
      p.worn = p.worn || {};
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
  "use", "drop", "pick_up", "give_item", "exert", "hurt", "rest", "board", "alight", "take_delivery", "deliver", "cancel_delivery"]);
export const PLAYER_COMMANDS = [...COMMANDS];

function take(inv, item, n) { inv[item] = (inv[item] || 0) - n; if (inv[item] <= 0) delete inv[item]; }
function pick(o, keys) { const out = {}; for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) out[k] = o[k]; return out; }
function slim(a) { return { id: a.id, kind: a.kind, owner: a.owner, holder: a.holder, custody: a.custody, attrs: a.attrs }; }
function plate(id) {
  let h = 0; for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const L = "ABCDEFGHJKLMNPRSTUVWXYZ";
  return `${1 + (h % 9)}${L[(h >>> 4) % L.length]}${L[(h >>> 9) % L.length]}${L[(h >>> 14) % L.length]}${String((h >>> 3) % 1000).padStart(3, "0")}`;
}
