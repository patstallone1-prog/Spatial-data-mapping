// What you can do here, now: every control declared once -- its key, when it applies, what it is
// called here, and why not when it is close but cannot be done -- for the keys, the hint strip and
// the controls window alike (docs/63). Pure (tests/city_affordances.test.mjs).
//
// The hint strip shows the controls that are particular to where you are and what you hold: never
// walking (the arrows) or jumping (Space) where you always can -- only when they do something out of
// the ordinary (the arrows climbing a wall, Space onto a wall's top or off it).
//
// The state (view.mjs hintState builds it each few frames):
//   { mode: "walk" | "drive" | "ride" | "swim" | "climb" | "perch" | "fork" | "air" | "seated" | "inside",
//     held: { id, name, kind, strike, use, wear, food, drink, tip, edge, two_hands, nails } | null,
//     front: { thing: { name, material, wood, chainlink, person, loose }, climb: { name, kind, ok, reason },
//              jump: { action, name } } , under: { kind, name, soil } | null (the ground underfoot),
//     ground: { name } | null, prompt: { yes, no } | null, eating: { label } | null }

//: A key as its cap shows it.
export const KEY_CAP = { " ": "Space", arrows: "↑↓←→", Enter: "Enter" };
export const capOf = (key) => KEY_CAP[key] || key.toUpperCase();

const lower = (s) => String(s || "").toLowerCase();
const the = (t) => `the ${lower(t?.name || "thing")}`;
//: What a held thing is for: its strike kind (rules.json items' strike) by name.
export const TOOLS = {
  axe: { swing: "Chop", work: null, thrust: null },
  saw: { swing: null, work: "Saw", thrust: null },
  sledgehammer: { swing: "Smash", work: null, thrust: "Ram" },
  hammer: { swing: "Hammer", work: null, thrust: null },
  crowbar: { swing: "Swing", work: "Pry", thrust: "Jab" },
  bolt_cutters: { swing: null, work: "Cut", thrust: null },
  // Their R is their own control below (dig, carve, hammer in), not a blow of work.
  shovel: { swing: "Swing", work: null, thrust: "Jab" },
  knife: { swing: "Slash at", work: null, thrust: "Stab" },
};

