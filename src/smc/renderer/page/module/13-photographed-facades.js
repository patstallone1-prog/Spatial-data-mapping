// ---- photographed facades ----
//
// One chunk of the city wears its own photographs. Every other building is dressed in a
// procedural texture -- a window grid drawn into a canvas, coloured from San Francisco's
// building stock by percentage -- which makes a street look inhabited and describes no
// particular building. These walls are the other thing: the frames that actually looked at
// them, rectified onto the plane of the wall and merged.
//
// A panel is hung rather than the building's own facade being replaced. The cameras stood in
// the street, so they saw the lower storeys and not the parapet, and a panel that stops where
// the photographs stopped is honest about that in a way that stretching one to the roofline
// would not be. It also means a wall that failed the agreement check simply keeps what it had.
const FACADES = DATA.facades || { chunks: [], walls: [] };
const facadeLoader = new THREE.TextureLoader();
//: Clear of the wall behind it. Coplanar with the extrusion, the two would fight for every
//: pixel and flicker, which is the same bug the kerb bands had.
const FACADE_STANDOFF_M = 0.06;
//: Doors, garage doors and doorway portals stand clear in front of the facade photograph, so
//: a picture of the wall never covers the door you walk through.
const DOOR_STANDOFF_M = 0.09;
const GARAGE_STANDOFF_M = 0.12;
const PORTAL_STANDOFF_M = 0.11;

function facadePanel(wall) {
  const [ax, ay] = xy(wall.a[0], wall.a[1]);
  const [bx, by] = xy(wall.b[0], wall.b[1]);
  const length = Math.hypot(bx - ax, by - ay);
  if (!(length > 0.5) || !(wall.h > 0.5)) return null;

  const bearing = wall.n * Math.PI / 180;
  const nx = Math.sin(bearing);
  const nz = -Math.cos(bearing);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.86, metalness: 0.03,
    // Until its photograph arrives the panel is invisible rather than white: a grid of blank
    // rectangles standing off the buildings is worse than the buildings alone.
    transparent: true, opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, wall.h), material);
  // The panel's foot is on the ground at the wall, where the photograph's kerb is.
  const px = (ax + bx) / 2 + nx * FACADE_STANDOFF_M, pz = -(ay + by) / 2 + nz * FACADE_STANDOFF_M;
  mesh.position.set(px, wall.h / 2 + groundLiftAt(px, pz), pz);
  // A plane faces +z; rotating by pi minus the bearing turns it to face the way the wall does.
  mesh.rotation.y = Math.PI - bearing;
  mesh.userData.facade = wall;
  return mesh;
}

