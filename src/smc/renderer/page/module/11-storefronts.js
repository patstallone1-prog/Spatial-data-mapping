// ---- storefronts ----
//
// A shopfront is drawn for what the shop is. Every business used to get the same picture --
// two big panes, a door between, a coloured band over -- stretched across as much as eighteen
// metres of wall, so a bank, a laundromat and a taqueria were the same cafe at three widths.
// Each trade now has its own front: the restaurant's panes and central doors, the bar's small
// dark windows, the grocer's glass with the produce stacked in it, the boutique's display
// windows either side of a recessed door, the bank's pilasters and tall windows, the
// laundromat's row of machines. Each comes in variants -- door left, right or centre, panes
// split or whole -- and the wall is divided into bays, one per business, so the sign over
// each bay is the sign of the shop in it.
//
// The ground storey of a building with shops in it is painted its own colour: shopfronts are
// fitted out separately from the building they are in and nearly always in a different
// colour. Nothing in the records says which, so the colour is chosen to go with the building
// -- analogous or complementary on the wheel, with real contrast in lightness -- from the
// colours San Francisco's shopfronts are actually painted, by trade, and it is the same
// colour on every load. A standalone shop, a single storey with nothing above it, is built
// differently from a shop under a block of flats: full-height glazing to a fascia and a
// parapet, rather than a storey under a cornice.
const STOREFRONT_BAND_M = 3.9;
const STOREFRONT_MIN_WALL_M = 2.6;
const STOREFRONT_STANDALONE_MAX_M = 6.5;
//: What a shopfront frame is painted, by trade: the colours the city's shopfronts have.
const STOREFRONT_PALETTES = {
  restaurant: [0x6b2a24, 0x1f4f3a, 0x1f3450, 0x1b1c1e, 0x8c5a2b],
  pizza:      [0x8f2b23, 0x1f4f3a, 0x1b1c1e, 0xd9cfb8],
  cafe:       [0x1f4f3a, 0x3d2b1f, 0x1b1c1e, 0x6b2a24, 0x2e5a6e],
  bakery:     [0xd9cfb8, 0x6b2a24, 0x2e5a6e, 0x3d2b1f],
  bar:        [0x1b1c1e, 0x6b2a24, 0x143a3f, 0x2a2a3a],
  grocery:    [0x1f5f3a, 0xd9cfb8, 0x9c2f2a, 0x2a4a7a],
  clothing:   [0x1b1c1e, 0xe8e4dc, 0x6f6f6f, 0x1f3450, 0xd9cfb8],
  books:      [0x1f4f3a, 0x6b2a24, 0x3d2b1f, 0x1f3450],
  salon:      [0x1b1c1e, 0xe8e4dc, 0x7a3f5a, 0x2e5a6e],
  pharmacy:   [0xe8e4dc, 0x2a4a7a, 0x1f5f3a],
  bank:       [0xa8a08e, 0x1f4f3a, 0x1f3450, 0x4a4a48],
  laundry:    [0x2a6fa8, 0xe8e4dc, 0x1f5f3a],
  hardware:   [0x9c2f2a, 0x4a4a48, 0x1f3450, 0x8c5a2b],
  florist:    [0x1f5f3a, 0x7a3f5a, 0xd9cfb8, 0x2e5a6e],
  hotel:      [0xd9cfb8, 0x1f4f3a, 0x6b2a24, 0x4a4a48],
  office:     [0x4a4a48, 0x1b1c1e, 0x6f6f6f, 0xa8a08e],
  shop:       [0x1b1c1e, 0x1f4f3a, 0x1f3450, 0x6b2a24, 0xd9cfb8, 0x4a4a48],
};

function hasStorefront(feature) {
  if (feature.shops && feature.shops.length) return true;
  if (feature.inferredShop) return true;
  return ["retail", "restaurant", "office", "hotel"].includes(feature.archetype);
}

//: Zoning under which a ground floor on a shopping street is a shop: the city's neighbourhood
//: commercial districts (NC-1..3, NCT and the named streets), community business, Chinatown's,
//: and downtown retail. Residential-commercial (RC) is flats over the odd shop, and is left.
const SHOP_ZONING = /NEIGHBORHOOD COMMERCIAL|COMMUNITY BUSINESS|CHINATOWN|DOWNTOWN- RETAIL|DOWNTOWN- GENERAL|NEIGHBORHOOD COMMERCIAL TRANSIT/;
//: A building nobody named a business in is a shop when it is zoned for one and stands in a run
//: of shops: at least this many named ones on its own street within SHOP_RUN_M of it.
const SHOP_RUN_NEIGHBOURS = 2;
const SHOP_RUN_M = 45;
function streetKey(address) {
  const street = String(address?.street || "").toLowerCase()
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|way|place|pl|road|rd|drive|dr|lane|ln)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return street || null;
}
//: The shops nobody has named: a building drawn as a house on a shopping street was a shop
//: drawn wrong (Chestnut, Union, Fillmore). It is drawn as a shopfront with no name on it --
//: a name is never made up -- and its card says why.
function inferUnnamedShops(ways) {
  const named = new Map();
  for (const way of ways) {
    if (way.kind !== "building" || !way.shops?.length || !way.centroid) continue;
    const key = streetKey(way.address);
    if (!key) continue;
    if (!named.has(key)) named.set(key, []);
    named.get(key).push(xy(...way.centroid));
  }
  let inferred = 0;
  for (const way of ways) {
    if (way.kind !== "building" || way.shops?.length || !way.centroid
        || !["residential", "generic"].includes(way.archetype)
        || !SHOP_ZONING.test(String(way.zoning?.district || way.land_use || ""))) continue;
    const run = named.get(streetKey(way.address));
    if (!run) continue;
    const [x, y] = xy(...way.centroid);
    if (run.filter(([a, b]) => Math.hypot(a - x, b - y) <= SHOP_RUN_M).length < SHOP_RUN_NEIGHBOURS) continue;
    way.inferredShop = true;
    inferred += 1;
  }
  return inferred;
}

//: The wall a business faces the street with: of the walls in front of a street with nothing
//: built against them, the nearest the street (and of two about as near, the wider); a shop
//: whose longest wall ran down its side had its glass, its sign and its door on the side.
function storefrontWall(feature) {
  if (feature._storefrontWall !== undefined) return feature._storefrontWall;
  const facing = footprintWalls(feature.points).filter((w) => w.span >= 2.4)
    .map((w) => ({ w, d: streetDistanceFacing(w) }))
    .filter((r) => r.d < 40 && !buildingAt(r.w.x + r.w.nx * 1.0, r.w.z + r.w.nz * 1.0));
  const nearest = Math.min(...facing.map((r) => r.d));
  const best = facing.filter((r) => r.d <= nearest + 3).sort((a, b) => b.w.span - a.w.span)[0];
  feature._storefrontWall = best ? best.w : bestFacadeWall(feature, false);
  return feature._storefrontWall;
}

