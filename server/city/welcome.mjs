// Testing packages are assigned by private SQL account slots, never by a client request.
import { licencesFor } from "../../docs/city/enterprise.mjs";

const EXTRA_RESTAURANTS = ["272545793", "272610350", "272616974", "272598450"];

export function applyWelcome(world, canon, srv, session, offer) {
  if (!session.aid || offer?.account_id !== session.aid || ![1, 2, 3].includes(offer.slot)
      || offer.credit_cents !== 100000000) throw Error("Invalid account starter entitlement");
  const pid = session.pid, p = world.player(pid), grant = `welcome:${session.aid}`;
  if (p.grants?.includes(grant)) throw Error("The starter package is already in this world");

  const free = (id) => {
    const place = canon.places.get(id), asset = world.registry.assets.get(`building:${id}`),
      business = world.registry.assets.get(`biz:${id}`);
    return place?.use === "restaurant" && place.area >= 50 && place.area <= 180
      && !world.bizAt(id) && !world.storefronts.has(id)
      && (!asset || asset.owner === p.account) && (!business || business.owner === p.account);
  };
  const id = [offer.restaurant_id, ...EXTRA_RESTAURANTS].find(free);
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
