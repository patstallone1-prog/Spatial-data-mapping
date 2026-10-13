"""Several photographs of one house front, reconstructed together.

A fit (smc.facades.fit) reads one photograph rectified onto the house's wall. Everything in the
plane of the wall comes out right in that, and nothing in front of it or behind it does: a single
picture has no depth. A stair running along the front, rising sideways to the door -- San
Francisco is full of them -- is a diagonal smear from the street, and a door at the back of an
alcove is a door in the wall. Two photographs from different places on the pavement are enough
to tell, because whatever stands off the wall moves between them, and how far it moves is how
far off the wall it stands. Depth is all the other photographs are used for.

The house's views are the ones the run filed together (smc.facades.view_store): each a
photograph rectified onto the same wall, with the camera's pose. Here they are

  recognised   the same front, not a neighbour's: each view is registered on the reference
               view (the one the house was fitted from) by its landmarks -- the windows, matched
               by size and spacing, with ORB features on the facade as a fallback -- as a
               small scale and shift on the wall's plane, which also takes up the error in the
               cameras' poses. A view that does not register is left out.
  associated   each window and door followed from view to view: the same object seen in
               several frames.
  kept         the house is rendered from one photograph, the reference -- the best the
               filter found -- and each window and door keeps its size, place and panes from
               it; the others only record that they saw it, and how far they disagree.
  swept        what stands off the wall placed by plane sweep: for each depth in front of the
               wall (or behind it), every other view is re-projected onto the reference as if
               the object stood at that depth, and the depth at which their segmentations agree
               is where it stands. Done for each door (an alcove's depth is how far behind the
               wall its door is) and for each stair flight, band by band up the flight: a flight
               coming straight out from the house is far out at its foot and near the wall at its
               top; one running along the front is the same depth all the way up, and its top
               edge climbs along the wall; one cut into the house is behind the wall at its top.

Depth needs baseline: views less than MIN_BASELINE_DEG apart in angle give none, and the result
says so rather than guessing. It is measured on the canonical wall's prior and the photographs'
resolution, not surveyed.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

SCHEMA = "kerbside.multiview/1"
#: ADE20K class ids (0-based) as the filter's segmentation model writes them (fit, entry_inference).
WALL_CLASSES = (0, 1, 25)
WINDOW_CLASSES = (8,)
DOOR_CLASSES = (14, 58)
STAIR_CLASSES = (53, 59, 121)
RAIL_CLASSES = (38, 95)
#: The metric grid the sweeps are done on.
GRID_PPM = 20.0
#: Depths tried, metres out from the wall (negative: behind it).
DEPTHS = np.round(np.arange(-2.5, 6.0001, 0.1), 2)
#: Views closer than this in angle to the wall see nothing move.
MIN_BASELINE_DEG = 10.0
#: A depth is believed when the best agreement beats the typical one by this much.
SWEEP_MARGIN = 0.06
SWEEP_FLOOR = 0.2
#: A registration's limits: the views are of one wall, rectified onto it, so they differ by
#: the error in the poses -- a little scale, a shift of a metre or two -- and nothing more.
SCALE_RANGE = (0.85, 1.18)
MAX_SHIFT_M = 2.5
#: Stair geometry believed (entry_inference uses the same).
STEP_RISE_M = 0.18
STAIR_WIDTH_M = (0.8, 2.2)


@dataclass
class View:
    key: str
    image: np.ndarray
    labels: np.ndarray
    width_m: float
    height_m: float
    cu: float          # the camera along the wall from its left end (metres)
    cn: float          # the camera's distance out from the wall
    cv: float          # the camera's height above the wall's foot
    weight: float      # how good a look it is: pixels per metre, squared cosine of the angle
    meta: dict = field(default_factory=dict)

    @property
    def ppm_x(self) -> float:
        return self.labels.shape[1] / self.width_m

    @property
    def ppm_y(self) -> float:
        return self.labels.shape[0] / self.height_m

    @property
    def angle_deg(self) -> float:
        """Signed: positive with the camera off to the right of the wall's middle."""
        return math.degrees(math.atan2(self.cu - self.width_m / 2, max(self.cn, 1e-6)))

    def mask(self, classes) -> np.ndarray:
        return np.isin(self.labels, classes).astype(np.uint8)


@dataclass
class Registration:
    """View-observed wall coordinates to the reference's: x_ref = scale * x + shift."""

    scale: float = 1.0
    tx: float = 0.0
    ty: float = 0.0
    method: str = "reference"
    inliers: int = 0
    residual_m: float = 0.0

    def forward(self, u, v):
        return self.scale * u + self.tx, self.scale * v + self.ty

    def inverse(self, u, v):
        return (u - self.tx) / self.scale, (v - self.ty) / self.scale

    def as_dict(self) -> dict:
        return {"scale": round(self.scale, 4), "shift_m": [round(self.tx, 3), round(self.ty, 3)],
                "method": self.method, "inliers": self.inliers, "residual_m": round(self.residual_m, 3)}


# ---- views ------------------------------------------------------------------------------------

def camera_in_wall(camera: dict, wall: dict) -> tuple[float, float, float]:
    ax, ay = wall["a"]
    bx, by = wall["b"]
    length = math.hypot(bx - ax, by - ay)
    tx, ty = (bx - ax) / length, (by - ay) / length
    nx, ny = wall["normal"]
    dx, dy = camera["x"] - ax, camera["y"] - ay
    return dx * tx + dy * ty, dx * nx + dy * ny, float(camera.get("z") or 2.4)


def same_wall(a: dict, b: dict, tolerance_m: float = 0.75) -> bool:
    return all(math.dist(a[k], b[k]) <= tolerance_m for k in ("a", "b"))


