// Fine shadows near you (docs/fine-shadows.mjs): what is drawn from the sun's side and what is not.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { FINE, GROUND, castsNothing, casters, batches, trianglesOf, snapAcross, strengthFor } from "../docs/fine-shadows.mjs";
import { flatten, redeclared } from "../docs/shader-check.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const mesh = (surface, material = new THREE.MeshStandardMaterial()) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material); if (surface) m.userData.surface = surface; return m; };

test("the ground does not shade itself, and a kerb's edge does cast", () => {
  for (const s of ["walk", "walk_underlay", "road", "terrain", "nature_terrain", "yard", "park", "plaza", "tile", "marking", "crossing", "inferred:grass", "inferred:paving", "park:playground:fill", "tree_pit|hard_ground"]) assert.ok(GROUND.test(s) && castsNothing(mesh(s)), s);
  for (const s of ["kerb", "building", "tree:street", "fence:chainlink_post|property", "fence:board", "median", "bike", "house_window", "public_stairs", "fence:gate_frame|property"]) assert.ok(!GROUND.test(s) && !castsNothing(mesh(s)), s);
});

test("wires, glows, glass and the old blobs cast nothing; a fence's fabric says so itself", () => {
  assert.ok(castsNothing(new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial())));
  assert.ok(castsNothing(new THREE.Sprite()));
  assert.ok(castsNothing(mesh(null, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }))));
  assert.ok(castsNothing(mesh(null, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 }))));
  assert.ok(!castsNothing(mesh(null, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.9 }))));
  const fabric = new THREE.MeshStandardMaterial(); fabric.userData.noShadow = true;
  assert.ok(castsNothing(mesh("fence:chainlink|property", fabric)));
  const marked = mesh("building"); marked.userData.noShadow = true;
  assert.ok(castsNothing(marked));
  assert.ok(!castsNothing(new THREE.Group()));
});

test("what stands still is listed once each, without what is hidden or what moves", () => {
  const scene = new THREE.Scene(), city = new THREE.Group(), hidden = new THREE.Group();
  const house = mesh("building"), door = mesh("house_door"), road = mesh("road"), kerbOnRoad = mesh("kerb"), car = mesh("car"), ghost = mesh("building");
  house.add(door); road.add(kerbOnRoad); city.add(car); hidden.add(ghost); hidden.visible = false;
  scene.add(house, road, city, hidden);
  const list = casters(scene, new Set([city]));
  // The door comes with its house (a mesh draws its children); the kerb under a road is its own.
  assert.deepEqual(list, [house, kerbOnRoad]);
});

test("the still map is drawn a frame's share at a time", () => {
  assert.deepEqual(batches([5, 5, 20, 1, 1], 10), [[0, 2], [2, 3], [3, 5]]);
  assert.deepEqual(batches([], 10), []);
  assert.deepEqual(batches([50], 10), [[0, 1]]);
  const many = Array.from({ length: 40 }, () => 100000), parts = batches(many, FINE.frame_tris);
  assert.equal(parts.length, Math.ceil(4000000 / FINE.frame_tris));
  assert.equal(parts.at(-1)[1], 40);
  assert.equal(trianglesOf(mesh("x")), 12);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 10); inst.count = 3;
  assert.equal(trianglesOf(inst), 36);
});

test("the square moves in whole texels, and the shadows fade out towards sunset", () => {
  const right = { x: 1, y: 0, z: 0 }, up = { x: 0, y: 0, z: -1 }, texel = (2 * FINE.half_m) / FINE.size;
  const c = snapAcross({ x: 10.03, y: 2, z: -7.02 }, right, up, texel);
  assert.ok(Math.abs(c.x / texel - Math.round(c.x / texel)) < 1e-6 && Math.abs(c.z / texel - Math.round(c.z / texel)) < 1e-6);
  assert.ok(Math.hypot(c.x - 10.03, c.z + 7.02) <= texel);
  assert.ok(texel < 0.06, "a texel is a few centimetres: a person's outline, a post, a kerb's edge");
  assert.equal(strengthFor(FINE.min_el_deg - 1), 0);
  assert.equal(strengthFor(40), 1);
  assert.ok(strengthFor((FINE.min_el_deg + FINE.fade_el_deg) / 2) > 0.4 && strengthFor((FINE.min_el_deg + FINE.fade_el_deg) / 2) < 0.6);
});

