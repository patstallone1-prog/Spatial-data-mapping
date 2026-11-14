// Residents' working lives and their money: a job, the day they leave it and the next one, the
// weeks looking in between, and a bank balance made of the pay for the hours they really worked.
//
// The city deals each resident a role (people.mjs generatePopulation). Here that role is the first
// spell of a working life walked forward from a fixed day (ECONOMY_ANCHOR, 2023-01-01): each spell
// lasts a seeded while around its trade's typical tenure, then ends in a quit, a better offer or a
// lay-off; a better offer goes straight into the next job, the others into a spell of looking.
// Spell i follows only from spell i - 1 and its own seed, so any day asked in any order gives the
// same answer. The books follow from the career: every other Friday's take-home for the shifts
// worked in the fortnight before, the share of the rent each 30 days and a day's spending, from
// savings that grew with age. Pure, as people.mjs is (tests/city_npc_economy.test.mjs).

import { hash32, rng, worksOn } from "./people.mjs";

//: The day every working life is walked from (2023-01-01, days since 1970-01-01).
export const ECONOMY_ANCHOR = 19358;
//: The day of the week of a day number, 0 Sunday (1970-01-01 was a Thursday).
export const weekdayOfDay = (d) => (((d + 4) % 7) + 7) % 7;

//: The defaults; ``R.npc_economy`` overrides them group by group, key by key.
export const ECONOMY_RULES = {
  tenure: {
    basis: "BLS Employee Tenure (Jan 2024): median 2.0 years in leisure and hospitality, 3.0 in retail, 4.2 in professional services and 6.2 in public administration; spells here run shorter, as a spell is one employer",
    days: { food: 380, retail: 470, care: 900, office: 950, public: 1700, transport: 780, trade: 880, other: 700 },
    spread: [0.5, 1.5],
  },
  leaving: {
    basis: "BLS JOLTS 2024: quits about 60% of separations and layoffs about 30%; about a third of quits go straight to a job already offered",
    quit: 0.42, better_offer: 0.33, laid_off: 0.25,
    same_family: 0.7,
  },
  looking: { basis: "BLS CPS 2024: median spell of unemployment about 9 weeks; most find work inside ten", days: [7, 70] },
  retirement: { basis: "Social Security full retirement age is 66-67; children under 5 are not at school", age: 66, adult_age: 18, school_age: 5 },
  tax: { basis: "federal, state and payroll withholding on a median wage in California, about 22%", withholding: 0.22 },
  payday: { basis: "biweekly is the commonest US pay period (BLS 2023, about 43% of workers); paid on Fridays from 2023-01-06", every: 14, first: 19363 },
  spending: {
    basis: "BLS Consumer Expenditure 2023: households spend about 70-75% of after-tax income outside housing; a floor for food and fares (whole units a day)",
    share: 0.72, floor_per_day: 45, jitter: 0.2,
  },
  rent: { basis: "rent is due every 30 days, the household's split evenly by its adults", every: 30 },
  savings: {
    basis: "Fed SCF 2022: liquid savings rise with age, from a few weeks' pay in the twenties to several months near retirement",
    months_by_age: [[18, 0.25], [25, 0.75], [35, 2], [50, 4], [65, 7]],
    spread: [0.4, 1.6],
  },
  raises: { basis: "a step for each completed year in a job, as union and public pay scales do", per_level: 0.06, max_level: 2, level_days: 365 },
};

//: Each role's trade, for a job change that mostly stays in the same line of work.
export const ROLE_FAMILY = {
  barista: "food", baker: "food", cook: "food", server: "food", bartender: "food",
  clerk: "retail", grocer: "retail", laundry_attendant: "retail", attendant: "retail",
  pharmacist: "care", pharmacy_tech: "care", nurse: "care", stylist: "care",
  teller: "office", office_worker: "office", software_engineer: "office", remote_worker: "office", night_auditor: "office",
  teacher: "public", civil_servant: "public", police: "public", firefighter: "public", mail_carrier: "public", street_cleaner: "public",
  janitor: "trade", security_guard: "trade", housekeeper: "trade", mechanic: "trade", warehouse_worker: "trade", construction: "trade",
  delivery_driver: "transport", taxi_driver: "transport", bus_driver: "transport", parking_attendant: "transport",
  student: "other", retiree: "other", unemployed: "other",
};

