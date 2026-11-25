"""One storefront wall read by Claude Opus 5.5 (Anthropic API), as the reviewer read the five.

Only clean inputs reach the model:

* **photos**: frames the pixel stage passed (no street occlusion, no blur, no bad exposure, not
  cut by the frame edge, not misaligned, at most a third of the shopfront hidden), one per view
  (straight on, angled from the left, angled from the right, the clearest sign), re-projected
  from the panorama at 1400 px so the whole front, kerb to roofline, is in the picture. Two
  frames from the same spot are one view. Fewer than two clean views: the wall is not sent.
* **the metric elevation**: the frames registered onto the wall with a labelled 1 m grid, sent
  only when it covers at least 55 % of the wall (otherwise it misleads more than it helps).
* **facts** from the records: wall lengths and streets, LiDAR height, stories, year built,
  the tenants on this wall and where the records put them, the tenant's start date against
  the photo dates, the pipeline's guess, and (as a hint, often incomplete) Qwen's reading.

The answer is the wall in the studio's own vocabulary (``kerbfront.building/1``): parts with
metres along the wall (``u``) and up from the pavement (``v``), depths and projections, colours
as paint colours. A second turn shows the model its parts drawn over the rectified elevation
and asks for corrections (``check``). The system prompt and the first turn's photos are cached,
so the check pass pays a tenth for them.

Spend goes to ``out/opus/spend.jsonl``; every worker reads it before each call, so the cap
holds across workers. Answers are cached by the hash of what was sent. The key is read from
``ANTHROPIC_API_KEY`` or ``storefronts-lab/.env.local`` and never logged.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import time
from pathlib import Path

import cv2
import numpy as np

from ..config import LAB, OUT

MODEL = "claude-opus-5-5"
EFFORT = "medium"
MAX_TOKENS = 32000
PROMPT_VERSION = "opus-wall/1"
#: USD per million tokens (Opus 5.5): input, output, cache read, 5-minute cache write
PRICE = {"in": 4.0, "out": 20.0, "cache_read": 0.20, "cache_write": 5.0}
DIR = OUT / "opus"
CACHE = DIR / "cache"
LEDGER = DIR / "spend.jsonl"
VIEW_W = 1400
CATALOGUE = Path(__file__).with_name("catalogue.json")


class BudgetSpent(RuntimeError):
    pass


def _key() -> str:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    env = LAB / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("ANTHROPIC_API_KEY missing: add it to storefronts-lab/.env.local")


def has_key() -> bool:
    try:
        return bool(_key())
    except SystemExit:
        return False


def spent() -> float:
    if not LEDGER.exists():
        return 0.0
    return sum(json.loads(line).get("cost", 0.0) for line in LEDGER.read_text().splitlines() if line.strip())


def cost(usage) -> float:
    g = lambda k: getattr(usage, k, 0) or 0  # noqa: E731
    return (g("input_tokens") * PRICE["in"] + g("output_tokens") * PRICE["out"]
            + g("cache_read_input_tokens") * PRICE["cache_read"]
            + g("cache_creation_input_tokens") * PRICE["cache_write"]) / 1e6


# ---- the prompt --------------------------------------------------------------------------

VOCAB = """\
Vocabulary (only these values are drawn; anything else is dropped):
- wall material: stucco | smooth_render | brick | painted_brick | wood_siding | shiplap | shingle | stone | concrete | tile | metal_panel | glass | painted_wood
- wall openings (upper floors and non-shop parts of the wall): kind window | door | bay
  * window: u, v, w, h, shape rect|arched|segmental|circle|square, mullions [cols, rows] (pane divisions),
    glazing grid|diamond with lattice_m, frame_colour, pane_colour, depth (reveal: how far the glass sits
    behind the wall face, 0.05-0.35 m), sill true/false
  * door (a street door that is not a shop's, e.g. to the flats above): u, v, w, h, shape, colour, glazed
  * bay: a projecting bay window. u, w, v0 (bottom), v1 (top), projection (m out from the wall),
    front_share (share of w that is the flat front, the rest are angled sides), mullions, material, colour,
    trim_colour, cap {h, colour, crest_h, crest_w} when it has a hood or crest
- pilasters: {u: [centres], w, v0, v1, depth, colour, groove_colour, top: flat|stepped, steps, step_h, flutes}
- friezes (a band with a repeated motif): {v, h, colour, motif fan|chevron|diamond|dentil|quarter_round|wave,
  motif_colour, spacing, depth}
- belts (plain string courses, projecting): {v, h, colour, depth}; bands (flat painted stripes): {v, h, colour}
- balconies: {u, w, v, depth, rail: bars|solid|glass, rail_h, colour}
- ornaments: {kind: medallion|keystone|bracket|panel, u, v, w, h, colour}
- roof: cornice {h, depth (projection), colour, raise}, parapet_h (height above the roof surface)
- storefront: {name, u0, u1, band_h (top of the shop band), material, palette {wall, accent, frame, base,
  letter, metal, glass}, door_style, openings, awnings, extra_signs, signs, lights}
  * openings: glass {kind window, u, v, w, h, transom_fraction, privacy_fraction}, door {kind door, u, v, w, h,
    leaf_count, operation hinged|sliding|revolving|roll_up, glazed}
  * awnings: {kind shed|retractable|dome|box|flat_canopy, u0, u1, v (top edge), depth_m (projection),
    drop_m, valance_h, colour, stripe (null or colour), valance_text, text_colour, font, sides}
  * extra_signs: {kind letters|board|blade|window_vinyl, u, v, w, h, offset (blade: m off the wall), thick,
    bg, edge_colour, layers: [{type text, text, x, y (0-1 in the sign), size (share of sign height), fill,
    font, weight} | {type rect|disc|halfdisc, x, y, w, h, r, fill}]}
  * lights: {kind string|gooseneck|downlight, u0, u1, v, w}
- seating: {kind parklet|sidewalk_strip|patio, u0, u1, depth_m, offset_m, barrier rail|rope|planks|low_wall,
  barrier_h, barrier_colour, deck_colour, tables, chair_colour, roof (none|corrugated|slats), roof_colour,
  roof_h, plants}
- street_objects: {kind tree|planter|heater|a_frame|pole|bus_shelter, u, w, r, trunk_h, colour}
"""

SYSTEM = f"""\
You rebuild San Francisco storefront buildings as 3D models for a city that people walk through. A
model is judged against a person who studied the same street photographs and wrote down every part
they could see, with its size, depth and colour. Match that reading.

Coordinates: one wall at a time. u is metres along the wall from its start (u=0) to its end (u=L,
the wall length you are given); v is metres up from the pavement. In the photographs the wall start
is on the left when you face the wall from the street. The grid image (when given) is the
photographs projected onto the wall plane with a labelled 1 m grid; red lines mark u=0, u=L and v=0.
It smears whatever stands off the wall (awnings, blades, trees, parklets): read those from the
photographs and place them using the grid only for where along the wall they are.

What matters, in order:
1. Every opening, sign, awning and shop that is there, none that is not. Count windows per floor and
   check the count against the photographs; buildings on these streets repeat a module: find it
   (window, pier, window, pier) and keep the rhythm exact.
2. Depth: how far each thing stands out of or sits into the wall. Window reveals, bays, cornices,
   awnings, blades, pilasters and belts all have depth; use the angled photographs to judge it.
3. The subtle patterns that make the building recognisable: pilaster flutes and stepped caps,
   frieze motifs, diamond or grid glazing, transoms, mullion counts, dentils under the cornice, trim
   picked out in a second colour, the shape of arched or segmental heads.
4. Paint colours, not shaded colours: a wall in shade is the same paint as the wall in sun.
5. Lettering: the exact words on signs and awnings, their colours and type style, only if the
   tenant in the photograph is the tenant on record (you are told when the photographs predate the
   tenant; then use the record's name and a plain sign and say so).

Shops: include every shopfront on this wall, neighbours too, each with its own u0-u1. The tenant
asked about keeps its name from the record. A shop's band_h is the top of its shopfront (the sign
fascia or the transom line), usually 3.0-4.2 m.

If something is not visible or you are unsure, leave it out rather than guess; never invent signage.
Ignore people, cars, trees in front of the wall (but report street trees and parklets as objects).

{VOCAB}
Worked example (one of each part, from a reviewed model):
{CATALOGUE.read_text() if CATALOGUE.exists() else "{{}}"}

Answer with brief reasoning if you need it, then ONE fenced ```json block holding:
{{"height_m": facade top incl. parapet, "floors": [{{"v","h"}}], "roof": {{"cornice": {{...}} or null, "parapet_h"}},
 "wall": {{"material", "colour", "trim_colour", "openings": [...], "pilasters": [...], "friezes": [...],
          "belts": [...], "bands": [...], "balconies": [...], "ornaments": [...]}},
 "storefronts": [...], "seating": [...], "street_objects": [...],
 "confidence": 0-1, "notes": "what was hard to see"}}
"""

CHECK = """\
Above: the photographs again, and your parts drawn over the rectified elevation (yellow windows,
cyan shop glass, blue doors, red awnings, magenta signs, green pilasters, yellow-green bands, white
the roofline, grey the shop bands). Compare it with the photographs part by part: missing or extra
openings, wrong counts or spacing in a repeated module, heights, depths, colours, sign words. Then
answer with ONE fenced ```json block: the complete corrected reading in the same format (or exactly
the same object if nothing needs changing)."""


# ---- inputs ------------------------------------------------------------------------------

def _jpeg(img: np.ndarray, q: int = 85) -> dict:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                        "data": base64.b64encode(buf.tobytes()).decode()}}


def _rows(bid: str, corridor: str | None, area: str) -> tuple[list[dict], dict[str, dict]]:
    """The pixel stage's verdicts for a business and the geometry picks (aim, frame) by frame."""
    f = OUT / area / f"pixels_{corridor or 'all'}.json"
    if not f.exists():
        return [], {}
    for r in json.loads(f.read_text())["results"]:
        if r["business"] == bid:
            picks = {p["frame_id"]: p for p in (r.get("picks") or []) + (r.get("near_misses") or []) + (r.get("final") or [])
                     if isinstance(p, dict) and "frame_id" in p}
            return r.get("pixels") or [], picks
    return [], {}


def clean_views(bid: str, corridor: str | None, area: str = "marina-union", since: str | None = None,
                max_views: int = 4, max_occluded: float = 0.35) -> list[dict]:
    """The frames worth sending: pixel-ok, one per view, distinct. Each item has frame_id, slot,
    captured_at, aim, frame (camera meta) and why it was chosen."""
    px, picks = _rows(bid, corridor, area)
    ok = [p for p in px if not p.get("rejects") and p.get("geometry_ok", True)
          and (p.get("metrics") or {}).get("occluded_storefront", 0) <= max_occluded and p["frame_id"] in picks
          and float((picks[p["frame_id"]].get("aim") or {}).get("span_deg") or 0) >= 15.0]
    for p in ok:
        g = picks[p["frame_id"]]
        p["_view"] = g.get("view") or p.get("slot")
        p["_aim"], p["_frame"] = g.get("aim") or {}, g.get("frame") or {}
        p["_range"] = (g.get("metrics") or {}).get("range_m", 12.0)
    chosen: list[dict] = []

    def distinct(p):
        for c in chosen:
            if c["frame_id"] == p["frame_id"]:
                return False
            same_seq = c["_frame"].get("sequence") and c["_frame"].get("sequence") == p["_frame"].get("sequence")
            db = abs(((c["_aim"].get("bearing", 0) - p["_aim"].get("bearing", 0)) + 180) % 360 - 180)
            if same_seq and db < 8:
                return False
        return True

    def take(cands, why):
        for p in sorted(cands, key=lambda p: -p.get("score", 0)):
            if distinct(p):
                chosen.append({**p, "_why": why})
                return

    take([p for p in ok if p["_view"] in ("frontal", "elevation")], "straight on")
    take([p for p in ok if p["_view"] == "oblique-left"], "angled from the left")
    take([p for p in ok if p["_view"] == "oblique-right"], "angled from the right")
    current = [p for p in ok if not since or str(p.get("captured_at") or "")[:10] >= since[:10]]
    if current:
        best = max(current, key=lambda p: p.get("score_sign", 0))
        if distinct(best) and len(chosen) < max_views:
            chosen.append({**best, "_why": "clearest sign of the current tenant"})
    for p in sorted(ok, key=lambda p: -p.get("score", 0)):  # fill with the next best distinct views
        if len(chosen) >= max_views:
            break
        if distinct(p):
            chosen.append({**p, "_why": "another clean view"})
    return chosen[:max_views]


def render_view(v: dict, top: float) -> np.ndarray | None:
    """The view framed on the shopfront, kerb to roofline: a panorama re-projected at VIEW_W px
    (aimed by the geometry stage's ``rel_to_heading``), a perspective frame cropped around it.
    None when the front would be under ~420-500 px wide (too far to read)."""
    from ..photos.pixels import _f_px, equirect_view
    from ..sources import mapillary
    aim, fm = v["_aim"], v["_frame"]
    rel, span = float(aim.get("rel_to_heading", 0.0)), float(aim.get("span_deg") or 30.0)
    spherical = fm.get("camera_type") in ("spherical", "equirectangular")
    try:
        src = None
        for size in (("original", 2048) if spherical else (2048,)):
            try:
                src = cv2.imread(str(mapillary.thumbnail(v["frame_id"], size)))
            except Exception:  # noqa: BLE001
                src = None
            if src is not None:
                break
    except Exception:  # noqa: BLE001
        src = None
    if src is None:
        return None
    if spherical:
        r = max(4.0, float(v.get("_range") or 12.0))
        lo, hi = math.atan2(-0.4 - 2.5, r), math.atan2(top + 2.0 - 2.5, r)
        pitch = math.degrees((lo + hi) / 2)
        vfov = math.degrees(hi - lo) * 1.1
        hfov = min(100.0, span + 14.0)
        if vfov / hfov > 0.85:  # the roofline needs more height than the shop needs width: widen
            hfov = min(110.0, vfov / 0.85)
        # at most ~1.2x the panorama's own angular resolution (no invented detail)
        dens = min(VIEW_W / hfov, src.shape[1] / 360.0 * 1.2)
        w = int(hfov * dens)
        h = max(int(w * 0.5), int(w * math.tan(math.radians(min(vfov, 120)) / 2) / math.tan(math.radians(hfov) / 2)))
        if span * dens < 420:
            return None
        img = equirect_view(src, rel, pitch, hfov, out_w=w, out_h=h)
    else:
        H, W = src.shape[:2]
        f = _f_px(fm, W)
        x0 = int(W / 2 + f * math.tan(math.radians(max(-80.0, rel - span / 2 - 5))))
        x1 = int(W / 2 + f * math.tan(math.radians(min(80.0, rel + span / 2 + 5))))
        x0, x1 = max(0, x0), min(W, x1)
        if x1 - x0 < 500:
            return None
        img = src[:, x0:x1]
    if max(img.shape[:2]) > 1568:
        k = 1568 / max(img.shape[:2])
        img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    return img


def _r(x, n=2):
    return round(float(x), n) if isinstance(x, (int, float)) else x


def facts(base: dict, e: int, views: list[dict], since: str | None, grid: bool, qwen: dict | None) -> str:
    w = base["walls"][e]
    f = base.get("facts") or {}
    walls = "; ".join(f"wall {i}: {x['length_m']:.2f} m, {x.get('role')}{' on ' + x['street'] if x.get('street') else ''}"
                      for i, x in enumerate(base["walls"]))
    shops = [s for s in base["storefronts"] if s["edge"] == e]
    t = "; ".join(f"{s.get('name')} ({s.get('category')}) records put it at u {s['u0']:.1f}-{s['u1']:.1f}"
                  f"{' [the tenant asked about]' if s.get('business_id') == base.get('business_id') else ''}" for s in shops)
    dates = ", ".join(sorted({str(v.get('captured_at'))[:10] for v in views}))
    pre = since and all(str(v.get("captured_at") or "")[:10] < since[:10] for v in views)
    lines = [
        f"Building: {base.get('title')} at {(base.get('address') or {}).get('number', '')} {(base.get('address') or {}).get('street', '')}; "
        f"{f.get('stories') or '?'} stories, built {f.get('year_built') or '?'}, {f.get('use') or ''}; "
        f"historic: {((f.get('historic') or {}).get('ceqacodereason')) or 'no'}.",
        f"Walls: {walls}. This reading is wall {e} ({w['length_m']:.2f} m{', on ' + w['street'] if w.get('street') else ''}).",
        f"LiDAR roof surface {base['height_m']:.1f} m above the pavement (a parapet or false front stands above it).",
        f"Tenants on this wall: {t or 'none on record'}. Record start of the tenant asked about: {since or 'unknown'}.",
        f"Photographs taken: {dates}." + (" All of them predate the current tenant: its signs are not in them." if pre else ""),
        "Outdoor dining on record: " + json.dumps((f.get("outdoor") or {}).get("kinds") or [])
        + (f", parklet licence {(f.get('licence') or {}).get('parklet')}" if (f.get("licence") or {}).get("parklet") else "") + ".",
    ]
    st = base.get("street") or {}
    if st:
        lines.append(f"Street: {st.get('name')}, sidewalk {st.get('sidewalk_m')} m, parking lane {st.get('parking_m')} m.")
    lines.append("Images: " + ("1 = the rectified elevation with the metric grid; then " if grid else "")
                 + "; ".join(f"photo {i + 1 + int(grid)} {v['_why']} ({str(v.get('captured_at'))[:10]})" for i, v in enumerate(views)) + ".")
    if qwen:
        lines.append("A cheaper model's reading of the same wall, for hints only (it often misses parts and "
                     "misplaces them): " + json.dumps(qwen, separators=(",", ":")))
    return "\n".join(lines)


def qwen_hint(mid: str, e: int) -> dict | None:
    """The parts of Qwen's reading worth a glance: sign words, awnings, shop bands."""
    p = LAB / "models" / "auto" / f"{mid}.json"
    if not p.exists():
        return None
    m = json.loads(p.read_text())
    out = []
    for s in m.get("storefronts", []):
        if s.get("edge") != e:
            continue
        words = [ly.get("text") for x in (s.get("extra_signs") or []) + (s.get("signs") or [])
                 for ly in (x.get("layers") or []) if ly.get("type") == "text" and ly.get("text")]
        out.append({"name": s.get("name"), "u": [_r(s["u0"], 1), _r(s["u1"], 1)], "band_h": _r(s.get("band_h"), 1),
                    "awnings": [[a.get("kind"), a.get("colour"), _r(a["u0"], 1), _r(a["u1"], 1)] for a in s.get("awnings") or []],
                    "sign_words": words[:6]})
    return {"shops": out} if out else None


# ---- answers -----------------------------------------------------------------------------

def parse(text: str) -> dict | None:
    blocks = re.findall(r"```json\s*(.*?)```", text, re.S)
    for b in reversed(blocks or [text[text.find("{"): text.rfind("}") + 1]]):
        try:
            d = json.loads(b)
            if isinstance(d, dict):
                return d
        except json.JSONDecodeError:
            continue
    return None


MATERIALS = {"stucco", "smooth_render", "brick", "painted_brick", "wood_siding", "shiplap", "shingle", "stone",
             "concrete", "tile", "metal_panel", "glass", "painted_wood"}
ENUMS = {
    ("opening", "kind"): {"window", "door", "bay"},
    ("opening", "shape"): {"rect", "arched", "segmental", "circle", "square"},
    ("opening", "glazing"): {"grid", "diamond"},
    ("pilaster", "top"): {"flat", "stepped"},
    ("frieze", "motif"): {"fan", "chevron", "diamond", "dentil", "quarter_round", "wave"},
    ("awning", "kind"): {"shed", "retractable", "dome", "box", "flat_canopy"},
    ("sign", "kind"): {"letters", "board", "blade", "window_vinyl", "rooftop"},
    ("seat", "kind"): {"parklet", "sidewalk_strip", "patio"},
    ("seat", "barrier"): {"rail", "rope", "planks", "low_wall", None},
    ("object", "kind"): {"tree", "planter", "heater", "a_frame", "pole", "bus_shelter", "string_lights"},
}
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _num(x, lo, hi, default=None):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return default if not math.isfinite(v) else min(hi, max(lo, v))


def _col(x, default=None):
    return x.lower() if isinstance(x, str) and _HEX.match(x) else default


def _enum(group, key, x, default=None):
    return x if x in ENUMS[(group, key)] else default


def _colours(d: dict) -> dict:
    """Every colour-looking field is a #rrggbb or dropped."""
    out = {}
    for k, v in d.items():
        if (k.endswith("colour") or k in ("bg", "fill", "stripe")) and v is not None:
            v = _col(v)
            if v is None:
                continue
        out[k] = v
    return out


def _span(d: dict, L: float, H: float, keys=("u", "v", "w", "h")) -> dict | None:
    u, v = _num(d.get("u"), -1.0, L + 1.0), _num(d.get("v"), -0.5, H + 2.0)
    w, h = _num(d.get("w"), 0.05, L + 1.0), _num(d.get("h"), 0.05, H + 2.0)
    if None in (u, v, w, h):
        return None
    return {**d, "u": round(u, 2), "v": round(v, 2), "w": round(w, 2), "h": round(h, 2)}


def sanitize(ans: dict, base: dict, e: int) -> dict:
    """The answer clamped to the wall and the vocabulary; parts that cannot be drawn are dropped
    and counted in ``dropped``."""
    L = float(base["walls"][e]["length_m"])
    H = _num(ans.get("height_m"), 2.5, 60.0, float(base["height_m"]))
    dropped = []

    def keep(kind, items, fn):
        out = []
        for i, x in enumerate(items if isinstance(items, list) else []):
            y = fn(x) if isinstance(x, dict) else None
            if y is None:
                dropped.append(f"{kind}[{i}]")
            else:
                out.append(y)
        return out

    def opening(o):
        k = _enum("opening", "kind", o.get("kind"))
        if k is None:
            return None
        if k == "bay":
            u, w = _num(o.get("u"), -1, L + 1), _num(o.get("w"), 0.3, L)
            v0, v1 = _num(o.get("v0"), 0, H + 1), _num(o.get("v1"), 0, H + 2)
            if None in (u, w, v0, v1) or v1 <= v0:
                return None
            o = {**o, "u": u, "w": w, "v0": v0, "v1": v1, "v": o.get("v", v0 + 0.75), "h": o.get("h", v1 - v0 - 1.0),
                 "projection": _num(o.get("projection"), 0.1, 1.5, 0.6), "front_share": _num(o.get("front_share"), 0.2, 1.0, 0.6)}
            if o.get("material") not in MATERIALS:
                o.pop("material", None)
            return _colours(o)
        o = _span(o, L, H)
        if o is None:
            return None
        o["shape"] = _enum("opening", "shape", o.get("shape"), "rect")
        if "glazing" in o and _enum("opening", "glazing", o["glazing"]) is None:
            o.pop("glazing")
        if "depth" in o:
            o["depth"] = _num(o["depth"], 0.0, 0.5, 0.12)
        return _colours(o)

    def pilaster(p):
        us = [round(_num(u, -1, L + 1), 2) for u in (p.get("u") or []) if _num(u, -1, L + 1) is not None]
        w, v0, v1 = _num(p.get("w"), 0.08, 2.0), _num(p.get("v0"), -0.5, H + 1), _num(p.get("v1"), 0, H + 2)
        if not us or None in (w, v0, v1) or v1 <= v0:
            return None
        p = {**p, "u": us, "w": w, "v0": v0, "v1": v1, "depth": _num(p.get("depth"), 0.0, 0.6, 0.1)}
        p["top"] = _enum("pilaster", "top", p.get("top"), "flat")
        return _colours(p)

    def band(b, motif=False):
        v, h = _num(b.get("v"), -0.5, H + 2), _num(b.get("h"), 0.02, 3.0)
        if v is None or h is None:
            return None
        b = {**b, "v": v, "h": h}
        if "depth" in b:
            b["depth"] = _num(b["depth"], 0.0, 0.6, 0.05)
        if motif and _enum("frieze", "motif", b.get("motif")) is None:
            b.pop("motif", None)
        return _colours(b)

    def balcony(b):
        b = _span({**b, "h": b.get("h", b.get("rail_h", 1.0))}, L, H)
        return None if b is None else _colours({**b, "depth": _num(b.get("depth"), 0.1, 2.5, 0.8)})

    def ornament(o):
        o = _span(o, L, H)
        return None if o is None else _colours(o)

    wa = ans.get("wall") or {}
    wall = {"material": wa.get("material") if wa.get("material") in MATERIALS else None,
            "colour": _col(wa.get("colour")), "trim_colour": _col(wa.get("trim_colour")),
            "openings": keep("opening", wa.get("openings"), opening),
            "pilasters": keep("pilaster", wa.get("pilasters"), pilaster),
            "friezes": keep("frieze", wa.get("friezes"), lambda b: band(b, True)),
            "belts": keep("belt", wa.get("belts"), band),
            "bands": keep("band", wa.get("bands"), band),
            "balconies": keep("balcony", wa.get("balconies"), balcony),
            "ornaments": keep("ornament", wa.get("ornaments"), ornament)}

    def sign(x):
        k = _enum("sign", "kind", x.get("kind"))
        x = _span({**x, "w": x.get("w", 0.5), "h": x.get("h", 0.5)}, L, H)
        if k is None or x is None:
            return None
        layers = []
        for ly in x.get("layers") or []:
            if isinstance(ly, dict) and ly.get("type") in ("text", "rect", "disc", "halfdisc"):
                if ly["type"] == "text" and not str(ly.get("text") or "").strip():
                    continue
                layers.append(_colours(ly))
        return _colours({**x, "kind": k, "layers": layers})

    def awning(a):
        k = _enum("awning", "kind", a.get("kind"))
        u0, u1 = _num(a.get("u0"), -1, L + 1), _num(a.get("u1"), -1, L + 1)
        if k is None or None in (u0, u1) or u1 - u0 < 0.3:
            return None
        return _colours({**a, "kind": k, "u0": u0, "u1": u1, "v": _num(a.get("v"), 1.8, 6.0, 3.0),
                         "depth_m": _num(a.get("depth_m"), 0.2, 4.0, 1.0), "drop_m": _num(a.get("drop_m"), 0.0, 2.0, 0.4)})

    def shop_opening(o):
        k = o.get("kind") if o.get("kind") in ("window", "door") else None
        o = _span(o, L, 6.0)
        return None if k is None or o is None else _colours(o)

    shops = []
    for i, s in enumerate(ans.get("storefronts") if isinstance(ans.get("storefronts"), list) else []):
        u0, u1 = _num(s.get("u0"), 0, L), _num(s.get("u1"), 0, L)
        if not isinstance(s, dict) or None in (u0, u1) or u1 - u0 < 0.8:
            dropped.append(f"storefront[{i}]")
            continue
        pal = {k: _col(v) for k, v in (s.get("palette") or {}).items() if _col(v)}
        shops.append({"name": s.get("name"), "u0": u0, "u1": u1, "band_h": _num(s.get("band_h"), 2.2, 6.0, 3.4),
                      "material": s.get("material") if s.get("material") in MATERIALS else None,
                      "palette": pal, "door_style": s.get("door_style"),
                      "openings": keep("shop opening", s.get("openings"), shop_opening),
                      "awnings": keep("awning", s.get("awnings"), awning),
                      "extra_signs": keep("sign", s.get("extra_signs"), sign),
                      "signs": keep("sign", s.get("signs"), sign),
                      "lights": [x for x in (s.get("lights") or []) if isinstance(x, dict)]})

    def seat(x):
        k = _enum("seat", "kind", x.get("kind"))
        u0, u1 = _num(x.get("u0"), -1, L + 1), _num(x.get("u1"), -1, L + 1)
        if k is None or None in (u0, u1) or u1 - u0 < 0.5:
            return None
        x = {**x, "kind": k, "u0": u0, "u1": u1, "depth_m": _num(x.get("depth_m"), 0.3, 4.0, 1.2)}
        if _enum("seat", "barrier", x.get("barrier"), "x") == "x":
            x.pop("barrier", None)
        return _colours(x)

    def obj(x):
        k = _enum("object", "kind", x.get("kind"))
        u = _num(x.get("u"), -2, L + 2)
        return None if k is None or u is None else _colours({**x, "kind": k, "u": u})

    roof = ans.get("roof") or {}
    cor = roof.get("cornice") if isinstance(roof.get("cornice"), dict) else None
    if cor:
        cor = _colours({"h": _num(cor.get("h"), 0.02, 1.5, 0.2), "depth": _num(cor.get("depth"), 0.0, 1.5, 0.15),
                        "colour": cor.get("colour"), "raise": _num(cor.get("raise"), 0, 1, 0)})
    floors = [{"v": _num(f.get("v"), 0, H), "h": _num(f.get("h"), 1.8, 8.0)} for f in ans.get("floors") or []
              if isinstance(f, dict) and _num(f.get("v"), 0, H) is not None and _num(f.get("h"), 1.8, 8.0) is not None]
    return {"height_m": round(H, 2), "floors": floors, "cornice": cor,
            "parapet_h": _num(roof.get("parapet_h"), 0.0, 3.0), "wall": wall, "storefronts": shops,
            "seating": keep("seating", ans.get("seating"), seat),
            "street_objects": keep("street object", ans.get("street_objects"), obj),
            "confidence": _num(ans.get("confidence"), 0, 1, 0.5), "notes": str(ans.get("notes") or "")[:600],
            "dropped": dropped}


def to_observations(base: dict, e: int, r: dict, frames: list[str], how: str) -> list[dict]:
    """The sanitized reading as the reviewer's observation rows (paths into the model)."""
    ev = {"frames": frames, "how": how, "confidence": r["confidence"], "read_by": MODEL}
    rows = [{"path": "height_m", "value": r["height_m"], "evidence": ev}]
    if r["floors"]:
        rows.append({"path": "floors", "value": r["floors"], "evidence": ev})
    if r["cornice"] is not None:
        rows.append({"path": "roof.cornice", "value": r["cornice"], "evidence": ev})
    if r["parapet_h"] is not None:
        rows.append({"path": "roof.parapet_h", "value": r["parapet_h"], "evidence": ev})
    for k, v in r["wall"].items():
        if v is not None:
            if isinstance(v, list):
                v = [{**x, "id": x.get("id") or f"w{e}:{k[:3]}{i}"} for i, x in enumerate(v)]
            rows.append({"path": f"walls.{e}.{k}", "value": v, "evidence": ev})
    # shops on this wall replaced; the tenant asked about keeps its record identity
    mine = [s for s in base["storefronts"] if s["edge"] == e]
    from .flow import _same_name
    used, new = set(), []
    for j, s in enumerate(r["storefronts"]):
        match = next((m for m in mine if m["id"] not in used and _same_name(m.get("name") or "", s.get("name") or "")), None)
        if match is None and base.get("business_id"):
            # the record tenant whose span overlaps most, if its name was not read (pre-tenancy photos)
            ov = lambda m: max(0.0, min(m["u1"], s["u1"]) - max(m["u0"], s["u0"]))  # noqa: E731
            cand = [m for m in mine if m["id"] not in used and ov(m) > 0.5 * (s["u1"] - s["u0"])]
            match = max(cand, key=ov) if cand else None
        sid = match["id"] if match else f"sf-opus-w{e}-{j}"
        used.add(sid)
        keep = {k: match[k] for k in ("business_id", "category", "brand") if match and k in match}
        name = (match or {}).get("name") if match and match.get("business_id") == base.get("business_id") else s.get("name")
        sf = {"id": sid, "business_id": None, "category": "shop", "brand": None, **keep, **s, "name": name or s.get("name"),
              "edge": e, "evidence": {"kind": "observed", **ev}}
        for k in ("openings", "awnings", "extra_signs", "signs"):
            sf[k] = [{**x, "id": x.get("id") or f"{sid}:{k[:3]}{i}"} for i, x in enumerate(sf.get(k) or [])]
        new.append(sf)
    if not any(s.get("business_id") == base.get("business_id") for s in new):
        # the tenant asked about was not found on this wall: keep its record shop rather than lose it
        new += [m for m in mine if m.get("business_id") == base.get("business_id") and m["id"] not in used]
    others = [s for s in base["storefronts"] if s["edge"] != e]
    rows.append({"path": "storefronts", "value": others + new, "evidence": ev})
    for key in ("seating", "street_objects"):
        keep_other = [x for x in base.get(key) or [] if x.get("edge") != e]
        mine_new = [{**x, "edge": e, "id": x.get("id") or f"opus-{key[:4]}-{e}-{i}"} for i, x in enumerate(r[key])]
        rows.append({"path": key, "value": keep_other + mine_new, "evidence": ev})
    return rows


# ---- the call ----------------------------------------------------------------------------

def _hash(content) -> str:
    return hashlib.sha256((PROMPT_VERSION + MODEL + EFFORT + json.dumps(content, sort_keys=True)).encode()).hexdigest()[:24]


def _ledger(tag: str, usage, seconds: float, stop: str, turn: str) -> float:
    c = cost(usage)
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a") as f:
        f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "turn": turn, "model": MODEL,
                            "effort": EFFORT, "in": usage.input_tokens, "out": usage.output_tokens,
                            "cache_read": getattr(usage, "cache_read_input_tokens", 0) or 0,
                            "cache_write": getattr(usage, "cache_creation_input_tokens", 0) or 0,
                            "cost": round(c, 5), "seconds": round(seconds, 1), "stop": stop}) + "\n")
    return c


