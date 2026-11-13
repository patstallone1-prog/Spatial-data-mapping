// Where each of your things sits in the inventory window: the bar of eight along the bottom of the
// screen (1-8 choose; what is chosen is in your hand) and the grid of twenty-four above it, as in
// a block-building game: up to STACK of one thing to a slot. The world keeps how many of each
// thing you have (world.mjs inventory); this keeps only the order you put them in, on this device.

export const BAR = 8;
export const GRID = 24;
export const SLOTS = BAR + GRID;   // 0-7 the bar, 8-31 the grid

//: How many of one thing a slot holds: more of it takes another slot, as in a block-building game.
export const STACK = 4;
//: The slots ``n`` of a thing fill.
export const stacksOf = (n) => (n > 0 ? Math.ceil(n / STACK) : 0);
//: Slots all of ``inventory`` ({item: count}) takes.
export const slotsUsed = (inventory) => Object.values(inventory || {}).reduce((sum, n) => sum + stacksOf(n), 0);

//: The slots for ``inventory`` ({item: count}), keeping where each thing was in ``slots``: each
//: slot holds up to STACK of one thing, so a thing has as many slots as it has stacks. What is
//: gone is taken out (its last slots first), and a new stack goes in the first free place on the
//: bar, then the grid. Stacks that will not fit (more than SLOTS) are left out of sight.
export function arrange(slots, inventory) {
  const need = new Map(Object.entries(inventory || {}).filter(([, n]) => n > 0).map(([id, n]) => [id, stacksOf(n)]));
  const used = new Map();
  const out = Array.from({ length: SLOTS }, (_, i) => {
    const id = slots?.[i];
    if (!id || !need.has(id) || (used.get(id) || 0) >= need.get(id)) return null;
    used.set(id, (used.get(id) || 0) + 1);
    return id;
  });
  for (const [id, n] of need) {
    for (let k = used.get(id) || 0; k < n; k += 1) {
      const free = out.indexOf(null);
      if (free < 0) return out;
      out[free] = id;
    }
  }
  return out;
}

//: How many are in slot ``i``: its thing's stacks fill in slot order, STACK to each, the last
//: holding what is left over.
export function slotCount(slots, inventory, i) {
  const id = slots?.[i];
  if (!id) return 0;
  let before = 0;
  for (let k = 0; k < i; k += 1) if (slots[k] === id) before += 1;
  return Math.max(0, Math.min(STACK, (inventory?.[id] || 0) - before * STACK));
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
