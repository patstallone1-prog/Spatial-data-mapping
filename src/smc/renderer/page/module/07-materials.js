// ---- materials ----
//
// Textures are drawn into a canvas rather than shipped as images: the page is served from a
// repository where every megabyte of binary is a megabyte in every future clone, and a facade
// that is a grid of windows costs a few lines of code and nothing on disk.

function noiseTexture(base, speck, size = 128, density = 0.28) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = speck;
  for (let i = 0; i < size * size * density; i += 1) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.25;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// San Francisco's building stock, roughly. Wood-frame and stucco dominate the residential
// blocks, concrete the mid-century infill, brick the older commercial streets, and glass the
// downtown towers. These shares are approximate and are meant to make a street look inhabited
// rather than to describe any particular building -- nothing downstream measures them, and the
// provenance of a colour is "invented" wherever anyone asks.
// Every colour here is chosen to sit away from the ambient grey of the ground and the sky. A
// building painted the same value as the air around it reads as wireframe -- the eye takes it
// for the absence of a surface rather than the presence of one.
const MATERIALS = [
  { name: "stucco",   share: 0.40, grit: 0.10, rough: 0.92, metal: 0.02,
    colours: [0xe4d9c2, 0xd9c9a8, 0xcdbfa4, 0xe8dfd0, 0xc8b89c,
              0xb9c4a8,   // pale sage
              0xa8b5a0] },
  { name: "painted",  share: 0.16, grit: 0.14, rough: 0.85, metal: 0.03,
    colours: [0x3f5670,   // dark blue
              0x2f4858, 0x4a6b5a,   // green
              0x6b5744,   // brown
              0x7a4b42, 0x54606b] },
  { name: "concrete", share: 0.18, grit: 0.22, rough: 0.95, metal: 0.02,
    colours: [0xc6cac6, 0xaab0ae, 0x8d9694, 0xd2d6d1] },
  { name: "brick",    share: 0.14, grit: 0.26, rough: 0.94, metal: 0.02,
    colours: [0x9c5540, 0x8a4a38, 0xa9614a, 0x7d4433, 0xb06b52, 0x6f4a3c] },
  // Wood and stone are only selected from photo-supported labels, never at random.
  { name: "wood",     share: 0, grit: 0.18, rough: 0.89, metal: 0,
    colours: [0x9a8065, 0xa99174, 0x736959] },
  { name: "stone",    share: 0, grit: 0.19, rough: 0.94, metal: 0,
    colours: [0xa59d8e, 0xb4aa96, 0x878b89] },
  { name: "glass",    share: 0.07, grit: 0.03, rough: 0.06, metal: 0.85,
    colours: [0x8fb2c4, 0x7aa0b6, 0xa3c2d0, 0x6d93aa] },
  { name: "metal",    share: 0.05, grit: 0.06, rough: 0.24, metal: 0.95,
    colours: [0xb9c3c8, 0x9aa6ad, 0xc9d2d6, 0x8d989f] },
];

// What each kind of building is usually made of, and what colour it usually is.
//
// Every building used to be drawn from one distribution -- San Francisco's building stock as a
// whole -- so a filling station, a school and a block of flats were all equally likely to come
// out as brick. Now 4,765 of them know what they are, from their own OpenStreetMap tags and
// from the 5,491 points of interest that sit inside them, and a known type picks from its own
// materials rather than from the city's average.
const ARCHETYPE_STYLE = {
  residential: { materials: ["stucco", "painted", "brick"],
                 colours: [0xd8cdbc, 0xc9d3cc, 0xe0d6c4, 0xbfc9d2, 0xd6c3bb, 0xcfd8d0] },
  office:      { materials: ["glass", "concrete", "metal"],
                 colours: [0x9fb0bd, 0x8f9aa4, 0xa8b4bc, 0x7f8d99] },
  hotel:       { materials: ["concrete", "brick", "stucco"],
                 colours: [0xc4b7a6, 0xb9a898, 0xcfc4b4] },
  retail:      { materials: ["brick", "stucco", "painted"],
                 colours: [0xb08a72, 0xc9b7a4, 0xbfa98f] },
  restaurant:  { materials: ["brick", "painted", "stucco"],
                 colours: [0xb5806a, 0xc4a184, 0xa8836b] },
  civic:       { materials: ["concrete", "stucco"],
                 colours: [0xd2ccbe, 0xc3bfb4, 0xdad4c6] },
  school:      { materials: ["brick", "concrete"],
                 colours: [0xa8705c, 0xb98a70, 0xc0b3a2] },
  industrial:  { materials: ["metal", "concrete"],
                 colours: [0x9aa0a2, 0x8b9294, 0xa6aaa8] },
  parking:     { materials: ["concrete"], colours: [0xa9a9a6, 0x9b9b98] },
  gas_station: { materials: ["metal", "painted"], colours: [0xe4e4e2, 0xd8d2c8] },
  park:        { materials: ["stucco"], colours: [0x8fa882, 0x9db58f] },
};

//: Types whose real buildings are low, whatever a default height would say. A filling station
//: drawn at the 10.5 m default is a three-storey filling station.
const ARCHETYPE_MAX_HEIGHT = { gas_station: 6.0, parking: 16.0, park: 4.0 };

//: The floor a sampled facade colour is held above. Nothing in this city is black: the darkest
//: real facades -- painted brick, dark grey stucco, weathered redwood -- sit around here once
//: they are read as albedo rather than as pixels.
const SAMPLED_LIGHTNESS_FLOOR = 0.34;

//: And the floor under a roof, which is darker than its walls but is still a surface in daylight.
//: Both are sRGB lightness.
const ROOF_LIGHTNESS_FLOOR = 0.30;

