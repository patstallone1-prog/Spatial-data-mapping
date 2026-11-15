// The paint plan (docs/street-paint.mjs): one paint per piece of road, and the city's stop
// records matched to the drawn approaches.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PaintPlan, bearingGap, matchApproach, rectInside, rectsOverlap, recordsInBoxes, settlementReport, streetKey }
  from "../docs/street-paint.mjs";

const rect = (x, z, along, across, ux = 1, uz = 0) => ({ x, z, ux, uz, along, across });

test("street names from both sources come out as one key", () => {
  assert.equal(streetKey("Chestnut Street"), "CHESTNUT");
  assert.equal(streetKey("CHESTNUT ST"), "CHESTNUT");
  assert.equal(streetKey("22ND ST"), streetKey("22nd Street"));
  assert.equal(streetKey("03RD ST"), "3RD");
  assert.equal(streetKey("O'Farrell Street"), "OFARRELL");
  assert.equal(streetKey("Van Ness Avenue"), "VAN NESS");
  // A street that is only its kind keeps it.
  assert.equal(streetKey("The Avenue"), "THE");
  assert.equal(streetKey("Park"), "PARK");
  assert.equal(streetKey(null), "");
});

test("bearings wrap", () => {
  assert.equal(bearingGap(350, 10), 20);
  assert.equal(bearingGap(90, 270), 180);
  assert.equal(bearingGap(0, 0), 0);
});

test("a stop record takes the approach on its own street, travelling the way it faces", () => {
  // Chestnut & Pierce in the Marina: the grid is nine degrees off the compass.
  const legs = [{ heading: 81, street: "CHESTNUT" }, { heading: 261, street: "CHESTNUT" },
    { heading: 351, street: "PIERCE" }, { heading: 171, street: "PIERCE" }];
  assert.equal(matchApproach({ facing: 90, street: "CHESTNUT" }, legs), 0);
  assert.equal(matchApproach({ facing: 270, street: "CHESTNUT" }, legs), 1);
  assert.equal(matchApproach({ facing: 0, street: "PIERCE" }, legs), 2);
  // A diagonal street: the name decides where the bearing alone could not.
  const diagonal = [{ heading: 45, street: "COLUMBUS" }, { heading: 90, street: "UNION" }];
  assert.equal(matchApproach({ facing: 90, street: "COLUMBUS" }, diagonal), 0);
  assert.equal(matchApproach({ facing: 90, street: "UNION" }, diagonal), 1);
});

test("a record that cannot be told apart is not guessed", () => {
  const legs = [{ heading: 45, street: "" }, { heading: 100, street: "" }];
  // Two unnamed approaches both within reach of the facing: neither.
  assert.equal(matchApproach({ facing: 75, street: "MISSING" }, legs), -1);
  // One alone answers.
  assert.equal(matchApproach({ facing: 0, street: "MISSING" }, [{ heading: 20, street: "" }, { heading: 200, street: "" }]), 0);
  // Its street is drawn, but only running the other way (a one-way): not the cross street.
  assert.equal(matchApproach({ facing: 90, street: "PINE" }, [{ heading: 270, street: "PINE" }, { heading: 80, street: "" }]), -1);
  assert.equal(matchApproach({ facing: undefined, street: "PINE" }, legs), -1);
  assert.equal(matchApproach({ facing: 90, street: "PINE" }, []), -1);
});

test("records are cut to the page's window", () => {
  const records = [{ p: [-122.44, 37.80] }, { p: [-122.40, 37.78] }, { nothing: true }];
  assert.equal(recordsInBoxes(records, [[-122.45, 37.79, -122.43, 37.81]]).length, 1);
  assert.equal(recordsInBoxes(records, null).length, 3);
  assert.deepEqual(recordsInBoxes(null, null), []);
});

