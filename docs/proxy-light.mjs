// The sun's shadows, the sky a street can see and the sunlight thrown back off the ground and
// the fronts, from a low-detail stand-in for the world near you.
//
// The usual way (a shadow map) draws every building, tree and kerb again from the sun every
// frame, and bounced light the usual way traces rays against all of it. This does neither. What
// it keeps is one picture of the world from straight above, a metre or so a texel: how high the
// top of it is at each point, and what colour. That is drawn now and then -- when you have moved
// on, or more of the world has arrived -- not every frame. From it, each time the sun has moved,
// three things are worked out on the GPU in two small passes:
//
//   - the shadow's top: over each point, the height below which the sun is cut off (the tallest
//     thing between the point and the sun, less the sun's climb on the way);
//   - the sky seen: how much of the sky a point at street level looks up at (a narrow street
//     between tall fronts gets less of the sky's light than a square does);
//   - the light thrown back: the share of the sunlight landing near a point -- on the ground and
//     low roofs level with it, and on the fronts that face the sun -- that comes back, by colour.
//
// Every lit material then reads them (module 02, PROXY_LIGHT.patch): two texture reads a pixel,
// whatever is on screen. After Unreal's Lumen, cut down to what a browser tab can carry: Lumen
// traces a simplified copy of the scene and keeps light on a low-detail cache of its surfaces;
// this keeps a height and a colour a point (so a bridge is a wall and an arcade is solid), and
// one bounce.
//
// The street lamps are a fourth thing in the same square: a soft pool under each, added up into a
// small picture and read at night. A tree's shadow lets light through in patches (the bounce's
// fourth channel says where the shade is a tree's).
//
// What it costs: three pictures on the GPU (PROXY.size squared: colour 4 bytes, depth 4, light 8
// a texel) and two small ones -- about 40 MiB at 1536 -- and nothing in the page's own memory.

//: The stand-in's size and the look. Lengths in metres, times in milliseconds.
export const PROXY = {
  size: 1536,                 // texels a side (0.7 m a texel on foot, as at 1024 over 720 m)
  bounce_size: 256,
  // The square covered: the first on foot, wider as the view pulls out. (Half as wide again,
  // 2026-11-19: at 720 m its edge -- where the shadows end -- showed down a street, and moved as
  // you walked or zoomed.)
  extents_m: [1080, 2160, 4320],
  extent_per_dist: 4,         // the square is at least this many times the camera's distance across
  up_m: 420, down_m: 220,     // how far above and below you the stand-in reaches
  recentre_share: 0.08,       // drawn again once you are this share of the square from its middle (small steps, often)
  min_gap_ms: 2500,           // never drawn again sooner than this
  arrivals_gap_ms: 5000,      // more of the world having arrived: drawn again, this long after the last
  refresh_ms: 120000,         // and at least this often (things shown and hidden as you go)
  sun_step_rad: 0.006,        // the sun traced again once it has moved this far (a third of a degree)
  strength: 0.88,             // how dark a shadow is (1: no sun at all)
  sky: 0.6,                   // how much a closed-in street loses of the sky's light
  bounce: 0.55,               // the light thrown back, as a share of what the trace finds
  albedo_gain: 1.0,           // the stand-in's colour to a surface's own (measured: see capture())
  march_steps: 112, march_even: 64, march_growth: 0.14,   // a texel a step for the first 64, then longer strides
  fade_per_s: 2.5,
  tiles: 3,                   // the stand-in is drawn a ninth a frame (tiles x tiles), so no frame pays for all of it
  lamp_size: 512, lamp_reach_m: 17, lamp_peak: 0.7,    // a street lamp's pool: how far it reaches, how bright under it
  lamp_colour: [1.0, 0.84, 0.62], lamp_strength: 2.4,  // warm white; against the night's own light (1.5 barely showed)
  dapple: 0.6,                // how much light comes through a tree's shadow, in patches
};

