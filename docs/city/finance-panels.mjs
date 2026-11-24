// The panels for money: a bank's bankers and their desks, your credit file, the online lender,
// a business's books as charts and tables, and the box you talk to a character in. Kept out of
// view.mjs, which calls these through a few hooks (draw, creditTile, online, books, talkBox).
//
// Charts follow one small system: a fixed order of colours (never cycled; past six, "Other"),
// 2px lines, a gap between a ring's parts, a legend whenever there is more than one series, a
// readout under the pointer, and the same figures always in a table beside the picture. A line
// through estimated weeks is dashed, and says so.

import { cityTime, storesAt } from "./core.mjs";
import { bankersAt, creditRules } from "./credit.mjs";
import { fallbackLine, setLine, sortMessage, talkText } from "./npc-talk.mjs";
import { FAVOURS, askedFavour, favourLine } from "./npc-favours.mjs";

const DAY = 86_400_000;
const NS = "http://www.w3.org/2000/svg";
//: The series colours, in their fixed order (the dark steps: every panel is the HUD's dark glass, theme.mjs).
const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
export const FINANCE_CSS = `
#city-side{--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#0ca30c;--good:#0ca30c;--bad:#ff7b72;--grid:rgba(255,255,255,.16)}
#city-side .chart{margin:6px 0 10px}#city-side .chart svg{display:block;width:100%;height:auto;overflow:visible}
#city-side .chart text{font:11px system-ui,sans-serif;fill:var(--cm,#5b6875)}
#city-side .chart .readout{min-height:1.3em;font-size:12px;color:var(--cm,#5b6875)}
#city-side .legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;margin:2px 0 6px}
#city-side .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
#city-side .legend i.dash{height:0;border-top:2px dashed var(--cm,#5b6875);border-radius:0;vertical-align:3px;width:16px}
#city-side .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0}
#city-side .card{border:1px solid var(--cb,#d8dee4);border-radius:8px;padding:6px 8px}
#city-side .card b{display:block;font-size:15px}#city-side .card small{color:var(--cm,#5b6875);display:block}
#city-side .card .neg{color:var(--bad)}#city-side td.num,#city-side th.num{text-align:right;font-variant-numeric:tabular-nums}
#city-side .est{font-style:italic;color:var(--cm,#5b6875)}
#city-side .score{display:flex;align-items:baseline;gap:8px}#city-side .score b{font-size:28px;line-height:1}
#city-side .meter{height:8px;border-radius:4px;background:var(--grid);overflow:hidden;margin:4px 0 8px}#city-side .meter i{display:block;height:100%;background:var(--s1);border-radius:4px}
#city-side .desk{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--cb,#d8dee4);border-radius:8px;padding:8px;margin:6px 0;cursor:pointer;width:100%;text-align:left;background:none;color:inherit;font:inherit}
#city-side .desk:hover,#city-side .desk[aria-pressed=true]{border-color:var(--s1)}
#city-side .desk .face{flex:none;width:34px;height:34px;border-radius:50%;background:var(--s1);color:#fff;display:grid;place-items:center;font-weight:700}
#city-side .talk{border:1px solid var(--cb,#d8dee4);border-radius:8px;padding:6px;margin:8px 0}
#city-side .talk .log{max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
#city-side .talk .log div{padding:4px 8px;border-radius:8px;max-width:88%;font-size:13px;line-height:1.3}
#city-side .talk .log .npc{background:var(--grid);align-self:flex-start}#city-side .talk .log .me{background:var(--s1);color:#fff;align-self:flex-end}
#city-side .talk form{display:flex;gap:6px}#city-side .talk input{flex:1;min-width:0}
#city-msg .talk .log{display:flex;flex-direction:column;gap:5px;margin:6px 0 8px}
#city-msg .talk .log div{padding:5px 9px;border-radius:9px;max-width:88%;font-size:13px;line-height:1.3}
#city-msg .talk .log .npc{background:rgba(255,255,255,.12);align-self:flex-start}#city-msg .talk .log .me{background:#2f6fe4;color:#fff;align-self:flex-end}
#city-msg .talk form{display:flex;gap:6px}#city-msg .talk input{flex:1;min-width:0}`;

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "text") el.textContent = v; else if (k.startsWith("on")) el[k] = v; else el.setAttribute(k, v); }
  el.append(...kids.filter(Boolean));
  return el;
};
const nice = (max) => { if (!(max > 0)) return 1; const p = 10 ** Math.floor(Math.log10(max)), m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

export function financePanels(api) {
  const { R, h, act, notify, send, self, getView, placeArg, address, openSide, drawSide, getSide, talk } = api;
  const C = creditRules(R);
  const money = (v) => R.fmt(Math.round(v));
  const short = (v) => { const c = v / R.money(1), a = Math.abs(c); return `${c < 0 ? "−" : ""}${R.currency.symbol}${a >= 1e6 ? `${(a / 1e6).toFixed(1)}m` : a >= 1e4 ? `${Math.round(a / 1e3)}k` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : Math.round(a)}`; };
  const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
  const rate = (x) => `${(x * 100).toFixed(2)}%`;
  const dayLabel = (day) => { const t = cityTime(day * DAY + DAY / 2, R.clock.zone); return `${t.month}/${t.date}`; };
  const when = (ms) => { const t = cityTime(ms, R.clock.zone); return `${t.month}/${t.date} ${t.label.slice(4)}`; };
  const cell = (x, i) => (x instanceof Node ? h("td", { className: i ? "num" : "" }, x) : h("td", { textContent: x, className: i ? "num" : "" }));
  const table = (head, rows, cls = "wares") => {
    const top = head ? [h("tr", {}, ...head.map((x, i) => h("th", { textContent: x, className: i ? "num" : "" })))] : [];
    return h("table", { className: cls }, ...top, ...rows.map((r) => h("tr", {}, ...r.map(cell))));
  };
  const legend = (items) => h("div", { className: "legend" }, ...items.map(([name, colour, dash]) => h("span", {}, h("i", dash ? { className: "dash" } : { style: `background:${colour}` }), name)));

  // ---- charts -------------------------------------------------------------------------------------------
  //: Lines over the same points: series [{name, values}], points [{label, estimated}]. One axis.
  function lineChart({ series, points, fmt = short, full = money, label = "" }) {
    const W = 460, H = 170, L = 44, Rr = 8, T = 8, B = 22, n = points.length;
    const all = series.flatMap((s) => s.values), lo = Math.min(0, ...all), hi = nice(Math.max(1, ...all) - 0), span = hi - lo || 1;
    const X = (i) => L + (n > 1 ? i / (n - 1) : 0.5) * (W - L - Rr), Y = (v) => T + (1 - (v - lo) / span) * (H - T - B);
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
    for (const v of [lo, lo + span / 2, hi]) g.append(svg("line", { x1: L, x2: W - Rr, y1: Y(v), y2: Y(v), stroke: "var(--grid)", "stroke-width": 1 }), svg("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", text: fmt(v) }));
    if (lo < 0) g.append(svg("line", { x1: L, x2: W - Rr, y1: Y(0), y2: Y(0), stroke: "var(--cm,#5b6875)", "stroke-width": 1 }));
    const every = Math.max(1, Math.ceil(n / 6));
    points.forEach((p, i) => { if (i % every === 0 || i === n - 1) g.append(svg("text", { x: X(i), y: H - 6, "text-anchor": i === n - 1 ? "end" : "middle", text: p.label })); });
    series.forEach((s, k) => {
      // Recorded weeks solid; a stretch through estimated weeks dashed.
      for (let i = 1; i < n; i += 1) {
        const est = points[i].estimated || points[i - 1].estimated;
        g.append(svg("line", { x1: X(i - 1), y1: Y(s.values[i - 1]), x2: X(i), y2: Y(s.values[i]), stroke: SERIES[k], "stroke-width": 2, "stroke-linecap": "round", ...(est ? { "stroke-dasharray": "4 4", opacity: 0.75 } : {}) }));
      }
      if (n === 1) g.append(svg("circle", { cx: X(0), cy: Y(s.values[0]), r: 4, fill: SERIES[k] }));
    });
    const cross = svg("line", { y1: T, y2: H - B, stroke: "var(--cm,#5b6875)", "stroke-width": 1, visibility: "hidden" });
    const dots = series.map((s, k) => svg("circle", { r: 4, fill: SERIES[k], stroke: "var(--cp,#fff)", "stroke-width": 2, visibility: "hidden" }));
    const readout = h("div", { className: "readout", textContent: series.length === 1 ? `${series[0].name}, week by week` : "" });
    const hit = svg("rect", { x: L, y: T, width: W - L - Rr, height: H - T - B, fill: "transparent" });
    hit.onpointermove = (e) => {
      const box = g.getBoundingClientRect(), x = (e.clientX - box.left) / box.width * W;
      const i = Math.max(0, Math.min(n - 1, Math.round((x - L) / (W - L - Rr) * (n - 1))));
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      dots.forEach((d, k) => { d.setAttribute("cx", X(i)); d.setAttribute("cy", Y(series[k].values[i])); d.setAttribute("visibility", "visible"); });
      readout.textContent = `Week of ${points[i].label}${points[i].estimated ? " (estimated)" : ""}: ${series.map((s) => `${s.name} ${full(s.values[i])}`).join(" · ")}`;
    };
    hit.onpointerleave = () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); };
    g.append(cross, ...dots, hit);
    const est = points.some((p) => p.estimated);
    return h("div", { className: "chart" }, series.length > 1 || est ? legend([...(series.length > 1 ? series.map((s, k) => [s.name, SERIES[k]]) : []), ...(est ? [["estimated (before the records begin)", null, true]] : [])]) : "", g, readout);
  }
  //: Parts of a whole as a ring, with every part named and counted beside it. Past six, "Other".
  function ringChart({ parts, fmt = money, label = "", unit = "" }) {
    let list = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
    if (list.length > 6) list = [...list.slice(0, 5), { name: "Other", value: list.slice(5).reduce((s, p) => s + p.value, 0) }];
    const total = list.reduce((s, p) => s + p.value, 0);
    if (!total) return h("p", { className: "note", textContent: "Nothing to show yet." });
    const S = 132, c = S / 2, r1 = 62, r0 = 36, gap = list.length > 1 ? 0.03 : 0;
    const g = svg("svg", { viewBox: `0 0 ${S} ${S}`, role: "img", "aria-label": label, style: "max-width:132px;flex:none" });
    const centre = svg("text", { x: c, y: c + 4, "text-anchor": "middle", text: fmt(total) });
    let a = -Math.PI / 2;
    list.forEach((p, k) => {
      const sweep = p.value / total * Math.PI * 2, a0 = a + gap / 2, a1 = a + sweep - gap / 2;
      a += sweep;
      const pt = (ang, r) => `${(c + r * Math.cos(ang)).toFixed(2)} ${(c + r * Math.sin(ang)).toFixed(2)}`, big = a1 - a0 > Math.PI ? 1 : 0;
      const d = list.length === 1 ? `M ${pt(0, r1)} A ${r1} ${r1} 0 1 1 ${pt(Math.PI, r1)} A ${r1} ${r1} 0 1 1 ${pt(0, r1)} M ${pt(0, r0)} A ${r0} ${r0} 0 1 0 ${pt(Math.PI, r0)} A ${r0} ${r0} 0 1 0 ${pt(0, r0)}`
        : `M ${pt(a0, r1)} A ${r1} ${r1} 0 ${big} 1 ${pt(a1, r1)} L ${pt(a1, r0)} A ${r0} ${r0} 0 ${big} 0 ${pt(a0, r0)} Z`;
      const path = svg("path", { d, fill: SERIES[k], "fill-rule": "evenodd" }, svg("title", { text: `${p.name}: ${fmt(p.value)}${unit} (${pct(p.value / total)})` }));
      path.onpointerenter = () => { centre.textContent = pct(p.value / total); };
      path.onpointerleave = () => { centre.textContent = fmt(total); };
      g.append(path);
    });
    g.append(centre);
    const rows = table(null, list.map((p, k) => [h("span", {}, h("i", { style: `display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:${SERIES[k]}` }), p.name), `${fmt(p.value)}${unit}`, pct(p.value / total)]), "");
    return h("div", { className: "chart", style: "display:flex;gap:12px;align-items:center" }, g, h("div", { style: "flex:1;min-width:0" }, rows));
  }

  // ---- a business's books -------------------------------------------------------------------------------
  //: The books of a business (world.businessBooks) or a shop for sale (world.shopBooks) into ``out``.
  function books(out, a, side, { own = true } = {}) {
    side.books ||= "summary";
    const tabs = [["summary", "Summary"], ["sales", "Sales & profit"], ["customers", "Customers & items"], ["costs", "Costs"], ...(own ? [["ledger", "Transactions"]] : [])];
    out.push(h("div", { className: "tabs" }, ...tabs.map(([k, label]) => h("button", { textContent: label, "aria-pressed": String(side.books === k), onclick: () => { side.books = k; drawSide(); } }))));
    const est = (p) => (p.estimated_days ? ` · ${p.estimated_days} of ${p.days} days estimated` : "");
    const signed = (v) => h("span", { className: v < 0 ? "neg" : "", textContent: money(v) });
    if (a.estimated) out.push(h("p", { className: "note est", textContent: `Days before ${a.since === null ? "anyone dealt with this shop" : `the records begin (${dayLabel(a.since)})`} are estimated from a typical week, and marked. Everything after is what actually happened: every customer and every sale. All periods are game days.` }));
    const weeks = a.weekly.map((w) => ({ label: dayLabel(w.start), estimated: w.estimated }));
    if (side.books === "summary") {
      out.push(h("div", { className: "cards" }, ...a.periods.map((p) => h("div", { className: "card" }, h("small", { textContent: p.label }), h("b", { textContent: short(p.sales) }), h("small", {}, "profit ", signed(p.profit)), p.estimated_days ? h("small", { className: "est", textContent: `${Math.round(p.estimated_days / p.days * 100)}% estimated` }) : ""))));
      if (a.balance) {
        const b = a.balance;
        out.push(h("h4", { textContent: "Balance sheet, now" }), table(["What it has", ""], [...b.assets.map(([k, v]) => [k, money(v)]), ["Total", money(b.total_assets)]]),
          table(["What it owes", ""], [...(b.liabilities.length ? b.liabilities.map(([k, v]) => [k, money(v)]) : [["Nothing", money(0)]]), ["Total", money(b.total_liabilities)]]),
          table(null, [["Owner's equity (has less owes)", signed(b.equity)]]));
      }
      out.push(h("h4", { textContent: "Revenue and profit" }), table(["", "Revenue", "Profit", "Margin", "Orders"], a.periods.map((p) => [`${p.label}${p.estimated_days ? " *" : ""}`, money(p.sales), signed(p.profit), pct(p.margin), String(p.orders)])),
        a.estimated ? h("p", { className: "note est", textContent: "* includes estimated days." }) : "");
    }
    if (side.books === "sales") {
      out.push(h("h4", { textContent: "Revenue and profit, week by week" }), lineChart({ series: [{ name: "Revenue", values: a.weekly.map((w) => w.sales) }, { name: "Profit", values: a.weekly.map((w) => w.profit) }], points: weeks, label: "Revenue and profit by week" }),
        table(["Period", "Revenue", "Goods", "Wages", "Rent", "Fees", "Profit"], a.periods.map((p) => [p.label, money(p.sales), money(p.cogs), money(p.wages), money(p.rent), money(p.fees), signed(p.profit)])),
        ...a.periods.filter((p) => p.estimated_days).map((p) => h("p", { className: "note est", textContent: `${p.label}${est(p).replace(" · ", ": ")}.` })),
        h("h4", { textContent: "The last weeks" }), table(["Week of", "Revenue", "Profit", "Orders"], a.weekly.slice(-8).reverse().map((w) => [`${dayLabel(w.start)}${w.estimated ? " (est.)" : w.days < 7 ? ` (${w.days} d)` : ""}`, money(w.sales), signed(w.profit), String(w.orders)])));
    }
    if (side.books === "customers") {
      const o = a.orders;
      out.push(h("div", { className: "cards" },
        h("div", { className: "card" }, h("small", { textContent: "Average order" }), h("b", { textContent: money(o.average) }), h("small", { textContent: `${o.units_per_order.toFixed(1)} items` })),
        h("div", { className: "card" }, h("small", { textContent: "Orders a day" }), h("b", { textContent: o.per_day.toFixed(1) }), h("small", { textContent: `${o.count} in the month` })),
        h("div", { className: "card" }, h("small", { textContent: "Served" }), h("b", { textContent: pct(o.served_share) }), h("small", { textContent: `${Math.round(o.turned_away)} turned away` }))),
        h("p", { className: "note", textContent: `Players at the counter spent ${money(o.at_counter)} of the month's revenue; the rest is the city's residents.` }),
        h("h4", { textContent: "Average order, week by week" }), lineChart({ series: [{ name: "Average order", values: a.weekly.map((w) => w.average_order) }], points: weeks, label: "Average order by week" }),
        h("h4", { textContent: "What sells (units, last four weeks)" }), ringChart({ parts: a.items.map((i) => ({ name: i.name, value: i.units })), fmt: (v) => String(Math.round(v)), label: "Items by units sold" }),
        table(["Item", "Units", "Share", "Price", "Margin", "Profit"], a.items.map((i) => [i.name, String(i.units), pct(i.share), money(i.price), pct(i.margin), money(i.profit)])));
      const top = a.items.slice(0, 6);
      if (top.length) out.push(h("h4", { textContent: "Units a week, by item" }), lineChart({ series: top.map((i) => ({ name: i.name, values: i.weekly.map((w) => w.units) })), points: a.item_weeks.map((w) => ({ label: dayLabel(w.week * 7), estimated: w.estimated })), fmt: (v) => String(Math.round(v)), full: (v) => `${Math.round(v)}`, label: "Units sold a week by item" }),
        table(["Week of", ...top.map((i) => i.name)], a.item_weeks.slice(-8).reverse().map((w, k) => [`${dayLabel(w.week * 7)}${w.estimated ? " (est.)" : ""}`, ...top.map((i) => String(i.weekly[i.weekly.length - 1 - k].units))])));
    }
    if (side.books === "costs") {
      side.costs ||= 30;
      const c = a.costs.find((x) => x.key === side.costs) || a.costs[0], p = a.periods.find((x) => x.key === c.key);
      out.push(h("div", { className: "tabs" }, ...a.costs.map((x) => h("button", { textContent: x.label, "aria-pressed": String(x.key === c.key), onclick: () => { side.costs = x.key; drawSide(); } }))),
        ringChart({ parts: c.parts, fmt: short, label: `Costs, ${c.label.toLowerCase()}` }),
        table(["Cost", "Amount", "Of revenue"], [...c.parts.map((x) => [x.name, money(x.value), p.sales ? pct(x.value / p.sales) : "—"]), ["All costs", money(c.total), p.sales ? pct(c.total / p.sales) : "—"], ["Left as profit", signed(p.profit), p.sales ? pct(p.margin) : "—"]]),
        p.estimated_days ? h("p", { className: "note est", textContent: `${p.estimated_days} of these ${p.days} days are estimated.` }) : "",
        h("h4", { textContent: "Goods and wages, week by week" }), lineChart({ series: [{ name: "Goods sold", values: a.weekly.map((w) => w.cogs) }, { name: "Wages", values: a.weekly.map((w) => w.wages) }], points: weeks, label: "Costs by week" }));
    }
    if (side.books === "ledger") {
      out.push(a.recent.length ? table(["When", "What", "Amount"], a.recent.map((t) => [when(t.t), `${String(t.kind).replace(/^mint:|^burn:/, "").replace(/_/g, " ")}${t.memo ? ` — ${t.memo}` : ""}`.slice(0, 70), signed(t.amount)]))
        : h("p", { className: "note", textContent: "No money has moved on the business's account yet." }));
    }
  }

  // ---- talking to someone ---------------------------------------------------------------------------------
  //: A conversation with a character: set lines answered here at once; a real question goes to the
  //: city's server, which may have a model for it (and a set line of its own when it has not).
  function talkBox(state, who, body = {}, redraw = drawSide) {
    state.log ||= [{ from: "npc", text: setLine("opening", who) }];
    // A line may carry a link (a waiter's menu): {parts: [string | {link, run}]}.
    const line = (m) => (m.parts ? h("div", { className: m.from }, ...m.parts.map((x) => (typeof x === "string" ? x : h("a", { href: "#", textContent: x.link, onclick: (ev) => { ev.preventDefault(); x.run?.(); } }))))
      : h("div", { className: m.from, textContent: m.text }));
    const log = h("div", { className: "log" }, ...state.log.map(line));
    const input = h("input", { type: "text", maxLength: 400, placeholder: `Say something to ${String(who.name || "them").split(" ")[0]}…`, value: state.draft || "", oninput: (e) => { state.draft = e.target.value; } });
    // While the box is up they stand and face you (view.mjs talkTo); each line keeps them a while longer.
    if (who.role === "resident") api.onTalk?.(who);
    const say = async (text, extra = {}) => {
      const mine = talkText(text);
      if (!mine && !extra.ask && !extra.favour) return;
      if (who.role === "resident") api.onTalk?.(who);
      if (mine) state.log.push({ from: "me", text: mine });
      state.draft = "";
      const turn = state.log.length, sorted = sortMessage(mine);
      // Asked for a hand (npc-favours.mjs): the world decides; the character says it.
      const kind = who.role === "resident" ? extra.favour || askedFavour(mine) : null;
      let reply = null, decided = null;
      if (kind && api.askFavour) {
        state.busy = true; redraw();
        decided = await api.askFavour(who, kind, { offer: extra.offer || 0 });
        state.busy = false;
        if (decided && !decided.ok) { state.log.push({ from: "npc", text: decided.error || fallbackLine(who, turn) }); redraw(); return; }
      }
      if (sorted.route === "set" && !extra.ask && !decided) reply = setLine(sorted.intent, who, turn);
      else {
        state.busy = true; redraw();
        const r = await talk({ role: who.role, text: mine || `(asks you to ${FAVOURS[kind]?.label || "help"})`, turn, history: state.log.slice(-9, -1), ...body, ...(decided ? { favour: true } : {}) });
        state.busy = false;
        reply = r?.ok && r.reply ? r.reply : decided ? favourLine(decided.verdict, { kind, terms: decided.terms, tone: who.tone, seed: `${who.id}|${turn}` }) : fallbackLine(who, turn);
        // The character noticed an ask the words here did not: put to the world now.
        if (!decided && r?.favour_hint && api.askFavour) {
          state.log.push({ from: "npc", text: reply });
          redraw();
          return say("", { favour: r.favour_hint });
        }
      }
      state.ask = decided && decided.verdict === "argue" && decided.terms?.pay ? { kind, pay: decided.terms.pay } : null;
      state.log.push({ from: "npc", text: reply });
      if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
      redraw();
    };
    state.say = say;
    const form = h("form", { onsubmit: (e) => { e.preventDefault(); if (!state.busy) say(input.value); } }, input, h("button", { type: "submit", textContent: state.busy ? "…" : "Say", disabled: Boolean(state.busy) }));
    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    // Asking a stranger for a hand, in so many words; and their terms, when they argue.
    const asks = who.role === "resident" && api.askFavour ? h("div", { className: "asks", style: "display:flex;flex-wrap:wrap;gap:4px;margin-top:6px" },
      ...(state.ask ? [h("button", { className: "primary", textContent: `Offer ${R.fmt(state.ask.pay)}`, disabled: Boolean(state.busy), onclick: () => say(`I'll give you ${R.fmt(state.ask.pay)} for it.`, { favour: state.ask.kind, offer: state.ask.pay }) })] : []),
      ...[["carry", "Could you give me a hand carrying this?"], ["wait", "Could you wait here a moment?"], ["make_way", "Excuse me, could you step aside?"], ["come", "Could you come with me?"], ["ride", "Could you give me a lift?"]]
        .map(([k, line]) => h("button", { textContent: FAVOURS[k].label.replace(/^./, (c) => c.toUpperCase()), title: line, disabled: Boolean(state.busy), onclick: () => say(line, { favour: k }) }))) : null;
    return h("div", { className: "talk" }, log, form, asks || "");
  }

  // ---- your credit file -----------------------------------------------------------------------------------
  function scoreBlock(rep) {
    const S = C.score, share = (rep.score - S.min) / (S.max - S.min);
    return [h("div", { className: "score" }, h("b", { textContent: String(rep.score) }), h("span", { textContent: `${rep.band} · ${S.min}–${S.max}` })),
      h("div", { className: "meter", role: "img", "aria-label": `Credit score ${rep.score} of ${S.max}` }, h("i", { style: `width:${Math.round(share * 100)}%` }))];
  }
  function loanRows(rep, w) {
    const open = rep.loans.filter((l) => l.status === "open");
    if (!open.length && !rep.mortgages.length) return [h("p", { className: "note", textContent: "No loans." })];
    return [table(["Loan", "Owed", "Monthly", "Rate", ""], [
      ...open.map((l) => [`${l.name}${l.channel === "online" ? " (online)" : ""} · ${l.left} left${l.missed ? ` · ${l.missed} missed` : ""}`, money(l.owed), money(l.monthly), rate(l.rate),
        act("Pay off", () => send("repay_loan", { loan: l.id }).then((r) => { notify(r.ok ? `${l.name} paid off.` : r.error); drawSide(); return r; }))]),
      ...rep.mortgages.map((m) => [`Mortgage${m.missed ? ` · ${m.missed} missed` : ""}`, money(m.owed), money(m.monthly), rate(m.rate), ""])])];
  }
  //: The credit part of the You panel.
  function creditTile() {
    const w = getView(), p = self();
    if (!w?.creditReport || !p) return [];
    const rep = w.creditReport(p.id);
    return [...scoreBlock(rep), h("table", {}, ...rep.factors.map((f) => h("tr", { title: f.text }, h("td", { textContent: `${f.label} (${Math.round(f.weight * 100)}%)` }), h("td", { className: "num", textContent: `${Math.round(f.value * 100)}/100` })))),
      ...loanRows(rep, w), rep.marks.length ? h("p", { className: "note", textContent: `On file: ${rep.marks.map((m) => `${m.kind} (${m.what})`).join(", ")}.` }) : "",
      act("Borrow online", () => { openSide("online"); getSide().cat = "loans"; drawSide(); }), h("p", { className: "note", textContent: "A banker at a bank gives a better rate than the online lender." })];
  }

  // ---- asking for a loan ----------------------------------------------------------------------------------
  //: The form for one kind of loan, the lender's answer, and the button that takes it.
  function loanForm(side, w, p, products, where) {
    side.loan ||= {};
    const f = side.loan;
    if (!products.includes(f.product)) { f.product = products[0]; f.quote = null; }
    const P = C.products[f.product];
    const bills = P.pays_bill ? w.billing.open(p.account).filter((b) => P.pays_bill.includes(b.kind)) : [];
    if (!P.months.includes(f.months)) f.months = P.months[Math.min(1, P.months.length - 1)];
    f.amount ??= Math.round(P.min * 5 / R.money(1));
    const args = () => ({ product: f.product, months: f.months, amount: R.money(+f.amount || 0), ...(P.pays_bill ? { bill: f.bill || bills[0]?.id } : {}), ...where });
    const ask = () => send("loan_quote", args()).then((r) => { f.quote = r.ok ? r.quote : { approved: false, reasons: [r.error] }; drawSide(); return { ok: true }; });
    const out = [h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" },
      products.length > 1 ? h("select", { onchange: (e) => { f.product = e.target.value; f.quote = null; drawSide(); } }, ...products.map((id) => h("option", { value: id, textContent: C.products[id].name, selected: id === f.product }))) : h("b", { textContent: P.name }),
      P.pays_bill ? (bills.length ? h("select", { onchange: (e) => { f.bill = e.target.value; f.quote = null; } }, ...bills.map((b) => h("option", { value: b.id, textContent: `${b.memo || b.kind}: ${money(b.owed)}`.slice(0, 48), selected: b.id === f.bill })))
        : h("span", { className: "note", textContent: "You have no medical bill to cover." }))
        : h("span", {}, R.currency.symbol, h("input", { type: "number", min: String(P.min / R.money(1)), step: "100", value: String(f.amount), style: "width:6.5em", oninput: (e) => { f.amount = e.target.value; f.quote = null; } })),
      h("select", { onchange: (e) => { f.months = +e.target.value; f.quote = null; } }, ...P.months.map((m) => h("option", { value: m, textContent: `${m} months`, selected: m === f.months }))),
      P.pays_bill && !bills.length ? "" : act("Ask", ask, true))];
    const q = f.quote;
    if (q) {
      out.push(q.approved ? h("div", { className: "cards" },
        h("div", { className: "card" }, h("small", { textContent: "Rate a year" }), h("b", { textContent: rate(q.rate) })),
        h("div", { className: "card" }, h("small", { textContent: "A month" }), h("b", { textContent: money(q.monthly) }), h("small", { textContent: `${q.months} payments` })),
        h("div", { className: "card" }, h("small", { textContent: "Interest in all" }), h("b", { textContent: money(q.interest) }), h("small", { textContent: `on ${money(q.amount)}` })))
        : h("p", { textContent: `Declined: ${q.reasons[0]}.` }),
        h("p", { className: "note", textContent: q.approved ? `How the rate was reached: ${q.reasons.join("; ")}.` : q.max ? `The most that could be lent: ${money(q.max)}.` : "" }));
      if (q.approved) out.push(act(`Take the loan: ${money(q.amount)}${P.pays_bill ? ", paid to the bill" : " into your wallet"}`, () => send("take_loan", args()).then((r) => {
        notify(r.ok ? `${r.loan.name}: ${money(r.loan.principal)} at ${rate(r.loan.rate)}, ${money(r.loan.monthly)} a month for ${r.loan.months} months. Payments are taken from your wallet when due.` : r.error);
        if (r.ok) f.quote = null;
        drawSide(); return r;
      }), true));
    }
    return { out, ask, args };
  }

  // ---- the bank -------------------------------------------------------------------------------------------
  function drawBank(side, close, status, w, p, tabs = "") {
    side.el.classList.add("wide");
    const place = placeArg(side.place), all = bankersAt(R, place);
    const banker = all.find((b) => b.id === side.banker) || null;
    const title = h("h3", {}, h("span", { textContent: `${address(side.place.name) || "Bank"} — bank` }), close);
    const rep = w.creditReport(p.id);
    if (!banker) {
      side.el.replaceChildren(title, tabs, status,
        h("p", { className: "note", textContent: "Each banker has their own desk: go to the one for what you need. They read your credit file and give you a rate. (The bank is real; its bankers are invented.)" }),
        ...all.map((b) => h("button", { className: "desk", onclick: () => { side.banker = b.id; side.loan = null; side.talk = null; drawSide(); } },
          h("span", { className: "face", textContent: b.name.split(" ").map((x) => x[0]).join("") }),
          h("span", {}, h("b", { textContent: b.name }), h("div", { textContent: b.title }), h("div", { className: "note", textContent: `For ${b.handles} · ${b.years} years here · ${b.style}` })))),
        h("h4", { textContent: "Your credit" }), ...scoreBlock(rep), ...loanRows(rep, w));
      return;
    }
    const who = { id: banker.id, name: banker.name, title: banker.title, role: "banker", tone: ["reserved", "warm", "direct", "expressive"][banker.years % 4] };
    const where = { place, banker: banker.id };
    side.talk ||= {};
    const out = [title, h("button", { textContent: "← All desks", onclick: () => { side.banker = null; drawSide(); } }),
      h("div", { className: "desk", "aria-pressed": "true", style: "cursor:default" }, h("span", { className: "face", textContent: banker.name.split(" ").map((x) => x[0]).join("") }),
        h("span", {}, h("b", { textContent: banker.name }), h("div", { textContent: banker.title }), h("div", { className: "note", textContent: `For ${banker.handles}` }))), status];
    if (banker.specialty === "mortgage") {
      side.price ??= 900000;
      const pre = rep.preapproval;
      out.push(h("h4", { textContent: "A home loan" }), h("p", { className: "note", textContent: `Tell ${banker.name.split(" ")[0]} the price you have in mind: an approval here holds its rate for ${C.preapproval_days} days and is used when you buy (Shop → Real estate). Without one, the online rate applies.` }),
        h("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap" }, "Home price ", R.currency.symbol, h("input", { type: "number", min: "50000", step: "10000", value: String(side.price), style: "width:8em", oninput: (e) => { side.price = +e.target.value; } }),
          act("Ask for approval", () => send("preapprove_mortgage", { ...where, price: R.money(side.price) }).then((r) => {
            side.mortgage = r.ok ? r.quote : { approved: false, reasons: [r.error] }; drawSide(); return { ok: true };
          }), true)));
      const q = side.mortgage;
      if (q) out.push(q.approved ? h("div", { className: "cards" },
        h("div", { className: "card" }, h("small", { textContent: "Rate a year" }), h("b", { textContent: rate(q.rate) }), h("small", { textContent: `online: more` })),
        h("div", { className: "card" }, h("small", { textContent: "A month" }), h("b", { textContent: money(q.monthly) }), h("small", { textContent: `${q.years} years` })),
        h("div", { className: "card" }, h("small", { textContent: "To bring" }), h("b", { textContent: short(q.upfront) }), h("small", { textContent: "down payment and closing" })))
        : h("p", { textContent: `Declined: ${q.reasons[0]}.` }), q.approved ? h("p", { className: "note", textContent: `How the rate was reached: ${q.reasons.join("; ")}.` }) : "");
      if (pre) out.push(h("p", { className: "note", textContent: `Approved: up to ${money(pre.loan)} at ${rate(pre.rate)} with ${pre.banker}, until ${when(pre.until)}.` }));
      out.push(h("h4", { textContent: `Talk to ${banker.name.split(" ")[0]}` }), talkBox(side.talk, who, where));
    } else {
      const form = loanForm(side, w, p, banker.products, where);
      out.push(h("h4", { textContent: "What would you like to borrow?" }), ...form.out,
        h("h4", { textContent: `Talk to ${banker.name.split(" ")[0]}` }), talkBox(side.talk, who, where),
        act("Ask them to explain the bank's answer", () => { const a = form.args(); return side.talk.say("Could you walk me through what the bank would say to this loan?", { ask: { product: a.product, amount: a.amount, months: a.months, bill: a.bill } }).then(() => ({ ok: true })); }));
    }
    out.push(h("h4", { textContent: "Your file, as they see it" }), ...scoreBlock(rep), h("p", { className: "note", textContent: rep.factors.map((f) => `${f.label}: ${f.text}`).join(". ") + "." }), ...loanRows(rep, w));
    side.el.replaceChildren(...out);
  }

  //: Draws ``side`` if it is the bank's; true if it was.
  function draw(side, { close, status, w, p }) {
    if (side.kind !== "store" || !side.place?.keys) return false;
    const stores = storesAt(R, side.place.keys), cur = stores[Math.min(side.store || 0, stores.length - 1)];
    if (cur?.kind !== "bank") return false;
    const tabs = stores.length > 1 ? h("div", { className: "tabs" }, ...stores.map((s2, i) => h("button", { textContent: s2.name, "aria-pressed": String(s2 === cur), onclick: () => { side.store = i; drawSide(); } }))) : "";
    drawBank(side, close, status, w, p, tabs);
    return true;
  }
  //: The Shop's Loans tab: the online lender. True if ``side.cat`` was it.
  function online(side, out, w, p) {
    if (side.cat !== "loans") return false;
    const rep = w.creditReport(p.id), ch = C.channels.online;
    const products = Object.entries(C.products).filter(([, P]) => P.online).map(([id]) => id);
    out.push(h("h4", { textContent: "Borrow online" }),
      h("p", { className: "note", textContent: `Money in a minute, from anywhere, to almost any file, at about ${Math.round(ch.rate_add * 100)} points more a year than a banker would charge, and less of it. A bank's desk is cheaper: its bankers lend in person. Business, vehicle and home loans are only made in a branch.` }),
      ...scoreBlock(rep), ...loanForm(side, w, p, products, {}).out, h("h4", { textContent: "Your loans" }), ...loanRows(rep, w));
    return true;
  }
  return { draw, online, creditTile, books, talkBox, lineChart, ringChart };
}
