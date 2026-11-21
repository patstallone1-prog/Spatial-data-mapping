// What stands on a store's shelves and how: each shelf of a fitted room (grocery-room.mjs
// ``shelves``) gets the shop's own products for its section (aisles.mjs), faced the way a store
// faces them -- cans and small boxes stacked in columns, bottles and jars in a row, produce
// heaped in a bin -- at their catalogue size (objects.mjs itemScale), as many as fit. The pure
// part; the shop room (view.mjs) draws each product's placements as one instanced mesh.

import { bindingOf, itemScale, naturalLength } from "./objects.mjs";

//: An item's size on a shelf at its catalogue size, [across, up, deep] (m), from its model; null
//: when it has none.
export function itemSize(O, R, sku) {
  const b = bindingOf(O, sku);
  if (!b) return null;
  const k = itemScale(O, R, sku, b);
  if (b.recipe) { const L = naturalLength(O, b) * k; return [L, L * 0.55, L]; }
  return O.assets[b.asset].dims.map((v) => v * k);
}

//: Positions for item ``size`` on ``shelf`` displayed as ``display``, in the shelf's frame (x
//: along it from its centre, z from its front at -deep/2, y up from the shelf top): a facing of
//: columns across ``len``, rows behind the front one up to ``rows``, stacked where it is a stack
//: of small things. ``bin``: heaped, offset rows, a second layer on the first.
export function faceShelf(shelf, size, display = "row", { gap = 0.012, rows = 1, most = 40, from = -0.5, to = 0.5, seed = 1 } = {}) {
  const [w, h, d] = size, len = (to - from) * shelf.len, x0 = (from + 0.5) * shelf.len - shelf.len / 2;
  const out = [];
  if (!(w > 0 && h > 0 && d > 0)) return out;
  let n = seed >>> 0 || 1; const r = () => { n = (n * 1103515245 + 12345) >>> 0; return (n >>> 8) / 16777216; };
  if (display === "bin") {
    // Loose produce: rows across the bin, the next row tucked half a piece along, a lighter
    // second layer in the hollows; each piece a little turned.
    const step = Math.max(w, d) * 0.92, cols = Math.max(1, Math.floor(len / step)), deepRows = Math.max(1, Math.floor(shelf.deep / step));
    for (let j = 0; j < deepRows; j += 1) for (let layer = 0; layer < 2; layer += 1) for (let i = 0; i < cols - layer; i += 1) {
      if (layer && j >= deepRows - 1) continue;
      if (out.length >= most) return out;
      const x = x0 + step / 2 + (i + (j % 2) * 0.5 + layer * 0.5) * step, z = -shelf.deep / 2 + step / 2 + (j + layer * 0.5) * step;
      if (x + step / 2 > x0 + len + 0.01 || z + step / 2 > shelf.deep / 2 + 0.01) continue;
      out.push({ x: x + (r() - 0.5) * step * 0.12, y: layer * h * 0.7, z: z + (r() - 0.5) * step * 0.12, yaw: r() * Math.PI * 2 });
    }
    return out;
  }
  const cols = Math.floor((len + gap) / (w + gap));
  if (cols < 1) return out;
  const pitch = len / cols;
  // A stack: cans and short boxes, as high as the shelf's clear height lets (three at most).
  const layers = display === "stack" && h <= 0.16 ? Math.max(1, Math.min(3, Math.floor((shelf.h + 0.005) / h))) : 1;
  const depthRows = Math.max(1, Math.min(rows, Math.floor((shelf.deep + gap) / (d + gap))));
  for (let k = 0; k < depthRows; k += 1) for (let i = 0; i < cols; i += 1) for (let L = 0; L < layers; L += 1) {
    if (out.length >= most) return out;
    out.push({ x: x0 + (i + 0.5) * pitch, y: L * h, z: -shelf.deep / 2 + d / 2 + 0.01 + k * (d + gap), yaw: 0 });
  }
  return out;
}

//: Whether ``size`` stands on ``shelf`` (its height under the clear height, a little leeway).
export const fits = (shelf, size) => Boolean(size) && size[1] <= shelf.h + 0.03 && size[2] <= shelf.deep + 0.12;

