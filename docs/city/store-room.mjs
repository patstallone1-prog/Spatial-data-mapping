// A shop's room fitted to its trade and its space, as the Interior Studio fits a business
// (interior-lab/profiles.mjs PROGRAMS): what lines its walls, what stands on its floor, where the
// till is and how much is kept back as a stock room.
//
// It replaces the room every shop had -- a counter straight across a few metres in and shelves
// behind it, whatever the shop and however deep the building -- with the layout a real shop of
// the trade has: the till beside the door, where the staff see who comes and goes; the wall
// fixtures down both sides (a grocer's chillers, a boutique's rails, a bookshop's shelves, a
// salon's mirrors and chairs); island fixtures in rows with aisles a trolley or a wheelchair
// passes (1.2 m); and, in a deep enough building, a stock room partitioned off at the back.
//
// Local metres as the city's shop frame: x across (+ to the right seen from the street), z in
// from the front (the door at z 0, x = doorX).

//: Each trade's room: what is on the walls (``wall``), what stands in rows on the floor
//: (``island``), anything by the window (``front``), what is at the back (``rear``), and the
//: counter (``till``: "side" by the door, "back" across the back, "bar" down one side).
import { SUPERMARKET_KINDS, drawGrocery, inPocket, planGrocery, signCanvas } from "./grocery-room.mjs";

export const STORE_PROGRAMS = {
  //: A corner store: drinks behind glass doors down the walls, the till by the door.
  corner: { wall: "cooler_doors", island: "gondola", front: "produce", rear: "shelf", till: "side", tills: 1 },
  grocery: { wall: "chiller", island: "gondola", front: "produce", rear: "chiller", till: "side", tills: 2 },
  clothing: { wall: "rail", island: "display_table", front: "mannequin", rear: "fitting", till: "side" },
  books: { wall: "bookshelf", island: "display_table", front: "display_table", rear: "bookshelf", till: "side", seat: "armchair" },
  pharmacy: { wall: "shelf", island: "gondola", front: "gondola", rear: "dispensary", till: "back" },
  hardware: { wall: "pegboard", island: "gondola", front: "display_table", rear: "shelf", till: "side" },
  florist: { wall: "plant_tiers", island: "flower_table", front: "flower_table", rear: "workbench", till: "side" },
  beauty: { wall: "styling", island: null, front: "waiting", rear: "shampoo", till: "side" },
  service: { wall: "shelf", island: null, front: "waiting", rear: "desk", till: "back" },
  laundry: { wall: "washer", island: "folding", front: "waiting", rear: "dryer", till: "side" },
  bar: { wall: "booth_wall", island: "high_table", front: "high_table", rear: "backbar", till: "bar" },
  shop: { wall: "shelf", island: "gondola", front: "display_table", rear: "shelf", till: "side" },
};
const PROGRAM_OF = {
  grocery: "grocery", supermarket: "grocery", greengrocer: "grocery", convenience: "corner", liquor: "corner", wine_shop: "corner", smoke_shop: "corner", deli: "corner",
  clothing: "clothing", clothes: "clothing", shoes: "clothing", boutique: "clothing", jewelry: "clothing",
  books: "books", gallery: "books", gifts: "books", toys: "books",
  pharmacy: "pharmacy", chemist: "pharmacy", optician: "pharmacy",
  hardware: "hardware", doityourself: "hardware", auto_parts: "hardware", bike: "hardware", electronics: "hardware",
  florist: "florist",
  salon: "beauty", hairdresser: "beauty", barber: "beauty", nail_salon: "beauty", spa: "beauty", beauty: "beauty", pet_grooming: "beauty",
  laundry: "laundry", dry_cleaner: "laundry",
  bank: "service", law_office: "service", staffing: "service", print_ship: "service", clinic: "service", dentist: "service", vet: "service",
  bar: "bar", pub: "bar",
};
export const storeProgramOf = (kind) => PROGRAM_OF[kind] || "shop";

