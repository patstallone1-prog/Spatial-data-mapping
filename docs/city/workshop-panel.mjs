// The repair bay, played (workshop.mjs keeps the rules; workshop-3d.mjs draws the car on its lift).
//
// The screen is the job: along the top, the steps of a repair (talk, inspect, diagnose, parts, fit,
// secure, test, release), the one you are on lit and the ones done ticked; on the right, the job
// card -- what the customer said, the next thing to do, the tools and the parts shelf, what you
// have found and the bill. Every point on the car you can work is a numbered pin: hover it and it
// says what it is, what fastens it and how it stands. Tools and parts are dragged off the shelf onto
// a pin (or clicked, then the pin clicked). Nothing is refused for being out of order: a step that
// is unlikely to tell you anything says so, and is done anyway -- the reading is that the area
// looks fine.

import { CHECKS, CIRCUITS, MOUNTS, REPAIRS, SHOP_LIMIT, SITES, canWorkBay, totalBill } from "./workshop.mjs";
import { workshopScene } from "./workshop-3d.mjs";
import { paintOf } from "./vehicles.mjs";

//: What each point on the car is, in a line a newcomer understands.
export const SITE_INFO = {
  wing: "The left front wing panel: where a replacement fender seats.",
  rail: "The bolt along the wing's top edge, into the inner rail.",
  sill: "The bolt at the wing's lower bracket, by the door.",
  arch: "The plastic clip holding the wing to the wheel-arch liner.",
  ground: "The body earth stud: the battery's return path bolts to the body here.",
  lug: "The ring terminal on the end of the ground strap.",
  socket: "The power relay's socket in the fuse box.",
  coil: "The relay's coil terminal: the control feed that switches it.",
  load: "The relay's load terminal: the switched output to the car.",
};
const PANEL_SITES = ["wing", "rail", "sill", "arch"], ELECTRIC_SITES = ["ground", "lug", "socket", "coil", "load"];
//: The tools on the board: what each does and where it is any use.
export const TOOLS = [
  { id: "light", name: "Inspection light", icon: "🔦", does: "Look a panel, clip or mount over.", good: PANEL_SITES },
  { id: "meter", name: "Multimeter", icon: "📟", does: "Measure the voltage at a stud, lug or terminal.", good: ELECTRIC_SITES },
  ...[...new Set(Object.values(MOUNTS))].map((name) => ({ id: name, name, icon: { "Socket wrench": "🔧", "Trim clip pliers": "✂️", "Terminal crimper": "🗜️", "Terminal insertion tool": "🪛" }[name] || "🔧", does: "Secure a connection with it.", fasten: true })),
  { id: "scan", name: "Functional check", icon: "✅", does: "Power the car up and test the repair.", anywhere: true },
];
const ORIENTATIONS = [["wheel opening down", "Arch cut-out at the bottom"], ["bare contact inward", "Bare metal face to the body"], ["keyway forward", "Locating key to the front"], ["reversed", "Turned the other way round"]];
const STEPS = [["talk", "Talk"], ["inspect", "Inspect"], ["diagnose", "Diagnose"], ["parts", "Parts"], ["fit", "Fit"], ["secure", "Secure"], ["test", "Test"], ["release", "Release"]];
const STEP_VIEW = { talk: "overview", inspect: "left", diagnose: "overview", parts: "overview", fit: "left", secure: "left", test: "overview", release: "overview" };

