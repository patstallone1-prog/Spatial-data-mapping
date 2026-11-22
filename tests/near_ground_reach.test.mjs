// The near finish (module 02 NEAR_SURFACE: the photographed asphalt and concrete, and on the
// walks San Francisco's broomed, scored squares) is on all the ground you can see, from every
// camera the City allows, out to the City's far plane: with the horizon in view the fade lies
// past the haze, so there is no ring on the ground to see. And it is on every kind of paved
// ground the page draws near you.
//
// The ring had been 32 m full and gone by 58 m from the camera whatever the camera did: from the
// City's own camera (45 m back) the walk round you was half faded, and pulled out to 72 m none of
// it had the finish; then the fade was put at the ground seen ten degrees down, which pulled out
// showed as a circle round you (2026-11-21).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";

const MOD = (n) => readFileSync(new URL(`../src/smc/renderer/page/module/${n}`, import.meta.url), "utf8");
const M02 = MOD("02-reconstructed-world-objects.js"), M04 = MOD("04-the-bay-s-bridges-built.js"), M05 = MOD("05-near-the-walker-whole-blocks.js");
const M07 = MOD("07-materials.js"), M09 = MOD("09-where-openstreetmap-says-there-is.js"), M21 = MOD("21-the-electrical-network-poles-towers.js");
const M22 = MOD("22-explore-the-view-without-the.js"), M27 = MOD("27-detail-by-zoom-the-city.js");
const num = (src, name) => { const m = new RegExp(`const ${name} = ([0-9.]+)`).exec(src); assert.ok(m, name); return Number(m[1]); };

// NEAR_SURFACE as the page makes it: its object and its reach, run here on three.js itself.
function nearSurface() {
  const from = M02.indexOf("const NEAR_SURFACE = globalThis.__kerbsideNearSurface ||= {");
  const to = M02.indexOf("NEAR_SURFACE.mark ||=");
  const src = M02.slice(from, to).replace("const NEAR_SURFACE = globalThis.__kerbsideNearSurface ||=", "const NEAR_SURFACE =");
  return new Function("THREE", `${src}\nreturn NEAR_SURFACE;`)(THREE);
}
const N = nearSurface();

// The City's cameras: out of the walker's eyes, and the follow view round the walker.
const CITY_MAX_ORBIT_M = num(M21, "CITY_MAX_ORBIT_M"), ORBIT_MIN_PITCH = num(M21, "ORBIT_MIN_PITCH");
const ORBIT_MAX_PITCH = Number(/state\.pitch = Math\.max\(ORBIT_MIN_PITCH, Math\.min\(([0-9.]+), v\)\)/.exec(M21)[1]);
const FOV = Number(/new THREE\.PerspectiveCamera\(([0-9.]+), innerWidth/.exec(MOD("01-settings-frame-rate-quality-and.js"))[1]);
const EYE = 1.62, CITY_FAR_M = Number(/farM: ([0-9.]+), fogNear: ([0-9.]+)/.exec(MOD("30-the-living-city.js"))[1]);
const CITY_FOG_NEAR_M = Number(/farM: ([0-9.]+), fogNear: ([0-9.]+)/.exec(MOD("30-the-living-city.js"))[2]);
const SCREENS = [16 / 9, 4 / 3, 9 / 19.5];
function poses() {
  const out = [];
  for (const aspect of SCREENS) {
    // In the eyes: looking down at your feet to up at the roofs.
    for (let look = -1.2; look <= 0.61; look += 0.15) out.push({ aspect, first: true, look });
    // The follow view: every distance and pitch it allows.
    for (const dist of [8, 20, 45, CITY_MAX_ORBIT_M]) for (let pitch = ORBIT_MIN_PITCH; pitch <= ORBIT_MAX_PITCH + 1e-9; pitch += (ORBIT_MAX_PITCH - ORBIT_MIN_PITCH) / 8) out.push({ aspect, first: false, dist, pitch });
  }
  return out;
}
function cameraFor(pose) {
  const cam = new THREE.PerspectiveCamera(FOV, pose.aspect, 0.5, 20000);
  const target = new THREE.Vector3(0, 0, 0), yaw = 0.7;
  if (pose.first) {
    cam.position.set(0, EYE, 0);
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).negate();
    cam.lookAt(cam.position.clone().add(f.multiplyScalar(10 * Math.cos(pose.look))).add(new THREE.Vector3(0, Math.sin(pose.look) * 10, 0)));
  } else {
    cam.position.set(Math.sin(yaw) * Math.cos(pose.pitch) * pose.dist, Math.sin(pose.pitch) * pose.dist, Math.cos(yaw) * Math.cos(pose.pitch) * pose.dist);
    cam.lookAt(target);
  }
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  return cam;
}

