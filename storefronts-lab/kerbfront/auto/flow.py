"""``kerbfront qwen-run``: restaurants read by Qwen, one worker, filtered before any spend.

Stages, cheapest first. A restaurant goes no further than the first stage it fails, and its
reason is kept in ``out/qwen/state.json``:

1. **records** (free): rendered as a restaurant by the app's tenant rules, open (or unknown),
   at street level, on a matched storefront wall of a building, storefront likelihood >= 0.5,
   frames picked by the photo filter. One read per wall: tenants sharing a wall share it.
2. **model** (free): the pipeline builds a model and has at least two frames for the wall.
3. **photos** (local compute): the frames register into an elevation that covers at least
   40 % of the wall and its shop band, and Grounding DINO finds something on it.
4. **Qwen** (paid): one call per storefront wall (:mod:`.qwen`), answer validated, clamped to
   the wall, windows snapped to the detector's boxes, written as observations.

No interiors: only facades. The five reviewed restaurants go first, so their reading can be
scored against the reviewer's (``kerbfront score``).
"""

from __future__ import annotations

import glob
import json
import time
import traceback

import numpy as np

from ..config import LAB, OUT
from ..sources.kerbside import business_type
from . import qwen as Q
from .read import Wall, hexc
from .run import AUTO, AUTO_MODELS, WORK, elevations, observations

STATE = OUT / "qwen" / "state.json"
LOG = OUT / "qwen" / "run.log"


def _log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


#: retail the readers take beside restaurants (``kinds="retail"``); services, hotels and offices are left
RETAIL_TAGS = {"shop", "clothing", "shoes", "convenience", "grocery", "supermarket", "jewelry", "florist", "pet",
               "books", "pharmacy", "optician", "gift", "liquor", "deli", "bakery", "cafe", "hardware",
               "furniture", "electronics", "sports", "toys", "cosmetics", "wine", "bicycle", "art", "stationery"}
_REGISTRY_ONLY = {"name", "legal_name", "location_start_date", "business_corridor"}


def wanted(z: dict, kinds: str = "restaurant") -> bool:
    """Is this business a kind of place the reader takes? ``restaurant``: food; ``retail``: food
    and shops (a generic "shop" only with more than a registry name behind it)."""
    t = business_type(z)
    if t["render"] == "restaurant":
        return True
    if kinds != "retail" or t["render"] != "storefront" or t["tag"] not in RETAIL_TAGS:
        return False
    return t["tag"] != "shop" or bool(set(z["fields"]) - _REGISTRY_ONLY)


def candidates(area: str = "marina-union", corridor: str | None = None, kinds: str = "restaurant") -> set[str]:
    """Businesses the flow could take, before photos are known: the pixel stage checks only
    these. ``corridor`` None is the businesses on no corridor (``photos_all``)."""
    biz = json.loads((OUT / area / "businesses.json").read_text())
    return {z["id"] for z in biz if wanted(z, kinds) and z.get("face")
            and z.get("building") and z["storefront_likelihood"] >= 0.5
            and not ((z.get("address") or {}).get("upper_floor") or (z.get("address") or {}).get("suite"))
            and z.get("corridor") == corridor}