test("rectangles overlap and contain as drawn", () => {
  assert.ok(rectsOverlap(rect(0, 0, 5, 1), rect(4, 0, 5, 1)));
  assert.ok(!rectsOverlap(rect(0, 0, 5, 1), rect(0, 3, 5, 1)));
  assert.ok(rectsOverlap(rect(0, 0, 5, 1), rect(0, 2.2, 5, 1), 0.5), "slack closes a small gap");
  // Turned: a bar across the lane and a word along it.
  assert.ok(rectsOverlap(rect(0, 0, 5, 0.2, 0, 1), rect(0, 3, 1.4, 1.2)));
  assert.ok(!rectsOverlap(rect(0, 0, 5, 0.2, 0, 1), rect(3, 0, 1.4, 1.2)));
  assert.ok(rectInside(rect(1, 0, 2.5, 1.2), rect(0, 0, 9, 1.5)));
  assert.ok(!rectInside(rect(8, 0, 2.5, 1.2), rect(0, 0, 9, 1.5)));
});

test("the same paint claimed twice is laid once, never slid behind itself", () => {
  // One approach noted from two nodes of a junction a metre apart: two bars, two STOPs.
  const plan = new PaintPlan();
  plan.claim({ kind: "bar", id: "bar:a", group: "a", rank: 2, ...rect(0, 0, 3, 1.2, 0, 1) });
  plan.claim({ kind: "word", text: "STOP", id: "stop:a", group: "a", rank: 2, ...rect(4, 0, 1.4, 1.2), slides: [-1.5, -3, -4.5] });
  plan.claim({ kind: "bar", id: "bar:b", group: "b", rank: 3, ...rect(0.8, 0.3, 3, 1.2, 0, 1) });
  plan.claim({ kind: "word", text: "STOP", id: "stop:b", group: "b", rank: 3, ...rect(4.9, 0.2, 1.4, 1.2), slides: [-1.5, -3, -4.5] });
  const { laid, refused } = plan.settle();
  // The city's (rank 3) holds the road.
  assert.deepEqual(laid.map((c) => c.id), ["bar:b", "stop:b"]);
  assert.deepEqual(refused.map((c) => [c.id, c.why, c.by]), [["bar:a", "duplicate", "bar:b"], ["stop:a", "duplicate", "stop:b"]]);
  assert.deepEqual(settlementReport({ laid, refused }), { laid: { bar: 1, word: 1 }, refused: { "bar:duplicate": 1, "word:duplicate": 1 } });
});

test("a word moves back along its lane to clear an arrow, and is refused when it cannot", () => {
  const plan = new PaintPlan();
  plan.claim({ kind: "arrow", id: "arrow", fixed: true, ...rect(10, 0, 1.3, 0.9) });
  plan.claim({ kind: "word", text: "STOP", id: "stop", rank: 2, ...rect(10.5, 0, 1.4, 1.2), slides: [1.5, 3.0, 4.5] });
  plan.claim({ kind: "word", text: "STOP", id: "stuck", rank: 2, ...rect(10, 5, 1.4, 1.2) });
  plan.claim({ kind: "arrow", id: "arrow2", fixed: true, ...rect(10, 5, 1.3, 0.9) });
  const { laid, refused } = plan.settle();
  const stop = laid.find((c) => c.id === "stop");
  assert.equal(stop.slid, 3.0);
  assert.equal(stop.x, 13.5);
  assert.deepEqual(refused.map((c) => [c.id, c.why, c.by]), [["stuck", "overlap", "arrow2"]]);
  // What is already on the road is never refused, whatever lands on it.
  assert.ok(laid.some((c) => c.id === "arrow") && laid.some((c) => c.id === "arrow2"));
});

