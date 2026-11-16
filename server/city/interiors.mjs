// Interiors are spatial hypotheses. Ownership, the outer footprint and server state are authoritative.
// The first source-layout fingerprint is pinned per property; a later edit cannot rewrite its source.
import {Refused} from './canon.mjs';
import {fingerprint} from '../../docs/interior-lab/storage.mjs';
import {validateHouse} from '../../docs/interior-lab/model.mjs';
import {EDITABLE_SCHEMAS,isBusiness} from '../../docs/interior-lab/profiles.mjs';
import {area} from '../../docs/interior-lab/surface-edit.mjs';
import clipping from '../../docs/vendor/polygon-clipping-0.15.7/index.mjs';
export const INTERIOR_COMMANDS=new Set(['customize_home','customize_business']);
export function sanitizeInterior(args){
 let text;try{text=JSON.stringify(args);}catch{throw new Refused('The interior request cannot be read.');}if(!text||Buffer.byteLength(text,'utf8')>3500000)throw new Refused('The interior request is too large.');let count=0;
 const visit=(v,depth=0)=>{if(++count>150000||depth>32)throw new Refused('The interior request is too complex.');if(typeof v==='number'&&!Number.isFinite(v))throw new Refused('Interior coordinates must be finite.');if(typeof v==='string'&&v.length>12000)throw new Refused('Interior labels are too long.');if(Array.isArray(v)){if(v.length>20000)throw new Refused('The interior lists too much.');for(const x of v)visit(x,depth+1);}else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw new Refused('Invalid interior field.');visit(x,depth+1);}};
 const clean=JSON.parse(text);visit(clean);if(!clean||typeof clean!=='object'||Array.isArray(clean))throw new Refused('Invalid interior request.');return clean;
}
function normalized(poly,origin){const points=poly?.coordinates?.[0];if(!points?.length)throw new Refused('The source building has no footprint.');const min=origin||[0,1].map(i=>Math.min(...points.map(p=>p[i])));return poly.coordinates.map(r=>r.map(p=>p.map((v,i)=>Math.round((v-min[i])*1e5)/1e5)));}
function prepareInteriorChecked(world,canon,srv,pid,command,args){
 const p=world.players.get(pid),id=command==='customize_business'?args.business:args.home,asset=world.registry.get(id),b=command==='customize_business'?world.biz.get(id):null;
 if(!p||!asset||asset.owner!==p.account||(b&&(b.owner!==p.account||b.status!=='open')))throw new Refused('Only the current owner may edit this property.');
 const building=String(b?b.place.id:asset.attrs?.building),source=args.baseline,design=args.design,geometry=canon.interiorEnvelopes?.get(building);
 if(!geometry)throw new Refused('The city needs a canonical building envelope before editing this property.');
 if(!source||!EDITABLE_SCHEMAS.has(source.schema)||!source.id||source.units!=='metres'||!Array.isArray(source.storeys)||!source.storeys.length||source.storeys.length>20||source.storeys.some(f=>!f||!Array.isArray(f.rooms)||!Array.isArray(f.objects)||f.rooms.length>300||f.objects.length>1500))throw new Refused('The source interior is invalid.');
 if(design?.target?.buildingId!==building||design.target.account!==p.account||design.target.worldKey!=='kerbside:city:server'||design.house?.id!==source.id||design.baselineFingerprint!==fingerprint(source))throw new Refused('This design does not belong to this property or city.');
 if(source.envelope?.window_editing_verified&&!geometry.window_editing_verified)throw new Refused('House windows have not been verified by the city.');
 if(command==='customize_business'&&!isBusiness(source))throw new Refused('Use this business’s own tenant layout.');
 const ground=source.storeys.reduce((a,b)=>a.elevation_m<=b.elevation_m?a:b),origin=[0,1].map(i=>Math.min(...ground.footprint.coordinates[0].map(p=>p[i]))),expected=normalized(geometry.footprint);for(const f of source.storeys){const shape=normalized(f.footprint,origin),difference=[...clipping.difference(shape,expected),...(f===ground?clipping.difference(expected,shape):[])].reduce((n,coordinates)=>n+area({type:'Polygon',coordinates}),0);if(difference>.12)throw new Refused('The interior outline differs from the city’s building footprint.');if(!Number.isFinite(f.elevation_m)||!Number.isFinite(f.height_m)||f.elevation_m<-.05||f.height_m<2||f.height_m>(geometry.height_m||60)+.5||f.elevation_m+f.height_m>(geometry.height_m||60)+.5)throw new Refused('The interior floors do not fit the city’s building height.');}
 srv.interiorSources ||= {};const key=`${id}`,known=srv.interiorSources[key];if(known&&known!==fingerprint(source))throw new Refused('The original interior source changed. Reopen from the saved city.');
 const checked=validateHouse(design.house,{baseline:source,editableUnitId:design.target.unitId});if(!checked.valid)throw new Refused(checked.issues[0]?.message||'The design failed its spatial checks.');srv.interiorSources[key]=fingerprint(source);return args;
}

export function prepareInterior(...args){try{return prepareInteriorChecked(...args);}catch(error){if(error instanceof Refused)throw error;throw new Refused('The interior source is malformed.');}}
