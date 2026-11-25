// HELD-OUT cases for the material mechanics engine (docs/city/mechanics.mjs, docs/city/climbing.mjs).
//
// These expectations were written on 2026-11-23 BEFORE the engine existed, from real-world
// experience and published figures, and are not edited to fit the engine. The engine is tuned only
// against tests/mechanics.test.mjs (the calibration set). Each case says where its expectation
// comes from. Bands are deliberately wide: they say what anyone who has used the tool would
// recognise, not a number the engine was fitted to. docs/62-material-mechanics.md records the
// file's hash at the time it was written and how the engine first scored against it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMechanics } from "../docs/city/mechanics.mjs";
import { createClimbing } from "../docs/city/climbing.mjs";

const DATA = JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url), "utf8"));
const M = createMechanics(DATA);
const C = createClimbing(M);
const mm = (m) => m * 1000;

const trunk = (substance, d = 0.3) => M.body({ substance, shape: "round", diameter_m: d, length_m: 4, fixed: true, upright: true });
const stab = (tool, body, extra = {}) => M.strike(M.tool(tool), body, { feature: "tip", energy_j: 30, ...extra });
const chop = (body, extra = {}) => M.strike(M.tool("felling_axe"), body, { feature: "edge", energy_j: 250, grain: "across", ...extra });
const flesh = () => M.body({ shape: "layers", fixed: true, layers: [
  { substance: "skin", thickness_m: 0.002 }, { substance: "fat", thickness_m: 0.01 }, { substance: "muscle", thickness_m: 0.1 }] });

// ---- knives into wood -----------------------------------------------------------------------
// A kitchen knife stabbed hard into a softwood post sticks in a centimetre or few (throwing knives
// at 10-20 J stick 1-3 cm into pine targets); it leaves a narrow slit and does not hurt the tree.
test("holdout: a knife stab sinks a few cm into green softwood along the grain, as a slit", () => {
  const r = stab("chef_knife", trunk("douglas_fir_green"), { grain: "along" });
  assert.ok(mm(r.depth_m) >= 5 && mm(r.depth_m) <= 60, `depth ${mm(r.depth_m)} mm`);
  assert.equal(r.mark.kind, "slit");
  assert.ok(r.strength_left > 0.97, `strength left ${r.strength_left}`);
  assert.ok(!["broken", "bent", "shattered"].includes(r.tool.damage), r.tool.damage);
});

// Dry oak is roughly three times as hard as green Douglas fir (USDA Wood Handbook side hardness).
test("holdout: the same stab goes in less deep into dry white oak", () => {
  const fir = stab("chef_knife", trunk("douglas_fir_green"), { grain: "along" });
  const oak = stab("chef_knife", trunk("white_oak_dry"), { grain: "along" });
  assert.ok(oak.depth_m < 0.8 * fir.depth_m, `oak ${mm(oak.depth_m)} vs fir ${mm(fir.depth_m)} mm`);
  assert.ok(mm(oak.depth_m) > 1, `oak ${mm(oak.depth_m)} mm`);
});

// A blade turned across the fibres has to cut them (wood is far tougher across the grain than
// along it); along the grain it parts them and severs almost none.
test("holdout: across the grain a stab is shallower but severs fibres; along it, it parts them", () => {
  const along = stab("chef_knife", trunk("douglas_fir_green"), { grain: "along" });
  const across = stab("chef_knife", trunk("douglas_fir_green"), { grain: "across" });
  assert.ok(across.depth_m < along.depth_m, `across ${mm(across.depth_m)} along ${mm(along.depth_m)}`);
  assert.ok(along.strength_left >= across.strength_left);
});

// ---- knives against hard things -------------------------------------------------------------
// A knife does not stab into steel: the point bends or chips and the plate gets a tiny mark.
test("holdout: a knife stab on a steel plate barely marks it and damages the knife", () => {
  const plate = M.body({ substance: "mild_steel", shape: "plate", thickness_m: 0.003, span_m: 0.5, fixed: true });
  const r = stab("chef_knife", plate);
  assert.ok(mm(r.depth_m) < 0.5, `depth ${mm(r.depth_m)} mm`);
  assert.notEqual(r.outcome, "through");
  assert.notEqual(r.tool.damage, "none");
});

