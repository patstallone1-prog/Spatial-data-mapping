// Crime and getting caught (2026-11-24).
//
// Nothing you do is charged because you did it. It is charged when it is caught (rules.json law):
//
//   a camera      with it in its view (the speed cameras: enforcement.mjs) -- a notice by post;
//   an officer    who sees it, near, or arrives at a call and finds you -- you are stopped;
//   a witness     who gets out their phone and talks to 911 for ``call_s`` seconds (10). Cut short
//                 -- you come back at them, they lose their nerve -- and the police never hear of it.
//
// Who calls is weighed by how bad it was: a bystander almost never reports speeding; someone you
// beat up calls once you have gone, even after squaring up to you first. A call sends the nearest
// patrol car from wherever it is (the city's own, on their rounds), siren on, faster than the
// traffic; at the scene it looks for you. On foot, an officer runs you down. Driving, it follows:
// pull over and you are cited, or -- an arrestable crime -- handcuffed, put in the back and taken
// in; drive off and an officer close enough reads your plate (evading, a summons on top), or loses
// you. A victim who saw your face can still name you: a summons by their statement.
//
// The offences themselves are the world's record (offence: what, where, against whom, when);
// ``cmd_report_crime`` / ``cmd_police_stop`` / ``cmd_plate_read`` / ``cmd_police_lost`` are how a
// witness, a camera or an officer bring one to the court. Pure parts: crimeOf, reportOdds,
// callPlan, callStep, pickUnit, sirenSpeed, pursuitStep, stopOutcome, spectatorsFor.
// Tests: tests/city_law.test.mjs.
import { rng } from "./people.mjs";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const LAW_COMMANDS = ["report_crime", "police_stop", "plate_read", "police_lost", "court_session", "court_conclude"];

//: A crime's rules (rules.json law.crimes) with its kind, or null.
export function crimeOf(R, kind) { const c = R.law?.crimes?.[kind]; return c ? { kind, ...c } : null; }

//: How likely ``role`` ("victim" | "bystander") is to report ``crime`` to 911: the crime's own
//: weight, a bystander's tilted by how civic and caring they are (temperament.mjs), raised where
//: something drew attention to it (an alarm, a crash's noise). A victim of something done to them
//: reports at its own rate, whatever their temperament: they were the one hurt.
export function reportOdds(R, crime, { role = "bystander", temperament = null, alarm = false } = {}) {
  const c = typeof crime === "string" ? crimeOf(R, crime) : crime;
  if (!c) return 0;
  if (role === "victim") return clamp(c.victim ?? 0, 0, 1);
  const t = temperament || { civic: 0.5, care: 0.5, nerve: 0.5 };
  const lean = 0.55 + 0.9 * ((t.civic ?? 0.5) - 0.5) + 0.35 * ((t.care ?? 0.5) - 0.5) + 0.45;
  return clamp((c.bystander ?? 0) * lean * (alarm ? 1.6 : 1), 0, 1);
}

//: A witness's call, planned once (the same for them every time): whether they call at all
//: (``u`` against reportOdds), how long getting the phone out takes, and whether -- a victim who
//: fought back, or one standing near you -- they wait until you have gone first.
//: ``phone``: whether they carry one (npc-figures.mjs: a pocket to keep it in): without one they
//: cannot call; with one, a bystander calls ``law.phone_lean`` times as readily as the street's
//: average (unknown, null: the average).
export function callPlan(R, crime, { role = "bystander", temperament = null, alarm = false, fought = false, seed = "", phone = null } = {}) {
  const r = rng("call", seed), L = R.law;
  const odds = phone === false ? 0 : clamp(reportOdds(R, crime, { role, temperament, alarm }) * (phone && role !== "victim" ? L.phone_lean ?? 1 : 1), 0, 1);
  const calls = r() < odds;
  const [a, b] = L.phone_out_s;
  return { calls, odds, role, phone_out_s: a + r() * (b - a), wait_gone: role === "victim" || fought, talked_s: 0, state: calls ? "waiting" : "none", t: 0 };
}

//: A call, a step on: "waiting" (for you to go, if they wait), "phone" (getting it out),
//: "talking" (on to 911: ``call_s`` of it gets through), "reported", or "cut" (put away: you
//: came at them, or they were hit again; a cut call starts over from the phone). ``ctx``:
//: {attacker_m: how far you are, harmed: struck again this moment}.
export function callStep(R, call, dt, { attacker_m = Infinity, harmed = false } = {}) {
  const L = R.law;
  if (!call || call.state === "none" || call.state === "reported") return call;
  call.t += dt;
  const close = attacker_m < 2.6;
  if (harmed || (close && call.state === "talking")) { call.state = "phone"; call.talked_s = 0; call.t = 0; call.cut = (call.cut || 0) + 1; return call; }
  if (call.state === "waiting") { if (!call.wait_gone || attacker_m > L.victim_waits_m) { call.state = "phone"; call.t = 0; } return call; }
  if (call.state === "phone") { if (!close && call.t >= call.phone_out_s) { call.state = "talking"; call.talked_s = 0; } return call; }
  if (call.state === "talking") { call.talked_s += dt; if (call.talked_s >= L.call_s) call.state = "reported"; }
  return call;
}

