// Installed into the page by capture.mjs: window.__cover.tile(x0, z0, size, px) draws the square
// of ground with its north-west corner at (x0, z0), size metres a side, px pixels a side, from
// straight above with every surface in its class's flat colour, and returns one byte a pixel.
(() => {
  const k = window.kerbside, T = k.THREE;
  const CLASSES = ["none", "bare", "road", "paving", "grass", "building", "water", "service", "outside", "other", "structure"];
  const id = (name) => CLASSES.indexOf(name);
  const classOf = (o) => {
    const key = String(o.userData.mergeKey || o.userData.surface || o.name || "").split("|")[0];
    if (key === "terrain") return "bare";
    if (key.startsWith("perimeter")) return "outside";
    for (let p = o; p; p = p.parent) if (p === k.groups.furniture || p.name === "walking-character-avatar" || p === k.groups.districts) return null;
    if (/^(tree|furniture|contact-shadow|roof_furniture|sign|awning|tunnel_light|fence|neck|torso)/.test(key)) return null;
    if (/^(tunnel_road|tunnel_floor|tunnel_marking|junction|bus_zone|tunnel$)/.test(key)) return "road";
    if (/^(median|tunnel_walk|tunnel_portal|tunnel_cut_wall)/.test(key)) return "paving";
    if (/^footprint/.test(key)) return "building";
    if (/water|bay|sea|ocean|landwater/.test(key)) return "water";
    if (/^(ribbon:road|road|marking|busway|bike|parking_lot|parking_bays|tunnel_road|crossing:stop|arrow)/.test(key) || key.startsWith("ribbon:crossing") || key === "crossing") return "road";
    if (/^(walk|kerb|reconstructed:curb|crossing:|ribbon:sidewalk|plaza|front_walk|pier|beach|court|divider|transit_island|bridge_headland)/.test(key)) return "paving";
    if (key.startsWith("inferred:")) return { paving: "paving", grass: "grass", asphalt: "road", service: "service" }[key.slice(9)] || "paving";
    if (/^(park|yard|lawn|pitch)/.test(key)) return "grass";
    if (/^service_yard|neutral_ground/.test(key)) return "service";
    if (/^(wall|roof|garage|plane|part|building|home|house)/.test(key)) return "building";
    if (/^bridge/.test(key)) return "structure";
    return "other";
  };
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  window.__cover = {
    CLASSES,
    tile(x0, z0, size, px) {
      const saved = [], unknown = new Map();
      const mats = new Map();
      const matFor = (c, orig) => {
        const key = c + ":" + (orig.depthTest === false ? 0 : 1) + (orig.side ?? 0);
        if (!mats.has(key)) mats.set(key, new T.MeshBasicMaterial({ color: new T.Color(id(c) / 255, 0, 0), side: T.DoubleSide, depthTest: orig.depthTest !== false }));
        return mats.get(key);
      };
      k.scene.traverse((o) => {
        if (!(o.isMesh || o.isSprite || o.isLine || o.isPoints)) return;
        const c = (o.isMesh) ? classOf(o) : null;
        const forced = o.isMesh && k.DETAIL_RANGE_M[o.userData.surface] !== undefined;
        saved.push([o, o.material, o.visible]);
        if (!c || !o.isMesh) { o.visible = false; return; }
        if (forced) o.visible = true;
        if (c === "other") { const key = String(o.userData.mergeKey || o.userData.surface || o.name || "?").split("|")[0]; unknown.set(key, (unknown.get(key) || 0) + 1); }
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        o.material = matFor(c, m);
      });
      // Looking straight down: x right, z down the image.
      const camera = new T.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, 6000);
      camera.position.set(x0 + size / 2, 3000, z0 + size / 2); camera.up.set(0, 0, -1); camera.lookAt(x0 + size / 2, 0, z0 + size / 2);
      camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      const rt = new T.WebGLRenderTarget(px, px);
      const r = k.renderer, bg = k.scene.background, fog = k.scene.fog;
      k.scene.background = new T.Color(0, 0, 0); k.scene.fog = null;
      r.setRenderTarget(rt); r.setClearColor(0x000000, 1); r.clear(); r.render(k.scene, camera);
      const buf = new Uint8Array(px * px * 4); r.readRenderTargetPixels(rt, 0, 0, px, px, buf); r.setRenderTarget(null); rt.dispose();
      k.scene.background = bg; k.scene.fog = fog;
      for (const [o, m, v] of saved) { o.material = m; o.visible = v; }
      const out = new Uint8Array(px * px);
      // Render targets are bottom-up: flip so row 0 is the tile's north edge (smallest z).
      for (let y = 0; y < px; y += 1) for (let x = 0; x < px; x += 1) out[y * px + x] = buf[((px - 1 - y) * px + x) * 4];
      let s = ""; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      return { data: btoa(s), unknown: [...unknown].slice(0, 20) };
    },
  };
  return "installed";
})()
