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
  // (Where the fist is: fistTo, the hand bone's world position against the one in reach.)
  const fist = view.slice(view.indexOf("function fistTo"), view.indexOf("function fistTo") + 600);
  assert.match(fist, /getWorldPosition\(handR\)/);
  assert.match(lands, /fistTo\(q, hand\)/);
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

// The second pass (Mixamo captures): the jump, the swim, held swings, dig and push, and the
// crowd's sitting and leaning are played from life where the moves are loaded.
const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
const water = readFileSync(new URL("../src/smc/renderer/page/module/33-into-the-water.js", import.meta.url), "utf8");
const walker = readFileSync(new URL("../src/smc/renderer/page/module/22-explore-the-view-without-the.js", import.meta.url), "utf8");

test("the jump is captured: take-off fitted to the crouch, held falling, landed, and walked out of", () => {
  assert.match(view, /const JUMP_MOVES = \["JumpUp", "JumpFall", "JumpLanding"\]/);
  assert.match(view, /ctx\.playMove\("JumpUp", \{ fade: 0\.06, out: 0\.12, speed: clip \/ JUMP\.crouch_s \}\)/);
  assert.match(view, /if \(air\.mocap\) ctx\.playMove\?\.\("JumpFall", \{ loop: true/);
  assert.match(view, /ctx\.playMove\?\.\("JumpLanding"/);
  // Walking off cuts the landing short; the posed jump is not laid over the captured one.
  assert.match(view, /air\.mocap && air\.land && walkSpeed > 0\.8[\s\S]{0,80}ctx\.stopMove\?\.\("JumpLanding"\)/);
  assert.match(view, /function jumpBody\(now = performance\.now\(\)\) \{\s*if \(air\.mocap\) \{/);
});

test("swimming plays the captured stroke (lying) or treading (upright), not the posed crawl", () => {
  assert.match(water, /const want = sw \? \(lying \? "SwimStroke" : "SwimTread"\) : null;/);
  assert.match(water, /if \(swimMoveStep\(sw, goal\)\) \{/);
  assert.match(view, /if \(sw && \/\^Swim\/\.test\(ctx\.moveActive\?\.\(\) \|\| ""\)\) return;/);
});

test("held swings, digging and pushing are captured moves fitted to the act, not hurried", () => {
  assert.match(view, /swing: \(p\) => \(p\?\.hands \? \{ name: \["two_hands", "shoulder"\]\.includes\(physOf\(R, p\.hands\)\.hold\) \? "ChopHeld" : "SwingHeld" \}/);
  assert.match(view, /dig: \(\) => \(\{ name: "Dig"/);
  assert.match(view, /const speed = Math\.max\(0\.7, Math\.min\(1\.6, length \/ dur\)\);/);
  // What is held stays in the hand through a captured move.
  assert.match(view, /if \(pose\.mocap\) \{ if \(p\?\.hands && pose\.kind !== "pickup"\) inHand\(\); return; \}/);
  // A move may be played for only the first part of its clip.
  assert.match(walker, /function playWalkerMove\(name, \{ fade = 0\.12, out = 0\.18, speed = 1, loop = false, length = null \} = \{\}\)/);
});

test("the crowd sits and leans on its own bodies", () => {
  assert.ok(CROWD_MOVES.includes("SeatIdle") && CROWD_MOVES.includes("LeanWall"));
  assert.match(view, /sit: "SeatIdle", sit_phone: "SeatIdle", lean_wall: "LeanWall"/);
});

test("a punch from a little further than arm's length steps through: the guard up, a step in, the arm still bent on contact", () => {
  const view = readFileSync(new URL("../docs/city/view.mjs", import.meta.url), "utf8");
  assert.match(view, /PUNCH_REACH_M = 1\.75/);
  assert.match(view, /const PUNCH_BENT = 0\.86/);
  const step = view.slice(view.indexOf("function stepInFor"), view.indexOf("function stepInFor") + 1200);
  assert.match(step, /PUNCH_BENT/);
  assert.match(view, /function punchStep\(now\)/);
});

test("an arrest is the whole of it: against a wall, cuffed, walked to the car, the door held, the officer round to the driver's side", () => {
  const police = readFileSync(new URL("../docs/city/police.mjs", import.meta.url), "utf8");
  for (const step of ["grab", "wall", "cuff", "escort", "door", "seat", "close", "around", "drive_in", "away"]) assert.match(police, new RegExp(`"${step}"`), step);
  assert.match(police, /hands_wall/);
  assert.match(police, /function carDoor\(u, which, open\)/);
  // (The walked figure kept at the yaw it was placed at, not turned to -yaw.)
  assert.doesNotMatch(police, /animateWalk\?\.\(st, Math\.sin\(-yaw\)/);
});