const STYLE = `
#city-bay{position:fixed;inset:0;z-index:31;background:#121d22;color:#eef2f0;font:14px/1.42 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;grid-template-rows:auto auto 1fr;user-select:none}
#city-bay *{box-sizing:border-box}
#city-bay button{font:inherit;color:inherit;background:#26383f;border:1px solid #3f585f;padding:7px 11px;border-radius:8px;cursor:pointer}
#city-bay button:hover{border-color:#f1c46b}#city-bay button:focus-visible{outline:2px solid #f1c46b;outline-offset:1px}
#city-bay .primary{background:#f1c46b;color:#162127;border-color:#f1c46b;font-weight:650}
#city-bay .quiet{background:transparent;border-color:transparent;color:#b9c8c6}
#city-bay header{display:flex;align-items:center;gap:14px;padding:10px 16px;background:#1b2a30;border-bottom:1px solid #2f444b}
#city-bay header .title{flex:1;min-width:0}#city-bay header .title b{font-size:17px}#city-bay header .title span{color:#9fb3b1;margin-left:8px}
#city-bay header .total{font-variant-numeric:tabular-nums;color:#f1c46b;font-weight:650}
#city-bay .steps{display:flex;gap:4px;padding:8px 16px;background:#16242a;border-bottom:1px solid #2a3d43;overflow-x:auto}
#city-bay .step{display:flex;align-items:center;gap:7px;padding:6px 11px 6px 7px;border-radius:999px;background:#1f3036;border:1px solid #2f454c;white-space:nowrap;color:#a9bbb9}
#city-bay .step i{font-style:normal;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#2d4148;font-size:12px;font-weight:700}
#city-bay .step.done{color:#cfe8d7}#city-bay .step.done i{background:#3b8f5d;color:#fff}
#city-bay .step.now{border-color:#f1c46b;color:#fff;background:#2b3a33}#city-bay .step.now i{background:#f1c46b;color:#162127}
#city-bay .work{display:grid;grid-template-columns:minmax(0,1fr) 380px;min-height:0}
#city-bay .scene{position:relative;min-height:0;overflow:hidden;background:#263943}
#city-bay .views{position:absolute;left:12px;top:12px;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100% - 24px)}
#city-bay .views button{background:#172a31e6;border-color:#365058;padding:6px 10px;font-size:13px}
#city-bay .views button.on{border-color:#f1c46b;color:#f1c46b}
#city-bay .legend{position:absolute;left:12px;bottom:12px;background:#152429d9;border-radius:8px;padding:6px 10px;color:#b9c8c6;font-size:12px}
#city-bay .pins{position:absolute;inset:0;pointer-events:none}
#city-bay .pin{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:5px}
#city-bay .pin b{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#173038;border:2px solid #7fc7bf;color:#fff;font-size:12px;box-shadow:0 2px 8px #0008}
#city-bay .pin span{background:#132227e6;padding:2px 7px;border-radius:6px;font-size:12px;white-space:nowrap;opacity:0;transition:opacity .12s}
#city-bay .pin:hover span,#city-bay .pin.label span{opacity:1}
#city-bay .pin.sel b{border-color:#f1c46b;background:#3b3218}
#city-bay .pin.done b{border-color:#5fc489;background:#1f4a32}
#city-bay .pin.hint b{animation:bay-pulse 1.1s ease-in-out infinite}
#city-bay .pin.target b{border-color:#f1c46b;transform:scale(1.25)}
#city-bay .pin.away{opacity:.35}
@keyframes bay-pulse{0%,100%{box-shadow:0 0 0 0 #f1c46b99}50%{box-shadow:0 0 0 9px #f1c46b00}}
#city-bay .card{position:absolute;z-index:3;width:270px;background:#132328f5;border:1px solid #3c565d;border-radius:10px;padding:10px 12px;box-shadow:0 10px 28px #0009;pointer-events:none}
#city-bay .card h4{margin:0 0 4px;font-size:14px}#city-bay .card p{margin:4px 0;color:#c7d5d3;font-size:13px}
#city-bay .card .state{font-size:12px;color:#9fb3b1}#city-bay .card .good{color:#7fd6a0}#city-bay .card .low{color:#f1c46b}
#city-bay .toasts{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;width:min(560px,calc(100% - 24px))}
#city-bay .toast{background:#18292ef2;border:1px solid #3c565d;border-left:4px solid #7fc7bf;border-radius:8px;padding:8px 12px;box-shadow:0 6px 18px #0007;width:100%}
#city-bay .toast.warn{border-left-color:#f1c46b}#city-bay .toast.good{border-left-color:#5fc489}#city-bay .toast.bad{border-left-color:#e06b5f}
#city-bay .busy{position:absolute;right:14px;top:14px;background:#172a31e6;border-radius:8px;padding:6px 11px;color:#f1c46b}
#city-bay .pick{position:absolute;z-index:4;background:#132328f8;border:1px solid #f1c46b;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;min-width:230px;box-shadow:0 10px 28px #000a}
#city-bay .pick b{font-size:13px}#city-bay .pick button{text-align:left}#city-bay .pick small{display:block;color:#9fb3b1;font-size:12px}
#city-bay aside{overflow:auto;background:#182a30;border-left:1px solid #2a3d43;padding:14px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin}
#city-bay aside section{background:#1e3238;border:1px solid #2c444b;border-radius:10px;padding:10px 12px}
#city-bay aside h3{margin:0 0 7px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#9fb3b1}
#city-bay .quote{font-style:italic;color:#e8eee9}
#city-bay .next{border-color:#f1c46b66;background:#2a3428}
#city-bay .next p{margin:0 0 8px}
#city-bay .tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
#city-bay .tile{display:flex;gap:8px;align-items:center;padding:8px;border-radius:9px;background:#26393f;border:1px solid #3b545b;cursor:grab;touch-action:none;text-align:left;min-height:52px}
#city-bay .tile:hover{border-color:#f1c46b}#city-bay .tile.held{border-color:#f1c46b;background:#3b3a26}
#city-bay .tile .ico{font-size:20px;line-height:1}#city-bay .tile b{display:block;font-size:13px}#city-bay .tile small{display:block;color:#9fb3b1;font-size:11.5px;line-height:1.25}
#city-bay .tile.empty{opacity:.55}
#city-bay .chips{display:flex;flex-wrap:wrap;gap:6px}
#city-bay .chips button.on{border-color:#f1c46b;color:#f1c46b}
#city-bay .log{display:flex;flex-direction:column;gap:5px;max-height:190px;overflow:auto}
#city-bay .log div{font-size:13px;color:#d3dfdd;border-left:3px solid #3f585f;padding-left:8px}
#city-bay .log div.bad{border-left-color:#e06b5f}#city-bay .log div.good{border-left-color:#5fc489}
#city-bay .bill .row{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;border-top:1px solid #2c444b}
#city-bay .bill .row:first-child{border-top:0}#city-bay .bill .sum{font-weight:700;color:#f1c46b}
#city-bay .note{color:#9fb3b1;font-size:12.5px;margin:4px 0}
#city-bay .ghost{position:fixed;z-index:40;pointer-events:none;transform:translate(14px,14px);background:#132328f2;border:1px solid #f1c46b;border-radius:9px;padding:6px 10px;max-width:280px;box-shadow:0 8px 22px #0009}
#city-bay .ghost small{display:block;font-size:12px;color:#c7d5d3}#city-bay .ghost .low{color:#f1c46b}#city-bay .ghost .good{color:#7fd6a0}
#city-bay .desk{overflow:auto;padding:24px max(16px,calc((100vw - 860px)/2));grid-row:2 / span 2}
#city-bay .desk h2{margin:0 0 4px;font-size:24px}#city-bay .desk h3{margin:22px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:#9fb3b1}
#city-bay .jobs{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
#city-bay .job{background:#1e3238;border:1px solid #2f474e;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px}
#city-bay .job b{font-size:15px}#city-bay .job .meta{color:#9fb3b1;font-size:13px}
#city-bay .job .bar{height:6px;border-radius:3px;background:#2d4148;overflow:hidden}#city-bay .job .bar i{display:block;height:100%;background:#f1c46b}
#city-bay .desk input{font:inherit;color:inherit;background:#132328;border:1px solid #3f585f;border-radius:8px;padding:7px 10px;width:100%;max-width:420px;user-select:text}
@media(max-width:820px){#city-bay .work{grid-template-columns:1fr;grid-template-rows:minmax(240px,48%) 1fr}#city-bay aside{border-left:0;border-top:1px solid #2a3d43}#city-bay header{padding:8px 10px}}
`;

