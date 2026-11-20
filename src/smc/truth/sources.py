"""Two more witnesses for what the ground is, beside the aerial photographs.

* **The city's lidar** (USGS 3DEP, San Francisco 2023, read through ``smc.lidar.ept``): every
  return carries how strongly the ground sent the laser back. Asphalt sends back little, concrete
  a lot, and it is the same in a building's shade as in the sun -- which is where the photographs
  cannot see. Only returns classed as ground are used, so a roof leaning over a yard in the
  photograph is not in it at all. Kept as the middle strength in each half metre of the page.

* **Street-level photographs** (Mapillary's own labelling of each picture, already kept by
  ``smc.imagery.segmentation_cache`` as a small label map with the camera's place and heading;
  no photograph is stored): a point of ground seen from the street is road, footway, or planted.
  A lot hidden from above by its own building's lean is often in plain sight from the kerb.

Neither is trusted alone where it can be helped: ``imagery_truth.fuse`` puts them beside the two
aerial photographs and calls a ring only where those that could see it agree.
"""

from __future__ import annotations

import io
import json
import math
from pathlib import Path

import numpy as np

EARTH = 6378137.0
#: A lidar tile: this many metres of the page a side, in cells of this size.
TILE_M, CELL_M = 250.0, 0.5
#: ASPRS class 2: ground.
GROUND = 2
#: A camera on a car's roof stands about this high over the road (m).
CAMERA_M = 2.3
#: Street photographs: how near a camera must be to speak for a point, and how near is too near.
STREET_NEAR_M, STREET_FAR_M = 4.0, 32.0
#: The labels (segmentation_cache.NAMES) as what the ground is.
STREET_ROAD, STREET_WALK, STREET_PLANTED = (3,), (4,), (5, 7)


def mercator(lon, lat):
    lon, lat = np.asarray(lon, float), np.asarray(lat, float)
    return EARTH * np.radians(lon), EARTH * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


