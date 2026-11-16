// What a thing is for: the verbs it has, and whether each can be done now (the object lab's plan,
// section 3: "only show sensible verbs for the current instance"). Pure (tests/city_uses.test.mjs);
// commerce.mjs carries them out.
//
// A verb's preconditions are checked against what the player has and where they are (``ctx``):
// a candle is lit with a lighter, a postcard posted with a stamp, a car part fitted to a car of
// yours within reach with the right tool, a meal cooked at home from what the recipe needs, a
// sealed order is not eaten without breaking its seal (and not opened at all by its courier).

//: The verbs of item ``sku`` (its record ``thing``, or null for a plain unit) for player ``p``,
//: each { verb, label, ok, why }. ``ctx``: { atHome, nearCar (an asset), nearNpc, hasPlaced (the
//: record is placed at home), tested, litterNear }.
export function verbsOf(R, sku, thing, p, ctx = {}) {
  const it = R.items[sku];
  if (!it) return [];
  const U = R.commerce.uses, out = [];
  const has = (id, n = 1) => (p.inventory?.[id] || 0) >= n;
  const add = (verb, label, ok = true, why = null) => out.push({ verb, label, ok: Boolean(ok), why: ok ? null : why });
  const sealed = thing?.box?.seal === "intact";
  const job = Boolean(thing?.job);
  // Eat, drink, put on: the world's own cmd_use.
  if (it.use && !it.service) add("consume", it.kind === "prepared_food" || it.use?.stamina ? "Eat or drink" : "Use", !sealed, "it is sealed: open it first");
  if (it.wear) add("wear", Object.values(p.worn || {}).includes(sku) ? "Take off" : "Wear");
  if (U.read[sku]) add("read", sku === "street_map" ? "Read the map" : "Read");
  if (U.place.comfort[sku] !== undefined) {
    if (thing?.at?.kind === "placed") add("unplace", "Take down");
    else add("place", "Put it up at home", ctx.atHome, "at home only: walk in at your home first");
  }
  if (U.gift.rapport[sku] !== undefined) add("gift", "Give it to someone", Boolean(ctx.nearNpc), "stand by someone to give it");
  const inst = U.install.vehicle[sku];
  if (inst) add("install", "Fit it to your car", Boolean(ctx.nearCar) && (!inst.tool || has(inst.tool)), !ctx.nearCar ? "stand by a car of yours" : `needs a ${R.items[inst.tool]?.name.toLowerCase() || inst.tool}`);
  if (isRepairTool(R, sku)) add("repair", "Mend what is broken here", Boolean(ctx.damagedNear), "nothing broken within reach");
  if (U.cook.recipes.some((rc) => rc.from[sku])) {
    const rc = U.cook.recipes.find((x) => x.from[sku] && Object.entries(x.from).every(([k, n]) => has(k, n)));
    add("cook", rc ? `Cook ${R.items[rc.makes]?.name.toLowerCase() || rc.makes}` : "Cook", ctx.atHome && rc, !ctx.atHome ? "cook at home" : `needs ${Object.keys(U.cook.recipes.find((x) => x.from[sku]).from).map((k) => R.items[k]?.name.toLowerCase() || k).join(" and ")}`);
  }
  if (U.groom.uses[sku]) add("groom", "Freshen up");
  const fill = U.fill.holds_l[sku];
  if (fill !== undefined) {
    if (thing?.fill?.l > 0) add("drink_fill", "Drink the water");
    else add("fill", "Fill with water", ctx.atHome || ctx.water, "at home, or a drinking fountain or a shop's tap");
  }
  const light = U.light.items[sku];
  if (light && !light.placed) {
    const on = Boolean(thing?.lit);
    add("light", on ? "Put it out" : "Light it", on || (!light.needs || has(light.needs)) && ((thing?.charge ?? 1) > 0), light.needs && !has(light.needs) ? `needs a ${R.items[light.needs].name.toLowerCase()}` : "flat: charge it or fit batteries");
  }
  const charger = U.charge.from[sku];
  if (charger) {
    const devices = Object.keys(U.charge.devices).filter((d) => has(d) && (!charger.only || charger.only.includes(d)));
    add("charge", "Charge a device with it", devices.length && (!charger.at || ctx.atHome), !devices.length ? "nothing of yours to charge with it" : "plug it in at home");
  }
  if (U.lock.items.includes(sku)) add("lock", "Lock your car or bike with it", Boolean(ctx.nearCar), "stand by a car or bike of yours");
  if (U.mail.items.includes(sku)) add("mail", "Post it", has(U.mail.needs), `needs a ${R.items[U.mail.needs].name.toLowerCase()}`);
  if (sku === U.clean.tool) add("clean", "Sweep up here", has(U.clean.bag) && ctx.litterNear, !has(U.clean.bag) ? "needs a trash bag to sweep into" : "nothing to sweep up here");
  if (U.disassemble.yields[sku]) add("disassemble", "Take it apart", U.disassemble.tools.some((t) => has(t)), "needs a tool: a hammer, screwdriver, crowbar, saw, wrench or drill");
  if (it.container) {
    const box = thing?.box;
    if (job) add("open", "Open it", false, "it is someone's order: hand it over sealed");
    else if (box?.seal === "intact") add("open", "Break the seal and open it");
    else {
      add("pack", "Put something in it");
      if (box?.contents?.length) add("unpack", "Take everything out");
      if (it.container.seals && box?.contents?.length) add("seal", "Seal it");
    }
  }
  if (it.device || U.inspect.testers[sku]) {
    const tester = U.inspect.testers[sku];
    add("test", "Test it", !tester || has(tester), `needs a ${R.items[tester]?.name.toLowerCase() || tester} to test`);
  }
  if (it.device && sku === "smartphone") add("phone", "Messages");
  add("inspect", "Look it over");
  return out;
}