// Steel is about as hard as soda-lime glass (Mohs 5.5-6.5 vs 5.5): a knife does not go in.
test("holdout: a knife on a thick glass block makes no hole and suffers for it", () => {
  const block = M.body({ substance: "glass_annealed", shape: "block", thickness_m: 0.02, fixed: true });
  const r = stab("chef_knife", block, { energy_j: 10 });
  assert.ok(mm(r.depth_m) < 0.5, `depth ${mm(r.depth_m)} mm`);
  assert.notEqual(r.tool.damage, "none");
});

// ---- axes -----------------------------------------------------------------------------------
// One full swing of a felling axe square into a green hardwood trunk bites roughly half an inch
// to two inches, leaving a V-shaped (wedge) kerf as wide as the bit at that depth.
test("holdout: an axe blow bites a wedge-shaped kerf into a green oak trunk", () => {
  const r = chop(trunk("red_oak_green"));
  assert.ok(mm(r.depth_m) >= 6 && mm(r.depth_m) <= 50, `depth ${mm(r.depth_m)} mm`);
  assert.equal(r.mark.kind, "wedge");
  assert.ok(mm(r.mark.width_m) >= 3, `width ${mm(r.mark.width_m)} mm`);
  assert.ok(r.strength_left > 0.7 && r.strength_left < 0.999, `strength left ${r.strength_left}`);
});

// Pine is much softer than oak (compression parallel 16.8 vs 23.9 MPa green, hardness 1.3 vs 4.4 kN).
test("holdout: the same blow goes deeper into green white pine", () => {
  const oak = chop(trunk("red_oak_green")), pine = chop(trunk("white_pine_green"));
  assert.ok(pine.depth_m >= 1.2 * oak.depth_m, `pine ${mm(pine.depth_m)} oak ${mm(oak.depth_m)}`);
});

// Splitting firewood: an axe on the end of a dry straight-grained round splits it.
test("holdout: an axe on the end grain of a dry fir round splits it", () => {
  const round = M.body({ substance: "douglas_fir_dry", shape: "round", diameter_m: 0.25, length_m: 0.4, fixed: false, mass_kg: 9 });
  const r = M.strike(M.tool("felling_axe"), round, { feature: "edge", energy_j: 300, grain: "end" });
  assert.equal(r.outcome, "split");
  assert.equal(r.mark.kind, "split");
});

// A maul is a fat wedge: it splits, but it does not bite into a standing trunk like an axe.
test("holdout: a splitting maul bites less deep across the grain than a felling axe", () => {
  const axe = chop(trunk("red_oak_green"), { energy_j: 300 });
  const maul = M.strike(M.tool("splitting_maul"), trunk("red_oak_green"), { feature: "edge", energy_j: 300, grain: "across" });
  assert.ok(maul.depth_m < axe.depth_m, `maul ${mm(maul.depth_m)} axe ${mm(axe.depth_m)}`);
});

