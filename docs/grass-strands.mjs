// Render-only grass. Deterministic world-space blades; no change to land-cover truth.
function hash(x,z,s){let h=Math.imul(x^s,374761393)^Math.imul(z,668265263);h=Math.imul(h^h>>>13,1274126177);return ((h^h>>>16)>>>0)/4294967296;}
export function centredVariation(x,z,s){
  let sum=0;for(let k=0;k<6;k++)sum+=hash(x,z,s+k*173);
  return (sum-3)/3; // Bounded bell-shaped distribution: extremes require six rare draws.
}
export function grassBlade(c,r,{height=.10,hue=.29,spacing=.125}={}){
  return {x:(c+.15+hash(c,r,7)*.7)*spacing,z:(r+.15+hash(c,r,11)*.7)*spacing,
    height:height*(1+.8*centredVariation(c,r,31)),
    hue:hue+.055*centredVariation(c,r,61),
    light:.34+.12*centredVariation(c,r,89),
    width:.004+hash(c,r,107)*.003,angle:hash(c,r,127)*Math.PI*2,
    bend:.10+.25*hash(c,r,149)};
}
//: A lawn is not one length: it was mown in passes, is wetter in one place and trodden in another.
//: A smooth field over PATCH_M metres scales every blade's length by up to PATCH_SPREAD either way.
export const PATCH_M=1.6,PATCH_SPREAD=.18;
export function patchLength(x,z){
  const gx=x/PATCH_M,gz=z/PATCH_M,ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz;
  const sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz),h=(a,b)=>hash(a,b,401);
  const top=h(ix,iz)+(h(ix+1,iz)-h(ix,iz))*sx,bottom=h(ix,iz+1)+(h(ix+1,iz+1)-h(ix,iz+1))*sx;
  return 1+PATCH_SPREAD*(2*(top+(bottom-top)*sz)-1);
}
//: The strands a lawn is made of are not one green: most are a mid green, some are new and
//: yellow-green, some have dried to straw and a few are old and dark at the bottom of the sward.
//: Each kind has its share and a range of hue, saturation and lightness (HSL, 0..1), matched to
//: the lawn's own picture (grassTexture) so the blades and the ground under them agree.
export const GRASS_STRANDS=[
  {kind:'green',share:.68,hue:[.265,.33],sat:[.40,.56],light:[.27,.41]},
  {kind:'new',share:.14,hue:[.21,.25],sat:[.48,.60],light:[.38,.48]},
  {kind:'straw',share:.12,hue:[.10,.145],sat:[.28,.40],light:[.40,.53]},
  {kind:'dark',share:.06,hue:[.29,.33],sat:[.30,.42],light:[.16,.23]},
];
export function strandColour(c,r,k){
  let pick=hash(c,r,211+k*17),i=0;
  while(i<GRASS_STRANDS.length-1&&pick>GRASS_STRANDS[i].share){pick-=GRASS_STRANDS[i].share;i++;}
  const s=GRASS_STRANDS[i],at=(range,salt)=>range[0]+(range[1]-range[0])*hash(c,r,salt+k*29);
  return {kind:s.kind,hue:at(s.hue,223),sat:at(s.sat,227),light:at(s.light,229)};
}
//: How long a blade grows (m): the lawn's patch length, then each blade a little longer or shorter
//: than its neighbours (a bell, mostly within a quarter either way).
export const BLADE_HEIGHT_M=.10;
export function bladeLength(c,r,k,x,z){
  return BLADE_HEIGHT_M*patchLength(x,z)*(1+.45*centredVariation(c,r,31+k*7));
}
//: The blades growing from one slot of the sward: a tuft of one to three (2.2 on average), each its own colour,
//: length, width and lean, leaning out from the tuft's middle. ``spacing`` is the slot's size (m).
export function grassTuft(c,r,{spacing=.125}={}){
  const x0=(c+.15+hash(c,r,7)*.7)*spacing,z0=(r+.15+hash(c,r,11)*.7)*spacing;
  const n=1+(hash(c,r,163)<.78?1:0)+(hash(c,r,167)<.42?1:0),blades=[];
  for(let k=0;k<n;k++){
    const spread=k?.008+hash(c,r,171+k)*.018:0,around=hash(c,r,173+k)*Math.PI*2;
    const x=x0+Math.cos(around)*spread,z=z0+Math.sin(around)*spread,colour=strandColour(c,r,k);
    // A blade's flat side faces any way; it leans away from the tuft's middle, more the longer it is.
    const angle=hash(c,r,127+k*3)*Math.PI*2,lean=k?around:hash(c,r,179)*Math.PI*2;
    blades.push({x,z,height:bladeLength(c,r,k,x,z),width:.0042+hash(c,r,107+k*5)*.0034,angle,lean,
      bend:.12+.28*hash(c,r,149+k*3),fold:.45+.3*hash(c,r,181+k),...colour});
  }
  return blades;
}
//: A blade is folded along its midrib (a shallow V, as a real leaf blade is), narrows to a point and
//: curves over as it leans: seven points, six triangles. Writes into the arrays at ``v`` (points)
//: and ``t`` (indices) and returns how many points it used.
export const BLADE_POINTS=7,BLADE_TRIANGLES=6;
export function writeBlade(b,y,pos,v,idx,t,tips){
  const h=b.height,w=b.width,dx=Math.cos(b.angle),dz=Math.sin(b.angle);
  const lx=Math.cos(b.lean),lz=Math.sin(b.lean),bend=h*b.bend,fold=w*b.fold;
  // Folded towards the side it leans to: the V opens away from the lean, as a blade bends over.
  const nx=-dz,nz=dx,side=nx*lx+nz*lz>=0?1:-1,fx=nx*fold*side,fz=nz*fold*side;
  const o=v*3,put=(k,x,yy,z)=>{pos[o+k*3]=x;pos[o+k*3+1]=yy;pos[o+k*3+2]=z;};
  const mx=lx*bend*.28,mz=lz*bend*.28,mh=h*.52,tx=lx*bend,tz=lz*bend,th=h*(1-.18*b.bend);
  put(0,b.x-dx*w,y,b.z-dz*w);put(1,b.x+dx*w,y,b.z+dz*w);put(2,b.x+fx,y,b.z+fz);
  put(3,b.x-dx*w*.62+mx,y+mh,b.z-dz*w*.62+mz);put(4,b.x+dx*w*.62+mx,y+mh,b.z+dz*w*.62+mz);
  put(5,b.x+fx*.6+mx,y+mh*1.02,b.z+fz*.6+mz);put(6,b.x+tx,y+th,b.z+tz);
  const f=[0,2,3,2,5,3,2,1,5,1,4,5,3,5,6,5,4,6];
  for(let i=0;i<18;i++)idx[t+i]=v+f[i];
  const T=[0,0,0,.52,.52,.52,1];for(let i=0;i<7;i++)tips[v+i]=T[i];
  return BLADE_POINTS;
}
//: Each point's share of the blade's own colour: darker in the shade at the root, the midrib catching
//: the light, the tip palest.
export const BLADE_SHADE=[.66,.66,.72,.98,.98,1.06,1.14];
// Match the triangles actually drawn, not a differently interpolated height field.
export function triangleGroundSampler(meshes,cell=4){
  // The triangles as nine numbers each in one array, and for each grid cell the list of the
  // triangles over it. It was an object a triangle holding three lists of three numbers, in
  // lists keyed by strings: 120 MB kept for the Marina's ground (measured 2026-11-16), for the
  // same answers. Kept as doubles: the same numbers the meshes hold, whatever they hold them as.
  const grid=new Map(),keyOf=(x,z)=>(x+1048576)*2097152+z+1048576;
  let tri=new Float64Array(9*4096),count3=0;
  for(const mesh of meshes){
    const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.getIndex();
    const count=index?index.count:p.count;
    // Read straight from plain arrays: through getX a value at a time, with lists made for every
    // triangle, this was a tenth of a second of a window's build (2026-11-05). Same numbers.
    const plain=a=>a&&!a.isInterleavedBufferAttribute&&!a.normalized;
    const P=plain(p)&&p.itemSize===3?p.array:null,I=index&&plain(index)?index.array:null;
    for(let i=0;i<count;i+=3){
      if(count3+9>tri.length){const more=new Float64Array(tri.length*2);more.set(tri);tri=more;}
      for(let k=0;k<3;k++){
        const n=index?(I?I[i+k]:index.getX(i+k)):i+k,o=count3+k*3;
        if(P){tri[o]=P[n*3];tri[o+1]=P[n*3+1];tri[o+2]=P[n*3+2];}
        else{tri[o]=p.getX(n);tri[o+1]=p.getY(n);tri[o+2]=p.getZ(n);}
      }
      const ax=tri[count3],az=tri[count3+2],bx=tri[count3+3],bz=tri[count3+5],cx=tri[count3+6],cz=tri[count3+8];
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      if(Math.abs(den)<1e-10)continue;
      const minX=Math.floor(Math.min(ax,bx,cx)/cell),maxX=Math.floor(Math.max(ax,bx,cx)/cell);
      const minZ=Math.floor(Math.min(az,bz,cz)/cell),maxZ=Math.floor(Math.max(az,bz,cz)/cell);
      for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
        const key=keyOf(x,z);let list=grid.get(key);if(!list)grid.set(key,list=[]);list.push(count3);
      }
      count3+=9;
    }
  }
  tri=tri.slice(0,count3);
  const sample=(x,z)=>{
    let y=null;
    const list=grid.get(keyOf(Math.floor(x/cell),Math.floor(z/cell)));
    if(list)for(let n=0;n<list.length;n++){
      const o=list[n],ax=tri[o],ay=tri[o+1],az=tri[o+2],bx=tri[o+3],by=tri[o+4],bz=tri[o+5],cx=tri[o+6],cy=tri[o+7],cz=tri[o+8];
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den;
      const v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;
      if(Math.min(u,v,w)<-1e-7)continue;
      const at=ay*u+by*v+cy*w;y=y===null?at:Math.max(y,at);
    }return y;
  };
  // The grid let go with the world it was drawn from: a closure kept anywhere keeps no triangles.
  sample.clear=()=>{grid.clear();tri=new Float64Array(0);};
  return sample;
}
//: What every grass layer has done, for checking from outside (globalThis.__kerbsideGrassStats()):
//: cells built and how many came out empty, rebuilds forced, moves and visibility flips.
const grassLayers=[];
export function grassStats(){return grassLayers.map(l=>({...l.stats,cells:l.cells.size,meshes:l.group.children.length}));}
globalThis.__kerbsideGrassStats=grassStats;
export function createGrassStrands(THREE,{sample,parent,onMesh=()=>{},cellSize=8,radius=14,maxCells=16,motion=null}={}){
  const group=new THREE.Group();group.name='inferred-grass-strands';parent.add(group);
  const stats={builds:0,empty:0,emptyKnown:0,invalidations:0,moves:0,flips:0,dropped:0,trail:[]};
  //: Cells that came out with no grass, remembered until the ground changes (invalidate): the
  //: ground they were sampled on is the same, so they would come out empty again. Dropped out of
  //: reach and asked for again, they were built again -- every frame where the focus moved (all
  //: 1,463 cells built in two minutes in the Marina were empty: 35 MB a second of garbage, 2026-11-20).
  const emptyCells=new Set();
  const cells=new Map();grassLayers.push({stats,cells,group});const material=new THREE.MeshStandardMaterial({vertexColors:true,
    side:THREE.DoubleSide,roughness:1,metalness:0});
  material.onBeforeCompile=shader=>{ globalThis.__kerbsideProxyLight?.patch?.(shader);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vBladeRange;')
      .replace('#include <project_vertex>','#include <project_vertex>\nvBladeRange=length(mvPosition.xyz);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vBladeRange;')
      .replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(fract(dot(gl_FragCoord.xy,vec2(.75487766,.56984029)))<smoothstep(14.,20.,vBladeRange))discard;');
  };material.customProgramCacheKey=()=> 'physical-grass-strands-v1';
  // Wind and a walker's feet bend the blades (foliage-motion.mjs); bladeT is root 0 to tip 1.
  motion?.apply(material,'grass');
  const colour=new THREE.Color();let lastX=Infinity,lastZ=Infinity,lastBuild=0,desired=[];
  // One cell's worth of blades written into arrays kept between builds (grown as needed), then
  // copied out at their used length: no list of numbers made for every blade.
  let P=new Float32Array(0),C=new Float32Array(0),Tp=new Float32Array(0),I=new Uint32Array(0);
  const grow=(a,n)=>{const b=new a.constructor(n);b.set(a);return b;};
  const room=(points)=>{
    if(Tp.length>=points)return;
    const n=Math.max(points,Tp.length*2,4096*BLADE_POINTS);
    P=grow(P,n*3);C=grow(C,n*3);Tp=grow(Tp,n);I=grow(I,Math.ceil(n/BLADE_POINTS)*BLADE_TRIANGLES*3);
  };
  function make(tx,tz){
    let v=0,t=0;
    const slots=Math.round(cellSize/.125);
    for(let r=tz*slots;r<(tz+1)*slots;r++)for(let c=tx*slots;c<(tx+1)*slots;c++){
      const tuft=grassTuft(c,r),root=tuft[0],at=sample(root.x,root.z);
      if(!at||!Number.isFinite(at.y))continue;
      // Test the tuft's complete lean envelope, not only its root: paths stay clear.
      // (Four plain calls: a list of four pairs made for each of a cell's 4,096 slots was
      // most of what building a cell threw away.)
      let reach=0;for(const b of tuft)reach=Math.max(reach,Math.hypot(b.x-root.x,b.z-root.z)+b.height*b.bend+b.width*1.2);
      if(!sample(root.x-reach,root.z)||!sample(root.x+reach,root.z)||!sample(root.x,root.z-reach)||!sample(root.x,root.z+reach))continue;
      room(v+tuft.length*BLADE_POINTS);
      for(const blade of tuft){
        if(at.heightScale!==undefined)blade.height*=at.heightScale;
        const used=writeBlade(blade,at.y,P,v,I,t,Tp);
        for(let i=0;i<used;i++){
          colour.setHSL(blade.hue+(at.hueShift??0),blade.sat,Math.min(.9,blade.light*BLADE_SHADE[i]),THREE.SRGBColorSpace);
          C[(v+i)*3]=colour.r;C[(v+i)*3+1]=colour.g;C[(v+i)*3+2]=colour.b;
        }
        v+=used;t+=BLADE_TRIANGLES*3;
      }
    }
    if(!t)return null;
    const positions=P.slice(0,v*3),colours=C.slice(0,v*3),tips=Tp.slice(0,v),indices=I.slice(0,t);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
    geometry.setAttribute('bladeT',new THREE.Float32BufferAttribute(tips,1));
    geometry.setIndex(THREE.Uint32BufferAttribute?new THREE.Uint32BufferAttribute(indices,1):Array.from(indices));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.userData={surface:'grass_strands',inferred:true,liftedOntoGround:true};
    mesh.receiveShadow=true;onMesh(mesh);return mesh;
  }
  return {group,update(x,z,eyeHeight=0){
    const moved=Math.hypot(x-lastX,z-lastZ)>=3,flipped=group.visible!==(eyeHeight<70);
    if(moved){stats.moves++;stats.trail.push([+x.toFixed(1),+z.toFixed(1)]);if(stats.trail.length>8)stats.trail.shift();}if(flipped)stats.flips++;
    const changed=moved||flipped;
    group.visible=eyeHeight<70;if(!group.visible)return;
    if(changed){lastX=x;lastZ=z;const wanted=[];
    for(let tz=Math.floor((z-radius)/cellSize);tz<=Math.floor((z+radius)/cellSize);tz++)
      for(let tx=Math.floor((x-radius)/cellSize);tx<=Math.floor((x+radius)/cellSize);tx++){
        const distance=Math.hypot((tx+.5)*cellSize-x,(tz+.5)*cellSize-z);
        if(distance<radius+cellSize*.7)wanted.push({tx,tz,distance,key:`${tx}:${tz}`});
      }
    wanted.sort((a,b)=>a.distance-b.distance);wanted.length=Math.min(wanted.length,maxCells);
    const keys=new Set(wanted.map(v=>v.key));
    for(const [key,mesh] of cells)if(!keys.has(key)){if(mesh){group.remove(mesh);mesh.geometry.dispose();}cells.delete(key);stats.dropped++;}
    desired=wanted;}
    // Incremental, nearest-first: never construct the entire lawn in one frame.
    if(performance.now()-lastBuild<80)return;
    let v=null;for(const w of desired){if(cells.has(w.key))continue;if(emptyCells.has(w.key)){cells.set(w.key,null);stats.emptyKnown++;continue;}v=w;break;}if(!v)return;
    lastBuild=performance.now();const mesh=make(v.tx,v.tz);stats.builds++;
    if(!mesh){stats.empty++;if(emptyCells.size>4096)emptyCells.clear();emptyCells.add(v.key);}
    cells.set(v.key,mesh);if(mesh)group.add(mesh);
  },invalidate(){stats.invalidations++;emptyCells.clear();lastX=Infinity;for(const mesh of cells.values())if(mesh){group.remove(mesh);mesh.geometry.dispose();}cells.clear();},
  dispose(){for(const mesh of cells.values())mesh?.geometry.dispose();cells.clear();material.dispose();parent.remove(group);}};
}
