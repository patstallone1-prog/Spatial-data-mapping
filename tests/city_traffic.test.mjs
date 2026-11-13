// The city's traffic and people keeping out of each other (docs/city/people.mjs pavementRoute,
// LANE; docs/city/fleet.mjs Drivers): walkers keep to the pavement and cross only at the
// crosswalks; cars never drive into each other, give way in turn at junctions and keep their
// lane clear of the cars parked at the kerb; and money the backend grants a device's account
// goes into the wallet once.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { Drivers, crosses, junctionPath } from "../docs/city/fleet.mjs";
import { LANE, Streets, alongRoute, pavementRoute, rng } from "../docs/city/people.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const N = 6, STEP = 100;
function grid(highway = () => "residential") {
  const ways = [];
  for (let i = 0; i <= N; i += 1) {
    const along = Array.from({ length: N + 1 }, (_, j) => j * STEP);
    ways.push({ kind: "street", pts: along.map((v) => [i * STEP, v]), lanes: 2, oneway: 0, id: `v${i}`, highway: highway(i), road_m: 10 });
    ways.push({ kind: "street", pts: along.map((v) => [v, i * STEP]), lanes: 2, oneway: 0, id: `h${i}`, highway: "residential", road_m: 10 });
  }
  return new Streets(ways);
}
const near = (v) => Math.round(v / STEP) * STEP;

test("walkers keep to the pavement and cross a street only on a crosswalk at a junction, corner to corner", () => {
  const S = grid(), r = rng("pave");
  const inRoad = (x, z) => Math.abs(x - near(x)) < 4.99 || Math.abs(z - near(z)) < 4.99;
  const atJunction = (x, z) => Math.abs(x - near(x)) < 7 && Math.abs(z - near(z)) < 7;
  let walks = 0;
  for (let k = 0; k < 250; k += 1) {
    const at = () => (1 + Math.floor(r() * (N - 1))) * STEP, off = () => (r() < 0.5 ? 1 : -1) * (7 + r() * 35);
    const a = S.nearest(at(), at(), "walk", 50), b = S.nearest(at(), at(), "walk", 50);
    if (a === b) continue;
    const from = { x: S.nodes[a].x + off(), z: S.nodes[a].z + off() }, to = { x: S.nodes[b].x + off(), z: S.nodes[b].z + off() };
    const pr = pavementRoute(S, S.route(a, b, "walk"), { from, to });
    walks += 1;
    for (let d = 0; d <= pr.length; d += 0.25) {
      const p = alongRoute(pr, d);
      if (!inRoad(p.x, p.z)) continue;
      const on = pr.crossings.find((c) => d >= c.s0 - 0.01 && d <= c.s1 + 0.01);
      assert.ok(on && atJunction(p.x, p.z), `walk ${k} is in the road at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), ${on ? "off the junction" : "off any crosswalk"}`);
    }
    for (const c of pr.crossings) {
      const p0 = alongRoute(pr, c.s0), p1 = alongRoute(pr, c.s1);
      assert.ok(Math.abs(p0.x - p1.x) < 0.5 || Math.abs(p0.z - p1.z) < 0.5, `walk ${k} cuts across a junction diagonally`);
      assert.ok(c.s1 - c.s0 < 15, "one street at a time");
    }
    // It ends at the place, on its side of the street.
    const end = pr.pts[pr.pts.length - 1];
    assert.ok(Math.hypot(end[0] - to.x, end[1] - to.z) < 0.01);
  }
  assert.ok(walks > 200);
});

