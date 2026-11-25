// The Civic Center Courthouse's floor (courthouse.mjs): every room reached through its doors and
// none left by the street doors; Department 12's seats in their places; who is in court and how
// full the gallery is by how grave the case is; the hearing's beats; the building built.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../docs/vendor/three-0.160.0/three.module.min.js";
import { COURT_PLAN, WAYS, atExit, buildCourthouse, canWalk, castOf, hearingOf, pathBetween, roomAt, seatsOf } from "../docs/city/courthouse.mjs";
import { loadRules } from "../docs/city/core.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const FILE = { judge: "Hon. Teresa Mendoza", prosecutor: "Daniel Okafor", defence: { name: "Ruth Ellis", kind: "public" }, accused: "Pat Doe", charge: { law: "Penal Code 242, battery", lesser: "disturbing the peace" },
  script: [{ who: "judge", name: "Judge", text: "We are here on the People's case." }, { who: "people", name: "Okafor", text: "The People will show the accused struck the victim.", exhibits: ["e1"] },
    { who: "witness", name: "Sam Lee", text: "I saw it from the corner." }, { who: "witness", name: "Sam Lee", text: "He swung first." }, { who: "defence", name: "Ellis", text: "My client acted in fear." }, { who: "accused", name: "Pat Doe", text: "I'm sorry it happened." }],
  exhibits: [{ id: "e1", side: "people", title: "A camera still" }] };

test("the floor: from the corridor every room is reached through its door; the street doors are no way out", () => {
  // A walk on a 0.25 m grid from the start, through doors.
  const key = (x, z) => `${Math.round(x * 4)},${Math.round(z * 4)}`, seen = new Set(), q = [[COURT_PLAN.start.x, COURT_PLAN.start.z]];
  assert.ok(canWalk(q[0][0], q[0][1]));
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
      const nx = x + dx, nz = z + dz, k = key(nx, nz);
      if (seen.has(k) || !canWalk(nx, nz)) continue;
      seen.add(k); q.push([nx, nz]);
    }
  }
  const reached = new Set([...seen].map((k) => { const [a, b] = k.split(",").map(Number); return roomAt(a / 4, b / 4)?.id; }));
  for (const r of COURT_PLAN.rooms) assert.ok(reached.has(r.id), `${r.id} is reached`);
  // Not through a wall: from the corridor straight into the courtroom away from its doors.
  assert.ok(!canWalk(2.2, 20));
  // The street doors: the lobby's front is at the exit and is held.
  assert.ok(atExit(0, 0.5) && !atExit(0, 5));
  // Not through the furniture: the bench, a pew, the counsel tables.
  for (const [x, z] of [[19, 25], [6.6, 20], [12.1, 22], [15, 16]]) assert.ok(!canWalk(x, z), `${x},${z} is furniture`);
});

test("Department 12: the bench raised at the end, a jury of twelve and two alternates, the gallery's pews", () => {
  const S = seatsOf();
  assert.equal(S.jurors.length, 14);
  assert.ok(S.gallery.length >= 100, `gallery ${S.gallery.length}`);
  assert.equal(S.deliberation.length, 12);
  assert.ok(S.judge[0].y > S.witness[0].y && S.witness[0].y > 0, "the bench above the stand above the well");
  assert.ok(S.jurors[7].y > S.jurors[0].y, "the back row of the box raised");
  for (const s of [...S.gallery, ...S.prosecution, ...S.defence]) assert.equal(roomAt(s.x, s.z)?.id, "court");
  for (const s of S.deliberation) assert.equal(roomAt(s.x, s.z)?.id, "jury");
  // The prosecution's table nearer the jury box; both face the bench.
  assert.ok(S.prosecution[0].z < S.defence[0].z);
  assert.ok(Math.abs(S.prosecution[0].yaw + Math.PI / 2) < 1e-9);
});

test("who is in court: the judge, the clerk, the reporter, the bailiff, counsel, the witnesses, a jury -- and the public by how grave the case is", () => {
  const cast = castOf(R, FILE, { severity: 4, seed: "c" }), roles = new Set(cast.map((c) => c.role));
  for (const r of ["judge", "clerk", "reporter", "bailiff", "prosecution", "defence", "witness", "juror", "alternate", "public"]) assert.ok(roles.has(r), r);
  assert.equal(cast.filter((c) => c.role === "juror").length, 12);
  assert.equal(cast.filter((c) => c.role === "witness").length, 1, "one witness, called once");
  const pub = (sev) => castOf(R, FILE, { severity: sev, seed: "c" }).filter((c) => c.role === "public").length;
  assert.equal(pub(1), 0, "nobody watches a traffic ticket");
  assert.ok(pub(6) > 45 && pub(6) > pub(4), "a full house for something like a killing");
  // Dressed for it: the judge in black, the deputy in uniform, counsel in suits.
  const by = (r) => cast.find((c) => c.role === r).person;
  assert.equal(by("judge").uniform, "#0d0d10");
  assert.equal(by("bailiff").role, "police");
  assert.match(by("prosecution").title, /attorney/i);
  // Speaking for yourself: no defence counsel.
  assert.ok(!castOf(R, { ...FILE, defence: { kind: "self" } }, { severity: 2, seed: "s" }).some((c) => c.role === "defence"));
});

test("the hearing: called to order, the witness called and stepping down, the jury out and back, the verdict, adjourned", () => {
  const b = hearingOf(FILE), kinds = b.map((x) => x.kind);
  assert.deepEqual(kinds.slice(0, 2), ["rise", "order"]);
  for (const k of ["call", "line", "step_down", "charge", "out", "deliberate", "back", "ask", "verdict", "sentence", "adjourn"]) assert.ok(kinds.includes(k), k);
  assert.equal(kinds.filter((k) => k === "call").length, 1);
  assert.ok(kinds.indexOf("call") < kinds.indexOf("step_down") && kinds.indexOf("out") < kinds.indexOf("verdict"));
  assert.ok(b.every((x) => x.s >= 3 && x.s <= 30));
  assert.ok(b.some((x) => x.exhibits?.length));
  // The ways people walk stay on the floor.
  for (const way of Object.values(WAYS)) for (const [x, z] of way) assert.ok(roomAt(x, z), `${x},${z}`);
  const p = pathBetween({ x: 0, z: 30 }, { x: 6, z: 25 });
  assert.ok(p.length === 4 && roomAt(p[1][0], p[1][1])?.id === "corridor" && roomAt(p[2][0], p[2][1])?.id === "court");
});

test("the building: built with its rooms, its fittings and seats to sit in", () => {
  const ctx2d = new Proxy({}, { get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  try {
    const { group, gavel, showExhibit } = buildCourthouse(THREE, { judge: "Teresa Mendoza" });
    let meshes = 0, tris = 0;
    group.traverse((o) => { if (o.isMesh) { meshes += 1; const g = o.geometry, n = g.index ? g.index.count / 3 : g.attributes.position.count / 3; tris += n * (o.isInstancedMesh ? o.count : 1); assert.ok(!o.castShadow); } });
    assert.ok(meshes > 400, `meshes ${meshes}`);
    assert.ok(tris < 400_000, `triangles ${tris}`);
    assert.ok(gavel?.isObject3D);
    assert.doesNotThrow(() => showExhibit("A camera still", "people"));
    assert.ok(group.userData.courtSeats.length > 120);
  } finally { delete globalThis.document; }
});
