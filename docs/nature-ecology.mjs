// Ecological appearance priors, NOT an inventory of individual plants.
// Source support and inferred probability weights: nature/ecology.json.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function noiseHash(x,y,s=0){let h=Math.imul(x^s,374761393)^Math.imul(y,668265263);h=Math.imul(h^h>>>13,1274126177);return ((h^h>>>16)>>>0)/4294967296;}
export function field(x,y,scale=120,salt=0){const u=x/scale,v=y/scale,c=Math.floor(u),r=Math.floor(v),a=smooth(0,1,u-c),b=smooth(0,1,v-r);
 return (noiseHash(c,r,salt)*(1-a)+noiseHash(c+1,r,salt)*a)*(1-b)+(noiseHash(c,r+1,salt)*(1-a)+noiseHash(c+1,r+1,salt)*a)*b;}
export const SPECIES={
 oak:{name:'Quercus agrifolia',form:'oak',height:[9,19],radius:[3.4,6.0],leaf:[.25,.34,.16],bark:[.34,.30,.23]},
 bay:{name:'Umbellularia californica',form:'broadleaf',height:[12,24],radius:[3.0,4.8],leaf:[.22,.34,.20],bark:[.40,.35,.27]},
 cypress:{name:'Hesperocyparis macrocarpa',form:'cypress',height:[13,25],radius:[3.8,5.6],leaf:[.22,.32,.21],bark:[.40,.32,.24]},
 pine:{name:'Pinus radiata',form:'pine',height:[18,32],radius:[3.0,5.0],leaf:[.28,.37,.20],bark:[.41,.30,.21]},
 eucalyptus:{name:'Eucalyptus globulus',form:'eucalyptus',height:[22,38],radius:[2.5,4.5],leaf:[.39,.46,.34],bark:[.66,.61,.49]},
 acacia:{name:'Acacia melanoxylon',form:'broadleaf',height:[12,23],radius:[3.0,4.7],leaf:[.29,.40,.22],bark:[.34,.29,.22]},
 redwood:{name:'Sequoia sempervirens',form:'redwood',height:[28,52],radius:[2.8,4.3],leaf:[.19,.31,.22],bark:[.43,.26,.17]},
 douglas:{name:'Pseudotsuga menziesii',form:'fir',height:[25,43],radius:[3.1,4.9],leaf:[.24,.35,.26],bark:[.38,.30,.23]},
 willow:{name:'Salix spp.',form:'willow',height:[6,14],radius:[2.6,4.2],leaf:[.40,.47,.24],bark:[.42,.36,.26]},
};
const MIX={presidio:{eucalyptus:.42,cypress:.34,pine:.17,acacia:.04,redwood:.03},
 peninsula:{redwood:.44,douglas:.23,bay:.20,oak:.13},eastbay:{oak:.57,bay:.25,douglas:.12,pine:.06},
 coastal:{cypress:.30,pine:.25,eucalyptus:.25,oak:.20},wetland:{willow:.62,bay:.23,oak:.15}};
