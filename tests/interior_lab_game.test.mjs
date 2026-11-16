import test from 'node:test';
import assert from 'node:assert/strict';
import {GameInteriorHost} from '../docs/interior-lab/in-game.mjs';
test('the game host accepts Finish only from its own same-origin editor, waits for the rebuild and restores the game',async()=>{
 const original={document:globalThis.document,location:globalThis.location,addEventListener:globalThis.addEventListener,removeEventListener:globalThis.removeEventListener},nodes=[];
 const create=tag=>{const n={tag,style:{},contentWindow:{postMessage(){}},setAttribute(){},append(){},replaceChildren(){},remove(){this.removed=true;}};nodes.push(n);return n;};globalThis.document={createElement:create,body:{append(){}}};globalThis.location={origin:'http://kerbside.test',href:'http://kerbside.test/app-model.html'};globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
 try{let paused=0,ready=0,resumed=[];const host=new GameInteriorHost({pause:()=>paused++,resume:saved=>resumed.push(saved),ready:async()=>{ready++;}}),handoff={token:'trusted-token'};host.open(handoff,'http://kerbside.test/interior-lab/?edit=trusted-token');assert.equal(paused,1);const frame=host.frame;
  await host.message({origin:'http://evil.test',source:frame.contentWindow,data:{type:'kerbside:interior:finished',token:handoff.token,saved:true}});assert.ok(host.overlay);assert.equal(ready,0);
  await host.message({origin:location.origin,source:{},data:{type:'kerbside:interior:finished',token:handoff.token,saved:true}});assert.ok(host.overlay);
  await host.message({origin:location.origin,source:frame.contentWindow,data:{type:'kerbside:interior:finished',token:handoff.token,saved:true}});assert.equal(ready,1);assert.equal(host.overlay,null);assert.deepEqual(resumed,[true]);host.open(handoff,'http://kerbside.test/interior-lab/');await host.message({origin:location.origin,source:host.frame.contentWindow,data:{type:'kerbside:interior:finished',token:handoff.token,saved:false}});assert.deepEqual(resumed,[true,false]);host.destroy();
 }finally{Object.assign(globalThis,original);}
});