def unmercator(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    return np.degrees(x / EARTH), np.degrees(2 * np.arctan(np.exp(y / EARTH)) - np.pi / 2)


class LidarGround:
    """How strongly the ground sends the laser back, by half metre of the page, a tile at a time
    (worked out once from the point cloud and kept as a small array on disk)."""

    def __init__(self, frame, cache: Path, ept_cache: Path | None = None, *, resolution_m: float = 0.5, reader=None):
        self.frame = frame
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.resolution_m = resolution_m
        self._reader, self._ept_cache = reader, ept_cache
        self.tiles: dict = {}
        self.failed = 0

    def reader(self):
        if self._reader is None:
            from smc.lidar.ept import SF_DATASET, EptReader

            self._reader = EptReader(SF_DATASET, cache_dir=(self._ept_cache / SF_DATASET) if self._ept_cache else None, timeout_s=40.0)
        return self._reader

    def tile(self, i: int, j: int) -> np.ndarray | None:
        """The tile whose corner is (i, j) x TILE_M of the page: (cells, cells) float32, the
        middle strength of the ground returns in each cell, NaN where there are none."""
        if (i, j) not in self.tiles:
            path = self.cache / f"lidar_{i}_{j}.npy"
            if path.exists():
                grid = np.load(path)
            else:
                grid = self._build(i, j)
                if grid is not None:
                    np.save(path, grid)
            self.tiles[(i, j)] = grid
        return self.tiles[(i, j)]

    def _build(self, i: int, j: int) -> np.ndarray | None:
        if self.failed >= 3:
            return None
        import laspy

        x0, z0 = i * TILE_M, j * TILE_M
        cx, cz = [x0, x0 + TILE_M, x0 + TILE_M, x0], [z0, z0, z0 + TILE_M, z0 + TILE_M]
        mx, my = mercator(*self.frame.lonlat(cx, cz))
        box = (float(mx.min()), float(my.min()), float(mx.max()), float(my.max()))
        try:
            reader = self.reader()
            cube, span = reader.cube, float(reader.info.get("span", 128))
            lat = float(np.mean(self.frame.lonlat(cx, cz)[1]))
            target = self.resolution_m / math.cos(math.radians(lat))
            depth = max(0, math.ceil(math.log2((cube[3] - cube[0]) / (span * target))))
            keys = reader._nodes(box, depth)
            cells = int(TILE_M / CELL_M)
            total = np.zeros((cells, cells), np.float64)
            count = np.zeros((cells, cells), np.int32)
            for key in keys:
                las = laspy.read(io.BytesIO(reader._get(f"ept-data/{key}.laz")))
                x, y = np.asarray(las.x, float), np.asarray(las.y, float)
                keep = (np.asarray(las.classification) == GROUND) & (x >= box[0]) & (x <= box[2]) & (y >= box[1]) & (y <= box[3])
                if not keep.any():
                    continue
                px, pz = self.frame.from_lonlat(*unmercator(x[keep], y[keep]))
                col, row = np.floor((px - x0) / CELL_M).astype(int), np.floor((pz - z0) / CELL_M).astype(int)
                ok = (col >= 0) & (col < cells) & (row >= 0) & (row < cells)
                np.add.at(total, (row[ok], col[ok]), np.asarray(las.intensity, float)[keep][ok])
                np.add.at(count, (row[ok], col[ok]), 1)
        except Exception:
            self.failed += 1
            return None
        grid = np.full((cells, cells), np.nan, np.float32)
        grid[count > 0] = (total[count > 0] / count[count > 0]).astype(np.float32)
        return grid

    def strength(self, xs, zs) -> np.ndarray:
        """The ground's strength at page points (NaN where none)."""
        xs, zs = np.asarray(xs, float), np.asarray(zs, float)
        out = np.full(xs.shape, np.nan, np.float32)
        ti, tj = np.floor(xs / TILE_M).astype(int), np.floor(zs / TILE_M).astype(int)
        for i, j in {(int(a), int(b)) for a, b in zip(ti, tj, strict=True)}:
            grid = self.tile(i, j)
            if grid is None:
                continue
            here = (ti == i) & (tj == j)
            col = np.clip(((xs[here] - i * TILE_M) / CELL_M).astype(int), 0, grid.shape[1] - 1)
            row = np.clip(((zs[here] - j * TILE_M) / CELL_M).astype(int), 0, grid.shape[0] - 1)
            out[here] = grid[row, col]
        return out


def threshold_between(asphalt: list[float], concrete: list[float]) -> dict | None:
    """Where to cut the lidar's strength between asphalt and concrete, from rings the photographs
    were sure of: the cut that gets most of them right, and how many it does."""
    if len(asphalt) < 4 or len(concrete) < 4:
        return None
    a, c = np.asarray(asphalt, float), np.asarray(concrete, float)
    cuts = np.unique(np.concatenate([a, c]))
    # (Of the cuts that get as many right, the one nearest half way between the two kinds' middles.)
    half = (float(np.median(a)) + float(np.median(c))) / 2
    best = max(((float(((a < t).sum() + (c >= t).sum())) / (len(a) + len(c)), float(t)) for t in cuts), key=lambda r: (r[0], -abs(r[1] - half)))
    return {"cut": best[1], "right": round(best[0], 3), "asphalt": len(a), "concrete": len(c),
            "asphalt_mid": float(np.median(a)), "concrete_mid": float(np.median(c))}


class StreetViews:
    """The street photographs' labels near a place: for points of ground, what each camera that
    can see them calls them."""

    def __init__(self, records: list[dict], frame):
        from smc.imagery import segmentation_cache as sc

        self._decode = sc.decode
        self.frame = frame
        self.views = []
        for r in records:
            ll, compass = r.get("lonlat"), r.get("compass")
            if not ll or compass is None or "labels" not in r or "error" in r:
                continue
            x, z = frame.from_lonlat(ll[0], ll[1])
            self.views.append({"x": float(x[0]), "z": float(z[0]), "compass": math.radians(float(compass)), "r": r,
                               "pano": r.get("camera") in ("spherical", "equirectangular"), "focal": float(r.get("focal") or 0.85)})
        self.at = np.array([[v["x"], v["z"]] for v in self.views]) if self.views else np.zeros((0, 2))
        self._labels: dict = {}

    @classmethod
    def load(cls, path: Path, frame, bounds_xz) -> StreetViews:
        """The cache's records within the page box (x0, z0, x1, z1), with 40 m round it."""
        x0, z0, x1, z1 = bounds_xz
        lon, lat = frame.lonlat([x0 - 40, x1 + 40], [z0 - 40, z1 + 40])
        west, east, south, north = float(min(lon)), float(max(lon)), float(min(lat)), float(max(lat))
        records = []
        with Path(path).open() as lines:
            for line in lines:
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ll = r.get("lonlat")
                if ll and west < ll[0] < east and south < ll[1] < north:
                    records.append(r)
        return cls(records, frame)

    def labels(self, view: dict) -> np.ndarray:
        key = view["r"]["id"]
        if key not in self._labels:
            if len(self._labels) > 400:
                self._labels.clear()
            self._labels[key] = self._decode(view["r"])
        return self._labels[key]

    def see(self, xs, zs) -> dict:
        """What the cameras near the page points (xs, zs) call them: {road, walk, planted,
        cameras}, a count of point-sightings each (a point hidden behind a wall, a car or a
        fence is labelled as that, and is not counted)."""
        xs, zs = np.asarray(xs, float), np.asarray(zs, float)
        tally = {"road": 0, "walk": 0, "planted": 0, "cameras": 0}
        if not len(self.at) or not len(xs):
            return tally
        cx, cz = float(xs.mean()), float(zs.mean())
        reach = STREET_FAR_M + float(np.hypot(xs - cx, zs - cz).max())
        for k in np.nonzero(np.hypot(self.at[:, 0] - cx, self.at[:, 1] - cz) < reach)[0]:
            v = self.views[k]
            # East and north of the camera: the page's z runs south.
            de, dn = xs - v["x"], -(zs - v["z"])
            fwd = de * math.sin(v["compass"]) + dn * math.cos(v["compass"])
            right = de * math.cos(v["compass"]) - dn * math.sin(v["compass"])
            dist = np.hypot(de, dn)
            lab = self.labels(v)
            h, w = lab.shape
            if v["pano"]:
                ok = (dist > STREET_NEAR_M) & (dist < STREET_FAR_M)
                u = (0.5 + np.arctan2(right, fwd) / (2 * np.pi)) % 1.0
                t = 0.5 + np.arctan2(CAMERA_M, np.maximum(dist, 1e-6)) / np.pi
            else:
                ok = (fwd > STREET_NEAR_M) & (dist < STREET_FAR_M)
                safe = np.maximum(fwd, 1e-6)
                long_side = max(v["r"].get("width") or w, v["r"].get("height") or h)
                u = 0.5 + v["focal"] * long_side * (right / safe) / (v["r"].get("width") or w)
                t = 0.5 + v["focal"] * long_side * (CAMERA_M / safe) / (v["r"].get("height") or h)
                ok &= (u > 0.02) & (u < 0.98) & (t > 0.5) & (t < 0.98)
            if not ok.any():
                continue
            got = lab[np.clip((t[ok] * h).astype(int), 0, h - 1), np.clip((u[ok] * w).astype(int), 0, w - 1)]
            road, walk, planted = int(np.isin(got, STREET_ROAD).sum()), int(np.isin(got, STREET_WALK).sum()), int(np.isin(got, STREET_PLANTED).sum())
            if road + walk + planted:
                tally["road"] += road
                tally["walk"] += walk
                tally["planted"] += planted
                tally["cameras"] += 1
        return tally
