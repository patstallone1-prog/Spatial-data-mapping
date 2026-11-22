// The clouds over the city: a few patterns of the sky over San Francisco, one after another
// through the game's day, drifting with the wind and lit by the sun where it stands -- and the
// sun itself, a disc you can see going over on the game's clock.
//
// The deck had been one sum of sines on a sphere 40 km out, and the City draws to 1.6 km: in the
// City there were no clouds at all (2026-11-21). The deck is drawn at the far plane now, as the
// night dome is (xyww), after the sky and before anything solid hides it.
//
// The patterns, from one tileable texture of four kinds of cloud:
//  - fair-weather cumulus: separate heaps with blue between them, in fields (red channel, under
//    the green-blue field mask in alpha);
//  - high cirrus: long thin streaks, stretched along the wind (green);
//  - altocumulus: a fine dappling of small puffs in patches (blue);
//  - the marine layer breaking up: a broad grey sheet with holes worn through it (the texture's
//    large scale), the morning's look over the bay.
// Each pattern is a mix of those, and how much of the sky it covers. The weather (sky-clock.mjs
// WEATHER) can only add cloud: "sunny" is a few clouds, "cloudy" a sky full.

//: The patterns, in the order they come round. ``w``: how much of each kind (cumulus, cirrus,
//: altocumulus, layer); ``cover``: the share of the sky the main kind covers.
export const CLOUD_PATTERNS = Object.freeze([
  Object.freeze({ name: "fair-weather cumulus", w: [1, 0.25, 0, 0], cover: 0.34 }),
  Object.freeze({ name: "high cirrus", w: [0.12, 1, 0, 0], cover: 0.44 }),
  Object.freeze({ name: "altocumulus", w: [0.2, 0.25, 1, 0], cover: 0.42 }),
  Object.freeze({ name: "marine layer breaking up", w: [0.45, 0, 0, 1], cover: 0.52 }),
]);
//: How long one pattern holds (game hours), and how long the change to the next takes.
export const CLOUD_BLOCK_H = 6, CLOUD_CHANGE_H = 1.5;

