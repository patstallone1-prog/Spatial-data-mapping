#!/usr/bin/env python3
"""Ingest small real 3DEP control cells and receipts before launching regional backfills.

This verifies source access/classification, not kerb accuracy or complete regional coverage.
Existing canonical geometry is never changed by a probe.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.region import get_region  # noqa: E402
from smc.lidar.ept import EptReader  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.official.regional_evidence import digest  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--regions", nargs="+", default=["oakland-downtown", "berkeley-downtown",
                                                  "palo-alto-downtown", "san-jose-downtown"])
    ap.add_argument("--out", type=Path, default=ROOT / "build/regional-evidence/lidar")
    ap.add_argument("--receipt", type=Path, required=True)
    args = ap.parse_args()
    use_certifi()
    rows = []
    for name in args.regions:
        capabilities = json.loads((ROOT / "data/regions" / name / "capabilities.json").read_text())
        datasets = capabilities["lidar"]["collections"]
        dataset = next(c["dataset"] for c in datasets if c["coverage"] >= .95)
        folder = args.out / name
        reader = EptReader(dataset, cache_dir=folder / "cache")
        try:
            metadata = reader.info
            if str(metadata.get("srs", {}).get("horizontal")) != "3857":
                raise ValueError("reader requires explicit EPSG:3857; do not guess source axes")
            lat, lon = get_region(name).bbox.centre
            cloud = reader.around(lat, lon, 15, resolution_m=.25)
            if len(cloud) == 0:
                raise ValueError("empty probe is not measured regional absence")
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / "control-cell.npz"
            np.savez_compressed(path, east=cloud.east, north=cloud.north, up=cloud.up,
                                classification=cloud.classification)
            count, number = np.unique(cloud.classification, return_counts=True)
            rows.append({"region": name, "dataset": dataset, "status": "sample_ingested",
                         "url": reader._url + "/ept.json", "metadata_sha256": digest(metadata),
                         "origin_lat_lon": [lat, lon], "radius_m": 15, "resolution_m": .25,
                         "horizontal_output": "local east/north true metres; EPSG:3857 scale corrected",
                         "vertical_datum": "not_independently_verified", "points": len(cloud),
                         "class_counts": {str(k): int(v) for k, v in zip(count, number, strict=True)},
                         "sample_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "sample_bytes": path.stat().st_size, "tiles_fetched": reader.tiles_fetched,
                         "bytes_fetched": reader.bytes_fetched, "canonical_geometry_changed": False,
                         "attribution": "USGS 3DEP; public-domain federal lidar"})
        except Exception as exc:
            rows.append({"region": name, "dataset": dataset, "status": "failed_retryable",
                         "error": str(exc), "canonical_geometry_changed": False})
        print(json.dumps(rows[-1]), flush=True)
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps({"retrieved_at": datetime.now(UTC).isoformat(),
                                      "purpose": "bounded_regional_lidar_source_access_probe",
                                      "complete_region_or_accuracy_claim": False, "regions": rows}, indent=2) + "\n")
    return int(any(row["status"] != "sample_ingested" for row in rows))


if __name__ == "__main__":
    raise SystemExit(main())