//: Footprints (w across the wall it stands against or across a row, d deep), m.
const SIZE = {
  chiller: [1.2, 0.75], cooler_doors: [1.5, 0.85], rail: [1.4, 0.6], bookshelf: [1.0, 0.4], shelf: [1.0, 0.45], pegboard: [1.2, 0.35], plant_tiers: [1.2, 0.6],
  styling: [1.2, 0.55], washer: [0.75, 0.75], booth_wall: [1.6, 1.5], gondola: [2.4, 0.9], display_table: [1.4, 0.8], produce: [1.4, 0.9],
  mannequin: [0.5, 0.5], flower_table: [1.2, 0.7], folding: [1.8, 0.8], high_table: [0.7, 0.7], waiting: [1.4, 0.5], armchair: [0.8, 0.8],
  fitting: [1.0, 1.1], dispensary: [2.4, 0.7], workbench: [1.8, 0.75], shampoo: [0.8, 1.3], desk: [1.4, 0.7], dryer: [0.75, 0.75], backbar: [2.4, 0.5],
};
//: The aisle kept clear between fixtures (m), the way from the door, and the stock room's depth.
export const STORE_AISLE_M = 1.2, STOCKROOM_M = 2.4;

//: The room for a shop of ``kind`` in a space ``width`` x ``depth`` with its door at ``doorX``:
//: a supermarket big enough for one laid out as one (grocery-room.mjs, ``name`` its chain).
export function planStore({ width, depth, doorX = 0, name = "" }, kind) {
  if (SUPERMARKET_KINDS.has(kind)) { const g = planGrocery({ width, depth, doorX, name }, kind); if (g) return g; }
  const P = STORE_PROGRAMS[storeProgramOf(kind)];
  const half = width / 2, fixtures = [];
  const add = (role, x, z, w, d, extra = {}) => {
    if (x - w / 2 < -half + 0.02 || x + w / 2 > half - 0.02 || z - d / 2 < 0.05 || z + d / 2 > depth - 0.02) return null;
    if (fixtures.some((f) => Math.abs(x - f.x) < (w + f.w) / 2 + 0.05 && Math.abs(z - f.z) < (d + f.d) / 2 + 0.05)) return null;
    const f = { role, x, z, w, d, ...extra }; fixtures.push(f); return f;
  };
  // A stock room across the back, behind a partition with a door, where there is the depth.
  const stock = depth >= 8.5 ? STOCKROOM_M : 0, floorEnd = depth - stock;
  if (stock) {
    const doorAt = doorX > 0 ? -half + 1.4 : half - 1.4;
    fixtures.push({ role: "partition", x: 0, z: floorEnd, w: width, d: 0.12, door: doorAt });
    for (const side of [-1, 1]) add("stock_shelf", side * (half - 0.3), floorEnd + stock / 2, 0.5, stock - 0.4, { side });
  }
  // The till: by the door on the side away from it (the staff see the door), across the back,
  // or a bar down one side.
  const tillSide = doorX > 0.4 ? -1 : 1;
  // (A side counter stands out from the wall with the staff's aisle behind it.)
  if (P.till === "side") add("till", tillSide * (half - 1.25), Math.min(2.4, floorEnd * 0.3), 0.7, Math.min(2.2, floorEnd * 0.35), { side: tillSide, tills: P.tills || 1 });
  else if (P.till === "back") add("till", 0, floorEnd - 0.75, Math.min(3.2, width - 2), 0.65, { tills: 1 });
  else add("bar", tillSide * (half - 0.45), floorEnd * 0.5, 0.7, Math.min(floorEnd - 2, 7), { side: tillSide });
  // The walls: the trade's fixtures in a run down each side, the window end left for the front.
  // (A small room with nothing on its walls after that -- a salon with no chair -- is tried again
  // closer to the back.)
  const [ww, wd] = SIZE[P.wall] || SIZE.shelf;
  const wallRun = (margin) => {
    for (const side of [-1, 1]) for (let z = 1.6 + ww / 2; z + ww / 2 < floorEnd - margin; z += ww + 0.04) {
      const x = side * (half - wd / 2 - 0.02);
      if (Math.abs(x - doorX) < wd / 2 + 0.5) continue;   // a door near the wall: its way in kept clear
      if (fixtures.some((f) => f.role === "till" && f.side === side && Math.abs(z - f.z) < f.d / 2 + ww / 2 + 0.1)) continue;   // behind the till: the staff's aisle
      add(P.wall, x, z, wd, ww, { side, wall: true });
    }
  };
  wallRun(P.rear ? SIZE[P.rear][1] + STORE_AISLE_M : 0.2);
  if (!fixtures.some((f) => f.role === P.wall)) wallRun(0.2);
  // The back of the shop floor: the trade's rear fixture across it -- or, where that is shelving,
  // the shop's own stocked shelves (view.mjs: its wares as they are, as many as it has), kept clear.
  const rearShelves = ["shelf", "bookshelf", "chiller"].includes(P.rear);
  if (rearShelves) fixtures.push({ role: "stocked", x: 0, z: floorEnd - 0.3, w: width - 0.6, d: 0.45 });
  else if (P.rear) {
    const [rw, rd] = SIZE[P.rear];
    const most = { shampoo: 2, fitting: 3, workbench: 1, desk: 2, dispensary: 1 }[P.rear] ?? 99;
    let placed = 0;
    for (let x = -half + 0.2 + rw / 2; x + rw / 2 < half - 0.2 && placed < most; x += rw + 0.05) if (add(P.rear, x, floorEnd - rd / 2 - 0.05, rw, rd, { side: 0, back: true })) placed += 1;
  }
  // Islands in rows down the middle, an aisle each side and a clear way in from the door.
  if (P.island) {
    const [iw, id] = SIZE[P.island], inner = half - wd - STORE_AISLE_M;
    for (let z = 2.2 + iw / 2; z + iw / 2 < floorEnd - (P.rear ? SIZE[P.rear][1] : 0) - STORE_AISLE_M; z += iw + STORE_AISLE_M * 0.6) {
      for (let x = -inner + id / 2; x + id / 2 <= inner; x += id + STORE_AISLE_M) {
        // The way in from the door stays clear all the way to the back.
        if (Math.abs(x - doorX) < id / 2 + 0.55) continue;
        add(P.island, x, z, id, iw, { island: true });
      }
    }
  }
  // By the window: the trade's display, either side of the door.
  if (P.front) {
    const [fw, fd] = SIZE[P.front];
    for (const side of [-1, 1]) {
      const x = doorX + side * (0.9 + fw / 2);
      add(P.front, x, 0.35 + fd / 2, fw, fd, { side, front: true });
    }
  }
  if (P.seat) add(P.seat, -tillSide * (half - 0.6), floorEnd * 0.55, 0.8, 0.8, { side: -tillSide });
  const program = storeProgramOf(kind);
  return { kind, program, fixtures, width, depth, doorX, floorEnd, rearShelves, ...(program === "grocery" || program === "corner" ? { shelves: smallShopShelves(fixtures) } : {}) };
}

