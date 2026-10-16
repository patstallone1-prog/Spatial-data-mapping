// Render-only botanical forms. Unit crown radius and unit height let clearance use
// real bounding dimensions. No plant here claims to be an observed individual.
import {SPECIES,noiseHash} from './nature-ecology.mjs';

export function botanicalGeometry(species,variant=0){
  const form=SPECIES[species]?.form||species,bark={position:[],uv:[]},leaf={position:[],uv:[]};
  let seed=variant*887+Array.from(species).reduce((n,c)=>n+c.charCodeAt(0),0);
  const rnd=()=>noiseHash(++seed,variant,701);
  const triangle=(out,a,b,c,uv=[[0,0],[1,0],[1,1]])=>{out.position.push(...a,...b,...c);out.uv.push(...uv.flat());};
  const branch=(a,b,r0,r1)=>{
    const d=b.map((v,i)=>v-a[i]),L=Math.hypot(...d),u=[d[2],0,-d[0]];
    if(Math.hypot(...u)<1e-6)u.splice(0,3,1,0,0);
    const ul=Math.hypot(...u);for(let i=0;i<3;i++)u[i]/=ul;
    const v=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]].map(x=>x/L);
    const ring=(p,r,k)=>p.map((x,i)=>x+r*(u[i]*Math.cos(k*Math.PI/3)+v[i]*Math.sin(k*Math.PI/3)));
    for(let k=0;k<6;k++){
      const p=ring(a,r0,k),q=ring(a,r0,k+1),r=ring(b,r1,k+1),s=ring(b,r1,k);
      triangle(bark,p,q,r);triangle(bark,p,r,s);
    }
  };
  const card=(p,w,h,angle,tilt)=>{
    const u=[Math.cos(angle)*w/2,0,Math.sin(angle)*w/2],v=[-Math.sin(angle)*Math.cos(tilt)*h/2,Math.sin(tilt)*h/2,Math.cos(angle)*Math.cos(tilt)*h/2];
    const at=(x,y)=>p.map((a,i)=>a+x*u[i]+y*v[i]);
    triangle(leaf,at(-1,-1),at(1,-1),at(1,1));
    triangle(leaf,at(-1,-1),at(1,1),at(-1,1),[[0,0],[1,1],[0,1]]);
  };
  const cluster=(p,rx,ry,n,droop=0)=>{
    for(let k=0;k<n;k++){
      const a=rnd()*6.283,e=(rnd()-.5)*Math.PI,R=Math.cbrt(rnd());
      card([p[0]+Math.cos(a)*Math.cos(e)*rx*R,p[1]+Math.sin(e)*ry*R,p[2]+Math.sin(a)*Math.cos(e)*rx*R],
        .25+rnd()*.20,.10+rnd()*.09,rnd()*6.283,.3+rnd()*1.1+droop);
    }
  };
  const conifer=['redwood','fir'].includes(form);
  const top=[(rnd()-.5)*.10,1,(rnd()-.5)*.10];
  branch([0,0,0],top,conifer?.045:.065,.008);
  if(conifer){
    for(let w=0;w<9;w++){
      const y=.18+w*.087,reach=(1-y)*1.1;
      for(let j=0;j<5;j++){
        const a=j*1.257+w*1.7+rnd()*.4,tip=[Math.cos(a)*reach,y-.04,Math.sin(a)*reach];
        branch([top[0]*y,y,top[2]*y],tip,.015*(1-y)+.004,.002);
        cluster([tip[0]*.7,y-.01,tip[2]*.7],reach*.40,.04,5);
      }
    }
  }else{
    const tall=form==='eucalyptus',flat=['cypress','pine'].includes(form),droop=form==='willow';
    const forks=flat?7:tall?5:6,base=tall?.52:.30;
    for(let j=0;j<forks;j++){
      const a=j*6.283/forks+rnd()*.6,reach=.45+rnd()*.23,y=flat?.77+rnd()*.08:.55+rnd()*.22;
      const fork=[Math.cos(a)*reach*.55,base+(y-base)*.65,Math.sin(a)*reach*.55],tip=[Math.cos(a)*reach,y,Math.sin(a)*reach];
      branch([0,base,0],fork,.035,.018);branch(fork,tip,.018,.006);
      for(let k=0;k<3;k++){
        const b=a+(k-1)*.85,t=[tip[0]+Math.cos(b)*.16,tip[1]+(tall?.08:flat?.01:.06),tip[2]+Math.sin(b)*.16];
        branch(tip,t,.008,.002);
        cluster(t,tall?.22:flat?.30:.29,tall?.12:flat?.055:.12,tall?13:15,droop?.5:0);
      }
    }
    cluster([top[0],flat?.90:tall?.94:.86,top[2]],flat?.38:.28,flat?.045:.10,18);
  }
  // Scale the completed crown once, including cards, so advertised clearance is true.
  let radius=0,height=0,minY=0;
  for(const g of [bark,leaf])for(let i=0;i<g.position.length;i+=3){radius=Math.max(radius,Math.hypot(g.position[i],g.position[i+2]));height=Math.max(height,g.position[i+1]);minY=Math.min(minY,g.position[i+1]);}
  for(const g of [bark,leaf])for(let i=0;i<g.position.length;i+=3){g.position[i]/=radius;g.position[i+2]/=radius;g.position[i+1]=(g.position[i+1]-minY)/(height-minY);}
  return {bark,leaf,species,form};
}

