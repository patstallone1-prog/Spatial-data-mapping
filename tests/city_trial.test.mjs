// Trials by jury (docs/city/trial.mjs): who is called and when, what a case shows, how the
// verdict is reached and what it does.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { TRIAL_ACTS, benchRuling, caseFile, clockScale, exhibitSvg, sentenceFor, verdictOf } from "../docs/city/trial.mjs";
import { CityWorld } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const DAY = 86_400_000, HOUR = 3_600_000, MON_6 = Date.UTC(2026, 10, 9, 14, 0);
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const here = { x: 40, z: 0, ...MARINA };
function world() {
  const w = new CityWorld(R, { now: MON_6, seed: "trial-test" });
  for (const [id, name] of [["ana", "Ana Reyes"], ["ben", "Ben Ito"], ["cy", "Cy Moss"], ["di", "Di Okafor"]]) w.submit(id, "join", { name, home: { id: `h-${id}`, x: 0, z: 0 }, at: here });
  w.step(MON_6 + 1000);
  return w;
}
const notesOf = (w, pid) => Object.values(w.inbox(pid).tabs).flat().find((t) => t.kind === "notices");
const trialOf = (w, pid) => Object.values(w.inbox(pid).tabs).flat().find((t) => t.kind === "trial");
const summonsOf = (w, pid) => (notesOf(w, pid)?.msgs || []).filter((x) => /^Jury summons/.test(x.text));
const pick = (w, pid, t, label) => { const m = [...t.msgs].reverse().find((x) => x.choices?.some((c) => c.label.startsWith(label))); assert.ok(m, label); return w.submit(pid, "answer", { thread: t.id, message: m.id, choice: m.choices.find((c) => c.label.startsWith(label)).id }); };
const keepHere = (w, ids, hours) => { for (let i = 0; i < hours * 2; i += 1) { w.step(w.now + HOUR / 2); for (const id of ids) w.submit(id, "read_thread", { thread: "sys:hall" }); } };

test("the rules: summonses by real time, open at once, far fewer than before", () => {
  const J = R.business.law.jury, scale = clockScale(R);
  assert.equal(scale, 20, "a game day is 72 real minutes");
  assert.ok(J.open_real_hours <= 6 && J.every_real_days >= 14 && J.online_real_minutes <= 30);
  // The old rule in real time: 30 game days = a day and a half. The new one is at least nine times rarer.
  assert.ok(J.every_real_days / (30 / scale) >= 9);
  for (const a of TRIAL_ACTS) assert.equal(typeof CityWorld.prototype[`mail_${a}`], "function", a);
});

test("a case file: judge, prosecutor, defence, witnesses, the accused; exhibits that are pictures; the truth shows in them", () => {
  const spec = (guilty, seed, skill = 0.8) => ({ id: `t${seed}`, charge: "theft", cls: "criminal", accused: "Sam Vale", at: MON_6, sources: ["camera", "witness", "patrol officer"], priors: 1, defence: { kind: "lawyer", name: "Lee Park", firm: "Park & Cho", skill }, guilty, seed });
  const f = caseFile(R, spec(true, 1));
  assert.deepEqual(f, caseFile(R, spec(true, 1)), "the same case, the same file");
  assert.match(f.judge, /^Judge /); assert.ok(f.prosecutor && f.defence.name === "Lee Park");
  for (const who of ["judge", "people", "defence", "accused", "witness"]) assert.ok(f.script.some((s) => s.who === who), who);
  assert.ok(f.exhibits.some((e) => e.side === "people") && f.exhibits.some((e) => e.side === "defence"));
  assert.ok(f.script.find((s) => s.who === "people").exhibits.length >= 2);
  assert.ok(f.questions.length >= 2 && f.questions.every((q) => q.answer.includes(": ")));
  for (const e of f.exhibits) { const svg = exhibitSvg(e); assert.match(svg, /^<svg /); assert.ok(svg.includes("</svg>") && svg.length > 300, e.kind); assert.ok(!/<script/i.test(svg)); }
  assert.match(exhibitSvg({ kind: "report", title: 'A "<b>x</b>"', text: "<img onerror=1>", data: { lines: ["<i>"] } }), /&lt;i&gt;/);
  // Over many cases the guilty ones weigh more than the innocent ones: a juror who reads them can tell.
  let g = 0, n = 0, benchRight = 0;
  for (let i = 0; i < 200; i += 1) { const a = caseFile(R, spec(true, `g${i}`)), b = caseFile(R, spec(false, `n${i}`)); g += a.score; n += b.score; if (benchRuling(a.score) !== "not_guilty") benchRight += 1; if (benchRuling(b.score) === "not_guilty") benchRight += 1; }
  assert.ok(g / 200 > n / 200 + 0.5, `guilty ${ (g / 200).toFixed(2) } against innocent ${ (n / 200).toFixed(2) }`);
  assert.ok(benchRight / 400 > 0.8, `the bench is right ${Math.round(benchRight / 4)}% of the time`);
  // A better lawyer puts in more.
  const weak = caseFile(R, spec(true, 7, 0.2)), strong = caseFile(R, spec(true, 7, 0.9));
  assert.ok(strong.exhibits.filter((e) => e.side === "defence").length >= weak.exhibits.filter((e) => e.side === "defence").length);
});

