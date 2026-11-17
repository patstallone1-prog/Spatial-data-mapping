// Your profile: one overview, and four pages that each take the whole window.
//
//   You            everything at a glance: how you are, your job and the one home you live in,
//                  your money in four figures, what you own as small pictures, your own story.
//   Business       your job, and each business of yours with what it took last week.
//   Finances       the bank account, credit, what you owe (pay or contest), taxes, history.
//   Assets         everything you own, a picture each; pick one for its detail -- for a car,
//                  where it is now.
//   Relationships  everyone you have a tie to: friends, your boss, your staff, your lawyer, your
//                  banker, the people of the city you have talked with.
//
// What the older pages held has a place in these: the building beside you (owner, value, taxes,
// buying it) is on Assets; the city's laws, the votes and proposing a measure are on Finances;
// the people out of doors near you, with who they are and a box to talk, are on Relationships.
// Kept out of view.mjs, which hands over what it needs.

import { BACKSTORY_MAX } from "./social.mjs";

const TABS = [["you", "You"], ["business", "Business"], ["finances", "Finances"], ["assets", "Assets"], ["relationships", "Relationships"]];
const DAY = 86_400_000;
//: A small picture for each kind of thing owned (drawn here: no files to fetch).
const ICON = {
  vehicle: '<path d="M5 26h30l-3-9a4 4 0 0 0-4-3H12a4 4 0 0 0-4 3z" fill="currentColor"/><rect x="3" y="24" width="34" height="8" rx="3" fill="currentColor"/><circle cx="11" cy="33" r="3.5" fill="#0b1220"/><circle cx="29" cy="33" r="3.5" fill="#0b1220"/>',
  home: '<path d="M4 20 20 6l16 14v16H4z" fill="currentColor"/><rect x="16" y="24" width="8" height="12" fill="#0b1220"/>',
  building: '<rect x="8" y="4" width="24" height="32" rx="1" fill="currentColor"/><g fill="#0b1220"><rect x="12" y="8" width="5" height="5"/><rect x="23" y="8" width="5" height="5"/><rect x="12" y="17" width="5" height="5"/><rect x="23" y="17" width="5" height="5"/><rect x="17" y="27" width="6" height="9"/></g>',
  business: '<path d="M4 16 8 6h24l4 10z" fill="currentColor"/><rect x="6" y="16" width="28" height="20" fill="currentColor" opacity=".75"/><rect x="10" y="22" width="9" height="14" fill="#0b1220"/><rect x="23" y="22" width="8" height="7" fill="#0b1220"/>',
  goods: '<rect x="7" y="12" width="26" height="22" rx="2" fill="currentColor"/><path d="M14 12V9a6 6 0 0 1 12 0v3" fill="none" stroke="currentColor" stroke-width="3"/>',
};
const TINT = { vehicle: "#3987e5", home: "#199e70", building: "#c98500", business: "#d95926", goods: "#9085e9" };
export const PROFILE_CSS = `
/* Nothing shows through the profile (the task board and the top bar lie under it and their words
   read through its text), and nothing in it runs over its neighbour: long values wrap, names
   that will not fit are cut with an ellipsis. */
body #city.pop{background:rgba(15,21,33,.98)}
body #city.pop td{overflow-wrap:anywhere}
body #city.pop td:last-child{white-space:normal;text-align:right;padding-left:10px}
body #city.pop td:first-child{padding-right:8px}
body #city.pop .me>div:nth-child(2){min-width:0;flex:1}
body #city.pop .me h2,body #city.pop .tile h4{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body #city.pop .fig{min-width:0}body #city.pop .fig b{display:block;overflow-wrap:anywhere;line-height:1.15}
body #city.pop .tile{min-width:0;overflow:hidden}
body #city.pop .rel b,body #city.pop .rel small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
body #city.pop .bar{min-width:0}
body #city.pop .ptabs{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:4px 0 12px}
body #city.pop .ptabs button{padding:11px 6px;font:700 14px/1.1 system-ui,sans-serif;border-radius:10px;margin:0}
body #city.pop .ptabs button[aria-pressed=true]{background:#2f6fe4;border-color:#2f6fe4;color:#fff}
body #city.pop .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;align-items:start}
body #city.pop .figs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 10px}
body #city.pop .fig{border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px}
body #city.pop .fig small{display:block;color:var(--cm);font-size:11px}body #city.pop .fig b{font-size:17px}
body #city.pop .assets{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px}
body #city.pop .asset{width:104px;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 6px 6px;text-align:center;background:none;color:inherit;font:inherit;cursor:pointer;margin:0}
body #city.pop .asset[aria-pressed=true]{border-color:#2f6fe4;background:rgba(47,111,228,.16)}
body #city.pop .asset svg{width:44px;height:44px;display:block;margin:0 auto 4px}
body #city.pop .asset span{display:block;font-size:11px;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
body #city.pop .asset small{display:block;color:var(--cm);font-size:10.5px;margin-top:2px}
body #city.pop textarea{width:100%;box-sizing:border-box;min-height:74px;font:inherit;color:inherit;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px 8px;resize:vertical}
body #city.pop .rel{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid rgba(255,255,255,.1)}
body #city.pop .rel i{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:700 12px system-ui,sans-serif;font-style:normal;color:#fff}
body #city.pop .rel div{flex:1;min-width:0}body #city.pop .rel small{display:block;color:var(--cm)}
body #city.pop .rel em{font-style:normal;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.12);white-space:nowrap}
body #city.pop .talk .log{display:flex;flex-direction:column;gap:5px;margin:6px 0 8px;max-height:180px;overflow:auto}
body #city.pop .talk .log div{padding:5px 9px;border-radius:9px;max-width:88%;font-size:13px;line-height:1.3}
body #city.pop .talk .log .npc{background:rgba(255,255,255,.12);align-self:flex-start}body #city.pop .talk .log .me{background:#2f6fe4;color:#fff;align-self:flex-end}
body #city.pop .talk form{display:flex;gap:6px}body #city.pop .talk input{flex:1;min-width:0}
@media (max-width:640px){body #city.pop .ptabs{grid-template-columns:repeat(3,1fr)}body #city.pop .figs{grid-template-columns:repeat(2,1fr)}}`;

