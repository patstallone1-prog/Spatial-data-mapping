import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PROGRAMS,businessKind,isBusiness} from '../docs/interior-lab/profiles.mjs';
import {businessStarter} from '../docs/interior-lab/business-starter.mjs';
import {createDraft,dispatch,validateDraft,exportOverride} from '../docs/interior-lab/model.mjs';
import {targetForHome,HomeInteriorBridge} from '../docs/interior-lab/world-bridge.mjs';
import {createHandoff,applyToWorld} from '../docs/interior-lab/storage.mjs';
import {CityWorld} from '../docs/city/world.mjs';
import {loadRules} from '../docs/city/core.mjs';
import * as THREE from '../docs/vendor/three-0.160.0/three.module.min.js';
import {buildInferredHouse} from '../docs/inferred-interiors/renderer.mjs';
import {TourWorld} from '../docs/inferred-interiors/tour-world.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const library=read('docs/interior-lab/businesses/manifest.json'),rules=read('docs/city/rules.json');
const R=loadRules(rules);
const example=kind=>read('docs/interior-lab/businesses/studio-'+kind+'.json');
const square=(a,b,c,d)=>({type:'Polygon',coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]]]});
test('every supported city and exterior business program is available as an editable practice interior',()=>{
 for(const kind of Object.keys(rules.stores.kinds))assert.ok(PROGRAMS[businessKind(kind)],kind);
 for(const kind of Object.keys(read('src/smc/exteriors/references.json').categories))assert.ok(PROGRAMS[businessKind(kind)],kind);
 for(const row of library.houses){const h=read('docs/interior-lab/businesses/'+row.file);assert.ok(isBusiness(h));let d=createDraft(h);assert.equal(validateDraft(d).valid,true,row.id);const r=h.storeys[0].rooms[0];d=dispatch(d,{type:'set-room-color',level:0,id:r.id,color:'#a4b5c6'});assert.equal(exportOverride(d).validation.passed,true,row.id);assert.deepEqual(d.house.envelope,h.envelope);}
});
test('commercial furniture can be added, moved and removed with real supporting surfaces and undoable room splits',()=>{
 let d=createDraft(example('restaurant')),f=d.house.storeys[0],table=f.objects.find(o=>o.role==='dining_table');
 assert.ok(f.objects.some(o=>o.role==='dining_chair'));
 const item={id:'custom-cup',role:'table_item',position_m:[table.position_m[0],table.position_m[1]+table.size_m[1],table.position_m[2]],size_m:[.1,.12,.1],rotation_deg:0,room_id:table.room_id,support:{kind:'object',id:table.id},asset:{id:'cup',role:'table_item',procedural:true}};
 d=dispatch(d,{type:'add-object',level:0,object:item});assert.equal(validateDraft(d).valid,true);d=dispatch(d,{type:'remove-object',level:0,id:item.id});assert.equal(d.house.storeys[0].objects.length,f.objects.length);
});
test('ramp holes survive room splits and merges; protected parking and structural supports cannot move',()=>{
 let h=example('office'),f=h.storeys[0];f.footprint=square(0,0,12,12);f.inside=structuredClone(f.footprint);const hole=square(2,2,3,3);f.slab_holes=[hole];f.rooms=[{id:'sales',kind:'sales_floor',polygon:{type:'Polygon',coordinates:[f.footprint.coordinates[0],hole.coordinates[0]]},materials:{wall:'#eeeeee'}}];f.objects=[];f.walls=[];f.openings=[{id:'entry',entrance:true,type:'double_door',width_m:1.6,rooms:['sales','outside'],segment:{type:'LineString',coordinates:[[5,0],[6.6,0]]}}];
 let d=dispatch(createDraft(h),{type:'split-room',level:0,id:'sales',axis:'x',at:7,newRoomId:'next'});assert.equal(validateDraft(d).valid,true);assert.equal(d.house.storeys[0].rooms.find(r=>r.id==='sales').polygon.coordinates.length,2);d=dispatch(d,{type:'remove-wall',level:0,index:0});assert.equal(validateDraft(d).valid,true);assert.deepEqual(d.house.storeys[0].slab_holes,[hole]);
 const parking=read('docs/inferred-stores/retail-two-parking-levels.json'),garage=parking.storeys[0].rooms[0];assert.throws(()=>dispatch(createDraft(parking),{type:'set-room-kind',level:0,id:garage.id,kind:'dining'}),/protected/);
 const column=parking.storeys[0].objects.find(o=>o.role==='structural_column');assert.ok(column);assert.throws(()=>dispatch(createDraft(parking),{type:'remove-object',level:0,id:column.id}),/protected/);
});
test('the original grocery plans remain editable without changing their canonical geometry',()=>{
 for(const row of read('docs/inferred-stores/manifest.json').houses.filter(r=>r.file)){const h=read('docs/inferred-stores/'+row.file);assert.equal(validateDraft(createDraft(h)).valid,true,row.id);}
});
test('a business starter preserves an angled tenancy, source apertures and identity',()=>{
 const footprint={type:'Polygon',coordinates:[[[0,0],[15,0],[12,18],[0,18],[0,0]]]},entry={id:'observed',measured:true,segment:{type:'LineString',coordinates:[[4,0],[5.6,0]]},width_m:1.6,leaf_count:2};
 const h=businessStarter({id:'real-tenant',kind:'clinic',footprint,height:3.1,entrances:[entry]});assert.deepEqual(h.storeys[0].footprint,footprint);assert.deepEqual(h.storeys[0].openings.find(o=>o.id==='observed').segment,entry.segment);assert.equal(validateDraft(createDraft(h)).valid,true);assert.ok(h.storeys[0].rooms.some(r=>r.kind==='examination_room'));
 assert.throws(()=>targetForHome({id:'biz:x',buildingId:'x',propertyKind:'business'},read('docs/inferred-interiors/stress-family.json'),{account:'player:a',worldKey:'test'}),/tenant plan/);
});
test('business edits check current ownership, persist in world snapshots and are consumed by the shared renderer bridge',async()=>{
 const world=new CityWorld(R),pid='owner';world.submit(pid,'join',{name:'Owner'});world.submit('other','join',{name:'Other'});world.ledger.mint('player:owner',R.money(100000),'account_grant');world.registry.register('building:store','building','player:owner',{name:'Store'},world.now);
 const opened=world.submit(pid,'register_business',{place:{id:'store',name:'Store',area:200},kind:'cafe',name:'Test Cafe'});assert.equal(opened.ok,true,opened.error);
 const storage={data:new Map(),get length(){return this.data.size;},key(i){return[...this.data.keys()][i];},getItem(k){return this.data.get(k)??null;},setItem(k,v){this.data.set(k,v);},removeItem(k){this.data.delete(k);}};
 const baseline=example('cafe'),home={id:'biz:store',buildingId:'store',propertyKind:'business',businessKind:'cafe',label:'Test Cafe'},access={worldKey:'business-test',account:'player:owner',homes:[home],designs:[]},target=targetForHome(home,baseline,access),handoff=createHandoff(baseline,target,{storage}),draft=dispatch(createDraft(baseline),{type:'set-room-color',level:0,id:baseline.storeys[0].rooms[0].id,color:'#abcdee'}),design=applyToWorld(handoff,draft,{storage});
 assert.equal(world.submit('other','customize_business',{business:home.id,baseline,design}).ok,false);
 const bridge=new HomeInteriorBridge({storage,loadBaseline:async()=>baseline,onApply:a=>world.submit(pid,'customize_business',{business:a.home,baseline:a.baseline,design:a.design})});bridge.setAccess(access);await bridge.consumePending();await new Promise(r=>setTimeout(r,0));assert.equal(world.businessInteriors.get(home.id).revision,design.revision);assert.equal(bridge.designFor('store',baseline).storeys[0].rooms[0].materials.wall,'#abcdee');
 const restored=CityWorld.fromJSON(R,JSON.parse(JSON.stringify(world.toJSON())));assert.equal(restored.businessInteriors.get(home.id).revision,design.revision);world.biz.get(home.id).status='closed';assert.equal(world.submit(pid,'customize_business',{business:home.id,baseline,design}).ok,false);bridge.destroy();
});
test('imported business models have redistribution provenance, bounded detail and valid checksums',()=>{
 const m=read('docs/interior-assets/manifest.json'),rows=m.assets.filter(a=>a.detail==='low_poly');assert.ok(rows.length>=170);for(const role of['dining_table','dining_chair','booth','hospital_bed','medical_cart','examination_table'])assert.ok(rows.some(r=>r.role===role),role);
 for(const a of rows){assert.equal(a.license,'CC0-1.0');assert.equal(a.validation_errors,0);assert.ok(a.triangles<=8500);assert.ok(a.dimensions_m.every(n=>Number.isFinite(n)&&n>0));for(const f of a.files){const bytes=fs.readFileSync(new URL('../docs/interior-assets/'+f.path,import.meta.url));assert.equal(bytes.length,f.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),f.sha256);}}
});
test('a new partition cannot run into a source window',()=>{
 const h=example('office'),f=h.storeys[0];f.footprint=square(0,0,12,12);f.inside=structuredClone(f.footprint);f.rooms=[{id:'r',kind:'office',polygon:structuredClone(f.footprint),materials:{wall:'#eee'}}];f.objects=[];f.walls=[];f.openings=[{id:'entry',entrance:true,width_m:1,rooms:['r','outside'],segment:{type:'LineString',coordinates:[[0,1],[0,2]]}}];h.envelope={windows:[{edge:0,u:5,w:2,v:1,h:1.5}]};
 const bad=dispatch(createDraft(h),{type:'split-room',level:0,id:'r',axis:'x',at:6,newRoomId:'next'});assert.ok(validateDraft(bad).issues.some(i=>i.code==='window-wall'));
 const good=dispatch(createDraft(h),{type:'split-room',level:0,id:'r',axis:'x',at:8,newRoomId:'next'});assert.equal(validateDraft(good).valid,true);
});
test('specialty fixture collision parts and interaction points follow moves and rotations',()=>{
 const h=example('office'),f=h.storeys[0],o=structuredClone(read('docs/interior-lab/businesses/engine-barber.json').storeys[0].objects.find(o=>o.role==='styling_station'));
 f.footprint=square(0,0,12,12);f.inside=structuredClone(f.footprint);f.rooms=[{id:'r',kind:'styling_floor',polygon:structuredClone(f.footprint),materials:{wall:'#eeeeee'}}];f.objects=[o];f.walls=[];f.openings=[{id:'entry',entrance:true,width_m:1,rooms:['r','outside'],segment:{type:'LineString',coordinates:[[0,1],[0,2]]}}];h.envelope={windows:[]};o.room_id='r';o.support.id='r';h.interaction_targets=[{room_id:'r',point:o.interaction_point_m}];
 assert.equal(new TourWorld(h).clear(7.4,6.5,0),true,'the empty approach area inside an assembly box remains walkable');
 const d=dispatch(createDraft(h),{type:'move-object',level:0,id:o.id,position_m:[o.position_m[0]+.5,0,o.position_m[2]+.7],rotation_deg:o.rotation_deg+30}),moved=d.house.storeys[0].objects[0];assert.equal(validateDraft(d).valid,true);assert.notDeepEqual(moved.collision_polygons,o.collision_polygons);assert.notDeepEqual(moved.interaction_point_m,o.interaction_point_m);assert.deepEqual(exportOverride(d).house.interaction_targets[0].point,moved.interaction_point_m);
 moved.collision_polygons=[square(0,0,.1,.1)];assert.ok(validateDraft(d).issues.some(i=>i.code==='object-collision-shape'));
});
test('room paint changes both internal wall faces without recoloring neighboring rooms',()=>{
 const previous=globalThis.document,context=new Proxy({},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});globalThis.document={createElement:()=>({getContext:()=>context})};
 try{const h=example('cafe'),room=h.storeys[0].rooms[0],other=h.storeys[0].rooms[1],d=dispatch(createDraft(h),{type:'set-room-color',level:0,id:room.id,color:'#abcdee'}),built=buildInferredHouse(THREE,d.house,{exterior:false,ceilings:false}),colors=[];built.group.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])colors.push(m.color?.getHexString());});assert.ok(colors.includes('abcdee'));assert.ok(colors.includes(other.materials.wall.slice(1)));}
 finally{globalThis.document=previous;}
});
