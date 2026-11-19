// The stand-in the sun is traced through (docs/proxy-light.mjs): the arithmetic the GPU pass
// does, checked here on a small height map.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PROXY, extentFor, marchSteps, shadowTop, snapCentre, sunInMap } from "../docs/proxy-light.mjs";

test("the stand-in sits on its own texels, so it does not swim as you walk", () => {
  const a = snapCentre(-1493.2, -344.6, 720, 1024), b = snapCentre(-1493.3, -344.7, 720, 1024);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.x + 1493.2) <= a.texel && Math.abs(a.texel - 720 / 1024) < 1e-12);
});

test("it covers what the camera sees, and does not flick between sizes", () => {
  assert.equal(extentFor(45), 720);
  assert.equal(extentFor(200), 1440);
  assert.equal(extentFor(5000), 2880);
  // Pulled back in a little from a wider view: the wider one is kept.
  assert.equal(extentFor(140, 1440), 1440);
  assert.equal(extentFor(60, 1440), 720);
});

test("the march reads every texel near by and reaches a tall building's whole shadow", () => {
  const s = marchSteps();
  assert.equal(s.length, PROXY.march_steps);
  for (let i = 1; i <= PROXY.march_even; i += 1) assert.equal(s[i] - s[i - 1], 1);
  assert.ok(s.at(-1) * (720 / 1024) > 150, "over 150 m at the finest size");
});

test("the sun in the map's terms: east is +u, north (-z) is +v, and it climbs with its height", () => {
  const s = sunInMap({ x: 0.5, y: Math.SQRT1_2, z: -0.5 });
  assert.ok(Math.abs(s.u - Math.SQRT1_2) < 1e-9 && Math.abs(s.v - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(s.tan - 1) < 1e-9);
  assert.ok(sunInMap({ x: 1, y: 0, z: 0 }).tan > 0, "never flat: a sun on the horizon still climbs a little");
});

test("a 20 m block throws a shadow as long as the sun is low, and none on its sunny side", () => {
  const size = 128, metres = 1, heights = new Float32Array(size * size);
  for (let v = 50; v < 70; v += 1) for (let u = 60; u < 70; u += 1) heights[v * size + u] = 20;
  // The sun in the east (+u), 45 degrees up: the shadow lies to the west, 20 m long.
  const sun = sunInMap({ x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 });
  const shaded = (u, v, y = 0) => y < shadowTop(heights, size, u, v, sun, metres) - 0.3;
  assert.ok(shaded(55, 60), "5 m west of it");
  assert.ok(shaded(45, 60), "15 m west of it");
  assert.equal(shaded(36, 60), false, "24 m west: past the shadow's end");
  assert.equal(shaded(75, 60), false, "east of it: in the sun");
  assert.equal(shaded(55, 80), false, "beside it");
  // A wall in the shadow is lit above the shadow's top: 5 m out, the top is 15 m up.
  assert.equal(shaded(55, 60, 16), false);
  assert.ok(shaded(55, 60, 13));
  // Its own roof is in the sun.
  assert.equal(shaded(65, 60, 20), false);
  // Lower: 20 degrees up, the shadow runs 55 m.
  const low = sunInMap({ x: Math.cos(20 * Math.PI / 180), y: Math.sin(20 * Math.PI / 180), z: 0 });
  assert.ok(0 < shadowTop(heights, size, 12, 60, low, metres), "48 m west under a low sun");
});

test("every lit material is given the lookup, and what moves is left out of the stand-in", () => {
  const m02 = readFileSync(new URL("../src/smc/renderer/page/module/02-reconstructed-world-objects.js", import.meta.url), "utf8");
  assert.match(m02, /THREE\.Material\.prototype\.onBeforeCompile = hook/);
  assert.match(m02, /directLight\.color \*= kbLit/);
  assert.match(m02, /if\(!META\)import\(sharedAsset\("proxy-light\.mjs"\)\)/, "not in the headset");
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.match(view, /__kerbsideProxyLight\?\.dynamic\.add\(group\)/);
  // The materials that set their own shader hook outright call the lookup themselves.
  for (const file of ["docs/grass-strands.mjs", "docs/avatar-builder.mjs", "docs/storefront-renderer.mjs", "docs/nature-runtime.mjs", "docs/city/vehicles.mjs", "docs/city/view.mjs"])
    assert.match(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), /__kerbsideProxyLight\?\.patch\?\.\(/, file);
});