def eligible(area: str = "marina-union", kinds: str = "restaurant") -> tuple[list[dict], dict]:
    out = OUT / area
    biz = json.loads((out / "businesses.json").read_text())
    picks: dict[str, int] = {}
    for f in glob.glob(str(out / "photos_*.json")):
        for r in json.loads(open(f).read())["results"]:
            p = r.get("picks")
            picks[r["business"]] = max(picks.get(r["business"], 0), p if isinstance(p, int) else len(p or []))
    v = lambda z, k: (z["fields"].get(k) or {}).get("value")  # noqa: E731
    reasons: dict[str, int] = {}
    keep, walls = [], set()

    def no(why):
        reasons[why] = reasons.get(why, 0) + 1
    reviewed = [json.loads(p.read_text())["business_id"] for p in (LAB / "models").glob("*.json")
                if p.stem in ("tacolicious", "super-duper-burgers", "balboa-cafe", "a16", "dragon-well")]
    biz = sorted(biz, key=lambda z: z["id"] not in reviewed)
    for z in biz:
        # recomputed, not read from the sweep: the stored type predates the category fix
        if not wanted(z, kinds):
            continue
        a = z.get("address") or {}
        if v(z, "operating_status") not in (None, "open"):
            no("not open")
        elif not z.get("face") or not z.get("building"):
            no("no storefront wall")
        elif z["storefront_likelihood"] < 0.5:
            no("unlikely storefront")
        elif a.get("upper_floor") or a.get("suite"):
            no("upper floor / suite")
        elif picks.get(z["id"], 0) == 0:
            no("no frames picked")
        else:
            w = z["face"]["id"].split("@")[0]
            if w in walls:
                no("wall already queued (shared)")
                continue
            walls.add(w)
            keep.append({"id": z["id"], "name": v(z, "name"), "corridor": z.get("corridor"), "wall": w,
                         "kind": business_type(z)["tag"]})
    keep.sort(key=lambda x: (x["id"] not in reviewed, x["corridor"] or "~", x["name"] or ""))
    return keep, reasons


def _state_path(shard: tuple[int, int] | None):
    return STATE if shard is None else STATE.with_name(f"state-{shard[0]}of{shard[1]}.json")


def _state(shard: tuple[int, int] | None = None) -> dict:
    p = _state_path(shard)
    return json.loads(p.read_text()) if p.exists() else {"done": {}, "skipped": {}}


def _save(st: dict, shard: tuple[int, int] | None = None) -> None:
    p = _state_path(shard)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(st, indent=1))


# ---- the Qwen answer as the reader's findings --------------------------------------------

def _num(x, lo=-1e9, hi=1e9):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(f) else float(min(hi, max(lo, f)))


def _hex(x, default=None):
    return x if isinstance(x, str) and len(x) == 7 and x.startswith("#") else default


def _iou(a, b):
    iu = max(0.0, min(a["u"] + a["w"], b["u"] + b["w"]) - max(a["u"], b["u"]))
    iv = max(0.0, min(a["v"] + a["h"], b["v"] + b["h"]) - max(a["v"], b["v"]))
    i = iu * iv
    return i / (a["w"] * a["h"] + b["w"] * b["h"] - i + 1e-9)


