"""Stage-one provenance, complete flights and exact decoded-pixel identity."""

from __future__ import annotations

import hashlib
import json
import sys
import types
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

from smc.reconstruction.pixel_store import (
    CanonicalPixels,
    GcsBlobStore,
    LocalBlobStore,
    PixelCatalog,
)
from smc.reconstruction.provenance import (
    AcquisitionManifest,
    FlightManifest,
    Footprint,
    OverlapEdge,
    SourceAlias,
    SourceAsset,
    SourceRights,
    validate_flight_bundle,
)

WHEN = datetime(2025, 7, 10, tzinfo=UTC)
FOOTPRINT = Footprint(polygon_lonlat=(
    (-122.41, 37.79), (-122.40, 37.79), (-122.40, 37.80), (-122.41, 37.79),
))


def rights(license_id: str = "CC-BY-4.0") -> SourceRights:
    return SourceRights(license_id=license_id, attribution=f"source {license_id}",
                        status="approved", allowed_uses=("cv_processing",))


def asset(path: Path, asset_id: str, locator: str, license_id: str = "CC-BY-4.0") -> SourceAsset:
    raw = path.read_bytes()
    return SourceAsset(
        asset_id=asset_id, dataset_id="pilot", acquisition_id="flight-1",
        kind="aerial_frame", captured_start=WHEN, captured_end=WHEN,
        footprint=FOOTPRINT, gsd_m=0.1, horizontal_crs="EPSG:4326",
        vertical_datum="NAVD88", raw_sha256=hashlib.sha256(raw).hexdigest(),
        raw_size_bytes=len(raw), aliases=(SourceAlias(source_id="open-aerial",
                                                     locator=locator,
                                                     rights=rights(license_id)),),
    )


def test_flight_preserves_every_ordered_frame_and_overlap_partner(tmp_path: Path) -> None:
    paths = [tmp_path / f"{i}.png" for i in range(3)]
    for path in paths:
        Image.new("RGB", (3, 3), (2, 4, 6)).save(path)
    assets = [asset(path, f"frame-{i}", f"source://{i}") for i, path in enumerate(paths)]
    acquisition = AcquisitionManifest(
        acquisition_id="flight-1", dataset_id="pilot", source_id="open-aerial", kind="flight",
        captured_start=WHEN, captured_end=WHEN, footprint=FOOTPRINT, gsd_m=0.1,
        horizontal_crs="EPSG:4326", vertical_datum="NAVD88", rights=rights(),
        asset_ids=tuple(row.asset_id for row in assets),
    )
    flight = FlightManifest(
        flight_id="flight-1", acquisition_id="flight-1",
        frame_asset_ids=acquisition.asset_ids, overlap_status="measured",
        overlap_edges=(OverlapEdge(asset_a="frame-0", asset_b="frame-1"),
                       OverlapEdge(asset_a="frame-1", asset_b="frame-2")),
    )
    validate_flight_bundle(acquisition, flight, assets)
    with pytest.raises(ValueError, match="full ordered"):
        validate_flight_bundle(acquisition, flight.model_copy(
            update={"frame_asset_ids": ("frame-0", "frame-2")}), assets)
    with pytest.raises(ValidationError, match="outside the flight"):
        FlightManifest.model_validate({**flight.model_dump(), "overlap_edges": [
            {"asset_a": "frame-0", "asset_b": "missing"}]})


def test_manifest_is_immutable_and_replay_safe(tmp_path: Path) -> None:
    manifest = FlightManifest(flight_id="f", acquisition_id="a", frame_asset_ids=("one",))
    path = tmp_path / "flight.json"
    manifest.write_immutable(path)
    manifest.write_immutable(path)
    assert json.loads(path.read_text())["frame_asset_ids"] == ["one"]
    with pytest.raises(ValueError, match="immutable"):
        manifest.model_copy(update={"overlap_status": "estimated"}).write_immutable(path)


def test_pixel_identical_encodings_share_one_blob_but_keep_both_aliases(tmp_path: Path) -> None:
    first = tmp_path / "a.png"
    second = tmp_path / "b.bmp"
    image = Image.new("RGB", (8, 6), (20, 30, 40))
    image.save(first, compress_level=1)
    image.save(second)
    blobs = LocalBlobStore(tmp_path / "blobs")
    catalog = PixelCatalog(tmp_path / "catalog.sqlite3", blobs, tmp_path / "manifests")
    one = catalog.register(asset(first, "frame-a", "source://first"), first)
    two = catalog.register(asset(second, "frame-b", "source://second", "CC0"), second)
    assert one.pixel_sha256 == two.pixel_sha256
    assert len(list((tmp_path / "blobs").rglob("*.zlib"))) == 1
    assert {(a["locator"], a["license_id"]) for a in catalog.aliases_for(one.pixel_sha256)} == {
        ("source://first", "CC-BY-4.0"), ("source://second", "CC0")}
    assert blobs.get(one.pixel_sha256) == CanonicalPixels.from_image(first).payload()
    catalog.register(asset(first, "frame-a", "source://first"), first)
    assert len(catalog.aliases_for(one.pixel_sha256)) == 2