function liftSampledColour(hex) {
  // What a photograph of a facade measures is the facade's colour multiplied by how the camera
  // was exposed, and a street-level frame is exposed for the sky above the street. So the hue
  // and the saturation are the measurement and the lightness is largely the sky's doing: of the
  // 3,518 colours sampled off the corridor's own photographs, 1,135 came back below 0.30
  // lightness and the darkest came back at zero. Drawn as they arrived, a third of the city was
  // near-black -- and because the tint multiplies the facade texture, the windows drawn into
  // that texture went to nothing at all, which is a wall of black rectangles where the glazing
  // should be.
  //
  // Only the underexposed end is moved. A building the photographs agree is pale stays pale.
  const colour = new THREE.Color(hex);
  const hsl = {};
  // In sRGB, which is the space the numbers mean something in.
  //
  // three.js has colour management on, so Color.r/g/b are linear-light and getHSL returns a
  // linear lightness unless it is told otherwise. The two are not close: #3f5670 is 0.34 in
  // sRGB and 0.11 in linear. Written without the colour space, this floor of 0.34 was being
  // applied to linear lightness -- which is sRGB 0.62 -- so every sampled building it touched
  // came out far paler than intended, and the check that ought to have caught that could not,
  // because the stand-in Color in the test was an sRGB one.
  colour.getHSL(hsl, THREE.SRGBColorSpace);
  const lifted = Math.max(hsl.l, SAMPLED_LIGHTNESS_FLOOR + 0.30 * hsl.l);
  colour.setHSL(hsl.h, hsl.s, Math.min(0.94, lifted), THREE.SRGBColorSpace);
  return colour.getHex();
}

//: A facade read off the building's own photographs and matched to the closest render
//: (smc.facades.match) is believed at this confidence and above; below it, the die.
//: From here up the match is drawn. On 39 labelled walls the fitted catalogue was right 26
//: times over all, 14 of 18 at this confidence and above (smc.facades.match CATALOGUE_STATUS);
//: below it the seeded die still chooses.
const FACADE_MATCH_MIN_CONFIDENCE = 0.6;

const PHOTO_CLASS_TO_MATERIAL = {
  stucco_render: "stucco", concrete: "concrete", brick: "brick",
  wood_siding: "wood", stone: "stone",
  vinyl_siding: "wood", painted_brick: "brick", ceramic_tile: "concrete", metal_panel: "metal",
};
//: Photographed variants per material class (docs/materials): a terrace of houses in one
//: class shows up to this many different walls.
const MATERIAL_VARIANTS = 5;
//: The cladding of a house whose photographs gave no reading: concrete, with the photographed
//: concrete library (docs/materials) laid across its walls.
const DEFAULT_CLADDING = "concrete";

function facadeAppearanceBands(feature, fallback) {
  const fit=frontageFitFor(feature), raw=fit?.appearance?.bands;
  if(!Array.isArray(raw) || !raw.length) return [fallback];
  const valid=raw.filter(b=>Number.isFinite(b.bottom_m) && Number.isFinite(b.top_m)
    && b.bottom_m>=0 && b.bottom_m<fallback.height && b.top_m>b.bottom_m && b.top_m<=fallback.height+.01
    && (b.colour==null || /^#[0-9a-f]{6}$/i.test(b.colour)))
    .map(b=>({...b,top_m:Math.min(b.top_m,fallback.height)}));
  if(!valid.length) return [fallback];
  const cuts=[...new Set([0,fallback.height,...valid.flatMap(b=>[b.bottom_m,b.top_m])])].sort((a,b)=>a-b);
  const result=[];
  for(let i=1;i<cuts.length;i++) {
    const low=cuts[i-1],high=cuts[i],mid=(low+high)/2;
    const matching=valid.filter(b=>b.bottom_m<=mid && b.top_m>=mid);
    const band=matching.length===1 ? matching[0] : null;
    const name=band && (PHOTO_CLASS_TO_MATERIAL[band.material] || (band.material==="glass" ? "glass" : null));
    const selected=name && MATERIALS.find(m=>m.name===name);
    const material=selected ? {...selected,photoLabel:band.material} : fallback.material;
    result.push({...fallback, bottom:low,top:high,
      material:band?.colour ? {...material,neutralColourDetail:true} : material,
      tint:band?.colour ? Number.parseInt(band.colour.slice(1),16) : fallback.tint,
      frontBasis:band?.front_basis || "fallback_inferred",otherSidesBasis:"inferred_same_height_band"});
  }
  return result.length ? result : [fallback];
}

function clipFacadeBand(geometry, indices, bottom, top) {
  const position=geometry.getAttribute("position"), normal=geometry.getAttribute("normal"),uv=geometry.getAttribute("uv");
  const output={position:[],normal:[],uv:[]};
  const vertex=i=>({p:[position.getX(i),position.getY(i),position.getZ(i)],
    n:[normal.getX(i),normal.getY(i),normal.getZ(i)],u:[uv.getX(i),uv.getY(i)]});
  const cut=(poly,height,above)=>{
    const result=[];
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],ain=above ? a.p[1]>=height : a.p[1]<=height,
        bin=above ? b.p[1]>=height : b.p[1]<=height;
      if(ain) result.push(a);
      if(ain!==bin) {
        const t=(height-a.p[1])/(b.p[1]-a.p[1]);
        const lerp=(x,y)=>x.map((v,k)=>v+(y[k]-v)*t);
        const crossing={p:lerp(a.p,b.p),n:lerp(a.n,b.n),u:lerp(a.u,b.u)};
        crossing.p[1]=height;result.push(crossing);
      }
    }
    return result;
  };
  for(let i=0;i<indices.length;i+=3) {
    const poly=cut(cut(indices.slice(i,i+3).map(vertex),bottom,true),top,false);
    for(let k=1;k+1<poly.length;k++) for(const v of [poly[0],poly[k],poly[k+1]]) {
      output.position.push(...v.p);output.normal.push(...v.n);output.uv.push(...v.u);
    }
  }
  const result=new THREE.BufferGeometry();
  for(const [key,size] of [["position",3],["normal",3],["uv",2]]) result.setAttribute(key,new THREE.Float32BufferAttribute(output[key],size));
  return result;
}

