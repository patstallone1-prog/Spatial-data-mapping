// ---- what a roof is made of ----
//
// A flat roof here is one of four things, and from above they read differently: torch-down or
// built-up tar (near black, in rolls with lapped seams, granules), a single-ply membrane (white or
// grey, welded seams, dirt where water stands), poured concrete (a smooth trowelled slab with
// control joints -- not the broom-finished pavement the ground is drawn with) and ballast gravel.
// A pitched roof is shingle, clay tile or standing-seam metal. Each has its own texture; the
// colour still rides on the vertices, so the textures stay neutral and few.
const ROOF_SURFACES = {
  tar: { roughness: 0.86, metalness: 0.02 },
  membrane: { roughness: 0.68, metalness: 0.0 },
  concrete: { roughness: 0.9, metalness: 0.0 },
  gravel: { roughness: 0.98, metalness: 0.0 },
  shingle: { roughness: 0.95, metalness: 0.0 },
  tile: { roughness: 0.82, metalness: 0.0 },
  metal: { roughness: 0.42, metalness: 0.55 },
};
//: What a roof nobody has photographed is likely to be, and its colour (sRGB), by what the
//: building is: a house's flat roof here is as often tar as it is a white or grey membrane; an
//: office or a warehouse is mostly membrane and ballast.
const ROOF_SURFACE_PRIORS = {
  residential: [["tar", 0.38, 0x464543], ["membrane", 0.27, 0xbfc0bb], ["gravel", 0.2, 0x7d776e], ["concrete", 0.15, 0x97958f]],
  generic: [["tar", 0.34, 0x3d3c3b], ["membrane", 0.3, 0xc2c3be], ["gravel", 0.2, 0x7b766d], ["concrete", 0.16, 0x99978f]],
  office: [["membrane", 0.45, 0xc6c7c2], ["gravel", 0.25, 0x807a70], ["tar", 0.18, 0x403f3d], ["concrete", 0.12, 0x9b9993]],
  industrial: [["membrane", 0.4, 0xbdbeb9], ["metal", 0.2, 0x8a8f92], ["tar", 0.25, 0x3f3e3c], ["gravel", 0.15, 0x7c776e]],
  retail: [["membrane", 0.42, 0xc3c4bf], ["tar", 0.3, 0x3e3d3b], ["gravel", 0.18, 0x7d786f], ["concrete", 0.1, 0x9a988f]],
};
//: The surface a roof's corrected colour says it is.
function roofSurfaceOf(colour, pitched, archetype) {
  const hsl = {};
  colour.getHSL(hsl, THREE.SRGBColorSpace);
  const warm = hsl.s > 0.22 && (hsl.h < 0.11 || hsl.h > 0.95);
  if (pitched) {
    if (warm && hsl.l > 0.28) return "tile";
    if (archetype === "industrial" && hsl.s < 0.08 && hsl.l > 0.45) return "metal";
    return "shingle";
  }
  if (hsl.l < 0.34) return "tar";
  if (hsl.l > 0.6) return "membrane";
  if (hsl.s < 0.07) return hsl.l > 0.5 ? "concrete" : "gravel";
  return warm ? "tar" : "gravel";
}
//: The roof's surface and colour: from the photograph, corrected, where it was read; otherwise
//: what that kind of building's roof usually is, seeded so it keeps between reloads.
function roofFinishFor(feature, seed, tint, pitched = false) {
  const read = roofReadingFor(feature);
  if (read && !(read.green >= ROOF_UNDER_TREES)) {
    const colour = correctedRoofColour(read);
    return { colour, surface: roofSurfaceOf(colour, pitched, feature.archetype), read: true };
  }
  if (pitched) {
    const colour = new THREE.Color(tint);
    const hsl = {};
    colour.getHSL(hsl, THREE.SRGBColorSpace);
    colour.setHSL(hsl.h, hsl.s * 0.5, Math.max(ROOF_LIGHTNESS_FLOOR, Math.min(0.45, hsl.l * 0.6)), THREE.SRGBColorSpace);
    return { colour, surface: "shingle", read: false };
  }
  const priors = ROOF_SURFACE_PRIORS[feature.archetype] || ROOF_SURFACE_PRIORS.generic;
  let draw = random(seed + 977), pick = priors[priors.length - 1];
  for (const prior of priors) { if ((draw -= prior[1]) <= 0) { pick = prior; break; } }
  const colour = new THREE.Color().setHex(pick[2], THREE.SRGBColorSpace);
  // A little of the building in it, and a little of its own: no two tar roofs are one black.
  colour.lerp(new THREE.Color(tint), 0.08);
  const hsl = {};
  colour.getHSL(hsl, THREE.SRGBColorSpace);
  colour.setHSL(hsl.h, hsl.s, Math.max(ROOF_TAR_FLOOR, Math.min(0.82, hsl.l + (random(seed + 979) - 0.5) * 0.08)), THREE.SRGBColorSpace);
  return { colour, surface: pick[0], read: false };
}

