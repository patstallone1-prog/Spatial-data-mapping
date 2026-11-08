// The housing market: the district's homes, their type and units, and which of them are for sale
// or to rent this week at what price -- mirroring the real market's mix and prices by square
// foot and neighbourhood (docs/city/rules.json -> housing). Pure and seeded: everyone in a party
// sees the same listings (tests/city.test.mjs).

import { jurisdictionAt, loanPayment } from "./core.mjs";
import { rng } from "./people.mjs";

//: A residential building's type: "single_family" or "apartment", from its map tag, or, untagged,
//: from its size (a small low building is a house).
export function homeType(R, tag, floors, footprintM2) {
  const H = R.housing;
  if (H.single_family_tags.includes(tag)) return "single_family";
  if (H.multi_unit_tags.includes(tag)) return "apartment";
  return floors <= 2 && footprintM2 > 0 && footprintM2 < 190 ? "single_family" : "apartment";
}
//: The neighbourhood at (lon, lat) and its prices a square foot (sale, and rent a month).
export function neighbourhoodAt(R, lon, lat, county = null) {
  const H = R.housing;
  for (const n of H.neighbourhoods) {
    const [w, s, e, nn] = n.box;
    if (lon >= w && lon <= e && lat >= s && lat <= nn) return n;
  }
  const here = jurisdictionAt(R, lon, lat, county);
  for (const id of here.chain) if (H.by_jurisdiction[id]) return { name: here.name, ...H.by_jurisdiction[id] };
  return { name: here.name, ...H.by_jurisdiction["county:san-francisco"] };
}
const bedsFor = (R, sqft) => { let b = 0; for (const [at, n] of R.housing.beds_by_sqft) if (sqft >= at) b = n; return b; };
//: A building's homes: one for a house; for a block of flats, units by its floor area, numbered
//: by floor (101, 102, ... 201, ...), each its own size.
export function unitsOf(R, place) {
  const H = R.housing;
  const floors = Math.max(1, place.floors || 1), area = Math.max(30, place.area || 80);
  const type = homeType(R, place.tag, floors, area);
  const r = rng(place.id, "units");
  if (type === "single_family") {
    const sqft = Math.round(Math.max(650, Math.min(6500, area * Math.min(floors, 3) * H.net_share * H.sqft_per_m2)) / 10) * 10;
    return [{ id: `${place.id}`, label: null, type, sqft, beds: Math.max(1, bedsFor(R, sqft)), floor: 0 }];
  }
  const total = Math.max(2, Math.round(area * floors * H.net_share / H.unit_m2));
  const perFloor = Math.max(1, Math.ceil(total / floors));
  const out = [];
  for (let k = 0; k < total; k += 1) {
    const floor = Math.floor(k / perFloor) + 1;
    const sqft = Math.round(H.unit_m2 * H.sqft_per_m2 * (0.62 + r() * 0.8) / 10) * 10;
    out.push({ id: `${place.id}:${floor * 100 + (k % perFloor) + 1}`, label: `#${floor * 100 + (k % perFloor) + 1}`, type, sqft, beds: bedsFor(R, sqft), floor });
  }
  return out;
}
//: What a home would sell for and rent at (whole currency units): its square feet at the
//: neighbourhood's price, less a square foot the bigger it is, and its own spread (condition,
//: view, light) seeded by the home.
export function homePrices(R, unit, hood) {
  const H = R.housing, r = rng(unit.id, "price");
  const [lo, hi] = H.spread;
  const spread = lo + (hi - lo) * r();
  const size = (unit.sqft / 1000) ** H.size_exponent;
  const sale = Math.round(unit.sqft * hood.sale_psf * size * spread * H.sale_type_share[unit.type] / 1000) * 1000;
  const rent = Math.round(unit.sqft * hood.rent_psf * size * spread * H.rent_type_share[unit.type] / 25) * 25;
  return { sale, rent };
}
//: This week's listings in ``places`` (residential): a seeded share of each type's homes for sale
//: or to rent, at the market's rates, with their prices in minor units.
export function homeListings(R, places, { week, county = null } = {}) {
  const H = R.housing, out = [];
  for (const place of places) {
    if (place.use !== "residential") continue;
    const hood = neighbourhoodAt(R, place.lon, place.lat, county);
    for (const unit of unitsOf(R, place)) {
      const rate = H.listing_rate[unit.type];
      const roll = rng(unit.id, "listed", week)();
      const kind = roll < rate.sale ? "sale" : roll < rate.sale + rate.rent ? "rent" : null;
      if (!kind) continue;
      const prices = homePrices(R, unit, hood);
      const whole = kind === "sale" ? prices.sale : prices.rent;
      out.push({ id: `${kind}:${unit.id}:${week}`, kind, home: unit.id, building: place.id, label: unit.label, type: unit.type, beds: unit.beds, sqft: unit.sqft,
        floor: unit.floor, price: R.money(whole), psf: Math.round(whole / unit.sqft * (kind === "rent" ? 100 : 1)) / (kind === "rent" ? 100 : 1),
        neighbourhood: hood.name, address: place.name || null, x: place.x, z: place.z, lon: place.lon, lat: place.lat });
    }
  }
  return out;
}
//: Buying with a mortgage: the down payment, closing costs, the loan and its monthly payment.
export function mortgageTerms(R, price) {
  const M = R.housing.mortgage;
  const down = Math.round(price * M.down_share), closing = Math.round(price * M.closing_share);
  const loan = price - down;
  return { price, down, closing, loan, monthly: loanPayment(loan, M.rate, M.years), rate: M.rate, years: M.years, upfront: down + closing };
}
