"""Pilot observation selection and reproducible held-out splits."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq

from smc.reconstruction.contracts import PILOT_BBOX, stable_id
from smc.reconstruction.geo import within_halo

OBSERVATION_COLUMNS = (
    "observation_uid", "provider", "provider_sequence_id", "provider_image_id",
    "captured_at", "latitude", "longitude", "eligible", "license_id", "license_url",
    "attribution", "source_locator", "original_width", "original_height",
    "projection_type", "horizontal_fov", "heading_deg", "pitch_deg", "roll_deg",
    "gps_accuracy_m", "camera_make", "camera_model",
)


def read_observations(catalog_paths: list[Path], bbox: tuple[float, float, float, float],
                      halo_m: float = 0.0) -> list[dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path in catalog_paths:
        if not path.exists():
            raise FileNotFoundError(path)
        schema = pq.read_schema(path)
        names = [name for name in OBSERVATION_COLUMNS if name in schema.names]
        for row in pq.read_table(path, columns=names).to_pylist():
            if not row.get("eligible") or not row.get("observation_uid"):
                continue
            if not row.get("latitude") or not row.get("longitude"):
                continue
            if not within_halo(float(row["longitude"]), float(row["latitude"]), bbox, halo_m):
                continue
            result[row["observation_uid"]] = row
    return sorted(result.values(), key=lambda row: row["observation_uid"])


def _key(row: dict[str, Any]) -> tuple[str, str]:
    day = str(row.get("captured_at") or "")[:10]
    sequence = str(row.get("provider_sequence_id") or row["observation_uid"])
    return day, f"{row['provider']}:{sequence}"


def benchmark_split(rows: list[dict[str, Any]], count: int = 300
                    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Hold out whole capture days, and therefore every sequence recorded on those days."""
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        day, _ = _key(row)
        if day and day != "None" and row.get("source_locator"):
            by_day[day].append(row)
    if len(by_day) < 2:
        raise ValueError("benchmark requires observations from at least two capture dates")
    days = sorted(by_day, key=lambda day: hashlib.sha256(day.encode()).digest())
    withheld: set[str] = set()
    available = 0
    for day in days:
        if len(withheld) >= len(days) - 1:
            break
        withheld.add(day)
        available += len(by_day[day])
        if available >= count:
            break
    if available < count:
        raise ValueError(f"only {available} date-separated observations; need {count}")
    test_pool = [row for row in rows if _key(row)[0] in withheld]
    test = sorted(test_pool, key=lambda row: hashlib.sha256(row["observation_uid"].encode()).digest())[:count]
    train = [row for row in rows if _key(row)[0] not in withheld]
    train_sequences = {_key(row)[1] for row in train}
    if any(_key(row)[1] in train_sequences for row in test):
        raise AssertionError("capture sequence crossed benchmark boundary")
    return train, test


def benchmark_manifest(catalog_paths: list[Path], count: int = 300) -> dict[str, Any]:
    rows = read_observations(catalog_paths, PILOT_BBOX)
    train, test = benchmark_split(rows, count)
    holdouts = []
    for row in test:
        metadata = {
            "observation_uid": row["observation_uid"],
            "provider": row["provider"],
            "provider_image_id": row.get("provider_image_id"),
            "provider_sequence_id": row.get("provider_sequence_id"),
            "captured_at": str(row.get("captured_at")),
            "source_locator": row["source_locator"],
            "license_id": row.get("license_id"),
            "attribution": row.get("attribution"),
        }
        holdouts.append({
            **metadata,
            "metadata_sha256": hashlib.sha256(json.dumps(metadata, sort_keys=True).encode()).hexdigest(),
            "image_sha256": None,
        })
    return {
        "schema_version": 1,
        "benchmark_id": stable_id("sf-pilot", PILOT_BBOX, count),
        "bbox": PILOT_BBOX,
        "split_rule": "whole capture dates and sequences; deterministic SHA-256 sampling",
        "training_observation_count": len(train),
        "held_out_observations": holdouts,
        "truth": {
            "rtk_lidar_checkpoints": [],
            "building_disjoint_material_labels": [],
            "human_reviewed_dynamic_masks": [],
            "fixed_near_field_cameras": [],
            "random_view_seed": 2049,
        },
        "promotion_ready": False,
        "missing_truth": ["image_sha256", "rtk_lidar_checkpoints", "material_labels",
                          "dynamic_masks", "fixed_near_field_cameras"],
    }
