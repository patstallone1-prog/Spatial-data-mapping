// Every shop's front, whether or not an owner has designed one: a sign in the look of its trade
// -- a striped awning over a café, a dark canopy and serif lettering at a fine restaurant, a
// bright board over a burger counter, green over a florist -- and, where a shop shows its goods,
// a lit display in the window beside the door (a florist's buckets, a boutique's two dressed
// forms, a bakery's loaves on a tiered stand, a bookshop's stacks).
//
// An owner's own sign (the Interior Studio's signage) always wins: this is the street as it is
// before anybody has changed it. Each shop gets its own variation from its id, so two cafés on
// one block are not alike.
import { hash32 } from "./people.mjs";

//: The look of each trade's sign: the medium (awning, board, painted), the awning's shape and
//: colours, the name's lettering. A list is a set of variations, chosen by the shop's id.
export const TRADE_SIGNS = {
  cafe: [{ medium: "awning", awning: { type: "striped", colour: "#6b3e26", stripe: "#f2e6cf" }, name: { style: "script", colour: "#f6efe0" } },
    { medium: "awning", awning: { type: "sloped", colour: "#2f4a3a", stripe: "#f2efe6" }, name: { style: "serif", colour: "#f6f2e7" } }],
  bakery: [{ medium: "awning", awning: { type: "striped", colour: "#b5653a", stripe: "#f4e3c3" }, name: { style: "script", colour: "#fff6e6" } },
    { medium: "awning", awning: { type: "dome", colour: "#c97b84", stripe: "#f8ece8" }, name: { style: "serif", colour: "#fffaf5" } }],
  dining: [{ medium: "awning", awning: { type: "flat", colour: "#1f2a37", stripe: "#d9c9a3" }, name: { style: "serif", colour: "#e9d8a6" } },
    { medium: "board", board: { colour: "#24211f" }, name: { style: "serif", colour: "#d8b46a" } }],
  casual: [{ medium: "awning", awning: { type: "sloped", colour: "#8e2b25", stripe: "#f2efe6" }, name: { style: "sans", colour: "#fff3e0" } },
    { medium: "awning", awning: { type: "striped", colour: "#2c5f7c", stripe: "#f2efe6" }, name: { style: "sans", colour: "#ffffff" } }],
  counter: [{ medium: "board", board: { colour: "#d62828" }, name: { style: "stencil", colour: "#ffd23f" } },
    { medium: "board", board: { colour: "#f4a300" }, name: { style: "stencil", colour: "#7a1f12" } }],
  bar: [{ medium: "board", board: { colour: "#24392f" }, name: { style: "serif", colour: "#d8b46a" } },
    { medium: "painted", name: { style: "serif", colour: "#e9d8a6" } }],
  florist: [{ medium: "awning", awning: { type: "dome", colour: "#3f7a4a", stripe: "#f2efe6" }, name: { style: "script", colour: "#ffffff" } },
    { medium: "awning", awning: { type: "striped", colour: "#5e8c4a", stripe: "#f6f1e3" }, name: { style: "serif", colour: "#ffffff" } }],
  clothing: [{ medium: "awning", awning: { type: "flat", colour: "#151515", stripe: "#f2efe6" }, name: { style: "serif", colour: "#ffffff" } },
    { medium: "painted", name: { style: "sans", colour: "#1b1b1b" } }],
  books: [{ medium: "awning", awning: { type: "sloped", colour: "#23395b", stripe: "#f2efe6" }, name: { style: "serif", colour: "#f6efe0" } }],
  pharmacy: [{ medium: "board", board: { colour: "#0f7a5a" }, name: { style: "sans", colour: "#ffffff" } }],
  grocery: [{ medium: "board", board: { colour: "#1f5f8b" }, name: { style: "sans", colour: "#ffffff" } },
    { medium: "awning", awning: { type: "sloped", colour: "#3f7a4a", stripe: "#f2efe6" }, name: { style: "sans", colour: "#ffffff" } }],
  hardware: [{ medium: "board", board: { colour: "#d9822b" }, name: { style: "stencil", colour: "#1b1b1b" } }],
  beauty: [{ medium: "awning", awning: { type: "dome", colour: "#b56576", stripe: "#fbeaf0" }, name: { style: "script", colour: "#ffffff" } },
    { medium: "board", board: { colour: "#2b2b2b" }, name: { style: "serif", colour: "#e8c6cc" } }],
  service: [{ medium: "board", board: { colour: "#34495e" }, name: { style: "sans", colour: "#ffffff" } }],
  shop: [{ medium: "awning", awning: { type: "sloped", colour: "#2f5d50", stripe: "#f2efe6" }, name: { style: "sans", colour: "#f6f2e7" } },
    { medium: "awning", awning: { type: "striped", colour: "#7a3b3b", stripe: "#f2efe6" }, name: { style: "sans", colour: "#ffffff" } },
    { medium: "board", board: { colour: "#1f2a37" }, name: { style: "sans", colour: "#f6f2e7" } }],
};
//: Each shop kind (rules.json stores.kinds, and OSM's shop tags) to its trade's look.
const TRADE_OF = {
  cafe: "cafe", coffee: "cafe", ice_cream: "cafe", bakery: "bakery", bar: "bar", pub: "bar", wine_shop: "bar", liquor: "bar",
  florist: "florist", clothing: "clothing", clothes: "clothing", shoes: "clothing", jewelry: "clothing", boutique: "clothing",
  books: "books", gallery: "books", gifts: "books", toys: "books", pharmacy: "pharmacy", chemist: "pharmacy", optician: "pharmacy", clinic: "service", dentist: "service", vet: "service",
  grocery: "grocery", supermarket: "grocery", convenience: "grocery", greengrocer: "grocery", deli: "grocery",
  hardware: "hardware", doityourself: "hardware", auto_parts: "hardware", bike: "hardware", electronics: "hardware",
  salon: "beauty", hairdresser: "beauty", barber: "beauty", nail_salon: "beauty", spa: "beauty", beauty: "beauty", cosmetics: "beauty",
  laundry: "service", dry_cleaner: "service", bank: "service", law_office: "service", staffing: "service", print_ship: "service", pet_grooming: "service", pet: "shop", home: "shop", general: "shop",
};
//: What a window shows, by trade (none for a service with nothing to show).
export const WINDOW_DISPLAYS = { florist: "flowers", clothing: "forms", bakery: "loaves", cafe: "pastries", books: "stacks", hardware: "boxes", grocery: "produce", beauty: "bottles", shop: "boxes", pharmacy: "bottles" };

