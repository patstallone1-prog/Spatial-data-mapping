// The ground near the walker, as a forest floor is: scanned ferns and shrubs, long wild grass in
// the gaps between them, and what has fallen -- each leaf, twig and clod placed on its own, from
// its own seed, with a chance that rises under a tree's crown and in a dense stand. No leaf
// lies in a stamped patch, so none comes in clumps. Render-only and inferred: nothing here is an
// observed plant, and nothing it draws is measured, walked on or collided with.
//
// The scans are Poly Haven's (CC0): docs/nature/models/manifest.json. Pure placement runs in
// Node (tests/test_forest_floor.py); THREE and the glTF loader are injected by the page.
import {noiseHash,field,undergrowthAt,UNDERGROWTH,SPECIES,speciesAt,litterScatter} from './nature-ecology.mjs';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;

//: Long wild grass of the Bay's hills and woods. Colours are sRGB, base of the blade to its tip.
export const WILD_GRASS={
  wild_oat:{name:'Avena barbata / A. fatua',height:[.55,1.05],blades:22,arch:.38,width:.024,
    base:[.40,.40,.22],tip:[.83,.72,.45],straw:.55,seed:true},
  needlegrass:{name:'Stipa pulchra',height:[.40,.80],blades:30,arch:.55,width:.017,
    base:[.30,.37,.18],tip:[.66,.58,.40],straw:.3},
  forest_grass:{name:'Melica / Festuca californica',height:[.25,.55],blades:28,arch:.68,width:.03,
    base:[.17,.29,.11],tip:[.42,.52,.24],straw:.12},
  sedge:{name:'Carex spp.',height:[.30,.60],blades:24,arch:.48,width:.032,
    base:[.15,.26,.11],tip:[.33,.43,.19],straw:.08},
};
//: Which scan stands for each understorey kind (nature-ecology UNDERGROWTH), and its tint.
export const SCAN_FOR={fern:'fern_02',thimbleberry:'shrub_03',huckleberry:'shrub_02',sorrel:'shrub_sorrel_01',
  coffeeberry:'shrub_04',toyon:'shrub_02',coyote_brush:'shrub_04',sagebrush:'shrub_03'};
export const SCAN_TINT={fern:[1,1,1],thimbleberry:[1.06,1.1,.94],huckleberry:[.84,.9,.84],sorrel:[1,1.04,1],
  coffeeberry:[.9,.95,.86],toyon:[.8,.86,.76],coyote_brush:[1.04,1.08,.88],sagebrush:[1.12,1.12,1.08]};
//: Grass-like understorey is drawn as wild grass, not as a shrub scan.
export const GRASS_FOR={sedge:'sedge',bunchgrass:'needlegrass'};
//: What a tree of each form drops, and the colours it lies in (sRGB): dead, drying, a few green.
export const LEAF_FALL={
  oak:{kinds:[['oak',1]],colours:[[.47,.35,.21],[.56,.43,.26],[.38,.29,.18],[.44,.42,.24],[.62,.50,.32]]},
  broadleaf:{kinds:[['lance',.75],['broad',.25]],colours:[[.66,.52,.26],[.58,.38,.19],[.50,.36,.22],[.70,.60,.30],[.42,.32,.20]]},
  willow:{kinds:[['lance',1]],colours:[[.70,.62,.32],[.58,.48,.26],[.48,.40,.24]]},
  eucalyptus:{kinds:[['sickle',.9],['bark',.1]],colours:[[.74,.66,.52],[.66,.55,.43],[.62,.42,.32],[.80,.74,.62],[.56,.50,.40]]},
  pine:{kinds:[['pine',1]],colours:[[.55,.36,.21],[.47,.31,.20],[.62,.45,.28]]},
  cypress:{kinds:[['sprig',1]],colours:[[.50,.34,.22],[.44,.30,.20],[.40,.36,.24]]},
  redwood:{kinds:[['sprig',1]],colours:[[.52,.30,.19],[.45,.27,.18],[.58,.38,.24]]},
  fir:{kinds:[['sprig',1]],colours:[[.50,.36,.24],[.42,.31,.21]]},
};
export const LEAF_SIZE={oak:[.05,.085],lance:[.08,.15],broad:[.13,.24],sickle:[.13,.25],bark:[.2,.5],pine:[.13,.22],sprig:[.07,.12]};

function pick(weighted,u){let t=0;const total=weighted.reduce((n,[,w])=>n+w,0);
  for(const [k,w] of weighted){t+=w/total;if(u<t)return k;}return weighted.at(-1)[0];}