test("the verdict is the majority's, a tie is not guilty; the sentence follows the verdict, the class and the record", () => {
  assert.equal(verdictOf({ a: "guilty", b: "guilty", c: "not_guilty" }, "not_guilty").verdict, "guilty");
  assert.equal(verdictOf({ a: "guilty", b: "not_guilty" }, "guilty").verdict, "not_guilty");
  assert.equal(verdictOf({ a: "lesser", b: "lesser", c: "guilty", d: "not_guilty" }, "guilty").verdict, "lesser");
  assert.deepEqual(verdictOf({}, "guilty"), { by: "bench", verdict: "guilty", tally: { guilty: 0, lesser: 0, not_guilty: 0 } });
  assert.equal(sentenceFor("not_guilty", { cls: "criminal", priors: 3 }), "acquitted");
  assert.equal(sentenceFor("lesser", { cls: "criminal" }), "reduced");
  assert.equal(sentenceFor("guilty", { cls: "traffic", priors: 5 }), "record", "nobody is jailed for a traffic matter");
  assert.equal(sentenceFor("guilty", { cls: "criminal", priors: 0 }), "record");
  assert.equal(sentenceFor("guilty", { cls: "criminal", priors: 1 }), "probation");
  assert.equal(sentenceFor("guilty", { cls: "criminal", priors: 2 }), "jail");
  for (const o of ["acquitted", "reduced", "record", "probation", "jail"]) assert.ok(R.business.law.outcomes.some((x) => x.id === o), o);
});

test("only those in the city are called, never more than once in fourteen real days; the case closes in six real hours", () => {
  const w = world(), J = R.business.law.jury, scale = clockScale(R);
  w.R = { ...R, business: { ...R.business, law: { ...R.business.law, jury: { ...J, daily_chance: 1, after_days: 0 } } } };
  // Ana is about for three game days; Ben has gone.
  w.players.get("ben").seen = w.now - 40 * DAY; w.players.get("cy").seen = w.now - 40 * DAY; w.players.get("di").seen = w.now - 40 * DAY;
  keepHere(w, ["ana"], 72);
  assert.equal(summonsOf(w, "ana").length, 1, "called once, however many days go by");
  assert.equal(summonsOf(w, "ben").length, 0, "nobody away is called");
  const t = [...w.trials.values()][0];
  assert.ok(t.npc && t.jurors.ana);
  assert.equal(t.closes - t.opened, J.open_real_hours * HOUR * scale);
  assert.equal(t.opened, t.jurors.ana.summoned, "open from the moment of the summons");
  // Still about a real week on: no second summons. Past fourteen real days: one more.
  keepHere(w, ["ana"], 24 * 7 * scale / 2 / 12);   // (a slice of it, stepped)
  w.step(w.now + 6 * DAY * scale); w.submit("ana", "read_thread", { thread: "sys:hall" });
  keepHere(w, ["ana"], 30);
  assert.equal(summonsOf(w, "ana").length, 1, "a real week on: not again");
  w.step(w.now + 9 * DAY * scale); w.submit("ana", "read_thread", { thread: "sys:hall" });
  keepHere(w, ["ana"], 60);
  assert.equal(summonsOf(w, "ana").length, 2, "after fourteen real days, another");
});