//: Whether ``sku`` mends things (a tool of the repair lists).
export function isRepairTool(R, sku) {
  const T = R.commerce.uses.repair.tools;
  return Object.values(T).some((list) => list.includes(sku));
}

//: What mending a struck thing of material ``material`` needs from the inventory: a tool and a
//: material from the rules' lists (``default`` for the rest). Returns { tool, material } or the
//: first thing missing as { missing }.
export function repairKit(R, material, inventory, { high = false } = {}) {
  const U = R.commerce.uses.repair;
  const tools = U.tools[material] || U.tools.default, mats = U.materials[material] || U.materials.default;
  const tool = tools.find((t) => (inventory[t] || 0) > 0);
  if (!tool) return { missing: `a ${tools.map((t) => R.items[t]?.name.toLowerCase() || t).join(" or ")}` };
  const mat = mats.find((m) => (inventory[m] || 0) > 0);
  if (!mat) return { missing: mats.map((m) => R.items[m]?.name.toLowerCase() || m).join(" or ") };
  if (high && !((inventory[U.high_tool] || 0) > 0)) return { missing: `a ${R.items[U.high_tool]?.name.toLowerCase() || U.high_tool} to reach it` };
  return { tool, material: mat };
}

//: A home's comfort: the points of what is put up in it, and the rest it adds (a share, capped).
export function comfortOf(R, placedSkus) {
  const P = R.commerce.uses.place;
  // The same thing twice counts once: two lamps light a room no better than one.
  const points = [...new Set(placedSkus)].reduce((s, k) => s + (P.comfort[k] || 0), 0);
  return { points, rest_bonus: Math.min(P.max_bonus, points * P.rest_per_point) };
}

//: The recipe that ``sku`` (with what else is carried) makes, or null.
export function recipeFor(R, sku, inventory) {
  return R.commerce.uses.cook.recipes.find((x) => x.from[sku] && Object.entries(x.from).every(([k, n]) => (inventory[k] || 0) >= n)) || null;
}
