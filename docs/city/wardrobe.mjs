// What people wear and what they look like: a garment for the top and one for the legs, in
// colours that go with the garment and with each other, chosen for who the person is -- a
// lawyer in a suit, a nurse in scrubs, a runner with a bright temperament in pink running gear, a
// student in a hoodie and jeans -- and a skin tone and hair from San Francisco's own population.
//
// Everything is drawn from the person's id (and their work and temperament), so a person looks
// the same every time and nothing is stored.
import { hash32 } from "./people.mjs";

//: A stream of uniforms (0..1) for ``id`` and ``salt``, the same every time.
function stream(id, salt) {
  let s = hash32(String(id ?? "?"), salt) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const pick = (r, list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
//: A pick by weight ({key: weight}).
function weighted(r, table) {
  const total = Object.values(table).reduce((t, w) => t + w, 0);
  let x = r() * total;
  for (const [k, w] of Object.entries(table)) { x -= w; if (x < 0) return k; }
  return Object.keys(table).at(-1);
}

// ---- who people are --------------------------------------------------------------------------
//: San Francisco's people by heritage (2020 census, city and county): White (not Hispanic) 39%,
//: Asian 34%, Hispanic or Latino 15.6%, Black 5.1%, two or more and the rest (Pacific Islander,
//: Native American, Middle Eastern, South Asian counted apart here) 6.3%.
export const SF_HERITAGE = { white: 0.39, east_asian: 0.27, southeast_asian: 0.07, hispanic: 0.156, black: 0.051, south_asian: 0.025, mixed: 0.038 };
//: Skin (sRGB) by heritage. Each heritage has one anchor tone, and a person is drawn somewhere in
//: a range about it: ``range`` is how far lighter and darker (the tone's light, times this), so
//: no two people need be the same and nobody leaves their own heritage's range. The anchors'
//: brightness is skin's own, measured (the share of light it throws back, 400-700 nm: about 0.35
//: for light European and East Asian skin, 0.25 for medium, 0.08 for dark African skin), not a
//: screen colour picked by eye: a figure in the sun is lit to several times its colour, and a
//: tone chosen to look right as a swatch is chalk-white outdoors.
export const SKIN_ANCHORS = {
  white: { tone: "#c99473", range: [0.8, 1.15] },
  east_asian: { tone: "#c4996b", range: [0.8, 1.12] },
  southeast_asian: { tone: "#a97c52", range: [0.75, 1.2] },
  hispanic: { tone: "#b58560", range: [0.7, 1.2] },
  black: { tone: "#6b452e", range: [0.55, 1.5] },
  south_asian: { tone: "#996a45", range: [0.7, 1.25] },
  mixed: { tone: "#a87a55", range: [0.6, 1.3] },
};
//: The palest a skin is drawn: its relative luminance (0..1) never over this. A hard limit: the
//: tones are held to it here, and the crowd's shader holds what it draws to it again.
export const SKIN_LIGHTEST = 0.4;
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
//: A person's skin: their heritage's anchor, ``t`` (0..1) of the way from the darkest of its
//: range to the lightest, and ``warm`` (0..1) a little redder or yellower. Never over SKIN_LIGHTEST.
export function skinTone(heritage, t = 0.5, warm = 0.5) {
  const A = SKIN_ANCHORS[heritage] || SKIN_ANCHORS.mixed, n = parseInt(A.tone.slice(1), 16);
  const k = A.range[0] + Math.max(0, Math.min(1, t)) * (A.range[1] - A.range[0]), w = (Math.max(0, Math.min(1, warm)) - 0.5) * 0.08;
  let rgb = [toLinear((n >> 16) & 255) * k * (1 + w), toLinear((n >> 8) & 255) * k, toLinear(n & 255) * k * (1 - w)];
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (y > SKIN_LIGHTEST) rgb = rgb.map((v) => v * SKIN_LIGHTEST / y);
  return "#" + rgb.map((v) => toSrgb(v).toString(16).padStart(2, "0")).join("");
}
//: Hair (sRGB) by heritage: black and the browns everywhere; blond, light brown and red mostly
//: among the white.
const HAIR_TONES = {
  dark: ["#14100d", "#1b1410", "#231913", "#2b1d14"],
  brown: ["#3b2a1d", "#4a3322", "#5a3d26"],
  light: ["#7a5a3a", "#a8834f", "#c9a66b", "#6b2b1a"],
};
const HAIR_MIX = {
  white: { dark: 0.25, brown: 0.45, light: 0.3 },
  east_asian: { dark: 0.9, brown: 0.1, light: 0 }, southeast_asian: { dark: 0.9, brown: 0.1, light: 0 },
  hispanic: { dark: 0.65, brown: 0.32, light: 0.03 }, black: { dark: 0.92, brown: 0.08, light: 0 },
  south_asian: { dark: 0.92, brown: 0.08, light: 0 }, mixed: { dark: 0.55, brown: 0.38, light: 0.07 },
};

export function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16), lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

//: A person's heritage, skin and hair colour (``grey``: their hair has gone grey).
export function looksOf(person, { grey = false } = {}) {
  const r = stream(person?.id, "looks");
  const heritage = weighted(r, SF_HERITAGE);
  const skin = skinTone(heritage, r(), r());
  const hair = grey ? (r() < 0.5 ? "#8f8f8f" : "#d8d2c4") : pick(r, HAIR_TONES[weighted(r, HAIR_MIX[heritage])]);
  return { heritage, skin, hair };
}

// ---- what people wear --------------------------------------------------------------------------
//: The tops (``trim``: how the shader marks it; codes in TOP_CODE) and the legs.
export const TOPS = ["tee", "sweatshirt", "hoodie", "button_up", "suit", "running", "scrubs", "work_jacket", "hi_vis", "chef"];
export const TOP_CODE = Object.fromEntries(TOPS.map((t, i) => [t, i + 1]));
export const BOTTOMS = ["jeans", "chinos", "suit_trousers", "sweatpants", "shorts", "running_shorts", "skirt", "scrubs", "work_trousers"];
export const BOTTOM_CODE = Object.fromEntries(BOTTOMS.map((t, i) => [t, i + 1]));

//: Colours that go with each garment (sRGB). ``vivid``: the bright ones, worn by the bold.
const C = {
  tee: { calm: ["#f2f1ec", "#1e1e22", "#2e4057", "#9aa3ab", "#3f6e4a", "#6b5b45", "#7d8a96"], vivid: ["#d64045", "#e3c45c", "#2e86c1", "#e2711d", "#8e44ad", "#16a085", "#f06292"] },
  sweatshirt: { calm: ["#9a9da3", "#24324d", "#2f4a3a", "#6a2433", "#cfc4ae", "#1f1f23", "#5b5f66"], vivid: ["#c6952f", "#3a7bd5", "#d1495b", "#4caf50", "#7e57c2"] },
  button_up: { calm: ["#f4f4f2", "#b9cfe6", "#e8dfd0", "#7d97b5", "#dfe7ef", "#c9d3c0"], vivid: ["#e8c6cc", "#f3d27a", "#9fc5e8", "#b4a7d6"] },
  suit: { calm: ["#1d2230", "#2b2f36", "#3a3f47", "#25324a", "#4a4036", "#1a1a1c"], vivid: ["#3d4f7a", "#5a3c4b", "#4f6a5a"] },
  running: { calm: ["#2b2d33", "#24324d", "#5b5f66", "#3a6b8c"], vivid: ["#ff4f9a", "#ff7a2e", "#22c1ee", "#a3e635", "#a35cff", "#ff3d5a", "#ffd23f"] },
  jeans: ["#2b3a55", "#34496b", "#3f5a80", "#4d6a92", "#1f2a3d", "#5c6f8c", "#202226"],
  suit_trousers: ["#1d2230", "#2b2f36", "#3a3f47", "#25324a", "#4a4036", "#5a5d63"],
  chinos: ["#b9a27c", "#8c7a5b", "#5f5a4c", "#3e4a3d", "#c9bda3", "#2f3440"],
  sweatpants: ["#8a8d91", "#2b2d31", "#3c4a5e", "#5b4a6b", "#6d6f73", "#1f2a3d"],
  shorts: ["#c2b59b", "#8c7a5b", "#3f5a80", "#2b2d31", "#5f6b4e"],
  running_shorts: ["#1c1d21", "#24324d", "#3a3d44", "#b8bcc4", "#d9dbe0"],
  skirt: { calm: ["#1f1f23", "#2c3440", "#6b5b45", "#4b5563", "#7a3b3b", "#c2b59b"], vivid: ["#b03a5b", "#2e86c1", "#e3a72f", "#3f8a5a"] },
  shoes: { dress: ["#1b1b1d", "#3b2a1e", "#2a211b"], sneaker: ["#e8e6e1", "#1f2430", "#8a8f99", "#f2f2f2", "#2b2d33"], work: ["#1b1b1d", "#3b2a1e", "#4a3a2a"], running: ["#f2f2f2", "#ff4f9a", "#22c1ee", "#a3e635", "#1f1f23"] },
  tie: ["#7b1f2b", "#1f3a66", "#2f4a3a", "#5a2a5e", "#8a6d1e", "#202124"],
};
//: Work that is done in its own clothes: {role: [top, bottom]} (the top in the role's uniform colour).
export const WORK_DRESS = {
  police: ["button_up", "work_trousers"], security_guard: ["button_up", "work_trousers"], firefighter: ["work_jacket", "work_trousers"],
  nurse: ["scrubs", "scrubs"], pharmacist: ["button_up", "chinos"], pharmacy_tech: ["scrubs", "scrubs"],
  cook: ["chef", "work_trousers"], baker: ["chef", "work_trousers"], server: ["button_up", "work_trousers"], bartender: ["button_up", "work_trousers"],
  barista: ["tee", "jeans"], clerk: ["tee", "chinos"], grocer: ["tee", "chinos"], stylist: ["tee", "jeans"], laundry_attendant: ["tee", "jeans"],
  janitor: ["work_jacket", "work_trousers"], housekeeper: ["scrubs", "scrubs"], mechanic: ["work_jacket", "work_trousers"],
  attendant: ["tee", "work_trousers"], parking_attendant: ["hi_vis", "work_trousers"], street_cleaner: ["hi_vis", "work_trousers"], construction: ["hi_vis", "jeans"],
  warehouse_worker: ["hi_vis", "work_trousers"], delivery_driver: ["tee", "work_trousers"], mail_carrier: ["button_up", "shorts"],
  bus_driver: ["button_up", "work_trousers"], taxi_driver: ["button_up", "chinos"],
};
//: Work done at a desk: what is worn to it, by how formal the work is.
const DESK = {
  formal: { tops: { suit: 0.55, button_up: 0.45 }, bottoms: { suit_trousers: 1 } },
  office: { tops: { button_up: 0.5, sweatshirt: 0.15, tee: 0.15, suit: 0.2 }, bottoms: { chinos: 0.55, jeans: 0.25, suit_trousers: 0.2 } },
  tech: { tops: { hoodie: 0.35, tee: 0.35, sweatshirt: 0.15, button_up: 0.15 }, bottoms: { jeans: 0.7, chinos: 0.3 } },
};
const DESK_ROLE = { teller: "formal", night_auditor: "office", office_worker: "office", civil_servant: "office", teacher: "office", software_engineer: "tech", remote_worker: "tech" };
//: A title that says the job is done in a suit (careers and businesses name them).
const SUIT_TITLE = /lawyer|attorney|counsel|banker|broker|executive|director|partner|judge|manager|finance|accountant|consultant|realtor|ceo|cfo|president/i;
//: Off work, everyone else: shares of each top and each bottom. San Francisco is cool and
//: casual: sweatshirts and hoodies are common, shorts are few.
export const CASUAL = {
  tops: { tee: 0.3, sweatshirt: 0.22, hoodie: 0.16, button_up: 0.2, running: 0.02 },
  bottoms: { jeans: 0.5, chinos: 0.18, sweatpants: 0.14, shorts: 0.1 },
};
//: The share of adults (under 60) dressed to run, more of the quick walkers.
export const RUNNER_SHARE = 0.08;

//: How bold a person dresses, 0..1, from their temperament (quick to push on and not careful:
//: bright; patient and careful: plain).
export function boldness(t) {
  if (!t) return 0.4;
  return Math.max(0, Math.min(1, 0.55 * t.temper + 0.3 * (1 - t.care) + 0.15 * t.civic));
}
//: A colour for a garment: from its vivid ones for the bold.
function colourOf(r, list, bold) {
  if (Array.isArray(list)) return pick(r, list);
  return pick(r, r() < bold * 0.75 ? list.vivid : list.calm);
}
//: The top's colour against the bottom's: a light top over a dark bottom and the other way,
//: so the two read apart (two near the same value and hue read as one, which is a uniform's look).
function apart(r, top, list) {
  const lt = luminance(top);
  const all = Array.isArray(list) ? list : [...list.calm, ...list.vivid];
  const cands = all.filter((c) => Math.abs(luminance(c) - lt) > 0.08);
  if (cands.length) return pick(r, cands);
  // None far enough: the one furthest from it.
  return all.reduce((best, c) => (Math.abs(luminance(c) - lt) > Math.abs(luminance(best) - lt) ? c : best), all[0]);
}

//: Whether ``person`` is one who runs (dressed for it by dressFor, and out for a run when they
//: go for a stroll): adults under 60 not in work clothes or a suit, RUNNER_SHARE of them, more of
//: the quick walkers. ``r`` is dressFor's own stream (its first draw is this one).
function runnerDraw(person, r) {
  const age = person?.age ?? 35, role = person?.role;
  const work = role && WORK_DRESS[role], desk = SUIT_TITLE.test(person?.title || "") || DESK_ROLE[role];
  return !work && !desk && age >= 16 && age < 60 && r() < RUNNER_SHARE * ((person?.pace ?? 1.3) > 1.42 ? 1.8 : 0.7);
}
const runners = new Map();
export function isRunner(person) {
  const id = person?.id;
  let v = runners.get(id);
  if (v === undefined) { v = runnerDraw(person, stream(id, "dress")); if (runners.size > 20000) runners.clear(); runners.set(id, v); }
  return v;
}

//: What ``person`` ({id, age, role, title, uniform, pace}) wears. ``body`` {female, bald} and
//: ``temperament`` (temperament.mjs) shape it. The result keeps the fields the figures read
//: (bottom: trousers|shorts|skirt, bottoms, sleeves, shoes, hair) and adds the garments
//: (``top``, its colour ``topColour``, ``legs``), ``trim`` (a collar, a placket, a shirt under a
//: jacket, a stripe) and ``tie``.
export function dressFor(person, body, temperament, shares = { skirt_female: 0.3, short_sleeves: 0.34, long_hair_female: 0.62, long_hair_male: 0.08, collar_hair: 0.22 }) {
  const r = stream(person?.id, "dress"), age = person?.age ?? 35;
  const bold = Math.min(1, boldness(temperament) + (age < 30 ? 0.15 : age > 60 ? -0.2 : 0));
  const role = person?.role, work = role && WORK_DRESS[role] ? WORK_DRESS[role] : null;
  const desk = SUIT_TITLE.test(person?.title || "") ? "formal" : DESK_ROLE[role];
  const runner = runnerDraw(person, r);
  let top, legs;
  if (work) [top, legs] = work;
  else if (desk) { top = weighted(r, DESK[desk].tops); legs = weighted(r, DESK[desk].bottoms); }
  else if (runner) { top = "running"; legs = r() < 0.6 ? "running_shorts" : "sweatpants"; }
  else { top = weighted(r, CASUAL.tops); legs = weighted(r, CASUAL.bottoms); }
  if (top === "suit") legs = "suit_trousers";
  if (top === "running" && !["running_shorts", "sweatpants"].includes(legs)) legs = "running_shorts";
  // A woman not at work or running wears a skirt a share of the time.
  if (!work && !runner && body?.female && r() < shares.skirt_female) legs = "skirt";
  // The colours: a uniform's for work; else the garment's, the bottom set apart from the top.
  const garment = top === "hoodie" ? "sweatshirt" : top;
  const topColour = work ? person.uniform || "#566573" : colourOf(r, C[garment] || C.tee, bold);
  const legColour = (legs === "suit_trousers" || legs === "skirt") && top === "suit" ? topColour
    : legs === "scrubs" ? topColour
    : legs === "work_trousers" ? pick(r, ["#1f2430", "#2b2f36", "#3a3f47", "#2c3440"])
    : legs === "skirt" ? apart(r, topColour, C.skirt)
    : apart(r, topColour, C[legs] || C.jeans);
  const shoeKind = top === "running" ? "running" : top === "suit" || legs === "suit_trousers" ? "dress" : work ? "work" : "sneaker";
  // The trim: a suit's shirt (and its tie), a button-up's collar and placket, a hoodie's or a
  // sweatshirt's ribbed hem and cuffs, running gear's stripe, hi-vis's reflective band.
  const trim = top === "suit" ? pick(r, ["#f4f4f2", "#dfe7ef", "#b9cfe6"])
    : top === "button_up" ? shade(topColour, 0.86)
    : top === "sweatshirt" || top === "hoodie" ? shade(topColour, 0.78)
    : top === "running" ? (luminance(topColour) > 0.35 ? "#1f1f23" : "#f2f2f2")
    : top === "hi_vis" ? "#d9dde0"
    : top === "chef" ? "#e8e8e8"
    : shade(topColour, 0.9);
  const shortSleeves = top === "suit" || top === "hoodie" || top === "sweatshirt" || top === "work_jacket" || top === "chef" ? false
    : top === "scrubs" || top === "running" || top === "tee" ? r() < (top === "tee" ? 0.75 : 0.85)
    : !work && r() < shares.short_sleeves * 0.5;
  const long = body?.female ? shares.long_hair_female : shares.long_hair_male, hairDraw = r();
  return {
    top, legs, topColour, trim,
    tie: top === "suit" && r() < 0.6 ? pick(r, C.tie) : null,
    // The legs' marks: sweatpants' cuffs, running shorts' stripe (light on dark), a crease.
    legTrim: legs === "running_shorts" ? (luminance(topColour) > 0.2 ? topColour : "#e8e8e8") : shade(legColour, legs === "sweatpants" ? 0.75 : 1.1),
    bottom: legs === "skirt" ? "skirt" : legs === "shorts" || legs === "running_shorts" ? "shorts" : "trousers",
    bottoms: legColour,
    sleeves: shortSleeves ? "short" : "long",
    shoes: pick(r, C.shoes[shoeKind]),
    hair: body?.bald ? "none" : hairDraw < long ? "long" : hairDraw < long + shares.collar_hair ? "collar" : "short",
  };
}
//: ``hex`` darker (k < 1) or lighter (k > 1), as sRGB.
export function shade(hex, k) {
  const n = parseInt(String(hex).slice(1), 16);
  const ch = (c) => Math.max(0, Math.min(255, Math.round(k < 1 ? c * k : c + (255 - c) * (k - 1))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => ch(c).toString(16).padStart(2, "0")).join("")}`;
}
