// Talking to the city's people, as the server does it (deployed at /api/npc).
//
// A request says who is being spoken to and what was said. The server:
//
//   1. reads who is speaking from the city session token (never from the request);
//   2. sorts the message itself (docs/city/npc-talk.mjs): a greeting, thanks or an opening line is
//      answered from the character's set lines and no model is called;
//   3. otherwise builds the prompt (prompt.mjs): the guidelines every character shares, the
//      character's cached sheet, and what that character may know of this player -- read from
//      the server's own world (share.mjs), so a banker reads the real credit file whatever the
//      page claims;
//   4. calls the model (deepseek.mjs). With no key set up, a limit reached, or the model failing,
//      the character answers with a set line instead: a conversation never hangs or errors.
//
// A decision is never the model's. For a loan the bank's own figures are worked out first and
// handed to the banker as a DECISION to explain. For a conversation kept in the world (a lawyer,
// a boss), the reply is written into the thread by the server (CityAuthority.say).
import { bankersAt } from "../../docs/city/credit.mjs";
import { fallbackLine, setLine, sortMessage, talkText, TALK_HISTORY_MAX, TALK_ROLES } from "../../docs/city/npc-talk.mjs";
import { readSession } from "../city/auth.mjs";
import { chat, modelConfig } from "./deepseek.mjs";
import { buildMessages, sheetFromContext, sheetFromPersona } from "./prompt.mjs";
import { playerShare } from "./share.mjs";

//: Model calls a player may make: so many in a window (per warm instance).
export const LIMIT = { calls: 24, window_ms: 10 * 60_000 };
const THREAD_ROLE = { lawyer: "lawyer", boss: "boss", interviewer: "interviewer", driver: "driver" };
const OCCUPATION = { banker: "office", lawyer: "office", boss: "retail", interviewer: "office", driver: "transport", shopkeeper: "retail", doctor: "care" };

export class NpcService {
  constructor({ city, model = null, fetch = globalThis.fetch, now = () => Date.now(), limit = LIMIT }) {
    Object.assign(this, { city, model, fetch, now, limit, calls: new Map(), asked: 0, answered: 0 });
  }
  allowed(pid) {
    const t = this.now(), list = (this.calls.get(pid) || []).filter((x) => t - x < this.limit.window_ms);
    if (list.length >= this.limit.calls) { this.calls.set(pid, list); return false; }
    list.push(t); this.calls.set(pid, list);
    if (this.calls.size > 5000) this.calls.delete(this.calls.keys().next().value);
    return true;
  }
  async handle(body) {
    if (!body || typeof body !== "object") return { ok: false, error: "nothing asked" };
    if (body.op !== "talk") return { ok: false, error: "no such request" };
    const session = readSession(this.city.secret, body.token, this.now());
    if (!session) return { ok: false, error: "sign in again", code: "session" };
    return this.talk(session, body);
  }
  async talk(session, body) {
    const pid = session.pid, R = this.city.R;
    const text = talkText(body.text), turn = Math.max(0, body.turn | 0);
    const sorted = sortMessage(text, { opening: Boolean(body.opening) });
    const { world } = await this.city.load();
    // Who is being spoken to: a thread's character, a bank's banker, or a resident (their cached sheet).
    let sheet, role = TALK_ROLES.includes(body.role) ? body.role : "resident", thread = null, history = [], task = null;
    if (body.thread) {
      thread = world.thread?.(String(body.thread));
      if (!thread || thread.tab !== "npc" || !(thread.members || []).includes(pid)) return { ok: false, error: "not a conversation of yours" };
      role = THREAD_ROLE[thread.kind] || "resident";
      sheet = sheetFromPersona({ id: thread.id, name: thread.name, title: thread.tag || role, role, occupation: OCCUPATION[role] || "other" });
      history = thread.msgs.slice(-TALK_HISTORY_MAX - 1, -1).filter((m) => m.text).map((m) => ({ from: m.from === pid ? "me" : "npc", text: String(m.text).slice(0, 400) }));
    } else if (role === "banker") {
      const place = this.city.canon.place(body.place?.id ?? body.place);
      const banker = place && (place.keys || []).includes("shop:bank") ? bankersAt(R, place).find((b) => b.id === body.banker) : null;
      if (!banker) return { ok: false, error: "no such banker" };
      sheet = sheetFromPersona({ id: banker.id, name: banker.name, title: banker.title, role: "banker", employer: place.name || "the bank", occupation: "office", years: banker.years, manner: banker.style });
      sheet.job.handles = banker.handles;
      // The bank's answer is worked out by the world; the banker only explains it.
      if (body.ask && typeof body.ask === "object" && world.players.has(pid)) {
        const args = this.city.canon.canonical("loan_quote", { product: body.ask.product, amount: body.ask.amount, months: body.ask.months, bill: body.ask.bill, place: { id: place.id }, banker: banker.id },
          { week: Math.floor(world.time.day / 7) });
        const p = world.players.get(pid);
        Object.assign(p, { x: place.x, z: place.z });   // on this copy only: the question is asked at the desk
        const q = world.submit(pid, "loan_quote", args);
        const d = q.ok ? q.quote : null;
        task = { instruction: "Tell the player the bank's decision on what they asked to borrow, and the one or two things in their file that moved it most. Three or four sentences.",
          decision: d ? { approved: d.approved, loan: d.name, amount: R.fmt(d.amount), months: d.months, rate: d.approved ? `${(d.rate * 100).toFixed(2)}% a year` : null, monthly_payment: d.approved ? R.fmt(d.monthly) : null,
            total_interest: d.approved ? R.fmt(d.interest) : null, most_we_would_lend: d.max !== undefined ? R.fmt(d.max) : null, why: d.reasons } : { approved: false, why: [q.error] } };
      }
    } else sheet = sheetFromContext(R, body.npc && typeof body.npc === "object" ? body.npc : {});
    if (!thread) history = (Array.isArray(body.history) ? body.history : []).slice(-TALK_HISTORY_MAX).map((m) => ({ from: m?.from === "npc" ? "npc" : "me", text: talkText(m?.text) })).filter((m) => m.text);
    const who = { id: sheet.identity.id, name: sheet.identity.name, title: sheet.job?.title, tone: sheet.tone.family, role };
    const done = async (reply, source, extra = {}) => {
      if (thread) await this.city.say(session, thread.id, reply);
      return { ok: true, reply, source, ...extra };
    };
    // In a thread the world has already answered a set line (and everything, where no model is set up).
    if (thread && (sorted.route === "set" || !this.model)) return { ok: true, reply: null, source: "set" };
    if (sorted.route === "set" && !task) return done(setLine(sorted.intent, who, turn), "set");
    this.asked += 1;
    if (!this.model) return done(fallbackLine(who, turn), "fallback", { code: "no_model" });
    if (!this.allowed(pid)) return done(fallbackLine(who, turn), "fallback", { code: "limit" });
    try {
      const out = await chat(this.model, buildMessages({ sheet, share: playerShare(world, pid, role), text, history, task }), { fetch: this.fetch, maxTokens: task ? 700 : 500 });
      this.answered += 1;
      return done(out.text, "ai", { model: this.model.model });
    } catch (error) {
      console.error("kerbside npc:", error?.code || "", error?.message || error);
      return done(fallbackLine(who, turn), "fallback", { code: error?.code || "model_down" });
    }
  }
}

let shared = null;
export function npcService(city, env = process.env) {
  if (!city) return null;
  if (!shared || shared.city !== city) shared = new NpcService({ city, model: modelConfig(env) });
  return shared;
}
