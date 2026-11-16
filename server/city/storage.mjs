// Where the one world is kept: a single versioned record, changed only by compare-and-swap.
//
// A store holds, for a world id, {version, state}. ``commit(id, expect, state, entry)`` writes
// the new state only if the stored version is still ``expect`` -- the whole of a command's
// effects (money, title, inventory, the journal line, a backend grant marked claimed) in one
// step, or none of them. Two servers that both loaded version 7 cannot both write version 8:
// the second is told so, loads the first's result and runs its command again on top of it. That
// is what keeps one history however many instances, restarts or reconnects there are.
//
//   MemoryStore    tests, and a server with nothing to outlive it
//   FileStore      one machine: a JSON file, replaced whole (written beside, then renamed)
//   SupabaseStore  the deployed city: kerbside_city_load / kerbside_city_commit
//                  (supabase/kerbside_city_server.sql), closed to everyone but this server
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class MemoryStore {
  constructor() { this.worlds = new Map(); this.journal = []; this.claimed = new Set(); this.grants = []; }
  async load(id) { const w = this.worlds.get(id); return w ? { version: w.version, state: structuredClone(w.state) } : null; }
  async version(id) { return this.worlds.get(id)?.version ?? 0; }
  async commit(id, expect, state, entry = null, { grants = [] } = {}) {
    const now = this.worlds.get(id)?.version ?? 0;
    if (now !== expect) return { ok: false, version: now };
    if (grants.some((g) => this.claimed.has(g))) return { ok: false, version: now, why: "a grant was claimed already" };
    for (const g of grants) this.claimed.add(g);
    this.worlds.set(id, { version: expect + 1, state: structuredClone(state) });
    if (entry) this.journal.push({ world: id, version: expect + 1, ...entry });
    return { ok: true, version: expect + 1 };
  }
  //: Money the backend has put in a device account and no wallet has had: [{id, amount}].
  async pendingGrants(keyHash) { return this.grants.filter((g) => g.key_sha256 === keyHash && !this.claimed.has(g.id)).map((g) => ({ id: g.id, amount: g.amount })); }
}

export class FileStore extends MemoryStore {
  constructor(path) {
    super(); this.path = path;
    try {
      const saved = JSON.parse(readFileSync(path, "utf8"));
      this.worlds = new Map(saved.worlds || []); this.claimed = new Set(saved.claimed || []); this.grants = saved.grants || [];
    } catch { /* a new world */ }
  }
  async commit(id, expect, state, entry = null, opts = {}) {
    const done = await super.commit(id, expect, state, entry, opts);
    if (done.ok) {
      mkdirSync(dirname(this.path), { recursive: true });
      const beside = `${this.path}.${process.pid}.tmp`;
      writeFileSync(beside, JSON.stringify({ worlds: [...this.worlds], claimed: [...this.claimed], grants: this.grants }));
      renameSync(beside, this.path);
      if (this.journal.length > 2000) this.journal.splice(0, this.journal.length - 1000);
    }
    return done;
  }
}

export class SupabaseStore {
  //: ``url`` and ``key`` are the project's and its publishable key; ``secret`` is the server's
  //: own (KERBSIDE_CITY_SECRET), which every function checks before it does anything.
  constructor({ url, key, secret, fetch: f = globalThis.fetch, timeout = 12_000 }) {
    Object.assign(this, { url: String(url).replace(/\/+$/, ""), key, secret, fetch: f, timeout });
  }
  async rpc(name, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const r = await this.fetch(`${this.url}/rest/v1/rpc/${name}`, { method: "POST", signal: controller.signal,
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ secret: this.secret, ...body }) });
      const text = await r.text();
      if (!r.ok) {
        const error = new Error(r.status === 404 ? "the city's tables are not set up" : `the city's store answered ${r.status}`);
        error.code = r.status === 404 ? "not_configured" : "store";
        throw error;
      }
      const out = text ? JSON.parse(text) : null;
      if (out?.refused) { const error = new Error("the city's store does not know this server"); error.code = "not_configured"; throw error; }
      return out;
    } finally { clearTimeout(timer); }
  }
  async load(id) { const out = await this.rpc("kerbside_city_load", { world: id }); return out?.version ? { version: Number(out.version), state: out.state } : null; }
  async version(id) { return Number((await this.rpc("kerbside_city_version", { world: id }))?.version || 0); }
  async commit(id, expect, state, entry = null, { grants = [] } = {}) {
    const out = await this.rpc("kerbside_city_commit", { world: id, expect, state, entry, grants });
    return { ok: Boolean(out?.ok), version: Number(out?.version || 0), why: out?.why };
  }
  async pendingGrants(keyHash) {
    const out = await this.rpc("kerbside_city_pending_grants", { key_sha256: keyHash });
    return Array.isArray(out) ? out.map((g) => ({ id: Number(g.id), amount: Number(g.amount) })) : [];
  }
}
