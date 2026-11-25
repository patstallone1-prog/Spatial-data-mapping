// A drink in its glass: how much there is, where its surface is however the glass is tilted (level
// in the world, so in the glass's own frame it slopes as the glass tips), how far a glass must be
// tipped for the drink to reach its rim -- further the emptier it is, as a real glass is -- and
// what spills over the rim (into the mouth, drinking) when it is tipped further.
//
// A vessel is its inner profile ([[r, y], ...] from the middle of the inside bottom out and up to
// the rim, tableware.mjs VESSELS), turned about +y. Tipping is toward +z (the side drunk from):
// ``tilt`` (radians) leans +y over toward +z, so the rim's +z point is the lowest. The surface is
// the plane y cos(tilt) - z sin(tilt) = c in the glass's frame (c: the level).
//
// Pure maths (volumes in m³; tests/city_liquid.test.mjs) and, with three.js, the drink's mesh.

const STEPS = 160;

//: The profile's radius and height at s (0..1 along it, by its points).
function along(inner, s) {
  const n = inner.length - 1, t = Math.max(0, Math.min(1, s)) * n, i = Math.min(n - 1, Math.floor(t)), f = t - i;
  const [r0, y0] = inner[i], [r1, y1] = inner[i + 1];
  return [r0 + (r1 - r0) * f, y0 + (y1 - y0) * f];
}
//: The inside's radius at height y (its widest there); 0 below the bottom.
export function radiusAt(inner, y) {
  let r = 0;
  for (let i = 1; i < inner.length; i += 1) {
    const [r0, y0] = inner[i - 1], [r1, y1] = inner[i];
    if (y0 === y1) { if (Math.abs(y - y0) < 1e-9) r = Math.max(r, r0, r1); continue; }
    if ((y - y0) * (y - y1) <= 0) r = Math.max(r, r0 + (r1 - r0) * (y - y0) / (y1 - y0));
  }
  return r;
}
const bottomOf = (inner) => Math.min(...inner.map((p) => p[1]));
const rimOf = (inner) => inner[inner.length - 1][1];

