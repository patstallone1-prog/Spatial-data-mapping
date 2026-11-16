// Three.js is supplied by Kerbside; this module has no independent runtime dependency.
// Local x/y input becomes scene x/-z. Canonical footprints/heights are never rewritten.

function clip(vertices, distance, keepPositive) {
  const result = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const da = distance(a), db = distance(b);
    const ina = keepPositive ? da >= -1e-9 : da <= 1e-9;
    const inb = keepPositive ? db >= -1e-9 : db <= 1e-9;
    if (ina) result.push(a);
    if (ina !== inb) {
      const t = da / (da - db), mixed = {};
      for (const key of Object.keys(a)) mixed[key] = a[key].map((v, j) => v + (b[key][j] - v) * t);
      result.push(mixed);
    }
  }
  return result;
}

function outsideRectangle(vertices, project, rectangle) {
  let remainder = vertices;
  const pieces = [];
  for (const distance of [
    v => project(v)[0] - rectangle[0], v => rectangle[1] - project(v)[0],
    v => project(v)[1] - rectangle[2], v => rectangle[3] - project(v)[1],
  ]) {
    const outside = clip(remainder, distance, false);
    if (outside.length >= 3) pieces.push(outside);
    remainder = clip(remainder, distance, true);
    if (!remainder.length) break;
  }
  return pieces;
}

/** Remove only replaced wall bands, retaining roof groups and interpolated UVs/normals. */
export function cutExteriorWallBands(THREE, geometry, plan, origin = {x: 0, y: 0, z: 0}) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const names = Object.keys(source.attributes), arrays = Object.fromEntries(names.map(n => [n, []]));
  const groups = source.groups.length ? source.groups : [{start: 0, count: source.attributes.position.count, materialIndex: 0}];
  const result = new THREE.BufferGeometry();
  let offset = 0;
  for (const group of groups) {
    const start = offset;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      let pieces = [Array.from({length: 3}, (_, j) => Object.fromEntries(names.map(n => {
        const a = source.attributes[n];
        return [n, Array.from({length: a.itemSize}, (_, k) => a.array[(i + j) * a.itemSize + k])];
      })))];
      if (group.materialIndex !== 0) for (const f of plan.facades) {
        const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
        const tx = (f.b[0] - f.a[0]) / L, ty = (f.b[1] - f.a[1]) / L;
        const position = v => [v.position[0] - origin.x - f.a[0], -(v.position[2] - origin.z) - f.a[1]];
        const project = v => {
          const [x, y] = position(v);
          return [x * tx + y * ty, v.position[1] - origin.y];
        };
        pieces = pieces.flatMap(poly => poly.every(v => {
          const [x, y] = position(v); return Math.abs(x * -ty + y * tx) < 0.003;
        }) ? outsideRectangle(poly, project, [f.u0, f.u1, 0, f.band_height_m]) : [poly]);
      }
      for (const poly of pieces) for (let j = 1; j < poly.length - 1; j++) {
        const tri = [poly[0], poly[j], poly[j + 1]];
        const [a, b, c] = tri.map(v => new THREE.Vector3(...v.position));
        if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq() < 1e-16) continue;
        for (const v of tri) for (const name of names) arrays[name].push(...v[name]);
        offset += 3;
      }
    }
    if (offset > start) result.addGroup(start, offset - start, group.materialIndex);
  }
  for (const name of names) result.setAttribute(name, new THREE.Float32BufferAttribute(arrays[name], source.attributes[name].itemSize));
  result.computeBoundingBox(); result.computeBoundingSphere();
  if (source !== geometry) source.dispose();
  return result;
}

function faceMatrix(THREE, f) {
  const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
  const x = (f.b[0] - f.a[0]) / L, y = (f.b[1] - f.a[1]) / L;
  return new THREE.Matrix4().set(x, 0, f.normal[0], f.a[0], 0, 1, 0, 0, -y, 0, -f.normal[1], -f.a[1], 0, 0, 0, 1);
}

