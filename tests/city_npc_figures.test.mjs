// The near ring's Unreal figures: the weight repair of the export, the retarget of the mannequin's
// clips, and the view's wiring (docs/51-near-ring-people-and-surfaces.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { readGlb, writeGlb, reweight } from "../tools/build_npc_characters.mjs";
import { NEAR_FIGURES_MAX, retarget, cloneSkinned } from "../docs/city/npc-figures.mjs";

// A two-bone arm along +y (shoulder at 0, elbow at 1, wrist at 2) with one vertex by each bone,
// written as Unreal's exporter writes them: uint8 lists padded with a far-off filler bone (2).
function armGlb() {
  const ibm = new Float32Array(48);
  [0, 1, 2].forEach((j) => { const m = new THREE.Matrix4().makeTranslation(0, -j, 0); ibm.set(m.elements, j * 16); });
  const pos = new Float32Array([0.05, 0.4, 0, 0.05, 1.6, 0]);
  const joints = new Uint8Array([0, 1, 2, 2, 1, 0, 2, 2]);
  const weights = new Uint8Array([200, 40, 9, 7, 13, 250, 3, 1]);
  const parts = [ibm, pos, joints, weights].map((a) => Buffer.from(a.buffer));
  let off = 0; const views = parts.map((p) => { const v = { buffer: 0, byteOffset: off, byteLength: p.length }; off += p.length; return v; });
  const json = {
    asset: { version: "2.0" }, buffers: [{ byteLength: off }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "MAT4" }, { bufferView: 1, componentType: 5126, count: 2, type: "VEC3" },
      { bufferView: 2, componentType: 5121, count: 2, type: "VEC4" }, { bufferView: 3, componentType: 5121, count: 2, type: "VEC4", normalized: true },
    ],
    nodes: [{ name: "upperarm", children: [1] }, { name: "lowerarm", translation: [0, 1, 0], children: [2] }, { name: "hand", translation: [0, 1, 0] }, { mesh: 0, skin: 0 }],
    skins: [{ joints: [0, 1, 2], inverseBindMatrices: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, JOINTS_0: 2, WEIGHTS_0: 3 } }] }],
  };
  return writeGlb(json, Buffer.concat(parts));
}

test("reweight gives each vertex to the bone it lies along, dropping the exporter's filler", () => {
  const { json, bin } = readGlb(reweight(armGlb()));
  const at = json.meshes[0].primitives[0].attributes;
  const read = (i, T) => { const a = json.accessors[i], v = json.bufferViews[a.bufferView]; return new T(bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + v.byteLength)); };
  assert.equal(json.accessors[at.JOINTS_0].componentType, 5123);
  assert.equal(json.accessors[at.WEIGHTS_0].componentType, 5126);
  const J = read(at.JOINTS_0, Uint16Array), W = read(at.WEIGHTS_0, Float32Array);
  for (const v of [0, 1]) assert.ok(Math.abs(W[v * 4] + W[v * 4 + 1] + W[v * 4 + 2] + W[v * 4 + 3] - 1) < 1e-5);
  assert.equal(J[0], 0); assert.ok(W[0] > 0.9);   // by the upper arm
  assert.equal(J[4], 1); assert.ok(W[4] > 0.9);   // by the forearm
  assert.ok(![...J].some((j, k) => j === 2 && W[k] > 0), "the filler bone gets nothing");
  assert.equal(at.JOINTS_1, undefined);
});

function skeleton(names, offsetY = 0) {
  const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }));
  for (let i = 1; i < bones.length; i += 1) { bones[i].position.y = 0.4 + offsetY; bones[i - 1].add(bones[i]); }
  bones[0].updateMatrixWorld(true);
  return new THREE.Skeleton(bones);
}

test("retarget turns the target's limb as the source's turns, and helper bones follow their limb", () => {
  const from = skeleton(["pelvis", "thigh_l", "calf_l"]);
  const to = skeleton(["pelvis", "thigh_l", "thigh_twist_01_l", "calf_l"], 0.05);
  const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.8);
  const clip = new THREE.AnimationClip("walk", 1, [new THREE.QuaternionKeyframeTrack("thigh_l.quaternion", [0, 1], [...bend.toArray(), ...bend.toArray()])]);
  const out = retarget(THREE, clip, from, to);
  const names = out.tracks.map((t) => t.name);
  assert.ok(names.includes("thigh_l.quaternion"));
  const mixer = new THREE.AnimationMixer(to.bones[0]);
  mixer.clipAction(out).play(); mixer.update(0.5); to.bones[0].updateMatrixWorld(true);
  const thigh = new THREE.Quaternion(); to.bones[1].getWorldQuaternion(thigh);
  assert.ok(thigh.angleTo(bend) < 1e-3, "the thigh bends as the source's does");
  const twist = new THREE.Quaternion(); to.bones[2].getWorldQuaternion(twist);
  assert.ok(twist.angleTo(bend) < 1e-3, "the twist bone goes with the thigh");
});

test("cloneSkinned gives a figure its own skeleton", () => {
  const skel = skeleton(["pelvis", "spine_01"]);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const root = new THREE.Group(); root.add(skel.bones[0]); root.add(mesh); mesh.bind(skel);
  const copy = cloneSkinned(THREE, root);
  let m2; copy.traverse((o) => { if (o.isSkinnedMesh) m2 = o; });
  assert.ok(m2 && m2.skeleton !== skel && m2.skeleton.bones[0] !== skel.bones[0]);
});

test("the view draws at most NEAR_FIGURES_MAX near people as figures and steps the rest down a ring", () => {
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.equal(NEAR_FIGURES_MAX, 16);
  assert.match(view, /near\.length < NEAR_FIGURES_MAX && figureFits\(q\.p\)/);
  assert.match(view, /full = full\.filter\(\(q\) => !drawn\.has\(q\)\)\.concat\(mid\); mid = low; low = \[\];/);
  assert.match(view, /if \(!figures\.failed\)/, "the old jointed figures stay until the models load");
});

test("the near-surface shader has one photo and normal for each surface kind", () => {
  const src = readFileSync(new URL("../src/smc/renderer/page/module/02-reconstructed-world-objects.js", import.meta.url), "utf8");
  for (const kind of ["asphalt", "concrete", "wood", "painted-wood"]) {
    assert.match(src, new RegExp(`"${kind}":|${kind.replace("-", "_")}:|"${kind}"`));
    for (const f of ["color", "normal"]) readFileSync(new URL(`../docs/textures/near/${kind}-${f}.jpg`, import.meta.url));
  }
  assert.match(src, /new THREE\.Vector3\(32, 58, 1\)/, "full within 32 m, gone by 58 m");
});
