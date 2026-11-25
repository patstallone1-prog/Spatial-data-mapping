// A trial by jury, held in your messages (2026-11-22).
//
// A summons goes only to someone who is in the city now, and the case is open to them at once:
// from that moment to six hours on (real hours), no appointment days ahead. Opening it shows the
// trial as a conversation of its own:
//
//   the judge        names the case, the charge and the burden of proof;
//   the prosecutor   opens and puts in the People's exhibits -- a camera still, an officer's
//                    report, a witness's statement, a record of what was lost;
//   the witnesses    say what they saw;
//   the defence      answers with its own exhibits -- a receipt for somewhere else, the camera's
//                    service record, someone who was with the accused;
//   the accused      says their piece.
//
// Each exhibit is a link in the message: it opens on the page as a picture (exhibitSvg). You may
// put questions to either side (each is answered in the thread), then vote: not guilty, guilty,
// or guilty of the lesser offence. The judge affirms the jury's verdict and passes sentence, and
// the sentence is carried out: for another player's case that is their real fine, record,
// probation or jail (the same consequences the weighted chance used to hand out); for one of the
// city's residents it is entered on the court's docket and the fine paid to the city.
//
// A player's own case is tried the same way: when its hearing comes, those in the city are
// summoned, and their votes decide it. With nobody to sit, the judge rules alone on the evidence
// as it was presented (benchRuling: by its weight, not by chance).
//
// Pure: caseFile (who is in it and what is shown), exhibitSvg, verdictOf. installTrials adds the
// world's part. Tests: tests/city_trial.test.mjs.
import { FIRST, LAST, rng } from "./people.mjs";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const pickOf = (r, list) => list[Math.floor(r() * list.length) % list.length];
const nameOf = (seed) => { const r = rng("trial-name", seed); return `${pickOf(r, FIRST)} ${pickOf(r, LAST)}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const TRIAL_ACTS = ["trial_open", "trial_ask", "trial_vote"];
//: Game time runs this many times faster than real time (a game day is 72 real minutes).
export const clockScale = (R) => 1440 / ((R.clock?.day_minutes ?? 48) + (R.clock?.night_minutes ?? 24));

//: What each charge is, in the court's words. {place} and {thing} are filled from the case.
export const CHARGES = {
  theft: { law: "Penal Code 484, petty theft", did: "took {thing} from {place} without paying for it", lesser: "an infraction under Penal Code 490.1", things: ["a jacket worth $180", "two bottles of wine", "a power drill", "a pair of headphones", "groceries worth $64"] },
  battery: { law: "Penal Code 242, battery", did: "struck another person outside {place}", lesser: "disturbing the peace, Penal Code 415", things: ["a blow to the face", "a shove to the ground", "a thrown bottle"] },
  vandalism: { law: "Penal Code 594, vandalism", did: "damaged {thing} at {place}", lesser: "an infraction under Penal Code 594(b)(2)", things: ["a shop window", "a parked car's mirror", "a bus shelter's glass", "a painted wall"] },
  trespass: { law: "Penal Code 602, trespass", did: "entered {place} after being told to leave and refused to go", lesser: "an infraction under Penal Code 602.8", things: ["the back room", "the yard", "the roof"] },
  unsafe_driving: { law: "Vehicle Code 23103, reckless driving", did: "drove with wilful disregard for safety past {place}", lesser: "an unsafe speed, Vehicle Code 22350", things: ["a crosswalk with people in it", "a school zone", "a line of stopped traffic"] },
  red_light: { law: "Vehicle Code 21453, failure to stop at a red signal", did: "drove through a red light at {place}", lesser: "a rolling right turn on red, Vehicle Code 21453(b)", things: ["the junction"] },
  assault: { law: "Penal Code 245(a)(1), assault with a deadly weapon", did: "struck another person with {thing} outside {place}", lesser: "battery, Penal Code 242", things: ["a hammer", "a bottle", "a length of pipe", "a bat"] },
  attempted_murder: { law: "Penal Code 664/187(a), attempted murder", did: "beat another person and left them for dead outside {place}", lesser: "assault with force likely to produce great bodily injury, Penal Code 245(a)(4)", things: ["repeated blows to the head", "a beating that put them in intensive care"] },
  vehicular_assault: { law: "Penal Code 245(a)(1), assault with a deadly weapon (a vehicle)", did: "drove into a pedestrian at {place}", lesser: "reckless driving causing injury, Vehicle Code 23104", things: ["a crosswalk", "the pavement"] },
  hit_and_run: { law: "Vehicle Code 20002, hit and run", did: "struck another car at {place} and drove away without stopping", lesser: "failure to exchange information, Vehicle Code 16025", things: ["a parked car", "a car at the lights"] },
  evading: { law: "Vehicle Code 2800.1, evading a peace officer", did: "drove away from a police officer who signalled them to stop at {place}", lesser: "failure to obey a peace officer, Vehicle Code 2800", things: ["the patrol car's lights and siren"] },
  speeding: { law: "Vehicle Code 22350, unsafe speed", did: "drove faster than was safe past {place}", lesser: "a lesser speed over the limit", things: ["the limit"] },
};
const GENERIC = { law: "the city's ordinance", did: "{memo}", lesser: "a lesser infraction", things: ["the matter charged"] };
export const chargeOf = (charge) => CHARGES[charge] || CHARGES[{ speed_camera: "speeding" }[charge]] || GENERIC;
const PLACES = ["a shop on Chestnut Street", "the corner of Lombard and Fillmore", "a bar on Union Street", "the Marina Green car park", "a market on Scott Street", "the bus stop at Divisadero", "a cafe on Steiner Street"];

/**
 * Who is in a case and what each side shows.
 *   spec: { id, charge, cls, memo?, accused, where?, at (game ms), sources (["camera", "patrol officer",
 *           "witness", ...]), priors, defence: {name?, firm?, kind: "lawyer"|"public"|"self", skill 0..1},
 *           guilty (true | false | null: by the seed), seed }
 * Returns { judge, prosecutor, defence, accused, charge: {law, did, lesser}, guilty, exhibits:
 *   [{id, side, kind, title, text, data, weight}], script: [{who, name, text, exhibits: [ids]}],
 *   questions: [{id, to, label, answer, exhibits}], score }.
 * ``weight`` is how far an exhibit moves the case toward guilt (+) or away (-); ``score`` their sum.
 */
export function caseFile(R, spec) {
  const r = rng("trial", spec.seed ?? spec.id), C = chargeOf(spec.charge), sources = (spec.sources || []).map((s) => String(s).toLowerCase());
  const has = (k) => sources.some((s) => s.includes(k));
  const guilty = spec.guilty ?? r() < 0.62;
  const place = spec.where || pickOf(r, PLACES), thing = pickOf(r, C.things), did = C.did.replace("{place}", place).replace("{thing}", thing).replace("{memo}", spec.memo || "the offence charged");
  const judge = `Judge ${pickOf(r, LAST)}`, prosecutor = nameOf(`${spec.id}:da`), accused = spec.accused;
  const D = spec.defence || { kind: "public", skill: 0.4 }, defName = D.kind === "self" ? accused : D.name || nameOf(`${spec.id}:pd`);
  const when = new Date(spec.at || 0), hh = String(18 + Math.floor(r() * 5)).padStart(2, "0"), mm = String(Math.floor(r() * 60)).padStart(2, "0"), clock = `${hh}:${mm}`;
  const plate = `${Math.floor(1 + r() * 8)}${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}${Math.floor(100 + r() * 899)}`;
  const letters = "ABCDEFGHJK", ex = [];
  const add = (side, kind, title, text, data, weight) => { const id = letters[ex.length]; ex.push({ id, side, kind, title: `Exhibit ${id}: ${title}`, text, data: { ...data, place, clock }, weight: +weight.toFixed(2) }); return id; };
  const driving = /driving|red_light|speed/.test(spec.charge);
  // ---- the People's
  const witnessName = nameOf(`${spec.id}:w1`), officer = `Officer ${pickOf(r, LAST)}`;
  let cam = null, rep = null, wit = null;
  if (has("camera") || has("photograph") || (!sources.length && r() < 0.55)) {
    // A clear frame when it happened as charged; a poor one (a face turned away, a plate half hidden) when it did not.
    const clear = guilty ? r() < 0.8 : r() < 0.2;
    cam = add("people", "camera", driving ? "traffic camera still" : "security camera still", clear
      ? (driving ? `The frame is timed ${clock}. The plate ${plate} is readable and the signal head in the frame shows what the charge says.` : `The frame is timed ${clock}. A person of the accused's build and clothing is plainly seen at ${place}.`)
      : (driving ? `The frame is timed ${clock}. The plate is half hidden by a van; the last three characters cannot be read.` : `The frame is timed ${clock}. A figure is seen from behind, hood up; the face is not visible.`),
      { clear, plate: clear ? plate : `${plate.slice(0, 4)}???`, driving, charge: spec.charge }, clear ? 0.34 : 0.08);
  }
  if (has("officer") || has("police") || has("patrol") || (!sources.length && r() < 0.6)) {
    const saw = guilty ? r() < 0.75 : r() < 0.25;
    rep = add("people", "report", `${officer}'s report`, saw
      ? `${officer} writes that at ${clock} they saw the accused and that the accused ${did}. The officer was about fifteen metres away with a clear view.`
      : `${officer} writes that they arrived after a call at ${clock} and found the accused near ${place}. The officer did not see the act itself.`,
      { officer, saw, lines: [`Time: ${clock}`, `Place: ${place}`, saw ? "Observed directly: yes" : "Observed directly: no (arrived after)", `Charge: ${C.law}`] }, saw ? 0.3 : 0.1);
  }
  if (has("witness") || ex.length < 2 || r() < 0.5) {
    const sure = guilty ? r() < 0.7 : r() < 0.3, far = Math.round(sure ? 4 + r() * 8 : 25 + r() * 30);
    wit = add("people", "statement", `statement of ${witnessName}`, sure
      ? `"I was ${far} metres away and saw it happen. It was the person sitting there. I am sure."`
      : `"I was about ${far} metres off and it was getting dark. I think it was them, by the jacket. I did not see the face."`,
      { witness: witnessName, far, sure, lines: [`Distance: about ${far} m`, sure ? "Identification: certain" : "Identification: by clothing only", `Light: ${sure ? "street lamps, clear" : "dusk"}`] }, sure ? 0.22 : 0.06);
  }
  if (!driving && C !== GENERIC) add("people", "record", spec.charge === "battery" ? "clinic note" : "record of the loss", spec.charge === "battery"
    ? `A clinic note the same evening: bruising to the cheek, no fracture. It shows someone was struck; it does not say by whom.`
    : `The owner's record: ${thing}, and what it cost to put right. It shows the loss; it does not say who caused it.`,
    { lines: [spec.charge === "battery" ? "Bruising, left cheek" : cap(thing), "Dated the same day", "Says nothing of who"] }, 0.04);
  if ((spec.priors || 0) > 0) add("people", "priors", "prior convictions", `The court's record shows ${spec.priors} earlier conviction${spec.priors === 1 ? "" : "s"}. The judge will tell you it is not evidence that this happened.`, { lines: [`${spec.priors} prior conviction${spec.priors === 1 ? "" : "s"}`, "Not proof of this charge"] }, 0.05);
  // ---- the defence's: more of it, and better put, the better the lawyer; and the truth helps.
  const skill = Math.max(0, Math.min(1, D.skill ?? 0.3)), points = 1 + (skill > 0.45 ? 1 : 0) + (skill > 0.75 ? 1 : 0);
  let alibi = null, service = null;
  const companion = nameOf(`${spec.id}:w2`);
  if (!guilty || points >= 2) {
    const off = guilty ? 25 + Math.floor(r() * 40) : Math.floor(r() * 6), far = guilty ? "a ten-minute walk away" : "across the city";
    const t2 = `${hh}:${String((+mm + off) % 60).padStart(2, "0")}`;
    alibi = add("defence", "receipt", "card receipt", guilty
      ? `A card receipt from a restaurant ${far}, timed ${t2}: ${off} minutes from the time charged. It does not cover the time itself.`
      : `A card receipt from a restaurant ${far}, timed ${t2}: within minutes of the time charged, and too far to have been at both.`,
      { shop: "Restaurant", time: t2, amount: `$${(18 + r() * 60).toFixed(2)}`, off, far }, guilty ? -0.06 : -0.34);
  }
  if (cam && points >= 2) {
    const fault = !guilty || r() < 0.3;
    service = add("defence", "service", "the camera's service record", fault
      ? `The camera's log shows its clock was found eleven minutes wrong at the next service, and the lens had not been cleaned in four months.`
      : `The camera's log shows it was serviced on time and its clock checked.`, { lines: fault ? ["Clock: 11 min out at next service", "Lens: uncleaned, 4 months"] : ["Clock: checked, correct", "Lens: cleaned on schedule"] }, fault ? -0.16 : 0.02);
  }
  if (points >= 3 || !guilty) add("defence", "statement", `statement of ${companion}`, guilty
    ? `"We were together most of the evening. I went home before nine; I cannot say where they were after."`
    : `"We were together the whole evening, from seven until after eleven. They were never out of my sight."`,
    { witness: companion, sure: !guilty, lines: [guilty ? "Together: part of the evening" : "Together: the whole evening", "A friend of the accused"] }, guilty ? -0.03 : -0.2);
  const score = +ex.reduce((s, e) => s + e.weight, 0).toFixed(2);
  // ---- what is said
  const ids = (side) => ex.filter((e) => e.side === side).map((e) => e.id);
  const script = [
    { who: "judge", name: judge, text: `The People against ${accused}. The charge is ${C.law}: that the accused ${did}. Members of the jury, the People must prove it beyond a reasonable doubt. If you are left unsure, your verdict is not guilty.` },
    { who: "people", name: `${prosecutor}, for the People`, text: `On the evening in question, at about ${clock}, the accused ${did}. You will see ${ids("people").length} exhibit${ids("people").length === 1 ? "" : "s"}. Open each one and look at it.`, exhibits: ids("people") },
  ];
  if (rep) script.push({ who: "witness", name: officer, text: ex.find((e) => e.id === rep).data.saw ? `I saw it myself, from the pavement opposite. I wrote it up within the hour.` : `I was called to it. By the time I got there it was over; I took down what people told me.` });
  if (wit) script.push({ who: "witness", name: witnessName, text: ex.find((e) => e.id === wit).data.sure ? `I know what I saw. I was close and the lamps were on.` : `I'll be honest, it was a way off. The jacket was the same colour.` });
  script.push({ who: "defence", name: D.kind === "self" ? `${accused}, speaking for themself` : `${defName}, for the defence${D.firm ? ` (${D.firm})` : D.kind === "public" ? " (public defender)" : ""}`,
    text: ids("defence").length ? `The People have not shown who did this. Look at what we put in: ${ids("defence").length} exhibit${ids("defence").length === 1 ? "" : "s"}. Ask yourself whether you are sure.` : `I did not do this, and nothing you have been shown proves that I did.`, exhibits: ids("defence") });
  script.push({ who: "accused", name: accused, text: guilty ? (r() < 0.5 ? `I was in the area, yes. That is all I'll say.` : `They have the wrong person.`) : `I was not there. I have said so from the first day.` });
  // ---- what you may ask
  const questions = [];
  if (cam) questions.push({ id: "q-cam", to: "people", label: "Ask the prosecutor: can the camera frame identify the accused?", answer: ex.find((e) => e.id === cam).data.clear ? `${prosecutor}: Yes. Open Exhibit ${cam}: it is as clear as a frame gets.` : `${prosecutor}: Not by itself, I accept. Taken with the rest, we say it is enough.`, exhibits: [cam] });
  if (wit) questions.push({ id: "q-wit", to: "witness", label: `Ask ${witnessName}: how far away were you, and how was the light?`, answer: `${witnessName}: About ${ex.find((e) => e.id === wit).data.far} metres. ${ex.find((e) => e.id === wit).data.sure ? "The street lamps were on; I could see faces." : "It was dusk. I could see shapes and colours."}`, exhibits: [wit] });
  if (alibi) questions.push({ id: "q-alibi", to: "defence", label: "Ask the defence: how far is the restaurant on the receipt, and how close in time?", answer: `${D.kind === "self" ? accused : defName}: It is ${ex.find((e) => e.id === alibi).data.far}. The receipt is ${ex.find((e) => e.id === alibi).data.off} minute${ex.find((e) => e.id === alibi).data.off === 1 ? "" : "s"} from the time on the charge.`, exhibits: [alibi] });
  if (rep) questions.push({ id: "q-rep", to: "witness", label: `Ask ${officer}: did you see it happen yourself?`, answer: ex.find((e) => e.id === rep).data.saw ? `${officer}: I did. I was looking straight at it.` : `${officer}: No. I came after.`, exhibits: [rep] });
  if (service) questions.push({ id: "q-svc", to: "defence", label: "Ask the defence: what does the camera's service record show?", answer: `${D.kind === "self" ? accused : defName}: Open Exhibit ${service} and read the two lines for yourself.`, exhibits: [service] });
  return { judge, prosecutor, defence: { name: defName, kind: D.kind, firm: D.firm || null }, accused, charge: { id: spec.charge, law: C.law, did, lesser: C.lesser }, guilty, exhibits: ex, script, questions: questions.slice(0, 4), score, when: when.getTime() };
}

