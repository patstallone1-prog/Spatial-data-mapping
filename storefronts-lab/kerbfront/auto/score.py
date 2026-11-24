"""``kerbfront score <model>``: how far the automatic reading is from the reviewed one.

Two models of the same building are compared part by part on the walls the reviewer read
(walls with a storefront or with photo-read openings): the reviewed model
(``models/<id>.json``, observations by a person) and the automatic one
(``models/auto/<id>.json``, observations by ``kerbfront auto``). Each check passes or fails
against a tolerance a person would accept looking at the two side by side:

=====================  ==============================================================
height                 |dh| <= 0.35 m
storeys                same count, ground storey top within 0.45 m
wall colour            CIEDE2000 <= 10
wall material          same family (render/stucco, brick, siding, ...)
trim colour            CIEDE2000 <= 15
upper windows          F1 >= 0.75 (IoU >= 0.4 between rectangles)
pilasters / fins       F1 >= 0.75 (centres within 0.35 m)
horizontal bands       F1 >= 0.67 (belts, friezes, cornice: heights within 0.3 m)
storefront band        IoU of the shop spans >= 0.75, band height within 0.45 m
shop glazing           IoU of glazed spans >= 0.6
doors                  F1 >= 0.67 (centres within 0.75 m)
awnings                F1 >= 0.75 (span IoU >= 0.5), colour CIEDE2000 <= 15 when matched
signs                  F1 >= 0.67 (centres within 1.5 m, heights within 1 m)
seating                F1 >= 0.67 (same side, span IoU >= 0.4); kind agrees
trees                  F1 >= 0.67 (same side, within 1.5 m)
=====================  ==============================================================

The score is the share of checks that pass. A second, independent check asks how well each
model draws what the photographs show: both are drawn as elevations of part classes (wall,
glass, door, awning, sign, trim) and compared with the photo's ADE20K labels on the fused,
registered elevation (``out/auto/<id>/w<edge>.npz``). That one needs no reviewer at all.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np

from ..config import LAB, OUT

MODELS = LAB / "models"
AUTO_MODELS = MODELS / "auto"

FAMILY = {"stucco": "render", "stucco_render": "render", "render": "render", "concrete": "render",
          "brick": "brick", "painted_brick": "brick", "wood_siding": "siding", "vinyl_siding": "siding",
          "siding": "siding", "shingle": "siding", "wood": "siding", "stone": "stone",
          "ceramic_tile": "tile", "tile": "tile", "metal_panel": "metal", "metal": "metal",
          "glass": "glass", "glass_curtain_wall": "glass", "canvas": "fabric", "fabric": "fabric"}


# ---- colour ------------------------------------------------------------------------------

def hex_lab(h: str | None) -> np.ndarray | None:
    if not h or not isinstance(h, str) or not h.startswith("#") or len(h) < 7:
        return None
    rgb = np.uint8([[[int(h[5:7], 16), int(h[3:5], 16), int(h[1:3], 16)]]])  # BGR
    lab = cv2.cvtColor(rgb, cv2.COLOR_BGR2LAB).astype(np.float64)[0, 0]
    return np.array([lab[0] * 100 / 255, lab[1] - 128, lab[2] - 128])


def de2000(a: np.ndarray, b: np.ndarray) -> float:
    """CIEDE2000 between two CIELAB colours (L 0-100)."""
    L1, a1, b1 = a
    L2, a2, b2 = b
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dhp = 0.0
    if C1p * C2p:
        dhp = h2p - h1p
        if dhp > 180:
            dhp -= 360
        elif dhp < -180:
            dhp += 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    else:
        hbp = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hbp - 30)) + 0.24 * math.cos(math.radians(2 * hbp))
         + 0.32 * math.cos(math.radians(3 * hbp + 6)) - 0.20 * math.cos(math.radians(4 * hbp - 63)))
    dtheta = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dtheta)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def dE(h1, h2) -> float | None:
    a, b = hex_lab(h1), hex_lab(h2)
    return None if a is None or b is None else round(de2000(a, b), 1)


# ---- matching ----------------------------------------------------------------------------

def iou1(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    uni = max(a[1], b[1]) - min(a[0], b[0])
    return inter / uni if uni > 0 else 0.0


def iou2(a: dict, b: dict) -> float:
    iu = max(0.0, min(a["u"] + a["w"], b["u"] + b["w"]) - max(a["u"], b["u"]))
    iv = max(0.0, min(a["v"] + a["h"], b["v"] + b["h"]) - max(a["v"], b["v"]))
    inter = iu * iv
    return inter / (a["w"] * a["h"] + b["w"] * b["h"] - inter + 1e-9)


def f1(ref: list, got: list, ok) -> tuple[float, list[tuple]]:
    """Greedy one-to-one matching; ``ok(r, g)`` returns a score (> 0 is a match)."""
    pairs = sorted(((ok(r, g), i, j) for i, r in enumerate(ref) for j, g in enumerate(got)), reverse=True)
    ui, uj, m = set(), set(), []
    for s, i, j in pairs:
        if s <= 0 or i in ui or j in uj:
            continue
        ui.add(i)
        uj.add(j)
        m.append((ref[i], got[j]))
    if not ref and not got:
        return 1.0, m
    p = len(m) / len(got) if got else 0.0
    r = len(m) / len(ref) if ref else 0.0
    return (2 * p * r / (p + r) if p + r else 0.0), m


def union_iou(a: list[tuple[float, float]], b: list[tuple[float, float]], L: float, step: float = 0.05) -> float:
    xs = np.arange(0, L, step)

    def cover(iv):
        c = np.zeros(len(xs), bool)
        for u0, u1 in iv:
            c |= (xs >= u0) & (xs < u1)
        return c
    ca, cb = cover(a), cover(b)
    uni = (ca | cb).sum()
    return float((ca & cb).sum() / uni) if uni else 1.0


# ---- parts of a model on one wall ----------------------------------------------------------

def shops(m: dict, e: int) -> list[dict]:
    return [s for s in m.get("storefronts", []) if s.get("edge") == e and s.get("visible") is not False]


def band_top(m: dict, e: int) -> float:
    s = shops(m, e)
    return float(np.median([x["band_h"] for x in s])) if s else (m["floors"][0]["h"] if m.get("floors") else 3.5)


def upper_windows(m: dict, e: int) -> list[dict]:
    bt = band_top(m, e)
    return [o for o in m["walls"][e].get("openings", [])
            if o.get("kind", "window") in ("window", "bay") and o["v"] >= bt - 0.3 and o.get("w", 0) > 0]


def pilaster_us(m: dict, e: int) -> list[float]:
    return [u for p in m["walls"][e].get("pilasters", []) or [] for u in p.get("u", [])]


def hbands(m: dict, e: int) -> list[float]:
    w = m["walls"][e]
    out = [b["v"] + b.get("h", 0) / 2 for b in (w.get("belts") or []) if b.get("v", 0) > 0.5]
    out += [b["v"] + b.get("h", 0) / 2 for b in (w.get("friezes") or [])]
    c = (m.get("roof") or {}).get("cornice")
    if c and c.get("h", 0) >= 0.1:
        out.append(m["height_m"] + c.get("raise", 0))
    return out


def glazing(m: dict, e: int) -> tuple[list[tuple[float, float]], list[float]]:
    glass, doors = [], []
    for s in shops(m, e):
        for o in s.get("openings", []):
            if o.get("kind") == "door":
                doors.append(o["u"] + o["w"] / 2)
                glass.append((o["u"], o["u"] + o["w"]))
            else:
                glass.append((o["u"], o["u"] + o["w"]))
    return glass, doors


def awnings(m: dict, e: int) -> list[dict]:
    return [a for s in shops(m, e) for a in s.get("awnings", []) or []]


def signs(m: dict, e: int) -> list[dict]:
    out = []
    for s in shops(m, e):
        for x in s.get("extra_signs", []) or []:
            if x.get("kind") == "rooftop":
                continue
            u = x["u"] if x.get("kind") == "blade" else x["u"] + x.get("w", 0) / 2
            out.append({"u": u, "v": x.get("v", 3) + x.get("h", 0.5) / 2, "kind": x.get("kind")})
        for x in s.get("signs", []) or []:
            if "u" in x:
                out.append({"u": x["u"] + x.get("w", 0) / 2, "v": x.get("v", 3) + x.get("h", 0.5) / 2, "kind": x.get("kind")})
    return out


def seating(m: dict, e: int) -> list[dict]:
    return [s for s in m.get("seating", []) or [] if s.get("edge") == e]


def trees(m: dict, e: int) -> list[dict]:
    return [o for o in m.get("street_objects", []) or [] if o.get("edge") == e and o.get("kind") == "tree"]


def read_walls(manual: dict) -> list[int]:
    """Walls the reviewer read: a storefront's wall, or photo-read openings with confidence."""
    out = {s["edge"] for s in manual.get("storefronts", []) if s.get("visible") is not False}
    for path, ev in (manual.get("evidence") or {}).items():
        p = path.split(".")
        if p[0] == "walls" and len(p) == 3 and p[2] in ("openings", "pilasters") and ev.get("kind") == "observed" \
                and (ev.get("confidence") or 0) >= 0.5 and manual["walls"][int(p[1])].get("openings"):
            out.add(int(p[1]))
    return sorted(out)