const hash = (n) => { let h = (n | 0) ^ 0x9e3779b9; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

//: The order the patterns come round in a cycle of as many blocks as there are patterns: each
//: once, shuffled by the cycle's number, and the first never the last of the cycle before.
function cycleOrder(cycle, n) {
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i -= 1) { const j = Math.floor(hash(cycle * 31 + i) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}
function patternOf(block, n) {
  const cycle = Math.floor(block / n), pos = block - cycle * n, order = cycleOrder(cycle, n);
  const before = cycleOrder(cycle - 1, n)[n - 1];
  if (order[0] === before) [order[0], order[1]] = [order[1], order[0]];
  return order[pos];
}
//: The pattern for game time ``ms`` (the game clock's date, in ms): {index, next, blend (0..1
//: into the next), name}. A game day is four blocks; every pattern comes round, never the same
//: twice running.
export function cloudPatternAt(ms) {
  const hours = ms / 3600000, block = Math.floor(hours / CLOUD_BLOCK_H), n = CLOUD_PATTERNS.length;
  const pick = (b) => patternOf(b, n);
  const index = pick(block), next = pick(block + 1);
  const into = hours - block * CLOUD_BLOCK_H, blend = Math.max(0, Math.min(1, (into - (CLOUD_BLOCK_H - CLOUD_CHANGE_H)) / CLOUD_CHANGE_H));
  return { index, next, blend, name: blend < 0.5 ? CLOUD_PATTERNS[index].name : CLOUD_PATTERNS[next].name };
}

//: The mix of kinds and the cover for a pattern and the weather's cloud (0..1): [cu, ci, ac,
//: layer] weights and the cover of each, eased from one pattern to the next.
export function cloudMix(at, weatherCloud = 0) {
  const A = CLOUD_PATTERNS[at.index], B = CLOUD_PATTERNS[at.next], k = at.blend * at.blend * (3 - 2 * at.blend);
  const w = A.w.map((v, i) => v + (B.w[i] - v) * k), base = A.cover + (B.cover - A.cover) * k;
  // Overcast: heaps and sheet fill in whatever the pattern.
  const over = Math.max(0, Math.min(1, (weatherCloud - 0.35) / 0.55));
  const heavy = [1, 0.35, 0.35, 1];
  const weights = w.map((v, i) => v + (heavy[i] - v) * over);
  const cover = Math.max(base, weatherCloud);
  return { weights, cover: weights.map((v) => Math.min(0.97, cover * v)) };
}

// -- the texture: four kinds of cloud, each tileable -----------------------------------------------
function lattice(px, py, seed) {
  const g = new Float32Array(px * py);
  for (let i = 0; i < g.length; i += 1) g[i] = hash(seed * 7919 + i);
  return g;
}
function noise(g, px, py, u, v) {
  const x = u * px, y = v * py, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const i0 = ((i % px) + px) % px, i1 = (i0 + 1) % px, j0 = ((j % py) + py) % py, j1 = (j0 + 1) % py;
  const a = g[j0 * px + i0], b = g[j0 * px + i1], c = g[j1 * px + i0], d = g[j1 * px + i1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
//: Fractal sum of tileable noise over octaves [[px, py], ...], 0..1.
function fbm(size, octaves, seed) {
  const out = new Float32Array(size * size), grids = octaves.map(([px, py], k) => [lattice(px, py, seed + k), px, py]);
  let total = 0;
  for (let k = 0; k < octaves.length; k += 1) total += 0.5 ** k;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let v = 0;
    for (let k = 0; k < grids.length; k += 1) { const [g, px, py] = grids[k]; v += noise(g, px, py, x / size, y / size) * 0.5 ** k; }
    out[y * size + x] = v / total;
  }
  return out;
}
const stretch = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
//: ``v`` spread over 0..1 by its own spread: its 6th percentile clear, its 96th dense (a sum of
//: octaves gathers round the middle, and a cover would have nothing to cut).
function spread(v) {
  const step = Math.max(1, Math.floor(v.length / 4096)), sample = [];
  for (let i = 0; i < v.length; i += step) sample.push(v[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.06)], hi = sample[Math.floor(sample.length * 0.96)];
  return v.map((x) => stretch(x, lo, hi));
}
//: RGBA bytes (size x size): cumulus, cirrus, altocumulus, and the field the heaps stand in.
export function cloudPixels(size = 256) {
  const raw = fbm(size, [[4, 4], [8, 8], [16, 16], [32, 32], [64, 64]], 11);
  // Billowed: heaps with rounded tops, not a smooth haze.
  const cu = spread(raw.map((v) => v * 0.75 + (1 - Math.abs(v * 2 - 1)) * 0.25));
  const ci = spread(fbm(size, [[2, 12], [4, 28], [8, 56], [16, 112]], 23));
  const fine = spread(fbm(size, [[16, 16], [32, 32], [64, 64]], 37));
  // A dappling: the puffs at their own small scale, only in patches.
  const ac = spread(fine.map((v, i) => v * (0.35 + 0.9 * cu[i])));
  const field = spread(fbm(size, [[2, 2], [4, 4]], 51));
  const px = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    px[i * 4] = 255 * cu[i]; px[i * 4 + 1] = 255 * ci[i]; px[i * 4 + 2] = 255 * ac[i]; px[i * 4 + 3] = 255 * field[i];
  }
  return px;
}

export const CLOUD_VERTEX = "varying vec3 vDir; void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}";
export const CLOUD_FRAGMENT = `uniform sampler2D map;uniform vec4 cover;uniform float day,alt;uniform vec3 sunDir;uniform vec2 drift;varying vec3 vDir;
  float kind(float n,float c,float soft){return c<=0.003?0.:smoothstep(1.-c,1.-c+soft,n);}
  void main(){
    vec3 d=normalize(vDir);
    if(d.y<=0.)discard;
    // On a flat deck overhead: further off, lower in the sky and closer together. (Smoothly to
    // the horizon: clamped, the deck below the clamp was one row of the texture drawn straight
    // down, stems under the clouds.)
    vec2 p=d.xz/(d.y+.06);
    vec4 near=texture2D(map,p*.11+drift);
    vec4 wide=texture2D(map,p*.031+drift*.29+vec2(.31,.77));
    float heaps=kind(near.r*(.45+.75*wide.a),cover.x,.18);
    float streaks=kind(texture2D(map,p*.045+drift*1.7).g,cover.y,.3)*.62;
    float dapple=kind(near.b*(.5+.7*wide.a),cover.z,.12)*.8;
    float sheet=kind(wide.r*.7+near.r*.3,cover.w,.22)*.9;
    float a=1.-(1.-heaps)*(1.-streaks)*(1.-dapple)*(1.-sheet);
    float thick=max(max(heaps,sheet),dapple*.6);
    // Lit from the sun's side, grey beneath where it is thick; low sun warms them.
    float toward=dot(d,sunDir)*.5+.5;
    vec3 lit=vec3(.97,.97,.95),under=vec3(.6,.64,.7);
    vec3 c=mix(lit,under,thick*(.75-.35*toward));
    float low=day*(1.-smoothstep(.05,.3,alt));
    c=mix(c,c*vec3(1.08,.72,.5),low*.85);
    // The silver lining: the edges of the cloud nearest the sun.
    c+=vec3(1.,.95,.85)*pow(max(0.,dot(d,sunDir)),10.)*a*(1.-a)*2.4*day;
    // By night the clouds are the night sky's blue-grey, lit from below by the city.
    c=mix(vec3(.1,.12,.19),c,day);
    // Into the haze at the horizon.
    a*=smoothstep(.015,.2,d.y)*.94;
    // The sun, under the clouds: a disc that can be seen (the sky shader's is its true half a
    // degree, a white point in a white haze) and its glow, orange low down and near white high
    // up, where the game's clock has it. Gone by night, and behind the horizon.
    float toSun=dot(d,sunDir);
    float disc=smoothstep(cos(.034),cos(.027),toSun);
    float glow=pow(max(0.,toSun),220.)*.55+pow(max(0.,toSun),24.)*.22;
    float high=smoothstep(.02,.4,alt);
    vec3 sunC=mix(vec3(1.,.5,.22),vec3(1.,.96,.86),high);
    float sa=clamp(disc+glow,0.,1.)*day*smoothstep(-.01,.02,alt)*smoothstep(.0,.03,d.y);
    float A=a+sa*(1.-a);
    vec3 C=(c*a+sunC*sa*(1.-a))/max(A,1e-4);
    gl_FragColor=vec4(C,A);
  }`;

//: The deck: {mesh, material, update(now, {date, weather, sunDir, altitude, day})}.
export function createClouds(THREE) {
  const size = 256, px = cloudPixels(size);
  const texture = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    uniforms: { map: { value: texture }, cover: { value: new THREE.Vector4(0.3, 0, 0, 0) }, day: { value: 1 }, alt: { value: 1 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, drift: { value: new THREE.Vector2(0, 0) } },
    vertexShader: CLOUD_VERTEX, fragmentShader: CLOUD_FRAGMENT });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  mesh.frustumCulled = false; mesh.renderOrder = -7;
  let last = null, pattern = null;
  //: Each frame: the drift with the wind; every quarter second (``look``) the pattern and light.
  function update(now, { date = null, weather = null, sunDir = null, altitude = 0, day = 1, look = false } = {}) {
    const dt = last === null ? 0 : Math.min(1, Math.max(0, (now - last) / 1000)); last = now;
    if (weather) {
      // Toward where the wind blows (from ``windFrom`` degrees): east is +x, north -z; a little
      // quicker than the wind itself, so the sky is seen to move.
      const b = ((weather.windFrom ?? 290) + 180) * Math.PI / 180, k = (weather.wind ?? 5) * 2.2e-4 * dt;
      const D = material.uniforms.drift.value;
      D.x = (D.x + Math.sin(b) * k) % 1; D.y = (D.y - Math.cos(b) * k) % 1;
    }
    if (!look || !date) return pattern;
    pattern = cloudPatternAt(+date);
    const mix = cloudMix(pattern, weather?.cloud ?? 0);
    material.uniforms.cover.value.fromArray(mix.cover);
    material.uniforms.day.value = day; material.uniforms.alt.value = altitude;
    if (sunDir) material.uniforms.sunDir.value.copy(sunDir).normalize();
    return pattern;
  }
  return { mesh, material, texture, update, pattern: () => pattern };
}
