// ---- one physical visual shell, shared by both sides of every opening ---------------------------
// Canonical footprints/heights are untouched. Only nearby residential walls leave the city
// batch; the original indices are restored verbatim when the detailed shell is retired.
const homeShellGroup = new THREE.Group();
homeShellGroup.name = "home-shells";
root.add(homeShellGroup);
const homeShells = new Set();
// Glass that reads from the street as the batched facade's windows do -- dark panes with a
// little sky in them -- rather than near-clear panes showing the lit rooms, which turned every
// house's windows pale as its shell came into range. From inside it is still a window.
//: A window seen from the street is dark: the room behind it is lit far less than the street.
//: The room here is lit by the same sun as the street, so a half-clear pane showed its white
//: plaster and every window went white. The pane is two faces: dark glass facing out, and a
//: clear one facing in, so the street can still be seen from inside.
const homeGlassMaterial = new THREE.MeshStandardMaterial({ color: 0xe7f0f3,
  transparent: true, opacity: 0.12, depthWrite: false, side: THREE.FrontSide,
  roughness: 0.08, metalness: 0.0, envMapIntensity: 0.4 });
const homeGlassInsideMaterial = new THREE.MeshStandardMaterial({ color: 0xe7f0f3,
  transparent: true, opacity: 0.12, depthWrite: false, side: THREE.FrontSide,
  roughness: 0.1, metalness: 0.0, envMapIntensity: 0.4 });
//: The frames white where nothing measured them (WINDOW_FRAME_DEFAULT), the same as the window
//: pictures, so a house's frames do not change colour when its shell is built.
const homeFrameMaterial = new THREE.MeshStandardMaterial({ color: WINDOW_FRAME_DEFAULT, roughness: 0.8, envMapIntensity: 0.2 });

function wallPanels(width, bottom, top, openings) {
  // A 2D arrangement handles overlapping evidence without bridges across a hole.
  const holes = openings.map((o) => ({ u: Math.max(0, o.u), v: Math.max(bottom, o.v),
    w: Math.min(width, o.u + o.w), h: Math.min(top, o.v + o.h) }))
    .filter((o) => o.w > o.u && o.h > o.v);
  const xs = [...new Set([0, width, ...holes.flatMap((o) => [o.u, o.w])])].sort((a, b) => a - b);
  const ys = [...new Set([bottom, top, ...holes.flatMap((o) => [o.v, o.h])])].sort((a, b) => a - b);
  const panels = [];
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
      if (!holes.some((o) => x > o.u && x < o.w && y > o.v && y < o.h))
        panels.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
    }
  }
  return panels;
}

//: The tallest a house's storey is believed: a one-level record on a nine-metre house is a
//: default, not a nine-metre room.
const HOME_STOREY_MAX_M = 7.0;
//: Where a house's floors divide: the storey height its photograph's fit was held to (or read
//: off its window rows), else its height over its storeys. Its ceilings sit on these lines.
function homeStoreyHeight(entry, height) {
  const storey = frontageFitFor(entry.way)?.storey_constraint;
  const measured = Number(storey?.storey_height_m);
  if (["inferred", "prior_constrained"].includes(storey?.status) && measured >= 2.3
      && measured <= HOME_STOREY_MAX_M && measured <= height) return measured;
  return height / homeStoreyCount(entry, height);
}
function homeStoreyCount(entry, height) {
  const mapped = Number(entry.way.tags?.["building:levels"] || entry.way.levels);
  const fitted = Number(entry.fit?.[9]);
  const photographed = Number(frontageFitFor(entry.way)?.storey_constraint?.storeys);
  const plausible = (n) => Number.isInteger(n) && n > 0 && height / n >= 2.3 && height / n <= HOME_STOREY_MAX_M;
  // The storeys counted on the house's own photograph, then the map's, then the plan's.
  if (plausible(photographed)) return photographed;
  if (plausible(mapped)) return mapped;
  // A default one-storey record is not evidence for a thirty-metre loft.
  if (plausible(fitted)) return fitted;
  return Math.max(1, Math.round(height / 3.2));
}

function regularHomeWindows(length, bottom, top, seed, storeys = null) {
  const rows = storeys || Math.max(1, Math.floor((top - bottom) / 2.8));
  const storey = (top - bottom) / rows;
  const bays = Math.floor((length - 0.5) / 2.6);
  if (!bays || storey < 2.3) return [];
  const pitch = length / bays;
  const width = Math.min(1.45, pitch * (random(seed + 7) < 0.5 ? 0.52 : 0.62));
  const height = Math.min(1.65, storey - 1.1);
  const windows = [];
  for (let r = 0; r < rows; r += 1) {
    for (let b = 0; b < bays; b += 1) windows.push({
      u: (b + 0.5) * pitch - width / 2, v: bottom + r * storey + 0.8,
      w: width, h: height, kind: "window", grade: "procedural_not_measured" });
  }
  return windows;
}

function setBatchedHomeVisible(id, visible) {
  for (const { mesh, start, indices } of BUILDING_VISUAL_RANGES.get(String(id)) || []) {
    const index = mesh.geometry.getIndex();
    if (!index) continue;
    index.array.set(visible ? indices : indices.map(() => indices[0]), start);
    index.needsUpdate = true;
  }
}

//: Each panel of a shell wall overlaps its neighbours by this much, inside the wall's own
//: outline: panels that only met edge to edge could leave hairline cracks.
const HOME_PANEL_OVERLAP_M = 0.012;
//: ``trim`` shortens the wall at both ends, or [at its start, at its end]; a negative one runs
//: it on past that end. The lining stands INTERIOR_WALL_INSET_M inside its wall, so at a corner
//: its full length ran out to the neighbouring wall's face and showed through it from the
//: street as a dotted line down the corner (liningMitre gives where it meets the next lining).
//: ``uvMap`` (u along the wall, v height) -> [s, t]; three-metre tiles when there is none.
function homeWallGeometry(a, ux, uz, panels, insetX = 0, insetZ = 0, trim = 0, uvMap = null) {
  const positions = [], uv = [];
  const e = HOME_PANEL_OVERLAP_M;
  const [trimStart, trimEnd] = Array.isArray(trim) ? trim : [trim, trim];
  const lo = Math.min(...panels.map((p) => p[0])), hi = Math.max(...panels.map((p) => p[2]));
  if (trimStart < 0 || trimEnd < 0) panels = panels.map(([p0, q0, p1, q1]) => [
    trimStart < 0 && p0 <= lo + 1e-6 ? lo + trimStart : p0, q0, trimEnd < 0 && p1 >= hi - 1e-6 ? hi - trimEnd : p1, q1]);
  const uMin = lo + trimStart, uMax = hi - trimEnd;
  const vMin = Math.min(...panels.map((p) => p[1])), vMax = Math.max(...panels.map((p) => p[3]));
  for (const [p0, q0, p1, q1] of panels) {
    const u0 = Math.max(uMin, p0 - e), v0 = Math.max(vMin, q0 - e);
    const u1 = Math.min(uMax, p1 + e), v1 = Math.min(vMax, q1 + e);
    if (u1 <= u0 || v1 <= v0) continue;
    for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]]) {
      positions.push(a[0] + ux * u + insetX, v, a[1] + uz * u + insetZ);
      if (uvMap) uv.push(...uvMap(u, v)); else uv.push(u / 3, v / 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function batchHomeShell(group) {
  const buckets = new Map();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || !mesh.geometry) continue;
    mesh.updateMatrix();
    mesh.geometry.applyMatrix4(mesh.matrix);
    if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
    buckets.get(mesh.material).push(mesh.geometry);
    group.remove(mesh);
  }
  for (const [material, pieces] of buckets) {
    const geometry = mergeParts(pieces);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

//: Whether a photographed facade hangs on the footprint edge from a to b ([x, z] pairs).
function photographedEdge(a, b) {
  if (!FACADE_PHOTOS) return false;
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
  const cx = Math.floor(mx / FACADE_CELL_M), cz = Math.floor(mz / FACADE_CELL_M);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const wall of facadeGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        const [ax, ay] = xy(wall.a[0], wall.a[1]), [bx, by] = xy(wall.b[0], wall.b[1]);
        const wl = Math.hypot(bx - ax, by - ay) || 1;
        const parallel = Math.abs(((bx - ax) * ux + (-(by - ay)) * uz) / wl) > 0.95;
        // The photograph's middle lies on this edge's line, within its length.
        const off = Math.abs((wall._x - a[0]) * -uz + (wall._z - a[1]) * ux);
        const along = (wall._x - a[0]) * ux + (wall._z - a[1]) * uz;
        if (parallel && off < 1.0 && along > -0.5 && along < len + 0.5) return true;
      }
    }
  }
  return false;
}
//: A footprint ring (open, [x, z] points) moved ``d`` inward, corner by corner along the two
//: edges' inward normals (mitred, the mitre capped at a sharp corner).
//: Where the lining of edge i of a footprint, set ``inset`` inside it, meets the linings of the
//: walls either side: [metres short of the edge's start, metres short of its end] -- positive at
//: an outside corner, negative at an inside one. Cut at the corner, the linings met at an
//: outside corner but stood apart at an inside one (an L-shaped or stepped house), and left an
//: open shaft down the room's corner to the outer wall and the neighbour's party wall beyond it.
function liningMitre(entry, i, inset) {
  const ring = entry.local, n = ring.length - 1;
  const edge = (k) => {
    for (let step = 0; step < n; step += 1) {
      const m = ((k % n) + n) % n;
      const [ax, az] = ring[m], [bx, bz] = ring[m + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len > 1e-6) {
        const tx = (bx - ax) / len, tz = (bz - az) / len;
        let nx = -tz, nz = tx;
        if (!insideFootprint(entry, (ax + bx) / 2 + nx * 0.05, (az + bz) / 2 + nz * 0.05)) { nx = -nx; nz = -nz; }
        return { ax, az, tx, tz, nx, nz, len };
      }
      k += k < i ? -1 : 1;
    }
    return null;
  };
  const self = edge(i);
  if (!self || n < 3) return [0, 0];
  // Along this edge's inset line, where it crosses the other's: u from this edge's start.
  const meet = (other) => {
    const along = other ? self.tx * other.nx + self.tz * other.nz : 0;
    if (Math.abs(along) < 0.2) return null;
    const px = self.ax + self.nx * inset - other.ax, pz = self.az + self.nz * inset - other.az;
    return (inset - (px * other.nx + pz * other.nz)) / along;
  };
  const start = meet(edge(i - 1)), end = meet(edge(i + 1));
  const limit = Math.min(0.3, self.len / 2);
  const clamp = (v) => Math.max(-0.3, Math.min(limit, v));
  return [start === null ? 0 : clamp(start), end === null ? 0 : clamp(self.len - end)];
}

