import test from "node:test";
import assert from "node:assert/strict";
import { selectNpcStory, npcTone, npcHobbies } from "../docs/city/npc-stories.mjs";

const occupations = ["food", "retail", "care", "office", "public", "trade", "transport", "other", "looking", "retired", "student", "child", "visitor", "unknown"];
const families = ["reserved", "warm", "direct", "expressive"];

test("each cohort has a deterministic shared authored story of two or three sentences", () => {
  const stories = new Set();
  for (const occupation of occupations) for (const wealthBand of ["negative", "low", "middle", "high", "unknown"]) {
    for (const toneFamily of families) for (const seed of ["group-0", "group-1", "group-2"]) {
      const profile = { occupation, wealthBand, toneFamily };
      const first = selectNpcStory(profile, seed);
      assert.deepEqual(selectNpcStory(profile, seed), first);
      assert.equal(typeof first.cohortId, "string");
      assert.ok(first.cohortId.length > 0);
      assert.ok(first.backstory.trim().length > 40);
      assert.ok([2, 3].includes((first.backstory.match(/[.!?]+(?:\s|$)/g) || []).length), first.backstory);
      stories.add(first.backstory);
    }
  }
  assert.ok(stories.size >= occupations.length);
});

test("youth, retired and looking stories do not impose incompatible employment histories", () => {
  for (const occupation of ["child", "student", "retired", "looking"]) {
    for (let i = 0; i < 30; i++) {
      const story = selectNpcStory({ occupation }, i).backstory;
      assert.doesNotMatch(story, /\b(?:former|previously|laid off|fired|salary|employer|career|worked as)\b/i);
      if (occupation === "child" || occupation === "student") assert.doesNotMatch(story, /\b(?:retirement|job search|workplace|shifts|wages)\b/i);
    }
  }
});

test("tone and two distinct hobbies are stable, bounded, and age-appropriate", () => {
  for (const toneFamily of families) {
    const tones = new Set();
    for (let i = 0; i < 100; i++) {
      const profile = { occupation: "student", toneFamily };
      const tone = npcTone(profile, i), hobbies = npcHobbies(profile, i);
      assert.equal(npcTone(profile, i), tone);
      assert.deepEqual(npcHobbies(profile, i), hobbies);
      assert.equal(hobbies.length, 2);
      assert.equal(new Set(hobbies).size, 2);
      tones.add(tone);
    }
    assert.ok(tones.size > 1);
  }
  const youngChoices = new Set(["drawing", "picture books", "building blocks", "singing", "playing with toys", "nature walks"]);
  for (let age = 0; age < 5; age++) for (let seed = 0; seed < 20; seed++) {
    assert.ok(npcHobbies({ occupation: "student", age }, seed).every((h) => youngChoices.has(h)));
    assert.ok(npcHobbies({ occupation: "child" }, seed).every((h) => youngChoices.has(h)));
  }
});

test("unknown input falls back safely and deterministically", () => {
  assert.deepEqual(selectNpcStory({ occupation: "missing" }, "x"), selectNpcStory({ occupation: "unknown" }, "x"));
  assert.equal(npcTone({ toneFamily: "missing" }, "x"), npcTone({ toneFamily: "reserved" }, "x"));
  assert.equal(npcHobbies({}, "x").length, 2);
});
