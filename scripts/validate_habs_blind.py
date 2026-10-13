#!/usr/bin/env python3
"""Blind reconstruction of historic house fronts, scored against HABS measured drawings.

The test is what a real house in the city gets, and nothing more: two or three photographs of
its front, its footprint from OpenStreetMap, and which way the front faces (the photograph's
caption: "south elevation"). No wall proportions, no marked extents, no opening hints:

  squared up   each photograph from its own vanishing points, metric (one scale on both axes)
               from the focal length the two vanishing points imply (a prior when one is at
               infinity, as a view camera's corrected verticals are);
  cut out      the front's extents found in the squared-up photograph by the run's own
               segmentation (UperNet, ADE20K): the house's columns and its ground line;
  scaled       by the footprint's wall facing that way, the width a real house's footprint
               gives; the height follows from the photograph, as the lidar is not here;
  fitted       by the run's pipeline unchanged (detector, smc.facades.fit.extract_front);
  fused        the photographs' fits on one front: an opening is kept when two photographs
               that both see that part of the front agree on it, or the only one that sees it.

The drawing is used only to score. Its openings were read off the measured elevation at the
drawing's scale (``truth`` in the pack), never shown to the fit. Photographs and drawings are
downloaded to a work folder (``--work``) and deleted with it after scoring; only numbers are kept.

    .venv/bin/python scripts/validate_habs_blind.py --pack data/validation/habs-blind-pack.json \\
        --work "/Volumes/HP P700 1/Kerbside/habs-blind-2026-10-12" [--fetch] [--houses larkin,...]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import ssl
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

UA = {"User-Agent": "KerbsideValidation/1.0 (measured-drawing validation; research)"}
RUN = Path("/Applications/Spatial-data-mapping-returning-visitor-cache/build")
PIXELS_PER_M = 35.0
#: A large-format view camera's normal lens, as a multiple of the negative's long side: the
#: focal length assumed when the photograph's verticals are corrected (a vanishing point at
#: infinity says nothing about the lens).
FOCAL_PRIOR = 1.4
FACING = {"north": (0, 1), "south": (0, -1), "east": (1, 0), "west": (-1, 0),
          "northeast": (0.7071, 0.7071), "northwest": (-0.7071, 0.7071),
          "southeast": (0.7071, -0.7071), "southwest": (-0.7071, -0.7071)}
GROUND = {"road", "sidewalk", "earth", "grass", "path", "floor", "field", "land", "sand", "dirt track"}
ARCHITECTURE = {"building", "house", "wall", "windowpane", "door", "column", "railing", "awning",
                "balcony", "skyscraper", "hovel", "tower", "stairs", "step", "stairway", "bannister",
                "screen door", "canopy", "shutter", "fence"}


# -- geometry ------------------------------------------------------------------------------

def _orient(H: np.ndarray, centre: tuple[float, float]) -> np.ndarray:
    """Keep left at left and up at the top after a rectifying homography."""
    def at(p):
        q = H @ np.array([p[0], p[1], 1.0])
        return q[:2] / q[2]
    c = at(centre)
    if at((centre[0] + 10, centre[1]))[0] < c[0]:
        H = np.diag([-1.0, 1.0, 1.0]) @ H
    c = at(centre)
    if at((centre[0], centre[1] + 10))[1] < c[1]:
        H = np.diag([1.0, -1.0, 1.0]) @ H
    return H


def focal_from_vanishing_points(vp_v: np.ndarray, vp_h: np.ndarray, centre: tuple[float, float],
                                long_side: float) -> tuple[float, str]:
    """Two vanishing points of orthogonal directions fix the focal length:
    f^2 = -(v1 - c) . (v2 - c). With either at infinity (or a result outside a sane lens), the
    view camera's prior."""
    if abs(vp_v[2]) > 1e-9 and abs(vp_h[2]) > 1e-9:
        a = vp_v[:2] / vp_v[2] - np.asarray(centre)
        b = vp_h[:2] / vp_h[2] - np.asarray(centre)
        f2 = -float(a @ b)
        if f2 > 0 and 0.5 * long_side < math.sqrt(f2) < 4 * long_side:
            return math.sqrt(f2), "vanishing_points"
    return FOCAL_PRIOR * long_side, "view_camera_prior"


