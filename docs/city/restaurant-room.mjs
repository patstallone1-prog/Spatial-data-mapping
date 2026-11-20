// A restaurant's room, fitted from what it sells and the space it has: its footprint, its
// entrance and windows, its menu's prices and how much of its trade is taken away.
//
//   - The tier (``service.style``): "counter" (fast food: order at the counter, metal tables and
//     moulded seats, booths of laminate), "casual" (a diner, a neighbourhood place: wooden tables,
//     cushioned vinyl booths along the side walls), "dining" (fine: tables laid with cloth,
//     upholstered chairs, a banquette along the wall, a host stand by the door).
//   - The dining room: tables in bays down both side walls with a clear way from the door to the
//     counter, small tables pushed into the corners, booths and banquettes against the walls.
//   - The staff: how many cook and how many serve, from the seats and the prices
//     (``restaurantStaff``), and the kitchen as deep as that crew needs.
//   - The kitchen: every station the kitchen game has for this cuisine (kitchen.mjs stationsFor),
//     the hot line under its hood, a prep bench, a hand sink, the dish pit, cold and dry storage
//     with every ingredient in its labelled bin, wall shelving, the pass with its order screen,
//     the tills at the counter and, where there is room, the manager's desk and computer.
import clipping from "../vendor/polygon-clipping-0.15.7/index.mjs";
import { recipeOf, stationsFor } from "./kitchen.mjs";

//: Floor per seat (m²) by tier, the share of covers each staff member looks after, and how
//: many cooks the line takes: the industry's rules of thumb (fast food seats tight and serves at
//: a counter; fine dining seats wide and has a server for every few tables).
export const SERVICE_TIERS = {
  counter: { seat_m2: 1.25, seats_per_server: 40, seats_per_cook: 28, finish: "metal" },
  casual: { seat_m2: 1.6, seats_per_server: 16, seats_per_cook: 22, finish: "wood" },
  dining: { seat_m2: 2.1, seats_per_server: 9, seats_per_cook: 13, finish: "linen" },
};
//: The crew a restaurant of ``seats`` needs at its busiest: cooks on the line, a dishwasher once
//: there are over twenty seats, servers (or cashiers at a counter), a host where it is fine
//: dining, and a manager past forty seats. Dearer food takes more hands in the kitchen.
export function restaurantStaff(seats, service) {
  const t = SERVICE_TIERS[service?.style] || SERVICE_TIERS.casual, price = service?.price || 0;
  const cooks = Math.max(1, Math.ceil(seats / t.seats_per_cook) + (price >= 40 ? 1 : 0));
  const front = Math.max(1, Math.ceil(seats / t.seats_per_server));
  const dish = seats > 20 ? Math.ceil(seats / 60) : 0, host = service?.style === "dining" && seats > 16 ? 1 : 0, manager = seats > 40 ? 1 : 0;
  return { cooks, front, dish, host, manager, total: cooks + front + dish + host + manager };
}
//: How deep the kitchen behind the counter is for a crew: the line and its aisle, more for
//: more cooks and for a bigger range of stations.
export function kitchenDepthFor(staff, stations) {
  return Math.max(2.5, Math.min(7.5, 2.4 + 0.55 * Math.max(0, staff.cooks - 1) + 0.3 * staff.dish + (stations > 8 ? 0.8 : 0) + (staff.manager ? 0.6 : 0)));
}

export function restaurantService(R, kind, business, kitchen) {
  const menu = R.stores.kinds[kind]?.items || [], house = kitchen?.house_menu || kitchen?.menu || [];
  const prices = [], ingredients = new Set(Object.keys(kitchen?.pantry || {}));
  for (const dish of [...menu,...house.map(d=>d.id)]) {
    const recipe = recipeOf(R,dish,house);
    if (!recipe) continue;
    for (const part of recipe.build) ingredients.add(part.ing);
    if (!["cup","glass"].includes(recipe.vessel)) {
      const price = house.find(d=>d.id===dish)?.price ?? (R.items[dish].price * (business?.prices?.[dish] ?? 1));
      prices.push(price/R.money(1));
    }
  }
  prices.sort((a,b)=>a-b);
  const price = prices[Math.floor(prices.length*.7)] || 0;
  const takeaway = R.kitchen.service[kind]?.takeout ?? .45;
  const style = takeaway >= .65 && price < 30 ? "counter" : price >= 24 && takeaway < .65 ? "dining" : "casual";
  return {style,finish:SERVICE_TIERS[style].finish,price,kind,takeaway,stations:stationsFor(R,kind).map(s=>s.id),
    ingredients:[...ingredients].filter(id=>R.kitchen.ingredients[id]).sort().map(id=>({id,...R.kitchen.ingredients[id],stock:kitchen?.pantry ? kitchen.pantry[id] || 0 : null}))};
}

