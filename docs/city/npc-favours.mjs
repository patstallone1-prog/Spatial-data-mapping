// Asking the city's people for a hand: to help carry something, to wait a minute, to step aside,
// to come along, to give you a lift. Whether they do is theirs: what they are doing and how much
// it matters to them, who they are (temperament.mjs), how well they know you (social.mjs), what
// you offer, and how often they have been asked today. Small things most people do; a big ask
// takes a friend, a good reason or money -- and a worker on shift does not leave the till.
//
// A decision is never the model's (server/npc). The world works it out (``cmd_ask_favour``):
//   - "help": they do it, now. The page walks them through it (view.mjs, the objective), then
//     back to their day -- the time they gave you is time they lose. Late for work is late: the
//     world says what it cost them (``cmd_favour_done``), and they are slower to help you again.
//   - "argue": not for nothing, or not for that long -- the terms they would take (a sum, or a
//     shorter favour). Asked again with the terms met, they help.
//   - "refuse": politely no. "ignore": they walk on.
// The model only voices the decision; it may also notice an ask in what you said that the
// words here did not (``[[favour:kind]]`` in its reply), which is then put to the world the same
// way. Pure (tests/city_npc_favours.test.mjs); installed on CityWorld's prototype.

import { hash32 } from "./people.mjs";
import { temperamentOf } from "./temperament.mjs";
import { standingOf } from "./social.mjs";

export const FAVOUR_COMMANDS = ["ask_favour", "favour_done"];

