// Driving as a car drives (car-control.mjs), getting in and out (car-entry.mjs), swimming by your
// stamina (core.mjs swimMode), and the page's water and magic camera (module 32, module 33).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DRIVE, carState, lightAhead, maxCurvature, parkPath, startLaneChange, startPark, startStop, stepCar, turnRadius, alongPath } from "../docs/city/car-control.mjs";
import { ENTRY, carPoints, entryPose, entrySpot, entryTime } from "../docs/city/car-entry.mjs";
import { applyExertion, loadRules, swimMode } from "../docs/city/core.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url), "utf8")));
const run = (st, input, seconds, env = {}, dt = 1 / 60) => {
  let x = 0, z = 0, last = null;
  for (let t = 0; t < seconds; t += dt) { const r = stepCar(st, input, dt, env); x += r.dx; z += r.dz; if (r.event) last = r.event; }
  return { x, z, event: last };
};

test("the throttle pulls hard from rest and less with speed; off it the car slows by itself", () => {
  const st = carState({ yaw: 0 });
  run(st, { up: true }, 1);
  const after1 = st.v;
  run(st, { up: true }, 9);
  // From rest to 60 mph (26.8 m/s) in about nine or ten seconds, as a family car does.
  assert.ok(after1 > 1 && after1 < 3.6, `first second ${after1}`);
  assert.ok(st.v > 22 && st.v < 30, `ten seconds ${st.v}`);
  const before = st.v;
  run(st, {}, 3);
  assert.ok(st.v < before - 1.5 && st.v > before - 6, `coasting ${before} -> ${st.v}`);
});

test("the brake bites harder the longer it is held, and held at a stop it goes into reverse", () => {
  const st = carState(); st.v = 15; st.parked = false;
  stepCar(st, { down: true }, 0.1); const soft = st.brake;
  run(st, { down: true }, 0.6); const hard = st.brake;
  assert.ok(soft < 0.2 && hard > 0.7, `${soft} then ${hard}`);
  run(st, { down: true }, 3);
  assert.equal(st.v <= 0, true);
  run(st, { down: true }, 2);
  assert.equal(st.gear, -1);
  assert.ok(st.v < -1 && st.v >= -DRIVE.reverseTop, `reversing ${st.v}`);
  // Up brakes the reverse, then drives on.
  run(st, { up: true }, 3);
  assert.equal(st.gear, 1);
});

test("the wheel turns the car round a curve as wide as its speed needs", () => {
  const wb = carState().wheelbase;
  const slow = turnRadius(2, 1, wb), fast = turnRadius(20, 1, wb);
  assert.ok(slow > 3 && slow < 6, `full lock at a crawl: ${slow} m`);
  assert.ok(fast > 60, `at 45 mph the tyres need ${fast} m`);
  assert.ok(maxCurvature(20, wb) < maxCurvature(5, wb));
  // The wheel takes time to turn and comes back by itself.
  const st = carState(); st.v = 8; st.parked = false;
  stepCar(st, { up: true, left: true }, 0.1);
  assert.ok(st.wheel > 0 && st.wheel < 0.3);
  run(st, { up: true, left: true }, 1);
  assert.ok(st.wheel > 0.9 && st.yaw > 0.3, `turning left: wheel ${st.wheel}, yaw ${st.yaw}`);
  run(st, { up: true }, 1);
  assert.ok(Math.abs(st.wheel) < 0.05);
});

test("a lane change goes over one lane on a smooth S and ends facing the same way", () => {
  const st = carState({ yaw: 0 }); st.v = 12; st.parked = false;
  assert.equal(startLaneChange(st, 1), null);
  const out = run(st, { up: true }, 4);
  assert.equal(out.event, "lane");
  // Facing -z; left is -x: one lane over, and on along the road.
  assert.ok(Math.abs(out.x + DRIVE.laneWidth) < 0.05, `over ${out.x}`);
  assert.ok(out.z < -30);
  assert.ok(Math.abs(st.yaw) < 1e-9);
  const slow = carState(); slow.v = 1;
  assert.match(startLaneChange(slow, -1), /Too slow/);
});

