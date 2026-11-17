// The city's server: it holds the world, and it alone decides what happens in it.
//
// A browser is a client. It signs in (auth.mjs), sends the actions its player takes, and is
// shown its own part of the world (views.mjs). For every command the server:
//
//   1. reads who is asking from the session token -- never from the command;
//   2. loads the one world from the store and brings it up to the server's clock;
//   3. checks the command's shape, the player's position (on the map; no further than they could
//      have travelled) and rate, and replaces every place and listing in it with the city's own
//      record (canon.mjs), so prices, sizes and locations are the server's;
//   4. runs it on that loaded copy (docs/city/world.mjs decides: funds, reach, inventory, title);
//   5. if the world refused it, drops the copy -- nothing of a failed command is kept, so money
//      cannot leave without the thing it paid for arriving;
//   6. otherwise commits the whole new state and a journal line in one compare-and-swap. If
//      another instance committed first, it starts again from that instance's result.
//
// There is one world (``worldId``), whatever room a party is in: a party is who you can see
// walking, not a separate economy. Money enters only by the world's own rules and by backend
// grants claimed here; nothing is ever read from a browser's saved game.
import { clockOf } from "../../docs/city/clock.mjs";
import { CityWorld } from "../../docs/city/world.mjs";
import { openSession, readSession, keyHash, KEY_PATTERN } from "./auth.mjs";
import { Refused } from "./canon.mjs";
import { eligible, position, rate, sanitize } from "./guard.mjs";
import {INTERIOR_COMMANDS,sanitizeInterior,prepareInterior} from "./interiors.mjs";
import { applyWelcome, repairWelcome } from "./welcome.mjs";
import { viewFor } from "./views.mjs";

export const WORLD_ID = "kerbside";
//: With nobody acting, the world is still brought up to the clock and saved this often (real ms).
const IDLE_STEP_MS = 20_000;
//: How often a command is run again on top of another instance's commit before it gives up.
const TRIES = 12;
const pause = (i) => new Promise((done) => setTimeout(done, i ? 4 + Math.random() * 12 * i : 0));
const freshServer = () => ({ pos: {}, rate: {}, found: {}, reqs: {}, stepped: 0 });

export class CityAuthority {
  //: ``voices``: whether a model answers for the city's people (server/npc): the world then leaves
  //: a real question in a thread unanswered, for the server to answer (``say``).
  constructor({ R, canon, store, secret, worldId = WORLD_ID, now = () => Date.now(), voices = false }) {
    Object.assign(this, { R, canon, store, secret, worldId, now, voices, cache: null, line: Promise.resolve() });
  }
  //: One at a time within this instance (it never races itself); other instances are told apart
  //: by the store's compare-and-swap.
  inTurn(work) {
    const run = this.line.then(work, work);
    this.line = run.catch(() => {});
    return run;
  }
  gameNow(real = this.now()) { return clockOf(this.R).game(real); }

  //: One request: {op, ...}. Always answers {ok, ...}; never throws at the caller for a client's
  //: mistake (a store that cannot be reached is the caller's to report).
  async handle(body) {
    if (!body || typeof body !== "object") return { ok: false, error: "nothing asked" };
    if (body.op === "session") {
      if(typeof body.key!=="string"||!KEY_PATTERN.test(body.key))return{ok:false,error:"not an account"};
      const identity=await this.store.identityFor?.(keyHash(body.key))||null;
      const s = openSession(this.secret, body.key, this.now(),identity);
      return s ? { ok: true, ...s, world: this.worldId } : { ok: false, error: "not an account" };
    }
    const session = readSession(this.secret, body.token, this.now());
    if (!session) return { ok: false, error: "sign in again", code: "session" };
    if(this.store.identityFor&&(await this.store.identityFor(session.kh)||null)!==(session.aid||null))return{ok:false,error:"your account changed: sign in again",code:"session"};
    if (body.op === "sync") return this.inTurn(() => this.sync(session, body.since));
    if (body.op === "cmd") return this.inTurn(() => this.command(session, body));
    if (body.op === "grants") return this.inTurn(() => this.grants(session));
    return { ok: false, error: "no such request" };
  }

  //: The world as stored, brought up to now: {version, world, srv}.
  async load() {
    let doc = this.cache;
    const version = await this.store.version(this.worldId);
    if (!doc || doc.version !== version) doc = version ? await this.store.load(this.worldId) : null;
    this.cache = doc;
    const world = doc ? CityWorld.fromJSON(this.R, structuredClone(doc.state.world)) : new CityWorld(this.R, { now: this.gameNow(), seed: this.worldId });
    world.knowTenants?.(this.canon.tenants);
    world.voices = Boolean(this.voices);
    world.step(this.gameNow());
    return { version: doc?.version ?? 0, world, srv: doc ? structuredClone(doc.state.server) : freshServer() };
  }
  async commit(version, world, srv, entry, opts) {
    const state = { world: JSON.parse(JSON.stringify(world.toJSON())), server: srv };
    const done = await this.store.commit(this.worldId, version, state, entry, opts);
    this.cache = done.ok ? { version: done.version, state } : null;
    return done;
  }
  answer(world, pid, version, extra = {}) {
    return { ok: true, version, now: world.now, you: pid, state: viewFor(world, pid), ...extra };
  }

