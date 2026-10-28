#!/usr/bin/env python3
"""Roofs read from above: their colour, solar panels, decks and planting.

For every building in a region's page, inside its footprint drawn in a little from the edge (an
aerial photograph is not a true orthophoto: a building leans away from where the camera was, and
its eaves overhang), the photograph (src/smc/imagery/ortho.py) is read for:

* **colour** -- the median of the roof that is in sun and not planted, panels or deck;
* **solar panels** -- rectangles of dark blue-black (blue over red, not green, low in near-
  infrared), at least two modules' area; each array's rectangle (centre, length, width, bearing);
* **a deck** -- a rectangle of weathered wood (orange-brown, moderately saturated) covering part
  of the roof but not all of it (a roof all that colour is clay tile);
* **planting** -- the share of the roof that is leaves (a roof garden, or a tree over it).

Each reading has a confidence. A room built on the roof (a penthouse, a stair house) is not read
here: from straight above it is the same colour as the roof, and its height is the lidar's.

Writes ``<site>/sf-corridor-roofs.json`` (``kerbside.roofs/1``), keyed by OSM id.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc.imagery import ortho
from smc.regions.paths import region_paths

#: How far in from the outline the roof is read.
INSET_M = 0.75
MIN_ROOF_M2 = 12
SHADE_LUM = 50
SOLAR_MIN_M2 = 8.0
SOLAR_RECTANGULAR = 0.65
#: Panels in sun are dark grey a touch bluer than the photograph's own cast (measured on the
#: arrays of a Tenderloin roof: +4); shade is far bluer (+35) and darker.
SOLAR_BLUE_RANGE = (-6, 20)
SOLAR_LUM = (55, 140)
#: An array is at least this wide (a strip of shade along a parapet is narrower), and textured:
#: module seams and frames, where shade is smooth.
SOLAR_MIN_WIDTH_M = 1.0
SOLAR_MIN_TEXTURE = 20.0
#: Of an array's area, the share that is seams and frames between modules.
SOLAR_SEAMS = (0.06, 0.45)
#: An array is darker than the rest of its roof by this much; a grey shingle roof is one tone.
SOLAR_DARKER_THAN_ROOF = 20
#: Modules repeat: the brightness profile across an array correlates with itself a module on.
SOLAR_RHYTHM = 0.25
DECK_MIN_M2 = 4.0
DECK_SHARE = (0.03, 0.6)
LEAF_INDEX = 0.2


def site_of(region: str) -> Path:
    """Where the region's page files are: its local build, or what is published in docs/regions."""
    local = region_paths(region).site
    if (local / "sf-corridor-3d.json").exists():
        return local
    return Path(__file__).resolve().parents[1] / "docs" / "regions" / region


def _rects(mask: np.ndarray, pixel_m: float, min_m2: float, rectangular: float, lum=None, texture=0.0,
           min_width=0.0):
    """Connected parts of ``mask`` big and rectangular enough: (cx, cy px, length m, width m,
    angle deg, area m2, rectangularity)."""
    import cv2

    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    out = []
    for k in range(1, count):
        area = stats[k, cv2.CC_STAT_AREA] * pixel_m * pixel_m
        if area < min_m2:
            continue
        ys, xs = np.nonzero(labels == k)
        (cx, cy), (a, b), angle = cv2.minAreaRect(np.column_stack([xs, ys]).astype(np.float32))
        box = max(a * b, 1) * pixel_m * pixel_m
        fill = area / box
        if fill < rectangular:
            continue
        length, width = max(a, b) * pixel_m, min(a, b) * pixel_m
        if width < min_width or (lum is not None and float(lum[ys, xs].std()) < texture):
            continue
        if a < b:
            angle += 90
        out.append((cx, cy, length, width, angle % 180, area, fill))
    return out