def findings(q: dict, W: Wall, frames: list[str], lidar_h: float) -> dict:
    L = W.L
    h = _num(q.get("height"), 2.0, lidar_h + 4.0) or lidar_h
    bt = _num(q.get("band_top"), 2.0, min(6.5, h)) or min(3.9, h)
    wall = q.get("wall") or [None, None, None]
    wall = (list(wall) + [None, None, None])[:3]
    r: dict = {"edge": W.e, "frames": frames, "height": round(h, 2), "height_info": {"how": "qwen"},
               "band_top": round(bt, 2), "colour": _hex(wall[0], "#d9d2c3"),
               "material": wall[1] if isinstance(wall[1], str) and wall[1] in Q.MATERIALS.split("|") else None,
               "material_info": {"by": Q.MODEL}, "trim": _hex(wall[2])}
    dets = W.detected("window", 0.27)
    wins = []
    for o in q.get("windows") or []:
        if not isinstance(o, list) or len(o) < 4:
            continue
        u, v, w, hh = (_num(o[0], -0.5, L), _num(o[1], 0, h + 1), _num(o[2], 0.2, 8), _num(o[3], 0.3, 4))
        if None in (u, v, w, hh) or v < bt - 0.3:
            continue
        box = {"u": u, "v": v, "w": w, "h": hh}
        best = max(dets, key=lambda d: _iou(box, d), default=None)
        if best is not None and _iou(box, best) >= 0.3:  # the detector's edges are on the pixels
            box = {k: best[k] for k in ("u", "v", "w", "h")}
        win = {**{k: round(x, 2) for k, x in box.items()},
               "shape": "arched" if len(o) > 4 and o[4] == "arched" else "rect", "frame_colour": None}
        if len(o) > 7:  # the deep reading: panes, reveal and sill
            cols, rows_ = _num(o[5], 1, 8), _num(o[6], 1, 6)
            if cols and rows_:
                win["mullions"] = [int(cols), int(rows_)]
            win["depth"] = _num(o[7], 0.03, 0.5) or 0.12
            win["sill"] = bool(o[8]) if len(o) > 8 else True
        wins.append(win)
    r["windows"] = Wall._regular(wins)
    pil = q.get("pilasters")
    r["pilasters"] = []
    if isinstance(pil, list) and len(pil) >= 5 and isinstance(pil[0], list) and pil[0]:
        us = [round(x, 2) for x in (_num(u, 0, L) for u in pil[0]) if x is not None]
        if us:
            r["pilasters"] = [{"u": us, "w": _num(pil[1], 0.1, 1.5) or 0.4, "v0": _num(pil[2], 0, h) or bt,
                               "v1": _num(pil[3], 0, h + 1.5) or h,
                               "depth": (_num(pil[5], 0.03, 0.6) if len(pil) > 5 else None) or 0.12,
                               "colour": _hex(pil[4], "#bbbbbb")}]
    r["bands"] = []
    for b in q.get("belts") or []:
        if isinstance(b, list) and len(b) >= 2 and _num(b[0], 0.3, h + 1) is not None:
            band = {"v": _num(b[0], 0.3, h + 1), "h": _num(b[1], 0.04, 1.0) or 0.1,
                    "colour": _hex(b[2] if len(b) > 2 else None, r["trim"] or "#efeae0")}
            if len(b) > 3 and _num(b[3], 0.01, 0.8) is not None:
                band["depth"] = _num(b[3], 0.01, 0.8)
            r["bands"].append(band)
    glass = []
    for g_ in q.get("glass") or []:
        if isinstance(g_, list) and len(g_) >= 4 and None not in (_num(g_[0]), _num(g_[1])):
            a, b = sorted((_num(g_[0], 0, L), _num(g_[1], 0, L)))
            if b - a >= 0.3:
                glass.append({"u0": round(a, 2), "u1": round(b, 2), "v": _num(g_[2], 0, 2) or 0.3,
                              "top": min(_num(g_[3], 0.8, bt) or bt - 0.3, bt - 0.1)})
    doors = [{"u": _num(d[0], 0, L), "w": _num(d[1], 0.6, 2.5) or 1.0} for d in q.get("doors") or []
             if isinstance(d, list) and len(d) >= 2 and _num(d[0]) is not None]
    r["shop"] = {"glass": glass, "doors": doors}
    r["shops"] = [[_num(s[0], 0, L), _num(s[1], 0, L), s[2] if len(s) > 2 else None] for s in q.get("shops") or []
                  if isinstance(s, list) and len(s) >= 2 and _num(s[0]) is not None and _num(s[1]) is not None]
    r["awnings"] = []
    for a in q.get("awnings") or []:
        if isinstance(a, list) and len(a) >= 4 and None not in (_num(a[0]), _num(a[1])):
            u0, u1 = sorted((_num(a[0], 0, L), _num(a[1], 0, L)))
            if u1 - u0 >= 0.4:
                r["awnings"].append({"u0": round(u0, 2), "u1": round(u1, 2), "v": _num(a[2], 1.8, 6) or bt - 0.3,
                                     "colour": _hex(a[3], "#2f4f43"),
                                     "kind": a[4] if len(a) > 4 and a[4] in ("shed", "retractable", "dome", "box", "flat_canopy") else "shed",
                                     "fabric": bool(a[5]) if len(a) > 5 else True,
                                     "projection": _num(a[6], 0.3, 3.5) if len(a) > 6 else None})
    r["signs"] = []
    for s in q.get("signs") or []:
        if isinstance(s, list) and len(s) >= 6 and None not in (_num(s[1]), _num(s[2])):
            kind = s[0] if s[0] in ("board", "letters", "blade", "window_vinyl") else "board"
            r["signs"].append({"kind": kind, "u": _num(s[1], -0.5, L + 0.5), "v": _num(s[2], 0, h + 1.5),
                               "w": _num(s[3], 0.2, L) or 1.0, "h": _num(s[4], 0.1, 3) or 0.4,
                               "bg": _hex(s[5], "#222222"), "text": s[6] if len(s) > 6 and isinstance(s[6], str) else None})
    r["seating_q"] = [[s[0], _num(s[1], -3, L + 3), _num(s[2], -3, L + 3)] for s in q.get("seating") or []
                      if isinstance(s, list) and len(s) >= 3 and s[0] in ("sidewalk_strip", "parklet", "cafe_enclosure")
                      and None not in (_num(s[1]), _num(s[2]))]
    for k in ("parklet_runs", "lane_cars", "walk_runs", "trees"):
        r[k] = []
    r["conf"] = _num(q.get("conf"), 0, 1)
    # the deep reading's parts that stand off the wall
    deep = {}
    bays = []
    for x in q.get("bays") or []:
        if isinstance(x, list) and len(x) >= 5 and None not in (_num(x[0]), _num(x[1]), _num(x[2]), _num(x[3])):
            u, w = _num(x[0], -0.5, L), _num(x[1], 0.6, 6)
            v0, v1 = sorted((_num(x[2], 0, h), _num(x[3], 0, h + 1)))
            if w and v1 - v0 >= 1.0:
                bays.append({"u": round(u, 2), "w": round(w, 2), "v0": round(v0, 2), "v1": round(v1, 2),
                             "projection": _num(x[4], 0.2, 1.5) or 0.6,
                             "colour": _hex(x[5] if len(x) > 5 else None, r["colour"]),
                             "material": x[6] if len(x) > 6 and x[6] in Q.MATERIALS.split("|") else r["material"]})
    if bays:
        deep["bays"] = bays
    balc = [{"u": _num(x[0], -0.5, L), "w": _num(x[1], 0.5, 8) or 1.5, "v": _num(x[2], 2, h), "depth": _num(x[3], 0.2, 2.0) or 0.7,
             "h": 1.0, "colour": _hex(x[4] if len(x) > 4 else None, "#2b2b2a")}
            for x in q.get("balconies") or [] if isinstance(x, list) and len(x) >= 4 and None not in (_num(x[0]), _num(x[2]))]
    if balc:
        deep["balconies"] = balc
    c = q.get("cornice")
    if isinstance(c, list) and len(c) >= 2 and _num(c[0]) is not None:
        deep["cornice"] = {"h": _num(c[0], 0.03, 1.5), "depth": _num(c[1], 0.02, 1.2) or 0.1,
                           "colour": _hex(c[2] if len(c) > 2 else None, r["trim"] or r["colour"]), "raise": 0}
    if _num(q.get("parapet_h"), 0, 3) is not None:
        deep["parapet_h"] = _num(q.get("parapet_h"), 0, 3)
    if deep:
        r["deep"] = deep
    return r