test("one of the city's residents on trial: your vote is the verdict; unanswered, the judge rules on the evidence; both go on the docket", () => {
  const w = world();
  for (const id of ["ben", "cy", "di"]) w.players.get(id).seen = w.now - 40 * DAY;
  const t = w.openTrial({ seed: "one" });
  assert.equal(w.summon(t, w.players.get("ana")), true);
  assert.equal(w.summon(t, w.players.get("ana")), false, "once");
  const go = pick(w, "ana", notesOf(w, "ana"), "Go to the case");
  assert.equal(go.ok, true, go.error);
  const th = trialOf(w, "ana");
  assert.ok(th.msgs.length >= 6);
  assert.equal(pick(w, "ana", th, "Guilty of the lesser offence").ok, true);
  assert.equal(t.verdict.by, "jury"); assert.equal(t.verdict.verdict, "lesser"); assert.equal(t.verdict.outcome, "reduced");
  assert.equal(w.docket.at(-1).outcome, "reduced"); assert.ok(w.docket.at(-1).fine > 0);
  assert.equal(pick(w, "ana", trialOf(w, "ana"), "Not guilty").ok, false, "once given, a verdict stands");
  // Another, never opened: closed by the judge, the juror told they missed it.
  const t2 = w.openTrial({ seed: "two" });
  w.summon(t2, w.players.get("ana"));
  for (let x = 0; x < 6 * 24 + 2; x += 6) w.step(w.now + 6 * HOUR);
  assert.equal(t2.verdict.by, "bench");
  assert.ok(["guilty", "lesser", "not_guilty"].includes(t2.verdict.verdict));
  assert.equal(t2.verdict.verdict, benchRuling(t2.file.score, { absent: false }), "by the weight of the evidence, not by chance");
  assert.ok(notesOf(w, "ana").msgs.some((x) => /closed without your verdict/.test(x.text)));
  w.ledger.check();
});

test("a player's case: those in the city are its jury; two for guilt and one against convicts, and the sentence is real; saved and loaded", () => {
  const w = world();
  const ben = w.players.get("ben");
  ben.record = [{ charge: "theft", class: "criminal", outcome: "convicted", at: w.now - 100 * DAY, case: "old" }];
  const bill = w.fine(ben, "theft", "Took a scooter", ["witness"]);
  const c = w.cases.get(bill.case);
  c.court = w.now + HOUR;
  keepHere(w, ["ana", "cy", "di", "ben"], 2);
  const t = w.trials.get(c.trial);
  assert.ok(t && !t.npc);
  assert.deepEqual(Object.keys(t.jurors).sort(), ["ana", "cy", "di"], "everyone about, but not the accused");
  // Saved and loaded mid-trial.
  const w2 = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(w2.trials.get(t.id).accused, "Ben Ito");
  for (const [id, vote] of [["ana", "Guilty"], ["cy", "Not guilty"], ["di", "Guilty"]]) { assert.equal(pick(w, id, notesOf(w, id), "Go to the case").ok, true); const r = pick(w, id, trialOf(w, id), vote); assert.equal(r.ok, true, r.error); }
  assert.equal(c.verdict.by, "trial"); assert.equal(c.verdict.outcome, "probation", "guilty, with one prior");
  assert.ok(ben.probation && ben.record.some((l) => l.case === c.id && l.outcome === "probation"));
  assert.ok(c.closed);
  assert.match(trialOf(w, "cy").msgs.at(-1).text, /2 for guilt, 1 against/);
  w.ledger.check();
});

test("what the server sends: a juror sees their own vote and no weights; the page opens exhibits and goes to the case", async () => {
  const views = readFileSync(new URL("../server/city/views.mjs", import.meta.url), "utf8");
  assert.ok(views.includes("guilty: undefined, score: undefined") && views.includes("map(({ weight, ...e }) => e)"));
  const panel = readFileSync(new URL("../docs/city/messages-panel.mjs", import.meta.url), "utf8");
  assert.ok(panel.includes("exhibitSvg(x)") && panel.includes("m.ui?.exhibits?.length") && panel.includes("r.result?.thread"));
  const ent = readFileSync(new URL("../docs/city/enterprise-panels.mjs", import.meta.url), "utf8");
  assert.ok(ent.includes("if (r.pending)"));
});
