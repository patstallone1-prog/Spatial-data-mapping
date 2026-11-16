// Borrowing: a credit score read from the city's own records, the bankers who lend against it,
// and the loans themselves (rules.json "credit").
//
// * The score (300-850, the FICO weights) is never stored: it is worked out from what the books
//   already hold -- bills and instalments paid on time or late, what is owed against free cash and
//   assets, how long you have been here, recent applications, the kinds of credit handled -- so it
//   can not be edited, only earned.
// * A bank has a banker for each kind of lending (small loans and medical bills; home loans;
//   business and vehicle lending). You ask the one whose desk it is; they read your score, your
//   last month's money in and out, your assets and the amount, and give a rate, or say no and why.
// * The same loans are sold online, to weaker files, at a much higher rate and for less.
// * A loan is paid monthly (30 game days) as a bill; three missed and it defaults to collections.
//
// Pure like the rest of the world: installCredit() adds the methods to CityWorld. Every figure a
// command uses is worked out here, from the world, never taken from the caller.

import { loanPayment } from "./core.mjs";
import { mortgageTerms } from "./market.mjs";
import { FIRST, LAST, rng } from "./people.mjs";

const DAY = 86_400_000, MONTH = 30 * DAY;
export const CREDIT_COMMANDS = ["loan_quote", "take_loan", "repay_loan", "preapprove_mortgage", "loan_autopay"];
//: Money coming in that is not income: borrowed, granted, or moved between your own pockets.
const NOT_INCOME = new Set(["mint:bank_loan", "mint:external_trade", "mint:starter_grant", "mint:account_grant", "owner_draw", "deposit", "sale", "gift"]);
const FLOW_DAYS = 120, CLOSED_KEPT = 12, OPEN_MAX = 6;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pct = (x) => `${(x * 100).toFixed(x * 100 % 1 ? 1 : 0)}%`;
const points = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2).replace(/\.?0+$/, "")} pts`;

// ---- rules ----------------------------------------------------------------------------------------

const perRules = new WeakMap();
//: rules.json "credit" with its amounts in minor units.
export function creditRules(R) {
  let C = perRules.get(R);
  if (C) return C;
  C = structuredClone(R.credit);
  for (const P of Object.values(C.products)) for (const k of ["min", "limit"]) if (P[k] !== undefined) P[k] = R.money(P[k]);
  C.score.cushion_floor = R.money(C.score.cushion_floor);
  C.no_income_limit = R.money(C.no_income_limit);
  perRules.set(R, C);
  return C;
}
export function bandOf(R, score) { return creditRules(R).score.bands.find(([at]) => score >= at)?.[1] || "poor"; }
function tierAdd(C, score) { return (C.tiers.find(([at]) => score >= at) || C.tiers.at(-1))[1]; }

//: The bankers at a bank: one for each kind of lending, the bank's own (invented, as its lawyers
//: are a law office's), each with a manner that moves a rate a little.
export function bankersAt(R, place) {
  const C = creditRules(R);
  return Object.entries(C.bankers).map(([specialty, b]) => {
    const r = rng("banker", place.id, specialty);
    const name = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
    const [style, rateAdd, scoreAdd] = C.styles[Math.floor(r() * C.styles.length) % C.styles.length];
    return { id: `banker:${place.id}:${specialty}`, name, specialty, title: b.title, handles: b.handles, years: 2 + Math.floor(r() * 24), style, rate_add: rateAdd, score_add: scoreAdd,
      products: Object.entries(C.products).filter(([, P]) => P.specialist === specialty).map(([id]) => id) };
  });
}
//: Which banker's desk a kind of loan is.
export function specialistFor(R, product) { return creditRules(R).products[product]?.specialist || null; }

// ---- the score (pure) -------------------------------------------------------------------------------

//: The score from the facts (creditFacts): {score, band, factors: [{key, label, weight, value, text}]}.
export function creditScore(R, f) {
  const C = creditRules(R), S = C.score, B = S.weights_bad;
  const bad = f.late * B.late + f.overdue * B.overdue + f.collections * B.collections + f.defaults * B.default;
  const payment = (f.on_time + S.prior_good) / (f.on_time + S.prior_good + S.prior_bad + bad);
  const backing = f.cash + 0.5 * f.assets + 6 * f.income_month;
  const use = f.debt > 0 ? clamp(f.debt / Math.max(1, backing), 0, 1) : 0;
  const cushion = clamp(f.cash / Math.max(S.cushion_floor, f.obligations * S.cushion_months), 0, 1);
  const owed = 0.6 * (1 - use) + 0.4 * cushion;
  const length = 0.6 * clamp(f.days_here / S.history_days, 0, 1) + 0.4 * clamp(f.days_credit / S.history_days, 0, 1);
  const fresh = 1 - clamp(f.inquiries / S.inquiries_full, 0, 1);
  const mix = clamp(f.kinds / S.mix_full, 0, 1);
  const W = S.weights;
  const share = W.payment * payment + W.owed * owed + W.length * length + W.new_credit * fresh + W.mix * mix;
  const score = Math.round(S.min + (S.max - S.min) * share);
  const fmt = R.fmt;
  const factors = [
    { key: "payment", label: "Payment history", weight: W.payment, value: payment,
      text: bad ? `${f.on_time} paid on time; ${[[f.late, "paid late"], [f.overdue, "overdue now"], [f.collections, "in collections"], [f.defaults, "defaulted"]].filter(([n]) => n).map(([n, t]) => `${n} ${t}`).join(", ")}`
        : f.on_time ? `${f.on_time} bill${f.on_time > 1 ? "s" : ""} and payment${f.on_time > 1 ? "s" : ""} on time, none late` : "nothing paid yet: no record either way" },
    { key: "owed", label: "What you owe against what you have", weight: W.owed, value: owed,
      text: `${fmt(f.debt)} owed; ${fmt(f.cash)} free cash, ${fmt(f.assets)} in assets, ${fmt(f.income_month)} in over the last month` },
    { key: "length", label: "Length of history", weight: W.length, value: length,
      text: `${Math.floor(f.days_here)} days in the city${f.days_credit ? `, ${Math.floor(f.days_credit)} since your first credit` : ", no credit yet"}` },
    { key: "new_credit", label: "New credit", weight: W.new_credit, value: fresh, text: f.inquiries ? `${f.inquiries} application${f.inquiries > 1 ? "s" : ""} in the last ${S.inquiry_days} days` : "no recent applications" },
    { key: "mix", label: "Kinds of credit", weight: W.mix, value: mix, text: f.kinds ? `${f.kinds} kind${f.kinds > 1 ? "s" : ""} handled (bills, loans, a mortgage, business credit)` : "none handled yet" },
  ];
  return { score, band: bandOf(R, score), factors };
}

// ---- a banker's decision (pure) ---------------------------------------------------------------------

//: What a lender says to ``amount`` over ``months`` of ``product``: {approved, rate, monthly, total,
//: interest, max, reasons, moves}. ``channel``: "branch" (with ``banker``) or "online".
export function assessLoan(R, f, { product, amount, months, channel = "branch", banker = null }) {
  const C = creditRules(R), P = C.products[product], ch = C.channels[channel] || C.channels.online;
  const { score, band } = creditScore(R, f);
  const out = { product, name: P?.name, channel, banker: banker?.name || null, score, band, approved: false, amount, months, reasons: [], moves: [] };
  const no = (why) => { out.reasons.push(why); return out; };
  if (!P || product === "mortgage") return no("not a loan this desk writes");
  if (channel === "online" && !P.online) return no(`${P.name}s are written in a branch, by its ${C.bankers[P.specialist].title.toLowerCase()}`);
  if (!P.months.includes(months)) return no(`over ${P.months.join(", ")} months`);
  // How much: months of income, a share of assets, or for someone with no income yet a little against savings.
  let max = f.income_month > 0 ? f.income_month * P.income_months : Math.min(C.no_income_limit, Math.round(f.cash * C.cash_share_limit));
  if (P.asset_share) max += Math.round(f.assets * P.asset_share);
  const unit = R.money(50);
  out.max = Math.max(0, Math.floor(Math.min(P.limit, max * ch.amount_share) / unit) * unit);
  if (!(amount >= P.min)) return no(`${P.name}s start at ${R.fmt(P.min)}`);
  const least = P.min_score + ch.min_score_add + (banker?.score_add || 0);
  if (score < least) return no(`a score of ${score} (${band}) is under the ${least} ${channel === "online" ? "the online lender" : "this desk"} needs for a ${P.name.toLowerCase()}`);
  if (f.collections + f.defaults > 0 && channel !== "online") return no("a debt in collections or a default has to be cleared first");
  if (amount > out.max) return no(out.max >= P.min ? `the most on your income and assets is ${R.fmt(out.max)}` : `there is not the income or savings to lend against yet${channel === "online" ? "" : ": work a few shifts, then come back"}`);
  // The rate: the product's, moved by the score, the channel, the term, the banker, the load and the security.
  let rate = P.rate;
  const move = (label, by) => { if (by) { rate += by; out.moves.push({ label, by }); } };
  out.moves.push({ label: `${P.name}, base rate`, by: P.rate, base: true });
  move(`Credit score ${score} (${band})`, tierAdd(C, score));
  move(channel === "online" ? "Online lender" : "In person", ch.rate_add);
  move(`${months} months`, C.term_add_per_year * Math.max(0, months / 12 - 1));
  if (banker) move(`${banker.name.split(" ")[0]} is ${banker.style}`, banker.rate_add);
  if (P.asset_share && f.assets >= amount) move("Covered by your assets", -C.collateral_cut);
  let monthly = loanPayment(amount, clamp(rate, C.rate_floor, C.rate_cap), months / 12);
  if (f.income_month > 0) {
    const dti = (f.obligations + monthly) / f.income_month;
    if (dti > C.dti_limit * 1.5) return no(`the payments (${R.fmt(monthly)} with ${R.fmt(f.obligations)} you already pay) would be ${pct(dti)} of the ${R.fmt(f.income_month)} you took in last month`);
    if (dti > C.dti_limit) move(`Payments ${pct(dti)} of your income`, C.dti_add);
  }
  rate = Math.round(clamp(rate, C.rate_floor, C.rate_cap) * 10000) / 10000;
  monthly = loanPayment(amount, rate, months / 12);
  Object.assign(out, { approved: true, rate, monthly, total: monthly * months, interest: monthly * months - amount });
  out.reasons = out.moves.map((m) => (m.base ? `${m.label} ${pct(m.by)}` : `${m.label}: ${points(m.by)}`));
  return out;
}

//: A home loan on ``price``: the housing rules' terms at this borrower's rate.
export function assessMortgage(R, f, price, { channel = "online", banker = null } = {}) {
  const C = creditRules(R), P = C.products.mortgage, M = R.housing.mortgage;
  const { score, band } = creditScore(R, f);
  const base = mortgageTerms(R, price);
  const out = { product: "mortgage", name: P.name, channel, banker: banker?.name || null, score, band, approved: false, price, reasons: [], moves: [{ label: `${M.years}-year fixed, base rate`, by: M.rate, base: true }] };
  const least = P.min_score + (banker?.score_add || 0);
  if (score < least) { out.reasons.push(`a score of ${score} (${band}) is under the ${least} a home loan needs`); return out; }
  if (f.collections + f.defaults > 0) { out.reasons.push("a debt in collections or a default has to be cleared first"); return out; }
  let rate = M.rate;
  const move = (label, by) => { if (by) { rate += by; out.moves.push({ label, by }); } };
  move(`Credit score ${score} (${band})`, tierAdd(C, score) * 0.5);
  move(channel === "online" ? "Arranged online" : "In person", channel === "online" ? P.online_add : 0);
  if (banker) move(`${banker.name.split(" ")[0]} is ${banker.style}`, banker.rate_add);
  const first = loanPayment(base.loan, rate, M.years);
  if (f.income_month > 0 && (f.obligations + first) / f.income_month > P.payment_share) move(`Payments over ${pct(P.payment_share)} of your income`, 0.005);
  if (!f.income_month) move("No income on record", 0.005);
  rate = Math.round(clamp(rate, C.rate_floor, C.rate_cap) * 10000) / 10000;
  Object.assign(out, { approved: true, rate, ...base, rate_base: M.rate, monthly: loanPayment(base.loan, rate, M.years) });
  out.rate = rate;
  out.reasons = out.moves.map((m) => (m.base ? `${m.label} ${pct(m.by)}` : `${m.label}: ${points(m.by)}`));
  return out;
}

// ---- the world's side -------------------------------------------------------------------------------

export function installCredit(CityWorld, CityError) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };
  const book = (p) => (p.credit ||= { flow: {}, inquiries: [], marks: [], first: null, seq: 0, preapproval: null });

  //: What the books say of a borrower: the facts the score and a banker read.
  W.creditFacts = function (p) {
    const c = book(p), R = this.R, C = creditRules(R);
    const f = { on_time: 0, late: 0, overdue: 0, collections: 0, defaults: 0 };
    const kinds = new Set();
    for (const b of this.billing.bills.values()) {
      if (b.payer !== p.account) continue;
      if (b.status === "paid") { if (b.stage > 0) f.late += 1; else f.on_time += 1; kinds.add(b.kind === "loan" ? "loan" : b.kind === "mortgage" ? "mortgage" : "bills"); }
      else if (b.status === "open") { if (b.collections || b.kind === "loan_default") f.collections += 1; else if (b.stage > 0) f.overdue += 1; }
    }
    f.defaults = c.marks.filter((m) => this.now - m.t < 720 * DAY).length;
    const loans = (p.loans || []).filter((l) => l.status === "open");
    for (const l of p.loans || []) kinds.add(l.product === "business" ? "business" : "loan");
    if ((p.mortgages || []).length) kinds.add("mortgage");
    const mine = [...(this.biz?.values() || [])].filter((b) => b.owner === p.account && b.status === "open");
    const seller = mine.reduce((s, b) => s + (b.loan?.left > 0 ? b.loan.left * b.loan.monthly : 0), 0);
    if (seller) kinds.add("business");
    f.kinds = kinds.size;
    f.cash = this.ledger.balance(p.account);
    f.debt = this.billing.owed(p.account) + loans.reduce((s, l) => s + l.owed, 0) + (p.mortgages || []).reduce((s, m) => s + m.owed, 0) + seller;
    f.obligations = loans.reduce((s, l) => s + l.monthly, 0) + (p.mortgages || []).reduce((s, m) => s + m.monthly, 0) + mine.reduce((s, b) => s + (b.loan?.left > 0 ? b.loan.monthly : 0), 0)
      + (p.lease?.rent || 0);
    let assets = 0;
    for (const a of this.registry.owned(p.account)) {
      if (a.kind === "vehicle") assets += Math.max(0, Math.round(a.attrs.value || R.vehicles.models[a.attrs.model]?.price || 0));
      else if (a.kind === "home" || a.kind === "building") assets += Math.max(0, Math.round(a.attrs.assessed || 0));
    }
    for (const b of mine) assets += this.ledger.balance(b.account);
    f.assets = assets;
    const today = Math.floor(this.now / DAY);
    let inn = 0, out = 0, in90 = 0;
    for (const [d, [i, o]] of Object.entries(c.flow)) { const age = today - d; if (age < 30) { inn += i; out += o; } if (age < 90) in90 += i; }
    f.income_month = inn; f.spend_month = out; f.income_90 = in90;
    f.days_here = (this.now - (p.joined ?? this.now)) / DAY;
    f.days_credit = c.first ? (this.now - c.first) / DAY : 0;
    f.inquiries = c.inquiries.filter((t) => this.now - t < C.score.inquiry_days * DAY).length;
    return f;
  };
  //: Everything the You panel and a banker show: the score with its reasons, the loans, the marks.
  W.creditReport = function (pid) {
    const p = this.player(pid), facts = this.creditFacts(p), c = book(p);
    return { ...creditScore(this.R, facts), facts, loans: (p.loans || []).map((l) => ({ ...l })), mortgages: (p.mortgages || []).map((m) => ({ ...m, rate: m.rate ?? this.R.housing.mortgage.rate })),
      marks: c.marks.slice(), preapproval: c.preapproval && c.preapproval.until > this.now ? c.preapproval : null,
      flow: Object.entries(c.flow).map(([d, [i, o]]) => ({ day: +d, in: i, out: o })).sort((a, b) => a.day - b.day) };
  };
  //: The bank and the banker a command names, checked: [channel, banker]. No place is the online lender.
  W.lender = function (p, place, bankerId, product) {
    if (!place?.id) return ["online", null];
    if (!(place.keys || []).includes("shop:bank")) fail("that is not a bank");
    if (!this.near(p, place, this.R.stores.reach_m * 4)) fail("walk into the bank first");
    const all = bankersAt(this.R, place), want = specialistFor(this.R, product);
    const right = all.find((b) => b.specialty === want);
    const asked = all.find((b) => b.id === bankerId);
    if (!asked) fail("which banker?");
    if (asked !== right) fail(`${asked.name} looks after ${asked.handles}: ${right.name}, at the next desk, is the ${right.title.toLowerCase()}`);
    return ["branch", asked];
  };
  const terms = (w, p, a) => {
    const C = creditRules(w.R), P = C.products[a.product];
    if (!P || a.product === "mortgage") fail("what kind of loan?");
    const [channel, banker] = w.lender(p, a.place, a.banker, a.product);
    let amount = Math.round(+a.amount), bill = null;
    if (a.bill) {
      bill = w.billing.bills.get(a.bill);
      if (!bill || bill.payer !== p.account || bill.status !== "open") fail("not an open bill of yours");
      if (!(P.pays_bill || []).includes(bill.kind)) fail(`a ${P.name.toLowerCase()} does not cover that bill`);
      amount = bill.owed;
    } else if (P.pays_bill) fail("which bill is it for?");
    if (!(amount > 0)) fail("how much?");
    const months = Math.round(+a.months) || P.months[Math.min(1, P.months.length - 1)];
    return { quote: assessLoan(w.R, w.creditFacts(p), { product: a.product, amount, months, channel, banker }), bill, banker, channel };
  };
  //: What a lender would say (nothing is taken out, and it does not count as an application).
  W.cmd_loan_quote = function (pid, args) { return { quote: terms(this, this.player(pid), args).quote }; };
  //: Taking the loan: the money in your wallet (or straight to the bill it is for), the first
  //: payment a month on.
  W.cmd_take_loan = function (pid, args) {
    const p = this.player(pid), c = book(p), { quote: q, bill } = terms(this, p, args);
    if (!q.approved) fail(q.reasons[0] || "declined");
    p.loans ||= [];
    if (p.loans.filter((l) => l.status === "open").length >= OPEN_MAX) fail(`${OPEN_MAX} loans open is the most: pay one off first`);
    this.ledger.mint(p.account, q.amount, "bank_loan", { at: this.now, memo: `${q.name}${q.banker ? `, ${q.banker}` : ", online"}` });
    if (bill) this.billing.pay(bill.id, p.account, this.now);
    const loan = { id: this.id("loan"), product: q.product, name: q.name, channel: q.channel, banker: q.banker, principal: q.amount, owed: q.amount, rate: q.rate, monthly: q.monthly,
      months: q.months, left: q.months, next: this.now + MONTH, opened: this.now, missed: 0, paid: 0, late: 0, status: "open", autopay: true, for: bill ? bill.memo : null, score: q.score };
    p.loans.push(loan);
    c.inquiries.push(this.now); c.inquiries = c.inquiries.slice(-12);
    c.first ??= this.now;
    this.log("loan", { player: pid, loan: loan.id, amount: q.amount, rate: q.rate, channel: q.channel });
    return { loan, quote: q, balance: this.ledger.balance(p.account) };
  };
  //: Paying a loan down early (all of it by default): less owed, fewer payments left.
  W.cmd_repay_loan = function (pid, { loan, amount = null }) {
    const p = this.player(pid), l = (p.loans || []).find((x) => x.id === loan && x.status === "open");
    if (!l) fail("not an open loan of yours");
    const a = Math.min(l.owed, amount === null ? l.owed : Math.round(+amount));
    if (!(a > 0)) fail("how much?");
    if (this.ledger.balance(p.account) < a) fail(`you have ${this.R.fmt(this.ledger.balance(p.account))}`);
    this.ledger.transfer(p.account, "business:bank", a, { kind: "loan", memo: `${l.name}: paid down`, at: this.now });
    l.owed -= a;
    this.settleLoan(p, l);
    return { loan: l, balance: this.ledger.balance(p.account) };
  };
  W.cmd_loan_autopay = function (pid, { loan, on = true }) {
    const l = (this.player(pid).loans || []).find((x) => x.id === loan && x.status === "open");
    if (!l) fail("not an open loan of yours");
    l.autopay = Boolean(on);
    return { loan: l };
  };
  //: A home loan agreed with a bank's home loans specialist before you buy: their rate holds for a fortnight.
  W.cmd_preapprove_mortgage = function (pid, { place, banker, price }) {
    const p = this.player(pid), c = book(p), C = creditRules(this.R);
    const [channel, who] = this.lender(p, place, banker, "mortgage");
    if (channel !== "branch") fail("a pre-approval is a banker's: go into a bank");
    const cost = Math.round(+price);
    if (!(cost > 0)) fail("for a home of what price?");
    const q = assessMortgage(this.R, this.creditFacts(p), cost, { channel, banker: who });
    if (!q.approved) fail(q.reasons[0]);
    c.preapproval = { rate: q.rate, loan: q.loan, price: cost, banker: who.name, bank: place.name || null, at: this.now, until: this.now + C.preapproval_days * DAY };
    c.inquiries.push(this.now); c.inquiries = c.inquiries.slice(-12);
    return { quote: q, preapproval: c.preapproval };
  };
  //: The mortgage a buyer gets on ``price`` now: the banker's pre-approval if it covers it, or the
  //: online rate. Throws when no lender will write it.
  W.mortgageFor = function (p, price) {
    const c = book(p), f = this.creditFacts(p);
    const pre = c.preapproval && c.preapproval.until > this.now ? c.preapproval : null;
    const q = assessMortgage(this.R, f, price, { channel: "online" });
    if (pre && q.loan <= pre.loan) {
      c.preapproval = null; c.first ??= this.now;
      return { ...q, approved: true, rate: pre.rate, monthly: loanPayment(q.loan, pre.rate, this.R.housing.mortgage.years), channel: "branch", banker: pre.banker };
    }
    if (!q.approved) fail(`no lender will write the mortgage: ${q.reasons[0]}`);
    c.inquiries.push(this.now); c.inquiries = c.inquiries.slice(-12);
    c.first ??= this.now;
    return q;
  };

  // ---- the months going by --------------------------------------------------------------------------
  const billsOf = (w, p, l) => w.billing.open(p.account).filter((b) => b.key?.startsWith(`loan:${l.id}:`));
  W.settleLoan = function (p, l) {
    if (l.status !== "open" || l.owed > 0 || billsOf(this, p, l).length) return;
    l.status = "paid"; l.closed = this.now; l.left = 0;
    this.log("loan_paid", { player: p.id, loan: l.id });
  };
  W.creditStep = function () {
    const C = creditRules(this.R), today = Math.floor(this.now / DAY);
    // Money in and out, a day at a time, from the journal (what the score and a banker call income).
    const from = this.creditSeq || 0;
    let last = from;
    for (let i = this.ledger.journal.length - 1; i >= 0; i -= 1) {
      const e = this.ledger.journal[i];
      if (e.seq <= from) break;
      last = Math.max(last, e.seq);
      for (const [account, v] of e.lines) {
        if (!account.startsWith("player:")) continue;
        const p = this.players.get(account.slice(7));
        if (!p) continue;
        const day = Math.floor((e.at || this.now) / DAY), cell = (book(p).flow[day] ||= [0, 0]);
        if (v > 0) { if (!NOT_INCOME.has(e.kind)) cell[0] += v; } else if (e.kind !== "owner_funds") cell[1] -= v;
      }
    }
    this.creditSeq = last;
    for (const p of this.players.values()) {
      const c = book(p);
      for (const d of Object.keys(c.flow)) if (today - d > FLOW_DAYS) delete c.flow[d];
      for (const l of p.loans || []) {
        if (l.status !== "open") continue;
        while (l.owed > 0 && this.now >= l.next) {
          const interest = Math.round(l.owed * l.rate / 12), pay = Math.min(l.monthly, l.owed + interest);
          l.owed = l.owed + interest - pay; l.left = Math.max(0, l.left - 1);
          this.billing.issue({ payer: p.account, payee: "business:bank", kind: "loan", amount: pay, memo: `${l.name} payment${l.banker ? "" : " (online)"}`, at: l.next, due_days: C.due_days,
            penalties: [Math.round(pay * C.late_fee_share)], key: `loan:${l.id}:${l.next}` });
          l.next += MONTH;
        }
        const open = billsOf(this, p, l);
        // Autopay: a payment is taken when it falls due, if the money is there.
        if (l.autopay) for (const b of open) if (b.status === "open" && this.ledger.balance(p.account) >= b.owed) this.billing.pay(b.id, p.account, this.now);
        const still = billsOf(this, p, l);
        l.missed = still.filter((b) => b.stage > 0).length;
        if (l.missed >= C.default_after_missed) {
          let owing = l.owed;
          for (const b of still) { owing += b.owed; this.billing.dismiss(b.id, this.now, "defaulted"); }
          l.status = "default"; l.closed = this.now; l.owed = 0;
          const bill = this.billing.issue({ payer: p.account, payee: "business:bank", kind: "loan_default", amount: owing, memo: `${l.name} in default: the balance, to collections`, at: this.now, due_days: 30, penalties: [] });
          bill.collections = true;
          c.marks.push({ t: this.now, kind: "default", what: l.name }); c.marks = c.marks.slice(-20);
          this.log("loan_default", { player: p.id, loan: l.id, owing });
        } else this.settleLoan(p, l);
      }
      // A defaulted balance is taken from the account as money comes into it.
      for (const b of this.billing.open(p.account)) if (b.kind === "loan_default" && this.ledger.balance(p.account) > 0) this.billing.pay(b.id, p.account, this.now);
      const closed = (p.loans || []).filter((l) => l.status !== "open");
      if (closed.length > CLOSED_KEPT) p.loans = p.loans.filter((l) => l.status === "open" || closed.indexOf(l) >= closed.length - CLOSED_KEPT);
    }
  };
  const wrap = (name, around) => { const fn = W[name]; W[name] = function (...args) { return around.call(this, (...a) => fn.apply(this, a.length ? a : args), ...args); }; };
  wrap("step", function (run) { const r = run(); this.creditStep(); return r; });
  // A foreclosure, a repossession: marks on the file, read by every lender for two years.
  wrap("log", function (run, kind, data) {
    const p = kind === "foreclosure" && data?.player ? this.players.get(data.player) : null;
    if (p) { const c = book(p); c.marks.push({ t: this.now, kind: "foreclosure", what: data.home }); }
    return run();
  });
  wrap("repossess", function (run, b) {
    const p = this.players.get(b.owner_pid);
    if (p && p.account === b.owner) book(p).marks.push({ t: this.now, kind: "repossession", what: b.name });
    return run();
  });
  const toJSON = W.toJSON;
  W.toJSON = function () { const o = toJSON.call(this); o.creditSeq = this.creditSeq || 0; return o; };
  const fromJSON = CityWorld.fromJSON;
  CityWorld.fromJSON = function (R, o) { const w = fromJSON.call(this, R, o); w.creditSeq = o.creditSeq || 0; return w; };
}
