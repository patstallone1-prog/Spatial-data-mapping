"""The ground under a block, from USGS 3DEP: where the cameras stood, vertically.

A street photograph's own altitude is a phone's GPS or nothing, and San Francisco's streets
climb 30 m in a block, so a flat guess would tip the reconstruction over. The 3DEP elevation
service gives the bare earth at about a metre; a camera stood ``CAMERA_HEIGHT_M`` above it
(a car roof or a raised phone). The alignment only needs this to metres -- it is a prior, and
the mesh's own check against the lidar is what measures the result.
"""

from __future__ import annotations

import io
import time
import urllib.parse
import urllib.request

import numpy as np

from smc.worldmesh.block import Block

DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
CAMERA_HEIGHT_M = 2.2
#: NAVD88 to the WGS84 ellipsoid round the Bay (GEOID18): about -32.5 m. The tileset's origin is
#: on the ellipsoid; this places it to a few decimetres, which only moves the whole block.
GEOID_BAY_M = -32.5


class Ground:
    def __init__(self, heights: np.ndarray, bbox: tuple[float, float, float, float]):
        self.heights, self.bbox = heights, bbox

    def at(self, lon: float, lat: float) -> float:
        west, south, east, north = self.bbox
        rows, cols = self.heights.shape
        x = (lon - west) / (east - west) * (cols - 1)
        y = (north - lat) / (north - south) * (rows - 1)
        x0, y0 = int(np.clip(np.floor(x), 0, cols - 2)), int(np.clip(np.floor(y), 0, rows - 2))
        fx, fy = np.clip(x - x0, 0, 1), np.clip(y - y0, 0, 1)
        h = self.heights
        return float((h[y0, x0] * (1 - fx) + h[y0, x0 + 1] * fx) * (1 - fy)
                     + (h[y0 + 1, x0] * (1 - fx) + h[y0 + 1, x0 + 1] * fx) * fy)


def fetch_ground(block: Block, resolution_m: float = 1.0) -> Ground:
    import rasterio

    bbox = block.halo_bbox()
    west, south, east, north = bbox
    width = max(8, min(4000, round((east - west) * 111_320 * np.cos(np.radians(south)) / resolution_m)))
    height = max(8, min(4000, round((north - south) * 111_320 / resolution_m)))
    params = {"f": "image", "bbox": f"{west},{south},{east},{north}", "bboxSR": 4326, "imageSR": 4326,
              "size": f"{width},{height}", "format": "tiff", "pixelType": "F32",
              "interpolation": "RSP_BilinearInterpolation", "adjustAspectRatio": "false"}
    url = DEM + "/exportImage?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                data = response.read()
            with rasterio.MemoryFile(io.BytesIO(data)) as mem, mem.open() as ds:
                heights = ds.read(1).astype(np.float64)
            if heights.shape != (height, width) or not np.isfinite(heights).all():
                raise ValueError("3DEP answered with missing ground")
            return Ground(heights, bbox)
        except (OSError, ValueError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")