function insetRing(entry, pts, d) {
  const n = pts.length;
  if (n < 3) return pts;
  const normals = [];
  for (let i = 0; i < n; i += 1) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    let nx = -(bz - az) / len, nz = (bx - ax) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (!insideFootprint(entry, mx + nx * 0.05, mz + nz * 0.05)) { nx = -nx; nz = -nz; }
    normals.push([nx, nz]);
  }
  return pts.map(([x, z], i) => {
    const [n1x, n1z] = normals[(i - 1 + n) % n], [n2x, n2z] = normals[i];
    const k = d / Math.max(0.35, 1 + n1x * n2x + n1z * n2z);
    return [x + (n1x + n2x) * k, z + (n1z + n2z) * k];
  });
}
//: A house whose ground rises more than this across its footprint stands into its hill.
const HILLSIDE_RISE_M = 1.2;
//: A window's sill stands at least this far above the ground outside it. No window touches the
//: ground: on a hill the low end of a wall is in the slope, and a guessed window there, or a
//: photographed one carried onto ground the model has higher than the photograph did, was a
//: pane half under the pavement.
const WINDOW_GROUND_CLEAR_M = 0.45;
//: The picture of the front door on the street wall (addGroundFacadeDetail) is this wide.
const FRONT_DOOR_PANEL_W_M = 3.2;
//: The windows of a house, wall by wall. One answer for the house as the street sees it (its
//: window decals, drawn from far off) and for the house the walker is at (its shell, with real
//: glass and the rooms behind it), so the one never changes into the other on screen. It depends
//: only on what is known before anyone walks up: the footprint, the doors (each reserving its
//: opening with room for a stoop), the garages, the photographed openings, the ground.
function frontageWindowsOnEdge(entry, a, b, length, bottom) {
  const fit = frontageFitFor(entry.way);
  if (!fit || !fit.a || !fit.b || ![...fit.a,...fit.b].every(Number.isFinite)) return null;
  const [ax, ay] = xy(...fit.a), [bx, by] = xy(...fit.b);
  const f = [ax, -ay], g = [bx, -by], span = Math.hypot(g[0]-f[0], g[1]-f[1]);
  if (span < .2) return null;
  const tx = (g[0]-f[0])/span, tz = (g[1]-f[1])/span;
  const out=frontageNormalFor(fit);if(!out)return null;
  const ex = (b[0]-a[0])/length, ez = (b[1]-a[1])/length;
  const aligned = ex*tx + ez*tz;
  const normalError = Math.max(Math.abs((a[0]-f[0])*-tz+(a[1]-f[1])*tx),
    Math.abs((b[0]-f[0])*-tz+(b[1]-f[1])*tx));
  // Existing bay returns are real parts of the front, not party walls. Only a
  // footprint-validated outward-facing edge can use the wider return envelope.
  const ring=entry.local;
  const signed=Array.isArray(ring) && ring.length>=4 ? ring.reduce((sum,p,i)=>{
    const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];
  },0) : 0;
  const canonicalFace=Number.isFinite(signed) && Math.abs(signed)>.01;
  if(canonicalFace) {
    const outward=signed>0 ? [ez,-ex] : [-ez,ex];
    const facing=outward[0]*out[0]+outward[1]*out[1];
    if(facing<.25 || normalError>1.3)return null;
  } else if (Math.abs(aligned) < .96 || normalError > .8) return null;
  const start = (a[0]-f[0])*tx+(a[1]-f[1])*tz;
  const end = start + length*aligned;
  if (Math.max(start,end) < -.1 || Math.min(start,end) > span+.1) return null;
  // Every rectangle the fit called a window, panes read or not (coarse_openings.py): above the
  // ground storey an outline is a window.
  return (fit.openings || []).filter(o=>(o.role || o.kind) === "window" && [o.u,o.v,o.w,o.h].every(Number.isFinite)
    && o.w > 0 && o.h > 0 && o.v>=0
    && (!Number.isFinite(fit.height_m) || o.v+o.h<=fit.height_m-.1)).map(o => ({ ...o,
    u: aligned > 0 ? (o.u-start)/aligned : (o.u+o.w-start)/aligned,
    design: o.design && { ...o.design, vertical_bars: (o.design.vertical_bars || []).map(t=>aligned > 0 ? t : 1-t) },
    w: o.w/Math.abs(aligned), v: bottom+o.v, grade: "image_on_prior_geometry" }))
    .flatMap(o=>{
      if(!canonicalFace)return o.u>=.08 && o.u+o.w<=length-.08 ? [o] : [];
      const left=Math.max(0,o.u),right=Math.min(length,o.u+o.w);
      if(right-left<.03)return [];
      const fullLeft=Math.abs(left-o.u)<.001,fullRight=Math.abs(right-o.u-o.w)<.001;
      return [{...o,u:left,w:right-left,frameLeft:fullLeft,frameRight:fullRight,
        sourceOpeningId:o.id,projectionBasis:"photo_on_existing_canonical_front_surface",
        design:o.design && {...o.design,vertical_bars:(o.design.vertical_bars || [])
          .map(t=>(o.u+o.w*t-left)/(right-left)).filter(t=>t>0 && t<1)}}];
    });
}