function frontageWallTriangles(feature,geometry,indices) {
  const fit=frontageFitFor(feature);
  if(!fit?.a || !fit?.b)return [{indices,front:false}];
  const [ax,ay]=xy(...fit.a),[bx,by]=xy(...fit.b),dx=bx-ax,dz=ay-by,L=Math.hypot(dx,dz);
  if(L<.2)return [{indices,front:false}];
  const out=frontageNormalFor(fit);if(!out)return [{indices,front:false}];
  const [nx,nz]=out,tx=dx/L,tz=dz/L,position=geometry.getAttribute("position"),normal=geometry.getAttribute("normal");
  const front=[],other=[];
  for(let k=0;k<indices.length;k+=3) {
    const tri=indices.slice(k,k+3);
    const onFront=tri.every(i=>normal.getX(i)*nx+normal.getZ(i)*nz>.25
      && Math.abs((position.getX(i)-ax)*nx+(position.getZ(i)+ay)*nz)<=1.3
      && (position.getX(i)-ax)*tx+(position.getZ(i)+ay)*tz>=-.1
      && (position.getX(i)-ax)*tx+(position.getZ(i)+ay)*tz<=L+.1);
    (onFront ? front : other).push(...tri);
  }
  return [{indices:front,front:true},{indices:other,front:false}].filter(p=>p.indices.length);
}

function pickMaterial(seed, height, archetype, facade = null, osmId = null, home = false, feature = null) {
  const fit = feature ? frontageFitFor(feature) : null;
  const assignment = fit?.appearance?.material && fit.appearance.material !== "unknown"
    ? { class: fit.appearance.material, basis: "reviewed_image_visual_fit" }
    : osmId == null ? null : (MATERIAL_ASSIGNMENTS.assigned || {})[String(osmId)];
  // A class read off this building's photographs: the matcher's at 0.70 and up, CLIP's where
  // its reading was clear (scripts/build_material_assignments.py decided that).
  if (assignment && assignment.class
      && (assignment.basis === "image_clip_zero_shot" || assignment.basis === "reviewed_image_visual_fit" || assignment.confidence >= 0.70) &&
      !(facade && ["glass", "metal"].includes(facade.m) && facade.conf >= 0.6)) {
    const name = PHOTO_CLASS_TO_MATERIAL[assignment.class];
    const photographed = MATERIALS.find((material) => material.name === name);
    if (photographed) return { ...photographed, photoLabel: assignment.class };
  }
  // A class read for this building, below the bar above but still its own reading.
  if (home && assignment && assignment.class && PHOTO_CLASS_TO_MATERIAL[assignment.class]) {
    const named = MATERIALS.find((material) => material.name === PHOTO_CLASS_TO_MATERIAL[assignment.class]);
    if (named) return { ...named, photoLabel: assignment.class };
  }
  if (facade && facade.conf >= FACADE_MATCH_MIN_CONFIDENCE) {
    const matched = MATERIALS.find((m) => m.name === facade.m);
    if (matched) return matched;
  }
  // Every building's wall class, with how sure it is (scripts/build_material_assignments.py):
  // photographed without a texture is smooth render; never photographed, its kind's usual wall.
  const wall = osmId == null ? null : (MATERIAL_ASSIGNMENTS.walls || {})[String(osmId)];
  const walled = wall && MATERIALS.find((m) => m.name === PHOTO_CLASS_TO_MATERIAL[wall[0]]);
  if (walled) {
    return { ...walled, ...(home ? { photoLabel: wall[0] } : {}), wallConfidence: wall[1],
      materialBasis: (MATERIAL_ASSIGNMENTS.wall_bases || {})[wall[2]] || wall[2] };
  }
  // Nothing at all for this building: concrete, rather than a draw from the city's shares.
  const concrete = MATERIALS.find((m) => m.name === PHOTO_CLASS_TO_MATERIAL[DEFAULT_CLADDING]);
  return { ...concrete, ...(home ? { photoLabel: DEFAULT_CLADDING } : {}), materialBasis: "default_concrete_not_inferred" };
}

