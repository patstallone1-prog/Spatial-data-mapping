// Food as it comes to the table, made from its recipe: every dish the kitchens cook (rules.json
// kitchen.recipes) and every dish a real menu adds (menu-dish.mjs builds, the same ingredients
// and the same processes), built from what is in it and how each part was cooked -- a grilled
// patty seared dark with a pink-grey middle, chopped-and-fried potato as fries, steamed rice as a
// grainy mound, a boiled egg halved to a jammy yolk -- and put together the way that kind of dish
// is served: a burger stacked in its bun, a pizza on its board in eight, noodles in their broth
// with the toppings laid on, nigiri and maki on a geta, a steak with its frites on a plate.
//
// And how it is eaten (eat-play.mjs drives it): what comes next -- a bite out of what is held
// (the bite's scalloped edge taken out of every layer: bites.mjs), a forkful cut off with the
// knife, a piece picked up, a spoonful of the broth (its level dropping), a sip -- and what is
// left of it after.
//
// The dish's frame: it stands at the origin on the table (y = 0 the table's top), the sitter on
// +z (a held food's front -- where it is bitten from -- faces +z too). Metres.

import { makeServer, makeVessel, mergeSimple, paintTexture, roundedSlab, tablewareMaterials, VESSELS, vesselFor } from "./tableware.mjs";
import { areaOf, biteCircles, createMask, cutOff, fillMask, frontEdge, shapesOf, subtractCircles } from "./bites.mjs";
import { createDrink, createDrinkMesh } from "./liquid.mjs";
import { LOOK_OF, RAW_SURFACE, extraLook, lookState, tinted } from "./plated.mjs";

// ---- randomness and noise (the same dish looks the same every time) ----------------------------------

export function rng(seed) {
  let s = typeof seed === "number" ? seed >>> 0 : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
//: Smooth value noise in 3D (-1..1).
function noise3(x, y, z, seed = 0) {
  const h = (i, j, k) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647) + Math.imul(seed, 144269); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295 * 2 - 1; };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}
//: Push a geometry's vertices along their normals by noise (``amp`` m at ``freq`` per m).
function lumpy(geo, amp, freq, seed = 1, octaves = 2) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const P = geo.attributes.position, N = geo.attributes.normal;
  for (let i = 0; i < P.count; i += 1) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let n = 0, a = 1, f = freq;
    for (let o = 0; o < octaves; o += 1) { n += a * noise3(x * f, y * f, z * f, seed + o); a *= 0.5; f *= 2.1; }
    P.setXYZ(i, x + N.getX(i) * n * amp, y + N.getY(i) * n * amp, z + N.getZ(i) * n * amp);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---- what each food is made of: its surfaces --------------------------------------------------------