//: What can be asked: how big a thing it is (the cost of it to anyone), how long it takes, and
//: what it gives you (``kg``: what you can carry with their hands on it too).
export const FAVOURS = {
  make_way: { label: "step aside", size: 0.15, minutes: 0.5, words: /\b((move|step|get) (aside|over|out of (the|my) way)|let me (in|through|past|by|get (in|to (my|the) (car|door)))|(you'?re|you are) (in|blocking) (the|my) (way|door|car)|excuse me,? (can|could) i (get|squeeze) (by|past|through))\b/ },
  hold_door: { label: "hold the door", size: 0.1, minutes: 0.3, words: /\b(hold|get) (the|that) door\b/ },
  wait: { label: "wait a moment", size: 0.35, minutes: 2, words: /\b(wait (here|for me|a (sec|second|minute|moment|bit))|hold on (a|for)|hang on|stay (here|put)|watch my (car|bike|bags?|stuff|things))\b/ },
  carry: { label: "help carry something", size: 1, minutes: 6, kg: 25, words: /\b(carry|lift|give me a hand|help me (with|carry|lift|load|get) (this|these|the|my|it)|heavy|too much to carry|load (my|the) (car|van|truck))\b/ },
  come: { label: "come along", size: 1.2, minutes: 8, words: /\b(come with me|follow me|walk with me|show me (the way|where)|take me to)\b/ },
  ride: { label: "give you a lift", size: 2.2, minutes: 15, words: /\b((give|get) me a (ride|lift)|can i (get in|ride with you|come with you in)|drive me|let me (in your|ride in your) car|pick me up)\b/ },
  move_house: { label: "help move furniture", size: 3, minutes: 30, kg: 45, words: /\b(help me move|moving (house|out|in|my stuff)|move (my|a|the|this) (couch|sofa|fridge|bed|table|dresser|furniture|boxes))\b/ },
};
//: What a minute of someone's time is fairly paid (money units): a little above the city's wage.
export const FAIR_PER_MINUTE = 0.55;
export const BANDS = { help: 0.55, argue: 0.3, refuse: 0.1 };
//: How much what they are doing matters to them, by its kind (on their way to, or at).
export const MATTERS = { shift: 1.1, work: 0.45, school: 0.4, errand: 0.12, meal: 0.1, evening: 0.06, home: 0.05, leisure: 0.03, idle: 0 };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

//: The favour asked in ``text`` (a player's words): a kind of FAVOURS, or null.
export function askedFavour(text) {
  const t = String(text || "").toLowerCase();
  // (Most specific first: "help me move my couch" is furniture, not carrying.)
  for (const k of ["move_house", "ride", "hold_door", "make_way", "carry", "come", "wait"]) if (FAVOURS[k].words.test(t)) return k;
  return null;
}
//: A kind the model tagged in its reply (``[[favour:carry]]``) and the reply without the tag.
export function favourTag(reply) {
  const m = /\[\[favour:([a-z_]+)\]\]/i.exec(String(reply || ""));
  const kind = m && FAVOURS[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
  return { kind, text: String(reply || "").replace(/\s*\[\[favour:[a-z_]+\]\]\s*/gi, " ").trim() };
}

//: What someone is doing now and how much time they have to spare, from their day's plan
//: (fleet.mjs planOf: segs of {kind: go | stay, t0, t1, act: {kind, start, label}}) at ``minute``:
//: {kind (MATTERS), label, spare (minutes before they must be somewhere), at: true when there}.
export function onTheirWay(plan, minute) {
  const segs = plan?.segs || [];
  const now = segs.find((s) => minute >= s.t0 && minute < s.t1);
  if (!now) return { kind: "idle", label: null, spare: 60, at: false };
  if (now.kind === "stay") {
    const k = now.act?.kind === "work" ? "shift" : now.act?.kind || "idle";
    return { kind: MATTERS[k] !== undefined ? k : "leisure", label: now.act?.label || null, spare: k === "shift" ? 0 : Math.max(0, now.t1 - minute), at: true };
  }
  const next = segs.find((s) => s.kind === "stay" && s.t0 >= now.t1 - 1e-6);
  const k = next?.act?.kind || "idle";
  // Spare: how early they would be, walking on now (their way takes until now.t1).
  const due = next?.act?.start ?? next?.t0 ?? now.t1;
  return { kind: MATTERS[k] !== undefined ? k : "leisure", label: next?.act?.label || null, spare: Math.max(0, due - now.t1), at: false };
}

//: How someone takes being asked: {verdict: help | argue | refuse | ignore, score, terms, reasons}.
//:   ``kind``: of FAVOURS; ``who``: {id, age, base: {role}} (their temperament from it);
//:   ``on``: onTheirWay(); ``standing``: what you are to them (social.mjs standingOf);
//:   ``offer``: money offered (units); ``today``: {done: favours they have done today, asked: times
//:   you asked them today, grudge: 0-1}; ``money``: the units of one credit (R.money(1)).
export function weighFavour({ kind, who = {}, on = { kind: "idle", spare: 60 }, standing = "stranger", offer = 0, today = {}, money = 100, day = 0 }) {
  const F = FAVOURS[kind];
  if (!F) return { verdict: "refuse", score: 0, reasons: ["not something anyone can do"], terms: null };
  const t = temperamentOf(who), reasons = [];
  // How willing they are: the careful, the public-minded and the patient more; the quick-tempered less.
  const agree = 0.36 * t.care + 0.3 * t.civic + 0.2 * t.patience + 0.14 * (1 - t.temper);
  let score = 0.18 + agree * 0.95;
  const known = { friend: 0.32, "familiar face": 0.16, acquaintance: 0.07, stranger: 0 }[standing] ?? 0;
  if (known) reasons.push(`you are ${standing === "acquaintance" ? "an acquaintance" : standing === "friend" ? "a friend" : "a familiar face"}`);
  score += known;
  // The ask itself: the bigger the thing, the more it costs them.
  // (A moment's thing -- a step aside, a door -- is hardly a favour at all.)
  const big = F.size * 0.17 - (F.size <= 0.35 ? 0.15 : 0);
  score -= big;
  if (F.size >= 2) reasons.push("it is a big thing to ask");
  // What they are on their way to, and whether the time would make them late.
  const matters = MATTERS[on.kind] ?? 0.05;
  const over = Math.max(0, F.minutes - (on.spare ?? 0));
  let cost = matters * (on.kind === "shift" ? 1 : Math.min(1, 0.25 + over / Math.max(4, F.minutes)));
  if (on.kind === "shift" && F.size <= 0.35) cost *= 0.15;   // a worker will still step aside or wait a moment
  score -= cost;
  if (on.kind === "shift" && F.size > 0.35) reasons.push(`they are working${on.label ? ` (${on.label.toLowerCase()})` : ""}`);
  else if (over > 0 && matters >= 0.3) reasons.push(`it would make them late${on.label ? ` for ${on.label.toLowerCase()}` : ""}`);
  // Money on the table (against what the time is worth to them).
  const worth = Math.max(1, Math.round(F.minutes * FAIR_PER_MINUTE * money * (1 + matters)));
  const pay = Math.min(0.42, 0.42 * (offer / worth));
  if (offer > 0) { score += pay; reasons.push(offer >= worth ? "you are paying well for it" : "you offered something for it"); }
  // Asked too often: they have done enough today, and you keep asking.
  const done = today.done || 0, asked = today.asked || 0;
  score -= 0.13 * done + 0.11 * Math.max(0, asked - 1) + 0.3 * (today.grudge || 0);
  if (done) reasons.push(`they have helped ${done === 1 ? "once" : `${done} times`} today already`);
  if (asked > 1) reasons.push("you have asked them already");
  // The old do not lift furniture; the young are not let drive strangers about.
  if ((F.kg || 0) > 30 && (who.age ?? 35) > 64) { score -= 0.35; reasons.push("it is too heavy work for them"); }
  if (kind === "ride" && (who.age ?? 35) < 18) { score -= 1; reasons.push("they do not drive"); }
  // A little of the day in it: the same person is not the same every time.
  score += ((hash32(String(who.id || ""), day, kind) % 1000) / 1000 - 0.5) * 0.1;
  score = Math.round(score * 1000) / 1000;
  const verdict = score >= BANDS.help ? "help" : score >= BANDS.argue ? "argue" : score >= BANDS.refuse || t.temper < 0.55 || known ? "refuse" : "ignore";
  // The terms they would take: what would bring it up to a yes.
  let terms = null;
  if (verdict === "argue") {
    const want = Math.ceil(((BANDS.help - score + pay) / 0.42) * worth / money) * money;
    terms = want <= worth * 2.5 ? { pay: Math.max(money, want) } : { shorter: true };
  }
  return { verdict, score, terms, reasons, minutes: F.minutes, kind };
}

//: What it cost them, once done: ``held`` minutes of their day given to you, ``on`` as when they
//: were asked, ``wage`` (units an hour, theirs if known). {late (min), text, docked (units)}.
export function favourCost({ held, on = { kind: "idle", spare: 60 }, wage = 0, name = "They" }) {
  const first = String(name).split(" ")[0];
  const late = Math.max(0, Math.round(held - (on.kind === "shift" ? 0 : on.spare ?? 60)));
  const what = on.label ? on.label.toLowerCase() : on.kind === "work" || on.kind === "shift" ? "work" : null;
  if (!late || !(MATTERS[on.kind] >= 0.3)) return { late: 0, docked: 0, text: null };
  if (late <= 4) return { late, docked: 0, text: `${first} made it to ${what || "where they were going"} with no time to spare.` };
  if (on.kind === "work" || on.kind === "shift") {
    const docked = late > 15 ? Math.round((wage * late) / 60) : 0;
    return { late, docked, text: docked ? `${first} was ${late} minutes late for work and lost ${late} minutes' pay.` : `${first} was ${late} minutes late for work: a word from the manager.` };
  }
  return { late, docked: 0, text: `${first} was ${late} minutes late${what ? ` for ${what}` : ""}.` };
}

//: The set line for a verdict, in the character's tone (when no model voices it).
export function favourLine(verdict, { kind, terms = null, tone = "reserved", seed = "" } = {}) {
  const F = FAVOURS[kind] || { label: "that" }, pick = (list) => list[hash32(String(seed), verdict, kind) % list.length];
  const pay = terms?.pay ? "something for my time" : null;
  const L = {
    help: { reserved: ["All right. Lead the way.", "Fine, I can do that."], warm: ["Of course! Happy to help.", "Sure, no trouble at all."], direct: ["Okay. Quick, though.", "Fine. Let's go."], expressive: ["Sure thing! Let's do it.", "Oh, absolutely!"] },
    argue: { reserved: [`I could, ${pay ? `for ${pay}` : "if it's quick"}.`, "That's rather a lot to ask."], warm: [`I'd like to, but ${pay ? `I'd need ${pay}` : "I can't for long"}.`, "Oh -- I'm really pressed. Maybe, if it's quick?"], direct: [`Not for free.${pay ? " Make it worth my while." : ""}`, "That's a big ask. What's in it for me?"], expressive: [`Ooh, that's a lot! ${pay ? "Make it worth my while?" : "Only if it's quick!"}`, "Wow, okay -- not for nothing!"] },
    refuse: { reserved: ["I'm sorry, I can't.", "Not today, I'm afraid."], warm: ["I'm so sorry, I really can't right now.", "I wish I could -- I'm running late."], direct: ["Can't. Sorry.", "No, I've got somewhere to be."], expressive: ["Oh no, I can't, sorry!", "Ah, not today, sorry!"] },
    ignore: { reserved: ["…"], warm: ["Sorry, can't stop!"], direct: ["Not my problem."], expressive: ["Nope!"] },
  };
  const fam = L[verdict]?.[tone] ? tone : "reserved";
  return pick(L[verdict][fam]).replace("that", F.label);
}

// ---- in the world ----------------------------------------------------------------------------------

export function installFavours(CityWorld, CityError) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };
  const HOUR = 3600_000, dayOf = (w) => Math.floor(w.now / 86_400_000);
  //: What one of the city's people has given today: {day, done, minutes, asked: {pid: n}, grudge: {pid: 0-1}}.
  W.favourRecord = function (npc) {
    this.favourBook ||= new Map();
    const id = String(npc), day = dayOf(this);
    let r = this.favourBook.get(id);
    if (!r || r.day !== day) {
      r = { day, done: 0, minutes: 0, asked: {}, grudge: r?.grudge || {} };
      for (const k of Object.keys(r.grudge)) { r.grudge[k] = Math.round(r.grudge[k] * 0.5 * 100) / 100; if (r.grudge[k] < 0.05) delete r.grudge[k]; }
      this.favourBook.set(id, r);
      if (this.favourBook.size > 3000) this.favourBook.delete(this.favourBook.keys().next().value);
    }
    return r;
  };
  //: Asking one of the city's people for a favour (``npc``: {id, name, age, role}; ``on``: what
  //: they are doing, onTheirWay(); ``offer``: money for it). The answer is the world's: and a
  //: yes is the favour you now have of them (``p.favour``), until it is done or its time is up.
  W.cmd_ask_favour = function (pid, { npc = {}, kind, on = null, offer = 0 } = {}) {
    const p = this.player(pid), F = FAVOURS[kind];
    if (!F) fail("ask them something they can do");
    const id = String(npc.id || "").slice(0, 80);
    if (!id) fail("ask whom?");
    if (p.favour && p.favour.until > this.now && p.favour.npc !== id) fail(`${p.favour.name} is still helping you`);
    const rec = this.favourRecord(id);
    rec.asked[pid] = (rec.asked[pid] || 0) + 1;
    offer = Math.max(0, Math.min(this.R.money(500), Math.round(+offer || 0)));
    if (offer && this.ledger.balance(p.account) < offer) fail(`you have only ${this.R.fmt(this.ledger.balance(p.account))}`);
    const spare = Math.max(0, Math.min(600, +on?.spare || 0));
    const where = { kind: MATTERS[on?.kind] !== undefined ? on.kind : "idle", spare, label: typeof on?.label === "string" ? on.label.slice(0, 60) : null };
    const standing = standingOf(p.people?.[id]?.talks || 0);
    const d = weighFavour({ kind, who: { id, age: Number.isFinite(npc.age) ? npc.age : 35, base: { role: String(npc.role || "") } }, on: where, standing, offer,
      today: { done: rec.done, asked: rec.asked[pid], grudge: rec.grudge[pid] || 0 }, money: this.R.money(1), day: rec.day });
    const out = { ...d, standing, npc: id };
    if (d.verdict === "help") {
      if (offer) this.ledger.transfer(p.account, this.ledger.open(`resident:${id}`, "resident"), offer, { kind: "tip", memo: `For ${F.label}`, at: this.now });
      p.favour = { id: this.id("favour"), npc: id, name: String(npc.name || "Someone").slice(0, 60), kind, since: this.now, until: this.now + Math.max(2, F.minutes * 2.5) * 60_000, on: where, wage: Math.max(0, +npc.wage || 0), paid: offer };
      out.favour = p.favour;
    }
    p.favourAsk = { npc: id, kind, verdict: d.verdict, terms: d.terms, reasons: d.reasons.slice(0, 4), at: this.now };
    this.log("ask_favour", { player: pid, npc: id, kind, verdict: d.verdict });
    return out;
  };
  //: The favour done (or called off): ``held``, the minutes of their day it took. What it cost
  //: them (favourCost) is theirs to bear -- and a little of it is held against you if it was much.
  W.cmd_favour_done = function (pid, { id, held = 0 } = {}) {
    const p = this.player(pid), f = p.favour;
    if (!f || f.id !== id) fail("no favour of that");
    const most = Math.max(1, (this.now - f.since) / 60_000 + 1);
    const minutes = Math.max(0, Math.min(most, +held || 0));
    const rec = this.favourRecord(f.npc);
    rec.done += 1; rec.minutes += minutes;
    const cost = favourCost({ held: minutes, on: f.on, wage: f.wage, name: f.name });
    if (cost.late > 10) rec.grudge[pid] = Math.min(1, (rec.grudge[pid] || 0) + Math.min(0.6, cost.late / 60));
    p.favour = null;
    (p.favoursDone ||= []).push({ npc: f.npc, name: f.name, kind: f.kind, minutes: Math.round(minutes * 10) / 10, late: cost.late, at: this.now });
    if (p.favoursDone.length > 20) p.favoursDone.shift();
    return { cost, minutes };
  };
  //: A favour of carrying: their hands on it too, while it lasts.
  const carry = W.carry;
  W.carry = function (p) {
    const c = carry.call(this, p), f = p.favour;
    if (f && f.until > this.now && FAVOURS[f.kind]?.kg) c.capacity = Math.round((c.capacity + FAVOURS[f.kind].kg) * 10) / 10;
    return c;
  };
  //: A lift: the cab is theirs, and there is no fare.
  const board = W.cmd_board, alight = W.cmd_alight;
  W.cmd_board = function (pid, args = {}) {
    const p = this.player(pid), f = p.favour, lift = args.lift && f?.kind === "ride" && f.until > this.now;
    const r = board.call(this, pid, args);
    if (lift && p.ride) p.ride.lift = f.name;
    return r;
  };
  W.cmd_alight = function (pid, args = {}) {
    const p = this.player(pid);
    if (p.ride?.lift) { const name = p.ride.lift; p.ride = null; return { fare: 0, kind: "lift", km: Math.max(0, +args.km || 0), by: name }; }
    return alight.call(this, pid, args);
  };
  const toJSON = W.toJSON;
  W.toJSON = function () { const o = toJSON.call(this); if (this.favourBook?.size) o.favourBook = [...this.favourBook]; return o; };
  const fromJSON = CityWorld.fromJSON;
  CityWorld.fromJSON = function (R, o) { const w = fromJSON.call(this, R, o); w.favourBook = new Map(o.favourBook || []); return w; };
}
