// The panels for businesses, the law and careers (docs/city/enterprise.mjs): your business's
// overview, stock and prices, staff, hours and books; buying an NPC's shop; a law office's
// lawyers; a recruiter's offers; your cases and record; and the story of a time inside. Kept out
// of view.mjs, which calls these through a few hooks (draw, storeExtra, todo, actions, online).

import { cityTime, storesAt } from "./core.mjs";
import { goingRate, itemsFor, leastWage, rolesFor, unitCost } from "./enterprise.mjs";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function enterprisePanels(api) {
  const { R, h, act, notify, send, self, me, getView, ctx, district, address, placeArg, openSide, drawSide, getSide, todoReset } = api;
  const B = R.business;
  const when = (ms) => { const t = cityTime(ms, R.clock.zone); return `${WEEKDAYS[t.weekday]} ${t.month}/${t.date} ${t.label.slice(4)}`; };
  const date = (ms) => { const t = cityTime(ms, R.clock.zone); return `${t.month}/${t.date}/${t.year}`; };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const hour = (x) => `${String(x % 24).padStart(2, "0")}:00`;
  const shiftsText = (sh) => (sh || []).map((s) => `${s.days.length === 7 ? "daily" : s.days.map((d) => WEEKDAYS[d]).join(" ")} ${hour(s.from)}–${hour(s.to)}`).join("; ");
  const done = (text) => (r) => { notify(r.ok ? (typeof text === "function" ? text(r) : text) : r.error); todoReset(); drawSide(); return r; };
  const run = (cmd, args, text) => send(cmd, args).then(done(text));
  const num = (value, props = {}) => h("input", { type: "number", value: String(value), style: "width:5.5em", ...props });
  let seenBiz = -1, releasedShown = null, notified = new Set();

  // ---- places: the map's tenants told to the world, and players' businesses on the map ----------
  //: Every name the district's buildings carry, so no business or lawyer is given a real one; and
  //: each player's business on its place as a shop of its kind.
  function syncPlaces(force = false) {
    const w = getView();
    if (!w?.biz) return;
    if (w.knowTenants && district.allBuildings) {
      const names = [];
      for (const b of district.allBuildings.values()) { for (const s of b.shops || []) if (s.n) names.push(s.n); }
      if (names.length !== w._knownCount) { w.knowTenants(names); w._knownCount = names.length; }
    }
    const open = [...w.biz.values()].filter((b) => b.status === "open");
    const sig = open.map((b) => `${b.id}:${b.kind}`).join("|");
    if (!force && sig === seenBiz) return;
    seenBiz = sig;
    for (const pl of district.places || []) {
      const b = open.find((x) => x.place.id === String(pl.id));
      if (b) { pl.keys.add(`shop:${b.kind}`); pl.business = b.id; pl.name ||= b.name; }
      else if (pl.business) { delete pl.business; }
    }
  }
  //: Where hearings are held: the civic building nearest the real courthouse.
  function courtPlace() {
    const c = B.law.courthouse, [x, z] = ctx.fromLonLat(c.lon, c.lat);
    let best = null, bd = Infinity;
    for (const pl of district.places || []) {
      if (!pl.keys.has("use:civic") || /church|temple|synagogue|mosque|chapel|cathedral|saint|\bst\.? /i.test(pl.name || "")) continue;
      const d = Math.hypot(pl.x - x, pl.z - z);
      if (d < bd) { bd = d; best = pl; }
    }
    return best ? placeArg(best) : { x, z, name: `${c.name}, ${c.address}`, keys: [], real: true };
  }
  const myBusinesses = (w, p) => [...(w.biz?.values() || [])].filter((b) => b.owner === p.account && b.status === "open");
  const myCases = (w, p) => [...(w.cases?.values() || [])].filter((c) => c.pid === p.id && !c.closed);
  const distanceTo = (pl) => Math.hypot(me().x - pl.x, me().z - pl.z);
  const nearestOf = (key) => {
    let best = null, bd = Infinity;
    for (const pl of district.places || []) { if (!pl.keys.has(key)) continue; const d = distanceTo(pl); if (d < bd) { bd = d; best = pl; } }
    return best;
  };

  // ---- the to-do list -----------------------------------------------------------------------------
  function todo(p) {
    syncPlaces();
    const w = getView(), out = [];
    if (!w?.biz || !p) return out;
    if (p.released && releasedShown !== p.released.at) { releasedShown = p.released.at; setTimeout(() => openSide("released"), 0); }
    if (p.promoted && !notified.has(`promo:${p.promoted.at}`)) { notified.add(`promo:${p.promoted.at}`); notify(`Promoted: ${p.promoted.title}, ${R.fmt(p.promoted.pay)} an hour.`); }
    if (p.let_go && !notified.has(`go:${p.let_go.at}`)) { notified.add(`go:${p.let_go.at}`); notify(`${p.let_go.business}: you were let go (${p.let_go.why}).`); }
    // The shift coming up.
    if (p.job && !p.clocked && w.shiftNear) {
      const sh = w.shiftNear(p.job, w.now), lead = B.careers.remind_minutes * 60_000;
      if (sh && sh.start - w.now <= lead && sh.start - w.now > -B.careers.late_grace_minutes * 60_000) {
        out.unshift({ label: `Your shift starts ${hour(cityTime(sh.start, R.clock.zone).hour)}: go to work`, sub: `${p.job.title} at ${address(p.job.place.name) || "your workplace"}`, x: p.job.place.x, z: p.job.place.z, now: true });
      }
    }
    // Court.
    const court = courtPlace();
    for (const c of myCases(w, p)) {
      if (c.court) {
        const due = w.now >= c.court + B.law.attend_hours[0] * 3_600_000;
        out.push({ label: `${c.summons ? "Summons" : "Court"}: ${c.charge.replace(/_/g, " ")} ${due ? "— now" : when(c.court)}`, sub: `${court.name || "the court"}${c.lawyer ? ` · with ${c.lawyer.name}` : " · no lawyer"}`, x: court.x, z: court.z, now: due,
          run: () => (due ? attend(c) : openCases()) });
      } else out.push({ label: `A case: ${c.charge.replace(/_/g, " ")}`, sub: "Pay, contest, or take it to a lawyer", run: openCases });
    }
    for (const o of p.job_offers || []) out.push({ label: `A recruiter has a job for you: ${o.title} at ${address(o.place.name) || "a workplace"}, ${R.fmt(o.pay)}/h`, sub: `Until ${when(o.expires)} · fee ${R.fmt(o.fee)} from your pay`, run: () => openRecruiter() });
    for (const o of p.employment_offers || []) out.push({ label: `${o.name} offers you a job: ${o.title}, ${R.fmt(o.pay)}/h`, sub: shiftsText(o.shifts), run: () => openRecruiter() });
    for (const b of myBusinesses(w, p)) {
      if (b.week && w.now - b.week.at < DAY) out.push({ label: `${b.name}: last week ${b.week.profit >= 0 ? "made" : "lost"} ${R.fmt(Math.abs(b.week.profit))}`, sub: `${R.fmt(b.week.sales)} sales · ${b.week.served} served, ${b.week.lost} turned away`, run: () => openBusiness(b.id, "books") });
      const out0 = itemsFor(R, b.kind).filter((id) => !(b.stock[id] > 0)).length;
      if (out0 && !b.incoming.length) out.push({ label: `${b.name}: ${out0} item${out0 > 1 ? "s" : ""} out of stock`, sub: "Order from the wholesaler", run: () => openBusiness(b.id, "stock") });
      if (!b.staff.length) out.push({ label: `${b.name}: no staff`, sub: "Hire people to serve", run: () => openBusiness(b.id, "staff") });
    }
    return out;
  }

  // ---- the action bar -------------------------------------------------------------------------------
  function actions(p, here) {
    const w = getView(), out = [];
    if (!w?.biz) return out;
    const reach = (R.stores.door_reach_m ?? 3.5) * 2.5;
    for (const pl of district.places || []) {
      if (Math.hypot(here.x - pl.x, here.z - pl.z) > Math.max(reach, 14)) continue;
      const b = w.bizAt?.(pl.id);
      if (b && b.owner === p.account) { out.push({ id: `biz:${b.id}`, label: `Manage ${b.name}`, key: "", run: () => openBusiness(b.id) }); break; }
      const keys = [...pl.keys];
      const vacant = !keys.some((k) => k.startsWith("shop:")) && keys.some((k) => ["use:retail", "use:restaurant", "use:office"].includes(k));
      if (vacant && !w.storefronts?.has(String(pl.id))) { out.push({ id: `lease:${pl.id}`, label: `Lease this storefront ${R.fmt(B.storefront_lease_per_week)}/wk`, key: "", run: () => lease(pl) }); break; }
      const s = w.storefronts?.get(String(pl.id));
      if (s && s.holder === p.account && !b) { out.push({ id: `reg:${pl.id}`, label: "Open a business here", key: "", run: () => { openSide("online"); getSide().cat = "business"; getSide().register = pl.id; drawSide(); } }); break; }
    }
    const court = courtPlace();
    for (const c of myCases(w, p)) if (c.court && w.now >= c.court + B.law.attend_hours[0] * 3_600_000 && Math.hypot(here.x - court.x, here.z - court.z) < B.law.courthouse.reach_m) out.push({ id: `court:${c.id}`, label: `Attend your hearing: ${c.charge.replace(/_/g, " ")}`, key: "", run: () => attend(c) });
    return out;
  }
  function lease(pl) {
    send("lease_storefront", { place: placeArg(pl) }).then((r) => {
      notify(r.ok ? `Leased: ${address(pl.name) || "the storefront"}, ${R.fmt(B.storefront_lease_per_week)} a week (a week ahead and a week's deposit paid). Register your business next.` : r.error);
      if (r.ok) { openSide("online"); getSide().cat = "business"; getSide().register = pl.id; drawSide(); }
    });
  }
  function attend(c) {
    send("attend_court", { case: c.id, court: courtPlace() }).then((r) => {
      if (!r.ok) { notify(r.error); return; }
      notify(`The verdict: ${r.verdict.name}.`);
      todoReset();
      if (r.released) openSide("released"); else openCases();
    });
  }
  const openCases = () => { openSide("online"); getSide().cat = "law"; drawSide(); };
  const openBusiness = (id, tab = "overview") => { openSide("business"); const s = getSide(); s.biz = id; s.tab = tab; drawSide(); };
  const openRecruiter = () => { openSide("recruiter"); };

  // ---- the shop panel's extras: buying the business, managing yours ---------------------------------
  function storeExtra(place) {
    const w = getView(), p = self();
    if (!w?.biz || !p) return [];
    const b = w.bizAt?.(place.id);
    if (b) return b.owner === p.account ? [h("h4", { textContent: "Your business" }), act(`Manage ${b.name}`, () => openBusiness(b.id), true)]
      : [h("p", { className: "note", textContent: `${b.name} is a player's business: its prices are its owner's.` })];
    return [h("h4", { textContent: "The business" }), h("p", { className: "note", textContent: "Every shop here has an owner, who would sell at the right price: its books (modelled) first." }),
      act("Look at buying it", () => { openSide("buy", place); })];
  }

  // ---- the panels -------------------------------------------------------------------------------------
  //: Draws ``side`` if it is one of these panels; true if it was.
  function draw(side, { close, status, w, p }) {
    if (side.kind === "store" && side.place?.keys) {
      // A law office or an agency is its own panel; a building with other shops too keeps their tabs.
      const stores = storesAt(R, side.place.keys), cur = stores[Math.min(side.store || 0, stores.length - 1)];
      const tabs = stores.length > 1 ? h("div", { className: "tabs" }, ...stores.map((s2, i) => h("button", { textContent: s2.name, "aria-pressed": String(s2 === cur), onclick: () => { side.store = i; drawSide(); } }))) : "";
      if (cur?.kind === "law_office") { drawLaw(side, close, status, w, p, tabs); return true; }
      if (cur?.kind === "staffing") { drawRecruiter(side, close, status, w, p, side.place, tabs); return true; }
    }
    if (side.kind === "business") { drawBusiness(side, close, w, p); return true; }
    if (side.kind === "buy") { drawBuy(side, close, status, w, p); return true; }
    if (side.kind === "recruiter") { drawRecruiter(side, close, status, w, p, null); return true; }
    if (side.kind === "released") { drawReleased(side, close, p); return true; }
    return false;
  }

  function drawBusiness(side, close, w, p) {
    side.el.classList.add("wide");
    const b = w.biz?.get(side.biz);
    if (!b || b.owner !== p.account || b.status !== "open") { side.el.replaceChildren(h("h3", {}, h("span", { textContent: "Business" }), close), h("p", { className: "note", textContent: "That business is no longer yours." })); return; }
    side.tab ||= "overview";
    const bal = w.ledger.balance(b.account);
    const stars = "★".repeat(Math.round(b.reputation / 20)) + "☆".repeat(5 - Math.round(b.reputation / 20));
    const title = h("h3", {}, h("span", { textContent: `${b.name} — ${R.stores.kinds[b.kind].name}` }), close);
    const tabs = h("div", { className: "tabs" }, ...[["overview", "Overview"], ["stock", "Stock & prices"], ["staff", "Staff"], ["hours", "Hours & duties"], ["books", "Books"]]
      .map(([k, label]) => h("button", { textContent: label, "aria-pressed": String(side.tab === k), onclick: () => { side.tab = k; drawSide(); } })));
    const head = h("p", { className: "note", textContent: `${stars} (${Math.round(b.reputation)}) · till ${R.fmt(bal)} · open ${hour(b.hours[0])}–${hour(b.hours[1])} · ${b.staff.length} staff` });
    const out = [title, head, tabs];
    const id = b.id;
    if (side.tab === "overview") {
      const d = b.today;
      out.push(h("h4", { textContent: "Today so far" }),
        h("table", {}, ...[["Customers", `${Math.round(d.served)} served, ${Math.round(d.lost)} turned away`], ["Sales", R.fmt(d.sales + (d.player_sales || 0))], ["Cost of goods", R.fmt(d.cogs)],
          ["Wages due", R.fmt(Object.values(d.wages).reduce((s, x) => s + x, 0))], ["Out of stock", d.stockout ? `${d.stockout} sales missed` : "nothing"]].map(([a, v]) => h("tr", {}, h("td", { textContent: a }), h("td", { textContent: v })))));
      if (b.week) out.push(h("h4", { textContent: "Last week" }), h("p", { className: "note", textContent: `Sales ${R.fmt(b.week.sales)}, goods ${R.fmt(b.week.cogs)}, wages ${R.fmt(b.week.wages)}, rent ${R.fmt(b.week.rent)}, fees ${R.fmt(b.week.fees)}: ${b.week.profit >= 0 ? "profit" : "loss"} ${R.fmt(Math.abs(b.week.profit))}.` }));
      if (b.loan) out.push(h("p", { className: "note", textContent: `Owed to the seller: ${b.loan.left} monthly payments of ${R.fmt(b.loan.monthly)} (next ${when(b.loan.next_due)}). Two missed and the business goes back to them.` }));
      out.push(h("p", { className: "note", textContent: `Licences: ${Object.entries(b.licences).map(([k, until]) => `${B.licences[k]?.name || k} to ${date(until)}`).join("; ")}.` }));
      const amt = num(500, { min: 1 });
      out.push(h("h4", { textContent: "Money" }), h("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap" }, amt,
        act("Put in from your wallet", () => run("fund_business", { business: id, amount: R.money(+amt.value) }, (r) => `The till has ${R.fmt(r.balance)}.`)),
        act("Take out to your wallet", () => run("withdraw_business", { business: id, amount: R.money(+amt.value) }, (r) => `The till has ${R.fmt(r.balance)}.`))),
        h("h4", { textContent: "Closing" }), act("Close the business (staff paid off, the till to you)", () => { if (globalThis.confirm?.(`Close ${b.name}?`) === false) return null; return run("close_business", { business: id }, (r) => `Closed. ${R.fmt(r.returned)} came back to you.`); }));
    }
    if (side.tab === "stock") {
      side.order ||= {}; side.prices ||= {};
      const rows = itemsFor(R, b.kind).map((it) => {
        const spec = R.items[it], f = side.prices[it] ?? b.prices[it] ?? 1;
        const fIn = num(f, { step: "0.05", min: String(B.price_factor[0]), max: String(B.price_factor[1]), onchange: (e) => { side.prices[it] = +e.target.value; } });
        const qIn = num(side.order[it] || 0, { min: "0", step: "10", onchange: (e) => { side.order[it] = +e.target.value; } });
        return h("tr", {}, h("td", {}, h("b", { textContent: spec.name }), h("div", { className: "note", textContent: `in stock ${b.stock[it] || 0} · costs ${R.fmt(unitCost(R, it))} · list ${R.fmt(spec.price)} · yours ${R.fmt(Math.round(spec.price * f))}` })),
          h("td", {}, h("small", { textContent: "× list " }), fIn), h("td", {}, h("small", { textContent: "order " }), qIn));
      });
      const cost = Object.entries(side.order).reduce((s, [it, n]) => s + unitCost(R, it) * (n || 0), 0);
      out.push(h("p", { className: "note", textContent: `The price is a share of the list price, ${B.price_factor[0]}× to ${B.price_factor[1]}×: dearer earns more on each sale and sells fewer (groceries most of all). Orders are paid from the till and come the next morning at ${hour(B.delivery_hour)}.` }),
        h("table", { className: "wares" }, ...rows),
        b.incoming.length ? h("p", { className: "note", textContent: `On the way: ${b.incoming.map((x) => `${Object.values(x.items).reduce((s, n) => s + n, 0)} items ${when(x.at)}`).join("; ")}.` }) : "",
        h("div", { style: "display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap" },
          act("Save prices", () => run("set_prices", { business: id, prices: side.prices }, "Prices set.")),
          act(`Order (${R.fmt(cost)})`, () => { const items = Object.fromEntries(Object.entries(side.order).filter(([, n]) => n > 0)); side.order = {}; return run("order_stock", { business: id, items }, (r) => `Ordered: ${R.fmt(r.cost)}, here ${when(r.arrives)}.`); }, true)));
    }
    if (side.tab === "staff") {
      const inShop = Math.hypot(me().x - b.place.x, me().z - b.place.z) < R.stores.reach_m * 4;
      const staffRows = b.staff.map((s) => {
        const going = R.jobs.roles[s.role] ? goingRate(R, s.role) : s.wage;
        const orders = !s.player && inShop ? h("span", {}, ...["serve", "restock", "clean", "break", "go_home"].map((o) => h("button", { textContent: o.replace("_", " "), onclick: () => run("order_staff", { business: id, staff: s.id, order: o }, `${s.name.split(" ")[0]}: ${o.replace("_", " ")}.`) }))) : "";
        const from = num(s.shifts[0]?.from ?? b.hours[0], { min: "0", max: "23", style: "width:3.4em" }), to = num(s.shifts[0]?.to ?? b.hours[1], { min: "1", max: "30", style: "width:3.4em" });
        return h("tr", {}, h("td", {}, h("b", { textContent: `${s.name}${s.player ? " (player)" : ""}` }),
          h("div", { className: "note", textContent: `${s.title || s.role} · ${R.fmt(s.wage)}/h (going rate ${R.fmt(going)}) · ${s.player ? "" : `skill ${pct(s.skill ?? 0.5)} · morale ${Math.round(s.morale ?? 50)}${s.morale < B.staff.late_below ? " (late)" : ""}${s.notice ? ` · leaving ${when(s.notice)}` : ""} · `}${shiftsText(s.shifts)}` }), orders),
          h("td", {}, from, "–", to, act("Shift", () => run("schedule", { business: id, staff: s.id, shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], from: +from.value, to: +to.value }] }, "Rescheduled."))),
          h("td", {}, s.player ? "" : act("+5%", () => run("set_wage", { business: id, staff: s.id, wage: Math.round(s.wage * 1.05) }, "A raise: morale up.")), act("Let go", () => run("fire", { business: id, staff: s.id }, `${s.name} let go: paid what was owed.`))));
      });
      const cands = w.candidatesFor ? w.candidatesFor(b) : [];
      const candRows = cands.map((c) => h("tr", {}, h("td", {}, h("b", { textContent: c.name }), h("div", { className: "note", textContent: `${c.title} · skill ${pct(c.skill)} · reliability ${pct(c.reliability)} · ${c.km} km away${c.headhunted ? " · via a headhunter (15% of a month's wage)" : ""}` })),
        h("td", { textContent: `asks ${R.fmt(c.ask)}/h` }), h("td", {}, act("Hire", () => run("hire", { business: id, candidate: c.id }, (r) => `${c.name} hired at ${R.fmt(c.ask)} an hour, ${shiftsText(r.staff.shifts)}.`), true))));
      const others = [...w.players.values()].filter((q) => q.id !== p.id);
      const role = h("select", {}, ...rolesFor(R, b.kind).map((r) => h("option", { value: r, textContent: R.jobs.roles[r].title })));
      const wage = num(Math.round(goingRate(R, rolesFor(R, b.kind)[0]) / R.money(1)), { min: String(leastWage(R) / R.money(1)) });
      out.push(h("h4", { textContent: "Your staff" }), staffRows.length ? h("table", { className: "wares" }, ...staffRows) : h("p", { className: "note", textContent: "No one yet: without staff no one is served." }),
        !inShop && b.staff.length ? h("p", { className: "note", textContent: "Stand in the shop to give your staff orders." }) : "",
        h("h4", { textContent: "People looking for work" }), h("table", { className: "wares" }, ...candRows),
        act("Use a headhunter for better people", () => run("headhunt_staff", { business: id }, "A headhunter's candidates: better, for a fee when hired.")),
        h("h4", { textContent: "Hire a player, or post an opening" }),
        h("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap" }, role, h("small", { textContent: "₡/h" }), wage,
          ...others.map((q) => act(`Offer ${q.name}`, () => run("hire", { business: id, player: q.id, role: role.value, wage: R.money(+wage.value) }, `Offered to ${q.name}.`))),
          act("Post on the Jobs tab", () => run("post_opening", { business: id, role: role.value, wage: R.money(+wage.value) }, "Posted: it shows on the Jobs tab and to recruiters."))));
    }
    if (side.tab === "hours") {
      const o = num(b.hours[0], { min: "0", max: "23", style: "width:3.4em" }), c = num(b.hours[1], { min: "1", max: "30", style: "width:3.4em" });
      side.duties ||= [...b.duties];
      const move = (i, d) => { const a = side.duties; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; drawSide(); };
      const names = { serve: "Serve the counter", restock: "Restock the shelves", clean: "Clean", deliver: "Make deliveries", open_close: "Open and close" };
      out.push(h("h4", { textContent: "Hours" }), h("div", {}, "Open ", o, " close ", c, " ", act("Set", () => run("set_hours", { business: id, open: +o.value, close: +c.value }, "Hours set."))),
        h("p", { className: "note", textContent: "Close past midnight as 25, 26… Customers come only while open; staff are paid for their shifts." }),
        h("h4", { textContent: "Duties, most important first" }),
        h("ol", {}, ...side.duties.map((d, i) => h("li", {}, `${names[d]} `, h("button", { textContent: "↑", onclick: () => move(i, -1) }), h("button", { textContent: "↓", onclick: () => move(i, 1) })))),
        act("Save the order", () => run("set_duties", { business: id, duties: side.duties }, "Your staff will work in that order."), true));
    }
    if (side.tab === "books") {
      const rows = b.books.slice(-14).reverse().map((d) => h("tr", {}, h("td", { textContent: when(d.day * DAY + 12 * 3_600_000).split(" ").slice(0, 2).join(" ") }),
        h("td", { textContent: R.fmt(d.sales) }), h("td", { textContent: R.fmt(d.cogs) }), h("td", { textContent: R.fmt(d.wages) }), h("td", { textContent: R.fmt(d.rent + d.fees) }),
        h("td", { textContent: R.fmt(d.profit), style: d.profit < 0 ? "color:#e2483d" : "" }), h("td", { textContent: `${d.served}/${d.served + d.lost}` })));
      out.push(h("table", { className: "wares" }, h("tr", {}, ...["Day", "Sales", "Goods", "Wages", "Rent, fees", "Profit", "Served"].map((x) => h("th", { textContent: x }))), ...rows),
        rows.length ? "" : h("p", { className: "note", textContent: "The first day's books close at midnight." }));
    }
    side.el.replaceChildren(...out);
  }

  function drawBuy(side, close, status, w) {
    side.el.classList.add("wide");
    const place = placeArg(side.place);
    let a = side.appraisal;
    if (!a) {
      try { a = side.appraisal = w.appraiseBusiness(place, rivalsOf(side.place)); } catch (e) { side.el.replaceChildren(h("h3", {}, h("span", { textContent: "Buying the business" }), close), h("p", { className: "note", textContent: e.message })); return; }
    }
    const title = h("h3", {}, h("span", { textContent: `Buying ${address(side.place.name) || "the business"}` }), close);
    const rows = a.books.map((x) => h("tr", {}, h("td", { textContent: `Week ${x.week}` }), h("td", { textContent: R.fmt(x.sales) }), h("td", { textContent: R.fmt(x.cogs) }), h("td", { textContent: R.fmt(x.wages) }), h("td", { textContent: R.fmt(x.rent) }), h("td", { textContent: R.fmt(x.profit) })));
    side.el.replaceChildren(title, status, h("p", { className: "note", textContent: `A ${R.stores.kinds[a.kind].name.toLowerCase()}. Its last ${a.books.length} weeks (modelled from its customers, prices and staff):` }),
      h("table", { className: "wares" }, h("tr", {}, ...["", "Sales", "Goods", "Wages", "Rent", "Profit"].map((x) => h("th", { textContent: x }))), ...rows),
      h("table", {}, ...[["A year's profit", R.fmt(a.year_profit)], ["Stock at cost", R.fmt(a.stock_cost)], ["Asking", R.fmt(a.asking)], ["Seller financing", `${R.fmt(a.down)} down, then ${a.months} × ${R.fmt(a.monthly)} at ${Math.round(a.rate * 100)}%`]]
        .map(([k, v]) => h("tr", {}, h("td", { textContent: k }), h("td", { textContent: v })))),
      h("p", { className: "note", textContent: "Its staff, its stock and the lease (a week paid) come with it. Two missed payments to the seller and it goes back to them." }),
      h("div", { style: "display:flex;gap:6px;justify-content:flex-end" },
        act(`Buy it outright (${R.fmt(a.asking)})`, () => send("buy_business", { place, financed: false, rivals: rivalsOf(side.place) }).then(bought)),
        act(`Buy it, ${R.fmt(a.down)} down`, () => send("buy_business", { place, financed: true, rivals: rivalsOf(side.place) }).then(bought), true)));
    function bought(r) { if (!r.ok) { notify(r.error); return r; } notify(`Bought: ${r.business.name} is yours.`); todoReset(); openBusiness(r.business.id); return r; }
  }
  //: The rivals of a place's kind within 600 m (the customers are shared with them).
  function rivalsOf(pl) {
    const kinds = [...pl.keys].filter((k) => k.startsWith("shop:"));
    return (district.places || []).filter((q) => q !== pl && q.id !== pl.id && Math.hypot(q.x - pl.x, q.z - pl.z) < 600 && kinds.some((k) => q.keys.has(k))).length;
  }

  function drawLaw(side, close, status, w, p, tabs = "") {
    side.el.classList.add("wide");
    const place = placeArg(side.place);
    const cases = myCases(w, p).filter((c) => !c.verdict);
    side.caseId ||= cases[0]?.id || null;
    const pick = h("select", { onchange: (e) => { side.caseId = e.target.value; drawSide(); } }, ...cases.map((c) => h("option", { value: c.id, textContent: `${c.charge.replace(/_/g, " ")} — ${c.memo || ""}`.slice(0, 70), selected: c.id === side.caseId })));
    let list = [];
    try { list = w.cmd_lawyers(p.id, { place, case: side.caseId }).lawyers; } catch (e) { list = []; notify(e.message); }
    const title = h("h3", {}, h("span", { textContent: `${address(side.place.name) || "Law office"}` }), close);
    const rows = list.map((l) => h("tr", {}, h("td", {}, h("b", { textContent: `${l.name}` }), h("div", { className: "note", textContent: `${l.title} · ${l.years} years · ${l.record.wins} won, ${l.record.pleas} pleas, ${l.record.losses} lost of ${l.record.cases}${l.odds ? ` · for your case: ${l.odds}` : ""}` })),
      h("td", { textContent: l.role === "public" ? (l.free ? "free" : "means-tested") : R.fmt(l.price) }),
      h("td", {}, side.caseId && cases.find((c) => c.id === side.caseId) && l.takes.includes(cases.find((c) => c.id === side.caseId).class)
        ? act("Hire", () => run("hire_lawyer", { place, lawyer: l.id, case: side.caseId, court: courtPlace() ? placeArg(courtPlace()) : null }, (r) => `${l.name} has your case: court ${when(r.case.court)}, at ${courtPlace().name || "the court"}. It is on your to-do list.`), true)
        : h("span", { className: "note", textContent: l.takes.join(", ") }))));
    side.el.replaceChildren(title, tabs, status,
      h("p", { className: "note", textContent: "The people here are the office's own (invented: the office is real, its lawyers are not). Their records are honest; the odds are the lawyer's own reading of your case." }),
      cases.length ? h("div", {}, "Your case: ", pick) : h("p", { className: "note", textContent: "You have no case open." }),
      (() => { const c = cases.find((x) => x.id === side.caseId); return c && !list.some((l) => l.takes.includes(c.class)) ? h("p", { className: "note", textContent: `No one here takes ${c.class} cases: another law office will.` }) : ""; })(),
      h("table", { className: "wares" }, ...rows),
      h("h4", { textContent: "Expungement" }), h("p", { className: "note", textContent: `Lines on your record over ${B.law.record_years} years old cleared, ${R.fmt(B.law.expunge.fee_base)}.` }),
      act("Clear old lines", () => run("expunge", { place }, (r) => `${r.cleared} line${r.cleared > 1 ? "s" : ""} cleared from your record.`)));
  }

  function drawRecruiter(side, close, status, w, p, place, tabs = "") {
    side.el.classList.add("wide");
    const title = h("h3", {}, h("span", { textContent: place ? `${address(place.name) || "Staffing agency"} — a recruiter` : "A headhunter" }), close);
    const rel = p.reliability, exp = p.experience || {};
    const expText = Object.entries(exp).map(([r, n]) => `${R.jobs.roles[r]?.title || r}: ${n} tasks`).join(", ") || "none yet";
    const offers = (p.job_offers || []).map((o) => h("tr", {}, h("td", {}, h("b", { textContent: o.title }), h("div", { className: "note", textContent: `${address(o.place.name) || "a workplace"} · fee ${R.fmt(o.fee)}, from your pay as it comes · until ${when(o.expires)}` })),
      h("td", { textContent: `${R.fmt(o.pay)}/h` }), h("td", {}, act("Take it", () => run("take_offer", { offer: o.id }, (r) => `Hired: ${r.job.title}. Go there and clock in.`), true), act("No", () => run("dismiss_offer", { offer: o.id }, "Declined.")))));
    const direct = (p.employment_offers || []).map((o) => h("tr", {}, h("td", {}, h("b", { textContent: `${o.title} at ${o.name}` }), h("div", { className: "note", textContent: shiftsText(o.shifts) })),
      h("td", { textContent: `${R.fmt(o.pay)}/h` }), h("td", {}, act("Accept", () => run("accept_employment", { offer: o.id }, (r) => `Hired: ${r.job.title} at ${o.name}.`), true), act("No", () => run("decline_employment", { offer: o.id }, "Declined.")))));
    const ask = () => {
      const here = me(), H = B.headhunter;
      const places = (district.places || []).map((pl) => ({ ...placeArg(pl), km: Math.hypot(pl.x - here.x, pl.z - here.z) / 1000 })).filter((x) => x.km <= H.reach_km);
      return run("headhunt", { places, place: place ? placeArg(place) : null }, (r) => (r.offers.length ? `${r.offers.length} offer${r.offers.length > 1 ? "s" : ""}: on your to-do list.` : "Nothing that pays enough better just now."));
    };
    side.el.replaceChildren(title, tabs, status,
      h("p", { className: "note", textContent: `Your experience: ${expText}. Shifts: ${rel ? `${rel.shifts}, ${pct(rel.shifts ? rel.on_time / rel.shifts : 1)} on time` : "none yet"}.${p.record?.length ? ` On your record: ${p.record.length} line${p.record.length > 1 ? "s" : ""} (fewer offers).` : ""}` }),
      act("Find me something better", ask, true),
      offers.length ? h("table", { className: "wares" }, ...offers) : h("p", { className: "note", textContent: "No offers yet: a recruiter offers the three best-paying jobs within 5 km at 10% or more over your pay." }),
      direct.length ? h("h4", { textContent: "Offers from players' businesses" }) : "", direct.length ? h("table", { className: "wares" }, ...direct) : "");
  }

  function drawReleased(side, close, p) {
    const r = p.released;
    if (!r) { side.el.replaceChildren(h("h3", {}, h("span", { textContent: "Released" }), close)); return; }
    side.el.classList.add("wide");
    const bar = (k) => `${k[0].toUpperCase()}${k.slice(1)} ${Math.round(r.before[k])} → ${Math.round(r.after[k])}`;
    const back = h("button", { className: "primary", textContent: "Back to the city", onclick: () => send("acknowledge_release").then(() => api.closeSide()) });
    side.el.replaceChildren(h("h3", {}, h("span", { textContent: `${r.days} days inside` }), close),
      h("p", { textContent: `Sentenced for ${r.charge.replace(/_/g, " ")}. This is what happened to you:` }),
      h("ol", {}, ...r.events.map((e) => h("li", { textContent: e.text }))),
      h("p", { className: "note", textContent: `You came out: ${["health", "stamina", "strength"].map(bar).join(", ")}.` }),
      r.lost_job ? h("p", { className: "note", textContent: `Your job as ${r.lost_job.toLowerCase()} did not wait for you.` }) : "",
      h("p", { className: "note", textContent: "On your record now: the conviction, and \"former inmate\". Some jobs check it; a law office can clear lines over two years old." }),
      back);
  }

  // ---- the Shop's Business and Law tabs ---------------------------------------------------------------
  //: The extra tabs of the Shop (the online panel); true if ``side.cat`` was one of them.
  function online(side, out, w, p) {
    if (side.cat === "business") {
      const mine = myBusinesses(w, p);
      out.push(h("h4", { textContent: "Your businesses" }),
        mine.length ? h("div", {}, ...mine.map((b) => h("div", {}, `${b.name} (${R.stores.kinds[b.kind].name.toLowerCase()}), till ${R.fmt(w.ledger.balance(b.account))} `, act("Manage", () => openBusiness(b.id), true))))
          : h("p", { className: "note", textContent: "None yet. Lease a vacant storefront (walk up to one: the action bar offers it), or buy a building, then register a business there. Or buy a shop: its panel shows its books and the price." }));
      const fronts = [...(w.storefronts?.values() || [])].filter((s) => s.holder === p.account && !w.bizAt(s.place.id));
      for (const s of fronts) {
        const kind = h("select", {}, ...Object.entries(R.stores.kinds).filter(([, k]) => !k.counter).map(([k, v]) => h("option", { value: k, textContent: v.name })));
        const name = h("input", { type: "text", placeholder: "Your business's name", maxLength: B.name_max, style: "width:14em" });
        const fees = () => R.fmt((R.business.licences.registration.fee_base));
        out.push(h("h4", { textContent: `Open a business at ${address(s.place.name) || "your storefront"}` }),
          h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" }, kind, name,
            act("Register", () => send("register_business", { place: s.place, kind: kind.value, name: name.value, rivals: rivalsOf({ ...s.place, keys: new Set([`shop:${kind.value}`]) }) })
              .then(done((r) => `${r.business.name} is registered: ${R.fmt(r.fees)} in licences. Fund the till, order stock and hire.`)).then((r) => { if (r.ok) { syncPlaces(true); openBusiness(r.business.id); } }), true)),
          h("p", { className: "note", textContent: `Licences from ${fees()} (registration), a health permit for food, a liquor licence for bars. The name must be your own: not a real business's.` }),
          act("Give the storefront back", () => run("end_storefront", { place: s.place.id }, (r) => `The deposit, ${R.fmt(r.returned)}, came back.`)));
      }
      const openings = [...(w.openings?.values() || [])].filter((o) => w.biz.get(o.business)?.owner !== p.account);
      out.push(h("h4", { textContent: "Openings at players' businesses" }),
        openings.length ? h("table", { className: "wares" }, ...openings.map((o) => h("tr", {}, h("td", {}, h("b", { textContent: `${o.title} at ${o.name}` }), h("div", { className: "note", textContent: shiftsText(o.shifts) })),
          h("td", { textContent: `${R.fmt(o.pay)}/h` }), h("td", {}, act("Apply", () => run("accept_employment", { opening: o.id }, (r) => `Hired: ${r.job.title} at ${o.name}.`), true)))))
          : h("p", { className: "note", textContent: "None posted." }),
        h("h4", { textContent: "Careers" }), act("Ask a headhunter for better jobs", () => openRecruiter()));
      return true;
    }
    if (side.cat === "law") {
      const cases = myCases(w, p);
      const lawOffice = nearestOf("shop:law_office"), court = courtPlace();
      const rows = cases.map((c) => {
        const bill = w.billing.bills.get(c.bill);
        return h("tr", {}, h("td", {}, h("b", { textContent: c.charge.replace(/_/g, " ") }), h("div", { className: "note", textContent: `${c.memo || ""} · ${c.class} · evidence ${c.evidence >= 0.85 ? "strong" : c.evidence >= 0.55 ? "a witness" : "thin"}${c.court ? ` · court ${when(c.court)}${c.lawyer ? ` with ${c.lawyer.name}` : ""}` : ""}${c.summons ? " · summons (unpaid)" : ""}` })),
          h("td", { textContent: bill ? R.fmt(bill.owed) : "" }),
          h("td", {}, bill?.status === "open" ? act("Pay", () => run("pay_bill", { bill: bill.id }, "Paid: the case is closed.")) : "",
            bill?.status === "open" && ["speed_camera", "speeding", "hov_violation", "theft", "parking", "toll_evasion"].includes(bill.kind) && !bill.hearing && !c.court ? act("Contest it yourself", () => run("contest", { bill: bill.id }, "Contested: a hearing in two weeks.")) : "",
            c.court && w.now >= c.court + B.law.attend_hours[0] * 3_600_000 ? act("Attend the hearing", () => attend(c), true) : ""));
      });
      const rec = (p.record || []).map((l) => h("li", { textContent: `${l.charge === "former_inmate" ? "Former inmate" : l.charge.replace(/_/g, " ")} — ${l.outcome}${l.days ? `, ${l.days} days` : ""}, ${date(l.at)}` }));
      out.push(h("h4", { textContent: "Your cases" }), rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "None open." }),
        h("p", { className: "note", textContent: `A fine is a case: pay it, contest it, or take it to a lawyer${lawOffice ? ` (nearest: ${address(lawOffice.name) || "a law office"}, ${Math.round(distanceTo(lawOffice))} m)` : ""}. Left unpaid past its late penalty it becomes a summons to court. Hearings are at ${court.name || "the court"}; miss one and it is heard without you.` }),
        p.probation ? h("p", { className: "note", textContent: `On probation until ${when(p.probation.until)}: a second offence doubles its fine.` }) : "",
        h("h4", { textContent: "Your record" }), rec.length ? h("ul", {}, ...rec) : h("p", { className: "note", textContent: "Clean." }));
      return true;
    }
    return false;
  }

  return { draw, storeExtra, todo, actions, online, syncPlaces, courtPlace };
}
