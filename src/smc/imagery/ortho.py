"""Aerial photographs of a region, the sharpest public one for each piece of ground.

The ground is cut into 250 m squares on the UTM 10N grid (EPSG:6339, NAD83(2011)) and each square
takes the finest source that covers all of it:

* **OpenAerialMap** drone mosaics, 2-5 cm, CC-BY 4.0 -- scattered (Church Street 2025, Dogpatch,
  Oakland's Brooklyn Basin); read at 0.1 m, true colour only;
* **NOAA NGS 2025** four-band mosaic of San Francisco, Oakland and Richmond, 0.25 m, flown
  5-8 February 2025, CC0 -- most of San Francisco, Oakland, Berkeley, Alameda and Emeryville;
  read straight out of NOAA's cloud-optimised GeoTIFFs a window at a time;
* **NAIP 2022**, 0.6 m, four bands, public domain (USDA), from the USGS image service --
  everywhere else (the Peninsula, the South Bay).

Each square is kept as two JPEG GeoTIFFs, true colour and near-infrared (where the source has
it), under ``data/ortho/<region>/``, with a manifest saying which source, how sharp, when flown
and under what licence. A source that is down is skipped for the next one rather than waited on.
"""

from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "ortho"
CRS = "EPSG:6339"
GRID_M = 250.0
USER_AGENT = "kerbside/ortho"
#: Of a square, the share a source must cover to be used for it.
FULL_COVER = 0.995
WORKERS = 8


@dataclass(frozen=True)
class Source:
    key: str
    name: str
    gsd_m: float
    licence: str
    attribution: str
    flown: str
    bands: str


NOAA_SF_2025 = Source(
    "noaa-sf-2025", "NOAA NGS DSS 4-band mosaic: San Francisco, Oakland and Richmond", 0.25,
    "CC0-1.0", "NOAA National Geodetic Survey", "2025-02-05/2025-02-08", "rgbn")
NAIP_2022 = Source(
    "naip-2022", "USDA NAIP, California 2022", 0.6, "Public domain",
    "USDA Farm Production and Conservation Business Center, via USGS The National Map",
    "2022-05", "rgbn")
NOAA_BASE = "https://coastalimagery.blob.core.windows.net/digitalcoast/SanFranciscoCA_RGBN_2025_10318/"
NAIP_SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
OAM_SEARCH = "https://api.openaerialmap.org/meta"
#: Drone mosaics older than this are not preferred to the 2025 survey: streets change.
OAM_SINCE = "2020-01-01"
OAM_READ_M = 0.1
#: GDAL's remote reads (NOAA's and the drone mosaics' cloud-optimised GeoTIFFs) with a deadline.
#: Without one a stalled connection waits forever: a 2 km cell's fetch sat for 70 minutes.
REMOTE = {"GDAL_HTTP_TIMEOUT": 60, "GDAL_HTTP_CONNECTTIMEOUT": 15, "GDAL_HTTP_MAX_RETRY": 3,
          "GDAL_HTTP_RETRY_DELAY": 2}