// Felling by hand: alternate downward and upward blows to pop chips and open a notch; it takes a
// few dozen to a few hundred blows to bring down a 30 cm hardwood. The same blow over and over
// into one kerf mostly jams the axe.
test("holdout: alternating axe blows open a notch that weakens and in time fells the tree", () => {
  let tree = trunk("red_oak_green"), axe = M.tool("felling_axe"), prev = null, fellAt = null;
  const depths = [], left = [];
  for (let i = 0; i < 400 && fellAt === null; i++) {
    const r = M.strike(axe, tree, { feature: "edge", energy_j: 250, grain: "across", tilt_deg: i % 2 ? -45 : 45, spot: "notch" });
    tree = r.body; axe = r.tool;
    depths.push(r.body.marks.reduce((d, m) => Math.max(d, m.depth_m), 0));
    left.push(r.strength_left);
    if (prev) assert.ok(r.strength_left <= prev.strength_left + 1e-9, `blow ${i}`);
    if (r.broken) fellAt = i + 1;
    prev = r;
  }
  for (let i = 1; i < depths.length; i++) assert.ok(depths[i] >= depths[i - 1] - 1e-9, `depth fell at blow ${i}`);
  assert.ok(fellAt !== null && fellAt > 1, `felled at ${fellAt}`);
  assert.ok(left[9] < left[0]);
  // The same 20 blows all from one side and one angle: a shallower notch.
  let same = trunk("red_oak_green"), axe2 = M.tool("felling_axe");
  for (let i = 0; i < 20; i++) { const r = M.strike(axe2, same, { feature: "edge", energy_j: 250, grain: "across", tilt_deg: 45, spot: "notch" }); same = r.body; axe2 = r.tool; }
  let alt = trunk("red_oak_green"), axe3 = M.tool("felling_axe");
  for (let i = 0; i < 20; i++) { const r = M.strike(axe3, alt, { feature: "edge", energy_j: 250, grain: "across", tilt_deg: i % 2 ? -45 : 45, spot: "notch" }); alt = r.body; axe3 = r.tool; }
  const deep = (b) => b.marks.reduce((d, m) => Math.max(d, m.depth_m), 0);
  assert.ok(deep(alt) > deep(same), `alternating ${mm(deep(alt))} same ${mm(deep(same))} mm`);
});

// Nobody fells a tree with a kitchen knife.
test("holdout: two hundred knife stabs do not fell a tree", () => {
  let tree = trunk("red_oak_green"), knife = M.tool("chef_knife");
  let r;
  for (let i = 0; i < 200; i++) { r = M.strike(knife, tree, { feature: "tip", energy_j: 30, grain: "across", spot: "one" }); tree = r.body; knife = r.tool; }
  assert.equal(r.broken, false);
  assert.ok(r.strength_left > 0.8, `strength left ${r.strength_left}`);
});

test("holdout: more energy goes deeper, but less than in proportion", () => {
  const d = [50, 100, 200, 400].map((e) => chop(trunk("white_pine_green"), { energy_j: e }).depth_m);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1], d.map(mm).join(" "));
  const ratio = d[3] / d[1];
  assert.ok(ratio > 1.3 && ratio < 4, `400 J / 100 J depth ratio ${ratio}`);
});

// A blow far off square skids off: axemen keep the bit near square to the cut face.
test("holdout: an axe swung at a steep slant glances off; a moderate slant bites", () => {
  const square = chop(trunk("red_oak_green"));
  const steep = chop(trunk("red_oak_green"), { angle_deg: 75 });
  const moderate = chop(trunk("red_oak_green"), { angle_deg: 30 });
  assert.equal(steep.outcome, "glance");
  assert.ok(steep.depth_m < 0.2 * square.depth_m);
  assert.notEqual(moderate.outcome, "glance");
});

// ---- sharpness ------------------------------------------------------------------------------
// The force to start a cut grows with how round the edge is (a sharp edge's radius is well under
// a micrometre, a dull one several, a butter knife's a tenth of a millimetre).
test("holdout: a duller edge needs more force to start cutting", () => {
  const apple = M.body({ substance: "apple", shape: "block", thickness_m: 0.07, fixed: true });
  const f = (tool, over = {}) => M.initiationForce({ ...M.tool(tool), ...over }, apple, { feature: "edge" });
  const sharp = f("chef_knife", { edge_radius_m: 0.3e-6 }), dull = f("chef_knife", { edge_radius_m: 5e-6 }), butter = f("butter_knife");
  assert.ok(sharp < dull && dull < butter, `${sharp} ${dull} ${butter}`);
  assert.ok(butter / sharp >= 3, `butter/sharp ${butter / sharp}`);
});

