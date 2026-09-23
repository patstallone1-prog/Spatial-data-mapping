"""Prepare reproducible pilot cells without changing the canonical map."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from smc.reconstruction.contracts import (
    HALO_M,
    PILOT_CHUNKS,
    SCHEMA_VERSION,
    SURFACE_SCHEMA,
    load_rights,
    sha256_file,
    validate_cell_manifest,
)
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.glb import massing_from_buildings, write_visual_glb
from smc.reconstruction.observations import read_observations


def _pilot_cells(chunks_path: Path) -> list[dict[str, Any]]:
    rows = json.loads(chunks_path.read_text())["chunks"]
    by_key = {row["key"]: row for row in rows}
    return [by_key[key] for key in PILOT_CHUNKS]


def _iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return str(value)


def prepare_pilot(*, canonical_path: Path, chunks_path: Path,
                  catalog_paths: list[Path], benchmark_path: Path,
                  rights_path: Path, output_dir: Path, run_id: str) -> list[dict[str, Any]]:
    """Write blocked cell manifests and empty surface tables until evidence clears gates."""
    rights = load_rights(rights_path)
    benchmark = json.loads(benchmark_path.read_text())
    withheld = {row["observation_uid"] for row in benchmark["held_out_observations"]}
    canonical_before = sha256_file(canonical_path)
    canonical_ways = json.loads(canonical_path.read_text()).get("ways") or []
    out: list[dict[str, Any]] = []
    for row in _pilot_cells(chunks_path):
        key = row["key"]
        bbox = (float(row["west"]), float(row["south"]), float(row["east"]), float(row["north"]))
        frame = EnuFrame((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0, 0.0)
        observations = [r for r in read_observations(catalog_paths, bbox, HALO_M)
                        if r["observation_uid"] not in withheld]
        approved = [r for r in observations if r["provider"] in rights
                    and rights[r["provider"]].status == "approved"]
        dates = [_iso(r["captured_at"]) for r in approved if r.get("captured_at")]
        attribution = sorted({str(r["attribution"]) for r in approved if r.get("attribution")})
        cell_dir = output_dir / key
        cell_dir.mkdir(parents=True, exist_ok=True)
        visual_lod0 = cell_dir / "visual-lod0.glb"
        positions, normals, faces = massing_from_buildings(canonical_ways, bbox, frame)
        lod0_bytes = write_visual_glb(visual_lod0, positions, normals, faces, cell_id=key)
        surface_path = cell_dir / "surface-metadata.parquet"
        if not surface_path.exists():
            pq.write_table(pa.Table.from_pylist([], schema=SURFACE_SCHEMA), surface_path)
        missing = [
            "licensed_oblique_aerial_images", "verified_vertical_datum", "calibrated_camera_poses",
            "privacy_and_dynamic_masks", "dense_multiview_depth", "independent_geometry_truth",
            "reviewed_material_labels", "validated_lod_assets",
        ]
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "cell_id": key,
            "bbox": list(bbox),
            "halo_m": HALO_M,
            "enu_origin_wgs84": [frame.lon, frame.lat, frame.height_m],
            "enu_to_ecef": frame.enu_to_ecef(),
            "horizontal_datum": "WGS84",
            # The current USGS grid metadata does not identify its vertical datum.
            "vertical_datum": "unverified",
            "canonical_world_sha256": canonical_before,
            "canonical_world_path": str(canonical_path),
            "run_id": run_id,
            "source_time_range": [min(dates) if dates else None, max(dates) if dates else None],
            "attribution": attribution,
            "source_observation_count": len(approved),
            "source_catalog_count": len(observations),
            "held_out_observation_count": sum(1 for r in read_observations(catalog_paths, bbox)
                                                   if r["observation_uid"] in withheld),
            "quality_state": "blocked",
            "missing_inputs": missing,
            "surface_metadata": surface_path.name,
            "lod_assets": {"0": {"url": visual_lod0.name, "bytes": lod0_bytes,
                                 "sha256": sha256_file(visual_lod0), "geometric_error_m": 9.0,
                                 "representation": "visual_massing_only"}},
        }
        validate_cell_manifest(manifest, canonical_path)
        (cell_dir / "cell.json").write_text(json.dumps(manifest, indent=2) + "\n")
        out.append(manifest)
    if sha256_file(canonical_path) != canonical_before:
        raise RuntimeError("canonical world changed during visual preparation")
    return out


def validate_pilot_output(output_dir: Path, canonical_path: Path,
                          benchmark_path: Path) -> dict[str, Any]:
    benchmark = json.loads(benchmark_path.read_text())
    holdouts = benchmark.get("held_out_observations") or []
    if len(holdouts) < 300 or len({r["observation_uid"] for r in holdouts}) != len(holdouts):
        raise ValueError("pilot benchmark lacks 300 unique held-out photos")
    manifests = []
    for key in PILOT_CHUNKS:
        manifest = json.loads((output_dir / key / "cell.json").read_text())
        validate_cell_manifest(manifest, canonical_path)
        surface_path = output_dir / key / manifest["surface_metadata"]
        if not surface_path.exists() or pq.read_schema(surface_path) != SURFACE_SCHEMA:
            raise ValueError(f"surface metadata schema mismatch in {key}")
        if manifest["quality_state"] == "promoted" and manifest.get("missing_inputs"):
            raise ValueError(f"promoted cell {key} still lacks required evidence")
        for asset in manifest["lod_assets"].values():
            asset_path = output_dir / key / asset["url"]
            if asset_path.stat().st_size != asset["bytes"] or sha256_file(asset_path) != asset["sha256"]:
                raise ValueError(f"visual asset hash or size mismatch in {key}")
        manifests.append(manifest)
    return {"cells": len(manifests), "held_out_photos": len(holdouts),
            "promoted": sum(m["quality_state"] == "promoted" for m in manifests),
            "blocked": sum(m["quality_state"] == "blocked" for m in manifests)}
