// Object on object (docs/city/mechanics-collide.mjs): every object is a stack of layers with its
// own figures, a coat is a layer of its own over its body, and a mark goes only as deep as the
// force and the hardness of each layer let it. Each law is checked against the formula or the
// figure it comes from (docs/62-material-mechanics.md, "Object on object").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMechanics } from "../docs/city/mechanics.mjs";
import { createCollisions, COLLIDE } from "../docs/city/mechanics-collide.mjs";

const CAT = JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url)));
const M = createMechanics(CAT), C = createCollisions(M, CAT);
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12);
const kinds = (m) => m.layers.map((l) => l.kind);
const stucco = () => C.stats("building.exterior", { cladding: "stucco_render" });
const crate = () => C.stats("interior.furniture");
const steelCorner = (r = 0.002) => C.stats({ name: "Steel box", substance: "mild_steel", coat: null, form: { shape: "box", section: { b_m: 0.6, h_m: 0.002 }, span_m: 0.6, edge_r_m: r, face_m2: 0.36 }, mass_kg: 40 });

test("every archetype has its stats: each layer's hardness, toughness and failure strain, and the whole's strength", () => {
  let n = 0;
  for (const [id, a] of Object.entries(CAT.archetypes)) {
    if (!M.ofMaterial(a.material) || M.substance(M.ofMaterial(a.material)).fluid) continue;
    const s = C.stats(id);
    n++;
    for (const l of s.layers) {
      for (const k of ["modulus_pa", "failure_strain"]) assert.ok(Number.isFinite(l[k]) && l[k] > 0, `${id} ${l.substance} ${k} = ${l[k]}`);
      // (A rubber has no plastic hardness: it springs back from any dent, so it is never dented.)
      assert.ok(l.hardness_pa > 0 && (Number.isFinite(l.hardness_pa) || ["elastomer", "fabric", "plant", "food", "tissue"].includes(l.family)), `${id} ${l.substance} hardness`);
      // (Loose ground -- gravel, sand -- has no toughness: it has no cohesion to break.)
      assert.ok(l.fracture_energy_j_m2 > 0 || l.toughness_pa_m > 0 || l.family === "soil", `${id} ${l.substance} toughness`);
    }
    assert.ok(s.fixed || Number.isFinite(s.break_force_n) || Number.isFinite(s.bend_force_n), `${id}: free and unbreakable`);
    if (s.coat) assert.equal(s.layers[0].role, "coat", id);
  }
  assert.ok(n > 60, `${n} archetypes`);
});

test("a coat is a layer of its own: its own substance, thickness and adhesion over the body", () => {
  const w = stucco();
  assert.deepEqual(w.layers.map((l) => [l.role, l.substance]), [["coat", "latex_paint"], ["body", "stucco"]]);
  assert.ok(near(w.layers[0].thickness_m, 90e-6, 1e-12));
  assert.equal(w.layers[0].adhesion_pa, 1.5e6);
  assert.ok(w.layers[0].hardness_pa < w.layers[1].hardness_pa, "latex is softer than the render");
  assert.ok(w.layers[0].failure_strain > 10 * w.layers[1].failure_strain, "and far more stretchy");
  // Brick shows its own colour: no coat. Painted brick has one.
  assert.equal(C.stats("building.exterior", { cladding: "brick" }).layers.length, 1);
  assert.equal(C.stats("building.exterior", { cladding: "painted_brick" }).layers[0].substance, "latex_paint");
  // A car's paint stack and a pole's powder coat are their own coats.
  assert.equal(C.stats("vehicle.body").layers[0].coat, "car_paint");
  assert.equal(C.stats("furniture.street_light").layers[0].coat, "powder_coat");
});

test("scratch hardness: a sliding corner's groove is as wide as ASTM G171 has it, HSp = 8P / (pi w^2) = H", () => {
  const bare = C.stats("building.exterior", { cladding: "stucco_render", coat: null, substance: "plasterboard" });
  for (const P of [5, 20, 80]) {
    const c = C.contact(steelCorner(0.003), bare, P, { kind: "corner", sliding: true, length_m: 0.1 });
    const w = 2 * c.struck.contact_radius_m;
    assert.ok(near((8 * P) / (Math.PI * w * w), bare.layers[0].hardness_pa, 0.01), `${P} N: ${(8 * P) / (Math.PI * w * w)}`);
  }
});

