// How each material meets the sun: its own roughness and its own share of mirrored light.
//
// The street's surfaces are lit plainly (matt light, shadows, the bounce) with one highlight put
// back for the sun (module 02, PROXY_LIGHT.patch). That highlight used every material's drawn
// roughness and one figure, 4%, for what any of them mirrors. Here each material takes its own
// from the object catalogue (docs/object-catalogue.json, ``optics``): painted steel throws a
// tighter, brighter glint than stucco, a leaf more than bark, bare aluminium most of all, and
// asphalt only glares towards a low sun.
//
// And what it scatters back: asphalt a tenth of the light, grass and leaves about the same,
// concrete a third. A drawn colour outside its material's range (``albedo_range``) is tinted into
// it, so the sun lights a road and the walk beside it in the proportion it does outdoors.
//
// A drawn mesh says what it is (``userData.surface``); the catalogue says what that is made of.
// The two figures go to the material's shader as one uniform, so no program is compiled again.

//: What a material with no entry is given: its drawn roughness (-1) and a non-metal's 4%.
export const DEFAULT_OPTICS = Object.freeze({ roughness: -1, specular: 0.04 });
//: A car's clear coat: polyurethane lacquer (n 1.5: 4-5% head on), smooth but not a mirror once
//: it has been driven. The paint under it scatters the colour; the coat mirrors the sun and sky.
export const CAR_PAINT = Object.freeze({ gloss: 0.2, specular: 0.05 });
export const CAR_GLASS = Object.freeze({ gloss: 0.06, specular: 0.043 });

//: The head-on mirrored share of a clear material of refractive index ``n``.
export const fresnel0 = (n) => ((n - 1) / (n + 1)) ** 2;

//: The catalogue's figures for a surface name, or null where it has none.
export function opticsFor(catalogue, surface) {
  const a = surface ? catalogue?.archetype(surface) : null;
  const o = a ? catalogue.material(a.material)?.optics : null;
  if (!o || !(o.roughness >= 0) || !(o.specular >= 0)) return null;
  const range = Array.isArray(o.albedo_range) && o.albedo_range[0] > 0 && o.albedo_range[1] >= o.albedo_range[0] ? o.albedo_range : null;
  return { roughness: Math.max(0.03, Math.min(1, o.roughness)), specular: Math.max(0, Math.min(1, o.specular)), range, material: a.material };
}

//: A tree's leaves are its crown's, not its trunk's (as object-catalogue.mjs reads them).
function surfaceOf(o, material) {
  const s = o.userData?.surface ?? o.parent?.userData?.surface;
  if (!s) return null;
  return String(s).startsWith("tree:") && material?.alphaTest > 0 ? String(s).replace(/^tree:/, "foliage:") : s;
}

//: How much a drawn surface's colour is multiplied by to bring what it scatters back (``drawn``,
//: 0..1, the share of visible light) into its material's range: 1 inside it. Never by more than
//: four times either way: past that the drawn colour is not that material's at all.
export function tintFor(drawn, range) {
  if (!(drawn > 0) || !Array.isArray(range)) return 1;
  const k = drawn < range[0] ? range[0] / drawn : drawn > range[1] ? range[1] / drawn : 1;
  return Math.max(0.25, Math.min(4, k));
}

//: ``apply(root)`` gives every material under ``root`` not yet seen its figures (``set(material,
//: roughness, specular)``); the number newly given. Cheap to call again: a seen material is passed.
//: With ``drawn(material, mesh)`` (the share of light the drawn colour scatters back; null where
//: that cannot be told, undefined while its picture has not arrived) and ``tint(material, k)``, a
//: material outside its range is tinted into it, once.
export function createReflectance({ catalogue, set, drawn = null, tint = null }) {
  const seen = new WeakSet(), by = new Map(), waiting = [];
  let given = 0, plain = 0, tinted = 0, kept = 0, untold = 0;
  const tints = [];
  function colour(m, o, k) {
    const y = drawn(m, o);
    if (y === undefined) return false;
    if (y === null) { untold += 1; return true; }
    const f = tintFor(y, k.range);
    if (f === 1) kept += 1; else { tint(m, f); tinted += 1; if (tints.length < 400) tints.push([k.material, Math.round(y * 1000) / 1000, Math.round(f * 100) / 100]); }
    return true;
  }
  function apply(root) {
    let n = 0;
    for (let i = waiting.length - 1; i >= 0; i -= 1) { const [m, o, k] = waiting[i]; if (!o.parent || colour(m, o, k)) waiting.splice(i, 1); }
    root?.traverse?.((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || seen.has(m)) continue;
        const s = surfaceOf(o, m);
        if (!s) continue;                    // (not said yet what it is: looked at again next time)
        seen.add(m);
        const k = opticsFor(catalogue, s);
        if (!k) { plain += 1; continue; }
        set(m, k.roughness, k.specular); n += 1; by.set(k.material, (by.get(k.material) || 0) + 1);
        if (drawn && tint && k.range && !colour(m, o, k) && waiting.length < 4000) waiting.push([m, o, k]);
      }
    });
    given += n;
    return n;
  }
  return { apply, stats: () => ({ given, plain, tinted, kept, untold, waiting: waiting.length, by: Object.fromEntries(by), tints: tints.slice() }) };
}
