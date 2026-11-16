import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const ui=readFileSync(new URL('../docs/interior-lab/lab.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../docs/interior-lab/index.html',import.meta.url),'utf8');
test('studio controls and local dependencies resolve without a remote CDN',()=>{
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));for(const m of ui.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(m[1]),`missing control ${m[1]}`);
 const imports=JSON.parse(html.match(/<script type="importmap">([^<]+)/)[1]).imports;for(const m of ui.matchAll(/from '([^']+)'/g)){const path=m[1].startsWith('three/addons/')?imports['three/addons/']+m[1].slice(13):imports[m[1]]||m[1];assert.ok(existsSync(new URL('../docs/interior-lab/'+path,import.meta.url)),`missing module ${path}`);}assert.ok(!/https?:\/\//.test(JSON.stringify(imports)));
});
test('numeric context controls commit their edited value',()=>{
 const text=ui.slice(ui.indexOf('function input('),ui.indexOf('function perform(')),nodes=[],context={el:(tag,text,attrs={})=>{const n={tag,...attrs,children:[],append(...x){this.children.push(...x);},addEventListener(event,fn){this[event]=fn;}};nodes.push(n);return n;}};vm.createContext(context);vm.runInContext(text+';this.make=input;',context);let value;context.make('Width',2,'number',v=>{value=v;});const number=nodes.find(n=>n.tag==='input');number.value='3.5';number.change();assert.equal(value,'3.5');
});
test('floor triangle navigation bounds the floor index and clears unfinished edits',()=>{
 const text=ui.slice(ui.indexOf('function changeFloor('),ui.indexOf("$('floor-down').onclick")),context={draft:{house:{storeys:[{},{}]}},floorIndex:0,selected:{type:'object'},tool:{kind:'place'},catalogueIntent:{},cancelTool:()=>{},refresh:()=>{}};vm.createContext(context);vm.runInContext(text+';this.change=changeFloor;',context);context.change(-1);assert.equal(context.floorIndex,0);context.change(1);assert.equal(context.floorIndex,1);assert.equal(context.selected,null);context.change(1);assert.equal(context.floorIndex,1);
});
