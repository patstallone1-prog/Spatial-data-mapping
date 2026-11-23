// Water above and below the street (smc/waterworks): streams in their beds, the concrete gutter
// along every kerb, each storm drain as it is built (an opening in the kerb face over a grate in
// the gutter, an opening alone, a flat grate, a trench slot), the wet line of the gutter leading
// down to it, sewer lids fixed flush in the road, water tanks and towers, and a treatment plant's
// clarifiers and open basins. Pipes, cisterns and buried reservoirs are data only.
// Copied to docs/waterworks-renderer.mjs by scripts/build_waterworks.py; the page imports it with
// THREE and its own ground, kerbs and roads, so nothing here knows the page.

//: Sizes, metres. A San Francisco catch basin's curb opening is about 3 ft long; its grate 36 x
//: 18 in; a gutter pan 18 in; a sewer lid 26 in across (SFPUC standard plans).
export const SIZE = {
  curbOpening: 0.95, openingH: 0.085, openingDeep: 0.12,
  grateAlong: 0.9, grateAcross: 0.46, apronAlong: 1.9, apronAcross: 0.75,
  roundGrate: 0.33, trenchAlong: 3.0, trenchAcross: 0.22, lid: 0.33,
  gutter: 0.46, wetRun: 9.0, kerbReach: 3.5,
};
const COLOUR = {
  iron: 0x2e2c29, slot: 0x080807, gutter: 0x8c8a83, apron: 0x7f7c75, wet: 0x262a2c,
  creek: 0x3f5a52, river: 0x3b5d6a, dry: 0x9c9077, bank: 0x5a4d3a,
  tank: 0xc4c2b2, tower: 0xb9c1bd, concrete: 0xb3b0a6, effluent: 0x56623f, clear: 0x4b6a72,
};

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// -- pure geometry (tested without a page) ------------------------------------------------------------

//: How far a drain's opening keeps from a sign post at the kerb (m): the post's foot and the
//: opening's half-length.
const POST_CLEAR_M = 0.75;
//: How a drain stands at the kerb: its centre in the gutter, the way along the kerb, the way out
//: of the road. ``kerb`` is the page's nearest kerb ({x, z, nx, nz, ax, az}) or null.
export function seatDrain(form, x, z, kerb) {
  const atKerb = kerb && Math.hypot(kerb.x - x, kerb.z - z) <= SIZE.kerbReach;
  if (!atKerb) return { x, z, ax: kerb ? kerb.ax : 1, az: kerb ? kerb.az : 0, nx: 0, nz: 0, atKerb: false };
  const inGutter = form === "curb_opening" ? 0 : SIZE.grateAcross / 2 + 0.02;
  return { x: kerb.x - kerb.nx * inGutter, z: kerb.z - kerb.nz * inGutter, kx: kerb.x, kz: kerb.z,
    ax: kerb.ax, az: kerb.az, nx: kerb.nx, nz: kerb.nz, atKerb: true };
}

//: Which ways along the kerb water runs down to a drain: a side whose gutter rises away from it
//: drains into it. ``height(x, z)`` is the ground. Both when the street is flat (crowned and
//: pitched to it), neither only when the drain stands on a crest.
export function uphillSides(seat, height, run = SIZE.wetRun) {
  const h0 = height(seat.x, seat.z);
  const sides = [];
  for (const s of [1, -1]) {
    const h = height(seat.x + seat.ax * run * s, seat.z + seat.az * run * s);
    if (h - h0 > -0.02) sides.push({ side: s, rise: h - h0 });
  }
  return sides;
}

//: A ribbon down a polyline, ``width`` wide, at ``y(x, z)``: positions and indices.
export function ribbon(points, width, y) {
  const pos = [], idx = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const [x, z] = points[i];
    const h = y(x, z);
    pos.push(x - dz * width / 2, h, z + dx * width / 2, x + dz * width / 2, h, z - dx * width / 2);
    // Wound to face up: seen from above, not culled as the underside.
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  return { pos, idx };
}

// -- textures ---------------------------------------------------------------------------------------------

function canvas(doc, w, h, draw) {
  if (!doc?.createElement) return null;
  const c = doc.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g, w, h);
  return c;
}

function grateTexture(THREE, doc) {
  const c = canvas(doc, 128, 64, (g, w, h) => {
    g.fillStyle = "#2b2926"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#070707";
    // Bars across the flow, the way a bicycle-safe grate's are.
    for (let x = 10; x < w - 8; x += 9) g.fillRect(x, 7, 5, h - 14);
    g.strokeStyle = "#3f3c37"; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
  });
  return c ? asColour(THREE, new THREE.CanvasTexture(c)) : null;
}

