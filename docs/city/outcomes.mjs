// What comes of an act on a thing: believable, bounded and drawn once (the object lab's plan,
// section 5). Pure (tests/city_outcomes.test.mjs).
//
// Four stages, always in order:
//   1. eligibility -- can this act yield anything at all? (a crash never yields a tyre; vandalism
//      never yields clean saleable goods; nothing comes from what is not there);
//   2. the physical result -- by energy, material, condition: no change, damage, a break, a spill;
//   3. recoverability -- only after the right work, a draw WITHOUT replacement from what the thing
//      actually holds (its components, its contents), with "nothing usable" a fair outcome;
//   4. consequences -- one event, applied once (``Outcomes.once``: the same event id is the same
//      result, however often it is sent).
// The chance of each outcome is the rules' prior (rules.json commerce.outcomes), moved by the
// thing's own latent condition (things.mjs latentOf) and the work's context (tool, skill, care).
// The draw is seeded by the world's seed, the thing, its version and the event: the same event
// replays the same; a new event on the same thing is a new draw; a client cannot pick its roll.

import { rng } from "./people.mjs";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

//: One of ``options`` ([{ id, w }], weights >= 0) by ``u`` (0-1). Weights are normalised; none
//: positive gives null.
export function pickWeighted(options, u) {
  const live = options.filter((o) => o.w > 0);
  const total = live.reduce((s, o) => s + o.w, 0);
  if (!(total > 0)) return null;
  let acc = 0;
  for (const o of live) { acc += o.w / total; if (u < acc) return o.id; }
  return live[live.length - 1].id;
}

//: ``n`` of ``pool`` (an array of component ids or portions) without replacement, by ``r``.
export function drawWithout(pool, n, r) {
  const left = pool.slice(), out = [];
  for (let k = 0; k < n && left.length; k += 1) out.push(left.splice(Math.floor(r() * left.length) % left.length, 1)[0]);
  return out;
}

//: The seeded draw for an event: world seed + thing + its version + event id.
export const eventRng = (worldSeed, thingId, version, eventId) => rng(worldSeed, "outcome", thingId || "-", version || 0, eventId);

// ---- the outcome tables -------------------------------------------------------------------------

//: Taking a wheel off a car you may take it from (your own, or a salvage-yard job): the lab's
//: tuning prior p_usable = clamp(.15 + .65 condition + .15 skill + .10 tool - .25 corrosion, .05,
//: .98). No wheel left: nothing, whatever the sum. Failure is either "damaged" (the wheel comes off
//: but is not fit to sell as a working one) or "stuck" (it stays on; time and tool wear spent).
export function wheelRemoval({ wheelsLeft, condition = 0.8, skill = 0.3, tool = 0, corrosion = 0.1 }, u, u2) {
  if (!(wheelsLeft > 0)) return { result: "none", p_usable: 0 };
  const p = clamp(0.15 + 0.65 * condition + 0.15 * skill + 0.1 * tool - 0.25 * corrosion, 0.05, 0.98);
  if (u < p) return { result: "usable", p_usable: p };
  return { result: u2 < 0.6 ? "damaged" : "stuck", p_usable: p };
}

//: A sealed meal (or any packed food) dropped from ``height`` metres: intact, its package damaged,
//: or a spill -- the lab's 75 / 20 / 5 at a moderate (1 m) drop, worse the higher and the softer
//: the seal, better on a soft landing. Returns { result, weights }.
export function droppedPackage({ height = 1, sealed = true, fragile = false, soft = false }, u) {
  const h = clamp(height, 0, 6);
  const harm = (h / 1) * (sealed ? 1 : 1.8) * (fragile ? 1.6 : 1) * (soft ? 0.4 : 1);
  const weights = [{ id: "intact", w: 75 / Math.max(0.3, harm) }, { id: "package_damaged", w: 20 * Math.min(2, harm) }, { id: "spilled", w: 5 * harm * harm }];
  if (h < 0.2) return { result: "intact", weights };
  return { result: pickWeighted(weights, u), weights };
}

