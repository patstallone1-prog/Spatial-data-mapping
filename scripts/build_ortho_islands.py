#!/usr/bin/env python3
"""Kerb islands drawn from above: their outline read off the aerial photographs.

The city's curb survey (``sf-corridor-official.json``, ``r: island|median``) has most islands in
pieces: of the corridor's 797 island lines, 96 close on themselves, and the rest are fragments of
a ring cut wherever the survey's sheets or crossings cut it. The page filled between fragments a
station at a time, which drew an island as ragged strips with gaps (Fillmore at Chestnut, the
long parking median and its pointed nose at the crossing).

Here each fragment is first joined to its neighbours end to end. Then the photograph decides the
shape: around the joined kerb, the raised island is the ground that is not asphalt -- concrete
lighter than the road beside it, or planted (green, or bright in near-infrared) -- after paint
lines (narrower than 0.75 m) are opened away. The outline kept is the photograph's, held within
a metre of the surveyed kerb; where the photograph cannot see it (shade, a parked truck) a ring
the survey closed is kept as surveyed, and a fragment nothing confirms is left out.

Writes ``<site>/sf-corridor-islands.json`` (``kerbside.islands/1``): each island's ring in
lon/lat, its area, how it was decided (``aerial`` or ``survey_closed``), a confidence, and the
photograph's source and sharpness.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc.imagery import ortho
from smc.regions.paths import region_paths

#: Fragment ends this close are one kerb: the survey leaves the nose of an island open by a
#: few metres where a crossing cuts it.
JOIN_M = 4.0
#: A chain whose ends are this close is a ring -- or this share of its length apart: a long
#: median both of whose sides were surveyed is left open across its far end.
CLOSE_M = 4.0
CLOSE_SHARE = 0.04
#: How far the photograph may move the surveyed kerb, and how wide a band it looks in round a
#: fragment that does not close.
HOLD_M = 1.0
BAND_M = 1.5
#: Paint is narrower than this; an island is not.
PAINT_M = 0.75
MIN_AREA_M2 = 1.5
#: Lighter than the asphalt round it by at least this (0-255 luminance), and no more saturated
#: than grey concrete is.
CONTRAST = 16
GREY_SATURATION = 0.28
GREEN_INDEX = 0.15
MIN_CONFIDENCE = 0.5
#: Of a surveyed ring's inside, the share the photograph must see raised to confirm it.
CONFIRM = 0.45


def site_of(region: str) -> Path:
    """Where the region's page files are: its local build, or what is published in docs/regions."""
    local = region_paths(region).site
    if (local / "sf-corridor-3d.json").exists():
        return local
    return Path(__file__).resolve().parents[1] / "docs" / "regions" / region


def chains(lines: list[list[tuple[float, float]]]) -> list[tuple[list[tuple[float, float]], list[int]]]:
    """Fragments joined end to end, nearest ends first: (points, the fragments in it). Each end
    joins at most one other; joining a chain's two ends closes it into a ring."""
    ends = [(i, k, lines[i][0 if k == 0 else -1]) for i in range(len(lines)) for k in (0, 1)
            if math.dist(lines[i][0], lines[i][-1]) > CLOSE_M]
    grid: dict[tuple[int, int], list[int]] = {}
    for n, (_, _, (x, y)) in enumerate(ends):
        grid.setdefault((math.floor(x / JOIN_M), math.floor(y / JOIN_M)), []).append(n)
    pairs = []
    for n, (i, _, (x, y)) in enumerate(ends):
        gx, gy = math.floor(x / JOIN_M), math.floor(y / JOIN_M)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for m in grid.get((gx + dx, gy + dy), []):
                    if m > n and ends[m][0] != i:
                        d = math.dist(ends[n][2], ends[m][2])
                        if d <= JOIN_M:
                            pairs.append((d, n, m))
    partner: dict[tuple[int, int], tuple[int, int]] = {}
    root = list(range(len(lines)))

    def find(a: int) -> int:
        while root[a] != a:
            root[a] = root[root[a]]
            a = root[a]
        return a
    for _, n, m in sorted(pairs):
        a, b = ends[n][:2], ends[m][:2]
        if a in partner or b in partner:
            continue
        partner[a], partner[b] = b, a
        root[find(a[0])] = find(b[0])
    out, seen = [], set()
    for i in range(len(lines)):
        if i in seen:
            continue
        # Walk to one free end of this chain (or round a ring back to i).
        cur, k = i, 0
        while (cur, k) in partner:
            cur, k = partner[(cur, k)]
            k = 1 - k
            if cur == i:
                break
        start, start_k = cur, k
        pts, members = [], []
        cur, k = start, start_k
        while cur not in seen:
            seen.add(cur)
            members.append(cur)
            seg = lines[cur] if k == 0 else lines[cur][::-1]
            pts.extend(seg)
            nxt = partner.get((cur, 1 - k))
            if nxt is None:
                break
            cur, k = nxt
        out.append((pts, members))
    return out


