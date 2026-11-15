import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Streets, mappedCrosswalkPath, pavementRoute, alongRoute } from '../docs/city/people.mjs';

function junction(crossings) {
  const S = new Streets([
    { id:'ns',kind:'street',pts:[[0,-100],[0,0],[0,100]],road_m:10 },
    { id:'ew',kind:'street',pts:[[-100,0],[0,0],[100,0]],road_m:10 },
    ...crossings.map((pts,i)=>({id:`cross:${i}`,kind:'crossing',pts})),
  ]);
  return { S, node:S.nearest(0,0,'drive',1) };
}
const NW=[-6.6,-6.6], NE=[6.6,-6.6], SW=[-6.6,6.6], SE=[6.6,6.6];
const length = p => p?.reduce((n,e)=>n+e.length,0);

test('parallel crosswalk endpoints do not grant a crossing between them',()=>{
  const {S,node}=junction([[NW,NE],[SW,SE]]);
  assert.equal(mappedCrosswalkPath(S,node,NW,SW),null);
  const direct=mappedCrosswalkPath(S,node,NW,NE);
  assert.ok(direct.some(e=>e.crossing));
  assert.ok(Math.abs(length(direct)-13.2)<.01);
});

test('a missing side uses three legal crossings, including reversed polylines',()=>{
  const {S,node}=junction([[NE,NW],[NE,SE],[SE,SW]]);
  const path=mappedCrosswalkPath(S,node,NW,SW);
  assert.ok(path);
  assert.equal(path.filter(e=>e.crossing).length,3);
  assert.ok(Math.abs(length(path)-39.6)<.01);
  for(const edge of path.filter(e=>e.crossing))assert.ok(S.crosswalks.some(p=>JSON.stringify(p)===JSON.stringify(edge.pts)||JSON.stringify(p.toReversed())===JSON.stringify(edge.pts)));
});

test('diagonally opposite corners use separate crossings and wait separately',()=>{
  const {S}=junction([[NW,NE],[NE,SE],[SE,SW],[SW,NW]]);
  const route=S.route(S.nearest(-100,0),S.nearest(0,100),'walk');
  const p=pavementRoute(S,route,{from:{x:-90,z:-6.6},to:{x:6.6,z:90}});
  assert.ok(!p.blocked);
  for(const c of p.crossings){const a=alongRoute(p,c.s0),b=alongRoute(p,c.s1);assert.ok(Math.abs(a.x-b.x)<.01||Math.abs(a.z-b.z)<.01);assert.ok(c.s1-c.s0<14);}
});

test('unmapped junctions keep their existing inferred crosswalk routes',()=>{
  const {S,node}=junction([]);
  assert.equal(mappedCrosswalkPath(S,node,NW,SW),undefined);
});

test('a route with no legal crossing stops on the kerb, rather than falling back to the shortcut',()=>{
 const {S}=junction([[NW,NE],[SW,SE]]),route=S.route(S.nearest(-100,0),S.nearest(0,100),'walk');
 const p=pavementRoute(S,route,{from:{x:-90,z:-6.6},to:{x:6.6,z:90}});
 assert.equal(p.blocked,true);assert.notDeepEqual(p.pts.at(-1),[6.6,90]);
 assert.ok(p.pts.at(-1).every(Number.isFinite));
});
test('a multi-point crosswalk has one waiting interval, not a stop in the middle of the road',()=>{
 const {S}=junction([[NW,[0,-6.6],NE],[NE,SE],[SE,SW],[SW,NW]]);
 const route=S.route(S.nearest(-100,0),S.nearest(100,0),'walk');
 const p=pavementRoute(S,route,{from:{x:-90,z:-6.6},to:{x:90,z:-6.6}});
 assert.equal(p.blocked,false);assert.equal(p.crossings.length,1);assert.ok(Math.abs(p.crossings[0].s1-p.crossings[0].s0-13.2)<.01);
});