const looks = new WeakMap();
//: The food's materials, painted once each (per three.js): the browned top of a bun, a seared
//: crust with grill marks, a tomato's cut face, a salmon's fat lines, rice grains, broth with fat
//: on it, a pizza's blistered cheese.
function foodLook(THREE) {
  if (looks.has(THREE)) return looks.get(THREE);
  const cache = new Map();
  const speck = (g, w, h, n, rgb, a0, a1, s = 2) => { for (let i = 0; i < n; i += 1) { g.fillStyle = `rgba(${rgb},${a0 + Math.random() * (a1 - a0)})`; g.fillRect(Math.random() * w, Math.random() * h, s * (0.5 + Math.random()), s * (0.5 + Math.random())); } };
  const T = (key, draw, w = 256, h = 256, repeat = null) => paintTexture(THREE, w, h, draw, { repeat });
  const tex = {
    bun: () => T("bun", (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); gr.addColorStop(0, "#9b4f14"); gr.addColorStop(0.55, "#b8681f"); gr.addColorStop(0.85, "#d79a4b"); gr.addColorStop(1, "#ead0a0"); g.fillStyle = gr; g.fillRect(0, 0, w, h); speck(g, w, h, 1400, "60,25,5", 0.04, 0.12); }),
    crumb: () => T("crumb", (g, w, h) => { g.fillStyle = "#f1dfb6"; g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i += 1) { g.fillStyle = `rgba(170,130,70,${0.15 + Math.random() * 0.25})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 3, Math.random() * 3, 0, 7); g.fill(); } }),
    seared: () => T("seared", (g, w, h) => { g.fillStyle = "#6a3a1e"; g.fillRect(0, 0, w, h); speck(g, w, h, 3000, "30,12,4", 0.1, 0.35, 3); speck(g, w, h, 800, "160,90,40", 0.05, 0.2, 2); g.strokeStyle = "rgba(20,8,2,.8)"; g.lineWidth = 9; for (let i = -2; i < 6; i += 1) { g.beginPath(); g.moveTo(i * 48, 0); g.lineTo(i * 48 + 160, h); g.stroke(); } }),
    patty: () => T("patty", (g, w, h) => { g.fillStyle = "#4c2b17"; g.fillRect(0, 0, w, h); speck(g, w, h, 4000, "25,10,3", 0.15, 0.45, 3); speck(g, w, h, 900, "130,70,35", 0.1, 0.3, 2); }),
    cutMeat: () => T("cutMeat", (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#5a3018"); gr.addColorStop(0.12, "#8c5a44"); gr.addColorStop(0.22, "#c8767a"); gr.addColorStop(0.5, "#b5414e"); gr.addColorStop(0.78, "#c8767a"); gr.addColorStop(0.88, "#8c5a44"); gr.addColorStop(1, "#5a3018"); g.fillStyle = gr; g.fillRect(0, 0, w, h); speck(g, w, h, 900, "250,220,210", 0.04, 0.12); }, 64, 64),
    chicken: () => T("chicken", (g, w, h) => { g.fillStyle = "#b96a2b"; g.fillRect(0, 0, w, h); for (let i = 0; i < 90; i += 1) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "120,55,15" : "225,160,80"},${0.15 + Math.random() * 0.3})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 5 + Math.random() * 18, 4 + Math.random() * 10, Math.random() * 3, 0, 7); g.fill(); } speck(g, w, h, 600, "80,40,10", 0.2, 0.5); }),
    chickenMeat: () => T("chickenMeat", (g, w, h) => { g.fillStyle = "#f1e3cb"; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 3) { g.fillStyle = `rgba(200,170,130,${Math.random() * 0.3})`; g.fillRect(x, 0, 1, h); } }, 64, 64),
    cheese: () => T("cheese", (g, w, h) => { g.fillStyle = "#f2b21b"; g.fillRect(0, 0, w, h); speck(g, w, h, 300, "255,220,120", 0.1, 0.3, 4); }, 64, 64),
    lettuce: () => T("lettuce", (g, w, h) => { g.fillStyle = "#8cc043"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(230,250,190,.7)"; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke(); g.lineWidth = 1.2; for (let i = 0; i < 9; i += 1) { const y = h - i * h / 9; g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w * 0.25, y - 20, 0, y - 40); g.moveTo(w / 2, y); g.quadraticCurveTo(w * 0.75, y - 20, w, y - 40); g.stroke(); } speck(g, w, h, 500, "60,120,20", 0.1, 0.2, 4); }),
    tomato: () => T("tomato", (g, w, h) => { g.fillStyle = "#d8352a"; g.fillRect(0, 0, w, h); g.fillStyle = "#c22a20"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, 7); g.fill(); for (let k = 0; k < 5; k += 1) { const a = k * 1.2566; g.fillStyle = "#f07a5a"; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * w * 0.22, h / 2 + Math.sin(a) * h * 0.22, w * 0.13, w * 0.09, a, 0, 7); g.fill(); g.fillStyle = "#f6dd98"; for (let s = 0; s < 6; s += 1) { g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * w * (0.16 + s * 0.02), h / 2 + Math.sin(a) * h * (0.16 + s * 0.02) + (s % 2 ? 6 : -6), 2.5, 1.5, a, 0, 7); g.fill(); } } g.fillStyle = "#ef8f70"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.08, 0, 7); g.fill(); }),
    salmon: () => T("salmon", (g, w, h) => { g.fillStyle = "#f2804e"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(255,240,225,.85)"; for (let i = -4; i < 14; i += 1) { g.lineWidth = 2 + Math.random() * 3; g.beginPath(); g.moveTo(i * 24, 0); g.bezierCurveTo(i * 24 + 30, h * 0.3, i * 24 - 10, h * 0.7, i * 24 + 40, h); g.stroke(); } }),
    tuna: () => T("tuna", (g, w, h) => { g.fillStyle = "#a81d2c"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(220,90,100,.35)"; for (let i = 0; i < 12; i += 1) { g.lineWidth = 2; g.beginPath(); g.moveTo(i * 24, 0); g.lineTo(i * 24 + 40, h); g.stroke(); } }),
    rice: () => T("rice", (g, w, h) => { g.fillStyle = "#e9e5d8"; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i += 1) { const x = Math.random() * w, y = Math.random() * h, a = Math.random() * 3.14; g.fillStyle = `rgba(255,255,250,${0.7 + Math.random() * 0.3})`; g.beginPath(); g.ellipse(x, y, 5, 2.2, a, 0, 7); g.fill(); g.strokeStyle = "rgba(170,160,140,.35)"; g.lineWidth = 0.6; g.stroke(); } }, 256, 256, [2, 2]),
    friedRice: () => T("friedRice", (g, w, h) => { g.fillStyle = "#c99a52"; g.fillRect(0, 0, w, h); for (let i = 0; i < 800; i += 1) { g.fillStyle = `rgba(${Math.random() < 0.8 ? "225,190,120" : "250,220,90"},.9)`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 5, 2.2, Math.random() * 3, 0, 7); g.fill(); } speck(g, w, h, 120, "120,190,70", 0.9, 1, 4); speck(g, w, h, 120, "230,120,40", 0.9, 1, 4); }, 256, 256, [2, 2]),
    broth: () => T("broth", (g, w, h) => { g.fillStyle = "#e6cfa0"; g.fillRect(0, 0, w, h); for (let i = 0; i < 160; i += 1) { g.fillStyle = `rgba(255,200,80,${0.25 + Math.random() * 0.4})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 0, 7); g.fill(); } }),
    // Pho's broth is clear: a light amber you see the noodles through, with small beads of fat.
    pho: () => T("pho", (g, w, h) => { g.fillStyle = "#8a4c12"; g.fillRect(0, 0, w, h); for (let i = 0; i < 90; i += 1) { const r0 = 0.6 + Math.random() * 2.4; g.fillStyle = `rgba(255,214,120,${0.18 + Math.random() * 0.22})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r0, 0, 7); g.fill(); g.strokeStyle = "rgba(255,240,190,.35)"; g.lineWidth = 0.5; g.stroke(); } }),
    // Melted mozzarella over most of the tomato: pools of cheese running together, the sauce
    // showing between, golden-brown blisters and a few dark leopard spots, an orange oil sheen.
    pizza: () => T("pizza", (g, w, h) => { g.fillStyle = "#b5321c"; g.fillRect(0, 0, w, h); speck(g, w, h, 400, "120,20,10", 0.2, 0.4, 4);
      for (let i = 0; i < 70; i += 1) { const x = Math.random() * w, y = Math.random() * h, rx = 10 + Math.random() * 26, ry = 8 + Math.random() * 20, a = Math.random() * 3; const gr = g.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry)); gr.addColorStop(0, "#f8ecc6"); gr.addColorStop(0.7, "#f1dca2"); gr.addColorStop(1, "rgba(232,190,110,.0)"); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, 7); g.fill(); }
      for (let i = 0; i < 60; i += 1) { g.fillStyle = `rgba(${Math.random() < 0.7 ? "196,132,52" : "150,90,30"},${0.35 + Math.random() * 0.35})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 0, 7); g.fill(); }
      speck(g, w, h, 40, "50,25,10", 0.5, 0.8, 4); speck(g, w, h, 300, "240,140,40", 0.08, 0.2, 5); }),
    crust: () => T("crust", (g, w, h) => { g.fillStyle = "#d89a4e"; g.fillRect(0, 0, w, h); speck(g, w, h, 300, "60,25,8", 0.3, 0.8, 4); speck(g, w, h, 900, "250,220,160", 0.1, 0.3, 2); }),
    tortilla: () => T("tortilla", (g, w, h) => { g.fillStyle = "#eedcaa"; g.fillRect(0, 0, w, h); for (let i = 0; i < 70; i += 1) { g.fillStyle = `rgba(140,80,30,${0.25 + Math.random() * 0.45})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 2 + Math.random() * 7, 2 + Math.random() * 5, Math.random() * 3, 0, 7); g.fill(); } }),
    fries: () => T("fries", (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#c98b2c"); gr.addColorStop(0.3, "#ebbb5a"); gr.addColorStop(0.7, "#f0c768"); gr.addColorStop(1, "#c98b2c"); g.fillStyle = gr; g.fillRect(0, 0, w, h); speck(g, w, h, 200, "140,80,20", 0.1, 0.3); }, 32, 64),
    batter: () => T("batter", (g, w, h) => { g.fillStyle = "#cf8f37"; g.fillRect(0, 0, w, h); speck(g, w, h, 2500, "245,200,110", 0.2, 0.6, 3); speck(g, w, h, 900, "120,60,15", 0.2, 0.5, 3); }),
    egg: () => T("egg", (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2); gr.addColorStop(0, "#fbf9f2"); gr.addColorStop(0.8, "#f6f2e6"); gr.addColorStop(0.95, "#d6a868"); gr.addColorStop(1, "#a86a2a"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, 128, 128),
    bacon: () => T("bacon", (g, w, h) => { for (let y = 0; y < h; y += 1) { const t = y / h, fat = Math.sin(t * Math.PI * 5) > 0.55 || t < 0.08 || t > 0.92; g.fillStyle = fat ? "#e7bf94" : t % 0.2 < 0.1 ? "#8f2c1c" : "#7a2416"; g.fillRect(0, y, w, 1); } speck(g, w, h, 600, "60,15,5", 0.15, 0.4, 3); }, 128, 64),
    pancake: () => T("pancake", (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2); gr.addColorStop(0, "#c27a2f"); gr.addColorStop(0.7, "#b06a24"); gr.addColorStop(0.95, "#e2b874"); gr.addColorStop(1, "#ecd29a"); g.fillStyle = gr; g.fillRect(0, 0, w, h); speck(g, w, h, 700, "240,190,110", 0.2, 0.5, 3); }),
    nori: () => T("nori", (g, w, h) => { g.fillStyle = "#1b2a1d"; g.fillRect(0, 0, w, h); speck(g, w, h, 2500, "60,80,55", 0.15, 0.35, 2); }, 64, 64),
    maki: () => T("maki", (g, w, h) => { g.fillStyle = "#1b2a1d"; g.fillRect(0, 0, w, h); g.fillStyle = "#f4f1e6"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.43, 0, 7); g.fill(); for (let i = 0; i < 200; i += 1) { g.strokeStyle = "rgba(180,170,150,.35)"; g.beginPath(); g.ellipse(w / 2 + (Math.random() - 0.5) * w * 0.8, h / 2 + (Math.random() - 0.5) * h * 0.8, 4, 1.8, Math.random() * 3, 0, 7); g.stroke(); } g.fillStyle = "#f2804e"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.17, 0, 7); g.fill(); g.fillStyle = "#7fb04a"; g.fillRect(w * 0.58, h * 0.4, w * 0.08, h * 0.2); }, 128, 128),
    lemon: () => T("lemon", (g, w, h) => { g.fillStyle = "#f6dd5c"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(255,250,215,.9)"; g.lineWidth = 3; for (let k = 0; k < 9; k += 1) { g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2 + Math.cos(Math.PI * k / 8) * w, h - Math.sin(Math.PI * k / 8) * h); g.stroke(); } }, 64, 64),
    lime: () => T("lime", (g, w, h) => { g.fillStyle = "#b9d86a"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(240,250,210,.9)"; g.lineWidth = 3; for (let k = 0; k < 9; k += 1) { g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2 + Math.cos(Math.PI * k / 8) * w, h - Math.sin(Math.PI * k / 8) * h); g.stroke(); } }, 64, 64),
    cucumber: () => T("cucumber", (g, w, h) => { g.fillStyle = "#2e5a1d"; g.fillRect(0, 0, w, h); g.fillStyle = "#c9e19a"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.44, 0, 7); g.fill(); g.fillStyle = "#e2efc2"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.22, 0, 7); g.fill(); g.fillStyle = "#f4f6e4"; for (let k = 0; k < 9; k += 1) { const a = k * 0.7; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * w * 0.13, h / 2 + Math.sin(a) * h * 0.13, 3, 1.6, a, 0, 7); g.fill(); } }, 64, 64),
    latte: () => T("latte", (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); gr.addColorStop(0, "#c08752"); gr.addColorStop(0.85, "#9a6031"); gr.addColorStop(1, "#5e3417"); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = "#f7eddc"; g.beginPath(); g.ellipse(w / 2, h * 0.62, w * 0.2, h * 0.17, 0, 0, 7); g.fill(); for (let k = 0; k < 6; k += 1) { g.beginPath(); g.ellipse(w / 2, h * (0.5 - k * 0.055), w * (0.17 - k * 0.022), h * 0.03, 0, 0, 7); g.fill(); } g.fillRect(w / 2 - 1, h * 0.18, 2, h * 0.6); }),
    crema: () => T("crema", (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, "#c28a4e"); gr.addColorStop(0.75, "#a0622c"); gr.addColorStop(1, "#4e2810"); g.fillStyle = gr; g.fillRect(0, 0, w, h); speck(g, w, h, 500, "230,180,120", 0.15, 0.35, 2); }, 128, 128),
    foam: () => T("foam", (g, w, h) => { g.fillStyle = "#fbf5e6"; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i += 1) { g.strokeStyle = `rgba(200,180,140,${0.1 + Math.random() * 0.2})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 0, 7); g.stroke(); } }, 128, 128),
    sponge: () => T("sponge", (g, w, h) => { g.fillStyle = "#efd396"; g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i += 1) { g.fillStyle = `rgba(190,150,80,${0.2 + Math.random() * 0.3})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 0.6 + Math.random() * 2, 0, 7); g.fill(); } }),
    chashu: () => T("chashu", (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); gr.addColorStop(0, "#e9b9a2"); gr.addColorStop(0.6, "#d79c86"); gr.addColorStop(0.8, "#f4e4d4"); gr.addColorStop(0.92, "#7a3a1a"); gr.addColorStop(1, "#4e220c"); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(250,235,220,.8)"; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, w * 0.25, 0.4, 3.6); g.stroke(); }, 128, 128),
    halfEgg: () => T("halfEgg", (g, w, h) => { g.fillStyle = "#f6f1e4"; g.fillRect(0, 0, w, h); const gr = g.createRadialGradient(w / 2, h * 0.55, 2, w / 2, h * 0.55, w * 0.3); gr.addColorStop(0, "#f08c12"); gr.addColorStop(0.7, "#f2a02a"); gr.addColorStop(1, "#f6c25a"); g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.55, w * 0.27, h * 0.25, 0, 0, 7); g.fill(); }, 128, 128),
    burritoCut: () => T("burritoCut", (g, w, h) => { g.fillStyle = "#eedcaa"; g.fillRect(0, 0, w, h); g.fillStyle = "#efe9da"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.44, 0, 7); g.fill(); for (let i = 0; i < 220; i += 1) { const c = ["#5c2d1a", "#e8e1cc", "#c2531f", "#c28a50", "#f4c430", "#f7f3ea"][i % 6]; g.fillStyle = c; const a = Math.random() * 7, r = Math.random() * w * 0.4; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 2 + Math.random() * 4, 1.5 + Math.random() * 3, Math.random() * 3, 0, 7); g.fill(); } }, 128, 128),
    croissant: () => T("croissant", (g, w, h) => { for (let x = 0; x < w; x += 1) { const t = (x / w) * 6 % 1; g.fillStyle = t < 0.15 ? "#8a4512" : t < 0.5 ? "#c4732a" : "#d99245"; g.fillRect(x, 0, 1, h); } speck(g, w, h, 300, "250,210,140", 0.2, 0.4); }, 128, 32),
    broccoli: () => T("broccoli", (g, w, h) => { g.fillStyle = "#355f20"; g.fillRect(0, 0, w, h); for (let i = 0; i < 700; i += 1) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "70,120,40" : "30,60,18"},.9)`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1.5 + Math.random() * 2.5, 0, 7); g.fill(); } }, 64, 64),
    roast: () => T("roast", (g, w, h) => { g.fillStyle = "#d9a24a"; g.fillRect(0, 0, w, h); speck(g, w, h, 300, "140,70,20", 0.3, 0.7, 5); speck(g, w, h, 200, "250,220,150", 0.2, 0.4, 3); }, 64, 64),
    shrimp: () => T("shrimp", (g, w, h) => { for (let x = 0; x < w; x += 1) { g.fillStyle = (x / w * 7) % 1 < 0.3 ? "#e8664a" : "#f6b195"; g.fillRect(x, 0, 1, h); } }, 64, 16),
    falafel: () => T("falafel", (g, w, h) => { g.fillStyle = "#7a4a1c"; g.fillRect(0, 0, w, h); speck(g, w, h, 1500, "160,110,50", 0.3, 0.7, 3); speck(g, w, h, 200, "70,110,40", 0.3, 0.6, 2); }, 64, 64),
    chocolate: () => T("chocolate", (g, w, h) => { g.fillStyle = "#4a2614"; g.fillRect(0, 0, w, h); speck(g, w, h, 200, "120,70,40", 0.1, 0.3, 3); }, 32, 32),
  };
  // Materials: (key, colour or texture, roughness, extra physical properties).
  function mat(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); }
  const P = (o) => new THREE.MeshPhysicalMaterial(o), S = (o) => new THREE.MeshStandardMaterial(o);
  const L = {
    tex,
    m: (key) => mat(key, () => {
      const t = (k) => tex[k]?.() || null;
      switch (key) {
        case "bun": return P({ map: t("bun"), color: 0xffffff, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xf2c88a), sheenRoughness: 0.6 });
        case "bun_cut": return S({ map: t("crumb"), roughness: 0.9 });
        case "bread": return P({ map: t("crumb"), roughness: 0.9 });
        case "crust": return S({ map: t("crust"), color: 0xffffff, roughness: 0.75 });
        case "patty": return P({ map: t("patty"), roughness: 0.78, clearcoat: 0.25, clearcoatRoughness: 0.5 });
        case "seared": return P({ map: t("seared"), roughness: 0.7, clearcoat: 0.35, clearcoatRoughness: 0.45 });
        case "cut_meat": return P({ map: t("cutMeat"), roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3 });
        case "chicken": return P({ map: t("chicken"), roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.25 });
        case "chicken_meat": return S({ map: t("chickenMeat"), roughness: 0.7 });
        case "cheese": return P({ map: t("cheese"), roughness: 0.42, clearcoat: 0.3, sheen: 0.2, sheenColor: new THREE.Color(0xffe08a) });
        case "lettuce": return P({ map: t("lettuce"), roughness: 0.4, clearcoat: 0.4, side: THREE.DoubleSide });
        case "tomato": return P({ map: t("tomato"), roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.1 });
        case "tomato_skin": return P({ color: 0xc8261b, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
        case "pickle": return P({ color: 0x7d9a3a, roughness: 0.35, clearcoat: 0.7 });
        case "fries": return S({ map: t("fries"), color: 0xffffff, roughness: 0.6 });
        case "rice": return S({ map: t("rice"), roughness: 0.55 });
        case "fried_rice": return S({ map: t("friedRice"), roughness: 0.5 });
        case "noodles": return P({ color: 0xf0d58a, roughness: 0.35, clearcoat: 0.6 });
        case "rice_noodles": return P({ color: 0xf2eee2, roughness: 0.3, clearcoat: 0.6, transparent: true, opacity: 0.92 });
        case "pasta": return P({ color: 0xf0d27c, roughness: 0.4, clearcoat: 0.3 });
        case "broth": return P({ map: t("broth"), roughness: 0.08, clearcoat: 1 });
        case "pho_broth": return P({ map: t("pho"), roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.66, depthWrite: false });
        case "soup": return P({ color: 0xd98a3c, roughness: 0.15, clearcoat: 0.8 });
        case "chowder": return P({ color: 0xefe5cf, roughness: 0.35, clearcoat: 0.4 });
        case "curry_green": return P({ color: 0x9aa63c, roughness: 0.15, clearcoat: 0.8 });
        case "curry_red": return P({ color: 0xc8561f, roughness: 0.18, clearcoat: 0.8 });
        case "risotto": return P({ color: 0xece0bc, roughness: 0.3, clearcoat: 0.5, map: t("rice") });
        case "pizza_top": return P({ map: t("pizza"), roughness: 0.45, clearcoat: 0.45 });
        case "pizza_crust": return S({ map: t("crust"), roughness: 0.8 });
        case "tortilla": return S({ map: t("tortilla"), roughness: 0.85, side: THREE.DoubleSide });
        case "batter": return P({ map: t("batter"), roughness: 0.6, clearcoat: 0.2 });
        case "egg_white": return P({ map: t("egg"), roughness: 0.3, clearcoat: 0.5 });
        case "yolk": return P({ color: 0xf4a20e, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
        case "bacon": return P({ map: t("bacon"), roughness: 0.5, clearcoat: 0.5, side: THREE.DoubleSide });
        case "toast": return S({ map: t("crust"), color: 0xf2d6a0, roughness: 0.85 });
        case "pancake": return S({ map: t("pancake"), roughness: 0.7 });
        case "pancake_edge": return S({ color: 0xe8c88e, roughness: 0.85 });
        case "syrup": return P({ color: 0x8a4a0c, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 });
        case "butter": return P({ color: 0xf5df7a, roughness: 0.3, clearcoat: 0.6 });
        case "nori": return S({ map: t("nori"), roughness: 0.6, side: THREE.DoubleSide });
        case "maki_cut": return S({ map: t("maki"), roughness: 0.6 });
        case "salmon": return P({ map: t("salmon"), roughness: 0.2, clearcoat: 0.9, clearcoatRoughness: 0.1 });
        case "tuna": return P({ map: t("tuna"), roughness: 0.25, clearcoat: 0.8 });
        case "sushi_rice": return S({ map: t("rice"), roughness: 0.55 });
        case "wasabi": return S({ color: 0x8dba3c, roughness: 0.7 });
        case "ginger_pickled": return P({ color: 0xf2c0a8, roughness: 0.3, clearcoat: 0.6, transparent: true, opacity: 0.9 });
        case "soy": return P({ color: 0x1e0c04, roughness: 0.02, clearcoat: 1 });
        case "lemon": return P({ map: t("lemon"), roughness: 0.3, clearcoat: 0.7 });
        case "lemon_peel": return P({ color: 0xf2cf2a, roughness: 0.5, clearcoat: 0.3 });
        case "lime": return P({ map: t("lime"), roughness: 0.3, clearcoat: 0.7 });
        case "lime_peel": return P({ color: 0x3f7a1e, roughness: 0.5, clearcoat: 0.3 });
        case "cucumber": return P({ map: t("cucumber"), roughness: 0.3, clearcoat: 0.6 });
        case "carrot": return P({ color: 0xee7f1e, roughness: 0.4, clearcoat: 0.3 });
        case "onion": return P({ color: 0xf1ead8, roughness: 0.25, clearcoat: 0.6, transparent: true, opacity: 0.92 });
        case "red_onion": return P({ color: 0xa8486e, roughness: 0.3, clearcoat: 0.5 });
        case "herb": return P({ color: 0x2f7d2a, roughness: 0.35, clearcoat: 0.5, side: THREE.DoubleSide });
        case "scallion": return P({ color: 0x5ea23a, roughness: 0.35, clearcoat: 0.5 });
        case "sprouts": return P({ color: 0xf1efd6, roughness: 0.3, clearcoat: 0.5 });
        case "peanut": return S({ color: 0xc08f50, roughness: 0.6 });
        case "pea": return P({ color: 0x74b83e, roughness: 0.35, clearcoat: 0.6 });
        case "bean": return P({ color: 0x5a2a18, roughness: 0.35, clearcoat: 0.5 });
        case "chickpea": return S({ color: 0xd6b06a, roughness: 0.6 });
        case "chili": return P({ color: 0xc81f12, roughness: 0.25, clearcoat: 0.8 });
        case "pepper_green": return P({ color: 0x3e8a24, roughness: 0.25, clearcoat: 0.8 });
        case "pepper_red": return P({ color: 0xc8291c, roughness: 0.25, clearcoat: 0.8 });
        case "mushroom": return S({ color: 0x9a7a5a, roughness: 0.6 });
        case "broccoli": return S({ map: t("broccoli"), roughness: 0.85 });
        case "broccoli_stem": return S({ color: 0x9cc066, roughness: 0.6 });
        case "roast_potato": return P({ map: t("roast"), roughness: 0.55, clearcoat: 0.3 });
        case "shrimp": return P({ map: t("shrimp"), roughness: 0.35, clearcoat: 0.6 });
        case "tofu": return S({ color: 0xf2ecd8, roughness: 0.7 });
        case "spinach": return P({ color: 0x24501c, roughness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide });
        case "beef_slice": return P({ color: 0x7a3a26, roughness: 0.5, clearcoat: 0.5, side: THREE.DoubleSide });
        case "beef_raw": return P({ color: 0xb8505a, roughness: 0.4, clearcoat: 0.5, side: THREE.DoubleSide });
        case "chashu": return P({ map: t("chashu"), roughness: 0.35, clearcoat: 0.6 });
        case "half_egg": return P({ map: t("halfEgg"), roughness: 0.25, clearcoat: 0.8 });
        case "egg_shell_white": return P({ color: 0xf6f1e4, roughness: 0.3, clearcoat: 0.6 });
        case "sauce_red": return P({ color: 0xb02a16, roughness: 0.15, clearcoat: 0.8 });
        case "sauce_brown": return P({ color: 0x4a1e0a, roughness: 0.12, clearcoat: 0.9 });
        case "sauce_white": return P({ color: 0xf3eed8, roughness: 0.3, clearcoat: 0.5 });
        case "sauce_yellow": return P({ color: 0xe0b01c, roughness: 0.25, clearcoat: 0.6 });
        case "sauce_hot": return P({ color: 0xd04416, roughness: 0.12, clearcoat: 0.9 });
        case "sauce_green": return P({ color: 0x6f9a2a, roughness: 0.3, clearcoat: 0.5 });
        case "salsa": return P({ color: 0xc23a22, roughness: 0.3, clearcoat: 0.6 });
        case "gochujang": return P({ color: 0x9e1f17, roughness: 0.25, clearcoat: 0.6 });
        case "tahini": return P({ color: 0xd8c49a, roughness: 0.35, clearcoat: 0.4 });
        case "sour_cream": return P({ color: 0xfbf8ef, roughness: 0.35, clearcoat: 0.4 });
        case "mozzarella": return P({ color: 0xf7efd9, roughness: 0.35, clearcoat: 0.4 });
        case "parmesan": return S({ color: 0xf1e2a4, roughness: 0.7 });
        case "cream_cheese": return P({ color: 0xfbf8ef, roughness: 0.4, clearcoat: 0.3 });
        case "whipped": return P({ color: 0xfdfaf2, roughness: 0.6, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
        case "ice_cream_choc": return S({ color: 0x6b3e22, roughness: 0.75 });
        case "ice_cream_van": return S({ color: 0xf6ecc8, roughness: 0.75 });
        case "ice_cream_straw": return S({ color: 0xf2b4bc, roughness: 0.75 });
        case "choc_syrup": return P({ color: 0x3a1a0c, roughness: 0.05, clearcoat: 1 });
        case "berry": return P({ color: 0xb01c2c, roughness: 0.2, clearcoat: 1 });
        case "blueberry": return P({ color: 0x2e3760, roughness: 0.4, clearcoat: 0.5 });
        case "cherry": return P({ color: 0xa8081a, roughness: 0.1, clearcoat: 1 });
        case "sponge": return S({ map: t("sponge"), roughness: 0.85 });
        case "cream": return P({ color: 0xfbf6ea, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0xffffff) });
        case "croissant": return P({ map: t("croissant"), roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 });
        case "dough_fried": return P({ color: 0xc98642, roughness: 0.55 });
        case "glaze": return P({ color: 0xf4d9e6, roughness: 0.12, clearcoat: 1 });
        case "glaze_choc": return P({ color: 0x3b1d0e, roughness: 0.12, clearcoat: 1 });
        case "sprinkles": return P({ color: 0xffffff, roughness: 0.3, clearcoat: 0.6, vertexColors: true });
        case "bagel": return P({ color: 0xb87a3a, roughness: 0.4, clearcoat: 0.6 });
        case "naan": return P({ map: t("tortilla"), color: 0xf2d6a0, roughness: 0.7, clearcoat: 0.3 });
        case "foil": return tablewareMaterials(THREE).foil;
        case "wrap_paper": return tablewareMaterials(THREE).wrap_paper;
        case "burrito_cut": return S({ map: t("burritoCut"), roughness: 0.7 });
        case "falafel": return S({ map: t("falafel"), roughness: 0.85 });
        case "lamb": return P({ color: 0x8a4e2a, roughness: 0.55, clearcoat: 0.4, map: t("patty") });
        case "pork": return P({ color: 0xe8a878, roughness: 0.5, clearcoat: 0.4, map: t("roast") });   // carnitas and al pastor: golden-brown, crisp edges
        case "chicken_bits": return P({ color: 0xd8a868, roughness: 0.5, clearcoat: 0.4 });
        case "teriyaki_chicken": return P({ color: 0x8a4a1a, roughness: 0.15, clearcoat: 0.9, map: t("chicken") });
        case "wing": return P({ color: 0xc8401a, roughness: 0.15, clearcoat: 0.95, map: t("chicken") });
        case "oyster_shell": return S({ color: 0x9a948a, roughness: 0.9 });
        case "oyster": return P({ color: 0xd8d0b8, roughness: 0.1, clearcoat: 1 });
        case "nacre": return P({ color: 0xe6e8ec, roughness: 0.15, clearcoat: 1, iridescence: 0.6 });
        case "ice": return P({ color: 0xeaf6fb, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 });
        case "crab": return P({ color: 0xd2471f, roughness: 0.35, clearcoat: 0.7 });
        case "dumpling": return P({ color: 0xf2ebda, roughness: 0.25, clearcoat: 0.6, transparent: true, opacity: 0.96 });
        case "chips": return P({ color: 0xe8be60, roughness: 0.45, clearcoat: 0.4, side: THREE.DoubleSide });
        case "chocolate": return P({ map: t("chocolate"), roughness: 0.35, clearcoat: 0.3 });
        case "sesame": return S({ color: 0xf3e6c4, roughness: 0.5 });
        case "garlic": return P({ color: 0xf1e7c8, roughness: 0.4, clearcoat: 0.4 });
        case "coffee": return P({ map: t("crema"), roughness: 0.4, clearcoat: 0.15, clearcoatRoughness: 0.3 });
        case "coffee_body": return P({ color: 0x24130a, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.97 });
        case "latte": return P({ map: t("latte"), roughness: 0.3, clearcoat: 0.3 });
        case "milk_body": return P({ color: 0xc89462, roughness: 0.2, clearcoat: 0.6 });
        case "tea": return P({ color: 0x9a4a10, roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.8 });
        case "iced_tea": return P({ color: 0xa3521a, roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.75 });
        case "beer": return P({ color: 0xe0a024, roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.82 });
        case "beer_foam": return S({ map: t("foam"), roughness: 0.9 });
        case "wine": return P({ color: 0x4a0716, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.9 });
        case "cola": return P({ color: 0x2a0d05, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.92 });
        case "orange_juice": return P({ color: 0xf6a21e, roughness: 0.15, clearcoat: 0.8, transparent: true, opacity: 0.96 });
        case "smoothie": return P({ color: 0xd44c6e, roughness: 0.4, clearcoat: 0.3 });
        case "shake_choc": return P({ color: 0x7a4a2c, roughness: 0.45, clearcoat: 0.2 });
        case "water": return P({ color: 0xdff0f6, roughness: 0.01, clearcoat: 1, transparent: true, opacity: 0.28 });
        case "cocktail": return P({ color: 0xf08a3a, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.85 });
        case "straw": return S({ color: 0xf2f2f2, roughness: 0.4, vertexColors: false });
        case "straw_red": return S({ color: 0xd8231f, roughness: 0.4 });
        case "mint": return P({ color: 0x3b9a3a, roughness: 0.3, clearcoat: 0.5, side: THREE.DoubleSide });
        case "kraft": return tablewareMaterials(THREE).kraft;
        default: return S({ color: 0xc89a6a, roughness: 0.6 });
      }
    }),
  };
  looks.set(THREE, L);
  return L;
}

// ---- what a dish is, from its recipe (pure) --------------------------------------------------------

const has = (build, ...ids) => ids.some((id) => build.some((b) => b.ing === id));
const cooked = (build, id) => build.find((b) => b.ing === id)?.p || "";
const count = (build, id) => build.filter((b) => b.ing === id).reduce((s, b) => s + b.qty, 0);

//: The kind of dish ``recipe`` (kitchen.mjs recipeOf's: {vessel, build: [{ing, qty, p}]}) is, by
//: what goes into it and how: { form, server, tool, drink? }. ``form`` is what it is built as;
//: ``tool`` what it is eaten with (hand, fork and knife, fork, spoon, chopsticks, sip, straw).
export function dishForm(dish, recipe) {
  const b = recipe?.build || [], v = recipe?.vessel || "plate";
  const D = (form, server, tool, extra = {}) => ({ form, server, tool, ...extra });
  // Drinks.
  if (has(b, "coffee_beans")) return D("drink", vesselFor(dish === "deli_coffee" ? "deli_coffee" : has(b, "milk") ? "latte" : "coffee"), "sip", { drink: has(b, "milk") ? "latte" : "coffee" });
  if (has(b, "tea_leaves")) return has(b, "ice") ? D("drink", "highball", "sip", { drink: "iced_tea" }) : D("drink", "cup", "sip", { drink: "tea" });
  if (has(b, "beer_keg")) return D("drink", "pint", "sip", { drink: "beer" });
  if (has(b, "wine")) return D("drink", "wine", "sip", { drink: "wine" });
  if (has(b, "soda_syrup")) return D("drink", "highball", "straw", { drink: "cola" });
  if (has(b, "water_bottle")) return D("drink", "highball", "sip", { drink: "water" });
  if (has(b, "oranges") && cooked(b, "oranges").includes("blend")) return D("drink", "highball", "sip", { drink: "orange_juice" });
  if (b.some((x) => x.p.includes("blend")) && has(b, "ice_cream")) return D("drink", "shake", "straw", { drink: "milkshake" });
  if (b.some((x) => x.p.includes("blend")) && (has(b, "banana") || has(b, "berries") || has(b, "yogurt"))) return D("drink", "shake", "straw", { drink: "smoothie" });
  if (dish === "cocktail") return D("drink", "coupe", "sip", { drink: "cocktail" });
  // Ice cream (and a sundae).
  if (has(b, "ice_cream")) return D("scoops", "dessert_bowl", "spoon");
  // Things held to eat.
  if (has(b, "bun")) return D("burger", has(b, "potato") ? "plate" : "wrap", "hand", { side: has(b, "potato") ? "fries" : null });
  if (has(b, "pizza_slice_baked")) return D("pizza_slice", "plate", "hand");
  if (has(b, "pizza_dough")) return D("pizza", "pizza_board", "hand");
  if (has(b, "baguette")) return D("banh_mi", "plate", "hand");
  if (has(b, "bread") && count(b, "bread") >= 2 && !cooked(b, "bread").includes("bake")) return D("sandwich", "plate", "hand");
  if (has(b, "pita")) return D("pita_wrap", "wrap", "hand");
  if (has(b, "tortilla") && v === "wrap") return D("burrito", "wrap", "hand");
  if (has(b, "tortilla") && has(b, "cheese") && count(b, "tortilla") >= 2 && cooked(b, "cheese").includes("grill")) return D("quesadilla", "plate", "hand");
  if (has(b, "tortilla")) return D("tacos", "plate", "hand", { n: Math.max(2, Math.min(3, count(b, "tortilla") + 1)) });
  if (has(b, "bagel")) return D("bagel", "plate", "hand");
  if (has(b, "pastry_dough")) return D("croissant", "plate", "hand");
  if (has(b, "flour") && cooked(b, "flour").includes("fry") && has(b, "sugar") && !has(b, "fish_fillet")) return D("donut", "bag", "hand");
  if (has(b, "flour") && cooked(b, "flour").includes("bake") && v === "bag") return D("loaf", "bag", "hand");
  if (has(b, "naan_dough")) return D("naan", "basket", "hand");
  if (has(b, "chips_bag")) return D("chips", "bag", "hand");
  if (has(b, "dumpling_wrappers")) return D("dumplings", "steamer", "chopsticks");
  if (has(b, "nori") && has(b, "rice") && (has(b, "salmon") || has(b, "tuna"))) return D("sushi", "board", "chopsticks");
  // Bowls: noodle soups, soups, curries, rice bowls, salads.
  if ((has(b, "ramen_broth") || has(b, "broth")) && (has(b, "ramen_noodles") || has(b, "rice_noodles") || has(b, "noodles"))) return D("noodle_soup", "ramen_bowl", "chopsticks");
  if (has(b, "arborio")) return D("risotto", "bowl", "fork");
  if (has(b, "broth") || (has(b, "clams") && has(b, "cream"))) return D("soup", "bowl", "spoon", { creamy: has(b, "cream") });
  if (has(b, "curry_paste") || has(b, "tikka_sauce")) return D("curry", "bowl", "spoon");
  if (v === "bowl" && has(b, "rice")) return D("rice_bowl", "bowl", "spoon");
  if (b.filter((x) => x.ing === "lettuce").reduce((s, x) => s + x.qty, 0) >= 2 && !has(b, "beef_slices")) return D("salad", "bowl", "fork");
  // Baskets.
  if (has(b, "fish_fillet")) return D("fish_chips", "basket", "hand");
  if (has(b, "chicken_wings")) return D("wings", "basket", "hand");
  if (has(b, "potato") && cooked(b, "potato").includes("fry") && b.length <= 3) return D("fries", "basket", "hand");
  // Plates.
  if (has(b, "oysters")) return D("oysters", "plate", "hand");
  if (has(b, "crab")) return D("crab", "plate", "hand");
  if (has(b, "flour") && has(b, "egg") && has(b, "milk") && cooked(b, "flour").includes("grill")) return D("pancakes", "plate", "fork_knife");
  if (has(b, "flour") && cooked(b, "flour").includes("bake") && (has(b, "cream") || has(b, "sugar"))) return D("cake", "side_plate", "fork");
  if (has(b, "pasta")) return D("pasta", "plate", "fork");
  if ((has(b, "noodles") || has(b, "rice_noodles")) && b.some((x) => x.p.includes("wok"))) return D("stir_fried_noodles", "plate", "fork");
  if (has(b, "rice") && cooked(b, "rice").includes("wok")) return D("fried_rice", "plate", "fork");
  if (has(b, "beef_slices") && has(b, "lettuce")) return D("korean_bbq", "plate", "chopsticks");
  // A stir-fry over rice (kung pao): bite-sized already, so a fork.
  if (b.some((x) => x.p.includes("wok") && ["chicken", "beef_slices", "pork", "shrimp", "tofu", "lamb"].includes(x.ing))) return D("stir_fry", "plate", "fork");
  return D("plate", "plate", "fork_knife");
}

// ---- building the food ---------------------------------------------------------------------------------

//: A layer of a bite-able food, from a mask's outlines: extruded ``depth`` thick from ``y0``, its
//: edges rounded ``bevel``, its top lifted by ``dome(x, z)`` (a bun's crown), its sides one
//: material and its faces another.
function layerGeometry(THREE, shapes, { y0 = 0, depth = 0.01, bevel = 0.002, dome = null, sag = null, curve = 4 }) {
  const parts = [];
  for (const { outer, holes } of shapes) {
    if (outer.length < 3) continue;
    const s = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: curve });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0 + bevel, 0);
    parts.push(g);
  }
  if (!parts.length) return null;
  const g = parts.length === 1 ? parts[0] : mergeSimple(THREE, parts);
  if (dome || sag) {
    const P = g.attributes.position, mid = y0 + depth / 2;
    for (let i = 0; i < P.count; i += 1) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), up = (y - y0) / Math.max(1e-6, depth);
      if (dome && y > mid) P.setY(i, y + dome(x, z) * up);
      if (sag) P.setY(i, P.getY(i) + sag(x, z));
    }
  }
  // Top-down uvs (a texture painted as seen from above lies the same on every layer and bite).
  const P = g.attributes.position, UV = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i += 1) { UV[i * 2] = 0.5 + P.getX(i) / 0.16; UV[i * 2 + 1] = 0.5 - P.getZ(i) / 0.16; }
  g.setAttribute("uv", new THREE.BufferAttribute(UV, 2));
  g.computeVertexNormals();
  return g;
}

