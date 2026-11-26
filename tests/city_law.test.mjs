// Crime and getting caught (law.mjs): nothing is charged until a camera, an officer or a witness's
// call that gets through brings it in; who calls is weighed by how bad it was; a call sends the
// nearest patrol; a stop is a citation or an arrest; driving off, the plate is read; lost, a
// victim may still name you. And phones are sold at the Apple Store and online.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRules, shopKinds, storesAt } from "../docs/city/core.mjs";
import { CityWorld } from "../docs/city/world.mjs";
import { callPlan, callStep, chargeSeverity, crimeOf, pickUnit, pursuitStep, reportOdds, sirenSpeed, spectatorsFor, stopOutcome } from "../docs/city/law.mjs";
import { alongTrail, barFlash } from "../docs/city/police.mjs";
import { temperamentOf } from "../docs/city/temperament.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const AT = { x: 0, z: 0, lon: -122.437, lat: 37.80 };
const world = () => { const w = new CityWorld(R, { now: Date.UTC(2026, 10, 25, 20), seed: "law" }); w.submit("me", "join", { name: "Pat", at: AT }); return w; };
const run = (plan, s, ctx = {}) => { for (let t = 0; t < s; t += 0.1) callStep(R, plan, 0.1, ctx); return plan; };

test("who calls is weighed by how bad it was: almost nobody reports speeding; the one you beat up always does", () => {
  const people = Array.from({ length: 4000 }, (_, i) => temperamentOf({ id: `p${i}`, age: 18 + (i % 60) }));
  const share = (crime, role = "bystander") => people.filter((t, i) => callPlan(R, crime, { role, temperament: t, seed: `${crime}:${i}` }).calls).length / people.length;
  assert.ok(share("speeding") < 0.02, `speeding ${share("speeding")}`);
  assert.ok(share("battery") > 0.35 && share("battery") < 0.8, `battery ${share("battery")}`);
  assert.ok(share("assault") > share("battery") && share("attempted_murder") > 0.9);
  assert.equal(share("battery", "victim"), 1, "a victim of a beating always calls");
  assert.ok(reportOdds(R, "car_theft", { alarm: true }) > reportOdds(R, "car_theft"), "an alarm draws calls");
  // The more civic, the likelier.
  assert.ok(reportOdds(R, "battery", { temperament: { civic: 0.95, care: 0.9 } }) > reportOdds(R, "battery", { temperament: { civic: 0.1, care: 0.2 } }));
});

test("a call: the phone out, then 911 for ten seconds -- cut short, it never got through; the victim waits until you have gone", () => {
  const p = callPlan(R, "battery", { role: "bystander", temperament: { civic: 1, care: 1, nerve: 1 }, seed: "x" });
  assert.ok(p.calls);
  run(p, p.phone_out_s + 9, { attacker_m: 30 });
  assert.equal(p.state, "talking", "nine seconds on the phone is not enough");
  run(p, 1.2, { attacker_m: 30 });
  assert.equal(p.state, "reported");
  // You come at them while they talk: cut off, and they start over.
  const q = callPlan(R, "battery", { role: "bystander", temperament: { civic: 1, care: 1 }, seed: "y" });
  run(q, q.phone_out_s + 6, { attacker_m: 30 });
  assert.equal(q.state, "talking");
  callStep(R, q, 0.1, { attacker_m: 1.5 });
  assert.equal(q.state, "phone"); assert.equal(q.talked_s, 0); assert.equal(q.cut, 1);
  // The one you hit, who squared up to you first: they wait until you have gone.
  const v = callPlan(R, "battery", { role: "victim", fought: true, seed: "v" });
  run(v, 30, { attacker_m: 5 });
  assert.equal(v.state, "waiting");
  run(v, v.phone_out_s + 10.5, { attacker_m: 40 });
  assert.equal(v.state, "reported");
});

test("the car sent: the nearest patrol from where it is (not one already busy), else the station's; faster than the traffic", () => {
  const cars = [{ id: "a", x: 500, z: 0 }, { id: "b", x: 120, z: 50 }, { id: "c", x: 90, z: 10 }];
  assert.equal(pickUnit(cars, { x: 0, z: 0 }).id, "c");
  assert.equal(pickUnit(cars, { x: 0, z: 0 }, null, new Set(["c"])).id, "b");
  assert.equal(pickUnit([], { x: 0, z: 0 }, { x: 900, z: 0 }).from, "station");
  for (const limit of [11.2, 13.4, 15.6]) assert.ok(sirenSpeed(R, limit) > limit, "faster than the traffic");
  assert.ok(sirenSpeed(R, 60) <= R.law.dispatch.siren_ms[1]);
});

