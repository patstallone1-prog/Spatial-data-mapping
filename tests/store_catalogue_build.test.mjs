// The store catalogue (docs/city/catalogue.json) is what scripts/build_store_catalogue.mjs makes of
// the rules and the objects now: a change to either that leaves the committed catalogue behind
// fails here (its --check, which writes nothing).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url);
const SCRIPT = "scripts/build_store_catalogue.mjs";

test("the committed catalogue is the one the rules and objects make", () => {
  const out = execFileSync(process.execPath, [SCRIPT, "--check"], { cwd: ROOT, encoding: "utf8" });
  const got = JSON.parse(out.trim().split("\n").pop());
  assert.equal(got.current, true);
  assert.ok(got.items > 300 && got.store_items_with_aisle > 100, out);
});

test("every aisle says how it is displayed, and its items are catalogued in it", () => {
  const cat = JSON.parse(readFileSync(new URL("docs/city/catalogue.json", ROOT), "utf8"));
  const byId = new Map(cat.items.map((it) => [it.id, it]));
  const aisles = Object.keys(cat.aisles);
  assert.ok(aisles.length >= 8, `${aisles.length} aisles`);
  for (const [a, v] of Object.entries(cat.aisles)) {
    assert.ok(v.display, `${a}: how it is displayed`);
    for (const id of v.items) {
      assert.ok(byId.has(id), `${a}: ${id} is a catalogued item`);
      assert.equal(byId.get(id).aisle, a, `${id} is in the ${a} aisle`);
    }
  }
});
