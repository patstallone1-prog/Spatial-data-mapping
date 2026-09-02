"""Parquet/JSON storage for bounded external-imagery catalogs."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from smc.imagery.schema import OBSERVATION_SCHEMA, SEQUENCE_SCHEMA, Observation, SequenceRecord

COVERAGE_SCHEMA = pa.schema(
    [
        ("coverage_cell", pa.string()),
        ("latitude", pa.float64()),
        ("longitude", pa.float64()),
        ("total_observations", pa.int32()),
        ("eligible_observations", pa.int32()),
        ("unique_sequences", pa.int32()),
        ("unique_providers", pa.int32()),
        ("newest_capture", pa.timestamp("ms", tz="UTC")),
        ("oldest_capture", pa.timestamp("ms", tz="UTC")),
        ("median_source_megapixels", pa.float32()),
        ("perspective_image_count", pa.int32()),
        ("spherical_image_count", pa.int32()),
        ("heading_diversity", pa.float32()),
        ("temporal_diversity", pa.float32()),
        ("coverage_score", pa.float32()),
    ]
)


def _table(rows: list[dict[str, Any]], schema: pa.Schema) -> pa.Table:
    normalized = [{field.name: row.get(field.name) for field in schema} for row in rows]
    return pa.Table.from_pylist(normalized, schema=schema)


def write_observations(path: Path, observations: list[Observation]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(_table([o.to_row() for o in observations], OBSERVATION_SCHEMA), path, compression="zstd")


def write_sequences(path: Path, sequences: list[SequenceRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(_table([s.to_row() for s in sequences], SEQUENCE_SCHEMA), path, compression="zstd")


def write_coverage(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(_table(rows, COVERAGE_SCHEMA), path, compression="zstd")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")


def read_observations(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return pq.read_table(path).to_pylist()


def dataclass_rows(items: list[Observation] | list[SequenceRecord]) -> list[dict[str, Any]]:
    return [asdict(item) for item in items]
