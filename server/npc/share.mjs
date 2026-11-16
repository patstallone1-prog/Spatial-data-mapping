// What a character may know about the player they are talking to, by the part they play.
//
// Read from the server's own world (never from the page): a banker sees your credit file, a
// lawyer your cases, a boss your work record, a doctor your health; someone met in the street
// knows your name and nothing else. Amounts are written out (R.fmt), so the model is never left
// to convert units.

const DAY = 86_400_000;

export function playerShare(world, pid, role) {
  const p = world.players.get(pid);
  if (!p) return { name: "a newcomer", note: "not yet a resident of the city" };
  const R = world.R, fmt = R.fmt;
  const out = { name: p.name, days_in_the_city: Math.floor((world.now - (p.joined ?? world.now)) / DAY) };
  if (role === "banker") {
    const rep = world.creditReport(pid), f = rep.facts;
    out.credit_score = rep.score; out.credit_band = rep.band;
    out.score_factors = rep.factors.map((x) => `${x.label} (${Math.round(x.weight * 100)}% of the score, standing ${Math.round(x.value * 100)}/100): ${x.text}`);
    out.money = { free_cash: fmt(f.cash), owed_in_total: fmt(f.debt), monthly_payments_already: fmt(f.obligations), assets: fmt(f.assets),
      in_last_30_days: fmt(f.income_month), out_last_30_days: fmt(f.spend_month), in_last_90_days: fmt(f.income_90) };
    out.loans = rep.loans.map((l) => ({ name: l.name, status: l.status, owed: fmt(l.owed), monthly: fmt(l.monthly), payments_left: l.left, rate: `${(l.rate * 100).toFixed(2)}%`, taken: l.channel === "online" ? "online" : "in a branch" }));
    out.mortgages = rep.mortgages.map((m) => ({ owed: fmt(m.owed), monthly: fmt(m.monthly), rate: `${(m.rate * 100).toFixed(2)}%`, missed: m.missed }));
    out.open_bills = world.billing.open(p.account).slice(0, 8).map((b) => ({ kind: b.kind, owed: fmt(b.owed), overdue: b.stage > 0, memo: b.memo }));
    out.marks_on_file = rep.marks.map((m) => `${m.kind}: ${m.what}`);
    out.job = p.job ? { title: p.job.title, pay_per_hour: fmt(p.job.pay) } : null;
    out.businesses = [...(world.biz?.values() || [])].filter((b) => b.owner === p.account && b.status === "open").map((b) => ({ name: b.name, till: fmt(world.ledger.balance(b.account)) }));
    if (rep.preapproval) out.home_loan_preapproval = { rate: `${(rep.preapproval.rate * 100).toFixed(2)}%`, up_to: fmt(rep.preapproval.loan) };
  } else if (role === "lawyer") {
    out.cases = [...(world.cases?.values() || [])].filter((c) => c.pid === pid && !c.closed).map((c) => ({ charge: c.charge.replace(/_/g, " "), class: c.class, what: c.memo || null,
      evidence: c.evidence >= 0.85 ? "strong" : c.evidence >= 0.55 ? "a witness" : "thin", court_set: Boolean(c.court), has_lawyer: Boolean(c.lawyer) }));
    out.record = (p.record || []).map((l) => `${l.charge.replace(/_/g, " ")}: ${l.outcome}`);
    out.on_probation = Boolean(p.probation);
  } else if (role === "boss" || role === "interviewer") {
    out.job = p.job ? { title: p.job.title, pay_per_hour: fmt(p.job.pay), on_shift_now: Boolean(p.clocked) } : null;
    out.experience = Object.fromEntries(Object.entries(p.experience || {}).map(([r, n]) => [R.jobs.roles[r]?.title || r, `${n} tasks done`]));
    out.shifts = p.reliability ? { worked: p.reliability.shifts, on_time: p.reliability.on_time } : null;
    out.has_a_record = Boolean((p.record || []).length);
  } else if (role === "doctor") {
    const v = p.vitals || {};
    out.health = Object.fromEntries(["health", "stamina", "strength", "hunger", "thirst"].filter((k) => Number.isFinite(v[k])).map((k) => [k, Math.round(v[k])]));
    out.injuries = (p.injuries || []).map((i) => i.type || i.kind).filter(Boolean);
  } else if (role === "driver") {
    out.ride = p.ride ? { to: p.ride.to?.name || null } : null;
  }
  return out;
}