test("Tabor's representative strain: what a layer is stretched to under a round contact is 0.2 a / R", () => {
  const c = C.contact(steelCorner(0.004), stucco(), 400, { kind: "corner" });
  assert.ok(near(c.struck.strain, (COLLIDE.tabor_strain * c.struck.contact_radius_m) / 0.004, 1e-9));
});

test("a scratch in a wall's paint stays in the paint: the render under it is not marked", () => {
  // A steel corner (harder than the paint, softer than the render's sand) dragged along a painted
  // stucco wall: light, it scratches the paint; hard, it cuts the paint through to the render,
  // and the render is still unmarked.
  const light = C.scrape(steelCorner(), stucco(), { normal_n: 3, slide_m: 0.3 });
  assert.equal(light.contact.struck.layers[0].kind, "scratch");
  assert.ok(light.contact.struck.layers[0].depth_m < 90e-6);
  assert.equal(light.contact.struck.layers[1].kind, "none");
  for (const N of [50, 400, 3000]) {
    const r = C.scrape(steelCorner(), stucco(), { normal_n: N, slide_m: 0.3 });
    assert.deepEqual(kinds(r.contact.struck), ["cut_through", "none"], `${N} N`);
    assert.match(r.text, /render under it unmarked/);
  }
  // Something harder than the render's grit (a corundum stone, 2000 HV) does groove the render.
  const corundum = C.stats({ name: "Corundum block", substance: "granite", coat: null, form: { shape: "wall", edge_r_m: 0.002 }, mass_kg: 5 });
  corundum.layers[0].scratch_pa = corundum.layers[0].hardness_pa = 2000 * 9.807e6;
  const hard = C.scrape(corundum, stucco(), { normal_n: 400, slide_m: 0.3 });
  assert.deepEqual(kinds(hard.contact.struck), ["cut_through", "chip"]);
});

test("one thing grooves another only if 20 % harder (Tabor): wood does not groove enamel, steel grooves powder coat", () => {
  const enamelled = C.stats("building.door");          // alkyd enamel over wood
  const pine = C.stats({ name: "Pine block", substance: "douglas_fir_dry", coat: null, form: { shape: "box", section: { b_m: 0.3, h_m: 0.02 }, span_m: 0.3, edge_r_m: 0.002 }, mass_kg: 4 });
  const r1 = C.scrape(pine, enamelled, { normal_n: 60, slide_m: 0.2 });
  assert.ok(!["scratch", "cut_through"].includes(r1.contact.struck.layers[0].kind), r1.contact.struck.layers[0].kind);
  assert.equal(r1.contact.lead.layers[0].kind, "worn", "the wood is worn instead");
  const r2 = C.scrape(steelCorner(), C.stats("furniture.street_light"), { normal_n: 60, slide_m: 0.2 });
  assert.ok(["scratch", "cut_through"].includes(r2.contact.struck.layers[0].kind));
  // A plastic crate dragged along a car leaves a smear of itself, not a scratch.
  const r3 = C.scrape(C.stats("item.movable"), C.stats("vehicle.body"), { normal_n: 60, slide_m: 0.3 });
  assert.equal(r3.contact.struck.layers[0].kind, "transfer");
  assert.equal(r3.contact.struck.layers[0].of, "polypropylene");
  // A trolley's wire end does scratch the clearcoat, and stops short of the steel.
  const wire = C.stats({ name: "Trolley wire", substance: "mild_steel", coat: null, form: { shape: "post", section: { d_m: 0.004 }, span_m: 0.3, edge_r_m: 0.002 }, mass_kg: 15 });
  const r4 = C.scrape(wire, C.stats("vehicle.body"), { normal_n: 100, slide_m: 0.3 });
  assert.equal(r4.contact.struck.layers[0].kind, "scratch");
  assert.equal(r4.contact.struck.layers[1].kind, "none");
});

