// Source-backed bare earth and land cover. All individual plants/rocks are visual inference.
// Public pure functions also run in Node regression tests; THREE is injected by the viewer.
import {SPECIES,UNDERGROWTH,LITTER,habitatMixture,speciesAt,field,undergrowthAt,smooth,treeSize,litterScatter,vegetatedCover} from './nature-ecology.mjs';
import {vegetationAssets,botanicalGeometry,BARK_GRAIN_URL} from './vegetation-geometry.mjs';
import {createGrassStrands} from './grass-strands.mjs';
// Keep each existing botanical LOD 30% farther out, without inventing more trees.
const NEAR0=234,NEAR1=338,FAR0=780,FAR1=1066;
export function plantLODWeights(range){const a=smooth(NEAR0,NEAR1,range),b=smooth(FAR0,FAR1,range);return [1-a,a-b,b];}
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
//: Where another world is drawn in full (a page's own box, an attached region's boxes), the
//: landscape's ground gives way. A guest's is a set of boxes: the square round the walker and
//: the strip along the way (NATURE_GUEST_BOXES of them, the rest empty).
export const NATURE_GUEST_BOXES=12;
export function visibleNatureGround(x,z,coarse,boxes,fineActive) {
  if(boxes.flat().some(b=>b && x>b.x && x<b.z && z>b.y && z<b.w))return false;
  return !coarse || !fineActive;
}
export function pathTileCoordinates(key) {
  const match=/^(-?\d+)-(-?\d+)$/.exec(key);
  if(!match)throw new Error(`Invalid landscape path tile: ${key}`);
  return [Number(match[1]),Number(match[2])];
}
export const COVER_COLOURS = {
  0:[.36,.34,.29], 11:[44/255,97/255,135/255], 12:[.83,.85,.84],
  21:[.52,.51,.34],22:[.43,.43,.37],23:[.43,.43,.40],24:[.40,.40,.38],
  31:[.53,.49,.42],41:[.34,.28,.19],42:[.30,.23,.17],43:[.32,.25,.18],
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
  if (!s || ![21,31,41,42,43,52,71,90,95].includes(s.cover) || s.water || !Number.isFinite(s.canopy)) return null;
  const habitat=s.habitat,canopy=habitat?.canopy??s.canopy;
  // Barren margins receive stragglers only with nearby canopy evidence, never
  // from a random fill of a treeless beach, bare summit or developed road.
  if(s.cover===31&&(!habitat||habitat.forest+habitat.scrub<.08||canopy<3))return null;
  const species=speciesAt(x,y,s.lon??-122.45,s.lat??37.79,habitat||{}),spec=SPECIES[species];
  const {height,radius}=treeSize(spec,hash2(c,r,31),hash2(c,r,11));
  // Dense patches emerge from the continuous observed canopy field, not 100 m squares.
  const probability = Math.min(1, canopy / 55)*(.78+.32*field(x,y,65,593));
  if (hash2(c,r,19) > probability) return null;
  // Neighbouring crowns interlock in a stand, so trees are spaced by a part of their spread.
  return {id:`tree:${c}:${r}`,x,y,radius,spacing:radius*.6,priority:hash2(c,r,23),
    height,species,
    variant:s.cover===41 ? 0 : s.cover===42 ? [1,2,3][Math.floor(hash2(c,r,29)*3)] : Math.floor(hash2(c,r,29)*4),
    densityCell:[Math.floor(x/100),Math.floor(y/100)],certainty:"inferred-canopy-constrained"};
}
export function acceptedTree(c, r, sample, blocked = () => false,cache=null) {
  const candidate=(c,r)=>{const key=`${c}:${r}`;if(cache?.has(key))return cache.get(key);
    const a=treeCandidate(c,r,sample);cache?.set(key,a);return a;};
  const a = candidate(c,r);
  if (!a || blocked(a.x,a.y,a.spacing)) return null;
  // Matérn-II inhibition compares *all* neighbouring candidates, including unloaded cells.
  // Thus loading order cannot introduce overlaps or create different boundary trees.
  for (let dr=-2;dr<=2;dr++) for (let dc=-2;dc<=2;dc++) {
    if (!dc&&!dr) continue;
    const b=candidate(c+dc,r+dr);
    if (b && b.priority<a.priority && !blocked(b.x,b.y,b.spacing)
        && Math.hypot(a.x-b.x,a.y-b.y)<a.spacing+b.spacing+.25) return null;
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
  const ecologyResponse=await fetch(resolve('nature/ecology.json'),{cache:'no-cache'});
  if(!ecologyResponse.ok)throw new Error('Missing ecology manifest');
  const ecology=await ecologyResponse.json();
  if(ecology.source_cover_sha256!==manifest.arrays.cover.sha256||ecology.source_canopy_sha256!==manifest.arrays.canopy.sha256)throw new Error('Stale ecology source');
  const [floorPixels,clearance]=await Promise.all([ecology.floor,ecology.clearance].map(r=>arrayAsset(resolve,r)));
  // What the plants grow on: the source classes, with trail strips and wooded parks given back
  // to the land round them (vegetatedCover). `cover` stays the source classification.
  const plantCover=vegetatedCover(cover,canopy,f.cols,f.rows);
  if(floorPixels.length!==f.cols*f.rows*4||clearance.length!==Math.ceil(ecology.clearance.cols*ecology.clearance.rows/8))throw new Error('Invalid ecology arrays');
  const atlas = {manifest, f, height, cover, plantCover, canopy, ecology, floorPixels,detail, detailRecords, resolve,
    floorColourAt(x,y){const c=x/f.step_m,r=y/f.step_m;if(c<0||r<0||c>f.cols-1||r>f.rows-1)return null;
      const x0=Math.min(f.cols-2,Math.floor(c)),y0=Math.min(f.rows-2,Math.floor(r)),u=c-x0,v=r-y0;
      return [0,1,2].map(k=>((floorPixels[(y0*f.cols+x0)*4+k]*(1-u)+floorPixels[(y0*f.cols+x0+1)*4+k]*u)*(1-v)
        +(floorPixels[((y0+1)*f.cols+x0)*4+k]*(1-u)+floorPixels[((y0+1)*f.cols+x0+1)*4+k]*u)*v)/255);},
    farBlocked(x,y){const f=ecology.clearance,c=Math.floor(x/f.step_m),r=Math.floor(y/f.step_m);
      if(c<0||r<0||c>=f.cols||r>=f.rows)return true;const i=r*f.cols+c;return Boolean(clearance[i>>3]&(1<<(i&7)));},
    ecologicalSample(x,y){const s=this.sample(x,y);if(!s)return null;
      const habitat=habitatMixture(plantCover,canopy,f.cols,f.rows,x/f.step_m,y/f.step_m),[lon,lat]=this.geographic(x,y);
      // Qualitative habitat prior, not measured soil moisture or current weather.
      const peninsula=smooth(37.78,37.50,lat)*smooth(-122.10,-122.24,lon);
      const moisture=Math.min(1,(lon<-122.32?.34:.15)+peninsula*.40+habitat.wetland*.45+field(x,y,190,997)*.12);
      return {...s,habitat,lon,lat,moisture};},
    local(lon,lat) {return [(lon-f.mid_lon)*f.metres_per_lon-f.x0,(lat-f.mid_lat)*f.metres_per_lat-f.y0];},
    geographic(x,y) {return [f.mid_lon+(x+f.x0)/f.metres_per_lon,f.mid_lat+(y+f.y0)/f.metres_per_lat];},
    sample(x,y, fine=true, final=false) {
      const c=x/f.step_m,r=y/f.step_m;
      if(c<0||r<0||c>f.cols-1||r>f.rows-1)return null;
      const i=Math.min(f.rows-1,Math.round(r))*f.cols+Math.min(f.cols-1,Math.round(c));
      let h=coarseHeight(height,f,x,y);
      if(fine){const key=`${Math.floor(x/2000)}:${Math.floor(y/2000)}`,tile=detail.get(key);
        if(tile){const target=fineHeight(tile,height,f,x,y),t=final?1:tile.blend.value;h=h*(1-t)+target*t;}}
      return {height:h,cover:plantCover[i],canopy:bilinear(canopy,f.cols,f.rows,c,r,255),water:cover[i]===11};
    },
    async loadDetail(key){
      if(detail.has(key))return detail.get(key);
      const record=detailRecords.get(key);if(!record)return null;
      const tile={...record,data:await arrayAsset(resolve,record),blend:{value:0},morphStart:performance.now()};detail.set(key,tile);return tile;
    },
  };
  return atlas;
}

//: The coarse ground (a vertex every 160 m, all that is drawn past the near detail) under a
//: city: its flat triangles spanned the dips between their corners, and the simple city's
//: streets and lawns, which follow the ground itself a hand above it, went under them -- large
//: triangles of ground, and of sea by the shore, through the roads and the grass. A vertex on or
//: beside developed land is put at the lowest of the ground round it (a lattice across the cells
//: it corners), less a margin, so no triangle stands over any point of the cells it covers.
export const CITY_COVER=new Set([21,22,23,24]);
export const COARSE_CITY_MARGIN_M=1;
export function cityEnvelope(heights,developed,cols,rows,floorAt,margin=COARSE_CITY_MARGIN_M){
  const out=Float32Array.from(heights);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    let near=false;
    for(let dr=-1;dr<=1&&!near;dr++)for(let dc=-1;dc<=1;dc++){
      const rr=r+dr,cc=c+dc;if(rr>=0&&rr<rows&&cc>=0&&cc<cols&&developed[rr*cols+cc]){near=true;break;}}
    if(near)out[r*cols+c]=Math.min(heights[r*cols+c],floorAt(c,r))-margin;
  }
  return out;
}
//: The roads the landscape lays itself, where nothing else draws them (outside the city and the
//: regions, as its trails): a fire road through the Presidio was kept clear of every plant and
//: drawn as nothing, a bare strip of blurred ground twenty metres wide. Motorways and trunk
//: roads are left out: they stand on embankments and viaducts a draped ribbon cannot follow.
export const NATURE_ROADS=new Set(['service','unclassified','residential','living_street','road','tertiary','tertiary_link',
  'secondary','secondary_link','primary','primary_link']);
