"""What the aerial photograph says about what the page has only inferred.

The page draws some things it has no survey of: a transit-red box in the road at every bus zone,
words on the road at a stop, paving where nothing says what the ground is, a gutter pieced
together drain by drain. This reads the sharpest public aerial photograph of the same ground
(``smc.imagery.ortho``: NOAA's 0.25 m mosaic over San Francisco) and says, thing by thing, what
is there:

* **bus zones** -- red paint in the kerb lane, a pale concrete bus pad, or bare asphalt;
* **road legends** -- white paint where the word is laid, or none;
* **inferred ground** -- each patch as grass, asphalt or concrete by what most of it looks
  like; a narrow strip or a small patch is left as inferred (its shape says what it is);
* **courts** -- rectangles of white line on a large paved patch (a school yard): a court where
  the map has none, a basketball court where its circles show;
* **gutters** -- the pieces along one kerb as one straight strip of their middle width, checked
  against the pale line of the gutter pan in the photograph.

What a quarter of a metre a pixel cannot do: read letters, see a chain-link fence or a hoop.
Those are told by what is round them (a white rectangle of the right size is a court), or not at
all. A thing under a tree or a parked bus is **unseen**, and what the page has is kept: the
photograph only ever takes away what it can see is not there.

Every result is appended to a journal as it is made (``Journal``: one JSON line, flushed and
synced), so a run stopped at any moment goes on from where it was.
"""

from __future__ import annotations

import json
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

#: The photograph's ground sample (m) and the margin read round a thing.
PIXEL_M = 0.25
MARGIN_M = 6.0

#: Verdicts.
PRESENT, ABSENT, UNSEEN = "present", "absent", "unseen"

THRESHOLDS = {
    # Of a thing's pixels, the share that must be open to the sky to judge it at all.
    "visible_min": 0.45,
    # Red paint: of the visible pixels. Transit red covers the lane; a red car covers a little.
    "red_present": 0.35, "red_absent": 0.2,
    # A concrete bus pad: paler than the lane beside it by this much (0..255), and not coloured.
    "pad_lift": 22.0,
    # White paint in a legend's box: a word's strokes cover a tenth of it or more.
    "white_present": 0.05, "white_absent": 0.012,
    # Inferred ground: the share one kind must have to be called.
    "ground_call": 0.55,
    # A patch narrower than this (2 x area / perimeter), or smaller, is told by its shape alone.
    "ground_narrow_m": 3.0, "ground_small_m2": 80.0,
    # Courts: sides (m), how much of the rectangle's outline must be painted, how square it is.
    "court_long_m": (14.0, 34.0), "court_short_m": (8.0, 19.0), "court_outline": 0.6, "court_inner": 0.012, "court_on_roof": 0.15, "court_bright": 170.0,
    # Gutters: pieces on one line -- this near across it, this far apart along it.
    "gutter_across_m": 0.9, "gutter_gap_m": 14.0, "gutter_min_m": 6.0,
}


# ---- the frame: the page's metres to the photograph's -------------------------------------------

@dataclass(frozen=True)
class Frame:
    """The page's (x, z) metres as longitude and latitude: fitted to the buildings the page
    gives both for (an affine fit; the page's frame is one, to a centimetre)."""

    lon: tuple[float, float, float]
    lat: tuple[float, float, float]
    residual_m: float

    @classmethod
    def fit(cls, pairs) -> Frame:
        f = np.asarray(pairs, float)
        a = np.c_[f[:, 0], f[:, 1], np.ones(len(f))]
        lon = np.linalg.lstsq(a, f[:, 2], rcond=None)[0]
        lat = np.linalg.lstsq(a, f[:, 3], rcond=None)[0]
        res = np.hypot((a @ lon - f[:, 2]) * 88_000, (a @ lat - f[:, 3]) * 111_000)
        return cls(tuple(lon), tuple(lat), float(res.max()))

    def lonlat(self, x, z):
        x, z = np.asarray(x, float), np.asarray(z, float)
        return (self.lon[0] * x + self.lon[1] * z + self.lon[2], self.lat[0] * x + self.lat[1] * z + self.lat[2])

    def utm(self, x, z):
        from smc.imagery.ortho import to_utm

        e, n = to_utm(*self.lonlat(x, z))
        return np.asarray(e, float), np.asarray(n, float)

    def from_lonlat(self, lon, lat):
        """Longitude and latitude as the page's metres (the fit, turned round)."""
        m = np.array([[self.lon[0], self.lon[1]], [self.lat[0], self.lat[1]]], float)
        d = np.linalg.solve(m, np.vstack([np.ravel(np.asarray(lon, float) - self.lon[2]), np.ravel(np.asarray(lat, float) - self.lat[2])]))
        return d[0], d[1]

    def page(self, e, n, around):
        """UTM back to the page's metres, near ``around`` ((x, z)): solved on a local grid (the
        fit one way is all the page gives)."""
        x0, z0 = around
        one = lambda x, z: tuple(float(np.ravel(v)[0]) for v in self.utm(x, z))  # noqa: E731
        e0, n0 = one(x0, z0)
        ex, nx = one(x0 + 100, z0)
        ez, nz = one(x0, z0 + 100)
        m = np.array([[(ex - e0) / 100, (ez - e0) / 100], [(nx - n0) / 100, (nz - n0) / 100]], float)
        d = np.linalg.solve(m, np.vstack([np.ravel(np.asarray(e, float) - e0), np.ravel(np.asarray(n, float) - n0)]))
        return x0 + d[0], z0 + d[1]


# ---- the journal: nothing done is done twice, nothing done is lost -----------------------------

