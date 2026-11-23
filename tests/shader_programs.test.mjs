// A house must not be drawn as windows and a doorway in the air: the page's shader patches, laid
// on three.js's real programs, must still be shaders a driver compiles (docs/shader-check.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { flatten, redeclared, failedPrograms } from "../docs/shader-check.mjs";

const WORLD = readFileSync(new URL("../src/smc/renderer/page/module/02-reconstructed-world-objects.js", import.meta.url), "utf8");
// The page's own hooks, as written: the stand-in light, the near photographs, the plain light.
const from = WORLD.indexOf("const PROXY_LIGHT = "), to = WORLD.indexOf("if (!ATTACH && !THREE.Material.prototype.onBeforeCompile.kbProxyLight)");
assert.ok(from > 0 && to > from, "the page's shader hooks are where this test reads them");
const scope = {};
const HOOKS = Function("THREE", "globalThis", `${WORLD.slice(from, to)}\nreturn { PROXY_LIGHT, NEAR_SURFACE, PLAIN_LIGHT };`)(THREE, scope);
// (The photographs themselves are not loaded here: only the program text is under test.)
HOOKS.NEAR_SURFACE.uniformsFor = () => new Proxy({}, { get: () => ({ value: null }) });

// What the renderer defines for a wall in daylight, and for the same wall with more switched on.
const BASE = { STANDARD: "", NUM_DIR_LIGHTS: 1, NUM_HEMI_LIGHTS: 1, NUM_POINT_LIGHTS: 0, NUM_SPOT_LIGHTS: 0, NUM_RECT_AREA_LIGHTS: 0, NUM_DIR_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_MAPS: 0, NUM_SPOT_LIGHT_COORDS: 0, NUM_POINT_LIGHT_SHADOWS: 0, NUM_LIGHT_PROBES: 0, NUM_CLIPPING_PLANES: 0, UNION_CLIPPING_PLANES: 0, USE_LOGDEPTHBUF: "", USE_LOGDEPTHBUF_EXT: "" };
const SETS = {
  plain: {},
  textured: { USE_MAP: "", USE_UV: "", MAP_UV: "vMapUv" },
  "textured, bumped, flat": { USE_MAP: "", USE_UV: "", MAP_UV: "vMapUv", USE_NORMALMAP: "", USE_NORMALMAP_TANGENTSPACE: "", NORMALMAP_UV: "vNormalMapUv", FLAT_SHADED: "", DOUBLE_SIDED: "" },
  "lamps and fog": { NUM_POINT_LIGHTS: 4, NUM_SPOT_LIGHTS: 1, USE_FOG: "", FOG_EXP2: "", USE_COLOR: "", USE_EMISSIVEMAP: "", EMISSIVEMAP_UV: "vEmissiveMapUv", USE_UV: "" },
  "shadows and clips": { USE_SHADOWMAP: "", NUM_DIR_LIGHT_SHADOWS: 1, SHADOWMAP_TYPE_PCF: "", NUM_CLIPPING_PLANES: 2, USE_ALPHAHASH: "", USE_AOMAP: "", AOMAP_UV: "vAoMapUv", USE_UV: "" },
};
const standard = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });
const wall = () => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
// As the page's hook on every material runs them.
function patched(material, kind = null) {
  const shader = standard();
  HOOKS.PLAIN_LIGHT.patch(shader, material);
  HOOKS.PROXY_LIGHT.patch(shader);
  if (kind) HOOKS.NEAR_SURFACE.patch(shader, kind);
  return shader;
}

test("three.js's own standard program has nothing declared twice (the check reads it right)", () => {
  for (const [name, set] of Object.entries(SETS)) {
    const shader = standard();
    for (const stage of ["vertexShader", "fragmentShader"]) assert.deepEqual(redeclared(flatten(shader[stage], THREE.ShaderChunk, { ...BASE, ...set })), [], `${stage}, ${name}`);
  }
});