def side_vanishing_point(flat: np.ndarray, vp_front: np.ndarray) -> np.ndarray | None:
    """An oblique photograph also sees the side wall: its horizontals meet at a second point,
    on the other side of the frame. The two (orthogonal on the ground) fix the lens."""
    from smc.facades.photo_rectify import _homogeneous_line, vanishing_point

    if len(flat) < 12 or abs(vp_front[2]) < 1e-9:
        return None
    lines = np.array([_homogeneous_line(r) for r in flat])
    mids = np.stack([(flat[:, 0] + flat[:, 2]) / 2, (flat[:, 1] + flat[:, 3]) / 2], axis=1)
    dirs = np.stack([flat[:, 2] - flat[:, 0], flat[:, 3] - flat[:, 1]], axis=1)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    to = vp_front[:2] / vp_front[2] - mids
    to /= np.linalg.norm(to, axis=1, keepdims=True) + 1e-12
    rest = flat[np.abs(dirs[:, 0] * to[:, 1] - dirs[:, 1] * to[:, 0]) > np.sin(np.radians(3))]
    del lines
    if len(rest) < 8:
        return None
    try:
        vp, n = vanishing_point(rest)
    except ValueError:
        return None
    return vp if n >= 6 and abs(vp[2]) > 1e-9 else None


def metric_homography(vp_v: np.ndarray, vp_h: np.ndarray, shape: tuple[int, int],
                      vp_side: np.ndarray | None = None) -> tuple[np.ndarray, dict]:
    """The homography from the photograph to the front seen square on with one scale on both
    axes (up to that scale): the plane's two directions from the vanishing points through K.
    The lens comes from the front's two vanishing points, else the front's and the side
    wall's horizontals, else a view camera's normal lens."""
    h, w = shape[:2]
    centre = (w / 2, h / 2)
    f, basis = focal_from_vanishing_points(vp_v, vp_h, centre, max(w, h))
    if basis != "vanishing_points" and vp_side is not None:
        f2, basis2 = focal_from_vanishing_points(vp_side, vp_h, centre, max(w, h))
        if basis2 == "vanishing_points":
            f, basis = f2, "front_and_side_horizontals"
    K = np.array([[f, 0, centre[0]], [0, f, centre[1]], [0, 0, 1.0]])
    Ki = np.linalg.inv(K)
    rh = Ki @ vp_h
    rh /= np.linalg.norm(rh)
    rv = Ki @ vp_v
    rv -= (rv @ rh) * rh  # square to the horizontal: exact with the right lens, enforced with a prior
    rv /= np.linalg.norm(rv)
    n = np.cross(rh, rv)
    # A point on the plane at (a, b): K (a rh + b rv + n). Its inverse sends pixels to (a, b).
    M = K @ np.stack([rh, rv, n], axis=1)
    H = _orient(np.linalg.inv(M), centre)
    return H, {"focal_px": round(f, 1), "focal_basis": basis}


def warp_box(H: np.ndarray, shape: tuple[int, int], max_side: int = 2400) -> tuple[np.ndarray, tuple[int, int]]:
    """``H`` scaled and shifted so the whole photograph lands in a box of ``max_side``."""
    import cv2

    h, w = shape[:2]
    corners = cv2.perspectiveTransform(np.float32([[[0, 0]], [[w, 0]], [[w, h]], [[0, h]]]), H)[:, 0, :]
    x0, y0 = corners.min(axis=0)
    x1, y1 = corners.max(axis=0)
    s = max_side / max(x1 - x0, y1 - y0)
    S = np.array([[s, 0, -x0 * s], [0, s, -y0 * s], [0, 0, 1]])
    return S @ H, (int((x1 - x0) * s), int((y1 - y0) * s))


