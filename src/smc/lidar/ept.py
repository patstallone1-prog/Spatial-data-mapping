"""Read USGS 3DEP point clouds out of the public Entwine tiles.

The 3D Elevation Program flew San Francisco at roughly seventy points per square metre and put
the result in a public AWS bucket as an Entwine octree. It is a work of the United States
government, so it is in the public domain: no registration, no licence to accept, no
non-commercial clause to inherit. That matters more than it sounds, because it is the only
property that separates this from every autonomous-vehicle dataset covering the same streets.

An Entwine tree is addressed by ``depth-x-y-z``. Each node holds a subsample of its cube at a
fixed grid resolution, and the levels are cumulative: the cloud at depth *d* is every node from
the root down to *d*, not the nodes at *d* alone. Nodes are listed in hierarchy pages, and a
page entry of ``-1`` means "the listing continues in a page of its own at this key".

One trap is worth naming up front, because it is silent. This tree is stored in EPSG:3857, and
Web Mercator's horizontal unit is not a metre -- it is a metre divided by the cosine of the
latitude. Z, meanwhile, is a true orthometric metre. At San Francisco's latitude the two differ
by 27%. Mixing them yields kerb heights that look plausible and footway widths that are wrong
by a quarter, which is exactly the kind of error that survives review. Everything leaving this
module is therefore converted to a local east/north/up frame in true metres.
"""

from __future__ import annotations

import io
import json
import math
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np

#: The 3DEP public bucket. Requester-pays does not apply here; this mirror is free to read.
USGS_LIDAR_PUBLIC = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public"

#: The San Francisco collection. Its cube covers the whole city and then some.
SF_DATASET = "CA_SanFrancisco_1_B23"

#: ASPRS classification codes. Only these two carry ground truth about a kerb: the classifier's
#: "ground" is the road and footway surface, and unclassified holds what it declined to call
#: ground -- which at a kerb face is often the kerb itself.
CLASS_UNCLASSIFIED = 1
CLASS_GROUND = 2
CLASS_NOISE = 7

EARTH_RADIUS_M = 6_378_137.0
_MERC_MAX = math.pi * EARTH_RADIUS_M


def to_web_mercator(lat: float, lon: float) -> tuple[float, float]:
    x = math.radians(lon) * EARTH_RADIUS_M
    y = math.log(math.tan(math.pi / 4.0 + math.radians(lat) / 2.0)) * EARTH_RADIUS_M
    return x, y


def mercator_metres_per_true_metre(lat: float) -> float:
    """Web Mercator's scale distortion at a latitude.

    A horizontal metre in EPSG:3857 is shorter than a real one by the cosine of the latitude.
    Multiply true metres by this to get Mercator units; divide to come back.
    """
    return 1.0 / math.cos(math.radians(lat))


@dataclass(frozen=True, slots=True)
class LocalCloud:
    """Points in a local east/north/up frame, in true metres, about a stated origin."""

    east: np.ndarray
    north: np.ndarray
    up: np.ndarray
    classification: np.ndarray
    origin_lat: float
    origin_lon: float

    def __len__(self) -> int:
        return int(self.east.size)

    @property
    def xyz(self) -> np.ndarray:
        return np.column_stack((self.east, self.north, self.up))

    def ground(self) -> LocalCloud:
        """Ground returns only.

        The tempting alternative is to keep unclassified returns too, on the theory that a
        near-vertical kerb face is the sort of thing a ground classifier declines to label. In
        this collection that is wrong and expensively so: class 1 holds three quarters of the
        points and is dominated by building walls and street trees. Including it hands the plane
        splitter a facade to lock onto, and a facade wins -- it is flat, it is well sampled, and
        it is nine metres tall. Measured that way the corridor reports kerbs of 9,061 mm.
        """
        keep = self.classification == CLASS_GROUND
        return LocalCloud(
            self.east[keep],
            self.north[keep],
            self.up[keep],
            self.classification[keep],
            self.origin_lat,
            self.origin_lon,
        )


