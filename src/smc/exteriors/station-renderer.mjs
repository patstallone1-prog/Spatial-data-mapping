// Explicit lot-space consumer. Site x/y metres become scene x/-z, as in Kerbside.
import {Batch,cutExteriorWallBands} from './renderer.mjs';

export function createStationRenderer(THREE, exteriors) {
  const materials=new Map(),ownedTextures=new Set();
  const mat=(color,metalness=0,roughness=.72)=>{
    const key=[color,metalness,roughness].join('|');
    if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,metalness,roughness,side:THREE.DoubleSide}));
    return materials.get(key);
  };
  const label=(text,color='#f4f4ed',background=null)=>{
    const key=['label',text,color,background].join('|');if(materials.has(key))return materials.get(key);
    const c=document.createElement('canvas');c.width=1024;c.height=512;const ctx=c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);if(background){ctx.fillStyle=background;ctx.fillRect(0,0,c.width,c.height);}
    const rows=String(text).split('\n');let size=Math.min(120,380/rows.length);ctx.font=`700 ${size}px Arial`;
    while(Math.max(...rows.map(t=>ctx.measureText(t).width))>960&&size>14){size-=2;ctx.font=`700 ${size}px Arial`;}
    ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';rows.forEach((t,i)=>ctx.fillText(t,512,256+(i-(rows.length-1)/2)*(size+12)));
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;ownedTextures.add(map);
    const m=new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.05,depthWrite:false,side:THREE.DoubleSide,roughness:.6});materials.set(key,m);return m;
  };
  const artwork=key=>{
    const map=exteriors.brandTexture?.(key);if(!map)return null;
    const id='brand|'+key;if(!materials.has(id))materials.set(id,new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.05,depthWrite:false,side:THREE.DoubleSide}));
    return {material:materials.get(id),aspect:map.userData.displayAspect||map.image.width/map.image.height};
  };
  const priceBoard=prices=>{
    const key='prices|'+JSON.stringify(prices.rows);if(materials.has(key))return materials.get(key);
    const c=document.createElement('canvas');c.width=1024;c.height=1024;const ctx=c.getContext('2d');ctx.fillStyle='#142823';ctx.fillRect(0,0,1024,1024);
    const pitch=900/prices.rows.length;
    prices.rows.forEach((r,i)=>{const y=70+i*pitch,amount=Number(r.price),whole=(Math.floor(amount*100)/100).toFixed(2),fraction=Math.round((amount*100)%1*10);
      ctx.fillStyle='#f1edce';ctx.font=`600 ${Math.min(58,pitch*.25)}px Arial`;ctx.textAlign='left';ctx.fillText(r.grade,45,y+35);
      ctx.font=`500 ${Math.min(35,pitch*.17)}px Arial`;if(r.payment!=='all')ctx.fillText(r.payment.toUpperCase(),45,y+pitch*.65);
      ctx.fillStyle='#99e398';ctx.font=`700 ${Math.min(140,pitch*.53)}px monospace`;ctx.textAlign='right';ctx.fillText(whole,860,y+pitch*.8);
      ctx.font=`700 ${Math.min(50,pitch*.23)}px monospace`;ctx.fillText(`${fraction}/10`,1000,y+pitch*.58);
    });
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;ownedTextures.add(map);
    const m=new THREE.MeshStandardMaterial({map,emissive:'#ffffff',emissiveMap:map,emissiveIntensity:.22,roughness:.6,side:THREE.DoubleSide});materials.set(key,m);return m;
  };
  function mount(target,plan,origin={x:0,y:0,z:0},{cars=true,canopies=true}={}) {
    if(plan.schema!=='kerbside.inferred_station/1'||!plan.validation?.passed)return null;
    const group=new THREE.Group(),batch=new Batch(THREE);group.position.set(origin.x,origin.y,origin.z);
    const colors=plan.style.colors, silver=mat('#abb1b2',.75,.3),black=mat('#20282b'),white=mat('#eff0e9'),accent=mat(colors[0]),rubber=mat('#171c1f');
    const matrix=(x,y,z,heading=0)=>new THREE.Matrix4().makeTranslation(x,y,-z).multiply(new THREE.Matrix4().makeRotationY(heading*Math.PI/180));
    const box=(c,h,l,w,d,m,heading=0)=>batch.add(new THREE.BoxGeometry(l,w,d),m,matrix(c[0],h,c[1],heading));
    const tube=(points,r,m)=>{
      const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],p[2],-p[1])));
      batch.add(new THREE.TubeGeometry(curve,24,r,6,false),m,new THREE.Matrix4());
    };
    const pole=(p,h,r=.09,m=mat('#e2ba38'))=>batch.add(new THREE.CylinderGeometry(r,r,h,10),m,matrix(p[0],h/2+.02,p[1]));
    const plane=(center,height,w,h,normal,m)=>{
      const yaw=Math.atan2(normal[0],-normal[1]);
      batch.add(new THREE.PlaneGeometry(w,h),m,new THREE.Matrix4().makeTranslation(center[0],height,-center[1]).multiply(new THREE.Matrix4().makeRotationY(yaw)));
    };
    const slab=(polygon,bottom,thickness,m)=>{
      const rings=polygon.coordinates,s=new THREE.Shape(rings[0].map(p=>new THREE.Vector2(...p)));
      for(const r of rings.slice(1))s.holes.push(new THREE.Path(r.map(p=>new THREE.Vector2(...p))));
      const g=new THREE.ExtrudeGeometry(s,{depth:thickness,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,bottom,0);batch.add(g,m,new THREE.Matrix4());
    };
    const line=(a,b,y,width,m)=>{const L=Math.hypot(b[0]-a[0],b[1]-a[1]);box([(a[0]+b[0])/2,(a[1]+b[1])/2],y,L,.018,width,m,Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI);};
    slab(plan.site_polygon,-.08,.08,mat('#5f6464',0,.98));
    for(const o of plan.obstacles)slab(o.polygon,.01,o.height_m||.55,mat('#7b866b'));
    for(const i of plan.islands)slab(i.polygon,.015,.16,mat('#bcbdb4'));
    for(const c of canopies?plan.canopies:[]){
      slab(c.polygon,c.underside_m,c.thickness_m,white);
      const ring=c.polygon.coordinates[0];for(let i=1;i<ring.length;i++){
        const a=ring[i-1],b=ring[i],center=[(a[0]+b[0])/2,(a[1]+b[1])/2],L=Math.hypot(b[0]-a[0],b[1]-a[1]),heading=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;
        box(center,c.underside_m+.26,L,.30,.08,accent,heading);box(center,c.underside_m+.07,L,.06,.08,mat(colors[1]),heading);
      }
      for(const p of c.supports){pole(p,c.underside_m,.16,mat('#b5b8b1'));box(p,c.underside_m-.10,1.2,.2,.45,silver);}
      const a=ring[0],b=ring[1],L=Math.hypot(b[0]-a[0],b[1]-a[1]);const normal=[(b[1]-a[1])/L,-(b[0]-a[0])/L];
      // Determine exterior normal from ring winding, without mirroring lettering.
      const area=ring.slice(1).reduce((s,p,i)=>s+ring[i][0]*p[1]-p[0]*ring[i][1],0);
      if(area<0){normal[0]*=-1;normal[1]*=-1;}
      const center=[(a[0]+b[0])/2+normal[0]*.065,(a[1]+b[1])/2+normal[1]*.065];
      plane(center,c.underside_m+.24,Math.min(3.2,L*.7),.42,normal,label(plan.style.name,'#ffffff',colors[0]));
      const art=artwork(plan.brand);
      if(art&&L>6){const tangent=[-normal[1],normal[0]],p=[center[0]+tangent[0]*2.15,center[1]+tangent[1]*2.15];plane(p,c.underside_m+.24,.65,.40,normal,white);plane([p[0]+normal[0]*.006,p[1]+normal[1]*.006],c.underside_m+.24,Math.min(.60,.36*art.aspect),Math.min(.36,.60/art.aspect),normal,art.material);}
    }
    for(const b of plan.bays){
      const ring=b.polygon.coordinates[0];for(let i=1;i<ring.length;i++)line(ring[i-1],ring[i],.022,.065,mat(b.kind==='ev_bay'?'#e3e7df':'#bfc3b9'));
      if(b.kind==='ev_bay'){
        const g=new THREE.PlaneGeometry(1.5,.8);g.rotateX(-Math.PI/2);batch.add(g,label('EV\nCHARGING','#b8d4a4'),matrix(b.center[0],.035,b.center[1],b.heading_degrees-90));
      }
    }
    for(const d of plan.devices){
      const c=d.center,h=d.heading_degrees;
      if(d.kind==='fuel_pump'){
        box(c,.6,1.25,.9,.65,accent,h);box(c,1.52,1.25,1.0,.65,white,h);box(c,2.08,1.37,.18,.72,accent,h);
        for(const f of d.faces){
          const n=f.normal,u=[-n[1],n[0]],at=(x,y,z)=>[c[0]+u[0]*x+n[0]*z,c[1]+u[1]*x+n[1]*z,y];
          const panel=at(-.15,1.65,.337);plane(panel,1.65,.72,.44,n,label('SALE $0.00\nGALLONS 0.000','#9dbfc1','#162829'));
          const pay=at(-.15,1.20,.344);plane(pay,1.20,.36,.21,n,label('TAP / CARD','#f2f2dc','#263035'));
          for(let i=0;i<3;i++){const p=at(-.4+i*.24,.94,.344);plane(p,.94,.20,.18,n,label(String([87,89,91][i]),'#242a27','#f3cd43'));}
          // Each hose stays on the same dispensing face as its assigned adjacent lane.
          tube([at(.5,1.98,.38),at(.78,1.62,.42),at(.83,.55,.48),at(.58,.38,.48),at(.41,.85,.42),at(.43,1.13,.41)],.035,rubber);
          const dock=at(.43,1.23,.37);box(dock,1.23,.18,.36,.07,black,Math.atan2(u[1],u[0])*180/Math.PI);
          tube([at(.43,1.08,.43),at(.34,1.22,.46),at(.40,1.36,.46)],.05,black);
          tube([at(.40,1.36,.46),at(.52,1.43,.44),at(.56,1.46,.34)],.025,silver);
        }
        for(let s of [-1,1]){const a=h*Math.PI/180,p=[c[0]+Math.cos(a)*s*2,c[1]+Math.sin(a)*s*2];pole(p,.9,.075);}
      }else{
        const rad=h*Math.PI/180,n=[Math.cos(rad),Math.sin(rad)],u=[-n[1],n[0]],at=(x,y,z)=>[c[0]+u[0]*x+n[0]*z,c[1]+u[1]*x+n[1]*z,y];
        const cp=d.family==='chargepoint_express250',v3=d.family==='tesla_v3';
        box(c,.07,1.25,.14,1.25,mat('#b9bcb4'),h);
        if(v3){
          const s=new THREE.Shape();s.moveTo(-.42,0);s.lineTo(.42,0);s.lineTo(.42,1.75);s.quadraticCurveTo(.42,2.05,0,2.05);s.quadraticCurveTo(-.42,2.05,-.42,1.75);s.closePath();
          const hole=new THREE.Path();hole.moveTo(-.23,.45);hole.lineTo(-.23,1.65);hole.quadraticCurveTo(0,1.87,.23,1.65);hole.lineTo(.23,.45);hole.closePath();s.holes.push(hole);
          const g=new THREE.ExtrudeGeometry(s,{depth:.19,bevelEnabled:false});
          const yaw=Math.atan2(n[0],-n[1]);batch.add(g,white,new THREE.Matrix4().makeTranslation(c[0],.1,-c[1]).multiply(new THREE.Matrix4().makeRotationY(yaw)));
          for(const p of [[-.28,1.0,.2],[.28,1.0,.2]]){const v=at(...p);box(v,1.1,.08,1.22,.04,mat('#d52b34'));}
        }else{
          box(c,1.16,cp?.71:.72,2.23,.62,cp?mat('#777d7e'):white,h+90);
          const face=at(0,1.25,.322);plane(face,1.25,.59,1.67,n,black);
          const screen=at(0,1.52,.33);plane(screen,1.52,.42,.55,n,label('READY\nCONNECT EV','#dce9db','#203b43'));
          const stripe=at(0,2.17,.33);plane(stripe,2.17,.62,.12,n,accent);
          const brand=at(0,1.99,.337);plane(brand,1.99,.58,.22,n,label(plan.style.name,'#f6f6ef'));
          const tap=at(.1,.93,.338);plane(tap,.93,.16,.18,n,label('TAP','#eef1e9','#344a52'));
        }
        tube([at(.30,1.95,.34),at(.62,1.5,.40),at(.65,.48,.40),at(.36,.42,.43),at(.27,1.03,.4)],.029,rubber);
        tube([at(.27,1.03,.41),at(.21,1.18,.43),at(.22,1.29,.36)],.044,black);
        box(d.wheel_stop,.11,1.65,.18,.17,mat('#aeb5b4'),h+90);
        for(const p of d.bollards)pole(p,.85,.08);
      }
    }
    for(const p of plan.pedestrian_routes||[]){for(let i=1;i<p.points.length;i++)line(p.points[i-1],p.points[i],.028,p.width_m,mat('#aeb7ad'));}
    if(plan.price_sign){const s=plan.price_sign,c=s.center,h=s.heading_degrees,rad=h*Math.PI/180,n=[Math.sin(rad),-Math.cos(rad)];
      box(c,2.4,2.15,3.7,.4,white,h);box(c,4.4,2.15,.45,.43,accent,h);pole(c,1.1,.14,silver);
      const prices=s.prices;
      for(const sign of [1,-1]){const normal=n.map(v=>v*sign),p=[c[0]+normal[0]*.222,c[1]+normal[1]*.222],art=artwork(plan.brand);
        if(art){plane(p,4.4,1.98,.42,normal,white);plane([p[0]+normal[0]*.008,p[1]+normal[1]*.008],4.4,Math.min(1.9,.37*art.aspect),Math.min(.37,1.9/art.aspect),normal,art.material);}else plane(p,4.4,1.98,.4,normal,label(plan.style.name));
        plane(p,2.6,1.95,2.0,normal,priceBoard(prices));plane(p,1.35,1.95,.36,normal,label(prices.illustrative?'SAMPLE · USD / GAL':'USD / GAL','#202e30'));
      }
    }
    if(plan.store){
      const p=plan.store,rings=p.footprint.coordinates,s=new THREE.Shape(rings[0].map(q=>new THREE.Vector2(...q)));
      for(const ring of rings.slice(1))s.holes.push(new THREE.Path(ring.map(q=>new THREE.Vector2(...q))));
      const original=new THREE.ExtrudeGeometry(s,{depth:p.height_m,bevelEnabled:false});original.rotateX(-Math.PI/2);
      const clipped=cutExteriorWallBands(THREE,original,p);original.dispose();
      const body=new THREE.Mesh(clipped,[mat('#abaea4'),mat(p.facades[0].palette.wall)]);body.castShadow=true;body.receiveShadow=true;group.add(body);exteriors.mount(group,p);
      slab(p.footprint,.005,.025,mat('#c7c4b8'));
      for(const wall of plan.store_interior?.storeys?.[0]?.walls||[]){
        const [a,b]=wall.segment.coordinates,L=Math.hypot(b[0]-a[0],b[1]-a[1]);
        box([(a[0]+b[0])/2,(a[1]+b[1])/2],wall.height_m/2,L,wall.height_m,wall.thickness_m,mat(wall.materials?.[0]||'#dedbd1'),Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI);
      }
      for(const o of plan.store_interior?.storeys?.[0]?.objects||[]){
        const [x,y,z]=o.position_m,[w,h,d]=o.size_m,c=[x,z],angle=o.rotation_deg;
        if(o.role==='gondola_shelf'){
          box(c,y+h/2,.055,h,d,mat('#5f6260'),angle);box(c,y+.07,w,.14,d,black,angle);
          for(let level=.22;level<h;level+=.36){box(c,y+level,w+.03,.045,d+.025,white,angle);
            const a=angle*Math.PI/180;
            for(let i=0;i<Math.max(1,Math.floor(d/.18));i++)for(const side of [-1,1]){
              const u=side*(w/2-.10),v=-d/2+.12+i*.18,p=[x+u*Math.cos(a)-v*Math.sin(a),z+u*Math.sin(a)+v*Math.cos(a)];
              box(p,y+level+.1325,.14,.22,.12,mat(['#b54d35','#daa74c','#49926c','#436690'][i%4]),angle);
            }
          }
        }else if(o.role==='drink_cooler'){
          const ip=o.interaction_point_m||[x,z+1],L=Math.hypot(ip[0]-x,ip[1]-z)||1,n=[(ip[0]-x)/L,(ip[1]-z)/L],u=[-n[1],n[0]],faceWidth=Math.max(w,d),depth=Math.min(w,d);
          const p=(a,b)=>[x+u[0]*a+n[0]*b,z+u[1]*a+n[1]*b];
          box(p(0,-depth/2+.035),y+h/2,faceWidth,h,.07,black,Math.atan2(u[1],u[0])*180/Math.PI);
          for(let level=.15;level<h-.25;level+=.37){
            box(c,y+level,w,.035,d,silver,angle);
            for(let i=0;i<Math.floor(faceWidth/.16);i++){
              const q=p(-faceWidth/2+.1+i*.16,depth/2-.12);
              batch.add(new THREE.CylinderGeometry(.045,.045,.23,8),mat(['#9d6539','#699371','#bd9d4f'][i%3]),matrix(q[0],y+level+.1325,q[1]));
            }
          }
          if(!materials.has('cooler-glass'))materials.set('cooler-glass',new THREE.MeshPhysicalMaterial({color:'#a8c5ca',transparent:true,opacity:.22,roughness:.12,side:THREE.DoubleSide}));
          plane(p(0,depth/2+.012),y+h/2,faceWidth,h,n,materials.get('cooler-glass'));
          for(let i=0;i<=Math.ceil(faceWidth/.8);i++){const q=p(-faceWidth/2+i*faceWidth/Math.ceil(faceWidth/.8),depth/2+.025);box(q,y+h/2,.035,h,.04,black);}
          box(c,y+h+.025,w,.05,d,silver,angle);
        }else if(o.role==='checkout_lane'){
          box(c,y+h/2,w,h,d,mat('#9d8362'),angle);box(c,y+h+.035,w+.03,.07,d+.03,black,angle);box(c,y+h+.22,.3,.34,.22,black,angle);
        }else box(c,y+h/2,w,h,d,mat(o.materials?.wood||'#acaa98'),angle);
      }
    }
    batch.finish(group,plan.evidence);
    const paths=new THREE.Group();paths.name='stationApproaches';paths.visible=false;
    for(const route of plan.routes)for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<.001)continue;
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(L,.025,.075),mat('#82d7b8'));
      mesh.position.set((a[0]+b[0])/2,.045,-(a[1]+b[1])/2);mesh.rotation.y=Math.atan2(b[1]-a[1],b[0]-a[0]);paths.add(mesh);
    }
    group.add(paths);
    const vehicles=new THREE.Group();vehicles.name='stationVehicles';group.add(vehicles);
    const vehicleBatch=new Batch(THREE);
    if(cars)for(const [i,b] of plan.bays.entries()){
      const car=new THREE.Group();car.position.set(b.center[0],.06,-b.center[1]);car.rotation.y=(b.heading_degrees+(b.kind==='ev_bay'?180:0))*Math.PI/180;
      car.updateMatrix();
      const body=mat(['#79908e','#d9d7cc','#435564','#8e3c39'][i%4],.35,.35);
      const add=(geometry,material,x,y,z)=>vehicleBatch.add(geometry,material,car.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x,y,z)));
      add(new THREE.BoxGeometry(4.35,.65,1.78),body,0,.52,0);add(new THREE.BoxGeometry(2.35,.62,1.55),mat('#62777c',.2,.18),-.05,1.12,0);add(new THREE.BoxGeometry(2.25,.08,1.54),body,-.05,1.46,0);
      for(const x of [-1.38,1.38])for(const z of [-.88,.88]){const g=new THREE.CylinderGeometry(.32,.32,.19,12);g.rotateX(Math.PI/2);add(g,rubber,x,.34,z);}
      add(new THREE.BoxGeometry(.06,.16,1.4),white,2.19,.63,0);add(new THREE.BoxGeometry(.06,.14,1.3),mat('#be3035'),-2.19,.63,0);
    }
    vehicleBatch.finish(vehicles,plan.evidence);
    group.userData={inferredStation:plan.id,canonicalGeometryModified:false,evidence:plan.evidence};target.add(group);return group;
  }
  return {mount,dispose(){for(const t of ownedTextures)t.dispose();for(const m of materials.values())m.dispose();}};
}