// Forensic measurements (Knight 1975; O'Callaghan et al. 1999; Ankersen et al. 1999): a sharp
// knife point needs roughly 10-50 N to go through skin; blunter points need several times more.
test("holdout: a knife point needs tens of newtons to pierce skin, a screwdriver several times more", () => {
  const knife = M.initiationForce(M.tool("chef_knife"), flesh(), { feature: "tip" });
  const driver = M.initiationForce(M.tool("screwdriver"), flesh(), { feature: "tip" });
  assert.ok(knife >= 5 && knife <= 80, `knife ${knife} N`);
  assert.ok(driver >= 3 * knife, `screwdriver ${driver} N vs knife ${knife} N`);
});

// Stab wounds from ordinary kitchen knives are commonly 5-15 cm deep: flesh resists far less than wood.
test("holdout: a knife stab goes deep into flesh, deeper than into wood", () => {
  const body = stab("chef_knife", flesh());
  const wood = stab("chef_knife", trunk("douglas_fir_green"), { grain: "along" });
  assert.ok(mm(body.depth_m) > 50, `flesh ${mm(body.depth_m)} mm`);
  assert.ok(body.depth_m > wood.depth_m);
  assert.equal(body.mark.kind, "slit");
  assert.ok(body.layers_reached.includes("muscle"), body.layers_reached.join(","));
});

// ---- blunt blows ----------------------------------------------------------------------------
// A club swung at a window breaks it; a light tap (a spoon, a knuckle) does not.
test("holdout: a club blow shatters a window pane, a tap does not", () => {
  const pane = () => M.body({ substance: "glass_annealed", shape: "plate", thickness_m: 0.004, span_m: 1, fixed: true });
  const hard = M.strike(M.tool("wooden_club"), pane(), { feature: "face", energy_j: 100 });
  const tap = M.strike(M.tool("wooden_club"), pane(), { feature: "face", energy_j: 0.2 });
  assert.equal(hard.outcome, "shatter");
  assert.notEqual(tap.outcome, "shatter");
  assert.notEqual(tap.outcome, "crack");
});

// Toughened (tempered) glass is four to five times as strong in bending as annealed glass
// (ASTM C1048, EN 12150), so blunt blows bounce off it, yet a hard sharp point that pierces its
// compressed skin makes the whole pane fall into dice (that is what a window punch is for).
test("holdout: tempered glass resists blunt blows far better, but a sharp hard point dices it", () => {
  const annealed = () => M.body({ substance: "glass_annealed", shape: "plate", thickness_m: 0.004, span_m: 0.8, fixed: true });
  const tempered = () => M.body({ substance: "glass_tempered", shape: "plate", thickness_m: 0.006, span_m: 0.8, fixed: true });
  const breakEnergy = (make) => {
    let lo = 0.01, hi = 5000;
    if (M.strike(M.tool("wooden_club"), make(), { feature: "face", energy_j: hi }).outcome !== "shatter") return Infinity;
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (M.strike(M.tool("wooden_club"), make(), { feature: "face", energy_j: mid }).outcome === "shatter") hi = mid; else lo = mid;
    }
    return hi;
  };
  const ea = breakEnergy(annealed), et = breakEnergy(tempered);
  assert.ok(et >= 3 * ea, `tempered ${et} J vs annealed ${ea} J`);
  const punch = M.strike(M.tool("window_punch"), tempered(), { feature: "tip", energy_j: 3 });
  assert.equal(punch.outcome, "shatter");
  const punchA = M.strike(M.tool("window_punch"), annealed(), { feature: "tip", energy_j: 3 });
  assert.ok(["crack", "shatter", "through"].includes(punchA.outcome), punchA.outcome);
});

// A club on a tree leaves a shallow dent in the bark and wood; on a person, a bruise, not a cut.
test("holdout: a club dents wood and bruises flesh without cutting either", () => {
  const tree = M.strike(M.tool("wooden_club"), trunk("red_oak_green"), { feature: "face", energy_j: 100 });
  assert.equal(tree.mark.kind, "dent");
  assert.ok(mm(tree.depth_m) <= 10, `dent ${mm(tree.depth_m)} mm`);
  assert.ok(tree.strength_left > 0.995);
  const body = M.strike(M.tool("wooden_club"), flesh(), { feature: "face", energy_j: 100 });
  assert.notEqual(body.mark.kind, "slit");
  assert.notEqual(body.outcome, "cut");
});

