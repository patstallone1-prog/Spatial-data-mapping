// All fixture details stay within the serialized collision/support envelope.
// Product packs rest on the same shelf heights recorded in the inference output.
export function retailFixture(THREE,parent,o,style){
 const roles=['gondola_shelf','produce_bin','bakery_display','refrigerated_case','freezer_case','drink_cooler','checkout_lane','self_checkout'];
 if(!roles.includes(o.role))return false;
 const [w,h,d]=o.size_m,metal=new THREE.MeshStandardMaterial({color:'#b9c0be',roughness:.5,metalness:.3}),
 dark=new THREE.MeshStandardMaterial({color:'#353e3c',roughness:.6}),
 wood=new THREE.MeshStandardMaterial({color:style.wood,roughness:.7}),
 white=new THREE.MeshStandardMaterial({color:'#e2e5df',roughness:.65}),
 accent=new THREE.MeshStandardMaterial({color:style.accent,roughness:.55}),
 glass=new THREE.MeshStandardMaterial({color:'#bfdbd6',transparent:true,opacity:.18,roughness:.12,depthWrite:false});
 const palettes=['#c76737','#e5b84d','#6e9665','#c1bba3','#a74143','#537b93','#ded8be'];
 const colours=palettes.map(color=>new THREE.MeshStandardMaterial({color,roughness:.68}));
 const box=(ww,hh,dd,x,y,z,mat=metal)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(ww,hh,dd),mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
 const stock=[];
 const product=(x,y,z,i,bottle=false,scale=1)=>stock.push({x,y,z,i,bottle,scale});
 // Real products where the City's object kit is running (view.mjs sets the hook): each shelf
 // of this fixture, in its own frame, gets the store's products for its section faced on it
 // (shelf-stock.mjs); the coloured stand-in packs are drawn only where it is not.
 const realShelves=[],shelfAt=(x,y,z,yaw,len,deep,h,display)=>realShelves.push({section:o.section||'pantry',x,y,z,yaw,len,deep,h,...(display?{display}:{})});
 const hook=globalThis.kerbsideStockShelf;
 const stockReal=()=>Boolean(hook&&realShelves.length&&hook(parent,realShelves,{section:o.section,kind:style.label,id:o.id}));
 const stockMeshes=()=>{
  const packs=stock.filter(p=>!p.bottle),bottles=stock.filter(p=>p.bottle),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
  const instances=(rows,geometry,dimensions,offset,colour)=>{
   if(!rows.length)return;
   const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.65}),rows.length);
   rows.forEach((p,i)=>{matrix.compose(new THREE.Vector3(p.x,p.y+offset*p.scale,p.z),q,new THREE.Vector3(...dimensions.map(v=>v*p.scale)));mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(colour||palettes[(p.i+(o.stock_seed||0)+7)%palettes.length]));});
   mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
  };
  instances(packs,new THREE.BoxGeometry(1,1,1),[.095,.17,.11],.085);
  instances(bottles,new THREE.CylinderGeometry(.78,1,1,8),[.045,.14,.045],.07);
  instances(bottles,new THREE.BoxGeometry(1,1,1),[.04,.035,.04],.1575,'#e2e5df');
 };
 // Where the City pays for what is in your basket (view.mjs shop-floor.mjs sets the hook).
 if(o.role==='checkout_lane'||o.role==='self_checkout')globalThis.kerbsideTill?.(parent,{role:o.role,id:o.id,size:o.size_m});
 if(o.role==='checkout_lane'){
  // The lane: the belt counter (belt, divider rail, the scanner's glass), the register's screen
  // on its arm and the card terminal, the bagging well with its carousel, the lane light's
  // pole with its number box, and an impulse rack at the queue end. (Size: w across, d along.)
  const belt=new THREE.MeshStandardMaterial({color:'#1f2224',roughness:.85}),screen=new THREE.MeshStandardMaterial({color:'#1b2a33',roughness:.3,emissive:'#0d1a22'}),lamp=new THREE.MeshStandardMaterial({color:'#f7fbff',emissive:'#e8f2ff',emissiveIntensity:.6});
  box(w*.62,.88,d,-w*.19,.44,0,accent);box(w*.66,.03,d+.02,-w*.19,.895,0,white);
  box(w*.46,.02,d*.6,-w*.19,.92,-d*.18,belt);box(w*.5,.03,.05,-w*.19,.93,-d*.49,metal);box(w*.5,.03,.05,-w*.19,.93,d*.13,metal);
  box(w*.4,.015,.36,-w*.19,.915,d*.2,glass);box(w*.42,.26,.04,-w*.19+w*.21,1.05,d*.2,dark);
  box(.36,.18,.34,w*.25,.75,d*.32,dark);const arm=box(.05,.45,.05,w*.25,1.05,d*.32,metal);void arm;const s1=box(.34,.24,.03,w*.25,1.36,d*.30,screen);s1.rotation.y=Math.PI/2;
  box(.09,.14,.07,-w*.42,1.0,d*.27,dark);
  box(w*.6,.02,.6,-w*.19,.72,d*.4,white);for(let i=0;i<3;i++)box(.2,.3,.005,-w*.19+Math.cos(i*2.1)*.14,1.0,d*.4+Math.sin(i*2.1)*.14,new THREE.MeshStandardMaterial({color:'#eef1f3',transparent:true,opacity:.7}));
  box(.04,2.5,.04,w*.42,1.25,d*.45,metal);box(.26,.26,.26,w*.42,2.45,d*.45,lamp);box(.27,.11,.27,w*.42,2.45,d*.45,new THREE.MeshStandardMaterial({color:'#1f7a4d'}));
  for(const y of [.32,.66,1.0]){box(w*.36,.02,.2,w*.3,y,-d*.4,white);shelfAt(w*.3,y+.01,-d*.4,-Math.PI/2,.2>w*.36?.2:w*.34,.18,.3,'counter');}
  box(w*.36,1.1,.02,w*.3,.55,-d*.4-.1,dark);
  if(!stockReal())for(let i=0;i<6;i++)product(w*.3,.33+(i%3)*.34,-d*.4,i,false,.6);
  stockMeshes();return true;
 }
 if(o.role==='self_checkout'){
  // A kiosk: the pedestal, the scanner bed and its scale, the touch screen on its post, the
  // card reader, the bagging scale with its bag rack, the lane light.
  const screen=new THREE.MeshStandardMaterial({color:'#1b2a33',roughness:.3,emissive:'#123044',emissiveIntensity:.5});
  box(w*.55,.9,d*.8,-w*.2,.45,0,white);box(w*.57,.03,d*.85,-w*.2,.915,0,glass);
  const sc=box(.4,.3,.04,-w*.2,1.25,d*.3,screen);sc.rotation.x=-.25;box(.05,.3,.05,-w*.2,1.05,d*.32,dark);
  box(.1,.16,.08,w*.05,1.0,-d*.25,dark);box(.1,.12,.1,-w*.42,.98,d*.2,dark);
  box(w*.38,.04,d*.7,w*.3,.72,0,metal);for(const z of [-d*.3,d*.3])box(w*.34,.5,.015,w*.3,.98,z,metal);box(w*.34,.72,d*.6,w*.3,.36,0,white);
  box(.03,1.1,.03,-w*.42,1.6,d*.3,metal);box(.14,.14,.14,-w*.42,2.18,d*.3,new THREE.MeshStandardMaterial({color:'#1f7a4d',emissive:'#0d3a22'}));
  return true;
 }
 const cold=['refrigerated_case','freezer_case','drink_cooler'].includes(o.role);
 if(cold){
  box(w,.13,d,0,.065,0,dark);box(w,h,.06,0,h/2,-d/2+.03,white);
  for(const x of [-w/2+.025,w/2-.025])box(.05,h,d,x,h/2,0,metal);
  box(w,.11,d,0,h-.055,0,accent);
  const rows=o.stock||[];
  rows.forEach((row,j)=>{const y=row.bottom_m;box(w-.08,.035,d-.10,0,y-.0175,0,white);shelfAt(0,y,d*.05,Math.PI,w-.12,d*.6,Math.max(.2,(rows[j+1]?.bottom_m??h-.2)-y-.04));});
  if(!stockReal())for(const row of rows){
   const y=row.bottom_m,n=Math.max(3,Math.min(18,Math.floor(w/.16)));
   for(let i=0;i<n;i++)for(let k=0;k<2;k++)product(-w*.43+i*w*.86/(n-1),y,-d*.15+k*d*.38,i+k,row.form==='bottles',.9);
  }
  const doors=Math.max(1,Math.round(w/.65));
  for(let i=0;i<doors;i++){
   const x=-w/2+(i+.5)*w/doors;box(w/doors-.015,h-.23,.012,x,h/2,d/2-.02,glass);
   box(.018,h-.22,.03,x-w/doors/2+.015,h/2,d/2-.01,metal);box(.018,.30,.025,x+w/doors*.36,h*.52,d/2-.005,dark);
  }
  stockMeshes();return true;
 }
 if(o.role==='produce_bin'){
  // A farm-stand bin: a dark base, two tiers stepping up from each long side, price rails and
  // crate dividers; the produce heaped on each tier.
  const deck=new THREE.MeshStandardMaterial({color:'#5a4029',roughness:.85});
  box(w*.9,.55,d,0,.275,0,new THREE.MeshStandardMaterial({color:'#4a3524',roughness:.9}));
  for(const side of [-1,1])for(const [y,x,ww] of [[.62,w*.3,w*.38],[.86,w*.1,w*.24]]){
   box(ww,.1,d,side*x,y-.05,0,deck);box(.025,.07,d,side*(x+ww/2),y+.02,0,wood);
   for(let k=1;k<4;k++)box(ww,.12,.02,side*x,y+.02,-d/2+k*d/4,wood);
   shelfAt(side*x,y,0,side>0?-Math.PI/2:Math.PI/2,d-.06,ww-.04,.22,'bin');
  }
  if(!stockReal())for(const side of [-1,1])for(const [y,x] of [[.62,w*.3],[.86,w*.1]])for(let iz=0;iz<7;iz++){
   const mat=colours[(iz+(side>0?1:0)+(o.stock_seed||0))%3],m=new THREE.Mesh(new THREE.SphereGeometry(.07,8,6),mat);
   m.position.set(side*x,y+.07,(iz-3)*d*.13);parent.add(m);}
  return true;
 }
 // Double-sided gondolas and low glazed bakery shelves, with end caps and ticket rails.
 for(const x of [-w/2+.025,w/2-.025])for(const z of [-d/2+.03,d/2-.03])box(.035,h,.035,x,h/2,z,metal);
 box(.045,h,d,0,h/2,0,white);
 for(const row of o.stock||[]){
  box(w,.035,d,0,row.bottom_m-.0175,0,o.role==='bakery_display'?wood:white);
  for(const x of [-w/2+.02,w/2-.02])box(.035,.045,d,x,row.bottom_m+.005,0,accent);
  for(const side of [-1,1])shelfAt(side*w*.26,row.bottom_m,0,side>0?-Math.PI/2:Math.PI/2,d-.08,w*.42,.32);
 }
 if(!stockReal())for(const row of o.stock||[])for(let iz=0;iz<Math.max(3,Math.floor(d/.18));iz++)for(const side of [-1,1]){
   const z=-d*.43+iz*.18;if(z>d*.44)continue;
   product(side*w*.28,row.bottom_m,z,iz+side,row.form==='bottles',o.role==='bakery_display'?.8:1);
 }
 box(w,.08,d,0,h-.04,0,accent);
 if(o.role==='bakery_display')for(const x of [-w/2+.02,w/2-.02])box(.012,h*.62,d,x,h*.58,0,glass);
 stockMeshes();return true;
}
