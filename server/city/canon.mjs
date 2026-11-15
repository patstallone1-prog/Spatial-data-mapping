// The city's own record of its places: what a command may name, and what is true of it.
//
// A client says WHICH place (its id); the server says what that place is. Every place-like thing
// in a command -- the shop you buy at, the building you buy, the home on the market, the address
// a parcel goes to -- is replaced here by the canonical record before the world sees it, so a
// price, a floor area, a position or a use is never the client's word. A place the record does
// not hold is refused. The record is built from the page's own district
// (tools/build_city_canon.mjs) and read once.
import { homeListings } from "../../docs/city/market.mjs";

export class Refused extends Error {
  constructor(message, code = "refused") { super(message); this.code = code; }
}

//: Arguments that name a place by an object with an id.
const PLACE_KEYS = new Set(["place", "building", "home", "to", "from", "places"]);
//: What of a client's place survives: how it is called on a receipt, and who it is for.
const COSMETIC = { name: 120, who: 80, label: 80 };

export class Canon {
  constructor(json, R) {
    if (json?.schema !== "kerbside.city_canon/1") throw new Error("not a city canon");
    this.R = R; this.district = json.district ?? null; this.county = json.county ?? null;
    this.projection = json.projection; this.bounds = json.bounds;
    this.places = new Map(json.places.map((p) => [String(p.id), Object.freeze({ ...p, county: p.county ?? this.county })]));
    this.tenants = json.tenants || [...this.places.values()].filter((p) => p.shops?.length && p.name).map((p) => p.name);
    this.weeks = new Map();
    const P = this.projection, det = P.xl * P.zt - P.xt * P.zl;
    this.inverse = { ll: P.zt / det, lt: -P.xt / det, tl: -P.zl / det, tt: P.xl / det };
  }
  place(id) { return this.places.get(String(id)) || null; }
  //: (x, z) on the page's map as longitude and latitude, by the server's own projection.
  lonLat(x, z) {
    const P = this.projection, I = this.inverse, dx = x - P.x0, dz = z - P.z0;
    return [P.lon0 + I.ll * dx + I.lt * dz, P.lat0 + I.tl * dx + I.tt * dz];
  }
  inBounds(x, z, margin = 900) {
    const [x0, z0, x1, z1] = this.bounds;
    return x >= x0 - margin && x <= x1 + margin && z >= z0 - margin && z <= z1 + margin;
  }
  //: The place as a command carries it (the view's placeArg), from the record.
  arg(place, given = {}) {
    const out = { id: place.id, x: place.x, z: place.z, lon: place.lon, lat: place.lat, county: place.county ?? null, name: place.name || null,
      keys: [...(place.keys || [])], use: place.use, shops: [...(place.shops || [])], area: place.area, floors: place.floors, tag: place.tag ?? null };
    if (place.chain) out.chain = place.chain;
    for (const [k, max] of Object.entries(COSMETIC)) if (typeof given[k] === "string" && given[k]) out[k] = given[k].slice(0, max);
    return out;
  }
  //: This week's homes on the market, by home id: made here, from the record.
  listings(week) {
    let byHome = this.weeks.get(week);
    if (!byHome) {
      byHome = new Map(homeListings(this.R, [...this.places.values()], { week, county: this.county }).map((l) => [l.home, { ...l, county: this.county }]));
      if (this.weeks.size > 3) this.weeks.clear();
      this.weeks.set(week, byHome);
    }
    return byHome;
  }
  //: Shops of the place's kinds within 600 m: the rivals its customers are shared with.
  rivals(place, kind = null) {
    const kinds = kind ? [`shop:${kind}`] : (place.keys || []).filter((k) => k.startsWith("shop:"));
    let n = 0;
    for (const q of this.places.values()) {
      if (q.id === place.id || Math.hypot(q.x - place.x, q.z - place.z) >= 600) continue;
      if (kinds.some((k) => (q.keys || []).includes(k))) n += 1;
    }
    return n;
  }
  //: A command's arguments with every place and listing in them made canonical. Throws Refused.
  canonical(command, args, { week }) {
    const walk = (value, key, depth) => {
      if (depth > 6) throw new Refused("that command is too deep");
      if (Array.isArray(value)) return value.map((v) => walk(v, key, depth + 1));
      if (!value || typeof value !== "object") return value;
      if (key === "listing" && ("home" in value || "kind" in value)) {
        const l = this.listings(week).get(String(value.home));
        if (!l || l.kind !== value.kind) throw new Refused("that home is not on the market");
        return { ...l };
      }
      if (PLACE_KEYS.has(key) && value.id !== undefined && value.id !== null) {
        const place = this.place(value.id);
        if (!place) throw new Refused("the city has no record of that place");
        return this.arg(place, value);
      }
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k, depth + 1);
      return out;
    };
    const out = walk(args || {}, "", 0);
    if ("rivals" in out) {
      const place = out.place?.id ? this.place(out.place.id) : null;
      out.rivals = place ? this.rivals(place, typeof out.kind === "string" ? out.kind : null) : 0;
    }
    return out;
  }
}
