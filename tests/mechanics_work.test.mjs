// Work by hand (docs/city/mechanics-work.mjs) and the contact laws it leans on in the engine
// (docs/city/mechanics.mjs): only the touching feature's sharpness is measured, blunt blows glance
// and land on their rim, a nail drives or bends by the hammer's angle, a spade digs by the soil, a
// push moves by strength and footing, a shove by balance, a knife carves by its edge.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMechanics } from "../docs/city/mechanics.mjs";
import { WORK, createWork } from "../docs/city/mechanics-work.mjs";

const DATA = JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url), "utf8"));
const M = createMechanics(DATA);
const K = createWork(M);
const block = (s, t = 0.15) => M.body({ substance: s, shape: "block", thickness_m: t });
const round = (s, d = 0.25) => M.body({ substance: s, shape: "round", diameter_m: d, length_m: 3, fixed: true, upright: true });

//: Blows of a hammer at ``angle`` until the nail is home, bent, or ``n`` blows.
function nailIn(wood, angle, n = 20, energy = 50) {
  let s = K.startNail(M.tool("nail"), block(wood));
  let r = null;
  for (let i = 0; i < n && !s.home && !s.bent; i++) { r = K.drive(M.tool("claw_hammer"), s, { energy_j: energy, angle_deg: angle }); s = r.state; }
  return { s, r };
}

// ---- only the touching feature's sharpness counts -------------------------------------------------

test("a knife's point keeps its own sharpness: chopping dulls the edge, not the stab", () => {
  const fresh = M.tool("chef_knife");
  let worn = fresh;
  for (let i = 0; i < 40; i++) worn = M.strike(worn, block("concrete", 0.1), { feature: "edge", energy_j: 5, slice: 2 }).tool;
  assert.ok(worn.edge_radius_m > 3 * fresh.edge_radius_m, "the edge is dulled");
  assert.equal(worn.tip_side_radius_m, fresh.tip_side_radius_m, "the point's sides are not");
  const stab = (t) => M.strike(t, round("white_pine_dry"), { feature: "tip", energy_j: 10, grain: "along", mode: "swing" }).depth_m;
  assert.equal(stab(worn), stab(fresh));
});

test("and the reverse: a blunted point stabs worse but slices the same", () => {
  const fresh = M.tool("chef_knife"), blunt = { ...fresh, tip_radius_m: 0.003, tip_side_radius_m: 2e-4 };
  const stab = (t) => M.strike(t, round("white_pine_dry"), { feature: "tip", energy_j: 10, grain: "along", mode: "swing" }).depth_m;
  const slice = (t) => M.strike(t, round("white_pine_dry"), { feature: "edge", energy_j: 10, slice: 1 }).depth_m;
  assert.ok(stab(blunt) < 0.9 * stab(fresh), `${stab(blunt)} vs ${stab(fresh)}`);
  assert.equal(slice(blunt), slice(fresh));
});

// ---- blunt contacts: the rim and the glance -------------------------------------------------------

test("a hammer square to the work dents round; canted past its crown it lands on the rim", () => {
  const sq = M.strike(M.tool("claw_hammer"), block("douglas_fir_dry"), { feature: "face", energy_j: 30 });
  const cant = M.strike(M.tool("claw_hammer"), block("douglas_fir_dry"), { feature: "face", energy_j: 30, face_tilt_deg: 12 });
  assert.equal(sq.on_rim, false);
  assert.equal(cant.on_rim, true);
  assert.ok(cant.depth_m > sq.depth_m, "the rim goes deeper");
  assert.ok(cant.mark.crescent_m > 0, "and leaves a crescent");
  // Within the crown (about 5 degrees for a 0.15 m crown on a 25 mm face) it is still the face.
  assert.equal(M.strike(M.tool("claw_hammer"), block("douglas_fir_dry"), { feature: "face", energy_j: 30, face_tilt_deg: 3 }).on_rim, false);
});

