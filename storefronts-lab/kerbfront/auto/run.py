"""``kerbfront auto <model>``: a building read from the photographs with no reviewer.

1. The pipeline model (``kerbfront.model.build``: LiDAR footprint and height, the app's
   materials, openings, storefront band and street record) and its frames (the stage-1
   photo filter's picks, ``photos_for`` / ``photos_for_wall``).
2. Every wall with a storefront or a street: each frame squared onto the wall with its solved
   camera, labelled by ADE20K in its own geometry, registered to the others and pinned to the
   LiDAR corners and the pavement line (:mod:`.elevation`).
3. The registered wall read into parts (:mod:`.read`) and written as observations,
   ``observations/auto/<id>.json``, in the reviewer's format, each with its frames and method.
4. ``models/auto/<id>.json``: the pipeline model with those observations applied, for the
   studio and for ``kerbfront score``.
"""

from __future__ import annotations

import json
import math
import time

import cv2
import numpy as np

from ..config import LAB, OUT
from . import elevation as E
from . import segment as S
from .read import Wall, hexc, material

AUTO = LAB / "observations" / "auto"
WORK = OUT / "auto"
AUTO_MODELS = LAB / "models" / "auto"
READ_BY = "kerbfront auto (no reviewer)"

GROUND = ("sidewalk", "road", "floor", "earth", "path", "grass", "field", "sand", "rug")
WALLISH = ("wall", "building", "house", "skyscraper", "windowpane", "door", "column", "fence", "signboard",
           "awning", "shop", "booth")


def street_walls(model: dict, min_len: float = 3.0) -> list[int]:
    out = {s["edge"] for s in model.get("storefronts", [])}
    for i, w in enumerate(model["walls"]):
        a, b = model["footprint"][i], model["footprint"][(i + 1) % len(model["footprint"])]
        if w.get("role") in ("street", "recess") and math.dist(a, b) >= min_len:
            out.add(i)
    return sorted(out)


def _cached(model: dict, edge: int, photos: list[dict], offsets: dict) -> dict | None:
    d = WORK / model["id"]
    meta, npz = d / f"w{edge}.json", d / f"w{edge}.npz"
    if not meta.exists() or not npz.exists():
        return None
    rec = json.loads(meta.read_text())
    if rec.get("key") != _key(model, photos, offsets):
        return None
    z = np.load(npz)
    g = E.grid_for(model, edge)
    planes = {k[6:]: z[k] for k in z.files if k.startswith("plane_")}
    return {**rec, "_wall": (z["fused"].astype(np.float32), z["seen"], z["labels"], g, planes, z["ref"]),
            "_views": (list(z["views"]), list(z["vvalid"])) if "views" in z.files else ([], [])}


def _key(model, photos, offsets) -> str:
    import hashlib
    return hashlib.sha1(json.dumps([model["footprint"], model["height_m"], sorted(p["frame_id"] for p in photos),
                                    offsets, E.PX]).encode()).hexdigest()[:16]