//: A food that is bitten: its layers (each a mask of where it is, a height and its look) and
//: what is left (one mask, the bites taken out of every layer at once). ``front``: the way the
//: mouth comes at it (in its frame). Toppings (seeds, herbs, filling bits) go with what they sit on.
function biteable(THREE, L, { half = 0.08, layers, front = [0, 1], toppings = [], name = "food", hands = 1, grip = null }) {
  const group = new THREE.Group(); group.name = name;
  const left = fillMask(createMask(half, 112), (x, z) => layers.some((ly) => ly.inside(x, z)));
  const bases = layers.map((ly) => fillMask(createMask(half, 112), ly.inside));
  const meshes = layers.map((ly) => { const m = new THREE.Mesh(new THREE.BufferGeometry(), ly.materials ? ly.materials.map((k) => L.m(k)) : L.m(ly.material)); m.castShadow = true; m.receiveShadow = true; group.add(m); return m; });
  const tops = new THREE.Group(); group.add(tops);
  for (const t of toppings) tops.add(t);
  const area0 = areaOf(left);
  function rebuild() {
    layers.forEach((ly, k) => {
      const M = { ...left, data: left.data.map((v, i) => v & bases[k].data[i]) };
      const geo = layerGeometry(THREE, shapesOf(M), ly);
      meshes[k].geometry.dispose();
      meshes[k].geometry = geo || new THREE.BufferGeometry();
      meshes[k].visible = Boolean(geo);
    });
    const at = (x, z) => { const i = Math.floor((x + half) / left.cell), j = Math.floor((z + half) / left.cell); return i >= 0 && j >= 0 && i < left.n && j < left.n && left.data[j * left.n + i]; };
    for (const t of tops.children) t.visible = Boolean(at(t.position.x, t.position.z));
  }
  rebuild();
  return {
    group, frame: () => group, kind: "bite", hands, grip, front,
    left: () => areaOf(left) / area0,
    //: Where the next bite goes (in its frame): the edge nearest the mouth, up at the middle of
    //: its height.
    nextAt() { const e = frontEdge(left, front[0], front[1]); return e ? { x: e.x, z: e.z, y: layers.reduce((s, ly) => Math.max(s, ly.y0 + ly.depth), 0) * 0.55 } : null; },
    //: Take a bite at the front: what is left loses a mouthful (and the teeth's marks).
    //: A mouthful is about 9 to 18 cm² of it whatever the shape: at a thin end (a slice's
    //: point, a corner) the teeth go in further, as far as that takes.
    bite(r = 0.024) {
      const want = Math.min(0.0018, Math.max(0.0009, area0 / 9));
      let taken = 0;
      for (let k = 0; k < 4 && taken < want; k += 1) {
        const e = frontEdge(left, front[0], front[1]);
        if (!e) break;
        const inset = r * (0.45 - 0.55 * k);
        taken += subtractCircles(left, biteCircles(e.x + front[0] * inset, e.z + front[1] * inset, front[0], front[1], r));
      }
      if (!taken) return 0;
      if (areaOf(left) < area0 * 0.07) left.data.fill(0);
      rebuild();
      return taken;
    },
    done: () => areaOf(left) < area0 * 0.07,
    //: Cut off a forkful (r m square) at the front with the knife, as a food of its own (same
    //: layers): the piece and the cut's line ({x, z, along}) for the knife to follow.
    cutPiece(size = 0.03) {
      const e = frontEdge(left, front[0], front[1]);
      if (!e) return null;
      const cx = e.x - front[0] * size, cz = e.z - front[1] * size, px = -front[1], pz = front[0];
      const piece = cutOff(left, cx, cz, front[0], front[1], (x, z) => Math.abs((x - e.x) * px + (z - e.z) * pz) < size * 0.75);
      if (areaOf(left) < area0 * 0.07) { for (let i = 0; i < left.data.length; i += 1) piece.data[i] |= left.data[i]; left.data.fill(0); }
      rebuild();
      const g = new THREE.Group(); g.name = `${name}-piece`;
      layers.forEach((ly, k) => {
        const M = { ...piece, data: piece.data.map((v, i) => v & bases[k].data[i]) };
        const geo = layerGeometry(THREE, shapesOf(M), ly);
        if (geo) g.add(new THREE.Mesh(geo, ly.cutMaterial ? [L.m(ly.cutMaterial), L.m(ly.cutMaterial)] : meshes[k].material));
      });
      // Centred on itself (it is carried on the fork by its middle).
      const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3());
      for (const m of g.children) m.geometry.translate(-c.x, -box.min.y, -c.z);
      g.userData.from = c;
      return { piece: g, line: { x: cx, z: cz, along: [px, pz] } };
    },
  };
}
//: A disc's outline test.
const disc = (r, x0 = 0, z0 = 0) => (x, z) => (x - x0) ** 2 + (z - z0) ** 2 <= r * r;
const roundedSquare = (h, r) => (x, z) => { const dx = Math.max(0, Math.abs(x) - (h - r)), dz = Math.max(0, Math.abs(z) - (h - r)); return dx * dx + dz * dz <= r * r; };
const domeOf = (r, h) => (x, z) => h * Math.max(0, 1 - (x * x + z * z) / (r * r)) ** 0.8;

//: A small solid scattered on things: a blob of ``size`` (rx, ry, rz) in ``material``.
function blob(THREE, L, material, rx, ry, rz, seed = 1, amp = 0.15, seg = 10) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  g.scale(rx, ry, rz);
  lumpy(g, Math.min(rx, ry, rz) * amp, 1 / Math.max(0.004, Math.min(rx, rz)) * 1.4, seed);
  const m = new THREE.Mesh(g, L.m(material)); m.castShadow = true;
  return m;
}
//: Many small things merged into one mesh (seeds on a bun, peas in rice, herbs on a curry).
function scatter(THREE, L, material, n, place, shape, seed = 7) {
  const r = rng(seed), parts = [];
  for (let i = 0; i < n; i += 1) {
    const g = shape(r, i); const [x, y, z, yaw = r() * 6.28, tilt = 0] = place(r, i);
    g.rotateZ(tilt); g.rotateY(yaw); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g);
  }
  const m = new THREE.Mesh(mergeSimple(THREE, parts), L.m(material)); m.castShadow = true;
  return m;
}
//: A slice (a disc ``r`` across and ``t`` thick) with its cut face textured.
function slice(THREE, L, faceMat, rimMat, r, t, seg = 20) {
  const g = new THREE.CylinderGeometry(r, r, t, seg, 1);
  const m = new THREE.Mesh(g, [L.m(rimMat), L.m(faceMat), L.m(faceMat)]);
  m.castShadow = true;
  return m;
}
//: A wedge of lemon or lime: a quarter of a lathed fruit, its flesh face on the cut.
function citrusWedge(THREE, L, kind = "lemon", r = 0.028) {
  const g = new THREE.Group();
  const peel = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI / 2, 0, Math.PI), L.m(`${kind}_peel`));
  const flesh = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 12, 0, Math.PI), L.m(kind));
  flesh.rotation.y = Math.PI / 2; flesh.position.x = 0.0005;
  const flesh2 = flesh.clone(); flesh2.rotation.y = 0; flesh2.position.set(0, 0, 0.0005);
  g.add(peel, flesh, flesh2);
  g.scale.set(1, 0.8, 1.35);
  g.rotation.z = -Math.PI / 2;
  return g;
}
//: A leaf (lettuce, basil, cilantro, spinach): a ruffled oval, curled up a little.
function leafGeometry(THREE, w, l, seed, ruffle = 0.3) {
  const g = new THREE.PlaneGeometry(w, l, 6, 8); g.rotateX(-Math.PI / 2);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i += 1) {
    const x = P.getX(i), z = P.getZ(i), u = x / (w / 2), v = z / (l / 2);
    const edge = Math.max(0, 1 - (u * u) / Math.max(0.05, 1 - v * v * 0.85));
    P.setX(i, x * (edge > 0 ? 1 : 0.4));
    P.setY(i, (u * u) * w * 0.35 + noise3(x * 90, 0, z * 90, seed) * w * ruffle * 0.3);
  }
  g.computeVertexNormals();
  return g;
}

