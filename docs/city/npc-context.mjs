// A compact snapshot for dialogue consumers. Authored cohort stories and generated voice/hobbies
// are creative material; finance, history and journeys come only from the running simulation.
import { hash32 } from './people.mjs';
import { ROLE_FAMILY } from './npc-economy.mjs';
import { selectNpcStory, npcTone, npcHobbies } from './npc-stories.mjs';

export const NPC_CONTEXT_VERSION = 1;
const FAMILIES = ['reserved', 'warm', 'direct', 'expressive'];
const BANDS = ['negative', 'low', 'middle', 'comfortable', 'secure', 'wealthy', 'high', 'unknown'];

function snapshot(person, city, time) {
  return city?.about && time ? city.about(person, time) : {};
}
function profileOf(person, about) {
  const career = about.career;
  const occupation = person.visitor ? 'visitor' : person.infant ? 'child'
    : career && career.status !== 'employed' ? career.status
    : ROLE_FAMILY[career?.role || person.role] || 'unknown';
  // Money is in the rules' minor units. Unknown is distinct from a zero balance.
  const balance = about.books?.balance;
  const wealthBand = !Number.isFinite(balance) ? 'unknown' : balance < 0 ? 'negative'
    : balance < 100000 ? 'low' : balance < 1000000 ? 'middle' : balance < 5000000 ? 'comfortable' : balance < 25000000 ? 'secure' : balance < 100000000 ? 'wealthy' : 'high';
  return { occupation, jobRole: career?.status === 'employed' ? career.role : occupation, wealthBand, toneFamily: FAMILIES[hash32(person.id, 'tone-family') % FAMILIES.length] };
}
function distance(a, b) {
  const wealth = a.wealthBand === b.wealthBand ? 0 : a.wealthBand === 'unknown' || b.wealthBand === 'unknown' ? 4 : Math.abs(BANDS.indexOf(a.wealthBand) - BANDS.indexOf(b.wealthBand));
  return (a.occupation === b.occupation ? 0 : 20) + (a.jobRole === b.jobRole ? 0 : 8) + wealth * 3 + (a.toneFamily === b.toneFamily ? 0 : 1);
}
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function majority(profiles, field) {
  const counts = new Map();
  for (const p of profiles) counts.set(p[field], (counts.get(p[field]) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0][0];
}
const signature = (p) => `${p.occupation}|${p.wealthBand}|${p.jobRole || ''}`;
function compatible(saved, current) {
  if (!saved) return true; // Old saves have no profile signatures.
  const [occupation, band, jobRole] = saved.split('|');
  if (jobRole && jobRole !== current.jobRole) return false;
  if (occupation !== current.occupation) return false;
  if (band === current.wealthBand) return true;
  if (band === 'unknown' || current.wealthBand === 'unknown') return false;
  return Math.abs(BANDS.indexOf(band) - BANDS.indexOf(current.wealthBand)) <= 1;
}
function finishGroup(id, entries, old = null, absent = []) {
  const memberIds = [...entries.map((e) => e.person.id), ...absent].sort(compare);
  if (!entries.length) return { ...old, memberIds };
  const signatures = Object.fromEntries(absent.filter((id) => old?.signatures?.[id]).map((id) => [id, old.signatures[id]]));
  for (const e of entries) signatures[e.person.id] = old?.signatures?.[e.person.id] || signature(e.profile);
  const profile = Object.fromEntries(['occupation', 'jobRole', 'wealthBand', 'toneFamily'].map((field) => [field, majority(entries.map((e) => e.profile), field)]));
  // Keep the text of a persisted cohort: adding a member does not rewrite its shared history.
  return { id, memberIds, profile, signatures, transitions: { ...(old?.transitions || {}) }, backstory: old?.backstory || selectNpcStory(profile, id).backstory, undersized: memberIds.length < 8 };
}

// Pass previousGroups back when a roster grows. Existing members and IDs stay put; new people
// fill the closest cohort with room. A population under eight is explicitly marked undersized.
// Prepare snapshots in idle chunks if a roster is large; grouping never calls the city again
// when entries are supplied. Refresh snapshots when the simulation day or roster changes.
export function prepareNpcProfile(person, city, time) {
  return { person, profile: profileOf(person, snapshot(person, city, time)) };
}
export function groupNpcs({ people = [], entries = null, city, time, previousGroups = [] }) {
  const all = (entries || [...people].map((person) => prepareNpcProfile(person, city, time)))
    .slice().sort((a, b) => compare(a.person.id, b.person.id));
  if (new Set(all.map((e) => e.person.id)).size !== all.length) throw new Error('NPC IDs must be unique');
  const remaining = new Map(all.map((e) => [e.person.id, e]));
  const allIds = new Set(remaining.keys());
  const groups = [], vacancies = new Map(), moved = new Map();
  const keyOf = (p) => [p.occupation, p.jobRole, p.wealthBand, p.toneFamily].join('|');
  for (const old of [...previousGroups].sort((a, b) => compare(a.id, b.id))) {
    const members = [], absent = [];
    for (const id of old.memberIds) {
      const entry = remaining.get(id);
      if (!entry) { if (!allIds.has(id)) absent.push(id); continue; }
      if (!compatible(old.signatures?.[id], entry.profile)) { moved.set(id, old.id); continue; }
      members.push(entry); remaining.delete(id);
    }
    if (members.length + absent.length > 12) throw new Error('Previous group exceeds 12 members');
    if (!members.length && !absent.length) continue;
    const item = { old, members, absent };
    groups.push(item);
    if (members.length + absent.length < 12) {
      const key = keyOf(old.profile);
      if (!vacancies.has(key)) vacancies.set(key, { profile: old.profile, groups: [], next: 0 });
      vacancies.get(key).groups.push(item);
    }
  }
  // The number of profile bins is bounded by the fixed occupation/band/tone vocabulary.
  for (const entry of [...remaining.values()]) {
    let best = null;
    for (const bin of vacancies.values()) {
      while (bin.next < bin.groups.length && bin.groups[bin.next].members.length + bin.groups[bin.next].absent.length >= 12) bin.next++;
      if (bin.next === bin.groups.length) continue;
      const score = distance(entry.profile, bin.profile), candidate = bin.groups[bin.next];
      if (candidate.old.id === moved.get(entry.person.id) || !compatible(signature(bin.profile), entry.profile)) continue;
      if (!best || score < best.score || (score === best.score && compare(candidate.old.id, best.group.old.id) < 0)) best = { score, group: candidate };
    }
    if (!best) break;
    best.group.members.push(entry); remaining.delete(entry.person.id);
  }
  const byOccupation = new Map();
  for (const entry of remaining.values()) {
    const occupation = `${entry.profile.occupation}|${entry.profile.jobRole}`;
    if (!byOccupation.has(occupation)) byOccupation.set(occupation, []);
    byOccupation.get(occupation).push(entry);
  }
  const leftovers = [];
  function partition(list) {
    list.sort((a, b) => compare(a.profile.occupation,b.profile.occupation) || compare(a.profile.jobRole,b.profile.jobRole) || BANDS.indexOf(a.profile.wealthBand) - BANDS.indexOf(b.profile.wealthBand)
      || compare(a.profile.toneFamily, b.profile.toneFamily) || compare(a.person.id, b.person.id));
    const count = Math.ceil(list.length / 12);
    for (let i = 0, offset = 0; i < count; i++) {
      const left = list.length - offset;
      const size = left >= 13 && left <= 15 && count - i === 2 ? 8 : Math.ceil(left / (count - i));
      const members = list.slice(offset, offset + size); offset += size;
      const id = `cohort:${hash32(...members.map((e) => `${e.person.id}|${signature(e.profile)}`).sort(compare)).toString(36)}:${members[0].person.id}`;
      groups.push({ old: { id }, members, absent: [] });
    }
  }
  for (const [, list] of [...byOccupation].sort((a, b) => compare(a[0], b[0]))) {
    // 13–15 cannot be divided into groups of 8–12; pool them with other leftovers.
    if (list.length < 8 || (list.length > 12 && list.length < 16)) leftovers.push(...list);
    else partition(list);
  }
  // Borrow one newly made cohort when that makes a 13–15 remainder partitionable.
  // Persisted cohorts remain untouched.
  while (leftovers.length > 0 && (leftovers.length < 8 || (leftovers.length >= 13 && leftovers.length <= 15))) {
    const i = groups.findIndex((g) => !g.old.memberIds && g.members.length >= 8);
    if (i < 0) break;
    leftovers.push(...groups.splice(i, 1)[0].members);
  }
  if (leftovers.length) partition(leftovers);
  const result = groups.map(({ old, members, absent }) => finishGroup(old.id, members, old, absent));
  for (const group of result) {
    group.transitions ??= {};
    const members = new Set(group.memberIds);
    for (const id of Object.keys(group.transitions)) if (!members.has(id) || group.transitions[id]?.to !== group.id) delete group.transitions[id];
    for (const id of group.memberIds) if (moved.has(id)) group.transitions[id] = { from: moved.get(id), to: group.id, reason: 'profile_changed' };
  }
  return result;
}

// `world` is optional: null debt/history means the corresponding runtime source is unavailable.
// Route legs are the actual plan's go segments, not inferred from habitual travel preferences.
export function buildNpcContext({ person, city, world, time, groups = [], group: selectedGroup = undefined }) {
  if (!person?.id) throw new Error('A person with an ID is required');
  const about = snapshot(person, city, time);
  const profile = profileOf(person, about);
  const group = selectedGroup === undefined ? groups.find((g) => g.memberIds.includes(person.id)) || null : selectedGroup;
  const plan = city?.planOf && time ? city.planOf(person, time) : null;
  const harm = world?.harm?.get(person.id);
  const owed = world?.billing?.owed;
  const ageBand = person.age == null ? 'unknown' : person.age < 5 ? 'child' : person.age < 18 ? 'youth' : 'adult';
  const creativeProfile = { ...profile, ageBand, age: person.age };
  return {
    version: NPC_CONTEXT_VERSION,
    identity: { id: person.id, name: person.name ?? null, age: person.age ?? null, visitor: Boolean(person.visitor) },
    tone: { family: profile.toneFamily, variation: npcTone(creativeProfile, person.id), source: 'authored' },
    group: group ? { id: group.id, backstory: group.backstory, source: 'authored', undersized: group.undersized, transition: group.transitions?.[person.id] ?? null } : null,
    finances: { currency: city?.R?.currency?.code || 'KCR', unit: 'minor_units', balance: about.books?.balance ?? null, balanceState: about.books?.balance == null ? 'unavailable' : 'current', books: about.books ?? null,
      debt: typeof owed === 'function' ? owed.call(world.billing, person.id) : null },
    history: { career: about.career?.history ?? null, incidents: harm?.history ? harm.history.slice(-8) : world?.harm ? [] : null },
    job: about.career ?? (person.title || person.role ? { role: person.role ?? null, title: person.title ?? null, status: person.visitor ? 'visitor' : person.infant ? 'child' : 'unknown' } : null),
    hobbies: { values: npcHobbies(creativeProfile, person.id), source: 'authored' },
    travel: { preferred: about.travel ?? (person.visitor && person.car ? 'drive' : null), milestones: about.milestones ?? null,
      routes: plan ? plan.segs.filter((s) => s.kind === 'go').map((s) => ({ mode: s.mode ?? null, from: s.from ?? s.fromXZ ?? null, to: s.to ?? s.toXZ ?? null, start: s.t0, end: s.t1 })) : null },
  };
}

// Grouping is a background job. A new roster/day supersedes an older in-flight build;
// callers may retry when ensure returns false. The installed index is swapped atomically.
export class NpcContextIndex {
  constructor(city) {
    this.city = city;
    this.groups = Array.isArray(city.roster.saved?.npcGroups) ? city.roster.saved.npcGroups : [];
    this.byPerson = new Map();
    this.key = null;
    this.pending = null;
  }
  rosterKey(time) {
    const roster = this.city.roster;
    return `${roster.version}|${roster.people.size}|${roster.visitors.size}|${time.day}`;
  }
  ensure(time, { chunkSize = 25, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
    if (!time || !Number.isFinite(time.day)) throw new Error('A simulation time with a day is required');
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('chunkSize must be a positive integer');
    const key = this.rosterKey(time);
    if (this.key === key) return Promise.resolve(true);
    if (this.pending?.key === key) return this.pending.promise;
    const roster = this.city.roster;
    const people = [...roster.people.values(), ...roster.visitors.values()];
    const token = {};
    const run = async () => {
      const entries = [];
      for (let i = 0; i < people.length; i++) {
        entries.push(prepareNpcProfile(people[i], this.city, time));
        if ((i + 1) % chunkSize === 0 && i + 1 < people.length) {
          await yieldControl();
          if (this.pending?.token !== token || this.rosterKey(time) !== key) return false;
        }
      }
      if (this.pending?.token !== token || this.rosterKey(time) !== key) return false;
      const groups = groupNpcs({ entries, previousGroups: this.groups });
      const byPerson = new Map();
      for (const group of groups) for (const id of group.memberIds) byPerson.set(id, group);
      this.groups = groups; this.byPerson = byPerson; this.key = key;
      if (roster.saved) { roster.saved.npcGroups = groups; roster.dirty = true; }
      return true;
    };
    // Schedule even a small build after pending is installed, so token validation is correct.
    const promise = Promise.resolve().then(run).finally(() => {
      if (this.pending?.token === token) this.pending = null;
    });
    this.pending = { key, token, promise };
    return promise;
  }
  contextFor(person, time, world = null) {
    return buildNpcContext({ person, city: this.city, world, time, group: this.byPerson.get(person.id) || null });
  }
}