class EptReader:
    """A cached reader for one Entwine tree."""

    def __init__(
        self,
        dataset: str = SF_DATASET,
        *,
        base_url: str = USGS_LIDAR_PUBLIC,
        cache_dir: Path | None = None,
        timeout_s: float = 90.0,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/{dataset}"
        self._cache = cache_dir or Path("build/lidar-cache") / dataset
        self._timeout = timeout_s
        self._hierarchy: dict[str, dict[str, int]] = {}
        self._info: dict | None = None
        self.tiles_fetched = 0
        self.tiles_cached = 0
        self.bytes_fetched = 0

    # -- tree ---------------------------------------------------------------------------------

    @property
    def info(self) -> dict:
        if self._info is None:
            self._info = json.loads(self._get("ept.json", binary=False))
        return self._info

    @property
    def cube(self) -> tuple[float, float, float, float, float, float]:
        return tuple(float(v) for v in self.info["bounds"])  # type: ignore[return-value]

    def _get(self, path: str, *, binary: bool = True) -> bytes | str:
        cached = self._cache / path
        if cached.exists():
            self.tiles_cached += 1
            return cached.read_bytes() if binary else cached.read_text()
        with urllib.request.urlopen(f"{self._url}/{path}", timeout=self._timeout) as response:
            payload = response.read()
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(payload)
        self.tiles_fetched += 1
        self.bytes_fetched += len(payload)
        return payload if binary else payload.decode("utf-8")

    def _page(self, key: str) -> dict[str, int]:
        if key not in self._hierarchy:
            self._hierarchy[key] = json.loads(self._get(f"ept-hierarchy/{key}.json", binary=False))
        return self._hierarchy[key]

    def _node_box(self, depth: int, x: int, y: int, z: int) -> tuple[float, float, float, float]:
        cube = self.cube
        size = (cube[3] - cube[0]) / (2**depth)
        return (cube[0] + x * size, cube[1] + y * size, cube[0] + (x + 1) * size, cube[1] + (y + 1) * size)

    def _nodes(self, box: tuple[float, float, float, float], max_depth: int) -> list[str]:
        """Every populated node overlapping a Mercator box, root to ``max_depth``."""
        found: list[str] = []
        stack: list[tuple[tuple[int, int, int, int], str]] = [((0, 0, 0, 0), "0-0-0-0")]
        while stack:
            (depth, x, y, z), page = stack.pop()
            listing = self._page(page)
            key = f"{depth}-{x}-{y}-{z}"
            if key not in listing:
                continue
            node = self._node_box(depth, x, y, z)
            if node[2] < box[0] or node[0] > box[2] or node[3] < box[1] or node[1] > box[3]:
                continue
            count = listing[key]
            if count == -1:
                # The listing continues in its own page, rooted at this same node.
                stack.append(((depth, x, y, z), key))
                continue
            if count > 0:
                found.append(key)
            if depth < max_depth:
                for dx in (0, 1):
                    for dy in (0, 1):
                        for dz in (0, 1):
                            stack.append(((depth + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz), page))
        return found

    # -- points -------------------------------------------------------------------------------

    def around(
        self, lat: float, lon: float, radius_m: float, *, resolution_m: float = 0.05
    ) -> LocalCloud:
        """Every point within a square of ``radius_m`` about a position, in local metres."""
        scale = mercator_metres_per_true_metre(lat)
        cx, cy = to_web_mercator(lat, lon)
        half = radius_m * scale
        box = (cx - half, cy - half, cx + half, cy + half)

        cube = self.cube
        span = float(self.info.get("span", 128))
        # Node side at depth d is cube/2^d and it holds a span^3 grid, so the sample spacing is
        # cube / (2^d * span). Solve for the depth that first reaches the requested resolution.
        target = resolution_m * scale
        max_depth = max(0, math.ceil(math.log2((cube[3] - cube[0]) / (span * target))))

        east: list[np.ndarray] = []
        north: list[np.ndarray] = []
        up: list[np.ndarray] = []
        classes: list[np.ndarray] = []
        for key in self._nodes(box, max_depth):
            try:
                raw = self._get(f"ept-data/{key}.laz")
            except urllib.error.HTTPError:
                continue
            las = laspy.read(io.BytesIO(raw))  # type: ignore[arg-type]
            x = np.asarray(las.x, dtype=np.float64)
            y = np.asarray(las.y, dtype=np.float64)
            inside = (x >= box[0]) & (x <= box[2]) & (y >= box[1]) & (y <= box[3])
            if not inside.any():
                continue
            east.append((x[inside] - cx) / scale)
            north.append((y[inside] - cy) / scale)
            up.append(np.asarray(las.z, dtype=np.float64)[inside])
            classes.append(np.asarray(las.classification)[inside])

        if not east:
            empty = np.empty(0, dtype=np.float64)
            return LocalCloud(empty, empty, empty, np.empty(0, dtype=np.uint8), lat, lon)
        return LocalCloud(
            np.concatenate(east),
            np.concatenate(north),
            np.concatenate(up),
            np.concatenate(classes),
            lat,
            lon,
        )
