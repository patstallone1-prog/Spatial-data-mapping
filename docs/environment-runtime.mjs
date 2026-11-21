import {WEATHER,solarState,previewTime} from './sky-clock.mjs';
import {Sky} from './vendor/three-sky-r160.mjs';
import {makeClock,CLOCK_SPEC} from './city/clock.mjs';
import {createClouds} from './sky-clouds.mjs';

// The sky, the sun and the weather, on the game's clock (city/clock.mjs: a day in 72 real
// minutes, 48 of daylight and 24 of night). The night is meant to be played (2026-11-14): cool
// blue rather than black, everything still readable.
//  - The moon stands in for the sun as the directional light, at about a fifth of the day's
//    intensity, slate-blue. It rises in the east as the sun sets in the west and climbs, and grows
//    brighter, as the night deepens.
//  - The sky's own light (the hemisphere fill) stays up at night, tinted deep blue, so what is in
//    shadow reads dark blue and never #000.
//  - A night dome over the sky shader's black: indigo at the zenith, lighter at the horizon (the
//    city's glow).
//  - The stars: the bright ones of a real catalogue (sky-stars.json) where they stand over San
//    Francisco at the game's hour, so the constellations are the real ones.
//  - Warm windows and a rim of light round people: the page's NIGHT uniforms (module 02), set
//    here.
export const NIGHT_LOOK=Object.freeze({
  moon_share:.22,                // moonlight as a share of the day's directional light
  moon_colour:0x9fb0e0,          // desaturated slate-blue
  // The hemisphere at full night: about half the day's fill in light (the colours are sRGB, so a
  // pale blue: a deep one is near black in linear light), by day ~0.9-1.2 of near-white.
  ambient_night:1.35,
  ambient_sky_night:0x93a8dc, ambient_ground_night:0x3a4670,
  ambient_sky_day:0xe4ecf4, ambient_ground_day:0x071013,
  dome_horizon:0x2a3a66, dome_zenith:0x070c1f,
  fog_night:[.63,.32,.1],        // HSL
  rim:.38,
});
//: The share of a city's windows lit at game hour ``h`` after dark: most through the evening,
//: fewer towards midnight, a few in the small hours, some again before dawn.
export function litShare(h){
  if(h>=17&&h<22)return .55; if(h>=22)return .55-(h-22)*.1; if(h<1)return .35;
  if(h<5)return .12; return .12+(h-5)*.12;
}
//: B-V colour index to an RGB tint (hot blue-white to cool orange).
function bvColour(bv){
  const t=Math.max(-.4,Math.min(2,bv));
  const r=t<.4?.62+t*.95:1, g=t<0?.75+t*.3:t<.8?.82-.1*t:.74-(t-.8)*.3, b=t<0?1:t<.4?1-.25*t:Math.max(.35,.9-(t-.4)*.55);
  return [Math.min(1,r),Math.max(.4,Math.min(1,g)),Math.max(.3,Math.min(1,b))];
}