// A stable pseudo-random from an integer, so a building keeps its colour between reloads. Math
// .random would repaint the city on every refresh, which reads as flicker rather than variety.
function random(seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function facadeTexture() {
  // One storey tall and one bay wide, tiled. Windows are lit at random so a street of identical
  // extrusions stops reading as identical.
  const w = 64, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8d9ea4";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(0, h - 6, w, 6);                      // the floor line between storeys
  for (const x of [10, 36]) {
    const lit = Math.random() < 0.22;
    ctx.fillStyle = lit ? "rgba(255,226,170,0.85)" : "rgba(24,38,44,0.9)";
    ctx.fillRect(x, 12, 18, 34);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(x + 0.5, 12.5, 17, 33);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// A window is not a dark rectangle. It is a recess with a frame, a sill catching light from
// above, and a pane darker at the top than the bottom -- sky reflected at a grazing angle,
// room seen at a steep one. Those three details are most of what makes a facade read.
function pane(ctx, x, y, w, h, lit, seed, options = {}) {
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);                  // the reveal
  const glass = ctx.createLinearGradient(0, y, 0, y + h);
  if (lit) {
    glass.addColorStop(0, "rgba(255,224,168,0.92)");
    glass.addColorStop(1, "rgba(214,168,96,0.80)");
  } else {
    // Sky at the head of the pane, the room behind it at the cill. Neither end is black: this
    // bottomed out at rgba(20,30,36) and the wall's own tint then multiplied it, so a building
    // sampled at a dark grey-green -- the swimming pool on Columbus is one -- came out with two
    // storeys of holes punched in it.
    glass.addColorStop(0, "rgba(152,178,196,0.88)");
    glass.addColorStop(0.5, "rgba(96,118,132,0.90)");
    glass.addColorStop(1, "rgba(66,84,96,0.92)");
  }
  ctx.fillStyle = glass;
  if (options.arched) {
    // A round head. Drawn as a rectangle capped with a half-disc rather than as a path, which
    // keeps it crisp at sixty-four pixels.
    ctx.fillRect(x, y + w / 2, w, h - w / 2);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fillRect(x - 2, y + h, w + 4, 2);                      // the sill
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  for (const bar of options.bars || []) {
    ctx.beginPath();
    if (bar.vertical) { ctx.moveTo(x + w * bar.at, y); ctx.lineTo(x + w * bar.at, y + h); }
    else { ctx.moveTo(x, y + h * bar.at); ctx.lineTo(x + w, y + h * bar.at); }
    ctx.stroke();
  }
}

function trimCourse(ctx, seed, material) {
  // Cornices, belt courses and narrow vertical trim are cheap pixels that make a flat wall read
  // like a built facade. They are intentionally darker/lighter overlays so the building's own
  // sampled colour still drives the facade.
  if (material.name === "glass" || material.name === "metal") return;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 3, 64, 2);
  ctx.fillRect(0, 54, 64, 1);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, 6, 64, 1);
  ctx.fillRect(0, 58, 64, 2);
  if (random(seed + 41) < 0.55) {
    ctx.fillStyle = "rgba(255,255,255,0.13)";
    for (const x of [3, 60]) ctx.fillRect(x, 0, 1, 64);
  }
  if (random(seed + 47) < 0.34) {
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 14; y < 58; y += 16) ctx.fillRect(0, y, 64, 1);
  }
}

//: A dozen ways a San Francisco facade arranges its openings. The city is bay windows, sash
//: pairs and the odd punched warehouse wall, and drawing every building with the same two
//: sash windows made a street of identical houses -- which is the one thing San Francisco's
//: streets are not.
const WINDOW_STYLES = [
  function pairSash(ctx, seed) {
    for (const x of [9, 35]) {
      pane(ctx, x, 12, 18, 32, random(seed + x) < 0.16, seed,
           { bars: [{ vertical: false, at: 0.5 }] });
    }
  },
  function singleWide(ctx, seed) {
    pane(ctx, 8, 14, 46, 28, random(seed + 3) < 0.18, seed,
         { bars: [{ vertical: true, at: 0.5 }] });
  },
  function triple(ctx, seed) {
    for (const x of [7, 25, 43]) pane(ctx, x, 14, 13, 30, random(seed + x) < 0.14, seed);
  },
  function bayWindow(ctx, seed) {
    // The city's signature. The returns either side are shaded, which is what gives it depth.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(6, 8, 50, 40);
    pane(ctx, 20, 12, 24, 32, random(seed + 5) < 0.2, seed);
    pane(ctx, 9, 14, 9, 28, random(seed + 9) < 0.12, seed);
    pane(ctx, 46, 14, 9, 28, random(seed + 13) < 0.12, seed);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(5, 47, 54, 3);                              // the bay's own sill course
  },
  function arched(ctx, seed) {
    for (const x of [10, 36]) {
      pane(ctx, x, 12, 18, 32, random(seed + x) < 0.15, seed, { arched: true });
    }
  },
  function tallNarrow(ctx, seed) {
    for (const x of [12, 38]) pane(ctx, x, 8, 14, 42, random(seed + x) < 0.16, seed);
  },
  function squarePair(ctx, seed) {
    for (const x of [12, 38]) pane(ctx, x, 16, 16, 16, random(seed + x) < 0.2, seed);
  },
  function frenchDoors(ctx, seed) {
    pane(ctx, 14, 8, 36, 40, random(seed + 7) < 0.22, seed,
         { bars: [{ vertical: true, at: 0.5 }, { vertical: false, at: 0.35 }] });
    ctx.strokeStyle = "rgba(255,255,255,0.34)";              // the balcony rail
    ctx.lineWidth = 1;
    for (let x = 12; x < 52; x += 4) {
      ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x, 50); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(11, 34); ctx.lineTo(53, 34); ctx.stroke();
  },
  function gridFour(ctx, seed) {
    for (const x of [10, 36]) {
      for (const y of [10, 30]) pane(ctx, x, y, 18, 16, random(seed + x + y) < 0.14, seed);
    }
  },
  function punched(ctx, seed) {
    pane(ctx, 24, 18, 16, 18, random(seed + 11) < 0.1, seed);
  },
  function oriel(ctx, seed) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(8, 6, 48, 44);
    pane(ctx, 12, 12, 40, 30, random(seed + 17) < 0.2, seed,
         { bars: [{ vertical: true, at: 0.33 }, { vertical: true, at: 0.66 }] });
    ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.fillRect(7, 5, 50, 3);                               // the cornice over it
  },
  function shuttered(ctx, seed) {
    for (const x of [11, 37]) {
      pane(ctx, x, 13, 16, 30, random(seed + x) < 0.13, seed);
      ctx.fillStyle = "rgba(0,0,0,0.24)";                    // shutters folded back
      ctx.fillRect(x - 5, 12, 4, 32);
      ctx.fillRect(x + 17, 12, 4, 32);
    }
  },
];

//: The photographed materials and the facade canvases painted from them, held once for the page
//: and every window streamed into it: each window's code is this module run again, and with its
//: own maps each one decoded the photographs and painted every facade anew -- seconds of a
//: build, and a texture a facade a window on the GPU. Shared textures are not disposed with a
//: window (disposeTree) and the maps are not emptied with one (release).
const SHARED_FACADES = globalThis.__kerbsideFacades ??= { photos: new Map(), facades: new Map(), bare: new Map() };
const PHOTO_MATERIAL_IMAGES = SHARED_FACADES.photos;