test("a stop the city marks as a zone gets no second box; its words lie in the zone", () => {
  const plan = new PaintPlan();
  const zone = plan.claim({ kind: "zone", id: "zone:1", group: "zone:1", fixed: true, rank: 4, ...rect(0, 0, 12, 1.5) });
  // The agency's box for the same stop, a little along and out from the city's zone.
  plan.claim({ kind: "box", id: "stopbox:0", group: "stopbox:0", rank: 1, ...rect(3, 0.4, 10, 1.5) });
  plan.claim({ kind: "word", text: "BUS STOP", id: "boxword", group: "stopbox:0", within: "stopbox:0", rank: 1, ...rect(3, 0.4, 2.5, 1.2) });
  // The words the page puts in the zone instead.
  plan.claim({ kind: "word", text: "BUS STOP", id: "zoneword", group: zone.group, within: zone.id, rank: 2, ...rect(1, 0, 2.5, 1.2) });
  const { laid, refused } = plan.settle();
  assert.deepEqual(laid.map((c) => c.id), ["zone:1", "zoneword"]);
  assert.deepEqual(refused.map((c) => [c.id, c.why]).sort(), [["boxword", "orphan"], ["stopbox:0", "overlap"]]);
  // overlapping() is what the page asks to find the zone under a stop's box.
  assert.deepEqual(plan.overlapping(rect(3, 0.4, 10, 1.5), "zone").map((c) => c.id), ["zone:1"]);
});

test("two agencies' boxes at one kerb are one box", () => {
  const plan = new PaintPlan();
  for (const [i, x] of [[0, 0], [1, 2.5]]) {
    plan.claim({ kind: "box", id: `stopbox:${i}`, group: `stopbox:${i}`, rank: 1, ...rect(x, 0, 10, 1.5) });
    plan.claim({ kind: "word", text: "BUS STOP", id: `busword:${i}`, group: `stopbox:${i}`, within: `stopbox:${i}`, rank: 1, ...rect(x - 1, 0, 2.5, 1.2) });
  }
  const { laid } = plan.settle();
  assert.deepEqual(laid.map((c) => c.id), ["stopbox:0", "busword:0"]);
});

test("a stop bar may cross a bus zone; paint on the far kerb is left alone", () => {
  const plan = new PaintPlan();
  plan.claim({ kind: "zone", id: "zone", fixed: true, ...rect(0, 0, 12, 1.5) });
  plan.claim({ kind: "bar", id: "bar", rank: 2, ...rect(11, 2, 4, 0.3, 0, 1) });
  plan.claim({ kind: "word", text: "STOP", id: "far", rank: 2, ...rect(0, 9, 1.4, 1.2) });
  assert.deepEqual(plan.settle().refused, []);
});

test("a claim without a place is not taken", () => {
  const plan = new PaintPlan();
  assert.equal(plan.claim({ kind: "word", x: NaN, z: 0, ux: 1, uz: 0, along: 1, across: 1 }), null);
  assert.equal(plan.claim({ kind: "word", x: 0, z: 0, ux: 0, uz: 0, along: 1, across: 1 }), null);
  assert.equal(plan.claim({ kind: "word", x: 0, z: 0, ux: 1, uz: 0, along: 0, across: 1 }), null);
  assert.equal(plan.claims.length, 0);
});

test("the page's paint file is the cleaned schema", () => {
  const doc = JSON.parse(readFileSync(new URL("../docs/street-paint.json", import.meta.url), "utf8"));
  assert.equal(doc.schema, "kerbside.street_paint/1");
  assert.ok(doc.stop_approaches.length > 9000);
  assert.equal(doc.cleaned.kept, doc.stop_approaches.length);
  const keys = new Set();
  for (const r of doc.stop_approaches) {
    assert.ok(Number.isFinite(r.p[0]) && Number.isFinite(r.p[1]) && [0, 45, 90, 135, 180, 225, 270, 315].includes(r.facing));
    assert.equal(r.street, streetKey(r.street), "street keys are already clean");
    keys.add(`${r.p[0]}:${r.p[1]}:${r.street}:${r.facing}`);
  }
  assert.equal(keys.size, doc.stop_approaches.length, "no approach is listed twice");
});
