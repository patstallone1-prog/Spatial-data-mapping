// The clouds (docs/sky-clouds.mjs): a few patterns through the game's day, drawn where the City
// can see them -- at the far plane, not 40 km out past the City's 1.6 km (2026-11-21).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CLOUD_PATTERNS, CLOUD_BLOCK_H, cloudPatternAt, cloudMix, cloudPixels, CLOUD_VERTEX } from "../docs/sky-clouds.mjs";

const H = 3600000;

test("a few patterns, one after another through the day, never the same twice running", () => {
  assert.ok(CLOUD_PATTERNS.length >= 3);
  const seen = new Set();
  let prev = null;
  for (let b = 0; b < 40; b += 1) {
    const at = cloudPatternAt((b * CLOUD_BLOCK_H + 1) * H);
    assert.equal(at.blend, 0, "steady through most of a block");
    if (prev !== null) assert.notEqual(at.index, prev, `block ${b}`);
    prev = at.index; seen.add(at.index);
  }
  assert.equal(seen.size, CLOUD_PATTERNS.length, "every pattern comes round");
  // The change to the next is eased in over the end of the block.
  const late = cloudPatternAt((CLOUD_BLOCK_H - 0.5) * H);
  assert.ok(late.blend > 0 && late.blend < 1);
  assert.equal(late.next, cloudPatternAt((CLOUD_BLOCK_H + 1) * H).index);
});

test("a sunny day has a few clouds; overcast fills the sky", () => {
  for (let i = 0; i < CLOUD_PATTERNS.length; i += 1) {
    const sunny = cloudMix({ index: i, next: i, blend: 0 }, 0.05);
    assert.ok(Math.max(...sunny.cover) >= 0.3 && Math.max(...sunny.cover) < 0.6, `${CLOUD_PATTERNS[i].name}: ${sunny.cover}`);
    const over = cloudMix({ index: i, next: i, blend: 0 }, 0.9);
    assert.ok(over.cover[0] > 0.85 && over.cover[3] > 0.85, "heaps and the sheet fill in");
  }
});

test("the texture holds four kinds of cloud, each with clear sky in it", () => {
  const px = cloudPixels(64);
  for (let ch = 0; ch < 4; ch += 1) {
    let lo = 0, hi = 0;
    for (let i = ch; i < px.length; i += 4) { if (px[i] < 20) lo += 1; if (px[i] > 200) hi += 1; }
    assert.ok(lo > 64 * 64 * 0.05 && hi > 64 * 64 * 0.02, `channel ${ch}: ${lo} clear, ${hi} dense`);
  }
});

test("drawn at the far plane and wired into the sky", () => {
  assert.match(CLOUD_VERTEX, /gl_Position=p\.xyww/);
  const env = readFileSync(new URL("../docs/environment-runtime.mjs", import.meta.url), "utf8");
  assert.match(env, /import \{createClouds\} from '\.\/sky-clouds\.mjs'/);
  assert.match(env, /deck\.update\(now,\{weather\}\)/, "drifting every frame");
  assert.match(env, /deck\.update\(now,\{look:true,date,weather,sunDir,altitude:s\.altitude,day\}\)/, "the pattern and light on the game's clock");
  assert.doesNotMatch(env, /SphereGeometry\(40000/);
  const pages = readFileSync(new URL("../src/smc/renderer/pages.py", import.meta.url), "utf8");
  assert.equal((pages.match(/"sky-clouds\.mjs"/g) || []).length, 2, "in the release's assets");
});
