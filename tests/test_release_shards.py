from __future__ import annotations

import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from smc.storage.release_shards import (
    build_storage_manifest,
    load_capture_assets,
    plan_capture_release_assets,
)


def _write_catalog(root: Path) -> None:
    (root / "observations").mkdir(parents=True)
    (root / "coverage").mkdir()
    (root / "dataset_manifest.json").write_text(json.dumps({"name": "Test SF"}))
    observations = pa.table(
        {
            "observation_uid": ["a", "b", "c"],
            "provider": ["panoramax", "kartaview", "panoramax"],
            "sequence_uid": ["s1", "s2", "s1"],
            "coverage_cell": [
                "8a28308280a7fff",
                "8a28308280a7fff",
                "8a28308280affff",
            ],
            "eligible": [True, True, False],
        }
    )
    pq.write_table(observations, root / "observations" / "external-000.parquet")
    coverage = pa.table(
        {
            "coverage_cell": ["8a28308280a7fff", "8a28308280affff"],
            "latitude": [37.8, 37.81],
            "longitude": [-122.42, -122.41],
            "coverage_score": [0.75, 0.25],
        }
    )
    pq.write_table(coverage, root / "coverage" / "h3.parquet")


def _write_capture_batch(root: Path) -> None:
    batch = root / "20260902T010000Z"
    images = batch / "images"
    images.mkdir(parents=True)
    first = images / "first.jpg"
    second = images / "second.jpg"
    first.write_bytes(b"jpeg-one")
    second.write_bytes(b"jpeg-two")
    (batch / "manifest.json").write_text(
        json.dumps(
            {
                "records": [
                    {
                        "source_name": "first.HEIC",
                        "archived_image": "images/first.jpg",
                        "sha256": "a" * 64,
                        "bytes_archived": first.stat().st_size,
                        "lat": 37.8001,
                        "lon": -122.4201,
                        "captured_at": "2026-09-02T01:00:00+00:00",
                    },
                    {
                        "source_name": "nogps.HEIC",
                        "archived_image": "images/nogps.jpg",
                        "sha256": "b" * 64,
                        "bytes_archived": 10,
                    },
                    {
                        "source_name": "second.HEIC",
                        "archived_image": "images/second.jpg",
                        "sha256": "c" * 64,
                        "bytes_archived": second.stat().st_size,
                        "lat": 37.8001,
                        "lon": -122.4201,
                        "captured_at": "2026-09-02T01:00:01+00:00",
                    },
                ]
            }
        )
    )


def test_storage_manifest_keeps_external_pixels_out_of_git(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog"
    captures = tmp_path / "captures"
    _write_catalog(catalog)
    _write_capture_batch(captures)

    manifest = build_storage_manifest(
        catalog,
        city_slug="sf",
        city_name="San Francisco",
        release_tag="sf-test",
        release_repo="owner/repo",
        capture_root=captures,
        target_asset_bytes=20,
        max_asset_bytes=30,
    )

    assert manifest["repositories"]["city_source_data"]["name"] == "kerbside-data-sf"
    assert manifest["summary"]["metadata_shard_count"] == 2
    assert manifest["summary"]["external_pixel_bytes_committed"] == 0
    assert manifest["summary"]["release_image_count"] == 2
    assert {shard["pixel_policy"] for shard in manifest["metadata_shards"]} == {
        "source_locator_only"
    }
    assert all(asset["asset_name"].endswith(".tar") for asset in manifest["release_assets"])
    assert all(
        asset["download_url"].startswith("https://github.com/owner/repo/releases/download/sf-test/")
        for asset in manifest["release_assets"]
    )


def test_capture_release_assets_split_by_byte_budget(tmp_path: Path) -> None:
    captures = tmp_path / "captures"
    _write_capture_batch(captures)
    assets = load_capture_assets(captures)

    planned = plan_capture_release_assets(
        assets,
        city_slug="sf",
        release_tag="sf-test",
        release_repo="owner/repo",
        target_asset_bytes=7,
        max_asset_bytes=8,
    )

    assert len(assets) == 2
    assert len(planned) == 2
    assert [asset["part"] for asset in planned] == [0, 1]
    assert planned[0]["storage"] == "github_release_asset"
    assert planned[0]["sha256_manifest_url"].startswith(
        "https://github.com/owner/repo/releases/download/sf-test/"
    )
