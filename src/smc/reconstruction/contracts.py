"""Versioned contracts and source-rights checks for visual cells."""

from __future__ import annotations

import enum
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pyarrow as pa

SCHEMA_VERSION = 1
CELL_SIZE_M = 250.0
HALO_M = 30.0
PILOT_CHUNKS = ("c13r03", "c13r04", "c14r03", "c14r04")
PILOT_BBOX = (-122.410552, 37.792737, -122.404868, 37.797229)
LOD_BUDGET_BYTES = {0: 500_000, 1: 1_500_000, 2: 8_000_000}


class Coverage(enum.IntEnum):
    UNKNOWN = 0
    DIRECT_OBSERVATION = 1
    MULTIVIEW_OBSERVATION = 2
    SAME_SURFACE_COMPLETION = 3
    PROCEDURAL_MATERIAL = 4
    GENERATIVE_VISUAL = 5


FACADE_MATERIALS = (
    "stucco_render", "concrete", "brick", "stone", "wood_siding", "metal_panel",
    "glass_curtain_wall", "ceramic_tile", "mixed", "unknown",
)
GROUND_MATERIALS = (
    "asphalt", "concrete", "brick_paver", "stone_cobble", "gravel_soil",
    "grass_vegetation", "paint_thermoplastic", "rubber", "unknown",
)
ROOF_MATERIALS = (
    "membrane", "shingle_bitumen", "metal", "tile", "gravel", "green_roof",
    "glass", "unknown",
)

SURFACE_SCHEMA = pa.schema([
    ("schema_version", pa.int16()),
    ("cell_id", pa.string()),
    ("surface_id", pa.string()),
    ("canonical_feature_id", pa.string()),
    ("canonical_face_id", pa.string()),
    ("semantic_class", pa.string()),
    ("material_probabilities_json", pa.string()),
    ("geometry_confidence", pa.float32()),
    ("direct_fraction", pa.float32()),
    ("multiview_fraction", pa.float32()),
    ("inferred_fraction", pa.float32()),
    ("unknown_fraction", pa.float32()),
    ("provenance", pa.string()),
    ("source_observation_ids", pa.list_(pa.string())),
    ("source_license_ids", pa.list_(pa.string())),
    ("observed_from", pa.timestamp("ms", tz="UTC")),
    ("observed_to", pa.timestamp("ms", tz="UTC")),
    ("source_run_id", pa.string()),
])


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_id(*parts: object) -> str:
    packed = json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(packed.encode()).hexdigest()[:32]


@dataclass(frozen=True)
class SourceRights:
    source_id: str
    license_id: str
    attribution: str
    allowed_uses: frozenset[str]
    status: str

    def require(self, *uses: str) -> None:
        if self.status != "approved":
            raise ValueError(f"source {self.source_id} is {self.status}, not approved")
        missing = set(uses) - self.allowed_uses
        if missing:
            raise ValueError(f"source {self.source_id} lacks rights for {sorted(missing)}")
        if not self.attribution:
            raise ValueError(f"source {self.source_id} lacks attribution")


def load_rights(path: Path) -> dict[str, SourceRights]:
    rows = json.loads(path.read_text())
    result: dict[str, SourceRights] = {}
    for row in rows["sources"]:
        item = SourceRights(
            source_id=str(row["source_id"]),
            license_id=str(row["license_id"]),
            attribution=str(row.get("attribution") or ""),
            allowed_uses=frozenset(row.get("allowed_uses") or []),
            status=str(row["status"]),
        )
        if item.source_id in result:
            raise ValueError(f"duplicate rights row: {item.source_id}")
        result[item.source_id] = item
    return result


def validate_cell_manifest(manifest: dict[str, Any], canonical_path: Path) -> None:
    required = {
        "schema_version", "cell_id", "bbox", "enu_origin_wgs84", "enu_to_ecef",
        "horizontal_datum", "vertical_datum", "canonical_world_sha256", "run_id",
        "source_time_range", "attribution", "quality_state", "lod_assets",
    }
    missing = required - manifest.keys()
    if missing:
        raise ValueError(f"cell manifest missing {sorted(missing)}")
    if manifest["schema_version"] != SCHEMA_VERSION:
        raise ValueError("unsupported cell schema")
    if manifest["canonical_world_sha256"] != sha256_file(canonical_path):
        raise ValueError("canonical world changed after fusion")
    if len(manifest["bbox"]) != 4 or len(manifest["enu_to_ecef"]) != 16:
        raise ValueError("cell bounding box or ENU transform is malformed")
    if manifest["quality_state"] not in {"blocked", "candidate", "promoted"}:
        raise ValueError("unknown quality state")
    for level, asset in manifest["lod_assets"].items():
        if int(level) not in LOD_BUDGET_BYTES:
            raise ValueError(f"unknown LOD {level}")
        if asset["bytes"] > LOD_BUDGET_BYTES[int(level)]:
            raise ValueError(f"LOD {level} exceeds byte budget")