//: Whether the wall from ``a`` to ``b`` (scene x, z) is the one a person edited on this building:
//: its ends where the edit's corners are, either way round.
function editedEdge(way, a, b) {
  const edit = way?.exteriorEdit;
  if (!edit) return false;
  const [px, py] = xy(...edit.wall.a), [qx, qy] = xy(...edit.wall.b);
  const near = (p, x, z) => Math.hypot(p[0] - x, p[1] - z) < 0.25;
  return (near(a, px, -py) && near(b, qx, -qy)) || (near(a, qx, -qy) && near(b, px, -py));
}
//: The garages on an edited wall are the edit's: the city's kerb cut stays dropped, but what
//: stands behind it is what the person drew.
function dropEditedWallGarages(feature) {
  if (!feature.exteriorEdit || !feature.garages?.length) return;
  const [px, py] = xy(...feature.exteriorEdit.wall.a), [qx, qy] = xy(...feature.exteriorEdit.wall.b);
  const len = Math.hypot(qx - px, qy - py) || 1, ux = (qx - px) / len, uy = (qy - py) / len;
  feature.garages = feature.garages.filter((g) => {
    const [ax, ay] = xy(g.a[0], g.a[1]), [bx, by] = xy(g.b[0], g.b[1]);
    const gx = ax + (bx - ax) * g.t, gy = ay + (by - ay) * g.t;
    const along = (gx - px) * ux + (gy - py) * uy, off = Math.abs((gx - px) * -uy + (gy - py) * ux);
    return !(off < 1.0 && along > -0.5 && along < len + 0.5);
  });
}
//: A shop's street wall is glass and a door, not a garage: a dropped kerb in front of one is a
//: loading bay or the way into a yard behind, and its door is drawn only where there is room for
//: a vehicle entrance beside the shops (a wide cut in a long wall). The kerb itself stays dropped.
const STORE_GARAGE_MIN_CUT_M = 3.0;
const STORE_GARAGE_MIN_WALL_M = 12;
function dropStorefrontGarages(feature) {
  if (!feature.garages?.length || !hasStorefront(feature)) return;
  const wall = storefrontWall(feature);
  if (!wall) return;
  const onFront = new Set(garagesOnWall(feature, wall).map((g) => g.ref));
  feature.garages = feature.garages.filter((g) => !onFront.has(g)
    || ((g.cut_m || g.w || 0) >= STORE_GARAGE_MIN_CUT_M && wall.span >= STORE_GARAGE_MIN_WALL_M));
}

function storefrontColour(tint, trade, seed) {
  // The frame's colour, chosen to go with the building it is cut into. Of the trade's own
  // colours, those that sit with the building on the wheel -- within forty degrees of it, or
  // opposite it, or neutral -- and stand off it in lightness; then one of those by the seed.
  // If none does, the building's own colour taken a long way darker or lighter.
  const building = new THREE.Color(tint);
  const hsl = {};
  building.getHSL(hsl, THREE.SRGBColorSpace);
  const candidates = (STOREFRONT_PALETTES[trade] || STOREFRONT_PALETTES.shop).map((hex) => {
    const c = new THREE.Color(hex);
    const h = {};
    c.getHSL(h, THREE.SRGBColorSpace);
    let apart = Math.abs(h.h - hsl.h) * 360;
    apart = Math.min(apart, 360 - apart);
    const neutral = h.s < 0.14 || hsl.s < 0.14;
    const harmonious = neutral || apart <= 40 || Math.abs(apart - 180) <= 25;
    const contrast = Math.abs(h.l - hsl.l) >= 0.16;
    return { c, ok: harmonious && contrast };
  });
  const fit = candidates.filter((k) => k.ok);
  if (fit.length) return fit[Math.floor(random(seed + 4.1) * fit.length) % fit.length].c;
  const own = new THREE.Color(tint);
  own.setHSL(hsl.h, Math.min(0.6, hsl.s + 0.1), hsl.l > 0.45 ? Math.max(0.12, hsl.l - 0.3)
    : Math.min(0.85, hsl.l + 0.3), THREE.SRGBColorSpace);
  return own;
}

function shopBays(feature, wall) {
  // The wall divided among its businesses, or into fronts of a business's usual width where
  // the building is of a business's kind but nobody is named in it.
  const shops = (feature.shops || []).filter((shop) => shop && shop.n);
  const count = shops.length
    ? Math.max(1, Math.min(shops.length, Math.floor(wall.span / 5.0)))
    : Math.max(1, Math.min(4, Math.round(wall.span / 7.5)));
  const share = wall.span / count;
  const bays = [];
  for (let i = 0; i < count; i += 1) {
    const shop = shops[i] || null;
    const trade = shop ? (shop.t || "shop")
      : feature.archetype === "restaurant" ? "restaurant"
        : feature.archetype === "hotel" ? "hotel"
          : feature.archetype === "office" ? "office" : "shop";
    bays.push({ shop, trade, centre: -wall.span / 2 + share * (i + 0.5), share });
  }
  return bays;
}

const STOREFRONT_TEXTURES = new Map();
//: Six fronts per trade: the door at the centre, the left or the right, each either modern (glass
//: nearly to the pavement) or traditional (a panelled stall riser and a transom of small panes).
const STOREFRONT_VARIANTS = 6;
//: A shop door is a metre wide, a pair 1.8 m: trades whose doors are a pair, and the width of
//: front past which any shop's is.
const DOOR_SINGLE_M = 0.95;
const DOOR_PAIR_M = 1.8;
const PAIR_DOOR_TRADES = new Set(["restaurant", "hotel", "bank", "grocery", "pharmacy", "office", "hardware"]);
const PAIR_DOOR_FRONT_M = 6.5;
//: A front's width in the texture's cache: the nearest of these, so its door is to scale.
const STOREFRONT_WIDTHS_M = [3.5, 5.5, 8];

