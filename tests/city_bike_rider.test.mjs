// The city's cyclists on the Voltage MTB's LOD3 (docs/city/vehicles.mjs BIKE, riderPose): its
// wheels and crank turning as it goes, the pedals carried round level, and its rider sat on the
// saddle with hands on the grips and feet on the pedals, the knees between.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { BIKE, RIDER, bikeParts, crankTurn, pedalAt, riderPose, wheelTurn } from "../docs/city/vehicles.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const manifest = JSON.parse(read("docs/city/models/fleet/fleet.json")).bike;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const near = (a, b, tol = 1e-3) => dist(a, b) < tol;

test("the bicycle's measurements are the built model's", () => {
  assert.equal(`city/models/fleet/${manifest.file}`, BIKE.file);
  assert.deepEqual([...BIKE.parts].sort(), [...manifest.parts].sort());
  for (const [k, v] of Object.entries(BIKE.pivots)) assert.deepEqual(v, manifest.pivots[k], k);
  assert.deepEqual(BIKE.saddle, manifest.saddle);
  assert.deepEqual(BIKE.grips, manifest.grips);
  assert.equal(BIKE.wheel_radius, manifest.wheel_radius);
  assert.ok(manifest.triangles < 15000, "the LOD3, not the pack's heavier ones");
});

test("the bicycle's parts are told apart by their nodes: the six share one material", () => {
  const scene = new THREE.Group(), material = new THREE.MeshLambertMaterial({ name: "frame" });
  for (const name of BIKE.parts) {
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    if (name === "frame") geometry.setAttribute("_paint", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    scene.add(mesh);
  }
  const parts = bikeParts(THREE, { scene });
  assert.deepEqual(Object.keys(parts).sort(), [...BIKE.parts].sort());
  assert.ok(parts.frame.tint && !parts.wheel_front.tint, "the frame takes the paint");
});

test("the wheels roll forward and the crank turns slower, by the gear", () => {
  // Turned about +x by a negative angle, the top of the wheel goes to -z: forward.
  const a = wheelTurn(1);
  assert.ok(a < 0 && Math.abs(Math.abs(a) - 1 / BIKE.wheel_radius) < 1e-9, "a metre is 1/r radians");
  assert.ok(Math.abs(crankTurn(10) - wheelTurn(10) / BIKE.gear) < 1e-9);
  // The pedals go round the bottom bracket at the crank's length, opposite each other.
  const c = BIKE.pivots.crankset;
  const radius = (p) => Math.hypot(p[1] - c[1], p[2] - c[2]);
  for (const t of [0, 0.7, 2.1, 3.9]) {
    const L = pedalAt("left", t), R = pedalAt("right", t);
    assert.ok(Math.abs(radius(L) - radius(BIKE.pivots.left_pedal)) < 1e-6 && Math.abs(radius(R) - radius(BIKE.pivots.right_pedal)) < 1e-6);
    assert.ok(Math.abs((L[1] - c[1]) + (R[1] - c[1])) < 0.02 && Math.abs((L[2] - c[2]) + (R[2] - c[2])) < 0.02, "opposite");
  }
  assert.deepEqual(pedalAt("left", 0), BIKE.pivots.left_pedal);
});

test("the rider sits on the saddle, hands on the grips, feet on the pedals all the way round", () => {
  for (const s of [0.9, 0.97, 1.08]) {
    for (let k = 0; k < 16; k += 1) {
      const crank = (k / 16) * 2 * Math.PI, pose = riderPose(s, crank);
      // Hips just over the saddle; the figure's hips (0.84 up from its feet) where they are.
      assert.ok(pose.hipC[1] > BIKE.saddle[1] && pose.hipC[1] - BIKE.saddle[1] < 0.1);
      assert.ok(Math.abs(pose.root[1] + RIDER.hip_y * s - pose.hipC[1]) < 1e-9);
      assert.ok(Math.abs(pose.hipC[2] - BIKE.saddle[2]) < 0.05);
      // Hands on the grips, shoulders an arm's reach from them, leant forward.
      assert.deepEqual(pose.hands, BIKE.grips);
      for (let i = 0; i < 2; i += 1) assert.ok(dist(pose.shoulders[i], pose.hands[i]) < RIDER.arm * s * 1.05);
      assert.ok(pose.lean > 0.1 && pose.lean < 1.0, `lean ${pose.lean}`);
      // Each foot on its pedal, and the leg's two bones their lengths (the knee bent forward).
      for (const [i, side] of [[0, "left"], [1, "right"]]) {
        const pedal = pedalAt(side, crank);
        assert.ok(near(pose.feet[i], [pedal[0], pedal[1] + RIDER.sole, pedal[2]]), `foot ${side}`);
        const reach = dist(pose.hips[i], pose.feet[i]);
        if (reach < (RIDER.thigh + RIDER.shin) * s * 0.999) {
          assert.ok(Math.abs(dist(pose.hips[i], pose.knees[i]) - RIDER.thigh * s) < 1e-6, "thigh");
          assert.ok(Math.abs(dist(pose.knees[i], pose.feet[i]) - RIDER.shin * s) < 1e-6, "shin");
        }
        assert.ok(pose.knees[i][2] < Math.max(pose.hips[i][2], pose.feet[i][2]), "the knee forward of the hip or the foot");
        assert.ok(pose.knees[i][1] > pose.feet[i][1], "the knee above the foot");
      }
    }
  }
  // The legs reach the pedals at the bottom of the stroke for a person of ordinary height.
  const low = riderPose(0.97, Math.PI / 2);
  assert.ok(dist(low.hips[0], low.feet[0]) <= (RIDER.thigh + RIDER.shin) * 0.97 + 0.02);
});

test("the page draws the LOD3 turning, the riders' two-bone legs, and the far tier the built frame", () => {
  const view = read("docs/city/view.mjs");
  assert.match(view, /ctx\.loadModel\?\.\(ctx\.asset\(BIKE\.file\)\)/);
  assert.ok(!/\bbikeGeo\b/.test(view), "the old code-built bicycle is not the near one");
  assert.match(view, /const odo = tier === FULL \? b\.odo \|\| 0 : 0, wheel = wheelTurn\(odo\), crank = crankTurn\(odo\);/);
  assert.match(view, /const pose = riderPose\(s, crankTurn\(p\.bike\.odo \|\| 0\), body\.build\);/);
  assert.match(view, /bone\(riderLegs\.shinL, r, pose\.knees\[0\], pose\.feet\[0\], 1, s\)/);
  assert.match(view, /if \(p\.ride === "bike" && p\.bike\) \{\n\s+const b = riderFrame\(p\.bike, s, riderPose\(s, 0, body\.build\), B\);/);
  assert.match(view, /if \(!L \|\| tier === LOW\)/);
});