test("S stops the car at the red light's line, braking only as hard as it needs to", () => {
  const st = carState({ yaw: 0 }); st.v = 13; st.parked = false;
  const signals = [{ x: 0, z: -50, light: "red", line: 8 }];
  const L = lightAhead(st, signals);
  assert.equal(L.light, "red"); assert.ok(Math.abs(L.toLine - 42) < 1e-6);
  startStop(st, L.toLine);
  let peak = 0, prev = st.v;
  const out = run(st, {}, 12, {}, 1 / 60);
  // (The hardest it braked: worked out again from a fresh run, a frame at a time.)
  const again = carState({ yaw: 0 }); again.v = 13; again.parked = false; startStop(again, 42);
  // (Down to a walking pace: the last of it is the car settling and held standing.)
  for (let i = 0; i < 720 && again.v > 1; i += 1) { stepCar(again, {}, 1 / 60); peak = Math.max(peak, (prev - again.v) * 60); prev = again.v; }
  assert.equal(out.event, "stopped");
  assert.ok(-out.z > 42 - DRIVE.lineMargin - 1.5 && -out.z < 42, `stopped ${-out.z} m on, line at 42`);
  assert.ok(peak < 4.5, `braked at ${peak} m/s^2`);
  // A light behind or off to the side is not the one ahead.
  assert.equal(lightAhead(st, [{ x: 0, z: 30, light: "red" }, { x: 40, z: -10, light: "red" }]), null);
});

test("parking drives a path into the space, backing in when it is behind, and stands there", () => {
  const from = { x: 0, z: 0, yaw: 0 };
  const ahead = parkPath(from, { x: 2.4, z: -14, yaw: 0 });
  assert.equal(ahead.reverse, false);
  assert.ok(ahead.length > 14 && ahead.length < 17);
  const behind = parkPath(from, { x: 3, z: 8, yaw: Math.PI / 2 });
  assert.equal(behind.reverse, true);
  const st = carState(from); st.parked = false;
  startPark(st, ahead);
  let x = 0, z = 0, event = null;
  for (let i = 0; i < 60 * 20 && !event; i += 1) { const r = stepCar(st, {}, 1 / 60); x += r.dx; z += r.dz; event = r.event; }
  assert.equal(event, "parked");
  assert.ok(Math.hypot(x - 2.4, z + 14) < 0.1 && st.v === 0 && st.parked);
  // An arrow takes the wheel back.
  const st2 = carState(from); startPark(st2, ahead); stepCar(st2, { left: true }, 0.1);
  assert.equal(st2.park, null);
  const mid = alongPath(ahead, 3);
  assert.ok(Number.isFinite(mid.x) && Number.isFinite(mid.z) && Number.isFinite(mid.yaw));
});

test("getting in: turned round at the door, down onto the seat and the legs swung in, facing the front", () => {
  const car = { x: 10, z: 5, yaw: 0 };
  const pts = carPoints(car, [1.8, 1.5, 4.6]);
  // The driver's door on the left (facing -z, -x), the seat inside the car.
  assert.ok(pts.door.x < car.x - 0.9 && pts.seat.x < car.x && pts.seat.x > car.x - 0.9);
  const start = entryPose(0, true), seated = entryPose(entryTime(true), true);
  assert.equal(start.at, 0); assert.equal(seated.at, 1); assert.equal(seated.done, true);
  assert.ok(Math.abs(seated.drop - ENTRY.seatDrop) < 1e-9 && seated.thigh > 1.3);
  // Facing the car at the door; facing the front, seated.
  const a = entrySpot(pts, start), b = entrySpot(pts, seated);
  const dir = (yaw) => [Math.sin(yaw), Math.cos(yaw)];
  assert.ok(dir(a.yaw)[0] > 0.9, "faces the car");
  assert.ok(dir(b.yaw)[1] < -0.9, "faces the front");
  // Out: legs out, up and a step away from the door.
  const out = entryPose(entryTime(false), false), o = entrySpot(pts, out);
  assert.equal(out.done, true); assert.equal(out.drop, 0);
  assert.ok(o.x < pts.door.x - 0.5);
});

test("in the water: a swim costs a little, a fast one a lot, and out of breath you tread water until it is back", () => {
  const W = R.vitals.stamina;
  assert.equal(swimMode(R, 80, { moving: true }).mode, "swim");
  assert.equal(swimMode(R, 80, { moving: true, sprint: true }).mode, "sprint");
  assert.ok(swimMode(R, 80, { moving: true, sprint: true }).speed > swimMode(R, 80, { moving: true }).speed);
  const low = swimMode(R, W.low - 1, { moving: true, sprint: true });
  assert.equal(low.mode, "tread"); assert.equal(low.treading, true); assert.ok(low.speed < 0.5);
  // Still treading until stamina is back to swim_resume, then swimming on.
  assert.equal(swimMode(R, W.swim_resume - 1, { moving: true, treading: true }).mode, "tread");
  assert.equal(swimMode(R, W.swim_resume + 1, { moving: true, treading: true }).mode, "swim");
  const v = { stamina: 50, strength: 20, health: 100 };
  assert.ok(applyExertion(R, v, { swim_sprint_s: 10 }).stamina < applyExertion(R, v, { swim_s: 10 }).stamina);
  assert.ok(applyExertion(R, v, { tread_s: 10 }).stamina > 50);
});