function homeWindowLayout(entry, spec) {
  if (entry.way.parkFacility || entry.way._structure) return [];
  const id = String(entry.way.osm_id);
  const bottom = spec.base, top = bottom + spec.height, floor = entryFloorY(entry);
  if (top - floor < 2.3) return null;
  // How steep the ground is under the house: the rise across its footprint's corners.
  let lowest = Infinity, highest = -Infinity;
  for (const [px, pz] of entry.local) {
    const g = terrainGroundAt(px, pz);
    lowest = Math.min(lowest, g); highest = Math.max(highest, g);
  }
  const hillside = highest - lowest > HILLSIDE_RISE_M;
  const storeys = homeStoreyCount(entry, top - floor);
  const groundStoreyM = (top - floor) / Math.max(1, storeys);
  const front = entry.way._frontDoor;
  const edges = [];
  for (let edge = 0; edge + 1 < entry.local.length; edge += 1) {
    const a = entry.local[edge], b = entry.local[edge + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.2) continue;
    const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
    let nx = -uz, nz = ux;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (!insideFootprint(entry, mx + nx * 0.2, mz + nz * 0.2)) { nx = -nx; nz = -nz; }
    // Every door on this edge reserves its opening from the ground to above the door -- with
    // room either side for a stoop's walls -- and so does every garage the city's kerb cuts put
    // on it, and the front door's picture: a window never overlaps any of them.
    const reserved = [];
    for (const d of (entry.doors || []).filter((d) => d.edge === edge)) {
      const w = Math.max(d.width + 0.9, 1.9);
      reserved.push({ u: (d.t0 + d.t1) / 2 * length - w / 2, w, v: bottom,
        h: floor - bottom + DOOR_HEIGHT_M + 0.3, kind: "door" });
    }
    if (front) {
      const off = (front.x - a[0]) * nx + (front.z - a[1]) * nz;
      const u = (front.x - a[0]) * ux + (front.z - a[1]) * uz;
      if (Math.abs(off) < 0.6 && u > -0.5 && u < length + 0.5) {
        reserved.push({ u: u - FRONT_DOOR_PANEL_W_M / 2, w: FRONT_DOOR_PANEL_W_M, v: bottom,
          h: Math.max(3.35, floor - bottom + DOOR_HEIGHT_M + 0.3), kind: "door" });
      }
    }
    for (const g of entry.way.garages || []) {
      const [gax, gay] = xy(g.a[0], g.a[1]), [gbx, gby] = xy(g.b[0], g.b[1]);
      const gx = gax + (gbx - gax) * g.t, gz = -(gay + (gby - gay) * g.t);
      const off = (gx - a[0]) * nx + (gz - a[1]) * nz;
      const u = (gx - a[0]) * ux + (gz - a[1]) * uz;
      if (Math.abs(off) > 1.0 || u < -0.5 || u > length + 0.5) continue;
      const w = Math.min(g.w || 2.6, length);
      reserved.push({ u: u - w / 2, w, v: bottom, h: (Number.isFinite(g.h) ? g.h : GARAGE_HEIGHT_M) + 0.2, kind: "garage" });
    }
    // A wall a person edited carries their windows (docs/exterior-editor.mjs), drawn over it.
    if (editedEdge(entry.way, a, b)) { edges.push({ edge, a, b, length, ux, uz, nx, nz, windows: [] }); continue; }
    const observed = HOME_OPENINGS.buildings[id]?.walls[String(edge)];
    // A wall that wears its own photograph shows its own windows: none is added there, or its
    // frame stands out through the picture of the real one.
    const photographed = photographedEdge(a, b);
    const fitted = frontageWindowsOnEdge(entry, a, b, length, bottom);
    const candidates = fitted || (observed ? observed.map(([u, v, w, h, confidence]) => ({
      u, v: bottom + v, w, h, confidence, kind: "window", grade: "image_on_prior_geometry" }))
      : regularHomeWindows(length, floor, top, spec.seed + edge * 59, storeys));
    const groundOut = (u) => terrainGroundAt(a[0] + ux * u - nx * 0.3, a[1] + uz * u - nz * 0.3);
    const windows = photographed ? [] : candidates.filter((o) => o.v >= floor + 0.15 && o.v + o.h <= top - 0.15
      && !reserved.some((c) => o.u < c.u + c.w + 0.15 && o.u + o.w > c.u - 0.15
        && o.v < c.v + c.h + 0.15 && o.v + o.h > c.v - 0.15)
      // No window touches the ground, at either end of its sill.
      && o.v >= Math.max(groundOut(o.u), groundOut(o.u + o.w)) + WINDOW_GROUND_CLEAR_M
      // A house on a steep hill is partly in the hill on its ground storey: no window is
      // guessed there; only a window measured in a photograph stands on that storey.
      && !(hillside && o.grade !== "image_on_prior_geometry" && o.v < floor + groundStoreyM)
      && [0.2, 0.5, 0.8].every((t) => {
        const neighbour = buildingAt(a[0] + ux * (o.u + o.w * t) - nx * 0.15,
          a[1] + uz * (o.u + o.w * t) - nz * 0.15);
        return !neighbour || String(neighbour.osm_id) === id;
      }));
    edges.push({ edge, a, b, length, ux, uz, nx, nz, windows });
  }
  return { bottom, top, floor, edges };
}

// Clear, neutral glazing in both directions. Interior pixels in a photograph are not glass
// colour or permanent architecture: curtains/blinds do not become painted window panes.
function shellGlassOpacity(distance) {
  return 0.12; // Clear glass from either side; photographed curtains/blinds are not glass.
}

