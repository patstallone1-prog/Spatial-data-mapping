// Testing packages are assigned by private SQL account slots, never by a client request.
import { licencesFor } from "../../docs/city/enterprise.mjs";

const EXTRA_RESTAURANTS = ["272545793", "272610350", "272616974", "272598450"];
//: Restaurants to look at as well as on the map: low restaurant buildings with their own front
//: on the street (Naan N Curry, 2499 Lombard, 2953 Baker, Equator, Balboa Cafe). The first
//: package went to 2014 Lombard Street, which the map tags a restaurant and which stands as a
//: three-storey house ("it said I own Marina Test Kitchen 1 but seemed to just be a house",
//: the owner, 2026-11-17). These are offered first; a package already given elsewhere is moved
//: to one (repairWelcome).
export const REAL_RESTAURANTS = ["272580069", "261541815", "224143252", "58524120", "272547338"];
const FOOD = /^shop:(restaurant|american|diner|mexican|japanese|chinese|thai|vietnamese|indian|korean|italian|mediterranean|seafood|pizza|cafe|deli)$/;
function freeFor(world, canon, account) {
  return (id) => {
    const place = canon.places.get(id), asset = world.registry.assets.get(`building:${id}`), business = world.registry.assets.get(`biz:${id}`);
    return Boolean(place) && (place.use === "restaurant" || (place.keys || []).some((k) => FOOD.test(k))) && place.area >= 50 && place.area <= 260
      && !world.bizAt(id) && !world.storefronts.has(id) && (!asset || asset.owner === account) && (!business || business.owner === account);
  };
}
//: A package given at a place that is not one of the real restaurants: the business is closed
//: there (its till back to its owner), the building handed back, and the same business opened
//: at a real one with its licences paid and its till put back. Returns what moved, or null.
export function repairWelcome(world, canon, srv, session) {
  const receipt = session.aid ? srv.welcomeReceipts?.[session.aid] : null;
  if (!receipt || REAL_RESTAURANTS.includes(receipt.restaurant_id)) return null;
  const p = world.players.get(session.pid), old = world.biz.get(`biz:${receipt.restaurant_id}`);
  if (!p || !old || old.owner !== p.account || old.status !== "open") return null;
  const id = REAL_RESTAURANTS.find(freeFor(world, canon, p.account));
  if (!id) return null;
  const place = canon.places.get(id), name = old.name, from = receipt.restaurant_id;
  const closed = world.submit(session.pid, "close_business", { business: old.id });
  if (!closed.ok) return null;
  world.registry.assets.delete(`building:${from}`);
  if (!world.registry.assets.has(`building:${id}`)) world.registry.register(`building:${id}`, "building", p.account, { name: place.name, area: place.area, source: "first-three-account starter" }, world.now);
  const fees = licencesFor(world.R, "restaurant", place.area).reduce((n, l) => n + l.fee, 0);
  if (fees) world.accountGrant(session.pid, `welcome:${session.aid}:licences:${id}`, fees);
  const opened = world.submit(session.pid, "register_business", { place, kind: "restaurant", name, rivals: 1 });
  if (!opened.ok) throw Error(opened.error);
  if (closed.returned > 0) world.submit(session.pid, "fund_business", { business: opened.business.id, amount: closed.returned });
  Object.assign(receipt, { restaurant_id: id, moved_from: from });
  return { restaurant: `biz:${id}`, name, place: place.name, from };
}

export function applyWelcome(world, canon, srv, session, offer) {
  if (!session.aid || offer?.account_id !== session.aid || ![1, 2, 3].includes(offer.slot)
      || offer.credit_cents !== 100000000) throw Error("Invalid account starter entitlement");
  const pid = session.pid, p = world.player(pid), grant = `welcome:${session.aid}`;
  if (p.grants?.includes(grant)) throw Error("The starter package is already in this world");

  const id = [...REAL_RESTAURANTS, offer.restaurant_id, ...EXTRA_RESTAURANTS].find(freeFor(world, canon, p.account));
  if (!id) throw Error("No small restaurant is currently available for the starter package");
  const place = canon.places.get(id);
  const fees = licencesFor(world.R, "restaurant", place.area).reduce((n, l) => n + l.fee, 0);
  world.accountGrant(pid, grant, offer.credit_cents);
  // The promised million is the net wallet addition; opening licences are covered separately.
  if (fees) world.accountGrant(pid, `${grant}:licences`, fees);
  if (!world.registry.assets.has(`building:${id}`)) {
    world.registry.register(`building:${id}`, "building", p.account,
      { name: place.name, area: place.area, source: "first-three-account starter" }, world.now);
  }
  const name = `Marina Test Kitchen ${offer.slot} ${session.aid.slice(0, 6)}`;
  const result = world.submit(pid, "register_business", { place, kind: "restaurant", name, rivals: 1 });
  if (!result.ok) throw Error(result.error);
  const receipt = { slot: offer.slot, credit_cents: offer.credit_cents, restaurant_id: id, grant_id: grant };
  srv.welcomeReceipts ||= {};
  srv.welcomeReceipts[session.aid] = receipt;
  return { ...receipt, restaurant: `biz:${id}`, name, amount: offer.credit_cents };
}
