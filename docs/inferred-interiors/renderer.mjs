// Shared renderer for the bounded interior lab and Kerbside's generated-house overlay.
// Geometry uses the serialized metre contract. GLTFs fit the exact collision/support box.
export function buildInferredHouse(THREE, house, options = {}) {
  const {loadAsset, assetBase, wallHeight = 0.95, exterior = true, explode = 0, floor = -1, ceilings = false} = options;
  const group = new THREE.Group(), floorGroups = [], doors = [], segments = [], pending = [], assetErrors = [];
  const material = (color, extra={}) => new THREE.MeshStandardMaterial({color, roughness:0.72, ...extra});
  const wood = material(house.style.wood), fabric = material(house.style.fabric);
  const cream = material('#e8e1d3'), dark = material(house.style.metal), ceramic = material('#f0efea');
  function shapeOf(geometry) {
    const rings=geometry.coordinates;
    const result=new THREE.Shape(rings[0].map(([x,y])=>new THREE.Vector2(x,-y)));
    for(const ring of rings.slice(1)) result.holes.push(new THREE.Path(ring.map(([x,y])=>new THREE.Vector2(x,-y))));
    return result;
  }
  const floorMaterials=new Map();
  function floorMaterial(color,finish) {
    if(!finish)return material(color,{side:THREE.DoubleSide});
    const key=color+finish;if(floorMaterials.has(key))return floorMaterials.get(key);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d');
    if(finish==='tile') {
      ctx.fillStyle='#b2b6aa';ctx.fillRect(0,0,512,512);
      for(let x=0;x<4;x++)for(let y=0;y<4;y++) {
        ctx.fillStyle='#'+new THREE.Color(color).multiplyScalar(.96+((x*7+y*3)%5)*.012).getHexString();
        ctx.fillRect(x*128+2,y*128+2,124,124);
      }
    } else {
      for(let i=0;i<4;i++) {
        ctx.fillStyle='#'+new THREE.Color(color).multiplyScalar(.91+i*.035).getHexString();ctx.fillRect(i*128,0,128,512);
        ctx.strokeStyle='#342b2118';ctx.lineWidth=1;
        for(let j=0;j<45;j++){ctx.beginPath();const x=i*128+j*2.8;ctx.moveTo(x,0);ctx.bezierCurveTo(x+7,150,x-6,350,x+2,512);ctx.stroke();}
        ctx.fillStyle='#342b2125';ctx.fillRect(i*128,0,1.5,512);ctx.fillRect(i*128,(i%2)*256,128,1.5);
      }
    }
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(.7,.7);texture.anisotropy=4;
    const mat=material('#ffffff',{map:texture,side:THREE.DoubleSide});floorMaterials.set(key,mat);return mat;
  }
  function plane(parent, geometry, color, y, holes=[], finish=null) {
    const shape=shapeOf(geometry);
    for(const hole of holes) shape.holes.push(new THREE.Path(hole.coordinates[0].map(([x,y])=>new THREE.Vector2(x,-y))));
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),floorMaterial(color,finish));
    mesh.rotation.x=-Math.PI/2; mesh.position.y=y; mesh.receiveShadow=true; parent.add(mesh);return mesh;
  }
  function box(parent,w,h,d,x,y,z,mat=wood) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function wall(parent,a,b,y,h,color,thick=.10) {
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.015)return;
    const mats=Array.isArray(color)?[material('#e8e4da'),material('#e8e4da'),material('#e8e4da'),material('#e8e4da'),material(color[0]),material(color[1])]:material(color);
    const mesh=box(parent,length,h,thick,(a[0]+b[0])/2,y+h/2,(a[1]+b[1])/2,mats);
    mesh.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);return mesh;
  }
  function fixture(parent,o) {
    const [w,h,d]=o.size_m,role=o.role;
    if(role==='bed') {
      box(parent,w,.22,d,0,.21,0);box(parent,w*.97,.23,d*.95,0,.43,0,cream);
      box(parent,w,h,.09,0,h/2,-d/2+.045);box(parent,w*.94,.035,d*.55,0,.56,d*.17,fabric);
      for(const x of w>1.2?[-w*.23,w*.23]:[0])box(parent,w*.35,.13,.38,x,.61,-d*.3,cream);
    } else if(role==='sofa'||role==='armchair') {
      box(parent,w*.9,.16,d*.85,0,.17,0,dark);box(parent,w,.24,d*.85,0,.36,0,fabric);
      box(parent,w,h*.65,.17,0,h*.65,-d*.4,fabric);
      for(const sign of [-1,1])box(parent,.14,h*.6,d,sign*(w/2-.07),h*.5,0,fabric);
      for(let i=0;i<(w>1.5?3:1);i++)box(parent,w/(w>1.5?3:1)*.8,.09,d*.62,
        w>1.5?(i-1)*w/3:0,.52,.05,cream);
    } else if(['dining_table','coffee_table','desk','nightstand'].includes(role)) {
      box(parent,w,.055,d,0,h-.0275,0);
      for(const x of [-w*.39,w*.39])for(const z of [-d*.36,d*.36])box(parent,.055,h-.055,.055,x,(h-.055)/2,z);
    } else if(['dining_chair','office_chair'].includes(role)) {
      box(parent,w,.06,d,0,.46,0,fabric);box(parent,w,h-.43,.045,0,(h+.43)/2,-d/2,wood);
      for(const x of [-w*.36,w*.36])for(const z of [-d*.36,d*.36])box(parent,.035,.44,.035,x,.22,z);
    } else if(role==='toilet') {
      box(parent,w*.62,h*.45,d*.7,0,h*.23,.06,ceramic);box(parent,w*.85,.08,d*.68,0,h*.48,.06,ceramic);
      box(parent,w*.9,h*.63,d*.25,0,h*.67,-d*.36,ceramic);
      const seat=new THREE.Mesh(new THREE.TorusGeometry(w*.31,.045,12,32),ceramic);seat.rotation.x=Math.PI/2;
      seat.scale.y=1.2;seat.position.set(0,h*.55,.08);parent.add(seat);
    } else if(role==='shower'||role==='bath_shower') {
      if(role==='bath_shower'){box(parent,w,.50,d,0,.25,0,ceramic);box(parent,w*.8,.03,d*.7,0,.505,0,material('#b9d1cc'));}
      box(parent,w,.055,d,0,.0275,0,ceramic);
      const glass=material('#a9c7c9',{transparent:true,opacity:.25,depthWrite:false});
      box(parent,.018,h,d,-w/2+.01,h/2,0,glass);box(parent,w,h,.018,0,h/2,-d/2+.01,glass);
      box(parent,.025,h*.8,.025,w*.25,h*.55,-d*.45,dark);box(parent,.18,.025,.18,w*.25,h*.95,-d*.3,dark);
    } else if(['sink_counter','counter','bath_sink','cooker'].includes(role)) {
      box(parent,w*.97,h-.055,d*.98,0,(h-.055)/2,0,wood);
      box(parent,w,.055,d,0,h-.0275,0,material(house.style.stone));
      for(const x of [-w*.22,w*.22])box(parent,.12,.018,.025,x,h*.75,d/2+.01,dark);
      if(role.includes('sink')) {
        box(parent,w*.65,.018,d*.6,0,h+.005,0,dark);box(parent,w*.52,.022,d*.48,0,h+.018,.015,ceramic);
        box(parent,.025,.22,.025,w*.23,h+.11,-d*.33,dark);box(parent,.025,.025,.16,w*.23,h+.21,-d*.24,dark);
      } else if(role==='cooker') {
        for(const x of [-w*.24,w*.24])for(const z of [-d*.23,d*.23]) {
          const burner=new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,.014,24),dark);
          burner.position.set(x,h+.008,z);parent.add(burner);
        }
        box(parent,w*.77,h*.48,.018,0,h*.4,d/2+.01,dark);
      }
    } else if(role==='refrigerator') {
      box(parent,w,h,d,0,h/2,0,material('#c6c7c5',{metalness:.55,roughness:.35}));
      box(parent,w*.96,.018,.025,0,h*.7,d/2+.01,dark);box(parent,.028,h*.35,.035,w*.35,h*.46,d/2+.03,dark);
    } else if(role==='closet_rail') {
      box(parent,w,.04,d,0,h,0);box(parent,w,.035,.035,0,h*.86,0,dark);
      for(let i=0;i<5;i++)box(parent,.06,h*.4,d*.65,(i-2)*w/6,h*.57,0,fabric);
    } else if(role==='washing_machine') {
      box(parent,w,h,d,0,h/2,0,ceramic);
      const drum=new THREE.Mesh(new THREE.CylinderGeometry(w*.32,w*.32,.04,32),dark);drum.rotation.x=Math.PI/2;
      drum.position.set(0,h*.48,d/2+.01);parent.add(drum);
    } else {
      box(parent,w,h,d,0,h/2,0,role.includes('item')?ceramic:wood);
    }
  }
  function furnish(parent,o) {
    const holder=new THREE.Group();holder.position.set(...o.position_m);holder.rotation.y=-o.rotation_deg*Math.PI/180;
    holder.userData={...o, surface:`furnishing:${o.role}`};parent.add(holder);
    const placeholder=new THREE.Group();fixture(placeholder,o);holder.add(placeholder);
    if(o.asset.procedural||!loadAsset||!assetBase)return;
    const job=Promise.resolve(loadAsset(new URL(o.asset.model,assetBase).href)).then((scene)=>{
      if(!scene)return;const model=scene.clone(true);model.updateMatrixWorld(true);
      if(['bed','sofa','armchair','dining_chair','office_chair'].includes(o.role)) {
        const bounds=new THREE.Box3().setFromObject(model),cut=bounds.min.y+(bounds.max.y-bounds.min.y)*.75;
        let sum=0,n=0;const v=new THREE.Vector3();
        model.traverse(mesh=>{const p=mesh.geometry?.attributes?.position;if(!p)return;
          for(let i=0;i<p.count;i+=Math.max(1,Math.floor(p.count/2000))){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
            if(v.y>=cut){sum+=v.z-(bounds.min.z+bounds.max.z)/2;n++;}}
        });
        if(n&&sum/n>.02*(bounds.max.z-bounds.min.z))model.rotation.y=Math.PI;
        model.updateMatrixWorld(true);
      }
      const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),centre=bounds.getCenter(new THREE.Vector3());
      const [w,h,d]=o.size_m;const scale=new THREE.Vector3(w/size.x,h/size.y,d/size.z);
      model.scale.copy(scale);model.position.set(-centre.x*scale.x,-bounds.min.y*scale.y,-centre.z*scale.z);
      model.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;n.userData.sharedInteriorAsset=true;}});
      holder.remove(placeholder);holder.add(model);
      // Kerbside's bed-frame assets need bedding to represent a usable bed.
      if(o.role==='bed'&&o.asset.id==='old_bed_frame') {
        box(holder,w*.92,.16,d*.89,0,h*.53,0,cream);
        box(holder,w*.89,.03,d*.5,0,h*.64,d*.18,fabric);
      }
    }).catch(error=>assetErrors.push({id:o.asset.id,message:String(error)}));pending.push(job);
  }
  for(const f of house.storeys) {
    const fg=new THREE.Group();fg.name=`storey:${f.level}`;fg.position.y=f.level*explode;fg.visible=floor<0||floor===f.level;
    group.add(fg);floorGroups.push(fg);
    const holes=f.slab_holes||[];
    for(const room of f.rooms) {
      if(room.kind==='stair')continue;
      const mesh=plane(fg,room.polygon,room.materials.floor,f.elevation_m+.01,[],room.materials.floor_finish);
      mesh.userData={roomId:room.id,kind:room.kind,grade:'inferred'};
    }
    if(ceilings)plane(fg,f.inside,'#eeeae1',f.elevation_m+f.height_m-.15,
      f.level<house.storeys.length-1?house.stairs.filter(s=>s.from_level===f.level).map(s=>s.footprint):[]);
    for(const w of f.walls) {
      const coords=w.segment.coordinates;
      for(let i=0;i<coords.length-1;i++)wall(fg,coords[i],coords[i+1],f.elevation_m,Math.min(wallHeight,w.height_m),w.side_materials||w.materials,w.thickness_m);
      const a=coords[0],b=coords.at(-1);segments.push({level:f.level,line:[...a,...b]});
    }
    if(exterior) {
      for(const ring of f.inside.coordinates)for(let i=0;i<ring.length-1;i++) {
        const a=ring[i],b=ring[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<.01)continue;
        let spans=[[0,1]];
        for(const o of f.openings.filter(o=>o.entrance)) {
          const [p,q]=o.segment.coordinates,c=[(p[0]+q[0])/2,(p[1]+q[1])/2];
          const off=Math.abs((c[0]-a[0])*dy-(c[1]-a[1])*dx)/length;
          if(off>.2)continue;const t=((c[0]-a[0])*dx+(c[1]-a[1])*dy)/(length*length),half=o.width_m/2/length;
          spans=spans.flatMap(([l,r])=>t+half<l||t-half>r?[[l,r]]:[[l,Math.max(l,t-half)],[Math.min(r,t+half),r]].filter(([l,r])=>r-l>.001));
        }
        for(const [l,r]of spans)wall(fg,[a[0]+dx*l,a[1]+dy*l],[a[0]+dx*r,a[1]+dy*r],f.elevation_m,Math.min(wallHeight,f.height_m-.15),'#e8e4da',.15);
      }
    }
    for(const o of f.openings.filter(o=>o.leaf_count&&!o.entrance)) {
      const [a,b]=o.segment.coordinates,angle=-Math.atan2(b[1]-a[1],b[0]-a[0]);
      const pivot=new THREE.Group();pivot.position.set(a[0],f.elevation_m,a[1]);pivot.rotation.y=angle;fg.add(pivot);
      const leaf=new THREE.Group();pivot.add(leaf);leaf.rotation.y=1.25;
      box(leaf,o.width_m-.04,Math.min(2.05,wallHeight),.04,o.width_m/2,Math.min(2.05,wallHeight)/2,0,cream);
      doors.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,level:f.level,leaf,open:true,angle:1.25});
    }
    for(const o of f.objects)furnish(fg,o);
    for(const s of house.stairs.filter(s=>s.from_level===f.level&&s.guard_segment)) {
      const [a,b]=s.guard_segment.coordinates,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      const half=s.rise_m*Math.ceil(s.riser_count/2),height=house.storeys[f.level].height_m;
      const points=[[],[]];
      for(const side of [0,1])for(let i=0;i<=4;i++) {
        const t=i/4,offset=side===0?-.045:.045;
        const x=a[0]+dx*t-dz/length*offset,z=a[1]+dz*t+dx/length*offset;
        const y=f.elevation_m+(side===0?half*t:height-(height-half)*t);
        box(fg,.025,.9,.025,x,y+.45,z,dark);points[side].push(new THREE.Vector3(x,y+.9,z));
      }
      for(const list of points)for(let i=0;i<list.length-1;i++) {
        const a=list[i],b=list[i+1],delta=new THREE.Vector3().subVectors(b,a);
        const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,delta.length(),8),wood);
        mesh.position.copy(a).add(b).multiplyScalar(.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());fg.add(mesh);
      }
    }
    for(const s of house.stairs.filter(s=>s.from_level===f.level))for(const step of s.steps) {
      const outline=shapeOf(step.footprint),height=step.top_m-f.elevation_m;
      const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:height,bevelEnabled:false}),wood);
      mesh.rotation.x=-Math.PI/2;mesh.position.y=f.elevation_m;mesh.castShadow=mesh.receiveShadow=true;fg.add(mesh);
    }
  }
  group.userData={surface:'interior',grade:'inferred',engine:'kerbside-polygon-v1'};
  return {group,floorGroups,doors,segments,assetErrors,ready:Promise.all(pending)};
}
