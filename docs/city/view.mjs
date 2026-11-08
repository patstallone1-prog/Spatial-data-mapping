// The living city in the viewer: the district's people on its pavements and its traffic on its
// streets, your wallet and your day, a car to drive (or ride in with your party), the bridge
// tolls, carpool and express lanes and speed cameras that charge it, the bills that follow, and
// the party's own measures -- all on one set of books held by the party's host.
//
// ``startCity(ctx)`` is called once by the page (src/smc/renderer/page/module/30-the-living-city.js)
// with what this module needs of it; ``city.tick(now)`` each frame; ``city.drive(dt, held)``
// instead of the walk while you drive; ``city.walkFactor()`` and ``city.walked(m, dt)`` as you walk.
//
// The controls (src/smc/city/ACTIONS.md has the whole plan): an action bar of what can be done
// where you stand, each with its key -- B into a shop, G pick up, C car, T bus or taxi, J clock in
// or out, V the task at work, K errands, D delivery, X strike, O homes on the market, Z rest,
// I your things, Shift sprint, H the controls -- and the three bars.

import {
  LaneIndex, carriedKg, carryCapacity, cityTime, fuelPrice, gantriesCrossed, itemTax, jurisdictionAt, loadRules, propertyTax, salesRate, storesAt,
  transferTax, walkFactor, waterProperties,
} from "./core.mjs";
import { COUNTER_ROLES, Crowd, SPEED_MS, Streets, alongRoute, counterLine, generatePopulation, hash32, placeFromBuilding, populationByRole, rng } from "./people.mjs";
import { homeListings, mortgageTerms } from "./market.mjs";
import { buildLines, busesAt, stopsOf } from "./transit.mjs";
import { CityWorld } from "./world.mjs";

const SAVE_SOLO = "kerbside:city:world";
const SAVE_SELF = "kerbside:city:self";
const SAVE_ID = "kerbside:city:id";
const MPH = 2.23694;
const CAR_DIMS = {   // width, height, length (m)
  economy: [1.76, 1.45, 4.1], compact_ev: [1.8, 1.55, 4.3], sedan: [1.85, 1.45, 4.8], suv: [1.95, 1.75, 4.9], pickup: [2.0, 1.9, 5.6],
  delivery_van: [2.0, 2.55, 5.9], box_truck: [2.45, 3.3, 7.4], taxi: [1.85, 1.5, 4.7], bus: [2.6, 3.15, 12.2], patrol: [1.9, 1.55, 5.0],
};
const PAINT = ["#f2f2f2", "#1e1e1e", "#8a8d91", "#b8bcc1", "#2b4c7e", "#7a1f1f", "#2f5d3a", "#c9b27c", "#4a4a52", "#6b8fb3", "#a3341f", "#e8e3d3"];
const SKIN = ["#f1c9a5", "#e0ac7e", "#c68c5c", "#a26c45", "#7d4f32", "#5a3824", "#f6d8bf", "#d29b6c"];
const TROUSERS = ["#2c3440", "#3d3d3d", "#4b5563", "#1f2937", "#6b5b45", "#3b4a6b"];

const store = {
  get(key) { try { return JSON.parse(globalThis.localStorage?.getItem(key) || "null"); } catch { return null; } },
  set(key, value) { try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* full or private */ } },
};

