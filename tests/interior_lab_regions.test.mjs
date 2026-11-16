import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/smc/renderer/page/module/23-pins-1-2-and-3.js',import.meta.url),'utf8');
function functions(...names){return names.map(name=>{const match=new RegExp(`(?:async )?function ${name}\\(`).exec(source);assert.ok(match,name);return source.slice(match.index,source.indexOf('\n}',match.index)+2);}).join('\n');}
test('a streamed property reads its own baseline and waits for its own rebuild',async()=>{
 const access={homes:[],designs:[]},baseline={id:'guest-property'},calls=[],g={ready:true,api:{hasInteriorBuilding:id=>id==='guest-property',interiorEditorBaseline:async(id,a)=>{calls.push([id,a]);return baseline;},interiorEditorReady:async id=>{calls.push(id);}}},scope=vm.createContext({activeGuest:g,homeEditorAccess:access,footprintById:new Map()});
 vm.runInContext(functions('interiorGuest','editorBaseline','interiorEditorReady'),scope);assert.equal(await scope.editorBaseline('guest-property'),baseline);await scope.interiorEditorReady('guest-property');assert.deepEqual(calls,[['guest-property',access],'guest-property']);
});
test('right-click reach is measured in the streamed region instead of a released host footprint map',async()=>{
 const calls=[],target={id:'owned',buildingId:'guest-property'},g={ready:true,api:{hasInteriorBuilding:()=>true,interiorEditorDistance:(...args)=>{calls.push(args);return 3;}}};let prevented=0,menu;
 const scope=vm.createContext({activeGuest:g,pickedFeature:()=>({kind:'building',osm_id:'guest-property'}),homeEditorAccess:{homes:[target]},avatar:{position:{x:110,z:230}},footprintById:new Map(),hostToGuest:(guest,x,z)=>[x-100,z-200],ensureHomeEditorBridge:async()=>{},homePropertyMenu:x=>menu=x,openHomeInteriorLab:()=>{},livingCity:{notify:message=>calls.push(message)}});
 vm.runInContext(functions('interiorGuest','ownedInteriorContext'),scope);assert.equal(scope.ownedInteriorContext({clientX:42,clientY:73,preventDefault:()=>prevented++,stopImmediatePropagation:()=>prevented++}),true);await Promise.resolve();assert.equal(prevented,2);assert.deepEqual(calls,[['guest-property',10,30]]);assert.equal(menu.x,42);assert.equal(menu.y,73);assert.equal(menu.targets[0],target);
});
test('streamed interior updates rebuild changed or removed designs once and keep unchanged renders',()=>{
 const design=(id,revision)=>({target:{buildingId:id,homeId:'home:'+id},revision}),old={designs:[design('a','1'),design('b','2')]},next={designs:[design('b','2'),design('c','3')]},changed=[],scope=vm.createContext({homeEditorAccess:old,invalidateLocalInterior:id=>changed.push(id)});
 vm.runInContext(functions('syncGuestInteriorAccess'),scope);scope.syncGuestInteriorAccess(next);assert.deepEqual(changed,['a','c']);changed.length=0;scope.syncGuestInteriorAccess(structuredClone(next));assert.deepEqual(changed,[]);
});
