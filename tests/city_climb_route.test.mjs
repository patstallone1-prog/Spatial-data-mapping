// The climbing route: holds by what a thing is, the next move by direction, the top-out, jumps.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMechanics } from "../docs/city/mechanics.mjs";
import { createClimbing } from "../docs/city/climbing.mjs";
import { BODY, LIMBS, applyMove, faceKindOf, faceOf, hipsOf, holdsOf, jumpPlan, limbOrder, nextMove, reaches, startOn, topOut } from "../docs/city/climb-route.mjs";

const M = createMechanics(JSON.parse(readFileSync(new URL("../docs/object-catalogue.json", import.meta.url))));
const C = createClimbing(M);
const someone = { kg: 75, strength: 20, hands: "skin", feet: "shoe_rubber" };

//: Climb ``face`` going ``dir`` until the top, the ground or no move: the moves made and how it ended.
function climbOut(face, dir = { u: 0, v: 1 }, S = startOn(face), most = 60, who = someone) {
  const moves = [];
  for (let i = 0; i < most; i += 1) {
    const m = nextMove(S, dir, C, who);
    if (m.kind === "top" || m.kind === "off" || !m.moves.length) return { S, moves, end: m };
    // Every move: one or two limbs, and the new stance reached from its hips.
    assert.ok(m.moves.length >= 1 && m.moves.length <= 2, `${m.moves.length} limbs`);
    S = applyMove(S, m);
    assert.ok(reaches(S.limbs, S.hip), "every limb in reach after the move");
    assert.ok(m.effort <= 1 + 1e-9, `effort ${m.effort}`);
    moves.push(m);
  }
  return { S, moves, end: { reason: "too many moves" } };
}

test("each kind of thing climbs from the ground to its top, and over the top the way it should", () => {
  const cases = [
    [{ kind: "chainlink", height_m: 2.4 }, "straddle"],
    [{ kind: "board", height_m: 1.8, key: "a" }, "straddle"],
    [{ kind: "picket", height_m: 1.5 }, "straddle"],
    [{ kind: "wall", height_m: 2.4, thickness_m: 0.3 }, "mantle"],
    [{ kind: "rock", height_m: 4, key: "boulder" }, "mantle"],
    [{ kind: "tree", height_m: 3.2, thickness_m: 0.4, u0: -0.25, u1: 0.25, key: "oak" }, "perch"],
  ];
  for (const [spec, top] of cases) {
    const r = climbOut(faceOf(spec));
    assert.equal(r.end.kind, "top", `${spec.kind}: ${r.end.reason} after ${r.moves.length} moves`);
    assert.equal(r.end.top, top, spec.kind);
    assert.ok(r.moves.length <= 30, `${spec.kind} took ${r.moves.length} moves`);
  }
});

test("limbs go in turn: no limb three times running, and mostly one limb at a time", () => {
  for (const spec of [{ kind: "rock", height_m: 4, key: "r2" }, { kind: "chainlink", height_m: 3.5 }]) {
    const r = climbOut(faceOf(spec));
    let run = 0, prev = null, pairs = 0;
    for (const m of r.moves) {
      const key = m.moves.map((x) => x.limb).join("+");
      run = key === prev ? run + 1 : 1; prev = key;
      assert.ok(run < 3, `${key} three times running`);
      if (m.moves.length === 2) pairs += 1;
    }
    assert.ok(pairs <= r.moves.length / 2, `${pairs} of ${r.moves.length} moves were pairs`);
  }
});

test("going up, the body rises; across, it goes across; down, it comes back to the ground and off", () => {
  const face = faceOf({ kind: "chainlink", height_m: 3.5, u0: -4, u1: 4 });
  let S = startOn(face);
  const up = climbOut(face, { u: 0, v: 1 }, S, 5);
  assert.ok(up.S.hip.v > S.hip.v + 0.3, `up from ${S.hip.v} to ${up.S.hip.v}`);
  S = up.S;
  const across = climbOut(face, { u: 1, v: 0 }, S, 6);
  assert.ok(across.S.hip.u > S.hip.u + 0.5, `across to ${across.S.hip.u}`);
  const left = climbOut(face, { u: -1, v: 1 }, across.S, 4);
  assert.ok(left.S.hip.u < across.S.hip.u && left.S.hip.v >= across.S.hip.v - 0.05, "diagonal up and left");
  const down = climbOut(face, { u: 0, v: -1 }, left.S, 30);
  assert.equal(down.end.kind, "off", down.end.reason);
});

test("the order: hands lead going up, feet going down, the leading side going across", () => {
  assert.deepEqual(limbOrder({ u: 0, v: 1 }).slice(0, 2), ["rh", "lf"]);
  assert.equal(limbOrder({ u: 0, v: -1 })[0].endsWith("f"), true);
  assert.deepEqual(limbOrder({ u: 1, v: 0 }).slice(0, 2), ["rh", "rf"]);
  assert.deepEqual(limbOrder({ u: -1, v: 0 }).slice(0, 2), ["lh", "lf"]);
  assert.equal(limbOrder({ u: -0.7, v: 0.7 })[0], "lh");
});