//: Photographed materials that are painted or stained in life -- the house's own colour is the
//: paint -- against those whose colour is the material itself. A painted one is drawn as its
//: photograph's light and shade only, on which the building's measured colour is laid in full;
//: brick and stone keep their photographed colour, with only a hint of the building's.
const PAINTABLE_PHOTO_CLASSES = new Set(["stucco_render", "wood_siding", "concrete", "vinyl_siding",
  "wood_shingle", "board_and_batten", "painted_brick"]);
//: The mean of a painted material's light and shade: a little under white, so the building's
//: colour reads as itself with the grain of the material over it.
const PAINTABLE_DETAIL_MEAN = 0.86;
function toPaintableDetail(ctx, canvas) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const mean = sum / (px.length / 4) || 1;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const v = Math.max(0, Math.min(255, lum / mean * PAINTABLE_DETAIL_MEAN * 255));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
}
function facadeFor(material, seed, style, variant = 0, withWindows = true) {
  // One canvas per material and window arrangement, not per building. A few hundred buildings
  // share a few dozen textures, and the rest of the variation comes from the tint.
  const w = 64, h = 64;
  const materialClass = material.photoLabel || null;
  const photos = (PHOTO_MATERIAL_IMAGES.get(materialClass) || []).filter(Boolean);
  const photo = photos.length ? photos[variant % photos.length] : null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = materialClass ? 256 : 64;
  const ctx = canvas.getContext("2d");
  ctx.scale(canvas.width / w, canvas.height / h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  if (photo) ctx.drawImage(photo, 0, 0, w, h);
  if (photo && (PAINTABLE_PHOTO_CLASSES.has(materialClass) || material.neutralColourDetail)) toPaintableDetail(ctx, canvas);

  if (!photo && material.name === "brick") {
    // Courses, offset every other row. Coarse at this scale, but it is the pattern the eye
    // reads as brick from across a street.
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
      const offset = (y / 4) % 2 ? 4 : 0;
      for (let x = offset; x < w; x += 8) ctx.fillRect(x, y, 1, 4);
    }
  } else if (!photo && material.name === "glass") {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 2);
  }

  // A bare/photo wall is not evidence of a floor-height dark trim band.
  if(withWindows) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, h - 5, w, 5);
  }
  if (withWindows && material.name !== "glass" && material.name !== "metal") {
    WINDOW_STYLES[style % WINDOW_STYLES.length](ctx, seed);
    trimCourse(ctx, seed, material);
  }

  // Grit. Weathering, soot and patching, which is most of what separates a real wall from a
  // flat fill at this distance.
  for (let i = 0; !photo && i < w * h * material.grit; i += 1) {
    ctx.fillStyle = random(seed + i) < 0.5 ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.13)";
    ctx.fillRect(random(seed + i * 3) * w, random(seed + i * 7) * h, 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (photo) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const FACADE_CACHE = SHARED_FACADES.facades;
const bareWallMaps = SHARED_FACADES.bare;
function facadeTextureFor(material, seed) {
  // Twelve window arrangements times three lighting draws per material: enough that a terrace
  // of forty houses has no two the same next to each other, and few enough that the whole city
  // shares a few dozen canvases.
  const style = Math.floor(random(seed + 3) * WINDOW_STYLES.length);
  const variant = Math.floor(random(seed) * MATERIAL_VARIANTS);
  const key = `${material.name}-${material.photoLabel || "prior"}-${material.neutralColourDetail ? "band" : "original"}-${style}-${variant}`;
  if (!FACADE_CACHE.has(key)) {
    const effectiveSeed = seed + variant * 977;
    const texture = facadeFor(material, effectiveSeed, style, variant);
    texture.userData = { material, seed: effectiveSeed, style, variant, shared: true };
    FACADE_CACHE.set(key, texture);
  }
  return FACADE_CACHE.get(key);
}

//: Claddings whose pattern is the material itself, so a house keeps it: courses of brick, laid
//: stone, tile. Everything else on a house -- stucco, plaster, siding, painted anything, and
//: walls nobody photographed -- is one colour (HOUSE_FLAT_WALL): a photographed stucco's light
//: and shade laid under the paint read as blotches of other shades, which is not how a painted
//: house looks from the street.
const HOUSE_PATTERNED_CLASSES = new Set(["brick", "stone", "ceramic_tile"]);
let HOUSE_FLAT_WALL = null;
function houseWallIsFlat(material) {
  return !HOUSE_PATTERNED_CLASSES.has(material.photoLabel) && material.name !== "brick" && material.name !== "stone";
}

//: The same wall as facadeTextureFor -- the same material, variant and seed -- with no windows
//: painted on it. A house is drawn on this, its windows real ones (homeWindowLayout), so the
//: house the street sees and the house the walker opens are one surface.
function bareFacadeTextureFor(material, seed) {
  if (houseWallIsFlat(material)) {
    if (!HOUSE_FLAT_WALL) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 4, 4);
      HOUSE_FLAT_WALL = new THREE.CanvasTexture(canvas);
      HOUSE_FLAT_WALL.wrapS = HOUSE_FLAT_WALL.wrapT = THREE.RepeatWrapping;
      HOUSE_FLAT_WALL.userData = { flat: true };
    }
    return HOUSE_FLAT_WALL;
  }
  const variant = Math.floor(random(seed) * MATERIAL_VARIANTS);
  const key = `${material.name}-${material.photoLabel || "prior"}-${material.neutralColourDetail ? "band" : "original"}-${variant}-bare`;
  if (!bareWallMaps.has(key)) {
    const effectiveSeed = seed + variant * 977;
    const texture = facadeFor(material, effectiveSeed, 0, variant, false);
    texture.userData = { material, seed: effectiveSeed, style: 0, variant, bare: true, shared: true };
    bareWallMaps.set(key, texture);
  }
  return bareWallMaps.get(key);
}

