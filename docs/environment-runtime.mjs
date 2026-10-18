import {WEATHER,solarState,previewTime} from './sky-clock.mjs';
import {Sky} from './vendor/three-sky-r160.mjs';

export function createEnvironment({THREE,scene,renderer,camera,sun,ambient,lat,lon}) {
  const sky=new Sky();sky.scale.setScalar(90000);sky.frustumCulled=false;sky.renderOrder=-10;
  scene.add(sky);scene.background=null;
  const skyScene=new THREE.Scene(),captureSky=new Sky();captureSky.scale.setScalar(90000);skyScene.add(captureSky);
  const pmrem=new THREE.PMREMGenerator(renderer);
  const priorEnvironment=scene.environment;
  let environment=null,preset='sunny',override=null,observed=null,lastClock=-Infinity,lastCapture=-Infinity,latest=null;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(256,256);
  // Periodic low-frequency cloud cover, independent of world tiles and geometry.
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
    const v=.5+.18*Math.sin(x*.049)+.15*Math.sin(y*.074+x*.025)+.12*Math.cos(x*.098-y*.049);
    const i=(y*256+x)*4;pixels.data.set([255,255,255,Math.max(0,Math.min(255,v*255))],i);
  }
  ctx.putImageData(pixels,0,0);
  const cloudTexture=new THREE.CanvasTexture(canvas);cloudTexture.wrapS=cloudTexture.wrapT=THREE.RepeatWrapping;
  const cloudMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,
    uniforms:{cover:{value:.05},day:{value:1},time:{value:0},map:{value:cloudTexture}},
    vertexShader:'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D map;uniform float cover,day,time;varying vec3 direction;
      void main(){vec3 d=normalize(direction);float n=texture2D(map,d.xz/max(.18,d.y)*.15+vec2(time,0.)).a;
      float a=smoothstep(1.-cover,1.12-cover,n)*smoothstep(.01,.2,d.y)*.92;
      gl_FragColor=vec4(mix(vec3(.025,.035,.055),vec3(.72,.76,.8),day),a);}`});
  const clouds=new THREE.Mesh(new THREE.SphereGeometry(40000,24,12),cloudMaterial);clouds.frustumCulled=false;scene.add(clouds);
  const rainPositions=new Float32Array(600*6);
  for(let i=0;i<600;i++){const x=((i*73)%601)/601*50-25,z=((i*137)%607)/607*50-25,y=((i*31)%593)/593*32;
    rainPositions.set([x,y,z,x-.12,y-1.1,z],i*6);}
  const rainGeometry=new THREE.BufferGeometry();rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
  const rain=new THREE.LineSegments(rainGeometry,new THREE.LineBasicMaterial({color:0xb7c9da,transparent:true,opacity:.35,depthWrite:false}));
  rain.frustumCulled=false;scene.add(rain);
  function update(now,{indoors=false}={}) {
    sky.position.copy(camera.position);clouds.position.copy(camera.position);
    cloudMaterial.uniforms.time.value=(now/1000000)%1;
    rain.position.copy(camera.position);rain.position.y-=((now/1000*12)%32);
    // An observed hour's weather (sky-history.mjs) stands in for the chosen preset while it is set.
    const weather=observed?{...WEATHER[observed.preset],wind:observed.wind,windFrom:observed.windFrom}:WEATHER[preset];
    rain.visible=Boolean(weather.rain && !indoors);
    // The wind the plants sway in (foliage-motion.mjs), and the rain slanting with it.
    globalThis.kerbsideWind={speed:weather.wind,from:weather.windFrom};
    if(now-lastClock<1000)return;lastClock=now;
    const date=override || new Date(), s=solarState(date,lat,lon);
    const day=THREE.MathUtils.smoothstep(s.altitude,-.12,.15);
    for(const dome of [sky,captureSky]){
      const u=dome.material.uniforms;u.sunPosition.value.fromArray(s.direction).multiplyScalar(450000);
      u.turbidity.value=weather.turbidity;u.rayleigh.value=2;u.mieCoefficient.value=.005;
    }
    sun.position.fromArray(s.direction).multiplyScalar(900);sun.intensity=2*day*weather.sun;
    sun.color.setHSL(.1,.16+(1-day)*.3,.94);
    ambient.intensity=.22+day*(.68+weather.cloud*.35); // Low navigation fill, not photometric evidence.
    cloudMaterial.uniforms.cover.value=weather.cloud;cloudMaterial.uniforms.day.value=day;
    if(scene.fog)scene.fog.color.setHSL(.58,.12,.035+day*(.69-weather.cloud*.12));
    latest={...s,preset:observed?.preset||preset,weatherBasis:observed?'nws_station_observation':'user_selected_visual_preset_not_live_observation',
      observed:observed&&{station:observed.station,at:observed.observed,standsIn:observed.standsIn,text:observed.text},date:date.toISOString(),live:!override};
    // Cubemap capture only on preset/time changes or every five minutes, never per frame.
    if(now-lastCapture>=300000){lastCapture=now;const next=pmrem.fromScene(skyScene,0,.1,100000);
      scene.environment=next.texture;environment?.dispose();environment=next;}
  }
  return {update,snapshot:()=>latest,setWeather(value){if(!(value in WEATHER))throw Error('Unknown weather');preset=value;lastClock=lastCapture=-Infinity;},
    setPhase(name){override=previewTime(name,new Date(),lat,lon);lastClock=lastCapture=-Infinity;},
    //: Observed conditions ({preset, wind, windFrom, ...}) for the hour shown, or null for the preset.
    setConditions(value){if(value && !(value.preset in WEATHER))throw Error('Unknown weather');observed=value||null;lastClock=lastCapture=-Infinity;},
    setTime(value){const date=value===null?null:new Date(value);if(date && !Number.isFinite(+date))throw Error('Invalid date');override=date;lastClock=lastCapture=-Infinity;},
    dispose(){scene.remove(sky,clouds,rain);sky.geometry.dispose();sky.material.dispose();captureSky.geometry.dispose();captureSky.material.dispose();
      cloudTexture.dispose();clouds.geometry.dispose();cloudMaterial.dispose();rainGeometry.dispose();rain.material.dispose();environment?.dispose();pmrem.dispose();scene.environment=priorEnvironment;}};
}
