// The living city's level of detail (docs/city/detail.mjs): full near you, moderate, low, then
// only tracked out to the area's edge; stretched ahead the way you are going and along a route
// being ridden; steady at a ring's edge; and the view drawing by it (docs/city/view.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DETAIL_RINGS, FULL, LOW, MODERATE, TRACKED, byTier, detailField, routeSamples, stretchFor, velocityTracker } from "../docs/city/detail.mjs";

const VIEW = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");

test("standing still, the rings are circles: full, moderate, low, then tracked only", () => {
  const f = detailField({ x: 0, z: 0 });
  const [full, mid, low] = DETAIL_RINGS.people;
  assert.equal(f.tier("people", full - 1, 0), FULL);
  assert.equal(f.tier("people", 0, full + 1), MODERATE);
  assert.equal(f.tier("people", -(mid + 1), 0), LOW);
  assert.equal(f.tier("people", 0, -(low + 1)), TRACKED);
  // The same distance either way round.
  assert.equal(f.tier("people", 0, full - 1), f.tier("people", -(full - 1), 0));
  // Cars carry further than people.
  assert.equal(f.tier("cars", 0, full + 10), FULL);
});

test("moving, full detail reaches out ahead -- further the faster -- and drops back behind", () => {
  const ahead = DETAIL_RINGS.people[0] * 1.3;
  const walking = detailField({ x: 0, z: 0 }, { vx: 1.4, vz: 0 });
  assert.equal(walking.tier("people", ahead, 0), FULL, "ahead at a walk");
  assert.equal(walking.tier("people", -ahead, 0), MODERATE, "the same distance behind");
  assert.equal(walking.tier("people", 0, ahead), MODERATE, "or to the side");
  const driving = detailField({ x: 0, z: 0 }, { vx: 0, vz: -13 });
  assert.ok(driving.stretch > walking.stretch && driving.stretch <= 4);
  assert.equal(driving.tier("cars", 0, -DETAIL_RINGS.cars[0] * 3), FULL, "a block ahead in a car");
  assert.equal(driving.tier("cars", 0, DETAIL_RINGS.cars[0] * 1.05), MODERATE, "behind the car");
  assert.equal(stretchFor(0), 1);
});

test("riding, the route ahead round the corner is drawn in full before it comes into view", () => {
  // A bus going north (-z) that turns east at 200 m; a corner 260 m along its way.
  const route = routeSamples([[0, -200], [300, -200]], { x: 0, z: 0 });
  assert.ok(route.length > 20 && route[0].s === 0 && route.at(-1).s <= 420);
  const corner = { x: 60, z: -203 };
  const plain = detailField({ x: 0, z: 0 }, { vx: 0, vz: -9 });
  const riding = detailField({ x: 0, z: 0 }, { vx: 0, vz: -9, ahead: route });
  assert.ok(riding.tier("people", corner.x, corner.z) < plain.tier("people", corner.x, corner.z));
  assert.equal(riding.tier("people", corner.x, corner.z), FULL);
  // Not the other way up the cross street.
  assert.ok(riding.tier("people", -60, -203) > FULL);
});

test("at a ring's edge a thing keeps its tier rather than flick between two", () => {
  const f = detailField({ x: 0, z: 0 });
  const r = DETAIL_RINGS.people[0];
  assert.equal(f.tier("people", r * 1.04, 0, FULL), FULL, "just past the ring, still full");
  assert.equal(f.tier("people", r * 0.96, 0, MODERATE), MODERATE, "just inside it, not yet full");
  assert.equal(f.tier("people", r * 0.9, 0, MODERATE), FULL);
  assert.equal(f.tier("people", r * 1.1, 0, FULL), MODERATE);
});

test("over a tier's cap the rest are drawn one tier down, nearest first, and tracked ones not at all", () => {
  const items = [5, 1, 3, 2, 4].map((d) => ({ d, detail: FULL }));
  items.push({ d: 0.5, detail: TRACKED }, { d: 9, detail: LOW });
  const [full, mid, low] = byTier(items, [2, 2, 9]);
  assert.deepEqual(full.map((q) => q.d), [1, 2]);
  assert.deepEqual(mid.map((q) => q.d), [3, 4]);
  assert.deepEqual(low.map((q) => q.d), [5, 9]);
});

test("the focus's speed is read from where it goes, and a teleport is not one", () => {
  const v = velocityTracker(0.5);
  for (let i = 0; i < 60; i += 1) v.update(i * 1.4 / 30, 0, 1 / 30);
  assert.ok(Math.abs(v.get().vx - 1.4) < 0.1);
  v.update(500, 0, 1 / 30);
  assert.ok(Math.abs(v.get().vx - 1.4) < 0.1);
});

test("the view draws by tier, culls the traffic to the view, and tracks the area out to its edge", () => {
  // People: the full figure, a two-part one, a one-part one.
  assert.match(VIEW, /const \[full, mid, low\] = byTier\(seen, PEOPLE_CAPS\)/);
  assert.match(VIEW, /midBody = mk\(midBodyGeo/);
  assert.match(VIEW, /lowBody = mk\(lowBodyGeo/);
  // Cars: in view only, kit / code-built / a box.
  assert.match(VIEW, /CAR_FRUSTUM\.intersectsSphere/);
  assert.match(VIEW, /fleetOf\(v\.model, v\.shade, tier === MODERATE, v\.id === transit\.ride\?\.vehicle\)/);
  assert.match(VIEW, /lowCars\.setMatrixAt/);
  // Tracked only: not placed every frame, and not drawn; nor someone in a shop out of sight.
  assert.match(VIEW, /if \(was\.tier === TRACKED\) \{ trackedPeople \+= 1; continue; \}/);
  assert.match(VIEW, /pos\.indoors && pos\.indoors !== shop\.place\?\.id/);
  assert.match(VIEW, /scanReach = trackReach\(focus\)/);
  // The ride's route stretches the field.
  assert.match(VIEW, /detailField\(\{ x: focus\.x, z: focus\.z \}, \{ vx: fv\.vx, vz: fv\.vz, ahead: routeAheadNow\(\) \}\)/);
});