//: Roof caps carry UVs of metres / 20 (FACADE_UV) and the texture repeats 2.5 times in that, so
//: one tile is eight metres of roof: 256 pixels, about three centimetres each.
const ROOF_TILE_M = 8;
function roofSurfaceTexture(surface, variant) {
  const size = 256, px = size / ROOF_TILE_M;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  const seed = 7001 + variant * 131 + surface.length * 17;
  const speck = (count, dark, light, w = 1) => {
    for (let i = 0; i < count; i += 1) {
      g.fillStyle = random(seed + i * 19) < 0.5 ? dark : light;
      g.fillRect(random(seed + i * 23) * size, random(seed + i * 29) * size, w, w);
    }
  };
  const blotches = (count, colour, rMin, rMax) => {
    for (let i = 0; i < count; i += 1) {
      const x = random(seed + 300 + i * 7) * size, y = random(seed + 400 + i * 11) * size;
      const r = (rMin + random(seed + 500 + i) * (rMax - rMin)) * px;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, colour);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  };
  if (surface === "tar") {
    // Rolls a metre wide, lapped: a lighter granule band and a dark line at each lap.
    g.fillStyle = "#d4d4d4"; g.fillRect(0, 0, size, size);
    speck(size * size * 0.35, "rgba(0,0,0,0.22)", "rgba(255,255,255,0.16)");
    for (let y = 0; y < size; y += px) {
      g.fillStyle = "rgba(0,0,0,0.30)"; g.fillRect(0, y, size, 1.5);
      g.fillStyle = "rgba(255,255,255,0.10)"; g.fillRect(0, y + 2, size, 0.08 * px);
    }
    blotches(5, "rgba(0,0,0,0.20)", 0.4, 1.4);   // patches and blisters
    blotches(3, "rgba(255,255,255,0.08)", 0.8, 2.0);
  } else if (surface === "membrane") {
    // Sheets 1.8 m wide, heat-welded (a narrow raised seam), and the dirt of standing water.
    g.fillStyle = "#f2f2f0"; g.fillRect(0, 0, size, size);
    speck(size * size * 0.04, "rgba(0,0,0,0.05)", "rgba(255,255,255,0.05)");
    for (let x = (variant % 2) * 0.6 * px; x < size; x += 1.8 * px) {
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x, 0, 1.2, size);
      g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + 1.3, 0, 1, size);
    }
    blotches(6, "rgba(70,62,50,0.16)", 0.6, 1.8);
    blotches(2, "rgba(40,40,40,0.10)", 1.5, 3.0);
  } else if (surface === "concrete") {
    // A trowelled slab: smooth, faint swirls, control joints every four metres. The ground's
    // concrete is a broom finish with aggregate; this is not.
    g.fillStyle = "#e4e3df"; g.fillRect(0, 0, size, size);
    speck(size * size * 0.06, "rgba(0,0,0,0.035)", "rgba(255,255,255,0.04)");
    g.strokeStyle = "rgba(255,255,255,0.06)"; g.lineWidth = 3;
    for (let i = 0; i < 14; i += 1) {
      const x = random(seed + 900 + i) * size, y = random(seed + 950 + i) * size;
      g.beginPath(); g.arc(x, y, (0.5 + random(seed + 990 + i)) * px, 0, Math.PI * (0.6 + random(seed + 991 + i))); g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.22)";
    for (let k = 0; k < size; k += 4 * px) { g.fillRect(k, 0, 1.2, size); g.fillRect(0, k, size, 1.2); }
    blotches(3, "rgba(60,56,50,0.07)", 1.0, 2.5);
  } else if (surface === "gravel") {
    g.fillStyle = "#c9c6c0"; g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size * 0.22; i += 1) {
      const t = random(seed + i * 31);
      g.fillStyle = t < 0.33 ? "rgba(0,0,0,0.26)" : t < 0.66 ? "rgba(255,255,255,0.28)" : "rgba(120,100,80,0.22)";
      const r = 0.8 + random(seed + i * 37) * 1.6;
      g.beginPath(); g.arc(random(seed + i * 41) * size, random(seed + i * 43) * size, r, 0, Math.PI * 2); g.fill();
    }
  } else if (surface === "shingle") {
    g.fillStyle = "#cfcfcf"; g.fillRect(0, 0, size, size);
    const course = 0.14 * px * 1.4, tab = 0.33 * px * 1.4;
    for (let row = 0, y = 0; y < size; row += 1, y += course) {
      for (let x = (row % 2) * tab / 2 - tab; x < size; x += tab) {
        const k = random(seed + row * 97 + Math.floor(x));
        g.fillStyle = `rgba(0,0,0,${0.04 + k * 0.16})`;
        g.fillRect(x + 1, y + 1, tab - 2, course - 2);
      }
      g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(0, y + course - 1.5, size, 1.5);
    }
    speck(size * size * 0.12, "rgba(0,0,0,0.12)", "rgba(255,255,255,0.10)");
  } else if (surface === "tile") {
    g.fillStyle = "#e0dad4"; g.fillRect(0, 0, size, size);
    const course = 0.35 * px, w = 0.25 * px;
    for (let row = 0, y = 0; y < size; row += 1, y += course) {
      for (let x = (row % 2) * w / 2; x < size; x += w) {
        const grad = g.createLinearGradient(x, 0, x + w, 0);
        grad.addColorStop(0, "rgba(0,0,0,0.20)"); grad.addColorStop(0.5, "rgba(255,255,255,0.18)"); grad.addColorStop(1, "rgba(0,0,0,0.24)");
        g.fillStyle = grad; g.fillRect(x, y, w, course - 1);
      }
      g.fillStyle = "rgba(0,0,0,0.32)"; g.fillRect(0, y + course - 2, size, 2);
    }
  } else {
    // Standing-seam metal: a rib every half metre.
    g.fillStyle = "#dcdcdc"; g.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 0.5 * px) {
      g.fillStyle = "rgba(255,255,255,0.4)"; g.fillRect(x, 0, 1.5, size);
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 1.5, 0, 1.5, size);
    }
    blotches(3, "rgba(90,60,40,0.10)", 1.0, 2.0);
  }
  // A drain: every flat roof has one, and it is the one thing allowed to repeat.
  if (["tar", "membrane", "concrete", "gravel"].includes(surface)) {
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.arc(size * (0.5 + (random(seed + 91) - 0.5) * 0.3), size * (0.5 + (random(seed + 93) - 0.5) * 0.3), 0.12 * px, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(20 / ROOF_TILE_M, 20 / ROOF_TILE_M);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function roofSurfaceTextureFor(surface, seed) {
  const key = `${surface}-${Math.floor(random(seed + 13) * 3)}`;
  if (!ROOF_CACHE.has(key)) ROOF_CACHE.set(key, roofSurfaceTexture(surface, Number(key.slice(-1))));
  return ROOF_CACHE.get(key);
}

// ---- what stands on a flat roof: decks, and the parapet round it ----
//
// A roof plan is worked out for each flat roof, then drawn: a deck that fits the roof (its own
// outline drawn in from the parapet and cut to the end of the roof it is on, or the rectangle
// the photograph saw), planked along the roof, with glass railings -- and wood screens where a
// row house has neighbours either side. No rooms: see planRoof. Each piece is real geometry in metres,
// merged by material like the buildings (addMerged), so a city of them is a handful of draws.
//
// Plan coordinates are the roof rectangle's (roofRectangle): ``a`` down the roof, ``b`` across.

function roofRing(feature) {
  const ring = feature.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  return ring;
}
const ringArea = (ring) => {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    twice += ax * bz - bx * az;
  }
  return twice / 2;
};
//: The outline drawn in by ``d`` metres (mitred), or null where that turns it inside out.
function roofInset(ring, d) {
  const sign = ringArea(ring) > 0 ? 1 : -1;
  const n = ring.length, out = [];
  for (let i = 0; i < n; i += 1) {
    const p = ring[(i + n - 1) % n], q = ring[i], r = ring[(i + 1) % n];
    const e1 = [q[0] - p[0], q[1] - p[1]], e2 = [r[0] - q[0], r[1] - q[1]];
    const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    // Inward normals: left of each edge for an anticlockwise ring (x, z).
    const n1 = [-e1[1] / l1 * sign, e1[0] / l1 * sign], n2 = [-e2[1] / l2 * sign, e2[0] / l2 * sign];
    const bis = [n1[0] + n2[0], n1[1] + n2[1]], bl = Math.hypot(...bis);
    if (bl < 1e-6) continue;
    const cos = (bis[0] * n1[0] + bis[1] * n1[1]) / bl;
    const k = d / Math.max(cos, 0.35);
    out.push([q[0] + bis[0] / bl * k, q[1] + bis[1] / bl * k]);
  }
  if (out.length < 3 || Math.sign(ringArea(out)) !== sign || Math.abs(ringArea(out)) < 2) return null;
  if (!out.every(([x, z]) => pointInRing(x, z, ring))) return null;
  return out;
}
//: The part of a ring on the near side of a line (Sutherland-Hodgman): keeps nx*x + nz*z <= c.
function clipRing(ring, nx, nz, c) {
  const out = [], side = (p) => nx * p[0] + nz * p[1] - c;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i], q = ring[(i + 1) % ring.length], sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out.length >= 3 ? out : null;
}
//: A prism over a ring (x, z) from y0 to y1: its top and its sides, UVs in metres down ``angle``
//: (so planks and seams run the way the roof does), every vertex coloured ``colour`` if given.
function prismGeometry(ring, y0, y1, { angle = 0, top = true, sides = true, colour = null, uvScale = 1 } = {}) {
  const pos = [], uv = [], ca = Math.cos(angle), sa = Math.sin(angle);
  const tri = (a, b, c) => { pos.push(...a, ...b, ...c); };
  if (top) {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of triangles) {
      // Wound to face up whichever way the ring runs.
      const [a, b, c] = [ring[i], ring[j], ring[k]];
      const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
      const order = up ? [a, b, c] : [a, c, b];
      for (const [x, z] of order) {
        pos.push(x, y1, z);
        uv.push((x * ca + z * sa) * uvScale, (-x * sa + z * ca) * uvScale);
      }
    }
  }
  if (sides) {
    const ccw = ringArea(ring) > 0;
    let run = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const [a, b] = ccw ? [q, p] : [p, q];
      const quad = [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]];
      const u0 = run * uvScale, u1 = (run + len) * uvScale, v0 = y0 * uvScale * 0, v1 = (y1 - y0) * uvScale;
      tri(quad[0], quad[1], quad[2]); uv.push(u0, v0, u1, v0, u1, v1);
      tri(quad[0], quad[2], quad[3]); uv.push(u0, v0, u1, v1, u0, v1);
      run += len;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (colour) {
    const c = new THREE.Color(colour), colours = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { colours[i] = c.r; colours[i + 1] = c.g; colours[i + 2] = c.b; }
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  }
  geometry.computeVertexNormals();
  return geometry;
}
//: A thin upright panel along a segment (glass, a screen): both faces, UVs in metres.
function panelGeometry(p, q, y0, y1, thick = 0.02) {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const nx = -(q[1] - p[1]) / len * thick / 2, nz = (q[0] - p[0]) / len * thick / 2;
  return prismGeometry([[p[0] + nx, p[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz], [p[0] - nx, p[1] - nz]], y0, y1);
}

//: The parapet round a flat roof, and the cornice on it. A flat roof cut off flush at the top of
//: its walls is a lid: nothing joins it to the house, and in another colour it reads as a slab
//: laid on some other building. Here a flat roof stands inside its walls -- the walls run on
//: past it as a parapet (half a metre on a house, more on a block), capped by a cornice that
//: stands proud of the wall and shades it, in the trim colour. That is how the roofs of this
//: city are built, and it is what puts the roof on the house.
const PARAPET = {
  house: { rise: 0.55, thick: 0.2, cornice: 0.26, proud: 0.14 },
  block: { rise: 0.85, thick: 0.25, cornice: 0.32, proud: 0.16 },
  tower: { rise: 1.1, thick: 0.3, cornice: 0, proud: 0 },
};
function parapetMaterial() {
  return (parapetMaterial._cache ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 }));
}
//: ``ring`` is the roof outline in world x, z; the parapet's foot is at ``y``. Mitred corners
//: (a corner sharper than about 40 degrees is held to two and a half times the offset).
function parapetGeometry(ring, y, spec, wall, trim) {
  const n = ring.length;
  if (n < 3) return null;
  const sign = ringArea(ring) > 0 ? 1 : -1;
  // Outward normal of edge i (from ring[i] to ring[i+1]).
  const normals = [];
  for (let i = 0; i < n; i += 1) {
    const p = ring[i], q = ring[(i + 1) % n], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    normals.push(len < 1e-6 ? null : [(q[1] - p[1]) / len * sign, -(q[0] - p[0]) / len * sign]);
  }
  const offset = (i, d) => {
    let a = normals[(i + n - 1) % n], b = normals[i];
    a ??= b; b ??= a;
    if (!a) return [ring[i][0], ring[i][1]];
    const m = [a[0] + b[0], a[1] + b[1]], ml = Math.hypot(...m);
    if (ml < 1e-6) return [ring[i][0] + a[0] * d, ring[i][1] + a[1] * d];
    const cos = (m[0] * a[0] + m[1] * a[1]) / ml, k = d / Math.max(cos, 0.4);
    return [ring[i][0] + m[0] / ml * k, ring[i][1] + m[1] / ml * k];
  };
  const O = ring.map((p) => [p[0], p[1]]);
  const I = ring.map((_, i) => offset(i, -spec.thick));
  const C = ring.map((_, i) => offset(i, spec.proud));
  const top = y + spec.rise, under = top - spec.cornice, capY = spec.cornice ? top + 0.06 : top;
  const pos = [], col = [];
  const wallIn = wall.clone().multiplyScalar(0.82);
  // A quad p0 p1 (at y0) to p1 p0 (at y1), facing the side the winding gives.
  const quad = (p0, y0a, p1, y0b, q1, y1b, q0, y1a, colour) => {
    for (const [x, yy, z] of [[p0[0], y0a, p0[1]], [p1[0], y0b, p1[1]], [q1[0], y1b, q1[1]],
                               [p0[0], y0a, p0[1]], [q1[0], y1b, q1[1]], [q0[0], y1a, q0[1]]]) {
      pos.push(x, yy, z); col.push(colour.r, colour.g, colour.b);
    }
  };
  // A level band between an inner and an outer edge, facing up or down. Which order of corners
  // faces which way depends on which way round the (x, z) ring runs.
  const band = (inI, inJ, outI, outJ, at, up, colour) => (up === sign > 0
    ? quad(inI, at, inJ, at, outJ, at, outI, at, colour) : quad(outI, at, outJ, at, inJ, at, inI, at, colour));
  for (let i = 0; i < n; i += 1) {
    if (!normals[i]) continue;
    const j = (i + 1) % n;
    // Outward faces wind one way round an anticlockwise (x, z) ring and the other round a clockwise one.
    const out = (a, b) => (sign > 0 ? [b, a] : [a, b]);
    const [oa, ob] = out(O[i], O[j]), [ca, cb] = out(C[i], C[j]), [ia, ib] = out(I[j], I[i]);
    const faceTop = spec.cornice ? under : top;
    quad(oa, y, ob, y, ob, faceTop, oa, faceTop, wall);                           // the wall, on up
    if (spec.cornice) {
      quad(ca, under, cb, under, cb, capY, ca, capY, trim);                      // the cornice's face
      band(O[i], O[j], C[i], C[j], under, false, trim);                          // its underside
      band(I[i], I[j], C[i], C[j], capY, true, trim);                            // the coping, on top
    } else {
      band(I[i], I[j], O[i], O[j], top, true, trim);
    }
    quad(ia, y, ib, y, ib, capY, ia, capY, wallIn);                             // the inside, to the roof
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  geometry.computeVertexNormals();
  return geometry;
}

function roofPlanMaterials() {
  if (roofPlanMaterials._cache) return roofPlanMaterials._cache;
  const canvasTex = (w, h, paint, repeat = 1) => {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    paint(canvas.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  // Planks 14 cm wide with 6 mm gaps, one texture metre square; each board its own weathering.
  const planks = canvasTex(256, 256, (g, w, h) => {
    const board = h / (1 / 0.146);
    for (let y = 0, i = 0; y < h; y += board, i += 1) {
      const k = random(8100 + i * 7);
      g.fillStyle = `rgb(${150 + k * 40},${108 + k * 30},${72 + k * 22})`;
      g.fillRect(0, y, w, board);
      for (let s = 0; s < 40; s += 1) {
        g.fillStyle = `rgba(60,36,18,${0.05 + random(8200 + i * 61 + s) * 0.08})`;
        g.fillRect(random(8300 + i * 67 + s) * w, y + random(8400 + i * 71 + s) * board, 20 + random(8500 + s) * 60, 1);
      }
      g.fillStyle = "rgba(25,15,8,0.75)"; g.fillRect(0, y + board - 1.6, w, 1.6);
      const joint = random(8600 + i) * w;
      g.fillRect(joint, y, 1.2, board);
    }
  });
  // Wood screen: horizontal slats, 9 cm with 2 cm gaps.
  const slats = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = "rgb(40,26,16)"; g.fillRect(0, 0, w, h);
    const slat = h * 0.09 / 0.11 / 9;
    for (let y = 0, i = 0; y < h; y += h / 9, i += 1) {
      const k = random(8700 + i);
      g.fillStyle = `rgb(${126 + k * 30},${86 + k * 22},${54 + k * 16})`;
      g.fillRect(0, y, w, slat * 0.82);
    }
  });
  const make = (name, options) => {
    const material = new THREE.MeshStandardMaterial(options);
    material.name = `roof-${name}`;
    return material;
  };
  return (roofPlanMaterials._cache = {
    deck: make("deck", { map: planks, roughness: 0.88 }),
    screen: make("screen", { map: slats, roughness: 0.9 }),
    glass: make("glass", { color: 0xbcd6de, transparent: true, opacity: 0.3, roughness: 0.06, metalness: 0.15,
                           side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 }),
    cap: make("rail-cap", { color: 0x9aa2a6, roughness: 0.38, metalness: 0.75 }),
  });
}
const mergeRoof = (key, geometry, material) => addMerged(`roof|plan-${key}`, new THREE.Mesh(geometry, material), "roof_furniture");

//: What goes on this flat roof. Null when nothing does (too small, not flat, not rectangular
//: enough to walk on).
function planRoof(feature, roof, seed, areaM2) {
  const ring = roofRing(feature);
  const walkable = roofInset(ring, 0.6);
  if (!walkable || roof.fill < 0.55) return null;
  const read = roofReadingFor(feature);
  const homeish = ["residential", "generic", "hotel"].includes(feature.archetype || "generic");
  const plan = { ring, walkable, deck: null };
  // Which end of the roof the deck is at.
  const end = random(seed + 1201) < 0.5 ? -1 : 1;
  const cos = Math.cos(roof.angle), sin = Math.sin(roof.angle);
  // A deck the photograph saw: its rectangle, kept inside the roof.
  if (read?.deck?.rects?.length) {
    const [lon, lat, length, width, bearing] = read.deck.rects[0];
    const [cx, cy] = xy(lon, lat), t = (bearing * Math.PI) / 180, ux = Math.sin(t), uz = -Math.cos(t);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [
      cx + ux * i * length / 2 - uz * j * width / 2, -cy + uz * i * length / 2 + ux * j * width / 2]);
    const inside = corners.filter(([x, z]) => pointInRing(x, z, walkable)).length >= 3;
    if (inside) plan.deck = { ring: corners, seen: true };
  } else if (!read && homeish && areaM2 >= 40 && random(seed + 1203) < 0.42) {
    // An inferred deck: the roof's own shape, drawn in, over one end of it.
    const share = 0.38 + random(seed + 1205) * 0.32;
    const cut = end * (roof.width / 2 - roof.width * share);
    // Keep the side where end * a >= end * cut: the half-plane -end*a <= -end*cut, in world terms.
    const nx = -end * cos, nz = -end * sin;
    const c = nx * roof.x + nz * roof.z - end * cut;
    const clipped = clipRing(roofInset(ring, 1.0) || walkable, nx, nz, c);
    if (clipped && Math.abs(ringArea(clipped)) >= 6) plan.deck = { ring: clipped, seen: false };
  }
  if (plan.deck) {
    // A row house has neighbours on both long sides: its deck is screened there in wood, the
    // street and the yard ends in glass.
    const rowHouse = roof.depth < 9.5 && roof.fill > 0.85 && homeish;
    plan.deck.edges = plan.deck.ring.map((p, i) => {
      const q = plan.deck.ring[(i + 1) % plan.deck.ring.length];
      const along = Math.abs(((q[0] - p[0]) * cos + (q[1] - p[1]) * sin) / Math.hypot(q[0] - p[0], q[1] - p[1]));
      return { p, q, kind: rowHouse && along > 0.85 ? "screen" : "glass" };
    });
  }
  // No room is invented on a roof. A stair house on more than half the flat roofs in the city
  // and a penthouse with a band of windows round it on a fifth of the big ones were drawn by
  // chance, and nobody had seen any of them: from the street and from the air each read as a
  // storey the house does not have. The roof is the house's roof, and what stands on it is only
  // what the photograph saw or what plainly goes there (plant on an office, a deck).
  return plan.deck ? plan : null;
}

