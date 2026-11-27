// Street paint, reconciled before any of it is laid.
//
// The page paints the road from several things that know nothing of each other: the lane
// arrows from OpenStreetMap's turn lanes, the stop lines and STOP from the signs at a junction,
// the red bus zones from SFMTA's curb policies, the white BUS STOP boxes from the agencies'
// stops. Each used to lay its own paint as it went. A stop the city lists as a zone and an
// agency lists as painted got a red box and a white one side by side; two agencies sharing a
// stop wrote BUS STOP twice; a word landed on an arrow.
//
// Here every pass *claims* the rectangle of asphalt its paint would take, and nothing is laid
// until the claims have been settled against each other (PaintPlan.settle): one paint per piece
// of road, the better-sourced one, moved along its lane where that is all it takes.
//
// The second half is the city's own record of what is painted (docs/street-paint.json, written
// by tools/build_street_paint.py from smc.paint.clean): which approaches a stop sign governs.
// matchApproach finds the drawn approach each record means.
//
// No three.js, no DOM: the page and the tests (tests/street_paint.test.mjs) read the same file.

export const SCHEMA = "kerbside.street_paint/1";

const STREET_KINDS = new Set(["ST", "STREET", "AVE", "AV", "AVENUE", "BLVD", "BOULEVARD", "DR", "DRIVE", "RD", "ROAD",
  "WAY", "WY", "CT", "COURT", "PL", "PLACE", "LN", "LANE", "TER", "TERRACE", "HWY", "HIGHWAY", "CIR", "CIRCLE", "ALY",
  "ALLEY", "PLZ", "PLAZA", "WALK", "ROW", "PATH", "LOOP", "PARK", "STWY", "EXPY", "PKWY"]);

