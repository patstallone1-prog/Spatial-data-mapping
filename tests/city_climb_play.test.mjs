// The city's climbing as the page drives it (climb-play.mjs), on a stand-in page: a real three.js
// fence or wall mesh, found and measured by rays, climbed with the arrows, topped out, jumped off.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { createClimbPlay } from "../docs/city/climb-play.mjs";

const catalogue = readFileSync(new URL("../docs/object-catalogue.json", import.meta.url), "utf8");
globalThis.fetch = async () => ({ json: async () => JSON.parse(catalogue) });

//: A page with one thing in it: a ``kind`` box ``w`` wide, ``h`` high and ``t`` thick, its near face
//: on z = 0 (facing +z), and the walker ``d`` m in front of it, facing it.
function page({ id = "barrier.fence_chainlink", name = "Chain-link fence", material = "steel_galvanised", h = 2.2, t = 0.04, w = 6, d = 0.8 } = {}) {
  const standY = 0.1, avatar = new THREE.Group();
  avatar.position.set(0, standY, d); avatar.rotation.y = Math.PI;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), new THREE.MeshBasicMaterial());
  mesh.position.set(0, h / 2, -t / 2); mesh.updateMatrixWorld(true);
  const inside = (x, z, r) => Math.abs(x) < w / 2 + r && z < r && z > -t - r;
  const collider = { c: { o: mesh, a: { id, name, material } }, i: -1 };
  const notes = [];
  const ctx = {
    avatar, standY, catalogueUrl: "catalogue",
    objects: () => ({ blocked: (x, z, r) => (inside(x, z, r) ? collider : null) }),
    groundAt: () => 0,
    placeAvatar(x, y, z, yaw = null) { avatar.position.set(x, y + standY, z); if (yaw !== null) avatar.rotation.y = yaw; },
    moveAvatarTo(x, z) { avatar.position.set(x, standY, z); },
    moveWalker(dx, dz) { const p = avatar.position; if (!inside(p.x + dx, p.z + dz, 0.25)) { p.x += dx; p.z += dz; } },
    animateWalk() {},
  };
  const play = createClimbPlay({ THREE, ctx, notify: (t) => notes.push(t), legs: () => ({ height: 0.5, speed: 3.1 }), climber: () => ({ strength: 20 }) });
  return { play, ctx, avatar, notes };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
//: Step ``fn`` (stepClimb or stepAir) at 60 a second with ``keys`` held until ``done()`` (or 40 s).
function run(fn, keys, done, seconds = 40) {
  const held = new Set(keys);
  for (let i = 0; i < seconds * 60; i += 1) { fn(1 / 60, held); if (done()) return i; }
  return Infinity;
}

test("E on a chain-link fence: up it, over its thin top, down the far side and off", async () => {
  const { play, avatar, notes } = page();
  await settle();
  assert.ok(play.thingInFront(), "the fence is in front");
  const m = play.measure();
  assert.ok(m.spec, m.why);
  assert.ok(Math.abs(m.spec.height_m - 2.2) < 0.03, `height ${m.spec.height_m}`);
  assert.ok(m.spec.thickness_m < 0.1, `thickness ${m.spec.thickness_m}`);
  assert.ok(m.spec.u1 > 2 && m.spec.u0 < -2, "it runs both ways");
  play.climbKey();
  assert.ok(play.climbing, notes.at(-1));
  let topY = 0;
  const over = run(play.stepClimb, ["ArrowUp"], () => { topY = Math.max(topY, avatar.position.y); return notes.some((t) => t.startsWith("Over the top")); });
  assert.ok(over < Infinity, `never over: ${notes.slice(-3)}`);
  assert.ok(topY > 1.4, `the body went up (${topY.toFixed(2)})`);
  // Still holding Up on the far side does nothing until it is let go (and Down climbs down).
  const off = run(play.stepClimb, ["ArrowDown"], () => !play.climbing);
  assert.ok(off < Infinity, "never got down");
  assert.ok(avatar.position.z < -0.1, `down on the far side (z ${avatar.position.z.toFixed(2)})`);
  assert.ok(Math.abs(avatar.position.y - 0.1) < 1e-6, "feet on the ground");
});