function drawRoofPlan(group, plan, roof, top, tint, seed) {
  const M = roofPlanMaterials(), D = deckMaterials(), y = top + BUILDING_LIFT_M;
  if (plan.deck) {
    const deckTop = y + 0.14;
    mergeRoof("deck", prismGeometry(plan.deck.ring, y, deckTop, { angle: roof.angle + Math.PI / 2 }), M.deck);
    for (const edge of plan.deck.edges) {
      const len = Math.hypot(edge.q[0] - edge.p[0], edge.q[1] - edge.p[1]);
      if (len < 0.3) continue;
      if (edge.kind === "screen") {
        mergeRoof("screen", panelGeometry(edge.p, edge.q, deckTop, deckTop + 1.8, 0.06), M.screen);
      } else {
        mergeRoof("glass", panelGeometry(edge.p, edge.q, deckTop + 0.06, deckTop + 1.04, 0.015), M.glass);
        mergeRoof("cap", panelGeometry(edge.p, edge.q, deckTop + 1.04, deckTop + 1.09, 0.06), M.cap);
      }
      // Posts, a metre and a half apart, whichever the railing.
      const posts = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i <= posts; i += 1) {
        const t = i / posts, x = edge.p[0] + (edge.q[0] - edge.p[0]) * t, z = edge.p[1] + (edge.q[1] - edge.p[1]) * t;
        slab(group, x, top + 0.14, z, 0.05, edge.kind === "screen" ? 1.85 : 1.09, 0.05, D.rack, roof.rotY);
      }
    }
    // Furniture where furniture goes: a table and two benches at the deck's middle.
    let cx = 0, cz = 0;
    for (const [x, z] of plan.deck.ring) { cx += x; cz += z; }
    cx /= plan.deck.ring.length; cz /= plan.deck.ring.length;
    if (Math.abs(ringArea(plan.deck.ring)) > 9 && pointInRing(cx, cz, plan.deck.ring)) {
      slab(group, cx, top + 0.14, cz, 1.4, 0.72, 0.8, D.seat, roof.rotY);
      for (const side of [-1, 1]) {
        const [bx, bz] = [cx - Math.sin(roof.angle) * side * 0.9, cz + Math.cos(roof.angle) * side * 0.9];
        slab(group, bx, top + 0.14, bz, 1.4, 0.42, 0.34, D.seat, roof.rotY);
      }
      if (random(seed + 1301) < 0.6) {
        const [px, pz] = plan.deck.ring[Math.floor(random(seed + 1303) * plan.deck.ring.length)];
        const [qx, qz] = [cx + (px - cx) * 0.8, cz + (pz - cz) * 0.8];
        slab(group, qx, top + 0.14, qz, 0.6, 0.5, 0.6, D.planter, roof.rotY);
        slab(group, qx, top + 0.64, qz, 0.5, 0.45, 0.5, D.leaf, roof.rotY);
      }
    }
  }
}

