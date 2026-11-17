// Who you know: the people of the city you have dealt with, what each is to you, and the few
// words you write about yourself.
//
// * ``meet`` notes a conversation with one of the city's people. How many there have been is what
//   they are to you: a stranger at first, an acquaintance, a familiar face, then a friend.
// * ``relationships(pid)`` gathers everyone a player has some tie to, from the world's own
//   records: other players who are friends, an employer, the staff of a business of theirs, a
//   lawyer on a case, the banker a loan was written by, and the people met in the street.
// * ``relationTo(pid, id)`` says what one of them is to the player and who holds the cards, for
//   the voices of the city (server/npc): a character speaks differently to a stranger, a regular
//   and their own boss.
// * ``set_backstory`` keeps a player's own account of themselves: shown to other players, and
//   never given to the model that voices the city's people.
//
// Installed on CityWorld's prototype (installSocial, from world.mjs).

export const SOCIAL_COMMANDS = ["meet", "set_backstory"];
export const BACKSTORY_MAX = 600, PEOPLE_KEPT = 80;
//: Conversations to each standing with someone met in the street.
export const STANDING = [[10, "friend"], [4, "familiar face"], [1, "acquaintance"], [0, "stranger"]];
export const standingOf = (talks) => STANDING.find(([n]) => (talks || 0) >= n)[1];
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

//: How each kind of tie sits: who decides, in a line the model can act on.
const DYNAMICS = {
  stranger: "You have never spoken before. Be civil and a little guarded, as with anyone new.",
  acquaintance: "You have spoken once or twice. You recognise them.",
  "familiar face": "You have talked several times. You are easy with each other.",
  friend: "You have talked many times and count them a friend. Be open and warm.",
  employee: "You work for them: they are your employer and decide your pay and your shifts. Be respectful; you may still speak your mind.",
  employer: "They work for you: you are their boss and decide their pay and shifts. Be fair and direct.",
  client: "They are your client and pay for your work. You advise; they decide.",
  customer: "They are a customer. You serve them; you owe them courtesy, not obedience.",
  borrower: "They are a customer of the bank and you decide nothing yourself: the bank's rules do. Be helpful and exact.",
};

export function installSocial(CityWorld, CityError) {
  const W = CityWorld.prototype, fail = (m) => { throw new CityError(m); };

  //: A conversation with one of the city's people: who they are is theirs to say (a name and a
  //: title); how often you have talked is the world's.
  W.cmd_meet = function (pid, { id, name = null, title = null }) {
    const p = this.player(pid), key = clip(id, 80);
    if (!key) fail("who?");
    const all = (p.people ||= {});
    const was = all[key];
    // One conversation a game hour counts: a hundred hellos in a minute are not a friendship.
    if (was && this.now - was.last < 3_600_000) { was.name = clip(name, 60) || was.name; return { person: was, standing: standingOf(was.talks) }; }
    const e = was || { id: key, name: clip(name, 60) || "Someone", title: clip(title, 60) || null, talks: 0, first: this.now, last: this.now };
    e.talks += 1; e.last = this.now; e.name = clip(name, 60) || e.name; e.title = clip(title, 60) || e.title;
    all[key] = e;
    const keys = Object.keys(all);
    if (keys.length > PEOPLE_KEPT) delete all[keys.sort((a, b) => all[a].last - all[b].last)[0]];
    return { person: e, standing: standingOf(e.talks) };
  };
  W.cmd_set_backstory = function (pid, { text = "" }) {
    const p = this.player(pid);
    p.backstory = clip(text, BACKSTORY_MAX);
    return { backstory: p.backstory };
  };

  //: Everyone ``pid`` has a tie to: [{id, name, kind: "player" | "resident", relation, detail, since}].
  W.relationships = function (pid) {
    const p = this.player(pid), out = [];
    const add = (x) => out.push(x);
    const mail = this.mail || {};
    for (const other of this.players.values()) {
      if (other.id === pid) continue;
      const friends = (mail.friends?.[pid] || []).includes(other.id);
      if (friends) add({ id: other.id, name: other.name, kind: "player", relation: "friend", detail: other.backstory || null, since: null });
    }
    if (p.job) {
      const b = p.job.business ? this.biz?.get(p.job.business) : null, boss = b ? this.players.get(b.owner_pid) : null;
      add({ id: boss ? boss.id : `boss:${p.job.place?.id ?? ""}`, name: boss ? boss.name : `The manager at ${p.job.place?.name || "your workplace"}`, kind: boss ? "player" : "resident",
        relation: "your boss", detail: `${p.job.title}, ${this.R.fmt(p.job.pay)} an hour`, since: p.job.since ?? null });
    }
    for (const b of this.biz?.values() || []) {
      if (b.owner !== p.account || b.status !== "open") continue;
      for (const s of b.staff || []) add({ id: s.player || s.id, name: s.name, kind: s.player ? "player" : "resident", relation: "your employee", detail: `${s.title || s.role} at ${b.name}, ${this.R.fmt(s.wage)} an hour`, since: s.hired ?? null });
    }
    for (const c of this.cases?.values() || []) if (c.pid === pid && !c.closed && c.lawyer) add({ id: c.lawyer.id, name: c.lawyer.name, kind: "resident", relation: "your lawyer", detail: c.charge.replace(/_/g, " "), since: null });
    const bankers = new Set();
    for (const l of p.loans || []) if (l.banker && l.status === "open" && !bankers.has(l.banker)) { bankers.add(l.banker); add({ id: `banker:${l.banker}`, name: l.banker, kind: "resident", relation: "your banker", detail: l.name, since: l.opened }); }
    const known = new Set(out.map((x) => x.id));
    for (const e of Object.values(p.people || {}).sort((a, b) => b.last - a.last)) {
      if (known.has(e.id)) continue;
      add({ id: e.id, name: e.name, kind: "resident", relation: standingOf(e.talks), detail: `${e.title ? `${e.title} · ` : ""}talked ${e.talks} time${e.talks > 1 ? "s" : ""}`, since: e.first });
    }
    return out;
  };
  //: What the character ``id`` (in the part ``role``) is to the player, and who holds the cards:
  //: {to_you, talks, dynamic}. From the world's records only.
  W.relationTo = function (pid, id, role = "resident") {
    const p = this.players.get(pid);
    const met = p?.people?.[String(id)] || null, talks = met?.talks || 0;
    let to = standingOf(talks);
    if (role === "boss") to = "employee";
    else if (role === "lawyer") to = "client";
    else if (role === "banker") to = "borrower";
    else if (role === "shopkeeper" || role === "driver" || role === "doctor") to = "customer";
    else if ((this.relationships && p ? this.relationships(pid) : []).some((x) => x.id === String(id) && x.relation === "your employee")) to = "employer";
    return { to_you: to, talks, dynamic: DYNAMICS[to] || DYNAMICS.stranger };
  };
}