//: Fries: so many sticks of potato, fried golden, piled where ``place`` says.
function fries(THREE, L, n, place, seed = 3) {
  return scatter(THREE, L, "fries", n, place, (r) => { const len = 0.055 + r() * 0.035, g = new THREE.BoxGeometry(0.0085, 0.0085, len, 1, 1, 3); const P = g.attributes.position; for (let i = 0; i < P.count; i += 1) { const z = P.getZ(i); P.setY(i, P.getY(i) + (z / len) ** 2 * 0.004 * (r() - 0.5)); } return g; }, seed);
}

//: Noodles: strands wound loosely into a nest of ``r`` (a forkful, or a bowl's worth).
function noodleNest(THREE, L, material, r, h, strands = 26, seed = 5, thick = 0.0016) {
  const rand = rng(seed), parts = [];
  for (let s = 0; s < strands; s += 1) {
    const pts = [], a0 = rand() * 6.28, turns = 1.5 + rand() * 1.5, rr = r * (0.35 + rand() * 0.6);
    for (let k = 0; k <= 24; k += 1) { const t = k / 24, a = a0 + t * turns * 6.28; pts.push(new THREE.Vector3(Math.cos(a) * rr * (0.7 + 0.3 * Math.sin(t * 9 + s)), h * (0.15 + 0.7 * rand() * Math.sin(Math.PI * t)), Math.sin(a) * rr * (0.7 + 0.3 * Math.cos(t * 7 + s)))); }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, thick, 5, false).toNonIndexed());
  }
  const m = new THREE.Mesh(mergeSimple(THREE, parts), L.m(material)); m.castShadow = true;
  return m;
}

// ---- the dishes -----------------------------------------------------------------------------------------

//: A burger in its bun: the heel, the patty, cheese draped over it, lettuce, tomato, pickles, the
//: sauce, the crown with its sesame seeds. Held in both hands, bitten from the front.
//: A burger's parts, each a layer of the stack (or toppings laid at its height): what a part is
//: drawn as, from the plate up.
const SAUCE_KEY = { ketchup: "sauce_red", mayo: "sauce_white", mustard: "sauce_yellow", bbq_sauce: "sauce_brown", hot_sauce: "sauce_hot", tahini: "tahini", salsa: "salsa" };
function stackLayer(ing, R, seed, k) {
  switch (ing) {
    case "heel": return { inside: disc(R), depth: 0.022, bevel: 0.006, dome: domeOf(R, 0.002), materials: ["bun_cut", "bun"] };
    case "crown": return { inside: disc(R * 0.97), depth: 0.033, bevel: 0.012, dome: domeOf(R, 0.012), materials: ["bun", "bun"], crown: true };
    case "beef_patty": return { inside: disc(R * 1.03), depth: 0.017, bevel: 0.004, materials: ["patty", "patty"] };
    case "chicken": return { inside: (x, z) => x * x + z * z <= (R * (1.04 + 0.05 * Math.sin(Math.atan2(z, x) * 3 + k))) ** 2, depth: 0.016, bevel: 0.005, materials: ["chicken", "chicken"] };
    case "cheese": return { inside: roundedSquare(0.045, 0.004), depth: 0.0025, bevel: 0.0008, sag: (x, z) => -Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - 0.04) * 0.9, materials: ["cheese", "cheese"] };
    case "lettuce": return { inside: (x, z) => x * x + z * z <= (R * (1.08 + 0.06 * Math.sin(Math.atan2(z, x) * 7))) ** 2, depth: 0.004, bevel: 0.001, sag: (x, z) => noise3(x * 60, 1, z * 60, seed) * 0.003, materials: ["lettuce", "lettuce"] };
    case "tomato": return { inside: disc(R * 0.82), depth: 0.007, bevel: 0.001, materials: ["tomato_skin", "tomato"] };
    case "onion": return { inside: (x, z) => { const d = Math.hypot(x, z); return d <= R * 0.78 && (d % 0.009) < 0.0055; }, depth: 0.003, bevel: 0.0006, materials: ["onion", "onion"] };
    case "bacon": return { inside: (x, z) => Math.abs(x) <= R * 1.05 && Math.abs(z) <= R * 0.9 && ((z + 0.1) % 0.022) < 0.015, depth: 0.004, bevel: 0.0008, sag: (x) => Math.sin(x * 120 + k) * 0.0015, materials: ["bacon", "bacon"] };
    case "egg": return { inside: (x, z) => x * x + z * z <= (R * (1.1 + 0.08 * Math.sin(Math.atan2(z, x) * 5 + k))) ** 2, depth: 0.003, bevel: 0.0008, materials: ["egg_white", "egg_white"], yolk: true };
    default: return null;
  }
}
//: A burger stacked the way it was built (``b``, the plate's order; the recipe's when null): each
//: part a layer from the plate up, the bun's heel where the bun went on and its crown on top -- so
//: a patty put down before the bun is under it, and what was left off is not there.
function burger(THREE, L, seed, b = null) {
  const R = 0.056;
  const build = b || [{ ing: "bun" }, { ing: "beef_patty", qty: 1 }, { ing: "cheese" }, { ing: "lettuce" }, { ing: "tomato" }, { ing: "pickles" }, { ing: "ketchup" }];
  const parts = [];
  let bun = false;
  for (const c of build.filter((x) => !x.side)) {
    if (c.ing === "bun") { bun = true; parts.push("heel"); continue; }
    const n = c.ing === "beef_patty" || c.ing === "chicken" || c.ing === "bacon" ? Math.max(1, Math.round(c.qty || 1)) : 1;
    for (let i = 0; i < n; i += 1) parts.push(c.ing);
  }
  if (bun) parts.push("crown");
  const layers = [], seeds = [], r = rng(seed);
  let y = 0;
  parts.forEach((ing, k) => {
    // Toppings with no layer of their own: pickles and sauces, laid at the height they went on.
    if (ing === "pickles") { for (let i = 0; i < 4; i += 1) { const p = slice(THREE, L, "pickle", "pickle", 0.013, 0.003, 12); p.position.set(Math.cos(i * 1.6) * 0.022, y + 0.0015, Math.sin(i * 1.6) * 0.022); seeds.push(p); } y += 0.002; return; }
    if (SAUCE_KEY[ing]) { const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.002, 18), L.m(SAUCE_KEY[ing])); sc.position.set(0, y + 0.001, 0.004); seeds.push(sc); y += 0.0012; return; }
    const ly = stackLayer(ing, R, seed, k);
    if (!ly) return;
    layers.push({ ...ly, y0: y });
    if (ly.crown) {
      // The crown's sesame seeds, on its dome.
      for (let i = 0; i < 70; i += 1) {
        const a = r() * 6.28, d = Math.sqrt(r()) * R * 0.82, x = Math.cos(a) * d, z = Math.sin(a) * d;
        const sm = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 5, 3).scale(1, 0.45, 0.6), L.m("sesame"));
        sm.position.set(x, y + 0.033 + domeOf(R, 0.012)(x, z) * 0.9 - 0.004 * (d / R) ** 2, z); sm.rotation.y = a;
        seeds.push(sm);
      }
    }
    if (ly.yolk) { const yk = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), L.m("yolk")); yk.position.set(0.004, y + ly.depth, -0.003); seeds.push(yk); }
    y += ly.depth - 0.0005;
  });
  if (!layers.length) layers.push({ ...stackLayer("beef_patty", R, seed, 0), y0: 0 });
  return biteable(THREE, L, { half: 0.072, layers, toppings: seeds, name: "burger", hands: 2 });
}
//: A sandwich cut corner to corner: two triangles of bread with ham, cheese, lettuce and tomato.
function sandwichHalf(THREE, L, sgn, seed, b = null) {
  const tri = (x, z) => sgn * (x - z) >= -0.002 && Math.abs(x) <= 0.055 && Math.abs(z) <= 0.055;
  const breadCut = (x, z) => tri(x, z) && roundedSquare(0.055, 0.012)(x, z);
  const scaled = (k) => (x, z) => breadCut(x * k, z * k);
  // Stacked as built (``b``: the plate's order): a slice of bread wherever bread went on, the
  // first one crumb up and the rest crust up; what was left out is not there.
  const build = (b || [{ ing: "bread" }, { ing: "lettuce" }, { ing: "ham" }, { ing: "cheese" }, { ing: "tomato" }, { ing: "bread" }]).filter((c) => !c.side);
  const LAYER = {
    lettuce: { inside: scaled(0.97), depth: 0.003, bevel: 0.0008, sag: (x, z) => noise3(x * 50, 0, z * 50, seed) * 0.0015, materials: ["lettuce", "lettuce"] },
    ham: { inside: scaled(1.02), depth: 0.006, bevel: 0.0006, materials: ["cut_meat", "beef_raw"], cutMaterial: "beef_raw" },
    turkey: { inside: scaled(1.02), depth: 0.006, bevel: 0.0006, materials: ["chicken_meat", "chicken_meat"] },
    bacon: { inside: (x, z) => scaled(1.0)(x, z) && ((x + z + 0.2) % 0.02) < 0.013, depth: 0.004, bevel: 0.0006, materials: ["bacon", "bacon"] },
    cheese: { inside: scaled(1.04), depth: 0.002, bevel: 0.0005, materials: ["cheese", "cheese"] },
    tomato: { inside: scaled(1.2), depth: 0.005, bevel: 0.0008, materials: ["tomato_skin", "tomato"] },
    egg: { inside: scaled(1.0), depth: 0.004, bevel: 0.0008, materials: ["egg_white", "egg_white"] },
    mustard: { inside: scaled(1.06), depth: 0.0008, bevel: 0.0002, materials: ["sauce_yellow", "sauce_yellow"] },
    mayo: { inside: scaled(1.06), depth: 0.0008, bevel: 0.0002, materials: ["sauce_white", "sauce_white"] },
  };
  const layers = [];
  let y = 0, slices = 0;
  for (const c of build) {
    if (c.ing === "bread") { layers.push({ inside: breadCut, y0: y, depth: 0.013, bevel: 0.002, materials: slices === 0 ? ["bread", "crust"] : ["crust", "bread"] }); slices += 1; y += 0.013; continue; }
    const ly = LAYER[c.ing];
    if (!ly) continue;
    layers.push({ ...ly, y0: y }); y += ly.depth;
  }
  if (!layers.length) layers.push({ inside: breadCut, y0: 0, depth: 0.013, bevel: 0.002, materials: ["bread", "crust"] });
  // The ham is pink: the cut meat look reads as ham at this size.
  // Bitten at its point (where the diagonal cut meets the crust).
  const f = biteable(THREE, L, { half: 0.07, layers, name: "sandwich", front: [sgn * 0.7071, sgn * 0.7071] });
  return f;
}
//: A slice of pizza: the dough, tomato, mozzarella blistered brown, a basil leaf, the puffed rim.
function pizzaSlice(THREE, L, seed, r = 0.15, wedge = Math.PI / 4, b = null) {
  const inside = (x, z) => { const d = Math.hypot(x, z + r / 2); const a = Math.atan2(x, z + r / 2); return d <= r && Math.abs(a) <= wedge / 2; };
  // What was put on (``b``, the plate): sauce and cheese as the top, sauce alone red, cheese alone
  // white; neither, bare dough. Basil only if it went on.
  const on = (id) => !b || b.some((c) => c.ing === id);
  const sauce = on("tomato_sauce"), cheese = on("mozzarella") || on("cheese");
  const top = sauce && cheese ? "pizza_top" : sauce ? "sauce_red" : cheese ? "mozzarella" : null;
  const layers = [
    { inside, y0: 0, depth: 0.004, bevel: 0.001, materials: ["pizza_crust", "pizza_crust"] },
    ...(top ? [{ inside: (x, z) => inside(x, z) && Math.hypot(x, z + r / 2) < r - 0.018, y0: 0.004, depth: 0.003, bevel: 0.0008, materials: [top, top] }] : []),
    { inside: (x, z) => inside(x, z) && Math.hypot(x, z + r / 2) >= r - 0.022, y0: 0.002, depth: 0.016, bevel: 0.006, materials: ["pizza_crust", "pizza_crust"] },
  ];
  const leaves = [];
  if (on("basil")) { const leaf = new THREE.Mesh(leafGeometry(THREE, 0.018, 0.03, seed), L.m("herb")); leaf.position.set(0.003, 0.0075, -0.01); leaves.push(leaf); }
  // Bitten from the point (+z here: the slice's tip faces the mouth).
  const f = biteable(THREE, L, { half: 0.09, layers, toppings: leaves, name: "pizza-slice", front: [0, -1] });
  f.group.rotation.y = Math.PI;   // the tip toward +z, the sitter
  return f;
}
//: A taco: a corn tortilla folded round chopped pork, onion, cilantro and salsa, a lime wedge.
function taco(THREE, L, seed, b = null) {
  const g = new THREE.Group(); g.name = "taco";
  const R = 0.075, has0 = (id) => !b || b.some((c) => c.ing === id);
  // The tortilla folded into a U along x: its disc wrapped round a fold of radius R / amax, the
  // edges brought up through 108 degrees each side, so it stands about 5 cm tall and opens about
  // 7 cm at the top (a taco's shape), not a shallow dish.
  const amax = Math.PI * 0.6, rf = R / amax;
  const shellOn = has0("tortilla");
  if (shellOn) {
    const tort = new THREE.CircleGeometry(R, 40);
    tort.rotateX(-Math.PI / 2);
    const P = tort.attributes.position;
    for (let i = 0; i < P.count; i += 1) { const z = P.getZ(i), a = (z / R) * amax; P.setXYZ(i, P.getX(i), rf * (1 - Math.cos(a)), rf * Math.sin(a)); }
    tort.computeVertexNormals();
    const shell = new THREE.Mesh(tort, L.m("tortilla")); shell.castShadow = true; g.add(shell);
  }
  // The filling inside the U: as wide at each height as the fold is there.
  const halfAt = (y) => rf * Math.sin(Math.acos(Math.max(-1, Math.min(1, 1 - y / rf))));
  const inU = (r, lo, hi, spread = 0.7) => { const y = lo + r() * (hi - lo), x = (r() - 0.5) * R * 1.6; return [x, shellOn ? y : y * 0.35, (r() - 0.5) * 2 * (shellOn ? halfAt(y) : 0.03) * spread]; };
  const meat = ["pork", "chicken", "beef_slices", "steak", "shrimp", "fish_fillet", "lamb"].find((id) => !b ? id === "pork" : b.some((c) => c.ing === id));
  const meatKey = { pork: "pork", chicken: "chicken_bits", beef_slices: "seared", steak: "seared", shrimp: "shrimp", fish_fillet: "batter", lamb: "lamb" }[meat];
  if (meatKey) g.add(scatter(THREE, L, meatKey, 30, (r) => inU(r, 0.006, 0.026), (r) => lumpy(new THREE.BoxGeometry(0.01 + r() * 0.006, 0.007, 0.008), 0.0012, 300, 2, 1), seed));
  if (has0("onion")) g.add(scatter(THREE, L, "onion", 30, (r) => inU(r, 0.026, 0.034), () => new THREE.BoxGeometry(0.004, 0.003, 0.004), seed + 1));
  if (has0("cilantro")) g.add(scatter(THREE, L, "herb", 16, (r) => inU(r, 0.032, 0.036), (r) => leafGeometry(THREE, 0.006, 0.009, r() * 100, 0.5), seed + 2));
  if (has0("salsa")) g.add(scatter(THREE, L, "salsa", 12, (r) => inU(r, 0.03, 0.036, 0.5), () => new THREE.SphereGeometry(0.004, 6, 4), seed + 3));
  if (b?.some((c) => c.ing === "cheese")) g.add(scatter(THREE, L, "cheese", 24, (r) => inU(r, 0.033, 0.038), () => new THREE.BoxGeometry(0.008, 0.0015, 0.0015), seed + 4));
  if (b?.some((c) => c.ing === "lettuce")) g.add(scatter(THREE, L, "lettuce", 20, (r) => inU(r, 0.03, 0.036), () => new THREE.BoxGeometry(0.009, 0.001, 0.002), seed + 5));
  g.rotation.y = -Math.PI / 2;   // its end (+x) toward the sitter (+z)
  // Bitten from its end: the taco shortens.
  const length0 = 2 * R;
  let eaten = 0;
  return {
    group: g, frame: () => g, kind: "bite", hands: 1, front: [1, 0], left: () => 1 - eaten / length0,
    nextAt: () => ({ x: R - eaten, y: 0.035, z: 0 }),
    bite() { eaten = Math.min(length0, eaten + 0.035); clip(THREE, g, R - eaten); return 0.035; },
    done: () => eaten >= length0 - 0.02,
  };
}
//: What is past x = ``cut`` (in the group's frame, before its turn) hidden: its vertices pulled
//: back to the cut, a bitten end.
function clip(THREE, group, cut) {
  group.traverse((m) => {
    if (!m.isMesh) return;
    const P = m.geometry.attributes.position;
    if (!m.geometry.userData.orig) m.geometry.userData.orig = P.array.slice();
    const O = m.geometry.userData.orig;
    for (let i = 0; i < P.count; i += 1) {
      const x = O[i * 3];
      const scallop = 0.004 * Math.abs(Math.sin(O[i * 3 + 2] * 260));
      P.setX(i, Math.min(x, cut - scallop));
    }
    P.needsUpdate = true; m.geometry.computeVertexNormals();
  });
}
//: A burrito in foil, opened at its end: the end bitten back as it is eaten, its cut face the rice,
//: beans, chicken, salsa and cheese inside.
function burrito(THREE, L, seed, kind = "burrito") {
  const g = new THREE.Group(); g.name = kind;
  const len = kind === "burrito" ? 0.2 : 0.17, r = kind === "burrito" ? 0.033 : 0.028;
  const body = new THREE.CylinderGeometry(r, r * 0.97, len, 24, 12, true); body.rotateZ(Math.PI / 2);
  lumpy(body, 0.0025, 60, seed, 1);
  const tort = new THREE.Mesh(body, L.m(kind === "burrito" ? "tortilla" : "naan")); tort.castShadow = true;
  // Foil (or paper) over the back two-thirds, crinkled.
  const foilG = new THREE.CylinderGeometry(r * 1.06, r * 1.04, len * 0.62, 24, 10, true); foilG.rotateZ(Math.PI / 2); foilG.translate(-len * 0.19, 0, 0);
  lumpy(foilG, 0.002, 180, seed + 1, 2);
  const foil = new THREE.Mesh(foilG, L.m(kind === "burrito" ? "foil" : "wrap_paper")); foil.castShadow = true;
  const end = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 24), L.m("burrito_cut")); end.rotation.y = Math.PI / 2;
  const back = new THREE.Mesh(new THREE.CircleGeometry(r * 1.05, 24), L.m(kind === "burrito" ? "foil" : "wrap_paper")); back.rotation.y = -Math.PI / 2; back.position.x = -len / 2;
  g.add(tort, foil, end, back);
  g.position.y = r;
  g.rotation.y = -Math.PI / 2;   // its open end toward the sitter (+z)
  let eaten = 0;
  // Eaten down into the foil (peeled back as it goes), all but the last bit held.
  const L0 = len * 0.82;
  const place = () => { const x = len / 2 - eaten; end.position.x = x; clip(THREE, tort, x); };
  place();
  return {
    group: g, frame: () => g, kind: "bite", hands: 2, front: [1, 0], left: () => Math.max(0, 1 - eaten / L0),
    nextAt: () => ({ x: len / 2 - eaten, y: 0, z: 0 }),
    bite() { eaten = Math.min(L0, eaten + 0.025); place(); return 0.025; },
    done: () => eaten >= L0 - 0.005,
  };
}
//: A banh mi: a split baguette, crackling crust, pork, pickled carrot and cucumber, chilli and
//: cilantro. Bitten from its end like the burrito.
function banhMi(THREE, L, seed) {
  const g = new THREE.Group(); g.name = "banh-mi";
  const len = 0.2, r = 0.03;
  const loaf = new THREE.CylinderGeometry(r, r, len, 24, 14, false, -Math.PI * 0.42, Math.PI * 1.84); loaf.rotateZ(Math.PI / 2);
  const P = loaf.attributes.position;
  for (let i = 0; i < P.count; i += 1) { const x = P.getX(i), taper = 1 - Math.max(0, Math.abs(x) - len * 0.38) / (len * 0.12) * 0.55; P.setY(i, P.getY(i) * taper * 0.85); P.setZ(i, P.getZ(i) * taper * 1.05); }
  lumpy(loaf, 0.0015, 50, seed, 1);
  const crust = new THREE.Mesh(loaf, L.m("crust")); crust.material = L.m("crust"); crust.castShadow = true;
  const pork = scatter(THREE, L, "pork", 18, (r2) => [(r2() - 0.5) * len * 0.8, r * 0.55 + r2() * 0.006, (r2() - 0.5) * 0.012, r2() * 0.5, 0.3], () => roundedSlab(THREE, 0.03, 0.02, 0.004, 0.003), seed);
  const carrot = scatter(THREE, L, "carrot", 40, (r2) => [(r2() - 0.5) * len * 0.8, r * 0.7 + r2() * 0.006, (r2() - 0.5) * 0.016, r2() * 6, 0.2], () => new THREE.BoxGeometry(0.0018, 0.0018, 0.03), seed + 1);
  const cuc = scatter(THREE, L, "cucumber", 8, (r2) => [(r2() - 0.5) * len * 0.8, r * 0.75, (r2() - 0.5) * 0.008, 1.57, 1.2], () => new THREE.BoxGeometry(0.006, 0.006, 0.07), seed + 2);
  const cil = scatter(THREE, L, "herb", 12, (r2) => [(r2() - 0.5) * len * 0.8, r * 0.85, (r2() - 0.5) * 0.012], (r2) => leafGeometry(THREE, 0.01, 0.014, r2() * 100, 0.5), seed + 3);
  g.add(crust, pork, carrot, cuc, cil);
  g.position.y = r * 0.85;
  g.rotation.y = -Math.PI / 2;
  let eaten = 0;
  const L0 = len * 0.9;
  return {
    group: g, frame: () => g, kind: "bite", hands: 2, front: [1, 0], left: () => 1 - eaten / L0,
    nextAt: () => ({ x: len / 2 - eaten, y: r * 0.3, z: 0 }),
    bite() { eaten = Math.min(L0, eaten + 0.03); clip(THREE, g, len / 2 - eaten); return 0.03; },
    done: () => eaten >= L0 - 0.01,
  };
}
//: A bagel cut in half and spread with cream cheese, the halves side by side cut faces up.
function bagelHalf(THREE, L, seed) {
  const ring = (x, z) => { const d = Math.hypot(x, z); return d <= 0.048 && d >= 0.014; };
  const layers = [
    { inside: ring, y0: 0, depth: 0.02, bevel: 0.008, dome: null, materials: ["bagel", "bagel"] },
    { inside: (x, z) => { const d = Math.hypot(x, z); return d <= 0.043 && d >= 0.017; }, y0: 0.019, depth: 0.004, bevel: 0.0015, materials: ["cream_cheese", "cream_cheese"] },
  ];
  return biteable(THREE, L, { half: 0.06, layers, name: "bagel" });
}
//: A croissant: a crescent of laminated pastry, glossy with egg wash.
function croissant(THREE, L, seed) {
  const inside = (x, z) => { const d = Math.hypot(x, z + 0.05); const a = Math.atan2(x, z + 0.05); return d >= 0.03 && d <= 0.075 && Math.abs(a) < 1.25 + (d - 0.03) * 2; };
  const layers = [{ inside, y0: 0, depth: 0.038, bevel: 0.016, dome: (x, z) => 0.012 * Math.max(0, Math.cos(Math.atan2(x, z + 0.05) * 1.1)) * (0.6 + 0.4 * Math.abs(Math.sin(Math.atan2(x, z + 0.05) * 9))), materials: ["croissant", "croissant"] }];
  void seed;
  return biteable(THREE, L, { half: 0.09, layers, name: "croissant" });
}
//: A ring doughnut, glazed, a few sprinkles.
function donut(THREE, L, seed) {
  const ring = (x, z) => { const d = Math.hypot(x, z); return d <= 0.045 && d >= 0.014; };
  const layers = [
    { inside: ring, y0: 0, depth: 0.03, bevel: 0.0125, materials: ["dough_fried", "dough_fried"] },
    { inside: (x, z) => { const d = Math.hypot(x, z); return d <= 0.042 + 0.002 * Math.sin(Math.atan2(z, x) * 9) && d >= 0.017; }, y0: 0.019, depth: 0.012, bevel: 0.004, materials: ["glaze", "glaze"] },
  ];
  void seed;
  return biteable(THREE, L, { half: 0.055, layers, name: "donut" });
}
//: A slice of layer cake: sponge and cream in layers, cream on top, berries on it.
function cakeSlice(THREE, L, seed) {
  const inside = (x, z) => { const d = Math.hypot(x, z + 0.06); const a = Math.atan2(x, z + 0.06); return d <= 0.11 && Math.abs(a) <= 0.36; };
  const layers = [
    { inside, y0: 0, depth: 0.025, bevel: 0.001, materials: ["sponge", "sponge"] },
    { inside, y0: 0.025, depth: 0.008, bevel: 0.0005, materials: ["cream", "cream"] },
    { inside, y0: 0.033, depth: 0.025, bevel: 0.001, materials: ["sponge", "sponge"] },
    { inside, y0: 0.058, depth: 0.01, bevel: 0.003, materials: ["cream", "cream"] },
  ];
  const tops = [];
  const r = rng(seed);
  for (let i = 0; i < 3; i += 1) { const b = blob(THREE, L, "berry", 0.008, 0.009, 0.008, seed + i, 0.1); b.position.set((r() - 0.5) * 0.02, 0.072, -0.02 - i * 0.015); tops.push(b); }
  // Eaten from its point (-z here), which faces the sitter.
  const f = biteable(THREE, L, { half: 0.12, layers, toppings: tops, name: "cake", front: [0, -1] });
  f.group.rotation.y = Math.PI;
  return f;
}