function homeWindowArchSpring(o) {
  const s=o.design?.arch_spring_fraction;
  return o.design?.shape==="arched" && Number.isFinite(s) && s>=.35 && s<=.85
    && o.frameLeft!==false && o.frameRight!==false ? s : null;
}
function homeWindowCrown(o,t) {
  const spring=homeWindowArchSpring(o);
  return spring===null ? o.h : o.h*(spring+(1-spring)*Math.sqrt(Math.max(0,1-(2*t-1)**2)));
}
function homeWindowShape(o,inset=0) {
  const shape=new THREE.Shape(),w=o.w-2*inset,h=o.h-2*inset;
  shape.moveTo(inset,inset);shape.lineTo(o.w-inset,inset);
  const spring=homeWindowArchSpring(o);
  if(spring===null) {shape.lineTo(o.w-inset,o.h-inset);shape.lineTo(inset,o.h-inset);}
  else for(let i=0;i<=32;i++) {
    const t=1-i/32;shape.lineTo(inset+w*t,inset+h*(spring+(1-spring)*Math.sqrt(Math.max(0,1-(2*t-1)**2))));
  }
  shape.closePath();return shape;
}
function homeWindowPaneGeometry(o) {
  if(homeWindowArchSpring(o)===null)return new THREE.PlaneGeometry(o.w,o.h);
  const geometry=new THREE.ShapeGeometry(homeWindowShape(o));
  geometry.translate(-o.w/2,-o.h/2,0);return geometry;
}
function homeWindowArchCorners(a,ux,uz,o,uvMap,inset=0) {
  const position=[],uv=[];
  for(let i=0;i<32;i++) {
    const x0=o.u+o.w*i/32,x1=o.u+o.w*(i+1)/32,
      y0=o.v+homeWindowCrown(o,i/32),y1=o.v+homeWindowCrown(o,(i+1)/32),top=o.v+o.h;
    for(const [u,v] of [[x0,y0],[x1,y1],[x1,top],[x0,y0],[x1,top],[x0,top]]) {
      position.push(a[0]+ux*u-uz*inset,v,a[1]+uz*u+ux*inset);uv.push(...uvMap(u,v));
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;
}
function updateShellGlass() {
  for (const entry of homeShells) {
    const glass = entry.homeShell?.glass;
    if (!glass) continue;
    const d = Math.hypot((entry.minX + entry.maxX) / 2 - camera.position.x,
      (entry.minZ + entry.maxZ) / 2 - camera.position.z);
    for(const material of entry.homeShell.glasses || [glass]) material.opacity = shellGlassOpacity(d);
  }
}

function frontageOutcropsOnEdge(entry,a,b,length,bottom) {
  const fit=frontageFitFor(entry.way);if(!fit?.a || !fit?.b)return [];
  const [fx,fy]=xy(...fit.a),[gx,gy]=xy(...fit.b),dx=gx-fx,dz=fy-gy,L=Math.hypot(dx,dz);
  if(L<.2)return [];const tx=dx/L,tz=dz/L,ex=(b[0]-a[0])/length,ez=(b[1]-a[1])/length,alignment=ex*tx+ez*tz;
  // A residual is relative to this exact wall, not an already offset bay face.
  if(Math.abs(alignment)<.96 || Math.max(Math.abs((a[0]-fx)*-tz+(a[1]+fy)*tx),Math.abs((b[0]-fx)*-tz+(b[1]+fy)*tx))>.05)return [];
  const start=(a[0]-fx)*tx+(a[1]+fy)*tz;
  return (fit.outcrops || []).filter(o=>o.render && !o.canonical_relief_overlap && o.property_sha256 && o.property_source
    && [o.u,o.v,o.w,o.h,o.depth_m].every(Number.isFinite) && o.depth_m>0 && o.depth_m<=1.2
    && o.v>=0 && o.v+o.h<=fit.height_m-.04 && Array.isArray(o.profile)
    && o.profile.every(p=>p.length===2 && p.every(Number.isFinite) && p[0]>=o.u-.001 && p[0]<=o.u+o.w+.001 && p[1]>=0 && p[1]<=o.depth_m+.001))
    .map(o=>({...o,u:alignment>0 ? (o.u-start)/alignment : (o.u+o.w-start)/alignment,
      w:o.w/Math.abs(alignment),v:bottom+o.v,profile:o.profile.map(p=>[(p[0]-start)/alignment,p[1]]).sort((p,q)=>p[0]-q[0])}))
    .filter(o=>o.u>=0 && o.u+o.w<=length && !(
      Array.isArray(entry.local) && entry.local.some((p,i)=>{
        const q=entry.local[(i+1)%entry.local.length];
        const u0=(p[0]-fx)*tx+(p[1]+fy)*tz,u1=(q[0]-fx)*tx+(q[1]+fy)*tz;
        if(Math.abs(u1-u0)<.03)return false; // perpendicular party-wall edge
        const limits=[start+o.u*alignment,start+(o.u+o.w)*alignment];
        const left=Math.max(Math.min(...limits),Math.min(u0,u1)),right=Math.min(Math.max(...limits),Math.max(u0,u1));
        if(right-left<.03)return false;
        const n0=(p[0]-fx)*-tz+(p[1]+fy)*tx,n1=(q[0]-fx)*-tz+(q[1]+fy)*tx;
        const depths=[left,right].map(u=>n0+(u-u0)/(u1-u0)*(n1-n0));
        return Math.max(...depths)>=-1.3 && Math.min(...depths)<=1.3 && depths.some(n=>Math.abs(n)>.05);
      })
    ));
}

function homeOutcropSurfaces(a,ux,uz,nx,nz,bays,windows) {
  const surfaces=[],caps=[],used=new Set();
  for(const bay of bays) {
    const accepted=windows.filter(o=>o.u>=bay.u-.02 && o.u+o.w<=bay.u+bay.w+.02 && o.v>=bay.v && o.v+o.h<=bay.v+bay.h);
    accepted.forEach(o=>used.add(o));
    const plan=bay.profile.map(([u,n])=>[a[0]+ux*u-nx*n,a[1]+uz*u-nz*n]);
    caps.push({plan,bottom:bay.v,top:bay.v+bay.h,id:bay.id});
    for(let i=0;i+1<plan.length;i++) {
      const u0=bay.profile[i][0],u1=bay.profile[i+1][0],p=plan[i],q=plan[i+1],L=Math.hypot(q[0]-p[0],q[1]-p[1]);
      if(L<.001)continue;const sx=(q[0]-p[0])/L,sz=(q[1]-p[1])/L,sign=(-uz*nx+ux*nz)>=0 ? 1 : -1;
      const openings=accepted.flatMap(o=>{const left=Math.max(o.u,u0),right=Math.min(o.u+o.w,u1);
        if(right<=left || u1-u0<.001)return [];const scale=L/(u1-u0),w=(right-left)*scale;
        return [{...o,u:(left-u0)*scale,w,outcropId:bay.id,frameLeft:Math.abs(left-o.u)<.001,frameRight:Math.abs(right-o.u-o.w)<.001,design:o.design && {...o.design,
          vertical_bars:(o.design.vertical_bars || []).map(t=>(o.u+o.w*t-left)/(right-left)).filter(t=>t>0 && t<1)}}];});
      surfaces.push({a:p,length:L,ux:sx,uz:sz,nx:-sz*sign,nz:sx*sign,windows:openings,
        panels:wallPanels(L,bay.v,bay.v+bay.h,openings)});
    }
  }
  return {surfaces,caps,flatWindows:windows.filter(o=>!used.has(o))};
}

function homeOutcropCapGeometry(plan,y) {
  const shape=new THREE.Shape(plan.map(p=>new THREE.Vector2(p[0],p[1]))),geometry=new THREE.ShapeGeometry(shape);
  const position=geometry.getAttribute("position");
  for(let i=0;i<position.count;i++)position.setXYZ(i,position.getX(i),y,position.getY(i));
  geometry.computeVertexNormals();return geometry;
}

function buildHomeShell(entry) {
  const id = String(entry.way.osm_id), spec = HOME_RENDER.get(id);
  if (!spec || entry.homeShell || !entry.fit || !BUILDING_VISUAL_RANGES.has(id)) return;
  if(entryTunnelConflict(entry))return;
  // The windows the street is already shown, where they are drawn; otherwise worked out now.
  const laidOut = entry.decalLayout || homeWindowLayout(entry, spec);
  if (!laidOut) return;
  // In the headset too: a house with only its door read as a block of colour, and changed to
  // one with its windows each time it was rebuilt from a distance.
  const layout = laidOut;
  const { bottom, top, floor } = layout;
  // The same wall as the batched one it replaces: the same texture, mapped from the same end of
  // each wall at the same scale (FACADE_UV), and the same response to light -- including how
  // much of the sky it reflects. Any of these different and the house visibly changed the
  // moment its shell was built.
  const storeyM = facadeStoreyMetres(spec.height);
  const material = new THREE.MeshStandardMaterial({ map: bareFacadeTextureFor(spec.material, spec.seed),
    color: spec.tint, roughness: spec.material.rough, metalness: spec.material.metal,
    envMapIntensity: spec.material.name === "glass" ? 1.6 : spec.material.name === "metal" ? 1.1 : 0.35,
    side: THREE.DoubleSide });
  const group = new THREE.Group();
  group.name = `house-shell:${id}`;
  // This shell's own copies of the shared lining, glass and frame materials, disposed with it.
  const shellPlaster = plasterMaterial.clone();
  // The inside of the outside walls in the house's own paint, not plaster white.
  shellPlaster.color.setHex(WALL_PAINTS[roomPaint(Math.abs(Number(entry.way.osm_id) || 0), 99)]);
  const shellGlass = homeGlassMaterial.clone();
  const shellGlassInside = homeGlassInsideMaterial.clone();
  const shellFrame = homeFrameMaterial.clone();
  const bands=spec.appearanceBands || [{material:spec.material,tint:spec.tint,bottom:0,top:spec.height}];
  const bandMaterials=bands.map(b=>b.frontBasis ? new THREE.MeshStandardMaterial({
    map:bareFacadeTextureFor(b.material,spec.seed),color:b.tint,roughness:b.material.rough,metalness:b.material.metal,
    envMapIntensity:b.material.name==="glass" ? 1.6 : b.material.name==="metal" ? 1.1 : .35,side:THREE.DoubleSide}) : material);
  const trimMaterials=new Map();
  // As the decal reads until updateShellGlass sets it for the camera, the next frame.
  shellGlass.opacity = shellGlassOpacity(Infinity);
  const windowRegistry = [];
  // Each outside wall's inner face as laid -- its panels, with the doors and windows cut out --
  // for the rooms to paint (buildInterior).
  const liningFaces = [];
  for (const { edge, a, length, ux, uz, nx, nz, windows } of layout.edges) {
    const bays=frontageOutcropsOnEdge(entry,a,[a[0]+ux*length,a[1]+uz*length],length,bottom);
    const projected=homeOutcropSurfaces(a,ux,uz,nx,nz,bays,windows);
    const doors = (entry.doors || []).filter((d) => d.edge === edge && d.mesh && !d.atGrade);
    const cuts = doors.map((d) => ({ u: (d.t0 + d.t1) / 2 * length - (d.stoopPlan?.width || d.width) / 2,
      w: d.stoopPlan?.width || d.width,
      v: d.stoopPlan ? d.stoopPlan.street : floor, h: DOOR_HEIGHT_M + (d.stoopPlan?.rise || 0),
      kind: "door" }));
    const uvMap = (u, v) => [(spec.clockwise ? length - u : u) / BAY_M, (v - bottom) / storeyM];
    const panels = wallPanels(length, bottom, top, [...cuts, ...windows, ...bays]);
    for(let i=0;i<bands.length;i++) {
      const low=bottom+bands[i].bottom, high=bottom+bands[i].top;
      const bandPanels=panels.map(([x0,y0,x1,y1])=>[x0,Math.max(y0,low),x1,Math.min(y1,high)]).filter(p=>p[3]>p[1]);
      if(!bandPanels.length) continue;
      const wall = new THREE.Mesh(homeWallGeometry(a, ux, uz, bandPanels, 0, 0, 0, uvMap), bandMaterials[i]);
      wall.castShadow = wall.receiveShadow = true;
      group.add(wall);
    }
    const lining = new THREE.Mesh(homeWallGeometry(a, ux, uz, panels,
      nx * INTERIOR_WALL_INSET_M, nz * INTERIOR_WALL_INSET_M, liningMitre(entry, edge, INTERIOR_WALL_INSET_M)), shellPlaster);
    group.add(lining);
    liningFaces.push({ edge, a, length, ux, uz, nx, nz, panels });
    for(const surface of projected.surfaces) {
      for(let i=0;i<bands.length;i++) {
        const bandPanels=surface.panels.map(([x0,y0,x1,y1])=>[x0,Math.max(y0,bottom+bands[i].bottom),x1,Math.min(y1,bottom+bands[i].top)]).filter(p=>p[3]>p[1]);
        if(bandPanels.length)group.add(new THREE.Mesh(homeWallGeometry(surface.a,surface.ux,surface.uz,bandPanels),bandMaterials[i]));
      }
      if(surface.panels.length) {
        group.add(new THREE.Mesh(homeWallGeometry(surface.a,surface.ux,surface.uz,surface.panels,surface.nx*.04,surface.nz*.04),shellPlaster));
        liningFaces.push({ edge: null, a: surface.a, length: Math.max(...surface.panels.map((q) => q[2])),
          ux: surface.ux, uz: surface.uz, nx: surface.nx, nz: surface.nz, panels: surface.panels, inset: .04 });
      }
    }
    // A bay's floor and ceiling: the facade underneath and on top, and from inside the bay the
    // lining -- the facade's own paint was what showed, looking down into a bay window.
    for(const cap of projected.caps)for(const [y,inside] of [[cap.bottom,.02],[cap.top,-.02]]) {
      group.add(new THREE.Mesh(homeOutcropCapGeometry(cap.plan,y),material));
      group.add(new THREE.Mesh(homeOutcropCapGeometry(cap.plan,y+inside),shellPlaster));
    }
    for(const surface of [{a,ux,uz,nx,nz,windows:projected.flatWindows},...projected.surfaces]) {
    const {a,ux,uz,nx,nz}=surface;
    for (const o of surface.windows) {
      const arch=homeWindowArchSpring(o)!==null;
      if(arch) {
        const uvMap=(u,v)=>[(spec.clockwise ? length-u : u)/BAY_M,(v-bottom)/storeyM];
        const corners=homeWindowArchCorners(a,ux,uz,o,uvMap);
        const indices=Array.from({length:corners.getAttribute("position").count},(_,i)=>i);
        for(let i=0;i<bands.length;i++) {
          const geometry=clipFacadeBand(corners,indices,bottom+bands[i].bottom,bottom+bands[i].top);
          group.add(new THREE.Mesh(geometry,bandMaterials[i]));
        }
        corners.dispose();
        group.add(new THREE.Mesh(homeWindowArchCorners(a,ux,uz,o,uvMap,INTERIOR_WALL_INSET_M+.01),shellPlaster));
      }
      const trimColour=/^#[0-9a-f]{6}$/i.test(o.design?.trim?.colour || "") ? o.design.trim.colour : null;
      if(trimColour && !trimMaterials.has(trimColour)) {
        const m=homeFrameMaterial.clone();m.color.set(trimColour);trimMaterials.set(trimColour,m);
      }
      const frameMaterial=trimColour ? trimMaterials.get(trimColour) : shellFrame;
      const glassPair={outer:shellGlass,inner:shellGlassInside};
      // The outer face looks out of the house (n points in), the inner one in.
      const pane = new THREE.Mesh(homeWindowPaneGeometry(o), glassPair.outer);
      pane.position.set(a[0] + ux * (o.u + o.w / 2) + nx * 0.025,
        o.v + o.h / 2, a[1] + uz * (o.u + o.w / 2) + nz * 0.025);
      pane.rotation.y = Math.atan2(-nx, -nz);
      pane.userData = { surface: "window", canonicalBuilding: id, edge, ...o };
      group.add(pane);
      // Its own geometry: batchHomeShell bakes each mesh's matrix into its geometry.
      const inner = new THREE.Mesh(pane.geometry.clone(), glassPair.inner);
      inner.position.copy(pane.position);
      inner.rotation.y = pane.rotation.y + Math.PI;
      group.add(inner);
      windowRegistry.push(pane.userData);
      const divisions = o.design ? [
        ...(o.design.vertical_bars || []).map(t=>{const h=homeWindowCrown(o,t);return [o.u+o.w*t,o.v+h/2,.035,h];}),
        ...(o.design.horizontal_bars || []).map(t=>{
          const spring=homeWindowArchSpring(o),y=o.h*(1-t),half=spring===null || y<=o.h*spring ? o.w/2
            : o.w/2*Math.sqrt(Math.max(0,1-((y-o.h*spring)/(o.h*(1-spring)))**2));
          return [o.u+o.w/2,o.v+y,half*2,.035];})]
        : [[o.u+o.w/2,o.v+o.h/2,.035,o.h]];
      if(arch) {
        const shape=homeWindowShape(o);shape.holes.push(homeWindowShape(o,.06));
        const geometry=new THREE.ExtrudeGeometry(shape,{depth:.05,bevelEnabled:false});geometry.translate(-o.w/2,-o.h/2,-.025);
        const frame=new THREE.Mesh(geometry,frameMaterial);frame.position.copy(pane.position);frame.rotation.copy(pane.rotation);group.add(frame);
      }
      const perimeter=arch ? [] : [...(o.frameLeft===false ? [] : [[o.u, o.v + o.h / 2, 0.06, o.h]]),
        ...(o.frameRight===false ? [] : [[o.u + o.w, o.v + o.h / 2, 0.06, o.h]]), [o.u + o.w / 2, o.v, o.w, 0.06],
        [o.u + o.w / 2, o.v + o.h, o.w, 0.06]];
      for (const [u, v, w, h] of [...perimeter, ...divisions]) {
        // Shallow, so its lit edges do not stand out from the decal's flat frame.
        const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameMaterial);
        frame.position.set(a[0] + ux * u, v, a[1] + uz * u);
        frame.rotation.y = pane.rotation.y;
        group.add(frame);
      }
    }
    }
    for (const d of doors.filter((d) => d.stoopPlan)) {
      const half = d.stoopPlan.width / 2, depth = d.stoopPlan.depth;
      const sides = [-1, 1].map((s) => [d.cx + ux * half * s, d.cz + uz * half * s,
        d.cx + ux * half * s + nx * depth, d.cz + uz * half * s + nz * depth]);
      group.add(new THREE.Mesh(wallQuads(sides, d.stoopPlan.street,
        floor + DOOR_HEIGHT_M - d.stoopPlan.street), shellPlaster));
      const jambs = [[-half, -d.width / 2], [d.width / 2, half]].map(([a, b]) => [
        d.cx + ux * a + nx * depth, d.cz + uz * a + nz * depth,
        d.cx + ux * b + nx * depth, d.cz + uz * b + nz * depth]);
      group.add(new THREE.Mesh(wallQuads(jambs, floor, DOOR_HEIGHT_M), shellPlaster));
      // And its ceiling: looking up into a stairwell or an alcove sees its soffit, not the rooms.
      const top = floor + DOOR_HEIGHT_M;
      const corners = [[-half, 0], [half, 0], [half, depth], [-half, depth]]
        .map(([along, inward]) => [d.cx + ux * along + nx * inward, top, d.cz + uz * along + nz * inward]);
      const soffit = new THREE.BufferGeometry();
      soffit.setAttribute("position", new THREE.Float32BufferAttribute(corners.flat(), 3));
      soffit.setIndex([0, 1, 2, 0, 2, 3]);
      soffit.computeVertexNormals();
      group.add(new THREE.Mesh(soffit, shellPlaster));
    }
  }
  group.userData = { grade: "visual_detail_not_measured", windows: windowRegistry };
  batchHomeShell(group);
  homeShellGroup.add(group);
  // (The layout it was laid out from, which the decal pass compares against, not the headset's copy.)
  entry.homeShell = { group, material, glass: shellGlass, layout: laidOut, liningFaces,
    glasses: [shellGlass],
    materials: [...new Set([material, shellPlaster, shellGlass, shellGlassInside, shellFrame,...bandMaterials,...trimMaterials.values()])] };
  entry.shellNeedsRebuild = false;
  homeShells.add(entry);
  setBatchedHomeVisible(id, false);
  setHomeDecalsVisible(id, false);
  if (entry.interior) removeInterior(entry);
  buildInterior(entry);
  for (const d of entry.doors || []) if (d.leaf) d.leaf.renderOrder = 0;
}

function removeHomeShell(entry) {
  if (!entry.homeShell) return;
  setBatchedHomeVisible(entry.way.osm_id, true);
  setHomeDecalsVisible(String(entry.way.osm_id), true);
  homeShellGroup.remove(entry.homeShell.group);
  entry.homeShell.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  for (const m of entry.homeShell.materials || [entry.homeShell.material]) m.dispose();
  entry.homeShell = null;
  homeShells.delete(entry);
  removeInterior(entry);
}

let homeShellTick = 0;
//: A house's shell -- its walls cut round real openings, glass in its windows, its rooms behind
//: them -- stands for the houses near the walker, so the walker passing can see into their
//: windows. It is built on the window decals the street already shows (homeWindowLayout): the
//: same walls, the same windows in the same places, and glass that reads as the decal does from
//: further than SHELL_GLASS_DECAL_M and clears only close to. Nothing about a house changes
//: on screen when its shell is built or taken down.
const HOME_SHELL_REACH_M = 40.0;
const HOME_SHELL_MAX = 8;
function updateHomeShells(x, z) {
  if (!INTERIORS || ++homeShellTick % 15) return;
  const candidates = [...new Set(doorsNear(x, z, HOME_SHELL_REACH_M).map((d) => d.entry))]
    // Only on decals already drawn: a shell is never the first the street sees of a house.
    .filter((e) => HOME_RENDER.has(String(e.way.osm_id)) && e.decalLayout)
    .sort((a, b) => Math.hypot((a.minX + a.maxX) / 2 - x, (a.minZ + a.maxZ) / 2 - z)
      - Math.hypot((b.minX + b.maxX) / 2 - x, (b.minZ + b.maxZ) / 2 - z));
  const inside = buildingAt(x, z);
  const occupied = inside && footprintById.get(String(inside.osm_id));
  if (occupied && !candidates.includes(occupied)) candidates.unshift(occupied);
  const wanted = new Set(candidates.slice(0, HOME_SHELL_MAX));
  // A shell is redone when the decals are: a photographed window or a door arrived since.
  for (const e of homeShells) if (!wanted.has(e) || e.shellNeedsRebuild
      || (e.decalLayout && e.homeShell.layout !== e.decalLayout)) removeHomeShell(e);
  for (const e of wanted) buildHomeShell(e);
  // A house's photographs stay on it while its shell stands: hiding them whenever the walker
  // came within a shell's reach made the photograph vanish on approach and pop back on leaving.
  // The panel faces the street and is culled from inside, and the doors stand in front of it.
}

// ---- the windows of every house, as the street sees them ----------------------------------------
//
// One instanced quad per window -- glass and frame drawn in one small picture -- laid out by
// homeWindowLayout for every house, a few hundred houses a frame. They are laid out again (and
// swapped in whole) when what decides them arrives: the doors with the interiors, the
// photographed openings. A house whose shell stands has its decals hidden; the shell has the
// same windows in the same places.
const HOME_DECAL_SLICE = 300;
const HOME_DECAL_OUT_M = 0.02;
//: The decals are drawn in cells of this size, one instanced mesh each, so that the windows of
//: houses beyond DETAIL_RANGE_M.house_window are not drawn at all.
const HOME_DECAL_CELL_M = 250;
let homeDecalMeshes = [];
let homeDecalIndex = new Map();
let homeDecalVersion = null;
let homeDecalJob = null;
const homeDecalHidden = new Set();
const homeDecalStats = { houses: 0, windows: 0, passes: 0 };
window.kerbsideWindows = () => ({ ...homeDecalStats, version: homeDecalVersion, hidden: homeDecalHidden.size });
const HOME_DECAL_ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function homeDecalInputs() {
  return `${INTERIORS ? "doors" : "no-doors"}:${HOME_OPENINGS_VERSION}`;
}
function setHomeDecalsVisible(id, visible) {
  if (visible) homeDecalHidden.delete(id); else homeDecalHidden.add(id);
  const list = homeDecalIndex.get(id);
  if (!list) return;
  for (let k = 0; k < list.length; k += 2) {
    const mesh = list[k], i = list[k + 1];
    mesh.setMatrixAt(i, visible ? mesh.userData.matrices[i] : HOME_DECAL_ZERO);
    mesh.instanceMatrix.needsUpdate = true;
  }
}
function pumpHomeDecals() {
  if (!homeDecalJob) {
    const inputs = homeDecalInputs();
    if (inputs === homeDecalVersion) return;
    // The first pass waits a little for the doors and the photographed openings, so a house's
    // windows are laid out once as the page opens rather than twice.
    if (homeDecalVersion === null && !(INTERIORS_SETTLED && HOME_OPENINGS_SETTLED)) return;
    homeDecalJob = { inputs, ids: [...HOME_RENDER.keys()], next: 0, cells: new Map(), index: new Map(),
      layouts: new Map(), windows: 0 };
  }
  const job = homeDecalJob;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const end = Math.min(job.ids.length, job.next + HOME_DECAL_SLICE); job.next < end; job.next += 1) {
    const id = job.ids[job.next];
    const entry = footprintById.get(id), spec = HOME_RENDER.get(id);
    if (!entry || !spec || entryTunnelConflict(entry)) continue;
    const layout = homeWindowLayout(entry, spec);
    if (!layout) continue;
    job.layouts.set(id, layout);
    // A house's windows all go in the cell of its first corner, so they come and go together.
    const cellKey = Math.floor(entry.local[0][0] / HOME_DECAL_CELL_M) * 1048576 + Math.floor(entry.local[0][1] / HOME_DECAL_CELL_M);
    // Every house's windows, in the headset as well: one plane drawn for all of them in a cell,
    // a small picture for each design -- little to hold for what it shows.
    for (const { a, ux, uz, nx, nz, windows } of layout.edges) {
      q.setFromAxisAngle(up, Math.atan2(-nx, -nz));
      for (const o of windows) {
        const designKey = o.design ? JSON.stringify([o.design.vertical_bars || [], o.design.horizontal_bars || [],o.design.trim?.colour || WINDOW_FRAME_DEFAULT,o.design.glass_colour || "#2a3740"]) : "default";
        const key = `${cellKey}:${designKey}`;
        let cell = job.cells.get(key);
        if (!cell) job.cells.set(key, cell = { matrices: [], owners: [], material: homeDesignMaterial(o.design) });
        p.set(a[0] + ux * (o.u + o.w / 2) - nx * HOME_DECAL_OUT_M, o.v + o.h / 2,
          a[1] + uz * (o.u + o.w / 2) - nz * HOME_DECAL_OUT_M);
        sc.set(o.w, o.h, 1);
        cell.owners.push(id);
        cell.matrices.push(m.compose(p, q, sc).clone());
        job.windows += 1;
      }
    }
  }
  if (job.next < job.ids.length) return;
  // The pass is done: swap it in whole, a mesh a cell.
  const geometry = new THREE.PlaneGeometry(1, 1);
  const meshes = [];
  for (const cell of job.cells.values()) {
    if (!cell.matrices.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, cell.material, cell.matrices.length);
    mesh.userData = { surface: "house_window", matrices: cell.matrices, grade: "procedural_or_photographed_openings" };
    for (let i = 0; i < cell.matrices.length; i += 1) {
      const id = cell.owners[i];
      mesh.setMatrixAt(i, homeDecalHidden.has(id) ? HOME_DECAL_ZERO : cell.matrices[i]);
      let list = job.index.get(id);
      if (!list) job.index.set(id, list = []);
      list.push(mesh, i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  for (const old of homeDecalMeshes) { root.remove(old); old.dispose(); }
  if (homeDecalMeshes.length) homeDecalMeshes[0].geometry.dispose();
  homeDecalMeshes = meshes;
  for (const mesh of meshes) root.add(mesh);
  const usedMaterials = new Set(meshes.map(mesh=>mesh.material));
  for (const [key, material] of homeDesignMaterials) if (!usedMaterials.has(material)) {
    material.map.dispose(); material.dispose(); homeDesignMaterials.delete(key);
  }
  homeDecalIndex = job.index;
  homeDecalVersion = job.inputs;
  for (const [id, layout] of job.layouts) {
    const entry = footprintById.get(id);
    if (entry) entry.decalLayout = layout;
  }
  homeDecalStats.houses = job.index.size;
  homeDecalStats.windows = job.windows;
  homeDecalStats.passes += 1;
  homeDecalJob = null;
}

//: The building a photographed wall belongs to: the footprint just behind the panel.
function facadePanelBuilding(panel) {
  if (panel.userData.buildingId !== undefined) return panel.userData.buildingId;
  const wall = panel.userData.facade;
  const [ax, ay] = xy(...wall.a), [bx, by] = xy(...wall.b);
  const length = Math.hypot(bx - ax, by - ay);
  const mx = (ax + bx) / 2, mz = -(ay + by) / 2;
  const nx = length ? (by - ay) / length * 0.2 : 0;
  const nz = length ? (bx - ax) / length * 0.2 : 0;
  const f = buildingAt(mx + nx, mz + nz) || buildingAt(mx - nx, mz - nz);
  panel.userData.buildingId = f ? String(f.osm_id) : null;
  return panel.userData.buildingId;
}

// ---- interiors ---------------------------------------------------------------------------------
const interiorGroup = new THREE.Group();
interiorGroup.name = "interiors";
root.add(interiorGroup);
const interiorsBuilt = new Set();
const plasterMaterial = new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.92, side: THREE.DoubleSide });
const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.95, side: THREE.DoubleSide });
const INTERIOR_WALL_PALETTES = [
  [0xf2eee7, 0xe6eadf, 0xeae3dd, 0xe8edf0, 0xe8e5df],
  [0xf0e9df, 0xe8e3d6, 0xe5e9e4, 0xe8e4ed, 0xe9e6e0],
  [0xeeeae4, 0xe0e8e6, 0xe9e2d8, 0xe4e7ec, 0xe8e6df],
  [0xf1eee9, 0xe7e9de, 0xe9e6e4, 0xe0e8eb, 0xe8e4db],
];
const interiorWallMaterials = new Map();
let interiorPlasterTexture = null;
//: Interior paint: real wall colours, not shades of white. Every room in a house its own, and
//: every house its own set (roomPaint).
const WALL_PAINTS = [
  0xc9d6c3, 0xe3b8a0, 0x9db4c8, 0xe8d39a, 0xd9a6a6, 0xa9c4bd, 0xc4b5d9, 0xb7c9a8, 0xf0c9a9, 0x8fa7b8,
  0xd8c3a5, 0xa8b9a0, 0xc98f7a, 0x7f9aa9, 0xe2d6c2, 0xb4a7c9, 0x92b0a0, 0xd6b38f, 0xa7c0d6, 0xc7a6b8,
  0x6f8f86, 0x8a9fc4, 0xd8cf9e, 0xb8b0a5, 0x5f7d95, 0xe6c3c3, 0x9fb28a, 0xcfb08c,
];
function roomPaint(houseSeed, roomIndex, avoid = -1) {
  let i = Math.floor(random(houseSeed * 13 + roomIndex * 101 + 7) * WALL_PAINTS.length) % WALL_PAINTS.length;
  if (i === avoid) i = (i + 5) % WALL_PAINTS.length;
  return i;
}
const paintMaterials = new Map();
function paintMaterial(index) {
  if (!paintMaterials.has(index)) {
    interiorWallMaterial(0, "living");          // makes the shared plaster grain
    paintMaterials.set(index, new THREE.MeshStandardMaterial({ map: interiorPlasterTexture, color: WALL_PAINTS[index],
      roughness: 0.9, side: THREE.DoubleSide }));
  }
  return paintMaterials.get(index);
}
//: Fitted carpet, cut to the room: plush, berber loop, a small geometric, a stripe; in a range of
//: colours. Tiled at its own size in metres (the room floor's UVs are metres), so it is never
//: stretched to a room.
const CARPET_COLOURS = [0xb9ab92, 0x8d8f8c, 0x3f4a63, 0x7a3a3c, 0x8f9f86, 0x4a4b4d, 0xe0d6c4, 0x9a5b3e, 0x3f6d6d, 0xb38b8b, 0x6d5f7a, 0xcab88f];
const CARPET_STYLES = ["plush", "berber", "geometric", "stripe"];
const carpetMaterials = new Map();
function carpetMaterial(style, colourIndex) {
  const key = `${style}:${colourIndex}`;
  if (carpetMaterials.has(key)) return carpetMaterials.get(key);
  const base = new THREE.Color(CARPET_COLOURS[colourIndex]);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `#${base.getHexString()}`; ctx.fillRect(0, 0, 128, 128);
  const seed = colourIndex * 17 + CARPET_STYLES.indexOf(style) * 5;
  if (style === "plush" || style === "berber") {
    for (let i = 0; i < (style === "plush" ? 5000 : 2200); i += 1) {
      ctx.fillStyle = random(seed + i) < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.08)";
      const sz = style === "plush" ? 1 : 2;
      ctx.fillRect(random(seed + i * 3) * 128, random(seed + i * 7) * 128, sz, sz);
    }
    if (style === "berber") {
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      for (let y = 0; y < 128; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 128; x += 4) ctx.fillRect(x, y, 2, 2);
    }
  } else if (style === "geometric") {
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 3;
    for (let x = 0; x <= 128; x += 32) for (let y = 0; y <= 128; y += 32) {
      ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 12, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 12, y); ctx.closePath(); ctx.stroke();
    }
  } else {
    for (let y = 0; y < 128; y += 16) { ctx.fillStyle = (y / 16) % 2 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.06)"; ctx.fillRect(0, y, 128, 8); }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // A tile is 0.6 m of carpet, the floor's UVs being metres.
  map.repeat.set(1 / 0.6, 1 / 0.6);
  const material = new THREE.MeshStandardMaterial({ map, roughness: 1.0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  carpetMaterials.set(key, material);
  return material;
}
//: How often a room of each kind is carpeted wall to wall.
const CARPET_SHARE = { bedroom: 0.7, living: 0.45, office: 0.55, dining: 0.2, corridor: 0.35 };
//: The rooms that open into each other: no wall between a kitchen, a living room and a dining room.
const OPEN_PLAN = new Set(["living", "dining", "kitchen"]);
//: The rooms that close: a door you open. Only a bedroom; a closet (storage) is open to the room.
const DOORED_ROOMS = new Set(["bedroom"]);
function interiorWallMaterial(theme, kind) {
  const family = ["living", "dining", "corridor", "stair"].includes(kind) ? 0
    : kind === "kitchen" ? 1 : kind === "bedroom" ? 2
    : ["bathroom", "storage"].includes(kind) ? 3 : 4;
  const key = `${theme}:${family}`;
  if (!interiorPlasterTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4f1eb"; ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,.05)" : "rgba(60,48,35,.025)";
      ctx.fillRect(random(i * 7 + 1) * 64, random(i * 13 + 5) * 64, 1, 1);
    }
    interiorPlasterTexture = new THREE.CanvasTexture(canvas);
    interiorPlasterTexture.colorSpace = THREE.SRGBColorSpace;
    interiorPlasterTexture.wrapS = interiorPlasterTexture.wrapT = THREE.RepeatWrapping;
    interiorPlasterTexture.repeat.set(2, 2);
  }
  if (!interiorWallMaterials.has(key)) interiorWallMaterials.set(key,
    new THREE.MeshStandardMaterial({ map: interiorPlasterTexture, color: INTERIOR_WALL_PALETTES[theme][family],
      roughness: 0.92, side: THREE.DoubleSide }));
  return interiorWallMaterials.get(key);
}
const furnishingMaterials = {
  wood: new THREE.MeshStandardMaterial({ color: 0x927558, roughness: 0.81 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x849089, roughness: 0.94 }),
  linen: new THREE.MeshStandardMaterial({ color: 0xdcd8cf, roughness: 0.98 }),
  cabinet: new THREE.MeshStandardMaterial({ color: 0xc6b7a3, roughness: 0.79 }),
  counter: new THREE.MeshStandardMaterial({ color: 0xddd9d0, roughness: 0.56 }),
  appliance: new THREE.MeshStandardMaterial({ color: 0xd5d8d7, metalness: 0.12, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x393d3e, roughness: 0.46 }),
};

function furnishingPlacement(entry, pts, size, doorsInPlan) {
  const centre = pts.reduce((p, q) => [p[0] + q[0] / pts.length, p[1] + q[1] / pts.length], [0, 0]);
  let longest = -1, direction = [1, 0];
  const candidates = [centre];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.2) continue;
    if (length > longest) { longest = length; direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]; }
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    candidates.push([mx * 0.55 + centre[0] * 0.45, mz * 0.55 + centre[1] * 0.45]);
  }
  if (longest < 0.2) return null;
  // A concave room's vertex average can lie outside it; its edge-biased
  // points can also all lie outside the clipped building. Search the remaining
  // intersection instead of declaring such rooms unfurnishable. Both axes
  // matter: a bed fits lengthwise, not sideways, in a narrow bedroom.
  const minX = Math.max(Math.min(...pts.map((p) => p[0])), entry.minX ?? -Infinity);
  const maxX = Math.min(Math.max(...pts.map((p) => p[0])), entry.maxX ?? Infinity);
  const minZ = Math.max(Math.min(...pts.map((p) => p[1])), entry.minZ ?? -Infinity);
  const maxZ = Math.min(Math.max(...pts.map((p) => p[1])), entry.maxZ ?? Infinity);
  for (let z = minZ + 0.25; z < maxZ; z += 0.5)
    for (let x = minX + 0.25; x < maxX; x += 0.5)
      if (pointInRing(x, z, pts) && insideFootprint(entry, x, z)) candidates.push([x, z]);
  for (const yaw of [-Math.atan2(direction[1], direction[0]),
    -Math.atan2(direction[1], direction[0]) + Math.PI / 2]) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const samplesX = Math.ceil((size[0] + 0.3) / 0.2), samplesZ = Math.ceil((size[1] + 0.3) / 0.2);
  for (const [cx, cz] of candidates) {
    let fits = true;
    for (let ix = 0; ix <= samplesX && fits; ix += 1) {
      const xx = -size[0] / 2 - 0.15 + (size[0] + 0.3) * ix / samplesX;
      for (let iz = 0; iz <= samplesZ; iz += 1) {
        const zz = -size[1] / 2 - 0.15 + (size[1] + 0.3) * iz / samplesZ;
        const x = cx + cos * xx + sin * zz, z = cz - sin * xx + cos * zz;
        if (!pointInRing(x, z, pts) || !insideFootprint(entry, x, z)
            || (entry.accessZones || []).some((zone) => pointInRing(x, z, zone))
            || doorsInPlan.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 0.7)) { fits = false; break; }
      }
    }
    if (fits) return { cx, cz, yaw };
  }
  }
  return null;
}

