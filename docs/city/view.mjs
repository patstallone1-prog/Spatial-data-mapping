// The living city in the viewer: the district's people on its pavements and its traffic on its
// streets, your wallet and your day, a car to drive (or ride in with your party), the bridge
// tolls, carpool and express lanes and speed cameras that charge it, the bills that follow, and
// the city's own measures -- all on one set of books held by the city's server (server/city):
// this page sends what you do and shows what the server says came of it.
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
  swimMode, transferTax, walkFactor, waterProperties,
} from "./core.mjs";
import { crashScenes } from "./crash-scene.mjs";
import { CRASH, crumple, scuff, damageKey, damageLevel, damagePace, impactOn, impactZone, personImpact, personPose } from "./crash.mjs";
import { clockOf, fleetTime, clockTime, clockHeld, holdClock, releaseClock, clockHoldState, restoreClockHold, heldOffset } from "./clock.mjs";
import { BIKE_LANE, CLOTHES, COUNTER_ROLES, Crowd, DRIVE_LANE, LANE, SPEED_MS, Streets, alongRoute, counterLine, distToSegment, generatePopulation, hash32, pavementRoute, placeFromBuilding, populationByRole, rng, saysStreet, shortStreet } from "./people.mjs";
import { homeListings, mortgageTerms } from "./market.mjs";
import { BOUNDARY_MESSAGE, arrivalsAt, boundaryStop, buildLines, busesAt, stopsOf } from "./transit.mjs";
import { CITATIONS, CityWorld } from "./world.mjs";
import { cityClient, cityServerUrl } from "./server-client.mjs";
import { cityLive, syncPlan } from "./live.mjs";
import { witnessOf } from "./enforcement.mjs";
import { createPolice } from "./police.mjs";
import { createCourtSession } from "./court-session.mjs";
import { clipFor, makeBlend, newPose, stepBlend } from "./clips.mjs";
import { REACT, drivingStyle, reactionFor, reactionTo, stepClear, temperamentOf, wetStyle } from "./temperament.mjs";
import { BIKE, BIKE_PAINT_MIX, BUS_LIVERY, PATROL_LIVERY, BUS_SIGN, FLEET_FOR, KENNEY_DEBRIS, KENNEY_FOR, RIDER, VEHICLE_DIMS, bikeParts, crankTurn, drawBusSign, fleetFile, fleetMaterial, fleetParts, kenneyGeometry, kenneyMaterial, kenneyVariant, importedKitCar, paintOf, pedalAt, riderPose, vehicleLampAnchors, wheelTurn, bodyOf, bodyFile, bodyDims, carSurface, CAR_MODELS } from "./vehicles.mjs";
import { BIKE_DIMS, BIKE_TOP_MS, City, Drivers, PARK_LANE, Roster, TRAFFIC, harmNow, junctionAt, signalAt } from "./fleet.mjs";
import { jumpOf, liftKg, physOf, sizeOf, swingOf, throwOf, weightClass } from "./handling.mjs";
import { createClimbPlay } from "./climb-play.mjs";
import { createEatPlay } from "./eat-play.mjs";
import { TOOLS as TOOL_VERBS, affordances, hintChips, steady } from "./affordances.mjs";
import { createMechanics } from "./mechanics.mjs";
import { IMPLEMENT, strikePreview, substanceOf } from "./strike-preview.mjs";
import { blowOn, victimOf } from "./hit-reaction.mjs";
import { WORK, createWork } from "./mechanics-work.mjs";
import { createCollisions } from "./mechanics-collide.mjs";
import { madeFrom } from "./plated.mjs";
import { JUMP, PUNCH, SWING, jumpAir, jumpCrouch, jumpLand, punchPose, swingPose } from "./body-moves.mjs";
import { DRIVE, carState, lightAhead, parkPath, startLaneChange, startPark, startStop, stepCar } from "./car-control.mjs";
import { carPoints, entryPose, entrySpot } from "./car-entry.mjs";
import { DETAIL_HYSTERESIS, DETAIL_RINGS, FULL, LOW, MODERATE, TRACKED, byTier, detailField, routeSamples, velocityTracker, LOCK, lockedForm, wheelStep, withinView } from "./detail.mjs";
import { CLOSE, byWall, closeLock, feetTracker } from "./close-lock.mjs";
import { BAR, GRID, arrange, barSlotOf, slotCount, swap } from "./inventory.mjs";
import { enterprisePanels } from "./enterprise-panels.mjs";
import { FINANCE_CSS, financePanels } from "./finance-panels.mjs";
import { THEME_CSS } from "./theme.mjs";
import { PROFILE_CSS, profilePanel } from "./profile-panel.mjs";
import { ANIMALS_CSS, animalsView } from "./animals-view.mjs";
import { messagesPanel } from "./messages-panel.mjs";
import { commercePanels } from "./commerce-panels.mjs";
import { restaurantService, planRestaurant, canWalkRestaurant } from "./restaurant-room.mjs";
import { restaurantScene } from "./restaurant-scene.mjs";
import { buildWindowDisplay, tradeSignage, windowDisplayOf } from "./storefronts.mjs";
import { canWalkStore, planStore, storeFixtures } from "./store-room.mjs";
import { lanePoints } from "./grocery-room.mjs";
import { itemSize, sectionsFor, stockShelves } from "./shelf-stock.mjs";
import { aisleMap } from "./aisles.mjs";
import { workshopPanel } from "./workshop-panel.mjs";
import { isWorkshop, visitingCars } from "./workshop.mjs";
import { kitchenPanel } from "./kitchen-panel.mjs";
import { recipeOf } from "./kitchen.mjs";
import { clerkLine, clerkNear, lineParts } from "./clerk.mjs";
import { shopWindow } from "./shop-window.mjs";
import { shopFloor } from "./shop-floor.mjs";
import { favourRun } from "./favour-run.mjs";
import { onTheirWay } from "./npc-favours.mjs";
import { doorHolds, swerveAhead } from "./npc-steer.mjs";
import { figurePlan, figureReach, npcFigures } from "./npc-figures.mjs";
import { BOTTOM_CODE, TOP_CODE, dressFor, looksOf } from "./wardrobe.mjs";
import { strideBodies } from "./stride.mjs";
import { bindingOf, objectKit, projectedPx, tierFor } from "./objects.mjs";
import { buildSignage, normalizeSignage } from "../interior-lab/signage.mjs";

const SAVE_SOLO = "kerbside:city:world";
const SAVE_ID = "kerbside:city:id";
//: How often the page asks the city's server what has changed (ms).
const SYNC_MS = 4000;
//: While the page hears of each new version (live.mjs), it still asks this often (a missed one).
const SYNC_LIVE_MS = 30_000;
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
//: Width, height and length (m) of each kind as drawn: the one table (vehicles.mjs VEHICLE_DIMS,
//: the fleet's true sizes) the traffic parks, steers and is walked round by. It had been a copy
//: here, and the two had to be kept the same by hand.
const CAR_DIMS = VEHICLE_DIMS;
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
  // A person's part (toneMaterial): which of its colours each piece takes -- kept through the merge.
  if (parts.some((g) => g.attributes.tonePart)) {
    const part = new Float32Array(n);
    let k = 0;
    for (const g of parts) { const c = g.attributes.position.count; if (g.attributes.tonePart) part.set(g.attributes.tonePart.array, k); k += c; }
    out.setAttribute("tonePart", new parts[0].attributes.position.constructor(part, 1));
  }
  return out;
}
//: People's shapes: adults' heights from the bell curve of the CDC/NCHS anthropometric reference
//: for American adults -- men 1.778 m (5 ft 10) by 7.1 cm, women 1.651 m (5 ft 5) by 6.6 cm --
//: held within ADULT_HEIGHT.hold of those either way (no 1.5 m man, no 2.1 m woman; an even hold
//: leaves the averages where they are); children by age; builds narrower and broader. From the
//: person's id, so each is the same every time and nothing is stored or worked out again.
export const ADULT_HEIGHT = { male: { mean: 1.778, sd: 0.071 }, female: { mean: 1.651, sd: 0.066 }, hold: 3.5 };
//: A draw from the normal curve (Box-Muller) from two of the seed's uniforms: most people near
//: the middle and fewer the further out, as heights are. (The sum of three uniforms it was ends
//: at 3 either way and has too few people out towards it.)
function normalDraw(r) {
  const u = Math.max(1e-12, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
//: An adult's height for a draw ``z`` from the normal curve, in metres.
export function adultHeight(female, z) {
  const { mean, sd } = female ? ADULT_HEIGHT.female : ADULT_HEIGHT.male, hold = ADULT_HEIGHT.hold;
  return mean + sd * Math.max(-hold, Math.min(hold, z));
}
export function bodyFor(person, cache) {
  let b = cache.get(person.id);
  if (b) return b;
  const r = rng(person.id || "?", "body"), g = normalDraw(r);
  const age = person.age ?? 35;
  let height, build, female = null;
  if (age < 18) { height = Math.max(1.0, Math.min(1.85, 0.78 + age * 0.06 + g * 0.05)); build = 0.82 + r() * 0.12; }
  else {
    female = r() < 0.5;
    height = adultHeight(female, g);
    build = (female ? 0.9 : 1.0) + (r() - 0.5) * 0.28;
  }
  const grey = age > 55 && r() < 0.6;
  // Skin and hair from San Francisco's own people (wardrobe.mjs looksOf): its heritages in their
  // shares, and nobody drawn paper-white.
  const looks = looksOf(person, { grey });
  b = { height, build, female, hair: looks.hair, skin: looks.skin, heritage: looks.heritage, bald: age > 30 && r() < 0.1, phase: r() * 6.28 };
  b.outfit = outfitFor(person, b);
  if (cache.size > 20000) cache.clear();
  cache.set(person.id, b);
  return b;
}
//: What a person wears (wardrobe.mjs dressFor): a top and a bottom chosen for who they are -- their
//: work, their age, how bold their temperament is -- in colours that go with the garment and
//: with each other. From streams of their own, so the body's draws -- heights, builds -- are as
//: they were.
export const OUTFIT_SHARES = { skirt_female: 0.3, short_sleeves: 0.34, long_hair_female: 0.62, long_hair_male: 0.08, collar_hair: 0.22 };
export function outfitFor(person, body) {
  return dressFor(person, body, temperamentOf(person), OUTFIT_SHARES);
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
  // A business: its till and its stock at what the wholesaler charged (enterprise.mjs); a seller still being paid is a debt.
  for (const b of st.businesses || []) {
    const share = (id) => R.business?.wholesale_share?.[R.items?.[id]?.kind] ?? R.business?.wholesale_share?.default ?? 0.5;
    const stock = Object.entries(b.stock || {}).reduce((t, [id, n]) => t + Math.round((R.items?.[id]?.price || 0) * share(id)) * Math.max(0, n), 0);
    assets.push({ kind: "business", label: b.name, value: Math.max(0, Math.round((b.balance || 0) + stock)) });
    if (b.loan?.left > 0) debts.push({ kind: "loan", label: `Owed to the seller of ${b.name}`, value: Math.round(b.loan.left * b.loan.monthly) });
  }
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
//: A traffic signal's head stands at the corner of its junction: the junction is the nearest
//: signalled node of the streets (junctionAt) within this.
const SIGNAL_HEAD_NODE_M = 30;
export function signalNodeNear(streets, x, z, reach = SIGNAL_HEAD_NODE_M) {
  let best = null, bestD = reach;
  const r = Math.ceil(reach / streets.cell), cx = Math.floor(x / streets.cell), cz = Math.floor(z / streets.cell);
  for (let i = -r; i <= r; i += 1) for (let j = -r; j <= r; j += 1) {
    for (const id of streets.grid.get(`${cx + i},${cz + j}`) || []) {
      const n = streets.nodes[id], d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD && junctionAt(streets, id) === "signal") { bestD = d; best = id; }
    }
  }
  return best;
}
//: What a head shows: the phase the cars coming toward it keep (fleet.mjs signalAt). Its lenses
//: face (sin yaw, cos yaw), so the traffic that reads them travels the other way.
export function signalShown(streets, node, yaw, tsec) {
  return node === null || node === undefined ? null : signalAt(streets, node, Math.atan2(-Math.sin(yaw), -Math.cos(yaw)), tsec);
}

const store = {
  get(key) { try { return JSON.parse(globalThis.localStorage?.getItem(key) || "null"); } catch { return null; } },
  set(key, value) { try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* full or private */ } },
};

export async function startCity(ctx) {
  const { THREE } = ctx;
  const R = loadRules(await fetch(ctx.asset("city/rules.json"), { cache: "no-cache" }).then((r) => r.json()));
  // The counties' and towns' real outlines (scripts/build_jurisdictions.py), when they come.
  fetch(ctx.asset("city/jurisdictions.json")).then((r) => (r.ok ? r.json() : null)).then((b) => { if (b?.counties) R.boundaries = b; }).catch(() => {});
  // What things look like (docs/city/objects.json, scripts/build_city_objects.mjs): each item's
  // model from the user's object lab, fetched the first time it is seen.
  const OBJ = await fetch(ctx.asset("city/objects.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const kit = OBJ && ctx.loadModel ? objectKit(THREE, ctx, OBJ, R) : null;
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
  //: What a push (C, empty-handed) can move, and about what it weighs: what is not bolted, set in
  //: the ground or built in (mechanics-work.mjs push slides it on the pavement).
  const PUSH_KG = { "interior.furniture": 30, "vegetation.log": 120, "item.movable": 5 };
  for (const [id, a] of Object.entries(catalogue?.archetypes || {})) {
    const d = a.durability || {};
    if (d.level >= 2 && d.break_energy_j) R.objects[id] = { name: a.name, material: a.material, break_j: d.break_energy_j, health: d.health, push_kg: PUSH_KG[id] ?? null };
  }
  // The real bus stops and the routes that call at them.
  let transitStops = null, timetable = null;
  fetch(ctx.transitUrl || ctx.asset("transit-stops.json")).then((r) => (r.ok ? r.json() : null)).then((json) => { transitStops = json?.stops || []; if (district.streets) makeLines(); }).catch(() => {});
  // Muni's timetable through the district (scripts/build_muni_routes.py): its routes run as it
  // runs them, the others out and back.
  fetch(ctx.asset("city/muni-routes.json")).then((r) => (r.ok ? r.json() : null)).then((json) => { if (json?.lines) { timetable = json; if (district.streets) makeLines(); } }).catch(() => {});

  //: Who you are in the city: the server's id for this device's account once signed in; a local
  //: id only in the offline practice world.
  const localId = store.get(SAVE_ID) || (() => { const id = `p${Math.random().toString(36).slice(2, 10)}`; store.set(SAVE_ID, id); return id; })();
  let myId = localId;
  const timeAt = (ms) => cityTime(ms, R.clock.zone);
  // The game's clock (clock.mjs): a day in 72 real minutes. ``gameNow()`` is what the books and
  // the clock on the bar read; the fleet works in real minutes from the game day's start
  // (``fleetAt``), so people and cars move at real speed through a day planned by the game's hours.
  const CLOCK = clockOf(R);
  // (All of it read through clockTime: the practice game can hold its clock -- clock.mjs.)
  const gameNow = (ms = Date.now()) => CLOCK.game(clockTime(ms));
  const fleetAt = (ms) => fleetTime(CLOCK, clockTime(ms), R.clock.zone);
  //: Real minutes until game time ``gameMs`` (a deadline, as you live it).
  const realMinutesTo = (gameMs) => (CLOCK.real(gameMs) - clockTime()) / 60000;

  // ---- time held (the practice game only) --------------------------------------------------------
  //: While the clock is held the hour stands still and the street goes on: each resident (and
  //: their car with them) lives a window of ``window_min`` real minutes from the held moment over
  //: and over, on one of ``phases`` phases of it (by their id), so at any moment the people out
  //: are spread over the whole window -- as many walking, driving, waiting and working as that
  //: stretch of the day has, for as long as the clock is held. One whose window comes round
  //: while they are in your sight goes on with their day until they are out of it (``turns_most``
  //: times round at most): nobody you are looking at is taken off the street to start again.
  const HOLD = { window_min: R.clock.hold_window_min ?? 6, phases: 48, turns_most: 6, seen_ms: 700 };
  const SAVE_HOLD = "kerbside:city:clock-hold";
  const holdTurns = new Map();   // someone in sight when their window came round: id -> the turn they are still on
  const holdSeen = new Map();    // id -> when they were last in sight (performance.now())
  const holdTimes = new Map();   // phase * 8 + turns behind -> { stamp, t } (the fleet's time there, made once a frame)
  let holdStamp = 0, holdNow = 0, holdReal = 0;
  //: The fleet's time for ``id`` (a resident, a visitor; a car's owner): everyone's, unless the
  //: clock is held. ``base``: this frame's common time.
  function timeFor(id, base) {
    if (!clockHeld() || id === undefined || id === null) return base;
    const k = hash32(id, "hold") % HOLD.phases, W = HOLD.window_min * 60000;
    const { offset, turn } = heldOffset(holdReal, k, HOLD.phases, W);
    let on = holdTurns.get(id);
    if (on !== undefined && (on >= turn || turn - on > HOLD.turns_most || !(holdSeen.get(id) > holdNow - HOLD.seen_ms))) { holdTurns.delete(id); on = undefined; }
    const behind = on === undefined ? 0 : turn - on, key = k * 8 + behind;
    let e = holdTimes.get(key);
    if (!e) holdTimes.set(key, e = { stamp: -1, t: null });
    if (e.stamp !== holdStamp) { e.stamp = holdStamp; e.t = fleetTime(CLOCK, clockTime() + offset + behind * W, R.clock.zone); e.t.turn = turn; }
    return e.t;
  }
  //: ``id`` is in your sight this frame: if their window comes round now they keep on (timeFor).
  function holdInSight(id, now) {
    if (!clockHeld()) return;
    holdSeen.set(id, now);
    if (!holdTurns.has(id)) { const { turn } = heldOffset(holdReal, hash32(id, "hold") % HOLD.phases, HOLD.phases, HOLD.window_min * 60000); holdTurns.set(id, turn); }
  }
  function holdFrame(realMs, now) {
    holdStamp += 1; holdNow = now; holdReal = realMs;
    if (!clockHeld()) { if (holdTurns.size) { holdTurns.clear(); holdSeen.clear(); holdTimes.clear(); } return; }
    if (holdSeen.size > 6000) for (const [id, at] of holdSeen) if (at < now - 5000) { holdSeen.delete(id); holdTurns.delete(id); }
  }
  //: The clock stopped (``hour``: at that hour of the game's day, the next time it comes; else
  //: now) or let go. Only in the practice game: the city online keeps one clock for everyone.
  function holdTime(hour = null) {
    if (!world) return { ok: false, error: "Time can only be held in the offline practice game: the city online keeps one clock for everyone." };
    let at = null;
    if (Number.isFinite(hour)) {
      const g = gameNow(), ct = timeAt(g), want = ((hour % 24) + 24) % 24 * 60;
      at = CLOCK.real(g + ((want - ct.minute + 1440) % 1440) * 60000);
    }
    holdClock(Date.now(), at);
    store.set(SAVE_HOLD, clockHoldState());
    resetStreet();
    return { ok: true, held: true, label: timeAt(gameNow()).label };
  }
  function releaseTime() {
    releaseClock(Date.now());
    store.set(SAVE_HOLD, clockHoldState());
    resetStreet();
    return { ok: true, held: false, label: timeAt(gameNow()).label };
  }
  //: The street looked at afresh after the clock is moved: nobody is where they were.
  function resetStreet() {
    lastCrowd = -1e9; scanAt = { x: Infinity, z: Infinity };
    glided.clear(); personTiers.clear(); carTiers.clear(); holdTurns.clear(); holdSeen.clear(); holdTimes.clear();
    district.drivers?.cars.clear();
    if (district.city) district.city.timeFor = clockHeld() ? timeFor : null;
  }
  const timeState = () => ({ held: clockHeld(), practice: Boolean(world), label: timeAt(gameNow()).label, hour: timeAt(gameNow()).minute / 60, window_min: HOLD.window_min, phases: HOLD.phases, carried: holdTurns.size });

  // ---- the district the walker is in -----------------------------------------------------------
  const district = { key: null, region: null, city: null, roster: null, drivers: null, places: [], streets: null, cameras: [], people: [], county: null };
  const MIN_PLACE_M2 = 8;
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
          showMappedSign: way._showMappedSign, designedFront: way._hasDesignedFront, address: way.address?.formatted,
          tenants: (way.shops || []).map(s => ({ ...s, n: s.n?.trim() ||
            way.tenant_names?.find(t => t.t === s.t)?.n })).filter(s => s.n),

          floors: Math.max(1, Math.round((way.height_m || 6) / R.real_estate.storey_m)), area, lon: way.centroid[0], lat: way.centroid[1],
          tag: way.tags?.building || null, ring: Array.isArray(pts) && pts.length > 2 ? pts.map(([lon, lat]) => ctx.fromLonLat(lon, lat)) : null });
        continue;
      }
      if (!Array.isArray(pts) || pts.length < 2) continue;
      if (way.kind === "street" && way.tunnel_kind !== "underground") {
        ways.push({ kind: "street", pts: pts.map(([lon, lat]) => ctx.fromLonLat(lon, lat)), lanes: way.lanes_fit || way.lanes || 2, name: way.name || null,
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
    // (Nothing under 8 m2 is a place to go into: a kiosk, a pump house, a mapping sliver. The
    // world draws no walls for one, and its door stood in the air.)
    const fresh = buildings.filter((b) => !district.allBuildings.has(b.id) && !(b.area < MIN_PLACE_M2));
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
    const places = fresh.map((b) => { const pl = placeFromBuilding(b, streets, R); if (pl) { pl.showMappedSign = b.showMappedSign; pl.tenants = b.tenants; pl.designedFront = b.designedFront; pl.address = b.address; pl.front = b.inside || null; pl.ring = b.ring || null; pl.county = data.county; } return pl; }).filter(Boolean);
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
    district.workshops = district.places.filter(pl => isWorkshop(R, pl));
    district.people = [...roster.people.values()];
    district.placeById = roster.places;
    // (The books keep the game's time: ``ms`` is the fleet's real one, so the game's is asked for.)
    const harm = (id) => harmNow((world || view)?.harm?.get(id), gameNow());
    const delay = (v, leg, day) => (district.drivers?.delayOf(City.legKey(v, leg, day)) || 0) / 60;
    // The streets as wide as the world draws them (people.mjs Streets.calibrate): lanes, parked
    // cars and pavements all to the same kerbs.
    if (ctx.kerbAt) {
      const t0 = performance.now(), n = streets.calibrate((x, z, ax, az) => ctx.kerbAt(x, z, ax, az, 6));
      ctx.log?.(`kerbside: ${n} streets' widths taken from the drawn kerbs in ${Math.round(performance.now() - t0)} ms`);
    }
    if (!district.city) district.city = new City(R, roster, streets, { seed: region, timeAt: fleetAt, harm, delay });
    else district.city.setStreets(streets);
    district.city.timeFor = clockHeld() ? timeFor : null;
    district.city.setLines(district.lines || []);
    // Parking at the kerb as the world draws it: its driveways and its painted kerb.
    if (ctx.kerbAt) district.city.setKerbside({ kerbAt: (x, z, ax, az) => ctx.kerbAt(x, z, ax, az, 6), kerbParking: ctx.kerbParking, onRoad: ctx.roadAt || null, kerbNear: (x, z, reach) => ctx.kerbAt(x, z, null, null, reach) });
    district.rackCount = -1; syncRacks(0);
    district.lotCount = -1; district.lotsAt = -1e9; syncLots(0);
    if (!district.drivers) district.drivers = new Drivers(streets, { ...TRAFFIC, main_green_share: R.traffic?.main_green_share ?? 0.5 });
    else { district.drivers.streets = streets; district.drivers.cars.clear(); district.drivers.boxes.clear(); district.drivers.claims.clear(); }
    // The visitors' cars: so many to a place by how busy the district is (rules.json density).
    const [clon, clat] = ctx.toLonLat(me().x, me().z);
    const busy = Math.max(R.density?.default?.traffic ?? 1, ...((R.density?.hotspots || []).filter((h0) => clat >= h0.bbox[0] - 0.01 && clat <= h0.bbox[2] + 0.01 && clon >= h0.bbox[1] - 0.01 && clon <= h0.bbox[3] + 0.01).map((h0) => h0.traffic || 1)));
    roster.visitorsUpTo(Math.min(R.density?.visitors_max ?? 5000, Math.round(roster.places.size * (R.density?.visitors_per_place ?? 0.8) * busy)));
    // Those who live and work outside, driving through once a day (rules.json density.commuters).
    roster.commutersUpTo(R.density?.commuters?.count ?? 0);
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
  //: The bicycle racks the world has drawn (ctx.bikeRacks: module 21), given to the city when
  //: they come or change -- the furniture is drawn after the streets, a while after the district.
  function syncRacks(now) {
    if (!ctx.bikeRacks || !district.city || now - (district.racksAt || -1e9) < 2000) return;
    district.racksAt = now;
    const racks = ctx.bikeRacks() || [];
    if (racks.length === district.rackCount) return;
    district.rackCount = racks.length;
    district.city.setRacks(racks);
    ctx.log?.(`kerbside: ${racks.length} bicycle racks for the city's riders`);
  }
  //: The shops' own signs: a business whose owner has set one in the Interior Studio (its
  //: design's house.signage: interior-lab/signage.mjs) has it over its door -- the awning, the
  //: board, the painted name or the sign out front, lettered as they chose, with their line
  //: under the name. Looked at every few seconds; built again only when the sign, the shop's
  //: name or its door has changed, and taken down when the business closes or the sign is removed.
  const storeSigns = new Map();   // business id -> { key, group }
  let storeSignsAt = -1e9;
  function dropStoreSign(id) {
    const have = storeSigns.get(id);
    if (!have) return;
    have.showMappedSign?.(true);
    have.group.removeFromParent();
    have.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    storeSigns.delete(id);
  }
  function syncStoreSigns(now) {
    if (now - storeSignsAt < 3000) return;
    storeSignsAt = now;
    const src = world || view, designs = src?.businessInteriors, biz = src?.biz, seen = new Set();
    if (designs && biz && typeof document !== "undefined") {
      for (const [id, design] of designs) {
        const sign = normalizeSignage(design?.house?.signage), b = biz.get(id);
        if (!sign || !b || b.status !== "open" || !b.place) continue;
        const pl = district.placeById?.get(b.place.id) || district.placeById?.get(String(b.place.id)) || (district.places || []).find((x) => String(x.id) === String(b.place.id));
        const door = pl?.door;
        if (!door || !Number.isFinite(door.nx) || !Number.isFinite(door.nz)) continue;
        seen.add(id);
        const key = `${JSON.stringify(sign)}|${b.name}|${Math.round(door.x * 10)}:${Math.round(door.z * 10)}`;
        if (storeSigns.get(id)?.key === key) continue;
        dropStoreSign(id);
        try {
          const g = buildSignage(THREE, sign, { name: b.name || "Shop", frontage: Math.max(3, Math.min(7, Math.sqrt(pl.area || 60) * 0.6)) });
          // The door's own frame: z out from the wall (the door's n points in), x along the front.
          g.position.set(door.x - door.nx * 0.05, groundAt(door.x - door.nx * 0.6, door.z - door.nz * 0.6), door.z - door.nz * 0.05);
          g.rotation.y = Math.atan2(-door.nx, -door.nz);
          g.userData.business = id;
          group.add(g);
          pl.showMappedSign?.(false);
          storeSigns.set(id, { key, group: g, showMappedSign: pl.showMappedSign });
        } catch (error) { console.warn("kerbside: a shop's sign could not be drawn", id, error); storeSigns.set(id, { key, group: new THREE.Group() }); }
      }
    }
    // Every other shop near you: its trade's sign (storefronts.mjs) -- an awning in the trade's
    // look, its name and what it sells -- and, where it shows its goods, a lit display in the
    // window beside the door. The nearest few dozen, built as you come and taken down behind.
    if (typeof document !== "undefined" && district.places?.length) {
      const you = me(), owned = new Set([...seen].map((id) => String(biz?.get(id)?.place?.id)));
      const near = district.places.filter((pl) => pl.shops?.length && pl.door && Number.isFinite(pl.door.nx) && !owned.has(String(pl.id))
        && Math.abs(pl.x - you.x) < TRADE_SIGN_M && Math.abs(pl.z - you.z) < TRADE_SIGN_M)
        .sort((a, b) => Math.hypot(a.x - you.x, a.z - you.z) - Math.hypot(b.x - you.x, b.z - you.z)).slice(0, TRADE_SIGN_MAX);
      for (const pl of near) {
        const maxBays = Math.max(1, Math.floor((pl.front?.half || 2.5) * 2 / 3));
        const tenants = pl.tenants?.length ? pl.tenants.slice(0, maxBays) : [null];
        for (const [bay, tenant] of tenants.entries()) {
          const id = `trade:${pl.id}:${bay}`, door = pl.door;
          seen.add(id);
          const kind = tenant?.t || view?.kitchenKind?.(pl) || pl.shops[0];
          const style = view?.kitchenKind?.(pl) ? restaurantService(R, kind, view.bizAt(pl.id), view.kitchens?.get(String(pl.id)))?.style : null;
          const name = view?.bizAt?.(pl.id)?.name || tenant?.n || pl.name || pl.address || "";
          const key = `${kind}|${style}|${name}|${Math.round(door.x * 10)}:${Math.round(door.z * 10)}`;
          if (storeSigns.get(id)?.key === key) continue;
          dropStoreSign(id);
          try {
            const frontage = Math.max(3, Math.min(7, Math.min(Math.sqrt(pl.area || 60) * 0.6, (pl.front?.half || 3.5) * 2 / tenants.length)));
            // A designed front (the exterior engine's) carries its own sign, awning and window
            // display, with the business's name merged on: nothing more is drawn over it.
            if (pl.designedFront) { storeSigns.set(id, { key, group: new THREE.Group() }); continue; }
            const g = !name ? new THREE.Group() : buildSignage(THREE, tradeSignage(kind, pl.id, { style, tagline: R.stores?.kinds?.[kind]?.name && R.stores.kinds[kind].name !== name ? R.stores.kinds[kind].name : "" }), { name, frontage });
            const display = windowDisplayOf(kind, style);
            if (display && frontage >= 3.6) {
              const w = Math.min(1.8, frontage / 2 - 0.9), side = hash32(String(pl.id)) % 2 ? 1 : -1;
              const d = buildWindowDisplay(THREE, display, { width: w, seed: hash32(String(pl.id), "window") });
              d.position.set(side * (0.75 + w / 2), 0, 0.02);
              g.add(d);
            }
            const offset = tenants.length === 1 || !pl.front ? 0 : ((bay + 0.5) / tenants.length - 0.5) * pl.front.half * 2;
            const anchor = tenants.length > 1 && pl.front ? pl.front : door;
            const x = anchor.x - anchor.nz * offset, z = anchor.z + anchor.nx * offset;
            g.position.set(x - anchor.nx * .05, groundAt(x - anchor.nx * .6, z - anchor.nz * .6), z - anchor.nz * .05);
            g.rotation.y = Math.atan2(-anchor.nx, -anchor.nz);
            g.userData.place = pl.id;
            group.add(g);
            storeSigns.set(id, { key, group: g });
          } catch (error) { console.warn("kerbside: a shop's front could not be drawn", pl.id, error); storeSigns.set(id, { key, group: new THREE.Group() }); }
        }
      }
    }
    for (const id of [...storeSigns.keys()]) if (!seen.has(id)) dropStoreSign(id);
  }
  //: How near (m, either way) and how many shops' fronts are drawn.
  const TRADE_SIGN_M = 160, TRADE_SIGN_MAX = 30;
  //: The car parks' stalls the world has drawn (ctx.parkingStalls: module 14), given to the city
  //: when they come or change, as the racks are.
  function syncLots(now) {
    if (!ctx.parkingStalls || !district.city || now - (district.lotsAt || -1e9) < 2500) return;
    district.lotsAt = now;
    const stalls = ctx.parkingStalls() || [];
    if (stalls.length === district.lotCount) return;
    district.lotCount = stalls.length;
    district.city.setLots(stalls);
    ctx.log?.(`kerbside: ${stalls.length} car park stalls for the city's cars`);
  }
  //: The bus lines through the district: the real routes' stops near its streets.
  function makeLines() {
    district.lines = []; district.stops = [];
    if (!transitStops || !district.streets || !district.places.length) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of district.places) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    const near = transitStops.filter((s) => { const [x, z] = ctx.fromLonLat(s.lon, s.lat); return x > x0 - 100 && x < x1 + 100 && z > z0 - 100 && z < z1 + 100; });
    try { district.lines = buildLines(R, near, district.streets, (lon, lat) => ctx.fromLonLat(lon, lat), timetable); } catch (error) { console.warn("kerbside: bus lines", error); }
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
  // What moves is left out of the stand-in the shadows are traced through (proxy-light.mjs).
  globalThis.__kerbsideProxyLight?.dynamic.add(group);
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const MAX_PEOPLE = 700, MAX_CARS = 320;
  const box = (w, h, d, y = 0, x = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, 0);
  const mk = (geo, max, opts = {}) => { const m = new THREE.InstancedMesh(geo, lambert({ color: 0xffffff, ...opts }), max); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.castShadow = false; group.add(m); return m; };
  // ---- the people drawn in full: a human shape, dressed -------------------------------------
  // They were boxes -- a box torso, a ball head, box limbs, all one colour each (2026-11-14: "more
  // realistic"). Now each part is turned on a lathe from a profile -- hips, waist, chest and
  // shoulders; a tapered arm with a hand; a leg narrowing to the ankle and a shoe -- a few hundred
  // triangles a person, still seven instanced parts and the poses as they were. Each part takes
  // two colours and an accent per person (toneMaterial): a leg is the trousers' colour above the
  // hem and skin below it (shorts), its shoe the shoes'; an arm the sleeve's down to its cuff, the
  // hand skin; the torso the shirt down to the belt, then the trousers. A skirt is one more part,
  // and the hair is cut to its length (short, to the collar, long) where it falls.
  const lathe = (profile, segs, sz = 1) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs).scale(1, 1, sz);
  const piece = (geo, part = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.setAttribute("tonePart", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
    return g;
  };
  // Filled out (2026-11-17: "weirdly skinny and long limbed"): the trunk a seventh wider and a
  // quarter deeper, thighs and upper arms a third thicker, the arm a hand shorter, the head a
  // little larger. Heights are as they were -- the joints, the poses and the clothes' cuts.
  // Hips at 0.84 (where the legs hang), the belt at 0.93, the shoulders at 1.34 (where the arms do).
  const torsoGeo = mergeGeos([piece(lathe([[0.001, 0.8], [0.19, 0.81], [0.2, 0.9], [0.178, 1.02], [0.196, 1.14], [0.214, 1.26], [0.222, 1.32], [0.16, 1.385], [0.065, 1.405], [0.001, 1.41]], 10, 0.74))]);
  // The head: a little longer than wide, a neck, a nose to tell which way it looks (-z, ahead).
  const headGeo = mergeGeos([
    piece(new THREE.SphereGeometry(0.115, 12, 9).scale(0.9, 1.12, 1).translate(0, 1.545, 0)),
    piece(new THREE.CylinderGeometry(0.056, 0.064, 0.14, 8, 1, true).translate(0, 1.4, 0.005)),
    piece(new THREE.BoxGeometry(0.026, 0.04, 0.03).translate(0, 1.525, -0.107)),
    piece(new THREE.SphereGeometry(0.022, 5, 4).scale(0.6, 1, 1).translate(-0.102, 1.54, 0.005)),
    piece(new THREE.SphereGeometry(0.022, 5, 4).scale(0.6, 1, 1).translate(0.102, 1.54, 0.005)),
  ]);
  // A leg from the hip (y 0) to the sole (-0.84): thigh, knee, calf, ankle; the shoe ahead of it.
  const legGeo = mergeGeos([
    piece(lathe([[0.001, 0.03], [0.09, 0.01], [0.097, -0.12], [0.082, -0.36], [0.066, -0.45], [0.072, -0.57], [0.05, -0.74], [0.045, -0.77], [0.001, -0.78]], 8)),
    piece(new THREE.BoxGeometry(0.104, 0.08, 0.25).translate(0, -0.8, -0.05), 2),
    piece(new THREE.SphereGeometry(0.052, 6, 4).scale(1, 0.75, 1.1).translate(0, -0.79, -0.165), 2),
  ]);
  // An arm from the shoulder (y 0): upper arm, elbow, forearm to the wrist (-0.49), the hand skin.
  const armGeo = mergeGeos([
    piece(lathe([[0.001, 0.05], [0.066, 0.02], [0.07, -0.05], [0.06, -0.25], [0.053, -0.28], [0.048, -0.46], [0.039, -0.49], [0.001, -0.495]], 7)),
    piece(new THREE.SphereGeometry(0.046, 6, 5).scale(0.66, 1.25, 1).translate(0, -0.54, -0.005), 1),
  ]);
  // Hair: a cap over the crown, and behind it what falls -- to the collar, or the shoulders --
  // cut per person at their hair's length (TONE_TRIM: what is below the cut is not drawn).
  const hairGeo = mergeGeos([
    piece(new THREE.SphereGeometry(0.125, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(0.94, 1.09, 1.04).translate(0, 1.553, 0.008)),
    piece(new THREE.CylinderGeometry(0.119, 0.138, 0.3, 10, 3, true, -Math.PI / 2 - 0.15, Math.PI + 0.3).translate(0, 1.4, 0.035)),
  ]);
  // A skirt: from the belt to the knee, flared.
  const skirtGeo = mergeGeos([piece(new THREE.CylinderGeometry(0.2, 0.27, 0.44, 12, 1, true).scale(1, 1, 0.8).translate(0, 0.7, 0))]);
  //: The material that dresses a part: per person ``tonePrimary`` (the cloth), ``toneSecond`` (rgb:
  //: skin or the trousers; w: the cut, in the part's own height, below which it shows) and
  //: ``toneAccent`` (shoes); per vertex ``tonePart`` (0 cloth to the cut, 1 always the second, 2
  //: the accent). ``trim``: what is below the cut is left out (hair).
  //: The garments' marks (wardrobe.mjs TOP_CODE, BOTTOM_CODE in ``vTT.w``, the trim's colour in
  //: ``vTT.rgb``), drawn on the cloth by where a point is on its part (``vTL``: x, z, and the
  //: part -- 1 the torso, 2 an arm, 3 a leg). The front is -z.
  const GARMENT_GLSL = `if (vTT.w > 0.5 && vTPart < 0.5 && vTY >= vTS.w) {
  float kbX = abs(vTL.x), kbY = vTY, kbS = vTT.w; bool kbFront = vTL.y < 0.0;
  if (vTL.z > 0.5 && vTL.z < 1.5) {
    if (abs(kbS - 4.0) < 0.5) { if (kbY > 1.355 || (kbFront && kbX < 0.011 && kbY > 0.95)) kbCloth = vTT.rgb; }
    else if (abs(kbS - 5.0) < 0.5) {
      if (kbFront && kbY > 1.04 && kbX < (kbY - 1.04) * 0.42) kbCloth = (kbX < 0.017 && kbY < 1.36 && distance(vTA, vTP) > 0.01) ? vTA : vTT.rgb;
      else if (kbFront && kbY > 1.0 && kbY < 1.04 && abs(kbX - 0.012) < 0.006) kbCloth = vTP * 0.6;
    }
    else if (abs(kbS - 2.0) < 0.5 || abs(kbS - 3.0) < 0.5) { if (kbY < 0.99) kbCloth = vTT.rgb; else if (abs(kbS - 3.0) < 0.5 && !kbFront && kbY > 1.29) kbCloth = vTT.rgb; else if (abs(kbS - 3.0) < 0.5 && kbFront && kbY > 1.12 && kbY < 1.22 && kbX < 0.1) kbCloth = vTP * 0.86; }
    else if (abs(kbS - 6.0) < 0.5) { if (kbX > 0.165) kbCloth = vTT.rgb; }
    else if (abs(kbS - 9.0) < 0.5) { if (abs(kbY - 1.06) < 0.02 || abs(kbY - 1.2) < 0.02 || (kbX > 0.06 && kbX < 0.09 && kbY > 1.06)) kbCloth = vTT.rgb; }
    else if (abs(kbS - 10.0) < 0.5) { if (kbY > 1.36 || (kbFront && abs(kbX - 0.055) < 0.009 && fract(kbY * 11.0) < 0.3 && kbY > 1.0)) kbCloth = vTT.rgb; }
    else if (abs(kbS - 7.0) < 0.5) { if (kbFront && kbY > 1.3 && kbX < (kbY - 1.3) * 0.75) kbCloth = vTT.rgb; }
    else if (abs(kbS - 1.0) < 0.5) { if (kbY > 1.39) kbCloth = vTT.rgb; }
  } else if (vTL.z > 1.5 && vTL.z < 2.5) {
    if ((kbS > 1.5 && kbS < 3.5) && kbY < -0.42) kbCloth = vTT.rgb;
    else if ((abs(kbS - 4.0) < 0.5 || abs(kbS - 5.0) < 0.5) && kbY < -0.45) kbCloth = vTT.rgb;
    else if (abs(kbS - 6.0) < 0.5 && kbX > 0.05) kbCloth = vTT.rgb;
  } else if (vTL.z > 2.5) {
    if (abs(kbS - 1.0) < 0.5 && kbFront && kbY > -0.42 && kbY < -0.08) kbCloth = mix(kbCloth, vec3(1.0), 0.09);
    else if (abs(kbS - 4.0) < 0.5 && kbY < -0.68) kbCloth = vTT.rgb;
    else if (abs(kbS - 3.0) < 0.5 && kbFront && kbX < 0.007) kbCloth = kbCloth * 1.12;
    else if (abs(kbS - 6.0) < 0.5 && abs(vTL.x) > 0.062 && abs(vTL.y) < 0.04) kbCloth = vTT.rgb;
  }
}`;
  const toneMaterial = (trim = false) => {
    const m = lambert({ color: 0xffffff, side: trim ? THREE.DoubleSide : THREE.FrontSide });
    m.onBeforeCompile = (sh) => { globalThis.__kerbsideProxyLight?.patch?.(sh);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 tonePrimary; attribute vec4 toneSecond; attribute vec3 toneAccent; attribute float tonePart; attribute vec4 toneTrim; attribute float toneZone;\nvarying vec3 vTP; varying vec4 vTS; varying vec3 vTA; varying float vTPart; varying float vTY; varying vec4 vTT; varying vec3 vTL;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTP = tonePrimary; vTS = toneSecond; vTA = toneAccent; vTPart = tonePart; vTY = position.y; vTT = toneTrim; vTL = vec3(position.x, position.z, toneZone);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTP; varying vec4 vTS; varying vec3 vTA; varying float vTPart; varying float vTY; varying vec4 vTT; varying vec3 vTL;")
        .replace("#include <color_fragment>", trim
          ? "if (vTY < vTS.w) discard;\ndiffuseColor.rgb *= vTP;"
          : `vec3 kbCloth = vTPart > 1.5 ? vTA : ((vTPart > 0.5 || vTY < vTS.w) ? vTS.rgb : vTP);
${GARMENT_GLSL}
diffuseColor.rgb *= kbCloth;`);
    };
    m.customProgramCacheKey = () => (trim ? "kerbside-tone-trim" : "kerbside-tone");
    return m;
  };
  const TONE_MAT = toneMaterial(), TRIM_MAT = toneMaterial(true);
  // At night a faint rim of light round each figure (the page's nightRim), so nobody is lost
  // against a dark street.
  if (ctx.nightRim) { ctx.nightRim(TONE_MAT); ctx.nightRim(TRIM_MAT); }
  //: A dressed part: its own copy of the shape (the per-person colours live on it) and its colours.
  //: ``zone``: which part of a body it is, for the garments' marks (1 torso, 2 arm, 3 leg, 0 none).
  const mkTone = (geo, max, trim = false, zone = 0) => {
    const g = geo.clone();
    g.setAttribute("toneTrim", new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("toneZone", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(zone), 1));
    g.setAttribute("tonePrimary", new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("toneSecond", new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("toneAccent", new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.InstancedMesh(g, trim ? TRIM_MAT : TONE_MAT, max);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.userData.tone = true;
    group.add(m);
    return m;
  };
  const TONE_A = new THREE.Color(), TONE_B = new THREE.Color(), TONE_C = new THREE.Color();
  //: A colour as the page writes it ("#rrggbb", a name, a number), read once: Color.set on a
  //: string parses it with regular expressions, and dressAt set four for everyone drawn every
  //: frame (26 MB a second of garbage, measured 2026-11-20). Same colours.
  const toneCache = new Map();
  const setTone = (c, v) => {
    if (typeof v !== "string") return c.set(v);
    let read = toneCache.get(v);
    if (!read) { if (toneCache.size > 4096) toneCache.clear(); toneCache.set(v, read = new THREE.Color().set(v)); }
    return c.copy(read);
  };
  //: Person ``i`` of ``mesh`` in ``primary``, ``second`` below ``cut`` (or where the part says),
  //: ``accent``; ``trim`` and ``style`` the garment's marks (GARMENT_GLSL; 0: none).
  const dressAt = (mesh, i, primary, second, cut, accent, trim, style = 0) => {
    const a = mesh.geometry.attributes;
    setTone(TONE_A, primary); setTone(TONE_B, second ?? primary); setTone(TONE_C, accent ?? primary);
    a.tonePrimary.setXYZ(i, TONE_A.r, TONE_A.g, TONE_A.b);
    a.toneSecond.setXYZW(i, TONE_B.r, TONE_B.g, TONE_B.b, cut ?? -99);
    a.toneAccent.setXYZ(i, TONE_C.r, TONE_C.g, TONE_C.b);
    if (a.toneTrim) { setTone(TONE_C, trim ?? primary); a.toneTrim.setXYZW(i, TONE_C.r, TONE_C.g, TONE_C.b, style || 0); }
  };
  const toneDone = (mesh) => { const a = mesh.geometry.attributes; a.tonePrimary.needsUpdate = a.toneSecond.needsUpdate = a.toneAccent.needsUpdate = true; if (a.toneTrim) a.toneTrim.needsUpdate = true; };
  const parts = { torso: mkTone(torsoGeo, MAX_PEOPLE, false, 1), head: mkTone(headGeo, MAX_PEOPLE), hair: mkTone(hairGeo, MAX_PEOPLE, true), legL: mkTone(legGeo, MAX_PEOPLE, false, 3), legR: mkTone(legGeo, MAX_PEOPLE, false, 3), armL: mkTone(armGeo, MAX_PEOPLE, false, 2), armR: mkTone(armGeo, MAX_PEOPLE, false, 2) };
  const skirts = mkTone(skirtGeo, MAX_PEOPLE);
  for (const [k, m] of Object.entries(parts)) m.name = `city-people-${k}`;
  skirts.name = "city-people-skirt";
  //: Where the hair is cut (y of the hair's own shape, head at 1.54): to the ears, the collar, the shoulders.
  const HAIR_CUT = { short: 1.5, collar: 1.39, long: 1.255, none: 9 };
  // Bicycles: the Voltage MTB's LOD3 (vehicles.mjs BIKE), its wheels, crank and pedals turning as
  // it is ridden (drawBikes); at the low tier, and until that has loaded, two wheels and a frame
  // built here, one instanced mesh. Their riders are drawn as people, on the saddle (riderPose).
  const MAX_BIKES = 120;
  const bikeFarGeo = (() => {
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
    // (Built bars to +z; turned to face -z, as the LOD3 and the cars do.)
    return mergeGeos(geos).rotateY(Math.PI);
  })();
  const bikeMesh = mk(bikeFarGeo, MAX_BIKES);
  bikeMesh.name = "city-bikes-low";
  // A U-lock on each bicycle locked to a rack (fleet.mjs rackSlot): a hardened steel shackle round
  // the rack's leg and the seat tube, and its crossbar, rubber-sleeved, closing it. Lying level at
  // the lock's place (``lock`` {x, y, z, yaw}: its shackle reaching along +z turned by yaw).
  const LOCK_W = 0.1, LOCK_L = 0.2, LOCK_PIPE = 0.008, LOCK_UP = new THREE.Vector3(0, 1, 0);
  const lockShackle = new THREE.InstancedMesh(mergeGeos([
    ...[-1, 1].map((sx) => new THREE.CylinderGeometry(LOCK_PIPE, LOCK_PIPE, LOCK_L, 6).rotateX(Math.PI / 2).translate(sx * LOCK_W / 2, 0, 0)),
    new THREE.TorusGeometry(LOCK_W / 2, LOCK_PIPE, 6, 12, Math.PI).rotateX(Math.PI / 2).translate(0, 0, LOCK_L / 2),
  ]), new THREE.MeshStandardMaterial({ color: 0xc8ccce, roughness: 0.28, metalness: 0.9 }), MAX_BIKES);
  const lockBar = new THREE.InstancedMesh(mergeGeos([
    new THREE.CylinderGeometry(0.018, 0.018, LOCK_W + 0.07, 10).rotateZ(Math.PI / 2).translate(0, 0, -LOCK_L / 2),
    new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10).rotateZ(Math.PI / 2).translate(LOCK_W / 2 + 0.04, 0, -LOCK_L / 2),
  ]), new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.82, metalness: 0.05 }), MAX_BIKES);
  for (const [m, name] of [[lockShackle, "city-bike-locks"], [lockBar, "city-bike-lock-bars"]]) {
    m.name = name; m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m);
  }
  //: A rider's legs in two bones each, thigh and shin (the walking figure's are one piece from the
  //: hip): a unit long, hanging from the joint, stretched to the bone's length; the shin's foot
  //: darker, a shoe.
  const thighGeo = box(0.18, 1, 0.19, -0.5);
  const shinGeo = box(0.145, 1, 0.155, -0.5);
  {
    const pos = shinGeo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) { const v = pos.getY(i) < -0.88 ? 0.28 : 1; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
    shinGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const riderLegs = { thighL: mk(thighGeo, MAX_BIKES), thighR: mk(thighGeo, MAX_BIKES), shinL: mk(shinGeo, MAX_BIKES, { vertexColors: true }), shinR: mk(shinGeo, MAX_BIKES, { vertexColors: true }) };
  for (const [k, m] of Object.entries(riderLegs)) m.name = `city-rider-${k}`;
  // ---- the crowd further off (detail.mjs) ------------------------------------------------------
  //: Drawn in full (seven parts, limbs swinging) at most this many, nearest first; then moderate,
  //: then low. Past a tier's cap a person is drawn at the next tier down, not left out.
  const PEOPLE_CAPS = [420, 560, 900];
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
  const midBodyGeo = mergeGeos([
    piece(lathe([[0.001, 0.8], [0.195, 0.82], [0.18, 1.02], [0.218, 1.28], [0.14, 1.39], [0.001, 1.41]], 6, 0.74)),
    piece(new THREE.CylinderGeometry(0.09, 0.052, 0.8, 5, 1, true).translate(-0.105, 0.46, 0)),
    piece(new THREE.CylinderGeometry(0.09, 0.052, 0.8, 5, 1, true).translate(0.105, 0.46, 0)),
    piece(box(0.085, 0.07, 0.22, 0.035, -0.1).translate(0, 0, -0.045), 2), piece(box(0.085, 0.07, 0.22, 0.035, 0.1).translate(0, 0, -0.045), 2),
    piece(new THREE.CylinderGeometry(0.064, 0.046, 0.56, 5, 1, false).translate(-0.29, 1.08, 0)),
    piece(new THREE.CylinderGeometry(0.064, 0.046, 0.56, 5, 1, false).translate(0.29, 1.08, 0)),
  ]);
  const midHeadGeo = shadeByHeight(new THREE.SphereGeometry(0.127, 8, 6).translate(0, 1.535, 0), [[1.575, 1], [9, 0.3]]);
  //: Low: one block the person's height in their shirt's colour, legs darker -- a figure, at two
  //: hundred metres, and one part.
  const lowBodyGeo = shadeByHeight(mergeGeos([box(0.48, 1.4, 0.3, 0.7), box(0.22, 0.24, 0.22, 1.52)]), [[0.8, 0.55], [1.41, 1], [9, 0.85]]);
  const midBody = mkTone(midBodyGeo, PEOPLE_CAPS[1]), midHead = mk(midHeadGeo, PEOPLE_CAPS[1], { vertexColors: true });
  const lowBody = mk(lowBodyGeo, PEOPLE_CAPS[2], { vertexColors: true });
  midBody.name = "city-people-moderate"; midHead.name = "city-people-moderate-head"; lowBody.name = "city-people-low";
  const bodies = new Map();
  // The nearest as MakeHuman people (npc-figures.mjs): two bodies dressed in parts, every part
  // one instanced draw skinned on the graphics card. Until they load -- or where they are not
  // published -- the near ring is drawn as it was.
  const figures = npcFigures(THREE, { loadModel: ctx.loadModel || (() => Promise.reject(new Error("no loader"))), asset: ctx.asset, store: ctx.npcStore || null, parent: group });
  //: Who can be drawn as a character: walking, standing or running, on the telephone or filming,
  //: on a bicycle -- not fallen, at a sport, sat down or riding in something (the jointed figure has
  //: those poses; the characters' clips do not).
  //: What a person near you is doing that the crowd shows with a motion-captured move
  //: (npc-figures.mjs CROWD_MOVES): {name, key} -- the key starts a once-played move again -- or
  //: null. Struck: flinched, knocked back or down (``hitMove``, from strikePerson); squaring up,
  //: holding someone, cuffing them; talking, waving one down, cowering or crouched to help, startled.
  const CROWD_GESTURE_MOVES = { guard: "PunchGuard", grab: "Push", cuffing: "Interact" };
  const CROWD_CLIP_MOVES = { talk: "Talk", wave: "Call", hail: "Call", cower: "Crouch", help: "Crouch", startle: "HitChest" };
  function crowdMoveFor(p, clip = null) {
    if (p.hitMove) return p.hitMove;
    if (p.down || p.fall || p.ride) return null;   // (a crash's fall is the jointed figure's: crash.mjs)
    const g = p.gesture?.kind;
    if (g && CROWD_GESTURE_MOVES[g] && !p.moving) return { name: CROWD_GESTURE_MOVES[g], key: g };
    if (!p.moving) { const c = clip ?? clipFor(p, hash32(p.id)); if (CROWD_CLIP_MOVES[c]) return { name: CROWD_CLIP_MOVES[c], key: c }; }
    return null;
  }
  const figureFits = (p) => {
    const mv = crowdMoveFor(p);
    if (mv) return Boolean(figures.canMove?.(mv.name));
    return !p.down && !p.fall && (!p.ride || (p.ride === "bike" && p.bike)) && (!p.gesture || p.gesture.kind === "phone" || p.gesture.kind === "film");
  };
  //: Out running: a runner's stroll (people.mjs), or running from something.
  const RUNNING = /running|for a run/;
  // Loaded with the city, not when the first person comes near: nobody waits for the files.
  figures.start?.();
  let figuresLast = 0;
  // The traffic: every car an imported body (vehicles.mjs bodyOf: the bought-in cars by how many
  // of each California buys, the rest the fleet pack's and the Kenney kit's), each body's parts
  // instanced -- paint, glass and the rest -- so a bus is a bus and a pickup has its bed. The
  // same body at every tier: its "npc" file near you, its "mid" one further off, a box beyond.
  const fleet = new Map();
  // The Kenney Car Kit's bodies (vehicles.mjs), loaded once.
  const kenney = new Map();   // kit model name -> {geometry, material} | null
  const kenneyLoads = new Map();
  let kenneyLoading = false;
  function loadKenney() {
    if (kenneyLoading || !ctx.loadModel) return;
    kenneyLoading = true;
    const names = [...new Set(Object.values(KENNEY_FOR).flat())];
    const dimsOf = (name) => VEHICLE_DIMS[Object.keys(KENNEY_FOR).find((k) => KENNEY_FOR[k].includes(name) && VEHICLE_DIMS[k])] || VEHICLE_DIMS.sedan;
    for (const name of names) {
      kenneyLoads.set(name, ctx.loadModel(ctx.asset(`city/models/kenney/${name}.glb`)).then((gltf) => {
        const k = kenneyGeometry(THREE, gltf, dimsOf(name), name);
        kenney.set(name, { name, geometry: k.geometry, material: kenneyMaterial(THREE, k.map), livery: k.livery });
      }).catch((error) => { kenney.set(name, null); console.warn("kerbside: a car model did not load", name, error); }));
    }
  }
  loadKenney();
  // The bodies' files (vehicles.mjs bodyFile): the traffic's ("npc" and "mid", a few dozen
  // kilobytes each, asked for when a car first wants them) and the full one -- inside and all --
  // for the one you drive or ride.
  const bodyModels = new Map();   // file -> parts (vehicles.mjs fleetParts) | null (failed) | "loading"
  const bodyLoads = new Map();    // file -> the promise of its parts
  //: The parts of the model in ``file``, or null until it has loaded (and asked for, the first time).
  function modelAt(file) {
    if (!file) return null;
    const have = bodyModels.get(file);
    if (have !== undefined) return have === "loading" ? null : have;
    if (!ctx.loadModel) { bodyModels.set(file, null); return null; }
    bodyModels.set(file, "loading");
    bodyLoads.set(file, ctx.loadModel(ctx.asset(file)).then((gltf) => { const parts = fleetParts(THREE, gltf); bodyModels.set(file, parts); return parts; })
      .catch((error) => { bodyModels.set(file, null); console.warn("kerbside: a vehicle model did not load", file, error); return null; }));
    return null;
  }
  //: The parts in ``file`` once loaded (null: none, or it failed).
  const modelReady = (file) => { const now = modelAt(file); return now ? Promise.resolve(now) : bodyLoads.get(file) || Promise.resolve(null); };
  //: The fleet's model of ``kind`` at ``tier`` ("npc", "mid" or "full"): for looking at the fleet.
  const fleetReady = (kind, tier) => modelReady(fleetFile(kind, tier));
  // The traffic's files are asked for with the page (about a megabyte in all): a car comes into view
  // as itself, not as a box until its file arrives.
  for (const kind of Object.keys(FLEET_FOR)) for (const tier of ["npc", "mid"]) modelAt(fleetFile(kind, tier));
  for (const id of Object.keys(CAR_MODELS)) for (const tier of ["npc", "mid"]) modelAt(bodyFile({ source: "car", id }, tier));
  //: One instanced mesh of ``geo`` with ``mat``, ``cap`` of them, for the traffic.
  const instanced = (geo, mat, cap, name) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.name = name;
    group.add(m);
    return m;
  };
  //: Which levels a body may be drawn at, finest first, for a car that wants ``tier``: a coarser
  //: one stands in while the wanted file loads, never a finer one (the far traffic's cost stays
  //: the far traffic's); null when none has loaded (the box is drawn).
  const LEVELS = { full: ["full", "npc", "mid"], npc: ["npc", "mid"], mid: ["mid"] };
  //: A car's body for the traffic, as instanced parts ({ parts: [{ mesh, tint }], cap, n }:
  //: ``tint`` takes the car's colour): its body (vehicles.mjs bodyOf, by its number ``shade``)
  //: at the level its ring wants (detail.mjs: FULL the npc file, MODERATE the mid one; ``hero``,
  //: the bus or the cab you ride in, the full one); the kit's one model at every level.
  const fleetOf = (model, shade = 0, tier = FULL, hero = false) => {
    const body = bodyOf(model, shade), kind = body.kind;
    if (body.source === "kit") {
      const kit = kenney.get(body.id);
      if (!kit) return null;
      const key = `kenney:${kit.name}`;
      if (!fleet.has(key)) {
        const cap = kind === "box_truck" ? 40 : MAX_CARS;
        const m = instanced(kit.geometry, kit.material, cap, `city-traffic-${kit.name}`);
        m.castShadow = true; m.userData.surface = "car:body";
        fleet.set(key, { parts: [{ mesh: m, tint: true }], cap, n: 0, livery: kit.livery, dims: bodyDims(body) });
      }
      return fleet.get(key);
    }
    for (const level of LEVELS[hero ? "full" : tier === MODERATE ? "mid" : "npc"]) {
      const file = bodyFile(body, level), parts = modelAt(file);
      if (!parts) continue;
      const full = level === "full", key = `body:${file}${kind === "patrol" ? ":patrol" : ""}`;
      if (!fleet.has(key)) {
        const cap = full ? 4 : kind === "bus" || kind === "box_truck" ? 40 : MAX_CARS;
        const meshes = parts.map((part) => {
          const mesh = instanced(part.geometry, fleetMaterial(THREE, part, { standard: full, livery: kind === "bus" ? BUS_LIVERY : kind === "patrol" ? PATROL_LIVERY : null }), cap, `city-traffic-${body.id}-${level}-${part.name}${kind === "patrol" ? "-patrol" : ""}`);
          mesh.castShadow = !part.glass; if (part.glass) mesh.renderOrder = 2;
          mesh.userData.surface = carSurface(part.name);
          return { mesh, tint: part.tint };
        });
        fleet.set(key, { parts: meshes, cap, n: 0, fleet: true, dims: bodyDims(body) });
      }
      return fleet.get(key);
    }
    return null;
  };
  // What moves casts no shadow from the stand-in the sun is traced through (proxy-light.mjs: it
  // is drawn now and then, not every frame). Under each car and each person near you, the dark
  // where it meets the ground instead: one soft-edged patch, a quad an instance.
  const shadeTexture = (() => {
    const cv = globalThis.document.createElement("canvas"); cv.width = cv.height = 64;
    const g = cv.getContext("2d"), img = g.createImageData(64, 64);
    for (let j = 0; j < 64; j += 1) for (let i = 0; i < 64; i += 1) {
      // A rounded box, dark through the middle and gone by the edge.
      const u = Math.abs(i - 31.5) / 31.5, v = Math.abs(j - 31.5) / 31.5, e = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
      const a = Math.max(0, Math.min(1, (1 - e) / 0.45));
      img.data.set([0, 0, 0, Math.round(255 * a * a * (3 - 2 * a))], (j * 64 + i) * 4);
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(cv);
  })();
  const shadeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadeMat = () => new THREE.MeshBasicMaterial({ map: shadeTexture, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false, toneMapped: false });
  const SHADE_PEOPLE = 260;
  const carShade = instanced(shadeGeo, shadeMat(), MAX_CARS, "city-car-shade"), peopleShade = instanced(shadeGeo, shadeMat(), SHADE_PEOPLE, "city-people-shade");
  carShade.renderOrder = peopleShade.renderOrder = 1;
  const SHADE_M = new THREE.Matrix4(), SHADE_Q = new THREE.Quaternion(), SHADE_UP = new THREE.Vector3(0, 1, 0), SHADE_V = new THREE.Vector3(), SHADE_S = new THREE.Vector3();
  const shadeAt = (mesh, cap, x, y, z, yaw, w, l) => {
    if (mesh.count >= cap) return;
    SHADE_M.compose(SHADE_V.set(x, y + 0.04, z), SHADE_Q.setFromAxisAngle(SHADE_UP, yaw), SHADE_S.set(w, 1, l));
    mesh.setMatrixAt(mesh.count++, SHADE_M); mesh.instanceMatrix.needsUpdate = true;
  };
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(0, 0.33, 0);
  const lightGeo = new THREE.BoxGeometry(0.22, 0.12, 0.02);
  // Somebody is driving: in every car near you that is not parked, a driver from the waist up
  // behind the glass -- shoulders and a head, in their own clothes' colour. That is all a
  // driver is from the street, and for the partial people (the commuters: fleet.mjs
  // commutersUpTo) it is all there is of them. Two instanced meshes for the whole street.
  const DRIVER_SKIN = [0xc99473, 0xc4996b, 0xb58560, 0xa97c52, 0x6b452e, 0x996a45];   // wardrobe.mjs SKIN_ANCHORS
  const DRIVER_CLOTH = [0x2f4858, 0x33658a, 0x86bbd8, 0x758e4f, 0xf6ae2d, 0xb23a48, 0x4a4e69, 0x9a8c98, 0xe9e4d8, 0x2b2d42];
  const driverBody = instanced(new THREE.BoxGeometry(0.44, 0.5, 0.26).translate(0, 0.25, 0), lambert({ color: 0xffffff }), MAX_CARS, "city-drivers");
  const driverHead = instanced(new THREE.SphereGeometry(0.11, 10, 8).translate(0, 0.66, 0), lambert({ color: 0xffffff }), MAX_CARS, "city-driver-heads");
  const DRIVER_M = new THREE.Matrix4(), DRIVER_C = new THREE.Color();
  //: Where the driver sits in a car ``w`` wide, ``h`` high and ``l`` long: on the left, a little
  //: ahead of the middle (a bus's or a truck's, right at the front), their hips at seat height.
  const driverSeat = (model, w, h, l) => ({ side: w * 0.23, ahead: model === "bus" || model === "box_truck" || model === "delivery_van" ? l * 0.36 : l * 0.06, up: Math.max(0.42, h * 0.36) });
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
    const floorOf = (p) => (Number.isFinite(p.at_y) ? p.at_y : shop.place && p.indoors === shop.place.id ? shop.frame.y : groundAt(p.x, p.z));
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
    // Those drawn stand on the ground where they are, not on the metre-square's: the cache's
    // height from up to 0.7 m away had feet 5 cm or more into the pavement at 1.75% of the places
    // people stand in the Marina (10 cm at 0.9%, 42 cm at the worst: a kerb's edge, a hill;
    // measured 2026-11-25), so the crowd always had someone sunk to the ankles.
    for (const o of out) if (!(shop.place && o.p.indoors === shop.place.id) && !Number.isFinite(o.p.at_y)) o.y = footAt(o.p);
    return out;
  }
  //: The ground right under someone (the page's walker ground: the drawn surface, which the soil
  //: holds up -- grass bends over it, foliage-motion.mjs), looked up again only once they have
  //: moved FOOT_MOVE_M: [x, z, y] by id.
  //: In the close ring the way ahead of each one is looked along (close-lock.mjs feetTracker):
  //: where the ground within ten feet of them rises or falls by more than a few millimetres it is
  //: read again every 4 mm they move, so no foot or wheel is ever set into a kerb or a slope;
  //: on ground that flat, every 10 cm (as before).
  const feetNear = feetTracker((x, z) => ctx.groundAt(x, z) ?? groundAt(x, z));
  function footAt(p) {
    return feetNear.at(p, performance.now(), p.detail !== MODERATE && p.detail !== LOW);
  }
  // How the people near you move (clips.mjs): a walk, a run, a telephone at the ear, a look each
  // way at the kerb -- sampled for each, cross-faded when what they are doing changes. One state
  // a person in the full ring, let go a few seconds after they leave it.
  const blends = new Map(), POSE = newPose(), BLEND_OPTS = { speed: 0, height: 1.75, seed: 0 };
  const UB = new THREE.Matrix4(), HM = new THREE.Matrix4();
  let blendSweep = 0;
  // (Its entries kept from frame to frame and filled again: nothing made a person a frame.)
  const FIG_CAM = { x: 0, z: 0 }, FIG_YOU = { x: 0, z: 0 }, figPeople = [], figEntries = [], figInView = new Map(), figReady = [];
  const figHas = (id) => figures.has?.(id);
  let figLast = null;
  // What a near-ring person looks like (npc-figures.mjs crowdLook picks their parts from it): kept
  // with their body, one object a person, not one a frame.
  const lookOf = (p) => {
    const body = bodyFor(p.person, bodies), o = body.outfit;
    return { body, look: body.look ||= { top: o.topColour, bottom: o.bottoms, shoes: o.shoes, hair: body.hair, skin: body.skin, garment: o.top, legs: o.legs, cut: o.hair, bald: body.bald, heritage: body.heritage, age: p.person?.age ?? 35 } };
  };
  //: The form each person was last drawn in (0 a character, 1 jointed, 2 simple, 3 basic), and when.
  const formWas = new Map(), FORM_OF = new Map(), FORM_MEMORY_MS = 450, lockStats = { changes: 0, changesNear: 0, held: 0, near: 0, nearLow: 0, nearSum: 0, nearLowSum: 0, heldLowSum: 0, carChanges: 0, carChangesNear: 0, carHeld: 0 };
  let figuresWere = false;
  function drawPeople(list, now, focus = null) {
    if (now - blendSweep > 2500) { blendSweep = now; for (const [id, st] of blends) if (now - st.lastNow > 3000) blends.delete(id); }
    const seen = peopleInView(list);
    // Each at the tier the frame gave it (frameCity), or -- a cyclist, a passenger -- by where it is.
    for (const q of seen) q.detail = q.p.detail ?? (detailNow ? detailNow.tier("people", q.p.x, q.p.z) : FULL);
    let [full, mid, low] = byTier(seen, PEOPLE_CAPS);
    // Near you, the characters; then the jointed figures, which were the near ring, for the rest
    // of it and the moderate ring; past that the basic shapes. (While the characters load, the
    // rings are as they were.)
    // Characters (npc-figures.mjs figurePlan): everyone in view big enough on the screen to be told
    // from a jointed figure, or near you, whatever the ring or the count -- and, hidden, everyone
    // out of view in that or on their way into it in the next few seconds, so each is a character
    // the moment they are seen. (It had been the nearest 20 in view of the full ring: the
    // twenty-first beside you, and anyone you turned round to, a jointed figure first.)
    const near = [];
    let ready = [], want = null;
    if (!figures.failed) {
      const cam = ctx.camera?.();
      if (cam) { cam.getWorldPosition(VIEW_AT); FIG_CAM.x = VIEW_AT.x; FIG_CAM.z = VIEW_AT.z; }
      FIG_YOU.x = focus?.x ?? FIG_CAM.x; FIG_YOU.z = focus?.z ?? FIG_CAM.z;
      const reach = figureReach(cam?.fov || 50, globalThis.innerHeight || 900);
      figInView.clear();
      for (const q of seen) figInView.set(q.p, q);
      figPeople.length = 0;
      let k = 0;
      for (const p of list) {
        // (Only those who could come near: the rest are well out of both reaches.)
        if (Math.abs(p.x - FIG_CAM.x) > reach + 60 && Math.abs(p.x - FIG_YOU.x) > 90 || Math.abs(p.z - FIG_CAM.z) > reach + 60 && Math.abs(p.z - FIG_YOU.z) > 90) continue;
        const v = p.moving ? (p.speed ?? p.person?.pace ?? 1.3) : 0, e = figEntries[k] ||= {};
        e.id = p.id; e.p = p; e.x = p.x; e.z = p.z; e.vx = -Math.sin(p.yaw || 0) * v; e.vz = -Math.cos(p.yaw || 0) * v;
        e.female = bodyFor(p.person, bodies).female === true; e.fits = figureFits(p); e.inView = figInView.has(p);
        figPeople.push(e); k += 1;
      }
      const plan = figurePlan(figPeople, FIG_CAM, FIG_YOU, reach, { has: figHas });
      // (What the page reports of it: kerbsideCity().detail().figurePlan. ``unfit``: in view and
      // within it, but doing what a character has no clip for -- riding, fallen -- so a jointed figure.)
      let unfit = 0;
      for (const e of figPeople) if (!e.fits && e.inView && Math.hypot(e.x - FIG_CAM.x, e.z - FIG_CAM.z) <= reach) unfit += 1;
      const fl = figLast ||= {};
      fl.reach = reach; fl.drawn = plan.draw.length; fl.ready = plan.ready.length; fl.spilled = plan.spilled; fl.unfit = unfit;
      for (const e of plan.draw) near.push(figInView.get(e.p));
      figReady.length = 0;
      for (const e of plan.ready) { const r = e.readyEntry ||= {}; r.id = e.id; r.female = e.female; r.look = lookOf(e.p).look; figReady.push(r); }
      ready = figReady;
      want = plan.want;
    }
    // The reality lock (detail.mjs lockedForm): whoever was drawn a moment ago in one form keeps
    // it while they are in the picture, unless they are far enough off for the change not to show.
    const figsOn = !figures.failed && (near.length > 0 || figuresWere);
    const forms = FORM_OF; forms.clear();
    for (const q of full) forms.set(q, 1);
    for (const q of mid) forms.set(q, figsOn ? 1 : 2);
    for (const q of low) forms.set(q, figsOn ? 2 : 3);
    const planned = new Set();
    for (const q of near) if (q) { forms.set(q, 0); planned.add(q); }
    let heldNow = 0;
    for (const q of seen) {
      const want = forms.get(q);
      if (want === undefined) continue;
      const rec = formWas.get(q.p.id), was = rec && now - rec.t < FORM_MEMORY_MS ? rec.f : undefined;
      let f = lockedForm("people", want, was, true, Math.sqrt(q.d));
      if (f === 0 && want !== 0 && !figHas(q.p.id)) f = want;   // (no character of them is ready to keep)
      if (f === 3 && figsOn) f = 2;
      if (f !== want) { heldNow += 1; forms.set(q, f); if (f > want && q.d < 46 * 46) lockStats.heldLowSum += 1; }
    }
    const asked = [];
    for (const q of near) if (q && forms.get(q) === 0) asked.push(q);
    for (const q of seen) if (forms.get(q) === 0 && !planned.has(q)) asked.push(q);
    near.length = 0; for (const q of asked) near.push(q);
    const dtFig = figuresLast ? Math.min(0.1, (now - figuresLast) / 1000) : 0; figuresLast = now;
    const asFigures = figures.draw(near.map(({ p, y }) => {
      const { body, look } = lookOf(p);
      // What they are doing, for the phone and the mouth: the city's clip (clips.mjs) -- filming
      // held up to film, walking or not -- and talking (to you, to each other, on the phone).
      const clip = p.gesture?.kind === "film" ? "film" : clipFor(p, hash32(p.id));
      const talking = clip === "talk" || clip === "phone" || clip === "walk_phone";
      // (A cyclist sat on the bicycle as it is drawn: on the ground under it, its crank turned as
      // its wheels have gone.)
      const bike = p.ride === "bike" ? p.bike : null;
      const mv = crowdMoveFor(p, clip), move = mv && figures.canMove?.(mv.name) ? mv : null;
      return { id: p.id, move: move?.name || null, moveKey: move?.key ?? null, x: p.x, y: y + (bike ? 0 : p.lift || 0), z: p.z, yaw: p.yaw, height: body.height, build: body.build, female: body.female,
        moving: Boolean(p.moving), speed: p.speed ?? (RUNNING.test(p.activity || "") ? 3.6 : p.person.pace), look,
        clip, talking, ride: Boolean(bike), crank: bike ? crankTurn(bike.odo || 0) : 0 };
    }), now, dtFig, ready, want);
    {
      // Each in the form the lock left them: the characters drawn above; then the jointed figures,
      // the simple shapes and the basic ones. (A character there was no room to draw is jointed.)
      const drawn = new Set(near.slice(0, asFigures || 0));
      full = []; mid = []; low = [];
      let nearNow = 0, nearLow = 0;
      for (const q of seen) {
        let f = forms.get(q);
        if (f === undefined) continue;
        if (f === 0 && !drawn.has(q)) f = 1;
        if (f === 1) full.push(q); else if (f === 2) mid.push(q); else if (f === 3) low.push(q);
        // (Within 25 m in the picture, and how many of those no character though one would fit.)
        if (q.d < 625) { nearNow += 1; if (f !== 0 && figureFits(q.p)) nearLow += 1; }
        // What was seen to change, for checking (kerbsideCity().detail().lock).
        const rec = formWas.get(q.p.id);
        if (rec && now - rec.t < FORM_MEMORY_MS && rec.f !== f) { lockStats.changes += 1; if (q.d < 46 * 46) lockStats.changesNear += 1; }
        if (rec) { rec.f = f; rec.t = now; } else formWas.set(q.p.id, { f, t: now });
      }
      figuresWere = Boolean(asFigures);
      lockStats.held = heldNow; lockStats.near = nearNow; lockStats.nearLow = nearLow; lockStats.nearSum += nearNow; lockStats.nearLowSum += nearLow;
      if (formWas.size > 4000) for (const [id, r] of formWas) if (now - r.t > 3000) formWas.delete(id);
    }
    drawPeopleSimpler(mid, low, now);
    peopleShade.count = 0; peopleShade.instanceMatrix.needsUpdate = true;
    // Where the sun draws each person's own outline (docs/fine-shadows.mjs) the round blob is only
    // the dark where feet meet the ground; at night and far off it is the whole shadow, as before.
    peopleShade.material.opacity = 0.5 - 0.36 * (globalThis.__kerbsideProxyLight?.fineK?.value.x || 0);
    if (asFigures) for (const { p, y } of near.slice(0, asFigures)) if (!p.indoors) shadeAt(peopleShade, SHADE_PEOPLE, p.x, y, p.z, p.yaw, 0.8, 0.8);
    let n = 0, r = 0, k = 0;
    for (const { p, y } of full) {
      if (n >= MAX_PEOPLE) break;
      const body = bodyFor(p.person, bodies), s = body.height / 1.75;
      const phase = now / 1000 * 2 * Math.PI * (p.person.pace / 1.35) * 0.95 + (hash32(p.id) % 100);
      // A step lifts the body a little at each stride (twice a stride, as the legs pass).
      // (A clip where there is one for what they are doing; the old swing for a fall, a ride, a sport.)
      const seed = hash32(p.id), clip = clipFor(p, seed);
      if (clip) {
        let st = blends.get(p.id);
        if (!st) blends.set(p.id, st = makeBlend());
        const dtc = st.lastNow ? Math.min(0.1, (now - st.lastNow) / 1000) : 0; st.lastNow = now;
        BLEND_OPTS.speed = p.moving ? (p.speed ?? (RUNNING.test(p.activity || "") ? 3.6 : p.person.pace)) : 0; BLEND_OPTS.height = body.height; BLEND_OPTS.seed = seed;
        stepBlend(st, clip, dtc, POSE, BLEND_OPTS);
      }
      const bob = clip ? 0 : p.moving && !p.ride ? Math.abs(Math.sin(phase)) * 0.03 * s : 0;
      const b = base(p.x, y + (p.lift || 0) + bob, p.z, p.yaw + Math.PI, s);
      if (clip && (POSE.sway || POSE.bob)) b.multiply(TM.makeTranslation(POSE.sway, POSE.bob, 0));
      if (!p.indoors && !p.ride) shadeAt(peopleShade, SHADE_PEOPLE, p.x, y, p.z, p.yaw, p.down ? 0.9 : 0.8, p.down ? 1.9 : 0.8);
      if (body.build !== 1) b.multiply(TM.makeScale(body.build, 1, 0.92 + body.build * 0.08));
      // Knocked down: falling backward to the ground (and lying there, hurt).
      if (p.down) b.multiply(RM.makeRotationX(-(p.fall ?? 1) * Math.PI / 2 * 0.96)).multiply(TM.makeTranslation(0, (p.fall ?? 1) * 0.12, 0));
      const swing = p.moving ? Math.sin(phase) * 0.55 : p.down ? 0.35 : 0;
      const set = (mesh, ox, oy, rot) => { M.copy(b).multiply(TM.makeTranslation(ox, oy, 0)).multiply(RM.makeRotationX(rot)); mesh.setMatrixAt(n, M); };
      if (p.ride === "bike" && p.bike && r < MAX_BIKES) {
        // On the bicycle: sat on its saddle, leant over the bars from the hips, hands on the grips,
        // each foot on its pedal and the knee between worked out (vehicles.mjs riderPose).
        const pose = riderPose(s, crankTurn(p.bike.odo || 0), body.build);
        riderFrame(p.bike, s, pose, M);
        parts.head.setMatrixAt(n, M); parts.hair.setMatrixAt(n, M);
        if (body.build !== 1) M.multiply(TM.makeScale(body.build, 1, 0.92 + body.build * 0.08));
        parts.torso.setMatrixAt(n, M);
        parts.legL.setMatrixAt(n, ZERO); parts.legR.setMatrixAt(n, ZERO);
        bone(parts.armL, n, pose.shoulders[0], pose.hands[0], 0.6, s); bone(parts.armR, n, pose.shoulders[1], pose.hands[1], 0.6, s);
        bone(riderLegs.thighL, r, pose.hips[0], pose.knees[0], 1, s); bone(riderLegs.thighR, r, pose.hips[1], pose.knees[1], 1, s);
        bone(riderLegs.shinL, r, pose.knees[0], pose.feet[0], 1, s); bone(riderLegs.shinR, r, pose.knees[1], pose.feet[1], 1, s);
        const o = body.outfit, skin = body.skin;
        riderLegs.thighL.setColorAt(r, C.set(o.bottoms)); riderLegs.thighR.setColorAt(r, C);
        riderLegs.shinL.setColorAt(r, C.set(o.bottom === "trousers" ? o.bottoms : skin)); riderLegs.shinR.setColorAt(r, C);
        r += 1;
      } else if (p.ride === "bike") {
        // (A rider without the bicycle to hand: the figure leant to the bars, legs turning.)
        const crank = (now / 1000) * (p.speed || 4) * 1.6 + body.phase;
        b.multiply(TM.makeTranslation(0, -0.04, 0.05));
        M.copy(b).multiply(TM.makeTranslation(0, 0.8, 0)).multiply(RM.makeRotationX(-0.42)).multiply(TM.makeTranslation(0, -0.8, 0));
        parts.torso.setMatrixAt(n, M); parts.head.setMatrixAt(n, M); parts.hair.setMatrixAt(n, M);
        const lean = M.clone();
        set(parts.legL, -0.1, 0.84, -1.1 + Math.sin(crank) * 0.55); set(parts.legR, 0.1, 0.84, -1.1 - Math.sin(crank) * 0.55);
        M.copy(lean).multiply(TM.makeTranslation(-0.24, 1.34, 0)).multiply(RM.makeRotationX(-1.05)); parts.armL.setMatrixAt(n, M);
        M.copy(lean).multiply(TM.makeTranslation(0.24, 1.34, 0)).multiply(RM.makeRotationX(-1.05)); parts.armR.setMatrixAt(n, M);
      } else if (clip) {
        // The trunk leans and turns about the hips; the head on the neck; the arms hang from the
        // shoulders of the trunk as it leans; the legs from the hips, which do not.
        UB.copy(b);
        if (POSE.lean || POSE.twist) UB.multiply(TM.makeTranslation(0, 0.84, 0)).multiply(RM.makeRotationFromEuler(E.set(POSE.lean, POSE.twist, 0, "YXZ"))).multiply(TM.makeTranslation(0, -0.84, 0));
        HM.copy(UB);
        if (POSE.headPitch || POSE.headYaw) HM.multiply(TM.makeTranslation(0, 1.4, 0)).multiply(RM.makeRotationFromEuler(E.set(POSE.headPitch, POSE.headYaw, 0, "YXZ"))).multiply(TM.makeTranslation(0, -1.4, 0));
        E.set(0, 0, 0, "XYZ");
        parts.torso.setMatrixAt(n, UB); parts.head.setMatrixAt(n, HM); parts.hair.setMatrixAt(n, HM);
        set(parts.legL, -0.1, 0.84, POSE.legL); set(parts.legR, 0.1, 0.84, POSE.legR);
        M.copy(UB).multiply(TM.makeTranslation(-0.272, 1.34, 0)).multiply(RM.makeRotationX(POSE.armL)); M.multiply(TM.makeRotationZ(POSE.outL)); parts.armL.setMatrixAt(n, M);
        M.copy(UB).multiply(TM.makeTranslation(0.272, 1.34, 0)).multiply(RM.makeRotationX(POSE.armR)); M.multiply(TM.makeRotationZ(POSE.outR)); parts.armR.setMatrixAt(n, M);
        if (body.outfit.bottom === "skirt" && k < MAX_PEOPLE) {
          skirts.setMatrixAt(k, b);
          dressAt(skirts, k, body.outfit.bottoms);
          k += 1;
        }
      } else {
        parts.torso.setMatrixAt(n, b); parts.head.setMatrixAt(n, b); parts.hair.setMatrixAt(n, b);
        // A stride: the thigh forward and the knee a little bent shows as the leg's swing.
        set(parts.legL, -0.1, 0.84, swing); set(parts.legR, 0.1, 0.84, -swing);
        // The arms hang a little out from the body and swing against the legs.
        // (On a court, sports.mjs: the arms go up for a shot or a serve, across for a stroke, out to guard.)
        let armL = -swing * 0.8, armR = swing * 0.8, outL = -0.06, outR = 0.06;
        const g = p.gesture;
        if (g) {
          const k = Math.sin(Math.PI * Math.min(1, Math.max(0, g.f)));
          if (g.kind === "shoot") { armL = armR = -0.3 - 2.5 * k; }
          else if (g.kind === "serve") { armR = -3 * k; armL = -1.7 * Math.min(1, k * 1.6); }
          else if (g.kind === "swing") { armR = -0.3 - 1.4 * k; outR = 0.06 + 0.9 * k; }
          else if (g.kind === "guard") { armL = armR = -2.5; outL = -0.45; outR = 0.45; }
          // A telephone at the ear; one held up to film with.
          else if (g.kind === "phone") { armR = -2.6; outR = 0.4; }
          else if (g.kind === "film") { armL = armR = -1.5; outL = 0.12; outR = -0.12; }
        }
        M.copy(b).multiply(TM.makeTranslation(-0.272, 1.34, 0)).multiply(RM.makeRotationX(armL)); M.multiply(TM.makeRotationZ(outL)); parts.armL.setMatrixAt(n, M);
        M.copy(b).multiply(TM.makeTranslation(0.272, 1.34, 0)).multiply(RM.makeRotationX(armR)); M.multiply(TM.makeRotationZ(outR)); parts.armR.setMatrixAt(n, M);
        if (body.outfit.bottom === "skirt" && k < MAX_PEOPLE) {
          skirts.setMatrixAt(k, b);
          dressAt(skirts, k, body.outfit.bottoms);
          k += 1;
        }
      }
      const o = body.outfit, skin = body.skin, topStyle = TOP_CODE[o.top] || 0;
      dressAt(parts.torso, n, o.topColour, o.bottoms, 0.93, o.tie || o.topColour, o.trim, topStyle);
      dressAt(parts.head, n, skin);
      dressAt(parts.hair, n, body.hair, null, HAIR_CUT[o.hair]);
      const hem = o.bottom === "shorts" ? -0.36 : o.bottom === "skirt" ? 0.2 : null;
      dressAt(parts.legL, n, o.bottoms, skin, hem, o.shoes, o.legTrim, BOTTOM_CODE[o.legs] || 0); dressAt(parts.legR, n, o.bottoms, skin, hem, o.shoes, o.legTrim, BOTTOM_CODE[o.legs] || 0);
      const cuff = o.sleeves === "short" ? -0.16 : null;
      dressAt(parts.armL, n, o.topColour, skin, cuff, null, o.trim, topStyle); dressAt(parts.armR, n, o.topColour, skin, cuff, null, o.trim, topStyle);
      n += 1;
    }
    skirts.count = k; skirts.instanceMatrix.needsUpdate = true; toneDone(skirts);
    for (const mesh of Object.values(parts)) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; if (mesh.userData.tone) toneDone(mesh); }
    for (const mesh of Object.values(riderLegs)) { mesh.count = r; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    drawnTiers.people = [n, mid.length, low.length];
    drawnTiers.figures = asFigures;
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
      // A cyclist: on the saddle and leant to the bars as at the full tier (legs as they hang).
      if (p.ride === "bike" && p.bike) {
        const b = riderFrame(p.bike, s, riderPose(s, 0, body.build), B);
        if (body.build !== 1) b.multiply(TM.makeScale(body.build, 1, 0.92 + body.build * 0.08));
        return b;
      }
      const b = base(p.x, y + (p.lift || 0) + bob, p.z, p.yaw + Math.PI, s);
      if (body.build !== 1) b.multiply(TM.makeScale(body.build, 1, 0.92 + body.build * 0.08));
      if (p.down) b.multiply(RM.makeRotationX(-(p.fall ?? 1) * Math.PI / 2 * 0.96)).multiply(TM.makeTranslation(0, (p.fall ?? 1) * 0.12, 0));
      // A cyclist leans to the bars.
      else if (p.ride === "bike") b.multiply(TM.makeTranslation(0, 0.8, 0.05)).multiply(RM.makeRotationX(-0.42)).multiply(TM.makeTranslation(0, -0.8, 0));
      return b;
    };
    for (const q of mid) {
      const b = place(q);
      midBody.setMatrixAt(m, b); midHead.setMatrixAt(m, b);
      const o = bodyFor(q.p.person, bodies).outfit;
      dressAt(midBody, m, o.topColour, o.bottoms, 0.93, o.shoes);
      midHead.setColorAt(m, C.set(bodyFor(q.p.person, bodies).skin));
      m += 1;
    }
    for (const q of low) {
      lowBody.setMatrixAt(l, place(q));
      lowBody.setColorAt(l, C.set(bodyFor(q.p.person, bodies).outfit.topColour));
      l += 1;
    }
    for (const [mesh, k] of [[midBody, m], [midHead, m], [lowBody, l]]) {
      mesh.count = k; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; if (mesh.userData.tone) toneDone(mesh);
    }
  }
  // ---- people on bicycles ----------------------------------------------------------------------
  //: Cyclists near you: each rides a way through the streets that have bike lanes (as the
  //: traffic goes: one-ways one way), in the bike lane (BIKE_LANE), at a cyclist's pace, and
  //: stops at a red light at the junction's line. A few dozen, found again as you move.
  //: New riders are looked for twice a second, a few at a time (each try is a route search): it
  //: had been six searches every frame while fewer than ``count`` rode -- the steady state where
  //: few streets have lanes -- and the same six, the draw being seeded for two seconds.
  //: (2026-11-13: the riders are the district's own residents now -- each household with no
  //: garage or kerb room keeps bicycles, parked by its door and ridden by the traffic rules
  //: (fleet.mjs) -- so none are dealt here: ``count`` 0. ``residentBikes`` are theirs, each frame.)
  let residentBikes = [];
  const bikeOdo = new Map();
  const BIKES = { count: 0, reach_m: 450, drop_m: 650, speed: [3.8, 6.8], route_m: [300, 1100], stop_m: 7, tries: 3, every_s: 0.5 };
  let bikes = [], bikeNodes = null, bikeStreets = null, bikeN = 0, bikeLook = -1, bikeBurst = false;
  function stepBikes(dt, tsec, focus, now = performance.now()) {
    const s = district.streets;
    bikes = bikes.filter((b) => !b.resident);   // (the residents' own are put back after: they are not ridden here)
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
      b.odo = (b.odo || 0) + b.v * dt;   // ridden, all told: how far round the wheels and crank are
      Object.assign(b, alongRoute(b.route, b.d, BIKE_LANE));
    }
  }
  //: The traffic lights, lit by the phase the cars stop and go by: each head's lens for its own
  //: approach, a few times a second. Each head's junction is found once (signalNodeNear).
  const SIGNAL_LIGHT_EVERY_MS = 250;
  let headNodes = new WeakMap(), headStreets = null, signalsAt = 0;
  function lightSignals(tsec, now) {
    const s = district?.streets;
    if (!ctx.lightSignals || !s || now - signalsAt < SIGNAL_LIGHT_EVERY_MS) return;
    signalsAt = now;
    if (headStreets !== s) { headStreets = s; headNodes = new WeakMap(); }
    ctx.lightSignals((head) => {
      const id = head.key || head;
      let node = headNodes.get(id);
      if (node === undefined) { node = signalNodeNear(s, head.x, head.z); headNodes.set(id, node); }
      return signalShown(s, node, head.yaw, tsec);
    });
  }
  //: The riders, as people on their bicycles, for drawPeople.
  const bikeRiders = () => bikes.filter((b) => b.person).map((b) => ({ id: b.person.id, x: b.x, z: b.z, yaw: b.yaw, person: b.person, moving: b.v > 0.3, ride: "bike", lift: 0.22, speed: b.v, bike: b, ...(b.mine ? { detail: FULL } : {}) }));
  //: The LOD3's parts, one instanced mesh each, once loaded (null till then).
  let bikeLod = null;
  ctx.loadModel?.(ctx.asset(BIKE.file)).then((gltf) => {
    const parts = bikeParts(THREE, gltf), out = {};
    for (const name of BIKE.parts) {
      const p = parts[name];
      if (!p) continue;
      const mesh = instanced(p.geometry, fleetMaterial(THREE, p), MAX_BIKES, `city-bike-${name}`);
      mesh.castShadow = true;
      out[name] = { mesh, tint: p.tint, n: 0 };
    }
    bikeLod = out;
  }).catch((error) => console.warn("kerbside: the bicycle did not load", error));
  const BIKE_M = new THREE.Matrix4(), BIKE_AT = Object.fromEntries(["front_axle", "rear_axle", "crankset"].map((k) => [k, new THREE.Vector3(...BIKE.pivots[k])]));
  //: The bicycles: at the full and moderate tiers the LOD3 -- at the full one its wheels turned by
  //: how far it has gone, its crank by that over the gear, and the pedals carried round on it,
  //: level -- and at the low tier the frame built above.
  function drawBikes() {
    let n = 0;
    const L = bikeLod;
    if (L) for (const part of Object.values(L)) part.n = 0;
    for (const b of bikes) {
      // Yours (``mine``: there is no bicycle of your own to ride yet) in full, its wheels turning.
      const tier = b.mine ? FULL : detailNow ? detailNow.tier("people", b.x, b.z) : FULL;
      if (tier === TRACKED) continue;
      BIKE_M.copy(base(b.x, tier === FULL ? feetNear.at(b, performance.now(), true) : groundAt(b.x, b.z), b.z, b.yaw, 1));
      C.set(paintOf("bike", b.shade, BIKE_PAINT_MIX));
      if (!L || tier === LOW) {
        if (n >= MAX_BIKES) continue;
        bikeMesh.setMatrixAt(n, BIKE_M); bikeMesh.setColorAt(n, C); n += 1;
        continue;
      }
      const odo = tier === FULL ? b.odo || 0 : 0, wheel = wheelTurn(odo), crank = crankTurn(odo);
      const put = (name, m) => { const part = L[name]; if (!part || part.n >= MAX_BIKES) return; part.mesh.setMatrixAt(part.n, m); if (part.tint) part.mesh.setColorAt(part.n, C); part.n += 1; };
      put("frame", BIKE_M);
      for (const [name, at] of [["wheel_front", BIKE_AT.front_axle], ["wheel_rear", BIKE_AT.rear_axle]]) put(name, M.copy(BIKE_M).multiply(TM.makeTranslation(at.x, at.y, at.z)).multiply(RM.makeRotationX(wheel)));
      put("crank", M.copy(BIKE_M).multiply(TM.makeTranslation(BIKE_AT.crankset.x, BIKE_AT.crankset.y, BIKE_AT.crankset.z)).multiply(RM.makeRotationX(crank)));
      for (const side of ["left", "right"]) { const [x, y, z] = pedalAt(side, crank); put(`pedal_${side}`, M.copy(BIKE_M).multiply(TM.makeTranslation(x, y, z))); }
    }
    let locks = 0;
    for (const b of bikes) {
      if (!b.lock || b.v > 0.05 || locks >= MAX_BIKES) continue;
      if (detailNow && detailNow.tier("people", b.x, b.z) !== FULL) continue;
      M.compose(V.set(b.lock.x, groundAt(b.lock.x, b.lock.z) + 0.48, b.lock.z), Q.setFromAxisAngle(LOCK_UP, b.lock.yaw || 0), S3.set(1, 1, 1));
      lockShackle.setMatrixAt(locks, M); lockBar.setMatrixAt(locks, M); locks += 1;
    }
    lockShackle.count = lockBar.count = locks;
    lockShackle.instanceMatrix.needsUpdate = lockBar.instanceMatrix.needsUpdate = true;
    bikeMesh.count = n; bikeMesh.instanceMatrix.needsUpdate = true; if (bikeMesh.instanceColor) bikeMesh.instanceColor.needsUpdate = true;
    if (L) for (const part of Object.values(L)) { part.mesh.count = part.n; part.mesh.instanceMatrix.needsUpdate = true; if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true; }
  }
  //: A rider on ``bike`` (scale ``s``, ``build``, the crank at ``crank``): the body's frame -- the
  //: figure (feet at its origin, facing +z) set on the saddle facing the bars and leant over them
  //: from the hips -- into ``out``; ``pose`` riderPose's joints.
  const RIDE_M = new THREE.Matrix4(), JOINT_A = new THREE.Vector3(), JOINT_B = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function riderFrame(bike, s, pose, out) {
    out.copy(base(bike.x, groundAt(bike.x, bike.z), bike.z, bike.yaw, 1));
    RIDE_M.copy(out);
    return out.multiply(TM.makeTranslation(0, pose.root[1], pose.root[2])).multiply(RM.makeRotationY(Math.PI)).multiply(TM.makeScale(s, s, s))
      .multiply(TM.makeTranslation(0, RIDER.hip_y, 0)).multiply(RM.makeRotationX(pose.lean)).multiply(TM.makeTranslation(0, -RIDER.hip_y, 0));
  }
  //: A bone from joint ``a`` to joint ``b`` (the bicycle's frame, RIDE_M): ``mesh``'s instance
  //: ``i``, its geometry hanging ``unit`` long from its origin, ``width`` across.
  function bone(mesh, i, a, b, unit, width) {
    JOINT_A.set(a[0], a[1], a[2]).applyMatrix4(RIDE_M); JOINT_B.set(b[0], b[1], b[2]).applyMatrix4(RIDE_M);
    const len = JOINT_A.distanceTo(JOINT_B);
    V.subVectors(JOINT_B, JOINT_A).divideScalar(len || 1);
    Q.setFromUnitVectors(DOWN, V);
    mesh.setMatrixAt(i, M.compose(JOINT_A, Q, S3.set(width, len / unit, width)));
  }
  //: The traffic's tiers (detail.mjs): the kit's body nearest, the code-built one next, and one
  //: box of the car's size and paint further off; at most so many of each.
  const CAR_CAPS = [80, 170, MAX_CARS];
  const lowCars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), lambert({ color: 0xffffff }), MAX_CARS);
  lowCars.count = 0; lowCars.frustumCulled = false; lowCars.instanceMatrix.setUsage(THREE.DynamicDrawUsage); lowCars.name = "city-traffic-low"; group.add(lowCars);
  const CAR_FRUSTUM = new THREE.Frustum(), CAR_SPHERE = new THREE.Sphere(new THREE.Vector3(), 3);
  //: Which of ``list`` are drawn, and how finely: in view only (a car behind you, or round the
  //: corner of the frame, is not sent to the GPU at all), at its tier; the one you ride -- the bus,
  //: the cab -- and any of yours (``mine``) in full, whatever the rings say, and first in the full
  //: tier's queue (``d`` -1: never pushed down a tier by the cap however far the camera has been
  //: pulled back). Your own car and your party's are drawn apart (makeCar), in full always.
  //: Whether a place is out of your sight: far off, or outside the frame (as last drawn). A car
  //: far behind its day is put back on it only there (fleet.mjs Drivers: hopeless_s).
  //: Whether a car at (x, z) is out of your sight and not about to be in it: beyond 220 m, or
  //: more than a quarter-turn outside the picture (a step turn is a quarter turn). Only such a car
  //: is ever put somewhere it did not drive to.
  const EYE = { x: 0, z: 0, fx: 0, fz: -1, half: 40, ok: false }, EYE_V = new THREE.Vector3();
  function eyeNow() {
    const cam = ctx.camera?.();
    if (!cam) { EYE.ok = false; return EYE; }
    cam.getWorldPosition(EYE_V); EYE.x = EYE_V.x; EYE.z = EYE_V.z;
    cam.getWorldDirection(EYE_V); const m = Math.hypot(EYE_V.x, EYE_V.z) || 1; EYE.fx = EYE_V.x / m; EYE.fz = EYE_V.z / m;
    EYE.half = (Math.atan(Math.tan(((cam.fov || 50) * Math.PI) / 360) * (cam.aspect || 1.6)) * 180) / Math.PI; EYE.ok = true;
    return EYE;
  }
  function unseenAt(x, z) {
    if (!EYE.ok) return false;
    if ((x - EYE.x) ** 2 + (z - EYE.z) ** 2 > 220 * 220) return true;
    return !withinView(EYE, EYE.fx, EYE.fz, x, z, EYE.half, LOCK.cars.margin_deg);
  }
  let standIn = false;
  function carsInView(list) {
    // (For the shadows' stand-in every car that stands still is wanted, in view or not: standIn.)
    const cam = standIn ? null : ctx.camera?.(), out = [];
    if (cam) { cam.getWorldPosition(VIEW_AT); VIEW_PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); CAR_FRUSTUM.setFromProjectionMatrix(VIEW_PV); }
    for (const v of list) {
      const yours = v.id === transit.ride?.vehicle || v.mine === true;
      const detail = yours ? FULL : v.detail ?? (detailNow ? detailNow.tier("cars", v.x, v.z, carTiers.get(v.id)?.tier) : FULL);
      if (detail === TRACKED) continue;
      const [, h, l] = CAR_DIMS[v.model] || CAR_DIMS.sedan;
      if (cam) {
        CAR_SPHERE.center.set(v.x, groundAt(v.x, v.z) + h / 2, v.z); CAR_SPHERE.radius = l / 2 + 0.6;
        if (!CAR_FRUSTUM.intersectsSphere(CAR_SPHERE)) continue;
      }
      out.push({ v, detail, d: yours ? -1 : cam ? (v.x - VIEW_AT.x) ** 2 + (v.z - VIEW_AT.z) ** 2 : 0 });
    }
    return out;
  }
  //: The buses' destination signs (vehicles.mjs BUS_SIGN, drawBusSign): one canvas for each
  //: route and destination, lit (not shaded: an LED sign shows as bright at night), on each bus
  //: that shows it.
  const SIGN_GEO = new THREE.PlaneGeometry(BUS_SIGN.w, BUS_SIGN.h).rotateY(Math.PI);
  const signs = new Map();   // "route|to" -> { mesh, n, text }
  function signOf(sign) {
    const key = `${sign.route}|${sign.to}`;
    if (!signs.has(key)) {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 80;
      const text = drawBusSign(canvas.getContext("2d"), sign, canvas.width, canvas.height);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
      const mesh = instanced(SIGN_GEO, new THREE.MeshBasicMaterial({ map, toneMapped: false }), 16, `city-bus-sign-${sign.route}`);
      mesh.userData.sign = text;
      signs.set(key, { mesh, n: 0, text });
    }
    return signs.get(key);
  }
  const SIGN_M = new THREE.Matrix4();
  // The cars parked at the kerb cast shadows like anything else that stands still: while the
  // shadows' stand-in is drawn (proxy-light.mjs) only they are shown, of everything the city
  // draws -- every one of them, not only those in your view. The next frame draws as ever.
  const standInShown = [];
  globalThis.__kerbsideProxyLight?.captureHooks?.add({
    before() {
      if (!group.parent) return;
      const bodies = new Set([lowCars]);
      for (const f of fleet.values()) for (const part of f.parts) if (!part.mesh.material?.transparent) bodies.add(part.mesh);
      standInShown.length = 0;
      for (const child of group.children) { standInShown.push(child, child.visible); child.visible = child.visible && bodies.has(child); }
      standIn = true;
      try { drawCars(wheels().filter((v) => !v.moving), 0); } finally { standIn = false; }
      group.visible = true;
    },
    after() { for (let i = 0; i < standInShown.length; i += 2) standInShown[i].visible = standInShown[i + 1]; standInShown.length = 0; },
  });
  function drawCars(list, night) {
    let n = 0, heads = 0, tails = 0, lo = 0;
    for (const f of fleet.values()) f.n = 0;
    for (const s of signs.values()) s.n = 0;
    const [full, mid, low] = byTier(carsInView(list), CAR_CAPS);
    carShade.count = 0; carShade.instanceMatrix.needsUpdate = true;
    carShade.material.opacity = 0.5 - 0.3 * (globalThis.__kerbsideProxyLight?.fineK?.value.x || 0);
    drawnTiers.cars = [full.length, mid.length, low.length];
    let drivers = 0;
    if (!standIn) drawNo += 1;
    for (const { v, detail: tier } of [...full, ...mid, ...low]) {
      if (n >= MAX_CARS) break;
      const [w, hgt, l] = CAR_DIMS[v.model] || CAR_DIMS.sedan;
      const f = tier === LOW ? null : fleetOf(v.model, v.shade, tier, v.id === transit.ride?.vehicle || v.mine === true);
      if (f && f.n >= f.cap) continue;
      const y = tier === FULL ? feetNear.at(v, performance.now(), true) : groundAt(v.x, v.z);
      // A car in a crash rocks on its springs; a wreck sits a little down on one side; one on a
      // tow truck's hook has its front lifted (crash-scene.mjs).
      if (v.pitch) Q.setFromEuler(TOW_E.set(v.pitch, v.yaw, 0));
      else { E.set(v.jolt || 0, v.yaw, v.wrecked ? 0.03 : 0); Q.setFromEuler(E); }
      M.compose(V.set(v.x, y + (v.lift || 0), v.z), Q, S3.set(1, 1, 1));
      // Marked by a crash (crash.mjs): its own body, pushed in where it was struck.
      const bent = f && !standIn && v.damage && damageLevel(v.damage) !== "new" ? wreckBody(v.id, f) : null;
      if (bent) { dentBody(bent.g, f.dims || [w, hgt, l], v.damage); bent.g.matrix.copy(M); bent.g.matrixWorldNeedsUpdate = true; bent.seen = drawNo; }
      if (tier !== LOW) shadeAt(carShade, MAX_CARS, v.x, y, v.z, v.yaw, w + 0.7, l + 0.6);
      if (tier !== LOW && !standIn && !v.parked && !v.wrecked && !v.response && !v.bike && v.model !== "bike" && v.mine !== true && drivers < MAX_CARS) {
        const seat = driverSeat(v.model, w, hgt, l), fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), who = hash32(v.vehicle?.owner || v.id);
        // (Left of the way it faces: the kerb, and the doors a bus opens, are on its right.)
        DRIVER_M.makeRotationY(v.yaw).setPosition(v.x + fx * seat.ahead + fz * seat.side, y + seat.up, v.z + fz * seat.ahead - fx * seat.side);
        driverBody.setMatrixAt(drivers, DRIVER_M); driverBody.setColorAt(drivers, DRIVER_C.setHex(DRIVER_CLOTH[who % DRIVER_CLOTH.length]));
        driverHead.setMatrixAt(drivers, DRIVER_M); driverHead.setColorAt(drivers, DRIVER_C.setHex(DRIVER_SKIN[(who >>> 5) % DRIVER_SKIN.length]));
        drivers += 1;
      }
      if (f && !bent) for (const part of f.parts) part.mesh.setMatrixAt(f.n, M);
      // The route and where it is going, over the windscreen (on the fleet's bus; just off the
      // code-built one's nose; the low tier's box has none).
      if (f && v.sign && f.n < f.cap) {
        const s = signOf(v.sign);
        if (s.n < s.mesh.instanceMatrix.count) s.mesh.setMatrixAt(s.n++, SIGN_M.multiplyMatrices(M, TM.makeTranslation(0, f.fleet ? BUS_SIGN.y : hgt - 0.3, f.fleet ? BUS_SIGN.z : -l / 2 - BUS_SIGN.coded_z)));
      }
      if (!f) lowCars.setMatrixAt(lo, M.multiply(TM.makeScale(w, hgt * 0.92, l)));
      // The paint: by its kind's shares of the colours new cars are bought in (vehicles.mjs
      // PAINT_MIX), from its own number; a livery's own (a taxi's, a patrol car's, Muni's silver
      // and red on the bus -- painted by the bus's material, BUS_LIVERY) as it is.
      const paint = f?.livery ? "#ffffff" : v.model === "taxi" ? "#f1c40f" : v.model === "tow_truck" ? "#e8b417" : v.model === "bus" ? BUS_LIVERY.colour : v.model === "patrol" ? (f?.fleet ? PATROL_LIVERY.colour : "#1b2631") : paintOf(v.model, v.shade ?? 0.5);
      C.set(paint);
      // Dented and scraped by its condition: duller, and a wreck scorched.
      if ((v.condition ?? 100) < 85) C.multiplyScalar(0.55 + 0.45 * Math.max(0, v.condition) / 85);
      if (bent) { for (const o of bent.g.children) if (o.userData.tint) { o.setColorAt(0, C); o.instanceColor.needsUpdate = true; } }
      else if (f) { for (const part of f.parts) if (part.tint) part.mesh.setColorAt(f.n, C); f.n += 1; } else { lowCars.setColorAt(lo, C); lo += 1; }
      if (night && f) {
        f.lamps ||= vehicleLampAnchors(THREE, f.parts.filter((p) => !p.mesh.material.transparent).map((p) => p.mesh.geometry), f.dims || [w, hgt, l]);
        B.copy(M);
        for (const lamp of f.lamps) {
          M.multiplyMatrices(B, lamp.matrix);
          // (A front pushed in has no headlamps left to light.)
          if (lamp.head && heads < MAX_CARS * 2 && !((v.damage?.front || 0) >= 0.3)) headLights.setMatrixAt(heads++, M);
          if (!lamp.head && tails < MAX_CARS * 2) tailLights.setMatrixAt(tails++, M);
        }
      }
      n += 1;
    }
    for (const f of fleet.values()) for (const { mesh } of f.parts) {
      mesh.count = f.n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (!standIn) for (const [id, wb] of wreckBodies) if (wb.seen !== drawNo) dropWreck(id);
    for (const s of signs.values()) { s.mesh.count = s.n; s.mesh.instanceMatrix.needsUpdate = true; }
    headLights.count = heads; tailLights.count = tails; headLights.instanceMatrix.needsUpdate = tailLights.instanceMatrix.needsUpdate = true;
    for (const mesh of [driverBody, driverHead]) { mesh.count = drivers; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    drawnTiers.drivers = drivers;
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
  //: Your car (and your party's, and yours where they are parked): always the finest there is,
  //: whatever the traffic's rings say -- its body's full file (vehicles.mjs bodyOf: a bought-in
  //: car or the fleet's, inside and all), else the kit's model. Nothing is drawn until it has
  //: loaded (a few hundred kilobytes; the traffic's copy of it is on the street already).
  function makeCar(model, colour, shade = 0) {
    const [w, h, l] = CAR_DIMS[model] || CAR_DIMS.sedan;
    const body = bodyOf(model, shade);
    const g = new THREE.Group();
    g.userData = { model, dims: [w, h, l], body: `${body.source}:${body.id}` };
    g.name = "city-car";
    const fitKit = async () => {
      const variant = body.source === "kit" ? body.id : kenneyVariant(model, shade);
      await kenneyLoads.get(variant);
      const kit = kenney.get(variant);
      if (!kit || g.userData.bayDisposed) return;
      clearCarBody(g);
      const mesh = importedKitCar(THREE, kit, colour);
      mesh.userData.surface = "car:body";
      g.add(mesh);
      g.userData.variant = variant;
    };
    if (body.source === "car" || body.source === "fleet") modelReady(bodyFile(body, "full")).then((parts) => {
      if (g.userData.bayDisposed) return;
      if (parts) dressFull(g, model, parts, colour); else fitKit();
    });
    else fitKit();
    return g;
  }
  //: ``g``'s body taken off (its materials are its own; the geometry is the shared model's).
  function clearCarBody(g) {
    for (const o of [...g.children]) { o.removeFromParent(); o.material?.dispose?.(); }
  }
  function dressFull(g, model, parts, colour) {
    clearCarBody(g);
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, fleetMaterial(THREE, part, { standard: true, livery: model === "bus" ? BUS_LIVERY : model === "patrol" ? PATROL_LIVERY : null }), 1);
      mesh.setMatrixAt(0, M.identity());
      if (part.tint) mesh.setColorAt(0, C.set(colour));
      mesh.castShadow = !part.glass; mesh.receiveShadow = true; mesh.frustumCulled = false;
      if (part.glass) mesh.renderOrder = 2;
      mesh.name = `city-car-${part.name}`;
      mesh.userData.surface = carSurface(part.name);
      g.add(mesh);
    }
    g.userData.full = true;
  }
  // ---- a body a crash has marked (crash.mjs) ------------------------------------------------------
  //: The marks on the paint: laid over the body, a hair proud of it, as much of them showing at
  //: each corner as the damage says (the colour's fourth number).
  const SCUFF_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const bentGeometries = new Map();   // a part's geometry + the damage -> { geo, marks, own, n (bodies using it) }
  function bentOf(geometry, dims, damage, mark) {
    const key = `${geometry.uuid}|${dims.join(",")}|${damageKey(damage)}|${mark ? 1 : 0}`;
    let e = bentGeometries.get(key);
    if (!e) {
      const src = geometry.attributes.position;
      const flat = src.array instanceof Float32Array && !src.isInterleavedBufferAttribute && src.array.length === src.count * 3 ? src.array : Float32Array.from({ length: src.count * 3 }, (_, i) => src.getComponent(Math.floor(i / 3), i % 3));
      const moved = crumple(flat, dims, damage);
      let geo = geometry;
      if (moved !== flat) {
        geo = new THREE.BufferGeometry();
        for (const [name, at] of Object.entries(geometry.attributes)) if (name !== "position" && name !== "normal") geo.setAttribute(name, at);
        geo.setAttribute("position", new THREE.BufferAttribute(moved, 3));
        if (geometry.index) geo.setIndex(geometry.index);
        for (const part of geometry.groups) geo.addGroup(part.start, part.count, part.materialIndex);
        geo.computeVertexNormals(); geo.computeBoundingSphere();
      }
      let marks = null;
      const rgba = mark ? scuff(flat, dims, damage) : null;
      if (rgba) {
        marks = new THREE.BufferGeometry();
        marks.setAttribute("position", geo.attributes.position);
        if (geo.attributes.normal) marks.setAttribute("normal", geo.attributes.normal);
        marks.setAttribute("color", new THREE.BufferAttribute(rgba, 4));
        if (geo.index) marks.setIndex(geo.index);
      }
      e = { geo, marks, own: geo !== geometry, n: 0 };
      bentGeometries.set(key, e);
    }
    return { key, e };
  }
  function releaseBent(keys) {
    for (const k of keys || []) {
      const e = bentGeometries.get(k);
      if (!e || --e.n > 0) continue;
      if (e.own) e.geo.dispose();
      e.marks?.dispose();
      bentGeometries.delete(k);
    }
  }
  //: ``g``'s parts (one car's meshes, in the car's own frame) drawn as ``damage`` leaves them:
  //: each part's shape pushed in where it was struck, the marks laid over the paint. Whole again
  //: when the damage is gone. Done once for each state the car is in, not every frame.
  function dentBody(g, dims, damage) {
    const key = damageLevel(damage) === "new" ? "" : damageKey(damage);
    const parts = g.children.filter((o) => !o.userData.scuff).length;
    if ((g.userData.dent || "") === key && g.userData.dentParts === parts) return;
    for (const o of [...g.children]) {
      if (o.userData.scuff) { o.removeFromParent(); continue; }
      if (o.userData.whole) { o.geometry = o.userData.whole; delete o.userData.whole; }
    }
    releaseBent(g.userData.bent); g.userData.bent = [];
    if (key) for (const o of [...g.children]) {
      if (!o.isMesh || !o.geometry?.attributes?.position) continue;
      const { key: k, e } = bentOf(o.geometry, dims, damage, !o.material?.transparent);
      e.n += 1; g.userData.bent.push(k);
      if (e.own) { o.userData.whole = o.geometry; o.geometry = e.geo; }
      if (e.marks) { const m = new THREE.Mesh(e.marks, SCUFF_MAT); m.userData.scuff = true; m.renderOrder = 1; m.frustumCulled = false; m.name = "city-car-marks"; g.add(m); }
    }
    g.userData.dent = key; g.userData.dentParts = parts;
  }
  //: One of the traffic's cars that a crash has marked: drawn on its own (its body's parts, each
  //: its own shape now), not as one of the many. Made when it is first drawn so, kept while it is.
  const wreckBodies = new Map();   // car id -> { g, f (the fleet it is one of), seen (the draw it was last in) }
  let drawNo = 0;
  const IDENT = new THREE.Matrix4();
  function wreckBody(id, f) {
    let w = wreckBodies.get(id);
    if (w && w.f !== f) { dropWreck(id); w = null; }
    if (!w) {
      const g = new THREE.Group(); g.matrixAutoUpdate = false; g.name = "city-wreck";
      for (const part of f.parts) {
        const mesh = new THREE.InstancedMesh(part.mesh.geometry, part.mesh.material, 1);
        mesh.setMatrixAt(0, IDENT); mesh.castShadow = part.mesh.castShadow; mesh.frustumCulled = false; mesh.renderOrder = part.mesh.renderOrder;
        mesh.userData.tint = Boolean(part.tint); mesh.userData.surface = part.mesh.userData.surface;
        g.add(mesh);
      }
      group.add(g);
      wreckBodies.set(id, w = { g, f, seen: 0 });
    }
    return w;
  }
  function dropWreck(id) {
    const w = wreckBodies.get(id);
    if (!w) return;
    releaseBent(w.g.userData.bent);
    for (const o of w.g.children) if (o.isInstancedMesh) o.dispose();
    w.g.removeFromParent(); wreckBodies.delete(id);
  }
  const TOW_E = new THREE.Euler(0, 0, 0, "YXZ");
  const parked = new Map();     // vehicle id -> mesh (your cars where they stand)
  const peerCars = new Map();   // peer id -> mesh

  // ---- the books: the city server's; a practice world of your own only when it cannot be reached --
  // The city is one world, kept by its server (server/city, at /api/city): this page signs in
  // with the device's account, sends the actions you take, and is shown your part of it. It
  // holds no books while connected, and nothing saved here is ever brought into the city. A
  // party is who you see walking beside you -- not a separate economy, and nobody's browser is
  // its host. The city the server keeps is City mode's (the Marina: the places it has a record
  // of). Outside it -- Explore, where only the people and traffic are out -- and where the
  // server cannot be reached (a development page, a deploy not yet set up), the books are an
  // offline practice world of this browser's own, said so in the panel.
  const party = { session: null, unlisten: null, ids: new Map() };
  //: state: "off" (practice, by where you are), "connecting", "online", "practice" (the server did not answer).
  const online = { client: null, state: "off", why: "you are exploring", version: 0, lastSync: 0, syncing: false, retry: 0, live: null, heard: 0, syncAt: 0 };
  //: Hearing of each new version of the city as it is committed (live.mjs): asked for then, not
  //: every few seconds. Stopped with the connection it was for.
  function listenLive(info) {
    online.live?.close(); online.live = null; online.heard = 0; online.syncAt = 0;
    if (!info) return;
    online.live = cityLive({ ...info, onVersion: (v) => {
      online.heard = Math.max(online.heard, v);
      const at = syncPlan({ heard: online.heard, have: online.version, lastAsked: online.lastSync, now: performance.now() });
      if (at !== null && (!online.syncAt || at < online.syncAt)) online.syncAt = at;
    } });
  }
  //: Whether to ask the server now: when told of a version not yet had, or, with nothing heard,
  //: every SYNC_LIVE_MS while listening (SYNC_MS while not).
  function syncDue(now) {
    if (online.syncAt && now >= online.syncAt) return true;
    return now - online.lastSync > (online.live?.state() === "live" ? SYNC_LIVE_MS : SYNC_MS);
  }
  const SERVER_URL = cityServerUrl(globalThis.location);
  const wantOnline = () => Boolean(SERVER_URL && ctx.cityMode?.());
  let world = null;     // the offline practice world (this browser's own; never the city's)
  let view = null;      // the world as shown: the server's view of it for you, or the practice world
  function loadSolo() {
    const saved = store.get(SAVE_SOLO);
    try { if (saved) return CityWorld.fromJSON(R, saved); } catch (error) { console.warn("kerbside: the saved practice city could not be read", error); }
    return new CityWorld(R, { now: gameNow(), seed: "solo" });
  }
  // Businesses, the law and careers: their panels (enterprise-panels.mjs), made on first use.
  let enterpriseUI = null, messagesUI = null, commerceUI = null;
  //: The messages strip at the side of the screen (messages-panel.mjs): players, NPCs, the city.
  const messages = () => (messagesUI ||= messagesPanel({ goToCourt: (id) => court.enter(id), talk: (body) => talk(body), talkBox: (...a) => finance().talkBox(...a), R, h, send, notify, me: () => myId, getView: () => view, placeArg,
    peers: () => (party.session?.players() || []).map((peer) => ({ pid: party.ids.get(peer.id), name: peer.name })),
    courtPlace: () => enterprise().courtPlace?.() }));
  const commerce = () => (commerceUI ||= commercePanels({ R, h, notify, send, self, me, getView: () => view, placeArg, nearestPlace, openSide, drawSide, getSide: () => side,
    people: () => visible.people, peers: () => (party.session?.players() || []).map((peer) => ({ pid: party.ids.get(peer.id), name: peer.name })).filter((x) => x.pid && x.pid !== myId),
    openMessages: () => messages().open?.("npc"), syncSlots }));
  // Animals (animals-view.mjs): your pets, the neighbourhood's dogs and cats, the birds, the rats.
  let animalsUI = null, eatingPlaces = null;
  const animals = () => (animalsUI ||= animalsView({ R, THREE, add: (m) => group.add(m), loadModel: ctx.loadModel, asset: ctx.asset, h, act, send, notify, self, me, getYaw: () => ctx.getYaw(), car, groundAt,
    blocked: (x, z, r) => walkerBlocked(x, z, r), onRoad: (x, z) => Boolean(ctx.onRoad?.(x, z)), vehicles: () => visible.vehicles, people: () => visible.people, places: () => district.places,
    gameHour, wet: wetNow, camera: () => { const c = ctx.camera?.(); return c?.position ? { x: c.position.x, z: c.position.z } : me(); },
    waterAt: (x, z) => Boolean(ctx.waterAt?.(x, z)), placeArg, noteIncident, drawSide: () => drawSide(),
    // Where the birds sit up off the street: the street lights the map has (module 21, through 30).
    perches: (x, z, reach) => ctx.perches?.(x, z, reach) || [],
    threats: () => incidents.filter((i) => i.kind === "fight" && performance.now() - i.t0 < 12000),
    // What a cell of the birds' field is like: water near, eating places near.
    whatAt: (x, z) => {
      eatingPlaces ||= district.places.filter((p) => p.keys.has("shop:restaurant") || p.keys.has("shop:cafe") || p.keys.has("shop:bakery") || p.keys.has("shop:grocery"));
      let shops = 0; for (const p of eatingPlaces) if (Math.abs(p.x - x) < 60 && Math.abs(p.z - z) < 60) shops += 1;
      let water = null; for (const [dx, dz, d] of [[0, 0, 0], [90, 0, 90], [-90, 0, 90], [0, 90, 90], [0, -90, 90], [180, 0, 180], [-180, 0, 180], [0, 180, 180], [0, -180, 180]]) if (ctx.waterAt?.(x + dx, z + dz)) { water = d; break; }
      return { shops, water, park: false };
    } }));
  const enterprise = () => (enterpriseUI ||= enterprisePanels({ goToCourt: (id) => court.enter(id), R, h, act, notify, send, self, me, getView: () => view, ctx, district, address, placeArg,
    openSide, closeSide, drawSide, getSide: () => side, editInterior: editHome, todoReset: () => { todoKey = ""; drawTodo(); }, books: (...a) => finance().books(...a),
    openKitchen: (place) => { const pl = (district.places || []).find((x) => String(x.id) === String(place.id)); if (pl) { closeSide(); kitchen().open(pl); } else notify("Go to the restaurant to open its kitchen."); } }));
  let bayUI = null;
  const workshop = () => (bayUI ||= workshopPanel({ R, h, doc, THREE, send, notify, self, getView: () => view, makeCar,
    visitors: place => visitingCars(visible.people, district.city, fleetAt(Date.now()), place, !world), placeArg }));
  //: A food shop's line, lab and pantry, for its staff and its owner.
  let kitchenUI = null;
  const kitchen = () => (kitchenUI ||= kitchenPanel({ R, h, send, notify, self, getView: () => view, placeArg, district, me, clock: CLOCK, address, doc, THREE, loadModel: ctx.loadModel, asset: ctx.asset, npcStore: ctx.npcStore }));

  // ---- the person serving: walk up to them and they ask what you want (clerk.mjs) --------------
  // In a shop, a café or a restaurant there is no buy button: whoever is at work there -- the host
  // at a fine restaurant's stand, the cashier, the shop's clerk -- greets you as you come up to
  // them, the way such a place does, and their line has a link: the menu, or the shop's wares,
  // opened in the middle of the screen (shop-window.mjs).
  let shopWin = null;
  const clerk = { place: null, id: null, el: null, visits: 0, at: null };
  const menuNumber = (x) => { const v = x / R.money(1); return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ""); };
  async function buyHere(lines, meal) {
    const place = clerk.place;
    if (!place) return { ok: false, error: "walk up to the counter first" };
    const r = await send("checkout", { place, cart: lines });
    if (!r.ok) return r;
    notify(`${meal ? "Ordered" : "Paid"} ${R.fmt(r.total)}${r.tax ? ` (${R.fmt(r.tax)} of it tax)` : ""}: ${r.lines.map((l) => `${l.qty} × ${R.items[l.item].name.toLowerCase()}`).join(", ")}.${meal ? " It's brought to you; it's in your inventory (I)." : " In your inventory (I)."}`);
    syncSlots(true);
    return r;
  }
  // Shopping in person (shop-floor.mjs, shopping.mjs): the shelves' products taken into a basket and
  // paid for at a till; and the favours the city's people do you (favour-run.mjs).
  const floor = shopFloor({ THREE, R, send, notify, getView: () => view, self: () => self(), kit, sync: (now) => syncSlots(now) });
  const favours = favourRun({ send, notify, inCar: () => Boolean(car.active), onLift: (job) => { taxi.lift = job.name; notify(`${job.name.split(" ")[0]} will give you a lift: choose where to (Taxi), and it's their car that comes, no fare.`); openSide("ride"); } });
  const gameHour = () => { const t = fleetAt(Date.now()); return ((t.gameMinute ?? t.minute) / 60) % 24; };
  // A fitted interior's shelves and tills are drawn when it is (the hooks below), not when you go in:
  // kept a while, and given to the floor when you are inside.
  const fittedDrawn = [];
  function fittedFloor() {
    const place = ctx.insideFitted?.() && placeInside();
    if (!place) { if (floor.active() && !shop.place) floor.close(); return; }
    if (floor.active()) return;
    floor.fitted(place);
    for (let k = fittedDrawn.length - 1; k >= 0; k -= 1) {
      const f = fittedDrawn[k];
      if (!f.obj.parent) { fittedDrawn.splice(k, 1); continue; }
      f.obj.updateWorldMatrix(true, false);
      const e = f.obj.matrixWorld.elements;
      if (Math.hypot(e[12] - place.x, e[14] - place.z) > 70) continue;
      if (f.till) floor.till(f.obj, f.till); else floor.stocked(f.sku, f.stock, f.list, f.have, f.obj);
    }
  }
  const shopWindowUI = () => (shopWin ||= shopWindow({ h, doc, fmt: (x) => R.fmt(x), price: menuNumber, order: (lines) => buyHere(lines, true), checkout: (lines) => buyHere(lines, false) }));
  //: The shop you are in: its room (enterShop) or its fitted interior.
  function placeInside() {
    if (shop.place) return shop.place;
    const id = ctx.insideFitted?.();
    return id ? district.placeById?.get(id) || district.placeById?.get(Number(id)) || null : null;
  }
  // A dish's line on a menu where the menu has none: what it is made of ("beef patty, lettuce,
  // tomato and pickles on a toasted bun, with fries").
  function dishLine(rec) {
    if (!rec?.build?.length) return null;
    const I = R.kitchen.ingredients, nm = (c) => (I[c.ing]?.name || c.ing).toLowerCase();
    const main = rec.build.filter((c) => !c.side && !["salt", "water", "ice"].includes(c.ing)), side = rec.build.filter((c) => c.side && c.ing !== "salt");
    const names = [...new Set(main.map(nm))];
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "";
    // (Potatoes fried on the side are fries.)
    const sides = [...new Set(side.map((c) => (c.ing === "potato" && /fry/.test(c.p) ? "fries" : nm(c))))];
    return `${list.charAt(0).toUpperCase()}${list.slice(1)}${sides.length ? `, with ${sides.join(" and ")}` : ""}`;
  }
  function dishSection(id, rec) {
    const it = R.items[id];
    if (!rec) return it?.kind === "drink" ? "Drinks" : "Other";
    if (rec.vessel === "cup" || rec.vessel === "glass") return /beer|wine/.test(id) ? "Beer and wine" : "Drinks";
    const I = R.kitchen.ingredients, tags = rec.build.flatMap((c) => I[c.ing]?.tags || []);
    if (tags.filter((t) => t === "dessert").length * 2 >= rec.build.length) return "Desserts";
    return (R.items[id]?.price || 0) < R.money(8) ? "Sides" : "Mains";
  }
  //: What the link opens: the menu (a restaurant's, café's or bar's) or the shop's wares.
  function windowSpec(place, line) {
    const w = view, stores = w?.storesHere ? w.storesHere(place) : storesAt(R, place.keys);
    const kk = w?.kitchenKind?.(place), own = kk ? R.stores.kinds[kk] : null;
    const title = (w?.bizAt?.(place.id)?.name) || place.name && !/^\d/.test(place.name) && place.name || own?.name || stores[0]?.name || "The shop";
    const priceOf = (id) => (w?.priceAt ? w.priceAt(place, id) : R.items[id].price);
    let ids = [...new Set(stores.flatMap((st) => st.items))].filter((id) => R.items[id] && !R.items[id].service && !R.items[id].parcel);
    if (line.link.kind === "counter") ids = counterOnly(place);
    if (line.link.kind === "menu") {
      const k = w?.kitchens?.get?.(String(place.id)), own = new Map((k?.menu || []).map((d) => [d.id, d]));
      const items = ids.map((id) => {
        const d = own.get(id), rec = recipeOf(R, id, k?.menu || []);
        return { id, name: R.items[id].name, description: d?.description || dishLine(rec), price: priceOf(id), section: d?.section || dishSection(id, rec), photo: d?.photo || R.items[id].photo || null };
      });
      return { kind: "menu", style: line.link.style, title, subtitle: k?.real ? "The restaurant's own menu" : place.name ? address(place.name) : null, items };
    }
    const [lon, lat] = ctx.toLonLat(place.x, place.z), chain = jurisdictionAt(R, lon, lat, district.county).chain;
    const items = ids.map((id) => { const it = R.items[id]; return { id, name: it.name, info: effectText(it), price: priceOf(id), tax: itemTax(R, chain, it, priceOf(id), w?.laws), photo: it.photo || null }; });
    const categories = stores.length > 1 ? stores.map((st) => ({ id: st.kind, name: st.name, items: st.items })) : [];
    return { kind: "shop", title, subtitle: place.name ? address(place.name) : null, items, categories };
  }
  function hideClerk() { clerk.el?.remove(); clerk.el = null; clerk.id = null; }
  //: What a walk-round shop sells that is on none of its shelves (no model to stand there): sold
  //: from behind the counter.
  function counterOnly(place) {
    const stores = view?.storesHere ? view.storesHere(place) : storesAt(R, place.keys);
    return [...new Set(stores.flatMap((st) => st.items))].filter((id) => R.items[id] && !R.items[id].service && !R.items[id].parcel && !floor.has(id));
  }
  //: What whoever serves at ``place`` says to you (clerk.mjs), with its link.
  function clerkLineFor(place, e) {
    const st = storesAt(R, place.keys)[0];
    const kind = view?.kitchenKind?.(place) || st?.kind;
    const style = view?.kitchenKind?.(place) ? restaurantService(R, kind, view?.bizAt?.(place.id), view?.kitchens?.get?.(String(place.id)))?.style : null;
    const tt = fleetAt(Date.now());
    const walked = floor.active() && floor.counterItems() > 0 && !view?.kitchenKind?.(place);
    const behind = walked ? counterOnly(place).length > 0 : false;
    return clerkLine({ storeKind: kind || st?.kind, serviceStyle: style, name: (view?.bizAt?.(place.id)?.name) || (place.name && !/^\d/.test(place.name) ? place.name : null), hour: (tt.gameMinute ?? tt.minute) / 60, staffName: e.person.name, visit: clerk.visits, place: place.id, floor: walked, counter: behind });
  }
  //: Someone who works here clicked (staffClicked): they have come over, and the messages open with
  //: them asking what you need -- a waiter's or a cashier's line carries the menu or the wares, and
  //: ordering from it is the same as at the counter.
  function staffArrived(place, e) {
    clerk.place = place;
    const line = clerkLineFor(place, e);
    const said = /help|get you|look(ing)? for|what can/i.test(line.text) ? line.text : `Hi, can I help you? ${line.text}`;
    const parts = lineParts(said).map((x) => (typeof x === "string" ? x : { link: x.link, run: () => shopWindowUI().open(windowSpec(place, line)) }));
    messages().npc({ id: e.person.id, name: e.person.name, title: line.who ? line.who.charAt(0).toUpperCase() + line.who.slice(1) : e.person.title, role: "resident", tone: "warm" }, {}, { opening: parts });
  }
  function showClerk(place, e) {
    hideClerk();
    const line = clerkLineFor(place, e);
    if (!String(e.person.id).startsWith("counter:")) talkTo({ id: e.person.id, name: e.person.name, title: e.person.title });
    const parts = lineParts(line.text).map((x) => (typeof x === "string" ? x : h("a", { href: "#", textContent: x.link, onclick: (ev) => { ev.preventDefault(); shopWindowUI().open(windowSpec(place, line)); } })));
    clerk.el = h("div", { id: "city-clerk", className: "glass", role: "dialog", "aria-label": `${e.person.name}, the ${line.who}` },
      h("b", { textContent: `${e.person.name.split(" ")[0]}, the ${line.who}` }), h("p", {}, ...parts),
      h("button", { textContent: "×", title: "Not now", onclick: () => { clerk.dismissed = e.id; hideClerk(); } }));
    doc.body.append(clerk.el);
    clerk.id = e.id; clerk.at = { x: e.x, z: e.z };
  }
  //: Whether someone serving is in front of you (half a second at a time): they greet you once as
  //: you come up, and the line goes as you walk off.
  function clerkCheck() {
    fittedFloor();
    const place = placeInside();
    if (!place || !storesAt(R, place.keys).length || isMyWorkplace(place) || view?.bizAt?.(place.id)?.owner === self()?.account) { hideClerk(); clerk.place = null; return; }
    if (clerk.place?.id !== place.id) { clerk.place = place; clerk.visits += 1; clerk.dismissed = null; hideClerk(); }
    const here = me();
    if (clerk.el && clerk.at && Math.hypot(here.x - clerk.at.x, here.z - clerk.at.z) > 4) { hideClerk(); clerk.dismissed = null; }
    if (clerk.el) return;
    const e = clerkNear(visible.people, place.id, here.x, here.z, 2.6);
    if (e) { if (clerk.dismissed !== e.id) showClerk(place, e); return; }
    // Nobody of the shop's own drawn there (none of the district's people works it, or not on
    // this shift): whoever is behind its counter greets you at the till, the host's stand or the
    // counter, so a shop is never one you cannot buy from.
    const at = counterPoint();
    if (at && Math.hypot(here.x - at.x, here.z - at.z) < 2.4 && clerk.dismissed !== `counter:${place.id}` && !clerkNear(visible.people, place.id, at.x, at.z, 8)) {
      const name = `${FIRST_NAMES[hash32(String(place.id), "counter") % FIRST_NAMES.length]} ${"ABCDEFGHJKLMNPRSTW"[hash32(String(place.id), "initial") % 18]}.`;
      showClerk(place, { id: `counter:${place.id}`, x: at.x, z: at.z, person: { id: `counter:${place.id}`, name, title: "Staff" } });
    }
  }
  const FIRST_NAMES = ["Maya", "Luis", "Priya", "Sam", "Ana", "Kenji", "Rosa", "Omar", "Jess", "Theo", "Nina", "Marco", "Lena", "Ravi", "Chloe", "Diego"];
  //: Where a customer is served in the shop you are in: in front of a restaurant's host stand or
  //: counter, a shop's till, a plain room's counter. Null in a fitted interior.
  function counterPoint() {
    const F = shop.frame;
    if (!F) return null;
    const plan = F.restaurant || F.store;
    if (plan) {
      const lane = plan.fixtures?.find((x) => x.role === "checkout");
      if (lane) { const p = lanePoints(lane).shopper; return F.at(p.z, p.x); }
      const f = plan.fixtures?.find((x) => x.role === "host") || plan.fixtures?.find((x) => x.role === "counter" || x.role === "till" || x.role === "bar");
      if (f) return F.at(Math.max(0.4, f.z - f.d / 2 - 0.45), f.x);
    }
    return F.at(Math.max(0.4, F.L.counter - 0.5), F.L.width * 0.5);
  }

  // ---- a chair: click it to sit down; walk to get up -------------------------------------------------
  const seated = { on: false, x: 0, z: 0, floor: null };
  const SEAT_DROP_M = 0.45;
  //: The seat nearest the click's ray (within a hand's width of it, not across the room): the
  //: restaurant's chairs and booths (restaurant-scene.mjs ``seats``), or a fitted interior's
  //: chairs, stools, sofas, booths and banquettes (inferred-interiors/renderer.mjs ``furnishing:``).
  const SEAT_ROLES = /^(dining_chair|office_chair|bar_stool|stool|chair|armchair|sofa|booth|banquette|bench|seat)$/;
  const seatPt = new THREE.Vector3();
  function seatClicked(ray) {
    const cands = [];
    const room = shop.room;
    for (const st of court.seats()) cands.push(st);   // (the courthouse's chairs and pews)
    room?.updateMatrixWorld(true);
    room?.traverse((o) => { for (const st of o.userData?.seats || []) { seatPt.set(st.x, st.y, st.z); o.localToWorld(seatPt); const q = new THREE.Vector3(st.x, st.y, st.z - 1); o.localToWorld(q); cands.push({ x: seatPt.x, y: seatPt.y, z: seatPt.z, yaw: Math.atan2(-(q.x - seatPt.x), -(q.z - seatPt.z)), floor: shop.frame?.y }); } });
    if (!room && ctx.insideFitted?.()) {
      const here = me();
      ctx.root?.traverse?.((o) => {
        const sf = o.userData?.surface;
        if (typeof sf !== "string" || !sf.startsWith("furnishing:") || !SEAT_ROLES.test(sf.slice(11))) return;
        o.getWorldPosition(seatPt);
        if (Math.hypot(seatPt.x - here.x, seatPt.z - here.z) > 14) return;
        // The seat faces its front (+z of the piece: its back is at -z), the way a sitter looks.
        const q = new THREE.Vector3(0, 0, 1); o.localToWorld(q);
        const h0 = o.userData.role === "bar_stool" ? 0.72 : 0.46;
        cands.push({ x: seatPt.x, y: seatPt.y + h0, z: seatPt.z, yaw: Math.atan2(-(q.x - seatPt.x), -(q.z - seatPt.z)), floor: seatPt.y });
      });
    }
    let best = null, bd = Infinity;
    for (const c of cands) {
      seatPt.set(c.x, c.y, c.z);
      const along = seatPt.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      if (along < 0 || along > 9 || ray.ray.distanceSqToPoint(seatPt) > 0.45 * 0.45) continue;
      if (along < bd) { bd = along; best = c; }
    }
    return best;
  }
  // (Up again where you stood to sit: a seat is inside its table's bounds, which the walk keeps out of.)
  const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);
  const onSeatKey = (e) => { if (seated.on && MOVE_KEYS.has(e.code)) standUp(); };
  function sitAt(c) {
    const floor = Number.isFinite(c.floor) ? c.floor : me().y - ctx.standY;
    if (!seated.on) seated.from = { x: me().x, z: me().z, y: me().y - ctx.standY };
    seated.on = true; seated.x = c.x; seated.z = c.z; seated.floor = floor; seated.wasFloor = shop.frame ? shop.frame.y : null;
    doc.addEventListener("keydown", onSeatKey, true);
    ctx.firstPerson?.(true);
    ctx.placeAvatar(c.x, floor, c.z, c.yaw);
    // The eyes at a sitter's height: the floor the eye is set from, lowered by the seat's drop.
    ctx.setFloor?.(floor - SEAT_DROP_M);
    ctx.setPitch?.(-0.12);
    ctx.animateWalk?.(0);
    notify("Sitting down. Walk to get up.");
  }
  function standUp() {
    if (!seated.on) return;
    seated.on = false;
    doc.removeEventListener("keydown", onSeatKey, true);
    ctx.setFloor?.(seated.wasFloor);
    const back = seated.from;
    if (back) ctx.placeAvatar(back.x, shop.frame ? shop.frame.y : back.y, back.z);
    ctx.setPitch?.(-0.06);
  }
  //: Up as soon as you walk (or are moved) off the seat.
  function stepSeat() { if (seated.on && Math.hypot(me().x - seated.x, me().z - seated.z) > 0.12) standUp(); }
  //: Money: the bank's desks, your credit, the online lender, a business's books, talking (finance-panels.mjs).
  let financeUI = null;
  const finance = () => (financeUI ||= financePanels({ R, h, act, notify, send, self, getView: () => view, placeArg, address, openSide, drawSide, getSide: () => side, talk, onTalk: (who) => talkTo(who), askFavour: (who, kind, o) => askFavour(who, kind, o) }));
  //: Asking someone you are talking with for a hand (npc-favours.mjs): what they are on their way
  //: to, from their day, and the world weighs it; a yes is begun here (favour-run.mjs).
  async function askFavour(who, kind, { offer = 0 } = {}) {
    const e = (visible.people || []).find((x) => x.id === who.id || x.person?.id === who.id), person = e?.person, tt = fleetAt(Date.now());
    let on = { kind: "idle", spare: 60 };
    try { const plan = person && district.city?.planOf?.(person, tt); if (plan) on = onTheirWay(plan, tt.minute); } catch { /* their day not to hand: free */ }
    const r = await send("ask_favour", { npc: { id: who.id, name: who.name, age: person?.age, role: person?.role || person?.base?.role, wage: person?.wage }, kind, on, offer });
    if (r.ok && r.verdict === "help" && r.favour) {
      talking.until = 0;
      favours.start(r.favour, e ? { x: e.x, z: e.z, yaw: e.yaw } : me(), { ...me(), yaw: ctx.getYaw() });
      refresh();
    }
    return r;
  }
  let profileUI = null;
  const profile = () => (profileUI ||= profilePanel({ R, h, act, row, send, notify, me, district, address, wealthOf, portrait, finance, openSide, getSide: () => side, drawSide,
    legacy: TABS, crossAt, editHome, redraw: () => refresh(), close: () => { if (panel) openPanel(); },
    // Your pets, as the Pets panel draws them (animals-view.mjs), for Family on Relationships.
    family: () => { const p = view?.players.get(myId); if (!p) return []; const el = h("div", { className: "pets" }); const fake = { kind: "pets", el }; try { animals().draw(fake, { close: null, status: null, p }); } catch (error) { console.warn("pets", error); return []; } return [...el.childNodes].filter((n) => n.tagName !== "H3"); },
    peers: () => (party.session?.players() || []).map((peer) => ({ pid: party.ids.get(peer.id), name: peer.name })).filter((x) => x.pid && x.pid !== myId) }));
  //: Something said to one of the city's people: the server's answer, or null when there is no server to ask (the box answers with a set line).
  async function talk(body) { return online.state === "online" && online.client?.talk ? online.client.talk(body) : null; }
  const worldKey = () => (world ? SAVE_SOLO : "kerbside:city:server");
  function syncHomeEditor() {
    const p = view?.players.get(myId);
    if (!p) return;
    ctx.setHomeInteriorAccess?.({ worldKey: worldKey(), account: p.account,
      homes: view.registry.owned(p.account, "home").map(a => ({id: a.id, buildingId: String(a.attrs.building), unitId: a.attrs.interior_unit_id || null, label: a.attrs.address || "Your home", type: a.attrs.type})).concat([...(view.biz?.values()||[])].filter(b=>b.owner===p.account&&b.status==='open').map(b=>({id:b.id,buildingId:String(b.place.id),propertyKind:'business',businessKind:b.kind,label:b.name,type:b.kind}))),
      designs: [...(view.homeInteriors?.values() || []),...(view.businessInteriors?.values()||[])] });
  }
  async function editHome(homeId) {
    syncHomeEditor();
    try { await ctx.editHome?.(homeId); } catch (error) { notify(error.message); }
  }

  //: Only the practice world is saved here; the city is saved by its server.
  function save() { if (world) store.set(SAVE_SOLO, world.toJSON()); }
  //: The server's answer shown: your part of the world as it now is.
  function shown(r) {
    if (!r?.state || (r.version || 0) < online.version) return;
    online.version = r.version || online.version;
    try { view = CityWorld.fromJSON(R, r.state); } catch (error) { console.warn("kerbside: the city's state could not be read", error); return; }
    refresh();
  }
  //: A command as the player: asked of the city's server, which decides it; in the practice
  //: world, done here.
  async function send(command, args = {}) {
    const full = { ...args, at: whereNow() };
    if (world) { const r = world.submit(myId, command, full); if (r.ok && ["customize_home","customize_business"].includes(command)) save(); refresh(); return r; }
    if (online.state !== "online") return { ok: false, error: "Connecting to the city…" };
    const r = await online.client.send(command, full);
    if (!r.ok) return { ok: false, error: r.error || "the city's server did not answer" };
    shown(r);
    return r.result || { ok: false, error: "the city's server did not answer" };
  }
  //: What others have done since: asked every few seconds (the answer is empty when nothing has).
  async function syncCity() {
    if (online.state !== "online" || online.syncing) return;
    online.syncing = true; online.lastSync = performance.now(); online.syncAt = 0;
    try {
      const r = await online.client.sync(online.version);
      if (r.ok) shown(r);
      if (r.ok && r.welcome_moved) notify(`${r.welcome_moved.name} has moved to a real restaurant: ${address(r.welcome_moved.place) || "its new address"}. Its till came with it; order its stock again.`);
    } finally {
      online.syncing = false;
      // (Answered by an instance that had not yet seen the version heard of: asked again shortly.)
      if (online.heard > online.version) online.syncAt = syncPlan({ heard: online.heard, have: online.version, lastAsked: online.lastSync, now: performance.now() }) ?? 0;
    }
  }
  //: The practice world: this browser's own, under its own id.
  function practice(state, why) {
    listenLive(null);
    online.state = state; online.why = why; online.retry = performance.now();
    myId = localId;
    if (!world) {
      world = loadSolo(); view = world;
      // (A clock held when the page was last left is still held: the same hour to test against.)
      restoreClockHold(store.get(SAVE_HOLD)); if (district.city) district.city.timeFor = clockHeld() ? timeFor : null;
    }
    refresh();
    ensureJoined();
  }
  //: Signing in to the city (on entering City mode). Not reachable: the practice world, and
  //: another try every minute while you are there.
  async function connectCity() {
    const generation=(online.connectionGeneration||0)+1;online.connectionGeneration=generation;
    online.state = "connecting"; online.why = "";
    if (world) save();
    world = null; view = null;
    // (The city's clock is its server's: nothing of a practice game's hold is carried into it.)
    restoreClockHold(null); if (district.city) district.city.timeFor = null;
    const lib = await Promise.resolve(ctx.account?.()).catch(() => null);
    if(lib?.onAccountChange&&!online.accountWatch){let identity=lib.account?.().accountId||null;online.accountWatch=lib.onAccountChange(profile=>{const next=profile.accountId||null;if(next!==identity){identity=next;if(wantOnline())connectCity();}});}
    if(generation!==online.connectionGeneration)return;
    const key = lib?.deviceKey?.();
    if (!key) { practice("practice", "this device has no account"); return; }
    const client = cityClient({ url: SERVER_URL, key });
    online.client = client;
    const r = await client.open();
    if (online.state !== "connecting"||generation!==online.connectionGeneration) return;   // Explore again while it was asked
    if (!r.ok) { practice("practice", r.code === "not_configured" ? "the city's server is not set up yet" : r.error || "the city's server could not be reached"); return; }
    myId = r.pid; online.state = "online"; online.version = 0; online.since = performance.now(); grantsAsked = false;
    listenLive(client.live);
    if (party.session) party.session.city.send({ t: "hello", pid: myId });
    await syncCity();
    ensureJoined();
  }
  //: Each frame: the server's books in City mode, the practice world's anywhere else.
  function chooseBooks() {
    if (wantOnline()) {
      if (online.state === "off" || (online.state === "practice" && performance.now() - online.retry > 60_000)) connectCity();
    } else if (online.state !== "off") {
      practice("off", SERVER_URL ? "you are exploring" : "this page has no city server");
    }
  }
  // Until the first frame chooses: the practice world, so nothing is left waiting.
  world = loadSolo(); view = world;
  if (!SERVER_URL) online.why = "this page has no city server";
  //: Everyone is a player of the city from the first: joined in the background as soon as the
  //: district is there (a home beside you to rent), under the profile's name -- there is no
  //: "Join the city" to press (2026-11-11).
  let joining = false;
  async function ensureJoined() {
    const w = view;
    if (!w || w.players.has(myId) || joining) return;
    if (!district.places?.length) return;   // the district first: a home beside you
    const home = nearestPlace((p) => p.use === "residential", 400);
    // In the city: not until the area has loaded round you (a home to start in), within reason.
    if (online.state === "online" && !home && performance.now() - online.since < 120_000) return;
    joining = true;
    try {
      const lib = await Promise.resolve(ctx.account?.()).catch(() => null);
      const name = party.session?.me?.name || lib?.account?.()?.name || "You";
      await send("join", { name, home });
    } catch (error) { console.warn("kerbside: could not join the city", error); }
    finally { joining = false; }
    refresh();
  }
  //: A party: the people whose walkers you see. Each says which player of the city it is, so you
  //: can pick them to pay, lend to or write to -- a name to choose from, never a proof: what
  //: anyone does in the city is decided by their own session with the server.
  function joinParty(session) {
    if (party.session === session) return;
    leaveParty();
    party.session = session; party.ids = new Map();
    party.unlisten = session.city.listen((m) => {
      if (m?.t === "hello" && typeof m.pid === "string" && m.pid.length <= 64) {
        const known = party.ids.has(m.from);
        party.ids.set(m.from, m.pid);
        if (!known) session.city.send({ t: "hello", pid: myId });
      }
    });
    session.city.send({ t: "hello", pid: myId });
  }
  function leaveParty() {
    if (!party.session) return;
    party.unlisten?.();
    party.session = null; party.ids = new Map();
    refresh();
  }

  // ---- where you are, and what is here ---------------------------------------------------------
  const me = () => ctx.avatar.position;
  function whereNow() {
    const p = car.active ? car : me();
    const [lon, lat] = ctx.toLonLat(p.x, p.z);
    return { x: p.x, z: p.z, lon, lat, county: district.county };
  }
  function nearestPlace(test = () => true, reach = 60, places = district.places) {
    const p = me();
    let best = null, bestD = reach;
    const nodes = district.streets?.nodes || [];
    for (const pl of places) {
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
  //: Whether a place sells anything, kept per place: asked every frame of every place, storesAt
  //: built a set and three lists for each (7-8 MB a second of garbage, measured 2026-11-20).
  //: Asked again only when the place's keys change.
  const sellsCache = new WeakMap();
  const sells = (pl) => {
    const c = sellsCache.get(pl);
    if (c && c.keys === pl.keys && c.n === pl.keys.length) return c.sells;
    const v = storesAt(R, pl.keys).length > 0;
    sellsCache.set(pl, { keys: pl.keys, n: pl.keys.length, sells: v });
    return v;
  };
  function nearestShop() {
    const p = me(), reach = R.stores.door_reach_m ?? 3.5;
    let best = null, bestD = reach;
    for (const pl of district.places) {
      if (!sells(pl)) continue;
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

  // ---- your bicycle ----------------------------------------------------------------------------
  //: Bought at a bike shop (rules.json "bicycle"): B to get on and off it (Enter gets off too); the
  //: arrows pedal, brake and steer. Ridden, it is one of the bicycles (``mine``: drawn in full) and
  //: you are its rider, the jointed figure or a character on it as any rider is.
  const cycle = { active: false, entry: null, saidEdge: 0 };
  const ownsBicycle = () => (self()?.inventory?.bicycle || 0) > 0;
  function mountBicycle() {
    if (!ctx.enabled() || cycle.active) return;
    if (!ownsBicycle()) { notify("You have no bicycle: a bike shop sells them."); return; }
    if (car.active || car.riding || transit.ride || shop.place || ctx.insideFitted?.()) { notify("Get on your bicycle out of doors, on foot."); return; }
    const at = me(), p = self();
    cycle.entry = { id: `bike:mine:${myId}`, x: at.x, z: at.z, yaw: ctx.getYaw(), v: 0, odo: 0, shade: 0.35, mine: true, resident: true,
      person: { id: `you:${myId}`, age: p?.age ?? 30, pace: 1.35, height: 1.75 } };
    cycle.active = true;
    ctx.avatarVisible(false);
    notify("On your bicycle: the arrows pedal, brake and steer; Enter to get off.");
    refresh();
  }
  function dismountBicycle() {
    if (!cycle.active) return;
    cycle.active = false;
    const b = cycle.entry, rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
    bikes = bikes.filter((x) => x !== b);
    cycle.entry = null;
    // (Off on the right, the bicycle wheeled along: it is in your things again.)
    ctx.moveAvatarTo(b.x + rx * 0.6, b.z + rz * 0.6);
    ctx.avatarVisible(true);
    refresh();
  }
  const bicycleKey = () => (cycle.active ? dismountBicycle() : mountBicycle());
  //: Each frame you ride: faster than walking, slower than a car; through what a walker can go
  //: through (ctx.moveWalker), steered sharper slow than fast.
  function pedal(dt, held) {
    const b = cycle.entry;
    if (!b) return false;
    const up = held.has("ArrowUp"), down = held.has("ArrowDown"), left = held.has("ArrowLeft"), right = held.has("ArrowRight");
    if (up) b.v += 1.7 * dt;
    if (down) b.v -= (b.v > 0.3 ? 5 : 1) * dt;
    if (!up && !down) b.v -= Math.min(b.v, 0.35 * dt);
    const top = ctx.onRoad(b.x, b.z) ? 8 : 5;
    b.v = Math.max(0, Math.min(top, b.v));
    const steer = (left ? 1 : 0) - (right ? 1 : 0);
    if (steer && b.v > 0.15) b.yaw += steer * dt * Math.min(2.4, 0.7 + 3 / (1 + b.v));
    let dx = -Math.sin(b.yaw) * b.v * dt, dz = -Math.cos(b.yaw) * b.v * dt;
    if (ctx.inArea && !ctx.inArea(b.x + dx * 4, b.z + dz * 4) && ctx.inArea(b.x, b.z)) {
      b.v = 0; dx = 0; dz = 0;
      if (performance.now() - cycle.saidEdge > 4000) { cycle.saidEdge = performance.now(); notify(BOUNDARY_MESSAGE); }
    }
    const x0 = b.x, z0 = b.z, want = Math.hypot(dx, dz);
    const moved = ctx.moveWalker(dx, dz);
    const p = me();
    b.x = p.x; b.z = p.z;
    if (want > 0.02 && moved < want * 0.3) b.v *= 0.2;   // into a wall, a kerb post, a car: stopped
    b.odo += Math.hypot(b.x - x0, b.z - z0);
    ctx.followYaw(b.yaw, dt);
    return true;
  }

  // ---- driving ---------------------------------------------------------------------------------
  const car = { active: false, vehicle: null, model: null, mesh: null, x: 0, z: 0, yaw: 0, speed: 0, km: 0, litres: 0, riding: null,
    lane: null, laneKm: 0, laneSeg: null, limit: SPEED_MS.residential, lastCam: new Map(), lastToll: new Map(), plate: "" };
  function occupants() {
    const s = party.session;
    if (!s) return 1;
    return 1 + s.players().filter((p) => p.car?.riding === s.me.id).length;
  }
  //: Getting in or out (car-entry.mjs): null, or {into, phase: "walk" | "pose", t, points, path
  //: (the corners walked round to the driver's door), dims, then (what to do when it is over)}.
  let entry = null;
  async function enterCar(vehicleId) {
    if (entry) return;
    const w = view;
    const a = w.registry.assets.get(vehicleId);
    if (!a) return;
    const r = await send("drive", { vehicle: vehicleId });
    if (!r.ok) { notify(r.error); return; }
    const spec = R.vehicles.models[a.attrs.model];
    const at = { x: a.attrs.x ?? me().x, z: a.attrs.z ?? me().z, yaw: a.attrs.yaw ?? ctx.getYaw() };
    const dims = VEHICLE_DIMS[a.attrs.model] || VEHICLE_DIMS.sedan;
    const points = carPoints(at, dims, 1);
    // Round the car to the driver's door, not through it: from the other side, by its nearer end.
    const here = me(), rel = { x: here.x - at.x, z: here.z - at.z };
    const path = [];
    if (rel.x * points.out.x + rel.z * points.out.z < dims[0] / 2) {
      const ahead = rel.x * points.forward.x + rel.z * points.forward.z >= 0 ? 1 : -1, end = dims[2] / 2 + 0.7, side = dims[0] / 2 + 0.6;
      const corner = (s) => ({ x: at.x + points.forward.x * end * ahead + points.out.x * side * s, z: at.z + points.forward.z * end * ahead + points.out.z * side * s });
      if (rel.x * points.out.x + rel.z * points.out.z < 0) path.push(corner(-1));
      path.push(corner(1));
    }
    path.push(points.door);
    entry = { into: true, phase: "walk", t: 0, points, path, dims, then: () => {
      car.active = true; car.vehicle = vehicleId; car.model = a.attrs.model; car.plate = a.attrs.plate;
      car.x = at.x; car.z = at.z; car.yaw = at.yaw; car.speed = 0; car.km = 0; car.litres = 0;
      car.top = spec.top_kmh / 3.6 * damagePace(a.attrs.damage); car.spec = spec;
      car.ctl = carState({ x: at.x, z: at.z, yaw: at.yaw, length: dims[2] });
      // The car you walked up to is the one you drive: its body kept, not a new one swapped in.
      car.mesh = parked.get(vehicleId) || makeCar(a.attrs.model, spec.colour);
      parked.delete(vehicleId);
      if (!car.mesh.parent) group.add(car.mesh);
      ctx.avatarVisible(false);
      ctx.moveAvatarTo(car.x, car.z);
      notify(`Driving your ${spec.name.toLowerCase()} (${car.plate}). Up and Down are the pedals, Left and Right the wheel. A/D change lanes, S stops at the light, P parks. Enter to get out.`);
      refresh();
    } };
  }
  async function exitCar() {
    if (!car.active || entry) return;
    if (Math.abs(car.speed) > 1.2) { notify("Stop first (S, or hold Down): then Enter to get out."); return; }
    const metered = Boolean(nearestPlace((p) => p.shops.length > 0, 30)) && Boolean(ctx.onRoad(car.x, car.z));
    const r = await send("park", { metered, x: car.x, z: car.z, km: car.km, litres: car.litres });
    if (!r.ok) { notify(r.error); return; }
    const a = view.registry.assets.get(car.vehicle);
    if (a) { a.attrs.x = car.x; a.attrs.z = car.z; a.attrs.yaw = car.yaw; }
    flushLane();
    // The car stays where it stopped, as it was: it is your parked car now.
    if (car.mesh) parked.set(car.vehicle, car.mesh);
    car.mesh = null;
    car.active = false; car.speed = 0;
    const dims = VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan;
    // Out of the driver's door; by the other side's where something stands at the driver's.
    let points = carPoints(car, dims, 1);
    if (walkerBlocked(points.door.x, points.door.z, 0.3)) points = carPoints(car, dims, -1);
    ctx.avatarVisible(true);
    entry = { into: false, phase: "pose", t: 0, points, dims, then: () => {
      notify(metered ? "Parked at a meter: pay it in the City panel, or expect a ticket an hour after it runs out." : "Parked.");
      refresh();
    } };
    poseEntry(0);
  }
  //: Where the body is ``dt`` on in getting in or out: walked to the door, then turned, sat and
  //: swung in (or out, up and away) by entryPose.
  function stepEntry(dt) {
    if (!entry) return false;
    if (entry.phase === "walk") {
      const goal = entry.path[0], here = me();
      const dx = goal.x - here.x, dz = goal.z - here.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, 1.5 * dt);
      // (Too far to walk -- a car the books stood somewhere else -- or there already: on to it.)
      if (d > 12) { entry.path = [entry.path[entry.path.length - 1]]; ctx.moveAvatarTo(entry.path[0].x, entry.path[0].z, true); return true; }
      if (d < 0.05) {
        entry.path.shift();
        if (!entry.path.length) { entry.phase = "pose"; entry.t = 0; }
        return true;
      }
      ctx.moveAvatarTo(here.x + dx / d * step, here.z + dz / d * step, true);
      ctx.faceTo?.(goal.x, goal.z);
      ctx.animateWalk?.(step, dx, dz);
      return true;
    }
    entry.t += dt;
    poseEntry(entry.t);
    return true;
  }
  function poseEntry(t) {
    const e = entry, P = entryPose(t, e.into), at = entrySpot(e.points, P);
    e.pose = P;
    ctx.moveAvatarTo(at.x, at.z, true);
    // The legs walk the step away; otherwise the body stands (and the bones are bent by afterPose).
    ctx.animateWalk?.(P.stepping ? 0.025 : 0, P.stepping ? e.points.out.x : 0, P.stepping ? e.points.out.z : 0);
    ctx.avatar.rotation.y = at.yaw;
    ctx.avatar.position.y -= P.drop;
    if (P.done) { entry = null; e.then?.(); }
  }
  //: Each frame you drive: the arrows are the pedals and the wheel (car-control.mjs: a pedal goes
  //: down the longer it is held, the wheel turns while an arrow is held and comes back by itself,
  //: the curve as wide as the speed needs); the car keeps to what it can drive on, through the
  //: page's own walls and buildings (ctx.moveWalker).
  //: Whether the car's body, moved (dx, dz), would be in something solid it is not in already:
  //: its two leading corners and the middle of its leading end, and its two sides half way back,
  //: each CAR_BODY.probe_m round. (CAR_BODY.spare_m: the room it wants each side.)
  const CAR_BODY = { probe_m: 0.3, spare_m: 0.12 };
  function carBodyBlocked(x, z, dx, dz) {
    if (!ctx.solidAt) return false;
    const [w, , l] = CAR_DIMS[car.model] || CAR_DIMS.sedan, hw = w / 2 + CAR_BODY.spare_m - CAR_BODY.probe_m, hl = l / 2 - CAR_BODY.probe_m;
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), rx = -fz, rz = fx;
    const lead = dx * fx + dz * fz >= 0 ? 1 : -1;
    for (const [a, b] of [[hl * lead, hw], [hl * lead, -hw], [hl * lead, 0], [hl * lead * 0.35, hw], [hl * lead * 0.35, -hw]]) {
      const px = x + fx * a + rx * b, pz = z + fz * a + rz * b;
      if (ctx.solidAt(px + dx, pz + dz, CAR_BODY.probe_m) && !ctx.solidAt(px, pz, CAR_BODY.probe_m)) return true;
    }
    return false;
  }
  function drive(dt, held) {
    if (cycle.active) return pedal(dt, held);
    if (!car.active) return false;
    const ctl = car.ctl || (car.ctl = carState({ x: car.x, z: car.z, yaw: car.yaw, length: (VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan)[2] }));
    ctl.x = car.x; ctl.z = car.z;
    const onRoad = ctx.onRoad(car.x, car.z);
    const input = { up: held.has("ArrowUp"), down: held.has("ArrowDown"), left: held.has("ArrowLeft"), right: held.has("ArrowRight") };
    const step = stepCar(ctl, input, dt, { top: onRoad ? car.top : 4 });
    car.yaw = ctl.yaw; car.speed = ctl.v;
    let dx = step.dx, dz = step.dz;
    if (step.event === "parked") notify("Parked. Enter to get out.");
    else if (step.event === "stopped") notify(car.light && car.light.light !== "green" && car.light.toLine < 12 ? "Stopped at the line. Up when it is green." : "Stopped.");
    // City mode's area ends here: the car stops at its edge (not a crash).
    if (ctx.inArea && !ctx.inArea(car.x + dx * 4, car.z + dz * 4) && ctx.inArea(car.x, car.z)) {
      ctl.v = 0; ctl.throttle = 0; ctl.park = null; ctl.lane = null; car.speed = 0; dx = 0; dz = 0;
      if (performance.now() - (car.edgeSaid || 0) > 4000) { car.edgeSaid = performance.now(); notify(BOUNDARY_MESSAGE); }
    }
    // The car's own body: it is moved as the walker is (a third of a metre round), and so went
    // through any gap a person fits -- a walk gate, the space between a fence's posts, a fence
    // itself nose first. Its leading corners and its sides are asked for (carBodyBlocked): it
    // goes only where the whole of its width does, so a gate must be wide enough for it.
    if ((dx || dz) && carBodyBlocked(car.x, car.z, dx, dz)) { dx = 0; dz = 0; }
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
        send("collision", { kind: "hit_object", speed: impact, where: { mine: { zone: car.speed >= 0 ? "front" : "rear", bias: 0, at: 0 } } }).then((r) => { if (r.ok) carMarks(); });
        // What the car hit: the energy of the impact on it (a bench, a light, a bin).
        const kg = { car: 1500, truck: 2600, van: 2500, bus: 13000 }[car.spec.kind] || 1500;
        strikeKey(0.5 * kg * impact * impact);
        send("hurt", { amount, cause: "crash" }).then((r) => r.ok && notify(r.fainted && gameNow() - r.fainted.at < 5000 * CLOCK.rate(clockTime()) ? "" : `Crashed at ${Math.round(impact * MPH)} mph: -${amount} health.`));
      }
      ctl.v *= 0.2; ctl.throttle *= 0.3; car.speed = ctl.v;
      if (ctl.park || ctl.lane) { ctl.park = null; ctl.lane = null; notify("Something is in the way: the wheel is yours."); }
    }
    watchLights();
    hitInTraffic(before);
    const metres = Math.hypot(car.x - before.x, car.z - before.z);
    car.km += metres / 1000;
    const spec = car.spec;
    car.litres += spec.fuel === "electric" ? metres / 1000 * spec.kwh_per_100km / 100 / 1.6 : metres / 1000 * spec.l_per_100km / 100;
    if (car.mesh) { car.mesh.position.set(car.x, p.y - ctx.standY, car.z); car.mesh.rotation.y = car.yaw; }
    // The view behind the car: in reverse it stays behind the car's nose's way, so backing up
    // is seen as backing up.
    ctx.followYaw(car.yaw, dt);
    roadCharges(before, car, dt);
    return true;
  }
  //: The light at the next signalled junction ahead, a few times a second: {toLine (m to its
  //: stop line), light} or null (car.light) -- for the HUD, and for S to stop at its line.
  let lightsAt = 0;
  function watchLights() {
    const s = district.streets, now = performance.now();
    if (!s || now - lightsAt < 200) return;
    lightsAt = now;
    const ctl = car.ctl, fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), bearing = Math.atan2(fx, fz), tsec = Date.now() / 1000;
    const len = (VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan)[2], signals = [];
    for (let i = 0; i < s.nodes.length; i += 1) {
      const n = s.nodes[i];
      if (Math.abs(n.x - car.x) > 80 || Math.abs(n.z - car.z) > 80 || junctionAt(s, i) !== "signal") continue;
      const line = district.drivers?.stopLine ? district.drivers.stopLine(i, { length: len }) : TRAFFIC.stop_line_m + len / 2;
      signals.push({ x: n.x, z: n.z, line, light: signalAt(s, i, bearing, tsec) });
    }
    car.light = lightAhead(ctl, signals);
    // Stopping for a light that has turned: the line it stops at moves with the car's own travel.
    if (ctl.stopping && ctl.stopping.lineIn !== null && car.light && car.light.light !== "green") { ctl.stopping.lineIn = car.light.toLine; ctl.stopping.travelled = 0; }
  }
  //: The driving helpers' keys: A or D over a lane, S a stop (at the light's line ahead, if it
  //: is red or amber), P parking (in the stall or kerb space you are by, or pulled up here).
  function driveKey(key) {
    const ctl = car.ctl;
    if (!car.active || !ctl) return false;
    if (key === "a" || key === "d") {
      const dir = key === "a" ? 1 : -1, why = startLaneChange(ctl, dir);
      if (why) { notify(why); return true; }
      const hit = lanes?.at(car.x, car.z, car.yaw);
      notify(hit && hit.seg.lanes <= 1 ? `Over to the ${dir > 0 ? "left" : "right"}: there is one lane this way, so watch for the kerb and oncoming cars.` : `Over a lane to the ${dir > 0 ? "left" : "right"}.`);
      return true;
    }
    if (key === "s") {
      const L = car.light && car.light.light !== "green" ? car.light : null;
      startStop(ctl, L ? L.toLine : null);
      notify(L ? `Braking for the ${L.light} light: stopping at its line, ${Math.max(0, Math.round(L.toLine))} m on.` : "Braking to a stop.");
      return true;
    }
    if (key === "p") {
      const spot = parkSpot();
      if (spot) {
        startPark(ctl, parkPath({ x: car.x, z: car.z, yaw: car.yaw }, spot));
        notify(`Parking ${spot.kind === "stall" ? "in the stall" : "at the kerb"} ${spot.d < 3 ? "here" : `${Math.round(spot.d)} m on`}${ctl.park.path.reverse ? ", backing in" : ""}. An arrow takes the wheel back.`);
      } else if (Math.abs(ctl.v) > 0.3) { startStop(ctl, null); notify("No free space near: pulling up here. Enter to get out when stopped."); }
      else { ctl.parked = true; notify("Parked here. Enter to get out."); }
      return true;
    }
    return false;
  }
  //: A free place to park near the car: a car park's stall (nosed in) within 28 m, or a stretch
  //: of kerb on the right ahead where a car may stand (no driveway, no red or blue paint) with
  //: nobody in it. {x, z, yaw, d, kind} or null.
  function parkSpot() {
    const [w, , l] = VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan;
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
    const others = [];
    for (const v of drawnCars) { const [vw, , vl] = VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan; others.push([v.x, v.z, v.yaw, vl / 2, vw / 2]); }
    for (const [, m] of [...parked, ...peerCars]) if (m.parent) { const [vw, , vl] = VEHICLE_DIMS[m.userData.model] || VEHICLE_DIMS.sedan; others.push([m.position.x, m.position.z, m.rotation.y, vl / 2, vw / 2]); }
    const taken = (x, z, yaw) => others.some(([ox, oz, oy, hl, hw]) => Math.hypot(ox - x, oz - z) < l + hl && boxesOverlap(x, z, yaw, l / 2 + 0.25, w / 2 + 0.15, ox, oz, oy, hl, hw));
    const out = [];
    for (const q of ctx.parkingStalls?.() || []) {
      const dx = q.x - car.x, dz = q.z - car.z, d = Math.hypot(dx, dz), along = dx * fx + dz * fz;
      if (d > 28 || along < -8 || taken(q.x, q.z, q.yaw)) continue;
      out.push({ x: q.x, z: q.z, yaw: q.yaw, d: d + (along < 0 ? 6 : 0), kind: "stall" });
    }
    if (ctx.kerbAt && ctx.onRoad(car.x, car.z)) {
      for (const ahead of [4, 8, 12, 16, 21, 26]) {
        const k = ctx.kerbAt(car.x + fx * ahead + rx * 3, car.z + fz * ahead + rz * 3, fx, fz, 7);
        if (!k || k.nx * rx + k.nz * rz < 0.3) continue;   // the kerb on the right, out of the road
        let ax = k.ax, az = k.az;
        if (ax * fx + az * fz < 0) { ax = -ax; az = -az; }
        if (ctx.kerbParking?.(k.x, k.z, ax, az, l / 2, null)) continue;
        const x = k.x - k.nx * (w / 2 + 0.3), z = k.z - k.nz * (w / 2 + 0.3), yaw = Math.atan2(-ax, -az);
        if (taken(x, z, yaw)) continue;
        out.push({ x, z, yaw, d: ahead, kind: "kerb" });
        break;
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out[0] || null;
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
        struck(q, "me", fx * Math.sign(car.speed || 1), fz * Math.sign(car.speed || 1), speed, car.model);
        jolts.set("me", { t0: now, speed });
        debrisAt(car.x + fx * l / 2, car.z + fz * l / 2, car.yaw, speed * 0.6);
        noteIncident("crash", car.x + fx * l / 2, car.z + fz * l / 2, true);
        car.speed *= 0.55;
        send("collision", { kind: "hit_person", speed, where: { mine: zoneOn(car, q.x, q.z) }, npc: { id: hitAt.id, name: hitAt.person?.name, x: hitAt.x + fx * Math.min(9, 1 + speed * 0.5), z: hitAt.z + fz * Math.min(9, 1 + speed * 0.5), yaw: car.yaw } })
          .then((r) => { district.city?.forget(hitAt.id); if (r.ok) carMarks(); if (r.ok && r.offence) police.crime(r.offence, hitAt, { victim: { id: hitAt.id, name: hitAt.person?.name }, plate: car.plate }); notify(r.ok ? `You hit ${hitAt.person?.name || "someone"} at ${Math.round(speed * MPH)} mph: ${r.injury.type}.${r.bill ? ` Their care is billed to you: ${R.fmt(r.bill)}.` : ""}` : r.error); });
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
      noteIncident("crash", (car.x + v.x) / 2, (car.z + v.z) / 2, true);
      const owner = v.vehicle?.owner;
      // Where each was struck: about the middle of where the two bodies meet.
      const mx = (car.x * vl + v.x * l) / (l + vl), mz = (car.z * vl + v.z * l) / (l + vl), where = { mine: zoneOn(car, mx, mz), other: zoneOn(v, mx, mz) };
      dentCar(v.id, where.other, rel);
      send("collision", { kind: "hit_vehicle", speed: rel, other, where, vehicle: { id: v.id, plate: v.plate, x: v.x, z: v.z, yaw: v.yaw, parked: Boolean(v.parked), driver: v.parked ? null : owner, driverName: district.roster?.people.get(owner)?.name } })
        .then((r) => {
          if (!r.ok) { notify(r.error); return; }
          carMarks();
          if (r.offence) police.crime(r.offence, { x: v.x, z: v.z }, { victim: owner ? { id: owner, name: district.roster?.people.get(owner)?.name } : null, unseenVictim: Boolean(owner), plate: car.plate });
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
      const rule = hit?.managed ? lanes.rule(hit.seg, timeAt(gameNow())) : null;
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
          .then((r) => { if (r.ok && r.pursuit && r.offence) police.speeding(r.offence, seen); else if (r.ok && r.charged) notify(`Speed camera: ${Math.round(mph)} mph in a ${Math.round(limitMph)} — a ${R.fmt(r.charged)} notice will follow.`); });
      } else if (!seen && now - (car.lastSeenBy || 0) > 60_000 && visible.people.some((x) => Math.abs(x.x - b.x) < 25 && Math.abs(x.z - b.z) < 25)) {
        // Past people on the pavement: a speeding offence each of them may (almost never) call in.
        car.lastSeenBy = now;
        send("speed_camera", { over_mph: mph - limitMph, mph, witness: { kind: "bystander", id: "street" } }).then((r) => { if (r.ok && r.offence) police.crime(r.offence, b, { plate: car.plate }); });
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
  const body = { walked: 0, sprint: 0, swim: 0, swimSprint: 0, tread: 0, since: performance.now(), sprintHeld: false, sprinting: false, faintSeen: 0, reporting: false };
  const self = () => view?.players.get(myId) || null;
  //: Everyone in the city's one world is in the city's one room, so players see each other walk
  //: and drive without sharing a code first. A party of your own (the home screen's Multiplayer)
  //: takes its place while you are in it; leaving it brings you back here.
  let cityRoomAt = -Infinity;
  function cityRoom() {
    if (online.state !== "online" || !self() || party.session || !ctx.joinCityRoom) return;
    if (performance.now() - cityRoomAt < 20_000) return;
    cityRoomAt = performance.now();
    ctx.joinCityRoom(self().name);
  }
  //: The home you own is where you start (the page reads this at its next load, when you have
  //: chosen no spawn point of your own): kept as its door's place on the map, and dropped when
  //: you no longer own one.
  let homeSpawnKept;
  function homeSpawn() {
    const p = self();
    if (!p || !view) return;
    // Your home, owned or rented: where you live is where you start.
    const owned = Boolean(p.home && (p.home.building || Number.isFinite(p.home.x)));
    const pl = owned ? (district.places || []).find((x) => String(x.id) === String(p.home.building)) : null;
    const at = owned ? (pl?.door ? { x: pl.door.x, z: pl.door.z } : Number.isFinite(p.home.x) ? { x: p.home.x, z: p.home.z } : null) : null;
    const [lon, lat] = at ? ctx.toLonLat(at.x, at.z) : [null, null];
    const next = at ? JSON.stringify({ lon: +lon.toFixed(7), lat: +lat.toFixed(7), label: address(p.home.address || pl?.name) || p.home.label || null }) : null;
    if (next === homeSpawnKept) return;
    homeSpawnKept = next;
    try { if (next) localStorage.setItem("kerbside:home-spawn", next); else if (online.state !== "connecting") localStorage.removeItem("kerbside:home-spawn"); } catch { /* private mode */ }
  }
  //: How fast the bars let you walk: slowed when spent; Shift sprints while stamina lasts.
  function walkFactorNow() {
    const p = self();
    if (!p?.vitals || !ctx.enabled()) { body.sprinting = false; return 1; }
    const f = walkFactor(R, p.vitals, body.sprintHeld);
    body.sprinting = f.sprint && !pushing.on;
    return f.factor * pushPace();
  }
  //: The walk as the page made it: counted at a walker's pace however far the zoomed-out view
  //: carries the walker, and reported to the books every few seconds.
  function walked(metres, dt) {
    climbPlay.noteSpeed(metres, dt);   // a jump carries on at the pace you were going
    if (!self() || !(metres > 0) || inWater()) return;   // (a swim is counted by swim)
    body.walked += Math.min(metres, dt * 2.6 * (body.sprinting ? R.vitals.stamina.sprint_factor : 1));
    if (body.sprinting) body.sprint += dt;
  }
  function reportExertion() {
    const seconds = (performance.now() - body.since) / 1000;
    if (body.reporting || seconds < 4 || !self()) return;
    body.since = performance.now();
    if (body.walked < 0.5 && body.sprint <= 0 && body.swim + body.swimSprint + body.tread <= 0) return;
    const r1 = (x) => Math.round(x * 10) / 10;
    const args = { walked_m: r1(body.walked), sprint_s: r1(body.sprint), seconds: Math.min(60, seconds) };
    if (body.swim + body.swimSprint + body.tread > 0) Object.assign(args, { swim_s: r1(body.swim), swim_sprint_s: r1(body.swimSprint), tread_s: r1(body.tread) });
    body.walked = 0; body.sprint = 0; body.swim = 0; body.swimSprint = 0; body.tread = 0; body.reporting = true;
    send("exert", args).finally(() => { body.reporting = false; });
  }
  //: In the water, afloat (the page's module 33 asks each frame): how you move by your stamina
  //: (core.mjs swimMode) -- a swim, fast with Shift while it lasts, treading water when you are
  //: out of breath until it is back -- counted here as you go and told to the books with the walk
  //: (exert). The stroke's phase runs on for the arms and legs (afterPose). One object, reused.
  const swimming = { seen: -1e9, stamina: 0, treading: false, phase: 0, out: { mode: "tread", speed: 0, phase: 0, treading: false, stamina: 0 } };
  const inWater = () => performance.now() - swimming.seen < 400;
  function swim(dt, moving) {
    const p = self(), now = performance.now(), W = R.vitals.stamina;
    if (now - swimming.seen > 1500) {
      swimming.stamina = p?.vitals?.stamina ?? R.vitals.max; swimming.treading = false;
      notify("Swimming. Shift swims fast while your stamina lasts; out of breath, you tread water until it comes back.");
    }
    swimming.seen = now;
    const m = swimMode(R, swimming.stamina, { moving, sprint: body.sprintHeld, treading: swimming.treading });
    if (m.treading && !swimming.treading) notify("Out of breath: treading water until your stamina is back.");
    else if (!m.treading && swimming.treading) notify("Your wind is back: swimming on.");
    swimming.treading = m.treading;
    const rate = m.mode === "sprint" ? -W.swim_sprint_per_second : m.mode === "swim" ? -W.swim_per_second : W.tread_recover_per_second;
    swimming.stamina = Math.max(0, Math.min(R.vitals.max, swimming.stamina + rate * dt));
    if (m.mode === "sprint") body.swimSprint += dt; else if (m.mode === "swim") body.swim += dt; else body.tread += dt;
    swimming.phase += dt * (m.mode === "sprint" ? 7.2 : m.mode === "swim" ? 4.2 : 3.4);
    const o = swimming.out;
    o.mode = m.mode; o.speed = m.speed; o.phase = swimming.phase; o.treading = m.treading; o.stamina = swimming.stamina;
    return o;
  }
  //: Out cold (the books say so): your car left where it stopped, and you wake where you were taken.
  function checkFainted() {
    const p = self();
    if (!p?.fainted || p.fainted.at <= body.faintSeen) return;
    const first = body.faintSeen === 0 && gameNow() - p.fainted.at > 60_000 * CLOCK.rate(clockTime());
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
    const day = timeAt(gameNow()).day;
    if (district.foundDay === day || !district.streets) return district.found || [];
    const r = rng(district.key, "found", day);
    const nodes = district.streets.nodes, walk = [];
    for (let i = 0; i < nodes.length; i += 1) if (!nodes[i].drive) walk.push(nodes[i]);
    const pool = walk.length ? walk : nodes;
    district.found = pool.length ? Array.from({ length: R.found.per_district }, (_, i) => {
      const n = pool[Math.floor(r() * pool.length) % pool.length];
      const F = R.commerce?.outcomes?.found_containers, x = n.x + (r() - 0.5) * 1.6, z = n.z + (r() - 0.5) * 1.6;
      // Now and then a box or bag left out (a clear-out, a move): what is in it is the world's,
      // drawn once (commerce.mjs), the same for whoever opens it.
      if (F && r() < F.share) return { id: `found:${district.key}:${day}:${i}`, item: F.kinds[Math.floor(r() * F.kinds.length) % F.kinds.length], x, z, found: true, box: true };
      return { id: `found:${district.key}:${day}:${i}`, item: R.found.items[Math.floor(r() * R.found.items.length) % R.found.items.length], x, z, found: true };
    }) : [];
    district.foundDay = day;
    return district.found;
  }
  //: Everything lying near (x, z) that can be picked up: found things not yet taken, and things put down.
  function thingsNear(x, z, reach) {
    const w = view, out = [];
    for (const f of foundToday()) if (!w?.found?.has(f.id) && Math.abs(f.x - x) < reach && Math.abs(f.z - z) < reach) out.push(f);
    // A courier task's order, waiting outside the shop's door until you pick it up (a click on it).
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
  //: Things lying near enough to see are their own models, lying on the ground (objects.mjs):
  //: one copy each, at the detail their size on screen needs; the rest, and those with no model,
  //: are the marker block. The yellow ring stays, to find them by.
  const lyingGroup = new THREE.Group(); lyingGroup.name = "city-lying"; group.add(lyingGroup);
  const lying = new Map();   // thing id -> { holder, sku, tier }
  const LYING_M = 40;
  function drawLying(list) {
    const cam = ctx.camera?.(), at = me(), seen = new Set();
    const viewH = globalThis.innerHeight || 900, fov = cam?.fov || 60;
    for (const t of list) {
      const sku = t.look || t.item;
      if (!kit || !bindingOf(OBJ, sku) || t.d > LYING_M) continue;
      const size = R.items[t.item]?.length_m || 0.3;
      const d = cam ? Math.hypot(cam.position.x - t.x, cam.position.z - t.z) : t.d;
      const was = lying.get(t.id);
      const tier = tierFor(projectedPx(size, d, fov, viewH), was?.tier || null, OBJ.lod);
      if (tier === "cull") continue;
      seen.add(t.id);
      if (was && was.tier === tier && was.sku === sku) continue;
      if (was) was.holder.removeFromParent();
      const holder = new THREE.Group();
      // Each lies its own way round (by its id), on the ground where it is.
      holder.position.set(t.x, groundAt(t.x, t.z) + 0.01, t.z); holder.rotation.y = (hash32(String(t.id)) % 628) / 100;
      holder.userData.keep = false;
      lyingGroup.add(holder);
      const rec = { holder, sku, tier, ready: false };
      lying.set(t.id, rec);
      kit.dress(holder, sku, { tier }).then((ok) => { rec.ready = ok; }).catch(() => {});
    }
    for (const [id, rec] of lying) if (!seen.has(id)) { rec.holder.removeFromParent(); lying.delete(id); }
    void at;
  }
  function drawThings(now) {
    const p = me();
    const list = thingsNear(p.x, p.z, 160).slice(0, MAX_THINGS);
    drawLying(list);
    let k = 0;
    list.forEach((t, i) => {
      const y = groundAt(t.x, t.z);
      E.set(0, 0, 0); Q.setFromEuler(E); M.compose(V.set(t.x, y + 0.03, t.z), Q, S3.set(1, 1, 1)); thingRing.setMatrixAt(i, M);
      if (lying.get(t.id)?.ready) return;
      E.set(0, now / 900 + i, 0); Q.setFromEuler(E);
      M.compose(V.set(t.x, y + 0.2 + Math.sin(now / 400 + i) * 0.05, t.z), Q, S3.set(1, 1, 1)); thingMesh.setMatrixAt(k, M);
      thingMesh.setColorAt(k, C.set(thingColour(t.item)));
      k += 1;
    });
    thingMesh.count = k; thingRing.count = list.length;
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
    const shelf = floor.near(at, ctx.getYaw());
    if (shelf) { await floor.take(shelf.item); refresh(); return; }
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
    const at = me(), dx = t.x - at.x, dz = t.z - at.z, d = Math.hypot(dx, dz), near = t.at ?? PICK_AT_M;
    if (d <= near) { reach.t = null; ctx.faceTo?.(t.x, t.z); ctx.animateWalk?.(0); if (t.then) t.then(); else reachDown(t); return false; }
    if (car.active || transit.ride || performance.now() - reach.since > (t.ms ?? 4000)) { reach.t = null; ctx.animateWalk?.(0); notify("Could not get to it: something is in the way."); return false; }
    const step = Math.min(1.3 * dt, d - near + 0.05);
    const moved = ctx.moveWalker?.((dx / d) * step, (dz / d) * step) ?? step;
    ctx.faceTo?.(t.x, t.z);
    ctx.animateWalk?.(moved, dx / d, dz / d);
    return true;
  }
  //: Walk over to (x, z), to within ``at`` metres, then ``then()`` (a click's errand: a thing to pick
  //: up, a spot to set something down, something to push, wood to set a nail in).
  function goTo(x, z, at, then) {
    const d = Math.hypot(x - me().x, z - me().z);
    if (d <= at) { ctx.faceTo?.(x, z); then(); return; }
    Object.assign(reach, { t: { x, z, at, then, ms: 3000 + (d / 1.3) * 1000 }, since: performance.now() });
  }
  function reachDown(t, { carry: carried = false } = {}) {
    const pl = self();
    if (!pl) return;
    const ph = physOf(R, t.item), lift = liftKg(R, pl.vitals.strength);
    // Reach down for it either way: too heavy, you strain and let go.
    if (ph.kg > lift) { startAct("strain", 1.0, 0.7, () => notify(`${ph.name} (${ph.kg} kg) is too heavy for you to lift: you can lift ${Math.round(lift)} kg at strength ${Math.round(pl.vitals.strength)}. Workouts at a gym build strength.`)); return; }
    startAct("pickup", 0.85, 0.5, async () => {
      const r = t.courier ? await send("collect_delivery")
        : await send("pick_up", t.found ? { found: { id: t.id, item: t.item, x: t.x, z: t.z, ...(t.box ? { box: true } : {}) } } : { id: t.id });
      if (!r.ok) { notify(r.error); return; }
      if (t.debris) { t.debris.mesh.removeFromParent(); debrisParts.splice(debrisParts.indexOf(t.debris), 1); }
      if (t.courier) { notify(`Picked up the order (${ph.kg} kg). Now to ${self()?.delivery?.to.name || "the address"}: follow the green light; at the door you are asked to hand it over.`); syncSlots(true); return; }
      notify(`Picked up ${R.items[r.item].name.toLowerCase()}${r.qty > 1 ? ` x${r.qty}` : ""} — ${weightClass(R, ph.kg, pl.vitals.strength)}, ${ph.kg} kg (carrying ${r.carry.kg} of ${r.carry.capacity} kg).${carried ? " Click where it should go to set it down." : ""}`);
      syncSlots(true);
      if (carried) holdPicked(r.item);
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
  function wheels() { const out = taxi.at ? [taxi.at, ...routeBuses, ...visible.vehicles] : [...routeBuses, ...visible.vehicles]; if (patrol.at) out.push(patrol.at); for (const r of scenes.vehicles()) out.push(r); for (const u of police.vehicles()) out.push(u); return out; }
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
    if (court.active || police.locked) return;
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
    // A route bus whose way on from here leaves City mode's area: not boarded (nothing paid).
    if (String(v.id).startsWith("bus:") && ctx.inArea && boundaryStop(lineOf(v), v, ctx.inArea)?.here) {
      notify(`The ${v.route} leaves ${ctx.areaName?.() || "the city"} after this stop. ${BOUNDARY_MESSAGE}`);
      return;
    }
    const r = await send("board", { kind: v.model, vehicle: v.id, ...(taxi.lift && v.id === taxi.id ? { lift: true } : {}) });
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
  async function alight(v = null, why = null) {
    const ride = transit.ride;
    if (!ride) return;
    transit.ride = null;
    const r = await send("alight", { km: ride.km });
    // A lift someone gave you (a favour): no fare, and they go on with their day.
    if (r.ok && r.kind === "lift") { why = `${String(r.by || "They").split(" ")[0]} drops you off: no fare.`; taxi.lift = null; favours.finish(); }
    ctx.avatarVisible(true);
    const p = me(), yaw = v?.yaw ?? ride.yaw ?? 0;
    // Out onto the pavement: at the stop's pole where it is on the door side, else off the door
    // side itself (the right, the kerb's) -- never into the road.
    const at = { x: v?.x ?? p.x, z: v?.z ?? p.z, yaw };
    const out = ride.kind === "bus" ? 2.8 : 1.9;
    if (v?.pole && Math.hypot(v.pole.x - at.x, v.pole.z - at.z) < 30 && besideOf(at, v.pole).right > 0.5) ctx.moveAvatarTo(v.pole.x, v.pole.z);
    else ctx.moveAvatarTo(at.x + Math.cos(yaw) * out, at.z - Math.sin(yaw) * out);
    if (ride.vehicle === taxi.id) Object.assign(taxi, { phase: null, route: null, at: null, dest: null });
    notify(why && r.ok ? why : r.ok ? (r.kind === "taxi" ? `Taxi: ${r.km.toFixed(1)} km, ${R.fmt(r.fare)}.` : `Off the bus${v?.stopName ? ` at ${v.stopName}` : ""}.`) : r.error);
    refresh();
  }
  //: The line a route bus runs (a timetabled trip's id carries its line's key).
  const lineOf = (v) => district.lines?.find((L) => (L.schedule ? String(v.id).startsWith(`bus:${L.route}:${L.schedule.key}:`) : L.route === v.route)) || null;
  //: Riding: you go where it goes. A route bus lets you off at the stop you asked for; a
  //: vehicle gone from the street (its trip over) lets you off where it was. At the edge of City
  //: mode's area (transit.mjs boundaryStop) a route bus sets you down at the last stop inside it
  //: and goes on along its real route without you.
  function followRide() {
    const ride = transit.ride;
    if (!ride) return;
    const v = wheels().find((x) => x.id === ride.vehicle);
    if (!v) { if (performance.now() - ride.seen > 3000) alight(); return; }
    if (ride.route && ctx.inArea) {
      const edge = boundaryStop(lineOf(v), v, ctx.inArea);
      if (edge) {
        const stand = edge.here ? v : { ...v, x: edge.at.x, z: edge.at.z, yaw: edge.at.yaw, pole: edge.pole, stopName: edge.name };
        alight(stand, `${edge.name ? `Off the ${v.route} at ${edge.name}. ` : ""}${BOUNDARY_MESSAGE}`);
        return;
      }
    }
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
    if (!s || !dest || court.active || police.locked) return;
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
    const mins = Math.max(1, Math.round(route.length / TL.taxi_speed_ms / 60));
    taxi.warned = false;
    notify(`A yellow taxi is on its way, about ${mins} min. Wait at the kerb; Enter to get in when it pulls up (it waits ${TL.taxi_max_wait_s} s).`);
    send("ride_note", { note: "coming", minutes: mins });   // the driver writes (messages.mjs)
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
    send("ride_note", { note: "aboard" });
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
    if (done && taxi.phase === "coming") { taxi.phase = "waiting"; taxi.waitSince = performance.now(); notify(`Your taxi has pulled up: Enter to get in. It waits ${TL.taxi_max_wait_s} s.`); send("ride_note", { note: "here", seconds: TL.taxi_max_wait_s }); }
    // It waits so long and no longer: a fare that does not come out does not keep it all day. The
    // driver says so before going, and hangs on a minute more if asked in the messages.
    if (taxi.phase === "waiting") {
      const limit = TL.taxi_max_wait_s + ((world || view)?.rideState?.(myId)?.extend ? 60 : 0), waited = (performance.now() - taxi.waitSince) / 1000;
      if (!taxi.warned && limit - waited <= 20) { taxi.warned = true; send("ride_note", { note: "leaving", seconds: Math.max(1, Math.round(limit - waited)) }); }
      if (waited > limit) { Object.assign(taxi, { phase: null, route: null, at: null }); notify("The taxi gave up waiting and left."); send("ride_note", { note: "left" }); }
    }
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
  //: When the next buses stand at ``stop`` ({x, z}): each route's next two, in seconds (by the
  //: timetable where the route has one: none at all on a route that is not running then).
  function nextBuses(stop, ms) {
    const out = [], t = ms / 1000;
    for (const line of district.lines || []) {
      const k = line.stops.findIndex((c) => Math.hypot(c.x - stop.x, c.z - stop.z) < 35);
      if (k < 0) continue;
      const waits = [];
      for (const seg of line.timeline) {
        if (seg.kind !== "dwell" || seg.stop !== k) continue;
        const next = line.timeline[line.timeline.indexOf(seg) + 1];
        // The last stop of a timetabled run sets nobody down further on: nothing to wait for.
        if (line.schedule && !next) continue;
        const toward = line.sign?.to || (next?.next !== undefined ? line.stops[next.next].name : "the end of the line");
        for (const a of arrivalsAt(line, seg, t, 2)) waits.push({ wait: Math.max(0, a.at - t), toward });
      }
      waits.sort((a, b) => a.wait - b.wait);
      if (waits.length) out.push({ route: line.route, next: waits.slice(0, 2) });
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
    notify(`Delivery: a parcel to ${to.name || "a home"}, ${Math.round(r.delivery.km * 1000)} m away — ${R.fmt(r.delivery.pay)} if there in ${Math.round(realMinutesTo(r.delivery.due))} min. Follow the green light; at the door you are asked to hand it over.`);
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
    notify(r.ok ? (was ? "Clocked out and paid for the time worked." : `At work as ${p.job.title.toLowerCase()}: tasks come every minute or so (R where the orange ring is). Paid ${R.fmt(p.job.pay / 6)} a 10 minutes worked, tax held back; idle 30 minutes and you are sent home.`) : r.error);
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
    let I = place.front || place.inside;
    if (!I) return null;
    const kind = view?.kitchenKind?.(place);
    if (kind && place.ring && place.door) {
      const front = frontOf(place.ring,place.x,place.z,place.door);
      if (front) I=front;
    }
    const L = counterLine(I);
    // As deep as the building runs (to 20 m) and, a shop on its own in its building, as wide.
    let D = Math.min(I.depth, 20), W = Math.max(3, Math.min(12, I.half * 2));
    if (place.ring && place.shops?.length <= 1) {
      const across=place.ring.map(([x,z])=>(x-I.x)*I.nz-(z-I.z)*I.nx);
      W=Math.max(W,Math.min(22,2*Math.max(...across.map(Math.abs))));
    }
    // Local frame: u inward from the front, v along it (to the right seen from the street).
    const lx = I.nz, lz = -I.nx;
    const y = groundAt(I.x - I.nx * 0.8, I.z - I.nz * 0.8);
    const at = (u, v) => ({ x: I.x + I.nx * u + lx * v, z: I.z + I.nz * u + lz * v });
    const local=(x,z)=>({u:(x-I.x)*I.nx+(z-I.z)*I.nz,v:(x-I.x)*lx+(z-I.z)*lz});
    const F = { I,L,D,W,lx,lz,y,at,local };
    if (kind) {
      const source=ctx.restaurantFront?.(place.id),door=place.door && local(place.door.x,place.door.z);
      const outline=place.ring?.map(([x,z])=>{const p=local(x,z);return [p.v,p.u];});
      const doorX=door && Math.abs(door.u)<.6 && Math.abs(door.v)<W/2-.45 ? door.v : 0;
      const windows=(source?.windows || []).map(w=>{const p=local(w.x,w.z);return {...w,x:p.v,z:p.u};});
      const service=restaurantService(R,kind,view.bizAt(place.id),view.kitchens.get(String(place.id)));
      F.restaurant=planRestaurant({width:W,depth:D,outline,doorX,windows},service);
    } else {
      // Any other shop: fitted to its trade (store-room.mjs), its door where the building's is.
      const door=place.door && local(place.door.x,place.door.z);
      const doorX=door && Math.abs(door.u)<.6 && Math.abs(door.v)<W/2-.6 ? door.v : 0;
      F.store=planStore({width:W,depth:D,doorX,name:view.bizAt?.(place.id)?.name || place.name || ""},place.shops?.[0] || "shop");
    }
    return F;
  }
  //: The checkout panel's face: what it is and what to do, at the panel's own shape (0.8 x 0.5 m).

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
  //: A piece of the lab's furniture in ``holder`` (its drawn stand-in replaced), scaled so it is
  //: ``height`` m tall.
  function furnish(holder, asset, height) {
    if (!kit || !asset || !OBJ.assets[asset]) return;
    kit.load(asset).then((m) => {
      if (!m || !holder.parent) return;
      const o = m.near.clone(true), dims = OBJ.assets[asset].dims;
      o.scale.setScalar(height / Math.max(0.05, dims[1]));
      for (const c of holder.children.slice()) holder.remove(c);
      holder.add(o);
    }).catch(() => {});
  }
  function buildRoom(place, F) {
    const g = new THREE.Group(); g.name = "city-shop-room";
    g.position.set(F.I.x, F.y, F.I.z); g.rotation.y = Math.atan2(F.I.nx, F.I.nz);
    if(F.restaurant){
      const room=restaurantScene(THREE,F.restaurant,{doc,name:view.bizAt(place.id)?.name || place.name || R.stores.kinds[F.restaurant.service.kind]?.name});
      g.add(room);g.userData.panel=room.userData.panel;
      return g;
    }
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
    const glass = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, map: paneTexture(), transparent: true, opacity: 0.34, side: THREE.BackSide, depthWrite: false });
    globalThis.__kerbsideRealGlass?.(glass);   // real glass (module 02) where the page has it
    // Box faces: +x, -x, +y, -y, +z (the back wall), -z (the front, glass).
    const shell = new THREE.Mesh(new THREE.BoxGeometry(F.W, 3.2, F.D).translate(0, 1.6, F.D / 2), [sideWall, sideWall, ceiling, floor, wall, glass]);
    g.add(shell);
    // The room fitted to its trade (store-room.mjs): the till by the door, the walls and the floor
    // as such a shop has them, the stock room behind. (Before, a counter straight across.)
    if (F.store) g.add(storeFixtures(THREE, F.store, { seed: hash32(String(place.id), "store"), tint }));
    // A supermarket's shelves stocked with what it sells, each product where its aisle is and
    // faced the way a store faces it (shelf-stock.mjs), its strip lights over the aisles.
    if (F.store?.shelves?.length) stockRoom(g, place, F.store);
    else {
      const counter = new THREE.Mesh(box(F.L.width * 2, 1.0, 0.62, 0.5), lambert({ color: tint }));
      counter.position.z = F.L.counter; counter.rotation.y = 0; g.add(counter);
      const top = new THREE.Mesh(box(F.L.width * 2 + 0.1, 0.05, 0.72, 1.02), lambert({ color: 0xe9e4da })); top.position.z = F.L.counter; g.add(top);
      const till = new THREE.Mesh(box(0.42, 0.28, 0.36, 1.19), lambert({ color: 0x24292e })); till.position.set(F.L.width * 0.5, 0, F.L.counter); g.add(till);
    }
    // Shelves along the back wall (of the shop floor), stocked -- where the trade keeps them there.
    const shelfZ = F.store ? F.store.floorEnd - 0.3 : Math.min(F.D - 0.3, F.L.back + 0.6);
    // What it sells, on the shelves as itself (objects.mjs): its wares with a model, a run of each,
    // as many as a player's business has in stock; the rest as plain stock.
    const sells = storesAt(R, place.keys).flatMap((st) => st.items).filter((id, i, all) => all.indexOf(id) === i && R.items[id] && !R.items[id].service && !R.items[id].parcel);
    const biz = view?.bizAt?.(place.id);
    const modelled = kit ? sells.filter((id) => bindingOf(OBJ, id) && (R.items[id].length_m || 0) <= 0.6) : [];
    if (!F.store || F.store.rearShelves) [0.45, 1.05, 1.65].forEach((h0, row) => {
      const shelf = new THREE.Mesh(box(F.W - 0.6, 0.04, 0.4, h0), lambert({ color: 0x6b5440 })); shelf.position.z = shelfZ; g.add(shelf);
      const n = Math.max(4, Math.floor((F.W - 0.8) / 0.32));
      const r = rng(place.id, "goods", h0);
      // This shelf's wares: a few of the modelled ones in turn, each a run along it.
      const mine = modelled.filter((_, i) => i % 3 === row);
      if (mine.length) {
        const width = F.W - 1, per = Math.max(1, Math.floor(n / mine.length));
        mine.slice(0, n).forEach((id, j) => {
          const have = biz ? Math.min(per, biz.stock?.[id] || 0) : per;
          if (have <= 0) return;
          kit.instanced(id, per).then((stock) => {
            if (!stock || !g.parent) return;
            const len = R.items[id].length_m || 0.2, step = Math.max(len * 0.9, width / n);
            for (let k = 0; k < have; k += 1) {
              const x = -F.W / 2 + 0.5 + (j * per + k) * (width / Math.max(1, n - 1));
              E.set(0, Math.PI + (r() - 0.5) * 0.3, 0); Q.setFromEuler(E);
              M.compose(V.set(x, h0 + 0.02, shelfZ), Q, S3.set(1, 1, 1)); stock.set(k, M);
            }
            void step;
            stock.count(have);
            g.add(stock.group);
          }).catch(() => {});
        });
        return;
      }
      const goods = new THREE.InstancedMesh(box(0.22, 0.26, 0.22, 0.13), lambert({ color: 0xffffff }), n);
      for (let k = 0; k < n; k += 1) {
        M.compose(V.set(-F.W / 2 + 0.5 + k * ((F.W - 1) / Math.max(1, n - 1)), h0 + 0.02, shelfZ), Q.identity(), S3.set(0.8 + r() * 0.4, 0.6 + r() * 0.8, 1));
        goods.setMatrixAt(k, M); goods.setColorAt(k, C.setHSL(r(), 0.45, 0.5));
      }
      g.add(goods);
    });
    // Tables toward the window where it serves food or drink.
    if (!F.store && ["cafe", "coffee", "restaurant", "bar", "pub", "bakery", "fast_food", "ice_cream"].includes(kind) && F.L.front > 1.4) {
      const tables = Math.max(1, Math.floor(F.W / 2.2));
      for (let k = 0; k < tables; k += 1) {
        const tx = -F.W / 2 + (k + 0.5) * (F.W / tables);
        const table = new THREE.Group(); table.position.set(tx, 0, 0.9); g.add(table);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8).translate(0, 0.36, 0), lambert({ color: 0x3a3a3a })); table.add(leg);
        const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16).translate(0, 0.74, 0), lambert({ color: 0xd8cbb5 })); table.add(tableTop);
        // The café's table and two chairs (the object lab's street-café set), sized as they are.
        furnish(table, OBJ?.world?.["furniture.street_cafe"]?.assets?.[0], 0.76);
        for (const side0 of [-1, 1]) {
          const chair = new THREE.Group(); chair.position.set(tx + side0 * 0.62, 0, 0.9); chair.rotation.y = side0 > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(chair);
          furnish(chair, OBJ?.world?.["furniture.street_cafe"]?.assets?.[1], 0.9);
        }
      }
    }
    // The shop's name over the counter, and a light to see it all by.
    const stores = storesAt(R, place.keys);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(F.W - 0.4, 3.2), 0.6), new THREE.MeshBasicMaterial({ map: signTexture(stores[0]?.name || place.name || "Shop"), side: THREE.DoubleSide }));
    sign.position.set(0, 2.55, Math.min(F.D - 0.05, shelfZ + 0.18)); sign.rotation.y = Math.PI; g.add(sign);
    for (const lx0 of [-F.W / 4, F.W / 4]) { const lamp = new THREE.Mesh(box(0.9, 0.05, 0.25, 3.15, lx0), flat(0xfffbe8)); lamp.position.z = F.D / 2; g.add(lamp); }
    // (No checkout panel by the door any more: you buy from whoever serves at the till -- clerk.mjs.)
    return g;
  }
  //: The products on a fitted room's shelves: each sold item with a model, as one instanced mesh
  //: of its lowest tier (a few hundred triangles: thousands are faced), as many as fit its stretches
  //: -- a player's business only what it has in stock. The models are the kit's, shared: they
  //: are marked so leaving the shop does not dispose them.
  let aisles = null;
  function stockRoom(g, place, plan) {
    if (!kit) return;
    aisles ||= aisleMap(R);
    const sells = storesAt(R, place.keys).flatMap((st) => st.items).filter((id, i, all) => all.indexOf(id) === i && R.items[id] && !R.items[id].service && !R.items[id].parcel);
    const sizeOf = (id) => itemSize(OBJ, R, id);
    const placed = stockShelves(plan, sectionsFor(plan, sells, aisles.aisleOf, (id) => Boolean(sizeOf(id))), sizeOf, (id) => aisles.displayOf[id]);
    const biz = view?.bizAt?.(place.id);
    for (const [id, list] of placed) {
      const have = biz ? Math.min(list.length, biz.stock?.[id] || 0) : list.length;
      if (have <= 0) continue;
      kit.instanced(id, have, "low").then((stock) => {
        if (!stock || !g.parent) return;
        for (let k = 0; k < have; k += 1) {
          const q = list[k];
          E.set(0, q.yaw, 0); Q.setFromEuler(E);
          M.compose(V.set(q.x, q.y, q.z), Q, S3.set(1, 1, 1)); stock.set(k, M);
        }
        stock.count(have);
        stock.group.userData.shared = true;
        g.add(stock.group);
        if (shop.room === g) floor.stocked(id, stock, list, have, g);
      }).catch(() => {});
    }
    // Strip lights down each aisle and the hanging signs: drawn by storeFixtures (signs).
  }
  //: The same for a fitted store (Codex's retail engine, inferred-interiors/retail-fixtures.mjs):
  //: each fixture's shelves, in its own frame, stocked from the grocery's range for the engine's
  //: section -- each fixture starting at its own place in the list, so no two bins are alike.
  const ENGINE_AISLES = { produce: ["produce"], dairy: ["dairy"], meat_and_deli: ["meat_seafood"], frozen: ["frozen"], drinks: ["drinks"], beverages: ["drinks"], bakery: ["bakery"], pantry: ["pantry", "condiments", "spices"], cereal_and_snacks: ["breakfast", "snacks"], household: ["household", "personal_care", "pets"], snacks: ["snacks", "checkout"], checkout: ["checkout"] };
  if (kit) globalThis.kerbsideStockShelf = (parent, shelves, { section = "pantry", id = "" } = {}) => {
    aisles ||= aisleMap(R);
    // (What the shop being drawn sells, where it is one of the city's; a grocery's range otherwise.)
    const at = parent.updateWorldMatrix && (parent.updateWorldMatrix(true, false), parent.matrixWorld.elements);
    const owner = at && (district.places || []).find((pl) => pl.shops?.length && Math.hypot(pl.x - at[12], pl.z - at[14]) < 40 && storesAt(R, pl.keys).length);
    const own = owner ? storesAt(R, owner.keys).flatMap((st) => st.items).filter((x) => R.items[x] && !R.items[x].service && !R.items[x].parcel) : [];
    const range = own.length ? own : R.stores.kinds.grocery?.items || [], sizeOf = (x) => itemSize(OBJ, R, x);
    let ids = range.filter((x) => (ENGINE_AISLES[section] || ["pantry"]).includes(aisles.aisleOf[x]) && sizeOf(x));
    if (!ids.length) return false;
    const turn = hash32(String(id), "stock") % ids.length;
    ids = [...ids.slice(turn), ...ids.slice(0, turn)];
    const placed = stockShelves({ shelves }, { [section]: ids }, sizeOf, (x) => aisles.displayOf[x], { cap: 360 });
    for (const [sku, list] of placed) kit.instanced(sku, list.length, "low").then((stock) => {
      if (!stock || !parent.parent) return;
      list.forEach((q, k) => { E.set(0, q.yaw, 0); Q.setFromEuler(E); M.compose(V.set(q.x, q.y, q.z), Q, S3.set(1, 1, 1)); stock.set(k, M); });
      stock.count(list.length); stock.group.userData.shared = true; parent.add(stock.group);
      fittedDrawn.push({ sku, stock, list, have: list.length, obj: parent });
      if (fittedDrawn.length > 4000) fittedDrawn.splice(0, fittedDrawn.length - 4000);
      if (floor.active() && !shop.place) floor.stocked(sku, stock, list, list.length, parent);
    }).catch(() => {});
    return placed.size > 0;
  };
  globalThis.kerbsideTill = (obj, o) => { fittedDrawn.push({ obj, till: o }); if (floor.active() && !shop.place) floor.till(obj, o); };
  //: Into the shop beside you: through its door, into the room, the counter in front of you.
  //: Enter at the door of a building with a shop in it (the page's door, module 24): into the
  //: shop's room, or its counter where it has none; false where no shop of the city's is there.
  function enterBuilding(id) {
    if (!self() || car.active || transit.ride || court.active || police.locked) return false;
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
    // A shop whose building has its interior fitted (the Interior Studio's, or the one inferred for
    // its trade and its space) is walked into as that interior; its staff, at work, get the room
    // their tasks are laid out in.
    if (!asStaff && !isMyWorkplace(place) && ctx.enterFittedShop?.(place.id)) { notify(`In ${storesAt(R, place.keys).map((x) => x.name).join(" and ") || place.name || "the shop"}. Walk up to whoever is serving and they'll ask what you want; click a chair to sit. Walk out through the door to leave.`); refresh(); return true; }
    shop.place = place; shop.frame = F; shop.staff = asStaff || isMyWorkplace(place) || view.bizAt(place.id)?.owner === self()?.account;
    if(F.restaurant) (district.placeById?.get(place.id) || place).diningFrame=F;
    shop.room = buildRoom(place, F); group.add(shop.room);
    if (F.store && !shop.staff) floor.room(place, F, F.store, shop.room);
    ctx.setFloor?.(F.y);
    shop.was = Boolean(ctx.isFirstPerson?.());
    ctx.firstPerson?.(true);
    // A couple of steps in: turned round, the checkout panel by the door is in plain view.
    const start = F.restaurant || F.store ? F.at(.6,(F.restaurant || F.store).doorX) : F.at(Math.max(0.9, Math.min(1.9, F.L.counter - 0.7)), 0);
    ctx.placeAvatar(start.x, F.y, start.z, Math.atan2(-F.I.nx, -F.I.nz));
    ctx.setPitch?.(-0.06);
    if(F.restaurant) notify(shop.staff ? "Your shift: V for your task. Walk back through the entrance to leave." : "Walk up to the counter and you'll be asked what you'd like; click a chair to sit. Walk back through the entrance to leave.");
    else notify(`In ${storesAt(R, place.keys).map((x) => x.name).join(" and ") || place.name || "the shop"}. ${shop.staff ? "V for your task." : "Walk up to the till and you'll be asked what you're after."} Enter at the door, or walking out, leaves.`);
    refresh();
    return true;
  }
  function leaveShop(quiet = false) {
    if (!shop.place) return;
    standUp(); hideClerk(); shopWin?.close();
    floor.close();
    const F = shop.frame;
    delete (district.placeById?.get(shop.place.id) || shop.place).diningFrame;
    shop.room?.removeFromParent();
    shop.room?.traverse((o) => {
      // The kit's models are shared with every other shop and the street: only the shelf's own
      // instance buffers go.
      if (o.userData?.shared || o.parent?.userData?.shared) { if (o.isInstancedMesh) o.dispose?.(); return; }
      o.geometry?.dispose?.(); if (o.material) for (const m of [].concat(o.material)) { m.map?.dispose?.(); m.dispose?.(); }
    });
    shop.place = null; shop.room = null; shop.frame = null;
    ctx.setFloor?.(null);
    if (!shop.was) ctx.firstPerson?.(false);
    const exit=F.at(-1.6,(F.restaurant || F.store)?.doorX || 0);
    ctx.moveAvatarTo(exit.x,exit.z);
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
    const plan0 = F.restaurant || F.store;
    if (want.u < .24 && (!plan0 || Math.abs(want.v-plan0.doorX)<.65)) { leaveShop(); return true; }
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
    let at;
    if(F.restaurant || F.store){
      const plan=F.restaurant || F.store, ok=F.restaurant ? canWalkRestaurant : canWalkStore;
      let x=was.v, z=was.u;
      if(ok(plan,want.v,z,behind)) x=want.v;
      if(ok(plan,x,want.u,behind)) z=want.u;
      at=F.at(z,x);
    }else at=F.at(u,v);
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
    if(F.restaurant){
      const r=F.restaurant;return {counter:F.at(r.counterZ+.52,r.aisle),back:F.at(Math.min(r.depth-.94,r.counterZ+1.3),r.aisle),kerb:F.at(-1.4,r.doorX)};
    }
    if(F.store){
      // Behind the till (its staff side), and the stock room (or the back of the floor).
      const s=F.store, till=s.fixtures.find(f=>f.role==="till"||f.role==="bar"), lane=s.fixtures.find(f=>f.role==="checkout");
      const counter=lane ? (({cashier:c})=>F.at(c.z,c.x))(lanePoints(lane)) : till ? (till.side ? F.at(till.z,till.x+till.side*.75) : F.at(till.z+.7,till.x)) : F.at(1.5,0);
      const part=s.fixtures.find(f=>f.role==="partition");
      return {counter,back:part?F.at(Math.min(s.depth-.5,part.z+1.1),part.door):F.at(s.floorEnd-1.2,0),kerb:F.at(-1.4,s.doorX)};
    }
    return { counter: F.at(F.L.staff, 0), back: F.at(F.L.back, -F.L.width * 0.4), kerb };
  }
  const taskInside = (task) => ["counter", "back"].includes(task?.where) && shopFrame(district.placeById?.get(self()?.job?.place.id) || {});
  async function taskKey() {
    const p = self(), task = p?.clocked?.task;
    if (!p?.clocked) { notify(p?.job ? "Clock in first: Yes when asked at your work." : "No job: take one at a shop that is hiring."); return; }
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
  // front, or on the shoulder) and what the arms do on top of the walk: bend down and lift (a click),
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
    // The object lab's model, once it is in (a delivery's parcel looks like its package).
    const look = id === "parcel" ? self()?.delivery?.pack || id : id;
    // A tool from the hand up; anything else held by its middle, as the drawn shape was.
    kit?.dress(g, look, { upright: ph.hold === "tool", centre: ph.hold !== "tool" }).catch(() => {});
    return g;
  }
  let heldMesh = null, heldItem = null, heldHidden = false, lastStrike = 0;
  function drawHeld() {
    const item = self()?.hands || null;
    // (Food and drink are drawn by the eating, as they are held: eat-play.mjs.)
    if (heldMesh) heldMesh.visible = !heldHidden && !eatPlay.active;
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
    Object.assign(pose, { kind, t0: performance.now(), dur: dur * 1000, at, fn, fired: false, mocap: false, step: null });
  }
  //: In the air, and either side of it (body-moves.mjs): ``crouch`` the load before take-off,
  //: ``land`` the knees giving after it.
  const air = { y: 0, v: 0, up: false, v0: 0, peak: 0, crouch: null, land: null };
  //: How a jump has the body now: body-moves' pose for the crouch, the flight or the landing.
  function jumpBody(now = performance.now()) {
    if (air.crouch) return jumpCrouch((now - air.crouch.t0) / (JUMP.crouch_s * 1000), air.crouch.h);
    if (air.up) return jumpAir(air.v0 ? air.v / air.v0 : 0);
    if (air.land) {
      const t = (now - air.land.t0) / (JUMP.land_s * 1000);
      if (t < 1) return jumpLand(t, air.land.fall);
      air.land = null;
    }
    return null;
  }
  function stepBody(dt) {
    // What is in the hand to eat or drink: held as it is held, eaten as U says.
    const inHand = self()?.hands || null;
    eatPlay.sync(inHand && R.items[inHand]?.kind === "prepared_food" && !car.active && !car.riding && !climbPlay.busy ? inHand : null);
    eatPlay.step(dt);
    if (pose.kind && pose.step) {
      // Stepping in behind the punch (stepInFor), eased to a stop as the fist goes out.
      const S = pose.step, k = Math.min(1, (performance.now() - pose.t0) / 1000 / S.until_s), e = 1 - (1 - k) * (1 - k);
      ctx.moveAvatarTo?.(S.from.x + S.dx * S.by * e, S.from.z + S.dz * S.by * e);
      if (k >= 1) pose.step = null;
    }
    if (pose.kind) {
      const t = (performance.now() - pose.t0) / pose.dur;
      if (!pose.fired && t >= pose.at) { pose.fired = true; try { pose.fn?.(); } catch (error) { console.warn(error); } }
      if (t >= 1) pose.kind = null;
    }
    // Down into the knees first, then off the ground (jumpKey).
    if (air.crouch && performance.now() - air.crouch.t0 >= JUMP.crouch_s * 1000) {
      Object.assign(air, { up: true, v: air.crouch.v, v0: air.crouch.v, y: 0.001, peak: 0, crouch: null, land: null });
    }
    if (air.up) {
      air.y += air.v * dt; air.v -= 9.81 * dt; air.peak = Math.max(air.peak, air.y);
      if (air.y <= 0) { air.y = 0; air.v = 0; air.up = false; air.land = { t0: performance.now(), fall: air.peak }; }
    }
    // Bent down to lift: the hips go down as the back bends.
    const t = pose.kind ? Math.min(1, (performance.now() - pose.t0) / pose.dur) : 0;
    const bend = pose.kind === "pickup" || pose.kind === "strain" ? Math.sin(Math.PI * t) : 0;
    ctx.avatar.userData.lift = air.y - 0.32 * bend - (jumpBody()?.drop || 0);
  }
  //: What you carry (kg): nothing off the city (on the map, not joined).
  const loadKg = (p = self()) => (!p ? 0 : view.carry ? view.carry(p).kg : carriedKg(R, p.inventory));
  //: Your legs' jump: {height, speed} against your weight and what you carry (handling.mjs jumpOf).
  //: Not in the city: your legs at the start's strength, nothing carried.
  const legsNow = () => { const p = self(); return jumpOf(R, p ? p.vitals.strength : R.vitals.start.strength, loadKg(p)); };
  //: Climbing and jumping (climb-play.mjs): Space climbs what is in front, or jumps onto it, over it,
  //: up it, off it, or on the way you were going.
  const climbPlay = createClimbPlay({
    THREE, ctx, notify: (t) => notify(t), legs: legsNow,
    climber: () => { const p = self(); return { strength: p ? p.vitals.strength : R.vitals.start.strength, load_kg: loadKg(p), kg: 75 }; },
  });
  //: Eating and drinking (eat-play.mjs): what is in your hand held as it is held, U a mouthful
  //: (held: all of it). The city is told it was used at the last bite.
  const eatPlay = createEatPlay({
    THREE, ctx, R, notify: (t) => notify(t),
    seated: () => seated.on, firstPerson: () => Boolean(ctx.isFirstPerson?.()), tableAhead: () => tableAhead(),
    // A meal a cook served you: its plate as they made it (burnt, short of something, stacked wrong).
    madeOf: (item) => {
      const meals = self()?.meals || [];
      for (let i = meals.length - 1; i >= 0; i -= 1) {
        const m = meals[i], k = m.plates ? m.dishes.indexOf(item) : -1;
        if (k >= 0 && m.plates[k]) { const made = madeFrom(R, item, m.plates[k]); if (made) made.sig = m.id; return made; }
      }
      return null;
    },
    finish: async (item) => {
      const it = R.items[item] || {};
      const r = await send("use", { item });
      if (!r.ok) { notify(r.error); return false; }
      notify(`Finished the ${(it.name || item).toLowerCase()}: ${Object.entries(r.effect || {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ") || "done"}.`);
      syncSlots(true);
      return true;
    },
  });
  //: Sat at a table: where its top is in front of you (a ray down onto it, 40 cm ahead), for a
  //: plate to be put there. Null where there is no table (a sofa, a bench).
  const tableRay = new THREE.Raycaster();
  function tableAhead() {
    if (!seated.on) return null;
    const a = ctx.avatar, y = a.rotation.y, fx = Math.sin(y), fz = Math.cos(y), floor = seated.floor ?? (me().y - ctx.standY);
    const from = new THREE.Vector3(me().x + fx * 0.4, floor + 1.3, me().z + fz * 0.4);
    tableRay.set(from, new THREE.Vector3(0, -1, 0)); tableRay.far = 1.2;
    const roots = [shop.room, ctx.root].filter(Boolean);
    for (const r of roots) {
      const hit = tableRay.intersectObject(r, true).find((h) => h.point.y > floor + 0.5 && h.point.y < floor + 1.15 && !h.object.name?.startsWith("dish:") && h.object.visible);
      if (hit) return { point: hit.point.clone().add(new THREE.Vector3(0, 0.001, 0)), toward: new THREE.Vector3(-fx, 0, -fz) };
    }
    return null;
  }
  //: E: climb what is in front of you (a fence, a wall, a rock, a tree); on it, let go.
  function climbKey() {
    if (car.active || car.riding || transit.ride || shop.place || entry || self()?.resting) return;
    climbPlay.climbKey();
  }
  //: Space: up by your legs' push against your weight and what you carry (handling.mjs jumpOf) --
  //: at a wall or a fence in front, onto it, over it or up it; on one, off it; running, on the way
  //: you were going.
  function jumpKey() {
    const p = self();
    if (air.up || air.crouch || car.active || car.riding || transit.ride || p?.resting) return;
    if (climbPlay.busy) { climbPlay.jumpKey(); return; }
    const j = legsNow();
    if (j.height < 0.03) { notify(`Carrying ${loadKg(p)} kg, you can barely leave the ground.`); return; }
    if (climbPlay.jumpKey()) return;
    // Bent down first, then up: the take-off is stepBody's, at the bottom of the crouch.
    air.crouch = { t0: performance.now(), v: j.speed, h: j.height };
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
    // On a wall, on its top, in the air: the climb's own pose (every limb to its hold).
    if (climbPlay.pose()) return;
    // Arrested (police.mjs): hands up to the car, then cuffed behind the back, and sat in the back.
    const pp = police.pose;
    if (pp) {
      const B0 = rigBones(), k = Math.max(0, Math.min(1, pp.f ?? 1)), fwd0 = (b, a) => turn(b, -1, 0, 0, a);
      if (pp.kind === "hands_up") { fwd0(B0.rUpper, 2.5 * k); fwd0(B0.lUpper, 2.5 * k); fwd0(B0.rFore, 0.35 * k); fwd0(B0.lFore, 0.35 * k); }
      else {
        fwd0(B0.rUpper, -0.5 * k); fwd0(B0.lUpper, -0.5 * k);
        turn(B0.rUpper, 0, 0, 1, -0.28 * k); turn(B0.lUpper, 0, 0, 1, 0.28 * k);
        turn(B0.rFore, 0, 1, 0, -0.9 * k); turn(B0.lFore, 0, 1, 0, 0.9 * k); fwd0(B0.rFore, 0.25 * k); fwd0(B0.lFore, 0.25 * k);
        if (pp.kind === "seated_cuffed") { fwd0(B0.rThigh, 1.4 * k); fwd0(B0.lThigh, 1.4 * k); fwd0(B0.rShin, -1.4 * k); fwd0(B0.lShin, -1.4 * k); }
      }
      if (B0.rHand && B0.lHand) { ctx.avatar.updateMatrixWorld(true); B0.rHand.getWorldPosition(handR); B0.lHand.getWorldPosition(handL); police.placeCuffs(handR, handL); }
      return;
    }
    // Food or a drink in hand: held as it is held, raised to the mouth (eat-play.mjs).
    if (eatPlay.pose()) return;
    const B = rigBones(), p = self();
    const hold = p?.hands && !heldHidden ? physOf(R, p.hands).hold : null;
    const fwd = (b, a) => turn(b, -1, 0, 0, a);
    // Getting into a car or out of it (car-entry.mjs): sat down -- the hips bent, the knees bent
    // back so the shins hang -- the back over as the body goes in, the hands to the wheel.
    if (entry?.pose) {
      const P = entry.pose, seated = P.drop / 0.45;
      if (B.rThigh && B.lThigh) { fwd(B.rThigh, P.thigh); fwd(B.lThigh, P.thigh); fwd(B.rShin, P.shin); fwd(B.lShin, P.shin); }
      fwd(B.spine, -P.lean);
      fwd(B.rUpper, 0.55 * seated); fwd(B.lUpper, 0.55 * seated); fwd(B.rFore, 0.6 * seated); fwd(B.lFore, 0.6 * seated);
      return;
    }
    // Afloat (swim, and the page's module 33, which lays the body down to swim): a front crawl --
    // each arm in turn back over the water and forward past the head, then pulled down under the
    // body to the hip, the legs fluttering -- or, treading water upright, the arms sculling out to
    // the sides and the legs pedalling.
    const sw = ctx.avatar.userData.swim;
    if (sw) {
      const ph = sw.phase, TAU = Math.PI * 2, legs = Boolean(B.rThigh && B.lThigh && B.rShin && B.lShin);
      if (sw.mode === "swim" || sw.mode === "sprint") {
        fwd(B.rUpper, -(ph % TAU)); fwd(B.lUpper, -((ph + Math.PI) % TAU));
        fwd(B.rFore, 0.2 + 0.45 * Math.max(0, Math.sin(ph))); fwd(B.lFore, 0.2 + 0.45 * Math.max(0, -Math.sin(ph)));
        if (legs) {
          const k = Math.sin(ph * 2.2) * (sw.mode === "sprint" ? 0.34 : 0.24);
          fwd(B.rThigh, k); fwd(B.lThigh, -k); fwd(B.rShin, -0.2 - 0.25 * Math.max(0, k)); fwd(B.lShin, -0.2 - 0.25 * Math.max(0, -k));
        }
      } else {
        const sc = Math.sin(ph);
        turn(B.rUpper, 0, 0, 1, -1.0); turn(B.lUpper, 0, 0, 1, 1.0);
        fwd(B.rUpper, 0.35 + 0.3 * sc); fwd(B.lUpper, 0.35 - 0.3 * sc); fwd(B.rFore, 0.55); fwd(B.lFore, 0.55);
        if (legs) {
          fwd(B.rThigh, 0.65 + 0.35 * sc); fwd(B.lThigh, 0.65 - 0.35 * sc);
          fwd(B.rShin, -1.0 - 0.35 * Math.cos(ph)); fwd(B.lShin, -1.0 + 0.35 * Math.cos(ph));
        }
      }
      return;
    }
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
    // (A motion-captured move is the mixer's, blended in and out there: module 22 playWalkerMove.)
    if (pose.mocap) return;
    // The one-shots below are turns laid over the clip underneath: faded in over their first
    // tenth of a second and back out over their last, so the arms do not jump into a guard from
    // the walk and back (docs/71: they snapped both ways).
    const span = pose.dur / 1000 || 0.4, env = ease(Math.min(1, (t * span) / 0.1, ((1 - t) * span) / 0.14));
    const fwdE = (b, a) => turn(b, -1, 0, 0, a * env), turnE = (b, x, y, z, a) => turn(b, x, y, z, a * env);
    if (pose.kind === "swing") {
      // Empty-handed a straight punch from a guard; holding something, a swing wound up over the
      // shoulder and brought through the target (body-moves.mjs), at the target's height.
      const arm = pose.aim?.arm ?? Math.PI / 2;
      const S = p?.hands ? swingPose(t, arm, hold === "two_hands" || hold === "shoulder") : punchPose(t, arm);
      fwdE(B.rUpper, S.rUpper); fwdE(B.rFore, S.rFore); fwdE(B.lUpper, S.lUpper); fwdE(B.lFore, S.lFore);
      if (S.rSide) turnE(B.rUpper, 0, 0, 1, -S.rSide);
      if (S.lSide) turnE(B.lUpper, 0, 0, 1, S.lSide);
      turnE(B.spine, 0, 1, 0, S.twist); fwdE(B.spine, S.lean);
      if (p?.hands) inHand();
      return;
    }
    if (pose.kind === "thrust") {
      // Drawn back to the hip with both hands on it, then driven straight out at the target's
      // height, the back leaning into it.
      const arm = pose.aim?.arm ?? Math.PI / 2;
      const back = t < 0.45 ? ease(t / 0.45) : Math.max(0, 1 - ease((t - 0.45) / 0.2));
      const out = t < 0.45 ? 0 : t < 0.7 ? ease((t - 0.45) / 0.25) : 1 - ease((t - 0.7) / 0.3);
      const lvl = Math.max(0.6, Math.min(1.8, arm));
      fwdE(B.rUpper, 0.2 * (1 - back) + lvl * out); fwdE(B.rFore, 1.4 * back + 0.1 * out);
      fwdE(B.lUpper, 0.35 + (lvl - 0.2) * out); fwdE(B.lFore, 1.2 * back + 0.35 * out);
      fwdE(B.spine, 0.12 * back - 0.25 * out);
      inHand();
      return;
    }
    if (pose.kind === "work") {
      // A stroke of work: a saw drawn back and pushed through (the arm level, to and fro), a pry
      // leaned back on, bolt cutters squeezed shut.
      const v = work.verb, k = Math.sin(Math.PI * t);
      if (v === "Saw") { fwdE(B.rUpper, 1.1 + 0.25 * Math.cos(2 * Math.PI * t)); fwdE(B.rFore, 0.6 - 0.5 * Math.cos(2 * Math.PI * t)); fwdE(B.lUpper, 0.6); fwdE(B.lFore, 1.3); fwdE(B.spine, -0.25); }
      else if (v === "Pry") { fwdE(B.rUpper, 1.0 - 0.3 * k); fwdE(B.lUpper, 1.0 - 0.3 * k); fwdE(B.rFore, 0.4); fwdE(B.lFore, 0.4); fwdE(B.spine, 0.2 * k - 0.15); }
      else { fwdE(B.rUpper, 1.1); fwdE(B.lUpper, 1.1); fwdE(B.rFore, 0.3 + 0.4 * k); fwdE(B.lFore, 0.3 + 0.4 * k); turnE(B.rUpper, 0, 0, 1, 0.25 * k); turnE(B.lUpper, 0, 0, 1, -0.25 * k); }
      inHand();
      return;
    }
    if (pose.kind === "push") {
      // Both hands up to the chest and out, the back leaning in behind them.
      const out = t < 0.5 ? ease(t / 0.5) : 1 - ease((t - 0.5) / 0.5);
      fwdE(B.rUpper, 1.1 + 0.4 * out); fwdE(B.lUpper, 1.1 + 0.4 * out); fwdE(B.rFore, 1.3 - 1.1 * out); fwdE(B.lFore, 1.3 - 1.1 * out);
      fwdE(B.spine, 0.3 * out);
      return;
    }
    if (pose.kind === "dig") {
      // Both hands on the handle: lean on it and step it in, lever the handle back, then lift the
      // spadeful and turn it out to the side.
      const inS = Math.min(1, t / 0.45), lev = t < 0.45 ? 0 : Math.min(1, (t - 0.45) / 0.25), lift = t < 0.7 ? 0 : (t - 0.7) / 0.3;
      const k = Math.sin(Math.PI * inS);
      fwd(B.spine, 0.35 * k + 0.25 * (1 - lev) * (t >= 0.45 ? 1 : 0) - 0.15 * lev * (1 - lift));
      fwd(B.rUpper, 0.45 + 0.35 * lev + 0.6 * Math.sin(Math.PI * lift)); fwd(B.lUpper, 0.6 + 0.2 * lev + 0.5 * Math.sin(Math.PI * lift));
      fwd(B.rFore, 0.5 + 0.3 * k); fwd(B.lFore, 0.7);
      turn(B.spine, 0, 1, 0, -0.5 * Math.sin(Math.PI * lift));
      inHand();
      return;
    }
    if (pose.kind === "carve") {
      // The piece in the left hand at the chest, the knife drawn away along it in the right.
      const k = Math.sin(Math.PI * t);
      fwd(B.lUpper, 0.85); fwd(B.lFore, 1.45);
      fwd(B.rUpper, 0.8 + 0.25 * k); fwd(B.rFore, 1.5 - 0.6 * k); turn(B.rUpper, 0, 0, 1, -0.2 * k);
      fwd(B.spine, 0.18);
      inHand();
      return;
    }
    if (pose.kind === "hammer") {
      // The left hand holds the nail at the target; the right lifts the hammer and brings it down
      // on the head, from the elbow and wrist.
      const arm = Math.max(0.6, Math.min(1.8, pose.aim?.arm ?? Math.PI / 2));
      const up = t < 0.55 ? ease(t / 0.55) : 1 - ease((t - 0.55) / 0.12);
      fwd(B.lUpper, arm - 0.1); fwd(B.lFore, 0.9);
      fwd(B.rUpper, arm + 0.6 * Math.max(0, up)); fwd(B.rFore, 0.3 + 1.2 * Math.max(0, up));
      fwd(B.spine, 0.1);
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
    // A jump: the crouch, the flight and the landing (jumpBody) -- the legs, the back, and the
    // arms where the hands are free.
    const J = jumpBody();
    if (J) {
      if (B.rThigh && B.lThigh) { fwd(B.rThigh, J.thigh); fwd(B.lThigh, J.thigh); fwd(B.rShin, J.shin); fwd(B.lShin, J.shin); }
      fwd(B.spine, J.lean);
      if (!hold || hold === "hand") { fwd(B.lUpper, J.upper); fwd(B.lFore, J.fore); if (!hold) { fwd(B.rUpper, J.upper); fwd(B.rFore, J.fore); } }
    }
    // Hands on what you push: both out at the chest, the back leaning in behind them.
    if (pushing.on) { fwd(B.rUpper, 1.3); fwd(B.lUpper, 1.3); fwd(B.rFore, 0.35); fwd(B.lFore, 0.35); fwd(B.spine, 0.22); return; }
    // A nail held on the wood: the left hand out to it, the right with what it holds.
    if (nailSet) { fwd(B.lUpper, Math.max(0.6, Math.min(1.8, nailSet.arm)) - 0.1); fwd(B.lFore, 0.9); }
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
    // Empty-handed: a jab, a cross, then a hook (a new combination after a pause), captured
    // moves stepped into and landed only where the fist reaches the body (punchLands).
    if (!p.hands && ctx.hasMove?.(PUNCHES[0])) {
      const now = performance.now();
      if (now - punchAt > PUNCH_RESET_MS) punchN = 0;
      punchAt = now;
      const name = PUNCHES[punchN % PUNCHES.length];
      punchN += 1;
      const reach = ctx.moveReach?.(name) || { at_s: 0.25, ahead_m: 0.65, hand: name === "PunchJab" ? "left" : "right" };
      const played = ctx.playMove(name, { fade: 0.08, out: 0.22 });
      if (played) {
        const at = me(), step = aim?.kind === "person" ? stepInFor(at, aim, reach) : null;
        startAct("swing", played.duration, Math.min(0.95, reach.at_s / played.duration), () => punchLands(aim, reach.hand));
        Object.assign(pose, { mocap: true, step });
        return;
      }
    }
    startAct("swing", p.hands ? SWING.dur_s : PUNCH.dur_s, p.hands ? SWING.hit : PUNCH.hit, () => (aim?.kind === "person" && !p.hands ? punchLands(aim, "right") : strikeKey(null, aim)));
  }
  //: The punches thrown in turn, and the pause (ms) after which the next starts from the jab.
  const PUNCHES = ["PunchJab", "PunchCross", "PunchHook"], PUNCH_RESET_MS = 1400;
  let punchAt = 0, punchN = 0;
  //: A body's half-width at the chest (m), and how near the fist must come to it to land.
  const BODY_R = 0.2, FIST_TOUCH = 0.12;
  //: A step in toward someone a little out of the fist's reach: {from, dx, dz, by, until_s}, the
  //: weight carried forward as the punch goes out; null where they are close enough already.
  function stepInFor(at, aim, reach) {
    const d = Math.hypot(aim.x - at.x, aim.z - at.z), want = Math.max(0.35, (reach.ahead_m || 0.65) + BODY_R - 0.06);
    if (!(d > want + 0.04)) return null;
    return { from: { x: at.x, z: at.z }, dx: (aim.x - at.x) / d, dz: (aim.z - at.z) / d, by: Math.min(0.9, d - want), until_s: Math.max(0.12, reach.at_s || 0.2) };
  }
  //: The fist at the moment it is furthest out: on the body of the one it was thrown at -- where
  //: they are now, not where they were -- or a miss. (It landed on whoever had been aimed at within
  //: 2.4 m, whatever the fist did: docs/71.)
  function punchLands(aim, hand) {
    if (aim?.kind !== "person") return strikeKey(null, aim);
    const q = visible.people.find((e) => e.id === aim.q.id) || aim.q;
    const B = rigBones(), bone = hand === "left" ? B.lHand : B.rHand;
    let d;
    if (bone?.parent) {
      ctx.avatar.updateMatrixWorld(true);
      bone.getWorldPosition(handR);
      ctx.avatar.parent?.worldToLocal(handR);
      d = Math.hypot(handR.x - q.x, handR.z - q.z);
    } else d = Math.hypot(q.x - me().x, q.z - me().z) - 0.75;
    if (!(d <= BODY_R + FIST_TOUCH)) { notify(`The punch misses ${q.person?.name || "them"}: the fist never reached them.`); return; }
    return strikeKey(null, { ...aim, q, x: q.x, z: q.z });
  }
  //: The nearest person or breakable thing within ``reach`` of you, any way round:
  //: {kind: "person", q, x, z, d} or {kind: "thing", t, x, z, d}. Someone is taken over a thing
  //: up to 0.4 m further off (as the blow always has).
  function nearestHittable(reach) {
    const at = me();
    // A person is hit only within arm's length (a little further with something in the hand).
    const who = personInReach(Math.min(reach, self()?.hands ? 1.6 : 1.1), -2), t = strikeTarget(reach);
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
    if (!p.hands) { notify("Nothing in your hand: choose something on the bar (1-8), then a right click uses it."); return; }
    const it = R.items[p.hands] || {};
    if (!it.use && !it.wear) { notify(`Nothing to use a ${it.name?.toLowerCase() || "thing"} for here: X swings it, Q throws it.`); return; }
    // Food and drink: a mouthful at a time (eat-play.mjs), the city told at the last of it.
    if (it.kind === "prepared_food" && eatPlay.active) { eatPlay.press(true); if (!keyHeld.u) eatPlay.press(false); return; }
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
          if (h.offence) { if (h.arrest) police.arrestNow(h.offence, { x: hit.x, z: hit.z }); else { noteIncident("fight", hit.x, hit.z, true); police.crime(h.offence, { x: hit.x, z: hit.z }, { victim: { id: hit.id, name: hit.person?.name } }); } }
          if (h.down) { flings.set(hit.id, { t0: performance.now(), x: hit.x, z: hit.z, dx: fx, dz: fz, speed: 2, throw: 0.6 }); district.city?.forget(hit.id); }
          notify(`The ${name} hits ${hit.person?.name || "someone"} (${r.energy} J): ${h.injury.type}. ${h.response === "hit back" ? `They come at you: -${h.hurt} health.` : h.response === "down" ? "They go down." : h.response === "arrest" ? "A police officer: you are arrested and cited." : "They run."}${h.fine ? ` Battery: a ${R.fmt(h.fine)} citation.` : ""}`);
          if (h.response === "hit back") knockBack(Math.sin(yaw), Math.cos(yaw), 1.5);
        } else notify(r.lands === "spills" ? `The ${name} spills where it lands.` : r.lands === "breaks" ? `The ${name} breaks where it lands${r.landed ? `: ${R.items[r.landed].name.toLowerCase()} on the ground` : ""}.` : `Thrown ${Math.round(Math.hypot(end[0] - at.x, end[2] - at.z))} m at ${Math.round(r.speed)} m/s: it lies there (a click picks it up).`);
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
    if (it && (it.use || it.wear)) out.push({ id: "use", label: it.wear ? (Object.values(p.worn || {}).includes(p.hands) ? `Take off the ${name}` : `Wear the ${name}`) : `${it.kind === "prepared_food" || it.use.stamina ? "Eat or drink" : "Use"}: ${name}`, key: "Right click", run: useSelected });
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
    reportStrike(t, r);
  }
  //: What a blow did, in the notice: broken (and what is left of it), or how far along it is --
  //: with ``how`` (strike-preview.mjs: the point goes in 4 mm and sticks) when there is one.
  function reportStrike(t, r, how = null, verb = null) {
    const p = self();
    const tool = r.tool === "fists" ? "Bare hands" : r.tool === "vehicle" ? "Your car" : R.items[p?.hands]?.name || r.tool;
    if (r.broken) {
      if (t.nature) ctx.fellTree?.(t.nature); else hideBroken(t.key, t.o, t.i);
      if (r.task) { notify(r.task.done ? `${r.task.title}: done — ${R.fmt(r.task.pay)} paid.` : `Felled: ${r.task.felled} of ${r.task.need} dead trees.`); return; }
      notify(`${tool}: the ${t.spec.name.toLowerCase()} breaks.${r.salvage ? ` Left on the ground: ${R.items[r.salvage].name.toLowerCase()} (a click picks it up).` : ""}${r.fine ? ` Seen: a ${R.fmt(r.fine)} vandalism fine and ${R.fmt(r.restitution)} for the repair.` : ""}`);
    } else notify(`${verb ? `${verb}: ${tool.toLowerCase()} on` : `${tool} on`} the ${t.spec.name.toLowerCase()} (${t.spec.material})${how ? `: ${how}` : ""}. ${r.joules} J, ${Math.round(r.share * 100)}% of what breaks it.${r.hurt ? ` That hurt: -${r.hurt} health.` : ""}`);
  }

  // ---- C (thrust), R (work), Y / N, and the hint strip (affordances.mjs, docs/63) ----------------
  //: The engine, for what a thrust or a stroke looks like (made on first need from the catalogue).
  let mech = null;
  const mechanics = () => { if (!mech && catalogue?.mechanics) { try { mech = createMechanics(catalogue); } catch { mech = false; } } return mech || null; };
  const isWood = (t) => Boolean(t?.nature) || /lumber|wood|deadwood|timber/.test(String(t?.spec?.material || ""));
  //: What is in the hand, as affordances.mjs reads it.
  function heldState() {
    const p = self(), id = p?.hands;
    const spec = id && (p.inventory?.[id] || 0) > 0 ? R.items[id] : null;
    if (!spec) return null;
    const ph = physOf(R, id);
    return { id, name: spec.name, kind: spec.kind, strike: spec.strike || null, use: spec.use || null, wear: spec.wear || null,
      food: spec.kind === "prepared_food" || Boolean(spec.food), drink: Boolean(spec.drink || eatPlay.what?.form === "drink"), two_hands: ph.hold === "two_hands",
      nails: (p.loose?.nails || 0) + (p.inventory?.nails || 0) + (p.inventory?.nail || 0) + (nailSet ? 1 : 0) };
  }
  //: The thing in front for X, C and R, as affordances.mjs reads it (and the strike target itself).
  function frontThing() {
    const reach = R.tools.reach_m, who = personInReach(Math.min(reach, self()?.hands ? 1.6 : 1.1), -2), t = strikeTarget(reach);
    if (who && (!t || Math.hypot(who.x - me().x, who.z - me().z) <= Math.hypot(t.x - me().x, t.z - me().z) + 0.4))
      return { thing: { name: who.person?.name || "them", person: true }, target: null };
    if (!t) return null;
    return { thing: { name: t.spec.name, material: t.spec.material, wood: isWood(t), chainlink: /chain/i.test(t.spec.name), person: false, loose: Boolean(t.spec.push_kg) }, target: t };
  }
  //: What the page is doing now, for affordances(): built a few times a second.
  function hintState() {
    const p = self();
    const mode = car.active ? "drive" : car.riding || transit.ride ? "ride" : inWater() ? "swim" : climbPlay.mode || (seated.on ? "seated" : shop.room ? "inside" : "walk");
    const ft = mode === "walk" || mode === "inside" ? frontThing() : null;
    const cf = mode === "walk" ? climbPlay.front() : null;
    let ground = null;
    if (p && (mode === "walk" || mode === "inside")) {
      const shelf = floor.near(me(), ctx.getYaw());
      const near = shelf ? null : thingsNear(me().x, me().z, PICK_REACH_M);
      if (shelf) ground = { name: R.items[shelf.item]?.name || "it" };
      else if (near?.length) ground = { name: R.items[near[0].item]?.name || "it" };
    }
    const q = promptShown ? promptsHere().find((x) => x.id === promptShown) : null;
    const w = eatPlay.what, shiftTask = p?.clocked?.task || null;
    return { mode, held: heldState(), ground, under: mode === "walk" ? underfoot() : null, front: { thing: ft?.thing || null, climb: cf?.climb || null, jump: cf?.jump || null },
      prompt: q ? { yes: q.label || "Yes", no: "No" } : null,
      eating: eatPlay.active && w ? { label: w.tool === "hand" ? "A bite" : w.tool === "spoon" ? "A spoonful" : w.form === "drink" ? "A sip" : "A forkful" } : null,
      task: shiftTask && Math.hypot(me().x - shiftTask.x, me().z - shiftTask.z) <= R.work_tasks.task_reach_m ? { label: `${shiftTask.label}${working ? "…" : ""}` } : null,
      nail_set: Boolean(nailSet) };
  }

  //: C: drive in the head or the point of what you hold (a crowbar's jab, a sledgehammer's ram)
  //: -- less of a blow than X's swing, but straight at it and no backswing.
  function thrustKey() {
    const p = self();
    if (!p || pose.kind || car.active || car.riding || transit.ride || climbPlay.busy) return;
    const s = hintState();
    if (!s.held) { pushKey(s); return; }
    const a = affordances(s).find((x) => x.id === "thrust");
    if (!a) {
      const held = s.held;
      notify(!TOOL_VERBS[held.strike]?.thrust ? `The ${held.name.toLowerCase()} has no point or head to drive in: X swings it.`
        : "Nothing within reach to drive it into.");
      return;
    }
    const ft = frontThing(), t = ft?.target;
    if (!t) return;
    ctx.faceTo?.(t.x, t.z);
    pose.aim = aimOf({ kind: "thing", t, d: Math.hypot(t.x - me().x, t.z - me().z) });
    const verb = TOOL_VERBS[s.held.strike].thrust;
    startAct("thrust", 0.42, 0.55, () => strikeWith(t, "thrust", verb));
  }
  //: One blow with ``mode`` (thrust | work) at ``t``, reported with what the engine says it does.
  async function strikeWith(t, mode, verb, quiet = false) {
    const at = me();
    if (Math.hypot(t.x - at.x, t.z - at.z) > R.tools.reach_m + 0.6) { notify("It is out of reach now."); return null; }
    const r = await send("strike", { target: { key: t.key, archetype: t.id, x: t.x, z: t.z, own: false, spec: t.spec }, energy: null, witnesses: witnessesNear(t.x, t.z), mode });
    if (!r.ok) { notify(r.error); return null; }
    const M = mechanics();
    const pv = M ? strikePreview(M, { tool: r.tool, material: t.spec.material, tree: Boolean(t.nature), mode, energy_j: r.joules }) : null;
    if (!quiet || r.broken) reportStrike(t, r, pv?.text || null, verb);
    return r;
  }
  //: The engine's hand work (mechanics-work.mjs): made with the engine, on first need.
  let handWork = null;
  const hands = () => { const M = mechanics(); if (M && !handWork) handWork = createWork(M); return handWork; };
  //: The engine's object-on-object laws (mechanics-collide.mjs): made with the engine, on first need.
  let collisions = null;
  const collide = () => { const M = mechanics(); if (M && collisions === null) { try { collisions = createCollisions(M, catalogue); } catch { collisions = false; } } return collisions || null; };
  //: What the ground underfoot is, for a spade: the page says road and pavement; open ground in
  //: the city is taken as a lawn, out in the landscape as loam.
  function underfoot() {
    const at = me(), kind = ctx.groundKind?.(at.x, at.z) ?? "turf";
    const M = mechanics(), raw = M ? M.data.substances[kind] : null;
    return { kind, name: ({ turf: "lawn", soil_loam: "soil", asphalt: "asphalt", concrete: "pavement" })[kind] || String(raw?.name || kind).toLowerCase(), soil: raw?.family === "soil" };
  }

  //: C with nothing in the hand: push what is in front -- shove a person (mechanics-work.mjs shove:
  //: they rock, stagger or go over by their balance), push a loose thing along (by your strength
  //: and your shoes' grip against what it takes to slide it), or learn that it is fixed down.
  function pushKey(s) {
    const K = hands(), p = self();
    if (!K || !p) return;
    const reach = R.tools.reach_m, who = personInReach(1.1, -2), t = strikeTarget(reach);
    const strength = p.vitals?.strength ?? 50, wet = wetNow();
    if (who && (!t || Math.hypot(who.x - me().x, who.z - me().z) <= Math.hypot(t.x - me().x, t.z - me().z) + 0.4)) {
      ctx.faceTo?.(who.x, who.z);
      startAct("push", 0.5, 0.55, async () => {
        const kid = /child|kid|student/i.test(who.person?.role || "") || (who.person?.age ?? 30) < 14, old = (who.person?.age ?? 30) >= 75;
        const r = K.shove({ mass_kg: kid ? 40 : 75, frail: old, braced: Boolean(reacting.get(who.id)) }, { strength, ground: "concrete", wet });
        const yaw = ctx.getYaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw), name = who.person?.name || "they";
        const w = await send("shove", { npc: { id: who.id, name: who.person?.name, role: who.person?.role, x: who.x, z: who.z }, falls: r.outcome === "falls", witnesses: witnessesNear(who.x, who.z) - 1 });
        if (!w.ok) { notify(w.error); return; }
        if (r.outcome === "falls") {
          noteIncident("fight", who.x, who.z, true);
          flings.set(who.id, { t0: performance.now(), x: who.x, z: who.z, dx: fx, dz: fz, speed: r.speed_mps, throw: 0.5 + r.reach_m });
          district.city?.forget(who.id);
        } else scares.set(who.id, { until: performance.now() + 500, dx: fx * Math.min(0.6, r.reach_m * 1.5), dz: fz * Math.min(0.6, r.reach_m * 1.5), k: 0 });
        if (w.ok && w.offence) { if (w.arrest) police.arrestNow(w.offence, { x: who.x, z: who.z }); else police.crime(w.offence, { x: who.x, z: who.z }, { victim: { id: who.id, name: who.person?.name } }); }
        notify(`A shove: ${r.text.replace(/^they/, name)}.`);
      });
      return;
    }
    if (!t) { notify("Shift + X with empty hands pushes what is in front: a person, or something loose (a log, a chair, a crate). To keep pushing something along, click it."); return; }
    ctx.faceTo?.(t.x, t.z);
    const kg = t.spec.push_kg;
    startAct("push", 0.6, 0.55, async () => {
      if (!kg) { notify(`The ${t.spec.name.toLowerCase()} is fixed down: it will not move for a push.`); return; }
      const r = K.push({ name: t.spec.name, mass_kg: kg, base: substanceOf(mechanics(), t.spec.material) || "douglas_fir_dry", ground: underfoot().kind, wet }, { strength, ground: underfoot().kind, wet });
      await send("labour", { kind: "push" });
      if (r.moves && r.speed_mps >= 0.05 && t.o) {
        // It goes where it is pushed: a few tenths of a metre a shove, along your facing.
        const yaw = ctx.getYaw(), step = Math.min(0.6, 0.2 + r.speed_mps * 0.3);
        const m = new THREE.Matrix4(); t.o.getMatrixAt(t.i, m);
        m.elements[12] += -Math.sin(yaw) * step; m.elements[14] += -Math.cos(yaw) * step;
        t.o.setMatrixAt(t.i, m); t.o.instanceMatrix.needsUpdate = true; ctx.objects?.()?.invalidate?.(t.o);
      }
      notify(`A push: ${r.text}.`);
    });
  }

  //: R: work at what is in front with what you hold. Held, a stroke at a time while R is down --
  //: saw, pry or cut it (a blow of work), dig the ground underfoot with a spade, carve wood with a
  //: knife. Tapped with a hammer (and nails): one blow on the nail. Let go to stop.
  const work = { on: false, kind: "strike", t: null, verb: null, strokes: 0, busy: false, last: 0 };
  const carving = new Map();   // target key -> {body, mm3}
  const nailing = new Map();   // target key -> the nail's state (mechanics-work.mjs startNail)
  function toolWorkKey(down) {
    if (!down) { if (work.on && work.strokes && work.kind !== "hammer") notify(`${work.verb}: stopped after ${work.strokes} stroke${work.strokes > 1 ? "s" : ""}.`); work.on = false; work.t = null; return; }
    const p = self();
    if (!p || car.active || car.riding || transit.ride || climbPlay.busy) return;
    const s = hintState(), list = affordances(s);
    const a = list.find((x) => x.key === "r");
    // A nail you set, with the hammer in hand: a blow on it, wherever you face.
    if (s.held?.strike === "hammer" && nailSet && Math.hypot(nailSet.point.x - me().x, nailSet.point.z - me().z) <= R.tools.reach_m + 0.4) { hammerBlow(); return; }
    if (a?.id === "task" || (!a && p.clocked)) { taskKey(); return; }
    if (!a) {
      const held = s.held;
      notify(!held ? "R works with a tool: a saw saws wood, a crowbar pries, bolt cutters cut chain, a spade digs, a knife carves, a hammer drives nails."
        : held.strike === "shovel" ? `A spade digs the ground underfoot: ${s.under ? `the ${s.under.name} here` : "here"} is not ground to dig.`
        : held.strike === "knife" || held.strike === "hammer" ? "Nothing wooden in front to work at."
        : !TOOL_VERBS[held.strike]?.work ? `The ${held.name.toLowerCase()} is not a tool to work with: X swings it.` : "Nothing in front to work at.");
      return;
    }
    if (!a.ok) { notify(a.reason); return; }
    if (a.id === "hammer_in") { hammerBlow(); return; }
    if (a.id === "dig") { Object.assign(work, { on: true, kind: "dig", t: null, verb: "Dig", strokes: 0, busy: false }); return; }
    const t = frontThing()?.target;
    if (!t) return;
    ctx.faceTo?.(t.x, t.z);
    if (a.id === "carve") { Object.assign(work, { on: true, kind: "carve", t, verb: "Carve", strokes: 0, busy: false }); return; }
    Object.assign(work, { on: true, kind: "strike", t, verb: TOOL_VERBS[s.held.strike].work, strokes: 0, busy: false });
  }
  //: Each frame while R is down: the next stroke once the last is done.
  function stepToolWork() {
    if (!work.on || pose.kind || work.busy) return;
    if (!keyHeld.r || car.active || climbPlay.busy) { toolWorkKey(false); return; }
    const t = work.t;
    if (work.kind === "dig") { startAct("dig", 1.2, 0.55, () => digStroke()); return; }
    if (work.kind === "carve") { startAct("carve", 0.6, 0.6, () => carveStroke(t)); return; }
    startAct("work", 0.7, 0.6, async () => {
      work.busy = true;
      const r = await strikeWith(t, "work", work.verb, work.strokes > 0 && work.strokes % 6 !== 0);
      work.busy = false;
      if (!r) { work.on = false; return; }
      work.strokes += 1;
      if (r.broken) work.on = false;
    });
  }
  //: A spadeful (mechanics-work.mjs dig): as deep as the soil lets the spade in and the handle lever
  //: it out; the hole is drawn where you stand, wider and darker as it goes down.
  const holes = new Map();     // half-metre spot -> {hole, mesh}
  const HOLE_MAT = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  async function digStroke() {
    const K = hands(), p = self(), u = underfoot();
    if (!K || !p) { work.on = false; return; }
    if (!u.soil) { notify(K.dig(mechanicsTool("spade"), u.kind).text); work.on = false; return; }
    work.busy = true;
    const w = await send("labour", { kind: "dig" });
    work.busy = false;
    if (!w.ok) { notify(w.error); work.on = false; return; }
    const at = me(), key = `${Math.round(at.x * 2) / 2},${Math.round(at.z * 2) / 2}`;
    const h = holes.get(key) || { hole: { volume_l: 0 }, mesh: null, x: Math.round(at.x * 2) / 2, z: Math.round(at.z * 2) / 2 };
    const r = K.dig(mechanicsTool("spade"), u.kind, { strength: p.vitals?.strength ?? 50, wet: wetNow(), hole: h.hole });
    h.hole = r.hole;
    holes.set(key, h);
    drawHole(h);
    work.strokes += 1;
    if (work.strokes === 1 || work.strokes % 4 === 0 || r.outcome !== "dug") notify(`Dig: ${r.text}. The hole is ${Math.round((r.hole.depth_m || 0) * 100)} cm deep.${w.tired ? " You are tiring." : ""}`);
    if (r.outcome !== "dug") work.on = false;
  }
  function drawHole(h) {
    if (!h.mesh) {
      const g = new THREE.CircleGeometry(1, 18); g.rotateX(-Math.PI / 2);
      h.mesh = new THREE.Mesh(g, HOLE_MAT); h.mesh.renderOrder = 2; group.add(h.mesh);
      if (holes.size > 40) { const [k0, h0] = holes.entries().next().value; if (h0.mesh) { group.remove(h0.mesh); h0.mesh.geometry.dispose(); } holes.delete(k0); }
    }
    const r = Math.min(0.45, 0.12 + 0.03 * Math.sqrt(h.hole.volume_l));
    h.mesh.scale.set(r, 1, r);
    h.mesh.position.set(h.x, groundAt(h.x, h.z) + 0.012, h.z);
  }
  //: A carving stroke at a wooden thing (mechanics-work.mjs carve): shavings until your initials
  //: are cut (about 600 mm³), told every few strokes.
  async function carveStroke(t) {
    const K = hands(), M = mechanics();
    if (!K || !M || !t) { work.on = false; return; }
    const c = carving.get(t.key) || { body: M.body({ substance: t.nature ? "red_oak_green" : substanceOf(M, t.spec.material) || "douglas_fir_dry", shape: "block", thickness_m: 0.1 }), mm3: 0 };
    const knife = mechanicsTool("pocket_knife");
    const r = K.carve(knife, c.body, { grain: "along", carved_mm3: c.mm3 });
    work.busy = true;
    const w = await send("labour", { kind: "carve" });
    work.busy = false;
    if (!w.ok) { notify(w.error); work.on = false; return; }
    c.mm3 = r.carved_mm3; c.body = r.body; carving.set(t.key, c);
    work.strokes += 1;
    if (c.mm3 >= 600) { notify(`Carve: your initials are cut into the ${t.spec.name.toLowerCase()}, ${work.strokes} strokes.`); carving.delete(t.key); work.on = false; return; }
    if (r.outcome === "skate") { notify(`Carve: ${r.text}.`); work.on = false; return; }
    if (work.strokes === 1 || work.strokes % 6 === 0) notify(`Carve: ${r.text}.`);
  }
  //: A hammer blow on the nail in front (mechanics-work.mjs drive). Its angle off square is your
  //: steadiness: a little each blow, more when tired, much more when the blows come faster than a
  //: steady rhythm (under 0.65 s apart). A fresh nail is taken from the box first.
  function hammerBlow() {
    const set = nailSet && Math.hypot(nailSet.point.x - me().x, nailSet.point.z - me().z) <= R.tools.reach_m + 0.4 ? nailSet : null;
    const t = set ? set.t : frontThing()?.target;
    if (!t || pose.kind) return;
    ctx.faceTo?.(t.x, t.z);
    pose.aim = aimOf({ kind: "thing", t, d: Math.hypot(t.x - me().x, t.z - me().z) });
    startAct("hammer", 0.55, 0.62, async () => {
      const K = hands(), M = mechanics(), p = self();
      if (!K || !M || !p) return;
      let st = nailing.get(t.key);
      if (st && (st.home || st.bent)) { if (st.bent) notify("Hammer: the bent nail is drawn out with the claw; a new one goes in."); st = null; }
      const w = await send("labour", { kind: "hammer", start_nail: !st && !set });
      if (!w.ok) { notify(w.error); return; }
      if (!st) st = K.startNail(mechanicsTool("nail"), M.body({ substance: t.nature ? "red_oak_green" : substanceOf(M, t.spec.material) || "douglas_fir_dry", shape: "block", thickness_m: 0.2 }));
      const now = performance.now(), rushed = now - work.last < 650;
      work.last = now;
      const wob = hash32(`${t.key}:${st.blows}:${Math.round(now / 1000)}`) / 4294967296;
      const tired = 1 - Math.min(1, (p.vitals?.stamina ?? 100) / 100);
      const angle = 1 + 6 * wob + 10 * tired * wob + (rushed ? 9 : 0);
      const energy = 50 * (0.6 + 0.8 * Math.min(1, (p.vitals?.strength ?? 50) / 100));
      const r = K.drive(mechanicsTool("claw_hammer"), st, { energy_j: energy, angle_deg: angle });
      nailing.set(t.key, r.state);
      if (set && nailSet === set) {
        // The nail you set: in as far as it is driven, leant over as far as it bent.
        set.hit = true; set.driven = Math.max(set.driven, r.state.driven_m || 0); set.bend = r.state.bend_deg || 0; placeNail(set);
        if (r.state.home || r.state.bent) { nailSet = null; drivenNails.push(set); if (drivenNails.length > 40) group.remove(drivenNails.shift().mesh); }
      }
      notify(`Hammer: ${r.text}.${rushed ? " (Steady: a blow every second or so keeps it square.)" : ""}${r.outcome === "home" ? ` ${w.nails} nail${w.nails === 1 ? "" : "s"} left in the box.` : ""}`);
    });
  }
  //: A fresh engine implement by id (cached).
  const toolCache = new Map();
  function mechanicsTool(id) { if (!toolCache.has(id)) toolCache.set(id, mechanics().tool(id)); return toolCache.get(id); }
  //: Y and N: answer the question on screen (the prompt's Yes and No buttons).
  function answerKey(yes) {
    const q = promptShown ? promptsHere().find((x) => x.id === promptShown) : null;
    if (!q) return;
    declined.add(q.id); promptShown = null; if (promptBox) promptBox.hidden = true;
    if (yes) q.run();
  }

  //: The hint strip: what is particular to here (never walking or a plain jump), learned as used.
  let hintBox = null, hintShown = [], lastHints = 0;
  const hintCounts = store.get("kerbside:hint-counts") || {};
  let hintSetting = store.get("kerbside:hints") || "full", countsDirty = 0;
  const seenLabels = new Set();
  function drawHints(now) {
    if (!hintBox) return;
    let chips = [];
    if (court.active || police.locked) { hintBox.replaceChildren?.(); hintBox.hidden = true; return; }
    try {
      if (ctx.enabled() && ctx.cityMode?.() !== false && !side) chips = hintChips(affordances(hintState()), { counts: hintCounts, setting: hintSetting, seenKinds: seenLabels });
    } catch (error) { console.warn("hints", error); chips = []; }
    hintShown = steady(hintShown, chips, now / 1000);
    for (const a of chips) seenLabels.add(a.text);
    const sig = hintShown.map((x) => `${x.chip.id}:${x.chip.text}`).join("|");
    if (sig === hintBox.dataset.sig) return;
    hintBox.dataset.sig = sig;
    hintBox.hidden = !hintShown.length;
    hintBox.replaceChildren(...hintShown.map(({ chip }) => h("button", { className: chip.ok ? "" : "off", title: chip.text, onclick: () => pressHint(chip) },
      h("kbd", { textContent: chip.cap }), h("span", { textContent: chip.text }))));
  }
  //: A chip clicked is its key pressed (touch screens); a key pressed while its chip shows is learned.
  function pressHint(chip) {
    if (!chip.ok) { notify(chip.text); return; }
    if (chip.key === "arrows") { notify("Hold the arrow keys (two together for a diagonal)."); return; }
    if (chip.key === "r") { toolWorkKey(true); keyHeld.r = true; setTimeout(() => { keyHeld.r = false; }, 3500); return; }
    ({ " ": jumpKey, click: pickUp, rclick: useSelected }[chip.key] || KEYS[chip.key])?.();
  }
  function learnKey(key) {
    for (const { chip } of hintShown) if (chip.key === key) { hintCounts[chip.id] = (hintCounts[chip.id] || 0) + 1; countsDirty += 1; }
    if (countsDirty) { countsDirty = 0; store.set("kerbside:hint-counts", hintCounts); }
  }
  function setHints(v) { hintSetting = v; store.set("kerbside:hints", v); if (hintBox) hintBox.dataset.sig = ""; }
  //: What your blow does to ``q``'s body (hit-reaction.mjs, on the mechanics engine): where it
  //: lands, and whether they flinch, stumble back or go down -- by the blow's energy and what it
  //: is struck with, and their weight, height and strength.
  function blowReaction(q) {
    const M = mechanics(), p = self();
    if (!M || !p) return null;
    const sw = swingOf(R, p.hands, p.vitals.strength), [lo, hi] = R.tools.strength_scale;
    const spec = R.tools.kinds[sw.kind] || R.tools.kinds.fists;
    const joules = sw.joules ?? spec.energy_j * (lo + (hi - lo) * Math.max(0, Math.min(100, p.vitals.strength)) / 100);
    const victim = victimOf({ ...(q.person || {}), figure: q.figure || q.person?.figure });
    // A punch is thrown at the face; a swing of a thing in the hand comes in a little lower.
    const aimY = victim.height_m * (sw.kind === "fists" ? 0.88 : 0.8);
    const held = sw.kind === "blunt" ? (R.items[p.hands]?.kg || 0.5) + 2 : undefined;
    try { return { victim, ...blowOn(M, { joules, tool: IMPLEMENT[sw.kind] || "fist", strike_mass_kg: held, aimY, seed: `${q.id}:${Math.round(gameNow())}` }, victim) }; } catch (error) { console.warn("blow", error); return null; }
  }
  //: Someone struck staggers: [id] -> { t0, x, z, dx, dz, dist, dur, flinch }.
  const staggers = new Map();
  const ZONE_WORD = { head: "the face", chest: "the chest", belly: "the stomach", arm: "a raised arm", leg: "the leg" };
  //: A blow to someone: it lands somewhere (their head, chest, stomach, a raised arm), they flinch,
  //: stumble back or go down; then their own instinct takes over: they hit back, call the police,
  //: run, call to the people round for help, or freeze -- or (an officer) arrest you.
  async function strikePerson(q) {
    noteIncident("fight", q.x, q.z, true);
    const inc = incidents[incidents.length - 1];
    const re = blowReaction(q), me0 = me();
    const policeNear = Boolean(patrol.phase) || visible.people.some((e) => e.id !== q.id && ["police", "patrol"].includes(e.person?.role) && Math.hypot(e.x - q.x, e.z - q.z) < 45);
    const r = await send("strike_person", { npc: { id: q.id, name: q.person?.name, role: q.person?.role, age: q.person?.age ?? q.person?.base?.age, strength: re?.victim.strength, x: q.x, z: q.z, yaw: q.yaw },
      witnesses: witnessesNear(q.x, q.z) - 1, reaction: re ? { kind: re.kind, zone: re.zone, steps: re.steps, fracture: re.fracture } : null, near: { police: policeNear } });
    if (!r.ok) { notify(r.error); return; }
    // Caught or not (law.mjs): an officer struck arrests you; otherwise it waits on who saw it.
    if (r.offence) { if (r.arrest) police.arrestNow(r.offence, { x: q.x, z: q.z }); else police.crime(r.offence, { x: q.x, z: q.z }, { victim: { id: q.id, name: q.person?.name } }); }
    const name = q.person?.name || "them";
    // Away from you, along the blow.
    const ax = q.x - me0.x, az = q.z - me0.z, L = Math.hypot(ax, az) || 1, dx = ax / L, dz = az / L;
    if (r.down) {
      flings.set(q.id, { t0: performance.now(), x: q.x, z: q.z, dx, dz, speed: 2, throw: 0.8 + (re?.capture_m || 0) });
      district.city?.forget(q.id);
    } else if (re) {
      // A stumble is a step back for each the blow asked of them; a flinch sways and comes back.
      const steps = Math.max(1, r.reaction?.steps ?? re.steps);
      staggers.set(q.id, re.kind === "stumble" ? { t0: performance.now(), x: q.x, z: q.z, dx, dz, dist: 0.15 + 0.42 * steps, dur: 0.35 * steps + 0.15, flinch: false }
        : { t0: performance.now(), x: q.x, z: q.z, dx, dz, dist: 0.12, dur: 0.45, flinch: true, head: re.zone === "head" });
    }
    // Their instinct, as the city decided it (world.mjs cmd_strike_person): now they act on it.
    const mind = temperamentOf(q.person || { id: q.id });
    const act = { "flee": "flee", "call police": "call", "call for help": "shout", "freeze": "freeze", "hit back": "fight" }[r.response];
    if (act && inc && !r.down) {
      const now = performance.now(), secs = act === "fight" ? 4 : act === "freeze" ? 3 : reactionFor(mind, act === "shout" ? "call" : act);
      reacting.set(q.id, { kind: act, until: now + secs * 1000, ix: me0.x, iz: me0.z, at: { x: q.x, z: q.z }, off: 0, far: REACT.flee_m[0] + (REACT.flee_m[1] - REACT.flee_m[0]) * (1 - mind.nerve), inc, victim: true });
      // Called to for help: those round who would help come (temperament.mjs reactionTo, as at a crash).
      if (act === "shout") noteIncident("help", q.x, q.z, true);
    }
    if (r.response === "hit back") knockBack(dx, dz, 1.5);
    const landed = re ? ` to ${ZONE_WORD[re.zone] || "the body"}` : "";
    const body = r.down ? `${name} goes down` : re?.kind === "stumble" ? `${name} stumbles back` : re?.kind === "flinch" ? `${name} flinches` : name;
    const what = r.response === "arrest" ? `${name} is a police officer: "You're under arrest!"` : r.response === "hit back" ? `they come back at you: -${r.hurt} health`
      : r.response === "call police" ? "they get out their phone and call 911" : r.response === "call for help" ? "they shout for help" : r.response === "freeze" ? "they freeze"
      : r.response === "down" ? "" : "they run";
    notify(`${r.tool === "fists" ? "A punch" : "A blow"}${landed} (${r.joules} J): ${body} — ${r.injury.type}${what ? `; ${what}` : ""}.${r.fine ? ` Battery: a ${R.fmt(r.fine)} citation${r.restitution ? ` and ${R.fmt(r.restitution)} for their care` : ""}.` : ""}`);
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
    const week = Math.floor(timeAt(gameNow()).day / 7);
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
  //: Where a spot is, by its cross streets ("Chestnut St & Pierce St"): every place a task sends
  //: you to is said with them, so "go to the basketball court" is "... at Bay St & Webster St".
  function crossAt(x, z, name = "") {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const c = district.streets?.crossStreets?.(x, z, 320, name);
    if (!c) return null;
    if (!c.cross) return saysStreet(name, c.on) ? null : shortStreet(c.on);
    // An address already says its own street ("2300 Chestnut Street"): the cross street alone.
    if (saysStreet(name, c.on)) return shortStreet(c.cross);
    if (saysStreet(name, c.cross)) return shortStreet(c.on);
    return `${shortStreet(c.on)} & ${shortStreet(c.cross)}`;
  }
  //: "at" its cross street; "near" a corner when the words give an address whose own street is
  //: not among the streets drawn (the corner is then two other streets, and is only close by).
  const crossWord = (words, cross) => (/(^|\s)\d+[A-Za-z]? [A-Z]/.test(words) && cross.includes(" & ") ? "near" : "at");
  //: A place's name with its cross streets after it; left alone when it already carries them.
  function nameAt(name, x, z) {
    if (!name || name.includes(" & ") || / at [A-Z0-9]/.test(name)) return name;
    const cross = crossAt(x, z, name);
    return cross ? `${name} ${crossWord(name, cross)} ${cross}` : name;
  }
  //: A line of the tasks card with its cross streets worked in before any " — what to do there".
  function labelAt(label, x, z) {
    if (label.includes(" & ")) return label;
    const cut = label.indexOf(" — "), head = cut < 0 ? label : label.slice(0, cut), tail = cut < 0 ? "" : label.slice(cut);
    const cross = crossAt(x, z, head);
    if (!cross) return label;
    // After an address ("... at 2109 Chestnut Street") the cross street reads "at Scott St" too.
    return `${head} ${crossWord(head, cross)} ${cross}${tail}`;
  }
  //: A step's words with the cross streets of the places it names (the board's fixed places:
  //: the forestry area, the walk's stops; a courier's shop and address carry theirs already).
  function stepAt(step) {
    const T = R.tasks, spots = [[T.forestry.area.name, T.forestry.area.centre], ...T.sightseeing.stops.map((st) => [st.name, st.at])];
    for (const [name, at] of spots) {
      if (!name || !step.includes(name) || step.includes(" & ")) continue;
      const [x, z] = ctx.fromLonLat(at[1], at[0]);
      return step.replace(name, nameAt(name, x, z));
    }
    return step;
  }
  //: The board's offers. The to-do list asks for them every time the bar is drawn (many times a
  //: second), and each asking went through every place of the district several times: they are
  //: worked out again when the board's slot turns over, the district changes, or you have gone
  //: ten metres (distances on the cards are shown to a tenth of a kilometre).
  const offersKept = { key: "", list: [] };
  function taskOffers() {
    const here = me(), slot = Math.floor(Date.now() / (R.tasks.refresh_minutes * 60000));
    const key = `${slot}|${district.key}|${district.places.length}|${Math.round(here.x / 10)}|${Math.round(here.z / 10)}`;
    if (key !== offersKept.key) { offersKept.key = key; offersKept.list = taskOffersNow(here, slot); }
    return offersKept.list;
  }
  function taskOffersNow(here, slot) {
    const T = R.tasks;
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
      out.push({ kind: "courier", title: `Courier: ${nameAt(placeName(from), from.x, from.z)} → ${nameAt(address(to.name) || "a home", to.x, to.z)}`, km, pay: C.pay_base + Math.round(C.pay_per_km * Math.min(4, km)),
        from: { id: from.id, name: nameAt(placeName(from), from.x, from.z), x: from.x, z: from.z }, to: { id: to.id, name: nameAt(address(to.name) || "a home", to.x, to.z), x: to.x, z: to.z },
        steps: [`Go to ${nameAt(placeName(from), from.x, from.z)} and pick up the order at its door (click it)`, `Take it to ${nameAt(address(to.name) || "the address", to.x, to.z)} and hand it over (Yes, at the door)`] });
    }
    const F = T.forestry, [fx, fz] = ctx.fromLonLat(F.area.centre[1], F.area.centre[0]);
    out.push({ kind: "forestry", title: F.name, km: Math.hypot(fx - here.x, fz - here.z) / 1000, pay: F.pay,
      steps: ["Get an axe or a saw: a hardware store (Enter, then its SHOP panel), or the Shop (top bar)", stepAt(`Go to ${F.area.name}`), `Put the tool on the bar and choose it (1-8), then fell ${F.trees} dead trees (X at a tree)`] });
    const S = T.sightseeing;
    out.push({ kind: "sightseeing", title: S.name, km: Math.min(...S.stops.map((st) => { const [x, z] = ctx.fromLonLat(st.at[1], st.at[0]); return Math.hypot(x - here.x, z - here.z); })) / 1000,
      pay: S.pay, steps: S.stops.map((st) => stepAt(`Visit ${st.name}`)) });
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
      return { label: pick ? `Pick up the order at ${at.name || "the shop"} — click it at its door` : `Deliver to ${at.name || "the address"} — Yes at the door`, x: at.x, z: at.z, colour: 0x35c46a };
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
    // (Your task, a delivery or an errand: clicked, its card opens here -- todoDetail.)
    const mine = p.task || p.delivery ? "task" : p.errand ? "errand" : null;
    if (g) out.push({ label: g.label, x: g.x, z: g.z, now: true, detail: mine, run: () => openSide("tasks") });
    // What comes round again goes first, under where you are headed now: the job and its
    // shifts, and what your businesses and the court ask of you. One-off work comes after.
    const recurring = [];
    if (p.job) {
      const spec = R.jobs.roles[p.job.role], atWork = Math.hypot(me().x - p.job.place.x, me().z - p.job.place.z) < R.jobs.workplace_reach_m;
      if (p.clocked && !p.clocked.task) recurring.push({ label: `At work as ${p.job.title.toLowerCase()}: your next task is coming`, sub: `Tasks every minute or so; R where the orange ring is · ${R.fmt(p.job.pay)}/h`, run: () => openSide("tasks") });
      else if (!p.clocked && !(g && g.label.startsWith("Go to work"))) recurring.push({ label: atWork ? "Clock in: you are at work" : `Work: ${p.job.title} at ${address(p.job.place.name) || "your workplace"}`, sub: `${shiftText(spec)} · ${R.fmt(p.job.pay)}/h`, x: p.job.place.x, z: p.job.place.z, run: () => (atWork ? workKey() : openSide("online")) });
    } else recurring.push({ label: "Find a job", sub: "The Shop's Jobs: hiring near you", run: () => { openSide("online"); side.cat = "jobs"; drawSide(); } });
    recurring.push(...enterprise().todo(p));   // shifts, court, recruiters, your businesses
    recurring.push(...kitchen().todo(p));      // tickets up, the owner's answers, a tip for the cook
    out.push(...recurring);
    if (t?.steps) t.steps.forEach((s, i) => { if (!stepDone(p, i) && !(g && g.label.startsWith(s))) out.push({ label: stepAt(s), sub: t.title, detail: "task", run: () => openSide("tasks") }); });
    if (p.errand && !(g && /^Errand/.test(g.label))) out.push({ label: `Errand for ${p.errand.to.who || "a neighbour"}: ${p.errand.items.map((i) => R.items[i].name.toLowerCase()).join(", ")}`, x: p.errand.to.x, z: p.errand.to.z, detail: "errand", run: () => openSide("tasks") });
    const owed = view?.billing?.owed(p.account) || 0;
    if (owed) out.push({ label: `Pay what you owe: ${R.fmt(owed)}`, sub: "You & wallet", run: () => openPanel(true) });
    if (p.vitals.health < 40) out.push({ label: "You are hurt: rest (Z at a bed) or see a doctor", run: () => openSide("help") });
    if (p.vitals.stamina < R.vitals.stamina.low) out.push({ label: "Tired: eat or drink something (a right click), or rest", run: () => openSide("bag") });
    for (const b of p.bookings || []) {
      const it = R.items[b.item], there = Math.hypot(me().x - b.place.x, me().z - b.place.z) < R.stores.reach_m;
      out.push({ label: there ? `Have your ${it.name.toLowerCase()} here` : `Your booking: ${it.name} at ${address(b.place.name) || "the place"}`, sub: "Booked in the Shop", x: b.place.x, z: b.place.z, run: () => (there ? useBooking(b) : openSide("online")) });
    }
    if (!t && !p.delivery) for (const o of taskOffers()) out.push({ label: o.title, sub: `${R.fmt(o.pay)} · ${o.km.toFixed(1)} km${o.steps?.length ? ` · ${o.steps.length} steps` : ""}`, take: o });
    // Every line that has a place says its cross streets.
    for (const o of out) if (Number.isFinite(o.x) && Number.isFinite(o.z)) o.label = labelAt(o.label, o.x, o.z);
    return out;
  }
  const TODO_SHOWN = 3;
  let todoOpen = false, todoKey = "", todoDetail = null;
  try { todoOpen = globalThis.localStorage?.getItem("kerbside.city.todoOpen") === "1"; } catch { todoOpen = false; }
  function takeOffer(o) {
    send("take_task", { task: o }).then((r) => { notify(r.ok ? `${r.task.title}: ${r.task.steps[0]}.` : r.error); todoKey = ""; drawTodo(); if (side?.kind === "tasks") drawSide(); });
  }
  //: The card for your task ("task": a task or a delivery) or your errand: {title, pay, lines:
  //: [[text, done]], next, x, z, d}, or null when there is none now.
  function detailOf(p, kind) {
    if (!p) return null;
    const here = me(), g = objective();
    if (kind === "errand") {
      const e = p.errand;
      if (!e) return null;
      return { title: `Errand for ${e.to.who || "a neighbour"}`, pay: `Paid back what it costs, and ${R.fmt(e.fee)}.`, lines: [...e.items.map((i) => [`Buy ${R.items[i].name.toLowerCase()}`, (p.inventory[i] || 0) > 0]), [`Bring it to ${e.to.name || "their door"} (Yes at the door)`, false]],
        next: labelAt(e.to.name || "their door", e.to.x, e.to.z), x: e.to.x, z: e.to.z, d: Math.hypot(e.to.x - here.x, e.to.z - here.z) };
    }
    const t = p.task, dl = p.delivery;
    if (!t && !dl) return null;
    const steps = t?.steps || [dl.stage === "pickup" ? `Pick up the order at ${dl.from.name} (click it at its door)` : `Deliver to ${dl.to.name || "the address"}`];
    const ok = g && Number.isFinite(g.x);
    return { title: t?.title || "Delivery", pay: `${R.fmt(t?.pay ?? dl?.pay ?? 0)} on finishing`, lines: steps.map((st, i) => [st, stepDone(p, i)]), next: g?.label || null,
      x: ok ? g.x : undefined, z: ok ? g.z : undefined, d: ok ? Math.hypot(g.x - here.x, g.z - here.z) : null };
  }
  function drawTodo() {
    const box = globalThis.document.getElementById("city-tasks");
    if (!box) return;
    const p = self(), on = Boolean(ctx.enabled() && ctx.cityMode?.() !== false && p);
    if (!on || box.hidden) return;
    const items = todoItems(), shown = todoOpen ? items : items.slice(0, TODO_SHOWN);
    const here = car.active ? car : me(), yaw = ctx.getYaw();
    const metres = (o) => (Number.isFinite(o.x) ? Math.hypot(o.x - here.x, o.z - here.z) : null);
    const card = todoDetail ? detailOf(p, todoDetail) : null;
    if (todoDetail && !card) todoDetail = null;
    const key = JSON.stringify([todoOpen, todoDetail, card && [card.title, card.lines, card.next, Math.round((card.d ?? -1) / 2), Boolean(nav.pts)], items.length, shown.map((o) => [o.label, o.sub, o.now, Math.round((metres(o) ?? -1) / 5)]), Math.round(yaw * 20)]);
    if (key === todoKey) return;
    todoKey = key;
    const H = (tag, props, ...kids) => { const e = Object.assign(globalThis.document.createElement(tag), props); e.append(...kids.filter(Boolean)); return e; };
    // A task's card: what it is, its steps, an arrow to where you go next and how far, and Go there /
    // Close / Cancel. It stays up until closed or cancelled (you are taken to be on your way).
    if (card) {
      let arrow = null;
      if (Number.isFinite(card.x)) {
        const bearing = Math.atan2(-(card.x - here.x), -(card.z - here.z)) - yaw;
        arrow = H("span", { className: "arrow big", textContent: "⬆", title: "This way" });
        arrow.style.transform = `rotate(${(-bearing * 180 / Math.PI).toFixed(0)}deg)`;
      }
      const dist = card.d === null ? "" : card.d < 1000 ? `${Math.round(card.d)} m` : `${(card.d / 1000).toFixed(1)} km`;
      const btn = (text, fn, cls = "") => H("button", { textContent: text, className: cls, onclick: (e) => { e.stopPropagation(); fn(); } });
      box.replaceChildren(H("h4", {}, H("span", { className: "word", textContent: card.title })),
        H("div", { className: "detail" },
          H("div", { className: "head" }, arrow, H("div", {}, card.next ? H("b", { textContent: card.next }) : null, dist ? H("small", { textContent: ` · ${dist}` }) : null)),
          card.pay ? H("p", { textContent: card.pay }) : null,
          H("ol", {}, ...card.lines.map(([text, done]) => H("li", { className: done ? "done" : "", textContent: `${text}${done ? " ✓" : ""}` }))),
          H("div", { className: "acts" },
            Number.isFinite(card.x) ? btn(nav.pts ? "Stop" : "Go there", () => { if (nav.pts) stopNav(); else startNav(card.x, card.z, card.next || card.title); todoKey = ""; drawTodo(); }, "primary") : null,
            btn("Close", () => { todoDetail = null; todoKey = ""; drawTodo(); layoutBars(); }),
            btn("Cancel", () => { const kind = todoDetail; todoDetail = null; stopNav(); send(kind === "errand" ? "cancel_errand" : self()?.task ? "cancel_task" : "cancel_delivery").then((r) => { notify(r.ok ? "Dropped." : r.error); todoKey = ""; drawTodo(); layoutBars(); }); }, "warn"))));
      return;
    }
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
      li.onclick = () => { if (o.detail) { todoDetail = o.detail; todoKey = ""; drawTodo(); layoutBars(); return; } (o.take ? openSide("tasks") : o.run?.()); };
      return li;
    });
    const more = items.length > TODO_SHOWN ? H("button", { textContent: todoOpen ? "▴" : "▾", title: todoOpen ? "Just the top three" : `All ${items.length}`, ariaExpanded: String(todoOpen),
      onclick: () => { todoOpen = !todoOpen; try { globalThis.localStorage?.setItem("kerbside.city.todoOpen", todoOpen ? "1" : "0"); } catch { /* private window */ } todoKey = ""; drawTodo(); layoutBars(); } }) : null;
    const word = H("span", { className: "word", textContent: items.length > TODO_SHOWN && !todoOpen ? `Tasks · ${items.length}` : "Tasks", title: "The task board: work to take", onclick: () => openSide("tasks") });
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
    if (court.active || police.locked) return [];   // (no taxis, buses or doors in court or in cuffs)
    const p = self(), here = me(), out = [];
    if (!p) return [];
    if (cycle.active) return [{ id: "bike", label: "Get off your bicycle", key: "Enter", run: dismountBicycle }];
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
    if (task) out.push({ id: "task", label: working ? `${task.label}: ${Math.min(100, Math.round((performance.now() - working.started) / 10 / working.seconds))}%` : `Task: ${task.label}`, key: "R", run: taskKey });
    const bay = shop.place || nearestPlace(undefined, R.jobs.workplace_reach_m, district.workshops || []);
    if (bay && isWorkshop(R, bay, view.bizAt(bay.id))) out.push({ id: "repair-bay", label: "Repair shop · service desk", key: "", run: () => workshop().open(bay) });
    out.push(...favours.actions());
    if (shop.place) {
      if(shop.frame?.restaurant && shop.staff) out.push(...kitchen().actions(p,here));
      out.push(...floor.actions(here, ctx.getYaw(), gameHour()));
      if (p.hands) out.push(...handActions(p));
      out.push({ id: "leave", label: "Leave by the door", key: "Enter", run: () => leaveShop() });
      return out;
    }
    // Inside a shop's fitted interior (enterShop): buying is from here, and the kitchen to its staff.
    const fittedId = ctx.insideFitted?.(), fitted = fittedId && (district.placeById?.get(fittedId) || district.placeById?.get(Number(fittedId)));
    if (fitted && storesAt(R, fitted.keys).length) {
      out.push(...floor.actions(here, ctx.getYaw(), gameHour()));
      if (view?.kitchenKind?.(fitted) && (isMyWorkplace(fitted) || view.bizAt(fitted.id)?.owner === self()?.account)) out.push(...kitchen().actions(p, here));
      return out;
    }
    const shopAt = nearestShop();
    if (shopAt) out.push({ id: "shop", label: `${shopAt.front ? "Go in" : "Shop"}: ${storesAt(R, shopAt.keys).map((s) => s.name).join(", ")}`, key: "Enter", run: () => { if (!(shopAt.front && enterShop(shopAt))) openStore(shopAt); } });
    out.push(...enterprise().actions(p, here));   // a storefront to lease, your business, your hearing
    out.push(...kitchen().actions(p, here));      // the kitchen, for its staff on shift and its owner
    const thing = thingsNear(here.x, here.z, 3.2)[0];
    if (thing) {
      const kg = R.items[thing.item]?.kg || 0, heavy = kg > liftKg(R, p.vitals.strength);
      out.push({ id: "pick", label: `${heavy ? "Too heavy" : "Pick up"}: ${R.items[thing.item]?.name.toLowerCase() || "it"} (${kg} kg)`, key: "Click", run: pickUp });
    }
    const mine = view.registry.held(p.account).find((a) => a.kind === "vehicle" && a.attrs.x !== undefined && Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z) < 7);
    if (mine) out.push({ id: "car", label: `Drive ${R.vehicles.models[mine.attrs.model].name.toLowerCase()}`, key: "Enter", run: toggleCar });
    if (ownsBicycle()) out.push({ id: "bike", label: "Ride your bicycle", key: "Enter", run: mountBicycle });
    // The bus on Enter, taxis on T: never the same key for both.
    const bus = nearestFare("bus");
    if (bus) out.push({ id: "bus", label: String(bus.id).startsWith("bus:") ? `Board the ${bus.route} to ${bus.nextName || "…"} ${R.fmt(R.transit.bus_fare)}${bus.leaves > 0 ? ` (leaves in ${Math.ceil(bus.leaves)} s)` : ""}` : `Board the bus ${R.fmt(R.transit.bus_fare)}`, key: "Enter", run: () => board(bus) });
    else if (wrongSide) out.push({ id: "bus", label: "Board from the pavement side: the doors are on the kerb side", key: "", run: () => notify("The bus's doors are on its kerb side: walk round to the pavement (or the stop's island) to get on.") });
    else { const stop = nearestStop(30); if (stop) out.push({ id: "stop", label: `Bus stop: ${stop.routes.join(", ")}`, key: "", run: () => openSide("ride") }); }
    const cab = nearestFare("taxi");
    if (cab) out.push({ id: "ride", label: cab.id === taxi.id ? `Get in your taxi (waits ${Math.max(0, Math.ceil(TL.taxi_max_wait_s + ((world || view)?.rideState?.(myId)?.extend ? 60 : 0) - (performance.now() - taxi.waitSince) / 1000))} s)` : "Hail the taxi", key: "Enter", run: () => board(cab) });
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
    if (cycle.active) { dismountBicycle(); return true; }
    if (car.active || car.riding) { toggleCar(); return true; }
    if (transit.ride) {
      if (transit.ride.route) requestStop(); else alight();
      return true;
    }
    const till = floor.active() ? floor.actions(me(), ctx.getYaw(), gameHour()).find((a) => a.id === "pay") : null;
    if (till) { till.run().then(() => refresh()); return true; }
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
    // Your bicycle (it goes with you, wheeled): on it, when nothing else is in reach.
    if (ownsBicycle() && !inWater()) here.push({ d: 6, run: mountBicycle });
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
    const tt = fleetAt(Date.now()), you = me(), seen = new Set();
    const consider = (v) => {
      if (!v?.garage || seen.has(v.id)) return;
      seen.add(v.id);
      const home = district.placeById?.get(v.home);
      if (!home || Math.abs(home.x - you.x) > 160 || Math.abs(home.z - you.z) > 160) return;
      if (!c.garageOpen(v, timeFor(v.owner, tt))) return;
      ctx.garages.near(home.x, home.z, 30, v.home)?.open(2.5);
    };
    for (const e of scan.garaged || []) consider(e.v);
    for (const e of scan.vehicles) consider(e.v);
  }
  const clickRay = new THREE.Raycaster();
  const clickAt = new THREE.Vector3();
  //: The resident under the pointer (nearest along the ray, within arm's width of it), brought up in
  //: the messages with their own sheet; false when nobody is there.
  function talkToClicked(ray) {
    let best = null, bd = Infinity;
    for (const e of visible.people || []) {
      if (!e.person || e.ride) continue;
      clickAt.set(e.x, ctx.groundAt(e.x, e.z) + 0.95, e.z);
      const along = clickAt.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      if (along < 0 || along > 120 || along >= bd || ray.ray.distanceSqToPoint(clickAt) > 0.75 * 0.75) continue;
      best = e; bd = along;
    }
    if (!best) return false;
    const p = best.person, tt = fleetAt(Date.now());
    talkTo({ id: p.id, name: p.name, title: p.title });
    const show = (context) => messages().npc({ id: p.id, name: p.name, title: p.title, role: "resident", tone: context?.tone?.family || "reserved" }, context ? { npc: context } : {});
    const request = district.city.characterContext(p, tt, view);
    if (request.state === "ready") show(request.context);
    else { show(null); request.ready.then(() => { const again = district.city.characterContext(p, tt, view); if (again.state === "ready" && messages().isOpen()) show(again.context); }).catch(() => {}); }
    return true;
  }
  //: A click in the game. In turn: a seat to sit on; letting go of what you are pushing; letting a
  //: nail you have set drop; someone who works here (they come over and ask what you need); a
  //: resident while the messages are open; another player; wood to set a nail in (nails in hand);
  //: the ground, to set down what a click picked up; a thing on the ground (walked to and picked
  //: up, or, too heavy to lift, pushed); something loose in the street (walked up to, to push).
  //: Never a swing: X swings. A press on the food or drink in your hand eats it (pressDown).
  function click(ray) {
    if (!self()) return;
    // A chair, a stool or a booth in a shop or a restaurant: sit down on it.
    if (ray && (shop.room || ctx.insideFitted?.())) { const seat = seatClicked(ray); if (seat) { sitAt(seat); return; } }
    if (!ray) return;
    if (pushing.on) { stopPushing(`You let go of the ${pushing.name.toLowerCase()}.`); return; }
    if (nailSet && !nailSet.hit) { dropSetNail(); return; }
    if (staffClicked(ray)) return;
    // One of the city's people clicked while the messages are open: a conversation with them.
    if (messages().isOpen() && talkToClicked(ray)) return;
    // Another player clicked: who they are in the messages, to add as a friend or write to.
    for (const peer of party.session?.players() || []) {
      const pid = party.ids.get(peer.id);
      if (pid && pid !== myId && peer.avatar?.visible !== false && peer.avatar && ray?.intersectObject(peer.avatar, true).length) { messages().person(pid, peer.name); return; }
    }
    if (car.active || car.riding || transit.ride || climbPlay.busy || pose.kind) return;
    const hand = self()?.hands || null;
    // Nails in the hand, wood clicked: a nail set on it there, held for the hammer.
    if (hand === "nails" || hand === "nail") { const o = objectClicked(ray); if (o && isWood(o)) { setNailAt(o); return; } }
    // What a click picked up, still in the hand: the next click sets it down there.
    if (carry.item && hand === carry.item) { placeAt(ray); return; }
    // A product on a shop's shelf: a step to it, and it is taken (into your hands or basket).
    const shelf = floor.active() ? floor.pickAt(ray, me()) : null;
    if (shelf) { const it = shelf.item; goTo(it.x, it.z, floor.REACH_M * 0.8, () => floor.take(it).then(() => refresh())); return; }
    const t = thingClicked(ray);
    if (t) { fetchThing(t); return; }
    const o = objectClicked(ray);
    if (o) pushUp({ o, arch: o.id, x: o.x, z: o.z, kg: o.spec.push_kg || 0, name: o.spec.name, base: substanceOf(mechanics(), o.spec.material) });
  }

  // ---- the mouse on things ----------------------------------------------------------------------
  //: A press held on the food or drink in your hand: a mouthful at a time while held (eat-play.mjs,
  //: as U); let go and it stops after the mouthful. True when the press was the food's.
  const press = { eat: false };
  function pressDown(ray) {
    if (!self() || !ray || !eatPlay.active || car.active || !eatPlay.root) return false;
    if (!ray.intersectObject(eatPlay.root, true).length) return false;
    press.eat = true; eatPlay.press(true);
    return true;
  }
  function pressUp() { if (press.eat) { press.eat = false; eatPlay.press(false); } }
  const rayPt = new THREE.Vector3();
  const floorAt = (x, z) => (shop.frame && Number.isFinite(shop.frame.y) ? shop.frame.y : groundAt(x, z));
  //: How far along the ray it passes within ``r`` of (x, y, z); Infinity when it does not.
  function alongRay(ray, x, y, z, r) {
    clickAt.set(x, y, z);
    const along = rayPt.copy(clickAt).sub(ray.ray.origin).dot(ray.ray.direction);
    if (along < 0 || along > 45) return Infinity;
    return ray.ray.distanceSqToPoint(clickAt) <= r * r ? along : Infinity;
  }
  //: Where the ray meets the ground (or a shop's floor): {x, y, z, d} or null.
  function groundHit(ray, max = 40) {
    const o = ray.ray.origin, dir = ray.ray.direction;
    for (let d = 0.3; d <= max; d += 0.15) {
      rayPt.copy(o).addScaledVector(dir, d);
      const y = floorAt(rayPt.x, rayPt.z);
      if (rayPt.y <= y + 0.01) return { x: rayPt.x, y, z: rayPt.z, d };
    }
    return null;
  }
  //: The thing on the ground under the pointer (its yellow ring), nearest along the ray.
  function thingClicked(ray) {
    let best = null, bd = Infinity;
    for (const t of thingsNear(me().x, me().z, 30)) {
      const along = Math.min(alongRay(ray, t.x, floorAt(t.x, t.z) + 0.15, t.z, 0.45), alongRay(ray, t.x, floorAt(t.x, t.z) + 0.03, t.z, 0.5));
      if (along < bd) { bd = along; best = t; }
    }
    return best;
  }
  //: The object of the city's catalogue under the pointer (a log, a bench, a post), with where the
  //: ray meets it: {...target, point, normal}. Its own mesh is asked first; else the nearest along
  //: the ray of those close round it.
  const nm3 = new THREE.Matrix3(), im4 = new THREE.Matrix4();
  function objectClicked(ray) {
    const prox = ctx.objects?.();
    if (!prox?.instancesNear) return null;
    const at = me(), list = prox.instancesNear(at.x, at.z, 16, (a) => Boolean(R.objects[archetypeId(a.archetype)]), 40);
    let best = null, bd = Infinity;
    const meshes = new Map();
    for (const t of list) if (t.o) { if (!meshes.has(t.o)) meshes.set(t.o, new Map()); meshes.get(t.o).set(t.i, t); }
    for (const [mesh, byI] of meshes) {
      let hits = [];
      try { hits = ray.intersectObject(mesh, false); } catch { hits = []; }
      for (const hit of hits) {
        const t = byI.get(hit.instanceId);
        if (!t || hit.distance >= bd) continue;
        bd = hit.distance;
        const n = new THREE.Vector3(0, 0, 1);
        if (hit.face) { mesh.getMatrixAt(hit.instanceId, im4); im4.premultiply(mesh.matrixWorld); n.copy(hit.face.normal).applyMatrix3(nm3.getNormalMatrix(im4)).normalize(); }
        else n.copy(ray.ray.direction).negate();
        if (n.dot(ray.ray.direction) > 0) n.negate();
        best = { t, point: hit.point.clone(), normal: n };
        break;
      }
    }
    if (!best) {
      for (const t of list) {
        const along = alongRay(ray, t.x, floorAt(t.x, t.z) + 0.5, t.z, 0.7);
        if (along < bd) { bd = along; best = { t, point: ray.ray.at(along, new THREE.Vector3()), normal: ray.ray.direction.clone().negate() }; }
      }
    }
    if (!best) return null;
    const id = archetypeId(best.t.archetype), spec = R.objects[id];
    if (!spec) return null;
    return { ...best.t, id, key: damageKey(id, best.t.x, best.t.z), spec, point: best.point, normal: best.normal };
  }
  //: Someone who works where you are, under the pointer: they stop what they are doing, come over
  //: to you and ask what you need (staffArrived).
  function staffClicked(ray) {
    const place = placeInside();
    if (!place) return false;
    let best = null, bd = Infinity;
    for (const e of visible.people || []) {
      if (!e.person || !e.indoors || String(e.person.work) !== String(place.id)) continue;
      const along = alongRay(ray, e.x, floorAt(e.x, e.z) + 0.95, e.z, 0.6);
      if (along < bd) { bd = along; best = e; }
    }
    if (!best) return false;
    clerk.dismissed = best.id; hideClerk();
    talkTo({ id: best.person.id, name: best.person.name, title: best.person.title });
    talking.come = { place, since: performance.now() };
    notify(`${best.person.name.split(" ")[0]} is coming over.`);
    return true;
  }

  // ---- carried by a click: picked up, then set down where the next click is --------------------
  const carry = { item: null };
  //: The thing a click picked up, put in your hand (the bar slot it went to, once the inventory has it).
  function holdPicked(item, tries = 0) {
    const i = slots.indexOf(item);
    if (i >= 0 && i < BAR) { carry.item = item; if (chosen !== i) selectSlot(i); return; }
    if (tries < 15) setTimeout(() => holdPicked(item, tries + 1), 100);
    else carry.item = null;
  }
  function fetchThing(t) {
    const pl = self(), ph = physOf(R, t.item), lift = liftKg(R, pl.vitals.strength);
    // Too heavy to lift: up to it, to push it along the ground (if it is the city's to move).
    if (ph.kg > lift && !t.courier) {
      if (t.found || t.debris) { notify(`${ph.name} (${ph.kg} kg) is too heavy for you to lift, and too heavy to shift.`); return; }
      pushUp({ thing: t, material: ph.material, x: t.x, z: t.z, kg: ph.kg, name: ph.name, base: substanceOf(mechanics(), ph.material) });
      return;
    }
    goTo(t.x, t.z, PICK_AT_M, () => reachDown(t, { carry: !t.courier }));
  }
  //: Setting down what you carry where the ground was clicked: walked to, bent down for, put there --
  //: not dropped.
  function placeAt(ray) {
    const g = groundHit(ray), id = carry.item;
    if (!g) { notify("Click the ground where it should go."); return; }
    const put = () => {
      ctx.faceTo?.(g.x, g.z);
      startAct("pickup", 0.95, 0.55, async () => {
        const r = await send("drop", { item: id, spot: { x: g.x, z: g.z } });
        if (!r.ok) { notify(r.error); return; }
        carry.item = null;
        notify(`Set down the ${R.items[id].name.toLowerCase()}.`);
        syncSlots(true);
      });
    };
    goTo(g.x, g.z, 1.0, put);
  }

  // ---- a nail set by hand, then hammered (R) or let go (a click) --------------------------------
  //: {t, point, normal, mesh, driven} while a nail is held on the wood (nails in the hand, wood
  //: clicked): the left hand keeps it there, point in, until the hammer drives it or a click lets
  //: it drop. Driven nails stay in the wood (drivenNails).
  let nailSet = null;
  const drivenNails = [];
  const NAIL_MAT = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.35 });
  function nailMesh() {
    const g = new THREE.Group();
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.0017, 0.0017, 0.089, 6), NAIL_MAT); shank.position.y = 0.0445;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.0016, 12), NAIL_MAT); head.position.y = 0.089;
    g.add(shank, head); g.name = "nail";
    return g;
  }
  const UP = new THREE.Vector3(0, 1, 0);
  function placeNail(n) {
    // The tip at the point, pushed in as far as it is driven; the shank out along the face's normal,
    // leant over by the bend.
    n.mesh.quaternion.setFromUnitVectors(UP, n.normal);
    if (n.bend) { const side = new THREE.Vector3().crossVectors(n.normal, UP); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); n.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(side.normalize(), n.bend * Math.PI / 180)); }
    n.mesh.position.copy(n.point).addScaledVector(n.normal, -n.driven);
  }
  async function setNailAt(o) {
    if (nailSet) return;
    const reachM = R.tools.reach_m;
    if (Math.hypot(o.point.x - me().x, o.point.z - me().z) > reachM) { goTo(o.point.x, o.point.z, reachM * 0.8, () => setNailAt(o)); return; }
    ctx.faceTo?.(o.point.x, o.point.z);
    const w = await send("labour", { kind: "set_nail" });
    if (!w.ok) { notify(w.error); return; }
    const t = { x: o.x, z: o.z, key: o.key, id: o.id, spec: o.spec, o: o.o, i: o.i };
    nailSet = { t, point: o.point.clone(), normal: o.normal.clone(), mesh: nailMesh(), driven: 0.004, bend: 0, arm: aimOf({ kind: "thing", t, d: Math.hypot(o.point.x - me().x, o.point.z - me().z) }).arm };
    nailing.delete(t.key);
    placeNail(nailSet);
    group.add(nailSet.mesh);
    notify(`A nail set on the ${o.spec.name.toLowerCase()}, held point in. Take the hammer (1-8) and tap R to drive it; click again to let it drop.`);
  }
  function dropSetNail() {
    const n = nailSet;
    if (!n) return;
    nailSet = null;
    group.remove(n.mesh);
    send("drop_nail", { spot: { x: n.point.x + n.normal.x * 0.1, z: n.point.z + n.normal.z * 0.1 } }).then((r) => notify(r.ok ? "You let go: the nail drops." : r.error));
  }
  //: Each frame: walk off and leave it, and a nail only set falls; one part driven stays in the wood.
  function stepNailSet() {
    if (!nailSet) return;
    const d = Math.hypot(nailSet.point.x - me().x, nailSet.point.z - me().z);
    if (!nailSet.hit && d > R.tools.reach_m + 0.8) dropSetNail();
    else if (nailSet.hit && d > R.tools.reach_m + 3) { drivenNails.push(nailSet); if (drivenNails.length > 40) group.remove(drivenNails.shift().mesh); nailSet = null; }
  }

  // ---- pushing: hands on it, the arrows push it along --------------------------------------------
  //: {on, o | thing, kg, name, r (mechanics-work.mjs push), gap} while your hands are on something
  //: too heavy to carry: Up walks it along ahead of you at the pace the engine gives (by your
  //: strength and grip against what it takes to slide or roll it); a click lets go.
  const pushing = { on: false, o: null, thing: null, kg: 0, name: "", r: null, gap: 1, x: 0, z: 0, laid: 0, sent: 0, worked: 0, S: null, touch: null, stuck: false, speed: 0, slid: 0, said: null };
  const arrowsHeld = new Set();
  function pushUp(target) {
    if (!target.kg) { notify(`The ${target.name.toLowerCase()} is fixed down: it will not move.`); return; }
    goTo(target.x, target.z, 1.05, () => startPushing(target));
  }
  function startPushing(target) {
    const K = hands(), p = self();
    if (!K || !p) return;
    ctx.faceTo?.(target.x, target.z);
    const wet = wetNow(), g = underfoot().kind;
    const r = K.push({ name: target.name, mass_kg: target.kg, base: target.base || "douglas_fir_dry", ground: g, wet }, { strength: p.vitals?.strength ?? 50, ground: g, wet });
    const at = me();
    Object.assign(pushing, { on: true, o: target.o || null, thing: target.thing || null, kg: target.kg, name: target.name, r, x: target.x, z: target.z, laid: 0, sent: performance.now(), worked: performance.now(),
      gap: Math.max(0.75, Math.min(1.6, Math.hypot(target.x - at.x, target.z - at.z))), S: pushedStats(target), touch: null, stuck: false, speed: 0, slid: 0, said: null });
    notify(r.moves ? `Hands on the ${target.name.toLowerCase()}: Up pushes it along (${r.text}). Click to let go.` : `Hands on the ${target.name.toLowerCase()}: ${r.text}. Click to let go.`);
  }
  function stopPushing(msg = null) {
    if (!pushing.on) return;
    pushing.on = false;
    if (pushing.o) ctx.objects?.()?.invalidate?.(pushing.o.o);
    if (pushing.thing) send("move_item", { id: pushing.thing.id, to: { x: pushing.x, z: pushing.z } });
    if (msg) notify(msg);
  }
  //: Each frame while pushing: Up held, it goes ahead of you along your facing, waiting for you
  //: when it gets a stride ahead; walk off or turn away and your hands come off it.
  function stepPushing(dt) {
    if (!pushing.on) return;
    if (car.active || climbPlay.busy || !self()) { stopPushing(); return; }
    const at = me(), yaw = ctx.getYaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const dx = pushing.x - at.x, dz = pushing.z - at.z, d = Math.hypot(dx, dz);
    if (d > pushing.gap + 1.6) { stopPushing(`You let go of the ${pushing.name.toLowerCase()}.`); return; }
    if (!arrowsHeld.has("ArrowUp") || !pushing.r?.moves) return;
    if ((dx * fx + dz * fz) / Math.max(d, 1e-6) < 0.5 || d > pushing.gap + 0.35) return;
    const v = Math.max(0.2, Math.min(1.1, pushing.r.speed_mps || 0.5)), aheadX = at.x + fx * (pushing.gap + 0.1), aheadZ = at.z + fz * (pushing.gap + 0.1);
    let nx = pushing.x + fx * v * dt, nz = pushing.z + fz * v * dt;
    nx += (aheadX - nx) * 0.12; nz += (aheadZ - nz) * 0.12;
    // Into a wall or another thing: it is stopped there (or slides along a wall pushed at a slant),
    // and the two mark each other as the collision laws say.
    const hit = pushing.S ? pushBlocked(nx, nz, fx, fz) : null;
    if (hit) {
      const moved = meetObstacle(hit, fx, fz, v, dt);
      if (!moved) return;
      nx = moved.x; nz = moved.z;
    } else { pushing.touch = null; pushing.stuck = false; pushing.speed = v; }
    const mx = nx - pushing.x, mz = nz - pushing.z;
    pushing.x = nx; pushing.z = nz;
    if (pushing.o) {
      const t = pushing.o;
      t.o.getMatrixAt(t.i, im4);
      const y0 = groundAt(im4.elements[12], im4.elements[14]);
      im4.elements[12] += mx; im4.elements[14] += mz; im4.elements[13] += groundAt(im4.elements[12], im4.elements[14]) - y0;
      t.o.setMatrixAt(t.i, im4); t.o.instanceMatrix.needsUpdate = true;
      pushing.laid += Math.hypot(mx, mz);
      if (pushing.laid > 0.15) { pushing.laid = 0; ctx.objects?.()?.invalidate?.(t.o); }
    }
    const now = performance.now();
    if (pushing.thing && now - pushing.sent > 400) { pushing.sent = now; send("move_item", { id: pushing.thing.id, to: { x: pushing.x, z: pushing.z } }); }
    if (now - pushing.worked > 2500) { pushing.worked = now; send("labour", { kind: "push" }); }
  }
  //: How fast you walk while pushing: the engine's pace for it, or a strain on the spot (it will
  //: not move, or it is up against something).
  const pushPace = () => (!pushing.on || !arrowsHeld.has("ArrowUp") ? 1 : pushing.r?.moves && !pushing.stuck ? Math.max(0.15, Math.min(0.8, (pushing.r.speed_mps || 0.5) / 1.4)) : 0.05);

  // ---- what a pushed thing runs into (mechanics-collide.mjs) ---------------------------------------
  //: A loose thing's shape when the catalogue has no form for it: a small box.
  const THING_FORM = { shape: "box", section: { b_m: 0.4, h_m: 0.008 }, span_m: 0.4, edge_r_m: 0.005, face_m2: 0.16, height_m: 0.4 };
  //: The cladding a building's walls are taken to be in when the place does not say: render (stucco)
  //: is the commonest SF wall by far.
  const DEFAULT_CLADDING = "stucco_render";
  function pushedStats(target) {
    const Cn = collide();
    if (!Cn) return null;
    try {
      if (target.arch && catalogue?.mechanics?.forms?.[target.arch]) return Cn.stats(target.arch, { mass_kg: target.kg, fixed: false });
      return Cn.stats({ name: target.name, material: target.material || target.spec?.material || "plastic", coat: null, form: THING_FORM }, { mass_kg: target.kg, fixed: false });
    } catch { return null; }
  }
  //: How far a pushed thing reaches ahead of its centre (half its face's width).
  const pushHalf = () => Math.max(0.2, Math.min(0.8, Math.sqrt(pushing.S?.face_m2 || 0.25) / 2));
  //: The nearest wall of a ring to (x, z): the point on it, its outward normal and its tangent.
  function wallFace(ring, x, z) {
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez;
      if (L2 < 1e-6) continue;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / L2)), qx = a[0] + ex * u, qz = a[1] + ez * u, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, px: qx, pz: qz, tx: ex / L, tz: ez / L }; }
    }
    if (!best) return null;
    // Outward: from the point inside toward the face; if the point is on it, across the edge.
    let nx = best.px - x, nz = best.pz - z;
    const n = Math.hypot(nx, nz);
    if (n > 1e-6) { nx /= n; nz /= n; } else { nx = best.tz; nz = -best.tx; }
    return { ...best, nx, nz };
  }
  //: What the pushed thing's front would be in at (x, z) going (fx, fz): a building's wall, or
  //: another thing in the street.
  function pushBlocked(x, z, fx, fz) {
    const h = pushHalf(), ax = x + fx * h, az = z + fz * h;
    const f = district.city?.footprintAt?.(ax, az);
    if (f) {
      const w = wallFace(f.ring, ax, az);
      if (w) return { wall: true, key: `wall:${f.pl.id}`, pl: f.pl, ...w };
    }
    const prox = ctx.objects?.();
    const near = prox?.instancesNear?.(ax, az, 1, (a) => Boolean(R.objects[archetypeId(a.archetype)]), 8) || [];
    for (const t of near) {
      if (pushing.o && t.o === pushing.o.o && t.i === pushing.o.i) continue;
      const d = Math.hypot(t.x - ax, t.z - az);
      if (d >= 0.45) continue;
      const id = archetypeId(t.archetype);
      return { wall: false, key: damageKey(id, t.x, t.z), t, id, px: t.x, pz: t.z, nx: -(t.x - x) / (Math.hypot(t.x - x, t.z - z) || 1), nz: -(t.z - z) / (Math.hypot(t.x - x, t.z - z) || 1), tx: 0, tz: 0 };
    }
    return null;
  }
  //: What it runs into, as the collision laws read it.
  function obstacleStats(hit) {
    const Cn = collide();
    try {
      if (hit.wall) return Cn.stats("building.exterior", { cladding: hit.pl?.cladding || DEFAULT_CLADDING });
      return Cn.stats(hit.id, { fixed: true });
    } catch { return null; }
  }
  //: The pushed thing meets ``hit``: the first touch is a blow at the speed it was going; after
  //: that it is pressed on with the push you keep up. Square on it stops; at a slant past the two
  //: surfaces' friction it slides along a wall, scraping it. Returns where it gets to, or null
  //: (it stays where it is).
  function meetObstacle(hit, fx, fz, v, dt) {
    const Cn = collide(), P = pushing.S, Q = obstacleStats(hit);
    if (!Cn || !P || !Q) { pushing.stuck = true; return null; }
    const into = fx * -hit.nx + fz * -hit.nz;     // the push's share square into the face
    const ang = (Math.acos(Math.max(-1, Math.min(1, Math.abs(into)))) * 180) / Math.PI;
    const kind = P.shape === "round" ? "edge" : ang < 8 ? "face" : "edge";
    const y = groundAt(pushing.x, pushing.z) + Math.min(1, (P.height_m || 0.4) * 0.6);
    if (pushing.touch !== hit.key) {
      pushing.touch = hit.key;
      const r = Cn.impact(P, Q, { speed_mps: Math.max(0.1, pushing.speed || v), kind, mass_kg: pushing.kg || P.mass_kg || 10 });
      drawMarks(hit, r.contact.struck, Q, y, null);
      say(r.text);
    }
    pushing.speed = 0;
    const r = Cn.push(P, Q, { force_n: (pushing.r?.push_n || 300) * WORK.sustained, angle_deg: ang, kind: kind === "face" ? "face" : "corner", length_m: 0.25 });
    if (!hit.wall || !r.slides) {
      if (!pushing.stuck) say(r.text);
      pushing.stuck = true;
      return null;
    }
    // Along the wall: the push's share along its face moves it; it stays off the face.
    pushing.stuck = false;
    const s = Math.sign(fx * hit.tx + fz * hit.tz) || 1, along = v * dt * Math.sin((ang * Math.PI) / 180);
    pushing.slid += along;
    if (pushing.slid >= 0.25) {
      pushing.slid = 0;
      drawMarks(hit, r.contact.struck, Q, y, { tx: hit.tx * s, tz: hit.tz * s });
      say(r.text);
    }
    const back = Math.max(0, pushHalf() - Math.hypot(pushing.x - hit.px, pushing.z - hit.pz) + 0.02);
    return { x: pushing.x + hit.tx * s * along + hit.nx * back, z: pushing.z + hit.tz * s * along + hit.nz * back };
  }
  //: Say a collision's result once (not again while it is the same).
  function say(text) { if (text && text !== pushing.said) { pushing.said = text; notify(text); } }
  //: The marks drawn on what was struck: a thin strip along the scrape, or a spot where it was
  //: hit, coloured by what the mark shows -- the paint's own scratch, the render or wood bared
  //: under it, a smear of what rubbed on it. (A scratch is drawn no narrower than 4 mm, to be seen.)
  const MARK_COLOUR = { scratch: [0xf2efe8, 0.55], scuff: [0xf2efe8, 0.3], cut_through: [0xc8bba2, 0.95], crushed: [0x8f8676, 0.6], flaked: [0xc8bba2, 0.9], dent: [0x6d6658, 0.45], stretched: [0x6d6658, 0.35], chip: [0xb9ab92, 0.95], gouge: [0x5a4a36, 0.85], transfer: [0x3c3a36, 0.5] };
  const SUBSTRATE_COLOUR = { stucco: 0xc8bba2, clay_brick: 0x9c5a44, concrete: 0xa9a59c, douglas_fir_dry: 0xb58a5a, mild_steel: 0x8b8f94, aluminium_6061: 0xb9bdc2, plasterboard: 0xe9e4da };
  const marks = { group: null, list: [], MAX: 160 };
  function drawMarks(hit, struck, Q, y, dir) {
    // The mark that shows: the deepest layer marked (bared stuff under paint shows its own colour).
    let show = null, at = -1;
    struck.layers.forEach((m, i) => { if (m.kind !== "none" && i >= at) { show = m; at = i; } });
    if (!show) return;
    const top = struck.layers[0];
    if (top.kind === "cut_through" || top.kind === "flaked") show = { ...top, bared: Q.layers[1]?.substance };
    const [c0, op] = MARK_COLOUR[show.kind] || [0x777777, 0.5];
    const colour = show.bared && SUBSTRATE_COLOUR[show.bared] != null ? SUBSTRATE_COLOUR[show.bared] : c0;
    if (!marks.group) { marks.group = new THREE.Group(); marks.group.name = "collision-marks"; group.add(marks.group); }
    const w = Math.max(0.004, show.flake_width_m || show.width_m || 0.004), len = dir ? 0.25 : Math.max(w, 0.01);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(dir ? len : w, w), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const off = 0.012;
    m.position.set(hit.px + hit.nx * off - (dir ? dir.tx * len * 0.5 : 0), y, hit.pz + hit.nz * off - (dir ? dir.tz * len * 0.5 : 0));
    m.lookAt(m.position.x + hit.nx, y, m.position.z + hit.nz);
    marks.group.add(m);
    marks.list.push(m);
    while (marks.list.length > marks.MAX) { const old = marks.list.shift(); marks.group.remove(old); old.geometry.dispose(); old.material.dispose(); }
  }

  // ---- going where a task is: along the pavements, by itself ------------------------------------
  //: {pts, i, label, since, best} while the task card's "Go there" walks you: the streets' walking
  //: route (people.mjs pavementRoute) from where you stand to the place, then straight to it. An
  //: arrow pressed takes the legs back.
  const nav = { pts: null, i: 0, label: "", since: 0, mark: 0, markAt: null };
  function startNav(x, z, label) {
    const S = district.streets, at = me();
    let pts = null;
    try {
      const a = S?.nearest(at.x, at.z, "walk", 150), b = S?.nearest(x, z, "walk", 150);
      const route = a !== null && a !== undefined && b !== null && b !== undefined && a !== b ? S.route(a, b, "walk") : null;
      const pave = route ? pavementRoute(S, route, { from: [at.x, at.z], to: [x, z] }) : null;
      pts = pave?.pts?.length ? pave.pts.map((q) => [q[0], q[1]]) : null;
    } catch { pts = null; }
    pts = [...(pts || []), [x, z]];
    // (Not back to the route's first point if it is behind you.)
    while (pts.length > 1 && Math.hypot(pts[1][0] - at.x, pts[1][1] - at.z) < Math.hypot(pts[0][0] - at.x, pts[0][1] - at.z) + 2 && Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) < Math.hypot(pts[1][0] - at.x, pts[1][1] - at.z) + 4) pts.shift();
    Object.assign(nav, { pts, i: 0, label, since: performance.now(), mark: performance.now(), markAt: { x: at.x, z: at.z } });
    notify(`Going to ${label}: ${Math.round(Math.hypot(x - at.x, z - at.z))} m. An arrow takes over.`);
  }
  function stopNav() { nav.pts = null; }
  function stepNav(dt) {
    if (!nav.pts) return false;
    if (car.active || transit.ride || climbPlay.busy || seated.on) { stopNav(); return false; }
    const at = me();
    let q = nav.pts[nav.i];
    while (q && Math.hypot(q[0] - at.x, q[1] - at.z) < (nav.i === nav.pts.length - 1 ? 1.2 : 1.6)) { nav.i += 1; q = nav.pts[nav.i]; }
    if (!q) { stopNav(); ctx.animateWalk?.(0); notify(`You are at ${nav.label}.`); return false; }
    const now = performance.now();
    if (now - nav.mark > 3500) {
      if (Math.hypot(at.x - nav.markAt.x, at.z - nav.markAt.z) < 0.6) { stopNav(); ctx.animateWalk?.(0); notify("Something is in the way: walk round it, then Go there again."); return false; }
      nav.mark = now; nav.markAt = { x: at.x, z: at.z };
    }
    const dx = q[0] - at.x, dz = q[1] - at.z, d = Math.hypot(dx, dz), sp = 1.45 * walkFactorNow();
    const moved = ctx.moveWalker?.((dx / d) * Math.min(sp * dt, d), (dz / d) * Math.min(sp * dt, d)) ?? 0;
    ctx.faceTo?.(q[0], q[1]);
    ctx.animateWalk?.(moved, dx / d, dz / d);
    walked(moved, dt);
    return true;
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
    // (An empty hand stays empty: something new goes to another slot, and is held when you choose it.)
    const next = arrange(slots, p.inventory, slots[chosen] ? -1 : chosen);
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
    if (court.active || police.locked) return [];   // (in court, or in cuffs: nothing of the street's)
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
  let visible = { people: [], vehicles: [] }, frameFailed = false, animalsFailed = false;
  //: The nearest people's feet, for the grass to bend under them as it does under the walker's
  //: (foliage-motion.mjs reads this once a frame). The same few objects each frame: no garbage.
  const FEET_NEAR_M = 18, feetPool = Array.from({ length: 6 }, () => ({ x: 0, y: 0, z: 0, d: 0 })), feetOut = [];
  globalThis.__kerbsideFeet = (at) => {
    feetOut.length = 0;
    if (!at) return feetOut;
    for (const e of visible.people) {
      if (e.indoors || e.riding || e.driving) continue;
      const d = Math.hypot(e.x - at.x, e.z - at.z);
      if (!(d < FEET_NEAR_M)) continue;
      if (feetOut.length < feetPool.length) feetOut.push(feetPool[feetOut.length]);
      else if (d >= feetOut[feetOut.length - 1].d) continue;
      const f = feetOut[feetOut.length - 1];
      f.x = e.x; f.z = e.z; f.d = d; f.y = NaN;
      for (let i = feetOut.length - 1; i > 0 && feetOut[i].d < feetOut[i - 1].d; i -= 1) { const t = feetOut[i]; feetOut[i] = feetOut[i - 1]; feetOut[i - 1] = t; }
    }
    for (const f of feetOut) f.y = groundAt(f.x, f.z);
    return feetOut;
  };
  const ALIVE_FOR_MS = 2500, ALIVE_GIVE_UP_MS = 30_000, aliveSeen = { started: 0, since: 0 };
  // ---- level of detail (detail.mjs) ----------------------------------------------------------------
  //: The field this frame (null before the first), what tier each person and car had (and, for one
  //: only tracked or drawn low, when it is next placed), and how many were drawn at each tier.
  let detailNow = null;
  const personTiers = new Map(), carTiers = new Map(), focusVelocity = velocityTracker();
  const drawnTiers = { people: [0, 0, 0], cars: [0, 0, 0], tracked: { people: 0, cars: 0 }, figures: 0, clumps: null };
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
    // Behind the loading screen the city runs unseen until its people and traffic are out and
    // moving (ctx.warming; ``alive`` below says when): nobody is let into streets still filling.
    const warming = !ctx.enabled() && Boolean(ctx.warming?.());
    if (!ctx.enabled() && !warming) { group.visible = false; return false; }
    group.visible = true;
    aliveSeen.started ||= performance.now();
    if (!group.parent) ctx.root.add(group);
    const t = Date.now();
    if (now - lastRegion > 1500) {
      lastRegion = now;
      const data = ctx.regionData();
      if (data && data.key !== district.key) { try { buildDistrict(data); } catch (error) { console.warn("kerbside: the living city could not build this district", error); district.key = data.key; } }
    }
    chooseBooks();
    homeSpawn();
    if (!warming) cityRoom();
    // The practice world keeps its own time; the city's is kept by its server, asked what is new.
    if (world && now - lastStep > 1000) { lastStep = now; world.step(gameNow(t)); }
    if (!world && clockHeld()) restoreClockHold(null);
    if (world && now - lastSave > 10_000) { lastSave = now; save(); }
    if (online.state === "online" && syncDue(performance.now())) { syncCity().then(ensureJoined); }

    const dt = Math.min(0.25, (now - (lastFrame || now)) / 1000); lastFrame = now;
    if (car.riding) ride();
    // The route buses where the timetable has them, near you.
    if (district.lines?.length) {
      const f = car.active ? car : me();
      routeBuses = busesAt(district.lines, t, busLag).filter((b) => Math.abs(b.x - f.x) < R.routine.visible_radius_m && Math.abs(b.z - f.z) < R.routine.visible_radius_m);
      holdBuses(dt);
    } else routeBuses = [];
    stepTaxi(dt);
    stepPatrol(dt, now);
    cityStart ||= { x: me().x, z: me().z };
    if (!court.active) police.frame(dt);
    court.frame(dt);
    if (district.city) { district.city.wet = wetNow(); district.city.through = R.density?.through_driven ?? THROUGH_DRIVEN; }
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
          const hour = (scan.time.gameMinute ?? scan.time.minute) / 60;
          lastNight = hour < 6.6 || hour > 18.4;
        }
      }
      // The detail field: round where you are, out ahead the way you are going (and along the
      // route, riding).
      const fv = focusVelocity.update(focus.x, focus.z, dt);
      detailNow = detailField({ x: focus.x, z: focus.z }, { vx: fv.vx, vz: fv.vz, ahead: routeAheadNow(), look: EYE.ok ? [EYE.fx, EYE.fz] : null });
      // The city's frame never takes the page's with it: one car or person that cannot be placed
      // is left out of this frame (said once), and the world goes on being drawn.
      try { visible = frameCity(t, dt, now, focus); } catch (error) { if (!frameFailed) { frameFailed = true; console.warn("kerbside: the living city skipped a frame", error); } }
      // Where the real routes run, the buses are theirs (the timetable's), not the crowd's.
      if (district.lines?.length) visible.vehicles = visible.vehicles.filter((v) => v.model !== "bus");
      // (A patrol car of the city's answering a call is drawn as it answers, not on its round.)
      if (police.active) visible.vehicles = visible.vehicles.filter((v) => !police.hidden(v.id));
      keepClear();
      syncRacks(now); syncLots(now); syncStoreSigns(now);
      stepBikes(dt, t / 1000, focus, now);
      // The residents' bicycles: ridden (their riders on them) and stood by their doors -- the
      // nearest first, as many as are drawn.
      if (residentBikes.length > MAX_BIKES - bikes.length) residentBikes.sort((a, b) => ((a.x - focus.x) ** 2 + (a.z - focus.z) ** 2) - ((b.x - focus.x) ** 2 + (b.z - focus.z) ** 2));
      bikes = [...bikes.filter((b) => !b.resident), ...residentBikes.slice(0, Math.max(0, MAX_BIKES - bikes.length))];
      if (cycle.active && cycle.entry) bikes.push(cycle.entry);   // (yours, ridden)
      lightSignals(t / 1000, now);
      // In court (court-session.mjs) the courthouse's people; on the street the crowd, and any
      // officer out of their car (police.mjs).
      drawPeople(court.active ? court.people() : [...visible.people, ...(bikes.length ? bikeRiders() : []), ...police.people()], now, focus);
      drawBikes();
      const wheelsNow = court.active ? [] : wheels();
      drawCars(wheelsNow, lastNight);
      police.drawBars(wheelsNow, (model) => (bodyDims(bodyOf(model, 0)) || VEHICLE_DIMS[model] || VEHICLE_DIMS.sedan)[1] + 0.01);
      try { animals().frame(dt, now); } catch (error) { if (!animalsFailed) { animalsFailed = true; console.warn("kerbside: the animals skipped a frame", error); } }
      drawThings(now);
      drawDebris(dt);
    }
    drawMarker(now); drawErrand(now); drawTask(now);
    if (!ctx.animateWalk) { if (!stepReach(dt)) stepNav(dt); }   // (the page's walker step runs it: autoWalk)
    stepBody(dt); stepToolWork(); stepPushing(dt); stepNailSet(); stepFlying(); drawHeld(); garageRemote(now); ctx.garages?.tick(dt); stepSeat();
    if (now - lastHints > 250) { lastHints = now; drawHints(now); }
    if (now - lastRefresh > 500) {
      lastRefresh = now; syncHomeEditor(); drawParked(); carMarks(); checkFainted(); syncDamage(); hud(); syncSlots(); drawPrompt(); refreshDoors(now); npcGarages(); clerkCheck();
      if (side && ["ride", "tasks"].includes(side.kind)) drawSide();
      drawGoal(); checkSightseeing();
      if (district.places.length) listings();
    }
    if (shop.place && !ctx.isFirstPerson?.()) ctx.firstPerson?.(true);
    return Boolean(visible.people.length || visible.vehicles.length || car.active || transit.ride || routeBuses.length || taxi.at || shop.place || working || pose.kind || air.up || air.crouch || air.land || flying.length);
  }
  // ---- the city in motion: each frame ------------------------------------------------------------
  const SIM_M = 240;          // cars nearer than this are driven by the rules (fleet.mjs Drivers)
  const flings = new Map();   // someone knocked down: id -> {t0, x, z, dx, dz, speed}
  const jolts = new Map();    // a car in a crash: id -> {t0, speed}
  const dodge = new Map();    // someone stepping round you: id -> sideways metres
  // The people near you decide for themselves (temperament.mjs): out of the way of a car that
  // is not stopping for them, and -- at a crash or a fight -- to run, to watch, to film it, to
  // telephone, or to go and help. Only in the full and moderate rings; further off, a person is
  // where their day has them and nothing else.
  const scares = new Map();    // id -> {until, dx, dz, k}: stepping out of a car's way
  const reacting = new Map();  // id -> {kind, until, ix, iz, at: {x, z}, off, told}
  const incidents = [];        // what has just happened: {id, kind, x, z, t0, byYou, seen: Set}
  const threats = [];          // the cars a walker might have to get clear of, this frame
  const styles = new Map();    // vehicle id -> how its driver drives (temperament.mjs drivingStyle)
  let lastTraffic = [];        // the cars as last placed
  function noteIncident(kind, x, z, byYou = false) {
    const now = performance.now();
    for (const i of incidents) if (i.kind === kind && now - i.t0 < 4000 && Math.hypot(i.x - x, i.z - z) < 10) return;
    incidents.push({ id: `${kind}:${Math.round(now)}`, kind, x, z, t0: now, byYou, seen: new Set(), called: false });
    if (incidents.length > 6) incidents.shift();
  }
  //: The share of the visitors' trips that are driven where you can see them (fleet.mjs scan:
  //: a day's through traffic in a 72-minute day is twenty times what the streets carry). At
  //: this the Marina has some 120 cars moving round you, half of them at any moment, at 3 m/s
  //: and more; with all of them, 640, one in five moving (measured on the real streets).
  const THROUGH_DRIVEN = 0.1;
  const wetStyles = new Map();
  //: Raining now (environment-runtime.mjs): drivers near you slow down and leave more room, and
  //: nobody near you takes a break outside.
  const wetNow = () => Boolean(globalThis.kerbsideWeather?.rain);
  const styleOf = (v) => {
    let s = styles.get(v.id);
    if (!s) { s = drivingStyle(temperamentOf(district.roster?.people.get(v.owner))); styles.set(v.id, s); if (styles.size > 6000) { styles.clear(); wetStyles.clear(); } }
    if (!wetNow()) return s;
    let w = wetStyles.get(v.id);
    if (!w) wetStyles.set(v.id, w = wetStyle(s));
    return w;
  };
  // A patrol car sent to a 911 call: from a few blocks off, by the streets, to the kerb beside
  // what happened; it stands there half a minute and drives on. Not one of the city's own cars
  // (their days are planned): the traffic keeps behind it and gives way to it as to yours.
  const patrol = { phase: null, route: null, d: 0, at: null, until: 0, inc: null, v: 0 };
  const PATROL = { speed_ms: 15, stay_s: 30, from_m: [260, 420], short_m: 9 };
  // The police: who calls them about what you did, the car that comes, the chase, the stop and
  // the arrest (police.mjs; what is a crime and how it is caught: law.mjs).
  let cityStart = null;
  const police = createPolice({ THREE, R, group, notify, send, me, car, fmt: (v) => R.fmt(v),
    speedLimitAt, streets: () => district.streets, alongRoute, lane: (...a) => DRIVE_LANE(...a),
    patrolCars: () => { const out = new Map(); for (const v of [...visible.vehicles, ...(scan.vehicles || [])]) if (v && v.model === "patrol" && !v.parked && Number.isFinite(v.x) && !out.has(v.id)) out.set(v.id, { id: v.id, x: v.x, z: v.z, yaw: v.yaw || 0 }); return [...out.values()]; },
    stationAt: () => { const st = R.law.dispatch.station, [sx, sz] = ctx.fromLonLat(st.lon, st.lat), at = me(), d = Math.hypot(sx - at.x, sz - at.z); return d < 450 ? { x: sx, z: sz } : { x: at.x + (sx - at.x) / d * 450, z: at.z + (sz - at.z) / d * 450 }; },
    exitCar: () => exitCar(), entering: () => Boolean(entry), placeAvatar: (...a) => ctx.placeAvatar(...a), avatarVisible: (on) => ctx.avatarVisible(on),
    animateWalk: (...a) => ctx.animateWalk?.(...a), faceYaw: (y) => { ctx.avatar.rotation.y = y; },
    playMove: (name, o) => ctx.playMove?.(name, o) || null, stopMove: (name) => ctx.stopMove?.(name),
    incident: (kind, x, z) => noteIncident(kind, x, z, false),
    groundAt: (x, z) => ctx.groundAt?.(x, z) ?? groundAt(x, z),
    homeAt: () => {
      const p = self(), owned = Boolean(p?.home && (p.home.building || Number.isFinite(p.home.x)));
      const pl = owned ? (district.places || []).find((x) => String(x.id) === String(p.home.building)) : null;
      const at = owned ? (pl?.door ? { x: pl.door.x, z: pl.door.z } : Number.isFinite(p.home.x) ? { x: p.home.x, z: p.home.z } : null) : null;
      return at ? { ...at, label: "home" } : { ...(cityStart || { x: me().x, z: me().z }), label: "at your spawn point" };
    } });
  // A hearing of yours at the courthouse: brought there by the link in your summons, the case
  // heard in Department 12, back where you were after (court-session.mjs, courthouse.mjs).
  const courtGlass = (() => { const m = new THREE.MeshStandardMaterial({ color: 0xbcd0dc, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide }); globalThis.__kerbsideRealGlass?.(m, { paneUv: false }); return m; })();
  const court = createCourtSession({ THREE, R, ctx, group, send, notify, me, glass: courtGlass, walkFactor: () => walkFactorNow(), onEnd: () => refresh() });
  function sendPatrol(inc) {
    const s = district.streets;
    if (patrol.phase || !s) return false;
    const b = s.nearest(inc.x, inc.z, "drive", 140);
    if (b === null || b === undefined) return false;
    let best = null;
    for (let k = 0; k < 12; k += 1) {
      const ang = (hash32(inc.id, "from", k) % 6283) / 1000, r = PATROL.from_m[0] + (hash32(inc.id, "far", k) % (PATROL.from_m[1] - PATROL.from_m[0]));
      const a = s.nearest(inc.x + Math.cos(ang) * r, inc.z + Math.sin(ang) * r, "drive", 140);
      if (a === null || a === undefined || a === b) continue;
      const route = s.route(a, b, "drive");
      if (route && route.length > 160 && route.length < 1100 && (!best || route.length < best.length)) best = route;
    }
    if (!best) return false;
    Object.assign(patrol, { phase: "coming", route: best, d: 0, inc, v: PATROL.speed_ms * 0.6, at: null, shift: 0, held: 0, passUntil: 0 });
    return true;
  }
  function stepPatrol(dt, now) {
    if (!patrol.phase) { patrol.at = null; return; }
    // (Held up behind a queue it pulls out over the middle line and goes by: ``shift``.)
    const lane = (...a) => DRIVE_LANE(...a) - (patrol.shift || 0);
    const R0 = patrol.route, here = alongRoute(R0, patrol.d, lane);
    if (patrol.phase !== "there") {
      const left = (patrol.phase === "coming" ? R0.length - PATROL.short_m : R0.length) - patrol.d;
      let want = Math.max(patrol.phase === "coming" ? 0 : 2, Math.min(PATROL.speed_ms, left / 1.6));
      // Not through the traffic: behind whatever is in its lane just ahead.
      const fx = -Math.sin(here.yaw), fz = -Math.cos(here.yaw);
      for (const v of lastTraffic) {
        const dx = v.x - here.x, dz = v.z - here.z;
        if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
        const fwd = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (fwd > 0 && fwd < 26 && lat < 1.8) want = Math.min(want, Math.max(0, (fwd - 7) / 1.5));
      }
      patrol.held = patrol.v < 1 && want < 1 && left > 12 ? (patrol.held || 0) + dt : 0;
      if (patrol.held > 2) patrol.passUntil = now + 7000;
      patrol.shift = (patrol.shift || 0) + Math.max(-2 * dt, Math.min(2 * dt, (now < (patrol.passUntil || 0) ? 3.0 : 0) - (patrol.shift || 0)));
      patrol.v += Math.max(-9 * dt, Math.min(3 * dt, want - patrol.v));
      patrol.d = Math.min(R0.length, patrol.d + Math.max(0, patrol.v) * dt);
      if (patrol.phase === "coming" && left <= 0.5) {
        patrol.phase = "there"; patrol.until = now + PATROL.stay_s * 1000; patrol.v = 0;
        if (Math.hypot(here.x - me().x, here.z - me().z) < 80) notify(patrol.inc?.byYou ? "A patrol car has pulled up. The officer is talking to those who saw it." : "A patrol car has pulled up at the scene.");
      } else if (patrol.phase === "leaving" && left <= 0.5) { patrol.phase = null; patrol.at = null; return; }
    } else if (now > patrol.until) {
      // On its way: to somewhere a few blocks on.
      const s = district.streets, a = s?.nearest(here.x, here.z, "drive", 80);
      let next = null;
      for (let k = 0; k < 8 && !next && a !== null && a !== undefined; k += 1) {
        const ang = (hash32(patrol.inc?.id, "off", k) % 6283) / 1000, b = s.nearest(here.x + Math.cos(ang) * 380, here.z + Math.sin(ang) * 380, "drive", 160);
        const route = b !== null && b !== undefined && b !== a ? s.route(a, b, "drive") : null;
        if (route && route.length > 200) next = route;
      }
      if (!next) { patrol.phase = null; patrol.at = null; return; }
      Object.assign(patrol, { phase: "leaving", route: next, d: 0, v: 0 });
    }
    const pos = alongRoute(patrol.route, patrol.d, lane);
    patrol.at = { id: "patrol:responder", model: "patrol", x: pos.x, z: pos.z, yaw: pos.yaw, speed: patrol.v, moving: patrol.v > 0.2, shade: 0, braking: false, siren: patrol.phase === "coming" };
  }
  const nudged = new Map();   // someone going through a door: id -> when it was swung open for them
  let drawnCars = [];
  //: Who and what is where this frame: people along their way or at their spot, cars on their
  //: leg -- driven by the rules near you, by their day further off -- or parked.
  //: Where each one was drawn last frame: nobody is drawn moving faster than ``top`` m/s, so
  //: where a way's offset changes (a street narrows, a footpath meets the pavement) they step
  //: across rather than appear there. A gap wider than ``snap`` (out of sight and back) is taken.
  const glided = new Map();
  //: The close lock (close-lock.mjs): inside the full ring nothing appears, vanishes or is put
  //: ahead to where its day says -- people, riders and cars all move there only as they could.
  //: ``closeFocus``: the focus this frame (the rings are measured from it, as detailNow's are).
  let closeFocus = null;
  // (Straight from you, not by the view's stretched field: nobody jumps behind your back.)
  const closeIn = (kind) => (x, z, share = 1) => Boolean(closeFocus) && Math.hypot(x - closeFocus.x, z - closeFocus.z) < CLOSE.ring[kind] * share;
  const wallAt = (x, z) => district?.city?.footprintAt?.(x, z);
  const carBeside = (x, z) => drawnCars.some((v) => Math.abs(v.x - x) < 3.2 && Math.abs(v.z - z) < 3.2);
  // Out of (or into) a door, a car beside them, a bus or a cab, a shop you see into.
  const personPortal = (x, z, e) => Boolean(e.through || e.indoors || e.ride === "bus" || e.ride === "taxi") || byWall(wallAt, x, z, CLOSE.portal_m) || carBeside(x, z);
  const peopleLock = closeLock("people", {
    inClose: closeIn("people"),
    portal: personPortal,
    // Thrown, falling, carried or lying: moved by their own physics already, only followed.
    free: (e) => Boolean(e.down || e.fall || e.lift),
    along: (w, d) => district.city?.walkEnds(w.pave, d, 0, null, null),
    // Out past the ring: their day has them again, as far along as it says (no time owed).
    release: (e) => { if (e?.walk?.key) district.city?.walkLags.delete(e.walk.key); },
  });
  //: Whether ``id`` is drawn inside the close ring just now (by ``lock``'s record of it).
  const lockedClose = (lock, kind, id) => { const r = lock.records.get(id); return Boolean(r?.drawn) && closeIn(kind)(r.x, r.z, CLOSE.exit); };
  const carsLock = closeLock("cars", {
    inClose: closeIn("cars"),
    portal: (x, z) => byWall(wallAt, x, z, CLOSE.car_portal_m),
    // A bicycle at its rider's pace; a car as glideCar lets its wheels take it.
    pace: (v) => (v.model === "bike" ? Math.max(v.speed || 0, 2.5) : Math.max(4, v.speed || 0) * 1.6 + 2),
  });
  //: Who you are talking with (talkTo): they stand and face you while it lasts.
  const talking = { id: null, until: 0, at: null, met: new Map(), come: null };
  function talkTo(who) {
    if (!who?.id) return;
    if (talking.id !== who.id) { talking.at = null; talking.come = null; }
    talking.id = who.id; talking.until = performance.now() + 30_000;
    // The world keeps how often you have talked: it is what they are to you (social.mjs).
    const last = talking.met.get(who.id) || 0;
    if (performance.now() - last > 60_000 && self()) { talking.met.set(who.id, performance.now()); send("meet", { id: who.id, name: who.name, title: who.title || null }); }
  }
  //: People keep clear of each other: two whose places come within half a metre step apart, each
  //: to their own right when they meet head on, so they go round and nobody stands in anybody.
  //: The step is eased in and out (``aside``), and is undone before the next (an entry kept from an
  //: earlier frame is the same object).
  const aside = new Map();
  const CLEAR_M = 0.62;
  const strides = strideBodies();
  let stridesSwept = 0;
  //: (The squares and the list of who is near, kept between frames and emptied, not made again:
  //: a map and a list a square every frame were 15 MB a second of garbage, 2026-11-20.)
  const apartCells = new Map(), apartNear = [];
  //: Looking ahead (npc-steer.mjs swerveAhead): who stood within three metres of ``e`` last frame
  //: (keepApart's squares, still as they were until it runs again); where a step aside may go.
  const aheadNear = [], swerved = new Map();
  let swerveFrom = null, favourWalk = null, favourDt = 0;
  const swerveFree = (x, z) => !(ctx.roadAt?.(x, z) && !ctx.roadAt?.(swerveFrom.x, swerveFrom.z)) && !district.city?.footprintAt?.(x, z);
  const holdFavoured = () => { if (favourWalk) district.city?.holdWalk(favourWalk.key, favourDt, true); };
  function aheadOf(e) {
    aheadNear.length = 0;
    const cx = Math.floor(e.x), cz = Math.floor(e.z);
    for (let ix = cx - 3; ix <= cx + 3; ix += 1) for (let iz = cz - 3; iz <= cz + 3; iz += 1) {
      const list = apartCells.get((ix + 1048576) * 2097152 + iz + 1048576);
      if (list) for (let k = 0; k < list.length; k += 1) if (list[k].id !== e.id) aheadNear.push(list[k]);
    }
    return aheadNear;
  }
  function keepApart(people, you, dt) {
    const cells = apartCells, near = apartNear;
    for (const list of cells.values()) list.length = 0;
    if (cells.size > 20000) cells.clear();
    near.length = 0;
    for (const e of people) {
      if (e._ax) { e.x -= e._ax; e.z -= e._az; e._ax = e._az = 0; }
      if (e.down || e.indoors || e.through || e.ride) continue;
      // Stood where their step aside so far has them, so the push is for what is still too close.
      const stepped = aside.get(e.id);
      if (stepped) { e.x += stepped[0]; e.z += stepped[1]; e._ax = stepped[0]; e._az = stepped[1]; }
      near.push(e);
      // (A cell's key is a number: a string made for every person and every cell looked in was
      // ten thousand strings a frame.)
      const key = (Math.floor(e.x) + 1048576) * 2097152 + Math.floor(e.z) + 1048576;
      let list = cells.get(key); if (!list) cells.set(key, list = []);
      list.push(e);
    }
    const k = Math.min(1, dt * 6);
    for (const e of near) {
      let wx = 0, wz = 0;
      const cx = Math.floor(e.x), cz = Math.floor(e.z);
      for (let ix = cx - 1; ix <= cx + 1; ix += 1) for (let iz = cz - 1; iz <= cz + 1; iz += 1) {
       const list = cells.get((ix + 1048576) * 2097152 + iz + 1048576);
       if (list) for (let oi = 0; oi < list.length; oi += 1) {
        const o = list[oi];
        if (o === e) continue;
        let dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot(dx, dz);
        if (d >= CLEAR_M) continue;
        // Exactly together: each off its own way, by its id.
        if (d < 0.02) { const a = (hash32(e.id) % 628) / 100; dx = Math.cos(a); dz = Math.sin(a); d = 1; }
        const push = (CLEAR_M - d) * (o.moving && !e.moving ? 0.25 : e.moving && !o.moving ? 1 : 0.5);
        wx += (dx / d) * push; wz += (dz / d) * push;
        // Meeting head on: each also a little to their right, so they pass instead of stopping face to face.
        if (e.moving && o.moving && Math.cos(e.yaw - o.yaw) < -0.3) { wx += Math.cos(e.yaw) * 0.25 * (CLEAR_M - d); wz += -Math.sin(e.yaw) * 0.25 * (CLEAR_M - d); }
       }
      }
      // What they are pushed by is measured from where they stood without their step aside, so the
      // step is carried on: it grows while they are crowded and eases off once there is room.
      const was = aside.get(e.id), was0 = was ? was[0] : 0, was1 = was ? was[1] : 0;
      // (Nobody near and no step aside: nothing to work out, nothing to keep.)
      if (!was && !wx && !wz) continue;
      let ax = (wx || wz) ? was0 + wx * k : was0 * (1 - k * 0.35), az = (wx || wz) ? was1 + wz * k : was1 * (1 - k * 0.35);
      const m = Math.hypot(ax, az);
      // (Up to a couple of paces: a dozen waiting at one crossing need the room to stand apart.)
      if (m > 1.9) { ax *= 1.9 / m; az *= 1.9 / m; }
      if (m < 0.005) { aside.delete(e.id); e.x -= e._ax || 0; e.z -= e._az || 0; e._ax = e._az = 0; continue; }
      // Nobody steps aside into the roadway: off a pavement the step is cut short, or not taken.
      if (ctx.roadAt) {
        const bx = e.x - (e._ax || 0), bz = e.z - (e._az || 0);
        if (ctx.roadAt(bx + ax, bz + az) && !ctx.roadAt(bx, bz)) {
          if (!ctx.roadAt(bx + ax * 0.4, bz + az * 0.4)) { ax *= 0.4; az *= 0.4; } else { ax = 0; az = 0; }
        }
      }
      if (was) { was[0] = ax; was[1] = az; } else aside.set(e.id, [ax, az]);
      e.x += ax - (e._ax || 0); e.z += az - (e._az || 0); e._ax = ax; e._az = az;
    }
    if (aside.size > 4000) aside.clear();
  }
  //: No more than CLUMP_MOST people within CLUMP_M of one another for longer than CLUMP_S, but a
  //: household out together: past that, the rest (by their ids) let the group go -- one walking
  //: slows to let it get ahead, one stood waiting stands back from it, a pace or two, and keeps
  //: there till there is room. (Twenty and more stood at a corner pushing to stand apart, a wall
  //: across the pavement, 2026-11-21.)
  const CLUMP_M = 1.5, CLUMP_MOST = 6, CLUMP_S = 5, CLUMP_BACK_M = 2.5, CLUMP_SLOW = 0.6, CLUMP_KEEP_S = 20;
  const clumpSince = new Map(), clumpBack = new Map(), clumpCells = new Map(), clumpNear = [];
  const clumps = { over: 0, slowed: 0, stoodBack: 0, most: 0 };
  function spreadClumps(people, c, now, dt) {
    const cells = clumpCells, near = clumpNear;
    for (const list of cells.values()) list.length = 0;
    if (cells.size > 20000) cells.clear();
    near.length = 0;
    clumps.over = clumps.slowed = clumps.stoodBack = clumps.most = 0;
    for (const e of people) {
      if (e._bx) { e.x -= e._bx; e.z -= e._bz; e._bx = e._bz = 0; }
      if (e.down || e.indoors || e.through || e.ride || e.lift) continue;
      near.push(e);
      const key = (Math.floor(e.x / CLUMP_M) + 1048576) * 2097152 + Math.floor(e.z / CLUMP_M) + 1048576;
      let list = cells.get(key); if (!list) cells.set(key, list = []);
      list.push(e);
    }
    const r2 = CLUMP_M * CLUMP_M;
    for (const e of near) {
      const hh = e.person?.hh, mine = hash32(e.id, "clump");
      let n = 0, below = 0;
      const cx = Math.floor(e.x / CLUMP_M), cz = Math.floor(e.z / CLUMP_M);
      for (let ix = cx - 1; ix <= cx + 1; ix += 1) for (let iz = cz - 1; iz <= cz + 1; iz += 1) {
        const list = cells.get((ix + 1048576) * 2097152 + iz + 1048576);
        if (list) for (let oi = 0; oi < list.length; oi += 1) {
          const o = list[oi];
          if (o === e || (hh && o.person?.hh === hh)) continue;   // their own household: together
          const dx = o.x - e.x, dz = o.z - e.z;
          if (dx * dx + dz * dz > r2) continue;
          n += 1;
          if (hash32(o.id, "clump") < mine) below += 1;
        }
      }
      clumps.most = Math.max(clumps.most, n + 1);
      let since = clumpSince.get(e.id);
      if (n + 1 > CLUMP_MOST) { if (since === undefined) clumpSince.set(e.id, since = now); }
      else if (since !== undefined) { clumpSince.delete(e.id); since = undefined; }
      const extra = since !== undefined && now - since > CLUMP_S * 1000 && below >= CLUMP_MOST;
      if (extra) clumps.over += 1;
      // A walker who is one too many slows and lets the group get ahead.
      if (extra && e.moving && e.walk) { c.holdWalk(e.walk.key, Math.min(dt, 0.25) * CLUMP_SLOW, true); clumps.slowed += 1; }
      // One stood (waiting, at the kerb or anywhere) stands back from it; low-tier entries are
      // kept from frame to frame, so the step back is undone first, as keepApart's is.
      // (Kept back a while once stood back, or the group is under the most again, they step
      // in, it is over again, and they go back and forth.)
      let b = clumpBack.get(e.id);
      if (extra && !e.moving) { if (!b) clumpBack.set(e.id, b = { off: 0, until: 0 }); b.until = now + CLUMP_KEEP_S * 1000; }
      if (!b) continue;
      const want = !e.moving && now < b.until ? CLUMP_BACK_M : 0;
      b.off += Math.sign(want - b.off) * Math.min(Math.abs(want - b.off), dt * 1.1);
      if (b.off < 0.01 && want === 0) { clumpBack.delete(e.id); continue; }
      const off = b.off;
      const bx = Math.sin(e.yaw || 0) * off, bz = Math.cos(e.yaw || 0) * off;
      // Not back into the road or a wall: as far as there is pavement.
      let k = 1;
      if ((ctx.roadAt?.(e.x + bx, e.z + bz) && !ctx.roadAt?.(e.x, e.z)) || c.footprintAt?.(e.x + bx, e.z + bz)) k = 0;
      if (k) { e.x += bx; e.z += bz; e._bx = bx; e._bz = bz; clumps.stoodBack += 1; }
    }
    if (clumpSince.size > 4000) for (const [id, t] of clumpSince) if (now - t > 60_000) clumpSince.delete(id);
    if (clumpBack.size > 4000) clumpBack.clear();
  }
  //: How far behind the place they are drawn a walker's true place may be and still be waited for (m).
  const BACK_HOLD_M = 4;
  function glide(e, now, dt, top, snap, face = false, noBack = false) {
    const g = glided.get(e.id);
    if (g && now - g.t < 600) {
      // (Allowed the time since it was last placed, not one frame's: those drawn low are placed
      // only every few frames, and a frame's worth each time left them tens of metres behind where
      // they were, catching up whichever way that lay -- walking backwards, 2026-11-21.)
      const span = Math.max(dt, (now - g.t) / 1000, 1 / 120);
      const dx = e.x - g.x, dz = e.z - g.z, d = Math.hypot(dx, dz), max = top * span + 0.02;
      // Never back the way they came: one whose place by their day is a little behind where
      // they are drawn (they were carried on between looks, or held a moment at a kerb) stands
      // where they are until their day has caught up with them. Nobody is pulled backwards.
      if (noBack && e.moving && !e.gesture && d > 0.03 && d < BACK_HOLD_M && dx * -Math.sin(e.yaw) + dz * -Math.cos(e.yaw) < -0.02) {
        e.x = g.x; e.z = g.z;
      } else if (d > max && d < snap) {
        e.x = g.x + (dx / d) * max; e.z = g.z + (dz / d) * max;
        // Catching up, they face the way they go (``face``: those with no stride body to turn).
        if (face && e.moving) e.yaw = Math.atan2(-dx, -dz);
      }
    }
    if (g) { g.x = e.x; g.z = e.z; g.t = now; } else glided.set(e.id, { x: e.x, z: e.z, t: now });
  }
  //: A car is drawn only where its wheels can take it (wheelStep): on from where it was drawn the
  //: way it faces (back only while it reverses), and across by no more than a share of what it
  //: moves along -- a wheel steers, it does not slide. Where its place by the traffic is a little
  //: behind it, or to one side, it stands (or rolls on) and is met there; it is never drawn hopping
  //: back, or square across, to it. Standing, it stays where it was drawn. Far off its place
  //: (CAR_SNAP_M: a jump of the day, a street shut), it is there at once.
  const CAR_SNAP_M = 14, CAR_STAND_M = 2.5;
  function glideCar(v, now, dt) {
    const g = glided.get(v.id);
    // (Close by, a car is never put where the traffic has it: it gets there on its wheels, or
    // stands where it is -- close-lock.mjs.)
    const near = Boolean(g) && closeIn("cars")(g.x, g.z, CLOSE.exit);
    if (!g || (!near && now - g.t > 600) || v.model === "bike") { glided.set(v.id, { x: v.x, z: v.z, t: now }); return; }
    const span = Math.min(0.25, Math.max(dt, (now - g.t) / 1000, 1 / 120)), d = Math.hypot(v.x - g.x, v.z - g.z);
    g.t = now;
    if (!near && (d >= CAR_SNAP_M || (!v.moving && d >= CAR_STAND_M))) { g.x = v.x; g.z = v.z; return; }
    // (A car come to its parking spot rolls the last of the way in, and is in it: never left
    // standing short of it in the lane.)
    if (v.parked && !v.moving) {
      const to = d < 0.35 ? [v.x, v.z] : wheelStep(g.x, g.z, v.x, v.z, v.yaw, 2 * span, false);
      if (Math.hypot(to[0] - g.x, to[1] - g.z) < 0.004) { g.x = v.x; g.z = v.z; return; }
      v.x = g.x = to[0]; v.z = g.z = to[1];
      return;
    }
    const to = v.moving ? wheelStep(g.x, g.z, v.x, v.z, v.yaw, (Math.max(4, v.speed || 0) * 1.6 + 2) * span + 0.02, Boolean(v.reversing)) : [g.x, g.z];
    v.x = g.x = to[0]; v.z = g.z = to[1];
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
  //: A walker's pace over a crossing (m/s) and the time they want in hand past a car's line (s).
  const WALK_OVER_MS = 1.35, CROSS_MARGIN_S = 2;
  //: How near your garage you drive before its door goes up (m).
  const GARAGE_REMOTE_M = 9;
  //: A car held by people on foot this long has the next gap; a walker who has waited this long goes.
  const CAR_TURN_S = 6, WALKER_PATIENCE_S = 18;
  const kerbTraffic = { at: -1, list: [] };
  const crossingEnds = new WeakMap();
  //: How far back from a crosswalk each walker waits (m, by their walk): a step short of it, or a
  //: pace or few back, so those waiting stand one behind another and not all at the kerb's edge.
  const KERB_BACK_M = [1.2, 0.5, 5];
  //: How far past a crossing a walker must be before they may stand and wait for the next (m).
  const KERB_CLEAR_M = 0.8;
  const kerbBack = (walk) => KERB_BACK_M[0] + KERB_BACK_M[1] * (hash32(walk.key) % KERB_BACK_M[2]);
  function waitsAtKerb(walk, tsec, pos = null) {
    const list = walk.pave?.crossings;
    if (!list?.length) return false;
    const waited = district.city?.walkLags.get(walk.key)?.lag || 0;
    const back0 = kerbBack(walk);
    // On a crossing already: on over, whatever comes next. (Nobody stops in a roadway to wait
    // for the crossing after it: the place they would wait for that one was in this one.)
    for (const cr of list) if (walk.d > cr.s0 + 0.05 && walk.d < cr.s1 - 0.05) return false;
    // (Nor anywhere else in a roadway, however they came to be in one: they walk on out of it.)
    if (pos && district.city?.kerbside?.onRoad?.(pos.x, pos.z)) return false;
    for (let i = 0; i < list.length; i += 1) {
      const cr = list[i];
      const before = walk.dir > 0 ? cr.s0 - walk.d : walk.d - cr.s1;
      // (No further back from it than the ground since the last crossing allows: a step clear
      // of that one's roadway -- and where there is not a step between the two, no wait at all.)
      const other = walk.dir > 0 ? list[i - 1] : list[i + 1];
      const room = other ? (walk.dir > 0 ? cr.s0 - other.s1 : other.s0 - cr.s1) - KERB_CLEAR_M : Infinity;
      if (room < 0.3) continue;
      const back = Math.min(back0, room);
      if (before < -0.05 || before > back) continue;   // on it already: on over
      // The light: the street they cross must be held on red now, and still be when they are
      // most of the way over -- they know how long the crossing takes them and do not set out
      // on the last of a light, to be caught half way by the traffic starting (and seen there
      // stopping, stepping about and turning back).
      const over = Math.max(2, (cr.s1 - cr.s0) / WALK_OVER_MS);
      if (cr.signal && cr.node !== undefined && (signalAt(district.streets, cr.node, cr.bearing, tsec) !== "red"
        // (Where no red is long enough for the whole of a wide street, one who has waited two
        // lights sets out at the start of the next, as people do.)
        || (waited < WALKER_PATIENCE_S * 2 && (signalAt(district.streets, cr.node, cr.bearing, tsec + over * 0.5) !== "red" || signalAt(district.streets, cr.node, cr.bearing, tsec + over * 0.85) !== "red")))) return true;
      // (The crossing's two ends, kept on it: they were worked out again for every walker near a
      // kerb every frame -- 10 MB a second of garbage, 2026-11-20.)
      let ends = crossingEnds.get(cr);
      if (!ends || ends.pave !== walk.pave || ends.s0 !== cr.s0 || ends.s1 !== cr.s1)
        crossingEnds.set(cr, ends = { pave: walk.pave, s0: cr.s0, s1: cr.s1, a: alongRoute(walk.pave, cr.s0), b: alongRoute(walk.pave, cr.s1) });
      const a = ends.a, b = ends.b;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      // (Every vehicle a walker at a kerb looks for, listed once a frame: the list was made
      // again for every crossing of every walker.)
      if (kerbTraffic.at !== tsec) {
        kerbTraffic.at = tsec;
        const all = kerbTraffic.list; all.length = 0;
        for (const v of drawnCars) all.push(v);
        for (const v of routeBuses) all.push(v);
        if (taxi.at) all.push(taxi.at);
        if (car.active) all.push({ x: car.x, z: car.z, yaw: car.yaw, speed: Math.abs(car.speed), model: car.model });
      }
      for (const v of kerbTraffic.list) {
        if (v.parked || Math.abs(v.x - mx) > 60 || Math.abs(v.z - mz) > 60) continue;
        const vl = (VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan)[2];   // (read by index: destructuring made an iterator a car a look)
        const sp = v.speed || 0;
        // (A car stood waiting for someone on foot is not waited for in turn: it had been -- the
        // walker at the kerb for the car, the car for the walker, and the street behind it.)
        // (Nor any car stood still short of the crossing: walked in front of. Only one stood
        // on the crossing itself is in the way.)
        const near = distToSegment(v.x, v.z, a.x, a.z, b.x, b.z);
        if (near < (sp < 0.3 ? vl / 2 - 0.6 : vl / 2 + 1.2)) return true;
        // Turn and turn about: a driver held up by people on foot for a while has the next gap
        // -- those not yet on the crossing let it go -- unless they have waited long themselves.
        if (sp < 0.3 && v.held > CAR_TURN_S && waited < WALKER_PATIENCE_S && near < vl / 2 + 8) return true;
        if (sp < 0.5 || v.dwelling) continue;
        // Where its way meets the crossing's line (``k`` metres along it from the kerb), how far
        // ahead of it (``t``), and so how soon.
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), den = fx * uz - fz * ux;
        if (Math.abs(den) < 0.2) continue;
        const px = a.x - v.x, pz = a.z - v.z, t = (px * uz - pz * ux) / den, k = (px * fz - pz * fx) / den;
        // (Safe to cross: it will not be at their line across until they are past where it runs
        // -- the walk out to its lane, and a margin -- not a fixed few seconds whatever the
        // street's width. One who has waited long takes the old short gap: drivers stop for them.)
        const need = waited > WALKER_PATIENCE_S ? CROSS_GAP_S : Math.max(CROSS_GAP_S, Math.max(0, Math.min(len, walk.dir > 0 ? k : len - k)) / WALK_OVER_MS + CROSS_MARGIN_S);
        if (t > 0 && k > -2 && k < len + 2 && (t - vl / 2) / sp < need) return true;
      }
    }
    return false;
  }
  //: How far a driven car's body is turned off its route's heading (radians), from the ground it
  //: has really covered since it last stood ``BODY_TURN.span_m`` back: at most ``most`` either way,
  //: eased at ``rate`` a second, kept while it stands (wheels do not straighten a parked car).
  const BODY_TURN = { span_m: 0.5, most: 0.55, rate: 1.4 }, bodyTurns = new Map();
  function bodyTurn(id, pos, reversing, jumped, dt, now) {
    let b = bodyTurns.get(id);
    if (!b || jumped || now - b.t > 1500) { b = { x: pos.x, z: pos.z, off: 0, aim: 0, t: now }; bodyTurns.set(id, b); return 0; }
    b.t = now;
    const dx = pos.x - b.x, dz = pos.z - b.z, m = Math.hypot(dx, dz);
    if (m > 6) { b.x = pos.x; b.z = pos.z; b.aim = 0; }
    else if (m >= BODY_TURN.span_m) {
      const s = reversing ? -1 : 1;
      let a = Math.atan2(-dx * s, -dz * s) - pos.yaw;
      a = ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      // (Round a corner the route's own heading leads the chord by half the turn: no more is added.)
      b.aim = Math.abs(a) > 1.2 ? 0 : Math.max(-BODY_TURN.most, Math.min(BODY_TURN.most, a));
      b.x = pos.x; b.z = pos.z;
    }
    const step = BODY_TURN.rate * Math.min(0.1, dt || 0.016);
    b.off += Math.max(-step, Math.min(step, b.aim - b.off));
    if (bodyTurns.size > 3000) for (const [k, q] of bodyTurns) if (now - q.t > 3000) bodyTurns.delete(k);
    return b.off;
  }
  function frameCity(ms, dt, now, focus) {
    const c = district.city, D = district.drivers, tt = fleetAt(ms), gms = tt.gameMs;
    eyeNow();
    holdFrame(ms, now);
    closeFocus = { x: focus.x, z: focus.z };
    peopleLock.frame(focus, now); carsLock.frame(focus, now);
    // (``tsec``: the real second, for the lights and the traffic's rules, which never stand still.
    // Where each car is on its leg is by its owner's own time -- everyone's, unless the clock is held.)
    const reach = Math.max(R.routine.visible_radius_m, scanReach || 0), tsec = ms / 1000;
    const people = [];
    const you = me();
    let trackedPeople = 0;
    // The cars a walker may have to get clear of: yours, and any of the city's that is moving
    // fast and not braking (one that is braking has seen them).
    threats.length = 0;
    if (car.active && Math.abs(car.speed) > 2.5) threats.push({ x: car.x, z: car.z, vx: -Math.sin(car.yaw) * car.speed, vz: -Math.cos(car.yaw) * car.speed, half: (VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan)[0] / 2 });
    for (const v of lastTraffic) {
      if (!v.moving || v.braking || !(v.speed > 6) || Math.abs(v.x - focus.x) > 70 || Math.abs(v.z - focus.z) > 70) continue;
      threats.push({ x: v.x, z: v.z, vx: -Math.sin(v.yaw) * v.speed, vz: -Math.cos(v.yaw) * v.speed, half: 0.95 });
    }
    while (incidents.length && now - incidents[0].t0 > REACT.incident_s * 1000) incidents.shift();
    for (const e of scan.people) {
      // Tracked only, or drawn low and placed a moment ago: left as it is until its next look.
      const id = e.p.id, was = personTiers.get(id);
      if (was && now < was.next) {
        if (was.tier === TRACKED) { trackedPeople += 1; continue; }
        if (was.entry) {
          // Between looks they go on the way they were going, at their pace: left where they
          // were last put for a tenth of a second or two and then put on, they went along in
          // jerks, and anything that set them back a step showed as a walk backwards.
          const q = was.entry;
          if (q.moving && !q.down) {
            const v = q.speed || q.person?.pace || 1.3, step = Math.min(dt, 0.1) * v;
            q.x -= Math.sin(q.yaw) * step; q.z -= Math.cos(q.yaw) * step;
            const g = glided.get(id);
            if (g) { g.x = q.x; g.z = q.z; g.t = now; }
          }
          people.push(q); continue;
        }
      }
      const tp = timeFor(id, tt);
      const seg = e.seg && tp.minute < e.seg.t1 && tp.minute >= e.seg.t0 ? e.seg : undefined;
      const pos = c.personAt(e.p, tp, seg, focus);
      if (!pos || Math.abs(pos.x - focus.x) > reach || Math.abs(pos.z - focus.z) > reach) { personTiers.delete(id); continue; }
      // In a shop and not the one you are in: seen through its window from close by, or not at all.
      let tier = detailNow ? detailNow.tier("people", pos.x, pos.z, was?.tier) : FULL;
      if (pos.indoors && pos.indoors !== shop.place?.id && Math.hypot(pos.x - you.x, pos.z - you.z) > INDOOR_SEEN_M) tier = TRACKED;
      if (tier === TRACKED) { personTiers.set(id, { tier, next: nextAt(id, now, TRACK_EVERY_MS), seen: now }); trackedPeople += 1; continue; }
      // (In sight -- or drawn close by, seen or not: their day is not started again under them.)
      if (!unseenAt(pos.x, pos.z) || lockedClose(peopleLock, "people", id)) holdInSight(id, now);
      const entry = { id, person: e.p, ...pos, detail: tier };
      // In the shop room you are in: walked round its aisles to a till and out (shop-floor.mjs).
      const walkedIn = Boolean(pos.indoors && shop.frame?.store && floor.walk(entry, you, dt, gameHour()));
      // Doing you a favour (favour-run.mjs): where the favour has them, their day kept waiting.
      favourWalk = pos.walk; favourDt = Math.min(dt, 0.25);
      const favoured = !walkedIn && favours.drive(entry, pos, you, dt, holdFavoured);
      // Someone you are talking with stops where they are and faces you until you are done (or walk off).
      const held = !favoured && talking.id === id && now < talking.until && !pos.down && Math.hypot(pos.x - you.x, pos.z - you.z) < 14;
      if (held) {
        talking.at ||= { x: pos.x, z: pos.z };
        // Called over (a click on them where they work): they walk up to you, then ask what you need.
        let coming = false;
        if (talking.come) {
          const cx = you.x - talking.at.x, cz = you.z - talking.at.z, cd = Math.hypot(cx, cz);
          if (cd > 1.1 && now - talking.come.since < 15000) { const st = Math.min(1.3 * dt, cd - 1.0); talking.at.x += (cx / cd) * st; talking.at.z += (cz / cd) * st; coming = true; }
          else { const c = talking.come; talking.come = null; try { staffArrived(c.place, entry); } catch (error) { console.warn("staff", error); } }
        }
        entry.x = talking.at.x; entry.z = talking.at.z; entry.moving = coming; entry.gesture = null; entry.activity = coming ? "coming over to you" : "talking with you";
        entry.yaw = Math.atan2(-(you.x - entry.x), -(you.z - entry.z));
        if (pos.walk) c.holdWalk(pos.walk.key, Math.min(dt, 0.25), true);   // their walk waits: they go on from here
      } else if (talking.id === id && (now >= talking.until || Math.hypot(pos.x - you.x, pos.z - you.z) >= 14)) { talking.id = null; talking.at = null; }
      if (pos.through && Math.abs(pos.x - you.x) < 60 && Math.abs(pos.z - you.z) < 60 && !(nudged.get(entry.id) > now - 2500)) { nudged.set(entry.id, now); ctx.nudgeDoor?.(pos.x, pos.z); }
      // Stepping round you: a walker who would walk into you goes by a pace to the side.
      if (pos.moving && !car.active && !held && !favoured && !walkedIn) {
        const fx = -Math.sin(pos.yaw), fz = -Math.cos(pos.yaw), dx = you.x - pos.x, dz = you.z - pos.z;
        const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
        let want = 0;
        if (ahead > -0.5 && ahead < 3 && Math.abs(side) < 0.9) want = (side >= 0 ? -1 : 1) * (0.95 - Math.abs(side));
        const was = dodge.get(entry.id) || 0, now2 = was + (want - was) * Math.min(1, dt * 4);
        if (Math.abs(now2) > 0.01) { dodge.set(entry.id, now2); entry.x += fz * now2; entry.z -= fx * now2; } else dodge.delete(entry.id);
      }
      // Looking ahead (npc-steer.mjs): round someone standing in their way, the side chosen and the
      // step begun before they get there, not when they bump.
      if (pos.moving && !held && !favoured && !pos.indoors && !pos.through && !pos.down && tier !== LOW) {
        swerveFrom = entry;
        const want = swerveAhead(entry.x, entry.z, pos.yaw, aheadOf(entry), { free: swerveFree, look: 3.2 });
        const was0 = swerved.get(id) || 0, s2 = was0 + (want - was0) * Math.min(1, dt * 3);
        if (Math.abs(s2) > 0.01) { swerved.set(id, s2); entry.x += Math.cos(pos.yaw) * s2; entry.z -= Math.sin(pos.yaw) * s2; } else if (was0) swerved.delete(id);
      }
      // Their own mind (temperament.mjs), near you only: clear of a car that is not stopping,
      // and what they make of a crash or a fight.
      let busy = false;
      if (tier !== LOW && !pos.indoors && !pos.down && !held && !favoured && !flings.has(id)) {
        const mind = temperamentOf(e.p);
        let sc = scares.get(id);
        if (!sc || now > sc.until) {
          for (let k = 0; k < threats.length; k += 1) {
            const th = threats[k];
            if (Math.abs(th.x - pos.x) > 40 || Math.abs(th.z - pos.z) > 40) continue;
            const step = stepClear(mind, pos.x, pos.z, th.x, th.z, th.vx, th.vz, th.half);
            if (!step) continue;
            sc = { until: now + REACT.jump_s * 1000, dx: step.dx, dz: step.dz, k: sc ? sc.k : 0 };
            scares.set(id, sc);
            break;
          }
        }
        if (sc) {
          const out = now < sc.until;
          sc.k += ((out ? 1 : 0) - sc.k) * Math.min(1, dt * (out ? 9 : 3));
          if (!out && sc.k < 0.03) scares.delete(id);
          else {
            entry.x += sc.dx * sc.k; entry.z += sc.dz * sc.k;
            if (out) { busy = true; entry.activity = "getting out of the way"; if (mind.nerve < 0.45) entry.gesture = { kind: "guard", f: 0.5 }; if (pos.walk) c.holdWalk(pos.walk.key, Math.min(dt, 0.25), true); }
          }
        }
        let re = reacting.get(id);
        if (!re && !busy) for (const inc of incidents) {
          if (inc.seen.has(id)) continue;
          const d = Math.hypot(inc.x - pos.x, inc.z - pos.z);
          if (d > REACT.notice_m) continue;
          inc.seen.add(id);
          let kind = reactionTo(mind, inc, d, id);
          // (Whether anyone calls about something you did is the law's to weigh: police.mjs.)
          if (kind === "call" && inc.byYou) kind = "watch";
          // (So many do each thing and no more: the rest look on, or walk on.)
          inc.did ||= {};
          if (kind !== "carry_on" && (inc.did[kind] || 0) >= REACT.most[kind]) kind = kind !== "watch" && kind !== "flee" && (inc.did.watch || 0) < REACT.most.watch ? "watch" : "carry_on";
          if (kind !== "carry_on") inc.did[kind] = (inc.did[kind] || 0) + 1;
          if (kind !== "carry_on") { re = { kind, until: now + reactionFor(mind, kind) * 1000, ix: inc.x, iz: inc.z, at: { x: pos.x, z: pos.z }, off: 0, far: REACT.flee_m[0] + (REACT.flee_m[1] - REACT.flee_m[0]) * (1 - mind.nerve), inc }; reacting.set(id, re); }
          break;
        }
        if (re) {
          if (now > re.until) reacting.delete(id);
          else {
            const ax = re.ix - re.at.x, az = re.iz - re.at.z, L = Math.hypot(ax, az) || 1, ux = ax / L, uz = az / L;
            busy = true; entry.gesture = null;
            if (re.kind === "flee") {
              const next = Math.min(re.far, re.off + REACT.flee_ms * dt), nx = re.at.x - ux * next, nz = re.at.z - uz * next;
              // (Not into the road, and not through a wall: they stop short and keep their distance.)
              const going = next > re.off && !(ctx.roadAt?.(nx, nz) && !ctx.roadAt?.(re.at.x, re.at.z)) && !c.footprintAt?.(nx, nz);
              if (going) re.off = next;
              entry.x = re.at.x - ux * re.off; entry.z = re.at.z - uz * re.off; entry.moving = going; entry.yaw = Math.atan2(ux, uz); entry.activity = "running from it";
            } else if (re.kind === "fight") {
              // Squaring up to you: in to arm's length, facing you, fists up.
              const next = Math.min(Math.max(0, L - 0.9), re.off + 1.6 * dt), going = next > re.off + 1e-4;
              re.off = next;
              entry.x = re.at.x + ux * re.off; entry.z = re.at.z + uz * re.off; entry.moving = going; entry.yaw = Math.atan2(-ux, -uz);
              entry.activity = "squaring up to you"; entry.gesture = { kind: "guard", f: 1 };
            } else if (re.kind === "shout" || re.kind === "freeze") {
              entry.x = re.at.x; entry.z = re.at.z; entry.moving = false; entry.yaw = Math.atan2(-ux, -uz);
              entry.activity = re.kind === "shout" ? "shouting for help" : "frozen to the spot";
              if (re.kind === "freeze") entry.gesture = { kind: "guard", f: 0.4 };
            } else if (re.kind === "help") {
              const next = Math.min(Math.max(0, L - 1.8), re.off + 2.4 * dt), going = next > re.off + 1e-4;
              re.off = next;
              entry.x = re.at.x + ux * re.off; entry.z = re.at.z + uz * re.off; entry.moving = going; entry.yaw = Math.atan2(-ux, -uz); entry.activity = going ? "going to help" : "helping";
            } else {
              entry.x = re.at.x; entry.z = re.at.z; entry.moving = false; entry.yaw = Math.atan2(-ux, -uz);
              entry.activity = re.kind === "call" ? "calling 911" : re.kind === "film" ? "filming it" : "watching";
              if (re.kind !== "watch") entry.gesture = { kind: re.kind === "call" ? "phone" : "film", f: 0.5 };
              if (re.kind === "call" && !re.inc.called && !re.inc.byYou && now - re.inc.t0 > 2500) { re.inc.called = true; sendPatrol(re.inc); if (Math.hypot(re.ix - you.x, re.iz - you.z) < 45) notify(re.victim ? "The one you hit is calling 911: a patrol car is on its way." : re.inc.byYou ? "Someone who saw it is calling 911." : "A passer-by is calling 911."); }
            }
            if (pos.walk) c.holdWalk(pos.walk.key, Math.min(dt, 0.25), true);
          }
        }
      }
      // A witness to something of yours: whether they call, and their phone out while they do (police.mjs).
      police.personFrame(id, entry, () => temperamentOf(e.p), dt, Boolean(pos.down));
      // Struck (strikePerson): carried back along the blow a step at a time, or swayed and back.
      const sg = staggers.get(id);
      if (sg) {
        const age = (now - sg.t0) / 1000, k0 = Math.min(1, age / sg.dur);
        // A stumble holds where it ended while they react to it, then they are back on their way.
        const hold = !sg.flinch && (reacting.has(id) || age < sg.dur + 1.5);
        if (!sg.flinch && !hold && sg.end === undefined) sg.end = age;
        const k = sg.flinch ? Math.sin(k0 * Math.PI) : hold ? 1 - (1 - k0) ** 2 : Math.max(0, 1 - (age - sg.end) / 1.2);
        if (k <= 0 && age > sg.dur) staggers.delete(id);
        else {
          entry.x += sg.dx * sg.dist * k; entry.z += sg.dz * sg.dist * k;
          if (age < sg.dur) { busy = true; entry.moving = !sg.flinch; entry.yaw = Math.atan2(-sg.dx, -sg.dz); entry.activity = sg.flinch ? "flinching" : "stumbling back"; entry.gesture = { kind: "guard", f: 0.6 }; }
          // (Drawn as the blow's own move: a flinch at the head or the chest, a stumble knocked back.)
          if (age < sg.dur + 0.6) entry.hitMove = { name: sg.flinch ? (sg.head ? "HitHead" : "HitChest") : "Knockback", key: sg.t0 };
        }
      }
      // At the kerb of a crosswalk: waiting for the light or a gap in the traffic, then over.
      if (pos.walk && pos.moving && !pos.down && !held && !busy) {
        const hold = waitsAtKerb(pos.walk, tsec, pos);
        // (One placed only now and then is held for the time since it was last placed.)
        c.holdWalk(pos.walk.key, Math.min(was?.seen ? Math.max(dt, (now - was.seen) / 1000) : dt, 0.25), hold);
        if (hold) { entry.moving = false; entry.activity = "waiting to cross"; }
      }
      const f = flings.get(entry.id);
      if (f?.kind) {
        // Hit by a car (crash.mjs personPose): gone over where they fell, folded onto its bonnet
        // and carried until it stands, or thrown on ahead.
        const age = (now - f.t0) / 1000, pose = personPose(f.kind, age, f);
        if (pose.carried) {
          const at = f.by === "me" ? (car.active ? car : null) : lastTraffic.find((x) => x.id === f.by);
          if (at) { const half = (VEHICLE_DIMS[at.model] || VEHICLE_DIMS.sedan)[2] / 2 - 0.55; f.dx = -Math.sin(at.yaw); f.dz = -Math.cos(at.yaw); f.x = at.x + f.dx * half; f.z = at.z + f.dz * half; }
        }
        entry.x = f.x + f.dx * pose.along; entry.z = f.z + f.dz * pose.along;
        entry.lift = pose.lift; entry.fall = pose.fall; entry.down = true; entry.moving = false; entry.yaw = Math.atan2(-f.dx, -f.dz);
        if (pose.done) { rests.set(id, { x: entry.x, z: entry.z, yaw: entry.yaw, t: now, crash: true }); if (pos.down || age > 6) flings.delete(id); }
      } else if (f) {
        const age = (now - f.t0) / 1000, k = Math.min(1, age / 0.7);
        entry.x = f.x + f.dx * f.throw * Math.sin(k * Math.PI / 2); entry.z = f.z + f.dz * f.throw * Math.sin(k * Math.PI / 2);
        entry.lift = Math.sin(k * Math.PI) * Math.min(1.2, f.speed * 0.12); entry.fall = k; entry.down = true; entry.moving = false;
        entry.yaw = Math.atan2(-f.dx, -f.dz);
        // (Knocked down by a blow: the crowd's fall, played once and held where they lie.)
        entry.hitMove = { name: "Fall", key: f.t0 }; entry.lift = 0;
        if (age > R.harm.down_s) flings.delete(entry.id);
      } else if (pos.down) {
        entry.fall = 1; entry.down = true;
        if (!rests.get(id)?.crash) entry.hitMove = { name: "Fall", key: "down" };
        const lying = rests.get(id);
        if (lying) { entry.x = lying.x; entry.z = lying.z; entry.yaw = lying.yaw; }
        // To be carried (the books: hurt badly enough for hospital): theirs is a scene, and an
        // ambulance comes for them -- on its stretcher while its crew has them, then gone in.
        if (pos.carried) {
          scenes.casualty(entry, now);
          const cp = scenes.casualtyPose(id);
          if (cp?.hidden) continue;
          if (cp) { entry.x = cp.x; entry.z = cp.z; entry.yaw = cp.yaw; entry.lift = cp.lift; }
        }
      }
      else {
        glide(entry, now, dt, 3.2, 60, tier === LOW, true);
        // (Nobody walks backwards: see strides below, once everyone has stepped apart.)
        // (A glide or a step round you is a straight line: kept out of the walls as the way is.)
        if (!entry.indoors && !entry.through && c.keepOutside(entry, "view")) { const g = glided.get(entry.id); if (g) { g.x = entry.x; g.z = entry.z; } }
      }
      const low = tier === LOW && !f;
      personTiers.set(id, { tier, next: low ? nextAt(id, now, LOW_EVERY_MS) : 0, entry: low ? entry : null, seen: now });
      people.push(entry);
    }
    // Close by, nobody appears, vanishes, or is put ahead to where their day has them.
    {
      const kept = peopleLock.step(people, dt, now);
      people.length = 0;
      for (const e of kept) {
        // (One held back walks on from where they are: kept out of the walls as the way is.)
        if ((e.lagM || e.ghost) && !e.indoors && !e.through && c.keepOutside(e, "view")) { const r = peopleLock.records.get(e.id); if (r) { r.x = e.x; r.z = e.z; } }
        // Behind on their walk: the time is their walk's own (walkLags), so from next frame their
        // day has them along their own way, where they are -- round the corner, not through it.
        // (Finishing their own way first: the walk their day is on now waits for them.)
        // (Behind on it, or finishing their own way first: their walk waits for them -- the time
        // they are behind is their walk's own, walkLags, given back once they are out past the ring.)
        if ((e.ownWay || e.lagM > 0.05) && !e.ghost && e.walk?.key) c.holdWalk(e.walk.key, Math.min(dt, 0.25), true, CLOSE.walk_lag_s);
        people.push(e); const g = glided.get(e.id); if (g) { g.x = e.x; g.z = e.z; }
      }
    }
    // In line at a door: going the same way through it, one at a time (npc-steer.mjs).
    let doorway = 0;
    for (const e of people) if (e.through) doorway += 1;
    if (doorway > 1) for (const id of doorHolds(people)) {
      const e = people.find((x) => x.id === id);
      if (!e) continue;
      e.moving = false; e.activity = "waiting at the door";
      if (e.walk) c.holdWalk(e.walk.key, Math.min(dt, 0.25), true);
    }
    keepApart(people, you, dt);
    spreadClumps(people, c, now, dt);
    drawnTiers.clumps = clumps;
    if (shop.frame?.store) floor.step({ x: you.x, z: you.z }, dt);
    floor.frame({ x: you.x, z: you.z, yaw: ctx.getYaw() });
    if (swerved.size > 4000) swerved.clear();
    // Nobody walks backwards or sideways (stride.mjs): each one near you is drawn on a body that
    // turns round -- on the spot when slow, round a wider turn the faster -- and steps only the way
    // it faces. (Not the low tier, placed now and then and kept from frame to frame.)
    for (const e of people) {
      if (e.detail === LOW || e.down || e.ride || e.fall || e.gesture || e.lift) { strides.forget(e.id); continue; }
      strides.follow(e, now, dt, e.person?.pace ?? 1.35);
    }
    if (now - stridesSwept > 2000) { stridesSwept = now; strides.sweep(now); }
    // (Close by, nothing after the lock moves anyone further than they could go: close-lock.mjs.)
    peopleLock.settle(people, now);
    drawnTiers.tracked.people = trackedPeople;
    if (personTiers.size > 30000) for (const [id, q] of personTiers) if (now - q.seen > 5000) personTiers.delete(id);
    if (scares.size > 400) scares.clear();
    if (reacting.size > 400) for (const [id, q] of reacting) if (now > q.until) reacting.delete(id);
    // The cars: parked where they stand; driving, on their leg.
    const sim = [], vehicles = [], legOf = new Map();
    const parkedAt = (base, spot) => { Object.assign(base, spot); base.moving = false; base.parked = true; return base; };
    const limitAt = (model) => (cls) => {
      const law = cls === "residential" ? (view || world)?.laws?.speed_limit_kmh_residential : null;
      const top = (law ? law / 3.6 : SPEED_MS[cls || "residential"]) * (model === "bus" || model === "box_truck" ? 0.8 : 0.95);
      return model === "bike" ? Math.min(BIKE_TOP_MS, top) : top;
    };
    let trackedCars = 0;
    for (const e of scan.vehicles) {
      // Far off and not being driven by the rules: left until its next look (it is only tracked).
      const wasCar = carTiers.get(e.v.id);
      if (wasCar?.tier === TRACKED && now < wasCar.next && !D.stateOf(e.v.id)) { trackedCars += 1; continue; }
      const v = e.v, s0 = e.s, h0 = harmNow((world || view)?.harm?.get(v.id), gms), tv = timeFor(e.who ?? v.owner, tt);
      const dayStart = tv.ms - tv.minute * 60000, shift = (tv.ms - ms) / 1000;
      if (h0?.out) continue;
      // (``base`` is this frame's own record of the car, made here and drawn once: it is filled in,
      // not copied, whichever way below it goes.)
      const base = { id: v.id, vehicle: v, model: v.model, shade: v.shade, condition: h0?.condition ?? 100, plate: v.plate, damage: h0?.damage || carDents.get(v.id)?.damage || null };
      if (h0?.stays) {
        base.x = h0.at.x; base.z = h0.at.z; base.yaw = h0.at.yaw || 0; base.moving = false;
        // Stood at the mechanic's, made good (crash.mjs): parked there. Else a wreck where it
        // stopped: its scene's, until the tow truck has it -- drawn up behind the truck, then gone.
        if (h0.shop) { base.parked = true; base.damage = null; vehicles.push(base); continue; }
        base.wrecked = true;
        scenes.wreck(base, now);
        const wp = scenes.wreckPose(v.id);
        if (wp?.hidden) continue;
        if (wp) { base.x = wp.x; base.z = wp.z; base.yaw = wp.yaw; base.pitch = wp.pitch; base.lift = wp.lift; base.towed = true; }
        vehicles.push(base); continue;
      }
      if (s0.state !== "driving") { base.x = s0.x; base.z = s0.z; base.yaw = s0.yaw; base.moving = false; base.parked = true; base.lock = s0.lock || null; vehicles.push(base); continue; }
      // A round at work (a patrol, a delivery round, a cab cruising) is a leg like any other:
      // driven by the rules near you, so it is never driven through what is in its way.
      let leg = s0.leg, route = null, key = null;
      if (s0.roam) {
        const owner = c.roster.people.get(v.owner), round = owner && c.roamDrive(owner, s0.leg, tv);
        if (!round) {
          const pos = owner && c.personAt(owner, tv, undefined, focus);
          if (pos && pos.mode === "drive") { Object.assign(base, pos).moving = true; vehicles.push(base); }
          continue;
        }
        leg = round; route = round.route; key = `${v.id}:${round.key}`;
      } else { route = c.legRoute(leg); key = City.legKey(v, leg, tv.day); }
      if (!route || route.length < 1) continue;
      const startS = (dayStart + leg.t0 * 60000) / 1000, durS = Math.max(1, (leg.t1 - leg.t0) * 60);
      const sched = (ts) => Math.max(0, Math.min(1, (ts + shift - startS) / durS)) * route.length;
      const unsched = (d) => startS + (d / route.length) * durS - shift;
      const [w, , l] = v.bike ? BIKE_DIMS : VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan;
      // Out of sight of the rules: where its day has it, as far behind as traffic left it.
      const lagged = sched(tsec - D.delayOf(key));
      const probe = alongRoute(route, lagged);
      // (Driven by the rules near you, and on till it is well away: then by its day again, as
      // far behind as the traffic left it -- so the cars driven do not only ever grow in number.)
      const off = Math.hypot(probe.x - focus.x, probe.z - focus.z);
      if ((off < SIM_M && !unseenAt(probe.x, probe.z)) || lockedClose(carsLock, "cars", v.id)) holdInSight(e.who ?? v.owner, now);
      if (off < SIM_M || (off < SIM_M * 1.8 && D.stateOf(v.id)?.key === key)) {
        sim.push({ id: v.id, key, route, sched, unsched, limitAt: limitAt(v.model), style: styleOf(v), cruise: Math.max(v.bike ? 3 : 4, (route.length / durS) * 1.35), length: l, width: w, unseen: unseenAt(probe.x, probe.z), bike: Boolean(v.bike) });
        legOf.set(v.id, { base, route });
      } else {
        // At the end of its leg it is parked there, in the parking lane (and from the next pass,
        // at its spot).
        if (lagged >= route.length - 0.5) { vehicles.push(parkedAt(base, route.endSpot || alongRoute(route, route.length, PARK_LANE))); continue; }
        // Not off yet (its leg starts later than the scan saw it): parked where it starts.
        if (lagged <= 0.05) { vehicles.push(parkedAt(base, route.startSpot || alongRoute(route, 0, PARK_LANE))); continue; }
        const pos = easeToSpots(route, lagged, alongRoute(route, lagged, v.bike ? BIKE_LANE : DRIVE_LANE));
        Object.assign(base, pos); base.moving = true; base.speed = route.length / durS; vehicles.push(base);
      }
    }
    // Driven by the rules: you and everyone near on foot are in the way to be braked for.
    const obstacles = [];
    if (!car.active && !car.riding && !transit.ride && !shop.place) obstacles.push({ id: "me", x: you.x, z: you.z, player: true });
    for (const q of people) if (!q.indoors && !q.down && Math.abs(q.x - focus.x) < SIM_M && Math.abs(q.z - focus.z) < SIM_M) obstacles.push({ id: q.id, x: q.x, z: q.z });
    // (Your pets out of doors: stopped for as someone in the road is.)
    for (const o of animalsUI?.obstacles() || []) obstacles.push(o);
    // In the way of the city's cars, and solid to them: your car, the route buses, your cab.
    const blockers = car.active ? [{ x: car.x, z: car.z, yaw: car.yaw, v: car.speed, length: (VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan)[2], width: (VEHICLE_DIMS[car.model] || VEHICLE_DIMS.sedan)[0] }] : [];
    for (const b of [...routeBuses, ...(taxi.at ? [taxi.at] : []), ...(patrol.at ? [patrol.at] : [])]) {
      if (Math.abs(b.x - focus.x) > SIM_M || Math.abs(b.z - focus.z) > SIM_M) continue;
      const [bw, , bl] = VEHICLE_DIMS[b.model || "bus"] || VEHICLE_DIMS.sedan;
      blockers.push({ x: b.x, z: b.z, yaw: b.yaw, v: b.dwelling ? 0 : b.speed || 0, length: bl, width: bw });
    }
    // A wreck stands in the lane, and what has come for it beside it: gone round (Drivers' dodge).
    scenes.step(Math.min(dt, 0.1), now, tsec);
    for (const w of vehicles) {
      if (!w.wrecked || w.towed || Math.abs(w.x - focus.x) > SIM_M || Math.abs(w.z - focus.z) > SIM_M) continue;
      const [bw, , bl] = VEHICLE_DIMS[w.model] || VEHICLE_DIMS.sedan;
      blockers.push({ x: w.x, z: w.z, yaw: w.yaw, v: 0, length: bl, width: bw });
    }
    for (const b of scenes.vehicles()) {
      if (Math.abs(b.x - focus.x) > SIM_M || Math.abs(b.z - focus.z) > SIM_M) continue;
      const [bw, , bl] = VEHICLE_DIMS[b.model] || VEHICLE_DIMS.sedan;
      blockers.push({ x: b.x, z: b.z, yaw: b.yaw, v: b.speed || 0, length: bl + (b.towing ? 5 : 0), width: bw });
    }
    // Cyclists are traffic too: a car behind one in a shared lane slows for it.
    // (The residents' own are driven by the rules with the cars, each seen by the other there.)
    for (const b of bikes) if (!b.resident && b.x !== undefined && Math.abs(b.x - focus.x) < SIM_M && Math.abs(b.z - focus.z) < SIM_M) blockers.push({ x: b.x, z: b.z, yaw: b.yaw, v: b.v, length: 1.8, width: 0.65 });
    if (sim.length) {
      const step = D.step(Math.min(dt, 0.1), tsec, sim, obstacles, blockers);
      for (const r0 of step.cars) {
        // (On its own way round a jam it is drawn along that; put somewhere else -- back on its
        // day, or past what shut the street -- it is there at once, not slid across the map.)
        const { base } = legOf.get(r0.id), route = r0.route || legOf.get(r0.id).route;
        if (r0.jump) { const g = glided.get(r0.id); if (!g || !closeIn("cars")(g.x, g.z, CLOSE.exit)) glided.delete(r0.id); }
        if (r0.arrived) { vehicles.push(parkedAt(base, route.endSpot || alongRoute(route, route.length, PARK_LANE))); continue; }
        // In its own lane (Drivers: the lane it chose, or on its way across to the next).
        const pos = easeToSpots(route, r0.d, alongRoute(route, r0.d, D.stateOf(r0.id)?.side || DRIVE_LANE));
        Object.assign(base, pos);
        // Its body turned the way it is really going (a swing out, a lane change, backing): the
        // route's heading alone had it slide sideways square to the street.
        if (!base.vehicle?.bike) base.yaw = pos.yaw + bodyTurn(r0.id, pos, Boolean(r0.reversing), Boolean(r0.jump), dt, now);
        base.moving = Math.abs(r0.v) > 0.2; base.speed = Math.abs(r0.v); base.braking = r0.braking; base.reversing = r0.reversing; base.reason = r0.reason; base.behind = r0.behind; base.held = r0.held || 0;
        vehicles.push(base);
      }
      for (const hit of step.hits) carHit(hit, people);
    }
    for (const v of vehicles) glideCar(v, now, dt);
    {
      const kept = carsLock.step(vehicles, dt, now);
      vehicles.length = 0;
      for (const v of kept) { vehicles.push(v); const g = glided.get(v.id); if (g) { g.x = v.x; g.z = v.z; } }
    }
    lastTraffic = vehicles;
    // Inside a shop its room is where you are: no car is drawn through it. (A room is laid inward
    // from the shop's front; where a front lies nearer the street than the map's kerb, traffic on
    // the nearest lane ran through the counter.)
    if (shop.frame && shop.room) {
      const F = shop.frame, half = F.W / 2 + 1.6;
      for (let i = vehicles.length - 1; i >= 0; i -= 1) {
        const q = F.local(vehicles[i].x, vehicles[i].z), reach = (vehicles[i].length || 4.5) / 2;
        if (q.u > -reach && q.u < F.D + reach && Math.abs(q.v) < half + reach) vehicles.splice(i, 1);
      }
    }
    // (Close by, no car or bicycle drawn further on than its wheels could take it: close-lock.mjs.)
    carsLock.settle(vehicles, now);
    // The bicycles apart from the cars: each with how far it has rolled (its wheels and cranks
    // turn by it), and its rider while it is ridden.
    residentBikes = [];
    for (let k = vehicles.length - 1; k >= 0; k -= 1) {
      const b = vehicles[k];
      if (b.model !== "bike") continue;
      vehicles.splice(k, 1);
      const odo = (bikeOdo.get(b.id) || 0) + (b.moving ? (b.speed || 0) * dt : 0);
      bikeOdo.set(b.id, odo);
      const owner = b.moving ? c.roster.people.get(b.vehicle.owner) : null;
      residentBikes.push({ id: b.id, resident: true, x: b.x, z: b.z, yaw: b.yaw, v: b.moving ? b.speed || 0 : 0, shade: b.shade, odo, person: owner || null, reason: b.reason, lock: b.moving ? null : b.lock || null });
    }
    if (bikeOdo.size > 5000) bikeOdo.clear();
    // (A bump's marks last while the car is about: gone from sight a while, it is as new.)
    if (carDents.size) { const about = new Set(); for (const w of vehicles) if (carDents.has(w.id)) { about.add(w.id); if (!unseenAt(w.x, w.z)) carDents.get(w.id).t = now; } for (const [id, dnt] of carDents) if (!about.has(id) || now - dnt.t > 45_000) carDents.delete(id); }
    if (rests.size > 60) for (const [id, r0] of rests) if (now - r0.t > 900_000) rests.delete(id);
    if (glided.size > 6000) for (const [id, g] of glided) if (now - g.t > 2000) glided.delete(id);
    for (const v of vehicles) { const j = jolts.get(v.id); if (j) { const age = (now - j.t0) / 1000; if (age > 1.2) jolts.delete(v.id); else v.jolt = Math.sin(age * 18) * Math.exp(-age * 3) * Math.min(0.12, j.speed * 0.01); } }
    // Each car's tier: the ones only tracked are kept track of, and not drawn (drawCars).
    let carHeld = 0;
    for (const v of vehicles) {
      const was = carTiers.get(v.id);
      let want = detailNow ? detailNow.tier("cars", v.x, v.z, was?.tier) : FULL;
      // The reality lock: in sight, or a quarter-turn from it, a car keeps the form it has unless
      // it is too far off for the change to show; out of sight it is brought up early.
      const dist = Math.hypot(v.x - EYE.x, v.z - EYE.z), inSight = EYE.ok && dist < 420 && withinView(EYE, EYE.fx, EYE.fz, v.x, v.z, EYE.half, LOCK.cars.margin_deg);
      if (EYE.ok && !inSight && want > FULL) { const early = dist / LOCK.cars.ahead; for (let i = 0; i < want; i += 1) if (early < DETAIL_RINGS.cars[i]) { want = i; break; } }
      const tier = was && now - was.seen < 600 ? lockedForm("cars", want, was.tier, inSight, dist) : want;
      if (tier !== want) carHeld += 1;
      if (was && inSight && was.tier !== tier && now - was.seen < 600) { lockStats.carChanges += 1; if (dist < LOCK.cars.swap_m[Math.min(tier, was.tier)]) lockStats.carChangesNear += 1; }
      v.detail = tier;
      carTiers.set(v.id, { tier, next: tier === TRACKED ? nextAt(v.id, now, TRACK_EVERY_MS) : 0, seen: now });
      if (tier === TRACKED) trackedCars += 1;
    }
    drawnTiers.tracked.cars = trackedCars; lockStats.carHeld = carHeld;
    if (carTiers.size > 20000) for (const [id, q] of carTiers) if (now - q.seen > 5000) carTiers.delete(id);
    drawnCars = vehicles;
    return { time: tt, people, vehicles };
  }
  // ---- crashes --------------------------------------------------------------------------------------
  //: What a crash leaves, and how it is cleared (crash.mjs, crash-scene.mjs). ``carDents``: one of
  //: the city's cars marked by a bump the books never heard of (most are not: view carHit) --
  //: marked while it is about, as new again once it has gone from sight. ``rests``: where the
  //: blow left someone lying, which is where they are until the ambulance has them.
  const carDents = new Map(), rests = new Map(), towedTo = new Map();
  const dentCar = (id, where, speed) => { if (id) carDents.set(id, { damage: impactOn(carDents.get(id)?.damage, { ...where, speed }), t: performance.now() }); };
  //: Where on ``v`` (a car: x, z, yaw, model) the point (x, z) is: crash.mjs impactZone.
  const zoneOn = (v, x, z) => {
    const fx = -Math.sin(v.yaw || 0), fz = -Math.cos(v.yaw || 0), dx = x - v.x, dz = z - v.z;
    return impactZone(dx * -fz + dz * fx, -(dx * fx + dz * fz), VEHICLE_DIMS[v.model] || VEHICLE_DIMS.sedan);
  };
  const scenes = crashScenes({ THREE, group, groundAt, streets: () => district.streets, traffic: () => lastTraffic, focus: () => (car.active ? car : me()), unseenAt, notify, dims: VEHICLE_DIMS,
    // Cleared: the books are told (the hurt to hospital; each car as new, stood at the mechanic's),
    // and those whose day it changes have it made again.
    clear: ({ vehicles = [], people = [], shop = null }) => {
      for (const id of vehicles) { carDents.delete(id); const owner = district.roster?.vehicles.get(id)?.owner; if (owner) district.city?.forget(owner); }
      for (const id of people) { rests.delete(id); district.city?.forget(id); }
      return send("crash_cleared", { vehicles, people, shop });
    },
    //: The kerb at the mechanic's nearest a wreck: where it stands when it has been towed.
    mechanicNear: (w) => {
      let best = null;
      for (const pl of district.workshops || []) { const d = Math.hypot(pl.x - w.x, pl.z - w.z); if (!best || d < best.d) best = { d, pl }; }
      if (!best) return null;
      const v = district.roster?.vehicles.get(w.id);
      let spot = null;
      try { spot = v ? district.city?.spotOf(v, best.pl.id) : null; } catch { spot = null; }
      // (No kerb found for it there: along the shop's front, each car towed in a car's length on
      // from the last -- two wrecks from one crash were stood on the same spot.)
      if (!spot || !Number.isFinite(spot.x) || spot.gateway || spot.garage || spot.indoors) {
        const F = best.pl.front || best.pl.door, n = towedTo.get(best.pl.id) || 0, along = ((n % 6) - 2.5) * 5.6;
        towedTo.set(best.pl.id, n + 1);
        const bx = (best.pl.door?.x ?? best.pl.x) + (F && Number.isFinite(F.nz) ? -F.nz * along : along), bz = (best.pl.door?.z ?? best.pl.z) + (F && Number.isFinite(F.nx) ? F.nx * along : 0);
        const at = district.city?.standOff?.(bx, bz) || [bx, bz];
        spot = { x: at[0], z: at[1], yaw: F && Number.isFinite(F.nx) ? Math.atan2(F.nz, -F.nx) : 0 };
      }
      return { x: spot.x, z: spot.z, yaw: spot.yaw || 0, name: best.pl.name || "the mechanic's" };
    },
    //: The block a crash is on, known shut to the city's drivers until ``until`` (fleet.mjs
    //: Drivers.jams: those who have not turned into it take another way; lookAhead).
    shut: (x, z, until) => {
      const S = district.streets, D = district.drivers, n = S?.nearest(x, z, "drive", 80);
      if (!D || n === null || n === undefined) return;
      let best = null;
      for (const e of S.edges[n]) { const a = S.nodes[n], b = S.nodes[e.to], d = distToSegment(x, z, a.x, a.z, b.x, b.z); if (!best || d < best.d) best = { d, to: e.to }; }
      if (!best) return;
      D.jams.set(`${n}>${best.to}`, until); D.jams.set(`${best.to}>${n}`, until);
      D.tally.shut = (D.tally.shut || 0) + 1;
    } });
  //: Someone hit by a car at ``speed``, the way it was going (dx, dz): gone over, folded onto its
  //: bonnet and carried, or thrown (crash.mjs personImpact). ``by``: the car's id, or "me".
  function struck(q, by, dx, dz, speed, model, stop = null) {
    flings.set(q.id, { kind: personImpact(speed), t0: performance.now(), x: q.x, z: q.z, dx, dz, speed, by, car: VEHICLE_DIMS[model] || VEHICLE_DIMS.sedan, stop: stop ?? Math.max(1, speed * speed / (2 * 6.5)) });
  }
  //: A car of the city's that could not stop: it hits you, or someone on foot.
  let lastCityCrash = -Infinity;
  async function carHit(hit, people) {
    const v = district.roster?.vehicles.get(hit.car);
    jolts.set(hit.car, { t0: performance.now(), speed: hit.speed });
    debrisAt(hit.x - Math.sin(hit.yaw) * 2, hit.z - Math.cos(hit.yaw) * 2, hit.yaw, hit.speed);
    const dx = -Math.sin(hit.yaw), dz = -Math.cos(hit.yaw);
    // The marks it leaves (crash.mjs): the front of the one that hit -- a body gives less than a
    // car does -- and, of a car hit, the part of it that was struck.
    const hitWhere = { zone: "front", bias: 0, at: 0 };
    let otherWhere = null;
    dentCar(hit.car, hitWhere, hit.kind === "vehicle" ? hit.speed : hit.speed * 0.35);
    if (hit.kind === "vehicle" && hit.target) {
      const tv = district.roster?.vehicles.get(hit.who);
      otherWhere = zoneOn({ ...hit.target, model: tv?.model }, hit.x + dx * 2.2, hit.z + dz * 2.2);
      dentCar(hit.who, otherWhere, hit.speed);
    }
    if (hit.player) {
      noteIncident("crash", hit.x, hit.z, false);
      knockBack(dx, dz, hit.speed);
      const r = await send("collision", { kind: "hit_by_car", speed: hit.speed, vehicle: { id: hit.car, plate: v?.plate, x: hit.x, z: hit.z, yaw: hit.yaw } });
      if (r.ok) notify(`Hit by a car (${v?.plate || "?"}) at ${Math.round(hit.speed * MPH)} mph: ${r.injury.type}, -${r.injury.health} health. ${r.paid_by ? `${r.paid_by[0].toUpperCase()}${r.paid_by.slice(1)} pays the hospital.` : ""}`);
      return;
    }
    // Between the city's own people a crash with casualties is an event, not the traffic's
    // ordinary state: only a hard one (20 mph and over) is taken to the books, and at most one a
    // minute. (Every touch counted, some twenty residents a minute were hurt and lay where they fell.)
    if (hit.speed < 9 || performance.now() - lastCityCrash < 60_000) return;
    lastCityCrash = performance.now();
    // (The people near it make of it what they will: view.mjs frameCity, temperament.mjs.)
    noteIncident("crash", hit.x, hit.z, false);
    const q = hit.kind !== "vehicle" && people.find((x) => x.id === hit.who), other = district.roster?.vehicles.get(hit.who);
    if (!world || !v || (!q && !other)) return;
    const driver = district.roster.people.get(v.owner), targetDriver = other && district.roster.people.get(other.owner);
    const target = hit.kind === "vehicle" ? { ...hit.target, id: other.id, plate: other.plate, driver: other.owner, driverName: targetDriver?.name, kind: "vehicle", where: otherWhere }
      : { id: q.id, name: q.person?.name, x: q.x, z: q.z, yaw: q.yaw, kind: "person" };
    if (q) struck(q, hit.car, dx, dz, hit.speed, v.model, 0.5);
    const incident = world.npcCollision({ id: hit.id, vehicle: { id: v.id, plate: v.plate, driver: v.owner, driverName: driver?.name, x: hit.x, z: hit.z, yaw: hit.yaw, where: hitWhere }, target,
      speed: hit.speed, context: { ...hit.context, region: district.region, lonLat: ctx.toLonLat?.(hit.x, hit.z) } });
    // A partial person in it pays their share out of their own balance (fleet.mjs billPartial):
    // the one time their money moves.
    for (const id of new Set([v.owner, other?.owner])) {
      const bill = district.roster.billPartial?.(id, 380 + hit.speed * hit.speed * 9, "collision repair", fleetAt(Date.now()).day);
      if (bill) incident.partial_bills = [...(incident.partial_bills || []), { id, ...bill }];
    }
    console.warn("kerbside: NPC collision", incident);
    district.city.forget(v.owner); if (q) district.city.forget(q.id); if (other) district.city.forget(other.owner);
    if (Math.hypot(hit.x - me().x, hit.z - me().z) < 60) notify(`A car (${v.plate}) hit ${q?.person?.name || other?.plate || "someone"} at ${Math.round(hit.speed * MPH)} mph. Driver cited; repair and care bills recorded.`);
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
  //: Your cars as their crashes have left them (crash.mjs): the one you drive and those parked,
  //: each body's shape and marks from its own record; and the driven one no faster than its
  //: damage lets it go. Kept so until a mechanic's body repair (workshop.mjs).
  function carMarks() {
    const w = view;
    if (!w) return;
    const one = (id, mesh) => {
      const a = w.registry.get(id);
      if (!a || !mesh || !mesh.children.length) return;
      dentBody(mesh, mesh.userData.dims || VEHICLE_DIMS[a.attrs.model] || VEHICLE_DIMS.sedan, a.attrs.damage || null);
    };
    if (car.active && car.mesh) { one(car.vehicle, car.mesh); const a = w.registry.get(car.vehicle); if (a && car.spec) car.top = car.spec.top_kmh / 3.6 * damagePace(a.attrs.damage); }
    for (const [id, mesh] of parked) one(id, mesh);
  }
  function drawParked() {
    const w = view;
    if (!w) return;
    const p = w.players.get(myId);
    const mine = p ? w.registry.held(p.account).filter((a) => a.kind === "vehicle" && !a.attrs.serviceBay) : [];
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
  // (V's shift tasks are R's; B's bicycle and J's board are Enter's and the To do list's; K's pets
  // are on your profile; E's climbing is Space's; H is ? or /; PageUp / PageDown are Shift + Up / Down.
  // G's picking up is a click's; U's using is a right click's (and a click on the food); C's thrust
  // and shove are Shift + X: the point or the flat of the hand instead of X's swing.)
  const KEYS = {
    i: () => openSide("bag"),
    x: () => swingKey(), "shift+x": () => thrustKey(), q: () => throwKey(), " ": () => jumpKey(), z: () => restKey(),
    "?": () => openSide("help"), "/": () => openSide("help"), l: () => animals().leashKey(),
    r: () => toolWorkKey(true), y: () => answerKey(true), n: () => answerKey(false),
  };
  for (let i = 0; i < BAR; i += 1) KEYS[String(i + 1)] = () => selectSlot(i);
  addEventListener("keydown", (e) => {
    if (e.key === "Shift") { if (!typing(e.target)) body.sprintHeld = true; return; }
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !ctx.enabled()) return;
    // In court the arrows walk and Space moves the hearing on (court-session.mjs); in cuffs, nothing.
    if (court.active || police.locked) return;
    if (e.key === " " && e.target instanceof HTMLButtonElement) return;   // Space on a focused button presses it
    // On the map the walker jumps too (Space); the game's other keys are City mode's.
    if (ctx.cityMode?.() === false) { if (e.key === " ") { e.preventDefault(); jumpKey(); } return; }
    // At the wheel, A D S P are the driving helpers' (driveKey).
    if (car.active && e.key.length === 1 && driveKey(e.key.toLowerCase())) { e.preventDefault(); return; }
    const k0 = e.key.length === 1 ? e.key.toLowerCase() : "", k1 = e.shiftKey && KEYS[`shift+${k0}`] ? `shift+${k0}` : k0;
    if (e.key.startsWith("Arrow")) { arrowsHeld.add(e.key); learnKey("arrows"); return; }
    const run = KEYS[k1];
    if (!run) return;
    e.preventDefault();
    learnKey(k1);
    run();
  });
  //: Keys held down now (U held eats on).
  const keyHeld = {};
  addEventListener("keydown", (e) => { if ((e.key === "r" || e.key === "R") && !typing(e.target)) keyHeld.r = true; }, true);
  //: The right button held (module 22: useDown / useUp): what a right click uses goes on while it is
  //: down -- eating or drinking to the end (as U held did).
  function useDown() { keyHeld.u = true; }
  function useUp() { if (keyHeld.u) { keyHeld.u = false; eatPlay.press(false); } }
  addEventListener("keyup", (e) => {
    if (e.key === "Shift") body.sprintHeld = false;
    if (e.key.startsWith("Arrow")) arrowsHeld.delete(e.key);

    if (e.key === "r" || e.key === "R") { keyHeld.r = false; toolWorkKey(false); }
  });
  addEventListener("blur", () => { body.sprintHeld = false; keyHeld.u = false; keyHeld.r = false; arrowsHeld.clear(); eatPlay.press(false); pressUp(); toolWorkKey(false); });

  async function toggleCar() {
    if (!ctx.enabled() || entry) return;
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
      if (!globalThis.confirm?.(`This car (${theirs.attrs.plate}) is not yours. Take it anyway? That is theft: if anyone calls it in, the police will come for you.`)) return;
      const r = await send("take", { asset: theirs.id, witnesses: Math.min(3, visible.people.filter((x) => Math.hypot(x.x - here.x, x.z - here.z) < 30).length) });
      if (!r.ok) { notify(r.error); return; }
      if (r.offence) police.crime(r.offence, { x: theirs.attrs.x ?? here.x, z: theirs.attrs.z ?? here.z }, { plate: theirs.attrs.plate, alarm: r.offence.alarm });
      notify(r.offence?.alarm ? "The car's alarm goes off." : "Nobody seems to have noticed.");
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
#city-side.wide{width:min(500px,calc(100vw - 24px))}${FINANCE_CSS}
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
#city-tasks{left:var(--city-tasks-x,72px);width:var(--city-tasks-w,300px);z-index:34;min-height:var(--city-card-h,0px);max-height:min(46vh,calc(100vh - var(--city-top-y,16px) - 130px));overflow:auto}
#city-tasks h4{margin:0 0 4px;display:flex;align-items:center;gap:6px;font:700 13px/1.2 system-ui,sans-serif;color:#fff}
#city-tasks h4 .word{flex:1;cursor:pointer}#city-tasks h4 .word:hover{text-decoration:underline}
#city-tasks .detail .head{display:flex;align-items:center;gap:8px;margin:2px 0 6px}#city-tasks .detail .arrow.big{font-size:26px;line-height:1;display:inline-block;color:#ffd34d}
#city-tasks .detail p{margin:0 0 4px;font:12px/1.35 system-ui,sans-serif;opacity:.85}#city-tasks .detail ol{margin:4px 0 8px 18px;padding:0;font:12px/1.4 system-ui,sans-serif}#city-tasks .detail li.done{opacity:.55}
#city-tasks .detail .acts{display:flex;gap:6px;flex-wrap:wrap}#city-tasks .detail .acts button{border:0;border-radius:6px;padding:5px 10px;background:rgba(255,255,255,.16);color:#fff;font:600 12px/1 system-ui,sans-serif;cursor:pointer}
#city-tasks .detail .acts button.primary{background:#2f7de1}#city-tasks .detail .acts button.warn{background:rgba(220,70,60,.75)}
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
#city-top[hidden],.city-card[hidden],#city-prompt[hidden],#city-hints[hidden]{display:none!important}
#city-hints{position:fixed;left:50%;transform:translateX(-50%);bottom:104px;z-index:34;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:calc(100vw - 32px);pointer-events:none}
#city-hints button{pointer-events:auto;display:flex;align-items:center;gap:7px;border:0;border-radius:999px;padding:4px 11px 4px 5px;background:rgba(17,24,39,.78);color:#fff;font:12.5px/1.3 system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.25)}
#city-hints button.off{color:#c9ced6;background:rgba(55,60,70,.7)}
#city-hints kbd{min-width:20px;padding:2px 6px;border-radius:6px;background:#f3f4f6;color:#111;font:600 11.5px/1.2 system-ui,sans-serif;text-align:center}
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
@media (prefers-color-scheme:dark){#city,#city-side{--cp:#1d2329;--ci:#e6edf3;--cm:#9aa6b1;--cb:#2a3138}}${THEME_CSS}${PROFILE_CSS}${ANIMALS_CSS}`;
  doc.head.append(Object.assign(doc.createElement("style"), { textContent: css }));
  const hudBox = Object.assign(doc.createElement("div"), { id: "city-hud", title: "The living city: open the City panel" });
  hudBox.onclick = () => openPanel();
  doc.body.append(hudBox);
  let panel = null, tab = "you", notice = "", noticeAt = 0;
  function notify(text) { if (!text) return; notice = text; noticeAt = Date.now(); hud(); ctx.notify?.(text); }
  function hud() {
    const w = view, p = w?.players.get(myId);
    const t = timeAt(gameNow());
    const [lon, lat] = ctx.toLonLat(me().x, me().z);
    const here = jurisdictionAt(R, lon, lat, district.county);
    const bits = [`<b>${p ? R.fmt(w.ledger.balance(p.account)) : "Arriving…"}</b>`, clockHeld() ? `${t.label} (time held)` : t.label, here.name];
    timeButton.hidden = !world; timeButton.classList.toggle("on", clockHeld());
    if (car.active) {
      const limit = speedLimitAt(car.x, car.z) * MPH, mph = Math.abs(car.speed) * MPH;
      bits.push(`<span class="${mph > limit + 5 ? "warn" : ""}">${Math.round(mph)} mph · limit ${Math.round(limit)}</span>`);
      const ctl = car.ctl;
      if (ctl) bits.push(ctl.park ? "parking" : ctl.lane ? `changing lane ${ctl.lane.dir > 0 ? "left" : "right"}` : ctl.stopping ? "braking to stop" : ctl.gear < 0 ? "R" : ctl.parked && Math.abs(ctl.v) < 0.1 ? "P" : "D");
      if (car.light && car.light.light !== "green" && car.light.toLine < 60) bits.push(`<span class="warn">${car.light.light} light in ${Math.max(0, Math.round(car.light.toLine))} m · S stops at the line</span>`);
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
  const helpButton = h("button", { title: "The controls (? or /)", onclick: () => openSide("help") }, "Controls");
  const tasksButton = h("button", { title: "The task board: work to take", onclick: () => openSide("tasks") }, "Task board");
  const onlineButton = h("button", { className: "shop", title: "The shop: anything sold in the city, from anywhere, at twice the price; homes at their price", onclick: () => openSide("online") }, "Shop");
  const bagButton = h("button", { title: "The inventory (I)", onclick: () => openSide("bag") }, "Inventory");
  const taxiButton = h("button", { title: "Call a taxi to where you stand (Enter gets in when it pulls up)", onclick: () => taxiKey() }, "Taxi");
  const timeButton = h("button", { title: "Hold the clock at an hour, or let it run (the offline practice game)", onclick: () => openSide("time") }, "Time");
  // (The task board is the card at the bar's edge: one board, not a button to a second.)
  alwaysActions.append(bagButton, onlineButton, taxiButton, timeButton, helpButton);
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
  hintBox = Object.assign(doc.createElement("div"), { id: "city-hints" });
  hintBox.setAttribute("aria-live", "polite"); hintBox.setAttribute("aria-label", "What you can do here");
  hintBox.hidden = true;
  doc.body.append(tasksCard, actionBar, profileCard, hotbar, promptBox, hintBox);
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
    // The one task board: at the bar's edge, beside the map's button (which stays outside it). The
    // open map pushes it, and the bar with it, towards the middle while the bar still has room for
    // its buttons; past that nothing moves, and the map lies over the board until it is closed.
    const tasksW = W < 640 ? 170 : W < 1000 ? 230 : 300;
    root.style.setProperty("--city-tasks-w", `${tasksW}px`);
    const right = W - 16 - card;                     // the profile card's left edge
    const free = F ? F.right + 10 : 12, pushed = Math.max(free, M ? M.right + 10 : 0);
    let left = right - pushed - tasksW >= 300 ? pushed : free;
    tasksCard.hidden = !on || !self() || right - left < tasksW + 8;
    if (!tasksCard.hidden) { root.style.setProperty("--city-tasks-x", `${Math.round(left)}px`); left += tasksW; }
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
    root.style.setProperty("--city-under", `${Math.round(Math.max(B && B.height ? B.bottom : y + 44, C ? C.bottom : 0, P ? P.bottom : 0) + 8)}px`);
    // The messages tab at the left edge, clear of the map's controls while they are open.
    messages().layout({ on: on && Boolean(self()), left: M ? M.right + 6 : 0 });
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
    const gig = p.delivery ? `<div class="gig">Parcel to ${esc(p.delivery.to.name || "a home")}: ${Math.round(Math.hypot(me().x - p.delivery.to.x, me().z - p.delivery.to.z))} m, ${Math.max(0, Math.round(realMinutesTo(p.delivery.due)))} min</div>` : "";
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
    el.setAttribute("aria-label", { store: "Shop", bag: "Inventory", sell: "Selling", ride: "Buses and taxis", tasks: "Task board", online: "Online store", business: "Your business",
      buy: "Buying a business", recruiter: "Recruiter", released: "Released", pets: "Pets", time: "Time" }[kind] || "Controls");
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
    if (animals().draw(side, { close, status, w, p })) return;
    if (finance().draw(side, { close, status, w, p })) return;
    if (enterprise().draw(side, { close, status, w, p })) return;
    if (commerce().draw(side, { close, status, w, p })) return;   // selling: offers, listings, consignment (commerce-panels.mjs)   // law offices, recruiters, your business (enterprise-panels.mjs)
    if (side.kind === "store") {
      // The shop's wares and prices: choose how many of each, then Checkout shows the total with
      // the sales tax, and Confirm buys it all (into your inventory) if you have the credits.
      const place = side.place;
      const stores = w.storesHere ? w.storesHere(place) : storesAt(R, place.keys);
      const priceOf = (id) => (w.priceAt ? w.priceAt(place, id) : R.items[id].price);
      const store0 = stores[Math.min(side.store, stores.length - 1)];
      const [lon, lat] = ctx.toLonLat(place.x, place.z);
      const chain = jurisdictionAt(R, lon, lat, district.county).chain;
      const title = h("h3", {}, h("span", { textContent: `${store0.name}${place.name ? " — " + address(place.name) : ""}` }), close);
      const tabs = stores.length > 1 ? h("div", { className: "tabs" }, ...stores.map((s2, i) => h("button", { textContent: s2.name, "aria-pressed": String(i === side.store), onclick: () => { side.store = i; drawSide(); } }))) : null;
      if (!shop.place && Math.hypot(me().x - place.x, me().z - place.z) > R.stores.reach_m * 2) { side.el.replaceChildren(title, h("p", { className: "note", textContent: "You have walked away from the shop." })); return; }
      side.cart ||= {};
      const cart = side.cart, balance = w.ledger.balance(p.account);
      const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, qty]) => {
        const it = R.items[id], price = priceOf(id) * qty;
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
      // A shop you are walking round: its goods are on its shelves (shop-floor.mjs), not in a list.
      const walkedHere = floor.active() && floor.counterItems() > 0 && String(placeInside()?.id) === String(place.id);
      const rows = store0.items.filter((id) => !R.items[id].service && !walkedHere).map((id) => {
        const it = R.items[id], ph = physOf(R, id);
        const t1 = itemTax(R, chain, it, priceOf(id), w.laws);
        const info = `${effectText(it)}${it.service ? "" : ` · ${weightClass(R, ph.kg, p.vitals.strength)}`}`;
        return h("tr", { style: cart[id] ? "background:rgba(31,111,235,.08)" : "" }, h("td", {}, h("b", { textContent: it.name }), h("div", { className: "note", textContent: info })),
          h("td", { textContent: `${R.fmt(priceOf(id))}${t1 ? ` +${R.fmt(t1)}` : ""}` }), h("td", {}, qty(id, it)));
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
      extra.push(...enterprise().storeExtra(place));   // buy the business, or manage yours
      const count = lines.reduce((a, l) => a + l.qty, 0);
      if (walkedHere) { side.el.replaceChildren(title, status, h("p", { className: "note", textContent: "Take what you want off the shelves (click it), a basket or a cart by the door, and pay at a till (Enter)." }), ...extra); return; }
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
        // Off the bar (and out of your hand) into the bag's first free place: nothing has to be held.
        if (slotOf >= 0 && slotOf < BAR) { const free = slots.findIndex((v, i) => i >= BAR && !v); if (free >= 0) btns.push(h("button", { textContent: slotOf === chosen ? "Put away in the bag" : "To the bag", onclick: () => { slots = swap(slots, slotOf, free); saveSlots(); syncSlots(); drawSide(); } })); }
        if (inHand && (it.use || it.wear)) btns.push(h("button", { className: "primary", textContent: it.wear ? (worn ? "Take off (right click)" : "Wear (right click)") : `${it.kind === "prepared_food" || it.use?.stamina ? "Eat or drink" : "Use"} (right click)`, onclick: () => useSelected() }));
        if (!it.parcel) btns.push(h("button", { textContent: "Put down", onclick: () => say(send("drop", { item: pickId }), () => `Put down: ${it.name.toLowerCase()}. A click picks it up.`).then(() => syncSlots(true)) }));
        if (!it.parcel) for (const { peer, pid } of peers) btns.push(h("button", { textContent: `Give to ${peer.name}`, onclick: () => say(send("give_item", { to: pid, item: pickId }), (r) => `Gave ${r.to} the ${it.name.toLowerCase()}.`).then(() => syncSlots(true)) }));
        detail.push(h("div", {}, ...btns), ...commerce().bagExtra(pickId), ...commerce().packing(side));
      } else detail.push(h("p", { className: "note", textContent: "Empty hand: X punches. Shops sell food, medicine, tools and clothes (Enter at a shop, then the SHOP panel by the door); things on the ground with a yellow ring are picked up with G." }));
      const here = me();
      const cars = w.registry.held(p.account).filter((a) => a.kind === "vehicle").map((a) => {
        const spec = R.vehicles.models[a.attrs.model];
        const d = a.attrs.x === undefined ? null : Math.round(Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z));
        const extra = commerce().carExtra(a);
        const tr = row(`${spec.name} ${a.attrs.plate}${(a.attrs.wheels ?? 4) < 4 ? ` (${a.attrs.wheels ?? 4} wheels)` : ""}${a.attrs.locked ? " (locked)" : ""}`, car.vehicle === a.id && car.active ? "driving" : d === null ? a.custody : `${d} m away`);
        if (extra.length) tr.append(h("td", {}, ...extra));
        return tr;
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
          const steps = t?.steps || [p.delivery.stage === "pickup" ? `Pick up the order at ${p.delivery.from.name} (click it at its door)` : `Deliver to ${p.delivery.to.name || "the address"}`];
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
      const cats = [["all", "All"], ...CATEGORIES, ["services", "Services"], ["jobs", "Jobs"], ["business", "Business"], ["law", "Law & record"], ["loans", "Loans"], ["homes", "Real estate"]];
      const counts = Object.fromEntries(cats.map(([k]) => [k, 0]));
      for (const x of wares) if (match(x.it.name, x.from.join(" "))) { counts[x.cat] += 1; counts.all += 1; }
      for (const x of services) if (match(x.it.name, x.label)) { counts.services += 1; counts.all += 1; }
      for (const x of jobs) if (match(x.spec.title, x.label)) { counts.jobs += 1; counts.all += 1; }
      for (const x of homes) if (match(x.name, x.l.neighbourhood || "")) { counts.homes += 1; counts.all += 1; }
      counts.business = [...(w.biz?.values() || [])].filter((b) => b.owner === p.account && b.status === "open").length;
      counts.law = [...(w.cases?.values() || [])].filter((c) => c.pid === p.id && !c.closed).length;
      counts.loans = (p.loans || []).filter((l) => l.status === "open").length;
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
            : h("button", { className: "primary", textContent: p.job ? "Switch" : "Apply", onclick: () => send("apply_job", { role, place: placeArg(pl) }).then((r) => { notify(r.ok ? `Applied: the interviewer at ${label} has written to you in Messages.` : r.error); if (r.ok) messages().open("npc", r.thread); drawSide(); }) }))));
        out.push(h("h4", { textContent: "Jobs — hiring near you, at their pay" }),
          p.job ? h("p", { className: "note" }, `You work as ${p.job.title.toLowerCase()} at ${address(p.job.place.name) || "your workplace"} (${R.fmt(p.job.pay)}/h). `, act("Quit", () => send("quit_job"))) : "",
          rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "No openings near you." }));
      }
      if (finance().online(side, out, w, p)) { side.el.replaceChildren(...out); return; }   // the online lender
      if (enterprise().online(side, out, w, p)) { side.el.replaceChildren(...out); return; }   // the Business and Law tabs
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
    // The clock held (the practice game's own): the hour stood still, the street going on.
    if (side.kind === "time") {
      const st = timeState(), say = (r) => { if (r && !r.ok) notify(r.error); else if (r) notify(r.held ? `Time held at ${r.label}. The street goes on as it is at this hour.` : `Time runs on from ${r.label}.`); drawSide(); hud(); };
      const at = (label, hour) => h("button", { textContent: label, title: hour === null ? "Stop the clock where it stands" : `Stop the clock at ${label}, the next time the game's day comes to it`, onclick: () => say(holdTime(hour)) });
      side.el.replaceChildren(h("h3", {}, h("span", { textContent: "Time" }), close),
        h("p", { className: "note", textContent: !st.practice ? "The city online keeps one clock for everyone: time can only be held in the offline practice game."
          : st.held ? `Held at ${st.label}. The sun, the shops' hours, pay and bills stand still. People and traffic go on: each lives the next ${st.window_min} minutes of this hour over and over, on their own turn of it, so the street stays as busy as this hour is.`
            : `The clock is running: ${st.label}. Hold it to test against one hour for as long as you like.` }),
        ...(st.practice ? [h("div", { className: "row" }, at("Hold now", null), ...(st.held ? [h("button", { className: "shop", textContent: "Let time run", onclick: () => say(releaseTime()) })] : [])),
          h("h4", { textContent: "Hold at an hour" }),
          h("div", { className: "row" }, at("06:00", 6), at("08:00", 8), at("12:00", 12), at("15:00", 15), at("17:30", 17.5), at("21:00", 21), at("02:00", 2)),
          h("p", { className: "note", textContent: "A held clock stays held when you come back to the page." })] : []));
      return;
    }
    // The controls.
    const keys = [["Arrows", "walk: Up goes the way you face. Left / Right standing (or slow) step you round where you stand, a quarter turn a step; walking, they turn you round a curve. Down turns you round. Climbing, they reach for the next hold (two together for a diagonal); on a top, they walk along it; out of a tree, Down climbs down. Pushing something, Up pushes it along. At the wheel, drive"],
      ["Shift (hold)", "sprint, while stamina lasts"], ["Shift + Up / Down", "standing still where there is a level above or below (a bridge's deck, a lower deck): up or down to it"],
      ["Space", "jump, as high as your legs push against your weight and load; running, on the way you are going. At a fence, a wall, a tree or a ladder: onto it, over it, or the first holds of a climb (then the arrows). Climbing or on a top: push off, or jump down"],
      ["A click", "in a shop or a restaurant: on a chair, sit down (walk to get up); on a product on a shelf, take it (into your hands or basket); on someone who works there, they come over and ask what you need (a waiter's menu link lets you order). On the food or drink in your hand: a bite or a sip; held down, eat or drink on to the end. On a thing on the ground (a courier's order at the door too): walk over and pick it up, then click the ground to set it down there. Too heavy to lift, or something loose like a log or a chair: walk up to it, hands on it, and Up pushes it; click again to let go. With nails in your hand, on wood: a nail set there, held for the hammer; click again and it drops. With the messages open, on someone: talk. On another player: who they are. A click is never a blow"],
      ["Right click", "use what is in your hand: eat, drink, take medicine, wear or take off. A right click is a bite or a sip; held down, eat or drink it all. On a home of yours: its property menu. Shift + right click: the exterior editor"],
      ["1 – 8", "choose from the bar at the bottom: what is chosen is in your hand (an empty slot is an empty hand)"], ["I", "the inventory: the grid and the bar; click a thing, then a slot, to move it"],
      ["X", "swing what is in your hand (a punch, empty-handed) at what is in front: a thing, a tree, a person"],
      ["Shift + X", "the point or head of what you hold instead of a swing: a crowbar jabs, a sledgehammer rams, a knife stabs, a spade jabs -- less than a swing, but straight in. Empty-handed, the flat of the hand instead of a punch: shove a person (they rock, stagger or fall by their balance; a fall is battery if seen), or give something loose a shove (a log, a chair)"],
      ["R (hold)", "work at what is in front with a tool, a stroke at a time while held: a saw saws wood, a crowbar pries, bolt cutters cut chain and wire, a knife carves wood (your initials in a bench), a spade digs the ground underfoot (lawn, soil, sand; never pavement)"],
      ["R (tap)", "on shift: do the task at the orange ring. With a hammer and nails, at wood (or at a nail you set with a click): one blow on the nail each tap. Keep a steady second between blows: a rushed or tired blow lands off square and the nail bends"],
      ["Y / N", "answer the question at the top (clock in, hand over a parcel, an errand's shopping)"],
      ["L", "tie up the pet beside you (with a lead) or have it stay; again and it follows. At the wheel: leave them in the car"],
      ["Q", "throw what is in your hand, the way you face: heavier goes slower; glass breaks, drinks spill"],
      ["Enter", "in and out, whichever is nearest: your car (out of it, parking where you stop; or ride with a party member), your taxi pulled up beside you (in it: out early, and pay), the bus standing at the stop (aboard: ask for the next stop), the shop whose door you are at (inside, at the door, back out), a till (pay), your own garage door up or down, your bicycle (on it, and off it); elsewhere, a building's door"],
      ["Z", "at a bed: lie down (in your own, sleep); again, get up"],
      ["Tasks (top left)", "click your task, delivery or errand: its card -- the steps, an arrow pointing the way and how far, Go there (walks you there along the pavements; an arrow key takes over), Close (back to the list) and Cancel (drops it). Your pets are on your profile, under Relationships › Family"],
      ["Top bar", "Inventory, the Task board (work to take), the Shop (everything, from anywhere, at twice the shop price; real estate at its price), Taxi (call one to where you stand) and these Controls; your money, health, stamina and strength at the top right (a click opens your profile)"],
      ["? or /", "these controls"], ["F", "first person"], ["S", "what is under the pointer"], ["Esc", "close the window over the screen"]];
    const asked = "Asked as a Yes / No where it applies: clocking in at your workplace (and out when you leave), handing over a parcel at its address, and an errand's shopping at the neighbour's door. Answer No and it stays on the buttons along the bottom while it applies. A window closes with its × or its key again.";
    const bars = [["Health", "wears slowly; quickly with no stamina left. Medicine (pharmacy), a doctor's visit (clinic), a night's sleep. At 0 you faint, wake at home, and pay the ambulance."],
      ["Stamina", "runs down through the day, faster at work and sprinting; comes back at night, fastest asleep at home. Food and drink at cafés, restaurants, bars and grocers give it back. Low, you are slowed."],
      ["Strength", "fades a little each day. Workouts at a gym build it; walking, a little. It sets what you can carry."]];
    side.el.replaceChildren(h("h3", {}, h("span", { textContent: "Controls" }), close), h("table", {}, ...keys.map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", { textContent: k })), h("td", { textContent: v })))),
      h("h4", { textContent: "The bars" }), ...bars.map(([k, v]) => h("p", { className: "note" }, h("b", { textContent: `${k}: ` }), v)),
      h("p", { className: "note", textContent: asked },),
      h("h4", { textContent: "Hints" }),
      h("p", { className: "note", textContent: "The strip over the bar shows what you can do just here: climbing, a tool on what is in front, a bite. Walking and plain jumps are never in it. Each hint shortens as you use it, and goes once learned." }),
      h("div", { className: "tabs" }, ...[["full", "In full"], ["short", "Keys only"], ["off", "Off"]].map(([k, label]) => h("button", { textContent: label, "aria-pressed": String(hintSetting === k), onclick: () => { setHints(k); drawSide(); } }))),
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
  //: Money put in your device account on the backend (supabase/kerbside_city_grants.sql): paid
  //: into your wallet by the city's server, once (server/city/authority.mjs grants). The page
  //: only asks it to look; it cannot name an amount.
  let grantsAsked = false;
  async function takeAccountGrants() {
    if (grantsAsked || online.state !== "online" || !view?.players.has(myId)) return;
    grantsAsked = true;
    const r = await online.client.grants();
    if (!r.ok || r.waiting) { grantsAsked = false; return; }
    shown(r);
    if(r.welcome)notify(`Your testing restaurant, ${r.welcome.name}, is yours. Its initial licences are paid.`);
    for (const g of r.granted || []) notify(`${R.fmt(g.amount)} from the backend is in your wallet.`);
  }
  function refresh() {
    takeAccountGrants();
    hud();
    drawSide();
    if (!panel) return;
    const w = view, p = w?.players.get(myId);
    const close = h("button", { textContent: "×", title: "Close (Esc)", onclick: () => openPanel() });
    const head = h("h3", {}, h("span", { textContent: "You" }), close);
    if (!w) { panel.replaceChildren(head, h("p", { className: "note", textContent: "Connecting to the city…" })); return; }
    if (!p) {
      // Joined in the background (ensureJoined): only a moment before the district is there.
      panel.replaceChildren(head, h("p", { className: "note", textContent: `Setting up your place in the city: ${R.fmt(R.start.balance)} in Credits (a placeholder currency at par with the dollar), a rented room in the building beside you with its first week free, and no car.` }));
      ensureJoined();
      return;
    }
    // The profile (profile-panel.mjs): an overview and four pages, each the whole window.
    // (The people near you are on Relationships: their list refreshes as that page does.)
    tab = profile().state.tab === "relationships" ? "people" : profile().state.tab;
    profile().draw(panel, w, p, close);
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
    const credit = tile("Credit", ...finance().creditTile());
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
    return [me, h("div", { className: "tiles" }, stats, bank, debts, credit, assets, net, history)];
  }
  const TABS = {
    you(w, p) {
      const st = w.cmd_status.call(w, myId);
      const out = [h("table", {}, row("Balance", R.fmt(st.balance)), row("Owed", R.fmt(st.owed)), row("Where", st.where),
        row("Home", st.home ? `a room at ${district.placeById?.get(st.home.building)?.name || "building " + st.home.building}, paid to ${new Date(st.home.paid_until).toLocaleDateString()}` : "none"),
        row("Job", st.job ? `${st.job.title}, ${R.fmt(st.job.pay)}/h` : "none"), row("At work", st.clocked ? `since ${new Date(st.clocked.since).toLocaleTimeString()}` : "no"),
        row("Earned this year", R.fmt(st.ytd.wages)), row("Tax held back", R.fmt(st.ytd.withheld)), row("FasTrak", st.fastrak ? `${st.fastrak.tag}, ${R.fmt(st.fastrak.balance)}, Flex ${st.fastrak.flex}` : "none"),
        row("City", online.state === "online" ? "online: one city for everyone, kept by its server" : online.state === "connecting" ? "connecting…" : `offline practice (${online.why}): nothing here is kept in the city`),
        row("Party", party.session ? `room ${party.session.room}: who you see walking with you` : "walking alone (Play together to see friends)"))];
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
      const owned = w.registry.owned(p.account, "home");
      return [h("h4", {textContent: "Design your home"}),
        h("p", {className: "note", textContent: "Move furniture, reshape rooms and review clearances in Interior Studio. Approved layouts are saved with this world and update its visible interior and walking barriers."}),
        ...owned.map(a => h("div", {}, address(a.attrs.address) || "Your home", " ", act("Customize interior", () => editHome(a.id)))),
        !owned.length ? h("p", {className: "note", textContent: "Buy a home to apply a design, or explore the Interior Studio in practice mode."}) : null,
        h("a", {href: new URL("../interior-lab/", new URL(ctx.asset("city/"), location.href)).href, target: "_blank", rel: "noopener", textContent: "Open practice studio"}),h("p", { className: "note", textContent: `${all.filter((l) => l.kind === "sale").length} homes for sale and ${all.filter((l) => l.kind === "rent").length} to rent in this district this week.` }),
        h("button", { className: "primary", textContent: "Browse the listings (O, Real estate)", onclick: () => { openSide("online"); if (side) { side.cat = "homes"; drawSide(); } } })];
    },
    bills(w, p) {
      const all = [...w.billing.bills.values()].filter((b) => b.payer === p.account).slice(-20).reverse();
      if (!all.length) return [h("p", { className: "note", textContent: "No bills. Tolls without FasTrak, lane violations, speed camera and parking notices, rent and property tax come here, each with its due date; unpaid, a notice adds its penalty." })];
      return all.map((b) => h("div", { style: "border-top:1px solid rgba(128,128,128,.25);padding:4px 0" },
        h("b", { textContent: `${b.memo || b.kind}` }), h("div", { className: "note", textContent: `${b.kind.replace(/_/g, " ")} · ${R.fmt(b.owed)}${b.stage ? ` (notice ${b.stage + 1})` : ""} · ${b.status === "open" ? "due " + new Date(b.due).toLocaleDateString() : b.status}${b.hearing ? " · hearing " + new Date(b.hearing).toLocaleDateString() : ""}${b.reason ? " · " + b.reason : ""}` }),
        // A fine is a case: pay it, or contest it (yourself at a hearing, or with a lawyer hired there and then).
        b.status === "open" ? h("div", {}, act("Pay", () => send("pay_bill", { bill: b.id }), true), [...(w.cases?.values() || [])].some((c) => c.bill === b.id && !c.closed && !c.verdict) ? act("Contest", () => { openSide("contest"); side.bill = b.id; drawSide(); return null; }) : null) : null));
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
      // Those out of doors near you, and those riding by; a name opens who they are: their
      // household, their work, their money, how they get about and the day's milestones
      // (fleet.mjs City.about).
      const riders = bikes.filter((b) => b.person).map((b) => ({ id: b.person.id, person: b.person, activity: b.v > 0.3 ? "cycling" : b.reason || "waiting" }));
      const list = [...visible.people, ...riders].slice(0, 40);
      const roster = district.roster, tt = fleetAt(Date.now());
      const hhs = roster ? [...roster.households.values()] : [], n = (k) => hhs.filter((x) => x.size === k).length;
      const bikesN = roster ? [...roster.vehicles.values()].filter((v) => v.bike).length : 0, carsN = roster ? [...roster.vehicles.values()].filter((v) => !v.bike && !v.visitor).length : 0;
      const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
      const dayOf = (d) => new Date(d * 86_400_000).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      const about = (p) => {
        const a = district.city?.about(p, tt);
        if (!a) return [];
        const out = [], H = a.household, c = a.career, b = a.books;
        if (a.visitor) out.push(h("p", { className: "note", textContent: `${a.title}: passing through the district.` }));
        if (H) out.push(h("p", { className: "note", textContent: `${p.age}, ${a.relation === "head" ? "head of the household" : a.relation}. ${H.size === 1 ? "Lives alone" : `Household of ${H.size} (${H.kind.replace("_", " ")}): ${H.members.filter((m) => m.id !== p.id).map((m) => `${m.name}, ${m.relation}, ${m.age}`).join("; ")}`} — ${H.beds ? `${H.beds}-bed` : "studio"} ${H.label ? `flat ${H.label}` : "house"}, ${H.tenure === "own" ? "owned" : "rented"}${H.garage ? ", with a garage" : ""}.` }));
        if (c) out.push(h("p", { className: "note", textContent: c.status === "employed" ? `${c.title} since ${dayOf(c.since)}${c.level ? ` (level ${c.level + 1})` : ""}${c.history.length ? `; before: ${c.history.slice(0, 2).map((x) => `${x.title || x.role}${x.reason && x.reason !== "found_work" ? ` (${x.reason.replace("_", " ")})` : ""}`).join(", ")}` : ""}.`
          : c.status === "looking" ? `Looking for work since ${dayOf(c.since)}${c.left ? ` (${c.left.reason.replace("_", " ")})` : ""}.` : c.status === "retired" ? "Retired." : "At school." }));
        const owed = view?.billing.owed(p.id) || 0;
        if (owed) out.push(h("p", { className: "note", textContent: `Collision debt ${R.fmt(owed)}; charges: ${(view?.harm.get(p.id)?.record || []).map((r) => r.charge.replaceAll("_", " ")).join(", ")}.` }));
        if (b) out.push(h("p", { className: "note", textContent: `Balance ${R.fmt(b.balance)}${b.wage_hour ? `, paid ${R.fmt(b.wage_hour)}/h` : ""}; in the last 30 days ${R.fmt(b.income_30d)} in, ${R.fmt(b.spend_30d + b.rent_30d)} out${b.next_pay && b.wage_hour ? `; next pay ${dayOf(b.next_pay) && new Date(b.next_pay * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}. ${b.assets.length ? `Owns: ${b.assets.map((x) => `${x.label} (${R.fmt(x.value)})`).join(", ")}. ` : ""}Net worth ${R.fmt(b.net_worth)}.` }));
        if (!a.visitor) out.push(h("p", { className: "note", textContent: `Gets about on foot and ${a.travel === "drive" ? "by car" : a.travel === "bike" ? "by bicycle" : "by bus or taxi"}. Today: ${String(a.routine).replace(/_/g, " ")}.` }));
        if (a.milestones?.length) out.push(h("table", {}, ...a.milestones.map((m) => { const r0 = row(`by ${hhmm(tt.toGame(m.at))}`, `${m.label || ""}${m.name ? ` — ${address(m.name) || m.name}` : ""}`); if (a.next && m.at === a.next.at) r0.style.fontWeight = "700"; else if (m.at <= tt.minute) r0.style.opacity = "0.55"; return r0; })));
        const request = district.city.characterContext(p, tt, view);
        if (request.state === "pending") {
          out.push(h("p", { className: "note", textContent: "Preparing character context…" }));
          // A single callback per pending build; avoid redrawing every time this panel refreshes.
          if (peopleContextPending !== request.ready) {
            peopleContextPending = request.ready;
            request.ready.then(() => {
              if (peopleContextPending === request.ready) peopleContextPending = null;
              if (panel && tab === "people" && peopleOpen) refresh();
            }).catch(() => {
              if (peopleContextPending === request.ready) peopleContextPending = null;
            });
          }
        } else {
          const context = request.context;
          if (context.group) out.push(h("h4", { textContent: "Shared backstory" }), h("p", { textContent: context.group.backstory }));
          out.push(h("p", { className: "note", textContent: `Voice: ${context.tone.variation}. Interests: ${context.hobbies.values.join(", ")}.` }));
          if (context.finances.balance === null) out.push(h("p", { className: "note", textContent: "Bank balance unavailable." }));
          if (context.finances.debt !== null) out.push(h("p", { className: "note", textContent: `Outstanding debt: ${R.fmt(context.finances.debt)}.` }));
          // Talk to them: a hello is answered here; a real question goes to the city's server with this context.
          out.push(h("h4", { textContent: `Talk to ${String(p.name).split(" ")[0]}` }), finance().talkBox(peopleTalk[p.id] ||= {}, { id: p.id, name: p.name, title: p.title, role: "resident", tone: context.tone.family }, { npc: context }, refresh));
          const json = h("pre", { textContent: JSON.stringify(context, null, 2), style: "white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto" });
          out.push(h("details", {}, h("summary", { textContent: "Show AI context (JSON)" }), json));
        }
        return out;
      };
      return [h("p", { className: "note", textContent: `${district.people.length} people live in this district in ${hhs.length} households (${n(1)} alone, ${n(2)} of two, ${n(3)} of three, ${hhs.length - n(1) - n(2) - n(3)} larger), with ${carsN} cars and ${bikesN} bicycles. Out of doors near you: ${visible.people.length} on foot, ${riders.length} cycling, ${visible.vehicles.length} vehicles.` }),
        h("table", {}, ...list.flatMap((x) => {
          const r0 = row(`${x.person.name} — ${x.person.title}`, x.activity || "");
          r0.style.cursor = "pointer"; r0.title = "Who they are";
          r0.onclick = () => { peopleOpen = peopleOpen === x.person.id ? null : x.person.id; refresh(); };
          return peopleOpen === x.person.id ? [r0, h("tr", {}, h("td", { colSpan: 2 }, ...about(x.person)))] : [r0];
        })),
        h("h4", { textContent: "Who lives here" }), h("p", { className: "note", textContent: Object.entries(populationByRole(district.people)).sort((a, b) => b[1] - a[1]).map(([r, k]) => `${R.jobs.roles[r].title} ${k}`).join(", ") })];
    },
  };
  let peopleOpen = null, peopleContextPending = null;
  const peopleTalk = {};   // what has been said with each person, while the page is open
  const transferTotal = (here, price) => transferTax(R, here.chain, price).total;
  ctx.button?.addEventListener("click", () => openPanel());
  // Escape closes the window over the screen.
  globalThis.addEventListener?.("keydown", (e) => { if (e.key === "Escape" && panel) { panel.remove(); panel = null; } });
  refresh();

  // The multiplayer session's hooks: what this walker's car is, and drawing the others'.
  return {
    //: How the crowd and the traffic were drawn last frame: so many at each tier (full, moderate,
    //: low), so many only tracked, and the detail field's stretch ahead.
    //: The district's fleet (for the crowd checks from outside: the headless harness).
    fleetNow: () => district.city,
    detail: () => ({ people: drawnTiers.people.slice(), cars: drawnTiers.cars.slice(), tracked: { ...drawnTiers.tracked }, figures: drawnTiers.figures, clumps: drawnTiers.clumps ? { ...drawnTiers.clumps } : null, figureStats: figures.stats(), figurePlan: figLast, lock: { ...lockStats, close: { people: { ...peopleLock.stats }, cars: { ...carsLock.stats }, feet: { ...feetNear.stats }, behind: { people: peopleLock.lagging(), cars: carsLock.lagging() } } },
      stretch: detailNow?.stretch ?? 1, heading: detailNow?.heading ?? [0, 0], reach: scanReach }),
    rules: R, tick, drive, noteIncident, sendPatrol, crashes: { scenes: () => scenes.report(), dents: () => [...carDents.keys()], bodies: () => wreckBodies.size, clear: () => scenes.clearAll() }, time: { hold: holdTime, release: releaseTime, state: timeState }, animals: () => animals(), patrolNow: () => (patrol.phase ? { phase: patrol.phase, left: Math.round(patrol.route.length - patrol.d), at: patrol.at && [Math.round(patrol.at.x), Math.round(patrol.at.z)] } : null), reactionsNow: () => ({ incidents: incidents.length, crashes: district.drivers?.tally.crashes || 0, ranDown: district.drivers?.tally.ran_down || 0, scares: scares.size, reacting: [...reacting].map(([id, q]) => ({ id, kind: q.kind, off: +q.off.toFixed(1) })), yields: district.drivers?.tally.yields || 0 }),
    restaurantAt(id) {
      const place=district.placeById?.get(String(id)), kind=place && view?.kitchenKind(place);
      return kind ? restaurantService(R,kind,view.bizAt(id),view.kitchens.get(String(id))) : null;
    },
    get driving() { return car.active || cycle.active; }, get entering() { return Boolean(entry); }, stepEntry, swim, get cycling() { return cycle.active; }, get riding() { return car.riding || transit.ride; }, get inside() { return Boolean(shop.place) || court.active || police.locked; }, walkInside: (dt, held) => (court.active ? court.walkIn(dt, held) : police.locked ? (ctx.animateWalk?.(0), true) : walkInside(dt, held)),
    police: () => ({ units: police.units(), crimes: police.crimes(), locked: police.locked }), court: () => court.state(), goToCourt: (id) => court.enter(id), courtSkip: () => court.skip(), enterBuilding, autoWalk: (dt) => stepReach(dt) || stepNav(dt), cancelAutoWalk: () => { reach.t = null; stopNav(); }, pressDown, pressUp, useDown, useUp, openPanel, closePanel, joinParty, leaveParty,
    enterShop, leaveShop, callTaxi, objects: () => ctx.objects?.(), taskKey, strikeKey, listings: () => listings(), routeBuses: () => routeBuses, taxi: () => ({ ...taxi, route: undefined }), stops: () => district.stops || [],
    walkFactor: walkFactorNow, walked, actions: () => actionsHere().map((a) => ({ id: a.id, label: a.label, key: a.key })), openStore, openSide, pickUp, board, things: () => thingsNear(me().x, me().z, 60),
    enterKey, taxiKey, garageHere: myGarageHere, garages: () => ctx.garages, garageRemote: () => remote.door, car: () => car, myBuildings, busLag, click, useSelected, swingKey, throwKey, jumpKey, climbKey,
    //: On a wall or its top (the arrows climb: the page's walk stands down), and in the air (a jump
    //: under way: it carries on by itself), each stepped by the page (module 26 stepAvatar).
    get climbing() { return climbPlay.climbing; }, get airborne() { return climbPlay.airborne; }, climbPlay: () => climbPlay,
    stepClimb: (dt, held) => climbPlay.stepClimb(dt, held), stepAir: (dt, held) => climbPlay.stepAir(dt, held),
    //: What is being eaten or drunk now ({item, form, tool, action, phase, left}), for checks.
    eating: () => eatPlay.what, eatPlay: () => eatPlay,
    //: Whether the city is up and running, for the loading screen: {ready, waiting}. Ready when
    //: the district is built, the first pass over it is done, no vehicle model is still loading,
    //: and people or traffic have been out and moving for ALIVE_FOR_MS. An hour with nobody out
    //: (or a district with no streets) is let through after ALIVE_GIVE_UP_MS: never a load for ever.
    alive() {
      const now = performance.now();
      // (The clock starts at the city's first frame, not at the first time this is asked.)
      const gaveUp = Boolean(aliveSeen.started) && now - aliveSeen.started > ALIVE_GIVE_UP_MS;
      if (!district.city) return { ready: gaveUp, waiting: "the city's streets" };
      const loadingModels = [...bodyModels.values()].filter((m) => m === "loading").length;
      if (loadingModels) { aliveSeen.since = 0; return { ready: gaveUp, waiting: `vehicles (${loadingModels})` }; }
      const moving = visible.people.some((e) => e.moving) || visible.vehicles.some((v) => v.moving || Math.abs(v.speed ?? v.v ?? 0) > 0.5);
      const out = visible.people.length + visible.vehicles.length;
      if (!out || !moving) { aliveSeen.since = 0; return { ready: gaveUp, waiting: "the city's people and traffic" }; }
      aliveSeen.since ||= now;
      return { ready: gaveUp || now - aliveSeen.since >= ALIVE_FOR_MS, waiting: "the city's people and traffic", people: visible.people.length, vehicles: visible.vehicles.length };
    },
    //: For checks from outside (tests in a browser): who is drawn near you, as placed this frame.
    peopleNow: (doors = false) => visible.people.map((e) => ({ id: e.id, x: e.x, z: e.z, yaw: e.yaw, moving: Boolean(e.moving), activity: e.activity || null, indoors: Boolean(e.indoors), dir: e.walk?.dir ?? null, d: e.walk?.d ?? null, pace: e.walk?.pace ?? null,
      lag: e.walk ? district.city?.walkLags.get(e.walk.key)?.lag || 0 : null, tier: e.detail ?? null, ghost: Boolean(e.ghost), behind: e.lagM || 0, door: doors ? personPortal(e.x, e.z, e) : null })), selectSlot, slots: () => ({ slots: slots.slice(), chosen }), pose: () => ({ kind: pose.kind, air: air.y }), prompt: () => promptShown, side: () => side?.kind || null, shopPanel: () => shop.room?.userData.panel || null, counterPoint, seated: () => seated.on, clerkLine: () => clerk.el?.innerText || null,
    carState() {
      if (car.active) return { model: car.model, colour: R.vehicles.models[car.model].colour, driving: true, riding: null, plate: car.plate, city: myId, seats: R.vehicles.models[car.model].seats };
      if (car.riding) return { model: "economy", colour: "#888888", driving: false, riding: car.riding, plate: "", city: myId, seats: 5 };
      return null;
    },
    placePeerCar, carChanged: () => {}, world: () => world, view: () => view, applyHomeInterior: args => send("customize_home", args), applyBusinessInterior: args => send("customize_business", args), notify, district, visible: () => visible, get me() { return myId; }, books: () => ({ state: online.state, why: online.why, version: online.version }),
    storeSigns: () => [...storeSigns].map(([id, x]) => ({ id, key: x.key, parts: x.group.children.length })),
    scan: () => scan, objective: () => objective(), taskOffers: () => taskOffers(), drawnCars: () => drawnCars, walkerBlocked, walkerSlide, carsAt,
    water: (cls, at) => waterProperties(R, cls, at), send,
    //: For looking at the fleet: each kind it draws at ``tier`` side by side from (x, z) along +x,
    //: facing ``yaw``, in ``colour`` (the bus in its livery); called again, the row is taken away
    //: first. Resolves to what was laid out.
    async lineUp(x, z, { tier = "npc", colour = "#2b4c7e", yaw = 0.6, gap = 1.2 } = {}) {
      group.getObjectByName("fleet-line-up")?.removeFromParent();
      const row = new THREE.Group(); row.name = "fleet-line-up";
      let at = 0;
      const out = [];
      for (const kind of Object.keys(FLEET_FOR)) {
        const parts = await fleetReady(kind, tier);
        if (!parts) continue;
        const [w, , l] = VEHICLE_DIMS[kind];
        at += Math.max(w, l * Math.abs(Math.sin(yaw))) / 2 + gap;
        const g = new THREE.Group();
        dressFull(g, kind, parts, colour);
        g.position.set(x + at, groundAt(x + at, z), z); g.rotation.y = yaw;
        row.add(g);
        out.push({ kind, x: x + at, z, parts: parts.map((q) => q.name), triangles: parts.reduce((n, q) => n + (q.geometry.index ? q.geometry.index.count / 3 : 0), 0) });
        at += Math.max(w, l * Math.abs(Math.sin(yaw))) / 2;
      }
      group.add(row);
      return out;
    },
  };
}