export function createEnvironment({THREE,scene,renderer,camera,sun,ambient,lat,lon,night=null,asset=(p)=>`./${p}`}) {
  const sky=new Sky();sky.scale.setScalar(90000);sky.frustumCulled=false;sky.renderOrder=-10;
  scene.add(sky);scene.background=null;
  const skyScene=new THREE.Scene(),captureSky=new Sky();captureSky.scale.setScalar(90000);skyScene.add(captureSky);
  const pmrem=new THREE.PMREMGenerator(renderer);
  const priorEnvironment=scene.environment;
  const spaceColour=new THREE.Color(0x02050b);let inSpace=false;
  const gameClock=makeClock(CLOCK_SPEC);
  //: Which clock the sky reads: the game's (City mode: a 72-minute day) or the wall's (Explore).
  let clockMode='live';
  const clockNow=()=>clockMode==='game' ? new Date(gameClock.game(Date.now())) : new Date();
  let environment=null,preset='sunny',override=null,observed=null,lastClock=-Infinity,lastCapture=-Infinity,capturedDay=-1,latest=null;
  // The clouds (sky-clouds.mjs): a few patterns through the game's day, at the far plane.
  const deck=createClouds(THREE),clouds=deck.mesh;scene.add(clouds);
  const rainPositions=new Float32Array(600*6);
  for(let i=0;i<600;i++){const x=((i*73)%601)/601*50-25,z=((i*137)%607)/607*50-25,y=((i*31)%593)/593*32;
    rainPositions.set([x,y,z,x-.12,y-1.1,z],i*6);}
  const rainGeometry=new THREE.BufferGeometry();rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
  const rain=new THREE.LineSegments(rainGeometry,new THREE.LineBasicMaterial({color:0xb7c9da,transparent:true,opacity:.35,depthWrite:false}));
  rain.frustumCulled=false;scene.add(rain);

  // ---- the night sky -------------------------------------------------------------------------
  // Drawn at the far plane (xyww), after everything solid: whatever stands in front hides it.
  const farVertex='varying vec3 vDir; void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}';
  const domeMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,transparent:true,depthWrite:false,fog:false,
    uniforms:{night:{value:0},horizon:{value:new THREE.Color(NIGHT_LOOK.dome_horizon)},zenith:{value:new THREE.Color(NIGHT_LOOK.dome_zenith)}},
    vertexShader:farVertex,
    fragmentShader:`uniform float night;uniform vec3 horizon,zenith;varying vec3 vDir;
      void main(){float h=normalize(vDir).y;gl_FragColor=vec4(mix(horizon,zenith,smoothstep(-.05,.6,h)),night);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
  const dome=new THREE.Mesh(new THREE.SphereGeometry(1000,32,16),domeMaterial);dome.frustumCulled=false;dome.renderOrder=-9;scene.add(dome);
  // (The same dome in the scene the reflections are taken from: by night the world's sheen is blue.)
  const captureDome=new THREE.Mesh(dome.geometry,domeMaterial);skyScene.add(captureDome);
  const starMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,
    uniforms:{show:{value:0},time:{value:0},px:{value:Math.min(2,renderer.getPixelRatio?.()||1)}},
    vertexShader:`attribute float size;attribute vec3 tint;attribute float phase;uniform float show,time,px;varying vec3 vTint;varying float vAlpha;
      void main(){vec3 up=normalize(mat3(modelMatrix)*position);
        float twinkle=.82+.18*sin(time*(1.3+phase)+phase*40.);
        vAlpha=show*twinkle*smoothstep(-.02,.12,up.y)*mix(.45,1.,smoothstep(.05,.5,up.y));vTint=tint;
        vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;gl_PointSize=size*px;}`,
    fragmentShader:`varying vec3 vTint;varying float vAlpha;
      void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,.08,d);gl_FragColor=vec4(vTint,a*vAlpha);
      #include <colorspace_fragment>
      }`});
  const stars=new THREE.Points(new THREE.BufferGeometry(),starMaterial);
  stars.frustumCulled=false;stars.renderOrder=-8;stars.matrixAutoUpdate=false;stars.visible=false;scene.add(stars);
  fetch(asset('sky-stars.json')).then((r)=>r.ok?r.json():null).then((json)=>{
    if(!json?.stars)return;
    const S=json.stars,n=S.length/4,pos=new Float32Array(n*3),size=new Float32Array(n),tint=new Float32Array(n*3),phase=new Float32Array(n);
    for(let i=0;i<n;i++){
      const ra=S[i*4]*Math.PI/180,dec=S[i*4+1]*Math.PI/180,mag=S[i*4+2],c=bvColour(S[i*4+3]);
      pos.set([Math.cos(dec)*Math.cos(ra)*1000,Math.cos(dec)*Math.sin(ra)*1000,Math.sin(dec)*1000],i*3);
      // Brighter is bigger and whiter-hot; the faintest a point a pixel across.
      size[i]=Math.max(1.1,Math.min(5.2,4.6-.62*mag));
      const k=Math.max(.22,Math.min(1,1.25-.16*mag));tint.set([c[0]*k,c[1]*k,c[2]*k],i*3);
      phase[i]=(i*.61803)%1;
    }
    const g=stars.geometry;g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('size',new THREE.BufferAttribute(size,1));
    g.setAttribute('tint',new THREE.BufferAttribute(tint,3));g.setAttribute('phase',new THREE.BufferAttribute(phase,1));
    stars.visible=true;
  }).catch(()=>{});
  //: The stars where they stand at ``date`` over (lat, lon): the celestial sphere turned by the
  //: local sidereal time and tilted by the latitude (east +x, up +y, south +z).
  const starMatrix=new THREE.Matrix4();
  function placeStars(date){
    const jd=+date/86400000+2440587.5;
    const lst=((280.46061837+360.98564736629*(jd-2451545)+lon)%360)*Math.PI/180;
    const sL=Math.sin(lst),cL=Math.cos(lst),phi=lat*Math.PI/180,sP=Math.sin(phi),cP=Math.cos(phi);
    starMatrix.set(-sL,cL,0,0, cP*cL,cP*sL,sP,0, sP*cL,sP*sL,-cP,0, 0,0,0,1);
    return starMatrix;
  }
  // The moon: a disc and its halo, opposite the sun, standing higher and brighter as the night goes on.
  const moonCanvas=document.createElement('canvas');moonCanvas.width=moonCanvas.height=128;
  {const m=moonCanvas.getContext('2d'),gr=m.createRadialGradient(54,52,6,64,64,60);
    gr.addColorStop(0,'#fbfaf4');gr.addColorStop(.85,'#dcdccf');gr.addColorStop(1,'#bfc0b4');
    m.fillStyle=gr;m.beginPath();m.arc(64,64,60,0,Math.PI*2);m.fill();
    m.fillStyle='rgba(120,124,128,.32)';
    for(const [x,y,r] of [[48,46,15],[76,40,10],[70,70,18],[44,78,9],[88,84,7],[58,96,6]]){m.beginPath();m.arc(x,y,r,0,Math.PI*2);m.fill();}}
  const haloCanvas=document.createElement('canvas');haloCanvas.width=haloCanvas.height=64;
  {const m=haloCanvas.getContext('2d'),gr=m.createRadialGradient(32,32,4,32,32,32);
    gr.addColorStop(0,'rgba(200,215,255,.55)');gr.addColorStop(1,'rgba(200,215,255,0)');m.fillStyle=gr;m.fillRect(0,0,64,64);}
  const moonTexture=new THREE.CanvasTexture(moonCanvas);moonTexture.colorSpace=THREE.SRGBColorSpace;
  const haloTexture=new THREE.CanvasTexture(haloCanvas);haloTexture.colorSpace=THREE.SRGBColorSpace;
  const moon=new THREE.Sprite(new THREE.SpriteMaterial({map:moonTexture,transparent:true,depthWrite:false,fog:false}));
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTexture,transparent:true,depthWrite:false,fog:false,blending:THREE.AdditiveBlending}));
  moon.renderOrder=-7;halo.renderOrder=-7;moon.frustumCulled=halo.frustumCulled=false;scene.add(halo,moon);
  const MOON_AT=20000,moonSize=2*MOON_AT*Math.tan(1.1*Math.PI/180);
  moon.scale.setScalar(moonSize);halo.scale.setScalar(moonSize*4);
  const moonDir=new THREE.Vector3(),sunDir=new THREE.Vector3(),lightDir=new THREE.Vector3();
  const moonColour=new THREE.Color(NIGHT_LOOK.moon_colour),dayColour=new THREE.Color();
  const C=(hex)=>new THREE.Color(hex);
  const ambSkyDay=C(NIGHT_LOOK.ambient_sky_day),ambGroundDay=C(NIGHT_LOOK.ambient_ground_day),ambSkyNight=C(NIGHT_LOOK.ambient_sky_night),ambGroundNight=C(NIGHT_LOOK.ambient_ground_night);
  const fogNight=new THREE.Color().setHSL(...NIGHT_LOOK.fog_night),fogDay=new THREE.Color();
  const smooth=THREE.MathUtils.smoothstep,lerp=THREE.MathUtils.lerp;
  let moonShow=0;

  function update(now,{indoors=false}={}) {
    sky.position.copy(camera.position);clouds.position.copy(camera.position);dome.position.copy(camera.position);
    // Above the air the sky is space: the dome and the cloud deck go, and the globe stands in black.
    const altitude=camera.position.y,space=altitude>100000;sky.visible=!space;clouds.visible=altitude<25000;dome.visible=!space;
    if(space!==inSpace){inSpace=space;scene.background=space?spaceColour:null;}
    starMaterial.uniforms.time.value=now/1000;
    rain.position.copy(camera.position);rain.position.y-=((now/1000*12)%32);
    // The stars and the moon go with the eye, as the sky does.
    if(stars.visible){stars.matrix.copy(starMatrix).setPosition(camera.position);stars.matrixWorldNeedsUpdate=true;}
    // Inside the camera's far plane, at the same size in the sky: City mode draws to 1.6 km, and a
    // moon 20 km out was beyond it and never drawn (2026-11-14).
    const moonAt=Math.min(MOON_AT,camera.far*.85),moonScale=moonSize*moonAt/MOON_AT;
    moon.scale.setScalar(moonScale);halo.scale.setScalar(moonScale*4);
    moon.position.copy(camera.position).addScaledVector(moonDir,moonAt);halo.position.copy(moon.position);
    // An observed hour's weather (sky-history.mjs) stands in for the chosen preset while it is set.
    const weather=observed?{...WEATHER[observed.preset],wind:observed.wind,windFrom:observed.windFrom}:WEATHER[preset];
    rain.visible=Boolean(weather.rain && !indoors);
    // The wind the plants sway in (foliage-motion.mjs), and the rain slanting with it.
    globalThis.kerbsideWind={speed:weather.wind,from:weather.windFrom};
    // (What the city's people and drivers go by: city/view.mjs.)
    globalThis.kerbsideWeather={rain:Boolean(weather.rain),cloud:weather.cloud};
    deck.update(now,{weather});
    if(now-lastClock<250)return;lastClock=now;
    // City mode: the game's time, not the wall clock's. Explore: live (setClock). The headset
    // sets its own noon.
    const date=override || clockNow(), s=solarState(date,lat,lon);
    const day=smooth(s.altitude,-.12,.15),dark=1-day;
    // How far into the night: 0 as the sun sets, 1 with it a third of the way down.
    const depth=smooth(-s.altitude,.03,.55);
    for(const domeSky of [sky,captureSky]){
      const u=domeSky.material.uniforms;u.sunPosition.value.fromArray(s.direction).multiplyScalar(450000);
      u.turbidity.value=weather.turbidity;u.rayleigh.value=2;u.mieCoefficient.value=.005;
    }
    // The moon: across the sky from the sun, rising as it sinks.
    sunDir.fromArray(s.direction);
    const hx=-sunDir.x,hz=-sunDir.z,hl=Math.hypot(hx,hz)||1,ma=Math.min(1.15,.07+Math.max(0,-s.altitude)*.95);
    moonDir.set(hx/hl*Math.cos(ma),Math.sin(ma),hz/hl*Math.cos(ma));
    moonShow=depth*(1-weather.cloud*.75);
    moon.material.opacity=moonShow;halo.material.opacity=moonShow*.6;moon.visible=halo.visible=moonShow>.01&&!space;
    // The light: the sun's by day; by night the moon's, a fifth as strong and slate-blue.
    const sunI=2*day*weather.sun,moonI=2*NIGHT_LOOK.moon_share*depth*(1-.5*weather.cloud);
    const toSun=smooth(day,.04,.3);
    lightDir.copy(moonDir).lerp(sunDir,toSun).normalize();
    sun.position.copy(lightDir).multiplyScalar(900);sun.intensity=sunI+moonI*(1-toSun);
    dayColour.setHSL(.1,.16+dark*.3,.94);sun.color.copy(moonColour).lerp(dayColour,toSun);
    // The fill: never black; deep blue by night.
    ambient.intensity=lerp(NIGHT_LOOK.ambient_night,.22+.68+weather.cloud*.35,day); // Low navigation fill, not photometric evidence.
    if(ambient.groundColor){ambient.color.copy(ambSkyNight).lerp(ambSkyDay,day);ambient.groundColor.copy(ambGroundNight).lerp(ambGroundDay,day);}
    const clouded=deck.update(now,{look:true,date,weather,sunDir,altitude:s.altitude,day});
    domeMaterial.uniforms.night.value=smooth(-s.altitude,-.02,.22)*.97;
    starMaterial.uniforms.show.value=smooth(-s.altitude,.1,.3)*(1-weather.cloud*.92);
    if(stars.visible)placeStars(date);
    if(scene.fog){fogDay.setHSL(.58,.12,.035+.69-weather.cloud*.12);scene.fog.color.copy(fogNight).lerp(fogDay,day);}
    // The page's night: windows lit by the hour, a rim round people.
    const hour=+new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}).format(date);
    if(night){night.night.value=smooth(-s.altitude,-.03,.12);night.lit.value=litShare(hour);night.rim.value=NIGHT_LOOK.rim*dark;}
    latest={...s,preset:observed?.preset||preset,weatherBasis:observed?'nws_station_observation':'user_selected_visual_preset_not_live_observation',
      observed:observed&&{station:observed.station,at:observed.observed,standsIn:observed.standsIn,text:observed.text},date:date.toISOString(),live:!override,
      game:!override,day,clouds:clouded&&{pattern:clouded.name,blend:clouded.blend},moon:moonShow,stars:starMaterial.uniforms.show.value,night:night&&{dark:night.night.value,lit:night.lit.value,rim:night.rim.value}};
    // The reflections taken again as the light changes (the day is short now), never per frame.
    if(now-lastCapture>=300000 || (Math.abs(day-capturedDay)>.06 && now-lastCapture>=4000)){lastCapture=now;capturedDay=day;
      const next=pmrem.fromScene(skyScene,0,.1,100000);scene.environment=next.texture;environment?.dispose();environment=next;}
  }
  return {update,snapshot:()=>latest,clock:gameClock,setWeather(value){if(!(value in WEATHER))throw Error('Unknown weather');preset=value;lastClock=lastCapture=-Infinity;},
    setPhase(name){override=previewTime(name,clockNow(),lat,lon);lastClock=lastCapture=-Infinity;},
    //: Observed conditions ({preset, wind, windFrom, ...}) for the hour shown, or null for the preset.
    setConditions(value){if(value && !(value.preset in WEATHER))throw Error('Unknown weather');observed=value||null;lastClock=lastCapture=-Infinity;},
    setClock(mode){const next=mode==='game'?'game':'live';if(next!==clockMode){clockMode=next;lastClock=lastCapture=-Infinity;}},
    clockMode:()=>clockMode,
    setTime(value){const date=value===null?null:new Date(value);if(date && !Number.isFinite(+date))throw Error('Invalid date');override=date;lastClock=lastCapture=-Infinity;},
    dispose(){scene.remove(sky,clouds,rain,dome,stars,moon,halo);sky.geometry.dispose();sky.material.dispose();captureSky.geometry.dispose();captureSky.material.dispose();
      deck.texture.dispose();clouds.geometry.dispose();deck.material.dispose();rainGeometry.dispose();rain.material.dispose();
      dome.geometry.dispose();domeMaterial.dispose();stars.geometry.dispose();starMaterial.dispose();moonTexture.dispose();haloTexture.dispose();
      moon.material.dispose();halo.material.dispose();environment?.dispose();pmrem.dispose();scene.environment=priorEnvironment;}};
}