// ---- photographed facades, streamed ----
//
// There were two hundred and twenty photographed walls and every one was hung, and its picture
// fetched, at startup. There are thirteen and a half thousand now, across two hundred chunks:
// hung all at once they were thirteen thousand draw calls and three hundred megabytes for
// every visitor. So a wall is hung only near where you are -- the walker, or the point the map
// camera orbits -- nearest first, and taken down again, texture and all, once it is well
// behind you. Up high, looking at the map rather than a street, none are hung.
const FACADE_NEAR_M = 260;
const FACADE_FAR_M = 380;
const FACADE_MAX_LIVE = 700;
const FACADE_HIGH_M = 900;
const FACADE_CELL_M = 120;
const FACADE_TEXTURE_CONCURRENCY = 4;
const FACADE_FADE_MS = 450;
//: Whether photographed walls are hung on the buildings. Off: a photograph of one particular
//: wall carried its sky, its camera's angle and whatever stood in front of it, and often covered
//: only one face or a strip of a wall. Every building is drawn in its material instead (the
//: material libraries, chosen from what the photographs read -- see pickMaterial). The survey's
//: readings of cladding and colour are still used; only the pictures themselves are not hung.
const FACADE_PHOTOS = false;
//: The panels hung now (the shells read this list).
const facadePanels = [];
const facadeLive = new Map();
const facadeGrid = new Map();
FACADES.walls.forEach((wall, i) => {
  const [ax, ay] = xy(wall.a[0], wall.a[1]);
  const [bx, by] = xy(wall.b[0], wall.b[1]);
  wall._x = (ax + bx) / 2;
  wall._z = -(ay + by) / 2;
  wall._i = i;
  const key = `${Math.floor(wall._x / FACADE_CELL_M)}:${Math.floor(wall._z / FACADE_CELL_M)}`;
  if (!facadeGrid.has(key)) facadeGrid.set(key, []);
  facadeGrid.get(key).push(wall);
});
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
// ---- garages: only the ones the kerb says this house has ----
//
// A garage comes from the city's record of a dropped kerb, attached to the building behind it.
// The match took whichever wall's midpoint was nearest the cut, so on a block of narrow lots a
// neighbour's driveway landed on this house too, and houses stood with two, three, five garage
// doors. A garage is kept only where its own cut lies in front of the wall it is drawn on --
// the cut's centre projects inside that wall -- and two that would overlap are one. Where the
// wall wears its own photograph, the photograph already shows the real garage where it is, so
// none is drawn over it.
function normaliseGarages(ways) {
  const stats = { kept: 0, neighbour: 0, reassigned: 0, merged: 0, photographed: 0, crowded: 0 };
  // Every building wall, by cell, so a cut can find the wall it actually lies in front of.
  const WALL_CELL = 30;
  const walls = new Map();
  for (const way of ways) {
    if (way.kind !== "building" || !way.covered || !way.points) continue;
    for (let i = 0; i + 1 < way.points.length; i += 1) {
      const a = way.points[i], b = way.points[i + 1];
      const [ax, ay] = xy(a[0], a[1]), [bx, by] = xy(b[0], b[1]);
      const key = `${Math.floor((ax + bx) / 2 / WALL_CELL)}:${Math.floor((ay + by) / 2 / WALL_CELL)}`;
      if (!walls.has(key)) walls.set(key, []);
      walls.get(key).push({ way, a, b, ax, ay, bx, by });
    }
  }
  // The kerb's own record stays whole: the driveway drop is the cut's, whoever's door it is.
  const cuts = [];
  for (const way of ways) {
    if (way.kind !== "building" || !Array.isArray(way.garages) || !way.garages.length) continue;
    way.kerb_cuts = way.garages;
    for (const g of way.garages) cuts.push({ g, from: way });
    way.garages = [];
  }
  for (const { g, from } of cuts) {
    const cut = g.cp || [g.a[0] + (g.b[0] - g.a[0]) * g.t, g.a[1] + (g.b[1] - g.a[1]) * g.t];
    const [cx, cy] = xy(cut[0], cut[1]);
    let best = null;
    const kx = Math.floor(cx / WALL_CELL), ky = Math.floor(cy / WALL_CELL);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const w of walls.get(`${kx + dx}:${ky + dy}`) || []) {
          const L = Math.hypot(w.bx - w.ax, w.by - w.ay);
          if (L < Math.max(2.5, (g.w || 2.6) * 0.9)) continue;
          // The wall the cut points straight back at, the nearest such along its bearing.
          const on = cutOnWall(g, w.ax, w.ay, w.bx, w.by);
          if (on.t < -0.02 || on.t > 1.02) continue;
          const d = on.straight ? on.s
            : Math.abs((cx - w.ax) * (w.by - w.ay) - (cy - w.ay) * (w.bx - w.ax)) / L;
          if (d > GARAGE_REACH_PAGE_M) continue;
          if (!best || d < best.d) best = { d, w, tt: on.t };
        }
      }
    }
    if (!best) { stats.neighbour += 1; continue; }
    const { w } = best;
    if (w.way !== from) stats.reassigned += 1;
    const bearing = w.way === from && g.a[0] === w.a[0] && g.a[1] === w.a[1] ? g.n
      : (Math.atan2(w.by - w.ay, -(w.bx - w.ax)) * 180 / Math.PI + 360) % 360;
    (w.way.garages || (w.way.garages = [])).push({ ...g, a: w.a, b: w.b, t: best.tt,
      n: outwardBearing(w.way, w.a, w.b, bearing) });
  }
  for (const way of ways) {
    if (way.kind !== "building" || !Array.isArray(way.garages) || !way.garages.length) continue;
    const kept = [];
    for (const g of way.garages) {
      const [ax, ay] = xy(g.a[0], g.a[1]), [bx, by] = xy(g.b[0], g.b[1]);
      const length = Math.hypot(bx - ax, by - ay);
      if (!(length > 1)) { stats.neighbour += 1; continue; }
      const { t } = cutOnWall(g, ax, ay, bx, by);
      if (t < -0.02 || t > 1.02) { stats.neighbour += 1; continue; }
      if (photographedEdge([ax, -ay], [bx, -by])) { stats.photographed += 1; continue; }
      // The cut as the pavement draws it (dropKerbsAtDriveways), and the door a little narrower,
      // straight back from it: a car drives up the drop and in without turning.
      const cutW = cutDrawnWidth(g);
      const w = Math.min(cutW - 2 * GARAGE_CUT_MARGIN_M, length * 0.9);
      const cutCentre = t * length;
      const centre = Math.min(Math.max(cutCentre, w / 2), length - w / 2);
      const wallKey = `${g.a.join(",")}|${g.b.join(",")}`;
      const clash = kept.find((k) => k.wallKey === wallKey
        && Math.abs(k.centre - centre) < (k.w + w) / 2 + 0.3);
      if (clash) { stats.merged += 1; continue; }
      kept.push({ ...g, t: centre / length, w, centre, wallKey, length, cutCentre, cutW });
    }
    // Room on the wall for every door kept, with a pier between them.
    const byWall = new Map();
    for (const g of kept) {
      if (!byWall.has(g.wallKey)) byWall.set(g.wallKey, []);
      byWall.get(g.wallKey).push(g);
    }
    const fitted = [];
    for (const doors of byWall.values()) {
      // A single house's frontage -- under ten metres -- has one garage. Two cuts in front of
      // it are one driveway recorded twice or a pair of bays: one door, a double one when the
      // cuts add up to more than a car's width, centred where they were.
      if (doors.length > 1 && doors[0].length < 10) {
        // Across the cuts, if one double door spans them; else behind the widest cut alone. A
        // door centred between two cuts stood behind neither.
        const lo = Math.min(...doors.map((g) => g.cutCentre - g.cutW / 2));
        const hi = Math.max(...doors.map((g) => g.cutCentre + g.cutW / 2));
        const span = hi - lo - 2 * GARAGE_CUT_MARGIN_M;
        const widest = doors.reduce((p, q) => (q.cutW > p.cutW ? q : p));
        const merged = span <= Math.min(4.9, doors[0].length * 0.62)
          ? { ...widest, w: span, cutCentre: (lo + hi) / 2, cutW: hi - lo }
          : { ...widest };
        merged.centre = Math.min(Math.max(merged.cutCentre, merged.w / 2), merged.length - merged.w / 2);
        merged.t = merged.centre / merged.length;
        stats.merged += doors.length - 1;
        doors.splice(0, doors.length, merged);
      }
      doors.sort((p, q) => q.w - p.w);
      let used = 0;
      for (const g of doors) {
        if (used + g.w + 0.6 > g.length) { stats.crowded += 1; continue; }
        used += g.w + 0.6;
        fitted.push(g);
      }
      // And room for the front door beside them: a house's garage never takes the whole
      // frontage. The widest door gives up what the front door needs, down to one car's width.
      const room = GARAGE_DOOR_ROOM_M;
      const onWall = fitted.filter((g) => doors.includes(g));
      const spare = onWall.length ? onWall[0].length - onWall.reduce((s, g) => s + g.w + 0.6, 0) : Infinity;
      if (spare < room && onWall.length) {
        const g = onWall[0];
        const w = Math.max(2.4, g.w - (room - spare));
        if (w < g.w) {
          // The front door's room all on one side, away from the nearer end, rather than two
          // slivers -- and the door stays behind its own cut: it gives up width on that side
          // instead of sliding out from behind the cut.
          const lo = Math.max(0, g.cutCentre - g.cutW / 2 + GARAGE_CUT_MARGIN_M);
          const hi = Math.min(g.length, g.cutCentre + g.cutW / 2 - GARAGE_CUT_MARGIN_M);
          const clear = room + 0.25;
          if (g.centre >= g.length / 2) {
            const left = Math.max(lo, clear);
            g.w = Math.max(2.4, Math.min(w, hi - left));
            g.centre = Math.min(hi, g.length) - g.w / 2;
          } else {
            const right = Math.min(hi, g.length - clear);
            g.w = Math.max(2.4, Math.min(w, right - lo));
            g.centre = Math.max(lo, 0) + g.w / 2;
          }
          g.t = g.centre / g.length;
          stats.narrowed = (stats.narrowed || 0) + 1;
        }
      }
    }
    way.garages = fitted.map(({ wallKey, length, centre, cutCentre, cutW, ...g }) => g);
    for (const g of way.garages) {
      const zone = drivewayZone(g);
      if (zone) DRIVEWAY_ZONES.push(zone);
    }
    stats.kept += way.garages.length;
  }
  return stats;
}
//: How far behind its kerb cut a garage door may stand (the footway and a setback).
const GARAGE_REACH_PAGE_M = 22;
//: How much narrower than its kerb cut a garage door is, each side.
const GARAGE_CUT_MARGIN_M = 0.15;
//: The width of a kerb cut as the pavement draws it (dropKerbsAtDriveways' half, doubled).
function cutDrawnWidth(g) {
  return Math.max(2.2, g.w || 3.5);
}
//: Where a kerb cut points straight back onto a wall (a -> b, page x / y-north metres): its kerb
//: point walked inward along its own bearing until it meets the wall's line, as the fraction t
//: along the wall and the distance s walked. A cut with no kerb point, or one running almost
//: along the wall, falls back to its centre squared onto the wall.
function cutOnWall(g, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
  if (g.kp && Number.isFinite(g.on)) {
    const [kx, ky] = xy(g.kp[0], g.kp[1]);
    const dx = Math.sin(g.on * Math.PI / 180), dy = Math.cos(g.on * Math.PI / 180);
    const den = dx * ey - dy * ex;
    if (Math.abs(den) > 0.5 * Math.sqrt(L2)) {
      const wx = ax - kx, wy = ay - ky;
      const s = (wx * ey - wy * ex) / den;
      if (s > -1) return { t: (wx * dy - wy * dx) / den, s, straight: true };
    }
  }
  const cut = g.cp || [g.a[0] + (g.b[0] - g.a[0]) * g.t, g.a[1] + (g.b[1] - g.a[1]) * g.t];
  const [cx, cy] = xy(cut[0], cut[1]);
  return { t: ((cx - ax) * ex + (cy - ay) * ey) / L2, straight: false };
}
//: The ground between a kerb cut and its garage door, which a car crosses: no tree stands in it.
//: Page x / z quads, the cut's width (and its flare) from the kerb to the door.
const DRIVEWAY_ZONES = [];
function drivewayZone(g) {
  if (!g.kp || !Number.isFinite(g.on)) return null;
  const [kx, ky] = xy(g.kp[0], g.kp[1]);
  const [ax, ay] = xy(g.a[0], g.a[1]), [bx, by] = xy(g.b[0], g.b[1]);
  const doorX = ax + (bx - ax) * g.t, doorY = ay + (by - ay) * g.t;
  const dx = Math.sin(g.on * Math.PI / 180), dy = Math.cos(g.on * Math.PI / 180);
  const reach = (doorX - kx) * dx + (doorY - ky) * dy;
  if (!(reach > 0) || reach > GARAGE_REACH_PAGE_M + 2) return null;
  const half = cutDrawnWidth(g) / 2 + 0.5;
  // From a metre out into the gutter to the door, square to the cut's bearing.
  const ring = [[-half, -1], [half, -1], [half, reach], [-half, reach]]
    .map(([u, v]) => [kx + dy * u + dx * v, -(ky - dx * u + dy * v)]);
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  return { ring, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
    kx, ky, dx, dy, half };
}
//: Whether a tree trunk at (x, z) stands in the way from a kerb cut to its garage.
function inDriveway(x, z) {
  return DRIVEWAY_ZONES.some((zone) => x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ
    && pointInRing(x, z, zone.ring));
}
//: Beyond a driveway's side, how far a pole is set.
const DRIVEWAY_SIDE_CLEAR_M = 0.4;
//: A pole standing in the way from a kerb cut to its garage, moved to the nearer side of the
//: driveway at the same distance from the kerb (or the farther, where the nearer is another
//: driveway or a building). Null where it is not in a driveway, or there is nowhere clear.
function clearOfDriveway(x, z) {
  const zone = DRIVEWAY_ZONES.find((zone) => x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ
    && pointInRing(x, z, zone.ring));
  if (!zone) return null;
  const rx = x - zone.kx, ry = -z - zone.ky;
  const u = rx * zone.dy - ry * zone.dx, v = rx * zone.dx + ry * zone.dy;
  const side = u >= 0 ? 1 : -1;
  for (const s of [side, -side]) {
    const nu = s * (zone.half + DRIVEWAY_SIDE_CLEAR_M);
    const nx = zone.kx + zone.dy * nu + zone.dx * v, nz = -(zone.ky - zone.dx * nu + zone.dy * v);
    if (!inDriveway(nx, nz) && !buildingAt(nx, nz) && !insideCarriageway(nx, nz, 0.1)) return { x: nx, z: nz };
  }
  return null;
}
//: The wall a front door needs beside a garage: the leaf and clear wall either side.
const GARAGE_DOOR_ROOM_M = 1.05 + 2 * 0.35;
//: The compass bearing of a footprint edge's outward side, from the footprint itself.
function outwardBearing(way, a, b, fallback) {
  const [ax, ay] = xy(a[0], a[1]), [bx, by] = xy(b[0], b[1]);
  const L = Math.hypot(bx - ax, by - ay) || 1;
  let nx = (by - ay) / L, ny = -(bx - ax) / L;          // right of a->b, in x east / y north
  const mx = (ax + bx) / 2 + nx * 0.4, my = (ay + by) / 2 + ny * 0.4;
  // Outward is the side that is not inside the footprint.
  const ring = way.points.map((p) => xy(p[0], p[1]));
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > my) !== (yj > my) && mx < (xj - xi) * (my - yi) / ((yj - yi) || 1e-9) + xi) inside = !inside;
  }
  if (inside) { nx = -nx; ny = -ny; }
  const bearing = (Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360;
  return Number.isFinite(bearing) ? bearing : fallback;
}
// ---- garages the photograph shows ----
//
// A garage a photographed front shows is drawn whether or not the city recorded a dropped kerb in
// front of it -- the photograph is the better witness of the two -- and where the fit is sure
// enough of it (medium or high: coarse_openings.py), the kerb is cut for it (photoKerbCuts): a
// driveway let down to the gutter, not a gap knocked out of the kerb. On the photographed wall a
// garage the kerb put where the photograph shows a garage of its own, or a way in on foot, goes.
const PHOTO_GARAGE_CERTAINTY = new Set(["medium", "high"]);
//: Where an opening of a fitted front lands on the building's own outline: the footprint edge the
//: front lies along, the fraction along it of the opening's centre, and that edge's length.
function fitOpeningOnOutline(way, fit, o) {
  if (!fit?.a || !fit?.b || ![o.u, o.w].every(Number.isFinite)) return null;
  const [fax, fay] = xy(...fit.a), [fbx, fby] = xy(...fit.b);
  const span = Math.hypot(fbx - fax, fby - fay);
  if (span < 1) return null;
  const tx = (fbx - fax) / span, ty = (fby - fay) / span;
  const px = fax + tx * (o.u + o.w / 2), py = fay + ty * (o.u + o.w / 2);
  let best = null;
  for (let i = 0; i + 1 < way.points.length; i += 1) {
    const a = way.points[i], b = way.points[i + 1];
    const [ax, ay] = xy(a[0], a[1]), [bx, by] = xy(b[0], b[1]);
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1.2 || Math.abs(((bx - ax) * tx + (by - ay) * ty) / L) < 0.9) continue;
    const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (L * L);
    if (t < 0 || t > 1) continue;
    const d = Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / L;
    if (d < 1.5 && (!best || d < best.d)) best = { d, a, b, t, L };
  }
  return best;
}
function addPhotoGarages(ways) {
  const stats = { photo: 0, kerbReplaced: 0 };
  for (const way of ways) {
    if (way.kind !== "building" || !way.covered || !way.points) continue;
    const fit = frontageFitFor(way);
    if (!fit) continue;
    const photo = [], onFoot = [];
    for (const o of fit.openings || []) {
      const at = fitOpeningOnOutline(way, fit, o);
      if (!at) continue;
      if (o.role === "entrance") onFoot.push({ ...at, w: o.w });
      if (o.role !== "garage" || !PHOTO_GARAGE_CERTAINTY.has(o.role_certainty) || !Number.isFinite(o.h)) continue;
      const w = Math.min(o.w, at.L * 0.9);
      photo.push({
        a: at.a, b: at.b, w, L: at.L,
        t: Math.min(Math.max(at.t, w / 2 / at.L), 1 - w / 2 / at.L),
        n: outwardBearing(way, at.a, at.b, 0), h: Math.min(3.3, Math.max(1.9, o.h)),
        // A grid of panels where the photograph showed one, else the commonest door in the city:
        // long horizontal sections. Never a guessed wood stain over a photographed door.
        s: o.design?.panel_style === "sectional_grid" ? 0 : 1,
        colour: /^#[0-9a-f]{6}$/i.test(o.design?.colour || "") ? o.design.colour : undefined,
        photo: true, certainty: o.role_certainty, id: o.id,
      });
    }
    if (!photo.length && !onFoot.length) continue;
    const sameWall = (g, k) => g.a[0] === k.a[0] && g.a[1] === k.a[1] && g.b[0] === k.b[0] && g.b[1] === k.b[1];
    const overlaps = (g, k) => sameWall(g, k) && Math.abs(g.t - k.t) * k.L < ((g.w || 2.6) + k.w) / 2;
    const kept = (way.garages || []).filter((g) => {
      const [ax, ay] = xy(g.a[0], g.a[1]), [bx, by] = xy(g.b[0], g.b[1]);
      const L = Math.hypot(bx - ax, by - ay);
      const clash = [...photo, ...onFoot].some((k) => overlaps({ ...g, L }, k));
      if (clash) stats.kerbReplaced += 1;
      return !clash;
    });
    way.garages = [...kept, ...photo.map(({ L, ...g }) => g)];
    stats.photo += photo.length;
  }
  return stats;
}
const garageStats = normaliseGarages(DATA.ways || []);
Object.assign(garageStats, addPhotoGarages(DATA.ways || []));
const unnamedShops = inferUnnamedShops(DATA.ways || []);
for (const way of DATA.ways || []) {
  const edit = way.kind === "building" && EXTERIOR_EDITS.get(String(way.osm_id));
  if (edit?.wall?.a && edit?.wall?.b) way.exteriorEdit = edit;
}
window.kerbsideShops = () => ({ unnamed: unnamedShops, textures: STOREFRONT_TEXTURES.size });
window.kerbsideGarages = () => ({ ...garageStats });