test("a flat face pressed on a wall marks nothing: the paint is held in by it (confined layer)", () => {
  for (const F of [100, 500, 5000]) {
    const r = C.push(crate(), stucco(), { force_n: F, kind: "face" });
    assert.deepEqual(kinds(r.contact.struck), ["none", "none"], `${F} N`);
    assert.equal(r.stopped, true);
  }
  // The slab law itself: a coat under a contact far wider than it is thick bears far more than its
  // hardness, so the render under it gives first.
  const c = C.contact(steelCorner(0.05), stucco(), 3000, { kind: "corner" });
  assert.equal(c.struck.layers[0].kind, "stretched");
});

test("pushed square on, a crate stops at the wall; at a slant past friction it slides along it, scratching the paint", () => {
  const P = crate(), W = stucco();
  const square = C.push(P, W, { force_n: 300, angle_deg: 0 });
  assert.equal(square.slides, false);
  assert.equal(square.stopped, true);
  const mu = square.friction.static, slant = (Math.atan(mu) * 180) / Math.PI;
  const jam = C.push(P, W, { force_n: 300, angle_deg: slant - 5, kind: "corner" });
  assert.equal(jam.slides, false);
  assert.ok(near(jam.normal_n, 300 * Math.cos(((slant - 5) * Math.PI) / 180), 1e-9));
  const slide = C.push(P, W, { force_n: 300, angle_deg: slant + 10, kind: "corner", length_m: 0.5 });
  assert.equal(slide.slides, true);
  assert.equal(slide.stopped, true, "it does not go into the wall");
  assert.equal(slide.contact.struck.layers[0].kind, "cut_through");
  assert.equal(slide.contact.struck.layers[0].length_m, 0.5);
  assert.equal(slide.contact.struck.layers[1].kind, "none");
  assert.ok(slide.drag_n >= slide.friction.dynamic * slide.normal_n);
});

test("a brittle coat cracked with a dent flakes off as far as shear lag says; a stretchy one only stretches", () => {
  const hit = (S) => C.contact(steelCorner(0.003), S, 3000, { kind: "corner" }).struck;
  const latexWood = hit(C.stats("building.exterior", { cladding: "wood_siding" }));
  assert.equal(latexWood.layers[0].flaked, undefined, "latex rides the dent");
  const door = C.stats("building.door"), m = hit(door);
  assert.equal(m.layers[0].flaked, true);
  const l = door.layers[0], sigma = Math.min(l.modulus_pa * l.failure_strain, l.strength_pa);
  const run = (Math.PI * sigma * l.thickness_m) / (2 * l.adhesion_pa);
  assert.ok(near(m.layers[0].flake_width_m, m.layers[0].width_m + 2 * run, 1e-9));
  // Half the adhesion, twice the run.
  const weak = JSON.parse(JSON.stringify(CAT));
  weak.mechanics.coatings.alkyd_enamel.adhesion_mpa /= 2;
  const Cw = createCollisions(createMechanics(weak), weak);
  const mw = Cw.contact(Cw.stats({ name: "Steel box", substance: "mild_steel", coat: null, form: { shape: "box", section: { b_m: 0.6, h_m: 0.002 }, span_m: 0.6, edge_r_m: 0.003 }, mass_kg: 40 }), Cw.stats("building.door"), 3000, { kind: "corner" }).struck;
  assert.ok(near(mw.layers[0].flake_width_m - mw.layers[0].width_m, 2 * (m.layers[0].flake_width_m - m.layers[0].width_m), 1e-6));
});

test("break force from the section (Roark): a beam 4 sigma Z / L, a post sigma Z_p / L; twice as deep, four times as strong", () => {
  const bench = C.stats("furniture.bench"), wood = M.substance("douglas_fir_dry");
  const Z = (0.09 * 0.04 ** 2) / 6;
  assert.ok(near(bench.break_force_n, (4 * wood.uts * Z) / 1.8, 1e-9));
  const deep = C.stats("furniture.bench", { form: { section: { b_m: 0.09, h_m: 0.08 } } });
  assert.ok(near(deep.break_force_n / bench.break_force_n, 4, 1e-9));
  const post = C.stats("furniture.sign_post"), steel = M.substance("mild_steel");
  const Zp = (0.06 ** 3 - (0.06 - 2 * 0.0027) ** 3) / 6;
  assert.ok(near(post.bend_force_n, (steel.yield * Zp) / 2.4, 1e-9));
  assert.ok(post.break_force_n > post.bend_force_n, "a steel post bends before it breaks");
  assert.equal(bench.bend_force_n, bench.break_force_n, "wood breaks where it would bend");
  // A ductile sheet is dished in at its yield-line collapse load, 2 pi m_p.
  const door = C.stats("vehicle.body");
  assert.ok(near(door.bend_force_n, (Math.PI / 2) * steel.yield * 0.0008 ** 2, 1e-9));
  assert.ok(door.bend_force_n > 150 && door.bend_force_n < 400, `${door.bend_force_n} N`);
});