function holePath(THREE, o, band) {
  const p = new THREE.Path(), u = o.u, v = Math.max(0, o.v), top = Math.min(band, o.v + o.h);
  const arch = o.shape === 'arched' || o.design?.shape === 'arched';
  const rise = arch ? Math.min(o.h * 0.32, o.w / 2, o.arch_rise_m ?? o.h * 0.25) : 0;
  p.moveTo(u, v); p.lineTo(u, top - rise);
  if (rise) p.quadraticCurveTo(u + o.w / 2, top + rise, u + o.w, top - rise);
  else p.lineTo(u + o.w, top);
  p.lineTo(u + o.w, v); p.closePath();
  return p;
}

export class Batch {
  constructor(THREE) {this.THREE = THREE; this.parts = new Map();}
  add(g, m, matrix) {
    const q = g.index ? g.toNonIndexed() : g.clone(); q.applyMatrix4(matrix); g.dispose();
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m).push(q);
  }
  finish(group, evidence) {
    for (const [material, list] of this.parts) {
      const g = new this.THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv', 'color']) {
        const rows = list.map(p => p.attributes[name]);
        if (rows.some(a => !a)) continue;
        const data = new Float32Array(rows.reduce((n, a) => n + a.array.length, 0));
        let offset = 0; for (const row of rows) {data.set(row.array, offset); offset += row.array.length;}
        g.setAttribute(name, new this.THREE.BufferAttribute(data, rows[0].itemSize));
      }
      g.computeBoundingSphere();
      const mesh = new this.THREE.Mesh(g, material);
      mesh.castShadow = !material.transparent; mesh.receiveShadow = true;
      mesh.userData = {surface: 'inferred_storefront', evidence, canonicalGeometryModified: false};
      group.add(mesh); for (const p of list) p.dispose();
    }
  }
}

//: A sign's lettering, laid out on the 1536 x 256 board it always was -- the same size, the same
//: place -- but drawn on a canvas only as big as the letters and their glow. The board around them
//: was clear: 1.5 MB of nothing a sign, twice (the canvas and the GPU's copy), 243 signs half a
//: gigabyte. The texture's repeat and offset put the letters back where the full board had them,
//: and the clear margin kept round them is what the plane shows past their edges.
export const SIGN_BOARD = [1536, 256];
export function signLettering(THREE, text, ink, weight, font, glow = null, makeCanvas = () => document.createElement('canvas')) {
  const [W, H] = SIGN_BOARD;
  const probe = makeCanvas(); probe.width = probe.height = 1;
  const p = probe.getContext('2d');
  let size = 150; p.font = `${weight} ${size}px ${font}`;
  while (p.measureText(text).width > 1430 && size > 24) {size -= 2; p.font = `${weight} ${size}px ${font}`;}
  p.textAlign = 'center'; p.textBaseline = 'middle';
  const m = p.measureText(text), pad = 4 + (glow ? 28 : 0);
  const left = m.actualBoundingBoxLeft ?? m.width / 2, right = m.actualBoundingBoxRight ?? m.width / 2;
  const up = m.actualBoundingBoxAscent ?? size * 0.6, down = m.actualBoundingBoxDescent ?? size * 0.6;
  const x0 = Math.max(0, Math.floor(W / 2 - left - pad)), x1 = Math.min(W, Math.ceil(W / 2 + right + pad));
  const y0 = Math.max(0, Math.floor(H / 2 - up - pad)), y1 = Math.min(H, Math.ceil(H / 2 + down + pad));
  const canvas = makeCanvas(); canvas.width = Math.max(1, x1 - x0); canvas.height = Math.max(1, y1 - y0);
  probe.width = probe.height = 0;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = ink; ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (glow) {ctx.shadowColor = glow; ctx.shadowBlur = 14;}
  ctx.fillText(text, W / 2 - x0, H / 2 - y0);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // Board UV (u, v) -> this canvas: x = u*W - x0, and (flipY) row = (1-v)*H - y0.
  map.repeat.set(W / canvas.width, H / canvas.height);
  map.offset.set(-x0 / canvas.width, (canvas.height - H + y0) / canvas.height);
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.userData.board = {x0, y0, w: canvas.width, h: canvas.height};
  return map;
}

