"""The lidar a block's mesh is measured against: USGS 3DEP, public domain, read where it lies.

The collections covering the block come from the Entwine index the cells already use
(``build/regions/entwine-index.geojson``, the cloud's ``lidar-index`` input), densest first --
names do not reliably carry a year (``CA_SanFrancisco_1_B23``), and points per area is what the
check needs; the first that holds ground under the block is used. Only hard surfaces are kept --
ground (class 2) and buildings (6) -- because trees and cars move or grow between the flight
and the photographs and would count as the mesh's error. San Francisco's 2023 flight leaves
buildings unclassified (class 1, with the trees), so a class-1 point is kept where its
neighbourhood is a plane -- a wall, a roof -- and dropped where it scatters like foliage.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from smc.lidar.ept import SF_DATASET, EptReader
from smc.worldmesh.block import Block
from smc.worldmesh.ground import GEOID_BAY_M

INDEX = Path("build/regions/entwine-index.geojson")
HARD_SURFACES = (2, 6)
UNCLASSIFIED = 1
RESOLUTION_M = 0.10
#: A neighbourhood is a plane when its thinnest spread is under this share of the whole
#: (walls and roofs: about 0.1-1%; a tree crown: 10-30%).
PLANAR_SHARE = 0.02
NEIGHBOURS = 16


def planar(xyz: np.ndarray) -> np.ndarray:
    """True where a point and its neighbours lie on a plane."""
    if len(xyz) < NEIGHBOURS:
        return np.zeros(len(xyz), bool)
    from scipy.spatial import cKDTree

    _, idx = cKDTree(xyz).query(xyz, k=NEIGHBOURS)
    near = xyz[idx] - xyz[idx].mean(axis=1, keepdims=True)
    cov = np.einsum("nki,nkj->nij", near, near) / NEIGHBOURS
    values = np.linalg.eigvalsh(cov)  # ascending
    return values[:, 0] / np.maximum(values.sum(axis=1), 1e-12) < PLANAR_SHARE


def collections_for(block: Block, root: Path) -> list[str]:
    path = root / INDEX
    if not path.exists():
        return [SF_DATASET]
    from shapely.geometry import Point, shape

    centre = Point((block.west + block.east) / 2, (block.south + block.north) / 2)
    found = []
    for feature in json.loads(path.read_text())["features"]:
        outline = shape(feature["geometry"])
        if outline.contains(centre):
            density = feature["properties"].get("count", 0) / max(outline.area, 1e-12)
            found.append((density, feature["properties"]["name"]))
    return [name for _, name in sorted(found, reverse=True)] or [SF_DATASET]


def points_for(block: Block, root: Path) -> tuple[np.ndarray, str] | tuple[None, None]:
    """Hard-surface returns inside the block, in its east-north-up frame (up from its origin)."""
    centre = block.frame
    w, s, e, n = block.bounds_m()
    radius = math.hypot(e - w, n - s) / 2
    origin_up = block.height_m - GEOID_BAY_M  # the frame's zero, as an orthometric height
    for dataset in collections_for(block, root):
        try:
            cloud = EptReader(dataset, cache=False).around(centre.lat, centre.lon, radius, resolution_m=RESOLUTION_M)
        except OSError:
            continue
        if not np.any(cloud.classification == 2):
            continue
        inside = (cloud.east >= w) & (cloud.east < e) & (cloud.north >= s) & (cloud.north < n)
        xyz = np.column_stack((cloud.east, cloud.north, cloud.up - origin_up))
        hard = inside & np.isin(cloud.classification, HARD_SURFACES)
        loose = np.flatnonzero(inside & (cloud.classification == UNCLASSIFIED))
        hard[loose[planar(xyz[loose])]] = True
        return xyz[hard], dataset
    return None, None