const facadeQueue = [];
let facadeInFlight = 0;
const facadeStats = { walls: FACADES.walls.length, live: 0, loaded: 0, retired: 0, failed: 0 };

function retireFacade(i) {
  const panel = facadeLive.get(i);
  if (!panel) return;
  facadeLive.delete(i);
  groups.facades.remove(panel);
  const k = facadePanels.indexOf(panel);
  if (k >= 0) facadePanels.splice(k, 1);
  if (panel.material.map) panel.material.map.dispose();
  panel.material.dispose();
  panel.geometry.dispose();
  panel.userData.retired = true;
  facadeStats.retired += 1;
}

async function loadFacadeTexture(panel) {
  const wall = panel.userData.facade;
  try {
    const texture = await facadeLoader.loadAsync(asset(`facades/${wall.c}/${wall.t}`));
    if (panel.userData.retired) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    panel.material.map = texture;
    panel.material.needsUpdate = true;
    panel.visible = true;
    facadeStats.loaded += 1;
    // Faded in rather than switched on, so a photograph arriving reads as the wall coming into
    // focus and not as a picture popping up in front of it; then opaque, out of the sorted queue.
    const from = performance.now();
    const fade = () => {
      if (panel.userData.retired) return;
      const k = Math.min(1, (performance.now() - from) / FACADE_FADE_MS);
      panel.material.opacity = k;
      if (k < 1) { requestAnimationFrame(fade); return; }
      panel.material.transparent = false;
      panel.material.needsUpdate = true;
    };
    requestAnimationFrame(fade);
  } catch (err) {
    wall._failed = true;
    facadeStats.failed += 1;
    retireFacade(wall._i);
  }
}

function pumpFacadeQueue() {
  while (facadeInFlight < FACADE_TEXTURE_CONCURRENCY && facadeQueue.length) {
    const panel = facadeQueue.shift();
    if (panel.userData.retired) continue;
    facadeInFlight += 1;
    loadFacadeTexture(panel).finally(() => { facadeInFlight -= 1; pumpFacadeQueue(); });
  }
}

function updateFacadeStreaming(focus, eyeHeight) {
  const near = eyeHeight > FACADE_HIGH_M || !FACADE_PHOTOS ? 0 : FACADE_NEAR_M;
  const far = near ? FACADE_FAR_M : 0;
  for (const [i, panel] of facadeLive) {
    const wall = panel.userData.facade;
    if (Math.hypot(wall._x - focus.x, wall._z - focus.z) > far) retireFacade(i);
  }
  if (near) {
    const wanted = [];
    const reach = Math.ceil(near / FACADE_CELL_M);
    const cx = Math.floor(focus.x / FACADE_CELL_M), cz = Math.floor(focus.z / FACADE_CELL_M);
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dz = -reach; dz <= reach; dz += 1) {
        for (const wall of facadeGrid.get(`${cx + dx}:${cz + dz}`) || []) {
          if (wall._failed || facadeLive.has(wall._i)) continue;
          const d = Math.hypot(wall._x - focus.x, wall._z - focus.z);
          if (d <= near) wanted.push([d, wall]);
        }
      }
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, wall] of wanted) {
      if (facadeLive.size >= FACADE_MAX_LIVE) break;
      const panel = facadePanel(wall);
      if (!panel) { wall._failed = true; continue; }
      panel.visible = false;          // until its photograph has arrived
      facadeLive.set(wall._i, panel);
      groups.facades.add(panel);
      facadePanels.push(panel);
      facadeQueue.push(panel);
    }
    facadeQueue.sort((a, b) => Math.hypot(a.userData.facade._x - focus.x, a.userData.facade._z - focus.z)
      - Math.hypot(b.userData.facade._x - focus.x, b.userData.facade._z - focus.z));
    pumpFacadeQueue();
  }
  facadeStats.live = facadeLive.size;
}
window.kerbsideFacades = () => ({ ...facadeStats, queued: facadeQueue.length, inFlight: facadeInFlight });

// ---- what the city recorded ----
//
// Curb lines and curb ramps as San Francisco holds them, drawn over the reconstruction so the
// two can be compared by eye. This is not a prettier version of the streets layer: it is a
// different claim about the same ground, from a different source, and where the two disagree
// that is worth being able to see.
registerLazyLayer("official", () => {
  const official = OFFICIAL_GEOMETRY;
  for (const line of official.curb_lines || []) {
    const points = line.p.map(([lon, lat]) => v3(lon, lat, 0.16));
    if (points.length < 2) continue;
    groups.official.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9 })));
  }
  // Ramps the inventory has flagged are drawn apart from the rest. A ramp whose lip the city
  // has already recorded as too high is exactly where a measured kerb height is worth checking.
  const plain = [];
  const flagged = [];
  for (const ramp of official.curb_ramps || []) {
    (ramp.f && ramp.f.length ? flagged : plain).push(v3(ramp.p[0], ramp.p[1], 0.2));
  }
  for (const [points, colour, size] of [[plain, 0x7fd4ff, 1.6], [flagged, 0xffb454, 2.4]]) {
    if (!points.length) continue;
    groups.official.add(new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: true })));
  }
  const note = document.getElementById("officialnote");
  const summary = (official.summary || {}).by_class || {};
  const walk = summary.sidewalk_width;
  if (note) {
    const counts = (DATA.official || {}).counts || {};
    note.innerHTML =
      `<b>Official geometry</b> — ${(counts["with right of way"] || 0).toLocaleString()} ways ` +
      `carry San Francisco's recorded right of way and ` +
      `${(counts["with surveyed footway"] || 0).toLocaleString()} its 2014 footway survey. ` +
      `Curb heights are ours: no city record publishes one, so ` +
      `${(counts["with measured curb"] || 0).toLocaleString()} ways use the lidar measured on ` +
      `that block and the rest fall back to the corridor median. ` +
      (walk ? `Against the city survey our footway widths run ` +
              `${walk.bias_m >= 0 ? "+" : ""}${walk.bias_m.toFixed(2)} m on average ` +
              `(median ${walk.median_error_m >= 0 ? "+" : ""}${walk.median_error_m.toFixed(2)} m, ` +
              `n=${walk.n.toLocaleString()}). ` : "") +
      `The right-of-way layer is a 2014 analysis the city says is not at engineering accuracy.`;
  }
});