# ---- the score -------------------------------------------------------------------------

def compare(manual: dict, auto: dict) -> dict:
    checks: list[dict] = []

    def check(name, edge, ok, **detail):
        checks.append({"check": name, "edge": edge, "pass": bool(ok), **detail})

    dh = abs(manual["height_m"] - auto["height_m"])
    check("height", None, dh <= 0.35, manual=manual["height_m"], auto=auto["height_m"])
    fm, fa = manual.get("floors") or [], auto.get("floors") or []
    check("storeys", None, len(fm) == len(fa) and (not fm or abs(fm[0]["h"] - fa[0]["h"]) <= 0.45),
          manual=[f["h"] for f in fm], auto=[f["h"] for f in fa])
    for e in read_walls(manual):
        wm, wa = manual["walls"][e], auto["walls"][e]
        d = dE(wm.get("colour"), wa.get("colour"))
        check("wall colour", e, d is not None and d <= 10, manual=wm.get("colour"), auto=wa.get("colour"), dE=d)
        check("material", e, FAMILY.get(wm.get("material"), wm.get("material")) == FAMILY.get(wa.get("material"), wa.get("material")),
              manual=wm.get("material"), auto=wa.get("material"))
        if wm.get("trim_colour") and (manual.get("evidence") or {}).get(f"walls.{e}.trim_colour", {}).get("kind") == "observed":
            d = dE(wm.get("trim_colour"), wa.get("trim_colour"))
            check("trim colour", e, d is not None and d <= 15, manual=wm.get("trim_colour"), auto=wa.get("trim_colour"), dE=d)
        um, ua = upper_windows(manual, e), upper_windows(auto, e)
        s, _ = f1(um, ua, lambda r, g: iou2(r, g) if iou2(r, g) >= 0.4 else 0)
        check("upper windows", e, s >= 0.75, f1=round(s, 2), manual=len(um), auto=len(ua))
        pm, pa = pilaster_us(manual, e), pilaster_us(auto, e)
        if pm or pa:
            s, _ = f1(pm, pa, lambda r, g: 1 - abs(r - g) if abs(r - g) <= 0.35 else 0)
            check("pilasters", e, s >= 0.75, f1=round(s, 2), manual=len(pm), auto=len(pa))
        hm, ha = hbands(manual, e), hbands(auto, e)
        if hm or ha:
            s, _ = f1(hm, ha, lambda r, g: 1 - abs(r - g) if abs(r - g) <= 0.3 else 0)
            check("horizontal bands", e, s >= 0.67, f1=round(s, 2), manual=[round(x, 2) for x in hm], auto=[round(x, 2) for x in ha])
        sm, sa = shops(manual, e), shops(auto, e)
        if sm or sa:
            L = wm.get("length_m") or 30
            iou = union_iou([(s["u0"], s["u1"]) for s in sm], [(s["u0"], s["u1"]) for s in sa], L)
            dbt = abs(band_top(manual, e) - band_top(auto, e))
            check("storefront band", e, iou >= 0.75 and dbt <= 0.45, iou=round(iou, 2), band_top=[band_top(manual, e), band_top(auto, e)])
            gm, dm = glazing(manual, e)
            ga, da = glazing(auto, e)
            iou = union_iou(gm, ga, L)
            check("shop glazing", e, iou >= 0.6, iou=round(iou, 2))
            s, _ = f1(dm, da, lambda r, g: 1 - abs(r - g) / 0.75 if abs(r - g) <= 0.75 else 0)
            check("doors", e, s >= 0.67, f1=round(s, 2), manual=dm, auto=da)
        am, aa = awnings(manual, e), awnings(auto, e)
        if am or aa:
            s, mt = f1(am, aa, lambda r, g: iou1((r["u0"], r["u1"]), (g["u0"], g["u1"])) if iou1((r["u0"], r["u1"]), (g["u0"], g["u1"])) >= 0.5 else 0)
            ds = [dE(r.get("colour"), g.get("colour")) for r, g in mt]
            check("awnings", e, s >= 0.75 and all(d is not None and d <= 15 for d in ds), f1=round(s, 2), dE=ds,
                  manual=len(am), auto=len(aa))
        gm_, ga_ = signs(manual, e), signs(auto, e)
        if gm_ or ga_:
            s, _ = f1(gm_, ga_, lambda r, g: 2 - abs(r["u"] - g["u"]) if abs(r["u"] - g["u"]) <= 1.5 and abs(r["v"] - g["v"]) <= 1.0 else 0)
            check("signs", e, s >= 0.67, f1=round(s, 2), manual=len(gm_), auto=len(ga_))
    for e in sorted({s["edge"] for s in (manual.get("seating") or []) + (auto.get("seating") or [])}):
        sm, sa = seating(manual, e), seating(auto, e)
        s, mt = f1(sm, sa, lambda r, g: iou1((r["u0"], r["u1"]), (g["u0"], g["u1"])) if iou1((r["u0"], r["u1"]), (g["u0"], g["u1"])) >= 0.4 else 0)
        kinds = all(r.get("kind") == g.get("kind") for r, g in mt)
        check("seating", e, s >= 0.67 and kinds, f1=round(s, 2), manual=[(x.get("kind"), x["u0"], x["u1"]) for x in sm],
              auto=[(x.get("kind"), x["u0"], x["u1"]) for x in sa])
    for e in read_walls(manual):
        tm, ta = trees(manual, e), trees(auto, e)
        if tm or ta:
            s, _ = f1(tm, ta, lambda r, g: 2 - abs(r["u"] - g["u"]) if abs(r["u"] - g["u"]) <= 1.5 else 0)
            check("trees", e, s >= 0.67, f1=round(s, 2), manual=[t["u"] for t in tm], auto=[t["u"] for t in ta])
    passed = sum(c["pass"] for c in checks)
    return {"model": manual["id"], "agreement": round(passed / max(1, len(checks)), 3),
            "passed": passed, "checks": len(checks), "detail": checks}