def module_rhythm(lum: np.ndarray, part: np.ndarray, pixel_m: float) -> float:
    """How strongly brightness repeats across ``part`` at a module's pitch (1-1.8 m), along
    either axis of its rectangle: the autocorrelation peak of the averaged profile, 0 to 1."""
    import cv2

    ys, xs = np.nonzero(part)
    (cx, cy), _, angle = cv2.minAreaRect(np.column_stack([xs, ys]).astype(np.float32))
    turn = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
    flat = cv2.warpAffine(lum.astype(np.float32), turn, (lum.shape[1], lum.shape[0]), flags=cv2.INTER_LINEAR)
    inside = cv2.warpAffine(part.astype(np.uint8), turn, (lum.shape[1], lum.shape[0]), flags=cv2.INTER_NEAREST) > 0
    rows, cols = np.nonzero(inside)
    if rows.size < 20:
        return 0.0
    crop = np.where(inside, flat, np.nan)[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    lags = range(max(2, round(1.0 / pixel_m)), round(1.8 / pixel_m) + 1)
    best = 0.0
    for profile in (np.nanmean(crop, axis=0), np.nanmean(crop, axis=1)):
        profile = profile[np.isfinite(profile)]
        if profile.size < 3 * max(lags):
            continue
        profile = profile - profile.mean()
        norm = float((profile * profile).sum())
        if norm <= 0:
            continue
        best = max(best, max(float((profile[:-lag] * profile[lag:]).sum()) / norm for lag in lags))
    return best


def read_roof(pix: dict, roof: np.ndarray) -> dict | None:
    import cv2

    p = pix["pixel_m"]
    rgb = pix["rgb"].astype(np.float32)
    r, g, b = rgb
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    veg = ortho.vegetation_index(pix["rgb"], pix["nir"])
    hsv = cv2.cvtColor(np.ascontiguousarray(np.moveaxis(pix["rgb"], 0, -1)), cv2.COLOR_RGB2HSV)
    hue, sat, val = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
    roof = roof & pix["valid"]
    total = int(roof.sum())
    if total * p * p < MIN_ROOF_M2:
        return None
    k3 = np.ones((3, 3), np.uint8)
    leaves = roof & (veg > LEAF_INDEX)
    # Solar: dark grey, about the photograph's own cast in blue (shade is much bluer), not leaves,
    # and low in near-infrared, which silicon absorbs.
    cast = float(np.median((b - r)[pix["valid"]]))
    blue = ((b - r >= cast + SOLAR_BLUE_RANGE[0]) & (b - r <= cast + SOLAR_BLUE_RANGE[1])
            & (lum >= SOLAR_LUM[0]) & (lum <= SOLAR_LUM[1]) & (veg < 0.05))
    if pix["nir"] is not None:
        blue &= pix["nir"].astype(np.float32) < lum
    # An array is modules with light seams and frames between them: the seams are closed over to
    # find the array, and then must be there -- shade and dark glass are smooth.
    raw = (roof & blue).astype(np.uint8)
    solar_mask = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, k3)
    solar_mask = cv2.morphologyEx(solar_mask, cv2.MORPH_OPEN, k3)
    count, labels = cv2.connectedComponents(solar_mask, connectivity=8)
    for k in range(1, count):
        part = labels == k
        seams = 1 - float(raw[part].mean())
        if not SOLAR_SEAMS[0] <= seams <= SOLAR_SEAMS[1]:
            solar_mask[part] = 0
    rest = roof & ~solar_mask.astype(bool) & (lum >= SHADE_LUM)
    if rest.sum() >= 20:
        rest_lum = float(np.median(lum[rest]))
        count, labels = cv2.connectedComponents(solar_mask, connectivity=8)
        for k in range(1, count):
            part = labels == k
            if float(np.median(lum[part & raw.astype(bool)] if (part & raw.astype(bool)).any() else lum[part])) \
                    > rest_lum - SOLAR_DARKER_THAN_ROOF or module_rhythm(lum, part, p) < SOLAR_RHYTHM:
                solar_mask[part] = 0
    else:
        solar_mask[:] = 0
    panels = _rects(solar_mask, p, SOLAR_MIN_M2, SOLAR_RECTANGULAR, lum, SOLAR_MIN_TEXTURE, SOLAR_MIN_WIDTH_M)
    rhythm = 0.0
    if panels:
        import cv2 as _cv
        count, labels = _cv.connectedComponents(solar_mask, connectivity=8)
        rhythm = max(module_rhythm(lum, labels == k, p) for k in range(1, count))
    # Deck: weathered wood, orange-brown and moderately saturated.
    wood = (hue >= 7) & (hue <= 20) & (sat >= 55) & (sat <= 165) & (val >= 70) & (val <= 205) & (veg < 0.1)
    wood_mask = cv2.morphologyEx((roof & wood).astype(np.uint8), cv2.MORPH_OPEN, k3)
    wood_share = float(wood_mask.sum()) / total
    decks = _rects(wood_mask, p, DECK_MIN_M2, 0.6) if DECK_SHARE[0] <= wood_share <= DECK_SHARE[1] else []
    taken = solar_mask.astype(bool) | wood_mask.astype(bool) | leaves
    lit = roof & ~taken & (lum >= SHADE_LUM)
    if lit.sum() < 0.15 * total:
        lit = roof & ~taken
    if not lit.any():
        return None
    colour = [int(np.median(c[lit])) for c in pix["rgb"]]
    out = {"c": "#{:02x}{:02x}{:02x}".format(*colour), "lit": round(float(lit.sum()) / total, 2),
           "green": round(float(leaves.sum()) / total, 2), "gsd": pix["gsd_m"]}
    if panels:
        area = sum(x[5] for x in panels)
        conf = min(1.0, np.mean([x[6] for x in panels]) * min(1.0, rhythm / 0.6) * min(1.0, area / 12) ** 0.3)
        out["solar"] = {"conf": round(conf, 2), "area_m2": round(area, 1), "rects": panels}
    if decks:
        deck = max(decks, key=lambda x: x[5])
        conf = min(1.0, deck[6] * min(1.0, deck[5] / 8) ** 0.3 * 0.9)
        out["deck"] = {"conf": round(conf, 2), "area_m2": round(deck[5], 1), "rects": [deck]}
    return out