function addRoomFurnishing(group, entry, kind, pts, floorY, doorsInPlan, at = null) {
  const dimensions = { living: [1.7, 0.9], dining: [1.3, 0.8], bedroom: [1.5, 2.0],
    kitchen: [1.8, 0.75], storage: [1.4, 0.75], bathroom: [0.75, 0.65], office: [1.3, 0.7] };
  const size = dimensions[kind];
  if (!size) return;
  const placement = at || furnishingPlacement(entry, pts, size, doorsInPlan);
  if (!placement) return;
  const { cx, cz, yaw } = placement;
  const furniture = new THREE.Group();
  furniture.position.set(cx, floorY, cz);
  furniture.rotation.y = yaw;
  furniture.userData = { surface: `furnishing:${kind}`, grade: "inferred_from_room_type",
    source: "fitted_external_floor_plan", roomRing: pts };
  const box = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    furniture.add(mesh);
  };
  if (kind === "bedroom") {
    box(1.5, 0.32, 1.95, 0, 0.33, 0, furnishingMaterials.wood);
    box(1.42, 0.13, 1.8, 0, 0.56, 0, furnishingMaterials.linen);
    box(1.36, 0.16, 0.14, 0, 0.49, -0.86, furnishingMaterials.fabric);
  } else if (kind === "living") {
    box(1.7, 0.36, 0.8, 0, 0.37, 0, furnishingMaterials.fabric);
    box(1.7, 0.55, 0.16, 0, 0.75, -0.33, furnishingMaterials.fabric);
  } else if (kind === "kitchen") {
    box(1.8, 0.82, 0.65, 0, 0.42, 0, furnishingMaterials.cabinet);
    box(1.84, 0.06, 0.72, 0, 0.86, 0, furnishingMaterials.counter);
    box(0.5, 0.01, 0.35, 0.46, 0.90, 0, furnishingMaterials.dark);
    // Distinct sink, tap, cooktop and oven faces, rather than an anonymous box.
    box(0.44, 0.012, 0.36, -0.48, 0.90, 0, furnishingMaterials.appliance);
    box(0.34, 0.014, 0.26, -0.48, 0.902, 0, furnishingMaterials.dark);
    box(0.035, 0.22, 0.035, -0.48, 1.0, -0.21, furnishingMaterials.appliance);
    box(0.035, 0.035, 0.14, -0.48, 1.1, -0.16, furnishingMaterials.appliance);
    box(0.48, 0.48, 0.025, 0.46, 0.48, 0.337, furnishingMaterials.dark);
    for (const x of [-0.64, -0.27, 0.45])
      box(0.25, 0.025, 0.03, x, 0.72, 0.355, furnishingMaterials.appliance);
  } else if (kind === "storage") {
    for (const x of [-0.36, 0.36]) {
      box(0.67, 0.84, 0.67, x, 0.43, 0, furnishingMaterials.appliance);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.015, 20), furnishingMaterials.dark);
      drum.rotation.x = Math.PI / 2;
      drum.position.set(x, 0.48, 0.34);
      furniture.add(drum);
    }
  } else if (kind === "bathroom") {
    box(0.7, 0.47, 0.55, 0, 0.42, 0, furnishingMaterials.appliance);
  } else {
    box(size[0], 0.08, size[1], 0, 0.74, 0, furnishingMaterials.wood);
    for (const x of [-size[0] * 0.38, size[0] * 0.38])
      for (const z of [-size[1] * 0.36, size[1] * 0.36]) box(0.07, 0.7, 0.07, x, 0.35, z, furnishingMaterials.wood);
  }
  group.add(furniture);
  loadInteriorAsset(kind).then((template) => {
    if (!template || !furniture.parent) return;
    const model = template.clone(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const dimensions = bounds.getSize(new THREE.Vector3());
    const scale = Math.min(1, size[0] / Math.max(dimensions.x, 0.01),
      size[1] / Math.max(dimensions.z, 0.01), 1.8 / Math.max(dimensions.y, 0.01));
    const centre = bounds.getCenter(new THREE.Vector3());
    model.scale.multiplyScalar(scale);
    model.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);
    model.traverse((o) => { if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      o.userData.sharedInteriorAsset = true;
    } });
    for (const child of [...furniture.children]) {
      furniture.remove(child);
      child.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    furniture.add(model);
    furniture.userData.assetLicense = "CC0-1.0";
    furniture.userData.assetSource = "Poly Haven";
    // The imported bed is a frame, not a mattress.
    if (kind === "bedroom") box(1.35 * scale, 0.18, 1.8 * scale, 0, 0.5 * scale, 0,
      furnishingMaterials.linen);
  });
}
const interiorAssetPromises = new Map();
function loadInteriorAsset(kind) {
  const ids = { living: "sofa_03", dining: "dining_table", bedroom: "old_bed_frame", office: "modern_arm_chair_01" };
  const id = ids[kind];
  if (!id) return Promise.resolve(null);
  if (!interiorAssetPromises.has(id)) {
    const registry = document.querySelector('meta[name="kerbside-regions"]')?.content || "regions.json";
    const url = new URL(`interior-assets/${id}/${id}.gltf`, new URL(registry, location.href));
    interiorAssetPromises.set(id, new GLTFLoader().loadAsync(url.href)
      .then((gltf) => plainGlass(gltf.scene)).catch(() => null));
  }
  return interiorAssetPromises.get(id);
}
