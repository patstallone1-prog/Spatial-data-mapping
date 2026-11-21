// The plan and its collision bounds share restaurant-local metres, +Z away from the entrance.
export function restaurantScene(T,plan,{doc,name,finish={},shellEnabled=true}) {
  const group=new T.Group(), surfaces=new Map(), geo=new Map(), batches=new Map();
  const material=(c,extra={})=>{const k=c+JSON.stringify(extra);if(!surfaces.has(k))surfaces.set(k,new T.MeshLambertMaterial({color:c,emissive:new T.Color(c).multiplyScalar(.30),...extra}));return surfaces.get(k);};
  const wood=material(finish.wood||0x9a6742), dark=material(0x30383a), steel=material(0xaab8b7), edge=material(0x647575),
    cloth=material(finish.fabric||0x705749),cream=material(0xece4d1),white=material(0xf7f2df),brass=material(0xb3915f),
    stone=material(0xc2bba8), glass=material(0x799593),ink=material(0x293331), green=material(0x657b4a), red=material(0xa65843);
  // The tier's materials (restaurant-room.mjs SERVICE_TIERS): brushed metal tops and moulded
  // seats at a counter place, oiled wood and cushioned vinyl at a diner, linen and upholstery in
  // fine dining.
  const metalTop=material(0xc9d0d2), chrome=material(0xdfe4e6), plastic=material(finish.seat||0xc8452f),
    vinyl=material(finish.vinyl||0x7e2b27), darkWood=material(finish.darkWood||0x5b3a24), linen=material(0xf4f1e8),
    velvet=material(finish.fabric||0x3d4f5c), screen=material(0x1d3b4a), lamp=material(0xffd27a), boxes=material(0xb08d5e);
  const matrix=new T.Matrix4(),rot=new T.Quaternion(),pos=new T.Vector3(),scale=new T.Vector3();
  const identity=new T.Matrix4();let frame=identity;
  // Every place to sit, in the room's own metres: where the seat is and the way a sitter faces
  // (``yaw`` as the walker's: 0 looks along -z), for a click on a chair (view.mjs seatClicked).
  const seats=[];
  function seat(x,z,s,y=.46){
    const at=new T.Vector3(x,y,z).applyMatrix4(frame), ahead=new T.Vector3(x,y,z-s).applyMatrix4(frame);
    seats.push({x:at.x,y:at.y,z:at.z,yaw:Math.atan2(-(ahead.x-at.x),-(ahead.z-at.z))});
  }
  function primitive(kind,x,y,z,w,h,d,m){
    if(!geo.has(kind))geo.set(kind,kind==="box"?new T.BoxGeometry():new T.CylinderGeometry(.5,.5,1,20));
    const key=kind+m.uuid;if(!batches.has(key))batches.set(key,{geometry:geo.get(kind),m,instances:[]});
    matrix.compose(pos.set(x,y,z),rot,scale.set(w,h,d)).premultiply(frame);
    batches.get(key).instances.push(matrix.clone());
  }
  const box=(...a)=>primitive("box",...a),round=(...a)=>primitive("round",...a);
  function label(text,x,y,z,w,h){
    const c=doc.createElement("canvas");c.width=384;c.height=80;const g=c.getContext("2d");
    g.fillStyle="#263632";g.fillRect(0,0,384,80);g.fillStyle="#fff3d6";g.font="600 49px system-ui";g.textAlign="center";g.textBaseline="middle";g.fillText(text,192,42,366);
    const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
    const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:tex,side:T.DoubleSide}));
    mesh.rotation.y=Math.PI;mesh.position.set(x,y,z);mesh.applyMatrix4(frame);group.add(mesh);return mesh;
  }
  function shell(){
    const path=new T.Shape();plan.ring.forEach(([x,z],i)=>i?path.lineTo(x,-z):path.moveTo(x,-z));
    const surface=new T.ShapeGeometry(path);surface.rotateX(-Math.PI/2);
    const tile=plan.service.style==="counter", c=doc.createElement("canvas");c.width=c.height=128;
    const ctx=c.getContext("2d");ctx.fillStyle=finish.floor || (tile?"#b9b3a4":"#997b5b");ctx.fillRect(0,0,128,128);
    if(tile){ctx.fillStyle="#847f74";ctx.fillRect(0,0,2,128);ctx.fillRect(0,0,128,2);}
    else for(let j=0;j<4;j++){const y=j*32;ctx.fillStyle="#42372655";ctx.fillRect(0,y,128,1);ctx.fillRect((j*43)%128,y,1,32);
      for(let i=0;i<12;i++){ctx.fillStyle=i%3?"#7c674a36":"#ceb59044";ctx.fillRect((i*37+j*13)%128,y+2+(i*7)%28,12+(i*19)%65,1);}}
    const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(tile?1.8:.65,tile?1.8:.65);
    const floor=new T.Mesh(surface,new T.MeshLambertMaterial({map,color:0xffffff,emissive:0x24201a}));floor.position.y=.013;group.add(floor);
    // Behind the counter, the kitchen's quarry tile: red, square, grouted, and non-slip.
    if(Number.isFinite(plan.counterZ)&&plan.depth>plan.counterZ){
      const xs=plan.ring.map(p=>p[0]),k=doc.createElement("canvas");k.width=k.height=64;
      const kc=k.getContext("2d");kc.fillStyle="#9c5a43";kc.fillRect(0,0,64,64);kc.fillStyle="#6f4030";kc.fillRect(0,0,64,2);kc.fillRect(0,0,2,64);
      const km=new T.CanvasTexture(k);km.colorSpace=T.SRGBColorSpace;km.wrapS=km.wrapT=T.RepeatWrapping;
      const kw=Math.max(...xs)-Math.min(...xs),kd=plan.depth-plan.counterZ-.3;km.repeat.set(kw/.3,kd/.3);
      const tile=new T.Mesh(new T.PlaneGeometry(kw,kd).rotateX(-Math.PI/2),new T.MeshLambertMaterial({map:km,emissive:0x1d120d}));
      tile.position.set((Math.max(...xs)+Math.min(...xs))/2,.016,plan.counterZ+.3+kd/2);group.add(tile);
    }
    const ceiling=new T.Mesh(surface,material(finish.ceiling||0xeae4d8,{side:T.BackSide}));ceiling.position.y=3.16;group.add(ceiling);
    for(let i=1;i<plan.ring.length;i++){
      const [x,z]=plan.ring[i-1],[xx,zz]=plan.ring[i],len=Math.hypot(xx-x,zz-z);
      if(!len)continue;
      const ux=(xx-x)/len,uz=(zz-z)/len;
      const project=(px,pz)=>(px-x)*ux+(pz-z)*uz;
      const distance=(px,pz)=>Math.abs((px-x)*uz-(pz-z)*ux);
      const openings=[];
      for(const win of plan.windows) {
        const center=project(win.x,win.z);
        if(distance(win.x,win.z)<.16 && center>=0 && center<=len)
          openings.push([center-win.width/2,center+win.width/2,Math.max(0,win.sill),Math.min(3.16,win.sill+win.height)]);
      }
      if(Math.max(z,zz)<.08){
        const door=project(plan.doorX,0);
        openings.push([door-.65,door+.65,0,2.28]);
        if(!plan.windows.length && len>3){
          // An unmapped shopfront uses low sills to keep the street and awning in view.
          openings.push([.22,len-.22,.62,2.64]);
        }
      }
      const cuts=[0,len,...openings.flatMap(o=>o.slice(0,2)).map(v=>Math.max(0,Math.min(len,v)))].sort((a,b)=>a-b);
      frame=new T.Matrix4().makeRotationY(-Math.atan2(zz-z,xx-x)).setPosition(x,0,z);
      for(let k=1;k<cuts.length;k++){
        const w=cuts[k]-cuts[k-1],cx=(cuts[k]+cuts[k-1])/2;
        if(w<.005)continue;
        const apertures=openings.filter(o=>o[0]<cx && o[1]>cx);
        const ys=[0,3.16,...apertures.flatMap(o=>o.slice(2)).filter(v=>v>=0 && v<=3.16)].sort((a,b)=>a-b);
        for(let n=1;n<ys.length;n++){
          const h=ys[n]-ys[n-1],cy=(ys[n]+ys[n-1])/2;
          if(h>.005 && !apertures.some(o=>o[2]<cy && o[3]>cy))box(cx,cy,0,w,h,.045,material(finish.wall||0xe4dccc));
        }
      }
    }
    frame=identity;
  }
  function table(f){
    const tier=f.finish==="dining"?"dining":f.finish==="counter"?"counter":"casual";
    const booth=f.role==="booth"||f.role==="banquette",four=f.places===4,w=four?1.28:f.corner?.7:.74;
    // The top: metal at a counter place, wood elsewhere; in fine dining laid with a cloth that
    // falls a hand's width over the edge.
    const top=tier==="counter"?metalTop:tier==="dining"?darkWood:wood;
    if(four)box(0,.76,0,w,.055,.76,top);else round(0,.76,0,w,.055,w,top);
    if(tier==="dining"){
      if(four){box(0,.792,0,w+.12,.012,.88,linen);for(const s of [-1,1]){box(0,.7,s*.44,w+.12,.17,.012,linen);box(s*(w/2+.06),.7,0,.012,.17,.88,linen);}}
      else{round(0,.792,0,w+.12,.012,w+.12,linen);round(0,.7,0,w+.1,.17,w+.1,linen);}
    }
    // Legs: a chrome pedestal at a counter place, turned wood at a diner (hidden under the cloth in fine dining).
    for(const x of four?[-.42,.42]:[0]){round(x,.36,0,.08,.72,.08,tier==="counter"?chrome:darkWood);round(x,.04,0,.38,.045,.38,tier==="counter"?chrome:edge);}
    const chairs=f.corner?[]:[-1,1];
    for(const s of chairs){
      for(const x of four?[-.35,.35]:[0]){
        const z=s*(four?.77:.58);
        if(!booth)chair(tier,x,z,s);
        if(tier==="dining"){round(x,.806,s*.21,.25,.018,.25,white);box(x+.15,.801,s*.21,.018,.014,.16,steel);box(x-.15,.801,s*.21,.018,.014,.16,steel);round(x-.16,.855,s*.08,.055,.13,.055,glass);}
        else if(tier==="casual"){box(x,.8,s*.2,.3,.008,.24,cream);}
      }
      if(booth)boothSide(tier,f.role==="banquette",s);
    }
    // A corner table: a seat on each of its two open sides -- toward the room, and along the
    // wall toward the room's middle (``into``) -- each with its back away from the table.
    if(f.corner){
      const base=frame, side=f.side||1, into=f.into||1;
      chair(tier,0,into*.58,into);
      frame=base.clone().multiply(new T.Matrix4().makeRotationY(Math.PI/2));
      chair(tier,0,-side*.58,-side);
      frame=base;
    }
    if(tier==="dining"){round(0,.88,0,.08,.19,.08,brass);round(0,1.02,0,.12,.16,.12,green);}
    else if(tier==="casual"){box(0,.86,0,.12,.16,.075,steel);box(0,.935,0,.095,.055,.025,white);round(.18,.86,0,.05,.15,.05,red);}
    else{box(0,.84,0,.14,.12,.08,dark);box(0,.91,0,.11,.02,.06,white);}
    if(tier!=="counter"){round(0,2.86,0,.02,.56,.02,dark);round(0,2.54,0,.33,.15,.33,tier==="dining"?brass:dark);round(0,2.455,0,.28,.02,.28,cream);}
  }
  //: A chair at a table's side ``s`` (+z or -z): a moulded seat on a chrome frame at a counter
  //: place, a wooden one at a diner, an upholstered one in fine dining.
  function chair(tier,x,z,s){
    seat(x,z,s);
    const legs=tier==="counter"?chrome:tier==="dining"?darkWood:wood;
    for(const dx of [-.17,.17])for(const dz of [-.15,.15])box(x+dx,.23,z+dz,.035,.46,.035,legs);
    if(tier==="counter"){box(x,.46,z,.44,.05,.42,plastic);box(x,.7,z+s*.19,.42,.36,.04,plastic);}
    else if(tier==="dining"){box(x,.47,z,.47,.09,.45,velvet);box(x,.76,z+s*.2,.45,.52,.07,velvet);box(x,.42,z,.47,.03,.45,darkWood);}
    else{box(x,.46,z,.44,.05,.41,wood);box(x,.7,z+s*.18,.42,.36,.04,wood);box(x,.62,z+s*.18,.36,.04,.03,darkWood);}
  }
  //: One side of a booth: its frame and seat cushion, and a back to the shoulders (a banquette's
  //: is tall and buttoned).
  function boothSide(tier,banquette,s){
    for(const dx of [-.4,.4])seat(dx,s*.76,s,.5);
    const cushion=tier==="counter"?plastic:banquette?velvet:vinyl, body=tier==="counter"?chrome:darkWood;
    box(0,.22,s*.76,1.56,.42,.5,body);box(0,.47,s*.76,1.53,.11,.48,cushion);
    const back=banquette?.86:.62;
    box(0,.5+back/2,s*.98,1.57,back,.13,cushion);
    box(0,.52+back,s*1.0,1.6,.04,.17,body);
    if(banquette)for(const dx of [-.5,0,.5])for(const dy of [.25,.55])round(dx,.5+dy,s*.915,.03,.012,.03,dark);
  }
  function appliance(id,x,w){
    const y=.94, z=.02;
    if(["oven","pizza_oven","tandoor","microwave","toaster","steamer","cooler"].includes(id)){
      const cold=id==="cooler";box(x,1.14,z,w*.93,.4,.53,cold?steel:edge);
      box(x,1.14,-.255,w*.72,.26,.018,cold?glass:dark);
      box(x,1.29,-.28,w*.63,.022,.025,steel);
      if(id==="steamer" || id==="tandoor")round(x,1.39,z,w*.68,.15,.34,brass);
    }else if(["stove","wok","grill","fryer"].includes(id)){
      box(x,1.0,z,w*.98,.13,.60,steel);box(x,1.077,z,w*.90,.028,.48,dark);
      if(id==="stove"||id==="wok"){round(x,1.11,z,w*.57,.04,.32,edge);round(x,1.17,z,w*.55,.12,.30,dark);box(x,1.18,-.19,.045,.035,.17,wood);}
      if(id==="grill")for(let k=0;k<6;k++)box(x+((k+.5)/6-.5)*w*.8,1.10,z,.016,.025,.42,edge);
      if(id==="fryer"){box(x,1.13,z,w*.57,.08,.35,brass);box(x,1.18,-.21,.04,.04,.21,dark);}
      box(x,2.13,.02,w,.20,.70,steel);box(x,2.49,.18,w*.48,.53,.32,edge);
    }else if(id==="handsink"){
      box(x,1.0,.12,Math.min(w*.7,.45),.22,.34,steel);box(x,1.14,.25,.03,.16,.03,steel);box(x+.12,1.3,.27,.12,.16,.06,cream);
    }else if(id==="dish"){
      // The dish pit's machine: a hood that comes down over a rack, and the rack beside it.
      box(x,1.3,z,w*.8,.72,.6,steel);box(x,1.72,z,w*.84,.08,.64,edge);box(x-w*.36,1.0,z,w*.12,.04,.5,steel);
    }else if(id==="sink"){
      box(x,y+.01,z,w*.94,.04,.54,steel);box(x,y+.037,z,w*.65,.025,.34,edge);box(x,1.08,.22,.033,.28,.034,steel);box(x,1.21,.14,.034,.034,.18,steel);
    }else if(id==="board"||id==="bowl"){
      if(id==="board"){box(x,.965,z,w*.88,.045,.39,wood);box(x,.998,z,w*.52,.018,.06,steel);}
      else{round(x,1.02,z,w*.55,.16,.26,cream);round(x,1.105,z,w*.47,.01,.22,stone);}
    }else{
      box(x,1.01,z,w*.82,.13,.4,dark);
      if(id==="espresso"||id==="drinks"){box(x,1.24,.13,w*.84,.44,.19,steel);box(x,1.43,-.015,w*.86,.12,.31,edge);round(x,1.14,-.09,.11,.13,.11,white);}
      else{round(x,1.22,z,w*.46,.34,.19,id==="blender"?glass:steel);round(x,1.40,z,w*.5,.025,.21,dark);}
    }
  }
  function bench(f,w){
    if(f.role==="bench"){box(0,.47,0,w,.87,.67,edge);box(0,.922,0,w,.052,.73,steel);}
    if(f.role==="pantry"){
      const cold=f.kept!=="dry";
      box(0,1.04,.30,w,2.02,.08,cold?steel:wood);
      for(const x of [-1,1])box(x*(w/2-.025),1.04,0,.05,2.02,.66,cold?steel:wood);
      box(0,.12,0,w,.16,.67,edge);box(0,2.03,0,w,.12,.68,cold?steel:wood);
      if(cold){box(0,1.10,-.28,.027,1.71,.04,steel);box(.055,.97,-.34,.028,.35,.04,dark);}
      label({dry:"Dry pantry",fridge:"Refrigerator",freezer:"Freezer"}[f.kept],0,2.03,-.35,Math.min(w*.82,.9),.112);
    }
    const stations=f.stations||[];
    stations.forEach((id,i)=>{const segment=w/stations.length,x=segment*(i+.5)-w/2;appliance(id,x,segment);label(id.replaceAll("_"," "),x,.85,-.35,Math.min(.48,segment*.91),.092);});
    const bins=f.bins||[];
    if(!bins.length)return;
    // Ingredients sit in shallow labelled overhead racks above the bench. Chilled goods
    // are behind glazed cabinet doors. The ingredient map and availability come from the line.
    const columns=Math.min(bins.length,Math.max(1,Math.floor(w/.21))),rows=Math.ceil(bins.length/columns);
    const shelfY = ["stock","pantry"].includes(f.role) ? .2 : 2.22;
    const rowHeight=Math.min(["stock","pantry"].includes(f.role)?.36:.23, (["stock","pantry"].includes(f.role)?1.46:.88)/rows), cell=w/columns;
    const front = f.role==="stock" ? -.37 : -.045;
    for(let row=0;row<rows;row++)box(0,shelfY+row*rowHeight,.13,w,.026,.44,edge);
    bins.forEach((b,i)=>{
      const x=cell*((i%columns)+.5)-w/2,y=shelfY+.02+Math.floor(i/columns)*rowHeight;
      if(b.stock!==0){const cold=b.kept!=="dry";box(x,y+rowHeight*.42,.13,cell*.88,rowHeight*.82,.31,cold?glass:cream);
        box(x,y+rowHeight*.86,.13,cell*.93,.025,.33,cold?steel:wood);}
      label(b.name,x,y+rowHeight*.38,front,cell*.94,Math.min(.084,rowHeight*.7));
    });
  }
  if(shellEnabled)shell();
  let panel;
  for(const f of plan.fixtures){
    const kitchen=["bench","pantry","equipment","stock"].includes(f.role),side=kitchen || f.role==="ledge"?f.side:0;
    frame=new T.Matrix4().makeRotationY(f.yaw ?? (side?side*Math.PI/2:0)).setPosition(f.x,f.y||0,f.z);
    if(f.role==="stock" || f.role==="equipment"){
      frame.multiply(new T.Matrix4().makeScale(1,Math.max(.4,f.height)/(f.role==="stock"?1.8:.94),f.d/.74));
      bench(f,f.w);continue;
    }
    if(f.role==="ledge"){
      box(0,.96,.28,f.d,.055,.43,wood);
      for(const x of [-.43,.43]){box(x,.60,.40,.045,.66,.05,edge);round(x,.32,-.27,.06,.62,.06,steel);round(x,.64,-.27,.31,.065,.31,f.finish==="dining"?cloth:wood);round(x,.045,-.27,.26,.05,.26,edge);}
      continue;
    }
    if(f.role==="table"||f.role==="booth"||f.role==="banquette"){table(f);continue;}
    if(f.role==="host"){
      // The host stand: a lectern with the book and a lamp.
      box(0,.55,0,.56,1.1,.4,darkWood);box(0,1.12,-.02,.6,.04,.44,darkWood);box(0,1.15,-.04,.34,.02,.24,cream);
      round(.2,1.28,.08,.02,.22,.02,brass);round(.2,1.4,.05,.12,.06,.12,lamp);continue;
    }
    if(f.role==="office"){
      // The manager's corner: a desk, its computer and a chair, a filing cabinet and the rota.
      const sd=f.side||1;frame=frame.clone().multiply(new T.Matrix4().makeRotationY(-sd*Math.PI/2));
      box(0,.72,0,f.w,.04,f.d,wood);for(const x of [-1,1])box(x*(f.w/2-.03),.36,0,.04,.72,f.d-.04,edge);
      box(-.15,.98,.12,.5,.32,.03,dark);box(-.15,.98,.105,.46,.28,.01,screen);box(-.15,.78,.16,.06,.12,.06,dark);
      box(-.15,.745,-.08,.42,.015,.14,dark);box(.3,.745,-.06,.07,.02,.1,dark);
      box(f.w/2-.22,.36,0,.38,.7,.5,edge);
      box(0,.47,-.55,.46,.06,.44,dark);box(0,.75,-.76,.44,.5,.05,dark);round(0,.24,-.55,.06,.46,.06,steel);
      label("Rota",0,1.6,.27,.5,.14);continue;
    }
    if(f.role==="shelf"){
      // Wall shelving: wire racks of boxed stock, spare plates and takeaway packaging.
      const sd=f.side||1;frame=frame.clone().multiply(new T.Matrix4().makeRotationY(-sd*Math.PI/2));
      for(const y of [.3,.8,1.3,1.8])box(0,y,0,f.d,.025,f.w,steel);
      for(const x of [-1,1])box(x*(f.d/2-.015),1.0,0,.03,2.0,f.w,steel);
      for(const [i,y] of [.3,.8,1.3,1.8].entries())for(let k=0;k<3;k++){const bw=f.d/3-.06;box((k-1)*(f.d/3),y+.12,0,bw,.2,f.w*.8,i%2?cream:boxes);}
      continue;
    }
    if(kitchen){bench(f,side?f.d:f.w);continue;}
    const w=f.w;box(0,.49,0,w,.94,.51,wood);box(0,.98,0,w+.015,.055,.56,stone);
    if(f.stations?.length)bench(f,w);
    const x=w*.26;box(x,1.08,.01,.12,.19,.1,dark);box(x,1.27,0,Math.min(w*.52,.4),.25,.07,dark);
    panel=label("Checkout",x,1.27,-.041,Math.min(w*.49,.37),.19);
    // More tills along a counter place's counter, a cash drawer under each.
    for(let t=1;t<(f.tills||1);t++){const tx=x-t*1.1;if(tx<-w/2+.25)break;box(tx,1.08,.01,.1,.16,.1,dark);box(tx,1.24,0,.34,.22,.06,dark);box(tx,1.24,-.032,.3,.18,.005,screen);box(tx,.9,-.2,.38,.1,.36,edge);}
    // The pass behind the counter: a shelf under heat lamps where plates wait, and the order
    // screen the line reads its tickets from.
    if(f.pass){
      box(0,1.32,.24,Math.min(w,2.4),.03,.3,steel);
      for(let k=-1;k<=1;k++){round(k*Math.min(w,2.4)/3,1.72,.24,.16,.08,.16,lamp);round(k*Math.min(w,2.4)/3,2.1,.24,.012,.72,.012,steel);}
      box(-w*.3,1.62,.38,.48,.3,.03,dark);box(-w*.3,1.62,.365,.44,.26,.008,screen);
    }
    box(x-.16,1.025,-.12,.15,.045,.11,dark);
    if(w>1.3){box(-.28,1.04,.06,.20,.075,.15,dark);box(-.28,1.085,.04,.12,.025,.08,white);}
    if(w>1.5)label(name||"Service",0,.71,-.262,Math.min(w*.66,1.85),.22);
  }
  for(const {geometry,m,instances} of batches.values()){
    const mesh=new T.InstancedMesh(geometry,m,instances.length);
    instances.forEach((x,i)=>mesh.setMatrixAt(i,x));group.add(mesh);
  }
  group.name="restaurant-interior";group.userData.panel=panel;group.userData.seats=seats;
  return group;
}