function spans(ring,z) {
  const cuts=[];
  for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i];
    if((a[1]>z)!==(b[1]>z)) cuts.push(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]));
  }
  cuts.sort((a,b)=>a-b);
  return cuts.filter((_,i)=>i%2===0).map((x,i)=>[x,cuts[2*i+1]]);
}
function inside(ring,x,z){return spans(ring,z).some(([lo,hi])=>x>=lo && x<=hi);}
function boundsInside(ring,x,z,w,d) {
  // Include each polygon vertex height so a concave notch cannot cut into a fixture.
  const lo=z-d/2,hi=z+d/2;
  const rows=[lo,hi,...ring.filter(p=>p[1]>lo && p[1]<hi).flatMap(p=>[Math.max(lo,p[1]-.0001),Math.min(hi,p[1]+.0001)])];
  return rows.every(row=>spans(ring,row).some(([a,b])=>x-w/2>=a && x+w/2<=b));
}
export function planRestaurant({width,depth,outline,doorX=0,windows=[]},service) {
  const half=width/2, rect=[[-half,0],[half,0],[half,depth],[-half,depth],[-half,0]];
  const polygons=outline?.length>=3 ? clipping.intersection([rect],[outline]) : [[rect]];
  const ring=polygons.find(poly=>inside(poly[0],doorX,.15))?.[0] || polygons[0]?.[0];
  if(!ring) return null;
  const aisle = Math.max(-half+.58,Math.min(half-.58,doorX));
  const available = Math.max(...ring.map(p=>p[1]));
  // The dining room's share of the depth by tier, but never so much that the kitchen is too
  // shallow for the crew those seats need.
  const tier=SERVICE_TIERS[service.style]||SERVICE_TIERS.casual;
  const share=service.style==="counter"?.48:service.style==="dining"?.68:.59;
  const seatsGuess=Math.max(4,(width*available*share)/tier.seat_m2*.55);
  const kitchenNeed=kitchenDepthFor(restaurantStaff(seatsGuess,service),service.stations.length);
  const counterZ = Math.max(available*.36, Math.min(available*share, available-kitchenNeed-.3));
  const fixtures=[],seats=[];
  const add=(role,x,z,w,d,extra={})=>{
    if(!boundsInside(ring,x,z,w+.05,d+.05))return;
    if(fixtures.some(f=>Math.abs(x-f.x)<(w+f.w)/2+.04 && Math.abs(z-f.z)<(d+f.d)/2+.04))return;
    const f={role,x,z,w,d,...extra}; fixtures.push(f);return f;
  };
  // The corners: a table for two pushed into each, where a side wall meets the front (taken
  // before the bays: the window corner) or the counter (after them, in what room is left).
  const corners=z=>{
    if(z<.55||z>counterZ-.9)return;
    for(const [lo,hi] of spans(ring,z))for(const side of [-1,1]){
      const x=side<0?lo+.55:hi-.55;
      if(Math.abs(x-aisle)<1.15)continue;
      const into=z<counterZ/2?1:-1, f=add("table",x,z,.92,.92,{side,places:2,finish:service.style,corner:true,into});
      if(f){seats.push({x:x-side*.62,z,yaw:side*Math.PI/2},{x,z:z+into*.62,yaw:into>0?0:Math.PI});}
    }
  };
  if(service.style!=="counter")corners(.62);
  // Dining bays leave an uninterrupted path from the door to the pass.
  for(let z=1.32;z+1<counterZ-.65;z+=service.style==="dining"?3.25:2.96){
    for(const [lo,hi] of spans(ring,z))for(const side of [-1,1]){
      const edge=side<0?lo:hi;
      const clear=side<0?aisle-.68-lo:hi-aisle-.68;
      const count=Math.floor((clear+.60)/2.85);
      if(!count && clear>1.21){
        const x=edge-side*.57;
        const f=add("ledge",x,z,1.02,1.54,{side,places:2,finish:service.style});
        if(f)for(const offset of [-.43,.43])seats.push({x:x-side*.27,z:z+offset,yaw:side*Math.PI/2});
      }
      for(let i=0;i<count;i++){
        const x=edge-side*(1.09+2.85*i);
        const byWindow=windows.some(win=>Math.hypot(win.x-x,win.z-z)<2.65);
        // Against the wall: a cushioned booth at a diner, a laminate one at a counter place (not
        // in a window, where a table looks out), an upholstered banquette in fine dining.
        const booth=i===0 && (service.style!=="counter" || (!byWindow && z>2));
        const four=booth || (service.style==="dining" && (i>0 || z<2 || clear<4.3)) || (clear>4.5 && i===0 && z<2);
        const f=add(booth?(service.style==="dining"?"banquette":"booth"):"table",x,z,1.98,four?2.18:1.55,{side,places:four?4:2,finish:service.style,byWindow});
        if(f) for(let n=0;n<f.places;n++) seats.push({x:x+(four?(n%2? .36:-.36):0),z:z+(n<(four?2:1)?-.65:.65),yaw:n<(four?2:1)?Math.PI:0});
      }
    }
  }
  corners(counterZ-.95);
  // Fine dining: a host stand just inside the door, beside the way in.
  if(service.style==="dining") add("host",aisle+(aisle>0?-1:1)*.95,.75,.6,.45);
  const band=spans(ring,counterZ).find(([a,b])=>a<=aisle && b>=aisle);
  if(band){
    const [a,b]=band, left=aisle-a>b-aisle;
    const start=left?a+.13:aisle+.58, end=left?aisle-.58:b-.13;
    const width=Math.min(4.8,end-start);
    if(width>.36){
      const c=add("counter",left?end-width/2:start+width/2,counterZ,width,.56,{finish:service.style});
      // The tills: one a cashier at a counter place, else one for the floor; and the pass
      // behind, with its heat lamps and the order screen the line reads.
      if(c){c.tills=service.style==="counter"?Math.max(1,Math.min(3,Math.floor(width/1.3))):1;c.pass=service.style!=="counter"||width>2;}
    }
  }
  // Fit continuous banks against the back and side walls. Every bank faces the staff aisle.
  for(let z=available-.48;z>counterZ+.65;z-=.24){
    const span=spans(ring,z).filter(([a,b])=>b-a>1).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
    if(!span) continue;
    const [a,b]=span, n=Math.max(1,Math.floor((b-a-.15)/1.08)), w=(b-a-.18)/n;
    for(let i=0;i<n;i++) add("bench",a+.09+w*(i+.5),z,w-.08,.74);
    if(fixtures.some(f=>f.role==="bench"))break;
  }
  // The manager's desk and computer, against a side wall just behind the counter, where the crew
  // is big enough to have one (or it is fine dining).
  {
    const crew=restaurantStaff(seats.length||seatsGuess,service);
    if(crew.manager||service.style==="dining"||crew.total>=6){
      const z=counterZ+1.05, band=spans(ring,z).find(([a,b])=>b-a>3);
      if(band){const [a,b]=band, side=aisle-a>b-aisle?-1:1, x=side<0?a+.62:b-.62; add("office",x,z,1.1,.62,{side});}
    }
  }
  for(let z=counterZ+1.17;z<available-1.22;z+=1.28){
    for(const [a,b] of spans(ring,z))for(const side of [-1,1]){
      const x=side<0?a+.47:b-.47;
      if(Math.abs(x-aisle)>.97)add("bench",x,z,.74,1.16,{side});
    }
  }
  const banks=fixtures.filter(f=>f.role==="bench");
  // A very small takeaway shares a service worktop for prep and collection.
  if(!banks.length){const counter=fixtures.find(f=>f.role==="counter"); if(counter)banks.push(counter);}
  // Every station of the cuisine's kitchen game, and what any kitchen has: a sink to prep at, a
  // hand sink, and (past twenty seats) the dish pit's machine.
  const equipment=["sink","handsink","cooler","board","bowl",...service.stations.filter(s=>!["board","bowl","cooler"].includes(s)),...(seats.length>20?["dish"]:[])];
  const sorted=[...service.ingredients].sort((a,b)=>a.name.localeCompare(b.name));
  const stores=["dry","fridge","freezer"].map(kept=>({kept,bins:sorted.filter(i=>i.kept===kept)})).filter(s=>s.bins.length);
  const reserved=Math.min(stores.length,Math.max(0,banks.length-3));
  const work=banks.slice(0,banks.length-reserved);
  for(const f of banks){f.stations=[];f.bins=[];}
  // The hot line faces the rear wall, prep and wash share the return bench, and
  // beverages are nearest the pass. Small premises use several appliances per worktop.
  const hot=new Set(["oven","grill","stove","wok","fryer","tandoor","pizza_oven","steamer"]);
  equipment.sort((a,b)=>Number(hot.has(b))-Number(hot.has(a)));
  equipment.forEach((id,i)=>work[Math.min(work.length-1,Math.floor(i*work.length/equipment.length))]?.stations.push(id));
  stores.forEach((store,i)=>{
    if(i<reserved){
      const f=banks[work.length+i];f.role="pantry";f.kept=store.kept;f.bins=store.bins;
    }else store.bins.forEach((bin,i)=>work[i%work.length]?.bins.push(bin));
  });
  // Wall shelving (boxes, the spare plates and the takeaway packaging) wherever a side wall of
  // the kitchen is still bare.
  for(let z=counterZ+.9;z<available-.5;z+=.9)for(const [a,b] of spans(ring,z))for(const side of [-1,1]){
    const x=side<0?a+.24:b-.24;
    if(Math.abs(x-aisle)>1)add("shelf",x,z,.36,.82,{side});
  }
  const staff=restaurantStaff(seats.length,service);
  return {ring,fixtures,seats,aisle,counterZ,doorX,windows,service,depth:available,staff,kitchenDepth:available-counterZ};
}
export function canWalkRestaurant(plan,x,z,staff=false) {
  if(!boundsInside(plan.ring,x,z,.42,.42) || (!staff && z>plan.counterZ-.3))return false;
  return !plan.fixtures.some(f=>Math.abs(x-f.x)<f.w/2+.18 && Math.abs(z-f.z)<f.d/2+.18);
}


