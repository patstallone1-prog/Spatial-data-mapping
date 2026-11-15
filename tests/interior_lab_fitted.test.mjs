import test from 'node:test';
import assert from 'node:assert/strict';
import {fittedHouseForEditing} from '../docs/interior-lab/fitted-house.mjs';
import {createDraft,dispatch} from '../docs/interior-lab/model.mjs';

const snapshot=()=>({id:'building-123',origin:[100,200],floorY:10,footprint:[[100,-200],[110,-200],[110,-208],[104,-208],[104,-205],[100,-205]],levels:[{level:0,elevation:0,height:2.8,rooms:[{kind:'living',pts:[[100,-200],[105,-200],[105,-205],[100,-205]],color:'#aabbcc'},{kind:'kitchen',pts:[[105,-200],[110,-200],[110,-208],[104,-208],[104,-205],[105,-205]]}],segments:[[105,-200,105,-202],[105,-203,105,-205]],openings:[{segment:[[105,-202],[105,-203]],rooms:[0,1],type:'doorway'},{segment:[[100,-201],[100,-202]],rooms:[0],entrance:true}],objects:[{role:'sofa',position:[102,10,-202],size:[2,1,1],yaw:Math.PI/2,asset:{id:'sofa_03',role:'sofa',model:'sofa_03/sofa_03.gltf',procedural:false}}]}]});

test('preserves world footprint, clipped rooms, openings and current furniture through local transform',()=>{
 const h=fittedHouseForEditing(snapshot()),f=h.storeys[0];
 assert.deepEqual(f.footprint.coordinates[0],[[0,0],[10,0],[10,8],[4,8],[4,5],[0,5],[0,0]]);
 assert.equal(f.rooms.length,2);assert.equal(f.rooms[0].area_m2,25);assert.equal(f.rooms[0].materials.wall,'#aabbcc');
 assert.deepEqual(f.walls[0].segment.coordinates,[[5,0],[5,2]]);assert.equal(f.walls[0].structural,false);assert.equal(f.walls[0].structural_status,'unverified_game_partition');
 assert.deepEqual(f.openings[0].segment.coordinates,[[5,2],[5,3]]);assert.equal(f.openings[0].rooms.length,2);assert.ok(f.openings[1].rooms.includes('outside'));
 const o=f.objects[0];assert.deepEqual(o.position_m,[2,0,2]);assert.deepEqual(o.size_m,[2,1,1]);assert.equal(o.rotation_deg,90);assert.equal(o.asset.id,'sofa_03');
 const moved=dispatch(createDraft(h),{type:'move-object',level:0,id:o.id,position_m:o.position_m});assert.deepEqual(moved.house.storeys[0].objects[0].footprint,o.footprint);
});

test('clips a non-square partly outside room without expanding the building',()=>{
 const s=snapshot();s.levels[0].rooms=[{kind:'living',pts:[[99,-199],[112,-199],[112,-210],[99,-210]]}];s.levels[0].objects=[];s.levels[0].openings=[];
 const f=fittedHouseForEditing(s).storeys[0];assert.equal(f.rooms.length,1);assert.equal(f.rooms[0].area_m2,68);assert.deepEqual(f.footprint.coordinates[0],[[0,0],[10,0],[10,8],[4,8],[4,5],[0,5],[0,0]]);
});

test('retains provided level and protected stair information without fabricating it',()=>{
 const s=snapshot();s.levels.push({...structuredClone(s.levels[0]),level:1,elevation:2.8,objects:[]});s.stairs=[{id:'known',from_level:0,to_level:1,steps:[]}];const h=fittedHouseForEditing(s);assert.equal(h.storeys[1].elevation_m,2.8);assert.deepEqual(h.stairs,s.stairs);assert.deepEqual(fittedHouseForEditing(snapshot()).stairs,[]);assert.match(h.provenance.layout,/not a measured survey/);
});

test('rejects missing source geometry rather than inventing an outline or furniture dimensions',()=>{
 const s=snapshot();delete s.footprint;assert.throws(()=>fittedHouseForEditing(s),/footprint/);const t=snapshot();delete t.levels[0].objects[0].size;assert.throws(()=>fittedHouseForEditing(t),/size/);
});

test('explicit structural segments remain protected and source uncertainty is retained',()=>{const s=snapshot();s.metadata={stairs:'unknown',ownership_scope:'unknown_multi_unit'};s.levels[0].segments[0]={coordinates:s.levels[0].segments[0],structural:true,structural_status:'known_support'};const h=fittedHouseForEditing(s);assert.equal(h.storeys[0].walls[0].structural,true);assert.equal(h.provenance.source_snapshot.stairs,'unknown');assert.throws(()=>dispatch(createDraft(h),{type:'remove-wall',level:0,index:0}),/protected/);});

test('runtime snapshot captures doors, windows, model metadata and stays stable',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
 const source=await readFile(new URL('../src/smc/renderer/page/module/26-rooms-laid-out-as-rooms.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function fittedInteriorSnapshot(entry) {'),source.indexOf('\nfunction removeInterior(entry) {'));
 const context={structuredClone,Number,Array,Error,Math,xy:(lon,lat)=>[lon,lat],WALL_PAINTS:[0xabcdef],THREE:{}};
 vm.createContext(context);vm.runInContext(body,context);
 const holder={userData:{surface:'furnishing:sofa',editorFurnishing:{role:'sofa',size:[2,.8,1],asset:{id:'sofa',role:'sofa',model:'sofa.gltf'}}},position:{x:102,y:10,z:-202},rotation:{y:.2}};
 const entry={fit:[0,false,1,1,100,200],way:{osm_id:123},local:[[100,-200],[110,-200],[110,-208],[100,-208]],doors:[{cx:100,cz:-202,ux:0,uz:1,width:1}],homeShell:{group:{userData:{windows:[{edge:0,u:1,v:11,w:1.2,h:1.4}]}}},interior:{floorY:10,height:2.8,rooms:[{kind:'living',pts:[[100,-200],[110,-200],[110,-208],[100,-208]],paint:0,tile:[0,0]}],segments:[[103,-201,103,-203]],doorSpecs:[{x:103,z:-204,width:1,yaw:0,kind:'private'}],group:{children:[holder]}}};
 const captured=context.fittedInteriorSnapshot(entry);
 assert.equal(captured.levels[0].objects[0].asset.id,'sofa');assert.equal(captured.levels[0].objects[0].position[1],10);
 assert.equal(captured.levels[0].openings.length,2);assert.equal(captured.levels[0].openings[0].leaf_count,1);assert.equal(captured.windows[0].v,1);
 assert.equal(captured.levels[0].segments[0].structural_status,'unverified_game_partition');assert.equal(captured.metadata.stairs,'unknown');
 holder.position.x=106;assert.equal(context.fittedInteriorSnapshot(entry).levels[0].objects[0].position[0],102);
 assert.doesNotThrow(()=>fittedHouseForEditing(captured));
});