def load_views(folder: Path, manifest: dict | None = None) -> list[View]:
    """The house's filed views (view_store), each with its pixels, labels and camera."""
    if manifest is None:
        manifest = json.loads((folder / "manifest.json").read_text())
    views = []
    for record in manifest.get("views", []):
        files, camera, wall = record.get("files") or {}, record.get("camera"), record.get("wall")
        if not camera or not wall or "jpg" not in files or "labels.png" not in files:
            continue
        image = cv2.imread(str(folder / files["jpg"]))
        labels = cv2.imread(str(folder / files["labels.png"]), cv2.IMREAD_GRAYSCALE)
        if image is None or labels is None or image.shape[:2] != labels.shape:
            continue
        width = math.dist(wall["a"], wall["b"])
        if width < 1 or not wall.get("height_m"):
            continue
        cu, cn, cv = camera_in_wall(camera, wall)
        if cn < 2:
            continue
        ppm = labels.shape[1] / width
        cosine = cn / math.hypot(cu - width / 2, cn)
        views.append(View(record["key"], image, labels, width, float(wall["height_m"]), cu, cn, cv,
                          ppm * cosine * cosine, {"wall": wall, "observation_uid": record.get("observation_uid"),
                                                  "captured_at": record.get("captured_at")}))
    return views


# ---- landmarks and registration ---------------------------------------------------------------

def boxes(view: View, classes, kind: str, min_w: float = 0.25, min_h: float = 0.35) -> list[dict]:
    """Connected regions of a class as boxes on the wall (u from the left end, v up from the foot)."""
    binary = view.mask(classes)
    count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    h_px, w_px = binary.shape
    out = []
    for x, y, w, h, area in stats[1:count]:
        if w / view.ppm_x < min_w or h / view.ppm_y < min_h or area / max(1, w * h) < 0.35:
            continue
        out.append({"kind": kind, "u": x / view.ppm_x, "w": w / view.ppm_x,
                    "v": (h_px - y - h) / view.ppm_y, "h": h / view.ppm_y,
                    "cut": bool(x <= 1 or y <= 1 or x + w >= w_px - 1 or y + h >= h_px - 1)})
    return out


def _centre(box: dict) -> tuple[float, float]:
    return box["u"] + box["w"] / 2, box["v"] + box["h"] / 2


def _compatible(a: dict, b: dict) -> bool:
    return (abs(a["w"] - b["w"]) <= 0.35 * max(a["w"], b["w"]) + 0.1
            and abs(a["h"] - b["h"]) <= 0.35 * max(a["h"], b["h"]) + 0.1)


def register_by_windows(ref_windows: list[dict], view_windows: list[dict]) -> Registration | None:
    """The shift (then scale) that lays the view's windows on the reference's.

    Every pairing of a reference window with a like-sized window of the view proposes a shift;
    the one most windows agree with, refined by least squares over the pairs that agree, is the
    registration. Two windows agreeing is enough where there are only two or three to agree.
    """
    if not ref_windows or not view_windows:
        return None
    best = None
    for a in ref_windows:
        for b in view_windows:
            if not _compatible(a, b):
                continue
            (ua, va), (ub, vb) = _centre(a), _centre(b)
            tx, ty = ua - ub, va - vb
            if math.hypot(tx, ty) > MAX_SHIFT_M:
                continue
            pairs, error = [], 0.0
            for r in ref_windows:
                ur, vr = _centre(r)
                options = [(math.hypot(_centre(o)[0] + tx - ur, _centre(o)[1] + ty - vr), o)
                           for o in view_windows if _compatible(r, o)]
                if not options:
                    continue
                distance, other = min(options, key=lambda item: item[0])
                if distance <= 0.35:
                    pairs.append((r, other))
                    error += distance
            key = (len(pairs), -error)
            if best is None or key > best[0]:
                best = (key, pairs)
    if best is None:
        return None
    pairs = best[1]
    enough = len(pairs) >= 3 or (len(pairs) >= 2 and len(pairs) >= 0.6 * min(len(ref_windows), len(view_windows)))
    if not enough:
        return None
    # Least squares scale and shift over the agreeing pairs (centres and corners).
    src, dst = [], []
    for r, o in pairs:
        for fu, fv in ((0.5, 0.5), (0, 0), (1, 1)):
            src.append((o["u"] + fu * o["w"], o["v"] + fv * o["h"]))
            dst.append((r["u"] + fu * r["w"], r["v"] + fv * r["h"]))
    src, dst = np.asarray(src), np.asarray(dst)
    ms, md = src.mean(axis=0), dst.mean(axis=0)
    spread = ((src - ms) ** 2).sum()
    scale = float(((src - ms) * (dst - md)).sum() / spread) if spread > 1e-6 else 1.0
    if not SCALE_RANGE[0] <= scale <= SCALE_RANGE[1]:
        scale = 1.0
    shift = md - scale * ms
    residual = float(np.sqrt((((scale * src + shift) - dst) ** 2).sum(axis=1)).mean())
    if math.hypot(*shift) > MAX_SHIFT_M * 1.5:
        return None
    return Registration(scale, float(shift[0]), float(shift[1]), "window_landmarks", len(pairs), residual)


def _metric_grey(view: View, ppm: float) -> tuple[np.ndarray, np.ndarray]:
    size = (max(8, round(view.width_m * ppm)), max(8, round(view.height_m * ppm)))
    grey = cv2.resize(cv2.cvtColor(view.image, cv2.COLOR_BGR2GRAY), size, interpolation=cv2.INTER_AREA)
    labels = cv2.resize(view.labels, size, interpolation=cv2.INTER_NEAREST)
    keep = np.isin(labels, WALL_CLASSES + WINDOW_CLASSES + DOOR_CLASSES).astype(np.uint8) * 255
    return grey, keep