// Add the cook's equipment at the supplied fixture locations in a generated or edited tenancy.
// Furniture stays attached to its source room, with the door clearances of the original plan.
export function fittedKitchenFixtures(floor, service) {
  const kitchens=new Set(floor.rooms.filter(r=>["professional_kitchen","kitchen"].includes(r.kind)).map(r=>r.id));
  const furniture=floor.objects.filter(o=>kitchens.has(o.room_id));
  const make=(o,role)=>({role,x:o.position_m[0],z:o.position_m[2],y:o.position_m[1],w:o.size_m[0],height:o.size_m[1],d:o.size_m[2],
    yaw:Math.PI-o.rotation_deg*Math.PI/180,stations:[],bins:[],source:o.id});
  const work=furniture.filter(o=>["prep_table","prep_station","commercial_range","workbench"].includes(o.role)).map(o=>make(o,"equipment"));
  const racks=furniture.filter(o=>["dry_storage","commercial_fridge","refrigerator","freezer_case","storage_cabinet"].includes(o.role)).map(o=>({...make(o,"stock"),cold:!["dry_storage","storage_cabinet"].includes(o.role)}));
  for(const [i,id] of service.stations.filter(s=>!["cooler","board"].includes(s)).entries()) if(work.length)work[i%work.length].stations.push(id);
  const byTemp=new Map();
  for(const bin of service.ingredients){
    const cold=bin.kept!=="dry";
    const matching=racks.filter(f=>f.cold===cold);
    const slots=matching.length?matching:racks.length?racks:work;
    const i=byTemp.get(cold)||0;
    if(slots.length)slots[i%slots.length].bins.push(bin);
    byTemp.set(cold,i+1);
  }
  return [...work,...racks];
}