class Journal:
    """Results kept as they come: a line of JSON each, written through to the disk before the
    next is begun. Opened again, it knows what is done."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.rows: dict[str, dict] = {}
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue   # a line cut short by a stop: done again
                self.rows[row["key"]] = row
        self._file = self.path.open("a")

    def done(self, key: str) -> bool:
        return key in self.rows

    def put(self, key: str, row: dict) -> dict:
        row = {"key": key, **row}
        self._file.write(json.dumps(row, separators=(",", ":")) + "\n")
        self._file.flush()
        os.fsync(self._file.fileno())
        self.rows[key] = row
        return row

    def of(self, task: str) -> list[dict]:
        return [r for r in self.rows.values() if r.get("task") == task]

    def close(self) -> None:
        self._file.close()


# ---- pixels ---------------------------------------------------------------------------------------

def classes(rgb: np.ndarray, nir: np.ndarray | None) -> dict[str, np.ndarray]:
    """What each pixel is, as far as colour says. ``rgb`` (3, h, w) uint8; ``nir`` (h, w) or None.

    The mosaic has a blue cast and deep blue shadows: shade is told by blue over red, not by
    darkness alone; plants by the near-infrared (bright there, dark in red)."""
    r, g, b = (rgb[i].astype(np.float32) for i in range(3))
    value = np.maximum(np.maximum(r, g), b)
    low = np.minimum(np.minimum(r, g), b)
    shade = (value < 95) & (b > r + 12)
    if nir is not None:
        n = nir.astype(np.float32)
        plant = (n >= 45) & ((n - r) / np.maximum(1.0, n + r) > 0.12)
    else:
        plant = (g > r + 8) & (g > b + 8)
    red = (r > 80) & (r > g * 1.3) & (r > b * 1.18) & ~plant
    yellow = (r > 150) & (g > 125) & (b < g - 35) & ~plant
    neutral = (value - low) < 0.22 * np.maximum(value, 1.0) + 14
    white = (low > 185) & neutral
    return {"shade": shade, "plant": plant, "red": red, "yellow": yellow, "white": white, "neutral": neutral,
            "value": value}


def paint_lines(value: np.ndarray, plant: np.ndarray) -> np.ndarray:
    """Thin pale marks on darker ground (painted lines), in sun or in shade: what stands out
    from a few metres round it and is narrow (a top-hat, then nothing wider than a line)."""
    import cv2

    v = value.astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    hat = cv2.morphologyEx(v, cv2.MORPH_TOPHAT, kernel)
    mask = (hat > 20) & ~plant
    return mask


class Photo:
    """The photograph over a box of the page's ground, with each pixel's place in the page's
    metres to hand."""

    def __init__(self, ortho, frame: Frame, xs, zs, margin: float = MARGIN_M):
        e, n = frame.utm(xs, zs)
        self.bounds = (float(e.min() - margin), float(n.min() - margin), float(e.max() + margin), float(n.max() + margin))
        data = ortho.read(self.bounds, PIXEL_M)
        self.ok = data is not None and bool(data["valid"].mean() > 0.98)
        self.frame = frame
        if not self.ok:
            return
        self.rgb, self.nir = data["rgb"], data["nir"]
        self.shape = self.rgb.shape[1:]
        self.cls = classes(self.rgb, self.nir)

    def pixels(self, xs, zs) -> np.ndarray:
        """(n, 2) float pixel coordinates (col, row) of page points."""
        e, n = self.frame.utm(xs, zs)
        return np.c_[(e - self.bounds[0]) / PIXEL_M, (self.bounds[3] - n) / PIXEL_M]

    def mask(self, polygon_xz) -> np.ndarray:
        import cv2

        p = np.asarray(polygon_xz, float)
        m = np.zeros(self.shape, np.uint8)
        cv2.fillPoly(m, [np.round(self.pixels(p[:, 0], p[:, 1])).astype(np.int32)], 1)
        return m.astype(bool)


# ---- shapes ---------------------------------------------------------------------------------------

def pieces(tri: list[float], snap: float = 0.1) -> list[np.ndarray]:
    """A soup of triangles ([x, z] x 3 each, flat) as its connected pieces: (n, 2) points each."""
    pts = np.asarray(tri, float).reshape(-1, 3, 2)
    parent: dict = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    keys = [[(round(v[0] / snap), round(v[1] / snap)) for v in t] for t in pts]
    for k in keys:
        root = find(k[0])
        for v in k[1:]:
            parent[find(v)] = root
    groups: dict = {}
    for t, k in zip(pts, keys, strict=True):
        groups.setdefault(find(k[0]), []).append(t)
    return [np.concatenate(g) for g in groups.values()]


def rectangle(points: np.ndarray) -> dict:
    """The smallest rectangle round points: centre, the unit way along its long side, half
    lengths, and its corners."""
    import cv2

    (cx, cz), (w, h), angle = cv2.minAreaRect(points.astype(np.float32))
    a = math.radians(angle)
    ux, uz = math.cos(a), math.sin(a)
    if h > w:
        w, h, ux, uz = h, w, -uz, ux
    corners = [[cx + sx * ux * w / 2 - sz * uz * h / 2, cz + sx * uz * w / 2 + sz * ux * h / 2]
               for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return {"x": float(cx), "z": float(cz), "ux": ux, "uz": uz, "along": w / 2, "across": h / 2, "corners": corners}


def key_of(task: str, x: float, z: float) -> str:
    return f"{task}:{round(x * 2) / 2:.1f}:{round(z * 2) / 2:.1f}"


# ---- the tasks --------------------------------------------------------------------------------------

def judge_bus_zone(photo: Photo, rect: dict, T=THRESHOLDS) -> dict:
    """A bus zone's rectangle of kerb lane: red paint, a concrete pad, or bare road."""
    inside = photo.mask(rect["corners"])
    c = photo.cls
    seen = inside & ~c["plant"]
    visible = float(seen.sum()) / max(1, int(inside.sum()))
    if visible < T["visible_min"]:
        return {"verdict": UNSEEN, "visible": round(visible, 3)}
    red = float((seen & c["red"]).sum()) / max(1, int(seen.sum()))
    # The lane beside it, the same length: what the road looks like here without a zone.
    px, pz = -rect["uz"], rect["ux"]
    best_lift = 0.0
    for side in (1, -1):
        shift = side * rect["across"] * 2.4
        beside = photo.mask([[x + px * shift, z + pz * shift] for x, z in rect["corners"]]) & ~c["plant"]
        if beside.sum() < 40:
            continue
        # Like with like: the sunlit of one against the sunlit of the other.
        for light in (~c["shade"], c["shade"]):
            a, b = seen & light & c["neutral"], beside & light & c["neutral"]
            if a.sum() > 60 and b.sum() > 60:
                lift = float(np.median(c["value"][a]) - np.median(c["value"][b]))
                # (The road is on one side and the pavement, paler than any pad, on the other:
                # the road is the darker.)
                best_lift = max(best_lift, lift) if best_lift else lift
                break
    if red >= T["red_present"]:
        verdict = "red"
    elif red <= T["red_absent"]:
        verdict = "pad" if best_lift >= T["pad_lift"] else ABSENT
    else:
        verdict = UNSEEN
    return {"verdict": verdict, "visible": round(visible, 3), "red": round(red, 3), "lift": round(best_lift, 1)}