# ---- photo agreement: each model drawn as part classes against the photo's labels ----------

PART = {"wall": 1, "glass": 2, "door": 3, "awning": 4, "sign": 5}
PHOTO_PART = {"wall": "wall", "building": "wall", "house": "wall", "column": "wall",
              "windowpane": "glass", "door": "door", "screen door": "door", "awning": "awning",
              "signboard": "sign", "canopy": "awning"}


def draw_parts(m: dict, e: int, grid) -> np.ndarray:
    """The model's wall ``e`` as a class map on the elevation grid (u0, u1, v0, v1, px, L)."""
    u0, u1, v0, v1, px, L = grid
    H, W = int(round((v1 - v0) * px)), int(round((u1 - u0) * px))
    img = np.zeros((H, W), np.uint8)

    def rect(ua, ub, va, vb, k):
        c0, c1 = int(round((ua - u0) * px)), int(round((ub - u0) * px))
        r0, r1 = int(round((v1 - vb) * px)), int(round((v1 - va) * px))
        img[max(0, r0):max(0, r1), max(0, c0):max(0, c1)] = k
    top = m["height_m"] + ((m.get("roof") or {}).get("parapet_h") or 0) * 0
    rect(0, L, 0, top, PART["wall"])
    for o in m["walls"][e].get("openings", []) or []:
        rect(o["u"], o["u"] + o["w"], o["v"], o["v"] + o["h"], PART["glass"] if o.get("kind") != "door" else PART["door"])
    for s in shops(m, e):
        for o in s.get("openings", []) or []:
            rect(o["u"], o["u"] + o["w"], o["v"], o["v"] + o["h"], PART["door"] if o.get("kind") == "door" else PART["glass"])
        for x in s.get("extra_signs", []) or []:
            if x.get("kind") in ("rooftop",):
                continue
            ua = x["u"] - x.get("w", 0.5) / 2 if x.get("kind") == "blade" else x["u"]
            ub = ua + (0.25 if x.get("kind") == "blade" else x.get("w", 0.5))
            rect(ua, ub, x.get("v", 3), x.get("v", 3) + x.get("h", 0.5), PART["sign"])
        for a in s.get("awnings", []) or []:
            v = a.get("v", s["band_h"] - 0.3)
            rect(a["u0"], a["u1"], v - a.get("drop_m", 0.3) - 0.35 * a.get("depth_m", 0.9), v, PART["awning"])
    return img