function storefrontTexture(trade, variant, frameHex, standalone, preserveWall = false, widthM = 5.5) {
  const metres = STOREFRONT_WIDTHS_M.reduce((a, b) => (Math.abs(b - widthM) < Math.abs(a - widthM) ? b : a));
  const key = `${trade}|${variant}|${frameHex}|${standalone ? "s" : "u"}|${preserveWall ? "photo-band" : "fallback"}|${metres}`;
  if (STOREFRONT_TEXTURES.has(key)) return STOREFRONT_TEXTURES.get(key);
  const W = 256;
  const H = 128;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  const frame = `#${frameHex.toString(16).padStart(6, "0")}`;
  const frameColour = new THREE.Color(frameHex);
  const fh = {};
  frameColour.getHSL(fh, THREE.SRGBColorSpace);
  const lightFrame = fh.l > 0.5;
  const trim = lightFrame ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.22)";
  const seed = variant * 37 + trade.length * 11;
  const rnd = (k) => random(seed + k);

  // The frame: the whole ground storey in the shopfront's colour. A standalone shop runs its
  // glazing high and finishes in a fascia; one under flats has a stall riser and a transom
  // under the storey above.
  ctx.fillStyle = frame;
  if (!preserveWall) ctx.fillRect(0, 0, W, H);
  const traditional = variant >= 3;
  const riser = traditional ? 26 : standalone ? 10 : 16;   // the stall riser at the foot of the glass
  const head = standalone ? 30 : 22;             // the fascia above the glass
  const top = head;
  const bottom = H - riser;
  const gap = 6;

  // The door: centre, left or right, and to scale -- a single leaf or a pair, by trade and by
  // how wide the front is. It was a fixed number of pixels, a narrow front's door a metre and a
  // half wide and a supermarket's a slot.
  const pxPerM = W / metres;
  const pair = PAIR_DOOR_TRADES.has(trade) ? metres >= 5 : metres >= PAIR_DOOR_FRONT_M;
  const doorW = Math.round((pair ? DOOR_PAIR_M : DOOR_SINGLE_M) * pxPerM);
  const doorAt = ["centre", "left", "right"][variant % 3];
  const doorX = doorAt === "centre" ? W / 2 - doorW / 2 : doorAt === "left" ? gap + 4 : W - gap - 4 - doorW;
  const glass = (x0, x1, y0, y1, tone = 0) => {
    // A pane: the sky in the top of it, the dark of the shop in the bottom, a reflection
    // across it.
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, tone > 0 ? "rgba(214,226,232,0.92)" : "rgba(150,182,198,0.88)");
    g.addColorStop(0.55, tone > 0 ? "rgba(120,148,164,0.9)" : "rgba(70,94,108,0.92)");
    g.addColorStop(1, "rgba(28,36,42,0.94)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x0 + (x1 - x0) * 0.45, y0); ctx.lineTo(x0 + (x1 - x0) * 0.62, y0);
    ctx.lineTo(x0 + (x1 - x0) * 0.17, y1);
    ctx.closePath();
    ctx.fill();
  };
  const mullions = (x0, x1, y0, y1, n) => {
    ctx.fillStyle = frame;
    for (let i = 1; i < n; i += 1) ctx.fillRect(x0 + ((x1 - x0) * i) / n - 1.5, y0, 3, y1 - y0);
  };
  const door = (x, w, dark = true, glazed = true) => {
    ctx.fillStyle = dark ? "rgba(30,26,22,0.96)" : frame;
    ctx.fillRect(x, top + 4, w, bottom - top - 4 + riser - 2);
    if (glazed) {
      ctx.fillStyle = "rgba(120,150,166,0.85)";
      ctx.fillRect(x + 3, top + 8, w - 6, (bottom - top) * 0.62);
      // The meeting stiles of a pair.
      if (w >= 1.5 * pxPerM) { ctx.fillStyle = trim; ctx.fillRect(x + w / 2 - 0.75, top + 4, 1.5, bottom - top); }
    }
    ctx.fillStyle = "rgba(255,232,160,0.8)";
    ctx.fillRect(x + w - 6, top + (bottom - top) * 0.55, 2, 3);
  };
  const glow = (x0, x1, colour) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x0, top + 6, x1 - x0, (bottom - top) * 0.5);
  };
  const shelves = (x0, x1, colours, rows = 3) => {
    // What is in the window: rows of goods in the colours of the trade.
    let k = 0;
    for (let r = 0; r < rows; r += 1) {
      const y = top + 10 + ((bottom - top - 16) * (r + 0.5)) / rows;
      for (let x = x0 + 4; x < x1 - 4; x += 5) {
        k += 1;
        ctx.fillStyle = colours[Math.floor(rnd(k * 3.3) * colours.length)];
        ctx.fillRect(x, y - 3 + rnd(k) * 2, 4, 6 + rnd(k * 1.7) * 3);
      }
      ctx.fillStyle = "rgba(240,236,224,0.5)";
      ctx.fillRect(x0 + 3, y + 5, x1 - x0 - 6, 1);
    }
  };
  const panes = [];                                // [x0, x1] of the glazing either side of the door
  if (doorAt === "centre") {
    panes.push([gap, doorX - gap], [doorX + doorW + gap, W - gap]);
  } else if (doorAt === "left") {
    panes.push([doorX + doorW + gap, W - gap]);
  } else {
    panes.push([gap, doorX - gap]);
  }

  // The trade's own front.
  switch (trade) {
    case "restaurant":
    case "pizza": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom);
        glow(x0, x1, trade === "pizza" ? "rgba(255,170,80,0.22)" : "rgba(255,214,150,0.2)");
        mullions(x0, x1, top, bottom, variant === 3 ? 3 : 2);
        // Tables in the window, and a menu in the corner.
        for (let x = x0 + 12; x < x1 - 12; x += 22) {
          ctx.fillStyle = "rgba(240,236,224,0.75)";
          ctx.fillRect(x, bottom - 22, 12, 2);
          ctx.fillStyle = "rgba(60,44,30,0.9)";
          ctx.fillRect(x + 5, bottom - 20, 2, 10);
        }
        ctx.fillStyle = "rgba(245,240,225,0.9)";
        ctx.fillRect(x1 - 14, top + 8, 9, 12);
      }
      door(doorX, doorW, true, true);
      break;
    }
    case "cafe":
    case "bakery": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom, 1);
        glow(x0, x1, "rgba(255,225,170,0.22)");
        if (variant % 2) mullions(x0, x1, top, bottom, 2);
        // The counter, and what is on it: the case of pastries or the row of cups.
        ctx.fillStyle = "rgba(88,60,38,0.92)";
        ctx.fillRect(x0 + 4, bottom - 28, x1 - x0 - 8, 8);
        for (let x = x0 + 8; x < x1 - 8; x += 9) {
          ctx.fillStyle = trade === "bakery"
            ? (rnd(x) < 0.5 ? "rgba(214,160,90,0.95)" : "rgba(240,220,180,0.95)")
            : (rnd(x) < 0.5 ? "rgba(240,240,236,0.95)" : "rgba(60,44,30,0.95)");
          ctx.fillRect(x, bottom - 34, 5, 6);
        }
        // A chalkboard by the door.
        ctx.fillStyle = "rgba(24,30,26,0.95)";
        ctx.fillRect(x0 + 6, top + 8, 16, 20);
        ctx.fillStyle = "rgba(230,230,220,0.6)";
        for (let y = top + 12; y < top + 26; y += 4) ctx.fillRect(x0 + 8, y, 12, 1);
      }
      door(doorX, doorW, true, true);
      break;
    }
    case "bar": {
      // Small, dark, high windows; the door the darkest thing on the block; a glow in each.
      for (const [x0, x1] of panes) {
        ctx.fillStyle = frame;
        ctx.fillRect(x0, top, x1 - x0, bottom - top);
        const n = Math.max(1, Math.floor((x1 - x0) / 46));
        for (let i = 0; i < n; i += 1) {
          const wx0 = x0 + 8 + ((x1 - x0 - 16) * i) / n;
          const wx1 = wx0 + (x1 - x0 - 16) / n - 8;
          glass(wx0, wx1, top + 8, top + (bottom - top) * 0.5);
          ctx.fillStyle = rnd(i) < 0.5 ? "rgba(255,70,110,0.55)" : "rgba(80,220,255,0.5)";
          ctx.fillRect(wx0 + 4, top + 16, wx1 - wx0 - 8, 3);
        }
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(x0, top + (bottom - top) * 0.5, x1 - x0, (bottom - top) * 0.5);
      }
      door(doorX, doorW, true, false);
      break;
    }
    case "grocery":
    case "convenience": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom, 1);
        glow(x0, x1, "rgba(255,255,240,0.28)");
        mullions(x0, x1, top, bottom, 3);
        shelves(x0, x1, ["#d94a2a", "#f0b429", "#5ea63a", "#2f7a3e", "#e8e0c8", "#8a3a8a"], 3);
        // A poster or two on the glass.
        ctx.fillStyle = "rgba(250,230,60,0.85)";
        ctx.fillRect(x1 - 20, top + 6, 14, 18);
        ctx.fillStyle = "rgba(220,40,40,0.9)";
        ctx.fillRect(x1 - 18, top + 10, 10, 4);
      }
      door(doorX, doorW, true, true);
      break;
    }
    case "clothing": {
      // Display windows on a deep riser, a mannequin or two in each, a recessed door.
      for (const [x0, x1] of panes) {
        ctx.fillStyle = frame;
        ctx.fillRect(x0, top, x1 - x0, bottom - top);
        glass(x0 + 3, x1 - 3, top + 3, bottom - 8, 1);
        glow(x0 + 3, x1 - 3, "rgba(255,255,255,0.18)");
        const n = Math.max(1, Math.floor((x1 - x0) / 40));
        for (let i = 0; i < n; i += 1) {
          const mx = x0 + 3 + ((x1 - x0 - 6) * (i + 0.5)) / n;
          const c = ["#1b1c1e", "#b83a3a", "#e8e4dc", "#2f4f7a", "#c9a24a"][Math.floor(rnd(i * 5.1) * 5)];
          ctx.fillStyle = "rgba(230,220,205,0.95)";
          ctx.beginPath(); ctx.arc(mx, top + 16, 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = c;
          ctx.fillRect(mx - 7, top + 21, 14, 28);
          ctx.fillStyle = "rgba(60,60,60,0.9)";
          ctx.fillRect(mx - 5, top + 49, 10, 18);
        }
      }
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(doorX - 4, top, doorW + 8, bottom - top);
      door(doorX, doorW, true, true);
      break;
    }
    case "books": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom);
        glow(x0, x1, "rgba(255,240,200,0.14)");
        if (variant % 2) mullions(x0, x1, top, bottom, 2);
        shelves(x0, x1, ["#9c2f2a", "#2a4a7a", "#1f5f3a", "#d9cfb8", "#c9a24a", "#3d2b1f", "#e8e4dc"], 4);
      }
      door(doorX, doorW, true, true);
      break;
    }
    case "salon": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom, 1);
        glow(x0, x1, "rgba(255,255,255,0.24)");
        mullions(x0, x1, top, bottom, 2);
        // The row of chairs and the mirrors behind them.
        for (let x = x0 + 12; x < x1 - 12; x += 20) {
          ctx.fillStyle = "rgba(235,235,240,0.85)";
          ctx.fillRect(x - 5, top + 12, 12, 16);
          ctx.fillStyle = "rgba(30,30,32,0.95)";
          ctx.fillRect(x - 3, bottom - 26, 8, 12);
          ctx.fillRect(x, bottom - 14, 2, 8);
        }
      }
      door(doorX, doorW, false, true);
      break;
    }
    case "pharmacy": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom, 1);
        glow(x0, x1, "rgba(255,255,255,0.42)");
        mullions(x0, x1, top, bottom, 3);
        shelves(x0, x1, ["#e8e4dc", "#2a6fa8", "#f0f0f0", "#d94a2a", "#5ea63a"], 3);
        // The cross.
        ctx.fillStyle = "rgba(40,170,90,0.95)";
        ctx.fillRect(x1 - 18, top + 6, 12, 4); ctx.fillRect(x1 - 14, top + 2, 4, 12);
      }
      door(doorX, doorW, false, true);
      break;
    }
    case "bank": {
      // Stone: pilasters between tall windows, a heavy door, nothing lit.
      ctx.fillStyle = frame;
      if (!preserveWall) ctx.fillRect(0, 0, W, H);
      for (const [x0, x1] of panes) {
        const n = Math.max(1, Math.floor((x1 - x0) / 44));
        for (let i = 0; i < n; i += 1) {
          const wx0 = x0 + 6 + ((x1 - x0 - 12) * i) / n + 4;
          const wx1 = wx0 + (x1 - x0 - 12) / n - 8;
          glass(wx0, wx1, top - 8, bottom - 4);
          ctx.fillStyle = trim;
          ctx.fillRect(wx0 - 4, top - 10, 4, bottom - top + 12);
          ctx.fillRect(wx1, top - 10, 4, bottom - top + 12);
        }
      }
      door(doorX, doorW, true, true);
      ctx.fillStyle = trim;
      ctx.fillRect(doorX - 6, top - 10, 6, bottom - top + 12);
      ctx.fillRect(doorX + doorW, top - 10, 6, bottom - top + 12);
      break;
    }
    case "laundry": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom, 1);
        glow(x0, x1, "rgba(255,255,255,0.36)");
        // The machines, two rows of them, a porthole in each.
        for (let r = 0; r < 2; r += 1) {
          const y = top + 18 + r * 30;
          for (let x = x0 + 8; x < x1 - 14; x += 16) {
            ctx.fillStyle = "rgba(235,235,238,0.95)";
            ctx.fillRect(x, y, 13, 26);
            ctx.fillStyle = "rgba(60,80,100,0.95)";
            ctx.beginPath(); ctx.arc(x + 6.5, y + 15, 4.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      door(doorX, doorW, false, true);
      break;
    }
    case "hardware": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom);
        mullions(x0, x1, top, bottom, 2);
        shelves(x0, x1, ["#d94a2a", "#f0b429", "#4a4a48", "#2a6fa8", "#8c5a2b", "#e8e4dc"], 3);
        // Goods out on the pavement side of the glass: buckets, a ladder.
        ctx.fillStyle = "rgba(240,180,40,0.95)";
        ctx.fillRect(x0 + 6, bottom - 12, 8, 10);
        ctx.fillStyle = "rgba(200,200,200,0.9)";
        ctx.fillRect(x1 - 12, bottom - 30, 2, 28); ctx.fillRect(x1 - 6, bottom - 30, 2, 28);
        for (let y = bottom - 26; y < bottom - 4; y += 6) ctx.fillRect(x1 - 12, y, 8, 1.5);
      }
      door(doorX, doorW, true, true);
      break;
    }
    case "florist": {
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom, 1);
        glow(x0, x1, "rgba(255,255,255,0.2)");
        // Buckets of flowers, in the window and out on the pavement.
        let k = 0;
        for (let x = x0 + 6; x < x1 - 8; x += 9) {
          k += 1;
          ctx.fillStyle = "rgba(60,90,60,0.95)";
          ctx.fillRect(x, bottom - 22, 6, 14);
          ctx.fillStyle = ["#e04a7a", "#f0b429", "#f5f0e0", "#b04ad0", "#e8452a"][Math.floor(rnd(k * 2.7) * 5)];
          ctx.beginPath(); ctx.arc(x + 3, bottom - 26, 5, 0, Math.PI * 2); ctx.fill();
        }
      }
      door(doorX, doorW, true, true);
      break;
    }
    case "hotel":
    case "office": {
      // A glazed lobby: tall panes, a double door in the middle, a canopy over it.
      glass(gap, W - gap, top - 6, bottom + riser - 6);
      mullions(gap, W - gap, top - 6, bottom + riser - 6, 6);
      glow(gap, W - gap, "rgba(255,240,210,0.12)");
      door(W / 2 - 20, 40, true, true);
      ctx.fillStyle = trim;
      ctx.fillRect(W / 2 - 1, top - 2, 2, bottom - top + 6);
      ctx.fillStyle = frame;
      ctx.fillRect(W / 2 - 36, top - 6, 72, 6);
      if (trade === "hotel") {
        ctx.fillStyle = "rgba(255,236,190,0.9)";
        ctx.fillRect(W / 2 - 40, top - 4, 4, 4); ctx.fillRect(W / 2 + 36, top - 4, 4, 4);
      }
      break;
    }
    default: {
      // A shop: glass, a door, whatever is in the window.
      for (const [x0, x1] of panes) {
        glass(x0, x1, top, bottom, variant % 2);
        glow(x0, x1, "rgba(255,250,235,0.18)");
        mullions(x0, x1, top, bottom, variant === 3 ? 3 : variant === 2 ? 1 : 2);
        shelves(x0, x1, ["#c9a24a", "#2a4a7a", "#e8e4dc", "#9c2f2a", "#4a4a48"], 2);
      }
      door(doorX, doorW, true, true);
    }
  }

  // The fascia over the glass, in the frame's colour with its trim, and for a standalone shop
  // the parapet's cap line. The name goes on the sign geometry over this, not in it.
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, W, head - 2);
  ctx.fillStyle = trim;
  ctx.fillRect(0, head - 3, W, 1.5);
  if (standalone) {
    ctx.fillRect(0, 2, W, 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 5, W, 3);
  } else {
    // The cornice under the storey above.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, W, 4);
  }
  // A traditional front: a transom of small panes along the head of the glass, and the stall
  // riser panelled under it.
  if (traditional && !preserveWall) {
    const transom = top + Math.round((bottom - top) * 0.22);
    for (const [x0, x1] of panes) {
      ctx.fillStyle = frame;
      ctx.fillRect(x0, transom - 2, x1 - x0, 4);
      const lights = Math.max(2, Math.round((x1 - x0) / (0.45 * pxPerM)));
      for (let k = 1; k < lights; k += 1) ctx.fillRect(x0 + ((x1 - x0) * k) / lights - 1, top, 2, transom - top);
      ctx.fillStyle = trim;
      const panels = Math.max(1, Math.round((x1 - x0) / (0.9 * pxPerM)));
      for (let k = 0; k < panels; k += 1) {
        const px0 = x0 + ((x1 - x0) * k) / panels + 3, px1 = x0 + ((x1 - x0) * (k + 1)) / panels - 3;
        ctx.strokeStyle = trim; ctx.lineWidth = 1.5;
        ctx.strokeRect(px0, bottom + 4, px1 - px0, riser - 10);
      }
    }
  }
  // The stall riser's foot and the pavement's shadow.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(0, H - 6, W, 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  STOREFRONT_TEXTURES.set(key, texture);
  return texture;
}