def judge_legend(photo: Photo, rect: dict, T=THRESHOLDS) -> dict:
    """A word on the road: white paint in its box, or none."""
    inside = photo.mask(rect["corners"])
    c = photo.cls
    seen = inside & ~c["plant"]
    visible = float(seen.sum()) / max(1, int(inside.sum()))
    if visible < T["visible_min"]:
        return {"verdict": UNSEEN, "visible": round(visible, 3)}
    lines = paint_lines(c["value"], c["plant"])
    share = float((seen & (lines | c["white"])).sum()) / max(1, int(seen.sum()))
    # (A car parked over it is pale too: mostly one solid pale thing is a car, not a word.)
    solid = float((seen & c["white"]).sum()) / max(1, int(seen.sum()))
    if solid > 0.35:
        return {"verdict": UNSEEN, "visible": round(visible, 3), "white": round(share, 3), "solid": round(solid, 3)}
    verdict = PRESENT if share >= T["white_present"] else ABSENT if share <= T["white_absent"] else UNSEEN
    return {"verdict": verdict, "visible": round(visible, 3), "white": round(share, 3)}


def judge_ground(photo: Photo, mask: np.ndarray, area_m2: float, width_m: float, T=THRESHOLDS) -> dict:
    """A patch of inferred ground: what most of it is."""
    if area_m2 < T["ground_small_m2"] or width_m < T["ground_narrow_m"]:
        return {"verdict": "by_shape", "area": round(area_m2, 1), "width": round(width_m, 2)}
    c = photo.cls
    seen = mask & ~c["shade"]
    visible = float(seen.sum()) / max(1, int(mask.sum()))
    if visible < 0.3:
        return {"verdict": UNSEEN, "visible": round(visible, 3), "area": round(area_m2, 1)}
    n = max(1, int(seen.sum()))
    grass = float((seen & c["plant"]).sum()) / n
    hard = seen & ~c["plant"] & c["neutral"]
    concrete = float((hard & (c["value"] >= 150)).sum()) / n
    asphalt = float((hard & (c["value"] < 150)).sum()) / n
    shares = {"grass": grass, "concrete": concrete, "asphalt": asphalt}
    kind = max(shares, key=shares.get)
    verdict = kind if shares[kind] >= T["ground_call"] else "mixed"
    return {"verdict": verdict, "visible": round(visible, 3), "area": round(area_m2, 1), "width": round(width_m, 2),
            **{k: round(v, 3) for k, v in shares.items()}}