  async sync(session, since) {
    for (let i = 0; i < TRIES; i += 1) {
      await pause(i);
      const { version, world, srv } = await this.load();
      const real = this.now();
      // A starter restaurant given at a place that is not one to look at is moved to a real one (welcome.mjs).
      const moved = repairWelcome(world, this.canon, srv, session);
      if (moved) {
        srv.stepped = real;
        const done = await this.commit(version, world, srv, { pid: session.pid, command: "welcome_moved", args: moved, at: world.now, real });
        if (done.ok) return this.answer(world, session.pid, done.version, { welcome_moved: moved });
        continue;
      }
      if (version && real - (srv.stepped || 0) < IDLE_STEP_MS) {
        return since === version ? { ok: true, version, now: world.now, you: session.pid, unchanged: true } : this.answer(world, session.pid, version);
      }
      srv.stepped = real;
      const done = await this.commit(version, world, srv, null);
      if (done.ok) return this.answer(world, session.pid, done.version);
    }
    return { ok: false, error: "the city is busy: try again", code: "busy" };
  }

  async command(session, { req = null, command, args }) {
    const pid = session.pid;
    if (typeof command !== "string" || command.length > 60) return { ok: false, error: "no such command" };
    const id = typeof req === "string" ? req.slice(0, 64) : null;
    let clean;
    try { clean = INTERIOR_COMMANDS.has(command)?sanitizeInterior(args):sanitize(args); } catch (error) { return this.refused(error); }
    for (let i = 0; i < TRIES; i += 1) {
      await pause(i);
      const { version, world, srv } = await this.load();
      // The same request sent again (a retry after a lost answer) is answered, not done twice.
      if (id && srv.reqs[pid]?.id === id) return this.answer(world, pid, version, { result: srv.reqs[pid].result, repeated: true });
      const real = this.now();
      let result;
      try {
        rate(srv, pid, real);
        const here = position(this.canon, srv, pid, clean.at, real);
        const canonical = INTERIOR_COMMANDS.has(command)?prepareInterior(world,this.canon,srv,pid,command,{...clean,at:here}):this.canon.canonical(command, { ...clean, at: here }, { week: Math.floor(world.time.day / 7) });
        result = world.submit(pid, command, eligible(world, this.canon, srv, pid, command, canonical, here));
        clean = { ...clean, at: here };
      } catch (error) {
        if (error instanceof Refused) return this.refused(error, version);
        throw error;
      }
      // Refused by the world's own rules: the copy it ran on is dropped, whatever it had got to.
      if (!result.ok) return { ok: true, version, result };
      const p = world.players.get(pid);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) srv.pos[pid] = { x: p.x, z: p.z, t: real };
      if (id) srv.reqs[pid] = { id, result };
      srv.stepped = real;
      const done = await this.commit(version, world, srv, { pid, command, args: clean, at: world.now, real });
      if (done.ok) return this.answer(world, pid, done.version, { result });
    }
    return { ok: false, error: "the city is busy: try again", code: "busy" };
  }
  refused(error, version) {
    return { ok: true, version, result: { ok: false, error: error.message, code: error.code || "refused" } };
  }

  //: A character's reply written into a conversation of this player's (server/npc): the server's
  //: own doing, not a command a client can send.
  say(session, threadId, text) {
    return this.inTurn(async () => {
      for (let i = 0; i < TRIES; i += 1) {
        await pause(i);
        const { version, world, srv } = await this.load();
        const t = world.thread?.(threadId);
        if (!t || t.tab !== "npc" || !(t.members || []).includes(session.pid)) return { ok: false, error: "not a conversation of yours" };
        world.post(t, { from: "npc", name: t.name, tag: t.tag, text: String(text).slice(0, 700) });
        const done = await this.commit(version, world, srv, { pid: session.pid, command: "npc_say", args: { thread: threadId }, at: world.now, real: this.now() });
        if (done.ok) return { ok: true, version: done.version };
      }
      return { ok: false, error: "the city is busy: try again", code: "busy" };
    });
  }

  //: Backend money for this session's device account, into its wallet: each grant minted and
  //: marked claimed in the one commit, so it is paid once whatever fails in between.
  async grants(session) {
    const pending = await this.store.pendingGrants?.(session.kh) || [];
    let welcome = session.aid ? await this.store.welcomeFor?.(session.aid) : null;
    if (!pending.length && !welcome) return { ok: true, granted: [] };
    for (let i = 0; i < TRIES; i += 1) {
      await pause(i);
      const { version, world, srv } = await this.load();
      if (!world.players.has(session.pid)) return { ok: true, granted: [], waiting: true };
      const granted = [];
      if (i && welcome) welcome = await this.store.welcomeFor(session.aid);
      let starter = null;
      if (welcome) {
        starter = applyWelcome(world, this.canon, srv, session, welcome);
        granted.push({ id: starter.grant_id, amount: starter.amount });
      }
      for (const g of pending) {
        try { if (!world.accountGrant(session.pid, g.id, g.amount).already) granted.push(g); } catch { /* not a grant the world takes */ }
      }
      const done = await this.commit(version, world, srv, { pid: session.pid, command: "account_grant", args: { grants: granted.map((g) => g.id) }, at: world.now, real: this.now() },
        { grants: pending.map((g) => g.id), welcomeAccount: starter ? session.aid : null });
      if (done.ok) return this.answer(world, session.pid, done.version, { granted: granted.map((g) => ({ id: g.id, amount: g.amount })), ...(starter ? { welcome: starter } : {}) });
      if (done.why) return { ok: true, granted: [] };
    }
    return { ok: false, error: "the city is busy: try again", code: "busy" };
  }
}
