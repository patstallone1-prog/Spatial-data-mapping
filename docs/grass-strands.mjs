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
  const grid=new Map();
  for(const mesh of meshes){
    const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.getIndex();
    const count=index?index.count:p.count;
    for(let i=0;i<count;i+=3){
      const v=[0,1,2].map(k=>{const n=index?index.getX(i+k):i+k;return [p.getX(n),p.getY(n),p.getZ(n)];});
      const [a,b,c]=v,den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
      if(Math.abs(den)<1e-10)continue;
      const minX=Math.floor(Math.min(...v.map(p=>p[0]))/cell),maxX=Math.floor(Math.max(...v.map(p=>p[0]))/cell);
      const minZ=Math.floor(Math.min(...v.map(p=>p[2]))/cell),maxZ=Math.floor(Math.max(...v.map(p=>p[2]))/cell);
      for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
        const key=`${x}:${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push({a,b,c,den});
      }
    }
  }
  return (x,z)=>{
    let y=null;
    for(const {a,b,c,den} of grid.get(`${Math.floor(x/cell)}:${Math.floor(z/cell)}`)||[]){
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
      const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den,w=1-u-v;
      if(Math.min(u,v,w)<-1e-7)continue;
      const at=a[1]*u+b[1]*v+c[1]*w;y=y===null?at:Math.max(y,at);
    }return y;
  };
}
export function createGrassStrands(THREE,{sample,parent,onMesh=()=>{},cellSize=8,radius=14,maxCells=16,motion=null}={}){
  const group=new THREE.Group();group.name='inferred-grass-strands';parent.add(group);
  const cells=new Map(),material=new THREE.MeshStandardMaterial({vertexColors:true,
    side:THREE.DoubleSide,roughness:1,metalness:0});
  material.onBeforeCompile=shader=>{
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
      if([[-.045,0],[.045,0],[0,-.045],[0,.045]].some(([dx,dz])=>!sample(blade.x+dx,blade.z+dz)))continue;
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