def register_by_features(ref: View, view: View, ppm: float = 40.0) -> Registration | None:
    """ORB features on the facade (wall, windows, doors only), a RANSAC similarity."""
    grey_r, keep_r = _metric_grey(ref, ppm)
    grey_v, keep_v = _metric_grey(view, ppm)
    orb = cv2.ORB_create(1500)
    kr, dr = orb.detectAndCompute(grey_r, keep_r)
    kv, dv = orb.detectAndCompute(grey_v, keep_v)
    if dr is None or dv is None or len(kr) < 12 or len(kv) < 12:
        return None
    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(dv, dr, k=2)
    good = [m for m, *rest in matches if rest and m.distance < 0.8 * rest[0].distance]
    if len(good) < 15:
        return None
    hr = grey_r.shape[0] / ppm
    hv = grey_v.shape[0] / ppm
    src = np.float32([(kv[m.queryIdx].pt[0] / ppm, hv - kv[m.queryIdx].pt[1] / ppm) for m in good])
    dst = np.float32([(kr[m.trainIdx].pt[0] / ppm, hr - kr[m.trainIdx].pt[1] / ppm) for m in good])
    matrix, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=0.15)
    if matrix is None or inliers is None:
        return None
    count = int(inliers.sum())
    scale = math.hypot(matrix[0, 0], matrix[1, 0])
    rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    if (count < 15 or count < 0.3 * len(good) or not SCALE_RANGE[0] <= scale <= SCALE_RANGE[1]
            or abs(rotation) > 4 or math.hypot(matrix[0, 2], matrix[1, 2]) > MAX_SHIFT_M):
        return None
    mapped = src @ matrix[:, :2].T + matrix[:, 2]
    residual = float(np.linalg.norm(mapped - dst, axis=1)[inliers.ravel() > 0].mean())
    return Registration(scale, float(matrix[0, 2]), float(matrix[1, 2]), "facade_features", count, residual)


def register(ref: View, view: View) -> Registration | None:
    windows = register_by_windows(boxes(ref, WINDOW_CLASSES, "window"), boxes(view, WINDOW_CLASSES, "window"))
    if windows and windows.inliers >= 3:
        return windows
    return register_by_features(ref, view) or windows


# ---- association: the same object in several frames ------------------------------------------

def _iou(a: dict, b: dict) -> float:
    w = max(0.0, min(a["u"] + a["w"], b["u"] + b["w"]) - max(a["u"], b["u"]))
    h = max(0.0, min(a["v"] + a["h"], b["v"] + b["h"]) - max(a["v"], b["v"]))
    inter = w * h
    return inter / max(1e-9, a["w"] * a["h"] + b["w"] * b["h"] - inter)


def _to_reference(box: dict, reg: Registration) -> dict:
    u, v = reg.forward(box["u"], box["v"])
    return {**box, "u": u, "v": v, "w": box["w"] * reg.scale, "h": box["h"] * reg.scale}


def associate(ref: View, views: list[View], regs: list[Registration]) -> list[dict]:
    """Each window and door of the reference, followed into every registered view.

    Its dimensions are the weighted mean over the views that see it whole (a view's weight is
    its pixels per metre and squared cosine), and it is read from the one that sees it best.
    """
    objects = []
    per_view = []
    for view, reg in zip(views, regs, strict=False):
        found = boxes(view, WINDOW_CLASSES, "window") + boxes(view, DOOR_CLASSES, "door", min_w=0.5, min_h=1.2)
        per_view.append([_to_reference(b, reg) for b in found])
    reference = boxes(ref, WINDOW_CLASSES, "window") + boxes(ref, DOOR_CLASSES, "door", min_w=0.5, min_h=1.2)
    for index, box in enumerate(reference):
        sightings = [(ref, box)]
        for view, found in zip(views, per_view, strict=False):
            options = [(_iou(box, other), other) for other in found if other["kind"] == box["kind"]]
            if options:
                overlap, other = max(options, key=lambda item: item[0])
                if overlap >= 0.3:
                    sightings.append((view, other))
        whole = [(v, b) for v, b in sightings if not b["cut"]] or sightings
        weights = np.asarray([v.weight for v, _ in whole])
        fused = {k: float(np.average([b[k] for _, b in whole], weights=weights)) for k in ("u", "v", "w", "h")}
        spread = max(float(np.sqrt(np.average([(b[k] - fused[k]) ** 2 for _, b in whole], weights=weights)))
                     for k in ("u", "v", "w", "h"))
        best_view, _ = max(whole, key=lambda item: item[0].weight)
        objects.append({"kind": box["kind"], "reference_box": {k: round(box[k], 3) for k in ("u", "v", "w", "h")},
                        **{k: round(fused[k], 3) for k in fused}, "spread_m": round(spread, 3),
                        "views": len(sightings), "whole_views": len(whole), "best_view": best_view.key,
                        "index": index})
    return objects


