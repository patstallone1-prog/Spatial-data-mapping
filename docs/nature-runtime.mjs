// Source-backed bare earth and land cover. All individual plants/rocks are visual inference.
// Public pure functions also run in Node regression tests; THREE is injected by the viewer.
export function hash2(x, y, salt = 0) {
  let h = Math.imul(x ^ salt, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
export function bilinear(data, cols, rows, x, y, unknown = null) {
  if (x < 0 || y < 0 || x > cols - 1 || y > rows - 1) return null;
  const c = Math.min(cols - 2, Math.floor(x)), r = Math.min(rows - 2, Math.floor(y));
  const tx = x - c, ty = y - r;
  const values = [data[r * cols + c], data[r * cols + c + 1],
    data[(r + 1) * cols + c], data[(r + 1) * cols + c + 1]];
  const weights = [(1-tx)*(1-ty), tx*(1-ty), (1-tx)*ty, tx*ty];
  let sum = 0, weight = 0;
  values.forEach((v, i) => { if (v !== unknown) { sum += v * weights[i]; weight += weights[i]; } });
  return weight ? sum / weight : null;
}
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
  }
  return inside;
}
export function segmentDistance(x, y, a, b) {
  const dx = b[0]-a[0], dy = b[1]-a[1], l = dx*dx+dy*dy;
  const t = l ? Math.max(0, Math.min(1, ((x-a[0])*dx+(y-a[1])*dy)/l)) : 0;
  return Math.hypot(x-a[0]-t*dx, y-a[1]-t*dy);
}
export function visibleNatureGround(x,z,coarse,boxes,fineActive) {
  if(boxes.some(b=>b && x>b.x && x<b.z && z>b.y && z<b.w))return false;
  return !coarse || !fineActive;
}
export function pathTileCoordinates(key) {
  const match=/^(-?\d+)-(-?\d+)$/.exec(key);
  if(!match)throw new Error(`Invalid landscape path tile: ${key}`);
  return [Number(match[1]),Number(match[2])];
}
export const COVER_COLOURS = {
  0:[.36,.34,.29], 11:[44/255,97/255,135/255], 12:[.83,.85,.84],
  21:[.34,.38,.28],22:[.43,.43,.37],23:[.43,.43,.40],24:[.40,.40,.38],
  31:[.52,.48,.39],41:[.26,.34,.20],42:[.20,.29,.20],43:[.24,.32,.19],
  52:[.45,.44,.28],71:[.50,.48,.29],81:[.44,.46,.25],82:[.43,.42,.25],
  90:[.27,.34,.24],95:[.38,.40,.25], sand:[.70,.64,.48],
};
export function linearColour(rgb) {
  return rgb.map(v=>v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
}
export function coarseHeight(data, f, x, y) {
  // Match the actual two-triangle far mesh, not a different bilinear physics surface.
  const c=Math.min(f.cols-2,Math.floor(x/160)*4),r=Math.min(f.rows-2,Math.floor(y/160)*4);
  const c1=Math.min(f.cols-1,c+4),r1=Math.min(f.rows-1,r+4);
  const u=(x/40-c)/(c1-c),v=(y/40-r)/(r1-r);
  const a=data[r*f.cols+c],b=data[r*f.cols+c1],d=data[r1*f.cols+c],e=data[r1*f.cols+c1];
  return (u>=v ? a*(1-u)+b*(u-v)+e*v : a*(1-v)+e*u+d*(v-u))*.01;
}
export function fineHeight(tile, heights, f, x, y) {
  const c=Math.min(tile.cols-2,Math.max(0,Math.floor(x/10-tile.c)));
  const r=Math.min(tile.rows-2,Math.max(0,Math.floor(y/10-tile.r)));
  const u=Math.min(1,Math.max(0,x/10-tile.c-c)),v=Math.min(1,Math.max(0,y/10-tile.r-r));
  const vertex=(dc,dr)=>{
    const xx=(tile.c+c+dc)*10,yy=(tile.r+r+dr)*10;
    const edge=Math.min(xx-tile.c*10,yy-tile.r*10,(tile.c+tile.cols-1)*10-xx,(tile.r+tile.rows-1)*10-yy);
    const t=Math.min(1,Math.max(0,edge/80)),s=t*t*(3-2*t);
    return coarseHeight(heights,f,xx,yy)*(1-s)+tile.data[(r+dr)*tile.cols+c+dc]*.01*s;
  };
  const a=vertex(0,0),b=vertex(1,0),d=vertex(0,1),e=vertex(1,1);
  return u>=v?a*(1-u)+b*(u-v)+e*v:a*(1-v)+e*u+d*(v-u);
}
export function treeCandidate(c, r, sample) {
  // One stable, globally-owned candidate per 8 m slot. No camera or tile seed.
  const x = (c+.5)*8 + (hash2(c,r,3)-.5)*3.5;
  const y = (r+.5)*8 + (hash2(c,r,7)-.5)*3.5;
  const s = sample(x,y);
  if (!s || ![21,41,42,43,52,71,90].includes(s.cover) || s.water || s.canopy === null) return null;
  const radius = 2.7 + .95*Math.min(1,s.canopy/70) + (hash2(c,r,11)-.5)*.15;
  // Dense patches emerge from the continuous observed canopy field, not 100 m squares.
  const probability = Math.min(1, s.canopy / 55);
  if (hash2(c,r,19) > probability) return null;
  return {id:`tree:${c}:${r}`,x,y,radius,priority:hash2(c,r,23),
    height: 7 + hash2(c,r,31)*15,
    variant:s.cover===41 ? 0 : s.cover===42 ? [1,2,3][Math.floor(hash2(c,r,29)*3)] : Math.floor(hash2(c,r,29)*4),
    densityCell:[Math.floor(x/100),Math.floor(y/100)],certainty:"inferred-canopy-constrained"};
}
export function acceptedTree(c, r, sample, blocked = () => false) {
  const a = treeCandidate(c,r,sample);
  if (!a || blocked(a.x,a.y,a.radius)) return null;
  // Matérn-II inhibition compares *all* neighbouring candidates, including unloaded cells.
  // Thus loading order cannot introduce overlaps or create different boundary trees.
  for (let dr=-2;dr<=2;dr++) for (let dc=-2;dc<=2;dc++) {
    if (!dc&&!dr) continue;
    const b=treeCandidate(c+dc,r+dr,sample);
    if (b && b.priority<a.priority && !blocked(b.x,b.y,b.radius)
        && Math.hypot(a.x-b.x,a.y-b.y)<a.radius+b.radius+.25) return null;
  }
  return a;
}

async function decodedAsset(resolve, record) {
  const response = await fetch(resolve(`nature/${record.file}`), {cache:"no-cache"});
  if (!response.ok) throw new Error(`Nature asset ${record.file}: ${response.status}`);
  const encoded = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded))]
    .map(v=>v.toString(16).padStart(2,"0")).join("");
  if (digest !== record.sha256) throw new Error(`Nature checksum mismatch: ${record.file}`);
  const bytes = await new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  if (bytes.byteLength !== record.decoded_bytes) throw new Error("Nature array length mismatch");
  return bytes;
}
async function arrayAsset(resolve, record) {
  const bytes=await decodedAsset(resolve,record);
  return record.dtype.includes("i4") ? new Int32Array(bytes) : new Uint8Array(bytes);
}
export async function loadNatureAtlas(resolve) {
  const response = await fetch(resolve("nature/manifest.json"), {cache:"no-cache"});
  if (!response.ok) return null;
  const manifest = await response.json(), f = manifest.frame;
  if (manifest.schema!==1 || f.alignment!=="vertices") throw new Error("Unsupported nature grid");
  const [height, cover, canopy] = await Promise.all(["height","cover","canopy"].map(k=>arrayAsset(resolve,manifest.arrays[k])));
  if ([height,cover,canopy].some(a=>a.length!==f.cols*f.rows)) throw new Error("Invalid nature shape");
  const detail=new Map(), detailRecords=new Map(manifest.detail.tiles.map(t=>[`${t.c/200}:${t.r/200}`,t]));
  const atlas = {manifest, f, height, cover, canopy, detail, detailRecords, resolve,
    local(lon,lat) {return [(lon-f.mid_lon)*f.metres_per_lon-f.x0,(lat-f.mid_lat)*f.metres_per_lat-f.y0];},
    geographic(x,y) {return [f.mid_lon+(x+f.x0)/f.metres_per_lon,f.mid_lat+(y+f.y0)/f.metres_per_lat];},
    sample(x,y, fine=true, final=false) {
      const c=x/f.step_m,r=y/f.step_m;
      if(c<0||r<0||c>f.cols-1||r>f.rows-1)return null;
      const i=Math.min(f.rows-1,Math.round(r))*f.cols+Math.min(f.cols-1,Math.round(c));
      let h=coarseHeight(height,f,x,y);
      if(fine){const key=`${Math.floor(x/2000)}:${Math.floor(y/2000)}`,tile=detail.get(key);
        if(tile){const target=fineHeight(tile,height,f,x,y),t=final?1:tile.blend.value;h=h*(1-t)+target*t;}}
      return {height:h,cover:cover[i],canopy:bilinear(canopy,f.cols,f.rows,c,r,255),water:cover[i]===11};
    },
    async loadDetail(key){
      if(detail.has(key))return detail.get(key);
      const record=detailRecords.get(key);if(!record)return null;
      const tile={...record,data:await arrayAsset(resolve,record),blend:{value:0},morphStart:performance.now()};detail.set(key,tile);return tile;
    },
  };
  return atlas;
}

