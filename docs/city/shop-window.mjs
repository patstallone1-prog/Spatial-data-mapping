// What a clerk's link opens, in the middle of the screen (docs/city/clerk.mjs): a restaurant's
// menu, or a shop's wares.
//
// Two menus, as restaurants print them:
//   - "fine": a sit-down menu -- black card, a serif face, each dish's name, a line of what is in
//     it and its price as a bare number, in sections (starters, mains, desserts, drinks);
//   - "board": a counter's board (a coffee bar's, a burger stand's) -- big type, the name and the
//     price and little else, in columns.
// And a shop's catalogue laid out as the big online stores lay theirs: a grid of cards, each its
// picture, name, what it does and price with an Add to basket button, the basket alongside with
// its total and Checkout.
//
// Every dish and every item has a picture slot (``data-photo-slot``): an item's ``photo`` (a URL)
// fills it; until there are photos it shows the dish's name in the menu's own style.
//
// The page gives it ``h`` (the city's element maker), the money format and what to do on order
// and checkout; it keeps the basket while it is open.

const CSS = `
#city-shop-window{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,.48);backdrop-filter:blur(2px)}
#city-shop-window[hidden]{display:none}
#city-shop-window .sw-card{position:relative;max-width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.45)}
#city-shop-window .sw-x{position:absolute;top:10px;right:12px;z-index:2;border:0;background:rgba(127,127,127,.18);color:inherit;width:30px;height:30px;border-radius:15px;font-size:18px;cursor:pointer}
#city-shop-window .sw-basket{display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;padding:12px 18px;position:sticky;bottom:0}
#city-shop-window .sw-basket button{cursor:pointer}
#city-shop-window [data-photo-slot]{display:flex;align-items:center;justify-content:center;overflow:hidden;text-align:center}
#city-shop-window [data-photo-slot] img{width:100%;height:100%;object-fit:cover;display:block}
/* the sit-down menu */
#city-shop-window .sw-fine{background:#0b0b0b;color:#efe8da;width:min(760px,calc(100vw - 32px));padding:38px 46px 8px;font-family:Didot,"Bodoni 72","Bodoni MT","Playfair Display","Cormorant Garamond",Garamond,"Times New Roman",serif}
#city-shop-window .sw-fine h2{font-weight:400;font-size:34px;letter-spacing:.14em;text-transform:uppercase;text-align:center;margin:0 0 4px}
#city-shop-window .sw-fine .sw-sub{text-align:center;font-style:italic;color:#b9ad97;margin:0 0 22px;font-size:15px}
#city-shop-window .sw-fine .sw-photos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 26px}
#city-shop-window .sw-fine .sw-photos [data-photo-slot]{aspect-ratio:4/3;border:1px solid #3a352c;color:#6f675a;font-style:italic;font-size:13px;padding:6px}
#city-shop-window .sw-fine h3{font-weight:400;font-size:15px;letter-spacing:.32em;text-transform:uppercase;text-align:center;color:#cbb682;margin:22px 0 12px;border-top:1px solid #2c2822;padding-top:16px}
#city-shop-window .sw-fine .sw-dish{display:grid;grid-template-columns:1fr auto;gap:2px 18px;padding:7px 8px;margin:0 -8px;border-radius:4px;cursor:pointer}
#city-shop-window .sw-fine .sw-dish:hover{background:#17150f}
#city-shop-window .sw-fine .sw-dish.on{background:#1d1a12}
#city-shop-window .sw-fine .sw-name{font-size:18px;letter-spacing:.06em;text-transform:uppercase}
#city-shop-window .sw-fine .sw-price{font-size:18px}
#city-shop-window .sw-fine .sw-desc{grid-column:1/-1;font-style:italic;color:#a59b88;font-size:14px;line-height:1.35}
#city-shop-window .sw-fine .sw-n{grid-column:1/-1;color:#cbb682;font-size:13px}
#city-shop-window .sw-fine .sw-basket{background:linear-gradient(transparent,#0b0b0b 30%);margin:0 -46px;padding:18px 46px 20px;font-family:Georgia,serif}
#city-shop-window .sw-fine .sw-basket button{background:transparent;border:1px solid #cbb682;color:#efe8da;padding:8px 18px;letter-spacing:.12em;text-transform:uppercase;font-family:inherit}
#city-shop-window .sw-fine .sw-basket button.primary{background:#cbb682;color:#0b0b0b}
#city-shop-window .sw-fine .sw-x{color:#efe8da}
/* the counter's board */
#city-shop-window .sw-board{background:#1f2a24;color:#fbfaf5;width:min(980px,calc(100vw - 32px));padding:26px 30px 6px;font-family:"Helvetica Neue","Arial Black",Arial,sans-serif;border:10px solid #12100d}
#city-shop-window .sw-board h2{font-size:40px;font-weight:900;text-transform:uppercase;margin:0 0 14px;letter-spacing:.02em}
#city-shop-window .sw-board .sw-photos{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 18px}
#city-shop-window .sw-board .sw-photos [data-photo-slot]{aspect-ratio:1/1;background:#2a3832;color:#9fb3a8;font-weight:700;font-size:15px;text-transform:uppercase;padding:6px;border-radius:6px}
#city-shop-window .sw-board .sw-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:6px 34px}
#city-shop-window .sw-board h3{font-size:22px;font-weight:900;text-transform:uppercase;color:#f4c84a;margin:10px 0 6px;border-bottom:3px solid #f4c84a;padding-bottom:4px}
#city-shop-window .sw-board .sw-dish{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 6px;margin:0 -6px;border-radius:6px;cursor:pointer}
#city-shop-window .sw-board .sw-dish:hover{background:#2a3832}
#city-shop-window .sw-board .sw-dish.on{background:#35473f}
#city-shop-window .sw-board .sw-name{font-size:23px;font-weight:800;text-transform:uppercase}
#city-shop-window .sw-board .sw-price{font-size:25px;font-weight:900;color:#f4c84a}
#city-shop-window .sw-board .sw-n{font-size:15px;color:#9fe0b3;margin-left:6px}
#city-shop-window .sw-board .sw-basket{background:#1f2a24;margin:0 -30px;padding:14px 30px 18px;border-top:2px solid #35473f}
#city-shop-window .sw-board .sw-basket button{font:inherit;font-weight:800;text-transform:uppercase;padding:10px 18px;border-radius:6px;border:0;background:#35473f;color:#fff}
#city-shop-window .sw-board .sw-basket button.primary{background:#f4c84a;color:#1f2a24}
#city-shop-window .sw-board .sw-x{color:#fff}
/* the shop's catalogue */
#city-shop-window .sw-shop{background:#fff;color:#0f1111;width:min(1080px,calc(100vw - 32px));font-family:"Amazon Ember",Arial,"Helvetica Neue",sans-serif;padding:0}
#city-shop-window .sw-shop header{background:#131921;color:#fff;padding:14px 56px 14px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
#city-shop-window .sw-shop header h2{font-size:20px;margin:0;font-weight:700}
#city-shop-window .sw-shop header .sw-sub{color:#ccc;font-size:13px}
#city-shop-window .sw-shop header input{flex:1;min-width:160px;max-width:420px;padding:8px 10px;border-radius:6px;border:0;font-size:14px}
#city-shop-window .sw-shop nav{background:#232f3e;color:#fff;padding:6px 20px;display:flex;gap:4px;flex-wrap:wrap}
#city-shop-window .sw-shop nav button{background:transparent;color:#fff;border:1px solid transparent;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:13px}
#city-shop-window .sw-shop nav button[aria-pressed=true]{border-color:#fff}
#city-shop-window .sw-shop .sw-body{display:grid;grid-template-columns:1fr 250px;gap:16px;padding:16px 20px}
@media (max-width:720px){#city-shop-window .sw-shop .sw-body{grid-template-columns:1fr}}
#city-shop-window .sw-shop .sw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
#city-shop-window .sw-shop .sw-item{border:1px solid #e3e6e6;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px}
#city-shop-window .sw-shop .sw-item [data-photo-slot]{aspect-ratio:1/1;background:#f7f8f8;border-radius:4px;color:#565959;font-size:13px;padding:8px}
#city-shop-window .sw-shop .sw-name{font-size:15px;line-height:1.3;color:#0f1111}
#city-shop-window .sw-shop .sw-desc{font-size:12px;color:#565959}
#city-shop-window .sw-shop .sw-price{font-size:21px;font-weight:500}
#city-shop-window .sw-shop .sw-price small{font-size:12px;color:#565959;font-weight:400}
#city-shop-window .sw-shop .sw-add{background:#ffd814;border:1px solid #fcd200;border-radius:20px;padding:7px 10px;cursor:pointer;font-size:13px}
#city-shop-window .sw-shop .sw-add:hover{background:#f7ca00}
#city-shop-window .sw-shop .sw-qty{display:flex;align-items:center;gap:6px;font-size:13px}
#city-shop-window .sw-shop .sw-qty button{width:26px;height:26px;border-radius:13px;border:1px solid #d5d9d9;background:#fff;cursor:pointer}
#city-shop-window .sw-shop aside{border:1px solid #e3e6e6;border-radius:8px;padding:12px;align-self:start;position:sticky;top:12px}
#city-shop-window .sw-shop aside h4{margin:0 0 8px;font-size:16px}
#city-shop-window .sw-shop aside .sw-line{display:flex;justify-content:space-between;gap:8px;font-size:13px;margin:4px 0}
#city-shop-window .sw-shop aside .sw-total{font-size:17px;font-weight:700;margin:10px 0}
#city-shop-window .sw-shop aside button.primary{width:100%;background:#ffa41c;border:1px solid #ff8f00;border-radius:20px;padding:9px;cursor:pointer;font-size:14px}
#city-shop-window .sw-shop aside button.primary:disabled{opacity:.5;cursor:default}
#city-shop-window .sw-shop .sw-x{color:#fff;background:rgba(255,255,255,.15)}
#city-shop-window .sw-note{font-size:13px;opacity:.8;margin-right:auto}
`;