export function plantGeometry(kind){
  const position=[],uv=[];
  const quad=(a,b,c,d)=>{position.push(...a,...b,...c,...a,...c,...d);uv.push(0,0,1,0,1,1,0,0,1,1,0,1);};
  const fern=kind==='fern',grass=['sedge','bunchgrass'].includes(kind),low=kind==='sorrel';
  for(let j=0;j<(grass?18:fern?9:low?12:22);j++){
    const a=j*2.39996,reach=grass?.5:fern?1:.75,h=low?.7:.75+noiseHash(j,0,991)*.25;
    if(fern){
      for(let k=0;k<7;k++){
        const t=(k+1)/8,r=reach*t,y=Math.sin(t*Math.PI*.8)*h,w=.15*Math.sin(t*Math.PI);
        const x=Math.cos(a)*r,z=Math.sin(a)*r,dx=-Math.sin(a)*w,dz=Math.cos(a)*w;
        quad([x-dx,y,z-dz],[x+dx,y,z+dz],[x+Math.cos(a)*.17,y+.025,z+Math.sin(a)*.17],[x,y+.03,z]);
      }
    }else{
      const dx=Math.cos(a)*reach,dz=Math.sin(a)*reach,w=grass?.035:.24;
      quad([-Math.sin(a)*w,0,Math.cos(a)*w],[Math.sin(a)*w,0,-Math.cos(a)*w],
        [dx+Math.sin(a)*w*.1,h,dz-Math.cos(a)*w*.1],[dx-Math.sin(a)*w*.1,h,dz+Math.cos(a)*w*.1]);
    }
  }
  let radius=0;for(let i=0;i<position.length;i+=3)radius=Math.max(radius,Math.hypot(position[i],position[i+2]));
  if(radius>1)for(let i=0;i<position.length;i+=3){position[i]/=radius;position[i+2]/=radius;}
  return {position,uv};
}