export function createNatureWorld({THREE,root,atlas,toPage,fromPage,heightAt,waterAt,blockedAt,guestBox,hostBox,onHeightsChanged=()=>{}}) {
  const world=new THREE.Group();world.name="nature-atlas-v1";world.userData.bayWide=true;root.add(world);
  const terrain=new THREE.Group(),features=new THREE.Group();world.add(terrain,features);
  const f=atlas.f,detailMeshes=new Map(),plantGroups=new Map(),pending=new Set(),pathTiles=new Map();
  const stats={source:"3DEP + Annual NLCD 2024 + USFS TCC 2024",inferred:true,trees:0,shrubs:0,rocks:0,trails:0,errors:[]};
  let pathsManifest=null,lastX=Infinity,lastY=Infinity,working=false,forceVersion=0,builtVersion=0;
  const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,envMapIntensity:.5});
  const maskCols=Math.ceil((f.cols-1)*f.step_m/2000),maskRows=Math.ceil((f.rows-1)*f.step_m/2000);
  const activeTexture=new THREE.DataTexture(new Uint8Array(maskCols*maskRows),maskCols,maskRows,THREE.RedFormat);
  activeTexture.needsUpdate=true;activeTexture.magFilter=THREE.NearestFilter;activeTexture.minFilter=THREE.NearestFilter;
  const origin=toPage(...atlas.geographic(0,0)),end=toPage(...atlas.geographic(2000,2000));
  const activeUniform={value:activeTexture};
  const colourPixels=new Uint8Array(f.cols*f.rows*4);
  for(let i=0;i<atlas.cover.length;i++){
    let cover=atlas.cover[i];
    // NLCD's ocean/non-processing code is unknown, not brown land. Only an explicit
    // mapped-water result may refine that unknown; never infer sea from low elevation.
    if(cover===0){const p=toPage(...atlas.geographic(i%f.cols*f.step_m,Math.floor(i/f.cols)*f.step_m));
      if(waterAt(...p,{water:false})===true)cover=11;}
    const rgb=linearColour(COVER_COLOURS[cover]||COVER_COLOURS[0]);
    for(let k=0;k<3;k++)colourPixels[i*4+k]=Math.round(rgb[k]*255);
    colourPixels[i*4+3]=cover===11?255:0;
  }
  const coverTexture=new THREE.DataTexture(colourPixels,f.cols,f.rows,THREE.RGBAFormat);
  coverTexture.needsUpdate=true;coverTexture.minFilter=coverTexture.magFilter=THREE.LinearFilter;
  function terrainMaterial(coarse,morph={value:1}){
    const m=material.clone();
    if(coarse)m.vertexColors=false;
    m.onBeforeCompile=shader=>{
      shader.uniforms.uNatureActive=activeUniform;
      shader.uniforms.uNatureMorph=morph;
      shader.uniforms.uNatureCover={value:coverTexture};
      shader.uniforms.uNatureOrigin={value:new THREE.Vector2(...origin)};
      shader.uniforms.uNatureScale={value:new THREE.Vector2(end[0]-origin[0],end[1]-origin[1])};
      shader.uniforms.uNatureGuest=guestBox || {value:new THREE.Vector4(1,1,0,0)};
      shader.uniforms.uNatureHost=hostBox || {value:new THREE.Vector4(1,1,0,0)};
      if(!coarse){shader.uniforms.uNatureCoast={value:m.userData.coastTexture};
        shader.uniforms.uNatureCoastBounds={value:m.userData.coastBounds};}
      shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 vNatureWorld;"+(coarse?"":"\nattribute float natureOldY;attribute float natureWater;varying float vNatureWater;uniform float uNatureMorph;"))
        .replace('#include <begin_vertex>','#include <begin_vertex>'+(coarse?'':'\ntransformed.y=mix(natureOldY,transformed.y,uNatureMorph);vNatureWater=natureWater;'))
        .replace("#include <project_vertex>","#include <project_vertex>\nvNatureWorld=(modelMatrix*vec4(transformed,1.0)).xyz;");
      shader.fragmentShader=shader.fragmentShader.replace("#include <common>",`#include <common>
varying vec3 vNatureWorld;
uniform sampler2D uNatureActive;uniform sampler2D uNatureCover;uniform vec2 uNatureOrigin;uniform vec2 uNatureScale;uniform vec4 uNatureGuest;uniform vec4 uNatureHost;
${coarse?'':'uniform sampler2D uNatureCoast;uniform vec4 uNatureCoastBounds;varying float vNatureWater;'}
float natureHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float natureNoise(vec2 p){vec2 i=floor(p),a=fract(p);a=a*a*(3.0-2.0*a);return mix(mix(natureHash(i),natureHash(i+vec2(1,0)),a.x),mix(natureHash(i+vec2(0,1)),natureHash(i+vec2(1,1)),a.x),a.y);}`)
        .replace("#include <color_fragment>",`#include <color_fragment>
if(vNatureWorld.x>uNatureGuest.x&&vNatureWorld.x<uNatureGuest.z&&vNatureWorld.z>uNatureGuest.y&&vNatureWorld.z<uNatureGuest.w)discard;
if(vNatureWorld.x>uNatureHost.x&&vNatureWorld.x<uNatureHost.z&&vNatureWorld.z>uNatureHost.y&&vNatureWorld.z<uNatureHost.w)discard;
${coarse?`if(texture2D(uNatureActive,(floor((vNatureWorld.xz-uNatureOrigin)/uNatureScale)+.5)/vec2(${maskCols}.,${maskRows}.)).r>.5)discard;`:""}
${coarse?`vec4 sourceCover=texture2D(uNatureCover,(((vNatureWorld.xz-uNatureOrigin)/uNatureScale)*50.+.5)/vec2(${f.cols}.,${f.rows}.));
diffuseColor.rgb*=sourceCover.rgb;float natureWet=sourceCover.a;`:'float natureWet=vNatureWater;'}
${coarse?'':`vec2 coastUV=(vNatureWorld.xz-uNatureCoastBounds.xy)/uNatureCoastBounds.zw;
vec4 coast=texture2D(uNatureCoast,coastUV);
if(coast.b>.99){
  float wet=smoothstep(.4975,.5025,coast.r);
  natureWet=wet;
  vec3 dry=mix(diffuseColor.rgb,vec3(${linearColour(COVER_COLOURS.sand).join(',')}),smoothstep(.45,.55,coast.g));
  diffuseColor.rgb=mix(dry,vec3(${linearColour(COVER_COLOURS[11]).join(',')}),wet);
}`}
float soil=natureNoise(vNatureWorld.xz*.045),grain=natureNoise(vNatureWorld.xz*3.7);
diffuseColor.rgb*=mix(.89+.16*soil+.10*grain,1.,natureWet);
// World-space fine grains, not a repeated image stamp or a 100 m tile texture.
diffuseColor.rgb+=vec3(.025,.018,.008)*(grain-.5)*(1.-natureWet);`)
        .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(1.,.62,natureWet);')
        .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=.04*natureWet;');
    };
    m.userData.ownedNature=!coarse;m.customProgramCacheKey=()=>`nature-ground-v2-${coarse}`;return m;
  }
  const coarseMaterial=terrainMaterial(true);
  const geoAt=(x,y)=>{const [lon,lat]=atlas.geographic(x,y);return toPage(lon,lat);};
  const surface=(x,y,final=false,coarse=false)=>{
    const s=atlas.sample(x,y,!coarse,final),p=geoAt(x,y);
    if(!s)return null;
    let natural=null,coastDistance=Infinity,coastWater=null;
    const entries=pathTiles.get(`${Math.floor(x/4000)}-${Math.floor(y/4000)}`)?.grid?.get(`${Math.floor(x/50)}:${Math.floor(y/50)}`)||[];
    for(const entry of entries){
      if(entry.w.natural==="coastline"&&entry.a){
        const d=segmentDistance(x,y,entry.a,entry.b);
        if(d<100&&d<coastDistance){coastDistance=d;coastWater=(entry.b[0]-entry.a[0])*(y-entry.a[1])-(entry.b[1]-entry.a[1])*(x-entry.a[0])<0;}
      }else if(entry.w.natural&&entry.area&&pointInRing(x,y,entry.w.local)
        && !(entry.w.localHoles||[]).some(ring=>pointInRing(x,y,ring)))natural=entry.w.natural;
    }
    const wet=waterAt(...p,{...s,water:coastWater??s.water,coastOverride:coastWater!==null});
    const height=heightAt(...p,s.height,wet);
    return {...s,water:wet,p,height,natural,coastSigned:coastWater===null?null:(coastWater?1:-1)*coastDistance};
  };
  function groundMesh(x0,y0,x1,y1,step,mat){
    const nx=Math.ceil((x1-x0)/step),ny=Math.ceil((y1-y0)/step),P=[],C=[],I=[],old=[],wet=[];
    const coast=mat.vertexColors?new Uint8Array((nx+1)*(ny+1)*4):null;
    for(let r=0;r<=ny;r++)for(let c=0;c<=nx;c++){
      const x=Math.min(x1,x0+step*c),y=Math.min(y1,y0+step*r),s=surface(x,y,true,!mat.vertexColors);
      const base=s.water?COVER_COLOURS[11]:s.natural==="beach" ? COVER_COLOURS.sand : COVER_COLOURS[s.cover]||COVER_COLOURS[0];
      P.push(s.p[0],s.height-.035,s.p[1]);C.push(...linearColour(base));
      if(mat.vertexColors){old.push(surface(x,y,false,true).height-.035);wet.push(s.water?1:0);}
      if(coast){const i=(r*(nx+1)+c)*4;
        coast[i]=s.coastSigned===null?128:Math.round(127.5+Math.max(-100,Math.min(100,s.coastSigned))*1.275);
        coast[i+1]=s.natural==='beach'?255:0;coast[i+2]=s.coastSigned===null?0:255;coast[i+3]=255;}
    }
    for(let r=0;r<ny;r++)for(let c=0;c<nx;c++){
      const x=x0+(c+.5)*(x1-x0)/nx,y=y0+(r+.5)*(y1-y0)/ny,p=geoAt(x,y);
      const a=r*(nx+1)+c,b=a+1,d=a+nx+1,e=d+1;I.push(a,b,e,a,e,d);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(P,3));
    if(old.length){geometry.setAttribute("natureOldY",new THREE.Float32BufferAttribute(old,1));
      geometry.setAttribute("natureWater",new THREE.Float32BufferAttribute(wet,1));}
    geometry.setAttribute("color",new THREE.Float32BufferAttribute(C,3));geometry.setIndex(I);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    if(coast){const tex=new THREE.DataTexture(coast,nx+1,ny+1,THREE.RGBAFormat);tex.needsUpdate=true;
      tex.minFilter=tex.magFilter=THREE.LinearFilter;mat.userData.coastTexture=tex;
      const a=geoAt(x0,y0),b=geoAt(x1,y1),dx=(b[0]-a[0])/nx,dy=(b[1]-a[1])/ny;
      mat.userData.coastBounds=new THREE.Vector4(a[0]-dx/2,a[1]-dy/2,b[0]-a[0]+dx,b[1]-a[1]+dy);}
    const mesh=new THREE.Mesh(geometry,mat);mesh.userData={surface:"nature_terrain",natureCoarse:!mat.vertexColors,bayWide:true,liftedOntoGround:true,
      confidence:"source-elevation; classified-cover",provenance:"nature/manifest.json",canonical:false};return mesh;
  }
  // Every area has terrain from boot; fine tiles replace it locally, not an empty horizon.
  for(let y=0;y<(f.rows-1)*40;y+=8000)for(let x=0;x<(f.cols-1)*40;x+=8000)
    terrain.add(groundMesh(x,y,Math.min(x+8000,(f.cols-1)*40),Math.min(y+8000,(f.rows-1)*40),160,coarseMaterial));
  const circle=new THREE.CylinderGeometry(1,1,1,7),sphere=new THREE.IcosahedronGeometry(1,1),cone=new THREE.ConeGeometry(1,1,9);
  const trunkMat=new THREE.MeshStandardMaterial({color:0x66503c,roughness:1}),leafMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
  // Far canopy is an aggregate visual proxy, not a set of invented measured trees.
  // Point primitives avoid millions of distant tree triangles. Full 3D trees replace
  // the proxy gradually, with no reduced-detail tree at pedestrian viewing distance.
  const farMat=new THREE.PointsMaterial({color:0xffffff,vertexColors:true,size:1,sizeAttenuation:true});
  farMat.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float natureSize;varying float vNatureRange;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * natureSize;\nvNatureRange = length(mvPosition.xyz);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vNatureRange;')
      .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