async function loadPhotoMaterialLibrary() {
  let manifest;
  try {
    const response = await fetch(sharedAsset("materials/manifest.json"), { cache: "no-cache" });
    if (!response.ok) return;
    manifest = await response.json();
  } catch (_) { return; }
  const used = new Set([...Object.values(MATERIAL_ASSIGNMENTS.assigned || {})
    .map((assignment) => assignment.class), DEFAULT_CLADDING,
    ...Object.values(FRONTAGE_FITS.buildings || {}).flatMap(f=>(f.appearance?.bands || []).map(b=>b.material))]);
  const byClass = new Map();
  for (const row of manifest.assets || []) {
    if (!used.has(row.material_class) || row.license !== "CC0-1.0") continue;
    if (!byClass.has(row.material_class)) byClass.set(row.material_class, []);
    byClass.get(row.material_class).push(row);
  }
  for (const [materialClass, rows] of byClass) {
    for (let variant = 0; variant < Math.min(MATERIAL_VARIANTS, rows.length); variant += 1) {
      // Decoded already, for the page or an earlier window: the shared facades are painted with it.
      if (PHOTO_MATERIAL_IMAGES.get(materialClass)?.[variant]) continue;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = sharedAsset(`materials/${rows[variant].file}`);
      try { await image.decode(); } catch (_) { continue; }
      if (!PHOTO_MATERIAL_IMAGES.has(materialClass)) PHOTO_MATERIAL_IMAGES.set(materialClass, []);
      PHOTO_MATERIAL_IMAGES.get(materialClass)[variant] = image;
      for (const texture of [...FACADE_CACHE.values(), ...bareWallMaps.values()]) {
        const spec = texture.userData || {};
        // Every texture of the class: a variant beyond the photographs there are takes one of
        // them (facadeFor), and which it takes changes as they arrive.
        if (spec.material?.photoLabel !== materialClass) continue;
        const repainted = facadeFor(spec.material, spec.seed, spec.style, spec.variant, !spec.bare);
        texture.image = repainted.image;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        repainted.dispose();
      }
      await nextFrame();
    }
  }
}

// The photographed materials are laid on after the city is built and drawing (see animate's
// caller): decoding forty-odd photographs in the middle of the build was a second at once of
// every core, on top of the build itself.


const ROOF_CACHE = new Map();