function addRoofFurniture(group, feature, seed, height, areaM2, tint = 0xc8c2b8) {
  // Nothing goes on a roof too small to stand on, and nothing goes on a roof that is not flat
  // enough to be a rectangle -- which is the check that stopped solar arrays appearing on
  // L-shaped and triangular footprints.
  if (areaM2 < 55) return;
  const roof = roofRectangle(feature);
  if (!roof || roof.slim < 4.5) return;
  const uses = ROOF_USE[feature.archetype] || ROOF_USE.generic;
  const top = height;
  let placed = 0;
  // The deck comes from the roof's plan (planRoof), which fits it to the roof's own outline;
  // the rest is laid out below as before.
  const plan = planRoof(feature, roof, seed, areaM2);
  if (plan) {
    drawRoofPlan(group, plan, roof, top, tint, seed);
    placed += 1;
  }
  for (const [use, chance] of uses) {
    if (use === "deck" || use === "stair") continue;
    if (plan?.deck && use === "garden") continue;
    // A distinct draw per use. Keyed on the name's length, "solar", "stair" and "plant" are all
    // five letters and drew the same number, so solar and the stair bulkhead were perfectly
    // correlated -- every roof with panels had a stair hut and no roof had one without.
    if (random(seed + ROOF_USE_SALT[use] + 601) >= chance) continue;
    // Panels, a deck or a garden are not invented on a roof the photograph has looked at: it
    // saw what is there. (Its own panel finds are kept in the data, not drawn: at 0.25 m they
    // are not yet sure enough to build.)
    if (roofReadingFor(feature) && (use === "solar" || use === "deck" || use === "garden")) continue;
    if (use === "solar") {
      // Only a flat, rectangular roof with room on it. A panel on a ragged footprint is the
      // thing that looked wrong, and refusing is cheaper than pretending.
      if (!roof.squarish || areaM2 < 90) continue;
      if (solarArray(group, roof, top, seed, areaM2 > 900)) placed += 1;
    } else if (use === "garden") {
      if (roof.squarish && roofGarden(group, roof, top, seed)) placed += 1;
    } else if (use === "plant") {
      if (roofPlant(group, roof, top, seed)) placed += 1;
    }
    // A roof carries one main use plus a stair, not four at once.
    if (placed >= 2) break;
  }
}

// ---- outbuildings ----
//
// Board and batten, corrugated iron, or stucco: what a rear workshop in this city is actually
// clad in. No window grid -- an outbuilding has a door and maybe one window, and painting a
// facade of them across a four metre wall is the thing that made these read as houses.
const OUTBUILDING_CACHE = new Map();

function outbuildingTexture(seed) {
  const variant = Math.floor(random(seed + 401) * 3);
  const key = `wall-${variant}`;
  if (OUTBUILDING_CACHE.has(key)) return OUTBUILDING_CACHE.get(key);
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (variant === 0) {                          // vertical boards with battens
    ctx.fillStyle = "#4a4238";
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 11) {
      ctx.fillStyle = random(x * 7) < 0.5 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.07)";
      ctx.fillRect(x, 0, 10, size);
      ctx.fillStyle = "rgba(0,0,0,0.34)";
      ctx.fillRect(x + 10, 0, 1, size);
    }
  } else if (variant === 1) {                   // corrugated sheet
    ctx.fillStyle = "#5a5f60";
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 7) {
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x, 0, 3, size);
      ctx.fillStyle = "rgba(0,0,0,0.20)";
      ctx.fillRect(x + 4, 0, 2, size);
    }
  } else {                                      // plain stucco
    ctx.fillStyle = "#6b6459";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size * 0.4; i += 1) {
      ctx.fillStyle = random(i * 3) < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.07)";
      ctx.fillRect(random(i * 5) * size, random(i * 7) * size, 1, 1);
    }
  }
  // One door, low and off to one side, at the scale the wall texture is tiled to.
  ctx.fillStyle = "rgba(28,26,24,0.72)";
  ctx.fillRect(size * 0.16, size * 0.42, size * 0.16, size * 0.58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  OUTBUILDING_CACHE.set(key, texture);
  return texture;
}

