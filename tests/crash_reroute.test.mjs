// After a crash every driver looks for another way at once, and nobody drives back into the wreck
// (fleet.mjs Drivers.crashedOn).
import test from "node:test";
import assert from "node:assert/strict";
import { Drivers, TRAFFIC } from "../docs/city/fleet.mjs";

test("a crash marks its block to keep off, and every driver looks again now", () => {
  const route = { ids: [1, 2, 3], pts: [[0, 0], [10, 0], [20, 0]], s: [0, 10, 20], length: 20 };
  const other = { nextRoute: 999 };
  const me = { T: { ...TRAFFIC }, jams: new Map(), cars: new Map([["o", other]]), tally: {} };
  const st = { d: 12 };
  Drivers.prototype.crashedOn.call(me, { route }, st, 100);
  assert.equal(me.jams.get("2>3"), 100 + TRAFFIC.crash_known_s);
  assert.ok(TRAFFIC.crash_known_s >= TRAFFIC.jam_known_s, "a wreck is known longer than a queue");
  assert.equal(other.nextRoute, 0, "the others look again at once");
  assert.equal(st.avoidNext, true, "the one in it takes another way from its next junction");
});