function addStorefronts(group, feature, seed, height, tint) {
  const wall = storefrontWall(feature);
  // A shop three and a half metres wide is a shop: a narrow front is most of a shopping street.
  if (!wall || wall.span < STOREFRONT_MIN_WALL_M) return;
  const standalone = height <= STOREFRONT_STANDALONE_MAX_M;
  const bays = shopBays(feature, wall);
  const lead = bays[0].trade;
  const groundBand = frontageFitFor(feature)?.appearance?.bands?.find(b=>b.bottom_m===0
    && Number.isFinite(b.top_m) && b.top_m>0 && b.top_m<=height
    && (/^#[0-9a-f]{6}$/i.test(b.colour || "") || PHOTO_CLASS_TO_MATERIAL[b.material]));
  const frame = groundBand?.colour ? new THREE.Color(groundBand.colour) : storefrontColour(tint, lead, seed);
  const frameHex = frame.getHex();
  const bandH = groundBand ? Math.min(groundBand.top_m,height-.15)
    : standalone ? Math.max(3.0, height - 0.15) : Math.min(STOREFRONT_BAND_M, height * 0.36);
  if (bandH <= .5) return;
  // The ground storey's own colour across the whole street wall, just proud of it, on its
  // vertices so every building's frame merges into one mesh.
  const sink = awningSink("band");
  const corner = (along, y, out = 0.05) => {
    const q = wallPoint(wall, along, out);
    return [q.x, y, q.z];
  };
  if (!groundBand) awningQuad(sink, [
    corner(-wall.span / 2, 0.02), corner(wall.span / 2, 0.02),
    corner(wall.span / 2, bandH), corner(-wall.span / 2, bandH),
  ], [frame]);
  // A cornice line where the frame meets the storeys above, or the parapet cap on a
  // standalone shop.
  const capColour = frame.clone().multiplyScalar(0.72);
  if (!groundBand) awningQuad(sink, [
    corner(-wall.span / 2, bandH, 0.14), corner(wall.span / 2, bandH, 0.14),
    corner(wall.span / 2, bandH + 0.18, 0.14), corner(-wall.span / 2, bandH + 0.18, 0.14),
  ], [capColour]);
  // Each bay its own front.
  const panelH = standalone ? bandH - 0.1 : Math.min(bandH - 0.05, 3.8);
  // A business wider than one front has several: a supermarket is a row of windows and a
  // door, not one window nine metres wide with black wall either side.
  for (let i = 0; i < bays.length; i += 1) {
    const bay = bays[i];
    const fronts = Math.max(1, Math.ceil(bay.share / 8.0));
    const each = bay.share / fronts;
    for (let f = 0; f < fronts; f += 1) {
      const variant = Math.floor(random(seed + i * 17.3 + f * 5.1 + 5) * STOREFRONT_VARIANTS);
      const centre = bay.centre - bay.share / 2 + each * (f + 0.5);
      const at = wallPoint(wall, centre, 0.11);
      planePart(group, at.x, 0.05, at.z, each * 0.97, panelH,
                storefrontTexture(bay.trade, variant, frameHex, standalone, !!groundBand, each), wall.yaw);
    }
  }
}


function addSouthFacadeDetail(group, feature, seed, height) {
  if(typeof storeExteriorFor==="function" && storeExteriorFor(feature))return;
  if (!(feature.archetype === "residential" || feature.archetype === "generic")) return;
  if (height < 6) return;
  const candidates = footprintWalls(feature.points)
    .filter((wall) => wall.nz > 0.38 && wall.span > 5.5)
    .sort((a, b) => b.span - a.span);
  const wall = candidates[0];
  if (!wall) return;
  const panelW = Math.min(wall.span * 0.82, 22);
  // Windows never overlap a garage: where a garage door is on this wall, the window panel
  // starts above it instead of at the ground storey. It hung three centimetres behind the
  // door, and at any distance the two fought and the windows showed through the garage.
  const bottom = garagesOnWall(feature, wall).length ? GARAGE_HEIGHT_M + 0.35 : 1.2;
  const panelH = Math.min(height - 0.6 - bottom,
    Math.max(STOREY_M * 1.6, Math.floor(height / STOREY_M) * STOREY_M));
  if (panelH < STOREY_M * 0.8) return;
  const x = wall.x + wall.nx * 0.09;
  const z = wall.z + wall.nz * 0.09;
  // A house's windows are its own (homeWindowLayout); the panel of painted windows is only for a
  // building with a shop in it.
  if (hasStorefront(feature)) planePart(group, x, bottom, z, panelW, panelH, southWindowTextureFor(seed), wall.yaw);
  if (!frontageFitFor(feature) && height > 7.5 && random(seed + 701) < 0.34) {
    balconyPart(group, wall, Math.min(height - 1.1, STOREY_M * 1.2), seed);
  }
}

function gasStationMesh(feature, seed) {
  const metrics = footprintMetrics(feature.points);
  if (!metrics) return null;
  const group = new THREE.Group();
  group.add(placeSlab(metrics, 0x171b1d, 0.07));
  const brand = random(seed + 4) < 0.5 ? 0xd94732 : 0x2368a2;
  const canopyW = Math.min(metrics.width * 0.72, 28);
  const canopyD = Math.min(metrics.depth * 0.46, 18);
  boxPart(group, metrics.x, 4.8, metrics.z, canopyW, 0.45, canopyD, 0xf1f0e8, 0.55);
  boxPart(group, metrics.x, 5.05, metrics.z - canopyD / 2 - 0.04, canopyW, 0.22, 0.18, brand, 0.42);
  boxPart(group, metrics.x, 5.05, metrics.z + canopyD / 2 + 0.04, canopyW, 0.22, 0.18, brand, 0.42);
  for (const sx of [-0.25, 0.25]) {
    for (const sz of [-0.25, 0.25]) {
      boxPart(group, metrics.x + sx * canopyW, 4.56, metrics.z + sz * canopyD,
              1.8, 0.035, 0.75, 0xfff3be, 0.34);
    }
  }
  for (const sx of [-0.32, 0.32]) {
    for (const sz of [-0.28, 0.28]) {
      boxPart(group, metrics.x + sx * canopyW, 0, metrics.z + sz * canopyD, 0.34, 4.8, 0.34, 0xd8d2c5);
    }
  }
  for (const sx of [-0.24, 0.24]) {
    pumpIsland(group, metrics.x + sx * canopyW, metrics.z, brand);
  }
  boxPart(group, metrics.x - metrics.width * 0.24, 0, metrics.z + metrics.depth * 0.26,
          Math.max(4, metrics.width * 0.22), 3.2, Math.max(3, metrics.depth * 0.18), 0xb8a07f);
  boxPart(group, metrics.x - metrics.width * 0.24, 0.02, metrics.z + metrics.depth * 0.16,
          Math.max(2.6, metrics.width * 0.13), 2.25, 0.12, 0x34464f, 0.58);
  boxPart(group, metrics.x + metrics.width * 0.18, 0, metrics.z + metrics.depth * 0.31,
          1.1, 1.35, 0.55, 0x4d6872, 0.46);
  boxPart(group, metrics.x + metrics.width * 0.18, 1.34, metrics.z + metrics.depth * 0.31,
          1.2, 0.20, 0.60, brand, 0.42);
  const signMap = gasPriceTextureFor(seed);
  const signX = metrics.x + metrics.width * 0.42;
  const signZ = metrics.z - metrics.depth * 0.40;
  boxPart(group, signX, 0, signZ, 0.22, 4.8, 0.22, 0x2b3033, 0.58);
  planePart(group, signX, 1.0, signZ - 0.13, 2.35, 3.25, signMap, 0);
  planePart(group, signX + 0.13, 1.0, signZ, 2.35, 3.25, signMap, Math.PI / 2);
  group.userData = feature;
  return group;
}

function parkMesh(feature, seed) {
  const metrics = footprintMetrics(feature.points);
  if (!metrics) return null;
  const group = new THREE.Group();
  group.add(placeSlab(metrics, feature.archetype === "mini_golf" ? 0x477f45 : 0x365f3b, 0.065));
  // No invented trees: a park's trees are the mapped ones (the tree layer). Cones scattered at
  // random at the street's height stood buried to their crowns in a raised square (Union Square).
  if (feature.archetype === "mini_golf") {
    for (let i = 0; i < 5; i += 1) {
      boxPart(group, metrics.x + (i - 2) * metrics.width * 0.12, 0.08,
              metrics.z + Math.sin(i) * metrics.depth * 0.16, 1.8, 0.25, 0.55, 0xf1e5aa, 0.76);
    }
  }
  group.userData = feature;
  return group;
}

function parkingMesh(feature, seed) {
  const metrics = footprintMetrics(feature.points);
  if (!metrics) return null;
  const group = new THREE.Group();
  group.add(placeSlab(metrics, 0x15191b, 0.068));
  const rows = Math.max(2, Math.min(9, Math.floor(metrics.width / 4)));
  for (let i = 0; i < rows; i += 1) {
    const x = metrics.x - metrics.width * 0.38 + (i + 0.5) * metrics.width * 0.76 / rows;
    boxPart(group, x, 0.09, metrics.z, 0.09, 0.04, metrics.depth * 0.72, 0xf0f2ea, 0.5);
  }
  group.userData = feature;
  return group;
}

//: The archetypes drawn as a lot at one level, not as a building rising off the hill.
var ARCHETYPE_LOT_KINDS = new Set(["gas_station", "park", "mini_golf", "parking"]);
function placeArchetypeMesh(feature, seed) {
  if (feature.archetype === "gas_station") return gasStationMesh(feature, seed);
  if (feature.archetype === "park" || feature.archetype === "mini_golf") return parkMesh(feature, seed);
  if (feature.archetype === "parking") return parkingMesh(feature, seed);
  return null;
}

// ---- what is on a roof ----
//
// This was painted into the roof texture, and a roof texture repeats: the tile carried one
// solar array and was tiled two and a half times across the roof, so a house with panels had
// six copies of the same array at whatever size the tiling happened to give them, scattered
// across the roof and half cut off at the edges. Nothing was at any particular size and nothing
// was aligned to anything.
//
// A solar array is not a pattern, it is a set of 1.7 by 1.0 metre modules in rows, squared to
// the roof, set in from the parapet, in one block. A roof deck is a rectangle of decking with
// furniture on it. Planters are in rows because somebody put them in rows. All of that is
// geometry at the size it is in the street, placed once, in the building's own footprint.
//
// What goes on which roof is decided by the roof: solar wants a flat roof with room for an
// array, so a narrow or ragged footprint does not get one however common panels are.

//: A module: 1.70 x 1.00 m is the common residential size, and the rails hold them 20 mm apart.
const SOLAR_MODULE = { long: 1.70, short: 1.00, gap: 0.02, tilt: 12 };
//: How much of the roof a real install covers before it runs into vents, stairs and setbacks.
const SOLAR_COVERAGE = 0.42;

//: Roughly how common each of these is on a flat roof in this part of San Francisco. These are
//: estimates and are labelled as such -- there is no per-building record of roof use, and the
//: alternative to an estimate here is the previous behaviour, which was a coin flip. Solar is
//: rare on this side of the city: the housing stock is dense, multi-owner and largely historic,
//: and the citywide residential figure is single digits before any of that is taken into
//: account. Decks are the opposite -- a flat roof with a view of the bay usually has one.
const ROOF_USE = {
  residential: [["deck", 0.20], ["garden", 0.09], ["solar", 0.06], ["stair", 0.30]],
  generic:     [["deck", 0.14], ["garden", 0.07], ["solar", 0.05], ["stair", 0.26]],
  office:      [["plant", 0.72], ["stair", 0.45]],
  hotel:       [["plant", 0.62], ["deck", 0.12], ["stair", 0.45]],
  industrial:  [["plant", 0.55], ["solar", 0.11], ["stair", 0.20]],
  retail:      [["plant", 0.40], ["stair", 0.22]],
  restaurant:  [["plant", 0.45], ["stair", 0.20]],
};

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const half = (seq) => {
    const out = [];
    for (const p of seq) {
      while (out.length >= 2) {
        const [ax, ay] = out[out.length - 2];
        const [bx, by] = out[out.length - 1];
        if ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) > 0) break;
        out.pop();
      }
      out.push(p);
    }
    return out;
  };
  return half(pts).slice(0, -1).concat(half(pts.slice().reverse()).slice(0, -1));
}