def _get(url: str, timeout: float = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for wait in (0, 5, 20):
        time.sleep(wait)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as reply:
                return reply.read()
        except OSError:
            continue
    raise OSError(f"no answer from {url}")


def squares(bbox: dict) -> list[tuple[int, int]]:
    """The grid squares (column, row of their south-west corner) a lon/lat box touches."""
    from rasterio.warp import transform_bounds

    w, s, e, n = transform_bounds("EPSG:4326", CRS, bbox["west"], bbox["south"], bbox["east"], bbox["north"])
    return [(i, j) for i in range(math.floor(w / GRID_M), math.ceil(e / GRID_M))
            for j in range(math.floor(s / GRID_M), math.ceil(n / GRID_M))]


def square_bounds(sq: tuple[int, int]) -> tuple[float, float, float, float]:
    return sq[0] * GRID_M, sq[1] * GRID_M, (sq[0] + 1) * GRID_M, (sq[1] + 1) * GRID_M


# ---- NOAA ---------------------------------------------------------------------------------------
_noaa_index: list[tuple[str, tuple[float, float, float, float]]] | None = None


def noaa_tiles() -> list[tuple[str, tuple[float, float, float, float]]]:
    """NOAA's 3 km tiles: the URL and its UTM bounds, read off the name (``<east>e<north>n``,
    the north-west corner)."""
    global _noaa_index
    if _noaa_index is None:
        names = [u for u in _get(NOAA_BASE + "urllist10318.txt").decode().split() if u.endswith(".tif")]
        _noaa_index = []
        for url in names:
            stem = url.rsplit("/", 1)[1][:-4]
            east, north = int(stem.split("e")[0]), int(stem.split("e")[1].rstrip("n"))
            _noaa_index.append((url, (east, north - 3000, east + 3000, north)))
    return _noaa_index


def read_noaa(bounds: tuple[float, float, float, float]) -> tuple[np.ndarray, float] | None:
    """RGBN at 0.25 m over ``bounds``, and the share of it the survey covers."""
    import rasterio
    from rasterio.windows import from_bounds

    w, s, e, n = bounds
    size = round((e - w) / NOAA_SF_2025.gsd_m)
    out = np.zeros((5, size, size), np.uint8)
    for url, (tw, ts, te, tn) in noaa_tiles():
        if te <= w or tw >= e or tn <= s or ts >= n:
            continue
        with rasterio.Env(**REMOTE), rasterio.open("/vsicurl/" + url) as src:
            part = src.read(window=from_bounds(w, s, e, n, src.transform), boundless=True, fill_value=0,
                            out_shape=(src.count, size, size))
        fresh = part[4] > out[4]
        out[:, fresh] = part[:, fresh]
    cover = float((out[4] > 0).mean())
    return (out[:4], cover) if cover > 0 else None


# ---- NAIP ---------------------------------------------------------------------------------------
def read_naip(bounds: tuple[float, float, float, float]) -> tuple[np.ndarray, float] | None:
    import rasterio

    w, s, e, n = bounds
    size = round((e - w) / NAIP_2022.gsd_m)
    query = urllib.parse.urlencode({
        "bbox": f"{w},{s},{e},{n}", "bboxSR": 6339, "imageSR": 6339, "size": f"{size},{size}",
        "format": "tiff", "pixelType": "U8", "interpolation": "RSP_BilinearInterpolation", "f": "image"})
    raw = _get(f"{NAIP_SERVICE}?{query}", timeout=120)
    with rasterio.MemoryFile(raw) as memory, memory.open() as src:
        data = src.read()
    if data.shape[0] < 4:
        return None
    cover = float((data[:3].max(0) > 0).mean())
    return data[:4], cover


# ---- OpenAerialMap ------------------------------------------------------------------------------
def oam_images(bbox: dict) -> list[dict]:
    """Recent drone and aerial mosaics over the box, finest first."""
    query = urllib.parse.urlencode({"bbox": f"{bbox['west']},{bbox['south']},{bbox['east']},{bbox['north']}",
                                    "limit": 200, "acquisition_from": OAM_SINCE})
    try:
        results = json.loads(_get(f"{OAM_SEARCH}?{query}"))["results"]
    except (OSError, ValueError, KeyError):
        return []
    keep = [r for r in results if r.get("uuid", "").endswith(".tif")
            and "CC-BY" in str(r.get("properties", {}).get("license") or r.get("license") or "CC-BY")]
    return sorted(keep, key=lambda r: r.get("gsd") or 1)


def read_oam(image: dict, bounds: tuple[float, float, float, float]) -> tuple[np.ndarray, float] | None:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds as transform_from
    from rasterio.vrt import WarpedVRT

    w, s, e, n = bounds
    size = round((e - w) / OAM_READ_M)
    # The warp is made onto the square itself: a warped VRT will not read outside its own frame.
    with rasterio.Env(**REMOTE), rasterio.open("/vsicurl/" + image["uuid"]) as src, \
            WarpedVRT(src, crs=CRS, transform=transform_from(w, s, e, n, size, size), width=size, height=size,
                      resampling=Resampling.average, nodata=0) as vrt:
        data = vrt.read()
    if data.shape[0] < 3:
        return None
    valid = data[3] > 0 if data.shape[0] >= 4 else data[:3].max(0) > 0
    return data[:3], float(valid.mean())


def oam_source(image: dict) -> Source:
    return Source(f"oam-{image.get('_id', 'image')}", f"OpenAerialMap: {image.get('title', '')}",
                  round(float(image.get("gsd") or OAM_READ_M), 3), "CC-BY-4.0",
                  f"{image.get('provider', 'OpenAerialMap contributor')} via OpenAerialMap",
                  str(image.get("acquisition_end", ""))[:10], "rgb")


# ---- the squares ----------------------------------------------------------------------------------
def _write(path: Path, bands: np.ndarray, bounds: tuple[float, float, float, float]) -> None:
    import rasterio
    from rasterio.transform import from_bounds as transform_from

    count, height, width = bands.shape
    profile = {"driver": "GTiff", "width": width, "height": height, "count": count, "dtype": "uint8",
               "crs": CRS, "transform": transform_from(*bounds, width, height), "compress": "jpeg",
               "jpeg_quality": 90, "tiled": True, "blockxsize": 256, "blockysize": 256}
    if count == 3:
        profile["photometric"] = "ycbcr"
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(bands)


def fetch_square(region: str, sq: tuple[int, int], oam: list[dict]) -> dict | None:
    """The square's sharpest full cover, written to disk; its manifest row."""
    from rasterio.warp import transform_bounds

    bounds = square_bounds(sq)
    folder = OUT / region
    stem = f"{sq[0]}_{sq[1]}"
    ll = transform_bounds(CRS, "EPSG:4326", *bounds)
    candidates = []
    for image in oam:
        b = image.get("bbox") or [0, 0, 0, 0]
        if b[0] <= ll[0] and b[1] <= ll[1] and b[2] >= ll[2] and b[3] >= ll[3]:
            candidates.append((oam_source(image), lambda image=image: read_oam(image, bounds)))
    candidates += [(NOAA_SF_2025, lambda: read_noaa(bounds)), (NAIP_2022, lambda: read_naip(bounds))]
    for source, read in candidates:
        try:
            got = read()
        except Exception:  # a source that will not answer is passed over for the next
            continue
        if got is None or got[1] < FULL_COVER:
            continue
        bands, cover = got
        _write(folder / f"{stem}.rgb.tif", bands[:3], bounds)
        if bands.shape[0] >= 4:
            _write(folder / f"{stem}.nir.tif", bands[3:4], bounds)
        return {"square": list(sq), "bounds_utm": list(bounds), "bounds_ll": [round(v, 7) for v in ll],
                "source": source.key, "gsd_m": source.gsd_m, "pixels": int(bands.shape[1]),
                "nir": bands.shape[0] >= 4, "cover": round(cover, 4)}
    return None


def fetch_region(region: str, bbox: dict, *, workers: int = WORKERS, refresh: bool = False,
                 drone: bool = True) -> dict:
    """The region's squares. ``drone=False`` passes over OpenAerialMap's mosaics: a reading that
    wants a roof's colour, not a kerb's edge, gains nothing at 0.1 m over NOAA's or NAIP's, and a
    mosaic's 0.1 m window of a far-off file is the slowest read there is."""
    folder = OUT / region
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = folder / "manifest.json"
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() and not refresh else {"squares": []}
    done = {tuple(r["square"]): r for r in old["squares"] if (folder / f"{r['square'][0]}_{r['square'][1]}.rgb.tif").exists()}
    todo = [sq for sq in squares(bbox) if sq not in done]
    oam = oam_images(bbox) if drone else []
    sources = {s.key: asdict(s) for s in (NOAA_SF_2025, NAIP_2022)}
    sources.update({oam_source(i).key: asdict(oam_source(i)) for i in oam})
    with ThreadPoolExecutor(workers) as pool:
        for row in pool.map(lambda sq: fetch_square(region, sq, oam), todo):
            if row:
                done[tuple(row["square"])] = row
    rows = sorted(done.values(), key=lambda r: r["square"])
    used = {r["source"] for r in rows}
    manifest = {"schema": "kerbside.ortho/1", "region": region, "crs": CRS, "grid_m": GRID_M,
                "sources": {k: v for k, v in sources.items() if k in used}, "squares": rows,
                "missing": [list(sq) for sq in squares(bbox) if sq not in done]}
    manifest_path.write_text(json.dumps(manifest, indent=1))
    return manifest


# ---- reading it back ----------------------------------------------------------------------------
class Ortho:
    """A region's squares, read back for the analyses: pixels over a UTM box, at the finest
    resolution any square there has, resampled to ``pixel_m``."""

    def __init__(self, region: str):
        self.folder = OUT / region
        self.manifest = json.loads((self.folder / "manifest.json").read_text())
        self.rows = {tuple(r["square"]): r for r in self.manifest["squares"]}

    def read(self, bounds: tuple[float, float, float, float], pixel_m: float = 0.25) -> dict | None:
        """{'rgb': (3,h,w), 'nir': (h,w) or None, 'valid': (h,w), 'gsd_m': coarsest source
        read, 'sources': [...]} over a UTM box."""
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.windows import from_bounds

        w, s, e, n = bounds
        width, height = max(1, round((e - w) / pixel_m)), max(1, round((n - s) / pixel_m))
        rgb = np.zeros((3, height, width), np.uint8)
        nir = np.zeros((height, width), np.uint8)
        valid = np.zeros((height, width), bool)
        has_nir = np.zeros((height, width), bool)
        gsd, used = 0.0, set()
        for i in range(math.floor(w / GRID_M), math.ceil(e / GRID_M)):
            for j in range(math.floor(s / GRID_M), math.ceil(n / GRID_M)):
                row = self.rows.get((i, j))
                if row is None:
                    continue
                stem = self.folder / f"{i}_{j}"
                with rasterio.open(f"{stem}.rgb.tif") as src:
                    win = from_bounds(w, s, e, n, src.transform)
                    part = src.read(window=win, boundless=True, fill_value=0, out_shape=(3, height, width),
                                    resampling=Resampling.bilinear)
                inside = _inside_mask(bounds, square_bounds((i, j)), width, height)
                rgb[:, inside] = part[:, inside]
                valid |= inside
                if row["nir"]:
                    with rasterio.open(f"{stem}.nir.tif") as src:
                        band = src.read(1, window=from_bounds(w, s, e, n, src.transform), boundless=True,
                                        fill_value=0, out_shape=(height, width), resampling=Resampling.bilinear)
                    nir[inside] = band[inside]
                    has_nir |= inside
                gsd = max(gsd, row["gsd_m"])
                used.add(row["source"])
        if not valid.any():
            return None
        return {"rgb": rgb, "nir": nir if has_nir.all() else None, "valid": valid, "gsd_m": gsd,
                "sources": sorted(used), "bounds": bounds, "pixel_m": pixel_m}


def _inside_mask(box, square, width, height) -> np.ndarray:
    w, s, e, n = box
    xs = w + (np.arange(width) + 0.5) * (e - w) / width
    ys = n - (np.arange(height) + 0.5) * (n - s) / height
    return ((ys[:, None] >= square[1]) & (ys[:, None] < square[3])
            & (xs[None, :] >= square[0]) & (xs[None, :] < square[2]))


def to_utm(lon, lat):
    from rasterio.warp import transform

    xs, ys = transform("EPSG:4326", CRS, list(np.atleast_1d(lon)), list(np.atleast_1d(lat)))
    return np.asarray(xs), np.asarray(ys)


def vegetation_index(rgb: np.ndarray, nir: np.ndarray | None) -> np.ndarray:
    """NDVI where there is near-infrared, a green-excess index scaled alike where there is not."""
    r, g, b = (c.astype(np.float32) for c in rgb)
    if nir is not None:
        n = nir.astype(np.float32)
        return (n - r) / np.maximum(n + r, 1)
    return (2 * g - r - b) / np.maximum(r + g + b, 1) * 1.5



class SquareCache:
    """A region's squares decoded once and kept (the last ``keep`` of them), all on one 0.25 m
    grid, so a box is read by slicing: for walking every building of a region."""

    PIXEL_M = 0.25

    def __init__(self, region: str, keep: int = 24):
        from collections import OrderedDict

        self.ortho = Ortho(region)
        self.keep = keep
        self._cache: OrderedDict = OrderedDict()

    def square(self, sq: tuple[int, int]):
        if sq in self._cache:
            self._cache.move_to_end(sq)
            return self._cache[sq]
        row = self.ortho.rows.get(sq)
        got = None
        if row is not None:
            import cv2
            import rasterio

            size = round(GRID_M / self.PIXEL_M)
            stem = self.ortho.folder / f"{sq[0]}_{sq[1]}"
            with rasterio.open(f"{stem}.rgb.tif") as src:
                rgb = src.read()
            nir = None
            if row["nir"]:
                with rasterio.open(f"{stem}.nir.tif") as src:
                    nir = src.read(1)
            if rgb.shape[1] != size:
                rgb = np.stack([cv2.resize(b, (size, size), interpolation=cv2.INTER_AREA if rgb.shape[1] > size
                                           else cv2.INTER_LINEAR) for b in rgb])
                if nir is not None:
                    nir = cv2.resize(nir, (size, size), interpolation=cv2.INTER_LINEAR)
            got = (rgb, nir, row)
        self._cache[sq] = got
        if len(self._cache) > self.keep:
            self._cache.popitem(last=False)
        return got

    def read(self, bounds: tuple[float, float, float, float]) -> dict | None:
        p = self.PIXEL_M
        w, s, e, n = (math.floor(bounds[0] / p) * p, math.floor(bounds[1] / p) * p,
                      math.ceil(bounds[2] / p) * p, math.ceil(bounds[3] / p) * p)
        width, height = round((e - w) / p), round((n - s) / p)
        rgb = np.zeros((3, height, width), np.uint8)
        nir = np.zeros((height, width), np.uint8)
        valid = np.zeros((height, width), bool)
        all_nir, gsd, used = True, 0.0, set()
        size = round(GRID_M / p)
        for i in range(math.floor(w / GRID_M), math.ceil(e / GRID_M)):
            for j in range(math.floor(s / GRID_M), math.ceil(n / GRID_M)):
                got = self.square((i, j))
                if got is None:
                    continue
                srgb, snir, row = got
                sw, sn = i * GRID_M, (j + 1) * GRID_M
                c0, c1 = max(0, round((w - sw) / p)), min(size, round((e - sw) / p))
                r0, r1 = max(0, round((sn - n) / p)), min(size, round((sn - s) / p))
                if c0 >= c1 or r0 >= r1:
                    continue
                x0, y0 = round((sw - w) / p) + c0, round((n - sn) / p) + r0
                rgb[:, y0:y0 + r1 - r0, x0:x0 + c1 - c0] = srgb[:, r0:r1, c0:c1]
                valid[y0:y0 + r1 - r0, x0:x0 + c1 - c0] = True
                if snir is not None:
                    nir[y0:y0 + r1 - r0, x0:x0 + c1 - c0] = snir[r0:r1, c0:c1]
                else:
                    all_nir = False
                gsd = max(gsd, row["gsd_m"])
                used.add(row["source"])
        if not valid.any():
            return None
        return {"rgb": rgb, "nir": nir if all_nir else None, "valid": valid, "gsd_m": gsd,
                "sources": sorted(used), "bounds": (w, s, e, n), "pixel_m": p}


class OrthoVegetation:
    """``smc.imagery.naip.Vegetation``'s questions answered from a region's photographs
    (0.25 m where NOAA flew), falling back to NAIP's service outside them."""

    def __init__(self, region: str, fallback=None):
        self.cache = SquareCache(region)
        self.fallback = fallback

    def green_share(self, lon: float, lat: float, radius_m: float, step_m: float = 0.5) -> float:
        (x,), (y,) = to_utm([lon], [lat])
        r = max(radius_m, step_m)
        pix = self.cache.read((x - r, y - r, x + r, y + r))
        if pix is None or not pix["valid"].all():
            return self.fallback.green_share(lon, lat, radius_m, step_m) if self.fallback else float("nan")
        h, w = pix["valid"].shape
        yy, xx = np.mgrid[0:h, 0:w]
        disc = (xx + 0.5 - w / 2) ** 2 + (yy + 0.5 - h / 2) ** 2 <= (r / pix["pixel_m"]) ** 2
        leaves = vegetation_index(pix["rgb"], pix["nir"]) > 0.2
        if pix["nir"] is not None:
            leaves &= pix["nir"] >= 45
        return float(leaves[disc].mean())