//: The area of the part of a disc of radius r on the far side of a chord at z0 (z > z0).
function segmentArea(r, z0) {
  if (z0 <= -r) return Math.PI * r * r;
  if (z0 >= r) return 0;
  return r * r * Math.acos(z0 / r) - z0 * Math.sqrt(r * r - z0 * z0);
}
//: The volume under the surface at level ``c`` with the glass tipped ``tilt`` (up to the rim:
//: above it, it has gone over).
export function volumeAt(inner, c, tilt = 0) {
  const y0 = bottomOf(inner), y1 = rimOf(inner), dy = (y1 - y0) / STEPS, ct = Math.cos(tilt), st = Math.sin(tilt);
  let v = 0;
  for (let k = 0; k < STEPS; k += 1) {
    const y = y0 + (k + 0.5) * dy, r = radiusAt(inner, y);
    if (r <= 0) continue;
    // Below the surface: y ct - z st < c, so z > (y ct - c) / st (or all of it, upright, below c).
    if (Math.abs(st) < 1e-6) { if (y * ct < c) v += Math.PI * r * r * dy; continue; }
    v += segmentArea(r, (y * ct - c) / st) * dy;
  }
  return v;
}
//: The glass's capacity (to the rim, upright).
export const capacityOf = (inner) => volumeAt(inner, rimOf(inner) + 1e-6, 0);
//: The level that holds volume ``v`` at ``tilt`` (bisection).
export function levelFor(inner, v, tilt = 0) {
  const ct = Math.cos(tilt), st = Math.sin(tilt), R = Math.max(...inner.map((p) => p[0]));
  let lo = bottomOf(inner) * ct - R * Math.abs(st) - 0.01, hi = rimOf(inner) * ct + R * Math.abs(st) + 0.01;
  for (let i = 0; i < 40; i += 1) { const mid = (lo + hi) / 2; if (volumeAt(inner, mid, tilt) < v) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
//: The level at which it goes over the rim (its lowest point, on +z) at ``tilt``.
export function spillLevel(inner, tilt) {
  const [r, y] = inner[inner.length - 1];
  return y * Math.cos(tilt) - r * Math.sin(tilt);
}
//: The most the glass holds tipped ``tilt``.
export const holdsAt = (inner, tilt) => volumeAt(inner, spillLevel(inner, tilt), tilt);
//: How far it must be tipped for ``v`` to reach the rim (radians; π/2 and more when it is nearly
//: empty: the glass upended).
export function tiltToReach(inner, v) {
  if (v >= capacityOf(inner) - 1e-12) return 0;
  let lo = 0, hi = Math.PI * 0.95;
  for (let i = 0; i < 36; i += 1) { const mid = (lo + hi) / 2; if (holdsAt(inner, mid) > v) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

//: A drink: ``v`` of it in the vessel, tipped ``tilt``; step(dt, tilt) moves on: what is over the
//: rim runs off (as fast as the lip lets it: a small overflow trickles, a big one pours) and is
//: returned as the flow this step (m³/s). ``foam``: a head of so many metres on top (a beer's) that
//: goes with the drink.
export function createDrink(inner, { fill = 0.85, foam_m = 0 } = {}) {
  const cap = capacityOf(inner);
  const S = { v: cap * fill, tilt: 0, flow: 0, poured: 0, cap, foam: foam_m };
  S.step = (dt, tilt) => {
    S.tilt = tilt;
    const most = holdsAt(inner, tilt), over = Math.max(0, S.v - most);
    // Over the lip: a weir, the flow rising with the head over it (all of it within ~0.12 s).
    const flow = over > 0 ? Math.min(over / dt, over / 0.12 + 4e-6) : 0;
    S.v = Math.max(0, S.v - flow * dt);
    S.poured += flow * dt;
    S.flow = flow;
    if (S.v < cap * 0.08) S.foam = Math.min(S.foam, 0.003);
    return flow;
  };
  S.level = () => levelFor(inner, S.v, S.tilt);
  S.left = () => S.v / cap;
  return S;
}

// ---- the drink as it is drawn -------------------------------------------------------------------------

//: The drink's mesh in a vessel's frame: its sides up the inside of the glass to the surface, the
//: surface itself (level in the world), and its bottom. ``layers``: [{ material }, { material, foam:
//: true }] -- the drink, then a head of foam on it (drink.foam deep). update(drink) redraws it.
export function createDrinkMesh(THREE, inner, layers, { segments = 36, rings = 14 } = {}) {
  const group = new THREE.Group();
  group.name = "drink";
  const parts = layers.map((L) => {
    const count = (segments + 1) * (rings + 1) + (segments + 2) * 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const uv = new Float32Array(count * 2);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const idx = [], wall = (i, k) => k * (segments + 1) + i, capTop = (segments + 1) * (rings + 1), capBot = capTop + segments + 2;
    for (let k = 0; k < rings; k += 1) for (let i = 0; i < segments; i += 1) idx.push(wall(i, k), wall(i + 1, k + 1), wall(i + 1, k), wall(i, k), wall(i, k + 1), wall(i + 1, k + 1));
    // (The surface faces up, the bottom down: wound so from outside each is its front.)
    for (let i = 0; i < segments; i += 1) { idx.push(capTop, capTop + 2 + i, capTop + 1 + i); idx.push(capBot, capBot + 1 + i, capBot + 2 + i); }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, L.material);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { L, geo, mesh };
  });
  const yBot = bottomOf(inner) + 0.0005;
  //: Where along the wall at angle φ the plane at level c meets it (0..1 along the profile).
  const meet = (c, k, ct, st) => {
    // f(s) = y ct - (r sinφ) st - c, rising along the wall from the bottom to the rim.
    const f = (s) => { const [r, y] = along(inner, s); return y * ct - r * k * st - c; };
    if (f(1) <= 0) return 1;
    if (f(0) >= 0) return 0;
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i += 1) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  function fill(part, cLow, cHigh, ct, st) {
    const P = part.geo.attributes.position, U = part.geo.attributes.uv;
    const capTop = (segments + 1) * (rings + 1), capBot = capTop + segments + 2;
    // The axis's point on each plane (the caps' middles), kept to the inside.
    const onAxis = (c) => Math.max(yBot, Math.min(rimOf(inner), c / Math.max(0.05, ct)));
    for (let i = 0; i <= segments; i += 1) {
      const phi = (i / segments) * Math.PI * 2, k = Math.sin(phi), kc = Math.cos(phi);
      const sHi = meet(cHigh, k, ct, st), sLo = cLow === null ? 0 : meet(cLow, k, ct, st);
      for (let q = 0; q <= rings; q += 1) {
        const [r, y] = along(inner, sLo + (sHi - sLo) * (q / rings)), j = q * (segments + 1) + i;
        P.setXYZ(j, r * 0.985 * kc, Math.max(yBot, y), r * 0.985 * k);
        U.setXY(j, i / segments, q / rings);
      }
      const [rt, yt] = along(inner, sHi), [rb, yb] = along(inner, sLo);
      P.setXYZ(capTop + 1 + i, rt * 0.985 * kc, Math.max(yBot, yt), rt * 0.985 * k);
      U.setXY(capTop + 1 + i, 0.5 + 0.5 * kc, 0.5 + 0.5 * k);
      P.setXYZ(capBot + 1 + i, rb * 0.985 * kc, Math.max(yBot, cLow === null ? yBot : yb), rb * 0.985 * k);
    }
    P.setXYZ(capTop, 0, onAxis(cHigh), 0); U.setXY(capTop, 0.5, 0.5);
    P.setXYZ(capBot, 0, cLow === null ? yBot : onAxis(cLow), 0);
    P.needsUpdate = true; U.needsUpdate = true;
    part.geo.computeVertexNormals();
    part.geo.computeBoundingSphere();
  }
  function update(drink) {
    const ct = Math.cos(drink.tilt), st = Math.sin(drink.tilt), c = drink.level();
    // (The plane's normal is a unit vector: a head h deep is the level less h.)
    const head = parts.some((p) => p.L.foam) ? drink.foam : 0;
    for (const part of parts) {
      const top = part.L.foam ? c : c - head, low = part.L.foam ? c - head : null;
      part.mesh.visible = drink.v > 1e-7 && (!part.L.foam || drink.foam > 0.0005);
      if (part.mesh.visible) fill(part, low, top, ct, st);
    }
  }
  return { group, update, parts };
}

//: The stream over the lip: a tapering tube from the lip down and on to ``to`` (both in the
//: frame it is drawn in), as thick as the flow. Redrawn each frame: set(from, to, flow).
export function createStream(THREE, material) {
  const pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const curve = new THREE.CatmullRomCurve3(pts);
  let geo = new THREE.TubeGeometry(curve, 10, 0.002, 6, false);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "drink-stream"; mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 4;
  function set(from, to, flow, out) {
    // A flow of 30 ml/s from a lip is a sheet a few millimetres thick.
    const width = Math.max(0.0012, Math.min(0.006, Math.sqrt(flow / 6e-5) * 0.0028));
    mesh.visible = flow > 2e-7;
    if (!mesh.visible) return;
    pts[0].copy(from);
    pts[1].copy(from).addScaledVector(out, 0.006).y -= 0.002;
    pts[2].lerpVectors(from, to, 0.6).addScaledVector(out, 0.004).y -= 0.004;
    pts[3].copy(to);
    geo.dispose();
    geo = new THREE.TubeGeometry(curve, 10, width, 6, false);
    // Thinning as it falls (the water speeds up).
    const P = geo.attributes.position, N = 11, R = 7;
    for (let i = 0; i < N; i += 1) {
      const c = curve.getPointAt(i / (N - 1)), f = 1 - 0.45 * (i / (N - 1));
      for (let j = 0; j < R; j += 1) { const k = i * R + j; P.setXYZ(k, c.x + (P.getX(k) - c.x) * f, c.y + (P.getY(k) - c.y) * f, c.z + (P.getZ(k) - c.z) * f); }
    }
    mesh.geometry = geo;
  }
  return { mesh, set };
}
