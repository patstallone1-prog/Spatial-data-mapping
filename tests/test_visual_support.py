"""Mapped water and dry structures outrank missing or low lidar in app rendering."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from smc.terrain.visual_support import BUILT_LAND, LAND, WATER, visual_landwater

ROOT = Path(__file__).resolve().parents[1]


def test_no_data_is_not_water_and_mapped_dry_surfaces_override_water() -> None:
    frame = {
        "rows": 20,
        "cols": 20,
        "step_m": 2.0,
        "x0": -20.0,
        "y0": -20.0,
        "mid_lon": -122.4,
        "mid_lat": 37.8,
        "metres_per_lon": 88_000.0,
        "metres_per_lat": 111_320.0,
        "base_m": -3.0,
        "nodata": -32768,
    }

    def lon(x: float) -> float:
        return frame["mid_lon"] + x / frame["metres_per_lon"]

    def lat(y: float) -> float:
        return frame["mid_lat"] + y / frame["metres_per_lat"]

    def ring(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
        return [
            [lon(x0), lat(y0)],
            [lon(x1), lat(y0)],
            [lon(x1), lat(y1)],
            [lon(x0), lat(y1)],
            [lon(x0), lat(y0)],
        ]

    payload = {
        "ways": [
            {"kind": "water", "points": ring(-2, -18, 18, 18)},
            {"kind": "building", "points": ring(4, 4, 8, 8), "centroid": [lon(6), lat(6)]},
            {"kind": "street", "points": [[lon(-10), lat(0)], [lon(12), lat(0)]], "road_m": 4},
            {
                "kind": "street",
                "points": [[lon(-10), lat(12)], [lon(12), lat(12)]],
                "road_m": 4,
                "bridge": True,
            },
        ]
    }
    cm = np.full((20, 20), frame["nodata"], dtype=np.int16)
    mask = visual_landwater(payload, {"frame": frame}, cm)

    def cell(x: float, y: float) -> np.uint8:
        return mask[int((y - frame["y0"]) / 2), int((x - frame["x0"]) / 2)]

    assert cell(-16, 14) == LAND
    assert cell(14, 16) == WATER
    assert cell(6, 6) == BUILT_LAND
    assert cell(6, 0) == BUILT_LAND
    assert cell(6, 12) == WATER  # a bridge does not turn the water underneath into land


def test_committed_app_masks_match_rendered_assets_and_keep_buildings_dry() -> None:
    docs = ROOT / "docs"
    roots = [docs, *sorted((docs / "app-regions").iterdir())]
    for root in roots:
        if not root.is_dir():
            continue
        mask_name = "app-sf-corridor-landwater.bin" if root == docs else "app-landwater.bin"
        mask_path = root / mask_name
        assert mask_path.exists(), root
        manifest = json.loads(mask_path.with_suffix(".json").read_text())
        payload_path = root / "sf-corridor-3d.json"
        if not payload_path.exists():
            payload_path = docs / "regions" / root.name / "sf-corridor-3d.json"
        terrain_root = (
            root if (root / "sf-corridor-terrain.bin").exists() else docs / "regions" / root.name
        )
        terrain_path = terrain_root / "sf-corridor-terrain.bin"
        frame = json.loads((terrain_root / "sf-corridor-terrain.json").read_text())["frame"]
        assert manifest["frame"] == frame
        assert manifest["payload_sha256"] == hashlib.sha256(payload_path.read_bytes()).hexdigest()
        assert manifest["terrain_sha256"] == hashlib.sha256(terrain_path.read_bytes()).hexdigest()
        mask = np.fromfile(mask_path, dtype=np.uint8).reshape(frame["rows"], frame["cols"])
        assert set(np.unique(mask)).issubset({LAND, WATER, BUILT_LAND})
        assert sum(manifest["counts"].values()) == mask.size
        assert f'content="{mask_path.name}"' in (root / "app-model.html").read_text()
        payload = json.loads(payload_path.read_text())
        for way in payload["ways"]:
            if way.get("kind") != "building" or not way.get("centroid"):
                continue
            lon, lat = way["centroid"]
            r = int(
                ((lat - frame["mid_lat"]) * frame["metres_per_lat"] - frame["y0"]) / frame["step_m"]
            )
            c = int(
                ((lon - frame["mid_lon"]) * frame["metres_per_lon"] - frame["x0"]) / frame["step_m"]
            )
            if 0 <= r < frame["rows"] and 0 <= c < frame["cols"]:
                assert mask[r, c] != WATER, (root, way.get("name"), lon, lat)