export async function createExteriorRenderer(THREE, assetManifest = {}, assetBase = '', options = {}) {
  const materialCache = new Map(), textures = new Map(), letteringCache = new Map(), missingAssets = [];
  const loader = new THREE.TextureLoader();
  await Promise.all(Object.entries(assetManifest.assets || {}).map(async ([key, row]) => {
    try {
      const url=new URL(row.path,assetBase).href;
      let display=url,blob=null;
      // Some official SVG masters omit intrinsic dimensions. Give their existing
      // viewBox a square display viewport; keep the archived artwork bytes intact.
      if(row.display_size_px){
        const raw=await fetch(url,{cache:'no-store'}).then(r=>r.text());
        const dom=new DOMParser().parseFromString(raw,'image/svg+xml');
        dom.documentElement.setAttribute('width',String(row.display_size_px[0]));
        dom.documentElement.setAttribute('height',String(row.display_size_px[1]));
        blob=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(dom)],{type:'image/svg+xml'}));display=blob;
      }
      const texture = await loader.loadAsync(display);
      if(blob)URL.revokeObjectURL(blob);
      if (row.display_box_px) {
        const [x,y,w,h] = row.display_box_px, W=texture.image.width, H=texture.image.height;
        texture.repeat.set(w/W,h/H);texture.offset.set(x/W,(H-y-h)/H);
        texture.userData.displayAspect=w/h;
      }
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; textures.set(key, texture);
    } catch {missingAssets.push(key);}
  }));
  const material = (color, roughness = 0.78, metalness = 0) => {
    const key = [color, roughness, metalness].join('|');
    if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({color, roughness, metalness, side: THREE.DoubleSide}));
    return materialCache.get(key);
  };
  const signMaterial = (face, sign) => {
    const key = ['sign',face.name,sign.text,sign.kind,sign.asset,sign.illumination,sign.ink,face.palette.accent,face.economics.tier].join('|');
    if (materialCache.has(key)) return materialCache.get(key);
    let map = textures.get(sign.asset);
    if (!map) {
      const quiet = ['plaque', 'entry_letters', 'door_vinyl'].includes(sign.kind);
      const serif = !face.brand && ['restaurant', 'books', 'bakery', 'hotel'].includes(face.category);
      const onWall=['painted_letters','entry_letters','door_vinyl','channel_letters'].includes(sign.kind);
      const darkBackground=face.identity_band && new THREE.Color(face.identity_band.colour).getHSL({}).l<.4;
      const ink = sign.ink || (onWall && !darkBackground ? face.palette.accent : face.palette.letter);
      const brandFonts={trader_joes:'"Cooper Black",Georgia,serif',peets:'Georgia,serif',
        walgreens:'"Brush Script MT","Apple Chancery",cursive',philz:'Georgia,serif'};
      const weight = quiet ? 500 : 700, font = brandFonts[face.brand] || (serif ? 'Georgia, serif' : 'Arial, sans-serif');
      const glow = sign.kind === 'neon' ? face.palette.accent : null;
      // The same lettering on two stores is one picture: a chain's name in the same ink and type.
      const lettering = [sign.text, ink, weight, font, glow].join('|');
      map = letteringCache.get(lettering) || signLettering(THREE, sign.text, ink, weight, font, glow);
      letteringCache.set(lettering, map);
    }
    const m = new THREE.MeshStandardMaterial({map, transparent: true, alphaTest: 0.05,
      roughness: 0.45, side: THREE.DoubleSide, depthWrite: false,
      emissive: sign.illumination === 'none' ? '#000000' : '#ffffff',
      emissiveMap: map, emissiveIntensity: sign.illumination === 'none' ? 0 : 0.32});
    materialCache.set(key, m); return m;
  };
  const mount = (target, plan, origin = {x: 0, y: 0, z: 0}) => {
    if (!plan.validation?.passed) return null;
    const group = new THREE.Group(), batch = new Batch(THREE);
    group.position.set(origin.x, origin.y, origin.z);
    for (const f of plan.facades) {
      const matrix = faceMatrix(THREE, f), p = f.palette;
      const box = (u, v, n, w, h, d, m) => {
        const at = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(u, v, n));
        batch.add(new THREE.BoxGeometry(w, h, d), m, at);
      };
      const plane = (u, v, n, w, h, m) => {
        const at = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(u, v, n));
        if (m.map && matrix.determinant() < 0) at.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
        batch.add(new THREE.PlaneGeometry(w, h), m, at);
      };
      const wall = new THREE.Shape();
      wall.moveTo(f.u0, 0); wall.lineTo(f.u1, 0); wall.lineTo(f.u1, f.band_height_m); wall.lineTo(f.u0, f.band_height_m); wall.closePath();
      for (const o of f.openings) if (o.v < f.band_height_m && o.v + o.h > 0) wall.holes.push(holePath(THREE, o, f.band_height_m));
      let wm = material(p.wall, p.roughness);
      if (f.observed_bands?.length) {
        const key = JSON.stringify(['bands', p.wall, f.observed_bands]);
        if (!materialCache.has(key)) {
          const m = material(p.wall, p.roughness).clone();
          const bands = f.observed_bands.filter(b => /^#[0-9a-f]{6}$/i.test(b.colour || ''));
          m.onBeforeCompile = shader => {
            shader.vertexShader = 'varying float facadeY;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfacadeY = position.y;');
            shader.fragmentShader = 'varying float facadeY;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + bands.map(b => {
              const c = new THREE.Color(b.colour); return `if(facadeY>=${Number(b.bottom_m).toFixed(6)}&&facadeY<${Number(b.top_m).toFixed(6)}) diffuseColor.rgb=vec3(${c.r},${c.g},${c.b});`;
            }).join('\n'));
          };
          m.customProgramCacheKey = () => key; materialCache.set(key, m);
        }
        wm = materialCache.get(key);
      }
      batch.add(new THREE.ShapeGeometry(wall, 16), wm, matrix);
      if(f.identity_band){const b=f.identity_band;plane(b.u+b.w/2,b.v+b.h/2,.02,b.w,b.h,material(b.colour,.62));}
      const frame = material(p.frame, 0.48, 0.36), trim = material(p.base, 0.7);
      for (const o of f.openings) {
        if (o.v >= f.band_height_m) continue; // Upper floors remain in Kerbside's original renderer.
        const u = o.u + o.w / 2, v = o.v + o.h / 2, t = Math.min(0.065, o.w * 0.05);
        const arch = o.shape === 'arched' || o.design?.shape === 'arched';
        const rise = arch ? Math.min(o.h * 0.32, o.w / 2, o.arch_rise_m ?? o.h * 0.25) : 0;
        const glassKey = 'glass|' + p.glass + '|' + (o.privacy_fraction || 0);
        // Plain see-through glass, never three.js's transmission: one transmissive material in
        // view has the renderer draw every opaque thing a second time each frame, into a buffer
        // to refract (measured in City mode, 2026-11-11: 822 of 1,755 draws a frame).
        if (!materialCache.has(glassKey)) materialCache.set(glassKey, new THREE.MeshStandardMaterial({
          color: p.glass, transparent: true, opacity: options.glassOpacity ?? 0.42,
          roughness: 0.1, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false,
        }));
        if (arch) {
          const path = holePath(THREE, o, o.v + o.h);
          const at = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0,0,0.005));
          batch.add(new THREE.ShapeGeometry(new THREE.Shape(path.getPoints(24))), materialCache.get(glassKey), at);
        } else plane(u, v, 0.005, o.w, o.h, materialCache.get(glassKey));
        // Real frame depth, returns, mullions, sills and transoms rather than a painted rectangle.
        box(o.u, v-rise/2, 0.025, t, o.h-rise+t, 0.14, frame); box(o.u+o.w,v-rise/2,0.025,t,o.h-rise+t,0.14,frame);
        box(u, o.v, 0.035, o.w, t, 0.16, frame);
        if (arch) {
          const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(o.u,o.v+o.h-rise,.035),
            new THREE.Vector3(u,o.v+o.h+rise,.035),new THREE.Vector3(o.u+o.w,o.v+o.h-rise,.035));
          batch.add(new THREE.TubeGeometry(curve,24,t/2,6,false),frame,matrix);
        } else box(u,o.v+o.h,.035,o.w,t,.16,frame);
        if (o.component_kind === 'garage') {
          plane(u, v, 0.03, o.w, o.h, material('#8e938f', 0.5, 0.5));
          for (let y = o.v + 0.24; y < o.v + o.h; y += 0.24) box(u, y, 0.06, o.w - 0.03, 0.012, 0.012, frame);
        } else if (o.component_kind === 'door') {
          const leaves = o.leaf_count || (o.w > 1.6 ? 2 : 1);
          if (leaves === 2) box(u, v, 0.045, t, o.h, 0.08, frame);
          const pull = material(p.metal, 0.24, 0.85);
          for (let i = 0; i < leaves; i++) {
            const x = leaves === 2 ? u + (i ? 0.10 : -0.10) : u + o.w * 0.31;
            box(x, o.v + 1.04, 0.15, 0.022, 0.40, 0.025, pull);
            box(x, o.v + 0.88, 0.10, 0.022, 0.022, 0.11, pull);
            box(x, o.v + 1.20, 0.10, 0.022, 0.022, 0.11, pull);
          }
          box(u, o.v + 0.16, 0.06, o.w - t * 2, 0.27, 0.035, frame);
          if(f.door_style==='timber_glazed'){
            const timber=material('#76523b',.7);
            box(o.u+t/2,v,.065,t*1.6,o.h,.055,timber);box(o.u+o.w-t/2,v,.065,t*1.6,o.h,.055,timber);
            box(u,o.v+.38,.065,o.w-t,.4,.055,timber);box(u,o.v+o.h-.04,.065,o.w,.08,.055,timber);
            box(u,o.v+o.h*.77,.06,o.w,.035,.045,timber);
          }
          if(f.door_style==='secure_glazed'){
            box(u,o.v+o.h-.18,.09,.15,.07,.08,pull);
            box(o.u+.13,o.v+1.05,.09,.05,.17,.04,pull);
          }
          if(f.portal_colour){
            const portal=material(f.portal_colour,.5);
            box(o.u-.07,v,.075,.09,o.h+.18,.17,portal);box(o.u+o.w+.07,v,.075,.09,o.h+.18,.17,portal);
            box(u,o.v+o.h+.085,.075,o.w+.23,.09,.17,portal);
          }
          if (o.operation === 'automatic_sliding') box(u, o.v + o.h + 0.035, 0.10, o.w + 0.07, 0.11, 0.18, frame);
        } else {
          if (o.w > 2.4 && f.category !== 'diner') box(u, v, 0.035, t * 0.7, o.h, 0.08, frame);
          if (o.transom_fraction) box(u, o.v + o.h * (1 - o.transom_fraction), 0.04, o.w, t, 0.09, frame);
          if (o.privacy_fraction) plane(u, o.v + o.h * o.privacy_fraction / 2, 0.028, o.w - t, o.h * o.privacy_fraction, material('#c8d1cd', 0.7));
          box(u, o.v - 0.03, 0.07, o.w + 0.14, 0.07, 0.20, trim);
        }
      }
      if(f.barber_pole){
        const b=f.barber_pole,u=b.u+b.w/2,v=b.v+b.h/2;
        box(u,v,.09,.08,b.h+.12,.12,frame);
        const pole=new THREE.CylinderGeometry(b.w/2,b.w/2,b.h,24,24),pos=pole.attributes.position;
        const colours=[];for(let i=0;i<pos.count;i++){
          const angle=Math.atan2(pos.getZ(i),pos.getX(i));
          const k=((angle/(Math.PI*2)+pos.getY(i)*2.7)%1+1)%1;
          const c=new THREE.Color(k<.25?'#b62d34':k<.5?'#faf4df':k<.75?'#284e91':'#faf4df');colours.push(c.r,c.g,c.b);
        }
        pole.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
        if(!materialCache.has('barber-stripes'))materialCache.set('barber-stripes',new THREE.MeshStandardMaterial({vertexColors:true,roughness:.28}));
        batch.add(pole,materialCache.get('barber-stripes'),matrix.clone().multiply(new THREE.Matrix4().makeTranslation(u,v,.24)));
        for(const y of [b.v,b.v+b.h])box(u,y,.24,b.w+.04,.055,b.w+.04,frame);
      }
      // Finish changes stop at the actual door/window apertures.
      const baseHeight = 0.18;
      for (const [a, b] of solidIntervals(f, baseHeight / 2)) box((a + b) / 2, baseHeight / 2, 0.022, b - a, baseHeight, 0.045, trim);
      if (['tile', 'brick', 'painted_wood', 'metal_panel'].includes(f.material)) {
        const pitch = f.material === 'tile' ? 0.22 : f.material === 'brick' ? 0.12 : 0.32;
        for (let y = 0.28; y < f.band_height_m - 0.1; y += pitch) {
          for (const [a, b] of solidIntervals(f, y)) box((a + b) / 2, y, 0.012, b - a, 0.006, 0.012, material(p.base, 0.9));
        }
      }
      for (const sign of f.signs) {
        const u = sign.u + sign.w / 2, v = sign.v + sign.h / 2;
        const panel = ['fascia', 'lightbox', 'neon', 'plaque', 'blade'].includes(sign.kind);
        if (panel) box(u, v, 0.10, sign.w + 0.12, sign.h + 0.10, sign.kind === 'lightbox' ? 0.14 : 0.06, material(sign.asset ? '#f4f1e9' : p.accent, 0.5));
        if (f.identity_stripes && panel && f.identity_band) {
          const texture=textures.get(sign.asset),aspect=texture?.userData.displayAspect || 4;
          const logoW=Math.min(sign.w,sign.h*aspect)+.24,stripe=sign.h*.19;
          for(let i=0;i<3;i++)for(const [a,b]of [[f.u0+.06,u-logoW/2],[u+logoW/2,f.u1-.06]])
            if(b>a)box((a+b)/2,v+(1-i)*(stripe+.025),.18,b-a,stripe,.035,material(f.identity_stripes[i],.5));
        }
        if (sign.canopy) {
          const c = sign.canopy, n = c.depth_m;
          const roof = new THREE.BufferGeometry();
          roof.setAttribute('position', new THREE.Float32BufferAttribute([
            sign.u - 0.06, sign.v + sign.h + c.drop_m, 0,
            sign.u + sign.w + 0.06, sign.v + sign.h + c.drop_m, 0,
            sign.u + sign.w + 0.06, sign.v + sign.h, n,
            sign.u - 0.06, sign.v + sign.h, n,
          ], 3)); roof.setIndex([0, 1, 2, 0, 2, 3]); roof.computeVertexNormals();
          batch.add(roof, material(p.accent, 0.9), matrix);
          box(u, v, n, sign.w + 0.12, sign.h, 0.035, material(p.accent, 0.9));
          box(sign.u, sign.v + sign.h * 0.6, n * 0.45, 0.024, 0.024, n, frame);
          box(sign.u + sign.w, sign.v + sign.h * 0.6, n * 0.45, 0.024, 0.024, n, frame);
        }
        const m = signMaterial(f, sign), map = m.map;
        let w = sign.w, h = sign.h;
        if (textures.has(sign.asset)) {
          // Preserve the supplied logo's aspect. Asset bytes and artwork stay unchanged.
          const aspect = map.userData.displayAspect || map.image.width / map.image.height;
          w = Math.min(w, h * aspect); h = Math.min(h, w / aspect);
        }
        if (sign.kind === 'blade') {
          const at = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(u, v, 0.34)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
          batch.add(new THREE.BoxGeometry(0.65, sign.h + 0.1, 0.045), material(p.accent, 0.5), at);
          const faceAt = at.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.027));
          batch.add(new THREE.PlaneGeometry(0.61, sign.h), m, faceAt);
          box(u, v + sign.h * 0.7, 0.23, 0.04, 0.04, 0.5, frame);
        } else if(sign.brand_layout==='icon_and_wordmark' && textures.has(sign.asset)){
          const iconH=Math.min(sign.h,sign.w/3),extent=Math.min(sign.w,iconH*8),start=u-extent/2,depth=panel?.205:.085;
          const aspect=map.userData.displayAspect||map.image.width/map.image.height,iconW=Math.min(iconH*aspect,extent*.3);
          plane(start+iconW/2,v,depth,iconW,Math.min(iconH,iconW/aspect),m);
          const text=signMaterial(f,{...sign,asset:null,brand_layout:null,ink:panel?p.accent:undefined,text:sign.wordmark||'STARBUCKS'});
          const gap=Math.min(.18,extent*.08);
          plane(start+iconW+gap+(extent-iconW-gap)/2,v,depth,extent-iconW-gap,iconH,text);
        } else if(sign.icon==='arches' && sign.w>sign.h*4){
          // Parametric motif from the reference kit, not archived official logo artwork.
          const extent=Math.min(sign.w,sign.h*12),start=u-extent/2,h=sign.h,depth=panel?.205:.09;
          for(let i=0;i<2;i++){
            const a=start+i*h*.7,b=a+h*.7;
            const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(a,v-h*.5,depth),new THREE.Vector3((a+b)/2,v+h*1.5,depth),new THREE.Vector3(b,v-h*.5,depth));
            batch.add(new THREE.TubeGeometry(curve,24,h*.045,8,false),material('#ffc72c',.4),matrix);
          }
          plane(start+h*1.6+(extent-h*1.6)/2,v,depth,extent-h*1.6,h,m);
        } else {
          if(!textures.has(sign.asset)){const aspect=map.image.width/map.image.height;w=Math.min(w,h*aspect);h=Math.min(h,w/aspect);}
          plane(u,v,sign.canopy?sign.canopy.depth_m+.024:panel?.185:.085,w,h,m);
        }
      }
    }
    batch.finish(group, plan.evidence);
    group.userData = {inferredExterior: plan.id, sources: plan.references, missingAssets: [...missingAssets]};
    target.add(group); return group;
  };
  return {mount, missingAssets, brandTexture: key => textures.get(key), cutWallBands: (g, p, o) => cutExteriorWallBands(THREE, g, p, o),
    dispose() {for (const m of materialCache.values()) {if (m.map && ![...textures.values()].includes(m.map)) m.map.dispose(); m.dispose();} for (const t of textures.values()) t.dispose();}};
}

