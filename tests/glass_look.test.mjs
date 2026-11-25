// Glass that reads as glass at the cost of one pane (module 02 realGlass): clear straight on, a
// mirror at a slant (Fresnel), a sharp glint, the sky and street from a cube map made once and
// dimmed at night, slow ripples in the pane and grime at its edges -- and a program a driver
// compiles, laid over the page's other hooks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { flatten, redeclared } from "../docs/shader-check.mjs";

const WORLD = readFileSync(new URL("../src/smc/renderer/page/module/02-reconstructed-world-objects.js", import.meta.url), "utf8");
const from = WORLD.indexOf("const GLASS = Object.freeze("), to = WORLD.indexOf("globalThis.__kerbsideRealGlass = realGlass;");
assert.ok(from > 0 && to > from, "the glass is where this test reads it");
// The page's hooks the glass rides on, stood in for: a patch is kept to be run on a program.
const ctx2d = { fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }), set fillStyle(v) {} };
const document = { createElement: () => ({ getContext: () => ctx2d }) };
const NIGHT = { night: { value: 0 } };
const patchMaterial = (m, key, patch) => { (m.patches ||= []).push([key, patch]); return m; };
const nw = WORLD.slice(WORLD.indexOf("function nightWindows(material)"), WORLD.indexOf("//: An advertising face lit from behind"));
const G = Function("THREE", "document", "NIGHT", "patchMaterial", "random",
  `${nw}\n${WORLD.slice(from, to)}\nreturn { GLASS, glassOpacity, glassGrime, glassCube, realGlass, nightWindows };`)(THREE, document, NIGHT, patchMaterial, (s) => (Math.sin(s) + 1) / 2);

const BASE = { STANDARD: "", NUM_DIR_LIGHTS: 1, NUM_HEMI_LIGHTS: 1, NUM_POINT_LIGHTS: 0, NUM_SPOT_LIGHTS: 0, NUM_RECT_AREA_LIGHTS: 0, NUM_DIR_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_SHADOWS: 0, NUM_SPOT_LIGHT_MAPS: 0, NUM_SPOT_LIGHT_COORDS: 0, NUM_POINT_LIGHT_SHADOWS: 0, NUM_LIGHT_PROBES: 0, NUM_CLIPPING_PLANES: 0, UNION_CLIPPING_PLANES: 0, USE_LOGDEPTHBUF: "", USE_LOGDEPTHBUF_EXT: "" };
const SETS = {
  plain: {},
  textured: { USE_MAP: "", USE_UV: "", MAP_UV: "vMapUv" },
  "instanced, double sided": { USE_INSTANCING: "", DOUBLE_SIDED: "" },
  "lamps and fog": { NUM_POINT_LIGHTS: 4, USE_FOG: "", FOG_EXP2: "", USE_COLOR: "" },
};
const program = (material) => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  for (const [, patch] of material.patches) patch(shader);
  return shader;
};

test("a grey pane seen through straight on, a mirror at a slant: 0.2 to 0.68 by a Fresnel power of 4.5", () => {
  // (2026-11-25: there as a pane, between the near-invisible 0.05 and the old 0.42.)
  const { GLASS, glassOpacity } = G;
  assert.equal(GLASS.face_opacity, 0.2);
  assert.equal(GLASS.edge_opacity, 0.68);
  assert.ok(GLASS.fresnel_power >= 4 && GLASS.fresnel_power <= 5);
  assert.ok(GLASS.roughness >= 0.02 && GLASS.roughness <= 0.08);
  assert.ok(Math.abs(glassOpacity(1) - 0.2) < 1e-9);
  assert.ok(Math.abs(glassOpacity(0) - 0.68) < 1e-9);
  let last = 0;
  for (let c = 1; c >= 0; c -= 0.05) { const a = glassOpacity(c); assert.ok(a >= last - 1e-12); last = a; }
  // Seen from across a street (60 degrees off the pane's normal) it is still mostly see-through.
  assert.ok(glassOpacity(Math.cos(Math.PI / 3)) < 0.25);
  assert.ok(glassOpacity(Math.cos(80 * Math.PI / 180)) > 0.35);
  // A little sheen face on: more than bare glass's 0.04 mirrored, short of a mirror.
  assert.ok(GLASS.face_reflection > 0.12 && GLASS.face_reflection < 0.25);
});