// The grid the facade work is done in: 250 m squares, the one that has been photographed
// picked out from the ones that have not. A square with a lot of buildings and a lot of frames
// and no textures is simply the next one to run.
registerLazyLayer("chunks", () => {
for (const chunk of FACADES.grid || []) {
  const corners = [[chunk.w, chunk.s], [chunk.e, chunk.s], [chunk.e, chunk.n],
                   [chunk.w, chunk.n], [chunk.w, chunk.s]];
  const done = chunk.d === 1;
  const material = new THREE.LineBasicMaterial({
    color: done ? 0x6ff0b4 : 0x4d6b78,
    transparent: true,
    // Readiness is how photographable the square is; the faint ones are the ones with nothing
    // standing in them or nobody driving through them.
    opacity: done ? 0.95 : Math.min(0.5, 0.10 + chunk.r / 900),
  });
  const points = corners.map(([lon, lat]) => v3(lon, lat, 3));
  groups.chunks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
}
});


// ---- walls, tunnels and car parks ----
//
// Three things the corridor has that the map did not draw. A wall is not a fence: the fences
// come from the city's property lines and are wood and chainlink, and the Presidio's walls are
// coursed stone and brick that hold back a bank. A tunnel is not a dim road: Broadway and
// Stockton go through Russian Hill and Nob Hill in a bore with a portal at each end. A car park
// is not a building and not a point: it is a slab of asphalt with bays painted on it.

//: The ground under a point, whichever surface that is. Pavement knows its own top; anything
//: else is at the base. A wall standing on a footway starts at the footway.
function groundTopAt(x, z) {
  const top = pavementTopAt(x, z);
  return top === undefined ? 0.0 : top;
}