//: Where the stand-in is centred for a focus: on a texel, so that it does not swim as you walk.
export function snapCentre(x, z, extent, size) {
  const texel = extent / size;
  return { x: Math.round(x / texel) * texel, z: Math.round(z / texel) * texel, texel };
}

//: The square (m) for a camera ``dist`` away, given the one in use (it changes only once the
//: next is well needed or the last is well too big).
export function extentFor(dist, was = 0, P = PROXY) {
  const need = Math.max(0, dist) * P.extent_per_dist;
  let pick = P.extents_m[P.extents_m.length - 1];
  for (const e of P.extents_m) if (need <= e) { pick = e; break; }
  if (was && pick < was && need > was * 0.4) return was;
  return pick;
}

//: The march towards the sun: the distances (texels) at which the stand-in is read.
export function marchSteps(P = PROXY) {
  const out = []; let s = 1;
  for (let i = 0; i < P.march_steps; i += 1) { out.push(s); s += 1 + Math.max(0, i - P.march_even) * P.march_growth; }
  return out;
}

//: The sun in the map's own terms from the light's direction (towards the sun, world): the unit
//: step across the picture (u is +x, v is -z) and its climb a metre.
export function sunInMap(dir) {
  const flat = Math.hypot(dir.x, dir.z) || 1e-6;
  return { u: dir.x / flat, v: -dir.z / flat, tan: Math.max(0.03, dir.y / flat), sin: Math.max(0, dir.y), cos: flat };
}

//: The shadow's top over texel (i, j) of ``heights`` (row-major, ``size`` a side, v up): what the
//: light pass works out on the GPU, here for the tests and for anyone checking it.
export function shadowTop(heights, size, i, j, sun, metres, P = PROXY) {
  let top = -1000;
  for (const s of marchSteps(P)) {
    const u = Math.round(i + sun.u * s), v = Math.round(j + sun.v * s);
    if (u < 0 || v < 0 || u >= size || v >= size) break;
    const h = heights[v * size + u] - s * metres * sun.tan;
    if (h > top) top = h;
  }
  return top;
}

const QUAD_VERT = "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

const LIGHT_FRAG = (P) => `
uniform sampler2D tDepth; uniform vec2 sunUv; uniform float tanEl, texel, metres, top, span;
varying vec2 vUv;
// The height of the stand-in's top at a point, from where the map counts; far below where nothing was drawn.
float H(vec2 uv) { float d = texture2D(tDepth, uv).x; return d >= 0.99995 ? -1000.0 : top - d * span; }
void main() {
  float h0 = H(vUv);
  // Towards the sun: the tallest thing in the way, less the sun's climb to it.
  float shade = -1000.0, soft = 0.35, s = 1.0;
  for (int i = 0; i < ${P.march_steps}; i++) {
    vec2 q = vUv + sunUv * (texel * s);
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) break;
    float away = s * metres, h = H(q) - away * tanEl;
    if (h > shade) { shade = h; soft = 0.35 + 0.03 * away; }
    s += 1.0 + max(0.0, float(i - ${P.march_even})) * ${P.march_growth.toFixed(4)};
  }
  // Round about: how high the horizon stands each way.
  float sky = 0.0;
  for (int a = 0; a < 8; a++) {
    float ang = float(a) * 0.7853982 + 0.3927;
    vec2 dir = vec2(cos(ang), sin(ang)); float rise = 0.0;
    for (int j = 0; j < 5; j++) {
      float away = 2.5 * pow(1.95, float(j));
      rise = max(rise, (H(vUv + dir * (away / metres * texel)) - h0 - 0.6) / away);
    }
    sky += 1.0 - rise / sqrt(1.0 + rise * rise);
  }
  gl_FragColor = vec4(shade, sky / 8.0, h0, min(soft, 3.0));
}`;