def build(region: str) -> dict:
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds as transform_from
    from rasterio.warp import transform
    from shapely.geometry import Polygon

    site = site_of(region)
    page = json.loads((site / "sf-corridor-3d.json").read_text())
    cache = ortho.SquareCache(region)
    buildings = [w for w in page["ways"] if w.get("kind") == "building" and w.get("osm_id") is not None
                 and len(w.get("points") or []) >= 4]
    # Walk them square by square so the cache holds.
    lon0 = [w["points"][0][0] for w in buildings]
    lat0 = [w["points"][0][1] for w in buildings]
    xs0, ys0 = ortho.to_utm(lon0, lat0)
    order = np.lexsort((np.floor(xs0 / ortho.GRID_M), np.floor(ys0 / ortho.GRID_M)))
    roofs, stats = {}, {"buildings": len(buildings), "read": 0, "solar": 0, "deck": 0, "no_imagery": 0}
    used = set()
    for idx in order:
        way = buildings[idx]
        xs, ys = ortho.to_utm([p[0] for p in way["points"]], [p[1] for p in way["points"]])
        shape = Polygon(zip(xs, ys, strict=True)).buffer(0)
        inner = shape.buffer(-INSET_M)
        if inner.is_empty or inner.area < MIN_ROOF_M2:
            continue
        pix = cache.read(shape.bounds)
        if pix is None:
            stats["no_imagery"] += 1
            continue
        h, w = pix["valid"].shape
        tf = transform_from(*pix["bounds"], w, h)
        mask = rasterize([(inner, 1)], out_shape=(h, w), transform=tf).astype(bool)
        got = read_roof(pix, mask)
        if got is None:
            continue
        # Rectangles to lon/lat and compass bearings.
        bw, _, _, bn = pix["bounds"]
        for key in ("solar", "deck"):
            if key not in got:
                continue
            rects = []
            for cx, cy, length, width, angle, area, _ in got[key]["rects"]:
                ex, ny = bw + (cx + 0.5) * pix["pixel_m"], bn - (cy + 0.5) * pix["pixel_m"]
                (lon,), (lat,) = transform(ortho.CRS, "EPSG:4326", [ex], [ny])
                # Image angle is clockwise from +x (east) with y down; as a compass bearing of the
                # long side: east is 90.
                bearing = (90 + angle) % 180
                rects.append([round(lon, 7), round(lat, 7), round(length, 2), round(width, 2), round(bearing, 1),
                              round(area, 1)])
            got[key]["rects"] = rects
            stats[key] += 1
        roofs[str(way["osm_id"])] = got
        used.update(pix["sources"])
        stats["read"] += 1
    # The survey's colour is cast blue (sky light; the 2025 NOAA mosaic sits ~19 levels bluer than
    # red on a grey roof). Most roofs are grey, white or tar, so the median roof is taken as
    # neutral and every roof is balanced by the same three gains.
    gains = [1.0, 1.0, 1.0]
    colours = np.array([[int(v["c"][k:k + 2], 16) for k in (1, 3, 5)] for v in roofs.values()], float)
    if len(colours) >= 50:
        median = np.median(colours, axis=0)
        gains = (median.mean() / np.maximum(median, 1)).tolist()
        for v in roofs.values():
            rgb = [min(255, round(int(v["c"][k:k + 2], 16) * gains[i])) for i, k in enumerate((1, 3, 5))]
            v["c"] = "#{:02x}{:02x}{:02x}".format(*rgb)
    payload = {"schema": "kerbside.roofs/1", "region": region, "white_balance": [round(g, 3) for g in gains],
               "sources": {k: v for k, v in cache.ortho.manifest["sources"].items() if k in used},
               "stats": stats, "roofs": roofs}
    (site / "sf-corridor-roofs.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    return payload


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--region", default="sf-corridor")
    args = ap.parse_args()
    result = build(args.region)
    print(args.region, result["stats"], flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
