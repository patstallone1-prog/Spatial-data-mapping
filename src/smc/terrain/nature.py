"""Contracts for source-backed landscape, separate from canonical city measurements.

Raster heights describe the bare earth, land cover describes a 30 m classification,
canopy describes estimated area coverage. None identifies an individual tree or rock.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

LAND_CLASSES = {
    0: "unknown",
    11: "water",
    12: "snow_ice",
    21: "developed_open",
    22: "developed_low",
    23: "developed_medium",
    24: "developed_high",
    31: "barren",
    41: "deciduous_forest",
    42: "evergreen_forest",
    43: "mixed_forest",
    52: "shrub_scrub",
    71: "grass_herbaceous",
    81: "pasture",
    82: "crops",
    90: "woody_wetland",
    95: "herbaceous_wetland",
}


def write_array(path: Path, values: np.ndarray) -> dict:
    """Deterministic little-endian arrays; publish compressed bytes, not lossy textures."""
    raw = values.astype(values.dtype.newbyteorder("<")).tobytes(order="C")
    encoded = gzip.compress(raw, compresslevel=6, mtime=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(encoded)
    temporary.replace(path)
    return {
        "file": path.name,
        "encoding": "gzip",
        "dtype": values.dtype.str,
        "bytes": len(encoded),
        "decoded_bytes": len(raw),
        "sha256": hashlib.sha256(encoded).hexdigest(),
    }


def validate_layers(height: np.ndarray, cover: np.ndarray, canopy: np.ndarray) -> dict:
    if not (height.shape == cover.shape == canopy.shape):
        raise ValueError("Landscape layers must share one georeferenced grid")
    if not np.isfinite(height).all() or height.min() < -500 or height.max() > 4500:
        raise ValueError("Invalid/missing elevation; do not publish a fabricated flat cell")
    if not set(np.unique(cover)).issubset(LAND_CLASSES):
        raise ValueError("Unknown land-cover code")
    if ((canopy > 100) & (canopy != 255)).any():
        raise ValueError("Canopy nodata must remain explicitly unknown (255), not zero density")
    return {
        "nodes": height.size,
        "height_range_m": [float(height.min()), float(height.max())],
        "cover_nodes": {
            LAND_CLASSES[int(k)]: int(v)
            for k, v in zip(*np.unique(cover, return_counts=True), strict=True)
        },
        "canopy_unknown_nodes": int((canopy == 255).sum()),
        "mean_canopy_percent": float(canopy[canopy <= 100].mean()),
    }


def write_manifest(path: Path, manifest: dict) -> None:
    """Manifest last: an interrupted fetch is never advertised as an empty measured cell."""
    temporary = path.with_suffix(".json.part")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