//: Coursed rubble: irregular blocks in staggered rows, mortar between, the Presidio's kind.
function stoneWallTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Cool charcoal mortar and neutral blue-grey blocks keep a retaining wall visibly separate
  // from the warmer green-grey scored concrete used for sidewalks.
  ctx.fillStyle = "#454b4f";                                // the mortar
  ctx.fillRect(0, 0, size, size);
  const rows = 6;
  const rowH = size / rows;
  for (let r = 0; r < rows; r += 1) {
    let x = -random(r * 17) * 40;
    while (x < size) {
      const w = 28 + random(r * 31 + x) * 40;
      const tone = 104 + random(r * 7 + x * 3) * 48;
      ctx.fillStyle = `rgb(${tone - 5},${tone},${tone + 5})`;
      ctx.fillRect(x + 2, r * rowH + 2, w - 4, rowH - 4);
      // A face that is not flat: a darker lower edge and a lit top edge on each block.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(x + 2, r * rowH + rowH - 6, w - 4, 3);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(x + 2, r * rowH + 2, w - 4, 2);
      x += w;
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

//: Running bond brick: 215 x 65 mm bricks, half-offset per course.
function brickWallTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b9ac98";                                // the mortar
  ctx.fillRect(0, 0, size, size);
  const courses = 12;
  const h = size / courses;
  const w = size / 4;
  for (let c = 0; c < courses; c += 1) {
    const offset = c % 2 ? w / 2 : 0;
    for (let x = -w; x < size + w; x += w) {
      const tone = random(c * 13 + x) ;
      ctx.fillStyle = tone < 0.5 ? "#8d4a3a" : tone < 0.8 ? "#9a5744" : "#7d4033";
      ctx.fillRect(x + offset + 2, c * h + 2, w - 4, h - 3);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const WALL_TEXTURES = { stone: null, brick: null };
function wallMaterialFor(way) {
  const brick = /brick/i.test(way.material || "");
  const key = brick ? "brick" : "stone";
  if (!WALL_TEXTURES[key]) WALL_TEXTURES[key] = brick ? brickWallTexture() : stoneWallTexture();
  return new THREE.MeshStandardMaterial({
    map: WALL_TEXTURES[key], color: 0xffffff, roughness: 0.94, metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

//: How thick a wall is drawn. A retaining wall in the Presidio is a good deal thicker than
//: this at its base, but the map sees only its face.
const WALL_THICKNESS_M = 0.36;

function addWall(way) {
  // A wall is a vertical strip that follows the ground, with a face on each side and a coping
  // along the top. Each vertex takes the ground under it, so a wall that runs from a footway
  // onto grass steps with the surface rather than floating over one or sinking into the other.
  const dense=densifyWay(way.points,.75);
  const pts = dense.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  if (pts.length < 2) return null;
  const h = way.height_m || 1.2;
  const positions = [];
  const uvs = [];
  const index = [];
  let along = 0;
  const push = (x, y, z, u, v) => { positions.push(x, y, z); uvs.push(u, v); };
  for (let i = 1; i < pts.length; i += 1) {
    // A long wall can leave the cut. Replace only its covered pieces with the
    // dedicated retaining wall, rather than accepting/rejecting the whole way.
    if(insideCutBand({points:[dense[i-1],dense[i]]}))continue;
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const span = Math.hypot(bx - ax, bz - az);
    if (span < 0.05) continue;
    const nx = -(bz - az) / span * WALL_THICKNESS_M / 2;
    const nz = (bx - ax) / span * WALL_THICKNESS_M / 2;
    const ga = groundTopAt(ax, az);
    const gb = groundTopAt(bx, bz);
    const u0 = along / 1.0;
    const u1 = (along + span) / 1.0;
    // Two faces and the top, as quads; the metres along the wall are the texture's u.
    for (const sgn of [1, -1]) {
      const base = positions.length / 3;
      push(ax + nx * sgn, ga, az + nz * sgn, u0, 0);
      push(bx + nx * sgn, gb, bz + nz * sgn, u1, 0);
      push(bx + nx * sgn, gb + h, bz + nz * sgn, u1, h);
      push(ax + nx * sgn, ga + h, az + nz * sgn, u0, h);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const base = positions.length / 3;
    push(ax + nx, ga + h, az + nz, u0, 0);
    push(bx + nx, gb + h, bz + nz, u1, 0);
    push(bx - nx, gb + h, bz - nz, u1, 0.4);
    push(ax - nx, ga + h, az - nz, u0, 0.4);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    along += span;
  }
  if (!index.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, wallMaterialFor(way));
  mesh.userData.surface = "wall";
  return mesh;
}

//: A tunnel bore: an arch over the carriageway, and a portal face at each end.
const TUNNEL_CROWN_M = 6.4;         // road surface to the crown of the arch
const TUNNEL_WALL_M = 4.2;          // the vertical wall before the arch springs
const TUNNEL_SHELL_M = 0.6;         // the lining's thickness
const TUNNEL_PORTAL_DEPTH_M = 1.4;  // the headwall at each mouth
const TUNNEL_PORTAL_MARGIN_M = 2.0; // how far the headwall reaches past the bore each side
//: The headwall is a design: the arch, its lining and a parapet over it. The hill behind it is
//: measured and stands as high as the lidar says; the headwall does not change height from
//: one end of a tunnel to the other because the hill does.
const TUNNEL_PARAPET_M = 1.2;
//: A portal wider than this is two bores with a pier between them -- no road arch spans more
//: -- and Broadway's is 24 m between its walls.
const TUNNEL_TWIN_MIN_M = 16.0;
const TUNNEL_PIER_M = 1.2;
//: No single road bore is wider than this; Broadway's two are about ten metres each.
const TUNNEL_BORE_MAX_M = 11.0;
//: The bore's floor at the mouth, just over the approach road's surface; it descends from
//: there (TUNNEL_GRADE). It used to be a slab 0.34 m thick standing over the surface street
//: the flat model drew across the mouth; that street is now on the far side of the mouth
//: (split_tunnel_approaches).
const TUNNEL_FLOOR_M = 0.06;    // ROAD_TOP_M: the approach road runs straight onto it
//: The bore runs through the hill at the level the lidar read for its road: the ground
//: (TERRAIN) less the cover the portal profile measured over the road at each station
//: (way.tunnel_cover). Where no cover profile exists the floor runs straight from one mouth's
//: ground to the other's. Under thin cover near a mouth the roof is held TUNNEL_ROOF_UNDER_M
//: below the ground so the hill does not show through the arch from inside.
const TUNNEL_ROOF_UNDER_M = 0.4;
const TUNNEL_STATION_M = 3.0;
//: The raised walkway along each wall of a bore: the maintenance and refuge walk every road
//: tunnel in the city has, a kerb high and a person wide.
const TUNNEL_WALK_W_M = 1.0;
const TUNNEL_WALK_H_M = 0.3;
//: The lighting: a continuous strip at the crown.
const TUNNEL_LIGHT_W_M = 0.3;
//: Luminaires at the crown, as fittings rather than as one lit seam. A tunnel's ceiling is a
//: run of separate lamps every few metres and the gaps between them are most of what tells a
//: driver how fast they are going; drawn as a continuous strip it reads as a lit slot and the
//: bore has no length to it.
const TUNNEL_LAMP_M = 1.4;
const TUNNEL_LAMP_GAP_M = 7.6;
//: The roadway inside the bore. It was never drawn: the markings were painted at 12 mm over
//: whatever the bore's floor happened to be, so the surface under them was the lining's own
//: concrete and the road stopped being a road at the portal.
const TUNNEL_ROAD_Y_M = 0.006;
//: And its edge lines, which is what continues the road through: a carriageway is its centre
//: line and its two edges, and inside the tunnel only the centre was carried in.
const TUNNEL_EDGE_INSET_M = 0.28;
const TUNNEL_ARCH_SEGMENTS = 14;

//: The bore's inner section at one station: across (u, positive right) and up (y) from the
//: floor, the same number of points at every station so sections can be stitched. The roof
//: is clipped to `cap` (metres above the floor) where it may not rise: a flat roof.
function tunnelSectionPoints(half, cap = Infinity, crown = TUNNEL_CROWN_M, spring = TUNNEL_WALL_M) {
  const out = [];
  const wall = Math.min(spring, cap);
  out.push([-half, 0], [-half, wall]);
  for (let i = 1; i < TUNNEL_ARCH_SEGMENTS; i += 1) {
    const t = Math.PI * (1 - i / TUNNEL_ARCH_SEGMENTS);
    out.push([half * Math.cos(t), Math.min(cap, spring + (crown - spring) * Math.sin(t))]);
  }
  out.push([half, wall], [half, 0]);
  return out;
}

//: A surface swept along the bore: `section(station)` gives the [u, y] points at each station
//: (all the same length), placed in that station's frame (right of travel, up). Returns a
//: mesh, or null.
function sweepAlongBore(stations, section, material, surface) {
  const position = [];
  const uv = [];
  const index = [];
  let rows = 0, previousBase = null;
  let count = null;
  for (const st of stations) {
    const pts = section(st);
    if (!pts || !pts.length) { previousBase=null; continue; }
    if (count === null) count = pts.length;
    if (pts.length !== count) { previousBase=null; continue; }
    const base=position.length/3;
    for (let i = 0; i < pts.length; i += 1) {
      const [u, y] = pts[i];
      position.push(st.x + st.rx * u, st.floor + y, st.z + st.rz * u);
      uv.push(i / (pts.length - 1), st.s / 4);
    }
    rows += 1;
    if (previousBase !== null && !st.breakBefore) for (let i = 1; i < count; i += 1) {
      const a = previousBase + i - 1, b = previousBase + i;
      const c = base + i - 1, d = base + i;
      index.push(a, c, b, b, c, d);
    }
    previousBase=base;
  }
  if (rows < 2 || !index.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.surface = surface;
  return mesh;
}

function tunnelPaintStations(stations, dash, gap) {
  if(stations.length<2)return [];
  const interpolate=(s)=>{
    let i=1;while(i<stations.length-1 && stations[i].s<s)i++;
    const a=stations[i-1],b=stations[i],t=(s-a.s)/(b.s-a.s || 1),out={...a,s};
    for(const key of ["x","z","floor","ground","ux","uz","rx","rz"])
      out[key]=a[key]+(b[key]-a[key])*t;
    out.cap=Number.isFinite(a.cap) && Number.isFinite(b.cap) ? a.cap+(b.cap-a.cap)*t : Math.min(a.cap,b.cap);
    return out;
  };
  const out=[],end=stations[stations.length-1].s;
  for(let start=stations[0].s;start<end;start+=dash+gap) {
    const stop=Math.min(end,start+dash),first=interpolate(start);first.breakBefore=true;
    out.push(first,...stations.filter(st=>st.s>start && st.s<stop),interpolate(stop));
  }
  return out;
}

//: The stations of a bore: every TUNNEL_STATION_M along its centreline, with the frame, the
//: floor's depth and the roof's cap at each.
//: Cover over the road at a distance along the bore, from the lidar profile; null without one.
function tunnelCoverAlong(cover, s) {
  if (!Array.isArray(cover) || cover.length < 2) return null;
  const rows = cover.filter((r) => Array.isArray(r) && r.length >= 2 && Number.isFinite(r[1]));
  if (rows.length < 2) return null;
  if (s <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i += 1) {
    if (s <= rows[i][0]) {
      const [s0, c0] = rows[i - 1], [s1, c1] = rows[i];
      return s1 > s0 ? c0 + (c1 - c0) * (s - s0) / (s1 - s0) : c1;
    }
  }
  return rows[rows.length - 1][1];
}

//: The stations of a bore: every TUNNEL_STATION_M along its centreline, with the frame, the
//: floor's height and the roof's cap at each. The floor is the road the lidar fitted at the
//: two mouths (tunnel_road_z), carried straight between them as the cover was measured
//: against; without that, the ground less the measured cover; without either, straight
//: between the ground at the mouths. The cap keeps the roof under the ground where the cover
//: is thinner than the arch.
function tunnelStations(centre, cover = null, roadZ = null, design = null) {
  const local = centre.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  const total = wayLength(centre);
  const stations = [];
  const [sx0, sz0] = local[0], [ex0, ez0] = local[local.length - 1];
  const measured = roadZ && Number.isFinite(roadZ.start) && Number.isFinite(roadZ.end);
  const groundStart = measured ? roadZ.start : groundLiftAt(sx0, sz0);
  const groundEnd = measured ? roadZ.end : groundLiftAt(ex0, ez0);
  let acc = 0;
  for (let i = 1; i < local.length; i += 1) {
    const [ax, az] = local[i - 1];
    const [bx, bz] = local[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (!(seg > 0)) continue;
    const ux = (bx - ax) / seg, uz = (bz - az) / seg;
    const steps = Math.max(1, Math.ceil(seg / TUNNEL_STATION_M));
    for (let k = i === 1 ? 0 : 1; k <= steps; k += 1) {
      const t = k / steps;
      const s = acc + seg * t;
      const x = ax + ux * seg * t, z = az + uz * seg * t;
      // The hill over the bore is the grid's, not the cut-corrected ground: the correction
      // is for what stands in the cut, and the roof under a deck is under the deck.
      const ground = terrainHeightAt(x, z);
      const c = tunnelCoverAlong(cover, s);
      // The road under the measured cover; at the mouths it meets the approach road.
      const straight = groundStart + (groundEnd - groundStart) * (total > 0 ? s / total : 0);
      // The two Oakland-Alameda immersed tubes have no meaningful lidar "cover" across the
      // estuary.  A smooth, explicitly inferred sag keeps both portals at their approach-road
      // elevation and puts the middle safely below the measured water surface.  This is visual
      // geometry only; neither the low point nor the curve is exported as a measurement.
      const immersed = design && design.kind === "immersed_tube";
      const low = immersed ? SEA_SURFACE_M - design.floor_below_water_m : 0;
      const sag = immersed ? Math.sin(Math.PI * s / Math.max(total, 1)) ** 2 : 0;
      const roadLevel = immersed ? straight + Math.min(0, low - straight) * sag
        : (!measured && c !== null && c > 0 ? Math.min(ground - c, straight + 12) : straight);
      const floor = TUNNEL_FLOOR_M + roadLevel;
      const headroom = ground - floor - TUNNEL_ROOF_UNDER_M;
      stations.push({
        s, x, z, ux, uz, rx: -uz, rz: ux, floor, ground,
        cap: !immersed && Number.isFinite(headroom) && headroom < TUNNEL_CROWN_M
          ? Math.max(TUNNEL_WALL_M, headroom) : Infinity,
      });
    }
    acc += seg;
  }
  return stations;
}
function tunnelStubs(points) {
  // The first and last TUNNEL_STUB_M of a tunnel way, from each mouth inward.
  const length = wayLength(points);
  if (length <= TUNNEL_STUB_M * 2 + 1) return [points];
  return [trimWayEnds(points, 0, length - TUNNEL_STUB_M),
          trimWayEnds(points, length - TUNNEL_STUB_M, 0)];
}

function tunnelArchShape(halfWidth, outer, crown = TUNNEL_CROWN_M, spring = TUNNEL_WALL_M) {
  const w = halfWidth + (outer ? TUNNEL_SHELL_M : 0);
  const wall = spring;
  crown += outer ? TUNNEL_SHELL_M : 0;
  const shape = new THREE.Shape();
  shape.moveTo(-w, outer ? -0.3 : 0);
  shape.lineTo(w, outer ? -0.3 : 0);
  shape.lineTo(w, wall);
  // The arch: a half-ellipse from wall height to the crown.
  const segments = 14;
  for (let i = 1; i <= segments; i += 1) {
    const t = Math.PI * (i / segments);
    shape.lineTo(w * Math.cos(t), wall + (crown - wall) * Math.sin(t));
  }
  shape.lineTo(-w, outer ? -0.3 : 0);
  return shape;
}

//: How far along a polyline (metres) the point nearest to a lon/lat lies.
function alongOfPoint(points, lonLat) {
  const [px, py] = xy(lonLat[0], lonLat[1]);
  let best = null;
  let along = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = xy(points[i - 1][0], points[i - 1][1]);
    const [bx, by] = xy(points[i][0], points[i][1]);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (best === null || d < best.d) best = { d, s: along + Math.sqrt(len2) * t };
    along += Math.sqrt(len2);
  }
  return best ? best.s : 0;
}

//: The bore between the lidar's two mouths, as the piece of the way between them.
function tunnelCoveredPoints(way, renderPoints) {
  const mouths = way.tunnel_mouths || {};
  const total = wayLength(renderPoints);
  const from = mouths.start ? Math.max(0, alongOfPoint(renderPoints, mouths.start)) : 0;
  const to = mouths.end ? Math.min(total, alongOfPoint(renderPoints, mouths.end)) : total;
  if (to - from < 2 * TUNNEL_STUB_MAX_M * 0.3) return renderPoints;
  return trimWayEnds(renderPoints, from, total - to);
}

//: The portal's width: the span between the city's kerb lines on the approach outside the
//: mouth, where the retaining walls of the cut stand. Null where the city drew none.
function tunnelApproachWidth(mouth, outward) {
  const approach = tunnelApproach(mouth, outward);
  return approach ? approach.width : null;
}

//: The cut on the approach outside a mouth, from the city's kerb lines: its width, and how
//: far its midline stands to the left of the way (inward travel). OpenStreetMap's tunnel way
//: for Broadway is the westbound bore's own line, 6 m off the axis of the portal; drawn about
//: the way, the north bore stood 3 m outside the north retaining wall of the cut. The
//: structure is drawn about the cut's midline instead.
function tunnelApproach(mouth, outward) {
  if (!officialCurbGrid.size) return null;
  const spans = [];
  const mids = [];
  const ux = outward.x, uz = outward.z;
  const nx = uz, nz = -ux;
  for (let t = TUNNEL_APPROACH_FROM_M; t <= TUNNEL_APPROACH_TO_M; t += 2) {
    const x = mouth.x + ux * t, z = mouth.z + uz * t;
    const hits = rayCurbIntersections(x, z, nx, nz, 22, officialCurbGrid);
    const a = hits.filter((v) => v < -1.2).pop();
    const b = hits.find((v) => v > 1.2);
    if (a === undefined || b === undefined || b - a > 40) continue;
    spans.push(b - a);
    mids.push((a + b) / 2);
  }
  if (spans.length < 3) return null;
  spans.sort((p, q) => p - q);
  mids.sort((p, q) => p - q);
  // n is to the right of inward travel (outward = -inward; n = (uz, -ux) of outward), so the
  // midline's offset to the left of the way is minus the median along n.
  return { width: spans[Math.floor(spans.length / 2)], left: -mids[Math.floor(mids.length / 2)] };
}

//: The tunnel's axis: the covered piece of the way moved sideways onto the midline of the
//: cut the city's kerbs draw on the approach, where they draw one. The way is one bore's
//: line where the tunnel has two.
function tunnelAxis(way, covered) {
  if (!covered || covered.length < 2) return covered;
  if (way._tunnelAxisLeft !== undefined) {
    return way._tunnelAxisLeft ? offsetWay(covered, way._tunnelAxisLeft) : covered;
  }
  const lefts = [];
  const local = covered.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  for (const [a, b] of [[local[0], local[1]], [local[local.length - 1], local[local.length - 2]]]) {
    const dx = a[0] - b[0], dz = a[1] - b[1];
    const len = Math.hypot(dx, dz) || 1;
    const found = tunnelApproach({ x: a[0], z: a[1] }, { x: dx / len, z: dz / len });
    if (found) lefts.push(found.left);
  }
  const left = lefts.length ? lefts.reduce((p, q) => p + q, 0) / lefts.length : 0;
  way._tunnelAxisLeft = Math.abs(left) > 0.3 ? left : 0;
  if (way._tunnelAxisLeft) way.tunnel_axis_shift_m = +left.toFixed(2);
  return way._tunnelAxisLeft ? offsetWay(covered, way._tunnelAxisLeft) : covered;
}

//: Each bore's stations (tunnelStations), for the walker's feet: inside a bore the ground is
//: the bore's floor, which goes down under the flat world and comes back up at the far mouth.
const tunnelBores = [];

// A point can have a street above it and a tunnel below it. Keep the geometric
// query separate from selecting the surface occupied by the walker/camera.
function tunnelSurfaceAt(x, z, referenceY = null, radius = 0, onlyBore = null) {
  let best = null, bestScore = Infinity;
  for (const bore of tunnelBores) {
    if (onlyBore && bore !== onlyBore) continue;
    const { stations, half } = bore;
    if (stations.length < 2) continue;
    if(!bore._surfaceBox) {
      const xs=stations.map(st=>st.x),zs=stations.map(st=>st.z);
      bore._surfaceBox={minX:Math.min(...xs)-half,maxX:Math.max(...xs)+half,
        minZ:Math.min(...zs)-half,maxZ:Math.max(...zs)+half};
    }
    const box=bore._surfaceBox;
    if(x<box.minX || x>box.maxX || z<box.minZ || z>box.maxZ)continue;
    const first=stations[0],last=stations[stations.length-1];
    // End planes, not circular end caps: nothing beyond a portal is tunnel floor.
    if ((x-first.x)*first.ux+(z-first.z)*first.uz < -1e-6
        || (x-last.x)*last.ux+(z-last.z)*last.uz > 1e-6) continue;
    for (let i=1;i<stations.length;i++) {
      const a=stations[i-1],b=stations[i],dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
      if (!(len2>0)) continue;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len2));
      const distance=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
      if (distance>half-radius+1e-6) continue;
      const floor=a.floor+(b.floor-a.floor)*t;
      const walkWidth=bore.walkWidth ?? 0,walkHeight=bore.walkHeight ?? 0;
      const y=floor+(distance>half-walkWidth ? walkHeight : (bore.roadOffset || 0));
      const delta=Number.isFinite(referenceY) ? Math.abs(y-referenceY) : 0;
      if (Number.isFinite(referenceY) && delta>1.1) continue;
      const score=delta*100+distance;
      if (score>=bestScore) continue;
      bestScore=score;
      best={y,floor,bore,distance,along:a.s+(b.s-a.s)*t,
        clearance:Math.min(a.cap,b.cap,bore.crown || TUNNEL_CROWN_M)};
    }
  }
  return best;
}

function walkerFeetY() {
  try {
    return Number.isFinite(avatar.position.y) ? avatar.position.y-AVATAR_STAND_Y : null;
  } catch { return null; } // isolated geometry probes, or before the walker exists
}

function tunnelWalkMeshes(solids=false) {
  const groups=new Set(tunnelBores.map(b=>b.group).filter(Boolean));
  const surfaces=solids ? ["tunnel","tunnel_shell","tunnel_portal","tunnel_cut_wall"]
    : ["tunnel_floor","tunnel_road","tunnel_walk"];
  return [...groups].flatMap(g=>g.children.filter(o=>surfaces.includes(o.userData.surface)));
}

function occupiedTunnelAt(x,z,referenceY,radius=0) {
  const guest=typeof guestUnder === "function" ? guestUnder(x,z) : null;
  if(guest?.ready && guest.api.tunnelSurfaceAt) {
    const [gx,gz]=hostToGuest(guest,x,z);
    const info=guest.api.tunnelSurfaceAt(gx,gz,Number.isFinite(referenceY) ? referenceY-guest.oy : null,radius);
    return info ? {...info,y:info.y+guest.oy,floor:info.floor+guest.oy} : null;
  }
  return tunnelSurfaceAt(x,z,referenceY,radius);
}

function pointInTunnelVoid(x,y,z) {
  const shell=typeof TUNNEL_SHELL_M === "number" ? TUNNEL_SHELL_M : 0;
  const hit=occupiedTunnelAt(x,z,null,-shell);if(!hit)return false;
  const ratio=Math.min(1,hit.distance/(hit.bore.half+shell)),crown=(hit.bore.crown || TUNNEL_CROWN_M)+shell;
  const spring=(hit.bore.spring || TUNNEL_WALL_M)+shell;
  const roof=hit.floor+Math.min(hit.clearance+shell,spring+(crown-spring)*Math.sqrt(1-ratio*ratio));
  return y>hit.floor-.04 && y<roof+.015;
}

const TUNNEL_VOID_MAX_SEGMENTS=256;
const tunnelVoidInverse=new THREE.Matrix4();
function tunnelVoidSegments(bore) {
  // Simplify only the clipping lookup, NOT the rendered mesh or its triangles.
  // Every original station must agree with the interpolation within four mm.
  const out=[],stations=bore.stations;
  let start=0;
  const fits=(end)=>{
    const a=stations[start],b=stations[end],length=b.s-a.s;
    for(let i=start+1;i<end;i++) {
      const p=stations[i],t=(p.s-a.s)/length;
      const xyError=Math.hypot(p.x-a.x-(b.x-a.x)*t,p.z-a.z-(b.z-a.z)*t);
      const floorError=Math.abs(p.floor-a.floor-(b.floor-a.floor)*t);
      const ac=Math.min(a.cap,bore.crown),bc=Math.min(b.cap,bore.crown);
      const capError=Math.abs(Math.min(p.cap,bore.crown)-ac-(bc-ac)*t);
      if(Math.max(xyError,floorError,capError)>.004)return false;
    }
    return true;
  };
  while(start<stations.length-1) {
    let end=start+1;
    while(end+1<stations.length && fits(end+1))end++;
    const shell=typeof TUNNEL_SHELL_M === "number" ? TUNNEL_SHELL_M : 0;
    const a={...stations[start],cap:stations[start].cap+shell},b={...stations[end],cap:stations[end].cap+shell};
    const half=bore.half+shell;
    out.push({a,b,first:stations[0],last:stations[stations.length-1],half,crown:bore.crown+shell,spring:bore.spring+shell,
      minX:Math.min(a.x,b.x)-half,maxX:Math.max(a.x,b.x)+half,
      minZ:Math.min(a.z,b.z)-half,maxZ:Math.max(a.z,b.z)+half,
      minY:Math.min(a.floor,b.floor)-.05,maxY:Math.max(a.floor,b.floor)+bore.crown+shell+.05});
    start=end;
  }
  return out;
}
function installTunnelVoidCuts(group, allSurfaces=false) {
  if(!tunnelBores.length)return;
  const segments=[];
  for(const bore of tunnelBores)segments.push(...tunnelVoidSegments(bore));
  group.updateMatrixWorld(true);
  group.traverse(mesh=>{
    if(!mesh.isMesh || mesh.isInstancedMesh || !mesh.geometry || mesh.userData.tunnelVoidCut
        || String(mesh.userData.surface||"").startsWith("tunnel"))return;
    // The canonical objects remain intact. Only fragments in the physical bore
    // are hidden, including a building's lower wall if its footprint covers an arch.
    const surface=mesh.userData.surface || "";
    if(!allSurfaces && !/terrain|neutral_ground|perimeter_fill|road|walk|yard|park|plaza|court|front_walk|fence|wall|footprint|inferred:|kerb|curb|bike|crossing|marking|tactile_warning|median|paving|water|sea|beach/.test(surface))return;
    mesh.geometry.computeBoundingBox();
    const box=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const relevant=segments.filter(s=>s.minX<=box.max.x && s.maxX>=box.min.x
      && s.minZ<=box.max.z && s.maxZ>=box.min.z && s.minY<=box.max.y && s.maxY>=box.min.y);
    if(!relevant.length)return;
    if(relevant.length>TUNNEL_VOID_MAX_SEGMENTS) {
      throw Error(`Tunnel cut mesh needs spatial splitting: ${relevant.length} segments`);
    }
    const count=relevant.length,data=new Float32Array(count*5*4);
    // Most pixels in a terrain tile are nowhere near the bore. Reject the whole
    // lookup before fetching segment textures; keep all original surface triangles.
    const cutMin=new THREE.Vector3(Math.min(...relevant.map(s=>s.minX)),
      Math.min(...relevant.map(s=>s.minY)),Math.min(...relevant.map(s=>s.minZ)));
    const cutMax=new THREE.Vector3(Math.max(...relevant.map(s=>s.maxX)),
      Math.max(...relevant.map(s=>s.maxY)),Math.max(...relevant.map(s=>s.maxZ)));
    relevant.forEach((s,i)=>{
      data.set([s.a.x,s.a.z,s.a.floor,Math.min(s.a.cap,s.crown)],i*4);
      data.set([s.b.x,s.b.z,s.b.floor,Math.min(s.b.cap,s.crown)],(count+i)*4);
      data.set([s.half,s.crown,s.spring,0],(2*count+i)*4);
      data.set([s.first.x,s.first.z,s.first.ux,s.first.uz],(3*count+i)*4);
      data.set([s.last.x,s.last.z,s.last.ux,s.last.uz],(4*count+i)*4);
    });
    const texture=new THREE.DataTexture(data,count,5,THREE.RGBAFormat,THREE.FloatType);
    texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;
    const originals=Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let remaining=originals.length;
    const materials=originals.map(original=>{
    const material=original.clone(),before=original.onBeforeCompile;
    // The clips it carries, as themselves: clone() copies userData through JSON.
    if(original.userData.detailOwnerships)material.userData.detailOwnerships=original.userData.detailOwnerships.slice();
    const cacheKey=original.customProgramCacheKey?.() || "default";
    material.onBeforeCompile=shader=>{
      if(before)before.call(material,shader);
      shader.uniforms.uTunnelVoid={value:texture};
      shader.uniforms.uTunnelVoidCount={value:count};
      shader.uniforms.uTunnelVoidInverse={value:tunnelVoidInverse};
      shader.uniforms.uTunnelVoidMin={value:cutMin};
      shader.uniforms.uTunnelVoidMax={value:cutMax};
      shader.vertexShader=shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying vec3 vTunnelVoidLocal;\nuniform mat4 uTunnelVoidInverse;')
        .replace('#include <project_vertex>',
          '#include <project_vertex>\nvTunnelVoidLocal=(uTunnelVoidInverse*modelMatrix*vec4(transformed,1.0)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
        '#include <common>\nvarying vec3 vTunnelVoidLocal;\nuniform sampler2D uTunnelVoid;\nuniform int uTunnelVoidCount;\nuniform vec3 uTunnelVoidMin;\nuniform vec3 uTunnelVoidMax;')
        .replace('void main() {',`void main() {
        if(all(greaterThanEqual(vTunnelVoidLocal,uTunnelVoidMin)) &&
           all(lessThanEqual(vTunnelVoidLocal,uTunnelVoidMax))) {
        for(int i=0;i<${TUNNEL_VOID_MAX_SEGMENTS};i++) {
          if(i>=uTunnelVoidCount)break;
          float u=(float(i)+0.5)/float(uTunnelVoidCount);
          vec4 a=texture2D(uTunnelVoid,vec2(u,0.1));
          vec4 b=texture2D(uTunnelVoid,vec2(u,0.3));
          vec4 p=texture2D(uTunnelVoid,vec2(u,0.5));
          vec4 entry=texture2D(uTunnelVoid,vec2(u,0.7));
          vec4 exitPlane=texture2D(uTunnelVoid,vec2(u,0.9));
          // End planes bound the WHOLE bore, not each centreline segment.
          // Strict segment planes left triangular uncut wedges on every bend.
          if(dot(vTunnelVoidLocal.xz-entry.xy,entry.zw)<-0.001 ||
             dot(vTunnelVoidLocal.xz-exitPlane.xy,exitPlane.zw)>0.001)continue;
          vec2 delta=b.xy-a.xy;float length2=dot(delta,delta);
          if(length2<0.00001)continue;
          float t=clamp(dot(vTunnelVoidLocal.xz-a.xy,delta)/length2,0.0,1.0);
          float across=length(vTunnelVoidLocal.xz-mix(a.xy,b.xy,t));
          if(across>p.x)continue;
          float floorY=mix(a.z,b.z,t),cap=mix(a.w,b.w,t);
          float roof=floorY+min(cap,p.z+(p.y-p.z)*sqrt(max(0.0,1.0-pow(across/p.x,2.0))));
          if(vTunnelVoidLocal.y>floorY-0.04 && vTunnelVoidLocal.y<roof+0.015)discard;
        }}`);
    };
    material.customProgramCacheKey=()=>cacheKey+'-tunnel-volume-v1';
    material.needsUpdate=true;
    material.addEventListener('dispose',()=>{if(--remaining===0)texture.dispose();});
    return material;
    });
    mesh.material=Array.isArray(mesh.material) ? materials : materials[0];
    mesh.userData.tunnelVoidCut={segments:count,geometry_changed:false};
  });
}

function tunnelMoveAllowed(ax, az, bx, bz, referenceY = walkerFeetY()) {
  const here=tunnelSurfaceAt(ax,az,referenceY),ahead=tunnelSurfaceAt(bx,bz,referenceY);
  if (!here && !ahead) return typeof approachMoveAllowed !== "function"
    || approachMoveAllowed(ax,az,bx,bz,referenceY);
  const radius=typeof WALKER_RADIUS_M === "number" ? WALKER_RADIUS_M : .3;
  if (here && ahead && here.bore===ahead.bore) {
    return Boolean(tunnelSurfaceAt(bx,bz,referenceY,radius,here.bore));
  }
  const surface=here || ahead,bore=surface.bore,stations=bore.stations;
  const margin=Math.hypot(bx-ax,bz-az)+.05;
  // Enter/leave only by crossing a portal plane, within its clear width and
  // at the level of the approach road. A side-wall escape is never a portal.
  for (const [end,sign] of [[stations[0],-1],[stations[stations.length-1],1]]) {
    const da=((ax-end.x)*end.ux+(az-end.z)*end.uz)*sign;
    const db=((bx-end.x)*end.ux+(bz-end.z)*end.uz)*sign;
    const across=Math.abs((bx-end.x)*end.uz-(bz-end.z)*end.ux);
    if (Math.min(Math.abs(da),Math.abs(db))>margin || da*db>1e-8
        || across>bore.half-radius) continue;
    const outside=here ? [bx,bz] : [ax,az];
    const cut=typeof approachRoadAt === "function" ? approachRoadAt(...outside) : null;
    const ground=(cut ?? groundLiftAt(...outside))+(typeof ROAD_TOP_M === "number" ? ROAD_TOP_M : .06);
    if (Math.abs(ground-surface.y)<=.6+margin*.5) return true;
  }
  return false;
}

function approachSurfaceAt(x,z,referenceY=null,radius=0) {
  for(const cut of APPROACH_CUTS) {
    const dx=x-cut.mx,dz=z-cut.mz,along=dx*cut.ux+dz*cut.uz;
    if(along<0 || along>cut.reach)continue;
    const across=Math.abs(dx*cut.uz-dz*cut.ux);
    if(across>cut.half-radius)continue;
    const y=cutRoadAt(cut,along)+ROAD_TOP_M;
    if(Number.isFinite(referenceY) && Math.abs(y-referenceY)>1.1)continue;
    return {y,cut,along,across};
  }
  return null;
}

function approachMoveAllowed(ax,az,bx,bz,referenceY) {
  const here=approachSurfaceAt(ax,az,referenceY);
  if(!here)return true;
  const radius=typeof WALKER_RADIUS_M === "number" ? WALKER_RADIUS_M : .3;
  if(approachSurfaceAt(bx,bz,referenceY,radius))return true;
  // A retaining wall is not an abrupt step onto the street above the cut.
  return Math.abs(groundLiftAt(bx,bz)+ROAD_TOP_M-here.y)<=.35;
}

function approachPassageAt(x,z,referenceY) {
  if(!Number.isFinite(referenceY))return null;
  const at=approachSurfaceAt(x,z,referenceY);
  // The terrain cut includes a retaining-wall halo, not a licence to walk
  // through the neighbouring properties. Only the actual road corridor wins.
  return at && at.across<=Math.max(1,at.cut.half-APPROACH_CUT_MARGIN_M) ? at : null;
}

function occupiedApproachAt(x,z,referenceY) {
  const guest=typeof guestUnder === "function" ? guestUnder(x,z) : null;
  if(guest?.ready && guest.api.approachPassageAt) {
    const [gx,gz]=hostToGuest(guest,x,z);
    const info=guest.api.approachPassageAt(gx,gz,Number.isFinite(referenceY) ? referenceY-guest.oy : null);
    return info ? {...info,y:info.y+guest.oy} : null;
  }
  return approachPassageAt(x,z,referenceY);
}

//: The bore floor under (x, z), or null when (x, z) is in no bore.
function tunnelFloorAt(x, z) {
  let best = null;
  for (const bore of tunnelBores) {
    const { stations, half } = bore;
    // Each bore's box, once: every height in the city is asked through here, and a point away
    // from the bore is answered without walking its stations.
    if (!bore._box || bore._box.n !== stations.length) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const st of stations) {
        if (st.x < minX) minX = st.x; if (st.x > maxX) maxX = st.x;
        if (st.z < minZ) minZ = st.z; if (st.z > maxZ) maxZ = st.z;
      }
      const pad = half + 0.3;
      bore._box = { n: stations.length, minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
    }
    const box = bore._box;
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1], b = stations[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      if (!(len2 > 0)) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d > half + 0.3) continue;
      const floor = a.floor + (b.floor - a.floor) * t;
      if (best === null || floor < best) best = floor;
    }
  }
  return best;
}

//: What the walker stands on at (x, z): the bore's floor inside a tunnel, the hill over a
//: mouth on top of it, and the flat ground everywhere else -- as a height above the ground.
function walkerGroundAt(x, z, referenceY) {
  return walkerGroundInfo(x, z, referenceY).y;
}
//: The same, and what it is: "stairs" (a stoop, a front stair, a station's or a public flight of
//: steps), "surface" (a floor, a landing), "tunnel" or "terrain" -- the walker climbs stairs at
//: a stair's pace and may not walk up a cliff of plain ground (walkPace).
function walkerGroundInfo(x, z, referenceY) {
  const feet=referenceY === undefined && typeof walkerFeetY === "function" ? walkerFeetY() : referenceY;
  // (Guarded: these ground and wall functions are also run on their own, by the tests.)
  const guest = typeof guestUnder === "function" ? guestUnder(x, z) : null;
  if (guest) {
    const [gx, gz] = hostToGuest(guest, x, z);
    const info=guest.api.walkerGroundInfo
      ? guest.api.walkerGroundInfo(gx,gz,Number.isFinite(feet) ? feet-guest.oy : null)
      : { y:guest.api.walkerGroundAt(gx,gz),kind:"terrain" };
    return {...info,y:info.y+guest.oy};
  }
  // An interior floor is a second storey over a bore, not the bore's floor.
  // Select the occupied underground level before considering 2D room/stair rings.
  const bore = typeof tunnelSurfaceAt === "function" ? tunnelSurfaceAt(x,z,feet) : null;
  const floor = bore ? bore.y : typeof tunnelSurfaceAt === "function" ? null : tunnelFloorAt(x,z);
  if (floor !== null) return { y: floor, kind: "tunnel", bore:bore?.bore };
  const approach=typeof approachSurfaceAt === "function" && Number.isFinite(feet)
    ? approachSurfaceAt(x,z,feet) : null;
  if(approach)return {y:approach.y,kind:"tunnel_approach"};
  // Inside a building whose rooms are built, the walker stands on its floor; on a stoop, on
  // its steps (see buildInterior). Declared with var so it is safe before they exist.
  if (typeof standingSurfaces !== "undefined" && standingSurfaces) {
    let best = null, priority = -Infinity, stairs = false;
    for (const surface of standingSurfaces) {
      const y = surface(x, z);
      if (y !== null && (surface.priority || 0) > priority) {
        best = y;
        priority = surface.priority || 0;
        stairs = Boolean(surface.stairs);
      }
    }
    if (best !== null) return { y: best, kind: stairs ? "stairs" : "surface" };
  }
  const stair = typeof publicStairAt === "function" ? publicStairAt(x, z) : null;
  if (stair !== null) return { y: stair, kind: "stairs" };
  const lifted = groundLiftAt(x, z);
  // On a bridge or a highway's deck: the highest deck within a step of the feet (a ramp is
  // climbed onto; a viaduct overhead is walked under). Not knowing the feet -- a jump -- a deck
  // is stood on only over water. A deck at its abutment, level with the ground, is the street.
  const decks = typeof elevatedDecksAt === "function" ? elevatedDecksAt(x, z) : [];
  if (decks.length) {
    let deck = null;
    // Over the water: the city's own water map where it has one, the Bay's outline past it.
    const overWater = !Number.isFinite(feet) && ((typeof mappedWaterAt === "function" ? mappedWaterAt(x, z) : null)
      ?? (typeof perimeterWaterAt === "function" && perimeterWaterAt(x, z))) === true;
    for (const d of decks) {
      const reachable = Number.isFinite(feet) ? d.top <= feet + 0.6 : overWater;   // a step (DECK_STEP_M)
      if (reachable && (!deck || d.top > deck.top)) deck = d;
    }
    if (deck && deck.top > lifted + ROAD_TOP_M + 0.3) {
      let y = deck.top;
      if (deck.paved && typeof STREET_STANDING !== "undefined" && STREET_STANDING) {
        const paved = pavementSurfaceAt(x, z);
        if (paved !== null) y = deck.base + paved;
      }
      return { y, kind: deck.kind, structure: deck.name, walkway: deck.walkway };
    }
  }
  // On the pavement as it is laid, and on the road's surface: the walker stood on the bare
  // ground under both, its feet 19 cm into every pavement and 6 cm into every road.
  // (Only once the streets' part of the module has run: see STREET_STANDING.)
  if (typeof STREET_STANDING !== "undefined" && STREET_STANDING) {
    const paved = pavementSurfaceAt(x, z);
    if (paved !== null) return { y: lifted + paved, kind: "pavement" };
    if (insideCarriageway(x, z, 0)) return { y: lifted + STREET_STANDING.roadTop, kind: "road" };
  }
  // Past the edge of this region's surveyed grid the grid only repeats its edge, while the
  // ground drawn there -- the apron, the regions round about in the tile tree -- rises into
  // their hills: the walker went on at the edge's height, under them. There it stands on what
  // is drawn.
  if (outsideTerrainGrid(x, z)) {
    if (typeof NATURE !== "undefined" && NATURE && !guest) {
      return natureWorld?.groundInfoAt(x,z) ?? {y:lifted-earthDrop(x,z),kind:"terrain"};
    }
    const drawn = drawnGroundAt(x, z);
    if (drawn !== null) return { y: Math.max(lifted, drawn), kind: "terrain" };
  }
  return { y: lifted, kind: "terrain" };
}
//: Whether (x, z) is past the edge of this region's surveyed terrain grid.
function outsideTerrainGrid(x, z) {
  if (typeof TERRAIN_FRAME === "undefined" || !TERRAIN_FRAME) return true;
  const f = TERRAIN_FRAME;
  const [east, north] = pageToTerrain(x, z, f);
  const fx = (east - f.x0) / f.step_m, fy = (north - f.y0) / f.step_m;
  return fx < 0 || fy < 0 || fx > f.cols - 1 || fy > f.rows - 1;
}
//: The ground as it is drawn under (x, z): the terrain backdrop and its apron, and the tile tree's
//: ground of the regions round about -- the highest hit that is ground, not a roof or a tree.
//: (var: the walker may ask before this part of the module has run.)
var drawnGroundRay = null;
const DRAWN_NOT_GROUND = /building|roof|wall|window|facade|tree|furniture|sign|bridge|deck|canopy|shelter/i;
function drawnGroundAt(x, z) {
  if (typeof terrainTiles === "undefined" || typeof tileGroupRoot === "undefined") return null;
  if (!drawnGroundRay) drawnGroundRay = new THREE.Raycaster();
  drawnGroundRay.set(new THREE.Vector3(x, 4000, z), new THREE.Vector3(0, -1, 0));
  drawnGroundRay.far = 8000;
  const shown = (o) => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
  for (const hit of drawnGroundRay.intersectObjects([...terrainTiles, tileGroupRoot], true)) {
    const name = `${hit.object.name || ""} ${hit.object.userData?.surface || ""}`;
    if (!shown(hit.object) || DRAWN_NOT_GROUND.test(name)) continue;
    return hit.point.y + (terrainTiles.includes(hit.object) ? TERRAIN_MESH_UNDER_M : 0);
  }
  return null;
}
