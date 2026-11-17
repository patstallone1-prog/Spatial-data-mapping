import test from 'node:test';import assert from 'node:assert/strict';
import {loadCity} from '../server/city/http.mjs';import {CityAuthority} from '../server/city/authority.mjs';import {MemoryStore,SupabaseStore} from '../server/city/storage.mjs';import {keyHash} from '../server/city/auth.mjs';import {CityWorld} from '../docs/city/world.mjs';
const{R,canon}=loadCity(),NOW=Date.UTC(2026,10,16,19),IDS=Array.from({length:4},(_,i)=>`11111111-2222-4333-8444-55555555555${i}`),PLACES=['263347484','263343082','272598431'];
class WelcomeStore extends MemoryStore{
 constructor(){super();this.links=new Map();this.offers=new Map(IDS.slice(0,3).map((id,i)=>[id,{account_id:id,slot:i+1,credit_cents:100000000,restaurant_id:PLACES[i]}]));this.welcomed=new Set();this.collide=false;}
 async identityFor(hash){return this.links.get(hash)||null;}
 async welcomeFor(account){return this.welcomed.has(account)?null:structuredClone(this.offers.get(account)||null);}
 async commit(id,expect,state,entry,options={}){if(options.welcomeAccount&&this.collide){this.collide=false;return{ok:false,version:await this.version(id)};}if(options.welcomeAccount&&this.welcomed.has(options.welcomeAccount))return{ok:false,why:'already claimed'};const r=await super.commit(id,expect,state,entry,options);if(r.ok&&options.welcomeAccount)this.welcomed.add(options.welcomeAccount);return r;}
}
const authority=store=>new CityAuthority({R,canon,store,secret:'test-only-city-secret',now:()=>NOW});
async function device(A,store,index=0,suffix='a'){const key=`welcome-test-device-${index}-${suffix}-0123456789`;store.links.set(keyHash(key),IDS[index]);return A.handle({op:'session',key});}
async function join(A,s,index=0){const place=canon.places.get(PLACES[index%3]);const r=await A.handle({op:'cmd',token:s.token,command:'join',args:{name:`Tester ${index}`,at:{x:place.x,z:place.z}}});assert.equal(r.result.ok,true,r.result.error);return r;}
async function saved(store){return CityWorld.fromJSON(R,(await store.load('kerbside')).state.world);}
test('each of the first three named accounts gets a million credits and a different small owned restaurant; the fourth gets neither',async()=>{
 const store=new WelcomeStore(),A=authority(store),businesses=[];for(let i=0;i<4;i++){const s=await device(A,store,i);await join(A,s,i);let w=await saved(store),before=w.ledger.balance(w.player(s.pid).account),r=await A.handle({op:'grants',token:s.token});w=await saved(store);const p=w.player(s.pid);assert.equal(w.ledger.balance(p.account)-before,i<3?100000000:0);if(i<3){assert.ok(r.welcome);const b=w.biz.get(r.welcome.restaurant);assert.equal(b.owner,p.account);assert.equal(b.kind,'restaurant');assert.equal(b.status,'open');assert.ok(b.place.area>=50&&b.place.area<=260);assert.equal(w.registry.get(`building:${b.place.id}`).owner,p.account);assert.ok(Object.keys(b.licences).length>0);businesses.push(b.id);}else assert.equal(r.welcome,undefined);}assert.equal(new Set(businesses).size,3);
});
test('reconnecting, a second device and a server restart cannot duplicate a starter',async()=>{
 const store=new WelcomeStore(),A=authority(store),s=await device(A,store);await join(A,s);await A.handle({op:'grants',token:s.token});const before=await saved(store),balance=before.ledger.balance(before.player(s.pid).account),second=await device(A,store,0,'b');assert.equal(second.pid,s.pid);const r=await authority(store).handle({op:'grants',token:second.token}),after=await saved(store);assert.deepEqual(r.granted,[]);assert.equal(after.ledger.balance(after.player(s.pid).account),balance);assert.equal(after.biz.size,1);
});
test('simultaneous grants and a lost CAS retry preserve one package and one balanced wallet',async()=>{
 const store=new WelcomeStore(),A=authority(store),s=await device(A,store);await join(A,s);let w=await saved(store),balance=w.ledger.balance(w.player(s.pid).account);store.collide=true;const result=await Promise.all([A.handle({op:'grants',token:s.token}),authority(store).handle({op:'grants',token:s.token})]);assert.ok(result.every(r=>r.ok));w=await saved(store);assert.equal(w.ledger.balance(w.player(s.pid).account)-balance,100000000);assert.equal(w.biz.size,1);assert.equal(store.welcomed.size,1);
});
test('an anonymous device cannot claim a named-account package or spoof one in its request',async()=>{
 const store=new WelcomeStore(),A=authority(store),s=await A.handle({op:'session',key:'anonymous-device-0123456789'});await join(A,s);const r=await A.handle({op:'grants',token:s.token,account:IDS[0],slot:1,amount:100000000});assert.deepEqual(r.granted,[]);assert.equal((await saved(store)).biz.size,0);assert.equal(store.welcomed.size,0);
});
test('a pre-join grant waits; an occupied preferred restaurant is preserved and a free alternative is assigned',async()=>{
 const store=new WelcomeStore(),A=authority(store),s=await device(A,store);assert.equal((await A.handle({op:'grants',token:s.token})).waiting,true);assert.equal(store.welcomed.size,0);await join(A,s);const doc=await store.load('kerbside'),w=CityWorld.fromJSON(R,doc.state.world);w.registry.register(`building:${PLACES[0]}`,'building','city:existing-owner',{name:'Preserved'},w.now);await store.commit('kerbside',doc.version,{...doc.state,world:JSON.parse(JSON.stringify(w.toJSON()))});const r=await A.handle({op:'grants',token:s.token});assert.ok(r.welcome);assert.notEqual(r.welcome.restaurant,`biz:${PLACES[0]}`);assert.equal((await saved(store)).registry.get(`building:${PLACES[0]}`).owner,'city:existing-owner');
});
test('Supabase uses a single atomic welcome commit RPC and keeps ordinary commits compatible',async()=>{
 const requests=[],s=new SupabaseStore({url:'https://test.supabase.co',key:'test-key',secret:'test-secret',fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return{ok:true,text:async()=>JSON.stringify({ok:true,version:1})};}});await s.commit('kerbside',0,{world:{},server:{}},null,{welcomeAccount:IDS[0]});assert.ok(requests[0].url.endsWith('/kerbside_city_commit_with_welcome'));assert.equal(requests[0].body.welcome_account,IDS[0]);await s.commit('kerbside',1,{world:{},server:{}});assert.ok(requests[1].url.endsWith('/kerbside_city_commit'));assert.equal(requests[1].body.welcome_account,undefined);
});
test('a new package is a real restaurant building; one already given at a house-like place is moved to one, with its till',async()=>{
 const {REAL_RESTAURANTS,repairWelcome}=await import('../server/city/welcome.mjs');
 const store=new WelcomeStore(),A=authority(store),s=await device(A,store);await join(A,s);const r=await A.handle({op:'grants',token:s.token});
 assert.ok(REAL_RESTAURANTS.includes(r.welcome.restaurant_id),r.welcome.restaurant_id);
 for(const id of REAL_RESTAURANTS){const p=canon.places.get(id);assert.ok(p&&p.floors<=2&&p.area>=50&&p.area<=260,id);}
 // An older package, at 2014 Lombard Street: put there by hand, then repaired on the next look.
 const doc=await store.load('kerbside'),w=CityWorld.fromJSON(R,doc.state.world),srv=doc.state.server,p=w.player(s.pid),aid=IDS[0];
 const old=w.biz.get(r.welcome.restaurant),till=w.ledger.balance(old.account)+50000;w.submit(s.pid,'fund_business',{business:old.id,amount:50000});
 w.submit(s.pid,'close_business',{business:old.id});w.registry.assets.delete(`building:${r.welcome.restaurant_id}`);
 const house=canon.places.get('263347484');w.registry.register('building:263347484','building',p.account,{name:house.name,area:house.area},w.now);
 const again=w.submit(s.pid,'register_business',{place:house,kind:'restaurant',name:old.name,rivals:1});assert.equal(again.ok,true,again.error);
 w.submit(s.pid,'fund_business',{business:again.business.id,amount:till});srv.welcomeReceipts[aid].restaurant_id='263347484';
 const moved=repairWelcome(w,canon,srv,{pid:s.pid,aid});
 assert.ok(moved&&REAL_RESTAURANTS.includes(moved.restaurant.slice(4)),JSON.stringify(moved));
 const now=w.biz.get(moved.restaurant);assert.equal(now.name,old.name);assert.equal(now.status,'open');assert.equal(w.ledger.balance(now.account),till);
 assert.equal(w.bizAt('263347484'),null);assert.equal(w.registry.assets.has('building:263347484'),false);
 assert.equal(repairWelcome(w,canon,srv,{pid:s.pid,aid}),null,'once');w.ledger.check();
});
