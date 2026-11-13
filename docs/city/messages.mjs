// The city's messages: the one layer every kind of conversation goes through (docs/39).
//
// A thread has members and messages; a message may carry choices, which run on the world (vote,
// pay, answer an interviewer) and are answered once per member. Three tabs read the threads:
//
// * players -- direct messages, groups players make of their friends, the neighbours' group
//   (everyone whose home is in the same neighbourhood) and the Kerbside council (everyone);
// * npc -- people of the city writing to you: your lawyer with how the case is going and how it
//   went, an interviewer whose questions you answer (and who becomes your boss when you are
//   hired), the cab driver on the way, at the kerb, and about to go;
// * system -- the day in Kerbside, City Hall's measures with their votes and results, and your
//   notices: fines, late penalties, summonses and jury duty.
//
// Pure like the rest of the world: no DOM, no clock of its own. installMessages() adds the
// methods to CityWorld and wraps the few world methods that speak (step, the lawyer, the verdict,
// the measures) so the rest of the world does not need to know messages exist.

import { FIRST, LAST, rng } from "./people.mjs";
import { cityTime } from "./core.mjs";
import { neighbourhoodAt } from "./market.mjs";
import { oddsLabel, verdictWeights } from "./enterprise.mjs";

const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000;
//: The most a thread keeps, a message says, a group holds.
export const THREAD_CAP = 60, TEXT_MAX = 500, GROUP_MAX = 24, NAME_MAX = 40;
export const TABS = ["players", "npc", "system"];
export const MESSAGE_COMMANDS = ["send_message", "read_thread", "create_group", "add_to_group", "leave_group", "rename_group",
  "add_friend", "unfriend", "answer", "apply_job", "ride_note", "serve_jury"];
//: The world actions a message's choice may run, and nothing else.
const CHOICE_ACTS = new Set(["vote", "pay_bill", "contest", "add_friend", "decline_friend", "interview", "lawyer_ask", "jury_confirm", "jury_defer", "ride_wait", "ack"]);

const fresh = () => ({ seq: 0, threads: new Map(), friends: {}, asked: {}, seen: {}, day: null, digestFrom: null, ride: {}, jurySince: {}, hood: {} });
const pair = (a, b) => [a, b].sort().join("|");
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const nameFor = (seed) => { const r = rng("npc-name", seed); return `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`; };
const when = (w, ms) => { const t = cityTime(ms, w.R.clock.zone); const d = Math.round((t.day - w.time.day)); return `${d === 0 ? "today" : d === 1 ? "tomorrow" : t.label.slice(0, 3)} ${t.label.slice(4)}`; };
const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? `{${k}}`));

