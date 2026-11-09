// Where each of your things sits in the inventory window: the bar of eight along the bottom of the
// screen (1-8 choose; what is chosen is in your hand) and the grid of twenty-four above it, as in
// a block-building game. The world keeps how many of each thing you have (world.mjs inventory);
// this keeps only the order you put them in, on this device.

export const BAR = 8;
export const GRID = 24;
export const SLOTS = BAR + GRID;   // 0-7 the bar, 8-31 the grid

//: The slots for ``inventory`` ({item: count}), keeping where each thing was in ``slots``: what
//: is gone is taken out, and what is new goes in the first free place on the bar, then the grid.
//: Things the world has that will not fit (more kinds than slots) are left out of sight.
export function arrange(slots, inventory) {
  const have = new Set(Object.entries(inventory || {}).filter(([, n]) => n > 0).map(([id]) => id));
  const out = Array.from({ length: SLOTS }, (_, i) => {
    const id = slots?.[i];
    return id && have.has(id) ? id : null;
  });
  // The same thing twice (an old save): the first place keeps it.
  const seen = new Set();
  for (let i = 0; i < SLOTS; i += 1) {
    if (!out[i]) continue;
    if (seen.has(out[i])) out[i] = null; else seen.add(out[i]);
  }
  for (const id of have) {
    if (seen.has(id)) continue;
    const free = out.indexOf(null);
    if (free < 0) break;
    out[free] = id; seen.add(id);
  }
  return out;
}

//: Swap what is in slot ``a`` with what is in slot ``b``.
export function swap(slots, a, b) {
  const out = slots.slice();
  if (a < 0 || b < 0 || a >= SLOTS || b >= SLOTS) return out;
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

//: The bar slot ``item`` is on, or -1.
export const barSlotOf = (slots, item) => (item ? slots.slice(0, BAR).indexOf(item) : -1);
