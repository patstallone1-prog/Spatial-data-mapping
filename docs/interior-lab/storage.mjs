// Browser-local designs, keyed by world, resident and building. Nothing here publishes a map fact.
import { createDraft, exportOverride, validateHouse } from './model.mjs';

export const PREFIX = 'kerbside:interior-lab:';
export const APPLIED_EVENT = 'kerbside:interior-applied';
const copy = value => structuredClone(value);
const store = options => options?.storage || globalThis.localStorage;
function write(key, value, options) {
  const json = JSON.stringify(value);
  if (json.length > 4_000_000) throw new Error('This design is too large for browser storage. Export a copy before simplifying it.');
  try { store(options).setItem(key, json); }
  catch { throw new Error('Could not save this design. Browser storage is full or unavailable; export a copy to keep your work.'); }
}
function read(key, options) {
  const raw = store(options)?.getItem(key);
  if (!raw) return null;
  if (raw.length > 4_000_000) throw new Error('Saved design exceeds the supported size.');
  try { return JSON.parse(raw); } catch { throw new Error('This saved design is damaged. Restore a backup or reset its draft.'); }
}
export function checkedTarget(value) {
  if (!value || typeof value.buildingId !== 'string' || !value.buildingId || value.buildingId.length > 160
      || typeof value.account !== 'string' || !value.account.startsWith('player:')
      || typeof value.worldKey !== 'string' || !value.worldKey || value.worldKey.length > 300) throw new Error('Open the editor from a home you own in Kerbside.');
  return { buildingId: value.buildingId, account: value.account, worldKey: value.worldKey, homeId: String(value.homeId || ''),
    unitId: value.unitId == null ? null : String(value.unitId), label: String(value.label || 'Your home').slice(0, 200) };
}
function targetKey(target) {
  const t = checkedTarget(target);
  return [t.worldKey, t.account, t.buildingId, t.homeId, t.unitId || '*'].map(encodeURIComponent).join(':');
}
export function overrideKey(target) { return `${PREFIX}applied:${targetKey(target)}`; }
export function draftKey(value) {
  return value?.target ? `home:${targetKey(value.target)}` : `practice:${String(value?.id || '')}`;
}
// Include source layout/geometry/assets, but exclude run diagnostics/timestamps from the fingerprint.
export function fingerprint(house) {
  const text = JSON.stringify({ id: house.id, schema: house.schema, units: house.units, storeys: house.storeys,
    stairs: house.stairs || [], ramps: house.ramps || [], residential_units: house.residential_units || [], envelope: house.envelope, roof: house.roof, total_height_m: house.total_height_m, style: house.style });
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${text.length}`;
}
export function createHandoff(house, target, options = {}) {
  createDraft(house, { unitId: target.unitId }); // validate source schema, preserving the actual plan
  const token = options.token || globalThis.crypto.randomUUID();
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(token)) throw new Error('Invalid editor session.');
  const handoff = { schema: 'kerbside.interior_handoff/1', token, target: checkedTarget(target),
    house: copy(house), fingerprint: fingerprint(house), createdAt: options.now ?? Date.now() };
  write(`${PREFIX}handoff:${token}`, handoff, options);
  return handoff;
}
export function loadHandoff(options = {}) {
  const token = options.token ?? new URLSearchParams(globalThis.location?.search || '').get('edit');
  if (!token) return null;
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(token)) throw new Error('Invalid editor session. Open your home again from Kerbside.');
  const h = read(`${PREFIX}handoff:${token}`, options);
  if (!h || h.schema !== 'kerbside.interior_handoff/1' || h.token !== token || h.fingerprint !== fingerprint(h.house)) throw new Error('This editor session is missing or outdated. Open your home again from Kerbside.');
  checkedTarget(h.target);
  return h;
}
export function saveDraft(key, draft, options = {}) {
  write(`${PREFIX}draft:${key}`, { schema: 'kerbside.interior_draft/1', fingerprint: fingerprint(draft.original), draft: { ...draft, past: [], future: [] }, savedAt: Date.now() }, options);
}
export function loadDraft(key, options = {}) {
  const value = read(`${PREFIX}draft:${key}`, options);
  if (!value) return null;
  if (value.schema !== 'kerbside.interior_draft/1' || !value.draft?.original || value.fingerprint !== fingerprint(value.draft.original)) throw new Error('The saved draft is invalid. Export a backup, then reset it.');
  return value.draft;
}
export function removeDraft(key, options = {}) { store(options).removeItem(`${PREFIX}draft:${key}`); }
export function readOverride(target, options = {}) {
  const value = read(overrideKey(target), options);
  if (!value) return null;
  if (value.schema !== 'kerbside.interior_override/1' || targetKey(value.target) !== targetKey(target)) throw new Error('This interior belongs to a different home or world.');
  return value;
}
export function applyToWorld(handoff, draft, options = {}) {
  if (!handoff || handoff.schema !== 'kerbside.interior_handoff/1') throw new Error('Practice designs cannot change a world home.');
  const trusted = loadHandoff({ ...options, token: handoff.token });
  if (targetKey(trusted.target) !== targetKey(handoff.target) || fingerprint(draft.original) !== trusted.fingerprint || draft.unitId !== trusted.target.unitId) throw new Error('The source home changed. Reopen it before applying this design.');
  const result = exportOverride(draft);
  const check = validateHouse(result.house, { baseline: trusted.house, editableUnitId: trusted.target.unitId });
  if (!check.valid) { const e = new Error('This layout does not pass the home’s geometry checks.'); e.issues = check.issues; throw e; }
  const saved = { ...result, target: trusted.target, baselineFingerprint: trusted.fingerprint, appliedAt: options.now ?? Date.now(), revision: globalThis.crypto.randomUUID() };
  // Roll back a quota failure so the editor never reports failure after partly applying.
  const keys = [overrideKey(trusted.target), `${PREFIX}baseline:${targetKey(trusted.target)}`, `${PREFIX}draft:${draftKey(trusted)}`];
  const previous = keys.map(key => store(options).getItem(key));
  try {
    write(keys[0], saved, options);
    write(keys[1], trusted.house, options);
    saveDraft(draftKey(trusted), draft, options);
  } catch (error) {
    keys.forEach((key, i) => { try { if (previous[i] === null) store(options).removeItem(key); else store(options).setItem(key, previous[i]); } catch {} });
    throw error;
  }
  if (globalThis.dispatchEvent && globalThis.CustomEvent) globalThis.dispatchEvent(new CustomEvent(APPLIED_EVENT, { detail: { target: saved.target } }));
  return saved;
}
// Called again against trusted source data and CURRENT ownership in the world, not the editor's claim.
export function resolveWorldDesign(target, baseline, options = {}) {
  if (!options.canEdit?.(target)) return null;
  const saved = readOverride(target, options);
  if (!saved || saved.baselineFingerprint !== fingerprint(baseline)) return null;
  const validation = validateHouse(saved.house, { baseline, editableUnitId: target.unitId });
  if (!validation.valid) throw new Error(`Saved layout rejected: ${validation.issues[0]?.message || 'invalid geometry'}`);
  return { ...saved, house: copy(saved.house) };
}
export function savedBaseline(target, options = {}) { return read(`${PREFIX}baseline:${targetKey(target)}`, options); }