export function workshopPanel({ R, h, doc, THREE, send, notify, self, getView, makeCar, visitors, placeArg }) {
  let root, place, scene, timer, frame = 0, sidebar, order, currentSite = null, busy = false, generation = 0;
  let held = null, drag = null, ghost = null, card = null, picker = null, view = "overview", pins = {}, focusStep = null;
  const log = [];
  const staff = () => canWorkBay(self(), place, getView().bizAt(place.id));
  const btn = (label, fn, cls = "") => h("button", { textContent: label, onclick: fn, className: cls });
  const name = (o) => R.vehicles.models[o.model]?.name || o.model;
  const money = (credits) => R.fmt(R.money(credits));

  // ---- opening, closing, the keys ------------------------------------------------------------------
  function close() {
    generation++;
    clearInterval(timer); cancelAnimationFrame(frame);
    scene?.dispose(); scene = null;
    root?.remove(); root = null;
    order = null; busy = false; held = null; drag = null;
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("keyup", key, true);
  }
  function key(e) {
    e.stopImmediatePropagation();
    if (e.type === "keydown" && e.key === "Escape") {
      e.preventDefault();
      if (picker) { picker.remove(); picker = null; }
      else if (held) { held = null; controls(); }
      else close();
    }
  }
  function open(pl) {
    if (root) close();
    place = placeArg(pl);
    log.length = 0;
    if (!doc.getElementById("city-bay-style")) doc.head.append(h("style", { id: "city-bay-style", textContent: STYLE }));
    root = h("section", { id: "city-bay", "aria-label": "Mechanic workshop" });
    doc.body.append(root);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    desk();
    timer = setInterval(() => {
      if (!root || busy) return;
      if (!self() || Math.hypot(self().x - place.x, self().z - place.z) > R.jobs.workplace_reach_m) { close(); return; }
      if (order) {
        const latest = getView().workOrders.get(order.vehicle);
        if (latest && latest.id === order.id && latest.revision > order.revision) { order = latest; scene.update(order); controls(); }
        else if (!latest && !staff() && order.payer !== self().account) desk();
      }
    }, 2000);
  }

  // ---- talking to the server --------------------------------------------------------------------------
  //: Toasts over the car: what came of what you did.
  function toast(text, kind = "") {
    const box = root?.querySelector(".toasts");
    if (!box || !text) return;
    const t = h("div", { className: `toast ${kind}`, textContent: text });
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), kind === "warn" ? 6500 : 5000);
  }
  const tone = (m) => (/does not|incomplete|wasted|not seat|no unsecured|without a passing|fault may|high resistance|0 V switched|absent/i.test(m) ? "bad" : /secured|seated|passed|supported|drawn from|released|good|closes|intact/i.test(m) ? "good" : "");
  async function command(cmd, args) {
    if (busy) return;
    busy = true;
    const gen = generation;
    const tag = root?.querySelector(".busy");
    try {
      const delay = (order?.readyAt || 0) - Date.now();
      if (tag) { tag.hidden = false; tag.textContent = "Working…"; }
      if (cmd === "workshop_action" && args.action !== "withdraw" && delay > 0) await new Promise((ok) => setTimeout(ok, Math.min(delay + 40, 2500)));
      if (gen !== generation || !root) return;
      const r = await send(cmd, { place, ...args });
      if (gen !== generation || !root) return;
      if (!r.ok) {
        toast(r.error, "bad");
        if (order) { order = getView().workOrders.get(order.vehicle) || order; scene.update(order); controls(); } else { notify(r.error); desk(); }
        return;
      }
      if (r.message) { log.unshift({ text: r.message, kind: tone(r.message) }); toast(r.message, tone(r.message)); }
      if (r.order) {
        if (!order || order.id !== r.order.id) show(r.order);
        else { order = r.order; scene.update(order); controls(); }
      }
    } finally {
      if (gen === generation) { busy = false; const t = root?.querySelector(".busy"); if (t) t.hidden = true; }
    }
  }
  function act(action, extra = {}) {
    return command("workshop_action", { vehicle: order.vehicle, orderId: order.id, revision: order.revision, site: currentSite, action, ...extra });
  }

  // ---- the service desk ----------------------------------------------------------------------------
  function header(o = null) {
    return h("header", {},
      h("div", { className: "title" }, h("b", { textContent: o ? `${name(o)} · ${o.plate}` : place.name || "Auto service" }), o ? h("span", { textContent: `${o.customer}${o.npc ? "" : " (player)"} · ${place.name || "Auto service"}` }) : null),
      o ? h("span", { className: "total", textContent: `Bill ${R.fmt(totalBill(o))} of ${money(SHOP_LIMIT)} authorized` }) : null,
      o ? btn("Service desk", desk) : null,
      btn("Close (Esc)", close));
  }
  const progress = (o) => STEPS.filter(([id]) => stepDone(o, id)).length / STEPS.length;
  function desk() {
    order = null; held = null;
    cancelAnimationFrame(frame);
    scene?.dispose(); scene = null;
    const p = self(), view = getView();
    const rows = [...view.workOrders.values()].filter((o) => o.shop === String(place.id) && (staff() || o.payer === p.account)).sort((a, b) => Number(b.active) - Number(a.active));
    const list = h("div", { className: "desk" }, h("h2", { textContent: "Service desk" }),
      h("p", { className: "note", textContent: staff() ? "Pick a car to work on. In the bay, drag tools and parts from the shelf onto the numbered points on the car." : "Leave your car with the mechanics here, or collect it." }),
      h("h3", { textContent: "Cars in the shop" }));
    const jobs = h("div", { className: "jobs" });
    for (const o of rows) jobs.append(h("div", { className: "job" },
      h("b", { textContent: `${name(o)} · ${o.plate}` }),
      h("span", { className: "meta", textContent: `${o.customer} · ${o.active ? `${Math.round(progress(o) * 100)}% done · ${R.fmt(totalBill(o))} so far` : o.verified ? "Repaired and released" : "Collected unfinished"}` }),
      o.active ? h("div", { className: "bar" }, h("i", { style: `width:${Math.round(progress(o) * 100)}%` })) : null,
      btn(o.active ? (staff() ? "Work on it" : "See the job") : "Invoice", () => show(o), o.active ? "primary" : "")));
    list.append(rows.length ? jobs : h("p", { className: "note", textContent: "No cars checked in here yet." }));
    const owned = view.registry.held(p.account).filter((a) => a.kind === "vehicle" && a.owner === p.account && (a.attrs.serviceFault || (a.attrs.condition ?? 100) < 100) && p.driving?.vehicle !== a.id && !view.workOrders.get(a.id)?.active &&
      Math.hypot((p.parked[a.id] || a.attrs).x - place.x, (p.parked[a.id] || a.attrs).z - place.z) <= R.jobs.workplace_reach_m);
    list.append(h("h3", { textContent: "Your cars parked here" }));
    if (owned.length) {
      const concern = h("input", { placeholder: "What did you notice? (optional)", maxLength: 180, "aria-label": "Symptoms for the mechanic" });
      list.append(concern);
      const cards = h("div", { className: "jobs", style: "margin-top:8px" });
      for (const a of owned) cards.append(h("div", { className: "job" }, h("b", { textContent: `${name(a.attrs)} · ${a.attrs.plate}` }), h("span", { className: "meta", textContent: `Condition ${Math.round(a.attrs.condition ?? 100)}%` }),
        btn(`Book it in · up to ${money(SHOP_LIMIT)}`, () => command("workshop_intake", { vehicle: a.id, concern: concern.value }), "primary")));
      list.append(cards);
    } else list.append(h("p", { className: "note", textContent: "Park a damaged car of yours at this shop to book it in." }));
    if (staff()) {
      list.append(h("h3", { textContent: "Customers at the counter" }));
      const here = visitors(place).filter((v) => !view.workOrders.get(v.vehicle)?.active && !(view.harm.get(v.vehicle)?.servicedAt > view.now - 7 * 86400000));
      const cards = h("div", { className: "jobs" });
      for (const v of here) cards.append(h("div", { className: "job" }, h("b", { textContent: v.name }), h("span", { className: "meta", textContent: `${name(v)} · ${v.plate}` }),
        btn("Write a work order", () => command("workshop_intake", { vehicle: v.vehicle, visitor: v }), "primary")));
      list.append(here.length ? cards : h("p", { className: "note", textContent: "No customers with a car parked here right now." }));
    } else list.append(h("p", { className: "note", textContent: "Clock in here as a mechanic to work on customers' cars." }));
    list.append(h("p", {}, btn("Refresh", desk)));
    root.replaceChildren(header(), list);
  }

  // ---- the bay -------------------------------------------------------------------------------------
  //: Whether step ``id`` of the job is done.
  function stepDone(o, id) {
    const spec = REPAIRS[o.fault];
    return id === "talk" ? o.interview || !o.partsRequired : id === "inspect" ? Object.keys(o.checks || {}).length > 0 : id === "diagnose" ? o.diagnosed : id === "parts" ? Boolean(o.issued) || o.seated
      : id === "fit" ? o.seated : id === "secure" ? o.seated && o.mounts.length >= spec.mounts.length : id === "test" ? o.verified : !o.active;
  }
  const stepNow = (o) => STEPS.find(([id]) => !stepDone(o, id))?.[0] || "release";
  function show(o) {
    cancelAnimationFrame(frame);
    scene?.dispose();
    order = o; currentSite = null; held = null; focusStep = null; pins = {};
    log.length = 0;
    for (const reading of Object.values(o.checks || {})) log.push({ text: reading, kind: tone(reading) });
    for (const r of (o.reports || []).slice(-4)) log.push({ text: r, kind: tone(r) });
    const host = h("div", { className: "scene" });
    sidebar = h("aside", {});
    const steps = h("nav", { className: "steps", "aria-label": "Steps of the repair" });
    root.replaceChildren(header(o), steps, h("div", { className: "work" }, host, sidebar));
    const colour = o.npc ? paintOf(o.model, o.shade ?? 0.5) : R.vehicles.models[o.model]?.colour || "#8d9ca1";
    scene = workshopScene(THREE, host, o, colour, makeCar, (id) => { currentSite = id; controls(); }, () => {});
    const pinLayer = h("div", { className: "pins" });
    for (const [i, id] of Object.keys(SITES).entries()) {
      const pin = h("div", { className: "pin", "data-site": id, role: "button", tabIndex: 0, "aria-label": SITES[id] }, h("b", { textContent: String(i + 1) }), h("span", { textContent: SITES[id] }));
      pin.onpointerenter = () => showCard(id, pin);
      pin.onpointerleave = () => hideCard();
      pin.onclick = () => clickPin(id);
      pin.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); clickPin(id); } };
      pins[id] = pin; pinLayer.append(pin);
    }
    const views = h("div", { className: "views", role: "toolbar", "aria-label": "Camera" },
      ...[["overview", "Whole car", "The car from the front corner"], ["front", "Front", "Bumper, lights and bonnet"], ["left", "Left wing & wheel", "The left front wing, its bolts and the wheel arch"],
        ["engine", "Engine bay", "Looking into the engine bay: the earth stud, the fuse box and relay"], ["under", "Underneath", "Raise the lift and look underneath"], ["rear", "Rear", "The back of the car"]]
        .map(([id, label, title]) => h("button", { textContent: label, title, className: view === id ? "on" : "", "data-view": id, onclick: () => look(id) })));
    host.append(pinLayer, views, h("div", { className: "legend", textContent: "Drag to turn · scroll to zoom · hover a number to see what it is" }), h("div", { className: "toasts" }), h("div", { className: "busy", hidden: true }));
    look(STEP_VIEW[stepNow(o)] === "left" && o.fault !== "fender" ? "engine" : STEP_VIEW[stepNow(o)]);
    const tick = () => { frame = requestAnimationFrame(tick); placePins(); };
    tick();
    controls();
    if (!o.interview && o.active && staff()) toast(`${o.customer} is waiting at the counter. Start by asking what happened.`);
  }
  function look(id) {
    view = id;
    scene.view(id);
    for (const b of root.querySelectorAll(".views button")) b.classList.toggle("on", b.dataset.view === id);
  }
  //: Every frame: the pins follow their points on the screen.
  function placePins() {
    if (!scene) return;
    for (const [id, pin] of Object.entries(pins)) {
      const p = scene.project(id);
      if (!p || !p.front) { pin.style.display = "none"; continue; }
      pin.style.display = "";
      pin.style.left = `${p.x}px`; pin.style.top = `${p.y}px`;
    }
  }
  //: Which points matter now: the ones the next step works on (pulsing), done ones ticked.
  function pinStates() {
    const o = order, spec = REPAIRS[o.fault], now = focusStep || stepNow(o);
    const hint = new Set(now === "inspect" ? [] : now === "fit" || now === "parts" ? [] : now === "secure" ? spec.mounts.filter((s) => !o.mounts.includes(s)) : []);
    if (held) for (const id of Object.keys(SITES)) if (likely(held, id).good) hint.add(id);
    for (const [id, pin] of Object.entries(pins)) {
      pin.classList.toggle("done", o.mounts.includes(id));
      pin.classList.toggle("sel", id === currentSite);
      pin.classList.toggle("hint", hint.has(id));
      pin.classList.toggle("away", Boolean(held) && !hint.has(id));
      pin.querySelector("b").textContent = o.mounts.includes(id) ? "✓" : String(Object.keys(SITES).indexOf(id) + 1);
    }
  }
  //: How likely ``thing`` (a tool or a part on the shelf) is to do any good at ``site``: never a
  //: refusal, only a word before you try.
  function likely(thing, site) {
    const o = order, spec = REPAIRS[o.fault];
    if (thing.kind === "part") {
      const part = REPAIRS[thing.id];
      if (o.seated) return { good: false, text: "A replacement is already seated. You can still try a trial fit." };
      return part.seat === site ? { good: true, text: `This is where a ${part.part.toLowerCase()} seats.` } : { good: false, text: `A ${part.part.toLowerCase()} does not seat here: a trial fit will show it.` };
    }
    const t = TOOLS.find((x) => x.id === thing.id);
    if (t.anywhere) return { good: true, text: "Works anywhere on the car." };
    if (t.good) return t.good.includes(site) ? { good: true, text: `A good place for the ${t.name.toLowerCase()}.` } : { good: false, text: `The ${t.name.toLowerCase()} will tell you little here: the area will most likely look fine.` };
    if (!o.seated) return { good: false, text: "Nothing new is fitted here yet: there is no connection to secure. You can still try." };
    if (!spec.mounts.includes(site)) return { good: false, text: "Not one of this repair's connections: probably nothing to secure." };
    if (o.mounts.includes(site)) return { good: false, text: "Already secured." };
    return MOUNTS[site] === t.id ? { good: true, text: "Right tool for this fastener." } : { good: false, text: "Wrong kind of fastener for this tool: unlikely to engage." };
  }
  function showCard(id, pin) {
    hideCard();
    const o = order, spec = REPAIRS[o.fault];
    const state = o.mounts.includes(id) ? "Secured" : o.seated && spec.mounts.includes(id) ? "Not yet secured" : CHECKS[Object.keys(CHECKS).find((c) => CHECKS[c].site === id)] ? "A place to test" : "";
    const hostBox = pin.parentElement.getBoundingClientRect(), r = pin.getBoundingClientRect();
    const fit = held ? likely(held, id) : null;
    card = h("div", { className: "card" }, h("h4", { textContent: `${Object.keys(SITES).indexOf(id) + 1} · ${SITES[id]}` }), h("p", { textContent: SITE_INFO[id] }),
      h("div", { className: "state", textContent: [`Fastened with: ${MOUNTS[id]}`, CIRCUITS[id] ? `Circuit: ${CIRCUITS[id]}` : null, state].filter(Boolean).join(" · ") }),
      fit ? h("p", { className: fit.good ? "good" : "low", textContent: `${held.label}: ${fit.text}` }) : h("p", { className: "state", textContent: "Drag a tool or part here, or pick one on the shelf and click this point." }));
    const left = Math.min(hostBox.width - 280, Math.max(8, r.left - hostBox.left + 18)), top = Math.min(hostBox.height - 150, Math.max(8, r.top - hostBox.top - 10));
    card.style.left = `${left}px`; card.style.top = `${top}px`;
    pin.parentElement.parentElement.append(card);
  }
  function hideCard() { card?.remove(); card = null; }

  // ---- using a tool or a part on a point -------------------------------------------------------------
  function clickPin(id) {
    currentSite = id;
    scene.select(id, false);
    if (held) { const thing = held; held = null; use(thing, id); }
    else controls();
  }
  //: A tool or a part brought to ``site``: what it does there. A low chance is said, then tried.
  function use(thing, site, at = null) {
    hideCard();
    if (!order?.active || !staff()) { toast("Clock in here as a mechanic to work on this car.", "warn"); return; }
    currentSite = site;
    const chance = likely(thing, site);
    if (!chance.good) toast(`${chance.text} Trying anyway.`, "warn");
    if (thing.kind === "part") { choose(`Fit the ${REPAIRS[thing.id].part.toLowerCase()}: which way round?`, ORIENTATIONS.map(([o, d]) => [o, d]), (orientation) => act("fit", { site, part: thing.id, orientation }), at || pins[site]); return; }
    if (thing.id === "light") return act("check", { site, check: "inspect" });
    if (thing.id === "meter") return act("check", { site, check: ["socket", "coil", "load"].includes(site) ? "output" : "drop" });
    if (thing.id === "scan") return act("verify");
    if (CIRCUITS[site] || order.fault !== "fender") {
      if (CIRCUITS[site]) { choose("Which lead does this terminal take?", Object.values(CIRCUITS).map((c) => [c, { "Body return": "The earth path back to the battery", "Control feed": "The small wire that switches the relay", "Switched output": "The heavy wire out to the car" }[c]]), (circuit) => act("attach", { site, tool: thing.id, circuit }), at || pins[site]); return; }
    }
    return act("attach", { site, tool: thing.id });
  }
  //: A little chooser by the point (which way round a part goes, which lead).
  function choose(title, options, then, near) {
    picker?.remove();
    const hostEl = root.querySelector(".scene"), box = hostEl.getBoundingClientRect(), r = near?.getBoundingClientRect?.() || { left: box.left + box.width / 2, top: box.top + box.height / 2 };
    picker = h("div", { className: "pick", role: "dialog", "aria-label": title }, h("b", { textContent: title }),
      ...options.map(([value, detail]) => h("button", { onclick: () => { picker.remove(); picker = null; then(value); } }, value.charAt(0).toUpperCase() + value.slice(1), detail ? h("small", { textContent: detail }) : "")),
      btn("Cancel", () => { picker.remove(); picker = null; }, "quiet"));
    picker.style.left = `${Math.min(box.width - 250, Math.max(8, r.left - box.left + 20))}px`;
    picker.style.top = `${Math.min(box.height - 260, Math.max(8, r.top - box.top - 20))}px`;
    hostEl.append(picker);
    picker.querySelector("button")?.focus();
  }
  //: Dragging a tile off the shelf: a label follows the pointer and says what would happen where.
  function grab(e, thing) {
    if (e.button !== 0) return;
    e.preventDefault();
    hideCard();
    drag = { thing, x: e.clientX, y: e.clientY, moved: false };
    const move = (ev) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return;
      drag.moved = true;
      if (!ghost) { ghost = h("div", { className: "ghost" }); root.append(ghost); }
      ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`;
      const site = siteUnder(ev.clientX, ev.clientY);
      for (const [id, pin] of Object.entries(pins)) pin.classList.toggle("target", id === site);
      const fit = site && likely(thing, site);
      ghost.replaceChildren(h("b", { textContent: thing.label }), h("small", { className: fit ? (fit.good ? "good" : "low") : "", textContent: site ? `${SITES[site]}: ${fit.text}` : "Drop it on a numbered point on the car" }));
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const d = drag; drag = null; ghost?.remove(); ghost = null;
      for (const pin of Object.values(pins)) pin.classList.remove("target");
      if (!d) return;
      if (!d.moved) { held = held?.id === thing.id && held.kind === thing.kind ? null : thing; controls(); if (held) toast(`${thing.label} in hand: click a point on the car (Esc puts it down).`); return; }
      const site = siteUnder(ev.clientX, ev.clientY);
      if (site) use(thing, site, pins[site]);
      else if (thing.id === "scan" && overScene(ev.clientX, ev.clientY)) act("verify");
      else if (thing.kind === "part" && overScene(ev.clientX, ev.clientY)) toast(`Drop the ${REPAIRS[thing.id].part.toLowerCase()} on the point where it seats (hover the numbers to find it).`, "warn");
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  const overScene = (x, y) => { const r = root.querySelector(".scene")?.getBoundingClientRect(); return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  //: The point under the pointer, or the nearest within reach of it.
  function siteUnder(x, y) {
    let best = null, bd = 46;
    for (const [id, pin] of Object.entries(pins)) {
      if (pin.style.display === "none") continue;
      const r = pin.getBoundingClientRect(), d = Math.hypot(r.left + 12 - x, r.top + 12 - y);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  // ---- the job card ------------------------------------------------------------------------------------
  function nextStep(o) {
    const spec = REPAIRS[o.fault], now = stepNow(o), first = o.customer.split(" ")[0];
    switch (now) {
      case "talk": return { text: `${first} is waiting. Ask what happened: it tells you where to look.`, button: ["Ask what happened", () => act("ask")] };
      case "inspect": return { text: "Look for the fault. Drag the inspection light onto a panel or clip, or the multimeter onto a stud or terminal. Hover the numbers to see what each point is.", button: ["Show the engine bay", () => look("engine")], alt: ["Show the left wing", () => look("left")] };
      case "diagnose": return { text: "Write down what you think is wrong (below). You can also skip this and fit a part: it is then a provisional diagnosis." };
      case "parts": case "fit": return { text: `Fit the replacement: drag the ${REPAIRS[o.suspected || o.fault].part.toLowerCase()} from the parts shelf onto the point where it seats. You choose which way round as you drop it.` };
      case "secure": { const left = spec.mounts.filter((s) => !o.mounts.includes(s)); return { text: `Secure each connection: drag the right tool onto the pulsing points (${left.map((s) => SITES[s].toLowerCase()).join(", ")}). Hover a point to see what fastens it.`, button: ["Show me", () => { look(o.fault === "fender" ? "left" : "engine"); }] }; }
      case "test": return { text: "Test the repair: drag the functional check onto the car, or press the button.", button: ["Run the functional check", () => act("verify")] };
      default: return o.active ? { text: "The repair passed. Release the car and issue the invoice.", button: ["Release and invoice", () => act("release")] } : { text: o.verified ? "Done: the car has gone back to its owner." : "The customer collected the car before it was finished." };
    }
  }
  function controls() {
    if (!order || !sidebar) return;
    const o = order, spec = REPAIRS[o.fault], work = o.active && staff();
    // The steps along the top.
    const nav = root.querySelector(".steps"), now = stepNow(o);
    nav.replaceChildren(...STEPS.map(([id, label], i) => h("button", { className: `step${stepDone(o, id) ? " done" : ""}${id === (focusStep || now) ? " now" : ""}`, title: stepDone(o, id) ? `${label}: done` : `${label}: click to look at it`,
      onclick: () => { focusStep = id === now ? null : id; look(STEP_VIEW[id] === "left" && o.fault !== "fender" && id !== "inspect" ? "engine" : STEP_VIEW[id]); controls(); } }, h("i", { textContent: stepDone(o, id) ? "✓" : String(i + 1) }), label)));
    root.querySelector("header .total")?.replaceChildren(`Bill ${R.fmt(totalBill(o))} of ${money(SHOP_LIMIT)} authorized`);
    const parts = [];
    // What the customer said.
    parts.push(h("section", {}, h("h3", { textContent: o.customer }), h("div", { className: "quote", textContent: o.interview || !o.partsRequired ? `“${o.concern || spec.complaint}”` : "Waiting at the counter to tell you what happened." }),
));
    // The next thing to do.
    const n = nextStep(o);
    parts.push(h("section", { className: "next" }, h("h3", { textContent: o.active ? "Next" : "Job" }), h("p", { textContent: n.text }),
      work && n.button ? h("div", { className: "chips" }, btn(n.button[0], n.button[1], "primary"), n.alt ? btn(n.alt[0], n.alt[1]) : null) : null,
      held ? h("p", { className: "note", textContent: `In hand: ${held.label}. Click a point on the car, or press Esc.` }) : null));
    if (work) {
      // The tools.
      const tools = h("div", { className: "tiles" }, ...TOOLS.map((t) => tile({ kind: "tool", id: t.id, label: t.name }, t.icon, t.name, t.does)));
      parts.push(h("section", {}, h("h3", { textContent: "Tools · drag onto the car" }), tools));
      // The diagnosis: never required, always on offer.
      const evidence = (id) => { const r = o.checks[REPAIRS[id].test]; return r === CHECKS[REPAIRS[id].test].failed ? "Your reading points here." : r ? "Your reading here was normal." : "No reading taken for this yet."; };
      parts.push(h("section", {}, h("h3", { textContent: o.diagnosed ? `Diagnosis: ${REPAIRS[o.suspected || o.fault].part}` : "Diagnosis" }),
        h("div", { className: "chips" }, ...Object.entries(REPAIRS).map(([id, r]) => h("button", { className: o.suspected === id ? "on" : "", title: evidence(id), textContent: r.part, onclick: () => act("diagnose", { part: id }) }))),
        h("p", { className: "note", textContent: o.diagnosed ? "Change it any time. Hover a choice to see what your readings say." : `Writing it down costs ${money(10)} of labour. Hover a choice to see what your readings say.` })));
      // The parts shelf.
      const bins = getView().workshopStock.get(o.shop) || {};
      const shelf = h("div", { className: "tiles" }, ...Object.entries(REPAIRS).map(([id, r]) => {
        const stock = bins[id] ?? 0;
        const t = tile({ kind: "part", id, label: r.part }, id === "fender" ? "🚗" : id === "ground" ? "➰" : "🔌", r.part, `${stock} in the bin · ${money(r.price)} · seats at the ${SITES[r.seat].toLowerCase()}, ${r.orientation}`);
        if (!stock) { t.classList.add("empty"); t.title = "The bin is empty: order more below."; }
        return t;
      }));
      const empty = Object.entries(bins).filter(([, n]) => !n);
      parts.push(h("section", {}, h("h3", { textContent: "Parts shelf · drag onto the car" }), shelf,
        ...empty.map(([id]) => h("p", { style: "margin:6px 0 0" }, btn(`Order more: ${REPAIRS[id]?.part || `${SITES[id.slice(6)]} hardware`}`, () => act("restock", { part: id })))),
        o.seated ? null : h("p", { className: "note", textContent: "The part comes off the shelf as you fit it; a trial fit in the wrong place costs nothing." })));
    }
    // What you have found.
    parts.push(h("section", {}, h("h3", { textContent: "Findings" }), log.length ? h("div", { className: "log" }, ...log.slice(0, 12).map((x) => h("div", { className: x.kind, textContent: x.text }))) : h("p", { className: "note", textContent: "Nothing yet. Readings and results appear here." })));
    // The bill.
    const bill = h("section", { className: "bill" }, h("h3", { textContent: o.active ? "Running bill" : `Invoice ${o.bill || ""}` }),
      ...o.lines.map((line) => h("div", { className: "row" }, h("span", { textContent: line.label }), h("span", { textContent: R.fmt(line.amount) }))),
      h("div", { className: "row sum" }, h("span", { textContent: "Total" }), h("span", { textContent: R.fmt(totalBill(o)) })),
      o.bonus ? h("p", { className: "note", textContent: `Your bonus: ${R.fmt(o.bonus)}` }) : null);
    parts.push(bill);
    if (o.active && (o.payer === self().account || (o.npc && staff()))) parts.push(h("section", {},
      work && !o.verified ? btn("Release now (unchecked)", () => act("release")) : null, " ",
      btn("Hand back and bill work so far", () => act("withdraw"), "quiet"),
      work && !o.verified ? h("p", { className: "note", textContent: "Releasing before the functional check bills the work so far; the fault may still be there." }) : null));
    sidebar.replaceChildren(...parts);
    pinStates();
  }
  function tile(thing, icon, title, detail) {
    const t = h("button", { className: `tile${held?.kind === thing.kind && held.id === thing.id ? " held" : ""}`, title: `${title}: ${detail}. Drag it onto the car, or click it and then a point.` },
      h("span", { className: "ico", textContent: icon }), h("span", {}, h("b", { textContent: title }), h("small", { textContent: detail })));
    t.onpointerdown = (e) => grab(e, thing);
    t.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); held = thing; controls(); toast(`${thing.label} in hand: choose a point (Tab to the numbers).`); } };
    return t;
  }
  return { open, close };
}