def to_model(base: dict, reads: dict[int, dict]) -> tuple[dict, list[dict]]:
    obs = observations(base, reads)
    obs = [o for o in obs if o["path"] not in ("street_objects", "seating")]
    # signs keep their lettering; trims as read
    for o in obs:
        if o["path"] == "storefronts":
            for sf in o["value"]:
                e = sf.get("edge")
                for x in sf.get("extra_signs", []) or []:
                    src = next((s for s in reads.get(e, {}).get("signs", [])
                                if abs(s["u"] - x["u"]) < 0.05 and abs(s["v"] - x["v"]) < 0.05), None)
                    if src and src.get("text"):
                        text = src["text"]
                        # every frame predates this tenant: the lettering seen is the last one's
                        if reads.get(e, {}).get("pre_tenancy") and sf.get("name") and not _same_name(text, sf["name"]):
                            text, x["text_source"] = sf["name"], f"record: photos predate the tenant ({src['text']} seen)"
                        x["layers"] = [{"type": "text", "text": text, "x": 0.5, "y": 0.62, "size": 0.5,
                                        "fill": "#f6f1e7" if _dark(x.get("bg")) else "#1f1f1f"}]
                for a in sf.get("awnings", []) or []:
                    src = next((y for y in reads.get(e, {}).get("awnings", []) if abs(y["u0"] - a["u0"]) < 0.05), None)
                    if src:
                        a["kind"], a["fabric"] = src["kind"], src["fabric"]
                        a["material"] = "canvas" if src["fabric"] else "metal_panel"
                        if src.get("projection"):
                            a["depth_m"] = round(src["projection"], 2)
    # the deep reading: bays among the openings, balconies, the cornice's projection, the parapet
    main = max(reads, key=lambda e: len(reads[e]["frames"]), default=None)
    for e, r in reads.items():
        d = r.get("deep") or {}
        for o in obs:
            if o["path"] == f"walls.{e}.openings" and d.get("bays"):
                o["value"] = o["value"] + [{"id": f"w{e}:bay{i}", "kind": "bay", "u": b["u"], "w": b["w"],
                                            "v": b["v0"] + 0.75, "h": max(1.0, b["v1"] - b["v0"] - 1.5),
                                            "v0": b["v0"], "v1": b["v1"], "projection": b["projection"],
                                            "front_share": 0.6, "material": b["material"], "colour": b["colour"],
                                            "trim_colour": r.get("trim"), "mullions": [2, 1]}
                                           for i, b in enumerate(d["bays"])]
        ev = {"frames": r["frames"][:8], "how": f"{Q.MODEL} deep reading (oblique photo)", "confidence": 0.5,
              "read_by": "kerbfront qwen"}
        if d.get("balconies"):
            obs.append({"path": f"walls.{e}.balconies", "value": d["balconies"], "evidence": ev})
        if e == main and d.get("cornice"):
            obs = [o for o in obs if o["path"] != "roof.cornice"]
            obs.append({"path": "roof.cornice", "value": d["cornice"], "evidence": ev})
        if e == main and d.get("parapet_h") is not None:
            obs.append({"path": "roof.parapet_h", "value": d["parapet_h"], "evidence": ev})
    for e, r in reads.items():
        if r.get("trim"):
            obs.append({"path": f"walls.{e}.trim_colour", "value": r["trim"],
                        "evidence": {"frames": r["frames"][:8], "how": f"{Q.MODEL} reading", "confidence": 0.5,
                                     "read_by": "kerbfront qwen"}})
    # seating: the records' kinds where the photo agrees, the photo's spans
    seats = []
    for e, r in reads.items():
        for i, (kind, u0, u1) in enumerate(r["seating_q"]):
            if u1 - u0 < 1.0:
                continue
            k = "parklet" if kind == "parklet" else "sidewalk_strip"
            s = {"id": f"qwen-{k}-{e}-{i}", "kind": k, "edge": e, "u0": round(u0, 2), "u1": round(u1, 2)}
            if kind == "cafe_enclosure":
                s["zone"] = "sidewalk"
                s["kind"] = "parklet"
            seats.append(s)
    if seats:
        obs.append({"path": "seating", "value": seats, "evidence": {"frames": sorted({f for r in reads.values() for f in r["frames"]})[:8],
                    "how": f"{Q.MODEL} reading of the registered elevation", "confidence": 0.5, "read_by": "kerbfront qwen"}})
    return base, obs