function outbuildingRoofTexture(seed) {
  const key = `roof-${Math.floor(random(seed + 403) * 2)}`;
  if (OUTBUILDING_CACHE.has(key)) return OUTBUILDING_CACHE.get(key);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Weathered asphalt shingle and rolled roofing, not tar. At #3b3a36 this was sRGB 0.23 and,
  // under the tone mapping, every roof wearing it read as a hole in the block rather than as a
  // dark roof.
  ctx.fillStyle = key.endsWith("0") ? "#5d5b54" : "#6b6a63";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 6) {
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(0, y, size, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  OUTBUILDING_CACHE.set(key, texture);
  return texture;
}

function parkFacilityMesh(feature) {
  const evidence=feature.parkFacility,role=evidence.role;
  if(!["public_restroom","maintenance_shed","equipment_container"].includes(role))return null;
  // Joined buildings retain their canonical shell, height and roof boundary. Only
  // freestanding inventory objects use the city polygon (including recorded holes).
  const shape=footprintShape(feature.points);if(!shape)return null;
  if(evidence.render === "inventory_structure")for(const ring of evidence.polygon.slice(1)) {
    const hole=new THREE.Path();ring.forEach((p,i)=>{const [x,y]=xy(...p);
      if(i===0)hole.moveTo(x,y);else hole.lineTo(x,y);});shape.holes.push(hole);
  }
  const height=Math.max(1,feature.height_m || 3.1),base=groundBaseFor(feature.points);
  const seed=Math.round(feature.points[0][0]*1e5+feature.points[0][1]*7919e5);
  const colour=role === "public_restroom" ? 0xc3bca9 : role === "equipment_container" ? 0x7e8b78 : 0xa6a38f;
  const body=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,UVGenerator:FACADE_UV});
  body.rotateX(-Math.PI/2);body.translate(0,base,0);
  const roof=new THREE.MeshStandardMaterial({map:outbuildingRoofTexture(seed),color:0xffffff,roughness:.96});
  const wall=new THREE.MeshStandardMaterial({map:outbuildingTexture(seed),color:colour,roughness:.95});
  const group=new THREE.Group(),mesh=new THREE.Mesh(body,[roof,wall]);group.add(mesh);
  group.userData={surface:"park_facility",id:evidence.id,role,park_id:evidence.park_id,
    geometry_basis:evidence.render === "canonical_building_style" ? "canonical_building" : evidence.geometry_basis,
    geometry_confidence:evidence.geometry_confidence,height_basis:feature.height_source,
    semantic_confidence:evidence.semantic_confidence,provenance:evidence.provenance,
    appearance_basis:"nonresidential_visual_prior",residential_layout:false,liftedOntoGround:true};
  mesh.userData={...group.userData};
  // What makes each read as what it is -- never rows of house windows. The openings are on the
  // longest wall and are a visual prior until independently observed.
  const walls=footprintWalls(feature.points).sort((a,b)=>b.span-a.span),front=walls[0];
  if(role==="public_restroom") {
    // A flat roof slab that overhangs the walls, as park toilet blocks are built.
    const slab=new THREE.ExtrudeGeometry(shape,{depth:.16,bevelEnabled:false});
    slab.rotateX(-Math.PI/2);slab.computeBoundingBox();
    const c=slab.boundingBox.getCenter(new THREE.Vector3());
    slab.translate(-c.x,0,-c.z);slab.scale(1.12,1,1.12);slab.translate(c.x,base+height,c.z);
    const roofSlab=new THREE.Mesh(slab,new THREE.MeshStandardMaterial({color:0x6d6a64,roughness:.9}));
    roofSlab.userData={surface:"park_facility:roof_slab",basis:"visual_prior",liftedOntoGround:true};
    group.add(roofSlab);
  }
  if(front && front.span>1.4) {
    const along=[Math.cos(front.yaw),-Math.sin(front.yaw)];
    const face=(w,h,y,o,colour,depth=.03,tag="park_facility:detail")=>{
      const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,depth),
        new THREE.MeshStandardMaterial({color:colour,roughness:.7,metalness:.15}));
      m.position.set(front.x+along[0]*o+front.nx*(depth/2+.005),base+y,front.z+along[1]*o+front.nz*(depth/2+.005));
      m.rotation.y=front.yaw;m.userData={surface:tag,basis:"visual_prior",liftedOntoGround:true};
      group.add(m);return m;
    };
    const doorH=Math.min(2.1,height-.3);
    if(role==="public_restroom") {
      // Separate entrances on a block long enough for two, one otherwise, each with its sign;
      // the louvred vent band under the eaves; a drinking fountain beside the way in.
      const two=front.span>=4.2;
      for(const o of two?[-front.span*.25,front.span*.25]:[0]) {
        face(1.0,doorH,doorH/2,o,0x5b6f86,.04,"park_facility:door");
        face(.3,.3,doorH+.32,o,0x2c5ea8,.02,"park_facility:sign");
      }
      face(front.span*.8,.28,height-.38,0,0x4a4f52,.04,"park_facility:louvre");
      if(front.span>3) {
        const o=two?0:front.span*.38;
        face(.12,.85,.425,o,0x7d8487,.32,"park_facility:drinking_fountain");
        face(.42,.12,.9,o,0x9aa0a4,.38,"park_facility:drinking_fountain");
      }
    } else if(role==="maintenance_shed") {
      const w=Math.min(3.0,front.span*.55),h=Math.min(2.8,height-.3),o=-front.span*.12;
      face(w,h,h/2,o,0x8f948f,.05,"park_facility:rollup_door");
      for(let k=1;k<9;k+=1) face(w,.03,k*h/9,o,0x6d726d,.06,"park_facility:rollup_rib");
      if(front.span>5) face(.95,doorH,doorH/2,front.span*.32,0x5b675f,.04,"park_facility:door");
    } else {
      // A shipping container: corrugated along its length.
      const rib=new THREE.Color(colour).multiplyScalar(.78).getHex();
      for(let o=-front.span/2+.15;o<front.span/2-.1;o+=.3) face(.07,height-.12,(height-.12)/2,o,rib,.03,"park_facility:corrugation");
    }
  }
  return group;
}

function mappedTubePortalBuilding(feature) {
  if (!/tube.*portal/i.test(feature.name || "") || !feature.centroid) return false;
  const [x, y] = xy(feature.centroid[0], feature.centroid[1]);
  return IMMERSED_MOUTHS.some(([mx, my]) => Math.hypot(x - mx, y - my) < 25);
}
//: A footprint too small to be a room (STRUCTURE_MAX_M2). One no wider than STRUCTURE_POLE_M
//: is a steel monopole as tall as the footprint was measured (or the default, untold), tapering
//: up from the footprint's width; past 9 m it carries the three-sector panel head of a cell
//: site, which is what a monopole in a San Francisco park is. A wider one is a plain cabinet.
//: The pole's form and its head are a visual prior, not anything observed. Footprints drawn one
//: inside another are one mast (Moscone's two, 1.8 m apart): the larger stands, the other is
//: left out (structurePoles).
const structurePoles = new Map();
function structureMesh(feature, areaM2) {
  const local = feature.points.map((p) => xy(p[0], p[1]));
  const xs = local.map((p) => p[0]), ys = local.map((p) => p[1]);
  const wide = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const measured = feature.height_source && feature.height_source !== "inferred_default";
  const base = groundBaseFor(feature.points);
  const seed = Math.round(feature.points[0][0] * 1e5 + feature.points[0][1] * 7919e5);
  const group = new THREE.Group();
  const info = { surface: "structure", osm_id: feature.osm_id, area_m2: +areaM2.toFixed(1),
                 height_basis: measured ? feature.height_source : "inferred_default",
                 appearance_basis: "visual_prior", residential_layout: false, liftedOntoGround: true };
  group.userData = info;
  if (wide <= STRUCTURE_POLE_M) {
    const height = Math.max(4, feature.height_m || 10.5);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = -(Math.min(...ys) + Math.max(...ys)) / 2;
    const cell = `${Math.round(cx / 4)}:${Math.round(cz / 4)}`;
    for (const [key, other] of structurePoles) {
      if (other.id === feature.osm_id || Math.hypot(other.x - cx, other.z - cz) > STRUCTURE_POLE_M) continue;
      if (other.area >= areaM2) return new THREE.Group();
      other.group.removeFromParent();
      structurePoles.delete(key);
    }
    const r0 = Math.max(0.22, Math.min(0.5, wide * 0.28)), r1 = r0 * 0.55;
    const steel = new THREE.MeshStandardMaterial({ color: 0x9da3a6, roughness: 0.45, metalness: 0.55 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, height, 14), steel);
    pole.position.set(cx, base + height / 2, cz);
    pole.castShadow = true;
    pole.userData = { ...info, surface: "structure:mast" };
    group.add(pole);
    if (height >= 9) {
      const top = base + height - 1.1;
      const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 3), steel);
      frame.position.set(cx, top - 0.85, cz);
      frame.rotation.y = random(seed) * Math.PI;
      group.add(frame);
      const panel = new THREE.MeshStandardMaterial({ color: 0xd7dad6, roughness: 0.6, metalness: 0.1 });
      for (let k = 0; k < 3; k += 1) {
        const a = frame.rotation.y + Math.PI / 6 + k * (2 * Math.PI / 3);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.45, 0.13), panel);
        box.position.set(cx + Math.cos(a) * 0.8, top, cz - Math.sin(a) * 0.8);
        box.rotation.y = a + Math.PI / 2;
        box.castShadow = true;
        box.userData = { ...info, surface: "structure:antenna" };
        group.add(box);
      }
    }
    structurePoles.set(`${feature.osm_id}:${cell}`, { id: feature.osm_id, x: cx, z: cz, area: areaM2, group });
    return group;
  }
  const shape = footprintShape(feature.points);
  if (!shape) return null;
  const height = measured ? Math.max(1, feature.height_m) : STRUCTURE_BOX_M;
  const body = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, UVGenerator: FACADE_UV });
  body.rotateX(-Math.PI / 2);
  body.translate(0, base, 0);
  const mesh = new THREE.Mesh(body, [
    new THREE.MeshStandardMaterial({ color: 0x74787a, roughness: 0.8, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ map: outbuildingTexture(seed), color: 0x8e928c, roughness: 0.9 }),
  ]);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData = { ...info, surface: "structure:cabinet" };
  group.add(mesh);
  return group;
}

