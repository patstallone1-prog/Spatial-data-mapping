import { clockTime } from "./clock.mjs";
import { cutModel, cutPieces, CUT_COUNTS } from "./kitchen-cuts.mjs";
// The kitchen, played: an animated back-of-house you walk around in (docs/city/kitchen-3d.mjs
// builds it; docs/city/kitchen.mjs keeps the rules and the world's side).
//
// You are the cook. Walk with WASD or the arrows, or click where to go. Click a bin on the front
// counter, or the fridge, freezer or shelves behind you, and enter a quantity; click the
// counter to put it down, a station to cook it, the pass to send it out, the bin to throw it away.
// Put something down on top of food already on the counter -- or a little off it -- and it is
// centred onto it: that is how a burger is built, bun, then patty, then cheese. Put it down far
// from anything and it is a new thing of its own, so several can be made side by side.
//
// A stack is one product: the first click on it selects all of it (pick it up, plate it, bin
// it); a second click selects the one ingredient you clicked inside it; a third picks that up.
//
// Tickets are on the rail at the top, the recipe and the plates on the right. Put a finished
// product on the pass for each dish on the ticket and serve. The Lab tab is the same kitchen
// with no ticket: what is on the pass is the test dish.
//
// view.mjs calls this through a few hooks: actions (the action bar), todo, and open.

import { batchSeconds, chain, cookedPart, displayAmount, doneness, donenessWord, ingCost, needs, recipeOf, recognizeDish, scorePlate, targetOf, waitTipShare, wholeUnits } from "./kitchen.mjs";
import { appliance, dial, levels, applianceLabel } from "./kitchen-appliances.mjs";
import { DOUGH_FORMS, doughDimensions, doughMesh, workableDough } from "./dough.mjs";
import { createKitchenScene } from "./kitchen-3d.mjs";
import { cookingSteps } from "./menu-dish.mjs";

const STIRRED = ["saute", "wok", "boil"];
const HEAT = ["grill", "fry", "boil", "saute", "bake", "micro", "toast", "steam", "wok", "brew", "pour"];
const SNAP_M = 0.14;   // dropped within this of a product, it is centred onto it
const STYLE = `
#city-kitchen{position:fixed;inset:0;z-index:30;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#f1f5f9;user-select:none;background:#111}
#city-kitchen canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none}
#city-kitchen .glass{background:rgba(17,24,39,.82);-webkit-backdrop-filter:blur(10px) saturate(1.15);backdrop-filter:blur(10px) saturate(1.15);border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.32)}
#city-kitchen button{font:inherit;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.09);color:inherit;border-radius:7px;padding:4px 9px;cursor:pointer}
#city-kitchen button:hover:not(:disabled){background:rgba(255,255,255,.18)}
#city-kitchen button:disabled{opacity:.45;cursor:default}
#city-kitchen button.primary,#city-kitchen .tabs button[aria-pressed=true]{background:#2f6fe4;border-color:#2f6fe4;color:#fff}
#city-kitchen button.on{background:rgba(47,111,228,.35);border-color:#2f6fe4}
#city-kitchen input{box-sizing:border-box;font:inherit;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.28);color:inherit;border-radius:6px;padding:3px 6px;user-select:text}
#city-kitchen h4{margin:6px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a9b6c4}
#city-kitchen .note{color:#a9b6c4;font-size:12px}
#city-kitchen .top{position:absolute;left:10px;right:10px;top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 10px}
#city-kitchen .top b{font-size:14px}
#city-kitchen .top .grow{flex:1}
#city-kitchen .rail{position:absolute;left:10px;top:62px;right:330px;display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px}
#city-kitchen .ticket{flex:0 0 172px;background:#f7f3e3;color:#222;border-radius:4px;padding:6px 8px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.4);border-top:6px solid #c8c0a5}
#city-kitchen .ticket.sel{outline:3px solid #2f6fe4}
#city-kitchen .ticket .who{font-weight:600;font-size:12px}
#city-kitchen .ticket ul{margin:3px 0 4px;padding-left:16px}
#city-kitchen .ticket .mod{color:#b3261e;font-weight:700;font-size:11px}
#city-kitchen .ticket .bar{height:6px;border-radius:3px;background:rgba(0,0,0,.18);overflow:hidden;position:relative}
#city-kitchen .ticket .bar i{position:absolute;left:0;top:0;bottom:0}
#city-kitchen .side{position:absolute;right:10px;top:62px;width:300px;max-height:calc(100% - 150px);overflow:auto;padding:10px;scrollbar-width:thin}
#city-kitchen .recipe ol{margin:2px 0;padding-left:18px;color:#a9b6c4}
#city-kitchen .recipe li.done{color:#7fd39a}
#city-kitchen .steps{margin:6px 0 2px}
#city-kitchen .steps summary{cursor:pointer;font-weight:600;color:#dbe6f1}
#city-kitchen .steps ol{margin:4px 0;padding-left:20px;color:#c9d4df;line-height:1.35}
#city-kitchen .steps li{margin:2px 0}
#city-kitchen .steps li .at{color:#8fa3b6;font-size:11px}
#city-kitchen .chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
#city-kitchen .result{border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:8px;margin:6px 0;background:rgba(0,0,0,.25)}
#city-kitchen .stars{color:#f6c445;font-size:16px;letter-spacing:1px}
#city-kitchen .hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:7px 12px;display:flex;gap:8px;align-items:center;max-width:min(860px,calc(100% - 24px));flex-wrap:wrap;justify-content:center}
#city-kitchen .tip{position:absolute;pointer-events:none;padding:3px 7px;border-radius:6px;background:rgba(0,0,0,.72);font-size:12px;white-space:nowrap;transform:translate(12px,12px)}
#city-kitchen .cook{position:absolute;width:74px;transform:translate(-50%,-100%);pointer-events:none}
#city-kitchen .cook .bar{height:7px;border-radius:4px;background:rgba(0,0,0,.55);position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.25)}
#city-kitchen .cook .ok{position:absolute;top:0;bottom:0;background:rgba(46,157,88,.85)}
#city-kitchen .cook .burn{position:absolute;top:0;bottom:0;right:0;background:rgba(200,50,40,.8)}
#city-kitchen .cook .at{position:absolute;top:-1px;bottom:-1px;width:3px;background:#fff}
#city-kitchen .cook .lbl{font-size:11px;text-align:center;text-shadow:0 1px 2px #000;margin-bottom:2px;white-space:nowrap}
#city-kitchen .pop{position:absolute;padding:8px;transform:translate(-50%,-110%);display:flex;flex-direction:column;gap:4px;min-width:150px}
#city-kitchen .pop.list{max-height:360px;overflow:auto;transform:translate(-50%,-50%);min-width:250px}
#city-kitchen .pop .row{display:flex;justify-content:space-between;gap:8px;text-align:left}
#city-kitchen .sheet{position:absolute;left:50%;top:62px;transform:translateX(-50%);width:min(760px,calc(100% - 24px));max-height:calc(100% - 90px);overflow:auto;padding:12px}
#city-kitchen table{border-collapse:collapse;width:100%}
#city-kitchen td{padding:3px 4px;border-top:1px solid rgba(255,255,255,.08);vertical-align:top}
#city-kitchen .loading{position:absolute;inset:0;display:grid;place-items:center;font-size:15px;color:#a9b6c4}
#city-kitchen-tip{position:fixed;z-index:31;right:16px;bottom:120px;width:280px;padding:10px;border-radius:12px;background:rgba(17,24,39,.9);color:#f1f5f9;border:1px solid rgba(255,255,255,.14);font:13px system-ui,sans-serif}
#city-kitchen-tip button{font:inherit;margin:3px 3px 0 0;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.09);color:inherit;border-radius:7px;padding:4px 8px;cursor:pointer}
#city-kitchen .drag{position:absolute;z-index:6;pointer-events:none;transform:translate(14px,14px);padding:5px 10px;border-radius:8px;background:rgba(17,24,39,.92);border:1px solid #f1c46b;color:#fff;font-weight:600;white-space:nowrap}
#city-kitchen .dock{position:absolute;left:10px;top:196px;width:236px;display:flex;flex-direction:column;gap:6px;max-height:calc(100% - 270px);overflow:auto;scrollbar-width:thin}
#city-kitchen .dial{padding:5px 8px}
#city-kitchen .dock .fold{align-self:flex-start;padding:3px 9px;font-size:12px}
#city-kitchen .dial .head{display:flex;justify-content:space-between;align-items:baseline;gap:6px}
#city-kitchen .dial .head b{font-size:12.5px}#city-kitchen .dial .read{font-size:11.5px;color:#cfd8e3;font-variant-numeric:tabular-nums}
#city-kitchen .dial .gauge{height:3px;border-radius:2px;background:rgba(255,255,255,.12);margin:4px 0;position:relative;overflow:hidden}
#city-kitchen .dial .gauge i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#3d7bd9,#e0a526,#d9472b)}
#city-kitchen .dial .gauge s{position:absolute;top:-1px;bottom:-1px;width:2px;background:#fff;text-decoration:none}
#city-kitchen .seg{display:flex;gap:3px}#city-kitchen .seg button{flex:1;padding:2px 0;font-size:11.5px}
#city-kitchen .seg button[aria-pressed=true]{background:#2f6fe4;border-color:#2f6fe4;color:#fff}
#city-kitchen .temps{position:absolute;inset:0;pointer-events:none}
#city-kitchen .temp{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;padding:2px 7px;border-radius:999px;background:rgba(17,24,39,.85);border:1px solid rgba(255,255,255,.18);font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
#city-kitchen .temp i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:middle}
#city-kitchen .cook{pointer-events:auto;cursor:pointer}
#city-kitchen .hint .chip{padding:4px 9px}
#city-kitchen .hint .chip.primary{box-shadow:0 0 0 2px rgba(47,111,228,.35)}
#city-kitchen .recipe li button{margin-left:6px;padding:0 6px;font-size:11px}
@media (max-width:900px){ #city-kitchen .dock{top:auto;bottom:120px;width:200px;max-height:30%}  #city-kitchen .side{top:auto;bottom:70px;width:auto;left:10px;max-height:34%} #city-kitchen .rail{right:10px} }`;

