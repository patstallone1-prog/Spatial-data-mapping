"""Reading a registered wall elevation into model parts, with no reviewer.

Input is what :mod:`kerbfront.auto.run` makes of one wall: the fused, registered elevation
(BGR, metres on a ``Grid``), which cells any frame saw, the per-cell ADE20K vote (read in each
photograph's own geometry, then carried onto the wall) and the same labels on two planes out
in the street (the kerb and the parking lane). Output is a dict of findings in the model's
own units (u along the wall from its first corner, v up from the pavement).

The scene parser is good at sky, trees, cars, ground, awnings and big shop glass, and poor at
small upper windows on a rectified wall, so parts of the facade itself are read the way a
person reads the elevation: dark rectangles in rows are windows, runs of a second colour up
the wall are pilasters, rows of a second colour across it are belts and cornices.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from . import segment as S

SKY = ("sky",)
TREE = ("tree", "palm", "plant")
OCCLUDE = ("car", "person", "truck", "van", "bus", "bicycle", "minibike", "pole", "streetlight",
           "traffic light", "tree", "palm", "plant", "signboard", "awning", "fence", "railing", "bench",
           "chair", "table", "umbrella", "flag", "pot", "flower", "booth", "canopy", "tent", "car")
GLASSY = ("windowpane", "door", "screen door", "glass", "showcase", "shop", "screen")
AWNING = ("awning", "canopy", "tent")
SIGN = ("signboard", "poster", "flag", "screen", "board")
PARKLET = ("fence", "railing", "chair", "table", "plant", "pot", "flower", "flowerpot", "tent", "canopy",
           "awning", "umbrella", "bench", "box", "booth", "wall", "column", "pole", "stool", "plaything", "tree")
CARS = ("car", "truck", "van", "bus", "road", "minibike", "bicycle")
SEATS = ("chair", "table", "umbrella", "bench", "stool", "plant", "pot", "flower", "fence", "railing")


def hexc(bgr) -> str:
    b, g, r = (int(np.clip(round(float(x)), 0, 255)) for x in bgr)
    return f"#{r:02x}{g:02x}{b:02x}"


def lab_of(img: np.ndarray) -> np.ndarray:
    """CIELAB with L 0-100, a/b signed (float32)."""
    lab = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] *= 100 / 255
    lab[..., 1:] -= 128
    return lab


def runs(mask: np.ndarray, min_len: int = 1, max_gap: int = 0) -> list[tuple[int, int]]:
    """[start, end) runs of True in a 1-D mask, joining gaps up to ``max_gap``."""
    out = []
    i, n = 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            out.append([i, j])
            i = j
        else:
            i += 1
    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] <= max_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [(a, b) for a, b in merged if b - a >= min_len]


class Wall:
    """One wall's elevation and what is known about it."""

    def __init__(self, model: dict, edge: int, fused: np.ndarray, seen: np.ndarray, labels: np.ndarray,
                 grid, planes: dict[str, np.ndarray] | None = None, ref: np.ndarray | None = None):
        self.m, self.e, self.F, self.seen, self.lb = model, edge, fused.astype(np.float32), seen, labels
        self.g = grid
        self.planes = planes or {}
        self.ref = ref
        self.L = grid.L
        self.lab = lab_of(self.F)
        self.c0, self.c1 = max(0, grid.col(0.0)), min(grid.shape[1], grid.col(self.L))

        def m_(names):
            return np.isin(self.lb, list(S.ids(*names)))
        self.sky = m_(SKY)
        self.tree = m_(TREE)
        self.occ = m_(OCCLUDE) | (self.lb < 0) | ~seen
        self.glassy = m_(GLASSY)
        self.awn = m_(AWNING)
        self.sign = m_(SIGN)

    # -- detected parts ----------------------------------------------------------------------
    _parts = None

    def parts(self) -> list[dict]:
        """Grounding DINO's windows, doors, awnings and signs on the elevation, in metres."""
        if self._parts is None:
            from .detect import detect
            g, px = self.g, self.g.px
            out = []
            for b in detect(self.F):
                u0, u1 = float(g.u0 + b["x0"] / px), float(g.u0 + b["x1"] / px)
                vt, vb = float(g.v1 - b["y0"] / px), float(g.v1 - b["y1"] / px)
                if u1 < -0.2 or u0 > self.L + 0.2:
                    continue
                out.append({"kind": b["kind"], "u": round(u0, 2), "v": round(vb, 2), "w": round(u1 - u0, 2),
                            "h": round(vt - vb, 2), "score": round(b["score"], 3)})
            self._parts = out
        return self._parts

    def detected(self, kind: str, min_score: float = 0.25) -> list[dict]:
        return [p for p in self.parts() if p["kind"] == kind and p["score"] >= min_score]

    def window_boxes(self, wall_lab: np.ndarray, va: float, vb: float) -> list[dict]:
        """Detected windows between two heights, whose centre is on this wall, with a frame
        colour and an arched/square head read from the cells unlike the wall."""
        g = self.g
        mask = self.dark(wall_lab, va - 0.3, vb + 0.3) | self.unlike(wall_lab, va - 0.3, vb + 0.3, thr=16.0)
        out = []
        for b in self.detected("window", 0.27):
            cu = b["u"] + b["w"] / 2
            if not (0.0 <= cu <= self.L) or b["v"] < va or b["v"] + b["h"] > vb + 0.3:
                continue
            if b["w"] < 0.3 or b["h"] < 0.4 or b["w"] > 6 or b["h"] > 3.5:
                continue
            x0, x1 = g.col(b["u"]), g.col(b["u"] + b["w"])
            y0, y1 = g.row(b["v"] + b["h"]), g.row(b["v"])
            box = mask[y0:y1, x0:x1]
            shape = "rect"
            if box.size and b["h"] > 1.0:
                top = box[: max(2, box.shape[0] // 6)]
                q = max(1, box.shape[1] // 5)
                corners = (top[:, :q].mean() + top[:, -q:].mean()) / 2
                if corners < 0.3 and top[:, 2 * q:3 * q].mean() > 0.5:
                    shape = "arched"
            out.append({"u": b["u"], "v": b["v"], "w": b["w"], "h": b["h"], "shape": shape, "fill": b["score"],
                        "frame_colour": self._frame_colour(x0, y0, x1 - x0, y1 - y0)})
        return self._regular(out)

    # -- helpers -------------------------------------------------------------------------
    def rows(self, va: float, vb: float) -> slice:
        g = self.g
        return slice(max(0, g.row(vb)), min(g.shape[0], g.row(va)))

    def cols(self, ua: float = 0.0, ub: float | None = None) -> slice:
        g = self.g
        ub = self.L if ub is None else ub
        return slice(max(0, g.col(ua)), min(g.shape[1], g.col(ub)))

    def v_of(self, r) -> float:
        return float(self.g.v1 - (np.asarray(r) + 0.5) / self.g.px)

    def u_of(self, c) -> float:
        return float(self.g.u0 + (np.asarray(c) + 0.5) / self.g.px)

    # -- height ----------------------------------------------------------------------------
    def height(self, lidar: float) -> tuple[float, dict]:
        """Top of the facade: where the wall meets the sky in each column, the median over the
        columns that see sky above the wall; else the strongest horizontal change near the
        LiDAR height."""
        g, px = self.g, self.g.px
        tops = []
        cs = range(self.c0 + int(0.3 * px), self.c1 - int(0.3 * px))
        wallish = ~self.sky & ~self.tree & self.seen & (self.lb >= 0)
        for c in cs:
            col_sky, col_w = self.sky[:, c], wallish[:, c]
            # first wall row below a run of sky, scanning down from the top
            r = 0
            while r < g.shape[0] - 1 and not col_sky[r]:
                r += 1
            if r >= g.shape[0] - 1:
                continue
            while r < g.shape[0] - 1 and col_sky[r]:
                r += 1
            run = col_w[r:r + int(0.8 * px)]
            if len(run) and run.mean() > 0.8:
                tops.append(self.v_of(r))
        info = {"sky_cols": len(tops), "cols": len(cs)}
        lo, hi = lidar - 1.6, lidar + 1.8
        tops = [t for t in tops if lo <= t <= hi]
        if len(tops) >= 0.15 * max(1, len(cs)):
            # the parapet line: the commonest top, not a fin or a sign sticking up
            h = float(np.percentile(tops, 40))
            info["how"] = "sky line"
            return round(h, 2), info
        # strongest row change of the wall's colour near the LiDAR height
        prof = self._row_profile(lo, hi)
        if prof is not None:
            vs, step = prof
            i = int(np.argmax(step))
            if step[i] > 10:
                info["how"] = "row step"
                return round(float(vs[i]), 2), info
        info["how"] = "lidar"
        return lidar, info

    def _row_profile(self, va, vb):
        rs = self.rows(va, vb)
        cs = self.cols()
        lab = self.lab[rs, cs]
        ok = self.seen[rs, cs] & ~self.tree[rs, cs]
        if lab.shape[0] < 6:
            return None
        med = np.array([np.median(lab[i][ok[i]], 0) if ok[i].sum() > 10 else [np.nan] * 3 for i in range(lab.shape[0])])
        k = 3
        step = np.zeros(len(med))
        for i in range(k, len(med) - k):
            a, b = med[i - k:i], med[i:i + k]
            if np.isnan(a).any() or np.isnan(b).any():
                continue
            step[i] = np.linalg.norm(np.median(a, 0) - np.median(b, 0))
        vs = np.array([self.v_of(rs.start + i) for i in range(len(med))])
        return vs, step

    # -- colours ----------------------------------------------------------------------------
    def wall_colour(self, va: float, vb: float, exclude: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray] | None:
        rs, cs = self.rows(va, vb), self.cols()
        ok = self.seen[rs, cs] & ~self.occ[rs, cs] & ~self.sky[rs, cs]
        if exclude is not None:
            ok &= ~exclude[rs, cs]
        L = self.lab[rs, cs][..., 0]
        # glass reads dark, glare bright and grey
        ok &= (L > 6) & (L < 97)
        if ok.sum() < 200:
            return None
        px_lab = self.lab[rs, cs][ok]
        px_bgr = self.F[rs, cs][ok]
        # the wall is the commonest colour, not the median of wall + fins + friezes + glass
        k = 3 if len(px_lab) > 600 else 1
        if k > 1:
            crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
            sample = px_lab[:: max(1, len(px_lab) // 20000)].astype(np.float32)
            _, lbl, cen = cv2.kmeans(sample, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
            d = np.linalg.norm(px_lab[:, None, :] - cen[None], axis=-1)
            lab_all = d.argmin(1)
            cnt = np.bincount(lab_all, minlength=k).astype(float)
            # glass, shadow and reveals cluster dark: the wall is the largest of the others
            chroma = np.hypot(cen[:, 1], cen[:, 2])
            cnt[(cen[:, 0] < 30) & (chroma < 6)] *= 0.15
            big = int(cnt.argmax())
            sel = lab_all == big
            px_lab, px_bgr = px_lab[sel], px_bgr[sel]
        return np.median(px_bgr, 0), np.median(px_lab, 0)

    def lit_colour(self, wall_lab: np.ndarray, va: float, vb: float, exclude: np.ndarray | None,
                   views: list[np.ndarray], valid: list[np.ndarray]) -> np.ndarray | None:
        """The wall's colour in its best-lit frame. The fused median mixes frames in shade
        and in sun (and every street camera exposes for the sky), so it reads darker and
        greyer than the paint; a person picks the colour off the sunniest frame. The wall's
        cells are those near the fused wall colour; each frame's median over them, and the
        brightest that is not blown out."""
        if not views:
            return None
        rs, cs = self.rows(va, vb), self.cols()
        de = np.linalg.norm(self.lab[rs, cs] - wall_lab, axis=-1)
        mask = (de < 14) & self.seen[rs, cs] & ~self.occ[rs, cs] & ~self.sky[rs, cs]
        if exclude is not None:
            mask &= ~exclude[rs, cs]
        best = None
        for img, ok in zip(views, valid):
            m = mask & ok[rs, cs]
            if m.sum() < max(150, 0.15 * mask.sum()):
                continue
            px = img[rs, cs][m].astype(np.float32)
            bgr = np.median(px, 0)
            L = lab_of(bgr[None, None])[0, 0, 0]
            if (px.max(1) > 250).mean() > 0.2 or L > 96:
                continue
            if best is None or L > best[0]:
                best = (L, bgr)
        return None if best is None else best[1]

    def band_top(self, wall_lab: np.ndarray, h: float, prior: float = 3.9) -> tuple[float, dict]:
        """Top of the shop band: going up the wall, where the wall's own colour takes over
        from glass, awnings and signs. The step that best splits "little wall below" from
        "mostly wall above", searched between 2.2 m and 5 m (or just under the top)."""
        px = self.g.px
        lo, hi = 1.4, h - 0.1
        rs, cs = self.rows(lo, hi), self.cols(0.2, self.L - 0.2)
        de = np.linalg.norm(self.lab[rs, cs] - wall_lab, axis=-1)
        ok = self.seen[rs, cs] & ~self.sky[rs, cs] & ~self.tree[rs, cs]
        near = (de < 15) & ok
        f = near.sum(1) / np.maximum(1, ok.sum(1))
        vs = np.array([self.v_of(rs.start + i) for i in range(len(f))])
        k = int(0.9 * px)
        best = (-1.0, prior)
        for i in range(len(f)):
            v = vs[i]
            if not 2.2 <= v <= min(5.0, h - 0.25):
                continue
            above = f[max(0, i - k):i]          # rows above v (rows run downwards)
            below = f[i:i + k]
            if len(above) < 3 or len(below) < 3:
                continue
            score = float(above.mean() - below.mean()) - 0.04 * abs(v - prior)
            if score > best[0]:
                best = (score, float(v))
        info = {"step": round(best[0], 2)}
        if best[0] < 0.12:
            info["how"] = "prior"
            return prior if prior < h - 0.3 else round(max(2.2, h - 0.6), 2), info
        info["how"] = "wall colour step"
        return round(best[1], 2), info

    def ring_colour(self, windows: list[dict], inner: float = 0.12, outer: float = 0.45):
        """The wall around the windows: what a window is set in is the wall."""
        g = self.g
        ring = np.zeros(g.shape, bool)
        hole = np.zeros(g.shape, bool)
        for o in windows:
            ring[max(0, g.row(o["v"] + o["h"] + outer)):g.row(o["v"] - outer),
                 max(0, g.col(o["u"] - outer)):g.col(o["u"] + o["w"] + outer)] = True
            hole[max(0, g.row(o["v"] + o["h"] + inner)):g.row(o["v"] - inner),
                 max(0, g.col(o["u"] - inner)):g.col(o["u"] + o["w"] + inner)] = True
        m = ring & ~hole & self.seen & ~self.sky & ~self.tree & ~self.occ
        if m.sum() < 150:
            return None
        px_lab, px_bgr = self.lab[m], self.F[m]
        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
        k = 3 if len(px_lab) > 600 else 1
        if k > 1:
            _, lbl, cen = cv2.kmeans(px_lab.astype(np.float32), k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
            cnt = np.bincount(lbl.ravel(), minlength=k)
            sel = lbl.ravel() == int(cnt.argmax())
            px_lab, px_bgr = px_lab[sel], px_bgr[sel]
        return np.median(px_bgr, 0), np.median(px_lab, 0)

    # -- windows -------------------------------------------------------------------------
    def dark(self, wall_lab: np.ndarray, va: float, vb: float) -> np.ndarray:
        """Cells darker than the wall by a margin (glass, deep reveals)."""
        mask = np.zeros(self.g.shape, bool)
        rs, cs = self.rows(va, vb), self.cols()
        L = self.lab[rs, cs][..., 0]
        thr = wall_lab[0] - max(14.0, 0.3 * wall_lab[0])
        d = (L < thr) & self.seen[rs, cs] & ~self.sky[rs, cs] & ~self.tree[rs, cs]
        d |= self.glassy[rs, cs] & (L < wall_lab[0] - 6)
        d = cv2.morphologyEx(d.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        d = cv2.morphologyEx(d, cv2.MORPH_CLOSE, np.ones((5, 3), np.uint8)).astype(bool)
        mask[rs, cs] = d
        return mask

    def unlike(self, wall_lab: np.ndarray, va: float, vb: float, thr: float = 20.0) -> np.ndarray:
        """Cells unlike the wall's colour: a window's frame and glass together."""
        mask = np.zeros(self.g.shape, bool)
        rs, cs = self.rows(va, vb), self.cols()
        de = np.linalg.norm(self.lab[rs, cs] - wall_lab, axis=-1)
        u = (de > thr) & self.seen[rs, cs] & ~self.sky[rs, cs] & ~self.tree[rs, cs]
        u = cv2.morphologyEx(u.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        u = cv2.morphologyEx(u, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)).astype(bool)
        mask[rs, cs] = u
        return mask

    def windows(self, wall_lab: np.ndarray, va: float, vb: float, skip: np.ndarray | None = None) -> list[dict]:
        g, px = self.g, self.g.px
        d = self.dark(wall_lab, va, vb) | self.unlike(wall_lab, va, vb, thr=16.0)
        if skip is not None:
            d &= ~skip
        # a frame lighter than the wall around glass about as dark as it reads as an outline:
        # close small gaps, then fill each closed outline
        d8 = cv2.morphologyEx(d.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        cnts, _ = cv2.findContours(d8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        filled = np.zeros_like(d8)
        cv2.drawContours(filled, cnts, -1, 1, thickness=cv2.FILLED)
        n, cc, st, _ = cv2.connectedComponentsWithStats(filled, connectivity=4)
        out = []
        for i in range(1, n):
            x, y, w, h, a = st[i]
            wm, hm = w / px, h / px
            if wm < 0.35 or hm < 0.45 or wm > 5.0 or hm > 3.2:
                continue
            if hm > 2.5 * wm and wm < 0.8:  # a fin or a downpipe, not a window
                continue
            fill = a / float(w * h)
            if fill < 0.45:
                continue
            u = self.u_of(x) - 0.5 / px
            v = self.v_of(y + h - 1) - 0.5 / px
            if u < -0.2 or u + wm > self.L + 0.2:
                continue
            box = cc[y:y + h, x:x + w] == i
            top = box[: max(2, h // 5)]
            corners = (top[:, : max(1, w // 5)].mean() + top[:, -max(1, w // 5):].mean()) / 2
            shape = "arched" if corners < 0.25 and top[:, w // 3: 2 * w // 3].mean() > 0.6 and hm > 1.0 else "rect"
            frame = self._frame_colour(x, y, w, h)
            out.append({"u": round(u, 2), "v": round(v, 2), "w": round(wm, 2), "h": round(hm, 2),
                        "shape": shape, "fill": round(fill, 2), "frame_colour": frame})
        return self._regular(out)

    def _frame_colour(self, x, y, w, h) -> str | None:
        t = max(1, int(0.06 * self.g.px))
        ring = np.zeros(self.g.shape, bool)
        ring[max(0, y - t):y + h + t, max(0, x - t):x + w + t] = True
        ring[y + t:y + h - t, x + t:x + w - t] = False
        ok = ring & self.seen
        if ok.sum() < 10:
            return None
        return hexc(np.median(self.F[ok], 0))

    @staticmethod
    def _regular(wins: list[dict]) -> list[dict]:
        """Windows in a row share a sill and a head: snap each row to its median."""
        wins = sorted(wins, key=lambda o: o["v"])
        rows: list[list[dict]] = []
        for o in wins:
            for r in rows:
                if abs(np.median([x["v"] for x in r]) - o["v"]) < 0.35 and \
                        abs(np.median([x["v"] + x["h"] for x in r]) - (o["v"] + o["h"])) < 0.45:
                    r.append(o)
                    break
            else:
                rows.append([o])
        out = []
        for r in rows:
            v = float(np.median([x["v"] for x in r]))
            top = float(np.median([x["v"] + x["h"] for x in r]))
            for o in r:
                o["v"], o["h"] = round(v, 2), round(top - v, 2)
                out.append(o)
        return sorted(out, key=lambda o: (o["v"], o["u"]))

    # -- vertical runs: pilasters, fins ---------------------------------------------------------
    def pilasters(self, wall_lab: np.ndarray, va: float, vb: float, windows: list[dict]) -> list[dict]:
        g, px = self.g, self.g.px
        rs, cs = self.rows(va, vb), self.cols()
        lab = self.lab[rs, cs]
        de = np.linalg.norm(lab - wall_lab, axis=-1)
        ok = self.seen[rs, cs] & ~self.sky[rs, cs] & ~self.tree[rs, cs]
        win = np.zeros(g.shape, bool)
        for o in windows:
            win[g.row(o["v"] + o["h"]):g.row(o["v"]), g.col(o["u"]):g.col(o["u"] + o["w"])] = True
        diff = (de > 14) & ok & ~win[rs, cs]
        frac = diff.sum(0) / np.maximum(1, ok.sum(0))
        rr = runs(frac > 0.45, min_len=max(2, int(0.22 * px)), max_gap=1)
        cand = [(a, b) for a, b in rr if (b - a) / px <= 1.2]
        if len(cand) < 3:
            return []
        widths = np.array([(b - a) / px for a, b in cand])
        wmed = float(np.median(widths))
        cand = [(a, b) for (a, b), w in zip(cand, widths) if abs(w - wmed) < 0.35 * wmed + 0.08]
        if len(cand) < 3:
            return []
        us = [self.u_of(cs.start + (a + b) / 2) for a, b in cand]
        cols = np.concatenate([np.arange(cs.start + a, cs.start + b) for a, b in cand])
        sub = diff[:, cols - cs.start]
        rowfrac = sub.mean(1)
        on = np.nonzero(rowfrac > 0.5)[0]
        if not len(on):
            return []
        v_top, v_bot = self.v_of(rs.start + on.min()), self.v_of(rs.start + on.max())
        px_ok = sub & ok[:, cols - cs.start]
        colour = hexc(np.median(self.F[rs][:, cols][px_ok], 0)) if px_ok.any() else None
        return [{"u": [round(u, 2) for u in us], "w": round(wmed, 2), "v0": round(v_bot, 2), "v1": round(v_top, 2),
                 "depth": 0.12, "colour": colour}]

    # -- horizontal bands: belts, friezes, cornice ------------------------------------------------
    def bands(self, wall_lab: np.ndarray, va: float, vb: float, windows: list[dict]) -> list[dict]:
        g, px = self.g, self.g.px
        rs, cs = self.rows(va, vb), self.cols()
        lab = self.lab[rs, cs]
        ok = self.seen[rs, cs] & ~self.sky[rs, cs] & ~self.tree[rs, cs] & ~self.occ[rs, cs]
        win = np.zeros(g.shape, bool)
        for o in windows:
            win[g.row(o["v"] + o["h"]) - 1:g.row(o["v"]) + 1, g.col(o["u"]) - 1:g.col(o["u"] + o["w"]) + 1] = True
        ok &= ~win[rs, cs]
        de = np.linalg.norm(lab - wall_lab, axis=-1)
        frac = ((de > 13) & ok).sum(1) / np.maximum(1, ok.sum(1))
        enough = ok.sum(1) > 0.3 * (cs.stop - cs.start)
        rr = runs((frac > 0.55) & enough, min_len=max(2, int(0.06 * px)), max_gap=1)
        out = []
        for a, b in rr:
            hm = (b - a) / px
            if hm > 0.7:
                continue
            sel = ok[a:b] & (de[a:b] > 13)
            colour = hexc(np.median(self.F[rs][a:b, cs][sel], 0)) if sel.any() else None
            out.append({"v": round(self.v_of(rs.start + b - 1) - 0.5 / px, 2), "h": round(hm, 2), "colour": colour})
        return out

    # -- shop band: glazing, doors, awnings, signs -------------------------------------------
    def awnings(self) -> list[dict]:
        """Awnings: seeded where ADE20K says awning, then grown along the wall through cells of
        the same colour in the same rows (the parser finds part of an awning, the colour finds
        the rest), and split where the colour changes or a gap opens."""
        g, px = self.g, self.g.px
        rs, cs = self.rows(1.9, 4.7), self.cols(-0.3, self.L + 0.3)
        a = self.awn[rs, cs]
        lab = self.lab[rs, cs]
        seen = self.seen[rs, cs] & ~self.sky[rs, cs]
        frac = a.sum(0) / max(1, a.shape[0])
        seeds = runs(frac > 0.06, min_len=int(0.4 * px), max_gap=int(0.12 * px))
        grown = np.zeros(a.shape[1], np.int32) - 1
        info = []
        for k, (c0, c1) in enumerate(seeds):
            sub = a[:, c0:c1]
            rr = np.nonzero(sub.mean(1) > 0.2)[0]
            if not len(rr):
                continue
            r0, r1 = rr.min(), rr.max() + 1
            col = np.median(lab[r0:r1, c0:c1][sub[r0:r1]], 0)
            # cells of the awning's colour in its rows
            same = (np.linalg.norm(lab[r0:r1] - col, axis=-1) < 14) & seen[r0:r1]
            cf = same.mean(0)
            on = (cf > 0.35) | (a[r0:r1].mean(0) > 0.3)
            # grow left and right from the seed through the same colour
            lft, rgt = c0, c1
            while lft > 0 and (on[lft - 1] or (lft > 2 and on[lft - 3])):
                lft -= 1
            while rgt < len(on) and (on[rgt] or (rgt + 2 < len(on) and on[rgt + 2])):
                rgt += 1
            grown[lft:rgt] = k
            info.append((k, r0, r1, col))
        out = []
        for k, r0, r1, col in info:
            for c0, c1 in runs(grown == k, min_len=int(0.8 * px), max_gap=1):
                sel = np.linalg.norm(lab[r0:r1, c0:c1] - col, axis=-1) < 11
                bgr = np.median(self.F[rs][r0:r1, cs][:, c0:c1][sel], 0) if sel.any() else None
                out.append({"u0": round(max(0.0, self.u_of(cs.start + c0) - 0.5 / px), 2),
                            "u1": round(min(self.L, self.u_of(cs.start + c1) - 0.5 / px), 2),
                            "v": round(self.v_of(rs.start + r0), 2), "drop": round((r1 - r0) / px, 2),
                            "colour": hexc(bgr) if bgr is not None else hexc(self.F[rs][r0, cs][c0])})
        # one awning per run: merge overlapping pieces from different seeds
        out.sort(key=lambda x: x["u0"])
        merged = []
        for x in out:
            if merged and x["u0"] < merged[-1]["u1"] - 0.2:
                if x["u1"] - x["u0"] > merged[-1]["u1"] - merged[-1]["u0"]:
                    merged[-1].update({k: x[k] for k in ("v", "colour", "drop")})
                merged[-1]["u1"] = max(merged[-1]["u1"], x["u1"])
            else:
                merged.append(x)
        return merged

    def _split_by_colour(self, rs, ca, cb, sel):
        cols = []
        for c in range(ca, cb):
            s = sel[:, c - ca]
            cols.append(np.median(self.lab[rs][:, c][s], 0) if s.sum() > 2 else None)
        # columns with almost no awning between two runs: a gap
        on = np.array([x is not None for x in cols])
        out = []
        for a, b in runs(on, min_len=int(0.6 * self.g.px), max_gap=1):
            seg = np.array([cols[i] for i in range(a, b)])
            bgr = np.median(self.F[rs][:, ca + a:ca + b][sel[:, a:b]], 0)
            out.append((ca + a, ca + b, hexc(bgr)))
        return out or [(ca, cb, None)]

    def signs(self, band_top: float, top: float) -> list[dict]:
        """Signs: signboard labels, and lettering -- a strip dense in short vertical strokes
        (letters, logos) across the fascia or the wall, 0.15-1 m tall and a metre or more long."""
        g, px = self.g, self.g.px
        rs, cs = self.rows(1.8, min(top + 0.6, band_top + 2.2)), self.cols(-0.3, self.L + 0.3)
        m = self.sign[rs, cs].astype(np.uint8)
        gray = cv2.cvtColor(np.clip(self.F[rs, cs], 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
        gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
        gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
        strokes = (gx > 60) & (gx > 1.2 * gy) & self.seen[rs, cs] & ~self.tree[rs, cs] & ~self.sky[rs, cs]
        dens = cv2.blur(strokes.astype(np.float32), (max(3, int(0.5 * px)), max(3, int(0.2 * px))))
        text = (dens > 0.22).astype(np.uint8)
        text = cv2.morphologyEx(text, cv2.MORPH_CLOSE, np.ones((3, max(3, int(0.6 * px))), np.uint8))
        m = cv2.morphologyEx(m | text, cv2.MORPH_CLOSE, np.ones((3, 5), np.uint8))
        n, cc, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        out = []
        for i in range(1, n):
            x, y, w, h, a = st[i]
            wm, hm = w / px, h / px
            if wm < 0.3 or hm < 0.15 or a < 0.06 * px * px or hm > 1.4:
                continue
            sel = (cc[y:y + h, x:x + w] == i)
            lab_hit = m[y:y + h, x:x + w][sel].mean() if sel.any() else 0
            is_text = text[y:y + h, x:x + w][sel].mean() > 0.5
            if is_text and (wm < 1.0 or wm / max(hm, 0.1) < 2.5):
                continue
            bgr = np.median(self.F[rs][y:y + h, cs][:, x:x + w][sel], 0)
            u = self.u_of(cs.start + x) - 0.5 / px
            v = self.v_of(rs.start + y + h - 1) - 0.5 / px
            out.append({"kind": "letters" if is_text else "board", "u": round(u, 2), "v": round(v, 2), "w": round(wm, 2),
                        "h": round(hm, 2), "bg": hexc(bgr), "label_share": round(float(lab_hit), 2)})
        return out

    def shop_glazing(self, wall_lab: np.ndarray, band_top: float) -> dict:
        """Glazed spans and doors in the shop band, and the band's own span."""
        g, px = self.g, self.g.px
        rs, cs = self.rows(0.5, min(2.5, band_top - 0.4)), self.cols()
        L = self.lab[rs, cs][..., 0]
        occl = self.occ[rs, cs] & ~self.glassy[rs, cs]
        glass = (self.glassy[rs, cs] | (L < wall_lab[0] - 18)) & self.seen[rs, cs]
        known = ~occl & self.seen[rs, cs]
        gfrac = (glass & known).sum(0) / np.maximum(1, known.sum(0))
        kfrac = known.mean(0)
        is_glass = (gfrac > 0.5) & (kfrac > 0.25)
        # columns hidden by a car or a tree: glass when glass is on both sides within 1.5 m
        hidden = kfrac <= 0.25
        for a, b in runs(hidden):
            left, right = is_glass[max(0, a - int(0.4 * px)):a], is_glass[b:b + int(0.4 * px)]
            if (b - a) / px < 1.5 and len(left) and len(right) and left.mean() > 0.5 and right.mean() > 0.5:
                is_glass[a:b] = True
        spans = [(round(self.u_of(cs.start + a) - 0.5 / px, 2), round(self.u_of(cs.start + b) - 0.5 / px, 2))
                 for a, b in runs(is_glass, min_len=int(0.35 * px), max_gap=int(0.12 * px))]
        # glass bottom per span (bulkhead) and top
        out = []
        for u0, u1 in spans:
            c0, c1 = g.col(u0), g.col(u1)
            sub = (self.glassy | (self.lab[..., 0] < wall_lab[0] - 18))[:, c0:c1] & self.seen[:, c0:c1] & ~self.occ[:, c0:c1]
            r_lo, r_hi = g.row(min(band_top, 3.6)), g.row(0.0)
            prof = sub[r_lo:r_hi].mean(1)
            on = np.nonzero(prof > 0.4)[0]
            v_top = self.v_of(r_lo + on.min()) if len(on) else 2.6
            v_bot = self.v_of(r_lo + on.max()) if len(on) else 0.4
            out.append({"u0": u0, "u1": u1, "v": round(max(0.0, min(v_bot, 1.0)), 2),
                        "top": round(min(v_top, band_top - 0.2), 2)})
        # doors: door labels reaching the ground, or a dark/glass opening that runs from the
        # pavement up past 1.9 m with no bulkhead under it, 0.75-2 m wide
        doors = []
        drk = (self.glassy | (self.lab[..., 0] < wall_lab[0] - 18)) & self.seen
        lo, hi = self.rows(0.05, 0.45), self.rows(1.0, 1.9)
        foot = drk[lo, cs].mean(0)
        body = drk[hi, cs].mean(0)
        hid = self.occ[lo, cs].mean(0) > 0.6
        for a, b in runs((foot > 0.6) & (body > 0.6) & ~hid, min_len=int(0.7 * px), max_gap=2):
            w = (b - a) / px
            if 0.7 <= w <= 2.1:
                doors.append({"u": round(self.u_of(cs.start + a) - 0.5 / px, 2), "w": round(w, 2)})
        dm = np.isin(self.lb, list(S.ids("door", "screen door")))
        drs = self.rows(0.0, 2.3)
        dfrac = dm[drs, cs].mean(0)
        for a, b in runs(dfrac > 0.45, min_len=int(0.6 * px), max_gap=2):
            w = (b - a) / px
            u = self.u_of(cs.start + a) - 0.5 / px
            if w > 2.4 or any(abs(d["u"] + d["w"] / 2 - (u + w / 2)) < 0.8 for d in doors):
                continue
            doors.append({"u": round(self.u_of(cs.start + a) - 0.5 / px, 2), "w": round(max(0.8, w), 2)})
        return {"glass": out, "doors": doors}

    # -- out in the street --------------------------------------------------------------------
    def street_runs(self, plane: str, names: tuple[str, ...], va: float, vb: float, thr: float, min_m: float,
                    gap_m: float) -> list[tuple[float, float, float]]:
        lab = self.planes.get(plane)
        if lab is None:
            return []
        px = self.g.px
        rs, cs = self.rows(va, vb), self.cols(-3.0, self.L + 3.0)
        hit = np.isin(lab[rs, cs], list(S.ids(*names)))
        seen = lab[rs, cs] >= 0
        frac = hit.sum(0) / np.maximum(1, seen.sum(0))
        frac[seen.sum(0) < 0.3 * (rs.stop - rs.start)] = 0
        out = []
        for a, b in runs(frac > thr, min_len=int(min_m * px), max_gap=int(gap_m * px)):
            out.append((round(self.u_of(cs.start + a) - 0.5 / px, 2), round(self.u_of(cs.start + b) - 0.5 / px, 2),
                        float(frac[a:b].mean())))
        return out


def material(img_bgr: np.ndarray) -> tuple[str | None, dict]:
    """The wall's cladding by CLIP zero-shot, with fabric and a smeared photo as their own
    answers: a striped canvas awning is not wood siding of the awning's colour."""
    from .clip import classify
    return classify(img_bgr)