test("a face with nothing to hold is not climbed, and a wet rock is harder than a dry one", () => {
  const smooth = faceOf({ kind: "smooth", height_m: 3.2, substance: "stucco" });
  const r = climbOut(smooth);
  assert.notEqual(r.end.kind, "top");
  const effort = (wet) => {
    const face = faceOf({ kind: "rock", height_m: 4, key: "slab", substance: "sandstone", wet });
    return climbOut(face, { u: 0, v: 1 }, startOn(face), 6).moves.reduce((s, m) => s + m.effort, 0);
  };
  assert.ok(effort(true) > effort(false), `wet ${effort(true)} dry ${effort(false)}`);
});

test("holds are the same every time for the same thing, and only where it is", () => {
  const face = faceOf({ kind: "rock", height_m: 3, key: "x", u0: -1, u1: 1 });
  assert.deepEqual(holdsOf(face), holdsOf(face));
  assert.ok(holdsOf(face).every((h) => h.u >= -1 && h.u <= 1 && h.v <= 3));
  assert.notDeepEqual(holdsOf(faceOf({ kind: "rock", height_m: 3, key: "y", u0: -1, u1: 1 })), holdsOf(face));
  assert.ok(holdsOf(faceOf({ kind: "board", height_m: 1.8 })).some((h) => h.top));
});

test("the hips sit between the limbs, and a stance out of reach is no stance", () => {
  const L = { lh: { u: -0.2, v: 2 }, rh: { u: 0.2, v: 2 }, lf: { u: -0.1, v: 0.5 }, rf: { u: 0.1, v: 0.5 } };
  const hip = hipsOf(L);
  assert.ok(hip.v > 0.8 && hip.v < 1.5 && Math.abs(hip.u) < 1e-9, JSON.stringify(hip));
  assert.equal(hipsOf({ ...L, lh: { u: -0.2, v: 3.5 }, rh: { u: 0.2, v: 3.5 } }), null);
  assert.equal(hipsOf({ ...L, lf: { u: -0.1, v: 1.9 }, rf: { u: 0.1, v: 1.9 } }), null);
  for (const k of LIMBS) assert.ok(L[k]);
});

test("a jump: onto a low wall, over a low fence, up to a high top, onto holds on a tall face", () => {
  assert.equal(jumpPlan(faceOf({ kind: "wall", height_m: 0.7, thickness_m: 0.35 })).action, "land_top");
  assert.equal(jumpPlan(faceOf({ kind: "picket", height_m: 1.1 })).action, "vault");
  assert.equal(jumpPlan(faceOf({ kind: "wall", height_m: 2.5, thickness_m: 0.3 })).action, "catch_top");
  assert.equal(jumpPlan(faceOf({ kind: "rock", height_m: 5 })).action, "catch_holds");
  assert.equal(jumpPlan(faceOf({ kind: "wall", height_m: 2.5 }), { distance_m: 2.5 }).action, "none");
  // A run up gets higher.
  const tall = faceOf({ kind: "wall", height_m: 2.68, thickness_m: 0.3 });
  assert.equal(jumpPlan(tall, { jump_m: 0.4 }).action, "catch_holds");
  assert.equal(jumpPlan(tall, { jump_m: 0.4, running: true }).action, "catch_top");
});

test("over the top: a mantle stands on it, a straddle ends hanging on the far side, a tree's fork is sat in", () => {
  const wall = faceOf({ kind: "wall", height_m: 2, thickness_m: 0.3 });
  const mantle = topOut(wall, "mantle");
  assert.ok(mantle.at(-1).hip.v > wall.height_m + 0.5 && mantle.at(-1).feet === "on top");
  const fence = faceOf({ kind: "chainlink", height_m: 2 });
  const over = topOut(fence, "straddle");
  assert.ok(over.at(-1).hip.out < 0 && over.at(-1).hip.v < fence.height_m);
  assert.deepEqual(over.map((s) => s.name), ["press", "leg over", "swing over", "hang"]);
  assert.equal(topOut(faceOf({ kind: "tree", height_m: 3 }), "perch").at(-1).name, "sit");
  assert.ok([...mantle, ...over].every((s) => s.dur_s > 0.2 && s.dur_s < 1));
});

test("the catalogue's climbable things each have a face", () => {
  for (const id of ["barrier.fence_board", "barrier.fence_picket", "barrier.fence_chainlink", "barrier.wall", "geology.rock", "vegetation.tree"]) assert.ok(faceKindOf(id), id);
  assert.equal(faceKindOf("furniture.street_light"), null);
  assert.ok(BODY.standing_reach_m > 2 && BODY.standing_reach_m < 2.3);
});