const page = (name) => readFileSync(new URL(`../src/smc/renderer/page/module/${name}`, import.meta.url), "utf8");

test("the water's depth: a beach shelves gently, a sea wall drops, a pond and a basin are shallow", async () => {
  const src = page("33-into-the-water.js");
  const THREE = await import("../docs/vendor/three-0.160.0/three.module.min.js");
  // A sea east of x = 0; land to the west, at the beach's height or a wall's.
  const make = (landY, inland = { inland: false, basin: false }) => new Function("THREE", "inlandOf", "landY", `
    const SEA_Y = 0.2, AVATAR_STAND_Y = 0.9, AVATAR_RADIUS = 0.9;
    const avatar = { userData: {}, scale: { y: 1 }, getObjectByName: () => null, position: { y: 0 } };
    const cityGame = () => true, livingCity = { driving: false, riding: false, inside: false };
    const waterMaskAt = (x) => x > 0, walkerGroundAt = (x) => (x > 0 ? 0.1 : landY);
    const walkerOnWater = (x) => x > 0, cityInlandAt = () => inlandOf;
    ${src}
    return { waterDepthAt, walkerWaterAt, WATER_WADE };`)(THREE, inland, landY);
  const beach = make(0.25), wall = make(2.5), pond = make(0.4, { inland: true, basin: false }), basin = make(0.4, { inland: true, basin: true });
  assert.ok(beach.waterDepthAt(2, 0) < 0.5, `two metres off a beach: ${beach.waterDepthAt(2, 0)}`);
  assert.ok(beach.waterDepthAt(30, 0) > 1.5);
  assert.ok(wall.waterDepthAt(1, 0) > 1.5, "at the foot of a wall");
  assert.ok(pond.waterDepthAt(20, 0) <= 1.6 && basin.waterDepthAt(20, 0) <= 0.45);
  // Wading: the feet on the bottom; deeper than the chest, afloat.
  const w = beach.walkerWaterAt(4, 0, 0.1);
  assert.equal(w.mode, "wade"); assert.ok(w.feet < 0.2 && w.feet > -0.5);
  const s = beach.walkerWaterAt(35, 0, 0.1);
  assert.equal(s.mode, "swim");
  assert.equal(beach.walkerWaterAt(-3, 0, 0.25), null);
});

test("the magic camera is City mode's and comes round faster the further you have turned from it", () => {
  const cam = page("32-the-magic-camera.js"), walk = page("26-rooms-laid-out-as-rooms.js"), place = page("21-the-electrical-network-poles-towers.js");
  assert.match(cam, /function magicCameraOn\(\)[\s\S]*cityGame\(\)/);
  assert.match(walk, /urgent = !eyes && typeof magicCameraOn === "function" && magicCameraOn\(\)/);
  // Not shoved or stopped: zoomed in, eased, to stand on your side of a building.
  assert.match(place, /if \(magic\) \{\s*magicNear = magicPullIn\(blocked, distV\);/);
  assert.doesNotMatch(cam, /magicOutOfBuildings/);
  assert.match(cam, /function magicWallLean\(aim\)/);
  // Only the car is kept out of the water; the walker goes in, in City mode.
  assert.match(page("23-pins-1-2-and-3.js"), /walkerMayWade\(\)\)\) break;/);
});

test("the magic camera zooms in short of a building, eased, and back out when it has passed", () => {
  const cam = page("32-the-magic-camera.js");
  let now = 0;
  const make = new Function("performance", "THREE", `
    const state = { yaw: 0, pitch: 0.3, dist: 10 }, dragging = false;
    ${cam}
    return { MAGIC, magicPullIn };`);
  const { MAGIC, magicPullIn } = make({ now: () => now }, {});
  const step = (wall, ms = 16) => { now += ms; return magicPullIn(wall, 10); };
  // Nothing in the way: at the distance asked for.
  assert.equal(step(null), null);
  // A building comes between at 4 m: in short of it, not past its face, within a fifth of a second.
  let d = step(4);
  assert.ok(d !== null && d <= 4.35, `first frame ${d}`);
  for (let k = 0; k < 40; k += 1) d = step(4);
  assert.ok(Math.abs(d - 4) < 0.05, `settled ${d}`);
  // It has passed: back out, eased (not at once), and all the way.
  const out1 = step(null);
  assert.ok(out1 > 4 && out1 < 5, `first frame out ${out1}`);
  let out = out1;
  for (let k = 0; k < 300 && out !== null; k += 1) out = step(null);
  assert.equal(out, null);
  // A building a moment ahead on your way starts the zoom before it comes between.
  MAGIC.ahead = 5; MAGIC.aheadUntil = now + 1000;
  d = step(null);
  assert.ok(d !== null && d < 10, `ahead ${d}`);
});