test("a wall's patched program compiles: nothing is declared twice", () => {
  const kinds = [null, ...Object.keys(HOOKS.NEAR_SURFACE.kinds)];
  let plain = 0;
  for (const kind of kinds) for (const [name, set] of Object.entries(SETS)) {
    const shader = patched(wall(), kind);
    if (shader.fragmentShader.includes("lights_lambert_fragment")) plain += 1;
    for (const stage of ["vertexShader", "fragmentShader"]) {
      const flat = flatten(shader[stage], THREE.ShaderChunk, { ...BASE, ...set });
      assert.deepEqual(redeclared(flat), [], `${stage}, ${kind || "no photograph"}, ${name}`);
    }
    // What the matt light calls is there for it, once.
    const flat = flatten(shader.fragmentShader, THREE.ShaderChunk, { ...BASE, ...set });
    assert.equal((flat.match(/\bvarying\s+vec3\s+vViewPosition\s*;/g) || []).length, 1, `one view position: ${kind}, ${name}`);
    assert.equal((flat.match(/\bvoid\s+RE_Direct_Lambert\s*\(/g) || []).length, 1, `the matt light's terms: ${kind}, ${name}`);
    assert.ok(!/RE_Direct_Physical|PhysicalMaterial\s+material/.test(flat), `no half of the highlight left: ${kind}, ${name}`);
  }
  assert.equal(plain, kinds.length * Object.keys(SETS).length, "the plain light is what walls use: this test is of the program that is drawn");
});

test("glass and metal keep their own program, and it compiles too", () => {
  for (const material of [new THREE.MeshStandardMaterial({ roughness: 0.1 }), new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.6 })]) {
    const shader = patched(material);
    assert.ok(shader.fragmentShader.includes("#include <lights_physical_fragment>"));
    assert.deepEqual(redeclared(flatten(shader.fragmentShader, THREE.ShaderChunk, { ...BASE, ...SETS.textured })), []);
  }
});

test("the mistake that left houses as floating windows is one this test catches", () => {
  // The patch as it shipped in November 2026: Lambert's terms put in whole.
  const shader = standard();
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <lights_physical_pars_fragment>", "#include <lights_lambert_pars_fragment>")
    .replace("#include <lights_physical_fragment>", "float specularStrength = 1.0;\n#include <lights_lambert_fragment>");
  assert.deepEqual(redeclared(flatten(shader.fragmentShader, THREE.ShaderChunk, BASE)), ["variable vViewPosition"]);
  assert.deepEqual(redeclared("uniform float a;\nfloat f(vec3 p){ float a; return a; }\nfloat f(vec2 p){ return 0.0; }\nstruct S { float a; };"), [], "locals, overloads and members are not globals");
  assert.deepEqual(redeclared("float f(in vec3 p){return 0.;}\nfloat f(vec3 q){return 1.;}\nstruct S{float a;};\nstruct S{float b;};\nuniform vec2 u, v;\nuniform vec2 v;"), ["function f(vec3)", "struct S", "variable v"]);
});

test("the preprocessor is followed the way a driver follows it", () => {
  const src = "#define A 2\n#if defined( B ) && A > 1\nint yes;\n#elif A == 2\nint second;\n#else\nint no;\n#endif\n#ifndef C\nint c;\n#endif\n#include <x>";
  assert.equal(flatten(src, { x: "int inc;" }, {}).trim(), "int second;\nint c;\nint inc;");
  assert.equal(flatten(src, { x: "" }, { B: "", C: "" }).trim(), "int yes;");
  assert.throws(() => flatten("#include <missing>", {}, {}), /no shader chunk/);
});

test("on a live page a refused shader is reported once, with what it is", () => {
  const FRAGMENT = 35632, bad = { type: FRAGMENT, ok: false }, good = { type: 35633, ok: true };
  const gl = { FRAGMENT_SHADER: FRAGMENT, COMPILE_STATUS: 1, SHADER_TYPE: 2, getAttachedShaders: (p) => p.shaders,
    getShaderParameter: (s, what) => (what === 1 ? s.ok : s.type), getShaderInfoLog: () => "'vViewPosition' : redefinition" };
  const programs = [{ program: { shaders: [good, bad] }, usedTimes: 3, cacheKey: "MeshStandardMaterial|plain-light" }, { program: { shaders: [good] }, usedTimes: 1, cacheKey: "ok" }, { program: { shaders: [bad] }, usedTimes: 0, cacheKey: "not drawn yet" }];
  const renderer = { getContext: () => gl, info: { programs } }, seen = new WeakSet();
  assert.deepEqual(failedPrograms(renderer, seen), [{ key: "MeshStandardMaterial|plain-light", stage: "fragment", log: "'vViewPosition' : redefinition" }]);
  assert.deepEqual(failedPrograms(renderer, seen), [], "what was looked at is not looked at again");
  const later = new WeakSet(), met = new WeakSet();
  assert.deepEqual(failedPrograms(renderer, later, met), [], "a program just made is left a turn");
  assert.equal(failedPrograms(renderer, later, met).length, 1);
});

test("the page looks for refused shaders itself and falls back to the full light", () => {
  assert.match(WORLD, /import\(sharedAsset\("shader-check\.mjs"\)\)/);
  assert.match(WORLD, /PLAIN_LIGHT\.enabled = false;/);
  assert.match(WORLD, /window\.kerbsideShaderCheck = /);
});
