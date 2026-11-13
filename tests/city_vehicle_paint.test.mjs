// The colours the city's cars are painted (docs/city/vehicles.mjs PAINT_MIX): by each kind's
// shares of new-car colours, the same car the same colour every time, and the bus in Muni's
// silver and red.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { BIKE_PAINT_MIX, BUS_LIVERY, PAINTS, PAINT_MIX, fleetMaterial, paintNameOf, paintOf } from "../docs/city/vehicles.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

//: The share of each paint over many cars of a kind (their numbers spread as the city's are).
function shares(model, mix = null, n = 20000) {
  const out = {};
  for (let i = 0; i < n; i += 1) {
    const shade = (i * 0.6180339887 + 0.137) % 1;
    const name = paintNameOf(model, shade, mix);
    out[name] = (out[name] || 0) + 1 / n;
  }
  return out;
}

test("every kind's shares name real paints and add up to a hundred", () => {
  for (const [kind, list] of Object.entries(PAINT_MIX)) {
    const total = list.reduce((a, [, w]) => a + w, 0);
    assert.ok(Math.abs(total - 100) < 0.01, `${kind}: ${total}`);
    for (const [name] of list) assert.ok(PAINTS[name], `${kind}: ${name}`);
  }
  for (const [name] of BIKE_PAINT_MIX) assert.ok(PAINTS[name], name);
  for (const hex of Object.values(PAINTS)) assert.match(hex, /^#[0-9a-f]{6}$/);
});

test("a car is the same colour every time, from its own number", () => {
  for (const shade of [0, 0.01, 0.25, 0.5, 0.731, 0.999]) {
    assert.equal(paintOf("sedan", shade), paintOf("sedan", shade));
    assert.equal(paintOf("pickup", shade), PAINTS[paintNameOf("pickup", shade)]);
  }
  assert.equal(paintOf("sedan", undefined), paintOf("sedan", 0.5));
});

test("the traffic comes out in the shares new cars are bought in", () => {
  const sedan = shares("sedan");
  const want = Object.fromEntries(PAINT_MIX.sedan.map(([name, w]) => [name, w / 100]));
  for (const [name, w] of Object.entries(want)) assert.ok(Math.abs((sedan[name] || 0) - w) < 0.01, `${name}: ${sedan[name]} vs ${w}`);
  // Axalta 2025, North America: white first (pearl with it), then black, grey a distant second.
  assert.ok(sedan.white + sedan.pearl > 0.29 && sedan.white + sedan.pearl < 0.33);
  assert.ok(sedan.black > 0.17 && sedan.black < 0.21);
  // Each kind its own way: vans nearly all white, sports cars far redder than sedans.
  assert.ok(shares("delivery_van").white > 0.8);
  assert.ok(shares("sports").red > 2 * sedan.red);
  // A kind with no shares of its own takes North America's; bikes their own, brighter.
  assert.deepEqual(shares("hatchback-unknown"), sedan);
  assert.ok(shares("bike", BIKE_PAINT_MIX).black > 0.2);
});

test("the bus is painted in Muni's silver and red, by place on its body", () => {
  assert.match(BUS_LIVERY.glsl, /vec3 liveryAt\(vec3 p, vec3 paint\)/);
  assert.match(BUS_LIVERY.glsl, /silver/);
  assert.match(BUS_LIVERY.glsl, /red/);
  // edge0 below edge1: GLSL's smoothstep is undefined the other way round.
  for (const [, a, b] of BUS_LIVERY.glsl.matchAll(/smoothstep\((-?[\d.]+), (-?[\d.]+)/g)) assert.ok(+a < +b, `${a} ${b}`);
  const part = { name: "paint-atlas", glass: false, tint: true, map: null, geometry: new THREE.BufferGeometry() };
  const shader = { vertexShader: "#include <common>\n#include <color_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>" };
  const m = fleetMaterial(THREE, part, { livery: BUS_LIVERY });
  m.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes(BUS_LIVERY.glsl));
  assert.match(m.customProgramCacheKey(), new RegExp(BUS_LIVERY.key));
  assert.notEqual(m.customProgramCacheKey(), fleetMaterial(THREE, part).customProgramCacheKey());
  // The instance colour is not laid on the painted atlas a second time: vColor is reset with
  // only an instance colour set too (three r160 sets vColor from it then).
  assert.match(shader.vertexShader, /#if defined\(USE_COLOR\) \|\| defined\(USE_INSTANCING_COLOR\)\nvColor = vec3\(1\.0\);/);
});

test("the mask's floor in the textures is the one the shader takes off, and the bus's uvs are turned", () => {
  const build = read("scripts/build_city_fleet.mjs"), vehicles = read("docs/city/vehicles.mjs");
  const floor = +build.match(/const ALPHA_FLOOR = (\d+);/)[1];
  assert.ok(vehicles.includes(`(${floor} / 255).toFixed(5)`));
  assert.match(build, /bus: \{[^}]*flipV: \/\^PAINT_Bus\//);
});

test("the view paints by the shares, not a fixed list", () => {
  const view = read("docs/city/view.mjs");
  assert.ok(!/const PAINT = \[/.test(view));
  assert.match(view, /paintOf\(v\.model, v\.shade \?\? 0\.5\)/);
  assert.match(view, /BUS_LIVERY\.colour/);
  assert.match(view, /paintOf\("bike", b\.shade, BIKE_PAINT_MIX\)/);
});