def _metric_patch(view: View, u: float, v: float, w: float, h: float, ppm: float) -> np.ndarray | None:
    """The view's grey pixels over a box on the wall, resampled to ``ppm``."""
    x0, x1 = round(u * view.ppm_x), round((u + w) * view.ppm_x)
    y0, y1 = round((view.height_m - v - h) * view.ppm_y), round((view.height_m - v) * view.ppm_y)
    if x0 < 0 or y0 < 0 or x1 > view.image.shape[1] or y1 > view.image.shape[0] or x1 - x0 < 4 or y1 - y0 < 4:
        return None
    grey = cv2.cvtColor(view.image[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    size = (max(4, round(w * ppm)), max(4, round(h * ppm)))
    return cv2.resize(grey, size, interpolation=cv2.INTER_AREA)


#: How far from where the registration puts it an opening is looked for, and at what scales.
TRACK_REACH_M = 0.4
TRACK_SCALES = (0.9, 1.0, 1.1)
TRACK_MIN_NCC = 0.55


def track_openings(ref: View, views: list[View], regs: list[Registration], openings: list[dict],
                   ppm: float = 40.0) -> list[dict]:
    """The fit's windows and doors followed into the other views.

    The reference's own pixels of each opening are looked for in each registered view, near
    where the registration puts them, at a few widths and heights (normalised cross-correlation):
    where one matches, that view saw it, and where, and how big. Its dimensions are then the
    weighted mean over the views that saw it, and it is read from the one that sees it best.
    """
    out = []
    margin = 0.1
    for opening in openings:
        if opening.get("kind") not in {"window", "door"} or not all(
                isinstance(opening.get(k), (int, float)) for k in ("u", "v", "w", "h")):
            continue
        u, v, w, h = (float(opening[k]) for k in ("u", "v", "w", "h"))
        template = _metric_patch(ref, u - margin, v - margin, w + 2 * margin, h + 2 * margin, ppm)
        if template is None or float(template.std()) < 6:
            continue
        sightings = [(ref, {"u": u, "v": v, "w": w, "h": h, "ncc": 1.0})]
        for view, reg in zip(views, regs, strict=False):
            pu, pv = reg.inverse(u, v)
            pw, ph = w / reg.scale, h / reg.scale
            search = _metric_patch(view, pu - margin - TRACK_REACH_M, pv - margin - TRACK_REACH_M,
                                   pw + 2 * (margin + TRACK_REACH_M), ph + 2 * (margin + TRACK_REACH_M), ppm)
            if search is None:
                continue
            best = None
            for sw in TRACK_SCALES:
                for sh in TRACK_SCALES:
                    size = (max(4, round((pw * sw + 2 * margin) * ppm)), max(4, round((ph * sh + 2 * margin) * ppm)))
                    if size[0] >= search.shape[1] or size[1] >= search.shape[0]:
                        continue
                    scores = cv2.matchTemplate(search, cv2.resize(template, size), cv2.TM_CCOEFF_NORMED)
                    _, peak, _, (x, y) = cv2.minMaxLoc(scores)
                    if best is None or peak > best[0]:
                        best = (peak, x, y, sw, sh, size)
            if best is None or best[0] < TRACK_MIN_NCC:
                continue
            peak, x, y, sw, sh, size = best
            # Back to the view's wall coordinates, then onto the reference's.
            left = pu - margin - TRACK_REACH_M + x / ppm + margin
            top = (pv + ph + margin + TRACK_REACH_M) - y / ppm - margin
            found_w, found_h = pw * sw, ph * sh
            ru, rv = reg.forward(left, top - found_h)
            sightings.append((view, {"u": ru, "v": rv, "w": found_w * reg.scale, "h": found_h * reg.scale,
                                     "ncc": float(peak)}))
        weights = np.asarray([vw.weight * b["ncc"] for vw, b in sightings])
        fused = {k: float(np.average([b[k] for _, b in sightings], weights=weights)) for k in ("u", "v", "w", "h")}
        spread = max(float(np.sqrt(np.average([(b[k] - fused[k]) ** 2 for _, b in sightings], weights=weights)))
                     for k in ("u", "v", "w", "h"))
        best_view = max(sightings, key=lambda item: item[0].weight * item[1]["ncc"])[0]
        out.append({"kind": opening["kind"], "opening_id": opening.get("id"),
                    "reference_box": {"u": u, "v": v, "w": w, "h": h},
                    **{k: round(fused[k], 3) for k in fused}, "spread_m": round(spread, 3),
                    "views": len(sightings), "whole_views": len(sightings), "best_view": best_view.key,
                    "basis": "template_tracked_from_fit"})
    return out


# ---- plane sweep -------------------------------------------------------------------------------

def _sample(view: View, mask: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """The mask at wall coordinates; 2 where the coordinates fall off the photograph."""
    cols = (u * view.ppm_x).astype(np.float32)
    rows = ((view.height_m - v) * view.ppm_y).astype(np.float32)
    return cv2.remap(mask, cols, rows, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=2)


def reproject(ref: View, view: View, reg: Registration, u: np.ndarray, v: np.ndarray, depth: float):
    """Where a point the reference sees at (u, v) on the wall, standing ``depth`` out from it,
    falls in the other view's rectified photograph (in that view's own wall coordinates)."""
    sr = ref.cn / (ref.cn - depth)
    sk = view.cn / (view.cn - depth)
    pu = ref.cu + (u - ref.cu) / sr
    pv = ref.cv + (v - ref.cv) / sr
    return reg.inverse(view.cu + (pu - view.cu) * sk, view.cv + (pv - view.cv) * sk)


def _normalised(view: View) -> np.ndarray:
    """The photograph's local texture: grey less its local mean, over its local spread (about
    15 cm round each pixel). Its product with another view's, warped onto it, is a local
    normalised cross-correlation -- what plane sweep matches on where there is texture."""
    if "normalised" not in view.meta:
        grey = cv2.cvtColor(view.image, cv2.COLOR_BGR2GRAY).astype(np.float32)
        sigma = max(1.0, 0.15 * view.ppm_x)
        mean = cv2.GaussianBlur(grey, (0, 0), sigma)
        spread = np.sqrt(np.maximum(cv2.GaussianBlur(grey * grey, (0, 0), sigma) - mean * mean, 0)) + 4.0
        view.meta["normalised"] = (grey - mean) / spread
    return view.meta["normalised"]


def _vertical_edges(mask: np.ndarray) -> np.ndarray:
    """Where a mask starts or stops along a row: the edges horizontal parallax moves."""
    edges = np.zeros(mask.shape, np.uint8)
    edges[:, 1:] = mask[:, 1:] != mask[:, :-1]
    return edges


def sweep(ref: View, views: list[View], regs: list[Registration], classes, roi: tuple[float, float, float, float],
          depths: np.ndarray = DEPTHS) -> dict | None:
    """Agreement between the reference and the other views at each depth, row by row of the
    region (u0, u1, v0, v1), two ways: the class's area (overlap over union) and its edges -- the
    share of the reference's left and right edges that land on one of the other view's. Area
    alone cannot place a surface that runs back from the wall (a flight's side overlaps itself
    at every depth); its edges can. None without a view of enough baseline."""
    u0, u1, v0, v1 = roi
    u0, u1 = max(0.0, u0), min(ref.width_m, u1)
    v0, v1 = max(0.0, v0), min(ref.height_m, v1)
    if u1 - u0 < 0.3 or v1 - v0 < 0.3:
        return None
    usable = [(v, r) for v, r in zip(views, regs, strict=False) if abs(v.angle_deg - ref.angle_deg) >= MIN_BASELINE_DEG]
    if not usable:
        return None
    us = np.arange(u0, u1, 1 / GRID_PPM, dtype=np.float32)
    vs = np.arange(v1, v0, -1 / GRID_PPM, dtype=np.float32)
    grid_u, grid_v = np.meshgrid(us, vs)
    # No classes: the whole region, matched on texture alone (a door the segmentation does not
    # label, but the fit's detector found).
    everything = classes is None
    ref_mask = np.ones(grid_u.shape, bool) if everything else _sample(ref, ref.mask(classes), grid_u, grid_v) == 1
    if ref_mask.sum() < 20:
        return None
    ref_edges = _vertical_edges(ref_mask.astype(np.uint8)) == 1
    ref_texture = cv2.remap(_normalised(ref), (grid_u * ref.ppm_x).astype(np.float32),
                            ((ref.height_m - grid_v) * ref.ppm_y).astype(np.float32), cv2.INTER_LINEAR)
    shape = (len(depths), len(vs))
    inter, union, edge_hit, edge_all, texture, texture_n = (np.zeros(shape) for _ in range(6))
    for view, reg in usable:
        mask = np.ones(view.labels.shape, np.uint8) if everything else view.mask(classes)
        normalised = _normalised(view)
        far = cv2.distanceTransform((1 - _vertical_edges(mask)).astype(np.uint8), cv2.DIST_L2, 3)
        tolerance = 0.08 * view.ppm_x
        weight = abs(view.angle_deg - ref.angle_deg) / 30.0
        for i, depth in enumerate(depths):
            if min(ref.cn, view.cn) - depth < 1.0:
                continue
            ku, kv = reproject(ref, view, reg, grid_u, grid_v, float(depth))
            other = _sample(view, mask, ku, kv)
            seen = other != 2
            hit = other == 1
            inter[i] += weight * (ref_mask & hit & seen).sum(axis=1)
            union[i] += weight * ((ref_mask | hit) & seen).sum(axis=1)
            cols = (ku * view.ppm_x).astype(np.float32)
            rows = ((view.height_m - kv) * view.ppm_y).astype(np.float32)
            distance = cv2.remap(far, cols, rows, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=1e6)
            edge_hit[i] += weight * (ref_edges & seen & (distance <= tolerance)).sum(axis=1)
            edge_all[i] += weight * (ref_edges & seen).sum(axis=1)
            warped = cv2.remap(normalised, cols, rows, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            both = ref_mask & seen & hit
            texture[i] += weight * np.where(both, np.clip(ref_texture * warped, -3, 3), 0).sum(axis=1)
            texture_n[i] += weight * both.sum(axis=1)
    return {"depths": depths, "rows_v": vs, "inter": inter, "union": union, "edge_hit": edge_hit,
            "edge_all": edge_all, "texture": texture, "texture_n": texture_n,
            "texture_strength": float(np.abs(ref_texture[ref_mask]).mean()),
            "baseline_deg": max(abs(v.angle_deg - ref.angle_deg) for v, _ in usable), "views": len(usable)}


#: Below this mean local contrast the photograph has no texture to match on.
TEXTURE_MIN = 0.35
#: A local correlation believed: real photographs, a few pixels per centimetre, compressed.
TEXTURE_FLOOR = 0.24
TEXTURE_MARGIN = 0.12


def best_depth(result: dict, rows: slice | np.ndarray | None = None, measure: str = "auto") -> dict | None:
    """The depth the views agree best at, over the given rows; None where nothing stands out.

    ``measure``: "texture" (the photographs' local correlation), "area" (the segmentation's
    overlap over union), "edges" (its edges landing on edges), "mixed" (area and edges) or
    "auto": texture where the photograph has it, mixed where it has not.
    """
    if result is None:
        return None
    pick = (lambda a: a[:, rows]) if rows is not None else (lambda a: a)
    if measure == "auto":
        measure = "texture" if result.get("texture_strength", 0) >= TEXTURE_MIN else "mixed"
        if measure == "texture":
            found = best_depth(result, rows, "texture")
            return found if found else best_depth(result, rows, "mixed")
    area = pick(result["inter"]).sum(axis=1) / np.maximum(pick(result["union"]).sum(axis=1), 1e-9)
    edges = pick(result["edge_hit"]).sum(axis=1) / np.maximum(pick(result["edge_all"]).sum(axis=1), 1e-9)
    floor, margin = SWEEP_FLOOR, SWEEP_MARGIN
    if measure == "texture":
        counts = pick(result["texture_n"]).sum(axis=1)
        score = np.where(counts >= 15, pick(result["texture"]).sum(axis=1) / np.maximum(counts, 1e-9), -1.0)
        floor, margin = TEXTURE_FLOOR, TEXTURE_MARGIN
    elif measure == "area" or pick(result["edge_all"]).sum() < 5:
        score = area
    elif measure == "edges":
        score = edges
    else:
        score = 0.35 * area + 0.65 * edges
    i = int(np.argmax(score))
    typical = float(np.median(score))
    if score[i] < floor or score[i] - typical < margin:
        return None
    if i < 2 or i > len(score) - 3:
        # At the end of the depths tried: what agrees is beyond them -- the street, a parked car
        # -- not the thing looked for.
        return None
    # Sub-step: a parabola through the peak and its neighbours.
    depth = float(result["depths"][i])
    if 0 < i < len(score) - 1:
        a, b, c = score[i - 1], score[i], score[i + 1]
        bend = a - 2 * b + c
        if bend < 0:
            depth += 0.5 * (a - c) / bend * float(result["depths"][1] - result["depths"][0])
    return {"depth_m": round(depth, 3), "agreement": round(float(score[i]), 3),
            "margin": round(float(score[i] - typical), 3), "measure": measure}


# ---- stairs and alcoves -----------------------------------------------------------------------

def stair_flights(view: View) -> list[dict]:
    """Connected flights (stair pixels and the railings touching them), as boxes on the wall."""
    stairs = view.mask(STAIR_CLASSES)
    rails = view.mask(RAIL_CLASSES)
    flight = np.maximum(stairs, rails & cv2.dilate(stairs, np.ones((3, 3), np.uint8)))
    count, components, stats, _ = cv2.connectedComponentsWithStats(flight, 8)
    out = []
    h_px = flight.shape[0]
    for index, (x, y, w, h, area) in enumerate(stats[1:count], start=1):
        if area / (view.ppm_x * view.ppm_y) < 0.25:
            continue
        out.append({"u": x / view.ppm_x, "w": w / view.ppm_x, "v": (h_px - y - h) / view.ppm_y,
                    "top": (h_px - y) / view.ppm_y, "component": components == index})
    return out


def top_edge(view: View, flight: dict) -> dict:
    """The flight's top edge along the wall: its slope (rise per metre along) and how straight."""
    component = flight["component"]
    columns = np.flatnonzero(component.any(axis=0))
    if len(columns) < 6:
        return {"slope": 0.0, "r2": 0.0, "span_m": 0.0}
    tops = np.asarray([component.shape[0] - np.argmax(component[:, c]) for c in columns]) / view.ppm_y
    us = columns / view.ppm_x
    slope, intercept = np.polyfit(us, tops, 1)
    # Only the climb: a landing at the top is level, and counted in it would flatten the slope
    # and lengthen the run by the landing's length.
    level = tops >= tops.max() - 0.12
    if slope > 0 and level.any():
        end = int(np.argmax(level)) + 1
        keep = slice(0, end)
    elif slope < 0 and level.any():
        start = len(level) - int(np.argmax(level[::-1])) - 1
        keep = slice(start, len(level))
    else:
        keep = slice(0, len(level))
    if us[keep].size >= 6 and np.ptp(us[keep]) > 0.5:
        us, tops = us[keep], tops[keep]
        slope, intercept = np.polyfit(us, tops, 1)
    fitted = slope * us + intercept
    total = ((tops - tops.mean()) ** 2).sum()
    r2 = 1 - ((tops - fitted) ** 2).sum() / total if total > 1e-9 else 0.0
    low, high = (us[0], us[-1]) if slope > 0 else (us[-1], us[0])
    if abs(slope) > 0.2:
        # The lowest steps barely show over the pavement: the foot is where the climb meets it.
        foot = -intercept / slope
        if abs(foot - low) <= 1.5:
            low = foot
    return {"slope": round(float(slope), 3), "r2": round(float(r2), 3), "span_m": round(float(us[-1] - us[0]), 3),
            "low_u": round(float(low), 3), "high_u": round(float(high), 3),
            "low_v": round(float(slope * low + intercept), 3), "high_v": round(float(slope * high + intercept), 3)}


def stair_shape(ref: View, views: list[View], regs: list[Registration], flight: dict, band_m: float = 0.3) -> dict:
    """Which way a flight runs, and how big it is, from its depth band by band up the flight."""
    edge = top_edge(ref, flight)
    roi = (flight["u"] - 1.5, flight["u"] + flight["w"] + 1.5, 0.0, flight["top"] + 0.3)
    result = sweep(ref, views, regs, STAIR_CLASSES + RAIL_CLASSES, roi)
    shape = {"u": round(flight["u"], 3), "w": round(flight["w"], 3), "top_m": round(flight["top"], 3),
             "top_edge": edge, "orientation": "unresolved", "basis": "multiview_plane_sweep"}
    if result is None:
        shape["reason"] = "no_view_with_baseline"
        return shape
    shape["baseline_deg"] = round(result["baseline_deg"], 1)
    bands = []
    rows_v = result["rows_v"]
    for lo in np.arange(0.0, flight["top"], band_m):
        rows = np.flatnonzero((rows_v >= lo) & (rows_v < lo + band_m))
        if not len(rows):
            continue
        found = best_depth(result, rows)
        if found:
            bands.append({"v": round(float(lo + band_m / 2), 2), **found})
    shape["bands"] = bands
    overall = best_depth(result)
    if overall:
        shape["depth_m"] = overall["depth_m"]
    if len(bands) < 3:
        shape["reason"] = "too_few_resolved_bands"
        return shape
    d = np.asarray([b["depth_m"] for b in bands])
    # Each band's true height: the reference sees it at v on the wall, standing d out from it.
    v = np.asarray([ref.cv + (b["v"] - ref.cv) * (ref.cn - b["depth_m"]) / ref.cn for b in bands])
    # Theil-Sen: the median of the slopes between every two bands, so one band that caught the
    # door or a railing does not tip the line.
    slopes = [(d[j] - d[i]) / (v[j] - v[i]) for i in range(len(v)) for j in range(i + 1, len(v)) if abs(v[j] - v[i]) > 0.1]
    slope = float(np.median(slopes)) if slopes else 0.0
    foot = float(np.median(d - slope * v))
    shape["depth_per_rise"] = round(slope, 3)
    diagonal = 0.3 <= abs(edge["slope"]) <= 1.6 and edge["r2"] >= 0.5 and edge["span_m"] >= 1.2
    by_area = sum(b.get("measure") == "area" for b in bands) > len(bands) / 2
    deepest = float(d.min())
    if slope <= -0.5 and foot >= 1.2:
        # Out from the house: far at its foot, at the wall at its top -- or in an entry recess
        # behind it (a negative landing depth: the arched porch of a Victorian).
        shape.update({"orientation": "perpendicular", "run_m": round(min(8.0, foot), 2),
                      "landing_depth_m": round(max(-2.5, deepest), 2)})
    elif slope <= -0.5 and deepest <= -0.6:
        # Into the house: a flight cut into the front, its top (and the door) behind the wall.
        shape.update({"orientation": "recessed", "depth_m": round(min(4.0, -deepest), 2),
                      "starts_out_m": round(max(0.0, foot), 2)})
    elif abs(slope) <= 0.45 and diagonal and 0.2 <= float(np.median(d)) <= 2.4:
        # Along the front: the same depth all the way up, and its top climbing along the wall.
        # Texture places the flight's outer side, which is its width; the segmentation's area,
        # its middle, which is half.
        width = float(np.clip(2 * np.median(d) if by_area else np.percentile(d, 80), *STAIR_WIDTH_M))
        # Its top edge is the flight's inner edge, at the wall, where the camera looks down on the
        # treads; up past the camera's height, it is the outer edge, a width out.
        edge_depth = width if edge["high_v"] > ref.cv + 0.3 else 0.0
        scale = ref.cn / (ref.cn - edge_depth)
        low = ref.cu + (edge["low_u"] - ref.cu) / scale
        high = ref.cu + (edge["high_u"] - ref.cu) / scale
        shape.update({"orientation": "sideways", "rises_toward": 1 if edge["slope"] > 0 else -1,
                      "width_m": round(width, 2), "foot_u": round(low, 3), "top_u": round(high, 3),
                      "run_m": round(abs(high - low), 2), "rise_m": round(max(edge["high_v"], flight["top"]), 2)})
    else:
        shape["reason"] = "depth_profile_ambiguous"
    return shape


def door_depth(ref: View, views: list[View], regs: list[Registration], door: dict, labelled: bool = True) -> dict | None:
    """How far a door stands behind (negative) or in front of the wall: on its segmentation where
    the model labelled it, else on the photographs' texture over its rectangle."""
    if labelled:
        roi = (door["u"] - 0.3, door["u"] + door["w"] + 0.3, door["v"], door["v"] + door["h"])
        return best_depth(sweep(ref, views, regs, DOOR_CLASSES, roi))
    inset = 0.1
    roi = (door["u"] + inset, door["u"] + door["w"] - inset, door["v"] + inset, door["v"] + door["h"] - inset)
    return best_depth(sweep(ref, views, regs, None, roi), measure="texture")


#: A front door stands no further behind its wall than an entry hall's depth, and in front of it
#: only by its frame. Outside this the sweep has locked onto something else -- a car, a gate.
DOOR_DEPTH_RANGE_M = (-2.5, 0.4)


# ---- the house --------------------------------------------------------------------------------

def reconstruct(views: list[View], reference_key: str | None = None, openings: list[dict] | None = None) -> dict:
    """The house from all its views: registration, objects, stairs and doors in depth.

    ``openings``: the fit's windows and doors (in the reference view's wall coordinates), which
    are followed into the other views; without them, what the segmentation labels."""
    if not views:
        return {"schema": SCHEMA, "status": "no_views"}
    ref = next((v for v in views if v.key == reference_key), None) or max(views, key=lambda v: v.weight)
    others, regs, rejected = [], [], []
    for view in views:
        if view is ref:
            continue
        if not same_wall(view.meta["wall"], ref.meta["wall"]):
            rejected.append({"view": view.key, "reason": "different_wall"})
            continue
        reg = register(ref, view)
        if reg is None:
            rejected.append({"view": view.key, "reason": "not_recognised_as_the_same_front"})
            continue
        others.append(view)
        regs.append(reg)
    result = {
        "schema": SCHEMA, "reference_view": ref.key, "views_filed": len(views),
        "views_registered": len(others) + 1,
        "registrations": [{"view": v.key, "angle_deg": round(v.angle_deg, 1), **r.as_dict()}
                          for v, r in zip(others, regs, strict=False)],
        "rejected_views": rejected, "reference_angle_deg": round(ref.angle_deg, 1),
        "certainty": "registered on the canonical wall; depths by plane sweep on its prior, not surveyed",
    }
    if not others:
        result["status"] = "single_view"
        return result
    result["status"] = "multiview"
    result["max_baseline_deg"] = round(max(abs(v.angle_deg - ref.angle_deg) for v in others), 1)
    result["objects"] = (track_openings(ref, others, regs, openings) if openings else []) \
        or associate(ref, others, regs)
    result["stairs"] = [stair_shape(ref, others, regs, flight) for flight in stair_flights(ref)]
    doors = []
    labelled = boxes(ref, DOOR_CLASSES, "door", min_w=0.5, min_h=1.2)
    detected = [{k: float(o[k]) for k in ("u", "v", "w", "h")} for o in openings or []
                if o.get("kind") == "door" and all(isinstance(o.get(k), (int, float)) for k in ("u", "v", "w", "h"))]
    for box, from_labels in [(b, True) for b in labelled] + [(b, False) for b in detected
                                                             if not any(_iou(b, seen) > 0.3 for seen in labelled)]:
        if box["v"] > 3.5:
            continue
        found = door_depth(ref, others, regs, box, labelled=from_labels)
        if found and not DOOR_DEPTH_RANGE_M[0] <= found["depth_m"] <= DOOR_DEPTH_RANGE_M[1]:
            found = {**found, "rejected": "outside_a_doors_possible_depth"}
        doors.append({**{k: round(box[k], 3) for k in ("u", "v", "w", "h")}, "depth": found,
                      "basis": "segmentation" if from_labels else "detector_box_texture"})
    result["doors"] = doors
    return result


# ---- applying it to a fit ---------------------------------------------------------------------

def _opening_box(opening: dict) -> dict:
    return {k: float(opening[k]) for k in ("u", "v", "w", "h")}


def apply_to_fit(fit: dict, mv: dict, views: list[View] | None = None, design=None) -> dict:
    """The fit with the depth the other views give it, and nothing else of theirs.

    The house is rendered from one photograph -- the reference, the best the filter found (most
    square on, the house filling the frame, its ground floor whole) -- and every window and door
    keeps the size, place and panes that photograph shows. A blend of several photographs is
    never sharper than the best of them: an oblique view's opening, squared up, is wider or
    narrower than it is, and averaging it in moved the best view's edges. What the other views
    alone can tell is depth: a stair's direction and run, an alcove's depth. Each opening only
    records how many views saw it and how far they disagree (evidence, not a change).
    ``views`` and ``design`` are accepted for callers that pass them; neither changes an opening.
    """
    if mv.get("status") != "multiview":
        return fit
    changed = {"openings_seen_in_other_views": 0, "stair": None, "alcove": None}
    for opening in fit.get("openings", []):
        if opening.get("kind") not in {"window", "door"} or not all(
                isinstance(opening.get(k), (int, float)) for k in ("u", "v", "w", "h")):
            continue
        tracked = next((o for o in mv.get("objects", []) if opening.get("id") is not None
                        and o.get("opening_id") == opening.get("id")), None)
        match = (1.0, tracked) if tracked else max(
            ((_iou(_opening_box(opening), o["reference_box"]), o) for o in mv.get("objects", [])
             if o["kind"] == opening["kind"]), key=lambda item: item[0], default=(0, None))
        overlap, obj = match
        if obj is None or overlap < 0.4 or obj["whole_views"] < 2:
            continue
        opening["multiview"] = {"views": obj["views"], "spread_m": obj["spread_m"],
                                "basis": "multiview_registered_landmarks",
                                "dimensions": "reference_view_only"}
        changed["openings_seen_in_other_views"] += 1
    entry = fit.get("primary_entry")
    if entry:
        centre = entry["u"] + entry["w"] / 2
        if entry.get("kind") in {"long_stair", "short_stair"}:
            flights = [s for s in mv.get("stairs", []) if s["orientation"] != "unresolved"
                       and s["u"] - 1.0 <= centre <= s["u"] + s["w"] + 1.0]
            if flights:
                stair = max(flights, key=lambda s: s["w"])
                entry["stair"] = {k: stair[k] for k in ("orientation", "rises_toward", "width_m", "foot_u",
                                                         "top_u", "run_m", "rise_m", "landing_depth_m",
                                                         "depth_m", "starts_out_m", "baseline_deg") if k in stair}
                if stair["orientation"] == "recessed" and entry.get("recess"):
                    entry["recess"] = {**entry["recess"], "depth_m": stair["depth_m"],
                                       "depth_basis": "multiview_plane_sweep"}
                entry["stair"]["basis"] = "multiview_plane_sweep"
                if stair["orientation"] == "perpendicular" and entry.get("recess"):
                    entry["recess"] = {**entry["recess"], "depth_m": stair["run_m"],
                                       "depth_basis": "multiview_plane_sweep"}
                if stair["orientation"] == "sideways":
                    entry["recess_width_m"] = stair["width_m"]
                changed["stair"] = stair["orientation"]
        elif entry.get("kind") in {"flat_alcove", "flush"}:
            door = min((d for d in mv.get("doors", []) if d.get("depth") and not d["depth"].get("rejected")),
                       key=lambda d: abs(d["u"] + d["w"] / 2 - centre), default=None)
            if door and abs(door["u"] + door["w"] / 2 - centre) < 1.0:
                depth = -door["depth"]["depth_m"]
                if depth >= 0.35:
                    alcove = entry.get("alcove") or {"u": round(entry["u"] - 0.15, 3),
                                                     "width_m": round(entry["w"] + 0.3, 3),
                                                     "width_basis": "door_width_plus_reveals"}
                    entry["kind"] = "flat_alcove"
                    entry["alcove"] = {**alcove, "depth_m": round(min(3.0, depth), 3),
                                       "depth_basis": "multiview_plane_sweep"}
                    changed["alcove"] = entry["alcove"]["depth_m"]
                elif entry.get("kind") == "flat_alcove" and depth < 0.15:
                    # The views see the door in the plane of the wall: no alcove, whatever the shadow said.
                    entry["kind"] = "flush"
                    entry.pop("alcove", None)
                    changed["alcove"] = 0.0
    fit["multiview_reconstruction"] = {**{k: v for k, v in mv.items() if k not in {"objects"}},
                                       "objects": len(mv.get("objects", [])), "applied": changed}
    return fit