test("up a garden wall to stand on its top, walk along it, and jump down the side you face", async () => {
  const { play, avatar, notes } = page({ id: "barrier.wall", name: "Wall", material: "brick", h: 2.0, t: 0.35 });
  await settle();
  play.climbKey();
  assert.ok(play.climbing);
  const stood = run(play.stepClimb, ["ArrowUp"], () => notes.some((t) => t.startsWith("On top")));
  assert.ok(stood < Infinity, `never stood: ${notes.slice(-3)}`);
  play.stepClimb(1 / 60, new Set());
  assert.ok(Math.abs(avatar.position.y - 0.1 - 2.0) < 0.02, `stood on the top (${avatar.position.y.toFixed(2)})`);
  // Left turns you along the top; Up walks along it.
  run(play.stepClimb, ["ArrowLeft"], () => false, 0.72);
  const x0 = avatar.position.x;
  run(play.stepClimb, ["ArrowUp"], () => false, 0.5);
  assert.ok(Math.abs(avatar.position.x - x0) > 0.3, "walked along the top");
  assert.ok(play.climbing && Math.abs(avatar.position.y - 2.1) < 0.02, "still up there");
  // Turn to face back the way you came, and jump: down on the near side, carried off the wall.
  run(play.stepClimb, ["ArrowRight"], () => false, 2.15);
  play.jumpKey();
  assert.ok(play.airborne);
  const landed = run(play.stepAir, [], () => !play.airborne, 5);
  assert.ok(landed < Infinity);
  assert.ok(avatar.position.z > 0.4, `landed in front of the wall (z ${avatar.position.z.toFixed(2)})`);
});

test("a running jump carries on the way you were running; a standing one lands where it left", async () => {
  const { play, avatar } = page({ d: 30 });
  await settle();
  avatar.rotation.y = Math.PI / 2;   // facing +x, away along the street
  for (let i = 0; i < 30; i += 1) play.noteSpeed(4.5 / 60, 1 / 60);
  play.jumpKey();
  assert.ok(play.airborne);
  run(play.stepAir, [], () => !play.airborne, 5);
  assert.ok(avatar.position.x > 1.5, `carried ${avatar.position.x.toFixed(2)} m`);
  const x1 = avatar.position.x;
  await new Promise((r) => setTimeout(r, 250));   // stood still: no pace left to carry
  play.jumpKey();
  run(play.stepAir, [], () => !play.airborne, 5);
  assert.ok(Math.abs(avatar.position.x - x1) < 0.05, `a standing jump stays put (${(avatar.position.x - x1).toFixed(2)})`);
});

test("Space at a low wall in front hops up onto it; at a high one, catches on and climbs", async () => {
  const low = page({ id: "barrier.wall", name: "Wall", material: "brick", h: 0.8, t: 0.3, d: 0.7 });
  await settle();
  low.play.jumpKey();
  run(low.play.stepAir, [], () => !low.play.airborne, 3);
  assert.ok(low.play.climbing, "stood on the low wall");
  low.play.stepClimb(1 / 60, new Set());
  assert.ok(Math.abs(low.avatar.position.y - 0.9) < 0.02, `on its top (${low.avatar.position.y.toFixed(2)})`);
  const high = page({ id: "barrier.wall", name: "Wall", material: "brick", h: 2.5, t: 0.3, d: 0.7 });
  await settle();
  high.play.jumpKey();
  assert.ok(high.play.climbing && !high.play.airborne, `caught on: ${high.notes.slice(-2)}`);
});

test("E with nothing in front says so; E on the face lets go and drops", async () => {
  const none = page({ d: 5 });
  await settle();
  none.play.climbKey();
  assert.ok(!none.play.climbing);
  assert.match(none.notes.at(-1), /Nothing to climb/);
  const { play, avatar } = page();
  await settle();
  play.climbKey();
  run(play.stepClimb, ["ArrowUp"], () => avatar.position.y > 0.9, 10);
  play.climbKey();
  assert.ok(play.airborne && !play.climbing);
  run(play.stepAir, [], () => !play.airborne, 3);
  assert.ok(Math.abs(avatar.position.y - 0.1) < 1e-6 && avatar.position.z > 0, "dropped back down in front");
});

test("a jump roughly at a tree trunk takes hold of it; facing well away it is a plain jump", async () => {
  // A trunk 0.4 m across and 6 m high, the walker 0.7 m from it, turned about 17 degrees off it.
  const { play, avatar, notes } = page({ id: "vegetation.tree", name: "Tree", material: "green_wood", h: 6, t: 0.4, w: 0.4, d: 0.7 });
  await settle();
  avatar.rotation.y = Math.PI + 0.3;
  assert.ok(play.thingInFront(), "roughly facing it, the trunk is found");
  assert.equal(play.jumpKey(), true);
  assert.ok(play.climbing, `took hold: ${notes.at(-1)}`);
  // Turned right away from it, a jump is only a jump.
  const other = page({ id: "vegetation.tree", name: "Tree", material: "green_wood", h: 6, t: 0.4, w: 0.4, d: 0.7 });
  await settle();
  other.avatar.rotation.y = Math.PI + 1.2;
  assert.equal(other.play.thingInFront(), null);
  other.play.jumpKey();
  assert.ok(!other.play.climbing);
});
