// Exercise the unmodified preview's controls with real Three cameras/geometry and a
// deterministic DOM/renderer boundary. GPU geometry is checked separately; no network.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createDealershipRenderer} from '../../src/smc/exteriors/dealership-renderer.mjs';
import {createExteriorRenderer} from '../../src/smc/exteriors/renderer.mjs';
const actual=await import(pathToFileURL(process.argv[2]).href),manifest=JSON.parse(fs.readFileSync(process.argv[4]));
let lastRenderer,resize,rect={width:660,height:526};
class Renderer {
 constructor(){lastRenderer=this;this.shadowMap={};this.size=new actual.Vector2();this.calls=0;}
 setPixelRatio(){} getSize(v){return v.copy(this.size);} setSize(w,h){this.size.set(w,h);}
 render(scene,camera){this.calls++;this.scene=scene;this.position=camera.position.clone();}
 setAnimationLoop(fn){this.loop=fn;} dispose(){}
}
class Controls {
 constructor(camera){this.camera=camera;this.target=new actual.Vector3();}
 update(){this.camera.lookAt(this.target);this.camera.updateMatrixWorld();}
 addEventListener(name,fn){this.listener=fn;}
 dispose(){}
}
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{id,checked:['roof','cars'].includes(id),value:'',options:[],textContent:'',listeners:{},
 getBoundingClientRect:()=>rect,add(o){this.options.push(o);if(this.options.length===1)this.value=o.value;},
 addEventListener(name,fn){this.listeners[name]=fn;},replaceChildren(){},append(){}});return elements.get(id);}
const doc={getElementById:element,createElement:tag=>tag==='canvas'?{width:1536,height:256,getContext:()=>({clearRect(){},fillRect(){},fillText(){},measureText:t=>({width:String(t).length*60})})}:{append(){}}};
globalThis.document=doc;
const context=vm.createContext({THREE:{...actual,WebGLRenderer:Renderer},OrbitControls:Controls,createDealershipRenderer,createExteriorRenderer,
 document:doc,devicePixelRatio:1.5,location:{href:'http://localhost/dealerships.html'},URL,Option:class{constructor(text,value){this.text=text;this.value=value;}},
 ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},window:{addEventListener(){}},
 fetch:async path=>({json:async()=>String(path).includes('dealership-scenes')?manifest:{assets:{}}})});
const source=fs.readFileSync(process.argv[3],'utf8').replace(/^import .*;\n/gm,'');
await vm.runInContext('(async()=>{'+source+'\n})()',context);
assert.equal(element('case').options.length,Object.keys(manifest.dealerships).length);
assert.match(element('stats').textContent,/lot spaces/);assert.ok(lastRenderer.calls);
const idleCalls=lastRenderer.calls;lastRenderer.loop();lastRenderer.loop();assert.equal(lastRenderer.calls,idleCalls,'idle preview must not redraw GPU shadows');
element('night').checked=true;element('night').listeners.change();assert.ok(lastRenderer.calls>idleCalls,'lighting changes must draw immediately');
const before=lastRenderer.position.clone();element('entrance').listeners.click();const entry=lastRenderer.position.clone();
assert.ok(entry.distanceTo(before)>10,'entrance button must change camera');
rect={width:659,height:526};resize();
assert.ok(lastRenderer.position.distanceTo(entry)<.01,'resize must preserve entrance view');
element('showroom').listeners.click();assert.ok(lastRenderer.position.distanceTo(entry)>10,'showroom view must enter shell');
element('roof').checked=false;element('roof').listeners.change();assert.equal(lastRenderer.scene.getObjectByName('dealershipRoof').visible,false);
element('cars').checked=false;element('cars').listeners.change();assert.equal(lastRenderer.scene.getObjectByName('dealershipCars').visible,false);
element('case').value=Object.keys(manifest.dealerships)[1];element('case').listeners.change();assert.equal(element('name').textContent,manifest.dealerships[element('case').value].name);
element('overview').listeners.click();assert.ok(lastRenderer.position.distanceTo(entry)>10);
console.log(JSON.stringify({controls_passed:true,resize_preserves_view:true,cases:Object.keys(manifest.dealerships).length}));
