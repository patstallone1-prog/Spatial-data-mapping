// Write the city server's canonical record of the district: every place a command may name,
// with the position, size and use the SERVER holds for it (server/city/canon.mjs reads it).
//
//     node tools/build_city_canon.mjs <district.json> [more.json ...] [--out server/city/canon/marina.json]
//
// <district.json> is the page's own district, dumped from the running page in City mode once
// the area has loaded (the fields the server reads, and the tenants' names):
//
//     JSON.stringify((() => { const d = kerbsideCity().district, names = [];
//       for (const b of d.allBuildings.values()) for (const s of b.shops || []) if (s.n) names.push(s.n);
//       const F = ["id","x","z","lon","lat","use","shops","keys","name","area","floors","tag","county","chain"];
//       return { key: d.key, county: d.county, tenants: names, places: d.places.map((p) => {
//         const o = {}; for (const k of F) if (p[k] != null) o[k] = k === "keys" ? [...p[k]] : p[k]; return o; }) }; })())
//
// Only the places of the City area are kept (CITY_AREA in src/smc/renderer/page/module/
// 30-the-living-city.js, and a margin): that is where City mode's players can be, and inside it
// every page builds the same places -- beyond it a page holds whatever it happened to pass on
// the way in. Several dumps are joined (the margin differs a little from one to the next).
//
// A client names a place by its id and nothing else counts: what a building measures, where it
// stands and what it is are read from this file, never from the command. Run it again whenever
// the district's buildings change (a place the file does not know is refused by the server).
import { readFileSync, writeFileSync } from "node:fs";

//: The City area [south, west, north, east] (module 30 CITY_AREA.bbox) and the margin kept round it (m).
export const CITY_AREA = Object.freeze({ bbox: [37.7983, -122.4478, 37.8082, -122.4310], margin_m: 200 });
export function inCityArea(p, { bbox, margin_m } = CITY_AREA) {
  const [s, w, n, e] = bbox, dLat = margin_m / 111_000, dLon = margin_m / 88_000;
  return p.lat >= s - dLat && p.lat <= n + dLat && p.lon >= w - dLon && p.lon <= e + dLon;
}

//: What the world's commands read of a place (docs/city/world.mjs, enterprise.mjs, market.mjs).
export const PLACE_FIELDS = ["id", "x", "z", "lon", "lat", "use", "shops", "keys", "name", "area", "floors", "tag", "county", "chain"];

//: lon/lat -> x/z as the page draws it: a least-squares plane through the places themselves, so
//: the server can put a position a client reports on its own map (and tell a wrong one).
export function fitProjection(places) {
  const n = places.length;
  const mean = (f) => places.reduce((s, p) => s + f(p), 0) / n;
  const lon0 = mean((p) => p.lon), lat0 = mean((p) => p.lat), x0 = mean((p) => p.x), z0 = mean((p) => p.z);
  let sll = 0, slt = 0, stt = 0, sxl = 0, sxt = 0, szl = 0, szt = 0;
  for (const p of places) {
    const l = p.lon - lon0, t = p.lat - lat0;
    sll += l * l; slt += l * t; stt += t * t;
    sxl += (p.x - x0) * l; sxt += (p.x - x0) * t; szl += (p.z - z0) * l; szt += (p.z - z0) * t;
  }
  const det = sll * stt - slt * slt;
  const solve = (sl, st) => [(sl * stt - st * slt) / det, (st * sll - sl * slt) / det];
  const [xl, xt] = solve(sxl, sxt), [zl, zt] = solve(szl, szt);
  return { lon0, lat0, x0, z0, xl, xt, zl, zt };
}
export function project(P, lon, lat) {
  const l = lon - P.lon0, t = lat - P.lat0;
  return [P.x0 + P.xl * l + P.xt * t, P.z0 + P.zl * l + P.zt * t];
}

export function buildCanon(district, area = null) {
  const seen = new Set(), places = [];
  for (const p of district.places || []) {
    const id = String(p.id);
    if (seen.has(id) || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
    if (area && !inCityArea(p, area)) continue;
    seen.add(id);
    const out = {};
    for (const k of PLACE_FIELDS) if (p[k] !== undefined && p[k] !== null) out[k] = k === "keys" ? [...p[k]] : p[k];
    out.id = id;
    places.push(out);
  }
  places.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const projection = fitProjection(places);
  let worst = 0;
  for (const p of places) { const [x, z] = project(projection, p.lon, p.lat); worst = Math.max(worst, Math.hypot(x - p.x, z - p.z)); }
  const xs = places.map((p) => p.x), zs = places.map((p) => p.z);
  return { schema: "kerbside.city_canon/1", district: district.key ?? null, county: district.county ?? null, projection,
    projection_error_m: Math.round(worst * 100) / 100,
    bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)].map((v) => Math.round(v)),
    tenants: [...new Set(district.tenants || [])].sort(), places };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), at = args.indexOf("--out");
  const output = at >= 0 ? args.splice(at, 2)[1] : new URL("../server/city/canon/marina.json", import.meta.url).pathname;
  if (!args.length) { console.error("usage: node tools/build_city_canon.mjs <district.json> [more.json ...] [--out out.json]"); process.exit(2); }
  const dumps = args.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const joined = { key: dumps[0].key ?? null, county: dumps[0].county ?? null, tenants: dumps.flatMap((d) => d.tenants || []), places: dumps.flatMap((d) => d.places || []) };
  const canon = buildCanon(joined, CITY_AREA);
  writeFileSync(output, `${JSON.stringify(canon)}\n`);
  console.log(`${canon.places.length} places, ${canon.tenants.length} tenant names; projection within ${canon.projection_error_m} m; ${output}`);
}