//: Every control: { id, key, verb, when(s) → applies?, label(s), priority (higher first), ok(s) →
//: true or the reason it cannot be done }.
export const CONTROLS = [
  // Climbing and jumping.
  { id: "climb", key: "e", verb: "Climb", priority: 60, when: (s) => s.mode === "walk" && Boolean(s.front?.climb),
    label: (s) => `Climb ${the(s.front.climb)}`, ok: (s) => s.front.climb.ok !== false || s.front.climb.reason || "Nothing to hold on to" },
  { id: "let_go", key: "e", verb: "Let go", priority: 50, when: (s) => s.mode === "climb" || s.mode === "fork", label: () => "Let go", ok: () => true },
  { id: "climb_arrows", key: "arrows", verb: "Climb", priority: 70, when: (s) => s.mode === "climb", label: () => "Climb (two for a diagonal)", ok: () => true },
  { id: "walk_top", key: "arrows", verb: "Walk the top", priority: 65, when: (s) => s.mode === "perch", label: () => "Walk along the top", ok: () => true },
  { id: "jump_off", key: " ", verb: "Jump off", priority: 66, when: (s) => s.mode === "climb" || s.mode === "perch" || s.mode === "fork", label: (s) => (s.mode === "climb" ? "Push off" : "Jump down"), ok: () => true },
  { id: "jump_at", key: " ", verb: "Jump", priority: 55, when: (s) => s.mode === "walk" && Boolean(s.front?.jump && s.front.jump.action !== "none"),
    label: (s) => ({ land_top: `Jump onto ${the(s.front.jump)}`, vault: `Vault ${the(s.front.jump)}`, catch_top: `Jump up ${the(s.front.jump)}`, catch_holds: `Jump onto ${the(s.front.jump)}` }[s.front.jump.action] || "Jump"), ok: () => true },
  // Eating and drinking.
  { id: "sip", key: "u", verb: "Sip", priority: 45, when: (s) => Boolean(s.held?.drink && s.eating), label: (s) => `Sip the ${lower(s.held.name)} (hold: drink it)`, ok: () => true },
  { id: "bite", key: "u", verb: "Eat", priority: 45, when: (s) => Boolean(s.held?.food && !s.held.drink && s.eating), label: (s) => `${s.eating?.label || "A bite"} of the ${lower(s.held.name)} (hold: eat it)`, ok: () => true },
  { id: "use", key: "u", verb: "Use", priority: 40, when: (s) => Boolean(s.held && !s.held.food && (s.held.use || s.held.wear)), label: (s) => (s.held.wear ? `Wear the ${lower(s.held.name)}` : `Use the ${lower(s.held.name)}`), ok: () => true },
  // What is held, on what is in front.
  { id: "swing", key: "x", verb: "Swing", priority: 35, when: (s) => (s.mode === "walk" || s.mode === "inside") && Boolean(s.front?.thing),
    label: (s) => {
      if (!s.held) return `Punch ${the(s.front.thing)}`;
      const v = TOOLS[s.held.strike]?.swing;
      return `${v === "Chop" && !s.front.thing.wood ? "Swing at" : v || "Swing at"} ${the(s.front.thing)}`;
    },
    ok: (s) => (s.held?.two_hands && !s.held.strike ? "Both hands are full" : true) },
  { id: "thrust", key: "c", verb: "Thrust", priority: 34, when: (s) => (s.mode === "walk" || s.mode === "inside") && Boolean(s.front?.thing && !s.front.thing.person) && Boolean(s.held && (TOOLS[s.held.strike]?.thrust || s.held.tip)),
    label: (s) => `${TOOLS[s.held.strike]?.thrust || "Stab"} ${the(s.front.thing)}`, ok: () => true },
  { id: "work", key: "r", verb: "Work", priority: 36, when: (s) => (s.mode === "walk" || s.mode === "inside") && Boolean(s.front?.thing && !s.front.thing.person) && Boolean(TOOLS[s.held?.strike]?.work),
    label: (s) => `${TOOLS[s.held.strike].work} ${the(s.front.thing)} (hold)`,
    ok: (s) => { const w = TOOLS[s.held.strike].work, t = s.front.thing;
      if (w === "Saw" && !t.wood) return `A saw cuts wood: ${the(t)} is ${lower(t.material)}`;
      if (w === "Cut" && !t.chainlink && t.material !== "steel") return "Bolt cutters cut wire and chain";
      return true; } },
  // Empty-handed, C pushes. Its chip is only for something loose to push along: shoving a person
  // is always there to do, so it is never hinted.
  { id: "push", key: "c", verb: "Push", priority: 33, when: (s) => (s.mode === "walk" || s.mode === "inside") && !s.held && Boolean(s.front?.thing?.loose && !s.front.thing.person),
    label: (s) => `Push ${the(s.front.thing)}`, ok: () => true },
  // R with a spade, a knife or a hammer: digging, carving and driving nails (mechanics-work.mjs).
  { id: "dig", key: "r", verb: "Dig", priority: 37, when: (s) => s.mode === "walk" && s.held?.strike === "shovel" && Boolean(s.under),
    label: (s) => `Dig the ${lower(s.under.name)} (hold)`, ok: (s) => s.under.soil || `A spade will not go into the ${lower(s.under.name)}` },
  { id: "carve", key: "r", verb: "Carve", priority: 36, when: (s) => (s.mode === "walk" || s.mode === "inside") && s.held?.strike === "knife" && Boolean(s.front?.thing && !s.front.thing.person),
    label: (s) => `Carve ${the(s.front.thing)} (hold)`, ok: (s) => s.front.thing.wood || `A knife carves wood: ${the(s.front.thing)} is ${lower(s.front.thing.material)}` },
  { id: "hammer_in", key: "r", verb: "Hammer in", priority: 36, when: (s) => (s.mode === "walk" || s.mode === "inside") && s.held?.strike === "hammer" && Boolean(s.front?.thing && !s.front.thing.person),
    label: (s) => `Nail into ${the(s.front.thing)} (tap R, steadily)`,
    ok: (s) => (!s.front.thing.wood ? "Nails go into wood" : (s.held.nails || 0) > 0 || "No nails: a box of nails at the hardware store") },
  { id: "throw", key: "q", verb: "Throw", priority: 20, when: (s) => s.mode === "walk" && Boolean(s.held && !s.held.food), label: (s) => `Throw the ${lower(s.held.name)}`, ok: () => true },
  { id: "pick_up", key: "g", verb: "Pick up", priority: 30, when: (s) => (s.mode === "walk" || s.mode === "inside") && Boolean(s.ground), label: (s) => `Pick up ${the(s.ground)}`, ok: () => true },
  // A question on screen.
  { id: "yes", key: "y", verb: "Yes", priority: 90, when: (s) => Boolean(s.prompt), label: (s) => s.prompt.yes || "Yes", ok: () => true },
  { id: "no", key: "n", verb: "No", priority: 89, when: (s) => Boolean(s.prompt?.no), label: (s) => s.prompt.no || "No", ok: () => true },
];

