// A business's books as records and as reading: what each day and week took and cost, and from
// those the figures an owner (or a buyer) reads -- revenue and profit over the past month, three
// months and year, the average order, what sells and at what margin week by week, where the money
// goes, and a balance sheet.
//
// Every figure is a sum of what the world recorded as it happened: the customers the world's hours
// brought (enterprise.mjs hourOf) and what players bought at the counter. Nothing is worked out
// from a formula after the fact, with one exception that is always labelled: days before the
// records begin are filled from ``estimate(week)`` (the same hourly model, run for a typical week)
// and every total says how many of its days are estimated. All spans are game days.
//
// Pure: no world, no DOM. enterprise.mjs keeps the records with foldDay(); the panels read them
// with analyse().

export const DAYS_KEPT = 120, WEEKS_KEPT = 60, ITEM_WEEKS = 13, TX_KEPT = 60;
export const PERIODS = [[30, "Past month"], [90, "Past 3 months"], [365, "Past year"]];
const SUMS = ["sales", "cogs", "wages", "rent", "fees", "tax", "profit", "orders", "units", "visits", "served", "lost", "player_sales"];
export const weekOf = (day) => Math.floor(day / 7);
const zero = () => Object.fromEntries(SUMS.map((k) => [k, 0]));

//: A closed day into the records: the day's line kept (``days`` of them), and folded into its week
//: with what sold (``items``: {id: [units, sales, cost]}). Item detail is kept for ITEM_WEEKS.
export function foldDay(rec, line, items = {}, { days = DAYS_KEPT } = {}) {
  rec.books ||= []; rec.weeks ||= [];
  rec.since ??= line.day;
  rec.books.push(line);
  if (rec.books.length > days) rec.books.splice(0, rec.books.length - days);
  const wk = weekOf(line.day);
  let w = rec.weeks.find((x) => x.week === wk);
  if (!w) { w = { week: wk, days: 0, ...zero(), items: {} }; rec.weeks.push(w); rec.weeks.sort((a, b) => a.week - b.week); }
  w.days += 1;
  for (const k of SUMS) w[k] += line[k] || 0;
  w.items ||= {};
  for (const [id, [n, s, c]] of Object.entries(items)) { const x = (w.items[id] ||= [0, 0, 0]); x[0] += n; x[1] += s; x[2] += c; }
  if (rec.weeks.length > WEEKS_KEPT) rec.weeks.splice(0, rec.weeks.length - WEEKS_KEPT);
  for (const x of rec.weeks) if (x.week < wk - ITEM_WEEKS && x.items) delete x.items;
  return w;
}

//: A money movement on the business's account, newest last.
export function noteTx(rec, tx) {
  rec.tx ||= [];
  rec.tx.push(tx);
  if (rec.tx.length > TX_KEPT) rec.tx.splice(0, rec.tx.length - TX_KEPT);
}

//: What one day took and cost, and whether that is a record or an estimate.
function dayOf(rec, day, byDay, byWeek, oldest, estimate) {
  const line = byDay.get(day);
  if (line) return { v: line, real: true };
  if (rec.since !== undefined && rec.since !== null && day >= rec.since) {
    // After the records begin: an older day folded into its week, or a day with nothing in it.
    const w = day < oldest ? byWeek.get(weekOf(day)) : null;
    if (w?.days) return { v: Object.fromEntries(SUMS.map((k) => [k, w[k] / w.days])), real: true };
    return { v: null, real: true };
  }
  const e = estimate ? estimate(weekOf(day)) : null;
  return e ? { v: Object.fromEntries(SUMS.map((k) => [k, (e[k] || 0) / 7])), real: false } : { v: null, real: false, none: true };
}