//: Breaking up a thing you may take apart (a chair left out for collection, your own broken
//: table): finite portions of its material, the lab's 55 / 30 / 15 (usable / damaged / unusable)
//: moved by the thing's quality and corrosion and the tool's fit. Each portion drawn on its own.
export function reclaim({ portions, quality = 0.7, corrosion = 0.1, tool = 0.5, care = 0.5 }, r) {
  const lean = 0.25 * (quality - 0.7) + 0.2 * (tool - 0.5) + 0.15 * (care - 0.5) - 0.3 * corrosion;
  const w = [{ id: "usable", w: Math.max(0.01, 55 * (1 + lean * 2)) }, { id: "damaged", w: 30 }, { id: "unusable", w: Math.max(0.01, 15 * (1 - lean * 2)) }];
  const out = { usable: 0, damaged: 0, unusable: 0 };
  for (let k = 0; k < portions; k += 1) out[pickWeighted(w, r())] += 1;
  return out;
}

//: A plant you may pick from (a permitted fruit tree, a herb bed): what it holds this season, at
//: its ripeness, less what was picked since it last grew back; a few at a time.
export function forage({ season_yield = 6, ripeness = 1, taken = 0, regrow_left = 0 }, r) {
  const there = Math.max(0, Math.floor(season_yield * clamp(ripeness, 0, 1)) - taken);
  if (!there || regrow_left > 0) return { got: 0, left: there };
  const got = Math.min(there, 1 + Math.floor(r() * 3));
  return { got, left: there - got };
}

//: An abandoned container's contents: drawn ONCE, when it is placed, from what such a container
//: plausibly holds (``pool``: [{ sku, w }]); opened later, it shows those (never a fresh roll).
export function containerContents(pool, n, r) {
  const out = [];
  const left = pool.map((p) => ({ ...p }));
  for (let k = 0; k < n; k += 1) {
    const sku = pickWeighted(left.map((p) => ({ id: p.sku, w: p.w })), r());
    if (!sku) break;
    out.push(sku);
    const e = left.find((p) => p.sku === sku); e.w *= 0.4;   // the same thing again is less likely
  }
  return out;
}

//: How well a second-hand device works: its record's hidden fault (latent, fixed when it was made)
//: and its battery's state; ``tested`` (a phone charger, a repair shop) reveals the fault.
export function deviceState(latent, tested = false) {
  const battery = clamp(1 - latent.age * 0.6 - latent.corrosion * 0.5, 0.2, 1);
  return { works: latent.fault !== "dead", battery: Math.round(battery * 100) / 100, fault: tested ? latent.fault : latent.fault ? "unknown" : null, risk: latent.fault ? "some risk" : latent.age > 0.45 ? "some risk" : "low risk" };
}

//: Striking a thing that is not yours, or is a fixture: what breaks is damage and a repair bill;
//: what comes off is litter (glass on the pavement, splinters), never clean goods to sell. The
//: rubbish may be swept up (a cleaning job), and is worth nothing at a scrap yard but its weight.
export function vandalismYield(material) {
  return { item: null, litter: material === "glass" ? "glass_shards" : null };
}

//: Crashing into a car (or a car into you): never anything to pick up (lab plan: "0% inventory
//: reward; debris VFX only"). The debris shown is scenery that goes.
export const crashYield = () => ({ items: [], vfx: true });

// ---- applied once --------------------------------------------------------------------------------

//: Results kept by event id: the first call resolves and keeps, every later call with the same id
//: gets that result (its consequences were applied with the first).
export class Outcomes {
  constructor() { this.done = new Map(); }
  once(eventId, resolve) {
    if (this.done.has(eventId)) return { ...this.done.get(eventId), replay: true };
    const out = resolve();
    this.done.set(eventId, out);
    if (this.done.size > 3000) this.done.delete(this.done.keys().next().value);
    return out;
  }
  toJSON() { return [...this.done].slice(-1500); }
  static fromJSON(list) { const o = new Outcomes(); for (const [k, v] of list || []) o.done.set(k, v); return o; }
}