def elevations(model: dict, edge: int, offsets: dict[str, float] | None = None, log=print, reuse: bool = True) -> dict:
    """Registered, fused and labelled elevation of one wall (and labels on planes out in the
    street, keyed by name). Kept in out/auto/<id>/ and reused while the frames are the same."""
    offsets = offsets or {}
    photos = [p for p in model["photos"] if p.get("wall", None) in (edge, None)]
    if reuse:
        hit = _cached(model, edge, photos, offsets)
        if hit is not None:
            return hit
    g = E.grid_for(model, edge)
    views = E.collect(model, edge, photos, g, with_labels=True)
    if not views:
        return {"edge": edge, "views": 0}
    ref = E.register(views, g, model["height_m"])
    fused, seen = E.fuse(views, g)

    def relabel():
        return S.vote([v.labels for v in views if v.score > 0 and v.labels is not None])
    labels = relabel()
    M, info = E.anchor(fused, seen, g, labels, S.ids(*GROUND), S.ids(*WALLISH), model["height_m"])
    if not np.allclose(M, [[1, 0, 0], [0, 1, 0]], atol=1e-3):
        E.apply_all(views, g, M)
        fused, seen = E.fuse(views, g)
        labels = relabel()
    planes = {}
    for name, off in (offsets or {}).items():
        planes[name] = S.vote([E.labels_on_plane(v, g, off) for v in views if v.score > 0 and v.meta.get("lab_src")])
    d = WORK / model["id"]
    d.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(d / f"w{edge}.jpg"), np.clip(fused, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    used_v = [v for v in views if v.score > 0]
    np.savez_compressed(d / f"w{edge}.npz", labels=labels, seen=seen, fused=fused.astype(np.uint8),
                        ref=np.clip(ref.img, 0, 255).astype(np.uint8),
                        views=np.stack([np.clip(v.img, 0, 255).astype(np.uint8) for v in used_v]),
                        vvalid=np.stack([v.valid for v in used_v]),
                        grid=np.array([g.u0, g.u1, g.v0, g.v1, g.px, g.L]),
                        **{f"plane_{k}": v for k, v in planes.items()})
    used = [v for v in views if v.score > 0]
    rec = {"edge": edge, "views": len(views), "used": len(used), "frames": [v.photo["frame_id"] for v in used],
           "reference": ref.photo["frame_id"], "anchor": {k: (float(x) if isinstance(x, (np.floating, float)) else x)
                                                          for k, x in info.items()},
           "align": {v.photo["frame_id"]: {"inliers": v.meta.get("inliers"), "score": round(v.score, 3),
                                          "via": v.meta.get("via")} for v in views}}
    rec["key"] = _key(model, photos, offsets)
    (d / f"w{edge}.json").write_text(json.dumps(rec, default=str))
    log(f"  wall {edge}: {rec['used']}/{rec['views']} views, anchor {rec['anchor']}")
    return {**rec, "_wall": (fused, seen, labels, g, planes, np.clip(ref.img, 0, 255)),
            "_views": ([np.clip(v.img, 0, 255).astype(np.uint8) for v in used_v], [v.valid for v in used_v])}


# ---- reading one wall ------------------------------------------------------------------------

def read_wall(model: dict, edge: int, el: dict, street: dict) -> dict:
    fused, seen, labels, g, planes, ref = el["_wall"]
    W = Wall(model, edge, fused, seen, labels, g, planes, ref)
    out: dict = {"edge": edge, "frames": el["frames"]}
    lidar = model["height_m"]
    h, hinfo = W.height(lidar)
    out["height"], out["height_info"] = h, hinfo
    aw = []
    for b in W.detected("awning", 0.25):
        if not 1.8 <= b["v"] + b["h"] <= 5.0 or b["w"] < 0.6:
            continue
        x0, x1 = g.col(max(0.0, b["u"])), g.col(min(W.L, b["u"] + b["w"]))
        y0, y1 = g.row(b["v"] + b["h"]), g.row(b["v"] + b["h"] * 0.4)
        sel = seen[y0:y1, x0:x1]
        bgr = np.median(fused[y0:y1, x0:x1][sel], 0) if sel.any() else None
        aw.append({"u0": round(max(0.0, b["u"]), 2), "u1": round(min(W.L, b["u"] + b["w"]), 2),
                   "v": round(b["v"] + b["h"], 2), "drop": round(min(b["h"], 1.2), 2),
                   "colour": hexc(bgr) if bgr is not None else "#555555"})
    if not aw:
        aw = W.awnings()
    out["awnings"] = aw
    # upper windows first: rows of two or more above 2.6 m. What they are set in is the wall,
    # and the shop band ends just under the lowest sill.
    base_bt = next((s["band_h"] for s in model["storefronts"] if s["edge"] == edge), 3.9)
    wc0 = W.wall_colour(2.8, h - 0.15) or W.wall_colour(0.4, h - 0.2)
    if wc0 is None:
        return out
    wbgr, wlab = wc0
    from collections import Counter

    def upper_rows(lab_ref):
        ws = W.window_boxes(lab_ref, 2.4, h)
        if ws:
            return ws
        ws = [o for o in W.windows(lab_ref, 2.6, h - 0.05) if o["v"] >= 2.6 and o["v"] + o["h"] <= h + 0.1]
        cnt = Counter(o["v"] for o in ws)
        return [o for o in ws if cnt[o["v"]] >= 2]
    wins = upper_rows(wlab)
    if wins:
        rc = W.ring_colour(wins)
        if rc is not None:
            wbgr, wlab = rc
            wins = upper_rows(wlab) or wins
    binfo: dict = {}
    if wins:
        band_top = round(max(2.4, min(o["v"] for o in wins) - 0.3), 2)
        binfo["how"] = "under the lowest upper sill"
    else:
        band_top, binfo = W.band_top(wlab, h, min(base_bt, 3.9))
    bands = W.bands(wlab, 2.2, min(h, 5.2), wins)
    belt = [b for b in bands if abs(b["v"] + b["h"] - band_top) < 0.35]
    if belt:
        band_top = round(belt[0]["v"] + belt[0]["h"], 2)
        binfo["belt"] = True
    out["band_top"], out["band_info"] = band_top, binfo
    upper = h - band_top >= 1.2
    wins = [o for o in wins if o["v"] >= band_top - 0.1]
    pil = W.pilasters(wlab, band_top + 0.2, h + 0.6, wins) if upper else []
    # the wall colour again without windows and pilasters
    ex = np.zeros(g.shape, bool)
    for o in wins:
        ex[g.row(o["v"] + o["h"]):g.row(o["v"]), g.col(o["u"]):g.col(o["u"] + o["w"])] = True
    for p in pil:
        for u in p["u"]:
            ex[g.row(p["v1"]):g.row(p["v0"]), g.col(u - p["w"] / 2):g.col(u + p["w"] / 2)] = True
    if not wins:
        wc = W.wall_colour(band_top + 0.15 if upper else 0.4, h - 0.1, ex)
        if wc is not None:
            wbgr, wlab = wc
    bands = W.bands(wlab, band_top - 0.3, h + 0.7, wins)
    lit = W.lit_colour(wlab, band_top + 0.15 if upper else 0.4, h - 0.1, ex, *el.get("_views", ([], [])))
    out["photo_colour"] = hexc(wbgr)
    if lit is not None:
        wbgr = lit
    out.update({"colour": hexc(wbgr), "windows": wins, "pilasters": pil, "bands": bands})
    # material: the best single frame's upper wall (the median blurs texture)
    rs = W.rows(band_top + 0.2 if upper else 0.5, h - 0.1)
    crop = ref[rs, W.cols()].copy()
    crop[ex[rs, W.cols()]] = np.median(crop.reshape(-1, 3), 0)
    mat, minfo = material(crop) if crop.shape[0] >= 12 else (None, {})
    out["material"], out["material_info"] = mat, minfo
    # shop band
    out["shop"] = W.shop_glazing(wlab, band_top)
    dd = [b for b in W.detected("door", 0.25) if b["v"] <= 0.5 and 1.5 <= b["h"] <= 3.4 and 0.6 <= b["w"] <= 2.4
          and 0 <= b["u"] + b["w"] / 2 <= W.L]
    if dd:
        out["shop"]["doors"] = [{"u": b["u"], "w": b["w"]} for b in sorted(dd, key=lambda b: b["u"])]
    # the shop windows the detector sees join the glazed spans
    low = [b for b in W.detected("window", 0.27) if b["v"] < 1.6 and b["v"] + b["h"] <= band_top + 0.2
           and 0 <= b["u"] + b["w"] / 2 <= W.L and b["h"] >= 0.8]
    for b in low:
        if not any(x["u0"] - 0.1 <= b["u"] and b["u"] + b["w"] <= x["u1"] + 0.1 for x in out["shop"]["glass"]):
            out["shop"]["glass"].append({"u0": max(0.0, b["u"]), "u1": min(W.L, b["u"] + b["w"]), "v": max(0.0, b["v"]),
                                         "top": min(b["v"] + b["h"], band_top - 0.2)})
    signs = []
    for b in W.detected("sign", 0.27):
        if b["v"] + b["h"] / 2 < 1.6 or b["v"] > h + 0.4 or b["w"] > 0.95 * W.L + 1:
            continue
        x0, x1 = g.col(b["u"]), g.col(b["u"] + b["w"])
        y0, y1 = g.row(b["v"] + b["h"]), g.row(b["v"])
        sel = seen[y0:y1, x0:x1]
        bgr = np.median(fused[y0:y1, x0:x1][sel], 0) if sel.any() else None
        signs.append({"kind": "board", "u": b["u"], "v": b["v"], "w": b["w"], "h": b["h"],
                      "bg": hexc(bgr) if bgr is not None else "#333333"})
    for t in W.signs(band_top, h):
        if t["kind"] == "letters" and t["v"] < h + 0.4 and not any(
                abs((t["u"] + t["w"] / 2) - (x["u"] + x["w"] / 2)) < 1.0 and abs(t["v"] - x["v"]) < 0.8 for x in signs):
            signs.append(t)
    out["signs"] = signs
    # street: seating and trees
    sw = (street or {}).get("sidewalk_m") or 3.6
    out["parklet_runs"] = W.street_runs("lane", ("fence", "railing", "chair", "table", "plant", "pot", "flower",
                                                  "tent", "canopy", "awning", "umbrella", "bench", "box", "booth",
                                                  "column", "stool", "wall"), 0.2, 2.3, 0.35, 2.0, 1.5)
    out["lane_cars"] = W.street_runs("lane", ("car", "truck", "van", "bus"), 0.2, 1.6, 0.4, 2.0, 0.6)
    out["walk_runs"] = W.street_runs("walk", ("chair", "table", "umbrella", "bench", "stool"), 0.1, 1.3, 0.2, 1.2, 1.2)
    out["trees"] = W.street_runs("kerb", ("tree", "palm"), 3.0, 6.5, 0.5, 0.8, 0.3)
    out["sidewalk_m"] = sw
    return out


# ---- observations ------------------------------------------------------------------------

def _ev(frames, how, conf):
    return {"frames": list(frames)[:8], "how": how, "confidence": round(conf, 2), "read_by": READ_BY}


def observations(model: dict, reads: dict[int, dict]) -> list[dict]:
    obs: list[dict] = []

    def ob(path, value, frames, how, conf):
        obs.append({"path": path, "value": value, "evidence": _ev(frames, how, conf)})
    good = {e: r for e, r in reads.items() if "colour" in r}
    if not good:
        return obs
    # the wall with the most frames speaks for the building's height and storeys
    main = max(good.values(), key=lambda r: (len(r["frames"]), r["height_info"].get("sky_cols", 0)))
    if main["height_info"].get("how") != "lidar":
        ob("height_m", main["height"], main["frames"], f"facade top from the {main['height_info']['how']} of "
           f"the registered elevation of wall {main['edge']}", 0.7)
    height = main["height"]
    bt = main["band_top"]
    # a storey's row has a few windows in it; a lone dark patch is not a storey
    from collections import Counter
    cnt = Counter((o["v"], o["h"]) for o in main["windows"])
    most = max(cnt.values()) if cnt else 0
    rows = sorted(r for r, n in cnt.items() if n >= max(2, 0.3 * most))
    floors = [{"v": 0.0, "h": bt}]
    rows_up = [r for r in rows if r[0] > bt - 0.1]
    if len(rows_up) >= 2 and rows_up[0][0] < bt + 1.2 and rows_up[0][1] < 1.2:
        # a clerestory just over the shopfront belongs to the ground storey
        floors[0]["h"] = round(rows_up[0][0] + rows_up[0][1] + 0.4, 2)
        rows_up = rows_up[1:]
    seen_rows: list[float] = []
    for v, hh in rows_up:
        if all(abs(v - s) > 1.4 for s in seen_rows):
            seen_rows.append(v)
    top = floors[0]["h"]
    for i, v in enumerate(seen_rows):
        nxt = seen_rows[i + 1] - 0.9 if i + 1 < len(seen_rows) else height
        floors.append({"v": round(top, 2), "h": round(max(1.0, nxt - top), 2)})
        top = round(top + max(1.0, nxt - top), 2)
    if len(floors) == 1 and height - bt > 2.2:
        floors.append({"v": bt, "h": round(height - bt, 2)})
    ob("floors", floors, main["frames"], "storeys from the shop band top and the rows of upper windows", 0.6)
    # walls
    for e, r in good.items():
        fr = r["frames"]
        ob(f"walls.{e}.colour", r["colour"], fr, "median of wall cells above the shop band, windows, "
           "pilasters, sky, trees and cars left out", 0.7)
        if r["material"]:
            ob(f"walls.{e}.material", r["material"], fr, f"CLIP zero-shot on the upper wall ({r['material_info']})", 0.5)
        ops = []
        for o in r["windows"]:
            ops.append({"id": f"w{e}:a{o['u']}", "kind": "window", "u": o["u"], "v": o["v"], "w": o["w"], "h": o["h"],
                        "shape": o["shape"], "frame_colour": o["frame_colour"], "depth": 0.12, "sill": True})
        ob(f"walls.{e}.openings", ops, fr, "dark rectangles above the shop band, snapped to rows", 0.55)
        ob(f"walls.{e}.pilasters", [{**p, "groove_colour": None, "top": "flat"} for p in r["pilasters"]], fr,
           "repeating vertical runs of a second colour", 0.5)
        h = r["height"]
        belts, cornice = [], None
        for b in r["bands"]:
            if b["v"] + b["h"] >= h - 0.25:
                cornice = b
            elif b["v"] > 0.5:
                belts.append({"v": b["v"], "h": max(0.06, b["h"]), "colour": b["colour"], "depth": 0.06})
        ob(f"walls.{e}.belts", belts, fr, "rows of a second colour across the wall", 0.5)
        ob(f"walls.{e}.friezes", [], fr, "friezes are read as belts", 0.5)
        trim = cornice["colour"] if cornice else (belts[0]["colour"] if belts else
                                                  (r["pilasters"][0]["colour"] if r["pilasters"] else None))
        if trim:
            ob(f"walls.{e}.trim_colour", trim, fr, "colour of the cornice / belts / pilasters", 0.5)
        if e == main["edge"]:
            if cornice and cornice["h"] >= 0.06:
                ob("roof.cornice", {"h": cornice["h"], "depth": 0.1, "colour": cornice["colour"], "raise": 0},
                   fr, "band at the facade top", 0.5)
            else:
                ob("roof.cornice", {"h": 0.05, "depth": 0.05, "colour": r["colour"], "raise": 0}, fr,
                   "no band at the facade top", 0.4)
    # storefronts: the pipeline's shop for the business, its span and parts read from the band
    sfs = [json.loads(json.dumps(s)) for s in model["storefronts"]]
    for e, r in good.items():
        L = model["walls"][e]["length_m"]
        glass = r["shop"]["glass"]
        spans = [(x["u0"], x["u1"]) for x in glass] + [(a["u0"], a["u1"]) for a in r["awnings"]]
        spans += [(s["u"], s["u"] + s["w"]) for s in r["signs"] if s["v"] < r["band_top"] + 0.6]
        spans = sorted((max(0.0, a), min(L, b)) for a, b in spans if b > 0 and a < L)
        merged: list[list[float]] = []
        for a, b in spans:
            if merged and a - merged[-1][1] < 1.2:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        merged = [m for m in merged if m[1] - m[0] >= 1.2]
        own = [s for s in sfs if s["edge"] == e]
        for s_ in own:  # the band's height is read off the wall even where its glass is hidden
            s_["band_h"] = r["band_top"]
        if not merged and not own:
            continue
        for k, (a, b) in enumerate(merged):
            mine = next((s for s in own if not (s["u1"] < a or s["u0"] > b)), None)
            if mine is None:
                mine = {"id": f"auto-shop-{e}-{k}", "business_id": None, "name": None, "edge": e, "category": "shop",
                        "brand": None, "material": "stucco", "palette": dict(own[0]["palette"]) if own else {
                            "wall": r["colour"], "accent": "#2b2b2b", "frame": "#1f1f1f", "base": "#7a7a72",
                            "letter": "#f6f1e7", "metal": "#a5aaa7", "glass": "#53646a", "roughness": 0.8},
                        "door_style": None, "signs": [], "extra_signs": [], "awnings": [], "lights": []}
                sfs.append(mine)
                own.append(mine)
            mine.update({"u0": round(a, 2), "u1": round(b, 2), "band_h": r["band_top"]})
            ops = []
            for i, x in enumerate(glass):
                if x["u1"] <= a or x["u0"] >= b:
                    continue
                ops.append({"id": f"{mine['id']}:g{i}", "kind": "window", "u": x["u0"], "v": x["v"],
                            "w": round(x["u1"] - x["u0"], 2), "h": round(max(0.8, x["top"] - x["v"]), 2),
                            "transom_fraction": 0.0, "privacy_fraction": 0})
            for i, d in enumerate(r["shop"]["doors"]):
                if a <= d["u"] + d["w"] / 2 <= b:
                    ops.append({"id": f"{mine['id']}:door{i}", "kind": "door", "u": d["u"], "v": 0, "w": d["w"],
                                "h": 2.3, "leaf_count": 1, "operation": "hinged"})
            mine["openings"] = ops
            mine["awnings"] = [{"id": f"{mine['id']}:awn{i}", "kind": "shed", "u0": x["u0"], "u1": x["u1"],
                                "v": x["v"], "depth_m": 1.0, "drop_m": 0.35, "valance_h": 0.22, "colour": x["colour"],
                                "stripe": None, "valance_text": None, "sides": True, "fabric": True}
                               for i, x in enumerate(r["awnings"]) if a - 0.5 <= (x["u0"] + x["u1"]) / 2 <= b + 0.5]
            mine["extra_signs"] = [{"id": f"{mine['id']}:sign{i}", "kind": s["kind"], "u": s["u"], "v": s["v"],
                                    "w": s["w"], "h": s["h"], "bg": s["bg"], "layers": []}
                                   for i, s in enumerate(r["signs"]) if a - 0.8 <= s["u"] + s["w"] / 2 <= b + 0.8]
            mine["signs"] = []
            mine["evidence"] = {"kind": "observed", "how": "shop band read from the registered elevation: glazed "
                                "spans, door labels, awning and signboard labels", "frames": r["frames"][:6]}
    frames_all = sorted({f for r in good.values() for f in r["frames"]})
    ob("storefronts", sfs, frames_all, "shop spans from glazing, awnings and signs on each wall", 0.55)
    # seating: the record says whether there is any; the photos say where
    seats = []
    licensed = {s["kind"] for s in model.get("seating", [])}
    for e, r in good.items():
        lane = [x for x in r["parklet_runs"] if x[1] - x[0] >= 2.4]
        cars = r["lane_cars"]
        for i, (a, b, f) in enumerate(lane):
            car_cover = sum(max(0, min(b, cb) - max(a, ca)) for ca, cb, _ in cars) / max(0.1, b - a)
            if car_cover > 0.6:
                continue
            if "parklet" not in licensed and f < 0.5:
                continue
            seats.append({"id": f"auto-parklet-{e}-{i}", "kind": "parklet", "edge": e, "u0": a, "u1": b, "depth_m": 2.0,
                          "barrier": "planter_wall", "barrier_h": 1.0, "tables": "four_top", "benches": "none",
                          "roof": "none", "plants": True})
        for i, (a, b, f) in enumerate(r["walk_runs"]):
            if any(not (b < s["u0"] or a > s["u1"]) and s["edge"] == e for s in seats) and b - a < 3:
                continue
            seats.append({"id": f"auto-walk-{e}-{i}", "kind": "sidewalk_strip", "edge": e, "u0": a, "u1": b,
                          "offset_m": 0.15, "depth_m": 0.95, "table": "two_top", "spacing_m": 1.55})
    ob("seating", seats, frames_all, "parklets: seating/fence/plant labels on the parking-lane plane, not cars; "
       "sidewalk tables: chairs/tables on a plane 0.8 m out", 0.5)
    trees = [o for o in model.get("street_objects", []) or [] if o.get("kind") != "tree"]
    for e, r in good.items():
        for i, (a, b, f) in enumerate(r["trees"]):
            trees.append({"id": f"auto-tree-{e}-{i}", "kind": "tree", "edge": e, "u": round((a + b) / 2, 2),
                          "w": round(max(2.0, b - a), 2), "r": round(max(1.2, (b - a) / 2), 2), "trunk_h": 2.6,
                          "colour": "#566f3e"})
    ob("street_objects", trees, frames_all, "tree labels on the kerb plane", 0.5)
    return obs


def auto(model_id: str, photos: list[dict] | None = None, log=print, reuse: bool = True) -> dict:
    from ..model import build, street_for_wall
    from ..observe import apply_observations

    reviewed = json.loads((LAB / "models" / f"{model_id}.json").read_text())
    base = build(reviewed["business_id"])
    base["id"] = model_id
    base["photos"] = [{k: v for k, v in p.items() if k != "align"} for p in (photos or reviewed["photos"])]
    t0 = time.time()
    reads, elev = {}, {}
    for e in street_walls(base):
        try:
            st = street_for_wall(base, e)
        except Exception:  # noqa: BLE001
            st = {}
        sw = st.get("sidewalk_m") or 3.6
        offsets = {"walk": 0.8, "kerb": max(1.0, sw - 0.55), "lane": sw + 1.3}
        el = elevations(base, e, offsets, log=log, reuse=reuse)
        if not el.get("used"):
            continue
        elev[e] = {k: v for k, v in el.items() if not k.startswith("_")}
        reads[e] = read_wall(base, e, el, st)
        reads[e]["street"] = st
    obs = observations(base, reads)
    AUTO.mkdir(parents=True, exist_ok=True)
    path = AUTO / f"{model_id}.json"
    path.write_text(json.dumps({"model": model_id, "read_by": READ_BY, "seconds": round(time.time() - t0),
                                "elevations": elev, "observations": obs}, indent=1, default=str))
    apply_observations(base, path)
    AUTO_MODELS.mkdir(parents=True, exist_ok=True)
    (AUTO_MODELS / f"{model_id}.json").write_text(json.dumps(base, indent=1, default=str))
    keep = {e: {k: v for k, v in r.items() if k not in ("_wall",)} for e, r in reads.items()}
    (WORK / model_id / "reads.json").write_text(json.dumps(keep, indent=1, default=str))
    log(f"{model_id}: {len(obs)} observations in {round(time.time() - t0)} s")
    return {"model": model_id, "observations": len(obs), "walls": list(reads), "path": str(path)}