test("a blow's energy is 1/2 mu v^2 with the reduced mass, and momentum is kept", () => {
  const P = crate(), W = stucco();
  const fixed = C.impact(P, W, { speed_mps: 0.8, kind: "face" });
  assert.ok(near(fixed.energy_j, 0.5 * 30 * 0.64, 1e-9));
  assert.equal(fixed.stopped, true);
  assert.ok(fixed.speed_after_mps <= 0);
  const other = C.stats("interior.furniture", { fixed: false, mass_kg: 30 });
  const free = C.impact(P, other, { speed_mps: 0.8, kind: "face" });
  assert.ok(near(free.energy_j, fixed.energy_j / 2, 1e-9), "equal masses: half of it");
  assert.ok(near(30 * free.speed_after_mps + 30 * free.struck_speed_mps, 30 * 0.8, 1e-9));
});

test("a fast heavy blow cracks a window at its strength and smashes it past its durability", () => {
  const win = C.stats("building.window");
  const slow = C.impact(crate(), win, { speed_mps: 0.2, kind: "corner" });
  assert.equal(slow.struck_whole, "holds");
  const mid = C.impact(crate(), win, { speed_mps: 1.5, kind: "corner" });
  assert.equal(mid.struck_whole, "cracked");
  assert.ok(near(mid.force_n, win.break_force_n, 1e-9));
  const fast = C.impact(crate(), win, { speed_mps: 3, kind: "corner" });
  assert.equal(fast.struck_whole, "wrecked");
  assert.ok(fast.energy_j - 60 > 0);
});

test("a corner bumped into a painted render wall dents through the paint; the same speed square on marks nothing", () => {
  const W = stucco();
  const corner = C.impact(crate(), W, { speed_mps: 0.6, kind: "corner" });
  assert.notEqual(corner.contact.struck.layers[1].kind, "none");
  assert.equal(corner.stopped, true);
  const face = C.impact(crate(), W, { speed_mps: 0.6, kind: "face" });
  assert.deepEqual(kinds(face.contact.struck), ["none", "none"]);
});

test("a scrape wears what slides on grit by Archard: twice as far, twice as much", () => {
  const a = C.scrape(steelCorner(), stucco(), { normal_n: 200, slide_m: 0.2 });
  const b = C.scrape(steelCorner(), stucco(), { normal_n: 200, slide_m: 0.4 });
  assert.ok(a.worn_lead_m3 > 0);
  assert.ok(near(b.worn_lead_m3, 2 * a.worn_lead_m3, 1e-9));
  assert.ok(near(b.worn_struck_m3, 2 * a.worn_struck_m3, 1e-9));
});

test("in the city a pushed thing is stopped by walls and things, takes the blow and leaves the marks (wiring)", () => {
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.match(view, /createCollisions\(M, catalogue\)/);
  assert.match(view, /function pushBlocked[\s\S]*?footprintAt[\s\S]*?instancesNear/);
  assert.match(view, /function meetObstacle[\s\S]*?Cn\.impact\([\s\S]*?Cn\.push\([\s\S]*?r\.slides/);
  assert.match(view, /const hit = pushing\.S \? pushBlocked\(nx, nz, fx, fz\) : null;/);
  assert.match(view, /function drawMarks/);
});

test("the words say which layer took the mark and that the wall under the paint was not touched", () => {
  const r = C.scrape(steelCorner(), stucco(), { normal_n: 200, slide_m: 0.3 });
  assert.match(r.text, /cut through the paint/);
  assert.match(r.text, /the render under it unmarked/);
});