const ROOF_USE_SALT = { deck: 131, garden: 257, solar: 389, plant: 521, stair: 653 };

function roofRectangle(feature) {
  // The smallest rectangle the roof fits in, at the angle the roof is actually at.
  //
  // This used the axis-aligned bounding box, and San Francisco is not aligned to north: the
  // grid here runs twenty to forty degrees off it, so a plain rectangular building filled only
  // two thirds of its north-facing box. The median across this corridor was 0.666, the test for
  // "is this roof a rectangle" was fill > 0.82, and so 681 of the 690 roofs that came up for a
  // solar array were refused as ragged. Every one of them was a rectangle; the box was crooked.
  //
  // A minimum-area rectangle has one side flush with an edge of the convex hull, so trying every
  // hull edge is exact rather than an approximation, and a footprint hull has a dozen edges.
  if (!feature.points || feature.points.length < 4) return null;
  const local = feature.points.map((p) => {
    const [x, y] = xy(p[0], p[1]);
    return [x, -y];                                   // world x, world z
  });
  const hull = convexHull(local);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i += 1) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    const edge = Math.hypot(bx - ax, bz - az);
    if (edge < 1e-6) continue;
    const ux = (bx - ax) / edge;
    const uz = (bz - az) / edge;
    const vx = -uz;
    const vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [px, pz] of hull) {
      const du = (px - ax) * ux + (pz - az) * uz;
      const dv = (px - ax) * vx + (pz - az) * vz;
      if (du < u0) u0 = du;
      if (du > u1) u1 = du;
      if (dv < v0) v0 = dv;
      if (dv > v1) v1 = dv;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (best && area >= best.area) continue;
    const mu = (u0 + u1) / 2;
    const mv = (v0 + v1) / 2;
    best = {
      area,
      x: ax + ux * mu + vx * mv,
      z: az + uz * mu + vz * mv,
      long: u1 - u0,
      short: v1 - v0,
      angle: Math.atan2(uz, ux),
    };
  }
  if (!best) return null;
  const footprint = footprintArea(feature.points);
  // Long axis first, so "width" is always the longer side and a row runs down it.
  let { long, short, angle } = best;
  if (short > long) {
    [long, short] = [short, long];
    angle += Math.PI / 2;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: best.x,
    z: best.z,
    width: long,
    depth: short,
    angle,
    area: footprint,
    // How much of its own rectangle the footprint fills: 1 for a rectangle, about two thirds
    // for an L, a half for a triangle. Now that the rectangle is the right one, this measures
    // the shape of the roof rather than its bearing.
    fill: best.area > 0 ? footprint / best.area : 0,
    slim: short,
    squarish: (best.area > 0 ? footprint / best.area : 0) > 0.82 && short > 5.0,
    along: "x",
    // Rect-local (down the roof, across the roof) to world.
    at(a, b) { return [this.x + cos * a - sin * b, this.z + sin * a + cos * b]; },
    // What a box aligned to this roof has to be turned by. Three turns +X to (cos, -sin) in xz.
    rotY: -angle,
  };
}

