// How many players the city's server carries: N players each asking what is new every 4 s (as
// the page does) and acting every so often, against a store that answers as slowly as a hosted
// database does. Run before and after a change to the sync path:
//
//   node tools/city_load_test.mjs                 # 25, 50, 100, 200 players; one and four instances
//   node tools/city_load_test.mjs 100 1 20        # 100 players, one instance, 20 s
//
// It reports, for each run: requests answered a second, how long an answer took (median, 95th
// percentile, worst), the server's own processor time for each request, how many store calls a
// request made, and how many actions were turned away because the one world record was busy.
// A run "holds" when the 95th percentile answer is under the polling interval's quarter (1 s),
// nothing was turned away, and the processor was not saturated (under 70% of one core for each
// instance).
import { CityAuthority } from "../server/city/authority.mjs";
import { keyHash } from "../server/city/auth.mjs";
import { loadCity } from "../server/city/http.mjs";
import { MemoryStore } from "../server/city/storage.mjs";

const { R, canon } = loadCity();
const homes = [...canon.places.values()].filter((p) => p.use === "residential");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const SYNC_MS = 4000;

//: A store that takes ``ms`` to answer each call (a hosted database a region away), counted.
class SlowStore extends MemoryStore {
  constructor(ms) { super(); this.ms = ms; this.calls = { version: 0, load: 0, commit: 0 }; }
  async version(id) { this.calls.version += 1; await sleep(this.ms); return super.version(id); }
  async load(id) { this.calls.load += 1; await sleep(this.ms); return super.load(id); }
  async commit(...a) { this.calls.commit += 1; await sleep(this.ms * 1.5); return super.commit(...a); }
}

export async function run({ players = 100, instances = 1, seconds = 16, storeMs = 35, actEveryS = 20, syncMs = SYNC_MS } = {}) {
  const store = new SlowStore(0);
  const make = () => new CityAuthority({ R, canon, store, secret: "load-test-secret", now: () => Date.now() });
  const servers = Array.from({ length: instances }, make);
  const people = [];
  for (let i = 0; i < players; i += 1) {
    const key = `load-test-device-${String(i).padStart(6, "0")}-000000`;
    const server = servers[i % instances], home = homes[i % homes.length];
    const token = (await server.handle({ op: "session", key })).token;
    const at = { x: home.x + 3, z: home.z };
    const joined = await server.handle({ op: "cmd", token, command: "join", args: { name: `P${i}`, home: { id: home.id }, at } });
    if (!joined.ok || !joined.result?.ok) throw new Error(`player ${i} could not join: ${joined.error || joined.result?.error}`);
    people.push({ i, token, server, at, pid: joined.you, version: joined.version, key: keyHash(key) });
  }
  store.ms = storeMs; store.calls = { version: 0, load: 0, commit: 0 };
  const lat = { sync: [], cmd: [] };
  const tally = { sync: 0, unchanged: 0, full: 0, cmd: 0, cmdOk: 0, busy: 0, refused: 0, errors: 0, bytes: 0 };
  const until = Date.now() + seconds * 1000;
  const cpu0 = process.cpuUsage(), t0 = Date.now();
  let loopLag = 0, lagN = 0;
  const lagTimer = setInterval(() => { const a = Date.now(); setImmediate(() => { loopLag = Math.max(loopLag, Date.now() - a); lagN += 1; }); }, 200);
  await Promise.all(people.map(async (p) => {
    await sleep(Math.random() * syncMs);
    let nextAct = Date.now() + Math.random() * actEveryS * 1000;
    while (Date.now() < until) {
      const a = Date.now();
      try {
        if (a >= nextAct) {
          nextAct = a + actEveryS * 1000;
          const to = people[(p.i + 1) % people.length].pid;
          const r = await p.server.handle({ op: "cmd", token: p.token, command: "give_money", args: { to, amount: 100, at: p.at }, req: `${p.i}:${a}` });
          tally.cmd += 1; lat.cmd.push(Date.now() - a);
          if (r.ok && r.result?.ok) { tally.cmdOk += 1; p.version = r.version; }
          else if (r.code === "busy") tally.busy += 1; else tally.refused += 1;
        } else {
          const r = await p.server.handle({ op: "sync", token: p.token, since: p.version });
          tally.sync += 1; lat.sync.push(Date.now() - a);
          if (!r.ok) tally.errors += 1;
          else if (r.unchanged) tally.unchanged += 1;
          else { tally.full += 1; p.version = r.version; tally.bytes += JSON.stringify(r).length; }
        }
      } catch { tally.errors += 1; }
      await sleep(Math.max(0, syncMs - (Date.now() - a)));
    }
  }));
  clearInterval(lagTimer);
  const wall = (Date.now() - t0) / 1000, cpu = process.cpuUsage(cpu0), cpuMs = (cpu.user + cpu.system) / 1000;
  const q = (list, f) => { const s = [...list].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : 0; };
  const requests = tally.sync + tally.cmd;
  const out = {
    players, instances, seconds: Math.round(wall), requests_per_s: +(requests / wall).toFixed(1),
    sync_ms: { p50: q(lat.sync, 0.5), p95: q(lat.sync, 0.95), worst: q(lat.sync, 1) },
    action_ms: { p50: q(lat.cmd, 0.5), p95: q(lat.cmd, 0.95), worst: q(lat.cmd, 1) },
    cpu_ms_per_request: +(cpuMs / Math.max(1, requests)).toFixed(2),
    cpu_share_per_instance: +((cpuMs / 1000 / wall) / instances).toFixed(2),
    store_calls_per_request: +((store.calls.version + store.calls.load + store.calls.commit) / Math.max(1, requests)).toFixed(2),
    answers: { unchanged: tally.unchanged, full: tally.full, kb_per_full: tally.full ? Math.round(tally.bytes / tally.full / 1024) : 0 },
    actions: { sent: tally.cmd, done: tally.cmdOk, busy: tally.busy, refused: tally.refused }, errors: tally.errors, worst_loop_stall_ms: loopLag,
  };
  out.holds = out.sync_ms.p95 < 1000 && out.action_ms.p95 < 2500 && !tally.busy && !tally.errors && out.cpu_share_per_instance < 0.7;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [n, inst, secs] = process.argv.slice(2).map(Number);
  const runs = n ? [[n, inst || 1]] : [[25, 1], [50, 1], [100, 1], [200, 1], [100, 4], [200, 4], [400, 4]];
  for (const [players, instances] of runs) console.log(JSON.stringify(await run({ players, instances, seconds: secs || 16 })));
}