export async function startCity(ctx) {
  const { THREE } = ctx;
  const R = loadRules(await fetch(ctx.asset("city/rules.json"), { cache: "no-cache" }).then((r) => r.json()));
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
  const district = { key: null, crowd: null, places: [], streets: null, cameras: [], people: [], county: null };
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
          oneway: way.osm_oneway === "yes" ? 1 : way.osm_oneway === "-1" ? -1 : 0, road_m: way.road_m, service: way.service, busway: way.busway, id: way.osm_id });
      } else if (["sidewalk", "path", "crossing", "footway"].includes(way.kind)) {
        ways.push({ kind: "path", pts: pts.map(([lon, lat]) => ctx.fromLonLat(lon, lat)) });
      }
    }
    const streets = new Streets(ways);
    // Each building's front: the wall facing the pavement it is reached from, its middle, the way
    // in, and how deep the building runs from it -- where a shop's counter goes.
    for (const b of buildings) {
      const node = b.ring ? streets.nearest(b.x, b.z, "walk", 120) : null;
      if (node !== null && node !== undefined) b.inside = frontOf(b.ring, b.x, b.z, streets.nodes[node]);
    }
    const places = buildings.map((b) => placeFromBuilding(b, streets, R)).filter(Boolean);
    for (const pl of places) { const b = buildings.find((x) => x.id === pl.id); pl.front = b?.inside || null; pl.ring = b?.ring || null; }
    for (const p of places) p.county = data.county;
    const people = generatePopulation(R, places, { seed: data.key, size: 1000 });
    district.key = data.key; district.streets = streets; district.places = places; district.people = people; district.county = data.county;
    district.placeById = new Map(places.map((p) => [p.id, p]));
    district.crowd = new Crowd(R, streets, places, people, { seed: data.key, timeAt });
    district.cameras = speedCameras(ways, data);
    district.candidates = null; district.foundDay = null; district.found = [];
    district.listings = null; district.listingsWeek = null;
    if (shop.place) leaveShop(true);
    makeLines();
    drawCameras();
    ctx.log?.(`kerbside: the living city in ${data.key}: ${people.length} people, ${places.length} places, ${streets.size} street nodes`);
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
  ctx.root.add(group);
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const MAX_PEOPLE = 220, MAX_CARS = 160;
  const box = (w, h, d, y = 0, x = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, 0);
  const torsoGeo = box(0.4, 0.58, 0.23, 1.08);
  const headGeo = new THREE.SphereGeometry(0.115, 10, 8).translate(0, 1.53, 0);
  const legGeo = box(0.15, 0.82, 0.16, -0.41);    // hangs from the hip
  const armGeo = box(0.1, 0.6, 0.11, -0.3);       // hangs from the shoulder
  const mk = (geo, max) => { const m = new THREE.InstancedMesh(geo, lambert({ color: 0xffffff }), max); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.castShadow = false; group.add(m); return m; };
  const parts = { torso: mk(torsoGeo, MAX_PEOPLE), head: mk(headGeo, MAX_PEOPLE), legL: mk(legGeo, MAX_PEOPLE), legR: mk(legGeo, MAX_PEOPLE), armL: mk(armGeo, MAX_PEOPLE), armR: mk(armGeo, MAX_PEOPLE) };
  const carBody = mk(box(1, 0.55, 1, 0.55), MAX_CARS), carCabin = mk(box(0.86, 0.42, 0.5, 1.03), MAX_CARS);
  carCabin.material.color.set(0x9fb4c4);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(0, 0.33, 0);
  const carWheels = mk(wheel, MAX_CARS * 4); carWheels.material.color.set(0x1b1b1b);
  const lightGeo = box(0.22, 0.12, 0.04, 0.72);
  const headLights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), MAX_CARS * 2);
  const tailLights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xc0261f }), MAX_CARS * 2);
  const roofBar = mk(box(0.9, 0.12, 0.25, 1.55), MAX_CARS); roofBar.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
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
  function drawPeople(list, now) {
    let n = 0;
    for (const p of list) {
      if (n >= MAX_PEOPLE) break;
      // Inside the shop you are in, on its floor.
      const y = shop.place && p.indoors === shop.place.id ? shop.frame.y : groundAt(p.x, p.z);
      const s = p.person.height / 1.75;
      const b = base(p.x, y, p.z, p.yaw + Math.PI, s);
      const phase = now / 1000 * 2 * Math.PI * (p.person.pace / 1.35) * 0.95 + (hash32(p.id) % 100);
      const swing = p.moving ? Math.sin(phase) * 0.55 : 0;
      const set = (mesh, ox, oy, rot) => { M.copy(b).multiply(TM.makeTranslation(ox, oy, 0)).multiply(RM.makeRotationX(rot)); mesh.setMatrixAt(n, M); };
      parts.torso.setMatrixAt(n, b); parts.head.setMatrixAt(n, b);
      set(parts.legL, -0.1, 0.84, swing); set(parts.legR, 0.1, 0.84, -swing);
      set(parts.armL, -0.26, 1.34, -swing * 0.8); set(parts.armR, 0.26, 1.34, swing * 0.8);
      const h = hash32(p.id);
      parts.torso.setColorAt(n, C.set(p.person.uniform)); parts.armL.setColorAt(n, C); parts.armR.setColorAt(n, C);
      parts.head.setColorAt(n, C.set(SKIN[h % SKIN.length]));
      parts.legL.setColorAt(n, C.set(TROUSERS[(h >>> 5) % TROUSERS.length])); parts.legR.setColorAt(n, C);
      n += 1;
    }
    for (const mesh of Object.values(parts)) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    return n;
  }
  function drawCars(list, night) {
    let n = 0, lights = 0;
    for (const v of list) {
      if (n >= MAX_CARS) break;
      const [w, h, l] = CAR_DIMS[v.model] || CAR_DIMS.sedan;
      const y = groundAt(v.x, v.z);
      E.set(0, v.yaw, 0); Q.setFromEuler(E);
      M.compose(V.set(v.x, y, v.z), Q, S3.set(w, h / 1.45, l));
      carBody.setMatrixAt(n, M);
      const tall = ["delivery_van", "box_truck", "bus"].includes(v.model);
      M.compose(V.set(v.x, y, v.z), Q, S3.set(w, tall ? 0.01 : h / 1.45, tall ? 0.01 : l));
      carCabin.setMatrixAt(n, M);
      const paint = v.model === "taxi" ? "#f1c40f" : v.model === "bus" ? "#b03a2e" : v.model === "patrol" ? "#1b2631" : v.model === "box_truck" || v.model === "delivery_van" ? "#efefea" : PAINT[Math.floor((v.shade ?? 0.5) * PAINT.length) % PAINT.length];
      carBody.setColorAt(n, C.set(paint));
      M.compose(V.set(v.x, y, v.z), Q, S3.set(v.model === "patrol" || v.model === "taxi" ? w : 0.001, 1, v.model === "patrol" || v.model === "taxi" ? 1 : 0.001));
      roofBar.setMatrixAt(n, M);
      roofBar.setColorAt?.(n, C.set(v.model === "patrol" ? "#2e6bd6" : "#fff3b0"));
      // Wheels at the corners.
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = -fz, rz = fx;
      let k = 0;
      for (const [a, s] of [[0.36, 1], [0.36, -1], [-0.36, 1], [-0.36, -1]]) {
        M.compose(V.set(v.x + fx * a * l + rx * s * w * 0.45, y, v.z + fz * a * l + rz * s * w * 0.45), Q, S3.set(1, 1, 1));
        carWheels.setMatrixAt(n * 4 + k, M); k += 1;
      }
      if (night) {
        for (const s of [1, -1]) {
          if (lights >= MAX_CARS * 2) break;
          M.compose(V.set(v.x + fx * l * 0.5 + rx * s * w * 0.32, y, v.z + fz * l * 0.5 + rz * s * w * 0.32), Q, S3.set(1, 1, 1)); headLights.setMatrixAt(lights, M);
          M.compose(V.set(v.x - fx * l * 0.5 + rx * s * w * 0.32, y, v.z - fz * l * 0.5 + rz * s * w * 0.32), Q, S3.set(1, 1, 1)); tailLights.setMatrixAt(lights, M);
          lights += 1;
        }
      }
      n += 1;
    }
    for (const mesh of [carBody, carCabin, roofBar]) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    carWheels.count = n * 4; carWheels.instanceMatrix.needsUpdate = true;
    headLights.count = tailLights.count = lights; headLights.instanceMatrix.needsUpdate = tailLights.instanceMatrix.needsUpdate = true;
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
    const g = new THREE.Group();
    const body = new THREE.Mesh(box(w, h * 0.38, l, h * 0.38), new THREE.MeshStandardMaterial({ color: colour, metalness: 0.45, roughness: 0.4 }));
    const tall = ["delivery_van", "box_truck", "bus"].includes(model);
    const cabin = new THREE.Mesh(box(w * 0.86, tall ? h * 0.52 : h * 0.29, tall ? l * 0.96 : l * 0.5, tall ? h * 0.83 : h * 0.71), new THREE.MeshStandardMaterial({ color: tall ? colour : 0x9fb4c4, metalness: 0.2, roughness: 0.15 }));
    if (!tall) cabin.position.z = l * 0.05;
    g.add(body, cabin);
    for (const [a, s] of [[0.36, 1], [0.36, -1], [-0.36, 1], [-0.36, -1]]) {
      const wh = new THREE.Mesh(wheel, new THREE.MeshLambertMaterial({ color: 0x1b1b1b }));
      wh.position.set(s * w * 0.45, 0, -a * l); g.add(wh);
    }
    for (const s of [1, -1]) {
      const hl = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xfff6d8 })); hl.position.set(s * w * 0.32, 0, -l * 0.5); g.add(hl);
      const tl = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xc0261f })); tl.position.set(s * w * 0.32, 0, l * 0.5); g.add(tl);
    }
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
      const result = world.submit(m.pid, m.command, m.args);
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
  async function ensureJoined() {
    const w = world || view;
    if (!w || w.players.has(myId) || party.joining) return;
    party.joining = true;
    const home = nearestPlace((p) => p.use === "residential");
    const r = await send("join", { name: party.session?.me?.name || "You", home });
    if (r.ok && party.session) { const self = store.get(SAVE_SELF); if (self) await send("import", { saved: self }); }
    party.joining = false;
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
    notify(`Driving your ${spec.name.toLowerCase()} (${car.plate}). Arrows steer; C to get out.`);
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
    const dx = -Math.sin(car.yaw) * car.speed * dt, dz = -Math.cos(car.yaw) * car.speed * dt;
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
    const metres = Math.hypot(car.x - before.x, car.z - before.z);
    car.km += metres / 1000;
    const spec = car.spec;
    car.litres += spec.fuel === "electric" ? metres / 1000 * spec.kwh_per_100km / 100 / 1.6 : metres / 1000 * spec.l_per_100km / 100;
    if (car.mesh) { car.mesh.position.set(car.x, p.y - ctx.standY, car.z); car.mesh.rotation.y = car.yaw; }
    ctx.followYaw(car.yaw, dt);
    roadCharges(before, car, dt);
    return true;
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
      if (seg !== car.laneSeg) { flushLane(); car.laneSeg = seg; car.laneRule = rule; car.laneKm = 0; }
      if (seg) { car.laneKm += Math.hypot(b.x - a.x, b.z - a.z) / 1000; if (car.laneKm > 1.5) flushLane(true); }
      car.lane = hit ? { lane: hit.lane, of: hit.seg.lanes, managed: hit.managed, kind: hit.seg.kind, minimum: hit.seg.min, active: rule?.active, ref: hit.seg.ref } : null;
    }
    const mph = Math.abs(car.speed) * MPH;
    for (const c of district.cameras) {
      if (Math.abs(c.x - b.x) > 14 || Math.abs(c.z - b.z) > 14) continue;
      const limitMph = speedLimitAt(b.x, b.z) * MPH;
      if (mph - limitMph < 11 || now - (car.lastCam.get(c.id) || 0) < 120_000) continue;
      car.lastCam.set(c.id, now);
      send("speed_camera", { over_mph: mph - limitMph, mph, camera: c.id, key: `${myId}:${c.id}:${Math.floor(now / 60000)}` })
        .then((r) => r.ok && r.charged && notify(`Speed camera: ${Math.round(mph)} mph in a ${Math.round(limitMph)} — a ${R.fmt(r.charged)} notice will follow.`));
    }
  }
  function flushLane(keep = false) {
    if (!car.laneSeg || car.laneKm < 0.05) return;
    const seg = car.laneSeg, km = car.laneKm;
    car.laneKm = 0;
    if (!keep) car.laneSeg = null;
    send("lane", { segment: seg.id, kind: seg.kind, minimum: seg.min, occupants: occupants(), km, active: true, key: `${myId}:${seg.id}:${Math.floor(Date.now() / 30000)}` })
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
    if (district.foundDay === day || !district.streets) return district.found;
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
  async function pickUp() {
    const p = me();
    const t = thingsNear(p.x, p.z, 3.2)[0];
    if (!t) { notify("Nothing within reach to pick up. Things on the ground have a yellow ring."); return; }
    const r = await send("pick_up", t.found ? { found: { id: t.id, item: t.item, x: t.x, z: t.z } } : { id: t.id });
    notify(r.ok ? `Picked up ${R.items[r.item].name.toLowerCase()}${r.qty > 1 ? ` x${r.qty}` : ""} (carrying ${r.carry.kg} of ${r.carry.capacity} kg).` : r.error);
  }

  // ---- buses and taxis -------------------------------------------------------------------------
  // Buses run their real routes on a timetable (docs/city/transit.mjs), standing at each stop for
  // a few seconds: board at the stop while one stands there (T), ask for the next stop (T again)
  // and you are let off there. A taxi is called to where you stand (T away from a passing one) and
  // takes you where you ask, on the meter.
  const transit = { ride: null };
  const TL = R.transit_lines;
  const KERB = (half) => Math.max(1.7, half - 1.8);
  let routeBuses = [];
  const taxi = { id: null, phase: null, route: null, d: 0, at: null, dest: null, n: 0 };
  //: Everything on wheels near you: the crowd's traffic, the route buses and your taxi.
  //: (Yours and the route buses first, so a crowded street's cap never leaves them out.)
  function wheels() { return taxi.at ? [taxi.at, ...routeBuses, ...visible.vehicles] : [...routeBuses, ...visible.vehicles]; }
  function nearestFare() {
    const p = me();
    let best = null;
    for (const v of wheels()) {
      if (v.model !== "bus" && v.model !== "taxi") continue;
      const route = String(v.id).startsWith("bus:"), mine = v.id === taxi.id;
      if (route && !v.dwelling) continue;            // a route bus opens its doors at the stop
      if (mine && taxi.phase !== "waiting") continue;
      if (!route && !mine && district.lines?.length && v.model === "bus") continue;
      const reach = route || mine ? TL.board_reach_m : R.transit.board_reach_m;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < reach && (!best || d < best.d)) best = { ...v, d };
    }
    return best;
  }
  async function board() {
    if (transit.ride) return transit.ride.route ? requestStop() : alight();
    if (car.active || car.riding) { notify("Get out of the car first (C)."); return; }
    if (shop.place) { notify("Leave the shop first (Esc)."); return; }
    const v = nearestFare();
    if (!v) { openSide("ride"); return; }
    const r = await send("board", { kind: v.model, vehicle: v.id });
    if (!r.ok) { notify(r.error); return; }
    transit.ride = { kind: v.model, vehicle: v.id, seen: performance.now(), km: 0, x: v.x, z: v.z, route: String(v.id).startsWith("bus:") ? v.route : null, from: v.stop ?? null, stop: false };
    if (v.id === taxi.id) taxiToDestination();
    ctx.avatarVisible(false);
    if (side?.kind === "ride") closeSide();
    notify(transit.ride.route ? `On the ${v.route} toward ${v.nextName || "the end of the line"}: ${R.fmt(R.transit.bus_fare)} paid. T asks for the next stop.`
      : v.id === taxi.id ? `In your taxi to ${taxi.dest?.name || "where you asked"}: ${R.fmt(R.transit.taxi_flag)} and ${R.fmt(R.transit.taxi_per_km)} a km.`
        : `In a taxi: ${R.fmt(R.transit.taxi_flag)} and ${R.fmt(R.transit.taxi_per_km)} a km. T to get out and pay.`);
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
    // Out at the stop's pole, or on the kerb side.
    if (v?.pole && Math.hypot(v.pole.x - p.x, v.pole.z - p.z) < 30) ctx.moveAvatarTo(v.pole.x, v.pole.z);
    else ctx.moveAvatarTo(p.x + Math.cos(yaw) * (ride.kind === "bus" ? 2.8 : 1.9), p.z - Math.sin(yaw) * (ride.kind === "bus" ? 2.8 : 1.9));
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
    const meNode = s.nearest(here.x, here.z, "drive", 80);
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
    taxi.n += 1;
    Object.assign(taxi, { id: `taxi:${myId}:${taxi.n}`, phase: "coming", route, d: 0, dest, since: performance.now() });
    closeSide();
    notify(`A yellow taxi is on its way, about ${Math.max(1, Math.round(route.length / TL.taxi_speed_ms / 60))} min. Wait at the kerb; T to get in when it pulls up.`);
  }
  function taxiToDestination() {
    const s = district.streets, d = taxi.dest;
    const a = s?.nearest(taxi.at.x, taxi.at.z, "drive", 80), b = s?.nearest(d.x, d.z, "drive", 250);
    const route = a !== null && a !== undefined && b !== null && b !== undefined ? s.route(a, b, "drive") : null;
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
    if (done && taxi.phase === "coming") { taxi.phase = "waiting"; taxi.waitSince = performance.now(); notify("Your taxi has pulled up: T to get in."); }
    if (taxi.phase === "waiting" && performance.now() - taxi.waitSince > 180_000) { Object.assign(taxi, { phase: null, route: null, at: null }); notify("The taxi gave up waiting and left."); }
    if (done && taxi.phase === "riding" && transit.ride?.vehicle === taxi.id && !taxi.paying) { taxi.paying = true; alight(taxi.at).finally(() => { taxi.paying = false; }); }
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
  const address = (name) => (name ? String(name).replace(/^(\d+[A-Za-z]?)(;\s*\d+[A-Za-z]?)+/, "$1") : null);
  function deliveryHere(place) { const keys = place && new Set(place.keys); return Boolean(keys) && R.delivery.from.some((k) => keys.has(k)); }
  async function takeDelivery(place) {
    const [lo, hi] = R.delivery.distance_m;
    const homes = district.places.filter((x) => x.use === "residential" && x.id !== place.id).map((x) => ({ x, d: Math.hypot(x.x - place.x, x.z - place.z) })).filter((o) => o.d >= lo && o.d <= hi);
    if (!homes.length) { notify("No homes in the delivery area from here."); return; }
    const to = homes[Math.floor(Math.random() * homes.length)].x;
    const r = await send("take_delivery", { place, to: { id: to.id, x: to.x, z: to.z, name: address(to.name) } });
    if (!r.ok) { notify(r.error); return; }
    notify(`Delivery: a parcel to ${to.name || "a home"}, ${Math.round(r.delivery.km * 1000)} m away — ${R.fmt(r.delivery.pay)} if there in ${Math.round((r.delivery.due - Date.now()) / 60000)} min. Follow the green light; D to hand it over.`);
    refresh();
  }
  async function deliveryKey() {
    const p = self();
    if (!p) { notify("Join the city first (City panel)."); return; }
    if (p.delivery) {
      const d = Math.hypot(me().x - p.delivery.to.x, me().z - p.delivery.to.z);
      if (d > R.delivery.reach_m) { notify(`The address is ${Math.round(d)} m away: follow the green light.`); return; }
      const r = await send("deliver");
      notify(r.ok ? `Delivered${r.late ? " late, at half pay" : ""}: ${R.fmt(r.pay)}.` : r.error);
      return;
    }
    const place = nearestPlace((x) => deliveryHere(x), R.stores.reach_m);
    if (!place) { notify("Deliveries go out from restaurants, cafés and shops: walk up to one."); return; }
    takeDelivery(place);
  }
  function drawMarker(now) {
    const d = self()?.delivery;
    marker.visible = Boolean(d);
    if (!d) return;
    marker.position.set(d.to.x, groundAt(d.to.x, d.to.z), d.to.z);
    // Wider seen from further off, so it shows from a zoomed-out view.
    const far = Math.max(1, Math.hypot(me().x - d.to.x, me().z - d.to.z) / 120);
    marker.scale.set(far, 1, far);
    marker.material.opacity = 0.35 + 0.12 * Math.sin(now / 300);
  }

  // ---- work and rest -----------------------------------------------------------------------------
  async function workKey() {
    const p = self();
    if (!p?.job) { notify("No job: walk up to a shop that is hiring and take one (B, or the City panel's Here tab)."); return; }
    const place = district.placeById?.get(p.job.place.id);
    const r = await send(p.clocked ? "clock_out" : "clock_in", p.clocked ? {} : { spots: place ? spotsFor(place) : null });
    notify(r.ok ? (p.clocked ? "Clocked out and paid for the time worked." : `At work as ${p.job.title.toLowerCase()}: tasks come every minute or so (V where the orange ring is). Paid ${R.fmt(p.job.pay / 6)} a 10 minutes worked, tax held back; idle 30 minutes and you are sent home.`) : r.error);
  }
  async function restKey() {
    const p = self();
    if (!p) return;
    const r = await send("rest", { on: !p.resting });
    if (r.ok) notify(r.resting ? (r.home ? "In bed at home: stamina comes back fastest. Walk on to get up." : "Resting: stamina comes back. Walk on to get up.") : "Up again.");
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
  function signTexture(text, bg = "#1d2a33", fg = "#f6f1e7") {
    const c = doc.createElement("canvas"); c.width = 512; c.height = 96;
    const g = c.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
    g.fillStyle = fg; g.font = "600 46px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(text).slice(0, 22), 256, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace || t.colorSpace; return t;
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
    const glass = new THREE.MeshBasicMaterial({ color: 0xbfd9e6, transparent: true, opacity: 0.22, side: THREE.BackSide, depthWrite: false });
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
    return g;
  }
  //: Into the shop beside you: through its door, into the room, the counter in front of you.
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
    const start = F.at(0.7, 0);
    ctx.placeAvatar(start.x, F.y, start.z, Math.atan2(-F.I.nx, -F.I.nz));
    ctx.setPitch?.(-0.06);
    notify(`In ${storesAt(R, place.keys).map((x) => x.name).join(" and ") || place.name || "the shop"}. B for the counter${shop.staff ? ", V for your task" : ""}; walk out the door or Esc to leave.`);
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
    if (Math.abs(me().y - ctx.standY - F.y) > 0.05) ctx.placeAvatar(me().x, F.y, me().z);
    if (!held.size) return true;
    const yaw = ctx.getYaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    let mx = 0, mz = 0;
    if (held.has("ArrowUp")) { mx += fx; mz += fz; }
    if (held.has("ArrowDown")) { mx -= fx; mz -= fz; }
    if (held.has("ArrowRight")) { mx += rx; mz += rz; }
    if (held.has("ArrowLeft")) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (!len) return true;
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
    walked(Math.hypot(at.x - p.x, at.z - p.z), dt);
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
  // A neighbour wants something from the shops: buy it, bring it to their door (D there), and they
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
  async function errandKey() {
    const p = self();
    if (!p) { notify("Join the city first (City panel)."); return; }
    if (p.errand) {
      const d = Math.hypot(me().x - p.errand.to.x, me().z - p.errand.to.z);
      if (d <= R.errands.reach_m) { const r = await send("deliver_errand"); notify(r.ok ? `Errand done: ${R.fmt(r.reimbursed)} back and a ${R.fmt(r.fee)} fee.` : r.error); return; }
    }
    openSide("errands");
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
  let heldMesh = null, heldItem = null, lastStrike = 0;
  function drawHeld() {
    const item = self()?.hands || null;
    if (item === heldItem) return;
    heldItem = item;
    heldMesh?.removeFromParent(); heldMesh = null;
    if (!item) return;
    const it = R.items[item] || {};
    const long = Boolean(it.strike && it.strike !== "fists");
    heldMesh = new THREE.Group(); heldMesh.name = "city-held";
    if (long) {
      const handle = new THREE.Mesh(box(0.04, it.strike === "sledgehammer" || it.strike === "axe" ? 0.85 : 0.38, 0.04, 0), lambert({ color: 0x7a5230 }));
      const head = new THREE.Mesh(box(it.strike === "saw" ? 0.02 : 0.14, it.strike === "saw" ? 0.32 : 0.08, it.strike === "saw" ? 0.12 : 0.06, it.strike === "sledgehammer" || it.strike === "axe" ? 0.42 : 0.2), lambert({ color: 0x8b949c }));
      heldMesh.add(handle, head);
    } else heldMesh.add(new THREE.Mesh(box(0.14, 0.12, 0.1, 0), lambert({ color: thingColour(item) })));
    const hand = ctx.hand?.();
    if (hand) { heldMesh.scale.setScalar(1 / Math.max(1e-3, hand.getWorldScale(new THREE.Vector3()).x)); hand.add(heldMesh); }
    else { heldMesh.position.set(0.32, 0.95 - ctx.standY, -0.12); ctx.avatar.add(heldMesh); }
  }
  const archetypeId = (a) => (typeof a === "string" ? a : a?.id);
  const damageKey = (arch, x, z) => `${arch}@${Math.round(x * 2) / 2},${Math.round(z * 2) / 2}`;
  //: What a blow can land on: the nearest thing within reach that breaks and is not broken yet.
  function strikeTarget(reach) {
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
  async function strikeKey(energy = null) {
    const p = self();
    if (!p) return;
    if (!energy && (car.active || transit.ride || car.riding)) return;
    const now = performance.now();
    if (!energy && now - lastStrike < 1000 / R.tools.strikes_per_second) return;
    lastStrike = now;
    const t = strikeTarget(energy ? 6 : R.tools.reach_m);
    if (!t) { if (!energy) notify("Nothing within reach to strike. Benches, bins, lights, signs, trees and windows break."); return; }
    const r = await send("strike", { target: { key: t.key, archetype: t.id, x: t.x, z: t.z, own: false, spec: t.spec }, energy, witnesses: witnessesNear(t.x, t.z) });
    if (!r.ok) { notify(r.error); return; }
    const tool = r.tool === "fists" ? "Bare hands" : r.tool === "vehicle" ? "Your car" : R.items[p.hands]?.name || r.tool;
    if (r.broken) {
      hideBroken(t.key, t.o, t.i);
      notify(`${tool}: the ${t.spec.name.toLowerCase()} breaks.${r.salvage ? ` Left on the ground: ${R.items[r.salvage].name.toLowerCase()} (G picks it up).` : ""}${r.fine ? ` Seen: a ${R.fmt(r.fine)} vandalism fine and ${R.fmt(r.restitution)} for the repair.` : ""}`);
    } else notify(`${tool} on the ${t.spec.name.toLowerCase()} (${t.spec.material}): ${r.joules} J, ${Math.round(r.share * 100)}% of what breaks it.${r.hurt ? ` That hurt: -${r.hurt} health.` : ""}`);
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
  function syncDamage() {
    const prox = ctx.objects?.(), dmg = view?.damage;
    if (!prox || !dmg) return;
    for (const [key, d] of dmg) {
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

  // ---- what can be done here -------------------------------------------------------------------
  //: The actions open to you where you stand, each with its key: what the action bar shows.
  function actionsHere() {
    const p = self(), here = me(), out = [];
    if (!p) return [{ id: "join", label: "Join the city", key: "", run: () => openPanel(true) }];
    if (car.active) return [{ id: "car", label: "Get out", key: "C", run: toggleCar }];
    if (car.riding) return [{ id: "car", label: "Get out", key: "C", run: toggleCar }];
    if (transit.ride) {
      if (!transit.ride.route) return [{ id: "ride", label: transit.ride.vehicle === taxi.id ? `Taxi to ${taxi.dest?.name || "your stop"}: get out early` : "Pay and get out", key: "T", run: () => alight() }];
      const v = routeBuses.find((x) => x.id === transit.ride.vehicle);
      return [{ id: "ride", label: transit.ride.stop ? `Stopping at ${v?.nextName || "the next stop"}` : `Next stop: ${v?.nextName || "…"} (ask to get off)`, key: "T", run: requestStop }];
    }
    const task = p.clocked?.task;
    if (task) out.push({ id: "task", label: working ? `${task.label}: ${Math.min(100, Math.round((performance.now() - working.started) / 10 / working.seconds))}%` : `Task: ${task.label}`, key: "V", run: taskKey });
    if (shop.place) {
      out.push({ id: "shop", label: "The counter", key: "B", run: () => openStore(shop.place) });
      if (p.job && p.job.place.id === shop.place.id) out.push({ id: "work", label: p.clocked ? "Clock out" : `Clock in (${p.job.title})`, key: "J", run: workKey });
      if (p.hands) out.push({ id: "strike", label: `Strike with the ${(R.items[p.hands]?.name || p.hands).toLowerCase()}`, key: "X", run: () => strikeKey() });
      out.push({ id: "leave", label: "Leave the shop", key: "Esc", run: () => leaveShop() });
      return out;
    }
    const shopAt = nearestPlace((x) => storesAt(R, x.keys).length > 0, R.stores.reach_m);
    if (shopAt) out.push({ id: "shop", label: `${shopAt.front ? "Go in" : "Shop"}: ${storesAt(R, shopAt.keys).map((s) => s.name).join(", ")}`, key: "B", run: () => shopKey() });
    const thing = thingsNear(here.x, here.z, 3.2)[0];
    if (thing) out.push({ id: "pick", label: `Pick up ${R.items[thing.item]?.name.toLowerCase() || "it"}`, key: "G", run: pickUp });
    const mine = view.registry.held(p.account).find((a) => a.kind === "vehicle" && a.attrs.x !== undefined && Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z) < 7);
    if (mine) out.push({ id: "car", label: `Drive ${R.vehicles.models[mine.attrs.model].name.toLowerCase()}`, key: "C", run: toggleCar });
    const fare = nearestFare();
    if (fare) out.push({ id: "ride", label: fare.id === taxi.id ? "Get in your taxi" : String(fare.id).startsWith("bus:") ? `Board the ${fare.route} to ${fare.nextName || "…"} ${R.fmt(R.transit.bus_fare)}` : fare.model === "bus" ? `Board the bus ${R.fmt(R.transit.bus_fare)}` : "Hail the taxi", key: "T", run: board });
    else if (taxi.phase === "coming") out.push({ id: "ride", label: "Your taxi is on its way", key: "T", run: () => openSide("ride") });
    else { const stop = nearestStop(30); out.push({ id: "ride", label: stop ? `Bus stop: ${stop.routes.join(", ")}` : "Call a taxi", key: "T", run: () => openSide("ride") }); }
    if (p.job) {
      const atWork = Math.hypot(here.x - p.job.place.x, here.z - p.job.place.z) <= R.jobs.workplace_reach_m;
      if (p.clocked) out.push({ id: "work", label: "Clock out", key: "J", run: workKey });
      else if (atWork) out.push({ id: "work", label: `Clock in (${p.job.title})`, key: "J", run: workKey });
    }
    if (p.delivery) {
      const d = Math.hypot(here.x - p.delivery.to.x, here.z - p.delivery.to.z);
      if (d <= R.delivery.reach_m) out.push({ id: "deliver", label: "Hand over the parcel", key: "D", run: deliveryKey });
    } else if (shopAt && deliveryHere(shopAt)) out.push({ id: "deliver", label: "Delivery gig", key: "D", run: () => takeDelivery(shopAt) });
    if (p.errand && Math.hypot(here.x - p.errand.to.x, here.z - p.errand.to.z) <= R.errands.reach_m) out.push({ id: "errand", label: `Hand ${p.errand.to.who || "them"} the shopping`, key: "K", run: errandKey });
    const target = strikeTarget(R.tools.reach_m);
    if (target) out.push({ id: "strike", label: `${p.hands ? `${R.items[p.hands]?.name || "Strike"}` : "Hit"}: ${target.spec.name.toLowerCase()}`, key: "X", run: () => strikeKey() });
    out.push({ id: "rest", label: p.resting ? "Get up" : self()?.home && Math.hypot(here.x - p.home.x, here.z - p.home.z) <= R.vitals.home_reach_m ? "Sleep at home" : "Rest", key: "Z", run: restKey });
    return out;
  }

  // ---- the frame -------------------------------------------------------------------------------
  let lastCrowd = 0, lastRefresh = 0, lastStep = 0, lastSave = 0, lastRegion = 0, lastNight = false, lastFrame = 0;
  let visible = { people: [], vehicles: [] };
  function tick(now) {
    if (!ctx.enabled()) { group.visible = false; return false; }
    group.visible = true;
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
      routeBuses = busesAt(district.lines, t).filter((b) => Math.abs(b.x - f.x) < R.routine.visible_radius_m && Math.abs(b.z - f.z) < R.routine.visible_radius_m);
    } else routeBuses = [];
    stepTaxi(dt);
    if (transit.ride) followRide();
    stepWork();
    reportExertion();
    // Who is out and about: a full pass four times a second, positions every frame.
    const focus = car.active ? car : me();
    if (district.crowd) {
      if (now - lastCrowd > 250) {
        lastCrowd = now;
        visible = district.crowd.at(t, focus);
        // Where the real routes run, the buses are theirs (the timetable's), not the crowd's.
        if (district.lines?.length) visible.vehicles = visible.vehicles.filter((v) => v.model !== "bus");
        const hour = visible.time.minute / 60;
        lastNight = hour < 6.6 || hour > 18.4;
      } else {
        const tt = timeAt(t);
        visible.people = visible.people.map((p) => ({ ...p, ...(district.crowd.personAt(p.person, tt, focus, R.routine.visible_radius_m) || p) }));
        visible.vehicles = visible.vehicles.map((v) => v.person ? { ...v, ...(district.crowd.personAt(v.person, tt, focus, R.routine.visible_radius_m) || v) } : advance(v, (now - (v._at || now)) / 1000, now));
      }
      drawPeople(visible.people, now);
      drawCars(wheels(), lastNight);
      drawThings(now);
    }
    drawMarker(now); drawErrand(now); drawTask(now);
    if (now - lastRefresh > 500) {
      lastRefresh = now; drawParked(); checkFainted(); drawHeld(); syncDamage(); hud();
      if (side && ["store", "ride", "things"].includes(side.kind)) drawSide();
      if (district.places.length) listings();
    }
    if (shop.place && !ctx.isFirstPerson?.()) ctx.firstPerson?.(true);
    return Boolean(visible.people.length || visible.vehicles.length || car.active || transit.ride || routeBuses.length || taxi.at || shop.place || working);
  }
  // Between full passes a car goes on along its heading at its speed.
  function advance(v, dt, now) {
    if (!(dt > 0) || dt > 1) return { ...v, _at: now };
    return { ...v, x: v.x - Math.sin(v.yaw) * v.speed * dt, z: v.z - Math.cos(v.yaw) * v.speed * dt, _at: now };
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
  const KEYS = {
    c: () => toggleCar(), b: () => shopKey(), g: () => pickUp(), i: () => openSide("bag"), t: () => board(), j: () => workKey(),
    d: () => deliveryKey(), z: () => restKey(), h: () => openSide("help"), "?": () => openSide("help"),
    v: () => taskKey(), k: () => errandKey(), x: () => strikeKey(), o: () => openSide("homes"),
  };
  addEventListener("keydown", (e) => {
    if (e.key === "Shift") { if (!typing(e.target)) body.sprintHeld = true; return; }
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || !ctx.enabled()) return;
    if (e.key === "Escape" && side) { closeSide(); return; }
    if (e.key === "Escape" && shop.place) { leaveShop(); return; }
    const run = KEYS[e.key.length === 1 ? e.key.toLowerCase() : ""];
    if (!run) return;
    e.preventDefault();
    run();
  });
  addEventListener("keyup", (e) => { if (e.key === "Shift") body.sprintHeld = false; });
  addEventListener("blur", () => { body.sprintHeld = false; });
  function shopKey() {
    if (shop.place) { openStore(shop.place); return; }
    const place = nearestPlace((x) => storesAt(R, x.keys).length > 0, R.stores.reach_m);
    if (place?.front && !car.active && !transit.ride && enterShop(place)) { openStore(place); return; }
    if (!place) { notify("No shop beside you: walk up to a café, a restaurant, a pharmacy, a hardware store…"); return; }
    openStore(place);
  }
  async function toggleCar() {
    if (!ctx.enabled()) return;
    if (shop.place) { notify("Leave the shop first (Esc)."); return; }
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
        car.riding = peer.id; ctx.avatarVisible(false); notify(`Riding with ${peer.name}. C to get out.`); refresh(); return;
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
#city{position:fixed;right:12px;bottom:56px;z-index:36;width:min(360px,calc(100vw - 24px));max-height:min(72vh,640px);overflow:auto;background:var(--cp,#fff);color:var(--ci,#16202a);
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
#city-side{position:fixed;right:12px;bottom:96px;z-index:37;width:min(400px,calc(100vw - 24px));max-height:min(66vh,620px);overflow:auto;background:var(--cp,#fff);color:var(--ci,#16202a);
 border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.24);font:13px/1.4 system-ui,sans-serif;padding:12px}
#city-side h3{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px}#city-side h3 span{flex:1}
#city-side h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--cm,#5c6770)}
#city-side .note{color:var(--cm,#5c6770);font-size:12px;margin:2px 0}
#city-side button{border:1px solid rgba(0,0,0,.18);background:var(--cb,#f6f7f8);color:inherit;border-radius:8px;padding:3px 8px;font:inherit;cursor:pointer;margin:2px 2px 2px 0}
#city-side button.primary{background:#1f6feb;color:#fff;border-color:#1f6feb}
#city-side .tabs{display:flex;gap:2px;flex-wrap:wrap;margin:4px 0 6px}#city-side .tabs button[aria-pressed=true]{background:#1f6feb;color:#fff}
#city-side table{width:100%;border-collapse:collapse;font-size:12px}#city-side td{padding:4px 4px 4px 0;vertical-align:top;border-top:1px solid rgba(128,128,128,.18)}
#city-side table.wares td:nth-child(2){white-space:nowrap;text-align:right}#city-side table.wares td:last-child{text-align:right;white-space:nowrap}
#city-side kbd,#city-actions kbd{font:600 10px/1 ui-monospace,monospace;border:1px solid rgba(128,128,128,.55);border-radius:4px;padding:2px 4px;margin-left:2px;opacity:.85}
#city-actions{position:fixed;left:50%;transform:translateX(-50%);bottom:44px;z-index:35;display:flex;flex-wrap:wrap;justify-content:center;gap:4px;max-width:calc(100vw - 24px);pointer-events:none}
#city-actions span{display:contents}
#city-actions button{pointer-events:auto;border:0;background:rgba(17,24,39,.86);color:#fff;border-radius:999px;padding:6px 12px;font:12px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);touch-action:none}
#city-actions button.primary{background:#1f6feb}#city-actions button.hold.on{background:#d9822b}
#city-vitals{position:fixed;left:12px;top:70px;z-index:34;width:210px;background:rgba(17,24,39,.86);color:#fff;border-radius:10px;padding:8px 10px;font:11px/1.3 system-ui,sans-serif;pointer-events:none}
#city-vitals .bar{display:grid;grid-template-columns:52px 1fr 24px;align-items:center;gap:6px;margin:2px 0}
#city-vitals .bar i{display:block;height:7px;border-radius:4px;background:linear-gradient(90deg,var(--c) var(--v),rgba(255,255,255,.14) var(--v))}
#city-vitals .bar b{text-align:right;font-weight:600}#city-vitals .carry{opacity:.8;margin-top:3px}#city-vitals .gig{margin-top:3px;color:#7ee2a0}
@media (max-width:640px){#city-vitals{width:150px;top:64px}#city-vitals .bar{grid-template-columns:44px 1fr 20px}}
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
    const bits = [`<b>${p ? R.fmt(w.ledger.balance(p.account)) : "Join the city"}</b>`, t.label, here.name];
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
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); e.append(...kids.filter((k) => k !== null && k !== undefined && k !== false)); return e; };
  const row = (a, b) => h("tr", {}, h("td", { textContent: a }), h("td", { textContent: b }));
  const act = (label, fn, primary = false) => h("button", { textContent: label, className: primary ? "primary" : "", onclick: async () => { const r = await fn(); if (r && r.ok === false) notify(r.error); refresh(); } });
  // ---- the bars and the action bar ---------------------------------------------------------------
  const vitalsBox = Object.assign(doc.createElement("div"), { id: "city-vitals" });
  vitalsBox.setAttribute("aria-label", "Health, stamina and strength");
  const actionBar = Object.assign(doc.createElement("div"), { id: "city-actions" });
  actionBar.setAttribute("role", "toolbar"); actionBar.setAttribute("aria-label", "What you can do here");
  const dynamicActions = doc.createElement("span");
  const sprintButton = h("button", { className: "hold", title: "Hold to sprint (Shift)" }, "Sprint ", h("kbd", { textContent: "Shift" }));
  const press = (on) => (e) => { e.preventDefault(); body.sprintHeld = on; sprintButton.classList.toggle("on", on); };
  sprintButton.addEventListener("pointerdown", press(true));
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) sprintButton.addEventListener(type, press(false));
  const bagButton = h("button", { title: "What you carry (I)", onclick: () => openSide("bag") }, "Bag ", h("kbd", { textContent: "I" }));
  const helpButton = h("button", { title: "The controls (H)", onclick: () => openSide("help") }, "Controls ", h("kbd", { textContent: "H" }));
  actionBar.append(dynamicActions, sprintButton, bagButton, helpButton);
  doc.body.append(vitalsBox, actionBar);
  let actionsKey = "";
  const bar = (label, value, colour) => `<div class="bar"><span>${label}</span><i style="--v:${Math.max(0, Math.min(100, value)).toFixed(1)}%;--c:${colour}"></i><b>${Math.round(value)}</b></div>`;
  function drawBars() {
    const p = self();
    const on = ctx.enabled() && Boolean(p);
    vitalsBox.hidden = !on; actionBar.hidden = !ctx.enabled();
    const acts = ctx.enabled() ? actionsHere() : [];
    const key = acts.map((a) => `${a.id}:${a.label}`).join("|");
    if (key !== actionsKey) {
      actionsKey = key;
      dynamicActions.replaceChildren(...acts.map((a) => h("button", { className: a.id === "shop" || a.id === "deliver" ? "primary" : "", onclick: () => a.run() }, `${a.label} `, a.key ? h("kbd", { textContent: a.key }) : null)));
    }
    if (!on) return;
    const v = p.vitals, S = R.vitals.stamina;
    const c = view.carry ? view.carry(p) : { kg: carriedKg(R, p.inventory), capacity: carryCapacity(R, v.strength, p.inventory) };
    const state = p.resting ? "resting" : v.stamina < S.low ? "exhausted: slowed" : body.sprinting && body.sprintHeld ? "sprinting" : transit.ride ? `on the ${transit.ride.route || transit.ride.kind}` : shop.place ? "in the shop" : "";
    const gig = p.delivery ? `<div class="gig">Parcel to ${(p.delivery.to.name || "a home").replace(/[<>&]/g, "")}: ${Math.round(Math.hypot(me().x - p.delivery.to.x, me().z - p.delivery.to.z))} m, ${Math.max(0, Math.round((p.delivery.due - Date.now()) / 60000))} min, ${R.fmt(p.delivery.pay)}</div>` : "";
    const task = p.clocked?.task;
    const job = p.clocked ? `<div class="gig" style="color:#ffc46b">${task ? `${task.label.replace(/[<>&]/g, "")}${working ? ` — ${Math.min(100, Math.round((performance.now() - working.started) / 10 / working.seconds))}%` : ` (V, ${Math.round(Math.hypot(me().x - task.x, me().z - task.z))} m)`}` : "On shift: next task soon"} · ${p.clocked.tasks_total || 0} done${p.clocked.idle ? ` · idle ${p.clocked.idle}/${R.work_tasks.idle_windows_to_dismiss}` : ""}</div>` : "";
    const errand = p.errand ? `<div class="gig" style="color:#ffd27a">Errand for ${(p.errand.to.who || "a neighbour").replace(/[<>&]/g, "")}: ${p.errand.items.map((i) => R.items[i].name.toLowerCase() + ((p.inventory[i] || 0) > 0 ? " ✓" : "")).join(", ")} · ${Math.round(Math.hypot(me().x - p.errand.to.x, me().z - p.errand.to.z))} m</div>` : "";
    const hands = p.hands ? `<div class="carry">In hand: ${(R.items[p.hands]?.name || p.hands).replace(/[<>&]/g, "")}</div>` : "";
    vitalsBox.innerHTML = bar("Health", v.health, v.health < 25 ? "#ff6b5e" : "#e2483d") + bar("Stamina", v.stamina, v.stamina < S.low ? "#ffb84d" : "#e8a33b")
      + bar("Strength", v.strength, "#3c8fd6") + `<div class="carry">Carrying ${c.kg} of ${c.capacity} kg${state ? ` · ${state}` : ""}</div>${hands}${gig}${job}${errand}`;
  }

  // ---- the shop, the bag, the controls ----------------------------------------------------------
  let side = null;   // {kind, el, place, store}
  function openSide(kind, place = null) {
    if (side && side.kind === kind && (!place || side.place?.id === place.id)) { closeSide(); return; }
    closeSide();
    if (panel) { panel.remove(); panel = null; }
    const el = h("section", { id: "city-side", className: "city-win" });
    el.setAttribute("aria-label", { store: "Shop", bag: "Your things", ride: "Buses and taxis", errands: "Errands", homes: "Homes for sale and to rent" }[kind] || "Controls");
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
    const close = h("button", { textContent: "×", title: "Close (Esc)", onclick: closeSide });
    if (!w || !p) { side.el.replaceChildren(h("h3", {}, h("span", { textContent: "The living city" }), close), h("p", { className: "note", textContent: "Join the city first: the City panel." })); return; }
    const c = w.carry(p);
    const status = h("p", { className: "note", textContent: `Balance ${R.fmt(w.ledger.balance(p.account))} · carrying ${c.kg} of ${c.capacity} kg · health ${Math.round(p.vitals.health)}, stamina ${Math.round(p.vitals.stamina)}, strength ${Math.round(p.vitals.strength)}` });
    const say = async (promise, text) => { const r = await promise; notify(r.ok ? text(r) : r.error); drawSide(); };
    if (side.kind === "store") {
      const place = side.place;
      const stores = storesAt(R, place.keys);
      const store = stores[Math.min(side.store, stores.length - 1)];
      const [lon, lat] = ctx.toLonLat(place.x, place.z);
      const chain = jurisdictionAt(R, lon, lat, district.county).chain;
      const title = h("h3", {}, h("span", { textContent: `${store.name}${place.name ? " — " + place.name : ""}` }), close);
      const tabs = stores.length > 1 ? h("div", { className: "tabs" }, ...stores.map((s2, i) => h("button", { textContent: s2.name, "aria-pressed": String(i === side.store), onclick: () => { side.store = i; drawSide(); } }))) : null;
      if (Math.hypot(me().x - place.x, me().z - place.z) > R.stores.reach_m * 2) { side.el.replaceChildren(title, h("p", { className: "note", textContent: "You have walked away from the shop." })); return; }
      const rows = store.items.map((id) => {
        const it = R.items[id];
        const tax = itemTax(R, chain, it, it.price, w.laws);
        const buy = h("button", { className: "primary", textContent: it.service ? "Pay" : "Buy", onclick: () => say(send("buy", { item: id, place }), (r) => `${r.store}: ${it.name} ${R.fmt(r.price)}${r.tax ? ` + ${R.fmt(r.tax)} tax` : ""}${r.effect ? " — " + Object.entries(r.effect).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ") : ""}.`) });
        const useHere = it.use && !it.service ? h("button", { textContent: it.kind === "prepared_food" || it.use.stamina ? "Eat or drink here" : "Use here", onclick: () => say(send("buy", { item: id, place, use: true }), (r) => `${it.name}: ${Object.entries(r.effect || {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ") || "done"}.`) }) : null;
        return h("tr", {}, h("td", {}, h("b", { textContent: it.name }), h("div", { className: "note", textContent: effectText(it) })),
          h("td", { textContent: `${R.fmt(it.price)}${tax ? ` +${R.fmt(tax)}` : ""}` }), h("td", {}, buy, useHere));
      });
      const extra = [];
      const jobs = R.jobs.player_jobs.filter((r) => R.jobs.roles[r].at.some((k) => place.keys.includes(k)));
      if (jobs.length) extra.push(h("h4", { textContent: "Hiring" }), h("div", {}, ...jobs.map((r) => act(`${R.jobs.roles[r].title} ${R.fmt(R.jobs.roles[r].pay)}/h`, () => send("take_job", { role: r, place })))));
      if (deliveryHere(place) && !p.delivery) extra.push(h("h4", { textContent: "Deliveries" }), act(`Take a delivery gig (${R.fmt(R.delivery.base_pay)} + ${R.fmt(R.delivery.pay_per_km)}/km)`, () => takeDelivery(place)));
      side.el.replaceChildren(title, tabs || "", status, h("table", { className: "wares" }, ...rows), ...extra);
      return;
    }
    if (side.kind === "bag") {
      const title = h("h3", {}, h("span", { textContent: "Your things" }), close);
      const entries = Object.entries(p.inventory || {}).filter(([, n]) => n > 0);
      const peers = (party.session?.players() || []).map((peer) => ({ peer, pid: party.ids.get(peer.id) })).filter((x) => x.pid && x.pid !== myId);
      const rows = entries.map(([id, n]) => {
        const it = R.items[id] || { name: id };
        const worn = Object.values(p.worn || {}).includes(id);
        const use = it.wear ? h("button", { textContent: worn ? "Take off" : "Wear", onclick: () => say(send("use", { item: id }), (r) => (r.wearing ? `Wearing the ${it.name.toLowerCase()}.` : `Took off the ${it.name.toLowerCase()}.`)) })
          : it.use ? h("button", { className: "primary", textContent: it.kind === "prepared_food" || it.use.stamina ? "Eat or drink" : "Use", onclick: () => say(send("use", { item: id }), (r) => `${it.name}: ${Object.entries(r.effect || {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ") || "done"}.`) }) : null;
        const hold = it.parcel || it.service ? null : p.hands === id ? h("button", { textContent: "Put away", onclick: () => say(send("stow"), () => `Put the ${it.name.toLowerCase()} away.`) })
          : h("button", { textContent: "Hold", title: it.strike ? "In your hand: X strikes with it" : "Take it out into your hand", onclick: () => say(send("hold", { item: id }), () => `${it.name} in your hand${it.strike ? ": X to strike with it" : ""}.`) });
        const drop = it.parcel ? null : h("button", { textContent: "Put down", onclick: () => say(send("drop", { item: id }), () => `Put down: ${it.name.toLowerCase()}. G picks it up.`) });
        const give = it.parcel ? null : peers.map(({ peer, pid }) => h("button", { textContent: `Give to ${peer.name}`, onclick: () => say(send("give_item", { to: pid, item: id }), (r) => `Gave ${r.to} the ${it.name.toLowerCase()}.`) }));
        return h("tr", {}, h("td", {}, h("b", { textContent: `${it.name}${n > 1 ? ` ×${n}` : ""}${worn ? " (worn)" : ""}${p.hands === id ? " (in hand)" : ""}` }), h("div", { className: "note", textContent: effectText(it) })),
          h("td", { textContent: `${Math.round((it.kg || 0) * n * 100) / 100} kg` }), h("td", {}, hold, use, drop, ...(give || [])));
      });
      const hands = p.hands ? R.items[p.hands] : null;
      const here = me();
      const cars = w.registry.held(p.account).filter((a) => a.kind === "vehicle").map((a) => {
        const spec = R.vehicles.models[a.attrs.model];
        const d = a.attrs.x === undefined ? null : Math.round(Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z));
        return h("tr", {}, h("td", {}, h("b", { textContent: `${spec.name} ${a.attrs.plate}` }), h("div", { className: "note", textContent: `${a.custody}${a.owner !== p.account ? ", borrowed" : ""} · ${Math.round(a.attrs.odometer_km || 0)} km` })),
          h("td", { textContent: car.vehicle === a.id && car.active ? "driving" : d === null ? "—" : `${d} m away` }), h("td", {}, d !== null && !(car.active && car.vehicle === a.id) ? h("button", { textContent: "Walk there", onclick: () => ctx.goTo?.(a.attrs.x, a.attrs.z) }) : null));
      });
      const homes = [...w.registry.owned(p.account, "home"), ...w.registry.held(p.account).filter((a) => a.kind === "home" && a.owner !== p.account)].map((a) => {
        const m = (p.mortgages || []).find((x) => x.home === a.id);
        return h("tr", {}, h("td", {}, h("b", { textContent: `${address(a.attrs.address) || "A home"}${a.attrs.label ? " " + a.attrs.label : ""}` }), h("div", { className: "note", textContent: `${a.attrs.beds || "studio"}${a.attrs.beds ? " bd" : ""}, ${sqft(a.attrs.sqft)} · ${a.owner === p.account ? (m ? `mortgage ${R.fmt(m.owed)} left, ${R.fmt(m.monthly)}/mo` : "owned outright") : `rented, ${R.fmt(p.lease?.rent || 0)}/mo`}` })),
          h("td", { textContent: `${Math.round(Math.hypot(a.attrs.x - here.x, a.attrs.z - here.z))} m` }), h("td", {}, h("button", { textContent: "Walk there", onclick: () => ctx.goTo?.(a.attrs.x, a.attrs.z) })));
      });
      side.el.replaceChildren(title, status,
        h("h4", { textContent: "In your hands" }), h("p", { className: "note", textContent: hands ? `${hands.name}${hands.strike ? ` — X strikes with it (${R.tools.kinds[hands.strike].energy_j} J a blow at full strength)` : ""}` : "Nothing: X strikes with your fists. Hold a tool from your bag to strike with it." }),
        hands ? h("div", {}, act("Put it away", () => send("stow")), act("Put it down here", () => send("drop", { item: p.hands }))) : "",
        h("h4", { textContent: "Bag" }),
        entries.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "Nothing yet. Shops sell food, medicine, tools and clothes (B at a shop); things on the pavement with a yellow ring can be picked up (G). Strength carries more; a backpack carries 10 kg more." }),
        p.delivery ? h("div", {}, act("Cancel the delivery", () => send("cancel_delivery"))) : "",
        p.errand ? h("div", {}, h("p", { className: "note", textContent: `Errand for ${p.errand.to.who || "a neighbour"} at ${p.errand.to.name || "their home"}: ${p.errand.items.map((i) => R.items[i].name.toLowerCase()).join(", ")}.` }), act("Give up the errand", () => send("cancel_errand"))) : "",
        h("h4", { textContent: "Vehicles" }), cars.length ? h("table", { className: "wares" }, ...cars) : h("p", { className: "note", textContent: "None: the City panel's Car tab has the dealership." }),
        h("h4", { textContent: "Homes" }), homes.length ? h("table", { className: "wares" }, ...homes) : h("p", { className: "note", textContent: `${p.home ? `A room at ${address(district.placeById?.get(p.home.building)?.name) || "your building"}. ` : ""}Homes for sale and to rent: O.` }),
        h("h4", { textContent: "Money" }), h("table", {}, row("Balance", R.fmt(w.ledger.balance(p.account))), row("Owed", R.fmt(w.billing.owed(p.account))),
          ...(p.mortgages || []).map((m) => row("Mortgage", `${R.fmt(m.owed)} at ${R.fmt(m.monthly)}/mo${m.missed ? `, ${m.missed} missed` : ""}`)),
          p.lease ? row("Rent", `${R.fmt(p.lease.rent)}/mo, next ${new Date(p.lease.next).toLocaleDateString()}`) : null));
      return;
    }
    if (side.kind === "ride") {
      const title = h("h3", {}, h("span", { textContent: "Buses and taxis" }), close);
      const stop = nearestStop(90);
      const out = [title, status];
      if (stop) {
        out.push(h("h4", { textContent: `Stop: ${stop.name}` }), h("p", { className: "note", textContent: `${Math.round(stop.d)} m away. Wait at the red flag; when the bus stands there, T boards it (${R.fmt(R.transit.bus_fare)}). On board, T asks for the next stop.` }));
        const rows = nextBuses(stop, Date.now()).map((b) => h("tr", {}, h("td", {}, h("b", { textContent: b.route })), h("td", { textContent: b.next.map((n) => `${n.wait < 1 ? "at the stop now" : `${Math.ceil(n.wait / 60)} min`} toward ${n.toward}`).join("; ") })));
        out.push(rows.length ? h("table", {}, ...rows) : h("p", { className: "note", textContent: "No route times here." }));
      } else if ((district.stops || []).length) {
        const near = [...district.stops].map((x) => ({ ...x, d: Math.hypot(x.x - me().x, x.z - me().z) })).sort((a, b) => a.d - b.d)[0];
        out.push(h("p", { className: "note", textContent: `The nearest bus stop is ${near.name}, ${Math.round(near.d)} m away (${near.routes.join(", ")}).` }), h("button", { textContent: "Walk to it", onclick: () => ctx.goTo?.(near.x, near.z) }));
      } else out.push(h("p", { className: "note", textContent: "No bus routes run through this district's streets." }));
      out.push(h("h4", { textContent: "A taxi" }));
      if (taxi.phase) out.push(h("p", { className: "note", textContent: taxi.phase === "coming" ? `On its way to you: ${Math.round(Math.max(0, taxi.route.length - taxi.d))} m off, then to ${taxi.dest.name}.` : `Waiting for you at the kerb, to take you to ${taxi.dest.name}: T to get in.` }),
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
    if (side.kind === "errands") {
      const title = h("h3", {}, h("span", { textContent: "Errands" }), close);
      if (p.errand) {
        const e = p.errand, d = Math.round(Math.hypot(me().x - e.to.x, me().z - e.to.z));
        const need = e.items.map((i) => `${R.items[i].name}${(p.inventory[i] || 0) > 0 ? " ✓" : ""}`);
        side.el.replaceChildren(title, status, h("p", {}, h("b", { textContent: `For ${e.to.who || "a neighbour"}, ${e.to.name || "their home"}` }), ` — ${d} m`),
          h("p", { className: "note", textContent: `Buy: ${need.join(", ")}. Then bring it to the orange light and press K there. Paid back what it cost, and ${R.fmt(e.fee)}.` }),
          h("div", {}, h("button", { textContent: "Walk there", onclick: () => ctx.goTo?.(e.to.x, e.to.z) }), act("Give it up", () => send("cancel_errand"))));
        return;
      }
      const offers = errandOffers();
      const rows = offers.map((o) => h("tr", {}, h("td", {}, h("b", { textContent: `${o.to.who || "A neighbour"}, ${o.to.name || "nearby"}` }), h("div", { className: "note", textContent: o.items.map((i) => R.items[i].name.toLowerCase()).join(", ") })),
        h("td", { textContent: `${(o.km).toFixed(1)} km · ${R.fmt(o.fee)} + ${R.fmt(o.cost)} back` }),
        h("td", {}, h("button", { className: "primary", textContent: "Take it", onclick: () => say(send("take_errand", { to: o.to, items: o.items }), () => `Errand for ${o.to.who || "a neighbour"}: buy ${o.items.map((i) => R.items[i].name.toLowerCase()).join(", ")} and bring it to ${o.to.name || "their door"}.`) }))));
      side.el.replaceChildren(title, status, h("p", { className: "note", textContent: "Neighbours who want something from the shops. New ones every hour." }), rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "Nobody near here needs anything just now." }));
      return;
    }
    if (side.kind === "homes") {
      const title = h("h3", {}, h("span", { textContent: "Homes for sale and to rent" }), close);
      const all = listings();
      side.filter ||= { kind: "sale", type: "any" };
      const f = side.filter;
      const pick = all.filter((l) => l.kind === f.kind && (f.type === "any" || l.type === f.type));
      const here = me();
      const sorted = pick.map((l) => ({ l, d: Math.hypot(l.x - here.x, l.z - here.z) })).sort((a, b) => a.d - b.d).slice(0, 30);
      const tabs = h("div", { className: "tabs" }, ...[["sale", "For sale"], ["rent", "To rent"]].map(([k, label]) => h("button", { textContent: label, "aria-pressed": String(f.kind === k), onclick: () => { f.kind = k; drawSide(); } })),
        ...[["any", "All"], ["single_family", "Houses"], ["apartment", "Flats"]].map(([k, label]) => h("button", { textContent: label, "aria-pressed": String(f.type === k), onclick: () => { f.type = k; drawSide(); } })));
      const units = district.places.filter((x) => x.use === "residential").length;
      const rows = sorted.map(({ l, d }) => {
        const terms = l.kind === "sale" ? mortgageTerms(R, l.price) : null;
        const label = `${l.beds ? `${l.beds} bd` : "Studio"} ${l.type === "single_family" ? "house" : "flat"}${l.label ? " " + l.label : ""}`;
        return h("tr", {}, h("td", {}, h("b", { textContent: `${label} — ${address(l.address) || "a home"}` }),
          h("div", { className: "note", textContent: `${sqft(l.sqft)} · ${l.neighbourhood} · ${R.fmt(R.money(l.psf))}/sq ft${l.kind === "rent" ? "/mo" : ""}${terms ? ` · ${R.fmt(terms.upfront)} down and closing, then ${R.fmt(terms.monthly)}/mo` : ""} · ${Math.round(d)} m` })),
          h("td", { textContent: l.kind === "sale" ? R.fmt(l.price) : `${R.fmt(l.price)}/mo` }),
          h("td", {}, h("button", { textContent: "Go", onclick: () => ctx.goTo?.(l.x, l.z) }),
            l.kind === "sale" ? h("span", {}, h("button", { className: "primary", textContent: "Mortgage", onclick: () => say(send("buy_home", { listing: l, mortgage: true }), (r) => `Bought for ${R.fmt(r.price)}: ${R.fmt(r.terms.monthly)} a month on the mortgage. It is your home now.`) }),
              h("button", { textContent: "Outright", onclick: () => say(send("buy_home", { listing: l, mortgage: false }), (r) => `Bought outright for ${R.fmt(r.price)}. It is your home now.`) }))
              : h("button", { className: "primary", textContent: "Rent", onclick: () => say(send("rent_home", { listing: l }), (r) => `Rented at ${R.fmt(r.rent)} a month (a ${R.fmt(r.deposit)} deposit). It is your home now.`) })));
      });
      const mine = [...w.registry.owned(p.account, "home")].map((a) => h("div", {}, `${address(a.attrs.address) || "Your home"}${a.attrs.label ? " " + a.attrs.label : ""} `, act("Sell", () => send("sell_home", { home: a.id }))));
      side.el.replaceChildren(title, status, tabs,
        h("p", { className: "note", textContent: `${all.length} of the district's homes are on the market this week (${all.filter((l) => l.kind === "sale").length} for sale, ${all.filter((l) => l.kind === "rent").length} to rent, in ${units} residential buildings) — the real market's share of each kind, priced by the square foot for the neighbourhood. Red and blue signs out front.` }),
        rows.length ? h("table", { className: "wares" }, ...rows) : h("p", { className: "note", textContent: "Nothing of that kind listed this week." }),
        mine.length || p.lease ? h("h4", { textContent: "Yours" }) : "", ...mine, p.lease ? h("div", {}, `Renting at ${R.fmt(p.lease.rent)}/mo `, act("Give notice and move out", () => send("end_lease"))) : "");
      return;
    }
    // The controls.
    const keys = [["Arrows", "walk; at the wheel, drive"], ["Shift (hold)", "sprint, while stamina lasts"], ["Click", "go there (on a bridge's deck, onto the deck)"],
      ["PageUp / PageDown", "the level above or below where you stand"], ["B", "go into the shop beside you; inside, the counter"], ["Esc", "close a window; inside a shop, leave"], ["G", "pick up what lies at your feet"],
      ["I", "your things: hands, bag, vehicles, homes, money — hold, eat, use, wear, put down, give"], ["X", "strike what is in front of you, with what is in your hands"],
      ["C", "get in or out of your car (parking where you stop), or ride with a party member"], ["T", "at a stop, board the bus standing there; on board, ask for the next stop; elsewhere, call a taxi"],
      ["J", "clock in or out at your job"], ["V", "do the task in front of you at work (the orange ring)"], ["K", "neighbours' errands: take one; at their door, hand it over"],
      ["D", "take a delivery gig at a shop, hand the parcel over at the address"], ["O", "homes for sale and to rent"], ["Z", "rest (in bed at home, sleep); walk on to get up"], ["H", "these controls"],
      ["F", "first person"], ["Enter", "a door: in or out"], ["S", "what is under the pointer"], ["R", "back to where you are"]];
    const bars = [["Health", "wears slowly; quickly with no stamina left. Medicine (pharmacy), a doctor's visit (clinic), a night's sleep. At 0 you faint, wake at home, and pay the ambulance."],
      ["Stamina", "runs down through the day, faster at work and sprinting; comes back at night, fastest asleep at home. Food and drink at cafés, restaurants, bars and grocers give it back. Low, you are slowed."],
      ["Strength", "fades a little each day. Workouts at a gym build it; walking, a little. It sets what you can carry."]];
    side.el.replaceChildren(h("h3", {}, h("span", { textContent: "Controls" }), close), h("table", {}, ...keys.map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", { textContent: k })), h("td", { textContent: v })))),
      h("h4", { textContent: "The bars" }), ...bars.map(([k, v]) => h("p", { className: "note" }, h("b", { textContent: `${k}: ` }), v)),
      h("p", { className: "note", textContent: "Every action is on the bar along the bottom too, for touch screens. The City panel has your money, job, car, bills, taxes and the party's measures." }));
  }
  function openPanel(force = false) {
    if (panel && force !== true) { panel.remove(); panel = null; return; }
    if (panel) { refresh(); return; }
    closeSide();
    panel = h("section", { id: "city" }); panel.setAttribute("aria-label", "The living city");
    doc.body.append(panel);
    refresh();
  }
  function refresh() {
    hud();
    drawSide();
    if (!panel) return;
    const w = view, p = w?.players.get(myId);
    const close = h("button", { textContent: "×", title: "Close", onclick: () => openPanel() });
    const head = h("h3", {}, h("span", { textContent: "The living city" }), close);
    if (!w) { panel.replaceChildren(head, h("p", { className: "note", textContent: "Waiting for the party's host to share the city…" })); return; }
    if (!p) {
      panel.replaceChildren(head,
        h("p", { className: "note", textContent: `Arrive with ${R.fmt(R.start.balance)} in Credits (a placeholder currency at par with the dollar), a rented room in the building beside you with its first week free, and no car. The people here keep their own days; the laws, taxes and tolls are the region's.` }),
        act("Join the city", () => send("join", { name: party.session?.me?.name || "You", home: nearestPlace((x) => x.use === "residential", 400) }), true));
      return;
    }
    const tabs = h("div", { className: "tabs" }, ...["you", "here", "car", "homes", "bills", "taxes", "laws", "people"].map((id) =>
      h("button", { textContent: id[0].toUpperCase() + id.slice(1), "aria-pressed": String(tab === id), onclick: () => { tab = id; refresh(); } })));
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent.toLowerCase() === tab)));
    panel.replaceChildren(head, tabs, ...TABS[tab](w, p));
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
        h("button", { className: "primary", textContent: "Open the shop (B)", onclick: () => openStore(place) }));
      const jobs = R.jobs.player_jobs.filter((r) => R.jobs.roles[r].at.some((k) => place.keys.includes(k)));
      if (jobs.length) out.push(h("h4", { textContent: "Hiring" }), h("div", {}, ...jobs.map((r) => act(`${R.jobs.roles[r].title} ${R.fmt(R.jobs.roles[r].pay)}/h`, () => send("take_job", { role: r, place })))));
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
      const out = [h("p", { className: "note", textContent: "C beside your car gets in and out; arrows drive. Tolls at the bridges' gantries, carpool and express lanes and speed cameras all charge as you drive." })];
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
        h("button", { className: "primary", textContent: "Browse the listings (O)", onclick: () => openSide("homes") })];
    },
    bills(w, p) {
      const all = [...w.billing.bills.values()].filter((b) => b.payer === p.account).slice(-20).reverse();
      if (!all.length) return [h("p", { className: "note", textContent: "No bills. Tolls without FasTrak, lane violations, speed camera and parking notices, rent and property tax come here, each with its due date; unpaid, a notice adds its penalty." })];
      return all.map((b) => h("div", { style: "border-top:1px solid rgba(128,128,128,.25);padding:4px 0" },
        h("b", { textContent: `${b.memo || b.kind}` }), h("div", { className: "note", textContent: `${b.kind.replace(/_/g, " ")} · ${R.fmt(b.owed)}${b.stage ? ` (notice ${b.stage + 1})` : ""} · ${b.status === "open" ? "due " + new Date(b.due).toLocaleDateString() : b.status}${b.hearing ? " · hearing " + new Date(b.hearing).toLocaleDateString() : ""}${b.reason ? " · " + b.reason : ""}` }),
        b.status === "open" ? h("div", {}, act("Pay", () => send("pay_bill", { bill: b.id }), true), ["speed_camera", "hov_violation", "theft", "parking", "toll_evasion"].includes(b.kind) && !b.hearing ? act("Contest", () => send("contest", { bill: b.id })) : null) : null));
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
  refresh();

  // The multiplayer session's hooks: what this walker's car is, and drawing the others'.
  return {
    rules: R, tick, drive, get driving() { return car.active; }, get riding() { return car.riding || transit.ride; }, get inside() { return Boolean(shop.place); }, walkInside, openPanel, joinParty, leaveParty,
    enterShop, leaveShop, callTaxi, objects: () => ctx.objects?.(), taskKey, errandKey, strikeKey, listings: () => listings(), routeBuses: () => routeBuses, taxi: () => ({ ...taxi, route: undefined }), stops: () => district.stops || [],
    walkFactor: walkFactorNow, walked, actions: () => actionsHere().map((a) => ({ id: a.id, label: a.label, key: a.key })), openStore, openSide, shopKey, pickUp, board, things: () => thingsNear(me().x, me().z, 60),
    carState() {
      if (car.active) return { model: car.model, colour: R.vehicles.models[car.model].colour, driving: true, riding: null, plate: car.plate, city: myId, seats: R.vehicles.models[car.model].seats };
      if (car.riding) return { model: "economy", colour: "#888888", driving: false, riding: car.riding, plate: "", city: myId, seats: 5 };
      return null;
    },
    placePeerCar, carChanged: () => {}, world: () => world, view: () => view, district, visible: () => visible, me: myId,
    water: (cls, at) => waterProperties(R, cls, at), send,
  };
}