function deckMaterials() {
  if (!deckMaterials._cache) {
    const make = (name, options) => {
      const material = new THREE.MeshStandardMaterial(options);
      material.__part = name;
      return material;
    };
    deckMaterials._cache = {
      plank: make("plank", { color: 0x6a5340, roughness: 0.94 }),
      rail: make("rail", { color: 0x8b8578, roughness: 0.9 }),
      seat: make("seat", { color: 0x7d6249, roughness: 0.92 }),
      planter: make("planter", { color: 0x5b4633, roughness: 0.95 }),
      leaf: make("leaf", { color: 0x3f6b3a, roughness: 0.95 }),
      panel: make("panel", { color: 0x121d2c, roughness: 0.28, metalness: 0.35 }),
      rack: make("rack", { color: 0x9aa1a5, roughness: 0.5, metalness: 0.6 }),
      plant: make("plant", { color: 0x8d9296, roughness: 0.7, metalness: 0.4 }),
      hut: make("hut", { color: 0x54534c, roughness: 0.94 }),
    };
  }
  return deckMaterials._cache;
}

// Collected, not added. A roof garden is two dozen planters and a deck is eight pieces of
// furniture; at fifteen thousand buildings that is tens of thousands of separate meshes and
// tens of thousands of draw calls, which is no frame rate at all. Every piece is a box, so they
// go into one instanced mesh per material -- nine draw calls for the roofs of the whole city.
const ROOF_PARTS = new Map();