def front_extents(labels: np.ndarray, names: dict[int, str], visible: np.ndarray) -> dict | None:
    """Where the house is in a squared-up photograph: the rows it fills, then the run of
    columns it fills between them that is nearest the middle (the photographer framed it).

    Rows: those where the house covers a quarter of the width. Columns: those the house fills
    for half of those rows. The ground line is the lowest of those rows; the top, the highest.
    """
    ids = [i for i, n in names.items() if n.split(",")[0].strip() in ARCHITECTURE]
    house = np.isin(labels, ids) & visible
    if house.sum() < 500:
        return None
    w = labels.shape[1]
    # A scan's film border and a washed-out sky are often called wall: rows are read across
    # the middle of the frame only, and the border is trimmed off the columns.
    middle = house[:, int(0.3 * w) : int(0.7 * w)]
    rows = np.where(middle.mean(axis=1) >= 0.5)[0]
    if len(rows) < 10:
        return None
    top, ground = int(rows.min()), int(rows.max())
    # A hedge, a stoop or a parked car stands in front of the ground floor; the ground line is
    # where the ground itself (pavement, road, earth, lawn) takes over the middle of the frame.
    ground_ids = [i for i, n in names.items() if n.split(",")[0].strip() in GROUND]
    under = np.isin(labels[:, int(0.3 * w) : int(0.7 * w)], ground_ids).mean(axis=1)
    limit = min(labels.shape[0] - 1, ground + int(0.8 * (ground - top)))
    while ground < limit and under[ground + 1] < 0.5:
        ground += 1
    share = house[top : ground + 1].mean(axis=0)
    good = np.append(share >= 0.5, False)
    good[: int(0.04 * w)] = False  # the scan's film border
    good[w - int(0.04 * w) : w] = False
    runs, start = [], None
    for x, g in enumerate(good):
        if g and start is None:
            start = x
        elif not g and start is not None:
            runs.append((start, x))
            start = None
    # Small gaps (a downpipe, a tree trunk) do not split a front.
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 0.03 * labels.shape[1]:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    merged = [r for r in merged if r[1] - r[0] >= 0.1 * labels.shape[1]]
    if not merged:
        return None
    mid = labels.shape[1] / 2
    left, right = min(merged, key=lambda r: 0 if r[0] <= mid <= r[1] else min(abs(r[0] - mid), abs(r[1] - mid)))
    return {"left": int(left), "right": int(right), "top": top, "ground": ground,
            "basis": "segmentation_house_rows_and_centre_column_run"}