test("grime at a pane's edges only", () => {
  const { GLASS, glassGrime } = G;
  assert.equal(glassGrime(0), GLASS.grime);
  assert.equal(glassGrime(GLASS.grime_edge), 0);
  assert.equal(glassGrime(0.5), 0);
  assert.ok(glassGrime(GLASS.grime_edge / 2) > 0 && glassGrime(GLASS.grime_edge / 2) < GLASS.grime);
});

test("the glass's program compiles over every set of switches, with nothing declared twice", () => {
  // A house's pane is a window that lights at night too (nightWindows, then realGlass): the two
  // share the night's uniform, declared once (2026-11-25: declared twice, those panes were not drawn).
  for (const [paneUv, lit] of [[false, false], [true, false], [true, true]]) {
    const base = new THREE.MeshStandardMaterial({ color: 0x5c6468, map: null });
    if (lit) G.nightWindows(base);
    const m = G.realGlass(base, { paneUv });
    assert.ok(m.transparent && m.depthWrite === false && m.opacity === 0.2 && m.envMapIntensity === 0, "seen through, its reflection its own");
    // Grey: the pane's own colour taken most of the way to float glass's grey, once only.
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.color.getHexString().slice(i, i + 2), 16) / 255);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 0.08 && (r + g + b) / 3 > 0.35 && (r + g + b) / 3 < 0.65, `grey (${m.color.getHexString()})`);
    const shader = program(m);
    const grey = m.color.getHex();
    G.realGlass(m, { paneUv });
    assert.equal(m.color.getHex(), grey, "made glass twice, it is no greyer");
    assert.ok(shader.uniforms.kbGlassCube.value.isCubeTexture, "the sky and street from one cube map");
    assert.equal(shader.uniforms.kbNight, NIGHT.night, "dimmed by the page's night");
    assert.ok(!m.isMeshPhysicalMaterial && !(m.transmission > 0), "no refraction: three's transmission draws the scene again");
    assert.equal(shader.fragmentShader.includes("kbGUv.x"), paneUv, "grime only where the pane's uv runs 0 to 1");
    for (const [name, set] of Object.entries(SETS)) for (const stage of ["vertexShader", "fragmentShader"]) {
      const flat = flatten(shader[stage], THREE.ShaderChunk, { ...BASE, ...set });
      assert.deepEqual(redeclared(flat), [], `${stage}, ${name}, pane uv ${paneUv}, lit ${lit}`);
    }
    assert.ok(!/NaN|undefined/.test(shader.fragmentShader), "every figure the shader uses is in GLASS");
    // The glass's colour is made after the lights are summed and before the pixel is written.
    const frag = shader.fragmentShader;
    assert.ok(frag.indexOf("kbGlassCube, vec3(-kbRw.x") < frag.indexOf("#include <opaque_fragment>"));
    assert.ok(frag.indexOf("#include <lights_fragment_end>") < frag.indexOf("kbGlassCube, vec3(-kbRw.x"));
  }
});

test("every glass in the page and the city is made real glass, and casts no shadow", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const shell = read("../src/smc/renderer/page/module/25-one-physical-visual-shell-shared.js");
  assert.match(shell, /realGlass\(homeGlassMaterial, \{ paneUv: true \}\)/);
  assert.match(shell, /realGlass\(shellGlass, \{ paneUv: true \}\)/, "a shell's clone is made glass again");
  assert.match(shell, /mesh\.castShadow = !material\.transparent;/, "the shell's glass casts no shadow");
  assert.match(read("../src/smc/renderer/page/module/19-the-dropped-kerb-at-every.js"), /realGlass\(stopMaterials\.glass, \{ paneUv: true \}\)/);
  assert.match(read("../src/smc/renderer/page/module/24-nearby-what-is-round-the.js"), /realGlass\(entryGlassMaterial/);
  assert.match(read("../src/smc/renderer/page/module/15-interchanges-every-deck-s-height.js"), /realGlass\(glass\)/);
  for (const f of ["../docs/city/storefronts.mjs", "../docs/city/vehicles.mjs", "../docs/city/view.mjs", "../docs/storefront-renderer.mjs"])
    assert.match(read(f), /globalThis\.__kerbsideRealGlass\?\.\(/, f);
});
