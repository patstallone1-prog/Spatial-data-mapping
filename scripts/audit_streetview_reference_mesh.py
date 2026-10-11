#!/usr/bin/env python3
"""Private cell-by-cell massing review against an OLD MANUAL mesh, not accuracy truth."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import runpy
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.streetview_reference import atomic_json, sha256  # noqa: E402


def compare_cells(mesh: Path, payload: dict, contains) -> dict:
    # Double precision projection/recentering; source coordinates themselves are
    # coarse. No coordinate conversion grants survey accuracy or a vertical datum.
    radius = 6378137.0
    grid, cells = defaultdict(list), defaultdict(list)
    for line in mesh.read_text().splitlines():
        if not line.startswith("v "):
            continue
        x, y, z = map(float, line.split()[1:4])
        lon = math.degrees(x / radius)
        lat = math.degrees(2 * math.atan(math.exp(y / radius)) - math.pi / 2)
        grid[(math.floor(lon * 1000), math.floor(lat * 1000))].append((lon, lat, z))
    for way in payload.get("ways", []):
        if way.get("kind") != "building" or not way.get("centroid") or not way.get("points"):
            continue
        ring = way["points"]
        west, east = min(p[0] for p in ring), max(p[0] for p in ring)
        south, north = min(p[1] for p in ring), max(p[1] for p in ring)
        heights = []
        for cx in range(math.floor(west * 1000), math.floor(east * 1000) + 1):
            for cy in range(math.floor(south * 1000), math.floor(north * 1000) + 1):
                heights.extend(z for lon, lat, z in grid.get((cx, cy), []) if contains(ring, lon, lat))
        if len(heights) < 4:
            continue
        span = max(heights) - min(heights)
        canonical = way.get("height_m")
        if canonical is None or span < 1:
            continue
        lon, lat = way["centroid"]
        # Diagnostic cells only, not a surveyed block boundary or surface match.
        x = radius * math.radians(lon) * math.cos(math.radians(lat))
        y = radius * math.radians(lat)
        cell = f"{math.floor(x / 250)}:{math.floor(y / 250)}"
        cells[cell].append({"building_id": str(way["osm_id"]), "address": way.get("address"),
                            "canonical_height_m": canonical, "reference_vertex_z_span_m": round(span, 3),
                            "difference_m": round(span - canonical, 3), "reference_points": len(heights),
                            "requires_review": abs(span - canonical) > 3,
                            "surface_identity": "unverified_spatial_overlap_not_object_correspondence"})
    return {"cells": dict(cells), "matched_buildings_for_review": sum(map(len, cells.values())),
            "basis": "manual_historical_reference_massing_not_lidar_or_photogrammetric_ground_truth",
            "horizontal_crs": "EPSG:3857_hypothesis_from_source_numeric_coordinates",
            "vertical_datum": "unknown; no absolute vertical comparison",
            "source_geometry_not_modified": True, "canonical_geometry_modified": False,
            "privacy": "no_source_photos_or_pixels_in_this_report", "production_eligible": False,
            "metric_accuracy_validated": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--canonical", type=Path, default=ROOT / "docs/sf-corridor-3d.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to((ROOT / "docs").resolve()):
        parser.error("restricted reference results must stay private")
    original = args.canonical.read_bytes()
    renderer = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
    report = compare_cells(args.model, json.loads(original), renderer["_ring_contains"])
    report["canonical_sha256"] = hashlib.sha256(original).hexdigest()
    report["reference_sha256"] = sha256(args.model)
    if args.canonical.read_bytes() != original:
        raise ValueError("canonical world changed during reference audit")
    atomic_json(args.output, report)
    print(json.dumps({"cells": len(report["cells"]), "buildings": report["matched_buildings_for_review"],
                      "metric_accuracy_validated": False, "canonical_geometry_modified": False}))


if __name__ == "__main__":
    main()
