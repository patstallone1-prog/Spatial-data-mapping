// What things look like: each shop item, held, lying on the ground or stocked on a shelf, drawn
// with its model from docs/city/objects.json (scripts/build_city_objects.mjs, the user's object
// lab: Kenney, Poly Haven and Poly Pizza, CC0), at the catalogue's size (rules.json items
// length_m), standing on its own bottom. A dish or a pack is composed of the lab's models (a
// plate and what is on it; six cans). An item the lab found no fit model for keeps the page's own
// drawn shape -- the plan's rule: a differently named model is not the thing.
//
// The pure part (bindingOf, itemScale, tierFor, projectedPx) is tested in tests/city_objects.test.mjs;
// objectKit is the three.js side: models fetched once each, on first use, never at start.

//: The binding for item ``sku``: { asset } or { recipe }, its ``tint`` and ``status``; null when
//: the item is drawn by the page (no fit model, a service, unknown).
export function bindingOf(O, sku) {
  const b = O?.items?.[sku];
  if (!b) return null;
  if (b.recipe) return b;
  if (!b.asset || !O.assets[b.asset]) return null;
  return b;
}

//: The longest side (m) of what ``binding`` draws at the model's own size: the asset's, or for a
//: composition the span of its base and parts as the recipe places them.
export function naturalLength(O, binding) {
  if (!binding) return 0;
  if (!binding.recipe) return Math.max(...O.assets[binding.asset].dims);
  const r = binding.recipe;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
  const add = (x, z, len, h) => { x0 = Math.min(x0, x - len / 2); x1 = Math.max(x1, x + len / 2); z0 = Math.min(z0, z - len / 2); z1 = Math.max(z1, z + len / 2); y1 = Math.max(y1, h); };
  if (r.base) add(0, 0, r.base.len, r.base.len * 0.3);
  for (const p of r.parts) add(p.x || 0, p.z || 0, p.len, p.len);
  return Math.max(x1 - x0, z1 - z0, y1);
}

//: The scale that brings ``binding`` to item ``sku``'s catalogue length (rules items length_m);
//: 1 when the catalogue gives none.
export function itemScale(O, R, sku, binding = bindingOf(O, sku)) {
  const want = R?.items?.[sku]?.length_m, have = naturalLength(O, binding);
  return want > 0 && have > 0 ? want / have : 1;
}

//: How many pixels tall something ``size`` metres across looks ``dist`` metres away, with a
//: vertical field of view ``fovDeg`` on a viewport ``viewH`` pixels high.
export function projectedPx(size, dist, fovDeg, viewH) {
  const d = Math.max(0.05, dist);
  return (size / (2 * d * Math.tan((fovDeg * Math.PI) / 360))) * viewH;
}

//: Which tier to draw at ``px`` (projectedPx): "near" over L.near_px, "far" over L.far_px, "cull"
//: under L.cull_px -- each threshold crossed by a share L.hysteresis past it, so a thing on the
//: line does not flicker between two. ``was``: the tier it had.
export function tierFor(px, was, L) {
  const h = L.hysteresis ?? 0.15;
  const up = (t) => t * (1 + h), down = (t) => t * (1 - h);
  if (was === "near") return px >= down(L.near_px) ? "near" : px >= down(L.far_px) ? "far" : px >= L.cull_px ? "far" : "cull";
  if (was === "far") return px >= up(L.near_px) ? "near" : px >= down(L.far_px) ? "far" : px >= down(L.cull_px) ? "far" : "cull";
  if (was === "cull") return px >= up(L.near_px) ? "near" : px >= up(L.cull_px) ? "far" : "cull";
  return px >= L.near_px ? "near" : px >= L.cull_px ? "far" : "cull";
}

//: A held tool stands upright: the model is turned so its longest side is up (a hammer scanned
//: lying on a table is held by its handle). ``dims``: [x, y, z] of the model.
export function uprightTurn(dims) {
  const [x, y, z] = dims;
  if (y >= Math.max(x, z) * 0.8) return null;
  return x >= z ? { axis: "z", angle: Math.PI / 2 } : { axis: "x", angle: Math.PI / 2 };
}

// ---- three.js -----------------------------------------------------------------------------------

