import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDraft,dispatch,validateDraft} from '../docs/interior-lab/model.mjs';
import {createHandoff,applyToWorld,loadDraft,draftKey,overrideKey,fingerprint} from '../docs/interior-lab/storage.mjs';
import {HomeInteriorBridge,composeDesigns,targetForHome} from '../docs/interior-lab/world-bridge.mjs';
import {CityWorld} from '../docs/city/world.mjs';
import {loadRules} from '../docs/city/core.mjs';
import * as THREE from '../docs/vendor/three-0.160.0/three.module.min.js';
import {mountGeneratedInterior} from '../docs/inferred-interiors/kerbside-adapter.mjs';
import {TourWorld} from '../docs/inferred-interiors/tour-world.mjs';
import {buildInferredHouse} from '../docs/inferred-interiors/renderer.mjs';
const square=(a,b,c,d)=>({type:'Polygon',coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]]]});
const house=()=>({schema:'kerbside.inferred_house/1',id:'building',units:'metres',stairs:[],ramps:[],storeys:[{level:0,elevation_m:0,height_m:2.7,footprint:square(0,0,10,6),rooms:[{id:'living',kind:'living',polygon:square(0,0,10,6),materials:{wall:'#fff'}}],walls:[],openings:[{id:'entry',type:'single_door',rooms:['living','outside'],width_m:1,segment:{type:'LineString',coordinates:[[0,2],[0,3]]}}],objects:[]}]});
class MemoryStorage {constructor(){this.data=new Map();}get length(){return this.data.size;}key(i){return [...this.data.keys()][i];}getItem(k){return this.data.get(k)??null;}setItem(k,v){this.data.set(k,String(v));}removeItem(k){this.data.delete(k);}}
const target={buildingId:'building',homeId:'home:1',account:'player:ana',worldKey:'kerbside:city:world',unitId:null,label:'Home'};
function setup(){const storage=new MemoryStorage(),baseline=house(),handoff=createHandoff(baseline,target,{storage,token:'test-session'});const draft=dispatch(createDraft(baseline),{type:'set-room-color',level:0,id:'living',color:'#e3b58e'});return {storage,baseline,handoff,draft};}
test('pending design enters the owner world, survives serialization, and invalidates its render',async()=>{
 const {storage,baseline,handoff,draft}=setup(),R=loadRules(JSON.parse(readFileSync(new URL('../docs/city/rules.json',import.meta.url)))),world=new CityWorld(R);
 world.submit('ana','join',{name:'Ana'});world.submit('ben','join',{name:'Ben'});
 world.registry.register(target.homeId,'home',target.account,{building:'building'},world.now);
 const design=applyToWorld(handoff,draft,{storage});assert.equal(world.submit('ben','customize_home',{home:target.homeId,baseline,design}).ok,false);const malformed=structuredClone(design);malformed.house.storeys=[{}];assert.equal(world.submit('ana','customize_home',{home:target.homeId,baseline,design:malformed}).ok,false);
 const invalidated=[];const bridge=new HomeInteriorBridge({storage,loadBaseline:async()=>baseline,onApply:args=>world.submit('ana','customize_home',args),invalidate:id=>invalidated.push(id)});
 bridge.setAccess({worldKey:target.worldKey,account:target.account,homes:[{id:target.homeId,buildingId:'building'}],designs:[]});
 await bridge.consumePending();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(world.homeInteriors.get(target.homeId).revision,design.revision);
 assert.ok(invalidated.includes('building'));assert.equal(bridge.designFor('building',baseline).storeys[0].rooms[0].materials.wall,'#e3b58e');
 const restored=CityWorld.fromJSON(R,JSON.parse(JSON.stringify(world.toJSON())));assert.equal(restored.homeInteriors.get(target.homeId).revision,design.revision);
 bridge.setAccess({...bridge.access,designs:[]});assert.equal(bridge.designFor('building',baseline),baseline);bridge.destroy();
 assert.equal(loadDraft(draftKey(handoff),{storage}).house.storeys[0].rooms[0].materials.wall,'#e3b58e');
});
test('stale source and forged editor target are rejected; quota failure rolls back pending writes',()=>{
 const {storage,baseline,handoff,draft}=setup();const fake=structuredClone(handoff);fake.target.account='player:ben';assert.throws(()=>applyToWorld(fake,draft,{storage}),/source home changed/);
 const bad=structuredClone(draft);bad.original.storeys[0].height_m=3;assert.throws(()=>applyToWorld(handoff,bad,{storage}),/source home changed/);
 const set=storage.setItem.bind(storage);storage.setItem=(k,v)=>{if(k.includes('baseline:'))throw Error('quota');set(k,v);};assert.throws(()=>applyToWorld(handoff,draft,{storage}),/storage is full/);assert.equal(storage.getItem(overrideKey(target)),null);assert.equal(fingerprint(baseline),handoff.fingerprint);
});
test('apartment composition preserves neighbors and shared-boundary door references after merging',()=>{
 const h=house(),f=h.storeys[0];f.rooms=[{id:'a1',unit_id:'a',kind:'living',polygon:square(0,0,3,6)},{id:'a2',unit_id:'a',kind:'living',polygon:square(3,0,6,6)},{id:'b',unit_id:'b',kind:'living',polygon:square(6,0,10,6)}];
 f.walls=[{rooms:['a1','a2'],segment:{type:'LineString',coordinates:[[3,0],[3,6]]}},{rooms:['a2','b'],shared:true,segment:{type:'LineString',coordinates:[[6,0],[6,6]]}}];f.openings=[{...f.openings[0],rooms:['a1','outside']},{id:'between',type:'open',width_m:1,rooms:['a1','a2'],segment:{type:'LineString',coordinates:[[3,2],[3,3]]}},{id:'shared',type:'single_door',width_m:1,rooms:['a2','b'],segment:{type:'LineString',coordinates:[[6,2],[6,3]]}}];h.residential_units=[{id:'a'},{id:'b'}];
 assert.throws(()=>targetForHome({id:'home',buildingId:'building'},h,{...target}),/unit linked/);
 const d=dispatch(createDraft(h,{unitId:'a'}),{type:'remove-wall',level:0,index:0});assert.equal(validateDraft(d).valid,true);
 const out=composeDesigns(h,[{target:{unitId:'a'},baselineFingerprint:fingerprint(h),house:d.house}]);assert.deepEqual(out.storeys[0].rooms.find(r=>r.id==='b'),f.rooms[2]);assert.deepEqual(out.storeys[0].openings.find(o=>o.id==='shared').rooms,['a1','b']);
});
test('objects resting on furniture follow its translation and rotation without hovering',()=>{
 let d=createDraft(house());const object=(id,role,x,y,z,size,support)=>({id,role,room_id:'living',position_m:[x,y,z],size_m:size,rotation_deg:0,support,asset:{id:'procedural:'+role,role,procedural:true}});
 d=dispatch(d,{type:'add-object',level:0,object:object('desk','desk',4,0,3,[2,.8,1],{kind:'floor',id:'living'})});d=dispatch(d,{type:'add-object',level:0,object:object('lamp','table_lamp',4,.8,3,[.2,.4,.2],{kind:'object',id:'desk'})});
 d=dispatch(d,{type:'move-object',level:0,id:'desk',position_m:[6,0,3],rotation_deg:90});const lamp=d.house.storeys[0].objects.find(o=>o.id==='lamp');assert.deepEqual(lamp.position_m,[6,.8,3]);assert.equal(lamp.rotation_deg,90);assert.equal(validateDraft(d).valid,true);
});
test('applied partition and furniture edits update real rendered meshes and walking barriers',()=>{
 const previousDocument=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},beginPath(){},moveTo(){},bezierCurveTo(){},stroke(){}})})};
 const h=house();h.storeys[0].inside=structuredClone(h.storeys[0].footprint);h.storeys[0].slab_holes=[];h.style={wood:'#987654',fabric:'#888888',metal:'#555555'};h.storeys[0].rooms[0].materials={wall:'#eeeeee',floor:'#aaaaaa'};
 const mount=design=>mountGeneratedInterior(THREE,design,{}, {origin:[100,200],floorY:10,feetY:()=>10,pointInRing:()=>true,customized:true},buildInferredHouse);
 const initial=mount(h);let d=dispatch(createDraft(h),{type:'split-room',level:0,id:'living',axis:'x',at:5,newRoomId:'new'});
 assert.equal(validateDraft(d).valid,true);const split=mount(d.house);assert.ok(split.segments.length>initial.segments.length);assert.ok(split.group.children.length);const walking=new TourWorld(d.house);assert.equal(walking.clear(5,3,0),true);assert.equal(walking.clear(5,1,0),false);assert.ok(walking.move({x:4,z:3,y:0},2,0).x>5.9);
 d=dispatch(d,{type:'remove-wall',level:0,index:0});assert.equal(mount(d.house).segments.length,initial.segments.length);
 d=dispatch(d,{type:'add-object',level:0,object:{id:'chair',role:'chair',position_m:[2,0,2],size_m:[.5,1,.5],rotation_deg:0,room_id:'living',support:{kind:'floor',id:'living'},asset:{id:'chair',role:'chair',procedural:true}}});
 const furnished=mount(d.house);assert.equal(furnished.segments.length,initial.segments.length+4);let item;furnished.group.traverse(n=>{if(n.userData.id==='chair')item=n;});assert.deepEqual(item.position.toArray(),[2,0,2]);assert.deepEqual(furnished.group.position.toArray(),[100,10,-200]);globalThis.document=previousDocument;
});
