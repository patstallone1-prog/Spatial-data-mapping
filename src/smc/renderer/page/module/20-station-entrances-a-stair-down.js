// ---- station entrances: a stair down, and a wall at the bottom ------------------------------
//
// Every station entrance the agencies publish (GTFS entrances: BART's, which Muni Metro shares
// under Market Street) is a stairwell cut into the pavement beside the kerb: a stair of real
// treads and risers down a concrete well, a railing round the three sides you cannot enter by,
// and at the bottom a short landing and a black wall. The walker can go down; there is no
// station to go into.
//
// The pavement over the well is drawn as solid ground like any other, so the well is shown
// through it: the opening is marked in the stencil, the depth in it cleared, the well drawn
// there, and the depth of the pavement's surface put back, so nothing drawn afterwards covers
// the hole and nothing in front of it is lost.
const STATION_STAIR = { width: 2.6, rise: 0.17, tread: 0.29, steps: 24, landing: 1.6, kerbGap: 1.4, wall: 0.2 };
const stationMaterials = {
  concrete: new THREE.MeshStandardMaterial({ color: 0xb8b4ab, roughness: 0.92 }),
  tread: new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.85 }),
  nosing: new THREE.MeshStandardMaterial({ color: 0xd9b23a, roughness: 0.6 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.3, metalness: 0.8 }),
  dark: new THREE.MeshBasicMaterial({ color: 0x000000 }),
};
const STATION_ORDER = { mark: -0.97, clear: -0.96, well: -0.95, seal: -0.94 };
function portalMaterialFor(stage) {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  m.stencilWrite = true;
  m.stencilRef = 1;
  if (stage === "mark") {
    m.depthWrite = false;
    m.stencilFunc = THREE.AlwaysStencilFunc;
    m.stencilZPass = THREE.ReplaceStencilOp;
  } else {
    m.depthTest = true;
    m.depthFunc = THREE.AlwaysDepth;
    m.depthWrite = true;
    m.stencilFunc = THREE.EqualStencilFunc;
    m.stencilZPass = THREE.KeepStencilOp;
    if (stage === "clear") {
      // As far as depth goes: the well behind the opening is drawn whatever the pavement wrote.
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(/}\s*$/, "  gl_FragDepth = 1.0;\n}");
      };
      m.customProgramCacheKey = () => "station-clear";
    }
  }
  return m;
}
// (var: the walls are asked for by wallSegmentsNear, which can run before this line has.)
var stationWalls = [];
function stationWallsNear(x, z) {
  return stationWalls.filter(([ax, az, bx, bz]) => Math.min(Math.hypot(ax - x, az - z), Math.hypot(bx - x, bz - z)) < 20);
}
function addStationEntrances(entrances) {
  const S = STATION_STAIR;
  const run = S.steps * S.tread, depth = S.steps * S.rise, length = run + S.landing;
  const portals = { mark: portalMaterialFor("mark"), clear: portalMaterialFor("clear"), seal: portalMaterialFor("seal") };
  const wellMaterials = new Map();
  const forWell = (m) => {
    if (!wellMaterials.has(m)) {
      const c = m.clone();
      c.stencilWrite = true; c.stencilRef = 1; c.stencilFunc = THREE.EqualStencilFunc;
      wellMaterials.set(m, c);
    }
    return wellMaterials.get(m);
  };
  let built = 0;
  const seen = [];
  for (const entrance of entrances || []) {
    let [x, y] = xy(entrance.lon, entrance.lat);
    let z = -y;
    // One stair to an entrance point; the feed gives some entrances twice.
    if (seen.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 6)) continue;
    const kerb = nearestKerbAt(x, z, 30);
    if (!kerb) continue;
    const nx = kerb.nx, nz = kerb.nz, ux = nz, uz = -nx;
    // The well's centre line runs along the pavement, a little in from the kerb; it goes down
    // whichever way along the kerb, and from wherever along it near the entrance, keeps all of
    // it on the pavement.
    let dir = 0, cx0 = 0, cz0 = 0;
    search: for (const gap of [S.kerbGap, 0.9, 2.2]) {
      const off = gap + S.width / 2;
      for (const shift of [0, -3, 3, -6, 6]) {
        for (const sign of [1, -1]) {
          const bx = kerb.x + nx * off + ux * shift, bz = kerb.z + nz * off + uz * shift;
          let clear = true;
          for (let t = 0; t <= length && clear; t += 1) {
            for (const w of [-S.width / 2 - 0.1, 0, S.width / 2 + 0.1]) {
              const px = bx + ux * sign * t + nx * w, pz = bz + uz * sign * t + nz * w;
              if (buildingAt(px, pz) || insideCarriageway(px, pz, 0.05)) { clear = false; break; }
            }
          }
          if (clear) { dir = sign; cx0 = bx; cz0 = bz; break search; }
        }
      }
    }
    if (!dir) { transitStats.entrancesSkipped = (transitStats.entrancesSkipped || 0) + 1; continue; }
    seen.push([x, z]);
    const ax = ux * dir, az = uz * dir;                 // down the stair
    const top = pavementTopAt(cx0, cz0);
    const ground = (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(cx0, cz0);
    const group = new THREE.Group();
    group.position.set(cx0, ground, cz0);
    group.rotation.y = Math.atan2(ax, az);              // local +z: down the stair; local x: across
    group.userData = { surface: "furniture:station_entrance", source: `gtfs:${entrance.agency}`, name: entrance.name };
    const box = (w, h, d, px, py, pz, material, order = STATION_ORDER.well) => {
      const mesh = new THREE.Mesh(unitBox, forWell(material));
      mesh.scale.set(w, h, d);
      mesh.position.set(px, py, pz);
      mesh.renderOrder = order;
      group.add(mesh);
      return mesh;
    };
    // The treads, each a block from the one above's level down to its own.
    for (let i = 0; i < S.steps; i += 1) {
      const level = -(i + 1) * S.rise;
      box(S.width, S.rise, S.tread, 0, level + S.rise / 2 - S.rise, (i + 0.5) * S.tread, stationMaterials.tread);
      box(S.width, 0.02, 0.05, 0, level + 0.005, i * S.tread + 0.03, stationMaterials.nosing);
    }
    box(S.width, 0.2, S.landing, 0, -depth - 0.1, run + S.landing / 2, stationMaterials.tread);
    // The well's walls and its end: concrete down the sides, black across the bottom.
    for (const side of [-1, 1]) box(S.wall, depth + 2.6, length, side * (S.width / 2 + S.wall / 2), -(depth + 2.6) / 2 + 0.02, length / 2, stationMaterials.concrete);
    box(S.width, depth + 2.6, S.wall, 0, -(depth + 2.6) / 2 + 0.02, length + S.wall / 2, stationMaterials.dark);
    // The ceiling over the lower part: the pavement's underside, seen from the stair.
    box(S.width, 0.15, length - 2.4, 0, -0.1, 2.4 + (length - 2.4) / 2, stationMaterials.concrete);
    // The opening: marked, cleared, and sealed again at the pavement's surface.
    for (const stage of ["mark", "clear", "seal"]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(S.width + 2 * S.wall, length + S.wall).rotateX(-Math.PI / 2), portals[stage]);
      mesh.position.set(0, 0.03, (length + S.wall) / 2);
      mesh.renderOrder = STATION_ORDER[stage];
      group.add(mesh);
    }
    // The railing round the three closed sides, on the pavement.
    const rail = (w, d, px, pz) => {
      const top = new THREE.Mesh(unitBox, stationMaterials.rail);
      top.scale.set(w, 0.05, d); top.position.set(px, 1.05, pz);
      const mid = new THREE.Mesh(unitBox, stationMaterials.rail);
      mid.scale.set(w, 0.03, d); mid.position.set(px, 0.55, pz);
      group.add(top, mid);
    };
    rail(0.05, length, -S.width / 2 - S.wall / 2, length / 2);
    rail(0.05, length, S.width / 2 + S.wall / 2, length / 2);
    rail(S.width + S.wall, 0.05, 0, length + S.wall / 2);
    for (const [px, pz] of [[-1, 0], [1, 0], [-1, 1], [1, 1], [-1, 0.5], [1, 0.5]]) {
      const post = new THREE.Mesh(unitBox, stationMaterials.rail);
      post.scale.set(0.06, 1.08, 0.06);
      post.position.set(px * (S.width / 2 + S.wall / 2), 0.54, pz * length);
      group.add(post);
    }
    groups.furniture.add(group);
    // Walking: the stair's surface, and walls along its sides and across its foot.
    const across = [az, -ax];                            // local +x in the page's frame
    const P = (lx, lz) => [cx0 + across[0] * lx + ax * lz, cz0 + across[1] * lx + az * lz];
    const surface = (wx, wz) => {
      const dx = wx - cx0, dz = wz - cz0;
      const lz = dx * ax + dz * az, lx = dx * across[0] + dz * across[1];
      if (Math.abs(lx) > S.width / 2 || lz < 0 || lz > length) return null;
      if (lz >= run) return ground - depth;
      return ground - Math.min(S.steps, Math.floor(lz / S.tread) + 1) * S.rise;
    };
    surface.priority = 2;
    surface.stairs = true;
    standingSurfaces.add(surface);
    const hw = S.width / 2;
    for (const [a, b] of [[P(-hw, 0), P(-hw, length)], [P(hw, 0), P(hw, length)], [P(-hw, length), P(hw, length)]])
      stationWalls.push([a[0], a[1], b[0], b[1]]);
    built += 1;
    (transitStats.entranceAt = transitStats.entranceAt || []).push([+(midLon + cx0 / metersPerLon).toFixed(6), +(midLat - cz0 / metersPerLat).toFixed(6), entrance.name]);
  }
  transitStats.entrances = built;
  return built;
}

