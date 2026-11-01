import {Batch,cutExteriorWallBands} from '../../exteriors/renderer.mjs';

export function createSpecialtyRenderer(THREE,exteriors,{Reflector=null}={}){
 const materials=new Map(),textures=new Set();
 const mat=(color,metalness=0,roughness=.65)=>{const k=[color,metalness,roughness].join('|');if(!materials.has(k))materials.set(k,new THREE.MeshStandardMaterial({color,metalness,roughness}));return materials.get(k);};
 const glass=new THREE.MeshPhysicalMaterial({color:'#d6e6e7',metalness:.08,roughness:.08,transparent:true,opacity:.24,transmission:.12,side:THREE.DoubleSide,depthWrite:false});materials.set('glass',glass);
 const led=mat('#fff0ce',0,.3);led.emissive=new THREE.Color('#ffe2ad');led.emissiveIntensity=.8;
 const text=(value,ink='#e7f2e6',background='#203136')=>{const k=['text',value,ink,background].join('|');if(materials.has(k))return materials.get(k);
  const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,512,256);ctx.font='600 48px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=ink;String(value).split('\n').forEach((v,i,a)=>ctx.fillText(v,256,128+(i-(a.length-1)/2)*58));
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;textures.add(map);const m=new THREE.MeshStandardMaterial({map,roughness:.45});materials.set(k,m);return m;};
 const floorMaterial=(color,wood=false)=>{const k='floor'+color+wood;if(materials.has(k))return materials.get(k);
  const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,512,512);ctx.strokeStyle=wood?'#66564755':'#7f888044';ctx.lineWidth=2;
  for(let x=0;x<512;x+=wood?64:128){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,512);ctx.stroke();}for(let y=0;y<512;y+=wood?256:128){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(512,y);ctx.stroke();}
  if(wood){ctx.strokeStyle='#4f41361a';ctx.lineWidth=1;for(let i=0;i<100;i++){const x=(i*47)%512;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+6,512);ctx.stroke();}}
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(.55,.55);map.anisotropy=8;textures.add(map);const m=new THREE.MeshStandardMaterial({map,roughness:.72});materials.set(k,m);return m;};
 function mount(target,p){
  if(!p.validation?.passed)return null;
  const root=new THREE.Group(),batch=new Batch(THREE),ceiling=new THREE.Group();ceiling.name='specialtyCeiling';const s=p.style,floor=p.storeys[0],height=floor.height_m;
  const chrome=mat('#b8c2c3',.87,.17),dark=mat('#252e30'),wood=mat(s.wood),stone=mat(s.stone),fabric=mat(s.fabric),gold=mat('#b99a58',.82,.23),ceramic=mat('#eeeee7',.08,.2);
  let liveMirror=false;const doors=[];
  const matrix=(x,y,z,a=0)=>new THREE.Matrix4().makeTranslation(x,y,-z).multiply(new THREE.Matrix4().makeRotationY(a*Math.PI/180));
  const shapeGeometry=(poly,depth=0)=>{const rings=poly.coordinates,sh=new THREE.Shape(rings[0].map(q=>new THREE.Vector2(...q)));for(const h of rings.slice(1))sh.holes.push(new THREE.Path(h.map(q=>new THREE.Vector2(...q))));const g=depth?new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:false}):new THREE.ShapeGeometry(sh);g.rotateX(-Math.PI/2);return g;};
  const worldBox=(x,y,z,w,h,d,m,a=0)=>batch.add(new THREE.BoxGeometry(w,h,d),m,matrix(x,y,z,a));
  // Roof/cap visibility is separate from the canonical source facade and its apertures.
  const source=shapeGeometry(p.exterior.footprint,p.exterior.height_m),body=cutExteriorWallBands(THREE,source,p.exterior);source.dispose();
  if(!materials.has('hidden-cap'))materials.set('hidden-cap',new THREE.MeshStandardMaterial({visible:false}));
  const caps=materials.get('hidden-cap'),walls=mat(p.exterior.facades[0].palette.wall);
  const shell=new THREE.Mesh(body,[caps,walls]);shell.castShadow=true;shell.receiveShadow=true;root.add(shell);exteriors.mount(root,p.exterior);
  for(const r of floor.rooms){const g=shapeGeometry(r.polygon);g.translate(0,.012,0);batch.add(g,floorMaterial(r.id===floor.rooms[0].id&&p.kind!=='laundry'?s.wood:r.materials.floor,r.id===floor.rooms[0].id&&p.kind==='barber'),new THREE.Matrix4());}
  for(const w of floor.walls){const [a,b]=w.segment.coordinates,L=Math.hypot(b[0]-a[0],b[1]-a[1]),angle=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;worldBox((a[0]+b[0])/2,w.height_m/2,(a[1]+b[1])/2,L,w.height_m,w.thickness_m,mat(w.materials[0]),angle);worldBox((a[0]+b[0])/2,.08,(a[1]+b[1])/2,L,.16,.12,wood,angle);}
  // Each side of a room gets its own finish, including the wall behind fixtures.
  // Project the shared aperture ledger; a finish must never close an entrance or window.
  for(const r of floor.rooms)for(const ring of r.polygon.coordinates){
   const signed=ring.slice(1).reduce((a,q,i)=>a+ring[i][0]*q[1]-q[0]*ring[i][1],0);
   for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<.005)continue;
    const tx=(b[0]-a[0])/L,ty=(b[1]-a[1])/L,sgn=signed>0?1:-1;
    const openings=floor.openings.filter(o=>o.rooms.includes(r.id)).map(o=>({segment:o.segment.coordinates,v:0,h:o.height_m}));
    for(const o of p.envelope.windows){const ll=Math.hypot(o.b[0]-o.a[0],o.b[1]-o.a[1]),vx=(o.b[0]-o.a[0])/ll,vy=(o.b[1]-o.a[1])/ll;
     openings.push({segment:[[o.a[0]+vx*o.u,o.a[1]+vy*o.u],[o.a[0]+vx*(o.u+o.w),o.a[1]+vy*(o.u+o.w)]],v:o.v,h:o.h});}
    const wall=new THREE.Shape();wall.moveTo(0,0);wall.lineTo(L,0);wall.lineTo(L,height);wall.lineTo(0,height);wall.closePath();
    const cuts=[];for(const o of openings){const q=o.segment,dx=q[1][0]-q[0][0],dy=q[1][1]-q[0][1],ll=Math.hypot(dx,dy);
     if(!ll||Math.abs((dx*tx+dy*ty)/ll)<.999||q.some(c=>Math.abs((c[0]-a[0])*-ty+(c[1]-a[1])*tx)>.18))continue;
     const us=q.map(c=>(c[0]-a[0])*tx+(c[1]-a[1])*ty),u0=Math.max(0,Math.min(...us)),u1=Math.min(L,Math.max(...us)),v0=Math.max(0,o.v),v1=Math.min(height,o.v+o.h);if(u1-u0<.005||v1<=v0)continue;
     const hole=new THREE.Path();hole.moveTo(u0,v0);hole.lineTo(u0,v1);hole.lineTo(u1,v1);hole.lineTo(u1,v0);hole.closePath();wall.holes.push(hole);cuts.push({u0,u1,v0,v1});
    }
    const colour=i%3===0?r.materials.accent_wall:r.materials.wall;
    const key='finish'+colour;if(!materials.has(key)){const m=mat(colour).clone();m.side=THREE.DoubleSide;m.userData.roomFinish=true;materials.set(key,m);}
    const g=new THREE.ShapeGeometry(wall);batch.add(g,materials.get(key),matrix(a[0]-ty*sgn*.056,0,a[1]+tx*sgn*.056,Math.atan2(ty,tx)*180/Math.PI));
    // Skirting stops at low openings rather than crossing the doorway.
    let spans=[[0,L]];for(const c of cuts.filter(c=>c.v0<.16))spans=spans.flatMap(([u,v])=>[[u,Math.min(v,c.u0)],[Math.max(u,c.u1),v]].filter(([u,v])=>v-u>.005));
    for(const [u,v]of spans){const z=(u+v)/2;worldBox(a[0]+tx*z-ty*sgn*.065,.07,a[1]+ty*z+tx*sgn*.065,v-u,.14,.025,wood,Math.atan2(ty,tx)*180/Math.PI);}
   }
  }
  const cg=shapeGeometry(p.exterior.footprint);cg.translate(0,height-.01,0);if(!materials.has('ceiling'))materials.set('ceiling',new THREE.MeshStandardMaterial({color:'#ebe7de',side:THREE.DoubleSide}));const cm=new THREE.Mesh(cg,materials.get('ceiling'));ceiling.add(cm);root.add(ceiling);ceiling.visible=false;
  for(const o of floor.openings){if(o.entrance)continue;const [a,b]=o.hinge_end?[...o.segment.coordinates].reverse():o.segment.coordinates,L=Math.hypot(b[0]-a[0],b[1]-a[1]),angle=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI,hh=o.height_m;
   worldBox((a[0]+b[0])/2,hh+(height-hh)/2,(a[1]+b[1])/2,L,height-hh,.11,mat('#d6d4c8'),angle);
   for(const q of [a,b])worldBox(q[0],hh/2,q[1],.06,hh,.15,wood,angle);
   const pivot=new THREE.Group();pivot.position.set(a[0],0,-a[1]);pivot.rotation.y=angle*Math.PI/180;
   const leaf=new THREE.Group(),timber=floorMaterial(o.appearance?.timber||s.wood,true),glazed=Boolean(o.appearance?.glass);
   if(glazed){
    const outline=new THREE.Shape();outline.moveTo(.015,.02);outline.lineTo(L-.015,.02);outline.lineTo(L-.015,hh-.02);outline.lineTo(.015,hh-.02);outline.closePath();
    const hole=new THREE.Path();hole.moveTo(.14,1.02);hole.lineTo(.14,hh-.2);hole.lineTo(L-.14,hh-.2);hole.lineTo(L-.14,1.02);hole.closePath();outline.holes.push(hole);
    const geometry=new THREE.ExtrudeGeometry(outline,{depth:.045,bevelEnabled:false});geometry.translate(0,0,-.0225);leaf.add(new THREE.Mesh(geometry,timber));
    if(!materials.has('privacy-glass'))materials.set('privacy-glass',new THREE.MeshPhysicalMaterial({color:'#c7d8d0',transparent:true,opacity:.91,roughness:.55,side:THREE.DoubleSide}));
    const pane=new THREE.Mesh(new THREE.PlaneGeometry(L-.28,hh-1.22),materials.get('privacy-glass'));pane.position.set(L/2,(1.02+hh-.2)/2,0);leaf.add(pane);
    for(let u=.16;u<L-.14;u+=.025){const reed=new THREE.Mesh(new THREE.BoxGeometry(.006,hh-1.22,.008),materials.get('privacy-glass'));reed.position.set(u,pane.position.y,.006);leaf.add(reed);}
   }else{const slab=new THREE.Mesh(new THREE.BoxGeometry(L-.03,hh-.04,.045),timber);slab.position.set(L/2,hh/2,0);leaf.add(slab);}
   const panels=glazed?1:(o.appearance?.panel_count||2);
   for(let i=0;i<panels;i++)for(const sign of [-1,1]){const panel=new THREE.Mesh(new THREE.BoxGeometry(L*.7,glazed?.56:(hh-.55)/panels-.09,.012),timber);panel.position.set(L/2,glazed?.51:.25+(i+.5)*(hh-.55)/panels,sign*.028);leaf.add(panel);}
   for(const sign of [-1,1]){const handle=new THREE.Mesh(new THREE.BoxGeometry(.14,.022,.035),chrome);handle.position.set(L-.15,1.05,sign*.05);leaf.add(handle);}
   const doorBatch=new Batch(THREE);for(const part of [...leaf.children]){part.updateMatrix();doorBatch.add(part.geometry,part.material,part.matrix);leaf.remove(part);}doorBatch.finish(leaf,{measured:false,inferred:true});
   leaf.rotation.y=o.open_angle_deg*Math.PI/180;pivot.add(leaf);root.add(pivot);doors.push({leaf,level:0,open:true,openAngle:o.open_angle_deg*Math.PI/180,segment:o.segment.coordinates,openSegment:o.open_leaf_segment.coordinates});
  }
  const addItem=o=>{
   const [x,y,z]=o.position_m,[w,h,d]=o.size_m,a=o.rotation_deg,M=matrix(x,y,z,a);
   const add=(g,m,u=0,v=0,e=0,rx=0,ry=0,rz=0)=>{const local=new THREE.Matrix4().makeTranslation(u,e,-v).multiply(new THREE.Matrix4().makeRotationX(rx)).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeRotationZ(rz));batch.add(g,m,M.clone().multiply(local));};
   const box=(u,v,e,bw,bh,bd,m=wood)=>add(new THREE.BoxGeometry(bw,bh,bd),m,u,v,e);
   const cyl=(u,v,e,r,hh,m=chrome)=>add(new THREE.CylinderGeometry(r,r,hh,16),m,u,v,e);
   const orb=(u,v,e,sx,sy,sz,m)=>{const g=new THREE.SphereGeometry(1,16,10);g.scale(sx,sy,sz);add(g,m,u,v,e);};
   const front=(u,v,e,bw,bh,m)=>add(new THREE.PlaneGeometry(bw,bh),m,u,v,e,0,Math.PI);
   const ring=(u,v,e,r,t,m,rx=0)=>add(new THREE.TorusGeometry(r,t,8,28),m,u,v,e,rx);
   const pipe=(pts,r=.012,m=chrome)=>{const curve=new THREE.CatmullRomCurve3(pts.map(q=>new THREE.Vector3(q[0],q[2],-q[1])));batch.add(new THREE.TubeGeometry(curve,16,r,6,false),m,M);};
   const legs=(ww,dd,top)=>{for(const xx of [-ww/2+.065,ww/2-.065])for(const zz of [-dd/2+.065,dd/2-.065])box(xx,zz,top/2,.045,top,.045,chrome);};
   const bottles=(v,e,count=5)=>{for(let i=0;i<count;i++){const u=-w*.35+i*w*.7/Math.max(1,count-1);cyl(u,v,e+.075,.033,.15,mat(['#b6bfa7','#a67c5b','#789e9b'][i%3]));cyl(u,v,e+.165,.023,.03,dark);}};
   const chair=(v,base=.45,recline=0)=>{
    cyl(0,v,.055,.26,.07,chrome);cyl(0,v,.24,.075,.32,dark);box(0,v,base,.62,.14,.62,fabric);add(new THREE.BoxGeometry(.62,.58,.12),fabric,0,v-.27-recline*.2,base+.32,-recline);
    for(const u of [-.35,.35]){box(u,v,base+.2,.07,.08,.58,fabric);box(u,v-.18,base+.1,.035,.25,.04,chrome);}
    pipe([[-.26,v+.4,.2],[-.26,v+.48,.17],[.26,v+.48,.17],[.26,v+.4,.2]],.018);box(0,v+.47,.18,.52,.025,.18,dark);
    if(p.kind==='barber'){box(0,v-.28,base+.67,.28,.13,.14,fabric);for(let i=0;i<5;i++)box(-.23+i*.115,v+.31,base+.01,.003,.08,.012,mat('#a78173'));}
   };
   const jewelry=(v,e,count,width)=>{
    for(let i=0;i<count;i++){const u=-width*.34+i*width*.68/Math.max(1,count-1),velvet=mat(s.fabric);box(u,v,e+.012,.23,.024,.24,velvet);
     if(i%3===0){orb(u,v,e+.13,.09,.12,.065,velvet);ring(u,v+.05,e+.13,.071,.006,gold,Math.PI*.32);orb(u,v+.08,e+.1,.015,.018,.012,mat('#b9d8d7',.35,.05));}
     else if(i%3===1){ring(u,v,e+.078,.045,.009,gold);add(new THREE.OctahedronGeometry(.025),mat('#bbdce4',.4,.04),u,v,e+.135);}
     else {box(u,v,e+.039,.09,.03,.09,velvet);ring(u,v,e+.068,.045,.012,dark,Math.PI*.35);orb(u,v+.025,e+.10,.043,.014,.043,chrome);box(u,v+.025,e+.116,.035,.003,.035,mat('#263738'));}
    }
   };
   if(['jewelry_wall_case','jewelry_island'].includes(o.role)){
    const wall=o.role==='jewelry_wall_case',base=wall?.5:.64;box(0,0,base/2,w,base,d,wood);box(0,0,base+.025,w,.05,d,stone);
    for(const u of [-w/2+.025,w/2-.025])for(const v of [-d/2+.025,d/2-.025])box(u,v,(base+h)/2,.025,h-base,.025,gold);
    for(const v of [-d/2,d/2])front(0,v,(base+h)/2,w,h-base,glass);for(const u of [-w/2,w/2])add(new THREE.PlaneGeometry(d,h-base),glass,u,0,(base+h)/2,0,Math.PI/2);
    box(0,0,h-.018,w,.035,d,glass);box(0,-d/2+.045,h-.06,w-.1,.018,.025,led);
    if(wall){box(0,-d/2+.025,(base+h)/2,w,h-base,.04,mat('#e2dacb'));for(const e of [base+.07,1.13]){box(0,0,e,w-.06,.02,d-.04,glass);jewelry(0,e+.012,Math.max(2,Math.floor(w/.34)),w-.12);}}
    else jewelry(0,base+.052,Math.max(3,Math.floor(w/.3)),w-.1);
    for(const u of [-w*.24,w*.24])box(u,d/2+.006,.28,.14,.016,.02,gold);
   }else if(o.role==='styling_station'){
    const back=-d/2+.25;box(0,back,.48,w-.14,.96,.46,wood);box(0,back,.99,w-.1,.055,.5,stone);chair(.15);
    const mw=w*.72,mh=.95,my=1.56,mv=-d/2+.07;box(0,mv,my,mw+.08,mh+.08,.06,chrome);
    if(Reflector&&!liveMirror){const mirror=new Reflector(new THREE.PlaneGeometry(mw,mh),{color:0xd0d7d5,textureWidth:1024,textureHeight:1024,clipBias:.003});mirror.position.set(0,my,-mv-.04);mirror.rotation.y=Math.PI;mirror.applyMatrix4(M);root.add(mirror);liveMirror=true;}else front(0,mv+.04,my,mw,mh,mat('#b3c2c4',.55,.13));
    for(const xx of [-mw/2-.035,mw/2+.035])box(xx,mv+.046,my,.02,mh,.012,led);
    bottles(back+.1,1.0175,3);box(-w*.3,back+.1,1.035,.16,.022,.08,dark);pipe([[w*.28,back+.08,1.05],[w*.32,back+.08,1.10],[w*.4,back+.08,1.10]],.028,dark);
    for(const xx of [-w*.3,w*.3])box(xx,back+.24,.62,.16,.025,.025,chrome);
   }else if(o.role==='shampoo_station'){
    chair(.42,.4,.25);orb(0,-.37,.92,.37,.18,.33,ceramic);orb(0,-.37,.97,.29,.11,.25,mat('#253132',.15,.18));ring(0,-.37,1.02,.29,.026,ceramic,Math.PI/2);
    box(0,-.37,.48,.43,.8,.43,dark);pipe([[.24,-.58,.98],[.24,-.58,1.19],[.14,-.44,1.19],[.12,-.39,1.12]],.018);pipe([[-.26,-.5,1.0],[-.34,-.5,.72],[-.27,-.4,.68],[-.22,-.35,1.0]],.012,dark);
   }else if(['commercial_washer','stacked_dryer'].includes(o.role)){
    box(0,-.03,h/2,w-.04,h,d-.1,mat('#c9d0cf',.55,.3));box(0,d/2-.065,h/2,w-.07,h-.07,.025,mat('#eeeFEB',.15,.35));
    const rows=o.role==='stacked_dryer'?[h*.28,h*.74]:[h*.49];
    for(const e of rows){const r=Math.min(w*.32,.29);add(new THREE.CylinderGeometry(r,r,.03,32),dark,0,d/2-.045,e,Math.PI/2);ring(0,d/2-.022,e,r,.028,chrome);orb(0,d/2-.018,e,r*.84,r*.84,.022,glass);
     for(let i=0;i<12;i++){const t=i*Math.PI/6;orb(Math.sin(t)*r*.65,d/2-.025,e+Math.cos(t)*r*.65,.014,.014,.005,chrome);}box(r*.9,d/2+.002,e,.045,.16,.045,dark);
    }
    const screen=h-.13;front(-w*.13,d/2-.018,screen,w*.36,.11,text(o.role==='stacked_dryer'?'READY':'40°  NORMAL'));add(new THREE.CylinderGeometry(.035,.035,.04,16),chrome,w*.27,d/2-.008,screen,Math.PI/2);
    for(let i=0;i<5;i++)box(-w*.28+i*w*.14,d/2-.01,.08,w*.085,.01,.006,dark);
   }else if(o.role==='folding_table'||o.role==='jeweler_bench'){
    legs(w,d,h-.06);box(0,0,h-.03,w,.06,d,stone);for(let i=0;i<3;i++)box(-w*.23,.02,h+.0135+i*.027,w*.25,.027,d*.5,mat(['#d6c5a4','#779a94','#dce1d8'][i]));
    if(o.role==='jeweler_bench'){front(0,-d/2+.03,1.25,.65,.35,text('TOOLS','#3c4540','#d5cabc'));}
   }else if(o.role==='laundry_cart'){
    for(const u of [-w*.38,w*.38])for(const v of [-d*.38,d*.38])orb(u,v,.07,.055,.065,.04,dark);
    for(let j=0;j<6;j++){const u=-w/2+j*w/5;pipe([[u,-d/2,.23],[u,-d/2,h],[u,d/2,h],[u,d/2,.23]],.009);}
    for(let j=0;j<5;j++){const e=.25+j*(h-.25)/4;pipe([[-w/2,-d/2,e],[w/2,-d/2,e],[w/2,d/2,e],[-w/2,d/2,e],[-w/2,-d/2,e]],.009);}box(0,0,.28,w-.08,.09,d-.08,mat('#a0b4ba'));
   }else if(o.role==='consultation_set'){
    cyl(0,0,.36,.055,.67,chrome);cyl(0,0,.045,.24,.06,chrome);cyl(0,0,.72,.30,.055,wood);
    for(const sign of [-1,1]){const u=sign*w*.34;box(u,0,.44,.42,.13,.45,fabric);box(u+sign*.18,0,.66,.08,.42,.45,fabric);for(const v of [-.17,.17])box(u,v,.22,.035,.4,.035,chrome);}
    box(0,0,.758,.16,.021,.18,mat('#e4dccb'));ring(0,0,.80,.035,.006,gold);
   }else if(o.role==='waiting_bench'){
    legs(w,d,.37);box(0,0,.44,w,.14,d,fabric);box(0,-d/2+.07,.66,w,.35,.12,fabric);
   }else if(o.role==='reception_desk'){
    box(0,0,h/2,w,h,d,wood);box(0,0,h+.025,w+.02,.05,d+.02,stone);box(-w*.22,0,h+.13,.3,.2,.08,dark);front(-w*.22,.045,h+.13,.26,.14,text('WELCOME'));
    for(const u of [-w*.27,w*.27])box(u,d/2+.01,.7,.16,.025,.025,chrome);box(w*.25,0,h+.05,.15,.05,.15,mat('#f0e4cc'));
   }else if(o.role==='toilet'){
    orb(0,.1,.38,.23,.17,.31,ceramic);orb(0,.1,.47,.16,.015,.23,dark);box(0,-.23,.58,.43,.37,.18,ceramic);cyl(0,.03,.17,.16,.26,ceramic);
   }else if(['utility_sink','bath_sink'].includes(o.role)){
    box(0,0,.43,w,.86,d,wood);orb(0,0,.85,w*.48,.09,d*.45,ceramic);orb(0,0,.90,w*.34,.045,d*.3,dark);pipe([[0,-d*.33,.92],[0,-d*.33,1.08],[0,.03,1.08],[0,.04,1.03]],.018);
   }else if(o.role==='jewelry_safe'){
    box(0,0,h/2,w,h,d,mat('#3e4548',.7,.28));box(0,d/2+.01,h/2,w*.84,h*.84,.06,mat('#626969',.6,.28));ring(w*.15,d/2+.05,h*.55,.085,.012,chrome);front(-w*.2,d/2+.05,h*.7,.12,.1,text('LOCK'));for(const e of [h*.25,h*.75])box(-w*.45,d/2+.04,e,.04,.09,.04,chrome);
   }else if(['product_cabinet','towel_storage'].includes(o.role)){
    box(0,-d/2+.03,h/2,w,h,.055,wood);for(const u of [-w/2+.025,w/2-.025])box(u,0,h/2,.05,h,d,wood);
    for(let e=.15;e<h;e+=.37){box(0,0,e,w,.04,d,wood);if(o.role==='product_cabinet')bottles(0,e+.02,4);else for(let j=0;j<3;j++)box(0,0,e+.035+j*.025,w*.7,.025,d*.75,mat(j%2?'#a7bcb3':'#ece4d0'));}
   }else if(['laundry_payment','detergent_vending'].includes(o.role)){
    box(0,0,h/2,w,h,d,mat(s.accent));front(0,d/2+.008,h*.68,w*.73,h*.36,text(o.role==='laundry_payment'?'PAY / TAP\nSELECT MACHINE':'SOAP / SOFTENER'));
    if(o.role==='detergent_vending'){for(let i=0;i<3;i++){box(-w*.26+i*w*.26,d/2+.014,h*.35,.13,.26,.04,mat(['#cc9f4b','#b75744','#699992'][i]));}}box(0,d/2+.02,h*.18,w*.55,.1,.02,dark);
   }else box(0,0,h/2,w,h,d,wood);
  };
  for(const o of floor.objects)addItem(o);
  // Repeated luminaires sit on a regular grid, clipped to the actual shop outline.
  const main=floor.rooms[0],pts=main.polygon.coordinates[0],xs=pts.map(q=>q[0]),zs=pts.map(q=>q[1]);
  const inside=(x,z)=>{let n=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++)if((pts[i][1]>z)!==(pts[j][1]>z)&&x<(pts[j][0]-pts[i][0])*(z-pts[i][1])/(pts[j][1]-pts[i][1])+pts[i][0])n=!n;return n;};
  let lit=0;for(let x=Math.min(...xs)+1.0;x<Math.max(...xs);x+=2.5)for(let z=Math.min(...zs)+1;z<Math.max(...zs);z+=2.5)if(inside(x,z)){
   worldBox(x,height-.12,z,p.kind==='laundry'?1.1:.32,.06,p.kind==='laundry'?.15:.32,led);
   if(lit++<5){const light=new THREE.PointLight(p.kind==='laundry'?'#eff8ff':'#fff0d7',22,7,2);light.position.set(x,height-.22,-z);root.add(light);}
  }
  batch.finish(root,{measured:false,inferred:true});root.userData={shop:p.id,doors,ceiling,liveMirror};target.add(root);return root;
 }
 return {mount,dispose(){for(const m of materials.values())m.dispose();for(const t of textures)t.dispose();glass.dispose();}};
}