//: A small grocery's or corner store's shelves (the shelf slots shelf-stock.mjs faces its
//: products on), from its fixtures as storeFixtures draws them: drinks and dairy behind the
//: coolers' doors, the gondolas' two faces by turns of the corner-store range, fruit on the
//: front table.
const CORNER_SECTIONS = ["snacks", "pantry", "household", "breakfast", "personal_care", "condiments", "checkout", "alcohol"];
function smallShopShelves(fixtures) {
  const out = [];
  let g = 0, coolers = 0;
  const push = (f, i, section, levels, lz, deep, h, yawAdd = 0, display) => {
    const yaw = (f.wall ? f.side * Math.PI / 2 : f.island ? Math.PI / 2 : f.back ? Math.PI : 0) + yawAdd;
    const along = f.wall || f.island ? f.d : f.w, c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const [k, y] of levels.entries()) out.push({ fixture: i, section, x: f.x + lz * sn, z: f.z + lz * c, y, yaw, len: along - 0.08, deep, h: k === levels.length - 1 ? 0.4 : h, ...(display ? { display } : {}) });
  };
  fixtures.forEach((f, i) => {
    const deep = f.wall || f.island ? f.w : f.d;
    if (f.role === "cooler_doors") push(f, i, coolers++ % 3 === 2 ? "dairy" : "drinks", [0.22, 0.58, 0.94, 1.3, 1.64], -deep / 2 + 0.12 + 0.28, 0.5, 0.32);
    else if (f.role === "chiller") push(f, i, "dairy", [0.15, 0.59, 1.03, 1.46], 0, deep * 0.7, 0.4);
    else if (f.role === "gondola") for (const face of [0, Math.PI]) push(f, i, CORNER_SECTIONS[g++ % CORNER_SECTIONS.length], [0.15, 0.567, 0.983, 1.4], -deep * 0.24, deep * 0.4, 0.38, face);
    else if (f.role === "produce") push(f, i, "produce", [0.83], 0, deep - 0.12, 0.25, 0, "bin");
  });
  return out;
}

