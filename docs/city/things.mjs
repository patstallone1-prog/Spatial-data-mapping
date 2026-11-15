// Things as themselves: one record per physical thing that needs one -- a package and what is in
// it, a used phone with its hidden fault, a car's wheel, a chair left at the kerb -- the same
// record whether it is on a shelf, in your hand, in a bag or on the ground (the object lab's plan,
// sections 3 and 4). Pure, as core.mjs is (tests/city_things.test.mjs).
//
// What is NOT here: a second wallet or a second register of title. Money is the Ledger's; a
// player's counts of each thing stay ``p.inventory`` (the slots, the weight, the bar), and a
// thing's record says which of those units it is. A plain new can of soda never gets one: units
// with no record are new, sealed and alike. A record is made the first time a unit has to be told
// apart -- it was used, opened, packed, broken, bought second-hand, found -- and from then on it is
// that unit (``Things.ensure``).
//
// Every record has one place: held (by an account), on the ground (x, z), inside another record
// (a parent, at most MAX_DEPTH deep, never inside itself), placed in a home, on consignment at a
// shop, or gone (eaten, scrapped, delivered out of the game). A change is ``move`` (place) or
// ``mark`` (condition, seal, contents), each bumping ``v`` so two hands cannot both take the same
// box (``expect`` a version, or be refused).

import { rng } from "./people.mjs";

export const MAX_DEPTH = 2;   // a courier bag > a meal box > a soup cup; no deeper
export const PLACES = new Set(["held", "ground", "in", "placed", "consigned", "gone", "shelf", "vehicle"]);

export class ThingError extends Error {}

//: A thing's latent condition: what wear and age have done to it, the same every time it is made
//: for this id (seeded), some of it seen at a glance and some only by a test (lab plan section 5).
//: ``prior``: the item's kind's spread ({ age: [lo, hi], corrosion, quality, ... } as shares 0-1).
export function latentOf(id, prior = {}, worldSeed = "city") {
  const r = rng(worldSeed, "latent", id);
  const pick = (k, lo = 0, hi = 1) => { const [a, b] = prior[k] || [lo, hi]; return Math.round((a + (b - a) * r()) * 1000) / 1000; };
  return {
    age: pick("age", 0, 0.6), corrosion: pick("corrosion", 0, 0.25), quality: pick("quality", 0.4, 1), fasteners: pick("fasteners", 0.5, 1),
    contamination: pick("contamination", 0, 0.15), completeness: pick("completeness", 0.85, 1), fault: r() < (prior.fault_share ?? 0) ? "hidden" : null,
  };
}

//: A new unit's condition: whole, dry and clean.
export const freshCondition = () => ({ integrity: 1, wetness: 0, cleanliness: 1 });

//: A band a player can read for a share 0-1: "like new", "good", "worn", "poor", "broken".
export function conditionBand(integrity) {
  return integrity >= 0.95 ? "like new" : integrity >= 0.75 ? "good" : integrity >= 0.45 ? "worn" : integrity > 0.05 ? "poor" : "broken";
}

