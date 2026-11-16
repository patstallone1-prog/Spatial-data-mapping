import { PREFIX, APPLIED_EVENT, checkedTarget, createHandoff, draftKey, loadDraft, saveDraft, fingerprint } from './storage.mjs';
import {isBusiness} from './profiles.mjs';
import { createDraft, validateHouse } from './model.mjs';

export function targetForHome(home, house, access) {
  if(home.propertyKind==='business'&&(!isBusiness(house)||house.residential_units?.length))throw new Error('This mixed-use building needs a verified commercial tenant plan before editing.');
  if(home.propertyKind==='business')return checkedTarget({buildingId:String(home.buildingId),homeId:home.id,account:access.account,worldKey:access.worldKey,propertyKind:'business',businessKind:home.businessKind,label:home.label,unitId:null});
  const units = house.residential_units || [];
  const unitId = home.unitId || (units.length === 1 ? units[0].id : null);
  if (units.length > 1 && (!unitId || !units.some(u => u.id === unitId))) throw new Error('This apartment needs its interior unit linked before editing; other homes and shared halls are protected.');
  if (home.type === 'apartment' && !unitId && house.provenance?.source_snapshot?.ownership_scope === 'unknown_multi_unit') throw new Error('This fitted apartment has no reliable unit boundary yet.');
  return checkedTarget({ buildingId: String(home.buildingId), homeId: home.id, account: access.account, worldKey: access.worldKey, unitId, label: home.label });
}
function sameTarget(a, b) { return ['buildingId','homeId','account','worldKey','unitId','propertyKind'].every(k => (a[k]??(k==='propertyKind'?'home':null)) === (b[k]??(k==='propertyKind'?'home':null))); }
// Combine independently edited units without letting the last applied unit overwrite its neighbours.
export function composeDesigns(baseline, designs) {
  let house = structuredClone(baseline);
  for (const design of designs) {
    if (design.baselineFingerprint !== fingerprint(baseline)) continue;
    const unitId = design.target.unitId;
    const result = validateHouse(design.house, { baseline, editableUnitId: unitId });
    if (!result.valid) continue;
    if (!unitId) { house = structuredClone(design.house); continue; }
    for (const f of house.storeys) {
      const src = design.house.storeys.find(s => s.level === f.level);
      const oldIds = new Set(f.rooms.filter(r => r.unit_id === unitId).map(r => r.id));
      const newIds = new Set(src.rooms.filter(r => r.unit_id === unitId).map(r => r.id));
      const owned = id => oldIds.has(id) || newIds.has(id);
      f.rooms = [...f.rooms.filter(r => !oldIds.has(r.id)), ...structuredClone(src.rooms.filter(r => newIds.has(r.id)))];
      f.objects = [...f.objects.filter(o => !oldIds.has(o.room_id)), ...structuredClone(src.objects.filter(o => newIds.has(o.room_id)))];
      if(f.finish_regions||src.finish_regions)f.finish_regions=[...(f.finish_regions||[]).filter(r=>!oldIds.has(r.room_id)),...structuredClone((src.finish_regions||[]).filter(r=>newIds.has(r.room_id)))];
      for (const key of ['walls','openings']) {
        const privatePart = x => x.rooms?.length && x.rooms.every(owned);
        const geometry = x => JSON.stringify({...x, rooms: null, swing_into: null});
        // Shared/exterior geometry is immutable, but a merged room may change its logical reference.
        const boundary = f[key].filter(x => !privatePart(x)).map(x => {
          if (!x.rooms?.some(owned)) return x;
          const updated = src[key].find(y => geometry(y) === geometry(x));
          return updated ? structuredClone(updated) : x;
        });
        f[key] = [...boundary, ...structuredClone(src[key].filter(privatePart))];
      }
    }
    house.customization = { kind: 'user_edit', measured: false, description: 'User-created layout; not an as-built survey.' };
  }
  return house;
}