function mix(a,b,t){const o={};for(const k of new Set([...Object.keys(a),...Object.keys(b)]))o[k]=(a[k]||0)*(1-t)+(b[k]||0)*t;return o;}
export function speciesWeights(lon,lat,habitat={}){
 let w=lon<-122.32?MIX.coastal:MIX.eastbay;
 const peninsula=smooth(37.78,37.50,lat)*smooth(-122.10,-122.24,lon)*(habitat.forest??1);
 w=mix(w,MIX.peninsula,peninsula);
 // A soft geographic prior, not a rectangular vegetation patch or an exact current census.
 const presidio=smooth(-122.500,-122.485,lon)*(1-smooth(-122.452,-122.445,lon))*
  smooth(37.778,37.785,lat)*(1-smooth(37.807,37.814,lat));
 w=mix(w,MIX.presidio,presidio);
 return mix(w,MIX.wetland,habitat.wetland||0);
}
function choose(weights,u){let t=0,total=Object.values(weights).reduce((a,b)=>a+b,0);for(const [k,v] of Object.entries(weights)){t+=v/total;if(u<t)return k;}return Object.keys(weights).at(-1);}
export function speciesAt(x,y,lon,lat,habitat={}){
 const weights=speciesWeights(lon,lat,habitat),c=Math.floor(x/115),r=Math.floor(y/115);
 let closest=Infinity,grove=null;
 for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
  const a=c+dc,b=r+dr,gx=(a+.15+.7*noiseHash(a,b,401))*115,gy=(b+.15+.7*noiseHash(a,b,409))*115;
  const d=Math.hypot(x-gx,y-gy);if(d<closest){closest=d;grove=[a,b];}
 }
 // Most seedlings belong to a coherent grove; occasional immigrants break monocultures.
 const immigrant=noiseHash(Math.floor(x),Math.floor(y),419)<.18;
 return choose(weights,immigrant?noiseHash(Math.floor(x),Math.floor(y),421):noiseHash(...grove,431));
}
export function habitatMixture(cover,canopy,cols,rows,c,r){
 const weights={forest:0,scrub:0,grass:0,barren:0,wetland:0,developed:0,water:0},classes={};
 let total=0,trees=0,known=0;
 for(let dy=-1;dy<=2;dy++)for(let dx=-1;dx<=2;dx++){
  const cx=Math.floor(c)+dx,ry=Math.floor(r)+dy;if(cx<0||ry<0||cx>=cols||ry>=rows)continue;
  const w=Math.exp(-((cx-c)**2+(ry-r)**2)/1.15),i=ry*cols+cx,k=cover[i];total+=w;classes[k]=(classes[k]||0)+w;
  if(canopy[i]!==255){trees+=canopy[i]*w;known+=w;}
  const group=[41,42,43].includes(k)?'forest':k===52?'scrub':[71,81,82].includes(k)?'grass':k===31?'barren':[90,95].includes(k)?'wetland':[21,22,23,24].includes(k)?'developed':k===11?'water':null;
  if(group)weights[group]+=w;
 }
 for(const k of Object.keys(weights))weights[k]/=total||1;
 for(const k of Object.keys(classes))classes[k]/=total||1;
 return {...weights,classes,canopy:known?trees/known:null};
}
export const FLOOR_PALETTES={
 forest:[.34,.28,.19],redwood:[.30,.23,.17],scrub:[.48,.42,.29],grass:[.57,.52,.32],
 barren:[.53,.49,.42],wetland:[.35,.37,.23],sand:[.72,.65,.50],developed:[.43,.43,.38],water:[44/255,97/255,135/255],
};
export function floorColour(habitat,cover,natural=null){
 if(cover===11)return FLOOR_PALETTES.water;
 if(natural==='beach')return FLOOR_PALETTES.sand;
 const w=habitat||{},out=[0,0,0];let total=0;
 for(const key of ['forest','scrub','grass','barren','wetland','developed']){
  const weight=w[key]||0;total+=weight;for(let i=0;i<3;i++)out[i]+=FLOOR_PALETTES[key][i]*weight;
 }
 return total?out.map(v=>v/total):FLOOR_PALETTES.barren;
}
export function undergrowthAt(x,y,s){
 const h=s?.habitat;if(!s||s.water||!h||h.canopy===null||[0,11,12,22,23,24].includes(s.cover))return null;
 const patch=field(x,y,34,503),canopy=clamp(h.canopy/100),forest=clamp(h.forest+(h.developed||0)*canopy*.65);
 const moisture=clamp((s.moisture??.5)*.7+forest*.25+h.wetland*.5);
 // Deep conifer shade is litter/ferns, not a uniform hedge beneath every tree.
 const density=clamp(h.scrub*.55+h.grass*.18+forest*(.07+moisture*.30)*(1-canopy*.35)+h.wetland*.42);
 if(noiseHash(Math.floor(x*2),Math.floor(y*2),509)>density*(.35+patch*1.15))return null;
 const selector=noiseHash(Math.floor(x),Math.floor(y),521);
 const kind=forest>.35?(moisture>.45?(selector<.65?'fern':selector<.82?'coffeeberry':'sorrel'):(selector<.65?'coffeeberry':'toyon')):
  h.scrub>.25||(h.developed||0)*canopy>.15?(selector<.65?'coyote_brush':'toyon'):h.wetland>.35?'sedge':'bunchgrass';
 return {kind,height:kind==='fern'?.55+selector*.55:kind==='sorrel'?.10:kind==='bunchgrass'||kind==='sedge'?.35+selector*.45:.65+selector*.9,
  radius:kind==='sorrel'?.45:kind==='bunchgrass'||kind==='sedge'?.45:.65+selector*.45,
  certainty:'inferred-habitat-prior',patch};
}