test("blunt blows glance once the slant passes friction and the dent's wall", () => {
  const at = (s, a) => M.strike(M.tool("claw_hammer"), block(s), { feature: "face", energy_j: 50, angle_deg: a, face_tilt_deg: 0 });
  assert.equal(at("mild_steel", 0).glanced, false);
  assert.equal(at("mild_steel", 70).glanced, true);
  assert.equal(at("mild_steel", 70).outcome, "glance");
  // Soft wood takes a dent deep enough to hold the face at a slant that skids on steel.
  const a = [20, 30, 40, 50, 60, 70].find((x) => at("mild_steel", x).glanced);
  const b = [20, 30, 40, 50, 60, 70, 80].find((x) => at("white_pine_dry", x).glanced) ?? 90;
  assert.ok(b > a, `steel skids from ${a}°, pine from ${b}°`);
  // A fist glances too.
  assert.equal(M.strike(M.tool("fist"), block("douglas_fir_dry"), { feature: "face", energy_j: 30, angle_deg: 60 }).glanced, true);
});

test("the steeper an edge's slant, the less it bites, and a point glances like an edge", () => {
  const d = [0, 30, 60].map((a) => M.strike(M.tool("ice_axe"), block("ice", 0.3), { feature: "tip", energy_j: 60, angle_deg: a, mode: "swing" }).depth_m);
  assert.ok(d[0] >= d[1] && d[1] >= d[2], d.join(" "));
});

// ---- hammering a nail ---------------------------------------------------------------------------

test("square blows drive a 16d nail home in a carpenter's handful of blows", () => {
  for (const wood of ["white_pine_dry", "douglas_fir_dry", "white_oak_dry"]) {
    const { s, r } = nailIn(wood, 0);
    assert.ok(s.home, `${wood}: ${r.text}`);
    assert.ok(s.blows >= 4 && s.blows <= 10, `${wood}: ${s.blows} blows`);
    assert.match(r.text, /driven home/);
  }
});

test("the first blow on a fresh nail is a set tap", () => {
  const s0 = K.startNail(M.tool("nail"), block("douglas_fir_dry"));
  const one = K.drive(M.tool("claw_hammer"), s0, { energy_j: 50 });
  const two = K.drive(M.tool("claw_hammer"), one.state, { energy_j: 50 });
  assert.ok(two.driven_m > one.driven_m, `${one.driven_m} then ${two.driven_m}`);
});

test("the hammer's angle decides: within the crown it drives, past it the nail bends", () => {
  assert.ok(nailIn("douglas_fir_dry", 4).s.home, "4° is inside the face's crown");
  const off = nailIn("douglas_fir_dry", 15);
  assert.ok(off.s.bent && !off.s.home, off.r.text);
  assert.match(off.r.text, /15° off square: it bends over/);
  // Harder wood is less forgiving: 10° drives pine home, bends it in oak.
  assert.ok(nailIn("white_pine_dry", 10).s.home);
  assert.ok(nailIn("white_oak_dry", 10).s.bent);
  // The more off, the sooner it bends.
  assert.ok(nailIn("douglas_fir_dry", 25).s.blows < off.s.blows);
});

test("a bent nail will not drive, and a driven one holds by the NDS withdrawal value", () => {
  const { s } = nailIn("douglas_fir_dry", 25);
  const again = K.drive(M.tool("claw_hammer"), s, { energy_j: 50 });
  assert.equal(again.outcome, "bent");
  assert.equal(again.driven_m, 0);
  const home = nailIn("douglas_fir_dry", 0).r;
  const nds = 1380 * 0.48 ** 2.5 * (0.0033 / 0.0254) * 175.13 * 0.089;
  assert.ok(Math.abs(home.holds_n - nds) / nds < 0.05, `${home.holds_n} vs ${nds}`);
});

test("a skid off the head dents the wood beside it (hammer rash)", () => {
  const s0 = { ...K.startNail(M.tool("nail"), block("white_pine_dry")), driven_m: 0.03, work_j: 20 };
  const r = K.drive({ ...M.tool("claw_hammer"), face: { kind: "flat", radius_m: Infinity, diameter_m: 0.025 } }, s0, { energy_j: 50, angle_deg: 40 });
  assert.equal(r.glanced, true);
  assert.ok(r.rash && r.rash.depth_m > 0, JSON.stringify(r.rash));
  assert.match(r.text, /skids off the head/);
});

// ---- digging ---------------------------------------------------------------------------------------

