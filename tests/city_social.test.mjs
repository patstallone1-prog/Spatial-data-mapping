// Who you know (docs/city/social.mjs): talking makes a stranger an acquaintance and in time a
// friend; the Relationships list is gathered from the world's records; a character is told what
// the player is to them; a backstory is other players' to read and never the model's.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { standingOf } from "../docs/city/social.mjs";
import { CityWorld, PLAYER_COMMANDS } from "../docs/city/world.mjs";
import { viewFor } from "../server/city/views.mjs";
import { playerShare } from "../server/npc/share.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const HOUR = 3_600_000, NOW = Date.UTC(2026, 10, 9, 14);
const at = { x: 0, z: 0, lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
function world() {
  const w = new CityWorld(R, { now: NOW, seed: "social" });
  w.submit("ana", "join", { name: "Ana", at });
  w.submit("ben", "join", { name: "Ben", at });
  return w;
}

test("talking is what makes someone known: once a game hour counts, and it takes many to be a friend", () => {
  assert.ok(PLAYER_COMMANDS.includes("meet") && PLAYER_COMMANDS.includes("set_backstory"));
  assert.deepEqual([0, 1, 3, 4, 9, 10].map(standingOf), ["stranger", "acquaintance", "acquaintance", "familiar face", "familiar face", "friend"]);
  const w = world();
  assert.equal(w.relationTo("ana", "p:17").to_you, "stranger");
  for (let i = 0; i < 5; i += 1) assert.equal(w.submit("ana", "meet", { id: "p:17", name: "Dana Okafor", title: "Barista" }).ok, true);
  assert.equal(w.players.get("ana").people["p:17"].talks, 1, "five hellos in a minute are one conversation");
  for (let i = 0; i < 4; i += 1) { w.step(w.now + HOUR + 1); w.submit("ana", "meet", { id: "p:17", name: "Dana Okafor" }); }
  assert.equal(w.relationTo("ana", "p:17").to_you, "familiar face");
  assert.match(w.relationTo("ana", "p:17").dynamic, /several times/);
  const list = w.relationships("ana");
  assert.deepEqual(list.map((x) => [x.name, x.relation]), [["Dana Okafor", "familiar face"]]);
});

test("a part carries its own standing: your boss is your employer whatever you have said to each other", () => {
  const w = world();
  assert.equal(w.relationTo("ana", "npc:boss:ana", "boss").to_you, "employee");
  assert.match(w.relationTo("ana", "npc:boss:ana", "boss").dynamic, /employer/);
  assert.equal(w.relationTo("ana", "banker:1:small", "banker").to_you, "borrower");
  assert.equal(w.relationTo("ana", "x", "lawyer").to_you, "client");
  const notes = playerShare(w, "ana", "resident", "p:17");
  assert.equal(notes.relationship.to_you, "stranger");
});

test("a backstory is shown to other players, bounded, and is not in what a character is told", () => {
  const w = world();
  const r = w.submit("ana", "set_backstory", { text: `Grew up by the water.   ${"x".repeat(2000)}` });
  assert.equal(r.ok, true);
  assert.ok(r.backstory.length <= 600 && r.backstory.startsWith("Grew up by the water. x"));
  assert.equal(viewFor(w, "ben").players.find((p) => p.id === "ana").backstory, r.backstory);
  assert.equal(viewFor(w, "ben").players.find((p) => p.id === "ana").people, undefined, "who Ana knows is hers");
  for (const role of ["resident", "banker", "boss", "lawyer"]) assert.doesNotMatch(JSON.stringify(playerShare(w, "ana", role, "p:17")), /Grew up by the water/);
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(again.players.get("ana").backstory, r.backstory);
});
