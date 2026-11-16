// Borrowing (docs/city/credit.mjs): the score is read from the books and moves with how debts are
// paid and how much free cash there is; the right banker writes each kind of loan; in person is
// cheaper than online; a loan is paid monthly, and three missed payments default it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadRules } from "../docs/city/core.mjs";
import { assessLoan, assessMortgage, bankersAt, creditRules, creditScore } from "../docs/city/credit.mjs";
import { CityWorld, PLAYER_COMMANDS } from "../docs/city/world.mjs";

const R = loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json", import.meta.url))));
const m = R.money;
const DAY = 86_400_000, HOUR = 3_600_000;
const MON_6 = Date.UTC(2026, 10, 9, 14, 0);
const MARINA = { lon: -122.4368, lat: 37.8003, county: "county:san-francisco" };
const bank = { id: "w900", x: 0, z: 0, name: "Chestnut Street Bank", keys: ["use:retail", "shop:bank"], area: 200, ...MARINA };
const cafe = { id: "w901", x: 30, z: 0, name: "Corner Café", keys: ["use:retail", "shop:cafe"], ...MARINA };
const at = (pl) => ({ x: pl.x, z: pl.z, lon: pl.lon, lat: pl.lat, county: pl.county });
const desk = (spec) => bankersAt(R, bank).find((b) => b.specialty === spec);

function world() {
  const w = new CityWorld(R, { now: MON_6, seed: "credit-test" });
  w.submit("ana", "join", { name: "Ana", at: at(bank) });
  return w;
}
function runTo(w, t) { for (let x = w.now; x < t; x += 6 * HOUR) w.step(Math.min(t, x + 6 * HOUR)); w.step(t); }
//: A month's pay on the books, as a wage is (the score and a banker read the journal).
function earn(w, pid, amount) {
  w.ledger.mint("business:residents", amount, "npc_income", { at: w.now });
  w.ledger.transfer("business:residents", `player:${pid}`, amount, { kind: "wage", at: w.now });
  w.step(w.now);
}
const FACTS = { on_time: 0, late: 0, overdue: 0, collections: 0, defaults: 0, kinds: 0, cash: m(2000), debt: 0, obligations: 0, assets: 0, income_month: m(4000), days_here: 30, days_credit: 0, inquiries: 0 };

test("the loan commands are the world's; a bank is a store kind with a banker for each kind of lending", () => {
  for (const c of ["loan_quote", "take_loan", "repay_loan", "preapprove_mortgage"]) assert.ok(PLAYER_COMMANDS.includes(c), c);
  assert.equal(R.stores.kinds.bank.counter, "bank");
  const all = bankersAt(R, bank);
  assert.deepEqual(all.map((b) => b.specialty).sort(), ["business", "mortgage", "small"]);
  assert.deepEqual(desk("small").products.sort(), ["medical", "personal"]);
  assert.deepEqual(bankersAt(R, bank), all, "the same people each time");
  assert.equal(creditRules(R).products.personal.limit, m(25000));
});

test("the score runs 300 to 850 and follows payments, debt against free cash, history and applications", () => {
  const base = creditScore(R, FACTS).score;
  assert.ok(base > 600 && base < 720, `a newcomer is fair to good: ${base}`);
  const paid = creditScore(R, { ...FACTS, on_time: 12, kinds: 2, days_here: 200, days_credit: 200 }).score;
  const late = creditScore(R, { ...FACTS, on_time: 4, late: 4 }).score;
  const broke = creditScore(R, { ...FACTS, cash: m(20), debt: m(9000), obligations: m(900) }).score;
  const dflt = creditScore(R, { ...FACTS, defaults: 1, collections: 1 }).score;
  const keen = creditScore(R, { ...FACTS, inquiries: 4 }).score;
  assert.ok(paid > base + 60, `paying on time for a long while lifts it: ${paid}`);
  assert.ok(late < base - 40, `late payments cut it: ${late}`);
  assert.ok(broke < base - 80, `debt with no free cash cuts it: ${broke}`);
  assert.ok(dflt < late, `a default is worse than late payments: ${dflt}`);
  assert.ok(keen < base);
  for (const s of [paid, late, broke, dflt]) assert.ok(s >= 300 && s <= 850);
  const worst = creditScore(R, { ...FACTS, cash: 0, debt: m(1e6), defaults: 5, collections: 5, overdue: 9, inquiries: 9, days_here: 0 });
  assert.ok(worst.score >= 300 && worst.band === "poor");
  assert.equal(creditScore(R, FACTS).factors.reduce((s, f) => s + f.weight, 0).toFixed(2), "1.00");
});

