// What one player is shown of the world: their own books, and the public record.
//
// The world is never sent whole. ``viewFor(world, pid)`` is the world's JSON cut down to what
// that player may see, in the same shape (the page loads it with CityWorld.fromJSON, as it loaded
// a party host's state before): their own balance, journal, bills, inventory, things, messages,
// offers, cases and businesses in full; of everyone else only what a city makes public -- a name,
// who owns which building or home, a shop's name, hours and prices, job openings, measures and
// their counts, what lies in the street. Other people's money, messages, bags, bills, court
// cases, cars, vitals and whereabouts are not in it at all.

//: Asset kinds whose title is public record (as a county recorder's is), and what of them shows.
const PUBLIC_ASSETS = new Set(["building", "home"]);
const PUBLIC_ATTRS = ["name", "use", "assessed", "lon", "lat", "county", "area", "floors", "building", "label", "address", "type", "beds", "sqft", "x", "z", "interior_unit_id"];
//: Ledger accounts that are public bodies or the city's own shops (never a player's or a player's firm's).
const publicAccount = (id, a) => a.kind !== "player" && !id.startsWith("player:") && !id.startsWith("firm:");
const HIDDEN = "others:private";

const pick = (o, keys) => { const out = {}; for (const k of keys) if (o?.[k] !== undefined) out[k] = o[k]; return out; };

