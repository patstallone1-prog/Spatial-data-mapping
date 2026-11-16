// Ownership is checked by the world's command path; renderer rechecks against its source envelope.
import {isBusiness} from './profiles.mjs';
import { validateHouse } from './model.mjs';
import { fingerprint } from './storage.mjs';
export const HOME_INTERIOR_COMMANDS = ['customize_home','customize_business'];
export function installHomeInteriors(World, CityError) {
  World.prototype.cmd_customize_business = function(pid,{business,baseline,design}) {
    const p=this.player(pid),b=this.biz.get(business),asset=this.registry.get(business),t=design?.target;
    const fail=message=>{throw new CityError(message);};
    if(!b||b.owner!==p.account||b.status!=='open'||asset?.kind!=='business'||asset.owner!==p.account)fail('Only the current business owner may change this interior.');
    if(t?.propertyKind!=='business'||t.account!==p.account||t.homeId!==business||t.buildingId!==String(b.place.id)||t.unitId||!t.worldKey||design?.schema!=='kerbside.interior_override/1')fail('This design belongs to a different business.');
    if(!baseline||!isBusiness(baseline)||baseline.residential_units?.length||design.baselineFingerprint!==fingerprint(baseline)||design.house?.id!==baseline.id||!Array.isArray(design.house?.storeys)||design.house.storeys.length>20||design.house.storeys.some(f=>!Array.isArray(f?.rooms)||!Array.isArray(f?.objects)||f.rooms.length>300||f.objects.length>1500)||JSON.stringify(design).length>2500000)fail('The source business layout changed or is too large.');
    let result;try{result=validateHouse(design.house,{baseline});}catch{fail('The original business layout is invalid.');}
    if(!result.valid)fail(result.issues[0]?.message||'The business layout is invalid.');
    this.businessInteriors.set(business,structuredClone(design));this.log('business_customized',{player:pid,business,revision:design.revision});return{business,revision:design.revision,applied:true};
  };
  World.prototype.cmd_customize_home = function(pid, {home, baseline, design}) {
    const p = this.player(pid), asset = this.registry.get(home), target = design?.target;
    const fail = message => { throw new CityError(message); };
    if (!asset || asset.kind !== 'home' || asset.owner !== p.account) fail('Only the owner may change this home’s layout.');
    if (design?.schema !== 'kerbside.interior_override/1' || target?.homeId !== home || target?.account !== p.account
        || target.buildingId !== String(asset.attrs.building) || !target.worldKey) fail('This design belongs to a different home.');
    if (!baseline || design.baselineFingerprint !== fingerprint(baseline) || design.house?.id !== baseline.id) fail('The source layout changed; reopen this home.');
    const units = baseline.residential_units || [];
    const unit = asset.attrs.interior_unit_id || (units.length === 1 ? units[0].id : null);
    if (units.length > 1 && (!unit || target.unitId !== unit)) fail('This apartment needs a verified interior unit link before its layout can be edited.');
    if (target.unitId && unit !== target.unitId) fail('This design belongs to a different apartment.');
    const floors = design.house.storeys;
    if (!Array.isArray(floors) || floors.length > 20 || floors.some(f => !f || !Array.isArray(f.rooms) || !Array.isArray(f.objects) || f.rooms.length > 300 || f.objects.length > 1500)
        || JSON.stringify(design).length > 2_500_000) fail('This design exceeds the supported home size.');
    let result;
    try { result = validateHouse(design.house, {baseline, editableUnitId: target.unitId}); }
    catch { fail('The original home layout is invalid; reopen it from the world.'); }
    if (!result.valid) fail(result.issues[0]?.message || 'The layout is invalid.');
    const saved = structuredClone(design);
    this.homeInteriors.set(home, saved);
    this.log('home_customized', {player: pid, home, building: target.buildingId, revision: design.revision});
    return {home, revision: design.revision, applied: true};
  };
}