test("cars never drive into each other: they give way in turn at junctions and nobody stands for good", () => {
  for (const [seed, main] of [["a", false], ["b", false], ["c", true]]) {
    const S = grid((i) => (main && i % 2 ? "primary" : "residential")), r = rng("cars", seed), cars = [];
    for (let k = 0; cars.length < 60 && k < 600; k += 1) {
      const pick = () => S.nearest(Math.floor(r() * (N + 1)) * STEP, Math.floor(r() * (N + 1)) * STEP, "drive");
      const a = pick(), b = pick();
      if (a === b) continue;
      const route = S.route(a, b, "drive");
      if (!route || route.length < 150) continue;
      const t0 = r() * 120, dur = route.length / 9, d0 = 30;
      cars.push({ id: `c${cars.length}`, key: `c${cars.length}:1`, route, t0, sched: (ts) => (ts < t0 ? 0 : d0 + Math.max(0, Math.min(1, (ts - t0) / dur)) * (route.length - d0)),
        unsched: (d) => t0 + ((d - d0) / (route.length - d0)) * dur, limit: 11.2, cruise: 11.2, length: 4.6, width: 1.85 });
    }
    const D = new Drivers(S), dt = 0.05, still = new Map();
    let worst = Infinity, last = null;
    for (let t = 0; t < 420; t += dt) {
      const res = D.step(dt, t, cars.filter((c) => t >= c.t0), []);
      last = res;
      const live = res.cars.filter((x) => !x.arrived && t - cars.find((c) => c.id === x.id).t0 > 3).map((x) => {
        const c = cars.find((y) => y.id === x.id), p = alongRoute(c.route, x.d, LANE);
        return [-1.375, 0, 1.375].map((u) => [p.x - Math.sin(p.yaw) * u, p.z - Math.cos(p.yaw) * u]);
      });
      for (let i = 0; i < live.length; i += 1) for (let j = i + 1; j < live.length; j += 1) {
        for (const p of live[i]) for (const q of live[j]) worst = Math.min(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
      }
      for (const x of res.cars) still.set(x.id, !x.arrived && x.v < 0.1 ? (still.get(x.id) || 0) + dt : 0);
    }
    // (Two 1.85 m cars' circles touch at 1.85; a corner's swing may graze by a hand's width.)
    assert.ok(worst > 1.5, `${seed}: two cars came ${worst.toFixed(2)} m apart (centre to centre of their bodies)`);
    assert.equal(last.cars.filter((x) => x.arrived).length, cars.length, `${seed}: every car got where it was going`);
    assert.ok([...still.values()].every((s) => s < 30), `${seed}: a car stood for good`);
  }
});

test("the right of way: which ways through a junction cross", () => {
  const n = { x: 0, z: 0 }, E = [1, 0], W = [-1, 0], S = [0, 1], Nn = [0, -1];
  const way = (inU, outU) => ({ inU, outU, path: junctionPath(n, inU, outU, 3.2, 3.2, 6.5) });
  assert.equal(crosses(way(E, E), way(E, S)), false, "one behind the other, from the same way in");
  assert.equal(crosses(way(E, E), way(W, W)), false, "opposite ways straight on");
  assert.equal(crosses(way(E, E), way(S, S)), true, "across each other");
  assert.equal(crosses(way(E, Nn), way(W, W)), true, "a left turn across the way coming");
  assert.equal(crosses(way(S, W), way(W, S)), true, "into the same corner");
  assert.equal(crosses(way(E, S), way(W, Nn)), false, "two right turns, opposite corners");
});

test("the streets are as wide as the world draws their kerbs", () => {
  const S = new Streets([{ kind: "street", pts: [[0, 0], [100, 0]], lanes: 2, oneway: 0, road_m: 10 }]);
  // The drawn kerbs are 7 m either side of the middle, not OpenStreetMap's 5.
  const kerbAt = (x, z) => ({ x, z: Math.sign(z) * 7, nx: 0, nz: Math.sign(z), ax: 1, az: 0 });
  assert.equal(S.calibrate(kerbAt), 1);
  assert.ok(S.edges.flat().every((e) => Math.abs(e.half - 7) < 1e-9));
  assert.equal(S.calibrate(() => null), 0, "no kerbs drawn: left as it was");
});

test("a car's lane keeps clear of the cars parked at the kerb", () => {
  // A 10 m street: a car parked a hand's width off the kerb stands 3.9 m out; the lane is 1.7.
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(close(LANE(5, "residential", true), 1.7));
  assert.ok(close(LANE(5, "residential", null), 1.7), "a residential street is parked on unless known not to be");
  assert.ok(close(LANE(5, "arterial", false), 3.2), "no parking: the lane is out by the kerb");
  assert.ok(5 - 0.15 - 0.95 - LANE(5, "residential", true) > 1.85 + 0.2, "a car width and more between");
});

test("money granted to a device's account goes into the wallet once", () => {
  const w = new CityWorld(R, { now: Date.now(), seed: "grant" });
  w.submit("me", "join", { name: "Me" });
  const before = w.submit("me", "status", {}).balance;
  const r1 = w.submit("me", "account_grant", { grant: 7, amount: 100_000_000 });
  assert.equal(r1.balance, before + 100_000_000);
  assert.equal(w.submit("me", "account_grant", { grant: 7, amount: 100_000_000 }).already, true);
  // Saved and loaded again (a reload): still not twice.
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(again.submit("me", "account_grant", { grant: "7", amount: 100_000_000 }).already, true);
  assert.equal(again.submit("me", "status", {}).balance, before + 100_000_000);
  assert.equal(w.submit("me", "account_grant", { grant: 8, amount: 9e9 }).ok, false, "no more than the ceiling");
  // A party's host never mints one asked for by someone else.
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.match(view, /m\.command === "account_grant" \? \{ ok: false/);
});

test("a signal head is lit by the phase the cars coming at it keep, one lens at a time", async () => {
  const { signalNodeNear, signalShown } = await import("../docs/city/view.mjs");
  const { TRAFFIC, junctionAt, signalAt } = await import("../docs/city/fleet.mjs");
  // An arterial east-west (Lombard) crossed by a residential street (Fillmore) at (0, 0).
  const streets = new Streets([
    { kind: "street", id: "a", name: "Lombard Street", pts: [[-200, 0], [0, 0], [200, 0]], lanes: 4, road_m: 16, oneway: 0 },
    { kind: "street", id: "b", name: "Fillmore Street", pts: [[0, -200], [0, 0], [0, 200]], lanes: 2, road_m: 10, oneway: 0 },
  ]);
  const node = signalNodeNear(streets, 9, 9);
  assert.equal(junctionAt(streets, node), "signal");
  assert.equal(signalNodeNear(streets, 120, 9), null, "no signalled junction near: the head stays dark");
  // The lenses face the traffic coming at them: west, to the cars going east; south, to the
  // cars going north (z runs south).
  const west = -Math.PI / 2, south = 0;
  const seen = { west: new Set(), south: new Set() };
  for (let t = 0; t < TRAFFIC.signal_cycle_s; t += 0.5) {
    const a = signalShown(streets, node, west, t), b = signalShown(streets, node, south, t);
    assert.equal(a, signalAt(streets, node, Math.PI / 2, t), "what an eastbound car stops and goes by");
    assert.equal(b, signalAt(streets, node, Math.PI, t), "what a northbound car stops and goes by");
    assert.ok(!(a === "green" && b === "green"), `both green at ${t} s`);
    seen.west.add(a); seen.south.add(b);
  }
  for (const side of Object.values(seen)) assert.deepEqual([...side].sort(), ["amber", "green", "red"]);
  assert.equal(signalShown(streets, null, west, 0), null);
  // The page's lenses: dark until lit, the lit one drawn as a light; the city lights them.
  const page = ["20-station-entrances-a-stair-down.js", "30-the-living-city.js", "29-one-world-a-region-built.js"]
    .map((f) => readFileSync(new URL(`../src/smc/renderer/page/module/${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(page.includes("new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })") && page.includes("for (let i = 0; i < rows.length; i += 1) mesh.setColorAt(i, colour);"));
  assert.ok(page.includes("signalLamps.lamps[want].setColorAt(i, colour.setHex(SIGNAL_LENS_LIT[want]))"));
  assert.ok(page.includes("lightSignals: (stateOf) => {") && page.includes("signalHeads: () => signalLamps?.heads || [], setSignalLights,"));
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.ok(view.includes("lightSignals(t / 1000, now);") && view.includes("return signalShown(s, node, head.yaw, tsec);"));
});