//: The judge alone, with no jury to sit: by the weight of what was shown (never by chance).
//: ``absent``: the accused did not come -- their side counts for half.
export function benchRuling(score, { absent = false, defence = 0 } = {}) {
  const s = absent ? score - defence * 0.5 : score;   // (defence is negative: taking half of it off raises the score)
  return s >= 0.42 ? "guilty" : s >= 0.3 ? "lesser" : "not_guilty";
}
//: The verdict from the jurors' votes ({pid: "guilty" | "lesser" | "not_guilty"}): the majority; a
//: tie is not guilty; among those for guilt, the lesser offence if most of them say so. With no
//: votes, the bench's.
export function verdictOf(votes, bench) {
  const v = Object.values(votes || {});
  if (!v.length) return { by: "bench", verdict: bench, tally: { guilty: 0, lesser: 0, not_guilty: 0 } };
  const tally = { guilty: 0, lesser: 0, not_guilty: 0 };
  for (const x of v) if (x in tally) tally[x] += 1;
  const forGuilt = tally.guilty + tally.lesser;
  const verdict = forGuilt > tally.not_guilty ? (tally.lesser > tally.guilty ? "lesser" : "guilty") : "not_guilty";
  return { by: "jury", verdict, tally };
}
//: The sentence the judge passes on a verdict: one of the law's outcomes (rules.json business.law.outcomes).
export function sentenceFor(verdict, { cls, priors = 0, charge = "" } = {}) {
  if (verdict === "not_guilty") return "acquitted";
  if (verdict === "lesser") return "reduced";
  if (cls !== "criminal") return "record";
  if (priors >= 2 || (charge === "battery" && priors >= 1)) return "jail";
  if (priors === 1) return "probation";
  return "record";
}

