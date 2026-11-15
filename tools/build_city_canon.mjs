// Write the city server's canonical record of the district: every place a command may name,
// with the position, size and use the SERVER holds for it (server/city/canon.mjs reads it).
//
//     node tools/build_city_canon.mjs <district.json> [server/city/canon/marina.json]
//
// <district.json> is the page's own district, dumped from the running City:
//
//     JSON.stringify((() => { const d = kerbsideCity().district;
//       return { key: d.key, county: d.county, places: d.places.map((p) => ({ ...p, keys: [...p.keys] })) }; })())
//
// A client names a place by its id and nothing else counts: what a building measures, where it
// stands and what it is are read from this file, never from the command. Run it again whenever
// the district's buildings change (a place the file does not know is refused by the server).
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output = new URL("../server/city/canon/marina.json", import.meta.url).pathname] = process.argv;

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

export function buildCanon(district) {
  const seen = new Set(), places = [];
  for (const p of district.places || []) {
    const id = String(p.id);
    if (seen.has(id) || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
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
    bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)].map((v) => Math.round(v)), places };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!input) { console.error("usage: node tools/build_city_canon.mjs <district.json> [out.json]"); process.exit(2); }
  const canon = buildCanon(JSON.parse(readFileSync(input, "utf8")));
  writeFileSync(output, `${JSON.stringify(canon)}\n`);
  console.log(`${canon.places.length} places; projection within ${canon.projection_error_m} m; ${output}`);
}