test("a banker's rate follows the score, the amount and the term; online costs far more and lends less", () => {
  const ask = { product: "personal", amount: m(3000), months: 12 };
  const fair = assessLoan(R, FACTS, { ...ask, channel: "branch" });
  const good = assessLoan(R, { ...FACTS, on_time: 20, kinds: 3, days_here: 400, days_credit: 400, cash: m(20000) }, { ...ask, channel: "branch" });
  const online = assessLoan(R, FACTS, { ...ask, channel: "online" });
  assert.ok(fair.approved && good.approved && online.approved);
  assert.ok(good.rate < fair.rate, `${good.rate} < ${fair.rate}`);
  assert.ok(online.rate >= fair.rate + 0.08, `online ${online.rate} against ${fair.rate} in person`);
  assert.ok(online.max < fair.max);
  assert.ok(assessLoan(R, FACTS, { ...ask, months: 36, channel: "branch" }).rate > fair.rate, "a longer term costs more");
  assert.equal(fair.total, fair.monthly * 12);
  assert.ok(good.reasons.some((r) => /Credit score/.test(r)) && online.reasons.some((r) => /Online/.test(r)), JSON.stringify([good.reasons, online.reasons]));
  // Too much for the income; too weak a file in a branch, but the online lender still writes a small one.
  assert.equal(assessLoan(R, FACTS, { ...ask, amount: m(24500), channel: "branch" }).approved, false);
  const weak = { ...FACTS, on_time: 2, late: 6, overdue: 2, cash: m(300), debt: m(2500) };
  assert.equal(assessLoan(R, weak, { ...ask, amount: m(500), channel: "branch" }).approved, false);
  const payday = assessLoan(R, weak, { ...ask, amount: m(500), channel: "online" });
  assert.ok(payday.approved && payday.rate > 0.25 && payday.rate <= 0.36, `${payday.rate}`);
  assert.equal(assessLoan(R, FACTS, { product: "business", amount: m(5000), months: 24, channel: "online" }).approved, false, "business loans are a branch's");
  const home = assessMortgage(R, FACTS, m(900000), { channel: "online" }), inPerson = assessMortgage(R, FACTS, m(900000), { channel: "branch", banker: desk("mortgage") });
  assert.ok(home.approved && inPerson.approved && inPerson.rate < home.rate);
});

test("you ask the banker whose desk it is, in the bank; the server's figures, not the caller's, make the loan", () => {
  const w = world();
  earn(w, "ana", m(4200));
  const small = desk("small"), homes = desk("mortgage");
  const wrong = w.submit("ana", "loan_quote", { product: "personal", amount: m(2000), months: 12, place: bank, banker: homes.id, at: at(bank) });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, new RegExp(small.name));
  const far = w.submit("ana", "loan_quote", { product: "personal", amount: m(2000), months: 12, place: bank, banker: small.id, at: { ...at(bank), x: 900 } });
  assert.match(far.error, /walk into the bank/);
  assert.match(w.submit("ana", "loan_quote", { product: "personal", amount: m(2000), months: 12, place: cafe, banker: small.id, at: at(cafe) }).error, /not a bank/);
  const q = w.submit("ana", "loan_quote", { product: "personal", amount: m(2000), months: 12, place: bank, banker: small.id, at: at(bank) });
  assert.equal(q.ok, true, q.error);
  assert.equal(q.quote.channel, "branch");
  const before = w.ledger.balance("player:ana");
  // A rate or a payment sent by the caller is not read.
  const r = w.submit("ana", "take_loan", { product: "personal", amount: m(2000), months: 12, place: bank, banker: small.id, rate: 0.0001, monthly: 1, at: at(bank) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.loan.rate, q.quote.rate);
  assert.equal(r.loan.monthly, q.quote.monthly);
  assert.equal(w.ledger.balance("player:ana"), before + m(2000));
  const online = w.submit("ana", "loan_quote", { product: "personal", amount: m(1000), months: 12 });
  assert.ok(online.quote.rate > q.quote.rate + 0.05);
  w.ledger.check();
});

test("a loan is billed monthly and paid from the account; paid on time it lifts the score, and it can be cleared early", () => {
  const w = world();
  earn(w, "ana", m(4200));
  const r = w.submit("ana", "take_loan", { product: "personal", amount: m(1200), months: 3, place: bank, banker: desk("small").id, at: at(bank) });
  assert.equal(r.ok, true, r.error);
  const start = w.creditReport("ana").score;
  runTo(w, w.now + 31 * DAY);
  let l = w.players.get("ana").loans[0];
  assert.equal(l.left, 2);
  assert.ok(l.owed < m(1200) && l.owed > m(700));
  assert.equal(w.billing.open("player:ana").filter((b) => b.kind === "loan").length, 0, "autopay took it");
  const rep = w.creditReport("ana");
  assert.ok(rep.facts.on_time >= 1);
  const early = w.submit("ana", "repay_loan", { loan: l.id });
  assert.equal(early.ok, true, early.error);
  l = w.players.get("ana").loans[0];
  assert.equal(l.status, "paid");
  assert.ok(w.creditReport("ana").score >= start, "paid as agreed");
  runTo(w, w.now + 40 * DAY);
  assert.equal(w.billing.open("player:ana").filter((b) => b.kind === "loan").length, 0, "nothing billed once it is paid");
  w.ledger.check();
});

