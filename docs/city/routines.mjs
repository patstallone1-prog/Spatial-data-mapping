// Everyone's day by the kind of day it is: a day shift, a late or a night shift, a round, school,
// classes, retirement, working from home, looking for work, a day off, or a parent's school run.
//
// Each kind of day is a routine: the fixed things (a shift, school, the school run) put down first,
// then the day's tasks fitted round them, each at a real place that does it and each with the time
// to be there by. The same shape as daySchedule (docs/city/people.mjs), so docs/city/fleet.mjs walks,
// drives and rides it the same way; the shifts are daySchedule's to the minute. Seeded and pure:
// the same person and day always give the same plan (tests/city_routines.test.mjs).

import { hash32, rng, worksOn } from "./people.mjs";

//: The kinds of day, each with what puts a person in it.
export const ROUTINE_TYPES = {
  day_shift: { label: "Day shift", basis: "works today on a shift that starts before 11:00 and ends by midnight" },
  late_shift: { label: "Late shift", basis: "works today on a shift that starts at 11:00 or later and ends by midnight" },
  night_shift: { label: "Night shift", basis: "works today on a shift that ends after midnight or starts before 05:00" },
  rounds: { label: "Rounds", basis: "works today in a role out on the streets (patrol, deliveries, fares, the bus, sweeping, the mail, a site)" },
  student: { label: "Student", basis: "18 or over and studying, with classes today" },
  school_child: { label: "School child", basis: "under 18 and not employed: school on weekdays from 5" },
  parent: { label: "Parent", basis: "an adult whose household has a child under 12, on a day of their own or a day or late shift" },
  retiree: { label: "Retired", basis: "retired: no work, an early start and an early night" },
  remote: { label: "Working from home", basis: "works today in a role done from home" },
  job_seeker: { label: "Looking for work", basis: "out of work and looking: job hunting on weekdays" },
  day_off: { label: "Day off", basis: "has a job (or classes) but not today" },
};

const FOOD = ["shop:restaurant", "use:restaurant", "shop:american", "shop:diner", "shop:mexican", "shop:japanese", "shop:chinese", "shop:thai",
  "shop:vietnamese", "shop:indian", "shop:korean", "shop:italian", "shop:mediterranean", "shop:seafood", "shop:pizza"];

//: The stops with a purpose: the places that do each (most specific first), how long it takes and
//: the hours it can be done in. A task with no such place in town is skipped.
export const TASKS = {
  groceries: { id: "groceries", label: "Buying groceries", kind: "errand", keys: ["shop:grocery", "shop:convenience", "shop:deli"], minutes: [15, 35], hours: [7, 22] },
  pharmacy: { id: "pharmacy", label: "At the pharmacy", kind: "errand", keys: ["shop:pharmacy"], minutes: [8, 20], hours: [8, 21] },
  coffee: { id: "coffee", label: "Getting a coffee", kind: "meal", keys: ["shop:cafe", "shop:bakery"], minutes: [10, 25], hours: [6, 18] },
  bank: { id: "bank", label: "At the bank", kind: "errand", keys: ["shop:bank"], minutes: [10, 20], hours: [9, 17] },
  laundry: { id: "laundry", label: "Doing the laundry", kind: "errand", keys: ["shop:laundry", "shop:dry_cleaner"], minutes: [20, 60], hours: [7, 21] },
  haircut: { id: "haircut", label: "Getting a haircut", kind: "errand", keys: ["shop:barber", "shop:salon"], minutes: [30, 60], hours: [10, 19] },
  gym: { id: "gym", label: "At the gym", kind: "sport", keys: ["shop:gym"], minutes: [45, 90], hours: [6, 21] },
  sport: { id: "sport", label: "Playing a game", kind: "sport", keys: ["use:park"], court: true, minutes: [40, 90], hours: [8, 20] },
  post: { id: "post", label: "Sending a parcel", kind: "errand", keys: ["shop:print_ship", "use:civic"], minutes: [10, 20], hours: [9, 18] },
  hardware: { id: "hardware", label: "At the hardware store", kind: "errand", keys: ["shop:hardware"], minutes: [15, 30], hours: [8, 19] },
  lunch: { id: "lunch", label: "Lunch out", kind: "meal", keys: [...FOOD, "shop:deli", "shop:cafe"], minutes: [30, 60], hours: [11, 15] },
  dinner: { id: "dinner", label: "Dinner out", kind: "meal", keys: FOOD, minutes: [50, 90], hours: [17, 22] },
  drink: { id: "drink", label: "Out for a drink", kind: "evening", keys: ["shop:bar", "shop:restaurant"], minutes: [60, 150], hours: [17, 24] },
  school_drop: { id: "school_drop", label: "Dropping the kids at school", kind: "errand", keys: ["use:school"], nearest: true, minutes: [5, 15], hours: [8, 8.75] },
  school_pick: { id: "school_pick", label: "Picking the kids up from school", kind: "errand", keys: ["use:school"], nearest: true, minutes: [10, 20], hours: [15, 16] },
  job_hunt: { id: "job_hunt", label: "At a staffing agency", kind: "errand", keys: ["shop:staffing"], anyShop: "Asking about work", minutes: [20, 45], hours: [9, 17] },
  cafe_work: { id: "cafe_work", label: "Working from a café", kind: "work", keys: ["shop:cafe", "shop:bakery"], minutes: [60, 120], hours: [7, 18] },
  study: { id: "study", label: "Studying", kind: "errand", keys: ["shop:cafe", "use:civic"], minutes: [60, 150], hours: [7, 21] },
  walk: { id: "walk", label: "Out for a walk", kind: "stroll", keys: [], home: true, minutes: [25, 60], hours: [6, 21] },
};