// A hammer blow on thick steel plate leaves a shallow crater-like dent; nothing cracks.
test("holdout: a hammer dents thick steel plate a little and is not hurt", () => {
  const plate = M.body({ substance: "mild_steel", shape: "plate", thickness_m: 0.01, span_m: 0.3, fixed: true });
  const r = M.strike(M.tool("claw_hammer"), plate, { feature: "face", energy_j: 50 });
  assert.equal(r.mark.kind, "dent");
  assert.ok(r.depth_m > 0 && mm(r.depth_m) < 2, `dent ${mm(r.depth_m)} mm`);
  assert.notEqual(r.outcome, "crack");
  assert.equal(r.tool.damage, "none");
});

// Ceramic knives are hard but brittle: they chip on bone; a steel knife's edge rolls or dulls.
test("holdout: on bone a ceramic knife chips and a steel knife does not", () => {
  const bone = () => M.body({ substance: "bone_cortical", shape: "block", thickness_m: 0.008, fixed: true });
  const ceramic = M.strike(M.tool("ceramic_knife"), bone(), { feature: "edge", energy_j: 15, grain: "across" });
  const steel = M.strike(M.tool("chef_knife"), bone(), { feature: "edge", energy_j: 15, grain: "across" });
  assert.equal(ceramic.tool.damage, "chipped");
  assert.ok(["none", "dulled", "rolled"].includes(steel.tool.damage), steel.tool.damage);
});

// Ice is hard to stab and brittle: it chips and cracks rather than taking a clean slit.
test("holdout: a knife into cold ice chips or cracks it and goes in little", () => {
  const ice = M.body({ substance: "ice", shape: "block", thickness_m: 0.3, fixed: true, temperature_c: -10 });
  const r = stab("chef_knife", ice);
  assert.ok(mm(r.depth_m) < 15, `depth ${mm(r.depth_m)} mm`);
  assert.ok(["crack", "chip", "scratch"].includes(r.mark.kind), r.mark.kind);
});

// A slash cuts canvas through; a club only pushes it.
test("holdout: a knife slash cuts through canvas, a club does not", () => {
  const canvas = () => M.body({ substance: "cotton_canvas", shape: "sheet", thickness_m: 0.0006, span_m: 1, fixed: true });
  const slash = M.strike(M.tool("chef_knife"), canvas(), { feature: "edge", energy_j: 10, slice: 2 });
  const club = M.strike(M.tool("wooden_club"), canvas(), { feature: "face", energy_j: 10 });
  assert.equal(slash.outcome, "through");
  assert.notEqual(club.outcome, "through");
});

// What you swing can break too: a bottle smashed on concrete breaks; dropped hard on grass it does not.
test("holdout: a bottle swung onto concrete breaks; onto turf it survives", () => {
  const onConcrete = M.strike(M.tool("glass_bottle"), M.body({ substance: "concrete", shape: "block", thickness_m: 0.2, fixed: true }), { feature: "face", energy_j: 10 });
  const onTurf = M.strike(M.tool("glass_bottle"), M.body({ substance: "turf", shape: "block", thickness_m: 0.3, fixed: true }), { feature: "face", energy_j: 10 });
  assert.equal(onConcrete.tool.damage, "shattered");
  assert.equal(onTurf.tool.damage, "none");
});

// ---- friction -------------------------------------------------------------------------------
// Published ranges: rubber on wet smooth glass 0.1-0.3; rubber on ice about 0.1-0.2 when cold and
// 0.02-0.07 when wet near melting; sticky climbing rubber on dry granite about 1 or more.
test("holdout: friction pairs fall in their published ranges", () => {
  assert.ok(M.friction("shoe_rubber", "glass_annealed", { wet: true }).static < 0.35);
  const coldIce = M.friction("shoe_rubber", "ice", { temperature_c: -10 }).static;
  assert.ok(coldIce >= 0.05 && coldIce <= 0.3, `cold ice ${coldIce}`);
  assert.ok(M.friction("shoe_rubber", "ice", { temperature_c: 0, wet: true }).static < 0.1);
  assert.ok(M.friction("climbing_rubber", "granite").static >= 0.85);
});