export function viewFor(world, pid) {
  const o = JSON.parse(JSON.stringify(world.toJSON()));
  const me = world.players.get(pid) || null;
  const others = [...world.players.keys()].filter((id) => id !== pid);
  const mine = new Set(me ? [me.account] : []);
  for (const b of o.enterprise?.biz || []) if (me && (b.owner === me.account || b.owner_pid === pid)) mine.add(b.account);
  const names = (text) => typeof text === "string" && others.some((id) => text.includes(id));
  //: An object keyed by player (or by a pair of them): only the keys that are not someone else's.
  const ownKeys = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !names(k) || k.includes(pid)));

  // ---- the books: your accounts, the public bodies', and one line for everything else ----------
  let hidden = 0;
  o.ledger.accounts = o.ledger.accounts.filter(([id, a]) => {
    if (mine.has(id) || publicAccount(id, a)) return true;
    hidden += a.balance;
    return false;
  });
  if (hidden) o.ledger.accounts.push([HIDDEN, { kind: "hidden", balance: hidden }]);
  o.ledger.journal = o.ledger.journal.filter((e) => e.lines.some(([a]) => mine.has(a))).slice(-80)
    .map((e) => ({ ...e, lines: e.lines.map(([a, v]) => [mine.has(a) || !a.startsWith("player:") ? a : "player:other", v]) }));
  o.billing.bills = o.billing.bills.filter((b) => mine.has(b.payer) || mine.has(b.payee));

  // ---- title and possession ---------------------------------------------------------------------
  o.registry = o.registry.flatMap((a) => {
    if (mine.has(a.owner) || mine.has(a.holder)) return [a];
    if (!PUBLIC_ASSETS.has(a.kind)) return [];
    return [{ id: a.id, kind: a.kind, owner: a.owner, holder: a.holder, custody: a.custody, attrs: pick(a.attrs, PUBLIC_ATTRS), history: [] }];
  });

  // ---- people: you in full; of the others, a name -----------------------------------------------
  o.players = o.players.map((p) => (p.id === pid ? p : { id: p.id, name: p.name, account: p.account, joined: p.joined, resident_since: p.resident_since, backstory: p.backstory || null,
    home: null, job: null, clocked: null, ytd: { year: p.ytd?.year, wages: 0, withheld: 0 }, fastrak: null, driving: null, parked: {}, inventory: {}, worn: {},
    resting: false, delivery: null, ride: null, fainted: null, hands: null, errand: null, mortgages: [], lease: null, injuries: [], task: null }));
  o.offers = o.offers.filter((x) => x.to === pid || x.from === pid);
  //: A measure's votes: yours, and the rest as a count (no one else's ballot).
  o.measures = o.measures.map((m) => {
    const votes = {}; let i = 0;
    for (const [voter, yes] of Object.entries(m.votes || {})) votes[voter === pid ? pid : `voter:${i += 1}`] = yes;
    return { ...m, votes, by: m.by === pid ? pid : null };
  });

  // ---- businesses, cases, storefronts ------------------------------------------------------------
  const E = o.enterprise || {};
  E.biz = (E.biz || []).map((b) => (mine.has(b.account) ? b : { ...b, books: [], weeks: [], tx: [], incoming: [], loan: null, bought: undefined, licences: {},
    today: { day: b.today?.day }, staff: (b.staff || []).filter((s) => s.pid === pid) }));
  E.cases = (E.cases || []).filter((c) => c.pid === pid);
  // A resident's shop's books: for those who have dealt with it (and not who else has).
  E.shops = (E.shops || []).filter((x) => x.watchers?.[pid]).map((x) => ({ ...x, watchers: { [pid]: x.watchers[pid] } }));
  E.storefronts = (E.storefronts || []).map((s) => (s.pid === pid ? s : { place: s.place, holder: s.holder, pid: s.pid, since: s.since }));
  o.enterprise = E;
  // A kitchen: its menu and pantry are the staff's to see; tickets, boards, tests and records are
  // each cook's own, and the owner's (kitchen.mjs).
  o.kitchens = (o.kitchens || []).map((k) => {
    const owner = k.business && E.biz.some((b) => b.id === k.business && mine.has(b.account));
    if (owner) return k;
    const own = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => id === pid));
    return { ...k, lines: own(k.lines), held: own(k.held), staff: own(k.staff), tests: (k.tests || []).filter((x) => x.pid === pid),
      proposals: (k.proposals || []).filter((x) => x.pid === pid), log: (k.log || []).filter((e) => !e.pid || e.pid === pid), incoming: [] };
  });

  // ---- messages: the threads you are in ----------------------------------------------------------
  if (o.mail) {
    const M = o.mail;
    // The council is everyone's ("all"); a thread with members is theirs; one with none is seen unless its id names someone else.
    M.threads = (M.threads || []).filter((t) => (t.members === "all" ? true : Array.isArray(t.members) && t.members.length ? t.members.includes(pid)
      : !names(String(t.id)) || String(t.id).includes(pid)));
    for (const k of Object.keys(M)) if (M[k] && typeof M[k] === "object" && !Array.isArray(M[k])) M[k] = ownKeys(M[k]);
  }

  // ---- things as themselves: yours, and what is inside them --------------------------------------
  if (o.things?.all) {
    // Yours (owned, or in your hands), what lies on the ground for anyone, and what is inside those.
    const keep = new Map();
    for (const th of o.things.all) {
      if (mine.has(th.owner) || mine.has(th.at?.holder) || (th.at?.kind === "ground" && !th.owner?.startsWith?.("player:"))) keep.set(th.id, th);
    }
    for (let grew = true; grew;) {
      grew = false;
      for (const th of o.things.all) if (!keep.has(th.id) && th.at?.kind === "in" && keep.has(th.at.parent)) { keep.set(th.id, th); grew = true; }
    }
    o.things.all = o.things.all.filter((th) => keep.has(th.id));
  }
  if (o.commerce) {
    const C = o.commerce;
    C.listings = (C.listings || []).filter((l) => l.pid === pid);
    C.consigned = (C.consigned || []).filter((x) => x.pid === pid);
    C.quotes = (C.quotes || []).filter(([, q]) => !q?.pid || q.pid === pid);
    for (const k of ["rapport", "skills", "cash", "bought", "quoted"]) C[k] = ownKeys(C[k]);
  }
  if (Array.isArray(o.outcomes)) o.outcomes = o.outcomes.filter(([k]) => !names(k) || String(k).includes(pid));

  // ---- the street: what was broken and who was hurt, without who did it ---------------------------
  const scrub = (v) => {
    if (typeof v === "string") return names(v) && !v.includes(pid) ? "someone" : v;
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
    return v;
  };
  o.harm = scrub(o.harm); o.damage = scrub(o.damage); o.items = scrub(o.items);
  return o;
}

//: Whether a view holds anything of another player's that it should not: the names of the
//: private things found (empty when the view is clean). What tests/city_server.test.mjs asks.
export function leaks(view, pid, world) {
  const out = [];
  const others = [...world.players.values()].filter((p) => p.id !== pid);
  const accounts = new Map(view.ledger.accounts);
  for (const p of others) {
    if (accounts.has(p.account)) out.push(`balance of ${p.id}`);
    const seen = view.players.find((x) => x.id === p.id);
    if (seen && (Object.keys(seen.inventory || {}).length || seen.vitals || seen.x !== undefined || seen.lon !== undefined)) out.push(`body of ${p.id}`);
    if (view.billing.bills.some((b) => b.payer === p.account && !accounts.has(b.payee))) out.push(`bills of ${p.id}`);
  }
  for (const t of view.mail?.threads || []) if (Array.isArray(t.members) && t.members.length && !t.members.includes(pid)) out.push(`thread ${t.id}`);
  return out;
}
