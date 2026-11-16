import {pointDistance} from './surface-edit.mjs';
// Reuse Kerbside's rendered storefront apertures; translate coordinates, never invent a layout.
export function windowsFromStorefront(plan,{planOrigin,origin,footprint,baseElevation=0,height}){
 const ring=footprint.coordinates[0],windows=[];
 for(const facade of plan?.facades||[]){const dx=facade.b[0]-facade.a[0],dy=facade.b[1]-facade.a[1],L=Math.hypot(dx,dy);if(!L)continue;const at=u=>[planOrigin[0]+facade.a[0]+dx/L*u-origin[0],planOrigin[1]+facade.a[1]+dy/L*u-origin[1]];
  for(const o of facade.openings||[]){if(o.kind!=='window'||![o.u,o.v,o.w,o.h].every(Number.isFinite))continue;const p=at(o.u),q=at(o.u+o.w),v=o.v+baseElevation;if(v<0||v+o.h>height+.01)continue;
   for(let edge=0;edge<ring.length-1;edge++){const a=ring[edge],b=ring[edge+1];if(pointDistance(p,a,b)>.06||pointDistance(q,a,b)>.06)continue;const ex=b[0]-a[0],ey=b[1]-a[1],len=Math.hypot(ex,ey),project=p=>((p[0]-a[0])*ex+(p[1]-a[1])*ey)/len,u=Math.min(project(p),project(q));windows.push({id:o.id,kind:'window',edge,u,v,w:o.w,h:o.h,design:o.design||{vertical_bars:o.w>1.5?[.5]:[],horizontal_bars:[]},grade:'inferred',measured:false,confidence:.25,source:'Kerbside storefront exterior'});break;}
  }
 }return windows;
}