//: Whether one can stand at (x, z): inside the room, off every fixture, and (not staff) out of
//: the stock room and from behind the till.
export function canWalkStore(plan, x, z, staff = false) {
  const half = plan.width / 2;
  if (x < -half + 0.25 || x > half - 0.25 || z < 0.12 || z > plan.depth - 0.25) return false;
  for (const f of plan.fixtures) {
    if (staff && inPocket(f, x, z)) continue;   // a lane's cashier, in the pocket
    if (f.role === "partition") {
      if (Math.abs(z - f.z) < 0.25 && !(staff && Math.abs(x - f.door) < 0.5)) return false;
      if (!staff && z > f.z) return false;
      continue;
    }
    if (Math.abs(x - f.x) < f.w / 2 + 0.2 && Math.abs(z - f.z) < f.d / 2 + 0.2) return false;
    if (!staff && (f.role === "till" || f.role === "bar") && f.side && Math.sign(x - f.x) === f.side && Math.abs(z - f.z) < f.d / 2 + 0.3) return false;
  }
  return true;
}

//: The room's fixtures as meshes (unlit, shaded by hand, as the shop room's are): one group in
//: the plan's frame. ``seed`` varies the goods' colours; ``tint`` is the shop's own colour.
export function storeFixtures(THREE, plan, { seed = 1, tint = 0xcfc6b8 } = {}) {
  const g = new THREE.Group(); g.name = "store-fixtures";
  const mats = new Map();
  const mat = (c, extra) => { const k = `${c}|${extra ? JSON.stringify(extra) : ""}`; if (!mats.has(k)) mats.set(k, new THREE.MeshBasicMaterial({ color: c, ...(extra || {}) })); return mats.get(k); };
  const geos = new Map(), batches = new Map(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const TQ = new THREE.Quaternion(), XA = new THREE.Vector3(1, 0, 0);
  const prim = (kind, x, y, z, w, h, d, c, extra) => {
    if (!geos.has(kind)) geos.set(kind, kind === "box" ? new THREE.BoxGeometry() : kind === "ball" ? new THREE.SphereGeometry(0.5, 10, 8) : new THREE.CylinderGeometry(0.5, 0.5, 1, 14));
    // ``tilt``: turned about the fixture's own x (a produce bin sloping to the aisle).
    const { tilt, ...look } = extra || {};
    const m = mat(c, Object.keys(look).length ? look : undefined), key = kind + m.uuid;
    if (!batches.has(key)) batches.set(key, { geo: geos.get(kind), m, list: [] });
    batches.get(key).list.push(M.compose(V.set(x, y, z), tilt ? TQ.setFromAxisAngle(XA, tilt) : Q, S.set(w, h, d)).clone().premultiply(frame));
  };
  const box = (...a) => prim("box", ...a), ball = (...a) => prim("ball", ...a), can = (...a) => prim("can", ...a);
  let frame = new THREE.Matrix4();
  let n = (seed >>> 0) || 7; const r = () => { n = (n * 1103515245 + 12345) >>> 0; return (n >>> 8) / 16777216; };
  const goodsColour = () => [0xd9822b, 0x2e86c1, 0xf2f1ec, 0xc0392b, 0x27ae60, 0xe3c45c, 0x6b4f8a, 0x2b2d31][Math.floor(r() * 8)];
  const steel = 0xb8c0c4, dark = 0x2a2d30, wood = 0x8a6440, light = 0xf4f2ee;
  // Shelving: uprights, ``rows`` shelves, goods on each. Its length runs along local x.
  // (A room with shelf slots has its real products faced on them, not the coloured stand-ins.)
  const shelving = (len, deep, rows, h, colour = steel, goods = !plan.shelves?.length) => {
    for (const s of [-1, 1]) box(s * (len / 2 - 0.02), h / 2, 0, 0.04, h, deep, colour);
    box(0, h / 2, deep / 2 - 0.02, len, h, 0.03, 0xe8e4dc);
    for (let i = 0; i < rows; i += 1) {
      const y = 0.15 + i * (h - 0.25) / Math.max(1, rows - 1);
      box(0, y, 0, len, 0.03, deep, colour);
      if (goods) for (let k = 0; k < Math.floor(len / 0.18); k += 1) box(-len / 2 + 0.1 + k * 0.18, y + 0.11, -0.02, 0.14, 0.18 + r() * 0.08, deep * 0.7, goodsColour());
    }
  };
  for (const f of plan.fixtures) {
    // Each fixture in its own frame: x along it, its front to -z (toward the room). A wall
    // fixture faces in from its wall, a rear one faces the door, an island runs front to back.
    // (rotationY(θ) turns the front, -z, to (-sin θ, -cos θ): a fixture on the wall at side s
    // faces -s, so θ = s·π/2; the back wall's faces the door, θ = π.)
    if (f.yaw !== undefined && f.len !== undefined) {
      // A fixture planned with its own frame (grocery-room.mjs).
      frame = new THREE.Matrix4().makeRotationY(f.yaw).setPosition(f.x, 0, f.z);
      if (drawGrocery(f, { box, can, ball }, { tint: plan.accent ? parseInt(plan.accent.slice(1), 16) : tint, r })) continue;
    }
    const yaw = f.wall ? f.side * Math.PI / 2 : f.island ? Math.PI / 2 : f.role === "till" || f.role === "bar" ? (f.side ? f.side * Math.PI / 2 : 0) : f.back ? Math.PI : 0;
    frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(f.x, 0, f.z);
    const along = f.wall || f.island || (f.side && (f.role === "till" || f.role === "bar")) ? f.d : f.w, deep = f.wall || f.island || (f.side && (f.role === "till" || f.role === "bar")) ? f.w : f.d;
    if (f.role === "cooler_doors" && drawGrocery({ ...f, len: along, deep }, { box, can, ball }, { tint, r })) continue;
    switch (f.role) {
      case "partition": {
        frame = new THREE.Matrix4().setPosition(0, 0, f.z);
        const half = plan.width / 2, gap = 0.9;
        box((-half + f.door - gap / 2) / 2 - half / 2 + half / 2, 1.6, 0, f.door - gap / 2 + half, 3.2, 0.1, 0xd8d0c2);
        box((f.door + gap / 2 + half) / 2, 1.6, 0, half - f.door - gap / 2, 3.2, 0.1, 0xd8d0c2);
        box(f.door, 2.6, 0, gap, 1.2, 0.1, 0xd8d0c2); box(f.door, 1.05, 0.02, gap - 0.06, 2.1, 0.04, 0x7a6248);
        break;
      }
      case "stocked": break;
      case "chiller": shelving(along, deep, 5, 2.0, 0xdfe4e6); box(0, 1.0, -deep / 2, along, 2.0, 0.02, 0xbfe3f0, { transparent: true, opacity: 0.35 }); box(0, 2.05, -deep / 2 + 0.05, along, 0.12, 0.1, 0xf4fbff); break;
      case "shelf": case "stock_shelf": case "pegboard": case "bookshelf": case "dispensary":
        shelving(along, deep, f.role === "pegboard" ? 6 : 5, f.role === "dispensary" ? 2.2 : 2.0, f.role === "bookshelf" ? wood : f.role === "pegboard" ? 0xc9a36a : steel);
        if (f.role === "dispensary") { box(0, 0.5, -deep / 2 - 0.35, along, 1.0, 0.55, light); box(0, 1.02, -deep / 2 - 0.35, along + 0.05, 0.04, 0.62, 0x9ab0a8); }
        break;
      case "gondola": shelving(along, deep * 0.48, 4, 1.5, steel); frame.multiply(new THREE.Matrix4().makeRotationY(Math.PI)); shelving(along, deep * 0.48, 4, 1.5, steel); break;
      case "rail": {
        box(0, 1.55, 0, along, 0.03, 0.03, steel); for (const s of [-1, 1]) box(s * along / 2, 0.78, 0, 0.03, 1.56, 0.03, steel);
        for (let k = 0; k < Math.floor(along / 0.07); k += 1) { const c = [0x1d2230, 0xf4f4f2, 0x8e2b25, 0x3f5a80, 0xcfc4ae, 0x2f4a3a][Math.floor(r() * 6)]; box(-along / 2 + 0.05 + k * 0.07, 1.15, 0, 0.03, 0.7 + r() * 0.2, deep * 0.7, c); }
        break;
      }
      case "display_table": case "flower_table": case "produce": case "folding": case "high_table": {
        const h = f.role === "high_table" ? 1.05 : f.role === "produce" ? 0.8 : 0.78;
        box(0, h, 0, along, 0.05, deep, f.role === "folding" ? light : wood);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * (along / 2 - 0.05), h / 2, sz * (deep / 2 - 0.05), 0.05, h, 0.05, dark);
        if (f.role === "flower_table") for (let k = 0; k < 6; k += 1) { const x = -along / 2 + 0.15 + k * (along - 0.3) / 5; can(x, h + 0.15, 0, 0.18, 0.3, 0.18, 0x5d6f7a); for (let j = 0; j < 4; j += 1) ball(x + (r() - 0.5) * 0.15, h + 0.38 + r() * 0.15, (r() - 0.5) * 0.12, 0.11, 0.11, 0.11, [0xd64570, 0xf2c14e, 0xf5f0e6, 0xe76f51][Math.floor(r() * 4)]); }
        else if (f.role === "produce" && !plan.shelves?.length) for (let k = 0; k < 4; k += 1) { const c = [0xd64045, 0xf2a03d, 0x7cb342, 0xffd23f][k]; box(-along / 2 + (k + 0.5) * along / 4, h + 0.08, 0, along / 4 - 0.05, 0.12, deep - 0.1, 0x8a6a45); for (let j = 0; j < 8; j += 1) ball(-along / 2 + (k + 0.5) * along / 4 + (r() - 0.5) * 0.25, h + 0.17, (r() - 0.5) * (deep - 0.2), 0.09, 0.09, 0.09, c); }
        else if (f.role === "high_table") { for (const s of [-1, 1]) { can(s * 0.5, 0.38, 0, 0.32, 0.04, 0.32, dark); can(s * 0.5, 0.2, 0, 0.04, 0.4, 0.04, steel); } }
        else for (let k = 0; k < Math.floor(along / 0.3); k += 1) box(-along / 2 + 0.18 + k * 0.3, h + 0.06, (r() - 0.5) * 0.3, 0.24, 0.08 + r() * 0.06, 0.18, goodsColour());
        break;
      }
      case "plant_tiers": for (let i = 0; i < 3; i += 1) { box(0, 0.3 + i * 0.4, -deep / 2 + 0.15 + i * 0.15, along, 0.04, 0.25, wood); for (let k = 0; k < 4; k += 1) { const x = -along / 2 + 0.15 + k * (along - 0.3) / 3; can(x, 0.4 + i * 0.4, -deep / 2 + 0.15 + i * 0.15, 0.14, 0.16, 0.14, 0xb5653a); ball(x, 0.58 + i * 0.4, -deep / 2 + 0.15 + i * 0.15, 0.24, 0.24, 0.24, 0x3f7a4a); } } break;
      case "styling": { box(0, 0.45, 0, along, 0.9, deep * 0.6, light); box(0, 1.45, deep * 0.25, along * 0.8, 1.0, 0.03, 0xbfd6dc); box(0, 0.48, -deep - 0.2, 0.55, 0.12, 0.55, dark); box(0, 0.85, -deep - 0.45, 0.5, 0.6, 0.08, dark); can(0, 0.22, -deep - 0.2, 0.08, 0.44, 0.08, steel); break; }
      case "shampoo": box(0, 0.45, 0, along, 0.9, 0.4, light); box(0, 0.95, 0, 0.5, 0.15, 0.35, 0xf4f4f2); box(0, 0.45, -0.6, 0.6, 0.5, 0.7, dark); break;
      case "washer": case "dryer": box(0, f.role === "dryer" ? 0.95 : 0.45, 0, along * 0.95, f.role === "dryer" ? 1.9 : 0.9, deep * 0.95, 0xf4f4f2); can(0, f.role === "dryer" ? 1.3 : 0.5, -deep / 2, 0.42, 0.02, 0.42, 0x8aa1ad); break;
      case "mannequin": { const o = [[0x1d2230, 0xf4f4f2], [0x8e2b25, 0x1f1f23], [0xcfc4ae, 0x3f5a80]][Math.floor(r() * 3)]; can(0, 0.4, 0, 0.03, 0.8, 0.03, dark); can(0, 1.2, 0, 0.34, 0.55, 0.26, o[0]); can(0, 0.75, 0, 0.3, 0.4, 0.24, o[1]); ball(0, 1.62, 0, 0.18, 0.22, 0.18, 0xd8cbb8); break; }
      case "fitting": box(0, 1.1, 0.5, along, 2.2, 0.04, light); for (const s of [-1, 1]) box(s * along / 2, 1.1, 0, 0.04, 2.2, deep, light); box(0, 1.15, -deep / 2, along, 1.9, 0.02, 0x7d3c5a); break;
      case "waiting": box(0, 0.42, 0, along, 0.08, deep, dark); box(0, 0.2, 0, along - 0.1, 0.4, deep - 0.1, steel); break;
      case "armchair": box(0, 0.25, 0, 0.8, 0.5, 0.8, 0x6b4f3a); box(0, 0.65, 0.33, 0.8, 0.6, 0.14, 0x6b4f3a); for (const s of [-1, 1]) box(s * 0.36, 0.55, 0, 0.1, 0.25, 0.8, 0x6b4f3a); break;
      case "workbench": case "desk": box(0, 0.86, 0, along, 0.05, deep, wood); for (const s of [-1, 1]) box(s * (along / 2 - 0.04), 0.43, 0, 0.06, 0.86, deep - 0.06, dark); if (f.role === "desk") { box(0, 1.1, 0.15, 0.5, 0.32, 0.03, dark); box(0, 0.89, -0.1, 0.42, 0.015, 0.14, dark); } break;
      case "backbar": shelving(along, deep, 3, 1.8, wood, false); for (let k = 0; k < Math.floor(along / 0.12); k += 1) can(-along / 2 + 0.08 + k * 0.12, 1.0 + (k % 3) * 0.4, 0, 0.07, 0.3, 0.07, [0x2f5d3a, 0x8a5a2e, 0xc0c8cc, 0x6b2a24][k % 4], { transparent: true, opacity: 0.85 }); break;
      case "booth_wall": box(0, 0.22, 0, along, 0.44, deep * 0.35, wood); box(0, 0.47, 0, along, 0.1, deep * 0.33, 0x7e2b27); box(0, 0.85, deep * 0.15, along, 0.7, 0.12, 0x7e2b27); box(0, 0.74, -deep * 0.35, along * 0.8, 0.04, 0.6, wood); break;
      case "till": case "bar": {
        // The counter: its front to the room, the till(s) on top facing the staff side.
        box(0, 0.5, 0, along, 1.0, deep, tint); box(0, 1.02, 0, along + 0.04, 0.05, deep + 0.06, 0xe9e4da);
        const tills = f.role === "bar" ? 0 : f.tills || 1;
        for (let k = 0; k < tills; k += 1) { const x = -along / 2 + (k + 0.5) * along / tills; box(x, 1.16, 0.05, 0.36, 0.24, 0.3, dark); box(x, 1.3, 0.1, 0.3, 0.2, 0.03, 0x1d3b4a); }
        if (f.role === "bar") for (let k = 0; k < Math.floor(along / 0.6); k += 1) { const x = -along / 2 + 0.3 + k * 0.6; can(x, 0.75, -deep / 2 - 0.35, 0.36, 0.05, 0.36, dark); can(x, 0.38, -deep / 2 - 0.35, 0.05, 0.75, 0.05, steel); }
        break;
      }
      default: box(0, 0.6, 0, along, 1.2, deep, steel);
    }
  }
  if (plan.grocery) {
    // The shelves of the cases and tables (the gondolas draw their own): a board under each
    // shelf's goods and its price-ticket strip along the front edge.
    for (const sh of plan.shelves || []) {
      const f = plan.fixtures[sh.fixture];
      if (!f || f.role === "gondola" || f.role === "checkout") continue;
      frame = new THREE.Matrix4().makeRotationY(sh.yaw).setPosition(sh.x, 0, sh.z);
      const cold = f.role !== "produce_table";
      box(0, sh.y - 0.012, 0, sh.len, 0.024, sh.deep, cold ? 0xdfe3e4 : 0x6f5238);
      box(0, sh.y + 0.012, -sh.deep / 2 + 0.006, sh.len, 0.045, 0.012, cold ? 0xf3f1e8 : 0xe9dcb8);
    }
    // Strip lights down every aisle under the ceiling, and the hanging signs.
    frame = new THREE.Matrix4();
    for (const sg of plan.signs || []) if (sg.number) box(sg.x, 3.13, sg.z, 0.16, 0.035, Math.max(2, plan.floorEnd - 7), 0xfffdf4);
    for (const x of [-plan.width / 4, plan.width / 4]) box(x, 3.13, 2.6, 0.16, 0.035, 3.6, 0xfffdf4);
    const doc = globalThis.document;
    if (doc) for (const sg of plan.signs || []) {
      const tex = new THREE.CanvasTexture(signCanvas(doc, sg, plan.accent));
      if ("SRGBColorSpace" in THREE) tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.52), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      board.position.set(sg.x, sg.y, sg.z); board.rotation.y = sg.wall ? sg.yaw + Math.PI : Math.PI;
      g.add(board);
      if (!sg.wall) for (const s0 of [-0.6, 0.6]) box(sg.x + s0, sg.y + 0.45, sg.z, 0.01, 0.38, 0.01, 0x9aa0a4);
    }
  }
  for (const { geo, m, list } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((x, i) => mesh.setMatrixAt(i, x));
    mesh.frustumCulled = false;
    g.add(mesh);
  }
  return g;
}