export function installMessages(CityWorld, CityError, { citations = [] } = {}) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };
  const M = (w) => (w.mail ||= fresh());
  const MR = (w) => w.R.messages;

  // ---- threads ------------------------------------------------------------------------------------
  W.thread = function (id) { return M(this).threads.get(id) || null; };
  W.openThread = function (id, make) {
    const m = M(this);
    let t = m.threads.get(id);
    if (!t) { t = { id, msgs: [], read: {}, last: this.now, data: {}, members: [], ...make() }; m.threads.set(id, t); }
    return t;
  };
  //: A message into a thread: from a player id, or {npc|system}; with choices it waits for answers.
  W.post = function (t, { from = "system", name = null, tag = null, text, choices = null, ui = null }) {
    const m = M(this);
    const msg = { id: ++m.seq, t: this.now, from, name, tag, text: clip(text, 1200) };
    if (choices?.length) { msg.choices = choices; msg.answered = {}; }
    if (ui) msg.ui = ui;
    t.msgs.push(msg);
    if (t.msgs.length > THREAD_CAP) t.msgs.splice(0, t.msgs.length - THREAD_CAP);
    t.last = this.now;
    return msg;
  };
  const member = (t, pid) => t.members === "all" || t.members.includes(pid);
  W.memberOf = function (t, pid) { if (!t || !member(t, pid)) fail("not a conversation of yours"); return t; };
  const nameOf = (w, pid) => w.players.get(pid)?.name || "Someone";

  //: What one player sees: their threads by tab, newest first, with unread counts.
  W.inbox = function (pid) {
    const m = M(this), out = { players: [], npc: [], system: [] }, unread = { players: 0, npc: 0, system: 0 };
    for (const t of m.threads.values()) {
      if (!member(t, pid)) continue;
      const seen = t.read[pid] || 0;
      const n = t.msgs.filter((x) => x.id > seen && x.from !== pid).length;
      const lastMsg = t.msgs[t.msgs.length - 1];
      const waiting = t.msgs.some((x) => x.choices && !(pid in x.answered) && !x.expired && x.choices.some((c) => !c.only || c.only === pid));
      const row = { id: t.id, tab: t.tab, kind: t.kind, name: t.kind === "dm" ? nameOf(this, t.members.find((x) => x !== pid)) : t.name, tag: t.tag || null,
        owner: t.owner || null, members: t.members === "all" ? null : t.members.map((x) => ({ id: x, name: nameOf(this, x) })),
        unread: n, waiting, last: t.last, preview: lastMsg ? `${lastMsg.from === pid ? "You: " : ""}${lastMsg.text}`.slice(0, 90) : "", msgs: t.msgs, data: publicData(t) };
      out[t.tab].push(row); unread[t.tab] += n;
    }
    for (const k of TABS) out[k].sort((a, b) => b.last - a.last);
    const friends = (m.friends[pid] || []).map((id) => ({ id, name: nameOf(this, id) }));
    const asked = Object.entries(m.asked).filter(([, to]) => to.includes(pid)).map(([from]) => ({ id: from, name: nameOf(this, from) }));
    return { tabs: out, unread, friends, asked, sent: (m.asked[pid] || []).slice() };
  };
  const publicData = (t) => (t.kind === "driver" ? { extend: Boolean(t.data.extend), ride: t.data.ride || 0 } : t.kind === "lawyer" ? { rapport: t.data.rapport || 0 } : null);

  W.cmd_read_thread = function (pid, { thread }) {
    const t = this.memberOf(this.thread(thread), pid);
    t.read[pid] = t.msgs.length ? t.msgs[t.msgs.length - 1].id : 0;
    return {};
  };

  // ---- players: friends, groups, messages -------------------------------------------------------
  const friendsOf = (w, pid) => (M(w).friends[pid] ||= []);
  W.cmd_add_friend = function (pid, { player }) {
    const m = M(this), me = this.player(pid);
    if (!player || player === pid || !this.players.has(player)) fail("no such player");
    if (friendsOf(this, pid).includes(player)) fail(`${nameOf(this, player)} is already a friend`);
    const theirs = m.asked[player] || [];
    if (theirs.includes(pid)) {
      // They asked first: friends both ways.
      m.asked[player] = theirs.filter((x) => x !== pid);
      friendsOf(this, pid).push(player); friendsOf(this, player).push(pid);
      const t = this.dm(pid, player);
      this.post(t, { from: "system", text: `${me.name} and ${nameOf(this, player)} are friends.` });
      this.log("friends", { a: pid, b: player });
      return { friends: true };
    }
    const mine = (m.asked[pid] ||= []);
    if (!mine.includes(player)) mine.push(player);
    const t = this.dm(pid, player);
    this.post(t, { from: "system", text: `${me.name} would like to be friends.`, choices: [
      { id: "yes", label: "Accept", act: { cmd: "add_friend", args: { player: pid } }, only: player },
      { id: "no", label: "Not now", act: { cmd: "decline_friend", args: { player: pid } }, only: player }] });
    return { asked: true };
  };
  W.cmd_decline_friend = function (pid, { player }) {
    const m = M(this);
    m.asked[player] = (m.asked[player] || []).filter((x) => x !== pid);
    return {};
  };
  W.cmd_unfriend = function (pid, { player }) {
    const m = M(this);
    m.friends[pid] = friendsOf(this, pid).filter((x) => x !== player);
    m.friends[player] = friendsOf(this, player).filter((x) => x !== pid);
    return {};
  };
  W.dm = function (a, b) {
    return this.openThread(`dm:${pair(a, b)}`, () => ({ tab: "players", kind: "dm", name: null, members: [a, b] }));
  };
  //: A message: into a thread you are in, or to a player (a direct thread made on the way).
  W.cmd_send_message = function (pid, { thread = null, to = null, text }) {
    const p = this.player(pid), body = clip(text, TEXT_MAX);
    if (!body) fail("say something first");
    let t;
    if (to) {
      if (!this.players.has(to) || to === pid) fail("no such player");
      t = this.dm(pid, to);
    } else t = this.memberOf(this.thread(thread), pid);
    if (t.tab === "system") fail("notices can not be answered here");
    const sent = this.post(t, { from: pid, name: p.name, text: body });
    t.read[pid] = sent.id;
    if (t.tab === "npc") this.npcHeard(t, pid, body);
    return { thread: t.id, message: sent.id };
  };
  W.cmd_create_group = function (pid, { name, members = [] }) {
    const p = this.player(pid), title = clip(name, NAME_MAX);
    if (!title) fail("a group needs a name");
    const friends = friendsOf(this, pid);
    const list = [...new Set(members)].filter((x) => x !== pid);
    const strangers = list.filter((x) => !friends.includes(x));
    if (strangers.length) fail("add people as friends first, then to a group");
    if (list.length + 1 > GROUP_MAX) fail(`a group holds ${GROUP_MAX}`);
    const t = this.openThread(this.id("group"), () => ({ tab: "players", kind: "group", name: title, owner: pid, members: [pid, ...list] }));
    this.post(t, { from: "system", text: `${p.name} made the group "${title}"${list.length ? ` with ${list.map((x) => nameOf(this, x)).join(", ")}` : ""}.` });
    return { thread: t.id };
  };
  W.cmd_add_to_group = function (pid, { thread, player }) {
    const t = this.memberOf(this.thread(thread), pid);
    if (t.kind !== "group") fail("only groups players make can take new members");
    if (!friendsOf(this, pid).includes(player)) fail("you can add your friends");
    if (t.members.includes(player)) fail(`${nameOf(this, player)} is in the group already`);
    if (t.members.length >= GROUP_MAX) fail(`a group holds ${GROUP_MAX}`);
    t.members.push(player);
    this.post(t, { from: "system", text: `${nameOf(this, pid)} added ${nameOf(this, player)}.` });
    return { thread: t.id };
  };
  W.cmd_leave_group = function (pid, { thread }) {
    const t = this.memberOf(this.thread(thread), pid);
    if (t.kind !== "group") fail("you are in this one by where you live or by being here");
    t.members = t.members.filter((x) => x !== pid);
    if (t.owner === pid) t.owner = t.members[0] || null;
    this.post(t, { from: "system", text: `${nameOf(this, pid)} left.` });
    if (!t.members.length) M(this).threads.delete(t.id);
    return {};
  };
  W.cmd_rename_group = function (pid, { thread, name }) {
    const t = this.memberOf(this.thread(thread), pid), title = clip(name, NAME_MAX);
    if (t.kind !== "group") fail("only groups players make can be renamed");
    if (!title) fail("a group needs a name");
    t.name = title;
    this.post(t, { from: "system", text: `${nameOf(this, pid)} named the group "${title}".` });
    return {};
  };

  // ---- choices ----------------------------------------------------------------------------------
  //: Answering a message's choice: once per member, and only the world actions choices may run.
  W.cmd_answer = function (pid, { thread, message, choice }) {
    const p = this.player(pid), t = this.memberOf(this.thread(thread), pid);
    const msg = t.msgs.find((x) => x.id === message);
    if (!msg?.choices) fail("nothing to answer there");
    if (pid in msg.answered) fail("answered already");
    if (msg.expired) fail("that has passed");
    const c = msg.choices.find((x) => x.id === choice);
    if (!c || (c.only && c.only !== pid)) fail("not a choice of yours");
    if (!CHOICE_ACTS.has(c.act?.cmd)) fail("that can not be done from a message");
    // Your answer in the thread, then what it does; a choice that fails (no money to pay) is taken
    // back and stays open to try again.
    const echo = t.members !== "all" && t.tab !== "system" ? this.post(t, { from: pid, name: p.name, text: c.label }) : null;
    if (echo) t.read[pid] = echo.id;
    msg.answered[pid] = c.id;
    const fn = this[`cmd_${c.act.cmd}`] || this[`mail_${c.act.cmd}`];
    try { return { result: fn.call(this, pid, { ...c.act.args, thread: t.id, message: msg.id }) || {} }; }
    catch (error) {
      delete msg.answered[pid];
      if (echo) t.msgs.splice(t.msgs.indexOf(echo), 1);
      throw error;
    }
  };
  W.mail_ack = function () { return {}; };

  // ---- the npc side: lawyers ------------------------------------------------------------------------
  const lawyerThread = (w, pid, lawyer) => w.openThread(`npc:lawyer:${pid}:${lawyer.id}`, () => ({ tab: "npc", kind: "lawyer", name: lawyer.name,
    tag: "Lawyer", members: [pid], data: { lawyer: { id: lawyer.id, name: lawyer.name, firm: lawyer.firm, title: lawyer.title }, rapport: 0, cases: [] } }));
  const lawyerSays = (w, t, text, choices = null) => w.post(t, { from: "npc", name: t.name, tag: t.tag, text, choices });
  const oddsOf = (w, p, c) => oddsLabel(w.R, verdictWeights(w.R, { skill: c.lawyer?.skill ?? w.R.business.law.self_skill, evidence: c.evidence, priors: w.priorsOf(p), criminal: c.class === "criminal" }));
  const charge = (w, c) => String(c.charge).replace(/_/g, " ");
  //: How well you know a lawyer: cases together, and the thanks you gave.
  W.rapportWith = function (pid, lawyerId) { return this.thread(`npc:lawyer:${pid}:${lawyerId}`)?.data.rapport || 0; };
  W.lawyerHired = function (pid, c) {
    const p = this.players.get(pid), L = MR(this).lawyer;
    if (!p || !c?.lawyer) return;
    const t = lawyerThread(this, pid, c.lawyer), r = t.data.rapport;
    const hello = r >= 4 ? L.hello_close : r >= 1 ? L.hello_again : L.hello;
    const first = p.name.split(" ")[0];
    lawyerSays(this, t, fill(`${hello} ${L.taken}`, { name: first, lawyer: c.lawyer.name, title: c.lawyer.title.toLowerCase(), firm: c.lawyer.firm,
      charge: charge(this, c), when: when(this, c.court), odds: oddsOf(this, p, c) }), [
      { id: "odds", label: "What are my odds?", act: { cmd: "lawyer_ask", args: { case: c.id, ask: "odds" } } },
      { id: "thanks", label: "Thank you", act: { cmd: "lawyer_ask", args: { case: c.id, ask: "thanks" } } }]);
    if (!t.data.cases.includes(c.id)) t.data.cases.push(c.id);
    (t.data.updates ||= {})[c.id] = 0;
    (t.data.hired ||= {})[c.id] = this.now;
  };
  W.mail_lawyer_ask = function (pid, { case: cid, ask, thread }) {
    const t = this.thread(thread), c = this.cases.get(cid), p = this.player(pid), L = MR(this).lawyer;
    if (!t || !c) return {};
    if (ask === "odds") lawyerSays(this, t, fill(c.verdict ? L.odds_done : L.odds, { odds: oddsOf(this, p, c), evidence: c.evidence >= 0.66 ? L.evidence_strong : c.evidence <= 0.4 ? L.evidence_weak : L.evidence_middling }));
    else { if (!t.data.thanked?.includes(cid)) { (t.data.thanked ||= []).push(cid); t.data.rapport = Math.min(10, t.data.rapport + 1); } lawyerSays(this, t, L.welcome); }
    return {};
  };
  //: Between the hiring and the hearing, word of how it is going; the day before and the hour
  //: before, where to be; after, how it went.
  W.lawyerStep = function () {
    const L = MR(this).lawyer;
    for (const c of this.cases.values()) {
      if (!c.lawyer || c.closed || !c.court) continue;
      const p = this.players.get(c.pid), t = this.thread(`npc:lawyer:${c.pid}:${c.lawyer.id}`);
      if (!p || !t) continue;
      const u = (t.data.updates ||= {}), done = u[c.id] || 0;
      const hired = t.data.hired?.[c.id] ?? c.opened, share = (this.now - hired) / Math.max(HOUR, c.court - hired);
      // Two updates, different ones, chosen by how the evidence looks.
      const lines = c.evidence >= 0.66 ? L.updates_strong : c.evidence <= 0.4 ? L.updates_weak : L.updates_middling;
      const r = rng("lawyer-update", c.id), first = Math.floor(r() * lines.length);
      const second = lines.length > 1 ? (first + 1 + Math.floor(r() * (lines.length - 1))) % lines.length : first;
      if (done < 1 && share >= 0.3) { lawyerSays(this, t, lines[first]); u[c.id] = 1; }
      else if (done < 2 && share >= 0.65) { lawyerSays(this, t, lines[second]); u[c.id] = 2; }
      else if (done < 3 && c.court - this.now <= 20 * HOUR && c.court > this.now) { lawyerSays(this, t, fill(L.day_before, { when: when(this, c.court), court: this.mailCourtName(c) })); u[c.id] = 3; }
      else if (done < 4 && c.court - this.now <= HOUR && c.court > this.now) { lawyerSays(this, t, fill(L.hour_before, { court: this.mailCourtName(c) })); u[c.id] = 4; }
    }
  };
  W.mailCourtName = function (c = null) { return c?.court_name || this.R.business.law.courthouse.name; };
  W.lawyerVerdict = function (p, c, absent) {
    if (!c.lawyer) return;
    const t = this.thread(`npc:lawyer:${p.id}:${c.lawyer.id}`);
    if (!t) return;
    const L = MR(this).lawyer, o = c.verdict?.outcome;
    t.data.rapport = Math.min(10, t.data.rapport + 1);
    lawyerSays(this, t, fill(`${absent ? L.absent : ""}${L.verdict[o] || L.verdict.other}`, { outcome: c.verdict?.name || o, charge: charge(this, c), name: p.name.split(" ")[0] }));
  };

  // ---- the npc side: interviews and the boss --------------------------------------------------------
  //: Applying for a job: an interviewer's questions in your messages; answered, a decision a little
  //: later -- and the interviewer is your boss from then on.
  W.cmd_apply_job = function (pid, { role, place }) {
    const R = this.R, spec = R.jobs.roles[role], I = MR(this).interview;
    if (!spec || !R.jobs.player_jobs.includes(role)) fail("that job is not open to players");
    if (!place?.id || !spec.at.some((k) => (place.keys || []).includes(k))) fail(`a ${spec.title.toLowerCase()} works at ${spec.at.join(" or ")}`);
    const p = this.player(pid);
    if (this.bizAt(place.id)) fail("a player runs that business: apply to its openings in the Jobs tab");
    this.recordCheck(p, role);
    const id = `npc:job:${pid}:${place.id}:${role}`;
    const old = this.thread(id);
    if (old && ["interview", "deciding"].includes(old.data.status)) fail("your interview there is under way: see your messages");
    if (old && old.data.status === "declined" && this.now < old.data.retry) fail(`they will look at a new application ${when(this, old.data.retry)}`);
    if (old && old.data.status === "hired" && p.job?.place?.id === place.id && p.job.role === role) fail("you work there already");
    const where = place.name || "the shop";
    const t = this.openThread(id, () => ({ tab: "npc", kind: "interviewer", name: nameFor(`${place.id}:${role}`), tag: "Interviewer", members: [pid], data: {} }));
    t.kind = "interviewer"; t.tag = "Interviewer";
    const bank = [...(I.questions[role] || []), ...I.questions.any];
    const r = rng("interview", pid, place.id, role, this.now);
    const picked = [];
    while (picked.length < Math.min(I.asked, bank.length)) { const q = bank[Math.floor(r() * bank.length)]; if (!picked.includes(q)) picked.push(q); }
    t.data = { role, title: spec.title, place: { id: String(place.id), x: place.x, z: place.z, name: place.name || null, keys: [...(place.keys || [])] }, qs: picked.map((q) => q.id),
      i: 0, score: 0, status: "interview", started: this.now };
    this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(I.hello, { name: p.name.split(" ")[0], interviewer: t.name, title: spec.title.toLowerCase(), place: where, n: picked.length }) });
    this.askNext(t);
    this.log("applied", { player: pid, role });
    return { thread: t.id };
  };
  const questionById = (w, id) => { const I = MR(w).interview; for (const list of Object.values(I.questions)) { const q = list.find((x) => x.id === id); if (q) return q; } return null; };
  W.askNext = function (t) {
    const q = questionById(this, t.data.qs[t.data.i]);
    this.post(t, { from: "npc", name: t.name, tag: t.tag, text: q.q,
      choices: q.a.map(([label], k) => ({ id: String(k), label, act: { cmd: "interview", args: { q: q.id, k } } })) });
  };
  W.mail_interview = function (pid, { thread, q, k }) {
    const t = this.thread(thread);
    if (!t || t.data.status !== "interview" || t.data.qs[t.data.i] !== q) fail("that question has gone");
    t.data.score += questionById(this, q).a[k]?.[1] ?? 0;
    t.data.i += 1;
    if (t.data.i < t.data.qs.length) { this.askNext(t); return {}; }
    const I = MR(this).interview;
    t.data.status = "deciding"; t.data.decide = this.now + I.decide_minutes * MIN;
    this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(I.thanks, { minutes: I.decide_minutes }) });
    return {};
  };
  //: The decision: the answers, experience in the role, and the record.
  W.interviewStep = function () {
    const I = MR(this).interview;
    for (const t of M(this).threads.values()) {
      if (t.kind !== "interviewer" || t.data.status !== "deciding" || this.now < t.data.decide) continue;
      const pid = t.members[0], p = this.players.get(pid);
      if (!p) continue;
      const most = t.data.qs.length * 2;
      const exp = (p.experience || {})[t.data.role] > 0 ? 1 : 0;
      const score = t.data.score + exp - this.priorsOf(p);
      if (score >= Math.ceil(most * I.pass_share)) {
        try { this.cmd_take_job(pid, { role: t.data.role, place: t.data.place }); }
        catch (error) { t.data.status = "declined"; t.data.retry = this.now + DAY; this.post(t, { from: "npc", name: t.name, tag: t.tag, text: `Sorry -- ${error.message}.` }); continue; }
        t.data.status = "hired"; t.kind = "boss"; t.tag = "Boss";
        const sh = this.shiftNear?.(p.job);
        this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(I.hired, { name: p.name.split(" ")[0], title: t.data.title.toLowerCase(), shift: !sh ? "when you can" : sh.start <= this.now ? "on now, so come in when you can" : when(this, sh.start) }) });
        p.job.boss = t.id;
      } else {
        t.data.status = "declined"; t.data.retry = this.now + DAY;
        this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(I.declined, { when: when(this, t.data.retry) }) });
      }
    }
  };
  //: A boss writes before a shift, after a late start, on a promotion -- and every job has one,
  //: whether it came through an interview or not.
  W.bossStep = function () {
    const B = MR(this).boss;
    for (const p of this.players.values()) {
      if (!p.job?.place?.id) continue;
      let t = p.job.boss ? this.thread(p.job.boss) : null;
      if (!t) {
        t = this.openThread(`npc:job:${p.id}:${p.job.place.id}:${p.job.role}`, () => ({ tab: "npc", kind: "boss", name: nameFor(`${p.job.place.id}:${p.job.role}`), tag: "Boss", members: [p.id],
          data: { role: p.job.role, title: p.job.title, place: p.job.place, status: "hired" } }));
        t.kind = "boss"; t.tag = "Boss"; t.data.status = "hired";
        p.job.boss = t.id;
        if (!t.msgs.length) this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(B.welcome, { name: p.name.split(" ")[0], title: p.job.title.toLowerCase(), place: p.job.place.name || "the shop" }) });
      }
      const d = t.data, soon = p.clocked ? null : startWithin(this, p.job, HOUR);
      if (soon && d.reminded !== soon) {
        d.reminded = soon;
        this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(B.shift_soon, { when: when(this, soon) }) });
      }
      if (p.clocked?.late && d.lateFor !== p.clocked.since) { d.lateFor = p.clocked.since; this.post(t, { from: "npc", name: t.name, tag: t.tag, text: B.late }); }
      if (p.promoted && d.promoted !== p.promoted.at) { d.promoted = p.promoted.at; this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(B.promoted, { title: p.promoted.title, pay: this.R.fmt(p.promoted.pay) }) }); }
    }
    // A boss no longer: the job ended.
    for (const t of M(this).threads.values()) {
      if (t.kind !== "boss" || t.data.status !== "hired") continue;
      const p = this.players.get(t.members[0]);
      if (p && p.job?.boss === t.id) continue;
      t.data.status = "former"; t.tag = "Former boss";
    }
  };

  // ---- the npc side: the cab --------------------------------------------------------------------------
  //: The cab's driver, in their words: on the way, at the kerb, about to go, gone. The view keeps the
  //: cab (it runs on the street graph); the world words it, so a player can not put words in a mouth.
  W.cmd_ride_note = function (pid, { note, minutes = null, seconds = null }) {
    const p = this.player(pid), D = MR(this).driver, m = M(this);
    if (!D[note]) fail("no such note");
    let t = m.ride[pid] ? this.thread(m.ride[pid]) : null;
    if (note === "coming" || !t) {
      const ride = (m.rideSeq = (m.rideSeq || 0) + 1);
      const name = nameFor(`cab:${pid}:${ride}`);
      t = this.openThread(`npc:driver:${pid}:${name}`, () => ({ tab: "npc", kind: "driver", name, tag: "Cab driver", members: [pid], data: {} }));
      t.data = { ride, extend: false };
      m.ride[pid] = t.id;
    }
    const choices = note === "here" || note === "leaving" ? [{ id: "wait", label: D.wait_ask, act: { cmd: "ride_wait", args: {} } }] : null;
    const sent = this.post(t, { from: "npc", name: t.name, tag: t.tag, text: fill(D[note], { name: p.name.split(" ")[0], minutes: Math.max(1, Math.round(minutes || 1)), seconds: Math.round(seconds || 0) }), choices });
    if (note === "left" || note === "aboard") for (const x of t.msgs) if (x.choices) x.expired = true;
    return { thread: t.id, message: sent.id };
  };
  //: Asking the driver to hang on: once a ride, a minute more (the view reads ``extend``).
  W.mail_ride_wait = function (pid, { thread }) {
    const t = this.thread(thread);
    if (!t || t.data.extend) fail("the driver can not wait any longer");
    t.data.extend = true;
    for (const x of t.msgs) if (x.choices) x.answered[pid] ??= "wait";
    this.post(t, { from: "npc", name: t.name, tag: t.tag, text: MR(this).driver.waiting_more });
    return {};
  };
  W.rideState = function (pid) { const m = M(this), t = m.ride[pid] ? this.thread(m.ride[pid]) : null; return t ? { ride: t.data.ride, extend: t.data.extend } : null; };

  //: What an npc says back to free text: a word that it was heard.
  W.npcHeard = function (t, pid, text) {
    const H = MR(this).heard;
    const said = H[t.kind] || H.other;
    if (t.kind === "lawyer" && /thank/i.test(text)) { const cid = t.data.cases[t.data.cases.length - 1]; if (cid && !t.data.thanked?.includes(cid)) { (t.data.thanked ||= []).push(cid); t.data.rapport = Math.min(10, t.data.rapport + 1); } }
    this.post(t, { from: "npc", name: t.name, tag: t.tag, text: said[Math.floor(rng("heard", t.id, t.msgs.length)() * said.length)] });
  };

  // ---- system: City Hall, the day, notices, jury duty ---------------------------------------------
  const hall = (w) => w.openThread("sys:hall", () => ({ tab: "system", kind: "hall", name: "City Hall", tag: "Official", members: "all" }));
  const notices = (w, pid) => w.openThread(`sys:notices:${pid}`, () => ({ tab: "system", kind: "notices", name: "Notices", tag: "Official", members: [pid] }));
  const daily = (w) => w.openThread("sys:daily", () => ({ tab: "system", kind: "daily", name: "Kerbside today", tag: "Daily", members: "all" }));
  W.measureProposed = function (m) {
    const law = this.laws[m.key];
    this.post(hall(this), { from: "system", name: "City clerk", text: fill(MR(this).hall.proposed, { by: nameOf(this, m.by), label: m.label, value: m.value, now: law ?? "the default", closes: when(this, m.closes) }),
      choices: [{ id: "yes", label: "Vote yes", act: { cmd: "vote", args: { measure: m.id, yes: true } } }, { id: "no", label: "Vote no", act: { cmd: "vote", args: { measure: m.id, yes: false } } }] });
  };
  W.measureTallied = function (m) {
    const t = hall(this), H = MR(this).hall;
    for (const x of t.msgs) if (x.choices?.some((c) => c.act.args.measure === m.id)) x.expired = true;
    const yes = Object.values(m.votes).filter(Boolean).length, voters = Object.keys(m.votes).length;
    this.post(t, { from: "system", name: "City clerk", text: fill(m.status === "passed" ? H.passed : H.failed, { label: m.label, value: m.value, yes, no: voters - yes }) });
  };
  //: A notice for every bill as it comes, its late penalty, and a summons; jury duty now and then.
  W.noticeStep = function () {
    const m = M(this), N = MR(this).notices;
    for (const p of this.players.values()) {
      const seen = (m.seen[p.id] ||= {});
      for (const b of this.billing.bills.values()) {
        if (b.payer !== p.account) continue;
        const k = b.id;
        if (seen[k] === undefined && b.status === "open") {
          seen[k] = b.stage || 0;
          const choices = [{ id: "pay", label: `Pay ${this.R.fmt(b.owed)}`, act: { cmd: "pay_bill", args: { bill: b.id } } }];
          if (citations.includes(b.kind)) choices.push({ id: "contest", label: "Contest it", act: { cmd: "contest", args: { bill: b.id } } });
          this.post(notices(this, p.id), { from: "system", name: N.from[b.kind] || N.from.other, text: fill(this.R.fines?.[b.kind] !== undefined ? N.fine : N.bill, { memo: b.memo || b.kind, amount: this.R.fmt(b.owed), due: when(this, b.due) }), choices });
        }
        // A late penalty added: the bill again, dearer.
        if (typeof seen[k] === "number" && b.status === "open" && (b.stage || 0) > seen[k]) { seen[k] = b.stage; this.post(notices(this, p.id), { from: "system", name: N.from.other, text: fill(N.late, { memo: b.memo || b.kind, amount: this.R.fmt(b.owed) }) }); }
        if (seen[k] !== undefined && b.status !== "open") for (const x of notices(this, p.id).msgs) if (x.choices?.some((c) => c.act.args.bill === b.id)) x.expired = true;
      }
      for (const c of this.cases.values()) {
        if (c.pid !== p.id || !c.summons || !c.court || seen[`summons:${c.id}`]) continue;
        seen[`summons:${c.id}`] = 1;
        this.post(notices(this, p.id), { from: "system", name: N.from.court, text: fill(N.summons, { memo: c.memo || c.charge, when: when(this, c.court), court: this.mailCourtName(c) }) });
      }
      for (const c of this.cases.values()) {
        if (c.pid !== p.id || !c.verdict || seen[`verdict:${c.id}`] || c.lawyer) continue;
        seen[`verdict:${c.id}`] = 1;
        this.post(notices(this, p.id), { from: "system", name: N.from.court, text: fill(N.verdict, { memo: c.memo || c.charge, outcome: c.verdict.name }) });
      }
    }
  };
  //: Jury duty: a summons for a hearing a few days on, now and then (a party member's hearing
  //: when there is one, a resident's otherwise), at most one a month; serve it at the court.
  W.juryStep = function (newDay) {
    if (!newDay) return;
    const J = this.R.business.law.jury, m = M(this);
    for (const p of this.players.values()) {
      if (this.now - (m.jurySince[p.id] || 0) < J.every_days * DAY || this.now - p.joined < J.after_days * DAY) continue;
      const theirs = [...this.cases.values()].find((c) => c.pid !== p.id && c.court && !c.closed && c.court - this.now > DAY && !c.jurors?.length);
      if (!theirs && rng("jury", p.id, this.time.day)() > J.daily_chance) continue;
      const court = theirs ? theirs.court : this.courtTime(J.notice_days, `jury:${p.id}:${this.time.day}`);
      const accused = theirs ? nameOf(this, theirs.pid) : nameFor(`jury:${p.id}:${this.time.day}`);
      if (theirs) (theirs.jurors ||= []).push(p.id);
      m.jurySince[p.id] = this.now;
      const s = { id: this.id("jury"), at: court, accused, status: "summoned", deferred: false };
      (p.jury ||= []).push(s);
      this.post(notices(this, p.id), { from: "system", name: this.R.messages.notices.from.court, ui: { jury: s.id },
        text: fill(this.R.messages.notices.jury, { accused, when: when(this, court), court: this.mailCourtName(), fee: this.R.fmt(J.fee_base) }),
        choices: [{ id: "yes", label: "I will be there", act: { cmd: "jury_confirm", args: { summons: s.id } } }, { id: "defer", label: "Ask to defer a week", act: { cmd: "jury_defer", args: { summons: s.id } } }] });
    }
    // Service missed: noted, once.
    for (const p of this.players.values()) for (const s of p.jury || []) {
      if (s.status === "served" || s.status === "missed" || this.now < s.at + this.R.business.law.attend_hours[1] * HOUR) continue;
      s.status = "missed";
      this.post(notices(this, p.id), { from: "system", name: this.R.messages.notices.from.court, text: this.R.messages.notices.jury_missed });
    }
  };
  const summonsOf = (p, id) => (p.jury || []).find((s) => s.id === id) || fail("no such summons");
  W.mail_jury_confirm = function (pid, { summons }) { const s = summonsOf(this.player(pid), summons); s.status = "confirmed"; return {}; };
  W.mail_jury_defer = function (pid, { summons, thread }) {
    const p = this.player(pid), s = summonsOf(p, summons);
    if (s.deferred) fail("a summons is deferred once");
    s.deferred = true; s.status = "confirmed"; s.at = this.courtTime(7 + this.R.business.law.jury.notice_days, `defer:${s.id}`);
    this.post(this.thread(thread), { from: "system", name: this.R.messages.notices.from.court, text: fill(this.R.messages.notices.jury_deferred, { when: when(this, s.at) }) });
    return {};
  };
  //: Serving: at the court on the day, in its hours; the court pays the juror's fee.
  W.cmd_serve_jury = function (pid, { summons, court = null }) {
    const p = this.player(pid), L = this.R.business.law, s = summonsOf(p, summons);
    if (s.status === "served") fail("served already: thank you");
    const [from, to] = L.attend_hours;
    if (this.now < s.at + from * HOUR) fail(`jury service is ${when(this, s.at)}`);
    if (this.now > s.at + to * HOUR) fail("that day's hearing is over");
    const C = L.courthouse;
    if (court && (court.keys || []).includes("use:civic")) { if (!this.near(p, court, C.reach_m)) fail(`go to the court first: ${court.name || "the civic building"}`); }
    else if (p.lon === undefined || Math.hypot((p.lon - C.lon) * 88_000, (p.lat - C.lat) * 111_320) > C.reach_m) fail(`go to the court first: ${C.address}`);
    s.status = "served";
    this.ledger.mint(p.account, L.jury.fee_base, "public_contract", { kind: "juror_fee", memo: `Jury service: ${s.accused}`, at: this.now, key: `jury:${s.id}` });
    this.post(notices(this, p.id), { from: "system", name: this.R.messages.notices.from.court, text: fill(this.R.messages.notices.jury_served, { fee: this.R.fmt(L.jury.fee_base) }) });
    this.log("jury", { player: pid });
    return { fee: L.jury.fee_base, balance: this.ledger.balance(p.account) };
  };
  //: The day in Kerbside, posted at the turn of the day: what the log saw since the last one.
  W.digest = function () {
    const m = M(this), D = MR(this).daily;
    const from = m.digestFrom ?? this.now - DAY;
    const ev = this.events.filter((e) => e.t >= from && e.t < this.now);
    const count = (k) => ev.filter((e) => e.kind === k).length;
    const lines = [];
    for (const e of ev.filter((x) => x.kind === "measure")) lines.push(fill(e.status === "passed" ? D.measure_passed : D.measure_failed, { label: this.R.initiatives.adjustable[e.key]?.label || e.key, value: e.value }));
    const named = (k, text) => { const n = count(k); if (n) lines.push(fill(text, { n, s: n === 1 ? "" : "s" })); };
    named("join", D.joined); named("hired", D.hired); named("promoted", D.promoted); named("business", D.business);
    named("verdict", D.verdicts); named("jail", D.jail); named("speeding", D.speeding); named("collision", D.collisions);
    named("struck_person", D.assaults); named("theft", D.thefts); named("jury", D.jury);
    const fines = [...this.billing.bills.values()].filter((b) => b.issued >= from && b.issued < this.now && this.R.fines?.[b.kind] !== undefined);
    if (fines.length) lines.push(fill(D.fines, { n: fines.length, s: fines.length === 1 ? "" : "s", total: this.R.fmt(fines.reduce((s, b) => s + b.amount, 0)) }));
    const laws = Object.entries(this.laws);
    if (laws.length) lines.push(fill(D.laws, { laws: laws.map(([k, v]) => `${this.R.initiatives.adjustable[k]?.label || k} ${v}`).join("; ") }));
    m.digestFrom = this.now;
    const t = this.time;
    this.post(daily(this), { from: "system", name: "Kerbside today", text: `${D.title.replace("{day}", t.label.slice(0, 3))}\n${lines.length ? lines.map((x) => `• ${x}`).join("\n") : D.quiet}` });
  };

  // ---- the neighbours and the council ---------------------------------------------------------------
  //: Who lives in which neighbourhood: a bought home's own place, else where the player was when
  //: they were given a home.
  W.hoodOf = function (p) {
    const m = M(this);
    if (!p.home) return null;
    const key = String(p.home.building || p.home.room);
    const cached = m.hood[p.id];
    if (cached && cached.home === key) return cached.name;
    const a = p.home.room && this.registry.assets.get(p.home.room);
    const lon = a?.attrs?.lon ?? p.lon, lat = a?.attrs?.lat ?? p.lat;
    if (lon === undefined || lat === undefined) return null;
    const name = neighbourhoodAt(this.R, lon, lat, a?.attrs?.county || p.county).name;
    m.hood[p.id] = { home: key, name };
    return name;
  };
  W.groupsStep = function () {
    const council = this.openThread("council", () => ({ tab: "players", kind: "council", name: "Kerbside council", tag: "Everyone", members: "all" }));
    if (!council.msgs.length) this.post(council, { from: "system", text: MR(this).council.hello });
    const hoods = new Map();
    for (const p of this.players.values()) { const n = this.hoodOf(p); if (n) { if (!hoods.has(n)) hoods.set(n, []); hoods.get(n).push(p.id); } }
    for (const t of M(this).threads.values()) if (t.kind === "neighbours" && !hoods.has(t.name)) t.members = [];
    for (const [name, ids] of hoods) {
      const t = this.openThread(`hood:${name}`, () => ({ tab: "players", kind: "neighbours", name, tag: "Neighbours", members: [] }));
      for (const id of ids) if (!t.members.includes(id)) { t.members.push(id); this.post(t, { from: "system", text: fill(MR(this).council.moved_in, { name: nameOf(this, id), hood: name }) }); }
      t.members = t.members.filter((id) => ids.includes(id));
    }
  };

  // ---- the world's hooks ------------------------------------------------------------------------------
  W.mailStep = function () {
    const m = M(this), day = this.time.day, newDay = m.day !== null && m.day !== day;
    if (m.day === null) { m.day = day; m.digestFrom = this.now; }
    this.groupsStep(); this.lawyerStep(); this.interviewStep(); this.bossStep(); this.noticeStep(); this.juryStep(newDay);
    if (newDay) { m.day = day; this.digest(); }
  };
  const wrap = (name, after) => { const fn = W[name]; W[name] = function (...args) { const r = fn.apply(this, args); after.call(this, r, ...args); return r; }; };
  wrap("step", function () { this.mailStep(); });
  // The view says where the hearing is held when the district is not the courthouse's (its civic building).
  wrap("cmd_hire_lawyer", function (r, pid, args) { if (args?.court?.name) r.case.court_name = clip(args.court.name, 80); this.lawyerHired(pid, r.case); });
  wrap("decide", function (r, p, c, absent) { this.lawyerVerdict(p, c, absent); });
  wrap("cmd_propose", function (r) { this.measureProposed(r.measure); });
  wrap("tally", function (m) { this.measureTallied(m); });
  // A lawyer you know: a little off for every case together (at most so much).
  const price = W.lawyerPrice;
  W.lawyerPrice = function (p, l, c) {
    const base = price.call(this, p, l, c), r = this.rapportWith(p.id, l.id);
    if (!base || !r) return base;
    const unit = this.R.money(25), off = Math.min(MR(this).lawyer.most_off, MR(this).lawyer.off_per_rapport * r);
    return Math.round(base * (1 - off) / unit) * unit;
  };
  const toJSON = W.toJSON;
  W.toJSON = function () { const o = toJSON.call(this); o.mail = mailJSON(M(this)); return o; };
  const fromJSON = CityWorld.fromJSON;
  CityWorld.fromJSON = function (R, o) { const w = fromJSON.call(this, R, o); w.mail = mailLoad(o.mail); return w; };
}

//: The start of a shift of the job's in the next ``within`` ms, if one starts then.
function startWithin(w, job, within) {
  const spec = w.R.jobs.roles[job.role];
  const shifts = job.shifts || (spec?.shifts || []).map(([from, to]) => ({ days: spec.days === "weekdays" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6], from, to }));
  for (const dd of [0, 1]) {
    const t = cityTime(w.now + dd * DAY, w.R.clock.zone), midnight = w.now + dd * DAY - t.minute * MIN;
    for (const s of shifts) {
      const start = midnight + s.from * HOUR;
      if (s.days.includes(t.weekday) && start > w.now && start - w.now <= within) return start;
    }
  }
  return null;
}
function mailJSON(m) { return { ...m, threads: [...m.threads.values()] }; }
function mailLoad(o) {
  const m = fresh();
  if (!o) return m;
  Object.assign(m, o, { threads: new Map((o.threads || []).map((t) => [t.id, t])) });
  return m;
}