export function kitchenPanel(api) {
  const { R, h, send, notify, self, getView, placeArg, district, me, clock, doc = document, THREE, loadModel, asset } = api;
  const K = R.kitchen, ING = K.ingredients, P = K.processes;
  const fmt = (x) => R.fmt(x);
  const iname = (id) => ING[id]?.name || id;
  let st = null, el = null, raf = 0, poll = 0, uid = 0, gid = 0, tipEl = null, last = 0;
  const seenNews = new Set(), seenMeals = new Set();

  // ---- where a kitchen can be worked ------------------------------------------------------------------
  const placeById = (id) => (district.places || []).find((pl) => String(pl.id) === String(id));
  function kitchenHere(p) {
    const w = getView(), here = me();
    if (!w?.kitchenKind || !p) return null;
    const reach = (R.jobs.workplace_reach_m || 40) * 1.2;
    if (p.clocked && p.job?.place) {
      const pl = placeById(p.job.place.id);
      if (pl && Math.hypot(here.x - pl.x, here.z - pl.z) < reach && w.kitchenKind(placeArg(pl))) return { pl, role: "staff" };
    }
    for (const b of w.biz?.values?.() || []) {
      if (b.owner !== p.account || b.status !== "open") continue;
      const pl = placeById(b.place.id);
      if (pl && Math.hypot(here.x - pl.x, here.z - pl.z) < reach && w.kitchenKind(placeArg(pl))) return { pl, role: "owner" };
    }
    return null;
  }
  function actions(p) {
    const k = kitchenHere(p);
    if (!k || el) return [];
    return [{ id: "kitchen", label: k.role === "owner" ? "Your kitchen: the line, the lab, the pantry" : "Work the kitchen: tickets are up", key: "", run: () => open(k.pl) }];
  }
  function todo(p) {
    const out = [];
    if (!p) return out;
    for (const n of p.kitchen_news || []) if (!seenNews.has(`${n.at}:${n.text}`)) { seenNews.add(`${n.at}:${n.text}`); notify(n.text); }
    for (const m of p.meals || []) {
      if (m.tipped || seenMeals.has(m.id)) continue;
      out.push({ label: `Tip ${m.cook_name.split(" ")[0]} for your ${m.dishes.map((d) => R.items[d]?.name.toLowerCase() || "meal").join(" and ")}`, sub: `${m.name}: made to ${m.score}/100`, run: () => tipCard(m) });
    }
    const k = kitchenHere(p);
    if (k && !el) out.push({ label: k.role === "owner" ? "Your kitchen" : "Tickets are up in the kitchen", sub: "The line, the lab and the pantry", run: () => open(k.pl), now: k.role !== "owner" });
    return out;
  }
  function tipCard(m) {
    tipEl?.remove();
    const price = m.dishes.reduce((s, d) => s + (R.items[d]?.price || 0), 0);
    const give = async (share) => {
      const r = await send("tip_cook", { meal: m.id, amount: Math.round(price * share) });
      seenMeals.add(m.id); tipEl?.remove(); tipEl = null;
      notify(r.ok ? (share ? `Tipped ${fmt(Math.round(price * share))}.` : "No tip this time.") : r.error);
    };
    tipEl = h("div", { id: "city-kitchen-tip" }, h("b", { textContent: `${m.cook_name} made your ${m.dishes.map((d) => R.items[d]?.name.toLowerCase()).join(" and ")}` }),
      h("div", { textContent: `${"★".repeat(Math.round(m.score / 20))}${"☆".repeat(5 - Math.round(m.score / 20))} ${m.score}/100`, style: "color:#f6c445;margin:4px 0" }),
      h("div", {}, ...[0, 0.1, 0.15, 0.2].map((s) => h("button", { textContent: s ? `${Math.round(s * 100)}% (${fmt(Math.round(price * s))})` : "No tip", onclick: () => give(s) }))));
    doc.body.append(tipEl);
  }

  // ---- opening and closing --------------------------------------------------------------------------
  const keys = new Set();
  function onKey(e) {
    if (!el) return;
    e.stopImmediatePropagation();   // the city's own keys stay quiet while you cook
    if (e.target instanceof HTMLInputElement && e.key !== "Escape") return;
    const k = e.key.toLowerCase();
    if (e.type === "keyup") { keys.delete(k); return; }
    if (k === "escape") { e.preventDefault(); if (st.pop) { st.pop = null; hud(); } else close(); return; }
    if (st.pop || st.pouring) return;
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { e.preventDefault(); keys.add(k); st.walk = null; return; }
    if (e.repeat) return;
    if (k === "b" && !held()) { e.preventDefault(); openPantry(); return; }
    // Over a bin, a number takes that many (pieces, or portions of what is weighed).
    if (/^[1-9]$/.test(k) && st.hoverBin && !held()) { e.preventDefault(); const ing = st.hoverBin; walkTo(frontOf(st.scene.bins.find((b) => b.ing === ing)?.x ?? st.scene.chef.position.x), () => takeQty(ing, Math.min(+k, st.k.pantry[ing] || 0))); return; }
    if (k === "e" || k === " ") { e.preventDefault(); keyUse(); return; }
    if (k === "delete" || k === "backspace" || k === "q") { e.preventDefault(); keyBin(); }
  }
  async function open(pl) {
    if (el) return;
    if (!doc.getElementById("city-kitchen-style")) doc.head.append(h("style", { id: "city-kitchen-style", textContent: STYLE }));
    const place = placeArg(pl);
    const r = await send("kitchen_open", { place });
    if (!r.ok) { notify(r.error); return; }
    if (!st || st.place.id !== place.id || r.kitchen.serverPrep) {
      st?.scene?.dispose();
      st = { place, tab: "line", items: new Map(), groups: new Map(), held: null, sel: null, ticket: null, extras: new Set(), lab: { name: "" }, results: [], passOrder: [], walk: null, pop: null, canvas: h("canvas", { tabIndex: 0 }) };
    }
    st.k = r.kitchen; st.applianceOffset=st.k.applianceNow-Date.now();
    el = h("section", { id: "city-kitchen", "aria-label": "Kitchen" }, st.canvas);
    doc.body.append(el);
    addEventListener("keydown", onKey, true); addEventListener("keyup", onKey, true); addEventListener("resize", resize);
    if (!st.scene) {
      const loading = h("div", { className: "loading", textContent: "Setting up the kitchen…" });
      el.append(loading);
      const menu = st.k.menu.slice(0, 8).map((d) => ({ name: R.items[d]?.name || d, price: fmt(st.k.prices[d] || 0) }));
      st.scene = await createKitchenScene(THREE, { canvas: st.canvas, kind: st.k.kind, stations: st.k.stations.map((s) => s.id), kit: { loadModel, asset,npcStore:api.npcStore }, title: st.k.name, menu });
      await st.scene.setBins(binList(), R);
      st.bowl = await st.scene.kenney("bowl-broth", 0.19);
      st.plates = await st.scene.kenney("plate", 0.24);
      st.bunTop = await st.scene.kenney("burger#bun-top", 0.11);
      st.scene.chef.position.set(0, 0, st.scene.walk.z1);
      st.scene.chef.rotation.y = Math.PI;
      st.canvas.addEventListener("pointerdown", onPointer);
      st.canvas.addEventListener("pointermove", (e) => { onHover(e); onDrag(e); });
      st.canvas.addEventListener("pointerup", onRelease);
      st.canvas.addEventListener("pointerleave", () => { st.hover = null; });
      st.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      if(st.k.serverPrep) await restoreBoard();
      loading.remove();
    }
    if (!el) return;
    st.canvas.focus();
    resize();
    hud();
    clearInterval(poll);
    poll = setInterval(refresh, 4000);
    last = performance.now();
    const loop = (t) => { const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t; if (el) { step(dt); raf = requestAnimationFrame(loop); } };
    raf = requestAnimationFrame(loop);
  }
  function close() {
    el?.remove(); el = null;
    removeEventListener("keydown", onKey, true); removeEventListener("keyup", onKey, true); removeEventListener("resize", resize);
    keys.clear();
    clearInterval(poll); cancelAnimationFrame(raf);
  }
  function resize() { if (el && st?.scene) st.scene.resize(el.clientWidth, el.clientHeight); }
  async function refresh() {
    if (!el || !st || st.sending) return;
    const r = await send("kitchen_state", { place: st.place });
    if (!r.ok) { notify(r.error); if (/clock in|staff only|go to/.test(r.error)) close(); return; }
    const before = st.k.tickets.map((t) => t.id).join();
    st.k = r.kitchen; st.applianceOffset=st.k.applianceNow-Date.now();
    if (st.ticket && !ticketOf(st.ticket)) { st.ticket = null; notify("A customer gave up waiting and left."); }
    if (!st.pop && before !== st.k.tickets.map((t) => t.id).join()) hud(); else hudTop();
  }
  async function run(cmd, args) {
    if (st.sending) return null;
    st.sending = true;
    try {
      const r = await send(cmd, { place: st.place, ...args });
      if (!r.ok) { notify(r.error); return null; }
      if (r.kitchen) st.k = r.kitchen;
      return r;
    } finally { st.sending = false; }
  }
  //: The bins on the front counter: what the menu uses most, a bin each.
  function binList() {
    const count = {};
    for (const d of st.k.menu) for (const c of recipeOf(R, d, st.k.house_menu)?.build || []) count[c.ing] = (count[c.ing] || 0) + 1;
    // (Salt, sugar and the spices are shaken from their jars on the dry shelf, not kept in bins.)
    return Object.entries(count).filter(([i]) => i !== "sugar" && ING[i]?.role !== "spice").sort((a, b) => b[1] - a[1]).map(([i]) => i).slice(0, 10);
  }

  // ---- items and products ----------------------------------------------------------------------------
  // An item is one unit of an ingredient (as cooked so far); a group is a product: items stacked in
  // the order they were put down. Every item is in a group: on the counter, on a station, on the
  // pass, or in the cook's hands.
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  async function newItem(ing, qty) {
    const it = { uid: ++uid, ing, qty, chain: [], ratios: [], q: 1, ratio: 1, last: null };
    it.obj = await st.scene.itemObject(ing, ING[ing]?.role, it);
    mark(it);
    st.items.set(it.uid, it);
    return it;
  }
  async function restoreBoard() {
    const W = st.scene.WORK;
    let index = 0;
    const counter = () =>
      V(
        W.x0 + 0.12 + ((index++ % 7) * (W.x1 - W.x0 - 0.24)) / 6,
        st.scene.COUNTER_Y,
        W.z0 + 0.08 + (Math.floor(index / 7) % 3) * 0.08,
      );
    async function item(c) {
      const it = await newItem(c.ing, c.qty);
      Object.assign(it, {
        lot: c.lot,cut:c.cut,bounds:c.bounds,
        chain: chain(c.p),
        q: c.q ?? 1,
        ratios: c.ratios || [],
        ratio: c.ratio ?? 1,
        batch: c.batch,
        shape: c.shape,
      });
      await relook(it);
      return it;
    }
    const groups = new Map();
    for (const [lot, c] of Object.entries(st.k.board?.lots || {})) {
      const key = c.batch || lot;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(await item({ ...c, lot }));
    }
    for (const list of groups.values()) newGroup(list, "work", counter());
    for (const [ing, qty] of Object.entries(st.k.held || {}))
      if (qty > 0) newGroup([await newItem(ing, qty)], "work", counter());
    for (const [job, j] of Object.entries(st.k.board?.jobs || {})) {
      const slot = onStation(j.station).length,
        lay = st.scene.layout[j.station];
      const g = newGroup(await Promise.all(j.inputs.map(item)), "station", lay.slots[slot] || lay.slots[0]);
      g.station = { id: j.station, slot };
      g.cook = {
        job,startDose:j.startDose,
        proc: j.proc,
        secs: j.secs,
        start: performance.now() - (Date.now() - j.at),
        taps: j.taps,
        need: P.chop.taps,
      };
    }
  }
  function mark(it) {
    it.obj.traverse((m) => { if (m.isMesh) m.userData.item = it.uid; });
    it.h = new THREE.Box3().setFromObject(it.obj).getSize(V(0, 0, 0)).y;
  }
  async function relook(it) {
    const old = it.obj;
    it.obj = await st.scene.itemObject(it.ing, ING[it.ing]?.role, it.bounds?{...it,chain:it.chain.filter(p=>p!=="chop")}:it);
    if(it.bounds)it.obj=cutModel(THREE,it.obj,it.bounds);
    mark(it);
    old.parent?.remove(old);
  }
  function newGroup(items, where, pos) {
    const g = { gid: ++gid, items: items.map((i) => i.uid), at: where, pos: pos.clone(), node: new THREE.Group(), station: null, cook: null };
    st.groups.set(g.gid, g);
    layout(g);
    return g;
  }
  const groupOf = (u) => { for (const g of st.groups.values()) if (g.items.includes(u)) return g; return null; };
  const itemsOf = (g) => g.items.map((u) => st.items.get(u)).filter(Boolean);
  //: Stacks a product's items where it is: each on the one below, centred; a burger gets its lid.
  function layout(g) {
    const node = g.node;
    const previous=node.parent && node.getWorldPosition(V(0,0,0));
    const oldParent=node.parent;
    for (const m of node.children) if (m.userData.shaped) { m.geometry.dispose(); m.material.dispose(); }
    node.clear();
    let y = 0;
    if(g.station?.id==="blender" && g.cook){st.scene.contents.visible=true;g.height=.1;return;}
    if (g.at === "pass" && st.plates) { node.add(st.plates.clone(true)); y = 0.014; }
    const list = itemsOf(g);
    const shown = new Set();
    list.forEach((it, i) => {
      if (it.shape) {
        const key = it.batch || it;
        if (shown.has(key)) return;
        shown.add(key);
        const grams = list.filter(i => (i.batch || i) === key).reduce((n, i) => n + cookedPart(R, { ...i, p: i.chain.join(">") }).grams, 0);
        const mesh = doughMesh(THREE, grams, it.shape, it.chain.includes("bake"));
        mesh.userData = { item: it.uid, shaped: true }; mesh.position.y = y + mesh.scale.y / 2;
        node.add(mesh); y += mesh.scale.y; return;
      }
      if (it.batch && st.bowl) {
        if (shown.has(it.batch)) return;
        shown.add(it.batch);
        const bowl = st.bowl.clone(true);
        bowl.traverse(m => { if (m.isMesh) m.userData.item = it.uid; });
        bowl.position.y = y; node.add(bowl);
        if(it.chain.includes("blend")){
          const liquid=st.scene.contents.clone();liquid.visible=true;liquid.scale.set(.91,.15,.91);
          liquid.position.y=y+.044;liquid.userData.item=it.uid;node.add(liquid);
        }
        y += 0.08;
        return;
      }
      // (Diced or minced: the bits spread in a little heap, not stacked.)
      const grid = it.cut === "dice" ? 4 : it.cut === "mince" ? 5 : 0, gap = it.cut === "mince" ? 0.017 : 0.025;
      it.obj.position.set(grid ? ((i % grid) - (grid - 1) / 2) * gap : 0, grid ? 0 : y, grid ? ((Math.floor(i / grid) % grid) - (grid - 1) / 2) * gap : 0);
      it.obj.rotation.y = i * 0.5;
      node.add(it.obj);
      y += Math.max(0.004, it.h * (list.length > 1 ? 0.8 : 1));
    });
    if (list[0]?.ing === "bun" && list.length > 1 && st.bunTop) { const top = st.bunTop.clone(true); top.position.y = y - 0.004; node.add(top); y += 0.03; }
    if (g.at === "held") { st.scene.holdAt.add(node); node.position.set(0, 0, 0); }
    else { st.scene.scene.add(node); node.position.copy(g.pos); }
    if(previous && oldParent!==node.parent){
      const end=node.position.clone();
      g.motion={from:node.parent.worldToLocal(previous),end,at:performance.now()};
      node.position.copy(g.motion.from);
    }
    g.height = y;
    highlight();
  }
  //: The selection glows: the whole product, then the one item in it.
  function highlight() {
    for (const it of st.items.values()) it.obj.traverse((m) => { if (m.isMesh && m.material.emissive) m.material.emissive.setHex(0x000000); });
    const s = st.sel, g = s && st.groups.get(s.gid);
    if (!g) { st.sel = null; return; }
    for (const it of itemsOf(g)) {
      if (s.uid && it.uid !== s.uid) continue;
      it.obj.traverse((m) => { if (m.isMesh && m.material.emissive) { m.material.emissive.setHex(s.uid ? 0x4a86ff : 0x24509e); m.material.emissiveIntensity = 1; } });
    }
  }
  function drop(g) {
    g.node.parent?.remove(g.node);
    for (const u of g.items) st.items.delete(u);
    st.groups.delete(g.gid);
    st.passOrder = st.passOrder.filter((x) => x !== g.gid);
    if (st.held === g.gid) st.held = null;
    if (st.sel?.gid === g.gid) st.sel = null;
  }
  const held = () => (st.held ? st.groups.get(st.held) : null);
  function hold(g) {
    st.scene.reach();
    st.passOrder = st.passOrder.filter((x) => x !== g.gid);
    g.at = "held"; g.station = null; g.cook = null; st.held = g.gid; st.sel = null;
    layout(g); hud();
    // (A drag from a bin or a dish to somewhere: once it is in hand, on to where it was dropped.)
    if (st.afterHold) { const next = st.afterHold; st.afterHold = null; setTimeout(next, 150); }
  }
  const untouched = (g) => g && g.items.length === 1 && !st.items.get(g.items[0]).shape && !st.items.get(g.items[0]).chain.length;

  // ---- walking ------------------------------------------------------------------------------------
  //: Walk to stand at ``at`` (kept on the floor between the counters), then do ``then``.
  function walkTo(at, then = null) {
    const W = st.scene.walk;
    if(st.pourMotion)return;
    st.walk = { target: V(Math.max(W.x0, Math.min(W.x1, at.x)), 0, Math.max(W.z0, Math.min(W.z1, at.z))), then };
  }
  const frontOf = (x) => V(x, 0, st.scene.walk.z1);
  const backOf = (x) => V(x, 0, st.scene.walk.z0);
  const standAt = (g) => {
    if (g.at === "station") { const lay = st.scene.layout[g.station.id]; return lay.facing > 0 ? backOf(lay.x) : frontOf(lay.x); }
    return frontOf(g.pos.x);
  };
  function step(dt) {
    const S3 = st.scene, chef = S3.chef, W = S3.walk;
    let speed = 0;
    const kx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    const kz = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
    if (kx || kz) {
      const v = 2.3, n = Math.hypot(kx, kz);
      chef.position.x = Math.max(W.x0, Math.min(W.x1, chef.position.x + (kx / n) * v * dt));
      chef.position.z = Math.max(W.z0, Math.min(W.z1, chef.position.z + (kz / n) * v * dt));
      chef.rotation.y = turn(chef.rotation.y, Math.atan2(kx, kz), dt);
      speed = v;
    } else if (st.walk) {
      const d = st.walk.target.clone().sub(chef.position); d.y = 0;
      const len = d.length();
      if (len < 0.04) {
        const then = st.walk.then; st.walk = null;
        // Face the counter you came to.
        chef.rotation.y = chef.position.z > (W.z0 + W.z1) / 2 ? 0 : Math.PI;
        if (then) then();
      } else {
        const v = Math.min(2.6, len * 6 + 0.6);
        chef.position.addScaledVector(d.normalize(), Math.min(len, v * dt));
        chef.rotation.y = turn(chef.rotation.y, Math.atan2(d.x, d.z), dt);
        speed = v;
      }
    }
    // (Stood idle at a pan that is cooking, the cook stirs it.)
    const stirring = !speed && !st.held && [...st.groups.values()].some((g) => g.at === "station" && g.cook?.start && STIRRED.includes(g.cook.proc) && Math.abs(g.pos.x - chef.position.x) < 0.5 && Math.abs(g.pos.z - chef.position.z) < 1);
    S3.pose(dt, { speed, holding: Boolean(st.held || st.pouring), chopping: (st.chopping || 0) > performance.now(), stirring, pouring: Boolean(st.pourMotion) });
    // Cooking: colours move with the time on the heat; steam and sizzle rise.
    const now = performance.now();
    // The knife: in the cook's right hand while chopping, back on the board after.
    const knife = S3.layout.board?.knife, hands = S3.hands();
    if (knife) {
      knife.userData.rest ||= knife.position.clone();
      if ((st.chopping || 0) > now && hands) { knife.position.copy(knife.parent.worldToLocal(hands.right.clone())); knife.rotation.z = -0.25; }
      else if ((st.chopping || 0) > now) { const swing = Math.max(0, Math.min(1, (st.chopping - now) / 450)); knife.position.copy(knife.userData.rest); knife.position.y += Math.abs(Math.sin(swing * Math.PI * 2)) * 0.08; knife.rotation.z = 0.45 * Math.sin(swing * Math.PI * 4); }
      else { knife.position.copy(knife.userData.rest); knife.rotation.z = 0; }
    }
    for (const g of st.groups.values()) {
      const c = g.cook;
      if (!c?.start) continue;
      const ratio = cookRatio(g);
      if (HEAT.includes(c.proc) && now - (c.tinted || 0) > 120) {
        c.tinted = now;
        for (const it of itemsOf(g)) S3.tint(it.obj, it.ing, { chain: [...it.chain, c.proc], ratio });
      }
      if (Math.random() < dt * 28) {
        const at = V(g.pos.x, g.pos.y + (g.height || 0.03), g.pos.z);
        if (["boil", "steam", "brew"].includes(c.proc)) S3.emit(at, "steam");
        else if (["grill", "fry", "wok", "saute", "toast", "bake"].includes(c.proc)) S3.emit(at, ratio > 1.65 ? "steam" : "sizzle");
      }
    }
    for(const [id,lay] of Object.entries(S3.layout)){
      const a=appliance(id,st.k.appliances?.[id],machineNow());
      for(const ring of lay.rings||[])ring.material.emissiveIntensity=Math.max(0,(a.value-21)/90);
    }
    for(const g of st.groups.values())if(g.motion){
      const m=g.motion,t=Math.min(1,(now-m.at)/400),smooth=t*t*(3-2*t);
      g.node.position.lerpVectors(m.from,m.end,smooth);g.node.position.y+=Math.sin(Math.PI*t)*.055;
      if(t===1)g.motion=null;
    }
    if(st.pourMotion){
      const {g,start,target}=st.pourMotion,t=Math.min(1,(now-start)/850),jug=S3.jug;
      S3.scene.attach(jug);
      // (In the cook's hands, over the bowl; tipped as it pours.)
      if (hands) jug.position.copy(hands.left).lerp(hands.right, 0.5).add(V(0, 0.04, 0));
      else jug.position.copy(target).add(V(.09,.16+.035*Math.sin(t*Math.PI),0));
      jug.rotation.z=Math.sin(t*Math.PI)*1.45;
      S3.stream.visible=t>.2 && t<.8;S3.stream.position.copy(target).add(V(0,.065,0));
      if(t===1){
        S3.dockJug();S3.contents.visible=false;S3.stream.visible=false;g.at="work";g.station=null;g.pos=target.clone();g.node.visible=true;
        const existing=[...st.groups.values()].find(other=>other!==g && other.at==="work" && other.pos.distanceTo(target)<.025);
        if(existing){existing.items.push(...g.items);g.node.removeFromParent();st.groups.delete(g.gid);layout(existing);}else layout(g);
        st.pourMotion=null;st.pouring=null;hud();
      }
    }
    S3.stepPuffs(dt);
    S3.frame(dt);
    S3.render();
    overlay(now);
  }
  const turn = (a, b, dt) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, dt * 12); };

  // ---- clicks -----------------------------------------------------------------------------------------
  const ndc = (e) => { const r = st.canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1]; };
  const itemMeshes = () => { const out = []; for (const g of st.groups.values()) if (g.at !== "held") g.node.traverse((m) => m.isMesh && m.userData.item && out.push(m)); return out; };
  function onHover(e) {
    if (!st?.scene) return;
    const hit = st.scene.pick(...ndc(e), itemMeshes());
    st.hover = hit ? { x: e.clientX, y: e.clientY, text: describe(hit) } : null;
    st.hoverBin = hit?.object.userData.hit?.type === "bin" ? hit.object.userData.hit.ing : null;
    st.canvas.style.cursor = hit && hit.object.userData.hit?.type !== "floor" ? "pointer" : "default";
  }
  function describe(hit) {
    const u = hit.object.userData.item;
    if (u) { const it = st.items.get(u), g = groupOf(u); if (it?.batch && g) return `${productName(g)} · ${stateWord(it)}`; return g ? `${g.items.length > 1 ? `${productName(g)}: ` : ""}${iname(it.ing)} (${stateWord(it)})` : ""; }
    const d = hit.object.userData.hit;
    if (d.type === "vessel") return "Preparation bowl "+(d.index+1);
    if (d.type === "bin") return `${iname(d.ing)} · ${displayAmount(R, d.ing, st.k.pantry[d.ing] || 0)} available · click to take ${displayAmount(R, d.ing, quickQty(d.ing))}, Shift-click for more, or keys 1–9`;
    if (d.type === "station") { const s = stationSpec(d.id); return `${s?.name || d.id}: ${s?.does.map((p) => P[p].name.toLowerCase()).join(", ")}`; }
    if (d.type === "store") return `${{ fridge: "Fridge", freezer: "Freezer", dry: "Dry-goods shelves" }[d.kept]}: click to choose`;
    if (d.type === "pass") return "The pass: plates go out from here";
    if (d.type === "work") return st.held ? "Put it down here" : "The work surface";
    if (d.type === "trash") return "The bin";
    return "";
  }
  const stateWord = (it) => (it.chain.length ? it.chain.map((p) => P[p].verb).join(", ") + (it.last && it.last !== "just right" ? `, ${it.last}` : "") : "raw");
  function productName(g) {
    const list = itemsOf(g);
    if (list[0]?.shape && list.every(i => i.shape === list[0].shape)) return `${DOUGH_FORMS[list[0].shape.form]} · ${list[0].shape.span} cm · ${Number(groupGrams(g).toFixed(1))} g`;
    if (list[0]?.batch && list.every(i => i.batch === list[0].batch)) {
      const grams = groupGrams(g);
      const label = list.some(i => i.chain.includes("blend")) ? "Blend" :
        list.some(i => i.ing === "flour") && list.some(i => i.ing === "water") ? "Dough" : "Mixture";
      const baked = list.every(i => i.chain.findLast(step => step !== "cool" && step !== "chill") === "bake");
      return `${baked ? "Baked " + label.toLowerCase() : label} · ${Number(grams.toFixed(2))} g`;
    }
    if (list.length === 1) return `${iname(list[0].ing)} · ${displayAmount(R, list[0].ing, list[0].qty)}`;
    return recognizeDish(R, plateOf(g), st.k.house_menu)?.name || `${list.length} ingredients`;
  }
  //: A press on the kitchen: a click when let go where it was pressed; a drag to somewhere else is
  //: "take this there" -- from a bin (the amount the ticket wants) or a dish, to a station, the
  //: board, the counter, the pass or the bin -- done in one go.
  function onPointer(e) {
    if (e.button !== 0 || !st?.scene || st.fetching || st.sending) return;
    st.pop = null;
    const hit = st.scene.pick(...ndc(e), itemMeshes());
    st.press = { x: e.clientX, y: e.clientY, hit, e, moved: false };
    try { st.canvas.setPointerCapture(e.pointerId); } catch {}
  }
  function onDrag(e) {
    const p = st?.press;
    if (!p || (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 9)) return;
    const from = p.hit && (p.hit.object.userData.item || p.hit.object.userData.hit?.type === "bin") ? p.hit : null;
    if (!from) return;
    p.moved = true;
    let ghost = el.querySelector(".drag");
    if (!ghost) { ghost = h("div", { className: "drag" }); el.append(ghost); }
    const dest = st.scene.pick(...ndc(e), itemMeshes());
    ghost.textContent = `${shortName(from)} → ${dest ? shortName(dest) : "…"}`;
    ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`;
  }
  function onRelease(e) {
    const p = st?.press;
    if (!p) return;
    st.press = null;
    el?.querySelector(".drag")?.remove();
    if (!p.moved) { act(p.hit, p.e); return; }
    dragDo(p.hit, st.scene.pick(...ndc(e), itemMeshes()), e);
  }
  //: A thing in the kitchen in a word or two (for the drag's label).
  function shortName(hit) {
    const u = hit.object.userData.item;
    if (u) { const g = groupOf(u); return g ? productName(g) : "food"; }
    const d = hit.object.userData.hit;
    return d.type === "bin" ? iname(d.ing) : d.type === "station" ? stationSpec(d.id)?.name || d.id : d.type === "vessel" ? `bowl ${d.index + 1}` : d.type === "work" ? "the counter" : d.type === "pass" ? "the pass" : d.type === "trash" ? "the bin" : d.type === "store" ? "the store" : "there";
  }
  function dragDo(src, dest, e) {
    if (!src || !dest) return;
    const u = src.object.userData.item, d = src.object.userData.hit;
    if (held()) { act(dest, e); return; }
    const then = () => act(dest, e);
    if (u) {
      const g = groupOf(u);
      if (!g) return;
      // (Off the board or out of the blender, a drag is what a click on it would be.)
      if (g.at === "station" && (g.cook?.proc === "chop" || g.cook?.proc === "blend" || (g.cook && !g.cook.start))) { act(src, st.press?.e || e); return; }
      st.sel = { gid: g.gid, uid: null };
      st.afterHold = then;
      walkTo(standAt(g), () => pickSelected());
      return;
    }
    if (d?.type === "bin") { st.afterHold = then; clickSource(d.ing, frontOf(st.scene.bins.find((b) => b.ing === d.ing)?.x ?? src.point.x)); }
  }
  function act(hit, e) {
    st.afterHold = null;
    if (!hit) { hud(); return; }
    if(st.pouring){
      const dest=hit.object.userData.hit, u = hit.object.userData.item, g = u && groupOf(u);
      if(dest?.type==="vessel" || dest?.type==="station" && dest.id==="bowl")return pourInto(dest);
      if (g && (g.at === "work" || g.at === "pass")) return pourInto({ type: "onto", group: g });
      notify("Pour it into a bowl on the front counter, or onto a dish (click it).");return;
    }
    const u = hit.object.userData.item;
    if (u) { clickItem(u, e); return; }
    const d = hit.object.userData.hit, p = hit.point;
    if (d.type === "floor") { walkTo(p); hud(); return; }
    if (d.type === "bin") { clickSource(d.ing, frontOf(st.scene.bins.find((b) => b.ing === d.ing)?.x ?? p.x), e.shiftKey); return; }
    if (d.type === "store") { clickStore(d.kept, e); return; }
    if (d.type === "trash") { if (held()) walkTo(st.scene.storage.trash.approach, () => binHeld()); return; }
    if (d.type === "work") { if (held()) walkTo(frontOf(p.x), () => putDown(p)); else walkTo(frontOf(p.x)); return; }
    if (d.type === "vessel") { const at = st.scene.vessels[d.index]; if (held()) walkTo(frontOf(at.x), () => putDown(at.clone())); else walkTo(frontOf(at.x)); return; }
    if (d.type === "pass") { walkTo(frontOf(st.scene.PASS.x1 - 0.25), held() ? () => toPass() : null); return; }
    if (d.type === "station") clickStation(d.id, e);
  }
  //: A click on food: the product first, then the item inside, then it is picked up. With
  //: something in your hands, that goes on top of what you clicked.
  function clickItem(u, e) {
    const g = groupOf(u);
    if (!g) return;
    const hg = held();
    if (hg && hg.gid !== g.gid) {
      if (g.at === "work" || g.at === "pass" || (g.at === "station" && stationSpec(g.station.id)?.batch && !g.cook?.start)) walkTo(standAt(g), () => stackOnto(g));
      else if (g.at === "station") clickStation(g.station.id, e);   // onto the same station, next to it
      return;
    }
    if (g.at === "station") {
      // On the board and not chopped yet: a click is a chop. Anything else on a station comes off in one click.
      if(g.cook && stationSpec(g.station.id)?.batch && !g.cook.start){walkTo(standAt(g),()=>startBatch(g));return;}
      if (g.cook?.proc === "chop") boardCut(g,e);
      else if(g.cook?.proc==="blend" && g.cook.start)walkTo(standAt(g),()=>carryJug(g));
      else walkTo(standAt(g), () => { st.sel = { gid: g.gid, uid: null }; pickSelected(); });
      return;
    }
    const s = st.sel;
    if (!s || s.gid !== g.gid) st.sel = { gid: g.gid, uid: g.items.length === 1 ? u : null };
    else if (itemsOf(g).every(i => i.batch && i.batch === st.items.get(u).batch)) { walkTo(standAt(g), () => pickSelected()); return; }
    else if (!s.uid || s.uid !== u) st.sel = { gid: g.gid, uid: u };
    else { walkTo(standAt(g), () => pickSelected()); return; }
    highlight(); hud();
  }
  async function pickSelected() {
    const s = st.sel, g = s && st.groups.get(s.gid);
    if (!g) return;
    if (held()) { notify("Your hands are full: put that down first."); return; }
    if(g.cook?.proc==="blend" && g.cook.start){await carryJug(g);return;}
    if (g.cook && !await finishCook(g)) return;
    if (s.uid && g.items.length > 1) {
      // One thing out of a product: the rest settles down.
      const selected = st.items.get(s.uid);
      const taken = selected.batch ? itemsOf(g).filter(i => i.batch === selected.batch) : [selected];
      if (taken.length === g.items.length) { hold(g); return; }
      g.items = g.items.filter(u => !taken.some(i => i.uid === u));
      layout(g);
      hold(newGroup(taken, "held", V(0, 0, 0)));
    } else hold(g);
  }
  //: A bin clicked: walk over and take what the ticket's dish wants of it (or what you took last
  //: time, or one); Shift asks how much.
  function clickSource(ing, at, ask = false) {
    const hg = held();
    if (hg) {
      if (untouched(hg) && st.items.get(hg.items[0]).ing === ing) walkTo(at, () => putBack());
      else notify("Your hands are full: put that down first.");
      return;
    }
    walkTo(at, () => (ask ? chooseQuantity(ing) : takeQty(ing, quickQty(ing))));
  }
  //: How much of ``ing`` a quick take is, in the bin's own unit (pieces, or the recipe's share).
  function quickQty(ing) {
    const spec = ING[ing], t = ticketOf(st.ticket);
    let qty = null;
    if (t) for (const line of t.lines) { const c = targetOf(R, line, k().house_menu)?.build.find((c) => c.ing === ing); if (c) { qty = c.qty; break; } }
    qty ??= st.lastQty?.[ing] ?? (spec?.measure === "g" ? 1 : 1);
    if (wholeUnits(spec)) qty = Math.max(1, Math.round(qty));
    return Math.min(qty, st.k.pantry[ing] || 0);
  }
  function takeQty(ing, qty) {
    if (!(qty > 0)) { notify(`No ${iname(ing).toLowerCase()} left.`); return; }
    const said = displayAmount(R, ing, qty);
    if (!st.toldQuick) { st.toldQuick = true; notify(`Took ${iname(ing).toLowerCase()} (${said}). Shift-click a bin to choose how much, or hover it and press 1–9.`); }
    take(ing, ING[ing].measure === "g" ? qty * ING[ing].grams : qty);
  }
  function openPantry() {
    const list = Object.keys(ING).filter(i => st.k.pantry[i] > 0).sort((a, b) => iname(a).localeCompare(iname(b)));
    st.pop = { kind: "store", list }; hud();
  }
  function clickStore(kept, e) {
    const hg = held(), loc = st.scene.storage[kept];
    if (hg && untouched(hg) && ING[st.items.get(hg.items[0]).ing].kept === kept) { walkTo(loc.approach, () => putBack()); return; }
    if (hg) { notify("Your hands are full: put that down first."); return; }
    const list = Object.keys(ING).filter((i) => ING[i].kept === kept && (st.k.pantry[i] || 0) > 0).sort((a, b) => ING[a].name.localeCompare(ING[b].name));
    st.pop = { kind: "store", kept, x: e.clientX, y: e.clientY, list };
    walkTo(loc.approach);
    hud();
  }
  function chooseQuantity(ing) {
    const spec = ING[ing], stock = st.k.pantry[ing] || 0;
    const max = spec.measure === "g" ? stock * spec.grams : Math.floor(stock);   // (shakes and pieces are whole)
    st.pop = { kind: "quantity", ing, max, value: Math.min(max, spec.measure === "g" ? spec.grams : 1) };
    hud();
    const input = el.querySelector(".pop input");
    input?.focus(); input?.select();
  }
  async function take(ing, amount) {
    if (held() || st.fetching) return;
    st.fetching = true;
    try {
      const qty = ING[ing].measure === "g" ? amount / ING[ing].grams : amount;
      const r = await run("kitchen_take", { items: { [ing]: qty } });
      if (!r) { st.afterHold = null; return; }
      (st.lastQty ||= {})[ing] = qty;
      const origin=st.scene.holdAt.getWorldPosition(V(0,0,0));
      origin.y=st.scene.COUNTER_Y;origin.z+=Math.cos(st.scene.chef.rotation.y)*.18;
      hold(newGroup([await newItem(ing, qty)], "work",origin));
    } finally { st.fetching = false; }
  }
  async function putBack() {
    const g = held();
    if (!untouched(g)) return;
    const it = st.items.get(g.items[0]);
    const r = await run("kitchen_return", { items: { [it.ing]: it.qty } });
    if (!r) return;
    drop(g); hud();
  }
  //: Putting down on the counter: centred onto a product near where you clicked, or a new one there.
  function putDown(p) {
    st.scene.reach();
    const g = held();
    if (!g) return;
    const W = st.scene.WORK;
    const x = Math.max(W.x0 + 0.06, Math.min(W.x1 - 0.06, p.x)), z = Math.max(W.z0 + 0.05, Math.min(W.z1 - 0.05, p.z));
    let best = null, bd = SNAP_M;
    for (const o of st.groups.values()) {
      if (o.at !== "work" || o.gid === g.gid) continue;
      const d = Math.hypot(o.pos.x - x, o.pos.z - z);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) { stackOnto(best); return; }
    g.at = "work"; g.pos = V(x, st.scene.COUNTER_Y, z); st.held = null;
    layout(g); hud();
  }
  function stackOnto(target) {
    const g = held();
    if (!g || target.gid === g.gid) return;
    target.items.push(...g.items);
    g.items = [];
    g.node.parent?.remove(g.node);
    st.groups.delete(g.gid);
    st.held = null;
    layout(target);
    if (st.sel?.gid === target.gid) st.sel = null;
    highlight(); hud();
  }
  function toPass() {
    const g = held();
    if (!g) return;
    const free = st.scene.passSlots.findIndex((_, i) => !st.passOrder.some((id) => st.groups.get(id)?.slot === i));
    if (free < 0) { notify("The pass is full: serve or take a plate off."); return; }
    st.scene.reach();
    g.at = "pass"; g.slot = free; g.pos = st.scene.passSlots[free].clone(); st.held = null;
    st.passOrder.push(g.gid);
    layout(g); hud();
  }
  async function binHeld() {
    const g = held();
    if (!g) return;
    const items = {};
    for (const it of itemsOf(g)) items[it.ing] = (items[it.ing] || 0) + it.qty;
    const why = itemsOf(g).map((i) => i.last).find((x) => x && x !== "just right") || "binned";
    const name = productName(g);
    const r = await run("kitchen_bin", { items, parts:portions(g), why });
    if (!r) return;
    const end=st.scene.storage.trash.approach.clone();end.y=.5;
    const fading=g.node;st.scene.scene.attach(fading);const begin=fading.position.clone(),t0=performance.now();
    st.scene.reach();drop(g);st.scene.scene.add(fading);
    function discard(now){const t=Math.min(1,(now-t0)/350);fading.position.lerpVectors(begin,end,t);fading.rotation.z=t*.55;fading.scale.setScalar(1-.75*t);if(t<1)requestAnimationFrame(discard);else fading.removeFromParent();}
    requestAnimationFrame(discard);
    notify(`Binned: ${name.toLowerCase()} (${fmt(r.cost)}, logged as waste).`);
    hud();
  }
  function keyBin() {
    if (held()) { walkTo(st.scene.storage.trash.approach, () => binHeld()); return; }
    if (st.sel) pickSelectedThen(() => walkTo(st.scene.storage.trash.approach, () => binHeld()));
  }
  function pickSelectedThen(fn) {
    const g = st.groups.get(st.sel?.gid);
    if (!g) return;
    walkTo(standAt(g), async () => { await pickSelected(); fn(); });
  }
  //: E or Space: pick up what is selected, or put down what you hold in front of you.
  function keyUse() {
    const chef = st.scene.chef.position, W = st.scene.WORK;
    if (held()) {
      if (chef.z > st.scene.walk.z1 - 0.15) {
        if (chef.x < st.scene.PASS.x1 + 0.1) toPass();
        else putDown(V(chef.x, 0, (W.z0 + W.z1) / 2));
      } else notify("Walk up to the front counter to put it down, or click where it goes.");
      return;
    }
    if (st.sel) { pickSelectedThen(() => {}); return; }
    if (chef.z >= st.scene.walk.z1 - 0.2) {
      const bin = st.scene.bins.reduce((near, b) => !near || Math.abs(chef.x - b.x) < Math.abs(chef.x - near.x) ? b : near, null);
      if (bin && Math.abs(chef.x - bin.x) < 0.22) chooseQuantity(bin.ing);
    }
  }

  // ---- stations ---------------------------------------------------------------------------------------
  const stationSpec = (id) => st.k.stations.find((s) => s.id === id);
  const onStation = (id) => [...st.groups.values()].filter((g) => g.at === "station" && g.station?.id === id);
  const stationStand = (id) => { const lay = st.scene.layout[id]; return lay.facing > 0 ? backOf(lay.x) : frontOf(lay.x); };
  const machineNow=()=>Date.now()+(st.applianceOffset||0);
  function cookRatio(g){
    const c=g.cook,setting=st.k.appliances?.[g.station.id];
    return c.startDose==null?(performance.now()-c.start)/1000/c.secs:Math.max(0,appliance(g.station.id,setting,machineNow()).dose-c.startDose)/c.secs;
  }
  async function adjust(id,level){
    const r=await run("kitchen_prepare",{action:"dial",station:id,level});
    if(r){(st.k.appliances ||= {})[id]=r.setting;st.applianceOffset=r.now-Date.now();hud();}
  }
  //: The blender's jug lifted off its base (what was blended stays in it: it is poured, not picked
  //: up). With one empty bowl on the counter it goes straight there; else you choose a bowl, or a
  //: dish to pour it over.
  async function carryJug(g){
    if(!await finishCook(g))return;
    g.at="jug";st.pouring=g;g.node.visible=false;
    st.scene.jug.visible=true;st.scene.holdAt.add(st.scene.jug);st.scene.jug.position.set(0,0,0);
    st.scene.jug.rotation.set(0,0,0);hud();
    const empty = st.scene.vessels.map((at, index) => ({ at, index })).filter(({ at }) => ![...st.groups.values()].some((o) => o.at === "work" && Math.hypot(o.pos.x - at.x, o.pos.z - at.z) < 0.06));
    if (empty.length === 1) { notify(`Pouring into bowl ${empty[0].index + 1}, the empty one.`); pourInto({ type: "vessel", index: empty[0].index }); }
  }
  function pourInto(dest){
    if(st.pourMotion)return;
    const g=st.pouring, target=dest.type==="vessel"?st.scene.vessels[dest.index]:dest.type==="onto"?dest.group.pos.clone():st.scene.layout.bowl.slots[0];
    walkTo(frontOf(target.x),()=>{
      st.pourMotion={g,target,start:performance.now()};
    });
  }
  function boardCut(g,e){
    if(itemsOf(g).length!==1){walkTo(standAt(g),()=>chopTap(g));return;}
    const pos=st.scene.project(g.pos),r=st.canvas.getBoundingClientRect();
    const edge=st.scene.project(g.pos.clone().add(V(.09,0,0)));
    // (Clicked on the food: the blade where you clicked on it; from elsewhere, the middle.)
    const fraction=e?.target!==st.canvas?0.5:Math.max(.02,Math.min(.98,.5+(e.clientX-r.left-pos.x*r.width)/(2*Math.max(8,Math.abs(edge.x-pos.x)*r.width))));
    st.pop={kind:"cut",g,fraction};hud();
  }
  async function cutAtBoard(g,mode,fraction){
    const source=itemsOf(g)[0],count=CUT_COUNTS[mode];
    const answer=st.k.serverPrep ? await run("kitchen_prepare",{action:"cut",job:g.cook.job,cut:{mode,fraction}}) : {};
    if(!answer)return;
    st.chopping=performance.now()+450;
    const pieces=[],regions=cutPieces(mode,fraction,source.bounds);
    for(let i=0;i<count;i++){
      const {share,bounds}=regions[i];
      const it=await newItem(source.ing,source.qty*share);
      Object.assign(it,{chain:[...source.chain,"chop"],ratios:[...source.ratios,1],q:source.q,ratio:source.ratio,lot:answer.parts?.[i].lot,cut:mode,bounds});
      await relook(it);
      pieces.push(it);
    }
    drop(g);
    const W=st.scene.WORK,base=V(W.x1-.35,st.scene.COUNTER_Y,W.z1-.1);
    if(mode==="dice"||mode==="mince")newGroup(pieces,"work",base);
    else pieces.forEach((it,i)=>newGroup([it],"work",base.clone().add(V(-i*.13,0,0))));
    st.pop=null;hud();
  }
  function clickStation(id, e) {
    st.controlsStation=id;
    const lay = st.scene.layout[id], spec = stationSpec(id);
    if (!lay || !spec) return;
    const g = held();
    if (g) {
      const sug = suggestProc(g, spec);
      if (sug) { walkTo(stationStand(id), () => placeOn(id, sug)); return; }
      if (spec.does.length > 1 && !spec.batch) { st.pop = { kind: "proc", id, x: e.clientX, y: e.clientY }; hud(); return; }
      walkTo(stationStand(id), () => placeOn(id, spec.does[0]));
      return;
    }
    const here = onStation(id);
    const waiting = here.find((x) => x.cook && !x.cook.start && x.cook.proc !== "chop");
    if (spec.batch && waiting) { walkTo(stationStand(id), () => startBatch(waiting)); return; }
    if (here.length && id === "board") { const c = here.find((x) => x.cook?.proc === "chop"); if (c) { boardCut(c,e);return; } }
    if(id==="blender" && here[0]?.cook?.start){walkTo(stationStand(id),()=>carryJug(here[0]));return;}
    const cooking = here.find((x) => x.cook?.start) || here[0];
    if (cooking) { st.sel = { gid: cooking.gid, uid: null }; walkTo(stationStand(id), () => pickSelected()); return; }
    hud();
    notify(`${spec.name}: bring something to ${spec.does.map((p) => P[p].name.toLowerCase()).join(" or ")}.`);
  }
  const portions = g => itemsOf(g).map(it=>({ing:it.ing,qty:it.qty,lot:it.lot}));
  //: What the open ticket's dish does next to what is in ``g``, if ``spec`` (a station) does it.
  function suggestProc(g, spec) {
    const t = ticketOf(st.ticket);
    if (!t) return null;
    for (const it of itemsOf(g)) for (const line of t.lines) for (const c of targetOf(R, line, k().house_menu)?.build || []) {
      if (c.ing !== it.ing) continue;
      const next = chain(c.p)[it.chain.length];
      if (next && spec.does.includes(next)) return next;
    }
    return null;
  }
  async function beginPrep(g,station,proc) {
    let prep={};
    if(st.k.serverPrep){
      prep=await run("kitchen_prepare",{action:"start",station,proc,parts:portions(g)});
      if(!prep)return null;
      if(prep.setting)(st.k.appliances ||= {})[station]=prep.setting;
      st.applianceOffset=prep.now-Date.now();
    }else if(station!=="board"){
      if(!st.k.appliances?.[station])await adjust(station,"medium");
      prep.startDose=appliance(station,st.k.appliances?.[station],machineNow()).dose;
    }
    return prep;
  }
  async function placeOn(id, proc) {
    const g = held(), lay = st.scene.layout[id], spec = stationSpec(id);
    if (!g) return;
    const here = onStation(id);
    if (spec.batch && here[0]) {
      if (!here[0].cook?.start) { stackOnto(here[0]); hud(); return; }
      notify(`The ${spec.name.toLowerCase()} is busy.`); return;
    }
    const slots = Math.min(spec.slots, lay.slots.length);
    const free = [...Array(slots).keys()].find((i) => !here.some((x) => x.station.slot === i));
    if (free === undefined) { notify(`The ${spec.name.toLowerCase()} is full.`); return; }
    const prep = (!spec.batch || proc==="chop") ? await beginPrep(g,id,proc) : {};
    if (!prep) return;
    st.scene.reach();
    coldWarning(id);
    g.at = "station"; g.station = { id, slot: free }; g.pos = lay.slots[free].clone(); st.held = null;
    if (proc === "chop") g.cook = { proc, taps: 0, need: P.chop.taps };
    else if (spec.batch) g.cook = { proc, start: 0 };
    else g.cook = { proc, start: performance.now(), secs: prep.secs ?? batchSeconds(R, itemsOf(g), proc) };
    g.cook.job=prep.job;g.cook.startDose=prep.startDose;
    layout(g); hud();
  }
  //: Food put on (or started in) something cold: it is said, and it cooks slowly till it is hot.
  function coldWarning(id) {
    const a = appliance(id, st.k.appliances?.[id], machineNow()), name = stationSpec(id)?.name.toLowerCase() || id;
    if (!a.thermal) return;
    if (a.level === "off") { adjust(id, "medium"); notify(`The ${name} was off: turned on to medium. It warms up from ${Math.round(a.value)}°C, so it cooks slowly at first.`); }
    else if (Math.abs(a.value - a.target) > 25) notify(`The ${name} is still ${a.value < a.target ? "heating" : "cooling"} (${Math.round(a.value)}°C of ${Math.round(a.target)}°C): it cooks ${a.value < a.target ? "slowly" : "fast"} until it settles.`);
  }
  async function startBatch(g) {
    coldWarning(g.station.id);
    const prep=await beginPrep(g,g.station.id,g.cook.proc);
    if(!prep)return;
    g.cook.job=prep.job;g.cook.startDose=prep.startDose;
    g.cook.start = performance.now();
    g.cook.secs = prep.secs ?? batchSeconds(R, itemsOf(g), g.cook.proc);
    hud();
  }
  async function chopTap(g) {
    if (g.cook?.proc !== "chop") return;
    if(st.k.serverPrep){
      const r=await run("kitchen_prepare",{action:"tap",job:g.cook.job});
      if(!r)return;
      g.cook.taps=r.taps;
    } else g.cook.taps += 1;
    st.chopping = performance.now() + 220;
    st.scene.emit(V(g.pos.x, g.pos.y + 0.03, g.pos.z), "sizzle");
    if (g.cook.taps >= g.cook.need) { await finishCook(g); notify(`Chopped: ${productName(g).toLowerCase()}.`); }
    hud();
  }
  //: Off the heat (or chopped, or mixed): each item gains the process and how well it came out.
  async function finishCook(g) {
    const c = g.cook;
    if (!c) return;
    if (c.proc === "chop" && c.taps < c.need) { if(st.k.serverPrep){ notify("Finish chopping before picking up.");return false;} g.cook = null; return true; }   // taken off the board unchopped
    if (c.proc !== "chop" && !c.start) { g.cook = null; return true; }          // a batch never started
    let ratio = c.start ? cookRatio(g) : 1;
    if ((c.proc === "cool" || c.proc === "chill") && ratio < 1) {
      notify(`Still ${c.proc === "cool" ? "cooling" : "chilling"}.`); return false;
    }
    if(st.k.serverPrep){
      const r=await run("kitchen_prepare",{action:"finish",job:c.job});
      if(!r)return false;
      itemsOf(g).forEach((it,i)=>it.lot=r.parts[i].lot);
      ratio=r.ratio;
    }
    g.cook = null;
    const q = doneness(R, ratio, c.proc);
    const batch = c.proc === "mix" || c.proc === "blend" ? ++gid : null;
    for (const it of itemsOf(g)) {
      it.chain.push(c.proc);
      it.ratios.push(Math.min(10, ratio));
      if (batch) { it.batch = batch; delete it.shape; }
      if (K.heat.includes(c.proc)) { it.q = Math.min(it.q, q); it.ratio = ratio; it.last = donenessWord(q, ratio); }
      else if ((c.proc === "mix" || c.proc === "blend") && ratio < 0.6) { it.q = Math.min(it.q, 0.6); it.last = "lumpy"; }
      await relook(it);
    }
    layout(g);
    if (K.heat.includes(c.proc)) notify(`${productName(g)}: ${donenessWord(q, ratio)}.`);
    return true;
  }

  // ---- tickets, serving, the lab -----------------------------------------------------------------------
  const ticketOf = (id) => st.k.tickets.find((t) => t.id === id);
  const realLeft = (t) => (clock.real(t.due) - clockTime()) / 1000;
  //: A product as the plate the world scores: its items bottom first, like ones next to each other merged.
  function plateOf(g) {
    const out = [];
    for (const it of itemsOf(g)) {
      const p = it.chain.join(">") || "-", lastC = out.at(-1);
      if (lastC && lastC.lot === it.lot && lastC.ing === it.ing && lastC.p === p && lastC.shape === it.shape && lastC.ratios.every((r, i) => r === it.ratios[i])) lastC.qty += it.qty;
      else out.push({ ...(it.lot ? {lot:it.lot} : {}), ing: it.ing, qty: it.qty, p, q: it.q, ...(it.shape ? {shape: it.shape} : {}), ratios: [...it.ratios], ratio: it.ratio });
    }
    return out;
  }
  function groupGrams(g) {
    return plateOf(g).reduce((sum, c) => sum + cookedPart(R, c).grams, 0);
  }
  function portionControl(g) {
    const list = itemsOf(g), batch = list[0].batch;
    if (g.at !== "work" || (list.length > 1 && !list.every(i => batch && i.batch === batch))) return null;
    const counted = !batch && wholeUnits(ING[list[0].ing]);
    const max = counted ? list[0].qty : groupGrams(g);
    if (max <= (counted ? 1 : 0.01)) return null;
    return h("button", { textContent: "Take a portion", onclick: () => {
      walkTo(standAt(g), () => {
        st.pop = { kind: "portion", group: g, max, counted, value: counted ? 1 : Number((max / 2).toFixed(2)) };
        hud(); const input = el.querySelector(".pop input"); input.focus(); input.select();
      });
    } });
  }
  function splitPortion(g, fraction) {
    if (held() || !st.groups.has(g.gid)) return;
    if (fraction >= 1) { hold(g); return; }
    const batch = itemsOf(g)[0].batch ? ++gid : null;
    const portion = itemsOf(g).map(it => {
      const copy = { ...it, batch, uid: ++uid, qty: it.qty * fraction, chain: [...it.chain], ratios: [...it.ratios], obj: it.obj.clone(true) };
      it.qty -= copy.qty;
      if (it.shape) { delete copy.shape; delete it.shape; }
      mark(copy); st.items.set(copy.uid, copy);
      return copy;
    });
    layout(g); hold(newGroup(portion, "held", V(0, 0, 0)));
  }
  const passGroups = () => st.passOrder.map((id) => st.groups.get(id)).filter(Boolean);
  async function serve() {
    const t = ticketOf(st.ticket);
    if (!t) return;
    const gs = passGroups().slice(0, t.lines.length);
    if (gs.length < t.lines.length) { notify(`Put ${t.lines.length} plates on the pass.`); return; }
    const r = await run("kitchen_serve", { ticket: t.id, plates: gs.map(plateOf), extras: [...st.extras] });
    if (!r) return;
    for (const g of gs) sendOut(g);
    st.ticket = null; st.extras = new Set();
    st.results.unshift({ who: t.who, analyses: r.analyses, score: r.score, tip: r.tip, comp: r.comp_cost, notes: r.scores.flatMap((s) => s.notes).slice(0, 4), paid: t.paid });
    st.results = st.results.slice(0, 3);
    if (r.review) notify(r.review);
    hud();
  }
  //: Plates leave the pass: they slide away and are gone.
  function sendOut(g) {
    st.passOrder = st.passOrder.filter((x) => x !== g.gid);
    for (const u of g.items) st.items.delete(u);
    st.groups.delete(g.gid);
    if (st.sel?.gid === g.gid) st.sel = null;
    const node = g.node, t0 = performance.now();
    const slide = () => { const k2 = (performance.now() - t0) / 700; node.position.z += 0.012; node.position.y += 0.003; node.scale.setScalar(Math.max(0.01, 1 - k2)); if (k2 < 1) requestAnimationFrame(slide); else node.parent?.remove(node); };
    slide();
  }
  async function cover(on) {
    const r = await run("kitchen_cover", { on });
    if (!r) return;
    notify(on ? `${r.cook} has the line. The lab is yours.` : "The line is yours again.");
    if (on) st.tab = "lab";
    hud();
  }
  async function labTest() {
    const g = passGroups()[0];
    if (!g) { notify("Put your dish on the pass first."); return; }
    const build = plateOf(g);
    const r = await run("lab_test", { name: st.lab.name || "Test dish", build });
    if (!r) return;
    sendOut(g);
    st.lastTest = r.test;
    hud();
  }
  async function propose(test, price) {
    const r = await run("lab_propose", { test: test.id, price });
    if (r) { notify(`Put to ${st.k.owner_name}: "${test.name}" at ${fmt(r.proposal.price)}.`); hud(); }
  }

  // ---- the HUD ----------------------------------------------------------------------------------------
  const k = () => st.k;
  function statusText() {
    const kk = k(), rec = kk.record;
    const busy = kk.busy <= 0.04 ? "Closed: no customers now" : kk.busy > 0.7 ? "Rush hour" : kk.busy > 0.35 ? "Steady" : "Quiet";
    return `${busy} · ${kk.tickets.length} ticket${kk.tickets.length === 1 ? "" : "s"} · rating ${kk.rating}${rec ? ` · tips ${fmt(rec.tips)} · ${rec.served} served` : ""}`;
  }
  function hudTop() { const s = el?.querySelector(".top .status"); if (s) s.textContent = statusText(); }
  function hud() {
    if (!el || !st?.scene) return;
    const kk = k();
    for (const n of el.querySelectorAll(".hud")) n.remove();
    const tabs = [["line", "The line"], ["lab", "The lab"], [kk.role === "owner" ? "owner" : "you", kk.role === "owner" ? "Owner" : "Your record"]];
    const parts = [h("div", { className: "top glass hud" },
      h("b", { textContent: `${kk.name} — kitchen` }),
      h("div", { className: "tabs chips" }, ...tabs.map(([id, label]) => h("button", { textContent: label, "aria-pressed": String(st.tab === id), onclick: () => { st.tab = id; hud(); } }))),
      h("span", { className: "note status grow", textContent: statusText() }),
      kk.covering ? h("button", { textContent: "Take the line back", onclick: () => cover(false) }) : h("button", { textContent: `Hand the line to ${kk.cooks[0].split(" ")[0]} (NPC)`, onclick: () => cover(true) }),
      h("button", { textContent: "×", title: "Close (Esc)", onclick: close }))];
    if (st.tab === "owner" || st.tab === "you") parts.push(h("div", { className: "sheet glass hud" }, ...(st.tab === "owner" ? ownerTab() : recordTab())));
    else {
      if (st.tab === "line") {
        const msg = kk.covering ? `${kk.cooks[0]} is covering the line.` : !kk.tickets.length ? (kk.busy <= 0.04 ? "No customers: the restaurant is closed. Try something new in the lab." : "No tickets yet. The next one is coming.") : null;
        parts.push(h("div", { className: "rail hud" }, ...(msg ? [h("div", { className: "glass note", style: "padding:8px 10px", textContent: msg })] : kk.tickets.map(ticketCard))));
      }
      parts.push(h("div", { className: "side glass hud" }, ...(st.tab === "lab" ? labSide() : lineSide())));
      parts.push(dock());
      parts.push(hintBar());
    }
    if (st.pop) parts.push(popup());
    el.append(...parts.filter(Boolean));
  }
  function ticketCard(t) {
    const left = realLeft(t), share = Math.max(0, Math.min(1, left / t.real_s));
    return h("div", { className: `ticket${st.ticket === t.id ? " sel" : ""}`, "data-ticket": t.id, onclick: () => { st.ticket = t.id; hud(); } },
      h("div", { className: "who", textContent: `${t.who} · ${t.service || "Customer"}${t.paid ? " (paid)" : ""}` }),
      h("ul", {}, ...t.lines.map((l) => h("li", {}, h("span", { textContent: R.items[l.dish]?.name || l.dish }),
        ...(l.mods || []).map((m) => h("div", { className: "mod", textContent: m.no ? `NO ${iname(m.no).toUpperCase()}` : `EXTRA ${iname(m.extra).toUpperCase()}` }))))),
      h("div", { className: "bar" }, h("i", { style: `width:${share * 100}%;background:${share < 0.25 ? "#c0392b" : share < 0.5 ? "#e0a526" : "#2e9d58"}` })),
      h("div", { className: "left", style: "font-size:11px;color:#666;margin-top:2px", textContent: `${Math.max(0, Math.round(left))} s left` }));
  }
  function lineSide() {
    const out = [], t = ticketOf(st.ticket);
    if (!t) {
      out.push(h("h4", { textContent: "How to cook" }),
        h("p", { className: "note", textContent: "Pick a ticket on the rail. Click a bin on the counter (or the fridge, freezer and shelves) to fetch an ingredient; click a station to cook it; click the counter to put it down. Put things down on top of each other to build the dish, then put it on the pass (left) and serve." }),
        h("p", { className: "note", textContent: "WASD or the arrows walk · E or Space picks up and puts down · Q or Delete bins · Esc closes" }));
      for (const x of st.results) out.push(resultCard(x));
      return out;
    }
    const gs = passGroups();
    t.lines.forEach((line, i) => {
      const target = targetOf(R, line, k().house_menu), g = gs[i];
      const plate = g ? plateOf(g) : [];
      const have = new Set(plate.map((c) => `${c.ing}|${c.p}`));
      out.push(h("h4", { textContent: `${i + 1}. ${R.items[line.dish]?.name || line.dish}${g ? " — on the pass" : ""}` }));
      if (target) out.push(h("div", { className: "recipe" }, h("ol", {}, ...target.build.map((c) => h("li", { className: have.has(`${c.ing}|${c.p}`) ? "done" : "" },
          `${iname(c.ing)} · ${displayAmount(R, c.ing, c.qty)}${chain(c.p).length ? ` — ${chain(c.p).map((p) => P[p].verb).join(", then ")}` : ""}${c.shape ? ` · ${DOUGH_FORMS[c.shape.form]}, ${c.shape.span} × ${Number((c.shape.span / c.shape.aspect).toFixed(1))} cm` : ""}${c.side ? " (side)" : ""}`,
          // (One click: the cook goes for it, in the recipe's amount.)
          (st.k.pantry[c.ing] || 0) > 0 && !held() ? h("button", { textContent: "Fetch", title: `Take ${displayAmount(R, c.ing, c.qty)} ${iname(c.ing).toLowerCase()}`, onclick: () => fetchFor(c) }) : null))),
        target.ordered ? h("div", { className: "note", textContent: "Build it in this order, bottom first." }) : null,
        // Clicking a ticket opens its step-by-step: what to start first so it all comes out together.
        h("details", { className: "steps", open: st.steps !== false, ontoggle: (e) => { st.steps = e.target.open; } },
          h("summary", { textContent: "Step by step" }),
          h("ol", {}, ...cookingSteps(R, k().kind, target).map((s) => h("li", {}, h("span", { textContent: s.text }), s.station ? h("span", { className: "at", textContent: ` · ${s.station}` }) : null)))),
        g ? h("div", { className: "note", textContent: `As it stands: about ${scorePlate(R, target, plate, { elapsed: Math.max(0, (Date.now() - clock.real(t.at)) / 1000), patience: t.real_s, targetSeconds: t.target_s }).score}/100` }) : null));
    });
    const extras = (k().menu || []).filter((d) => { const v = recipeOf(R, d)?.vessel; return v === "cup" || v === "glass" || (R.items[d]?.price || 0) < R.money(8); }).slice(0, 8);
    if (extras.length && !t.paid) {
      const compCost = [...st.extras].reduce((s, d) => s + Object.entries(needs(recipeOf(R, d, k().house_menu)?.build || [])).reduce((a, [i, n]) => a + ingCost(R, i, n), 0), 0);
      out.push(h("h4", { textContent: "On the house" }), h("div", { className: "chips" }, ...extras.map((d) => h("button", { className: st.extras.has(d) ? "on" : "", textContent: R.items[d].name,
        onclick: () => { if (st.extras.has(d)) st.extras.delete(d); else if (st.extras.size < 3) st.extras.add(d); hud(); } }))),
        h("p", { className: "note", textContent: st.extras.size ? `A bigger tip, but it costs the house ${fmt(compCost)}: logged against you.` : "Slip in something free for a bigger tip. The house pays, and it counts against your rating." }));
    }
    const ready = gs.length >= t.lines.length;
    out.push(h("button", { className: "primary", style: "width:100%;margin-top:6px", textContent: ready ? `Serve ${t.who.split(" ")[0]}` : `Put ${t.lines.length} plate${t.lines.length > 1 ? "s" : ""} on the pass`, disabled: !ready, onclick: serve }));
    for (const x of st.results.slice(0, 1)) out.push(resultCard(x));
    return out;
  }
  //: Fetch a recipe line's ingredient in its amount, from its bin (or where it is kept).
  function fetchFor(c) {
    if (held()) { notify("Your hands are full: put that down first."); return; }
    const bin = st.scene.bins.find((b) => b.ing === c.ing);
    const at = bin ? frontOf(bin.x) : st.scene.storage[ING[c.ing].kept]?.approach || frontOf(st.scene.chef.position.x);
    const qty = Math.min(wholeUnits(ING[c.ing]) ? Math.max(1, Math.round(c.qty)) : c.qty, st.k.pantry[c.ing] || 0);
    walkTo(at, () => takeQty(c.ing, qty));
  }
  function labSide() {
    const g = passGroups()[0];
    const family = g && recognizeDish(R, plateOf(g), k().house_menu);
    const out = [h("h4", { textContent: "The lab" }), h("p", { className: "note", textContent: "Cook anything from the pantry, build your dish, and put it on the pass. It is served free to a customer as a test." }),
      h("input", { placeholder: "Name your dish", "aria-label": "Dish name", disabled: Boolean(family), value: family?.name || st.lab.name, maxLength: 40, style: "width:100%", oninput: (e) => { st.lab.name = e.target.value; } })];
    if (g) out.push(h("div", { className: "note", style: "margin-top:6px", textContent: `On the pass: ${plateOf(g).map((c) => `${displayAmount(R, c.ing, c.qty)} ${iname(c.ing).toLowerCase()}${c.p !== "-" ? ` (${chain(c.p).map((p) => P[p].verb).join(", ")})` : ""}`).join(", ")} · costs ${fmt(plateOf(g).reduce((s, c) => s + ingCost(R, c.ing, c.qty), 0))}` }));
    out.push(h("button", { className: "primary", style: "width:100%;margin-top:6px", textContent: "Serve as a free test", disabled: !g, onclick: labTest }));
    if (st.lastTest) out.push(testCard(st.lastTest, true));
    const mine = (k().proposals || []).slice(-5).reverse();
    if (mine.length) out.push(h("h4", { textContent: "Put to the owner" }), ...mine.map((pr) => h("div", { className: "note", textContent: `"${pr.name}" at ${fmt(pr.final_price || pr.price)}: ${pr.status === "pending" ? `waiting for ${k().owner_name}` : pr.status}` })));
    const menu = k().house_menu || [];
    if (menu.length) out.push(h("h4", { textContent: "The house's own dishes" }), ...menu.map((d) => h("div", { className: "note", textContent: `${d.name} · ${fmt(d.price)} · by ${d.by_name} · ${d.sold || 0} sold` })));
    return out;
  }
  //: The bar along the bottom: what you hold, and one click for each place it can go (the recipe's
  //: next step first); what you have selected and what can be done with it; or how to start.
  function hintBar() {
    const g = held(), s = st.sel && st.groups.get(st.sel.gid);
    const bits = [];
    const chip = (label, fn, primary = false, title = "") => h("button", { className: `chip${primary ? " primary" : ""}`, textContent: label, title, onclick: fn });
    if (st.pouring) {
      return h("div", { className: "hint glass hud" }, h("b", { textContent: "Pour the blend:" }),
        ...st.scene.vessels.map((_, index) => chip(`Into bowl ${index + 1}`, () => pourInto({ type: "vessel", index }), index === 0)),
        h("span", { className: "note", textContent: "or click a dish on the counter to pour it over" }));
    }
    if (g) {
      bits.push(h("b", { textContent: `Holding ${productName(g)}${g.items.length === 1 ? ` (${stateWord(st.items.get(g.items[0]))})` : ""}:` }));
      // One chip a station (the ticket's next step for this first, and named): a station that does
      // more than one thing asks which, unless the ticket says.
      const list = st.k.stations.map((spec) => ({ spec, sug: suggestProc(g, spec) })).sort((a, b) => Number(Boolean(b.sug)) - Number(Boolean(a.sug)));
      for (const { spec, sug } of list) bits.push(chip(sug ? `${spec.name}: ${P[sug].name.toLowerCase()}` : spec.name, (e) => (sug ? walkTo(stationStand(spec.id), () => placeOn(spec.id, sug)) : clickStation(spec.id, e)), Boolean(sug), sug ? "The ticket's next step for this" : spec.does.map((x) => P[x].name).join(", ")));
      bits.push(chip("Counter", () => { const at = freeSpot(); walkTo(frontOf(at.x), () => putDown(at)); }));
      bits.push(chip("Pass", () => walkTo(frontOf(st.scene.PASS.x1 - 0.25), () => toPass())));
      if (untouched(g)) bits.push(chip("Put back", () => { const it = st.items.get(g.items[0]); const bin = st.scene.bins.find((b) => b.ing === it.ing); walkTo(bin ? frontOf(bin.x) : st.scene.storage[ING[it.ing].kept].approach, () => putBack()); }));
      bits.push(chip("Bin (Q)", keyBin));
    } else if (s) {
      const batch = itemsOf(s)[0].batch;
      const homogeneous = batch && itemsOf(s).every(i => i.batch === batch);
      const it = st.sel.uid ? st.items.get(st.sel.uid) : null;
      bits.push(h("b", { textContent: homogeneous ? `${productName(s)}:` : it && s.items.length > 1 ? `The ${iname(it.ing).toLowerCase()} in the ${productName(s).toLowerCase()}:` : `${productName(s)}:` }));
      bits.push(chip("Pick up (E)", () => pickSelectedThen(() => {}), true));
      if (s.at !== "station" && itemsOf(s).length === 1 && st.scene.layout.board) bits.push(chip("Cut on the board", () => pickSelectedThen(() => walkTo(stationStand("board"), () => placeOn("board", "chop")))));
      if (s.at === "work" && workableDough(itemsOf(s))) bits.push(chip("Shape dough", () => walkTo(standAt(s), () => { st.pop = { kind: "shape", group: s }; hud(); })));
      const portion = portionControl(s); if (portion) bits.push(portion);
      bits.push(chip("Bin", keyBin));
      if (s.items.length > 1 && !homogeneous) bits.push(h("span", { className: "note", textContent: "Click it again to choose one thing in it." }));
    } else bits.push(h("span", { className: "note", textContent: "Click a bin to take what the ticket needs (Shift-click: how much · hover + 1–9) · drag from a bin or a dish straight onto a station · or press Fetch in the recipe." }));
    if (!g) bits.push(chip("Pantry (B)", openPantry));
    return h("div", { className: "hint glass hud" }, ...bits);
  }
  //: A free place on the counter near the cook (for "Counter" from the bar).
  function freeSpot() {
    const W = st.scene.WORK, x0 = st.scene.chef.position.x, z = (W.z0 + W.z1) / 2;
    for (let i = 0; i < 24; i += 1) {
      const x = Math.max(W.x0 + 0.08, Math.min(W.x1 - 0.08, x0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.16));
      if (![...st.groups.values()].some((o) => o.at === "work" && Math.hypot(o.pos.x - x, o.pos.z - z) < SNAP_M + 0.03)) return V(x, st.scene.COUNTER_Y, z);
    }
    return V(x0, st.scene.COUNTER_Y, z);
  }
  //: The appliances' dials: each one's heat (or speed), warming to where it is set: off, low,
  //: medium, high.
  const dialled = () => st.k.stations.filter((x) => x.id !== "board" && (appliance(x.id, null, 0).thermal || x.id === "blender"));
  function dock() {
    const list = dialled();
    if (!list.length) return null;
    const fold = h("button", { className: "fold glass", textContent: st.dockShut ? "Dials ▸" : "Dials ▾", title: "Show or hide the appliances' dials (the tags over each one stay)", onclick: () => { st.dockShut = !st.dockShut; hud(); } });
    if (st.dockShut) return h("div", { className: "dock hud" }, fold);
    return h("div", { className: "dock hud" }, fold, ...list.map((spec) => {
      const level = st.k.appliances?.[spec.id]?.level || "off";
      return h("div", { className: "dial glass", "data-dial": spec.id },
        h("div", { className: "head" }, h("b", { textContent: spec.name }), h("span", { className: "read" })),
        appliance(spec.id, null, 0).thermal ? h("div", { className: "gauge" }, h("i"), h("s")) : null,
        h("div", { className: "seg", role: "group", "aria-label": `${spec.name} setting` }, ...levels.map((lv) => h("button", { textContent: lv === "medium" ? "Med" : lv[0].toUpperCase() + lv.slice(1), "aria-pressed": String(level === lv), onclick: () => adjust(spec.id, lv) }))));
    }));
  }
  //: An appliance's state in words: cold, warming, ready, cooling.
  function dialWords(id) {
    const a = appliance(id, st.k.appliances?.[id], machineNow());
    if (!a.thermal) return { text: a.level === "off" ? "Off" : `Speed ${a.level}`, colour: a.level === "off" ? "#7b8794" : "#5fc489", a };
    const now = Math.round(a.value), to = Math.round(a.target);
    if (a.level === "off") return { text: now > 35 ? `Off · cooling ${now}°C` : `Off · cold`, colour: now > 35 ? "#e0a526" : "#7b8794", a };
    if (a.target - a.value > 8) return { text: `Preheating ${now}° → ${to}°C`, colour: "#e0a526", a };
    if (a.value - a.target > 8) return { text: `Cooling ${now}° → ${to}°C`, colour: "#3d7bd9", a };
    return { text: `Ready ${to}°C`, colour: "#5fc489", a };
  }
  function popup() {
    const p = st.pop;
    if(p.kind==="cut"){
      const slider=h("input",{type:"range",min:2,max:98,value:Math.round(p.fraction*100),"aria-label":"Cut position"});
      const read=h("output",{textContent:slider.value+"%"});
      const preview=()=>{read.textContent=slider.value+"%";const knife=st.scene.layout.board.knife;if(knife)knife.position.x=(+slider.value/100-.5)*.15;};
      slider.oninput=preview;preview();
      return h("div",{className:"pop list glass hud",style:"left:50%;top:50%"},h("b",{textContent:"Cutting board"}),h("label",{},"Blade position ",slider,read),
        h("div", { className: "chips" }, ...[["split", "Halve here"], ["slice", "Slice (6)"], ["dice", "Dice (16)"], ["mince", "Mince (25)"]].map(([mode, textContent]) => h("button", { textContent, className: mode === "split" ? "primary" : "", onclick: () => { st.pop = null; walkTo(standAt(p.g), () => cutAtBoard(p.g, mode, +slider.value / 100)); hud(); } }))),
        h("span", { className: "note", textContent: "Halve where the blade is, then take either piece; any piece can go back on the board to be cut again." }),
        h("button", { textContent: "Take it off the board", onclick: () => { st.pop = null; st.sel = { gid: p.g.gid, uid: null }; walkTo(standAt(p.g), () => pickSelected()); hud(); } }));
    }
    if (p.kind === "shape") {
      const g = p.group, mass = groupGrams(g), current = itemsOf(g)[0].shape;
      const form = h("select", { "aria-label": "Dough form" }, ...Object.entries(DOUGH_FORMS).map(([id,name]) => h("option", { value: id, textContent: name })));
      form.value = current?.form || "ball";
      const span = h("input", { type: "range", min: 3, max: 50, step: 0.1, value: current?.span ?? Math.min(50, Math.max(3, Math.cbrt(mass / 1.08 * 6 / Math.PI))) });
      const aspect = h("input", { type: "range", min: 0.4, max: 2.5, step: 0.05, value: current?.aspect ?? 1 });
      const readout = h("output"), apply = h("button", { textContent: "Shape portion", className: "primary" });
      const shape = () => ({ form: form.value, span: +span.value, aspect: +aspect.value });
      function preview() {
        const d = doughDimensions(mass, shape());
        readout.textContent = `${Math.round(mass)} g · ${d.width.toFixed(1)} × ${d.length.toFixed(1)} × ${d.height.toFixed(1)} cm`;
        apply.disabled = d.height < 0.1 || d.height > Math.min(d.width, d.length) * (form.value === "ball" ? 2 : 0.6);
        if (apply.disabled) readout.textContent += " · adjust the footprint to fit this portion";
      }
      form.onchange = span.oninput = aspect.oninput = preview; preview();
      apply.onclick = async () => { const spec = shape();
        if(st.k.serverPrep){
          const r=await run("kitchen_prepare",{action:"shape",shape:spec,parts:portions(g)});
          if(!r)return;itemsOf(g).forEach((it,i)=>it.lot=r.parts[i].lot);
        } for (const it of itemsOf(g)) it.shape = spec; st.pop = null; layout(g); hud(); };
      return h("div", { className: "pop list glass hud", style: "left:50%;top:50%" }, form, h("label", {}, "Width ", span), h("label", {}, "Width / length ", aspect), readout, apply,
        h("button", { textContent: "Cancel", onclick: () => { st.pop = null; hud(); } }));
    }
    if (p.kind === "quantity" || p.kind === "portion") {
      const source = p.kind === "quantity";
      const counted = source ? wholeUnits(ING[p.ing]) : p.counted;
      const shakes = source && ING[p.ing].measure === "shake";
      const unit = shakes ? "shakes" : counted ? (source ? ING[p.ing].unit : ING[itemsOf(p.group)[0].ing].unit) : "g";
      const input = h("input", { type: "number", step: counted ? "1" : "any", min: counted ? "1" : "0.000001",
        max: String(p.max), value: String(p.value), required: true, "aria-label": `Quantity in ${unit}` });
      // A shaker is shaken a controlled number of times: one more, one fewer.
      const nudge = (d) => h("button", { type: "button", className: "nudge", textContent: d > 0 ? "+1 shake" : "−1", onclick: () => {
        input.value = String(Math.max(1, Math.min(p.max, (Math.round(input.valueAsNumber) || 0) + d))); } });
      const submit = e => {
        e.preventDefault(); const amount = input.valueAsNumber;
        if (!input.reportValidity() || !Number.isFinite(amount) || amount <= 0 || amount > p.max) return;
        st.pop = null; hud();
        if (source) take(p.ing, amount); else splitPortion(p.group, amount / p.max);
      };
      return h("form", { className: "pop list glass hud", style: "left:50%;top:50%", onsubmit: submit },
        h("b", { textContent: source ? iname(p.ing) : productName(p.group) }),
        h("label", {}, `${shakes ? "Shakes" : `Quantity (${unit})`} · ${Number(p.max.toFixed(2))} available${shakes ? ` · ${ING[p.ing].grams} g a shake` : ""}`, input),
        ...(shakes ? [h("span", { className: "row" }, nudge(-1), nudge(1))] : []),
        h("button", { className: "primary", type: "submit", textContent: "Take" }),
        h("button", { type: "button", textContent: "Cancel", onclick: () => { st.pop = null; hud(); } }));
    }
    if (p.kind === "proc") {
      const spec = stationSpec(p.id);
      return h("div", { className: "pop glass hud", style: `left:${p.x}px;top:${p.y}px` }, h("b", { textContent: spec.name }),
        ...spec.does.map((pr) => h("button", { textContent: P[pr].name, onclick: () => { st.pop = null; walkTo(stationStand(p.id), () => placeOn(p.id, pr)); hud(); } })));
    }
    if (p.kind === "store") {
      const name = { fridge: "The fridge", freezer: "The freezer", dry: "The dry-goods shelves" }[p.kept] || "Ingredient bins";
      return h("div", { className: "pop list glass hud", style: "left:50%;top:50%" }, h("b", { textContent: name }),
        ...(p.list.length ? p.list.map((i) => h("button", { className: "row", onclick: () => { st.pop = null; const bin = st.scene.bins.find(b => b.ing === i); walkTo(bin?.approach || st.scene.storage[ING[i].kept].approach, () => chooseQuantity(i)); hud(); } }, h("span", { textContent: iname(i) }), h("span", { className: "note", textContent: displayAmount(R, i, st.k.pantry[i]) })))
          : [h("p", { className: "note", textContent: "Empty: the owner has not ordered anything kept here." })]),
        h("button", { textContent: "Close", onclick: () => { st.pop = null; hud(); } }));
    }
    return null;
  }
  //: Every frame: the bars over what is cooking, the tooltip, the tickets' patience.
  function overlay(now) {
    // The dials' readings, and a tag over each appliance in the kitchen (click it to turn it up).
    let temps = el.querySelector(".temps");
    if (!temps) { temps = h("div", { className: "temps" }); el.append(temps); temps.onclick = (e) => { const id = e.target.closest("[data-at]")?.dataset.at; if (!id) return; const now = st.k.appliances?.[id]?.level || "off"; adjust(id, levels[(levels.indexOf(now) + 1) % levels.length]); }; }
    const dials = st.tab === "line" || st.tab === "lab" ? dialled() : [];
    while (temps.children.length < dials.length) temps.append(h("div", { className: "temp" }, h("i"), h("span")));
    while (temps.children.length > dials.length) temps.lastChild.remove();
    dials.forEach((spec, i) => {
      const w = dialWords(spec.id), tag = temps.children[i], lay = st.scene.layout[spec.id];
      tag.dataset.at = spec.id; tag.title = `${spec.name}: click to turn it up (off, low, medium, high)`;
      tag.firstChild.style.background = w.colour; tag.lastChild.textContent = w.text;
      if (lay) { const pp = st.scene.project(V(lay.x, st.scene.COUNTER_Y + 0.42, lay.z)); tag.style.left = `${pp.x * el.clientWidth}px`; tag.style.top = `${pp.y * el.clientHeight}px`; tag.style.display = pp.behind ? "none" : ""; }
      const card = el.querySelector(`[data-dial="${spec.id}"]`);
      if (card) {
        card.querySelector(".read").textContent = w.text;
        const gauge = card.querySelector(".gauge");
        if (gauge && w.a.thermal) { const top = Math.max(250, w.a.target * 1.15); gauge.firstChild.style.width = `${Math.min(100, (w.a.value / top) * 100)}%`; gauge.lastChild.style.left = `${Math.min(100, (w.a.target / top) * 100)}%`; }
      }
    });
    let layer = el.querySelector(".cooks");
    if (!layer) {
      layer = h("div", { className: "cooks" }); el.append(layer);
      // (A bar over what is cooking is a handle on it: click it to take it off, or chop it.)
      layer.onclick = (e) => { const g = st.groups.get(+e.target.closest("[data-gid]")?.dataset.gid); if (g?.items.length) clickItem(g.items[0], e); };
    }
    const list = [...st.groups.values()].filter((g) => g.cook);
    while (layer.children.length < list.length) layer.append(h("div", { className: "cook" }, h("div", { className: "lbl" }), h("div", { className: "bar" }, h("div", { className: "ok" }), h("div", { className: "burn" }), h("div", { className: "at" }))));
    while (layer.children.length > list.length) layer.lastChild.remove();
    const D = K.doneness, span = D.burnt_above * 1.15, W = el.clientWidth, H = el.clientHeight;
    list.forEach((g, i) => {
      const node = layer.children[i], c = g.cook;
      node.dataset.gid = g.gid;
      const p = st.scene.project(V(g.pos.x, g.pos.y + (g.height || 0.03) + 0.1, g.pos.z));
      node.style.left = `${p.x * W}px`; node.style.top = `${p.y * H}px`;
      const ok = node.querySelector(".ok"), burn = node.querySelector(".burn"), at = node.querySelector(".at"), lbl = node.querySelector(".lbl");
      if (c.proc === "chop") { lbl.textContent = `Chop ${c.taps}/${c.need}: click it`; ok.style.width = "0"; burn.style.width = "0"; at.style.left = `${(c.taps / c.need) * 100}%`; return; }
      if (!c.start) { lbl.textContent = `Click the ${stationSpec(g.station.id).name.toLowerCase()} to ${P[c.proc].name.toLowerCase()}`; ok.style.width = "0"; burn.style.width = "0"; at.style.left = "0"; return; }
      const ratio = cookRatio(g), heat = K.heat.includes(c.proc);
      lbl.textContent = heat ? (ratio < D.right[0] ? `${P[c.proc].name}…` : ratio <= D.right[1] ? "Ready: take it off!" : ratio < D.burnt_above ? "Overdone" : "Burnt") : ratio >= 1 ? "Done: take it" : `${P[c.proc].name}…`;
      ok.style.left = `${(heat ? D.right[0] : 1) / span * 100}%`; ok.style.width = `${(heat ? D.right[1] - D.right[0] : span - 1) / span * 100}%`;
      burn.style.width = heat ? `${(1 - D.burnt_above / span) * 100}%` : "0";
      at.style.left = `${Math.min(100, ratio / span * 100)}%`;
    });
    let tip = el.querySelector(".tip");
    if (st.hover?.text && !st.pop) { if (!tip) { tip = h("div", { className: "tip" }); el.append(tip); } tip.textContent = st.hover.text; tip.style.left = `${st.hover.x}px`; tip.style.top = `${st.hover.y}px`; }
    else tip?.remove();
    for (const node of el.querySelectorAll("[data-ticket]")) {
      const t = ticketOf(node.dataset.ticket);
      if (!t) continue;
      const share = Math.max(0, Math.min(1, realLeft(t) / t.real_s)), bar = node.querySelector(".bar i");
      bar.style.width = `${share * 100}%`; bar.style.background = share < 0.25 ? "#c0392b" : share < 0.5 ? "#e0a526" : "#2e9d58";
      const left = Math.max(0, Math.round(realLeft(t))), elapsed = t.real_s - left;
      const onTime = Math.ceil((t.target_s ?? t.real_s * 0.6) - elapsed);
      node.querySelector(".left").textContent = t.paid ? `${left}s left` : onTime > 0 ?
        `Full tip for ${onTime}s · leaves in ${left}s` : `${Math.round(100 * waitTipShare(t, elapsed))}% tip potential · leaves in ${left}s`;
    }
  }
  function resultCard(x) {
    const stars = Math.round(x.score / 20);
    return h("div", { className: "result" }, h("div", {}, h("span", { className: "stars", textContent: `${"★".repeat(stars)}${"☆".repeat(5 - stars)}` }), h("b", { textContent: ` ${x.score}/100 for ${x.who}` })),
      h("div", { textContent: x.paid ? "They paid at the counter: a tip is theirs to give." : `Tip ${fmt(x.tip)}${x.comp ? ` · on the house ${fmt(x.comp)}` : ""}` }),
      ...(x.analyses || []).map((a, i) => h("div", { className: "note", textContent: `Plate ${i + 1} · ≈${a.kcal} kcal · taste ${a.taste}/100` })),
      x.notes.length ? h("div", { className: "note", textContent: x.notes.join(" · ") }) : null);
  }
  function flavourNotes(profile) {
    const labels = { sw: "sweet", sa: "salty", so: "sour", bi: "bitter", um: "savory", fa: "rich", sp: "spicy", fr: "fresh" };
    const dominant = Object.entries(profile).filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return dominant.length ? dominant.map(([key]) => labels[key]).join(" · ") : "Mild";
  }
  function testCard(x, offer = false) {
    const price = h("input", { type: "number", step: "0.5", min: "1", value: String(x.price / R.money(1)), style: "width:5.5em" });
    const done = (k().proposals || []).some((p) => p.test === x.id);
    return h("div", { className: "result" }, h("b", { textContent: `"${x.name}": ${x.taste}/100` }), h("div", { textContent: `${x.who}: “${x.verdict}”` }),
      h("div", { className: "note", textContent: `${x.kcal != null ? `≈${x.kcal} kcal · ${x.grams} g · ` : ""}+${x.stamina} stamina · ${x.health >= 0 ? "+" : ""}${x.health} health · costs ${fmt(x.cost)} · a fair price ${fmt(x.price)}` }),
      x.flavour ? h("div", { className: "note", textContent: flavourNotes(x.flavour) }) : null,
      x.notes.length ? h("div", { className: "note", textContent: x.notes.join(" · ") }) : null,
      offer && !done && !(x.family && (k().menu.includes(x.family) || k().house_menu.some(d => d.id === x.family))) ? h("div", { className: "chips", style: "margin-top:4px" }, h("span", { className: "note", textContent: "Price ₡" }), price,
        h("button", { className: "primary", textContent: `Put to ${k().owner_name.split(" ")[0]}`, onclick: () => propose(x, Math.round(+price.value * R.money(1))) })) : null);
  }
  function ownerTab() {
    const kk = k(), out = [];
    st.order ||= {};
    const ids = Object.keys(ING).sort((a, b) => ING[a].name.localeCompare(ING[b].name));
    const menuNeeds = new Set((kk.menu || []).flatMap((d) => Object.keys(needs(recipeOf(R, d, kk.house_menu)?.build || []))));
    const cost = Object.entries(st.order).reduce((s, [i, n]) => s + ingCost(R, i, n), 0);
    out.push(h("h4", { textContent: "Order for the pantry" }), h("p", { className: "note", textContent: `Paid from the business (${fmt(kk.balance || 0)}); in the pantry within 12 game hours. What the menu uses comes first.` }),
      h("table", {}, ...ids.filter((i) => menuNeeds.has(i) || kk.pantry[i] > 0).concat(ids.filter((i) => !menuNeeds.has(i) && !(kk.pantry[i] > 0))).slice(0, 140).map((i) => h("tr", {},
        h("td", { textContent: ING[i].name }), h("td", { className: "note", textContent: `${displayAmount(R, i, kk.pantry[i] || 0)} in · ${fmt(ingCost(R, i))} per ${ING[i].unit} (${ING[i].grams} g)` }),
        h("td", {}, h("input", { type: "number", min: "0", value: String(st.order[i] || ""), style: "width:5em", oninput: (e) => { st.order[i] = Math.max(0, +e.target.value || 0); } }))))),
      h("div", { className: "chips", style: "margin:6px 0" }, h("button", { textContent: "Fill to a week of the menu", onclick: () => { fillWeek(); hud(); } }),
        h("button", { className: "primary", textContent: `Order (${fmt(cost)})`, onclick: async () => { const items = Object.fromEntries(Object.entries(st.order).filter(([, n]) => n > 0)); const r = await run("kitchen_order", { items }); if (r) { notify(`Ordered: ${fmt(r.cost)}.`); st.order = {}; hud(); } } })));
    const pend = (kk.proposals || []).filter((p) => p.status === "pending");
    out.push(h("h4", { textContent: "Dishes put to you" }), pend.length ? h("div", {}, ...pend.map((pr) => {
      const price = h("input", { type: "number", step: "0.5", value: String(pr.price / R.money(1)), style: "width:5em" });
      return h("div", { className: "result" }, h("b", { textContent: `"${pr.name}" by ${pr.by}: ${pr.taste}/100` }), h("div", { className: "note", textContent: `+${pr.stamina} stamina, ${pr.health} health · costs ${fmt(pr.cost)} · asks ${fmt(pr.price)}` }),
        h("div", { className: "note", textContent: pr.build.map((c) => `${c.qty} ${iname(c.ing).toLowerCase()}${chain(c.p).length ? ` ${chain(c.p).map((p) => P[p].verb).join(", ")}` : ""}`).join(" · ") }),
        h("div", { className: "chips" }, h("span", { className: "note", textContent: "₡" }), price,
          h("button", { className: "primary", textContent: "On the menu", onclick: async () => { if (await run("kitchen_decide", { proposal: pr.id, accept: true, price: Math.round(+price.value * R.money(1)) })) hud(); } }),
          h("button", { textContent: "Not now", onclick: async () => { if (await run("kitchen_decide", { proposal: pr.id, accept: false })) hud(); } })));
    })) : h("p", { className: "note", textContent: "None waiting." }));
    out.push(h("h4", { textContent: "Your kitchen staff" }), (kk.staff || []).length ? h("table", {}, ...kk.staff.map((s) => h("tr", {}, h("td", { textContent: s.name }),
      h("td", { textContent: `rating ${s.rating}` }), h("td", { className: "note", textContent: `${s.served} served, ${s.walkouts} walked · avg ${s.served ? Math.round(s.score_sum / s.served) : "–"} · comps ${fmt(s.comps)} · waste ${fmt(s.waste)} · lab ${fmt(s.lab)}` })))) : h("p", { className: "note", textContent: "No one has worked the line yet." }));
    out.push(logList());
    return out;
  }
  function fillWeek() {
    const kk = k();
    for (const d of kk.menu || []) for (const [i, n] of Object.entries(needs(recipeOf(R, d, kk.house_menu)?.build || []))) st.order[i] = Math.max(st.order[i] || 0, Math.ceil(n * 40 - (kk.pantry[i] || 0)));
    for (const [i, n] of Object.entries(st.order)) if (n <= 0) delete st.order[i];
  }
  function recordTab() {
    const kk = k(), s = kk.record;
    const out = [h("h4", { textContent: `Your rating: ${kk.rating}` }),
      h("p", { className: "note", textContent: `${kk.owner_name} sees it: how well you cook and how few customers walk out, less what you give away and spoil against what you sell. A low one gets a warning, then your notice.` })];
    if (s) out.push(h("table", {}, ...[["Served", s.served], ["Walked out", s.walkouts], ["Average plate", s.served ? `${Math.round(s.score_sum / s.served)}/100` : "–"], ["Tips", fmt(s.tips)],
      ["Sold", fmt(s.sales)], ["On the house", `${fmt(s.comps)} (${s.comps_n})`], ["Spoiled", fmt(s.waste)], ["Lab tests", `${s.tests} (${fmt(s.lab)})`], ["Your dishes on the menu", s.dishes]].map(([a, b]) => h("tr", {}, h("td", { textContent: a }), h("td", { textContent: String(b) })))));
    out.push(logList());
    return out;
  }
  function logList() {
    const log = (k().log || []).slice(-14).reverse();
    return h("div", {}, h("h4", { textContent: "The kitchen's log" }), ...log.map((e) => h("div", { className: "note", textContent: `${e.memo}${e.cost ? ` (${fmt(e.cost)})` : ""}${e.score !== undefined && e.kind === "served" ? ` · ${e.score}/100` : ""}` })));
  }

  return { actions, todo, open, close, isOpen: () => Boolean(el), debug: () => st };
}