// ---- buildings in parts: setbacks, overhangs, courtyards and roofs ----
//
// An outline extruded to one height is a box, which is what most of the city is and what
// downtown is not. The Transamerica Pyramid is a pyramid on a podium with its two wings
// rising past it; a tower steps back from its base; an upper floor overhangs the plaza on
// columns; a hotel has a light well cut out of the middle of the block. OpenStreetMap maps all
// of it (building:part with height and min_height, roof:shape, multipolygon courtyards), and
// scripts/fetch_building_shapes.py puts it beside the payload, keyed by the outline's way.
// A building with parts is drawn as its parts and not as its outline, the way OpenStreetMap's
// own 3D renderers draw it. The geometry comes back as the extrusion's did: caps (here the
// roofs and any underside) in group 0, walls in group 1, non-indexed, in world space.
const ROOF_DEFAULT_PITCH = 0.35;
function compassBearing(value) {
  const named = { n: 0, nne: 22.5, ne: 45, ene: 67.5, e: 90, ese: 112.5, se: 135, sse: 157.5,
                  s: 180, ssw: 202.5, sw: 225, wsw: 247.5, w: 270, wnw: 292.5, nw: 315, nnw: 337.5 };
  if (value === undefined || value === null) return null;
  const text = String(value).trim().toLowerCase();
  if (text in named) return named[text];
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : null;
}
function shapedBuildingGeometry(feature, height) {
  const spec = feature.shape;
  const parts = spec.parts?.length ? spec.parts
    // A roof or a courtyard on the outline itself keeps the building's own height: the lidar's
    // or the payload's, which the tag does not outrank.
    : [{ ...(spec.self || {}), outer: feature.points, holes: spec.holes, height_m: height }];
  const caps = [], capUv = [], walls = [], wallUv = [];
  let top = 0;
  const local = (ring) => {
    const out = ring.map(([lon, lat]) => xy(lon, lat));
    const [a, b] = [out[0], out[out.length - 1]];
    if (out.length > 1 && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
    return out;
  };
  const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const signedArea = (r) => r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2;
  // A triangle facing up (or down), whichever way round it came: x, y in the plan, z the height.
  const roofTri = (p, q, r, down = false) => {
    const ccw = cross2(p, q, r) > 0;
    const [a, b, c] = ccw !== down ? [p, q, r] : [p, r, q];
    for (const v of [a, b, c]) { caps.push(v[0], v[2], -v[1]); capUv.push(v[0] / 20, v[1] / 20); }
  };
  // A wall from a to b, its foot at za0/zb0 and its head at za1/zb1, facing out of a CCW ring.
  const wallQuad = (a, b, za0, zb0, za1, zb1, storey) => {
    if (za1 - za0 < 0.01 && zb1 - zb0 < 0.01) return;
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]) / BAY_M;
    const base = Math.min(za0, zb0);
    const corners = [[a, za0, 0], [b, zb0, run], [b, zb1, run], [a, za0, 0], [b, zb1, run], [a, za1, 0]];
    for (const [p, z, u] of corners) { walls.push(p[0], z, -p[1]); wallUv.push(u, (z - base) / storey); }
  };
  const wallTri = (a, b, apex, z0, storey) => {
    // A gable end: the wall's triangle above the eave, facing the way the a->b wall faces.
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]) / BAY_M;
    for (const [p, z, u] of [[a, z0, 0], [b, z0, run], [apex, apex[2], run / 2]]) {
      walls.push(p[0], z, -p[1]); wallUv.push(u, (z - z0) / storey);
    }
  };
  for (const part of parts) {
    if (!Array.isArray(part.outer) || part.outer.length < 4) continue;
    const outer = local(part.outer);
    if (outer.length < 3) continue;
    if (signedArea(outer) < 0) outer.reverse();
    const holes = (part.holes || []).map(local).filter((h) => h.length >= 3);
    for (const h of holes) if (signedArea(h) > 0) h.reverse();
    const bottom = Math.max(0, part.min_height_m || 0);
    let partTop = Number.isFinite(part.height_m) ? part.height_m : height;
    const span = Math.sqrt(Math.abs(signedArea(outer)));
    let shape = holes.length && part.roof !== "flat" ? "flat" : (part.roof || "flat");
    let roofH = shape === "flat" ? 0 : Number.isFinite(part.roof_height_m) ? part.roof_height_m
      : Math.min(span * (shape === "dome" || shape === "onion" ? 0.5 : ROOF_DEFAULT_PITCH), Math.max(0, partTop - bottom) * 0.5);
    // A roof taller than the part it sits on means the part's top is the roof's apex. The
    // Transamerica Pyramid's spire is mapped as a 230 m pyramidal roof on a part whose height
    // says 60: its apex is 260 m, which is what the building is.
    if (roofH > 0 && bottom + roofH > partTop) partTop = bottom + roofH;
    if (!(partTop - bottom > 0.2)) continue;
    roofH = Math.min(roofH, partTop - bottom);
    const eave = partTop - roofH;
    top = Math.max(top, partTop);
    const storey = facadeStoreyMetres(Math.max(0.1, eave - bottom || partTop - bottom));
    // A skillion is a plane: the height of each corner along the way the roof faces down.
    let zAt = () => eave;
    if (shape === "skillion") {
      let bearing = compassBearing(part.roof_direction);
      if (bearing === null) {
        // Unstated, it falls across the part's longest side.
        let best = 0, angle = 0;
        outer.forEach((p, i) => {
          const q = outer[(i + 1) % outer.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len > best) { best = len; angle = Math.atan2(q[1] - p[1], q[0] - p[0]); }
        });
        bearing = 90 - (angle * 180 / Math.PI) + 90;
      }
      const dx = Math.sin(bearing * Math.PI / 180), dy = Math.cos(bearing * Math.PI / 180);
      const s = outer.map((p) => p[0] * dx + p[1] * dy);
      const lo = Math.min(...s), hi = Math.max(...s);
      zAt = (p) => eave + roofH * (hi - (p[0] * dx + p[1] * dy)) / Math.max(hi - lo, 1e-6);
    }
    for (const ring of [outer, ...holes]) {
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        wallQuad(a, b, bottom, bottom, zAt(a), zAt(b), storey);
      });
    }
    const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const holeVectors = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    const all = [...outer, ...holes.flat()];
    const triangles = THREE.ShapeUtils.triangulateShape(contour, holeVectors);
    // The underside of a part that starts above the ground: the soffit of an overhang.
    if (bottom > 0.05) {
      for (const [i, j, k] of triangles) roofTri([...all[i], bottom], [...all[j], bottom], [...all[k], bottom], true);
    }
    if (shape === "flat" || shape === "skillion" || roofH < 0.05) {
      for (const [i, j, k] of triangles) roofTri(...[i, j, k].map((n) => [...all[n], zAt(all[n])]));
      continue;
    }
    // Four corners and a ridge: gabled has its ends as walls, hipped slopes them back.
    if (outer.length === 4 && ["gabled", "hipped", "half-hipped", "gambrel", "saltbox", "mansard", "round"].includes(shape)) {
      const sides = outer.map((p, i) => Math.hypot(outer[(i + 1) % 4][0] - p[0], outer[(i + 1) % 4][1] - p[1]));
      let k = sides[0] + sides[2] >= sides[1] + sides[3] ? 0 : 1;
      if (part.roof_orientation === "across") k = 1 - k;
      const [A, B, C, D] = [0, 1, 2, 3].map((n) => outer[(n + k) % 4]);
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const m1 = mid(D, A), m2 = mid(B, C);
      const along = Math.hypot(m2[0] - m1[0], m2[1] - m1[1]), across = (sides[(k + 1) % 4] + sides[(k + 3) % 4]) / 2;
      const inset = shape === "gabled" || shape === "round" || shape === "saltbox" || shape === "gambrel" ? 0
        : shape === "half-hipped" ? Math.min(across / 4, along / 2) : Math.min(across / 2, along / 2);
      const t = along > 0 ? inset / along : 0;
      const R1 = [m1[0] + (m2[0] - m1[0]) * t, m1[1] + (m2[1] - m1[1]) * t, partTop];
      const R2 = [m2[0] + (m1[0] - m2[0]) * t, m2[1] + (m1[1] - m2[1]) * t, partTop];
      const e = (p) => [...p, eave];
      roofTri(e(A), e(B), R2); roofTri(e(A), R2, R1);
      roofTri(e(C), e(D), R1); roofTri(e(C), R1, R2);
      if (inset < 0.01) { wallTri(B, C, R2, eave, storey); wallTri(D, A, R1, eave, storey); }
      else { roofTri(e(B), e(C), R2); roofTri(e(D), e(A), R1); }
      continue;
    }
    // A dome is rings drawn in toward the middle; anything else comes to a point.
    const [cx, cy] = (() => {
      let sx = 0, sy = 0;
      for (const p of outer) { sx += p[0]; sy += p[1]; }
      return [sx / outer.length, sy / outer.length];
    })();
    const steps = shape === "dome" || shape === "onion" || shape === "round" ? 6 : 1;
    let previous = outer.map((p) => [p[0], p[1], eave]);
    for (let s = 1; s <= steps; s += 1) {
      const angle = (s / steps) * Math.PI / 2;
      const f = steps === 1 ? 0 : Math.cos(angle), z = eave + roofH * (steps === 1 ? 1 : Math.sin(angle));
      const ring = s === steps ? null : outer.map((p) => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f, z]);
      for (let i = 0; i < outer.length; i += 1) {
        const j = (i + 1) % outer.length;
        if (!ring) roofTri(previous[i], previous[j], [cx, cy, partTop]);
        else { roofTri(previous[i], previous[j], ring[j]); roofTri(previous[i], ring[j], ring[i]); }
      }
      previous = ring;
    }
  }
  if (!caps.length && !walls.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([...caps, ...walls], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([...capUv, ...wallUv], 2));
  geometry.addGroup(0, caps.length / 3, 0);
  geometry.addGroup(caps.length / 3, walls.length / 3, 1);
  geometry.computeVertexNormals();
  return { geometry, top };
}

