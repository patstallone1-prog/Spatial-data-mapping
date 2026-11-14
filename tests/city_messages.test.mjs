// The city's messages (docs/city/messages.mjs, docs/39): players' friends, groups, neighbours and the
// council; the lawyer who writes as the case goes, the interviewer who becomes the boss, the cab
// driver who will not wait for ever; City Hall's votes, the day in Kerbside, notices and jury duty.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { lawyersAt } from "../docs/city/enterprise.mjs";
import { MESSAGE_COMMANDS } from "../docs/city/messages.mjs";
import { CityWorld, PLAYER_COMMANDS } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const m = R.money;
const DAY = 86_400_000, HOUR = 3_600_000;
const MON_6 = Date.UTC(2026, 10, 9, 14, 0);   // Monday 06:00 in San Francisco
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const MISSION = { lon: -122.4194, lat: 37.7599, county: "county:san-francisco" };
const cafe = { id: "w200", x: 40, z: 0, name: "Corner Café", keys: ["use:retail", "shop:cafe"], ...MARINA };
const lawOffice = { id: "w300", x: 80, z: 0, name: "Dolan Law Firm", keys: ["use:office", "shop:law_office"], ...MARINA };
const at = (pl) => ({ x: pl.x, z: pl.z, lon: pl.lon, lat: pl.lat, county: pl.county });

function world(now = MON_6) {
  const w = new CityWorld(R, { now, seed: "messages-test" });
  w.submit("ana", "join", { name: "Ana Reyes", home: { id: "b1", x: 0, z: 0 }, at: at(cafe) });
  w.submit("ben", "join", { name: "Ben Ito", home: { id: "b2", x: 10, z: 0 }, at: at(cafe) });
  w.submit("cy", "join", { name: "Cy Moss", home: { id: "b3", x: 0, z: 0 }, at: { x: 0, z: 0, ...MISSION } });
  w.ledger.mint("player:ana", m(20_000), "account_grant", { at: now });
  w.step(now + 1000);
  return w;
}
const inbox = (w, pid) => w.inbox(pid);
const thread = (w, pid, pred) => Object.values(inbox(w, pid).tabs).flat().find(pred);
const lastText = (t) => t.msgs[t.msgs.length - 1].text;
function answer(w, pid, t, label) {
  const msg = [...t.msgs].reverse().find((x) => x.choices?.some((c) => c.label === label));
  assert.ok(msg, `a choice "${label}" in ${t.name}`);
  return w.submit(pid, "answer", { thread: t.id, message: msg.id, choice: msg.choices.find((c) => c.label === label).id });
}
function runTo(w, t) { for (let x = w.now; x < t; x += HOUR / 2) w.step(Math.min(t, x + HOUR / 2)); w.step(t); }

test("the message commands are the world's", () => {
  for (const c of MESSAGE_COMMANDS) assert.ok(PLAYER_COMMANDS.includes(c), c);
  assert.equal(R.business.law.jury.fee_base, m(15), "the juror's fee is money");
});

test("friends by asking and accepting; a group of friends; messages and unread counts", () => {
  const w = world();
  assert.equal(w.submit("ana", "create_group", { name: "Lunch", members: ["ben"] }).ok, false, "friends first");
  assert.equal(w.submit("ana", "add_friend", { player: "ben" }).ok, true);
  const dm = thread(w, "ben", (t) => t.kind === "dm");
  assert.match(lastText(dm), /would like to be friends/);
  assert.equal(answer(w, "ana", dm, "Accept").ok, false, "only the one asked can accept");
  assert.equal(answer(w, "ben", dm, "Accept").ok, true);
  assert.deepEqual(inbox(w, "ana").friends.map((f) => f.id), ["ben"]);
  const g = w.submit("ana", "create_group", { name: "Lunch crew", members: ["ben"] });
  assert.equal(g.ok, true, g.error);
  assert.equal(w.submit("ana", "send_message", { thread: g.thread, text: "  Tacos at 1?  " }).ok, true);
  const seen = thread(w, "ben", (t) => t.id === g.thread);
  assert.equal(seen.unread, 2, "the group's making and the message");
  assert.equal(lastText(seen), "Tacos at 1?");
  assert.equal(thread(w, "cy", (t) => t.id === g.thread), undefined, "not cy's");
  assert.equal(w.submit("cy", "send_message", { thread: g.thread, text: "hi" }).ok, false);
  assert.equal(w.submit("ana", "add_to_group", { thread: g.thread, player: "cy" }).ok, false, "cy is not a friend");
  w.submit("ben", "read_thread", { thread: g.thread });
  assert.equal(thread(w, "ben", (t) => t.id === g.thread).unread, 0);
  // A direct message by player id.
  assert.equal(w.submit("cy", "send_message", { to: "ana", text: "hello neighbour" }).ok, true);
  assert.equal(thread(w, "ana", (t) => t.kind === "dm" && t.name === "Cy Moss").unread, 1);
  assert.equal(w.submit("ana", "send_message", { thread: g.thread, text: "x".repeat(900) }).ok, true);
  assert.equal(lastText(thread(w, "ana", (t) => t.id === g.thread)).length, 500, "a message is at most 500 characters");
  assert.equal(w.submit("ana", "leave_group", { thread: g.thread }).ok, true);
  assert.equal(thread(w, "ana", (t) => t.id === g.thread), undefined);
});