function slab(group, x, y, z, w, h, d, material, rotY = 0, tilt = 0, tiltAxis = "x") {
  const key = material.__part || "plant";
  if (!ROOF_PARTS.has(key)) ROOF_PARTS.set(key, { material, boxes: [] });
  ROOF_PARTS.get(key).boxes.push([x, y + h / 2 + BUILDING_LIFT_M, z, w, h, d, rotY, tilt, tiltAxis === "x" ? 0 : 1]);
  return null;
}

function emitRoofParts() {
  const dummy = new THREE.Object3D();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (const { material, boxes } of ROOF_PARTS.values()) {
    if (!boxes.length) continue;
    const mesh = new THREE.InstancedMesh(unit, material, boxes.length);
    boxes.forEach(([x, y, z, w, h, d, rotY, tilt, axis], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(axis === 0 ? tilt : 0, rotY, axis === 1 ? tilt : 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.kind = "roof";
    mesh.userData.surface = "roof_furniture";
    // Twelve boxes a planter, thirteen thousand planters: a million and a quarter triangles
    // that nobody sees from the street. Tiled, so that the distance cull can drop them.
    const pieces = tileInstanced(mesh);
    if (pieces) pieces.forEach((piece) => groups.mapped3d.add(piece));
    else groups.mapped3d.add(mesh);
  }
  ROOF_PARTS.clear();
}

function solarArray(group, roof, top, seed, feature_is_big = false) {
  // Rows of modules squared to the roof's long axis, in one block, inset from the parapet.
  const M = deckMaterials();
  const inset = 1.2;
  const usableW = Math.max(0, roof.width - inset * 2);
  const usableD = Math.max(0, roof.depth - inset * 2);
  // Portrait or landscape rows: two of the layouts a real installer would choose from.
  const landscape = random(seed + 501) < 0.6;
  const stepA = (landscape ? SOLAR_MODULE.long : SOLAR_MODULE.short) + SOLAR_MODULE.gap;
  const stepB = (landscape ? SOLAR_MODULE.short : SOLAR_MODULE.long) + SOLAR_MODULE.gap;
  const spanA = usableW;
  const spanB = usableD;
  // A residential array in this city is ten to twenty five modules; a warehouse takes more.
  // Uncapped, a large roof was getting ninety, which is a commercial power plant.
  const most = feature_is_big ? 48 : 26;
  let cols = Math.floor((spanA * Math.sqrt(SOLAR_COVERAGE)) / stepA);
  let rows = Math.floor((spanB * Math.sqrt(SOLAR_COVERAGE)) / stepB);
  while (cols * rows > most && (cols > 2 || rows > 2)) {
    if (cols >= rows) cols -= 1; else rows -= 1;
  }
  if (cols < 2 || rows < 2) return false;
  const blockA = cols * stepA;
  const blockB = rows * stepB;
  // Set towards the back of the roof, which is where an installer puts it: away from the street
  // parapet and off the stair bulkhead.
  const offA = (random(seed + 503) - 0.5) * Math.max(0, spanA - blockA) * 0.6;
  const offB = (spanB - blockB) / 2 * 0.55;
  const tilt = (SOLAR_MODULE.tilt * Math.PI) / 180;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const a = offA + (c + 0.5) * stepA - blockA / 2;
      const b = offB + (r + 0.5) * stepB - blockB / 2;
      const [x, z] = roof.at(a, b);
      const w = landscape ? SOLAR_MODULE.long : SOLAR_MODULE.short;
      const d = landscape ? SOLAR_MODULE.short : SOLAR_MODULE.long;
      // Tilted up across the rows, the way a rack on a flat roof holds them.
      slab(group, x, top + 0.26, z, w, 0.045, d, M.panel, roof.rotY, tilt, "z");
      // The rail the module sits on, which is what stops an array reading as paint.
      slab(group, x, top, z, 0.06, 0.24, 0.06, M.rack, roof.rotY);
    }
  }
  return true;
}


function roofGarden(group, roof, top, seed) {
  // Planter boxes in rows, because that is how a roof garden is built: you cannot put soil on a
  // roof, you put boxes of soil on a roof, and they line up with the structure underneath.
  const M = deckMaterials();
  const variant = Math.floor(random(seed + 521) * 3);
  const boxW = variant === 0 ? 1.2 : variant === 1 ? 0.8 : 2.2;
  const boxD = variant === 2 ? 0.7 : 0.9;
  const gapA = 0.7;
  const gapB = variant === 1 ? 0.6 : 1.1;
  const usableW = roof.width - 2.6;
  const usableD = roof.depth - 2.6;
  // Two or three rows of planters along part of the roof. Filling the roof with them, which is
  // what an uncapped grid does, is a nursery rather than somebody's roof garden -- and on a
  // 20 by 26 metre roof it was laying out 99 of them.
  const cols = Math.min(9, Math.floor(usableW / (boxW + gapA)));
  const rows = Math.min(3, Math.floor((usableD * 0.5) / (boxD + gapB)));
  if (cols < 2 || rows < 1) return false;
  const blockW = cols * (boxW + gapA) - gapA;
  const blockD = rows * (boxD + gapB) - gapB;
  const a0 = -blockW / 2;
  const b0 = -blockD / 2 + (random(seed + 522) - 0.5) * Math.max(0, usableD - blockD) * 0.5;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const [x, z] = roof.at(a0 + c * (boxW + gapA) + boxW / 2,
                             b0 + r * (boxD + gapB) + boxD / 2);
      slab(group, x, top, z, boxW, 0.45, boxD, M.planter, roof.rotY);
      slab(group, x, top + 0.45, z, boxW - 0.12, 0.34, boxD - 0.12, M.leaf, roof.rotY);
    }
  }
  return true;
}