test("a spade goes furthest into sand and duff, less into loam, least into turf; never into paving", () => {
  const d = (g, o) => K.dig(M.tool("spade"), g, o).depth_m;
  assert.ok(d("sand") >= d("soil_loam") && d("soil_loam") > d("turf"), `${d("sand")} ${d("soil_loam")} ${d("turf")}`);
  assert.ok(d("forest_duff") >= d("soil_loam"));
  for (const g of ["asphalt", "concrete"]) {
    const r = K.dig(M.tool("spade"), g);
    assert.equal(r.outcome, "refused");
    assert.match(r.text, /will not go into the/);
  }
  // Turf is held by its roots and cohesion: the lever, not the push, stops it.
  assert.equal(K.dig(M.tool("spade"), "turf").limit, "lever");
  // Wet turf is softer; a weak digger levers out less.
  assert.ok(d("turf", { wet: true }) > d("turf"));
  assert.ok(d("turf", { strength: 0 }) < d("turf", { strength: 100 }));
});

test("a spadeful has its soil's weight, and the hole deepens with each", () => {
  const one = K.dig(M.tool("spade"), "soil_loam");
  near(one.kg, (one.volume_l / 1000) * 1600, 1e-6);
  const two = K.dig(M.tool("spade"), "soil_loam", { hole: one.hole });
  assert.ok(two.hole.depth_m > one.hole.depth_m);
  assert.match(one.text, /a spadeful of loam: \d+ cm deep/);
});

// ---- pushing and shoving -------------------------------------------------------------------------

test("a car in neutral rolls to a push; braked, or on ice, it does not", () => {
  const car = { name: "Car", mass_kg: 1400, wheels: "car", ground: "asphalt" };
  assert.equal(K.push(car).moves, true);
  const braked = K.push({ ...car, braked: true });
  assert.equal(braked.moves, false);
  assert.match(braked.text, /brakes are on/);
  const ice = K.push({ ...car, ground: "ice" });
  assert.equal(ice.moves, false);
  assert.equal(ice.limit, "footing");
});

test("a push is capped by strength and by the shoes' grip, and a slope adds its weight", () => {
  const cap = K.pushCapacity({ strength: 100, ground: "concrete" });
  assert.ok(cap.n <= WORK.push_n[1] + 1e-9);
  assert.ok(K.pushCapacity({ strength: 100, ground: "ice" }).limit === "footing");
  const flat = K.push({ name: "Cart", mass_kg: 60, wheels: "cart" }), up = K.push({ name: "Cart", mass_kg: 60, wheels: "cart", slope_deg: 10 });
  assert.ok(up.need_n > flat.need_n);
});

test("a shove: a grown adult staggers, a child or a frail person falls, nobody braced falls", () => {
  assert.equal(K.shove({ mass_kg: 75 }, { strength: 60 }).outcome, "staggers");
  assert.equal(K.shove({ mass_kg: 40 }, { strength: 60 }).outcome, "falls");
  assert.equal(K.shove({ mass_kg: 70, frail: true }, { strength: 60 }).outcome, "falls");
  assert.notEqual(K.shove({ mass_kg: 75, braced: true }, { strength: 100 }).outcome, "falls");
  assert.equal(K.shove({ mass_kg: 110, braced: true }, { strength: 0 }).outcome, "rocks");
});

// ---- carving ---------------------------------------------------------------------------------------

test("whittling takes thin shavings along the grain; across it, or with a dull edge, it skates", () => {
  const pine = () => block("white_pine_dry", 0.05);
  const along = K.carve(M.tool("pocket_knife"), pine(), { grain: "along" });
  assert.equal(along.outcome, "shaving");
  assert.ok(along.depth_m > 1e-4 && along.depth_m < 2e-3, `${along.depth_m}`);
  assert.equal(K.carve(M.tool("pocket_knife"), pine(), { grain: "across" }).outcome, "skate");
  const dull = { ...M.tool("pocket_knife"), edge_radius_m: 4e-5 };
  assert.equal(K.carve(dull, pine()).outcome, "skate");
  // Oak is harder going than pine.
  assert.ok(K.carve(M.tool("pocket_knife"), block("white_oak_dry", 0.05)).depth_m < along.depth_m);
  // Laying the blade nearly flat presses too little to bite.
  assert.equal(K.carve(M.tool("pocket_knife"), pine(), { rake_deg: 3 }).outcome, "skate");
});

function near(a, b, tol) { assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`); }