const BOUNCE_FRAG = `
uniform sampler2D tLight, tColour; uniform vec2 sunUv; uniform float sinEl, cosEl, tanEl, texel, metres, albedo;
varying vec2 vUv;
void main() {
  vec4 L0 = texture2D(tLight, vUv); float h0 = L0.b;
  // What shades this point, if anything: back towards the sun to where the ray meets the
  // shadow's top. Green there is a tree, and a tree's shadow has light in it.
  float leafy = 0.0;
  if (L0.r > h0 + 0.5) { vec3 c = texture2D(tColour, vUv + sunUv * (texel * (L0.r - h0) / tanEl / metres)).rgb; leafy = smoothstep(1.08, 1.3, c.g / max(0.02, max(c.r, c.b))); }
  vec3 sum = vec3(0.0); float all = 0.0;
  for (int i = 0; i < 24; i++) {
    float r = sqrt((float(i) + 0.5) / 24.0) * 28.0, a = float(i) * 2.39996;
    vec2 off = vec2(cos(a), sin(a)) * r, q = vUv + off * (texel / metres);
    vec4 L = texture2D(tLight, q);
    vec3 colour = min(texture2D(tColour, q).rgb * albedo, vec3(0.85));
    float w = 1.0 / (1.0 + r * r / 90.0); all += w;
    // The ground and the low roofs level with here, where the sun reaches them.
    float lit = smoothstep(-0.4, 0.4, L.b - L.r + 0.3);
    sum += colour * (lit * sinEl * (1.0 - smoothstep(2.5, 5.0, L.b - h0)) * w);
    // A front that faces the sun: this point stands high over the one just sunward of it, and
    // the sun reaches halfway up it. It lights what is in front of it.
    vec4 F = texture2D(tLight, q + sunUv * (texel * 2.2));
    float wall = L.b - F.b;
    if (wall > 2.5 && L.b > h0 + 2.0 && dot(-off, sunUv) > 0.0) {
      float sunny = smoothstep(-0.5, 0.5, F.b + min(wall, 8.0) * 0.5 - F.r);
      sum += mix(colour, vec3(0.55), 0.6) * (sunny * cosEl * clamp(wall / 10.0, 0.0, 1.0) * w * 1.5);
    }
  }
  gl_FragColor = vec4(clamp(sum / all * 2.0, 0.0, 1.0), leafy);
}`;