// ---- an exhibit as a picture -------------------------------------------------------------------
//: An exhibit drawn: an SVG (640 x 420) the page shows when its link is opened.
export function exhibitSvg(e) {
  const d = e.data || {}, W = 640, H = 420;
  const frame = (inner, bg = "#f4f1e8") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(e.title)}"><rect width="${W}" height="${H}" fill="${bg}"/>${inner}</svg>`;
  const lines = (list, x, y, size = 17, fill = "#1d2430") => list.map((t, i) => `<text x="${x}" y="${y + i * (size + 9)}" font-family="Georgia,serif" font-size="${size}" fill="${fill}">${esc(t)}</text>`).join("");
  if (e.kind === "camera") {
    // A night frame: the road, a lamp, the subject -- sharp or not -- and the burnt-in time.
    const blur = d.clear ? "" : `<filter id="b"><feGaussianBlur stdDeviation="5"/></filter>`;
    const subject = d.driving
      ? `<g ${d.clear ? "" : 'filter="url(#b)"'}><rect x="250" y="210" width="190" height="62" rx="12" fill="#39424e"/><rect x="278" y="186" width="120" height="38" rx="10" fill="#4a5563"/><circle cx="292" cy="276" r="17" fill="#111"/><circle cx="400" cy="276" r="17" fill="#111"/><rect x="302" y="246" width="86" height="22" fill="#e9e9e2"/><text x="345" y="263" text-anchor="middle" font-family="monospace" font-size="16" fill="#111">${esc(d.plate)}</text></g>${d.clear ? "" : '<rect x="352" y="170" width="150" height="120" rx="8" fill="#2c333c"/>'}<circle cx="120" cy="92" r="13" fill="${d.charge === "red_light" ? "#ff3b30" : "#444"}"/><rect x="104" y="70" width="32" height="92" rx="6" fill="none" stroke="#777" stroke-width="3"/>`
      : `<g ${d.clear ? "" : 'filter="url(#b)"'}><circle cx="330" cy="150" r="24" fill="${d.clear ? "#c9a184" : "#3a4048"}"/><rect x="300" y="174" width="60" height="96" rx="14" fill="#5b6470"/><rect x="306" y="268" width="20" height="70" fill="#2f3640"/><rect x="334" y="268" width="20" height="70" fill="#2f3640"/></g><rect x="60" y="120" width="170" height="230" fill="#20262e"/><rect x="80" y="150" width="130" height="90" fill="#3b4b58"/>`;
    return frame(`<defs>${blur}</defs><rect y="300" width="${W}" height="120" fill="#2a2f36"/><rect y="296" width="${W}" height="6" fill="#55595f"/>${subject}<rect x="0" y="0" width="${W}" height="34" fill="rgba(0,0,0,.55)"/><text x="12" y="23" font-family="monospace" font-size="16" fill="#e8f0e8">CAM 04  ${esc(d.place || "")}</text><text x="${W - 12}" y="23" text-anchor="end" font-family="monospace" font-size="16" fill="#e8f0e8">${esc(d.clock || "")}</text><text x="12" y="${H - 14}" font-family="monospace" font-size="14" fill="#cfd6cf">${d.clear ? "FOCUS OK" : "LOW LIGHT / PARTIAL"}</text>`, "#171b20");
  }
  if (e.kind === "receipt") {
    return frame(`<rect x="210" y="24" width="220" height="372" fill="#fffef9" stroke="#cfc9b8"/>${lines(["RESTAURANT", "", `Time   ${d.time || ""}`, "1 x dinner", "1 x drink", "", `TOTAL  ${d.amount || ""}`, "CARD  ****", "", "Thank you"], 232, 62, 16, "#222")}<text x="320" y="${H - 34}" text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#7a2020">${d.off <= 6 ? "within minutes of the time charged" : `${d.off} minutes from the time charged`}</text>`);
  }
  // A paper: a report, a statement, a record.
  const head = { report: "POLICE REPORT", statement: "WITNESS STATEMENT", record: "RECORD", priors: "COURT RECORD", service: "SERVICE LOG" }[e.kind] || "EXHIBIT";
  const body = (d.lines || []).slice(0, 6), words = String(e.text || "").replace(/"/g, "").split(" "), wrapped = [];
  let line = "";
  for (const w of words) { if ((line + " " + w).length > 58) { wrapped.push(line); line = w; } else line = line ? `${line} ${w}` : w; }
  if (line) wrapped.push(line);
  return frame(`<rect x="40" y="22" width="${W - 80}" height="${H - 44}" fill="#fffef9" stroke="#cfc9b8"/><text x="64" y="62" font-family="Georgia,serif" font-size="20" font-weight="bold" fill="#1d2430">${head}</text><line x1="64" y1="74" x2="${W - 64}" y2="74" stroke="#1d2430"/>${lines(body, 64, 104, 16)}${lines(wrapped.slice(0, 7), 64, 104 + body.length * 25 + 18, 15, "#3b4350")}${d.witness ? `<text x="${W - 64}" y="${H - 44}" text-anchor="end" font-family="cursive,Georgia" font-size="18" fill="#1b2a6b">${esc(d.witness)}</text>` : d.officer ? `<text x="${W - 64}" y="${H - 44}" text-anchor="end" font-family="cursive,Georgia" font-size="18" fill="#1b2a6b">${esc(d.officer)}</text>` : ""}`);
}

