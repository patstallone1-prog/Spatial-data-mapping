// Source polygons in metres; x/y -> x/-z. No NPC or acquired vehicle pack is imported.
import {Batch,cutExteriorWallBands} from './renderer.mjs';

export function createDealershipRenderer(THREE, exteriors) {
  const materials=new Map(),textures=new Set();
  function mat(color,metalness=0,roughness=.7) {
    const key=[color,metalness,roughness].join('|');
    if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,metalness,roughness,side:THREE.DoubleSide}));
    return materials.get(key);
  }
  function text(value,ink='#f3f1e9',background=null) {
    const key=['text',value,ink,background].join('|');if(materials.has(key))return materials.get(key);
    const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1536,256);
    if(background){ctx.fillStyle=background;ctx.fillRect(0,0,1536,256);}
    let size=180;ctx.font=`600 ${size}px Arial`;
    while(ctx.measureText(value).width>1460&&size>16){size-=2;ctx.font=`600 ${size}px Arial`;}
    ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(value,768,128);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;textures.add(map);
    const m=new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.05,depthWrite:false,side:THREE.DoubleSide});materials.set(key,m);return m;
  }
  function mount(target,plan,origin={x:0,y:0,z:0},{roof=true,cars=true}={}) {
    if(plan.schema!=='kerbside.inferred_dealership/1'||!plan.validation?.passed)return null;
    const group=new THREE.Group(),batch=new Batch(THREE);group.name='dealership:'+plan.id;group.position.set(origin.x,origin.y,origin.z);
    const silver=mat('#aeb5b8',.7,.3),white=mat('#f5f2e8'),black=mat('#242c30'),accent=mat(plan.style.colors?.[0]||'#435e65');
    const M=(x,y,z,angle=0)=>new THREE.Matrix4().makeTranslation(x,y,-z).multiply(new THREE.Matrix4().makeRotationY(angle*Math.PI/180));
    const box=(c,y,w,h,d,m,angle=0)=>batch.add(new THREE.BoxGeometry(w,h,d),m,M(c[0],y,c[1],angle));
    function slab(p,y,h,m) {
      const rings=p.coordinates,s=new THREE.Shape(rings[0].map(p=>new THREE.Vector2(...p)));
      for(const r of rings.slice(1))s.holes.push(new THREE.Path(r.map(p=>new THREE.Vector2(...p))));
      const g=new THREE.ExtrudeGeometry(s,{depth:h,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,y,0);batch.add(g,m,new THREE.Matrix4());
    }
    const line=(a,b,y,width,m)=>box([(a[0]+b[0])/2,(a[1]+b[1])/2],y,Math.hypot(b[0]-a[0],b[1]-a[1]),.018,width,m,Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI);
    function plane(c,y,w,h,n,m) {
      batch.add(new THREE.PlaneGeometry(w,h),m,M(c[0],y,c[1]).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(n[0],-n[1]))));
    }
    slab(plan.site_polygon,-.09,.09,mat('#60676a',0,.95));
    for(const o of plan.obstacles)slab(o.polygon,.01,o.height_m||.4,mat('#7a896a'));
    for(const p of plan.pedestrian_paths){
      slab(p.polygon,.005,.025,mat('#c3c1b5'));
      // Contrasting strips mark where an entrance approach shares the driveway.
      for(let i=1;i<p.points.length;i++){
        const a=p.points[i-1],b=p.points[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),t=[(b[0]-a[0])/L,(b[1]-a[1])/L];
        for(let u=.6;u<L;u+=1.1){const c=[a[0]+t[0]*u,a[1]+t[1]*u];box(c,.045,p.width_m*.86,.015,.28,white,Math.atan2(-t[0],t[1])*180/Math.PI);}
      }
    }
    for(const s of plan.stalls){const ring=s.polygon.coordinates[0];for(let i=1;i<ring.length;i++)line(ring[i-1],ring[i],.03,.07,white);}
    for(const r of plan.service_aprons){const a=r.points[0],b=r.points[1];line(a,b,.035,.12,mat('#e0bd54'));}
    // Keep all measured shell vertices and wall openings. The exterior renderer supplies the
    // replacement wall band, mullions, doors, handles, brand artwork and lit lettering.
    const shell=plan.building,shape=new THREE.Shape(shell.footprint.coordinates[0].map(p=>new THREE.Vector2(...p)));
    for(const r of shell.footprint.coordinates.slice(1))shape.holes.push(new THREE.Path(r.map(p=>new THREE.Vector2(...p))));
    const base=new THREE.ExtrudeGeometry(shape,{depth:shell.height_m,bevelEnabled:false});base.rotateX(-Math.PI/2);
    const cut=cutExteriorWallBands(THREE,base,shell);base.dispose();
    const wall=new THREE.Mesh(cut,[mat('#b4b6b1'),mat(plan.style.wall_color||'#e3e0d7')]);wall.castShadow=true;wall.receiveShadow=true;
    // The extrusion's cap group is retained; a separate roof group can hide caps for inspection.
    const shellGroup=new THREE.Group();shellGroup.name='dealershipShell';shellGroup.add(wall);group.add(shellGroup);
    exteriors.mount(group,shell);
    const roofGroup=new THREE.Group();roofGroup.name='dealershipRoof';roofGroup.visible=roof;
    const roofShape=shape.clone(),roofMesh=new THREE.Mesh(new THREE.ShapeGeometry(roofShape),mat('#777f83'));
    roofMesh.rotation.x=-Math.PI/2;roofMesh.position.y=shell.height_m+.015;roofMesh.receiveShadow=true;roofGroup.add(roofMesh);group.add(roofGroup);
    // Remove only the extrusion's upper cap for the roof-toggle; walls and floor stay intact.
    const positions=cut.attributes.position,normal=cut.attributes.normal;
    const sourceGroups=cut.groups.map(g=>({...g})),keep=[];cut.clearGroups();
    for(const g of sourceGroups){const first=keep.length;
      for(let i=g.start;i<g.start+g.count;i+=3){
        const top=[0,1,2].every(j=>positions.getY(i+j)>shell.height_m-.001&&normal.getY(i+j)>.8);
        if(!top)keep.push(i,i+1,i+2);
      }
      if(keep.length>first)cut.addGroup(first,keep.length-first,g.materialIndex);
    }
    cut.setIndex(keep);
    slab(plan.showroom.polygon,.015,.045,mat('#dbd9d1',0,.35));
    for(const f of shell.facades){
      if(f.role!=='public')continue;
      const L=Math.hypot(f.b[0]-f.a[0],f.b[1]-f.a[1]),t=[(f.b[0]-f.a[0])/L,(f.b[1]-f.a[1])/L],n=f.normal;
      const at=(u,d=0)=>[f.a[0]+t[0]*u+n[0]*d,f.a[1]+t[1]*u+n[1]*d];
      const angle=Math.atan2(t[1],t[0])*180/Math.PI;
      for(const d of f.openings.filter(o=>o.component_kind==='door')){
        const u=d.u+d.w/2,architecture=plan.style.architecture;
        if(architecture==='blue_canopy'){
          box(at(u,.8),4.35,Math.min(L-.4,8),.28,1.65,accent,angle);
          for(const sign of [-1,1]){const q=at(u+sign*Math.min((L-.7)/2,3.5),1.45);
            // Supports are supplied only where they can stand outside the pedestrian approach.
            if(Math.abs(sign*Math.min((L-.7)/2,3.5))>d.w/2+.5)box(q,2.12,.15,4.24,.15,silver,angle);
          }
        }
        if(architecture==='brand_tower'){
          box(at(u,-.06),5.12,Math.min(4.4,L-.4),1.75,.20,accent,angle);
        }
        if(architecture==='entry_portal'){
          box(at(u,.17),4.45,Math.min(8,L-.4),.26,.36,accent,angle);
          for(const edge of [d.u-.11,d.u+d.w+.11]){
            const candidate={u:edge-.06,w:.12,v:0,h:4.32};
            const blocked=f.openings.some(o=>o!==d&&o.u<candidate.u+candidate.w&&o.u+o.w>candidate.u&&o.v<4.32);
            if(!blocked&&edge>.12&&edge<L-.12)box(at(edge,.17),2.16,.12,4.32,.36,silver,angle);
          }
        }
        // Dealer name is subordinate to the marque and remains centered on the entry.
        plane(at(u,.23),Math.min(4.75,shell.height_m-.4),Math.min(7,L-.4),.28,n,text(plan.name,'#292f32'));
      }
      for(const item of plan.showroom.furniture||[])if(item.facade_id===f.id){
        box(item.center,.53,item.width_m,1.06,item.depth_m,mat('#9d8770'),angle);
        box(item.center,1.09,item.width_m+.04,.06,item.depth_m+.04,black,angle);

      }
      // A slim red trim is a Toyota program detail; retain neutral facade panels elsewhere.
      if(plan.brand==='toyota')box(at(L/2,.10),Math.min(5.95,shell.height_m-.1),L-.18,.10,.13,accent,angle);
      // Recessed canopy/soffit lights read as fixtures without one expensive light per bulb.
      for(let u=f.u0+1.5;u<f.u1-1;u+=4)box(at(u,.25),4.18,.55,.035,.18,white,angle);
    }
    batch.finish(group,plan.evidence);
    const vehicles=new THREE.Group();vehicles.name='dealershipCars';vehicles.visible=cars;group.add(vehicles);
    const vb=new Batch(THREE);
    for(const [i,s] of [...plan.stalls,...plan.showroom.cars].entries()){
      if(s.kind==='visitor'||s.render_vehicle===false)continue;
      const matrix=M(s.center[0],(s.floor_y_m||0)-.02,s.center[1],s.heading_degrees);
      const add=(g,m,x,y,z)=>vb.add(g,m,matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x,y,z)));
      const body=mat(['#ebece8','#414e58','#a7b2b5','#843e40','#365b78','#c6c2b7'][i%6],.48,.25),rubber=mat('#161c20');
      // Simple unbranded display proxies. Acquired NPC cars remain archived, per request.
      add(new THREE.BoxGeometry(4.35,.62,1.78),body,0,.55,0);
      add(new THREE.BoxGeometry(2.25,.60,1.56),mat('#667e87',.25,.16),-.07,1.13,0);
      add(new THREE.BoxGeometry(2.26,.065,1.55),body,-.07,1.46,0);
      for(const x of [-1.38,1.38])for(const z of [-.89,.89]){
        const wheel=new THREE.CylinderGeometry(.32,.32,.20,16);wheel.rotateX(Math.PI/2);add(wheel,rubber,x,.34,z);
        const hub=new THREE.CylinderGeometry(.20,.20,.205,12);hub.rotateX(Math.PI/2);add(hub,silver,x,.34,z);
      }
      for(const z of [-.61,.61]){add(new THREE.BoxGeometry(.065,.13,.32),white,2.19,.65,z);add(new THREE.BoxGeometry(.065,.12,.35),mat('#b5222c'),-2.19,.64,z);}
      add(new THREE.BoxGeometry(.07,.22,.8),black,2.21,.42,0);
      for(const z of [-.82,.82])add(new THREE.BoxGeometry(.16,.10,.06),silver,-.20,.89,z);
    }
    vb.finish(vehicles,plan.evidence);
    group.userData={inferredDealership:plan.id,canonicalGeometryModified:false,evidence:plan.evidence};target.add(group);return group;
  }
  return {mount,dispose(){for(const t of textures)t.dispose();for(const m of materials.values())m.dispose();}};
}
