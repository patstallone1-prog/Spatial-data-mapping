// Wall finishes drawn as tiling textures at real scale. UVs on every wall are metres (u along
// the wall, v up), so a texture's repeat is 1 / its tile size in metres and a brick is a brick
// wherever it is used. Colours are drawn into the texture (mortar and shadow lines keep their
// own contrast) and cached per (finish, colour, scale).

export const FINISHES = {
  stucco: {label: 'Stucco / render', tile: 2.0},
  smooth_render: {label: 'Smooth render', tile: 2.0},
  painted_brick: {label: 'Painted brick', tile: 0.9},
  brick: {label: 'Brick', tile: 0.9},
  wood_siding: {label: 'Wood lap siding', tile: 0.9},
  shiplap: {label: 'Shiplap / channel siding', tile: 0.9},
  shingle: {label: 'Wood shingle', tile: 0.9},
  tile: {label: 'Ceramic tile', tile: 0.6},
  stone: {label: 'Stone ashlar', tile: 1.2},
  concrete: {label: 'Concrete', tile: 2.4},
  metal_panel: {label: 'Metal panel', tile: 1.2},
  painted_wood: {label: 'Painted wood panel', tile: 1.2},
  glass: {label: 'Glass curtain', tile: 1.5},
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hash(text) {let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0;}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function draw(kind, colour, px = 512) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'), r = rng(hash(kind + colour)), T = FINISHES[kind]?.tile || 1;
  const m = px / T; // pixels per metre
  g.fillStyle = colour; g.fillRect(0, 0, px, px);
  const speckle = (n, a, size = 1.5) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a * r()})` : `rgba(255,255,255,${a * r()})`;
      g.fillRect(r() * px, r() * px, size, size);
    }
  };
  if (kind === 'stucco' || kind === 'smooth_render') {
    for (let i = 0; i < 18; i++) {
      const x = r() * px, y = r() * px, rad = (0.2 + r() * 0.6) * m;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},0.035)`); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, px, px);
    }
    speckle(kind === 'stucco' ? 26000 : 6000, kind === 'stucco' ? 0.11 : 0.05, kind === 'stucco' ? 1.6 : 1);
  } else if (kind === 'brick' || kind === 'painted_brick') {
    const course = 0.075 * m, brick = 0.225 * m, joint = Math.max(1.5, 0.01 * m);
    g.fillStyle = kind === 'brick' ? '#cfc6b8' : shade(colour, 0.86); g.fillRect(0, 0, px, px);
    for (let row = 0, y = 0; y < px; row++, y += course) {
      const off = row % 2 ? brick / 2 : 0;
      for (let x = -off; x < px; x += brick) {
        g.fillStyle = kind === 'brick' ? shade(colour, 0.82 + r() * 0.36) : shade(colour, 0.97 + r() * 0.06);
        g.fillRect(x + joint / 2, y + joint / 2, brick - joint, course - joint);
      }
    }
    speckle(9000, kind === 'brick' ? 0.12 : 0.05);
  } else if (kind === 'wood_siding' || kind === 'shiplap') {
    const board = (kind === 'shiplap' ? 0.15 : 0.15) * m;
    for (let y = 0; y < px; y += board) {
      g.fillStyle = shade(colour, 0.98 + r() * 0.04); g.fillRect(0, y, px, board);
      const lip = kind === 'shiplap' ? 0.012 * m : 0.025 * m;
      const grd = g.createLinearGradient(0, y + board - lip, 0, y + board);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${kind === 'shiplap' ? 0.45 : 0.32})`);
      g.fillStyle = grd; g.fillRect(0, y + board - lip, px, lip);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, y, px, 1.5);
    }
    speckle(4000, 0.04);
  } else if (kind === 'shingle') {
    const rowH = 0.18 * m;
    for (let y = 0, row = 0; y < px; y += rowH, row++) {
      let x = row % 2 ? -0.07 * m : 0;
      while (x < px) {
        const w = (0.1 + r() * 0.14) * m;
        g.fillStyle = shade(colour, 0.85 + r() * 0.25); g.fillRect(x + 1, y, w - 2, rowH);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y, 1.5, rowH); x += w;
      }
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, y + rowH - 2, px, 2);
    }
  } else if (kind === 'tile') {
    const s = 0.15 * m;
    g.fillStyle = '#d8d2c6'; g.fillRect(0, 0, px, px);
    for (let y = 0; y < px; y += s) for (let x = 0; x < px; x += s) {
      g.fillStyle = shade(colour, 0.95 + r() * 0.1); g.fillRect(x + 1.5, y + 1.5, s - 3, s - 3);
    }
  } else if (kind === 'stone') {
    const h = 0.3 * m, w = 0.6 * m;
    g.fillStyle = shade(colour, 0.75); g.fillRect(0, 0, px, px);
    for (let y = 0, row = 0; y < px; y += h, row++) for (let x = row % 2 ? -w / 2 : 0; x < px; x += w) {
      g.fillStyle = shade(colour, 0.9 + r() * 0.18); g.fillRect(x + 2, y + 2, w - 4, h - 4);
    }
    speckle(14000, 0.08);
  } else if (kind === 'concrete') {
    speckle(20000, 0.06);
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1.5;
    for (let y = 0; y < px; y += 1.2 * m) {g.beginPath(); g.moveTo(0, y); g.lineTo(px, y); g.stroke();}
  } else if (kind === 'metal_panel') {
    const rib = 0.3 * m;
    for (let x = 0; x < px; x += rib) {
      const grd = g.createLinearGradient(x, 0, x + rib, 0);
      grd.addColorStop(0, shade(colour, 1.08)); grd.addColorStop(0.5, colour); grd.addColorStop(1, shade(colour, 0.82));
      g.fillStyle = grd; g.fillRect(x, 0, rib, px);
    }
  } else if (kind === 'painted_wood') {
    const pw = 0.6 * m;
    for (let x = 0; x < px; x += pw) {g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 2, px);}
    for (let y = 0; y < px; y += 0.6 * m) {g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, px, 2);}
    speckle(3000, 0.03);
  } else if (kind === 'glass') {
    const grd = g.createLinearGradient(0, 0, px, px);
    grd.addColorStop(0, shade(colour, 1.15)); grd.addColorStop(1, shade(colour, 0.7));
    g.fillStyle = grd; g.fillRect(0, 0, px, px);
    g.fillStyle = 'rgba(40,40,40,0.8)';
    for (let x = 0; x < px; x += 1.5 * m) g.fillRect(x, 0, 3, px);
    for (let y = 0; y < px; y += 1.5 * m) g.fillRect(0, y, px, 3);
  }
  return c;
}

export function createFinishes(THREE) {
  const cache = new Map();
  const textured = (kind, colour, scale = 1, extra = {}) => {
    const k = [kind, colour, scale, JSON.stringify(extra)].join('|');
    if (cache.has(k)) return cache.get(k);
    const spec = FINISHES[kind] || FINISHES.stucco;
    const tex = new THREE.CanvasTexture(draw(FINISHES[kind] ? kind : 'stucco', colour));
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8; tex.repeat.set(1 / (spec.tile * scale), 1 / (spec.tile * scale));
    const m = new THREE.MeshStandardMaterial({map: tex, roughness: kind === 'metal_panel' ? 0.45 : kind === 'glass' ? 0.15 : 0.88,
      metalness: kind === 'metal_panel' ? 0.35 : kind === 'glass' ? 0.4 : 0, side: THREE.DoubleSide, ...extra});
    m.userData.finish = kind; cache.set(k, m); return m;
  };
  const plain = (colour, roughness = 0.8, metalness = 0, extra = {}) => {
    const k = ['plain', colour, roughness, metalness, JSON.stringify(extra)].join('|');
    if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({color: colour, roughness, metalness, side: THREE.DoubleSide, ...extra}));
    return cache.get(k);
  };
  return {textured, plain, dispose() {for (const m of cache.values()) {m.map?.dispose(); m.dispose();} cache.clear();}};
}
