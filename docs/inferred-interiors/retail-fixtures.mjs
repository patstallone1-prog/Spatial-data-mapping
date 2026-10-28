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
 if(['checkout_lane','self_checkout'].includes(o.role)){
  box(w,.85,d,0,.425,0,wood);box(w,.05,d,0,.875,0,metal);
  if(o.role==='checkout_lane'){box(w*.74,.025,d*.62,0,.912,-d*.12,dark);for(const z of [-d*.43,d*.18])box(w*.82,.03,.04,0,.925,z,metal);}
  else{box(w*.65,.025,d*.45,0,.91,-d*.2,dark);box(w*.7,.04,d*.3,0,.92,d*.28,white);}
  box(.09,.10,.06,w*.30,.96,d*.12,dark);const screen=box(.23,.12,.025,w*.30,1.02,d*.12,accent);screen.rotation.x=-.25;
  return true;
 }
 const cold=['refrigerated_case','freezer_case','drink_cooler'].includes(o.role);
 if(cold){
  box(w,.13,d,0,.065,0,dark);box(w,h,.06,0,h/2,-d/2+.03,white);
  for(const x of [-w/2+.025,w/2-.025])box(.05,h,d,x,h/2,0,metal);
  box(w,.11,d,0,h-.055,0,accent);
  for(const row of o.stock||[]){
   const y=row.bottom_m;box(w-.08,.035,d-.10,0,y-.0175,0,white);
   const n=Math.max(3,Math.min(18,Math.floor(w/.16)));
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
  box(w,.4,d,0,.2,0,wood);
  for(const y of [.48,.86]){box(w,.04,d,0,y-.02,0,wood);
   for(let iz=0;iz<7;iz++)for(let ix=0;ix<3;ix++){
    const mat=colours[(iz+ix+(o.stock_seed||0))%3],m=new THREE.Mesh(new THREE.SphereGeometry(.07,8,6),mat);
    m.position.set((ix-1)*w*.27,y+.07,(iz-3)*d*.13);parent.add(m);}
   for(const z of [-d/2+.02,d/2-.02])box(w,.11,.035,0,y+.03,z,wood);
  }return true;
 }
 // Double-sided gondolas and low glazed bakery shelves, with end caps and ticket rails.
 for(const x of [-w/2+.025,w/2-.025])for(const z of [-d/2+.03,d/2-.03])box(.035,h,.035,x,h/2,z,metal);
 box(.045,h,d,0,h/2,0,white);
 for(const row of o.stock||[]){
  box(w,.035,d,0,row.bottom_m-.0175,0,o.role==='bakery_display'?wood:white);
  for(const x of [-w/2+.02,w/2-.02])box(.035,.045,d,x,row.bottom_m+.005,0,accent);
  for(let iz=0;iz<Math.max(3,Math.floor(d/.18));iz++)for(const side of [-1,1]){
   const z=-d*.43+iz*.18;if(z>d*.44)continue;
   product(side*w*.28,row.bottom_m,z,iz+side,row.form==='bottles',o.role==='bakery_display'?.8:1);
  }
 }
 box(w,.08,d,0,h-.04,0,accent);
 if(o.role==='bakery_display')for(const x of [-w/2+.02,w/2-.02])box(.012,h*.62,d,x,h*.58,0,glass);
 stockMeshes();return true;
}