//: The whole room's stock: for each product, its placements in the room frame {x, y, z, yaw}
//: (yaw the way it faces; the model's own front is +z). ``sections``: product ids by section;
//: ``sizeOf(id)`` and ``displayOf(id)`` as itemSize and aisles.mjs. ``cap``: the most placements
//: in the room (drawn at the models' lowest tier, ~220 triangles), ``per``: the most of one
//: product on one stretch.
export function stockShelves(plan, sections, sizeOf, displayOf, { cap = 7500, per = 160, seed = 7 } = {}) {
  const bySection = new Map();
  for (const sh of plan.shelves || []) (bySection.get(sh.section) || bySection.set(sh.section, []).get(sh.section)).push(sh);
  // Which product goes on which stretch of which shelf.
  const blocks = [];
  for (const [section, shelves] of bySection) {
    const ids = (sections[section] || []).filter((id) => sizeOf(id));
    if (!ids.length) continue;
    // Each shelf its share of the section's products: one each where there are more shelves
    // than products (round again), several side by side where there are fewer.
    const onShelf = shelves.map(() => []);
    if (ids.length >= shelves.length) ids.forEach((id, j) => onShelf[j % shelves.length].push(id));
    else shelves.forEach((_, i) => onShelf[i].push(ids[i % ids.length]));
    const done = new Set(), left = [];
    shelves.forEach((sh, i) => {
      const mine = onShelf[i].filter((id) => fits(sh, sizeOf(id)));
      left.push(...onShelf[i].filter((id) => !mine.includes(id)));
      mine.forEach((id, j) => { done.add(id); blocks.push({ id, sh, from: -0.5 + j / mine.length, to: -0.5 + (j + 1) / mine.length }); });
    });
    // Too tall for where they fell: the section's roomiest shelf, beside what is there.
    for (const id of new Set(left)) {
      if (done.has(id)) continue;
      const roomy = shelves.filter((sh) => fits(sh, sizeOf(id))).sort((a, b) => b.h - a.h)[0];
      if (roomy) { done.add(id); blocks.push({ id, sh: roomy, from: 0.25, to: 0.5 }); }
    }
  }
  // Every stretch faced in full; past the room's cap, each thinned evenly (a few gaps along
  // every shelf rather than bare shelves).
  const faced = blocks.map(({ id, sh, from, to }, k) => {
    const display = sh.display || displayOf(id) || "row";
    return { id, sh, spots: faceShelf(sh, sizeOf(id), display, { from, to, most: per, seed: seed + k, rows: display === "bin" ? 3 : 1 }) };
  });
  const want = faced.reduce((t, f) => t + f.spots.length, 0), keep = want > cap ? cap / want : 1;
  const placed = new Map();
  for (const { id, sh, spots } of faced) {
    if (!spots.length) continue;
    const n = Math.max(1, Math.floor(spots.length * keep)), pick = n >= spots.length ? spots : Array.from({ length: n }, (_, i) => spots[Math.floor((i + 0.5) * spots.length / n)]);
    const c = Math.cos(sh.yaw), s = Math.sin(sh.yaw), list = placed.get(id) || placed.set(id, []).get(id);
    for (const p of pick) list.push({ x: sh.x + p.x * c + p.z * s, y: sh.y + p.y, z: sh.z - p.x * s + p.z * c, yaw: sh.yaw + Math.PI + p.yaw });
  }
  return placed;
}

//: Product ids by section for a shop selling ``sells`` (rules item ids): each in its aisle's
//: section (aisles.mjs aisleOf) where the room has shelves for that section; the rest, and
//: sections the room has but nothing of its own for, share out what is left over.
export function sectionsFor(plan, sells, aisleOf, has = () => true) {
  const present = new Set((plan.shelves || []).map((s) => s.section)), out = {}, spare = [];
  for (const id of sells) {
    if (!has(id)) continue;
    const a = aisleOf[id];
    if (a && present.has(a)) (out[a] ||= []).push(id);
    else spare.push(id);
  }
  const empty = [...present].filter((sec) => !out[sec]?.length && !["produce", "frozen", "dairy", "meat_seafood", "drinks"].includes(sec));
  empty.forEach((sec, i) => { const share = spare.filter((_, j) => j % empty.length === i); if (share.length) out[sec] = share; });
  return out;
}
