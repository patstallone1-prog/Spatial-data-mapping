// What a blow does to the person it lands on, and what they do next.
//
// The body. Each zone a blow can land on (head, chest, belly, arm, leg) is the layers it is made
// of -- skin, fat, muscle and bone, as thick as they are there (BODY_ZONES) -- and each layer is
// a substance of the object catalogue (docs/object-catalogue.json mechanics: skin, fat, muscle,
// bone_cortical, each with its toughness). The mechanics engine (mechanics.mjs strike) meets the
// fist or the thing swung with those layers and says how hard the contact pressed (force_n) and
// how much of the blow came back (restitution).
//
// The push. The blow's momentum goes into the body as into an inverted pendulum standing on its
// feet (the centre of mass at COM_SHARE of the height): struck at height h, the body takes it as a
// mass M (l/h)^2 would, and its centre of mass is set moving at p h / (M l). Whether that topples
// them is the "capture point" (Hof, Gazendam and Sinke 2005): the centre of mass moving at v over
// legs of length l will come to rest over a point v / sqrt(g / l) further on. Within the reach of
// the heel behind the ankle (more for someone strong and braced) they only sway (a flinch); beyond
// it they must step, one stride at a time, to stay up (a stumble); past a few strides, or with the
// head struck hard enough to stun, they go down (a fall back).
//
// The mind. Then the instinct of someone just hit takes over (instinct): fight back, call the
// police, run, call to the people round for help, or -- now and then -- freeze. Who they are
// (temperament.mjs), how strong they are against you, how badly they are hurt, how many are
// watching and whether the police are near decide which. Pure: no three.js, no clock; the roll
// is a seeded number.

//: The body's own numbers (each a property of people in general, not of a case).
export const HIT = Object.freeze({
  //: The centre of mass, as a share of the standing height (Winter, Biomechanics of Human Movement).
  com_share: 0.55,
  //: How far behind the ankle the heel lets the centre of mass go before a step is needed (m):
  //: the back of the base of support, standing at ease.
  heel_m: 0.06,
  //: More when braced, at full strength (m).
  brace_m: 0.06,
  //: How far one recovery step carries the capture point (m): a stride, less the time it takes to
  //: put the foot down while still falling. And how many may be taken before the body cannot
  //: catch itself (past about 0.6 m beyond the heel, a stumble ends on the ground).
  step_m: 0.3,
  max_steps: 2,
  //: A blow's energy to the head that stuns (J) for someone of average strength; the neck of a
  //: strong person holds the head steadier (x 0.6 at none to x 1.4 at full).
  head_stun_j: 40,
  //: Gravity (m/s^2).
  g: 9.81,
  //: The contact force past which a zone's bone breaks (N): a nose or a cheek about 1-2 kN, a rib
  //: about 2-3 kN, a forearm about 3-4 kN, a shin about 4-5 kN (approx., after published
  //: impact-tolerance tests: Nahum and Melvin, Accidental Injury).
  fracture_n: { head: 1800, chest: 2600, belly: Infinity, arm: 3400, leg: 4500 },
});

//: The layers at each zone: [substance, thickness m]. ``fat`` is the share set by build (fatScale).
//: ``h``: the zone's height as a share of standing height (where a blow at that height lands).
export const BODY_ZONES = Object.freeze({
  head: { h: [0.87, 1.0], layers: [["skin", 0.005], ["fat", 0.002], ["bone_cortical", 0.007]], lever: 0.94 },
  chest: { h: [0.7, 0.87], layers: [["skin", 0.002], ["fat", 0.008], ["muscle", 0.02], ["bone_cortical", 0.01]], lever: 0.78 },
  belly: { h: [0.53, 0.7], layers: [["skin", 0.002], ["fat", 0.02], ["muscle", 0.1]], lever: 0.62 },
  arm: { h: [0.55, 0.85], layers: [["skin", 0.002], ["fat", 0.006], ["muscle", 0.03], ["bone_cortical", 0.008]], lever: 0.72, guard: 0.5 },
  leg: { h: [0, 0.53], layers: [["skin", 0.002], ["fat", 0.01], ["muscle", 0.045], ["bone_cortical", 0.012]], lever: 0.35 },
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const unit = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100003) / 100002; };