//: The kit: ``ctx`` gives loadModel(url) (a GLTFLoader with the meshopt decoder) and asset(path).
export function objectKit(THREE, ctx, O, R) {
  const models = new Map();   // asset id -> Promise<{near, far}>
  const tinted = new Map();   // material uuid + tint -> material
  const lit = (m) => {
    // The lab's materials, kept; the city's light is Lambert-like, so a scan's roughness map is
    // honoured but its environment reflection is not wanted.
    if (m && "envMapIntensity" in m) m.envMapIntensity = 0.5;
    return m;
  };
  function load(id) {
    if (models.has(id)) return models.get(id);
    const a = O.assets[id];
    const p = !a || !ctx.loadModel ? Promise.resolve(null) : ctx.loadModel(ctx.asset(`city/models/objects/${a.file}`)).then((gltf) => {
      const scene = gltf.scene;
      const near = scene.getObjectByName("near") || scene, far = scene.getObjectByName("far") || null, low = scene.getObjectByName("low") || null;
      for (const t of [near, far, low]) t?.traverse((o) => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map(lit) : lit(o.material); o.castShadow = true; o.receiveShadow = true; } });
      near.removeFromParent(); far?.removeFromParent(); low?.removeFromParent();
      near.position.set(0, 0, 0); far?.position.set(0, 0, 0); low?.position.set(0, 0, 0);
      return { near, far, low };
    }).catch((error) => { console.warn("kerbside: an object model did not load", id, error); return null; });
    models.set(id, p);
    return p;
  }
  function tint(o, colour, glass = false) {
    if (!colour) return;
    const c = new THREE.Color(colour);
    o.traverse((m) => {
      if (!m.isMesh) return;
      const swap = (mat) => {
        const key = `${mat.uuid}:${colour}:${glass}`;
        if (!tinted.has(key)) {
          const t = mat.clone();
          // A label: the pack's colour over the model's own, its shading kept.
          if (t.color) t.color.copy(c);
          if (glass) { t.transparent = true; t.opacity = 0.55; t.depthWrite = false; }
          tinted.set(key, t);
        }
        return tinted.get(key);
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
  }
  //: Parts of one model painted per product (``paint`` {material name pattern: colour}): one
  //: spice jar is every spice, its contents the spice's colour. Painted materials are kept per
  //: colour, shared by every jar of that spice.
  function paint(o, plan) {
    const rules = Object.entries(plan).map(([rx, colour]) => [new RegExp(rx), colour]);
    o.traverse((m) => {
      if (!m.isMesh) return;
      const swap = (mat) => {
        const hit = rules.find(([rx]) => rx.test(mat.name || ""));
        if (!hit) return mat;
        const key = `${mat.uuid}:paint:${hit[1]}`;
        if (!tinted.has(key)) { const t = mat.clone(); t.map = null; t.color?.set(hit[1]); tinted.set(key, t); }
        return tinted.get(key);
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
  }
  //: A copy of asset ``id``'s tier, scaled so its longest side is ``len`` (m), its bottom at y 0.
  async function piece(id, len, tier = "near") {
    const m = await load(id);
    if (!m) return null;
    // "low": a store product's lowest tier (a stocked shelf), else its far one.
    const src = (tier === "low" && (m.low || m.far)) || (tier === "far" && m.far) || m.near;
    const o = src.clone(true);
    const dims = O.assets[id].dims, s = len / Math.max(...dims);
    o.scale.setScalar(s);
    return o;
  }
  //: Item ``sku`` as a group at its catalogue size, its bottom-centre at the origin; null when it
  //: has no model (the caller draws its own).
  async function build(sku, { tier = "near", upright = false } = {}) {
    const b = bindingOf(O, sku);
    if (!b) return null;
    const g = new THREE.Group();
    g.name = `object:${sku}`;
    if (b.recipe) {
      const r = b.recipe;
      let baseH = 0;
      if (r.base) {
        const base = await piece(r.base.asset, r.base.len, tier);
        if (!base) return null;
        if (r.base.squash) base.scale.y *= r.base.squash;
        g.add(base);
        const d = O.assets[r.base.asset].dims;
        baseH = d[1] * (r.base.len / Math.max(...d)) * (r.base.squash || 1);
      }
      for (const p of r.parts) {
        const o = await piece(p.asset, p.len, tier);
        if (!o) continue;
        if (p.lie) o.rotation.z = Math.PI / 2;
        if (p.tilt) o.rotation.x = p.tilt;
        o.rotation.y = p.yaw || 0;
        o.position.set(p.x || 0, baseH * (r.on ?? 0.55) + (p.y || 0), p.z || 0);
        if (p.tint) tint(o, p.tint);
        g.add(o);
      }
    } else {
      const o = await piece(b.asset, Math.max(...O.assets[b.asset].dims), tier);
      if (!o) return null;
      if (b.tint) tint(o, b.tint, b.glass);
      if (b.paint) paint(o, b.paint);
      if (upright) {
        const turn = uprightTurn(O.assets[b.asset].dims);
        if (turn) {
          o.rotation[turn.axis] = turn.angle;
          // Back on its bottom after the turn.
          o.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(o);
          o.position.y -= box.min.y; o.position.x -= (box.min.x + box.max.x) / 2; o.position.z -= (box.min.z + box.max.z) / 2;
        }
      }
      g.add(o);
    }
    g.scale.setScalar(itemScale(O, R, sku, b));
    g.userData.binding = b;
    return g;
  }
  //: ``holder`` (a group with the page's own drawn shape in it) gets the model in place of that
  //: shape once it is in. Returns the promise; the holder is left as it was if there is none.
  function dress(holder, sku, opts = {}) {
    if (!bindingOf(O, sku)) return Promise.resolve(false);
    return build(sku, opts).then((g) => {
      if (!g || holder.userData.dressedAs === sku) return false;
      if (opts.centre) {
        g.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(g);
        g.position.y = -(box.min.y + box.max.y) / 2;
      }
      for (const c of holder.children.slice()) if (!c.userData?.keep) holder.remove(c);
      holder.add(g);
      holder.userData.dressedAs = sku;
      return true;
    });
  }
  //: Stock for a shelf: one InstancedMesh per mesh of item ``sku``'s model (tier ``tier``), up to
  //: ``count`` of them. Returns { group, set(i, matrix), count(n) } or null (no model).
  async function instanced(sku, count, tier = "near") {
    const g = await build(sku, { tier });
    if (!g) return null;
    g.updateMatrixWorld(true);
    const parts = [];
    g.traverse((o) => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, local: o.matrixWorld.clone() }); });
    const group = new THREE.Group();
    group.name = `stock:${sku}`;
    const meshes = parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, count);
      im.count = 0; im.castShadow = false; im.receiveShadow = true;
      group.add(im);
      return im;
    });
    const tmp = new THREE.Matrix4();
    return {
      group,
      set(i, m) { meshes.forEach((im, k) => { tmp.multiplyMatrices(m, parts[k].local); im.setMatrixAt(i, tmp); }); },
      count(n) { for (const im of meshes) { im.count = n; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); } },
      height: (() => { const box = new THREE.Box3().setFromObject(g); return box.max.y - box.min.y; })(),
    };
  }
  return { load, build, dress, instanced, has: (sku) => Boolean(bindingOf(O, sku)), lod: O.lod };
}
