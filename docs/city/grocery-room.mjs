// A grocery's floor as a supermarket lays one out, in the City's shop room (store-room.mjs calls
// planGrocery for a supermarket, grocery or greengrocer big enough to hold one). The program is
// Codex's retail engine's (src/smc/interiors/stores/engine.py, docs/28): checkouts and their queues
// across the front by the door, staffed lanes and a self-checkout bank in the chain's mix, produce
// first inside the door, cold cases in long banks against the walls (never a lone fridge in an
// aisle), gondolas in runs broken by a cross aisle, the stock room and its door at the back. Here
// it is fitted to the City's rectangular shop room and its aisles carry the catalogue's sections
// (aisles.mjs), each shelf a slot the shop's own products are faced on (shelf-stock.mjs).
//
// Frame: the City's shop frame -- x across (+ to the right seen from the street), z in from the
// front (the door at z 0, x = doorX). A fixture: { role, x, z, w, d } is its footprint (w across,
// d in), as every shop's; ``yaw`` turns its own frame (x along it, its front to -z) into the room,
// ``len`` x ``deep`` its size in that frame. Shelves: { section, x, z, y, yaw, len, deep, h } in
// the room frame, the shelf's centre, ``yaw`` the way its goods face, ``h`` the clear height.

//: A supermarket's kinds (OpenStreetMap shop tags); corner stores keep the small room.
export const SUPERMARKET_KINDS = new Set(["supermarket", "grocery", "greengrocer"]);
//: The share of checkouts that are self-service, by chain (Codex's CHAIN_PRIORS, engine.py), and
//: an independent's otherwise.
const SELF_SHARE = [[/safeway/i, 0.45], [/whole ?foods/i, 0.5], [/trader ?joe/i, 0], [/lucky|grocery outlet|foods ?co|smart ?(&|and) ?final|target|cvs|walgreens/i, 0.35]];
//: A chain's accent colour (Codex's CHAIN_PRIORS), an independent's otherwise.
const ACCENT = [[/safeway/i, "#ac3834"], [/whole ?foods/i, "#32664d"], [/trader ?joe/i, "#b44737"]];
export const groceryAccent = (name = "") => (ACCENT.find(([rx]) => rx.test(name)) || [null, "#52766b"])[1];
export const selfCheckoutShare = (name = "") => (SELF_SHARE.find(([rx]) => rx.test(name)) || [null, 0.25])[1];
//: The smallest room the supermarket program is fitted to (m): narrower or shallower, a grocery
//: keeps the small shop's room.
export const GROCERY_MIN = { width: 9, floor: 9 };
//: Sizes (m): wall cases' depth, a cart aisle (two carts pass: 1.6-1.8 in practice), a gondola's
//: depth (two 0.5 m faces and the spine), a checkout's length, the queue and cross aisle behind
//: the checkouts, the stock room's depth.
export const G = { wallD: 0.85, aisle: 1.7, gondolaD: 1.2, laneZ0: 1.25, laneLen: 2.6, queue: 1.9, stock: 2.4, door: 1.05, module: 2.4 };
//: Gondola sections in the order a shopper meets them from produce, and how much shelf each
//: wants (its share when the aisles are shared out).
export const GONDOLA_SECTIONS = [["bakery", 1], ["breakfast", 1.5], ["pantry", 2], ["spices", 0.8], ["condiments", 1], ["snacks", 1.5], ["alcohol", 1], ["household", 1.5], ["personal_care", 1.2], ["pharmacy", 0.8], ["pets", 0.7]];
//: Shelf heights on a gondola face (m, the shelf's top) and its full height.
const GONDOLA_LEVELS = [0.14, 0.5, 0.86, 1.22, 1.58], GONDOLA_H = 1.9;

//: What each section is called on its sign.
export const SECTION_NAMES = { produce: "Produce", bakery: "Bakery", dairy: "Dairy", meat_seafood: "Meat & Seafood", frozen: "Frozen", breakfast: "Breakfast", pantry: "Pantry", spices: "Spices", condiments: "Condiments", snacks: "Snacks", alcohol: "Beer & Wine", household: "Household", personal_care: "Personal Care", pharmacy: "Pharmacy", pets: "Pets", drinks: "Drinks", checkout: "Checkout" };