def find_courts(photo: Photo, mask: np.ndarray, T=THRESHOLDS) -> list[dict]:
    """Rectangles of painted line inside ``mask`` (a large paved patch): [{corners (pixels),
    long_m, short_m, outline, circles}]."""
    import cv2

    c = photo.cls
    lines = (paint_lines(c["value"], c["plant"]) & mask).astype(np.uint8)
    # A court's lines all join (its outline, its middle line, its keys): one connected piece of
    # line-work a court, once breaks of a pixel or two are closed. A running track or a lane
    # line is a piece too, and is told apart by its size and by its outline not being a rectangle.
    closed = cv2.morphologyEx(lines, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    found = []
    low = T["court_short_m"][0] / PIXEL_M * 0.8
    for i in range(1, count):
        w0, h0 = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        if max(w0, h0) < low or stats[i, cv2.CC_STAT_AREA] < 40:
            continue
        ys, xs = np.nonzero(labels == i)
        (cx, cy), (w, h), angle = cv2.minAreaRect(np.c_[xs, ys].astype(np.float32))
        long_m, short_m = max(w, h) * PIXEL_M, min(w, h) * PIXEL_M
        if not (T["court_long_m"][0] * 0.45 <= long_m <= T["court_long_m"][1] and T["court_short_m"][0] * 0.8 <= short_m <= T["court_short_m"][1]):
            continue
        box = cv2.boxPoints(((cx, cy), (w, h), angle))
        # How much of the rectangle's edge is this piece's own paint.
        edge = np.zeros_like(lines)
        cv2.polylines(edge, [np.round(box).astype(np.int32)], True, 1, 5)
        outline = float((edge.astype(bool) & (labels == i)).sum()) / max(1.0, 2 * (w + h))
        if outline < T["court_outline"]:
            continue
        found.append({"box": box, "long_m": long_m, "short_m": short_m, "outline": min(1.0, outline), "cx": cx, "cy": cy, "angle": angle})
    # A court is drawn in halves and keys: the pieces that share an edge and a heading are one.
    courts = [k for k in _merge_boxes(found, T) if _inner_ink(closed, k["box"]) >= T["court_inner"]]
    for court in courts:
        court["inner"] = round(_inner_ink(closed, court["box"]), 4)
        x0, y0 = np.floor(court["box"].min(axis=0)).astype(int)
        x1, y1 = np.ceil(court["box"].max(axis=0)).astype(int)
        crop = (c["value"][max(0, y0):y1, max(0, x0):x1]).astype(np.uint8)
        circles = None
        if crop.size and min(crop.shape) > 16:
            circles = cv2.HoughCircles(cv2.GaussianBlur(crop, (5, 5), 1.2), cv2.HOUGH_GRADIENT, dp=1, minDist=12,
                                       param1=60, param2=16, minRadius=5, maxRadius=10)
        court["circles"] = 0 if circles is None else int(circles.shape[1])
    return courts


def _merge_boxes(found: list[dict], T) -> list[dict]:
    import cv2

    used, out = set(), []
    for i, a in enumerate(found):
        if i in used:
            continue
        group = [a]
        used.add(i)
        grew = True
        while grew:
            grew = False
            pts = np.vstack([g["box"] for g in group])
            for j, b in enumerate(found):
                if j in used:
                    continue
                gap = np.min(np.linalg.norm(pts[:, None, :] - b["box"][None, :, :], axis=2))
                turn = abs(((a["angle"] - b["angle"] + 45) % 90) - 45)
                if gap < 5 and turn < 6:
                    group.append(b)
                    used.add(j)
                    grew = True
        box = cv2.boxPoints(cv2.minAreaRect(np.vstack([g["box"] for g in group]).astype(np.float32)))
        sides = sorted([float(np.linalg.norm(box[0] - box[1])), float(np.linalg.norm(box[1] - box[2]))])
        short_m, long_m = sides[0] * PIXEL_M, sides[1] * PIXEL_M
        if not (T["court_long_m"][0] <= long_m <= T["court_long_m"][1] and T["court_short_m"][0] <= short_m <= T["court_short_m"][1]):
            continue
        out.append({"box": box, "long_m": long_m, "short_m": short_m, "parts": len(group),
                    "outline": float(np.mean([g["outline"] for g in group]))})
    return out


def _inner_ink(lines: np.ndarray, box: np.ndarray) -> float:
    """The share of a rectangle's inside (a metre and a half in from its edge) that is painted
    line: a court has a middle line and keys; a roof's edge or a parking bay has nothing."""
    import cv2

    centre = box.mean(axis=0)
    sides = [np.linalg.norm(box[0] - box[1]), np.linalg.norm(box[1] - box[2])]
    shrink = max(0.2, 1 - 2 * (1.5 / PIXEL_M) / max(1.0, min(sides)))
    inner = np.zeros(lines.shape, np.uint8)
    cv2.fillPoly(inner, [np.round(centre + (box - centre) * shrink).astype(np.int32)], 1)
    return float((inner.astype(bool) & lines.astype(bool)).sum()) / max(1, int(inner.sum()))


def court_kind(long_m: float, short_m: float, circles: int, parts: int) -> str:
    """What a painted rectangle is, by its size and what is drawn in it."""
    ratio = long_m / max(short_m, 0.1)
    # A tennis court is long for its width (23.8 x 11 m: 2.2 to 1); a basketball court is not
    # (28 x 15, and a school's are shorter still), and shows its circles where they can be seen.
    if 21 <= long_m <= 26 and 9.5 <= short_m <= 13 and ratio >= 1.85 and circles == 0:
        return "tennis"
    if 17 <= long_m <= 32 and 10 <= short_m <= 19 and (circles >= 1 or ratio < 1.8):
        return "basketball"
    if 15 <= long_m <= 21 and 8 <= short_m <= 10.5:
        return "volleyball"
    return "court"


def straighten_gutters(strips: list[np.ndarray], T=THRESHOLDS) -> list[dict]:
    """Gutter pieces as straight strips: those on one line (near across it, not far apart along
    it) become one, of their middle width, on their middle line."""
    rects = [rectangle(s) for s in strips if len(s) >= 3]
    rects = [r for r in rects if r["along"] * 2 > 0.4]
    order = sorted(range(len(rects)), key=lambda i: -rects[i]["along"])
    used, lines = set(), []
    for i in order:
        if i in used:
            continue
        a = rects[i]
        ux, uz = a["ux"], a["uz"]
        members = [a]
        used.add(i)
        grew = True
        lo, hi = -a["along"], a["along"]
        while grew:
            grew = False
            for j in order:
                if j in used:
                    continue
                b = rects[j]
                if abs(ux * b["ux"] + uz * b["uz"]) < 0.985:
                    continue
                dx, dz = b["x"] - a["x"], b["z"] - a["z"]
                across, along = dx * -uz + dz * ux, dx * ux + dz * uz
                if abs(across) > T["gutter_across_m"]:
                    continue
                if along - b["along"] > hi + T["gutter_gap_m"] or along + b["along"] < lo - T["gutter_gap_m"]:
                    continue
                members.append(b)
                used.add(j)
                lo, hi = min(lo, along - b["along"]), max(hi, along + b["along"])
                grew = True
        if hi - lo < T["gutter_min_m"]:
            continue
        offs = [((m["x"] - a["x"]) * -uz + (m["z"] - a["z"]) * ux) for m in members]
        weights = [m["along"] for m in members]
        off = float(np.average(offs, weights=weights))
        width = float(np.median([m["across"] * 2 for m in members]))
        x0, z0 = a["x"] + ux * lo - uz * off, a["z"] + uz * lo + ux * off
        x1, z1 = a["x"] + ux * hi - uz * off, a["z"] + uz * hi + ux * off
        covered = sum(m["along"] * 2 for m in members)
        lines.append({"x0": x0, "z0": z0, "x1": x1, "z1": z1, "width": width, "pieces": len(members),
                      "length": hi - lo, "covered": min(1.0, covered / (hi - lo)),
                      "wobble": float(np.max(np.abs(np.asarray(offs) - off)))})
    return lines


def check_gutter(photo: Photo, line: dict) -> dict:
    """The straight strip against the photograph: the gutter pan is a pale line beside the darker
    road. How much paler the strip is than the road just outside it, and how much of it shows."""
    ux, uz = line["x1"] - line["x0"], line["z1"] - line["z0"]
    length = math.hypot(ux, uz) or 1.0
    ux, uz = ux / length, uz / length
    px, pz = -uz, ux
    half = max(0.3, line["width"] / 2)

    def strip(off):
        return [[line["x0"] + px * (off - half), line["z0"] + pz * (off - half)],
                [line["x1"] + px * (off - half), line["z1"] + pz * (off - half)],
                [line["x1"] + px * (off + half), line["z1"] + pz * (off + half)],
                [line["x0"] + px * (off + half), line["z0"] + pz * (off + half)]]

    c = photo.cls
    here = photo.mask(strip(0.0)) & ~c["plant"]
    visible = float((here & ~c["shade"]).sum()) / max(1, int(photo.mask(strip(0.0)).sum()))
    best = None
    for side in (1, -1):
        road = photo.mask(strip(side * (half * 2 + 0.9))) & ~c["plant"]
        for light in (~c["shade"], c["shade"]):
            a, b = here & light, road & light
            if a.sum() > 30 and b.sum() > 30:
                lift = float(np.median(c["value"][a]) - np.median(c["value"][b]))
                best = lift if best is None else max(best, lift)
                break
    return {"visible": round(visible, 3), "lift": None if best is None else round(best, 1),
            "verdict": UNSEEN if best is None or visible < 0.25 else PRESENT if best >= 6 else ABSENT}


# ---- the run ----------------------------------------------------------------------------------------

def run(candidates: dict, ortho, journal: Journal, *, tasks=("bus_zone", "legend", "ground", "courts", "gutter"),
        log=print, limit: int | None = None) -> dict:
    """Every candidate judged, each result journalled as it is made. Returns the counts."""
    frame = Frame.fit(candidates["frame"])
    surfaces = candidates["surfaces"]
    started = time.time()
    counts: dict[str, int] = {}

    def each(task, items, judge):
        done = 0
        for rect in items:
            key = key_of(task, rect["x"], rect["z"])
            if journal.done(key):
                continue
            if limit is not None and done >= limit:
                break
            xs, zs = zip(*rect["corners"], strict=True)
            photo = Photo(ortho, frame, xs, zs)
            result = judge(photo, rect) if photo.ok else {"verdict": UNSEEN, "why": "no photograph"}
            journal.put(key, {"task": task, "x": round(rect["x"], 2), "z": round(rect["z"], 2), "ux": round(rect["ux"], 4),
                              "uz": round(rect["uz"], 4), "along": round(rect["along"], 2), "across": round(rect["across"], 2), **result})
            done += 1
        counts[task] = done
        log(f"{task}: {done} judged, {len(journal.of(task))} in the journal ({time.time() - started:.0f} s)")

    if "bus_zone" in tasks:
        zones = [rectangle(p) for m in surfaces.get("bus_zone:fill", []) for p in pieces(m["tri"])]
        each("bus_zone", [z for z in zones if z["along"] > 1.5], judge_bus_zone)
    if "legend" in tasks:
        words = [rectangle(p) for m in surfaces.get("furniture:road_legend", []) for p in pieces(m["tri"], 0.25)]
        each("legend", _join_words([w for w in words if w["along"] > 0.2]), judge_legend)
    if "gutter" in tasks:
        strips = [p for m in surfaces.get("waterworks:gutter", []) for p in pieces(m["tri"])]
        lines = straighten_gutters(strips)
        done = 0
        for line in lines:
            key = key_of("gutter", (line["x0"] + line["x1"]) / 2, (line["z0"] + line["z1"]) / 2)
            if journal.done(key):
                continue
            if limit is not None and done >= limit:
                break
            photo = Photo(ortho, frame, [line["x0"], line["x1"]], [line["z0"], line["z1"]])
            check = check_gutter(photo, line) if photo.ok else {"verdict": UNSEEN}
            journal.put(key, {"task": "gutter", **{k: round(v, 3) if isinstance(v, float) else v for k, v in line.items()}, **check})
            done += 1
        counts["gutter"] = done
        log(f"gutter: {len(strips)} pieces as {len(lines)} lines; {done} judged ({time.time() - started:.0f} s)")
    if "ground" in tasks or "courts" in tasks:
        _ground_and_courts(candidates, ortho, frame, journal, tasks, counts, log, limit, started)
    return counts


def _join_words(words: list[dict]) -> list[dict]:
    """Letters as words: boxes within a metre and a half of each other are one legend."""
    left = list(words)
    out = []
    while left:
        group = [left.pop()]
        grew = True
        while grew:
            grew = False
            for w in list(left):
                if any(math.hypot(w["x"] - g["x"], w["z"] - g["z"]) < g["along"] + w["along"] + 1.5 for g in group):
                    group.append(w)
                    left.remove(w)
                    grew = True
        out.append(rectangle(np.array([c for g in group for c in g["corners"]])))
    return out


def _ground_and_courts(candidates, ortho, frame, journal, tasks, counts, log, limit, started) -> None:
    """The inferred ground, patch by patch: rasterised at the photograph's grain, each connected
    patch judged, and the big paved ones searched for courts."""
    import cv2

    surfaces = candidates["surfaces"]
    kinds = [k for k in ("inferred:paving", "inferred:asphalt", "inferred:service", "inferred:grass", "plaza", "service_yard", "yard")
             if surfaces.get(k)]
    done_ground = done_courts = 0
    mapped = [court_ring(c, frame) for c in candidates.get("courts", [])]
    roofs = [np.asarray(r, float) for r in candidates.get("buildings", []) if len(r) >= 3]
    roof_box = np.array([[r[:, 0].min(), r[:, 1].min(), r[:, 0].max(), r[:, 1].max()] for r in roofs]) if roofs else np.zeros((0, 4))
    for kind in kinds:
        tri = np.concatenate([np.asarray(m["tri"], float).reshape(-1, 3, 2) for m in surfaces[kind]])
        # In tiles of 250 m (the photograph's own squares): a patch is judged in the tile its
        # middle is in.
        mid = tri.mean(axis=1)
        tiles = {}
        for t, (mx, mz) in zip(tri, mid, strict=True):
            tiles.setdefault((math.floor(mx / 250), math.floor(mz / 250)), []).append(t)
        for (ti, tj), tris in sorted(tiles.items()):
            tile_key = f"tile:{'+'.join(sorted(set(tasks) & {'ground', 'courts'}))}:{kind}:{ti}:{tj}"
            if journal.done(tile_key):
                continue
            if limit is not None and done_ground >= limit:
                break
            tris = np.asarray(tris)
            xs, zs = tris[:, :, 0].ravel(), tris[:, :, 1].ravel()
            photo = Photo(ortho, frame, xs, zs, margin=2.0)
            if not photo.ok:
                journal.put(tile_key, {"task": "tile", "kind": kind, "patches": 0, "why": "no photograph"})
                continue
            raster = np.zeros(photo.shape, np.uint8)
            px = np.round(photo.pixels(xs, zs)).astype(np.int32).reshape(-1, 3, 2)
            cv2.fillPoly(raster, list(px), 1)
            count, labels, stats, cents = cv2.connectedComponentsWithStats(raster, connectivity=8)
            patches = 0
            roof = None
            for i in range(1, count):
                area = stats[i, cv2.CC_STAT_AREA] * PIXEL_M * PIXEL_M
                if area < 12:
                    continue
                patch = labels == i
                contours, _ = cv2.findContours(patch.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                perimeter = sum(cv2.arcLength(c, True) for c in contours) * PIXEL_M
                width = 2 * area / max(perimeter, 1e-6)
                e = photo.bounds[0] + cents[i][0] * PIXEL_M
                n = photo.bounds[3] - cents[i][1] * PIXEL_M
                x, z = frame.page(e, n, (float(xs.mean()), float(zs.mean())))
                x, z = float(x[0]), float(z[0])
                if "ground" in tasks:
                    journal.put(key_of(f"ground:{kind}", x, z), {"task": "ground", "kind": kind, "x": round(x, 2), "z": round(z, 2),
                                                                **judge_ground(photo, patch, area, width)})
                    done_ground += 1
                if "courts" in tasks and area > 250 and kind != "inferred:grass":
                    if roof is None:
                        # The buildings here, as the photograph's pixels: nothing on a roof is a court.
                        roof = np.zeros(photo.shape, np.uint8)
                        x0, x1, z0, z1 = xs.min() - 30, xs.max() + 30, zs.min() - 30, zs.max() + 30
                        for k in np.nonzero((roof_box[:, 2] > x0) & (roof_box[:, 0] < x1) & (roof_box[:, 3] > z0) & (roof_box[:, 1] < z1))[0]:
                            cv2.fillPoly(roof, [np.round(photo.pixels(roofs[k][:, 0], roofs[k][:, 1])).astype(np.int32)], 1)
                    for court in find_courts(photo, patch):
                        box = court["box"]
                        inside = np.zeros(photo.shape, np.uint8)
                        cv2.fillPoly(inside, [np.round(box).astype(np.int32)], 1)
                        inside = inside.astype(bool)
                        on_roof = float(roof[inside].mean()) if inside.any() else 1.0
                        bright = float(np.median(photo.cls["value"][inside])) if inside.any() else 255.0
                        if on_roof > THRESHOLDS["court_on_roof"] or bright > THRESHOLDS["court_bright"]:
                            continue
                        be = photo.bounds[0] + box[:, 0] * PIXEL_M
                        bn = photo.bounds[3] - box[:, 1] * PIXEL_M
                        bx, bz = frame.page(be, bn, (x, z))
                        cx, cz = float(bx.mean()), float(bz.mean())
                        known = any(_inside(ring, cx, cz) for ring in mapped)
                        kind_c = court_kind(court["long_m"], court["short_m"], court["circles"], court["parts"])
                        journal.put(key_of("court", cx, cz), {"task": "court", "x": round(cx, 2), "z": round(cz, 2), "kind": kind_c,
                                                              "corners": [[round(float(a), 2), round(float(b), 2)] for a, b in zip(bx, bz, strict=True)],
                                                              "long_m": round(court["long_m"], 2), "short_m": round(court["short_m"], 2),
                                                              "outline": round(court["outline"], 3), "circles": court["circles"],
                                                              "parts": court["parts"], "mapped": known, "on": kind})
                        done_courts += 1
                patches += 1
            journal.put(tile_key, {"task": "tile", "kind": kind, "patches": patches})
        log(f"ground {kind}: {done_ground} patches, {done_courts} courts so far ({time.time() - started:.0f} s)")
    counts["ground"], counts["courts"] = done_ground, done_courts


def court_ring(court: dict, frame: Frame) -> np.ndarray:
    """A mapped court as the page has it ({c: [lon, lat], a: its long side's bearing, l, w}) as
    its four corners in the page's metres."""
    px, pz = frame.from_lonlat(court["c"][0], court["c"][1])
    cx, cz = float(px[0]), float(pz[0])
    a, half_l, half_w = court.get("a", 0.0), court["l"] / 2, court["w"] / 2
    ux, uz = math.cos(a), math.sin(a)
    return np.array([[cx + sx * ux * half_l - sz * uz * half_w, cz + sx * uz * half_l + sz * ux * half_w]
                     for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])


def _inside(ring: np.ndarray, x: float, z: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, zi, xj, zj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def assemble(journal: Journal, region: str, frame_residual_m: float) -> dict:
    """The journal as the file the page reads: by task, in the page's metres."""
    def rows(task, keep):
        return [{k: r[k] for k in keep if k in r} for r in journal.of(task)]

    return {
        "schema": "kerbside.imagery_truth/1", "region": region, "pixel_m": PIXEL_M,
        "source": "NOAA NGS 2025 0.25 m mosaic (CC0), smc.imagery.ortho", "frame_residual_m": round(frame_residual_m, 3),
        "bus_zones": rows("bus_zone", ("x", "z", "ux", "uz", "along", "across", "verdict", "red", "lift", "visible")),
        "legends": rows("legend", ("x", "z", "along", "across", "verdict", "white", "visible")),
        "ground": rows("ground", ("x", "z", "kind", "verdict", "area", "grass", "concrete", "asphalt")),
        "courts": rows("court", ("x", "z", "kind", "corners", "long_m", "short_m", "outline", "circles", "mapped", "on")),
        "gutters": rows("gutter", ("x0", "z0", "x1", "z1", "width", "pieces", "length", "covered", "wobble", "verdict", "lift")),
    }


def page_file(journal: Journal, region: str, frame: Frame, check_xz: tuple[float, float]) -> dict:
    """What the page reads (docs/imagery-truth.json): only what changes what it draws -- every
    bus zone's verdict, the legends that are not there, the courts the map has not got, the
    gutters as straight strips -- and one point both ways, so a page of other ground ignores it."""
    full = assemble(journal, region, frame.residual_m)
    lon, lat = frame.lonlat(*check_xz)
    return {
        "schema": full["schema"], "region": region, "source": full["source"], "pixel_m": PIXEL_M,
        "check": {"x": check_xz[0], "z": check_xz[1], "lon": float(lon), "lat": float(lat)},
        "bus_zones": [{k: r[k] for k in ("x", "z", "verdict") if k in r} for r in full["bus_zones"]],
        "legends": [{k: r[k] for k in ("x", "z", "verdict") if k in r} for r in full["legends"] if r.get("verdict") == ABSENT],
        "courts": [r for r in full["courts"] if not r.get("mapped") and r.get("kind") != "court"],
        "gutters": [{k: (round(r[k], 2) if isinstance(r[k], float) else r[k]) for k in ("x0", "z0", "x1", "z1", "width", "verdict") if k in r}
                    for r in full["gutters"]],
        "counts": {k: _tally(full[k]) for k in ("bus_zones", "legends", "ground", "courts", "gutters")},
    }


def _tally(rows: list[dict]) -> dict:
    out: dict = {}
    for r in rows:
        v = r.get("verdict") or r.get("kind")
        out[v] = out.get(v, 0) + 1
    return out


# ---- the ground cover, ring by ring: two photographs, the roofs left out, and the neighbours -------

COVER = {
    # Of a ring's pixels (roofs and shade left out), the share that must be left to judge it.
    "visible_min": 0.25, "pixels_min": 40,
    # ... or this much of it in the open whatever its share: a lot is mostly its building, and
    # the yard beside the building is what is being asked about (15 m2 of it is enough).
    "open_px": 240,
    # One kind's share: sure of it, or only leaning to it.
    "sure": 0.7, "lean": 0.55,
    # A ring told by its shape (the page's own inference stands): narrower or smaller than this.
    "narrow_m": 3.0, "small_m2": 60.0,
    # The neighbours: rings of the same list within this far, this many of them, this agreed.
    "near_m": 70.0, "near_min": 3, "near_agree": 0.7,
}


class Naip:
    """The other photograph: USDA's NAIP (2022, 0.6 m, a different year, month and sun). Read a
    250 m square at a time and kept on disk, so a second run asks for nothing."""

    def __init__(self, cache: Path):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.tiles: dict = {}

    def tile(self, i: int, j: int):
        if (i, j) not in self.tiles:
            path = self.cache / f"naip_{i}_{j}.npy"
            if path.exists():
                data = np.load(path)
            else:
                got = self._fetch(i, j)
                data = got[0] if got is not None else np.zeros((0,), np.uint8)
                # (Only what was answered is kept: a square the service did not answer for is
                # asked for again another day.)
                if got is not None or self.failed < 3:
                    np.save(path, data) if got is not None else None
            self.tiles[(i, j)] = data if data.ndim == 3 else None
        return self.tiles[(i, j)]

    #: Seconds a square is waited for; after three that did not come the service is left alone.
    WAIT_S = 20.0
    failed = 0

    def _fetch(self, i: int, j: int):
        """One square from the service, or None: never waited for longer than WAIT_S (it hung a
        whole run for an hour, 2026-11-19), and not asked again once it has failed three times."""
        if self.failed >= 3:
            return None
        from concurrent.futures import ThreadPoolExecutor
        from concurrent.futures import TimeoutError as Late

        from smc.imagery.ortho import read_naip

        pool = ThreadPoolExecutor(1)
        job = pool.submit(read_naip, (i * 250.0, j * 250.0, (i + 1) * 250.0, (j + 1) * 250.0))
        try:
            return job.result(timeout=self.WAIT_S)
        except (Late, Exception):
            self.failed += 1
            return None
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    def plant_share(self, e: np.ndarray, n: np.ndarray) -> float | None:
        """Of the points (UTM), the share that is growing in NAIP's picture; None where it has none."""
        i, j = math.floor(float(np.mean(e)) / 250.0), math.floor(float(np.mean(n)) / 250.0)
        data = self.tile(i, j)
        if data is None:
            return None
        h, w = data.shape[1:]
        col = np.clip(((e - i * 250.0) / 250.0 * w).astype(int), 0, w - 1)
        row = np.clip((((j + 1) * 250.0 - n) / 250.0 * h).astype(int), 0, h - 1)
        ok = (e >= i * 250.0) & (e < (i + 1) * 250.0) & (n >= j * 250.0) & (n < (j + 1) * 250.0)
        if ok.sum() < 6:
            return None
        r, nir = data[0][row[ok], col[ok]].astype(np.float32), data[3][row[ok], col[ok]].astype(np.float32)
        return float(((nir - r) / np.maximum(1.0, nir + r) > 0.1).mean())


def judge_cover(photo: Photo, ring_xz: np.ndarray, roof: np.ndarray, naip: Naip | None, C=COVER) -> dict:
    """What a ring of ground is: grass, concrete or asphalt by most of what shows of it (roofs
    and shade left out), how sure, and whether the other photograph says the same."""
    import cv2

    inside = photo.mask(ring_xz)
    total = int(inside.sum())
    area = total * PIXEL_M * PIXEL_M
    contours, _ = cv2.findContours(inside.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    width = 2 * area / max(1e-6, sum(cv2.arcLength(c, True) for c in contours) * PIXEL_M)
    out = {"area": round(area, 1), "width": round(width, 2)}
    if area < C["small_m2"] or width < C["narrow_m"]:
        return {**out, "verdict": "by_shape", "sure": "shape"}
    c = photo.cls
    seen = inside & ~roof & ~c["shade"]
    n = int(seen.sum())
    out["visible"] = round(n / max(1, total), 3)
    if n < C["pixels_min"] or (n / max(1, total) < C["visible_min"] and n < C["open_px"]):
        return {**out, "verdict": UNSEEN, "sure": "no"}
    hard = seen & ~c["plant"]
    shares = {"grass": float((seen & c["plant"]).sum()) / n,
              "concrete": float((hard & (c["value"] >= 150)).sum()) / n,
              "asphalt": float((hard & (c["value"] < 150)).sum()) / n}
    kind = max(shares, key=shares.get)
    out.update({k: round(v, 3) for k, v in shares.items()})
    # The other photograph, on the one question it can answer at its grain: growing, or not.
    second = None
    if naip is not None:
        rows, cols = np.nonzero(inside & ~roof)
        if len(rows) > 12:
            pick = slice(None, None, max(1, len(rows) // 400))
            e = photo.bounds[0] + (cols[pick] + 0.5) * PIXEL_M
            nn = photo.bounds[3] - (rows[pick] + 0.5) * PIXEL_M
            second = naip.plant_share(e, nn)
    if second is not None:
        out["naip_plant"] = round(second, 3)
    agrees = second is None or (second >= 0.5) == (kind == "grass")
    if shares[kind] >= C["sure"] and agrees and second is not None:
        return {**out, "verdict": kind, "sure": "two"}
    if shares[kind] >= C["lean"] and agrees:
        return {**out, "verdict": kind, "sure": "one"}
    return {**out, "verdict": "mixed", "sure": "no", "leans": kind}


def by_neighbours(rows: list[dict], C=COVER) -> int:
    """The rings the photographs could not call (unseen, mixed), called by those round them: where
    most of the same kind of ring within ``near_m`` are one thing, this one is taken to be the
    same (a row of back yards is paved or it is planted; a school's yards are all asphalt).
    Marks them ``sure: "near"``; returns how many."""
    called = [r for r in rows if r.get("sure") in ("two", "one")]
    if not called:
        return 0
    at = np.array([[r["x"], r["z"]] for r in called])
    changed = 0
    for r in rows:
        if r.get("verdict") not in (UNSEEN, "mixed"):
            continue
        near = np.hypot(at[:, 0] - r["x"], at[:, 1] - r["z"]) < C["near_m"]
        same = [called[k]["verdict"] for k in np.nonzero(near)[0] if called[k]["list"] == r["list"]]
        if len(same) < C["near_min"]:
            continue
        kind = max(set(same), key=same.count)
        if same.count(kind) / len(same) >= C["near_agree"] and r.get("leans", kind) == kind:
            r["verdict"], r["sure"], r["near"] = kind, "near", len(same)
            changed += 1
    return changed


def run_cover(ground: dict, candidates: dict, ortho, journal: Journal, naip: Naip | None, *, log=print,
              lists=("plazas", "service_yards", "inferred"), limit: int | None = None) -> list[dict]:
    """The ground file's rings inside the candidates' area, judged and journalled one by one."""
    import cv2

    frame = Frame.fit(candidates["frame"])
    f = np.asarray(candidates["frame"], float)
    x0, x1, z0, z1 = f[:, 0].min(), f[:, 0].max(), f[:, 1].min(), f[:, 1].max()
    roofs = [np.asarray(r, float) for r in candidates.get("buildings", []) if len(r) >= 3]
    roof_box = np.array([[r[:, 0].min(), r[:, 1].min(), r[:, 0].max(), r[:, 1].max()] for r in roofs]) if roofs else np.zeros((0, 4))
    started, done = time.time(), 0
    for name in lists:
        items = ground.get(name) or []
        # The inferred fill is in cells: those of one kind that touch are one patch.
        groups = _cells_as_patches(items) if name == "inferred" else [[k] for k in range(len(items))]
        for group in groups:
            first = items[group[0]]
            key = f"cover:{name}:{first.get('id') or ''}:{first['p'][0][0]},{first['p'][0][1]}"
            if journal.done(key):
                continue
            rings = []
            for k in group:
                ll = np.asarray(items[k]["p"], float)
                px, pz = frame.from_lonlat(ll[:, 0], ll[:, 1])
                rings.append(np.c_[px, pz])
            allp = np.vstack(rings)
            cx, cz = float(allp[:, 0].mean()), float(allp[:, 1].mean())
            if not (x0 <= cx <= x1 and z0 <= cz <= z1):
                continue
            if limit is not None and done >= limit:
                break
            photo = Photo(ortho, frame, allp[:, 0], allp[:, 1], margin=2.0)
            row = {"task": "cover", "list": name, "x": round(cx, 2), "z": round(cz, 2), "drawn": first.get("k") or name,
                   "ids": [items[k].get("id") or f"{items[k]['p'][0][0]},{items[k]['p'][0][1]}" for k in group]}
            if not photo.ok:
                journal.put(key, {**row, "verdict": UNSEEN, "sure": "no", "why": "no photograph"})
                continue
            roof = np.zeros(photo.shape, np.uint8)
            hit = (roof_box[:, 2] > allp[:, 0].min() - 3) & (roof_box[:, 0] < allp[:, 0].max() + 3) \
                & (roof_box[:, 3] > allp[:, 1].min() - 3) & (roof_box[:, 1] < allp[:, 1].max() + 3)
            for k in np.nonzero(hit)[0]:
                cv2.fillPoly(roof, [np.round(photo.pixels(roofs[k][:, 0], roofs[k][:, 1])).astype(np.int32)], 1)
            # (A roof leans in the photograph: a metre and a half round each is roof too.)
            roof = cv2.dilate(roof, np.ones((13, 13), np.uint8)).astype(bool)
            if len(rings) == 1:
                judged = judge_cover(photo, rings[0], roof, naip)
            else:
                merged = np.zeros(photo.shape, np.uint8)
                for ring in rings:
                    cv2.fillPoly(merged, [np.round(photo.pixels(ring[:, 0], ring[:, 1])).astype(np.int32)], 1)
                judged = judge_cover(_Masked(photo, merged.astype(bool)), None, roof, naip)
            journal.put(key, {**row, **judged})
            done += 1
            if done % 250 == 0:
                log(f"cover: {done} judged ({time.time() - started:.0f} s)")
    rows = [dict(r) for r in journal.of("cover")]
    near = by_neighbours(rows)
    log(f"cover: {done} judged now, {len(rows)} in the journal, {near} called by their neighbours ({time.time() - started:.0f} s)")
    return rows


class _Masked:
    """A photograph with the ring already drawn (a patch of many cells)."""

    def __init__(self, photo: Photo, mask: np.ndarray):
        self.cls, self.bounds, self._mask = photo.cls, photo.bounds, mask

    def mask(self, _ring) -> np.ndarray:
        return self._mask


def _cells_as_patches(items: list[dict]) -> list[list[int]]:
    parent: dict = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for item in items:
        keys = [(item["k"], round(p[0], 6), round(p[1], 6)) for p in item["p"]]
        root = find(keys[0])
        for k in keys[1:]:
            parent[find(k)] = root
    groups: dict = {}
    for i, item in enumerate(items):
        groups.setdefault(find((item["k"], round(item["p"][0][0], 6), round(item["p"][0][1], 6))), []).append(i)
    return list(groups.values())


#: A verdict as the page draws it.
DRAWN_AS = {"grass": "grass", "concrete": "paving", "asphalt": "asphalt"}


def cover_for_page(rows: list[dict]) -> dict:
    """{list: {id: kind}} for the rings whose verdict is a kind and is not what is drawn already."""
    drawn_now = {"plazas": "paving", "service_yards": "asphalt"}
    out: dict = {}
    for r in rows:
        kind = DRAWN_AS.get(r.get("verdict"))
        if not kind or r.get("sure") not in ("two", "one", "near"):
            continue
        now = drawn_now.get(r["list"], r.get("drawn"))
        if kind == now:
            continue
        for item_id in r["ids"]:
            out.setdefault(r["list"], {})[item_id] = kind
    return out