//: How much of a tree lies over (x, y): a soft disc a little past its crown, summed over the
//: stand, so the litter is thickest under crowns and between close trees. Also which tree a
//: leaf there would have come from, drawn by that weight.
export function treeShade(x,y,trees,u=0){
  let total=0;const near=[];
  for(const t of trees){const d2=(x-t.x)**2+(y-t.y)**2,R=t.radius*1.15;if(d2>R*R*2.6)continue;
    const w=Math.exp(-d2/(R*R));total+=w;near.push([t,w]);}
  let from=null,acc=0;for(const [t,w] of near){acc+=w;if(u*total<=acc){from=t;break;}}
  return {shade:Math.min(1.4,total),from:from||near.at(-1)?.[0]||null};
}
//: Leaf, needle and bark litter per 0.17 m slot: a little everywhere in a wood, most under crowns.
export function litterChance(h,shade){
  return clamp((.08+(h.forest||0)*.45+(h.scrub||0)*.10)+shade*.8);
}
//: The wild grass a 0.55 m slot holds, if any: most in open grassland and woodland gaps, little
//: under a closed canopy, none on lawns, pavement, beach or water.
export function wildGrassAt(x,y,s,boost=1){
  const h=s?.habitat;if(!s||s.water||!h||[0,11,12,22,23,24].includes(s.cover)||s.natural==='beach')return null;
  const canopy=clamp((h.canopy??0)/100),open=1-canopy;
  // A mown park is lawn; only its wooded parts grow a wild floor.
  if(s.cover===21&&canopy<.2)return null;
  const density=clamp((h.grass*.90+h.scrub*.42+h.forest*(.22+.50*open)+h.wetland*.6+h.barren*.22)*boost);
  const i=Math.floor(x*4),j=Math.floor(y*4);
  if(noiseHash(i,j,1607)>density*(.35+field(x,y,9,1601)*.95))return null;
  const u=noiseHash(i,j,1613),moist=s.moisture??.5;
  const kind=h.wetland>.35||(moist>.6&&h.forest>.3&&u<.3)?'sedge'
    :h.forest>.4&&canopy>.35?(u<.7?'forest_grass':'needlegrass')
    :h.grass+h.barren>.35?(u<.55?'wild_oat':u<.88?'needlegrass':'forest_grass')
    :(u<.4?'needlegrass':u<.72?'wild_oat':'forest_grass');
  const spec=WILD_GRASS[kind],v=noiseHash(i,j,1619);
  return {kind,height:lerp(spec.height[0],spec.height[1],v),variant:Math.floor(u*997)%3,certainty:'inferred-habitat-prior'};
}

//: One clump of wild grass, unit height (y 0..1), blades arching out from its crown. Positions,
//: sRGB colours and triangle indices; `detail` 0 is the landscape's lighter clump.
export function wildGrassGeometry(kind,variant=0,detail=1){
  const spec=WILD_GRASS[kind]||WILD_GRASS.needlegrass,position=[],colour=[],index=[];
  let seed=variant*7919+kind.length*131;const rnd=()=>noiseHash(++seed,variant,1709);
  const blades=detail?spec.blades:Math.ceil(spec.blades*.45),segments=detail?4:2;
  const push=(x,y,z,c)=>{position.push(x,y,z);colour.push(...c);return position.length/3-1;};
  for(let b=0;b<blades;b++){
    const a=b*2.39996+rnd()*.6,lean=spec.arch*(.35+.65*rnd()),tall=.55+.45*rnd(),w=spec.width*(.7+.6*rnd());
    const dead=rnd()<spec.straw*.45,hue=.85+.3*rnd(),dx=Math.cos(a),dz=Math.sin(a),root=.025*rnd();
    const tint=t=>(dead?[.78,.70,.50]:spec.base.map((v,k)=>lerp(v,spec.tip[k],t))).map(v=>Math.min(1,v*hue*(.62+.38*t+(dead?.12:0))));
    let last=null;
    for(let k=0;k<=segments;k++){
      const t=k/segments,d=root+tall*lean*t*t,y=tall*t*(1-.42*lean*t),half=w*(1-t*.88);
      // The blade's flat side faces along its arc, twisting a little as it rises.
      const tw=a+Math.PI/2+t*.7*(rnd()-.5),px=-Math.sin(a)*0+Math.cos(tw)*half,pz=Math.sin(tw)*half;
      const cx=dx*d,cz=dz*d,c=tint(t);
      const i0=push(cx-px,y,cz-pz,c),i1=push(cx+px,y,cz+pz,c);
      if(last)index.push(last[0],last[1],i1,last[0],i1,i0);
      last=[i0,i1];
    }
    if(spec.seed&&detail&&b%2===0){
      // Wild oats: spikelets hanging from the top of the stem.
      const d=root+tall*lean,y=tall*(1-.42*lean),cx=dx*d,cz=dz*d;
      for(let s=0;s<4;s++){
        const sy=y-.02-s*.05,sa=a+s*1.9,len=.06+.03*rnd(),c=[.86,.78,.52].map(v=>v*(.9+.15*rnd()));
        const ox=Math.cos(sa)*.035,oz=Math.sin(sa)*.035,i0=push(cx,sy,cz,c),i1=push(cx+ox*.4+.006,sy-len*.2,cz+oz*.4,c);
        const i2=push(cx+ox,sy-len,cz+oz,c),i3=push(cx+ox*.4-.006,sy-len*.2,cz+oz*.4,c);
        index.push(i0,i1,i2,i0,i2,i3);
      }
    }
  }
  let top=0;for(let i=1;i<position.length;i+=3)top=Math.max(top,position[i]);
  if(top>0)for(let i=1;i<position.length;i+=3)position[i]/=top;
  return {position,colour,index};
}