//: The stand-in and its light for a page. ``uniforms`` is module 02's PROXY_LIGHT (what the
//: materials read); ``sun`` the directional light (the moon's at night) and ``ambient`` the
//: sky's fill; ``night`` the night's uniforms (windows are not lit while the colour is taken).
export function createProxyLight({ THREE, renderer, scene, sun, ambient, uniforms, night = null, P = PROXY }) {
  const gl2 = renderer.capabilities.isWebGL2 && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
  const U = uniforms;
  const state = { ok: Boolean(gl2), on: true, level: 0, extent: 0, cx: 0, cz: 0, yc: 0, captured: 0, geoms: -1, lit: 0, sunDir: new THREE.Vector3(), captures: 0, lights: 0, lastMs: 0, lastCaptureMs: 0, lastLightMs: 0, prev: 0 };
  if (!state.ok) { console.warn("kerbside: this browser cannot keep the light map; no shadows"); return { update() {}, stats: () => ({ ok: false }), setEnabled() {}, dispose() {} }; }
  const capture = new THREE.WebGLRenderTarget(P.size, P.size, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false });
  capture.depthTexture = new THREE.DepthTexture(P.size, P.size);
  capture.depthTexture.minFilter = capture.depthTexture.magFilter = THREE.NearestFilter;
  const light = new THREE.WebGLRenderTarget(P.size, P.size, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false });
  const bounce = new THREE.WebGLRenderTarget(P.bounce_size, P.bounce_size, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false });
  const above = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, P.up_m + P.down_m);
  above.up.set(0, 0, -1);
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quadScene = new THREE.Scene();
  const pass = (fragmentShader, u) => new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader, uniforms: u, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const lightPass = pass(LIGHT_FRAG(P), { tDepth: { value: capture.depthTexture }, sunUv: { value: new THREE.Vector2() }, tanEl: { value: 1 }, texel: { value: 1 / P.size }, metres: { value: 1 }, top: { value: 0 }, span: { value: 1 } });
  const bouncePass = pass(BOUNCE_FRAG, { tLight: { value: light.texture }, tColour: { value: capture.texture }, sunUv: { value: new THREE.Vector2() }, sinEl: { value: 1 }, cosEl: { value: 0 }, tanEl: { value: 1 }, texel: { value: 1 / P.size }, metres: { value: 1 }, albedo: { value: P.albedo_gain } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lightPass);
  quad.frustumCulled = false; quadScene.add(quad);
  U.map.value = light.texture; U.bounce.value = bounce.texture;
  // The street lamps: a soft disc each, added up, drawn from above into a picture of their own.
  const lampRT = new THREE.WebGLRenderTarget(P.lamp_size, P.lamp_size, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false });
  const LAMP_MAX = 4096, lampScene = new THREE.Scene();
  const lampMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0); }",
    fragmentShader: `varying vec2 vUv;\nvoid main() { float r = length(vUv - 0.5) * 2.0, f = max(0.0, 1.0 - r * r); gl_FragColor = vec4(vec3(f * f * ${P.lamp_peak.toFixed(3)}), 1.0); }`,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false }), LAMP_MAX);
  lampMesh.frustumCulled = false; lampMesh.count = 0; lampScene.add(lampMesh);
  U.lampMap.value = lampRT.texture;
  const lampM = new THREE.Matrix4();
  function drawLamps(c, extent, y) {
    const L = U.lamps || [], half = extent / 2 + P.lamp_reach_m;
    let n = 0;
    for (let i = 0; i + 2 < L.length && n < LAMP_MAX; i += 3) {
      if (Math.abs(L[i] - c.x) > half || Math.abs(L[i + 2] - c.z) > half) continue;
      lampM.makeScale(P.lamp_reach_m, 1, P.lamp_reach_m).setPosition(L[i], y, L[i + 2]);
      lampMesh.setMatrixAt(n++, lampM);
    }
    lampMesh.count = n; lampMesh.instanceMatrix.needsUpdate = true;
    renderer.getClearColor(keep.clear); const clearA = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);
    try { drawTo(lampRT, () => renderer.render(lampScene, above)); } finally { renderer.setClearColor(keep.clear, clearA); }
    state.lamps = n;
  }

  const white = new THREE.Color(1, 1, 1), keep = { sky: new THREE.Color(), ground: new THREE.Color(), clear: new THREE.Color() };

  function drawTo(target, draw) {
    const was = renderer.getRenderTarget(), xr = renderer.xr.enabled, auto = renderer.autoClear;
    renderer.xr.enabled = false; renderer.autoClear = true;
    renderer.setRenderTarget(target);
    try { draw(); } finally { renderer.setRenderTarget(was); renderer.xr.enabled = xr; renderer.autoClear = auto; }
  }

  //: The stand-in drawn from above round ``focus``: the world as it is shown now, in the sky's
  //: light alone and of one strength (so its colour is the surfaces' own, whatever the hour),
  //: without what moves (the cars parked at the kerb are in it: view.mjs's hook shows them
  //: alone). A part of it a frame -- ``P.tiles`` squared parts, each the scene drawn through a
  //: camera that sees only that part -- and the light is traced again when the last is in.
  function beginCapture(focus, extent, now) {
    state.pending = { c: snapCentre(focus.x, focus.z, extent, P.size), extent, y: focus.y, tile: 0, t0: now, ms: 0 };
  }
  function captureTile() {
    const job = state.pending, t0 = performance.now(), c = job.c, half = job.extent / 2, N = Math.max(1, P.tiles | 0);
    const i = job.tile % N, j = Math.floor(job.tile / N), w = job.extent / N, px = P.size / N;
    above.left = -half + i * w; above.right = above.left + w; above.bottom = -half + j * w; above.top = above.bottom + w;
    above.position.set(c.x, job.y + P.up_m, c.z); above.lookAt(c.x, job.y, c.z);
    above.updateProjectionMatrix(); above.updateMatrixWorld(true);
    capture.viewport.set(i * px, j * px, px, px); capture.scissor.set(i * px, j * px, px, px); capture.scissorTest = true;
    const hidden = [];
    for (const o of U.dynamic) if (o && o.visible) { o.visible = false; hidden.push(o); }
    const background = scene.background, fog = scene.fog, sunI = sun.intensity, ambI = ambient.intensity, on = U.k.value.w, dark = night?.night?.value ?? 0, lampR = U.lamp.value.x, lampG = U.lamp.value.y, lampB = U.lamp.value.z;
    const fogWas = fog ? (fog.isFogExp2 ? fog.density : [fog.near, fog.far]) : null;
    keep.sky.copy(ambient.color); if (ambient.groundColor) keep.ground.copy(ambient.groundColor);
    renderer.getClearColor(keep.clear); const clearA = renderer.getClearAlpha();
    try {
      for (const h of U.captureHooks || []) try { h.before?.(); } catch (error) { console.warn("kerbside: stand-in hook", error); }
      scene.background = null;
      // (The fog is thinned, not taken off: a scene with no fog is a different program for every material.)
      if (fog) { if (fog.isFogExp2) fog.density = 0; else { fog.near = 1e7; fog.far = 2e7; } }
      sun.intensity = 0; ambient.intensity = 1; ambient.color.copy(white); ambient.groundColor?.copy(white);
      U.k.value.w = 0; U.lamp.value.x = U.lamp.value.y = U.lamp.value.z = 0;
      if (night?.night) night.night.value = 0;
      renderer.setClearColor(0x000000, 0);
      drawTo(capture, () => renderer.render(scene, above));
    } finally {
      scene.background = background;
      if (fog) { if (fog.isFogExp2) fog.density = fogWas; else { fog.near = fogWas[0]; fog.far = fogWas[1]; } }
      sun.intensity = sunI; ambient.intensity = ambI; ambient.color.copy(keep.sky); ambient.groundColor?.copy(keep.ground);
      U.k.value.w = on; U.lamp.value.x = lampR; U.lamp.value.y = lampG; U.lamp.value.z = lampB;
      if (night?.night) night.night.value = dark;
      renderer.setClearColor(keep.clear, clearA);
      for (const h of U.captureHooks || []) try { h.after?.(); } catch (error) { console.warn("kerbside: stand-in hook", error); }
      for (const o of hidden) o.visible = true;
    }
    job.ms = Math.max(job.ms, performance.now() - t0); job.tile += 1;
    if (job.tile < N * N) return false;
    // The last part is in: the whole square is the new one.
    above.left = -half; above.right = half; above.bottom = -half; above.top = half; above.updateProjectionMatrix();
    drawLamps(c, job.extent, job.y);
    Object.assign(state, { pending: null, extent: job.extent, cx: c.x, cz: c.z, yc: job.y, captured: job.t0, geoms: renderer.info.memory.geometries, captures: state.captures + 1, lastCaptureMs: job.ms });
    U.box.value.set(c.x, c.z, 1 / job.extent, job.y);
    U.k.value.y = c.texel;
    lightPass.uniforms.metres.value = bouncePass.uniforms.metres.value = c.texel;
    // The depth runs from the camera's near plane to its far one; heights are counted from you.
    lightPass.uniforms.top.value = P.up_m - above.near;
    lightPass.uniforms.span.value = above.far - above.near;
    return true;
  }

  //: The sun traced through the stand-in: the light map, then what is thrown back.
  function relight(dir) {
    const t0 = performance.now(), s = sunInMap(dir);
    lightPass.uniforms.sunUv.value.set(s.u, s.v); lightPass.uniforms.tanEl.value = s.tan;
    bouncePass.uniforms.sunUv.value.set(s.u, s.v); bouncePass.uniforms.sinEl.value = s.sin; bouncePass.uniforms.cosEl.value = s.cos; bouncePass.uniforms.tanEl.value = s.tan;
    quad.material = lightPass; drawTo(light, () => renderer.render(quadScene, flat));
    quad.material = bouncePass; drawTo(bounce, () => renderer.render(quadScene, flat));
    state.sunDir.copy(dir); state.lights += 1; state.lastLightMs = performance.now() - t0;
  }

  const dir = new THREE.Vector3();
  //: Once a frame. ``focus``: where you are ({x, y, z}); ``dist``: the camera's distance from it;
  //: ``indoors``: inside a building (the stand-in is solid: a room under its roof would be in the dark).
  function update(now, focus, { dist = 0, indoors = false } = {}) {
    const dt = Math.min(0.25, Math.max(0, (now - (state.prev || now)) / 1000)); state.prev = now;
    dir.copy(sun.position).normalize();
    const want = state.on && !indoors && focus ? 1 : 0, sunUp = sun.intensity > 0.02 && dir.y > 0.02 ? 1 : 0;
    state.level += Math.max(-1, Math.min(1, want - state.level)) * Math.min(1, dt * P.fade_per_s || 1);
    if (Math.abs(want - state.level) < 0.01) state.level = want;
    const ready = state.captured && state.lights ? state.level : 0, dark = night?.night?.value ?? 0;
    U.k.value.w = ready; U.k.value.x = P.strength * ready * sunUp; U.k.value.z = P.sky * ready;
    U.sun.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity * Math.PI * P.bounce * ready * sunUp);
    const lamp = P.lamp_strength * dark * ready;
    U.lamp.value.set(P.lamp_colour[0] * lamp, P.lamp_colour[1] * lamp, P.lamp_colour[2] * lamp, P.dapple);
    if (!want) { state.pending = null; return false; }
    let drawn = false;
    if (state.pending) { if (!captureTile()) return true; drawn = true; }
    else {
      const extent = extentFor(dist, state.extent, P), since = now - state.captured;
      const off = Math.max(Math.abs(focus.x - state.cx), Math.abs(focus.z - state.cz), Math.abs(focus.y - state.yc) * 2);
      const arrivals = renderer.info.memory.geometries !== state.geoms;
      if (!state.captured || extent !== state.extent || (since > P.min_gap_ms && off > extent * P.recentre_share) || (arrivals && since > P.arrivals_gap_ms) || since > P.refresh_ms) {
        beginCapture(focus, extent, now);
        if (!captureTile()) return true;
        drawn = true;
      }
    }
    if (drawn || !state.lights || state.sunDir.angleTo(dir) > P.sun_step_rad) { relight(dir); drawn = true; }
    return drawn;
  }

  return {
    update,
    //: What is kept and what it last cost (ms are the page's own time; the GPU's work comes after).
    stats: () => ({ ok: true, on: state.on, level: +state.level.toFixed(2), extent: state.extent, centre: [state.cx, state.cz], captures: state.captures, relights: state.lights, capture_ms: +state.lastCaptureMs.toFixed(2), lamps: state.lamps || 0, relight_ms: +state.lastLightMs.toFixed(2), gpu_bytes: P.size * P.size * 16 + P.bounce_size * P.bounce_size * 4 + P.lamp_size * P.lamp_size * 4 }),
    setEnabled(on) { state.on = Boolean(on); },
    get enabled() { return state.on; },
    settings: P,
    //: The pictures, for a look at them (tests, a debug view).
    targets: { capture, light, bounce, lamps: lampRT },
    dispose() { capture.depthTexture.dispose(); capture.dispose(); light.dispose(); bounce.dispose(); lampRT.dispose(); lampMesh.geometry.dispose(); lampMesh.material.dispose(); U.lampMap.value = null; quad.geometry.dispose(); lightPass.dispose(); bouncePass.dispose(); U.map.value = null; U.bounce.value = null; U.k.value.x = 0; U.k.value.z = 0; },
  };
}
