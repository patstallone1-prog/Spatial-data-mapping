import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const ui=readFileSync(new URL('../docs/interior-lab/lab.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../docs/interior-lab/index.html',import.meta.url),'utf8');
test('studio boot dependencies and control targets resolve without a remote CDN',()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
 for(const m of ui.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(m[1]),`missing control ${m[1]}`);
 const imports=JSON.parse(html.match(/<script type="importmap">([^<]+)/)[1]).imports;
 for(const m of ui.matchAll(/from '([^']+)'/g)){
   const path=m[1].startsWith('three/addons/')?imports['three/addons/']+m[1].slice(13):imports[m[1]]||m[1];
   assert.ok(existsSync(new URL('../docs/interior-lab/'+path,import.meta.url)),`missing module ${path}`);
 }
 assert.ok(!/https?:\/\//.test(JSON.stringify(imports)));
});
test('numeric inspector commits changes and SVG preview switching uses a reflected attribute',()=>{
 const functionText=ui.slice(ui.indexOf('function input('),ui.indexOf('const surfaceSelect'));
 const nodes=[];const context={el:(tag,text,attrs={})=>{let n={tag,...attrs,children:[],append(...x){this.children.push(...x);},addEventListener(event,fn){this[event]=fn;}};nodes.push(n);return n;}};vm.createContext(context);vm.runInContext(functionText+';this.make=input;',context);
 let value;context.make('X position',2,'number',v=>{value=v;});const number=nodes.find(n=>n.tag==='input');number.value='3.5';number.change();assert.equal(value,'3.5');
 assert.match(ui,/\$\('plan'\)\.toggleAttribute\('hidden',mode!==\s*'plan'\)/);
});

test('walking opens only a nearby door and updates both its collider state and visible leaf',()=>{const text=ui.slice(ui.indexOf('function toggleNearbyDoor('),ui.indexOf("$('toggle-door').addEventListener"));const near={x:1,z:1,level:0,open:false,angle:1.2,leaf:{rotation:{y:0}}},far={x:10,z:10,level:0,open:false,angle:1,leaf:{rotation:{y:0}}};const context={position:{x:1,z:2,y:0},built:{doors:[far,near]},world:{level:()=>({level:0})},toast:()=>{}};vm.createContext(context);vm.runInContext(text+';this.toggle=toggleNearbyDoor;',context);context.toggle();assert.equal(near.open,true);assert.equal(near.leaf.rotation.y,1.2);assert.equal(far.open,false);context.toggle();assert.equal(near.open,false);assert.equal(near.leaf.rotation.y,0);});