//: Where a blow aimed at ``aimY`` (m above their feet) lands on someone ``height`` tall: the zone,
//: and the exact height. A punch lands within a hand's breadth or so of where it was aimed
//: (``scatter`` m, by the seed); one at chest height lands on a raised forearm now and then.
export function hitZone(aimY, height, seed = "", scatter = 0.12) {
  const y = clamp(aimY + (unit(`${seed}:y`) * 2 - 1) * scatter, 0.05, height), s = y / height;
  if (s >= BODY_ZONES.chest.h[0] && s < BODY_ZONES.chest.h[1] + 0.02 && unit(`${seed}:guard`) < 0.18) return { zone: "arm", y };
  for (const name of ["head", "chest", "belly", "leg"]) { const [a, b] = BODY_ZONES[name].h; if (s >= a && s <= b + 1e-9) return { zone: name, y }; }
  return { zone: "leg", y };
}

//: Someone's body for the blow: {kg, height_m, strength (0-100), fat (0-1: lean to heavy)}.
export function victimOf(person = {}) {
  const age = person.age ?? person.base?.age ?? 35;
  const fig = person.figure || {};
  const kg = person.kg ?? 60 + 30 * (fig.weight ?? 0.45) + 8 * (fig.muscle ?? 0.3);
  const height_m = person.height_m ?? (fig.height ? 1.72 * fig.height : 1.72);
  const strength = person.strength ?? clamp(55 + 40 * (fig.muscle ?? 0.3) - Math.max(0, age - 45) * 0.9 - Math.max(0, 18 - age) * 2.5, 10, 100);
  return { kg, height_m, strength, fat: fig.weight ?? 0.45 };
}

//: The zone's layers as a body the engine strikes (fat thicker on a heavier build).
export function zoneBody(M, zone, victim) {
  const z = BODY_ZONES[zone] || BODY_ZONES.chest, fatScale = 0.5 + 1.5 * clamp(victim.fat ?? 0.45, 0, 1);
  const layers = z.layers.map(([substance, t]) => ({ substance, thickness_m: substance === "fat" ? t * fatScale : t }));
  return M.body({ shape: "layers", layers, fixed: false });
}

//: What the blow does: { zone, force_n, fracture, restitution, momentum, dv_mps, capture_m,
//: margin_m, steps, kind: "flinch" | "stumble" | "fall", stunned, dir (+1: away from the striker) }.
//: ``blow``: { joules, tool (an engine implement id: "fist", ...), strike_mass_kg (else the
//: tool's), aimY, seed }; ``victim``: victimOf().
export function blowOn(M, blow, victim) {
  const { zone, y } = blow.zone ? { zone: blow.zone, y: (BODY_ZONES[blow.zone].h[0] + BODY_ZONES[blow.zone].h[1]) / 2 * victim.height_m } : hitZone(blow.aimY ?? victim.height_m * 0.8, victim.height_m, blow.seed);
  const Z = BODY_ZONES[zone];
  const tool = M.tool(blow.tool || "fist");
  const m = blow.strike_mass_kg ?? tool.strike_mass_kg ?? tool.mass_kg;
  const r = M.strike(tool, zoneBody(M, zone, victim), { feature: "face", energy_j: blow.joules, mode: "swing" });
  const e = clamp(r.restitution ?? 0.3, 0, 1);
  // The body as an inverted pendulum about the feet: its centre of mass at l, struck at h.
  const l = HIT.com_share * victim.height_m, h = Math.max(0.2, y);
  const Meff = victim.kg * (l / h) ** 2 * (Z.guard ? 1 / Z.guard : 1);
  const v = Math.sqrt(2 * Math.max(0, blow.joules) / m);
  const momentum = (1 + e) * (m * Meff / (m + Meff)) * v;
  let dv = momentum * h / (victim.kg * l);
  const capture = dv / Math.sqrt(HIT.g / l);
  const margin = HIT.heel_m + HIT.brace_m * clamp(victim.strength, 0, 100) / 100;
  let steps = capture <= margin ? 0 : Math.ceil((capture - margin) / HIT.step_m);
  // A blow to the head: the head is snapped round on the neck; enough of it stuns, and a stunned
  // person cannot step to catch themselves. Less than that and they are dazed: a step more.
  const neck = 0.6 + 0.8 * clamp(victim.strength, 0, 100) / 100;
  const stunned = zone === "head" && blow.joules >= HIT.head_stun_j * neck;
  if (zone === "head" && !stunned && blow.joules >= HIT.head_stun_j * neck * 0.5) steps += 1;
  const fracture = r.force_n >= HIT.fracture_n[zone];
  const kind = stunned || steps > HIT.max_steps ? "fall" : steps > 0 ? "stumble" : "flinch";
  return { zone, y, force_n: Math.round(r.force_n), fracture, restitution: e, momentum, dv_mps: dv, capture_m: capture, margin_m: margin,
    steps: kind === "fall" ? 0 : steps, kind, stunned, layers: r.layers_reached || [] };
}

