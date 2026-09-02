"""Parquet schemas for CV/depth outputs and simulation surfaces."""

from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

DEPTH_SCHEMA_VERSION = 1

PROVENANCE_MEASURED = "measured"
PROVENANCE_INFERRED = "inferred"
PROVENANCE_NEEDS_DEPTH = "needs_depth"

STATUS_NEEDS_DEPTH = "needs_depth"
STATUS_PROCESSED = "processed"
STATUS_FAILED = "failed"

SURFACE_SCHEMA = pa.schema(
    [
        ("surface_uid", pa.string()),
        ("feature_id", pa.string()),
        ("source_kind", pa.string()),
        ("surface_type", pa.string()),
        ("provenance", pa.string()),
        ("h3_cell", pa.string()),
        ("covered_by_observations", pa.bool_()),
        ("observation_count", pa.int32()),
        ("provider_count", pa.int32()),
        ("coverage_score", pa.float32()),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("geometry_json", pa.string()),
        ("height_m", pa.float32()),
        ("height_sigma_m", pa.float32()),
        ("curb_height_m", pa.float32()),
        ("curb_height_sigma_m", pa.float32()),
        ("sidewalk_width_m", pa.float32()),
        ("sidewalk_width_sigma_m", pa.float32()),
        ("cross_slope", pa.float32()),
        ("cross_slope_sigma", pa.float32()),
        ("facade_height_m", pa.float32()),
        ("facade_height_sigma_m", pa.float32()),
        ("height_source", pa.string()),
        ("depth_run_id", pa.string()),
        ("confidence", pa.float32()),
        ("simulation_ready", pa.bool_()),
        ("requires_cv_depth", pa.bool_()),
        ("flags_json", pa.string()),
        ("generated_at", pa.timestamp("ms", tz="UTC")),
    ]
)

DEPTH_OBSERVATION_SCHEMA = pa.schema(
    [
        ("run_id", pa.string()),
        ("observation_uid", pa.string()),
        ("provider", pa.string()),
        ("provider_instance", pa.string()),
        ("provider_image_id", pa.string()),
        ("provider_sequence_id", pa.string()),
        ("coverage_cell", pa.string()),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("captured_at", pa.timestamp("ms", tz="UTC")),
        ("depth_status", pa.string()),
        ("depth_source", pa.string()),
        ("segmentation_source", pa.string()),
        ("metric_depth_uri", pa.string()),
        ("segmentation_uri", pa.string()),
        ("point_cloud_uri", pa.string()),
        ("scale_relative_sigma", pa.float32()),
        ("confidence", pa.float32()),
        ("error", pa.string()),
        ("generated_at", pa.timestamp("ms", tz="UTC")),
    ]
)


def _table(rows: list[dict[str, Any]], schema: pa.Schema) -> pa.Table:
    normalized = [{field.name: row.get(field.name) for field in schema} for row in rows]
    return pa.Table.from_pylist(normalized, schema=schema)


def write_surfaces(path: Path, rows: list[dict[str, Any]]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(_table(rows, SURFACE_SCHEMA), path, compression="zstd")
    return path


def read_surfaces(path: Path) -> list[dict[str, Any]]:
    return pq.read_table(path).to_pylist() if path.exists() else []


def write_depth_observations(path: Path, rows: list[dict[str, Any]]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(_table(rows, DEPTH_OBSERVATION_SCHEMA), path, compression="zstd")
    return path


def read_depth_observations(path: Path) -> list[dict[str, Any]]:
    return pq.read_table(path).to_pylist() if path.exists() else []


def write_json(path: Path, payload: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")
    return path


def utcnow() -> datetime:
    return datetime.now(UTC)