def _same_name(a: str, b: str) -> bool:
    import re
    from difflib import SequenceMatcher
    n = lambda t: re.sub(r"[^a-z0-9 ]", "", (t or "").lower()).strip()  # noqa: E731
    x, y = n(a), n(b)
    return bool(x and y) and (x in y or y in x or SequenceMatcher(None, x, y).ratio() >= 0.6)


def _since(bid: str, area: str = "marina-union") -> str | None:
    global _SINCE
    if "_SINCE" not in globals():
        _SINCE = {z["id"]: (z["fields"].get("location_start_date") or {}).get("value")
                  for z in json.loads((OUT / area / "businesses.json").read_text())}
    return _SINCE.get(bid)


def _dark(h) -> bool:
    if not _hex(h):
        return True
    r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
    return 0.299 * r + 0.587 * g + 0.114 * b < 140


# ---- one restaurant ----------------------------------------------------------------------

def _oblique(bid: str, photos: list[dict], area: str = "marina-union"):
    """The pixel stage's perspective crop of this front from an angled frame (depth shows), or None."""
    import cv2
    d = OUT / area / "crops" / bid
    order = sorted(photos, key=lambda p: (not str(p.get("slot") or "").startswith("oblique"), p.get("slot") != "elevation"))
    for p in order:
        f = d / f"{p['frame_id']}.jpg"
        if f.exists():
            img = cv2.imread(str(f))
            if img is not None:
                k = min(1.0, 1000 / max(img.shape[:2]))
                return cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else img
    return None