export class HomeInteriorBridge {
  constructor({ storage = globalThis.localStorage, loadBaseline, onApply, invalidate = () => {}, report = () => {}, openEditor }) {
    Object.assign(this, {storage, loadBaseline, onApply, invalidate, report, openEditor});
    this.access = {homes: [], designs: []}; this.pending = new Set(); this.revisions = new Map();
    this.listen = event => {
      if (event.type === APPLIED_EVENT || event.key?.startsWith(`${PREFIX}applied:`)) this.consumePending();
    };
    globalThis.addEventListener?.('storage', this.listen);
    globalThis.addEventListener?.(APPLIED_EVENT, this.listen);
  }
  setAccess(access) {
    const previous = this.access;
    this.access = access;
    for (const d of previous.designs || []) if (!(access.designs || []).some(n => n.target.homeId === d.target.homeId && n.revision === d.revision)) this.invalidate(d.target.buildingId);
    const next = new Map((access.designs || []).map(d => [d.target.homeId, d.revision]));
    for (const d of access.designs || []) if (this.revisions.get(d.target.homeId) !== d.revision) this.invalidate(d.target.buildingId);
    this.revisions = next;
    if (!this.scanned || this.scanActor !== `${access.worldKey}:${access.account}:${access.homes.map(h => h.id).join(',')}`) {
      this.scanned = true; this.scanActor = `${access.worldKey}:${access.account}:${access.homes.map(h => h.id).join(',')}`;
      this.consumePending();
    }
  }
  async open(homeId) {
    const home = this.access.homes.find(h => h.id === homeId);
    if (!home) throw new Error('You must own this home to edit its layout.');
    const windowHandle = this.openEditor?.(); // reserve the tab while the click still has user activation
    try {
      const baseline = await this.loadBaseline(home.buildingId);
      const target = targetForHome(home, baseline, this.access);
      const handoff = createHandoff(baseline, target, {storage: this.storage});
      const saved = (this.access.designs || []).find(d => d.target.homeId === home.id);
      if (!loadDraft(draftKey(handoff), {storage: this.storage}) && saved?.baselineFingerprint === fingerprint(baseline)) {
        const draft = createDraft(baseline, {unitId: target.unitId}); draft.house = structuredClone(saved.house);
        saveDraft(draftKey(handoff), draft, {storage: this.storage});
      }
      this.openEditor?.(handoff, windowHandle);
      return handoff;
    } catch (error) { windowHandle?.close?.(); throw error; }
  }
  receipt(revision, value) {
    try { this.storage.setItem(`${PREFIX}receipt:${revision}`, JSON.stringify(value)); }
    catch { this.report('The world received the design, but its editor status could not be saved.'); }
  }
  async consumePending() {
    const records = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (!key?.startsWith(`${PREFIX}applied:`)) continue;
        try { records.push(JSON.parse(this.storage.getItem(key))); } catch { /* damaged record cannot be applied */ }
      }
    } catch (error) { this.report(error.message); return; }
    for (const design of records) {
      const t = design?.target;
      if (!t || t.worldKey !== this.access.worldKey || t.account !== this.access.account || !this.access.homes.some(h => h.id === t.homeId)
          || this.pending.has(design.revision) || this.revisions.get(t.homeId) === design.revision) continue;
      this.pending.add(design.revision);
      try {
        const baseline = await this.loadBaseline(t.buildingId), home = this.access.homes.find(h => h.id === t.homeId);
        const current = targetForHome(home, baseline, this.access);
        if (!sameTarget(t, current) || design.baselineFingerprint !== fingerprint(baseline)) throw new Error('The home or source layout changed; reopen the editor.');
        const check = validateHouse(design.house, {baseline, editableUnitId: t.unitId});
        if (!check.valid) throw new Error(check.issues[0]?.message || 'Invalid design.');
        const result = await this.onApply({home: t.homeId, baseline, design});
        if (!result?.ok || !result.applied) throw new Error(result?.error || 'The world did not accept this design.');
        this.receipt(design.revision, {state: 'applied', revision: design.revision, at: Date.now()});
        this.access.designs = [...(this.access.designs || []).filter(d => d.target.homeId !== t.homeId), design];
        this.revisions.set(t.homeId, design.revision); this.invalidate(t.buildingId);
      } catch (error) {
        this.receipt(design.revision, {state: 'rejected', revision: design.revision, message: error.message});
        this.report(error.message);
      } finally { this.pending.delete(design.revision); }
    }
  }
  designFor(buildingId, baseline) {
    const designs = (this.access.designs || []).filter(d => d.target.worldKey === this.access.worldKey && d.target.buildingId === String(buildingId));
    return designs.length ? composeDesigns(baseline, designs) : baseline;
  }
  destroy() { globalThis.removeEventListener?.('storage', this.listen); globalThis.removeEventListener?.(APPLIED_EVENT, this.listen); }
}
