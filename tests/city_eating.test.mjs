// Eating and drinking: what a bite or a cut leaves (docs/city/bites.mjs), a drink in its glass
// tipped to the lips (liquid.mjs), the mouthful plans and hands (eat-play.mjs), and every dish the
// kitchens make built and eaten to the end (dish-models.mjs, tableware.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { areaOf, biteCircles, contours, createMask, cutOff, fillMask, frontEdge, shapesOf, subtractCircles } from "../docs/city/bites.mjs";
import { capacityOf, createDrink, levelFor, tiltToReach, volumeAt } from "../docs/city/liquid.mjs";
import { actionFor, handsFor, mouthfulPlan, nextPart } from "../docs/city/eat-play.mjs";
import { makeDish } from "../docs/city/dish-models.mjs";
import { VESSELS, makeUtensil, placeSetting } from "../docs/city/tableware.mjs";
import { loadRules } from "../docs/city/core.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const DISHES = [...Object.keys(R.kitchen.recipes), "cocktail"];
const deg = (r) => (r * 180) / Math.PI;

test("a bite takes a scalloped arc out of the edge, and the outline is traced back counter-clockwise", () => {
  const M = createMask(0.06, 112);
  fillMask(M, (x, z) => x * x + z * z < 0.05 * 0.05);
  const whole = areaOf(M);
  assert.ok(Math.abs(whole - Math.PI * 0.05 ** 2) / whole < 0.03);
  const e = frontEdge(M, 0, 1);
  assert.ok(e.z > 0.045, `front edge at ${e.z}`);
  const taken = subtractCircles(M, biteCircles(e.x, e.z, 0, 1));
  assert.ok(taken > 0 && areaOf(M) < whole * 0.9 && areaOf(M) > whole * 0.6, `${taken} ${areaOf(M) / whole}`);
  const cs = contours(M);
  assert.ok(cs[0].area > 0, "the outer outline runs counter-clockwise");
  assert.equal(shapesOf(M).length, 1);
});

test("a knife cut takes what is past the line off as a piece of its own", () => {
  const M = createMask(0.06, 96);
  fillMask(M, (x, z) => Math.abs(x) < 0.05 && Math.abs(z) < 0.03);
  const whole = areaOf(M);
  const piece = cutOff(M, 0.03, 0, 1, 0);
  assert.ok(Math.abs(areaOf(piece) - 0.02 * 0.06) < 0.0002, `${areaOf(piece)}`);
  assert.ok(Math.abs(areaOf(M) + areaOf(piece) - whole) < 1e-9);
});

test("a pint: level when upright, tipped further to drink the emptier it is, and it pours over the lip", () => {
  const inner = VESSELS.pint.inner, cap = capacityOf(inner);
  assert.ok(cap > 4.4e-4 && cap < 6.2e-4, `pint holds ${cap * 1e6} ml`);
  assert.ok(Math.abs(volumeAt(inner, levelFor(inner, cap * 0.5)) - cap * 0.5) < cap * 0.01);
  const full = deg(tiltToReach(inner, cap * 0.9)), empty = deg(tiltToReach(inner, cap * 0.05));
  assert.ok(full > 5 && full < 25, `90% full: ${full}°`);
  assert.ok(empty > 65 && empty < 95, `5% left: ${empty}°`);
  const d = createDrink(inner, { fill: 0.9 });
  const tip = tiltToReach(inner, d.v);
  assert.equal(d.step(1 / 60, tip * 0.9), 0, "below the lip: nothing runs");
  let poured = 0;
  for (let i = 0; i < 30; i += 1) poured += d.step(1 / 60, tip + 0.15) / 60;
  assert.ok(poured > 0 && d.left() < 0.9, `${poured} ${d.left()}`);
  assert.ok(Math.abs(d.poured - poured) < 1e-12);
});

