// Ecological appearance priors, NOT an inventory of individual plants.
// Source support and inferred probability weights: nature/ecology.json.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function noiseHash(x,y,s=0){let h=Math.imul(x^s,374761393)^Math.imul(y,668265263);h=Math.imul(h^h>>>13,1274126177);return ((h^h>>>16)>>>0)/4294967296;}
export function field(x,y,scale=120,salt=0){const u=x/scale,v=y/scale,c=Math.floor(u),r=Math.floor(v),a=smooth(0,1,u-c),b=smooth(0,1,v-r);
 return (noiseHash(c,r,salt)*(1-a)+noiseHash(c+1,r,salt)*a)*(1-b)+(noiseHash(c,r+1,salt)*(1-a)+noiseHash(c+1,r+1,salt)*a)*b;}
// Crown radii are half the crown spreads published for open- and stand-grown trees of these
// heights (Calflora, the USFS Silvics manual, UF/IFAS species sheets). They were a third of
// that, so a 30 m pine stood a 6 m-wide crown on a pole -- the stretched trees.
export const SPECIES={
 oak:{name:'Quercus agrifolia',form:'oak',height:[9,19],radius:[5.0,9.5],leaf:[.25,.34,.16],bark:[.34,.30,.23]},
 bay:{name:'Umbellularia californica',form:'broadleaf',height:[12,24],radius:[4.0,8.0],leaf:[.22,.34,.20],bark:[.40,.35,.27]},
 cypress:{name:'Hesperocyparis macrocarpa',form:'cypress',height:[13,25],radius:[5.0,10.0],leaf:[.22,.32,.21],bark:[.40,.32,.24]},
 pine:{name:'Pinus radiata',form:'pine',height:[18,32],radius:[5.0,9.0],leaf:[.28,.37,.20],bark:[.41,.30,.21]},
 eucalyptus:{name:'Eucalyptus globulus',form:'eucalyptus',height:[22,38],radius:[4.5,8.5],leaf:[.39,.46,.34],bark:[.66,.61,.49]},
 acacia:{name:'Acacia melanoxylon',form:'broadleaf',height:[12,23],radius:[3.5,6.5],leaf:[.29,.40,.22],bark:[.34,.29,.22]},
 redwood:{name:'Sequoia sempervirens',form:'redwood',height:[28,52],radius:[3.5,6.5],leaf:[.19,.31,.22],bark:[.43,.26,.17]},
 douglas:{name:'Pseudotsuga menziesii',form:'fir',height:[25,43],radius:[4.0,7.0],leaf:[.24,.35,.26],bark:[.38,.30,.23]},
 willow:{name:'Salix spp.',form:'willow',height:[6,14],radius:[3.0,6.0],leaf:[.40,.47,.24],bark:[.42,.36,.26]},
};
//: A tree's height and crown from one draw, so a tall tree is a wide one: drawn apart, the
//: tallest trees came with the narrowest crowns as often as the widest.
export function treeSize(spec,u,v){
 const t=Math.max(0,Math.min(1,u)),w=Math.max(0,Math.min(1,.7*t+.3*v));
 return {height:spec.height[0]+t*(spec.height[1]-spec.height[0]),radius:spec.radius[0]+w*(spec.radius[1]-spec.radius[0])};
}
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
//: NLCD's natural classes, and what a developed cell among them is taken for (vegetatedCover).
export const NATURAL_COVER=[31,41,42,43,52,71,81,82,90,95];
const NATURAL_SET=new Set(NATURAL_COVER),OPEN_SET=new Set([21,...NATURAL_COVER]);
//: NLCD labels each 30 m cell by what covers most of it, so a 2 m trail or a fire road through a
//: wood comes out "developed" and a wooded park as low-intensity development -- most of the
//: Presidio is classes 21 and 22 under 50 to 75 per cent measured canopy. Taken at its word that
//: is grey ground with no tree or bush on it for thirty metres round every path. The paths and
//: buildings themselves are mapped (nature/paths.json) and keep the plants off; so, for the
//: plants and the floor's colour, a developed cell (21-23) whose neighbours are mostly natural
//: is a strip through them and takes their commonest class, and a low- or medium-intensity one
//: under real canopy beside open land is open space under trees (21). The source array is not
//: changed; the same rule builds the floor colours (build_nature_ecology.vegetated_cover).
export function vegetatedCover(cover,canopy,cols,rows){
 const out=Uint8Array.from(cover),counts=new Map();
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const i=r*cols+c,k=cover[i];if(k<21||k>23)continue;
  let natural=0,open=false,best=0,bestN=0;counts.clear();
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
   if(!dr&&!dc)continue;const cc=c+dc,rr=r+dr;if(cc<0||rr<0||cc>=cols||rr>=rows)continue;
   const n=cover[rr*cols+cc];if(OPEN_SET.has(n))open=true;if(!NATURAL_SET.has(n))continue;
   natural++;const m=(counts.get(n)||0)+1;counts.set(n,m);if(m>bestN||(m===bestN&&n<best)){best=n;bestN=m;}
  }
  if(natural>=(k===23?6:5))out[i]=best;
  else if(k!==21&&open&&canopy[i]!==255&&canopy[i]>=25)out[i]=21;
 }
 return out;
}
//: How much of a developed-open-space cell is grass (NLCD 21: impervious under 20 per cent).
export const OPEN_SPACE_GRASS=.85;
export function habitatMixture(cover,canopy,cols,rows,c,r){
 const weights={forest:0,scrub:0,grass:0,barren:0,wetland:0,developed:0,water:0},classes={};
 let total=0,trees=0,known=0;
 for(let dy=-1;dy<=2;dy++)for(let dx=-1;dx<=2;dx++){
  const cx=Math.floor(c)+dx,ry=Math.floor(r)+dy;if(cx<0||ry<0||cx>=cols||ry>=rows)continue;
  const w=Math.exp(-((cx-c)**2+(ry-r)**2)/1.15),i=ry*cols+cx,k=cover[i];total+=w;classes[k]=(classes[k]||0)+w;
  if(canopy[i]!==255){trees+=canopy[i]*w;known+=w;}
  // Developed open space (21) is NLCD's lawn: mostly grass, under a fifth of it paved. Counted
  // as developed whole it grew nothing round the Presidio's trails but a few trees on bare soil.
  if(k===21){weights.grass+=w*OPEN_SPACE_GRASS;weights.developed+=w*(1-OPEN_SPACE_GRASS);}
  const group=k===21?null:[41,42,43].includes(k)?'forest':k===52?'scrub':[71,81,82].includes(k)?'grass':k===31?'barren':[90,95].includes(k)?'wetland':[22,23,24].includes(k)?'developed':k===11?'water':null;
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
//: What grows under and between the trees, by habitat: Bay Area understoreys as the CNPS
//: vegetation descriptions give them. A visual prior: no plant here is an observed individual.
export const UNDERGROWTH={
 fern:{name:'Polystichum munitum',colour:[.20,.38,.15]},
 thimbleberry:{name:'Rubus parviflorus',colour:[.33,.46,.20]},
 huckleberry:{name:'Vaccinium ovatum',colour:[.19,.29,.14]},
 sorrel:{name:'Oxalis oregana',colour:[.28,.45,.20]},
 coffeeberry:{name:'Frangula californica',colour:[.22,.32,.16]},
 toyon:{name:'Heteromeles arbutifolia',colour:[.24,.33,.17]},
 coyote_brush:{name:'Baccharis pilularis',colour:[.30,.40,.20]},
 sagebrush:{name:'Artemisia californica',colour:[.43,.47,.37]},
 sedge:{name:'Carex spp.',colour:[.38,.42,.22]},
 bunchgrass:{name:'Stipa pulchra',colour:[.48,.48,.27]},
};
//: boost thickens it -- the near forest floor draws on a finer lattice than the landscape's plants.
export function undergrowthAt(x,y,s,boost=1){
 const h=s?.habitat;if(!s||s.water||!h||h.canopy===null||[0,11,12,22,23,24].includes(s.cover))return null;
 const patch=field(x,y,34,503),canopy=clamp(h.canopy/100),forest=clamp(h.forest+(h.developed||0)*canopy*.65);
 const moisture=clamp((s.moisture??.5)*.7+forest*.25+h.wetland*.5);
 // A forest floor is mostly understorey, thinning only in the deepest shade; open scrub is
 // nearly continuous shrub. Patchy, so there are glades and thickets rather than a lawn of
 // evenly spaced bushes.
 const density=clamp((h.scrub*.80+h.grass*.22+forest*(.30+moisture*.40)*(1-canopy*.30)+h.wetland*.55)*boost);
 if(noiseHash(Math.floor(x*2),Math.floor(y*2),509)>density*(.30+patch*1.25))return null;
 const selector=noiseHash(Math.floor(x),Math.floor(y),521);
 const kind=forest>.35?(moisture>.45?(selector<.45?'fern':selector<.62?'thimbleberry':selector<.80?'huckleberry':'sorrel'):
   (selector<.45?'coffeeberry':selector<.75?'toyon':'huckleberry')):
  h.scrub>.25||(h.developed||0)*canopy>.15?(selector<.50?'coyote_brush':selector<.78?'sagebrush':'toyon'):h.wetland>.35?'sedge':'bunchgrass';
 const low=['fern','sorrel','sedge','bunchgrass'].includes(kind);
 return {kind,height:kind==='fern'?.55+selector*.55:kind==='sorrel'?.12:kind==='bunchgrass'||kind==='sedge'?.35+selector*.45:
   kind==='sagebrush'?.6+selector*.6:kind==='thimbleberry'?.7+selector*.8:.65+selector*.9,
  radius:kind==='sorrel'?.45:low?.45:.65+selector*.45,
  certainty:'inferred-habitat-prior',patch};
}
//: What falls from a tree and lies under it, by the tree's form: a broadleaf's dead leaves, a
//: blue gum's shed bark ribbons and sickle leaves, a conifer's needle duff. A visual prior, like
//: the understorey: no leaf here was observed.
export const LITTER={
 leaf_litter:{trees:['oak','broadleaf','willow'],colour:[.52,.40,.27]},
 eucalyptus_litter:{trees:['eucalyptus'],colour:[.62,.56,.46]},
 needle_duff:{trees:['pine','cypress','redwood','fir'],colour:[.46,.32,.22]},
};
export function litterKind(species){
 const form=SPECIES[species]?.form||species;
 for(const [kind,spec] of Object.entries(LITTER))if(spec.trees.includes(form))return kind;
 return 'leaf_litter';
}
//: Where the litter and the deadwood under one tree lie, from the tree's own seed: patches of
//: litter over the ground its crown shades (and a little past it, where the wind takes it),
//: sticks shed from the crown, and -- in a stand, not under a lone tree -- now and then a
//: fallen limb or a log going back to the soil. x, y are the trunk; radius its crown.
export function litterScatter(x,y,radius,species,{forest=0,seed=0}={}){
 const h=k=>noiseHash(Math.floor(x*7)+seed,Math.floor(y*7)+k,1201);
 const kind=litterKind(species),patches=[],sticks=[],logs=[];
 const n=Math.max(3,Math.min(26,Math.round(radius*radius*.45)));
 for(let k=0;k<n;k++){
  const a=h(k*3)*6.283,r=radius*1.15*Math.sqrt(h(k*3+1)),size=1.4+h(k*3+2)*1.8;
  patches.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,size,turn:h(k*5+90)*6.283,shade:.78+h(k*7+91)*.4,kind});
 }
 const twigs=1+Math.floor(h(301)*Math.min(5,radius*.7));
 for(let k=0;k<twigs;k++){
  const a=h(k*4+310)*6.283,r=radius*Math.sqrt(h(k*4+311));
  sticks.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,length:.4+h(k*4+312)*1.4,radius:.012+h(k*4+313)*.03,turn:h(k*4+314)*6.283});
 }
 if(forest>.4&&h(401)<.14*forest){
  const a=h(402)*6.283,r=radius*(.6+h(403)*.9);
  logs.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,length:2.5+h(404)*5.5,radius:.12+h(405)*.22,turn:h(406)*6.283,decay:h(407)});
 }
 return {kind,patches,sticks,logs};
}
