import { hash32 } from "./people.mjs";
import { plateOf, vehicleState } from "./fleet.mjs";

export const WORKSHOP_COMMANDS = ["workshop_intake", "workshop_action"];
export const SITES = {
  wing: "Left front wing",
  rail: "Upper rail bolt",
  sill: "Lower bracket bolt",
  arch: "Wheel-arch clip",
  ground: "Body earth stud",
  lug: "Cable lug",
  socket: "Low-voltage relay socket",
  coil: "Coil terminal",
  load: "Load terminal",
};
export const REPAIRS = {
  fender: {
    part: "Left front fender",
    complaint: "The left front wing caught a post. I can see the wheel from above.",
    test: "inspect",
    seat: "wing",
    orientation: "wheel opening down",
    mounts: ["rail", "sill", "arch"],
    price: 155,
    materials: [3, 3, 2],
  },
  ground: {
    part: "Ground strap",
    complaint: "The dash flickers and the car won’t power up reliably.",
    test: "drop",
    seat: "ground",
    orientation: "bare contact inward",
    mounts: ["lug", "ground"],
    price: 24,
    materials: [2, 3],
  },
  relay: {
    part: "Power relay and socket",
    complaint: "The dash flickers and the car won’t power up reliably.",
    test: "output",
    seat: "socket",
    orientation: "keyway forward",
    mounts: ["coil", "load"],
    price: 42,
    materials: [3, 3],
  },
};
// The attachment method comes from the part's fitting card and the mounting point under the cursor.
export const MOUNTS = {
  rail: "Socket wrench",
  sill: "Socket wrench",
  arch: "Trim clip pliers",
  lug: "Terminal crimper",
  ground: "Socket wrench",
  coil: "Terminal insertion tool",
  load: "Terminal insertion tool",
};
export const CIRCUITS = { lug: "Body return", coil: "Control feed", load: "Switched output" };
export const CHECKS = {
  inspect: {
    label: "Inspect panel and mounts",
    site: "wing",
    cost: 5,
    failed: "Panel absent. All three mounting points intact.",
    normal: "Panel and mountings intact.",
  },
  drop: {
    label: "Measure return-path drop",
    site: "ground",
    cost: 8,
    failed: "2.8 V under load · high resistance at the body return.",
    normal: "0.04 V under load · body return good.",
  },
  output: {
    label: "Measure switched output",
    site: "load",
    cost: 8,
    failed: "12.5 V supply, 0 V switched · coil energized.",
    normal: "12.5 V supply, 12.4 V switched · relay closes.",
  },
};
export const SHOP_LIMIT = 350;
export function isWorkshop(R, place, business) {
  return (
    ["auto_parts", "fuel"].includes(business?.kind) ||
    R.jobs.roles.mechanic.at.some((key) =>
      place?.keys instanceof Set ? place.keys.has(key) : place?.keys?.includes(key),
    )
  );
}
export function canWorkBay(p, place, business) {
  return (
    (business && business.owner === p.account) ||
    Boolean(p.clocked && p.job?.role === "mechanic" && String(p.job.place.id) === String(place.id))
  );
}
// The live street simulation owns NPC schedules and parking. An intake is offered only when
// both the driver and that driver's parked vehicle are at the same shop.
export function visitingCars(people, fleet, time, place) {
  const result = [];
  if (!fleet) return result;
  for (const entry of people) {
    if (entry.activity === "behind the counter" || String(entry.indoors) !== String(place.id)) continue;
    const p = entry.person,
      v = fleet.roster.vehicles.get(p?.car);
    if (
      !v ||
      v.owner !== p.id ||
      !["economy", "suv", "sports", "sedan", "compact_ev", "pickup", "delivery_van", "taxi"].includes(v.model)
    )
      continue;
    const at = fleet.vehicleAt(v, time);
    if (at?.state !== "parked" || String(at.spot?.place) !== String(place.id)) continue;
    result.push({
      id: p.id,
      name: p.name,
      vehicle: v.id,
      plate: v.plate,
      model: v.model,
      shade: v.shade,
      indoors: place.id,
      parkedAt: at.spot.place,
    });
  }
  return result;
}
export const totalBill = (order) => order.lines.reduce((n, line) => n + line.amount, 0);
export function installWorkshop(World, CityError) {
  const fail = (msg) => {
    throw new CityError(msg);
  };
  function access(w, pid, place) {
    const p = w.player(pid),
      b = w.bizAt(place?.id);
    if (
      !place?.id ||
      !isWorkshop(w.R, place, b) ||
      !Number.isFinite(Math.hypot(p.x - place.x, p.z - place.z)) ||
      Math.hypot(p.x - place.x, p.z - place.z) > w.R.jobs.workplace_reach_m
    )
      fail("Go to the repair shop.");
    return { p, b, staff: canWorkBay(p, place, b) };
  }
  World.prototype.cmd_workshop_intake = function (pid, { place, vehicle, visitor }) {
    const { p, b, staff } = access(this, pid, place);
    let payer, customer, model, plate, shade, record;
    if (visitor) {
      if (
        !staff ||
        !/^(npc:.+:\d+|visitor:\d+)$/.test(visitor.id) ||
        vehicle !== "veh:" + visitor.id ||
        visitor.vehicle !== vehicle ||
        visitor.plate !== plateOf(visitor.id) ||
        !this.R.vehicles.models[visitor.model] ||
        String(visitor.indoors) !== String(place.id) ||
        String(visitor.parkedAt) !== String(place.id)
      )
        fail("This driver and car must be at the shop.");
      payer = visitor.id;
      customer = String(visitor.name).slice(0, 80);
      model = visitor.model;
      plate = visitor.plate;
      shade = visitor.shade;
      record = this.harmed(vehicle, "vehicle", plate);
    } else {
      const a = this.registry.get(vehicle),
        spot = p.parked[vehicle] || a.attrs;
      if (
        a.kind !== "vehicle" ||
        a.owner !== p.account ||
        a.holder !== p.account ||
        a.custody === "impounded" ||
        p.driving?.vehicle === vehicle ||
        !(Math.hypot(spot.x - place.x, spot.z - place.z) <= this.R.jobs.workplace_reach_m)
      )
        fail("Park your own car at this shop first.");
      payer = p.account;
      customer = p.name;
      record = a.attrs;
      model = record.model;
      plate = record.plate;
    }
    if (record.in_shop_until > this.now || record.out_until > this.now)
      fail("The collision shop already has this vehicle.");
    const old = this.workOrders.get(vehicle);
    if (old?.active) fail("This vehicle already has an open work order.");
    if (
      record.servicedAt != null &&
      this.now - record.servicedAt < 7 * 86400000 &&
      (record.condition ?? 100) >= record.servicedCondition
    )
      fail("This vehicle was just serviced.");
    const fault =
      record.serviceFault ||
      ((record.condition ?? 100) < 75
        ? "fender"
        : ["ground", "relay", "fender"][hash32(vehicle, this.time.day) % 3]);
    const order = {
      id: this.id("repair"),
      vehicle,
      shop: String(place.id),
      shopName: b?.name || place.name,
      payee: this.tillOf(place),
      customer,
      payer,
      npc: Boolean(visitor),
      model,
      plate,
      shade,
      fault,
      checks: {},
      diagnosed: false,
      seated: false,
      mounts: [],
      verified: false,
      lines: [],
      revision: 0,
      active: true,
    };
    if (record.serviceWork) Object.assign(order, record.serviceWork);
    if (!visitor && p.parked[vehicle]) Object.assign(p.parked[vehicle], { metered: false, offstreet: true });
    this.workOrders.set(vehicle, order);
    record.serviceBay = order.shop;
    record.serviceFault = fault;
    return { order };
  };
  World.prototype.cmd_workshop_action = function (
    pid,
    { place, vehicle, orderId, revision, action, site, part, orientation, check, tool, circuit },
  ) {
    const { p, staff } = access(this, pid, place),
      o = this.workOrders.get(vehicle);
    if (!o?.active || o.id !== orderId || revision !== o.revision || o.shop !== String(place.id))
      fail("The work order changed. Refresh the bay.");
    if (!staff && !(action === "withdraw" && o.payer === p.account)) fail("Clock in here as a mechanic.");
    const spec = REPAIRS[o.fault],
      record = o.npc ? this.harm.get(vehicle) : this.registry.get(vehicle).attrs;
    const cost = (...entries) => {
      const lines = entries.map(([label, credits]) => ({ label, amount: this.R.money(credits) }));
      const amount = lines.reduce((sum, line) => sum + line.amount, 0);
      if (totalBill(o) + amount > this.R.money(SHOP_LIMIT)) fail("The authorized estimate is used up.");
      o.lines.push(...lines);
    };
    let message;
    if (action === "check") {
      const tool = Object.hasOwn(CHECKS, check) && CHECKS[check];
      if (!tool || site !== tool.site || o.seated) fail("Select the appropriate test point first.");
      if (Object.hasOwn(o.checks, check)) fail("This reading is already on the work order.");
      message = spec.test === check ? tool.failed : tool.normal;
      cost([tool.label, tool.cost]);
      o.checks[check] = message;
    } else if (action === "diagnose") {
      if (!o.checks[spec.test] || part !== o.fault || o.diagnosed)
        fail("The readings do not support that repair. Inspect the affected circuit or panel.");
      cost(["Fault diagnosis", 10]);
      o.diagnosed = true;
      message = "Diagnosis recorded.";
    } else if (action === "fit") {
      if (!o.diagnosed || o.seated || part !== o.fault || site !== spec.seat || orientation !== spec.orientation)
        fail("Check part, location and orientation before seating it.");
      cost([spec.part, spec.price]);
      o.seated = true;
      message = "Part seated. Secure each connection.";
    } else if (action === "attach") {
      const i = spec.mounts.indexOf(site);
      if (!o.seated || i < 0 || o.mounts.includes(site))
        fail("Select an unsecured mounting point on the fitted part.");
      if (tool !== MOUNTS[site]) fail("That tool cannot secure this attachment.");
      if (CIRCUITS[site] && circuit !== CIRCUITS[site])
        fail("Trace the lead on the circuit card before connecting it.");
      cost([SITES[site] + " · hardware", spec.materials[i]], [SITES[site] + " · fitting labor", 6]);
      o.mounts.push(site);
      message = SITES[site] + " secured.";
    } else if (action === "verify") {
      if (!o.seated || o.mounts.length !== spec.mounts.length || o.verified)
        fail("Complete every attachment before the functional check.");
      cost(["Functional check and release inspection", 12]);
      o.verified = true;
      message =
        o.fault === "fender"
          ? "Panel secure. Wheel clearance passed."
          : "Power stable under load. Functional check passed.";
    } else if (action === "release" || action === "withdraw") {
      if (action === "release" && !o.verified) fail("Pass the functional check before release.");
      if (action === "withdraw" && p.account !== o.payer && !o.npc)
        fail("Only the customer can withdraw this vehicle.");
      if (o.verified) {
        record.condition = Math.min(100, (record.condition ?? 100) + (o.fault === "fender" ? 22 : 10));
        record.state = vehicleState(this.R, record.condition);
        record.servicedCondition = record.condition;
        record.servicedAt = this.now;
        delete record.serviceFault;
        delete record.serviceWork;
        if (staff && p.clocked) p.clocked.done = (p.clocked.done || 0) + 1;
        if (staff) (p.experience ||= {}).mechanic = (p.experience.mechanic || 0) + 1;
      }
      if (!o.verified)
        record.serviceWork = {
          checks: { ...o.checks },
          diagnosed: o.diagnosed,
          seated: o.seated,
          mounts: [...o.mounts],
        };
      delete record.serviceBay;
      o.active = false;
      const amount = totalBill(o);
      if (amount) {
        if (o.npc) this.ledger.open(o.payer, "resident");
        const bill = this.billing.issue({
          payer: o.payer,
          payee: o.payee,
          kind: "repair",
          amount,
          memo: o.plate + " · " + spec.part,
          evidence: o.lines.map((l) => l.label + " " + this.R.fmt(l.amount)),
          key: o.id,
          at: this.now,
        });
        o.bill = bill.id;
        if (o.npc) {
          // NPC purchases use the city's ordinary simulated income. Each invoice settles once.
          this.ledger.mint(o.payer, amount, "npc_income", {
            at: this.now,
            memo: "Auto service",
            key: "service:" + o.id,
          });
          this.billing.pay(bill.id, o.payer, this.now);
        }
      }
      message = "Vehicle released. Invoice " + this.R.fmt(amount);
    } else fail("Unknown bay action.");
    o.revision++;
    return { order: o, message };
  };
}
