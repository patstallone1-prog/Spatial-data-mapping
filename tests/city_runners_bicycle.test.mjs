// Runners run, and a bicycle of your own: the wardrobe's runners (dressed to run) go out for a
// run when they stroll (fleet.mjs roaming), and a bike shop sells a bicycle that is wheeled, not
// carried (core.mjs carriedKg).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { carriedKg, loadRules, storesAt } from "../docs/city/core.mjs";
import { dressFor, isRunner } from "../docs/city/wardrobe.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));

test("every runner is dressed to run, and they are a few of the adults", () => {
  let runners = 0;
  for (let i = 0; i < 3000; i += 1) {
    const p = { id: `npc:run${i}:0`, age: 18 + (i % 50), pace: 1.2 + (i % 7) / 20 };
    if (!isRunner(p)) continue;
    runners += 1;
    assert.equal(dressFor(p, { female: i % 2 === 0 }, null).top, "running", p.id);
  }
  assert.ok(runners > 60 && runners < 400, `${runners} runners`);
  // Not at work in work clothes, nor the old.
  assert.equal(isRunner({ id: "npc:old:0", age: 75, pace: 1.6 }), false);
});

test("a bike shop sells a bicycle, and riding it home carries nothing", () => {
  assert.ok(storesAt(R, ["shop:bike"]).some((s) => s.items.includes("bicycle")));
  assert.equal(carriedKg(R, { bicycle: 1 }), 0);
  assert.equal(carriedKg(R, { bicycle: 1, bike_lock: 1 }), R.items.bike_lock.kg);
});