export class Things {
  constructor(R = null, { seed = "city" } = {}) { this.R = R; this.seed = seed; this.all = new Map(); this.seq = 0; }
  get(id) { const t = this.all.get(id); if (!t) throw new ThingError(`no ${id}`); return t; }
  has(id) { return this.all.has(id); }
  //: A new record: ``sku`` (an item id), owned by ``owner`` (an account, or null: nobody's), at
  //: ``at`` ({ kind: held | ground | in | placed | consigned | shelf | vehicle, ... }).
  make(sku, { owner = null, at, id = null, condition = null, latent = null, box = null, extra = {}, t = 0 } = {}) {
    if (!at || !PLACES.has(at.kind)) throw new ThingError("a thing must be somewhere");
    id ||= `thing:${(++this.seq).toString(36)}`;
    if (this.all.has(id)) throw new ThingError(`${id} exists already`);
    const spec = this.R?.items?.[sku] || {};
    const prior = this.R?.commerce?.latent?.[spec.material_of] || this.R?.commerce?.latent?.default || {};
    const thing = { id, sku, owner, at: { ...at }, condition: condition || freshCondition(), latent: latent || latentOf(id, prior, this.seed), v: 1, log: [{ t, kind: "made", at: at.kind }], ...extra };
    const cspec = this.R?.items?.[extra.pack || sku]?.container;
    if (box || cspec) thing.box = { contents: [], seal: cspec?.seals ? "open" : "none", ...(box || {}) };
    if (at.kind === "in") this.addTo(at.parent, thing);
    this.all.set(id, thing);
    return thing;
  }
  //: Records held by ``account`` of ``sku`` (not inside anything).
  heldBy(account, sku = null) {
    const out = [];
    for (const t of this.all.values()) if (t.at.kind === "held" && t.at.holder === account && (!sku || t.sku === sku)) out.push(t);
    return out;
  }
  //: The unit of ``sku`` that ``account`` holds to act on: its record (the oldest), or a new one for
  //: a plain unit when it holds more units than records (``units``: its count in the inventory).
  ensure(account, sku, units, { owner = account, t = 0 } = {}) {
    const have = this.heldBy(account, sku);
    if (have.length) return have[0];
    if (!(units > 0)) throw new ThingError("you are not carrying that");
    return this.make(sku, { owner, at: { kind: "held", holder: account }, t });
  }
  //: Depth of ``id`` (0: not inside anything) and the chain of parents.
  chain(id) {
    const out = [];
    let t = this.all.get(id);
    while (t && t.at.kind === "in") { out.push(t.at.parent); t = this.all.get(t.at.parent); if (out.length > 8) break; }
    return out;
  }
  //: What ``thing`` weighs with everything in it (kg), by its item's weight.
  massOf(thing) {
    const own = this.R?.items?.[thing.pack || thing.sku]?.kg || 0;
    if (!thing.box) return own;
    return own + thing.box.contents.reduce((s, c) => s + (this.all.has(c) ? this.massOf(this.all.get(c)) : 0), 0) + (thing.box.loose_kg || 0);
  }
  //: Whether ``thing`` fits in ``box`` by the box's limits: weight, the inside's size (the longest
  //: side of the thing, turned any way, against the box's longest), what it holds and how deep.
  fits(box, thing) {
    const spec = this.R?.items?.[box.pack || box.sku]?.container;
    if (!spec) return { ok: false, reason: `a ${this.name(box)} holds nothing` };
    if (box.id === thing.id || this.chain(box.id).includes(thing.id)) return { ok: false, reason: "it cannot go inside itself" };
    const depth = this.chain(box.id).length + 1 + this.innerDepth(thing);
    if (depth > MAX_DEPTH) return { ok: false, reason: "no more than a bag in a bag in a bag" };
    if (box.box.seal === "intact") return { ok: false, reason: `the ${this.name(box)} is sealed` };
    const item = this.R.items[thing.sku] || {};
    // Packaging goes in any bag or box it fits (a meal box in a takeaway bag); goods go where their kind is held.
    if (spec.holds && !item.container && !spec.holds.some((k) => k === item.kind || k === item.material_of || k === thing.sku || (k === "any"))) return { ok: false, reason: `a ${this.name(box)} is not for ${item.name?.toLowerCase() || thing.sku}` };
    const inner = Math.max(...(spec.inner_m || [1, 1, 1]));
    if ((item.length_m || 0) > inner + 1e-6) return { ok: false, reason: `${item.name || thing.sku} is too long for the ${this.name(box)} (${item.length_m} m, it takes ${inner} m)` };
    const kg = this.massOf(box) - (this.R.items[box.pack || box.sku]?.kg || 0) + this.massOf(thing);
    if (kg > spec.max_kg + 1e-6) return { ok: false, reason: `too heavy for the ${this.name(box)}: it takes ${spec.max_kg} kg` };
    const room = (spec.slots ?? 99) - box.box.contents.length;
    if (room <= 0) return { ok: false, reason: `the ${this.name(box)} is full` };
    return { ok: true };
  }
  innerDepth(thing) { return thing.box?.contents.length ? 1 + Math.max(...thing.box.contents.map((c) => (this.all.has(c) ? this.innerDepth(this.all.get(c)) : 0))) : 0; }
  name(t) { return (this.R?.items?.[t.pack || t.sku]?.name || t.sku).toLowerCase(); }
  addTo(parentId, thing) {
    const box = this.get(parentId);
    if (!box.box) throw new ThingError("that holds nothing");
    if (!box.box.contents.includes(thing.id)) box.box.contents.push(thing.id);
  }
  detach(thing) {
    if (thing.at.kind === "in" && this.all.has(thing.at.parent)) {
      const box = this.all.get(thing.at.parent).box;
      box.contents = box.contents.filter((c) => c !== thing.id);
    }
  }
  //: ``thing`` (or its id) to ``at``, checked; ``expect``: the version the caller saw.
  move(id, at, { expect = null, t = 0, why = "moved" } = {}) {
    const thing = typeof id === "string" ? this.get(id) : id;
    if (expect !== null && thing.v !== expect) throw new ThingError("someone else got there first");
    if (thing.at.kind === "gone") throw new ThingError("it is gone");
    if (!PLACES.has(at.kind)) throw new ThingError("nowhere to put it");
    if (at.kind === "in") {
      const box = this.get(at.parent), ok = this.fits(box, thing);
      if (!ok.ok) throw new ThingError(ok.reason);
    }
    this.detach(thing);
    thing.at = { ...at };
    if (at.kind === "in") this.addTo(at.parent, thing);
    // What is inside goes with it: its records keep their parent, so nothing to do.
    thing.v += 1;
    this.note(thing, t, why, { to: at.kind });
    return thing;
  }
  //: Change of state: ``patch`` merged into the record's condition / box / fields.
  mark(id, patch, { t = 0, why = "changed" } = {}) {
    const thing = typeof id === "string" ? this.get(id) : id;
    if (patch.condition) thing.condition = { ...thing.condition, ...patch.condition };
    if (patch.box && thing.box) thing.box = { ...thing.box, ...patch.box };
    for (const [k, v] of Object.entries(patch)) if (k !== "condition" && k !== "box") thing[k] = v;
    thing.v += 1;
    this.note(thing, t, why);
    return thing;
  }
  //: Gone from the game (eaten, recycled, handed over and away): kept as a record, contents too.
  end(id, why, t = 0) {
    const thing = typeof id === "string" ? this.get(id) : id;
    this.detach(thing);
    thing.at = { kind: "gone", why };
    thing.v += 1;
    this.note(thing, t, why);
    for (const c of thing.box?.contents || []) if (this.all.has(c)) this.end(c, why, t);
    return thing;
  }
  note(thing, t, kind, extra = {}) { thing.log.push({ t, kind, ...extra }); if (thing.log.length > 24) thing.log.splice(1, 1); }
  //: The records' places agree with what the inventories hold: each player's held records of an
  //: item are at most their count of it (extra records -- the units given, eaten or dropped by a
  //: path that does not know of records -- are ended, the newest first).
  reconcile(account, inventory, t = 0) {
    const by = new Map();
    for (const th of this.heldBy(account)) { if (!by.has(th.sku)) by.set(th.sku, []); by.get(th.sku).push(th); }
    for (const [sku, list] of by) {
      const n = inventory?.[sku] || 0;
      for (let k = list.length - 1; k >= n; k -= 1) this.end(list[k], "used up", t);
    }
  }
  //: Records gone a while are dropped, except the ones still referred to (a package's history).
  sweep(t, keepMs = 3 * 86_400_000) {
    for (const [id, th] of this.all) if (th.at.kind === "gone" && t - (th.log[th.log.length - 1]?.t || 0) > keepMs) this.all.delete(id);
  }
  toJSON() { return { seq: this.seq, all: [...this.all.values()] }; }
  static fromJSON(o, R, opts = {}) {
    const T = new Things(R, opts);
    T.seq = o?.seq || 0;
    for (const th of o?.all || []) T.all.set(th.id, structuredClone(th));
    return T;
  }
}