//: The books read: {periods, weekly, items, costs, orders, recent, since, estimated}.
//: ``today``: the open day (not counted); ``estimate(week)``: a typical week for the days before
//: the records begin, or null to leave them out; ``names(id)``: an item's name.
export function analyse(rec, { today, estimate = null, names = (id) => id, weeks = 26 } = {}) {
  const byDay = new Map((rec.books || []).map((l) => [l.day, l]));
  const byWeek = new Map((rec.weeks || []).map((w) => [w.week, w]));
  const oldest = rec.books?.length ? rec.books[0].day : today;
  const cache = new Map();
  const est = estimate ? (wk) => { if (!cache.has(wk)) cache.set(wk, estimate(wk)); return cache.get(wk); } : null;
  const span = (from, to) => {
    const out = { ...zero(), days: 0, estimated_days: 0, missing_days: 0 };
    for (let d = from; d < to; d += 1) {
      const { v, real, none } = dayOf(rec, d, byDay, byWeek, oldest, est);
      out.days += 1;
      if (none) { out.missing_days += 1; continue; }
      if (!real) out.estimated_days += 1;
      if (v) for (const k of SUMS) out[k] += v[k] || 0;
    }
    for (const k of SUMS) out[k] = Math.round(out[k]);
    out.margin = out.sales > 0 ? out.profit / out.sales : 0;
    out.average_order = out.orders > 0 ? Math.round(out.sales / out.orders) : 0;
    return out;
  };
  const periods = PERIODS.map(([n, label]) => ({ key: n, label, ...span(today - n, today) }));
  // Week by week, oldest first; the current week is its days so far.
  const thisWeek = weekOf(today), weekly = [];
  for (let wk = thisWeek - weeks + 1; wk <= thisWeek; wk += 1) {
    const s = span(Math.max(wk * 7, today - weeks * 7), Math.min((wk + 1) * 7, today));
    if (!s.days) continue;
    weekly.push({ week: wk, start: wk * 7, days: s.days, sales: s.sales, profit: s.profit, orders: s.orders, cogs: s.cogs, wages: s.wages,
      average_order: s.average_order, estimated: s.estimated_days === s.days && s.days > 0, partly_estimated: s.estimated_days > 0 && s.estimated_days < s.days });
  }
  // What sells: the last four weeks' units, sales and margin by item, and each item's units week by week.
  const itemWeeks = [];
  for (let wk = thisWeek - ITEM_WEEKS + 1; wk <= thisWeek; wk += 1) {
    const w = byWeek.get(wk);
    const real = w?.items && (rec.since ?? Infinity) <= (wk + 1) * 7 - 1;
    const e = !real && est && (rec.since === undefined || rec.since === null || wk * 7 < rec.since) ? est(wk) : null;
    itemWeeks.push({ week: wk, items: real ? w.items : e?.items || {}, estimated: !real && Boolean(e) });
  }
  const totals = new Map();
  for (const w of itemWeeks.slice(-4)) for (const [id, [n, s, c]] of Object.entries(w.items)) { const x = totals.get(id) || [0, 0, 0]; x[0] += n; x[1] += s; x[2] += c; totals.set(id, x); }
  const allUnits = [...totals.values()].reduce((s, x) => s + x[0], 0);
  const items = [...totals].map(([id, [n, s, c]]) => ({ id, name: names(id), units: Math.round(n), sales: Math.round(s), cost: Math.round(c), share: allUnits ? n / allUnits : 0,
    margin: s > 0 ? (s - c) / s : 0, profit: Math.round(s - c), price: n > 0 ? Math.round(s / n) : 0,
    weekly: itemWeeks.map((w) => ({ week: w.week, units: Math.round(w.items[id]?.[0] || 0), estimated: w.estimated })) })).sort((a, b) => b.units - a.units);
  const costs = periods.map((p) => ({ key: p.key, label: p.label, parts: [["Goods sold", p.cogs], ["Wages", p.wages], ["Rent", p.rent], ["Licences, fees and loan", p.fees]].map(([name, value]) => ({ name, value })),
    total: p.cogs + p.wages + p.rent + p.fees }));
  const month = periods[0];
  return { periods, weekly, items, item_weeks: itemWeeks.map((w) => ({ week: w.week, estimated: w.estimated })), costs,
    orders: { average: month.average_order, per_day: month.days ? month.orders / month.days : 0, count: month.orders, units_per_order: month.orders ? month.units / month.orders : 0,
      turned_away: month.lost, served_share: month.served + month.lost > 0 ? month.served / (month.served + month.lost) : 1, at_counter: month.player_sales },
    recent: (rec.tx || []).slice().reverse(), since: rec.since ?? null,
    estimated: periods.some((p) => p.estimated_days > 0) };
}
