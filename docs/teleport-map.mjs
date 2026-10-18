// A long teleport, shown as a trip on a map: the view pulls away and goes dark, a flat map of the
// Bay comes up with the walker as a blue dot, the dot hops over a half-circle to where it is going
// and lands, and the map closes in on that spot and fades back into the world there. About seven
// seconds, which is the time the new place has to stream in -- the walker never stands anywhere
// unloaded. The map is the landscape atlas's own land and water (nature/manifest.json).

const WATER=[0,11];
//: The Bay as a flat map, from the atlas's land cover: water blue, land in muted map colours.
//: One pixel per `step` atlas cells; north up.
export function drawBayMap(atlas,{step=1}={}){
  const f=atlas.f,w=Math.floor(f.cols/step),h=Math.floor(f.rows/step);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(w,h);
  const tones={water:[58,112,158],forest:[118,146,96],scrub:[164,166,118],grass:[178,184,128],
    developed:[206,201,188],dense:[184,178,168],barren:[196,184,156],wetland:[128,156,126]};
  const tone=c=>WATER.includes(c)?tones.water:[41,42,43].includes(c)?tones.forest:c===52?tones.scrub
    :[71,81,82].includes(c)?tones.grass:[21,22].includes(c)?tones.developed:[23,24].includes(c)?tones.dense
    :c===31?tones.barren:[90,95].includes(c)?tones.wetland:tones.developed;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    // Atlas rows run south to north; the map's run north to south.
    const c=atlas.cover[(f.rows-1-y*step)*f.cols+x*step],t=tone(c),i=(y*w+x)*4;
    const shade=1;
    image.data[i]=t[0]*shade;image.data[i+1]=t[1]*shade;image.data[i+2]=t[2]*shade;image.data[i+3]=255;
  }
  ctx.putImageData(image,0,0);
  return {canvas,metresPerPixel:f.step_m*step,
    //: Map pixel of an atlas-local point (metres east, north of the atlas's south-west corner).
    pixel:(ax,ay)=>[ax/(f.step_m*step),h-ay/(f.step_m*step)]};
}

const ease=t=>t<.5?2*t*t:1-(-2*t+2)**2/2;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
//: How much of the map to show for a hop of `distance` metres: both ends with room round them,
//: never so little that the hop is a twitch, never more than the whole Bay.
export function mapSpanFor(distance){return Math.min(90000,Math.max(5000,distance*2.4));}
//: The timeline, in seconds from the click.
export const TELEPORT_TIMES={dark:1.1,mapIn:1.6,widen:2.3,hop:4.5,land:4.9,close:5.9,back:7.0,maxHold:15};