//: A street's name as both sources agree on it: upper case, no kind, no punctuation. The same
//: rule as smc.paint.clean.street_key; a test holds the two together.
export function streetKey(name) {
  const text = String(name ?? "").toUpperCase().replace(/-/g, " ").replace(/[^A-Z0-9 ]/g, "");
  const words = text.split(" ").filter(Boolean).map((w) => w.replace(/^0+(?=\d)/, ""));
  while (words.length > 1 && STREET_KINDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

//: The angle between two compass bearings, 0 to 180 degrees.
export function bearingGap(a, b) {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

//: The records inside any of the boxes ([west, south, east, north] each), or all of them.
export function recordsInBoxes(records, boxes) {
  if (!Array.isArray(records)) return [];
  if (!boxes || !boxes.length) return records.slice();
  return records.filter((r) => Array.isArray(r?.p)
    && boxes.some((b) => r.p[0] >= b[0] && r.p[0] <= b[2] && r.p[1] >= b[1] && r.p[1] <= b[3]));
}

//: A stop record's facing (the cleaned file's bearing), settled against the drawn streets.
//:
//: The city's facings are the four compass points, on a grid that is not square to the compass
//: (the Marina's is nine degrees off, Market Street forty-five), so the bearing alone cannot
//: pick an approach at a junction where two streets are within a few degrees of each other.
//: The street's name can, and is asked first.
export const APPROACH_MATCH = { facingMaxDeg: 60, namedMaxDeg: 75 };

//: Which drawn approach a stop record governs: the index into ``legs`` (each ``{ heading, street }``:
//: the compass bearing its arriving traffic travels on, and its street's key), or -1.
//:
//: The approach on the record's own street whose traffic travels the way the record faces. A
//: record whose street is not among the legs (a name the two sources spell differently, an
//: unnamed way) falls back on the bearing alone, more strictly -- and only when exactly one
//: approach answers, since a guess between two paints STOP on the wrong street.
export function matchApproach(record, legs, limits = APPROACH_MATCH) {
  if (!record || !Number.isFinite(record.facing) || !Array.isArray(legs) || !legs.length) return -1;
  const gaps = legs.map((leg) => (Number.isFinite(leg?.heading) ? bearingGap(leg.heading, record.facing) : Infinity));
  const street = record.street || "";
  const named = legs.map((leg, i) => i).filter((i) => street && legs[i].street === street && gaps[i] <= limits.namedMaxDeg);
  if (named.length) return named.reduce((best, i) => (gaps[i] < gaps[best] ? i : best));
  // The record's street is drawn here, facing another way: the record is for an approach the
  // model does not have (a one-way street's far side). Not a reason to take the cross street.
  if (street && legs.some((leg) => leg.street === street)) return -1;
  const near = legs.map((leg, i) => i).filter((i) => gaps[i] <= limits.facingMaxDeg);
  return near.length === 1 ? near[0] : -1;
}

// ---- the plan -----------------------------------------------------------------------------------

//: Whether two rectangles on the ground overlap, each ``{ x, z, ux, uz, along, across }``: a
//: centre, the unit direction of its length, and its half length and half width. ``slack``
//: grows both (metres): paint that only nearly touches is still a clash to the eye.
export function rectsOverlap(a, b, slack = 0) {
  const axes = [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [nx, nz] of axes) {
    const reach = (r) => Math.abs(r.ux * nx + r.uz * nz) * (r.along + slack / 2)
      + Math.abs(-r.uz * nx + r.ux * nz) * (r.across + slack / 2);
    if (Math.abs(dx * nx + dz * nz) > reach(a) + reach(b)) return false;
  }
  return true;
}

//: Whether the whole of rectangle ``a`` lies inside rectangle ``b`` (to ``slack`` metres).
export function rectInside(a, b, slack = 0) {
  for (const [sa, sc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = a.x + a.ux * a.along * sa - a.uz * a.across * sc - b.x;
    const pz = a.z + a.uz * a.along * sa + a.ux * a.across * sc - b.z;
    if (Math.abs(px * b.ux + pz * b.uz) > b.along + slack || Math.abs(-px * b.uz + pz * b.ux) > b.across + slack) return false;
  }
  return true;
}

//: What each kind of paint is. ``solid`` paint may not share asphalt with other solid paint;
//: a ``line`` (a stop bar) only with another line.
export const PAINT_KINDS = {
  word: { solid: true },    // STOP, BUS STOP: lettering in a lane
  arrow: { solid: true },   // a turn arrow in a lane
  box: { solid: true },     // a white bus box from an agency's stop
  zone: { solid: true },    // a red bus zone from the city's curb policies
  bike: { solid: true },    // a bike lane's band, between its two lines
  bar: { solid: false },    // a stop line across the arriving lanes
};
//: Paint this close (m) to other paint it may not share asphalt with is taken to be on it.
export const PAINT_SLACK_M = 0.3;
const CELL_M = 12;

function clashes(a, b) {
  // Parts of one thing (a box and the words in it, the STOPs of one approach) never clash.
  if (a.group !== undefined && a.group === b.group) return false;
  const ka = PAINT_KINDS[a.kind] || PAINT_KINDS.word, kb = PAINT_KINDS[b.kind] || PAINT_KINDS.word;
  if (a.kind === b.kind) return true;
  return ka.solid && kb.solid;
}

//: Every piece of paint the page means to lay, settled before any is laid.
//:
//: ``claim`` takes a rectangle (``x, z, ux, uz, along, across``), its ``kind`` (PAINT_KINDS), a
//: ``rank`` (the better-sourced paint: higher wins the asphalt), and optionally:
//:   ``id``     for the report; ``group`` to tie the parts of one thing together;
//:   ``fixed``  paint already on the road, which cannot be moved or refused (it still holds its place);
//:   ``slides`` distances along its own length it may be moved to get clear, tried in order;
//:   ``within`` the id of a claim it must lie inside to be laid at all (words in their zone);
//:   ``data``   anything the page needs back to lay it.
//: ``settle`` returns ``{ laid, refused }``: the claims to lay (with any slide applied, ``slid``
//: saying how far) and the ones refused, each with ``why`` (``duplicate`` of the same kind of
//: paint, ``overlap`` with another kind, ``orphan`` when what it had to lie within was refused)
//: and ``by`` (the id that holds the asphalt).
export class PaintPlan {
  constructor({ slack = PAINT_SLACK_M } = {}) {
    this.slack = slack;
    this.claims = [];
  }

  claim(claim) {
    for (const key of ["x", "z", "ux", "uz", "along", "across"]) {
      if (!Number.isFinite(claim?.[key])) return null;
    }
    if (!(claim.along > 0) || !(claim.across > 0)) return null;
    const norm = Math.hypot(claim.ux, claim.uz);
    if (!(norm > 1e-9)) return null;
    const kept = { rank: 0, slides: [], ...claim, ux: claim.ux / norm, uz: claim.uz / norm, order: this.claims.length };
    if (kept.id === undefined) kept.id = `${kept.kind}:${kept.order}`;
    this.claims.push(kept);
    return kept;
  }

  //: The claims of ``kind`` (any, when omitted) that overlap a rectangle, before settling.
  overlapping(rect, kind = null, slack = this.slack) {
    return this.claims.filter((c) => (!kind || c.kind === kind) && rectsOverlap(rect, c, slack));
  }

  settle() {
    const grid = new Map();
    const cells = (r) => {
      const reach = Math.hypot(r.along, r.across) + this.slack;
      const out = [];
      for (let cx = Math.floor((r.x - reach) / CELL_M); cx <= Math.floor((r.x + reach) / CELL_M); cx += 1) {
        for (let cz = Math.floor((r.z - reach) / CELL_M); cz <= Math.floor((r.z + reach) / CELL_M); cz += 1) out.push(`${cx}:${cz}`);
      }
      return out;
    };
    const blocker = (candidate) => {
      const seen = new Set();
      for (const key of cells(candidate)) {
        for (const other of grid.get(key) || []) {
          if (seen.has(other)) continue;
          seen.add(other);
          if (clashes(candidate, other) && rectsOverlap(candidate, other, this.slack)) return other;
        }
      }
      return null;
    };
    const hold = (claim) => { for (const key of cells(claim)) { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(claim); } };
    // What is already on the road first; then the best-sourced; then as claimed.
    const order = this.claims.slice().sort((a, b) => (Number(Boolean(b.fixed)) - Number(Boolean(a.fixed)))
      || (b.rank - a.rank) || (a.order - b.order));
    const laid = [], refused = [], laidById = new Map();
    for (const claim of order) {
      if (claim.fixed) { hold(claim); laid.push(claim); laidById.set(claim.id, claim); continue; }
      const home = claim.within !== undefined ? laidById.get(claim.within) : null;
      if (claim.within !== undefined && !home) { refused.push({ ...claim, why: "orphan", by: claim.within }); continue; }
      let placed = null, first = null;
      for (const slide of [0, ...claim.slides]) {
        const candidate = slide ? { ...claim, x: claim.x + claim.ux * slide, z: claim.z + claim.uz * slide, slid: slide } : claim;
        if (home && !rectInside(candidate, home, 0.05)) continue;
        const other = blocker(candidate);
        if (!other) { placed = candidate; break; }
        first ||= other;
        // The same paint already there is this paint, claimed twice (a junction mapped as two
        // nodes, two agencies at one stop). Moving along would lay it a second time behind the first.
        if (other.kind === claim.kind && other.text === claim.text) break;
      }
      if (!placed) {
        refused.push({ ...claim, why: first && first.kind === claim.kind ? "duplicate" : first ? "overlap" : "orphan",
          by: first ? first.id : claim.within });
        continue;
      }
      hold(placed); laid.push(placed); laidById.set(placed.id, placed);
    }
    // Parts of one thing stand or fall with what they lie within: handled above by ``within``.
    laid.sort((a, b) => a.order - b.order);
    return { laid, refused };
  }
}

//: A count of a settlement by kind and reason, for the page's console and the audit.
export function settlementReport({ laid, refused }) {
  const report = { laid: {}, refused: {} };
  for (const c of laid) { if (!c.fixed) report.laid[c.kind] = (report.laid[c.kind] || 0) + 1; }
  for (const c of refused) {
    const key = `${c.kind}:${c.why}`;
    report.refused[key] = (report.refused[key] || 0) + 1;
  }
  return report;
}