test("mouthful plans: a sip tips, a bite chews, a cut saws, each ends with a swallow", () => {
  for (const a of ["sip", "straw", "bite", "cut", "scoop", "spoon", "pick"]) {
    const plan = mouthfulPlan(a);
    assert.ok(plan.length >= 4, a);
    assert.equal(plan.at(-1)[0], "swallow", a);
    for (const [, s] of plan) assert.ok(s > 0, a);
  }
  assert.ok(mouthfulPlan("sip").some(([n]) => n === "tip"));
  assert.ok(mouthfulPlan("cut").some(([n]) => n === "saw"));
  assert.ok(mouthfulPlan("bite").some(([n]) => n === "chew"));
  assert.deepEqual(mouthfulPlan("nothing"), []);
  assert.equal(actionFor({ kind: "drink" }, "straw"), "straw");
  assert.equal(actionFor({ kind: "bite", cutPiece: () => null }, "fork_knife"), "cut");
  assert.equal(actionFor({ kind: "bite" }, "hand"), "bite");
  assert.equal(actionFor({ kind: "pool" }, "spoon"), "spoon");
  // Seated with a knife and fork: the knife in the right hand, the fork in the left; standing,
  // the plate in the left.
  assert.deepEqual(handsFor("plate", "fork_knife", { seated: true }), { R: "knife", L: "fork" });
  assert.deepEqual(handsFor("plate", "fork_knife"), { R: "fork", L: "plate" });
  assert.deepEqual(handsFor("drink", "hand"), { R: "vessel", L: null });
  const parts = [{ done: () => false, left: () => 0.3 }, { done: () => false, left: () => 0.8 }, { done: () => true, left: () => 1 }];
  assert.equal(nextPart(parts), parts[1]);
  assert.equal(nextPart([{ done: () => true, left: () => 0 }]), null);
});

test("every dish the kitchens make is built, with its tool and its form, and can be eaten to the end", () => {
  for (const id of DISHES) {
    const d = makeDish(THREE, R, id, { seed: 7 });
    assert.ok(d.group.isObject3D, id);
    assert.ok(d.food.length > 0, `${id}: nothing to eat`);
    assert.ok(typeof d.form === "string" && d.tool, `${id}: form ${d.form}, tool ${d.tool}`);
    const box = new THREE.Box3().setFromObject(d.group), size = box.getSize(new THREE.Vector3());
    assert.ok(size.x > 0.04 && size.x < 0.6 && size.y > 0.01 && size.y < 0.4, `${id}: ${size.x.toFixed(3)} × ${size.y.toFixed(3)}`);
    let n = 0;
    for (let p = nextPart(d.food); p && n < 600; p = nextPart(d.food), n += 1) {
      const a = actionFor(p, d.tool);
      if (p.kind === "drink") { p.drink.v = Math.max(0, p.drink.v - 25e-6); p.mesh?.update?.(p.drink); }
      else if (a === "cut" && p.cutPiece) { if (!p.cutPiece(0.028)) p.bite(); }
      else if (p.bite) p.bite();
      else if (p.kind === "pool") p.take(12);
      else p.take();
    }
    assert.ok(n < 600, `${id}: still not eaten after ${n} mouthfuls`);
    assert.ok(n >= 2, `${id}: eaten in ${n}`);
    assert.ok(d.food.every((p) => p.done()), id);
  }
});

test("tableware: the vessels' profiles rise to their rims, the utensils have grips, a place setting builds", () => {
  for (const [id, v] of Object.entries(VESSELS)) {
    assert.ok(v.outer.length >= 2, id);
    if (!v.inner) continue;   // (a plate: flat, nothing poured into it)
    assert.ok(v.inner.at(-1)[1] > v.inner[0][1], `${id}: rim above the bottom`);
    assert.ok(capacityOf(v.inner) > 0, id);
  }
  for (const k of ["fork", "knife", "spoon", "chopsticks"]) {
    const u = makeUtensil(THREE, k).userData.utensil;
    assert.ok(u.grip && u.tip && u.tip[2] > u.grip[2], k);
  }
  const s = placeSetting(THREE, { fine: true });
  assert.ok(s.isObject3D || Array.isArray(s) || typeof s === "object");
});
