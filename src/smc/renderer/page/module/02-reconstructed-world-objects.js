// ---- reconstructed world objects (smc.world) ----
//
// Everything else on this page is drawn from a *kind*: a kerb from a road's width, a bench from
// four boxes, a corner from a corner rule. What follows is drawn from measured shape. The page
// is told the geometry -- a path and the section swept along it, or triangles per level of
// detail -- and chooses no model. Where one of these stands, the page's own model of the same
// thing is not drawn (worldClaims), so the two never sit one on top of the other; everywhere
// else the old drawing carries on as the fallback it now is.
const WORLD_OBJECT_MATERIALS = {
  concrete: { color: 0xb4b3ad, roughness: 0.9 },
  granite: { color: 0xbdb8b0, roughness: 0.7 },
  stone: { color: 0xc9c1b2, roughness: 0.82 },
  wood: { color: 0x8a6a4a, roughness: 0.78 },
  metal: { color: 0x5d6166, roughness: 0.5, metalness: 0.45 },
  glass: { color: 0x9fb4c2, roughness: 0.12, metalness: 0.25 },
  wall: { color: 0xcfc6b8, roughness: 0.86 },
  trim: { color: 0xe6e1d8, roughness: 0.8 },
  roof: { color: 0x7a7470, roughness: 0.9 },
  door: { color: 0x5b4636, roughness: 0.7 },
  rail: { color: 0x3c3f43, roughness: 0.55, metalness: 0.4 },
};
const WORLD_MATERIAL_CACHE = new Map();
function worldObjectMaterial(name) {
  let material = WORLD_MATERIAL_CACHE.get(name);
  if (!material) {
    material = new THREE.MeshStandardMaterial(WORLD_OBJECT_MATERIALS[name] || WORLD_OBJECT_MATERIALS.concrete);
    WORLD_MATERIAL_CACHE.set(name, material);
  }
  return material;
}

//: Metres per degree at a latitude -- the same formulae smc.world.compile writes with, so a
//: vertex lands where the canonical object put it.
function worldMetresPerDegree(lat) {
  const r = lat * Math.PI / 180;
  return [111412.84 * Math.cos(r), 111132.954 - 559.822 * Math.cos(2 * r)];
}
function worldLocalToPage(anchor, east, north) {
  const [perLon, perLat] = worldMetresPerDegree(anchor[1]);
  const [x, y] = xy(anchor[0] + east / perLon, anchor[1] + north / perLat);
  return [x, -y];
}