// ---- the signs, saying what they say ----
//
// SFMTA's sign inventory carries the legend of every sign: "SPEED LIMIT 25", "NPRK 2AM-6AM
// TUE THUR STCL", "2 HR PRK 8AM-6PM MON-FRI EXC "G" PERMITS". The plates were blank white
// rectangles and the stop signs plain red octagons. Each legend is now drawn once into a
// shared atlas -- the plate in the colours the city uses for that class of sign, the words
// wrapped onto it -- and every sign is a quad that reads its own tile. A stop sign is a red
// octagon with STOP on it, a warning is a yellow diamond, a street name a green blade; the
// shape is in the tile's alpha, so one material draws them all.
//
// The plate stands in front of its post, not through it: the post is behind the sign, which is
// where a post is, and from the road you see the face and not a pole down the middle of it.
// Several legends at one point are one post with the plates stacked down it.
const PLATE_TILE_PX = 192;
const PLATE_ATLAS_PX = 2048;
const PLATE_PER_ROW = Math.floor(PLATE_ATLAS_PX / PLATE_TILE_PX);
const PLATE_PER_ATLAS = PLATE_PER_ROW * PLATE_PER_ROW;
//: The post's radius plus the bracket: how far the plate stands in front of the post's axis.
const PLATE_STANDOFF_M = 0.05;
//: Plates on one post are this far apart, and the topmost sits at the panel height.
const PLATE_GAP_M = 0.06;
//: Points closer than this are one post. The inventory digitises each plate as its own point,
//: and two plates on one pole come back a metre or so apart; at 0.35 m they stood on two
//: poles side by side, each refusing the other's plate.
const PLATE_SAME_POST_M = 1.2;

const plateAtlases = [];
const PLATE_SLOTS = new Map();

function newPlateAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PLATE_ATLAS_PX;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, PLATE_ATLAS_PX, PLATE_ATLAS_PX);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const atlas = { canvas, ctx, texture, used: 0, index: plateAtlases.length, sink: newSink() };
  plateAtlases.push(atlas);
  return atlas;
}

//: What each class of sign looks like: plate colour, lettering colour, shape, and the plate's
//: real size in metres. The colours are the MUTCD's and the city's: red-on-white for parking
//: prohibitions and street cleaning, green-on-white for time-limited parking, white-on-green
//: street blades, black-on-yellow diamonds for warnings, the red octagon.
const PLATE_STYLES = {
  stop:        { bg: "#b52127", fg: "#ffffff", shape: "octagon", w: 0.76, h: 0.76, border: "#ffffff" },
  all_way:     { bg: "#b52127", fg: "#ffffff", shape: "plate", w: 0.46, h: 0.15, border: "#ffffff" },
  yield:       { bg: "#ffffff", fg: "#b52127", shape: "triangle", w: 0.76, h: 0.66, border: "#b52127" },
  warning:     { bg: "#f2c027", fg: "#111111", shape: "diamond", w: 0.76, h: 0.76, border: "#111111" },
  school:      { bg: "#e4ea4d", fg: "#111111", shape: "pentagon", w: 0.76, h: 0.83, border: "#111111" },
  speed_limit: { bg: "#ffffff", fg: "#111111", shape: "plate", w: 0.61, h: 0.76, border: "#111111" },
  no_parking:  { bg: "#ffffff", fg: "#b52127", shape: "plate", w: 0.30, h: 0.46, border: "#b52127" },
  parking:     { bg: "#ffffff", fg: "#1e7a3e", shape: "plate", w: 0.30, h: 0.46, border: "#1e7a3e" },
  street_name: { bg: "#1e7a3e", fg: "#ffffff", shape: "plate", w: 0.90, h: 0.23, border: "#ffffff" },
  one_way:     { bg: "#111111", fg: "#ffffff", shape: "plate", w: 0.90, h: 0.30, border: "#ffffff" },
  guide:       { bg: "#1e7a3e", fg: "#ffffff", shape: "plate", w: 0.60, h: 0.45, border: "#ffffff" },
  bike:        { bg: "#ffffff", fg: "#111111", shape: "plate", w: 0.45, h: 0.60, border: "#111111" },
  regulatory:  { bg: "#ffffff", fg: "#111111", shape: "plate", w: 0.45, h: 0.60, border: "#111111" },
  // MUTCD R5-1: a red disc with a white bar on a white square.
  do_not_enter: { bg: "#ffffff", fg: "#ffffff", shape: "do_not_enter", w: 0.76, h: 0.76, border: "#111111" },
  // MUTCD R3-1/R3-2/R3-4 (and R10-11 with ON RED): the turn arrow under a red circle and slash.
  no_turn:     { bg: "#ffffff", fg: "#111111", shape: "plate", w: 0.61, h: 0.76, border: "#111111", symbol: "no_turn" },
  accessible_parking: { bg: "#ffffff", fg: "#1f4fa3", shape: "plate", w: 0.30, h: 0.46, border: "#1f4fa3" },
};

function plateStyleFor(sign) {
  const category = String((sign.tags || {}).SIGN_CATEGORY || "").toUpperCase();
  const klass = String((sign.tags || {}).SIGN_CLASS || "").toUpperCase();
  const label = String(sign.label || "").toUpperCase();
  if (sign.sign_kind === "stop" || label === "STOP") return "stop";
  if (sign.sign_kind === "all_way" || category === "ALL WAY") return "all_way";
  if (sign.sign_kind === "yield" || label.startsWith("YIELD")) return "yield";
  if (category === "STREET NAME") return "street_name";
  if (category.startsWith("ONE WAY")) return "one_way";
  if (category.startsWith("SPEED LIMIT")) return "speed_limit";
  if (category.startsWith("SCHOOL")) return "school";
  if (klass === "WARNING" || category.startsWith("PEDESTRIAN")) {
    return "warning";
  }
  if (category === "STREET CLEANING" || category.startsWith("TOW") || category.startsWith("PARKING:NPRK")
      || category.startsWith("PARKING:NO DBL") || label.startsWith("NPRK") || label.startsWith("TANP")) {
    return "no_parking";
  }
  if (label.startsWith("DO NOT ENTER")) return "do_not_enter";
  if (/\bNO (RIGHT|LEFT|U) TURN\b/.test(label)) return "no_turn";
  if (label.includes("(H/C SYM)")) return "accessible_parking";
  if (label.startsWith("TANS")) return "no_parking";
  if (category.startsWith("PARKING")) return "parking";
  if (klass === "GUIDE" && !category.startsWith("BIKE")) return "guide";
  if (category.startsWith("BIKE")) return "bike";
  return "regulatory";
}

//: Assets in the sign inventory that are not signs at all, and what they are instead.
function plateAssetKind(sign) {
  const category = String((sign.tags || {}).SIGN_CATEGORY || "").toUpperCase();
  const label = String(sign.label || "").toUpperCase();
  if (category === "BIKE RACK" || label === "BIKE RACK") return "bike_rack";
  if (category.startsWith("DELINEATOR") || label.includes("DELINEATOR")) return "delineator";
  if (label.includes("LANTERN")) return "lantern";
  return "sign";
}

function plateLegend(label) {
  // The inventory's shorthand, read out: "NPRK 2AM-6AM TUE THUR STCL" is NO PARKING 2AM-6AM
  // TUE THUR STREET CLEANING, "(RA)" is a right arrow, "(SYM)" marks a symbol the legend does
  // not spell out and says nothing on the plate.
  return String(label || "")
    .toUpperCase()
    .replace(/\(RA\)/g, "→").replace(/\(LA\)/g, "←")
    .replace(/\(H\/C SYM\)/g, "♿").replace(/\(SYM\)/g, "").replace(/\s+\/\s*/g, " / ")
    .replace(/\bNPRK\b/g, "NO PARKING").replace(/\bTANP\b/g, "TOW-AWAY NO PARKING")
    .replace(/\bTANSAT\b/g, "TOW-AWAY NO STOPPING ANY TIME").replace(/\bSTCL\b/g, "STREET CLEANING")
    .replace(/\bPRK\b/g, "PARKING").replace(/\bEXC\b/g, "EXCEPT").replace(/\bPLO\b/g, "PASSENGER LOADING ONLY")
    .replace(/\bTA\b/g, "TOW-AWAY").replace(/\bDBL\b/g, "DOUBLE").replace(/\bPRK\b/g, "PARKING")
    .replace(/\s{2,}/g, " ").trim();
}

function wrapLegend(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+|(?<=\/)/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth || !line) line = trial;
    else { lines.push(line); line = word; }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function plateSilhouetteSlot(style) {
  // The back of a plate: the same outline in plain aluminium grey, one tile per style. The
  // face's own tile would show its legend through the grey, mirrored.
  return plateSlot({ label: "", sign_kind: null, tags: {} }, style, true);
}