//: The width of a road nobody measured, by its class (OpenStreetMap's own guidance and the city's
//: streets); it was 7 m for everything, a driveway as wide as a two-lane street. Unpaved, narrower.
export const INFERRED_ROAD_WIDTH_M={service:4,unclassified:6,residential:7,living_street:5,road:6,tertiary:8,
  tertiary_link:6,secondary:10,secondary_link:7,primary:12,primary_link:8};
export const UNPAVED=new Set(['dirt','ground','earth','gravel','fine_gravel','compacted','sand','unpaved','grass','mud','pebblestone']);
export function inferredWidth(w){
  if(w.width_source!=='inferred'||w.trail||!INFERRED_ROAD_WIDTH_M[w.kind])return w.width_m;
  return UNPAVED.has(w.surface)?Math.min(3.5,INFERRED_ROAD_WIDTH_M[w.kind]):INFERRED_ROAD_WIDTH_M[w.kind];
}
//: A fallen log this thick (radius, metres) or more is climbed round, not walked through. Every
//: log the landscape lays down is thicker (litterScatter: 12 to 34 cm); a stick is not a log.
export const LOG_BLOCKS_RADIUS_M=.1;
//: Whether a circle of radius r at (x, z) touches a log: a capsule from (o.x - o.dx, o.z - o.dz)
//: to (o.x + o.dx, o.z + o.dz), o.r thick.
export function logHit(o,x,z,r){
  const L=o.dx*o.dx+o.dz*o.dz,t=L>0?Math.max(-1,Math.min(1,((x-o.x)*o.dx+(z-o.z)*o.dz)/L)):0;
  return Math.hypot(x-(o.x+o.dx*t),z-(o.z+o.dz*t))<o.r+r;
}
export function createNatureWorld({THREE,root,atlas,toPage,fromPage,heightAt,waterAt,blockedAt,guestBox,hostBox,onHeightsChanged=()=>{},motion=null,forestFloor=null,loadModel=null,overview=true}) {
  const world=new THREE.Group();world.name="nature-atlas-v1";world.userData.bayWide=true;root.add(world);
  const terrain=new THREE.Group(),features=new THREE.Group();world.add(terrain,features);
  const f=atlas.f,detailMeshes=new Map(),plantGroups=new Map(),pending=new Set(),pathTiles=new Map();
  const stats={source:"3DEP + Annual NLCD 2024 + USFS TCC 2024",inferred:true,speciesBasis:'regional ecological priors, not an individual-tree inventory',trees:0,shrubs:0,rocks:0,trails:0,farCanopyProxies:0,overviewReady:false,errors:[]};
  let pathsManifest=null,lastX=Infinity,lastY=Infinity,working=false,forceVersion=0,builtVersion=0,requested=null;
  let grassFocus=null;
  const grassStrands=createGrassStrands(THREE,{parent:features,motion,sample:(x,z)=>{
    const outside=visibleNatureGround(x,z,false,[hostBox?.value,guestBox?.value],false);
    if(!outside)return null;
    const [ax,ay]=atlas.local(...fromPage(x,z)),s=surface(ax,ay);
    if(!s||s.water||![21,71,81,90,95].includes(s.cover)||blocked(ax,ay,.06))return null;
    return {y:s.height+.008,heightScale:s.cover===21?.8:1.7,hueShift:s.cover===71?-.035:0};
  }});
  const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,envMapIntensity:.5});
  const maskCols=Math.ceil((f.cols-1)*f.step_m/2000),maskRows=Math.ceil((f.rows-1)*f.step_m/2000);
  const activeTexture=new THREE.DataTexture(new Uint8Array(maskCols*maskRows),maskCols,maskRows,THREE.RedFormat);
  activeTexture.needsUpdate=true;activeTexture.magFilter=THREE.NearestFilter;activeTexture.minFilter=THREE.NearestFilter;
  const origin=toPage(...atlas.geographic(0,0)),end=toPage(...atlas.geographic(2000,2000));
  const activeUniform={value:activeTexture};
  const colourPixels=atlas.floorPixels.slice();
  for(let i=0;i<atlas.cover.length;i++){
    let cover=atlas.cover[i];
    // NLCD's ocean/non-processing code is unknown, not brown land. Only an explicit
    // mapped-water result may refine that unknown; never infer sea from low elevation.
    if(cover===0){const p=toPage(...atlas.geographic(i%f.cols*f.step_m,Math.floor(i/f.cols)*f.step_m));
      if(waterAt(...p,{water:false})===true)cover=11;}
    if(cover===11)for(let k=0;k<3;k++)colourPixels[i*4+k]=Math.round(COVER_COLOURS[11][k]*255);
    // Explicit linear upload is consistent on WebGL1 and WebGL2. Custom
    // shader samplers must not depend on automatic sRGB texture decoding.
    const linear=linearColour([0,1,2].map(k=>colourPixels[i*4+k]/255));
    for(let k=0;k<3;k++)colourPixels[i*4+k]=Math.round(linear[k]*255);
    colourPixels[i*4+3]=cover===11?255:0;
  }
  const coverTexture=new THREE.DataTexture(colourPixels,f.cols,f.rows,THREE.RGBAFormat);
  coverTexture.colorSpace=THREE.NoColorSpace;
  coverTexture.needsUpdate=true;coverTexture.minFilter=coverTexture.magFilter=THREE.LinearFilter;
  const canopyTextureGrid=new THREE.DataTexture(Uint8Array.from(atlas.canopy,v=>v===255?0:Math.round(v*2.55)),f.cols,f.rows,THREE.RedFormat);
  canopyTextureGrid.needsUpdate=true;canopyTextureGrid.minFilter=canopyTextureGrid.magFilter=THREE.LinearFilter;
  function terrainMaterial(coarse,morph={value:1}){
    const m=material.clone();
    if(coarse)m.vertexColors=false;
    m.onBeforeCompile=shader=>{
      shader.uniforms.uNatureActive=activeUniform;
      shader.uniforms.uNatureMorph=morph;
      shader.uniforms.uNatureCover={value:coverTexture};
      shader.uniforms.uNatureCanopy={value:canopyTextureGrid};
      shader.uniforms.uNatureOrigin={value:new THREE.Vector2(...origin)};
      shader.uniforms.uNatureScale={value:new THREE.Vector2(end[0]-origin[0],end[1]-origin[1])};
      shader.uniforms.uNatureGuest=guestBox || {value:Array.from({length:NATURE_GUEST_BOXES},()=>new THREE.Vector4(1,1,0,0))};
      shader.uniforms.uNatureHost=hostBox || {value:new THREE.Vector4(1,1,0,0)};
      if(!coarse){shader.uniforms.uNatureCoast={value:m.userData.coastTexture};
        shader.uniforms.uNatureCoastBounds={value:m.userData.coastBounds};}
      shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 vNatureWorld;"+(coarse?"":"\nattribute float natureOldY;attribute float natureWater;varying float vNatureWater;uniform float uNatureMorph;"))
        .replace('#include <begin_vertex>','#include <begin_vertex>'+(coarse?'':'\ntransformed.y=mix(natureOldY,transformed.y,uNatureMorph);vNatureWater=natureWater;'))
        .replace("#include <project_vertex>","#include <project_vertex>\nvNatureWorld=(modelMatrix*vec4(transformed,1.0)).xyz;");
      shader.fragmentShader=shader.fragmentShader.replace("#include <common>",`#include <common>
varying vec3 vNatureWorld;
uniform sampler2D uNatureActive;uniform sampler2D uNatureCover;uniform sampler2D uNatureCanopy;uniform vec2 uNatureOrigin;uniform vec2 uNatureScale;uniform vec4 uNatureGuest[${NATURE_GUEST_BOXES}];uniform vec4 uNatureHost;
${coarse?'':'uniform sampler2D uNatureCoast;uniform vec4 uNatureCoastBounds;varying float vNatureWater;'}
float natureHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float natureNoise(vec2 p){vec2 i=floor(p),a=fract(p);a=a*a*(3.0-2.0*a);return mix(mix(natureHash(i),natureHash(i+vec2(1,0)),a.x),mix(natureHash(i+vec2(0,1)),natureHash(i+vec2(1,1)),a.x),a.y);}`)
        .replace("#include <color_fragment>",`#include <color_fragment>
for(int i=0;i<${NATURE_GUEST_BOXES};i++){vec4 g=uNatureGuest[i];if(vNatureWorld.x>g.x&&vNatureWorld.x<g.z&&vNatureWorld.z>g.y&&vNatureWorld.z<g.w)discard;}
if(vNatureWorld.x>uNatureHost.x&&vNatureWorld.x<uNatureHost.z&&vNatureWorld.z>uNatureHost.y&&vNatureWorld.z<uNatureHost.w)discard;
${coarse?`if(texture2D(uNatureActive,(floor((vNatureWorld.xz-uNatureOrigin)/uNatureScale)+.5)/vec2(${maskCols}.,${maskRows}.)).r>.5)discard;`:""}
vec2 natureUV=(((vNatureWorld.xz-uNatureOrigin)/uNatureScale)*50.+.5)/vec2(${f.cols}.,${f.rows}.);
vec4 sourceCover=texture2D(uNatureCover,natureUV);
diffuseColor.rgb=sourceCover.rgb;float natureWet=${coarse?'sourceCover.a':'vNatureWater'};
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${linearColour(COVER_COLOURS[11]).join(',')}),natureWet);
${coarse?'':`vec2 coastUV=(vNatureWorld.xz-uNatureCoastBounds.xy)/uNatureCoastBounds.zw;
vec4 coast=texture2D(uNatureCoast,coastUV);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${linearColour(COVER_COLOURS.sand).join(',')}),smoothstep(.45,.55,coast.g));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${linearColour([.48,.47,.43]).join(',')}),smoothstep(.45,.55,coast.a));
if(coast.b>.99){
  float wet=smoothstep(.4975,.5025,coast.r);
  natureWet=wet;
  vec3 dry=mix(diffuseColor.rgb,vec3(${linearColour(COVER_COLOURS.sand).join(',')}),smoothstep(.45,.55,coast.g));
  diffuseColor.rgb=mix(dry,vec3(${linearColour(COVER_COLOURS[11]).join(',')}),wet);
}`}
vec2 rotated=mat2(.8,.6,-.6,.8)*vNatureWorld.xz;
float soil=natureNoise(rotated*.045),grain=(natureNoise(vNatureWorld.xz*9.7)+natureNoise(rotated*17.3))*.5;
float footprint=length(fwidth(vNatureWorld.xz));
float micro=(natureNoise(vNatureWorld.xz*85.)-.5)*(1.-smoothstep(.008,.07,footprint));
// Centimetre grains and scattered elongated leaf litter; no tile-local UVs.
vec2 litter=vNatureWorld.xz*4.1;
vec2 litterCell=floor(litter),leafDelta=fract(litter)-vec2(.18+.64*natureHash(litterCell),.18+.64*natureHash(litterCell+19.));
float angle=6.283*natureHash(litterCell+37.);
leafDelta=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*leafDelta;
float leaf=(1.-smoothstep(.35,.55,length(leafDelta*vec2(2.,6.))))*step(.5,natureHash(litterCell+81.))*(1.-smoothstep(.05,.35,footprint))*smoothstep(.12,.45,texture2D(uNatureCanopy,natureUV).r);
diffuseColor.rgb*=mix(.83+.20*soil+.16*grain+.22*micro,1.,natureWet);
diffuseColor.rgb+=vec3(.018,.012,.004)*(leaf-.22)*(1.-natureWet);
// At kilometre scale a crown becomes sub-pixel, but a forest must not turn
// into bare dirt. Filter the observed canopy fraction into its aggregate
// appearance. The near-field substrate remains soil/litter, not green paint.
float unresolved=smoothstep(650.,1500.,distance(cameraPosition,vNatureWorld));
float canopyCover=texture2D(uNatureCanopy,natureUV).r;
// Seen from afar a wood is crowns: lit tops, dark gaps between them, stands of one tone and the
// next. A crown-sized cellular pattern holds the observed canopy fraction, and fades into its
// own average only once a crown is smaller than a pixel, so a forest reads as a forest.
vec2 crownP=rotated/8.5;vec2 crownI=floor(crownP),crownF=fract(crownP);float crownD=1.5;
for(int cy=-1;cy<=1;cy++)for(int cx=-1;cx<=1;cx++){vec2 o=vec2(float(cx),float(cy));
  vec2 h=vec2(natureHash(crownI+o),natureHash(crownI+o+17.31));crownD=min(crownD,length(o+.15+.7*h-crownF));}
float crownSeen=1.-smoothstep(2.5,11.,footprint);
float crownR=sqrt(clamp(canopyCover,0.,1.)/3.1416)*1.12+.04;
float crownIn=1.-smoothstep(crownR-.07,crownR+.05,crownD);
float crownCover=mix(clamp(canopyCover*1.08,0.,1.),crownIn,crownSeen);
float crownLit=mix(.86,1.18-.75*clamp(crownD/max(crownR,.05),0.,1.),crownSeen);
float stand=natureNoise(rotated*.016)*.62+natureNoise(rotated*.055)*.38,tone=natureNoise(rotated*.0042+7.3);
vec3 canopyAverage=mix(mix(vec3(0.0174,0.0432,0.0153),vec3(0.0470,0.0946,0.0301),stand),mix(vec3(0.0890,0.1128,0.0363),vec3(0.0301,0.0684,0.0470),tone),.32);
canopyAverage*=crownLit*(.88+.24*natureNoise(rotated*.21));
// The ground between crowns is in their shade.
diffuseColor.rgb*=mix(1.,.62,unresolved*canopyCover*(1.-crownIn)*crownSeen);
diffuseColor.rgb=mix(diffuseColor.rgb,canopyAverage,unresolved*crownCover*(1.-natureWet));`)
        .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(1.,.62,natureWet);')
        .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=.04*natureWet;')
        // Coast triangles have sloping vertex normals. Open water shares the
        // same flat normal/BRDF as the city water, independent of region bounds.
        .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=normalize(mix(normal,normalize(mat3(viewMatrix)*vec3(0.,1.,0.)),natureWet));');
    };
    m.userData.ownedNature=!coarse;m.customProgramCacheKey=()=>`nature-ground-ecology-v5-${coarse}`;return m;
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
    const coarse=!mat.vertexColors,heights=coarse?new Float32Array((nx+1)*(ny+1)):null,developed=coarse?new Uint8Array((nx+1)*(ny+1)):null;
    for(let r=0;r<=ny;r++)for(let c=0;c<=nx;c++){
      const x=Math.min(x1,x0+step*c),y=Math.min(y1,y0+step*r),s=surface(x,y,true,coarse);
      const base=s.water?COVER_COLOURS[11]:s.natural==="beach" ? COVER_COLOURS.sand : COVER_COLOURS[s.cover]||COVER_COLOURS[0];
      if(coarse){heights[r*(nx+1)+c]=s.height;developed[r*(nx+1)+c]=!s.water&&CITY_COVER.has(s.cover)?1:0;}
      P.push(s.p[0],s.height-.035,s.p[1]);C.push(...linearColour(base));
      if(mat.vertexColors){old.push(surface(x,y,false,true).height-.035);wet.push(s.water?1:0);}
      if(coast){const i=(r*(nx+1)+c)*4;
        coast[i]=s.coastSigned===null?128:Math.round(127.5+Math.max(-100,Math.min(100,s.coastSigned))*1.275);
        coast[i+1]=s.natural==='beach'?255:0;coast[i+2]=s.coastSigned===null?0:255;
        coast[i+3]=['bare_rock','scree','shingle'].includes(s.natural)?255:0;}
    }
    if(coarse){
      const floor=cityEnvelope(heights,developed,nx+1,ny+1,(c,r)=>{
        const x=Math.min(x1,x0+step*c),y=Math.min(y1,y0+step*r);let low=Infinity;
        for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){const s=surface(x+i*step/2,y+j*step/2,true,true);if(s)low=Math.min(low,s.height);}
        return low;
      });
      for(let i=0;i<floor.length;i++)P[3*i+1]=floor[i]-.035;
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
  const sphere=new THREE.IcosahedronGeometry(1,1),assets=vegetationAssets(THREE,{grainUrl:atlas.resolve?.(BARK_GRAIN_URL)});
  const leafMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
  // Far canopy is an aggregate visual proxy, not a set of invented measured trees.
  // Point primitives avoid millions of distant tree triangles. Full 3D trees replace
  // the proxy gradually, with no reduced-detail tree at pedestrian viewing distance.
  const speciesKeys=Object.keys(SPECIES),canopyCanvas=document.createElement('canvas');canopyCanvas.width=1536;canopyCanvas.height=768;
  const context=canopyCanvas.getContext('2d');
  speciesKeys.forEach((species,index)=>{for(let variant=0;variant<2;variant++){
    const i=index*2+variant,model=botanicalGeometry(species,variant),ox=i%6*256,oy=Math.floor(i/6)*256,spec=SPECIES[species];
    for(const [part,col] of [[model.bark,spec.bark],[model.leaf,spec.leaf]])for(let j=0;j<part.position.length;j+=9){
      const shade=.75+hash2(j,i,11)*.45;context.fillStyle=`rgb(${col.map(v=>Math.round(v*shade*255)).join(',')})`;
      context.beginPath();for(let k=0;k<3;k++){
        const x=ox+128+part.position[j+k*3]*72,y=oy+248-part.position[j+k*3+1]*240;
        if(k)context.lineTo(x,y);else context.moveTo(x,y);
      }context.closePath();context.fill();
    }
  }});
  const canopyTexture=new THREE.CanvasTexture(canopyCanvas);canopyTexture.colorSpace=THREE.NoColorSpace;
  // Premultiplied filtering avoids black fringes around fine foliage in mipmaps.
  // Recover straight colour before the explicit sRGB decode in the shader.
  canopyTexture.premultiplyAlpha=true;
  const farMat=new THREE.PointsMaterial({color:0xffffff,size:1,sizeAttenuation:true,alphaTest:.3});
  function pointMaterial(mid=false){const mat=farMat.clone();mat.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float natureSize;attribute float natureSpecies;attribute float natureAspect;varying float vNatureAspect;varying float vNatureSpecies;varying float vNatureRange;')
      .replace('gl_PointSize = size;', `gl_PointSize = size * natureSize * .01 * max(1.,natureAspect*4.);
vNatureRange = length(mvPosition.xyz);vNatureSpecies=natureSpecies;vNatureAspect=natureAspect*4.;
if(${mid?`vNatureRange<${NEAR0}.||vNatureRange>${FAR1}.`:`vNatureRange<${FAR0}.`})gl_Position=vec4(2.,2.,2.,1.);`);
    if(!mid)shader.vertexShader=shader.vertexShader.replace('#include <logdepthbuf_vertex>',`// Unresolved crowns are already represented by canopy averaging on the
// terrain. Avoid rasterizing millions of sub-pixel alpha-tested points.
if(vNatureRange>3500.&&gl_PointSize*min(1.,natureAspect*4.)*.5625<.75)gl_Position=vec4(2.,2.,2.,1.);
#include <logdepthbuf_vertex>`);
    shader.uniforms.uCanopyAtlas={value:canopyTexture};
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vNatureRange;varying float vNatureAspect;varying float vNatureSpecies;uniform sampler2D uCanopyAtlas;')
      .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
// Whole-landscape silhouettes remain visible in overview; geometry replaces
// them only where a resident detailed vegetation batch actually exists.
float nearMix=smoothstep(${NEAR0}.,${NEAR1}.,vNatureRange),farMix=smoothstep(${FAR0}.,${FAR1}.,vNatureRange);
float dither=fract(dot(gl_FragCoord.xy,vec2(.75487766,.56984029)));
if(${mid?'dither<1.-nearMix||dither>1.-farMix':'dither<1.-farMix'})discard;`)
      .replace('#include <color_fragment>',`#include <color_fragment>
vec2 tile=vec2(mod(vNatureSpecies,6.),2.-floor(vNatureSpecies/6.));
float pointScale=max(1.,vNatureAspect);
float treeU=(gl_PointCoord.x-.5)*pointScale/vNatureAspect+.5;
float treeV=(.5-gl_PointCoord.y)*pointScale+.5;
if(treeU<0.||treeU>1.||treeV<0.||treeV>1.)discard;
vec4 canopy=texture2D(uCanopyAtlas,(tile+vec2(treeU,treeV))/vec2(6.,3.));
vec3 canopySRGB=canopy.rgb/max(canopy.a,.001);
vec3 canopyLinear=mix(canopySRGB/12.92,pow((canopySRGB+.055)/1.055,vec3(2.4)),step(vec3(.04045),canopySRGB));
diffuseColor*=vec4(canopyLinear,canopy.a);`);
    };mat.customProgramCacheKey=()=>`nature-species-canopy-v3-${mid}`;return mat;
  }
  const distantMaterial=pointMaterial(),middleMaterial=pointMaterial(true);
  function treePoints(P,S,K,A,mat){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
    // Keep exact float32 positions. Only visual height (centimetres), species
    // index and silhouette aspect are packed; no canonical geometry is touched.
    g.setAttribute('natureSpecies',new THREE.Uint8BufferAttribute(K,1));g.setAttribute('natureSize',new THREE.Uint16BufferAttribute(S.map(v=>Math.round(v*100)),1));g.setAttribute('natureAspect',new THREE.Uint16BufferAttribute(A.map(v=>Math.round(v/4*65535)),1,true));g.computeBoundingSphere();
    g.boundingSphere.radius+=55;return new THREE.Points(g,mat);
  }
  const overviewStarted=performance.now();
  // `overview` false (the headset, whose haze ends at 150 m): no canopy for the whole Bay. Built
  // in 12 ms slices, on a Quest it took minutes and a slice of every frame, and none of it shows.
  const farReady=!overview?Promise.resolve():(async()=>{let yieldAt=performance.now();for(let by=0;by<(f.rows-1)*40;by+=8000)for(let bx=0;bx<(f.cols-1)*40;bx+=8000){
    const P=[],S=[],K=[],A=[];
    // Global lattice, jittered positions, continuous canopy probabilities. The
    // 8 km draw batches do not affect probability, colour or species choice.
    for(let r=Math.ceil(by/24);r*24<Math.min(by+8000,(f.rows-1)*40);r++)for(let c=Math.ceil(bx/24);c*24<Math.min(bx+8000,(f.cols-1)*40);c++){
      if(c%32===0&&performance.now()-yieldAt>12){await new Promise(resolve=>setTimeout(resolve,0));yieldAt=performance.now();}
      const raw=atlas.sample(c*24+12,r*24+12,false);
      if(!raw||raw.water||raw.canopy===null||raw.canopy<2||[0,12,22,23,24].includes(raw.cover))continue;
      const s=atlas.ecologicalSample(c*24+12,r*24+12),h=s.habitat;
      if(h.forest+h.scrub+h.grass+h.wetland+h.developed*.6<.2)continue;
      for(let k=0;k<4;k++){
        const sx=c*24+(k%2)*12+2+hash2(c,r,887+k)*8,sy=r*24+Math.floor(k/2)*12+2+hash2(c,r,897+k)*8;
        if(hash2(c,r,907+k)>Math.min(.9,h.canopy/60)||atlas.farBlocked(sx,sy))continue;
        const at=surface(sx,sy);if(!at||at.water||blockedAt(...at.p,12))continue;
        const species=speciesAt(sx,sy,s.lon,s.lat,h),spec=SPECIES[species],{height,radius}=treeSize(spec,hash2(c,r,917+k),hash2(c,r,927+k));
        P.push(at.p[0],at.height+height*.5,at.p[1]);S.push(height);K.push(speciesKeys.indexOf(species)*2+(hash2(c,r,k+31)>.5?1:0));A.push(radius*2/height/(144/256));
      }
    }
    if(!P.length)continue;
    const points=treePoints(P,S,K,A,distantMaterial);points.userData={bayWide:true,surface:'nature_canopy_proxy',inferred:true,
      confidence:'aggregate modelled canopy, not individual trees',provenance:'nature/ecology.json'};world.add(points);
    stats.farCanopyProxies+=P.length/3;
    await new Promise(resolve=>setTimeout(resolve,0));
  }stats.overviewReady=true;stats.overviewBuildMs=Math.round(performance.now()-overviewStarted);})().catch(error=>{stats.errors.push(String(error));console.warn('kerbside: overview vegetation unavailable',error);});
  function fadePlant(mat){
    if(mat.userData.natureFade)return;mat.userData.natureFade=true;
    // On top of whatever the material already does to its shader (keepLeavesAtDistance).
    const before=mat.onBeforeCompile,beforeKey=mat.customProgramCacheKey?.bind(mat);
    mat.onBeforeCompile=(shader,renderer)=>{if(before)before.call(mat,shader,renderer);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vPlantRange;')
        .replace('#include <project_vertex>','#include <project_vertex>\nvPlantRange=length(mvPosition.xyz);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vPlantRange;')
        .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
if(fract(dot(gl_FragCoord.xy,vec2(.75487766,.56984029)))>1.-smoothstep(${NEAR0}.,${NEAR1}.,vPlantRange))discard;`);
    };
    mat.customProgramCacheKey=()=>`${beforeKey?beforeKey():''}|nature-near-plant-fade-v1`;
  }
  fadePlant(leafMat);
  // The near forest floor (forest-floor.mjs) and the plant scans it and the middle distance
  // share. Without them (no loader, or the scans fail) the landscape keeps its cut-out cards.
  const floorBand={value:new THREE.Vector2(-2,-1)},MID_SCAN_RANGE=[150,185];
  let scans=null,floor=null,floorStale=false,floorLive=false;
  const midMaterials=new Map();
  const midScanMaterial=source=>{const key=`scan:${source.uuid}`;if(!midMaterials.has(key)){const m=source.clone();
    forestFloor.rangeFade(m,{fadeIn:floorBand,fadeOut:{value:new THREE.Vector2(...MID_SCAN_RANGE)},cull:MID_SCAN_RANGE[1]+4,key:'mid-scan-v1'});
    motion?.apply(m,'shrub');midMaterials.set(key,m);}return midMaterials.get(key);};
  const midCardMaterial=source=>{const key=`card:${source.uuid}`;if(!midMaterials.has(key)){const m=source.clone();
    forestFloor.rangeFade(m,{fadeIn:{value:new THREE.Vector2(...MID_SCAN_RANGE)},fadeOut:{value:new THREE.Vector2(NEAR0,NEAR1)},key:'mid-card-v1'});
    motion?.apply(m,'shrub');midMaterials.set(key,m);}return midMaterials.get(key);};
  let midGrassMaterial=null;const midGrass=new Map(),midGrassGeometry=(kind,variant)=>{const key=`${kind}:${variant}`;if(midGrass.has(key))return midGrass.get(key);
    const d=forestFloor.wildGrassGeometry(kind,variant,0),g=new THREE.BufferGeometry(),c=new THREE.Color(),lin=[];
    for(let i=0;i<d.colour.length;i+=3){c.setRGB(d.colour[i],d.colour[i+1],d.colour[i+2],THREE.SRGBColorSpace);lin.push(c.r,c.g,c.b);}
    g.setAttribute('position',new THREE.Float32BufferAttribute(d.position,3));g.setAttribute('color',new THREE.Float32BufferAttribute(lin,3));
    g.setIndex(d.index);g.computeVertexNormals();const n=g.getAttribute('normal'),v=new THREE.Vector3();
    for(let i=0;i<n.count;i++){v.set(n.getX(i),n.getY(i),n.getZ(i)).lerp(new THREE.Vector3(0,1,0),.65).normalize();n.setXYZ(i,v.x,v.y,v.z);}
    g.computeBoundingSphere();midGrass.set(key,g);return g;};
  const floorTrees=new Map();
  const floorCtx={
    ground(x,y){const s=surface(x,y);return s&&{height:s.height,p:s.p,water:s.water,cover:s.cover,natural:s.natural};},
    ecology:(x,y)=>atlas.ecologicalSample(x,y),blocked:(x,y,r)=>blocked(x,y,r),floorColour:(x,y)=>atlas.floorColourAt(x,y),
    //: The trunks over and around a cell: the landscape's own accepted trees, so leaves fall from them.
    treesNear(x0,y0,x1,y1){const out=[];if(floorTrees.size>40000)floorTrees.clear();
      for(let r=Math.floor(y0/8);r<=Math.floor(y1/8);r++)for(let c=Math.floor(x0/8);c<=Math.floor(x1/8);c++){const key=`${c}:${r}`;
        if(!floorTrees.has(key)){const a=acceptedTree(c,r,(x,y)=>atlas.ecologicalSample(x,y),blocked,candidateCache);
          floorTrees.set(key,a&&{x:a.x,y:a.y,radius:a.radius,height:a.height,species:a.species,forest:atlas.ecologicalSample(a.x,a.y)?.habitat?.forest||0});}
        const t=floorTrees.get(key);if(t)out.push(t);}
      return out;}};
  const scansReady=forestFloor&&loadModel?forestFloor.loadScanLibrary(THREE,{loadModel,resolve:atlas.resolve}).then(library=>{
    scans=library;midGrassMaterial=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.95,envMapIntensity:.4});
    forestFloor.rangeFade(midGrassMaterial,{fadeIn:floorBand,fadeOut:{value:new THREE.Vector2(...MID_SCAN_RANGE)},cull:MID_SCAN_RANGE[1]+4,key:'mid-grass-v1'});
    motion?.apply(midGrassMaterial,'shrub');
    floor=forestFloor.createForestFloor(THREE,{parent:features,ctx:floorCtx,scans,motion,band:floorBand});stats.forestFloor=floor.stats;
  }).catch(error=>{scans=null;stats.errors.push(String(error));console.warn('kerbside: plant scans unavailable; keeping cut-out plants',error);}):Promise.resolve();
  const dummy=new THREE.Object3D(),colour=new THREE.Color();
  function instances(geometry,mat,items,range=null){
    if(!items.length)return null;
    const buckets=new Map();for(const v of items){const k=`${Math.floor(v.p[0]/100)}:${Math.floor(v.p[2]/100)}`;
      if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(v);}
    const group=new THREE.Group();
    for(const list of buckets.values()){
      const mesh=new THREE.InstancedMesh(geometry,mat,list.length);
      list.forEach((v,i)=>{dummy.position.set(...v.p);dummy.scale.set(...v.scale);if(v.q)dummy.quaternion.fromArray(v.q);else dummy.rotation.set(0,v.turn||0,v.tilt||0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(v.colour)mesh.setColorAt(i,colour.setRGB(...v.colour,THREE.SRGBColorSpace));});
      mesh.computeBoundingSphere();mesh.userData={surface:"nature_vegetation",natureFullPlant:true,natureRange:range,inferred:true,liftedOntoGround:true,
        confidence:"canopy-constrained visual inference; regional species prior, not surveyed",sourceEpoch:2024,provenance:"nature/ecology.json",canonical:false};group.add(mesh);
    }return group;
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
      if(entry.area){
        if(pointInRing(x,y,w.local)&&!(w.localHoles||[]).some(ring=>pointInRing(x,y,ring)))return true;
        for(const ring of [w.local,...w.localHoles||[]])for(let i=0;i<ring.length;i++)
          if(segmentDistance(x,y,ring[i],ring[(i+1)%ring.length])<radius+.6)return true;
      }
      if(entry.a&&segmentDistance(x,y,entry.a,entry.b)<w.width_m/2+radius+.6)return true;
    }
    return false;
  }
  const PLANT_TILE_M=200,candidateCache=new Map(),upAxis=new THREE.Vector3(0,1,0),slopeNormal=new THREE.Vector3(),slopeQ=new THREE.Quaternion(),yawQ=new THREE.Quaternion();
  //: A flat card laid on the ground's own slope at (x, y), turned by `turn` about the normal.
  function groundQuaternion(x,y,turn){
    const o=surface(x,y),e=surface(x+1,y),n=surface(x,y+1);
    if(!o||o.water||!e||!n)return null;
    const ax=e.p[0]-o.p[0],ay=e.height-o.height,az=e.p[1]-o.p[1],bx=n.p[0]-o.p[0],by=n.height-o.height,bz=n.p[1]-o.p[1];
    slopeNormal.set(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx);if(slopeNormal.y<0)slopeNormal.negate();slopeNormal.normalize();
    slopeQ.setFromUnitVectors(upAxis,slopeNormal).multiply(yawQ.setFromAxisAngle(upAxis,turn));
    return {p:o.p,height:o.height,q:slopeQ.toArray()};
  }
  async function plants(tx,ty){
    const trees=new Map(),shrubs=new Map(),rocks=[],logs=[],obstacles=[],wildGrass=new Map(),floorKit=forestFloor&&scans?forestFloor:null;
    const x0=tx*PLANT_TILE_M,y0=ty*PLANT_TILE_M;
    let yieldAt=performance.now();
    for(let r=Math.floor(y0/8);r<Math.floor((y0+PLANT_TILE_M)/8);r++)for(let c=Math.floor(x0/8);c<Math.floor((x0+PLANT_TILE_M)/8);c++){
      if(c%8===0&&performance.now()-yieldAt>12){await new Promise(resolve=>setTimeout(resolve,0));yieldAt=performance.now();}
      const a=acceptedTree(c,r,(x,y)=>atlas.ecologicalSample(x,y),blocked,candidateCache);
      if(a){const s=surface(a.x,a.y),h=a.height,R=a.radius,turn=hash2(c,r,41)*Math.PI*2;
        const key=`${a.species}:${hash2(c,r,47)>.5?1:0}`;
        if(!trees.has(key))trees.set(key,[]);
        trees.get(key).push({p:[s.p[0],s.height,s.p[1]],scale:[R,h,R],turn,shade:.85+hash2(c,r,43)*.3});
        // What has fallen from it: now and then a log. Leaves and twigs lie on the near forest
        // floor (forest-floor.mjs), each on its own; past it the ground's own shading carries them.
        const fall=litterScatter(a.x,a.y,R,a.species,{forest:atlas.ecologicalSample(a.x,a.y)?.habitat?.forest||0});
        for(const log of fall.logs){
          if(blocked(log.x,log.y,log.length/2))continue;const g=surface(log.x,log.y);if(!g||g.water)continue;
          // Half sunk into the duff, and greener with moss the further gone it is.
          const moss=Math.max(0,log.decay-.45)*1.4;
          // A fallen trunk thick enough not to step over stops the walker (deadwoodBlocked).
          if(log.radius>=LOG_BLOCKS_RADIUS_M)obstacles.push({x:g.p[0],z:g.p[1],dx:Math.cos(log.turn)*log.length/2,dz:-Math.sin(log.turn)*log.length/2,r:log.radius});
          logs.push({p:[g.p[0],g.height+log.radius*.45,g.p[1]],scale:[log.length,log.radius,log.radius],turn:log.turn,
            colour:[.36*(1-moss)+.30*moss,.29*(1-moss)+.36*moss,.22*(1-moss)+.18*moss]});
        }
      }
      // Understorey on a 4 m lattice: four chances in every 8 m slot, so a forest floor is
      // filled rather than dotted. Trails, roads and buildings stay clear (blocked).
      for(let k=0;k<4;k++){
        const sx=(c*2+(k&1)+.2+hash2(c,r,61+k*5)*.6)*4,sy=(r*2+(k>>1)+.2+hash2(c,r,63+k*5)*.6)*4,at=surface(sx,sy);
        if(!at||at.water)continue;
        const shrub=undergrowthAt(sx,sy,{...atlas.ecologicalSample(sx,sy),...at},1.8);
        if(!shrub||blocked(sx,sy,shrub.radius))continue;
        if(!shrubs.has(shrub.kind))shrubs.set(shrub.kind,[]);
        const shade=.80+hash2(c,r,71+k)*.35;
        shrubs.get(shrub.kind).push({p:[at.p[0],at.height+.025,at.p[1]],scale:[shrub.radius,shrub.height,shrub.radius],turn:hash2(c,r,73+k)*6.283,
          colour:(UNDERGROWTH[shrub.kind]?.colour||[.29,.39,.18]).map(v=>v*shade),shade,variant:Math.floor(hash2(c,r,75+k)*997)});
      }
      // Long wild grass between them, on a 4 m lattice: the gaps of a meadow or a wood filled.
      if(floorKit){const e=atlas.ecologicalSample(c*8+4,r*8+4);
        if(e&&e.habitat&&e.habitat.grass+e.habitat.scrub+e.habitat.forest+e.habitat.wetland>.15)for(let k=0;k<4;k++){
          const gx=(c*2+k%2+.15+hash2(c,r,131+k)*.7)*4,gy=(r*2+Math.floor(k/2)+.15+hash2(c,r,141+k)*.7)*4,at=surface(gx,gy);
          if(!at||at.water)continue;const g=floorKit.wildGrassAt(gx,gy,{...e,cover:at.cover,natural:at.natural},1.1);
          if(!g||blocked(gx,gy,.2))continue;const key=`${g.kind}:${g.variant}`,shade=.84+hash2(c,r,151+k)*.3;
          if(!wildGrass.has(key))wildGrass.set(key,[]);
          wildGrass.get(key).push({p:[at.p[0],at.height-.02,at.p[1]],scale:[g.height*1.25,g.height*1.15,g.height*1.25],turn:hash2(c,r,161+k)*6.283,colour:[shade,shade,shade]});
        }}
      const x=(c+.2+hash2(c,r,61)*.6)*8,y=(r+.2+hash2(c,r,63)*.6)*8,s=surface(x,y);
      if(!s||s.water)continue;
      if(hash2(c,r,67)>.23||blocked(x,y,.9))continue;
      // Barren alone does not prove beach rocks: only a steep barren slope or mapped rock.
      const east=atlas.sample(x+10,y),west=atlas.sample(x-10,y);
      if(["bare_rock","scree","shingle"].includes(s.natural)||(s.cover===31&&east&&west&&Math.abs(east.height-west.height)>5))rocks.push({p:[s.p[0],s.height+.25,s.p[1]],scale:[.7,.45,.8],turn:hash2(c,r)*6.28,colour:[.44,.42,.38]});
    }
    const group=new THREE.Group();group.userData.bayWide=true;
    const midP=[],midS=[],midK=[],midA=[];
    for(const [key,items] of trees){const [species,variant]=key.split(':');for(const part of assets.tree(species,Number(variant))){
      const bark=Boolean(part.material.userData.barkStyle||!part.material.map);
      fadePlant(part.material);motion?.apply(part.material,bark?'bark':'leaves');
      const mesh=instances(part.geometry,part.material,items.map(v=>({...v,colour:part.colour.map(c=>c*v.shade)})));
      // Its bark is a tree's trunk and limbs, solid to the walker as a street tree's is
      // (docs/object-catalogue.json); its leaves are its crown. Both stay marked inferred.
      mesh.traverse(o=>{if(o.isMesh)o.userData.surface=bark?'nature_tree':'nature_foliage';});
      mesh.userData.species=species;group.add(mesh);
    }
      for(const v of items){midP.push(v.p[0],v.p[1]+v.scale[1]*.5,v.p[2]);midS.push(v.scale[1]);midK.push(speciesKeys.indexOf(species)*2+Number(variant));midA.push(v.scale[0]*2/v.scale[1]/(144/256));}
    }
    if(midP.length){const middle=treePoints(midP,midS,midK,midA,middleMaterial);middle.userData={surface:'nature_tree_middle',bayWide:true,inferred:true,liftedOntoGround:true};group.add(middle);}
    for(const [kind,items] of shrubs){
      const scan=floorKit&&floorKit.SCAN_FOR[kind],grass=floorKit&&floorKit.GRASS_FOR[kind];
      if(grass){for(const v of items){const key=`${grass}:${v.variant%3}`;if(!wildGrass.has(key))wildGrass.set(key,[]);
        wildGrass.get(key).push({...v,scale:[v.scale[1]*1.2,v.scale[1]*1.2,v.scale[1]*1.2],colour:[v.shade,v.shade,v.shade]});}continue;}
      if(scan&&scans.far[scan]){
        // The scan's lighter version from the floor's edge to the middle distance, then the
        // cut-out cards to the plant horizon: each faded into the next by a dithered band.
        const variants=scans.far[scan],tint=floorKit.SCAN_TINT[kind];
        variants.forEach((part,i)=>{const list=items.filter(v=>v.variant%variants.length===i);if(!list.length)return;
          const mesh=instances(part.geometry,midScanMaterial(part.material),list.map(v=>{const w=v.scale[1]*Math.max(.8,Math.min(1.25,v.scale[0]/(part.ratio*v.scale[1]||1)));
            return {...v,scale:[w,v.scale[1],w],colour:tint.map(t=>t*v.shade)};}),MID_SCAN_RANGE[1]+5);
          if(mesh)group.add(mesh);});
        const part=assets.undergrowth(kind);group.add(instances(part.geometry,midCardMaterial(part.material),items));continue;
      }
      const part=assets.undergrowth(kind);fadePlant(part.material);motion?.apply(part.material,'shrub');group.add(instances(part.geometry,part.material,items));}
    for(const [key,items] of wildGrass){const [kind,variant]=key.split(':');const mesh=instances(midGrassGeometry(kind,Number(variant)),midGrassMaterial,items,MID_SCAN_RANGE[1]+5);
      if(mesh){mesh.userData.surface='nature_wild_grass';group.add(mesh);}}
    for(const [kind,items] of [['log',logs]]){if(!items.length)continue;const part=assets.deadwood(kind);fadePlant(part.material);
      if(floorKit)floorKit.rangeFade(part.material,{fadeIn:floorBand,key:'mid-log-v1'});
      const mesh=instances(part.geometry,part.material,items);mesh.traverse(o=>{if(o.isMesh){o.castShadow=kind==='log';o.receiveShadow=true;o.userData.surface=`nature_${kind}`;}});group.add(mesh);}
    const rockMesh=instances(sphere,leafMat,rocks);if(rockMesh){rockMesh.traverse(o=>{if(o.isMesh)o.userData.surface='nature_rock';});group.add(rockMesh);}
    const trailP=[],trailC=[],trailI=[];
    const trailColours={asphalt:[.29,.30,.29],concrete:[.57,.56,.51],stone:[.52,.50,.45],paving_stones:[.54,.49,.42],gravel:[.54,.49,.39],sand:[.68,.60,.44],ground:[.47,.37,.24],dirt:[.47,.37,.24],unknown:[.47,.37,.24]};
    for(const w of nearbyWays(x0+PLANT_TILE_M/2,y0+PLANT_TILE_M/2)||[]){
      const road=NATURE_ROADS.has(w.kind);
      if(!(w.trail||road)||w.grade_separated||w.area)continue;
      // A road of no stated surface is paved; a trail of none is earth. A road lies just under
      // the trails, so a path crossing it shows.
      const finish=w.kind==='steps'&&w.surface==='unknown'?'stone':road&&!UNPAVED.has(w.surface)&&!trailColours[w.surface]||road&&w.surface==='unknown'?'asphalt':w.surface;
      const col=linearColour(trailColours[finish]||trailColours.unknown),half=w.width_m/2,lift=road?.028:.035;
      for(let i=1;i<w.local.length;i++){
        const a=w.local[i-1],b=w.local[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<.01)continue;
        // Intersect each segment with this tile before subdivision: no repeated full paths.
        let low=0,high=1;
        for(const [v,d,min,max] of [[a[0],b[0]-a[0],x0,x0+PLANT_TILE_M],[a[1],b[1]-a[1],y0,y0+PLANT_TILE_M]]){
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
            trailP.push(s.p[0],(w.kind==='steps'?mid.height:s.height)+lift,s.p[1]);trailC.push(...col);
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
    group.userData.counts={trees:[...trees.values()].reduce((n,a)=>n+a.length,0),shrubs:[...shrubs.values()].reduce((n,a)=>n+a.length,0),rocks:rocks.length,trails:trailI.length/6,
      wildGrass:[...wildGrass.values()].reduce((n,a)=>n+a.length,0),deadwood:logs.length};group.userData.obstacles=obstacles;features.add(group);return group;
  }
  function drop(group){group.removeFromParent();group.traverse(o=>{if((o.isMesh&&!o.isInstancedMesh)||o.isPoints)o.geometry.dispose();if(o.isInstancedMesh)o.dispose();if(o.material?.userData.ownedNature){o.material.userData.coastTexture?.dispose();o.material.dispose();}});}
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
    for(const w of data.ways){w.local=w.points.map(p=>atlas.local(...p));w.width_m=inferredWidth(w);
      w.localHoles=(w.holes||[]).map(ring=>ring.map(p=>atlas.local(...p)));delete w.holes;
      if(w.area){const xs=w.local.map(p=>p[0]),ys=w.local.map(p=>p[1]);insert({w,area:true},Math.min(...xs)-7,Math.min(...ys)-7,Math.max(...xs)+7,Math.max(...ys)+7);}
      else for(let i=1;i<w.local.length;i++){const a=w.local[i-1],b=w.local[i],R=w.natural==="coastline"?100:w.width_m/2+7;insert({w,a,b},Math.min(a[0],b[0])-R,Math.min(a[1],b[1])-R,Math.max(a[0],b[0])+R,Math.max(a[1],b[1])+R);}
      delete w.points;delete w.source_tags;
    }data.decodedBytes=file.decoded_bytes;pathTiles.set(key,data);floorStale=true;
  }
  async function update(x,z){
    const [lon,lat]=fromPage(x,z),[ax,ay]=atlas.local(lon,lat);
    requested=[ax,ay];
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
      await scansReady;
      if(changed.length)floorStale=true;
      const plantDesired=new Set();
      // Load the neighbouring clearance cells before sampling across a cell boundary.
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)await loadPaths(ax+dx*1100,ay+dy*1100);
      candidateCache.clear();
      // New clearance or heights under the floor: draw it again on them, before the far plants.
      if(floor&&(floorStale||!floorLive)){floorTrees.clear();floor.invalidate();floorStale=false;}floorLive=Boolean(floor);
      // Nearest tiles first, so the ground underfoot is planted before the horizon; and a jump
      // elsewhere (a teleport) abandons this place's remaining tiles rather than finishing them.
      const tiles=[];
      for(let ty=Math.floor((ay-900)/PLANT_TILE_M);ty<=Math.floor((ay+900)/PLANT_TILE_M);ty++)for(let tx=Math.floor((ax-900)/PLANT_TILE_M);tx<=Math.floor((ax+900)/PLANT_TILE_M);tx++){
        const d=Math.hypot(tx*PLANT_TILE_M+PLANT_TILE_M/2-ax,ty*PLANT_TILE_M+PLANT_TILE_M/2-ay);if(d<=1100)tiles.push([d,tx,ty]);}
      tiles.sort((a,b)=>a[0]-b[0]);let abandoned=false;
      for(const [,tx,ty] of tiles){
        if(Math.hypot(requested[0]-ax,requested[1]-ay)>600){abandoned=true;break;}
        const key=`${tx}:${ty}`;plantDesired.add(key);if(!plantGroups.has(key)||force){
          const began=performance.now(),old=plantGroups.get(key),next=await plants(tx,ty);if(old)drop(old);plantGroups.set(key,next);
          stats.plantTileMs=Math.round(performance.now()-began);
        }
        await new Promise(r=>setTimeout(r,0));
      }
      if(abandoned){lastX=Infinity;return;}
      for(const [key,group] of plantGroups)if(!plantDesired.has(key)){drop(group);plantGroups.delete(key);}
      stats.trees=stats.shrubs=stats.rocks=stats.trails=stats.wildGrass=stats.deadwood=0;for(const group of plantGroups.values())for(const k of ["trees","shrubs","rocks","trails","wildGrass","deadwood"])stats[k]+=group.userData.counts[k]||0;
      stats.detailTiles=detailMeshes.size;stats.plantTiles=plantGroups.size;
      // Retain only the actual 3x3 query set, not every path tile visited during a flight.
      const pathDesired=new Set();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)
        pathDesired.add(`${Math.floor((ax+dx*2100)/4000)}-${Math.floor((ay+dy*2100)/4000)}`);
      for(const key of pathTiles.keys())if(!pathDesired.has(key))pathTiles.delete(key);
      stats.decodedPathBytes=[...pathTiles.values()].reduce((n,p)=>n+(p.decodedBytes||0),0);
      stats.decodedHeightBytes=[...atlas.detail.values()].reduce((n,p)=>n+p.data.byteLength,0);
      builtVersion=version;if(forceVersion!==version)lastX=Infinity;
      grassFocus={x,z};grassStrands.invalidate();
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
    //: Whether a walker of radius `r` standing at page point (x, z) would be inside fallen
    //: deadwood: a trunk too thick to step over (the plant tiles' logs), or a stump or a big
    //: rock on the near forest floor. Undergrowth, grass and litter are walked through.
    deadwoodBlocked(x,z,r=.25){
      const [ax,ay]=atlas.local(...fromPage(x,z)),tx=Math.floor(ax/PLANT_TILE_M),ty=Math.floor(ay/PLANT_TILE_M);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        for(const o of plantGroups.get(`${tx+dx}:${ty+dy}`)?.userData.obstacles||[])if(logHit(o,x,z,r))return true;}
      return Boolean(floor?.blockedAt?.(x,z,r));},
    //: Whether the plants within `radius` metres of page point (x, z) are standing.
    plantsReadyAt(x,z,radius=220){const [ax,ay]=atlas.local(...fromPage(x,z));
      for(let ty=Math.floor((ay-radius)/PLANT_TILE_M);ty<=Math.floor((ay+radius)/PLANT_TILE_M);ty++)for(let tx=Math.floor((ax-radius)/PLANT_TILE_M);tx<=Math.floor((ax+radius)/PLANT_TILE_M);tx++)
        if(Math.hypot(tx*PLANT_TILE_M+PLANT_TILE_M/2-ax,ty*PLANT_TILE_M+PLANT_TILE_M/2-ay)<=radius+PLANT_TILE_M*.71&&!plantGroups.has(`${tx}:${ty}`))return false;
      return true;},
    tick(now,camera,focus=null){
      const at=focus||grassFocus;
      if(camera&&at){const eye=camera.position.y-(groundInfoAt(at.x,at.z)?.y||0);grassStrands.update(at.x,at.z,eye);
        if(floor&&floorLive){const [ax,ay]=atlas.local(...fromPage(at.x,at.z));floor.update(ax,ay,eye);}}
      if(camera)features.traverse(o=>{if(o.userData.natureFullPlant&&o.geometry.boundingSphere){
        const sphere=o.boundingSphere||o.geometry.boundingSphere;
        o.visible=camera.position.distanceTo(sphere.center)<(o.userData.natureRange||NEAR1)+sphere.radius;
      }});
      let active=false;for(const tile of atlas.detail.values())if(tile.blend.value<1){
      tile.blend.value=Math.min(1,Math.max(0,(now-tile.morphStart)/600));active=active||tile.blend.value<1;
    }return active;},
    groundAt(x,z){return groundInfoAt(x,z)?.y??null;},ready:Promise.all([pathsReady,farReady]),scansReady};
}