function buildingMesh(feature) {
  // A station under the street has no walls above it.
  if (feature.underground) return null;
  if (feature.parkFacility) return parkFacilityMesh(feature);
  const shape = footprintShape(feature.points);
  if (!shape) return null;
  const areaM2 = footprintArea(feature.points);
  const kind = structureClass(feature, areaM2);
  // A canopy has no walls under it. Drawing nothing leaves the parcel it stands on to the
  // ground cover, which is grass and a fence -- which is what is there.
  if (kind === "canopy") return null;
  // Marked on the way, so its doors, windows, fit and rooms are left out (settleDoors,
  // homeWindowLayout, buildInterior): the building pass runs before any of those.
  if (kind === "structure") { feature._structure = true; return structureMesh(feature, areaM2); }
  // No exaggeration. This was multiplied by 1.8 to make massing read from a bird's eye, which
  // put every building eighty per cent taller than OpenStreetMap says it is -- fine as a
  // diagram, wrong the moment somebody walks down the street beside it.
  // No ceiling: the tallest building is as tall as it was measured. (It was clamped to 260 m,
  // which a supertall tower would have met.) The floor stays: under 3 m is not a building.
  let height = Math.max(3, feature.height_m || 10.5);
  // A default height on a building whose type has a real one is worse than no default. Only
  // the inferred heights are capped; a measured one is left exactly as recorded.
  // Only a guessed height is capped by the type. A height somebody measured -- lidar over the
  // roof, or a mapper's tag -- outranks a type that was itself inferred from a point of interest
  // inside the building. 601 California Street is a 96 m office tower with a public garage in
  // its base; the garage made it "parking", and the parking cap made a 96 m tower sixteen
  // metres tall.
  const cap = ARCHETYPE_MAX_HEIGHT[feature.archetype];
  if (cap && (feature.height_source === "inferred_default" || !feature.height_source)) {
    height = Math.min(height, cap);
  }
  // And a "parking" building that is measured well above any parking structure is not one: it
  // is a tower with a garage in it, and gets a tower's cladding rather than a car park's.
  if (feature.archetype === "parking" && height > 24 && feature.height_source !== "inferred_default") {
    feature.archetype = feature.land_use && /OFFICE/i.test(feature.land_use) ? "office" : "generic";
  }
  if (kind === "outbuilding") {
    // A rear cottage is one storey, or two if it is a big one. The corridor median that was
    // being applied to these belongs to the street frontage, not to the garden.
    height = Math.min(height, Math.max(2.6, Math.min(OUTBUILDING_MAX_M,
                                                     1.05 * Math.sqrt(Math.max(areaM2, 1)))));
  }
  // Drawn as its parts where OpenStreetMap maps them, and as tall as the tallest of them.
  const shaped = feature.shape && kind === "building" ? shapedBuildingGeometry(feature, height) : null;
  if (shaped) height = shaped.top;
  // A building stands on the hill at the height the lidar measured the ground there -- the
  // lowest ground under its footprint, so no corner floats. A car park or a filling station
  // is a lot at one level, and stands at the same height with everything on it.
  const hillLift = groundBaseFor(feature.points);
  // Its roof is where it was measured: the height over the median ground at its foot, so
  // drawn from the low corner it is that much taller (groundRiseFor). Not a car park or a
  // filling station (a lot at one level), nor a building drawn as its mapped parts.
  const rise = !shaped && !ARCHETYPE_LOT_KINDS.has(feature.archetype) ? groundRiseFor(feature.points, hillLift) : 0;
  if (rise > 0.05) { height += rise; feature._groundRiseM = +rise.toFixed(2); }
  // Seeded from the footprint, so a building keeps its material and colour between reloads.
  const seed = Math.round((feature.points[0][0] * 1e5) + (feature.points[0][1] * 1e5) * 7919);
  // Runtime-only clearance extent, shared with the tree/house intersection cut.
  feature._treeClipBase=hillLift;feature._treeClipRoof=hillLift+height;
  BUILDING_LIFT_M = hillLift;
  const archetype = placeArchetypeMesh(feature, seed);
  if (archetype) {
    BUILDING_LIFT_M = 0;
    if (hillLift !== 0) archetype.position.y = hillLift;
    return archetype;
  }
  let geom = shaped ? shaped.geometry : new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: false, UVGenerator: FACADE_UV,
  });
  if (!shaped) geom.rotateX(-Math.PI / 2);
  if (hillLift !== 0) { geom.translate(0, hillLift, 0); feature._hillLiftM = +hillLift.toFixed(2); }
  // A researched storefront cuts its ground band out of the plain extruded shell it was fitted
  // to; a shaped roof's shell, or a height that has moved, keeps the original renderer.
  let exteriorPlan=typeof storeExteriorFor==="function" ? storeExteriorFor(feature) : null, exteriorOrigin=null;
  if(exteriorPlan && (shaped || Math.abs(exteriorPlan.height_m-height)>.001 || !exteriorPlan.origin_lon_lat)) {
    feature._storeExteriorDisabled=true;exteriorPlan=null;
  }
  if(exteriorPlan) {
    const [x,y]=xy(...exteriorPlan.origin_lon_lat);
    exteriorOrigin={x,y:hillLift,z:-y};
    const original=geom;
    geom=STORE_EXTERIOR_RUNTIME.renderer.cutWallBands(original,exteriorPlan,exteriorOrigin);
    original.dispose();
  }
  // A house: a home with no shop in it. Its walls carry no painted windows; its real windows are
  // drawn on them (homeWindowLayout), the same ones its shell opens when the walker is there.
  const isHome = kind === "building" && ["residential", "generic"].includes(feature.archetype)
    && !hasStorefront(feature) && !shaped && !exteriorPlan;
  const material = pickMaterial(seed, height, feature.archetype, feature.facade || null,
                                feature.osm_id, isHome, feature);
  const style = ARCHETYPE_STYLE[feature.archetype];
  const palette = style ? style.colours : material.colours;
  // A colour taken off a photograph of this building, where one was. Otherwise the palette,
  // which is a statement about San Francisco's building stock and not about this building.
  // The colour sampled across the building's frames where there is one; else the colour read off
  // its photographed walls (facade_photo_materials, via the material assignments).
  const photoColour = frontageFitFor(feature)?.appearance?.colour || (feature.colour !== undefined ? feature.colour
    : (MATERIAL_ASSIGNMENTS.assigned || {})[String(feature.osm_id)]?.colour);
  let tint = photoColour !== undefined
    ? liftSampledColour(photoColour)
    : palette[Math.floor(random(seed + 11) * palette.length)];
  const sampled = photoColour !== undefined;
  // Solid, both of them. Transparency was carrying a meaning -- an inferred height was drawn
  // see-through so it could not be mistaken for a measured one -- and it was paying far too much
  // for it. A translucent building shows the buildings behind it through its own roof, puts
  // itself in the depth-sorted transparent queue where it fights with everything else in there,
  // and reads as scaffolding rather than as a building.
  const opacity = 1.0;
  // ExtrudeGeometry emits two material groups: the caps first, then the walls. Giving both the
  // facade map put a grid of windows across every rooftop -- which reads, from above, as though
  // the city were tiled in glass.
  // The roof takes the wall's colour, darkened. A fixed grey top on a coloured building looked
  // like a lid set on something else, and from above -- which is most of how this map is read --
  // the roof is the building.
  // A building keeps its colour whether or not anyone recorded its height. Its height being
  // guessed used to be shown by greying it out -- which greyed out nearly every house in the
  // city, photographed colour and all. How sure the height is lives in houseCertainty instead.
  // Darkened, but with a floor. At a flat 0.68 a dark wall gave a roof near enough to black
  // that whole blocks read as holes in the city from above -- which is exactly what a hole
  // looks like, and sent me hunting for missing ground that was never missing.
  // A roof is the same building seen from above and a little darker for it. Both the darkening
  // and its floor are done in sRGB: multiplyScalar works on linear channels, where 0.80 is a
  // far smaller step than it looks, and the floor of 0.22 was being read as a linear lightness,
  // which is sRGB 0.50 -- so a dark roof was not being stopped from going black, it was being
  // pushed up to mid grey, and every roof in the city ended up the same pale tone.
  // Where the aerial photograph saw this roof in sun, its colour is the roof's own
  // (scripts/build_ortho_roofs.py), with the haze taken back out (correctedRoofColour); and the
  // roof is drawn as what that colour says it is -- tar, membrane, concrete, gravel, shingle,
  // tile or metal (roofFinishFor). A roof nobody photographed is what roofs like it are.
  const pitched = Boolean(feature.shape?.parts?.some?.((p) => p.roof && p.roof !== "flat"));
  const finish = kind === "outbuilding" ? null : roofFinishFor(feature, seed, tint, pitched);
  const roofTint = new THREE.Color(tint);
  if (finish) {
    roofTint.copy(finish.colour);
  } else {
    const hsl = {};
    roofTint.getHSL(hsl, THREE.SRGBColorSpace);
    roofTint.setHSL(hsl.h, hsl.s, Math.max(ROOF_LIGHTNESS_FLOOR, hsl.l * 0.86),
                    THREE.SRGBColorSpace);
  }
  const surfaceFinish = finish ? ROOF_SURFACES[finish.surface] : null;
  const roof = new THREE.MeshStandardMaterial({
    map: kind === "outbuilding" ? outbuildingRoofTexture(seed)
      : roofSurfaceTextureFor(finish.surface, seed),
    color: 0xffffff, transparent: opacity < 1, opacity,
    roughness: surfaceFinish ? surfaceFinish.roughness : 0.97,
    metalness: surfaceFinish ? surfaceFinish.metalness : material.name === "metal" ? 0.5 : 0.03,
  });
  if (finish) roof.userData.roofSurface = finish.surface;
  const walls = new THREE.MeshStandardMaterial({
    map: kind === "outbuilding" ? outbuildingTexture(seed)
      : isHome ? bareFacadeTextureFor(material, seed) : facadeTextureFor(material, seed),
    color: tint,
    transparent: opacity < 1,
    opacity,
    roughness: material.rough,
    metalness: material.metal,
    // Glass and metal are mirrors of the sky, so they need something to reflect. The tint alone
    // gives a flat blue rectangle; the environment map is what makes it read as a window.
    envMapIntensity: material.name === "glass" ? 1.6 : material.name === "metal" ? 1.1 : 0.35,
  });
  // Fifteen thousand seven hundred buildings were fifteen thousand seven hundred draw calls.
  // They share a hundred and fifty three wall textures between them and, now that the roof is
  // neutral, sixteen roof textures -- so what actually differs between two buildings with the
  // same cladding is their colour, and a colour can travel on the vertices. Merged by texture
  // they are about a hundred and seventy meshes with the same pixels.
  //
  // What that costs is the ability to raycast a building and get the building. Picking is done
  // against the footprints instead, which is better anyway: it works when you click the roof.
  const group = new THREE.Group();
  // The group is at zero: everything hung on the building writes world coordinates and takes
  // BUILDING_LIFT_M itself, so nothing is lifted twice.
  if (hillLift !== 0) group.userData.hillLiftM = feature._hillLiftM;
  const capColour = new THREE.Color(roofTint.getHex());
  // A photographed albedo already contains its own colour. Multiplying it by the whole
  // sampled facade tint makes brick and plaster almost black; retain only a gentle hint of
  // building-specific colour while preserving the material image's measured contrast.
  //
  // A painted material (stucco, siding, shingle...) is drawn as light and shade only
  // (toPaintableDetail), so it takes the building's colour in full: the house is its own colour
  // with the grain of its cladding. Brick and stone keep their photographed colour.
  const wallColour = material.photoLabel && !PAINTABLE_PHOTO_CLASSES.has(material.photoLabel)
    ? new THREE.Color(0xffffff).lerp(new THREE.Color(tint), 0.22)
    : new THREE.Color(tint);
  let appearanceBands=facadeAppearanceBands(feature,{material,seed,tint:wallColour.getHex(),height,bottom:0,top:height});
  // A house is one colour: its bands' sampled colours averaged over their heights (in linear
  // light, where averaging means something), each already lifted for the camera's exposure.
  if (isHome && appearanceBands.length > 1) {
    const mean = new THREE.Color(0, 0, 0);
    let span = 0;
    for (const band of appearanceBands) {
      const h = Math.max(0, band.top - band.bottom), c = new THREE.Color(band.tint);
      mean.r += c.r * h; mean.g += c.g * h; mean.b += c.b * h; span += h;
    }
    if (span > 0) {
      mean.multiplyScalar(1 / span);
      appearanceBands = appearanceBands.map((band) => ({ ...band, tint: mean.getHex() }));
      wallColour.setHex(mean.getHex());
    }
  }
  if (isHome) {
    const id = String(feature.osm_id);
    // Which way round ExtrudeGeometry walked the outline (it makes every outline clockwise):
    // the shell maps its walls' texture from the same end, so the pattern does not shift.
    const clockwise = THREE.ShapeUtils.isClockWise(feature.points.map(([lon, lat]) => new THREE.Vector2(...xy(lon, lat))));
    HOME_RENDER.set(id, { feature, material, seed, tint: wallColour.getHex(),
      height, base: hillLift, clockwise, appearanceBands });
    BUILDING_VISUAL_ID = id;
  }
  if (kind !== "outbuilding") {
    // How the street front is drawn, for the exterior editor: the colour on the vertices and
    // the cladding it multiplies, from the tallest band where the front is drawn in bands.
    const banded = appearanceBands.some((b) => b.frontBasis) || frontageFitFor(feature);
    const lead = banded ? appearanceBands.reduce((best, b) => (!best || b.top - b.bottom > best.top - best.bottom ? b : best), null) : null;
    const lookMaterial = lead?.material || material;
    BUILDING_WALL_LOOK.set(String(feature.osm_id), {
      tint: lead ? new THREE.Color(lead.tint).getHex() : wallColour.getHex(),
      map: lead ? bareFacadeTextureFor(lookMaterial, seed) : walls.map,
      rough: lookMaterial.rough, metal: lookMaterial.metal,
      env: lookMaterial.name === "glass" ? 1.6 : lookMaterial.name === "metal" ? 1.1 : 0.35,
      storey: facadeStoreyMetres(height),
    });
  }
  roof.color.setHex(0xffffff);
  walls.color.setHex(0xffffff);
  roof.vertexColors = true;
  walls.vertexColors = true;
  for (const part of geom.groups) {
    const slice = geom.clone();
    // Its own userData (clone() shares the source's), and no building tag on the roof: nothing
    // ever hides a roof. (A view from above into a house used to lift it off, and the roof was
    // left missing when that view did not come back cleanly.)
    slice.userData = {};
    slice.clearGroups();
    // ExtrudeGeometry comes back non-indexed, in which case a group's start and count are a
    // straight run of vertices rather than a run of indices into them.
    const index = geom.getIndex();
    const taken = [];
    for (let i = part.start; i < part.start + part.count; i += 1) {
      taken.push(index ? index.getX(i) : i);
    }
    slice.setIndex(taken);
    if(part.materialIndex !== 0 && (appearanceBands.some(b=>b.frontBasis) || frontageFitFor(feature))) {
      const partitions=isHome ? [{indices:taken,front:true}] : frontageWallTriangles(feature,geom,taken);
      for(const partition of partitions) for(const band of appearanceBands) {
        const clipped=clipFacadeBand(geom,partition.indices,hillLift+band.bottom,hillLift+band.top);
        if(!clipped.getAttribute("position").count) {clipped.dispose();continue;}
        clipped.userData={};
        const bandWalls=walls.clone();
        bandWalls.map=partition.front ? bareFacadeTextureFor(band.material,seed) : facadeTextureFor(band.material,seed);
        bandWalls.roughness=band.material.rough;bandWalls.metalness=band.material.metal;
        bandWalls.envMapIntensity=band.material.name==="glass" ? 1.6 : band.material.name==="metal" ? 1.1 : .35;
        const colour=new THREE.Color(band.tint),count=clipped.getAttribute("position").count;
        const colours=new Float32Array(count*3);
        for(let i=0;i<count;i++) colours.set([colour.r,colour.g,colour.b],i*3);
        clipped.setAttribute("color",new THREE.BufferAttribute(colours,3));
        addMerged("wall",new THREE.Mesh(clipped,bandWalls),"building");
      }
      slice.dispose();continue;
    }
    const colour = part.materialIndex === 0 ? capColour : wallColour;
    const count = slice.getAttribute("position").count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    slice.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    addMerged(part.materialIndex === 0 ? "roof" : "wall",
              new THREE.Mesh(slice, part.materialIndex === 0 ? roof : walls), "building");
  }
  geom.dispose();
  // A flat roof stands inside its walls (PARAPET). Not on a building in parts, whose roofs are
  // its own shapes, nor on an outbuilding or a shed.
  if (kind === "building" && !shaped) {
    const spec = isHome || height < 13 ? PARAPET.house : height <= 26 ? PARAPET.block : PARAPET.tower;
    const trim = isHome ? wallColour.clone().lerp(new THREE.Color(0xf1ede3), 0.55)
      : wallColour.clone().lerp(new THREE.Color(0x8a8780), 0.3);
    const parapet = parapetGeometry(roofRing(feature), hillLift + height, spec, wallColour, trim);
    if (parapet) {
      addMerged("roof", new THREE.Mesh(parapet, parapetMaterial()), "building");
      feature._treeClipRoof = hillLift + height + spec.rise + 0.06;
    }
  }
  if (kind === "outbuilding") {
    // No shopfront, no bay windows, no balconies. A garden workshop has a door and a roof, and
    // the detail passes are what made these read as houses in the first place.
  } else {
    if(exteriorPlan) STORE_EXTERIOR_RUNTIME.renderer.mount(group,exteriorPlan,exteriorOrigin);
    addGroundFacadeDetail(group, feature, seed, height, tint);
    addSouthFacadeDetail(group, feature, seed, height);
    photoDetailParts(group, feature);
    photoOpeningParts(group,feature,!isHome);
    // Plant and solar want a flat roof the size of the outline, which a building in parts or
    // with a courtyard does not have.
    if (!shaped) addRoofFurniture(group, feature, seed, height, areaM2, wallColour.getHex());
    addShopfronts(feature, seed, height, tint);
    addBuildingNamePlaque(group, feature, seed, height, tint);
  }
  BUILDING_LIFT_M = 0;
  BUILDING_VISUAL_ID = null;
  group.userData = feature;
  // The building itself is merged, so this group holds only whatever detail stayed separate.
  // Returning an empty one adds fifteen thousand objects to the scene graph that draw nothing
  // and are walked on every frame.
  // The ordinary roof and walls were queued through addMerged above, so this group is
  // intentionally empty. Returning null here misreported a successful building as absent
  // and laid a dark fallback footprint over the plaza/sidewalk beneath every such building.
  return group.children.length ? group : true;
}