//: What someone just hit does next. ``t``: their temperament (temperament.mjs: nerve, temper,
//: patience, care, civic); ``ctx``: { reaction (blowOn's), strength (theirs), attacker (your
//: strength), severity (0-3: the injury's), witnesses (people near who saw), police_near (an
//: officer or a patrol car within sight), phone (they carry one), role, seed }.
//: Returns { act: "down" | "arrest" | "fight" | "call_police" | "run" | "call_help" | "freeze", scores }.
//: What a phone in the pocket adds to calling the police (instinct's score).
export const PHONE_LEAN = 0.1;
export function instinct(t, ctx = {}) {
  const re = ctx.reaction || { kind: "flinch" };
  if (ctx.role === "police" || ctx.role === "patrol") return { act: "arrest", scores: {} };
  if (re.kind === "fall") return { act: "down", scores: {} };
  const edge = clamp(((ctx.strength ?? 50) - (ctx.attacker ?? 50)) / 100, -1, 1);   // + they are the stronger
  const hurt = clamp((ctx.severity ?? 0) / 3, 0, 1), shaken = re.kind === "stumble" ? 0.15 : 0;
  const seen = Math.min(4, ctx.witnesses ?? 0), phone = ctx.phone !== false;
  const scores = {
    // A hot temper and the edge in strength: they come back at you. A hurt or shaken one less so.
    fight: 0.85 * t.temper + 0.7 * edge + 0.25 * t.nerve - 0.35 * hurt - shaken - 0.25 * (1 - t.nerve),
    // Little nerve, outmatched or hurt: they get away.
    run: 0.9 * (1 - t.nerve) - 0.4 * edge + 0.25 * hurt + shaken * 0.5,
    // The street is their business (civic) and they are careful: the police, if they have a phone
    // on them (a pocket for it: npc-figures.mjs NO_POCKETS) -- and having it in reach makes the
    // call the readier (PHONE_LEAN: the phoneless share no longer calls) -- more so with an officer
    // near enough to come at once.
    call_police: phone ? PHONE_LEAN + 0.65 * t.civic + 0.3 * t.care - 0.25 * t.temper + 0.15 * Math.max(0, -edge) + (ctx.police_near ? 0.25 : 0) : -Infinity,
    // People round to call to: the fewer nerve they have, the louder they call.
    call_help: seen ? 0.25 + 0.08 * seen + 0.35 * (1 - t.nerve) + 0.15 * t.civic - 0.2 * t.temper : -Infinity,
    // Frozen to the spot: the rarest, and only the timid.
    freeze: 0.3 * (1 - t.nerve) - 0.25,
  };
  // Each score is rolled a little: two people of one temperament do not always do the same.
  let act = "freeze", best = -Infinity;
  for (const [k, s] of Object.entries(scores)) { const v = s + (unit(`${ctx.seed ?? ""}:${k}`) - 0.5) * 0.3; if (v > best) { best = v; act = k; } }
  return { act, scores };
}

//: The injuries each zone can have (the city's harm.blow bands name them): a blow to the head
//: does not give a broken finger.
export const ZONE_INJURIES = Object.freeze({
  head: ["split lip", "sore jaw", "black eye", "cut brow", "bloody nose", "broken nose", "concussion", "broken jaw", "fractured skull", "severe head injury"],
  chest: ["bruise", "cracked rib", "bruised ribs", "fractured ribs"],
  belly: ["bruise", "bruised ribs", "internal injuries"],
  arm: ["bruise", "broken finger", "broken arm", "sprained wrist", "broken wrist"],
  leg: ["bruise", "bruised knee", "sprained ankle", "broken leg"],
});
//: The injury as it falls on ``zone``: the band's own name for it if the band has one for that
//: zone (the first, by the seed's turn), else the zone's mildest that is no milder than a bruise.
export function injuryAt(injury, zone, bandTypes = [], seed = "") {
  const fits = (ZONE_INJURIES[zone] || []).filter((t) => bandTypes.includes(t));
  if (!fits.length) return { ...injury, zone };
  return { ...injury, type: fits[Math.floor(unit(`${seed}:type`) * fits.length) % fits.length], zone };
}
//: The world's word for each act (world.mjs cmd_strike_person ``response``).
export const RESPONSE = Object.freeze({ down: "down", arrest: "arrest", fight: "hit back", call_police: "call police", run: "flee", call_help: "call for help", freeze: "freeze" });
