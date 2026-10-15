"""Build the entire connecting landscape from public raster windows and mapped trails.

Install ``.[nature]`` or use an isolated rasterio environment. Raw sources remain in
build/nature (resumable); only validated, hashed derivatives go under docs/nature.
USGS height interpolation is not a new survey. Tree/rock placements are visual inference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds as window_from_bounds

from smc.terrain.nature import LAND_CLASSES, validate_layers, write_array, write_manifest

ROOT = Path(__file__).resolve().parents[1]
DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
TCC = (
    "https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/"
    "USFS_EDW_NLCD_TCC_CONUS/ImageServer"
)
NLCD = (
    "https://usgs.osn.mghpcc.org/hytest/nlcd/annual-nlcd-cu-c1v1/mosaic/"
    "Annual_NLCD_LndCov_2024_CU_C1V1.tif"
)
CACHE = ROOT / "build/nature"
OUT = ROOT / "docs/nature"


def get(url: str, name: str) -> bytes:
    original = Path(name)
    # Requests, not convenient filenames, identify cached source windows. A new extent,
    # camera CRS or epoch must never silently reuse a same-sized old raster.
    key = hashlib.sha256(url.encode()).hexdigest()[:16]
    path = CACHE / f"{original.stem}-{key}{original.suffix}"
    if path.exists():
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as response:
                data = response.read()
            if not data:
                raise ValueError("Empty source response")
            temp = path.with_suffix(path.suffix + ".part")
            temp.write_bytes(data)
            temp.replace(path)
            return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def export(
    service: str,
    bounds: tuple,
    width: int,
    height: int,
    name: str,
    *,
    categorical: bool = False,
    mosaic: dict | None = None,
) -> np.ndarray:
    params = {
        "f": "image",
        "bbox": ",".join(map(str, bounds)),
        "bboxSR": 4326,
        "imageSR": 4326,
        "size": f"{width},{height}",
        "format": "tiff",
        "pixelType": "U8" if categorical else "F32",
        "noDataInterpretation": "esriNoDataMatchAny",
        "interpolation": "RSP_NearestNeighbor" if categorical else "RSP_BilinearInterpolation",
        "adjustAspectRatio": "false",
        "renderingRule": '{"rasterFunction":"None"}',
    }
    if mosaic:
        params["mosaicRule"] = json.dumps(mosaic)
    data = get(service + "/exportImage?" + urllib.parse.urlencode(params), name)
    with rasterio.MemoryFile(data) as mem, mem.open() as ds:
        a = ds.read(1, masked=True)
        if a.shape != (height, width) or np.ma.getmaskarray(a).any():
            raise ValueError(f"{name}: missing pixels or wrong shape: {a.shape}")
        return np.asarray(a)[::-1].copy()  # south-to-north, matching the atlas frame


def landcover(bounds: tuple, width: int, height: int) -> np.ndarray:
    key = hashlib.sha256(json.dumps([NLCD, bounds, width, height]).encode()).hexdigest()[:16]
    path = CACHE / f"landcover-{key}.npy"
    if path.exists():
        a = np.load(path)
        if a.shape == (height, width):
            return a
    transform = from_bounds(*bounds, width, height)
    with (
        rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="120"),
        rasterio.open(NLCD) as ds,
    ):
        source_bounds = transform_bounds("EPSG:4326", ds.crs, *bounds, densify_pts=21)
        window = window_from_bounds(*source_bounds, ds.transform).round_offsets()
        window = rasterio.windows.Window(
            window.col_off - 2,
            window.row_off - 2,
            math.ceil(window.width) + 4,
            math.ceil(window.height) + 4,
        )
        source = ds.read(1, window=window)
        dest = np.zeros((height, width), dtype=np.uint8)
        reproject(
            source,
            dest,
            src_transform=ds.window_transform(window),
            src_crs=ds.crs,
            dst_transform=transform,
            dst_crs="EPSG:4326",
            resampling=Resampling.nearest,
        )
    a = dest[::-1].copy()
    np.save(path, a)
    return a


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--coarse-only", action="store_true")
    args = parser.parse_args()
    perimeter = json.loads((ROOT / "docs/sf-corridor-perimeter.json").read_text())
    frame = dict(perimeter["frame"])
    cols, rows = frame["cols"] + 1, frame["rows"] + 1
    step = frame["step_m"]
    lon = frame["mid_lon"] + frame["x0"] / frame["metres_per_lon"]
    lat = frame["mid_lat"] + frame["y0"] / frame["metres_per_lat"]
    dx, dy = step / frame["metres_per_lon"], step / frame["metres_per_lat"]
    # Export pixels centred on shared mesh vertices, not offset half a cell.
    bounds = (lon - dx / 2, lat - dy / 2, lon + (cols - 0.5) * dx, lat + (rows - 0.5) * dy)
    dem_meta = json.loads(get(DEM + "?f=pjson", "dem-service.json"))
    catalogue_query = urllib.parse.urlencode(
        {
            "f": "json",
            "geometry": json.dumps(
                {
                    "xmin": bounds[0],
                    "ymin": bounds[1],
                    "xmax": bounds[2],
                    "ymax": bounds[3],
                    "spatialReference": {"wkid": 4326},
                }
            ),
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "Name,VerticalDatum,AcquisitionDate,Resolution_X,URL",
            "returnGeometry": "false",
        }
    )
    catalogue = json.loads(get(DEM + "/query?" + catalogue_query, "dem-catalogue.json"))
    if catalogue.get("exceededTransferLimit") or "features" not in catalogue:
        raise ValueError("Incomplete source elevation catalogue")
    OUT.mkdir(parents=True, exist_ok=True)
    write_manifest(OUT / "elevation-sources.json", catalogue)
    tcc_meta = json.loads(get(TCC + "?f=pjson", "canopy-service.json"))
    query = urllib.parse.urlencode(
        {
            "f": "json",
            "where": "beginyear=2024",
            "outFields": "objectid,name,beginyear,endyear",
            "returnGeometry": "false",
        }
    )
    tcc_items = json.loads(get(TCC + "/query?" + query, "canopy-2024-items.json"))
    ids = [f["attributes"]["objectid"] for f in tcc_items.get("features", [])]
    if len(ids) != 1:
        raise ValueError("Cannot resolve an unambiguous 2024 canopy epoch")
    height = export(DEM, bounds, cols, rows, "elevation-40m.tif")
    print("Fetched full atlas elevation", height.shape, flush=True)
    cover = landcover(bounds, cols, rows)
    cover[cover == 250] = 0  # NLCD ocean/non-processing area, never fabricated forest.
    canopy = export(
        TCC,
        bounds,
        cols,
        rows,
        "canopy-2024-40m.tif",
        categorical=True,
        mosaic={"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": ids},
    )
    canopy[canopy > 100] = 255  # preserve source missingness rather than asserting no trees.
    counts = validate_layers(height, cover, canopy)
    arrays = {
        "height": write_array(OUT / "height-40m.bin", np.rint(height * 100).astype("<i4")),
        "cover": write_array(OUT / "cover-40m.bin", cover),
        "canopy": write_array(OUT / "canopy-40m.bin", canopy),
    }
    detail = []
    # Source tiles have a shared global 10 m lattice and one shared edge vertex.
    if not args.coarse_only:
        tile_cells, factor = 200, 4
        fine_cols, fine_rows = (cols - 1) * factor, (rows - 1) * factor
        source_cells = 800  # bounded 8 km exports, split into small 2 km serving tiles
        jobs = [
            (c, r)
            for r in range(0, fine_rows, source_cells)
            for c in range(0, fine_cols, source_cells)
        ]

        def build(job: tuple[int, int]) -> list[dict]:
            c, r = job
            w, h = min(source_cells, fine_cols - c) + 1, min(source_cells, fine_rows - r) + 1
            fx, fy = dx / factor, dy / factor
            b = (
                lon + (c - 0.5) * fx,
                lat + (r - 0.5) * fy,
                lon + (c + w - 0.5) * fx,
                lat + (r + h - 0.5) * fy,
            )
            name = f"source-800-{c}-{r}"
            values = export(DEM, b, w, h, name + ".tif")
            if not np.isfinite(values).all() or values.min() < -500 or values.max() > 4500:
                raise ValueError(f"Invalid elevation in {name}")
            result = []
            for dr in range(0, h - 1, tile_cells):
                for dc in range(0, w - 1, tile_cells):
                    part = values[dr : dr + tile_cells + 1, dc : dc + tile_cells + 1]
                    name = f"h-{(c + dc) // tile_cells}-{(r + dr) // tile_cells}"
                    info = write_array(
                        OUT / "detail" / (name + ".bin"), np.rint(part * 100).astype("<i4")
                    )
                    info.update(c=c + dc, r=r + dr, cols=part.shape[1], rows=part.shape[0])
                    info["file"] = "detail/" + info["file"]
                    result.append(info)
            print(f"Source {c},{r}: {len(result)} serving tiles", flush=True)
            return result

        with ThreadPoolExecutor(max_workers=3) as pool:
            detail = [tile for batch in pool.map(build, jobs) for tile in batch]
    frame.update(cols=cols, rows=rows, alignment="vertices", height_unit_m=0.01)
    manifest = {
        "schema": 1,
        "frame": frame,
        "arrays": arrays,
        "land_classes": LAND_CLASSES,
        "counts": counts,
        "density_cell_m": 100,
        "detail": {"step_m": 10, "tile_cells": 200, "tiles": detail},
        "sources": [
            {
                "id": "usgs-3dep",
                "url": DEM,
                "description": dem_meta["description"],
                "horizontal_crs": "EPSG:4326",
                "vertical_datum": "NAVD 88 where specified; unspecified overview records retained",
                "source_catalogue": "elevation-sources.json",
                "attribution": dem_meta["copyrightText"],
                "rights": "US government public domain",
                "role": "bare-earth elevation, interpolated; not independent surveyed checkpoints",
            },
            {
                "id": "annual-nlcd-2024-c1v1",
                "url": NLCD,
                "epoch": 2024,
                "source_resolution_m": 30,
                "rights": "US government public domain",
                "role": "classified land cover; not measured individual vegetation",
            },
            {
                "id": "usfs-nlcd-tcc-2024-v2025-6",
                "url": TCC,
                "epoch": 2024,
                "source_resolution_m": 30,
                "items": tcc_items["features"],
                "attribution": tcc_meta["copyrightText"],
                "rights": "US government public domain",
                "role": "modelled canopy percentage",
            },
        ],
        "inferred": [
            "individual tree and shrub positions, size, species, rockiness and sand variation"
        ],
        "canonical_city_geometry_modified": False,
        "source_metadata_sha256": hashlib.sha256(
            json.dumps([dem_meta, tcc_meta], sort_keys=True).encode()
        ).hexdigest(),
    }
    write_manifest(OUT / "manifest.json", manifest)
    print(json.dumps(counts, indent=2), flush=True)


if __name__ == "__main__":
    main()