test("the chase: the plate read close behind; pulled over and stopped; caught on foot; lost when far", () => {
  const P = () => ({ t: 0, plate_s: 0, far_s: 0, still_s: 0 });
  let p = P(), ev = null;
  for (let t = 0; t < 2 && !ev; t += 0.1) ev = pursuitStep(R, p, 0.1, { gap_m: 18, driving: true, speed: 20, sees: true });
  assert.equal(ev, "plate");
  p = P(); ev = null;
  for (let t = 0; t < 4 && !ev; t += 0.1) ev = pursuitStep(R, p, 0.1, { gap_m: 40, driving: true, speed: 20, sees: true });
  assert.equal(ev, null, "too far back to read it");
  p = P(); ev = null;
  for (let t = 0; t < 4 && !ev; t += 0.1) ev = pursuitStep(R, p, 0.1, { gap_m: 12, driving: true, speed: 0.2, sees: true });
  assert.equal(ev, "pulled_over");
  assert.equal(pursuitStep(R, P(), 0.1, { gap_m: 1.0, driving: false, speed: 2, sees: true }), "caught");
  p = P(); ev = null;
  for (let t = 0; t < 10 && !ev; t += 0.1) ev = pursuitStep(R, p, 0.1, { gap_m: 300, driving: true, speed: 30, sees: false });
  assert.equal(ev, "lost");
  assert.equal(stopOutcome(R, [{ crime: "speeding" }]), "cite");
  assert.equal(stopOutcome(R, [{ crime: "speeding" }], { resisting: true }), "arrest");
  assert.equal(stopOutcome(R, [{ crime: "battery" }]), "arrest");
  // The trail a pursuer follows, and the bar's flash (one side at a time).
  const at = alongTrail([[0, 0], [10, 0], [10, 10]], [0, 10, 20], 15);
  assert.deepEqual([at.x, at.z], [10, 5]);
  for (let t = 0; t < 2; t += 0.05) { const [r, b] = barFlash(t); assert.ok(!(r && b)); }
});

test("a blow is not charged when done -- only when caught: a call that gets through, then the stop", () => {
  const w = world();
  const blow = w.submit("me", "strike_person", { npc: { id: "npc:v", name: "Val", role: "barista", x: 1, z: 0 }, witnesses: 3 });
  assert.ok(blow.ok, blow.error);
  assert.equal(blow.fine, 0);
  assert.equal(w.billing.open(w.players.get("me").account).length, 0, "nothing owed for it yet");
  assert.equal(blow.offence.crime, "battery");
  // A call cut short is no report.
  assert.equal(w.submit("me", "report_crime", { offence: blow.offence.id, by: { kind: "witness" }, call_s: 6 }).ok, false);
  const rep = w.submit("me", "report_crime", { offence: blow.offence.id, by: { kind: "victim", name: "Val" }, call_s: 10 });
  assert.ok(rep.ok && rep.dispatch, "a patrol is sent");
  // Arrested: the fine, a court date (a summons), on the record, home.
  const stop = w.submit("me", "police_stop", { offences: [blow.offence.id], outcome: "arrest", officer: { name: "Chen" } });
  assert.ok(stop.ok, stop.error);
  assert.equal(stop.outcome, "arrest");
  assert.equal(stop.fines[0].amount, R.fines.battery);
  assert.ok(stop.court > w.now);
  const p = w.players.get("me");
  assert.ok(p.record.some((l) => l.outcome === "arrested"));
  const c = [...w.cases.values()].find((x) => x.pid === "me");
  assert.ok(c.summons && c.arrested && c.court === stop.court);
  // Not twice.
  assert.equal(w.submit("me", "police_stop", { offences: [blow.offence.id], outcome: "arrest" }).ok, false);
  // Speeding alone is no arrest.
  const sp = w.submit("me", "speed_camera", { over_mph: 20, mph: 45, witness: { kind: "police", id: "veh:p" } });
  assert.ok(sp.ok && sp.pursuit && sp.charged === 0, "a patrol car comes after you; nothing by post");
  assert.equal(w.submit("me", "police_stop", { offences: [sp.offence.id], outcome: "arrest" }).ok, false);
  assert.ok(w.submit("me", "police_stop", { offences: [sp.offence.id], outcome: "cite" }).fines[0].amount > 0);
});