def one(biz: dict, budget: float, deep: bool = False, effort: str | None = None) -> dict:
    from ..model import build, photos_for, write  # noqa: F401
    from ..observe import apply_observations

    try:
        base = build(biz["id"])
    except SystemExit as e:
        return {"skip": f"model: {e}"}
    mid = base["id"]
    base["photos"] = photos_for(base, limit=8)
    if len(base["photos"]) < 2:
        return {"skip": "model: fewer than two frames"}
    reads, spent0 = {}, Q.spent()
    for e in sorted({s["edge"] for s in base["storefronts"]}):
        el = elevations(base, e, {}, log=lambda *a: None)
        if not el.get("used"):
            continue
        fused, seen, labels, g, planes, ref = el["_wall"]
        W = Wall(base, e, fused, seen, labels, g, planes, ref)
        rs, cs = W.rows(0.3, min(base["height_m"], 6.0)), W.cols()
        cover = float(seen[rs, cs].mean()) if seen[rs, cs].size else 0.0
        if cover < 0.4:
            _log(f"  {biz['name']}: wall {e} only {cover:.0%} seen, not sent")
            continue
        if not W.parts():
            _log(f"  {biz['name']}: wall {e} nothing detected, not sent")
            continue
        views, valid = el.get("_views", ([], []))
        frame = ref
        if views:  # the best-lit frame for colours and lettering
            Ls = [float(np.median(v[ok].mean(1))) if ok.any() else 0 for v, ok in zip(views, valid)]
            frame = views[int(np.argmax(Ls))]
        grid = [g.u0, g.u1, g.v0, g.v1, g.px, g.L]
        top = max(base["height_m"], 4.0)
        img1 = Q.grid_image(fused, grid, g.L, top, seen)
        img2 = Q.grid_image(frame.astype(np.float32), grid, g.L, top)
        tenants = [{"name": s.get("name"), "category": s.get("category"), "u0": s["u0"], "u1": s["u1"]}
                   for s in base["storefronts"] if s["edge"] == e]
        text = Q.facts_text(g.L, base["height_m"], tenants, W.parts(), deep=deep)
        (WORK / mid).mkdir(parents=True, exist_ok=True)
        import cv2
        img3 = _oblique(biz["id"], base["photos"]) if deep else None
        stack = [img1, cv2.resize(img2, (img1.shape[1], img2.shape[0]))]
        if img3 is not None:
            stack.append(cv2.resize(img3, (img1.shape[1], int(img3.shape[0] * img1.shape[1] / img3.shape[1]))))
        cv2.imwrite(str(WORK / mid / f"qwen-{'deep' if deep else 'in'}-w{e}.jpg"), np.vstack(stack))
        q = Q.read_wall(img1, img2, text, f"{mid}:w{e}{':deep' if deep else ''}", budget, log=_log,
                        oblique=img3, effort=effort)
        if q is None:
            continue
        reads[e] = findings(q, W, el["frames"], base["height_m"])
        shot = [p.get("captured_at") for p in base["photos"] if p["frame_id"] in set(el["frames"])]
        since = _since(biz["id"])
        reads[e]["pre_tenancy"] = bool(since and shot and all(t and str(t)[:10] < since[:10] for t in shot))
    if not reads:
        return {"skip": "photos: no storefront wall registered well enough to send"}
    base, obs = to_model(base, reads)
    obs_dir, model_dir = (AUTO.with_name("auto-deep"), AUTO_MODELS.with_name("auto-deep")) if deep else (AUTO, AUTO_MODELS)
    obs_dir.mkdir(parents=True, exist_ok=True)
    path = obs_dir / f"{mid}.json"
    how = f"kerbfront qwen ({Q.MODEL}{', deep, reasoning ' + effort if deep and effort else ', deep' if deep else ''})"
    path.write_text(json.dumps({"model": mid, "read_by": how, "observations": obs}, indent=1, default=str))
    apply_observations(base, path)
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / f"{mid}.json").write_text(json.dumps(base, indent=1, default=str))
    return {"model": mid, "walls": sorted(reads), "observations": len(obs), "cost": round(Q.spent() - spent0, 4)}