function plateSlot(sign, forcedStyle = null, silhouette = false) {
  const style = forcedStyle || plateStyleFor(sign);
  const text = silhouette ? "" : plateLegend(sign.label);
  const key = silhouette ? `back|${style}` : `${style}|${text}`;
  const cached = PLATE_SLOTS.get(key);
  if (cached) return cached;
  let atlas = plateAtlases[plateAtlases.length - 1];
  if (!atlas || atlas.used >= PLATE_PER_ATLAS) atlas = newPlateAtlas();
  const spec = PLATE_STYLES[style];
  const col = atlas.used % PLATE_PER_ROW;
  const row = Math.floor(atlas.used / PLATE_PER_ROW);
  atlas.used += 1;
  const ox = col * PLATE_TILE_PX;
  const oy = row * PLATE_TILE_PX;
  const ctx = atlas.ctx;
  // The plate drawn at its own aspect inside the square tile; what the tile leaves over is
  // transparent, which is what gives an octagon its corners and a blade its width.
  const scale = Math.min((PLATE_TILE_PX - 6) / spec.w, (PLATE_TILE_PX - 6) / spec.h);
  const pw = spec.w * scale;
  const ph = spec.h * scale;
  const px = ox + (PLATE_TILE_PX - pw) / 2;
  const py = oy + (PLATE_TILE_PX - ph) / 2;
  ctx.save();
  ctx.beginPath();
  if (spec.shape === "octagon") {
    const r = pw / 2;
    for (let i = 0; i < 8; i += 1) {
      const a = Math.PI / 8 + i * Math.PI / 4;
      const x = px + r + Math.cos(a) * r;
      const y = py + r + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  } else if (spec.shape === "diamond") {
    ctx.moveTo(px + pw / 2, py); ctx.lineTo(px + pw, py + ph / 2);
    ctx.lineTo(px + pw / 2, py + ph); ctx.lineTo(px, py + ph / 2);
  } else if (spec.shape === "triangle") {
    ctx.moveTo(px, py); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw / 2, py + ph);
  } else if (spec.shape === "do_not_enter") {
    ctx.rect(px, py, pw, ph);
  } else if (spec.shape === "pentagon") {
    ctx.moveTo(px + pw / 2, py); ctx.lineTo(px + pw, py + ph * 0.38);
    ctx.lineTo(px + pw * 0.82, py + ph); ctx.lineTo(px + pw * 0.18, py + ph);
    ctx.lineTo(px, py + ph * 0.38);
  } else {
    ctx.rect(px, py, pw, ph);
  }
  ctx.closePath();
  ctx.fillStyle = silhouette ? "#8a9093" : spec.bg;
  ctx.fill();
  ctx.lineWidth = Math.max(2, pw * 0.035);
  ctx.strokeStyle = silhouette ? "#6f7477" : spec.border;
  ctx.stroke();
  ctx.clip();
  let words = text;
  let textTop = py, textH = ph;
  if (!silhouette && spec.shape === "do_not_enter") {
    // The red disc, the white bar, DO NOT above it and ENTER below.
    const r = pw * 0.42;
    ctx.fillStyle = "#b52127";
    ctx.beginPath(); ctx.arc(px + pw / 2, py + ph / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px + pw / 2 - r * 0.78, py + ph / 2 - r * 0.15, r * 1.56, r * 0.3);
    ctx.font = `bold ${Math.round(r * 0.28)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("DO NOT", px + pw / 2, py + ph / 2 - r * 0.45);
    ctx.fillText("ENTER", px + pw / 2, py + ph / 2 + r * 0.45);
    words = "";
  } else if (!silhouette && spec.symbol === "no_turn") {
    // The arrow, then the red circle and slash over it, in the top of the plate; whatever the
    // legend says beyond the turn itself ("ON RED", "7AM-9AM") is set underneath.
    const label = String(sign.label || "").toUpperCase();
    const which = /NO U TURN/.test(label) && !/NO (LEFT|RIGHT) TURN/.test(label) ? "u"
      : /NO LEFT TURN/.test(label) ? "left" : "right";
    const cx = px + pw / 2, cy = py + ph * 0.36, r = Math.min(pw, ph) * 0.3;
    ctx.strokeStyle = "#111111"; ctx.fillStyle = "#111111";
    ctx.lineWidth = r * 0.22; ctx.lineCap = "butt"; ctx.lineJoin = "miter";
    const dir = which === "left" ? -1 : 1;
    ctx.beginPath();
    if (which === "u") {
      ctx.moveTo(cx + r * 0.35, cy + r * 0.75);
      ctx.lineTo(cx + r * 0.35, cy - r * 0.1);
      ctx.arc(cx, cy - r * 0.1, r * 0.35, 0, Math.PI, true);
      ctx.lineTo(cx - r * 0.35, cy + r * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy + r * 0.25); ctx.lineTo(cx - r * 0.08, cy + r * 0.25);
      ctx.lineTo(cx - r * 0.35, cy + r * 0.65); ctx.closePath(); ctx.fill();
    } else {
      ctx.moveTo(cx - dir * r * 0.3, cy + r * 0.75);
      ctx.lineTo(cx - dir * r * 0.3, cy - r * 0.15);
      ctx.lineTo(cx + dir * r * 0.25, cy - r * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + dir * r * 0.7, cy - r * 0.15); ctx.lineTo(cx + dir * r * 0.22, cy - r * 0.48);
      ctx.lineTo(cx + dir * r * 0.22, cy + r * 0.18); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = "#b52127"; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7071, cy - r * 0.7071); ctx.lineTo(cx + r * 0.7071, cy + r * 0.7071);
    ctx.stroke();
    words = text.replace(/NO (RIGHT|LEFT|U) TURN/g, "").replace(/^[\s/]+|[\s/]+$/g, "").trim();
    textTop = py + ph * 0.68; textH = ph * 0.3;
  }
  // The words. Set as large as fits: one line for a short legend, up to six for a parking
  // regulation, smaller until the longest line fits the plate.
  ctx.fillStyle = spec.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const inset = spec.shape === "plate" ? 0.08 : 0.24;
  const maxW = pw * (1 - 2 * inset);
  const maxH = textH * (1 - 2 * (spec.shape === "triangle" ? 0.3 : inset));
  let lines = [];
  let size = Math.max(10, Math.min(ph * 0.5, pw * 0.34));
  for (let attempt = 0; attempt < 16; attempt += 1) {
    ctx.font = `bold ${Math.round(size)}px Helvetica, Arial, sans-serif`;
    lines = wrapLegend(ctx, words, maxW, 6);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
    if (lines.length * size * 1.12 <= maxH && widest <= maxW) break;
    size *= 0.88;
  }
  const lineH = size * 1.12;
  const y0 = textTop + textH / 2 - ((lines.length - 1) * lineH) / 2 + (spec.shape === "triangle" ? -ph * 0.14 : 0);
  lines.forEach((line, i) => ctx.fillText(line, px + pw / 2, y0 + i * lineH));
  ctx.restore();
  atlas.texture.needsUpdate = true;
  const slot = {
    atlas, style, w: spec.w, h: spec.h,
    u0: (px - 1) / PLATE_ATLAS_PX, u1: (px + pw + 1) / PLATE_ATLAS_PX,
    v0: 1 - (py + ph + 1) / PLATE_ATLAS_PX, v1: 1 - (py - 1) / PLATE_ATLAS_PX,
  };
  PLATE_SLOTS.set(key, slot);
  return slot;
}

const PLATE_MATERIALS = new Map();
function plateMaterial(atlas) {
  if (!PLATE_MATERIALS.has(atlas.index)) {
    PLATE_MATERIALS.set(atlas.index, new THREE.MeshStandardMaterial({
      map: atlas.texture, transparent: true, alphaTest: 0.5, side: THREE.FrontSide,
      roughness: 0.55, metalness: 0.05,
    }));
  }
  return PLATE_MATERIALS.get(atlas.index);
}

function itemFaceKey(item) {
  const tags = item.tags || {};
  const bearing = Number.isFinite(item.bearing) ? Math.round(item.bearing * 10) / 10 : "?";
  return [item.sign_kind || "", String(item.label || "").trim().toUpperCase(),
    String(tags.SIGN_CODE || "").toUpperCase(), bearing].join("|");
}

// ---- the approaches to a junction: where a sign or a signal stands for each way in ----
//
// OpenStreetMap marks a stop or a signal as one point -- usually the junction node itself --
// and that point was drawn as one sign at the nearest bit of pavement. A four-way stop is
// four signs, one at the right-hand kerb of each approach facing the traffic coming in; a
// signalised crossroads has a head for every approach. So each such point is expanded into
// the junction's approaches: the street legs that meet there, read from the streets
// themselves. On a one-way leg that carries traffic away from the junction there is nothing
// to face. These placements are inferred, and recorded as inferred.
function indexJunctionVertices() {
  junctionVertexGrid = new Map();
  for (const way of DATA.ways || []) {
    if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
    if (isUnmarkedService(way) || isTunnelWay(way)) continue;
    const pts = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    pts.forEach(([x, z], i) => {
      const key = `${Math.floor(x / JUNCTION_CELL_M)}:${Math.floor(z / JUNCTION_CELL_M)}`;
      if (!junctionVertexGrid.has(key)) junctionVertexGrid.set(key, []);
      junctionVertexGrid.get(key).push({ way, pts, i, x, z });
    });
  }
}
function onewaySign(way) {
  const v = String(way.osm_oneway ?? way.oneway ?? "").toLowerCase();
  if (["no", "false", "0"].includes(v)) return 0;
  // Explicit OSM direction wins. Otherwise a city record cannot turn mapped
  // opposing lanes into a one-way road (Presidio inherited Pine's WB record).
  if (way.osm_oneway == null && way.lanes_fwd > 0 && way.lanes_back > 0) return 0;
  if (v === "-1" || v === "reverse") return -1;
  if (v === "yes" || v === "true" || v === "1" || way.oneway === true) return 1;
  const cardinal = { nb: [0,1], sb: [0,-1], eb: [1,0], wb: [-1,0] }[v];
  if (cardinal && way.points?.length >= 2) {
    const a = way.points[0], b = way.points[way.points.length - 1];
    const dx = (b[0]-a[0])*Math.cos((a[1]+b[1])*Math.PI/360), dy = b[1]-a[1];
    const dot = dx*cardinal[0]+dy*cardinal[1], length = Math.hypot(dx,dy);
    if (length > 0 && Math.abs(dot)/length >= Math.SQRT1_2) return dot > 0 ? 1 : -1;
  }
  return 0;
}
//: The legs meeting within ``reach`` of a point: each a direction away from the junction.
function approachLegs(x, z, reach = 6) {
  if (!junctionVertexGrid) indexJunctionVertices();
  const legs = [];
  const cx = Math.floor(x / JUNCTION_CELL_M), cz = Math.floor(z / JUNCTION_CELL_M);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const v of junctionVertexGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        if (Math.hypot(v.x - x, v.z - z) > reach) continue;
        for (const step of [-1, 1]) {
          let k = v.i + step;
          if (k < 0 || k >= v.pts.length) continue;
          // Read the direction a few metres out, past any kink at the node itself.
          while (k + step >= 0 && k + step < v.pts.length
                 && Math.hypot(v.pts[k][0] - v.x, v.pts[k][1] - v.z) < 6) k += step;
          const ex = v.pts[k][0] - v.x, ez = v.pts[k][1] - v.z;
          const len = Math.hypot(ex, ez);
          if (len < 0.5) continue;
          const ux = ex / len, uz = ez / len;
          const bearing = Math.atan2(ux, uz);
          if (legs.some((l) => {
            let d = Math.abs(l.bearing - bearing) % (2 * Math.PI);
            if (d > Math.PI) d = 2 * Math.PI - d;
            return d < 0.35;
          })) continue;
          // Traffic on this leg comes *in* unless the way is one-way running outward.
          const oneway = onewaySign(v.way);
          const inbound = oneway === 0 || oneway === -step;
          legs.push({ way: v.way, x: v.x, z: v.z, ux, uz, bearing, inbound,
            half: renderedRoadWidth(v.way) / 2 });
        }
      }
    }
  }
  return legs;
}
//: Where a post stands for traffic arriving along ``leg``: on the driver's right, behind the
//: crossing street's kerb, on pavement. Returns {x, z, yaw} with the face toward the traffic.
function approachPlacement(junction, leg, legs, kerbClear = 0.9) {
  const crossing = Math.max(4, ...legs.filter((l) => l !== leg).map((l) => l.half));
  // Arriving traffic travels along -u; its right-hand side is (uz, -ux).
  const rx = leg.uz, rz = -leg.ux;
  // Never on the crossing's paint or its kerb ramp: back along the approach until the post is
  // clear of them, as a stop sign stands behind the crosswalk -- preferred to standing further
  // from the kerb, where a driver looks for it less.
  const tries = [];
  for (let back = 0; back <= 4.01; back += 1.0) {
    for (let extra = 0; extra <= 3.01; extra += 0.5) tries.push([back, extra, back + 1.5 * extra]);
  }
  tries.sort((a, b) => a[2] - b[2]);
  for (const [back, extra] of tries) {
    const setback = crossing + 2.0 + back;
    const off = leg.half + kerbClear + extra;
    const x = junction.x + leg.ux * setback + rx * off;
    const z = junction.z + leg.uz * setback + rz * off;
    if (insideCarriageway(x, z, 0.1) || insideJunctionBox(x, z) || buildingAt(x, z)) continue;
    if (onCrossingGround(x, z)) continue;
    return { x, z, yaw: Math.atan2(leg.ux, leg.uz) };
  }
  return null;
}
//: The junction a point belongs to: the street vertex within ``reach`` with the most legs.
function junctionNear(x, z, reach = 20) {
  if (!junctionVertexGrid) indexJunctionVertices();
  let best = null;
  const cx = Math.floor(x / JUNCTION_CELL_M), cz = Math.floor(z / JUNCTION_CELL_M);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const v of junctionVertexGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        const d = Math.hypot(v.x - x, v.z - z);
        if (d > reach) continue;
        const legs = approachLegs(v.x, v.z, 2.5);
        if (legs.length < 3) continue;
        if (!best || legs.length > best.legs.length || (legs.length === best.legs.length && d < best.d)) {
          best = { x: v.x, z: v.z, legs, d };
        }
      }
    }
  }
  return best;
}

//: OpenStreetMap stop and give-way points, as one plate per approach they govern.
function expandApproachSigns(records) {
  const out = [];
  const done = new Set();
  for (const item of records) {
    if (!item || !item.p) continue;
    const kind = item.sign_kind;
    const [x0, y0] = xy(item.p[0], item.p[1]);
    const z0 = -y0;
    const junction = junctionNear(x0, z0, 18);
    if (!junction) { out.push(item); continue; }       // not at a junction: as mapped
    const key = `${kind}:${Math.round(junction.x)}:${Math.round(junction.z)}`;
    if (done.has(key)) continue;                        // one point per junction is enough
    done.add(key);
    const tags = item.tags || {};
    const inbound = junction.legs.filter((l) => l.inbound);
    let governed;
    if (String(tags.stop || "").toLowerCase() === "all") governed = inbound;
    else if (Math.hypot(junction.x - x0, junction.z - z0) > 4) {
      // Mapped on an approach, short of the junction: that approach alone.
      const along = inbound.map((l) => ({ l, d: Math.hypot(junction.x + l.ux * 8 - x0, junction.z + l.uz * 8 - z0) }))
        .sort((a, b) => a.d - b.d);
      governed = along.length ? [along[0].l] : [];
    } else {
      // On the junction node: the minor road's approaches -- the narrower of the streets
      // meeting there -- or every approach where they are all alike (the all-way stop).
      const widest = Math.max(...inbound.map((l) => l.half));
      const narrower = inbound.filter((l) => l.half < widest - 0.6);
      governed = narrower.length ? narrower : inbound;
    }
    // One plate per approach and nothing under it: no ALL WAY plaque is inferred.
    for (const leg of governed) {
      if (kind === "stop") noteLegendApproach(junction, leg, "stop");
      const spot = approachPlacement(junction, leg, junction.legs);
      if (!spot) continue;
      const [lon, lat] = lonLatFromXZ(spot.x, spot.z);
      const base = { ...item, id: `${item.id}:approach:${Math.round(leg.bearing * 100)}`,
        p: [lon, lat], bearing: spot.yaw * 180 / Math.PI,
        geometry_basis: "inferred_junction_approach", label: kind === "yield" ? "YIELD" : "STOP" };
      out.push(base);
    }
  }
  return out;
}

//: Signal records (SFMTA junction points, OpenStreetMap nodes) as one head per approach.
function expandSignalApproaches(records) {
  const heads = [];
  const done = new Set();
  for (const item of records) {
    if (!item || !item.p) continue;
    const [x0, y0] = xy(item.p[0], item.p[1]);
    const junction = junctionNear(x0, -y0, 22);
    if (!junction) continue;
    const key = `${Math.round(junction.x / 4)}:${Math.round(junction.z / 4)}`;
    if (done.has(key)) continue;
    done.add(key);
    for (const leg of junction.legs.filter((l) => l.inbound)) {
      noteLegendApproach(junction, leg, "signal");
      const spot = approachPlacement(junction, leg, junction.legs, 0.7);
      if (!spot) continue;
      const top = pavementTopAt(spot.x, spot.z);
      heads.push({ x: spot.x, z: spot.z, yaw: spot.yaw,
        y: (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(spot.x, spot.z),
        source: item.source || "openstreetmap" });
    }
  }
  return heads;
}

// ---- the words and lines on the road at a junction ----
//
// A driver coming to a stop sign meets, in order: STOP written across the lane, the stop bar
// (a wide white line square across it), then the crosswalk. At a signal the bar is the limit
// line and nothing is written. Every approach a stop plate or a signal head was placed for is
// noted here (noteLegendApproach); the paint is laid once the crossings are down, and only
// where a crosswalk crosses that approach -- the bar stands behind the crosswalk, never on it.
// The city's own stop signs (SFMTA's inventory) are found their approach the same way.
const ROAD_LEGEND = {
  barWidth: 0.45,         // MUTCD: 12-24 in; SFMTA paints 18 in
  barBehindCrossing: 1.2, // 4 ft behind the crosswalk's near line
  wordGap: 1.5,           // from the bar to the word's foot
  wordLength: 2.8,        // 8 ft letters, drawn long as a driver sees them foreshortened
  wordWidth: 2.4,
  laneMin: 2.6,
  laneMax: 3.4,
};
//: Travel lanes arriving on a way, from the lane profile the lane lines are painted from:
//: its total on a one-way street, the larger direction's on a two-way one, else one.
function arrivingLanes(way, oneway) {
  const profile = way ? laneMarkingProfile(way) : null;
  if (!profile) return 1;
  if (oneway) return profile.total || 1;
  return Math.max(profile.forward || 0, profile.backward || 0, Math.floor((profile.total || 0) / 2), 1);
}
const legendApproaches = [];
const legendApproachKeys = new Set();
function noteLegendApproach(junction, leg, kind) {
  const key = `${Math.round(junction.x)}:${Math.round(junction.z)}:${Math.round(leg.bearing * 10)}`;
  if (legendApproachKeys.has(key)) return;
  legendApproachKeys.add(key);
  const oneway = onewaySign(leg.way) !== 0;
  legendApproaches.push({ jx: junction.x, jz: junction.z, ux: leg.ux, uz: leg.uz, half: leg.half,
    oneway, lanes: arrivingLanes(leg.way, oneway), kind });
}
//: The approach a city stop sign at (x, z) faces: the inbound leg whose post spot it is nearest.
function noteOfficialStopApproach(x, z) {
  const junction = junctionNear(x, z, 25);
  if (!junction) return false;
  let best = null, bestD = 12;
  for (const leg of junction.legs.filter((l) => l.inbound)) {
    const rx = leg.uz, rz = -leg.ux;
    const along = (x - junction.x) * leg.ux + (z - junction.z) * leg.uz;
    const side = (x - junction.x) * rx + (z - junction.z) * rz;
    if (along < 0 || side < 0) continue;
    const d = Math.abs(side - (leg.half + 1.5));
    if (d < bestD) { best = leg; bestD = d; }
  }
  if (best) noteLegendApproach(junction, best, "stop");
  return Boolean(best);
}
//: The crosswalk across an approach: the nearest drawn crossing square to it, within its road.
function approachCrosswalk(a) {
  const rx = a.uz, rz = -a.ux;
  const legBearing = Math.atan2(a.uz, a.ux);
  let best = null;
  const reach = a.half + 26;
  const c0x = Math.floor((a.jx - reach) / CROSSING_DEDUPE_CELL_M), c1x = Math.floor((a.jx + reach) / CROSSING_DEDUPE_CELL_M);
  const c0z = Math.floor((a.jz - reach) / CROSSING_DEDUPE_CELL_M), c1z = Math.floor((a.jz + reach) / CROSSING_DEDUPE_CELL_M);
  for (let cx = c0x; cx <= c1x; cx += 1) {
    for (let cz = c0z; cz <= c1z; cz += 1) {
      for (const pose of crossingDrawGrid.get(`${cx}:${cz}`) || []) {
        // An unmarked crossing is a place to cross with nothing painted: no bar behind it.
        if (pose.tag === "unmarked") continue;
        // Square to the approach, within 20 degrees: at 35 a leg read askew off a kink by the
        // junction (Post at Powell, 38 degrees out) took the crossing for its own, and its stop
        // bar was laid across the junction on the leg's line -- two long white bars in an X.
        if (crossingBearingDifference(pose.bearing, legBearing) < (70 * Math.PI) / 180) continue;
        const along = (pose.x - a.jx) * a.ux + (pose.z - a.jz) * a.uz;
        const side = (pose.x - a.jx) * rx + (pose.z - a.jz) * rz;
        if (along < 1.5 || along > 24 || Math.abs(side) > a.half + 2.5) continue;
        if (pose.length < a.half) continue;            // a crossing of part of the road only
        if (!best || along < best.along) best = { along, width: pose.width || 3.7 };
      }
    }
  }
  return best;
}
//: One word, white, in a tile of its own; cached by word.
const roadWordMaterials = new Map();
function roadWordMaterial(word) {
  if (roadWordMaterials.has(word)) return roadWordMaterials.get(word);
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f4ef";
  ctx.font = "bold 150px system-ui, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // As tall as the tile and no wider than it: the word is set, then squeezed across to fit.
  const wide = ctx.measureText(word).width;
  // Capitals are about 0.72 of the font size: stretched 2.2 times they fill the tile's height.
  ctx.save(); ctx.translate(128, 128); ctx.scale(Math.min(0.62, 244 / wide), 2.2); ctx.fillText(word, 0, 0); ctx.restore();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.35, roughness: 0.75,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
  roadWordMaterials.set(word, material);
  return material;
}
//: The paint for every noted approach. Returns counts.
function paintRoadLegends() {
  const bars = { pos: [], uv: [] }, words = new Map();
  const counts = { approaches: legendApproaches.length, bars: 0, words: 0, noCrosswalk: 0, offRoad: 0 };
  const lift = 0.034;
  // Cut to half a metre and each vertex stood on the ground: one quad across a street ran on
  // its chord, and the road, lifted at its own vertices, rose through the middle of the bar.
  const push = (list, corners) => {
    const [p0, p1, p2, p3] = corners;
    const n = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 0.5));
    const m = Math.max(1, Math.ceil(Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 0.5));
    const point = (i, j) => {
      const s = i / n, t = j / m;
      const mix = (k) => (p0[k] * (1 - s) + p1[k] * s) * (1 - t) + (p3[k] * (1 - s) + p2[k] * s) * t;
      const x = mix(0), z = mix(1);
      return [x, groundLiftAt(x, z) + ROAD_TOP_M + lift, z, mix(2), mix(3)];
    };
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < m; j += 1) {
        const q = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
        for (const k of [0, 1, 2, 0, 2, 3]) { list.pos.push(q[k][0], q[k][1], q[k][2]); list.uv.push(q[k][3], q[k][4]); }
      }
    }
  };
  const onRoad = (pts) => pts.every(([x, z]) => insideCarriageway(x, z, 0) && !insideJunctionBox(x, z));
  for (const a of legendApproaches) {
    const crosswalk = approachCrosswalk(a);
    if (!crosswalk) { counts.noCrosswalk += 1; continue; }
    const rx = a.uz, rz = -a.ux;
    // The lanes arriving: the right half of a two-way street, all of a one-way one.
    const o0 = a.oneway ? -a.half + 0.25 : 0.2, o1 = a.half - 0.25;
    if (o1 - o0 < ROAD_LEGEND.laneMin - 0.6) continue;
    if (o1 - o0 > 4 * ROAD_LEGEND.laneMax) continue;   // wider than four lanes: not a road's arrivals
    const at = (along, side) => [a.jx + a.ux * along + rx * side, a.jz + a.uz * along + rz * side];
    const b0 = crosswalk.along + crosswalk.width / 2 + ROAD_LEGEND.barBehindCrossing, b1 = b0 + ROAD_LEGEND.barWidth;
    const bar = [at(b0, o0), at(b0, o1), at(b1, o1), at(b1, o0)];
    if (!onRoad(bar)) { counts.offRoad += 1; continue; }
    push(bars, bar.map(([x, z]) => [x, z, 0, 0]));
    counts.bars += 1;
    if (a.kind !== "stop") continue;
    // STOP in each travel lane, its foot toward the driver: canvas bottom (v 0) at the far end.
    // The lanes are counted from the way's tags (a two-way street without them has one each
    // way) and run out from the centreline; what is left at the kerb is the parking lane.
    const lanes = Math.max(1, Math.min(4, a.lanes || 1));
    const lane = Math.min(ROAD_LEGEND.laneMax, (o1 - o0) / lanes);
    const first = a.oneway ? (o0 + o1) / 2 - (lane * lanes) / 2 : o0;
    const w0 = b1 + ROAD_LEGEND.wordGap, w1 = w0 + ROAD_LEGEND.wordLength;
    for (let i = 0; i < lanes; i += 1) {
      const mid = first + lane * (i + 0.5), half = Math.min(ROAD_LEGEND.wordWidth, lane - 0.5) / 2;
      // Driver's left is -r: canvas left (u 0) there.
      const quad = [[...at(w1, mid - half), 0, 0], [...at(w1, mid + half), 1, 0],
                    [...at(w0, mid + half), 1, 1], [...at(w0, mid - half), 0, 1]];
      if (!onRoad(quad)) { counts.offRoad += 1; continue; }
      if (!words.has("STOP")) words.set("STOP", { pos: [], uv: [] });
      push(words.get("STOP"), quad);
      counts.words += 1;
    }
  }
  const emit = (list, material) => {
    if (!list.pos.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(list.pos, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(list.uv, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { surface: "furniture:road_legend", source: "junction_control+drawn_crossings", liftedOntoGround: true };
    groups.furniture.add(mesh);
  };
  emit(bars, new THREE.MeshStandardMaterial({ color: 0xf2f5ef, roughness: 0.8, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
  for (const [word, list] of words) emit(list, roadWordMaterial(word));
  return counts;
}

// ---- no sign inside another, and none on a crossing ----
//
// A plate is a vertical rectangle: the line it runs along in plan, and its bottom and top.
// Plates on one post are stacked one under another whatever way each faces -- two plates at
// one height on one pole stood inside each other wherever their facings crossed -- and every
// plate is checked against the plates already standing near it before it is drawn.
const SIGN_CELL_M = 3.0;
//: Two plates nearer than this in plan, at heights that overlap, are one inside the other.
const SIGN_PLATE_CLEAR_M = 0.03;
//: A post keeps this far off a crossing's paint and off a kerb ramp and its warning pad.
const SIGN_CROSSING_CLEAR_M = 0.3;
//: The lowest a plate goes on its post: below this a sign is at a pedestrian's knees.
const PLATE_MIN_BOTTOM_M = 0.9;
//: A street-name blade's two faces either side of the post they are fixed to the top of.
const BLADE_FACE_OFFSET_M = 0.03;
//: The bottom of the lowest blade on a signal pole: under the signal head, above a lorry.
const SIGNAL_BLADE_BOTTOM_M = 3.0;
//: The signal head's box on its pole (addTrafficSignalHeads): middle and height, width.
const SIGNAL_HEAD_MID_M = 4.18;
const SIGNAL_HEAD_H_M = 0.98;
const SIGNAL_HEAD_W_M = 0.38;
let signPlateGrid = new Map();
const signStats = { plates: 0, blades: 0, cornerJunctions: 0, cornerPosts: 0, lowered: 0,
  overflowPosts: 0, dropped: 0, droppedPanels: 0, movedOffCrossing: 0, droppedOnCrossing: 0,
  clashes: 0, onCrossing: 0 };
window.kerbsideSigns = () => ({ ...signStats });

//: The gap between two segments in plan; zero where they cross.
function segmentGap2D(a0x, a0z, a1x, a1z, b0x, b0z, b1x, b1z) {
  const side = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = side(a0x, a0z, a1x, a1z, b0x, b0z), d2 = side(a0x, a0z, a1x, a1z, b1x, b1z);
  const d3 = side(b0x, b0z, b1x, b1z, a0x, a0z), d4 = side(b0x, b0z, b1x, b1z, a1x, a1z);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.sqrt(Math.min(
    distanceToSegmentSquared(a0x, a0z, b0x, b0z, b1x, b1z),
    distanceToSegmentSquared(a1x, a1z, b0x, b0z, b1x, b1z),
    distanceToSegmentSquared(b0x, b0z, a0x, a0z, a1x, a1z),
    distanceToSegmentSquared(b1x, b1z, a0x, a0z, a1x, a1z)));
}
//: A plate of width ``w`` whose middle is at (cx, cz), facing ``yaw``, from bottom to top.
function plateRect(post, cx, cz, yaw, w, bottom, top) {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), hw = w / 2;
  return { post, cx, cz, x0: cx - rx * hw, z0: cz - rz * hw, x1: cx + rx * hw, z1: cz + rz * hw,
    bottom, top };
}
//: Whether two plates would stand in each other. Two on one post never share a height, so
//: no two of them are ever at the same elevation, whichever ways they face.
function platesMeet(a, b) {
  if (a.bottom >= b.top || b.bottom >= a.top) return false;
  if (a.post !== null && a.post === b.post) return true;
  return segmentGap2D(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0, b.x1, b.z1) < SIGN_PLATE_CLEAR_M;
}
//: The cells a plate's run touches, widened by the clearance so two plates that nearly touch
//: across a cell's edge still share one.
function signCellsOf(rect) {
  const keys = [], m = SIGN_PLATE_CLEAR_M;
  for (let gx = Math.floor((Math.min(rect.x0, rect.x1) - m) / SIGN_CELL_M); gx <= Math.floor((Math.max(rect.x0, rect.x1) + m) / SIGN_CELL_M); gx += 1) {
    for (let gz = Math.floor((Math.min(rect.z0, rect.z1) - m) / SIGN_CELL_M); gz <= Math.floor((Math.max(rect.z0, rect.z1) + m) / SIGN_CELL_M); gz += 1) keys.push(`${gx}:${gz}`);
  }
  return keys;
}
//: The first standing plate this one would meet, or null: every plate on its own post first,
//: wherever its run lies, then every plate near it.
function plateClash(rect) {
  for (const other of rect.post?.plates || []) if (platesMeet(rect, other)) return other;
  for (const key of signCellsOf(rect)) {
    for (const other of signPlateGrid.get(key) || []) if (platesMeet(rect, other)) return other;
  }
  return null;
}
function registerPlate(rect) {
  if (rect.post) (rect.post.plates || (rect.post.plates = [])).push(rect);
  for (const key of signCellsOf(rect)) {
    let bucket = signPlateGrid.get(key);
    if (!bucket) signPlateGrid.set(key, bucket = []);
    bucket.push(rect);
  }
  return rect;
}
//: A plate placed as high as ``top`` allows and lowered under anything it would meet; null
//: when it would have to go below ``floor``.
function placePlate(post, cx, cz, yaw, w, h, top, floor) {
  for (let tries = 0; tries < 12; tries += 1) {
    if (top - h < floor) return null;
    const rect = plateRect(post, cx, cz, yaw, w, top - h, top);
    const other = plateClash(rect);
    if (!other) return registerPlate(rect);
    top = other.bottom - PLATE_GAP_M;
    signStats.lowered += 1;
  }
  return null;
}

//: A kerb ramp and its warning pad, as one quadrilateral: the pad's street edge, then back
//: across the ramp to its flared footway edge (addTactileWarningPad).
function rampFootprint(c) {
  const [c0, c1, c2, c3] = c;
  const width = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) || 1;
  const depth = Math.hypot(c3[0] - c0[0], c3[1] - c0[1]) || 1;
  const ax = (c1[0] - c0[0]) / width, az = (c1[1] - c0[1]) / width;
  const ox = (c3[0] - c0[0]) / depth, oz = (c3[1] - c0[1]) / depth;
  const back = Math.max(0, CURB_RAMP_DEPTH_M - depth), flare = CURB_RAMP_FLARE_M;
  return [c0, c1, [c2[0] + ax * flare + ox * back, c2[1] + az * flare + oz * back],
    [c3[0] - ax * flare + ox * back, c3[1] - az * flare + oz * back]];
}
let rampGrid = null;
function rampGridNow() {
  if (rampGrid && rampGrid.count === tactileWarningPads.length) return rampGrid;
  rampGrid = new Map();
  rampGrid.count = tactileWarningPads.length;
  for (const pad of tactileWarningPads) {
    const ring = rampFootprint(pad);
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / 4); gx <= Math.floor(Math.max(...xs) / 4); gx += 1) {
      for (let gz = Math.floor(Math.min(...zs) / 4); gz <= Math.floor(Math.max(...zs) / 4); gz += 1) {
        const key = `${gx}:${gz}`;
        if (!rampGrid.has(key)) rampGrid.set(key, []);
        rampGrid.get(key).push(ring);
      }
    }
  }
  return rampGrid;
}
//: Whether a post at (x, z) would stand on a crossing's paint or on a kerb ramp's warning
//: pad (or the ramp itself), or within SIGN_CROSSING_CLEAR_M of either.
function onCrossingGround(x, z, clear = SIGN_CROSSING_CLEAR_M) {
  const grid = rampGridNow();
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const ring of grid.get(`${Math.floor(x / 4) + dx}:${Math.floor(z / 4) + dz}`) || []) {
        if (pointInRing(x, z, ring)) return true;
        for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          if (distanceToSegmentSquared(x, z, a[0], a[1], b[0], b[1]) < clear * clear) return true;
        }
      }
    }
  }
  const cx = Math.floor(x / CROSSING_DEDUPE_CELL_M), cz = Math.floor(z / CROSSING_DEDUPE_CELL_M);
  for (let dx = -5; dx <= 5; dx += 1) {
    for (let dz = -5; dz <= 5; dz += 1) {
      for (const pose of crossingDrawGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        const c = Math.cos(pose.bearing), s = Math.sin(pose.bearing);
        const along = (x - pose.x) * c + (z - pose.z) * s;
        const across = -(x - pose.x) * s + (z - pose.z) * c;
        if (Math.abs(along) <= pose.length / 2 + clear && Math.abs(across) <= (pose.width || 3.7) / 2 + clear) return true;
      }
    }
  }
  return false;
}
//: The nearest ground within ``reach`` of (x, z) a post may stand on, or null.
function clearPostSpot(x, z, reach = 3.0) {
  if (!onCrossingGround(x, z)) return { x, z };
  for (let r = 0.5; r <= reach + 1e-6; r += 0.5) {
    for (let k = 0; k < 16; k += 1) {
      const a = k * Math.PI / 8;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (insideCarriageway(px, pz, 0.1) || insideJunctionBox(px, pz) || buildingAt(px, pz)) continue;
      if (!onCrossingGround(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

//: A street's name as its blade says it: "Hyde Street" is HYDE ST.
const BLADE_SUFFIXES = { STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", PLACE: "PL", DRIVE: "DR",
  ROAD: "RD", LANE: "LN", TERRACE: "TER", COURT: "CT", ALLEY: "ALY", HIGHWAY: "HWY", PARKWAY: "PKWY",
  EXPRESSWAY: "EXPY", CIRCLE: "CIR", SQUARE: "SQ" };
function bladeName(way) {
  const name = String(way && way.name || "").trim().toUpperCase();
  if (!name) return "";
  const words = name.split(/\s+/);
  const last = words[words.length - 1];
  if (BLADE_SUFFIXES[last]) words[words.length - 1] = BLADE_SUFFIXES[last];
  return words.join(" ");
}
//: Each junction of two differently named streets: one post on one corner and a blade for
//: each street, each blade running the way its street runs. Inferred from the streets.
function cornerStreetNameSigns() {
  if (!junctionVertexGrid) indexJunctionVertices();
  // Where two differently named streets meet: a vertex of one with a vertex of the other within
  // a few metres. Each street is recentred on its own kerbs, so the node they shared in the map
  // is seldom one point any more.
  const meets = [];
  for (const [key, bucket] of junctionVertexGrid) {
    const [cx, cz] = key.split(":").map(Number);
    for (const v of bucket) {
      const name = bladeName(v.way);
      if (!name) continue;
      let met = false;
      for (let dx = -1; dx <= 1 && !met; dx += 1) {
        for (let dz = -1; dz <= 1 && !met; dz += 1) {
          for (const o of junctionVertexGrid.get(`${cx + dx}:${cz + dz}`) || []) {
            if (o.way === v.way || Math.abs(o.x - v.x) > 3 || Math.abs(o.z - v.z) > 3) continue;
            const other = bladeName(o.way);
            if (other && other !== name) { met = true; break; }
          }
        }
      }
      if (met) meets.push(v);
    }
  }
  const done = new Map();
  const near = (x, z) => {
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const [px, pz] of done.get(`${Math.floor(x / 20) + dx}:${Math.floor(z / 20) + dz}`) || []) {
        if (Math.hypot(px - x, pz - z) < 20) return true;
      }
    }
    return false;
  };
  const out = [];
  for (const m of meets) {
    if (near(m.x, m.z)) continue;
    const legs = approachLegs(m.x, m.z, 4).filter((l) => bladeName(l.way));
    if (new Set(legs.map((l) => bladeName(l.way))).size < 2) continue;
    const cell = `${Math.floor(m.x / 20)}:${Math.floor(m.z / 20)}`;
    if (!done.has(cell)) done.set(cell, []);
    done.get(cell).push([m.x, m.z]);
    signStats.cornerJunctions += 1;
    const junction = { x: m.x, z: m.z };
    legs.sort((a, b) => a.bearing - b.bearing);
    for (const leg of legs) {
      const other = legs.find((l) => bladeName(l.way) !== bladeName(leg.way));
      const spot = approachPlacement(junction, leg, legs);
      if (!spot || !other) continue;
      const [lon, lat] = lonLatFromXZ(spot.x, spot.z);
      const id = `corner:${Math.round(m.x)}:${Math.round(m.z)}`;
      // A blade runs along its street: its face is square to the street's direction.
      for (const [i, l] of [leg, other].entries()) {
        out.push({ id: `${id}:${i}`, p: [lon, lat], sign_kind: "street_name", label: bladeName(l.way),
          bearing: Math.atan2(l.uz, -l.ux) * 180 / Math.PI, tags: { SIGN_CATEGORY: "STREET NAME" },
          geometry_basis: "inferred_junction_corner", blade: i });
      }
      signStats.cornerPosts += 1;
      break;
    }
  }
  return out;
}

function addOfficialSignPlates(records, signalHeads = []) {
  // Every sign on its post, the plates stacked where several share one.
  signPlateGrid = new Map();
  const seenFaces = new Set();
  const anchors = records.map((item, index) => ({ item, index, anchor: furnitureAnchor(item) }))
    .filter((row) => {
      if (!row.anchor) return false;
      const key = `${itemFaceKey(row.item)}:${row.item.p.join(",")}`;
      if (seenFaces.has(key)) return false;
      seenFaces.add(key);
      return true;
    });
  // One post per point: rows within PLATE_SAME_POST_M of an earlier one join it. A signal
  // pole is a post already standing, and a sign beside one is fixed to it.
  const cell = 2.0;
  const grid = new Map();
  const posts = [];
  const file = (post) => {
    const key = `${Math.floor(post.anchor.x / cell)}:${Math.floor(post.anchor.z / cell)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, bucket = []);
    bucket.push(post);
  };
  for (const head of signalHeads) {
    const post = { anchor: { x: head.x, y: head.y, z: head.z }, raw: { x: head.x, z: head.z },
      rows: [], kind: "sign", signal: head };
    posts.push(post);
    file(post);
    // The head itself stands on the pole: nothing is drawn through it.
    registerPlate(plateRect(post, head.x, head.z, head.yaw, SIGNAL_HEAD_W_M,
      head.y + SIGNAL_HEAD_MID_M - SIGNAL_HEAD_H_M / 2, head.y + SIGNAL_HEAD_MID_M + SIGNAL_HEAD_H_M / 2));
  }
  for (const row of anchors) {
    const kind = plateAssetKind(row.item);
    // Where the inventory put it, as well as where it was carried to: two plates the city
    // recorded a metre apart belong on one pole even when one of them had to be moved off
    // the roadway and the other did not.
    const [rx0, ry0] = xy(row.item.p[0], row.item.p[1]);
    row.raw = { x: rx0, z: -ry0 };
    let post = null;
    if (kind === "sign") {
      for (let dx = -1; dx <= 1 && !post; dx += 1) {
        for (let dz = -1; dz <= 1 && !post; dz += 1) {
          for (const other of grid.get(`${Math.floor(row.anchor.x / cell) + dx}:${Math.floor(row.anchor.z / cell) + dz}`) || []) {
            if (other.kind !== "sign") continue;
            const near = Math.hypot(other.anchor.x - row.anchor.x, other.anchor.z - row.anchor.z) <= PLATE_SAME_POST_M
              || Math.hypot(other.raw.x - row.raw.x, other.raw.z - row.raw.z) <= PLATE_SAME_POST_M;
            if (near) { post = other; break; }
          }
        }
      }
    }
    if (post) { post.rows.push(row); continue; }
    post = { anchor: row.anchor, raw: row.raw, rows: [row], kind };
    if (kind === "sign") {
      // Not on a crossing's paint, nor on the kerb ramp at its end: the nearest clear ground.
      const clear = clearPostSpot(row.anchor.x, row.anchor.z);
      if (!clear) { signStats.droppedOnCrossing += 1; continue; }
      if (clear.x !== row.anchor.x || clear.z !== row.anchor.z) {
        const top = pavementTopAt(clear.x, clear.z);
        post.anchor = { x: clear.x, z: clear.z,
          y: (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(clear.x, clear.z) };
        signStats.movedOffCrossing += 1;
      }
    }
    posts.push(post);
    file(post);
  }
  // The backs read the same atlas for their outline and are painted over it in grey, so
  // they are sunk by atlas as the faces are.
  const backSinks = new Map();
  let signs = 0;
  const postsByHeight = new Map();
  const racks = [];
  const delineators = [];
  const lanterns = [];
  // One face of a plate: a quad reading ``slot`` from ``sink``, facing ``yaw``.
  const quad = (sink, slot, cx, cz, yaw, bottom, top, mirrored = false) => {
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), hw = slot.w / 2;
    const s = mirrored ? -1 : 1;
    const base = sink.positions.length / 3;
    const corners = [[cx - s * rx * hw, bottom, cz - s * rz * hw], [cx + s * rx * hw, bottom, cz + s * rz * hw],
      [cx + s * rx * hw, top, cz + s * rz * hw], [cx - s * rx * hw, top, cz - s * rz * hw]];
    const uv = mirrored
      ? [[slot.u1, slot.v0], [slot.u0, slot.v0], [slot.u0, slot.v1], [slot.u1, slot.v1]]
      : [[slot.u0, slot.v0], [slot.u1, slot.v0], [slot.u1, slot.v1], [slot.u0, slot.v1]];
    for (let i = 0; i < 4; i += 1) {
      sink.positions.push(corners[i][0], corners[i][1], corners[i][2]);
      sink.uvs.push(uv[i][0], uv[i][1]);
      sink.colours.push(1, 1, 1);
    }
    sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // A post holds what fits on it between the panel height and a pedestrian's knee; what does
  // not goes on a second post beside it along the kerb, as the city puts up a second pole.
  const overflowSpot = (post, yaw) => {
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    for (const d of [1.4, -1.4, 2.0, -2.0, 2.7, -2.7]) {
      const x = post.anchor.x + ax * d, z = post.anchor.z + az * d;
      if (insideCarriageway(x, z, 0.1) || insideJunctionBox(x, z) || buildingAt(x, z) || onCrossingGround(x, z)) continue;
      const top = pavementTopAt(x, z);
      return { x, z, y: (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(x, z) };
    }
    return null;
  };
  for (let k = 0; k < posts.length; k += 1) {
    const post = posts[k];
    if (post.kind === "bike_rack") { racks.push(post); continue; }
    if (post.kind === "delineator") { delineators.push(post); continue; }
    if (post.kind === "lantern") { lanterns.push(post); continue; }
    // Stop first, then the rest, top down; the street-name blades go on top of the post.
    const order = { stop: 0 };
    post.rows.sort((a, b) => (order[plateStyleFor(a.item)] ?? 2) - (order[plateStyleFor(b.item)] ?? 2));
    const blades = post.rows.filter((row) => plateStyleFor(row.item) === "street_name")
      .sort((a, b) => (a.item.blade ?? 0) - (b.item.blade ?? 0));
    // The same plate twice on one pole, facing the same way, is one plate recorded twice: the
    // inventory and OpenStreetMap both, or two survey passes. It was drawn twice, stacked.
    const platesHere = new Set();
    let top = post.anchor.y + FURNITURE_PANEL_BOTTOM_M;
    let first = true;
    let highest = post.anchor.y + FURNITURE_PANEL_BOTTOM_M;
    const overflow = [];
    let overflowYaw = 0;
    for (const row of post.rows) {
      if (plateStyleFor(row.item) === "street_name") continue;
      const slot = plateSlot(row.item);
      const yaw = furnitureBearing(row.item, row.index, post.anchor);
      const same = `${slot.style}|${plateLegend(row.item.label)}|${Math.round(yaw * 12 / Math.PI)}`;
      if (platesHere.has(same)) continue;
      platesHere.add(same);
      if (first) top += slot.h;
      first = false;
      const nx = Math.sin(yaw), nz = Math.cos(yaw);
      const cx = post.anchor.x + nx * PLATE_STANDOFF_M;
      const cz = post.anchor.z + nz * PLATE_STANDOFF_M;
      const rect = placePlate(post, cx, cz, yaw, slot.w, slot.h, top, post.anchor.y + PLATE_MIN_BOTTOM_M);
      if (!rect) {
        if (!overflow.length) overflowYaw = yaw;
        overflow.push(row);
        platesHere.delete(same);
        continue;
      }
      highest = Math.max(highest, rect.top);
      quad(slot.atlas.sink, slot, cx, cz, yaw, rect.bottom, rect.top);
      // The back: aluminium, the same outline, a hair behind the face, wound the other way.
      const shadow = plateSilhouetteSlot(slot.style);
      let backSink = backSinks.get(shadow.atlas.index);
      if (!backSink) backSinks.set(shadow.atlas.index, backSink = newSink());
      quad(backSink, shadow, cx - nx * 0.004, cz - nz * 0.004, yaw, rect.bottom, rect.top, true);
      top = rect.bottom - PLATE_GAP_M;
      signs += 1;
      signStats.plates += 1;
    }
    if (overflow.length) {
      const spot = (post.depth || 0) < 3 ? overflowSpot(post, overflowYaw) : null;
      if (spot) {
        const sibling = { anchor: spot, raw: { x: spot.x, z: spot.z }, rows: overflow, kind: "sign",
          depth: (post.depth || 0) + 1 };
        posts.push(sibling);
        signStats.overflowPosts += 1;
      } else signStats.dropped += overflow.length;
    }
    // The blades: on top of the post, above every plate on it, one over the other -- or on a
    // signal pole under its head. Each reads the same both sides, as a street blade does.
    let bladeBottom = post.signal ? post.anchor.y + SIGNAL_BLADE_BOTTOM_M
      : Math.max(post.anchor.y + FURNITURE_POST_H_M - 0.3, highest + PLATE_GAP_M);
    const namesHere = new Set();
    for (const row of blades) {
      const name = plateLegend(row.item.label);
      if (namesHere.has(name)) continue;
      namesHere.add(name);
      const slot = plateSlot(row.item);
      const yaw = furnitureBearing(row.item, row.index, post.anchor);
      // Upward only: a blade that would meet something is raised over it, never lowered
      // onto the plates under it.
      let rect = null;
      for (let tries = 0; tries < 6 && !rect; tries += 1) {
        const trial = plateRect(post, post.anchor.x, post.anchor.z, yaw, slot.w, bladeBottom, bladeBottom + slot.h);
        const other = plateClash(trial);
        if (!other) rect = registerPlate(trial);
        else bladeBottom = other.top + PLATE_GAP_M;
      }
      if (!rect) { signStats.dropped += 1; continue; }
      const nx = Math.sin(yaw), nz = Math.cos(yaw);
      quad(slot.atlas.sink, slot, post.anchor.x + nx * BLADE_FACE_OFFSET_M, post.anchor.z + nz * BLADE_FACE_OFFSET_M,
        yaw, rect.bottom, rect.top);
      quad(slot.atlas.sink, slot, post.anchor.x - nx * BLADE_FACE_OFFSET_M, post.anchor.z - nz * BLADE_FACE_OFFSET_M,
        yaw + Math.PI, rect.bottom, rect.top);
      bladeBottom = rect.top + PLATE_GAP_M;
      highest = Math.max(highest, rect.top);
      signs += 1;
      signStats.blades += 1;
    }
    if (post.signal) continue;                              // the signal draws its own pole
    // The post reaches the top of whatever is on it.
    const height = Math.max(FURNITURE_POST_H_M, Math.ceil((highest - post.anchor.y + 0.05) * 10) / 10);
    if (!postsByHeight.has(height)) postsByHeight.set(height, []);
    postsByHeight.get(height).push(post.anchor);
  }
  for (const atlas of plateAtlases) {
    const mesh = flushSink(atlas.sink, plateMaterial(atlas), "furniture:sign_plate");
    if (mesh) groups.furniture.add(mesh);
    atlas.sink = newSink();
  }
  for (const [index, backSink] of backSinks) {
    const material = new THREE.MeshStandardMaterial({
      map: plateAtlases[index].texture, transparent: true, alphaTest: 0.5,
      side: THREE.FrontSide, roughness: 0.6, metalness: 0.35,
    });
    const mesh = flushSink(backSink, material, "furniture:sign_back");
    if (mesh) groups.furniture.add(mesh);
  }
  // The posts, at the points, with the plates in front of them.
  let postCount = 0;
  for (const [height, list] of postsByHeight) postCount += addFurniturePostsAt(list, height, 0.026, 0x9aa1a3);
  addBikeRacks(racks.map((p) => p.anchor));
  addFurniturePostsAt(delineators.map((p) => p.anchor), 1.1, 0.04, 0xf4f4f0);
  addFurniturePostsAt(lanterns.map((p) => p.anchor), 3.2, 0.05, 0x2f3436);
  return { signs, posts: postCount, racks: racks.length, delineators: delineators.length,
    spots: posts.filter((p) => p.kind === "sign" && !p.signal).map((p) => p.anchor) };
}

//: The audit of what was drawn: any two plates that meet, and any post on a crossing. Both
//: must be zero; window.kerbsideSigns() reports them.
function auditSignPlates(postSpots) {
  let clashes = 0;
  const seen = new Set();
  for (const bucket of signPlateGrid.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (!platesMeet(bucket[i], bucket[j])) continue;
        const key = [bucket[i], bucket[j]].map((r) => `${r.cx.toFixed(2)},${r.cz.toFixed(2)},${r.bottom.toFixed(2)}`).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        clashes += 1;
      }
    }
  }
  signStats.clashes = clashes;
  signStats.onCrossing = postSpots.filter((p) => onCrossingGround(p.x, p.z, 0)).length;
  return signStats;
}