// Walking and standing on slopes: SF's steepest streets are about 17 degrees and walkable dry;
// wet glass and wet ice are slippery when barely tilted; friction slab climbing on granite works
// to about 35-45 degrees in sticky rubber and not when the rock is wet or the slab steeper.
test("holdout: standing on a slope holds or slips by friction against the slope", () => {
  const s = (contactor, substance, slope_deg, extra = {}) => M.slope({ contactor, substance, slope_deg, ...extra }).holds;
  assert.equal(s("shoe_rubber", "concrete", 25), true);
  assert.equal(s("shoe_rubber", "glass_annealed", 15, { wet: true }), false);
  assert.equal(s("shoe_rubber", "ice", 5, { wet: true, temperature_c: 0 }), false);
  assert.equal(s("shoe_rubber", "ice", 15, { temperature_c: -10 }), false);
  assert.equal(s("climbing_rubber", "granite", 40), true);
  assert.equal(s("climbing_rubber", "granite", 40, { wet: true }), false);
  assert.equal(s("climbing_rubber", "granite", 60), false);
});

// ---- climbing -------------------------------------------------------------------------------
const climber = (strength, extra = {}) => ({ kg: 75, height_m: 1.75, strength, hands: "skin", feet: "climbing_rubber", ...extra });
const jug = { kind: "jug", depth_m: 0.05, slope_deg: -20 };
const foothold = { kind: "edge", depth_m: 0.04, slope_deg: 0 };
const edge = (depth_mm, slope_deg = 0) => ({ kind: "edge", depth_m: depth_mm / 1000, slope_deg });

test("holdout: anyone can hang on big jugs on a vertical wall with good footholds", () => {
  const r = C.climb({ wall: { angle_deg: 0, substance: "sandstone" }, hands: [jug, jug], feet: [foothold, foothold], climber: climber(20) });
  assert.equal(r.holds, true);
});

test("holdout: a vertical sheet of glass with nothing to hold cannot be climbed, however strong", () => {
  const r = C.climb({ wall: { angle_deg: 0, substance: "glass_annealed" }, hands: [{ kind: "none" }, { kind: "none" }], feet: ["smear", "smear"], climber: climber(100) });
  assert.equal(r.holds, false);
});

// Elite climbers hang on edges of 5-6 mm; untrained people cannot use 10 mm edges at all.
test("holdout: tiny edges need trained fingers", () => {
  const wall = { angle_deg: 0, substance: "granite" };
  const weak = C.climb({ wall, hands: [edge(5), edge(5)], feet: ["smear", "smear"], climber: climber(20) });
  const elite = C.climb({ wall, hands: [edge(5), edge(5)], feet: ["smear", "smear"], climber: climber(95) });
  assert.equal(weak.holds, false);
  assert.equal(elite.holds, true);
});

test("holdout: the steeper the wall, the more the hands must hold", () => {
  const efforts = [-20, 0, 30, 60].map((angle_deg) => C.climb({ wall: { angle_deg, substance: "sandstone" }, hands: [edge(20), edge(20)], feet: [foothold, foothold], climber: climber(60) }).effort);
  for (let i = 1; i < efforts.length; i++) assert.ok(efforts[i] > efforts[i - 1], efforts.join(" "));
});

// Chalk dries sweat off the fingers and is used for exactly this; wet slopers are hopeless.
test("holdout: on a sloper, chalk helps, sweat hurts, and rain ends it", () => {
  const sloper = { kind: "sloper", depth_m: 0.08, slope_deg: 35 };
  const go = (hands, wet = false) => C.climb({ wall: { angle_deg: 0, substance: "sandstone", wet }, hands: [sloper, sloper], feet: [foothold, foothold], climber: climber(50, { hands }) });
  assert.ok(go("skin_chalked").effort < go("skin_sweaty").effort);
  assert.equal(go("skin_chalked", true).holds, false);
});