def photo_parts(labels: np.ndarray) -> np.ndarray:
    from .segment import names
    nm = names()
    n = max(nm.values()) + 2
    lut = np.zeros(n, np.uint8)
    for name, i in nm.items():
        k = PHOTO_PART.get(name)
        if k:
            lut[i] = PART[k]
    return lut[np.where(labels >= 0, labels, n - 1)]


def photo_agreement(m: dict, e: int, npz: Path) -> dict | None:
    if not npz.exists():
        return None
    z = np.load(npz)
    grid = [float(x) for x in z["grid"]]
    lab = photo_parts(z["labels"])
    mine = draw_parts(m, e, grid)
    H = min(lab.shape[0], mine.shape[0])
    W = min(lab.shape[1], mine.shape[1])
    lab, mine = lab[:H, :W], mine[:H, :W]
    known = lab > 0  # trees, cars, people, sky: not judged
    out = {}
    for k, i in PART.items():
        a, b = (lab == i) & known, (mine == i) & known
        uni = (a | b).sum()
        if a.sum() > 0.002 * known.sum():
            out[k] = round(float((a & b).sum() / uni), 3) if uni else None
    vals = [v for v in out.values() if v is not None]
    out["mIoU"] = round(float(np.mean(vals)), 3) if vals else None
    out["pixel_acc"] = round(float((lab[known] == mine[known]).mean()), 3) if known.any() else None
    return out


def score(mid: str) -> dict:
    manual = json.loads((MODELS / f"{mid}.json").read_text())
    auto = json.loads((AUTO_MODELS / f"{mid}.json").read_text())
    res = compare(manual, auto)
    photo = {}
    for e in read_walls(manual):
        npz = OUT / "auto" / mid / f"w{e}.npz"
        pm, pa = photo_agreement(manual, e, npz), photo_agreement(auto, e, npz)
        if pm or pa:
            photo[e] = {"reviewed": pm, "auto": pa}
    res["photo"] = photo
    return res