function addFurniturePostsAt(anchors, height, radius, colour) {
  if (!anchors.length) return 0;
  const mesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(radius, radius * 1.2, 1, 6),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.48, metalness: 0.54 }),
    anchors.length);
  const dummy = new THREE.Object3D();
  anchors.forEach((a, i) => {
    dummy.position.set(a.x, a.y + height / 2, a.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.surface = "furniture:post";
  groups.furniture.add(mesh);
  return anchors.length;
}

function addTrafficSignalHeads(records) {
  // A head for each approach of each signalised junction (expandSignalApproaches): SFMTA's
  // points in San Francisco, OpenStreetMap's elsewhere. Each locates a junction, not a live
  // phase, so no lens claims a red or a green.
  const rows = records.map((head) => ({ item: { bearing: head.yaw * 180 / Math.PI }, index: 0,
    anchor: { x: head.x, y: head.y, z: head.z } }));
  if (!rows.length) return 0;
  addFurniturePostsAt(rows.map((r) => r.anchor), 4.65, 0.075, 0x4b5051);
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x202524, roughness: 0.58, metalness: 0.32 }), rows.length);
  const lamps = [0xb62928, 0xd29a23, 0x248b4b].map((color) =>
    new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.08,
        roughness: 0.22 }), rows.length));
  const dummy = new THREE.Object3D();
  rows.forEach((row, index) => {
    const yaw = furnitureBearing(row.item, row.index, row.anchor);
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    dummy.position.set(row.anchor.x, row.anchor.y + 4.18, row.anchor.z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(0.38, 0.98, 0.26);
    dummy.updateMatrix();
    body.setMatrixAt(index, dummy.matrix);
    [0.31, 0, -0.31].forEach((offset, lamp) => {
      dummy.position.set(row.anchor.x + nx * 0.145,
        row.anchor.y + 4.18 + offset, row.anchor.z + nz * 0.145);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(0.105, 0.105, 0.048);
      dummy.updateMatrix();
      lamps[lamp].setMatrixAt(index, dummy.matrix);
    });
  });
  body.instanceMatrix.needsUpdate = true;
  body.userData = { surface: "furniture:traffic_signal", phase: "unknown",
    placement: "inferred_junction_approach" };
  groups.furniture.add(body);
  lamps.forEach((lamp, index) => {
    lamp.instanceMatrix.needsUpdate = true;
    lamp.userData = { surface: `furniture:signal_lens:${index}`, phase: "unknown" };
    groups.furniture.add(lamp);
  });
  return rows.length;
}

