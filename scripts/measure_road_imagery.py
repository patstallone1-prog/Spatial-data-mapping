#!/usr/bin/env python3
"""Measure parking bands and painted lane segments from reviewed ground masks.

Input is a manifest of calibrated, ENU-registered semantic masks, not raw photos.
The source-asset manifest and explicit CV rights are mandatory.  This command
never fills a missing image measurement with an OSM or policy guess.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path
import sys

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.measure.parking_band import VehicleObservation, parking_band  # noqa: E402
from smc.measure.road_image import extract_lane_paint, vehicle_roadside_reach  # noqa: E402
from smc.reconstruction.provenance import SourceAsset  # noqa: E402


def _mask(base: Path, locator: str) -> np.ndarray:
    path = (base / locator).resolve()
    # Local references must stay inside the input bundle.  The source imagery may
    # live in cloud storage; only the reviewed masks need to be staged here.
    if not path.is_relative_to(base.resolve()):
        raise ValueError(f"mask escapes input bundle: {locator}")
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"missing mask: {locator}")
    return image


def measure(manifest_path: Path) -> tuple[dict, dict]:
    payload = json.loads(manifest_path.read_text())
    if payload.get("schema_version") != 1 or not payload.get("frames"):
        raise ValueError("road-image manifest needs schema_version=1 and frames")
    base = manifest_path.resolve().parent
    vehicles: dict[str, list[VehicleObservation]] = defaultdict(list)
    sources: dict[str, set[str]] = defaultdict(set)
    paint = []
    seen_tracks: set[tuple[str, str, str]] = set()
    for frame in payload["frames"]:
        if frame.get("calibration_validated") is not True or frame.get("privacy_reviewed") is not True:
            raise ValueError("unvalidated camera or unreviewed privacy mask")
        asset_path = (base / frame["source_asset_manifest"]).resolve()
        asset = SourceAsset.model_validate_json(asset_path.read_text())
        if asset.asset_id != frame["source_asset_id"]:
            raise ValueError("source asset ID mismatch")
        aliases = [a for a in asset.aliases if a.rights.status == "approved"
                   and "cv_processing" in a.rights.allowed_uses]
        if not aliases:
            raise ValueError(f"source {asset.asset_id} lacks approved CV rights")
        captured = datetime.fromisoformat(frame["captured_at"].replace("Z", "+00:00"))
        if captured.tzinfo is None:
            raise ValueError("capture time needs timezone")
        if not asset.captured_start <= captured <= asset.captured_end:
            raise ValueError("frame time outside source acquisition epoch")
        matrix = np.asarray(frame["image_to_enu"], dtype=float)
        face = str(frame["face_id"])
        side = int(frame["side"])
        key = f"{face}:{side}"
        curb = np.asarray(frame["curb_line_enu"], dtype=float)
        for instance in frame.get("vehicle_instances", []):
            if not isinstance(instance.get("moving"), bool):
                raise ValueError("vehicle motion must be explicitly tracked")
            track = str(instance["track_id"])
            identity = (key, captured.date().isoformat(), track)
            if identity in seen_tracks:
                continue
            seen_tracks.add(identity)
            reach = vehicle_roadside_reach(_mask(base, instance["ground_contact_mask"]),
                                           matrix, curb, side)
            if reach is None:
                continue
            vehicles[key].append(VehicleObservation(reach, captured.date(), instance["moving"]))
            sources[key].add(asset.asset_id)
        for item in frame.get("lane_mark_masks", []):
            for segment in extract_lane_paint(_mask(base, item["mask"]), matrix,
                                              str(item["colour"]), float(item["confidence"])):
                paint.append({
                    "face_id": face, "side": side, "source_asset_id": asset.asset_id,
                    "license_ids": sorted({a.rights.license_id for a in aliases}),
                    "captured_at": captured.isoformat(),
                    "start_enu": segment.start_xy, "end_enu": segment.end_xy,
                    "width_m": segment.width_m, "length_m": segment.length_m,
                    "colour": segment.colour, "confidence": segment.confidence,
                    "status": "direct_observation",
                })
    bands = {}
    for key, records in vehicles.items():
        band = parking_band(records)
        bands[key] = {"status": band.status, "width_m": band.width_m,
                      "sigma_m": band.sigma_m, "vehicles": band.vehicles,
                      "dates": band.dates, "reason": band.reason,
                      "source_asset_ids": sorted(sources[key])}
    if not bands and not paint:
        raise ValueError("no metric vehicle or lane-mark evidence in reviewed frames")
    origin = payload.get("enu_origin_wgs84")
    if not isinstance(origin, list) or len(origin) != 2:
        raise ValueError("manifest needs explicit ENU origin [lon, lat]")
    return ({"schema_version": 1, "bands": bands},
            {"schema_version": 1, "coordinate_frame": "local_enu",
             "enu_origin_wgs84": origin,
             "segments": paint})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    bands, marks = measure(args.manifest)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    if any(row["status"] == "measured" for row in bands["bands"].values()):
        (args.out_dir / "parking_bands.json").write_text(json.dumps(bands, indent=2) + "\n")
    (args.out_dir / "lane_marks.json").write_text(json.dumps(marks, indent=2) + "\n")
    print(f"{len(bands['bands'])} parking-band faces, {len(marks['segments'])} measured paint segments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