function southWindowTexture(seed) {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (let y = 14; y < 112; y += 34) {
    ctx.fillRect(0, y - 7, 128, 2);
    for (let x = 12; x < 118; x += 28) {
      const lit = random(seed + x * 3 + y * 7) < 0.18;
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(x - 3, y - 3, 20, 26);
      const glass = ctx.createLinearGradient(0, y, 0, y + 22);
      glass.addColorStop(0, lit ? "rgba(255,228,176,0.82)" : "rgba(128,158,176,0.78)");
      glass.addColorStop(1, lit ? "rgba(202,148,82,0.74)" : "rgba(62,82,94,0.88)");
      ctx.fillStyle = glass;
      ctx.fillRect(x, y, 14, 20);
      ctx.strokeStyle = "rgba(255,255,255,0.24)";
      ctx.strokeRect(x - 1.5, y - 1.5, 17, 23);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillRect(x - 2, y + 21, 18, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const SOUTH_WINDOW_CACHE = new Map();
function southWindowTextureFor(seed) {
  const key = Math.floor(random(seed + 211) * 8);
  if (!SOUTH_WINDOW_CACHE.has(key)) SOUTH_WINDOW_CACHE.set(key, southWindowTexture(seed + key * 313));
  return SOUTH_WINDOW_CACHE.get(key);
}

function entryTexture(seed, archetype) {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.fillRect(0, 118, 128, 6);

  // The door of a house. Shops, offices and hotels have their storefronts drawn for what
  // they are (see addStorefronts); this is the front door and the step.
  {
    const paint = random(seed + 7) < 0.5 ? "#244a61" : random(seed + 9) < 0.5 ? "#7a3d35" : "#315b43";
    ctx.fillStyle = "rgba(0,0,0,0.24)";
    ctx.fillRect(44, 26, 40, 86);
    ctx.fillStyle = paint;
    ctx.fillRect(48, 30, 32, 82);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(50, 32, 28, 2);
    ctx.fillStyle = "rgba(45,32,22,0.92)";
    ctx.fillRect(51, 66, 26, 44);
    ctx.fillStyle = "rgba(238,220,166,0.78)";
    ctx.fillRect(70, 79, 3, 3);
    ctx.fillStyle = "rgba(120,154,170,0.78)";
    ctx.fillRect(52, 36, 24, 20);
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.strokeRect(51.5, 35.5, 25, 21);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fillRect(34, 112, 60, 5);
    ctx.fillStyle = "rgba(185,180,166,0.78)";
    ctx.fillRect(38, 104, 52, 8);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const ENTRY_CACHE = new Map();
function entryTextureFor(seed, archetype) {
  const key = `${archetype || "generic"}-${Math.floor(random(seed + 331) * 10)}`;
  if (!ENTRY_CACHE.has(key)) ENTRY_CACHE.set(key, entryTexture(seed + key.length * 41, archetype));
  return ENTRY_CACHE.get(key);
}

const FACADE_TEXTURE = facadeTexture();

function roadTexture() {
  // Asphalt, and nothing else.
  //
  // This used to carry saw-cut joints at a four-and-a-half metre grid with a pale lip along
  // each one, and made-good patches scattered through it. Both are real things a San Francisco
  // street has, and both were a mistake here: the joints tiled with the texture rather than
  // with the road, so every segment showed the same grid in the same place and the carriageway
  // read as a floor of grey squares with a lighter edge on each. A road seen from above is
  // near enough uniform, and uniform is what it should be.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101214";
  ctx.fillRect(0, 0, size, size);
  // Grain only, at a single pixel, so there is texture at walking distance and nothing that
  // resolves into a pattern from above.
  for (let i = 0; i < size * size * 0.55; i += 1) {
    const shade = random(i * 7);
    ctx.fillStyle = shade < 0.62 ? "rgba(0,0,0,0.30)"
      : shade < 0.94 ? "rgba(255,255,255,0.030)" : "rgba(140,150,155,0.055)";
    ctx.fillRect(random(i * 3) * size, random(i * 5) * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const ROAD = roadTexture();
//: Spacing of the saw cuts, in metres. Four and a half is a common bay for a concrete street.
const ROAD_SLAB_M = 4.5;

//: A raised median is neither pavement nor paint.  This is a small cast-concrete road tile:
//: warm enough to separate from the white lane markings, with fine aggregate and a restrained
//: 1.2 m casting joint.  UVs are measured in metres below, so a hundred-metre divider repeats
//: this tile instead of stretching one blurry square along its whole length.
const DIVIDER_TILE_M = 1.2;
const DIVIDER_HEIGHT_M = 0.16;
function dividerBlockTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#aaa89e";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.16; i += 1) {
    const pale = random(i * 31) > 0.76;
    ctx.fillStyle = pale ? "rgba(255,255,245,0.11)" : "rgba(35,38,38,0.12)";
    const grain = random(i * 17) > 0.94 ? 2 : 1;
    ctx.fillRect(random(i * 7) * size, random(i * 13) * size, grain, grain);
  }
  // A narrow recessed casting joint survives at map distance without turning the median into
  // a chequerboard.  Matching opposite edges keeps the texture seamless in both directions.
  ctx.fillStyle = "rgba(48,50,49,0.26)";
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, 0, 2, size);
  ctx.fillStyle = "rgba(245,242,226,0.15)";
  ctx.fillRect(2, 2, size - 2, 1);
  ctx.fillRect(2, 2, 1, size - 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const DIVIDER_BLOCK = dividerBlockTexture();

function crossingTexture() {
  // Continental bars: each stripe crosses the width of the crosswalk, so a person walking the
  // way steps over one after another. The paint is transparent between bars so the asphalt
  // remains visible instead of the crossing becoming one solid slab.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  // The tile is one bar and one gap along u, the walking direction.
  // The bar itself. Thermoplastic goes down bright and stays brighter than the road for years,
  // so it is nearly white rather than the dull cream it was.
  ctx.fillStyle = "rgba(244, 245, 240, 0.97)";
  ctx.fillRect(1, 0, size * 0.5 - 2, size);
  // Wear, concentrated where tyres cross it rather than sprayed evenly over the paint. A bar
  // that is uniformly speckled reads as dirty card; a bar worn in two tracks reads as a road
  // marking that has had a year of traffic over it.
  for (const track of [0.22, 0.7]) {
    for (let i = 0; i < size * 6; i += 1) {
      const x = (track + (random(i * 11) - 0.5) * 0.20) * size;
      const y = random(i * 5) * size;
      ctx.fillStyle = random(i * 9) < 0.72 ? "rgba(24,26,28,0.30)" : "rgba(255,255,255,0.16)";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // The bar ends where it ends. It used to be given a sprinkle of half-transparent pixels
  // along each edge -- "paint sprayed against a screed" -- and, mipmapped and viewed at a
  // grazing angle, that read as bars fading into the asphalt. Thermoplastic is laid to a
  // line; the cutoff is hard.
  return hardPaintTexture(canvas);
}

function hardPaintTexture(canvas) {
  // A road-paint texture drawn crisp: no filtering across the paint's edge, and the
  // anisotropy to keep a bar a bar down the length of a street.
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  return texture;
}

function crossingEdgeTexture() {
  // A marked crossing that is not continental is two lines across the road and bare asphalt
  // between them. Painting ladder bars on those was inventing a marking the street does not
  // have -- and continental crossings are the minority: the city's inventory lists 1,415 of
  // them against 2,517 crossings in this corridor.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const bar = size * 0.085;
  ctx.fillStyle = "rgba(244, 245, 240, 0.96)";
  ctx.fillRect(0, 0, size, bar);
  ctx.fillRect(0, size - bar, size, bar);
  for (let i = 0; i < size * 4; i += 1) {
    const y = random(i * 5) < 0.5 ? random(i * 3) * bar : size - bar + random(i * 3) * bar;
    ctx.fillStyle = random(i * 9) < 0.7 ? "rgba(24,26,28,0.28)" : "rgba(255,255,255,0.14)";
    ctx.fillRect(random(i * 7) * size, y, 1, 1);
  }
  return hardPaintTexture(canvas);
}

const CROSSING_EDGES = crossingEdgeTexture();

function crossingMarkingKind(way) {
  const markings = String(way.crossing_markings || "").toLowerCase();
  const crossing = String(way.crossing_type || "").toLowerCase();
  const resolved = String(way.resolved_crossing_marking || "").toLowerCase();
  if (["no", "none", "unmarked"].includes(markings)
      || ["no", "unmarked"].includes(crossing) || resolved === "unmarked") return null;
  if ((way.continental && way.continental_source !== "default_continental")
      || ["zebra", "ladder", "continental"].includes(markings)
      || crossing === "zebra") return "crossing";
  if (["lines", "parallel", "transverse", "crossing_edges"].includes(markings)) {
    return "crossing_edges";
  }
  if (resolved === "continental") return "crossing";
  if (resolved === "parallel") return "crossing_edges";
  return null;
}

//: Six garage doors. Four are painted the house's own colour -- a door is part of the house and
//: is nearly always painted to match it -- with their panel pattern drawn in white on a dark
//: house and black on a light one: a grid of small raised panels, long horizontal panels, a
//: carriage-house board door, and panels under a row of lights. Two are stained wood, their
//: pattern lines a darker shade of the same wood.
const GARAGE_STYLES = 6;
//: A roller door's clear height. San Francisco's ground-floor garages sit just under three
//: metres; the city records the width of every cut but not its height.
const GARAGE_HEIGHT_M = 2.7;
const GARAGE_WOODS = ["#8a5a35", "#a46f43", "#6f4a2e", "#b8875a"];

function garageTexture(variant, base) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const wood = variant >= 4;
  // A wood door takes its stain from the colour bucket, so neighbouring houses differ.
  const fill = wood ? GARAGE_WOODS[parseInt(base.slice(1, 3), 16) % GARAGE_WOODS.length] : base;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  const rgb = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16) / 255);
  const light = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.5;
  // The pattern's lines: white on a dark door, black on a light one; on wood, darker wood.
  const shade = (k) => "#" + rgb.map((v) => Math.min(255, Math.round(v * k * 255)).toString(16).padStart(2, "0")).join("");
  const line = wood ? shade(0.62) : light ? "rgba(20,20,20,0.85)" : "rgba(250,250,246,0.9)";
  const soft = wood ? shade(0.8) : light ? "rgba(20,20,20,0.35)" : "rgba(250,250,246,0.35)";
  ctx.lineWidth = 2;
  if (wood) {
    // Grain: long streaks in lighter and darker tones of the stain.
    for (let i = 0; i < 260; i += 1) {
      ctx.strokeStyle = random(i * 17) < 0.5 ? shade(0.86) : shade(1.12);
      ctx.globalAlpha = 0.25 + random(i * 5) * 0.3;
      const y = random(i * 3) * size;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + random(i * 7) * 3 - 1.5, size * 0.7, y - random(i * 11) * 3 + 1.5, size, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
  }
  const grid = (cols, rows, top = 0) => {
    // Raised panels: each a rectangle outlined in the line colour, with a soft inner bevel.
    const pw = size / cols, ph = (size - top) / rows;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = c * pw + 4, y = top + r * ph + 4;
        ctx.strokeStyle = line;
        ctx.strokeRect(x, y, pw - 8, ph - 8);
        ctx.strokeStyle = soft;
        ctx.strokeRect(x + 4, y + 4, pw - 16, ph - 16);
      }
    }
  };
  if (variant === 0) {
    grid(4, 6);                                         // a grid of small raised panels
  } else if (variant === 1) {
    grid(1, 4);                                         // long horizontal panels
    ctx.strokeStyle = soft;
    for (let y = size / 8; y < size; y += size / 4) { ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(size - 6, y); ctx.stroke(); }
  } else if (variant === 2) {                           // carriage house: boards, two leaves, braces
    ctx.strokeStyle = soft;
    for (let x = 8; x < size; x += 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
    ctx.strokeStyle = line;
    ctx.strokeRect(4, 4, size / 2 - 6, size - 8);
    ctx.strokeRect(size / 2 + 2, 4, size / 2 - 6, size - 8);
    for (const x0 of [4, size / 2 + 2]) {
      ctx.beginPath(); ctx.moveTo(x0, size - 4); ctx.lineTo(x0 + size / 2 - 6, 4); ctx.stroke();
    }
  } else if (variant === 3) {                           // panels under a row of lights
    const top = size * 0.24;
    for (let c = 0; c < 4; c += 1) {
      const x = c * size / 4 + 6;
      ctx.fillStyle = "rgba(38,50,58,0.92)";
      ctx.fillRect(x, 8, size / 4 - 12, top - 14);
      ctx.strokeStyle = line;
      ctx.strokeRect(x, 8, size / 4 - 12, top - 14);
    }
    grid(4, 3, top);
  } else if (variant === 4) {
    grid(4, 6);                                         // wood, small panels in darker wood
  } else {
    grid(2, 4);                                         // wood, large panels in darker wood
  }
  // The frame, and a little wear, so the door does not read as a flat sticker.
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  for (let i = 0; i < size * 6; i += 1) {
    ctx.fillStyle = random(i * 7) < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(random(i * 3) * size, random(i * 5) * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const GARAGE_CACHE = new Map();
function garageTextureFor(variant, tint) {
  // Keyed on the colour quantised to three levels a channel. A door painted the house's exact
  // shade and a door two per cent off it are the same door; twenty-seven buckets times six
  // designs is a few dozen canvases for fourteen thousand garages.
  // Quantised in sRGB, where the eye lives. Quantising the linear components to three levels
  // turned a grey-pink house (#8b8082: linear 0.26, 0.21, 0.23) into (0.5, 0, 0) -- a pure red
  // door on a grey house, at random, across the corridor.
  const colour = new THREE.Color(tint);
  const srgb = { r: 0, g: 0, b: 0 };
  colour.getRGB(srgb, THREE.SRGBColorSpace);
  const bucket = [srgb.r, srgb.g, srgb.b].map((v) => Math.round(v * 3) / 3);
  const key = `${variant}-${bucket.join(",")}`;
  if (!GARAGE_CACHE.has(key)) {
    const hex = "#" + bucket.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    GARAGE_CACHE.set(key, garageTexture(variant, hex));
  }
  return GARAGE_CACHE.get(key);
}

//: How far the dropped kerb flares either side of the driveway itself. A cut is not a
//: rectangle taken out of the kerb: it runs down over a wing at each end, which is why a real
//: apron is wider at the gutter than at the back of the footway.
const APRON_FLARE_M = 0.35;

//: The top of the footway, which is where anything laid on the pavement has to sit.
function roadSurfaceTop() { return 0.06 + KERB_FALLBACK; }

