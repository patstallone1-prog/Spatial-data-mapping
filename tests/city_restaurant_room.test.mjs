import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {loadRules} from "../docs/city/core.mjs";
import {restaurantService,planRestaurant,canWalkRestaurant,fittedKitchenFixtures} from "../docs/city/restaurant-room.mjs";
import {kenneyVariant,FLEET_FOR,KENNEY_FOR} from "../docs/city/vehicles.mjs";

const R=loadRules(JSON.parse(readFileSync(new URL("../docs/city/rules.json",import.meta.url))));
test("menu pricing, counter service, source windows and available floor space change the dining room",()=>{
  const fast=restaurantService(R,"american"),fine=restaurantService(R,"seafood");
  assert.equal(fast.style,"counter");assert.equal(fine.style,"dining");
  assert.equal(restaurantService(R,"seafood",{prices:Object.fromEntries(R.stores.kinds.seafood.items.map(id=>[id,.5]))}).style,"casual");
  const big={width:12,depth:14};const a=planRestaurant(big,fast),b=planRestaurant(big,fine);
  assert.ok(b.counterZ>a.counterZ);assert.ok(b.fixtures.some(f=>f.finish==="dining"&&f.places===4));
  assert.ok(a.fixtures.some(f=>f.role==="booth"));assert.ok(a.fixtures.some(f=>f.places===2));
  assert.ok(planRestaurant({width:4.4,depth:10},fast).fixtures.some(f=>f.role==="ledge"));
  const booth=a.fixtures.find(f=>f.role==="booth");
  const window=planRestaurant({...big,windows:[{x:booth.x,z:booth.z}]},fast);
  assert.equal(window.fixtures.find(f=>f.x===booth.x && f.z===booth.z).role,"table");
});
test("all restaurant stations and ingredients fit at the pass, along worktops or in storage",()=>{
  for(const kind of Object.keys(R.kitchen.kitchens)){
    const service=restaurantService(R,kind,null,{pantry:{egg:0,flour:8},menu:[{id:"house",price:R.money(24),build:[{ing:"water",qty:1,p:"-"}]}]});
    for(const size of [{width:12,depth:14},{width:3,depth:3}]){
      const p=planRestaurant(size,service);
      const bins=p.fixtures.flatMap(f=>f.bins||[]),stations=p.fixtures.flatMap(f=>f.stations||[]);
      assert.deepEqual(new Set(bins.map(b=>b.id)),new Set(service.ingredients.map(b=>b.id)),kind);
      assert.equal(bins.find(b=>b.id==="egg").stock,0);
      assert.ok(service.stations.every(s=>stations.includes(s)),kind);
      if(size.width>3) for(const f of p.fixtures.filter(f=>f.role==="pantry"))assert.ok(f.bins.every(i=>i.kept===f.kept));
    }
  }
});
test("an offset entrance has a walkable route to front and rear while tables and the footprint block movement",()=>{
  const shape={width:12,depth:14,doorX:1,outline:[[-6,0],[6,0],[6,7],[3,7],[3,14],[-6,14],[-6,0]]};
  const p=planRestaurant(shape,restaurantService(R,"diner"));
  for(let z=.3;z<p.counterZ-.4;z+=.1)assert.ok(canWalkRestaurant(p,1,z),String(z));
  for(let z=.3;z<p.depth-1.08;z+=.1)assert.ok(canWalkRestaurant(p,1,z,true),String(z));
  assert.equal(canWalkRestaurant(p,1,p.counterZ+.4),false);
  assert.equal(canWalkRestaurant(p,4,8,true),false);
  for(const f of p.fixtures)assert.equal(canWalkRestaurant(p,f.x,f.z,true),false);
});
test("an existing fitted restaurant keeps its fixture positions and separates cold, dry and prep work",()=>{
  const floor={rooms:[{id:"kit",kind:"professional_kitchen"}],objects:["prep_table","dry_storage","commercial_fridge"].map((role,i)=>({role,id:role,room_id:"kit",rotation_deg:30,position_m:[2*i,0,4],size_m:[1,.9,.7]}))};
  const food=restaurantService(R,"italian"),before=JSON.stringify(floor),fixtures=fittedKitchenFixtures(floor,food);
  assert.equal(JSON.stringify(floor),before);
  assert.deepEqual(fixtures.map(f=>f.x),[0,2,4]);
  assert.ok(fixtures[2].bins.every(b=>b.kept!=="dry"));
  assert.ok(fixtures[1].bins.every(b=>b.kept==="dry"));
  assert.ok(fixtures[0].stations.includes("stove"));
});
test("every serviceable car has a city import, and the two sedan variants follow the street fleet's shade",()=>{
  for(const model of Object.keys(R.vehicles.models))assert.ok(FLEET_FOR[model] || KENNEY_FOR[model]);
  assert.equal(kenneyVariant("sedan",0),"sedan");assert.equal(kenneyVariant("sedan",.5/997+1/997),"sedan-sports");
});

