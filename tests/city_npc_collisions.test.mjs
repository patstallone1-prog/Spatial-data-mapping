import {CRASH} from '../docs/city/crash.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {loadRules} from '../docs/city/core.mjs';
import {CityWorld} from '../docs/city/world.mjs';
import {Drivers,harmNow} from '../docs/city/fleet.mjs';
import {Streets,alongRoute} from '../docs/city/people.mjs';
const R=loadRules(JSON.parse(readFileSync(new URL('../docs/city/rules.json',import.meta.url))));
const now=Date.UTC(2026,10,14,12);
const vehicle={id:'veh:a',plate:'1ABC234',driver:'npc:a',driverName:'Driver A',x:12,z:34,yaw:0};
const target={id:'veh:b',plate:'2DEF345',driver:'npc:b',driverName:'Driver B',x:12,z:30,yaw:0,kind:'vehicle'};

test('an NPC/NPC vehicle crash creates a citation, immobilized wrecks, injuries and impact-based debt',()=>{
 const w=new CityWorld(R,{now});const incident=w.npcCollision({id:'crash:1',vehicle,target,speed:15,context:{region:'test',route:'leg:a',lane:0,reason:'blocked',signal:'green'}});
 assert.equal(w.players.size,0);assert.equal(incident.charge,'unsafe_driving');
 assert.equal(w.cases.get(incident.case).pid,'npc:a');assert.equal(w.harm.get('npc:a').record[0].charge,'unsafe_driving');
 for(const id of ['veh:a','veh:b']){assert.equal(w.harm.get(id).state,'wrecked');assert.equal(harmNow(w.harm.get(id),now).stays,true);}
 assert.ok(w.harm.get('npc:a').injuries.length);assert.ok(w.harm.get('npc:b').injuries.length);
 assert.equal(w.billing.owed('npc:b'),0,'the victim does not inherit the offender’s bills');
 const bills=incident.bills.map(id=>w.billing.bills.get(id));
 assert.equal(incident.debt,w.billing.owed('npc:a'));assert.ok(incident.debt>R.fines.unsafe_driving);
 const repair=bills.filter(b=>b.kind==='repair'||b.kind==='liability'&&b.payee==='business:dealership');
 assert.equal(repair.reduce((s,b)=>s+b.amount,0),incident.damage.reduce((s,d)=>s+d.loss*R.harm.vehicle.repair_per_point,0));
 assert.doesNotThrow(()=>w.ledger.check());
});

test('a repeated impact and a saved/reloaded report cannot charge or injure anyone again',()=>{
 const w=new CityWorld(R,{now});const args={id:'crash:p',vehicle,target:{id:'npc:p',name:'Walker',kind:'person',x:12,z:32},speed:8,context:{dt:.05,route:'r',segment:{a:1,b:2}}};
 const first=w.npcCollision(args),count=w.billing.bills.size,health=w.harm.get('npc:p').health;
 assert.equal(w.npcCollision(args),first);assert.equal(w.billing.bills.size,count);assert.equal(w.harm.get('npc:p').health,health);
 const restored=CityWorld.fromJSON(R,JSON.parse(JSON.stringify(w.toJSON())));
 const replay=restored.npcCollision(args);assert.equal(restored.billing.bills.size,count);assert.deepEqual(replay.context,args.context);assert.deepEqual(replay.at,{x:12,z:34,yaw:0});
 assert.ok(restored.billing.owed('npc:a')>0);assert.equal(restored.harm.get('npc:p').health,health);
 // (It stands until the tow truck has it -- the page's scene -- or ten real minutes at the latest: crash.mjs.)
 assert.equal(restored.harm.get('veh:a').tow_at,restored.clock.after(now,CRASH.stale_s*1000));assert.ok(restored.harm.get('veh:a').damage.scratch>0);
});

test('replaying an older impact after another crash cannot damage or bill again',()=>{
 const w=new CityWorld(R,{now});const first={id:'old',vehicle,target,speed:5};w.npcCollision(first);
 w.npcCollision({...first,id:'new',speed:3});const condition=w.harm.get(vehicle.id).condition,debt=w.billing.owed(vehicle.driver),count=w.harm.get(vehicle.driver).injuries.length;
 const restored=CityWorld.fromJSON(R,JSON.parse(JSON.stringify(w.toJSON())));assert.equal(restored.npcCollision(first).duplicate,true);
 assert.equal(restored.harm.get(vehicle.id).condition,condition);assert.equal(restored.billing.owed(vehicle.driver),debt);assert.equal(restored.harm.get(vehicle.driver).injuries.length,count);
});

function traffic(){
 const S=new Streets([{kind:'street',id:'road',pts:[[0,0],[0,200]],road_m:10}]);
 const route=S.route(S.nearest(0,0,'drive'),S.nearest(0,200,'drive'),'drive');
 const car=id=>({id,key:`leg:${id}`,route,sched:()=>30,unsched:d=>d/12,limit:12,cruise:12,length:4.6,width:1.9});
 return{S,route,car};
}
test('an NPC stepping too close to stop is hit rather than silently freezing the car',()=>{
 const {S,route,car}=traffic(),D=new Drivers(S),c=car('a');D.step(.05,10,[c],[]);
 const st=D.stateOf('a');st.d=50;st.v=12;const p=alongRoute(route,st.d,st.side),fx=-Math.sin(p.yaw),fz=-Math.cos(p.yaw);
 const q={id:'npc:p',x:p.x+fx*(c.length/2+.35),z:p.z+fz*(c.length/2+.35)};
 const res=D.step(.05,10.05,[c],[q]);assert.equal(res.hits.length,1);assert.equal(res.hits[0].who,q.id);assert.equal(res.hits[0].kind,'person');assert.equal(res.cars[0].v,0);
 assert.equal(res.hits[0].context.route,c.key);assert.ok(res.hits[0].context.segment);
 assert.equal(D.step(.05,10.1,[c],[q]).hits.length,0);
});
test('unavoidable NPC vehicle contact reports both participants once; ordinary braking is preserved',()=>{
 const {S,car}=traffic(),D=new Drivers(S),a=car('a'),b=car('b');D.step(.05,10,[a,b],[]);
 const A=D.stateOf('a'),B=D.stateOf('b');A.d=50;A.v=12;B.d=54.8;B.v=0;
 const res=D.step(.05,10.05,[a,b],[]);assert.equal(res.hits.length,1);assert.equal(res.hits[0].kind,'vehicle');assert.equal(res.hits[0].who,'b');assert.equal(res.hits[0].context.otherSpeed,0);
 assert.ok(res.cars.every(c=>c.v===0));assert.equal(D.step(.05,10.1,[a,b],[]).hits.length,0);
 const calm=new Drivers(S);calm.step(.05,10,[a,b],[]);calm.stateOf('a').d=30;calm.stateOf('a').v=5;calm.stateOf('b').d=50;calm.stateOf('b').v=0;
 assert.equal(calm.step(.05,10.05,[a,b],[]).hits.length,0);
});