//: Roles never dealt as a new job: only as the role the city dealt someone first.
const NOT_DEALT = new Set(["student", "retiree", "unemployed", "remote_worker"]);
//: The share of days each kind of rota works.
const DAYS_SHARE = { daily: 1, weekdays: 5 / 7, mon_sat: 6 / 7, tue_sat: 5 / 7, rotating: 5 / 7, every_third: 1 / 3, three_days: 3 / 7, none: 0 };
//: The books are folded into a balance every so many days from a while before the anchor.
const BLOCK = 60, ORIGIN = ECONOMY_ANCHOR - 120;

const pickW = (r, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries.at(-1)[0];
};
const remember = (map, key, value, max) => {
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---- rules ---------------------------------------------------------------------------------------

const perRules = new WeakMap();
function econ(R) {
  let C = perRules.get(R);
  if (C) return C;
  const over = R.npc_economy || {};
  const E = {};
  for (const [group, defaults] of Object.entries(ECONOMY_RULES)) {
    const o = over[group] || {};
    E[group] = { ...defaults };
    for (const [k, v] of Object.entries(o)) {
      const d = defaults[k];
      E[group][k] = d && v && typeof d === "object" && !Array.isArray(d) && typeof v === "object" ? { ...d, ...v } : v;
    }
  }
  const roles = R.jobs.roles;
  const paid = Object.values(roles).map((x) => x.pay).filter((p) => p > 0);
  C = { E, states: new Map(), books: new Map(), checkpoints: new Map(), pools: new Map(), minPay: Math.min(...paid) };
  perRules.set(R, C);
  return C;
}

function poolOf(R, C, open) {
  const key = open ? open.join(",") : "";
  let pool = C.pools.get(key);
  if (pool) return pool;
  const roles = R.jobs.roles;
  const ok = (k) => roles[k] && roles[k].shifts.length && !NOT_DEALT.has(k);
  pool = (open || []).filter(ok);
  if (!pool.length) pool = Object.keys(roles).filter(ok);
  return remember(C.pools, key, [...new Set(pool)], 64);
}

// ---- careers -------------------------------------------------------------------------------------

function fixedCareer(R, E, person) {
  const roles = R.jobs.roles;
  const T = E.retirement;
  const make = (status, role) => ({ status, role, title: roles[role]?.title || role, pay: 0, since: null, until: null, spell: 0, level: 0, left: null, history: [] });
  if (person.age < T.adult_age) return make(person.age < T.school_age ? "child" : "student", "student");
  if (person.role === "student") return make("student", "student");
  if (person.role === "retiree" || person.age >= T.age) return make("retired", "retiree");
  return null;
}

const jobDays = (E, role, r) => {
  const [lo, hi] = E.tenure.spread;
  return Math.max(30, Math.round((E.tenure.days[ROLE_FAMILY[role] || "other"] || 700) * lerp(lo, hi, r())));
};
const gapDays = (E, r) => {
  const [lo, hi] = E.looking.days;
  return Math.round(lerp(lo, hi, r() ** 1.3));
};
const leaving = (E, r) => pickW(r, [["quit", E.leaving.quit], ["better_offer", E.leaving.better_offer], ["laid_off", E.leaving.laid_off]]);

function chooseRole(R, E, pool, r, fromRole, minPay) {
  const roles = R.jobs.roles;
  const fam = fromRole ? ROLE_FAMILY[fromRole] : null;
  let set = pool;
  if (fam && fam !== "other" && r() < E.leaving.same_family) {
    const same = pool.filter((k) => ROLE_FAMILY[k] === fam);
    const others = same.filter((k) => k !== fromRole);
    set = others.length ? others : same.length ? same : pool;
  }
  if (minPay) {
    const better = set.filter((k) => roles[k].pay >= minPay);
    if (better.length) set = better;
  }
  return pickW(r, set.map((k) => [k, roles[k].share || 0.001]));
}

const levelOf = (E, s, day) => (s.status === "employed" ? Math.min(E.raises.max_level, Math.floor(Math.max(0, day - s.since) / E.raises.level_days)) : 0);
const payOf = (E, s, day) => (s.status === "employed" ? Math.round(s.base * (1 + E.raises.per_level * levelOf(E, s, day))) : 0);

function stateOf(R, C, person, open) {
  const key = `${person.id}|${person.role}|${person.age}|${open ? open.join(",") : ""}`;
  let st = C.states.get(key);
  if (st) return st;
  const E = C.E;
  const roles = R.jobs.roles;
  const r = rng("npc-econ", person.id, 0);
  let first;
  if (person.role === "unemployed" || !roles[person.role]?.shifts.length) {
    const dur = gapDays(E, r);
    const since = ECONOMY_ANCHOR - Math.floor(r() * dur);
    first = { status: "looking", role: "unemployed", since, until: since + dur, base: 0, reason: "found_work", lastJob: null, lastPay: 0 };
  } else {
    const dur = jobDays(E, person.role, r);
    const since = ECONOMY_ANCHOR - Math.floor(r() * dur);
    first = { status: "employed", role: person.role, since, until: since + dur, base: roles[person.role].pay, reason: leaving(E, r) };
  }
  st = { key, id: person.id, spells: [first], pool: poolOf(R, C, open) };
  return remember(C.states, key, st, 4000);
}

function extend(R, E, st) {
  const prev = st.spells.at(-1);
  const i = st.spells.length;
  const r = rng("npc-econ", st.id, i);
  const roles = R.jobs.roles;
  let next;
  if (prev.status === "employed" && prev.reason !== "better_offer") {
    const dur = gapDays(E, r);
    next = { status: "looking", role: "unemployed", since: prev.until, until: prev.until + dur, base: 0, reason: "found_work",
      lastJob: prev.role, lastPay: payOf(E, prev, prev.until - 1) };
  } else {
    const fromRole = prev.status === "employed" ? prev.role : prev.lastJob;
    const offer = prev.status === "employed";
    const role = chooseRole(R, E, st.pool, r, fromRole, offer ? roles[prev.role].pay : 0);
    const base = offer ? Math.max(roles[role].pay, payOf(E, prev, prev.until - 1)) : roles[role].pay;
    const dur = jobDays(E, role, r);
    next = { status: "employed", role, since: prev.until, until: prev.until + dur, base, reason: leaving(E, r) };
  }
  st.spells.push(next);
}

function spellIndex(R, E, st, day) {
  const sp = st.spells;
  while (sp.at(-1).until <= day) extend(R, E, st);
  for (let i = sp.length - 1; i > 0; i -= 1) if (sp[i].since <= day) return i;
  return 0;
}

//: Someone's work on ``day``: a job, a spell of looking, or school or retirement for good.
//: ``open``: the role ids with a workplace in the district; a new job is dealt only from them.
//: Spells ``since`` to ``until`` (exclusive) tile the days; a day before the first is in it.
//: ``since``/``until`` are null for a child, a student or a retiree, who stay so.
export function careerOf(R, person, day, { open = null } = {}) {
  const C = econ(R);
  const E = C.E;
  const fixed = fixedCareer(R, E, person);
  if (fixed) return fixed;
  const st = stateOf(R, C, person, open);
  const i = spellIndex(R, E, st, day);
  const sp = st.spells;
  const s = sp[i];
  const roles = R.jobs.roles;
  let left = null;
  for (let j = i - 1; j >= 0; j -= 1) if (sp[j].status === "employed") { left = { reason: sp[j].reason, day: sp[j].until }; break; }
  const history = [];
  for (let j = i - 1; j >= 0 && history.length < 5; j -= 1) {
    history.push({ role: sp[j].role, title: roles[sp[j].role]?.title || sp[j].role, since: sp[j].since, until: sp[j].until, reason: sp[j].reason });
  }
  return { status: s.status, role: s.role, title: roles[s.role]?.title || s.role, pay: payOf(E, s, day), since: s.since, until: s.until,
    spell: i, level: levelOf(E, s, day), left, history };
}

//: The hours someone works on ``day`` (0 off work, or with no job): their shift on their rota.
export function hoursOn(R, career, person, day, weekday) {
  if (!career || career.status !== "employed") return 0;
  const role = R.jobs.roles[career.role];
  if (!role || !role.shifts.length) return 0;
  if (!worksOn(role.days, weekday, day, hash32(person.id) % 7)) return 0;
  const [a, b] = role.shifts[(person.shift || 0) % role.shifts.length];
  return b - a;
}

// ---- books ---------------------------------------------------------------------------------------

const shiftHours = (role, person) => {
  if (!role || !role.shifts.length) return 8;
  const [a, b] = role.shifts[(person.shift || 0) % role.shifts.length];
  return b - a;
};
//: Take-home a day at ``pay`` an hour on ``role``'s rota, on average.
const dailyTakeHome = (E, role, person, pay) => pay * shiftHours(role, person) * (DAYS_SHARE[role?.days] ?? 5 / 7) * (1 - E.tax.withholding);

function opening(R, C, person) {
  const E = C.E;
  const r = rng("npc-savings", person.id);
  if (person.age < E.retirement.adult_age) return R.money(Math.round(lerp(20, 200, r())));
  const role = R.jobs.roles[person.role];
  const pay = role?.pay > 0 ? role.pay : C.minPay;
  const monthly = dailyTakeHome(E, role?.pay > 0 ? role : { days: "weekdays", shifts: [[9, 17]] }, person, pay) * 30;
  const pts = E.savings.months_by_age;
  let months = pts[0][1];
  for (let k = 0; k < pts.length; k += 1) {
    if (person.age >= pts[k][0]) months = pts[k][1];
    if (k + 1 < pts.length && person.age >= pts[k][0] && person.age < pts[k + 1][0]) {
      months = lerp(pts[k][1], pts[k + 1][1], (person.age - pts[k][0]) / (pts[k + 1][0] - pts[k][0]));
    }
  }
  const [lo, hi] = E.savings.spread;
  return Math.round(monthly * months * lerp(lo, hi, r()));
}

function ledgerCtx(R, C, person, open, share, weekdayOf) {
  const E = C.E;
  const fixed = fixedCareer(R, E, person);
  return {
    R, C, E, person, weekdayOf, share, fixed,
    st: fixed ? null : stateOf(R, C, person, open),
    child: person.age < E.retirement.adult_age,
    floor: -Math.round((share * 7) / E.rent.every),
    spendFloor: R.money(E.spending.floor_per_day),
  };
}
const spellOn = (x, d) => (x.fixed ? x.fixed : x.st.spells[spellIndex(x.R, x.E, x.st, d)]);
const isPayday = (E, d) => (((d - E.payday.first) % E.payday.every) + E.payday.every) % E.payday.every === 0;
const isRentDay = (E, d) => (((d - ECONOMY_ANCHOR) % E.rent.every) + E.rent.every) % E.rent.every === 0;

//: One day of someone's account: pay on a payday, rent on a rent day, then the day's spending.
//: Calls ``note(kind, amount, memo)`` for each when given. Returns the balance at the day's end.
function stepDay(x, d, bal, note = null) {
  const { E, person } = x;
  if (!x.fixed && isPayday(E, d)) {
    let gross = 0;
    for (let k = d - E.payday.every; k < d; k += 1) {
      const s = spellOn(x, k);
      const h = hoursOn(x.R, s, person, k, x.weekdayOf(k));
      if (h) gross += h * payOf(E, s, k);
    }
    const net = Math.round(gross * (1 - E.tax.withholding));
    if (net > 0) { bal += net; if (note) note("pay", net, `Pay, ${x.R.jobs.roles[spellOn(x, d - 1).role]?.title || "work"}`); }
  }
  if (x.child) return bal;
  if (x.share > 0 && isRentDay(E, d)) {
    const amt = Math.max(0, Math.min(x.share, bal - x.floor));
    bal -= amt;
    if (note) note("rent", -amt, amt < x.share ? "Rent, part paid" : "Rent");
  }
  const s = spellOn(x, d);
  const rate = s.status === "employed" ? dailyTakeHome(E, x.R.jobs.roles[s.role], person, payOf(E, s, d)) : 0;
  const j = E.spending.jitter;
  const want = Math.round(Math.max(x.spendFloor, E.spending.share * rate) * (1 - j + 2 * j * (hash32("npc-spend", person.id, d) / 4294967296)));
  const amt = Math.max(0, Math.min(want, bal - x.floor));
  bal -= amt;
  if (note) note("spend", -amt, amt < want ? "Spending, cut back" : "Spending");
  return bal;
}

function checkpoint(x, k, prefix) {
  if (k <= 0) return opening(x.R, x.C, x.person);
  const cache = x.C.checkpoints;
  let j = k;
  while (j > 0 && !cache.has(`${prefix}|${j}`)) j -= 1;
  let bal = j > 0 ? cache.get(`${prefix}|${j}`) : opening(x.R, x.C, x.person);
  for (; j < k; j += 1) {
    const d0 = ORIGIN + j * BLOCK;
    for (let d = d0; d < d0 + BLOCK; d += 1) bal = stepDay(x, d, bal);
    remember(cache, `${prefix}|${j + 1}`, bal, 50000);
  }
  return bal;
}

//: Someone's money at the end of ``day`` (minor units): balance, pay and outgoings, assets.
//: ``rent``: the household's rent for 30 days (default a room), split by ``adults``; a child pays
//: none. Line amounts are signed: pay in, rent and spending (a line a week) out.
export function booksOf(R, person, day, weekdayOf = weekdayOfDay, { rent = null, adults = 1, assets = [], open = null } = {}) {
  const C = econ(R);
  const E = C.E;
  const monthly = rent == null ? R.start.room_rent_per_day * E.rent.every : rent;
  const share = person.age < E.retirement.adult_age ? 0 : Math.round(monthly / Math.max(1, adults));
  const prefix = `${person.id}|${person.role}|${person.age}|${person.shift || 0}|${share}|${open ? open.join(",") : ""}`;
  const key = `${prefix}|${day}`;
  let base = C.books.get(key);
  if (!base) {
    const x = ledgerCtx(R, C, person, open, share, weekdayOf);
    const k = Math.floor((day - 30 - ORIGIN) / BLOCK);
    let bal = checkpoint(x, k, prefix);
    const lines = [];
    let income = 0, spend = 0, rentPaid = 0, lastPay = null, week = 0;
    for (let d = ORIGIN + k * BLOCK; d <= day; d += 1) {
      const recent = d > day - 30;
      bal = stepDay(x, d, bal, (kind, amount, memo) => {
        if (kind === "spend") { week += amount; if (recent) spend -= amount; return; }
        if (kind === "pay") { lastPay = { day: d, amount }; if (recent) income += amount; }
        if (kind === "rent" && recent) rentPaid -= amount;
        lines.push({ day: d, kind, amount, memo });
      });
      if ((x.weekdayOf(d) === 6 || d === day) && week !== 0) {
        lines.push({ day: d, kind: "spend", amount: week, memo: d === day && x.weekdayOf(d) !== 6 ? "Spending, this week so far" : "Spending, the week" });
        week = 0;
      }
    }
    const now = spellOn(x, day);
    const every = E.payday.every;
    base = {
      balance: bal,
      wage_hour: payOf(E, now, day),
      income_30d: income, spend_30d: spend, rent_30d: rentPaid,
      last_pay: lastPay,
      next_pay: E.payday.first + every * Math.ceil((day + 1 - E.payday.first) / every),
      lines: lines.slice(-8).reverse(),
    };
    remember(C.books, key, base, 2000);
  }
  const listed = assets.map((a) => ({ kind: a.kind, label: a.label, value: Math.round(a.value || 0) }));
  return { ...base, assets: listed, net_worth: base.balance + listed.reduce((s, a) => s + a.value, 0), lines: base.lines.map((l) => ({ ...l })) };
}
