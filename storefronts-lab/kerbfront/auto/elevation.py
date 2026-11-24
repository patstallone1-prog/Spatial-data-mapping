"""Every frame that sees a wall, squared onto the wall plane, registered and fused.

On the wall plane a camera that is really ``du`` further along the wall, or ``dz`` higher, puts
every point of the plane exactly ``du`` / ``dz`` off -- a pure shift of the rectified image,
whatever the lens. So frames are registered to each other by phase correlation of their
gradient images, and the whole set is pinned in absolute terms by two things the records know:
the wall's ends (LiDAR footprint corners, where the facade changes) and the ground (where
segmented pavement meets the wall, at height 0). Distance errors out from the wall scale the
image about the camera; they are small at street range and are left alone.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from ..photos.rectify import _image, wall_frame
from .camera import Camera, camera_for

PX = 25  # px per metre for registration and reading


@dataclass
class View:
    cam: Camera
    photo: dict
    img: np.ndarray            # rectified BGR (float32 0-255), NaN where unseen
    valid: np.ndarray          # bool
    du: float = 0.0
    dz: float = 0.0
    score: float = 0.0
    labels: np.ndarray | None = None
    meta: dict = field(default_factory=dict)


@dataclass
class Grid:
    a: np.ndarray
    t: np.ndarray
    n: np.ndarray
    L: float
    u0: float
    u1: float
    v0: float
    v1: float
    px: int = PX

    @property
    def shape(self):
        return (int(round((self.v1 - self.v0) * self.px)), int(round((self.u1 - self.u0) * self.px)))

    def us(self):
        return self.u0 + (np.arange(self.shape[1]) + 0.5) / self.px

    def vs(self):
        return self.v1 - (np.arange(self.shape[0]) + 0.5) / self.px

    def col(self, u):
        return int(round((u - self.u0) * self.px))

    def row(self, v):
        return int(round((self.v1 - v) * self.px))


def grid_for(model: dict, edge: int, margin: float = 3.0, top: float | None = None, px: int = PX) -> Grid:
    a, t, n, L = wall_frame(model, edge)
    return Grid(a, t, n, L, -margin, L + margin, -1.0, top if top is not None else model["height_m"] + 3.0, px)


def maps(cam: Camera, shape: tuple[int, int], g: Grid, offset: float = 0.0, du: float = 0.0, dz: float = 0.0):
    """Source-pixel maps (mx, my) of every grid cell, and which cells the frame sees."""
    h, w = shape
    H, W = g.shape
    U, V = np.meshgrid(g.us(), g.vs())
    xy = g.a[None, None, :] + U[..., None] * g.t[None, None, :] + offset * g.n[None, None, :]
    pts = np.stack([xy[..., 0].ravel(), xy[..., 1].ravel(), V.ravel()], axis=1)
    c = cam.moved([du * g.t[0], du * g.t[1], dz])
    mx, my = c.project(pts, w, h)
    side = float(np.dot(c.centre[:2] - g.a - offset * g.n, g.n))
    mx = mx.reshape(H, W).astype(np.float32)
    my = my.reshape(H, W).astype(np.float32)
    bad = ~np.isfinite(mx) | ~np.isfinite(my) | (my < 1) | (my > h - 2) | (side <= 0.3)
    if not cam.spherical:
        bad |= (mx < 1) | (mx > w - 2)
    mx[bad] = -1
    my[bad] = -1
    return mx, my, ~bad


def rectify(cam: Camera, img: np.ndarray, g: Grid, offset: float = 0.0, du: float = 0.0, dz: float = 0.0):
    """The frame on the plane ``offset`` metres out from the wall, as if the camera stood
    ``du`` further along the wall and ``dz`` higher."""
    mx, my, ok = maps(cam, img.shape[:2], g, offset, du, dz)
    out = cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP if cam.spherical else cv2.BORDER_CONSTANT)
    return out.astype(np.float32), ok


def _gray(img: np.ndarray, valid: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
    g = cv2.createCLAHE(2.0, (8, 8)).apply(g)
    g[~valid] = 0
    return g


_SIFT = None


def _features(v: View, g: Grid, band: tuple[float, float]):
    global _SIFT
    if _SIFT is None:
        _SIFT = cv2.SIFT_create(nfeatures=6000)
    mask = cv2.erode(v.valid.astype(np.uint8), np.ones((7, 7), np.uint8))
    mask[:g.row(band[1])] = 0
    mask[g.row(band[0]):] = 0
    return _SIFT.detectAndCompute(_gray(v.img, v.valid), mask * 255)


def _match(ref_f, v_f, win_u: float = 150, win_v: float = 62, k: int = 8) -> tuple[np.ndarray | None, int]:
    """Similarity (scale and shift; rotation is ~0 after the solved rotations) taking the view's
    pixels onto the reference's, and how many features agree with it.

    Both views are already rectified onto the same wall grid, so the solved poses leave only a
    few metres of shift and a modest scale between them. Each feature's ``k`` nearest
    descriptors in the reference vote for a shift at every trial scale (a Hough vote); the
    strongest peak wins and RANSAC refines it from the pairs that voted for it. A ratio test
    is no use here: on a repeating facade (fins, identical windows) every feature has a twin."""
    (k1, d1), (k2, d2) = ref_f, v_f
    if d1 is None or d2 is None or len(k1) < 20 or len(k2) < 20:
        return None, 0
    p1 = np.float32([kp.pt for kp in k1])
    p2 = np.float32([kp.pt for kp in k2])
    mt = cv2.BFMatcher(cv2.NORM_L2).knnMatch(d2, d1, k=k)
    qi = np.array([m.queryIdx for row in mt for m in row])
    ti = np.array([m.trainIdx for row in mt for m in row])
    if len(qi) < 20:
        return None, 0
    A, B = p2[qi], p1[ti]
    keep = (np.abs(B[:, 0] - A[:, 0]) < win_u * 1.6) & (np.abs(B[:, 1] - A[:, 1]) < win_v)
    A, B, qi = A[keep], B[keep], qi[keep]
    best = (0, None, None)
    bin_ = 6.0
    cx = float(np.median(A[:, 0])) if len(A) else 0.0
    cy = float(np.median(A[:, 1])) if len(A) else 0.0
    for sc in np.arange(0.74, 1.38, 0.02):
        # shift of the view's centre: B = sc * (A - c) + c + t
        t = B - (sc * (A - [cx, cy]) + [cx, cy])
        ok = (np.abs(t[:, 0]) < win_u) & (np.abs(t[:, 1]) < win_v)
        if ok.sum() < 12:
            continue
        key = np.floor(t[ok] / bin_).astype(np.int64)
        flat = (key[:, 0] + 1000) * 4000 + (key[:, 1] + 1000)
        # one vote per view feature per bin
        flat_q = np.unique(np.stack([flat, qi[ok]], 1), axis=0)[:, 0]
        vals, cnt = np.unique(flat_q, return_counts=True)
        # a peak spread over neighbouring bins: sum the 3x3 neighbourhood
        d = dict(zip(vals.tolist(), cnt.tolist()))
        for v in vals[np.argsort(cnt)[-5:]]:
            s3 = sum(d.get(v + dx * 4000 + dy, 0) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            if s3 > best[0]:
                best = (s3, sc, ((v // 4000 - 1000 + 0.5) * bin_, (v % 4000 - 1000 + 0.5) * bin_))
    n0, sc, (tx, ty) = best if best[1] is not None else (0, None, (0, 0))
    if sc is None or n0 < 15:
        return None, int(n0)
    pred = sc * (A - [cx, cy]) + [cx, cy] + [tx, ty]
    near = np.linalg.norm(B - pred, axis=1) < 2.2 * bin_
    # one pair per view feature: the nearest to the prediction
    order = np.argsort(np.linalg.norm(B - pred, axis=1))
    seen, idx = set(), []
    for i in order:
        if near[i] and qi[i] not in seen:
            seen.add(qi[i])
            idx.append(i)
    if len(idx) < 12:
        return None, len(idx)
    M, inl = cv2.estimateAffinePartial2D(A[idx], B[idx], method=cv2.RANSAC, ransacReprojThreshold=3.0, maxIters=4000)
    if M is None:
        return None, 0
    n = int(inl.sum())
    s_ = math.hypot(M[0, 0], M[1, 0])
    rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    # the solved poses are rarely more than a few metres out: a bigger jump is a repeat
    c = np.array([cx, cy, 1.0])
    shift = M @ c - c[:2]
    if n < 15 or abs(rot) > 2.0 or not 0.8 < s_ < 1.25 or abs(shift[0]) > 110 or abs(shift[1]) > 50:
        return None, n
    return M, n


def _warp(v: View, M: np.ndarray, shape) -> None:
    H, W = shape
    v.img = cv2.warpAffine(v.img, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
    v.valid = cv2.warpAffine(v.valid.astype(np.uint8), M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0).astype(bool)
    if v.labels is not None:
        v.labels = cv2.warpAffine(v.labels.astype(np.float32), M, (W, H), flags=cv2.INTER_NEAREST,
                                  borderValue=-1).astype(np.int16)
    v.meta["M"] = M if "M" not in v.meta else _compose(M, v.meta["M"])


def _compose(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """A after B, both 2x3."""
    A3 = np.vstack([A, [0, 0, 1]])
    B3 = np.vstack([B, [0, 0, 1]])
    return (A3 @ B3)[:2]


def collect(model: dict, edge: int, photos: list[dict], g: Grid, cam_height: float = 2.0,
            with_labels: bool = False) -> list[View]:
    out = []
    for p in photos:
        cam = camera_for(p, cam_height)
        try:
            img = _image(p["frame_id"], cam.spherical).astype(np.float32)
        except Exception:  # noqa: BLE001
            continue
        r, ok = rectify(cam, img, g)
        if ok[g.row(model["height_m"]):g.row(0), max(0, g.col(0)):g.col(g.L)].mean() < 0.25:
            continue
        v = View(cam, p, r, ok)
        if with_labels:
            from .segment import label_source
            mx, my, ok2 = maps(cam, img.shape[:2], g)
            v.labels, v.meta["lab_src"] = label_source(img, mx, my, ok2, cam.spherical)
            v.meta["src_shape"] = img.shape[:2]
        out.append(v)
    return out


def register(views: list[View], g: Grid, height: float) -> View | None:
    """Warp every view onto the best one (widest view of the wall, then newest), in place;
    a view whose features do not match is left out (score 0). Returns the reference."""
    if not views:
        return None

    def coverage(v: View):
        return float(v.valid[g.row(height):g.row(0), max(0, g.col(0)):g.col(g.L)].mean())
    views.sort(key=lambda v: (round(coverage(v), 1), v.cam.spherical, v.photo.get("captured_at") or ""), reverse=True)
    ref = views[0]
    ref.score = 1.0
    band = (0.2, height + 0.8)
    feats = {id(ref): _features(ref, g, band)}
    todo = views[1:]
    # a view may match a registered view better than it matches the reference (same year,
    # same side of the street); keep going while anything new registers
    while todo:
        progress = False
        for v in list(todo):
            fv = _features(v, g, band)
            best = (None, 0, None)
            for r in [r for r in views if r.score > 0]:
                M, n = _match(feats[id(r)], fv)
                if M is not None and n > best[1]:
                    best = (M, n, r)
            v.meta["inliers"] = best[1]
            if best[0] is None or best[1] < 20:
                continue
            _warp(v, best[0], g.shape)  # features were in v's own frame; r's frame = ref frame
            v.score = min(1.0, best[1] / 200)
            v.meta["via"] = best[2].photo["frame_id"]
            feats[id(v)] = _features(v, g, band)
            todo.remove(v)
            progress = True
        if not progress:
            break
    for v in todo:
        v.score = 0.0
    return ref


def fuse(views: list[View], g: Grid, min_score: float = 0.05) -> tuple[np.ndarray, np.ndarray]:
    use = [v for v in views if v.score >= min_score]
    stack = np.stack([np.where(v.valid[..., None], v.img, np.nan) for v in use])
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            med = np.nanmedian(stack, axis=0)
    seen = np.isfinite(med[..., 0])
    return np.nan_to_num(med, nan=0.0), seen


def _steps(fused: np.ndarray, seen: np.ndarray, g: Grid, top: float) -> np.ndarray:
    """How sharply the facade's appearance changes at each column (Lab colour, upper wall)."""
    lab = cv2.cvtColor(np.clip(fused, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    r0, r1 = g.row(max(3.0, top - 0.3)), g.row(min(2.8, top - 1.0))
    prof = np.full((g.shape[1], 3), np.nan, np.float32)
    for c in range(g.shape[1]):
        ok = seen[r0:r1, c]
        if ok.sum() > 5:
            prof[c] = np.median(lab[r0:r1, c][ok], axis=0)
    k = max(2, int(0.5 * g.px))
    step = np.zeros(g.shape[1], np.float32)
    for c in range(k, g.shape[1] - k):
        l, r = prof[c - k:c], prof[c:c + k]
        if np.isnan(l).any() or np.isnan(r).any():
            continue
        step[c] = float(np.linalg.norm(np.median(l, 0) - np.median(r, 0)))
    return step


def anchor(fused: np.ndarray, seen: np.ndarray, g: Grid, labels: np.ndarray | None, ground_ids: set[int],
           wall_ids: set[int], top: float, search: float = 3.0) -> tuple[np.ndarray, dict]:
    """The similarity (in elevation pixels) that puts the registered set where the records say
    the wall is: its two ends (LiDAR corners, found where the facade's appearance changes) at
    u = 0 and u = L, and the pavement line at height 0. Scale comes from the two ends when both
    are clear, else 1."""
    info: dict = {}
    step = _steps(fused, seen, g, top)

    def best_edge(target: float):
        cands = [(float(step[g.col(target + e)]) - 6.0 * abs(e), e) for e in np.arange(-search, search + 1e-9, 1.0 / g.px)
                 if 0 <= g.col(target + e) < len(step)]
        sc, e = max(cands) if cands else (0.0, 0.0)
        return sc + 6.0 * abs(e), e
    s0, e0 = best_edge(0.0)
    s1, e1 = best_edge(g.L)
    info.update({"end0": [round(e0, 2), round(s0, 1)], "end1": [round(e1, 2), round(s1, 1)]})
    strong = 18.0
    scale, shift_u = 1.0, 0.0
    if s0 >= strong and s1 >= strong and abs(e1 - e0) < 0.12 * g.L:
        scale = float(np.clip(g.L / (g.L + e1 - e0), 0.88, 1.12))
        shift_u = -e0 * scale
    elif s0 >= strong or s1 >= strong:
        shift_u = -(e0 if s0 >= s1 else e1)
    info["scale"] = round(scale, 3)
    # pavement line
    shift_v = 0.0
    if labels is not None:
        rows = []
        vs = g.vs()
        for c in range(max(0, g.col(0.3)), min(g.shape[1], g.col(g.L - 0.3))):
            col = labels[:, c]
            for r in range(g.row(1.8), min(g.shape[0] - 4, g.row(-0.95))):
                if col[r] in wall_ids and col[r + 1] in ground_ids and col[r + 3] in ground_ids:
                    rows.append(vs[r])
                    break
        if len(rows) > 0.12 * (g.col(g.L - 0.3) - g.col(0.3)):
            seen_at = float(np.median(rows))
            info["ground_v"] = round(seen_at, 2)
            info["ground_cols"] = len(rows)
            shift_v = -seen_at
    # as a pixel similarity: u' = scale * u + shift_u ; v' = scale * (v - 2) + 2 + shift_v
    # columns: c = (u - u0) * px ; rows: r = (v1 - v) * px
    px = g.px
    a = scale
    tx = px * (scale * g.u0 + shift_u - g.u0)
    ty = px * (g.v1 - (scale * (g.v1 - 2.0) + 2.0 + shift_v))
    # c' = a c + px(a u0 + shift_u - u0) ; r' = a r + px(v1 - a(v1-2) - 2 - shift_v) (v from rows)
    M = np.array([[a, 0, tx], [0, a, ty]], np.float32)
    info["shift_u"] = round(shift_u, 2)
    info["shift_v"] = round(shift_v, 2)
    return M, info


def labels_on_plane(v: View, g: Grid, offset: float) -> np.ndarray:
    """The view's labels on a plane ``offset`` metres out from the wall (a parklet, a tree
    pit), on the wall's grid, carried through the same registration warps as the wall."""
    from .segment import remap
    mx, my, ok = maps(v.cam, v.meta["src_shape"], g, offset)
    lab = remap(v.meta.get("lab_src"), mx, my, ok)
    if "M" in v.meta:
        H, W = g.shape
        lab = cv2.warpAffine(lab.astype(np.float32), v.meta["M"], (W, H), flags=cv2.INTER_NEAREST,
                             borderValue=-1).astype(np.int16)
    return lab


def apply_all(views: list[View], g: Grid, M: np.ndarray) -> None:
    for v in views:
        if v.score > 0:
            _warp(v, M, g.shape)
