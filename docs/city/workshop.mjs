import { hash32 } from "./people.mjs";
import { plateOf, vehicleState, serviceBooking } from "./fleet.mjs";

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
export const BIN_START = {
  fender: 3,
  relay: 4,
  ground: 4,
  ...Object.fromEntries(Object.keys(MOUNTS).map((site) => ["mount:" + site, 12])),
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
export function visitingCars(people, fleet, time, place, bookedOnly = false) {
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
    if (bookedOnly) {
      const slot = serviceBooking(fleet.seed, p, time.day, place.id),
        minute = time.gameMinute ?? time.minute;
      if (!slot || minute < slot.at || minute >= slot.at + slot.dwell) continue;
    }
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
  World.prototype.payRepairBonus = function (bill) {
    const bonus = bill.repairBonus;
    if (!bonus || bonus.paid || bill.status !== "paid") return;
    this.ledger.transfer(bill.payee, bonus.account, bonus.amount, {
      kind: "bonus",
      at: this.now,
      memo: "Verified repair",
      key: "bonus:" + bill.id,
    });
    bonus.paid = true;
  };
  World.prototype.cmd_workshop_intake = function (pid, { place, vehicle, visitor, concern }) {
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
    if (!visitor && !record.serviceFault && (record.condition ?? 100) >= 100)
      fail("This car has no recorded damage or service fault.");
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
      interview: false,
      concern: visitor
        ? ""
        : String(concern || "")
            .trim()
            .slice(0, 180),
      partsRequired: true,
      startedAt: this.now,
      mistakes: 0,
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
    if (!this.workshopStock.has(order.shop)) this.workshopStock.set(order.shop, { ...BIN_START });
    this.workOrders.set(vehicle, order);
    if (visitor && !record.serviceFault) {
      record.condition = Math.min(record.condition ?? 100, fault === "fender" ? 78 : 90);
      record.state = vehicleState(this.R, record.condition);
    }
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
    const now = this.clock.real(this.now);
    if (this.authoritativeJobs && action !== "withdraw" && now < (o.readyAt || 0))
      fail("Finish the current operation first.");
    let message;
    const stock = this.workshopStock.get(o.shop) || { ...BIN_START };
    this.workshopStock.set(o.shop, stock);
    const need = (id) => {
      if (!(stock[id] > 0)) fail("That bin is empty. Order replacement stock.");
    };
    const report = (message) => {
      (o.reports ||= []).push(message);
      if (o.reports.length > 16) o.reports.shift();
      o.revision++;
      return { order: o, message };
    };
    if (action === "ask") {
      if (o.interview) return report(o.concern || spec.complaint);
      o.interview = true;
      o.startedAt = this.now;
      message = o.concern || spec.complaint;
    } else if (action === "restock") {
      if (!Object.hasOwn(BIN_START, part)) fail("Choose a parts bin.");
      if (stock[part] > 0) fail("This bin still has stock.");
      const unit = REPAIRS[part]?.price || 3;
      const price = this.R.money(unit * BIN_START[part]);
      if (this.ledger.balance(o.payee) < price) fail("The shop till cannot cover this delivery.");
      this.ledger.transfer(o.payee, this.ledger.open("business:parts-supplier", "business"), price, {
        kind: "stock",
        at: this.now,
        memo: part,
      });
      stock[part] = BIN_START[part];
      message = "Delivery received.";
    } else if (action === "issue") {
      // Nothing is refused here: drawing before a diagnosis writes a provisional one, and a part
      // drawn twice goes on the bill as a spare. The message says how likely it is to be right.
      if (!Object.hasOwn(REPAIRS, part)) fail("Choose a parts bin.");
      need(part);
      const spare = part === o.fault && (o.issued === part || o.seated);
      const warn = !o.diagnosed ? " No diagnosis was written: this one is provisional." : o.suspected && o.suspected !== part ? " It is not the part the diagnosis named." : "";
      if (!o.diagnosed) { o.diagnosed = true; o.suspected = part; }
      cost([REPAIRS[part].part + (part !== o.fault ? " · wasted" : spare ? " · spare" : ""), REPAIRS[part].price]);
      stock[part]--;
      if (part === o.fault && !spare) o.issued = part;
      else o.mistakes++;
      message = (spare ? "A second " + REPAIRS[part].part.toLowerCase() + " drawn: one is already on the car or the bench, so it is billed as a spare."
        : o.issued === part ? "Part drawn from the bin." : "Part drawn. It does not match this car's fault: it is charged as wasted material.") + warn;
    } else if (action === "check") {
      const test = Object.hasOwn(CHECKS, check) && CHECKS[check];
      if (!test || !Object.hasOwn(SITES, site)) fail("Choose a marked area and test.");
      const key = site === test.site ? check : check + ":" + site;
      if (!Object.hasOwn(o.checks, key)) {
        cost([test.label, test.cost]);
        o.checks[key] =
          site !== test.site
            ? SITES[site] + " looks fine. Try " + SITES[test.site] + " for this test."
            : spec.test === check
              ? test.failed
              : test.normal;
      }
      message = o.checks[key];
    } else if (action === "diagnose") {
      if (!Object.hasOwn(REPAIRS, part)) fail("Choose a repair to investigate.");
      if (!o.diagnosed) cost(["Fault diagnosis", 10]);
      o.diagnosed = true;
      o.suspected = part;
      message =
        part !== o.fault || !o.checks[spec.test]
          ? "Provisional diagnosis. You can draw parts or keep testing."
          : "Diagnosis supported by the reading. Draw the replacement.";
    } else if (action === "fit") {
      if (o.seated) return report("The replacement is already seated. Secure its connections next.");
      if (part !== o.fault || site !== spec.seat || orientation !== spec.orientation)
        return report("Trial fit: the replacement does not seat here in that orientation. Check the fitting card.");
      if (!o.diagnosed) { o.diagnosed = true; o.suspected = part; }
      // (Not drawn yet: it is taken from the bin as it is fitted.)
      if (o.issued !== o.fault) {
        need(o.fault);
        cost([spec.part, spec.price]);
        stock[o.fault]--;
        o.issued = o.fault;
      }
      o.seated = true;
      o.fitter = pid;
      message = "Part seated. Secure each connection.";
    } else if (action === "attach") {
      const i = spec.mounts.indexOf(site);
      if (!o.seated || i < 0 || o.mounts.includes(site))
        return report("Inspection: no unsecured connection for this part at that point.");
      if (tool !== MOUNTS[site])
        return report("Tool trial: it does not engage this fastener. Try " + MOUNTS[site] + ".");
      if (CIRCUITS[site] && circuit !== CIRCUITS[site])
        return report("Circuit test: this lead does not complete the connection. Follow the circuit card.");
      need("mount:" + site);
      cost([SITES[site] + " · hardware", spec.materials[i]], [SITES[site] + " · fitting labor", 6]);
      stock["mount:" + site]--;
      o.mounts.push(site);
      message = SITES[site] + " secured.";
    } else if (action === "verify") {
      if (!o.seated || o.mounts.length !== spec.mounts.length || o.verified)
        return report(
          o.verified
            ? "Inspection already passed."
            : "Inspection incomplete: " +
                (!o.seated
                  ? "replacement not seated"
                  : spec.mounts
                      .filter((id) => !o.mounts.includes(id))
                      .map((id) => SITES[id])
                      .join(", ") + " still unsecured"),
        );
      cost(["Functional check and release inspection", 12]);
      o.verified = true;
      o.inspector = pid;
      message =
        o.fault === "fender"
          ? "Panel secure. Wheel clearance passed."
          : "Power stable under load. Functional check passed.";
    } else if (action === "release" || action === "withdraw") {
      // (Released without a passing check: the car goes as it is, the work so far billed, and the
      // fault kept with it for the next shop.)
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
          interview: o.interview,
          fitter: o.fitter,
          issued: o.issued,
          startedAt: o.startedAt,
          mistakes: o.mistakes,
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
      const employee = this.players.get(o.fitter || o.inspector);
      if (
        o.verified &&
        employee?.clocked &&
        employee.job?.role === "mechanic" &&
        String(employee.job.place.id) === o.shop
      ) {
        const elapsed = (this.clock.real(this.now) - this.clock.real(o.startedAt ?? this.now)) / 1000;
        o.bonus = this.R.money((o.mistakes ? 0 : 4) + (elapsed <= 150 && !o.mistakes ? 3 : 0));
        const bill = this.billing.bills.get(o.bill);
        if (bill && o.bonus) {
          bill.repairBonus = { account: employee.account, amount: o.bonus };
          if (bill.status === "paid") this.payRepairBonus(bill);
        }
      }
      message = (action === "release" && !o.verified ? "Released without a passing functional check: the fault may still be there. " : "Vehicle released. ") + "Invoice " + this.R.fmt(amount);
    } else fail("Unknown bay action.");
    const seconds = { ask: 1, check: 2, diagnose: 1, issue: 1, fit: 2, attach: 1, verify: 2 };
    if (this.authoritativeJobs) o.readyAt = now + (seconds[action] || 0) * 1000;
    o.revision++;
    return { order: o, message };
  };
}