// How often each errand comes up, by kind of day.
const ERRANDS = { groceries: 4, pharmacy: 2, bank: 1, laundry: 1.5, post: 1, hardware: 0.8, haircut: 0.6 };
const PARENT_ERRANDS = { ...ERRANDS, groceries: 9 };
const DAY_OFF_ERRANDS = { ...ERRANDS, laundry: 3, haircut: 1.5 };

const ROUND_LABEL = { patrol: "On patrol", deliveries: "Making deliveries", fares: "Driving a taxi", bus: "Driving the bus",
  sweep: "Sweeping the streets", route: "Delivering the mail", site: "On site" };
const KIND_LABEL = { sleep: "Asleep", home: "At home", work: "At work", break: "On a break", errand: "Running an errand",
  meal: "Eating out", stroll: "Out for a walk", sport: "Playing sport", evening: "Out for the evening" };
const WORKING = new Set(["day_shift", "late_shift", "night_shift", "rounds", "student", "remote"]);
const PARENTAL = new Set(["day_shift", "late_shift", "remote", "job_seeker", "day_off"]);

// ---- who does what today ---------------------------------------------------------------------------

// The shift on a day: daySchedule's, to the minute (a few seeded minutes early or late).
function shiftOf(spec, person, d, wd) {
  return (spec && spec.shifts.length && person.work && worksOn(spec.days, wd, d, hash32(person.id) % 7))
    ? spec.shifts[(person.shift || 0) % spec.shifts.length].map((h) => h * 60 + Math.round((rng(person.id, d, "late")() - 0.5) * 20)) : null;
}
// The role they work at, if they work: a career, when given, says whether they do.
function workOf(R, person, career) {
  const status = career?.status || null;
  const role = (status === "employed" && career.role) || person.role;
  const works = status ? status === "employed" || (status === "student" && role === "student") : true;
  return { status, role, spec: works ? R.jobs.roles[role] || null : null };
}
const shiftClass = ([s, e]) => (e > 1440 || s < 300 ? "night_shift" : s >= 660 ? "late_shift" : "day_shift");
const youngChild = (household) => Boolean(household?.members?.some((m) => (m.age ?? 99) < 12));

