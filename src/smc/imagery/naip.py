"""Where the ground is green from above: the USDA's NAIP aerial survey, read for vegetation.

NAIP photographs the whole of the United States every two or three years in four bands,
the fourth near-infrared. Leaves reflect near-infrared strongly and absorb red, so the
normalised difference of the two marks vegetation and almost nothing else: not a roof, not a
pole, not an awning, not a box truck -- the things a canopy height model cannot tell from a
crown. The USGS serves it publicly (``USGSNAIPPlus``), at 0.3 m, with a false-colour
composite of near-infrared, red and green; that is all this reads.

The composite is stretched, so the index here is not the radiometric NDVI. It does not need
to be: it is a threshold between leaves and everything else, and the two are far apart.
Public domain (USDA Farm Production and Conservation Business Center).
"""

from __future__ import annotations

import io
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer"
USER_AGENT = "kerbside/naip"
#: The service's own limit on an exported image's side.
MAX_SIDE_PX = 4000
#: Pixels this greener than red in the composite are leaves.
VEGETATION_INDEX = 0.12
TILE_M = 1000.0
#: The service goes down for minutes at a time (504s for every request, its metadata included);
#: a tile still missing after these is read as no aerial evidence (Vegetation.unavailable).
RETRY_S = (5, 20, 60, 120)
GIVE_UP_AFTER = 2


@dataclass
class VegetationRaster:
    """A vegetation index over a lon/lat box; row 0 is the north edge."""

    index: np.ndarray
    west: float
    south: float
    east: float
    north: float

    def sample(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        h, w = self.index.shape
        col = np.floor((np.asarray(lon) - self.west) / (self.east - self.west) * w).astype(int)
        row = np.floor((self.north - np.asarray(lat)) / (self.north - self.south) * h).astype(int)
        inside = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        out = np.full(np.shape(lon), np.nan)
        out[inside] = self.index[row[inside], col[inside]]
        return out


def index_from_composite(rgb: np.ndarray) -> np.ndarray:
    """Near-infrared against red, from the false-colour composite (NIR, red, green)."""
    nir = rgb[..., 0].astype(np.float32)
    red = rgb[..., 1].astype(np.float32)
    return (nir - red) / np.maximum(nir + red, 1.0)


def fetch_tile(west: float, south: float, east: float, north: float, *, pixel_m: float,
               cache: Path | None = None, offline: bool = False) -> VegetationRaster:
    # The image is asked for in degrees, so its sides must be in the box's proportions in
    # degrees: given any other shape the service widens the box to fit, and every pixel lands
    # metres from where it is read.
    height = min(MAX_SIDE_PX, max(1, round((north - south) * 110_540 / pixel_m)))
    width = min(MAX_SIDE_PX, max(1, round(height * (east - west) / (north - south))))
    path = cache / f"{west:.5f}_{south:.5f}_{east:.5f}_{north:.5f}_{pixel_m}.png" if cache else None
    if path and path.exists():
        raw = path.read_bytes()
    elif offline:
        raise urllib.error.URLError("NAIP service given up on for this run")
    else:
        params = {"bbox": f"{west},{south},{east},{north}", "bboxSR": 4326, "imageSR": 4326,
                  "size": f"{width},{height}", "format": "png",
                  "renderingRule": '{"rasterFunction":"FalseColorComposite"}', "f": "image"}
        request = urllib.request.Request(f"{SERVICE}/exportImage?{urllib.parse.urlencode(params)}",
                                         headers={"User-Agent": USER_AGENT})
        for wait in (*RETRY_S, None):
            try:
                raw = urllib.request.urlopen(request, timeout=180).read()
                break
            except (urllib.error.URLError, TimeoutError):
                # The service drops a busy export with a 502 now and then; asked again it answers.
                if wait is None:
                    raise
                time.sleep(wait)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
    from PIL import Image

    rgb = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
    return VegetationRaster(index_from_composite(rgb), west, south, east, north)


class Vegetation:
    """The vegetation index over a region, fetched a kilometre tile at a time and cached."""

    def __init__(self, cache: Path | None = None, pixel_m: float = 0.5):
        self.cache = cache
        self.pixel_m = pixel_m
        self._tiles: dict[tuple[int, int], VegetationRaster] = {}
        self.unavailable: set[tuple[int, int]] = set()
        # When the service is down (504s for every export), each tile spends its retries --
        # near twenty minutes -- before it gives up; after GIVE_UP_AFTER tiles in a row fail,
        # the rest of the run asks no more and reads only what is cached.
        self.failed_in_row = 0
        self.service_down = False

    def _tile(self, ix: int, iy: int) -> VegetationRaster | None:
        """The tile, or None where the service would not give it up after every retry: the
        caller reads that as no aerial evidence, not as bare ground."""
        key = (ix, iy)
        if key in self.unavailable:
            return None
        if key not in self._tiles:
            dlat = TILE_M / 110_540
            south = iy * dlat
            dlon = TILE_M / (111_320 * math.cos(math.radians(south + dlat / 2)))
            west = ix * dlon
            try:
                self._tiles[key] = fetch_tile(west, south, west + dlon, south + dlat,
                                              pixel_m=self.pixel_m, cache=self.cache,
                                              offline=self.service_down)
                self.failed_in_row = 0
            except (urllib.error.URLError, TimeoutError, OSError):
                self.unavailable.add(key)
                if not self.service_down:
                    self.failed_in_row += 1
                    self.service_down = self.failed_in_row >= GIVE_UP_AFTER
                return None
        return self._tiles[key]

    def sample(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        lon, lat = np.atleast_1d(np.asarray(lon, float)), np.atleast_1d(np.asarray(lat, float))
        out = np.full(lon.shape, np.nan)
        dlat = TILE_M / 110_540
        iy = np.floor(lat / dlat).astype(int)
        for y in np.unique(iy):
            south = y * dlat
            dlon = TILE_M / (111_320 * math.cos(math.radians(south + dlat / 2)))
            rows = iy == y
            ix = np.floor(lon[rows] / dlon).astype(int)
            idx = np.flatnonzero(rows)
            for x in np.unique(ix):
                pick = idx[ix == x]
                tile = self._tile(int(x), int(y))
                if tile is not None:
                    out[pick] = tile.sample(lon[pick], lat[pick])
        return out

    def green_share(self, lon: float, lat: float, radius_m: float, step_m: float = 0.5) -> float:
        """The share of a disc that is leaves."""
        r = max(radius_m, step_m)
        offsets = np.arange(-r, r + 1e-6, step_m)
        de, dn = np.meshgrid(offsets, offsets)
        disc = de ** 2 + dn ** 2 <= r * r
        kx = 111_320 * math.cos(math.radians(lat))
        values = self.sample(lon + de[disc] / kx, lat + dn[disc] / 110_540)
        values = values[np.isfinite(values)]
        return float((values > VEGETATION_INDEX).mean()) if len(values) else float("nan")