export function profilePanel(api) {
  const { R, h, act, row, send, notify, me, district, address, wealthOf, portrait, finance, openSide, getSide, drawSide, legacy, crossAt, editHome, redraw, peers } = api;
  const ui = { tab: "you", asset: null, legacy: null, story: null };
  const money = (v) => R.fmt(Math.round(v));
  const tile = (title, ...kids) => h("section", { className: "tile" }, h("h4", { textContent: title }), ...kids.filter((k) => k !== null && k !== undefined && k !== ""));
  const note = (text) => h("p", { className: "note", textContent: text });
  const bar = (label, value, colour) => h("div", { className: "bar", innerHTML: `<span>${label}</span><i style="--v:${Math.max(0, Math.min(100, value)).toFixed(1)}%;--c:${colour}"></i><b>${Math.round(value)}</b>` });
  const icon = (kind) => { const s = h("span", {}); s.innerHTML = `<svg viewBox="0 0 40 40" style="color:${TINT[kind] || "#8aa"}" aria-hidden="true">${ICON[kind] || ICON.goods}</svg>`; return s.firstChild; };
  const go = (tab, extra = {}) => { Object.assign(ui, { tab, legacy: null }, extra); redraw(); };

  //: The one home you live in (not every flat in the building), as a line.
  function homeLine(st) {
    if (!st.home) return "none";
    const place = district.placeById?.get(st.home.building);
    return st.home.label || address(st.home.address) || address(place?.name) || "Your room";
  }
  //: What you own, each with a kind, a name, a line under it and where it is.
  function assetsOf(w, p, st) {
    const out = [];
    for (const a of st.vehicles || []) {
      const spec = R.vehicles.models[a.attrs.model], spot = p.parked?.[a.id];
      out.push({ id: a.id, kind: "vehicle", name: spec?.name || "Vehicle", under: a.attrs.plate || "", value: Math.round(a.attrs.value || spec?.price || 0), a, spot,
        at: st.driving === a.id ? { x: me().x, z: me().z, how: "You are driving it" } : spot ? { x: spot.x, z: spot.z, how: spot.offstreet ? "Parked off the street" : spot.metered ? "Parked at a meter" : "Parked at the kerb" } : null });
    }
    for (const a of st.homes || []) out.push({ id: a.id, kind: "home", name: a.attrs.label || "Home", under: address(a.attrs.address) || "", value: Math.round(a.attrs.assessed || 0), a,
      at: Number.isFinite(a.attrs.x) ? { x: a.attrs.x, z: a.attrs.z, how: st.home?.room === a.id ? "You live here" : "Yours" } : null });
    for (const a of st.properties || []) { const pl = district.placeById?.get(String(a.id).replace(/^building:/, "")); out.push({ id: a.id, kind: "building", name: address(a.attrs.name) || "Building", under: pl ? address(pl.name) || "" : "", value: Math.round(a.attrs.assessed || 0), a, at: pl ? { x: pl.x, z: pl.z, how: "Yours" } : null }); }
    for (const b of st.businesses || []) out.push({ id: b.id, kind: "business", name: b.name, under: address(b.place?.name) || R.stores.kinds[b.kind]?.name || "", value: Math.round(b.balance || 0), b, at: b.place ? { x: b.place.x, z: b.place.z, how: "Open" } : null });
    return out;
  }
  const assetCard = (x, pressed = false, onclick = null) => h("button", { className: "asset", "aria-pressed": String(pressed), title: `${x.name}${x.under ? `, ${x.under}` : ""}`, onclick: onclick || (() => go("assets", { asset: x.id })) }, icon(x.kind), h("span", { textContent: x.name }), h("small", { textContent: x.under || money(x.value) }));
  //: Where something is from where you stand: "Chestnut St at Fillmore St · 240 m north-east".
  function whereText(at) {
    const here = me(), dx = at.x - here.x, dz = at.z - here.z, d = Math.hypot(dx, dz);
    const dir = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(Math.atan2(dx, -dz) / (Math.PI / 4) + 8) % 8];
    const street = crossAt(at.x, at.z) || "off the mapped streets";
    return `${street} · ${d < 15 ? "right by you" : `${d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`} ${dir} of you`}`;
  }

  // ---- the pages ------------------------------------------------------------------------------------
  function you(w, p, st, worth) {
    const rep = w.creditReport ? w.creditReport(p.id) : null, own = assetsOf(w, p, st);
    const stats = tile("How you are", bar("Health", st.vitals.health, "#e2483d"), bar("Stamina", st.vitals.stamina, "#e8a33b"), bar("Strength", st.vitals.strength, "#3c8fd6"),
      h("table", {}, row("Job", st.job ? `${st.job.title}, ${money(st.job.pay)}/h` : "none"), row("Home", homeLine(st)), row("Where", st.where), row("Carrying", `${st.carry.kg} of ${st.carry.capacity} kg`)));
    const figs = h("div", { className: "figs" }, ...[["Balance", money(worth.cash)], ["You own", money(worth.owned)], ["You owe", money(worth.owing)], ["Credit score", rep ? `${rep.score} · ${rep.band}` : "—"]]
      .map(([k, v]) => h("div", { className: "fig" }, h("small", { textContent: k }), h("b", { textContent: v }))));
    const owned = tile("What you own", own.length ? h("div", { className: "assets" }, ...own.slice(0, 10).map((x) => assetCard(x))) : note("No car, home, building or business of your own yet."),
      own.length > 10 ? act(`All ${own.length}`, () => { go("assets"); return null; }) : null);
    ui.story ??= p.backstory || "";
    const box = h("textarea", { maxLength: BACKSTORY_MAX, placeholder: "Who are you in this city? Other players can read this.", value: ui.story, oninput: (e) => { ui.story = e.target.value; } });
    for (const k of ["keydown", "keyup", "keypress"]) box.addEventListener(k, (e) => e.stopPropagation());
    const story = tile("Your story", box, h("div", { style: "display:flex;gap:8px;align-items:center;margin-top:6px" },
      act("Save", () => send("set_backstory", { text: ui.story }).then((r) => { if (r.ok) { ui.story = r.backstory; notify("Your story is saved: other players see it on your name."); } return r; }), true),
      h("small", { className: "note", textContent: "Shown to other players. The city's people are never told it." })));
    return [figs, h("div", { className: "cols" }, stats, owned, story)];
  }
  function business(w, p, st) {
    const out = [];
    out.push(tile("Your job", st.job ? h("table", {}, row("Role", st.job.title), row("Pay", `${money(st.job.pay)} an hour`), row("At", address(st.job.place?.name) || "your workplace"), row("On shift", st.clocked ? "yes" : "no"),
      row("Earned this year", money(st.ytd.wages))) : note("No job. The Shop's Jobs tab lists who is hiring near you."), act("See jobs", () => { openSide("online"); getSide().cat = "jobs"; drawSide(); api.close(); return null; })));
    const mine = st.businesses || [];
    for (const b of mine) {
      const wk = b.week;
      out.push(tile(`${b.name} — ${R.stores.kinds[b.kind]?.name || b.kind}`, h("table", {}, row("Till", money(b.balance || 0)), row("Staff", String((b.staff || []).length)),
        row("Last week", wk ? `${money(wk.sales)} sales, ${wk.profit >= 0 ? "profit" : "loss"} ${money(Math.abs(wk.profit))}` : "first week not closed yet"), row("Reputation", `${Math.round(b.reputation)} of 100`)),
        h("div", {}, act("Manage", () => { openSide("business"); Object.assign(getSide(), { biz: b.id, tab: "overview" }); drawSide(); api.close(); return null; }, true),
          act("Books", () => { openSide("business"); Object.assign(getSide(), { biz: b.id, tab: "books" }); drawSide(); api.close(); return null; }))));
    }
    if (!mine.length) out.push(tile("Your businesses", note("None yet. Lease a vacant storefront or buy a shop: the Shop's Business tab explains how."), act("Business tab", () => { openSide("online"); getSide().cat = "business"; drawSide(); api.close(); return null; })));
    return [h("div", { className: "cols" }, ...out)];
  }
  function finances(w, p, st, worth) {
    const bank = tile("Bank account", h("table", {}, row("Balance", money(worth.cash)), row("FasTrak prepaid", st.fastrak ? money(worth.fastrak) : "no tag"), row("Earned this year", money(st.ytd.wages)), row("Tax held back", money(st.ytd.withheld)),
      h("tr", { className: "sum" }, h("td", { textContent: "Net worth" }), h("td", { className: worth.net < 0 ? "neg" : "", textContent: money(worth.net) }))));
    const credit = tile("Credit", ...finance().creditTile());
    const recent = w.ledger.journal.filter((e) => e.lines.some(([a]) => a === p.account)).slice(-14).reverse();
    const history = tile("Recent history", recent.length ? h("table", {}, ...recent.map((e) => { const amount = e.lines.find(([a]) => a === p.account)[1];
      return h("tr", {}, h("td", { textContent: `${String(e.kind).replace(/^mint:/, "").replace(/_/g, " ")}${e.memo ? `: ${e.memo}` : ""}`.slice(0, 60) }), h("td", { className: amount < 0 ? "neg" : "", textContent: money(amount) })); })) : note("Nothing yet."));
    // The city's laws set the rates you pay: what is in force, what is being voted on, and a measure of your own.
    return [h("div", { className: "cols" }, bank, credit, tile("Bills and fines", ...legacy.bills(w, p)), tile("Taxes", ...legacy.taxes(w, p)), tile("City laws and votes", ...legacy.laws(w, p)), history)];
  }
  function assets(w, p, st) {
    const own = assetsOf(w, p, st);
    // The building you stand beside: who owns it, what it is worth and taxed, and buying or selling it.
    const beside = tile("The building beside you", ...legacy.here(w, p));
    if (!own.length) return [note("Nothing of your own yet. A car from the dealership, a home from the Shop's Real estate, the building beside you, a business from a vacant storefront."),
      h("div", { className: "cols" }, beside, tile("Cars: dealership, FasTrak, lending", ...legacy.car(w, p)))];
    const cur = own.find((x) => x.id === ui.asset) || own[0];
    const detail = [h("table", {}, row("Worth", money(cur.value)), cur.under ? row(cur.kind === "vehicle" ? "Plate" : "Address", cur.under) : null,
      cur.at ? row("Where it is now", `${cur.at.how} · ${whereText(cur.at)}`) : row("Where it is now", cur.kind === "vehicle" ? (cur.a.custody === "impounded" ? "Impounded: pay its tickets to get it back" : cur.a.custody !== "owner" ? `With someone else (${cur.a.custody})` : "Not parked anywhere on record") : "—"))];
    if (cur.kind === "vehicle") detail.push(h("table", {}, row("Driven", `${Math.round(cur.a.attrs.odometer_km || 0)} km`), row("Fuel", `${Math.round(cur.a.attrs.fuel_l ?? 0)} L`), cur.spot?.metered ? row("Meter paid until", new Date(cur.spot.paid_until).toLocaleTimeString()) : null),
      cur.spot?.metered ? act("Pay the meter an hour", () => send("pay_meter", { vehicle: cur.id, hours: 1 })) : null);
    if (cur.kind === "home") detail.push(act("Customize the interior", () => { editHome(cur.id); return null; }, true));
    if (cur.kind === "business") detail.push(act("Manage", () => { openSide("business"); Object.assign(getSide(), { biz: cur.id, tab: "overview" }); drawSide(); api.close(); return null; }, true));
    return [h("div", { className: "assets" }, ...own.map((x) => assetCard(x, x.id === cur.id, () => { ui.asset = x.id; redraw(); }))),
      h("div", { className: "cols" }, tile(`${cur.name}${cur.under ? ` · ${cur.under}` : ""}`, ...detail), beside, tile("Cars: dealership, FasTrak, lending", ...legacy.car(w, p)))];
  }
  function relationships(w, p) {
    const list = w.relationships ? w.relationships(p.id) : [];
    const colour = (name) => `hsl(${[...String(name)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 360, 7)} 45% 42%)`;
    const group = (title, items, empty) => tile(title, ...(items.length ? items.map((x) => h("div", { className: "rel" }, h("i", { style: `background:${colour(x.name)}`, textContent: String(x.name).split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase() }),
      h("div", {}, h("b", { textContent: x.name }), h("small", { textContent: [x.detail, x.since ? `since ${new Date(x.since).toLocaleDateString()}` : null].filter(Boolean).join(" · ") || (x.kind === "player" ? "A player" : "Lives in the city") })),
      h("em", { textContent: x.relation }))) : [note(empty)]));
    const work = list.filter((x) => ["your boss", "your employee", "your lawyer", "your banker"].includes(x.relation));
    const players = list.filter((x) => x.kind === "player" && !work.includes(x));
    const met = list.filter((x) => x.kind === "resident" && !work.includes(x));
    const here = (peers?.() || []).filter((q) => !players.some((x) => x.id === q.pid)).map((q) => ({ id: q.pid, name: q.name, kind: "player", relation: "in your party", detail: w.players.get(q.pid)?.backstory || null }));
    return [h("div", { className: "cols" }, group("Friends and players", [...players, ...here], "No friends yet: click another player, or their name in the messages, to add them."),
      group("Work and services", work, "Nobody yet: a boss when you take a job, staff when you run a business, a lawyer or a banker when you use one."),
      group("People of the city", met, "Nobody yet. Open the messages and click someone in the street to talk: talk a few times and they know you."),
      tile("Family", note("No family on record. Households are the city's residents' for now.")),
      // Who is out of doors round you now: a name opens who they are, and a box to talk to them.
      tile("People near you now", ...legacy.people(w, p)))];
  }

  //: The whole window: the head, the five buttons, and the page they pick.
  function draw(panel, w, p, close) {
    const st = w.cmd_status.call(w, p.id), worth = wealthOf(R, st), img = portrait();
    const head = h("div", { className: "me" }, h("div", { className: "face", style: img ? `background-image:url(${img})` : "" }),
      h("div", {}, h("h2", { textContent: st.name || p.name || "You" }), h("div", { className: "worth" }, h("span", { className: worth.net < 0 ? "neg" : "", textContent: money(worth.net) }), h("small", { textContent: "net worth" }))), close);
    const tabs = h("div", { className: "ptabs", role: "tablist" }, ...TABS.map(([k, label]) => h("button", { textContent: label, "aria-pressed": String(ui.tab === k), onclick: () => go(k) })));
    const body = ui.tab === "business" ? business(w, p, st) : ui.tab === "finances" ? finances(w, p, st, worth) : ui.tab === "assets" ? assets(w, p, st) : ui.tab === "relationships" ? relationships(w, p) : you(w, p, st, worth);
    const keepFocus = document.activeElement?.tagName === "TEXTAREA" && panel.contains(document.activeElement);
    if (keepFocus) return;   // typing your story: the window is left as it is until you are done
    // Typing to someone on Relationships: the page is drawn again as the city moves, and the box keeps the cursor.
    const typing = document.activeElement?.matches?.(".talk input") && panel.contains(document.activeElement), top = panel.scrollTop;
    panel.replaceChildren(head, tabs, ...body.filter(Boolean));
    if (typing) { const box = panel.querySelector(".talk input"); if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } panel.scrollTop = top; }
  }
  return { draw, open: (tab) => { ui.tab = tab; ui.legacy = null; }, state: ui };
}
