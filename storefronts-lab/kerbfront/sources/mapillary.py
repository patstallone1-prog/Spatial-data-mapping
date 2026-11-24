"""Mapillary frames, thumbnails and segmentation detections.

Frames come live from the Graph API (``/images?bbox=``) because the main checkout's catalogue
(``data/sf_corridor_mapillary_dense``, swept 2026-09) misses recent captures: one Chestnut block
had 71 frames from 2026 live and none in the catalogue. The catalogue remains an offline
fallback. Positions and headings prefer the structure-from-motion solution
(``computed_geometry`` / ``computed_compass_angle``) over raw GPS/compass.

The bbox endpoint undersamples large boxes (see ``TILE_DEG``), so areas are swept in ~70 m
tiles. Imagery is CC BY-SA 4.0, (c) Mapillary contributors. Pixels stay in the cache, uncommitted.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path

from ..config import CACHE, BBox, kerbside_root, secret
from .http import get_bytes, get_json

API = "https://graph.mapillary.com"
FIELDS = ("id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,"
          "camera_type,camera_parameters,width,height,sequence,quality_score,is_pano")
#: The bbox endpoint answers large boxes with a *sample*, not every frame: measured 2026-11-23
#: on Chestnut, one 0.0025-degree tile returned 650 frames, its four 0.00125 quarters 2,159
#: and sixteen 0.000625 tiles 2,294 (64 smaller tiles found no more). Tiles are ~70 m.
TILE_DEG = 0.000625
PAGE = 2000


def _token() -> str:
    tok = secret("MAPILLARY_TOKEN") or secret("MAPILLARY_ACCESS_TOKEN")
    if not tok:
        raise RuntimeError("MAPILLARY_TOKEN is not set (env or the main checkout's .env.local)")
    return tok


def hfov_deg(camera_type: str | None, params: list | None, width: int | None,
             height: int | None) -> float:
    """Horizontal field of view. Spherical frames see 360; unknown lenses get 70."""
    if camera_type in ("spherical", "equirectangular"):
        return 360.0
    if params and width and height and params[0]:
        f_px = float(params[0]) * max(width, height)
        return math.degrees(2 * math.atan(width / 2 / f_px))
    return 70.0


def normalize(row: dict) -> dict | None:
    geom = row.get("computed_geometry") or row.get("geometry")
    if not geom:
        return None
    lon, lat = geom["coordinates"][:2]
    heading = row.get("computed_compass_angle")
    src = "sfm"
    if heading is None:
        heading, src = row.get("compass_angle"), "compass"
    if heading is None:
        return None
    ctype = row.get("camera_type") or ("spherical" if row.get("is_pano") else "perspective")
    when = row.get("captured_at")
    if isinstance(when, (int, float)):
        when = datetime.fromtimestamp(when / 1000, timezone.utc).isoformat(timespec="seconds")
    return {"id": str(row["id"]), "lon": lon, "lat": lat, "heading": float(heading) % 360,
            "heading_source": src, "position_source": "sfm" if row.get("computed_geometry")
            else "gps", "captured_at": when, "camera_type": ctype,
            "width": row.get("width"), "height": row.get("height"),
            "hfov": hfov_deg(ctype, row.get("camera_parameters"), row.get("width"),
                             row.get("height")),
            "sequence": (row.get("sequence") or {}).get("id") if isinstance(row.get("sequence"), dict)
            else row.get("sequence"), "quality_score": row.get("quality_score")}


def _tiles(b: BBox, step: float):
    lat = b.south
    while lat < b.north:
        lon = b.west
        while lon < b.east:
            yield BBox(lat, lon, min(lat + step, b.north), min(lon + step, b.east))
            lon += step
        lat += step


def frames_live(b: BBox, refresh: bool = False, step: float = TILE_DEG,
                depth: int = 0, workers: int = 6) -> tuple[list[dict], dict]:
    from concurrent.futures import ThreadPoolExecutor

    tok = _token()

    def one(t: BBox) -> dict:
        return get_json("mapillary", f"{API}/images",
                        {"access_token": tok, "fields": FIELDS, "limit": PAGE,
                         "bbox": f"{t.west},{t.south},{t.east},{t.north}"}, refresh=refresh)

    tiles = list(_tiles(b, step))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        recs = list(pool.map(one, tiles))
    seen: dict[str, dict] = {}
    retrieved = None
    for t, rec in zip(tiles, recs):
        retrieved = retrieved or rec["retrieved_at"]
        data = rec["body"].get("data", [])
        if len(data) >= PAGE and depth < 3:          # saturated tile: split it
            sub, _ = frames_live(t, refresh, step / 2, depth + 1, workers)
            seen.update({f["id"]: f for f in sub})
            continue
        for row in data:
            f = normalize(row)
            if f:
                seen[f["id"]] = f
    return list(seen.values()), {"dataset": "mapillary-graph-v4", "url": f"{API}/images",
                                 "retrieved_at": retrieved, "licence": "CC BY-SA 4.0",
                                 "tiles": len(tiles), "tile_deg": step}


def frames_catalogue(b: BBox) -> tuple[list[dict], dict]:
    """The main checkout's September sweep, normalized to the live schema (offline fallback)."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    path = kerbside_root() / "data/sf_corridor_mapillary_dense/observations/external-000.parquet"
    cols = ["provider_image_id", "provider_sequence_id", "captured_at", "latitude", "longitude",
            "heading_deg", "projection_type", "original_width", "original_height",
            "horizontal_fov", "quality_score", "eligible"]
    t = pq.read_table(path, columns=cols)
    m = pc.and_(pc.and_(pc.greater_equal(t["latitude"], b.south), pc.less_equal(t["latitude"], b.north)),
                pc.and_(pc.greater_equal(t["longitude"], b.west), pc.less_equal(t["longitude"], b.east)))
    out = []
    for r in t.filter(m).to_pylist():
        if r["heading_deg"] is None or not r["eligible"]:
            continue
        ctype = r["projection_type"] or "perspective"
        out.append({"id": r["provider_image_id"], "lon": r["longitude"], "lat": r["latitude"],
                    "heading": r["heading_deg"] % 360, "heading_source": "catalogue",
                    "position_source": "catalogue", "captured_at": r["captured_at"].isoformat()
                    if r["captured_at"] else None, "camera_type": ctype,
                    "width": r["original_width"], "height": r["original_height"],
                    "hfov": 360.0 if ctype == "spherical" else (r["horizontal_fov"] or 70.0),
                    "sequence": r["provider_sequence_id"], "quality_score": r["quality_score"]})
    return out, {"dataset": "kerbside-mapillary-catalogue-2026-09", "url": str(path.name),
                 "retrieved_at": "2026-09-06", "licence": "CC BY-SA 4.0"}


