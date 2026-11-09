// What a thing is like to handle (rules.json "handling", and material_of / hold / length_m on each
// item): whether you can lift it, how you hold it, whether and how far it can be thrown, whether
// it can be swung and how hard, and how high you jump with what you carry. Pure: the world
// (world.mjs) checks with these, and the viewer (view.mjs) poses and animates by them.

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const s01 = (strength) => Math.max(0, Math.min(100, strength ?? 20)) / 100;

//: What the item is: its weight, material, how it is held, its length, and whether it is rigid,
//: fragile or spills. Things without a recorded material are small plastic things held in a hand.
export function physOf(R, id) {
  const it = R.items[id] || {};
  const material = it.material_of || "plastic";
  const M = R.handling.materials[material] || {};
  return {
    id, name: it.name || id, kg: it.kg || 0, material, hold: it.hold || "hand", length: it.length_m ?? 0.2,
    rigid: !M.soft, fragile: Boolean(M.fragile), spills: Boolean(M.spills), breaksTo: M.breaks_to || null,
    unwieldy: Boolean(it.unwieldy), tool: it.strike || null, service: Boolean(it.service),
  };
}

//: The heaviest single thing you can lift, by strength (kg).
export const liftKg = (R, strength) => R.handling.lift.base_kg + R.handling.lift.per_strength_kg * Math.max(0, Math.min(100, strength ?? 20));

//: "light", "medium", "heavy", "very heavy" -- or "too heavy to lift" for you.
export function weightClass(R, kg, strength) {
  if (kg > liftKg(R, strength)) return "too heavy to lift";
  for (const [upTo, name] of R.handling.weight_classes) if (kg <= upTo) return name;
  return "very heavy";
}

//: Can you lift it: {ok, reason}. ``carrying``: kg already carried; ``capacity``: what you can carry.
export function canLift(R, id, strength, carrying = 0, capacity = Infinity, qty = 1) {
  const ph = physOf(R, id), kg = ph.kg * qty, lift = liftKg(R, strength);
  if (ph.kg > lift) return { ok: false, reason: `${ph.name} (${ph.kg} kg) is too heavy for you to lift: you can lift ${Math.round(lift)} kg (strength ${Math.round(strength)}).` };
  if (carrying + kg > capacity) return { ok: false, reason: `You can lift the ${ph.name.toLowerCase()} (${ph.kg} kg), but not carry it as well: ${carrying} of ${capacity} kg already.` };
  return { ok: true, class: weightClass(R, ph.kg, strength) };
}

//: A throw of it: {ok, reason, speed (m/s), angle (rad), range (m on level ground from the hand),
//: energy (J)}. Heavier things go slower; under min_speed_ms it is no throw at all.
export function throwOf(R, id, strength) {
  const T = R.handling.throw, ph = physOf(R, id), s = s01(strength);
  if (ph.service || !ph.kg) return { ok: false, reason: "There is nothing to throw." };
  if (ph.kg > liftKg(R, strength)) return { ok: false, reason: `Too heavy for you to lift, let alone throw.` };
  if (ph.unwieldy) return { ok: false, reason: `The ${ph.name.toLowerCase()}: too unwieldy to throw. Put it down instead.` };
  const E = lerp(T.energy_j[0], T.energy_j[1], s);
  const speed = Math.min(lerp(T.max_speed_ms[0], T.max_speed_ms[1], s), Math.sqrt((2 * E) / ph.kg));
  if (speed < T.min_speed_ms) return { ok: false, reason: `Too heavy to throw (${ph.kg} kg): you could only heave it ${(speed * speed / 9.81).toFixed(1)} m. Put it down instead.` };
  // Long things are thrown flatter; a two-handed lump is heaved, from the chest.
  const angle = (ph.hold === "two_hands" ? 38 : ph.length > 1.2 ? 20 : T.angle_deg) * Math.PI / 180;
  const h = ph.hold === "two_hands" ? T.release_m - 0.4 : T.release_m, vx = speed * Math.cos(angle), vy = speed * Math.sin(angle);
  const t = (vy + Math.sqrt(vy * vy + 2 * 9.81 * h)) / 9.81;
  return { ok: true, speed, angle, release: h, range: vx * t, flight: t, energy: 0.5 * ph.kg * speed * speed,
    lands: ph.spills ? "spills" : ph.fragile ? "breaks" : "whole", breaksTo: ph.breaksTo };
}

//: A swing of it: {ok, reason, joules, kind (the tools.kinds entry its blow counts as), breaks}.
//: Tools swing as tools; any other rigid thing long enough and light enough for you is a blunt
//: blow by its mass and length; soft things and two-handed lumps do not swing.
export function swingOf(R, id, strength) {
  const S = R.handling.swing, ph = physOf(R, id), s = s01(strength);
  if (!id) return { ok: true, kind: "fists", joules: null };
  if (ph.tool) return { ok: true, kind: ph.tool, joules: null };
  if (!ph.rigid) return { ok: false, reason: `The ${ph.name.toLowerCase()}: too soft to swing, it would do nothing. Q throws it; U uses it.` };
  if (ph.hold === "two_hands" || ph.unwieldy) return { ok: false, reason: `The ${ph.name.toLowerCase()}: it takes both arms to hold, so it does not swing. Q heaves it, or put it down.` };
  if (ph.length < S.min_length_m) return { ok: false, reason: `The ${ph.name.toLowerCase()}: too small to swing. Q throws it, or choose an empty slot to punch.` };
  const most = liftKg(R, strength) * S.max_lift_share;
  if (ph.kg > most) return { ok: false, reason: `The ${ph.name.toLowerCase()}: too heavy for you to swing (${ph.kg} kg; up to ${most.toFixed(1)} kg at your strength).` };
  const E = lerp(S.energy_j[0], S.energy_j[1], s);
  const joules = E * Math.max(0.2, Math.min(1, Math.sqrt(ph.kg / 1.5))) * Math.max(0.3, Math.min(1, ph.length / 0.7));
  return { ok: true, kind: "blunt", joules, breaks: ph.fragile, breaksTo: ph.breaksTo };
}

//: How high you jump (m) and how long you are off the ground (s), with ``loadKg`` carried.
//: ``body``: {kg, height_m} (defaults: rules' average adult).
export function jumpOf(R, strength, loadKg = 0, body = {}) {
  const B = R.handling.body, g = 9.81;
  const kg = body.kg || B.kg, height = body.height_m || B.height_m;
  const push = height * B.leg_share * B.push_share;
  const force = kg * g * lerp(B.force_bodyweights[0], B.force_bodyweights[1], s01(strength));
  const M = kg + Math.max(0, loadKg);
  const h = Math.max(0, ((force - M * g) * push) / (M * g));
  const v = Math.sqrt(2 * g * h);
  return { height: h, speed: v, flight: (2 * v) / g, push };
}

//: The things a hand-held item looks like, for the viewer: [width, height, depth] in metres.
export function sizeOf(ph) {
  const L = Math.max(0.08, ph.length);
  if (ph.hold === "shoulder" || ph.hold === "tool") return [Math.max(0.04, Math.min(0.12, ph.kg / (L * 20))), L, 0.06];
  const side = Math.cbrt(Math.max(0.0005, ph.kg / 900));   // as dense as wood, near enough
  return [Math.max(0.08, Math.min(0.9, L)), Math.max(0.06, Math.min(0.6, side)), Math.max(0.06, Math.min(0.6, side * 1.2))];
}