test("driving off: the plate read is the fine by post and evading, a summons; lost, a victim still names you", () => {
  const w = world();
  const off = w.offence(w.players.get("me"), "car_theft", { memo: "taking a car", vehicle: { plate: "7ABC123" } });
  const r = w.submit("me", "plate_read", { offences: [off.id], officer: { name: "Park" } });
  assert.ok(r.ok, r.error);
  assert.ok(r.fines.some((f) => f.kind === "evading") && r.court > w.now);
  const w2 = world();
  const b = w2.submit("me", "strike_person", { npc: { id: "npc:q", name: "Quinn", role: "clerk", x: 1, z: 0 } });
  w2.submit("me", "report_crime", { offence: b.offence.id, by: { kind: "victim", name: "Quinn" }, call_s: 11 });
  const lost = w2.submit("me", "police_lost", { offences: [b.offence.id] });
  assert.ok(lost.ok && lost.named.length === 1 && lost.named[0].court, "named by the victim: a summons");
  // A speeding report by a bystander with the plate: a notice by post, no patrol.
  const w3 = world();
  const sp = w3.submit("me", "speed_camera", { over_mph: 15, mph: 40, witness: { kind: "bystander", id: "street" } });
  const mail = w3.submit("me", "report_crime", { offence: sp.offence.id, by: { kind: "witness" }, call_s: 10, plate: "8XYZ999" });
  assert.ok(mail.ok && mail.mailed > 0 && !mail.dispatch);
  // A camera still sends its notice by post at once.
  const cam = w3.submit("me", "speed_camera", { over_mph: 15, mph: 40, camera: "cam:1", witness: { kind: "camera", id: "cam:1" } });
  assert.ok(cam.ok);
});

test("in court: the hearing opened with you present, then concluded -- the verdict and its sentence carried out", () => {
  const w = world();
  const b = w.submit("me", "strike_person", { npc: { id: "npc:j", name: "Jo", role: "clerk", x: 1, z: 0 } });
  w.submit("me", "report_crime", { offence: b.offence.id, by: { kind: "victim" }, call_s: 10 });
  const stop = w.submit("me", "police_stop", { offences: [b.offence.id], outcome: "arrest" });
  const c = [...w.cases.values()].find((x) => x.pid === "me");
  // The summons in the messages carries the way to the courthouse.
  w.noticeStep();
  const notes = [...w.mail.threads.values()].flatMap((t) => t.msgs || []).filter((m) => m.ui?.court === c.id);
  assert.ok(notes.length === 1 && /link below/.test(notes[0].text), "a summons with the courthouse link");
  const s = w.submit("me", "court_session", { case: c.id });
  assert.ok(s.ok, s.error);
  assert.ok(s.file.script.length >= 4 && s.file.judge && s.severity >= 4);
  assert.equal(w.players.get("me").in_court.case, c.id);
  const v = w.submit("me", "court_conclude", { case: c.id });
  assert.ok(v.ok, v.error);
  assert.ok(["guilty", "not_guilty", "lesser"].includes(v.verdict) && v.name);
  assert.ok(w.cases.get(c.id).closed, "the case is closed");
  assert.equal(w.players.get("me").in_court, null);
  assert.ok(stop.court);
});

test("how grave a hearing is fills the gallery: nobody for a ticket, a full house for leaving someone for dead", () => {
  assert.equal(spectatorsFor(R, 1, "s"), 0);
  assert.ok(spectatorsFor(R, 4, "s") > 5 && spectatorsFor(R, 4, "s") < 25);
  assert.ok(spectatorsFor(R, 6, "s") > 45);
  assert.ok(spectatorsFor(R, 6, "s", 40) <= 40);
  assert.equal(chargeSeverity(R, "speeding"), 1);
  assert.equal(chargeSeverity(R, "attempted_murder"), 6);
  assert.equal(chargeSeverity(R, "hit_and_run"), 2);
  for (const k of Object.keys(R.law.crimes)) { const c = crimeOf(R, k); assert.ok(R.fines[c.fine] > 0, `${k}: a fine of ${c.fine}`); }
});

test("phones: the Apple Store sells them, and the online store has them (at its markup)", () => {
  assert.deepEqual(shopKinds(R, "shop", "Apple Store"), ["phone_store"]);
  assert.ok(storesAt(R, ["shop:phone_store"])[0].items.includes("smartphone"));
  const w = world();
  w.ledger.mint(w.players.get("me").account, R.money ? R.money(5000) : 500_000, "public_contract", { kind: "test", memo: "t", at: w.now });
  const r = w.submit("me", "buy_online", { item: "smartphone" });
  assert.ok(r.ok, r.error);
  assert.equal(r.price, R.items.smartphone.price * R.online_store.markup);
  assert.equal(w.players.get("me").inventory.smartphone, 1);
});

test("only someone with a phone on them calls 911, and those who carry one call more readily than the street's average", () => {
  const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
  const calls = (phone) => { let n = 0; for (let i = 0; i < 4000; i += 1) if (callPlan(R, "battery", { role: "bystander", seed: `w${i}`, phone }).calls) n += 1; return n / 4000; };
  assert.equal(calls(false), 0);
  const avg = calls(null), carried = calls(true);
  assert.ok(carried > avg * 1.15 && carried < avg * 1.45, `${avg} -> ${carried}`);
  // A victim with no phone cannot call either; one with a phone calls at the victim's own rate.
  assert.equal(callPlan(R, "battery", { role: "victim", seed: "v", phone: false }).calls, false);
  assert.equal(callPlan(R, "battery", { role: "victim", seed: "v", phone: true }).odds, 1);
});