def _client():
    import anthropic
    return anthropic.Anthropic(api_key=_key(), max_retries=4, timeout=600)


def _ask(client, messages: list, tag: str, turn: str, budget: float, log) -> tuple[object, str]:
    if spent() >= budget:
        raise BudgetSpent(f"Opus spend ${spent():.2f} reached the cap ${budget:.2f}")
    t0 = time.time()
    with client.beta.messages.stream(
            model=MODEL, max_tokens=MAX_TOKENS, output_config={"effort": EFFORT},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=messages) as s:
        msg = s.get_final_message()
    c = _ledger(tag, msg.usage, time.time() - t0, msg.stop_reason, turn)
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    log(f"  opus {tag} {turn}: {msg.usage.input_tokens}+{getattr(msg.usage, 'cache_read_input_tokens', 0)} cached in, "
        f"{msg.usage.output_tokens} out, ${c:.3f}, {time.time() - t0:.0f} s, {msg.stop_reason}")
    return msg, text


def read_wall(images: list[np.ndarray], text: str, tag: str, budget: float, log=print,
              check=None) -> dict | None:
    """One reading (and, with ``check(answer) -> image``, a correction turn). Cached by input hash."""
    content = [_jpeg(im) for im in images] + [{"type": "text", "text": text}]
    h = _hash([content, bool(check)])
    hit = CACHE / f"{h}.json"
    if hit.exists():
        log(f"  opus {tag}: cached answer")
        return json.loads(hit.read_text())
    content[-1]["cache_control"] = {"type": "ephemeral"}  # the photos stay cached for the check turn
    client = _client()
    msgs = [{"role": "user", "content": content}]
    msg, out = _ask(client, msgs, tag, "read", budget, log)
    if msg.stop_reason == "refusal":
        log(f"  opus {tag}: refused")
        return None
    ans = parse(out)
    first = ans
    if ans is not None and check is not None:
        over = check(ans)
        if over is not None:
            msgs += [{"role": "assistant", "content": msg.content},
                     {"role": "user", "content": [_jpeg(over), {"type": "text", "text": CHECK}]}]
            try:
                msg2, out2 = _ask(client, msgs, tag, "check", budget, log)
                ans = (parse(out2) if msg2.stop_reason != "refusal" else None) or ans
            except BudgetSpent:
                pass
    if ans is None:
        log(f"  opus {tag}: no JSON in the answer")
        return None
    rec = {"answer": ans, "first": first, "notes": out[-1500:]}
    CACHE.mkdir(parents=True, exist_ok=True)
    hit.write_text(json.dumps(rec))
    return rec