function roofPlant(group, roof, top, seed) {
  // Condensers and air handlers, in a line along the roof rather than dropped at random: they
  // are plumbed to a riser and they sit where the riser is.
  const M = deckMaterials();
  const span = roof.width - 3.0;
  const count = Math.max(1, Math.min(6, Math.floor(span / 3.2)));
  if (count < 1 || span < 3) return false;
  const off = (random(seed + 531) - 0.5) * Math.max(0, roof.depth - 3.0) * 0.5;
  for (let i = 0; i < count; i += 1) {
    const [x, z] = roof.at(-span / 2 + (i + 0.5) * (span / count), off);
    const big = random(seed + 532 + i) < 0.35;
    slab(group, x, top, z, big ? 2.4 : 1.3, big ? 1.5 : 0.9, big ? 1.5 : 1.3, M.plant, roof.rotY);
  }
  return true;
}


//: A roof the aerial photograph read with enough of it in sun to trust the colour.
const ROOF_READ_MIN_LIT = 0.3;
//: An aerial mosaic sees every roof through the air under the aircraft, which adds its own light
//: to every pixel -- blue most of all -- and is exposed for the ground, so the brightest roofs
//: clip. Read straight, 43% of the corridor's roofs were lighter than 0.7 and a tar roof came out
//: mid grey: the city looked whitewashed from above. Each source's haze is its darkest roofs'
//: excess over the darkest a real roof is (dark-object subtraction, per channel, per source --
//: the NOAA flight and a NAIP year differ), and the highlights are rolled off above a knee.
const ROOF_DARKEST_SRGB = 0.10;
const ROOF_KNEE_L = 0.55;
const ROOF_HIGHLIGHT_ROLL = 0.45;
const ROOF_SATURATION_LIFT = 1.25;
//: Tar is near black, but a roof drawn black reads from above as a hole in the city (see
//: ROOF_LIGHTNESS_FLOOR): its granules and laps carry it the rest of the way.
const ROOF_TAR_FLOOR = 0.24;
const ROOF_TONE = (() => {
  const bySource = new Map();
  for (const read of Object.values(ORTHO_ROOFS?.roofs || {})) {
    if (!/^#[0-9a-f]{6}$/.test(read?.c || "")) continue;
    const key = String(read.gsd ?? "?");
    if (!bySource.has(key)) bySource.set(key, [[], [], []]);
    const channels = bySource.get(key);
    for (let i = 0; i < 3; i += 1) channels[i].push(parseInt(read.c.slice(1 + 2 * i, 3 + 2 * i), 16) / 255);
  }
  const haze = new Map();
  for (const [key, channels] of bySource) {
    if (channels[0].length < 40) continue;
    haze.set(key, channels.map((values) => {
      values.sort((a, b) => a - b);
      return Math.max(0, Math.min(0.45, values[Math.floor((values.length - 1) * 0.02)] - ROOF_DARKEST_SRGB));
    }));
  }
  return haze;
})();
function correctedRoofColour(read) {
  const rgb = [1, 3, 5].map((i) => parseInt(read.c.slice(i, i + 2), 16) / 255);
  const haze = ROOF_TONE.get(String(read.gsd ?? "?"));
  if (haze) for (let i = 0; i < 3; i += 1) rgb[i] = Math.max(0, Math.min(1, (rgb[i] - haze[i]) / (1 - haze[i])));
  const colour = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  const hsl = {};
  colour.getHSL(hsl, THREE.SRGBColorSpace);
  const l = hsl.l > ROOF_KNEE_L ? ROOF_KNEE_L + (hsl.l - ROOF_KNEE_L) * ROOF_HIGHLIGHT_ROLL : hsl.l;
  colour.setHSL(hsl.h, roofSaturation(hsl.h, hsl.s), Math.max(ROOF_TAR_FLOOR, l), THREE.SRGBColorSpace);
  return colour;
}
//: No roof here is green, and few are blue. Taking the haze out takes more blue than red off a
//: grey roof (the air is bluest), which leaves it leaning green; lifted 25% on top, a third of
//: the roofs in the corridor came out mint -- a colour no tar, membrane or gravel is, and one no
//: wall under it shares, so the roof read as a lid from some other building. Green and cyan are
//: taken almost back to grey, blue halfway, and nothing is more saturated than a terracotta.
const ROOF_GREEN_HUE = [0.14, 0.5];
const ROOF_BLUE_HUE = [0.5, 0.72];
const ROOF_MAX_SATURATION = 0.42;
function roofSaturation(h, s) {
  let out = s * ROOF_SATURATION_LIFT;
  if (h > ROOF_GREEN_HUE[0] && h < ROOF_GREEN_HUE[1]) out *= 0.15;
  else if (h >= ROOF_BLUE_HUE[0] && h < ROOF_BLUE_HUE[1]) out *= 0.5;
  return Math.min(ROOF_MAX_SATURATION, out);
}
//: A roof read mostly through the crowns of the trees over it is the trees' colour, not its own.
const ROOF_UNDER_TREES = 0.3;
function roofReadingFor(feature) {
  const read = feature?.osm_id == null ? null : ORTHO_ROOFS?.roofs?.[String(feature.osm_id)];
  return read && read.lit >= ROOF_READ_MIN_LIT && /^#[0-9a-f]{6}$/.test(read.c) ? read : null;
}