def thumbnail(image_id: str, size: int | str = 2048) -> Path:
    """A cached JPEG: size 256/1024/2048 or "original"."""
    tok = _token()
    meta = get_json("mapillary-meta", f"{API}/{image_id}",
                    {"access_token": tok, "fields": f"thumb_{size}_url,width,height"})
    url = meta["body"].get(f"thumb_{size}_url")
    if not url:
        raise RuntimeError(f"no thumb_{size}_url for {image_id}")
    dest = CACHE / "thumbs" / f"{image_id}_{size}.jpg"
    try:
        return get_bytes("mapillary", url, dest)
    except RuntimeError:  # signed URLs expire: ask again once
        meta = get_json("mapillary-meta", f"{API}/{image_id}",
                        {"access_token": tok, "fields": f"thumb_{size}_url,width,height"},
                        refresh=True)
        return get_bytes("mapillary", meta["body"][f"thumb_{size}_url"], dest)


def detections(image_id: str) -> list[dict]:
    """[{"value": class, "rings": [[(x, y) normalized image coords], ...]}]."""
    from ..photos.mvt import rings

    rec = get_json("mapillary-det", f"{API}/{image_id}/detections",
                   {"access_token": _token(), "fields": "value,geometry"})
    out = []
    for d in rec["body"].get("data", []):
        try:
            out.append({"value": d["value"], "rings": rings(d["geometry"])})
        except (KeyError, ValueError, IndexError):
            continue
    return out
