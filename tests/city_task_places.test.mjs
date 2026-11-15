// A task's place is said with its cross streets, and what recurs (the job) comes first on the
// tasks card (people.mjs Streets.crossStreets; view.mjs todoItems, labelAt, nameAt).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Streets } from "../docs/city/people.mjs";

const VIEW = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
const way = (name, pts) => ({ kind: "street", pts, lanes: 2, oneway: 0, id: name, name, highway: "residential", road_m: 12 });
//: Three streets east-west and three north-south, 120 m apart, each one way end to end.
function town() {
  const ways = [];
  ["Bay Street", "Chestnut Street", "Lombard Street"].forEach((n, i) => ways.push(way(n, [[0, i * 120], [120, i * 120], [240, i * 120]])));
  ["Webster Street", "Fillmore Street", "Steiner Street"].forEach((n, i) => ways.push(way(n, [[i * 120, 0], [i * 120, 120], [i * 120, 240]])));
  return new Streets(ways);
}

test("a place on a street is on that street at its nearest cross street", () => {
  const S = town();
  // Thirty metres along Chestnut from Fillmore, eight metres off the centreline.
  assert.deepEqual(S.crossStreets(150, 128), { on: "Chestnut Street", cross: "Fillmore Street" });
  // Nearer Steiner.
  assert.deepEqual(S.crossStreets(225, 113), { on: "Chestnut Street", cross: "Steiner Street" });
  // On Webster, nearer Bay.
  assert.deepEqual(S.crossStreets(6, 30), { on: "Webster Street", cross: "Bay Street" });
});

test("a place on no street (a court in a park) takes the nearest corner's two streets", () => {
  const S = town();
  const c = S.crossStreets(700, 100, 600);
  assert.ok(c && c.on && c.cross && c.on !== c.cross);
  assert.deepEqual([c.on, c.cross].sort(), ["Chestnut Street", "Steiner Street"]);
  assert.equal(S.crossStreets(5000, 5000), null);
});

test("one named street in reach is said alone, never paired with itself", () => {
  const S = new Streets([way("Marina Boulevard", [[0, 0], [200, 0]])]);
  assert.deepEqual(S.crossStreets(100, 10), { on: "Marina Boulevard", cross: null });
});

test("the tasks card puts what recurs first and says cross streets on every placed line", () => {
  const body = VIEW.slice(VIEW.indexOf("  function todoItems() {"), VIEW.indexOf("  const TODO_SHOWN = 3;"));
  const at = (piece) => { const i = body.indexOf(piece); assert.ok(i >= 0, piece); return i; };
  // Where you are headed now, then the job and the businesses' shifts, then one-off steps and offers.
  const order = ["if (g) out.push(", "recurring.push({ label: \"Find a job\"", "recurring.push(...enterprise().todo(p));", "out.push(...recurring);",
    "if (t?.steps) t.steps.forEach(", "for (const o of taskOffers())"].map(at);
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  assert.ok(body.includes("o.label = labelAt(o.label, o.x, o.z);") && body.includes("label: stepAt(s)"));
  // A courier's shop and address carry their cross streets into the title and the steps.
  assert.ok(VIEW.includes("name: nameAt(placeName(from), from.x, from.z)") && VIEW.includes("stepAt(`Go to ${F.area.name}`)"));
  assert.ok(VIEW.includes("return `${shortStreet(c.on)} & ${shortStreet(c.cross)}`;") && VIEW.includes("if (said(c.on)) return shortStreet(c.cross);"));
  assert.ok(VIEW.includes("title: `Courier: ${nameAt(placeName(from), from.x, from.z)} → ${nameAt(address(to.name) || \"a home\", to.x, to.z)}`"));
});