def test_distinct_stereo_pixels_survive_and_alias_conflicts_fail(tmp_path: Path) -> None:
    first = tmp_path / "a.png"
    second = tmp_path / "b.png"
    pixels = np.full((8, 8, 3), 80, dtype=np.uint8)
    Image.fromarray(pixels).save(first)
    pixels[0, 0, 0] = 81
    Image.fromarray(pixels).save(second)
    catalog = PixelCatalog(tmp_path / "db.sqlite3", LocalBlobStore(tmp_path / "blobs"),
                           tmp_path / "manifests")
    one = catalog.register(asset(first, "a", "source://a"), first)
    two = catalog.register(asset(second, "b", "source://b"), second)
    assert one.pixel_sha256 != two.pixel_sha256
    assert len(list((tmp_path / "blobs").rglob("*.zlib"))) == 2
    with pytest.raises(ValueError, match="locator"):
        catalog.register(asset(second, "c", "source://a"), second)


def test_orientation_and_precision_are_part_of_canonical_pixels(tmp_path: Path) -> None:
    raw = np.array([[1, 256], [1024, 65535]], dtype=np.uint16)
    image = tmp_path / "gray16.tif"
    Image.fromarray(raw).save(image)
    decoded = CanonicalPixels.from_image(image)
    assert decoded.bits_per_channel == 16
    assert decoded.samples == raw.astype("<u2").tobytes()
    assert decoded.sha256 != CanonicalPixels.from_array(raw.astype(np.uint8),
                                                        color_space="Gray").sha256
    rotated = tmp_path / "rotated.jpg"
    rgb = Image.new("RGB", (2, 3), (10, 20, 30))
    exif = Image.Exif()
    exif[274] = 6
    rgb.save(rotated, exif=exif)
    assert CanonicalPixels.from_image(rotated).width == 3


def test_raw_hash_and_manifest_pixel_hash_fail_closed(tmp_path: Path) -> None:
    image = tmp_path / "frame.png"
    Image.new("RGB", (2, 2), (2, 3, 4)).save(image)
    catalog = PixelCatalog(tmp_path / "db.sqlite3", LocalBlobStore(tmp_path / "blobs"),
                           tmp_path / "manifests")
    with pytest.raises(ValueError, match="raw byte checksum"):
        catalog.register(asset(image, "bad", "source://bad").model_copy(
            update={"raw_sha256": "0" * 64}), image)
    with pytest.raises(ValueError, match="canonical pixel hash"):
        catalog.register(asset(image, "bad", "source://bad").model_copy(
            update={"pixel_sha256": "0" * 64}), image)


def test_gcs_backend_uses_create_only_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    class PreconditionFailed(Exception):
        pass

    google = types.ModuleType("google")
    api_core = types.ModuleType("google.api_core")
    errors = types.ModuleType("google.api_core.exceptions")
    errors.PreconditionFailed = PreconditionFailed
    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.api_core", api_core)
    monkeypatch.setitem(sys.modules, "google.api_core.exceptions", errors)
    objects: dict[str, tuple[bytes, dict[str, str]]] = {}

    class Blob:
        def __init__(self, key: str) -> None:
            self.key = key
            self.metadata: dict[str, str] = {}

        def upload_from_string(self, payload: bytes, *, content_type: str,
                               if_generation_match: int) -> None:
            assert content_type == "application/octet-stream"
            assert if_generation_match == 0
            if self.key in objects:
                raise PreconditionFailed
            objects[self.key] = (payload, self.metadata)

        def reload(self) -> None:
            self.metadata = objects[self.key][1]

        def download_as_bytes(self) -> bytes:
            return objects[self.key][0]

    class Bucket:
        name = "test-bucket"

        def blob(self, key: str) -> Blob:
            return Blob(key)

    class Client:
        def bucket(self, name: str) -> Bucket:
            assert name == "test-bucket"
            return Bucket()

    pixels = CanonicalPixels.from_array(np.zeros((2, 2, 3), dtype=np.uint8),
                                        color_space="sRGB")
    store = GcsBlobStore("test-bucket", "private", client=Client())
    import zlib

    packed = zlib.compress(pixels.payload())
    first = store.put_if_absent(pixels.sha256, packed)
    assert first == store.put_if_absent(pixels.sha256, packed)
    assert len(objects) == 1
    assert store.get(pixels.sha256) == pixels.payload()
