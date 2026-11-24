// The material mechanics engine (docs/city/mechanics.mjs, docs/city/climbing.mjs): its data, its
// laws checked against published formulas, its bookkeeping, and the calibration cases it was tuned
// on. The held-out cases it was NOT tuned on are in tests/mechanics_holdout.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSTANTS, createMechanics } from "../docs/city/mechanics.mjs";
import { CLIMBER, balance, createClimbing, linprog } from "../docs/city/climbing.mjs";

const DATA = JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url), "utf8"));
const RULES = JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url), "utf8"));
const M = createMechanics(DATA);
const C = createClimbing(M);
const MX = DATA.mechanics;
const mm = (m) => m * 1000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (±${tol})`);
const within = (x, lo, hi, msg) => assert.ok(x >= lo && x <= hi, `${msg ?? ""} ${x} not in [${lo}, ${hi}]`);
const round = (substance, d = 0.25, extra = {}) => M.body({ substance, shape: "round", diameter_m: d, length_m: 3, fixed: true, upright: true, ...extra });

// ---- the data ------------------------------------------------------------------------------------

test("every catalogue material names a mechanics substance that exists (only 'none' names none)", () => {
  for (const [id, m] of Object.entries(DATA.materials)) {
    assert.ok("mechanics" in m, id);
    if (id === "none") { assert.equal(m.mechanics, null); continue; }
    assert.ok(MX.substances[m.mechanics], `${id} -> ${m.mechanics}`);
    assert.ok(M.substance(m.mechanics), id);
    assert.equal(M.ofMaterial(id), m.mechanics);
  }
});

test("every city item material and strike kind has its counterpart", () => {
  for (const k of Object.keys(RULES.handling.materials)) assert.ok(MX.substances[MX.item_materials[k]], k);
  for (const k of Object.keys(RULES.tools.kinds)) if (k !== "vehicle") assert.ok(MX.implements[MX.strike_kinds[k]], k);
});

test("every substance, contactor and implement cites sources that are listed", () => {
  const listed = new Set(Object.keys(MX.sources));
  const check = (id, rec) => { for (const s of rec.sources || []) assert.ok(listed.has(s), `${id}: ${s}`); };
  for (const [id, s] of Object.entries(MX.substances)) { check(id, s); if (s.family !== "fluid") assert.ok((s.sources || []).length > 0, id); }
  for (const [id, c] of Object.entries(MX.contactors)) if (id !== "about") check(id, c);
  for (const [id, t] of Object.entries(MX.implements)) if (id !== "about") { check(id, t); assert.ok(MX.substances[t.substance], `${id} substance`); }
});

test("substance figures are physical: positive moduli, strengths in order, toughness where it cuts", () => {
  for (const [id, raw] of Object.entries(MX.substances)) {
    if (raw.family === "fluid") continue;
    const s = M.substance(id);
    assert.ok(s.E > 0 && s.rho > 0, id);
    assert.ok(s.nu > 0 && s.nu < 0.5, id);
    assert.ok(s.pEdge > 0, id);
    if (raw.yield_mpa && raw.uts_mpa && !raw.brittle) assert.ok(raw.uts_mpa >= raw.yield_mpa, `${id} UTS below yield`);
    if (raw.grain) {
      const g = raw.grain;
      assert.ok(g.compression_parallel_mpa > g.compression_perp_mpa, `${id}: wood is stronger along the grain`);
      assert.ok(g.toughness_across_j_m2 > 10 * g.toughness_along_j_m2, `${id}: far tougher across the grain`);
    }
    for (const k of ["smoothness", "texture", "energy"]) within(raw.surface[k], 0, 1, `${id} ${k}`);
  }
});

test("the Wood Handbook's figures are as published (a few rows, green and dry)", () => {
  const g = (id) => MX.substances[id].grain;
  assert.equal(g("douglas_fir_green").compression_parallel_mpa, 26.1);
  assert.equal(g("douglas_fir_dry").side_hardness_n, 3200);
  assert.equal(g("red_oak_green").compression_parallel_mpa, 23.7);
  assert.equal(g("white_pine_green").side_hardness_n, 1300);
  assert.equal(MX.substances.white_oak_dry.uts_mpa, 105);
  // Janka hardness as a pressure: the force over the ball's projected area (about 1 cm2).
  near(M.substance("douglas_fir_dry").H / 1e6, 32, 0.5, "Janka pressure");
});

test("hardness ladder: glass and quartz above blade steel above mild steel above wood", () => {
  const H = (id) => M.substance(id).H;
  assert.ok(H("tungsten_carbide") > H("zirconia") && H("zirconia") > H("knife_steel"));
  assert.ok(H("knife_steel") > H("glass_annealed") && H("glass_annealed") > H("mild_steel"));
  assert.ok(H("mild_steel") > H("bone_cortical") && H("bone_cortical") > H("white_oak_dry") && H("white_oak_dry") > H("white_pine_green"));
  assert.ok(M.substance("concrete").Habr > H("knife_steel"), "quartz grit is harder than a blade");
});

// ---- published laws ------------------------------------------------------------------------------

// NDS 12.2.3: a smooth nail's withdrawal resistance W = 1380 G^2.5 D lb per inch of penetration.
// This sets the flank recovery constant (CONSTANTS.flank_recovery).
test("calibration: nail withdrawal per millimetre follows the NDS formula", () => {
  for (const [id, tol] of [["douglas_fir_dry", 0.35], ["white_pine_dry", 0.5], ["red_oak_dry", 0.4], ["white_oak_dry", 0.4]]) {
    const r = M.strike(M.tool("nail"), M.body({ substance: id, shape: "block", thickness_m: 0.3 }), { feature: "tip", energy_j: 60, grain: "along", mode: "swing" });
    const G = MX.substances[id].specific_gravity, D = 0.0033 / 0.0254;
    const nds = (1380 * G ** 2.5 * D * 4.448) / 25.4;
    const got = r.withdraw_n / mm(r.depth_m);
    assert.ok(Math.abs(got - nds) / nds <= tol, `${id}: ${got.toFixed(2)} N/mm vs NDS ${nds.toFixed(2)}`);
  }
});

// The catalogue's own shoe-on-surface friction is what the game already uses: the friction model
// must agree with it where the catalogue is a paved or hard surface.
test("calibration: shoe friction agrees with the catalogue's figures dry and wet", () => {
  for (const mat of ["asphalt", "concrete", "glass", "steel", "lumber", "rock", "masonry", "paint_marking"]) {
    const f = DATA.materials[mat].friction, sub = DATA.materials[mat].mechanics;
    near(M.friction("shoe_rubber", sub).static, f.static, 0.15, `${mat} dry`);
    near(M.friction("shoe_rubber", sub, { wet: true }).static, f.wet, 0.15, `${mat} wet`);
  }
  // FHWA: tyre/shoe rubber on wet pavement 0.4-0.6.
  within(M.friction("shoe_rubber", "asphalt", { wet: true }).static, 0.4, 0.65, "wet asphalt");
});

test("friction: water hurts most on smooth surfaces, texture drains it; ice slips more as it warms", () => {
  const loss = (s) => M.friction("shoe_rubber", s).static - M.friction("shoe_rubber", s, { wet: true }).static;
  assert.ok(loss("glass_annealed") > loss("asphalt"));
  const ice = [-25, -15, -8, -3, 0].map((t) => M.friction("shoe_rubber", "ice", { temperature_c: t }).static);
  for (let i = 1; i < ice.length; i++) assert.ok(ice[i] < ice[i - 1], ice.join(" "));
  assert.ok(M.friction("climbing_rubber", "granite").static > M.friction("shoe_rubber", "granite").static);
  assert.ok(M.friction("skin_chalked", "sandstone").static > M.friction("skin_sweaty", "sandstone").static);
  // A dry adhesive needs smoothness: its grip on glass dwarfs that on concrete.
  const g = M.friction("gecko_pad", "glass_annealed"), c = M.friction("gecko_pad", "concrete");
  assert.ok(g.adhesive_n > 50 * c.adhesive_n);
});

test("a slope holds exactly while friction covers its tangent", () => {
  const mu = M.friction("shoe_rubber", "concrete").static, limit = Math.atan(mu) * 180 / Math.PI;
  assert.equal(M.slope({ contactor: "shoe_rubber", substance: "concrete", slope_deg: limit - 0.5 }).holds, true);
  assert.equal(M.slope({ contactor: "shoe_rubber", substance: "concrete", slope_deg: limit + 0.5 }).holds, false);
  // The same answer from the general statics: one contact on an incline.
  const th = (limit + 0.5) * Math.PI / 180;
  const r = balance({ weight_n: 700, com: [0, 0], contacts: [{ at: [0, 0], normal: [-Math.sin(th), Math.cos(th)], mu, capacity_n: 1e6 }] });
  assert.equal(r.holds, false);
  const th2 = (limit - 0.5) * Math.PI / 180;
  assert.equal(balance({ weight_n: 700, com: [0, 0], contacts: [{ at: [0, 0], normal: [-Math.sin(th2), Math.cos(th2)], mu, capacity_n: 1e6 }] }).holds, true);
});

// Hertz: a sphere pressed elastically into a flat stores W = (8/15) E* R^0.5 d^2.5 at F = (4/3) E* R^0.5 d^1.5.
test("a gentle blunt tap is elastic and follows Hertz", () => {
  const ball = { ...M.tool("fist"), substance: "tool_steel", face: { kind: "sphere", radius_m: 0.02 }, strike_mass_kg: 1 };
  const plate = M.body({ substance: "mild_steel", shape: "block", thickness_m: 0.1 });
  const E = 1e-6, r = M.strike(ball, plate, { feature: "face", energy_j: E / (1 - CONSTANTS.handheld_loss) });
  const s = M.substance("mild_steel"), t = M.substance("tool_steel");
  const Es = 1 / ((1 - s.nu ** 2) / s.E + (1 - t.nu ** 2) / t.E);
  const d = ((15 * E) / (8 * Es * Math.sqrt(0.02))) ** 0.4, F = (4 / 3) * Es * Math.sqrt(0.02) * d ** 1.5;
  near(r.force_n, F, 0.03 * F, "Hertz force");
  assert.equal(r.outcome, "bounce");
});

// A half-moon section (a round cut through half its depth, all across) keeps 0.265 of the round's
// fully plastic section modulus about the cut's axis (the round's is 4r³/3; the half's is taken
// about the line that halves its area, 0.404 r from the cut: 0.354 r³).
test("a round's strength is the section modulus of what is left", () => {
  const b = round("sycamore_green", 0.3);
  b.marks.push({ severed: [{ depth_m: 0.15, full: true }], at_deg: 0 });
  near(M.strengthLeft(b), 0.2655, 0.012, "half-moon");
  const c = round("sycamore_green", 0.3);
  c.marks.push({ severed: [{ depth_m: 0.27, full: true }], at_deg: 0 });
  assert.ok(M.strengthLeft(c) < CONSTANTS.tree_demand, "a 10% hinge cannot hold the tree");
  assert.equal(M.strengthLeft(round("sycamore_green", 0.3)), 1);
});

// ---- bookkeeping ----------------------------------------------------------------------------------

test("a strike changes neither the body nor the tool it is given, and repeats exactly", () => {
  const b = round("red_oak_green"), t = M.tool("felling_axe");
  const before = JSON.stringify([b, t]);
  const r1 = M.strike(t, b, { feature: "edge", energy_j: 250 }), r2 = M.strike(t, b, { feature: "edge", energy_j: 250 });
  assert.equal(JSON.stringify([b, t]), before);
  assert.deepEqual(r1, r2);
  assert.equal(r1.body.marks.length, 1);
  assert.equal(r1.tool.blows, 1);
});

test("no strike uses more energy than it had; zero energy does nothing", () => {
  const cases = [["chef_knife", "tip", "douglas_fir_green"], ["felling_axe", "edge", "white_pine_green"], ["chef_knife", "edge", "apple"]];
  for (const [tool, feature, sub] of cases) {
    const r = M.strike(M.tool(tool), round(sub), { feature, energy_j: 40 });
    assert.ok(r.depth_m > 0, tool);
    const none = M.strike(M.tool(tool), round(sub), { feature, energy_j: 0 });
    assert.ok(none.depth_m < 1e-6, `${tool} at 0 J went ${none.depth_m}`);
  }
});

test("every catalogue material can be struck by every implement without error", () => {
  for (const [mat, m] of Object.entries(DATA.materials)) {
    if (!m.mechanics || m.mechanics === "water") continue;
    for (const id of Object.keys(MX.implements)) {
      if (id === "about") continue;
      const t = M.tool(id);
      for (const feature of ["edge", "tip", "face"]) {
        if (!t[feature]) continue;
        const r = M.strike(t, M.body({ substance: m.mechanics, shape: "block", thickness_m: 0.1 }), { feature, energy_j: 50 });
        assert.ok(Number.isFinite(r.depth_m) && r.depth_m >= 0, `${id} ${feature} on ${mat}`);
        assert.ok(typeof r.outcome === "string" && r.mark, `${id} ${feature} on ${mat}`);
      }
    }
  }
});

// ---- calibration cases (real-world figures the engine was tuned against) --------------------------

// Throwing knives (about 10 J) stick 1-3 cm into pine; a chef's knife thrown hard does the same.
test("calibration: a thrown knife sticks a couple of centimetres into a pine round", () => {
  const r = M.strike(M.tool("chef_knife"), round("white_pine_dry"), { feature: "tip", energy_j: 10, grain: "along", mode: "swing" });
  within(mm(r.depth_m), 8, 35, "depth mm");
  assert.equal(r.outcome, "cut");
});

test("calibration: a hatchet bites less than a felling axe, and dry fir less than green sycamore", () => {
  const hatchet = M.strike(M.tool("hatchet"), round("douglas_fir_dry"), { feature: "edge", energy_j: 120 });
  const axe = M.strike(M.tool("felling_axe"), round("douglas_fir_dry"), { feature: "edge", energy_j: 250 });
  const green = M.strike(M.tool("felling_axe"), round("sycamore_green"), { feature: "edge", energy_j: 250 });
  within(mm(axe.depth_m), 6, 40, "axe in dry fir");
  assert.ok(hatchet.depth_m < axe.depth_m && axe.depth_m < green.depth_m);
  assert.equal(axe.outcome, "cut");
});

// A machete takes a sapling in two or three blows.
test("calibration: a machete blow cuts deep into a 5 cm sapling", () => {
  const r = M.strike(M.tool("machete"), round("sycamore_green", 0.05), { feature: "edge", energy_j: 80 });
  within(mm(r.depth_m), 8, 50, "depth");
  assert.ok(r.strength_left < 0.8);
});

test("calibration: a sharp knife slices an apple through with a light drawn cut", () => {
  const apple = M.body({ substance: "apple", shape: "block", thickness_m: 0.07 });
  const r = M.strike(M.tool("chef_knife"), apple, { feature: "edge", energy_j: 3, slice: 1.5 });
  assert.ok(["cut", "through"].includes(r.outcome));
  assert.ok(mm(r.depth_m) > 20);
  // Push-only needs more force than a drawn slice (Atkins' slice/push ratio).
  const push = M.initiationForce(M.tool("chef_knife"), apple, { feature: "edge" });
  const drawn = M.initiationForce(M.tool("chef_knife"), apple, { feature: "edge", slice: 1.5 });
  assert.ok(drawn < push);
});

// Sledgehammers break bricks; a claw hammer mostly chips them.
test("calibration: a sledgehammer cracks a brick that a light hammer tap only chips", () => {
  const brick = () => M.body({ substance: "clay_brick", shape: "block", thickness_m: 0.065 });
  const sledge = M.strike(M.tool("sledgehammer"), brick(), { feature: "face", energy_j: 420 });
  const tap = M.strike(M.tool("claw_hammer"), brick(), { feature: "face", energy_j: 5 });
  assert.equal(sledge.outcome, "crack");
  assert.ok(tap.depth_m < sledge.depth_m);
});

test("calibration: sharper edges and slimmer points need less force to start", () => {
  const skin = M.body({ substance: "skin", shape: "block", thickness_m: 0.002 });
  const radii = [0.2e-6, 1e-6, 5e-6, 2e-5, 1e-4];
  const f = radii.map((r) => M.initiationForce({ ...M.tool("chef_knife"), edge_radius_m: r }, skin, { feature: "edge" }));
  for (let i = 1; i < f.length; i++) assert.ok(f[i] > f[i - 1], f.join(" "));
  const paring = M.initiationForce(M.tool("paring_knife"), skin, { feature: "tip" });
  const chef = M.initiationForce(M.tool("chef_knife"), skin, { feature: "tip" });
  assert.ok(paring < chef);
});

test("calibration: harder grit wears an edge faster: concrete dulls a knife, pine barely does", () => {
  let onWood = M.tool("chef_knife"), onConcrete = M.tool("chef_knife");
  for (let i = 0; i < 20; i++) {
    onWood = M.strike(onWood, round("white_pine_dry"), { feature: "edge", energy_j: 5, slice: 2 }).tool;
    onConcrete = M.strike(onConcrete, M.body({ substance: "concrete", shape: "block", thickness_m: 0.1 }), { feature: "edge", energy_j: 5, slice: 2 }).tool;
  }
  assert.ok(onConcrete.edge_radius_m > 3 * onWood.edge_radius_m, `${onConcrete.edge_radius_m} vs ${onWood.edge_radius_m}`);
  assert.notEqual(onConcrete.damage, "none");
});

test("calibration: the steeper the slant, the likelier a blow skids off", () => {
  const g = [0, 20, 40, 60, 80].map((a) => M.strike(M.tool("felling_axe"), round("white_oak_dry"), { feature: "edge", energy_j: 200, angle_deg: a }).depth_m);
  for (let i = 1; i < g.length; i++) assert.ok(g[i] <= g[i - 1] + 1e-9, g.join(" "));
  assert.equal(M.strike(M.tool("felling_axe"), round("white_oak_dry"), { feature: "edge", energy_j: 200, angle_deg: 85 }).outcome, "glance");
});

test("calibration: the deeper the axe, the harder it is to pull out", () => {
  const shallow = M.strike(M.tool("felling_axe"), round("white_pine_green"), { feature: "edge", energy_j: 80 });
  const deep = M.strike(M.tool("felling_axe"), round("white_pine_green"), { feature: "edge", energy_j: 400 });
  assert.ok(deep.withdraw_n > shallow.withdraw_n);
});

test("calibration: a round splits along its grain far more easily than across it", () => {
  const along = M.strike(M.tool("felling_axe"), round("white_pine_dry"), { feature: "edge", energy_j: 200, grain: "along" });
  const across = M.strike(M.tool("felling_axe"), round("white_pine_dry"), { feature: "edge", energy_j: 200, grain: "across" });
  assert.ok(along.mark.split_m > across.mark.split_m);
  assert.ok(along.depth_m > across.depth_m);
});

// ---- the linear programme and the climber ---------------------------------------------------------

test("linprog solves small problems and reports infeasible ones", () => {
  // min -x - y, x + 2y <= 4, 3x + y <= 6 -> (1.6, 1.2)
  const r = linprog([-1, -1], [], [], [[1, 2], [3, 1]], [4, 6]);
  near(r.x[0], 1.6, 1e-9); near(r.x[1], 1.2, 1e-9);
  // min x + y with x + y = 2, x - y = 0 -> (1, 1)
  const e = linprog([1, 1], [[1, 1], [1, -1]], [2, 0], [], []);
  near(e.x[0], 1, 1e-9); near(e.x[1], 1, 1e-9);
  // x + y = 1 and x + y <= 0.5 cannot both hold
  assert.equal(linprog([0, 0], [[1, 1]], [1], [[1, 1]], [0.5]), null);
  // >= rows by a negative right-hand side: min x with -x <= -3 -> 3
  near(linprog([1], [], [], [[-1]], [-3]).x[0], 3, 1e-9);
});

test("calibration: two hands on a bar overhead hold anyone up; one hand only the strong", () => {
  const bar = { kind: "jug", depth_m: 0.04, slope_deg: 0, substance: "mild_steel" };
  const roof = { angle_deg: 90, substance: "mild_steel" };
  assert.equal(C.climb({ wall: roof, hands: [bar, bar], feet: [], climber: { strength: 15 } }).holds, true);
  assert.equal(C.climb({ wall: roof, hands: [bar], feet: [], climber: { strength: 100 } }).holds, true);
  assert.equal(C.climb({ wall: roof, hands: [bar], feet: [], climber: { strength: 20 } }).holds, false);
});

test("calibration: a ladder is easy, and effort falls with strength and rises with load", () => {
  const rung = { kind: "jug", depth_m: 0.03, slope_deg: 0, substance: "aluminium_6061" };
  const step = { kind: "edge", depth_m: 0.03, slope_deg: 0, substance: "aluminium_6061" };
  const go = (strength, load_kg = 0) => C.climb({ wall: { angle_deg: -15, substance: "aluminium_6061" }, hands: [rung, rung], feet: [step, step], climber: { strength, load_kg, feet: "shoe_rubber" } });
  assert.equal(go(5).holds, true);
  assert.ok(go(80).effort < go(20).effort);
  assert.ok(go(20, 30).effort > go(20).effort);
});

test("calibration: a friction slab: sticky rubber stands where street shoes slide", () => {
  const mu = (c) => M.friction(c, "granite").static;
  const angle = (Math.atan((mu("climbing_rubber") + mu("shoe_rubber")) / 2) * 180) / Math.PI;
  assert.equal(M.slope({ contactor: "climbing_rubber", substance: "granite", slope_deg: angle }).holds, true);
  assert.equal(M.slope({ contactor: "shoe_rubber", substance: "granite", slope_deg: angle }).holds, false);
});

test("climbing figures span the published finger-strength range", () => {
  const BW = CLIMBER.reference_kg * 9.81;
  const two = (s) => (2 * C.capacity("hand", { kind: "edge", depth_m: 0.02 }, s)) / BW;
  within(two(20), 0.45, 0.7, "untrained, 20 mm, two hands");
  within(two(95), 1.3, 1.6, "elite");
  assert.ok(C.capacity("hand", { kind: "edge", depth_m: 0.006 }, 50) < C.capacity("hand", { kind: "edge", depth_m: 0.012 }, 50));
});

// Ice is slippery near melting and much less so when cold: a premelted film lubricates it (Kietzig,
// Hatzikiriakos & Englezos 2010, "Physics of ice friction", J. Appl. Phys. 107, 081101: slow steel
// on ice about 0.2-0.4 at -20 C, about 0.1 at -10 C, a few hundredths near 0 C).
test("calibration: ice friction falls as it warms toward melting", () => {
  const mu = (t) => M.friction("steel", "ice", { temperature_c: t }).dynamic;
  within(mu(-20), 0.2, 0.4, "-20 C");
  within(mu(-10), 0.06, 0.2, "-10 C");
  assert.ok(mu(-2) < 0.1, `-2 C ${mu(-2)}`);
  for (const [a, b] of [[-30, -20], [-20, -10], [-10, -5], [-5, -1]]) assert.ok(mu(b) < mu(a), `${a} to ${b}`);
});

// Cutting wood away never makes a round stronger, whatever the order and place of the cuts.
test("strength left only falls as wood is cut away", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let trial = 0; trial < 6; trial++) {
    const b = round("sycamore_green", 0.3);
    let prev = 1;
    for (let k = 0; k < 8; k++) {
      const full = rnd() < 0.5;
      b.marks.push({ severed: [{ depth_m: 0.01 + 0.06 * rnd(), full, width_m: 0.03 + 0.1 * rnd() }], at_deg: 360 * rnd() });
      const left = M.strengthLeft(b);
      assert.ok(left <= prev + 1e-12, `trial ${trial} cut ${k}: ${prev} to ${left}`);
      prev = left;
    }
  }
});

// To move, a climber lets go of one limb at a time: a ladder allows it, a weak hang from two
// holds under a roof does not, though both arms hold together.
test("climbable means every limb can let go in turn", () => {
  const rung = { kind: "jug", depth_m: 0.03, slope_deg: 0, substance: "aluminium_6061" };
  const step = { kind: "edge", depth_m: 0.03, slope_deg: 0, substance: "aluminium_6061" };
  const ladder = C.climb({ wall: { angle_deg: -15, substance: "aluminium_6061" }, hands: [rung, rung], feet: [step, step], climber: { strength: 20, feet: "shoe_rubber" } });
  assert.equal(ladder.climbable, true);
  const bar = { kind: "jug", depth_m: 0.04, slope_deg: 0, substance: "mild_steel" };
  const hang = C.climb({ wall: { angle_deg: 90, substance: "mild_steel" }, hands: [bar, bar], feet: [], climber: { strength: 20 } });
  assert.equal(hang.holds, true);
  assert.equal(hang.climbable, false);
  assert.equal(hang.releases["hand 1"], false);
  // The posture found lies inside the body's range.
  assert.ok(ladder.posture.hips_off_wall_m >= 0.05 && ladder.posture.hips_off_wall_m <= 0.6);
  assert.ok(ladder.posture.reach_share >= 0.7 && ladder.posture.reach_share <= 1);
});

// A hold stands out of the wall: the deeper it is, the less the hands must pull in to keep the
// body from tipping back.
test("a deeper hold puts the hands further out and eases the pull", () => {
  // A steep sloper, where friction is close to its limit and the inward pull decides.
  const go = (depth_m) => C.climb({ wall: { angle_deg: 0, substance: "sandstone" }, hands: [{ kind: "sloper", depth_m, slope_deg: 35 }, { kind: "sloper", depth_m, slope_deg: 35 }],
    feet: [{ kind: "edge", depth_m: 0.03, slope_deg: 0 }, { kind: "edge", depth_m: 0.03, slope_deg: 0 }], climber: { strength: 50, hands: "skin_chalked" } }).effort;
  const e = [0, 0.04, 0.12].map(go);
  assert.ok(e[1] < e[0] && e[2] < e[1], e.join(" "));
});

// An axe keeps its edge through a single chop into green wood and dulls only over many; one blow
// into concrete (quartz aggregate harder than the bit) blunts it at once.
test("calibration: an axe edge dulls over many chops in wood, at once on concrete", () => {
  const tree = () => round("red_oak_green", 0.3);
  const one = M.strike(M.tool("felling_axe"), tree(), { feature: "edge", energy_j: 120, grain: "across" });
  assert.equal(one.tool_damage, "none");
  let axe = M.tool("felling_axe");
  for (let i = 0; i < 100; i++) axe = M.strike(axe, tree(), { feature: "edge", energy_j: 120, grain: "across" }).tool;
  assert.ok(axe.edge_radius_m > one.tool.edge_radius_m, "wear adds up");
  assert.notEqual(axe.damage, "none", `after 100 chops: radius ${axe.edge_radius_m}`);
  const slab = M.body({ substance: "concrete", shape: "block", thickness_m: 0.2, fixed: true });
  const hit = M.strike(M.tool("felling_axe"), slab, { feature: "edge", energy_j: 120 });
  assert.notEqual(hit.tool_damage, "none");
  assert.ok(hit.tool.edge_radius_m > 5 * axe.edge_radius_m, `concrete ${hit.tool.edge_radius_m}`);
});