function baseType(R, person, career, day, weekday) {
  const { status, role, spec } = workOf(R, person, career);
  const age = person.age ?? 30;
  if (status === "child" || (age < 18 && status !== "employed")) return "school_child";
  if (status === "retired" || (!status && role === "retiree")) return "retiree";
  if (status === "looking" || (!status && role === "unemployed")) return "job_seeker";
  const shift = shiftOf(spec, person, day, weekday);
  if (status === "student" || role === "student") return shift ? "student" : "day_off";
  if (!shift) return "day_off";
  if (spec.at.includes("home")) return "remote";
  if (spec.outdoor) return "rounds";
  return shiftClass(shift);
}

//: The kind of day a person has today (one of ROUTINE_TYPES). A household with a child under 12
//: makes an adult a parent; a career, when given, says whether they work at all.
export function routineType(R, person, { household = null, career = null, day = 0, weekday = 0 } = {}) {
  const base = baseType(R, person, career, day, weekday);
  if (PARENTAL.has(base) && (person.age ?? 30) >= 18 && youngChild(household)) return "parent";
  return base;
}

// ---- the places that serve each task ------------------------------------------------------------------

const INDEX = new WeakMap();
function indexOf(places) {
  let ix = INDEX.get(places);
  if (ix && ix.n === places.length) return ix;
  const byId = new Map(), byKey = new Map();
  for (const p of places) {
    byId.set(p.id, p);
    for (const k of p.keys || []) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
  }
  const courts = places.filter((p) => p.court), shops = places.filter((p) => p.shops?.length), tasks = new Map();
  const forTask = (t) => {
    if (!tasks.has(t.id)) {
      const seen = new Set(), list = [];
      const put = (p) => { if (!seen.has(p.id)) { seen.add(p.id); list.push(p); } };
      if (t.court) courts.forEach(put);
      for (const k of t.keys) (byKey.get(k) || []).forEach(put);
      tasks.set(t.id, list);
    }
    return tasks.get(t.id);
  };
  ix = { n: places.length, byId, shops, forTask };
  INDEX.set(places, ix);
  return ix;
}

// ---- a day ---------------------------------------------------------------------------------------------

//: One person's day by their kind of day: the same shape as daySchedule (activities from midnight,
//: in order, none overlapping, a night shift running past 1440), each with a plain ``label``, the
//: minute to be there ``by`` and, for a purposeful stop, its ``task``.
export function dayPlan(R, person, day, weekday, places, { household = null, career = null } = {}) {
  if (!places?.length) return [];
  const type = routineType(R, person, { household, career, day, weekday });
  const key = `${day}|${weekday}|${type}|${places.length}`;
  if (person._plans?.has(key)) return person._plans.get(key);
  const result = build(R, person, day, weekday, places, type, career);
  person._plans ??= new Map();
  if (person._plans.size > 3) person._plans.delete(person._plans.keys().next().value);
  person._plans.set(key, result);
  return result;
}

