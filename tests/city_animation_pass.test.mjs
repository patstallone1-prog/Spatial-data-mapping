// The animation pass (docs/71-animation-catalogue.md): an arrest is watched and filmed, not
// called in or stepped into; a punch lands only where the fist reaches; the officer's way is
// given; and the crowd keeps its bodies for what it does.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reactionTo, temperamentOf } from "../docs/city/temperament.mjs";
import { CROWD_MOVES } from "../docs/city/npc-figures.mjs";

test("at an arrest people watch or film; nobody calls the police already there or steps in", () => {
  const seen = {};
  for (let i = 0; i < 400; i += 1) {
    const t = temperamentOf({ id: `p${i}` });
    const kind = reactionTo(t, { id: "arrest:1", kind: "arrest" }, 6, `p${i}`);
    seen[kind] = (seen[kind] || 0) + 1;
  }
  assert.equal(seen.call, undefined);
  assert.equal(seen.help, undefined);
  assert.ok(seen.watch > 100 && seen.film > 20, JSON.stringify(seen));
});

test("a punch is landed on contact, from where the fist is, not on whoever was aimed at", () => {
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  const lands = view.slice(view.indexOf("function punchLands"), view.indexOf("function punchLands") + 1400);
  assert.match(lands, /getWorldPosition\(handR\)/);
  assert.match(lands, /BODY_R \+ FIST_TOUCH/);
  assert.match(lands, /misses/);
  // Empty-handed blows on people go through it, captured or not.
  assert.match(view, /aim\?\.kind === "person" && !p\.hands \? punchLands\(aim, "right"\)/);
});

test("the arrest walks you to the car, sits you in, and people give the officer room", () => {
  const police = readFileSync(new URL("../docs/city/police.mjs", import.meta.url), "utf8");
  assert.match(police, /playMove\?\.\("Walk", \{ loop: true/);
  assert.match(police, /playMove\?\.\("SitDown"/);
  assert.match(police, /function giveWay\(id, entry, dt\)/);
  assert.match(police, /incident\?\.\("arrest"/);
});

test("the crowd shows hits, falls, talk and the officers' hands with its own bodies", () => {
  for (const m of ["HitChest", "Knockback", "Fall", "Talk", "Call", "Interact", "Push", "PunchGuard"]) assert.ok(CROWD_MOVES.includes(m), m);
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.match(view, /if \(mv\) return Boolean\(figures\.canMove\?\.\(mv\.name\)\)/);
});
