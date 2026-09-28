"""One lossless canonical pixel blob, many independently attributed source aliases.

Only exact decoded-pixel identity deduplicates. Perceptual hashes, geographic
proximity and viewpoint heuristics are deliberately absent from this store.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sqlite3
import struct
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image, ImageCms, ImageOps

from smc.reconstruction.provenance import SourceAsset

MAGIC = b"SMCPIX1\0"
IMAGE_KINDS = {"aerial_frame", "street_frame", "orthomosaic", "satellite"}


@dataclass(frozen=True)
class CanonicalPixels:
    width: int
    height: int
    channels: int
    bits_per_channel: int
    color_space: str
    samples: bytes

    @classmethod
    def from_array(cls, array: np.ndarray, *, color_space: str) -> CanonicalPixels:
        if array.ndim not in (2, 3) or array.shape[0] < 1 or array.shape[1] < 1:
            raise ValueError("pixels must be a nonempty HxW or HxWxC array")
        channels = 1 if array.ndim == 2 else array.shape[2]
        if channels not in (1, 2, 3, 4):
            raise ValueError("unsupported channel count")
        if array.dtype == np.uint8:
            bits, normalized = 8, np.ascontiguousarray(array)
        elif array.dtype.kind == "u" and array.dtype.itemsize == 2:
            bits, normalized = 16, np.ascontiguousarray(array.astype("<u2", copy=False))
        else:
            raise ValueError("only unsigned 8-bit and 16-bit pixels are losslessly supported")
        if color_space not in {"sRGB", "Gray"}:
            raise ValueError("pixels must be normalized to sRGB or Gray")
        if (color_space == "sRGB" and channels not in (3, 4)) or (
            color_space == "Gray" and channels not in (1, 2)
        ):
            raise ValueError("channel count does not match color space")
        return cls(array.shape[1], array.shape[0], channels, bits, color_space,
                   normalized.tobytes(order="C"))

    @classmethod
    def from_image(cls, path: Path) -> CanonicalPixels:
        """Decode, apply EXIF orientation and ICC→sRGB, without silent bit loss.

        Pillow cannot preserve every high-bit-depth multichannel TIFF. Those
        inputs fail closed until a GDAL/libvips adapter supplies a uint16 array.
        """
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source)
            bits = source.tag_v2.get(258) if hasattr(source, "tag_v2") else None
            if bits is not None and max(bits if isinstance(bits, tuple) else (bits,)) > 8 \
                    and image.mode in {"RGB", "RGBA", "L", "LA"}:
                raise ValueError("high-bit-depth TIFF needs a lossless uint16 decoder")
            icc = image.info.get("icc_profile") or source.info.get("icc_profile")
            if image.mode in {"I;16", "I;16L", "I;16B"}:
                if icc:
                    raise ValueError("16-bit ICC image needs a lossless color adapter")
                return cls.from_array(np.asarray(image), color_space="Gray")
            if image.mode not in {"RGB", "RGBA", "L", "LA"}:
                raise ValueError(f"unsupported image mode {image.mode}; no implicit conversion")
            if icc:
                alpha = image.getchannel("A") if "A" in image.getbands() else None
                color = image.convert("RGB") if image.mode == "RGBA" else (
                    image.convert("L") if image.mode == "LA" else image
                )
                color = ImageCms.profileToProfile(
                    color, ImageCms.ImageCmsProfile(io.BytesIO(icc)),
                    ImageCms.createProfile("sRGB"), outputMode="RGB",
                )
                image = Image.merge("RGBA", (*color.split(), alpha)) if alpha else color
            color_space = "Gray" if image.mode in {"L", "LA"} else "sRGB"
            return cls.from_array(np.asarray(image), color_space=color_space)

    def payload(self) -> bytes:
        header = json.dumps({"schema_version": 1, "width": self.width, "height": self.height,
                             "channels": self.channels, "bits_per_channel": self.bits_per_channel,
                             "color_space": self.color_space}, sort_keys=True,
                            separators=(",", ":")).encode("ascii")
        return MAGIC + struct.pack(">I", len(header)) + header + self.samples

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.payload()).hexdigest()


class BlobStore(Protocol):
    def put_if_absent(self, digest: str, compressed: bytes) -> str: ...
    def get(self, digest: str) -> bytes: ...


def blob_key(digest: str) -> str:
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("invalid SHA-256 pixel digest")
    return f"pixels/v1/sha256/{digest[:2]}/{digest}.zlib"


class LocalBlobStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def put_if_absent(self, digest: str, compressed: bytes) -> str:
        key = blob_key(digest)
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=path.parent, prefix=".pixel-", delete=False,
            ) as stream:
                temporary = stream.name
                stream.write(compressed)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                if hashlib.sha256(zlib.decompress(path.read_bytes())).hexdigest() != digest:
                    raise ValueError(f"existing pixel blob is corrupt: {path}") from None
        finally:
            if temporary:
                os.unlink(temporary)
        return key

    def get(self, digest: str) -> bytes:
        payload = zlib.decompress((self.root / blob_key(digest)).read_bytes())
        if hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError("pixel blob checksum mismatch")
        return payload


class GcsBlobStore:
    """Cloud blobs with atomic create-only semantics; metadata catalog stays small."""

    def __init__(self, bucket_name: str, prefix: str = "", client: object | None = None) -> None:
        if not bucket_name:
            raise ValueError("GCS bucket is required")
        if client is None:
            from google.cloud import storage  # optional `gcs` project extra
            client = storage.Client()
        self.bucket = client.bucket(bucket_name)
        self.prefix = prefix.strip("/")

    def _key(self, digest: str) -> str:
        return "/".join(part for part in (self.prefix, blob_key(digest)) if part)

    def put_if_absent(self, digest: str, compressed: bytes) -> str:
        from google.api_core.exceptions import PreconditionFailed

        key = self._key(digest)
        blob = self.bucket.blob(key)
        blob.metadata = {"canonical_pixel_sha256": digest, "encoding": "zlib"}
        try:
            blob.upload_from_string(compressed, content_type="application/octet-stream",
                                    if_generation_match=0)
        except PreconditionFailed:
            blob.reload()
            if (blob.metadata or {}).get("canonical_pixel_sha256") != digest:
                raise ValueError(
                    f"existing cloud blob metadata mismatch: gs://{self.bucket.name}/{key}"
                ) from None
        return f"gs://{self.bucket.name}/{key}"

    def get(self, digest: str) -> bytes:
        payload = zlib.decompress(self.bucket.blob(self._key(digest)).download_as_bytes())
        if hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError("cloud pixel blob checksum mismatch")
        return payload


class PixelCatalog:
    """SQLite aliases/rights index; large pixel blobs can live in GCS."""

    def __init__(self, database: Path, blobs: BlobStore, manifest_root: Path) -> None:
        self.database = database
        self.blobs = blobs
        self.manifest_root = manifest_root
        database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS pixel_blobs (
                    pixel_sha256 TEXT PRIMARY KEY, width INTEGER NOT NULL,
                    height INTEGER NOT NULL, channels INTEGER NOT NULL,
                    bits_per_channel INTEGER NOT NULL, color_space TEXT NOT NULL,
                    object_uri TEXT NOT NULL, uncompressed_bytes INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS assets (
                    asset_id TEXT PRIMARY KEY, pixel_sha256 TEXT NOT NULL,
                    manifest_json TEXT NOT NULL,
                    FOREIGN KEY(pixel_sha256) REFERENCES pixel_blobs(pixel_sha256)
                );
                CREATE TABLE IF NOT EXISTS aliases (
                    source_id TEXT NOT NULL, locator TEXT NOT NULL,
                    asset_id TEXT NOT NULL, license_id TEXT NOT NULL,
                    attribution TEXT NOT NULL, rights_json TEXT NOT NULL,
                    PRIMARY KEY(source_id, locator),
                    FOREIGN KEY(asset_id) REFERENCES assets(asset_id)
                );
            """)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def register(self, asset: SourceAsset, raw_path: Path) -> SourceAsset:
        if asset.kind not in IMAGE_KINDS:
            raise ValueError("pixel store only accepts image assets")
        digest = hashlib.sha256()
        size = 0
        with raw_path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        if size != asset.raw_size_bytes or digest.hexdigest() != asset.raw_sha256:
            raise ValueError("source raw byte checksum or length mismatch")
        pixels = CanonicalPixels.from_image(raw_path)
        if asset.pixel_sha256 is not None and asset.pixel_sha256 != pixels.sha256:
            raise ValueError("declared canonical pixel hash mismatch")
        registered = asset.model_copy(update={"pixel_sha256": pixels.sha256})
        manifest_json = registered.canonical_bytes().decode("utf-8")
        with self._connect() as conn:
            existing = conn.execute("SELECT manifest_json FROM assets WHERE asset_id=?",
                                    (asset.asset_id,)).fetchone()
            if existing and existing[0] != manifest_json:
                raise ValueError("asset ID already maps to different provenance or pixels")
            for alias in asset.aliases:
                previous = conn.execute(
                    "SELECT asset_id FROM aliases WHERE source_id=? AND locator=?",
                    (alias.source_id, alias.locator),
                ).fetchone()
                if previous and previous[0] != asset.asset_id:
                    raise ValueError("source locator already maps to another asset")
        object_uri = self.blobs.put_if_absent(
            pixels.sha256, zlib.compress(pixels.payload(), level=6),
        )
        with self._connect() as conn:
            conn.execute("INSERT OR IGNORE INTO pixel_blobs VALUES (?,?,?,?,?,?,?,?)",
                         (pixels.sha256, pixels.width, pixels.height, pixels.channels,
                          pixels.bits_per_channel, pixels.color_space, object_uri,
                          len(pixels.payload())))
            conn.execute("INSERT OR IGNORE INTO assets VALUES (?,?,?)",
                         (asset.asset_id, pixels.sha256, manifest_json))
            actual = conn.execute("SELECT manifest_json FROM assets WHERE asset_id=?",
                                  (asset.asset_id,)).fetchone()
            if actual is None or actual[0] != manifest_json:
                raise ValueError("asset ID changed during concurrent registration")
            for alias in asset.aliases:
                conn.execute("INSERT OR IGNORE INTO aliases VALUES (?,?,?,?,?,?)",
                             (alias.source_id, alias.locator, asset.asset_id,
                              alias.rights.license_id, alias.rights.attribution,
                              alias.rights.model_dump_json()))
                actual_alias = conn.execute(
                    "SELECT asset_id, rights_json FROM aliases WHERE source_id=? AND locator=?",
                    (alias.source_id, alias.locator),
                ).fetchone()
                if actual_alias != (asset.asset_id, alias.rights.model_dump_json()):
                    raise ValueError("source alias changed during concurrent registration")
        registered.write_immutable(self.manifest_root / "assets" / f"{asset.asset_id}.json")
        return registered

    def aliases_for(self, pixel_sha256: str) -> list[dict[str, str]]:
        with self._connect() as conn:
            rows = conn.execute("""SELECT aliases.source_id, aliases.locator,
                aliases.asset_id, aliases.license_id, aliases.attribution
                FROM aliases JOIN assets USING(asset_id)
                WHERE assets.pixel_sha256=? ORDER BY aliases.source_id, aliases.locator""",
                (pixel_sha256,)).fetchall()
        return [dict(zip(("source_id", "locator", "asset_id", "license_id", "attribution"),
                         row, strict=True))
                for row in rows]