def run(budget: float = 3.0, limit: int | None = None, area: str = "marina-union",
        shard: tuple[int, int] | None = None, ids: list[str] | None = None,
        deep: bool = False, effort: str | None = None) -> dict:
    """The queue, one business after another. ``shard`` (i, n) takes every n-th business from
    the i-th, so n workers share the queue with no overlap, each with its own state file; the
    spend ledger is shared, so the cap holds across them. A rerun whose inputs are unchanged is
    answered from the cache and costs nothing."""
    todo, reasons = eligible(area)
    if ids:  # a named batch, in the order given; names or ids
        want = [i.lower() for i in ids]
        todo = sorted([b for b in todo if b["id"].lower() in want or (b["name"] or "").lower() in want],
                      key=lambda b: min(want.index(x) for x in (b["id"].lower(), (b["name"] or "").lower()) if x in want))
    if shard is not None:
        todo = todo[shard[0]::shard[1]]
    st = _state(shard) if not (ids or deep) else {"done": {}, "skipped": {}}
    tag = f"[{shard[0]}/{shard[1]}] " if shard else ""
    _log(f"{tag}eligible {len(todo)} restaurant walls; filtered out {reasons}; spent so far ${Q.spent():.3f}, cap ${budget:.2f}")
    n = 0
    for biz in todo:
        if biz["id"] in st["done"] or biz["id"] in st["skipped"]:
            continue
        if limit is not None and n >= limit:
            break
        n += 1
        t0 = time.time()
        try:
            res = one(biz, budget, deep=deep, effort=effort)
        except Q.BudgetSpent as e:
            _log(f"stopped: {e}")
            break
        except Exception as e:  # noqa: BLE001
            res = {"skip": f"error: {type(e).__name__}: {e}"}
            _log(traceback.format_exc(limit=3))
        res["seconds"] = round(time.time() - t0)
        if "skip" in res:
            st["skipped"][biz["id"]] = {"name": biz["name"], **res}
            _log(f"{tag}skip {biz['name']}: {res['skip']}")
        else:
            st["done"][biz["id"]] = {"name": biz["name"], **res}
            _log(f"{tag}done {biz['name']} -> models/auto/{res['model']}.json walls {res['walls']} "
                 f"${res['cost']:.4f} {res['seconds']} s (total ${Q.spent():.3f})")
        if not (ids or deep):
            _save(st, shard)
    return {"done": len(st["done"]), "skipped": len(st["skipped"]), "spent": round(Q.spent(), 4)}