const turn = (yaw) => ({ c: Math.cos(yaw), s: Math.sin(yaw) });
//: A point in a fixture's own frame (x along, z its depth, front -z) into the room.
const toRoom = (f, lx, lz) => { const { c, s } = turn(f.yaw); return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c }; };

export function planGrocery({ width, depth, doorX = 0, name = "" }, kind = "supermarket") {
  const stock = depth >= 10 ? G.stock : 0, floorEnd = depth - stock;
  if (width < GROCERY_MIN.width || floorEnd < GROCERY_MIN.floor) return null;
  const half = width / 2, fixtures = [], shelves = [], signs = [];
  //: A fixture of ``len`` x ``deep`` (its own frame) at (x, z) turned ``yaw``: kept only inside
  //: the room and clear of every other.
  const put = (role, x, z, len, deep, yaw, extra = {}) => {
    const side = Math.abs(Math.sin(yaw)) > 0.5, w = side ? deep : len, d = side ? len : deep;
    if (x - w / 2 < -half + 0.01 || x + w / 2 > half - 0.01 || z - d / 2 < 0.05 || z + d / 2 > floorEnd + 0.01) return null;
    if (fixtures.some((f) => f.role !== "partition" && Math.abs(x - f.x) < (w + f.w) / 2 - 0.01 && Math.abs(z - f.z) < (d + f.d) / 2 - 0.01)) return null;
    const f = { role, x, z, w, d, yaw, len, deep, ...extra };
    fixtures.push(f);
    return f;
  };
  //: The shelves of fixture ``f`` at ``levels`` on its front face (and its back, ``both``), each
  //: ``deep`` m deep with ``h`` clear above it.
  const shelf = (f, section, levels, { deep = 0.45, h = 0.34, both = false, inset = 0.04, from = -0.5, to = 0.5, display } = {}) => {
    for (const face of both ? [-1, 1] : [-1]) for (const [i, y] of levels.entries()) {
      const lz = face * (f.deep / 2 - inset - deep / 2), lx = (from + to) / 2 * f.len, p = toRoom(f, lx, lz);
      shelves.push({ fixture: fixtures.indexOf(f), section, x: p.x, z: p.z, y, yaw: f.yaw + (face > 0 ? Math.PI : 0), len: (to - from) * f.len - 0.06, deep, h: i === levels.length - 1 ? Math.max(h, 0.42) : h, ...(display ? { display } : {}) });
    }
  };
  // The checkouts take the side with more room beside the door; produce the other.
  const c = doorX > 0.3 ? -1 : 1, s = -c;
  const zBand = G.laneZ0 + G.laneLen + G.queue, backZ = floorEnd - G.wallD / 2 - 0.02;
  // The stock room across the back, behind a partition with its door at one end (planStore's).
  let partDoor = null;
  if (stock) {
    partDoor = doorX > 0 ? -half + 1.4 : half - 1.4;
    fixtures.push({ role: "partition", x: 0, z: floorEnd, w: width, d: 0.12, door: partDoor });
    for (const side of [-1, 1]) fixtures.push({ role: "stock_shelf", x: side * (half - 0.3), z: floorEnd + stock / 2, w: 0.5, d: stock - 0.4, side, yaw: side * Math.PI / 2, len: stock - 0.4, deep: 0.5 });
  }
  // Cold banks along the produce side's wall: refrigerated produce by the door, then dairy.
  const wallX = (side) => side * (half - G.wallD / 2 - 0.02);
  const sideRun = (side, z0, z1, pick) => {
    for (let z = z0; z + 1.2 <= z1 + 1e-6;) {
      const len = Math.min(G.module, z1 - z), at = z + len / 2;
      const [role, section] = pick(at);
      const f = put(role, wallX(side), at, len - 0.04, G.wallD, side * Math.PI / 2, { wall: true, side, section });
      if (f) cold(f, section);
      z += len;
    }
  };
  // A case's shelves by kind: open multidecks five deep-ish shelves, glass-door cases six.
  const cold = (f, section) => {
    if (f.role === "produce_case") shelf(f, section, [0.45, 0.85, 1.2], { deep: 0.55, h: 0.3, display: "bin" });
    else if (f.role === "multideck") shelf(f, section, [0.36, 0.7, 1.02, 1.34, 1.64], { deep: 0.5, h: 0.28 });
    else shelf(f, section, [0.22, 0.58, 0.94, 1.3, 1.64], { deep: 0.55, h: 0.32, inset: 0.12, both: f.role === "freezer_island" });
  };
  const sideEnd = floorEnd - G.wallD - 0.05;
  sideRun(s, 0.6, sideEnd, (z) => (z < zBand ? ["produce_case", "produce"] : ["multideck", "dairy"]));
  // The back wall: meat and seafood in open cases, a gap where the stock room's door is.
  for (let x = -half + G.wallD + 0.07; x + 1.2 <= half - G.wallD - 0.07 + 1e-6;) {
    let len = Math.min(G.module, half - G.wallD - 0.07 - x);
    if (partDoor !== null && x < partDoor + 0.9 && x + len > partDoor - 0.9) {
      if (x < partDoor - 0.9 - 1.2) len = partDoor - 0.9 - x;
      else { x = partDoor + 0.9; continue; }
    }
    const f = put("multideck", x + len / 2, backZ, len - 0.04, G.wallD, Math.PI, { back: true, section: "meat_seafood" });
    if (f) cold(f, "meat_seafood");
    x += len;
  }
  // The checkout side's wall behind the checkouts: glass-door coolers (drinks), and the frozen
  // aisle -- an island of back-to-back freezers facing them, where the room is wide enough;
  // otherwise freezer doors on the wall.
  const island = width >= 15;
  sideRun(c, zBand, sideEnd, (z) => (island || z > (zBand + sideEnd) / 2 ? ["cooler_doors", "drinks"] : ["freezer_doors", "frozen"]));
  let innerC = c * (half - G.wallD);
  if (island) {
    const ix = c * (half - G.wallD - G.aisle - 0.75), z0 = zBand + 0.6, z1 = floorEnd - G.wallD - G.aisle;
    const runs = z1 - z0 > 9 ? [[z0, (z0 + z1) / 2 - 0.9], [(z0 + z1) / 2 + 0.9, z1]] : [[z0, z1]];
    for (const [a, b] of runs) for (let z = a; z + 1.2 <= b + 1e-6;) {
      const len = Math.min(G.module, b - z), f = put("freezer_island", ix, z + len / 2, len - 0.04, 1.5, c * Math.PI / 2, { island: true, section: "frozen" });
      if (f) cold(f, "frozen");
      z += len;
    }
    innerC = ix - c * 0.75;
  }
  // The checkouts across the front on the checkout side: the self-checkout bank nearest the
  // door, then staffed lanes out to the wall. Each lane: its walkway on the door side, the belt
  // counter, the cashier's pocket; the queue behind it (zBand).
  const share = selfCheckoutShare(name), span = Math.abs(c * (half - 0.15) - (doorX + c * G.door));
  let n = Math.max(1, Math.floor(span / 2.25)), k = share > 0 ? Math.max(n >= 3 ? 1 : 0, Math.round(n * share)) : 0, m = n - k;
  while (2.0 * k + 2.4 * m > span && (m > 1 || k > 0)) { if (k > 0 && (k >= m || m <= 1)) k -= 1; else m -= 1; }
  m = Math.max(m, span >= 2.4 ? 1 : 0);
  let e = doorX + c * G.door, lane = 0;
  for (let i = 0; i < k; i += 1) {
    const x = e + c * (1.2 + 0.4);
    for (const [j, z] of [G.laneZ0 + 0.45, G.laneZ0 + 1.75].entries()) put("self_checkout", x, z, 0.75, 0.8, c * Math.PI / 2, { section: "checkout", walk: -c, kiosk: i * 2 + j + 1 });
    e += c * 2.0;
  }
  if (k) put("sco_podium", e - c * 0.3, G.laneZ0 + 2.45, 0.45, 0.45, c * Math.PI / 2, {});
  for (let i = 0; i < m; i += 1) {
    const x = e + c * (1.15 + 0.625), f = put("checkout", x, G.laneZ0 + G.laneLen / 2, G.laneLen, 1.25, c * Math.PI / 2, { section: "checkout", walk: -c, lane: ++lane, side: c, pocket: 0.65 });
    // The impulse rack on the pocket's outer face, toward the next lane's queue.
    if (f) shelves.push(...[0.35, 0.7, 1.05].map((y) => { const p = toRoom(f, -G.laneLen / 2 + 0.55, f.deep / 2 - 0.12); return { fixture: fixtures.indexOf(f), section: "checkout", x: p.x, z: p.z, y, yaw: f.yaw + Math.PI, len: 0.9, deep: 0.2, h: 0.3, display: "counter" }; }));
    e += c * 2.4;
  }
  // Produce inside the door: angled display tables, both faces stocked, in the front band on
  // the produce side.
  const pa = doorX + s * (G.door + 0.05), pb = s * (half - G.wallD - 1.3);
  const room = Math.abs(pb - pa), tl = room >= 1.8 ? 1.8 : room >= 1.1 ? room : 0;
  if (tl) for (let z = 0.95; z + 1.0 <= zBand - 0.3; z += 2.3) for (let x = Math.min(pa, pb); x + tl <= Math.max(pa, pb) + 1e-6; x += tl + 1.3) {
    const f = put("produce_table", x + tl / 2, z + 0.5, tl, 1.0, 0, { island: true, section: "produce" });
    // Two tiers each face: the low one toward the aisle, the high one by the ridge.
    if (f) for (const face of [-1, 1]) for (const [y, lz, dp] of [[0.72, 0.3, 0.36], [0.94, 0.1, 0.24]]) {
      const p = toRoom(f, 0, face * lz);
      shelves.push({ fixture: fixtures.indexOf(f), section: "produce", x: p.x, z: p.z, y, yaw: face > 0 ? Math.PI : 0, len: f.len - 0.08, deep: dp, h: 0.22, display: "bin" });
    }
  }
  // Gondolas front to back between the cold walls, a cross aisle through long runs, the way in
  // from the door kept clear to the back; each face's sections from the catalogue's aisles.
  const lo = Math.min(s * (half - G.wallD) - s * G.aisle, innerC - c * G.aisle), hi = Math.max(s * (half - G.wallD) - s * G.aisle, innerC - c * G.aisle);
  const z0 = zBand, z1 = floorEnd - G.wallD - G.aisle;
  const runs = z1 - z0 > 9.5 ? [[z0, (z0 + z1) / 2 - 0.9], [(z0 + z1) / 2 + 0.9, z1]] : z1 - z0 >= 2.4 ? [[z0, z1]] : [];
  const pitch = G.gondolaD + G.aisle, cols = [];
  // Packed from each wall in toward the way in from the door, which takes what is over.
  const gap = G.gondolaD / 2 + G.door, left = [lo + G.gondolaD / 2, Math.min(hi - G.gondolaD / 2, doorX - gap)], right = [Math.max(lo + G.gondolaD / 2, doorX + gap), hi - G.gondolaD / 2];
  for (let x = left[0]; x <= left[1] + 1e-6; x += pitch) cols.push(x);
  for (let x = right[1]; x >= right[0] - 1e-6; x -= pitch) if (!cols.some((y) => Math.abs(y - x) < pitch - 1e-6)) cols.push(x);
  const gondolas = [];
  for (const x of cols) for (const [a, b] of runs) {
    const f = put("gondola", x, (a + b) / 2, b - a, G.gondolaD, Math.PI / 2, { island: true, grocery: true, levels: GONDOLA_LEVELS, h: GONDOLA_H });
    if (f) gondolas.push(f);
  }
  // The aisles: between the produce side's wall and the first gondola, between gondolas, and
  // between the last and the cold side. Each gondola face looks into one.
  const xs = [...new Set(gondolas.map((f) => f.x))].sort((a, b) => s > 0 ? b - a : a - b);
  const faces = [];   // [aisle index, gondola, face (-1 front, +1 back)]
  // (A gondola turned π/2 fronts -x: its front face looks to the lower x, its back to the higher.)
  xs.forEach((x, i) => {
    for (const f of gondolas.filter((g) => g.x === x)) {
      const towardS = s > 0 ? 1 : -1;   // the face looking to the produce side: +x is the back
      faces.push([i, f, towardS], [i + 1, f, -towardS]);
    }
  });
  const aisleCount = xs.length + 1, wanted = GONDOLA_SECTIONS.map(([k]) => k);
  // Sections shared out over the aisles in order, by their shelf wants.
  const totalWant = GONDOLA_SECTIONS.reduce((t, [, w]) => t + w, 0), byAisle = Array.from({ length: aisleCount }, () => []);
  let acc = 0;
  for (const [k0, w] of GONDOLA_SECTIONS) {
    const mid = (acc + w / 2) / totalWant;
    byAisle[Math.min(aisleCount - 1, Math.floor(mid * aisleCount))].push(k0);
    acc += w;
  }
  // An aisle with nothing of its own shares its neighbour's.
  for (let i = 0; i < aisleCount; i += 1) if (!byAisle[i].length) byAisle[i] = byAisle[i - 1]?.slice(-1) || byAisle[i + 1]?.slice(0, 1) || [wanted[0]];
  for (const [ai, f, face] of faces) {
    const secs = byAisle[ai];
    secs.forEach((section, j) => {
      const from = -0.5 + j / secs.length, to = -0.5 + (j + 1) / secs.length;
      for (const [li, y] of GONDOLA_LEVELS.entries()) {
        // In the gondola's frame its +x runs along it, from the back of the room to the front.
        const lz = face * (G.gondolaD / 2 - 0.04 - 0.25), p = toRoom(f, (from + to) / 2 * f.len, lz);
        shelves.push({ fixture: fixtures.indexOf(f), section, x: p.x, z: p.z, y, yaw: f.yaw + (face > 0 ? Math.PI : 0), len: (to - from) * f.len - 0.06, deep: 0.5, h: li === GONDOLA_LEVELS.length - 1 ? 0.42 : 0.32 });
      }
    });
  }
  // A hanging sign over each aisle with gondolas: its number and what is in it.
  const edges = [s * (half - G.wallD), ...xs, innerC];
  for (let i = 0; i < aisleCount; i += 1) {
    if (!gondolas.length) break;
    const x = (edges[i] + edges[i + 1]) / 2;
    for (const [a, b] of runs) signs.push({ x, z: (a + b) / 2, y: 2.55, yaw: 0, number: i + 1, sections: byAisle[i] });
  }
  // Departments over the walls: produce, dairy, meat & seafood, frozen, drinks.
  for (const [section, f] of [["produce", fixtures.find((x) => x.section === "produce")], ["dairy", fixtures.find((x) => x.section === "dairy")], ["meat_seafood", fixtures.find((x) => x.section === "meat_seafood")], ["frozen", fixtures.find((x) => x.section === "frozen")], ["drinks", fixtures.find((x) => x.section === "drinks")]]) {
    // Over a wall's cases facing into the room; over an island facing the door.
    if (f) signs.push(f.island ? { x: f.x, z: f.z, y: 2.6, yaw: 0, sections: [section] } : { x: f.x - Math.sin(f.yaw) * 0.6, z: f.z - Math.cos(f.yaw) * 0.6, y: 2.6, yaw: f.yaw, sections: [section], wall: true });
  }
  return { kind, program: "supermarket", grocery: true, accent: groceryAccent(name), fixtures, shelves, signs, width, depth, doorX, floorEnd, rearShelves: false, lanes: lane, selfCheckouts: k * 2, checkoutSide: c, produceSide: s };
}