//: A painted canvas is colour, in sRGB: read as linear data it comes out washed pale (a cast
//: iron lid drawn silver).
function asColour(THREE, texture) {
  texture.anisotropy = 4;
  if ("colorSpace" in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function gutterTexture(THREE, doc) {
  const c = canvas(doc, 192, 32, (g, w, h) => {
    g.fillStyle = "#8c8a83"; g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i += 1) {
      const v = 120 + Math.floor(rnd() * 70);
      g.fillStyle = `rgba(${v},${v - 2},${v - 8},0.35)`;
      g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 2), 1);
    }
    // The darker lip against the kerb, where grit lies, and the joint scored across the pan.
    g.fillStyle = "rgba(70,68,62,0.35)"; g.fillRect(0, 0, w, 3);
    g.fillStyle = "rgba(55,53,48,0.8)"; g.fillRect(0, 0, 2, h);
  });
  if (!c) return null;
  const t = asColour(THREE, new THREE.CanvasTexture(c));
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function lidTexture(THREE, doc, word) {
  const c = canvas(doc, 128, 128, (g, w) => {
    const r = w / 2;
    g.fillStyle = "#3b3935"; g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#57534d"; g.lineWidth = 2;
    for (const k of [0.92, 0.72, 0.52]) { g.beginPath(); g.arc(r, r, r * k, 0, Math.PI * 2); g.stroke(); }
    // The cast pattern: a raised grid of little diamonds for grip.
    g.fillStyle = "#4c4944";
    for (let y = 8; y < w; y += 9) for (let x = 8; x < w; x += 9) {
      if (Math.hypot(x - r, y - r) > r * 0.88 || Math.abs(y - r) < 13) continue;
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    g.fillStyle = "#6a665e"; g.font = "bold 17px Arial, Helvetica, sans-serif"; g.textAlign = "center";
    g.textBaseline = "middle"; g.fillText(word, r, r);
  });
  return c ? asColour(THREE, new THREE.CanvasTexture(c)) : null;
}

//: How far over the road the gutter pan is laid: clear of where the road's chords and its own
//: part on a hill (see the gutters, below).
export const GUTTER_LIFT_M = 0.03;
//: How far a gutter sample may be moved to reach the kerb the page drew (m).
export const GUTTER_SNAP_M = 1.2;
//: How far past a kerb the roadway may come back for that kerb to be an island's (m): a median
//: or a traffic island has no gutter pan of its own -- a pan laid along one was a flat olive strip
//: down the middle of Lombard Street and over Richardson Avenue's centre lines (2026-11-22).
export const ISLAND_REACH_M = 4;
//: Is the kerb at (x, z), facing out of the road along (nx, nz), an island's: roadway again
//: within ISLAND_REACH_M behind it?
export function islandKerb(onRoad, x, z, nx, nz, reach = ISLAND_REACH_M) {
  for (let d = 1; d <= reach + 1e-9; d += 0.75) if (onRoad(x + nx * d, z + nz * d, 0)) return true;
  return false;
}
//: The pan's concrete, a tile JOINT_M long: a weathered grey with its grain and the scored joint
//: across it, not one flat colour (a flat olive band read as paint, or a hole, beside the walk).
export const GUTTER_JOINT_M = 3;
//: How far the wet line leading to a drain may be from the kerb the page drew and still go on (m).
export const WET_KERB_M = 0.6;

//: Kerb segments ([ax, az, bx, bz, half]) as blocks: runs that go straight on, end to start,
//: at one width -- a street between two corners, however many pieces its line is drawn in.
export function kerbBlocks(segments, { turn = 0.07, gap = 0.6 } = {}) {
  const blocks = [];
  let block = null, last = null;
  for (const seg of segments) {
    const [ax, az, bx, bz, half] = seg, len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0)) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const on = last && Math.hypot(ax - last.bx, az - last.bz) < gap && Math.abs(half - last.half) < 0.6
      && ux * last.ux + uz * last.uz > Math.cos(turn);
    if (!on) { block = []; blocks.push(block); }
    block.push(seg);
    last = { bx, bz, ux, uz, half };
  }
  return blocks;
}
//: How far out from a street's middle its kerb stands: the first place, going out from 2.5 m
//: inside the nominal half-width to 2.5 m beyond it, where ``road(o)`` (is it roadway, o metres
//: out?) stops being true -- to a tenth of a metre -- or null where the roadway does not stop
//: (a junction's mouth) or is not there.
export function kerbOffset(road, half, reach = 2.5) {
  let o = Math.max(0.6, half - reach);
  if (!road(o)) return null;
  for (o += 0.5; o <= half + reach + 1e-9; o += 0.5) {
    if (road(o)) continue;
    let lo = o - 0.5, hi = o;
    while (hi - lo > 0.1) { const mid = (lo + hi) / 2; if (road(mid)) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  return null;
}
//: Which samples of a kerb's line carry the gutter: the kerbed ones, with breaks of up to
//: ``fill`` samples between two kerbed stretches closed (a driveway, a sample that fell on the
//: wrong side of a wobble), and stretches shorter than ``least`` left out (a scrap is not a gutter).
export function gutterRuns(kerbed, { fill = 9, least = 5 } = {}) {
  const keep = kerbed.map(Boolean), n = keep.length;
  for (let i = 0; i < n;) {
    if (keep[i]) { i += 1; continue; }
    let j = i;
    while (j < n && !keep[j]) j += 1;
    if (i > 0 && j < n && j - i <= fill) for (let k = i; k < j; k += 1) keep[k] = true;
    i = j;
  }
  for (let i = 0; i < n;) {
    if (!keep[i]) { i += 1; continue; }
    let j = i;
    while (j < n && keep[j]) j += 1;
    if (j - i < least) for (let k = i; k < j; k += 1) keep[k] = false;
    i = j;
  }
  return keep;
}

// -- the drawing ------------------------------------------------------------------------------------------

export function buildWaterworks(THREE, tiles, {
  place, ground, roadTop = 0.06, kerbH = 0.126, kerb = () => null, onRoad = () => false, postNear = () => false,
  wet = () => false, kerbSegments = () => [], inArea = () => true, document: doc = globalThis.document,
  headset = false, gutterSeen = () => true,
} = {}) {
  const group = new THREE.Group();
  group.name = "waterworks";
  const routesOf = new Map();
  const counts = { streams: 0, drains: 0, lids: 0, lids_inferred: 0, gutters_m: 0, tanks: 0, towers: 0,
    clarifiers: 0, digesters: 0, basins: 0, plants: 0, underground: 0 };
  const forms = {};
  const near = [];
  const textures = [];
  const keep = (t) => { if (t) textures.push(t); return t; };
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
  const ironMat = std(COLOUR.iron, { roughness: 0.75, metalness: 0.15 });
  const slotMat = std(COLOUR.slot, { roughness: 1 });
  const grateMap = keep(grateTexture(THREE, doc));
  const grateMat = std(grateMap ? 0xffffff : COLOUR.iron, { map: grateMap, roughness: 0.75, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const apronMat = std(COLOUR.apron, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  const lidMats = {};
  const lidMat = (system) => {
    const word = system === "storm" ? "STORM" : system === "water" ? "WATER" : "SEWER";
    if (!lidMats[word]) {
      const map = keep(lidTexture(THREE, doc, word));
      lidMats[word] = std(map ? 0xffffff : COLOUR.iron, { map, roughness: 0.75, metalness: 0.15 });
    }
    return lidMats[word];
  };
  const level = (x, z) => ground(x, z);
  const surfaceAt = (x, z) => {
    if (onRoad(x, z)) return level(x, z) + roadTop;
    const k = kerb(x, z, 6);
    return level(x, z) + (k ? roadTop + kerbH : 0.03);
  };

  const all = (key) => tiles.flatMap((t) => (Array.isArray(t?.[key]) ? t[key].map((row) => [row, t]) : []));

  // ---- streams --------------------------------------------------------------------------------------
  const streamPos = { creek: [], river: [], dry: [], bank: [] };
  const streamIdx = { creek: [], river: [], dry: [], bank: [] };
  const push = (key, { pos, idx }) => {
    const base = streamPos[key].length / 3;
    streamPos[key].push(...pos);
    for (const i of idx) streamIdx[key].push(base + i);
  };
  for (const [s] of all("streams")) {
    if (s.under || !Array.isArray(s.c)) continue;
    const pts = s.c.map(([lon, lat]) => { const p = place(lon, lat); return [p.x, p.z]; });
    // A run in the open: off the roads (a creek under a street is in its culvert) and out of
    // water the map already draws (a river between its mapped banks).
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const w = Math.max(0.6, Math.min(s.w || 2, 40));
        const key = s.intermittent ? "dry" : w >= 8 ? "river" : "creek";
        push("bank", ribbon(run, w + Math.min(2.4, 0.6 + w * 0.4), (x, z) => level(x, z) + 0.035));
        push(key, ribbon(run, w, (x, z) => level(x, z) + 0.05));
        counts.streams += 1;
      }
      run = [];
    };
    for (let i = 0; i < pts.length; i += 1) {
      const [x, z] = pts[i];
      if (i) {   // densify, so the bed follows the ground between mapped points
        const [px, pz] = pts[i - 1];
        const n = Math.min(40, Math.floor(Math.hypot(x - px, z - pz) / 4));
        for (let k = 1; k < n; k += 1) {
          const qx = px + (x - px) * k / n, qz = pz + (z - pz) * k / n;
          if (!inArea(qx, qz) || onRoad(qx, qz) || wet(qx, qz)) flush(); else run.push([qx, qz]);
        }
      }
      if (!inArea(x, z) || onRoad(x, z) || wet(x, z)) flush(); else run.push([x, z]);
    }
    flush();
  }
  const streamMat = {
    creek: std(COLOUR.creek, { roughness: 0.25, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }),
    river: std(COLOUR.river, { roughness: 0.2, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }),
    dry: std(COLOUR.dry, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
    bank: std(COLOUR.bank, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  for (const key of ["bank", "dry", "creek", "river"]) {
    if (!streamIdx[key].length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(streamPos[key], 3));
    g.setIndex(streamIdx[key]);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, streamMat[key]);
    mesh.name = `waterworks-stream-${key}`;
    mesh.userData = { surface: key === "bank" ? "waterworks:stream_bank" : "waterworks:stream" };
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- gutters: a concrete pan along every kerb, falling to the kerb ---------------------------------------
  if (!headset) {
    const pos = [], idx = [], uv = [];
    // A metre a vertex, half the terrain grid's step, and a hand's width over the ground. The
    // road under it is cut on the terrain grid and runs straight between its nodes; the pan,
    // sampled every two metres at a few millimetres over the ground, ran straight between points
    // of its own, and on a hill the two crossed: the asphalt came up through the pan in patches
    // and the grey strip along the kerb was left in jagged pieces (Walnut Street by the Oxford
    // Tract). Over the road by GUTTER_LIFT_M it clears the road's own chords; a pan is flush with
    // the road, and three centimetres under a thirteen-centimetre kerb does not read as a step.
    const step = 1;
    // A gutter is one straight strip along a block, beside the kerb, from one corner to the
    // next. It was laid sample by sample at the street's nominal half-width, kept or dropped at
    // each by whether the roadway happened to stop just there: where the drawn kerb stood a
    // little further out or in than the nominal line the pan came and went every metre or two
    // -- 2,385 pieces along the Marina's kerbs, with ragged ends (2026-11-19). Now, for each run
    // of street that goes straight on (a block), the kerb's real distance out is found at every
    // few metres, their middle one taken for the whole block, and the pan laid on that line;
    // breaks shorter than a driveway or two are closed and scraps shorter than a car left out.
    for (const block of kerbBlocks(kerbSegments())) {
      for (const side of [1, -1]) {
        // The kerb's distance from the street's middle, measured along the block.
        const found = [];
        for (const [ax, az, bx, bz, half] of block) {
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 1 || half < 1.2) continue;
          const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz * side, nz = ux * side;
          for (let t = Math.min(1.5, len / 2); t < len; t += 3) {
            const e = kerbOffset((o) => onRoad(ax + ux * t + nx * o, az + uz * t + nz * o, 0.3), half);
            if (e !== null && inArea(ax + ux * t + nx * e, az + uz * t + nz * e)) found.push(e);
          }
        }
        // (Where the roadway cannot be asked for -- a page that gives none -- the nominal line,
        // as before.)
        const measured = found.length >= 2;
        if (!measured) for (const seg of block) found.push(seg[4]);
        if (!found.length) continue;
        found.sort((a, b) => a - b);
        const out = found[Math.floor(found.length / 2)];
        // Where the kerb is there at all (not across a junction's mouth), a metre at a time.
        // Each sample is then put on the kerb the page DREW (``kerb``: the nearest point of a
        // drawn carriageway edge and the way out of the road there), not on the line the
        // roadway test gave: that test is asked with 0.3 m of slack, and the block's middle
        // offset is not the kerb where the kerb wanders, so the pan lay up to half a metre out
        // in the road with a strip of asphalt between it and the kerb -- a second, pale kerb in
        // the street (Chestnut Street, 2026-11-22) -- and where the kerb stepped out round a bus
        // stop it ran straight on across the bus box. On the drawn kerb it turns with it; where
        // no drawn kerb faces this side within reach, there is no pan.
        const samples = [];
        let snapped = 0;
        for (const [ax, az, bx, bz, half] of block) {
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 1 || half < 1.2) continue;
          const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz * side, nz = ux * side;
          const n = Math.max(1, Math.ceil(len / step));
          for (let i = 0; i <= n; i += 1) {
            const t = Math.min(len, i * step), ex = ax + ux * t + nx * out, ez = az + uz * t + nz * out;
            const k = kerb(ex, ez, GUTTER_SNAP_M);
            const facing = k && Number.isFinite(k.x) && Number.isFinite(k.nx) && k.nx * nx + k.nz * nz > 0.8
              && Math.hypot(k.x - ex, k.z - ez) <= GUTTER_SNAP_M;
            if (facing) snapped += 1;
            const s = facing
              ? { ex: k.x, ez: k.z, nx: k.nx, nz: k.nz, onKerb: true, kerbed: inArea(k.x, k.z) }
              : { ex, ez, nx, nz, onKerb: false, kerbed: inArea(ex, ez) && !onRoad(ex + nx * 0.45, ez + nz * 0.45, 0.3) && (!measured || onRoad(ex - nx * 0.6, ez - nz * 0.6, 0.3)) };
            // (A median's or an island's kerb: no pan.)
            if (s.kerbed && measured && islandKerb(onRoad, s.ex, s.ez, s.nx, s.nz)) s.kerbed = false;
            samples.push(s);
          }
        }
        // (A page that draws kerbs: only the samples on one carry the pan. One that gives none --
        // a test, the headset's -- keeps the line as found.)
        if (snapped) for (const s of samples) if (!s.onKerb) s.kerbed = false;
        // And only where the photograph shows a pan (``gutterSeen``): a kerb that meets the
        // asphalt has none.
        for (const s of samples) if (s.kerbed && !gutterSeen(s.ex, s.ez)) s.kerbed = false;
        const keep = gutterRuns(samples.map((s) => s.kerbed));
        let open = false, along = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const s = samples[i];
          // (A break closed over samples that found no drawn kerb is still left open: they lie
          // where the line was, not on a kerb, out in the road round a bulb.)
          if (!keep[i] || (snapped && !s.onKerb)) { open = false; continue; }
          // (Two samples at one place, where one piece of the block ends and the next begins.)
          if (open && i && Math.hypot(s.ex - samples[i - 1].ex, s.ez - samples[i - 1].ez) < 0.05) continue;
          const y = level(s.ex, s.ez) + roadTop;
          const base = pos.length / 3;
          along = open ? along + Math.hypot(s.ex - samples[i - 1].ex, s.ez - samples[i - 1].ez) : 0;
          pos.push(s.ex - s.nx * 0.01, y + GUTTER_LIFT_M, s.ez - s.nz * 0.01,
            s.ex - s.nx * SIZE.gutter, y + GUTTER_LIFT_M + 0.004, s.ez - s.nz * SIZE.gutter);
          uv.push(along / GUTTER_JOINT_M, 0, along / GUTTER_JOINT_M, 1);
          if (open) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
          counts.gutters_m += open ? step : 0;
          open = true;
        }
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      // Painted onto the road without writing depth, before the drains: a grate or a lid always
      // lies on the pan, never under it, whatever a few millimetres of interpolation say.
      const panMap = keep(gutterTexture(THREE, doc));
      const mesh = new THREE.Mesh(g, std(panMap ? 0xffffff : COLOUR.gutter,
        { map: panMap, polygonOffset: true, polygonOffsetFactor: -1, depthWrite: false }));
      mesh.renderOrder = 1;
      mesh.name = "waterworks-gutters";
      mesh.userData = { surface: "waterworks:gutter" };
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ---- drains and lids --------------------------------------------------------------------------------------
  const placed = { grate: [], round: [], trench: [], slot: [], lip: [], apron: [], lid: {} };
  const wetPos = [], wetIdx = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const pose = (x, y, z, yaw, sx, sy, sz) => {
    e.set(0, yaw, 0); q.setFromEuler(e);
    return m4.compose(v3.set(x, y, z), q, s3.set(sx, sy, sz)).clone();
  };
  const routeText = (row, tile) => {
    const r = Number.isInteger(row.r) ? tile.routes?.[row.r] : null;
    return r || null;
  };
  //: What the Nearby panel says of it: what it rests on, and where its water goes.
  const basisText = (row, route) => [row.inferred ? "inferred (a lid at the junction; not published)" : "mapped",
    route?.to && `drains to ${route.to}`].filter(Boolean).join(" · ");
  const tag = (matrix, text) => Object.assign(matrix, { basis: text });
  for (const [d, tile] of all("drains")) {
    const p = place(d.p[0], d.p[1]);
    if (!inArea(p.x, p.z)) continue;
    const k = kerb(p.x, p.z, 8);
    let seat = seatDrain(d.f, p.x, p.z, k);
    // A sign post standing on the kerb over it (the drain is mapped to a metre or so, the post
    // where the city's sign inventory puts it): the opening a step along the kerb, clear of it.
    if (seat.atKerb && postNear(seat.kx, seat.kz, POST_CLEAR_M)) {
      for (const d0 of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const kx = seat.kx + seat.ax * d0, kz = seat.kz + seat.az * d0;
        if (postNear(kx, kz, POST_CLEAR_M)) continue;
        const k2 = kerb(kx, kz, 2);
        if (!k2) continue;
        seat = seatDrain(d.f, kx, kz, k2);
        counts.moved_off_posts = (counts.moved_off_posts || 0) + 1;
        break;
      }
    }
    const yaw = Math.atan2(-seat.az, seat.ax);
    const road = level(seat.x, seat.z) + roadTop;
    forms[d.f] = (forms[d.f] || 0) + 1;
    counts.drains += 1;
    const route = routeText(d, tile), basis = basisText(d, route);
    near.push({ x: seat.x, z: seat.z, kind: "drain", form: d.f, id: d.id, system: d.s, route });
    if (seat.atKerb && (d.f === "curb_grate" || d.f === "curb_opening")) {
      // The opening in the kerb face, and the angle iron over it.
      // The kerb the page drew may stand a little either side of its kerb line, so the dark
      // opening runs from behind the face to just in front of it: it reads as the mouth in
      // the kerb face whichever way the face sits.
      const deep = SIZE.openingDeep + 0.14;
      const fx = seat.kx + seat.nx * (SIZE.openingDeep - deep / 2), fz = seat.kz + seat.nz * (SIZE.openingDeep - deep / 2);
      placed.slot.push(tag(pose(fx, road + SIZE.openingH / 2 + 0.004, fz, yaw, SIZE.curbOpening, SIZE.openingH, deep), basis));
      placed.lip.push(pose(seat.kx - seat.nx * 0.14, road + SIZE.openingH + 0.012, seat.kz - seat.nz * 0.14, yaw,
        SIZE.curbOpening + 0.06, 0.02, 0.025));
      // The dished apron the gutter falls into, round the inlet.
      const ax = seat.kx - seat.nx * SIZE.apronAcross / 2, az = seat.kz - seat.nz * SIZE.apronAcross / 2;
      placed.apron.push(pose(ax, road + GUTTER_LIFT_M + 0.006, az, yaw, SIZE.apronAlong, 1, SIZE.apronAcross));
      // The gutter's wet line leading down to it from the side (or sides) it drains.
      // It follows the kerb as drawn, and ends where the kerb turns away: laid straight on from
      // a drain near a corner it ran out across the road, or over the walk round the curve, a
      // glossy stripe that mirrored the sky blue (Marina Boulevard, Avila Street, 2026-11-22).
      for (const { side } of uphillSides(seat, level)) {
        for (let i = 0; i <= 6; i += 1) {
          const t = 0.5 + (SIZE.wetRun - 0.5) * (i / 6), w = 0.24 * (1 - i / 7) + 0.04;
          const lx = seat.kx + seat.ax * t * side, lz = seat.kz + seat.az * t * side;
          const k = kerb(lx, lz, WET_KERB_M);
          const along = k && Number.isFinite(k.x) && Number.isFinite(k.nx) && k.nx * seat.nx + k.nz * seat.nz > 0.8
            && Math.hypot(k.x - lx, k.z - lz) <= WET_KERB_M;
          if (!along) break;
          const cx = k.x - k.nx * 0.1, cz = k.z - k.nz * 0.1;
          const y = level(cx, cz) + roadTop + GUTTER_LIFT_M + 0.008;   // on the pan, not under it
          const base = wetPos.length / 3;
          wetPos.push(cx, y, cz, cx - k.nx * w, y, cz - k.nz * w);
          if (i) wetIdx.push(base - 2, base - 1, base, base - 1, base + 1, base);
        }
      }
    }
    if (d.f === "curb_opening") continue;
    const y = seat.atKerb ? road + GUTTER_LIFT_M + 0.017 : surfaceAt(seat.x, seat.z) + 0.02;
    if (d.f === "round_grate") placed.round.push(tag(pose(seat.x, y, seat.z, hash(d.id) * Math.PI, SIZE.roundGrate, 1, SIZE.roundGrate), basis));
    else if (d.f === "trench") placed.trench.push(tag(pose(seat.x, y, seat.z, yaw, SIZE.trenchAlong, 1, SIZE.trenchAcross), basis));
    else placed.grate.push(tag(pose(seat.x, y, seat.z, yaw, SIZE.grateAlong, 1, SIZE.grateAcross), basis));
  }
  for (const [lid, tile] of all("lids")) {
    const p = place(lid.p[0], lid.p[1]);
    if (!inArea(p.x, p.z)) continue;
    const y = surfaceAt(p.x, p.z) + 0.014;
    const word = lid.s === "storm" ? "storm" : lid.s === "water" ? "water" : "sewer";
    const route = routeText(lid, tile);
    (placed.lid[word] ||= []).push(tag(pose(p.x, y, p.z, hash(lid.id) * Math.PI * 2, SIZE.lid, 1, SIZE.lid), basisText(lid, route)));
    counts.lids += 1;
    if (lid.inferred) counts.lids_inferred += 1;
    near.push({ x: p.x, z: p.z, kind: "lid", id: lid.id, system: lid.s, inferred: !!lid.inferred, route });
  }
  const instanced = (geometry, material, matrices, name, surface, shadow = false, order = 4) => {
    if (!matrices.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    mesh.renderOrder = order;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name;
    mesh.userData = { surface };
    if (matrices.some((m) => m.basis)) mesh.userData.instanceBasis = matrices.map((m) => m.basis || "mapped");
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    group.add(mesh);
  };
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const box = new THREE.BoxGeometry(1, 1, 1);
  instanced(flat, apronMat, placed.apron, "waterworks-drain-aprons", "waterworks:gutter", false, 2);
  instanced(flat, grateMat, placed.grate, "waterworks-grates", "waterworks:storm_drain");
  instanced(flat, grateMat, placed.trench, "waterworks-trench-drains", "waterworks:storm_drain");
  instanced(disc, grateMat, placed.round, "waterworks-round-grates", "waterworks:storm_drain");
  instanced(box, slotMat, placed.slot, "waterworks-curb-openings", "waterworks:storm_drain");
  instanced(box, ironMat, placed.lip, "waterworks-curb-lips", "waterworks:storm_drain");
  for (const [word, list] of Object.entries(placed.lid)) {
    const lidGeo = new THREE.CylinderGeometry(1, 1, 0.025, 24);
    instanced(lidGeo, [std(COLOUR.iron, { roughness: 0.6, metalness: 0.35 }), lidMat(word), ironMat], list,
      `waterworks-lids-${word}`, "waterworks:sewer_lid");
  }
  if (wetIdx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(wetPos, 3));
    g.setIndex(wetIdx);
    g.computeVertexNormals();
    // Damp concrete darkens; it does not shine: at a roughness of 0.3 the line mirrored the sky,
    // a blue stripe along the kerb.
    const mesh = new THREE.Mesh(g, std(COLOUR.wet, { roughness: 0.9, transparent: true, opacity: 0.45,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    mesh.renderOrder = 3;
    mesh.name = "waterworks-gutter-flow";
    mesh.userData = { surface: "waterworks:gutter" };
    group.add(mesh);
  }

  // ---- tanks, towers and a plant's clarifiers, digesters and basins -----------------------------------------
  const ring = (c) => c.map(([lon, lat]) => { const p = place(lon, lat); return [p.x, p.z]; });
  const roundness = (pts) => {
    let a = 0, per = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      a += x1 * z2 - x2 * z1; per += Math.hypot(x2 - x1, z2 - z1);
    }
    a = Math.abs(a) / 2;
    return { area: a, round: per ? (4 * Math.PI * a) / (per * per) : 0 };
  };
  const tankMat = std(COLOUR.tank, { roughness: 0.55, metalness: 0.2 });
  const towerMat = std(COLOUR.tower, { roughness: 0.5, metalness: 0.3 });
  const concreteMat = std(COLOUR.concrete);
  const effluentMat = std(COLOUR.effluent, { roughness: 0.3, metalness: 0.05 });
  const clearMat = std(COLOUR.clear, { roughness: 0.2, metalness: 0.05 });
  const addMesh = (geometry, material, x, y, z, surface, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { surface };
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  const clarifier = (id, x, z, r, g0) => {
    // An open round tank: its wall a metre or so above the ground, the water just under the
    // rim, the bridge out to the centre hub that turns the scraper.
    const wallH = 1.3;
    const wall = new THREE.CylinderGeometry(r, r, wallH + 0.5, 48, 1, true);
    addMesh(wall, std(COLOUR.concrete, { side: THREE.DoubleSide }), x, g0 + (wallH - 0.5) / 2, z, "waterworks:clarifier", "waterworks-clarifier-wall");
    addMesh(new THREE.CircleGeometry(r - 0.15, 48).rotateX(-Math.PI / 2), clearMat, x, g0 + wallH - 0.3, z, "waterworks:clarifier", "waterworks-clarifier-water");
    addMesh(new THREE.CylinderGeometry(1.2, 1.2, 1.9, 16), concreteMat, x, g0 + wallH - 0.1, z, "waterworks:clarifier", "waterworks-clarifier-hub");
    const yaw = hash(id) * Math.PI * 2;
    const bridge = addMesh(new THREE.BoxGeometry(r, 0.5, 1.1), ironMat, x + Math.cos(yaw) * r / 2, g0 + wallH + 0.35,
      z + Math.sin(yaw) * r / 2, "waterworks:clarifier", "waterworks-clarifier-bridge");
    bridge.rotation.y = -yaw;
    counts.clarifiers += 1;
  };
  for (const [t] of all("tanks")) {
    const p = place(t.p[0], t.p[1]);
    if (!inArea(p.x, p.z)) continue;
    const pts = t.c ? ring(t.c) : null;
    const shape = pts ? roundness(pts) : { area: Math.PI * ((t.diameter_m || 8) / 2) ** 2, round: 1 };
    const d = t.diameter_m || 2 * Math.sqrt(shape.area / Math.PI) || 8;
    const g0 = level(p.x, p.z);
    if (t.building && t.kind !== "clarifier") continue;   // the buildings layer draws its walls
    if (t.kind === "tower") {
      const h = t.height_m || 30, r = Math.max(3, d / 2);
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        addMesh(new THREE.CylinderGeometry(0.35, 0.45, h * 0.78, 8), towerMat, p.x + Math.cos(a) * r * 0.8,
          g0 + h * 0.39, p.z + Math.sin(a) * r * 0.8, "waterworks:water_tank", "waterworks-tower-leg");
      }
      addMesh(new THREE.CylinderGeometry(0.9, 0.9, h * 0.8, 10), towerMat, p.x, g0 + h * 0.4, p.z, "waterworks:water_tank", "waterworks-tower-riser");
      const bowl = addMesh(new THREE.SphereGeometry(r, 24, 14), towerMat, p.x, g0 + h * 0.86, p.z, "waterworks:water_tank", "waterworks-tower-bowl");
      bowl.scale.set(1, 0.62, 1);
      counts.towers += 1;
      continue;
    }
    if (t.kind === "clarifier") { clarifier(t.id, p.x, p.z, d / 2, g0); continue; }
    const digester = t.kind === "digester";
    // Unmeasured: a digester about as tall as it is wide; a steel storage tank under half its
    // width; a small tank (a pressure tank, a rain cistern) about as tall as it is wide.
    const h = t.height_m || (digester ? Math.min(18, Math.max(8, d * 0.6))
      : d < 4 ? Math.max(1.2, d * 1.1) : Math.min(14, Math.max(4, d * 0.45)));
    const material = digester ? concreteMat : tankMat;
    if (pts && shape.round < 0.82 && pts.length >= 3) {
      // Not round: the footprint stood up as it is mapped.
      const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x - p.x, -(z - p.z))));
      const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
      addMesh(geo, material, p.x, g0, p.z, "waterworks:water_tank", "waterworks-tank");
    } else {
      const r = d / 2;
      addMesh(new THREE.CylinderGeometry(r, r, h, 40), material, p.x, g0 + h / 2, p.z, "waterworks:water_tank", "waterworks-tank");
      const cap = addMesh(new THREE.SphereGeometry(r, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2), material, p.x, g0 + h, p.z,
        "waterworks:water_tank", "waterworks-tank-roof");
      cap.scale.set(1, digester ? 0.32 : 0.12, 1);
    }
    counts[digester ? "digesters" : "tanks"] += 1;
  }
  for (const [b] of all("basins")) {
    const pts = ring(b.c);
    if (pts.length < 3 || !pts.some(([x, z]) => inArea(x, z))) continue;
    const c = place(b.p[0], b.p[1]);
    const g0 = level(c.x, c.z);
    const shape = roundness(pts);
    if (shape.round > 0.88) { clarifier(b.id, c.x, c.z, Math.sqrt(shape.area / Math.PI), g0); continue; }
    // The basin's concrete walls round its edge and the water standing inside them.
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.3) continue;
      const wall = addMesh(new THREE.BoxGeometry(len, 1.5, 0.35), concreteMat, (x1 + x2) / 2, g0 + 0.5, (z1 + z2) / 2,
        "waterworks:treatment_basin", "waterworks-basin-wall");
      wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    }
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x - c.x, -(z - c.z))));
    addMesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), effluentMat, c.x, g0 + 0.95, c.z, "waterworks:treatment_basin", "waterworks-basin-water");
    counts.basins += 1;
  }
  const plants = all("plants").map(([p]) => p);
  counts.plants = plants.length;
  const underground = all("underground").map(([u]) => u);
  counts.underground = underground.length;

  group.userData = {
    summary: { ...counts, forms },
    plants: plants.map((p) => ({ id: p.id, name: p.name, kind: p.kind, operator: p.operator })),
    underground,
    // Drains and lids within ``radius`` of a point, nearest first, each with where its water goes.
    near(x, z, radius = 6) {
      return near.map((n) => ({ ...n, d: Math.hypot(n.x - x, n.z - z) })).filter((n) => n.d <= radius)
        .sort((a, b) => a.d - b.d);
    },
    dispose: () => textures.forEach((t) => t.dispose()),
  };
  routesOf.clear();
  return group;
}