//: The trade of a shop of ``kind``; a restaurant's by how it serves (``style`` from
//: restaurant-room.mjs restaurantService: counter, casual or dining).
export function tradeOf(kind, style = null) {
  if (style) return style;
  return TRADE_OF[kind] || "shop";
}
//: The sign a shop has before its owner designs one: its trade's look, varied by ``id``, with
//: what it sells under the name (``tagline``).
export function tradeSignage(kind, id, { style = null, tagline = "" } = {}) {
  const looks = TRADE_SIGNS[tradeOf(kind, style)] || TRADE_SIGNS.shop;
  const look = looks[hash32(String(id), "sign") % looks.length];
  return {
    medium: look.medium,
    awning: { type: "sloped", colour: "#2f5d50", stripe: "#f2efe6", ...(look.awning || {}) },
    board: { colour: "#1f2a37", ...(look.board || {}) },
    name: { size: "medium", ...look.name },
    tagline: { text: tagline, colour: look.name.colour },
  };
}
//: The window display of a shop of ``kind`` (null: nothing to show).
export function windowDisplayOf(kind, style = null) {
  if (style) return null;
  return WINDOW_DISPLAYS[tradeOf(kind)] || null;
}

//: A lit display set into the shop window, ``width`` along the front: a shallow case standing a
//: hand out from the wall (+z out, x along the front, y up from the pavement), its back lit,
//: holding the trade's goods. ``seed`` varies the colours.
export function buildWindowDisplay(THREE, display, { width = 1.6, seed = 0 } = {}) {
  const g = new THREE.Group();
  g.name = "store-window-display";
  const mats = new Map();
  const mat = (hex, emissive = 0.25) => {
    const key = `${hex}|${emissive}`;
    if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color: hex, emissive: new THREE.Color(hex).multiplyScalar(emissive) }));
    return mats.get(key);
  };
  const box = (w, h, d, x, y, z, c, e) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, e)); m.position.set(x, y, z); g.add(m); return m; };
  const ball = (r, x, y, z, c, e) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(c, e)); m.position.set(x, y, z); g.add(m); return m; };
  const can = (r, h, x, y, z, c, e) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat(c, e)); m.position.set(x, y, z); g.add(m); return m; };
  const r = ((n) => () => { n = (n * 1103515245 + 12345) >>> 0; return (n >>> 8) / 16777216; })(seed >>> 0 || 7);
  const pick = (list) => list[Math.floor(r() * list.length)];
  // The case: a sill, a lit back, a frame; goods stand on the sill.
  const sill = 0.62, top = 2.15, depth = 0.26;
  box(width, 0.06, depth, 0, sill, 0, 0x3a3330, 0.05);
  box(width, top - sill, 0.02, 0, (top + sill) / 2, -depth / 2, 0xf3ead6, 0.85);
  box(width + 0.06, 0.05, depth, 0, top, 0, 0x2a2624, 0.05);
  for (const s of [-1, 1]) box(0.04, top - sill, depth, s * (width / 2 + 0.01), (top + sill) / 2, 0, 0x2a2624, 0.05);
  // The display window's glass (module 02 realGlass where the page has it): its uv runs 0 to 1, so
  // its edges take the grime.
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xbfd6dc, transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.05, metalness: 0 });
  globalThis.__kerbsideRealGlass?.(glassMaterial, { paneUv: true });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(width, top - sill), glassMaterial);
  glass.castShadow = false;
  glass.position.set(0, (top + sill) / 2, depth / 2); g.add(glass);
  const y0 = sill + 0.03, n = Math.max(2, Math.floor(width / 0.42));
  const slot = (i) => -width / 2 + (i + 0.5) * (width / n);
  if (display === "flowers") {
    for (let i = 0; i < n; i += 1) {
      const x = slot(i);
      can(0.11, 0.3, x, y0 + 0.15, 0, 0x5d6f7a, 0.1);
      for (let k = 0; k < 6; k += 1) ball(0.06, x + (r() - 0.5) * 0.16, y0 + 0.36 + r() * 0.22, (r() - 0.5) * 0.1, pick([0xd64570, 0xf2c14e, 0xf5f0e6, 0xb56576, 0xe76f51, 0x9b5de5]), 0.35);
      for (let k = 0; k < 3; k += 1) ball(0.07, x + (r() - 0.5) * 0.18, y0 + 0.3, (r() - 0.5) * 0.1, 0x3f7a4a, 0.25);
    }
  } else if (display === "forms") {
    // Dressed forms: a torso in an outfit on a stand.
    for (const x of n > 2 ? [-width * 0.25, width * 0.25] : [0]) {
      const outfit = pick([[0x1d2230, 0xf4f4f2], [0x8e2b25, 0x1f1f23], [0xcfc4ae, 0x3f5a80], [0x2f4a3a, 0xe8dfd0]]);
      can(0.015, 0.6, x, y0 + 0.3, 0, 0x2a2624, 0.05);
      can(0.17, 0.42, x, y0 + 0.82, 0, outfit[0], 0.2);
      can(0.15, 0.36, x, y0 + 0.43, 0, outfit[1], 0.2);
      ball(0.07, x, y0 + 1.1, 0, 0xd8cbb8, 0.2);
    }
  } else if (display === "loaves" || display === "pastries") {
    // A tiered stand: three plates, loaves or pastries on each.
    for (const [i, h] of [0.08, 0.38, 0.66].entries()) {
      const w = width * (0.9 - i * 0.22);
      box(w, 0.025, 0.2, 0, y0 + h, 0, 0xe8e2d6, 0.2);
      for (let k = 0; k < Math.max(2, Math.floor(w / 0.2)); k += 1) {
        const x = -w / 2 + (k + 0.5) * (w / Math.max(2, Math.floor(w / 0.2)));
        if (display === "loaves") { const m = ball(0.08, x, y0 + h + 0.06, 0, pick([0xb5713a, 0xc98b4a, 0x8a5a2e]), 0.2); m.scale.set(1.3, 0.7, 0.8); }
        else ball(0.05, x, y0 + h + 0.05, 0, pick([0xd9a05b, 0xf2d0a4, 0x7a3b2a, 0xe8c6cc]), 0.25);
      }
    }
  } else if (display === "stacks") {
    for (let i = 0; i < n; i += 1) {
      let y = y0;
      for (let k = 0; k < 4 + Math.floor(r() * 4); k += 1) { const t = 0.03 + r() * 0.03; box(0.2 + r() * 0.06, t, 0.15, slot(i), y + t / 2, 0, pick([0x23395b, 0x8e2b25, 0x2f4a3a, 0xe3c45c, 0xf2f1ec, 0x6b4f8a]), 0.2); y += t; }
      const up = box(0.17, 0.25, 0.03, slot(i), y + 0.13, -0.02, pick([0xf2f1ec, 0xe3c45c, 0x8e2b25]), 0.3); up.rotation.x = -0.15;
    }
  } else if (display === "produce") {
    for (let i = 0; i < n; i += 1) {
      const c = pick([0xd64045, 0xf2a03d, 0x7cb342, 0xffd23f, 0x6a1b9a]);
      box(0.34, 0.12, 0.2, slot(i), y0 + 0.06, 0, 0x8a6a45, 0.15);
      for (let k = 0; k < 7; k += 1) ball(0.045, slot(i) + (r() - 0.5) * 0.24, y0 + 0.15, (r() - 0.5) * 0.12, c, 0.3);
    }
  } else if (display === "bottles") {
    for (const h of [0, 0.42]) { box(width * 0.9, 0.02, 0.18, 0, y0 + h, 0, 0xf2f1ec, 0.3);
      for (let i = 0; i < n * 2; i += 1) can(0.035, 0.16 + r() * 0.08, -width * 0.42 + i * (width * 0.84 / (n * 2 - 1)), y0 + h + 0.1, 0, pick([0xf2f1ec, 0xe8c6cc, 0x9fc5e8, 0x2e86c1, 0xb4a7d6]), 0.3); }
  } else {
    // Boxed goods in a pyramid.
    for (let row = 0; row < 3; row += 1) for (let i = 0; i < n - row; i += 1) box(0.3, 0.2, 0.18, -width / 2 + (i + 0.5 + row / 2) * (width / n), y0 + 0.1 + row * 0.21, 0, pick([0xd9822b, 0x2e86c1, 0xf2f1ec, 0x2b2d31, 0xc0392b]), 0.2);
  }
  return g;
}