test("the ring is worked out each frame from the camera, before the frame is drawn", () => {
  assert.match(M27, /NEAR_SURFACE\.follow\(camera,[^\n]*\n\s*renderer\.render\(scene, camera\)/);
  assert.ok(N.reach.flat_deg <= 3, "the horizon in view takes the ring to the far plane");
  assert.ok(N.reach.most_m >= CITY_FAR_M, "out to the City's far plane");
  assert.ok(N.reach.most_m >= CITY_FOG_NEAR_M * 2, "the fade is deep in the haze");
  assert.ok(N.reach.full_min_m >= 30);
});

test("from every City camera, all the ground in view has the near finish", () => {
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let checked = 0, widest = 0;
  for (const pose of poses()) {
    const cam = cameraFor(pose);
    const full = N.follow(cam, 0);
    widest = Math.max(widest, full);
    assert.equal(N.near.value.x, full);
    assert.ok(N.near.value.y > full, "faded out past the full ring, not cut");
    for (let i = 0; i <= 48; i += 1) for (let j = 0; j <= 32; j += 1) {
      ray.setFromCamera(new THREE.Vector2(i / 24 - 1, j / 16 - 1), cam);
      if (!ray.ray.intersectPlane(ground, hit)) continue;
      const d = hit.distanceTo(cam.position), dep = Math.asin(cam.position.y / d);
      if (d > CITY_FAR_M) continue;   // past the far plane: not drawn
      checked += 1;
      assert.ok(d <= full + 1e-6, `${JSON.stringify(pose)}: ground ${d.toFixed(1)} m off at ${(dep * 180 / Math.PI).toFixed(1)} deg, the finish only to ${full.toFixed(1)} m`);
    }
  }
  assert.ok(checked > 20000, `${checked} ground points checked`);
  assert.ok(widest <= N.reach.most_m);
});

test("with the horizon in view the ring is the far plane; looking down it is the ground in view", () => {
  const eyes = N.follow(cameraFor({ aspect: 16 / 9, first: true, look: 0 }), 0);
  assert.equal(eyes, N.reach.most_m);
  const down = N.follow(cameraFor({ aspect: 16 / 9, first: true, look: -1.2 }), 0);
  assert.ok(down < 60, `looking at your feet the ring is ${down.toFixed(0)} m`);
  const out = N.follow(cameraFor({ aspect: 16 / 9, first: false, dist: CITY_MAX_ORBIT_M, pitch: 1.1 }), 0);
  assert.ok(out > 80, `pulled right out, the ring reaches ${out.toFixed(0)} m`);
});

test("the scored finish thins to what a pixel can show as the ring reaches further, rather than flickering", () => {
  const glsl = N.scoredColor ? N.scoredColor("walk", 4) : null;
  // (scoredColor is defined after the object; read it from the source.)
  const src = M02.slice(M02.indexOf("NEAR_SURFACE.scoredColor ||="), M02.indexOf("NEAR_SURFACE.scoredNormal ||="));
  assert.equal(glsl, null);
  assert.match(src, /float kbSwPx = max\(length\(fwidth\(kbSwS\) \* kbSwMs\)/, "a pixel measured in metres on each axis");
  assert.match(src, /kbSwGroove = \(1\.0 - smoothstep\(0\.0025, 0\.0065 \+ kbSwPx/);
  assert.match(src, /kbSwBroom = .*\(1\.0 - smoothstep\(0\.002, 0\.01, kbSwPx\)\)/);
  assert.match(src, /vMapUv \* \$\{Number\(slabs\)/, "each walk at its own slab");
});

test("every kind of paved ground drawn near you is one of the near finishes", () => {
  // The walks, the narrow walks, the curbs and the carriageways (module 09 and 07).
  assert.match(M09, /const SIDEWALK = NEAR_SURFACE\.mark\(sidewalkTexture\(\), "sidewalk"\)/);
  assert.match(M09, /const NARROW_SIDEWALK = NEAR_SURFACE\.mark\(sidewalkTexture\("narrow"\), "narrow-walk"\)/);
  assert.match(M09, /const KERB_CONCRETE = NEAR_SURFACE\.mark\(sidewalkTexture\("curb"\), "curb"\)/);
  assert.match(M07, /const ROAD = NEAR_SURFACE\.mark\(roadTexture\(\), "asphalt"\)/);
  // A tile's own roads and pavements, where a street has no ribbon over the tile.
  assert.match(M04, /TILE_ROAD_MATERIAL\.userData\.nearSurface = "asphalt"/);
  assert.match(M04, /TILE_WALK_MATERIAL\.userData\.nearSurface = "concrete"/);
  // Each of those is a kind the shader knows, and the walks are scored at their own slab.
  for (const k of ["sidewalk", "narrow-walk", "curb", "asphalt", "concrete"]) assert.ok(N.kinds[k], k);
  assert.equal(N.kinds["narrow-walk"].scored, "walk");
  assert.ok(Math.abs(N.kinds["narrow-walk"].slabs - Number(/const NARROW_SLAB_M = ([0-9.]+)/.exec(M09)[1]) / Number(/const SLAB_M = ([0-9.]+)/.exec(M09)[1])) < 1e-9);
  assert.equal(N.kinds.sidewalk.slabs, Number(/const SLAB_BLOCK = ([0-9]+)/.exec(M09)[1]));
  // And the walker's eye height the test stands at is the page's own (within a few cm).
  assert.match(M22, /const AVATAR_EYE_Y = AVATAR_HEIGHT \* AVATAR_SCALE \* 0\.93/);
});