test("three missed payments default the loan to collections, mark the file, and close the branch's door", () => {
  const w = world();
  earn(w, "ana", m(4200));
  const r = w.submit("ana", "take_loan", { product: "personal", amount: m(3000), months: 12, place: bank, banker: desk("small").id, at: at(bank) });
  assert.equal(r.ok, true, r.error);
  const before = w.creditReport("ana").score;
  // The money is spent: nothing to pay with.
  w.ledger.burn("player:ana", w.ledger.balance("player:ana"), "system_fee", { at: w.now });
  runTo(w, w.now + 125 * DAY);
  const l = w.players.get("ana").loans[0];
  assert.equal(l.status, "default", JSON.stringify([l, [...w.billing.bills.values()].map((b) => [b.kind, b.status, b.stage, b.owed]), w.ledger.balance("player:ana")]));
  const rep = w.creditReport("ana");
  assert.ok(rep.score < before - 120, `${before} -> ${rep.score}`);
  assert.equal(rep.marks[0].kind, "default");
  assert.ok(w.billing.open("player:ana").some((b) => b.kind === "loan_default"));
  earn(w, "ana", m(900));
  const again = w.submit("ana", "take_loan", { product: "personal", amount: m(500), months: 6, place: bank, banker: desk("small").id, at: at(bank) });
  assert.equal(again.ok, false);
  // What comes in goes to the defaulted balance first.
  assert.equal(w.ledger.balance("player:ana"), 0);
  w.ledger.check();
});

test("a medical bill is paid by a plan from the small loans desk: the money goes to the hospital, not the wallet", () => {
  const w = world();
  earn(w, "ana", m(4200));
  const bill = w.billing.issue({ payer: "player:ana", payee: "business:hospital", kind: "medical", amount: m(1800), memo: "Ambulance and care", at: w.now, due_days: 30 });
  const cash = w.ledger.balance("player:ana"), hospital = w.ledger.balance("business:hospital");
  const wrong = w.submit("ana", "take_loan", { product: "medical", bill: bill.id, months: 12, place: bank, banker: desk("business").id, at: at(bank) });
  assert.equal(wrong.ok, false);
  const r = w.submit("ana", "take_loan", { product: "medical", bill: bill.id, months: 12, amount: m(999999), place: bank, banker: desk("small").id, at: at(bank) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.loan.principal, m(1800), "the bill's amount, whatever was asked");
  assert.equal(w.billing.bills.get(bill.id).status, "paid");
  assert.equal(w.ledger.balance("player:ana"), cash);
  assert.equal(w.ledger.balance("business:hospital"), hospital + m(1800));
  assert.ok(r.loan.rate < w.submit("ana", "loan_quote", { product: "personal", amount: m(1800), months: 12, place: bank, banker: desk("small").id, at: at(bank) }).quote.rate);
});

test("a home loan pre-approved by the home loans specialist is cheaper than the online one, and the mortgage keeps its own rate", () => {
  const w = world();
  w.ledger.mint("player:ana", m(400000), "account_grant", { at: w.now });
  earn(w, "ana", m(9000));
  const online = assessMortgage(R, w.creditFacts(w.players.get("ana")), m(800000), { channel: "online" });
  const pre = w.submit("ana", "preapprove_mortgage", { place: bank, banker: desk("mortgage").id, price: m(800000), at: at(bank) });
  assert.equal(pre.ok, true, pre.error);
  assert.ok(pre.preapproval.rate < online.rate);
  const p = w.players.get("ana");
  const terms = w.mortgageFor(p, m(750000));
  assert.equal(terms.rate, pre.preapproval.rate);
  assert.equal(p.credit.preapproval, null, "used once");
  assert.equal(w.mortgageFor(p, m(750000)).channel, "online");
});

test("the loans and the score survive saving, and another player sees none of it", async () => {
  const w = world();
  w.submit("ben", "join", { name: "Ben", at: at(bank) });
  earn(w, "ana", m(4200));
  w.submit("ana", "take_loan", { product: "personal", amount: m(1000), months: 6, place: bank, banker: desk("small").id, at: at(bank) });
  const again = CityWorld.fromJSON(R, JSON.parse(JSON.stringify(w.toJSON())));
  assert.deepEqual(again.creditReport("ana").score, w.creditReport("ana").score);
  assert.equal(again.players.get("ana").loans.length, 1);
  const { viewFor } = await import("../server/city/views.mjs");
  const seen = viewFor(w, "ben").players.find((x) => x.id === "ana");
  assert.equal(seen.loans, undefined);
  assert.equal(seen.credit, undefined);
});