test("the neighbours' group is everyone whose home is in the neighbourhood; the council is everyone", () => {
  const w = world();
  const hood = thread(w, "ana", (t) => t.kind === "neighbours");
  assert.equal(hood.name, "Marina");
  assert.deepEqual(hood.members.map((x) => x.id).sort(), ["ana", "ben"]);
  assert.equal(thread(w, "cy", (t) => t.kind === "neighbours").name, "Mission");
  for (const pid of ["ana", "ben", "cy"]) assert.ok(thread(w, pid, (t) => t.kind === "council"), pid);
  assert.equal(w.submit("cy", "send_message", { thread: "council", text: "Lower the meters?" }).ok, true);
  assert.equal(thread(w, "ana", (t) => t.kind === "council").unread >= 1, true);
});

test("City Hall: a measure is announced with its vote, answered from the message, and its result posted", () => {
  const w = world();
  const r = w.submit("ben", "propose", { key: "meter_rate_per_hour", value: 2 });
  assert.equal(r.ok, true, r.error);
  const hall = thread(w, "ana", (t) => t.kind === "hall");
  assert.equal(hall.tab, "system");
  assert.match(lastText(hall), /parking meter rate to 2/);
  assert.equal(answer(w, "ana", hall, "Vote yes").ok, true);
  assert.equal(answer(w, "ana", hall, "Vote no").ok, false, "answered once");
  assert.equal(r.measure.votes.ana, true);
  assert.equal(w.submit("ana", "send_message", { thread: "sys:hall", text: "hi" }).ok, false, "official threads take no replies");
  runTo(w, w.now + 5 * 60_000);
  assert.match(lastText(thread(w, "cy", (t) => t.kind === "hall")), /^Passed 2 to 0/);
});

test("a fine arrives as a notice that can be paid from the message; its late penalty and summons follow", () => {
  const w = world();
  const p = w.players.get("ana");
  const bill = w.fine(p, "speeding", "62 in a 25", ["camera"]);
  w.step(w.now + 1000);
  const notes = thread(w, "ana", (t) => t.kind === "notices");
  assert.match(lastText(notes), /^Fine: 62 in a 25/);
  assert.ok(notes.msgs.at(-1).choices.some((c) => c.label === "Contest it"));
  assert.equal(answer(w, "ana", notes, `Pay ${R.fmt(bill.owed)}`).ok, true);
  assert.equal(w.billing.bills.get(bill.id).status, "paid");
  // Another left unpaid: late, then a summons.
  w.ledger.mint("player:ben", m(20_000), "account_grant", { at: w.now });   // the rent paid, so the fine is what is late
  const b2 = w.fine(w.players.get("ben"), "speeding", "Fast on Lombard", ["camera"]);
  runTo(w, b2.due + 2 * DAY);
  for (let i = 0; i < 12 && !w.cases.get(b2.case).summons; i += 1) runTo(w, w.now + 5 * DAY);
  const bn = thread(w, "ben", (t) => t.kind === "notices");
  assert.ok(bn.msgs.some((x) => /^Late: Fast on Lombard/.test(x.text)), "a late notice");
  assert.ok(bn.msgs.some((x) => /^Summons: Fast on Lombard/.test(x.text)), "a summons");
});