def raised_mask(pix: dict, zone: np.ndarray) -> tuple[np.ndarray, float]:
    """Pixels that are island (not asphalt, not paint) within ``zone``; the contrast found."""
    import cv2

    rgb = pix["rgb"].astype(np.float32)
    lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    mx, mn = rgb.max(0), rgb.min(0)
    sat = (mx - mn) / np.maximum(mx, 1)
    veg = ortho.vegetation_index(pix["rgb"], pix["nir"])
    road = zone & pix["valid"]
    if road.sum() < 50:
        return np.zeros_like(zone), 0.0
    asphalt = float(np.percentile(lum[road], 30))
    concrete = (lum > asphalt + CONTRAST) & (sat < GREY_SATURATION) & (lum < 245)
    planted = veg > GREEN_INDEX
    mask = ((concrete | planted) & road).astype(np.uint8)
    k = max(3, round(PAINT_M / pix["pixel_m"]) | 1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    inside = lum[mask.astype(bool)]
    return mask.astype(bool), float(np.median(inside) - asphalt) if inside.size else 0.0


def polygons_of(mask: np.ndarray, bounds, pixel_m: float):
    import cv2
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    w, _, _, n = bounds
    contours, hierarchy = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    shells = []
    for k, c in enumerate(contours):
        if hierarchy[0][k][3] != -1 or len(c) < 3:
            continue
        pts = [(w + (x + 0.5) * pixel_m, n - (y + 0.5) * pixel_m) for [[x, y]] in c]
        poly = Polygon(pts).buffer(pixel_m / 2)
        if poly.area >= MIN_AREA_M2:
            shells.append(poly)
    return unary_union(shells) if shells else None


def build(region: str) -> dict:
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds as transform_from
    from rasterio.warp import transform
    from shapely.geometry import LineString, Polygon
    from shapely.ops import unary_union

    site = site_of(region)
    official = json.loads((site / "sf-corridor-official.json").read_text())
    picked = [(i, c) for i, c in enumerate(official.get("curb_lines", [])) if c.get("r") in ("island", "median")]
    utm_lines = []
    for _, line in picked:
        xs, ys = ortho.to_utm([p[0] for p in line["p"]], [p[1] for p in line["p"]])
        utm_lines.append(list(zip(xs.tolist(), ys.tolist(), strict=True)))
    imagery = ortho.Ortho(region)
    out, stats = [], {"fragments": len(picked), "chains": 0, "aerial": 0, "survey_closed": 0, "unseen": 0,
                      "no_imagery": 0}
    for pts, members in chains(utm_lines):
        stats["chains"] += 1
        length = sum(math.dist(pts[k], pts[k + 1]) for k in range(len(pts) - 1))
        closed = len(pts) >= 4 and math.dist(pts[0], pts[-1]) <= max(CLOSE_M, CLOSE_SHARE * length)
        if closed:
            surveyed = Polygon(pts).buffer(0)
            # A ring that crosses itself mends into pieces; the island is the largest.
            surveyed = max(getattr(surveyed, "geoms", [surveyed]), key=lambda g: g.area, default=surveyed)
            if surveyed.is_empty or surveyed.area < MIN_AREA_M2:
                continue
            zone_geom, seed = surveyed.buffer(HOLD_M), surveyed
        else:
            surveyed = None
            line = LineString(pts)
            if line.length < 2:
                continue
            zone_geom, seed = line.buffer(BAND_M), line.buffer(0.6)
        w, s, e, n = zone_geom.buffer(1.0).bounds
        pix = imagery.read((w, s, e, n), pixel_m=0.25)
        if pix is None:
            stats["no_imagery"] += 1
            if surveyed is not None:
                out.append(_row(surveyed, "survey_closed", 0.6, None, members, picked))
                stats["survey_closed"] += 1
            continue
        h, wd = pix["valid"].shape
        tf = transform_from(w, s, e, n, wd, h)
        zone = rasterize([(zone_geom, 1)], out_shape=(h, wd), transform=tf).astype(bool)
        mask, contrast = raised_mask(pix, zone)
        if surveyed is not None:
            # The survey's kerb is where the kerb is (it sits on the photograph to a pixel or two);
            # the photograph says whether there is a raised island inside it.
            inner = surveyed.buffer(-0.25)
            inside = rasterize([(inner if not inner.is_empty else surveyed, 1)], out_shape=(h, wd), transform=tf).astype(bool)
            seen = float(mask[inside].mean()) if inside.any() and contrast >= CONTRAST else 0.0
            if seen >= CONFIRM:
                out.append(_row(surveyed, "survey_aerial_confirmed", min(1.0, 0.5 + seen / 2), pix, members, picked))
                stats["aerial"] += 1
            else:
                row = _row(surveyed, "survey_unconfirmed", 0.4, pix, members, picked)
                # The page raised a ring the survey itself closed; it keeps doing so.
                row["closed_in_survey"] = len(members) == 1 and math.dist(utm_lines[members[0]][0], utm_lines[members[0]][-1]) <= 0.12
                out.append(row)
                stats["survey_closed"] += 1
            continue
        found = polygons_of(mask, (w, s, e, n), pix["pixel_m"]) if contrast >= CONTRAST else None
        kept = None
        if found is not None:
            parts = [g for g in getattr(found, "geoms", [found]) if g.intersects(seed)]
            kept = unary_union(parts).intersection(zone_geom) if parts else None
        confidence = 0.0
        if kept is not None and not kept.is_empty:
            kept = kept.buffer(0.2).buffer(-0.2).simplify(0.15)
            # Does the outline found run along the surveyed kerb?
            edge = kept.boundary
            along = sum(1 for d in np.linspace(0, line.length, 40) if edge.distance(line.interpolate(d)) <= 0.6) / 40
            confidence = min(1.0, along * min(1.0, contrast / (2 * CONTRAST)) ** 0.25)
        polys = [g for g in getattr(kept, "geoms", [kept]) if kept is not None and g.area >= MIN_AREA_M2
                 and g.area / max(g.length, 1e-6) * 2 >= 0.8] if kept is not None and not kept.is_empty else []
        if polys and confidence >= MIN_CONFIDENCE:
            for poly in polys:
                out.append(_row(poly, "aerial", confidence, pix, members, picked))
                stats["aerial"] += 1
        else:
            stats["unseen"] += 1
    # To lon/lat.
    for row in out:
        xs, ys = transform(ortho.CRS, "EPSG:4326", [p[0] for p in row["p"]], [p[1] for p in row["p"]])
        row["p"] = [[round(x, 7), round(y, 7)] for x, y in zip(xs, ys, strict=True)]
    used = {s for r in out for s in r.pop("_sources", [])}
    payload = {"schema": "kerbside.islands/1", "region": region,
               "sources": {k: v for k, v in imagery.manifest["sources"].items() if k in used},
               "stats": stats, "islands": out}
    # No surveyed islands, nothing to replace: no file, and the page keeps its own way.
    if picked:
        (site / "sf-corridor-islands.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    return payload


def _row(poly, basis, confidence, pix, members, picked) -> dict:
    ring = list(poly.exterior.coords)
    return {"p": ring, "basis": basis, "confidence": round(float(confidence), 2), "area_m2": round(poly.area, 1),
            "gsd_m": pix["gsd_m"] if pix else None, "lines": [picked[m][0] for m in members],
            "_sources": pix["sources"] if pix else []}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--region", default="sf-corridor")
    args = ap.parse_args()
    result = build(args.region)
    print(args.region, result["stats"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