export function trianglePrismPlanes(ring,bottom,top){
  const [a,b,c]=ring,sign=Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
  if(!sign)return [];
  const planes=[[0,1,0,-bottom],[0,-1,0,top]];
  for(let i=0;i<3;i++){const a=ring[i],b=ring[(i+1)%3],nx=-(b[1]-a[1])*sign,nz=(b[0]-a[0])*sign;
    planes.push([nx,0,nz,-nx*a[0]-nz*a[1]]);}
  return planes;
}
export function clipOutsidePrisms(attributes,prisms){
  // Subtract convex building prisms, splitting triangles at their actual edges.
  // Dropping whole triangles/trees leaves gaps; shrinking/moving trees changes
  // the surveyed layout. All attributes interpolate with the new edge vertices.
  const names=Object.keys(attributes),sizes=names.map(n=>attributes[n].size),offsets=[];
  let stride=0;for(const size of sizes){offsets.push(stride);stride+=size;}
  const pOffset=offsets[names.indexOf('position')],out=Object.fromEntries(names.map(n=>[n,[]]));
  const vertex=i=>names.flatMap((name,j)=>Array.from(attributes[name].array.slice(i*sizes[j],(i+1)*sizes[j])));
  const distance=(v,p)=>p[0]*v[pOffset]+p[1]*v[pOffset+1]+p[2]*v[pOffset+2]+p[3];
  const split=(poly,plane,inside)=>{
    const result=[];for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a,plane),db=distance(b,plane),ia=inside?da>=0:da<=0,ib=inside?db>=0:db<=0;
      if(ia)result.push(a);
      if(ia!==ib){const t=da/(da-db);result.push(a.map((v,k)=>v+(b[k]-v)*t));}
    }return result;
  };
  for(let i=0;i<attributes.position.array.length/3;i+=3){
    let polys=[[vertex(i),vertex(i+1),vertex(i+2)]];
    for(const prism of prisms){
      if(!prism.length)continue;const next=[];
      for(const polygon of polys){
        // Most triangles miss most prisms: reject without allocating split lists.
        if(prism.some(p=>polygon.every(v=>distance(v,p)<=1e-8))){next.push(polygon);continue;}
        let remaining=polygon;
        for(const plane of prism){if(remaining.length<3)break;const outside=split(remaining,plane,false);
          if(outside.length>=3)next.push(outside);remaining=split(remaining,plane,true);}
      }polys=next;if(!polys.length)break;
    }
    for(const poly of polys)for(let k=1;k+1<poly.length;k++){
      const tri=[poly[0],poly[k],poly[k+1]],u=[0,1,2].map(i=>tri[1][pOffset+i]-tri[0][pOffset+i]),v=[0,1,2].map(i=>tri[2][pOffset+i]-tri[0][pOffset+i]);
      if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-10)continue;
      for(const vertex of tri)names.forEach((name,j)=>out[name].push(...vertex.slice(offsets[j],offsets[j]+sizes[j])));
    }
  }
  return out;
}

// Raster leaf silhouettes only; tree shape is actual branched geometry, not spheres.
export function vegetationAssets(THREE){
  const textures=new Map(),cache=new Map();
  function texture(species){
    const form=SPECIES[species]?.form||species,key=['pine','redwood','fir','cypress'].includes(form)?'needle':form;
    if(textures.has(key))return textures.get(key);
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');
    for(let j=0;j<100;j++){
      const x=12+noiseHash(j,1,811)*104,y=12+noiseHash(j,2,811)*104,a=noiseHash(j,3,811)*6.283;
      ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillStyle=`rgb(${220+j%25},${225+j%25},${214+j%30})`;
      if(key==='needle'){
        ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1.5;
        for(let k=-3;k<=3;k++){ctx.beginPath();ctx.moveTo(0,k*2);ctx.lineTo(-7,k*2-5);ctx.moveTo(0,k*2);ctx.lineTo(7,k*2-5);ctx.stroke();}
      }else{ctx.beginPath();ctx.ellipse(0,0,form==='eucalyptus'?3.0:4.8,10,0,0,6.283);ctx.fill();}
      ctx.restore();
    }
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;textures.set(key,t);return t;
  }
  function geometry(data){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.position,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));g.computeVertexNormals();g.computeBoundingSphere();return g;}
  function tree(species,variant=0){
    const key=`${species}:${variant}`;if(cache.has(key))return cache.get(key);
    const model=botanicalGeometry(species,variant),spec=SPECIES[species];
    const parts=[{geometry:geometry(model.bark),material:new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),colour:spec.bark},
      {geometry:geometry(model.leaf),material:new THREE.MeshStandardMaterial({map:texture(species),color:0xffffff,alphaTest:.28,side:THREE.DoubleSide,roughness:1}),colour:spec.leaf.map(v=>v*1.15)}];
    cache.set(key,parts);return parts;
  }
  function undergrowth(kind){
    const key=`ground:${kind}`;if(cache.has(key))return cache.get(key);
    const part={geometry:geometry(plantGeometry(kind)),material:new THREE.MeshStandardMaterial({color:0xffffff,side:THREE.DoubleSide,roughness:1,
      ...(kind==='fern'||kind==='bunchgrass'||kind==='sedge'?{}:{map:texture('oak'),alphaTest:.35})})};
    cache.set(key,part);return part;
  }
  return {tree,undergrowth};
}