test("the lawyer writes as the case goes: taken on, two updates, the day before, the verdict; and knows you better after", () => {
  const w = world();
  const p = w.players.get("ana");
  const bill = w.fine(p, "speeding", "62 in a 25", ["camera"]);
  const c = w.cases.get(bill.case);
  const l = lawyersAt(R, lawOffice, new Set()).find((x) => x.takes.includes("traffic"));
  const price = w.lawyerPrice(p, l, c);
  const r = w.submit("ana", "hire_lawyer", { place: lawOffice, lawyer: l.id, case: c.id, at: at(lawOffice) });
  assert.equal(r.ok, true, r.error);
  let t = thread(w, "ana", (x) => x.kind === "lawyer");
  assert.equal(t.tab, "npc"); assert.equal(t.tag, "Lawyer"); assert.equal(t.name, l.name);
  assert.match(lastText(t), /taken your speeding case/);
  assert.equal(answer(w, "ana", t, "What are my odds?").ok, true);
  assert.match(lastText(thread(w, "ana", (x) => x.kind === "lawyer")), /^Right now I'd say/);
  runTo(w, c.court - 30 * 60_000);
  t = thread(w, "ana", (x) => x.kind === "lawyer");
  const said = t.msgs.filter((x) => x.from === "npc").map((x) => x.text);
  const updates = [...R.messages.lawyer.updates_strong, ...R.messages.lawyer.updates_middling, ...R.messages.lawyer.updates_weak];
  assert.equal(said.filter((x) => updates.includes(x)).length, 2, "two updates");
  assert.equal(new Set(said.filter((x) => updates.includes(x))).size, 2, "not the same one twice");
  assert.ok(said.some((x) => /^Reminder: the hearing is/.test(x)));
  assert.ok(said.some((x) => /^One hour/.test(x)));
  const ch = R.business.law.courthouse;
  const v = w.submit("ana", "attend_court", { case: c.id, at: { x: 0, z: 0, lon: ch.lon, lat: ch.lat } });
  assert.equal(v.ok, true, v.error);
  t = thread(w, "ana", (x) => x.kind === "lawyer");
  assert.equal(t.data.rapport, 1, "a case together");
  assert.ok(lastText(t).length > 10);
  w.submit("ana", "send_message", { thread: t.id, text: "Thank you so much!" });
  assert.equal(thread(w, "ana", (x) => x.kind === "lawyer").data.rapport, 2, "and a thank-you");
  // The next case with the same lawyer: a little off, and a warmer hello.
  const c2 = w.cases.get(w.fine(p, "speeding", "Again", ["camera"]).case);
  assert.ok(w.lawyerPrice(p, l, c2) < price || price === 0);
  w.submit("ana", "hire_lawyer", { place: lawOffice, lawyer: l.id, case: c2.id, at: at(lawOffice) });
  assert.match(lastText(thread(w, "ana", (x) => x.kind === "lawyer")), /^Good to hear from you again/);
});

test("applying: an interviewer's questions, answered from the messages; hired, the interviewer is the boss", () => {
  const w = world();
  const r = w.submit("ben", "apply_job", { role: "barista", place: cafe });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.submit("ben", "apply_job", { role: "barista", place: cafe }).ok, false, "one interview at a time");
  let t = thread(w, "ben", (x) => x.id === r.thread);
  assert.equal(t.tag, "Interviewer");
  for (let i = 0; i < R.messages.interview.asked; i += 1) {
    t = thread(w, "ben", (x) => x.id === r.thread);
    const q = t.msgs.at(-1);
    const best = q.choices.find((c) => R.messages.interview.questions[Object.keys(R.messages.interview.questions).find((k) => R.messages.interview.questions[k].some((x) => x.id === c.act.args.q))]
      .find((x) => x.id === c.act.args.q).a[c.act.args.k][1] === 2);
    assert.equal(w.submit("ben", "answer", { thread: t.id, message: q.id, choice: best.id }).ok, true);
  }
  assert.equal(w.players.get("ben").job, null, "not yet: they will let you know");
  runTo(w, w.now + (R.messages.interview.decide_minutes + 1) * 60_000);
  t = thread(w, "ben", (x) => x.id === r.thread);
  assert.equal(t.tag, "Boss"); assert.equal(t.kind, "boss");
  assert.match(lastText(t), /you've got the job/);
  assert.equal(w.players.get("ben").job.role, "barista");
  // The boss writes before the shift.
  let sh = w.shiftNear(w.players.get("ben").job);
  if (sh.start <= w.now) sh = w.shiftNear(w.players.get("ben").job, sh.end + 1);
  runTo(w, sh.start - 30 * 60_000);
  assert.match(lastText(thread(w, "ben", (x) => x.id === r.thread)), /^Heads up: your shift starts/);
  w.submit("ben", "quit_job");
  w.step(w.now + 1000);
  assert.equal(thread(w, "ben", (x) => x.id === r.thread).tag, "Former boss");
});

test("poor answers are turned down kindly, with a day before trying again", () => {
  const w = world();
  const r = w.submit("cy", "apply_job", { role: "barista", place: cafe });
  for (let i = 0; i < R.messages.interview.asked; i += 1) {
    const t = thread(w, "cy", (x) => x.id === r.thread), q = t.msgs.at(-1);
    const worst = q.choices.find((c) => /Nothing|No reason|Ignore|Wait and hope|Whichever|Not my fault|Keep trying|Yes, it's close|Leave it|Take the long|street|Pour a small/.test(c.label)) || q.choices[q.choices.length - 1];
    w.submit("cy", "answer", { thread: t.id, message: q.id, choice: worst.id });
  }
  runTo(w, w.now + (R.messages.interview.decide_minutes + 1) * 60_000);
  const t = thread(w, "cy", (x) => x.id === r.thread);
  assert.equal(t.tag, "Interviewer");
  assert.match(lastText(t), /gone with someone else/);
  assert.equal(w.submit("cy", "apply_job", { role: "barista", place: cafe }).ok, false, "not again today");
});

test("the cab driver: on the way, at the kerb, about to go; asked, waits a minute more, once", () => {
  const w = world();
  assert.equal(w.submit("ana", "ride_note", { note: "coming", minutes: 3 }).ok, true);
  const t0 = thread(w, "ana", (x) => x.kind === "driver");
  assert.equal(t0.tag, "Cab driver");
  assert.match(lastText(t0), /about 3 min/);
  w.submit("ana", "ride_note", { note: "here", seconds: 90 });
  let t = thread(w, "ana", (x) => x.kind === "driver");
  assert.equal(t.id, t0.id, "the same driver for the ride");
  assert.equal(answer(w, "ana", t, R.messages.driver.wait_ask).ok, true);
  assert.equal(w.rideState("ana").extend, true);
  w.submit("ana", "ride_note", { note: "leaving", seconds: 20 });
  t = thread(w, "ana", (x) => x.kind === "driver");
  assert.equal(answer(w, "ana", t, R.messages.driver.wait_ask).ok, false, "once a ride");
  assert.equal(w.submit("ana", "ride_note", { note: "made up" }).ok, false);
  w.submit("ana", "ride_note", { note: "coming", minutes: 2 });
  assert.notEqual(w.rideState("ana").ride, 1, "a new ride, a new driver's thread");
});

test("a choice runs only the actions choices may run", () => {
  const w = world();
  const t = w.openThread("x", () => ({ tab: "players", kind: "dm", members: ["ana"] }));
  const msg = w.post(t, { text: "?", choices: [{ id: "a", label: "Give money", act: { cmd: "give_money", args: { to: "ben", amount: m(100) } } }] });
  const r = w.submit("ana", "answer", { thread: "x", message: msg.id, choice: "a" });
  assert.equal(r.ok, false); assert.match(r.error, /can not be done from a message/);
});

test("jury duty: a summons now and then, deferred once, served at the court for the juror's fee", () => {
  const w = world();
  const p = w.players.get("ana");
  const bill = w.fine(w.players.get("ben"), "speeding", "Fast", ["camera"]);
  const c = w.cases.get(bill.case);
  c.court = w.courtTime(5, c.id);
  runTo(w, w.now + 3 * DAY);
  const notes = thread(w, "ana", (t) => t.kind === "notices");
  const summons = notes.msgs.find((x) => /^Jury summons/.test(x.text));
  assert.ok(summons, "summoned to Ben's hearing");
  assert.match(summons.text, /Ben Ito/);
  assert.equal(answer(w, "ana", notes, "Ask to defer a week").ok, true);
  const s = p.jury[0];
  assert.ok(s.at > c.court, "a week later");
  w.now = s.at + HOUR;
  const ch = R.business.law.courthouse;
  assert.equal(w.submit("ana", "serve_jury", { summons: s.id, at: at(cafe) }).ok, false, "at the court");
  const before = w.ledger.balance(p.account);
  const r = w.submit("ana", "serve_jury", { summons: s.id, at: { x: 0, z: 0, lon: ch.lon, lat: ch.lat } });
  assert.equal(r.ok, true, r.error);
  assert.equal(w.ledger.balance(p.account) - before, R.business.law.jury.fee_base);
  assert.equal(w.submit("ana", "serve_jury", { summons: s.id, at: { x: 0, z: 0, lon: ch.lon, lat: ch.lat } }).ok, false, "once");
  w.ledger.check();
});

test("the day in Kerbside: at the turn of the day, what happened", () => {
  const w = world();
  w.fine(w.players.get("ben"), "speeding", "Fast", ["camera"]);
  w.submit("ben", "propose", { key: "meter_rate_per_hour", value: 3 });
  runTo(w, w.now + DAY);
  const d = thread(w, "cy", (t) => t.kind === "daily");
  assert.ok(d, "posted");
  assert.match(d.msgs[0].text, /^Kerbside, \w{3}: the day in the city/);
  assert.match(d.msgs[0].text, /Fines issued: 1/);
  assert.match(d.msgs[0].text, /parking meter rate is now 3|stays/);
});

test("messages are saved and loaded with the world", () => {
  const w = world();
  w.submit("ana", "add_friend", { player: "ben" });
  w.submit("ben", "add_friend", { player: "ana" });
  w.submit("ana", "send_message", { to: "ben", text: "saved?" });
  const back = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.deepEqual(back.inbox("ben").friends.map((f) => f.id), ["ana"]);
  assert.equal(lastText(thread(back, "ben", (t) => t.kind === "dm")), "saved?");
  assert.equal(back.submit("ben", "send_message", { to: "ana", text: "yes" }).ok, true);
});
