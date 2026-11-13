// The living city in the viewer: the district's people on its pavements and its traffic on its
// streets, your wallet and your day, a car to drive (or ride in with your party), the bridge
// tolls, carpool and express lanes and speed cameras that charge it, the bills that follow, and
// the party's own measures -- all on one set of books held by the party's host.
//
// ``startCity(ctx)`` is called once by the page (src/smc/renderer/page/module/30-the-living-city.js)
// with what this module needs of it; ``city.tick(now)`` each frame; ``city.drive(dt, held)``
// instead of the walk while you drive; ``city.walkFactor()`` and ``city.walked(m, dt)`` as you walk.
//
// The controls (src/smc/city/ACTIONS.md has the whole plan), one job to a key: Enter in and out
// (your car, the bus at the stop, a shop -- inside, its checkout panel by the door is clicked --,
// your garage, a door), G pick up, 1-8 choose from the bar (what is chosen is in your hand), I
// the inventory, U use it (or a right click), X swing it (or a click), Q throw it, Space jump,
// T taxis, V the task at work, Z rest at a bed,
// J the task board, O the online store, H the controls, Shift sprint. Clocking in and out, handing
// over a parcel or an errand's shopping are a Yes / No asked where it applies. The action bar
// shows what can be done where you stand.

import {
  LaneIndex, carriedKg, carryCapacity, cityTime, fuelPrice, gantriesCrossed, itemTax, jurisdictionAt, loadRules, propertyTax, salesRate, storesAt,
  transferTax, walkFactor, waterProperties,
} from "./core.mjs";
import { BIKE_LANE, CLOTHES, COUNTER_ROLES, Crowd, DRIVE_LANE, LANE, SPEED_MS, Streets, alongRoute, counterLine, distToSegment, generatePopulation, hash32, placeFromBuilding, populationByRole, rng } from "./people.mjs";
import { homeListings, mortgageTerms } from "./market.mjs";
import { buildLines, busesAt, stopsOf } from "./transit.mjs";
import { CITATIONS, CityWorld } from "./world.mjs";
import { witnessOf } from "./enforcement.mjs";
import { KENNEY_DEBRIS, KENNEY_FOR, VEHICLE_DIMS, kenneyGeometry, kenneyMaterial, vehicleGroup, vehicleMaterials, vehicleParts } from "./vehicles.mjs";
import { City, Drivers, PARK_LANE, Roster, TRAFFIC, harmNow, injuryFor, junctionAt, signalAt } from "./fleet.mjs";
import { jumpOf, liftKg, physOf, sizeOf, swingOf, throwOf, weightClass } from "./handling.mjs";
import { DETAIL_HYSTERESIS, DETAIL_RINGS, FULL, LOW, MODERATE, TRACKED, byTier, detailField, routeSamples, velocityTracker } from "./detail.mjs";
import { BAR, GRID, arrange, barSlotOf, slotCount, swap } from "./inventory.mjs";

const SAVE_SOLO = "kerbside:city:world";
const SAVE_SELF = "kerbside:city:self";
const SAVE_ID = "kerbside:city:id";
const MPH = 2.23694;
//: A car's footprint on foot: its body, corners rounded this much (bumpers and wings are round).
const CAR_CORNER_M = 0.35;
//: A walker between cars turns side on: this much body either side of their line, not their
//: stride's 0.3 m -- a gap of half a metre between two bumpers is walked through.
const CAR_SQUEEZE_M = 0.22;
//: How far (x, z) is outside a car's rounded footprint at (cx, cz) facing ``yaw`` (negative
//: inside): its body ``w`` by ``l``, corners rounded by CAR_CORNER_M.
export function carClearance(x, z, cx, cz, yaw, w, l) {
  const dx = x - cx, dz = z - cz, fx = -Math.sin(yaw || 0), fz = -Math.cos(yaw || 0), c = Math.min(CAR_CORNER_M, w / 2);
  const a = Math.abs(dx * fx + dz * fz) - (l / 2 - c), b = Math.abs(dx * fz - dz * fx) - (w / 2 - c);
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0) - c;
}
export { CAR_SQUEEZE_M };
const CAR_DIMS = {   // width, height, length (m)
  economy: [1.76, 1.45, 4.1], compact_ev: [1.8, 1.55, 4.3], sedan: [1.85, 1.45, 4.8], suv: [1.95, 1.75, 4.9], pickup: [2.0, 1.9, 5.6],
  delivery_van: [2.0, 2.55, 5.9], box_truck: [2.45, 3.3, 7.4], taxi: [1.85, 1.5, 4.7], bus: [2.6, 3.15, 12.2], patrol: [1.9, 1.55, 5.0],
};
const PAINT = ["#f2f2f2", "#1e1e1e", "#8a8d91", "#b8bcc1", "#2b4c7e", "#7a1f1f", "#2f5d3a", "#c9b27c", "#4a4a52", "#6b8fb3", "#a3341f", "#e8e3d3"];
//: A street's bike lanes on the right and left of the way as drawn (OpenStreetMap cycleway,
//: cycleway:right / :left / :both): "lane" or "track" (its own lane), "shared" (sharrows: ridden
//: in the traffic lane), or none.
const BIKE_KIND = { lane: "lane", track: "track", shoulder: "lane", shared_lane: "shared", share_busway: "shared", opposite_lane: "lane" };
function bikeSides(way) {
  const k = (v) => BIKE_KIND[v] || null, one = way.osm_oneway === "yes" || way.osm_oneway === "-1";
  const right = k(way.cycleway_right) || k(way.cycleway_both) || k(way.cycleway);
  const left = k(way.cycleway_left) || k(way.cycleway_both) || (one ? null : k(way.cycleway));
  return right || left ? { right, left } : null;
}
//: Several geometries as one (positions and normals; each made non-indexed): one instanced part.
function mergeGeos(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new parts[0].constructor();
  out.setAttribute("position", new parts[0].attributes.position.constructor(pos, 3));
  out.setAttribute("normal", new parts[0].attributes.position.constructor(nor, 3));
  return out;
}
//: People's shapes: heights as adults' are (men about 1.76 m, women 1.62, either way by about
//: 7 cm; CDC/NCHS anthropometric reference), children by age, and builds narrower and broader --
//: from the person's id, so each is the same every time and nothing is stored or worked out again.
const HAIR = ["#1b1410", "#2b1d14", "#3b2a1d", "#5a3d26", "#7a5a3a", "#a8834f", "#c9a66b", "#8f8f8f", "#d8d2c4", "#6b2b1a"];
function bodyFor(person, cache) {
  let b = cache.get(person.id);
  if (b) return b;
  const r = rng(person.id || "?", "body"), g = (r() + r() + r() - 1.5) * 2;   // about N(0, 1)
  const age = person.age ?? 35;
  let height, build;
  if (age < 18) { height = Math.max(1.0, Math.min(1.85, 0.78 + age * 0.06 + g * 0.05)); build = 0.82 + r() * 0.12; }
  else {
    const female = r() < 0.5;
    height = Math.max(1.45, Math.min(2.02, (female ? 1.62 : 1.76) + g * (female ? 0.065 : 0.07)));
    build = (female ? 0.9 : 1.0) + (r() - 0.5) * 0.28;
  }
  const grey = age > 55 && r() < 0.6;
  b = { height, build, hair: grey ? (r() < 0.5 ? "#8f8f8f" : "#d8d2c4") : HAIR[Math.floor(r() * 7)], bald: age > 30 && r() < 0.1, phase: r() * 6.28 };
  if (cache.size > 20000) cache.clear();
  cache.set(person.id, b);
  return b;
}
//: What you are worth, from your status (world.mjs cmd_status): the money in your account and on
//: your FasTrak tag, what you own (cars at what they cost you, buildings and homes at their
//: assessment, the bag's goods at the shops' prices), what you owe (open bills, what is left on
//: each mortgage), and the difference. Money in cents, as the ledger keeps it. Assets are listed
//: dearest first; goods worth less than SIGNIFICANT_GOODS together are not listed one by one.
const SIGNIFICANT_GOODS = 10000;
export function wealthOf(R, st) {
  const assets = [], debts = [];
  for (const v of st.vehicles || []) {
    const spec = R.vehicles?.models?.[v.attrs?.model];
    assets.push({ kind: "vehicle", label: `${spec?.name || v.attrs?.model || "Vehicle"} ${v.attrs?.plate || ""}`.trim(), value: Math.max(0, Math.round(v.attrs?.value || spec?.price || 0)) });
  }
  for (const b of st.properties || []) assets.push({ kind: "building", label: b.attrs?.name || b.attrs?.address || `Building ${String(b.id).replace(/^building:/, "")}`, value: Math.max(0, Math.round(b.attrs?.assessed || b.attrs?.value || 0)) });
  for (const hm of st.homes || []) assets.push({ kind: "home", label: hm.attrs?.label || hm.attrs?.address || "A home", value: Math.max(0, Math.round(hm.attrs?.assessed || 0)) });
  let goods = 0;
  for (const [id, n] of Object.entries(st.inventory || {})) {
    const it = R.items?.[id], value = Math.max(0, Math.round((it?.price || 0) * (Number(n) || 0)));
    if (!value) continue;
    if (value >= SIGNIFICANT_GOODS) assets.push({ kind: "goods", label: `${n > 1 ? `${n} × ` : ""}${it?.name || id}`, value });
    else goods += value;
  }
  if (goods) assets.push({ kind: "goods", label: "Everything else in your bag", value: goods });
  assets.sort((a, b) => b.value - a.value);
  for (const b of st.bills || []) debts.push({ kind: "bill", label: b.memo || String(b.kind || "bill").replace(/_/g, " "), value: Math.max(0, Math.round(b.owed || 0)), due: b.due });
  for (const m of st.mortgages || []) debts.push({ kind: "mortgage", label: `Mortgage on ${String(m.home || "your home").replace(/^home:/, "home ")}`, value: Math.max(0, Math.round(m.owed || 0)) });
  const cash = Math.round(st.balance || 0), fastrak = Math.round(st.fastrak?.balance || 0);
  const owned = assets.reduce((t, a) => t + a.value, 0), owing = debts.reduce((t, d) => t + d.value, 0);
  return { cash, fastrak, assets, debts, owned, owing, net: cash + fastrak + owned - owing };
}
const SKIN = ["#f1c9a5", "#e0ac7e", "#c68c5c", "#a26c45", "#7d4f32", "#5a3824", "#f6d8bf", "#d29b6c"];
const TROUSERS = ["#2c3440", "#3d3d3d", "#4b5563", "#1f2937", "#6b5b45", "#3b4a6b"];

const store = {
  get(key) { try { return JSON.parse(globalThis.localStorage?.getItem(key) || "null"); } catch { return null; } },
  set(key, value) { try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* full or private */ } },
};

export async function startCity(ctx) {
  const { THREE } = ctx;
  const R = loadRules(await fetch(ctx.asset("city/rules.json"), { cache: "no-cache" }).then((r) => r.json()));
  // The counties' and towns' real outlines (scripts/build_jurisdictions.py), when they come.
  fetch(ctx.asset("city/jurisdictions.json")).then((r) => (r.ok ? r.json() : null)).then((b) => { if (b?.counties) R.boundaries = b; }).catch(() => {});
  const tolls = await fetch(ctx.asset("highway-tolls.json"), { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const gantries = (tolls?.tolls || []).filter((t) => t.kind === "toll_gantry" && Array.isArray(t.p)).map((t) => {
    const [x, z] = ctx.fromLonLat(t.p[0], t.p[1]);
    return { id: t.id, x, z, bearing: t.bearing, width: t.width_m, name: t.name };
  });
  let lanes = null;
  fetch(ctx.asset("managed-lanes.json"), { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))
    .then((json) => { if (json?.lanes) lanes = new LaneIndex(R, json.lanes, (lon, lat) => ctx.fromLonLat(lon, lat)); }).catch(() => {});

  // What breaks and how hard it is to break: the object catalogue's archetypes (docs/object-catalogue.json).
  const catalogue = await fetch(ctx.catalogueUrl || ctx.asset("object-catalogue.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  R.objects = {};
  for (const [id, a] of Object.entries(catalogue?.archetypes || {})) {
    const d = a.durability || {};
    if (d.level >= 2 && d.break_energy_j) R.objects[id] = { name: a.name, material: a.material, break_j: d.break_energy_j, health: d.health };
  }
  // The real bus stops and the routes that call at them.
  let transitStops = null;
  fetch(ctx.transitUrl || ctx.asset("transit-stops.json")).then((r) => (r.ok ? r.json() : null)).then((json) => { transitStops = json?.stops || []; if (district.streets) makeLines(); }).catch(() => {});

  const myId = store.get(SAVE_ID) || (() => { const id = `p${Math.random().toString(36).slice(2, 10)}`; store.set(SAVE_ID, id); return id; })();
  const timeAt = (ms) => cityTime(ms, R.clock.zone);

  // ---- the district the walker is in -----------------------------------------------------------
  const district = { key: null, region: null, city: null, roster: null, drivers: null, places: [], streets: null, cameras: [], people: [], county: null };
  let scan = { people: [], vehicles: [] }, scanAt = { x: Infinity, z: Infinity }, scanning = false, scanReach = 0;
  function buildDistrict(data) {
    const ways = [], buildings = [];
    for (const way of data.ways || []) {
      const pts = way.points;
      if (way.kind === "building" && way.centroid) {
        const [x, z] = ctx.fromLonLat(way.centroid[0], way.centroid[1]);
        let area = 0;
        if (Array.isArray(pts) && pts.length > 2) {
          const xy = pts.map(([lon, lat]) => ctx.fromLonLat(lon, lat));
          for (let i = 0; i < xy.length; i += 1) { const [ax, az] = xy[i], [bx, bz] = xy[(i + 1) % xy.length]; area += ax * bz - bx * az; }
          area = Math.abs(area) / 2;
        }
        buildings.push({ id: String(way.osm_id), x, z, archetype: way.archetype, shops: way.shops || [], name: way.name || way.address?.formatted || null,
          floors: Math.max(1, Math.round((way.height_m || 6) / R.real_estate.storey_m)), area, lon: way.centroid[0], lat: way.centroid[1],
          tag: way.tags?.building || null, ring: Array.isArray(pts) && pts.length > 2 ? pts.map(([lon, lat]) => ctx.fromLonLat(lon, lat)) : null });
        continue;
      }
      if (!Array.isArray(pts) || pts.length < 2) continue;
      if (way.kind === "street" && way.tunnel_kind !== "underground") {
        ways.push({ kind: "street", pts: pts.map(([lon, lat]) => ctx.fromLonLat(lon, lat)), lanes: way.lanes || 2, name: way.name || null,
          oneway: way.osm_oneway === "yes" ? 1 : way.osm_oneway === "-1" ? -1 : 0, road_m: way.road_m, service: way.service, busway: way.busway, id: way.osm_id,
          parking_sides: way.parking_sides, bike: bikeSides(way) });
      } else if (["sidewalk", "path", "crossing", "footway"].includes(way.kind)) {
        ways.push({ kind: "path", pts: pts.map(([lon, lat]) => ctx.fromLonLat(lon, lat)) });
      }
    }
    // The district is the region's, kept: each window's streets and buildings are added to what
    // was seen before, and its people are the same people (fleet.mjs) -- they were dealt again
    // for every window, a thousand strangers each time the detail round you was built again.
    const region = data.region || data.key;
    if (district.region !== region) {
      district.region = region; district.allWays = new Map(); district.allBuildings = new Map();
      district.roster = new Roster(R, { seed: region, saved: store.get(`kerbside:city:roster:${region}`), toLonLat: ctx.toLonLat });
      district.city = null; district.drivers = null; scan = { people: [], vehicles: [] }; scanning = false;
    }
    let added = 0;
    const wayKey = (w) => (w.kind === "street" && w.id !== undefined ? `s:${w.id}`
      : `p:${Math.round(w.pts[0][0])},${Math.round(w.pts[0][1])}:${Math.round(w.pts[w.pts.length - 1][0])},${Math.round(w.pts[w.pts.length - 1][1])}:${w.pts.length}`);
    for (const w of ways) { const k = wayKey(w); if (!district.allWays.has(k)) { district.allWays.set(k, w); added += 1; } }
    const fresh = buildings.filter((b) => !district.allBuildings.has(b.id));
    for (const b of fresh) district.allBuildings.set(b.id, b);
    district.key = data.key;
    if (!added && !fresh.length && district.city) return;
    const streets = new Streets([...district.allWays.values()]);
    // Each building's front: the wall facing the pavement it is reached from, its middle, the way
    // in, and how deep the building runs from it -- where a shop's counter goes.
    for (const b of fresh) {
      const node = b.ring ? streets.nearest(b.x, b.z, "walk", 120) : null;
      if (node !== null && node !== undefined) b.inside = frontOf(b.ring, b.x, b.z, streets.nodes[node]);
      // The door its people use: the walker's own (the page's) where the building has them, else
      // the middle of the wall facing the street.
      b.door = doorFor(b.id, node !== null && node !== undefined ? streets.nodes[node] : null) || (b.inside ? { x: b.inside.x, z: b.inside.z, nx: b.inside.nx, nz: b.inside.nz, from: "front" } : null);
    }
    const places = fresh.map((b) => { const pl = placeFromBuilding(b, streets, R); if (pl) { pl.front = b.inside || null; pl.ring = b.ring || null; pl.county = data.county; } return pl; }).filter(Boolean);
    // The parks' courts (sf-corridor-parks.json court_layout): places to play, not buildings.
    for (const [i, c] of (data.courts || []).entries()) {
      if (!Array.isArray(c.c) || !(c.l > 0) || !(c.w > 0)) continue;
      const id = `court:${c.s}:${c.c[0].toFixed(5)},${c.c[1].toFixed(5)}`;
      if (district.allBuildings.has(id)) continue;
      const [x, z] = ctx.fromLonLat(c.c[0], c.c[1]), node = streets.nearest(x, z, "walk", 160);
      if (node === null || node === undefined) continue;
      district.allBuildings.set(id, { id, court: true, i });
      places.push({ id, x, z, node, use: "park", shops: [], keys: new Set(["use:park", `sport:${c.s}`]), name: `${c.s[0].toUpperCase()}${c.s.slice(1)} court`,
        area: c.l * c.w, floors: 0, door: null, lon: c.c[0], lat: c.c[1], tag: null, inside: null, court: { x, z, a: c.a || 0, l: c.l, w: c.w, s: c.s }, county: data.county });
    }
    const roster = district.roster;
    roster.add(places);
    district.streets = streets; district.places = roster.list; district.county = data.county;
    district.people = [...roster.people.values()];
    district.placeById = roster.places;
    const harm = (id, ms) => harmNow((world || view)?.harm?.get(id), ms);
    const delay = (v, leg, day) => (district.drivers?.delayOf(City.legKey(v, leg, day)) || 0) / 60;
    // The streets as wide as the world draws them (people.mjs Streets.calibrate): lanes, parked
    // cars and pavements all to the same kerbs.
    if (ctx.kerbAt) {
      const t0 = performance.now(), n = streets.calibrate((x, z, ax, az) => ctx.kerbAt(x, z, ax, az, 6));
      ctx.log?.(`kerbside: ${n} streets' widths taken from the drawn kerbs in ${Math.round(performance.now() - t0)} ms`);
    }
    if (!district.city) district.city = new City(R, roster, streets, { seed: region, timeAt, harm, delay });
    else district.city.setStreets(streets);
    district.city.setLines(district.lines || []);
    // Parking at the kerb as the world draws it: its driveways and its painted kerb.
    if (ctx.kerbAt) district.city.setKerbside({ kerbAt: (x, z, ax, az) => ctx.kerbAt(x, z, ax, az, 6), kerbParking: ctx.kerbParking });
    if (!district.drivers) district.drivers = new Drivers(streets, { ...TRAFFIC, main_green_share: R.traffic?.main_green_share ?? 0.5 });
    else { district.drivers.streets = streets; district.drivers.cars.clear(); district.drivers.boxes.clear(); district.drivers.claims.clear(); }
    // The visitors' cars: so many to a place by how busy the district is (rules.json density).
    const [clon, clat] = ctx.toLonLat(me().x, me().z);
    const busy = Math.max(R.density?.default?.traffic ?? 1, ...((R.density?.hotspots || []).filter((h0) => clat >= h0.bbox[0] - 0.01 && clat <= h0.bbox[2] + 0.01 && clon >= h0.bbox[1] - 0.01 && clon <= h0.bbox[3] + 0.01).map((h0) => h0.traffic || 1)));
    roster.visitorsUpTo(Math.min(R.density?.visitors_max ?? 5000, Math.round(roster.places.size * (R.density?.visitors_per_place ?? 0.8) * busy)));
    if (roster.dirty) { store.set(`kerbside:city:roster:${region}`, roster.toJSON()); roster.dirty = false; }
    district.cameras = speedCameras([...district.allWays.values()], data);
    ensureJoined();
    district.candidates = null; district.foundDay = null; district.found = [];
    district.listings = null; district.listingsWeek = null;
    lastCrowd = 0; scanning = false;
    if (shop.place) leaveShop(true);
    makeLines();
    drawCameras();
    ctx.log?.(`kerbside: the living city in ${region}: ${roster.people.size} residents, ${roster.vehicles.size} vehicles (${roster.visitors.size} visitors'), ${roster.places.size} places, ${streets.size} street nodes`);
  }
  //: The bus lines through the district: the real routes' stops near its streets.
  function makeLines() {
    district.lines = []; district.stops = [];
    if (!transitStops || !district.streets || !district.places.length) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of district.places) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    const near = transitStops.filter((s) => { const [x, z] = ctx.fromLonLat(s.lon, s.lat); return x > x0 - 100 && x < x1 + 100 && z > z0 - 100 && z < z1 + 100; });
    try { district.lines = buildLines(R, near, district.streets, (lon, lat) => ctx.fromLonLat(lon, lat)); } catch (error) { console.warn("kerbside: bus lines", error); }
    district.stops = stopsOf(district.lines);
    district.city?.setLines(district.lines);
    drawStops();
    ctx.log?.(`kerbside: ${district.lines.length} bus routes through ${district.key}, ${district.stops.length} stops`);
  }
  //: A building's front from its outline (``ring``) and the pavement point it is reached from:
  //: the middle of the wall facing it, the inward normal, half the wall's width and the depth.
  function frontOf(ring, cx, cz, node) {
    if (!ring || !node) return null;
    let best = null;
    for (let i = 0; i < ring.length; i += 1) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2.5) continue;
      const t = Math.max(0, Math.min(1, ((node.x - ax) * (bx - ax) + (node.z - az) * (bz - az)) / (len * len)));
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, d = Math.hypot(node.x - px, node.z - pz);
      if (!best || d < best.d) best = { d, ax, az, bx, bz, len };
    }
    if (!best) return null;
    const mx = (best.ax + best.bx) / 2, mz = (best.az + best.bz) / 2;
    let nx = -(best.bz - best.az) / best.len, nz = (best.bx - best.ax) / best.len;
    if ((cx - mx) * nx + (cz - mz) * nz < 0) { nx = -nx; nz = -nz; }
    // How far in the building runs from the front: the nearest wall the inward ray meets.
    let depth = 30;
    for (let i = 0; i < ring.length; i += 1) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const ex = bx - ax, ez = bz - az, den = nx * ez - nz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - mx) * ez - (az - mz) * ex) / den, u = ((ax - mx) * nz - (az - mz) * nx) / den;
      if (t > 0.5 && u >= 0 && u <= 1) depth = Math.min(depth, t);
    }
    return { x: mx, z: mz, nx, nz, half: Math.min(6, best.len / 2), depth: Math.max(3, depth) };
  }
  //: The building's door nearest the street (the page's doors: the ones Enter opens), or null.
  function doorFor(id, node) {
    const doors = ctx.doorsOf?.(id) || [];
    if (!doors.length) return null;
    const best = node ? doors.slice().sort((a, b) => Math.hypot(a.x - node.x, a.z - node.z) - Math.hypot(b.x - node.x, b.z - node.z))[0] : doors[0];
    return { ...best, from: "page" };
  }
  //: Doors come with the rooms (after the district is built): a few seconds apart, the places near
  //: you that still go by the middle of their front take the real door when it is known.
  let lastDoors = 0;
  function refreshDoors(now) {
    if (now - lastDoors < 5000 || !district.places?.length || !ctx.doorsOf) return;
    lastDoors = now;
    if (nudged.size > 2000) nudged.clear();
    const at = me();
    for (const pl of district.places) {
      if (pl.door?.from === "page" || Math.abs(pl.x - at.x) > 400 || Math.abs(pl.z - at.z) > 400) continue;
      const d = doorFor(pl.id, district.streets?.nodes[pl.node]);
      if (d) pl.door = d;
    }
  }
  //: Speed cameras on the arterials of a city that has them, spaced along each one.
  function speedCameras(ways, data) {
    const S = R.enforcement.speed_camera, out = [];
    for (const w of ways) {
      if (w.kind !== "street" || (w.lanes || 0) < S.min_lanes) continue;
      const [lon, lat] = ctx.toLonLat(w.pts[0][0], w.pts[0][1]);
      if (!S.jurisdictions.includes(jurisdictionAt(R, lon, lat, data.county).city)) continue;
      let run = (hash32(w.id || w.name || "") % S.spacing_m);
      for (let i = 1; i < w.pts.length; i += 1) {
        const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i], len = Math.hypot(bx - ax, bz - az);
        while (run < len) {
          const t = run / len;
          out.push({ id: `cam:${w.id}:${out.length}`, x: ax + (bx - ax) * t, z: az + (bz - az) * t, yaw: Math.atan2(-(bx - ax), -(bz - az)), limit: SPEED_MS.arterial });
          run += S.spacing_m;
        }
        run -= len;
      }
    }
    return out;
  }

  // ---- drawing the people ----------------------------------------------------------------------
  const group = new THREE.Group();
  group.name = "living-city";
  // Bay-wide: travelling into another region lets go of this page's own world (releaseHostWorld
  // removes and disposes every child of the root that is not), and the city went with it -- the
  // people and the traffic went on being worked out and were drawn into nothing (2026-11-08).
  group.userData.bayWide = true;
  ctx.root.add(group);
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const MAX_PEOPLE = 700, MAX_CARS = 320;
  const box = (w, h, d, y = 0, x = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, 0);
  const torsoGeo = box(0.4, 0.58, 0.23, 1.08);
  const headGeo = new THREE.SphereGeometry(0.115, 10, 8).translate(0, 1.53, 0);
  const legGeo = box(0.15, 0.82, 0.16, -0.41);    // hangs from the hip
  const armGeo = box(0.1, 0.6, 0.11, -0.3);       // hangs from the shoulder
  // Shoes: the foot of each leg darker, by vertex colour (the trousers' instance colour times it),
  // so they cost no part of their own. Hair: a cap over the head, one more instanced part.
  {
    const pos = legGeo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) { const v = pos.getY(i) < -0.74 ? 0.28 : 1; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
    legGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const hairGeo = new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.545, 0.012);
  const mk = (geo, max, opts = {}) => { const m = new THREE.InstancedMesh(geo, lambert({ color: 0xffffff, ...opts }), max); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.castShadow = false; group.add(m); return m; };
  const parts = { torso: mk(torsoGeo, MAX_PEOPLE), head: mk(headGeo, MAX_PEOPLE), hair: mk(hairGeo, MAX_PEOPLE), legL: mk(legGeo, MAX_PEOPLE, { vertexColors: true }), legR: mk(legGeo, MAX_PEOPLE, { vertexColors: true }), armL: mk(armGeo, MAX_PEOPLE), armR: mk(armGeo, MAX_PEOPLE) };
  // Bicycles: two wheels and a frame, one instanced mesh; their riders are drawn as people.
  const MAX_BIKES = 40;
  const bikeGeo = (() => {
    const geos = [];
    for (const z of [-0.52, 0.52]) geos.push(new THREE.TorusGeometry(0.33, 0.028, 5, 16).rotateY(Math.PI / 2).translate(0, 0.34, z));
    const bar = (len, x0, y0, z0, rx) => geos.push(new THREE.CylinderGeometry(0.022, 0.022, len, 5).rotateX(rx).translate(x0, y0, z0));
    bar(0.62, 0, 0.62, -0.02, Math.PI / 2 - 0.12);   // top tube
    bar(0.66, 0, 0.5, 0.22, 0.75);                    // down tube
    bar(0.55, 0, 0.55, -0.3, -0.2);                   // seat tube
    bar(0.42, 0, 0.42, -0.47, 1.1);                   // chain stays
    bar(0.5, 0, 0.62, 0.48, -0.25);                   // fork and head tube
    geos.push(new THREE.BoxGeometry(0.42, 0.03, 0.03).translate(0, 0.92, 0.44));   // bars
    geos.push(new THREE.BoxGeometry(0.12, 0.04, 0.22).translate(0, 0.86, -0.32));  // saddle
    return mergeGeos(geos);
  })();
  const bikeMesh = mk(bikeGeo, MAX_BIKES);
  // ---- the crowd further off (detail.mjs) ------------------------------------------------------
  //: Drawn in full (seven parts, limbs swinging) at most this many, nearest first; then moderate,
  //: then low. Past a tier's cap a person is drawn at the next tier down, not left out.
  const PEOPLE_CAPS = [240, 520, 900];
  //: Shaded by height under the instance's colour (the shirt's): trousers and shoes darker.
  const shadeByHeight = (geo, rows) => {
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i), v = rows.find(([below]) => y < below)?.[1] ?? 1;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return geo;
  };
  //: Moderate: the body in one part -- torso, the legs together, the arms at the sides -- and the
  //: head in another, its crown the hair's shade. Two parts, not seven, and nothing swings: at
  //: sixty metres and more a stride is a few pixels, and a walk reads from the body's bob.
  const midBodyGeo = shadeByHeight(mergeGeos([box(0.4, 0.58, 0.23, 1.08), box(0.32, 0.82, 0.16, 0.41),
    box(0.1, 0.6, 0.11, 1.04, -0.26), box(0.1, 0.6, 0.11, 1.04, 0.26)]), [[0.07, 0.28], [0.8, 0.5]]);
  const midHeadGeo = shadeByHeight(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.53, 0), [[1.575, 1], [9, 0.3]]);
  //: Low: one block the person's height in their shirt's colour, legs darker -- a figure, at two
  //: hundred metres, and one part.
  const lowBodyGeo = shadeByHeight(mergeGeos([box(0.42, 1.4, 0.26, 0.7), box(0.2, 0.22, 0.2, 1.52)]), [[0.8, 0.55], [1.41, 1], [9, 0.85]]);
  const midBody = mk(midBodyGeo, PEOPLE_CAPS[1], { vertexColors: true }), midHead = mk(midHeadGeo, PEOPLE_CAPS[1], { vertexColors: true });
  const lowBody = mk(lowBodyGeo, PEOPLE_CAPS[2], { vertexColors: true });
  midBody.name = "city-people-moderate"; midHead.name = "city-people-moderate-head"; lowBody.name = "city-people-low";
  const bodies = new Map();
  // The traffic: each kind of vehicle its own three instanced parts (vehicles.mjs) -- paint,
  // glass and the rest -- so a bus is a bus and a pickup has its bed, and the seats and the wheel
  // show through the windows. They were one painted box and a pale cabin box for every kind.
  const VMAT = vehicleMaterials(THREE), fleet = new Map();
  // The traffic's bodies: the Kenney Car Kit's (vehicles.mjs), loaded once; the code-built ones
  // until they are, and for the bus.
  const kenney = new Map();   // kit model name -> {geometry, material} | null
  let kenneyLoading = false;
  function loadKenney() {
    if (kenneyLoading || !ctx.loadModel) return;
    kenneyLoading = true;
    const names = [...new Set(Object.values(KENNEY_FOR).flat())];
    const dimsOf = (name) => VEHICLE_DIMS[Object.keys(KENNEY_FOR).find((k) => KENNEY_FOR[k].includes(name) && VEHICLE_DIMS[k])] || VEHICLE_DIMS.sedan;
    for (const name of names) {
      ctx.loadModel(ctx.asset(`city/models/kenney/${name}.glb`)).then((gltf) => {
        const k = kenneyGeometry(THREE, gltf, dimsOf(name), name);
        kenney.set(name, { geometry: k.geometry, material: kenneyMaterial(THREE, k.map), livery: k.livery });
      }).catch((error) => { kenney.set(name, null); console.warn("kerbside: a car model did not load", name, error); });
    }
  }
  const kenneyOf = (model, shade) => {
    const list = KENNEY_FOR[model];
    if (!list) return null;
    const name = list[Math.floor((shade ?? 0) * 997) % list.length];
    const k = kenney.get(name);
    return k ? { name, ...k } : null;
  };
  loadKenney();
  //: ``coded``: the code-built body (vehicles.mjs vehicleParts) whether or not the kit's has
  //: loaded -- the traffic's moderate tier (detail.mjs): the right shape for its kind, and a
  //: few hundred triangles to the kit's thousands.
  const fleetOf = (model, shade = 0, coded = false) => {
    const kind = VEHICLE_DIMS[model] ? model : "sedan";
    const kit = coded ? null : kenneyOf(kind, shade);
    if (kit) {
      const key = `kenney:${kit.name}`;
      if (!fleet.has(key)) {
        const cap = kind === "box_truck" ? 40 : MAX_CARS;
        const m = new THREE.InstancedMesh(kit.geometry, kit.material, cap);
        m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.name = `city-traffic-${kit.name}`; m.castShadow = true;
        group.add(m);
        fleet.set(key, { paint: m, fixed: null, glass: null, cap, n: 0, livery: kit.livery });
      }
      return fleet.get(key);
    }
    if (!fleet.has(kind)) {
      const parts = vehicleParts(THREE, kind), cap = kind === "bus" || kind === "box_truck" ? 40 : MAX_CARS;
      const inst = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.name = `city-traffic-${kind}`; group.add(m); return m; };
      const f = { paint: inst(parts.paint, VMAT.paint), fixed: inst(parts.fixed, VMAT.fixed), glass: inst(parts.glass, VMAT.glass), cap, n: 0 };
      f.paint.castShadow = f.fixed.castShadow = true; f.glass.renderOrder = 2;
      fleet.set(kind, f);
    }
    return fleet.get(kind);
  };
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(0, 0.33, 0);
  const lightGeo = box(0.22, 0.12, 0.04, 0.72);
  const headLights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), MAX_CARS * 2);
  const tailLights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xc0261f }), MAX_CARS * 2);
  for (const l of [headLights, tailLights]) { l.count = 0; l.frustumCulled = false; l.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(l); }
  const M = new THREE.Matrix4(), B = new THREE.Matrix4(), TM = new THREE.Matrix4(), RM = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S3 = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
  const groundCache = new Map();
  const groundAt = (x, z) => {
    const key = `${Math.round(x)},${Math.round(z)}`;
    let y = groundCache.get(key);
    if (y === undefined) { y = ctx.groundAt(x, z) ?? 0; if (groundCache.size > 30000) groundCache.clear(); groundCache.set(key, y); }
    return y;
  };
  function base(x, y, z, yaw, s) { E.set(0, yaw, 0); Q.setFromEuler(E); return B.compose(V.set(x, y, z), Q, S3.set(s, s, s)); }
  //: Who is drawn: the people in view, nearest first, up to MAX_PEOPLE. The crowd round you is
  //: over a thousand at a busy hour (1,274 at the Marina, 2026-11-11); it had been the first 700
  //: of the list as it came -- someone beside you left out for someone a street behind -- and
  //: every one of them posed and sent to the GPU each frame, behind you or not.
  const VIEW_FRUSTUM = new THREE.Frustum(), VIEW_PV = new THREE.Matrix4(), VIEW_AT = new THREE.Vector3(), VIEW_BODY = new THREE.Sphere(new THREE.Vector3(), 1.4);
  function peopleInView(list) {
    const cam = ctx.camera?.();
    const floorOf = (p) => (shop.place && p.indoors === shop.place.id ? shop.frame.y : groundAt(p.x, p.z));
    if (!cam) return list.slice(0, MAX_PEOPLE).map((p) => ({ p, y: floorOf(p), d: 0 }));
    cam.getWorldPosition(VIEW_AT);
    VIEW_PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    VIEW_FRUSTUM.setFromProjectionMatrix(VIEW_PV);
    const out = [];
    for (const p of list) {
      const y = floorOf(p);
      VIEW_BODY.center.set(p.x, y + 0.9, p.z);
      if (!VIEW_FRUSTUM.intersectsSphere(VIEW_BODY)) continue;
      out.push({ p, y, d: (p.x - VIEW_AT.x) ** 2 + (p.z - VIEW_AT.z) ** 2 });
    }
    if (out.length > MAX_PEOPLE) { out.sort((a, b) => a.d - b.d); out.length = MAX_PEOPLE; }
    return out;
  }
  function drawPeople(list, now) {
    const seen = peopleInView(list);
    // Each at the tier the frame gave it (frameCity), or -- a cyclist, a passenger -- by where it is.
    for (const q of seen) q.detail = q.p.detail ?? (detailNow ? detailNow.tier("people", q.p.x, q.p.z) : FULL);
    const [full, mid, low] = byTier(seen, PEOPLE_CAPS);
    drawPeopleSimpler(mid, low, now);
    let n = 0;
    for (const { p, y } of full) {
      if (n >= MAX_PEOPLE) break;
      const body = bodyFor(p.person, bodies), s = body.height / 1.75;
      const phase = now / 1000 * 2 * Math.PI * (p.person.pace / 1.35) * 0.95 + (hash32(p.id) % 100);
      // A step lifts the body a little at each stride (twice a stride, as the legs pass).
      const bob = p.moving && !p.ride ? Math.abs(Math.sin(phase)) * 0.03 * s : 0;
      const b = base(p.x, y + (p.lift || 0) + bob, p.z, p.yaw + Math.PI, s);
      if (body.build !== 1) b.multiply(TM.makeScale(body.build, 1, 0.92 + body.build * 0.08));
      // Knocked down: falling backward to the ground (and lying there, hurt).
      if (p.down) b.multiply(RM.makeRotationX(-(p.fall ?? 1) * Math.PI / 2 * 0.96)).multiply(TM.makeTranslation(0, (p.fall ?? 1) * 0.12, 0));
      const swing = p.moving ? Math.sin(phase) * 0.55 : p.down ? 0.35 : 0;
      const set = (mesh, ox, oy, rot) => { M.copy(b).multiply(TM.makeTranslation(ox, oy, 0)).multiply(RM.makeRotationX(rot)); mesh.setMatrixAt(n, M); };
      if (p.ride === "bike") {
        // On a bicycle: leaning to the bars, the legs turning the pedals, the hands on the grips.
        const crank = (now / 1000) * (p.speed || 4) * 1.6 + body.phase;
        b.multiply(TM.makeTranslation(0, -0.04, 0.05));
        M.copy(b).multiply(TM.makeTranslation(0, 0.8, 0)).multiply(RM.makeRotationX(-0.42)).multiply(TM.makeTranslation(0, -0.8, 0));
        parts.torso.setMatrixAt(n, M); parts.head.setMatrixAt(n, M); parts.hair.setMatrixAt(n, M);
        const lean = M.clone();
        set(parts.legL, -0.1, 0.84, -1.1 + Math.sin(crank) * 0.55); set(parts.legR, 0.1, 0.84, -1.1 - Math.sin(crank) * 0.55);
        M.copy(lean).multiply(TM.makeTranslation(-0.24, 1.34, 0)).multiply(RM.makeRotationX(-1.05)); parts.armL.setMatrixAt(n, M);
        M.copy(lean).multiply(TM.makeTranslation(0.24, 1.34, 0)).multiply(RM.makeRotationX(-1.05)); parts.armR.setMatrixAt(n, M);
      } else {
        parts.torso.setMatrixAt(n, b); parts.head.setMatrixAt(n, b); parts.hair.setMatrixAt(n, b);
        set(parts.legL, -0.1, 0.84, swing); set(parts.legR, 0.1, 0.84, -swing);
        set(parts.armL, -0.26, 1.34, -swing * 0.8); set(parts.armR, 0.26, 1.34, swing * 0.8);
      }
      const h = hash32(p.id);
      parts.torso.setColorAt(n, C.set(p.person.uniform)); parts.armL.setColorAt(n, C); parts.armR.setColorAt(n, C);
      parts.head.setColorAt(n, C.set(SKIN[h % SKIN.length]));
      parts.hair.setColorAt(n, body.bald ? C.multiplyScalar(0.92) : C.set(body.hair));
      parts.legL.setColorAt(n, C.set(TROUSERS[(h >>> 5) % TROUSERS.length])); parts.legR.setColorAt(n, C);
      n += 1;
    }
    for (const mesh of Object.values(parts)) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    drawnTiers.people = [n, mid.length, low.length];
    return n;
  }
  //: The moderate and the low tiers: the same person in the same place, facing the same way, of
  //: the same height and build and in the same clothes -- in two parts, or one.
  function drawPeopleSimpler(mid, low, now) {
    let m = 0, l = 0;
    const place = ({ p, y }) => {
      const body = bodyFor(p.person, bodies), s = body.height / 1.75;
      const phase = now / 1000 * 2 * Math.PI * (p.person.pace / 1.35) * 0.95 + (hash32(p.id) % 100);
      const bob = p.moving && !p.ride ? Math.abs(Math.sin(phase)) * 0.03 * s : 0;
      const b = base(p.x, y + (p.lift || 0) + bob, p.z, p.yaw + Math.PI, s);
      if (body.build !== 1) b.multiply(TM.makeScale(body.build, 1, 0.92 + body.build * 0.08));
      if (p.down) b.multiply(RM.makeRotationX(-(p.fall ?? 1) * Math.PI / 2 * 0.96)).multiply(TM.makeTranslation(0, (p.fall ?? 1) * 0.12, 0));
      // A cyclist leans to the bars.
      else if (p.ride === "bike") b.multiply(TM.makeTranslation(0, 0.8, 0.05)).multiply(RM.makeRotationX(-0.42)).multiply(TM.makeTranslation(0, -0.8, 0));
      return b;
    };
    for (const q of mid) {
      const b = place(q), h = hash32(q.p.id);
      midBody.setMatrixAt(m, b); midHead.setMatrixAt(m, b);
      midBody.setColorAt(m, C.set(q.p.person.uniform));
      midHead.setColorAt(m, C.set(SKIN[h % SKIN.length]));
      m += 1;
    }
    for (const q of low) {
      lowBody.setMatrixAt(l, place(q));
      lowBody.setColorAt(l, C.set(q.p.person.uniform));
      l += 1;
    }
    for (const [mesh, k] of [[midBody, m], [midHead, m], [lowBody, l]]) {
      mesh.count = k; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  // ---- people on bicycles ----------------------------------------------------------------------
  //: Cyclists near you: each rides a way through the streets that have bike lanes (as the
  //: traffic goes: one-ways one way), in the bike lane (BIKE_LANE), at a cyclist's pace, and
  //: stops at a red light at the junction's line. A few dozen, found again as you move.
  //: New riders are looked for twice a second, a few at a time (each try is a route search): it
  //: had been six searches every frame while fewer than ``count`` rode -- the steady state where
  //: few streets have lanes -- and the same six, the draw being seeded for two seconds.
  const BIKES = { count: 24, reach_m: 450, drop_m: 650, speed: [3.8, 6.8], route_m: [300, 1100], stop_m: 7, tries: 3, every_s: 0.5 };
  let bikes = [], bikeNodes = null, bikeStreets = null, bikeN = 0, bikeLook = -1, bikeBurst = false;
  function stepBikes(dt, tsec, focus, now = performance.now()) {
    const s = district.streets;
    if (!s) { bikes = []; return; }
    if (bikeStreets !== s) {
      bikeStreets = s; bikes = []; bikeBurst = false;
      bikeNodes = [];
      for (let a = 0; a < s.nodes.length; a += 1) if (s.edges[a].some((e) => e.drive && e.bike)) bikeNodes.push(a);
    }
    if (!bikeNodes.length) return;
    // A rider at the end of the way rides on: a new way from there (its own, kept to its end),
    // not gone and another dealt elsewhere.
    for (const b of bikes) {
      if (b.d < b.route.length - 0.5) continue;
      const a = b.route.ids?.[b.route.ids.length - 1], r2 = rng(b.id, "on", bikeN += 1);
      b.route = null;
      for (let tries = 0; a !== undefined && a >= 0 && tries < 4 && !b.route; tries += 1) {
        const z = bikeNodes[Math.floor(r2() * bikeNodes.length)], A = s.nodes[a], Z = s.nodes[z], far = Math.hypot(Z.x - A.x, Z.z - A.z);
        if (z === a || far < BIKES.route_m[0] || far > BIKES.route_m[1]) continue;
        const route = s.route(a, z, "drive");
        if (route && route.length >= 80) { b.route = route; b.d = 0; }
      }
    }
    bikes = bikes.filter((b) => b.route && Math.hypot(b.x - focus.x, b.z - focus.z) < BIKES.drop_m);
    const look = Math.floor(now / 1000 / BIKES.every_s);   // the page's clock: the city's runs faster
    const r = rng(myId, "bikes", look);
    const fresh = look !== bikeLook;
    bikeLook = look;
    // On the district's load, the riders all set out at once (each on its way to the end).
    const burst = !bikeBurst;
    bikeBurst = true;
    for (let tries = fresh || burst ? 0 : BIKES.tries, most = burst ? BIKES.count * 3 : BIKES.tries; bikes.length < BIKES.count && tries < most; tries += 1) {
      const a = bikeNodes[Math.floor(r() * bikeNodes.length)], A = s.nodes[a];
      if (Math.hypot(A.x - focus.x, A.z - focus.z) > BIKES.reach_m) continue;
      const b = bikeNodes[Math.floor(r() * bikeNodes.length)], B = s.nodes[b], far = Math.hypot(B.x - A.x, B.z - A.z);
      if (a === b || far < BIKES.route_m[0] || far > BIKES.route_m[1]) continue;
      const route = s.route(a, b, "drive");
      if (!route || route.length < 80 || (route.bikes || []).filter(Boolean).length < route.bikes.length * 0.4) continue;
      bikeN += 1;
      const id = `bike:${myId}:${bikeN}`, rr = rng(id);
      bikes.push({ id, route, d: r() * Math.min(60, route.length / 3), speed: BIKES.speed[0] + rr() * (BIKES.speed[1] - BIKES.speed[0]), v: 0,
        shade: rr(), person: { id: `rider:${id}`, height: 1.7, pace: 1.3, age: 18 + Math.floor(rr() * 45), uniform: CLOTHES[Math.floor(rr() * CLOTHES.length)] } });
    }
    for (const b of bikes) {
      // The next junction ahead with a light: held at its line on red (and amber when close).
      let hold = Infinity;
      const { pts, s: S, ids } = b.route;
      for (let v = 1; v < pts.length - 1 && S[v] - b.d < 40; v += 1) {
        if (S[v] <= b.d + 0.5) continue;
        const node = ids[v];
        if (node === undefined || node < 0 || junctionAt(s, node) !== "signal") continue;
        const bearing = Math.atan2(pts[v][0] - pts[v - 1][0], pts[v][1] - pts[v - 1][1]);
        const light = signalAt(s, node, bearing, tsec);
        if (light === "red" || (light === "amber" && S[v] - b.d > BIKES.stop_m + 4)) hold = S[v] - BIKES.stop_m;
        break;
      }
      const want = hold - b.d < 1 ? 0 : hold - b.d < 12 ? Math.min(b.speed, (hold - b.d) * 0.6) : b.speed;
      b.v += Math.max(-3, Math.min(1.2, want - b.v)) * dt * 2;
      b.v = Math.max(0, b.v);
      b.d = Math.min(b.route.length, b.d + b.v * dt);
      Object.assign(b, alongRoute(b.route, b.d, BIKE_LANE));
    }
  }
  //: The riders, as people on their bicycles, for drawPeople.
  const bikeRiders = () => bikes.map((b) => ({ id: b.person.id, x: b.x, z: b.z, yaw: b.yaw, person: b.person, moving: b.v > 0.3, ride: "bike", lift: 0.22, speed: b.v }));
  function drawBikes() {
    let n = 0;
    for (const b of bikes) {
      if (n >= MAX_BIKES) break;
      bikeMesh.setMatrixAt(n, base(b.x, groundAt(b.x, b.z), b.z, b.yaw, 1));
      bikeMesh.setColorAt(n, C.set(PAINT[Math.floor(b.shade * PAINT.length) % PAINT.length]));
      n += 1;
    }
    bikeMesh.count = n; bikeMesh.instanceMatrix.needsUpdate = true; if (bikeMesh.instanceColor) bikeMesh.instanceColor.needsUpdate = true;
  }
  //: The traffic's tiers (detail.mjs): the kit's body nearest, the code-built one next, and one
  //: box of the car's size and paint further off; at most so many of each.
  const CAR_CAPS = [80, 170, MAX_CARS];
  const lowCars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), lambert({ color: 0xffffff }), MAX_CARS);
  lowCars.count = 0; lowCars.frustumCulled = false; lowCars.instanceMatrix.setUsage(THREE.DynamicDrawUsage); lowCars.name = "city-traffic-low"; group.add(lowCars);
  const CAR_FRUSTUM = new THREE.Frustum(), CAR_SPHERE = new THREE.Sphere(new THREE.Vector3(), 3);
  //: Which of ``list`` are drawn, and how finely: in view only (a car behind you, or round the
  //: corner of the frame, is not sent to the GPU at all), at its tier; the one you ride in full.
  function carsInView(list) {
    const cam = ctx.camera?.(), out = [];
    if (cam) { cam.getWorldPosition(VIEW_AT); VIEW_PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); CAR_FRUSTUM.setFromProjectionMatrix(VIEW_PV); }
    for (const v of list) {
      const detail = v.id === transit.ride?.vehicle ? FULL : v.detail ?? (detailNow ? detailNow.tier("cars", v.x, v.z, carTiers.get(v.id)?.tier) : FULL);
      if (detail === TRACKED) continue;
      const [, h, l] = CAR_DIMS[v.model] || CAR_DIMS.sedan;
      if (cam) {
        CAR_SPHERE.center.set(v.x, groundAt(v.x, v.z) + h / 2, v.z); CAR_SPHERE.radius = l / 2 + 0.6;
        if (!CAR_FRUSTUM.intersectsSphere(CAR_SPHERE)) continue;
      }
      out.push({ v, detail, d: cam ? (v.x - VIEW_AT.x) ** 2 + (v.z - VIEW_AT.z) ** 2 : 0 });
    }
    return out;
  }
  function drawCars(list, night) {
    let n = 0, lights = 0, lo = 0;
    for (const f of fleet.values()) f.n = 0;
    const [full, mid, low] = byTier(carsInView(list), CAR_CAPS);
    drawnTiers.cars = [full.length, mid.length, low.length];
    for (const { v, detail: tier } of [...full, ...mid, ...low]) {
      if (n >= MAX_CARS) break;
      const [w, hgt, l] = CAR_DIMS[v.model] || CAR_DIMS.sedan;
      const f = tier === LOW ? null : fleetOf(v.model, v.shade, tier === MODERATE);
      if (f && f.n >= f.cap) continue;
      const y = groundAt(v.x, v.z);
      // A wreck sits askew; a car in a crash rocks on its springs.
      E.set(v.jolt || (v.wrecked ? 0.035 : 0), v.yaw + (v.wrecked ? 0.12 : 0), v.wrecked ? 0.05 : 0); Q.setFromEuler(E);
      M.compose(V.set(v.x, y, v.z), Q, S3.set(1, 1, 1));
      if (f) { f.paint.setMatrixAt(f.n, M); f.fixed?.setMatrixAt(f.n, M); f.glass?.setMatrixAt(f.n, M); }
      else lowCars.setMatrixAt(lo, M.multiply(TM.makeScale(w, hgt * 0.92, l)));
      const paint = f?.livery ? "#ffffff" : v.model === "taxi" ? "#f1c40f" : v.model === "bus" ? "#b03a2e" : v.model === "patrol" ? "#1b2631" : v.model === "box_truck" || v.model === "delivery_van" ? "#efefea" : PAINT[Math.floor((v.shade ?? 0.5) * PAINT.length) % PAINT.length];
      C.set(paint);
      // Dented and scraped by its condition: duller, and a wreck scorched.
      if ((v.condition ?? 100) < 85) C.multiplyScalar(0.55 + 0.45 * Math.max(0, v.condition) / 85);
      if (f) { f.paint.setColorAt(f.n, C); f.n += 1; } else { lowCars.setColorAt(lo, C); lo += 1; }
      if (night) {
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = -fz, rz = fx;
        for (const s of [1, -1]) {
          if (lights >= MAX_CARS * 2) break;
          M.compose(V.set(v.x + fx * l * 0.5 + rx * s * w * 0.32, y, v.z + fz * l * 0.5 + rz * s * w * 0.32), Q, S3.set(1, 1, 1)); headLights.setMatrixAt(lights, M);
          M.compose(V.set(v.x - fx * l * 0.5 + rx * s * w * 0.32, y, v.z - fz * l * 0.5 + rz * s * w * 0.32), Q, S3.set(1, 1, 1)); tailLights.setMatrixAt(lights, M);
          lights += 1;
        }
      }
      n += 1;
    }
    for (const f of fleet.values()) for (const mesh of [f.paint, f.fixed, f.glass]) {
      if (!mesh) continue;
      mesh.count = f.n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    headLights.count = tailLights.count = lights; headLights.instanceMatrix.needsUpdate = tailLights.instanceMatrix.needsUpdate = true;
    lowCars.count = lo; lowCars.instanceMatrix.needsUpdate = true; if (lowCars.instanceColor) lowCars.instanceColor.needsUpdate = true;
  }
  // Speed cameras: a grey pole and a box on it, at the kerb.
  const camGroup = new THREE.Group(); group.add(camGroup);
  function drawCameras() {
    camGroup.clear();
    if (!district.cameras.length) return;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8).translate(0, 1.6, 0), lambert({ color: 0x8f969c }), district.cameras.length);
    const head = new THREE.InstancedMesh(box(0.35, 0.3, 0.5, 3.2), lambert({ color: 0x2d3338 }), district.cameras.length);
    district.cameras.forEach((c, i) => {
      const side = 7;
      const x = c.x + Math.cos(c.yaw) * side, z = c.z - Math.sin(c.yaw) * side;
      E.set(0, c.yaw, 0); Q.setFromEuler(E); M.compose(V.set(x, groundAt(x, z), z), Q, S3.set(1, 1, 1));
      pole.setMatrixAt(i, M); head.setMatrixAt(i, M);
    });
    pole.name = "speed-cameras"; camGroup.add(pole, head);
  }

  // ---- your car and your party's ---------------------------------------------------------------
  function makeCar(model, colour) {
    const [w, h, l] = CAR_DIMS[model] || CAR_DIMS.sedan;
    const g = vehicleGroup(THREE, model, colour);
    g.userData = { model, dims: [w, h, l] };
    g.name = "city-car";
    return g;
  }
  const parked = new Map();     // vehicle id -> mesh (your cars where they stand)
  const peerCars = new Map();   // peer id -> mesh

  // ---- the books: yours alone, or the party host's ---------------------------------------------
  const party = { session: null, host: null, unlisten: null, pending: new Map(), req: 0, lastState: 0, snapshot: null };
  let world = null;     // the authoritative world when this browser holds it
  let view = null;      // the world as last seen (a copy of the host's when in a party)
  function loadSolo() {
    const saved = store.get(SAVE_SOLO);
    try { if (saved) return CityWorld.fromJSON(R, saved); } catch (error) { console.warn("kerbside: the saved city could not be read", error); }
    return new CityWorld(R, { now: Date.now(), seed: "solo" });
  }
  world = loadSolo(); view = world;
  const amHost = () => Boolean(world);
  const roomKey = () => party.session ? `kerbside:city:party:${party.session.room}` : SAVE_SOLO;
  function save() {
    if (world) store.set(roomKey(), world.toJSON());
    const self = (world || view)?.savedSelf?.(myId);
    if (self) store.set(SAVE_SELF, self);
  }
  //: A command as the player: done here when this browser holds the books, sent to the host when not.
  function send(command, args = {}) {
    const here = whereNow();
    const full = { ...args, at: here };
    if (world) { const r = world.submit(myId, command, full); afterChange(); return Promise.resolve(r); }
    const req = `${myId}:${++party.req}`;
    party.session.city.send({ t: "cmd", req, pid: myId, command, args: full });
    return new Promise((resolve) => { party.pending.set(req, resolve); setTimeout(() => { if (party.pending.delete(req)) resolve({ ok: false, error: "the party's host did not answer" }); }, 6000); });
  }
  function afterChange() { if (world && party.session) broadcastState(); refresh(); }
  function broadcastState() {
    if (!world || !party.session) return;
    const json = world.toJSON();
    json.ledger.journal = json.ledger.journal.slice(-60);
    party.session.city.send({ t: "state", host: myId, state: json });
    party.lastState = performance.now();
  }
  function onPartyMessage(m) {
    if (m.t === "cmd" && world) {
      // (Backend money is minted by the browser it belongs to, for itself: never asked of a host.)
      const result = m.command === "account_grant" ? { ok: false, error: "not from a party" } : world.submit(m.pid, m.command, m.args);
      party.session.city.send({ t: "res", req: m.req, to: m.pid, result });
      broadcastState(); refresh();
    } else if (m.t === "res" && m.to === myId) {
      const done = party.pending.get(m.req); if (done) { party.pending.delete(m.req); done(m.result); }
    } else if (m.t === "state" && m.host !== myId) {
      party.snapshot = m.state; party.host = m.host; party.heardHost = performance.now();
      if (world && m.host < myId) { save(); world = null; }   // two hosts: the lower id keeps the books
      if (!world) { view = CityWorld.fromJSON(R, m.state); refresh(); ensureJoined(); }
    } else if (m.t === "hello" && world) broadcastState();
  }
  //: Who holds the books: the lowest city id in the party (yours when alone, or when the host has gone).
  function electHost() {
    if (!party.session) return;
    const ids = [myId, ...[...party.ids.values()]].sort();
    const lowest = ids[0];
    const hostGone = party.host && performance.now() - (party.heardHost || 0) > 8000;
    if (lowest === myId && !world && (hostGone || !party.host || party.host === myId || !party.ids.size)) {
      // Take over from the last state the party saw, or this party's own saved world.
      world = party.snapshot ? CityWorld.fromJSON(R, party.snapshot) : (() => { const s = store.get(roomKey()); return s ? CityWorld.fromJSON(R, s) : new CityWorld(R, { seed: party.session.room }); })();
      view = world; party.host = myId; ensureJoined(); broadcastState();
    }
  }
  //: Everyone is a player of the city from the first: joined in the background as soon as the
  //: district is there (a home beside you to rent), under the profile's name -- there is no
  //: "Join the city" to press (2026-11-11).
  async function ensureJoined() {
    const w = world || view;
    if (!w || w.players.has(myId) || party.joining) return;
    if (!party.session && !district.places?.length) return;   // the district first: a home beside you
    party.joining = true;
    try {
      const lib = await Promise.resolve(ctx.account?.()).catch(() => null);
      const name = party.session?.me?.name || lib?.account?.()?.name || "You";
      const home = nearestPlace((p) => p.use === "residential", 400);
      const r = await send("join", { name, home });
      if (r.ok && party.session) { const self = store.get(SAVE_SELF); if (self) await send("import", { saved: self }); }
    } catch (error) { console.warn("kerbside: could not join the city", error); }
    finally { party.joining = false; }
    refresh();
  }
  function joinParty(session) {
    if (party.session === session) return;
    leaveParty();
    save();
    party.session = session; party.ids = new Map(); party.host = null; party.snapshot = null;
    world = null; view = null;
    party.unlisten = session.city.listen((m) => {
      if (m.pid) party.ids.set(m.from, m.pid);
      if (m.host) party.ids.set(m.from, m.host);
      if (m.t === "hello" && m.pid) party.ids.set(m.from, m.pid);
      onPartyMessage(m);
    });
    session.city.send({ t: "hello", pid: myId });
    // Alone in the room for a moment: this browser holds the books.
    setTimeout(electHost, 2500);
  }
  function leaveParty() {
    if (!party.session) return;
    party.unlisten?.(); save();
    // Back to your own world, with yourself as the party left you.
    const self = (world || view)?.savedSelf?.(myId);
    party.session = null; world = loadSolo(); view = world;
    if (self) { const p = world.players.get(myId); if (p) { const diff = self.balance - world.ledger.balance(p.account); if (diff > 0) world.ledger.mint(p.account, diff, "import", { at: Date.now() }); else if (diff < 0) world.ledger.burn(p.account, -diff, "system_fee", { at: Date.now() }); } }
    refresh();
  }

  // ---- where you are, and what is here ---------------------------------------------------------
  const me = () => ctx.avatar.position;
  function whereNow() {
    const p = car.active ? car : me();
    const [lon, lat] = ctx.toLonLat(p.x, p.z);
    return { x: p.x, z: p.z, lon, lat, county: district.county };
  }
  function nearestPlace(test = () => true, reach = 60) {
    const p = me();
    let best = null, bestD = reach;
    const nodes = district.streets?.nodes || [];
    for (const pl of district.places) {
      if (!test(pl)) continue;
      // From its middle, or from the pavement in front of it (a big building's middle is far in).
      const front = nodes[pl.node];
      const d = Math.min(Math.hypot(pl.x - p.x, pl.z - p.z), front ? Math.hypot(front.x - p.x, front.z - p.z) + 8 : Infinity);
      if (d < bestD) { bestD = d; best = pl; }
    }
    return best ? { ...best, keys: [...best.keys], distance: bestD } : null;
  }
  //: The shop you are at the door of: within a few steps of its shopfront (rules.json
  //: stores.door_reach_m), measured from the front as the page draws it -- not from the
  //: building's middle, which had you "at" a shop from across the street.
  function nearestShop() {
    const p = me(), reach = R.stores.door_reach_m ?? 3.5;
    let best = null, bestD = reach;
    for (const pl of district.places) {
      if (!storesAt(R, pl.keys).length) continue;
      const I = pl.front || pl.inside;
      let d;
      if (I) {
        const u = (p.x - I.x) * I.nx + (p.z - I.z) * I.nz, v = Math.abs((p.x - I.x) * I.nz - (p.z - I.z) * I.nx);
        if (u > 1.5) continue;
        d = Math.hypot(Math.max(0, -u), Math.max(0, v - (I.half || 3)));
      } else d = Math.hypot(pl.x - p.x, pl.z - p.z) - Math.sqrt(pl.area || 100) / 2;
      if (d < bestD) { bestD = d; best = pl; }
    }
    return best ? { ...best, keys: [...best.keys], distance: bestD } : null;
  }

  // ---- driving ---------------------------------------------------------------------------------
  const car = { active: false, vehicle: null, model: null, mesh: null, x: 0, z: 0, yaw: 0, speed: 0, km: 0, litres: 0, riding: null,
    lane: null, laneKm: 0, laneSeg: null, limit: SPEED_MS.residential, lastCam: new Map(), lastToll: new Map(), plate: "" };
  function occupants() {
    const s = party.session;
    if (!s) return 1;
    return 1 + s.players().filter((p) => p.car?.riding === s.me.id).length;
  }
  async function enterCar(vehicleId) {
    const w = view;
    const a = w.registry.assets.get(vehicleId);
    if (!a) return;
    const r = await send("drive", { vehicle: vehicleId });
    if (!r.ok) { notify(r.error); return; }
    const spec = R.vehicles.models[a.attrs.model];
    car.active = true; car.vehicle = vehicleId; car.model = a.attrs.model; car.plate = a.attrs.plate;
    car.x = a.attrs.x ?? me().x; car.z = a.attrs.z ?? me().z; car.yaw = a.attrs.yaw ?? ctx.getYaw(); car.speed = 0; car.km = 0; car.litres = 0;
    car.top = spec.top_kmh / 3.6; car.spec = spec;
    parked.get(vehicleId)?.removeFromParent(); parked.delete(vehicleId);
    car.mesh = makeCar(a.attrs.model, spec.colour); group.add(car.mesh);
    ctx.avatarVisible(false);
    ctx.moveAvatarTo(car.x, car.z);
    notify(`Driving your ${spec.name.toLowerCase()} (${car.plate}). Arrows steer; Enter to get out.`);
    refresh();
  }
  async function exitCar() {
    if (!car.active) return;
    const metered = Boolean(nearestPlace((p) => p.shops.length > 0, 30)) && Boolean(ctx.onRoad(car.x, car.z));
    const r = await send("park", { metered, x: car.x, z: car.z, km: car.km, litres: car.litres });
    if (!r.ok) { notify(r.error); return; }
    const a = view.registry.assets.get(car.vehicle);
    if (a) { a.attrs.x = car.x; a.attrs.z = car.z; a.attrs.yaw = car.yaw; }
    flushLane();
    car.mesh?.removeFromParent(); car.mesh = null;
    car.active = false;
    // Out on the kerb side.
    const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
    ctx.moveAvatarTo(car.x + rx * 1.8, car.z + rz * 1.8);
    ctx.avatarVisible(true);
    notify(metered ? "Parked at a meter: pay it in the City panel, or expect a ticket an hour after it runs out." : "Parked.");
    refresh();
  }
  //: Each frame you drive: the arrows are the pedals and the wheel; the car keeps to what it can
  //: drive on, through the page's own walls and buildings (ctx.moveWalker).
  function drive(dt, held) {
    if (!car.active) return false;
    const up = held.has("ArrowUp"), down = held.has("ArrowDown"), left = held.has("ArrowLeft"), right = held.has("ArrowRight");
    const accel = up ? 3.2 : 0, brake = down ? (car.speed > 0.3 ? 7.5 : 2.2) : 0;
    if (up) car.speed += accel * dt;
    if (down) car.speed -= brake * dt;
    if (!up && !down) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 0.9 * dt);
    const onRoad = ctx.onRoad(car.x, car.z);
    const cap = onRoad ? car.top : 4;
    car.speed = Math.max(-5, Math.min(cap, car.speed));
    const steer = (left ? 1 : 0) - (right ? 1 : 0);
    if (steer && Math.abs(car.speed) > 0.2) car.yaw += steer * dt * Math.min(1.6, 0.35 + Math.abs(car.speed) / 9) * Math.sign(car.speed);
    let dx = -Math.sin(car.yaw) * car.speed * dt, dz = -Math.cos(car.yaw) * car.speed * dt;
    // City mode's area ends here: the car stops at its edge (not a crash).
    if (ctx.inArea && !ctx.inArea(car.x + dx * 4, car.z + dz * 4) && ctx.inArea(car.x, car.z)) {
      car.speed = 0; dx = 0; dz = 0;
      if (performance.now() - (car.edgeSaid || 0) > 4000) { car.edgeSaid = performance.now(); notify(`${ctx.areaName?.() || "The city"} ends here: turn round, or switch to Explore to go further.`); }
    }
    const before = { x: car.x, z: car.z };
    const moved = ctx.moveWalker(dx, dz);
    const p = me();
    car.x = p.x; car.z = p.z;
    const want = Math.hypot(dx, dz);
    if (want > 0.05 && moved < want * 0.3) {
      // Hit something: hurt by how fast.
      const H = R.vitals.health, impact = Math.abs(car.speed);
      if (impact > H.crash_over_ms && performance.now() - (car.lastCrash || 0) > 1500) {
        car.lastCrash = performance.now();
        const amount = Math.round((impact - H.crash_over_ms) * H.crash_per_ms);
        // What the car hit: the energy of the impact on it (a bench, a light, a bin).
        const kg = { car: 1500, truck: 2600, van: 2500, bus: 13000 }[car.spec.kind] || 1500;
        strikeKey(0.5 * kg * impact * impact);
        send("hurt", { amount, cause: "crash" }).then((r) => r.ok && notify(r.fainted && Date.now() - r.fainted.at < 5000 ? "" : `Crashed at ${Math.round(impact * MPH)} mph: -${amount} health.`));
      }
      car.speed *= 0.2;
    }
    hitInTraffic(before);
    const metres = Math.hypot(car.x - before.x, car.z - before.z);
    car.km += metres / 1000;
    const spec = car.spec;
    car.litres += spec.fuel === "electric" ? metres / 1000 * spec.kwh_per_100km / 100 / 1.6 : metres / 1000 * spec.l_per_100km / 100;
    if (car.mesh) { car.mesh.position.set(car.x, p.y - ctx.standY, car.z); car.mesh.rotation.y = car.yaw; }
    ctx.followYaw(car.yaw, dt);
    roadCharges(before, car, dt);
    return true;
  }
  //: Your car against the city's: its cars and its people are solid. A hit is a crash -- the
  //: other car dented or wrecked where it stands, someone on foot thrown and hurt -- by speed.
  let lastTrafficHit = 0;
  //: Whether two cars' footprints (centre, heading, half length, half width) overlap.
  function boxesOverlap(ax, az, ayaw, ahl, ahw, bx, bz, byaw, bhl, bhw) {
    const A = [[-Math.sin(ayaw), -Math.cos(ayaw)], [Math.cos(ayaw), -Math.sin(ayaw)]];
    const B = [[-Math.sin(byaw), -Math.cos(byaw)], [Math.cos(byaw), -Math.sin(byaw)]];
    const dx = bx - ax, dz = bz - az;
    for (const [ux, uz] of [...A, ...B]) {
      const ra = ahl * Math.abs(A[0][0] * ux + A[0][1] * uz) + ahw * Math.abs(A[1][0] * ux + A[1][1] * uz);
      const rb = bhl * Math.abs(B[0][0] * ux + B[0][1] * uz) + bhw * Math.abs(B[1][0] * ux + B[1][1] * uz);
      if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
    }
    return true;
  }
  //: On foot, the city's cars are solid too: its traffic and parked cars, your own parked cars,
  //: the buses, your taxi and the others' cars. The ids of those a walker of radius ``r`` at
  //: (x, z) would stand inside (empty where it is clear). Never while you drive or ride.
  function carsAt(x, z, r = 0.3) {
    return carsNear(x, z, r).map((c) => c.id);
  }
  //: The cars a walker at (x, z) stands inside, each with its long axis: a car's footprint is
  //: its body with rounded corners (bumpers and wings are round), so a gap a body wide between
  //: two cars -- bumper to bumper at the kerb, or nose to tail in a queue -- is walked through.
  //: A walker squeezes sideways between cars: a little narrower than their stride (CAR_SQUEEZE_M).
  function carsNear(x, z, r = 0.3) {
    const out = [];
    if (!ctx.enabled() || car.active || car.riding || transit.ride) return out;
    const rr = Math.min(r, CAR_SQUEEZE_M);
    const test = (id, v, model) => {
      const [vw, , vl] = VEHICLE_DIMS[model] || VEHICLE_DIMS.sedan;
      const dx = x - v.x, dz = z - v.z;
      if (Math.abs(dx) > vl && Math.abs(dz) > vl) return;
      if (carClearance(x, z, v.x, v.z, v.yaw, vw, vl) < rr) out.push({ id, fx: -Math.sin(v.yaw || 0), fz: -Math.cos(v.yaw || 0) });
    };
    for (const v of drawnCars) test(v.id, v, v.model);
    for (const b of routeBuses) test(b.id, b, b.model || "bus");
    if (taxi.at) test(taxi.at.id, taxi.at, "taxi");
    for (const [id, m] of [...parked, ...peerCars]) {
      if (m.parent) test(`mesh:${id}`, { x: m.position.x, z: m.position.z, yaw: m.rotation.y }, m.userData.model);
    }
    return out;
  }
  //: Whether a step from (x0, z0) to (x1, z1) walks into a car: one it is not already inside (a
  //: walker a car pulled up on, or dropped in a row of parked cars, may walk out, but not on
  //: through the next).
  function walkerBlocked(x1, z1, r = 0.3, x0 = null, z0 = null) {
    const next = carsAt(x1, z1, r);
    if (!next.length) return false;
    if (x0 === null) return true;
    const now = carsAt(x0, z0, r);
    return next.some((id) => !now.includes(id));
  }
  //: A step that walks into a car slid along it instead: along its side, or along its bumper
  //: (into the gap to the next car) -- whichever keeps more of the step. Null when neither does.
  function walkerSlide(x0, z0, x1, z1, r = 0.3) {
    const now = new Set(carsAt(x0, z0, r));
    const hit = carsNear(x1, z1, r).find((c) => !now.has(c.id));
    if (!hit) return [x1, z1];
    const dx = x1 - x0, dz = z1 - z0, along = dx * hit.fx + dz * hit.fz, across = dx * hit.fz - dz * hit.fx;
    const tries = [[hit.fx * along, hit.fz * along], [hit.fz * across, -hit.fx * across]];
    if (Math.abs(across) > Math.abs(along)) tries.reverse();
    for (const [sx, sz] of tries) {
      if (Math.hypot(sx, sz) < 1e-4) continue;
      if (!walkerBlocked(x0 + sx, z0 + sz, r, x0, z0)) return [x0 + sx, z0 + sz];
    }
    return null;
  }
  function hitInTraffic(before) {
    const [w, , l] = VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan;
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    const now = performance.now(), speed = Math.abs(car.speed);
    if (now - lastTrafficHit < 900) return;
    for (const q of visible.people) {
      if (q.indoors || q.down) continue;
      const dx = q.x - car.x, dz = q.z - car.z, a = dx * fx + dz * fz, b = dx * fz - dz * fx;
      if (Math.abs(a) < l / 2 + 0.35 && Math.abs(b) < w / 2 + 0.35) {
        lastTrafficHit = now;
        if (speed < 0.6) { ctx.moveAvatarTo(before.x, before.z, true); car.x = before.x; car.z = before.z; car.speed = 0; return; }
        const hitAt = { ...q };
        flings.set(q.id, { t0: now, x: q.x, z: q.z, dx: fx, dz: fz, speed, throw: Math.min(9, 1 + speed * 0.5) });
        jolts.set("me", { t0: now, speed });
        debrisAt(car.x + fx * l / 2, car.z + fz * l / 2, car.yaw, speed * 0.6);
        car.speed *= 0.55;
        send("collision", { kind: "hit_person", speed, npc: { id: hitAt.id, name: hitAt.person?.name, x: hitAt.x + fx * Math.min(9, 1 + speed * 0.5), z: hitAt.z + fz * Math.min(9, 1 + speed * 0.5), yaw: car.yaw } })
          .then((r) => { district.city?.forget(hitAt.id); notify(r.ok ? `You hit ${hitAt.person?.name || "someone"} at ${Math.round(speed * MPH)} mph: ${r.injury.type}.${r.bill ? ` Their care is billed to you: ${R.fmt(r.bill)}.` : ""}` : r.error); });
        return;
      }
    }
    for (const v of drawnCars) {
      const [vw, , vl] = VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan;
      const dx = v.x - car.x, dz = v.z - car.z;
      if (Math.hypot(dx, dz) > (l + vl) / 2 + 0.5) continue;
      if (!boxesOverlap(car.x, car.z, car.yaw, l / 2, w / 2, v.x, v.z, v.yaw, vl / 2, vw / 2)) continue;
      lastTrafficHit = now;
      const other = v.speed || 0, rel = Math.abs(speed - other * Math.cos(v.yaw - car.yaw));
      ctx.moveAvatarTo(before.x, before.z, true); car.x = before.x; car.z = before.z;
      car.speed = -Math.sign(car.speed) * Math.min(1.5, speed * 0.15);
      if (rel < 0.8) return;
      jolts.set(v.id, { t0: now, speed: rel }); district.drivers?.stop(v.id, { who: "me", speed: rel, x: v.x, z: v.z, yaw: v.yaw, until: Date.now() / 1000 + 8 });
      debrisAt((car.x + v.x) / 2, (car.z + v.z) / 2, car.yaw, rel);
      const owner = v.vehicle?.owner;
      send("collision", { kind: "hit_vehicle", speed: rel, other, vehicle: { id: v.id, plate: v.plate, x: v.x, z: v.z, yaw: v.yaw, driver: v.parked ? null : owner, driverName: district.roster?.people.get(owner)?.name } })
        .then((r) => {
          if (!r.ok) { notify(r.error); return; }
          if (owner) district.city?.forget(owner);
          notify(`Crash at ${Math.round(rel * MPH)} mph into ${v.plate || "a car"}: it is ${r.vehicle.state}${r.mine ? `, yours ${r.mine.state}` : ""}.${r.hurt ? ` -${r.hurt} health.` : ""}${r.bill ? ` Its repair is billed to you: ${R.fmt(r.bill)}.` : ""}`);
        });
      return;
    }
  }
  //: Tolls at gantries crossed, the lane you are in, the cameras you pass.
  function roadCharges(a, b, dt) {
    const now = Date.now();
    for (const g of gantriesCrossed(gantries, a, b, R.tolls.gantry_reach_m)) {
      if (now - (car.lastToll.get(g.name) || 0) < 120_000) continue;
      car.lastToll.set(g.name, now);
      send("toll", { gantry: g.id, name: g.name, occupants: occupants(), key: `${myId}:${g.id}:${Math.floor(now / 60000)}` })
        .then((r) => notify(r.ok ? `${r.plaza}: ${R.fmt(r.amount)}${r.carpool ? " (carpool)" : ""} ${r.paid_by === "fastrak" ? "on your FasTrak" : "— an invoice will be mailed to the plate's owner"}` : r.error));
    }
    if (lanes && Math.abs(car.speed) > 2) {
      const hit = lanes.at(car.x, car.z, car.yaw);
      const rule = hit?.managed ? lanes.rule(hit.seg, timeAt(now)) : null;
      const seg = hit?.managed && rule?.active ? hit.seg : null;
      if (seg !== car.laneSeg) { flushLane(); car.laneSeg = seg; car.laneRule = rule; car.laneKm = 0; car.laneSeen = null; }
      if (seg) {
        car.laneKm += Math.hypot(b.x - a.x, b.z - a.z) / 1000;
        // Whether anyone saw the car in the lane: a camera with it in view, a patrol car near.
        if (!car.laneSeen) car.laneSeen = witnessOf(R, b, { cameras: district.cameras, vehicles: visible.vehicles });
        if (car.laneKm > 1.5) flushLane(true);
      }
      car.lane = hit ? { lane: hit.lane, of: hit.seg.lanes, managed: hit.managed, kind: hit.seg.kind, minimum: hit.seg.min, active: rule?.active, ref: hit.seg.ref } : null;
    }
    // Speeding is fined only where it is seen (enforcement.mjs): in a speed camera's field of
    // view, or with a patrol car near. Nobody watching, nothing.
    const mph = Math.abs(car.speed) * MPH, limitMph = speedLimitAt(b.x, b.z) * MPH;
    if (mph - limitMph >= 11) {
      const seen = witnessOf(R, b, { cameras: district.cameras, vehicles: visible.vehicles });
      if (seen && now - (car.lastCam.get(seen.id) || 0) >= 120_000) {
        car.lastCam.set(seen.id, now);
        send("speed_camera", { over_mph: mph - limitMph, mph, camera: seen.kind === "camera" ? seen.id : undefined, witness: { kind: seen.kind, id: seen.id }, key: `${myId}:${seen.id}:${Math.floor(now / 60000)}` })
          .then((r) => r.ok && r.charged && notify(seen.kind === "camera" ? `Speed camera: ${Math.round(mph)} mph in a ${Math.round(limitMph)} — a ${R.fmt(r.charged)} notice will follow.`
            : `Pulled over by a patrol car: ${Math.round(mph)} mph in a ${Math.round(limitMph)} — a ${R.fmt(r.charged)} citation.`));
      }
    }
  }
  function flushLane(keep = false) {
    if (!car.laneSeg || car.laneKm < 0.05) return;
    const seg = car.laneSeg, km = car.laneKm;
    car.laneKm = 0;
    if (!keep) car.laneSeg = null;
    const seen = car.laneSeen;
    if (!keep) car.laneSeen = null;
    send("lane", { segment: seg.id, kind: seg.kind, minimum: seg.min, occupants: occupants(), km, active: true, witness: seen ? { kind: seen.kind, id: seen.id } : null, key: `${myId}:${seg.id}:${Math.floor(Date.now() / 30000)}` })
      .then((r) => { if (r.ok && r.charged) notify(seg.kind === "hov" ? `Carpool lane with ${occupants()} aboard: a ${R.fmt(r.charged)} violation notice.` : `Express lane: ${R.fmt(r.charged)}${r.paid_by === "fastrak" ? " on your FasTrak" : " — no tag: a toll evasion notice"}.`); });
  }
  function speedLimitAt(x, z) {
    const s = district.streets;
    if (!s) return SPEED_MS.residential;
    const n = s.nearest(x, z, "drive", 40);
    if (n === null) return SPEED_MS.residential;
    const cls = s.edges[n][0]?.cls || "residential";
    const law = (view || world)?.laws?.speed_limit_kmh_residential;
    if (cls === "residential" && law) return law / 3.6;
    return SPEED_MS[cls];
  }
  //: Riding in a party member's car: your walker goes where their car goes.
  function ride() {
    if (!car.riding || !party.session) return;
    const driver = party.session.players().find((p) => p.id === car.riding);
    if (!driver?.at || !driver.car?.driving) { car.riding = null; ctx.avatarVisible(true); notify("Your ride has ended."); refresh(); return; }
    ctx.moveAvatarTo(driver.at.x, driver.at.z, true);
  }

  // ---- other walkers' cars ---------------------------------------------------------------------
  function placePeerCar(peer, s) {
    const c = peer.car;
    let mesh = peerCars.get(peer.id);
    if (!c?.driving) { if (mesh) { mesh.removeFromParent(); peerCars.delete(peer.id); } peer.avatar.visible = !c?.riding; return; }
    if (!mesh || mesh.userData.model !== c.model) { mesh?.removeFromParent(); mesh = makeCar(c.model, c.colour); peerCars.set(peer.id, mesh); group.add(mesh); }
    mesh.position.set(s.x, s.y, s.z); mesh.rotation.y = s.yaw;
    peer.avatar.visible = false;
  }

  // ---- your body: the bars, walking and sprinting ------------------------------------------------
  const body = { walked: 0, sprint: 0, since: performance.now(), sprintHeld: false, sprinting: false, faintSeen: 0, reporting: false };
  const self = () => view?.players.get(myId) || null;
  //: How fast the bars let you walk: slowed when spent; Shift sprints while stamina lasts.
  function walkFactorNow() {
    const p = self();
    if (!p?.vitals || !ctx.enabled()) { body.sprinting = false; return 1; }
    const f = walkFactor(R, p.vitals, body.sprintHeld);
    body.sprinting = f.sprint;
    return f.factor;
  }
  //: The walk as the page made it: counted at a walker's pace however far the zoomed-out view
  //: carries the walker, and reported to the books every few seconds.
  function walked(metres, dt) {
    if (!self() || !(metres > 0)) return;
    body.walked += Math.min(metres, dt * 2.6 * (body.sprinting ? R.vitals.stamina.sprint_factor : 1));
    if (body.sprinting) body.sprint += dt;
  }
  function reportExertion() {
    const seconds = (performance.now() - body.since) / 1000;
    if (body.reporting || seconds < 4 || !self()) return;
    body.since = performance.now();
    if (body.walked < 0.5 && body.sprint <= 0) return;
    const args = { walked_m: Math.round(body.walked * 10) / 10, sprint_s: Math.round(body.sprint * 10) / 10, seconds: Math.min(60, seconds) };
    body.walked = 0; body.sprint = 0; body.reporting = true;
    send("exert", args).finally(() => { body.reporting = false; });
  }
  //: Out cold (the books say so): your car left where it stopped, and you wake where you were taken.
  function checkFainted() {
    const p = self();
    if (!p?.fainted || p.fainted.at <= body.faintSeen) return;
    const first = body.faintSeen === 0 && Date.now() - p.fainted.at > 60_000;
    body.faintSeen = p.fainted.at;
    if (first) return;   // an old faint, from before this page
    if (car.active) { car.mesh?.removeFromParent(); car.mesh = null; car.active = false; }
    car.riding = null; transit.ride = null;
    ctx.avatarVisible(true);
    if (p.fainted.x !== undefined) ctx.moveAvatarTo(p.fainted.x, p.fainted.z);
    notify(`You fainted (${p.fainted.cause}) and woke at ${p.fainted.place}. The ambulance bill is in Bills.`);
  }

  // ---- things on the ground: found on the pavement, or put down ---------------------------------
  //: The district's found things today: a seeded few on its pavements, the same for the party.
  function foundToday() {
    const day = timeAt(Date.now()).day;
    if (district.foundDay === day || !district.streets) return district.found || [];
    const r = rng(district.key, "found", day);
    const nodes = district.streets.nodes, walk = [];
    for (let i = 0; i < nodes.length; i += 1) if (!nodes[i].drive) walk.push(nodes[i]);
    const pool = walk.length ? walk : nodes;
    district.found = pool.length ? Array.from({ length: R.found.per_district }, (_, i) => {
      const n = pool[Math.floor(r() * pool.length) % pool.length];
      return { id: `found:${district.key}:${day}:${i}`, item: R.found.items[Math.floor(r() * R.found.items.length) % R.found.items.length], x: n.x + (r() - 0.5) * 1.6, z: n.z + (r() - 0.5) * 1.6, found: true };
    }) : [];
    district.foundDay = day;
    return district.found;
  }
  //: Everything lying near (x, z) that can be picked up: found things not yet taken, and things put down.
  function thingsNear(x, z, reach) {
    const w = view, out = [];
    for (const f of foundToday()) if (!w?.found?.has(f.id) && Math.abs(f.x - x) < reach && Math.abs(f.z - z) < reach) out.push(f);
    // A courier task's order, waiting outside the shop's door until you pick it up (G).
    const dl = self()?.delivery;
    if (dl?.stage === "pickup") {
      // Outside its door (where its people come out), else on the corner of the street by it.
      const at = district.city?.anchor(dl.from.id, null, { door: false }) || { x: dl.from.x, z: dl.from.z };
      if (Math.abs(at.x - x) < reach && Math.abs(at.z - z) < reach) out.push({ id: "courier", item: "parcel", qty: 1, ...at, courier: true });
    }
    // What a crash left in the road: a door, a bumper, a tyre, scrap.
    for (const d of debrisParts) if (d.item && d.vy === null && !w?.found?.has(d.id) && Math.abs(d.mesh.position.x - x) < reach && Math.abs(d.mesh.position.z - z) < reach) out.push({ id: d.id, item: d.item, qty: 1, x: d.mesh.position.x, z: d.mesh.position.z, found: true, debris: d });
    for (const t of w?.items?.values() || []) if (Math.abs(t.x - x) < reach && Math.abs(t.z - z) < reach) out.push(t);
    return out.map((t) => ({ ...t, d: Math.hypot(t.x - x, t.z - z) })).filter((t) => t.d < reach).sort((a, b) => a.d - b.d);
  }
  const MAX_THINGS = 96;
  const thingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_THINGS);
  thingMesh.name = "city-things"; thingMesh.count = 0; thingMesh.frustumCulled = false; thingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const thingRing = new THREE.InstancedMesh(new THREE.RingGeometry(0.42, 0.52, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, depthWrite: false }), MAX_THINGS);
  thingRing.count = 0; thingRing.frustumCulled = false; thingRing.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(thingMesh, thingRing);
  const thingColour = (id) => { const it = R.items[id] || {}; return it.use?.health > 0 && !it.use?.stamina ? "#e2483d" : it.use?.stamina ? "#e8a33b" : it.tool || it.material ? "#8b949c" : it.wear ? "#8e5bb5" : "#3c8fd6"; };
  function drawThings(now) {
    const p = me();
    const list = thingsNear(p.x, p.z, 160).slice(0, MAX_THINGS);
    list.forEach((t, i) => {
      const y = groundAt(t.x, t.z);
      E.set(0, now / 900 + i, 0); Q.setFromEuler(E);
      M.compose(V.set(t.x, y + 0.2 + Math.sin(now / 400 + i) * 0.05, t.z), Q, S3.set(1, 1, 1)); thingMesh.setMatrixAt(i, M);
      thingMesh.setColorAt(i, C.set(thingColour(t.item)));
      E.set(0, 0, 0); Q.setFromEuler(E); M.compose(V.set(t.x, y + 0.03, t.z), Q, S3.set(1, 1, 1)); thingRing.setMatrixAt(i, M);
    });
    thingMesh.count = thingRing.count = list.length;
    thingMesh.instanceMatrix.needsUpdate = thingRing.instanceMatrix.needsUpdate = true;
    if (thingMesh.instanceColor) thingMesh.instanceColor.needsUpdate = true;
  }
  //: G: bend down, take hold, stand up with it -- if you can lift it (handling.mjs: by strength).
  //: G: the nearest thing on the ground you can lift (the nearest of all, if none is light
  //: enough): a step or two over to it, then down for it -- knees bent, back forward, hands to
  //: the ground in front of your feet.
  async function pickUp() {
    const at = me(), pl = self();
    if (!pl || pose.kind || reach.t || car.active || transit.ride) return;
    const lift = liftKg(R, pl.vitals.strength), near = thingsNear(at.x, at.z, PICK_REACH_M);
    const t = near.find((x) => physOf(R, x.item).kg <= lift) || near[0];
    if (!t) { notify("Nothing within reach to pick up. Things on the ground have a yellow ring."); return; }
    ctx.faceTo?.(t.x, t.z);
    if (t.d > PICK_AT_M) { Object.assign(reach, { t, since: performance.now() }); return; }
    reachDown(t);
  }
  //: Walking over to what G is for: at a walk, round what is in the way; given up if it does not
  //: get there in a few seconds (something solid between).
  const PICK_REACH_M = 3.2, PICK_AT_M = 0.8;
  const reach = { t: null, since: 0 };
  //: One frame of it, run by the page's walker step (module 26) so the legs walk it: true while
  //: walking over (the page then leaves the walker's pose to this), false once there or given up.
  function stepReach(dt) {
    const t = reach.t;
    if (!t) return false;
    const at = me(), dx = t.x - at.x, dz = t.z - at.z, d = Math.hypot(dx, dz);
    if (d <= PICK_AT_M) { reach.t = null; ctx.faceTo?.(t.x, t.z); ctx.animateWalk?.(0); reachDown(t); return false; }
    if (car.active || transit.ride || performance.now() - reach.since > 4000) { reach.t = null; ctx.animateWalk?.(0); notify("Could not get to it: something is in the way."); return false; }
    const step = Math.min(1.3 * dt, d - PICK_AT_M + 0.05);
    const moved = ctx.moveWalker?.((dx / d) * step, (dz / d) * step) ?? step;
    ctx.faceTo?.(t.x, t.z);
    ctx.animateWalk?.(moved, dx / d, dz / d);
    return true;
  }
  function reachDown(t) {
    const pl = self();
    if (!pl) return;
    const ph = physOf(R, t.item), lift = liftKg(R, pl.vitals.strength);
    // Reach down for it either way: too heavy, you strain and let go.
    if (ph.kg > lift) { startAct("strain", 1.0, 0.7, () => notify(`${ph.name} (${ph.kg} kg) is too heavy for you to lift: you can lift ${Math.round(lift)} kg at strength ${Math.round(pl.vitals.strength)}. Workouts at a gym build strength.`)); return; }
    startAct("pickup", 0.85, 0.5, async () => {
      const r = t.courier ? await send("collect_delivery")
        : await send("pick_up", t.found ? { found: { id: t.id, item: t.item, x: t.x, z: t.z } } : { id: t.id });
      if (!r.ok) { notify(r.error); return; }
      if (t.debris) { t.debris.mesh.removeFromParent(); debrisParts.splice(debrisParts.indexOf(t.debris), 1); }
      if (t.courier) { notify(`Picked up the order (${ph.kg} kg). Now to ${self()?.delivery?.to.name || "the address"}: follow the green light; at the door you are asked to hand it over.`); syncSlots(true); return; }
      notify(`Picked up ${R.items[r.item].name.toLowerCase()}${r.qty > 1 ? ` x${r.qty}` : ""} — ${weightClass(R, ph.kg, pl.vitals.strength)}, ${ph.kg} kg (carrying ${r.carry.kg} of ${r.carry.capacity} kg).`);
      syncSlots(true);
    });
  }

  // ---- buses and taxis -------------------------------------------------------------------------
  // Buses run their real routes on a timetable (docs/city/transit.mjs), standing at each stop for
  // a few seconds: board at the stop while one stands there (Enter), ask for the next stop (Enter
  // again) and you are let off there. A taxi is called to where you stand (the top bar's Taxi) and
  // takes you where you ask, on the meter: Enter gets in, and out early.
  const transit = { ride: null };
  const TL = R.transit_lines;
  const KERB = LANE;
  let routeBuses = [];
  const taxi = { id: null, phase: null, route: null, d: 0, at: null, dest: null, n: 0 };
  //: Everything on wheels near you: the crowd's traffic, the route buses and your taxi.
  //: (Yours and the route buses first, so a crowded street's cap never leaves them out.)
  function wheels() { return taxi.at ? [taxi.at, ...routeBuses, ...visible.vehicles] : [...routeBuses, ...visible.vehicles]; }
  //: Where you stand from a vehicle: how far to its right (the door side, the kerb's) and along it.
  function besideOf(v, p) {
    const fx = -Math.sin(v.yaw || 0), fz = -Math.cos(v.yaw || 0), rx = -fz, rz = fx;
    return { right: (p.x - v.x) * rx + (p.z - v.z) * rz, along: (p.x - v.x) * fx + (p.z - v.z) * fz };
  }
  //: A bus is boarded from the pavement or the stop's island: its doors are on its right, at
  //: the kerb. From the road side, or from the roadway behind it, you cannot get on.
  const BUS_DOOR_SIDE_M = 1.2;
  let wrongSide = null;
  function fromKerbSide(v, p) {
    const b = besideOf(v, p), [w, , l] = VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan;
    return b.right > Math.max(BUS_DOOR_SIDE_M, w / 2) && Math.abs(b.along) < l / 2 + 1.5;
  }
  //: The bus (``kind`` "bus") or taxi ("taxi") you could get on here, nearest first.
  function nearestFare(kind = null) {
    const p = me();
    let best = null;
    wrongSide = null;
    for (const v of wheels()) {
      if (v.model !== "bus" && v.model !== "taxi") continue;
      if (kind && v.model !== kind) continue;
      const route = String(v.id).startsWith("bus:"), mine = v.id === taxi.id;
      if (route && !v.dwelling) continue;            // a route bus opens its doors at the stop
      if (mine && taxi.phase !== "waiting") continue;
      if (!route && !mine && district.lines?.length && v.model === "bus") continue;
      const reach = route || mine ? TL.board_reach_m : R.transit.board_reach_m;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < reach && v.model === "bus" && !fromKerbSide(v, p)) { wrongSide = v; continue; }
      if (d < reach && (!best || d < best.d)) best = { ...v, d };
    }
    return best;
  }
  //: The Taxi button: into the one pulled up for you (or one passing), out of the one you are in,
  //: and elsewhere the ride panel to call one. (Enter does the getting in and out too.)
  function taxiKey() {
    if (transit.ride) {
      if (transit.ride.route) { notify("On the bus: Enter asks for the next stop."); return; }
      return alight();
    }
    if (car.active || car.riding) { notify("Get out of the car first (Enter)."); return; }
    if (shop.place) { notify("Leave the shop first (Enter at its door)."); return; }
    const v = nearestFare("taxi");
    if (v) return board(v);
    openSide("ride");
  }
  async function board(v) {
    if (!v || transit.ride || car.active || car.riding || shop.place) return;
    const r = await send("board", { kind: v.model, vehicle: v.id });
    if (!r.ok) { notify(r.error); return; }
    transit.ride = { kind: v.model, vehicle: v.id, seen: performance.now(), km: 0, x: v.x, z: v.z, route: String(v.id).startsWith("bus:") ? v.route : null, from: v.stop ?? null, stop: false };
    if (v.id === taxi.id) taxiToDestination();
    ctx.avatarVisible(false);
    if (side?.kind === "ride") closeSide();
    notify(transit.ride.route ? `On the ${v.route} toward ${v.nextName || "the end of the line"}: ${R.fmt(R.transit.bus_fare)} paid. Enter asks for the next stop.`
      : v.id === taxi.id ? `In your taxi to ${taxi.dest?.name || "where you asked"}: ${R.fmt(R.transit.taxi_flag)} and ${R.fmt(R.transit.taxi_per_km)} a km.`
        : `In a taxi: ${R.fmt(R.transit.taxi_flag)} and ${R.fmt(R.transit.taxi_per_km)} a km. Enter to get out and pay.`);
    refresh();
  }
  function requestStop() {
    const ride = transit.ride;
    if (!ride?.route) return;
    ride.stop = !ride.stop;
    const v = routeBuses.find((x) => x.id === ride.vehicle);
    notify(ride.stop ? `Stop requested: off at ${v?.nextName || "the next stop"}.` : "Stop request cancelled.");
  }
  async function alight(v = null) {
    const ride = transit.ride;
    if (!ride) return;
    transit.ride = null;
    const r = await send("alight", { km: ride.km });
    ctx.avatarVisible(true);
    const p = me(), yaw = v?.yaw ?? ride.yaw ?? 0;
    // Out onto the pavement: at the stop's pole where it is on the door side, else off the door
    // side itself (the right, the kerb's) -- never into the road.
    const at = { x: v?.x ?? p.x, z: v?.z ?? p.z, yaw };
    const out = ride.kind === "bus" ? 2.8 : 1.9;
    if (v?.pole && Math.hypot(v.pole.x - at.x, v.pole.z - at.z) < 30 && besideOf(at, v.pole).right > 0.5) ctx.moveAvatarTo(v.pole.x, v.pole.z);
    else ctx.moveAvatarTo(at.x + Math.cos(yaw) * out, at.z - Math.sin(yaw) * out);
    if (ride.vehicle === taxi.id) Object.assign(taxi, { phase: null, route: null, at: null, dest: null });
    notify(r.ok ? (r.kind === "taxi" ? `Taxi: ${r.km.toFixed(1)} km, ${R.fmt(r.fare)}.` : `Off the bus${v?.stopName ? ` at ${v.stopName}` : ""}.`) : r.error);
    refresh();
  }
  //: Riding: you go where it goes. A route bus lets you off at the stop you asked for; a
  //: vehicle gone from the street (its trip over) lets you off where it was.
  function followRide() {
    const ride = transit.ride;
    if (!ride) return;
    const v = wheels().find((x) => x.id === ride.vehicle);
    if (!v) { if (performance.now() - ride.seen > 3000) alight(); return; }
    ride.seen = performance.now();
    ride.km += Math.hypot(v.x - ride.x, v.z - ride.z) / 1000;
    ride.x = v.x; ride.z = v.z; ride.yaw = v.yaw;
    ctx.moveAvatarTo(v.x, v.z);
    ctx.followYaw?.(v.yaw, 1 / 60);
    if (ride.route && v.dwelling && ride.stop && v.stop !== ride.from) alight(v);
    else if (ride.route && !v.dwelling) ride.from = -1;
  }
  //: A taxi called to where you stand, from a few hundred metres off, along the streets.
  function callTaxi(dest) {
    const s = district.streets;
    if (!s || !dest) return;
    if (transit.ride) { notify("You are riding already."); return; }
    const here = me();
    // It pulls up at the kerb beside you (on your side of the street), not at the corner.
    const stop = kerbStopNear(s, here.x, here.z, 80);
    const meNode = stop ? stop.from : s.nearest(here.x, here.z, "drive", 80);
    if (meNode === null || meNode === undefined) { notify("No street a taxi can reach here: walk to the kerb."); return; }
    const [lo, hi] = TL.taxi_hail_from_m, r = rng(myId, Date.now());
    let route = null;
    for (let k = 0; k < 600 && !route; k += 1) {
      const i = Math.floor(r() * s.nodes.length) % s.nodes.length, n = s.nodes[i];
      if (!n.drive) continue;
      const d = Math.hypot(n.x - here.x, n.z - here.z);
      if (d >= lo && d <= hi) route = s.route(i, meNode, "drive");
    }
    if (!route) { notify("No taxi can get to you here."); return; }
    if (stop) route = routeOnTo(route, stop);
    taxi.n += 1;
    Object.assign(taxi, { id: `taxi:${myId}:${taxi.n}`, phase: "coming", route, d: 0, dest, since: performance.now() });
    closeSide();
    notify(`A yellow taxi is on its way, about ${Math.max(1, Math.round(route.length / TL.taxi_speed_ms / 60))} min. Wait at the kerb; Enter to get in when it pulls up (it waits ${TL.taxi_max_wait_s} s).`);
  }
  //: The point on a street beside (x, z) that a car pulls up at for you: the nearest drivable
  //: way with you on its right (the kerb side), clear of the corners at its ends.
  function kerbStopNear(s, x, z, reach) {
    let best = null;
    const r = Math.ceil((reach + 120) / s.cell), cx = Math.floor(x / s.cell), cz = Math.floor(z / s.cell);
    for (let i = -r; i <= r; i += 1) for (let j = -r; j <= r; j += 1) {
      for (const id of s.grid.get(`${cx + i},${cz + j}`) || []) {
        const A = s.nodes[id];
        if (!A.drive || (s.reach && !s.reach.has(id))) continue;
        for (const e of s.edges[id]) {
          if (!e.drive || e.cls === "freeway") continue;
          const B = s.nodes[e.to], L = Math.hypot(B.x - A.x, B.z - A.z);
          if (L < 1) continue;
          const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L, side = (x - A.x) * -uz + (z - A.z) * ux;
          if (side <= 0) continue;
          const clear = Math.min(8, L / 2), t = Math.max(clear, Math.min(L - clear, (x - A.x) * ux + (z - A.z) * uz));
          const px = A.x + ux * t, pz = A.z + uz * t, d = Math.hypot(x - px, z - pz);
          if (d < reach && (!best || d < best.d)) best = { d, from: id, to: e.to, x: px, z: pz, half: e.half, cls: e.cls, park: e.park ?? null };
        }
      }
    }
    return best;
  }
  //: A route carried on from its last corner along the next street to a point on it (a new
  //: route: the streets' routes are cached and shared).
  function routeOnTo(route, stop) {
    const [lx, lz] = route.pts[route.pts.length - 1], add = Math.hypot(stop.x - lx, stop.z - lz);
    if (add < 0.5) return route;
    return { ...route, pts: [...route.pts, [stop.x, stop.z]], s: [...route.s, route.length + add], halves: [...(route.halves || []), stop.half],
      classes: [...(route.classes || []), stop.cls], parks: [...(route.parks || []), stop.park], ids: [...(route.ids || []), -1], length: route.length + add };
  }
  function taxiToDestination() {
    const s = district.streets, d = taxi.dest;
    const a = s?.nearest(taxi.at.x, taxi.at.z, "drive", 80), end = s && kerbStopNear(s, d.x, d.z, 120);
    const b = end ? end.from : s?.nearest(d.x, d.z, "drive", 250);
    let route = a !== null && a !== undefined && b !== null && b !== undefined ? s.route(a, b, "drive") : null;
    if (route && end) route = routeOnTo(route, end);
    taxi.phase = "riding"; taxi.d = 0;
    taxi.route = route || { pts: [[taxi.at.x, taxi.at.z]], s: [0], length: 0 };
  }
  function stepTaxi(dt) {
    if (!taxi.phase || !taxi.route) { taxi.at = null; return; }
    const R0 = taxi.route;
    if (taxi.phase !== "waiting") {
      // Slowing into the kerb at the end of the trip.
      const left = R0.length - taxi.d;
      taxi.d = Math.min(R0.length, taxi.d + Math.max(1.2, Math.min(TL.taxi_speed_ms, left / 2.5)) * dt);
    }
    const done = taxi.d >= R0.length - 0.05;
    const pos = alongRoute(R0, taxi.d, KERB);
    taxi.at = { id: taxi.id, model: "taxi", x: pos.x, z: pos.z, yaw: pos.yaw, speed: done ? 0 : TL.taxi_speed_ms, moving: !done, shade: 0 };
    if (done && taxi.phase === "coming") { taxi.phase = "waiting"; taxi.waitSince = performance.now(); notify(`Your taxi has pulled up: Enter to get in. It waits ${TL.taxi_max_wait_s} s.`); }
    // It waits so long and no longer: a fare that does not come out does not keep it all day.
    if (taxi.phase === "waiting" && performance.now() - taxi.waitSince > TL.taxi_max_wait_s * 1000) { Object.assign(taxi, { phase: null, route: null, at: null }); notify("The taxi gave up waiting and left."); }
    if (done && taxi.phase === "riding" && transit.ride?.vehicle === taxi.id && !taxi.paying) { taxi.paying = true; alight(taxi.at).finally(() => { taxi.paying = false; }); }
  }
  //: A bus at the stop you stand at waits for you to get on -- so long and no longer
  //: (transit_lines.bus_hold_s): held past its time, it runs that much behind (``busLag``) and
  //: makes it up on the road. Someone who does not get on does not keep it there for ever.
  const busLag = new Map(), busHeld = new Map();
  function holdBuses(dt) {
    const you = me(), aboard = transit.ride?.vehicle;
    for (const b of routeBuses) {
      if (!b.dwelling) {
        busHeld.delete(b.id);
        const lag = busLag.get(b.id);
        if (lag) { const left = lag - dt * 0.25; if (left > 0) busLag.set(b.id, left); else busLag.delete(b.id); }
        continue;
      }
      const waiting = !aboard && !car.active && !car.riding && Math.hypot(b.x - you.x, b.z - you.z) <= TL.bus_hold_reach_m;
      const held = busHeld.get(b.id) || 0;
      if (waiting && b.leaves < 1 && held < TL.bus_hold_s) {
        if (!held) notify(`The ${b.route} waits for you, ${TL.bus_hold_s} s at most: Enter to get on.`);
        busHeld.set(b.id, held + dt);
        busLag.set(b.id, (busLag.get(b.id) || 0) + dt);
      }
    }
  }
  //: When the next buses stand at ``stop`` ({x, z}): each route's next two, in seconds.
  function nextBuses(stop, ms) {
    const out = [], t = ms / 1000;
    for (const line of district.lines || []) {
      const k = line.stops.findIndex((c) => Math.hypot(c.x - stop.x, c.z - stop.z) < 35);
      if (k < 0) continue;
      const waits = [];
      for (let j = 0; j < line.buses; j += 1) {
        const phase = ((t + j * line.cycle / line.buses) % line.cycle + line.cycle) % line.cycle;
        for (const seg of line.timeline) {
          if (seg.kind !== "dwell" || seg.stop !== k) continue;
          const next = line.timeline[line.timeline.indexOf(seg) + 1];
          const wait = ((seg.t0 - phase) % line.cycle + line.cycle) % line.cycle;
          waits.push({ wait: phase >= seg.t0 && phase < seg.t1 ? 0 : wait, toward: next?.next !== undefined ? line.stops[next.next].name : "the end of the line" });
        }
      }
      waits.sort((a, b) => a.wait - b.wait);
      out.push({ route: line.route, next: waits.slice(0, 2) });
    }
    return out;
  }
  function nearestStop(reach = 80) {
    const p = me();
    let best = null;
    for (const s of district.stops || []) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < reach && (!best || d < best.d)) best = { ...s, d }; }
    return best;
  }
  // Bus stops: a pole and a flag at each, in Muni's red and yellow.
  const stopGroup = new THREE.Group(); stopGroup.name = "city-bus-stops"; group.add(stopGroup);
  function drawStops() {
    stopGroup.clear();
    const list = district.stops || [];
    if (!list.length) return;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.05, 2.9, 6).translate(0, 1.45, 0), lambert({ color: 0x9aa1a6 }), list.length);
    const flag = new THREE.InstancedMesh(box(0.05, 0.42, 0.62, 2.55), lambert({ color: 0xc8102e }), list.length);
    const band = new THREE.InstancedMesh(box(0.06, 0.1, 0.62, 2.84), lambert({ color: 0xf2c300 }), list.length);
    list.forEach((st, i) => { M.compose(V.set(st.x, groundAt(st.x, st.z), st.z), Q.identity(), S3.set(1, 1, 1)); pole.setMatrixAt(i, M); flag.setMatrixAt(i, M); band.setMatrixAt(i, M); });
    stopGroup.add(pole, flag, band);
  }

  // ---- delivery gigs ---------------------------------------------------------------------------
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 90, 24, 1, true).translate(0, 45, 0),
    new THREE.MeshBasicMaterial({ color: 0x35c46a, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  marker.name = "city-delivery"; marker.visible = false; marker.renderOrder = 3; group.add(marker);
  //: "42;44;48;50 Allen Street" as a person says it: "42 Allen Street".
  //: A building's address as said: its first number and its street ("2055,2057 Larkin Street, San
  //: Francisco, 94109" is "2055 Larkin Street").
  const address = (name) => (name ? String(name).replace(/^(\d+[A-Za-z]?)([;,]\s*\d+[A-Za-z]?)+/, "$1").split(",")[0].trim() : null);
  function deliveryHere(place) { const keys = place && new Set(place.keys); return Boolean(keys) && R.delivery.from.some((k) => keys.has(k)); }
  async function takeDelivery(place) {
    const [lo, hi] = R.delivery.distance_m;
    const homes = district.places.filter((x) => x.use === "residential" && x.id !== place.id).map((x) => ({ x, d: Math.hypot(x.x - place.x, x.z - place.z) })).filter((o) => o.d >= lo && o.d <= hi);
    if (!homes.length) { notify("No homes in the delivery area from here."); return; }
    const to = homes[Math.floor(Math.random() * homes.length)].x;
    const r = await send("take_delivery", { place, to: { id: to.id, x: to.x, z: to.z, name: address(to.name) } });
    if (!r.ok) { notify(r.error); return; }
    notify(`Delivery: a parcel to ${to.name || "a home"}, ${Math.round(r.delivery.km * 1000)} m away — ${R.fmt(r.delivery.pay)} if there in ${Math.round((r.delivery.due - Date.now()) / 60000)} min. Follow the green light; at the door you are asked to hand it over.`);
    refresh();
  }
  function drawMarker(now) {
    const g = objective();
    const d = g && Number.isFinite(g.x) && !g.label.startsWith("Errand") ? g : null;
    marker.visible = Boolean(d);
    if (!d) return;
    marker.material.color.setHex(d.colour || 0x35c46a);
    marker.position.set(d.x, groundAt(d.x, d.z), d.z);
    // A tree to fell: a ring at its foot, not a pillar of light. Wider seen from further off.
    const far = d.tree ? 0.35 : Math.max(1, Math.hypot(me().x - d.x, me().z - d.z) / 120);
    marker.scale.set(far, 1, far);
    marker.material.opacity = 0.35 + 0.12 * Math.sin(now / 300);
  }

  //: Having a booked service: at the place booked, from its panel, the action bar or the to-do list.
  async function useBooking(b) {
    const r = await send("use_booking", { booking: b.id });
    notify(r.ok ? `${R.items[b.item].name}: done.${effectText(R.items[b.item]) ? " " + effectText(R.items[b.item]) + "." : ""}` : r.error);
    todoKey = ""; drawTodo(); if (side?.kind === "store") drawSide();
  }
  // ---- work and rest -----------------------------------------------------------------------------
  async function workKey() {
    const p = self();
    if (!p?.job) { notify("No job: walk up to a shop that is hiring and take one (Enter, then the SHOP panel by the door; or the City panel's Here tab)."); return; }
    const place = district.placeById?.get(p.job.place.id), was = Boolean(p.clocked);
    const r = await send(was ? "clock_out" : "clock_in", was ? {} : { spots: place ? spotsFor(place) : null });
    notify(r.ok ? (was ? "Clocked out and paid for the time worked." : `At work as ${p.job.title.toLowerCase()}: tasks come every minute or so (V where the orange ring is). Paid ${R.fmt(p.job.pay / 6)} a 10 minutes worked, tax held back; idle 30 minutes and you are sent home.`) : r.error);
  }
  //: A bed within reach (the rooms' furniture round you), and whether it is in your home.
  function bedHere() {
    const at = me(), bed = ctx.bedsNear?.(at.x, at.z, 2.5)?.[0];
    if (!bed) return null;
    const p = self(), home = Boolean(p?.home && (bed.building === String(p.home.building) || Math.hypot(bed.x - p.home.x, bed.z - p.home.z) < R.vitals.home_reach_m));
    return { ...bed, home };
  }
  async function restKey() {
    const p = self();
    if (!p) return;
    if (!p.resting) {
      const bed = bedHere();
      if (!bed) { notify("Z lies down at a bed: go into a home (Enter at its door) and stand beside one."); return; }
      const r = await send("rest", { on: true, bed: { building: bed.building, home: bed.home } });
      notify(r.ok ? (r.home ? "In bed at home: stamina comes back fastest. Walk on to get up." : "Lying down: stamina comes back. Walk on to get up.") : r.error);
      return;
    }
    const r = await send("rest", { on: false });
    if (r.ok) notify("Up again.");
  }

  // ---- inside a shop -------------------------------------------------------------------------------
  // A shop's room behind its front: the floor, the walls (the front one glass), the counter across
  // it, shelves at the back, tables where it serves food; the staff on shift behind the counter
  // and the customers in front of it (people.mjs: indoorSpot). Seen through your own eyes.
  const shop = { place: null, room: null, frame: null, was: false, staff: false };
  const SHOP_TINT = { cafe: 0x8b5a3c, coffee: 0x8b5a3c, bakery: 0xb07a4a, restaurant: 0x6e3b2a, bar: 0x3d2a22, pub: 0x3d2a22, pharmacy: 0xdfe6ea, chemist: 0xdfe6ea,
    hardware: 0x7d8a6a, doityourself: 0x7d8a6a, supermarket: 0xd9d4c6, convenience: 0xd9d4c6, clothes: 0xcbb9a8, books: 0x7a5a3a, florist: 0x6f9a6a };
  function shopFrame(place) {
    const I = place.front || place.inside;
    if (!I) return null;
    const L = counterLine(I);
    const D = Math.min(I.depth, 14), W = Math.max(3, Math.min(12, I.half * 2));
    // Local frame: u inward from the front, v along it (to the right seen from the street).
    const lx = I.nz, lz = -I.nx;
    const y = groundAt(I.x - I.nx * 0.8, I.z - I.nz * 0.8);
    const at = (u, v) => ({ x: I.x + I.nx * u + lx * v, z: I.z + I.nz * u + lz * v });
    return { I, L, D, W, lx, lz, y, at, local: (x, z) => ({ u: (x - I.x) * I.nx + (z - I.z) * I.nz, v: (x - I.x) * lx + (z - I.z) * lz }) };
  }
  //: The checkout panel's face: what it is and what to do, at the panel's own shape (0.8 x 0.5 m).
  function panelTexture() {
    const c = doc.createElement("canvas"); c.width = 512; c.height = 320;
    const g = c.getContext("2d"); g.fillStyle = "#1f6feb"; g.fillRect(0, 0, 512, 320);
    g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "700 112px system-ui,sans-serif"; g.fillText("SHOP", 256, 128);
    g.font = "500 40px system-ui,sans-serif"; g.fillText("click: wares, prices, checkout", 256, 236);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace || t.colorSpace; return t;
  }
  function signTexture(text, bg = "#1d2a33", fg = "#f6f1e7") {
    const c = doc.createElement("canvas"); c.width = 512; c.height = 96;
    const g = c.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
    g.fillStyle = fg; g.font = "600 46px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(text).slice(0, 22), 256, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace || t.colorSpace; return t;
  }
  //: A window pane's surface: grey grain and a few faint smears, tiled; drawn once. The page's
  //: own panes wear the same (paneGlassTexture, module 25).
  let paneMap = null;
  function paneTexture() {
    if (paneMap) return paneMap;
    const c = doc.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), image = g.createImageData(128, 128), r = rng("pane");
    for (let i = 0; i < 128 * 128; i += 1) {
      const shade = 196 + Math.round((r() - 0.5) * 56);
      image.data.set([shade, shade + 3, shade + 5, 130 + Math.round(r() * 125)], i * 4);
    }
    g.putImageData(image, 0, 0);
    for (let k = 0; k < 6; k += 1) {
      const x = r() * 128, y = r() * 128, s = g.createRadialGradient(x, y, 0, x, y, 18 + r() * 34);
      s.addColorStop(0, "rgba(246,248,249,0.3)"); s.addColorStop(1, "rgba(246,248,249,0)");
      g.fillStyle = s; g.fillRect(0, 0, 128, 128);
    }
    paneMap = new THREE.CanvasTexture(c); paneMap.colorSpace = THREE.SRGBColorSpace || paneMap.colorSpace;
    paneMap.wrapS = paneMap.wrapT = THREE.RepeatWrapping;
    return paneMap;
  }
  function buildRoom(place, F) {
    const g = new THREE.Group(); g.name = "city-shop-room";
    g.position.set(F.I.x, F.y, F.I.z); g.rotation.y = Math.atan2(F.I.nx, F.I.nz);
    const kind = place.shops[0] || "shop";
    const tint = SHOP_TINT[kind] ?? 0xcfc6b8;
    // Unlit colours, shaded by hand: a light added to the scene would recompile every material in it.
    const flat = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
    const lambert = (o) => flat(o.color, o.side ? { side: o.side } : {});
    const wall = flat(0xe4ddd1, { side: THREE.BackSide }), sideWall = flat(0xd3cbbd, { side: THREE.BackSide });
    const floor = flat(0x8a6f55, { side: THREE.BackSide });
    const ceiling = flat(0xf4f2ee, { side: THREE.BackSide });
    // The shop window as the houses' are (module 25, WINDOW_GLASS): grey, a little worn, and
    // softening the street seen through it -- not a pane that could be taken for an open front.
    const glass = new THREE.MeshBasicMaterial({ color: 0x9aa2a6, map: paneTexture(), transparent: true, opacity: 0.34, side: THREE.BackSide, depthWrite: false });
    // Box faces: +x, -x, +y, -y, +z (the back wall), -z (the front, glass).
    const shell = new THREE.Mesh(new THREE.BoxGeometry(F.W, 3.2, F.D).translate(0, 1.6, F.D / 2), [sideWall, sideWall, ceiling, floor, wall, glass]);
    g.add(shell);
    const counter = new THREE.Mesh(box(F.L.width * 2, 1.0, 0.62, 0.5), lambert({ color: tint }));
    counter.position.z = F.L.counter; counter.rotation.y = 0; g.add(counter);
    const top = new THREE.Mesh(box(F.L.width * 2 + 0.1, 0.05, 0.72, 1.02), lambert({ color: 0xe9e4da })); top.position.z = F.L.counter; g.add(top);
    const till = new THREE.Mesh(box(0.42, 0.28, 0.36, 1.19), lambert({ color: 0x24292e })); till.position.set(F.L.width * 0.5, 0, F.L.counter); g.add(till);
    // Shelves along the back wall, stocked.
    const shelfZ = Math.min(F.D - 0.3, F.L.back + 0.6);
    for (const h0 of [0.45, 1.05, 1.65]) {
      const shelf = new THREE.Mesh(box(F.W - 0.6, 0.04, 0.4, h0), lambert({ color: 0x6b5440 })); shelf.position.z = shelfZ; g.add(shelf);
      const n = Math.max(4, Math.floor((F.W - 0.8) / 0.32));
      const goods = new THREE.InstancedMesh(box(0.22, 0.26, 0.22, 0.13), lambert({ color: 0xffffff }), n);
      const r = rng(place.id, "goods", h0);
      for (let k = 0; k < n; k += 1) {
        M.compose(V.set(-F.W / 2 + 0.5 + k * ((F.W - 1) / Math.max(1, n - 1)), h0 + 0.02, shelfZ), Q.identity(), S3.set(0.8 + r() * 0.4, 0.6 + r() * 0.8, 1));
        goods.setMatrixAt(k, M); goods.setColorAt(k, C.setHSL(r(), 0.45, 0.5));
      }
      g.add(goods);
    }
    // Tables toward the window where it serves food or drink.
    if (["cafe", "coffee", "restaurant", "bar", "pub", "bakery", "fast_food", "ice_cream"].includes(kind) && F.L.front > 1.4) {
      const tables = Math.max(1, Math.floor(F.W / 2.2));
      for (let k = 0; k < tables; k += 1) {
        const tx = -F.W / 2 + (k + 0.5) * (F.W / tables);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8).translate(0, 0.36, 0), lambert({ color: 0x3a3a3a })); leg.position.set(tx, 0, 0.9); g.add(leg);
        const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16).translate(0, 0.74, 0), lambert({ color: 0xd8cbb5 })); tableTop.position.set(tx, 0, 0.9); g.add(tableTop);
      }
    }
    // The shop's name over the counter, and a light to see it all by.
    const stores = storesAt(R, place.keys);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(F.W - 0.4, 3.2), 0.6), new THREE.MeshBasicMaterial({ map: signTexture(stores[0]?.name || place.name || "Shop"), side: THREE.DoubleSide }));
    sign.position.set(0, 2.55, Math.min(F.D - 0.05, shelfZ + 0.18)); sign.rotation.y = Math.PI; g.add(sign);
    for (const lx0 of [-F.W / 4, F.W / 4]) { const lamp = new THREE.Mesh(box(0.9, 0.05, 0.25, 3.15, lx0), flat(0xfffbe8)); lamp.position.z = F.D / 2; g.add(lamp); }
    // Beside the door, on a stretch of solid wall (not the window): the shop's checkout panel.
    // Clicked, it opens the shop's wares, prices and the basket.
    const side0 = Math.min(F.W / 2 - 0.5, 1.25);
    const pier = new THREE.Mesh(box(0.9, 3.2, 0.14, 1.6), flat(0xd8d0c2)); pier.position.set(side0, 0, 0.07); g.add(pier);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ map: panelTexture(), side: THREE.FrontSide }));
    panel.position.set(side0, 1.8, 0.152); panel.name = "city-shop-panel"; panel.userData.cityShopPanel = true; g.add(panel);
    // Its frame (box y is the centre), just behind the panel's face, on the pier's.
    const frame = new THREE.Mesh(box(0.88, 0.58, 0.01, 1.8), flat(0x24292e)); frame.position.set(side0, 0, 0.145); g.add(frame);
    g.userData.panel = panel;
    return g;
  }
  //: Into the shop beside you: through its door, into the room, the counter in front of you.
  //: Enter at the door of a building with a shop in it (the page's door, module 24): into the
  //: shop's room, or its counter where it has none; false where no shop of the city's is there.
  function enterBuilding(id) {
    if (!self() || car.active || transit.ride) return false;
    const place = district.places?.find((pl) => String(pl.id) === String(id) && storesAt(R, pl.keys).length);
    if (!place) { notify("Closed: nothing here sells to the public."); return false; }
    if (!(place.front && enterShop(place))) openStore(place);
    return true;
  }
  function enterShop(place, { asStaff = false } = {}) {
    const F = shopFrame(place);
    if (!F) return false;
    if (car.active || transit.ride) return false;
    leaveShop(true);
    shop.place = place; shop.frame = F; shop.staff = asStaff || isMyWorkplace(place);
    shop.room = buildRoom(place, F); group.add(shop.room);
    ctx.setFloor?.(F.y);
    shop.was = Boolean(ctx.isFirstPerson?.());
    ctx.firstPerson?.(true);
    // A couple of steps in: turned round, the checkout panel by the door is in plain view.
    const start = F.at(Math.max(0.9, Math.min(1.9, F.L.counter - 0.7)), 0);
    ctx.placeAvatar(start.x, F.y, start.z, Math.atan2(-F.I.nx, -F.I.nz));
    ctx.setPitch?.(-0.06);
    notify(`In ${storesAt(R, place.keys).map((x) => x.name).join(" and ") || place.name || "the shop"}. To buy, click the blue SHOP panel beside the door (behind you)${shop.staff ? "; V for your task" : ""}. Enter at the door, or walking out, leaves.`);
    refresh();
    return true;
  }
  function leaveShop(quiet = false) {
    if (!shop.place) return;
    const F = shop.frame;
    shop.room?.removeFromParent();
    shop.room?.traverse((o) => { o.geometry?.dispose?.(); if (o.material) for (const m of [].concat(o.material)) { m.map?.dispose?.(); m.dispose?.(); } });
    shop.place = null; shop.room = null; shop.frame = null;
    ctx.setFloor?.(null);
    if (!shop.was) ctx.firstPerson?.(false);
    ctx.moveAvatarTo(F.I.x - F.I.nx * 1.6, F.I.z - F.I.nz * 1.6);
    if (side?.kind === "store") closeSide();
    if (!quiet) notify("Back out on the street.");
    refresh();
  }
  function isMyWorkplace(place) { const j = self()?.job; return Boolean(j && place && j.place.id === place.id); }
  //: Walking inside: the arrows as outside, kept to the room (and in front of the counter, unless
  //: you work here); walking back out through the front leaves.
  function walkInside(dt, held) {
    const F = shop.frame;
    if (!F) return false;
    // On the shop's floor, whatever the ground under the building is.
    if (!air.up && Math.abs(me().y - ctx.standY - F.y) > 0.05) ctx.placeAvatar(me().x, F.y, me().z);
    if (!held.size) { ctx.animateWalk?.(0); return true; }
    const yaw = ctx.getYaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    let mx = 0, mz = 0;
    if (held.has("ArrowUp")) { mx += fx; mz += fz; }
    if (held.has("ArrowDown")) { mx -= fx; mz -= fz; }
    if (held.has("ArrowRight")) { mx += rx; mz += rz; }
    if (held.has("ArrowLeft")) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (!len) { ctx.animateWalk?.(0); return true; }
    const speed = 1.5 * walkFactorNow();
    const p = me();
    const want = F.local(p.x + mx / len * speed * dt, p.z + mz / len * speed * dt);
    if (want.u < 0.15) { leaveShop(); return true; }
    const behind = shop.staff || isMyWorkplace(shop.place);
    const was = F.local(p.x, p.z);
    // The counter is in the way, but for its gap at the right-hand end where staff go through.
    const gap = Math.abs(want.v - F.L.width) < 0.55 || want.v > F.L.width;
    const crossing = (was.u < F.L.counter) !== (want.u < F.L.counter);
    let u = want.u;
    if (crossing && !(behind && gap)) u = was.u;
    if (!behind) u = Math.min(u, F.L.counter - 0.45);
    u = Math.max(0.2, Math.min(F.D - 0.35, u));
    const v = Math.max(-F.W / 2 + 0.3, Math.min(F.W / 2 - 0.3, want.v));
    const at = F.at(u, v);
    ctx.placeAvatar(at.x, F.y, at.z);
    const stepped = Math.hypot(at.x - p.x, at.z - p.z);
    // Legs that walk it, facing the way (a shop's floor glided like the walk over to a thing did).
    ctx.animateWalk?.(stepped, (at.x - p.x) / (stepped || 1), (at.z - p.z) / (stepped || 1));
    walked(stepped, dt);
    return true;
  }

  // ---- a shift's work ------------------------------------------------------------------------------
  // Each task is done where it is: at the counter (behind it), in the back, or at the kerb out
  // front. Walk there and press V; stay till the bar fills. A stretch of a shift with nothing
  // done is not paid, and three of them in a row send you home (world.mjs).
  const taskRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff9f1c, fog: false }));
  const taskPin = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: 0xff9f1c, fog: false }));
  taskRing.visible = taskPin.visible = false; taskRing.name = "city-task"; group.add(taskRing, taskPin);
  let working = null;   // {id, started, seconds}
  function spotsFor(place) {
    const F = place && shopFrame(place);
    const node = place && district.streets?.nodes[place.node];
    const kerb = F ? F.at(-1.4, 0) : node ? { x: node.x, z: node.z } : { x: place.x, z: place.z };
    if (!F) return { counter: kerb, back: kerb, kerb };
    return { counter: F.at(F.L.staff, 0), back: F.at(F.L.back, -F.L.width * 0.4), kerb };
  }
  const taskInside = (task) => ["counter", "back"].includes(task?.where) && shopFrame(district.placeById?.get(self()?.job?.place.id) || {});
  async function taskKey() {
    const p = self(), task = p?.clocked?.task;
    if (!p?.clocked) { notify(p?.job ? "Clock in first (J) at your work." : "No job: take one at a shop that is hiring."); return; }
    if (!task) { notify(`Nothing to do this minute: the next task comes soon (${p.clocked.tasks_total || 0} done this shift).`); return; }
    const d = Math.hypot(me().x - task.x, me().z - task.z);
    if (d > R.work_tasks.task_reach_m) {
      const place = district.placeById?.get(p.job.place.id);
      if (taskInside(task) && !shop.place && place && Math.hypot(me().x - place.x, me().z - place.z) < 40) { enterShop(place, { asStaff: true }); return; }
      notify(`${task.label}: the orange ring, ${Math.round(d)} m ${task.where === "kerb" ? "out front" : task.where === "back" ? "in the back" : "behind the counter"}.`);
      return;
    }
    if (working?.id === task.id) return;
    const r = await send("task", {});
    if (!r.ok) { notify(r.error); return; }
    working = { id: task.id, started: performance.now(), seconds: task.seconds, label: task.label };
    notify(`${task.label}…`);
  }
  async function stepWork() {
    const p = self(), task = p?.clocked?.task;
    if (!working) return;
    if (!task || task.id !== working.id) { working = null; return; }
    const d = Math.hypot(me().x - task.x, me().z - task.z);
    if (d > R.work_tasks.task_reach_m * 1.6) { working = null; notify(`Stopped: ${task.label.toLowerCase()} is not done.`); return; }
    if ((performance.now() - working.started) / 1000 < working.seconds || working.sending) return;
    working.sending = true;
    const r = await send("task", { done: true });
    working = null;
    notify(r.ok ? `Done: ${task.label.toLowerCase()}${r.tip ? ` (+${R.fmt(r.tip)} tip)` : ""}. ${r.done} this shift.` : r.error);
  }
  function drawTask(now) {
    const task = self()?.clocked?.task;
    const on = Boolean(task && task.x !== undefined);
    taskRing.visible = taskPin.visible = on;
    if (!on) return;
    const inside = taskInside(task) && shop.frame;
    const y = inside ? shop.frame.y : groundAt(task.x, task.z);
    taskRing.position.set(task.x, y + 0.05, task.z);
    taskPin.position.set(task.x, y + 1.9 + Math.sin(now / 300) * 0.1, task.z); taskPin.rotation.y = now / 500;
  }

  // ---- errands ---------------------------------------------------------------------------------------
  // A neighbour wants something from the shops: buy it, bring it to their door (a Yes / No there), and they
  // pay you back what it cost and a fee by the distance.
  const errandMarker = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 70, 20, 1, true).translate(0, 35, 0),
    new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  errandMarker.visible = false; errandMarker.renderOrder = 3; errandMarker.name = "city-errand"; group.add(errandMarker);
  //: This hour's errands near you: a few residents, each wanting one to three things sold here.
  function errandOffers() {
    const E = R.errands, here = me(), hour = Math.floor(Date.now() / 3_600_000);
    const sold = new Set();
    for (const pl of district.places) for (const st of storesAt(R, pl.keys)) for (const id of st.items) sold.add(id);
    const wanted = E.items.filter((i) => sold.has(i) && R.items[i]);
    const homes = district.places.filter((x) => x.use === "residential").map((x) => ({ x, d: Math.hypot(x.x - here.x, x.z - here.z) }))
      .filter((o) => o.d >= E.distance_m[0] && o.d <= E.distance_m[1]);
    if (!wanted.length || !homes.length) return [];
    const r = rng(district.key, myId, hour), out = [];
    for (let k = 0; k < E.offers; k += 1) {
      const home = homes[Math.floor(r() * homes.length) % homes.length].x;
      const who = district.people.find((x) => x.home === home.id) || district.people[Math.floor(r() * district.people.length) % district.people.length];
      const n = 1 + Math.floor(r() * 3), items = [];
      for (let j = 0; j < n; j += 1) items.push(wanted[Math.floor(r() * wanted.length) % wanted.length]);
      const km = Math.hypot(home.x - here.x, home.z - here.z) / 1000;
      out.push({ id: `${hour}:${k}`, to: { id: home.id, x: home.x, z: home.z, name: address(home.name), who: who?.name || null }, items, km,
        cost: items.reduce((a, i) => a + R.items[i].price, 0), fee: E.fee_base + Math.round(E.fee_per_km * km) });
    }
    return out;
  }
  function drawErrand(now) {
    const e = self()?.errand;
    errandMarker.visible = Boolean(e);
    if (!e) return;
    errandMarker.position.set(e.to.x, groundAt(e.to.x, e.to.z), e.to.z);
    const far = Math.max(1, Math.hypot(me().x - e.to.x, me().z - e.to.z) / 120);
    errandMarker.scale.set(far, 1, far);
    errandMarker.material.opacity = 0.3 + 0.12 * Math.sin(now / 340);
  }

  // ---- what is in your hands, and a blow with it ----------------------------------------------------
  // The catalogue's things near you (benches, lights, bins, trees, windows…) each take a blow by
  // what you strike with and how strong you are, against what they are made of (rules.json: tools);
  // they break once the energy taken reaches their break energy (object-catalogue.json). Broken
  // things are gone until the city mends them; breaking what is not yours, seen, is vandalism.
  // ---- the body: holding, lifting, swinging, throwing, jumping ----------------------------------
  // How each thing is held (rules.json items' hold: in a hand, a tool by its handle, in both arms in
  // front, or on the shoulder) and what the arms do on top of the walk: bend down and lift (G),
  // strain at what is too heavy, swing (X), throw (Q), jump (Space). Poses are turns of the arm,
  // forearm and spine bones about the walker's own axes, over the walking clip (module 26 calls
  // afterPose after the clip each frame).
  const MAT_COLOUR = { glass: 0x9fd3e6, steel: 0x8b949c, aluminium: 0xc4c9ce, lumber: 0xc29a62, food: 0xe8a33b, liquid: 0x6b3f22, paper: 0xf1efe8,
    fabric: 0x8e5bb5, plastic: 0x3c8fd6, plant: 0x4f9a4a, ceramic: 0xb5653f, bag: 0xb9a37a, cardboard: 0xb98d55, masonry: 0x9c4a32, concrete: 0x9a9a96, rubber: 0x222222 };
  function thingMeshOf(id) {
    const ph = physOf(R, id), it = R.items[id] || {}, g = new THREE.Group(), col = MAT_COLOUR[ph.material] ?? 0x3c8fd6;
    const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
    if (it.strike) {
      const long = it.strike === "sledgehammer" || it.strike === "axe";
      const handle = new THREE.Mesh(box(0.04, long ? 0.85 : 0.38, 0.04, 0), mat(0x7a5230));
      const head = new THREE.Mesh(box(it.strike === "saw" ? 0.02 : 0.14, it.strike === "saw" ? 0.32 : 0.08, it.strike === "saw" ? 0.12 : 0.06, long ? 0.42 : 0.2), mat(0x8b949c));
      g.add(handle, head);
    } else if (id === "car_tire") {
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.1, 8, 16), mat(0x1e1e1e)));
    } else {
      const [w, hgt, d] = sizeOf(ph);
      // A tool from the hand up; a load on the shoulder balanced on it, as much ahead as behind.
      g.add(new THREE.Mesh(ph.hold === "tool" ? box(w, hgt, d, hgt / 2) : box(w, hgt, d, 0), mat(col, ph.material === "glass" ? { transparent: true, opacity: 0.7 } : {})));
    }
    g.userData.ph = ph;
    return g;
  }
  let heldMesh = null, heldItem = null, heldHidden = false, lastStrike = 0;
  function drawHeld() {
    const item = self()?.hands || null;
    if (heldMesh) heldMesh.visible = !heldHidden;
    // Swung from the shoulder or the side: carried there again once the swing is over.
    if (heldMesh?.userData.swungFromRest && pose.kind !== "swing") { heldMesh.removeFromParent(); heldItem = undefined; }
    if (item === heldItem && (!heldMesh || heldMesh.parent)) return;
    heldItem = item;
    heldMesh?.removeFromParent(); heldMesh = null;
    if (!item) return;
    const ph = physOf(R, item);
    heldMesh = thingMeshOf(item); heldMesh.name = "city-held";
    const s = ctx.avatar.scale.x || 1, up = (m) => (m - ctx.standY) / s;
    const hand = ph.hold === "hand" || ph.hold === "tool" ? ctx.hand?.() : null;
    if (hand) { heldMesh.scale.setScalar(1 / Math.max(1e-3, hand.getWorldScale(new THREE.Vector3()).x)); hand.add(heldMesh); return; }
    // Not in a hand: carried against the body, in the walker's own frame (+z ahead, -x its right).
    heldMesh.scale.setScalar(1 / s);
    if (ph.hold === "two_hands") heldMesh.position.set(0, up(1.02), 0.36 / s);
    else if (ph.hold === "shoulder") { heldMesh.position.set(-0.2 / s, up(1.52), 0); heldMesh.rotation.x = Math.PI / 2; }
    else heldMesh.position.set(-0.3 / s, up(0.95), 0.1 / s);
    ctx.avatar.add(heldMesh);
  }
  //: What the arms are doing: null, or {kind: pickup | strain | swing | throw, t0, dur, at (the
  //: share of it when ``fn`` runs: the grip, the blow, the release), fn}.
  const pose = { kind: null, t0: 0, dur: 0, at: 0, fn: null, fired: false };
  function startAct(kind, dur, at, fn) {
    Object.assign(pose, { kind, t0: performance.now(), dur: dur * 1000, at, fn, fired: false });
  }
  const air = { y: 0, v: 0, up: false };
  function stepBody(dt) {
    if (pose.kind) {
      const t = (performance.now() - pose.t0) / pose.dur;
      if (!pose.fired && t >= pose.at) { pose.fired = true; try { pose.fn?.(); } catch (error) { console.warn(error); } }
      if (t >= 1) pose.kind = null;
    }
    if (air.up) {
      air.y += air.v * dt; air.v -= 9.81 * dt;
      if (air.y <= 0) { air.y = 0; air.v = 0; air.up = false; }
    }
    // Bent down to lift: the hips go down as the back bends.
    const t = pose.kind ? Math.min(1, (performance.now() - pose.t0) / pose.dur) : 0;
    const bend = pose.kind === "pickup" || pose.kind === "strain" ? Math.sin(Math.PI * t) : 0;
    ctx.avatar.userData.lift = air.y - 0.32 * bend;
  }
  //: Space: up by your legs' push against your weight and what you carry (handling.mjs jumpOf).
  function jumpKey() {
    const p = self();
    if (air.up || car.active || car.riding || transit.ride || p?.resting) return;
    // Not in the city (on the map, not joined): your legs at the start's strength, nothing carried.
    const load = !p ? 0 : view.carry ? view.carry(p).kg : carriedKg(R, p.inventory);
    const j = jumpOf(R, p ? p.vitals.strength : R.vitals.start.strength, load);
    if (j.height < 0.03) { notify(`Carrying ${load} kg, you can barely leave the ground.`); return; }
    air.up = true; air.v = j.speed; air.y = 0.001;
  }
  // The bones the poses turn: the clip's (a Mixamo-named figure) or the drawn walker's limbs.
  let bones = null, bonesOf = null;
  function rigBones() {
    const a = ctx.avatar, key = a.getObjectByName?.("imported-realistic-demo-character")?.uuid || a.children.length;
    if (bones && bonesOf === key) return bones;
    const find = (...names) => { for (const n of names) { const o = a.getObjectByName?.(n); if (o?.parent) return o; } return null; };
    bones = {
      rUpper: find("mixamorigRightArm", "RightArm", "upperarm_r", "UpperArm_R") || a.userData.rightArm || null,
      rFore: find("mixamorigRightForeArm", "RightForeArm", "lowerarm_r", "LowerArm_R"),
      lUpper: find("mixamorigLeftArm", "LeftArm", "upperarm_l", "UpperArm_L") || a.userData.leftArm || null,
      lFore: find("mixamorigLeftForeArm", "LeftForeArm", "lowerarm_l", "LowerArm_L"),
      spine: find("mixamorigSpine1", "mixamorigSpine", "Spine1", "Spine", "spine_02", "spine_01"),
      rThigh: find("mixamorigRightUpLeg", "RightUpLeg", "thigh_r", "Thigh_R"), rShin: find("mixamorigRightLeg", "RightLeg", "calf_r", "Calf_R"),
      lThigh: find("mixamorigLeftUpLeg", "LeftUpLeg", "thigh_l", "Thigh_L"), lShin: find("mixamorigLeftLeg", "LeftLeg", "calf_l", "Calf_L"),
      rHand: find("mixamorigRightHand", "RightHand", "hand_r", "Hand_R"),
      lHand: find("mixamorigLeftHand", "LeftHand", "hand_l", "Hand_L"),
    };
    bonesOf = key;
    return bones;
  }
  const qAv = new THREE.Quaternion(), qPar = new THREE.Quaternion(), qRot = new THREE.Quaternion(), axisW = new THREE.Vector3();
  //: Turn ``bone`` by ``angle`` about the walker's own axis (ax, ay, az): -x is its right (a turn
  //: about it raises an arm forward), +y up, +z ahead.
  function turn(bone, ax, ay, az, angle) {
    if (!bone?.parent || !angle) return;
    ctx.avatar.getWorldQuaternion(qAv);
    axisW.set(ax, ay, az).applyQuaternion(qAv).normalize();
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(qPar);
    qRot.setFromAxisAngle(axisW, angle);
    bone.quaternion.premultiply(qPar.clone().invert().multiply(qRot).multiply(qPar));
  }
  const ease = (t) => t * t * (3 - 2 * t);
  function afterPose() {
    if (!ctx.avatar.visible) return;
    const B = rigBones(), p = self();
    const hold = p?.hands && !heldHidden ? physOf(R, p.hands).hold : null;
    const fwd = (b, a) => turn(b, -1, 0, 0, a);
    const t = pose.kind ? Math.min(1, (performance.now() - pose.t0) / pose.dur) : 0;
    if (pose.kind === "pickup" || pose.kind === "strain") {
      // A squat to the ground in front of the feet: the thighs forward and the shins back (the
      // hips come down as the knees bend -- stepBody lowers them), the back bent forward, and the
      // arms down and a little out to it. (fwd turns forward: an arm up, the back -- negative --
      // over.) A model without leg bones only bends its back.
      const k = Math.sin(Math.PI * t), shake = pose.kind === "strain" && t > 0.35 && t < 0.8 ? Math.sin(performance.now() / 25) * 0.05 : 0;
      const legs = Boolean(B.rThigh && B.rShin && B.lThigh && B.lShin);
      if (legs) { fwd(B.rThigh, 0.95 * k); fwd(B.lThigh, 0.95 * k); fwd(B.rShin, -1.8 * k); fwd(B.lShin, -1.8 * k); }
      fwd(B.spine, -(legs ? 0.6 : 0.9) * k + shake); fwd(B.rUpper, 0.45 * k); fwd(B.lUpper, 0.45 * k); fwd(B.rFore, 0.15 * k); fwd(B.lFore, 0.15 * k);
      return;
    }
    if (pose.kind === "swing") {
      const arm = pose.aim?.arm ?? Math.PI / 2;
      if (!p?.hands) {
        // A punch: the fist drawn back to the chin, then straight out at the target's height
        // (pose.aim), the shoulder turning into it.
        const out = t < 0.3 ? 0 : t < 0.55 ? ease((t - 0.3) / 0.25) : 1 - ease((t - 0.55) / 0.45);
        const cock = t < 0.3 ? ease(t / 0.3) : Math.max(0, 1 - out * 1.6);
        fwd(B.rUpper, 0.35 * cock + arm * out); fwd(B.rFore, 1.9 * cock + 0.15 * out);
        fwd(B.lUpper, 0.5); fwd(B.lFore, 1.7);        // the other hand up, guarding
        turn(B.spine, 0, 1, 0, 0.3 * cock - 0.35 * out);
        return;
      }
      // Up and back, then down through the blow -- onto the target, at its height.
      const up = t < 0.45 ? ease(t / 0.45) : 1 - ease((t - 0.45) / 0.55);
      const low = Math.max(0.3, Math.min(1.8, arm));
      fwd(B.rUpper, low + (2.7 - low) * up); fwd(B.rFore, 0.7 - 0.5 * up);
      if (hold === "shoulder") fwd(B.lUpper, 0.3 + 2.0 * up);
      // Over into the blow (the back forward as the arm comes down).
      turn(B.spine, 0, 1, 0, 0.35 * (up - 0.5)); fwd(B.spine, -0.25 * (1 - up));
      inHand();
      return;
    }
    if (pose.kind === "throw") {
      if (hold === "two_hands") {   // a heave from the chest
        const k = t < 0.5 ? ease(t / 0.5) : 1 - ease((t - 0.5) / 0.5);
        fwd(B.spine, -0.25 * k + 0.35 * (t > 0.5 ? 1 - k : 0)); fwd(B.rUpper, 0.6 + 1.0 * k); fwd(B.lUpper, 0.6 + 1.0 * k);
        return;
      }
      const back = t < 0.5 ? ease(t / 0.5) : 1 - ease((t - 0.5) / 0.5);
      fwd(B.rUpper, 0.9 + 2.0 * back); fwd(B.rFore, 1.2 * back);
      turn(B.spine, 0, 1, 0, -0.4 * back); fwd(B.spine, t > 0.5 ? 0.3 * (1 - back) : 0);
      return;
    }
    if (air.up) { const k = Math.min(1, air.y * 3); fwd(B.rUpper, 0.7 * k); fwd(B.lUpper, 0.7 * k); }
    if (hold === "hand") { fwd(B.rUpper, 0.15); fwd(B.rFore, 0.55); }
    else if (hold === "tool") { fwd(B.rUpper, 0.25); fwd(B.rFore, 0.95); }
    else if (hold === "two_hands") { fwd(B.rUpper, 0.75); fwd(B.lUpper, 0.75); fwd(B.rFore, 0.8); fwd(B.lFore, 0.8); }
    else if (hold === "shoulder") { fwd(B.rUpper, 1.5); fwd(B.rFore, 1.9); }
    // A load in both arms sits between the hands, wherever the model's arms put them.
    if (hold === "two_hands" && heldMesh?.parent === ctx.avatar && B.rHand && B.lHand) {
      ctx.avatar.updateMatrixWorld(true);
      B.rHand.getWorldPosition(handR); B.lHand.getWorldPosition(handL);
      ctx.avatar.worldToLocal(handR.add(handL).multiplyScalar(0.5));
      heldMesh.position.copy(handR);
    }
  }
  const handR = new THREE.Vector3(), handL = new THREE.Vector3(), qHand = new THREE.Quaternion();
  //: What is swung goes with the hand that swings it: a thing carried on the shoulder or at the
  //: side (a plank, a bumper, a model with no hand bone) is put in the right hand for the swing,
  //: along the forearm's line, and back where it was carried after.
  function inHand() {
    const B = rigBones();
    if (!heldMesh || heldMesh.parent !== ctx.avatar || !B.rHand) return;
    ctx.avatar.updateMatrixWorld(true);
    B.rHand.getWorldPosition(handR);
    ctx.avatar.worldToLocal(handR);
    heldMesh.position.copy(handR);
    B.rHand.getWorldQuaternion(qHand);
    ctx.avatar.getWorldQuaternion(qAv);
    heldMesh.quaternion.copy(qAv.invert().multiply(qHand));
    heldMesh.userData.swungFromRest = true;
  }
  ctx.avatar.userData.afterPose = afterPose;
  //: X (or a click): swing what you hold at what is in front -- if it is a thing that swings.
  //: X goes for the nearest thing or person within reach, whichever way you face: you turn to
  //: it, and the blow is aimed at it -- a jab at its height with an empty hand, what you hold
  //: brought down onto it. (It swung the arm up over the head and at whatever was nearest,
  //: facing it or not, so a punch went up into the air.)
  function swingKey() {
    const p = self();
    if (!p || pose.kind || car.active || car.riding || transit.ride) return;
    const sw = swingOf(R, p.hands, p.vitals.strength);
    if (!sw.ok) { notify(sw.reason); return; }
    const aim = nearestHittable(R.tools.reach_m);
    if (aim) ctx.faceTo?.(aim.x, aim.z);
    pose.aim = aim ? aimOf(aim) : AIM_AHEAD;
    startAct("swing", 0.45, 0.55, () => strikeKey(null, aim));
  }
  //: The nearest person or breakable thing within ``reach`` of you, any way round:
  //: {kind: "person", q, x, z, d} or {kind: "thing", t, x, z, d}. Someone is taken over a thing
  //: up to 0.4 m further off (as the blow always has).
  function nearestHittable(reach) {
    const at = me();
    const who = personInReach(reach, -2), t = strikeTarget(reach);
    const dw = who ? Math.hypot(who.x - at.x, who.z - at.z) : Infinity, dt = t ? Math.hypot(t.x - at.x, t.z - at.z) : Infinity;
    if (who && dw <= dt + 0.4) return { kind: "person", q: who, x: who.x, z: who.z, d: dw };
    return t ? { kind: "thing", t, x: t.x, z: t.z, d: dt } : null;
  }
  //: Where the blow goes: the arm's forward angle (pi/2 level, less down, more up) to the
  //: target's height from the shoulder's, at its distance. A person at the chest, a tree at the
  //: trunk, a thing in the street (a bin, a bench, a sign's post) at about knee to waist.
  const SHOULDER_M = 1.42;
  const AIM_AHEAD = { arm: Math.PI / 2 };
  function aimOf(aim) {
    const h = aim.kind === "person" ? 1.35 : aim.t.nature ? 1.2 : 0.75;
    return { arm: Math.max(0.5, Math.min(2.1, Math.PI / 2 + Math.atan2(h - SHOULDER_M, Math.max(0.45, aim.d)))) };
  }
  //: U (or a right click): use what you hold -- eat, drink, take, wear or take off.
  async function useSelected() {
    const p = self();
    if (!p || car.active) return;
    if (!p.hands) { notify("Nothing in your hand: choose something on the bar (1-8), then U uses it."); return; }
    const it = R.items[p.hands] || {};
    if (!it.use && !it.wear) { notify(`Nothing to use a ${it.name?.toLowerCase() || "thing"} for here: X swings it, Q throws it.`); return; }
    const r = await send("use", { item: p.hands });
    if (!r.ok) { notify(r.error); return; }
    notify(it.wear ? (r.wearing ? `Wearing the ${it.name.toLowerCase()}.` : `Took off the ${it.name.toLowerCase()}.`) : `${it.name}: ${Object.entries(r.effect || {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ") || "done"}.`);
    syncSlots(true);
  }
  //: Q: throw what you hold, the way you face. How fast and far by its weight and your strength;
  //: glass breaks where it lands, a drink spills, and anyone in its way is hit.
  const flying = [];
  function throwKey() {
    const p = self();
    if (!p || pose.kind || car.active || car.riding || transit.ride) return;
    if (!p.hands) { notify("Nothing in your hand to throw: choose something on the bar (1-8)."); return; }
    if (R.items[p.hands]?.parcel) { notify("The parcel is someone's delivery: hand it over at the address."); return; }
    const t = throwOf(R, p.hands, p.vitals.strength);
    if (!t.ok) { notify(t.reason); return; }
    const item = p.hands, yaw = ctx.getYaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    ctx.faceTo?.(me().x + fx, me().z + fz);
    startAct("throw", 0.6, 0.55, () => {
      // Its flight, step by step over the ground as it is, and whoever it meets on the way.
      const at = me(), g0 = groundAt(at.x, at.z);
      let x = at.x + fx * 0.4, z = at.z + fz * 0.4, y = g0 + t.release, vh = t.speed * Math.cos(t.angle), vy = t.speed * Math.sin(t.angle), hit = null;
      const path = [[x, y, z]];
      for (let k = 0; k < 400; k += 1) {
        const dt = 0.02;
        x += fx * vh * dt; z += fz * vh * dt; vy -= 9.81 * dt; y += vy * dt;
        const gy = groundAt(x, z);
        if (!hit) for (const q of visible.people) if (!q.indoors && !q.down && Math.hypot(q.x - x, q.z - z) < 0.5 && y - gy < 1.9) { hit = q; break; }
        path.push([x, Math.max(y, gy), z]);
        if (hit || y <= gy) break;
      }
      const end = path[path.length - 1], mesh = thingMeshOf(item);
      group.add(mesh); mesh.position.set(...path[0]);
      heldHidden = true;
      flying.push({ mesh, path, t0: performance.now(), each: 20, done: async () => {
        heldHidden = false;
        const r = await send("throw", { item, to: { x: end[0], z: end[2] }, hit: hit ? { id: hit.id, name: hit.person?.name, role: hit.person?.role, x: hit.x, z: hit.z, yaw: hit.yaw } : null, witnesses: Math.max(0, witnessesNear(end[0], end[2]) - (hit ? 1 : 0)) });
        if (!r.ok) { notify(r.error); return; }
        const name = R.items[item]?.name.toLowerCase() || "it";
        if (r.hit) {
          const h = r.hit;
          if (h.down) { flings.set(hit.id, { t0: performance.now(), x: hit.x, z: hit.z, dx: fx, dz: fz, speed: 2, throw: 0.6 }); district.city?.forget(hit.id); }
          notify(`The ${name} hits ${hit.person?.name || "someone"} (${r.energy} J): ${h.injury.type}. ${h.response === "hit back" ? `They come at you: -${h.hurt} health.` : h.response === "down" ? "They go down." : h.response === "arrest" ? "A police officer: you are arrested and cited." : "They run."}${h.fine ? ` Battery: a ${R.fmt(h.fine)} citation.` : ""}`);
          if (h.response === "hit back") knockBack(Math.sin(yaw), Math.cos(yaw), 1.5);
        } else notify(r.lands === "spills" ? `The ${name} spills where it lands.` : r.lands === "breaks" ? `The ${name} breaks where it lands${r.landed ? `: ${R.items[r.landed].name.toLowerCase()} on the ground` : ""}.` : `Thrown ${Math.round(Math.hypot(end[0] - at.x, end[2] - at.z))} m at ${Math.round(r.speed)} m/s: it lies there (G picks it up).`);
        syncSlots(true);
      } });
    });
  }
  function stepFlying() {
    const now = performance.now();
    for (let i = flying.length - 1; i >= 0; i -= 1) {
      const f = flying[i], k = (now - f.t0) / f.each, j = Math.min(f.path.length - 1, Math.floor(k)), u = Math.min(1, k - j);
      const a = f.path[j], b = f.path[Math.min(f.path.length - 1, j + 1)];
      f.mesh.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
      f.mesh.rotation.x += 0.25; f.mesh.rotation.y += 0.11;
      if (j >= f.path.length - 1) { f.mesh.removeFromParent(); flying.splice(i, 1); f.done(); }
    }
  }
  //: The swing and use the hands are for, as action-bar buttons: what X, U and Q do with it now.
  function handActions(p) {
    const out = [], it = p.hands ? R.items[p.hands] : null, name = it ? it.name.toLowerCase() : null;
    const who = personInReach(R.tools.reach_m), target = strikeTarget(R.tools.reach_m);
    const swings = swingOf(R, p.hands, p.vitals.strength).ok;
    // A swing of what you hold has its button; a punch is X alone (no button for it).
    if (it && swings && (who || target)) out.push({ id: "strike", label: `Swing the ${name}: ${who ? who.person?.name || "them" : target.spec.name.toLowerCase()}`, key: "X", run: swingKey });
    if (it && (it.use || it.wear)) out.push({ id: "use", label: it.wear ? (Object.values(p.worn || {}).includes(p.hands) ? `Take off the ${name}` : `Wear the ${name}`) : `${it.kind === "prepared_food" || it.use.stamina ? "Eat or drink" : "Use"}: ${name}`, key: "U", run: useSelected });
    if (it && !it.parcel && throwOf(R, p.hands, p.vitals.strength).ok) out.push({ id: "throw", label: `Throw the ${name}`, key: "Q", run: throwKey });
    return out;
  }
  const archetypeId = (a) => (typeof a === "string" ? a : a?.id);
  const damageKey = (arch, x, z) => `${arch}@${Math.round(x * 2) / 2},${Math.round(z * 2) / 2}`;
  //: Someone within reach in front of you, to strike (or look at): the nearest.
  function personInReach(reach, cone = 0.35) {
    const at = me(), yaw = ctx.getYaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestD = reach;
    for (const q of visible.people) {
      if (q.down || (q.indoors && !shop.place)) continue;
      const dx = q.x - at.x, dz = q.z - at.z, d = Math.hypot(dx, dz);
      if (d < bestD && (d < 0.8 || (dx * fx + dz * fz) / (d || 1) > cone)) { bestD = d; best = q; }
    }
    return best;
  }
  //: What a blow can land on: the nearest thing within reach that breaks and is not broken yet --
  //: the street's own things, and out in the landscape its trees.
  function strikeTarget(reach) {
    const nature = ctx.natureTrees?.(me().x, me().z, reach + 0.6) || [];
    for (const t of nature) {
      const key = `nature:${t.id}`;
      if (view?.damage?.get(key)?.broken) continue;
      return { x: t.x, z: t.z, id: "vegetation.tree", key, spec: R.objects["vegetation.tree"], nature: t.id };
    }
    const prox = ctx.objects?.();
    if (!prox?.targets && !prox?.instancesNear) return null;
    const at = me();
    const list = prox.instancesNear ? prox.instancesNear(at.x, at.z, reach, (a) => Boolean(R.objects[a.id]), 8) : prox.targets(reach);
    for (const t of list) {
      const id = archetypeId(t.archetype), spec = R.objects[id];
      if (!spec) continue;
      const key = damageKey(id, t.x, t.z);
      if (view?.damage?.get(key)?.broken) continue;
      return { ...t, id, key, spec };
    }
    return null;
  }
  const witnessesNear = (x, z) => Math.min(5, visible.people.filter((q) => !q.indoors && Math.hypot(q.x - x, q.z - z) < R.damage.witness_reach_m).length);
  async function strikeKey(energy = null, aimed = null) {
    const p = self();
    if (!p) return;
    if (!energy && (car.active || transit.ride || car.riding)) return;
    const now = performance.now();
    if (!energy && now - lastStrike < 1000 / R.tools.strikes_per_second) return;
    lastStrike = now;
    // What the swing was aimed at (X turned you to it), if it is still within reach when the
    // blow lands; otherwise the nearest now.
    const at = me();
    const aim = energy ? null : aimed && Math.hypot(aimed.x - at.x, aimed.z - at.z) <= R.tools.reach_m + 0.6 ? aimed : nearestHittable(R.tools.reach_m);
    if (aim?.kind === "person") return strikePerson(aim.q);
    const t = energy ? strikeTarget(6) : aim?.t || null;
    if (!t) { if (!energy) notify("Nothing within reach to strike. Benches, bins, lights, signs, trees and windows break."); return; }
    const r = await send("strike", { target: { key: t.key, archetype: t.id, x: t.x, z: t.z, own: false, spec: t.spec }, energy, witnesses: witnessesNear(t.x, t.z) });
    if (!r.ok) { notify(r.error); return; }
    const tool = r.tool === "fists" ? "Bare hands" : r.tool === "vehicle" ? "Your car" : R.items[p.hands]?.name || r.tool;
    if (r.broken) {
      if (t.nature) ctx.fellTree?.(t.nature); else hideBroken(t.key, t.o, t.i);
      if (r.task) { notify(r.task.done ? `${r.task.title}: done — ${R.fmt(r.task.pay)} paid.` : `Felled: ${r.task.felled} of ${r.task.need} dead trees.`); return; }
      notify(`${tool}: the ${t.spec.name.toLowerCase()} breaks.${r.salvage ? ` Left on the ground: ${R.items[r.salvage].name.toLowerCase()} (G picks it up).` : ""}${r.fine ? ` Seen: a ${R.fmt(r.fine)} vandalism fine and ${R.fmt(r.restitution)} for the repair.` : ""}`);
    } else notify(`${tool} on the ${t.spec.name.toLowerCase()} (${t.spec.material}): ${r.joules} J, ${Math.round(r.share * 100)}% of what breaks it.${r.hurt ? ` That hurt: -${r.hurt} health.` : ""}`);
  }
  //: A blow to someone: they are hurt by it, and hit back, run, or (an officer) arrest you.
  async function strikePerson(q) {
    const r = await send("strike_person", { npc: { id: q.id, name: q.person?.name, role: q.person?.role, x: q.x, z: q.z, yaw: q.yaw }, witnesses: witnessesNear(q.x, q.z) - 1 });
    if (!r.ok) { notify(r.error); return; }
    const name = q.person?.name || "them";
    if (r.down) {
      const yaw = ctx.getYaw();
      flings.set(q.id, { t0: performance.now(), x: q.x, z: q.z, dx: -Math.sin(yaw), dz: -Math.cos(yaw), speed: 2, throw: 0.8 });
      district.city?.forget(q.id);
    }
    if (r.response === "hit back") knockBack(Math.sin(ctx.getYaw()), Math.cos(ctx.getYaw()), 1.5);
    const what = r.response === "arrest" ? `${name} is a police officer: you are arrested and cited` : r.response === "hit back" ? `${name} hits back: -${r.hurt} health` : r.response === "down" ? `${name} goes down` : `${name} runs`;
    notify(`${r.tool === "fists" ? "A punch" : "A blow"} (${r.joules} J): ${name} — ${r.injury.type}. ${what}.${r.fine ? ` Battery: a ${R.fmt(r.fine)} citation${r.restitution ? ` and ${R.fmt(r.restitution)} for their care` : ""}.` : ""}`);
  }
  const hidden = new Map();   // damage key -> {o, i, matrix}
  const FAR = new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4).setPosition(0, -1e5, 0);
  function hideBroken(key, o, i) {
    if (hidden.has(key) || !o) return;
    const m = new THREE.Matrix4(); o.getMatrixAt(i, m);
    hidden.set(key, { o, i, matrix: m });
    o.setMatrixAt(i, FAR); o.instanceMatrix.needsUpdate = true;
    ctx.objects?.()?.invalidate?.(o);
  }
  //: The books' broken things, gone from the street (also those broken by others, or before
  //: this page); and back once the city has mended them.
  const felledHere = new Set();
  function syncDamage() {
    const prox = ctx.objects?.(), dmg = view?.damage;
    if (!prox || !dmg) return;
    const fell = [];
    for (const [key, d] of dmg) if (d.broken && key.startsWith("nature:") && !felledHere.has(key)) { felledHere.add(key); fell.push(key.slice(7)); }
    if (fell.length) ctx.fellTree?.(fell);
    for (const [key, d] of dmg) {
      if (key.startsWith("nature:")) continue;
      if (!d.broken || hidden.has(key) || Math.hypot(d.x - me().x, d.z - me().z) > 400) continue;
      const hit = prox.findInstance?.(d.archetype, d.x, d.z, 0.9);
      if (hit) hideBroken(key, hit.o, hit.i);
    }
    for (const [key, h0] of hidden) {
      if (dmg.get(key)?.broken) continue;
      h0.o.setMatrixAt(h0.i, h0.matrix); h0.o.instanceMatrix.needsUpdate = true;
      prox.invalidate?.(h0.o); hidden.delete(key);
    }
  }

  // ---- homes for sale and to rent ----------------------------------------------------------------------
  // The district's homes on the market this week: the real mix of single-family houses and flats,
  // a seeded share of each listed (docs/city/market.mjs), priced by the square foot in the
  // neighbourhood. Signs stand in front of the listed buildings.
  function listings() {
    const week = Math.floor(timeAt(Date.now()).day / 7);
    if (district.listingsWeek !== week || !district.listings) {
      district.listings = homeListings(R, district.places, { week, county: district.county }).map((l) => ({ ...l, county: district.county }));
      district.listingsWeek = week;
      drawSigns();
    }
    const taken = view?.market?.taken;
    return taken ? district.listings.filter((l) => !taken.has(l.home)) : district.listings;
  }
  const signGroup = new THREE.Group(); signGroup.name = "city-home-signs"; group.add(signGroup);
  let signMats = null;
  function drawSigns() {
    signGroup.clear();
    if (!district.listings?.length) return;
    signMats ||= { sale: new THREE.MeshBasicMaterial({ map: signTexture("FOR SALE", "#b3261e", "#ffffff"), side: THREE.DoubleSide }),
      rent: new THREE.MeshBasicMaterial({ map: signTexture("FOR RENT", "#1f5fae", "#ffffff"), side: THREE.DoubleSide }) };
    const byBuilding = new Map();
    for (const l of district.listings) if (!byBuilding.has(l.building) || l.kind === "sale") byBuilding.set(l.building, l.kind);
    const posts = new THREE.InstancedMesh(box(0.06, 1.5, 0.06, 0.75), lambert({ color: 0xf2f2f2 }), byBuilding.size);
    const boards = { sale: [], rent: [] };
    let i = 0;
    for (const [id, kind] of byBuilding) {
      const pl = district.placeById.get(id);
      const F = pl?.front, node = district.streets.nodes[pl?.node];
      const x = F ? F.x - F.nx * 1.2 : node ? node.x + (pl.x - node.x) * 0.15 : pl.x;
      const z = F ? F.z - F.nz * 1.2 : node ? node.z + (pl.z - node.z) * 0.15 : pl.z;
      const yaw = F ? Math.atan2(-F.nx, -F.nz) : 0;
      M.compose(V.set(x, groundAt(x, z), z), Q.setFromEuler(E.set(0, yaw, 0)), S3.set(1, 1, 1));
      posts.setMatrixAt(i, M); boards[kind].push(M.clone()); i += 1;
    }
    signGroup.add(posts);
    for (const kind of ["sale", "rent"]) {
      if (!boards[kind].length) continue;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.17).translate(0, 1.32, 0.05), signMats[kind], boards[kind].length);
      boards[kind].forEach((m, k) => mesh.setMatrixAt(k, m));
      signGroup.add(mesh);
    }
  }
  const sqft = (n) => `${n.toLocaleString()} sq ft`;

  let visitPending = false;
  //: The walk's and a round's stops: reached, they are counted (and the last one pays).
  function checkSightseeing() {
    const p = self(), t = p?.task, round = roundKind(t?.kind);
    if ((t?.kind !== "sightseeing" && !round) || visitPending) return;
    const g = objective(), reach = round ? R.tasks.rounds.reach_m : R.tasks.sightseeing.reach_m;
    if (g?.stop === undefined || Math.hypot(g.x - me().x, g.z - me().z) > reach) return;
    const name = round ? t.steps[g.stop] : R.tasks.sightseeing.stops[g.stop].name, of = round ? t.stops.length : R.tasks.sightseeing.stops.length;
    visitPending = true;
    send("task_visit", { stop: g.stop }).then((r) => { visitPending = false; if (r.ok) notify(r.done ? `${r.title}: done — ${R.fmt(r.pay)} paid.` : `${name}: ${r.visited.length} of ${of}.`); });
  }
  // ---- the task board --------------------------------------------------------------------------
  // Work posted round the city: a courier's pickup and drop-off, the Presidio's dead trees, the
  // Marina walk. Each step has a place: the tracker at the top says where and how far, and the
  // green light stands over it (rules.json tasks).
  const placeName = (pl) => address(pl?.name) || (pl ? storesAt(R, pl.keys).map((x) => x.name)[0] : null) || "a building";
  function taskOffers() {
    const T = R.tasks, here = me(), slot = Math.floor(Date.now() / (T.refresh_minutes * 60000));
    const r = rng(district.region, myId, slot), out = [], C = T.courier;
    const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const shops = district.places.filter((x) => deliveryHere(x) && d(x, here) >= C.pickup_m[0] && d(x, here) <= C.pickup_m[1]);
    const homes = district.places.filter((x) => x.use === "residential");
    for (let k = 0; k < 2 && shops.length && homes.length; k += 1) {
      const from = shops[Math.floor(r() * shops.length) % shops.length];
      const ok = homes.filter((x) => d(x, from) >= C.dropoff_m[0] && d(x, from) <= C.dropoff_m[1]);
      if (!ok.length) continue;
      const to = ok[Math.floor(r() * ok.length) % ok.length];
      const km = (d(from, here) + d(to, from)) / 1000;
      out.push({ kind: "courier", title: `Courier: ${placeName(from)} → ${address(to.name) || "a home"}`, km, pay: C.pay_base + Math.round(C.pay_per_km * Math.min(4, km)),
        from: { id: from.id, name: placeName(from), x: from.x, z: from.z }, to: { id: to.id, name: address(to.name) || "a home", x: to.x, z: to.z },
        steps: [`Go to ${placeName(from)} and pick up the order at its door (G)`, `Take it to ${address(to.name) || "the address"} and hand it over (Yes, at the door)`] });
    }
    const F = T.forestry, [fx, fz] = ctx.fromLonLat(F.area.centre[1], F.area.centre[0]);
    out.push({ kind: "forestry", title: F.name, km: Math.hypot(fx - here.x, fz - here.z) / 1000, pay: F.pay,
      steps: ["Get an axe or a saw: a hardware store (Enter, then its SHOP panel), or the Shop (top bar)", `Go to ${F.area.name}`, `Put the tool on the bar and choose it (1-8), then fell ${F.trees} dead trees (X at a tree)`] });
    const S = T.sightseeing;
    out.push({ kind: "sightseeing", title: S.name, km: Math.min(...S.stops.map((st) => { const [x, z] = ctx.fromLonLat(st.at[1], st.at[0]); return Math.hypot(x - here.x, z - here.z); })) / 1000,
      pay: S.pay, steps: S.stops.map((st) => `Visit ${st.name}`) });
    out.push(...roundOffers(r, here));
    // In City mode only what is in its area: every place a task takes you to.
    const inside = (o) => {
      if (!ctx.inArea) return true;
      const pts = o.kind === "forestry" ? [ctx.fromLonLat(F.area.centre[1], F.area.centre[0])]
        : o.kind === "sightseeing" ? S.stops.map((st) => ctx.fromLonLat(st.at[1], st.at[0]))
        : o.stops ? o.stops.map((s) => [s.x, s.z]) : [o.from && [o.from.x, o.from.z], o.to && [o.to.x, o.to.z]].filter(Boolean);
      return pts.every(([x, z]) => ctx.inArea(x, z));
    };
    return out.filter(inside);
  }
  // ---- rounds: a few places round you to call at (rules.json tasks.rounds) ---------------------
  const roundKind = (kind) => R.tasks.rounds?.kinds?.[kind] || null;
  const doorOf = (pl) => (pl.front ? { x: pl.front.x, z: pl.front.z } : { x: pl.x, z: pl.z });
  const streetOf = (pl) => { const a = address(pl?.name); return a ? a.replace(/^\d+[A-Za-z]?\s+/, "").trim() : null; };
  //: In walking order: from where you stand, the nearest next each time.
  function walkOrder(list, from) {
    const left = [...list], out = [];
    let at = from;
    while (left.length) { left.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z)); at = left.shift(); out.push(at); }
    return out;
  }
  function roundOffers(r, here) {
    const RD = R.tasks.rounds;
    if (!RD?.kinds || !district.places.length) return [];
    const out = [], d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const pick = (list) => list[Math.floor(r() * list.length) % list.length];
    const offer = (kind, title, stops, ordered) => {
      const k = RD.kinds[kind];
      if (!k || stops.length < 2) return;
      const way = ordered ? stops : walkOrder(stops, here);
      let km = 0;
      for (let i = 1; i < way.length; i += 1) km += d(way[i - 1], way[i]) / 1000;
      const at = way.map((s) => { const [lon, lat] = ctx.toLonLat(s.x, s.z); return { name: s.name, at: [lat, lon], x: s.x, z: s.z }; });
      out.push({ kind, title, km: d(way[0], here) / 1000 + km, pay: Math.round(k.pay_base + k.pay_per_stop * way.length + RD.pay_per_km * Math.min(4, km)),
        stops: at, steps: at.map((s) => `${k.verb ? `${k.verb} ` : ""}${s.name}`), note: k.note });
    };
    const homes = district.places.filter((x) => x.use === "residential" && address(x.name));
    // Flyers: five letterboxes on one street near you.
    {
      const K = RD.kinds.flyers, byStreet = new Map();
      for (const pl of homes) { const m = d(pl, here); if (m < 120 || m > 800) continue; const s = streetOf(pl); if (!s) continue; if (!byStreet.has(s)) byStreet.set(s, []); byStreet.get(s).push(pl); }
      const streets = [...byStreet].filter(([, list]) => list.length >= K.stops);
      if (streets.length) {
        const [street, list] = pick(streets);
        const first = pick(list), five = [...list].sort((a, b) => d(a, first) - d(b, first)).slice(0, K.stops);
        offer("flyers", K.name.replace("{street}", street), five.map((pl) => ({ name: address(pl.name), ...doorOf(pl) })), false);
      }
    }
    // A neighbour's dog: fetched from their door, walked to the park, brought home.
    {
      const K = RD.kinds.dog_walk, parks = district.places.filter((x) => x.use === "park");
      const near = homes.filter((pl) => { const m = d(pl, here); return m > 60 && m < 600; });
      if (parks.length && near.length) {
        const home = pick(near), park = [...parks].sort((a, b) => d(a, home) - d(b, home))[0];
        if (d(park, home) < 1500) {
          const who = district.people.find((q) => q.home === home.id)?.name?.split(" ")[0] || "a neighbour";
          const door = { ...doorOf(home), name: address(home.name) };
          offer("dog_walk", K.name.replace("{who}'s", who === "a neighbour" ? "a neighbour's" : `${who}'s`).replace("{park}", park.name || "the park"),
            [{ ...door, name: `Fetch the dog at ${door.name}` }, { x: park.x, z: park.z, name: `Walk it to ${park.name || "the park"}` }, { ...door, name: `Bring it home to ${door.name}` }], true);
        }
      }
    }
    // The transit agency's rider count at a few stops.
    {
      const K = RD.kinds.bus_survey, stops = (district.stops || []).filter((s) => { const m = d(s, here); return m > 60 && m < 900; });
      if (stops.length >= K.stops) {
        const start = pick(stops), some = [...stops].sort((a, b) => d(a, start) - d(b, start)).slice(0, K.stops);
        offer("bus_survey", K.name.replace("{n}", String(some.length)), some.map((s) => ({ name: s.name || "the stop", x: s.x, z: s.z })), false);
      }
    }
    // A mystery shopper's calls.
    {
      const K = RD.kinds.mystery_shopper, shops = district.places.filter((x) => { const m = d(x, here); return m > 80 && m < 900 && storesAt(R, x.keys).length; });
      if (shops.length >= K.stops) {
        const start = pick(shops), some = [...shops].sort((a, b) => d(a, start) - d(b, start)).slice(0, K.stops);
        offer("mystery_shopper", K.name.replace("{n}", String(some.length)), some.map((pl) => ({ name: placeName(pl), ...doorOf(pl) })), false);
      }
    }
    return out;
  }
  const inPresidio = () => { const [lon, lat] = ctx.toLonLat(me().x, me().z), b = R.tasks.forestry.area.bbox; return lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]; };
  //: Whether step ``i`` of your task is done: a stop visited, the courier's order collected, the
  //: forester's tool bought and the Presidio reached.
  function stepDone(p, i) {
    const t = p?.task;
    if (!t) return p?.delivery ? (i === 0 && p.delivery.stage === "carry") : false;
    if (t.kind === "sightseeing" || roundKind(t.kind)) return (t.visited || []).includes(i);
    if (t.kind === "courier") return i < (p.delivery?.stage === "carry" ? 1 : 0);
    if (t.kind === "forestry") { const F = R.tasks.forestry; return i < (F.tool.some((k) => (p.inventory[k] || 0) > 0) ? (inPresidio() ? 2 : 1) : 0); }
    return false;
  }
  //: Where to go next, and what to do there: the delivery's pickup or address, the task's next
  //: step, the errand's door, the shift's task.
  function objective() {
    const p = self();
    if (!p) return null;
    const here = me();
    if (p.delivery) {
      const pick = p.delivery.stage === "pickup", at = pick ? p.delivery.from : p.delivery.to;
      return { label: pick ? `Pick up the order at ${at.name || "the shop"} — G at its door` : `Deliver to ${at.name || "the address"} — Yes at the door`, x: at.x, z: at.z, colour: 0x35c46a };
    }
    const t = p.task;
    if (t?.kind === "forestry") {
      const F = R.tasks.forestry, tool = F.tool.find((k) => (p.inventory[k] || 0) > 0);
      if (!tool) {
        const hw = district.places.filter((x) => storesAt(R, x.keys).some((st) => st.items.includes("axe"))).map((x) => ({ x, d: Math.hypot(x.x - here.x, x.z - here.z) })).sort((a, b) => a.d - b.d)[0];
        return hw ? { label: `Buy an axe at ${placeName(hw.x)} (Enter), or online (the Shop in the top bar)`, x: hw.x.x, z: hw.x.z, colour: 0xffb020 } : { label: "Buy an axe or a saw in the Shop (top bar)", colour: 0xffb020 };
      }
      if (!inPresidio()) { const [x, z] = ctx.fromLonLat(F.area.centre[1], F.area.centre[0]); return { label: `Go to ${F.area.name} with the ${tool}`, x, z, colour: 0x35c46a }; }
      const tree = ctx.natureTrees?.(here.x, here.z, F.reach_m)?.[0];
      return { label: `${p.hands !== tool ? `Choose the ${tool} on the bar (1-8), then ` : ""}fell dead trees: ${t.felled.length} of ${t.need} (X at a tree)`, x: tree?.x, z: tree?.z, colour: 0xff7a1c, tree: true };
    }
    if (t?.kind === "sightseeing") {
      const S = R.tasks.sightseeing;
      const next = S.stops.map((st, i) => { const [x, z] = ctx.fromLonLat(st.at[1], st.at[0]); return { st, i, x, z, d: Math.hypot(x - here.x, z - here.z) }; }).filter((o) => !t.visited.includes(o.i)).sort((a, b) => a.d - b.d)[0];
      if (next) return { label: `Visit ${next.st.name} (${t.visited.length} of ${S.stops.length})`, x: next.x, z: next.z, colour: 0x35c46a, stop: next.i };
    }
    const round = roundKind(t?.kind);
    if (round && t.stops) {
      const left = t.stops.map((s, i) => ({ s, i })).filter((o) => !t.visited.includes(o.i));
      const next = (t.ordered ? left.slice(0, 1) : left).map((o) => { const [x, z] = ctx.fromLonLat(o.s.at[1], o.s.at[0]); return { ...o, x, z, d: Math.hypot(x - here.x, z - here.z) }; }).sort((a, b) => a.d - b.d)[0];
      if (next) return { label: `${t.steps[next.i]} (${t.visited.length + 1} of ${t.stops.length})`, x: next.x, z: next.z, colour: 0x35c46a, stop: next.i };
    }
    if (p.errand) return { label: `Errand: bring ${p.errand.items.map((i) => R.items[i].name.toLowerCase()).join(", ")} to ${p.errand.to.name || "their door"} — Yes at the door`, x: p.errand.to.x, z: p.errand.to.z, colour: 0xffb020 };
    if (p.clocked?.task) return { label: `${p.clocked.task.label} — V there`, x: p.clocked.task.x, z: p.clocked.task.z, colour: 0xff9f1c };
    // A shift to go to: the workplace, and clock in there (the action bar's Clock in, or the prompt).
    if (p.job && !p.clocked && onShift(p.job)) return { label: `Go to work: ${p.job.title} at ${address(p.job.place.name) || "your workplace"} — clock in there`, x: p.job.place.x, z: p.job.place.z, colour: 0x2e86c1 };
    return null;
  }
  //: Whether the hour is in one of the job's shifts (a shift past midnight runs on into the next day).
  function onShift(job) {
    const spec = R.jobs.roles[job.role];
    if (!spec?.shifts?.length) return true;
    const t = view?.time, hour = t ? t.minute / 60 : 12;      // cityTime: minute is of the day
    return spec.shifts.some(([a, b]) => (hour >= a && hour < b) || (hour + 24 >= a && hour + 24 < b));
  }
  // The tracker is the first line of the tasks card, at the top bar's left end (drawTodo).
  function drawGoal() { drawTodo(); }

  // ---- the to-do list ---------------------------------------------------------------------------
  //: What there is for you to do, most pressing first: where your task takes you next (with its
  //: arrow and distance), the rest of its steps, an errand, money owed, being hurt or tired, work
  //: to find, and the task board's offers (taken from here).
  function todoItems() {
    const p = self();
    if (!p) return [];
    const out = [], g = objective(), t = p.task;
    if (g) out.push({ label: g.label, x: g.x, z: g.z, now: true, run: () => openSide("tasks") });
    if (t?.steps) t.steps.forEach((s, i) => { if (!stepDone(p, i) && !(g && g.label.startsWith(s))) out.push({ label: s, sub: t.title, run: () => openSide("tasks") }); });
    if (p.errand && !(g && /^Errand/.test(g.label))) out.push({ label: `Errand for ${p.errand.to.who || "a neighbour"}: ${p.errand.items.map((i) => R.items[i].name.toLowerCase()).join(", ")}`, x: p.errand.to.x, z: p.errand.to.z, run: () => openSide("tasks") });
    const owed = view?.billing?.owed(p.account) || 0;
    if (owed) out.push({ label: `Pay what you owe: ${R.fmt(owed)}`, sub: "You & wallet", run: () => openPanel(true) });
    if (p.vitals.health < 40) out.push({ label: "You are hurt: rest (Z at a bed) or see a doctor", run: () => openSide("help") });
    if (p.vitals.stamina < R.vitals.stamina.low) out.push({ label: "Tired: eat or drink something (U), or rest", run: () => openSide("bag") });
    for (const b of p.bookings || []) {
      const it = R.items[b.item], there = Math.hypot(me().x - b.place.x, me().z - b.place.z) < R.stores.reach_m;
      out.push({ label: there ? `Have your ${it.name.toLowerCase()} here` : `Your booking: ${it.name} at ${address(b.place.name) || "the place"}`, sub: "Booked in the Shop", x: b.place.x, z: b.place.z, run: () => (there ? useBooking(b) : openSide("online")) });
    }
    if (p.job) {
      const spec = R.jobs.roles[p.job.role], atWork = Math.hypot(me().x - p.job.place.x, me().z - p.job.place.z) < R.jobs.workplace_reach_m;
      if (p.clocked && !p.clocked.task) out.push({ label: `At work as ${p.job.title.toLowerCase()}: your next task is coming`, sub: `Tasks every minute or so; V where the orange ring is · ${R.fmt(p.job.pay)}/h`, run: () => openSide("tasks") });
      else if (!p.clocked && !(g && g.label.startsWith("Go to work"))) out.push({ label: atWork ? "Clock in: you are at work" : `Work: ${p.job.title} at ${address(p.job.place.name) || "your workplace"}`, sub: `${shiftText(spec)} · ${R.fmt(p.job.pay)}/h`, x: p.job.place.x, z: p.job.place.z, run: () => (atWork ? workKey() : openSide("online")) });
    } else out.push({ label: "Find a job", sub: "The Shop's Jobs: hiring near you", run: () => { openSide("online"); side.cat = "jobs"; drawSide(); } });
    if (!t && !p.delivery) for (const o of taskOffers()) out.push({ label: o.title, sub: `${R.fmt(o.pay)} · ${o.km.toFixed(1)} km${o.steps?.length ? ` · ${o.steps.length} steps` : ""}`, take: o });
    return out;
  }
  const TODO_SHOWN = 3;
  let todoOpen = false, todoKey = "";
  try { todoOpen = globalThis.localStorage?.getItem("kerbside.city.todoOpen") === "1"; } catch { todoOpen = false; }
  function takeOffer(o) {
    send("take_task", { task: o }).then((r) => { notify(r.ok ? `${r.task.title}: ${r.task.steps[0]}.` : r.error); todoKey = ""; drawTodo(); if (side?.kind === "tasks") drawSide(); });
  }
  function drawTodo() {
    const box = globalThis.document.getElementById("city-tasks");
    if (!box) return;
    const p = self(), on = Boolean(ctx.enabled() && ctx.cityMode?.() !== false && p);
    if (!on || box.hidden) return;
    const items = todoItems(), shown = todoOpen ? items : items.slice(0, TODO_SHOWN);
    const here = car.active ? car : me(), yaw = ctx.getYaw();
    const metres = (o) => (Number.isFinite(o.x) ? Math.hypot(o.x - here.x, o.z - here.z) : null);
    const key = JSON.stringify([todoOpen, items.length, shown.map((o) => [o.label, o.sub, o.now, Math.round((metres(o) ?? -1) / 5)]), Math.round(yaw * 20)]);
    if (key === todoKey) return;
    todoKey = key;
    const H = (tag, props, ...kids) => { const e = Object.assign(globalThis.document.createElement(tag), props); e.append(...kids.filter(Boolean)); return e; };
    const rows = shown.map((o) => {
      const d = metres(o);
      let lead;
      if (o.now && d !== null) {
        const bearing = Math.atan2(-(o.x - here.x), -(o.z - here.z)) - yaw;
        lead = H("span", { className: "arrow", textContent: "⬆" });
        lead.style.transform = `rotate(${(-bearing * 180 / Math.PI).toFixed(0)}deg)`;
      } else lead = H("span", { className: "dot", textContent: o.take ? "+" : "•" });
      const dist = d === null ? "" : ` · ${d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`}`;
      const li = H("li", { className: o.now ? "now" : "" }, lead, H("div", {}, H("span", { textContent: o.label + (o.now ? dist : "") }), o.sub ? H("small", { textContent: o.sub }) : null),
        o.take ? H("button", { textContent: "Take", title: `Take it: ${o.steps?.join(" → ") || o.title}`, onclick: (e) => { e.stopPropagation(); takeOffer(o.take); } }) : null);
      li.onclick = () => (o.take ? openSide("tasks") : o.run?.());
      return li;
    });
    const more = items.length > TODO_SHOWN ? H("button", { textContent: todoOpen ? "▴" : "▾", title: todoOpen ? "Just the top three" : `All ${items.length}`, ariaExpanded: String(todoOpen),
      onclick: () => { todoOpen = !todoOpen; try { globalThis.localStorage?.setItem("kerbside.city.todoOpen", todoOpen ? "1" : "0"); } catch { /* private window */ } todoKey = ""; drawTodo(); layoutBars(); } }) : null;
    const word = H("span", { className: "word", textContent: items.length > TODO_SHOWN && !todoOpen ? `Tasks · ${items.length}` : "Tasks", title: "The task board (J)", onclick: () => openSide("tasks") });
    box.replaceChildren(H("h4", {}, word, more), rows.length ? H("ol", {}, ...rows) : H("p", { textContent: "Nothing for now: the Task board has work." }));
  }
  // ---- the online store ------------------------------------------------------------------------
  //: Everything a shop in the city sells, from wherever you are, at twice the price (rules.json).
  const CATEGORIES = [["food", "Food & drink"], ["health", "Health"], ["tools", "Tools"], ["materials", "Building materials"], ["clothes", "Clothes"], ["everyday", "Everyday"]];
  function categoryOf(it) {
    if (it.wear) return "clothes";
    if (it.tool || it.strike) return "tools";
    if (it.material) return "materials";
    if (it.use && (it.use.health || 0) > (it.use.stamina || 0)) return "health";
    if (it.kind === "prepared_food" || it.kind === "groceries" || it.use?.stamina) return "food";
    return "everyday";
  }
  function onlineWares() {
    const S = R.online_store, seen = new Map();
    for (const [kind, st] of Object.entries(R.stores.kinds)) {
      if (kind === "basis" || !st.items) continue;
      for (const id of st.items) {
        const it = R.items[id];
        if (!it || it.service || it.parcel || S.exclude_needs.includes(it.needs)) continue;
        if (!seen.has(id)) seen.set(id, { id, it, from: [] });
        seen.get(id).from.push(st.name);
      }
    }
    return [...seen.values()].sort((a, b) => a.it.name.localeCompare(b.it.name));
  }
  //: A place as the world's commands take it: its keys a list, and where it is.
  function placeArg(pl) {
    const [lon, lat] = ctx.toLonLat(pl.x, pl.z);
    return { id: pl.id, x: pl.x, z: pl.z, name: pl.name || null, keys: [...pl.keys], lon, lat, county: pl.county || district.county };
  }
  const shiftText = (spec) => (spec.shifts || []).map(([a, b]) => `${a % 24}:00–${b % 24}:00`).join(" or ") || "any time";
  //: Every service given round you: the nearest place that gives each, at its own price.
  function onlineServices() {
    const here = me(), out = [];
    const near = district.places.map((pl) => ({ pl, d: Math.hypot(pl.x - here.x, pl.z - here.z) })).sort((a, b) => a.d - b.d);
    for (const [id, it] of Object.entries(R.items)) {
      if (!it?.service || it.parcel) continue;
      const hit = near.find(({ pl }) => storesAt(R, pl.keys).some((st) => st.items.includes(id)));
      if (hit) out.push({ id, it, pl: hit.pl, d: hit.d, label: placeName(hit.pl) });
    }
    return out;
  }
  //: The jobs open to you at the places round you: for each role, its nearest few workplaces.
  function onlineJobs() {
    const here = me(), S = R.online_store, out = [];
    const near = district.places.map((pl) => ({ pl, d: Math.hypot(pl.x - here.x, pl.z - here.z) })).filter((x) => x.d < (S.jobs_within_m || 2500)).sort((a, b) => a.d - b.d);
    for (const role of R.jobs.player_jobs) {
      const spec = R.jobs.roles[role];
      let n = 0;
      for (const { pl, d } of near) {
        if (!spec.at.some((k) => pl.keys.has(k))) continue;
        out.push({ role, spec, pl, d, label: placeName(pl) });
        if (++n >= 3) break;
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, S.jobs_listed || 40);
  }
  // ---- what can be done here -------------------------------------------------------------------
  //: The actions open to you where you stand, each with its key: what the action bar shows.
  function actionsHere() {
    const p = self(), here = me(), out = [];
    if (!p) return [];
    if (car.active) return [{ id: "car", label: "Get out", key: "Enter", run: toggleCar }];
    if (car.riding) return [{ id: "car", label: "Get out", key: "Enter", run: toggleCar }];
    if (transit.ride) {
      if (!transit.ride.route) return [{ id: "ride", label: transit.ride.vehicle === taxi.id ? `Taxi to ${taxi.dest?.name || "your stop"}: get out early` : "Pay and get out", key: "Enter", run: () => alight() }];
      const v = routeBuses.find((x) => x.id === transit.ride.vehicle);
      return [{ id: "ride", label: transit.ride.stop ? `Stopping at ${v?.nextName || "the next stop"}` : `Next stop: ${v?.nextName || "…"} (ask to get off)`, key: "Enter", run: requestStop }];
    }
    for (const b of p.bookings || []) if (Math.hypot(here.x - b.place.x, here.z - b.place.z) < R.stores.reach_m) out.push({ id: `booking:${b.id}`, label: `Have your ${R.items[b.item].name.toLowerCase()}`, key: "", run: () => useBooking(b) });
    if (p.job && !p.clocked && Math.hypot(here.x - p.job.place.x, here.z - p.job.place.z) < R.jobs.workplace_reach_m) out.push({ id: "clock", label: `Clock in: ${p.job.title}`, key: "", run: workKey });
    const task = p.clocked?.task;
    if (task) out.push({ id: "task", label: working ? `${task.label}: ${Math.min(100, Math.round((performance.now() - working.started) / 10 / working.seconds))}%` : `Task: ${task.label}`, key: "V", run: taskKey });
    if (shop.place) {
      out.push({ id: "shop", label: "Buy: the shop panel by the door", key: "", run: () => openStore(shop.place) });
      if (p.hands) out.push(...handActions(p));
      out.push({ id: "leave", label: "Leave by the door", key: "Enter", run: () => leaveShop() });
      return out;
    }
    const shopAt = nearestShop();
    if (shopAt) out.push({ id: "shop", label: `${shopAt.front ? "Go in" : "Shop"}: ${storesAt(R, shopAt.keys).map((s) => s.name).join(", ")}`, key: "Enter", run: () => { if (!(shopAt.front && enterShop(shopAt))) openStore(shopAt); } });
    const thing = thingsNear(here.x, here.z, 3.2)[0];
    if (thing) {
      const kg = R.items[thing.item]?.kg || 0, heavy = kg > liftKg(R, p.vitals.strength);
      out.push({ id: "pick", label: `${heavy ? "Too heavy" : "Pick up"}: ${R.items[thing.item]?.name.toLowerCase() || "it"} (${kg} kg)`, key: "G", run: pickUp });
    }
    const mine = view.registry.held(p.account).find((a) => a.kind === "vehicle" && a.attrs.x !== undefined && Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z) < 7);
    if (mine) out.push({ id: "car", label: `Drive ${R.vehicles.models[mine.attrs.model].name.toLowerCase()}`, key: "Enter", run: toggleCar });
    // The bus on Enter, taxis on T: never the same key for both.
    const bus = nearestFare("bus");
    if (bus) out.push({ id: "bus", label: String(bus.id).startsWith("bus:") ? `Board the ${bus.route} to ${bus.nextName || "…"} ${R.fmt(R.transit.bus_fare)}${bus.leaves > 0 ? ` (leaves in ${Math.ceil(bus.leaves)} s)` : ""}` : `Board the bus ${R.fmt(R.transit.bus_fare)}`, key: "Enter", run: () => board(bus) });
    else if (wrongSide) out.push({ id: "bus", label: "Board from the pavement side: the doors are on the kerb side", key: "", run: () => notify("The bus's doors are on its kerb side: walk round to the pavement (or the stop's island) to get on.") });
    else { const stop = nearestStop(30); if (stop) out.push({ id: "stop", label: `Bus stop: ${stop.routes.join(", ")}`, key: "", run: () => openSide("ride") }); }
    const cab = nearestFare("taxi");
    if (cab) out.push({ id: "ride", label: cab.id === taxi.id ? `Get in your taxi (waits ${Math.max(0, Math.ceil(TL.taxi_max_wait_s - (performance.now() - taxi.waitSince) / 1000))} s)` : "Hail the taxi", key: "Enter", run: () => board(cab) });
    else if (taxi.phase === "coming") out.push({ id: "ride", label: "Your taxi is on its way", key: "", run: () => openSide("ride") });
    else out.push({ id: "ride", label: "Call a taxi", key: "", run: () => openSide("ride") });
    const door = myGarageHere();
    if (door) out.push({ id: "garage", label: door.isOpen() ? "Close your garage" : "Open your garage", key: "Enter", run: () => garageKey(door) });
    out.push(...handActions(p));
    // A question answered No stays here, as a button, for as long as it applies.
    for (const q of promptsHere()) if (declined.has(q.id)) out.push({ id: q.id, label: q.label, key: "", run: q.run });
    if (p.resting) out.push({ id: "rest", label: "Get up", key: "Z", run: restKey });
    else { const bed = bedHere(); if (bed) out.push({ id: "rest", label: bed.home ? "Sleep in your bed" : "Lie down on the bed", key: "Z", run: restKey }); }
    return out;
  }

  // ---- Enter, and a click ---------------------------------------------------------------------
  //: Enter in the game: into the shop in front of you, and inside, out at its door. False when
  //: there is no shop here (the page then opens the door in front of you, if there is one).
  //: Enter is "in or out": out of the car (or into yours, beside it), into the taxi pulled up for
  //: you (and out of it early), onto the bus standing at
  //: the stop (and, aboard, asking for the next stop), into the shop in front of you (and out at
  //: its door), and your own garage up or down. The nearest of what is here, when there are
  //: several. On the map (``map``), only the garage. False when none of it is here: the page
  //: then opens the door in front of you, if there is one.
  function enterKey({ map = false } = {}) {
    if (map) { const door = myGarageHere(); return door ? (garageKey(door), true) : false; }
    if (!self()) return false;
    if (car.active || car.riding) { toggleCar(); return true; }
    if (transit.ride) {
      if (transit.ride.route) requestStop(); else alight();
      return true;
    }
    if (shop.place) {
      const at = shop.frame.local(me().x, me().z);
      if (at.u < 2.2) { leaveShop(); return true; }
      notify("Walk to the door to leave (Enter there).");
      return true;
    }
    const here = [];
    const bus = nearestFare("bus");
    if (bus) here.push({ d: bus.d, run: () => board(bus) });
    else if (wrongSide) here.push({ d: Math.hypot(wrongSide.x - me().x, wrongSide.z - me().z), run: () => notify("The bus's doors are on its kerb side: walk round to the pavement (or the stop's island) to get on.") });
    // Your taxi pulled up for you (or one passing): Enter gets in, as for the bus.
    const cab = nearestFare("taxi");
    if (cab) here.push({ d: Math.max(0, cab.d - 2), run: () => board(cab) });
    const car0 = carHere();
    if (car0) here.push(car0);
    const place = nearestShop();
    if (place) here.push({ d: place.distance, run: () => { if (!(place.front && enterShop(place))) openStore(place); } });
    const door = myGarageHere();
    if (door) here.push({ d: door.d, run: () => garageKey(door) });
    if (!here.length) return false;
    here.sort((a, b) => a.d - b.d)[0].run();
    return true;
  }
  //: Your car within a few steps (or a party member's to ride in, or -- asked first -- someone
  //: else's to take): what Enter would get into, and how far.
  function carHere() {
    const w = view, p = w?.players.get(myId);
    if (!p) return null;
    const here = me();
    const dist = (a) => (a.attrs.x === undefined ? Infinity : Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z));
    const mine = w.registry.held(p.account).filter((a) => a.kind === "vehicle" && dist(a) < 7).sort((a, b) => dist(a) - dist(b))[0];
    if (mine) return { d: dist(mine), run: toggleCar };
    for (const peer of party.session?.players() || []) if (peer.car?.driving && peer.at && Math.hypot(peer.at.x - here.x, peer.at.z - here.z) < 7) return { d: Math.hypot(peer.at.x - here.x, peer.at.z - here.z), run: toggleCar };
    const theirs = [...w.registry.assets.values()].find((a) => a.kind === "vehicle" && a.holder !== p.account && dist(a) < 3.5);
    return theirs ? { d: dist(theirs), run: toggleCar } : null;
  }
  // ---- garages ---------------------------------------------------------------------------------
  //: The buildings whose garages are yours to open: the homes you own or rent, and buildings you own.
  function myBuildings() {
    const p = self(), w = view, out = new Set();
    if (!p || !w) return out;
    for (const a of w.registry.held(p.account)) if (a.kind === "home" && a.attrs?.building !== undefined) out.add(String(a.attrs.building));
    for (const a of w.registry.owned(p.account, "home")) if (a.attrs?.building !== undefined) out.add(String(a.attrs.building));
    for (const a of w.registry.owned(p.account, "building")) out.add(String(a.id).replace(/^building:/, ""));
    return out;
  }
  //: A garage door of yours within a few steps, or null.
  function myGarageHere() {
    if (car.active || car.riding || transit.ride || shop.place || !ctx.garages) return null;
    const mine = myBuildings();
    if (!mine.size) return null;
    const here = me(), door = ctx.garages.near(here.x, here.z, R.garages?.reach_m ?? 4.5);
    return door && mine.has(door.building) ? door : null;
  }
  function garageKey(door) {
    const up = door.toggle();
    notify(up ? "Your garage door goes up. Enter again to shut it." : "Your garage door comes down.");
  }
  //: Driving your own car up to your garage: its door goes up as you come (a remote), and comes
  //: down once you have driven off again, or got out and walked away.
  const remote = { door: null, t: 0 };
  function garageRemote(now) {
    if (now - remote.t < 300 || !ctx.garages) return;
    remote.t = now;
    const at = car.active ? { x: car.x, z: car.z } : me();
    if (remote.door) {
      if (Math.hypot(at.x - remote.door.x, at.z - remote.door.z) > GARAGE_REMOTE_M * 2) { remote.door.close(); remote.door = null; }
      return;
    }
    if (!car.active) return;
    const mine = myBuildings();
    if (!mine.size) return;
    const door = ctx.garages.near(car.x, car.z, GARAGE_REMOTE_M);
    if (!door || !mine.has(door.building)) return;
    if (!door.isOpen()) { door.open(); notify("Your garage door goes up for you."); }
    remote.door = door;
  }
  //: The residents' garage doors near you: up before their car drives out and down after it,
  //: up as it comes home and down once it is in (fleet.mjs garageOpen).
  function npcGarages() {
    const c = district.city;
    if (!c || !ctx.garages) return;
    const tt = timeAt(Date.now()), you = me(), seen = new Set();
    const consider = (v) => {
      if (!v?.garage || seen.has(v.id)) return;
      seen.add(v.id);
      const home = district.placeById?.get(v.home);
      if (!home || Math.abs(home.x - you.x) > 160 || Math.abs(home.z - you.z) > 160) return;
      if (!c.garageOpen(v, tt)) return;
      ctx.garages.near(home.x, home.z, 30, v.home)?.open(2.5);
    };
    for (const e of scan.garaged || []) consider(e.v);
    for (const e of scan.vehicles) consider(e.v);
  }
  const clickRay = new THREE.Raycaster();
  //: A click in the game: the shop's checkout panel if it is under the pointer, else a swing.
  function click(ray) {
    if (!self()) return;
    if (shop.room?.userData.panel && ray?.intersectObject(shop.room.userData.panel, false).length) { openStore(shop.place); return; }
    swingKey();
  }

  // ---- the bar of eight and the inventory ------------------------------------------------------
  // The world keeps how many of each thing you have; where each sits (the bar 1-8, the grid of 24
  // above it in the inventory) is kept on this device (inventory.mjs). The chosen slot is in your
  // hand: the world's hands follow the bar.
  const SLOTS_KEY = `kerbside:city:slots:${myId}`;
  let slots = arrange(store.get(SLOTS_KEY)?.slots || [], {}), chosen = store.get(SLOTS_KEY)?.chosen ?? 0, holding = false;
  let cursorSlot = -1;   // the inventory's picked-up stack, to put down in another slot
  function saveSlots() { store.set(SLOTS_KEY, { slots, chosen }); }
  function syncSlots(now = false) {
    const p = self();
    if (!p) return;
    const next = arrange(slots, p.inventory);
    if (next.some((v, i) => v !== slots[i])) { slots = next; saveSlots(); }
    const want = slots[chosen] || null;
    if (p.hands !== want && !holding && !car.active) {
      holding = true;
      send(want ? "hold" : "stow", want ? { item: want } : {}).finally(() => { holding = false; drawHotbar(); });
    }
    drawHotbar();
    if (now && side?.kind === "bag") drawSide();
  }
  function selectSlot(i) {
    if (i < 0 || i >= BAR || pose.kind) return;
    chosen = i; saveSlots(); syncSlots();
    const id = slots[i];
    if (id) { const ph = physOf(R, id), p = self(); notify(`${i + 1}: ${ph.name} — ${weightClass(R, ph.kg, p?.vitals.strength ?? 20)}, ${ph.kg} kg, ${ph.hold === "two_hands" ? "in both arms" : ph.hold === "shoulder" ? "on the shoulder" : "in your hand"}.`); }
  }
  let hotbar = null, hotbarKey = "";   // made with the action bar (below)
  function slotFace(id, n, extra = "") {
    if (!id) return `<i class="empty"></i>${extra}`;
    const it = R.items[id] || {}, ph = physOf(R, id), col = "#" + (MAT_COLOUR[ph.material] ?? 0x3c8fd6).toString(16).padStart(6, "0");
    return `<i style="background:${col}"></i><span>${(it.name || id).replace(/[<>&]/g, "").slice(0, 18)}</span>${n > 1 ? `<b>${n}</b>` : ""}${extra}`;
  }
  function drawHotbar() {
    if (!hotbar) return;
    const p = self(), on = Boolean(ctx.enabled() && p && ctx.cityMode?.() !== false);
    hotbar.hidden = !on;
    if (!on) return;
    const key = JSON.stringify([slots.slice(0, BAR), chosen, slots.slice(0, BAR).map((_, i) => slotCount(slots, p.inventory, i)), p.hands]);
    if (key === hotbarKey) return;
    hotbarKey = key;
    hotbar.replaceChildren(...slots.slice(0, BAR).map((id, i) => {
      const b = h("button", { className: `slot${i === chosen ? " on" : ""}`, title: id ? `${i + 1}: ${R.items[id]?.name}` : `${i + 1}: empty hand`, onclick: () => selectSlot(i) });
      b.innerHTML = `<em>${i + 1}</em>${slotFace(id, slotCount(slots, p.inventory, i))}`;
      return b;
    }), h("button", { className: "inv", title: "The inventory (I)", onclick: () => openSide("bag") }, "Inventory ", h("kbd", { textContent: "I" })));
  }

  // ---- asked where it applies: Yes or No -------------------------------------------------------
  // Clocking in at your workplace (and out when you leave it), handing a parcel over at its address,
  // the errand's shopping at the neighbour's door: asked once as you arrive; No, and it is not
  // asked again until you have gone and come back.
  let promptBox = null;   // made with the action bar (below)
  const declined = new Set();
  let promptShown = null;
  function promptsHere() {
    const p = self(), here = me(), out = [];
    if (!p || car.active || car.riding || transit.ride) return out;
    const dist = (o) => Math.hypot(here.x - o.x, here.z - o.z);
    if (p.job) {
      const atWork = dist(p.job.place) <= R.jobs.workplace_reach_m;
      if (!p.clocked && atWork) out.push({ id: `in:${p.job.place.id}`, label: "Clock in", text: `Clock in at ${address(p.job.place.name) || "work"} as ${p.job.title.toLowerCase()}?`, run: workKey });
      if (p.clocked && dist(p.job.place) > R.jobs.workplace_reach_m * 2) out.push({ id: `out:${p.job.place.id}`, label: "Clock out", text: "You have left work. Clock out (paid for the time worked)?", run: workKey });
    }
    if (p.delivery && p.delivery.stage !== "pickup" && dist(p.delivery.to) <= R.delivery.reach_m) {
      out.push({ id: `deliver:${p.delivery.to.id}`, label: "Hand over the parcel", text: `Hand the parcel over at ${p.delivery.to.name || "this address"}?`, run: async () => { const r = await send("deliver"); notify(r.ok ? `Delivered${r.late ? " late, at half pay" : ""}: ${R.fmt(r.pay)}.` : r.error); syncSlots(true); } });
    }
    if (p.errand && dist(p.errand.to) <= R.errands.reach_m) {
      const missing = p.errand.items.filter((i) => !((p.inventory[i] || 0) > 0));
      if (!missing.length) out.push({ id: `errand:${p.errand.to.id}`, label: "Give them the shopping", text: `Give ${p.errand.to.who || "them"} the shopping (${p.errand.items.map((i) => R.items[i].name.toLowerCase()).join(", ")})?`, run: async () => { const r = await send("deliver_errand"); notify(r.ok ? `Errand done: ${R.fmt(r.reimbursed)} back and a ${R.fmt(r.fee)} fee.` : r.error); syncSlots(true); } });
    }
    return out;
  }
  function drawPrompt() {
    if (!promptBox) return;
    const all = promptsHere(), ids = new Set(all.map((x) => x.id));
    for (const id of declined) if (!ids.has(id)) declined.delete(id);
    const q = ctx.enabled() && ctx.cityMode?.() !== false ? all.find((x) => !declined.has(x.id)) : null;
    if ((q?.id || null) === promptShown) return;
    promptShown = q?.id || null;
    promptBox.hidden = !q;
    if (!q) return;
    promptBox.replaceChildren(h("span", { textContent: q.text }),
      h("button", { className: "primary", textContent: "Yes", onclick: () => { declined.add(q.id); promptShown = null; promptBox.hidden = true; q.run(); } }),
      h("button", { textContent: "No", onclick: () => { declined.add(q.id); promptShown = null; promptBox.hidden = true; } }));
  }

  // ---- the frame -------------------------------------------------------------------------------
  let lastCrowd = 0, lastRefresh = 0, lastStep = 0, lastSave = 0, lastRegion = 0, lastNight = false, lastFrame = 0;
  let visible = { people: [], vehicles: [] }, frameFailed = false;
  // ---- level of detail (detail.mjs) ----------------------------------------------------------------
  //: The field this frame (null before the first), what tier each person and car had (and, for one
  //: only tracked or drawn low, when it is next placed), and how many were drawn at each tier.
  let detailNow = null;
  const personTiers = new Map(), carTiers = new Map(), focusVelocity = velocityTracker();
  const drawnTiers = { people: [0, 0, 0], cars: [0, 0, 0], tracked: { people: 0, cars: 0 } };
  //: Someone tracked only is placed again about once a second (each at its own moment, so the
  //: crowd's are spread over the frames): often enough to come into range on time at a walk, or
  //: in a car at the speed limit, before the low ring's edge (DETAIL_RINGS) is reached.
  const TRACK_EVERY_MS = [700, 1300];
  //: Someone drawn low is placed again five times a second, not every frame.
  const LOW_EVERY_MS = [160, 260];
  //: Someone in a shop is seen through its window from this near, and not from further.
  const INDOOR_SEEN_M = 22;
  const nextAt = (id, now, [a, b]) => now + a + (hash32(id) % Math.max(1, b - a));
  //: The way ahead when riding: the cab's route from where it is, or the bus's stops to come.
  function routeAheadNow() {
    const ride = transit.ride;
    if (!ride) return null;
    if (ride.vehicle === taxi.id && taxi.route?.pts) {
      const S = taxi.route.s || [], ahead = taxi.route.pts.filter((_, i) => (S[i] ?? 0) > (taxi.d || 0));
      return routeSamples(ahead, taxi.at ? { x: taxi.at.x, z: taxi.at.z } : null);
    }
    const v = routeBuses.find((b) => b.id === ride.vehicle), line = v && district.lines?.find((L) => L.route === v.route);
    if (!line?.stops?.length) return null;
    const pts = [], next = v.next ?? v.stop ?? 0;
    for (let k = 0; k < 3; k += 1) { const st = line.stops[(next + k) % line.stops.length]; if (st) pts.push({ x: st.x, z: st.z }); }
    return routeSamples(pts, { x: v.x, z: v.z });
  }
  //: How far the city is kept track of from ``focus``: the whole of City mode's area (the Marina),
  //: whichever corner of it is furthest, and never less than the rules' visible radius.
  function trackReach(focus) {
    const box = ctx.areaBox?.(), base = R.routine.visible_radius_m;
    if (!box) return base;
    const [x0, z0, x1, z1] = box;
    return Math.min(2500, Math.max(base, Math.hypot(Math.max(focus.x - x0, x1 - focus.x), Math.max(focus.z - z0, z1 - focus.z))));
  }
  function tick(now) {
    if (!ctx.enabled()) { group.visible = false; return false; }
    group.visible = true;
    if (!group.parent) ctx.root.add(group);
    const t = Date.now();
    if (now - lastRegion > 1500) {
      lastRegion = now;
      const data = ctx.regionData();
      if (data && data.key !== district.key) { try { buildDistrict(data); } catch (error) { console.warn("kerbside: the living city could not build this district", error); district.key = data.key; } }
    }
    if (party.session && now - lastStep > 3000) electHost();
    if (world && now - lastStep > 1000) {
      lastStep = now;
      world.step(t);
      if (party.session && performance.now() - party.lastState > 2500) broadcastState();
    }
    if (world && now - lastSave > 10_000) { lastSave = now; save(); }
    const dt = Math.min(0.25, (now - (lastFrame || now)) / 1000); lastFrame = now;
    if (car.riding) ride();
    // The route buses where the timetable has them, near you.
    if (district.lines?.length) {
      const f = car.active ? car : me();
      routeBuses = busesAt(district.lines, t, busLag).filter((b) => Math.abs(b.x - f.x) < R.routine.visible_radius_m && Math.abs(b.z - f.z) < R.routine.visible_radius_m);
      holdBuses(dt);
    } else routeBuses = [];
    stepTaxi(dt);
    if (transit.ride) followRide();
    stepWork();
    reportExertion();
    // Who is out and about: the full pass once a second (or on moving 40 m), where each is
    // every frame -- along the leg or the spot the pass found, nothing worked out again.
    const focus = car.active ? car : me();
    if (district.city) {
      // The pass a slice a frame (fleet.mjs scanMore): a whole district at once held a frame up.
      if (!scanning && (now - lastCrowd > 1000 || Math.hypot(focus.x - scanAt.x, focus.z - scanAt.z) > 40)) {
        lastCrowd = now; scanAt = { x: focus.x, z: focus.z }; scanning = true;
        // Everyone in the area, out to its edge: those past the low ring are only kept track of
        // (frameCity). Parked cars as far as the low ring's edge, where they are drawn as blocks.
        scanReach = trackReach(focus);
        district.city.scanBegin(t, focus, scanReach, DETAIL_RINGS.cars[2] * (1 + DETAIL_HYSTERESIS) + 20);
      }
      if (scanning) {
        const done = district.city.scanMore(scan.people.length || scan.vehicles.length ? 2500 : Infinity);
        if (done) {
          scan = done; scanning = false;
          const hour = scan.time.minute / 60;
          lastNight = hour < 6.6 || hour > 18.4;
        }
      }
      // The detail field: round where you are, out ahead the way you are going (and along the
      // route, riding).
      const fv = focusVelocity.update(focus.x, focus.z, dt);
      detailNow = detailField({ x: focus.x, z: focus.z }, { vx: fv.vx, vz: fv.vz, ahead: routeAheadNow() });
      // The city's frame never takes the page's with it: one car or person that cannot be placed
      // is left out of this frame (said once), and the world goes on being drawn.
      try { visible = frameCity(t, dt, now, focus); } catch (error) { if (!frameFailed) { frameFailed = true; console.warn("kerbside: the living city skipped a frame", error); } }
      // Where the real routes run, the buses are theirs (the timetable's), not the crowd's.
      if (district.lines?.length) visible.vehicles = visible.vehicles.filter((v) => v.model !== "bus");
      keepClear();
      stepBikes(dt, t / 1000, focus, now);
      drawPeople(bikes.length ? [...visible.people, ...bikeRiders()] : visible.people, now);
      drawBikes();
      drawCars(wheels(), lastNight);
      drawThings(now);
      drawDebris(dt);
    }
    drawMarker(now); drawErrand(now); drawTask(now);
    if (!ctx.animateWalk) stepReach(dt);   // (the page's walker step runs it: autoWalk)
    stepBody(dt); stepFlying(); drawHeld(); garageRemote(now); ctx.garages?.tick(dt);
    if (now - lastRefresh > 500) {
      lastRefresh = now; drawParked(); checkFainted(); syncDamage(); hud(); syncSlots(); drawPrompt(); refreshDoors(now); npcGarages();
      if (side && ["ride", "tasks"].includes(side.kind)) drawSide();
      drawGoal(); checkSightseeing();
      if (district.places.length) listings();
    }
    if (shop.place && !ctx.isFirstPerson?.()) ctx.firstPerson?.(true);
    return Boolean(visible.people.length || visible.vehicles.length || car.active || transit.ride || routeBuses.length || taxi.at || shop.place || working || pose.kind || air.up || flying.length);
  }
  // ---- the city in motion: each frame ------------------------------------------------------------
  const SIM_M = 240;          // cars nearer than this are driven by the rules (fleet.mjs Drivers)
  const flings = new Map();   // someone knocked down: id -> {t0, x, z, dx, dz, speed}
  const jolts = new Map();    // a car in a crash: id -> {t0, speed}
  const dodge = new Map();    // someone stepping round you: id -> sideways metres
  const nudged = new Map();   // someone going through a door: id -> when it was swung open for them
  let drawnCars = [];
  //: Who and what is where this frame: people along their way or at their spot, cars on their
  //: leg -- driven by the rules near you, by their day further off -- or parked.
  //: Where each one was drawn last frame: nobody is drawn moving faster than ``top`` m/s, so
  //: where a way's offset changes (a street narrows, a footpath meets the pavement) they step
  //: across rather than appear there. A gap wider than ``snap`` (out of sight and back) is taken.
  const glided = new Map();
  function glide(e, now, dt, top, snap) {
    const g = glided.get(e.id);
    if (g && now - g.t < 600) {
      const dx = e.x - g.x, dz = e.z - g.z, d = Math.hypot(dx, dz), max = top * Math.max(dt, 1 / 120) + 0.02;
      if (d > max && d < snap) { e.x = g.x + (dx / d) * max; e.z = g.z + (dz / d) * max; }
    }
    if (g) { g.x = e.x; g.z = e.z; g.t = now; } else glided.set(e.id, { x: e.x, z: e.z, t: now });
  }
  //: The first and last few metres of a leg: out of its spot at the kerb into the lane, and
  //: back in to the kerb at the end (the lane's line is a metre or two out from it).
  const EASE_M = 7;
  function easeToSpots(route, d, pos) {
    const k0 = route.startSpot && d < EASE_M ? 1 - d / EASE_M : 0, k1 = route.endSpot && route.length - d < EASE_M ? 1 - (route.length - d) / EASE_M : 0;
    const S = k1 > k0 ? route.endSpot : route.startSpot, k = Math.max(k0, k1);
    if (!S || k <= 0) return pos;
    const e = k * k * (3 - 2 * k);
    return { ...pos, x: pos.x + (S.x - pos.x) * e, z: pos.z + (S.z - pos.z) * e };
  }
  //: Whether a walker a step short of a crosswalk (``walk`` from fleet.mjs personAt) waits there:
  //: for the light where one controls it (the street they cross has its green or amber), and
  //: for any car on the crossing or that would be there within CROSS_GAP_S -- yours, a bus, a cab.
  const CROSS_GAP_S = 4;
  //: How near your garage you drive before its door goes up (m).
  const GARAGE_REMOTE_M = 9;
  function waitsAtKerb(walk, tsec) {
    const list = walk.pave?.crossings;
    if (!list?.length) return false;
    for (const cr of list) {
      const before = walk.dir > 0 ? cr.s0 - walk.d : walk.d - cr.s1;
      if (before < -0.05 || before > 1.2) continue;   // on it already: on over
      if (cr.signal && cr.node !== undefined && signalAt(district.streets, cr.node, cr.bearing, tsec) !== "red") return true;
      const a = alongRoute(walk.pave, cr.s0), b = alongRoute(walk.pave, cr.s1);
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const mine = car.active ? [{ x: car.x, z: car.z, yaw: car.yaw, speed: Math.abs(car.speed), model: car.model }] : [];
      for (const v of [...drawnCars, ...routeBuses, ...(taxi.at ? [taxi.at] : []), ...mine]) {
        if (v.parked || Math.abs(v.x - mx) > 60 || Math.abs(v.z - mz) > 60) continue;
        const [, , vl] = VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan;
        if (distToSegment(v.x, v.z, a.x, a.z, b.x, b.z) < vl / 2 + 1.2) return true;
        const sp = v.speed || 0;
        if (sp < 0.5 || v.dwelling) continue;
        // Where its way meets the crossing's line (``k`` metres along it from the kerb), how far
        // ahead of it (``t``), and so how soon.
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), den = fx * uz - fz * ux;
        if (Math.abs(den) < 0.2) continue;
        const px = a.x - v.x, pz = a.z - v.z, t = (px * uz - pz * ux) / den, k = (px * fz - pz * fx) / den;
        if (t > 0 && k > -2 && k < len + 2 && (t - vl / 2) / sp < CROSS_GAP_S) return true;
      }
    }
    return false;
  }
  function frameCity(ms, dt, now, focus) {
    const c = district.city, D = district.drivers, tt = { ...timeAt(ms) };
    tt.minute += (ms % 1000) / 60000;
    const reach = Math.max(R.routine.visible_radius_m, scanReach || 0), dayStart = ms - tt.minute * 60000, tsec = ms / 1000;
    const people = [];
    const you = me();
    let trackedPeople = 0;
    for (const e of scan.people) {
      // Tracked only, or drawn low and placed a moment ago: left as it is until its next look.
      const id = e.p.id, was = personTiers.get(id);
      if (was && now < was.next) {
        if (was.tier === TRACKED) { trackedPeople += 1; continue; }
        if (was.entry) { people.push(was.entry); continue; }
      }
      const seg = e.seg && tt.minute < e.seg.t1 && tt.minute >= e.seg.t0 ? e.seg : undefined;
      const pos = c.personAt(e.p, tt, seg, focus);
      if (!pos || Math.abs(pos.x - focus.x) > reach || Math.abs(pos.z - focus.z) > reach) { personTiers.delete(id); continue; }
      // In a shop and not the one you are in: seen through its window from close by, or not at all.
      let tier = detailNow ? detailNow.tier("people", pos.x, pos.z, was?.tier) : FULL;
      if (pos.indoors && pos.indoors !== shop.place?.id && Math.hypot(pos.x - you.x, pos.z - you.z) > INDOOR_SEEN_M) tier = TRACKED;
      if (tier === TRACKED) { personTiers.set(id, { tier, next: nextAt(id, now, TRACK_EVERY_MS), seen: now }); trackedPeople += 1; continue; }
      const entry = { id, person: e.p, ...pos, detail: tier };
      if (pos.through && Math.abs(pos.x - you.x) < 60 && Math.abs(pos.z - you.z) < 60 && !(nudged.get(entry.id) > now - 2500)) { nudged.set(entry.id, now); ctx.nudgeDoor?.(pos.x, pos.z); }
      // Stepping round you: a walker who would walk into you goes by a pace to the side.
      if (pos.moving && !car.active) {
        const fx = -Math.sin(pos.yaw), fz = -Math.cos(pos.yaw), dx = you.x - pos.x, dz = you.z - pos.z;
        const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
        let want = 0;
        if (ahead > -0.5 && ahead < 3 && Math.abs(side) < 0.9) want = (side >= 0 ? -1 : 1) * (0.95 - Math.abs(side));
        const was = dodge.get(entry.id) || 0, now2 = was + (want - was) * Math.min(1, dt * 4);
        if (Math.abs(now2) > 0.01) { dodge.set(entry.id, now2); entry.x += fz * now2; entry.z -= fx * now2; } else dodge.delete(entry.id);
      }
      // At the kerb of a crosswalk: waiting for the light or a gap in the traffic, then over.
      if (pos.walk && pos.moving && !pos.down) {
        const hold = waitsAtKerb(pos.walk, tsec);
        // (One placed only now and then is held for the time since it was last placed.)
        c.holdWalk(pos.walk.key, Math.min(was?.seen ? Math.max(dt, (now - was.seen) / 1000) : dt, 0.25), hold);
        if (hold) { entry.moving = false; entry.activity = "waiting to cross"; }
      }
      const f = flings.get(entry.id);
      if (f) {
        const age = (now - f.t0) / 1000, k = Math.min(1, age / 0.7);
        entry.x = f.x + f.dx * f.throw * Math.sin(k * Math.PI / 2); entry.z = f.z + f.dz * f.throw * Math.sin(k * Math.PI / 2);
        entry.lift = Math.sin(k * Math.PI) * Math.min(1.2, f.speed * 0.12); entry.fall = k; entry.down = true; entry.moving = false;
        entry.yaw = Math.atan2(-f.dx, -f.dz);
        if (age > R.harm.down_s) flings.delete(entry.id);
      } else if (pos.down) { entry.fall = 1; entry.down = true; }
      else glide(entry, now, dt, 3.2, 60);
      const low = tier === LOW && !f;
      personTiers.set(id, { tier, next: low ? nextAt(id, now, LOW_EVERY_MS) : 0, entry: low ? entry : null, seen: now });
      people.push(entry);
    }
    drawnTiers.tracked.people = trackedPeople;
    if (personTiers.size > 30000) for (const [id, q] of personTiers) if (now - q.seen > 5000) personTiers.delete(id);
    // The cars: parked where they stand; driving, on their leg.
    const sim = [], vehicles = [], legOf = new Map();
    const limitAt = (model) => (cls) => {
      const law = cls === "residential" ? (view || world)?.laws?.speed_limit_kmh_residential : null;
      return (law ? law / 3.6 : SPEED_MS[cls || "residential"]) * (model === "bus" || model === "box_truck" ? 0.8 : 0.95);
    };
    let trackedCars = 0;
    for (const e of scan.vehicles) {
      // Far off and not being driven by the rules: left until its next look (it is only tracked).
      const wasCar = carTiers.get(e.v.id);
      if (wasCar?.tier === TRACKED && now < wasCar.next && !D.stateOf(e.v.id)) { trackedCars += 1; continue; }
      const v = e.v, s0 = e.s, h0 = harmNow((world || view)?.harm?.get(v.id), ms);
      const base = { id: v.id, vehicle: v, model: v.model, shade: v.shade, condition: h0?.condition ?? 100, plate: v.plate };
      if (h0?.stays) { vehicles.push({ ...base, x: h0.at.x, z: h0.at.z, yaw: h0.at.yaw || 0, moving: false, wrecked: true }); continue; }
      if (s0.state !== "driving") { vehicles.push({ ...base, x: s0.x, z: s0.z, yaw: s0.yaw, moving: false, parked: true }); continue; }
      // A round at work (a patrol, a delivery round, a cab cruising) is a leg like any other:
      // driven by the rules near you, so it is never driven through what is in its way.
      let leg = s0.leg, route = null, key = null;
      if (s0.roam) {
        const owner = c.roster.people.get(v.owner), round = owner && c.roamDrive(owner, s0.leg, tt);
        if (!round) {
          const pos = owner && c.personAt(owner, tt, undefined, focus);
          if (pos && pos.mode === "drive") vehicles.push({ ...base, ...pos, moving: true });
          continue;
        }
        leg = round; route = round.route; key = `${v.id}:${round.key}`;
      } else { route = c.legRoute(leg); key = City.legKey(v, leg, tt.day); }
      if (!route || route.length < 1) continue;
      const startS = (dayStart + leg.t0 * 60000) / 1000, durS = Math.max(1, (leg.t1 - leg.t0) * 60);
      const sched = (ts) => Math.max(0, Math.min(1, (ts - startS) / durS)) * route.length;
      const unsched = (d) => startS + (d / route.length) * durS;
      const [w, , l] = VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan;
      // Out of sight of the rules: where its day has it, as far behind as traffic left it.
      const lagged = sched(tsec - D.delayOf(key));
      const probe = alongRoute(route, lagged);
      if (Math.hypot(probe.x - focus.x, probe.z - focus.z) < SIM_M || D.stateOf(v.id)?.key === key) {
        sim.push({ id: v.id, key, route, sched, unsched, limitAt: limitAt(v.model), cruise: Math.max(4, (route.length / durS) * 1.35), length: l, width: w });
        legOf.set(v.id, { base, route });
      } else {
        // At the end of its leg it is parked there, in the parking lane (and from the next pass,
        // at its spot).
        if (lagged >= route.length - 0.5) { vehicles.push({ ...base, ...(route.endSpot || alongRoute(route, route.length, PARK_LANE)), moving: false, parked: true }); continue; }
        // Not off yet (its leg starts later than the scan saw it): parked where it starts.
        if (lagged <= 0.05) { vehicles.push({ ...base, ...(route.startSpot || alongRoute(route, 0, PARK_LANE)), moving: false, parked: true }); continue; }
        const pos = easeToSpots(route, lagged, alongRoute(route, lagged, DRIVE_LANE));
        vehicles.push({ ...base, ...pos, moving: true, speed: route.length / durS });
      }
    }
    // Driven by the rules: you and everyone near on foot are in the way to be braked for.
    const obstacles = [];
    if (!car.active && !car.riding && !transit.ride && !shop.place) obstacles.push({ id: "me", x: you.x, z: you.z, player: true });
    for (const q of people) if (!q.indoors && !q.down && Math.abs(q.x - focus.x) < SIM_M && Math.abs(q.z - focus.z) < SIM_M) obstacles.push({ id: q.id, x: q.x, z: q.z });
    // In the way of the city's cars, and solid to them: your car, the route buses, your cab.
    const blockers = car.active ? [{ x: car.x, z: car.z, yaw: car.yaw, v: car.speed, length: (VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan)[2], width: (VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan)[0] }] : [];
    for (const b of [...routeBuses, ...(taxi.at ? [taxi.at] : [])]) {
      if (Math.abs(b.x - focus.x) > SIM_M || Math.abs(b.z - focus.z) > SIM_M) continue;
      const [bw, , bl] = VEHICLE_DIMS[b.model || "bus"] || VEHICLE_DIMS.sedan;
      blockers.push({ x: b.x, z: b.z, yaw: b.yaw, v: b.dwelling ? 0 : b.speed || 0, length: bl, width: bw });
    }
    // Cyclists are traffic too: a car behind one in a shared lane slows for it.
    for (const b of bikes) if (b.x !== undefined && Math.abs(b.x - focus.x) < SIM_M && Math.abs(b.z - focus.z) < SIM_M) blockers.push({ x: b.x, z: b.z, yaw: b.yaw, v: b.v, length: 1.8, width: 0.65 });
    if (sim.length) {
      const step = D.step(Math.min(dt, 0.1), tsec, sim, obstacles, blockers);
      for (const r0 of step.cars) {
        const { base, route } = legOf.get(r0.id);
        if (r0.arrived) { vehicles.push({ ...base, ...(route.endSpot || alongRoute(route, route.length, PARK_LANE)), moving: false, parked: true }); continue; }
        // In its own lane (Drivers: the lane it chose, or on its way across to the next).
        const pos = easeToSpots(route, r0.d, alongRoute(route, r0.d, D.stateOf(r0.id)?.side || DRIVE_LANE));
        vehicles.push({ ...base, ...pos, moving: r0.v > 0.2, speed: r0.v, braking: r0.braking, reason: r0.reason });
      }
      for (const hit of step.hits) carHit(hit, people);
    }
    for (const v of vehicles) if (v.moving) glide(v, now, dt, Math.max(4, v.speed || 0) * 1.6 + 2, 120); else glided.delete(v.id);
    if (glided.size > 6000) for (const [id, g] of glided) if (now - g.t > 2000) glided.delete(id);
    for (const v of vehicles) { const j = jolts.get(v.id); if (j) { const age = (now - j.t0) / 1000; if (age > 1.2) jolts.delete(v.id); else v.jolt = Math.sin(age * 18) * Math.exp(-age * 3) * Math.min(0.12, j.speed * 0.01); } }
    // Each car's tier: the ones only tracked are kept track of, and not drawn (drawCars).
    for (const v of vehicles) {
      const was = carTiers.get(v.id), tier = detailNow ? detailNow.tier("cars", v.x, v.z, was?.tier) : FULL;
      v.detail = tier;
      carTiers.set(v.id, { tier, next: tier === TRACKED ? nextAt(v.id, now, TRACK_EVERY_MS) : 0, seen: now });
      if (tier === TRACKED) trackedCars += 1;
    }
    drawnTiers.tracked.cars = trackedCars;
    if (carTiers.size > 20000) for (const [id, q] of carTiers) if (now - q.seen > 5000) carTiers.delete(id);
    drawnCars = vehicles;
    return { time: tt, people, vehicles };
  }
  // ---- crashes --------------------------------------------------------------------------------------
  //: A car of the city's that could not stop: it hits you, or someone on foot.
  async function carHit(hit, people) {
    const v = district.roster?.vehicles.get(hit.car);
    jolts.set(hit.car, { t0: performance.now(), speed: hit.speed });
    debrisAt(hit.x - Math.sin(hit.yaw) * 2, hit.z - Math.cos(hit.yaw) * 2, hit.yaw, hit.speed);
    const dx = -Math.sin(hit.yaw), dz = -Math.cos(hit.yaw);
    if (hit.player) {
      knockBack(dx, dz, hit.speed);
      const r = await send("collision", { kind: "hit_by_car", speed: hit.speed, vehicle: { id: hit.car, plate: v?.plate, x: hit.x, z: hit.z, yaw: hit.yaw } });
      if (r.ok) notify(`Hit by a car (${v?.plate || "?"}) at ${Math.round(hit.speed * MPH)} mph: ${r.injury.type}, -${r.injury.health} health. ${r.paid_by ? `${r.paid_by[0].toUpperCase()}${r.paid_by.slice(1)} pays the hospital.` : ""}`);
      return;
    }
    const q = people.find((x) => x.id === hit.who);
    if (!q) return;
    flings.set(q.id, { t0: performance.now(), x: q.x, z: q.z, dx, dz, speed: hit.speed, throw: Math.min(9, 1 + hit.speed * 0.5) });
    if (world) {
      // One of the city's cars hit one of its people: the books (this browser's, as the party's
      // host or alone) record it as the city's own.
      const h0 = world.harmed(q.id, "person", q.person?.name || null);
      const injury = injuryFor(R, { speed: hit.speed, seed: `${q.id}:${Date.now()}` });
      world.hurtPerson(h0, injury, { x: q.x + dx * Math.min(9, 1 + hit.speed * 0.5), z: q.z + dz * Math.min(9, 1 + hit.speed * 0.5), yaw: Math.atan2(-dx, -dz) }, `hit by a car (${v?.plate || "?"}) at ${Math.round(hit.speed * MPH)} mph`);
      const vh = world.harmed(hit.car, "vehicle", v?.plate || null);
      world.damageVehicle(vh, hit.speed * 0.35, hit, `hit ${q.person?.name || "someone"}`);
      district.city.forget(q.id);
      if (Math.hypot(q.x - me().x, q.z - me().z) < 60) notify(`A car hit ${q.person?.name || "someone"} at ${Math.round(hit.speed * MPH)} mph: ${injury.type}.`);
    }
  }
  //: You, hit: thrown back along the car's way, and the screen flashes.
  const flash = Object.assign(globalThis.document.createElement("div"), { id: "city-flash" });
  flash.style.cssText = "position:fixed;inset:0;z-index:33;pointer-events:none;background:radial-gradient(ellipse at center,rgba(200,20,20,0) 40%,rgba(200,20,20,.55));opacity:0;transition:opacity .6s";
  globalThis.document.body.append(flash);
  function knockBack(dx, dz, speed) {
    flash.style.transition = "none"; flash.style.opacity = String(Math.min(1, 0.35 + speed * 0.06));
    requestAnimationFrame(() => { flash.style.transition = "opacity 1.4s"; flash.style.opacity = "0"; });
    const metres = Math.min(7, 0.8 + speed * 0.45), t0 = performance.now();
    let done = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 450), want = metres * Math.sin(k * Math.PI / 2);
      const m = want - done; done = want;
      ctx.moveWalker(dx * m, dz * m);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  //: Pieces of a car, thrown from a crash (the kit's debris), lying a while where they land.
  const debrisGroup = new THREE.Group(); debrisGroup.name = "city-debris"; group.add(debrisGroup);
  const debrisParts = [];
  let debrisKit = null;
  function loadDebris() {
    if (debrisKit || !ctx.loadModel) return;
    debrisKit = Promise.all(KENNEY_DEBRIS.map((n) => ctx.loadModel(ctx.asset(`city/models/kenney/${n}.glb`)).then((g) => {
      const k = kenneyGeometry(THREE, g, null, n);
      const mesh = new THREE.Mesh(k.geometry, new THREE.MeshLambertMaterial({ map: k.map }));
      mesh.userData.debris = n;
      return mesh;
    }).catch(() => null))).then((list) => list.filter(Boolean));
  }
  async function debrisAt(x, z, yaw, speed) {
    loadDebris();
    const kit = debrisKit ? await debrisKit : [];
    const n = Math.min(9, 2 + Math.round(speed * 0.5));
    for (let i = 0; i < n; i += 1) {
      const mesh = kit.length ? kit[i % kit.length].clone() : new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.35), lambert({ color: 0x9aa0a6 }));
      const a = yaw + Math.PI + (Math.random() - 0.5) * 2.2, v = 1.5 + Math.random() * speed * 0.35;
      mesh.scale.setScalar(kit.length ? 0.9 : 1);
      mesh.position.set(x, groundAt(x, z) + 0.6, z);
      debrisGroup.add(mesh);
      // A part you can pick up once it lies still (a door, a bumper, a tyre; the rest is scrap).
      const item = R.found.debris?.[mesh.userData.debris] || null, born = performance.now();
      debrisParts.push({ mesh, vx: -Math.sin(a) * v, vz: -Math.cos(a) * v, vy: 2 + Math.random() * 3, spin: (Math.random() - 0.5) * 10, born, item, id: `debris:${Math.round(born)}:${i}` });
    }
    while (debrisParts.length > 60) { const old = debrisParts.shift(); old.mesh.removeFromParent(); }
  }
  function drawDebris(dt) {
    const now = performance.now();
    for (let i = debrisParts.length - 1; i >= 0; i -= 1) {
      const d = debrisParts[i], m = d.mesh;
      if (now - d.born > 120_000) { m.removeFromParent(); debrisParts.splice(i, 1); continue; }
      if (d.vy === null) continue;
      d.vy -= 9.8 * dt;
      m.position.x += d.vx * dt; m.position.z += d.vz * dt; m.position.y += d.vy * dt; m.rotation.y += d.spin * dt; m.rotation.x += d.spin * 0.5 * dt;
      const g = groundAt(m.position.x, m.position.z) + 0.04;
      if (m.position.y <= g) { m.position.y = g; d.vx *= 0.4; d.vz *= 0.4; d.vy = Math.abs(d.vy) > 1.5 ? -d.vy * 0.3 : null; if (d.vy === null) m.rotation.x = 0; }
    }
  }
  //: Nobody walks through you, nor you through them or a car: pushed apart, out of their way.
  function keepClear() {
    if (car.active || car.riding || transit.ride || !ctx.cityMode?.()) return;
    const you = me();
    let px = 0, pz = 0;
    for (const q of visible.people) {
      if (q.indoors && !shop.place) continue;
      const dx = you.x - q.x, dz = you.z - q.z, d = Math.hypot(dx, dz), r = 0.62;
      if (d < r && d > 1e-3) { px += (dx / d) * (r - d); pz += (dz / d) * (r - d); }
    }
    for (const v of visible.vehicles) {
      const [w, , l] = VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), dx = you.x - v.x, dz = you.z - v.z;
      const a = dx * fx + dz * fz, b = dx * fz - dz * fx, ha = l / 2 + 0.3, hb = w / 2 + 0.3;
      if (Math.abs(a) < ha && Math.abs(b) < hb) {
        // Out by the nearer side.
        const oa = ha - Math.abs(a), ob = hb - Math.abs(b);
        if (oa < ob) { px += fx * Math.sign(a || 1) * oa; pz += fz * Math.sign(a || 1) * oa; } else { px += fz * Math.sign(b || 1) * ob; pz -= fx * Math.sign(b || 1) * ob; }
      }
    }
    if (Math.hypot(px, pz) > 0.01) ctx.moveAvatarTo(you.x + px, you.z + pz, true);
  }
  function drawParked() {
    const w = view;
    if (!w) return;
    const p = w.players.get(myId);
    const mine = p ? w.registry.held(p.account).filter((a) => a.kind === "vehicle") : [];
    const ids = new Set(mine.map((a) => a.id));
    for (const [id, mesh] of parked) if (!ids.has(id) || (car.active && car.vehicle === id)) { mesh.removeFromParent(); parked.delete(id); }
    for (const a of mine) {
      if ((car.active && car.vehicle === a.id) || a.attrs.x === undefined || parked.has(a.id) || a.custody === "impounded") continue;
      const mesh = makeCar(a.attrs.model, R.vehicles.models[a.attrs.model].colour);
      mesh.position.set(a.attrs.x, groundAt(a.attrs.x, a.attrs.z), a.attrs.z); mesh.rotation.y = a.attrs.yaw || 0;
      group.add(mesh); parked.set(a.id, mesh);
    }
  }

  // ---- keys ------------------------------------------------------------------------------------
  const typing = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable;
  // One job to a key (ACTIONS.md). Enter (in and out: car, bus, taxi, shop, garage, doors) is the
  // page's, asked first of enterKey. The shop and the taxi are the top bar's buttons.
  const KEYS = {
    g: () => pickUp(), i: () => openSide("bag"), v: () => taskKey(),
    u: () => useSelected(), x: () => swingKey(), q: () => throwKey(), " ": () => jumpKey(), z: () => restKey(),
    j: () => openSide("tasks"), h: () => openSide("help"), "?": () => openSide("help"),
  };
  for (let i = 0; i < BAR; i += 1) KEYS[String(i + 1)] = () => selectSlot(i);
  addEventListener("keydown", (e) => {
    if (e.key === "Shift") { if (!typing(e.target)) body.sprintHeld = true; return; }
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !ctx.enabled()) return;
    if (e.key === " " && e.target instanceof HTMLButtonElement) return;   // Space on a focused button presses it
    // On the map the walker jumps too (Space); the game's other keys are City mode's.
    if (ctx.cityMode?.() === false) { if (e.key === " ") { e.preventDefault(); jumpKey(); } return; }
    const run = KEYS[e.key.length === 1 ? e.key.toLowerCase() : ""];
    if (!run) return;
    e.preventDefault();
    run();
  });
  addEventListener("keyup", (e) => { if (e.key === "Shift") body.sprintHeld = false; });
  addEventListener("blur", () => { body.sprintHeld = false; });

  async function toggleCar() {
    if (!ctx.enabled()) return;
    if (shop.place) return;
    if (car.active) return exitCar();
    if (car.riding) { car.riding = null; ctx.avatarVisible(true); notify("Out of the car."); refresh(); return; }
    const w = view, p = w?.players.get(myId);
    if (!p) { notify("Open the City panel to join the city first."); return; }
    const here = me();
    const near = (a) => a.attrs.x !== undefined && Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z) < 7;
    const mine = w.registry.held(p.account).find((a) => a.kind === "vehicle" && near(a));
    if (mine) return enterCar(mine.id);
    // A party member's car: ride with them while they drive; take it, parked, and it is theft.
    for (const peer of party.session?.players() || []) {
      if (peer.car?.driving && peer.at && Math.hypot(peer.at.x - here.x, peer.at.z - here.z) < 7) {
        const seats = R.vehicles.models[peer.car.model]?.seats || 5;
        if (occupantsOf(peer.id) >= seats) { notify("That car is full."); return; }
        car.riding = peer.id; ctx.avatarVisible(false); notify(`Riding with ${peer.name}. Enter to get out.`); refresh(); return;
      }
    }
    const theirs = [...w.registry.assets.values()].find((a) => a.kind === "vehicle" && a.holder !== p.account && near(a));
    if (theirs) {
      if (!globalThis.confirm?.(`This car (${theirs.attrs.plate}) is not yours. Take it anyway? That is theft: it will be reported, and you will be fined.`)) return;
      const r = await send("take", { asset: theirs.id, witnesses: Math.min(3, visible.people.filter((x) => Math.hypot(x.x - here.x, x.z - here.z) < 30).length) });
      if (!r.ok) { notify(r.error); return; }
      notify(r.evidence.length ? `Seen: ${r.evidence.join(", ")}. A ${R.fmt(R.fines.theft)} theft citation is on its way.` : "Nobody saw.");
      return enterCar(theirs.id);
    }
    notify(mine === undefined ? "No car of yours within a few steps. Buy one in the City panel." : "");
  }
  function occupantsOf(driverId) { return 1 + (party.session?.players() || []).filter((p) => p.car?.riding === driverId).length + (car.riding === driverId ? 1 : 0); }

  // ---- the panel -------------------------------------------------------------------------------
  const doc = globalThis.document;
  const css = `
#city{position:fixed;right:12px;top:var(--city-under,72px);z-index:36;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - var(--city-under,72px) - 120px);overflow:auto;background:var(--cp,#fff);color:var(--ci,#16202a);
 border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.24);font:13px/1.4 system-ui,sans-serif;padding:12px}
#city h3{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px}#city h3 span{flex:1}
#city h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--cm,#5c6770)}
#city .note{color:var(--cm,#5c6770);font-size:12px;margin:4px 0}
#city button{border:1px solid rgba(0,0,0,.18);background:var(--cb,#f6f7f8);color:inherit;border-radius:8px;padding:4px 8px;font:inherit;cursor:pointer;margin:2px 2px 2px 0}
#city button.primary{background:#1f6feb;color:#fff;border-color:#1f6feb}
#city table{width:100%;border-collapse:collapse;font-size:12px}#city td{padding:2px 0;vertical-align:top}#city td:last-child{text-align:right;white-space:nowrap}
#city .tabs{display:flex;gap:2px;flex-wrap:wrap;margin:4px 0 6px}#city .tabs button[aria-pressed=true]{background:#1f6feb;color:#fff}
#city select,#city input{font:inherit;border:1px solid rgba(0,0,0,.2);border-radius:6px;padding:3px 5px;background:inherit;color:inherit}
#city-hud{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:34;background:rgba(17,24,39,.86);color:#fff;border-radius:999px;
 padding:5px 14px;font:12px/1.4 system-ui,sans-serif;white-space:nowrap;pointer-events:auto;cursor:pointer;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}
#city-hud b{font-weight:700}#city-hud .warn{color:#ffb4a8}
#city-side{position:fixed;right:12px;top:var(--city-under,72px);z-index:37;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - var(--city-under,72px) - 130px);min-height:160px;overflow:auto;background:var(--cp,#fff);color:var(--ci,#16202a);
 border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.24);font:13px/1.4 system-ui,sans-serif;padding:12px}
#city-side select{font:inherit;border:1px solid rgba(0,0,0,.2);border-radius:6px;padding:2px 4px;background:inherit;color:inherit}
#city-side h3{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px}#city-side h3 span{flex:1}
#city-side h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--cm,#5c6770)}
#city-side .note{color:var(--cm,#5c6770);font-size:12px;margin:2px 0}
#city-side button{border:1px solid rgba(0,0,0,.18);background:var(--cb,#f6f7f8);color:inherit;border-radius:8px;padding:3px 8px;font:inherit;cursor:pointer;margin:2px 2px 2px 0}
#city-side button.primary{background:#1f6feb;color:#fff;border-color:#1f6feb}
#city-side .tabs{display:flex;gap:2px;flex-wrap:wrap;margin:4px 0 6px}#city-side .tabs button[aria-pressed=true]{background:#1f6feb;color:#fff}
#city-side table{width:100%;border-collapse:collapse;font-size:12px}#city-side td{padding:4px 4px 4px 0;vertical-align:top;border-top:1px solid rgba(128,128,128,.18)}
#city-side table.wares td:nth-child(2){white-space:nowrap;text-align:right}#city-side table.wares td:last-child{text-align:right;white-space:nowrap}
#city-side kbd{font:600 10px/1 ui-monospace,monospace;border:1px solid rgba(128,128,128,.55);border-radius:4px;padding:2px 4px;margin-left:2px;opacity:.85}
#city-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:42px;z-index:35;display:flex;gap:3px;align-items:flex-end;padding:3px;background:rgba(17,24,39,.72);border-radius:10px}
#city-bar .slot{position:relative;width:54px;height:54px;border:2px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);border-radius:7px;padding:3px;color:#fff;cursor:pointer;font:9px/1.05 system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;overflow:hidden}
#city-bar .slot.on{border-color:#ffd166;background:rgba(255,209,102,.18)}
#city-bar .slot em{position:absolute;left:3px;top:2px;font:600 9px/1 ui-monospace,monospace;opacity:.8;font-style:normal}
#city-bar .slot i,#city-side .grid .slot i{display:block;width:20px;height:16px;border-radius:3px;margin-bottom:2px}#city-bar .slot i.empty{background:none}
#city-bar .slot span{max-height:2.1em;overflow:hidden;text-align:center}#city-bar .slot b{position:absolute;right:3px;top:2px;font-size:10px}
#city-bar .inv{align-self:stretch;border:0;border-radius:7px;background:#1f6feb;color:#fff;font:12px system-ui,sans-serif;padding:0 10px;cursor:pointer}
#city-prompt{position:fixed;left:50%;transform:translateX(-50%);top:var(--city-under,72px);z-index:38;display:flex;align-items:center;gap:8px;background:rgba(17,24,39,.92);color:#fff;border-radius:12px;padding:8px 10px 8px 14px;font:13px/1.35 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:calc(100vw - 24px)}
#city-prompt button{border:0;border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer;background:#3a4450;color:#fff}#city-prompt button.primary{background:#1f6feb}
#city-side.wide{width:min(500px,calc(100vw - 24px))}
#city-side .grid{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;margin:4px 0}
#city-side .grid .slot{position:relative;aspect-ratio:1;border:2px solid rgba(128,128,128,.3);border-radius:6px;background:rgba(128,128,128,.08);padding:2px;margin:0;font:8.5px/1.05 system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;overflow:hidden;cursor:pointer}
#city-side .grid .slot.on{border-color:#d4a017}#city-side .grid .slot.cursor{border-color:#1f6feb;background:rgba(31,111,235,.15)}
#city-side .grid .slot em{position:absolute;left:2px;top:1px;font-style:normal;opacity:.7}#city-side .grid .slot b{position:absolute;right:2px;top:1px}
#city-side .grid .slot span{max-height:2.1em;overflow:hidden;text-align:center}
#city-side .qty{display:inline-flex;align-items:center;gap:2px}#city-side .qty b{min-width:18px;text-align:center}
#city-top{position:fixed;top:var(--city-top-y,16px);left:var(--city-top-left,280px);width:var(--city-top-w,480px);z-index:36;display:flex;flex-direction:column;gap:5px;align-items:center;box-sizing:border-box;padding:6px 8px;background:rgba(17,24,39,.86);border-radius:0 0 12px 12px;box-shadow:0 2px 12px rgba(0,0,0,.25);font:600 12px/1.2 system-ui,sans-serif;color:#fff}
#city-top.alone{border-radius:12px}
#city-top .here,#city-top .always{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;align-items:center}
#city-top .here:empty{display:none}
#city-top .here{border-top:1px solid rgba(255,255,255,.16);padding-top:5px;width:100%}
#city-top button{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer;white-space:nowrap;touch-action:manipulation}
#city-top button:hover{background:rgba(255,255,255,.22)}
#city-top button.primary{background:#1f6feb}#city-top button.shop{background:#16a34a;padding:6px 16px;font-size:13px}
#city-top kbd,#city-tasks kbd{font:600 10px/1 ui-monospace,monospace;border:1px solid rgba(255,255,255,.45);border-radius:4px;padding:2px 4px;margin-left:5px;opacity:.85}
.city-card{position:fixed;top:var(--city-top-y,16px);z-index:36;width:var(--city-card-w,200px);box-sizing:border-box;background:rgba(17,24,39,.86);color:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.25);padding:9px 11px;font:12px/1.35 system-ui,sans-serif}
#city-tasks{left:var(--city-tasks-x,72px);min-height:var(--city-card-h,0px);max-height:calc(100vh - var(--city-top-y,16px) - 130px);overflow:auto}
#city-tasks h4{margin:0 0 4px;display:flex;align-items:center;gap:6px;font:700 13px/1.2 system-ui,sans-serif;color:#fff}
#city-tasks h4 .word{flex:1;cursor:pointer}#city-tasks h4 .word:hover{text-decoration:underline}
#city-tasks h4 button{border:0;border-radius:6px;background:rgba(255,255,255,.14);color:#fff;font:700 13px/1 system-ui,sans-serif;width:26px;height:22px;cursor:pointer}
#city-tasks ol{margin:0;padding:0;list-style:none}
#city-tasks li{display:flex;gap:6px;align-items:flex-start;padding:5px 0;border-top:1px solid rgba(255,255,255,.1);cursor:pointer}
#city-tasks li:first-child{border-top:0}#city-tasks li.now{color:#7ee2a0}
#city-tasks li .arrow{display:inline-block;font-size:14px;width:16px;text-align:center;flex:none}
#city-tasks li .dot{width:16px;text-align:center;flex:none;opacity:.6}
#city-tasks li div{flex:1;min-width:0}#city-tasks li small{display:block;opacity:.7;font-size:11px}
#city-tasks li button{flex:none;border:0;border-radius:6px;background:#1f6feb;color:#fff;font:600 11px system-ui,sans-serif;padding:3px 8px;cursor:pointer}
#city-tasks p{margin:2px 0;opacity:.75}
#city-profile{right:16px;cursor:pointer}
#city-profile .who{display:flex;gap:9px;align-items:center;margin-bottom:6px}
#city-profile .face{width:58px;height:58px;border-radius:50%;flex:none;background:#2a3542 center/cover no-repeat;border:2px solid rgba(255,255,255,.25)}
#city-profile .money{font:700 17px/1.15 system-ui,sans-serif;letter-spacing:-.01em}#city-profile .money small{display:block;font:500 11px/1.2 system-ui,sans-serif;opacity:.7;letter-spacing:0}
#city-profile .bar{display:grid;grid-template-columns:54px 1fr 24px;align-items:center;gap:6px;margin:3px 0}
#city-profile .bar i{display:block;height:7px;border-radius:4px;background:linear-gradient(90deg,var(--c) var(--v),rgba(255,255,255,.14) var(--v))}
#city-profile .bar b{text-align:right;font-weight:600}#city-profile .carry{opacity:.8;margin-top:4px;font-size:11px}#city-profile .gig{margin-top:3px;color:#7ee2a0;font-size:11px}
#city-top[hidden],.city-card[hidden],#city-prompt[hidden]{display:none!important}
#city.pop{left:max(16px,5vw);right:max(16px,5vw);top:max(16px,5vh);bottom:max(16px,5vh);width:auto;max-height:none;z-index:70;padding:18px 22px;font-size:13px;box-shadow:0 0 0 100vmax rgba(8,12,18,.45),0 12px 40px rgba(0,0,0,.4)}
#city.pop .me{display:flex;gap:16px;align-items:center;margin-bottom:12px}
#city.pop .me .face{width:104px;height:104px;border-radius:50%;flex:none;background:#2a3542 center/cover no-repeat;border:3px solid rgba(128,128,128,.3)}
#city.pop .me h2{margin:0;font:700 22px/1.2 system-ui,sans-serif}#city.pop .me .worth{font:700 28px/1.2 system-ui,sans-serif;letter-spacing:-.01em}
#city.pop .me .worth small{display:block;font:500 12px/1.3 system-ui,sans-serif;color:var(--cm,#5c6770);letter-spacing:0}
#city.pop .me>button{align-self:flex-start;margin-left:auto;font-size:18px;line-height:1;padding:6px 11px}
#city.pop .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-bottom:14px}
#city.pop .tile{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:10px 12px;min-width:0}
#city.pop .tile h4{margin:0 0 6px}#city.pop .tile td{border-top:1px solid rgba(128,128,128,.15);padding:3px 0}
#city.pop .tile tr.sum td{font-weight:700}#city.pop .neg{color:#c0392b}
#city.pop .bar{display:grid;grid-template-columns:70px 1fr 30px;align-items:center;gap:8px;margin:4px 0}
#city.pop .bar i{display:block;height:8px;border-radius:4px;background:linear-gradient(90deg,var(--c) var(--v),rgba(128,128,128,.2) var(--v))}
#city.pop .bar b{text-align:right}
@media (max-width:760px){.city-card{padding:7px 9px;font-size:11px}#city-profile .face{width:42px;height:42px}#city-profile .money{font-size:14px}#city-profile .bar{grid-template-columns:44px 1fr 20px}#city-top button{padding:5px 8px}}
@media (prefers-color-scheme:dark){#city,#city-side{--cp:#1d2329;--ci:#e6edf3;--cm:#9aa6b1;--cb:#2a3138}}`;
  doc.head.append(Object.assign(doc.createElement("style"), { textContent: css }));
  const hudBox = Object.assign(doc.createElement("div"), { id: "city-hud", title: "The living city: open the City panel" });
  hudBox.onclick = () => openPanel();
  doc.body.append(hudBox);
  let panel = null, tab = "you", notice = "", noticeAt = 0;
  function notify(text) { if (!text) return; notice = text; noticeAt = Date.now(); hud(); ctx.notify?.(text); }
  function hud() {
    const w = view, p = w?.players.get(myId);
    const t = timeAt(Date.now());
    const [lon, lat] = ctx.toLonLat(me().x, me().z);
    const here = jurisdictionAt(R, lon, lat, district.county);
    const bits = [`<b>${p ? R.fmt(w.ledger.balance(p.account)) : "Arriving…"}</b>`, t.label, here.name];
    if (car.active) {
      const limit = speedLimitAt(car.x, car.z) * MPH, mph = Math.abs(car.speed) * MPH;
      bits.push(`<span class="${mph > limit + 5 ? "warn" : ""}">${Math.round(mph)} mph · limit ${Math.round(limit)}</span>`);
      if (car.lane) bits.push(car.lane.managed ? `<span class="${car.lane.active && occupants() < car.lane.minimum && car.lane.kind === "hov" ? "warn" : ""}">${car.lane.kind === "express" ? "Express lane" : "Carpool lane"} ${car.lane.minimum}+ ${car.lane.active ? "" : "(open to all now)"} · ${occupants()} aboard</span>` : `lane ${car.lane.lane + 1} of ${car.lane.of}`);
    }
    if (car.riding) bits.push("riding");
    if (transit.ride?.route) { const v = routeBuses.find((x) => x.id === transit.ride.vehicle); if (v) bits.push(`${transit.ride.route} · next ${v.nextName || "—"}${transit.ride.stop ? " (stopping)" : ""}`); }
    const water = ctx.waterAt?.(me().x, me().z);
    if (water) bits.push(`${water.name} · salt ${water.salinity.toFixed(1)} · ${water.density.toFixed(0)} kg/m³`);
    const owed = p ? w.billing.owed(p.account) : 0;
    if (owed) bits.push(`<span class="warn">owed ${R.fmt(owed)}</span>`);
    if (Date.now() - noticeAt < 7000) bits.push(notice.replace(/[<>&]/g, ""));
    hudBox.innerHTML = bits.join(" · ");
    hudBox.hidden = !ctx.enabled();
    drawBars();
  }
  const h = (tag, props = {}, ...kids) => {
    const attrs = {}, rest = {};
    for (const [k, v] of Object.entries(props)) (k.startsWith("aria-") || k.startsWith("data-") ? attrs : rest)[k] = v;
    const e = Object.assign(doc.createElement(tag), rest);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    e.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
    return e;
  };
  const row = (a, b) => h("tr", {}, h("td", { textContent: a }), h("td", { textContent: b }));
  const act = (label, fn, primary = false) => h("button", { textContent: label, className: primary ? "primary" : "", onclick: async () => { const r = await fn(); if (r && r.ok === false) notify(r.error); refresh(); } });
  // ---- the top bar: tasks on the left, you on the right, the buttons between -------------------
  //: One bar along the top that comes lower at its two ends: on the left your tasks (the top
  //: three, the arrow for all of them), on the right you -- your face, your money, health,
  //: stamina and strength (a click opens the wallet) -- and between them the buttons that are
  //: always there (the Shop in the middle) over what you can do where you stand. The map's
  //: controls open at the top left, and the bar moves over to make room for them.
  const actionBar = Object.assign(doc.createElement("div"), { id: "city-top" });
  actionBar.setAttribute("role", "toolbar"); actionBar.setAttribute("aria-label", "What you can do");
  const dynamicActions = Object.assign(doc.createElement("div"), { className: "here" });
  const alwaysActions = Object.assign(doc.createElement("div"), { className: "always" });
  const helpButton = h("button", { title: "The controls (H)", onclick: () => openSide("help") }, "Controls");
  const tasksButton = h("button", { title: "The task board: work to take (J)", onclick: () => openSide("tasks") }, "Task board");
  const onlineButton = h("button", { className: "shop", title: "The shop: anything sold in the city, from anywhere, at twice the price; homes at their price", onclick: () => openSide("online") }, "Shop");
  const bagButton = h("button", { title: "The inventory (I)", onclick: () => openSide("bag") }, "Inventory");
  const taxiButton = h("button", { title: "Call a taxi to where you stand (Enter gets in when it pulls up)", onclick: () => taxiKey() }, "Taxi");
  alwaysActions.append(bagButton, tasksButton, onlineButton, taxiButton, helpButton);
  actionBar.append(alwaysActions, dynamicActions);
  const tasksCard = h("section", { id: "city-tasks", className: "city-card" });
  tasksCard.setAttribute("aria-label", "Tasks");
  tasksCard.hidden = true;
  const profileCard = h("section", { id: "city-profile", className: "city-card", title: "You: your wallet, job, home, car and the laws", onclick: () => openPanel(true) });
  profileCard.setAttribute("aria-label", "You: money, health, stamina and strength");
  profileCard.hidden = true;
  hotbar = Object.assign(doc.createElement("div"), { id: "city-bar" });
  hotbar.setAttribute("role", "toolbar"); hotbar.setAttribute("aria-label", "Your bar: 1 to 8 choose what is in your hand");
  promptBox = Object.assign(doc.createElement("div"), { id: "city-prompt" });
  promptBox.hidden = true;
  doc.body.append(tasksCard, actionBar, profileCard, hotbar, promptBox);
  let actionsKey = "", profileKey = "";
  const bar = (label, value, colour) => `<div class="bar"><span>${label}</span><i style="--v:${Math.max(0, Math.min(100, value)).toFixed(1)}%;--c:${colour}"></i><b>${Math.round(value)}</b></div>`;
  //: Where the bar's parts go: the tasks card right of the Map button (right of the map's
  //: controls while they are open), the profile card in the top right with the compass under it,
  //: and the buttons between. Too narrow for all three side by side, the buttons go under the
  //: cards; too narrow even for the two cards beside the open map controls, the tasks card waits.
  function layoutBars() {
    const root = doc.documentElement, W = globalThis.innerWidth || 1200, on = !actionBar.hidden;
    const fold = doc.getElementById("fold"), hud = doc.getElementById("hud"), sidebar = doc.getElementById("map-sidebar");
    const F = fold && fold.offsetParent !== null ? fold.getBoundingClientRect() : null;
    // The map's controls, or the step-by-step directions in their place (City mode has them too).
    const nav = doc.getElementById("nav-panel");
    const mapOpen = hud?.dataset.open === "true" && sidebar && sidebar.offsetParent !== null;
    const M = nav && !nav.hidden && nav.offsetParent !== null ? nav.getBoundingClientRect() : mapOpen ? sidebar.getBoundingClientRect() : null;
    const cp = doc.getElementById("compass");
    const card = W < 640 ? 150 : W < 1000 ? 180 : 200, y = 16;
    root.style.setProperty("--city-card-w", `${card}px`);
    root.style.setProperty("--city-top-y", `${y}px`);
    let left = Math.max(F ? F.right + 10 : 12, M ? M.right + 10 : 0);
    const right = W - 16 - card;                     // the profile card's left edge
    tasksCard.hidden = !on || !self() || right - left < card + 8;
    if (!tasksCard.hidden) { root.style.setProperty("--city-tasks-x", `${Math.round(left)}px`); left += card; }
    // The buttons between the cards, joined to them; under them when there is no room.
    const gap = right - left;
    const under = gap < 300;
    actionBar.classList.toggle("alone", under || tasksCard.hidden);
    if (under) {
      const P = profileCard.hidden ? null : profileCard.getBoundingClientRect(), T = tasksCard.hidden ? null : tasksCard.getBoundingClientRect();
      const top = Math.max(F ? F.bottom : 0, P ? P.bottom : 0, T ? T.bottom : 0, y) + 8;
      root.style.setProperty("--city-top-left", `${Math.max(12, M ? M.right + 10 : 12)}px`);
      root.style.setProperty("--city-top-w", `${Math.round(W - Math.max(12, M ? M.right + 10 : 12) - 12)}px`);
      actionBar.style.top = `${Math.round(top)}px`;
    } else {
      root.style.setProperty("--city-top-left", `${Math.round(left)}px`);
      root.style.setProperty("--city-top-w", `${Math.round(gap)}px`);
      actionBar.style.top = "";
    }
    // The tasks card as tall as the profile card at least: the bar's two ends alike.
    const P = profileCard.hidden ? null : profileCard.getBoundingClientRect();
    root.style.setProperty("--city-card-h", `${P && P.height ? Math.round(P.height) : 0}px`);
    // The compass under the profile card while the game is on.
    if (cp) cp.style.top = on && P && P.height ? `${Math.round(P.bottom + 8)}px` : "16px";
    const B = on ? actionBar.getBoundingClientRect() : null, C = cp ? cp.getBoundingClientRect() : null;
    // The compass's open box (heading and sun) stays under the compass as it moves: never over the card.
    const dial = doc.getElementById("sun-dial");
    if (dial && !dial.hidden && C && C.height) {
      dial.style.top = `${Math.round(C.bottom + 8)}px`;
      dial.style.maxHeight = `${Math.max(160, (globalThis.innerHeight || 800) - Math.round(C.bottom + 8) - 12)}px`;
    }
    root.style.setProperty("--city-under", `${Math.round(Math.max(B && B.height ? B.bottom : y + 44, C ? C.bottom : 0, P ? P.bottom : 0) + 8)}px`);
  }
  globalThis.addEventListener?.("resize", () => layoutBars());
  // The map's controls opened or closed: the bar makes room.
  doc.getElementById("fold")?.addEventListener("click", () => setTimeout(layoutBars, 0));
  //: Your face for the profile card: drawn from the walker by the page (ctx.portrait), again now
  //: and then (a change of clothes, a new avatar), never while you are out of sight in a car.
  let face = null, faceAt = 0;
  function portrait() {
    const now = performance.now();
    if (face && now - faceAt < 45000) return face;
    if (!ctx.portrait || car.active || car.riding || transit.ride || shop.place) return face;
    faceAt = now;
    try { face = ctx.portrait(96) || face; } catch (error) { console.warn("kerbside: portrait", error); }
    return face;
  }
  function drawBars() {
    const p = self();
    const game = ctx.enabled() && ctx.cityMode?.() !== false;
    const on = game && Boolean(p);
    actionBar.hidden = !game; profileCard.hidden = !on;
    const acts = game ? actionsHere() : [];
    const key = acts.map((a) => `${a.id}:${a.label}`).join("|");
    if (key !== actionsKey) {
      actionsKey = key;
      dynamicActions.replaceChildren(...acts.map((a, i) => h("button", { className: i === 0 || a.id === "shop" || a.id === "deliver" ? "primary" : "", onclick: () => a.run() }, `${a.label} `, a.key ? h("kbd", { textContent: a.key }) : null)));
    }
    taxiButton.textContent = transit.ride && !transit.ride.route ? "Out of the taxi" : taxi.phase === "coming" ? "Taxi coming" : taxi.phase === "waiting" ? "Get in the taxi" : "Taxi";
    drawTodo();
    if (on) drawProfile(p);
    layoutBars();
  }
  function drawProfile(p) {
    const v = p.vitals, S = R.vitals.stamina, w = view;
    const c = w.carry ? w.carry(p) : { kg: carriedKg(R, p.inventory), capacity: carryCapacity(R, v.strength, p.inventory) };
    const state = p.resting ? "resting" : v.stamina < S.low ? "exhausted: slowed" : body.sprinting && body.sprintHeld ? "sprinting" : transit.ride ? `on the ${transit.ride.route || transit.ride.kind}` : shop.place ? "in the shop" : "";
    const esc = (t) => String(t).replace(/[<>&]/g, "");
    const gig = p.delivery ? `<div class="gig">Parcel to ${esc(p.delivery.to.name || "a home")}: ${Math.round(Math.hypot(me().x - p.delivery.to.x, me().z - p.delivery.to.z))} m, ${Math.max(0, Math.round((p.delivery.due - Date.now()) / 60000))} min</div>` : "";
    const task = p.clocked?.task;
    const job = p.clocked ? `<div class="gig" style="color:#ffc46b">${task ? `${esc(task.label)}${working ? ` — ${Math.min(100, Math.round((performance.now() - working.started) / 10 / working.seconds))}%` : ` (V, ${Math.round(Math.hypot(me().x - task.x, me().z - task.z))} m)`}` : "On shift"}</div>` : "";
    const hands = p.hands ? `<div class="carry">In hand: ${esc(R.items[p.hands]?.name || p.hands)}</div>` : "";
    const owed = w.billing.owed(p.account);
    const img = portrait();
    const html = `<div class="who"><div class="face"${img ? ` style="background-image:url(${img})"` : ""}></div><div class="money">${R.fmt(w.ledger.balance(p.account))}<small>${owed ? `owed ${R.fmt(owed)}` : esc(p.name || "You")}</small></div></div>`
      + bar("Health", v.health, v.health < 25 ? "#ff6b5e" : "#e2483d") + bar("Stamina", v.stamina, v.stamina < S.low ? "#ffb84d" : "#e8a33b") + bar("Strength", v.strength, "#3c8fd6")
      + `<div class="carry">Carrying ${c.kg} of ${c.capacity} kg${state ? ` · ${state}` : ""}</div>${hands}${gig}${job}`;
    if (html === profileKey) return;
    profileKey = html;
    profileCard.innerHTML = html;
  }

  // ---- the shop, the bag, the controls ----------------------------------------------------------
  let side = null;   // {kind, el, place, store}
  function openSide(kind, place = null) {
    if (side && side.kind === kind && (!place || side.place?.id === place.id)) { closeSide(); return; }
    closeSide();
    if (panel) { panel.remove(); panel = null; }
    const el = h("section", { id: "city-side", className: "city-win" });
    el.setAttribute("aria-label", { store: "Shop", bag: "Inventory", ride: "Buses and taxis", tasks: "Task board", online: "Online store" }[kind] || "Controls");
    doc.body.append(el);
    side = { kind, el, place, store: 0 };
    drawSide();
  }
  function closeSide() { side?.el.remove(); side = null; }
  function openStore(place) {
    if (!self()) { openPanel(true); return; }
    openSide("store", place);
  }
  const effectText = (it) => {
    const bits = Object.entries(it.use || {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`);
    if (it.tool) bits.push(`tool (${it.tool})`); if (it.material) bits.push("material"); if (it.wear) bits.push(`wear (${it.wear})`);
    if (it.carry_kg) bits.push(`+${it.carry_kg} kg to carry`); if (it.needs) bits.push(`needs a ${it.needs}`);
    if (it.kg && !it.service) bits.push(`${it.kg} kg`);
    return bits.join(", ");
  };
  function drawSide() {
    if (!side) return;
    const w = view, p = self();
    const close = h("button", { textContent: "×", title: "Close (or the key that opened it)", onclick: closeSide });
    if (!w || !p) { side.el.replaceChildren(h("h3", {}, h("span", { textContent: "The living city" }), close), h("p", { className: "note", textContent: "Setting up your place in the city…" })); return; }
    const c = w.carry(p);
    const status = h("p", { className: "note", textContent: `Balance ${R.fmt(w.ledger.balance(p.account))} · carrying ${c.kg} of ${c.capacity} kg · health ${Math.round(p.vitals.health)}, stamina ${Math.round(p.vitals.stamina)}, strength ${Math.round(p.vitals.strength)}` });
    const say = async (promise, text) => { const r = await promise; notify(r.ok ? text(r) : r.error); drawSide(); };
    if (side.kind === "store") {
      // The shop's wares and prices: choose how many of each, then Checkout shows the total with
      // the sales tax, and Confirm buys it all (into your inventory) if you have the credits.
      const place = side.place;
      const stores = storesAt(R, place.keys);
      const store0 = stores[Math.min(side.store, stores.length - 1)];
      const [lon, lat] = ctx.toLonLat(place.x, place.z);
      const chain = jurisdictionAt(R, lon, lat, district.county).chain;
      const title = h("h3", {}, h("span", { textContent: `${store0.name}${place.name ? " — " + address(place.name) : ""}` }), close);
      const tabs = stores.length > 1 ? h("div", { className: "tabs" }, ...stores.map((s2, i) => h("button", { textContent: s2.name, "aria-pressed": String(i === side.store), onclick: () => { side.store = i; drawSide(); } }))) : null;
      if (!shop.place && Math.hypot(me().x - place.x, me().z - place.z) > R.stores.reach_m * 2) { side.el.replaceChildren(title, h("p", { className: "note", textContent: "You have walked away from the shop." })); return; }
      side.cart ||= {};
      const cart = side.cart, balance = w.ledger.balance(p.account);
      const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, qty]) => {
        const it = R.items[id], price = it.price * qty;
        return { id, qty, it, price, tax: itemTax(R, chain, it, price, w.laws) };
      });
      const sub = lines.reduce((a, l) => a + l.price, 0), tax = lines.reduce((a, l) => a + l.tax, 0), total = sub + tax;
      if (side.confirm && lines.length) {
        const rows = lines.map((l) => h("tr", {}, h("td", { textContent: `${l.qty} × ${l.it.name}` }), h("td", { textContent: R.fmt(l.price) }), h("td", { textContent: l.tax ? `+${R.fmt(l.tax)} tax` : "" })));
        const short = balance < total;
        side.el.replaceChildren(title, h("h4", { textContent: "Checkout" }), h("table", { className: "wares" }, ...rows),
          h("table", {}, row("Subtotal", R.fmt(sub)), row(`Sales tax (${(salesRate(R, chain, w.laws) * 100).toFixed(2)}%, on what is taxed)`, R.fmt(tax)), row("Total", R.fmt(total)), row("Your balance", `${R.fmt(balance)} → ${R.fmt(balance - total)}`)),
          short ? h("p", { className: "note", style: "color:#e2483d", textContent: `Not enough credits: ${R.fmt(total - balance)} short. Take something out of the basket.` }) : "",
          h("div", { style: "display:flex;gap:6px;justify-content:flex-end;margin-top:8px" },
            h("button", { textContent: "Back to the shop", onclick: () => { side.confirm = false; drawSide(); } }),
            h("button", { className: "primary", textContent: `Confirm — pay ${R.fmt(total)}`, disabled: short, onclick: async () => {
              const r = await send("checkout", { place, cart: lines.map((l) => ({ item: l.id, qty: l.qty })) });
              if (!r.ok) { notify(r.error); return; }
              side.cart = {}; side.confirm = false;
              notify(`Paid ${R.fmt(r.total)}${r.tax ? ` (${R.fmt(r.tax)} of it tax)` : ""}: ${r.lines.map((l) => `${l.qty} × ${R.items[l.item].name.toLowerCase()}`).join(", ")}. In your inventory (I).`);
              syncSlots(true); drawSide();
            } })));
        return;
      }
      const qty = (id, it) => {
        const n = cart[id] || 0, most = it.service ? 1 : 20;
        return h("span", { className: "qty" }, h("button", { textContent: "−", title: "One fewer", disabled: !n, onclick: () => { cart[id] = Math.max(0, n - 1); drawSide(); } }),
          h("b", { textContent: String(n) }), h("button", { textContent: "+", title: "One more", disabled: n >= most, onclick: () => { cart[id] = Math.min(most, n + 1); drawSide(); } }));
      };
      const rows = store0.items.filter((id) => !R.items[id].service).map((id) => {
        const it = R.items[id], ph = physOf(R, id);
        const t1 = itemTax(R, chain, it, it.price, w.laws);
        const info = `${effectText(it)}${it.service ? "" : ` · ${weightClass(R, ph.kg, p.vitals.strength)}`}`;
        return h("tr", { style: cart[id] ? "background:rgba(31,111,235,.08)" : "" }, h("td", {}, h("b", { textContent: it.name }), h("div", { className: "note", textContent: info })),
          h("td", { textContent: `${R.fmt(it.price)}${t1 ? ` +${R.fmt(t1)}` : ""}` }), h("td", {}, qty(id, it)));
      });
      const extra = [];
      // Services and hiring are the Shop's (the top bar): Services and Jobs, at their own prices.
      // A service booked for here is had here.
      const mine = (p.bookings || []).filter((b) => b.place.id === place.id);
      if (mine.length) extra.push(h("h4", { textContent: "Booked here" }), h("div", {}, ...mine.map((b) => act(`Have your ${R.items[b.item].name.toLowerCase()}`, () => useBooking(b), true))));
      const offered = stores.flatMap((st) => st.items.filter((id) => R.items[id].service));
      const jobs = R.jobs.player_jobs.filter((r) => R.jobs.roles[r].at.some((k) => place.keys.includes(k)));
      if (offered.length || jobs.length) extra.push(h("h4", { textContent: "Services and jobs" }),
        h("p", { className: "note", textContent: `${offered.length ? `${offered.map((id) => R.items[id].name).join(", ")}: book in the Shop's Services. ` : ""}${jobs.length ? `Hiring ${jobs.map((r) => R.jobs.roles[r].title.toLowerCase()).join(", ")}: apply in the Shop's Jobs.` : ""}` }),
        h("div", {}, offered.length ? act("Services", () => { openSide("online"); side.cat = "services"; drawSide(); }) : "", jobs.length ? act("Jobs", () => { openSide("online"); side.cat = "jobs"; drawSide(); }) : ""));
      if (deliveryHere(place) && !p.delivery) extra.push(h("h4", { textContent: "Deliveries" }), act(`Take a delivery gig (${R.fmt(R.delivery.base_pay)} + ${R.fmt(R.delivery.pay_per_km)}/km)`, () => takeDelivery(place)));
      const count = lines.reduce((a, l) => a + l.qty, 0);
      side.el.replaceChildren(title, tabs || "", status, h("table", { className: "wares" }, ...rows),
        h("div", { style: "position:sticky;bottom:-12px;background:var(--cp,#fff);padding:8px 0;display:flex;gap:8px;align-items:center;justify-content:flex-end;border-top:1px solid rgba(128,128,128,.25)" },
          h("span", { className: "note", textContent: count ? `${count} in the basket · ${R.fmt(sub)} before tax` : "Choose how many with + and −." }),
          count ? h("button", { textContent: "Empty", onclick: () => { side.cart = {}; drawSide(); } }) : "",
          h("button", { className: "primary", textContent: "Checkout", disabled: !count, onclick: () => { side.confirm = true; drawSide(); } })),
        ...extra);
      return;
    }
    if (side.kind === "bag") {
      // The inventory: the grid of 24 and, below it, the bar of 8 (1-8 choose; what is chosen is in
      // your hand). Click a thing, then another slot, to move it; what it is and what it does below.
      side.el.classList.add("wide");
      syncSlots();
      const title = h("h3", {}, h("span", { textContent: "Inventory" }), close);
      const peers = (party.session?.players() || []).map((peer) => ({ peer, pid: party.ids.get(peer.id) })).filter((x) => x.pid && x.pid !== myId);
      const cell = (i) => {
        const id = slots[i], n = slotCount(slots, p.inventory, i);
        const b = h("button", { className: `slot${i === chosen ? " on" : ""}${i === cursorSlot ? " cursor" : ""}`, title: id ? `${R.items[id]?.name} ×${n}` : "empty",
          onclick: () => {
            if (cursorSlot < 0) { if (id) { cursorSlot = i; side.pick = id; } }
            else { slots = swap(slots, cursorSlot, i); side.pick = slots[i]; cursorSlot = -1; saveSlots(); syncSlots(); }
            drawSide();
          } });
        b.innerHTML = `${i < BAR ? `<em>${i + 1}</em>` : ""}${slotFace(id, n)}`;
        return b;
      };
      const grid = h("div", { className: "grid" }, ...Array.from({ length: GRID }, (_, k) => cell(BAR + k)));
      const bar = h("div", { className: "grid", style: "margin-top:8px;padding-top:6px;border-top:2px solid rgba(128,128,128,.3)" }, ...Array.from({ length: BAR }, (_, k) => cell(k)));
      const pickId = side.pick && p.inventory[side.pick] > 0 ? side.pick : slots[chosen];
      const detail = [];
      if (pickId) {
        const it = R.items[pickId] || { name: pickId }, ph = physOf(R, pickId), n = p.inventory[pickId] || 0;
        const worn = Object.values(p.worn || {}).includes(pickId), inHand = p.hands === pickId;
        const sw = swingOf(R, pickId, p.vitals.strength), th = throwOf(R, pickId, p.vitals.strength);
        detail.push(h("h4", { textContent: `${it.name}${n > 1 ? ` ×${n}` : ""}${inHand ? " — in your hand" : ""}${worn ? " (worn)" : ""}` }),
          h("p", { className: "note", textContent: `${weightClass(R, ph.kg, p.vitals.strength)}, ${ph.kg} kg · ${ph.material} · held ${ph.hold === "two_hands" ? "in both arms" : ph.hold === "shoulder" ? "on the shoulder" : ph.hold === "tool" ? "by the handle" : "in one hand"}${effectText(it) ? ` · ${effectText(it)}` : ""}` }),
          h("p", { className: "note", textContent: `X: ${sw.ok ? (sw.kind === "blunt" ? `swings it (${Math.round(sw.joules)} J${sw.breaks ? ", and it breaks" : ""})` : `strikes with it (${R.tools.kinds[sw.kind]?.name.toLowerCase() || "a tool"}, ${R.tools.kinds[sw.kind]?.energy_j || "?"} J at full strength)`) : sw.reason} · Q: ${th.ok ? `throws it about ${Math.round(th.range)} m${th.lands !== "whole" ? ` (it ${th.lands === "spills" ? "spills" : "breaks"})` : ""}` : th.reason}` }));
        const btns = [];
        const slotOf = slots.indexOf(pickId);
        if (slotOf >= BAR || slotOf < 0) btns.push(h("button", { textContent: `To the bar (${chosen + 1})`, onclick: () => { const at = slots.indexOf(pickId); if (at >= 0) { slots = swap(slots, at, chosen); saveSlots(); syncSlots(); drawSide(); } } }));
        else if (slotOf !== chosen) btns.push(h("button", { textContent: `Hold it (${slotOf + 1})`, onclick: () => { selectSlot(slotOf); drawSide(); } }));
        if (inHand && (it.use || it.wear)) btns.push(h("button", { className: "primary", textContent: it.wear ? (worn ? "Take off (U)" : "Wear (U)") : `${it.kind === "prepared_food" || it.use?.stamina ? "Eat or drink" : "Use"} (U)`, onclick: () => useSelected() }));
        if (!it.parcel) btns.push(h("button", { textContent: "Put down", onclick: () => say(send("drop", { item: pickId }), () => `Put down: ${it.name.toLowerCase()}. G picks it up.`).then(() => syncSlots(true)) }));
        if (!it.parcel) for (const { peer, pid } of peers) btns.push(h("button", { textContent: `Give to ${peer.name}`, onclick: () => say(send("give_item", { to: pid, item: pickId }), (r) => `Gave ${r.to} the ${it.name.toLowerCase()}.`).then(() => syncSlots(true)) }));
        detail.push(h("div", {}, ...btns));
      } else detail.push(h("p", { className: "note", textContent: "Empty hand: X punches. Shops sell food, medicine, tools and clothes (Enter at a shop, then the SHOP panel by the door); things on the ground with a yellow ring are picked up with G." }));
      const here = me();
      const cars = w.registry.held(p.account).filter((a) => a.kind === "vehicle").map((a) => {
        const spec = R.vehicles.models[a.attrs.model];
        const d = a.attrs.x === undefined ? null : Math.round(Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z));
        return row(`${spec.name} ${a.attrs.plate}`, car.vehicle === a.id && car.active ? "driving" : d === null ? a.custody : `${d} m away`);
      });
      const homes = [...w.registry.owned(p.account, "home"), ...w.registry.held(p.account).filter((a) => a.kind === "home" && a.owner !== p.account)].map((a) => row(`${address(a.attrs.address) || "A home"}${a.attrs.label ? " " + a.attrs.label : ""}`, `${Math.round(Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z))} m`));
      side.el.replaceChildren(title, status, grid, bar,
        h("p", { className: "note", textContent: cursorSlot >= 0 ? "Now click the slot to put it in (it swaps with what is there)." : "Click a thing, then a slot, to move it. The bottom row is your bar: 1-8 choose; what is chosen is in your hand." }),
        ...detail,
        p.delivery ? h("div", {}, act("Cancel the delivery", () => send("cancel_delivery"))) : "",
        h("h4", { textContent: "Also yours" }), h("table", {}, ...cars, ...homes, row("Balance", R.fmt(w.ledger.balance(p.account))), row("Owed", R.fmt(w.billing.owed(p.account)))));
      return;
    }
    if (side.kind === "ride") {
      const title = h("h3", {}, h("span", { textContent: "Buses and taxis" }), close);
      const stop = nearestStop(90);
      const out = [title, status];
      if (stop) {
        out.push(h("h4", { textContent: `Stop: ${stop.name}` }), h("p", { className: "note", textContent: `${Math.round(stop.d)} m away. Wait at the red flag; when the bus stands there, Enter boards it (${R.fmt(R.transit.bus_fare)}; it waits ${TL.bus_hold_s} s for you at most). On board, Enter asks for the next stop. Taxis are T.` }));
        const rows = nextBuses(stop, Date.now()).map((b) => h("tr", {}, h("td", {}, h("b", { textContent: b.route })), h("td", { textContent: b.next.map((n) => `${n.wait < 1 ? "at the stop now" : `${Math.ceil(n.wait / 60)} min`} toward ${n.toward}`).join("; ") })));
        out.push(rows.length ? h("table", {}, ...rows) : h("p", { className: "note", textContent: "No route times here." }));
      } else if ((district.stops || []).length) {
        const near = [...district.stops].map((x) => ({ ...x, d: Math.hypot(x.x - me().x, x.z - me().z) })).sort((a, b) => a.d - b.d)[0];
        out.push(h("p", { className: "note", textContent: `The nearest bus stop is ${near.name}, ${Math.round(near.d)} m away (${near.routes.join(", ")}).` }));
      } else out.push(h("p", { className: "note", textContent: "No bus routes run through this district's streets." }));
      out.push(h("h4", { textContent: "A taxi" }));
      if (taxi.phase) out.push(h("p", { className: "note", textContent: taxi.phase === "coming" ? `On its way to you: ${Math.round(Math.max(0, taxi.route.length - taxi.d))} m off, then to ${taxi.dest.name}.` : `Waiting for you at the kerb, to take you to ${taxi.dest.name}: Enter to get in.` }),
        h("button", { textContent: "Cancel the taxi", onclick: () => { Object.assign(taxi, { phase: null, route: null, at: null }); drawSide(); } }));
      else {
        const fare = (x, z) => R.transit.taxi_flag + Math.round(R.transit.taxi_per_km * Math.hypot(x - me().x, z - me().z) * 1.3 / 1000);
        const dest = (name, x, z) => h("tr", {}, h("td", { textContent: name }), h("td", { textContent: `${(Math.hypot(x - me().x, z - me().z) / 1000).toFixed(1)} km · ≈${R.fmt(fare(x, z))}` }), h("td", {}, h("button", { className: "primary", textContent: "Call a taxi", onclick: () => callTaxi({ name, x, z }) })));
        const picks = [];
        if (p.home) picks.push(dest("Home", p.home.x, p.home.z));
        if (p.job) picks.push(dest(`Work (${p.job.place.name ? address(p.job.place.name) : p.job.title})`, p.job.place.x, p.job.place.z));
        if (p.delivery) picks.push(dest(`The parcel's address (${p.delivery.to.name || "a home"})`, p.delivery.to.x, p.delivery.to.z));
        if (p.errand) picks.push(dest(`The errand (${p.errand.to.name || "a home"})`, p.errand.to.x, p.errand.to.z));
        const query = side.query || "";
        const input = h("input", { type: "search", placeholder: "Where to? (a shop, an address)", value: query, style: "width:100%;margin:4px 0" });
        input.oninput = () => { side.query = input.value; const at = input.selectionStart; drawSide(); const again = side.el.querySelector("input[type=search]"); again?.focus(); again?.setSelectionRange(at, at); };
        if (query.length > 1) {
          const q = query.toLowerCase();
          const found = district.places.filter((x) => (x.name || "").toLowerCase().includes(q) || x.shops.some((k) => k.includes(q))).map((x) => ({ x, d: Math.hypot(x.x - me().x, x.z - me().z) })).filter((o) => o.d > 60).sort((a, b) => a.d - b.d).slice(0, 8);
          for (const { x } of found) picks.push(dest(`${address(x.name) || x.shops[0] || "A building"}${x.shops.length ? ` (${x.shops.slice(0, 2).join(", ")})` : ""}`, x.x, x.z));
        }
        out.push(h("p", { className: "note", textContent: `A yellow cab comes to the kerb where you stand: ${R.fmt(R.transit.taxi_flag)} and ${R.fmt(R.transit.taxi_per_km)} a km.` }), input, h("table", { className: "wares" }, ...picks));
      }
      side.el.replaceChildren(...out);
      return;
    }
    if (side.kind === "tasks") {
      const title = h("h3", {}, h("span", { textContent: "Task board" }), close);
      const t = p.task, g = objective();
      if (t || p.delivery || p.errand) {
        const out = [title, status];
        if (t || p.delivery) {
          const steps = t?.steps || [p.delivery.stage === "pickup" ? `Pick up the order at ${p.delivery.from.name} (G at its door)` : `Deliver to ${p.delivery.to.name || "the address"}`];
          const ticked = (i) => stepDone(p, i);
          const list = h("ol", { style: "margin:4px 0 8px 18px;padding:0" }, ...steps.map((st, i) => h("li", { textContent: `${st}${ticked(i) ? " ✓" : ""}`, style: ticked(i) ? "opacity:.6" : "" })));
          out.push(h("p", {}, h("b", { textContent: t?.title || "Delivery" }), ` — ${R.fmt(t?.pay ?? p.delivery?.pay ?? 0)} on finishing`), list,
            g ? h("p", { className: "note", textContent: `Next: ${g.label}${Number.isFinite(g.x) ? ` (${Math.round(Math.hypot(g.x - me().x, g.z - me().z))} m; the arrow at the top of the screen points there, and the light stands over it)` : ""}.` }) : "",
            h("div", {}, g && Number.isFinite(g.x) ? h("button", { textContent: "Call a taxi there", onclick: () => callTaxi({ name: g.label.split(" — ")[0], x: g.x, z: g.z }) }) : "",
              t ? act("Drop the task", () => send("cancel_task")) : act("Cancel the delivery", () => send("cancel_delivery"))));
        }
        if (p.errand) {
          const e = p.errand, d = Math.round(Math.hypot(me().x - e.to.x, me().z - e.to.z));
          out.push(h("p", {}, h("b", { textContent: `Errand for ${e.to.who || "a neighbour"}, ${e.to.name || "their home"}` }), ` — ${d} m`),
            h("p", { className: "note", textContent: `Buy: ${e.items.map((i) => `${R.items[i].name}${(p.inventory[i] || 0) > 0 ? " ✓" : ""}`).join(", ")}. Then go to the orange light: at their door you are asked to hand it over. Paid back what it cost, and ${R.fmt(e.fee)}.` }),
            h("div", {}, act("Give up the errand", () => send("cancel_errand"))));
        }
        side.el.replaceChildren(...out);
        return;
      }
      const offers = taskOffers();
      const rows = offers.map((o) => h("tr", {}, h("td", {}, h("b", { textContent: o.title }), h("div", { className: "note", textContent: o.steps.join(" → ") })),
        h("td", { textContent: `${R.fmt(o.pay)} · ${o.km.toFixed(1)} km` }),
        h("td", {}, h("button", { className: "primary", textContent: "Take it", onclick: () => say(send("take_task", { task: o }), (r) => `${r.task.title}: ${r.task.steps[0]}. Follow the arrow at the top.`) }))));
      const errands = errandOffers().map((o) => h("tr", {}, h("td", {}, h("b", { textContent: `Errand: ${o.to.who || "a neighbour"}, ${o.to.name || "nearby"}` }), h("div", { className: "note", textContent: `Buy ${o.items.map((i) => R.items[i].name.toLowerCase()).join(", ")} and bring it to their door` })),
        h("td", { textContent: `${R.fmt(o.fee)} + ${R.fmt(o.cost)} back · ${o.km.toFixed(1)} km` }),
        h("td", {}, h("button", { className: "primary", textContent: "Take it", onclick: () => say(send("take_errand", { to: o.to, items: o.items }), () => `Errand for ${o.to.who || "a neighbour"}: buy ${o.items.map((i) => R.items[i].name.toLowerCase()).join(", ")} and bring it to ${o.to.name || "their door"}.`) }))));
      side.el.replaceChildren(title, status, h("p", { className: "note", textContent: `Work posted round the city, new every ${R.tasks.refresh_minutes} minutes. One at a time: the arrow at the top of the screen and the light over the place show where to go. Delivery gigs are in any café's or shop's window (its SHOP panel); a job is in the City panel.` }),
        h("table", { className: "wares" }, ...rows), errands.length ? h("h4", { textContent: "Neighbours' errands (new every hour)" }) : "", errands.length ? h("table", { className: "wares" }, ...errands) : "");
      return;
    }
    if (side.kind === "online") {
      // Everything sold in the city, from anywhere, at twice the shop price; and the homes on the
      // market at their own price. Searchable, by category, in the order you choose.
      side.el.classList.add("wide");
      const title = h("h3", {}, h("span", { textContent: "Online store" }), close);
      const S = R.online_store, query = (side.query || "").toLowerCase().trim();
      side.cat ||= "all"; side.sort ||= "az";
      const [lon, lat] = ctx.toLonLat(me().x, me().z), chain = jurisdictionAt(R, lon, lat, district.county).chain;
      const input = h("input", { type: "search", placeholder: "Search everything: an axe, coffee, a 2 bd flat on Chestnut…", value: side.query || "", style: "width:100%;margin:4px 0" });
      input.oninput = () => { side.query = input.value; const at = input.selectionStart; drawSide(); const again = side.el.querySelector("input[type=search]"); again?.focus(); again?.setSelectionRange(at, at); };
      const wares = onlineWares().map((x) => ({ ...x, cat: categoryOf(x.it), price: Math.round(x.it.price * S.markup * 100) / 100 }));
      const here = me();
      const homes = listings().map((l) => ({ l, cat: "homes", name: `${l.beds ? `${l.beds} bd` : "Studio"} ${l.type === "single_family" ? "house" : "flat"}${l.label ? " " + l.label : ""} — ${address(l.address) || "a home"}`, price: l.price, d: Math.hypot(l.x - here.x, l.z - here.z) }));
      const match = (name, extra = "") => !query || name.toLowerCase().includes(query) || extra.toLowerCase().includes(query);
      const services = onlineServices(), jobs = onlineJobs();
      const cats = [["all", "All"], ...CATEGORIES, ["services", "Services"], ["jobs", "Jobs"], ["homes", "Real estate"]];
      const counts = Object.fromEntries(cats.map(([k]) => [k, 0]));
      for (const x of wares) if (match(x.it.name, x.from.join(" "))) { counts[x.cat] += 1; counts.all += 1; }
      for (const x of services) if (match(x.it.name, x.label)) { counts.services += 1; counts.all += 1; }
      for (const x of jobs) if (match(x.spec.title, x.label)) { counts.jobs += 1; counts.all += 1; }
      for (const x of homes) if (match(x.name, x.l.neighbourhood || "")) { counts.homes += 1; counts.all += 1; }
      const tabs = h("div", { className: "tabs" }, ...cats.map(([k, label]) => h("button", { textContent: `${label} (${counts[k]})`, "aria-pressed": String(side.cat === k), onclick: () => { side.cat = k; drawSide(); } })));
      const sorter = h("select", { title: "Order", onchange: (e) => { side.sort = e.target.value; drawSide(); } },
        ...[["az", "Name A–Z"], ["za", "Name Z–A"], ["lo", "Price: low to high"], ["hi", "Price: high to low"], ["kg", "Weight: light first"], ["near", "Homes: nearest first"]].map(([v, label]) => h("option", { value: v, textContent: label, selected: side.sort === v })));
      const order = (a, b, nameA, nameB) => side.sort === "za" ? nameB.localeCompare(nameA) : side.sort === "lo" ? a.price - b.price : side.sort === "hi" ? b.price - a.price
        : side.sort === "kg" ? (a.it?.kg ?? 1e9) - (b.it?.kg ?? 1e9) : side.sort === "near" ? (a.d ?? 1e9) - (b.d ?? 1e9) : nameA.localeCompare(nameB);
      const out = [title, status, input, h("div", { style: "display:flex;gap:6px;align-items:center" }, h("span", { className: "note", textContent: "Order:" }), sorter), tabs];
      if (side.cat === "services" || (side.cat === "all" && query)) {
        // Booked here at the place's own price, had when you get there (the to-do list shows the way).
        const list = services.filter((x) => match(x.it.name, x.label)).sort((a, b) => order(a, b, a.it.name, b.it.name));
        const rows = list.map(({ id, it, pl, d, label }) => h("tr", {}, h("td", {}, h("b", { textContent: it.name }), h("div", { className: "note", textContent: `${effectText(it)}${effectText(it) ? " · " : ""}${label} · ${Math.round(d)} m` })),
          h("td", { textContent: R.fmt(it.price) }),
          h("td", {}, h("button", { className: "primary", textContent: "Book", onclick: () => say(send("book_service", { item: id, place: placeArg(pl) }), () => `Booked: ${it.name} at ${label}, ${R.fmt(it.price)}. Go there to have it (it is on your to-do list).`).then(() => { todoKey = ""; drawTodo(); }) }))));
        const mine = (p.bookings || []).map((b) => h("div", { className: "note" }, `${R.items[b.item]?.name || b.item} at ${address(b.place.name) || "the place"} `));
        out.push(h("h4", { textContent: "Services — at their own price, booked here and had there" }), rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "No place near you gives that." }),
          ...(mine.length ? [h("h4", { textContent: "Your bookings" }), ...mine] : []));
      }
      if (side.cat === "jobs" || (side.cat === "all" && query)) {
        const list = jobs.filter((x) => match(x.spec.title, x.label)).sort((a, b) => side.sort === "hi" ? b.spec.pay - a.spec.pay : side.sort === "lo" ? a.spec.pay - b.spec.pay : a.d - b.d);
        const rows = list.map(({ role, spec, pl, d, label }) => h("tr", {}, h("td", {}, h("b", { textContent: spec.title }), h("div", { className: "note", textContent: `${label} · ${shiftText(spec)} · ${Math.round(d)} m` })),
          h("td", { textContent: `${R.fmt(spec.pay)}/h` }),
          h("td", {}, p.job?.place?.id === pl.id && p.job.role === role ? h("span", { className: "note", textContent: "Your job" })
            : h("button", { className: "primary", textContent: p.job ? "Switch" : "Apply", onclick: () => say(send("take_job", { role, place: placeArg(pl) }), () => `Hired: ${spec.title.toLowerCase()} at ${label}. Go there and clock in (it is on your to-do list).`).then(() => { todoKey = ""; drawTodo(); }) }))));
        out.push(h("h4", { textContent: "Jobs — hiring near you, at their pay" }),
          p.job ? h("p", { className: "note" }, `You work as ${p.job.title.toLowerCase()} at ${address(p.job.place.name) || "your workplace"} (${R.fmt(p.job.pay)}/h). `, act("Quit", () => send("quit_job"))) : "",
          rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "No openings near you." }));
      }
      if (side.cat !== "homes" && side.cat !== "services" && side.cat !== "jobs") {
        const list = wares.filter((x) => (side.cat === "all" || x.cat === side.cat) && match(x.it.name, x.from.join(" "))).sort((a, b) => order(a, b, a.it.name, b.it.name));
        const rows = list.slice(0, 120).map(({ id, it, from, price }) => {
          const tax = itemTax(R, chain, it, price, w.laws);
          return h("tr", {}, h("td", {}, h("b", { textContent: it.name }), h("div", { className: "note", textContent: `${effectText(it)}${effectText(it) ? " · " : ""}in shops ${R.fmt(it.price)} (${from.slice(0, 2).join(", ")})` })),
            h("td", { textContent: `${R.fmt(price)}${tax ? ` +${R.fmt(tax)}` : ""}` }),
            h("td", {}, h("button", { className: "primary", textContent: "Buy", onclick: () => say(send("buy_online", { item: id }), (r) => `Online store: ${it.name} ${R.fmt(r.price)}${r.tax ? ` + ${R.fmt(r.tax)} tax` : ""}, brought to you. It is in your inventory (I).`).then(() => syncSlots(true)) })));
        });
        if (side.cat === "all" || rows.length) out.push(h("h4", { textContent: `Goods — ${S.markup}× the shop price, brought to you` }), rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "Nothing like that." }),
          list.length > 120 ? h("p", { className: "note", textContent: `${list.length - 120} more: search to narrow.` }) : "");
      }
      if (side.cat === "all" || side.cat === "homes") {
        side.homeKind ||= "sale";
        const pick = homes.filter((x) => x.l.kind === side.homeKind && match(x.name, x.l.neighbourhood || "")).sort((a, b) => order(a, b, a.name, b.name));
        const rows = pick.slice(0, side.cat === "homes" ? 60 : 8).map(({ l, name, d }) => {
          const terms = l.kind === "sale" ? mortgageTerms(R, l.price) : null;
          return h("tr", {}, h("td", {}, h("b", { textContent: name }),
            h("div", { className: "note", textContent: `${sqft(l.sqft)} · ${l.neighbourhood} · ${R.fmt(R.money(l.psf))}/sq ft${l.kind === "rent" ? "/mo" : ""}${terms ? ` · ${R.fmt(terms.upfront)} down and closing, then ${R.fmt(terms.monthly)}/mo` : ""} · ${Math.round(d)} m` })),
            h("td", { textContent: l.kind === "sale" ? R.fmt(l.price) : `${R.fmt(l.price)}/mo` }),
            h("td", {}, l.kind === "sale" ? h("span", {}, h("button", { className: "primary", textContent: "Mortgage", onclick: () => say(send("buy_home", { listing: l, mortgage: true }), (r) => `Bought for ${R.fmt(r.price)}: ${R.fmt(r.terms.monthly)} a month on the mortgage. It is your home now.`) }),
              h("button", { textContent: "Outright", onclick: () => say(send("buy_home", { listing: l, mortgage: false }), (r) => `Bought outright for ${R.fmt(r.price)}. It is your home now.`) }))
              : h("button", { className: "primary", textContent: "Rent", onclick: () => say(send("rent_home", { listing: l }), (r) => `Rented at ${R.fmt(r.rent)} a month (a ${R.fmt(r.deposit)} deposit). It is your home now.`) })));
        });
        const mine = [...w.registry.owned(p.account, "home")].map((a) => h("div", {}, `${address(a.attrs.address) || "Your home"}${a.attrs.label ? " " + a.attrs.label : ""} `, act("Sell", () => send("sell_home", { home: a.id }))));
        out.push(h("h4", { textContent: "Real estate — at the market's price, not marked up" }),
          h("div", { className: "tabs" }, ...[["sale", "For sale"], ["rent", "To rent"]].map(([k, label]) => h("button", { textContent: label, "aria-pressed": String(side.homeKind === k), onclick: () => { side.homeKind = k; drawSide(); } }))),
          rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "Nothing of that kind listed this week." }),
          side.cat === "all" && pick.length > 8 ? h("button", { textContent: `All ${pick.length} homes`, onclick: () => { side.cat = "homes"; drawSide(); } }) : "",
          ...(mine.length || p.lease ? [h("h4", { textContent: "Yours" }), ...mine, p.lease ? h("div", {}, `Renting at ${R.fmt(p.lease.rent)}/mo `, act("Give notice and move out", () => send("end_lease"))) : ""] : []));
      }
      side.el.replaceChildren(...out);
      return;
    }
    // The controls.
    const keys = [["Arrows", "walk: Up goes the way you face, Left / Right turn you as you go (together, a curve; let go and you walk on straight), Down turns you round; at the wheel, drive"], ["Shift (hold)", "sprint, while stamina lasts"], ["Space", "jump: as high as your legs push against your weight and what you carry"],
      ["1 – 8", "choose from the bar at the bottom: what is chosen is in your hand (an empty slot is an empty hand)"], ["I", "the inventory: the grid and the bar; click a thing, then a slot, to move it"],
      ["U, or a right click", "use what is in your hand: eat, drink, take medicine, wear or take off"], ["X, or a click", "swing what is in your hand (a punch, empty-handed) at what is in front: a thing, a tree, a person"],
      ["Q", "throw what is in your hand, the way you face: heavier goes slower; glass breaks, drinks spill"], ["G", "pick up the nearest thing on the ground (yellow ring) you can lift: a step over to it and down for it"],
      ["Enter", "in and out, whichever is nearest: your car (out of it, parking where you stop; or ride with a party member), your taxi pulled up beside you (in it: out early, and pay), the bus standing at the stop (aboard: ask for the next stop), the shop whose door you are at (inside, click its blue SHOP panel by the door; at the door, back out), your own garage door up or down; elsewhere, a building's door"],
      ["V", "on shift: do the task in front of you (the orange ring)"], ["Z", "at a bed: lie down (in your own, sleep); again, get up"],
      ["J", "the task board: courier work, flyers, dog walks, bus-stop counts, mystery shopping, the Presidio's trees, the Marina walk, neighbours' errands (the top three are in Tasks, at the top left)"],
      ["Top bar", "Inventory, the Task board, the Shop (everything, from anywhere, at twice the shop price; real estate at its price), Taxi (call one to where you stand) and these Controls; your money, health, stamina and strength at the top right (a click opens your wallet)"],
      ["H or ?", "these controls"], ["F", "first person"], ["S", "what is under the pointer"], ["PageUp / PageDown", "the level above or below where you stand"]];
    const asked = "Asked as a Yes / No where it applies: clocking in at your workplace (and out when you leave), handing over a parcel at its address, and an errand's shopping at the neighbour's door. Answer No and it stays on the buttons along the bottom while it applies. A window closes with its × or its key again.";
    const bars = [["Health", "wears slowly; quickly with no stamina left. Medicine (pharmacy), a doctor's visit (clinic), a night's sleep. At 0 you faint, wake at home, and pay the ambulance."],
      ["Stamina", "runs down through the day, faster at work and sprinting; comes back at night, fastest asleep at home. Food and drink at cafés, restaurants, bars and grocers give it back. Low, you are slowed."],
      ["Strength", "fades a little each day. Workouts at a gym build it; walking, a little. It sets what you can carry."]];
    side.el.replaceChildren(h("h3", {}, h("span", { textContent: "Controls" }), close), h("table", {}, ...keys.map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", { textContent: k })), h("td", { textContent: v })))),
      h("h4", { textContent: "The bars" }), ...bars.map(([k, v]) => h("p", { className: "note" }, h("b", { textContent: `${k}: ` }), v)),
      h("p", { className: "note", textContent: asked },),
      h("p", { className: "note", textContent: "Every action is on the buttons along the bottom too, for touch screens. The City panel has your money, job, car, bills, taxes and the party's measures. Explore mode (the switch at the top left) has the map's keys: E the free view, R back to where you are, a click to go there, the pins; Space jumps there too, and Enter opens your own garage." }));
  }
  //: You: a window over most of the screen, opened from your card at the top right -- your
  //: picture, your body, your bank account, what you owe, what you have done lately, what you
  //: own and what you are worth; and under them the city's other pages (the place you stand at,
  //: your car, homes, bills, taxes, laws, people). It was a panel in the map's controls.
  function openPanel(force = false) {
    if (panel && force !== true) { panel.remove(); panel = null; return; }
    if (panel) { refresh(); return; }
    closeSide();
    panel = h("section", { id: "city", className: "pop" });
    panel.setAttribute("aria-label", "You"); panel.setAttribute("role", "dialog");
    doc.body.append(panel);
    refresh();
  }
  function closePanel() { if (panel) { panel.remove(); panel = null; } }
  //: Money put in your device account on the backend (supabase/kerbside_city_grants.sql): into
  //: your wallet once you are in the city and this browser holds the books (alone, or the
  //: party's host), each grant once (world.mjs cmd_account_grant), then marked claimed there.
  let grantsTaken = false;
  async function takeAccountGrants() {
    if (grantsTaken || !world || !world.players.has(myId) || !ctx.account) return;
    grantsTaken = true;
    const lib = await Promise.resolve(ctx.account()).catch(() => null);
    const grants = (await lib?.cityGrants?.().catch(() => [])) || [];
    for (const g of grants) {
      const r = await send("account_grant", { grant: g.id, amount: g.amount });
      if (!r.ok) continue;
      save();
      if (!r.already) notify(`${R.fmt(g.amount)} from the backend is in your wallet${g.note ? ` (${g.note})` : ""}.`);
      lib.claimCityGrant?.(g.id);
    }
  }
  function refresh() {
    takeAccountGrants();
    hud();
    drawSide();
    if (!panel) return;
    const w = view, p = w?.players.get(myId);
    const close = h("button", { textContent: "×", title: "Close (Esc)", onclick: () => openPanel() });
    const head = h("h3", {}, h("span", { textContent: "You" }), close);
    if (!w) { panel.replaceChildren(head, h("p", { className: "note", textContent: "Waiting for the party's host to share the city…" })); return; }
    if (!p) {
      // Joined in the background (ensureJoined): only a moment before the district is there.
      panel.replaceChildren(head, h("p", { className: "note", textContent: `Setting up your place in the city: ${R.fmt(R.start.balance)} in Credits (a placeholder currency at par with the dollar), a rented room in the building beside you with its first week free, and no car.` }));
      ensureJoined();
      return;
    }
    const tabs = h("div", { className: "tabs" }, ...["you", "here", "car", "homes", "bills", "taxes", "laws", "people"].map((id) =>
      h("button", { textContent: id[0].toUpperCase() + id.slice(1), "aria-pressed": String(tab === id), onclick: () => { tab = id; refresh(); } })));
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent.toLowerCase() === tab)));
    panel.replaceChildren(...youAtAGlance(w, p, close), h("h4", { textContent: "More" }), tabs, ...TABS[tab](w, p));
  }
  //: The top of the window: you at a glance.
  function youAtAGlance(w, p, close) {
    const st = w.cmd_status.call(w, myId), worth = wealthOf(R, st), img = portrait();
    const money = (v) => R.fmt(v);
    const bar = (label, value, colour) => h("div", { className: "bar", innerHTML: `<span>${label}</span><i style="--v:${Math.max(0, Math.min(100, value)).toFixed(1)}%;--c:${colour}"></i><b>${Math.round(value)}</b>` });
    const tile = (title, ...kids) => h("section", { className: "tile" }, h("h4", { textContent: title }), ...kids);
    const me = h("div", { className: "me" }, h("div", { className: "face", style: img ? `background-image:url(${img})` : "" }),
      h("div", {}, h("h2", { textContent: st.name || p.name || "You" }),
        h("div", { className: "worth" }, h("span", { className: worth.net < 0 ? "neg" : "", textContent: money(worth.net) }), h("small", { textContent: "net worth: what you have and own, less what you owe" }))),
      close);
    const stats = tile("Stats", bar("Health", st.vitals.health, "#e2483d"), bar("Stamina", st.vitals.stamina, "#e8a33b"), bar("Strength", st.vitals.strength, "#3c8fd6"),
      h("table", {}, row("Carrying", `${st.carry.kg} of ${st.carry.capacity} kg`), row("Job", st.job ? `${st.job.title}, ${money(st.job.pay)}/h` : "none"),
        row("Home", st.home ? (st.home.label || st.home.address || district.placeById?.get(st.home.building)?.name || `building ${st.home.building}`) : "none"), row("Where", st.where)));
    const bank = tile("Bank account", h("table", {}, row("Balance", money(worth.cash)), row("FasTrak prepaid", st.fastrak ? money(worth.fastrak) : "no tag"),
      row("Earned this year", money(st.ytd.wages)), row("Tax held back", money(st.ytd.withheld))));
    const debts = tile("Debts", worth.debts.length ? h("table", {}, ...worth.debts.slice(0, 8).map((d) => row(d.label, money(d.value))),
      h("tr", { className: "sum" }, h("td", { textContent: "Owed in all" }), h("td", { className: "neg", textContent: money(worth.owing) })))
      : h("p", { className: "note", textContent: "You owe nothing." }), worth.debts.length ? h("button", { textContent: "See the bills", onclick: () => { tab = "bills"; refresh(); } }) : null);
    const recent = w.ledger.journal.filter((e) => e.lines.some(([a]) => a === p.account)).slice(-10).reverse();
    const history = tile("Recent history", recent.length ? h("table", {}, ...recent.map((e) => {
      const amount = e.lines.find(([a]) => a === p.account)[1];
      return h("tr", {}, h("td", { textContent: `${String(e.kind).replace(/_/g, " ")}${e.memo ? ": " + e.memo : ""}` }), h("td", { className: amount < 0 ? "neg" : "", textContent: money(amount) }));
    })) : h("p", { className: "note", textContent: "Nothing yet: what you earn, buy and pay shows here." }));
    const assets = tile("Significant assets", worth.assets.length ? h("table", {}, ...worth.assets.slice(0, 8).map((a) => row(a.label, money(a.value))),
      h("tr", { className: "sum" }, h("td", { textContent: "Owned in all" }), h("td", { textContent: money(worth.owned) })))
      : h("p", { className: "note", textContent: "No car, home or building of your own yet." }));
    const net = tile("Net worth", h("table", {}, row("Money", money(worth.cash + worth.fastrak)), row("What you own", money(worth.owned)),
      h("tr", {}, h("td", { textContent: "What you owe" }), h("td", { className: worth.owing ? "neg" : "", textContent: worth.owing ? `−${money(worth.owing)}` : money(0) })),
      h("tr", { className: "sum" }, h("td", { textContent: "Net worth" }), h("td", { className: worth.net < 0 ? "neg" : "", textContent: money(worth.net) }))));
    return [me, h("div", { className: "tiles" }, stats, bank, debts, assets, net, history)];
  }
  const TABS = {
    you(w, p) {
      const st = w.cmd_status.call(w, myId);
      const out = [h("table", {}, row("Balance", R.fmt(st.balance)), row("Owed", R.fmt(st.owed)), row("Where", st.where),
        row("Home", st.home ? `a room at ${district.placeById?.get(st.home.building)?.name || "building " + st.home.building}, paid to ${new Date(st.home.paid_until).toLocaleDateString()}` : "none"),
        row("Job", st.job ? `${st.job.title}, ${R.fmt(st.job.pay)}/h` : "none"), row("At work", st.clocked ? `since ${new Date(st.clocked.since).toLocaleTimeString()}` : "no"),
        row("Earned this year", R.fmt(st.ytd.wages)), row("Tax held back", R.fmt(st.ytd.withheld)), row("FasTrak", st.fastrak ? `${st.fastrak.tag}, ${R.fmt(st.fastrak.balance)}, Flex ${st.fastrak.flex}` : "none"),
        row("Party", party.session ? `room ${party.session.room}, ${world ? "you hold the books" : "the host holds the books"}` : "playing alone (Play together to share)"))];
      if (st.job) out.push(h("div", {}, st.clocked ? act("Clock out", () => send("clock_out")) : act("Clock in", () => send("clock_in"), true), act("Quit the job", () => send("quit_job"))));
      out.push(h("h4", { textContent: "Your body" }), h("table", {}, row("Health", `${Math.round(st.vitals.health)} of 100`), row("Stamina", `${Math.round(st.vitals.stamina)} of 100`), row("Strength", `${Math.round(st.vitals.strength)} of 100`),
        row("Carrying", `${st.carry.kg} of ${st.carry.capacity} kg`)));
      const hurt = (p.injuries || []).slice(-6).reverse();
      out.push(h("h4", { textContent: "Injuries" }), hurt.length ? h("table", {}, ...hurt.map((x) => row(x.type, `${x.cause}, ${new Date(x.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`)))
        : h("p", { className: "note", textContent: "None. (What injuries do to you comes in a later round: for now they are recorded.)" }));
      const goods = Object.entries(st.inventory || {});
      if (goods.length) out.push(h("p", { className: "note", textContent: goods.map(([k, v]) => `${v} ${R.items[k]?.name.toLowerCase() || k}`).join(", ") }), h("button", { textContent: "Open your bag (I)", onclick: () => openSide("bag") }));
      const recent = w.ledger.journal.filter((e) => e.lines.some(([a]) => a === p.account)).slice(-8).reverse();
      if (recent.length) out.push(h("h4", { textContent: "Recent" }), h("table", {}, ...recent.map((e) => row(`${e.kind}${e.memo ? ": " + e.memo : ""}`, R.fmt(e.lines.find(([a]) => a === p.account)[1])))));
      return out;
    },
    here(w, p) {
      const place = nearestPlace(() => true, 45);
      if (!place) return [h("p", { className: "note", textContent: "Walk up to a building to see what it does: its shops to buy from, its jobs, and whether its owner would sell." })];
      const out = [h("p", {}, h("b", { textContent: place.name || `Building ${place.id}` }), ` — ${place.use}${place.shops.length ? ", " + place.shops.join(", ") : ""}, ${Math.round(place.distance)} m`)];
      const [lon, lat] = ctx.toLonLat(place.x, place.z);
      const here = jurisdictionAt(R, lon, lat, district.county);
      const rate = salesRate(R, here.chain, w.laws);
      const stores = storesAt(R, place.keys);
      if (stores.length) out.push(h("h4", { textContent: `Shops (sales tax ${(rate * 100).toFixed(3)}%)` }), h("p", { className: "note", textContent: stores.map((st) => `${st.name}: ${st.items.map((id) => R.items[id].name.toLowerCase()).join(", ")}`).join(". ") }),
        h("button", { className: "primary", textContent: "Open the shop", onclick: () => openStore(place) }));
      const jobs = R.jobs.player_jobs.filter((r) => R.jobs.roles[r].at.some((k) => place.keys.includes(k)));
      if (jobs.length) out.push(h("h4", { textContent: "Hiring" }), h("p", { className: "note", textContent: jobs.map((r) => `${R.jobs.roles[r].title} ${R.fmt(R.jobs.roles[r].pay)}/h`).join(", ") }),
        act("Apply in the Shop's Jobs", () => { openSide("online"); side.cat = "jobs"; drawSide(); }));
      const staff = district.people.filter((x) => x.work === place.id).slice(0, 8);
      if (staff.length) out.push(h("h4", { textContent: "Works here" }), h("p", { className: "note", textContent: staff.map((x) => `${x.name} (${x.title}, ${R.jobs.roles[x.role].shifts.map(([a, b]) => `${a % 24}–${b % 24}`)[x.shift % Math.max(1, R.jobs.roles[x.role].shifts.length)] || "days"})`).join("; ") }));
      const record = w.registry.assets.get(`building:${place.id}`);
      const appraisal = w.appraise({ ...place, lon, lat, county: district.county });
      const owner = record?.owner === p.account ? "you" : record?.owner?.startsWith("player:") ? w.players.get(record.owner.slice(7))?.name || "another player" : "an NPC landlord";
      out.push(h("h4", { textContent: "The building" }), h("table", {}, row("Owner", owner), row("Value", `${R.fmt(appraisal.value)} (${appraisal.floor_m2} m² of floor)`),
        row("Property tax a year", R.fmt(propertyTax(R, here.chain, appraisal.value).total)),
        row("Transfer tax on a sale", R.fmt(transferTotal(here, appraisal.value)))));
      if (!record || record.owner === "business:landlords") out.push(act(`Buy it for ${R.fmt(appraisal.value)}`, () => send("buy_building", { building: { ...place, lon, lat, county: district.county } })));
      else if (record.owner === p.account) out.push(act("Sell it back", () => send("sell_building", { building: { ...place, lon, lat, county: district.county } })));
      return out;
    },
    car(w, p) {
      const mine = w.registry.owned(p.account, "vehicle"), held = w.registry.held(p.account).filter((a) => a.kind === "vehicle" && a.owner !== p.account);
      const out = [h("p", { className: "note", textContent: "Enter beside your car gets in and out; arrows drive. Tolls at the bridges' gantries and express lanes charge as you drive. Speeding and a carpool lane short of riders are fined only when seen: by a speed camera with you in its view, or a patrol car near." })];
      for (const a of [...mine, ...held]) {
        const spec = R.vehicles.models[a.attrs.model];
        const spot = p.parked?.[a.id];
        out.push(h("div", {}, h("b", { textContent: `${spec.name} ${a.attrs.plate}` }), ` — ${a.custody}${a.owner !== p.account ? " (borrowed)" : ""}, ${Math.round(a.attrs.odometer_km || 0)} km, ${Math.round(a.attrs.fuel_l ?? 0)} L`),
          h("div", {}, spot?.metered ? act("Pay meter 1 h", () => send("pay_meter", { vehicle: a.id, hours: 1 })) : null,
            nearestPlace((x) => x.use === "gas_station", 60) ? act("Fill up", () => send("refuel", { vehicle: a.id, litres: 50 })) : null,
            ...(party.session?.players() || []).map((peer) => { const pid = party.ids.get(peer.id); return pid && a.owner === p.account ? h("span", {}, act(`Lend to ${peer.name}`, () => send("offer", { asset: a.id, to: pid, kind: "loan", hours: 2 })), act(`Sell to ${peer.name}`, () => { const price = Number(prompt(`Price in Credits for ${peer.name}?`, "10000")); return price > 0 ? send("offer", { asset: a.id, to: pid, price: R.money(price) }) : null; })) : null; }),
            a.owner !== p.account ? act("Give it back", () => send("return", { asset: a.id })) : null));
      }
      const offers = [...w.offers.values()].filter((o) => o.to === myId);
      if (offers.length) out.push(h("h4", { textContent: "Offers to you" }), ...offers.map((o) => h("div", {}, `${w.players.get(o.from)?.name}: ${o.kind} of ${o.asset}${o.price ? " for " + R.fmt(o.price) : ""} `, act("Accept", () => send("accept", { offer: o.id }), true), act("Decline", () => send("decline", { offer: o.id })))));
      const [lon, lat] = ctx.toLonLat(me().x, me().z);
      const chain = jurisdictionAt(R, lon, lat, district.county).chain;
      out.push(h("h4", { textContent: "The dealership" }), h("p", { className: "note", textContent: `Delivered to the street beside you. Sales tax, registration, the vehicle license fee (0.65%) and the CHP and transportation fees on top. Fuel here: ${R.fmt(fuelPrice(R, chain, w.laws).per_litre)} a litre.` }),
        h("div", {}, ...Object.entries(R.vehicles.models).filter(([k]) => !["bus", "patrol"].includes(k)).map(([k, v]) => act(`${v.name} ${R.fmt(v.price)}`, () => send("buy_vehicle", { model: k }))),
          act("Used hatchback (5 yrs)", () => send("buy_vehicle", { model: "economy", used_years: 5 }))));
      out.push(h("h4", { textContent: "FasTrak" }), p.fastrak ? h("div", {}, `Tag ${p.fastrak.tag}, ${R.fmt(p.fastrak.balance)} prepaid. Flex: `, ...[1, 2, 3].map((n) => act(`${n}${n === 3 ? "+" : ""}`, () => send("set_flex", { occupants: n }))))
        : act(`Get a FasTrak tag (${R.fmt(R.tolls.fastrak.deposit)} prepaid)`, () => send("get_fastrak")));
      return out;
    },
    homes(w, p) {
      const all = listings();
      return [h("p", { className: "note", textContent: `${all.filter((l) => l.kind === "sale").length} homes for sale and ${all.filter((l) => l.kind === "rent").length} to rent in this district this week.` }),
        h("button", { className: "primary", textContent: "Browse the listings (O, Real estate)", onclick: () => { openSide("online"); if (side) { side.cat = "homes"; drawSide(); } } })];
    },
    bills(w, p) {
      const all = [...w.billing.bills.values()].filter((b) => b.payer === p.account).slice(-20).reverse();
      if (!all.length) return [h("p", { className: "note", textContent: "No bills. Tolls without FasTrak, lane violations, speed camera and parking notices, rent and property tax come here, each with its due date; unpaid, a notice adds its penalty." })];
      return all.map((b) => h("div", { style: "border-top:1px solid rgba(128,128,128,.25);padding:4px 0" },
        h("b", { textContent: `${b.memo || b.kind}` }), h("div", { className: "note", textContent: `${b.kind.replace(/_/g, " ")} · ${R.fmt(b.owed)}${b.stage ? ` (notice ${b.stage + 1})` : ""} · ${b.status === "open" ? "due " + new Date(b.due).toLocaleDateString() : b.status}${b.hearing ? " · hearing " + new Date(b.hearing).toLocaleDateString() : ""}${b.reason ? " · " + b.reason : ""}` }),
        b.status === "open" ? h("div", {}, act("Pay", () => send("pay_bill", { bill: b.id }), true), CITATIONS.includes(b.kind) && !b.hearing ? act("Contest", () => send("contest", { bill: b.id })) : null) : null));
    },
    taxes(w, p) {
      const s = w.taxSummary(myId);
      const [lon, lat] = ctx.toLonLat(me().x, me().z);
      const here = jurisdictionAt(R, lon, lat, district.county);
      const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 3 : 2)}%`;
      return [h("table", {}, row(`Wages ${s.year}`, R.fmt(s.wages)), row("Federal income tax (owed on the year)", R.fmt(s.income.federal)), row("California income tax", R.fmt(s.income.state)),
        row("Social Security", R.fmt(s.payroll.social)), row("Medicare", R.fmt(s.payroll.medicare)), row("State disability insurance", R.fmt(s.payroll.disability)), row("Held back so far", R.fmt(s.withheld))),
      h("h4", { textContent: `Rates where you stand: ${here.name}` }),
      h("table", {}, row("Sales tax", pct(salesRate(R, here.chain, w.laws))), row("Property tax (on assessed value)", pct(R.taxes.property.total_rate[here.city] ?? R.taxes.property.total_rate[here.county] ?? R.taxes.property.base_rate)),
        row("Transfer tax on a 1,500,000 sale", R.fmt(transferTotal(here, R.money(1_500_000)))), row("Parking tax (off-street)", pct(R.taxes.local.parking_tax[here.city] || 0)), row("Hotel tax", pct(R.taxes.local.hotel_tax[here.city] || 0)),
        row("Fuel, a litre (of which excise)", `${R.fmt(fuelPrice(R, here.chain, w.laws).per_litre)} (${R.fmt(fuelPrice(R, here.chain, w.laws).excise_per_litre)})`)),
      h("h4", { textContent: "Brackets (single filer)" }), h("p", { className: "note", textContent: `Federal: ${R.taxes.income.federal.brackets.map(([a, r]) => `${Math.round(r * 100)}% from ${R.fmt(a)}`).join(", ")}.` }),
      h("p", { className: "note", textContent: `California: ${R.taxes.income.state.brackets.map(([a, r]) => `${(r * 100).toFixed(1)}% from ${R.fmt(a)}`).join(", ")}.` })];
    },
    laws(w, p) {
      const out = [h("p", { className: "note", textContent: R.initiatives.basis })];
      const open = [...w.measures.values()].filter((m) => m.status === "open");
      for (const m of open) out.push(h("div", {}, h("b", { textContent: `${m.label}: ${m.value}` }), ` — ${Object.values(m.votes).filter(Boolean).length} for, ${Object.values(m.votes).filter((v) => !v).length} against, closes ${new Date(m.closes).toLocaleTimeString()} `,
        act("For", () => send("vote", { measure: m.id, yes: true }), true), act("Against", () => send("vote", { measure: m.id, yes: false }))));
      const passed = Object.entries(w.laws);
      out.push(h("h4", { textContent: "In force by the party's vote" }), h("p", { className: "note", textContent: passed.length ? passed.map(([k, v]) => `${R.initiatives.adjustable[k]?.label}: ${v}`).join("; ") : "Nothing yet: the region's own laws." }));
      out.push(h("h4", { textContent: "Put a measure to the party" }));
      for (const [key, spec] of Object.entries(R.initiatives.adjustable)) {
        const input = h("input", { type: "number", min: spec.min, max: spec.max, step: spec.step, value: w.laws[key] ?? spec.min, style: "width:80px" });
        out.push(h("div", {}, `${spec.label} `, input, act("Propose", () => send("propose", { key, value: Number(input.value) }))));
      }
      return out;
    },
    people() {
      const list = visible.people.slice(0, 30);
      const roles = populationByRole(district.people);
      return [h("p", { className: "note", textContent: `${district.people.length} people live in this district. Out of doors near you: ${visible.people.length} on foot, ${visible.vehicles.length} vehicles.` }),
        h("table", {}, ...list.map((x) => row(`${x.person.name} — ${x.person.title}`, x.activity || ""))),
        h("h4", { textContent: "Who lives here" }), h("p", { className: "note", textContent: Object.entries(roles).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${R.jobs.roles[r].title} ${n}`).join(", ") })];
    },
  };
  const transferTotal = (here, price) => transferTax(R, here.chain, price).total;
  ctx.button?.addEventListener("click", () => openPanel());
  // Escape closes the window over the screen.
  globalThis.addEventListener?.("keydown", (e) => { if (e.key === "Escape" && panel) { panel.remove(); panel = null; } });
  refresh();

  // The multiplayer session's hooks: what this walker's car is, and drawing the others'.
  return {
    //: How the crowd and the traffic were drawn last frame: so many at each tier (full, moderate,
    //: low), so many only tracked, and the detail field's stretch ahead.
    detail: () => ({ people: drawnTiers.people.slice(), cars: drawnTiers.cars.slice(), tracked: { ...drawnTiers.tracked },
      stretch: detailNow?.stretch ?? 1, heading: detailNow?.heading ?? [0, 0], reach: scanReach }),
    rules: R, tick, drive, get driving() { return car.active; }, get riding() { return car.riding || transit.ride; }, get inside() { return Boolean(shop.place); }, walkInside, enterBuilding, autoWalk: (dt) => stepReach(dt), cancelAutoWalk: () => { reach.t = null; }, openPanel, closePanel, joinParty, leaveParty,
    enterShop, leaveShop, callTaxi, objects: () => ctx.objects?.(), taskKey, strikeKey, listings: () => listings(), routeBuses: () => routeBuses, taxi: () => ({ ...taxi, route: undefined }), stops: () => district.stops || [],
    walkFactor: walkFactorNow, walked, actions: () => actionsHere().map((a) => ({ id: a.id, label: a.label, key: a.key })), openStore, openSide, pickUp, board, things: () => thingsNear(me().x, me().z, 60),
    enterKey, taxiKey, garageHere: myGarageHere, garages: () => ctx.garages, garageRemote: () => remote.door, car: () => car, myBuildings, busLag, click, useSelected, swingKey, throwKey, jumpKey, selectSlot, slots: () => ({ slots: slots.slice(), chosen }), pose: () => ({ kind: pose.kind, air: air.y }), prompt: () => promptShown, side: () => side?.kind || null, shopPanel: () => shop.room?.userData.panel || null,
    carState() {
      if (car.active) return { model: car.model, colour: R.vehicles.models[car.model].colour, driving: true, riding: null, plate: car.plate, city: myId, seats: R.vehicles.models[car.model].seats };
      if (car.riding) return { model: "economy", colour: "#888888", driving: false, riding: car.riding, plate: "", city: myId, seats: 5 };
      return null;
    },
    placePeerCar, carChanged: () => {}, world: () => world, view: () => view, district, visible: () => visible, me: myId,
    scan: () => scan, objective: () => objective(), taskOffers: () => taskOffers(), drawnCars: () => drawnCars, walkerBlocked, walkerSlide, carsAt,
    water: (cls, at) => waterProperties(R, cls, at), send,
  };
}
