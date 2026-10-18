// The Earth past the Bay's atlas, for the view zoomed all the way out: a sphere of the Earth's
// radius whose land and water are Natural Earth's (docs/world/land-mask.png, public domain),
// drawn as grass and water and nothing more. It is flattened into a disc just under the atlas,
// so the source-backed Bay keeps its single height datum and never sinks into the curve, and
// rounds away to the globe past it. Render-only: nothing walks on, measures or collides with it.
export const EARTH_RADIUS_M=6371000;

//: Latitude and longitude (degrees) of a direction from the Earth's centre, given in the page's
//: frame at (lon0, lat0): x east, y up, z south.
export function directionToGeographic([x,y,z],lon0,lat0){
  const l=lon0*Math.PI/180,p=lat0*Math.PI/180,north=-z;
  const ex=-Math.sin(l),ey=Math.cos(l),nx=-Math.sin(p)*Math.cos(l),ny=-Math.sin(p)*Math.sin(l),nz=Math.cos(p);
  const ux=Math.cos(p)*Math.cos(l),uy=Math.cos(p)*Math.sin(l),uz=Math.sin(p);
  const X=x*ex+north*nx+y*ux,Y=x*ey+north*ny+y*uy,Z=north*nz+y*uz;
  return [Math.atan2(Y,X)*180/Math.PI,Math.asin(Math.max(-1,Math.min(1,Z)))*180/Math.PI];
}
//: How far the camera may see at `altitude` metres: to the horizon of the globe and past it.
export function horizonDistance(altitude){
  const h=Math.max(0,altitude);return Math.sqrt(2*EARTH_RADIUS_M*h+h*h);
}

//: A sphere whose pole is the page's origin, rings packed close there so the flat disc under
//: the atlas is finely cut, and opening out towards the far side of the world.
function globeGeometry(THREE,{cap,base,rings=220,segments=192}){
  const R=EARTH_RADIUS_M,P=[],D=[],I=[];
  for(let i=0;i<=rings;i++){
    const theta=Math.PI*(i/rings)**2.15,s=R*theta,t=Math.min(1,Math.max(0,(s-cap)/(cap*.8))),blend=t*t*(3-2*t);
    for(let j=0;j<=segments;j++){
      const phi=j/segments*Math.PI*2,dx=Math.sin(theta)*Math.cos(phi),dy=Math.cos(theta),dz=Math.sin(theta)*Math.sin(phi);
      // On the disc a point keeps its distance along the ground from the origin, so the map on
      // it lies where it lies on the sphere.
      const fx=Math.cos(phi)*s,fz=Math.sin(phi)*s,sx=dx*R,sy=base-R+dy*R,sz=dz*R;
      P.push(fx+(sx-fx)*blend,base+(sy-base)*blend,fz+(sz-fz)*blend);D.push(dx,dy,dz);
    }
  }
  for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
    const a=i*(segments+1)+j,b=a+segments+1;I.push(a,a+1,b,a+1,b+1,b);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('globeDir',new THREE.Float32BufferAttribute(D,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(D,3));g.setIndex(I);
  g.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,base-R,0),R*1.01);return g;
}

export function createGlobe(THREE,{parent,lon0,lat0,maskUrl,cap,base=-30,land=[.37,.45,.24],water=[44/255,97/255,135/255]}){
  const linear=c=>c.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const mask=new THREE.TextureLoader().load(maskUrl);mask.colorSpace=THREE.NoColorSpace;
  mask.wrapS=THREE.RepeatWrapping;mask.minFilter=THREE.LinearMipmapLinearFilter;mask.magFilter=THREE.LinearFilter;mask.anisotropy=8;
  const l=lon0*Math.PI/180,p=lat0*Math.PI/180;
  // The page's east, north and up as Earth-centred unit vectors.
  const frame=new THREE.Matrix3().set(-Math.sin(l),-Math.sin(p)*Math.cos(l),Math.cos(p)*Math.cos(l),
    Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)*Math.sin(l),0,Math.cos(p),Math.sin(p));
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.95,metalness:0,envMapIntensity:.35});
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{uGlobeMask:{value:mask},uGlobeFrame:{value:frame}});
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 globeDir;varying vec3 vGlobeDir;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvGlobeDir=globeDir;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform sampler2D uGlobeMask;uniform mat3 uGlobeFrame;varying vec3 vGlobeDir;
float globeHash(vec2 q){vec3 a=fract(vec3(q.xyx)*.1031);a+=dot(a,a.yzx+33.33);return fract((a.x+a.y)*a.z);}
float globeNoise(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(globeHash(i),globeHash(i+vec2(1,0)),f.x),mix(globeHash(i+vec2(0,1)),globeHash(i+vec2(1,1)),f.x),f.y);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
vec3 d=normalize(vGlobeDir);vec3 e=uGlobeFrame*vec3(d.x,-d.z,d.y);
float lat=asin(clamp(e.z,-1.,1.)),lon=atan(e.y,e.x);
vec2 globeUV=vec2(lon/6.2831853+.5,lat/3.1415927+.5);
float landHere=smoothstep(.35,.65,texture2D(uGlobeMask,globeUV).r);
float tone=globeNoise(globeUV*vec2(900.,450.))*.6+globeNoise(globeUV*vec2(5200.,2600.))*.4;
vec3 grass=vec3(${linear(land).join(',')})*(.82+.3*tone);
// The atlas's own water colour and finish, so the Bay's sea runs on into the ocean.
vec3 sea=vec3(${linear(water).join(',')});
diffuseColor.rgb=mix(sea,grass,landHere);`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(.62,.95,landHere);')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=.04*(1.-landHere);');
  };
  material.customProgramCacheKey=()=> 'kerbside-globe-v1';
  const mesh=new THREE.Mesh(globeGeometry(THREE,{cap,base}),material);
  mesh.name='globe';mesh.renderOrder=-5;mesh.receiveShadow=false;mesh.castShadow=false;
  mesh.userData={surface:'globe',inferred:true,canonical:false,provenance:'Natural Earth 1:50m land and lakes',
    confidence:'world land and water only; grass and water stand for every other cover'};
  // The air seen edge-on from space: a pale blue rim round the globe, gone once inside it.
  const air=new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_M*1.018,96,48),new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.BackSide,blending:THREE.AdditiveBlending,uniforms:{strength:{value:0}},
    vertexShader:'varying vec3 vN;varying vec3 vV;void main(){vec4 w=modelMatrix*vec4(position,1.);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader:'uniform float strength;varying vec3 vN;varying vec3 vV;void main(){float r=pow(clamp(1.+dot(vN,vV)*1.0,0.,1.),3.);gl_FragColor=vec4(vec3(.36,.6,1.)*r*strength,1.);}'}));
  air.position.set(0,base-EARTH_RADIUS_M,0);air.frustumCulled=false;air.visible=false;
  parent.add(mesh,air);
  return {mesh,air,
    //: Each frame: the atmosphere's rim only from outside it.
    update(camera){const h=camera.position.y-base;air.visible=h>140000;
      // Far up, depth is coarse: the globe steps a little further under the atlas than its 30 m.
      mesh.position.y=-Math.min(3000,Math.max(0,h)*1.5e-4);air.position.y=base-EARTH_RADIUS_M+mesh.position.y;
      air.material.uniforms.strength.value=Math.min(1,Math.max(0,(h-140000)/400000))*.9;},
    dispose(){parent.remove(mesh,air);mesh.geometry.dispose();material.dispose();mask.dispose();air.geometry.dispose();air.material.dispose();}};
}