vec2 crown=(gl_PointCoord-.5)*2.;
float crownEdge=.86+.10*sin(atan(crown.y,crown.x)*7.);
if(dot(crown,crown)>crownEdge*crownEdge || vNatureRange<650.)discard;
float fade=smoothstep(650.,1050.,vNatureRange);
if(fract(dot(gl_FragCoord.xy,vec2(.75487766,.56984029)))>fade)discard;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=.78+.22*sqrt(max(0.,1.-dot(crown,crown)));');
  };
  farMat.customProgramCacheKey=()=> 'nature-aggregate-canopy-v1';
  for(let by=0;by<(f.rows-1)*40;by+=8000)for(let bx=0;bx<(f.cols-1)*40;bx+=8000){
    const P=[],C=[],S=[];
    for(let y=by+50;y<Math.min(by+8000,(f.rows-1)*40);y+=100)for(let x=bx+50;x<Math.min(bx+8000,(f.cols-1)*40);x+=100){
      const s=atlas.sample(x,y,false);if(!s||![41,42,43,90].includes(s.cover)||s.canopy===null||s.canopy<15)continue;
      for(let k=0;k<6;k++){
        const sx=x+(hash2(x/100|0,y/100|0,k)-.5)*65,sy=y+(hash2(x/100|0,y/100|0,k+8)-.5)*65;
        const at=surface(sx,sy);if(!at||at.water||blockedAt(...at.p,0))continue;
        const diameter=10+Math.min(12,s.canopy*.15);
        P.push(at.p[0],at.height+8,at.p[1]);C.push(...linearColour([.22,.34,.20]));S.push(diameter);
      }
    }
    if(!P.length)continue;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));g.setAttribute('natureSize',new THREE.Float32BufferAttribute(S,1));g.computeBoundingSphere();
    g.boundingSphere.radius+=40;
    const points=new THREE.Points(g,farMat);points.userData={bayWide:true,surface:'nature_canopy_proxy',inferred:true,
      confidence:'aggregate modelled canopy, not individual trees',provenance:'nature/manifest.json'};world.add(points);
  }
  for(const mat of [trunkMat,leafMat]){
    mat.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vPlantRange;')
        .replace('#include <project_vertex>','#include <project_vertex>\nvPlantRange=length(mvPosition.xyz);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vPlantRange;')
        .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
if(fract(dot(gl_FragCoord.xy,vec2(.75487766,.56984029)))>1.-smoothstep(650.,850.,vPlantRange))discard;`);
    };
    mat.customProgramCacheKey=()=> 'nature-near-plant-fade-v1';
  }
  const dummy=new THREE.Object3D(),colour=new THREE.Color();
  function instances(geometry,mat,items){
    if(!items.length)return null;
    const mesh=new THREE.InstancedMesh(geometry,mat,items.length);
    items.forEach((v,i)=>{dummy.position.set(...v.p);dummy.scale.set(...v.scale);dummy.rotation.set(0,v.turn||0,v.tilt||0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(v.colour)mesh.setColorAt(i,colour.setRGB(...v.colour,THREE.SRGBColorSpace));});
    mesh.computeBoundingSphere();mesh.userData={surface:"nature_vegetation",inferred:true,liftedOntoGround:true,
      confidence:"canopy-constrained visual inference; species unknown",sourceEpoch:2024,provenance:"nature/manifest.json",canonical:false};return mesh;
  }
  function nearbyWays(x,y){return pathTiles.get(`${Math.floor(x/4000)}-${Math.floor(y/4000)}`)?.ways||null;}
  function blocked(x,y,radius){
    const s=surface(x,y),p=s?.p;
    if(!s||s.water||blockedAt(...p,radius))return true;
    const ways=nearbyWays(x,y);if(!ways)return true; // no plants before clearance evidence arrives
    const entries=pathTiles.get(`${Math.floor(x/4000)}-${Math.floor(y/4000)}`)?.grid.get(`${Math.floor(x/50)}:${Math.floor(y/50)}`)||[];
    for(const entry of entries){
      const w=entry.w;
      if(w.natural)continue;
      if(entry.area&&pointInRing(x,y,w.local))return true;
      if(entry.a&&segmentDistance(x,y,entry.a,entry.b)<w.width_m/2+radius+.6)return true;
    }
    return false;
  }
  function plants(tx,ty){
    const trunks=[],crowns=[],needles=[],shrubs=[],rocks=[];
    const x0=tx*200,y0=ty*200;
    for(let r=Math.floor(y0/8);r<Math.floor((y0+200)/8);r++)for(let c=Math.floor(x0/8);c<Math.floor((x0+200)/8);c++){
      const a=acceptedTree(c,r,(x,y)=>atlas.sample(x,y),blocked);
      if(a){const s=surface(a.x,a.y),h=a.height,R=a.radius,turn=hash2(c,r,41)*Math.PI*2;
        trunks.push({p:[s.p[0],s.height+h*.38,s.p[1]],scale:[.13+h*.012,h*.76,.13+h*.012]});
        const leaves=a.variant===1?needles:crowns;
        if(a.variant===1){for(let k=0;k<4;k++)leaves.push({p:[s.p[0],s.height+h*(.43+k*.13),s.p[1]],scale:[R*(1-k*.19),h*.39,R*(1-k*.19)],turn,colour:[.12+hash2(c,r,43)*.08,.23+hash2(c,r,47)*.09,.14]});}
        else for(let k=0;k<6;k++){
          const flat=a.variant===2,slender=a.variant===3;
          leaves.push({p:[s.p[0]+Math.cos(turn+k*2.4)*R*.28,s.height+h*(flat?.70+k*.025:.58+k*.06),s.p[1]+Math.sin(turn+k*2.4)*R*.28],
            scale:[R*(slender?.58:.75),h*(flat?.09:slender?.20:.16),R*(slender?.58:.75)],turn,
            colour:slender?[.29,.38+hash2(c,r,k)*.08,.28]:[.20+hash2(c,r,k)*.10,.31+hash2(c,r,k+4)*.12,.15]});}
      }
      if(hash2(c,r,61)>.23)continue;
      const x=(c+.5)*8,y=(r+.5)*8,s=surface(x,y);if(!s||blocked(x,y,.8)||s.water)continue;
      if([52,71,41,42,43].includes(s.cover))shrubs.push({p:[s.p[0],s.height+.4,s.p[1]],scale:[.6+hash2(c,r,65),.4,.6+hash2(c,r,69)],colour:[.34,.36+hash2(c,r,71)*.1,.21]});
      // Barren alone does not prove beach rocks: only a steep barren slope or mapped rock.
      const east=atlas.sample(x+10,y),west=atlas.sample(x-10,y);
      if(["bare_rock","scree","shingle"].includes(s.natural)||(s.cover===31&&east&&west&&Math.abs(east.height-west.height)>5))rocks.push({p:[s.p[0],s.height+.25,s.p[1]],scale:[.7,.45,.8],turn:hash2(c,r)*6.28,colour:[.44,.42,.38]});
    }
    const group=new THREE.Group();group.userData.bayWide=true;
    for(const item of [instances(circle,trunkMat,trunks),instances(sphere,leafMat,crowns),instances(cone,leafMat,needles),instances(sphere,leafMat,shrubs),instances(sphere,leafMat,rocks)])if(item)group.add(item);
    const trailP=[],trailC=[],trailI=[];
    const trailColours={asphalt:[.29,.30,.29],concrete:[.57,.56,.51],stone:[.52,.50,.45],paving_stones:[.54,.49,.42],gravel:[.54,.49,.39],sand:[.68,.60,.44],ground:[.47,.37,.24],dirt:[.47,.37,.24],unknown:[.47,.37,.24]};
    for(const w of nearbyWays(x0+100,y0+100)||[]){
      if(!w.trail||w.grade_separated||w.area)continue;
      const col=linearColour(trailColours[w.kind==='steps'&&w.surface==='unknown'?'stone':w.surface]||trailColours.unknown),half=w.width_m/2;
      for(let i=1;i<w.local.length;i++){
        const a=w.local[i-1],b=w.local[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<.01)continue;
        // Intersect each segment with this tile before subdivision: no repeated full paths.
        let low=0,high=1;
        for(const [v,d,min,max] of [[a[0],b[0]-a[0],x0,x0+200],[a[1],b[1]-a[1],y0,y0+200]]){
          if(Math.abs(d)<1e-9){if(v<min||v>=max){high=-1;break;}}
          else{let u=(min-v)/d,vv=(max-v)/d;if(u>vv)[u,vv]=[vv,u];low=Math.max(low,u);high=Math.min(high,vv);}
        }
        if(high<=low)continue;
        const n=Math.max(1,Math.ceil(L/(w.kind==='steps'?.28:1.5))),nx=-(b[1]-a[1])/L;
        for(let k=Math.floor(low*n);k<Math.ceil(high*n);k++){
          const ta=Math.max(low,k/n),tb=Math.min(high,(k+1)/n),tm=w.kind==='steps'?(k+.5)/n:(ta+tb)/2;
          const mx=a[0]+(b[0]-a[0])*tm,my=a[1]+(b[1]-a[1])*tm,mid=surface(mx,my);
          if(!mid||mid.water||blockedAt(...mid.p,0))continue;
          const base=trailP.length/3;
          for(const [t,side] of [[ta,-1],[tb,-1],[tb,1],[ta,1]]){
            const x=a[0]+(b[0]-a[0])*t+nx*half*side,y=a[1]+(b[1]-a[1])*t+(b[0]-a[0])/L*half*side,s=surface(x,y);
            trailP.push(s.p[0],(w.kind==='steps'?mid.height:s.height)+.035,s.p[1]);trailC.push(...col);
          }
          trailI.push(base,base+1,base+2,base,base+2,base+3);
          if(w.kind==='steps')for(const edge of [[0,1],[1,2],[2,3],[3,0]]){
            const ia=(base+edge[0])*3,ib=(base+edge[1])*3,q=trailP.length/3;
            for(const [i,lower] of [[ia,false],[ib,false],[ib,true],[ia,true]]){
              const ll=fromPage(trailP[i],trailP[i+2]),at=surface(...atlas.local(...ll));
              trailP.push(trailP[i],lower?Math.min(at.height-.04,mid.height-.15):mid.height+.035,trailP[i+2]);trailC.push(...col);
            }trailI.push(q,q+1,q+2,q,q+2,q+3);
          }
        }
      }
    }
    if(trailI.length){const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(trailP,3));g.setAttribute("color",new THREE.Float32BufferAttribute(trailC,3));g.setIndex(trailI);g.computeVertexNormals();
      const mesh=new THREE.Mesh(g,material);mesh.userData.surface="nature_trail";mesh.userData.provenance="OpenStreetMap; unknown widths/finish inferred";group.add(mesh);}
    group.userData.counts={trees:trunks.length,shrubs:shrubs.length,rocks:rocks.length,trails:trailI.length/6};features.add(group);return group;
  }
  function drop(group){group.removeFromParent();group.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh)o.geometry.dispose();if(o.isInstancedMesh)o.dispose();if(o.material?.userData.ownedNature){o.material.userData.coastTexture?.dispose();o.material.dispose();}});}
  const pathsReady=fetch(atlas.resolve("nature/paths.json"),{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(m=>pathsManifest=m).catch(e=>stats.errors.push(String(e)));
  async function loadPaths(x,y){
    await pathsReady;if(!pathsManifest)return;
    const key=`${Math.floor(x/4000)}-${Math.floor(y/4000)}`;
    if(pathTiles.has(key))return;
    const file=pathsManifest.tiles[key];
    if(!file){pathTiles.set(key,{ways:[],grid:new Map()});return;}
    const data=JSON.parse(new TextDecoder().decode(await decodedAsset(atlas.resolve,file)));data.grid=new Map();
    const [tc,tr]=pathTileCoordinates(key);
    const insert=(entry,x0,y0,x1,y1)=>{
      x0=Math.max(x0,tc*4000);y0=Math.max(y0,tr*4000);
      x1=Math.min(x1,(tc+1)*4000-.001);y1=Math.min(y1,(tr+1)*4000-.001);
      if(x1<x0||y1<y0)return;
      for(let r=Math.floor(y0/50);r<=Math.floor(y1/50);r++)for(let c=Math.floor(x0/50);c<=Math.floor(x1/50);c++){
        const k=`${c}:${r}`;if(!data.grid.has(k))data.grid.set(k,[]);data.grid.get(k).push(entry);
      }
    };
    for(const w of data.ways){w.local=w.points.map(p=>atlas.local(...p));
      w.localHoles=(w.holes||[]).map(ring=>ring.map(p=>atlas.local(...p)));delete w.holes;
      if(w.area){const xs=w.local.map(p=>p[0]),ys=w.local.map(p=>p[1]);insert({w,area:true},Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys));}
      else for(let i=1;i<w.local.length;i++){const a=w.local[i-1],b=w.local[i],R=w.natural==="coastline"?100:w.width_m/2+5;insert({w,a,b},Math.min(a[0],b[0])-R,Math.min(a[1],b[1])-R,Math.max(a[0],b[0])+R,Math.max(a[1],b[1])+R);}
      delete w.points;delete w.source_tags;
    }data.decodedBytes=file.decoded_bytes;pathTiles.set(key,data);
  }
  async function update(x,z){
    const [lon,lat]=fromPage(x,z),[ax,ay]=atlas.local(lon,lat);
    if(working||Math.hypot(ax-lastX,ay-lastY)<100)return;
    working=true;lastX=ax;lastY=ay;
    const version=forceVersion,force=version!==builtVersion,changed=[];
    try{
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)await loadPaths(ax+dx*2100,ay+dy*2100);
      const desired=new Set(),cx=Math.floor(ax/2000),cy=Math.floor(ay/2000);
      const jobs=[];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const tx=cx+dx,ty=cy+dy,key=`${tx}:${ty}`;if(!atlas.detailRecords.has(key))continue;desired.add(key);
        if((detailMeshes.has(key)&&!force)||pending.has(key))continue;
        jobs.push([key,tx,ty]);
      }
      // Bounded concurrency and bounded decoded memory; every region uses identical near detail.
      for(const [key,tx,ty] of jobs){pending.add(key);try{
        const tile=await atlas.loadDetail(key);if(!tile)continue;
        const mesh=groundMesh(tile.c*10,tile.r*10,(tile.c+tile.cols-1)*10,(tile.r+tile.rows-1)*10,10,terrainMaterial(false,tile.blend));
        mesh.userData.natureCoarse=false;
        const previous=detailMeshes.get(key);terrain.add(mesh);if(previous)drop(previous);detailMeshes.set(key,mesh);
        changed.push([tx,ty]);
        activeTexture.image.data[ty*maskCols+tx]=255;activeTexture.needsUpdate=true;
      }finally{pending.delete(key);}await new Promise(r=>setTimeout(r,0));}
      for(const [key,mesh] of detailMeshes)if(!desired.has(key)){
        const [tx,ty]=key.split(":").map(Number);activeTexture.image.data[ty*maskCols+tx]=0;activeTexture.needsUpdate=true;
        drop(mesh);detailMeshes.delete(key);atlas.detail.delete(key);changed.push([tx,ty]);
      }
      if(changed.length)onHeightsChanged(changed.map(([tx,ty])=>[
        ...atlas.geographic(tx*2000,ty*2000),...atlas.geographic((tx+1)*2000,(ty+1)*2000)]));
      if(changed.length){
        await new Promise(resolve=>setTimeout(resolve,650));
        for(const tile of atlas.detail.values())tile.blend.value=1;
        onHeightsChanged(changed.map(([tx,ty])=>[
          ...atlas.geographic(tx*2000,ty*2000),...atlas.geographic((tx+1)*2000,(ty+1)*2000)]));
      }
      const plantDesired=new Set();
      // Load the neighbouring clearance cells before sampling across a cell boundary.
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)await loadPaths(ax+dx*1100,ay+dy*1100);
      for(let ty=Math.floor((ay-700)/200);ty<=Math.floor((ay+700)/200);ty++)for(let tx=Math.floor((ax-700)/200);tx<=Math.floor((ax+700)/200);tx++){
        if(Math.hypot(tx*200+100-ax,ty*200+100-ay)>850)continue;
        const key=`${tx}:${ty}`;plantDesired.add(key);if(!plantGroups.has(key)||force){
          const old=plantGroups.get(key),next=plants(tx,ty);if(old)drop(old);plantGroups.set(key,next);
        }
        await new Promise(r=>setTimeout(r,0));
      }
      for(const [key,group] of plantGroups)if(!plantDesired.has(key)){drop(group);plantGroups.delete(key);}
      stats.trees=stats.shrubs=stats.rocks=stats.trails=0;for(const group of plantGroups.values())for(const k of ["trees","shrubs","rocks","trails"])stats[k]+=group.userData.counts[k];
      stats.detailTiles=detailMeshes.size;stats.plantTiles=plantGroups.size;
      // Retain only the actual 3x3 query set, not every path tile visited during a flight.
      const pathDesired=new Set();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
        pathDesired.add(`${Math.floor((ax+dx*2100)/4000)}-${Math.floor((ay+dy*2100)/4000)}`);
      for(const key of pathTiles.keys())if(!pathDesired.has(key))pathTiles.delete(key);
      stats.decodedPathBytes=[...pathTiles.values()].reduce((n,p)=>n+(p.decodedBytes||0),0);
      stats.decodedHeightBytes=[...atlas.detail.values()].reduce((n,p)=>n+p.data.byteLength,0);
      builtVersion=version;if(forceVersion!==version)lastX=Infinity;
    }catch(e){stats.errors.push(String(e));console.warn("kerbside: landscape refinement failed; retaining coarse terrain",e);lastX=Infinity;}
    finally{working=false;}
  }
  function groundInfoAt(x,z){
    const ll=fromPage(x,z),[ax,ay]=atlas.local(...ll),s=surface(ax,ay);if(!s)return null;
    const entries=pathTiles.get(`${Math.floor(ax/4000)}-${Math.floor(ay/4000)}`)?.grid.get(`${Math.floor(ax/50)}:${Math.floor(ay/50)}`)||[];
    for(const e of entries)if(e.a&&e.w.kind==='steps'&&!e.w.grade_separated&&segmentDistance(ax,ay,e.a,e.b)<e.w.width_m/2){
      const dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1],L=Math.hypot(dx,dy),n=Math.max(1,Math.ceil(L/.28));
      const t=Math.max(0,Math.min(.999999,((ax-e.a[0])*dx+(ay-e.a[1])*dy)/(L*L)));
      const mid=(Math.floor(t*n)+.5)/n,step=surface(e.a[0]+dx*mid,e.a[1]+dy*mid);
      if(step&&!step.water&&!blockedAt(...step.p,0))return {y:step.height+.035,kind:'stairs',inferred:true};
    }
    return {y:s.height,kind:'terrain',water:s.water};
  }
  return {world,terrain,stats,update,blocked,groundInfoAt,
    isVisibleGroundHit(hit){
      if(hit.object.userData.surface!=="nature_terrain")return true;
      const [ax,ay]=atlas.local(...fromPage(hit.point.x,hit.point.z));
      const key=`${Math.floor(ax/2000)}:${Math.floor(ay/2000)}`;
      return visibleNatureGround(hit.point.x,hit.point.z,hit.object.userData.natureCoarse,
        [hostBox?.value,guestBox?.value],detailMeshes.has(key));
    },invalidate(){forceVersion++;lastX=Infinity;},
    tick(now){let active=false;for(const tile of atlas.detail.values())if(tile.blend.value<1){
      tile.blend.value=Math.min(1,Math.max(0,(now-tile.morphStart)/600));active=active||tile.blend.value<1;
    }return active;},
    groundAt(x,z){return groundInfoAt(x,z)?.y??null;},ready:pathsReady};
}