//: Whether a lane's cashier pocket is at (x, z): staff stand there, shoppers do not.
export function inPocket(f, x, z) {
  if (f.role !== "checkout") return false;
  const px = f.x + f.side * (f.w / 2 - f.pocket / 2);
  return Math.abs(x - px) < f.pocket / 2 && Math.abs(z - f.z) < f.d / 2;
}
//: Where a lane's cashier stands and where the shopper stands to pay (room frame): at the
//: register, toward the lane's front end.
export function lanePoints(f) {
  const z = f.z - 0.34 * f.len;
  return { cashier: { x: f.x + f.side * (f.w / 2 - f.pocket / 2), z }, shopper: { x: f.x - f.side * (f.w / 2 + 0.45), z } };
}

//: Draw a grocery fixture with ``box``/``can``/``ball`` (store-room.mjs's batched primitives, in
//: the fixture's own frame: x along, its front to -z). Returns false for a role it does not know.
export function drawGrocery(f, { box, can, ball }, { tint = 0xcfc6b8, r = Math.random } = {}) {
  const along = f.len, deep = f.deep;
  const steel = 0xc3c9cc, dark = 0x2a2d30, white = 0xf1f1ee, glass = { transparent: true, opacity: 0.22 }, belt = 0x1f2224, wood = 0x9a7350;
  const lit = 0xf7fbff, accent = tint;
  switch (f.role) {
    case "gondola": {
      // The spine and base, end panels, shelves on both faces, a price-ticket rail on each.
      box(0, f.h / 2, 0, along, f.h, 0.06, 0xdedbd2); box(0, 0.06, 0, along, 0.12, deep, 0x8c9296);
      for (const sx of [-1, 1]) box(sx * (along / 2 - 0.015), f.h / 2, 0, 0.03, f.h, deep, 0xd4d0c6);
      for (const face of [-1, 1]) for (const y of f.levels) {
        box(0, y - 0.015, face * deep / 4, along - 0.04, 0.03, deep / 2 - 0.04, 0xe9e7e1);
        box(0, y - 0.035, face * (deep / 2 - 0.02), along - 0.04, 0.04, 0.012, 0xf5f3ea);
      }
      box(0, f.h + 0.04, 0, along, 0.08, 0.1, accent);
      return true;
    }
    case "multideck": case "produce_case": {
      // An open case: an insulated back and sides, shelves stepping out, the air-curtain grille
      // at the foot, the canopy's light along the top, a mirror in a produce case.
      const h = f.role === "produce_case" ? 1.9 : 2.05;
      box(0, h / 2, deep / 2 - 0.05, along, h, 0.1, white); box(0, 0.2, -deep / 2 + 0.25, along, 0.4, 0.5, f.role === "produce_case" ? 0x2f3a33 : 0xe6e6e2);
      for (const sx of [-1, 1]) box(sx * along / 2, h / 2, 0, 0.04, h, deep, white);
      box(0, h - 0.06, -deep / 2 + 0.2, along, 0.12, 0.4, white); box(0, h - 0.14, -deep / 2 + 0.05, along - 0.1, 0.03, 0.06, lit);
      box(0, 0.42, -deep / 2 + 0.02, along, 0.04, 0.04, steel);
      if (f.role === "produce_case") box(0, h - 0.45, deep / 2 - 0.11, along - 0.1, 0.5, 0.02, 0xb9c7cc);
      return true;
    }
    case "cooler_doors": case "freezer_doors": case "freezer_island": {
      // Reach-in glass doors on a frame: mullions, handles, the lit header, the toe kick.
      const h = 2.05, faces = f.role === "freezer_island" ? [-1, 1] : [-1];
      box(0, h / 2, f.role === "freezer_island" ? 0 : deep / 2 - 0.05, along, h, f.role === "freezer_island" ? 0.08 : 0.1, 0xe2e4e6);
      for (const sx of [-1, 1]) box(sx * along / 2, h / 2, 0, 0.05, h, deep, 0xe8eaeb);
      box(0, 0.06, 0, along, 0.12, deep, dark);
      for (const face of faces) {
        box(0, h - 0.08, face * (deep / 2 - 0.03), along, 0.16, 0.06, accent);
        const doors = Math.max(1, Math.round(along / 0.76));
        for (let i = 0; i < doors; i += 1) {
          const x = -along / 2 + (i + 0.5) * along / doors;
          box(x, 1.05, face * (deep / 2 - 0.02), along / doors - 0.03, 1.8, 0.015, f.role === "cooler_doors" ? 0xcfe6ee : 0xd6eef5, glass);
          box(x - along / doors / 2 + 0.01, 1.05, face * (deep / 2 - 0.02), 0.03, 1.82, 0.035, 0x3b4146);
          box(x + along / doors * 0.36, 1.08, face * (deep / 2 + 0.01), 0.025, 0.7, 0.03, steel);
          box(x, 1.98, face * (deep / 2 - 0.08), along / doors - 0.08, 0.025, 0.04, lit);
        }
      }
      return true;
    }
    case "produce_table": {
      // A farm-stand display: a dark crate base, both faces stepping down to the aisle in two
      // tiers of shallow bins (their goods heaped on them as shelves), a price-card rail on
      // each tier's lip, the mist bar along the ridge.
      box(0, 0.3, 0, along, 0.6, deep * 0.86, 0x4a3524);
      for (const face of [-1, 1]) {
        box(0, 0.66, face * deep * 0.3, along, 0.12, deep * 0.38, 0x5a4029);
        box(0, 0.89, face * deep * 0.1, along, 0.1, deep * 0.26, 0x5a4029);
        for (const [y, z] of [[0.7, deep * 0.49], [0.93, deep * 0.23]]) box(0, y, face * z, along, 0.07, 0.025, 0x7b5a3a);
        for (const [y, z] of [[0.745, deep * 0.5], [0.975, deep * 0.24]]) box(0, y, face * z, along - 0.04, 0.035, 0.006, 0xf6efd8);
        for (let k = 1; k < 3; k += 1) box(-along / 2 + k * along / 3, 0.75, face * deep * 0.3, 0.02, 0.12, deep * 0.38, 0x7b5a3a);
      }
      box(0, 1.08, 0, along, 0.025, 0.025, steel);
      for (const sx of [-1, 1]) { box(sx * (along / 2 - 0.02), 0.55, 0, 0.04, 1.1, 0.05, steel); box(sx * (along / 2 - 0.02), 0.3, 0, 0.05, 0.6, deep * 0.86, 0x3b2a1c); }
      return true;
    }
    case "checkout": {
      // The lane: the belt counter (belt, divider rail, the scanner's glass), the register's
      // screen and card terminal at the front end, the bagging well, the lane light's pole with
      // its number; the cashier's pocket on its back side.
      const cz = -deep / 2 + 0.3;   // the counter's centre line (0.6 wide), the pocket behind
      box(0, 0.45, cz, along, 0.9, 0.6, accent); box(0, 0.915, cz, along + 0.02, 0.03, 0.62, 0xd8d6cf);
      box(-0.35, 0.94, cz, along * 0.62, 0.02, 0.44, belt);
      for (const x of [-along / 2 + 0.06, along * 0.11]) box(x, 0.955, cz, 0.06, 0.03, 0.46, steel);
      box(along * 0.22, 0.94, cz, 0.38, 0.015, 0.4, 0x2b3f47, { transparent: true, opacity: 0.85 });
      box(along * 0.22, 1.08, cz + 0.22, 0.38, 0.26, 0.04, 0x30373b);
      // The register: drawer, screen on its arm (toward the cashier), the customer's display.
      box(along * 0.34, 0.75, cz + 0.42, 0.42, 0.18, 0.36, dark); can(along * 0.34, 1.1, cz + 0.42, 0.05, 0.5, 0.05, steel);
      box(along * 0.34, 1.36, cz + 0.4, 0.36, 0.26, 0.03, 0x1b2a33); box(along * 0.34, 1.32, cz - 0.31, 0.22, 0.14, 0.03, 0x1b2a33);
      box(along * 0.27, 1.0, cz - 0.27, 0.09, 0.14, 0.07, dark);
      // Bagging: a lower well at the front end with a bag carousel.
      box(along / 2 - 0.3, 0.75, cz, 0.55, 0.02, 0.58, 0xd8d6cf); can(along / 2 - 0.3, 0.98, cz, 0.04, 0.45, 0.04, steel);
      for (const a of [0, 1, 2]) box(along / 2 - 0.3 + Math.cos(a * 2.1) * 0.15, 1.1, cz + Math.sin(a * 2.1) * 0.15, 0.22, 0.3, 0.005, 0xe9ecef, { transparent: true, opacity: 0.7 });
      // The lane light: a pole at the front end with its number box.
      can(along / 2 - 0.05, 1.3, cz + 0.25, 0.04, 2.6, 0.04, steel); box(along / 2 - 0.05, 2.45, cz + 0.25, 0.26, 0.26, 0.26, lit);
      box(along / 2 - 0.05, 2.45, cz + 0.25, 0.27, 0.12, 0.27, 0x1f7a4d);
      // The impulse rack on the pocket's far side (its goods stocked as shelves), and the floor mat.
      for (const y of [0.33, 0.68, 1.03]) box(-along / 2 + 0.55, y - 0.01, deep / 2 - 0.12, 0.95, 0.02, 0.2, 0xb9bfc3);
      box(-along / 2 + 0.55, 0.55, deep / 2 - 0.03, 0.95, 1.1, 0.02, 0x4a5056); box(-along / 2 + 0.55, 0.15, deep / 2 - 0.12, 0.95, 0.3, 0.2, 0x4a5056);
      box(along * 0.3, 0.005, cz + 0.62, 0.9, 0.01, 0.55, 0x353535);
      return true;
    }
    case "self_checkout": {
      // A kiosk: the pedestal, the scanner bed with its scale, the touch screen on its post, the
      // card reader, the receipt slot; the bagging scale beside it with its bag rack and light.
      box(-0.12, 0.45, 0, 0.5, 0.9, deep * 0.8, 0xe8e8e6); box(-0.12, 0.915, -0.05, 0.52, 0.03, deep * 0.85, 0x2b3f47, { transparent: true, opacity: 0.9 });
      box(-0.12, 1.25, deep * 0.25, 0.42, 0.32, 0.04, 0x1b2a33); can(-0.12, 1.05, deep * 0.28, 0.05, 0.3, 0.05, dark);
      box(0.08, 1.02, -deep * 0.25, 0.1, 0.16, 0.08, dark); box(-0.3, 0.98, deep * 0.2, 0.1, 0.12, 0.1, dark);
      box(0.3, 0.72, 0, 0.34, 0.04, deep * 0.7, 0xc5c8ca); for (const sz of [-1, 1]) box(0.3, 0.98, sz * deep * 0.3, 0.3, 0.5, 0.015, steel);
      box(0.3, 0.36, 0, 0.3, 0.72, deep * 0.6, 0xe8e8e6);
      can(-0.3, 1.6, deep * 0.3, 0.03, 1.1, 0.03, steel); box(-0.3, 2.18, deep * 0.3, 0.14, 0.14, 0.14, 0x1f7a4d);
      return true;
    }
    case "sco_podium": box(0, 0.5, 0, 0.42, 1.0, 0.42, 0xe8e8e6); box(0, 1.03, 0, 0.46, 0.04, 0.46, dark); box(0, 1.2, 0.05, 0.36, 0.24, 0.03, 0x1b2a33); return true;
    default: return false;
  }
}

//: A hanging sign's face: the aisle's number in a disc and what is in it, or a department's name.
export function signCanvas(doc, sign, accent = "#ac3834") {
  const c = doc.createElement("canvas"); c.width = 512; c.height = 176;
  const g = c.getContext("2d");
  g.fillStyle = "#f7f5ef"; g.fillRect(0, 0, 512, 176); g.fillStyle = accent; g.fillRect(0, 0, 512, 14); g.fillRect(0, 162, 512, 14);
  const names = sign.sections.map((k) => SECTION_NAMES[k] || k);
  let x = 24;
  if (sign.number) { g.fillStyle = accent; g.beginPath(); g.arc(84, 88, 58, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.font = "700 72px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(sign.number), 84, 92); x = 164; }
  g.fillStyle = "#1d2a33"; g.textAlign = "left"; g.textBaseline = "middle";
  const size = names.length > 2 ? 34 : names.length > 1 ? 42 : 58;
  g.font = `600 ${size}px system-ui,sans-serif`;
  names.slice(0, 4).forEach((t, i, all) => g.fillText(t, x, 88 + (i - (all.length - 1) / 2) * size * 1.08));
  return c;
}