//: The unit sent to ``at``: the nearest patrol car of the city's on its rounds (``units``: [{id,
//: x, z}]), else one out of the district's station (``station``: {x, z}). Never one already busy.
export function pickUnit(units, at, station = null, busy = new Set()) {
  let best = null;
  for (const u of units || []) {
    if (!u || busy.has(u.id) || u.wrecked) continue;
    const d = Math.hypot(u.x - at.x, u.z - at.z);
    if (!best || d < best.d) best = { ...u, d, from: "patrol" };
  }
  if (best) return best;
  return station ? { id: "patrol:station", x: station.x, z: station.z, d: Math.hypot(station.x - at.x, station.z - at.z), from: "station" } : null;
}

//: How fast a car with its siren on goes on a street whose limit is ``limit_ms``: the traffic's
//: pace times the dispatch's factor, inside its bounds (rules.json law.dispatch.siren_ms).
export function sirenSpeed(R, limit_ms) {
  const D = R.law.dispatch, [lo, hi] = D.siren_ms;
  return clamp((limit_ms || 11) * D.traffic_factor, lo, hi);
}

//: A pursuit, a step on. ``P``: {t, plate_s, far_s, still_s}; ``s``: {gap_m (officer to you),
//: driving, speed (yours, m/s), sees (in sight)}. What came of it: "plate" (read, once), "lost",
//: "pulled_over" (stopped near them), "caught" (on foot, a hand on you) -- or null.
export function pursuitStep(R, P, dt, s) {
  const Q = R.law.pursuit;
  P.t += dt;
  if (s.driving) {
    if (s.sees && s.gap_m <= Q.plate_m && s.speed > 1) P.plate_s += dt;
    if (!P.plate && P.plate_s >= Q.plate_s) { P.plate = true; return "plate"; }
    if (s.speed < Q.pull_over_ms && s.gap_m < 45) P.still_s += dt; else P.still_s = 0;
    if (P.still_s >= Q.pull_over_s) return "pulled_over";
  } else if (s.gap_m <= Q.catch_m) return "caught";
  if (s.gap_m > Q.lose_m || !s.sees) P.far_s += dt; else P.far_s = Math.max(0, P.far_s - dt);
  if (P.far_s >= Q.lose_s || P.t >= Q.give_up_s) return "lost";
  return null;
}

//: What a stop comes to: an arrest for anything arrestable (or for running), else a citation.
export function stopOutcome(R, offences, { resisting = false } = {}) {
  return resisting || offences.some((o) => crimeOf(R, o.crime)?.arrestable) ? "arrest" : "cite";
}

//: How many come to watch a hearing (none for a ticket, a full house for a killing), out of
//: ``seats``, the same for a case every time.
export function spectatorsFor(R, severity, seed, seats = Infinity) {
  const S = R.law.spectators, base = S.by_severity[clamp(Math.round(severity), 0, S.by_severity.length - 1)] || 0;
  if (!base) return 0;
  const u = rng("gallery", seed)();
  return Math.min(seats, Math.max(0, Math.round(base * (1 - S.spread + 2 * S.spread * u))));
}

//: How grave a charge is (its crime's severity; a traffic charge 1).
export function chargeSeverity(R, charge) {
  for (const c of Object.values(R.law?.crimes || {})) if (c.fine === charge || c.fled === charge) return c.severity;
  return R.business?.law?.charges?.[charge] === "criminal" ? 3 : 1;
}

