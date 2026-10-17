#!/usr/bin/env python3
"""Use acquired lidar probes against served terrain; not an independent accuracy benchmark."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.streetview_reference import atomic_json  # noqa: E402
from smc.official.integration import road_edge_check  # noqa: E402


def terrain_probe(meta, grid, east, north, up, origin):
    f = meta["frame"]
    lat, lon = origin
    lons = lon + east / (111320 * np.cos(np.deg2rad(lat)))
    lats = lat + north / 111320
    x = ((lons - f["mid_lon"]) * f["metres_per_lon"] - f["x0"]) / f["step_m"] - .5
    y = ((lats - f["mid_lat"]) * f["metres_per_lat"] - f["y0"]) / f["step_m"] - .5
    inside = (x >= 0) & (y >= 0) & (x < f["cols"] - 1) & (y < f["rows"] - 1)
    x, y, up = x[inside], y[inside], up[inside]
    col, row = x.astype(int), y.astype(int)
    corners = np.column_stack([grid[row, col], grid[row, col+1], grid[row+1, col], grid[row+1, col+1]])
    valid = (corners != f["nodata"]).all(axis=1)
    dx, dy = x-col, y-row
    weights = np.column_stack([(1-dx)*(1-dy), dx*(1-dy), (1-dx)*dy, dx*dy])
    predicted = (corners * weights).sum(axis=1)*.01 + f["base_m"]
    error = up[valid]-predicted[valid]
    offset = float(np.median(error)) if len(error) else None
    return {"attempted_ground_returns": len(east), "supported": int(valid.sum()),
            "unresolved_vertical_offset_m": offset,
            "relative_shape_median_abs_m": float(np.median(np.abs(error-offset))) if len(error) else None,
            "relative_shape_p90_abs_m": float(np.percentile(np.abs(error-offset),90)) if len(error) else None,
            "independent_accuracy_claim": False, "datum_certified": False,
            "note": "Same collection may underlie terrain; offset removal is a diagnostic, not held-out accuracy."}


def main():
    source = json.loads((ROOT / "data/benchmarks/regional-lidar-probes-2026-10-16.json").read_text())
    rows = []
    for receipt in source["regions"]:
        name = receipt["region"]
        path = ROOT / f"build/regional-evidence/lidar/{name}/control-cell.npz"
        if hashlib.sha256(path.read_bytes()).hexdigest() != receipt["sample_sha256"]:
            raise ValueError("lidar probe differs from acquisition receipt")
        folder = ROOT / f"docs/regions/{name}"
        if name == "oakland-downtown":
            folder = ROOT / f"docs/app-regions/{name}"
        meta = json.loads((folder / "sf-corridor-terrain.json").read_text())
        grid = np.frombuffer((folder / "sf-corridor-terrain.bin").read_bytes(),dtype="<i2").reshape(meta["frame"]["rows"], meta["frame"]["cols"])
        with np.load(path) as cloud:
            keep = cloud["classification"] == 2
            result = terrain_probe(meta, grid, cloud["east"][keep], cloud["north"][keep], cloud["up"][keep], receipt["origin_lat_lon"])
        rows.append({"region": name, "source": receipt["dataset"], "served_terrain_source": meta["source"],
                     "probe_sha256": receipt["sample_sha256"], **result})
    municipal = json.loads((ROOT / "docs/municipal-context.manifest.json").read_text())
    edge_source = next((ROOT / "data/municipal_evidence/palo-alto-road-edges").glob("*.json"))
    edges = json.loads(edge_source.read_text())
    pa_payload = json.loads((ROOT / "docs/app-regions/palo-alto-downtown/sf-corridor-3d.json").read_text())
    edge_result = road_edge_check(edges["features"],pa_payload)
    atomic_json(ROOT / "docs/audits/integrated-source-validation.json", {
        "schema":"kerbside.source_consumption/1", "lidar": rows, "municipal":municipal["regions"],
        "palo_alto_road_edge_check":edge_result,
        "canonical_geometry_changed":False, "new_region_intake_started":False,
        "limitations":["Historical Oakland inventory cannot establish present parking restrictions",
                       "Palo Alto mixed road edges are validation references, not universally surveyed curbs",
                       "Survey-control datum review remains required; project lines are not as-built geometry"]})
    print(json.dumps(rows,indent=2))


if __name__ == "__main__":
    main()
