// How each material meets the sun: its own roughness and its own share of mirrored light.
//
// The street's surfaces are lit plainly (matt light, shadows, the bounce) with one highlight put
// back for the sun (module 02, PROXY_LIGHT.patch). That highlight used every material's drawn
// roughness and one figure, 4%, for what any of them mirrors. Here each material takes its own
// from the object catalogue (docs/object-catalogue.json, ``optics``): painted steel throws a
// tighter, brighter glint than stucco, a leaf more than bark, bare aluminium most of all, and
// asphalt only glares towards a low sun.
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
  return { roughness: Math.max(0.03, Math.min(1, o.roughness)), specular: Math.max(0, Math.min(1, o.specular)), material: a.material };
}

//: A tree's leaves are its crown's, not its trunk's (as object-catalogue.mjs reads them).
function surfaceOf(o, material) {
  const s = o.userData?.surface ?? o.parent?.userData?.surface;
  if (!s) return null;
  return String(s).startsWith("tree:") && material?.alphaTest > 0 ? String(s).replace(/^tree:/, "foliage:") : s;
}

//: ``apply(root)`` gives every material under ``root`` not yet seen its figures (``set(material,
//: roughness, specular)``); the number newly given. Cheap to call again: a seen material is passed.
export function createReflectance({ catalogue, set }) {
  const seen = new WeakSet(), by = new Map();
  let given = 0, plain = 0;
  function apply(root) {
    let n = 0;
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
      }
    });
    given += n;
    return n;
  }
  return { apply, stats: () => ({ given, plain, by: Object.fromEntries(by) }) };
}
