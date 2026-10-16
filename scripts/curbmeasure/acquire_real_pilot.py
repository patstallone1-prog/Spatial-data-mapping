#!/usr/bin/env python3
"""Bounded, resumable real camera/lidar acquisition, never a whole dataset download."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.pandaset import DEFAULT_ARCHIVE, PandaSetProvider  # noqa: E402
from smc.imagery.streetview_reference import atomic_json  # noqa: E402
from smc.lidar.ept import EptReader  # noqa: E402
from smc.net import use_certifi  # noqa: E402


def acquire(manifest: dict, out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    provider = PandaSetProvider()
    receipts = {}
    receipt_path = out / "acquisition.json"
    if receipt_path.exists():
        receipts = json.loads(receipt_path.read_text()).get("assets", {})

    def asset(member):
        path = out / "raw" / member
        if path.exists():
            if (
                member not in receipts
                or hashlib.sha256(path.read_bytes()).hexdigest() != receipts[member]["sha256"]
            ):
                raise ValueError("unverified existing acquisition")
            return
        if shutil.disk_usage(out).free < 10 * 1024**3:
            raise OSError("10 GiB local reserve required; external disk is not mounted")
        info = provider.archive.getinfo(member)
        if info.file_size > 32 * 1024**2:
            raise ValueError("unexpectedly large member; bounded pilot refuses it")
        raw = provider.archive.read(member)  # ZIP CRC checked by the existing range reader.
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(raw)
        temporary.replace(path)
        receipts[member] = {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "archive_member": member,
            "source": DEFAULT_ARCHIVE,
            "license_id": "CC-BY-4.0",
            "source_id": "pandaset",
        }
        atomic_json(
            receipt_path,
            {
                "assets": receipts,
                "attribution": manifest["attribution"],
                "publication": "private_pixels_public_summary_only",
            },
        )
        print(f"acquired {member}: {len(raw)} bytes", flush=True)

    failures = {}
    for case in manifest["cases"]:
        base = f"pandaset/{case['sequence']}"
        try:
            for suffix in ("meta/gps.json", "meta/timestamps.json", "lidar/timestamps.json"):
                asset(f"{base}/{suffix}")
            for suffix in ("poses.json", "intrinsics.json", "timestamps.json"):
                asset(f"{base}/camera/{case['camera']}/{suffix}")
            for frame in manifest["frames"]:
                asset(f"{base}/camera/{case['camera']}/{frame:02d}.jpg")
                asset(f"{base}/lidar/{frame:02d}.pkl.gz")
                asset(f"{base}/annotations/semseg/{frame:02d}.pkl.gz")
        except (OSError, ValueError, KeyError) as exc:
            failures[case["case_id"]] = str(exc)
            print(f"failed {case['case_id']}: {type(exc).__name__}", flush=True)
    result = {
        "assets": receipts,
        "cases_failed": failures,
        "downloaded_bytes": provider.bytes_read,
        "stored_bytes": sum(r["bytes"] for r in receipts.values()),
        "manifest_sha256": hashlib.sha256(
            json.dumps(manifest, sort_keys=True).encode()
        ).hexdigest(),
        "attribution": manifest["attribution"],
        "publication": "private_pixels_public_summary_only",
    }
    atomic_json(receipt_path, result)
    return result


def usgs_probe(out: Path, lat: float, lon: float) -> None:
    reader = EptReader(cache_dir=out / "usgs-cache", strict=True)
    if str(reader.info.get("srs", {}).get("horizontal")) != "3857":
        raise ValueError("benchmark reader requires verified EPSG:3857 source coordinates")
    cloud = reader.around(lat, lon, 15, resolution_m=0.05)
    if not len(cloud):
        raise ValueError("an empty or failed download is not an independent lidar reference")
    path = out / "usgs-control-cell.npz"
    np.savez_compressed(path, xyz=cloud.xyz, classification=cloud.classification)
    atomic_json(
        out / "usgs-receipt.json",
        {
            "dataset": "CA_SanFrancisco_1_B23",
            "points": len(cloud),
            "origin_lat_lon": [lat, lon],
            "resolution_request_m": 0.05,
            "radius_m": 15,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes_fetched": reader.bytes_fetched,
            "ept_metadata": reader.info,
            "vertical_datum": "NAVD88_GEOID18",
            "horizontal_frame": "local_E_N_from_EPSG3857",
            "absolute_horizontal_5cm_truth": False,
            "accuracy_note": "NOAA reports 0.12 m horizontal at 95%; 0.0173 m tested vertical RMSE",
            "metadata_url": "https://www.fisheries.noaa.gov/inport/item/73386/full-list",
            "attribution": "USGS / NV5 Geospatial; public-domain federal lidar",
        },
    )
    print(
        f"USGS control cell: {len(cloud)} returns, {reader.bytes_fetched} downloaded bytes",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "data/benchmarks/real-photo-lidar-v1.json"
    )
    parser.add_argument("--out", type=Path, default=ROOT / "build/photo-lidar-real-v1")
    parser.add_argument("--usgs", action="store_true")
    args = parser.parse_args()
    use_certifi()
    result = acquire(json.loads(args.manifest.read_text()), args.out)
    if args.usgs:
        usgs_probe(args.out, 37.79215, -122.4290)
    return int(bool(result["cases_failed"]))


if __name__ == "__main__":
    raise SystemExit(main())