test("the page reads the fine map in every lit surface, and nothing turns on a three.js shadow", () => {
  const world = read("../src/smc/renderer/page/module/02-reconstructed-world-objects.js"), loop = read("../src/smc/renderer/page/module/27-detail-by-zoom-the-city.js"), fine = read("../docs/fine-shadows.mjs"), view = read("../docs/city/view.mjs");
  assert.match(world, /import\(sharedAsset\("fine-shadows\.mjs"\)\)/);
  assert.match(world, /shader\.uniforms\.kbFSMap = P\.fineMap; shader\.uniforms\.kbFSMoving = P\.fineMoving;/);
  assert.match(world, /min\(texture2D\(kbFSMap, kbFSuv\)\.r, texture2D\(kbFSMoving, kbFSuv\)\.r\)/);
  assert.match(loop, /fineShadowController\?\.update\(now,/);
  // (A light that casts changes every material's program: docs/freeze-investigation.)
  for (const src of [world, fine]) assert.doesNotMatch(src, /castShadow\s*=\s*true|shadowMap\.enabled\s*=\s*true/);
  // A person's round blob gives way to their outline where the sun draws it.
  assert.match(view, /peopleShade\.material\.opacity = 0\.5 - 0\.36 \* \(globalThis\.__kerbsideProxyLight\?\.fineK\?\.value\.x \|\| 0\)/);
});

test("chain link is woven wire with posts and a top rail, and its shader compiles", () => {
  const trees = read("../src/smc/renderer/page/module/17-trees-a-trunk-limbs-and.js"), parks = read("../src/smc/renderer/page/module/18-inside-the-parks-playgrounds-dog.js");
  const from = trees.indexOf("let CHAINLINK_MATERIAL = null;"), to = trees.indexOf("function netTexture()");
  assert.ok(from > 0 && to > from);
  const material = Function("THREE", `${trees.slice(from, to)}\nreturn chainlinkMaterial();`)(THREE);
  assert.equal(material.userData.noShadow, true);
  assert.ok(material.metalness < 0.2 && material.color.getHex() < 0x303030, "black vinyl, not bare galvanised wire");
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  const defines = { STANDARD: "", NUM_DIR_LIGHTS: 1, NUM_HEMI_LIGHTS: 1, NUM_POINT_LIGHTS: 0, NUM_SPOT_LIGHTS: 0, NUM_RECT_AREA_LIGHTS: 0, NUM_DIR_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_MAPS: 0, NUM_SPOT_LIGHT_COORDS: 0, NUM_POINT_LIGHT_SHADOWS: 0, NUM_LIGHT_PROBES: 0, NUM_CLIPPING_PLANES: 0, UNION_CLIPPING_PLANES: 0, DOUBLE_SIDED: "" };
  for (const stage of ["vertexShader", "fragmentShader"]) assert.deepEqual(redeclared(flatten(shader[stage], THREE.ShaderChunk, defines)), [], stage);
  const flat = flatten(shader.fragmentShader, THREE.ShaderChunk, defines);
  assert.match(flat, /fwidth\(kbCA\)/, "a wire is never thinner than a pixel: the fence is there edge-on");
  assert.match(flat, /kbCKnot/, "the knuckles where the wires hook together");
  // No picture of wires on a sheet is left on a chain-link panel.
  assert.equal((parks.match(/chainlinkTexture\(\)/g) || []).length, 0);
  assert.equal((trees.match(/map: chainlinkTexture\(\)/g) || []).length, 0);
  assert.match(parks, /for \(let d = 0; d < span; d \+= 2\.8\) sink\.posts\.push/, "posts at about ten feet");
  assert.match(parks, /\(sink\.rails \|\|= \[\]\)\.push\(\[ax, az, bx, bz, run\.h, 0\.042\]/, "a top rail");
});