// ---- the world's part --------------------------------------------------------------------------
export function installLaw(CityWorld, CityError) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };
  const life = (w) => (w.R.law.offence_life_min ?? 180) * 60_000;
  const openOf = (w, p) => { const now = w.now; p.offences = (p.offences || []).filter((o) => !o.closed && now - o.at < life(w)); return p.offences; };
  const named = (w, p, ids) => { const all = openOf(w, p); const out = (ids || []).map((id) => all.find((o) => o.id === id)).filter(Boolean); if (!out.length) fail("no such offence of yours"); return out; };

  //: An offence done: kept (the last 20, a few game hours) until it is caught, or forgotten.
  //: ``data``: {npc: {id, name}, vehicle: {id, plate, owner}, x, z, memo, injury, care_bill, alarm}.
  W.offence = function (p, crime, data = {}) {
    const c = crimeOf(this.R, crime);
    if (!c) throw new CityError(`no such crime: ${crime}`);
    const o = { id: this.id("off"), crime, severity: c.severity, at: this.now, x: data.x ?? p.x ?? 0, z: data.z ?? p.z ?? 0,
      npc: data.npc ? { id: data.npc.id, name: data.npc.name || null, role: data.npc.role || null } : null,
      vehicle: data.vehicle ? { id: data.vehicle.id || null, plate: data.vehicle.plate || null, owner: data.vehicle.owner || null } : null,
      memo: data.memo || c.label, care_bill: data.care_bill || 0, alarm: Boolean(data.alarm), reported: null, closed: null };
    (p.offences ||= []).push(o);
    if (p.offences.length > 20) p.offences.shift();
    this.log("offence", { player: p.id, crime, severity: c.severity });
    return o;
  };
  //: Charged: its fine (a case: pay, contest, a lawyer), the care of whoever was hurt billed to you.
  W.charge = function (p, o, evidence, { fled = false, payer = null } = {}) {
    const c = crimeOf(this.R, o.crime), kind = fled && c.fled ? c.fled : c.fine;
    const bill = this.fine(p, kind, `${o.memo[0].toUpperCase()}${o.memo.slice(1)}${o.npc?.name ? ` (${o.npc.name})` : ""}${o.vehicle?.plate ? ` (${o.vehicle.plate})` : ""}`, evidence, `crime:${o.id}`, payer);
    if (o.care_bill > 0) this.billing.issue({ payer: payer || p.account, payee: "business:hospital", kind: "restitution", amount: o.care_bill, memo: `Care for ${o.npc?.name || "the one hurt"}`, at: this.now, due_days: 30, penalties: [Math.round(o.care_bill * 0.1)], key: `crime:${o.id}:care` });
    o.closed = this.now; o.bill = bill.id;
    return bill;
  };
  //: A court date for a case ``days`` on, as a summons.
  const summon = (w, bill, days) => { const c = w.cases.get(bill.case); if (!c) return null; c.court = Math.max(c.court || 0, w.courtTime(days, c.id)); c.summons = true; bill.due = Math.max(bill.due, c.court + DAY); return c; };

  //: Brought to the police: by a witness who got through (``call_s``, at least the law's), a
  //: victim, a camera, or an officer who saw it. ``plate``: the plate they read. What comes of it:
  //: a notice by post (a traffic matter with the plate known: the fine, nothing more) or a patrol
  //: sent ({dispatch: true}).
  W.cmd_report_crime = function (pid, { offence, by = {}, call_s = 0, plate = null }) {
    const p = this.player(pid), [o] = named(this, p, [offence]), L = this.R.law, c = crimeOf(this.R, o.crime);
    if (!["witness", "victim", "camera", "police"].includes(by.kind)) fail("who saw it?");
    if ((by.kind === "witness" || by.kind === "victim") && !(call_s >= L.call_s)) fail("the call did not get through");
    if (o.reported) return { offence: o.id, already: true, dispatch: false };
    o.reported = { by: by.kind, name: by.name || null, at: this.now, plate: Boolean(plate && c.plate) };
    this.log("reported", { player: pid, crime: o.crime, by: by.kind });
    if (o.reported.plate && c.severity <= 2 && by.kind !== "police") {
      const v = o.vehicle?.id ? this.registry.get?.(o.vehicle.id) : null;
      const bill = this.charge(p, o, [by.kind === "camera" ? "camera" : `${by.kind === "victim" ? "the other driver" : "a witness"}'s report of the plate`], { payer: v?.owner || null });
      return { offence: o.id, dispatch: false, mailed: bill.amount, bill: bill.id };
    }
    return { offence: o.id, dispatch: by.kind === "police" || c.severity >= L.dispatch.from_severity };
  };
  //: Stopped by an officer: each offence cited; arrested for an arrestable one (or for running):
  //: booked, a court date set, and home. ``resisting``: you drove or ran off first.
  W.cmd_police_stop = function (pid, { offences = [], outcome = "cite", resisting = false, officer = null }) {
    const p = this.player(pid), list = named(this, p, offences), L = this.R.law;
    const want = stopOutcome(this.R, list, { resisting });
    if (outcome === "arrest" && want !== "arrest") fail("nothing there to arrest you for");
    const who = officer?.name ? `Officer ${officer.name}` : "the arresting officer";
    const bills = list.map((o) => this.charge(p, o, [`${who}'s report`, ...(o.reported?.by === "victim" ? ["the victim's statement"] : o.reported?.by === "witness" ? ["witness"] : [])]));
    if (resisting) bills.push(this.fine(p, "evading", "Evading a police officer", [`${who}'s report`, "the pursuit's record"], `evading:${pid}:${Math.floor(this.now / 60000)}`));
    let court = null;
    if (want === "arrest" || outcome === "arrest") {
      for (const b of bills) { const c = summon(this, b, L.arrest.court_days); if (c) { c.arrested = true; court = court ? Math.min(court, c.court) : c.court; } }
      (p.record ||= []).push({ charge: list.map((o) => crimeOf(this.R, o.crime).fine).join(", "), class: "criminal", outcome: "arrested", at: this.now });
      if (p.driving) p.driving = null;
      this.log("arrest", { player: pid, offences: list.map((o) => o.crime) });
    }
    return { outcome: want, fines: bills.map((b) => ({ bill: b.id, kind: b.kind, amount: b.amount })), total: bills.reduce((s, b) => s + b.amount, 0), court, home: p.home ? { building: p.home.building ?? null, x: p.home.x ?? null, z: p.home.z ?? null } : null };
  };
  //: You drove off, and an officer read the plate: each offence by post to the plate's owner, and
  //: evading on top -- a summons to court.
  W.cmd_plate_read = function (pid, { offences = [], officer = null }) {
    const p = this.player(pid), list = named(this, p, offences), L = this.R.law;
    const car = p.driving?.vehicle ? this.registry.get(p.driving.vehicle) : null, payer = car?.owner || null;
    const who = officer?.name ? `Officer ${officer.name}` : "a patrol officer";
    const bills = list.map((o) => this.charge(p, o, [`${who} read the plate`], { fled: true, payer }));
    const evading = this.fine(p, "evading", `Evading a police officer${car?.attrs?.plate ? ` (${car.attrs.plate})` : ""}`, [`${who} read the plate`, "the pursuit's record"], `evading:${pid}:${Math.floor(this.now / 60000)}`, payer);
    const c = summon(this, evading, this.R.business.law.summons_days);
    return { fines: [...bills, evading].map((b) => ({ bill: b.id, kind: b.kind, amount: b.amount })), court: c?.court ?? null };
  };
  //: They lost you. A victim who saw your face names you (a summons by their statement); the rest
  //: is left unsolved.
  W.cmd_police_lost = function (pid, { offences = [] }) {
    const p = this.player(pid), list = named(this, p, offences), out = [];
    for (const o of list) {
      if (o.npc && o.reported?.by === "victim" && o.severity >= 3) { const b = this.charge(p, o, ["the victim's statement"]); const c = summon(this, b, this.R.business.law.summons_days); out.push({ bill: b.id, amount: b.amount, court: c?.court ?? null }); }
      else o.closed = this.now;
    }
    return { named: out };
  };

  // ---- in the courtroom ----------------------------------------------------------------------
  //: Into court for a hearing of yours: any time from the summons to three hours after its date
  //: (attend_hours), wherever you were (the courthouse is out of the district: you are taken there). The trial
  //: opens with you present; what is shown (the trial's file) is played in the room.
  W.cmd_court_session = function (pid, { case: cid }) {
    const p = this.player(pid), L = this.R.business.law, c = this.caseOf(p, cid);
    if (!c.court) fail("that case has no court date");
    // (Any time from the summons to the hearing's end: you are heard when you come.)
    const [, to] = L.attend_hours;
    if (this.now > c.court + to * HOUR) fail("the hearing has been held");
    c.present = true;
    if (!c.trial) { c.court = Math.min(c.court, this.now); this.trialStep(false); }
    const t = this.trials?.get(c.trial);
    if (!t) fail("the court could not open the case");
    p.in_court = { case: c.id, trial: t.id, since: this.now };
    return { case: c.id, trial: t.id, charge: t.charge, severity: chargeSeverity(this.R, t.charge), file: { judge: t.file.judge, prosecutor: t.file.prosecutor, defence: t.file.defence, accused: t.file.accused, charge: t.file.charge, script: t.file.script, exhibits: t.file.exhibits.map((e) => ({ id: e.id, side: e.side, title: e.title })) } };
  };
  //: The hearing heard: the jury in the room goes out, comes back, and the judge rules (trial.mjs
  //: rule: any juror of the city's who has given a verdict counts; the bench on the evidence
  //: otherwise), and the sentence is carried out.
  W.cmd_court_conclude = function (pid, { case: cid }) {
    const p = this.player(pid), c = this.cases.get(cid);
    if (!c || c.pid !== pid) fail("not your case");
    const t = this.trials?.get(c.trial);
    if (!t) fail("there is no trial to conclude");
    const v = this.rule(t);
    p.in_court = null;
    const bill = this.billing.bills.get(c.bill);
    return { verdict: v.verdict, by: v.by, outcome: v.outcome, name: v.name, owed: bill && bill.status === "open" ? bill.owed : 0, released: p.released || null, record: (p.record || []).slice(-3) };
  };
}