//: The sections of a menu in the order a menu runs.
const SECTION_ORDER = ["Specials", "Starters", "Small plates", "Salads", "Soups", "Mains", "Entrees", "Sandwiches", "Burgers", "Pizza", "Pasta", "Bowls", "Sides", "Desserts", "Coffee", "Tea", "Drinks", "Beer", "Wine"];
const orderOf = (s) => { const i = SECTION_ORDER.findIndex((x) => x.toLowerCase() === String(s).toLowerCase()); return i < 0 ? 50 : i; };

//: The window, with ``api``: {h, doc, fmt(minor), price(minor) -> a menu's bare number,
//: order(lines) -> Promise<{ok, error?}>, checkout(lines) -> Promise<{ok, error?, text?}>}.
export function shopWindow(api) {
  const { h, doc = document } = api;
  let el = null, st = null;
  function style() {
    if (doc.getElementById("city-shop-window-css")) return;
    const s = doc.createElement("style"); s.id = "city-shop-window-css"; s.textContent = CSS; doc.head.append(s);
  }
  function close() { el?.remove(); el = null; st = null; doc.removeEventListener("keydown", onKey, true); }
  function onKey(e) { if (e.key === "Escape" && el) { e.stopPropagation(); e.preventDefault(); close(); } }
  //: Open a menu or a shop. ``spec``: {kind: "menu" | "shop", style: "fine" | "board", title,
  //: subtitle, items: [{id, name, description?, price (minor), section?, photo?, info?}],
  //: categories?: [{id, name, items: [ids]}]}.
  function open(spec) {
    style();
    close();
    st = { spec, basket: {}, cat: null, q: "", busy: false, note: "" };
    el = h("div", { id: "city-shop-window", role: "dialog", "aria-modal": "true", "aria-label": spec.title || "Menu" });
    el.addEventListener("pointerdown", (e) => { if (e.target === el) close(); });
    el.addEventListener("keydown", (e) => e.stopPropagation());
    doc.body.append(el);
    doc.addEventListener("keydown", onKey, true);
    draw();
    return api;
  }
  const lines = () => Object.entries(st.basket).filter(([, n]) => n > 0).map(([id, qty]) => ({ id, qty, item: st.spec.items.find((x) => x.id === id) })).filter((l) => l.item);
  const subtotal = () => lines().reduce((s, l) => s + l.item.price * l.qty, 0);
  const add = (id, d) => { st.basket[id] = Math.max(0, Math.min(20, (st.basket[id] || 0) + d)); st.note = ""; draw(); };
  const photo = (it, cls = "") => h("div", { className: cls, "data-photo-slot": it?.id || "" }, it?.photo ? h("img", { src: it.photo, alt: it.name, loading: "lazy" }) : h("span", { textContent: it?.name || "" }));
  async function submit(kind) {
    if (st.busy || !lines().length) return;
    st.busy = true; draw();
    const r = await (kind === "menu" ? api.order : api.checkout)(lines().map((l) => ({ item: l.id, qty: l.qty })));
    if (!st) return;
    st.busy = false;
    if (r?.ok) { close(); return; }
    st.note = r?.error || "That did not go through."; draw();
  }
  function basketBar(kind) {
    const n = lines().reduce((s, l) => s + l.qty, 0);
    return h("div", { className: "sw-basket" },
      h("span", { className: "sw-note", textContent: st.note || (n ? `${n} ${kind === "menu" ? "ordered" : "in the basket"} · ${api.fmt(subtotal())} before tax` : kind === "menu" ? "Click a dish to order it; click again for another." : "") }),
      n ? h("button", { textContent: "Clear", onclick: () => { st.basket = {}; draw(); } }) : "",
      h("button", { className: "primary", textContent: st.busy ? "…" : kind === "menu" ? "Place the order" : "Checkout", disabled: !n || st.busy, onclick: () => submit(kind) }));
  }
  function sections(items) {
    const by = new Map();
    for (const it of items) { const s = it.section || "Menu"; if (!by.has(s)) by.set(s, []); by.get(s).push(it); }
    return [...by.entries()].sort((a, b) => orderOf(a[0]) - orderOf(b[0]));
  }
  function menuCard() {
    const S = st.spec, fine = S.style !== "board";
    const featured = S.items.filter((it) => it.section !== "Drinks" && it.section !== "Sides").slice(0, fine ? 3 : 4);
    const dish = (it) => {
      const n = st.basket[it.id] || 0;
      return h("div", { className: `sw-dish${n ? " on" : ""}`, title: n ? "Click for another; right-click for one fewer" : "Click to order",
        onclick: () => add(it.id, 1), oncontextmenu: (e) => { e.preventDefault(); add(it.id, -1); } },
        h("span", { className: "sw-name", textContent: it.name }, ...(fine ? [] : n ? [h("span", { className: "sw-n", textContent: `×${n}` })] : [])),
        h("span", { className: "sw-price", textContent: fine ? api.price(it.price) : api.fmt(it.price) }),
        ...(fine && it.description ? [h("span", { className: "sw-desc", textContent: it.description })] : []),
        ...(fine && n ? [h("span", { className: "sw-n", textContent: `ordered ×${n}` })] : []));
    };
    const body = sections(S.items).map(([name, list]) => h("section", {}, h("h3", { textContent: name }), ...list.map(dish)));
    return h("div", { className: `sw-card ${fine ? "sw-fine" : "sw-board"}` },
      h("button", { className: "sw-x", textContent: "×", title: "Close (Esc)", onclick: close }),
      h("h2", { textContent: S.title || "Menu" }),
      fine && S.subtitle ? h("p", { className: "sw-sub", textContent: S.subtitle }) : "",
      h("div", { className: "sw-photos" }, ...featured.map((it) => photo(it))),
      fine ? h("div", {}, ...body) : h("div", { className: "sw-cols" }, ...body),
      basketBar("menu"));
  }
  function shopCard() {
    const S = st.spec, cats = S.categories || [];
    const q = st.q.trim().toLowerCase();
    let list = S.items;
    if (st.cat) { const c = cats.find((x) => x.id === st.cat); if (c) list = list.filter((it) => c.items.includes(it.id)); }
    if (q) list = list.filter((it) => `${it.name} ${it.info || ""} ${it.description || ""}`.toLowerCase().includes(q));
    const search = h("input", { type: "search", placeholder: `Search ${S.title || "the shop"}`, value: st.q, oninput: (e) => { st.q = e.target.value; const at = e.target.selectionStart; draw(); const i = el?.querySelector("header input"); if (i) { i.focus(); i.setSelectionRange(at, at); } } });
    const card = (it) => {
      const n = st.basket[it.id] || 0;
      return h("div", { className: "sw-item" }, photo(it),
        h("div", { className: "sw-name", textContent: it.name }),
        it.info ? h("div", { className: "sw-desc", textContent: it.info }) : "",
        h("div", { className: "sw-price", textContent: api.fmt(it.price) }, it.tax ? h("small", { textContent: ` +${api.fmt(it.tax)} tax` }) : ""),
        n ? h("div", { className: "sw-qty" }, h("button", { textContent: "−", onclick: () => add(it.id, -1) }), h("b", { textContent: String(n) }), h("button", { textContent: "+", onclick: () => add(it.id, 1) }), h("span", { textContent: "in basket" }))
          : h("button", { className: "sw-add", textContent: "Add to basket", onclick: () => add(it.id, 1) }));
    };
    const L = lines();
    return h("div", { className: "sw-card sw-shop" },
      h("button", { className: "sw-x", textContent: "×", title: "Close (Esc)", onclick: close }),
      h("header", {}, h("div", {}, h("h2", { textContent: S.title || "Shop" }), S.subtitle ? h("div", { className: "sw-sub", textContent: S.subtitle }) : ""), search),
      cats.length > 1 ? h("nav", {}, h("button", { textContent: "All", "aria-pressed": String(!st.cat), onclick: () => { st.cat = null; draw(); } }),
        ...cats.map((c) => h("button", { textContent: c.name, "aria-pressed": String(st.cat === c.id), onclick: () => { st.cat = c.id; draw(); } }))) : "",
      h("div", { className: "sw-body" },
        list.length ? h("div", { className: "sw-grid" }, ...list.map(card)) : h("p", { textContent: "Nothing here matches." }),
        h("aside", {}, h("h4", { textContent: "Basket" }),
          ...(L.length ? L.map((l) => h("div", { className: "sw-line" }, h("span", { textContent: `${l.qty} × ${l.item.name}` }), h("span", { textContent: api.fmt(l.item.price * l.qty) }))) : [h("div", { className: "sw-desc", textContent: "Your basket is empty." })]),
          h("div", { className: "sw-total", textContent: `Subtotal: ${api.fmt(subtotal())}` }),
          st.note ? h("div", { className: "sw-desc", style: "color:#b12704", textContent: st.note }) : "",
          h("button", { className: "primary", textContent: st.busy ? "…" : "Proceed to checkout", disabled: !L.length || st.busy, onclick: () => submit("shop") }),
          h("div", { className: "sw-desc", style: "margin-top:6px", textContent: "Sales tax is added at the till." }))));
  }
  function draw() {
    if (!el || !st) return;
    el.replaceChildren(st.spec.kind === "menu" ? menuCard() : shopCard());
  }
  return Object.assign(api, { open, close, isOpen: () => Boolean(el) });
}