test("holdout: a heavy pack makes the same holds harder", () => {
  const base = { wall: { angle_deg: 10, substance: "granite" }, hands: [edge(20), edge(20)], feet: [foothold, foothold] };
  const light = C.climb({ ...base, climber: climber(60) }), loaded = C.climb({ ...base, climber: climber(60, { load_kg: 25 }) });
  assert.ok(loaded.effort > light.effort);
});

test("holdout: a vertical ice wall with no tools and no holds cannot be climbed", () => {
  const r = C.climb({ wall: { angle_deg: 0, substance: "ice", temperature_c: -10 }, hands: [{ kind: "none" }, { kind: "none" }], feet: ["smear", "smear"], climber: climber(100, { feet: "boot" }) });
  assert.equal(r.holds, false);
});

// Hanging from a ceiling: a strong person dead-hangs from jugs; nobody untrained holds 20 mm edges there.
test("holdout: on a roof the feet are no help: jugs for the strong, small edges for nobody untrained", () => {
  const roof = { angle_deg: 90, substance: "sandstone" };
  assert.equal(C.climb({ wall: roof, hands: [edge(20), edge(20)], feet: [], climber: climber(20) }).holds, false);
  assert.equal(C.climb({ wall: roof, hands: [jug, jug], feet: [], climber: climber(100) }).holds, true);
});

// Kids climb chain-link fences: fingers through the mesh, toes in it.
test("holdout: a chain-link fence is climbable by an ordinary person", () => {
  const wire = { kind: "jug", depth_m: 0.03, slope_deg: -30, substance: "mild_steel" };
  const toe = { kind: "edge", depth_m: 0.02, slope_deg: -10, substance: "mild_steel" };
  const r = C.climb({ wall: { angle_deg: 0, substance: "mild_steel" }, hands: [wire, wire], feet: [toe, toe], climber: climber(20, { feet: "shoe_rubber" }) });
  assert.equal(r.holds, true);
});

// Buildering on a brick wall's 10 mm recessed joints is a hard climb: strong climbers only.
test("holdout: 10 mm brick joints: no for an untrained person, yes for a strong climber", () => {
  const joint = { kind: "edge", depth_m: 0.01, slope_deg: 0, substance: "clay_brick" };
  const go = (s) => C.climb({ wall: { angle_deg: 0, substance: "clay_brick" }, hands: [joint, joint], feet: [joint, joint], climber: climber(s) }).holds;
  assert.equal(go(20), false);
  assert.equal(go(85), true);
});

// Chimneys and stems: pressing out against two opposing walls holds on friction alone.
test("holdout: bridged between two granite walls a climber holds without any holds", () => {
  const r = C.climb({ wall: { angle_deg: 0, substance: "granite" }, stem: { gap_m: 0.9 }, hands: [{ kind: "none" }, { kind: "none" }], feet: ["smear", "smear"], climber: climber(40) });
  assert.equal(r.holds, true);
});

// Stickiness: gecko-type dry adhesive pads held a person on vertical glass (Stanford, 2014),
// but they need a smooth surface: on rough concrete they are of little use.
test("holdout: dry-adhesive pads hold on smooth glass but not on rough concrete", () => {
  const pads = { hands: "gecko_pad", feet: "gecko_pad" };
  const glass = C.climb({ wall: { angle_deg: 0, substance: "glass_annealed" }, hands: [{ kind: "none" }, { kind: "none" }], feet: ["smear", "smear"], climber: climber(50, pads) });
  const concrete = C.climb({ wall: { angle_deg: 0, substance: "concrete" }, hands: [{ kind: "none" }, { kind: "none" }], feet: ["smear", "smear"], climber: climber(50, pads) });
  assert.equal(glass.holds, true);
  assert.equal(concrete.holds, false);
});
