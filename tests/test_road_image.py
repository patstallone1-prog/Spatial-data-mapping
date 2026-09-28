"""Metric-mask extraction must not turn pixels or policy into measured road facts."""

import json
import runpy
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from smc.measure.road_image import extract_lane_paint, vehicle_roadside_reach
from smc.reconstruction.provenance import Footprint, SourceAlias, SourceAsset, SourceRights


def test_vehicle_ground_contact_reaches_two_metres_from_curb() -> None:
    mask = np.zeros((100, 100), dtype=np.uint8)
    cv2.rectangle(mask, (30, 2), (70, 20), 255, -1)
    pixel_to_enu = np.diag([0.1, 0.1, 1.0])
    curb = np.array([[0.0, 0.0], [10.0, 0.0]])
    reach = vehicle_roadside_reach(mask, pixel_to_enu, curb, 1)
    assert reach == pytest.approx(2.0, abs=0.1)
    assert vehicle_roadside_reach(mask, pixel_to_enu, curb, -1) is None


def test_lane_paint_rejects_crosswalk_bars_and_measures_slender_lines() -> None:
    mask = np.zeros((160, 160), dtype=np.uint8)
    cv2.rectangle(mask, (20, 20), (140, 21), 255, -1)
    cv2.rectangle(mask, (20, 60), (140, 78), 255, -1)
    segments = extract_lane_paint(mask, np.diag([0.1, 0.1, 1.0]), "yellow", 0.97)
    assert len(segments) == 1
    assert segments[0].colour == "yellow"
    assert segments[0].length_m >= 10
    assert segments[0].width_m <= 0.3


def test_uncalibrated_projection_fails_closed() -> None:
    with pytest.raises(ValueError, match="homography"):
        extract_lane_paint(np.ones((20, 20), dtype=np.uint8), np.zeros((3, 3)),
                           "white", 0.9)


def test_reviewed_multidate_masks_feed_the_existing_parking_estimator(tmp_path: Path) -> None:
    base = datetime(2025, 7, 10, tzinfo=UTC)
    footprint = Footprint(polygon_lonlat=(
        (-122.41, 37.79), (-122.40, 37.79), (-122.40, 37.80), (-122.41, 37.79)))
    rights = SourceRights(license_id="test-licensed", attribution="test imagery",
                          status="approved", allowed_uses=("cv_processing",))
    mask = np.zeros((100, 100), dtype=np.uint8)
    cv2.rectangle(mask, (30, 2), (70, 20), 255, -1)
    assert cv2.imwrite(str(tmp_path / "vehicle.png"), mask)
    frames = []
    for day in range(3):
        for instance in range(3):
            captured = base + timedelta(days=day, seconds=instance)
            asset_id = f"frame-{day}-{instance}"
            asset = SourceAsset(
                asset_id=asset_id, dataset_id="test", acquisition_id="test-sequence",
                kind="street_frame", captured_start=captured, captured_end=captured,
                footprint=footprint, gsd_m=0.1, horizontal_crs="EPSG:4326",
                vertical_datum="NAVD88", raw_sha256="a" * 64, raw_size_bytes=10,
                aliases=(SourceAlias(source_id="test", locator=asset_id, rights=rights),))
            (tmp_path / f"{asset_id}.json").write_text(asset.model_dump_json())
            frames.append({
                "source_asset_manifest": f"{asset_id}.json", "source_asset_id": asset_id,
                "captured_at": captured.isoformat(), "calibration_validated": True,
                "privacy_reviewed": True, "image_to_enu": np.diag([0.1, 0.1, 1]).tolist(),
                "face_id": "osm:123", "side": 1,
                "curb_line_enu": [[0, 0], [10, 0]],
                "vehicle_instances": [{"ground_contact_mask": "vehicle.png",
                                       "track_id": asset_id, "moving": False}],
            })
    manifest = tmp_path / "road.json"
    manifest.write_text(json.dumps({"schema_version": 1,
                                    "enu_origin_wgs84": [-122.41, 37.79],
                                    "frames": frames}))
    measure = runpy.run_path(str(Path(__file__).resolve().parents[1] /
                                 "scripts" / "measure_road_imagery.py"))["measure"]
    bands, marks = measure(manifest)
    assert bands["bands"]["osm:123:1"]["status"] == "measured"
    assert bands["bands"]["osm:123:1"]["dates"] == 3
    assert bands["bands"]["osm:123:1"]["vehicles"] == 9
    assert bands["bands"]["osm:123:1"]["width_m"] == pytest.approx(2.0, abs=0.1)
    assert marks["segments"] == []