//: Everything on the floor of one square cell [x0, x0+size) x [y0, y0+size), in atlas metres.
//: ctx.ground(x, y) -> {height, p:[pageX, pageZ], water, cover, natural}; ctx.ecology(x, y) ->
//: the ecological sample (habitat, moisture); ctx.blocked(x, y, r); ctx.trees: trunks with
//: x, y, radius, height, species near the cell. Every item comes from its own global slot's
//: seed, so a cell builds the same however and whenever it is built.
export function floorCell(x0,y0,size,ctx){
  const G=size+1,ground=[],free=[];
  for(let r=0;r<G;r++)for(let c=0;c<G;c++){const s=ctx.ground(x0+c,y0+r);ground.push(s);
    free.push(Boolean(s&&!s.water&&!ctx.blocked(x0+c,y0+r,.3)));}
  // Habitat varies over tens of metres: a 3 x 3 sample, interpolated.
  const eco=[];for(let r=0;r<3;r++)for(let c=0;c<3;c++)eco.push(ctx.ecology(x0+c*size/2,y0+r*size/2));
  const ecoAt=(x,y)=>{
    const u=clamp((x-x0)/size*2,0,1.999),v=clamp((y-y0)/size*2,0,1.999),c=Math.floor(u),r=Math.floor(v),a=u-c,b=v-r;
    const q=[eco[r*3+c],eco[r*3+c+1],eco[(r+1)*3+c],eco[(r+1)*3+c+1]],w=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b];
    const any=q.find(Boolean);if(!any)return null;const out={habitat:{},moisture:0};
    for(const key of ['forest','scrub','grass','barren','wetland','developed','canopy']){let s=0,t=0;
      q.forEach((e,i)=>{const v=e?.habitat?.[key];if(Number.isFinite(v)){s+=v*w[i];t+=w[i];}});out.habitat[key]=t?s/t:0;}
    let s=0,t=0;q.forEach((e,i)=>{if(e){s+=(e.moisture??.5)*w[i];t+=w[i];}});out.moisture=t?s/t:.5;
    const nearest=q[(b>.5?2:0)+(a>.5?1:0)]||any;out.lon=nearest.lon;out.lat=nearest.lat;return out;
  };
  const at=(x,y)=>{
    const u=clamp(x-x0,0,size-1e-6),v=clamp(y-y0,0,size-1e-6),c=Math.floor(u),r=Math.floor(v),a=u-c,b=v-r;
    const q=[ground[r*G+c],ground[r*G+c+1],ground[(r+1)*G+c],ground[(r+1)*G+c+1]];
    if(q.some(s=>!s))return null;
    const nearest=q[(b>.5?2:0)+(a>.5?1:0)];
    if(!free[(r+(b>.5?1:0))*G+c+(a>.5?1:0)])return null;
    const mix=k=>(q[0][k]*(1-a)+q[1][k]*a)*(1-b)+(q[2][k]*(1-a)+q[3][k]*a)*b;
    const px=(q[0].p[0]*(1-a)+q[1].p[0]*a)*(1-b)+(q[2].p[0]*(1-a)+q[3].p[0]*a)*b;
    const pz=(q[0].p[1]*(1-a)+q[1].p[1]*a)*(1-b)+(q[2].p[1]*(1-a)+q[3].p[1]*a)*b;
    // The ground's slope, for things that lie flat on it.
    const sx=((q[1].height-q[0].height)*(1-b)+(q[3].height-q[2].height)*b),sy=((q[2].height-q[0].height)*(1-a)+(q[3].height-q[1].height)*a);
    return {p:[px,pz],ground:mix('height'),cover:nearest.cover,natural:nearest.natural,water:false,slope:[sx,sy]};
  };
  const trees=ctx.trees||ctx.treesNear?.(x0-12,y0-12,x0+size+12,y0+size+12)||[],nearTrunk=(x,y,r)=>trees.some(t=>Math.hypot(x-t.x,y-t.y)<r+.25+t.height*.012);
  const centre=ecoAt(x0+size/2,y0+size/2),regional=centre?speciesAt(x0+size/2,y0+size/2,centre.lon??-122.45,centre.lat??37.79,centre.habitat):'oak';
  const out={leaves:[],twigs:[],clods:[],grass:[],plants:[],branches:[],stumps:[],rocks:[],logs:[]};
  // Space taken by shrubs, on a half-metre grid, so grass fills the gaps rather than the bushes.
  const occupied=new Uint8Array(size*2*size*2),occ=(x,y)=>{const c=Math.floor((x-x0)*2),r=Math.floor((y-y0)*2);
    return c>=0&&r>=0&&c<size*2&&r<size*2?occupied[r*size*2+c]:0;};
  const occupy=(x,y,R)=>{for(let r=Math.floor((y-R-y0)*2);r<=Math.floor((y+R-y0)*2);r++)for(let c=Math.floor((x-R-x0)*2);c<=Math.floor((x+R-x0)*2);c++)
    if(c>=0&&r>=0&&c<size*2&&r<size*2&&Math.hypot(x0+(c+.5)/2-x,y0+(r+.5)/2-y)<R)occupied[r*size*2+c]=1;};
  const lattice=(step,salt,fn)=>{
    for(let r=Math.ceil(y0/step);r*step<y0+size;r++)for(let c=Math.ceil(x0/step);c*step<x0+size;c++){
      const x=(c+.1+.8*noiseHash(c,r,salt))*step,y=(r+.1+.8*noiseHash(c,r,salt+1))*step;
      if(x<x0||y<y0||x>=x0+size||y>=y0+size)continue;fn(x,y,c,r);
    }
  };
  // Scanned understorey, then the extras of a wood's edge and a damp hollow.
  lattice(1.25,1801,(x,y,c,r)=>{
    const s=at(x,y),e=ecoAt(x,y);if(!s||!e)return;
    const shrub=undergrowthAt(x,y,{...e,cover:s.cover,water:false},1.9);if(!shrub)return;
    const shade=.82+noiseHash(c,r,1811)*.3,turn=noiseHash(c,r,1813)*6.283;
    if(GRASS_FOR[shrub.kind]&&s.cover===21&&(e.habitat.canopy||0)<20)return; // a mown lawn
    if(GRASS_FOR[shrub.kind]){out.grass.push({x,y,...s,kind:GRASS_FOR[shrub.kind],height:shrub.height*1.2,variant:Math.floor(shade*97)%3,turn,shade});return;}
    if(occ(x,y)||nearTrunk(x,y,shrub.radius*.4)||ctx.blocked(x,y,shrub.radius*.6))return;
    occupy(x,y,shrub.radius*.75);
    out.plants.push({x,y,...s,kind:shrub.kind,model:SCAN_FOR[shrub.kind],height:shrub.height,radius:shrub.radius,turn,
      variant:Math.floor(noiseHash(c,r,1817)*997),tint:SCAN_TINT[shrub.kind].map(v=>v*shade)});
  });
  lattice(2.5,1821,(x,y,c,r)=>{
    const s=at(x,y),e=ecoAt(x,y);if(!s||!e||occ(x,y)||[0,11,12,22,23,24].includes(s.cover))return;
    const h=e.habitat,u=noiseHash(c,r,1823),moist=e.moisture;
    const weed=(h.grass+h.scrub)*.16+h.forest*.05,nettle=h.forest*clamp(moist-.35)*.35+h.wetland*.2,dandelion=h.grass*.12+(h.developed||0)*.04;
    const total=weed+nettle+dandelion;if(u>clamp(total))return;
    const kind=pick([['weed_plant_02',weed],['nettle_plant',nettle],['dandelion_01',dandelion]],noiseHash(c,r,1827));
    const height=kind==='weed_plant_02'?.35+.45*noiseHash(c,r,1829):kind==='nettle_plant'?.45+.7*noiseHash(c,r,1829):.12+.12*noiseHash(c,r,1829);
    if(nearTrunk(x,y,.2))return;occupy(x,y,height*.4);
    out.plants.push({x,y,...s,kind,model:kind,height,radius:height*.45,turn:noiseHash(c,r,1831)*6.283,variant:Math.floor(u*9973),
      tint:[1,1,1].map(v=>v*(.85+.25*noiseHash(c,r,1833)))});
  });
  // Long wild grass between the bushes: the floor's filler where nothing else grows.
  lattice(.55,1841,(x,y,c,r)=>{
    if(occ(x,y))return;const s=at(x,y),e=ecoAt(x,y);if(!s||!e)return;
    const g=wildGrassAt(x,y,{...e,cover:s.cover,natural:s.natural},1.5);if(!g||nearTrunk(x,y,.1))return;
    out.grass.push({x,y,...s,...g,turn:noiseHash(c,r,1843)*6.283,shade:.84+noiseHash(c,r,1847)*.3});
  });
  // Every leaf is its own draw: thick under the crowns, sparse in the open, never a patch.
  lattice(.17,1851,(x,y,c,r)=>{
    const e=ecoAt(x,y);if(!e)return;const {shade,from}=treeShade(x,y,trees,noiseHash(c,r,1853));
    const chance=litterChance(e.habitat,shade)*(.72+.56*field(x,y,3.7,1855));
    if(noiseHash(c,r,1857)>chance)return;const s=at(x,y);if(!s)return;
    const form=SPECIES[from?.species||regional]?.form||'oak',fall=LEAF_FALL[form]||LEAF_FALL.oak;
    let kind=pick(fall.kinds,noiseHash(c,r,1859));
    if(kind==='lance'&&e.moisture>.55&&noiseHash(c,r,1861)<.18)kind='broad';
    const [lo,hi]=LEAF_SIZE[kind],colour=fall.colours[Math.floor(noiseHash(c,r,1863)*fall.colours.length)],k=.86+.24*noiseHash(c,r,1865);
    out.leaves.push({x,y,...s,kind,size:lerp(lo,hi,noiseHash(c,r,1867)),turn:noiseHash(c,r,1869)*6.283,
      tilt:(noiseHash(c,r,1871)-.5)*.5,colour:colour.map(v=>Math.min(1,v*k))});
  });
  // Twigs, likewise each on its own; now and then a whole fallen branch.
  lattice(.9,1881,(x,y,c,r)=>{
    const e=ecoAt(x,y);if(!e)return;const {shade}=treeShade(x,y,trees);
    if(noiseHash(c,r,1883)>clamp(e.habitat.forest*.22+e.habitat.scrub*.06+shade*.55)*.75)return;
    const s=at(x,y);if(!s)return;const g=.30+.16*noiseHash(c,r,1885);
    out.twigs.push({x,y,...s,length:.12+.55*noiseHash(c,r,1887)**1.6,radius:.004+.012*noiseHash(c,r,1889),
      turn:noiseHash(c,r,1891)*6.283,fork:noiseHash(c,r,1893)<.35,colour:[g*1.35,g*1.1,g*.85]});
  });
  lattice(4,1901,(x,y,c,r)=>{
    const e=ecoAt(x,y);if(!e)return;const {shade}=treeShade(x,y,trees);
    if(noiseHash(c,r,1903)>shade*.16+e.habitat.forest*.03)return;const s=at(x,y);if(!s||nearTrunk(x,y,.6))return;
    out.branches.push({x,y,...s,size:.8+1.3*noiseHash(c,r,1905),turn:noiseHash(c,r,1907)*6.283,variant:Math.floor(noiseHash(c,r,1909)*997)});
  });
  // Clods of earth and pebbles: the ground's own grain, where it shows between the plants.
  lattice(.8,1921,(x,y,c,r)=>{
    const e=ecoAt(x,y);if(!e)return;const h=e.habitat;
    const chance=clamp(.04+h.forest*.20+h.barren*.32+h.scrub*.14-h.grass*.12)*(.55+.9*field(x,y,5,1923));
    if(noiseHash(c,r,1925)>chance)return;const s=at(x,y);if(!s)return;
    const stone=noiseHash(c,r,1927)<.18+h.barren*.5,moss=!stone&&e.moisture>.55&&h.forest>.4&&noiseHash(c,r,1929)<.3;
    out.clods.push({x,y,...s,stone,moss,size:(stone?.03:.04)+(stone?.10:.16)*noiseHash(c,r,1931)**1.5,
      turn:noiseHash(c,r,1933)*6.283,shade:.72+.3*noiseHash(c,r,1935)});
  });
  lattice(7,1941,(x,y,c,r)=>{
    const e=ecoAt(x,y);if(!e)return;const u=noiseHash(c,r,1943);
    const s=at(x,y);if(!s)return;
    if(u<e.habitat.forest*.06&&!nearTrunk(x,y,.8)&&!ctx.blocked(x,y,.8))
      out.stumps.push({x,y,...s,size:.5+.7*noiseHash(c,r,1945),turn:noiseHash(c,r,1947)*6.283});
    else if(u>1-(e.habitat.forest*.035+(['bare_rock','scree'].includes(s.natural)?.4:0)+e.habitat.barren*.05)&&!ctx.blocked(x,y,1))
      out.rocks.push({x,y,...s,size:.25+.7*noiseHash(c,r,1949)**1.5,turn:noiseHash(c,r,1951)*6.283,variant:Math.floor(noiseHash(c,r,1953)*997)});
  });
  // Logs are the landscape's own (litterScatter), so the near and far floors agree on them.
  for(const t of trees){
    const fall=litterScatter(t.x,t.y,t.radius,t.species,{forest:t.forest||0});
    for(const log of fall.logs){if(log.x<x0||log.y<y0||log.x>=x0+size||log.y>=y0+size)continue;
      const s=at(log.x,log.y);if(!s||ctx.blocked(log.x,log.y,log.length/2))continue;out.logs.push({...log,...s});}
  }
  return out;
}

