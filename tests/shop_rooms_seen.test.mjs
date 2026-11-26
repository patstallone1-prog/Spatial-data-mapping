// Real rooms behind shop windows (docs/72-city-fixes-1126.md): the room you walk into is built at
// the shop's front while you pass, its people stand where its room has them, and a restaurant's
// plan starts at its own front.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadRules } from "../docs/city/core.mjs";
import { restaurantService, planRestaurant } from "../docs/city/restaurant-room.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");

test("a restaurant whose outline misses its door is planned from its front, not the back of the building", () => {
  const service = restaurantService(R, "american");
  // The building outline (restaurant x, z: z inward) only from 15 m in: the old plan took that piece.
  const outline = [[-6, 15], [6, 15], [6, 25], [-6, 25]];
  const plan = planRestaurant({ width: 12, depth: 20, outline, doorX: 0 }, service);
  assert.ok(Math.min(...plan.ring.map((p) => p[1])) < 0.5, JSON.stringify(plan.ring));
  // An outline that does reach the front is still followed.
  const front = planRestaurant({ width: 12, depth: 20, outline: [[-4, 0], [4, 0], [4, 12], [-4, 12]], doorX: 0 }, service);
  assert.ok(Math.max(...front.ring.map((p) => Math.abs(p[0]))) <= 4.001);
});

test("the shops round you have their real rooms, the same buildRoom you walk into", () => {
  assert.match(view, /const SHOP_PREVIEW = \{ near_m: \d+, keep_m: \d+, most: \d+, every_ms: \d+ \}/);
  assert.match(view, /room = buildRoom\(best, F\); room\.name = "city-shop-seen"/);
  assert.match(view, /ctx\.showFittedShop\?\.\(best\.id\)/);
  // Built in the frame; dropped when you go in (no room twice) or drive off.
  assert.match(view, /peopleLock\.frame\(focus, now\); carsLock\.frame\(focus, now\);\n\s+previewShops\(now\);/);
  assert.match(view, /dropShopPreview\(String\(place\.id\)\);/);
  // Its people stand where its room has them.
  assert.match(view, /if \(seen\?\.F\) placeInShop\(pos, e\.p, id, seen\.F\);/);
  // No drawn-in room behind the glass any more: the page's glass is plain glass.
  const page = readFileSync(new URL("../src/smc/renderer/page/module/02-reconstructed-world-objects.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /GLASS_ROOM|kbRoomAt/);
});
