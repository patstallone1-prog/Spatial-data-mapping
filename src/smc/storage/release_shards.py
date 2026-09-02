"""Plan Git-friendly observation storage and release-asset shards.

The storage contract is deliberately boring:

* Git stores compact metadata, manifests, checksums, and provenance.
* GitHub Release assets store any bulky Kerbside-owned pixels.
* Provider-owned pixels stay as source locators unless explicitly selected.
* The compiled world stores derived geometry/facts plus provenance pointers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

import h3
import pyarrow.parquet as pq

SCHEMA_VERSION = 1
DEFAULT_TARGET_ASSET_BYTES = 500 * 1024 * 1024
DEFAULT_MAX_ASSET_BYTES = 750 * 1024 * 1024
GITHUB_RELEASE_ASSET_LIMIT_BYTES = 2 * 1024 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class StorageRepos:
    """Logical repository split for the long-term data architecture."""

    core: str = "Spatial-data-mapping"
    dataset_registry: str = "kerbside-datasets"
    city_source_data: str = "kerbside-data-sf"
    compiled_world: str = "kerbside-world"


@dataclass(frozen=True, slots=True)
class CaptureAsset:
    """One Kerbside-owned archived frame that can be packed into a release asset."""

    batch: str
    source_name: str
    archived_image: str
    sha256: str
    bytes_archived: int
    latitude: float
    longitude: float
    captured_at: str | None
    tier: str = "tier1_kerbside_1440_jpeg"

    @property
    def relative_path(self) -> str:
        return f"{self.batch}/{self.archived_image}"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _dataset_name(catalog_dir: Path) -> str:
    manifest_path = catalog_dir / "dataset_manifest.json"
    if manifest_path.exists():
        payload = _read_json(manifest_path)
        name = payload.get("name") or payload.get("region")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return catalog_dir.name


def _read_observation_rows(catalog_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted((catalog_dir / "observations").glob("*.parquet")):
        table = pq.read_table(path)
        for row in table.to_pylist():
            row["_metadata_file"] = str(path.relative_to(catalog_dir))
            rows.append(row)
    return rows


def _read_coverage_rows(catalog_dir: Path) -> list[dict[str, Any]]:
    path = catalog_dir / "coverage" / "h3.parquet"
    if not path.exists():
        return []
    return pq.read_table(path).to_pylist()


def summarize_metadata_shards(catalog_dir: Path) -> list[dict[str, Any]]:
    """Return one compact H3 metadata shard summary per covered cell."""

    observations = _read_observation_rows(catalog_dir)
    coverage_by_cell = {
        row["coverage_cell"]: row for row in _read_coverage_rows(catalog_dir) if row.get("coverage_cell")
    }
    by_cell: dict[str, dict[str, Any]] = {}
    for row in observations:
        cell = row.get("coverage_cell")
        if not cell:
            continue
        shard = by_cell.setdefault(
            str(cell),
            {
                "h3_cell": str(cell),
                "tier": "tier0_metadata_only",
                "storage": "git_parquet",
                "metadata_files": set(),
                "observation_count": 0,
                "eligible_observation_count": 0,
                "providers": set(),
                "sequences": set(),
                "pixel_policy": "source_locator_only",
            },
        )
        shard["metadata_files"].add(row["_metadata_file"])
        shard["observation_count"] += 1
        if row.get("eligible"):
            shard["eligible_observation_count"] += 1
        if row.get("provider"):
            shard["providers"].add(row["provider"])
        if row.get("sequence_uid"):
            shard["sequences"].add(row["sequence_uid"])

    summaries: list[dict[str, Any]] = []
    for cell, shard in sorted(by_cell.items()):
        coverage = coverage_by_cell.get(cell, {})
        latlng = h3.cell_to_latlng(cell)
        summaries.append(
            {
                "h3_cell": cell,
                "latitude": coverage.get("latitude", latlng[0]),
                "longitude": coverage.get("longitude", latlng[1]),
                "tier": shard["tier"],
                "storage": shard["storage"],
                "metadata_files": sorted(shard["metadata_files"]),
                "observation_count": shard["observation_count"],
                "eligible_observation_count": shard["eligible_observation_count"],
                "unique_sequences": len(shard["sequences"]),
                "providers": sorted(shard["providers"]),
                "coverage_score": coverage.get("coverage_score"),
                "pixel_policy": shard["pixel_policy"],
            }
        )
    return summaries


def load_capture_assets(capture_root: Path, *, h3_resolution: int = 10) -> list[CaptureAsset]:
    """Load locally archived capture JPEGs from existing batch manifests."""

    if not capture_root.exists():
        return []

    assets: list[CaptureAsset] = []
    for manifest_path in sorted(capture_root.glob("*/manifest.json")):
        batch = manifest_path.parent.name
        try:
            manifest = _read_json(manifest_path)
        except (OSError, json.JSONDecodeError):
            continue
        for record in manifest.get("records", []):
            lat = record.get("lat")
            lon = record.get("lon")
            image = record.get("archived_image")
            digest = record.get("sha256")
            bytes_archived = record.get("bytes_archived")
            if lat is None or lon is None or not image or not digest or not bytes_archived:
                continue
            image_path = manifest_path.parent / str(image)
            if not image_path.exists():
                continue
            assets.append(
                CaptureAsset(
                    batch=batch,
                    source_name=str(record.get("source_name") or image_path.name),
                    archived_image=str(image),
                    sha256=str(digest),
                    bytes_archived=int(bytes_archived),
                    latitude=float(lat),
                    longitude=float(lon),
                    captured_at=record.get("captured_at"),
                )
            )

    return sorted(
        assets,
        key=lambda asset: (
            h3.latlng_to_cell(asset.latitude, asset.longitude, h3_resolution),
            asset.batch,
            asset.archived_image,
        ),
    )


def _github_release_url(release_repo: str | None, release_tag: str, asset_name: str) -> str | None:
    if not release_repo:
        return None
    return f"https://github.com/{release_repo}/releases/download/{release_tag}/{asset_name}"


def plan_capture_release_assets(
    assets: list[CaptureAsset],
    *,
    city_slug: str,
    release_tag: str,
    release_repo: str | None = None,
    h3_resolution: int = 10,
    target_asset_bytes: int = DEFAULT_TARGET_ASSET_BYTES,
    max_asset_bytes: int = DEFAULT_MAX_ASSET_BYTES,
) -> list[dict[str, Any]]:
    """Group Kerbside-owned pixels into bounded H3 release assets."""

    if max_asset_bytes > GITHUB_RELEASE_ASSET_LIMIT_BYTES:
        raise ValueError("max_asset_bytes must stay below GitHub's 2 GiB asset limit")
    if target_asset_bytes <= 0 or max_asset_bytes <= 0:
        raise ValueError("asset byte targets must be positive")
    if target_asset_bytes > max_asset_bytes:
        raise ValueError("target_asset_bytes must be <= max_asset_bytes")

    grouped: dict[str, list[CaptureAsset]] = {}
    for asset in assets:
        cell = h3.latlng_to_cell(asset.latitude, asset.longitude, h3_resolution)
        grouped.setdefault(cell, []).append(asset)

    planned: list[dict[str, Any]] = []
    for cell, cell_assets in sorted(grouped.items()):
        part = 0
        current: list[CaptureAsset] = []
        current_bytes = 0

        def flush() -> None:
            nonlocal part, current, current_bytes
            if not current:
                return

            asset_name = f"{city_slug}-r{h3_resolution}-{cell}-tier1-p{part:03d}.tar"
            checksum_name = f"{city_slug}-r{h3_resolution}-{cell}-tier1-p{part:03d}.sha256"
            planned.append(
                {
                    "asset_name": asset_name,
                    "release_tag": release_tag,
                    "release_repo": release_repo,
                    "download_url": _github_release_url(release_repo, release_tag, asset_name),
                    "h3_cell": cell,
                    "part": part,
                    "tier": "tier1_kerbside_1440_jpeg",
                    "storage": "github_release_asset",
                    "target_asset_bytes": target_asset_bytes,
                    "max_asset_bytes": max_asset_bytes,
                    "bytes": current_bytes,
                    "image_count": len(current),
                    "sha256_manifest": checksum_name,
                    "sha256_manifest_url": _github_release_url(release_repo, release_tag, checksum_name),
                    "images": [
                        {
                            "batch": item.batch,
                            "path": item.relative_path,
                            "source_name": item.source_name,
                            "sha256": item.sha256,
                            "bytes": item.bytes_archived,
                            "lat": item.latitude,
                            "lon": item.longitude,
                            "captured_at": item.captured_at,
                        }
                        for item in current
                    ],
                }
            )
            part += 1
            current = []
            current_bytes = 0

        for asset in cell_assets:
            would_exceed_target = current and current_bytes + asset.bytes_archived > target_asset_bytes
            would_exceed_max = current and current_bytes + asset.bytes_archived > max_asset_bytes
            if would_exceed_target or would_exceed_max:
                flush()
            current.append(asset)
            current_bytes += asset.bytes_archived
            if current_bytes >= max_asset_bytes:
                flush()
        flush()

    return planned


def build_storage_manifest(
    catalog_dir: Path,
    *,
    city_slug: str,
    city_name: str,
    release_tag: str,
    release_repo: str | None = "patstallone1-prog/Spatial-data-mapping",
    capture_root: Path | None = None,
    h3_resolution: int = 10,
    target_asset_bytes: int = DEFAULT_TARGET_ASSET_BYTES,
    max_asset_bytes: int = DEFAULT_MAX_ASSET_BYTES,
    repos: StorageRepos | None = None,
) -> dict[str, Any]:
    """Build the machine-readable storage plan for one city/region catalog."""

    repos = repos or StorageRepos()
    metadata_shards = summarize_metadata_shards(catalog_dir)
    capture_assets = (
        load_capture_assets(capture_root, h3_resolution=h3_resolution) if capture_root is not None else []
    )
    release_assets = plan_capture_release_assets(
        capture_assets,
        city_slug=city_slug,
        release_tag=release_tag,
        release_repo=release_repo,
        h3_resolution=h3_resolution,
        target_asset_bytes=target_asset_bytes,
        max_asset_bytes=max_asset_bytes,
    )
    pixel_bytes = sum(asset["bytes"] for asset in release_assets)

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "dataset": _dataset_name(catalog_dir),
        "city": {"slug": city_slug, "name": city_name},
        "h3_resolution": h3_resolution,
        "repositories": {
            "core": {
                "name": repos.core,
                "purpose": "code, tests, schemas, lightweight manifests, GitHub Pages viewers",
            },
            "dataset_registry": {
                "name": repos.dataset_registry,
                "purpose": "tiny city/version registry with hashes and latest pointers",
            },
            "city_source_data": {
                "name": repos.city_source_data,
                "purpose": "metadata in Git plus bounded H3 image shards in GitHub Releases",
            },
            "compiled_world": {
                "name": repos.compiled_world,
                "purpose": "derived geometry, facts, 3D tiles, and provenance pointers",
            },
        },
        "tiers": [
            {
                "id": "tier0_metadata_only",
                "stored_in": "git",
                "contents": "provider ids, source locators, sequence links, GPS, camera metadata, license provenance",
            },
            {
                "id": "tier1_kerbside_1440_jpeg",
                "stored_in": "github_release_assets",
                "contents": "downscaled Kerbside-owned mapping frames, sharded by H3 and target byte size",
            },
            {
                "id": "tier2_original_selects",
                "stored_in": "github_release_assets",
                "contents": "optional selected raw/full-resolution originals; never created by default",
            },
            {
                "id": "compiled_world",
                "stored_in": "world_repo_or_pages_artifact",
                "contents": "derived curb, sidewalk, building, mesh, confidence, and provenance facts",
            },
        ],
        "policies": {
            "git_pixel_policy": "metadata_and_derived_viewers_only",
            "raw_original_policy": "disabled_by_default",
            "release_asset_target_bytes": target_asset_bytes,
            "release_asset_max_bytes": max_asset_bytes,
            "github_release_asset_limit_bytes": GITHUB_RELEASE_ASSET_LIMIT_BYTES,
            "dedupe_key": "sha256 for owned captures; provider/provider_instance/provider_image_id for external imagery",
            "neighborhood_policy": "human label only; H3 cells are the physical shard boundary",
            "release_repo": release_repo,
            "release_url": f"https://github.com/{release_repo}/releases/tag/{release_tag}"
            if release_repo
            else None,
        },
        "metadata_shards": metadata_shards,
        "release_assets": release_assets,
        "summary": {
            "metadata_shard_count": len(metadata_shards),
            "release_asset_count": len(release_assets),
            "release_image_count": sum(asset["image_count"] for asset in release_assets),
            "release_pixel_bytes": pixel_bytes,
            "release_pixel_megabytes": round(pixel_bytes / 1024 / 1024, 3),
            "external_pixel_bytes_committed": 0,
        },
    }


def write_storage_manifest(path: Path, manifest: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return path
