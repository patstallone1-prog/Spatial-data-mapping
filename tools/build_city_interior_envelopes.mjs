// Server geometry from the same measured/inferred building outlines used by the city renderer.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {project} from './build_city_canon.mjs';
const canon=JSON.parse(fs.readFileSync('server/city/canon/marina.json')),wanted=new Set(canon.places.map(p=>String(p.id))),source=fs.readFileSync('docs/sf-corridor-3d.json'),data=JSON.parse(source),buildings={};
for(const w of data.ways){const id=String(w.osm_id);if(w.kind!=='building'||!wanted.has(id)||!w.points?.length)continue;const points=w.points.map(([lon,lat])=>{const[x,z]=project(canon.projection,lon,lat);return[x,-z];}),minX=Math.min(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1]));const ring=points.map(p=>p.map((v,i)=>Math.round((v-(i?minY:minX))*1e6)/1e6));if(JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1)))ring.push([...ring[0]]);buildings[id]={footprint:{type:'Polygon',coordinates:[ring]},height_m:w.height_m,window_editing_verified:w.window_editing_verified===true};}
fs.writeFileSync('server/city/canon/interiors.json',JSON.stringify({schema:'kerbside.city_interior_envelopes/1',source_sha256:crypto.createHash('sha256').update(source).digest('hex'),buildings})+'\n');console.log('Registered',Object.keys(buildings).length,'building envelopes');
