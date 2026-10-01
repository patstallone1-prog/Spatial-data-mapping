"""App-only land/water evidence for rendering gaps in a lidar ground grid.

The binary is visual evidence, not a replacement terrain measurement.  Water is
classified from mapped water/coastlines; building footprints and at-grade streets
are explicit dry support.  A no-data lidar cell alone never means open water.
"""

from __future__ import annotations

import hashlib
import itertools
import json
from pathlib import Path

import numpy as np

from smc.terrain.waterline import coastline_mask, rasterise

LAND = 0
WATER = 1
BUILT_LAND = 2


def _street_support(ways: list[dict], frame: dict) -> np.ndarray:
    rows, cols = frame["rows"], frame["cols"]
    support = np.zeros((rows, cols), dtype=bool)
    step = frame["step_m"]
    x0, y0 = frame["x0"], frame["y0"]
    kx, ky = frame["metres_per_lon"], frame["metres_per_lat"]
    mid_lon, mid_lat = frame["mid_lon"], frame["mid_lat"]
    for way in ways:
        if (
            way.get("kind") != "street"
            or way.get("bridge")
            or way.get("tunnel")
            or way.get("tunnel_kind")
            or len(way.get("points") or []) < 2
        ):
            continue
        half = min(25.0, max(3.0, float(way.get("road_m") or 8.9) / 2 + 4.0))
        points = [((lon - mid_lon) * kx, (lat - mid_lat) * ky) for lon, lat in way["points"]]
        for (ax, ay), (bx, by) in itertools.pairwise(points):
            c0 = max(0, int(np.floor((min(ax, bx) - half - x0) / step)))
            c1 = min(cols, int(np.ceil((max(ax, bx) + half - x0) / step)) + 1)
            r0 = max(0, int(np.floor((min(ay, by) - half - y0) / step)))
            r1 = min(rows, int(np.ceil((max(ay, by) + half - y0) / step)) + 1)
            if c0 >= c1 or r0 >= r1:
                continue
            xx = x0 + (np.arange(c0, c1) + 0.5) * step
            yy = y0 + (np.arange(r0, r1) + 0.5) * step
            dx, dy = bx - ax, by - ay
            length2 = dx * dx + dy * dy
            if length2 < 0.01:
                continue
            t = np.clip(((xx[None, :] - ax) * dx + (yy[:, None] - ay) * dy) / length2, 0.0, 1.0)
            d2 = (xx[None, :] - ax - t * dx) ** 2 + (yy[:, None] - ay - t * dy) ** 2
            support[r0:r1, c0:c1] |= d2 <= half * half
    return support


def visual_landwater(payload: dict, terrain_meta: dict, terrain_cm: np.ndarray) -> np.ndarray:
    """Return byte classes 0 land, 1 water, 2 mapped built land on the terrain frame."""
    frame = terrain_meta["frame"]
    if terrain_cm.shape != (frame["rows"], frame["cols"]):
        raise ValueError("terrain dimensions do not match frame")
    ways = payload.get("ways", [])
    rings = [
        w["points"]
        for w in ways
        if w.get("kind") == "water"
        and len(w.get("points") or []) >= 4
        and w["points"][0] == w["points"][-1]
        and not w.get("coastline_band")
    ]
    coasts = [
        w["points"]
        for w in ways
        if w.get("kind") == "coastline" and len(w.get("points") or []) >= 2
    ]
    water = rasterise(rings, frame) if rings else np.zeros(terrain_cm.shape, dtype=bool)
    if coasts:
        measured_surface = terrain_meta.get("waterline", {}).get("surface_m")
        # Only used to decide which mapped coastline side is wet.  No-data is
        # deliberately neutral, never a water seed.  The fallback is visual-only.
        surface = float(measured_surface) if measured_surface is not None else -0.14
        height = np.where(
            terrain_cm == frame["nodata"],
            surface + 5.0,
            frame["base_m"] + terrain_cm.astype(np.float32) / 100.0,
        )
        buildings = [
            w["centroid"] for w in ways if w.get("kind") == "building" and w.get("centroid")
        ]
        water |= coastline_mask(coasts, frame, height, surface, buildings, walls=rings)

    structures = [
        w["points"]
        for w in ways
        if w.get("kind") in {"building", "parking_lot"} and len(w.get("points") or []) >= 3
    ]
    built = rasterise(structures, frame) if structures else np.zeros_like(water)
    # Sub-cell footprints and concave OSM centroids can miss a cell-centre raster. The
    # building's own representative point still proves that cell cannot be open water.
    for way in ways:
        if way.get("kind") != "building" or not way.get("centroid"):
            continue
        lon, lat = way["centroid"]
        c = int(
            np.floor(
                ((lon - frame["mid_lon"]) * frame["metres_per_lon"] - frame["x0"]) / frame["step_m"]
            )
        )
        r = int(
            np.floor(
                ((lat - frame["mid_lat"]) * frame["metres_per_lat"] - frame["y0"]) / frame["step_m"]
            )
        )
        if 0 <= r < frame["rows"] and 0 <= c < frame["cols"]:
            built[r, c] = True
    built |= _street_support(ways, frame)
    # A mapped footprint/road is stronger dry-land evidence than missing lidar.
    water &= ~built
    return np.where(water, WATER, np.where(built, BUILT_LAND, LAND)).astype(np.uint8)


def write_visual_landwater(
    payload_path: Path, terrain_meta_path: Path, terrain_bin_path: Path, out_path: Path
) -> dict:
    payload_bytes = payload_path.read_bytes()
    terrain_bytes = terrain_bin_path.read_bytes()
    payload = json.loads(payload_bytes)
    meta = json.loads(terrain_meta_path.read_text(encoding="utf-8"))
    frame = meta["frame"]
    terrain = np.frombuffer(terrain_bytes, dtype="<i2").reshape(frame["rows"], frame["cols"])
    classes = visual_landwater(payload, meta, terrain)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(classes.tobytes(order="C"))
    manifest = {
        "schema_version": 1,
        "purpose": "visual_only_land_water_and_dry_surface_support",
        "frame": frame,
        "classes": {
            "0": "mapped_or_inferred_land",
            "1": "mapped_water",
            "2": "mapped_dry_structure",
        },
        "counts": {str(i): int(np.count_nonzero(classes == i)) for i in (0, 1, 2)},
        "water_surface_source": (
            "measured_lidar"
            if meta.get("waterline", {}).get("surface_m") is not None
            else "classification_fallback_not_measured"
        ),
        "payload_sha256": hashlib.sha256(payload_bytes).hexdigest(),
        "terrain_sha256": hashlib.sha256(terrain_bytes).hexdigest(),
    }
    out_path.with_suffix(".json").write_text(
        json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    return manifest