//: The overlay. `run` plays one trip: from and to are atlas-local [x, y]; perform() moves the
//: walker (behind the black); ready() says whether the place has streamed in; onPull(t) and
//: onReturn(t) let the page pull the camera away and bring it back (t 0..1).
export function createTeleport({map,parent=document.body}){
  const canvas=document.createElement('canvas');
  Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'40',pointerEvents:'none',display:'none'});
  canvas.setAttribute('aria-hidden','true');parent.appendChild(canvas);
  const ctx=canvas.getContext('2d');let busy=false;
  function frame(state){
    const dpr=Math.min(2,devicePixelRatio||1),W=innerWidth,H=innerHeight;
    if(canvas.width!==Math.round(W*dpr)||canvas.height!==Math.round(H*dpr)){canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
    const {black,mapAlpha,centre,span,from,to,hop,landed}=state;
    if(mapAlpha>0){
      // The map, `span` metres across the shorter side of the window, centred where it looks.
      const scale=Math.min(W,H)/(span/map.metresPerPixel),[cx,cy]=map.pixel(...centre);
      ctx.save();ctx.globalAlpha=mapAlpha;ctx.fillStyle='rgb(58,112,158)';ctx.fillRect(0,0,W,H);
      ctx.translate(W/2,H/2);ctx.scale(scale,scale);ctx.translate(-cx,-cy);
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(map.canvas,0,0);
      ctx.restore();
      const toScreen=p=>{const [px,py]=map.pixel(...p);return [W/2+(px-cx)*scale,H/2+(py-cy)*scale];};
      const a=toScreen(from),b=toScreen(to),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],r=Math.hypot(b[0]-a[0],b[1]-a[1])/2;
      // A half-circle over the line between the two ends, bulging up the screen.
      const base=Math.atan2(b[1]-a[1],b[0]-a[0]),upward=Math.sin(base+Math.PI/2)<0?1:-1;
      const along=t=>{const angle=base+Math.PI+upward*Math.PI*t;return [mid[0]+Math.cos(angle)*r,mid[1]+Math.sin(angle)*r];};
      ctx.save();ctx.globalAlpha=mapAlpha;
      if(hop>0&&r>1){ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=2.5;ctx.setLineDash([7,7]);ctx.beginPath();
        for(let k=0;k<=48;k++){const p=along(hop*k/48);if(k)ctx.lineTo(...p);else ctx.moveTo(...p);}ctx.stroke();ctx.setLineDash([]);}
      // Where it is going: a ring on the spot.
      if(hop>0){ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(...b,9,0,Math.PI*2);ctx.stroke();}
      const dot=r>1?along(hop):a,lift=Math.sin(Math.PI*hop)*6;
      if(landed>0){ctx.strokeStyle=`rgba(66,153,255,${1-landed})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(...b,10+landed*34,0,Math.PI*2);ctx.stroke();}
      ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(dot[0],dot[1]+4+lift,7,3,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(dot[0],dot[1],9+lift*.4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#2a7fff';ctx.beginPath();ctx.arc(dot[0],dot[1],6.5+lift*.4,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
    if(black>0){ctx.fillStyle=`rgba(0,0,0,${black})`;ctx.fillRect(0,0,W,H);}
  }
  async function run({from,to,perform,ready=()=>true,onPull=()=>{},onReturn=()=>{}}){
    if(busy){await perform();return;}
    busy=true;canvas.style.display='block';
    const T=TELEPORT_TIMES,distance=Math.hypot(to[0]-from[0],to[1]-from[1]),span=mapSpanFor(distance);
    const middle=[(from[0]+to[0])/2,(from[1]+to[1])/2],closeSpan=Math.min(span,4000);
    const started=performance.now();let moved=false,released=false,paused=0;
    try{
      await new Promise(resolve=>{
        const step=()=>{
          const now=performance.now();
          let t=(now-started)/1000-paused;
          // The dot has landed: the map waits there, up to a limit, until the place has loaded.
          // However long a frame took, the trip does not run past the landing while it waits.
          if(moved&&!released&&t>=T.land){
            if(!ready()&&(now-started)/1000<T.maxHold){paused+=t-T.land;t=T.land;}else released=true;}
          const s={black:0,mapAlpha:0,centre:from,span:closeSpan,from,to,hop:0,landed:0};
          if(t<T.dark){const u=ease(t/T.dark);onPull(u);s.black=u;}
          else{
            if(!moved){moved=true;Promise.resolve(perform()).catch(e=>console.warn('kerbside: teleport',e));}
            if(t<T.mapIn){const u=ease((t-T.dark)/(T.mapIn-T.dark));s.black=1-u;s.mapAlpha=1;s.centre=from;s.span=closeSpan*1.4-closeSpan*.4*u;}
            else if(t<T.widen){const u=ease((t-T.mapIn)/(T.widen-T.mapIn));s.mapAlpha=1;
              s.centre=[from[0]+(middle[0]-from[0])*u,from[1]+(middle[1]-from[1])*u];s.span=closeSpan*Math.pow(span/closeSpan,u);}
            else if(t<T.land){const u=clamp((t-T.widen)/(T.hop-T.widen));s.mapAlpha=1;s.centre=middle;s.span=span;s.hop=ease(u);
              s.landed=t>T.hop?(t-T.hop)/(T.land-T.hop):0;s.landed=clamp(s.landed);}
            else if(t<T.close){const u=ease((t-T.land)/(T.close-T.land));s.mapAlpha=1;s.hop=1;s.landed=1;
              s.centre=[middle[0]+(to[0]-middle[0])*u,middle[1]+(to[1]-middle[1])*u];s.span=span*Math.pow(closeSpan/span,u)*(1-.25*u);s.black=clamp((u-.55)/.45);}
            else if(t<T.back){const u=ease((t-T.close)/(T.back-T.close));s.black=1-u;onReturn(u);}
            else{onReturn(1);frame({black:0,mapAlpha:0});resolve();return;}
          }
          frame(s);requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }finally{busy=false;canvas.style.display='none';if(!moved)await perform();}
  }
  return {run,get busy(){return busy;},canvas};
}
