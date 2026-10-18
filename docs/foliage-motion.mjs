// Render-only motion of plants: the wind sways crowns and shrubs and flutters their leaves, and a
// walker parts the grass and brushes the shrubs aside. A vertex shader on the GPU, as games do
// it -- not a rigid-body simulation of every branch -- and it moves nothing the page measures:
// no position, footprint, clearance or collision changes, only where a leaf is drawn.
//
// The wind is the sky's (environment-runtime's weather), and each page that draws plants makes
// its own motion with its own walker, because an attached region draws in its own coordinates.

//: Until the sky says otherwise (sky-clock.mjs WEATHER has each preview's wind): the afternoon
//: sea breeze, m/s, and where it comes from, degrees clockwise from north.
export const DEFAULT_WIND = 4.5;
export const PREVAILING_WIND_FROM = 290;

//: The direction a wind from `fromDegrees` blows towards, in renderer x/z (east +x, north -z).
export function windVector(fromDegrees) {
  const to = (fromDegrees + 180) * Math.PI / 180;
  return [Math.sin(to), -Math.cos(to)];
}

//: How far the top of a tree of `height` metres sways in a wind of `speed` m/s: about a quarter
//: of a percent of its height per m/s -- 0.35 m for a 15 m tree in a 10 m/s wind -- and its own
//: period, slower for a taller tree (a tree's sway frequency goes as one over root height).
export function crownSway(height, speed) {
  return {amplitude: height * 0.0022 * speed, hertz: 1 / Math.sqrt(Math.max(1, height))};
}

const DECLARATIONS = "uniform float uFoliageTime;uniform vec3 uWind;uniform vec4 uWalker;\n";

function plantChunk(kind) {
  const leaves = kind === "leaves" || kind === "shrub";
  return `#ifdef USE_INSTANCING
{
  vec3 fmBase = instanceMatrix[3].xyz;
  float fmHeight = max(.2, length(instanceMatrix[1].xyz));
  float fmPhase = dot(fmBase.xz, vec2(.071, .053));
  float fmT = clamp(transformed.y, 0., 1.3), fmW = fmT * fmT;
  float fmV = uWind.z;
  // Gusts come and go across the stand; the crown leans downwind with them and swings about
  // that lean at its own period.
  float fmGust = .62 + .38 * sin(uFoliageTime * .31 + fmPhase * .21) * sin(uFoliageTime * .13 + fmPhase * .7);
  float fmSwing = sin(uFoliageTime * 6.2832 / sqrt(max(1., fmHeight)) + fmPhase);
  float fmAmp = fmHeight * .0022 * fmV * fmGust;
  vec3 fmOff = vec3(uWind.x, 0., uWind.y) * fmAmp * fmW * (.7 + .45 * fmSwing);
  ${leaves ? `// Leaves flutter: small, quick, each its own.
  float fmFlutter = sin(uFoliageTime * (6.5 + fmV * .45) + dot(transformed, vec3(13.1, 7.7, 11.3)) * 3.7);
  fmOff += vec3(-uWind.y * .6, .5, uWind.x * .6) * fmFlutter * .006 * fmV * fmT * min(1., fmHeight * .25);` : ""}
  ${kind === "shrub" ? `// A walker pushes through: the shrub gives way from them, most at its top.
  vec3 fmAt = fmBase + mat3(instanceMatrix) * transformed;
  vec2 fmD = fmAt.xz - uWalker.xz;
  float fmReach = uWalker.w + length(instanceMatrix[0].xyz);
  float fmPress = (1. - smoothstep(uWalker.w * .4, fmReach, length(fmD))) * step(abs(fmAt.y - uWalker.y), 2.5);
  fmOff.xz += normalize(fmD + vec2(1e-4)) * fmPress * fmT * min(.45, fmHeight * .35);` : ""}
  transformed += inverse(mat3(instanceMatrix)) * fmOff;
}
#endif`;
}

const GRASS_CHUNK = `{
  float fmT = bladeT, fmV = uWind.z;
  float fmPhase = dot(transformed.xz, vec2(.9, .7));
  // The whole sward waves in long gusts, each blade a little out of step.
  float fmWave = sin(uFoliageTime * 1.7 - dot(transformed.xz, vec2(uWind.x, uWind.y)) * .35 + fmPhase * .15);
  vec3 fmOff = vec3(uWind.x, 0., uWind.y) * fmT * fmT * (.0035 * fmV + .0045 * fmV * fmWave);
  // Underfoot the blades are pressed down and out from the walker.
  vec2 fmD = transformed.xz - uWalker.xz;
  float fmPress = (1. - smoothstep(uWalker.w * .3, uWalker.w, length(fmD))) * step(abs(transformed.y - uWalker.y), 1.5);
  fmOff.xz += normalize(fmD + vec2(1e-4)) * fmPress * fmT * .08;
  fmOff.y -= fmPress * fmT * fmT * .075;
  transformed += fmOff;
}`;

export function createFoliageMotion(THREE) {
  const uniforms = {
    uFoliageTime: {value: 0},
    uWind: {value: new THREE.Vector3(...windVector(PREVAILING_WIND_FROM), DEFAULT_WIND)},
    // x, y, z of the walker's feet and how far round them the grass is pressed.
    uWalker: {value: new THREE.Vector4(0, -1e6, 0, .55)},
  };
  //: kind: "leaves" | "bark" | "shrub" (instanced) or "grass" (blades with a bladeT attribute).
  function apply(material, kind) {
    if (!material || material.userData.foliageMotion) return material;
    material.userData.foliageMotion = kind;
    const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = function (shader, renderer) {
      if (previous) previous.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${DECLARATIONS}${kind === "grass" ? "attribute float bladeT;\n" : ""}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${kind === "grass" ? GRASS_CHUNK : plantChunk(kind)}`);
    };
    material.customProgramCacheKey = function () {
      return `${previousKey ? previousKey.call(this) : ""}|foliage-${kind}-v1`;
    };
    material.needsUpdate = true;
    return material;
  }
  //: Each frame: the clock, the sky's wind (globalThis.kerbsideWind, set by the page that owns
  //: the sky) and where this page's walker stands, in this page's own coordinates.
  function update(now, walker = null) {
    uniforms.uFoliageTime.value = (now / 1000) % 100000;
    const wind = globalThis.kerbsideWind;
    if (wind && Number.isFinite(wind.speed)) {
      const [x, z] = windVector(Number.isFinite(wind.from) ? wind.from : PREVAILING_WIND_FROM);
      uniforms.uWind.value.set(x, z, Math.max(0, wind.speed));
    }
    if (walker) uniforms.uWalker.value.set(walker.x, walker.y, walker.z, uniforms.uWalker.value.w);
  }
  return {uniforms, apply, update};
}