// ---- the world's part --------------------------------------------------------------------------
export function installTrials(CityWorld, CityError, { chargeClass, applyOutcome }) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };
  const J = (w) => w.R.business.law.jury, scale = (w) => clockScale(w.R);
  const realHours = (w, h) => h * HOUR * scale(w);
  const trialsOf = (w) => (w.trials ||= new Map());
  const courtName = (w) => w.R.messages.notices.from.court;
  const notices = (w, pid) => w.openThread(`sys:notices:${pid}`, () => ({ tab: "system", kind: "notices", name: "Notices", tag: "Official", members: [pid] }));
  const when = (w, at) => { const d = new Date(at); return d.toLocaleString("en-US", { timeZone: w.R.clock?.zone || "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }); };
  const slimEx = (e) => ({ id: e.id, side: e.side, kind: e.kind, title: e.title, text: e.text, data: e.data });

  //: Whether ``p`` is in the city now: something done within the last ``online_real_minutes``.
  W.onlineNow = function (p) { return this.now - (p.seen ?? -Infinity) <= (J(this).online_real_minutes ?? 20) * 60_000 * scale(this); };

  //: A trial opened: for a player's case (``c``) or one of the city's residents (``npc``: a seed).
  W.openTrial = function ({ c = null, seed = null }) {
    const T = trialsOf(this), R = this.R, id = this.id("trial");
    let spec;
    if (c) {
      const p = this.players.get(c.pid), L = c.lawyer;
      spec = { id, charge: c.charge, cls: c.class, memo: c.memo, accused: p?.name || "the accused", at: c.opened, sources: c.sources || [], priors: this.priorsOf(p),
        defence: L ? { name: L.name, firm: L.firm, kind: /public/i.test(L.title || "") ? "public" : "lawyer", skill: L.skill } : { kind: "self", skill: R.business.law.self_skill }, guilty: true, seed: `${this.seed}:${c.id}` };
    } else {
      const r = rng("npc-trial", this.seed, seed), charges = J(this).npc_charges || ["theft", "battery", "vandalism", "trespass", "unsafe_driving", "red_light"], charge = pickOf(r, charges);
      spec = { id, charge, cls: chargeClass(R, charge), accused: nameOf(`npc-accused:${seed}`), at: this.now, sources: [], priors: r() < 0.25 ? 1 + Math.floor(r() * 2) : 0,
        defence: r() < 0.5 ? { kind: "public", skill: 0.35 + r() * 0.2 } : { kind: "lawyer", skill: 0.45 + r() * 0.45, firm: `${pickOf(r, LAST)} & ${pickOf(r, LAST)}` }, guilty: null, seed: `${this.seed}:${seed}` };
    }
    const file = caseFile(R, spec);
    const t = { id, case: c?.id || null, pid: c?.pid || null, npc: !c, charge: spec.charge, class: spec.cls, priors: spec.priors, accused: spec.accused, file,
      opened: this.now, closes: this.now + realHours(this, J(this).open_real_hours ?? 6), jurors: {}, verdict: null };
    T.set(id, t);
    if (c) c.trial = id;
    return t;
  };
  //: ``p`` called to sit on ``t``: a notice with the way in. Open to them from this moment.
  W.summon = function (t, p) {
    if (t.jurors[p.id] || t.verdict || p.id === t.pid) return false;
    t.jurors[p.id] = { summoned: this.now, opened: null, vote: null, asked: [] };
    (this.mail.jurySince ||= {})[p.id] = this.now;
    this.post(notices(this, p.id), { from: "system", name: courtName(this), ui: { trial: t.id },
      text: `Jury summons. The People against ${t.accused}: ${t.file.charge.law}. The court is sitting now. The case is open to you from this moment until ${when(this, t.closes)} (about ${J(this).open_real_hours ?? 6} hours from now, your time). Jurors are paid ${this.R.fmt(J(this).fee_base)}.`,
      choices: [{ id: "go", label: "Go to the case", act: { cmd: "trial_open", args: { trial: t.id } } }] });
    this.log("summons_jury", { player: p.id, trial: t.id });
    return true;
  };
  const threadOf = (w, t, pid) => w.openThread(`trial:${t.id}:${pid}`, () => ({ tab: "system", kind: "trial", name: `People v. ${t.accused}`, tag: "Court", members: [pid], data: { trial: t.id } }));
  const mine = (w, pid, id) => { const t = trialsOf(w).get(id) || fail("no such case"); const j = t.jurors[pid] || fail("you are not on that jury"); return { t, j }; };
  const voteChoices = (t) => [{ id: "ng", label: "Not guilty", act: { cmd: "trial_vote", args: { trial: t.id, vote: "not_guilty" } } }, { id: "g", label: "Guilty", act: { cmd: "trial_vote", args: { trial: t.id, vote: "guilty" } } },
    { id: "l", label: `Guilty of the lesser offence (${t.file.charge.lesser})`, act: { cmd: "trial_vote", args: { trial: t.id, vote: "lesser" } } }];
  //: Going to the case: the whole of it laid out in a conversation of its own.
  W.mail_trial_open = function (pid, { trial }) {
    const { t, j } = mine(this, pid, trial), th = threadOf(this, t, pid);
    if (t.verdict) fail("that case has been decided");
    if (this.now > t.closes) fail("that case has closed");
    if (!j.opened) {
      j.opened = this.now;
      const byId = new Map(t.file.exhibits.map((e) => [e.id, e]));
      for (const s of t.file.script) this.post(th, { from: s.who === "judge" ? "system" : "npc", name: s.name, tag: { judge: "Judge", people: "Prosecution", defence: "Defence", witness: "Witness", accused: "Accused" }[s.who], text: s.text,
        ui: s.exhibits?.length ? { exhibits: s.exhibits.map((id) => slimEx(byId.get(id))) } : null });
      for (const q of t.file.questions) this.post(th, { from: "system", name: t.file.judge, tag: "Judge", text: "You may ask:", choices: [{ id: q.id, label: q.label, act: { cmd: "trial_ask", args: { trial: t.id, q: q.id } } }] });
      this.post(th, { from: "system", name: t.file.judge, tag: "Judge", text: `When you have looked at the exhibits and asked what you wish, give your verdict. It is yours alone to give; you have until ${when(this, t.closes)}.`, choices: voteChoices(t) });
    }
    return { thread: th.id, trial: t.id };
  };
  W.mail_trial_ask = function (pid, { trial, q }) {
    const { t, j } = mine(this, pid, trial), Q = t.file.questions.find((x) => x.id === q) || fail("that was not a question");
    if (t.verdict) fail("that case has been decided");
    j.asked.push(q);
    const byId = new Map(t.file.exhibits.map((e) => [e.id, e]));
    this.post(threadOf(this, t, pid), { from: "npc", name: Q.answer.split(":")[0], tag: { people: "Prosecution", defence: "Defence", witness: "Witness" }[Q.to], text: Q.answer.slice(Q.answer.indexOf(":") + 2), ui: Q.exhibits?.length ? { exhibits: Q.exhibits.map((id) => slimEx(byId.get(id))) } : null });
    return { asked: q };
  };
  W.mail_trial_vote = function (pid, { trial, vote }) {
    const { t, j } = mine(this, pid, trial), p = this.player(pid);
    if (!["guilty", "lesser", "not_guilty"].includes(vote)) fail("guilty, not guilty, or the lesser offence");
    if (t.verdict) fail("that case has been decided");
    if (this.now > t.closes) fail("that case has closed");
    if (j.vote) fail("you have given your verdict");
    j.vote = vote; j.at = this.now;
    this.ledger.mint(p.account, J(this).fee_base, "public_contract", { kind: "juror_fee", memo: `Jury service: ${t.accused}`, at: this.now, key: `jury:${t.id}:${pid}` });
    this.post(threadOf(this, t, pid), { from: "system", name: courtName(this), text: `Your verdict is recorded. ${this.R.fmt(J(this).fee_base)} has been paid to you for your service.` });
    this.log("jury", { player: pid, trial: t.id });
    // Decided at once when everyone called has spoken.
    if (Object.values(t.jurors).every((x) => x.vote)) this.rule(t);
    return { vote, fee: J(this).fee_base };
  };
  //: The judge rules: the jury's verdict affirmed (or the bench's, with no jury), the sentence
  //: passed and carried out.
  W.rule = function (t) {
    if (t.verdict) return t.verdict;
    const votes = Object.fromEntries(Object.entries(t.jurors).filter(([, j]) => j.vote).map(([pid, j]) => [pid, j.vote]));
    const c = t.case ? this.cases.get(t.case) : null, p = t.pid ? this.players.get(t.pid) : null, absent = Boolean(c && !c.present);
    const defence = t.file.exhibits.filter((e) => e.weight < 0).reduce((s, e) => s + e.weight, 0);
    const v = verdictOf(votes, benchRuling(t.file.score, { absent, defence }));
    const outcome = sentenceFor(v.verdict, { cls: t.class, priors: t.priors, charge: t.charge }), O = this.R.business.law.outcomes.find((o) => o.id === outcome);
    t.verdict = { ...v, outcome, name: O?.name || outcome, at: this.now };
    const said = `${t.file.judge}: ${v.by === "jury" ? `The jury's verdict is ${v.verdict === "not_guilty" ? "not guilty" : v.verdict === "lesser" ? "guilty of the lesser offence" : "guilty"} (${v.tally.guilty + v.tally.lesser} for guilt, ${v.tally.not_guilty} against), and the court affirms it.` : `No juror having given a verdict, the court rules on the evidence: ${v.verdict === "not_guilty" ? "not guilty" : v.verdict === "lesser" ? "guilty of the lesser offence" : "guilty"}.`} The sentence: ${O?.name || outcome}.`;
    for (const [pid, j] of Object.entries(t.jurors)) {
      if (j.opened) this.post(threadOf(this, t, pid), { from: "system", name: t.file.judge, tag: "Judge", text: said.slice(said.indexOf(":") + 2) });
      else if (!j.vote) this.post(notices(this, pid), { from: "system", name: courtName(this), text: `The case against ${t.accused} closed without your verdict. ${this.R.messages.notices.jury_missed}` });
    }
    if (c && p) {
      // A player's case: the real consequences (the fine, the record, probation, jail).
      const res = applyOutcome(this, p, c, outcome, absent);
      this.post(notices(this, p.id), { from: "system", name: courtName(this), text: `Your case (${c.memo || c.charge}): ${said.slice(said.indexOf(":") + 2)}` });
      t.verdict.released = Boolean(res?.released);
    } else {
      // One of the city's residents: on the docket; a fine goes to the city.
      const fine = outcome === "acquitted" ? 0 : Math.round((this.R.fines?.[t.charge] ?? this.R.money?.(250) ?? 250) * (outcome === "reduced" ? 0.5 : 1));
      (this.docket ||= []).push({ trial: t.id, accused: t.accused, charge: t.charge, outcome, by: v.by, fine, at: this.now });
      if (this.docket.length > 60) this.docket.shift();
      if (fine > 0 && this.treasury) { const where = this.where ? this.where({}) : {}; this.ledger.mint(this.treasury(where.city || where.county), fine, "public_contract", { kind: "court_fine", memo: `Fine: ${t.accused}, ${t.charge}`, at: this.now, key: `fine:${t.id}` }); }
      this.log("verdict", { trial: t.id, outcome, npc: true });
    }
    return t.verdict;
  };
  //: The court's day: trials whose time is up are ruled on; a player's case waiting for jurors
  //: calls those who have come into the city; now and then someone in the city is called to one
  //: of the residents' cases -- never more than ``every_real_days`` apart, and only while here.
  W.trialStep = function (newDay) {
    const T = trialsOf(this), Jr = J(this), online = [...this.players.values()].filter((p) => this.onlineNow(p));
    for (const t of T.values()) {
      if (t.verdict) continue;
      if (this.now > t.closes) { this.rule(t); continue; }
      if (!t.npc) for (const p of online) { if (Object.keys(t.jurors).length >= (Jr.jurors_most ?? 5)) break; this.summon(t, p); }
    }
    // A player's case come to its hearing: tried.
    for (const c of this.cases.values()) if (!c.closed && !c.verdict && !c.trial && c.court && this.now >= c.court) { const t = this.openTrial({ c }); for (const p of online) { if (Object.keys(t.jurors).length >= (Jr.jurors_most ?? 5)) break; this.summon(t, p); } }
    if (newDay) {
      const gap = (Jr.every_real_days ?? 14) * DAY * scale(this), since = (this.mail.jurySince ||= {});
      for (const p of online) {
        if (this.now - (since[p.id] ?? -Infinity) < gap || this.now - p.joined < (Jr.after_days ?? 2) * DAY) continue;
        if (rng("jury", p.id, this.time.day)() > (Jr.daily_chance ?? 0.05)) continue;
        this.summon(this.openTrial({ seed: `${p.id}:${this.time.day}` }), p);
      }
    }
    // Old trials are let go a real day after their verdict.
    for (const [id, t] of T) if (t.verdict && this.now - t.verdict.at > realHours(this, 24)) T.delete(id);
  };
}
