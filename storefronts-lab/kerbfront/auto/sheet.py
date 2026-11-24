"""A check sheet per wall: the registered photo elevation twice, with the reviewed model's parts
drawn over the top copy and the automatic model's over the bottom one (``out/auto/<id>/
sheet-w<edge>.jpg``; CC BY-SA pixels, not committed)."""

from __future__ import annotations

import json

import cv2
import numpy as np

from ..config import LAB, OUT
from .score import shops

COL = {"window": (255, 200, 0), "glass": (255, 255, 0), "door": (0, 160, 255), "awning": (0, 0, 255),
       "sign": (255, 0, 255), "pilaster": (0, 255, 0), "band": (0, 255, 255), "seat": (40, 120, 255),
       "tree": (0, 200, 60), "top": (255, 255, 255)}


def draw(img: np.ndarray, m: dict, e: int, grid, label: str) -> np.ndarray:
    u0, u1, v0, v1, px, L = grid
    out = img.copy()

    def P(u, v):
        return int(round((u - u0) * px)), int(round((v1 - v) * px))

    def box(ua, va, ub, vb, c, t=1):
        cv2.rectangle(out, P(ua, vb), P(ub, va), c, t)
    cv2.line(out, P(0, m["height_m"]), P(L, m["height_m"]), COL["top"], 1)
    w = m["walls"][e]
    for o in w.get("openings", []) or []:
        box(o["u"], o["v"], o["u"] + o["w"], o["v"] + o["h"], COL["window"])
    for p in w.get("pilasters", []) or []:
        for u in p["u"]:
            box(u - p["w"] / 2, p["v0"], u + p["w"] / 2, p["v1"], COL["pilaster"])
    for b in (w.get("belts") or []) + (w.get("friezes") or []):
        box(0, b["v"], L, b["v"] + b.get("h", 0.1), COL["band"])
    for s in shops(m, e):
        box(s["u0"], 0.02, s["u1"], s["band_h"], (200, 200, 200), 1)
        for o in s.get("openings", []) or []:
            box(o["u"], o["v"], o["u"] + o["w"], o["v"] + o["h"], COL["door" if o.get("kind") == "door" else "glass"])
        for a in s.get("awnings", []) or []:
            v = a.get("v", s["band_h"] - 0.3)
            box(a["u0"], v - a.get("drop_m", 0.3), a["u1"], v, COL["awning"], 2)
        for x in s.get("extra_signs", []) or []:
            if x.get("kind") == "rooftop":
                continue
            ua = x["u"] - 0.12 if x.get("kind") == "blade" else x["u"]
            box(ua, x.get("v", 3), ua + (0.25 if x.get("kind") == "blade" else x.get("w", 0.5)), x.get("v", 3) + x.get("h", 0.5),
                COL["sign"], 2)
    for s in m.get("seating", []) or []:
        if s.get("edge") == e:
            box(s["u0"], -0.9, s["u1"], -0.6, COL["seat"], -1)
    for t in m.get("street_objects", []) or []:
        if t.get("edge") == e and t.get("kind") == "tree":
            cv2.circle(out, P(t["u"], -0.75), 6, COL["tree"], -1)
    cv2.putText(out, label, (6, 18), 0, 0.55, (0, 0, 0), 3)
    cv2.putText(out, label, (6, 18), 0, 0.55, (255, 255, 255), 1)
    return out


def sheet(mid: str, e: int) -> str | None:
    npz = OUT / "auto" / mid / f"w{e}.npz"
    if not npz.exists():
        return None
    z = np.load(npz)
    grid = [float(x) for x in z["grid"]]
    img = z["fused"]
    manual = json.loads((LAB / "models" / f"{mid}.json").read_text())
    auto = json.loads((LAB / "models" / "auto" / f"{mid}.json").read_text())
    s = np.vstack([draw(img, manual, e, grid, f"{mid} wall {e}: reviewed"),
                   draw(img, auto, e, grid, f"{mid} wall {e}: automatic")])
    dest = OUT / "auto" / mid / f"sheet-w{e}.jpg"
    cv2.imwrite(str(dest), s, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return str(dest)