//: The keys the city binds (view.mjs KEYS and the arrows), for the check that every control's key
//: is one (tests).
export const BOUND = ["e", " ", "arrows", "u", "x", "c", "r", "q", "g", "y", "n"];

//: What applies now: [{ id, key, cap, verb, label, priority, ok, reason }], highest priority first.
export function affordances(s) {
  const out = [];
  for (const c of CONTROLS) {
    let applies = false;
    try { applies = c.when(s); } catch { applies = false; }
    if (!applies) continue;
    const ok = c.ok(s);
    out.push({ id: c.id, key: c.key, cap: capOf(c.key), verb: c.verb, label: c.label(s), priority: c.priority, ok: ok === true, reason: ok === true ? null : ok });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

//: The strip's chips: at most ``max``, one a key (the best for it), each shortened as it is
//: learned -- in full the first five times it is shown, then the key and its verb, and after twenty
//: uses only when something new is in front. ``counts``: {id: uses}; ``setting``: full | short | off.
export function hintChips(list, { counts = {}, setting = "full", max = 4, seenKinds = null } = {}) {
  if (setting === "off") return [];
  const byKey = new Map();
  for (const a of list) if (!byKey.has(a.key)) byKey.set(a.key, a);
  const out = [];
  for (const a of byKey.values()) {
    const n = counts[a.id] || 0;
    // Well learned: shown only for something new in front (a label not seen before).
    if (n >= 20 && a.ok && !(seenKinds && !seenKinds.has(a.label))) continue;
    const full = setting === "full" && n < 5;
    out.push({ id: a.id, key: a.key, cap: a.cap, text: !a.ok ? `${a.verb}: ${a.reason}` : full ? a.label : a.verb, ok: a.ok });
    if (out.length >= max) break;
  }
  return out;
}

//: Steadiness: chips stay at least ``hold`` seconds once shown (so turning on the spot does not
//: make them flicker). ``prev``: [{chip, since}]; returns the new [{chip, since}].
export function steady(prev, chips, now, hold = 0.6) {
  const out = [];
  const ids = new Set(chips.map((c) => c.id));
  for (const c of chips) { const was = prev.find((p) => p.chip.id === c.id); out.push({ chip: c, since: was ? was.since : now }); }
  for (const p of prev) if (!ids.has(p.chip.id) && now - p.since < hold) out.push(p);
  return out.slice(0, 4);
}
