// The bag's verbs and the Sell window (docs/city/commerce.mjs in the world): what the thing in
// your hand can be used for here and now, how it looks on inspection, and who would buy it --
// a counter's offer with its reasons, a consignment, a listing on the board or shipped, and the
// receipt of a shipped sale in its five parts. Kept out of view.mjs, which calls bagExtra and draw.

const HOUR = 3_600_000;

export function commercePanels(api) {
  const { R, h, notify, send, self, me, getView, placeArg, nearestPlace, openSide, drawSide, getSide, people, peers, openMessages, syncSlots } = api;
  const looks = new Map();   // item -> its last inspection, for the bag's line
  const quotes = new Map();  // channel -> quote, in the Sell window
  const done = (text) => (r) => { notify(r.ok ? (typeof text === "function" ? text(r) : text) : r.error); syncSlots?.(true); drawSide(); return r; };
  const name = (sku) => (R.items[sku]?.name || sku).toLowerCase();
  const btn = (label, fn, { primary = false, disabled = false, title = "" } = {}) => h("button", { textContent: label, className: primary ? "primary" : "", disabled, title, onclick: fn });

  //: What is round you that a verb needs: someone to give to, something broken, litter.
  function nearNow() {
    const w = getView(), at = me();
    let npc = null, best = 3.2;
    for (const q of people() || []) {
      if (q.indoors || q.down) continue;
      const d = Math.hypot(q.x - at.x, q.z - at.z);
      if (d < best) { best = d; npc = { id: q.id, name: q.person?.name || null, x: q.x, z: q.z, role: q.person?.role || null }; }
    }
    let damaged = null;
    for (const d of w?.damage?.values() || []) if (Math.hypot(d.x - at.x, d.z - at.z) < 4 && (d.wear > 0 || d.broken)) { damaged = d; break; }
    const litter = [...(w?.items?.values() || [])].filter((x) => (x.by === "litter" || x.by === "debris") && Math.hypot(x.x - at.x, x.z - at.z) < 6).map((x) => x.id);
    return { nearNpc: npc, damagedNear: damaged, litterNear: litter.length > 0, litter };
  }
  //: The verbs' buttons for ``sku`` in the bag (Eat, Wear and Put down are the view's own).
  function bagExtra(sku) {
    const w = getView(), p = self();
    if (!w?.verbsFor || !p) return [];
    const n = nearNow();
    let verbs;
    try { verbs = w.verbsFor(p.id, sku, { nearNpc: n.nearNpc, damagedNear: n.damagedNear, litterNear: n.litterNear }); } catch { return []; }
    const out = [], skip = new Set(["consume", "wear", "inspect"]);
    for (const v of verbs) {
      if (skip.has(v.verb)) continue;
      out.push(btn(v.label, () => runVerb(sku, v.verb, n), { disabled: !v.ok, title: v.why || "" }));
    }
    out.push(btn("Look it over", () => send("inspect", { item: sku }).then((r) => { if (r.ok) looks.set(sku, r); else notify(r.error); drawSide(); })));
    const it = R.items[sku];
    if (it && !it.service && !it.parcel) out.push(btn("Sell…", () => { openSide("sell"); const s = getSide(); if (s) { s.pick = sku; drawSide(); } }));
    const look = looks.get(sku);
    const lines = [];
    if (look) {
      const bits = [`${look.condition}`, ...look.seen];
      if (look.device) bits.push(look.device.fault && look.device.fault !== "unknown" ? `fault: ${look.device.fault}` : `battery ${Math.round(look.device.battery * 100)}%, ${look.device.risk}`);
      if (look.charge !== null && look.charge !== undefined) bits.push(`charge ${Math.round(look.charge * 100)}%`);
      if (look.uses_left !== null && look.uses_left !== undefined) bits.push(`${look.uses_left} uses left`);
      if (look.fill?.l) bits.push(`${look.fill.l} l of water`);
      lines.push(h("p", { className: "note", textContent: `Looked over: ${bits.join(" · ")}.` }));
    }
    return [h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px" }, ...out), ...lines];
  }
  async function runVerb(sku, verb, n) {
    const args = { item: sku, verb };
    if (verb === "gift") args.npc = n.nearNpc;
    if (verb === "repair" && n.damagedNear) args.target = { key: n.damagedNear.key, archetype: n.damagedNear.archetype, x: n.damagedNear.x, z: n.damagedNear.z };
    if (verb === "clean") args.litter = n.litter;
    if (verb === "mail") {
      const list = peers().filter((x) => x.pid);
      if (!list.length) { notify("Post it to whom? Another player in your party."); return; }
      args.to = list[0].pid;
    }
    if (verb === "pack") {
      const p = self(), choices = Object.keys(p.inventory || {}).filter((k) => k !== sku && k !== "parcel" && R.items[k] && !R.items[k].service);
      if (!choices.length) { notify("Nothing else to put in it."); return; }
      const s = getSide(); if (s) { s.packing = sku; s.packChoices = choices; drawSide(); }
      return;
    }
    if (verb === "phone") { openMessages?.(); }
    const r = await send("apply", args);
    if (!r.ok) { notify(r.error); drawSide(); return; }
    notify(verbText(sku, verb, r));
    syncSlots?.(true); drawSide();
  }
  function verbText(sku, verb, r) {
    const fx = (e) => Object.entries(e || {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ");
    switch (verb) {
      case "read": return r.map ? "You know the district's streets by name now." : r.news ? `Today's paper: ${Object.entries(r.news.kinds).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).slice(0, 5).join(", ") || "a quiet day"}.` : `Read for ${r.minutes} min${fx(r.effect) ? `: ${fx(r.effect)}` : ""}${r.first ? "" : " (read before)"}.`;
      case "place": return `Put up at home: your rest there is ${Math.round(r.comfort.rest_bonus * 100)}% better.`;
      case "unplace": return `Taken down: ${name(r.item)}.`;
      case "gift": return `${r.to || "They"} thank you for the ${name(sku)}.`;
      case "install": return `Fitted: the car is at ${r.condition}%${r.wheels < 4 ? `, ${r.wheels} wheels` : ""}.`;
      case "repair": return r.mended ? `Mended${r.restitution === "dismissed" ? ": the court's repair bill is dismissed" : r.paid ? `: public works pays you ${R.fmt(r.paid)}` : ""}.` : `Mended a part of it (used the ${name(r.used)}); ${Math.round(r.share * 100)}% still to do.`;
      case "cook": return `Cooked ${r.qty} ${name(r.makes)} (${r.minutes} min).`;
      case "groom": return `Freshened up${r.uses_left ? ` (${r.uses_left} uses left)` : ""}.`;
      case "fill": return `Filled with ${r.fill.l} l of water.`;
      case "drink_fill": return `Water: ${fx(r.effect) || "refreshing"}.`;
      case "light": return r.lit ? `Lit: about ${Math.round(r.hours)} hours in it.` : `Put out (${Math.round((r.charge ?? 0) * 100)}% left).`;
      case "charge": return `${R.items[r.device].name} charged.`;
      case "lock": return "Locked: it takes bolt cutters to take it now.";
      case "mail": return "Posted.";
      case "clean": return `Swept up ${r.swept} piece${r.swept > 1 ? "s" : ""} of litter: ${R.fmt(r.pay)} from the city.`;
      case "disassemble": return `Taken apart: ${Object.entries(r.got).map(([k, v]) => `${v} ${name(k.split(":")[0])}${k.includes(":") ? " (damaged)" : ""}`).join(", ") || "nothing usable"}.`;
      case "open": return r.inside.length ? `Opened: ${r.inside.map(name).join(", ")} inside.` : "Opened: empty.";
      case "unpack": return r.out.length ? `Took out ${r.out.map(name).join(", ")}.` : "Nothing in it you could keep.";
      case "seal": return "Sealed.";
      case "test": return r.device.fault ? `Tested: ${r.device.fault} fault.` : `Tested: works, battery ${Math.round(r.device.battery * 100)}%.`;
      default: return "Done.";
    }
  }
  //: The packing picker, under the bag's buttons while it is open.
  function packing(side) {
    if (!side.packing) return [];
    return [h("p", { className: "note", textContent: `Put what in the ${name(side.packing)}?` }),
      h("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, ...side.packChoices.map((k) => btn(R.items[k].name, () => {
        const box = side.packing; side.packing = null;
        send("apply", { item: box, verb: "pack", what: k }).then(done((r) => `In the ${name(box)}: ${r.inside} thing${r.inside > 1 ? "s" : ""}, ${Math.round(r.kg * 10) / 10} kg.`));
      })), btn("Never mind", () => { side.packing = null; drawSide(); }))];
  }

  // ---- selling -----------------------------------------------------------------------------------
  function draw(side, { close, status, w, p }) {
    if (side.kind !== "sell") return false;
    const C = R.commerce.resale.channels;
    const sku = side.pick && p.inventory[side.pick] > 0 ? side.pick : null;
    const out = [h("h3", {}, h("span", { textContent: sku ? `Sell: ${R.items[sku].name}` : "Selling" }), close), status];
    const shop = nearestPlace((pl) => (pl.shops || []).length > 0, 30);
    if (sku) {
      const group = w.channelsAt ? null : null;
      const here = shop && w.channelsAt ? w.channelsAt(placeArg(shop), resaleGroupOf(sku)) : [];
      out.push(h("p", { className: "note", textContent: shop ? `Here: ${shop.name || shop.shops[0] || "a shop"}${here.length ? ` — ${here.map((c) => C[c].name.toLowerCase()).join(", ")}` : " — buys nothing like it"}.` : "No shop near: a listing on the board, or shipped, can be made anywhere." }));
      for (const ch of [...here.filter((c) => c !== "consignment"), "listing", "shipped", ...here.filter((c) => c === "consignment")]) {
        const q = quotes.get(`${sku}:${ch}`);
        const rowEls = [h("b", { textContent: C[ch].name }), h("span", { className: "note", textContent: ` ${C[ch].note || ""}` })];
        if (["pawn", "specialist", "recycler", "consignment"].includes(ch)) {
          if (q && q.expires > Date.now() - 1) {
            rowEls.push(h("div", { className: "note", textContent: `${ch === "consignment" ? `Priced at ${R.fmt(q.amount)}; you get ${R.fmt(Math.round(q.amount * (1 - q.commission)))} if it sells (${Math.round(q.commission * 100)}% to the shop), within ${q.days} days.` : `Offer: ${R.fmt(q.amount)}`} — ${q.why.join("; ")}. Good for ${Math.max(1, Math.round((q.expires - (w.now || Date.now())) / HOUR))} h.` }));
            rowEls.push(ch === "consignment"
              ? btn("Leave it with them", () => send("consign", { item: sku, place: placeArg(shop), price: q.amount }).then(done("Left on consignment: you will hear when it sells.")), { primary: true })
              : btn(`Sell for ${R.fmt(q.amount)}`, () => send("sell", { quote: q.id }).then(done((r) => `Sold for ${R.fmt(r.amount)}.`)), { primary: true, disabled: q.amount <= 0 }));
          } else rowEls.push(btn("Ask for an offer", () => send("sell_quote", { item: sku, channel: ch, place: placeArg(shop) }).then((r) => { if (r.ok) quotes.set(`${sku}:${ch}`, r.quote); else notify(r.error); drawSide(); })));
        } else {
          const input = h("input", { type: "number", min: "1", step: "1", value: String(Math.max(1, Math.round(R.items[sku].price * 0.6 / R.currency.unit))), style: "width:6em" });
          rowEls.push(h("div", {}, h("span", { className: "note", textContent: "Asking " }), input, " ",
            btn(ch === "shipped" ? "List it shipped" : "Put it on the board", () => send("list_item", { item: sku, channel: ch, price: R.money(Number(input.value) || 0) }).then(done(ch === "shipped" ? "Listed: a buyer will message you; then pack it, seal it and take it to a Print and ship counter." : "On the board: a buyer near you will message you.")))));
        }
        out.push(h("div", { style: "margin:8px 0;padding:6px 0;border-top:1px solid rgba(128,128,128,.25)" }, ...rowEls));
      }
    } else out.push(h("p", { className: "note", textContent: "Choose a thing in your inventory (I), then Sell…" }));
    // Yours on the market.
    const mine = w.listingsOf ? w.listingsOf(p.id) : [], left = w.consignedOf ? w.consignedOf(p.id) : [];
    if (mine.length || left.length) out.push(h("h4", { textContent: "Yours on the market" }));
    for (const l of mine) {
      const bits = [h("span", { textContent: `${R.items[l.sku].name}, ${R.fmt(l.price)} ${l.channel === "shipped" ? "shipped" : "on the board"} — ${({ listed: "waiting for a buyer", buyer: "a buyer has asked (Messages)", to_ship: "sold: pack, seal and take it to Print and ship" })[l.status] || l.status}` })];
      if (l.status === "to_ship") {
        const r = l.receipt;
        if (r) bits.push(h("div", { className: "note", textContent: `You ${R.fmt(r.seller)} · commission ${R.fmt(r.commission)} · carrier ${R.fmt(r.carrier)} · sales tax ${R.fmt(r.tax)} · the buyer pays ${R.fmt(r.total)}. (${r.policy})` }));
        const ps = nearestPlace((pl) => (pl.keys || []).includes("shop:print_ship"), 30);
        bits.push(btn("Hand it to the carrier", () => send("ship_listing", { listing: l.id, place: ps ? placeArg(ps) : null }).then(done((x) => `Shipped: ${R.fmt(x.receipt.seller)} to you.`)), { primary: true, disabled: !ps, title: ps ? "" : "at a Print and ship counter" }));
      }
      if (l.status === "buyer") bits.push(btn("Messages", () => openMessages?.()));
      bits.push(btn("Take it off", () => send("unlist", { listing: l.id }).then(done("Listing taken off."))));
      out.push(h("div", { style: "margin:6px 0" }, ...bits));
    }
    for (const c of left) {
      const bits = [h("span", { textContent: `${R.items[c.sku].name} at ${c.place.name || "a shop"}, ${R.fmt(c.price)} — ${c.status === "returned" ? "unsold: collect it" : c.status === "sold" ? `sold: ${R.fmt(c.paid)} to you` : "on consignment"}` })];
      if (c.status === "returned") bits.push(btn("Collect it", () => send("collect_consigned", { consignment: c.id }).then(done("Collected."))));
      out.push(h("div", { style: "margin:6px 0" }, ...bits));
    }
    side.el.replaceChildren(...out);
    return true;
  }
  const resaleGroupOf = (sku) => {
    const it = R.items[sku];
    for (const [id, g] of Object.entries(R.commerce.resale.groups)) if (g.match?.skus?.includes(sku)) return id;
    for (const [id, g] of Object.entries(R.commerce.resale.groups)) { const m0 = g.match || {}; if (m0.kinds?.includes(it.kind) || m0.materials?.includes(it.material_of) || (m0.tools && it.tool) || (m0.wear && it.wear)) return id; }
    return "none";
  };
  //: A car of yours near: take a wheel off (with a wrench), or unlock it.
  function carExtra(a) {
    const p = self(), at = me();
    if (!p || a.attrs.x === undefined || Math.hypot(a.attrs.x - at.x, a.attrs.z - at.z) > 5) return [];
    const out = [];
    if ((a.attrs.wheels ?? 4) > 0) out.push(btn("Take a wheel off", () => send("remove_part", { vehicle: a.id, part: "wheel" }).then(done((r) => r.result === "usable" ? `The wheel is off (${r.wheels} left on).` : r.result === "damaged" ? `It came off, but the tyre is damaged (${r.wheels} left on).` : r.result === "stuck" ? "Stuck fast: the nuts will not turn. Try again, or with a better tool." : "No wheel left to take."))));
    if (a.attrs.locked) out.push(btn("Unlock it", () => send("apply", { verb: "unlock", item: null, vehicle: a.id }).then(done("Unlocked: the lock is in your bag."))));
    return out;
  }
  return { bagExtra, draw, packing, carExtra, nearNow };
}