function build(R, person, day, weekday, places, type, career) {
  const ix = indexOf(places);
  const r = rng(person.id, day, "plan");
  const routine = R.routine;
  const home = person.home;
  const age = person.age ?? 30;
  const { spec } = workOf(R, person, career);
  const base = type === "parent" ? baseType(R, person, career, day, weekday) : type;
  const parent = type === "parent";
  const schoolDay = weekday >= 1 && weekday <= 5;
  const ready = routine.ready_minutes;
  const chance = (p) => r() < Math.min(0.9, (p || 0) * (person.outgoing || 1));
  const pace = (person.pace || 1.3) * 60;
  // Minutes on foot from one place to another (a rough figure, for leaving in time).
  const travel = (a, b) => {
    if (a === b) return 0;
    const A = ix.byId.get(a), B = ix.byId.get(b);
    return A && B ? Math.min(45, 3 + Math.ceil(Math.hypot(A.x - B.x, A.z - B.z) / pace)) : 5;
  };
  const out = [];
  const add = (kind, start, end, place, extra = {}) => {
    if (!(end > start)) return null;
    const a = { kind, start, end, place, ...extra };
    a.label ??= KIND_LABEL[kind];
    out.push(a);
    return a;
  };
  const workLabel = base === "student" ? "In class" : base === "remote" ? "Working from home"
    : (person.outdoor && ROUND_LABEL[person.outdoor]) || "At work";
  const workExtra = { outdoor: person.outdoor, label: workLabel };

  // The nearest of three seeded picks (the nearest outright for a school), not one already used.
  const used = new Map();
  const choose = (t, origin) => {
    const avoid = used.get(t.id);
    let list = ix.forTask(t), fallback = false;
    if (avoid?.size) {
      const rest = list.filter((p) => !avoid.has(p.id));
      if (rest.length) list = rest;
      else if (t.anyShop) list = [];
    }
    if (!list.length && t.anyShop) { list = ix.shops.filter((p) => !avoid?.has(p.id)); fallback = true; }
    if (!list.length) return null;
    const O = ix.byId.get(origin);
    const dist = (p) => (O ? Math.hypot(p.x - O.x, p.z - O.z) : 0);
    let best = null, bd = Infinity;
    if (t.nearest) { for (const p of list) if (dist(p) < bd) { bd = dist(p); best = p; } }
    else for (let k = 0; k < 3; k += 1) { const p = list[Math.floor(r() * list.length) % list.length]; if (dist(p) < bd) { bd = dist(p); best = p; } }
    return { place: best, label: fallback ? t.anyShop : t.label };
  };
  let dayTo = 1430;
  // A task fitted into the first free stretch that has room for it, the way there and back.
  const fit = (id, lo, hi, { origin = home } = {}) => {
    const t = TASKS[id];
    const got = t.home ? { place: ix.byId.get(home) || { id: home }, label: t.label } : choose(t, origin);
    if (!got?.place) return null;
    const P = got.place.id;
    const [m0, m1] = id === "sport" && routine.sport_minutes ? routine.sport_minutes : t.minutes;
    const len = m0 + Math.floor(r() * (m1 - m0 + 1));
    const lo2 = Math.max(lo, Math.round(t.hours[0] * 60)), hi2 = Math.min(hi, Math.round(t.hours[1] * 60) - len);
    if (hi2 < lo2) return null;
    out.sort((a, b) => a.start - b.start);
    for (let i = 0; i < out.length; i += 1) {
      const a = out[i], b = out[i + 1];
      const g1 = b ? b.start : dayTo;
      const e0 = Math.max(a.end + travel(a.place, P), lo2), e1 = Math.min(g1 - travel(P, b ? b.place : home) - len, hi2);
      if (e1 < e0) continue;
      const start = e0 + Math.floor(r() * (Math.min(e1 - e0, 40) + 1));
      const extra = { task: id, label: got.label };
      if (t.kind === "stroll") Object.assign(extra, { outdoor: "stroll", seed: Math.floor(r() * 1e9) });
      if (t.kind === "work") extra.outdoor = person.outdoor;
      if (!used.has(id)) used.set(id, new Set());
      used.get(id).add(P);
      return add(t.kind, start, start + len, P, extra);
    }
    return null;
  };
  const done = new Set();
  const errands = (n, lo, hi, weights = parent ? PARENT_ERRANDS : ERRANDS) => {
    let got = 0;
    for (let k = 0; k < n * 3 && got < n; k += 1) {
      const ids = Object.keys(weights).filter((id) => !done.has(id));
      if (!ids.length) break;
      let x = r() * ids.reduce((s, id) => s + weights[id], 0), id = ids[ids.length - 1];
      for (const c of ids) { x -= weights[c]; if (x <= 0) { id = c; break; } }
      done.add(id);
      if (fit(id, lo, hi)) got += 1;
    }
    return got;
  };
  const some = (p, p2) => (chance(p) ? (chance(p2) ? 2 : 1) : 0);
  const sportId = () => (ix.forTask(TASKS.sport).length ? "sport" : "gym");
  // After the fixed part of the day: dinner out, a game, a walk, a drink.
  const evenings = (from, { dinner = true, drink = true } = {}) => {
    if (dinner && chance(routine.meal_out_chance)) fit("dinner", Math.max(from, 1050), 1260);
    if (age < 70 && chance(routine.sport_chance)) fit(sportId(), from, 1200);
    if (chance(routine.stroll_chance)) fit("walk", from, 1230);
    if (drink && chance(routine.evening_out_chance)) fit("drink", Math.max(from, 1140), 1350);
  };

  // ---- the morning: still at work from last night, or asleep until it is time to get ready
  const yesterday = shiftOf(spec, person, day - 1, (weekday + 6) % 7);
  let clock = 0;
  if (yesterday && yesterday[1] > 1440) {
    add("work", 0, yesterday[1] - 1440, person.work, { ...workExtra });
    clock = yesterday[1] - 1440;
  }
  const shift = WORKING.has(base) ? shiftOf(spec, person, day, weekday) : null;
  const cls = shift ? shiftClass(shift) : null;
  const school = (() => {
    const own = ix.byId.get(person.work);
    if (own?.keys?.has("use:school")) return own;
    return choose({ ...TASKS.school_drop, id: "school" }, home)?.place || null;
  })();
  const atSchool = base === "school_child" && schoolDay && age >= 5 && school;
  const nearSchool = parent && schoolDay ? choose(TASKS.school_drop, home)?.place || null : null;
  const drop = nearSchool && clock < 420 && (!shift || shift[0] >= 515 + travel(nearSchool.id, person.work));
  const coffee = (cls === "day_shift" || base === "student") && chance(routine.meal_out_chance);
  // The first thing to be at in the morning.
  const commit = drop ? { at: 480, place: nearSchool.id } : atSchool ? { at: 495, place: school.id }
    : shift && shift[0] < 1440 ? { at: shift[0], place: person.work } : null;
  const lazy = { retiree: 390 + r() * 90, school_child: 480 + r() * 90, job_seeker: 450 + r() * 90, day_off: 510 + r() * 120,
    late_shift: 450 + r() * 120, night_shift: 570 + r() * 120, remote: 420 + r() * 90 }[cls && base === "rounds" ? cls : base] ?? 600;
  if (clock > 0) {
    const wake = Math.max(clock, Math.min(clock + routine.sleep_hours * 60, shift ? shift[0] - 90 : 15 * 60));
    add("sleep", clock, wake, home);
    add("home", wake, wake + ready, home, { label: "Getting ready" });
    clock = Math.max(clock, wake + ready);
  } else {
    let wake = Math.floor(lazy);
    if (commit) wake = Math.min(wake, commit.at - ready - travel(home, commit.place) - 5 - Math.floor(r() * 15) - (coffee ? 35 : 0));
    if (wake < 60 && commit) {
      // Up and straight out to a shift at midnight.
      const go = Math.max(0, commit.at - travel(home, commit.place));
      add("sleep", 0, go, home);
      clock = go;
    } else {
      wake = Math.max(wake, 60);
      add("sleep", 0, wake, home);
      add("home", wake, wake + ready, home, { label: "Getting ready" });
      clock = wake + ready;
    }
  }

  // ---- the night: in bed in time for tomorrow, children by nine
  const tomorrow = shiftOf(spec, person, day + 1, (weekday + 1) % 7);
  let softBed = { retiree: 1260 + r() * 60, school_child: age < 12 ? 1170 + r() * 60 : 1230 + r() * 30 }[base] ?? 1320 + r() * 90;
  let hardBed = base === "retiree" ? softBed + 20 : base === "school_child" ? 1260 : 1430;
  if (tomorrow) {
    const lead = ready + travel(home, person.work) + 10;
    const up = tomorrow[0] - lead >= 60 ? tomorrow[0] - lead : tomorrow[0] - travel(home, person.work);
    hardBed = Math.min(hardBed, up + 1440 - routine.sleep_hours * 60);
  }

  // ---- the fixed part: work, school, the school run
  if (shift) {
    const [s, e] = shift;
    const W = person.work;
    if (base === "remote" && e - s > 360) {
      const b = s + routine.break_after_hours * 60;
      add("work", s, b, W, { ...workExtra });
      let t = b + routine.break_minutes, cur = W;
      const L = chance(routine.meal_out_chance * 1.3) ? choose(TASKS.lunch, W) : null;
      if (L?.place) {
        const l0 = b + travel(W, L.place.id), l1 = l0 + 30 + Math.floor(r() * 25);
        if (l0 >= 660 && l1 <= 900 && l1 + travel(L.place.id, W) < e - 60) { add("meal", l0, l1, L.place.id, { task: "lunch", label: L.label }); t = l1; cur = L.place.id; }
        else add("break", b, b + routine.break_minutes, W, { outside: true });
      } else add("break", b, b + routine.break_minutes, W, { outside: true });
      // Some afternoons at a café.
      const C = r() < 0.4 ? choose(TASKS.cafe_work, cur) : null;
      if (C?.place) {
        const c0 = t + travel(cur, C.place.id);
        let c1 = c0 + 60 + Math.floor(r() * 61);
        if (c1 + travel(C.place.id, W) + 20 > e) c1 = e;
        if (c1 <= 18 * 60 && c1 - c0 >= 45) { add("work", c0, c1, C.place.id, { outdoor: person.outdoor, task: "cafe_work", label: C.label }); t = c1; cur = C.place.id; }
      }
      if (t < e) add("work", t + travel(cur, W), e, W, { ...workExtra });
    } else if (e - s > 6 * 60) {
      const breakAt = s + routine.break_after_hours * 60;
      add("work", s, breakAt, W, { ...workExtra });
      add("break", breakAt, breakAt + routine.break_minutes, W, { outside: true });
      add("work", breakAt + routine.break_minutes, e, W, { ...workExtra });
    } else add("work", s, e, W, { ...workExtra });
  }
  if (atSchool) add("work", 495, 900, school.id, { outdoor: person.outdoor, label: "At school" });
  const lastFixed = out.reduce((m, a) => Math.max(m, a.end), 0);
  hardBed = Math.max(hardBed, Math.min(1430, lastFixed + 15));
  softBed = Math.min(softBed, hardBed);
  dayTo = Math.floor(hardBed);
  if (drop) fit("school_drop", 480, 500);
  if (nearSchool) fit("school_pick", 900, 930);

  // ---- the tasks, by the kind of day
  const errandsN = () => some(routine.errand_chance * (parent ? 1.4 : 1), routine.errand_chance * 0.5);
  const kind = base === "rounds" ? cls : base;
  if (shift && (kind === "day_shift" || kind === "late_shift" || kind === "night_shift" || base === "student")) {
    const [s, e] = shift;
    if (coffee) fit("coffee", clock, s - 10);
    if (base === "student") {
      if (r() < 0.6) fit("study", e, 1140);
      errands(chance(routine.errand_chance * 0.6) ? 1 : 0, e, 1260);
      evenings(e);
    } else if (kind === "day_shift") {
      errands(errandsN(), e, 1260);
      evenings(e);
    } else if (kind === "late_shift") {
      errands(errandsN(), clock, s - 30);
      if (chance(routine.meal_out_chance)) fit("lunch", 690, Math.min(840, s - 60));
      if (age < 70 && chance(routine.sport_chance)) fit(sportId(), clock, s - 90);
      if (chance(routine.stroll_chance)) fit("walk", clock, s - 60);
      if (e < 1350 && chance(routine.evening_out_chance * 0.7)) fit("drink", e, 1380);
    } else if (e > 1440) {
      // Up in the afternoon, out for a while, home and off again.
      errands(errandsN(), 900, s - 45);
      if (chance(routine.meal_out_chance * 0.7)) fit("dinner", 1020, s - 90);
      if (age < 70 && chance(routine.sport_chance)) fit(sportId(), 840, s - 120);
      if (chance(routine.stroll_chance)) fit("walk", 840, s - 60);
    } else {
      // An early start: the afternoon free, an early night.
      errands(errandsN(), e, 1080);
      if (chance(routine.meal_out_chance)) fit("lunch", e, 840);
      if (age < 70 && chance(routine.sport_chance)) fit(sportId(), e, 1140);
      if (chance(routine.stroll_chance)) fit("walk", e, 1140);
    }
  } else if (base === "remote") {
    errands(errandsN(), shift[1], 1260);
    evenings(shift[1]);
  } else if (base === "school_child") {
    if (atSchool) {
      if (age >= 8 && chance(routine.sport_chance * 1.5)) fit(sportId(), 915, 1140);
      if (age >= 10 && chance(routine.stroll_chance * 0.5)) fit("walk", 930, 1170);
    } else {
      if (age >= 6 && chance(routine.sport_chance * 2)) fit(sportId(), 540, 1140);
      if (age >= 8 && chance(routine.stroll_chance)) fit("walk", 540, 1170);
    }
  } else if (base === "retiree") {
    if (chance(0.75)) fit("walk", 420, 630);
    if (chance(routine.meal_out_chance)) fit("coffee", 510, 660);
    errands(some(Math.max(routine.errand_chance, 0.6), routine.errand_chance * 0.6), 600, 930);
    if (chance(routine.meal_out_chance)) fit("lunch", 690, 810);
    if (chance(routine.meal_out_chance * 0.4)) fit("dinner", 1020, 1110);
  } else if (base === "job_seeker" && schoolDay) {
    const hunts = 2 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < hunts; k += 1) fit("job_hunt", 570, 990);
    errands(chance(routine.errand_chance) ? 1 : 0, 600, 1200);
    evenings(1020, { drink: false });
  } else {
    // A day off (or a job seeker's weekend): a late start, a few things done, out for a while.
    errands(2 + (chance(routine.errand_chance) ? 1 : 0), 600, 1200, parent ? PARENT_ERRANDS : DAY_OFF_ERRANDS);
    if (chance(routine.meal_out_chance)) fit("lunch", 690, 840);
    if (age < 70 && chance((routine.sport_chance || 0) * 1.5)) fit(sportId(), 600, 1140);
    else if (chance(routine.stroll_chance)) fit("walk", 600, 1200);
    if (chance(routine.meal_out_chance)) fit("dinner", 1050, 1260);
    if (chance(routine.evening_out_chance * 1.3)) fit("drink", 1170, 1350);
  }

  // ---- home and to bed (none after a shift that runs past midnight)
  out.sort((a, b) => a.start - b.start);
  const last = out.reduce((m, a) => (a.end > m.end ? a : m), out[0]);
  if (last.end <= 1440) add("sleep", Math.min(1440, Math.max(Math.floor(softBed), last.end + travel(last.place, home))), 1441, home);

  // Activities in order, none overlapping (as daySchedule), and at home between stops far apart.
  out.sort((a, b) => a.start - b.start);
  for (let i = 1; i < out.length; i += 1) if (out[i].start < out[i - 1].end) { const len = out[i].end - out[i].start; out[i].start = out[i - 1].end; out[i].end = Math.max(out[i].end, out[i].start + Math.min(len, 30)); }
  const result = [];
  for (const a of out) {
    if (!(a.end > a.start)) continue;
    const b = result[result.length - 1];
    if (b && b.place !== home && a.place !== home) {
      const h0 = b.end + travel(b.place, home), h1 = a.start - travel(home, a.place);
      if (h1 - h0 >= 30) result.push({ kind: "home", start: h0, end: h1, place: home, label: KIND_LABEL.home });
    }
    result.push(a);
  }
  const end = result[result.length - 1];
  if (end?.kind === "sleep") end.end = 1441;
  for (const a of result) a.by = a.start;
  return result;
}

//: Where the person has to be and by when, in order: one milestone each time the place changes.
export function milestonesOf(plan) {
  const out = [];
  let at = undefined;
  for (const a of plan || []) {
    if (out.length && a.place === at) continue;
    out.push({ at: a.by ?? a.start, place: a.place, label: a.label });
    at = a.place;
  }
  return out;
}