//: A steak (or a chicken breast, a fish fillet): a seared slab, pink-grey inside where it is cut.
function slab(THREE, L, { rx = 0.075, rz = 0.05, t = 0.026, seed = 1, top = "seared", cut = "cut_meat", name = "steak", wobble = 0.12, loaf = false }) {
  // A slice of a loaf (toast) is square with a rounded crown, not a round cut of meat.
  const inside = loaf ? (x, z) => roundedSquare(rx, rx * 0.22)(x, z * (rx / rz)) && (z < rz * 0.6 || Math.hypot(x, (z - rz * 0.6) * 1.6) <= rx * 1.02)
    : (x, z) => { const a = Math.atan2(z, x), w = 1 + wobble * Math.sin(a * 3 + seed) + wobble * 0.5 * Math.sin(a * 5 + seed * 2); return (x / (rx * w)) ** 2 + (z / (rz * w)) ** 2 <= 1; };
  const layers = [{ inside, y0: 0, depth: t, bevel: t * 0.35, dome: (x, z) => t * 0.15 * Math.max(0, 1 - (x / rx) ** 2 - (z / rz) ** 2), materials: [top, top], cutMaterial: cut }];
  return biteable(THREE, L, { half: Math.max(rx, rz) * 1.3, layers, name, front: [0, 1] });
}

//: Pieces eaten one at a time: { group, take() → the next piece (lifted out of the dish), left }.
function pieces(group, list, order = (a, b) => b.position.z - a.position.z) {
  const left = list.slice().sort(order);
  const n0 = left.length;
  return { group, frame: () => left[0]?.parent || group, kind: "pieces", list: left, left: () => left.length / Math.max(1, n0), done: () => !left.length,
    nextAt: () => (left[0] ? { x: left[0].position.x, y: left[0].position.y + 0.01, z: left[0].position.z } : null),
    take: () => left.shift() || null };
}
//: A mound (rice, noodles, a salad, risotto): it goes down as forkfuls come off it.
function mound(THREE, L, mesh, { forkful }) {
  let left = 1;
  const base = mesh.scale.clone();
  return { group: mesh, frame: () => mesh.parent, kind: "mound", left: () => left, done: () => left <= 0.05,
    nextAt: () => ({ x: mesh.position.x, y: mesh.position.y + 0.02 * left, z: mesh.position.z + 0.02 }),
    take(share = 0.07) { left = Math.max(0, left - share); const s = Math.cbrt(Math.max(0.02, left)); mesh.scale.set(base.x * s, base.y * Math.max(0.15, s), base.z * s); mesh.visible = left > 0.05; return forkful(); } };
}

//: A broth, a soup or a curry in a bowl: its surface (and what floats on it) goes down the bowl as
//: it is eaten.
function pool(THREE, L, vessel, material, { fill = 0.8, floating = [] } = {}) {
  const spec = vessel.userData.vessel, inner = spec.inner;
  const drink = createDrink(inner, { fill });
  const dm = createDrinkMesh(THREE, inner, [{ material: L.m(material) }]);
  dm.update(drink);
  vessel.add(dm.group);
  const fl = new THREE.Group(); vessel.add(fl); for (const f of floating) fl.add(f);
  const y0 = drink.level();
  const v0 = drink.v;
  return { group: dm.group, frame: () => vessel, kind: "pool", drink, left: () => drink.v / v0, done: () => drink.v < v0 * 0.06,
    nextAt: () => ({ x: 0, y: drink.level(), z: 0.02 }),
    //: A spoonful (``ml``): the level down, and the spoon's own small pool of it.
    take(ml = 12) {
      drink.v = Math.max(0, drink.v - ml * 1e-6); dm.update(drink); fl.position.y = drink.level() - y0;
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.0125, 14).rotateX(-Math.PI / 2).scale(1, 1, 1.4), L.m(material)); s.name = "spoonful";
      return s;
    } };
}

//: Small things on a plate's well, in ``material``: chopped herbs, peas, sesame.
const sprinkle = (THREE, L, material, n, r, y, size, seed) => scatter(THREE, L, material, n, (q) => { const a = q() * 6.28, d = Math.sqrt(q()) * r; return [Math.cos(a) * d, y + q() * 0.004, Math.sin(a) * d]; }, () => new THREE.SphereGeometry(size, 5, 4), seed);

