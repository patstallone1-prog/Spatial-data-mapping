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
export function createGrassStrands(THREE,{sample,parent,onMesh=()=>{},cellSize=8,radius=14,maxCells=16,motion=null}={}){
  const group=new THREE.Group();group.name='inferred-grass-strands';parent.add(group);
  const cells=new Map(),material=new THREE.MeshStandardMaterial({vertexColors:true,
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
  function make(tx,tz){
    const positions=[],colours=[],indices=[],tips=[];
    const slots=Math.round(cellSize/.125);
    for(let r=tz*slots;r<(tz+1)*slots;r++)for(let c=tx*slots;c<(tx+1)*slots;c++){
      const blade=grassBlade(c,r),at=sample(blade.x,blade.z);
      if(!at||!Number.isFinite(at.y))continue;
      // Test the blade's complete lean envelope, not only its root: paths stay clear.
      // (Four plain calls: a list of four pairs made for each of a cell's 4,096 blades was
      // most of what building a cell threw away.)
      if(!sample(blade.x-.045,blade.z)||!sample(blade.x+.045,blade.z)||!sample(blade.x,blade.z-.045)||!sample(blade.x,blade.z+.045))continue;
      const h=blade.height*(at.heightScale??1),w=blade.width;
      const dx=Math.cos(blade.angle),dz=Math.sin(blade.angle),bend=h*blade.bend;
      const x=blade.x,z=blade.z,y=at.y,base=positions.length/3;
      positions.push(x-dx*w,y,z-dz*w,x+dx*w,y,z+dz*w,
        x-dx*w*.55-dz*bend*.3,y+h*.55,z-dz*w*.55+dx*bend*.3,
        x+dx*w*.55-dz*bend*.3,y+h*.55,z+dz*w*.55+dx*bend*.3,
        x-dz*bend,y+h,z+dx*bend);
      for(let i=0;i<5;i++){
        colour.setHSL(blade.hue+(at.hueShift??0),.48,blade.light*(i<2?.68:i===4?1.12:1),THREE.SRGBColorSpace);
        colours.push(colour.r,colour.g,colour.b);
      }
      indices.push(base,base+1,base+2,base+1,base+3,base+2,base+2,base+3,base+4);
      tips.push(0,0,.55,.55,1);
    }
    if(!indices.length)return null;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
    geometry.setAttribute('bladeT',new THREE.Float32BufferAttribute(tips,1));
    geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.userData={surface:'grass_strands',inferred:true,liftedOntoGround:true};
    mesh.receiveShadow=true;onMesh(mesh);return mesh;
  }
  return {group,update(x,z,eyeHeight=0){
    const changed=Math.hypot(x-lastX,z-lastZ)>=3||group.visible!==(eyeHeight<70);
    group.visible=eyeHeight<70;if(!group.visible)return;
    if(changed){lastX=x;lastZ=z;const wanted=[];
    for(let tz=Math.floor((z-radius)/cellSize);tz<=Math.floor((z+radius)/cellSize);tz++)
      for(let tx=Math.floor((x-radius)/cellSize);tx<=Math.floor((x+radius)/cellSize);tx++){
        const distance=Math.hypot((tx+.5)*cellSize-x,(tz+.5)*cellSize-z);
        if(distance<radius+cellSize*.7)wanted.push({tx,tz,distance,key:`${tx}:${tz}`});
      }
    wanted.sort((a,b)=>a.distance-b.distance);wanted.length=Math.min(wanted.length,maxCells);
    const keys=new Set(wanted.map(v=>v.key));
    for(const [key,mesh] of cells)if(!keys.has(key)){if(mesh){group.remove(mesh);mesh.geometry.dispose();}cells.delete(key);}
    desired=wanted;}
    // Incremental, nearest-first: never construct the entire lawn in one frame.
    if(performance.now()-lastBuild<80)return;
    const v=desired.find(v=>!cells.has(v.key));if(!v)return;
    lastBuild=performance.now();const mesh=make(v.tx,v.tz);cells.set(v.key,mesh);if(mesh)group.add(mesh);
  },invalidate(){lastX=Infinity;for(const mesh of cells.values())if(mesh){group.remove(mesh);mesh.geometry.dispose();}cells.clear();},
  dispose(){for(const mesh of cells.values())mesh?.geometry.dispose();cells.clear();material.dispose();parent.remove(group);}};
}