def horizontal_span(square: np.ndarray, top: int, ground: int) -> tuple[int, int] | None:
    """The house's ends from its long horizontals: in a squared-up front the eave, the floor
    bands and the rails run straight across and stop at its corners, where the neighbours,
    trees and a hazy background (all of which segmentation may call "building") have none.

    Segments within 2 degrees of level between the roofline and the ground are grouped by
    height; at each height, pieces less than 2% of the frame apart are joined; the longest
    joined run is the front's width.
    """
    from smc.facades.photo_rectify import line_segments

    h, w = square.shape[:2]
    seg = line_segments(square, min_len=0.02 * w)
    if not len(seg):
        return None
    ang = np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180
    level = seg[(ang < 2) | (ang > 178)]
    y = (level[:, 1] + level[:, 3]) / 2
    level = level[(y >= top - 0.05 * h) & (y <= ground + 0.02 * h)]
    best = None
    band = max(4, int(0.006 * h))
    for b in np.unique(((level[:, 1] + level[:, 3]) / 2 // band).astype(int)):
        rows = level[np.abs((level[:, 1] + level[:, 3]) / 2 // band - b) <= 1]
        spans = sorted((min(r[0], r[2]), max(r[0], r[2])) for r in rows)
        run = list(spans[0])
        for x0, x1 in spans[1:]:
            if x0 - run[1] <= 0.02 * w:
                run[1] = max(run[1], x1)
            else:
                if best is None or run[1] - run[0] > best[1] - best[0]:
                    best = tuple(run)
                run = [x0, x1]
        if best is None or run[1] - run[0] > best[1] - best[0]:
            best = tuple(run)
    if best is None or best[1] - best[0] < 0.25 * w:
        return None
    return int(best[0]), int(best[1])


# -- footprint --------------------------------------------------------------------------------

def overpass_building(lat: float, lon: float, osm_way: int | None = None) -> list[tuple[float, float]] | None:
    """The footprint (lon, lat ring) of the building at a point, or a named way."""
    ctx = ssl.create_default_context(cafile=__import__("certifi").where())
    if osm_way:
        # A named way comes straight from the OpenStreetMap API, which answers when Overpass is busy.
        url = f"https://api.openstreetmap.org/api/0.6/way/{osm_way}/full.json"
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60, context=ctx) as r:
            elements = json.loads(r.read())["elements"]
        nodes = {e["id"]: (e["lon"], e["lat"]) for e in elements if e["type"] == "node"}
        way = next(e for e in elements if e["type"] == "way" and e["id"] == osm_way)
        return [nodes[n] for n in way["nodes"]]
    q = (f"[out:json][timeout:60];way({osm_way});out geom;" if osm_way else
         f"[out:json][timeout:60];is_in({lat},{lon})->.a;way(pivot.a)[building];out geom;"
         f"way(around:25,{lat},{lon})[building];out geom;")
    body = urllib.parse.urlencode({"data": q}).encode()
    doc, error = None, None
    for attempt in range(6):
        endpoint = ("https://overpass-api.de/api/interpreter",
                    "https://overpass.private.coffee/api/interpreter")[attempt % 2]
        try:
            req = urllib.request.Request(endpoint, data=body, headers=UA)
            with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
                doc = json.loads(r.read())
            break
        except OSError as exc:  # busy servers answer 429/504
            error = exc
            time.sleep(10 * (attempt + 1))
    if doc is None:
        raise RuntimeError(f"Overpass unavailable: {error}")
    ways = [e for e in doc.get("elements", []) if e.get("type") == "way" and e.get("geometry")]
    if not ways:
        return None
    return [(p["lon"], p["lat"]) for p in ways[0]["geometry"]]


def facing_wall_width(ring_lonlat: list[tuple[float, float]], facing: str) -> dict:
    """The footprint's front: its walls facing ``facing``, end to end along the front."""
    from smc.facades.geometry import LocalFrame, walls_of

    lat0 = sum(p[1] for p in ring_lonlat) / len(ring_lonlat)
    lon0 = sum(p[0] for p in ring_lonlat) / len(ring_lonlat)
    frame = LocalFrame(lat0, lon0)
    ring = [frame.to_xy(lon, lat) for lon, lat in ring_lonlat]
    fx, fy = FACING[facing]
    walls = [w for w in walls_of(ring, 8.0, 0, min_length_m=1.0)
             if w.normal[0] * fx + w.normal[1] * fy > math.cos(math.radians(50))]
    if not walls:
        raise ValueError(f"no footprint wall faces {facing}")
    main = max(walls, key=lambda w: w.length_m)
    nx, ny = main.normal
    parallel = [w for w in walls if w.normal[0] * nx + w.normal[1] * ny > 0.94]
    tx, ty = -ny, nx
    along = [p[0] * tx + p[1] * ty for w in parallel for p in (w.a, w.b)]
    return {"width_m": round(max(along) - min(along), 3), "main_wall_m": round(main.length_m, 3),
            "walls": len(parallel), "normal": (round(nx, 3), round(ny, 3))}


# -- scoring ----------------------------------------------------------------------------------

def _iou(a: dict, b: dict) -> float:
    x0, x1 = max(a["u"], b["u"]), min(a["u"] + a["w"], b["u"] + b["w"])
    y0, y1 = max(a["v"], b["v"]), min(a["v"] + a["h"], b["v"] + b["h"])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


def _centre(o: dict) -> tuple[float, float]:
    return o["u"] + o["w"] / 2, o["v"] + o["h"] / 2


def match(truth: list[dict], predicted: list[dict]) -> list[tuple[int, int]]:
    """Nearest first: centres within max(1.5 m, the drawn opening's size), overlapping (IoU >= 0.1)."""
    pairs = []
    for i, t in enumerate(truth):
        for j, p in enumerate(predicted):
            d = math.dist(_centre(t), _centre(p))
            if d <= max(1.5, max(t["w"], t["h"])) and _iou(t, p) >= 0.1:
                pairs.append((d, i, j))
    used_t, used_p, out = set(), set(), []
    for _, i, j in sorted(pairs):
        if i not in used_t and j not in used_p:
            used_t.add(i)
            used_p.add(j)
            out.append((i, j))
    return out


def score(truth: list[dict], predicted: list[dict]) -> dict:
    pairs = match(truth, predicted)
    per = []
    for i, j in pairs:
        t, p = truth[i], predicted[j]
        per.append({
            "name": t.get("name"), "centre_m": math.dist(_centre(t), _centre(p)),
            "width_m": abs(t["w"] - p["w"]), "height_m": abs(t["h"] - p["h"]),
            "width_rel": abs(t["w"] - p["w"]) / t["w"], "height_rel": abs(t["h"] - p["h"]) / t["h"],
            "iou": _iou(t, p), "kind_ok": (t["kind"] == "door") == (p["kind"] in {"door", "garage"}),
        })
    def mean(k):
        return float(np.mean([x[k] for x in per])) if per else None

    return {"truth": len(truth), "predicted": len(predicted), "matched": len(pairs),
            "recall": len(pairs) / len(truth) if truth else None,
            "precision": len(pairs) / len(predicted) if predicted else None,
            "centre_error_m": mean("centre_m"), "width_error_m": mean("width_m"),
            "height_error_m": mean("height_m"), "width_error_rel": mean("width_rel"),
            "height_error_rel": mean("height_rel"), "mean_iou": mean("iou"),
            "window_vs_door_correct": mean("kind_ok"), "pairs": per}


def fuse(fits: list[dict], front_width: float) -> list[dict]:
    """One front from two or three photographs' fits.

    Each photograph's openings are on the same front in metres (left corner, ground line). An
    opening is kept where photographs that saw that stretch of the front agree (IoU >= 0.3);
    one seen by a single photograph is kept only if no other photograph saw that stretch.
    Agreeing openings are averaged.
    """
    clusters: list[list[tuple[int, dict]]] = []
    for k, fit in enumerate(fits):
        for o in fit["openings"]:
            best = max(clusters, key=lambda c: max(_iou(o, x) for _, x in c), default=None)
            if best is not None and max(_iou(o, x) for _, x in best) >= 0.3 and all(i != k for i, _ in best):
                best.append((k, o))
            else:
                clusters.append([(k, o)])
    out = []
    for c in clusters:
        u = np.mean([o["u"] for _, o in c])
        w = np.mean([o["w"] for _, o in c])
        seen_by = [k for k, fit in enumerate(fits)
                   if fit["seen_u"][0] - 0.2 <= u and u + w <= fit["seen_u"][1] + 0.2]
        if len(c) >= 2 or len(seen_by) <= 1:
            kinds = [o["kind"] for _, o in c]
            out.append({"u": float(u), "v": float(np.mean([o["v"] for _, o in c])), "w": float(w),
                        "h": float(np.mean([o["h"] for _, o in c])),
                        "kind": max(set(kinds), key=kinds.count), "votes": len(c)})
    return out


# -- the run ------------------------------------------------------------------------------------

def fetch(url: str, out: Path) -> Path:
    if out.exists() and out.stat().st_size > 0:
        return out
    ctx = ssl.create_default_context(cafile=__import__("certifi").where())
    out.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180, context=ctx) as r:
        out.write_bytes(r.read())
    time.sleep(1.0)
    return out


def loc_full(reference_url: str) -> str:
    """The Library of Congress IIIF image at full size, from an item's reference image link
    (tile.loc.gov/storage-services/service/pnp/habshaer/ca/ca0200/ca0221/photos/012029pr.jpg)."""
    path = reference_url.split("/storage-services/service/", 1)[1].rsplit(".", 1)[0]
    return f"https://tile.loc.gov/image-services/iiif/service:{path.replace('/', ':')}/full/pct:100/0/default.jpg"


def fit_photo(path: Path, facing_width: float, screen, detector) -> dict:
    import cv2

    from smc.facades.fit import extract_front
    from smc.facades.photo_rectify import line_segments, vanishing_point
    from smc.facades.survey import rectilinearity

    bgr = cv2.imread(str(path))
    if bgr.ndim == 2 or bgr.shape[2] == 1:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    scale = 2400 / max(bgr.shape[:2])
    if scale < 1:
        bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    seg = line_segments(bgr)
    ang = np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180
    vp_v, n_v = vanishing_point(seg[np.abs(ang - 90) < 25])
    flat = seg[(ang < 40) | (ang > 140)]
    vp_h, n_h = vanishing_point(seg[(ang < 25) | (ang > 155)])
    side = side_vanishing_point(flat, vp_h)
    H, lens = metric_homography(vp_v, vp_h, bgr.shape, side)
    H, size = warp_box(H, bgr.shape)
    square = cv2.warpPerspective(bgr, H, size, flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    visible = square.max(axis=2) > 0
    first = screen.screen(square, visible)
    labels = first["labels"]
    ext = front_extents(labels, screen.labels, visible)
    if ext is None:
        return {"photo": path.name, "error": "no house found in the squared-up photograph"}
    span = horizontal_span(square, ext["top"], ext["ground"])
    if span:
        ext.update(left=span[0], right=span[1], basis="long_horizontals_within_segmented_rows")
    px_w = ext["right"] - ext["left"]
    px_h = ext["ground"] - ext["top"]
    width_m = facing_width
    scale_basis = "footprint_front_wall"
    height_m = width_m * px_h / px_w
    A = np.array([[PIXELS_PER_M * width_m / px_w, 0, -ext["left"] * PIXELS_PER_M * width_m / px_w],
                  [0, PIXELS_PER_M * height_m / px_h, -ext["top"] * PIXELS_PER_M * height_m / px_h],
                  [0, 0, 1]])
    out_size = (round(width_m * PIXELS_PER_M), round(height_m * PIXELS_PER_M))
    front = cv2.warpPerspective(bgr, A @ H, out_size, flags=cv2.INTER_AREA, borderValue=(0, 0, 0))
    seen = front.max(axis=2) > 0
    screened = screen.screen(front, seen)
    flabels = screened["labels"].astype(np.uint8)
    detection = detector.detect_front(front)
    controls = {"image_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "detector_proposals": detection["objects"], "material": "unknown",
                "ground_floor_business": False}
    fit = extract_front(front, flabels, width_m, height_m, controls)
    cols = np.where(seen.any(axis=0))[0]
    # How far off square the camera stood: the front's horizontal vanishing point's direction
    # from the lens axis (at infinity, square on).
    if abs(vp_h[2]) < 1e-9:
        obliquity = 0.0
    else:
        dx = abs(vp_h[0] / vp_h[2] - bgr.shape[1] / 2)
        obliquity = 90.0 - math.degrees(math.atan2(dx, lens["focal_px"]))
    share = (px_w * px_h) / float(square.shape[0] * square.shape[1])
    return {
        "photo": path.name, "openings": [{k: o[k] for k in ("u", "v", "w", "h", "kind")} for o in fit.get("openings", [])],
        "width_m": round(width_m, 3), "height_m": round(height_m, 3), "scale_basis": scale_basis,
        "lens": lens, "edges": {"vertical": n_v, "horizontal": n_h},
        "obliquity_deg": round(obliquity, 1), "target_share": round(share, 3),
        "squareness": round(rectilinearity(front, seen), 3), "extents_px": ext,
        "seen_u": (float(cols.min() / PIXELS_PER_M), float(cols.max() / PIXELS_PER_M)) if len(cols) else (0, 0),
        "pixel_screen": {k: screened[k] for k in ("pass", "reasons", "fractions")},
        "details": screened.get("details"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pack", type=Path, default=ROOT / "data/validation/habs-blind-pack.json")
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--houses", default="")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--model-cache", type=Path, help="one folder for both pinned models (default: the run's caches)")
    ap.add_argument("--out", type=Path, default=ROOT / "build/habs-blind-results.json")
    args = ap.parse_args()
    pack = json.loads(args.pack.read_text())
    wanted = {h for h in args.houses.split(",") if h}
    from smc.facades.detail_detection import FacadeDetailDetector
    from smc.facades.frontage_pixels import FrontagePixelScreen

    screen = FrontagePixelScreen(args.model_cache or RUN / "frontage-pilot-v2/model-cache", device=args.device)
    detector = FacadeDetailDetector(args.model_cache or RUN / "facade-detail-model-cache", device=args.device)
    results = json.loads(args.out.read_text()) if args.out.exists() else {}
    for house in pack["houses"]:
        if wanted and house["slug"] not in wanted:
            continue
        footprint = house.get("footprint")
        # Every house is scored as a real one: no footprint, no test (the pack lists those apart).
        cached = args.work / house["slug"] / "footprint.json"
        if cached.exists():
            ring = json.loads(cached.read_text())
        else:
            ring = overpass_building(footprint.get("lat"), footprint.get("lon"), footprint.get("osm_way"))
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps(ring))
        width = facing_wall_width(ring, house["facing"])
        fits = []
        for photo in house["photos"]:
            # The Library of Congress serves a photograph at 1,024 px at most; the Commons mirror
            # of the same scan serves it at 2,400.
            source = (photo.get("commons") or {}).get("thumb") or loc_full(photo["url"])
            path = fetch(source, args.work / house["slug"] / f"{photo['pk']}-full.jpg")
            fits.append(fit_photo(path, width["width_m"] if width else None, screen, detector))
            print(house["slug"], photo["pk"], json.dumps({k: fits[-1].get(k) for k in
                  ("width_m", "height_m", "squareness", "lens", "error")}), flush=True)
        good = [f for f in fits if "error" not in f]
        truth = house["truth"]["openings"]
        for f in good:
            f["score"] = score(truth, f["openings"])
        # The photograph the filter would pick: within 40 degrees, nearest square on, then
        # the one the house fills most.
        best = min(good, key=lambda f: (f["obliquity_deg"] > 40, round(f["obliquity_deg"] / 10), -f["target_share"]),
                   default=None)
        fused = fuse(good, width["width_m"]) if len(good) >= 2 else (best or {}).get("openings", [])
        results[house["slug"]] = {
            "name": house["name"], "habs": house["habs"], "facing": house["facing"],
            "footprint": width, "photos": [{k: v for k, v in f.items() if k != "openings"} | {"openings": len(f.get("openings", []))} for f in fits],
            "best_photo_name": best["photo"] if best else None,
            "truth_panel_m": house["truth"].get("panel_m"),
            "width_error_m": round(abs(width["width_m"] - house["truth"]["panel_m"][0]), 3) if width and house["truth"].get("panel_m") else None,
            "height_inferred_m": [f["height_m"] for f in good],
            "best_photo": score(truth, best["openings"]) if best else None,
            "fused": score(truth, fused),
        }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, indent=1, default=str))
        print(house["slug"], json.dumps({k: results[house["slug"]]["fused"][k] for k in ("truth", "predicted", "matched", "recall", "precision", "centre_error_m")}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