// ---- drawing -------------------------------------------------------------------------------

//: A cut-out of one fallen leaf, needle bundle or bark ribbon: pale, so the instance colours it.
function leafTexture(THREE,kind){
  const c=document.createElement('canvas');c.width=64;c.height=128;const g=c.getContext('2d');
  g.translate(32,64);g.lineCap='round';
  const fill=(l)=>{const grad=g.createLinearGradient(-20,0,20,0);grad.addColorStop(0,`rgb(${l-36},${l-36},${l-36})`);grad.addColorStop(1,`rgb(${l},${l},${l})`);g.fillStyle=grad;};
  if(kind==='pine'||kind==='sprig'){
    const n=kind==='pine'?3:14;g.strokeStyle='rgb(225,225,225)';
    if(kind==='pine'){g.lineWidth=2.4;for(let k=0;k<n;k++){g.beginPath();g.moveTo(0,58);g.quadraticCurveTo((k-1)*10,0,(k-1)*16,-60);g.stroke();}}
    else{g.lineWidth=2.6;g.beginPath();g.moveTo(0,58);g.lineTo(0,-58);g.stroke();g.lineWidth=3.2;
      for(let k=0;k<n;k++){const y=-52+k*8,s=k%2?1:-1;g.beginPath();g.moveTo(0,y);g.lineTo(s*(18-Math.abs(k-7)*.9),y-4);g.stroke();}}
  }else if(kind==='bark'){
    fill(235);g.beginPath();g.moveTo(-9,-62);g.bezierCurveTo(-16,-20,-4,20,-11,62);g.lineTo(9,62);g.bezierCurveTo(14,20,4,-20,10,-62);g.closePath();g.fill();
    g.strokeStyle='rgba(120,110,100,.6)';g.lineWidth=1.5;for(let k=-1;k<=1;k++){g.beginPath();g.moveTo(k*4,-60);g.lineTo(k*4+2,60);g.stroke();}
  }else{
    const w=kind==='sickle'?9:kind==='lance'?14:kind==='oak'?22:28,l=60;fill(230);g.beginPath();g.moveTo(0,l);
    if(kind==='sickle'){g.bezierCurveTo(w*2.6,l*.2,w*1.6,-l*.6,4,-l);g.bezierCurveTo(w*.6,-l*.5,w*1.2,l*.2,0,l);}
    else if(kind==='broad'){
      // A maple's: five pointed lobes about the stalk.
      for(let k=0;k<=40;k++){const a=-Math.PI*.92+k/40*Math.PI*1.84,r=l*.9*(.5+.5*Math.abs(Math.cos(a*2.5)))**.7;
        g.lineTo(Math.sin(a)*r*.62,l*.55-Math.cos(a)*r);}}
    else{const spiky=kind==='oak';for(let k=0;k<=12;k++){const t=k/12,y=l-t*2*l,x=Math.sin(t*Math.PI)*w*(spiky&&k%2?1.18:1);g.lineTo(x,y);}
      for(let k=12;k>=0;k--){const t=k/12,y=l-t*2*l,x=-Math.sin(t*Math.PI)*w*(spiky&&k%2?1.18:1);g.lineTo(x,y);}}
    g.closePath();g.fill();g.strokeStyle='rgba(110,100,90,.65)';g.lineWidth=1.4;g.beginPath();g.moveTo(0,l+2);g.lineTo(0,-l*.9);g.stroke();
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

//: Hide what is past a band of ranges, and fade in what is inside another, by a screen-door
//: dither on the distance to the camera; a whole instance beyond `cull` is not drawn at all.
//: Bands are uniforms ({value: Vector2(start, end)}) so the page can move them.
export function rangeFade(material,{fadeIn=null,fadeOut=null,cull=null,key}){
  if(material.userData.rangeFade)return material;material.userData.rangeFade=key;
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    if(previous)previous.call(this,shader,renderer);
    if(fadeIn)shader.uniforms.uFadeIn=fadeIn;if(fadeOut)shader.uniforms.uFadeOut=fadeOut;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vFloorRange;')
      .replace('#include <project_vertex>',`#include <project_vertex>
vFloorRange=length(mvPosition.xyz);
${cull?`#ifdef USE_INSTANCING
if(length((modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz)>${cull.toFixed(1)})gl_Position=vec4(2.,2.,2.,1.);
#endif`:''}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying float vFloorRange;${fadeIn?'uniform vec2 uFadeIn;':''}${fadeOut?'uniform vec2 uFadeOut;':''}`)
      .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
{float keep=1.${fadeIn?'*smoothstep(uFadeIn.x,uFadeIn.y,vFloorRange)':''}${fadeOut?'*(1.-smoothstep(uFadeOut.x,uFadeOut.y,vFloorRange))':''};
if(fract(dot(gl_FragCoord.xy,vec2(.75487766,.56984029)))>keep)discard;}`);
  };
  material.customProgramCacheKey=function(){return `${previousKey?previousKey.call(this):''}|range-${key}`;};
  material.needsUpdate=true;return material;
}

//: The scans, each variant stood upright on its base at the origin and scaled to unit height.
//: Returns {near: {model: [{geometry, material, ratio}]}, far: {model: [{geometry, ...}]}}.
export async function loadScanLibrary(THREE,{loadModel,resolve}){
  const response=await fetch(resolve('nature/models/manifest.json'),{cache:'no-cache'});
  if(!response.ok)throw new Error(`plant scans: ${response.status}`);
  const manifest=await response.json(),near={},far={};
  const upright=(scene,long=false)=>{
    scene.updateMatrixWorld(true);const parts=[],m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),p=new THREE.Vector3();
    scene.traverse(o=>{if(!o.isMesh)return;
      o.matrixWorld.decompose(p,q,s);m.compose(new THREE.Vector3(),q,s);
      const g=o.geometry.clone();g.applyMatrix4(m);g.computeBoundingBox();const b=g.boundingBox;
      const cx=(b.min.x+b.max.x)/2,cz=(b.min.z+b.max.z)/2;
      g.translate(-cx,-b.min.y,-cz);
      const height=b.max.y-b.min.y,length=Math.max(b.max.x-b.min.x,b.max.z-b.min.z);
      // A log is laid along x and sized by its length; a plant by its height.
      if(long&&b.max.z-b.min.z>b.max.x-b.min.x)g.rotateY(Math.PI/2);
      const unit=long?length:height;g.scale(1/unit,1/unit,1/unit);g.computeBoundingSphere();g.computeBoundingBox();
      const bb=g.boundingBox,ratio=Math.max(-bb.min.x,bb.max.x,-bb.min.z,bb.max.z);
      const material=o.material;if(material.map){material.alphaTest=Math.max(material.alphaTest||0,.45);material.transparent=false;material.side=THREE.DoubleSide;}
      material.envMapIntensity=.45;
      parts.push({name:o.name,geometry:g,material,ratio,aspect:long?(bb.max.y):ratio});});
    return parts;
  };
  await Promise.all(Object.entries(manifest.models).map(async([name,record])=>{
    const gltf=await loadModel(resolve(`nature/models/${record.file}`));near[name]=upright(gltf.scene,name==='dead_tree_trunk');
    if(record.far){const lod=await loadModel(resolve(`nature/models/${record.far.file}`));
      const geos=upright(lod.scene);far[name]=geos.map(g=>({...g,material:near[name].find(n=>n.name===g.name)?.material||near[name][0].material}));}
  }));
  return {manifest,near,far};
}

//: The near forest floor: cells of `cell` metres built nearest-first around the walker, out to
//: `radius`, each dithered out over its last metres (`band`, which the landscape's plants fade in
//: over). Hidden from on high.
export function createForestFloor(THREE,{parent,ctx,scans,motion=null,radius=58,cell=12,maxCells=96,band,nearDetail=20}){
  const group=new THREE.Group();group.name='inferred-forest-floor';parent.add(group);
  const cells=new Map(),dummy=new THREE.Object3D(),colour=new THREE.Color(),up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3(),tq=new THREE.Quaternion(),yq=new THREE.Quaternion();
  const stats={cells:0,leaves:0,twigs:0,clods:0,grass:0,plants:0,deadwood:0,rocks:0,buildMs:0};
  const nearMaterials=new Map(),mat=(key,make)=>{if(!nearMaterials.has(key))nearMaterials.set(key,make());return nearMaterials.get(key);};
  const fadeOut=band,cull=radius+6;
  const plantMaterial=(name,source)=>mat(`scan:${name}:${source.uuid}`,()=>{const m=source.clone();rangeFade(m,{fadeOut,cull,key:'floor-near-v1'});motion?.apply(m,'shrub');return m;});
  const grassMaterial=mat('grass',()=>{const m=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.95,envMapIntensity:.4});
    rangeFade(m,{fadeOut,cull,key:'floor-grass-v1'});motion?.apply(m,'shrub');return m;});
  const grassGeometry=new Map(),grassGeo=(kind,variant,detail=1)=>{const key=`${kind}:${variant}:${detail}`;if(grassGeometry.has(key))return grassGeometry.get(key);
    const d=wildGrassGeometry(kind,variant,detail),g=new THREE.BufferGeometry(),lin=[];
    for(let i=0;i<d.colour.length;i+=3){colour.setRGB(d.colour[i],d.colour[i+1],d.colour[i+2],THREE.SRGBColorSpace);lin.push(colour.r,colour.g,colour.b);}
    g.setAttribute('position',new THREE.Float32BufferAttribute(d.position,3));g.setAttribute('color',new THREE.Float32BufferAttribute(lin,3));
    g.setIndex(d.index);g.computeVertexNormals();
    // Grass is lit from above, as a sward is, not by each blade's own facing.
    const n=g.getAttribute('normal');for(let i=0;i<n.count;i++){normal.set(n.getX(i),n.getY(i),n.getZ(i)).lerp(up,.65).normalize();n.setXYZ(i,normal.x,normal.y,normal.z);}
    g.computeBoundingSphere();grassGeometry.set(key,g);return g;};
  const leafGeometry=(()=>{const g=new THREE.PlaneGeometry(.5,1,2,2);g.rotateX(-Math.PI/2);const p=g.getAttribute('position');
    // A dry leaf curls: its edges lift off the ground.
    for(let i=0;i<p.count;i++)p.setY(i,Math.abs(p.getX(i))*.22+Math.abs(p.getZ(i))*.05);g.computeVertexNormals();return g;})();
  const leafMaterials=new Map(),leafMaterial=kind=>{if(!leafMaterials.has(kind)){const m=new THREE.MeshStandardMaterial({map:leafTexture(THREE,kind),alphaTest:.5,side:THREE.DoubleSide,roughness:.95,envMapIntensity:.3});
    rangeFade(m,{fadeOut:{value:new THREE.Vector2(26,34)},cull:36,key:'floor-leaf-v1'});leafMaterials.set(kind,m);}return leafMaterials.get(kind);};
  const twigGeometry=[false,true].map(fork=>{
    const g=new THREE.CylinderGeometry(.75,1,1,5,4,true);g.rotateZ(Math.PI/2);const p=g.getAttribute('position');
    for(let i=0;i<p.count;i++){const x=p.getX(i);p.setY(i,p.getY(i)+Math.sin(x*6.1+.7)*.9);p.setZ(i,p.getZ(i)+Math.sin(x*4.3)*1.4);}
    if(!fork){g.computeVertexNormals();return g;}
    const side=new THREE.CylinderGeometry(.5,.8,.38,4,1,true);side.rotateZ(Math.PI/2);side.translate(.19,0,0);side.rotateY(.7);side.translate(.08,0,0);
    const merged=new THREE.BufferGeometry(),a=g.toNonIndexed(),b=side.toNonIndexed();
    merged.setAttribute('position',new THREE.Float32BufferAttribute([...a.getAttribute('position').array,...b.getAttribute('position').array],3));
    merged.computeVertexNormals();return merged;});
  const twigMaterial=rangeFade(new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),{fadeOut:{value:new THREE.Vector2(30,40)},cull:42,key:'floor-twig-v1'});
  const clodGeometry=(()=>{const g=new THREE.IcosahedronGeometry(1,1),p=g.getAttribute('position');
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=.78+.4*noiseHash(Math.round(x*40),Math.round(z*40)+Math.round(y*40)*97,1999);p.setXYZ(i,x*k,y*k*.55,z*k);}
    g.computeVertexNormals();return g;})();
  const clodMaterial=rangeFade(new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true}),{fadeOut:{value:new THREE.Vector2(32,42)},cull:44,key:'floor-clod-v1'});
  function onGround(item,turn,lift=0){
    const [sx,sy]=item.slope||[0,0];normal.set(-sx,1,sy).normalize();
    // Atlas y runs north and page z south: the page's slope normal flips that component.
    tq.setFromUnitVectors(up,normal).multiply(yq.setFromAxisAngle(up,turn));
    dummy.position.set(item.p[0],item.ground+lift,item.p[1]);dummy.quaternion.copy(tq);
  }
  function batch(target,geometry,material,list,place){
    if(!list.length)return;const mesh=new THREE.InstancedMesh(geometry,material,list.length);
    list.forEach((v,i)=>{place(v);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(v._c)mesh.setColorAt(i,colour.setRGB(...v._c,THREE.SRGBColorSpace));});
    mesh.computeBoundingSphere();mesh.frustumCulled=true;mesh.userData={surface:'nature_forest_floor',inferred:true,liftedOntoGround:true,canonical:false,
      confidence:'habitat-prior visual inference; no plant here was observed'};target.add(mesh);
  }
  // Past `nearDetail` a cell draws each scan's lighter version; the smallest plants, which have
  // none and are lost at that range, are left out.
  function variantOf(name,v,far=false){const list=far?(scans?.far?.[name]||(['nettle_plant','dandelion_01'].includes(name)?null:scans?.near?.[name])):scans?.near?.[name];
    return list?.length?list[v%list.length]:null;}
  function build(cx,cy,detail,data=null){
    const started=performance.now(),far=!detail,g=new THREE.Group();data=data||floorCell(cx*cell,cy*cell,cell,ctx);
    // Scanned plants, each variant its own batch.
    const byVariant=new Map();for(const v of data.plants){const part=variantOf(v.model,v.variant,far);if(!part)continue;
      if(!byVariant.has(part))byVariant.set(part,[]);byVariant.get(part).push(v);}
    for(const [part,list] of byVariant)batch(g,part.geometry,plantMaterial(list[0].model,part.material),list,v=>{
      const s=v.height,w=s*clamp(v.radius/(part.ratio*s||1),.8,1.25);
      dummy.position.set(v.p[0],v.ground-.02,v.p[1]);dummy.quaternion.setFromAxisAngle(up,v.turn);dummy.scale.set(w,s,w);v._c=v.tint;});
    const grassBy=new Map();for(const v of data.grass){const key=`${v.kind}:${v.variant}`;if(!grassBy.has(key))grassBy.set(key,[]);grassBy.get(key).push(v);}
    for(const [key,list] of grassBy){const [kind,variant]=key.split(':');batch(g,grassGeo(kind,Number(variant),detail),grassMaterial,list,v=>{
      dummy.position.set(v.p[0],v.ground-.02,v.p[1]);dummy.quaternion.setFromAxisAngle(up,v.turn);dummy.scale.setScalar(v.height);v._c=[v.shade,v.shade,v.shade];});}
    const leavesBy=new Map();for(const v of data.leaves){if(!leavesBy.has(v.kind))leavesBy.set(v.kind,[]);leavesBy.get(v.kind).push(v);}
    for(const [kind,list] of leavesBy)batch(g,leafGeometry,leafMaterial(kind),list,v=>{onGround(v,v.turn,.008);
      dummy.rotateX(v.tilt*.7);dummy.scale.setScalar(v.size);v._c=v.colour;});
    for(const fork of [false,true])batch(g,twigGeometry[fork?1:0],twigMaterial,data.twigs.filter(v=>v.fork===fork),v=>{
      onGround(v,v.turn,v.radius*.6);dummy.scale.set(v.length,v.radius,v.radius);v._c=v.colour;});
    batch(g,clodGeometry,clodMaterial,data.clods,v=>{onGround(v,v.turn,-v.size*.18);dummy.scale.set(v.size,v.size,v.size*(.7+.5*v.shade));
      const base=v.stone?[.55,.53,.49]:v.moss?[.30,.36,.18]:(ctx.floorColour?.(v.x,v.y)||[.36,.29,.20]).map(c=>c*.82);v._c=base.map(c=>c*v.shade);});
    const scanned=(name,list,size,lift=0,tint=null)=>{const by=new Map();for(const v of list){const part=variantOf(name,v.variant||0,far);if(!part)continue;
      if(!by.has(part))by.set(part,[]);by.get(part).push(v);}
      for(const [part,items] of by)batch(g,part.geometry,plantMaterial(name,part.material),items,v=>{
        dummy.position.set(v.p[0],v.ground+lift*size(v),v.p[1]);dummy.quaternion.setFromAxisAngle(up,v.turn);dummy.scale.setScalar(size(v));if(tint)v._c=tint(v);});};
    scanned('dry_branches_medium_01',data.branches,v=>v.size);
    scanned('tree_stump_01',data.stumps,v=>v.size,-.08);
    scanned('rock_moss_set_01',data.rocks,v=>v.size,-.25);
    const logPart=variantOf('dead_tree_trunk',0);
    if(logPart)batch(g,logPart.geometry,plantMaterial('dead_tree_trunk',logPart.material),data.logs,v=>{
      dummy.position.set(v.p[0],v.ground-v.radius*.35,v.p[1]);dummy.quaternion.setFromAxisAngle(up,v.turn);
      const thick=v.radius*2/Math.max(.02,logPart.aspect);dummy.scale.set(v.length,thick,thick);
      const moss=Math.max(0,v.decay-.45)*1.2;v._c=[1-moss*.35,1-moss*.1,1-moss*.4];});
    stats.buildMs=Math.round(performance.now()-started);g.userData.detail=detail;g.userData.data=data;
    g.userData.counts={leaves:data.leaves.length,twigs:data.twigs.length,clods:data.clods.length,grass:data.grass.length,
      plants:data.plants.length,deadwood:data.branches.length+data.stumps.length+data.logs.length,rocks:data.rocks.length};
    return g;
  }
  let lastX=Infinity,lastY=Infinity,lastBuild=0,desired=[];
  function drop(g){group.remove(g);g.traverse(o=>{if(o.isInstancedMesh)o.dispose();});}
  return {group,stats,
    //: Each frame, with the walker's atlas position and the eye's height over the ground.
    update(ax,ay,eyeHeight=0){
      const show=eyeHeight<60;group.visible=show;band.value.set(show?radius-12:-2,show?radius-3:-1);
      if(!show)return;
      if(Math.hypot(ax-lastX,ay-lastY)>=4){lastX=ax;lastY=ay;const wanted=[];
        for(let cy=Math.floor((ay-radius)/cell);cy<=Math.floor((ay+radius)/cell);cy++)for(let cx=Math.floor((ax-radius)/cell);cx<=Math.floor((ax+radius)/cell);cx++){
          const d=Math.hypot((cx+.5)*cell-ax,(cy+.5)*cell-ay);if(d<radius+cell*.71)wanted.push({cx,cy,d,key:`${cx}:${cy}`,detail:d<nearDetail+cell*.5?1:0});}
        wanted.sort((a,b)=>a.d-b.d);wanted.length=Math.min(wanted.length,maxCells);const keys=new Set(wanted.map(v=>v.key));
        for(const [key,g] of cells)if(!keys.has(key)){drop(g);cells.delete(key);}
        desired=wanted;}
      // Nearest first, one cell at a time, so a frame never stalls on the whole floor.
      if(performance.now()-lastBuild<20)return;const began=performance.now();
      // A few milliseconds a frame, nearest cell first.
      while(performance.now()-began<5){const next=desired.find(v=>cells.get(v.key)?.userData.detail!==v.detail);if(!next)break;
        // A cell crossing the detail ring is redrawn from what it already placed.
        const old=cells.get(next.key),g=build(next.cx,next.cy,next.detail,old?.userData.data);
        cells.set(next.key,g);group.add(g);if(old)drop(old);}
      lastBuild=performance.now();
      for(const k of Object.keys(stats))if(k!=='buildMs')stats[k]=0;stats.cells=cells.size;
      for(const c of cells.values())for(const [k,v] of Object.entries(c.userData.counts))stats[k]=(stats[k]||0)+v;
    },
    invalidate(){lastX=Infinity;for(const g of cells.values())drop(g);cells.clear();},
  };
}
