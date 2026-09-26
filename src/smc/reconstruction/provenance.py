"""Immutable, typed provenance for imagery and other reconstruction inputs.

An acquisition (a complete flight or street sequence) is the unit of work.
Its assets remain individually addressable, but ingestion must not thin the
ordered frame list or discard an overlap partner.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1] = 1

    def canonical_bytes(self) -> bytes:
        return (json.dumps(self.model_dump(mode="json"), sort_keys=True,
                           separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")

    def write_immutable(self, path: Path) -> None:
        """Create once; an identical replay is harmless, a change is an error."""
        payload = self.canonical_bytes()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary: str | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".manifest-",
                                             delete=False) as stream:
                temporary = stream.name
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != payload:
                    raise ValueError(f"immutable manifest differs: {path}") from None
        finally:
            if temporary:
                os.unlink(temporary)


class Footprint(Manifest):
    crs: Literal["EPSG:4326"] = "EPSG:4326"
    polygon_lonlat: tuple[tuple[float, float], ...]

    @field_validator("polygon_lonlat")
    @classmethod
    def valid_polygon(
        cls, points: tuple[tuple[float, float], ...],
    ) -> tuple[tuple[float, float], ...]:
        if len(points) < 4 or points[0] != points[-1]:
            raise ValueError("footprint must be a closed polygon with at least three vertices")
        if any(not (-180 <= lon <= 180 and -90 <= lat <= 90) for lon, lat in points):
            raise ValueError("footprint contains invalid WGS84 coordinates")
        if len(set(points[:-1])) < 3:
            raise ValueError("footprint has fewer than three distinct vertices")
        return points


class SourceRights(Manifest):
    license_id: str = Field(min_length=1)
    license_url: str | None = None
    attribution: str = Field(min_length=1)
    status: Literal["approved", "conditional", "restricted", "unknown"]
    allowed_uses: tuple[str, ...] = ()


class CameraCalibration(Manifest):
    model: str = Field(min_length=1)
    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)
    intrinsics: tuple[float, ...] = ()
    distortion: tuple[float, ...] = ()
    fiducial_marks_px: tuple[tuple[float, float], ...] = ()
    calibration_source: str = Field(min_length=1)


class SourceAlias(Manifest):
    source_id: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    rights: SourceRights


class SourceAsset(Manifest):
    asset_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
    dataset_id: str = Field(min_length=1)
    acquisition_id: str = Field(min_length=1)
    kind: Literal["aerial_frame", "street_frame", "orthomosaic", "satellite",
                  "lidar", "dem", "gis"]
    captured_start: datetime
    captured_end: datetime
    footprint: Footprint
    gsd_m: float | None = Field(default=None, gt=0)
    horizontal_crs: str = Field(min_length=1)
    vertical_datum: str = Field(min_length=1)
    calibration: CameraCalibration | None = None
    raw_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    raw_size_bytes: int = Field(ge=0)
    aliases: tuple[SourceAlias, ...] = Field(min_length=1)
    pixel_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @field_validator("captured_start", "captured_end")
    @classmethod
    def aware_capture_time(cls, value: datetime) -> datetime:
        if value.utcoffset() is None:
            raise ValueError("capture epoch needs an explicit timezone")
        return value

    @model_validator(mode="after")
    def valid_asset(self) -> SourceAsset:
        if self.captured_end < self.captured_start:
            raise ValueError("asset capture end precedes start")
        if len({(alias.source_id, alias.locator) for alias in self.aliases}) != len(self.aliases):
            raise ValueError("duplicate source alias")
        return self


class AcquisitionManifest(Manifest):
    acquisition_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
    dataset_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    kind: Literal["flight", "street_sequence", "orthomosaic", "point_cloud",
                  "terrain", "satellite", "gis_collection"]
    captured_start: datetime
    captured_end: datetime
    footprint: Footprint
    gsd_m: float | None = Field(default=None, gt=0)
    horizontal_crs: str = Field(min_length=1)
    vertical_datum: str = Field(min_length=1)
    calibration: CameraCalibration | None = None
    source_manifest_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    rights: SourceRights
    asset_ids: tuple[str, ...] = Field(min_length=1)

    @field_validator("captured_start", "captured_end")
    @classmethod
    def aware_capture_time(cls, value: datetime) -> datetime:
        if value.utcoffset() is None:
            raise ValueError("capture epoch needs an explicit timezone")
        return value

    @model_validator(mode="after")
    def valid_acquisition(self) -> AcquisitionManifest:
        if self.captured_end < self.captured_start:
            raise ValueError("acquisition capture end precedes start")
        if len(set(self.asset_ids)) != len(self.asset_ids):
            raise ValueError("acquisition repeats an asset")
        return self


class OverlapEdge(Manifest):
    asset_a: str = Field(min_length=1)
    asset_b: str = Field(min_length=1)
    overlap_fraction: float | None = Field(default=None, ge=0, le=1)
    tie_points: int | None = Field(default=None, ge=0)


class FlightManifest(Manifest):
    """Complete ordered frame set; edges describe, never filter, the frames."""

    flight_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
    acquisition_id: str = Field(min_length=1)
    frame_asset_ids: tuple[str, ...] = Field(min_length=1)
    overlap_edges: tuple[OverlapEdge, ...] = ()
    overlap_status: Literal["measured", "estimated", "unknown"] = "unknown"

    @model_validator(mode="after")
    def valid_graph(self) -> FlightManifest:
        frames = set(self.frame_asset_ids)
        if len(frames) != len(self.frame_asset_ids):
            raise ValueError("flight repeats a frame")
        seen: set[tuple[str, str]] = set()
        for edge in self.overlap_edges:
            if edge.asset_a not in frames or edge.asset_b not in frames:
                raise ValueError("overlap edge refers to a frame outside the flight")
            if edge.asset_a == edge.asset_b:
                raise ValueError("overlap edge cannot be a self-loop")
            key = tuple(sorted((edge.asset_a, edge.asset_b)))
            if key in seen:
                raise ValueError("duplicate overlap edge")
            seen.add(key)
        if self.overlap_status == "measured" and not self.overlap_edges and len(frames) > 1:
            raise ValueError("measured flight must include overlap edges")
        return self


def validate_flight_bundle(
    acquisition: AcquisitionManifest, flight: FlightManifest,
    assets: list[SourceAsset],
) -> None:
    """Reject missing/reordered frames instead of silently selecting a subset."""
    if acquisition.kind not in {"flight", "street_sequence"}:
        raise ValueError("flight manifest needs a flight or street-sequence acquisition")
    if flight.acquisition_id != acquisition.acquisition_id:
        raise ValueError("flight acquisition ID mismatch")
    if flight.frame_asset_ids != acquisition.asset_ids:
        raise ValueError("flight frames must equal the acquisition's full ordered asset list")
    by_id = {asset.asset_id: asset for asset in assets}
    if len(by_id) != len(assets) or set(by_id) != set(flight.frame_asset_ids):
        raise ValueError("flight bundle is missing, duplicating, or adding asset manifests")
    expected = "aerial_frame" if acquisition.kind == "flight" else "street_frame"
    if any(asset.kind != expected or asset.acquisition_id != acquisition.acquisition_id
           or asset.dataset_id != acquisition.dataset_id for asset in assets):
        raise ValueError("flight asset has the wrong type, dataset, or acquisition")
    if any(asset.captured_start < acquisition.captured_start
           or asset.captured_end > acquisition.captured_end for asset in assets):
        raise ValueError("flight frame capture epoch falls outside its acquisition")


def manifest_sha256(manifest: Manifest) -> str:
    return hashlib.sha256(manifest.canonical_bytes()).hexdigest()