function solidIntervals(f, y) {
  let result = [[f.u0, f.u1]];
  for (const o of f.openings) if (y >= o.v - 0.06 && y <= o.v + o.h + 0.06) {
    result = result.flatMap(([a, b]) => [[a, Math.min(b, o.u - 0.08)], [Math.max(a, o.u + o.w + 0.08), b]]).filter(([a, b]) => b > a);
  }
  return result;
}

/** Consumer rejects stale shell bindings before suppressing any original renderer work. */
export function boundExterior(feature, collection) {
  const p = collection?.buildings?.[String(feature.osm_id)];
  if (p?.schema !== 'kerbside.inferred_exterior/1' || !p.validation?.passed || p.canonical_geometry_modified !== false
      || JSON.stringify(p.canonical_points) !== JSON.stringify(feature.points) || p.height_m !== Number(feature.height_m)) return null;
  const origin=p.origin_lon_lat;
  if(!Array.isArray(origin)||origin.length!==2||!origin.every(Number.isFinite))return null;
  const ring=p.footprint?.coordinates?.[0];
  if(!Array.isArray(ring)||ring.length!==feature.points.length)return null;
  const scale=111320*Math.cos(origin[1]*Math.PI/180);
  if(!feature.points.every((q,i)=>Math.hypot((q[0]-origin[0])*scale-ring[i][0],(q[1]-origin[1])*111320-ring[i][1])<1e-5))return null;
  if(!Array.isArray(p.facades)||!p.facades.length)return null;
  for(const f of p.facades){
    const a=ring[f.edge],b=ring[f.edge+1];
    if(!a||!b||JSON.stringify(a)!==JSON.stringify(f.a)||JSON.stringify(b)!==JSON.stringify(f.b))return null;
    const L=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(![f.u0,f.u1,f.band_height_m,...f.normal].every(Number.isFinite)||f.u0<0||f.u1>L+.001||f.u1<=f.u0||f.band_height_m>p.height_m)return null;
    if(Math.abs(Math.hypot(...f.normal)-1)>.001||Math.abs((b[0]-a[0])*f.normal[0]+(b[1]-a[1])*f.normal[1])>.001)return null;
    for(const r of [...f.openings,...f.signs])if(![r.u,r.w,r.v,r.h].every(Number.isFinite)||r.w<=0||r.h<=0)return null;
  }
  return p;
}