//: Every dish, built: { group (on the table at y = 0), food: [eaten parts, in the order eaten
//: is natural], form, tool, drink? (createDrink, for a sip), vessel }.
//: ``made`` (plated.mjs madeFrom): the plate as the cook made it -- drawn from what is on it, in
//: the order it went on, each part as it was cooked (browned on to char, or raw), what is missing
//: left out and what does not belong put on top; the dish's form is still the one ordered.
export function makeDish(THREE, R, dish, { recipe = null, seed = null, made = null } = {}) {
  const L0 = foodLook(THREE);
  const asked = recipe || (R?.kitchen?.recipes?.[dish] ? { vessel: R.kitchen.recipes[dish].vessel, build: R.kitchen.recipes[dish].build.map((c) => ({ ing: c[0], qty: c[1], p: c[2] || "-", side: Boolean(c[3]) })) } : { vessel: "plate", build: [] });
  const rec = made ? { vessel: made.target.vessel || asked.vessel, build: made.build } : asked;
  const F = dishForm(dish, made ? made.target : asked), sd = seed ?? [...String(dish)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  // The looks, as made: each material of an ingredient that came out raw or overdone tinted to it
  // (kept per state), any colour asked for by "#rrggbb", and a note of what was drawn.
  const used = new Set(), tints = (L0.tints ||= new Map());
  const L = { ...L0, m: (key) => {
    used.add(key);
    if (key[0] === "#") { if (!tints.has(key)) tints.set(key, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(key), roughness: 0.45, clearcoat: 0.3 })); return tints.get(key); }
    const st = lookState(made, key);
    if (!st) return L0.m(key);
    const k = `${key}|${st.ing}|${Math.round(st.burnt * 20)}|${Math.round(st.raw * 20)}`;
    // Hardly cooked, it has none of the surface cooking gives it (a raw steak has no grill marks).
    const base = st.raw >= 0.5 && RAW_SURFACE[key] ? (RAW_SURFACE[key] === "ham_raw" ? "cut_meat" : RAW_SURFACE[key]) : key;
    if (!tints.has(k)) tints.set(k, tinted(THREE, L0.m(base), st, R));
    return tints.get(k);
  } };
  const portion = (ing) => made?.portions?.[ing] ?? 1;
  const group = new THREE.Group(); group.name = `dish:${dish}`;
  const food = [];
  let vessel = null, drink = null, drinkMesh = null;
  const on = (obj, x = 0, y = 0, z = 0, ry = 0) => { obj.position.set(x, y, z); obj.rotation.y += ry; group.add(obj); return obj; };
  const plateTop = (kind = "plate") => { vessel = makeVessel(THREE, kind); group.add(vessel); return VESSELS[kind].top; };
  const serve = (kind) => { const s = makeServer(THREE, kind); group.add(s); return s.userData.top; };
  const b = rec.build;
  switch (F.form) {
    case "drink": {
      vessel = makeVessel(THREE, F.server); group.add(vessel);
      const spec = VESSELS[F.server], d = F.drink;
      const look = { coffee: ["coffee_body", "coffee", 0.82, 0.004], latte: ["milk_body", "latte", 0.85, 0.006], tea: ["tea", null, 0.8, 0], iced_tea: ["iced_tea", null, 0.8, 0], beer: ["beer", "beer_foam", 0.92, 0.016],
        wine: ["wine", null, 0.36, 0], cola: ["cola", null, 0.78, 0], water: ["water", null, 0.8, 0], orange_juice: ["orange_juice", null, 0.82, 0], milkshake: ["shake_choc", null, 0.8, 0], smoothie: ["smoothie", null, 0.8, 0], cocktail: ["cocktail", null, 0.75, 0] }[d] || ["water", null, 0.8, 0];
      drink = createDrink(spec.inner, { fill: look[2], foam_m: look[3] || (look[1] ? 0.004 : 0) });
      const layers = [{ material: L.m(look[0]) }]; if (look[1]) layers.push({ material: L.m(look[1]), foam: true });
      drinkMesh = createDrinkMesh(THREE, spec.inner, layers);
      drinkMesh.update(drink);
      vessel.add(drinkMesh.group);
      if (spec.lid) drinkMesh.group.visible = false;
      // Ice, a straw, a garnish.
      if (["iced_tea", "cola", "water"].includes(d)) {
        const ice = new THREE.Group(); const q = rng(sd);
        for (let i = 0; i < 5; i += 1) { const c = new THREE.Mesh(lumpy(new THREE.BoxGeometry(0.022, 0.022, 0.022, 2, 2, 2), 0.0015, 90, i, 1), L.m("ice")); c.position.set((q() - 0.5) * 0.03, drink.level() - 0.008 - i * 0.012, (q() - 0.5) * 0.03); c.rotation.set(q() * 3, q() * 3, q() * 3); ice.add(c); }
        vessel.add(ice); vessel.userData.ice = ice;
      }
      if (F.tool === "straw") { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, spec.rim + 0.06, 10, 1, true), L.m(d === "cola" ? "straw" : "straw_red")); s.position.set(0.012, (spec.rim + 0.06) / 2 + 0.01, -0.006); s.rotation.z = -0.18; vessel.add(s); vessel.userData.straw = s; }
      if (d === "milkshake" || d === "smoothie") { const w = blob(THREE, L, d === "milkshake" ? "whipped" : "berry", d === "milkshake" ? 0.03 : 0.008, d === "milkshake" ? 0.025 : 0.008, d === "milkshake" ? 0.03 : 0.008, sd, 0.3, 14); w.position.y = spec.rim + 0.008; vessel.add(w); if (d === "milkshake") { const c = blob(THREE, L, "cherry", 0.008, 0.008, 0.008, sd, 0.05); c.position.y = spec.rim + 0.034; vessel.add(c); } vessel.userData.topping = w; }
      if (d === "iced_tea" || d === "water") { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.004, 18), [L.m("lemon_peel"), L.m("lemon"), L.m("lemon")]); w.position.set(0, spec.rim - 0.005, 0.03); w.rotation.x = Math.PI / 2.3; vessel.add(w); }
      if (d === "cocktail") { const t = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 16, Math.PI * 1.4), L.m("lemon_peel")); t.position.set(0, spec.rim + 0.002, 0.045); t.rotation.x = 1.2; vessel.add(t); }
      food.push({ kind: "drink", drink, mesh: drinkMesh, vessel, frame: () => vessel, left: () => drink.left(), done: () => drink.v < drink.cap * 0.02 });
      break;
    }
    case "scoops": {
      vessel = makeVessel(THREE, "bowl"); group.add(vessel);
      const list = [], flavours = ["ice_cream_van", "ice_cream_choc", "ice_cream_straw"];
      const n = Math.max(2, count(b, "ice_cream"));
      for (let i = 0; i < n; i += 1) { const s = blob(THREE, L, flavours[i % 3], 0.027, 0.024, 0.027, sd + i, 0.35, 16); s.position.set(Math.cos(i * 2.1) * 0.022, 0.045 + (i > 1 ? 0.02 : 0), Math.sin(i * 2.1) * 0.022); vessel.add(s); list.push(s); }
      if (has(b, "chocolate_syrup")) { const sy = blob(THREE, L, "choc_syrup", 0.03, 0.006, 0.03, sd, 0.5, 14); sy.position.y = 0.072; vessel.add(sy); list.push(sy); }
      if (has(b, "cream")) { const w = blob(THREE, L, "whipped", 0.02, 0.02, 0.02, sd, 0.35, 12); w.position.y = 0.085; vessel.add(w); list.push(w); }
      if (has(b, "berries")) for (let i = 0; i < 3; i += 1) { const e = blob(THREE, L, "berry", 0.008, 0.009, 0.008, sd + i, 0.1); e.position.set(Math.cos(i * 2) * 0.03, 0.07, Math.sin(i * 2) * 0.03); vessel.add(e); list.push(e); }
      // A spoonful at a time: each scoop eaten in a few.
      const spoonfuls = list.flatMap((m) => [m, m, m]);
      let k = 0;
      food.push({ kind: "spoonfuls", group: vessel, frame: () => vessel, left: () => 1 - k / spoonfuls.length, done: () => k >= spoonfuls.length,
        nextAt: () => { const m = spoonfuls[k]; return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : null; },
        take: () => {
          const m = spoonfuls[k]; k += 1;
          if (!m) return null;
          m.scale.multiplyScalar(0.72); if (spoonfuls.indexOf(m, k) < 0) m.visible = false;
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 6).scale(1, 0.6, 1.2), m.material); s.name = "spoonful";
          return s;
        } });
      break;
    }
    case "burger": {
      const top = F.server === "plate" ? plateTop() : 0;
      if (F.server !== "plate") { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26, 4, 4).rotateX(-Math.PI / 2), L.m("wrap_paper")); w.position.y = 0.001; group.add(w); }
      const bg = burger(THREE, L, sd, made ? b : null); on(bg.group, F.side ? -0.035 : 0, top, 0.01); food.push(bg);
      if (F.side && has(b, "potato")) { const fr = fries(THREE, L, Math.round(34 * Math.min(2, portion("potato"))), (r) => [0.06 + (r() - 0.5) * 0.06, top + 0.005 + r() * 0.02, (r() - 0.5) * 0.09, r() * 6.28, (r() - 0.5) * 0.3], sd); group.add(fr); const ks = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.006, 16), L.m("sauce_red")); ks.position.set(-0.03, top + 0.002, -0.08); group.add(ks); food.push(friesEaten(THREE, L, fr, 12)); }
      break;
    }
    case "sandwich": {
      const top = plateTop();
      const a = sandwichHalf(THREE, L, 1, sd, made ? b : null), c = sandwichHalf(THREE, L, -1, sd + 1, made ? b : null);
      on(a.group, 0.012, top, -0.01); on(c.group, -0.028, top, 0.022, 0.5); food.push(a, c);
      break;
    }
    case "pizza_slice": { const top = plateTop(); const s = pizzaSlice(THREE, L, sd); on(s.group, 0, top, 0); food.push(s); break; }
    case "pizza": {
      const top = serve("pizza_board");
      for (let i = 0; i < 8; i += 1) {
        const s = pizzaSlice(THREE, L, sd + i, 0.15, Math.PI / 4 - 0.01, made ? b : null);
        const holder = new THREE.Group(); holder.add(s.group); s.group.position.set(0, 0, -0.075); holder.rotation.y = i * Math.PI / 4; holder.position.y = top; group.add(holder);
        // (Eaten slice by slice: each is turned to its eater as it is picked up.)
        food.push({ ...s, holder });
      }
      break;
    }
    case "banh_mi": { const top = plateTop(); const s = banhMi(THREE, L, sd); on(s.group, 0, top + s.group.position.y, 0); food.push(s); break; }
    case "burrito": case "pita_wrap": {
      const s = burrito(THREE, L, sd, F.form === "burrito" ? "burrito" : "pita"); on(s.group, 0, s.group.position.y, 0); food.push(s);
      break;
    }
    case "quesadilla": {
      const top = plateTop();
      for (let i = 0; i < 4; i += 1) {
        const w = biteable(THREE, L, { half: 0.11, name: "quesadilla", front: [0, -1], layers: [
          { inside: (x, z) => { const d = Math.hypot(x, z + 0.05), a = Math.atan2(x, z + 0.05); return d <= 0.1 && Math.abs(a) <= Math.PI / 4 - 0.02; }, y0: 0, depth: 0.003, bevel: 0.0008, materials: ["tortilla", "tortilla"] },
          { inside: (x, z) => { const d = Math.hypot(x, z + 0.05), a = Math.atan2(x, z + 0.05); return d <= 0.096 && Math.abs(a) <= Math.PI / 4 - 0.04; }, y0: 0.003, depth: 0.007, bevel: 0.002, materials: ["cheese", "chicken_bits"] },
          { inside: (x, z) => { const d = Math.hypot(x, z + 0.05), a = Math.atan2(x, z + 0.05); return d <= 0.1 && Math.abs(a) <= Math.PI / 4 - 0.02; }, y0: 0.01, depth: 0.003, bevel: 0.0008, materials: ["tortilla", "tortilla"] }] });
        const h = new THREE.Group(); h.add(w.group); w.group.rotation.y = Math.PI; w.group.position.z = -0.05; h.rotation.y = i * Math.PI / 2 + Math.PI / 4; h.position.y = top; group.add(h);
        food.push(w);
      }
      const sc = blob(THREE, L, "sour_cream", 0.02, 0.01, 0.02, sd, 0.3); sc.position.set(0, top + 0.006, 0); group.add(sc);
      break;
    }
    case "tacos": {
      const top = plateTop();
      const n = F.n || 3;
      for (let i = 0; i < n; i += 1) { const t = taco(THREE, L, sd + i, made ? b : null); on(t.group, (i - (n - 1) / 2) * 0.082, top, -0.01, 0); t.group.rotation.z = (i - (n - 1) / 2) * -0.05; food.push(t); }
      if (has(b, "lime")) { const lw = citrusWedge(THREE, L, "lime", 0.022); lw.position.set(0.1, top + 0.012, 0.075); group.add(lw); }
      break;
    }
    case "bagel": { const top = plateTop(); const a = bagelHalf(THREE, L, sd), c = bagelHalf(THREE, L, sd + 1); on(a.group, -0.05, top, 0); on(c.group, 0.05, top, 0); food.push(a, c); break; }
    case "croissant": { const top = plateTop("side_plate"); const c = croissant(THREE, L, sd); on(c.group, 0, top, 0.01); food.push(c); break; }
    case "donut": {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16).rotateX(-Math.PI / 2), L.m("wrap_paper")); w.position.y = 0.001; group.add(w);
      const d = donut(THREE, L, sd); on(d.group, 0, 0.002, 0); food.push(d);
      // Sprinkles in colours on the glaze.
      const cols = [0xe63946, 0xf1c40f, 0x2a9d8f, 0x5e60ce, 0xffffff], r = rng(sd), parts = [];
      for (let i = 0; i < 60; i += 1) { const a = r() * 6.28, dd = 0.019 + r() * 0.02, g = new THREE.CylinderGeometry(0.0012, 0.0012, 0.007, 5).toNonIndexed(); g.rotateZ(1.57); g.rotateY(r() * 6.28); g.translate(Math.cos(a) * dd, 0.0325, Math.sin(a) * dd); const c = new THREE.Color(cols[i % cols.length]); const col = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < col.length; k += 3) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; } g.setAttribute("color", new THREE.BufferAttribute(col, 3)); parts.push(g); }
      const sp = new THREE.Mesh(mergeSimple(THREE, parts), L.m("sprinkles"));
      const colAll = new Float32Array(sp.geometry.attributes.position.count * 3); let k = 0; for (const g of parts) { colAll.set(g.attributes.color.array, k); k += g.attributes.color.array.length; } sp.geometry.setAttribute("color", new THREE.BufferAttribute(colAll, 3));
      d.group.add(sp);
      break;
    }
    case "loaf": {
      const top = serve("bag");
      const loaf = blob(THREE, L, "crust", 0.1, 0.05, 0.06, sd, 0.08, 20); loaf.position.set(0, top - 0.02, 0); group.add(loaf);
      for (let i = 0; i < 4; i += 1) { const s = slab(THREE, L, { rx: 0.05, rz: 0.045, t: 0.012, seed: sd + i, top: "bread", cut: "bread", name: "bread", wobble: 0.05 }); on(s.group, 0.12, i * 0.013, -0.06 + i * 0.004, 0.1 * i); food.push(s); }
      break;
    }
    case "naan": {
      const top = serve("basket");
      for (let i = 0; i < 2; i += 1) { const n = biteable(THREE, L, { half: 0.12, name: "naan", layers: [{ inside: (x, z) => (x / 0.1) ** 2 + (z / 0.065) ** 2 <= 1 + 0.08 * Math.sin(Math.atan2(z, x) * 3 + i), y0: 0, depth: 0.008, bevel: 0.003, dome: (x, z) => 0.004 * (noise3(x * 40, 0, z * 40, sd + i) + 0.5), materials: ["naan", "naan"] }] }); on(n.group, 0, top + i * 0.01, (i - 0.5) * 0.03, i * 0.6); food.push(n); }
      break;
    }
    case "chips": {
      const top = serve("bag");
      const list = [];
      for (let i = 0; i < 12; i += 1) { const c = new THREE.Mesh(lumpy(new THREE.CircleGeometry(0.02, 12).rotateX(-Math.PI / 2), 0.003, 90, sd + i, 1), L.m("chips")); c.position.set((i % 3 - 1) * 0.025, top - 0.02 - Math.floor(i / 3) * 0.01, ((i * 7) % 3 - 1) * 0.015); c.rotation.set(i, i * 2, 0); group.add(c); list.push(c); }
      food.push(pieces(group, list, (a, c) => c.position.y - a.position.y));
      break;
    }
    case "dumplings": {
      const top = serve("steamer");
      const list = [];
      for (let i = 0; i < 6; i += 1) {
        const g = new THREE.SphereGeometry(0.022, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1.25, 0.9, 0.85);
        // Pleats along its seam on top.
        const P = g.attributes.position; for (let k = 0; k < P.count; k += 1) { const x = P.getX(k), y = P.getY(k), z = P.getZ(k); if (y > 0.012) P.setY(k, y + 0.003 * Math.abs(Math.sin(x * 400)) * (1 - Math.abs(z) / 0.02)); }
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, L.m("dumpling")); m.castShadow = true;
        const a = (i / 6) * 6.28; m.position.set(Math.cos(a) * 0.05, top, Math.sin(a) * 0.05); m.rotation.y = -a; group.add(m); list.push(m);
      }
      const soy = makeVessel(THREE, "saucer"); soy.scale.setScalar(0.6); soy.position.set(0.13, 0, 0.06); group.add(soy);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.002, 20), L.m("soy")); s.position.set(0.13, 0.006, 0.06); group.add(s);
      food.push(pieces(group, list));
      break;
    }
    case "sushi": {
      const top = serve("board");
      const list = [];
      // Nigiri: a pressed oblong of rice under a draped slice of fish.
      const fish = [has(b, "salmon") ? "salmon" : "tuna", has(b, "tuna") ? "tuna" : "salmon"];
      for (let i = 0; i < 4; i += 1) {
        const n = new THREE.Group();
        const rice = blob(THREE, L, "sushi_rice", 0.02, 0.011, 0.012, sd + i, 0.25, 14); rice.position.y = 0.01; n.add(rice);
        const f = new THREE.BoxGeometry(0.05, 0.006, 0.024, 8, 1, 2); const P = f.attributes.position; for (let k = 0; k < P.count; k += 1) { const x = P.getX(k); P.setY(k, P.getY(k) - (x / 0.025) ** 2 * 0.007); } f.computeVertexNormals();
        const fm = new THREE.Mesh(f, L.m(fish[i % 2])); fm.position.y = 0.022; n.add(fm);
        n.position.set(-0.11 + i * 0.045, top, -0.025); n.rotation.y = 0.1; group.add(n); list.push(n);
      }
      // Maki: six rounds of a roll, cut faces up.
      for (let i = 0; i < 6; i += 1) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.022, 20), [L.m("nori"), L.m("maki_cut"), L.m("maki_cut")]);
        m.position.set(-0.075 + i * 0.03, top + 0.011, 0.04); m.castShadow = true; group.add(m); list.push(m);
      }
      const w = blob(THREE, L, "wasabi", 0.01, 0.007, 0.009, sd, 0.3); w.position.set(0.12, top + 0.005, 0.035); group.add(w);
      const gi = scatter(THREE, L, "ginger_pickled", 5, (r) => [0.12 + (r() - 0.5) * 0.02, top + 0.003 + r() * 0.004, -0.02 + (r() - 0.5) * 0.02, r() * 6, 0.4], (r) => leafGeometry(THREE, 0.02, 0.025, r() * 100, 0.2), sd);
      group.add(gi);
      food.push(pieces(group, list));
      break;
    }
    case "noodle_soup": {
      vessel = makeVessel(THREE, "ramen_bowl"); group.add(vessel);
      const pho = has(b, "rice_noodles") || has(b, "beef_slices");
      const floating = [];
      const nest = noodleNest(THREE, L, pho ? "rice_noodles" : "noodles", 0.07, 0.018, 34, sd); nest.position.y = 0.052; floating.push(nest);
      if (has(b, "pork")) for (let i = 0; i < 2; i += 1) { const c = slice(THREE, L, "chashu", "pork", 0.032, 0.006, 22); c.position.set(-0.035 + i * 0.03, 0.074, -0.035); c.rotation.set(0.25, i, 0.15); floating.push(c); }
      if (has(b, "beef_slices")) for (let i = 0; i < 5; i += 1) { const s = new THREE.Mesh(leafGeometry(THREE, 0.04, 0.05, sd + i, 0.15), L.m("beef_raw")); s.position.set(Math.cos(i * 1.3) * 0.035, 0.072, Math.sin(i * 1.3) * 0.035); s.rotation.y = i; floating.push(s); }
      if (has(b, "egg")) for (const sgn of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1), L.m("egg_shell_white")); const face = new THREE.Mesh(new THREE.CircleGeometry(0.02, 18).rotateX(-Math.PI / 2), L.m("half_egg")); const h = new THREE.Group(); h.add(e, face); h.rotation.x = Math.PI + 0.6 * sgn; h.position.set(0.045 + sgn * 0.012, 0.075, 0.01); h.rotation.set(-Math.PI / 2 + 0.6, sgn * 0.4, 0); floating.push(h); }
      if (has(b, "nori")) { const n = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.08), L.m("nori")); n.position.set(0.02, 0.09, -0.07); n.rotation.set(-0.35, 0.2, 0); floating.push(n); }
      if (has(b, "scallion")) floating.push(scatter(THREE, L, "scallion", 30, (r) => { const a = r() * 6.28, d = Math.sqrt(r()) * 0.05; return [Math.cos(a) * d + 0.01, 0.076, Math.sin(a) * d + 0.03, 0, 1.57]; }, () => new THREE.TorusGeometry(0.0035, 0.0012, 4, 8), sd));
      if (has(b, "bean_sprouts")) floating.push(scatter(THREE, L, "sprouts", 20, (r) => [0.04 + (r() - 0.5) * 0.03, 0.075, -0.02 + (r() - 0.5) * 0.03, r() * 6, 1.2], () => new THREE.CylinderGeometry(0.0015, 0.0015, 0.03, 4), sd + 2));
      if (has(b, "basil")) for (let i = 0; i < 4; i += 1) { const l = new THREE.Mesh(leafGeometry(THREE, 0.02, 0.035, sd + i), L.m("herb")); l.position.set(-0.05 + i * 0.01, 0.077, 0.04); l.rotation.y = i; floating.push(l); }
      if (has(b, "lime")) { const w = citrusWedge(THREE, L, "lime", 0.022); w.position.set(0.11, 0.012, 0.08); group.add(w); }
      const broth = pool(THREE, L, vessel, pho ? "pho_broth" : "broth", { fill: 0.72, floating });
      // Noodles a forkful (chopsticks-full) at a time, then the toppings, and the broth by spoon.
      const nf = mound(THREE, L, nest, { forkful: () => noodleNest(THREE, L, pho ? "rice_noodles" : "noodles", 0.012, 0.03, 8, sd + 9, 0.0015) });
      food.push(nf, broth);
      break;
    }
    case "soup": {
      vessel = makeVessel(THREE, "bowl"); group.add(vessel);
      const floating = [];
      if (has(b, "carrot")) floating.push(sprinkle(THREE, L, "carrot", 10, 0.05, 0.052, 0.005, sd));
      if (has(b, "potato")) floating.push(scatter(THREE, L, "roast_potato", 8, (r) => { const a = r() * 6.28, d = Math.sqrt(r()) * 0.045; return [Math.cos(a) * d, 0.05, Math.sin(a) * d]; }, () => new THREE.BoxGeometry(0.01, 0.01, 0.01), sd + 1));
      if (has(b, "clams")) for (let i = 0; i < 4; i += 1) { const c = blob(THREE, L, "oyster", 0.008, 0.004, 0.007, sd + i, 0.3); c.position.set(Math.cos(i * 1.7) * 0.03, 0.054, Math.sin(i * 1.7) * 0.03); floating.push(c); }
      floating.push(sprinkle(THREE, L, "herb", 14, 0.045, 0.055, 0.0018, sd + 3));
      food.push(pool(THREE, L, vessel, F.creamy ? "chowder" : "soup", { fill: 0.78, floating }));
      break;
    }
    case "curry": {
      vessel = makeVessel(THREE, "bowl"); group.add(vessel);
      const green = has(b, "curry_paste");
      const floating = [scatter(THREE, L, "chicken_bits", 10, (r) => { const a = r() * 6.28, d = Math.sqrt(r()) * 0.045; return [Math.cos(a) * d, 0.05, Math.sin(a) * d]; }, (r) => lumpy(new THREE.BoxGeometry(0.016, 0.012, 0.014, 2, 2, 2), 0.002, 200, Math.floor(r() * 99), 1), sd)];
      if (has(b, "bell_pepper")) floating.push(scatter(THREE, L, "pepper_red", 6, (r) => [Math.cos(r() * 6.28) * 0.04, 0.054, Math.sin(r() * 6.28) * 0.04, r() * 6, 0.2], () => new THREE.BoxGeometry(0.02, 0.003, 0.006), sd + 1));
      if (has(b, "basil")) for (let i = 0; i < 3; i += 1) { const l = new THREE.Mesh(leafGeometry(THREE, 0.018, 0.03, sd + i), L.m("herb")); l.position.set(-0.01 + i * 0.012, 0.057, 0.01); l.rotation.y = i * 2; floating.push(l); }
      if (has(b, "cream")) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.002, 4, 24).rotateX(Math.PI / 2), L.m("sour_cream")); s.position.y = 0.056; floating.push(s); }
      food.push(pool(THREE, L, vessel, green ? "curry_green" : "curry_red", { fill: 0.72, floating }));
      if (has(b, "rice")) { const side = makeVessel(THREE, "bowl"); side.scale.setScalar(0.72); side.position.set(0.15, 0, 0.02); group.add(side); const rm = blob(THREE, L, "rice", 0.045, 0.03, 0.045, sd, 0.18, 18); rm.position.set(0.15, 0.032, 0.02); group.add(rm); food.unshift(mound(THREE, L, rm, { forkful: () => blob(THREE, L, "rice", 0.012, 0.006, 0.012, sd + 5, 0.2) })); }
      break;
    }
    case "rice_bowl": {
      vessel = makeVessel(THREE, "bowl"); group.add(vessel);
      const rm = blob(THREE, L, "rice", 0.068, 0.03, 0.068, sd, 0.12, 20); rm.position.y = 0.04; group.add(rm);
      // Bibimbap: its toppings laid round in sectors on the rice, an egg in the middle.
      const tops = [["beef_slice", has(b, "beef_slices")], ["spinach", has(b, "spinach")], ["carrot", has(b, "carrot")], ["sprouts", has(b, "bean_sprouts")]].filter((x) => x[1]);
      tops.forEach(([m], i) => { const a = (i / tops.length) * 6.28; group.add(scatter(THREE, L, m, 18, (r) => [Math.cos(a) * 0.035 + (r() - 0.5) * 0.02, 0.066 + r() * 0.004, Math.sin(a) * 0.035 + (r() - 0.5) * 0.02, r() * 6, 0.3], () => new THREE.BoxGeometry(0.018, 0.002, 0.004), sd + i)); });
      if (has(b, "egg")) { const e = sunnyEgg(THREE, L, sd); e.position.y = 0.067; group.add(e); }
      if (has(b, "gochujang")) { const g = blob(THREE, L, "gochujang", 0.01, 0.005, 0.01, sd, 0.3); g.position.set(0.012, 0.074, -0.012); group.add(g); }
      food.push(mound(THREE, L, rm, { forkful: () => blob(THREE, L, "rice", 0.012, 0.007, 0.012, sd + 5, 0.2) }));
      break;
    }
    case "risotto": {
      vessel = makeVessel(THREE, "bowl"); group.add(vessel);
      const rm = blob(THREE, L, "risotto", 0.068, 0.02, 0.068, sd, 0.1, 20); rm.position.y = 0.034; group.add(rm);
      if (has(b, "mushroom")) group.add(scatter(THREE, L, "mushroom", 10, (r) => [(r() - 0.5) * 0.08, 0.052, (r() - 0.5) * 0.08, r() * 6, 0.2], () => new THREE.CylinderGeometry(0.01, 0.006, 0.004, 8), sd));
      if (has(b, "parmesan")) group.add(sprinkle(THREE, L, "parmesan", 40, 0.05, 0.053, 0.0015, sd + 1));
      food.push(mound(THREE, L, rm, { forkful: () => blob(THREE, L, "risotto", 0.012, 0.006, 0.012, sd + 5, 0.2) }));
      break;
    }
    case "salad": {
      vessel = makeVessel(THREE, "bowl"); group.add(vessel);
      const leaves = new THREE.Group(); leaves.position.y = 0.03;
      const r = rng(sd);
      for (let i = 0; i < 18; i += 1) { const l = new THREE.Mesh(leafGeometry(THREE, 0.04 + r() * 0.02, 0.06 + r() * 0.03, sd + i, 0.5), L.m("lettuce")); l.position.set((r() - 0.5) * 0.08, r() * 0.03, (r() - 0.5) * 0.08); l.rotation.set((r() - 0.5) * 1.2, r() * 6, (r() - 0.5) * 1.2); leaves.add(l); }
      if (has(b, "tomato")) for (let i = 0; i < 5; i += 1) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), L.m("tomato_skin")); t.position.set((r() - 0.5) * 0.07, 0.03, (r() - 0.5) * 0.07); t.rotation.x = Math.PI; leaves.add(t); }
      if (has(b, "cucumber")) for (let i = 0; i < 6; i += 1) { const c = slice(THREE, L, "cucumber", "lime_peel", 0.014, 0.004, 14); c.position.set((r() - 0.5) * 0.07, 0.034, (r() - 0.5) * 0.07); c.rotation.set(r() * 0.6, 0, r() * 0.6); leaves.add(c); }
      if (has(b, "carrot")) leaves.add(scatter(THREE, L, "carrot", 30, (q) => [(q() - 0.5) * 0.07, 0.036, (q() - 0.5) * 0.07, q() * 6, 0.3], () => new THREE.BoxGeometry(0.0015, 0.0015, 0.025), sd));
      group.add(leaves);
      if (has(b, "lemon")) { const w = citrusWedge(THREE, L, "lemon", 0.022); w.position.set(0.05, 0.075, 0.03); group.add(w); }
      food.push(mound(THREE, L, leaves, { forkful: () => new THREE.Mesh(leafGeometry(THREE, 0.025, 0.035, sd + 99, 0.5), L.m("lettuce")) }));
      break;
    }
    case "fish_chips": {
      const top = serve("basket");
      const fish = slab(THREE, L, { rx: 0.085, rz: 0.032, t: 0.024, seed: sd, top: "batter", cut: "chicken_meat", name: "fish", wobble: 0.1 });
      on(fish.group, -0.02, top + 0.012, -0.025, 0.2);
      const fr = fries(THREE, L, 30, (r) => [0.04 + (r() - 0.5) * 0.08, top + 0.006 + r() * 0.02, 0.035 + (r() - 0.5) * 0.04, r() * 6.28, (r() - 0.5) * 0.3], sd);
      group.add(fr);
      const tt = makeVessel(THREE, "saucer"); tt.scale.setScalar(0.45); tt.position.set(0.08, top, -0.04); group.add(tt);
      const ts = blob(THREE, L, "sauce_white", 0.016, 0.008, 0.016, sd, 0.2); ts.position.set(0.08, top + 0.01, -0.04); group.add(ts);
      const lw = citrusWedge(THREE, L, "lemon", 0.024); lw.position.set(-0.08, top + 0.03, 0.03); group.add(lw);
      food.push(fish, friesEaten(THREE, L, fr, 10));
      break;
    }
    case "wings": {
      const top = serve("basket"), list = [];
      for (let i = 0; i < 8; i += 1) { const w = blob(THREE, L, "wing", 0.03, 0.014, 0.017, sd + i, 0.22, 14); w.position.set(((i % 4) - 1.5) * 0.04, top + 0.015 + Math.floor(i / 4) * 0.015, (Math.floor(i / 4) - 0.5) * 0.04); w.rotation.y = i * 0.8; group.add(w); list.push(w); }
      const cel = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 6).rotateZ(1.57), L.m("broccoli_stem")); cel.position.set(0, top + 0.01, 0.065); group.add(cel);
      food.push(pieces(group, list));
      break;
    }
    case "fries": {
      const top = serve("basket");
      const fr = fries(THREE, L, 48, (r) => [(r() - 0.5) * 0.12, top + 0.006 + r() * 0.03, (r() - 0.5) * 0.08, r() * 6.28, (r() - 0.5) * 0.3], sd);
      group.add(fr);
      const ks = makeVessel(THREE, "saucer"); ks.scale.setScalar(0.45); ks.position.set(0.12, 0, 0.05); group.add(ks);
      const k = blob(THREE, L, "sauce_red", 0.016, 0.006, 0.016, sd, 0.2); k.position.set(0.12, 0.01, 0.05); group.add(k);
      food.push(friesEaten(THREE, L, fr, 16));
      break;
    }
    case "oysters": {
      const top = plateTop();
      const ice = sprinkle(THREE, L, "ice", 90, 0.11, top, 0.008, sd); group.add(ice);
      const list = [];
      for (let i = 0; i < 6; i += 1) {
        const o = new THREE.Group();
        const shell = blob(THREE, L, "oyster_shell", 0.035, 0.01, 0.026, sd + i, 0.35, 14); const nacre = blob(THREE, L, "nacre", 0.03, 0.004, 0.022, sd + i, 0.1, 12); nacre.position.y = 0.008;
        const meat = blob(THREE, L, "oyster", 0.022, 0.005, 0.016, sd + i, 0.4, 12); meat.position.y = 0.012;
        o.add(shell, nacre, meat); const a = i / 6 * 6.28; o.position.set(Math.cos(a) * 0.075, top + 0.012, Math.sin(a) * 0.075); o.rotation.y = -a; group.add(o); list.push(o);
      }
      const lw = citrusWedge(THREE, L, "lemon", 0.026); lw.position.set(0, top + 0.02, 0); group.add(lw);
      food.push(pieces(group, list));
      break;
    }
    case "crab": {
      const top = plateTop();
      const shell = blob(THREE, L, "crab", 0.07, 0.03, 0.05, sd, 0.2, 20); shell.position.y = top + 0.03; group.add(shell);
      const legs = [];
      for (let i = 0; i < 8; i += 1) { const s = i < 4 ? -1 : 1, k = i % 4; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.09, 8).rotateZ(1.57), L.m("crab")); leg.position.set(s * 0.09, top + 0.012, -0.03 + k * 0.022); leg.rotation.y = s * (0.3 - k * 0.2); group.add(leg); legs.push(leg); }
      const butter = makeVessel(THREE, "saucer"); butter.scale.setScalar(0.45); butter.position.set(0.1, top, 0.09); group.add(butter);
      const bm = blob(THREE, L, "butter", 0.016, 0.006, 0.016, sd, 0.1); bm.position.set(0.1, top + 0.01, 0.09); group.add(bm);
      food.push(pieces(group, legs.concat([shell])));
      break;
    }
    case "pancakes": {
      const top = plateTop(), stack = [];
      for (let i = 0; i < 3; i += 1) { const p = slab(THREE, L, { rx: 0.065, rz: 0.065, t: 0.012, seed: sd + i, top: "pancake", cut: "sponge", name: "pancake", wobble: 0.04 }); on(p.group, 0, top + i * 0.0115, 0, i); stack.push(p); }
      const bt = new THREE.Mesh(roundedSlab(THREE, 0.024, 0.02, 0.008, 0.003), L.m("butter")); bt.position.set(0, top + 0.04, 0); group.add(bt);
      const sy = blob(THREE, L, "syrup", 0.05, 0.003, 0.05, sd, 0.5, 18); sy.position.set(0, top + 0.036, 0); group.add(sy);
      food.push(...stack.reverse());
      break;
    }
    case "cake": { const top = plateTop("side_plate"); const c = cakeSlice(THREE, L, sd); on(c.group, 0, top, 0); food.push(c); break; }
    case "pasta": {
      const top = plateTop();
      const nest = noodleNest(THREE, L, "pasta", 0.06, 0.03, 40, sd, 0.0019); nest.position.y = top + 0.002; group.add(nest);
      const sauce = blob(THREE, L, has(b, "tomato_sauce") ? "sauce_red" : "cream", 0.04, 0.012, 0.04, sd, 0.4, 18); sauce.position.y = top + 0.03; group.add(sauce);
      if (has(b, "parmesan")) group.add(sprinkle(THREE, L, "parmesan", 50, 0.035, top + 0.04, 0.0016, sd));
      if (has(b, "basil")) { const l = new THREE.Mesh(leafGeometry(THREE, 0.022, 0.038, sd), L.m("herb")); l.position.set(0.01, top + 0.045, 0); group.add(l); }
      const m = mound(THREE, L, nest, { forkful: () => noodleNest(THREE, L, "pasta", 0.01, 0.02, 8, sd + 9, 0.0019) });
      const sm = mound(THREE, L, sauce, { forkful: () => blob(THREE, L, "sauce_red", 0.008, 0.004, 0.008, sd, 0.3) });
      food.push({ ...m, take: (s) => { sm.take(s); return m.take(s); } });
      break;
    }
    case "stir_fried_noodles": case "fried_rice": {
      const top = plateTop();
      const rice = F.form === "fried_rice";
      const base = rice ? blob(THREE, L, "fried_rice", 0.085, 0.03, 0.075, sd, 0.2, 22) : noodleNest(THREE, L, has(b, "rice_noodles") ? "rice_noodles" : "noodles", 0.08, 0.035, 50, sd, 0.0022);
      base.position.y = top + (rice ? 0.012 : 0.002); group.add(base);
      const bits = [];
      if (has(b, "shrimp")) for (let i = 0; i < 5; i += 1) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.005, 8, 12, Math.PI * 1.3), L.m("shrimp")); s.position.set(Math.cos(i * 1.3) * 0.045, top + 0.035, Math.sin(i * 1.3) * 0.04); s.rotation.set(1.57, 0, i); group.add(s); bits.push(s); }
      if (has(b, "chicken")) group.add(scatter(THREE, L, "chicken_bits", 12, (r) => [(r() - 0.5) * 0.1, top + 0.03 + r() * 0.01, (r() - 0.5) * 0.08], (r) => lumpy(new THREE.BoxGeometry(0.014, 0.01, 0.012, 2, 2, 2), 0.0015, 200, Math.floor(r() * 99), 1), sd));
      if (has(b, "peanuts")) group.add(sprinkle(THREE, L, "peanut", 20, 0.05, top + 0.038, 0.003, sd + 1));
      if (has(b, "peas")) group.add(sprinkle(THREE, L, "pea", 25, 0.06, top + 0.03, 0.0035, sd + 2));
      if (has(b, "carrot")) group.add(scatter(THREE, L, "carrot", 20, (r) => [(r() - 0.5) * 0.1, top + 0.03, (r() - 0.5) * 0.08], () => new THREE.BoxGeometry(0.005, 0.005, 0.005), sd + 3));
      if (has(b, "scallion")) group.add(scatter(THREE, L, "scallion", 20, (r) => [(r() - 0.5) * 0.08, top + 0.04, (r() - 0.5) * 0.07, 0, 1.57], () => new THREE.TorusGeometry(0.003, 0.001, 4, 8), sd + 4));
      if (has(b, "chili")) group.add(scatter(THREE, L, "chili", 8, (r) => [(r() - 0.5) * 0.08, top + 0.038, (r() - 0.5) * 0.07, r() * 6, 1.4], () => new THREE.CylinderGeometry(0.003, 0.002, 0.02, 6), sd + 5));
      if (has(b, "bean_sprouts")) group.add(scatter(THREE, L, "sprouts", 18, (r) => [0.05 + (r() - 0.5) * 0.03, top + 0.035, 0.03 + (r() - 0.5) * 0.03, r() * 6, 1.3], () => new THREE.CylinderGeometry(0.0015, 0.0015, 0.03, 4), sd + 6));
      if (has(b, "egg") && !rice) group.add(scatter(THREE, L, "yolk", 8, (r) => [(r() - 0.5) * 0.08, top + 0.034, (r() - 0.5) * 0.07], (r) => lumpy(new THREE.BoxGeometry(0.012, 0.004, 0.01), 0.001, 200, Math.floor(r() * 9), 1), sd + 7));
      if (has(b, "lime")) { const w = citrusWedge(THREE, L, "lime", 0.022); w.position.set(0.09, top + 0.015, 0.05); group.add(w); }
      if (bits.length) food.push(pieces(group, bits));
      food.push(mound(THREE, L, base, { forkful: () => (rice ? blob(THREE, L, "fried_rice", 0.012, 0.007, 0.012, sd + 5, 0.2) : noodleNest(THREE, L, "noodles", 0.01, 0.02, 8, sd + 9, 0.002)) }));
      break;
    }
    case "stir_fry": {
      const top = plateTop();
      if (has(b, "rice")) { const rm = blob(THREE, L, "rice", 0.05, 0.028, 0.045, sd, 0.15, 18); rm.position.set(-0.05, top + 0.02, -0.02); group.add(rm); food.push(mound(THREE, L, rm, { forkful: () => blob(THREE, L, "rice", 0.012, 0.007, 0.012, sd + 5, 0.2) })); }
      // The stir-fry: glossy sauce over chunks of the protein, the vegetables, nuts and chillies.
      const fry = new THREE.Group(); fry.position.set(0.045, top, 0.015);
      const sauce = blob(THREE, L, "sauce_brown", 0.06, 0.008, 0.055, sd, 0.4, 18); sauce.position.y = 0.006; fry.add(sauce);
      const prot = b.find((x) => ["chicken", "beef_slices", "pork", "shrimp", "tofu", "lamb"].includes(x.ing))?.ing;
      fry.add(scatter(THREE, L, prot === "tofu" ? "tofu" : prot === "shrimp" ? "shrimp" : "teriyaki_chicken", 16, (r) => [(r() - 0.5) * 0.09, 0.016 + r() * 0.012, (r() - 0.5) * 0.08], (r) => lumpy(new THREE.BoxGeometry(0.017, 0.013, 0.015, 2, 2, 2), 0.002, 180, Math.floor(r() * 99), 1), sd));
      if (has(b, "peanuts")) fry.add(sprinkle(THREE, L, "peanut", 24, 0.045, 0.024, 0.0045, sd + 1));
      if (has(b, "chili")) fry.add(scatter(THREE, L, "chili", 10, (r) => [(r() - 0.5) * 0.08, 0.026, (r() - 0.5) * 0.07, r() * 6, 1.4], () => new THREE.CylinderGeometry(0.004, 0.0025, 0.03, 6), sd + 2));
      if (has(b, "bell_pepper")) fry.add(scatter(THREE, L, "pepper_green", 10, (r) => [(r() - 0.5) * 0.08, 0.024, (r() - 0.5) * 0.07, r() * 6, 0.3], () => new THREE.BoxGeometry(0.016, 0.004, 0.014), sd + 3));
      if (has(b, "scallion")) fry.add(scatter(THREE, L, "scallion", 14, (r) => [(r() - 0.5) * 0.07, 0.03, (r() - 0.5) * 0.06, 0, 1.57], () => new THREE.TorusGeometry(0.003, 0.001, 4, 8), sd + 4));
      group.add(fry);
      food.push(mound(THREE, L, fry, { forkful: () => new THREE.Mesh(lumpy(new THREE.BoxGeometry(0.016, 0.012, 0.014, 2, 2, 2), 0.002, 180, 3, 1), L.m("teriyaki_chicken")) }));
      break;
    }
    case "korean_bbq": {
      const top = plateTop();
      const list = [];
      for (let i = 0; i < 8; i += 1) { const s = new THREE.Mesh(leafGeometry(THREE, 0.04, 0.06, sd + i, 0.15), L.m("beef_slice")); s.position.set(((i % 4) - 1.5) * 0.04, top + 0.004 + Math.floor(i / 4) * 0.006, (Math.floor(i / 4) - 0.5) * 0.05); s.rotation.y = i * 0.3; group.add(s); list.push(s); }
      for (let i = 0; i < 3; i += 1) { const l = new THREE.Mesh(leafGeometry(THREE, 0.07, 0.1, sd + 20 + i, 0.4), L.m("lettuce")); l.position.set(0.1, top + 0.005 + i * 0.004, -0.06 + i * 0.01); group.add(l); }
      const gj = makeVessel(THREE, "saucer"); gj.scale.setScalar(0.4); gj.position.set(-0.1, top, 0.08); group.add(gj);
      const gm = blob(THREE, L, "gochujang", 0.014, 0.006, 0.014, sd, 0.3); gm.position.set(-0.1, top + 0.01, 0.08); group.add(gm);
      food.push(pieces(group, list));
      if (has(b, "rice")) { const side = makeVessel(THREE, "bowl"); side.scale.setScalar(0.6); side.position.set(0.16, 0, 0.05); group.add(side); const rm = blob(THREE, L, "rice", 0.04, 0.025, 0.04, sd, 0.18, 16); rm.position.set(0.16, 0.03, 0.05); group.add(rm); food.push(mound(THREE, L, rm, { forkful: () => blob(THREE, L, "rice", 0.012, 0.007, 0.012, sd + 5, 0.2) })); }
      break;
    }
    default: {
      // A plate: the main (seared, roast, grilled) at the front, its sides behind it.
      const top = plateTop();
      const main = b.find((x) => ["steak", "chicken", "chicken_half", "pork", "lamb", "fish_fillet", "salmon", "beef_patty", "tofu", "beef_slices", "turkey", "ham"].includes(x.ing));
      let mainF = null;
      if (main?.ing === "chicken_half") {
        // A half roast chicken: the breast domed and glossy, the leg out to one side.
        mainF = slab(THREE, L, { rx: 0.07, rz: 0.05, t: 0.05, seed: sd, top: "chicken", cut: "chicken_meat", name: "chicken", wobble: 0.08 });
        const leg = blob(THREE, L, "chicken", 0.04, 0.025, 0.025, sd + 1, 0.15, 14); leg.position.set(0.06, 0.02, -0.03); leg.rotation.y = 0.6; mainF.group.add(leg);
      } else if (main) {
        const seared = main.p.includes("grill") || main.p.includes("fry") || main.p.includes("saute") || main.p.includes("bake");
        const kind = main.ing === "steak" || main.ing === "lamb" || main.ing === "beef_patty" ? ["seared", "cut_meat"] : main.ing === "fish_fillet" || main.ing === "salmon" ? [main.ing === "salmon" ? "salmon" : "batter", "chicken_meat"] : [main.p.includes("grill") && main.ing === "chicken" && has(b, "teriyaki_sauce") ? "teriyaki_chicken" : "chicken", "chicken_meat"];
        mainF = slab(THREE, L, { rx: main.ing === "steak" ? 0.075 : 0.065, rz: 0.048, t: main.ing === "steak" ? 0.028 : 0.022, seed: sd, top: seared ? kind[0] : "chicken_meat", cut: kind[1], name: main.ing });
      }
      if (mainF) on(mainF.group, -0.02, top, 0.03);
      const sides = [];
      if (has(b, "potato")) {
        const p = cooked(b, "potato");
        if (p.includes("fry")) { const fr = fries(THREE, L, 26, (r) => [0.06 + (r() - 0.5) * 0.06, top + 0.005 + r() * 0.02, -0.04 + (r() - 0.5) * 0.06, r() * 6.28, (r() - 0.5) * 0.3], sd); group.add(fr); sides.push(friesEaten(THREE, L, fr, 9)); }
        else { const list = [], bx = !mainF && has(b, "egg") ? 0.052 : 0.05, bz = !mainF && has(b, "egg") ? 0.072 : -0.05; for (let i = 0; i < Math.round(6 * Math.min(2, portion("potato"))); i += 1) { const w = blob(THREE, L, "roast_potato", 0.016, 0.013, 0.014, sd + i, 0.3, 10); w.position.set(bx + (i % 3) * 0.022, top + 0.012 + Math.floor(i / 6) * 0.012, bz + Math.floor(i / 3) % 2 * 0.022); group.add(w); list.push(w); } sides.push(pieces(group, list)); }
      }
      if (has(b, "broccoli")) {
        const list = [];
        for (let i = 0; i < 4; i += 1) { const fl = new THREE.Group(); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.025, 8), L.m("broccoli_stem")); st.position.y = 0.012; const head = blob(THREE, L, "broccoli", 0.017, 0.013, 0.017, sd + i, 0.35, 12); head.position.y = 0.028; fl.add(st, head); fl.position.set(-0.06 + i * 0.018, top, -0.06 + (i % 2) * 0.02); fl.rotation.z = 1.2; group.add(fl); list.push(fl); }
        sides.push(pieces(group, list));
      }
      if (has(b, "rice")) { const rm = blob(THREE, L, "rice", 0.045, 0.025, 0.04, sd, 0.18, 18); rm.position.set(0.05, top + 0.018, -0.045); group.add(rm); sides.push(mound(THREE, L, rm, { forkful: () => blob(THREE, L, "rice", 0.012, 0.007, 0.012, sd + 5, 0.2) })); }
      // With no main, the eggs are the plate's centre (a breakfast): to the front, side by side,
      // the toast behind them leaning on the rim and the bacon beside -- nothing under anything.
      const brk = !mainF && has(b, "egg");
      if (has(b, "egg")) { const list = [], spots = brk ? [[-0.048, 0.028], [0.028, 0.048], [-0.01, -0.01]] : [[0.04, -0.03], [-0.03, -0.03], [0.0, -0.07]]; for (let i = 0; i < Math.min(3, count(b, "egg")); i += 1) { const e = sunnyEgg(THREE, L, sd + i); e.position.set(spots[i][0], top, spots[i][1]); group.add(e); list.push(e); } sides.push(pieces(group, list)); }
      if (has(b, "bacon")) { const list = []; for (let i = 0; i < Math.min(4, count(b, "bacon")); i += 1) { const g = new THREE.PlaneGeometry(0.028, 0.1, 2, 12); g.rotateX(-Math.PI / 2); const P = g.attributes.position; for (let k = 0; k < P.count; k += 1) P.setY(k, Math.sin(P.getZ(k) * 90) * 0.004); g.computeVertexNormals(); const m = new THREE.Mesh(g, L.m("bacon")); m.position.set((brk ? 0.058 : 0.07) + i * (brk ? 0.026 : 0.032), top + 0.006, brk ? -0.045 + i * 0.008 : 0.02); m.rotation.y = brk ? 0.7 : 0; group.add(m); list.push(m); } sides.push(pieces(group, list)); }
      if (has(b, "bread")) {
        const t = slab(THREE, L, { rx: 0.048, rz: 0.05, t: 0.013, seed: sd + 3, top: "toast", cut: "bread", name: "toast", wobble: 0.04, loaf: true });
        if (brk) on(t.group, -0.045, top, -0.062, 0.55); else on(t.group, -0.06, top, -0.05, 0.4);
        sides.push(t);
      }
      if (has(b, "butter") && !has(b, "maple_syrup")) { const bt = new THREE.Mesh(roundedSlab(THREE, 0.02, 0.016, 0.007, 0.003), L.m("butter")); if (mainF) bt.position.set(-0.02, top + 0.034, 0.03); else if (has(b, "egg") && has(b, "bread")) { bt.position.set(-0.04, top + 0.02, -0.06); bt.rotation.y = 0.5; } else bt.position.set(-0.02, top + 0.006, 0.03); group.add(bt); }
      if (has(b, "teriyaki_sauce")) { const s = blob(THREE, L, "sauce_brown", 0.05, 0.003, 0.035, sd, 0.4, 16); s.position.set(-0.02, top + 0.024, 0.03); group.add(s); }
      if (has(b, "garlic")) group.add(sprinkle(THREE, L, "garlic", 10, 0.04, top + 0.03, 0.003, sd));
      if (has(b, "lemon")) { const w = citrusWedge(THREE, L, "lemon", 0.024); w.position.set(0.09, top + 0.015, 0.06); group.add(w); }
      if (mainF) food.push(mainF);
      food.push(...sides);
      break;
    }
  }
  // What does not belong, where the cook put it: on top of the food, as what it is (a dollop of a
  // sauce, chopped bits, leaves, a slab, a dusting) -- unless the dish's own drawing already drew it.
  const extras = [];
  if (made && F.form !== "drink") {
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
    group.updateMatrixWorld(true);
    const targets = []; group.traverse((o) => { if (o.isMesh && !(vessel && isWithin(o, vessel))) targets.push(o); });
    const topAt = (x, z) => { ray.set(new THREE.Vector3(x, 1, z), down); const h = ray.intersectObjects(targets, false)[0]; return h ? h.point.y : (vessel ? 0.02 : 0.01); };
    let k = 0;
    for (const ing of new Set(made.extra)) {
      if ((LOOK_OF[ing] || []).some((key) => used.has(key))) continue;
      const x = extraLook(R, ing), mk = `#${x.colour.toString(16).padStart(6, "0")}`, r0 = rng(sd + 31 * (k + 1));
      const cx = ((k % 3) - 1) * 0.028, cz = 0.012 - Math.floor(k / 3) * 0.028, y = topAt(cx, cz);
      let m;
      if (x.shape === "dollop") m = blob(THREE, L, mk, 0.016, 0.005, 0.013, sd + k, 0.45, 12);
      else if (x.shape === "bits") m = scatter(THREE, L, mk, 14, (r) => [(r() - 0.5) * 0.04, 0.002, (r() - 0.5) * 0.04], () => new THREE.BoxGeometry(0.006, 0.004, 0.006), sd + k);
      else if (x.shape === "leaves") m = scatter(THREE, L, mk, 6, (r) => [(r() - 0.5) * 0.035, 0.002, (r() - 0.5) * 0.035, r() * 6, 0.2], (r) => leafGeometry(THREE, 0.012, 0.02, r() * 100, 0.4), sd + k);
      else if (x.shape === "dust") m = scatter(THREE, L, mk, 40, (r) => [(r() - 0.5) * 0.05, 0.001, (r() - 0.5) * 0.05], () => new THREE.BoxGeometry(0.0016, 0.0008, 0.0016), sd + k);
      else if (x.shape === "slab") m = blob(THREE, L, mk, 0.024, 0.007, 0.018, sd + k, 0.2, 12);
      else m = blob(THREE, L, mk, 0.016, 0.011, 0.016, sd + k, 0.25, 10);
      m.position.set(cx, y + (x.shape === "dollop" || x.shape === "slab" ? 0.003 : 0.001), cz);
      m.rotation.y = r0() * 6.28;
      m.name = `extra:${ing}`;
      group.add(m); extras.push(ing);
      k += 1;
    }
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, food, form: F.form, tool: F.tool, drink, drinkMesh, vessel, plan: F, made, extras };
}
//: A fried egg, sunny side up: the white spread thin with a crisp lacy edge, the yolk domed.
//: Whether ``o`` is ``root`` or inside it.
function isWithin(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }
function sunnyEgg(THREE, L, seed) {
  const g = new THREE.Group();
  const white = new THREE.CircleGeometry(0.042, 28); white.rotateX(-Math.PI / 2);
  const P = white.attributes.position;
  for (let i = 0; i < P.count; i += 1) { const x = P.getX(i), z = P.getZ(i), a = Math.atan2(z, x), d = Math.hypot(x, z), w = 1 + 0.12 * noise3(Math.cos(a) * 3, Math.sin(a) * 3, 0, seed); P.setXYZ(i, x * w, 0.003 * (1 - d / 0.042), z * w); }
  white.computeVertexNormals();
  const W = new THREE.Mesh(white, L.m("egg_white"));
  const yolk = new THREE.Mesh(new THREE.SphereGeometry(0.014, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1), L.m("yolk")); yolk.position.set(0.006, 0.003, -0.004);
  g.add(W, yolk);
  return g;
}
//: Fries eaten a few at a time, by hand: each take lifts a couple out of the pile.
function friesEaten(THREE, L, mesh, takes) {
  let k = 0;
  const P = mesh.geometry.attributes.position, total = P.count, per = Math.ceil(total / takes);
  const orig = P.array.slice();
  return { group: mesh, frame: () => mesh.parent, kind: "pieces", left: () => 1 - k / takes, done: () => k >= takes,
    nextAt: () => ({ x: mesh.position.x, y: mesh.position.y + 0.02, z: mesh.position.z }),
    take() {
      // The last ``per`` vertices' worth of sticks folded away (a stick is 6 faces of 4: 24 or 36 verts).
      k += 1;
      const keep = Math.max(0, total - k * per);
      for (let i = 0; i < total; i += 1) { if (i >= keep) P.setXYZ(i, 0, -1, 0); else P.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]); }
      P.needsUpdate = true;
      const two = new THREE.Group();
      for (let j = 0; j < 2; j += 1) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.0085, 0.0085, 0.07), L.m("fries")); f.position.x = j * 0.01; f.rotation.y = j * 0.3; two.add(f); }
      return two;
    } };
}