//: A section swept along a path, exactly as smc.geometry.extrusion.SplineExtrusion sweeps it:
//: mitred at every vertex, bevel-limited, inner offsets that would fold pulled together, one
//: strip per section edge (so a kerb's face and top keep their own normals) and a hard seam at
//: every break (so a sharp corner stays sharp). Local metres in, local metres out.
const WORLD_MITER_LIMIT = 4.0;
function sweepGeometryLocal(path, breaks, closedPath, profile, closedProfile, caps) {
  const n = path.length, count = profile.length;
  const d = [];
  for (let k = 0; k < n - 1; k += 1) {
    const dx = path[k + 1][0] - path[k][0], dy = path[k + 1][1] - path[k][1];
    const len = Math.hypot(dx, dy);
    d.push(len > 0 ? [dx / len, dy / len] : (k ? d[k - 1] : [1, 0]));
  }
  const left = d.map(([dx, dy]) => [-dy, dx]);
  const miter = new Array(n), scale = new Array(n).fill(1);
  miter[0] = left[0];
  miter[n - 1] = left[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    let mx = left[i - 1][0] + left[i][0], my = left[i - 1][1] + left[i][1];
    const norm = Math.hypot(mx, my);
    if (norm < 1e-9) { miter[i] = left[i]; continue; }
    mx /= norm; my /= norm;
    miter[i] = [mx, my];
    scale[i] = Math.min(1 / Math.max(mx * left[i][0] + my * left[i][1], 1e-6), WORLD_MITER_LIMIT);
  }
  const closed = closedPath && n > 2 && path[0][0] === path[n - 1][0] && path[0][1] === path[n - 1][1];
  if (closed) {
    let mx = left[n - 2][0] + left[0][0], my = left[n - 2][1] + left[0][1];
    const norm = Math.max(Math.hypot(mx, my), 1e-9);
    mx /= norm; my /= norm;
    miter[0] = miter[n - 1] = [mx, my];
    scale[0] = scale[n - 1] = Math.min(1 / Math.max(mx * left[0][0] + my * left[0][1], 1e-6), WORLD_MITER_LIMIT);
  }
  // rings[i][k] = [east, north, up]
  const rings = [];
  for (let i = 0; i < n; i += 1) {
    const ring = [];
    for (let k = 0; k < count; k += 1) {
      const lateral = profile[k][0] * scale[i];
      ring.push([path[i][0] + lateral * miter[i][0], path[i][1] + lateral * miter[i][1], (path[i][2] || 0) + profile[k][1]]);
    }
    rings.push(ring);
  }
  for (let k = 0; k < count; k += 1) {        // unfold, as smc.geometry.extrusion._unfold
    for (let round = 0; round < 8; round += 1) {
      let moved = false;
      for (let i = 0; i < n - 1; i += 1) {
        const ox = rings[i + 1][k][0] - rings[i][k][0], oy = rings[i + 1][k][1] - rings[i][k][1];
        const px = path[i + 1][0] - path[i][0], py = path[i + 1][1] - path[i][1];
        if (ox * px + oy * py < 0) {
          const mx = (rings[i][k][0] + rings[i + 1][k][0]) / 2, my = (rings[i][k][1] + rings[i + 1][k][1]) / 2;
          rings[i][k][0] = rings[i + 1][k][0] = mx;
          rings[i][k][1] = rings[i + 1][k][1] = my;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  const edges = [];
  for (let k = 0; k < count - 1; k += 1) edges.push([k, k + 1]);
  if (closedProfile) edges.push([count - 1, 0]);
  const cuts = [0, ...breaks.filter((b) => b > 0 && b < n - 1), n - 1];
  // Metres along the path and round the section, for a surface laid by them (uv, in metres).
  const along = [0], round = [0];
  for (let i = 1; i < n; i += 1) along.push(along[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  for (let k = 1; k < count; k += 1) round.push(round[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  const vertices = [], index = [], uv = [];
  for (let c = 0; c < cuts.length - 1; c += 1) {
    const a = cuts[c], b = cuts[c + 1], m = b - a + 1;
    for (const [k0, k1] of edges) {
      const base = vertices.length / 3;
      for (let i = a; i <= b; i += 1) { vertices.push(...rings[i][k0]); uv.push(along[i], round[k0]); }
      for (let i = a; i <= b; i += 1) { vertices.push(...rings[i][k1]); uv.push(along[i], k1 ? round[k1] : round[count - 1] + Math.hypot(profile[0][0] - profile[count - 1][0], profile[0][1] - profile[count - 1][1])); }
      for (let i = 0; i < m - 1; i += 1) {
        const A = base + i, B = base + m + i, C = base + m + i + 1, D = base + i + 1;
        index.push(A, B, C, A, C, D);
      }
    }
  }
  if (caps && closedProfile) {
    const tris = earClip(profile);
    for (const [ring, flip] of [[rings[0], true], [rings[n - 1], false]]) {
      const base = vertices.length / 3;
      for (const p of ring) { vertices.push(...p); uv.push(p[0], p[2]); }
      for (const [i0, i1, i2] of tris) index.push(...(flip ? [base + i2, base + i1, base + i0] : [base + i0, base + i1, base + i2]));
    }
  }
  return { vertices, index, uv };
}

//: A surveyed curb's section as San Francisco's standard curb is drawn (KERB_PROFILE, module
//: 05): from the toe at the gutter, the face battered back one in four, the nose rounded, the
//: top out to the measured back. Its height, its back and which way it faces are the survey's;
//: its section was a toe, a 15 mm lean and a square corner. Same order (toe first or last) as
//: the section given, so its faces keep facing out.
function sfCurbSection(profile) {
  if (!profile || profile.length < 3) return profile;
  const toeFirst = Math.abs(profile[0][1]) < Math.abs(profile[profile.length - 1][1]);
  const ordered = toeFirst ? profile : [...profile].reverse();
  const toe = ordered[0], back = ordered[ordered.length - 1], height = back[1] - toe[1];
  if (!(height > 0.03)) return profile;
  const s = Math.sign(back[0] - toe[0]) || -1;
  const r = Math.min(KERB_PROFILE.nose * 1.2, height * 0.4), b = KERB_PROFILE.batter;
  // The corner where the battered face would meet the top, and the nose rounded into it.
  const corner = [toe[0] + s * b * height, back[1]];
  const fl = Math.hypot(b, 1), f = [s * b / fl, 1 / fl];
  const p1 = [corner[0] - f[0] * r, corner[1] - f[1] * r], p2 = [corner[0] + s * r, corner[1]];
  const out = [[toe[0], toe[1]], p1];
  for (let k = 1; k < KERB_PROFILE.noseSteps; k += 1) {
    const t = k / KERB_PROFILE.noseSteps, u = 1 - t;
    out.push([u * u * p1[0] + 2 * u * t * corner[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * corner[1] + t * t * p2[1]]);
  }
  out.push(p2);
  if (Math.abs(back[0] - toe[0]) > Math.abs(p2[0] - toe[0]) + 0.01) out.push([back[0], back[1]]);
  return toeFirst ? out : out.reverse();
}

function earClip(polygon) {
  // Ear clipping for a simple polygon, as smc.geometry.extrusion.triangulate_polygon.
  const pts = polygon;
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  const idx = pts.map((_, i) => i);
  if (area < 0) idx.reverse();
  const tris = [];
  const inside = (p, a, b, c) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0
    && (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]) >= 0
    && (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard < 10000) {
    guard += 1;
    let clipped = false;
    for (let k = 0; k < idx.length; k += 1) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-12) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c))) continue;
      tris.push(area >= 0 ? [i0, i1, i2] : [i2, i1, i0]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(area >= 0 ? [idx[0], idx[1], idx[2]] : [idx[2], idx[1], idx[0]]);
  return tris;
}

//: The swept level the page draws. Level 1 is the path to a centimetre: the finest level's
//: detail below that is invisible at street distance, and merged street geometry is culled by
//: distance as a whole rather than switched per object.
function worldSweepLevel(lods) {
  return lods.find((l) => l.level === 1) || lods.reduce((a, b) => (b.level > a.level ? b : a));
}
function worldSweepLocal(record) {
  const level = worldSweepLevel(record.sweep.lods);
  const path = [];
  for (let i = 0; i < level.path.length; i += 2) path.push([level.path[i] / 1000, level.path[i + 1] / 1000, 0]);
  const profile = [];
  for (let i = 0; i < record.sweep.profile.length; i += 2) profile.push([record.sweep.profile[i] / 1000, record.sweep.profile[i + 1] / 1000]);
  // A kerb's height follows the page's kerb rule: when every kerb is drawn at one height
  // (KERB_RENDER_UNIFORM), a reconstructed kerb is too. Its measured height is kept in the
  // canonical object either way; this is a drawing decision, not a measurement.
  const height = record.sweep.params && record.sweep.params.height;
  if (record.type === "curb" && height && height.value > 0 && typeof KERB_RENDER_UNIFORM !== "undefined" && KERB_RENDER_UNIFORM) {
    const k = renderedKerbHeight(null) / height.value;
    for (const p of profile) p[1] *= k;
  }
  const swept = sweepGeometryLocal(path, level.breaks || [], !!level.closed, profile, !!record.sweep.closed_profile, !!record.sweep.caps);
  swept.profile = profile;
  return swept;
}

//: What each reconstructed object stands in for. A kerb claims the stretch of kerb line within
//: reach of it and running its way; a bench or a post claims a disc. The page's own drawing
//: of the same thing is left out there.
const WORLD_CLAIM_CELL_M = 10;
const WORLD_CLAIM_ALIGN_COS = Math.cos(35 * Math.PI / 180);
let WORLD_CLAIMS = null;
function worldClaims() {
  if (WORLD_CLAIMS) return WORLD_CLAIMS;
  const lines = new Map(), points = [];
  for (const record of (WORLD_OBJECTS.objects || [])) {
    const claim = record.claim;
    if (!claim) continue;
    if (claim.along === "sweep" && record.sweep) {
      // The claimed line is the swept path itself, in the object's local metres.
      const path = worldSweepLevel(record.sweep.lods).path;
      const pts = [];
      for (let i = 0; i < path.length; i += 2) pts.push(worldLocalToPage(record.anchor, path[i] / 1000, path[i + 1] / 1000));
      for (let i = 0; i < pts.length - 1; i += 1) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const seg = { ax, az, bx, bz, reach: claim.reach_m, kind: claim.kind };
        const x0 = Math.floor((Math.min(ax, bx) - claim.reach_m) / WORLD_CLAIM_CELL_M);
        const x1 = Math.floor((Math.max(ax, bx) + claim.reach_m) / WORLD_CLAIM_CELL_M);
        const z0 = Math.floor((Math.min(az, bz) - claim.reach_m) / WORLD_CLAIM_CELL_M);
        const z1 = Math.floor((Math.max(az, bz) + claim.reach_m) / WORLD_CLAIM_CELL_M);
        for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) {
          const key = `${cx}:${cz}`;
          if (!lines.has(key)) lines.set(key, []);
          lines.get(key).push(seg);
        }
      }
    } else if (claim.point) {
      const [x, y] = xy(claim.point[0], claim.point[1]);
      points.push({ x, z: -y, reach: claim.reach_m, kind: claim.kind });
    }
  }
  return (WORLD_CLAIMS = { lines, points });
}
function kerbClaimedAt(x, z, dx, dz) {
  const segs = worldClaims().lines.get(`${Math.floor(x / WORLD_CLAIM_CELL_M)}:${Math.floor(z / WORLD_CLAIM_CELL_M)}`);
  if (!segs) return false;
  for (const s of segs) {
    const sx = s.bx - s.ax, sz = s.bz - s.az, len2 = sx * sx + sz * sz;
    if (!(len2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * sx + (z - s.az) * sz) / len2));
    const ex = s.ax + t * sx - x, ez = s.az + t * sz - z;
    if (ex * ex + ez * ez > s.reach * s.reach) continue;
    const len = Math.sqrt(len2);
    if (Math.abs((sx * dx + sz * dz) / len) >= WORLD_CLAIM_ALIGN_COS) return true;
  }
  return false;
}
//: A kerb line with the stretches a reconstructed kerb has claimed taken out of it. With no
//: reconstructed objects on the page it is the line it was given, untouched.
function unclaimedKerbRuns(points) {
  if (!worldClaims().lines.size || points.length < 2) return [points];
  const dense = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = xy(points[i - 1][0], points[i - 1][1]), [bx, by] = xy(points[i][0], points[i][1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.0));
    for (let s = 1; s <= steps; s += 1) dense.push(lerpLonLat(points[i - 1], points[i], s / steps));
  }
  const page = dense.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  const claimed = page.map(([x, z], i) => {
    const j = Math.min(i, page.length - 2);
    const dx = page[j + 1][0] - page[j][0], dz = page[j + 1][1] - page[j][1];
    const len = Math.hypot(dx, dz) || 1;
    return kerbClaimedAt(x, z, dx / len, dz / len);
  });
  const runs = [];
  let run = [];
  for (let i = 0; i < dense.length; i += 1) {
    if (claimed[i]) { if (run.length >= 2) runs.push(run); run = []; continue; }
    run.push(dense[i]);
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}
function furnitureClaimedAt(x, z, kind) {
  for (const p of worldClaims().points) {
    if (p.kind === kind && Math.hypot(p.x - x, p.z - z) <= p.reach) return true;
  }
  return false;
}

// A procedural sky, generated once into an environment map. Without one, a metallic material
// reflects nothing and renders black -- which is why "make it look like glass" is really "give
// it something to be a mirror of".
//: Where the sun stands. One place, so that the disc painted in the sky and the light that
//: casts the shadows are the same sun -- a scene where they disagree reads as wrong long before
//: anybody can say why.
const SUN_AZIMUTH_DEG = 305;
const SUN_ELEVATION_DEG = 52;

function sunDirection() {
  const az = (SUN_AZIMUTH_DEG * Math.PI) / 180;
  const el = (SUN_ELEVATION_DEG * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

function skyTexture() {
  // An equirectangular sky: blue overhead falling to a pale band at the horizon, the sun where
  // the light says it is, and cirrus drawn in bands that thin out towards the top.
  //
  // This was a 128 pixel vertical gradient from near-black to grey, used only as an environment
  // map, with a flat colour behind it for the background. It reflected as sludge and the sky
  // read as an overcast ceiling at any hour.
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // The dome. Rayleigh scattering makes the zenith deep and the horizon pale and warm, and the
  // gradient below is that, flattened into a vertical ramp.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.00, "#1d4e86");
  sky.addColorStop(0.22, "#2f6ba4");
  sky.addColorStop(0.40, "#5b93c2");
  sky.addColorStop(0.49, "#a8c8dc");
  sky.addColorStop(0.52, "#c8d8e0");
  // Below the horizon is haze over water and hills rather than more sky.
  sky.addColorStop(0.60, "#8fa4ac");
  sky.addColorStop(1.00, "#5d6d72");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const sunU = ((SUN_AZIMUTH_DEG / 360) + 0.5) % 1;
  const sunX = sunU * w;
  const sunY = (0.5 - SUN_ELEVATION_DEG / 180) * h;

  // The glow first, wide and faint, then the disc. A sun with no glow is a hole punched in the
  // sky; the glow is most of what makes it read as light rather than as a decal.
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.30);
  glow.addColorStop(0.00, "rgba(255,247,224,0.95)");
  glow.addColorStop(0.04, "rgba(255,240,206,0.55)");
  glow.addColorStop(0.14, "rgba(255,236,200,0.18)");
  glow.addColorStop(0.40, "rgba(255,240,214,0.05)");
  glow.addColorStop(1.00, "rgba(255,240,214,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Cirrus. Drawn as long soft streaks stretched along the horizon's direction and thinned with
  // height, because that is how a high cloud deck looks from underneath: dense near the horizon
  // where you see through more of it, sparse overhead where you see through less.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let band = 0; band < 130; band += 1) {
    // Bias towards the upper half: below 0.5 is sky, and the very top thins out again.
    const t = Math.pow(random(band * 5.1), 0.7);
    const y = t * h * 0.46;
    const thin = 1 - Math.abs(y / (h * 0.46) - 0.55) * 1.1;
    if (thin <= 0.05) continue;
    const x = random(band * 7.3) * w;
    const long = (180 + random(band * 11.7) * 620) * (0.5 + thin);
    const tall = 5 + random(band * 3.3) * 22;
    const strength = 0.05 + random(band * 13.9) * 0.16 * thin;
    const streak = ctx.createRadialGradient(x, y, 0, x, y, long / 2);
    streak.addColorStop(0.0, `rgba(255,255,255,${strength.toFixed(3)})`);
    streak.addColorStop(0.55, `rgba(255,255,255,${(strength * 0.4).toFixed(3)})`);
    streak.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, Math.max(0.04, tall / long));
    ctx.translate(-x, -y);
    ctx.fillStyle = streak;
    ctx.beginPath();
    ctx.arc(x, y, long / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Wisps: a few finer strands trailing off each band, which is what makes cirrus cirrus
    // rather than a smudge.
    for (let wisp = 0; wisp < 3; wisp += 1) {
      const wy = y + (random(band * 17 + wisp) - 0.5) * tall * 2.2;
      const wl = long * (0.3 + random(band * 19 + wisp) * 0.5);
      const wx = x + (random(band * 23 + wisp) - 0.5) * long * 0.5;
      ctx.strokeStyle = `rgba(255,255,255,${(strength * 0.5).toFixed(3)})`;
      ctx.lineWidth = 1 + random(band * 29 + wisp) * 2.5;
      ctx.beginPath();
      ctx.moveTo(wx - wl / 2, wy);
      ctx.bezierCurveTo(wx - wl / 6, wy - tall * 0.4, wx + wl / 6, wy + tall * 0.4,
                        wx + wl / 2, wy);
      ctx.stroke();
    }
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function skyEnvironment(renderer, texture) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  return environment;
}

const SKY = ATTACH ? null : skyTexture();
scene.environment = ATTACH ? null : skyEnvironment(renderer, SKY);
scene.background = SKY;
// Turned down with the tone mapper in place: the old pair were set to be bright enough to read
// through the clipping, and left as they were they simply saturate a wider part of the scene.
// The sky's fill is daylight, not cyan: a wall out of the sun is lit by it alone, and a cyan
// fill turned every shaded front green -- 1535 Francisco's beige came out grey-green and
// 1553's pale cream teal.
const amb = new THREE.HemisphereLight(0xe4ecf4, 0x071013, 1.15);
scene.add(amb);
const sun = new THREE.DirectionalLight(0xfff4e2, 2.0);
sun.position.copy(sunDirection()).multiplyScalar(900);
scene.add(sun);
let environmentController=null;
// ---- night: what the dark looks like when it is playable --------------------------------------
//
// The game's night is 24 real minutes (docs/city/clock.mjs) and is meant to be played: cool blue,
// not black (environment-runtime.mjs sets the moon, the ambient and the fog). Two things here are
// shared with the materials that need them, set by the environment each second: the houses'
// windows, a share of them lit warm through the evening and fewer after midnight; and a faint rim
// of light round people -- the walker, the others, the city's crowd -- so a figure never goes
// into the background.
// (One for the page and every region attached to it: an attached region runs this same code again
// in this page -- module 00 ATTACH -- and its windows must light with the page's night, which only
// the page's own sky sets.)
const NIGHT = globalThis.__kerbsideNight ||= {
  night: { value: 0 },                                  // 0 by day, 1 at full night
  lit: { value: 0.5 },                                  // the share of windows lit, by the hour
  warm: { value: new THREE.Color(1.0, 0.46, 0.16) },    // tungsten through a curtain (deep: the tone mapper pales it)
  rim: { value: 0 },                                    // the rim's strength
  rimColour: { value: new THREE.Color(0.55, 0.68, 1.0) },
};
//: Chains a patch onto ``material``'s shader once (by ``key``). Kept in a WeakMap, not on the
//: material: a clone copies userData but not the shader hook, and must be patched again.
const PATCHED = globalThis.__kerbsidePatched ||= new WeakMap();
const isPatched = (material, key) => Boolean(PATCHED.get(material)?.has(key));
function patchMaterial(material, key, patch) {
  if (!material || isPatched(material, key)) return material;
  if (!PATCHED.has(material)) PATCHED.set(material, new Set());
  PATCHED.get(material).add(key);
  material.userData = material.userData || {};
  material.userData[key] = true;
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) { if (prev) prev.call(this, shader, renderer); patch(shader); };
  material.customProgramCacheKey = function () { return `${prevKey ? prevKey.call(this) : ""}|${key}`; };
  material.needsUpdate = true;
  return material;
}
//: Windows that light at night: a share of them (by a hash of where each is) glow warm through
//: the glass -- the dark panes, not the frame -- and turn nearly opaque. A window is lit or dark
//: whole: the hash is of its middle, found from its picture's own coordinates (each window, or
//: each repeat of a window picture, is one unit square of them), not of the point being drawn.
//: Hashed by the point, a window across the edge of a hash cell was lit on one side and dark on
//: the other -- "part of it blocked" (2026-11-22).
function nightWindows(material) {
  return patchMaterial(material, "kbNightWindows", (sh) => {
    sh.uniforms.kbNight = NIGHT.night; sh.uniforms.kbLit = NIGHT.lit; sh.uniforms.kbWarm = NIGHT.warm;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 kbWP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvec4 kbP = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nkbP = instanceMatrix * kbP;\n#endif\nkbWP = (modelMatrix * kbP).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 kbWP;\nuniform float kbNight; uniform float kbLit; uniform vec3 kbWarm;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
{ vec3 kbMidW = kbWP;
#ifdef USE_MAP
  { vec2 kbU = vMapUv, kbDx = dFdx(kbU), kbDy = dFdy(kbU);
    vec3 kbPx = dFdx(kbWP), kbPy = dFdy(kbWP);
    float kbDet = kbDx.x * kbDy.y - kbDx.y * kbDy.x;
    if (abs(kbDet) > 1e-14) {
      // The face's change in the world per unit of u and of v, and from there the window's middle.
      vec3 kbPu = (kbPx * kbDy.y - kbPy * kbDx.y) / kbDet, kbPv = (kbPy * kbDx.x - kbPx * kbDy.x) / kbDet;
      vec2 kbMid = floor(kbU) + 0.5;
      kbMidW = kbWP + kbPu * (kbMid.x - kbU.x) + kbPv * (kbMid.y - kbU.y);
    } }
#endif
  vec3 kbCell = floor(kbMidW / vec3(1.1, 1.4, 1.1));
  float kbH = fract(sin(dot(kbCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float kbOn = kbNight * step(kbH, kbLit);
  float kbGlass = 1.0 - smoothstep(0.32, 0.6, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
  totalEmissiveRadiance += kbWarm * kbOn * kbGlass * (0.38 + 0.42 * fract(kbH * 13.0));
  diffuseColor.a = mix(diffuseColor.a, 0.94, kbOn * kbGlass); }`);
  });
}
//: An advertising face lit from behind (a shelter's or a kiosk's light box) or by its floodlights
//: (a billboard's): at night its own picture glows, ``strength`` of it, as a lit poster does.
function nightLitFace(material, strength = 0.6) {
  return patchMaterial(material, "kbNightLitFace", (sh) => {
    sh.uniforms.kbNight = NIGHT.night; sh.uniforms.kbFace = { value: strength };
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float kbNight; uniform float kbFace;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * kbNight * kbFace;");
  });
}
//: A lamp's lens or globe: its glow at night is ``strength`` times its own emissive colour, on top
//: of the little it shows by day -- a street lamp is on after dark, not the same grey glint all day.
function nightLamp(material, strength = 3.0) {
  return patchMaterial(material, "kbNightLamp", (sh) => {
    sh.uniforms.kbNight = NIGHT.night; sh.uniforms.kbLampGlow = { value: strength };
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float kbNight; uniform float kbLampGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += emissive * kbNight * kbLampGlow;");
  });
}
//: The glow round each lamp at night, seen from down the street: a soft disc ``size`` metres
//: across at every point of ``positions`` ([x, y, z, ...]), added to what is behind it, gone by day.
function nightLampGlow(positions, size = 2.6, colour = 0xffd9a0) {
  if (!positions.length) return null;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d"), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(canvas), color: colour, size, sizeAttenuation: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  patchMaterial(material, "kbNightLampGlow", (sh) => {
    sh.uniforms.kbNight = NIGHT.night;
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float kbNight;")
      .replace("#include <opaque_fragment>", "diffuseColor.a *= kbNight;\n#include <opaque_fragment>");
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
//: A figure's rim at night: light along its edges as the camera sees them (a fresnel term), so a
//: person stands out against a dark street.
function nightRim(material) {
  return patchMaterial(material, "kbNightRim", (sh) => {
    sh.uniforms.kbRim = NIGHT.rim; sh.uniforms.kbRimColour = NIGHT.rimColour;
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float kbRim; uniform vec3 kbRimColour;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
{ float kbF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += kbRimColour * kbRim * pow(kbF, 2.4); }`);
  });
}
//: Every material on ``object`` given the rim (the walker's model and the other players' as they load).
function nightRimAll(object) {
  object?.traverse?.((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && !isPatched(m, "kbNightRim") && "emissive" in m) nightRim(m); });
}
// ---- glass ---------------------------------------------------------------------------------------
//: Glass as it is seen in the street, at the cost of one pane: nearly clear looking straight
//: through it and a mirror at a slant (Fresnel: Schlick's power, raised a little so the slant
//: comes on late), the sun's glint sharp on it (smooth, and its highlight several times a plain
//: surface's), and the sky and the street in it from one picture of them made once (a cube map:
//: glassCube) -- never the scene drawn a second time, as three.js's transmission and real-time
//: reflections do. The picture is dimmed by night. A pane is never quite flat (float glass waves
//: over a metre or so: the reflection ripples), its edges hold the grime a cloth misses, and it
//: casts no shadow and bends no light.
const GLASS = Object.freeze({
  face_opacity: 0.05,      // looking straight through
  edge_opacity: 0.65,      // at a grazing slant
  fresnel_power: 4.5,      // Schlick's 5, a little softer
  face_reflection: 0.12,   // what the pane mirrors looking straight at it: glass's own 0.04, more for
                           // the room behind a pane being unlit here (a real one is lit, and dimmer than the street)
  roughness: 0.05,
  specular: 4.0,           // the sun's highlight, as a multiple of a plain dielectric's (F0 0.04 -> ~0.16)
  reflection: 0.9,         // the cube map's share at full slant, by day
  night_reflection: 0.12,  // ... and by night
  ripple: 0.012,           // how far the pane's normal wanders (radians, about)
  ripple_m: 1.1,           // over how far
  grime: 0.28,             // the grime's opacity at the very edge of a pane
  grime_edge: 0.08,        // how far in from the edge it goes (share of the pane)
});
//: The pane's opacity seen at ``cosView`` (the cosine between the view and the pane's normal).
function glassOpacity(cosView, face = GLASS.face_opacity, edge = GLASS.edge_opacity) {
  const f = Math.pow(1 - Math.min(1, Math.abs(cosView)), GLASS.fresnel_power);
  return face + (edge - face) * f;
}
//: How much grime a point ``edge`` (its nearest distance to the pane's edge, as a share of the pane)
//: carries: all of GLASS.grime at the edge, none past GLASS.grime_edge.
function glassGrime(edge) {
  const t = Math.min(1, Math.max(0, edge / GLASS.grime_edge));
  return GLASS.grime * (1 - t * t * (3 - 2 * t));
}
//: The sky and the street as a pane sees them, drawn once: a blue sky paling to a hazy horizon, a
//: band of building fronts with rows of windows, and the dark street. 64 pixels a face.
let glassCubeMap = null;
function glassCube() {
  if (glassCubeMap) return glassCubeMap;
  const S = 64, faces = [];
  // Faces in three's order: +x, -x, +y (up), -y (down), +z, -z.
  for (let f = 0; f < 6; f += 1) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = S;
    const ctx = canvas.getContext("2d");
    if (f === 2) { ctx.fillStyle = "#5f8fc8"; ctx.fillRect(0, 0, S, S); }
    else if (f === 3) { ctx.fillStyle = "#2a2b2d"; ctx.fillRect(0, 0, S, S); }
    else {
      const sky = ctx.createLinearGradient(0, 0, 0, S / 2);
      sky.addColorStop(0, "#5f8fc8"); sky.addColorStop(1, "#c9d6e2");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, S, S / 2);
      ctx.fillStyle = "#2a2b2d"; ctx.fillRect(0, S / 2, S, S / 2);
      // The fronts across the street: blocks of a few storeys, their windows darker.
      for (let x = 0; x < S;) {
        const w = 6 + Math.floor(random(f * 97 + x * 7 + 1) * 12), h = 6 + Math.floor(random(f * 97 + x * 7 + 2) * 16);
        const tone = 120 + Math.floor(random(f * 97 + x * 7 + 3) * 90);
        ctx.fillStyle = `rgb(${tone},${tone - 6},${tone - 14})`; ctx.fillRect(x, S / 2 - h, w, h + 3);
        ctx.fillStyle = "rgba(40,48,58,0.75)";
        for (let y = S / 2 - h + 2; y < S / 2 - 1; y += 4) for (let wx = x + 1; wx < x + w - 1; wx += 3) ctx.fillRect(wx, y, 1.5, 2);
        x += w;
      }
    }
    faces.push(canvas);
  }
  glassCubeMap = new THREE.CubeTexture(faces);
  glassCubeMap.colorSpace = THREE.SRGBColorSpace;
  glassCubeMap.needsUpdate = true;
  return glassCubeMap;
}
//: Makes ``material`` (a MeshStandardMaterial) glass. ``paneUv``: its geometry's uv runs 0 to 1
//: across each pane (a PlaneGeometry's does), so the grime can find the pane's edge. ``face``: the
//: opacity looking straight through (GLASS.face_opacity). A lit window at night (nightWindows)
//: stays as opaque as that patch makes it.
function realGlass(material, { paneUv = false, face = GLASS.face_opacity } = {}) {
  if (!material || !material.isMeshStandardMaterial) return material;
  material.transparent = true; material.depthWrite = false; material.opacity = face;
  material.roughness = GLASS.roughness; material.metalness = 0; material.envMapIntensity = 0;   // its reflection is the cube map's
  material.userData.realGlass = true;
  const key = paneUv ? "kbGlassPane" : "kbGlass";
  return patchMaterial(material, key, (sh) => {
    sh.uniforms.kbNight = NIGHT.night; sh.uniforms.kbGlassCube = { value: glassCube() };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 kbGW; varying vec2 kbGUv;")
      .replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 kbP = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nkbP = instanceMatrix * kbP;\n#endif\nkbGW = (modelMatrix * kbP).xyz; kbGUv = uv; }");
    const f = (v) => Number(v).toFixed(6);
    // (A lit window's patch, nightWindows, declares kbNight too: once only, or the pane is not drawn.)
    const night = /uniform\s+float\s+kbNight\s*;/.test(sh.fragmentShader) ? "" : "uniform float kbNight; ";
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 kbGW; varying vec2 kbGUv;\n${night}uniform samplerCube kbGlassCube;`)
      .replace("#include <opaque_fragment>", `{
  vec3 kbV = normalize(vViewPosition);
  // The pane's slow waves: a little of the normal turned, over about a metre.
  vec3 kbQ = kbGW / ${f(GLASS.ripple_m)};
  vec3 kbW = vec3(sin(kbQ.x * 1.7 + kbQ.y * 0.9) + sin(kbQ.z * 1.3 - kbQ.y * 1.1), sin(kbQ.y * 1.5 + kbQ.z * 0.7) + sin(kbQ.x * 0.8 - kbQ.z * 1.9), sin(kbQ.z * 1.1 + kbQ.x * 0.6));
  vec3 kbN = normalize(normal + mat3(viewMatrix) * kbW * ${f(GLASS.ripple)});
  float kbF = pow(1.0 - clamp(abs(dot(kbN, kbV)), 0.0, 1.0), ${f(GLASS.fresnel_power)});
  vec3 kbRw = inverseTransformDirection(reflect(-kbV, kbN), viewMatrix);
  float kbDay = mix(${f(GLASS.reflection)}, ${f(GLASS.night_reflection)}, kbNight);
  // Mirrored by Schlick's curve from its face-on share: a window looked straight at still shows the sky.
  float kbFr = ${f(GLASS.face_reflection)} + (1.0 - ${f(GLASS.face_reflection)}) * kbF;
  vec3 kbEnv = textureCube(kbGlassCube, vec3(-kbRw.x, kbRw.yz)).rgb * kbFr * kbDay;
  vec3 kbSpec = reflectedLight.directSpecular * ${f(GLASS.specular)};
  vec3 kbBody = outgoingLight - reflectedLight.directSpecular - reflectedLight.indirectSpecular;
  vec3 kbR = kbEnv + kbSpec;
  float kbA = mix(diffuseColor.a, max(diffuseColor.a, ${f(GLASS.edge_opacity)}), kbF);
  ${paneUv ? `// Grime where a cloth misses: the pane's edges, patchy.
  float kbE = min(min(kbGUv.x, 1.0 - kbGUv.x), min(kbGUv.y, 1.0 - kbGUv.y));
  float kbT = clamp(kbE / ${f(GLASS.grime_edge)}, 0.0, 1.0);
  float kbPatch = 0.6 + 0.4 * fract(sin(dot(floor(kbGW * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float kbG = ${f(GLASS.grime)} * (1.0 - kbT * kbT * (3.0 - 2.0 * kbT)) * kbPatch;
  vec3 kbIrr = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb, vec3(0.02));
  kbBody = mix(kbBody, kbIrr * vec3(0.30, 0.28, 0.25), kbG / max(kbA + kbG * (1.0 - kbA), 1e-3));
  kbA = kbA + kbG * (1.0 - kbA);` : ""}
  float kbOut = clamp(kbA + dot(kbR, vec3(0.299, 0.587, 0.114)) * (1.0 - kbA), 0.0, 1.0);
  outgoingLight = (kbBody * kbA + kbR) / max(kbOut, 1e-3);
  diffuseColor.a = kbOut;
}
#include <opaque_fragment>`);
  });
}
globalThis.__kerbsideRealGlass = realGlass;
// ---- the sun's shadows and the light off the street: a low-detail stand-in for the world -------
//
// Nothing here casts a shadow the usual way (a shadow map draws every building, tree and kerb
// again from the sun, every frame). Instead the world near you is kept as a stand-in a metre or
// so coarse -- how high the top of it is at each point, and what colour (docs/proxy-light.mjs
// draws it from above, now and then) -- and the sun is traced through that, once each time it
// has moved: where its light is cut off, how much of the sky a street can see, and how much
// sunlight the ground and the fronts across the way throw back. Every lit material then looks
// those three things up in two small pictures: a pair of texture reads a pixel.
// (After Unreal's Lumen, cut down: it traces a simplified copy of the scene and keeps the light
// on a low-detail cache of its surfaces; this keeps one height and one colour a point.)
// One for the page and every region attached to it, as the night is.
const PROXY_LIGHT = globalThis.__kerbsideProxyLight ||= {
  map: { value: null },                                   // r: shadow's top, g: sky seen, b: the surface's height, a: the edge's softness
  bounce: { value: null },                                // the share of sunlight thrown back, by colour
  box: { value: new THREE.Vector4(0, 0, 0, 0) },          // centre x, centre z, 1 / extent, the height the map counts from
  k: { value: new THREE.Vector4(0, 0, 1, 0) },            // shadow strength, the map's texel (m), sky strength, whether the map is there at all
  lampMap: { value: null },                               // the street lamps' pools of light, from above
  lamp: { value: new THREE.Vector4(0, 0, 0, 0) },         // the lamps' colour, and (w) how much dappled light comes through a tree
  lamps: [],                                              // every lamp head, [x, y, z, ...]: module 21 puts them here
  captureHooks: new Set(),                                // {before(), after()}: what moves shows only what stands still (view.mjs)
  sun: { value: new THREE.Vector3(0, 0, 0) },             // the sun's light, as bounced
  dynamic: new Set(),                                     // what moves: left out of the stand-in
  missed: 0,
};
// Fine shadows near you (docs/fine-shadows.mjs): the square about you as the sun sees it, what
// stands still and what moves, and the matrix that takes a point of the world into them.
PROXY_LIGHT.fineMap ||= { value: null };
PROXY_LIGHT.fineMoving ||= { value: null };
PROXY_LIGHT.fineMat ||= { value: new THREE.Matrix4() };
PROXY_LIGHT.fineK ||= { value: new THREE.Vector4(0, 1 / 2048, 0.07, 0.0001) };   // strength, a texel, the look-up's step off the surface (m), the depth it is brought forward
PROXY_LIGHT.fineDir ||= { value: new THREE.Vector3(0, 1, 0) };                    // towards the sun
// How each material meets the sun (docs/reflectance.mjs): x its roughness (under 0: the drawn
// material's own), y the share it mirrors head on. One uniform to a material, so the catalogue's
// figures arrive without a program being compiled again.
PROXY_LIGHT.optics ||= new WeakMap();
PROXY_LIGHT.opticsPlain ||= { value: new THREE.Vector2(-1, 0.04) };
PROXY_LIGHT.opticsOf ||= function opticsOf(material) {
  if (!material) return PROXY_LIGHT.opticsPlain;
  let u = PROXY_LIGHT.optics.get(material);
  if (!u) PROXY_LIGHT.optics.set(material, u = { value: new THREE.Vector2(-1, 0.04) });
  return u;
};
//: The lookup, put into a lit material's shader (``shader`` as onBeforeCompile is given it). A
//: material with no lighting of its own (a sign, a lamp, the sky) is left as it is.
PROXY_LIGHT.patch ||= function proxyLightPatch(shader, material) {
  const P = globalThis.__kerbsideProxyLight;
  if (!shader || shader.uniforms.kbPLMap || !shader.fragmentShader.includes("#include <lights_fragment_begin>") || !shader.vertexShader.includes("#include <project_vertex>")) return;
  const begin = THREE.ShaderChunk.lights_fragment_begin, call = "getDirectionalLightInfo( directionalLight, directLight );";
  if (!begin.includes(call)) { if (!P.missed++) console.warn("kerbside: this three.js lights differently; no shadows"); return; }
  shader.uniforms.kbPLMap = P.map; shader.uniforms.kbPLBounce = P.bounce; shader.uniforms.kbPLBox = P.box; shader.uniforms.kbPLK = P.k; shader.uniforms.kbPLSun = P.sun; shader.uniforms.kbPLLampMap = P.lampMap; shader.uniforms.kbPLLamp = P.lamp;
  shader.uniforms.kbFSMap = P.fineMap; shader.uniforms.kbFSMoving = P.fineMoving; shader.uniforms.kbFSMat = P.fineMat; shader.uniforms.kbFSK = P.fineK; shader.uniforms.kbFSDir = P.fineDir; shader.uniforms.kbSOpt = P.opticsOf(material);
  shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 kbPLw;")
    .replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 kbPLp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nkbPLp = instanceMatrix * kbPLp;\n#endif\nkbPLw = (modelMatrix * kbPLp).xyz; }");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec3 kbPLw;\nuniform sampler2D kbPLMap; uniform sampler2D kbPLBounce; uniform vec4 kbPLBox; uniform vec4 kbPLK; uniform vec3 kbPLSun; uniform sampler2D kbPLLampMap; uniform vec4 kbPLLamp;\nuniform sampler2D kbFSMap; uniform sampler2D kbFSMoving; uniform mat4 kbFSMat; uniform vec4 kbFSK; uniform vec3 kbFSDir; uniform vec2 kbSOpt;\nfloat kbFSLit(vec2 kbFSuv, float kbFSz) { return step(kbFSz, min(texture2D(kbFSMap, kbFSuv).r, texture2D(kbFSMoving, kbFSuv).r)); }")
    .replace("#include <lights_fragment_begin>", `float kbLit = 1.0, kbSky = 1.0; vec3 kbBnc = vec3(0.0);
if (kbPLK.w > 0.0) {
  vec3 kbN = inverseTransformDirection(normal, viewMatrix);
  // Looked up a texel and a half out from the surface: a wall reads the street it faces, not the roof behind it.
  vec2 kbAt = kbPLw.xz + kbN.xz * kbPLK.y * 1.6 - kbPLBox.xy;
  vec2 kbUv = vec2(kbAt.x, -kbAt.y) * kbPLBox.z + 0.5;
  vec2 kbIn = min(kbUv, 1.0 - kbUv);
  // The shadows fade out over the square's last eighth (from about 400 m on foot), not at a line.
  float kbEdge = smoothstep(0.0, 1.0, clamp(min(kbIn.x, kbIn.y) * 8.0, 0.0, 1.0));
  if (kbEdge > 0.0) {
    vec4 kbL = texture2D(kbPLMap, kbUv);
    float kbY = kbPLw.y - kbPLBox.w;
    kbLit = mix(1.0, smoothstep(-kbL.a, kbL.a, kbY - kbL.r + 0.3), kbEdge * kbPLK.x);
    float kbOpen = clamp((kbY - kbL.b) / 22.0, 0.0, 1.0);
    kbSky = mix(1.0, mix(kbL.g, 1.0, kbOpen), kbEdge * kbPLK.z);
    // Near you the shadow is the fine one: is anything between this point and the sun, as the
    // sun sees it? Four texels about the point, weighed by where it lies among them.
    if (kbFSK.x > 0.0) {
      vec4 kbFp = kbFSMat * vec4(kbPLw + kbN * (kbFSK.z * (1.0 - 0.7 * clamp(dot(kbN, kbFSDir), 0.0, 1.0))), 1.0);
      vec2 kbFi = min(kbFp.xy, 1.0 - kbFp.xy);
      float kbFe = smoothstep(0.0, 1.0, clamp(min(kbFi.x, kbFi.y) * 8.0, 0.0, 1.0)) * kbFSK.x * step(kbFp.z, 1.0) * step(0.0, kbFp.z);
      if (kbFe > 0.0) {
        float kbFz = kbFp.z - kbFSK.w;
        vec2 kbFt = kbFp.xy / kbFSK.y - 0.5, kbFf = fract(kbFt), kbFb = (floor(kbFt) + 0.5) * kbFSK.y;
        float kbFl = mix(mix(kbFSLit(kbFb, kbFz), kbFSLit(kbFb + vec2(kbFSK.y, 0.0), kbFz), kbFf.x), mix(kbFSLit(kbFb + vec2(0.0, kbFSK.y), kbFz), kbFSLit(kbFb + vec2(kbFSK.y), kbFz), kbFf.x), kbFf.y);
        kbLit = mix(kbLit, mix(1.0, kbFl, min(1.0, kbPLK.x)), kbFe);
      }
    }
    vec4 kbB = texture2D(kbPLBounce, kbUv);
    kbBnc = kbB.rgb * kbPLSun * (kbEdge * (1.0 - kbOpen) * mix(1.0, 0.35, clamp(kbN.y, 0.0, 1.0)));
    // Under a tree the shadow is not whole: light comes through the leaves in patches.
    float kbLeaf = sin(kbPLw.x * 2.1 + sin(kbPLw.z * 1.3) * 1.7) * sin(kbPLw.z * 2.3 + sin(kbPLw.x * 1.7) * 1.7) * 0.5 + 0.5;
    kbLit = mix(kbLit, max(kbLit, smoothstep(0.38, 0.72, kbLeaf)), kbB.a * kbPLLamp.w * kbEdge);
    // The street lamps: a pool under each, on the street and the foot of the fronts, at night.
    kbBnc += kbPLLamp.rgb * (texture2D(kbPLLampMap, kbUv).r * kbEdge * (1.0 - smoothstep(4.0, 10.0, kbY - kbL.b)));
  }
}
${begin.replace(call, `${call}\n directLight.color *= kbLit;`)}
#if defined( RE_IndirectDiffuse )
irradiance = irradiance * kbSky + kbBnc;
#endif`)
    // The sun's glint off a surface that is lit plainly (PLAIN_LIGHT: a matt wall, a road) or is
    // gloss paint on a simple material (a car: KB_GLOSS, its roughness). One microfacet lobe for
    // the one sun, at the surface's own roughness, with the 4% a non-metal mirrors head on and
    // Fresnel's rise to all of it at a glancing angle: tarmac glares towards a low sun and a wall
    // seen square on does not. In shadow there is none.
    .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
#if ( defined( KB_PLAIN ) || defined( KB_GLOSS ) ) && NUM_DIR_LIGHTS > 0
{
  #ifdef KB_GLOSS
  float kbSR = KB_GLOSS, kbSF0 = 0.05;
  #else
  float kbSR = clamp(kbSOpt.x > 0.0 ? kbSOpt.x : roughnessFactor, 0.08, 1.0), kbSF0 = kbSOpt.y;
  #endif
  vec3 kbSV = normalize(vViewPosition), kbSL = directionalLights[0].direction, kbSH = normalize(kbSL + kbSV);
  float kbSNL = max(dot(normal, kbSL), 0.0), kbSNV = max(dot(normal, kbSV), 0.001), kbSNH = max(dot(normal, kbSH), 0.0), kbSVH = max(dot(kbSV, kbSH), 0.0);
  float kbSA = kbSR * kbSR, kbSA2 = kbSA * kbSA, kbSDn = kbSNH * kbSNH * (kbSA2 - 1.0) + 1.0;
  float kbSD = kbSA2 / (3.14159265 * kbSDn * kbSDn);
  float kbSFr = kbSF0 + (1.0 - kbSF0) * pow(1.0 - kbSVH, 5.0);
  float kbSK = kbSA * 0.5, kbSVis = 0.25 / ((kbSNL * (1.0 - kbSK) + kbSK) * (kbSNV * (1.0 - kbSK) + kbSK));
  vec3 kbSpec = directionalLights[0].color * (kbLit * kbSNL * min(kbSD * kbSFr * kbSVis, 8.0));
  #ifdef KB_PLAIN
  // A rough surface is not evenly matt: its grain throws light back towards where it came from,
  // so asphalt and stucco are brighter seen from the sun's side and duller against it, and do
  // not darken to nothing at a glancing sun (Oren and Nayar's rough diffuse, in Fujii's form).
  // By the surface's own roughness: paint and glass stay evenly matt.
  {
    float kbOS = clamp((kbSR - 0.5) * 2.0, 0.0, 1.0);
    float kbOs = dot(kbSL, kbSV) - kbSNL * kbSNV, kbOt = kbOs > 0.0 ? max(kbSNL, kbSNV) : 1.0;
    float kbOA = 1.0 / (1.0 + 0.2878 * kbOS);
    reflectedLight.directDiffuse *= mix(1.0, kbOA + kbOS * kbOA * kbOs / max(kbOt, 0.05), step(0.02, dot(directionalLights[0].color, vec3(0.333))));
  }
  reflectedLight.directSpecular += kbSpec;
  #else
  reflectedLight.directDiffuse += kbSpec;
  #endif
  // Gloss paint mirrors the sky as well as the sun: little seen square on, most of it along a
  // bonnet or a roof at a glancing angle, the open sky above and the dark street below. (Paint
  // on the full material has the sky from its own reflection.)
  #if defined( KB_GLOSS ) && !defined( STANDARD ) && NUM_HEMI_LIGHTS > 0
  {
    vec3 kbSRw = inverseTransformDirection(reflect(-kbSV, normal), viewMatrix);
    float kbSFv = kbSF0 + (1.0 - kbSF0) * pow(1.0 - kbSNV, 5.0);
    reflectedLight.directDiffuse += hemisphereLights[0].skyColor * (mix(0.15, 1.0, smoothstep(-0.1, 0.3, kbSRw.y)) * kbSFv * kbSky);
  }
  #endif
}
#endif`)
    .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>
#if defined( RE_IndirectDiffuse ) && defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
iblIrradiance *= kbSky;
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
radiance *= mix(1.0, kbSky * (0.4 + 0.6 * kbLit), min(1.0, kbPLK.x) * kbPLK.w);
#endif`);
};
//: Photographed surfaces near you (docs/51-near-ring-people-and-surfaces.md). Four materials --
//: asphalt, concrete, wood and painted wood -- each have one photograph (docs/textures/near/,
//: ambientCG, CC0) and its relief. Every surface of that kind takes it, laid in metres of the
//: world rather than the surface's own UVs, so the same reference is at the same scale on every
//: road, kerb, deck and wall. Only near you: full within ``near.x`` of the camera, gone by
//: ``near.y``; past that the surface is drawn as it always was (its own canvas texture), and far
//: off the tiles are the core shapes they were. The photograph adds its detail to the colour the
//: surface already has (its light and dark about its own average), so a measured shade -- a
//: road's, a house's paint -- is kept and there is no ring where the colour changes.
//: A material says what it is by its map (``mark(texture, kind)``) or by ``userData.nearSurface``.
const NEAR_SURFACE = globalThis.__kerbsideNearSurface ||= {
  near: { value: new THREE.Vector3(32, 58, 1) },     // full within x, faded by y (m); z: on (1) or off (0)
  kinds: {
    // tile_m: the metres one photograph spans; mean: its average colour (linear-ish, from sRGB);
    // relief: how strongly its normal map bends the light.
    asphalt: { tile_m: 3.2, mean: [0.471, 0.471, 0.471], relief: 0.9 },
    concrete: { tile_m: 2.4, mean: [0.566, 0.532, 0.451], relief: 0.6 },
    // A public sidewalk as San Francisco pours it: the same photograph, and over it, in the
    // slabs' own UVs, what the finisher's tools leave -- a tooled joint round every square (three
    // feet along, rows across stretched to fit, counted from the property line: module 09 SLAB_M,
    // walkRowM), a groove in the same concrete that only its shadow darkens, and the broom's fine
    // striations across the walk.
    sidewalk: { tile_m: 2.4, mean: [0.566, 0.532, 0.451], relief: 0.6, photo: "concrete", scored: "walk", slabs: 4, slab_m: 0.9144 },
    // A narrow walk (module 09 NARROW_SIDEWALK, a footway or a walk under 1.8 m) is poured and
    // finished the same way; its map repeats once a 2.75 m slab, so the squares are read at that.
    "narrow-walk": { tile_m: 2.4, mean: [0.566, 0.532, 0.451], relief: 0.6, photo: "concrete", scored: "walk", slabs: 2.75 / 0.9144, slab_m: 0.9144 },
    // The curb (Standard Plan 87,185: six inches across the top, a rounded nose, the street face
    // battered one in four) is the lip the walk's last squares stop at: the walk's own concrete
    // and colour and the same broom finish ("lip": the walk's marks without its joints), one long
    // strip. A driveway's dropped walk ("apron", module 19) is the same plain pour.
    curb: { tile_m: 2.4, mean: [0.566, 0.532, 0.451], relief: 0.6, photo: "concrete", scored: "lip", slabs: 4, slab_m: 0.9144 },
    apron: { tile_m: 2.4, mean: [0.566, 0.532, 0.451], relief: 0.6, photo: "concrete", scored: "lip", slabs: 4, slab_m: 0.9144 },
    wood: { tile_m: 2.0, mean: [0.313, 0.243, 0.18], relief: 0.8 },
    "painted-wood": { tile_m: 2.6, mean: [0.7, 0.652, 0.588], relief: 0.9 },
  },
  byMap: new WeakMap(),
  uniforms: new Map(),
  missed: 0,
};
//: How far the photographs reach: out to all the ground the view sees. Looking down, that is
//: the furthest ground in view (from eye height under fifteen metres); with the horizon in view
//: (a ray flatter than ``flat_deg``), it is ``most_m``, the City's far plane, so the fade lies
//: past the haze and there is no edge to see. (It had been 32 m full and gone by 58 m whatever
//: the camera did; then all the ground but what was seen flatter than ten degrees, which from
//: the City's camera pulled out put the fade a couple of hundred metres off -- a circle round
//: you on the ground, seen from above, 2026-11-21.) The photographs are sampled on every lit
//: surface of their kinds whatever the ring (their mip levels), so a wider ring costs no more to
//: draw; the joints and the broom thin to what a pixel can show (scoredColor).
NEAR_SURFACE.reach ||= { full_min_m: 32, flat_deg: 2, fade: 1.3, fade_add_m: 12, most_m: 1600 };
//: The ring for a camera ``height`` m over the ground whose shallowest ray in view goes
//: ``depression`` radians below the horizon (negative: above it): [full within, gone by].
NEAR_SURFACE.reachFor ||= function (height, depression) {
  const r = NEAR_SURFACE.reach, flat = r.flat_deg * Math.PI / 180;
  const full = depression < flat ? r.most_m
    : Math.min(r.most_m, Math.max(r.full_min_m, Math.max(0.3, height) / Math.sin(depression) * 1.04));
  return [full, full * r.fade + r.fade_add_m];
};
//: Each frame: the ring set for ``camera`` over ground at ``groundY``. (Its own scratch vectors:
//: nothing made a frame.)
NEAR_SURFACE.follow ||= function (camera, groundY) {
  const t = NEAR_SURFACE.scratch ||= { v: new THREE.Vector3(), corners: [[-1, 1], [1, 1], [0, 1], [-1, -1], [1, -1]] };
  let low = Infinity;
  for (const [x, y] of t.corners) {
    t.v.set(x, y, 0.5).unproject(camera).sub(camera.position);
    const len = t.v.length();
    if (len > 0) low = Math.min(low, Math.asin(Math.max(-1, Math.min(1, -t.v.y / len))));
  }
  const [full, gone] = NEAR_SURFACE.reachFor(camera.position.y - (Number.isFinite(groundY) ? groundY : 0), low);
  NEAR_SURFACE.near.value.x = full; NEAR_SURFACE.near.value.y = gone;
  return full;
};
NEAR_SURFACE.mark ||= function (texture, kind) { if (texture && NEAR_SURFACE.kinds[kind]) NEAR_SURFACE.byMap.set(texture, kind); return texture; };
NEAR_SURFACE.kindOf ||= function (material) {
  if (!material || !material.isMeshStandardMaterial && !material.isMeshPhongMaterial && !material.isMeshLambertMaterial) return null;
  const own = material.userData?.nearSurface;
  if (own !== undefined) return NEAR_SURFACE.kinds[own] ? own : null;
  return (material.map && NEAR_SURFACE.byMap.get(material.map)) || null;
};
//: One set of uniforms a kind, its two pictures loaded the first time a material of it compiles.
NEAR_SURFACE.uniformsFor ||= function (kind) {
  let u = NEAR_SURFACE.uniforms.get(kind);
  if (u) return u;
  const k = NEAR_SURFACE.kinds[kind];
  u = { map: { value: null }, relief: { value: null }, tile: { value: new THREE.Vector4(1 / k.tile_m, k.relief, 0, 0) },
    mean: { value: new THREE.Vector3(...k.mean.map((c) => Math.pow(c, 2.2))) } };
  NEAR_SURFACE.uniforms.set(kind, u);
  const loader = new THREE.TextureLoader();
  const load = (file, srgb, slot, ready) => loader.load(sharedAsset(`textures/near/${k.photo || kind}-${file}.jpg`), (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    u[slot].value = t; if (ready) u.tile.value.z = 1;
  }, undefined, () => { if (!NEAR_SURFACE.missed++) console.warn("kerbside: a near-surface photograph did not load"); });
  load("color", true, "map", true);
  load("normal", false, "relief", false);
  return u;
};
//: The finisher's marks, for a scored kind, read from the slabs' own UVs (the sidewalk's map:
//: four squares of SLAB_M to a repeat, ``u`` along the street and ``v`` across it from the
//: property line). Distances are in metres from the nearest joint. "walk": every square tooled,
//: broomed inside a troweled margin, a deeper joint each third square.
//: Its marks bend the light (kbSwBx along u, kbSwBz across) for scoredNormal.
NEAR_SURFACE.scoredColor ||= function (mode, slabs = 4, slabM = 0.9144) {
  if (!mode) return "";
  const M = Number(slabM).toFixed(5);   // metres a square along the walk
  const walk = mode === "walk" ? 1 : 0;
  return `float kbSwBx = 0.0, kbSwBz = 0.0;
#ifdef USE_MAP
if (kbNsF > 0.0) {
  vec2 kbSwS = vMapUv * ${Number(slabs).toFixed(5)}, kbSwFr = fract(kbSwS);
  // Metres a square on each axis, from how the surface's place and its UVs change across the
  // pixel: along the walk always three feet, across it the walk's own row (module 09 walkRowM,
  // stretched up to four and a half feet so no part-square is left at an edge).
  vec3 kbSwQ1 = dFdx(kbNsW), kbSwQ2 = dFdy(kbNsW);
  vec2 kbSwT1 = dFdx(kbSwS), kbSwT2 = dFdy(kbSwS);
  float kbSwJd = kbSwT1.x * kbSwT2.y - kbSwT2.x * kbSwT1.y;
  vec2 kbSwMs = vec2(${M});
  if (abs(kbSwJd) > 1e-12) kbSwMs = clamp(vec2(length(kbSwQ1 * kbSwT2.y - kbSwQ2 * kbSwT1.y), length(kbSwQ2 * kbSwT1.x - kbSwQ1 * kbSwT2.x)) / abs(kbSwJd), vec2(0.2), vec2(3.0));
  vec2 kbSwD = min(kbSwFr, 1.0 - kbSwFr) * kbSwMs;
  // The ground a pixel covers (m): further off, a joint narrower than that is drawn as the share
  // of the pixel it darkens, and the broom's streaks, a few millimetres apart, as their average --
  // not a line that flickers in and out between pixels (the ring reaches 200 m and more).
  float kbSwPx = max(length(fwidth(kbSwS) * kbSwMs), 1e-5);
  float kbSwUp = step(0.6, abs(KB_NS_N.y));
  // The joints: every square's, all alike, on the walk's top. The lip, a driveway and the curb's
  // face have none (mode "lip").
  float kbSwJ = ${walk}.0 > 0.5 && kbSwUp > 0.5 ? min(kbSwD.x, kbSwD.y) : 9.0;
  // A tooled joint is a groove a quarter-inch wide with radiused shoulders, in the same concrete:
  // only the shadow in it is darker.
  float kbSwGroove = (1.0 - smoothstep(0.0025, 0.0065 + kbSwPx, kbSwJ)) * min(1.0, 0.0085 / (kbSwPx + 0.002));
  // The broom, pulled across the walk and the lip alike: fine streaks along it, each a shade
  // off the next, wavering a little as a broom does; none on a face.
  float kbSwAlong = kbSwS.x * kbSwMs.x + 0.004 * sin(kbSwS.y * kbSwMs.y * 9.8);
  float kbSwStreak = fract(sin(floor(kbSwAlong * 260.0) * 91.7) * 43758.5);
  float kbSwBroom = (kbSwStreak - 0.5) * kbSwUp * (1.0 - smoothstep(0.002, 0.01, kbSwPx));
  vec3 kbSwC = diffuseColor.rgb * (1.0 + 0.11 * kbSwBroom);
  kbSwC *= 1.0 - 0.42 * kbSwGroove;
  diffuseColor.rgb = mix(diffuseColor.rgb, kbSwC, kbNsF);
  // The shoulders fall toward the joint: the light bends that way just either side of it.
  float kbSwSh = smoothstep(0.002, 0.005, kbSwJ) * (1.0 - smoothstep(0.005, 0.013, kbSwJ)) * (1.0 - smoothstep(0.004, 0.02, kbSwPx));
  kbSwBx = (kbSwD.x <= kbSwD.y ? sign(kbSwFr.x - 0.5) : 0.0) * kbSwSh + kbSwBroom * 0.3;
  kbSwBz = (kbSwD.y < kbSwD.x ? sign(kbSwFr.y - 0.5) : 0.0) * kbSwSh;
}
#endif`;
};
NEAR_SURFACE.scoredNormal ||= function (mode) {
  if (!mode) return "";
  return `#ifdef USE_MAP
if (kbNsF > 0.0 && (kbSwBx != 0.0 || kbSwBz != 0.0)) {
  // The slabs' u and v as directions on the surface, from how they change across the pixel.
  vec3 kbSwQ1 = dFdx(kbNsW), kbSwQ2 = dFdy(kbNsW);
  vec2 kbSwT1 = dFdx(vMapUv), kbSwT2 = dFdy(vMapUv);
  float kbSwDet = sign(kbSwT1.x * kbSwT2.y - kbSwT2.x * kbSwT1.y);
  vec3 kbSwN = KB_NS_N;
  vec3 kbSwTu = (kbSwQ1 * kbSwT2.y - kbSwQ2 * kbSwT1.y) * kbSwDet;
  vec3 kbSwTv = (kbSwQ2 * kbSwT1.x - kbSwQ1 * kbSwT2.x) * kbSwDet;
  kbSwTu = normalize(kbSwTu - kbSwN * dot(kbSwN, kbSwTu) + vec3(1e-6));
  kbSwTv = normalize(kbSwTv - kbSwN * dot(kbSwN, kbSwTv) + vec3(1e-6));
  vec3 kbSwBent = normalize(kbSwN + (kbSwTu * kbSwBx + kbSwTv * kbSwBz) * 0.9);
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(kbSwBent, 0.0)).xyz), kbNsF));
}
#endif`;
};
//: Into a material's shader (``shader`` as onBeforeCompile is given it) for a kind.
NEAR_SURFACE.patch ||= function (shader, kind) {
  if (!shader || shader.uniforms.kbNsMap) return;
  const fs = shader.fragmentShader, vs = shader.vertexShader;
  if (!fs.includes("#include <color_fragment>") || !fs.includes("#include <normal_fragment_maps>") || !vs.includes("#include <beginnormal_vertex>") || !vs.includes("#include <project_vertex>")) return;
  const u = NEAR_SURFACE.uniformsFor(kind);
  shader.uniforms.kbNsMap = u.map; shader.uniforms.kbNsRelief = u.relief; shader.uniforms.kbNsTile = u.tile; shader.uniforms.kbNsMean = u.mean; shader.uniforms.kbNsNear = NEAR_SURFACE.near;
  shader.vertexShader = vs.replace("#include <common>", "#include <common>\nvarying vec3 kbNsW; varying vec3 kbNsN;")
    .replace("#include <project_vertex>", `#include <project_vertex>
{ vec4 kbNsP = vec4(transformed, 1.0); vec3 kbNsO = objectNormal;
#ifdef USE_INSTANCING
kbNsP = instanceMatrix * kbNsP; kbNsO = mat3(instanceMatrix) * kbNsO;
#endif
kbNsW = (modelMatrix * kbNsP).xyz; kbNsN = normalize(mat3(modelMatrix) * kbNsO); }`);
  shader.fragmentShader = fs.replace("#include <common>", `#include <common>
varying vec3 kbNsW; varying vec3 kbNsN;
// The surface's normal on the side being seen. Most street ribbons are wound face-down and drawn
// double-sided: three.js turns its own normal round for the back face, and this has to as well --
// taken as stored, every road and pavement inside the photographs' ring was lit as if it faced
// the ground, near-black at the walker's feet (Chestnut Street, 2026-11-22).
#define KB_NS_N (normalize(kbNsN) * (gl_FrontFacing ? 1.0 : -1.0))
uniform sampler2D kbNsMap; uniform sampler2D kbNsRelief; uniform vec4 kbNsTile; uniform vec3 kbNsMean; uniform vec3 kbNsNear;
// The photograph's place on a surface: the ground by its x and z, a wall by its run and height.
vec2 kbNsUv(vec3 w, vec3 n, out vec3 t, out vec3 b) {
  vec3 a = abs(n);
  if (a.y > 0.6) { t = vec3(1.0, 0.0, 0.0); b = vec3(0.0, 0.0, -1.0); return vec2(w.x, -w.z); }
  if (a.x > a.z) { t = vec3(0.0, 0.0, -sign(n.x)); b = vec3(0.0, 1.0, 0.0); return vec2(-w.z * sign(n.x), w.y); }
  t = vec3(sign(n.z), 0.0, 0.0); b = vec3(0.0, 1.0, 0.0); return vec2(w.x * sign(n.z), w.y);
}`)
    .replace("#include <color_fragment>", `#include <color_fragment>
float kbNsF = kbNsNear.z * kbNsTile.z * (1.0 - smoothstep(kbNsNear.x, kbNsNear.y, distance(kbNsW, cameraPosition)));
vec3 kbNsT, kbNsB; vec2 kbNsAt = vec2(0.0);
// (Sampled wherever the pictures are in, not only inside the ring: a branch that differs from one
// pixel to the next would leave the texture's mip level undefined along the ring's edge.)
if (kbNsNear.z * kbNsTile.z > 0.0) {
  kbNsAt = kbNsUv(kbNsW, KB_NS_N, kbNsT, kbNsB) * kbNsTile.x;
  // The one photograph, and a second look at it turned and larger, so its repeat does not show.
  vec3 kbNsC = texture2D(kbNsMap, kbNsAt).rgb;
  vec3 kbNsC2 = texture2D(kbNsMap, mat2(0.8, -0.6, 0.6, 0.8) * kbNsAt * 0.37 + 0.31).rgb;
  vec3 kbNsD = mix(kbNsC, kbNsC * (kbNsC2 / kbNsMean), 0.35) / kbNsMean;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * clamp(kbNsD, 0.0, 2.5), kbNsF);
}
${NEAR_SURFACE.scoredColor(NEAR_SURFACE.kinds[kind].scored, NEAR_SURFACE.kinds[kind].slabs, NEAR_SURFACE.kinds[kind].slab_m)}`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
if (kbNsNear.z * kbNsTile.z > 0.0 && kbNsTile.y > 0.0) {
  vec3 kbNsR = texture2D(kbNsRelief, kbNsAt).xyz * 2.0 - 1.0;
  vec3 kbNsWN = KB_NS_N;
  vec3 kbNsBent = normalize(kbNsT * kbNsR.x * kbNsTile.y + kbNsB * kbNsR.y * kbNsTile.y + kbNsWN * max(kbNsR.z, 0.2));
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(kbNsBent, 0.0)).xyz), kbNsF));
}
${NEAR_SURFACE.scoredNormal(NEAR_SURFACE.kinds[kind].scored)}`);
};
// Every lit material, without each being told: a material with no hook of its own uses this one,
// and those that chain a hook (patchMaterial, the box clips) call it first. A material that sets
// its own hook outright calls PROXY_LIGHT.patch itself. The same hook lays the near photographs
// on a surface that is one of their kinds, and its program is kept apart from the plain one's.
//: Plain light: a street's surfaces lit as matt ones (three.js's Lambert terms) inside the
//: standard material's own program. The standard material works out a microfacet highlight for
//: the sun, the sky and the indoor light at every pixel -- roughness, Fresnel, a visibility term
//: -- and on asphalt, stucco and brick at street distances none of it shows; it was most of what
//: a frame cost while the view turned (measured in Kerbside.app, 2026-11-22). Colour, maps, the
//: stand-in's shadows and bounced light, emissive glow and every clip are as they were. Glass and
//: metal (metalness over 0.3, or roughness under 0.35) keep their highlights.
const PLAIN_LIGHT = globalThis.__kerbsidePlainLight ||= {
  enabled: true,
  on(material) { return this.enabled && material.isMeshStandardMaterial === true && !material.isMeshPhysicalMaterial && !(material.metalness > 0.3) && !(material.roughness < 0.35) && !material.envMap && material.userData?.keepHighlights !== true; },
  patch(shader, material) {
    if (!this.on(material) || !shader.fragmentShader.includes("#include <lights_physical_fragment>")) return;
    // (KB_PLAIN: the sun's glint is put back for these, one lobe: PROXY_LIGHT.patch.)
    shader.fragmentShader = ("#define KB_PLAIN\n" + shader.fragmentShader)
      // (Lambert's terms declare the view position again; the standard program already has: a
      // second declaration is a compile error on some drivers, and what used it was not drawn.)
      .replace("#include <lights_physical_pars_fragment>", /varying\s+vec3\s+vViewPosition\s*;/.test(shader.fragmentShader)
        ? THREE.ShaderChunk.lights_lambert_pars_fragment.replace(/varying\s+vec3\s+vViewPosition\s*;/, "") : "#include <lights_lambert_pars_fragment>")
      .replace("#include <lights_physical_fragment>", "float specularStrength = 1.0;\n#include <lights_lambert_fragment>");
  },
};
if (!ATTACH && !THREE.Material.prototype.onBeforeCompile.kbProxyLight) {
  const hook = function (shader) {
    globalThis.__kerbsidePlainLight?.patch(shader, this);
    globalThis.__kerbsideProxyLight.patch(shader, this);
    const N = globalThis.__kerbsideNearSurface, kind = N?.kindOf(this);
    if (kind) N.patch(shader, kind);
  };
  hook.kbProxyLight = true;
  THREE.Material.prototype.onBeforeCompile = hook;
  const key = THREE.Material.prototype.customProgramCacheKey;
  THREE.Material.prototype.customProgramCacheKey = function () {
    const kind = globalThis.__kerbsideNearSurface?.kindOf(this), plain = globalThis.__kerbsidePlainLight?.on(this) ? "|plain-light" : "";
    return kind ? `${key.call(this)}|near:${kind}${plain}` : `${key.call(this)}${plain}`;
  };
}
let proxyLightController = null, fineShadowController = null;
// A shader the driver refuses is a surface that is not drawn, and nothing says so: in November
// 2026 every plain-lit wall went that way and a house was its windows and a doorway in the air.
// The page looks for itself (docs/shader-check.mjs), a little at a time and only at programs
// already drawn with; if the plain light is what was refused, the walls go back to the full one.
if (!ATTACH) import(sharedAsset("shader-check.mjs")).then(({ failedPrograms }) => {
  const seen = new WeakSet(), met = new WeakSet(), failed = [];
  const look = (now = false) => {
    const bad = failedPrograms(renderer, seen, now ? null : met);
    if (!bad.length) return;
    failed.push(...bad);
    console.error("kerbside: shaders the driver refused; what uses them is not drawn", bad);
    if (PLAIN_LIGHT.enabled && bad.some((b) => b.key.includes("|plain-light"))) {
      PLAIN_LIGHT.enabled = false;
      scene.traverse((o) => { for (const m of [].concat(o.material || [])) if (m && m.isMeshStandardMaterial) m.needsUpdate = true; });
    }
  };
  window.kerbsideShaderCheck = () => { look(true); return { programs: renderer.info.programs.length, failed: failed.slice(), plainLight: PLAIN_LIGHT.enabled }; };
  setInterval(() => (window.requestIdleCallback || setTimeout)(() => look()), 15000);
}).catch((error) => console.warn("kerbside: no shader check", error));
if(!ATTACH) {
  // Do not add a top-level suspension here: regional labels initialize later.
  if(!META)import(sharedAsset("proxy-light.mjs")).then(({createProxyLight})=>{
    proxyLightController=createProxyLight({THREE,renderer,scene,sun,ambient:amb,uniforms:PROXY_LIGHT,night:NIGHT});
    window.kerbsideProxyLight=()=>proxyLightController;
  }).catch((error)=>console.warn("kerbside: no shadows",error));
  if(!META)import(sharedAsset("fine-shadows.mjs")).then(({createFineShadows})=>{
    fineShadowController=createFineShadows({THREE,renderer,scene,sun,uniforms:PROXY_LIGHT});
    window.kerbsideFineShadows=()=>fineShadowController;
  }).catch((error)=>console.warn("kerbside: no fine shadows",error));
  // Each material's own roughness and mirrored share, from the object catalogue
  // (docs/reflectance.mjs): given as streets arrive, a little at a time and only to what is new.
  if(!META)Promise.all([import(sharedAsset("reflectance.mjs")),objectCatalogueReady]).then(([{createReflectance},ready])=>{
    if(!ready)return;
    // What a drawn colour scatters back: the material's colour times its picture's average, as
    // light (not screen values). Not told where each point or instance has a colour of its own,
    // or the surface is see-through or lit by nothing.
    const pictureMeans=new Map(),lin=(c)=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
    let meanCanvas=null;
    const pictureMean=(map)=>{
      if(pictureMeans.has(map.uuid))return pictureMeans.get(map.uuid);
      const image=map.image;
      if(!image||!(image.width>0))return undefined;
      let y=null;
      try{
        let px=null;
        if(image.data&&image.data.length>=4&&(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray))px=image.data;
        else if(!image.data){
          meanCanvas||=Object.assign(document.createElement("canvas"),{width:8,height:8});
          const g=meanCanvas.getContext("2d",{willReadFrequently:true});
          g.clearRect(0,0,8,8);g.drawImage(image,0,0,8,8);px=g.getImageData(0,0,8,8).data;
        }
        if(px){
          const srgb=map.colorSpace===THREE.SRGBColorSpace,step=Math.max(4,Math.floor(px.length/4/256)*4);
          let sum=0,n=0;
          for(let i=0;i+3<px.length;i+=step){const r=px[i]/255,gg=px[i+1]/255,b=px[i+2]/255;sum+=srgb?0.2126*lin(r)+0.7152*lin(gg)+0.0722*lin(b):0.2126*r+0.7152*gg+0.0722*b;n+=1;}
          y=n?sum/n:null;
        }
      }catch(error){y=null;}
      pictureMeans.set(map.uuid,y);
      return y;
    };
    const drawnAlbedo=(m,o)=>{
      if(!(m.isMeshStandardMaterial||m.isMeshLambertMaterial||m.isMeshPhongMaterial)||!m.color)return null;
      if(m.vertexColors||o.instanceColor||(m.transparent&&m.opacity<0.9)||m.userData?.keepColour)return null;
      const c=0.2126*m.color.r+0.7152*m.color.g+0.0722*m.color.b;
      if(!m.map)return c;
      const p=pictureMean(m.map);
      return p===undefined?undefined:p===null?null:c*p;
    };
    const reflectance=createReflectance({catalogue:ready.catalogue,set:(m,roughness,specular)=>PROXY_LIGHT.opticsOf(m).value.set(roughness,specular),
      drawn:drawnAlbedo,tint:(m,k)=>{m.color.multiplyScalar(k);}});
    window.kerbsideReflectance=()=>({...reflectance.stats(),apply:()=>reflectance.apply(scene)});
    reflectance.apply(scene);
    setInterval(()=>(window.requestIdleCallback||setTimeout)(()=>reflectance.apply(scene)),6000);
  }).catch((error)=>console.warn("kerbside: no per-material reflectance",error));
  import(sharedAsset("environment-runtime.mjs")).then(({createEnvironment})=>{
  environmentController=createEnvironment({THREE,scene,renderer,camera,sun,ambient:amb,lat:midLat,lon:midLon,night:NIGHT,asset:sharedAsset});
  // Made after the mode was first set, as often as not: the city's sky is on the game's clock.
  environmentController.setClock?.(typeof appMode!=="undefined" && appMode==="city" ? "game" : "live");
  if(META){
    // Always the same light: noon, clear, whatever the hour or the weather outside.
    environmentController.setWeather("sunny");environmentController.setTime(metaLibrary.META_NOON);
    for(const name of ["setWeather","setTime","setPhase","setConditions"])environmentController[name]=()=>{};
  }
  window.kerbsideEnvironment={snapshot:()=>environmentController.snapshot(),
    setWeather:value=>environmentController.setWeather(value),setTime:value=>environmentController.setTime(value)};
  const section=document.createElement("section");section.className="group";
  const label=document.createElement("label");label.textContent="Weather preview (not live weather) ";
  const select=document.createElement("select");select.setAttribute("aria-label","Weather preview");
  for(const [value,title] of [["sunny","Sunny"],["partly_cloudy","Partly cloudy"],["cloudy","Cloudy"],["rain","Rain"]]){
    const option=document.createElement("option");option.value=value;option.textContent=title;select.append(option);}
  select.addEventListener("change",()=>environmentController.setWeather(select.value));label.append(select);
  // (No time to choose: the game keeps its own -- a day in 72 real minutes, docs/city/clock.mjs.)
  const clock=document.createElement("p");clock.id="world-clock";clock.style.fontSize="12px";
  section.append(label,clock);document.getElementById("settings-display")?.append(section);
  }).catch(error=>console.warn("kerbside: dynamic sky unavailable; static fallback retained",error));
}

const [westX, northY] = xy(bbox.west, bbox.north);
const [eastX, southY] = xy(bbox.east, bbox.south);
const width = eastX - westX;
const depth = northY - southY;
//: The stack at the bottom of the world, in metres. The bay is under the land, the land is
//: under everything, and both are under the roadway at 0.06. Water and the beaches used to sit
//: at -0.10 and -0.075, which is beneath the land plane at zero: the bay was drawn, every frame,
//: and then covered over by the very plane it was there to replace. It is the same mistake the
//: parks were buried by, and it is why the north edge of the corridor read as an expanse of
//: black rather than as water.
//
// The gaps between them are centimetres rather than millimetres, and deliberately so. At four
// millimetres apart the bay disc and the land plane above it z-fought across the whole city --
// a disc fifty kilometres wide has a very coarse depth gradient across a screen, and the water
// came up through the streets in patches. Depth precision is the constraint here, not headroom:
// there is a clear twenty-five centimetres before the roadway at 0.06.
//: The plate and the base plane stay under the sea; the bay and the map's water polygons
//: are drawn at the sea's own surface (SEA_Y), so that they meet the backdrop's water.
//: The land plate stands above the water, as land does: the apron eases the grid's edge down
//: to it, and at -0.14 m -- under the measured surface -- the whole apron was drawn as sea.
const PENINSULA_Y = WATERLINE_M + 0.3;
const LAND_Y = -0.12;
const BAY_Y = SEA_Y - 0.05;
const WATER_Y = SEA_Y + 0.01;
const BEACH_Y = SEA_Y + 0.03;
//: A pier's deck: under the yards in the ground stack (checked at load with the rest), over the
//: sea it stands beside.
const PIER_DECK_Y = 0.012;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(width, depth, 1, 1),
  // Not near-black any more. This plane is what shows wherever nothing has been mapped, and at
  // 0x0c171b that was indistinguishable from a hole in the world -- a wedge of it beside Aquatic
  // Park read as a void rather than as ground nobody has surveyed. Unmapped ground should look
  // like ground.
  // Neutral, not green. Near-black read as a hole and a green read as lawn -- both are wrong
  // for a strip of street nobody has surveyed, and the second is worse because it looks like an
  // answer. A dry grey-brown is what unmapped ground should look like: present, and not claiming
  // to be anything.
  new THREE.MeshStandardMaterial({ color: 0x4a4a45, roughness: 0.99, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = LAND_Y;
root.add(ground);

// ---- the terrain ---------------------------------------------------------------------------
//
// The lidar's ground surface as a mesh, drawn in the unmapped-ground colour a little under
// the street surfaces so that wherever nothing has been mapped the hill still shows, and the
// camera has something to land on. It is coarser than the height grid the surfaces are
// lifted by -- one vertex every TERRAIN_MESH_STRIDE cells -- because it is the backdrop, not
// the measurement; the measurement is in every lifted vertex.
//: Every other cell: a four-metre grid. At eight metres the backdrop's own chords rose through
//: the pavement at every sharp grade break -- at the foot of Grenard Terrace by half a metre.
const TERRAIN_MESH_STRIDE = 2;
const TERRAIN_MESH_UNDER_M = 0.35;
//: The ground the terrain mesh covers, as x0, z0, x1, z1 in the page's metres; null with no
//: terrain. A window drawn in full cuts the landscape away only where its own ground is: past
//: the terrain's edge (the estuary off Jack London Square) the cut showed the bare base plane.
function terrainPageRect() {
  if (!TERRAIN_FRAME) return null;
  const f=TERRAIN_FRAME,stride=TERRAIN_MESH_STRIDE;
  const a=terrainToPage(f.x0+.5*f.step_m,f.y0+.5*f.step_m,f);
  const b=terrainToPage(f.x0+(Math.floor((f.cols-1)/stride)*stride+.5)*f.step_m,
    f.y0+(Math.floor((f.rows-1)/stride)*stride+.5)*f.step_m,f);
  return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
}
function clipToTerrain(box) {
  const r=terrainPageRect();
  return r ? [Math.max(box[0],r[0]),Math.max(box[1],r[1]),Math.min(box[2],r[2]),Math.min(box[3],r[3])] : box;
}
//: The backdrop is cut into tiles of this many mesh vertices a side, each culled on its own.
//: As one mesh it was 1.8 million triangles that could never be culled, drawn under every
//: view including a first-person one looking at a single block.
const TERRAIN_TILE_VERTICES = 128;
//: Beyond the grid the backdrop carries on: an apron this wide, at APRON_STEP_M, whose height
//: eases from the grid's edge to the land plate's. Without it the box ended in a cliff, with
//: the edge streets and buildings standing over a plate three to twenty metres below them.
const TERRAIN_APRON_M = 2400.0;
const TERRAIN_APRON_STEP_M = 32.0;
const TERRAIN_APRON_DECAY_M = 700.0;
const TERRAIN_LAND = new THREE.Color(0x62645b);
const TERRAIN_SEA = new THREE.Color(0x2c6187);
//: The ground under a pond, which shows at its edge through the shallows.
const TERRAIN_BED = new THREE.Color(0x4a4a3c);
//: Sand: the map's beaches in the atlas, and the low ground beside a beach in the grid.
const TERRAIN_SAND = new THREE.Color(0xc9b98a);
const TERRAIN_CONCRETE = new THREE.Color(0x85867e);
//: The country beyond the survey: grass, plainly, so the edge of what was measured is legible.
const TERRAIN_PLATE = new THREE.Color(0x4a6f3c);
function terrainNoise(x, z, scale) {
  const u = x / scale, v = z / scale, ix = Math.floor(u), iz = Math.floor(v);
  const hash = (a, b) => { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };
  const sx = (u - ix) ** 2 * (3 - 2 * (u - ix));
  const sz = (v - iz) ** 2 * (3 - 2 * (v - iz));
  const a = hash(ix, iz) * (1 - sx) + hash(ix + 1, iz) * sx;
  const b = hash(ix, iz + 1) * (1 - sx) + hash(ix + 1, iz + 1) * sx;
  return a * (1 - sz) + b * sz;
}
//: The city's ground: within this reach of a mapped street, pavement, crossing, car park, pier
//: or building. Past it -- the end of the city, where no street goes -- the ground is the
//: country's plain grass at once, with no grey fading into the green.
const CITY_REACH_M = 30.0;
const CITY_CELL_M = 10.0;
const CITY_KINDS = new Set(["street", "sidewalk", "crossing", "parking_aisle", "parking_lot", "pier", "building"]);
const cityCells = (() => {
  const cells = new Set();
  const reach = Math.ceil(CITY_REACH_M / CITY_CELL_M);
  const mark = (x, z) => {
    const cx = Math.floor(x / CITY_CELL_M), cz = Math.floor(z / CITY_CELL_M);
    if (cells.has(`${cx}:${cz}`)) return;
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dz = -reach; dz <= reach; dz += 1) {
        if (dx * dx + dz * dz <= (reach + 0.5) ** 2) cells.add(`${cx + dx}:${cz + dz}`);
      }
    }
  };
  for (const way of DATA.ways || []) {
    if (!CITY_KINDS.has(way.kind) || !way.points) continue;
    for (let i = 0; i < way.points.length; i += 1) {
      const [bx, by] = xy(way.points[i][0], way.points[i][1]);
      if (i === 0) { mark(bx, -by); continue; }
      const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CITY_CELL_M / 2)));
      for (let k = 1; k <= n; k += 1) mark(ax + (bx - ax) * k / n, -(ay + (by - ay) * k / n));
    }
  }
  return cells;
})();
function inCity(x, z) {
  return cityCells.has(`${Math.floor(x / CITY_CELL_M)}:${Math.floor(z / CITY_CELL_M)}`);
}
function terrainLandColourAt(x, z) {
  if (!inCity(x, z)) {
    const local=NATURE?.local(midLon+x/metersPerLon,midLat-z/metersPerLat);
    const s = local&&NATURE.sample(...local,false);
    const colour = s && (NATURE.floorColourAt?.(...local)||natureLibrary.COVER_COLOURS[s.cover]);
    return colour ? new THREE.Color().setRGB(...natureLibrary.linearColour(colour)) : TERRAIN_PLATE;
  }
  // A hard class edge made each OSM parcel a huge, squared-off grey slab. Feather just
  // its *colour* across a few metres; mapped water and measured heights stay exact.
  const built = (2 * Number(mappedBuiltAt(x, z))
    + Number(mappedBuiltAt(x - 4, z)) + Number(mappedBuiltAt(x + 4, z))
    + Number(mappedBuiltAt(x, z - 4)) + Number(mappedBuiltAt(x, z + 4))) / 6;
  const blotch = terrainNoise(x, z, 37) - 0.5;
  const grit = terrainNoise(x, z, 9) - 0.5;
  const base = TERRAIN_LAND.clone().lerp(TERRAIN_CONCRETE, built);
  return base.multiplyScalar(0.96 + 0.14 * blotch + 0.08 * grit);
}
const terrainTiles = [];
//: The backdrop's height and colour at a point: land under the ground, or the sea where the
//: ground is at or under the waterline. ``apron`` is how far outside the grid the point lies.
//: Land or water beyond the grid, from the perimeter's map-derived cells; null where the
//: perimeter does not reach (or was not built), in which case the grid's edge cell decides.
//: The perimeter's frame is its own (centred on the atlas, not on this region), so a point
//: here goes through lon/lat to reach its cell.
function perimeterCell(x, z) {
  const f = PERIMETER.frame;
  const lon = midLon + x / metersPerLon, lat = midLat - z / metersPerLat;
  return [Math.floor(((lat - f.mid_lat) * f.metres_per_lat - f.y0) / f.step_m),
          Math.floor(((lon - f.mid_lon) * f.metres_per_lon - f.x0) / f.step_m)];
}
function perimeterClassAt(x, z) {
  if (!PERIMETER) return null;
  const f = PERIMETER.frame;
  const [r, c] = perimeterCell(x, z);
  if (r < 0 || c < 0 || r >= f.rows || c >= f.cols) return null;
  return PERIMETER.cells[r * f.cols + c];
}
function perimeterWaterAt(x, z) {
  const cls = perimeterClassAt(x, z);
  return cls === null ? null : cls === 1;
}
//: The sea's edge in the grid: the ground beside a mapped beach that stands low over the
//: water is sand -- the wet sand between the beach polygon's edge and the waterline, which
//: was drawn as the grid's grey. Boxes round the map's beach polygons, grown a little.
const BEACH_NEAR_M = 80.0;
const BEACH_RISE_M = 3.0;
const BEACH_BOXES = (DATA.ways || []).filter((w) => w.kind === "beach" && w.points && w.points.length >= 3).map((w) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lon, lat] of w.points) {
    const [x, y] = xy(lon, lat);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, -y); z1 = Math.max(z1, -y);
  }
  return [x0 - BEACH_NEAR_M, x1 + BEACH_NEAR_M, z0 - BEACH_NEAR_M, z1 + BEACH_NEAR_M];
});
function nearBeach(x, z) {
  for (const [x0, x1, z0, z1] of BEACH_BOXES) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
  return false;
}
function backdropAt(x, z, apron = 0) {
  // Outside the grid the lookup clamps to the grid's edge cell, so the apron carries that
  // cell's land or water outward: water past a wet edge, land past a dry one -- unless the
  // perimeter, which has the map's coastline, says otherwise.
  const edge = trenchGroundAt(x, z);
  const wet = apron > 0 ? perimeterWaterAt(x, z) : null;
  const inland = apron > 0 ? 0 : inlandWaterAt(x, z);
  // A pond's or a lake's bed, under its own water (INLAND_WATER); its overspill is shore.
  if (inland === 1) return { y: edge - TERRAIN_MESH_UNDER_M - earthDrop(x, z), colour: TERRAIN_BED };
  const mappedWet = apron > 0 || inland === 2 ? null : mappedWaterAt(x, z);
  if (mappedWet === true || (mappedWet === null && inland !== 2 && (wet === true || (wet === null && edge < WATERLINE_M)))) {
    return { y: SEA_Y - 0.02 - earthDrop(x, z), colour: TERRAIN_SEA };
  }
  let h = edge;
  // Sand: the atlas's beaches, and the low ground beside a mapped beach.
  const cls = apron > 0 ? perimeterClassAt(x, z) : null;
  const sandy = cls === 2 || (edge < SEA_SURFACE_M + BEACH_RISE_M && nearBeach(x, z));
  if (apron > 0) {
    // The height eases out to the plate's, so the apron is not a cliff; the colour does not:
    // past the last street the ground is plain grass at once, a sharp edge with no grey fade.
    const s = Math.exp(-apron / TERRAIN_APRON_DECAY_M);
    h = PENINSULA_Y + (h - PENINSULA_Y) * s;
    const colour = sandy ? TERRAIN_SAND : TERRAIN_PLATE;
    return { y: h - TERRAIN_MESH_UNDER_M - earthDrop(x, z), colour };
  }
  return { y: h - TERRAIN_MESH_UNDER_M - earthDrop(x, z), colour: sandy ? TERRAIN_SAND : terrainLandColourAt(x, z) };
}
// A terrain triangle across an immersed-tube portal fills its entrance like a wall.  Remove
// only the small opening at each mapped mouth; the estuary surface above the submerged middle
// remains intact.  The headwall and the road close the opening at street level.
const TUBE_PORTAL_CUTS = (DATA.ways || []).flatMap((way) => {
  if (!way.tunnel_design || way.tunnel_design.kind !== "immersed_tube" || !way.points || way.points.length < 2) return [];
  const local = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  return [[local[0], local[1]], [local[local.length - 1], local[local.length - 2]]]
    .map(([mouth, inside]) => {
      const dx = inside[0] - mouth[0], dz = inside[1] - mouth[1];
      const length = Math.hypot(dx, dz) || 1;
      return { x: mouth[0], z: mouth[1], ux: dx / length, uz: dz / length,
               half: (way.road_m || 8.9) / 2 + 1.0 };
    });
});
//: How far into the hill the ground is opened behind a land tunnel's headwall, and how far out
//: in front of it. The terrain is a 2 m grid and cannot step: across the mouth it ran as one
//: slope from the cut's road up to the hill, and that slope stood in both arches as a grey
//: fill. Opened, the arches show the bore; the headwall's crown cap closes the gap from above.
const PORTAL_OPEN_IN_M = 4.0;
const PORTAL_OPEN_OUT_M = 1.0;
function inTubePortalOpening(x, z) {
  for (const cut of APPROACH_CUTS) {
    const dx = x - cut.mx, dz = z - cut.mz;
    const along = dx * cut.ux + dz * cut.uz;
    if (along < -PORTAL_OPEN_IN_M || along > PORTAL_OPEN_OUT_M) continue;
    if (Math.abs(dx * cut.uz - dz * cut.ux) <= cut.half) return true;
  }
  return TUBE_PORTAL_CUTS.some((cut) => {
    const dx = x - cut.x, dz = z - cut.z;
    const along = dx * cut.ux + dz * cut.uz;
    const across = Math.abs(dx * cut.uz - dz * cut.ux);
    return along >= -5 && along <= 8 && across <= cut.half;
  });
}
function addBackdropTile(xs, zs, apronOf) {
  if(BUILD_WINDOW) {
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
    if(!BUILD_WINDOW.boxes.map(localWindowBox).some(b=>x1>=b.x && x0<=b.z && z1>=b.y && z0<=b.w))return;
  }
  const w = xs.length, h = zs.length;
  const position = new Float32Array(w * h * 3);
  const colour = new Float32Array(w * h * 3);
  const uv = new Float32Array(w * h * 2);
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      const i = (r * w + c) * 3;
      const at = backdropAt(xs[c], zs[r], apronOf ? apronOf(xs[c], zs[r]) : 0);
      // The apron's inner edge stands on the grid's edge at the grid's height, but in the
      // country's colour: coloured as the city, it blended grey into green over its first cell.
      const shade = apronOf && at.colour !== TERRAIN_SEA && at.colour !== TERRAIN_SAND ? TERRAIN_PLATE : at.colour;
      position[i] = xs[c]; position[i + 1] = at.y; position[i + 2] = zs[r];
      colour[i] = shade.r; colour[i + 1] = shade.g; colour[i + 2] = shade.b;
      const j = (r * w + c) * 2;
      uv[j] = xs[c] / 64; uv[j + 1] = zs[r] / 64;
    }
  }
  const index = new Uint32Array((w - 1) * (h - 1) * 6);
  let k = 0;
  // Wound to face up whichever way the rows run: the rows here run toward -z, and wound the
  // other way the whole backdrop faced down -- invisible from above, so that everywhere no
  // surface covered the ground the bay disc showed through from underneath as water.
  const up = (zs[Math.min(1, h - 1)] - zs[0]) < 0;
  for (let r = 0; r + 1 < h; r += 1) {
    for (let c = 0; c + 1 < w; c += 1) {
      const a = r * w + c, b = a + 1, d = a + w, e = d + 1;
      // Exact bore-volume clipping is applied after tunnel stations exist. Removing
      // whole grid cells by their centre made diagonal holes and left blocking shards.
      if (up) { index[k++] = a; index[k++] = b; index[k++] = d; index[k++] = b; index[k++] = e; index[k++] = d; }
      else { index[k++] = a; index[k++] = d; index[k++] = b; index[k++] = b; index[k++] = d; index[k++] = e; }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colour, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index.subarray(0, k), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const tile = new THREE.Mesh(geometry, TERRAIN_MATERIAL);
  tile.userData.surface = "terrain";
  // Backdrop first; inferred ground-cover polygons mask it before streets/buildings draw.
  tile.renderOrder = -2;
  terrainTiles.push(tile);
  if(BUILD_WINDOW)applyBoxClip(tile,detailClipBox);
  root.add(tile);
}
const TERRAIN_GRAIN = LANDWATER ? noiseTexture("#ffffff", "#777771", 512, 0.09) : null;
if (TERRAIN_GRAIN) TERRAIN_GRAIN.colorSpace = THREE.SRGBColorSpace;
const TERRAIN_MATERIAL = new THREE.MeshStandardMaterial({ map: TERRAIN_GRAIN, color: 0xffffff,
  vertexColors: true, roughness: 0.99, metalness: 0.0, envMapIntensity: 0.5, side: THREE.DoubleSide });
//: A house whose rooms were brought down to its street door (ROOMS_LOWERED_MAX_M) has a floor
//: below the hill it stands on. While the walker is in or at such a house, the terrain inside
//: its footprint and above its floor is not drawn: one footprint, as a ring of up to
//: INDOOR_CUT_MAX points, tested per fragment. Inactive (count 0) everywhere else.
const INDOOR_CUT_MAX = 32;
const indoorCut = {
  ring: { value: Array.from({ length: INDOOR_CUT_MAX }, () => new THREE.Vector2()) },
  count: { value: 0 },
  floor: { value: 0 },
  //: Where another region is drawn in full in this page: the country under it is not drawn
  //: (x0, z0, x1, z1 in this page's metres; empty when x1 < x0).
  guestBox: { value: boxSet([]) },
};
TERRAIN_MATERIAL.onBeforeCompile = (shader) => {
  globalThis.__kerbsideProxyLight?.patch?.(shader);
  shader.uniforms.uCutRing = indoorCut.ring;
  shader.uniforms.uCutCount = indoorCut.count;
  shader.uniforms.uCutFloor = indoorCut.floor;
  shader.uniforms.uGuestBox = indoorCut.guestBox;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vCutWorld;")
    .replace("#include <project_vertex>",
      "#include <project_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
varying vec3 vCutWorld;
uniform vec2 uCutRing[${INDOOR_CUT_MAX}];
uniform int uCutCount;
uniform float uCutFloor;
uniform vec4 uGuestBox[${BOX_SET_MAX}];`)
    .replace("void main() {", `void main() {
  for (int i = 0; i < ${BOX_SET_MAX}; i++) { vec4 g = uGuestBox[i];
    if (vCutWorld.x > g.x && vCutWorld.x < g.z && vCutWorld.z > g.y && vCutWorld.z < g.w) discard; }
  if (uCutCount > 2 && vCutWorld.y > uCutFloor - 0.02) {
    bool inside = false;
    for (int i = 0; i < ${INDOOR_CUT_MAX}; i++) {
      if (i >= uCutCount) break;
      vec2 a = uCutRing[i];
      vec2 b = uCutRing[i == 0 ? uCutCount - 1 : i - 1];
      if (((a.y > vCutWorld.z) != (b.y > vCutWorld.z))
          && (vCutWorld.x < (b.x - a.x) * (vCutWorld.z - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    if (inside) discard;
  }`)
    // Water used to inherit the city's concrete grain and .99 roughness while
    // the adjoining nature ocean used untextured .62/.04 water. This made the
    // rectangular terrain footprint visible offshore even with identical colours.
    // Classify the untouched vertex colour, not the already-grained diffuse value.
    .replace("#include <color_fragment>", `#include <color_fragment>
  float terrainWet = 1.0 - step(0.0001, distance(vColor.rgb, vec3(${TERRAIN_SEA.r}, ${TERRAIN_SEA.g}, ${TERRAIN_SEA.b})));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${TERRAIN_SEA.r}, ${TERRAIN_SEA.g}, ${TERRAIN_SEA.b}), terrainWet);`)
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .62, terrainWet);")
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, .04, terrainWet);")
    .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, normalize(mat3(viewMatrix) * vec3(0., 1., 0.)), terrainWet));");
};
TERRAIN_MATERIAL.customProgramCacheKey = () => "terrain-indoor-cut-unified-ocean-v2";
//: What else is laid on the hill and can stand up through a lowered house's floor: the pavement
//: underlay, which reaches to the property line and under the front of a house; the yards and
//: lawns, whose rings overlap the footprints they were traced beside; a front path or a lot. The
//: terrain alone was cut, so walking up through such a house the walker stayed on the level
//: floor while the underlay and the yards went on up the hill round him -- a sloping floor he
//: sank into, with the house's real floor showing under it.
const INDOOR_CUT_SURFACES = /^(walk_underlay|yard|lawn|backyard|front_walk|service_yard|parking_lot|footprint|park|plaza|court|garden|tree_pit|planting|grass)/;
function installIndoorGroundCut(object) {
  let installed = 0;
  object.traverse((o) => {
    if (!o.isMesh || !INDOOR_CUT_SURFACES.test(String(o.userData.surface || ""))) return;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!material || material.userData.indoorCut) continue;
      material.userData.indoorCut = true;
      const before = material.onBeforeCompile;
      const cacheKey = material.customProgramCacheKey();
      material.onBeforeCompile = function (shader, renderer) {
        before.call(this, shader, renderer);
        shader.uniforms.uCutRing = indoorCut.ring;
        shader.uniforms.uCutCount = indoorCut.count;
        shader.uniforms.uCutFloor = indoorCut.floor;
        if (!shader.vertexShader.includes("varying vec3 vCutWorld;")) {
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vCutWorld;")
            .replace("#include <project_vertex>", `#include <project_vertex>
  { vec4 cutPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  cutPosition = instanceMatrix * cutPosition;
  #endif
  vCutWorld = (modelMatrix * cutPosition).xyz; }`);
        }
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>
varying vec3 vCutWorld;
uniform vec2 uCutRing[${INDOOR_CUT_MAX}];
uniform int uCutCount;
uniform float uCutFloor;`)
          .replace("void main() {", `void main() {
  if (uCutCount > 2 && vCutWorld.y > uCutFloor - 0.02) {
    bool cutInside = false;
    for (int i = 0; i < ${INDOOR_CUT_MAX}; i++) {
      if (i >= uCutCount) break;
      vec2 a = uCutRing[i];
      vec2 b = uCutRing[i == 0 ? uCutCount - 1 : i - 1];
      if (((a.y > vCutWorld.z) != (b.y > vCutWorld.z))
          && (vCutWorld.x < (b.x - a.x) * (vCutWorld.z - a.y) / (b.y - a.y) + a.x)) cutInside = !cutInside;
    }
    if (cutInside) discard;
  }`);
      };
      material.customProgramCacheKey = () => `${cacheKey}:indoor-cut-v1`;
      material.needsUpdate = true;
      installed += 1;
    }
  });
  return installed;
}
if (TERRAIN_FRAME) {
  const f = TERRAIN_FRAME;
  const cols = Math.floor((f.cols - 1) / TERRAIN_MESH_STRIDE) + 1;
  const rows = Math.floor((f.rows - 1) / TERRAIN_MESH_STRIDE) + 1;
  const xOf = (c) => terrainToPage(f.x0 + (c * TERRAIN_MESH_STRIDE + 0.5) * f.step_m, f.y0, f)[0];
  const zOf = (r) => terrainToPage(f.x0, f.y0 + (r * TERRAIN_MESH_STRIDE + 0.5) * f.step_m, f)[1];
  // Tiles share their edge row and column, so there is no seam between them.
  for (let r0 = 0; r0 + 1 < rows; r0 += TERRAIN_TILE_VERTICES - 1) {
    for (let c0 = 0; c0 + 1 < cols; c0 += TERRAIN_TILE_VERTICES - 1) {
      const r1 = Math.min(rows - 1, r0 + TERRAIN_TILE_VERTICES - 1);
      const c1 = Math.min(cols - 1, c0 + TERRAIN_TILE_VERTICES - 1);
      const xs = [], zs = [];
      for (let c = c0; c <= c1; c += 1) xs.push(xOf(c));
      for (let r = r0; r <= r1; r += 1) zs.push(zOf(r));
      addBackdropTile(xs, zs, null);
    }
  }
  // The apron: a ring of coarse tiles round the grid. Its inner row and column are the grid's
  // own edge vertices, so it meets the grid without a seam.
  const west = xOf(0), east = xOf(cols - 1), north = zOf(rows - 1), south = zOf(0);
  const steps = NATURE || ATTACH?.natureBacked ? 0 : Math.ceil(TERRAIN_APRON_M / TERRAIN_APRON_STEP_M);
  const outward = (from, sign) => { const out = [from]; for (let i = 1; i <= steps; i += 1) out.push(from + sign * i * TERRAIN_APRON_STEP_M); return out; };
  const along = (from, to) => { const out = []; const n = Math.max(1, Math.ceil((to - from) / TERRAIN_APRON_STEP_M)); for (let i = 0; i <= n; i += 1) out.push(from + (to - from) * i / n); return out; };
  const apronOf = (x, z) => Math.max(0, west - x, x - east, north - z, z - south);
  const xsIn = along(west, east), zsIn = along(north, south);
  const xsW = outward(west, -1).reverse(), xsE = outward(east, 1);
  const zsN = outward(north, -1).reverse(), zsS = outward(south, 1);
  addBackdropTile(xsIn, zsN, apronOf); addBackdropTile(xsIn, zsS, apronOf);
  addBackdropTile(xsW, zsIn, apronOf); addBackdropTile(xsE, zsIn, apronOf);
  addBackdropTile(xsW, zsN, apronOf); addBackdropTile(xsE, zsN, apronOf);
  addBackdropTile(xsW, zsS, apronOf); addBackdropTile(xsE, zsS, apronOf);
}
// Inland water at its own shape and level, one mesh for the region (INLAND_WATER).
if (INLAND_WATER.length) {
  const position = [], rim = [];
  const tri = (a, b, c, level) => {
    const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
    for (const [x, z] of up ? [a, b, c] : [a, c, b]) position.push(x, level - earthDrop(x, z), z);
  };
  for (const water of INLAND_WATER) {
    for (const ring of water.rings || []) {
      const flat = ring.slice();
      const [p, q] = [flat[0], flat[flat.length - 1]];
      if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6) flat.pop();
      if (flat.length < 3) continue;
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(flat.map(([x, z]) => new THREE.Vector2(x, z)), []))
        tri(flat[i], flat[j], flat[k], water.level);
    }
    const t = water.triangles || [];
    for (let k = 0; k + 2 < t.length; k += 3) tri(t[k], t[k + 1], t[k + 2], water.level);
    if (water.basin) {
      const { x, z, a, b, angle } = water.basin, ca = Math.cos(angle), sa = Math.sin(angle), n = INLAND_BASIN_RIM.segments;
      const at = (k, grow = 0) => {
        const t2 = (k / n) * 2 * Math.PI, u = (a + grow) * Math.cos(t2), v = (b + grow) * Math.sin(t2);
        return [x + u * ca - v * sa, z + u * sa + v * ca];
      };
      for (let k = 0; k < n; k += 1) tri([x, z], at(k), at(k + 1), water.level);
      // The rim: a low stone kerb round the basin, its top and both its faces.
      const w = INLAND_BASIN_RIM.width, y0 = water.level - 0.1, y1 = water.level + INLAND_BASIN_RIM.rise;
      for (let k = 0; k < n; k += 1) {
        const [p, q, P, Q] = [at(k), at(k + 1), at(k, w), at(k + 1, w)];
        rim.push(...p, y1, ...P, y1, ...Q, y1, ...p, y1, ...Q, y1, ...q, y1);
        rim.push(...p, y0, ...q, y0, ...q, y1, ...p, y0, ...q, y1, ...p, y1);
        rim.push(...Q, y0, ...P, y0, ...P, y1, ...Q, y0, ...P, y1, ...Q, y1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const water = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: TERRAIN_SEA, roughness: 0.62, metalness: 0.04, envMapIntensity: 0.5, side: THREE.DoubleSide }));
  water.name = "inland-water";
  water.userData.surface = "water";
  water.userData.inlandWater = INLAND_WATER.length;
  water.renderOrder = -1;
  if (BUILD_WINDOW) applyBoxClip(water, detailClipBox);
  root.add(water);
  if (rim.length) {
    // Pushed as (x, z, y) triples: put into x, y, z.
    const xyz = new Float32Array(rim.length);
    for (let i = 0; i < rim.length; i += 3) { xyz[i] = rim[i]; xyz[i + 1] = rim[i + 2] - earthDrop(rim[i], rim[i + 1]); xyz[i + 2] = rim[i + 1]; }
    const kerb = new THREE.BufferGeometry();
    kerb.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
    kerb.computeVertexNormals();
    const stone = new THREE.Mesh(kerb, new THREE.MeshStandardMaterial({ color: 0xb9b4a8, roughness: 0.85, side: THREE.DoubleSide }));
    stone.name = "inland-water-rims";
    stone.userData.surface = "fountain_rim";
    if (BUILD_WINDOW) applyBoxClip(stone, detailClipBox);
    root.add(stone);
  }
  console.info(`kerbside: ${INLAND_WATER.length} ponds, fountains and lakes at their own level`);
}
//: The backdrop as one object for the ray that finds the ground under a click.
const terrainMesh = terrainTiles.length ? new THREE.Group() : null;
if (terrainMesh) { terrainMesh.userData.surface = "terrain"; }

//: A surface lifted vertex by vertex only follows the ground where it has vertices. A yard
//: drawn as one polygon across a block, a footprint, a fence panel between two posts, the
//: underlay behind a whole block's pavement: lifted at their corners they cut straight through
//: the hill between them, and the hill showed through as dark patches and the surfaces stood
//: off it as slabs. Before lifting, every triangle with an edge longer than this is bisected
//: along that edge, again and again, until none is -- a long thin strip splits along its
//: length only. Neighbours sharing an edge share the midpoint, so a split edge does not open.
//: Twelve metres, not eight: on a straight grade the chord of a twelve-metre edge lies on the
//: ground exactly, and where the ground curves the bend rule below splits it further. At eight
//: metres everywhere the streets alone were fifteen million triangles.
const TERRAIN_REFINE_M = 12.0;
//: And shorter than that wherever the ground curves: an edge whose midpoint the ground stands
//: this far above or below its chord is split too, down to TERRAIN_REFINE_MIN_M. A flat block
//: stays coarse; the brow of a hill and the foot of a retaining wall get the vertices.
//: A quarter of a metre, down to edges of four. The tolerance has to sit above the grid's own
//: noise -- the lidar ground is good to about a decimetre -- or the bend rule fires on noise
//: everywhere and refines the whole city to its smallest edge: at 0.12 m and 2.5 m the scene
//: was 238 million triangles. What put yards a metre off the hill was not this tolerance but
//: the refinement budget running out (see refineForTerrain).
const TERRAIN_CHORD_M = HEADSET ? 0.6 : 0.25;
const TERRAIN_REFINE_MIN_M = HEADSET ? 8.0 : 4.0;
//: By surface, [longest edge, chord]. What lies under something else -- the underlay behind a
//: pavement, the footprint under a building -- is refined coarsely for length, but still for
//: curvature: a chord that sags below the ground is unseen, a chord that stands above it pokes
//: up through the pavement laid over it as a bare patch, which is what "missing tiles in the
//: middle of the sidewalk" was. A parking lot or a front path is refined for length only: the
//: grid under a multi-storey garage or a flight of steps is a staircase, and chasing every step
//: of it ran a hundred and fifty lots to over a million triangles. A yard or a park, both.
//: The underlay's top is 23 cm under the pavement's; its chords may leave the ground by less
//: than that, or they stand up through it.
const TERRAIN_UNDER_CHORD_M = 0.2;
//: A fifth field turns the adaptive lattice on for a surface: the spacing then follows the
//: ground under it (latticeAt) instead of being one number for the whole city.
//:
//: It is on for the wide flat covers laid over the hill -- a yard, a park, a plaza, the
//: pavement underlay -- because those are what the hill comes up through, and off for the
//: street ribbons. Streets are already cut every five metres along their length by densifyWay
//: and are a couple of lanes wide; turning it on for them took the corridor from 15.53 M
//: triangles to 26.19 M and its build from 56 s to 161 s, and fixed nothing, because the sag
//: was never there.
//: The surfaces laid at street level, which have to follow the hill together (see below).
//: A tree pit is one of them: it is a square of soil laid four millimetres over the pavement,
//: and given twelve-metre edges it was never cut at all -- a flat 1.2-1.9 m quad between its
//: own four corners, over a pavement bent on the two-metre grid beneath it, so wherever the
//: ground broke its grade under a pit the pavement came up through the soil as white shards
//: (Chestnut's tree pits from Scott to Avila). Cut on the same grid, the two stay parallel.
const STREET_GRID_SURFACES = ["road", "walk", "walk_narrow", "kerb", "median", "bike", "busway",
  "marking", "crossing", "crossing_edges", "tactile_warning", "tree_pit"];
const TERRAIN_REFINE_BY_SURFACE = {
  // Not the underlay: it is a backstop laid five centimetres under everything else so that
  // grass and frontages win over it, so its own sag is never what anybody sees -- and it is
  // the widest surface in the model, 7.35 M triangles of the corridor's 25.5 M when it was
  // given the adaptive lattice. It keeps one spacing.
  walk_underlay: [TERRAIN_REFINE_M, TERRAIN_UNDER_CHORD_M],
  footprint: [TERRAIN_REFINE_M, TERRAIN_UNDER_CHORD_M], garage: [TERRAIN_REFINE_M, TERRAIN_UNDER_CHORD_M],
  parking_lot: [12.0, 0], front_walk: [12.0, 0],
  pier: [12.0, 0],
  // Visible plaza paving must follow the 2 m terrain grid. A 12 m chord fell 40 cm below
  // that grid around 600 Montgomery, exposing dark terrain as angular holes in the paving.
  plaza: [2.0, 0, 2.0, true],
  // A 16 m grass chord can bridge over a steep footway or a court even though its vertices
  // are below both surfaces. Grass has no reason to be planar across a retaining wall.
  yard: [12.0, 0.15, 3.0], park: [4.0, 0.05, 2.0, true],
  service_yard: [12.0, 0.15, 3.0], court: [8.0, 0.05, 2.0], court_line: [8.0, 0.05, 2.0],
  // A playground's safety surface lies on the grass of a park on a hill: as fine as the grass,
  // or the grass shows through it in patches where the ground bulges between its corners.
  "park:play_surface": [2.0, 0, 2.0, true], "park:skatepark_surface": [2.0, 0, 2.0, true],
  // The street, its pavements, its kerbs and its paint, cut on the terrain grid itself, so that
  // every one of them runs from one measured ground point to the next in the same straight line.
  // Refined each on its own to a quarter-metre chord, the road and the pavement beside it sagged
  // differently between their vertices, and where a hill breaks its grade at a crossing -- every
  // corner of Russian Hill -- the road stood up through the pavement's 13 cm: ragged chunks of
  // asphalt along the kerb, specks of it inside the footway, and a step wherever one surface
  // met another. Cut together they cannot cross. A fifth more street triangles in a window; not
  // the headset, which is held to its frame budget.
  ...(HEADSET ? {} : Object.fromEntries(STREET_GRID_SURFACES.map((s) => [s, [2.0, 0, 2.0, true]]))),
};
//: The bend rule may not multiply a mesh past this: the grid is stepped wherever a wall or a
//: stair stands, and chasing every step to the grid's own cell size ran a yard to millions.
const TERRAIN_REFINE_GROWTH = 4;
//: And a mesh may not pass this many vertices however much area it covers. The cut index is
//: packed as a * 2^24 + b, so two vertices past 16,777,216 would share a key and the
//: refinement would read back somebody else's cut; V8 stops a Map at about the same place,
//: which is where the ground build died. Twelve million is clear of both.
//:
//: Not lower. Four million looked like a safe round number and was not: the corridor's plaza
//: paving is one merged mesh that had been refining past it happily, and capping it there put
//: Huntington Park six and a half metres under the hill -- the same holes this work is here to
//: close, dug deeper, in the one surface that had been right all along.
const REFINE_VERTEX_CAP = 12_000_000;
