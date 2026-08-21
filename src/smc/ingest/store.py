"""The frame store.

Frames are addressed by the SHA-256 of their bytes, not by a sequence number or a UUID. Three
things follow, and all three matter for a contributor network:

* **Uploads are idempotent for free.** A flaky link that retries a chunk cannot create a
  duplicate observation, and a duplicate observation would inflate the corroboration count —
  the one number the whole confidence model rests on.
* **Deduplication is automatic.** Two contributors who capture the identical frame (the same
  device re-uploading, a replayed journal) store one blob.
* **Provenance is verifiable.** A frame's id is checkable against its content, so a corrupted
  or substituted blob is detectable rather than silently fused.

Imagery here is *transient*. The re-spec is explicit that the product is the world-facts table
and that transport imagery is discarded after fusion, so the store carries an expiry from the
moment a frame lands rather than acquiring a retention policy later.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol, runtime_checkable

#: How long raw imagery may live before fusion must have consumed it.
DEFAULT_RETENTION = timedelta(days=30)


def content_id(payload: bytes) -> str:
    """Content address of a frame. Truncated to 32 hex chars — 128 bits, ample here."""
    if not payload:
        raise ValueError("refusing to address an empty payload")
    return hashlib.sha256(payload).hexdigest()[:32]


@dataclass(frozen=True, slots=True)
class FrameRecord:
    """Metadata for one stored frame — the engine-visible view of a capture."""

    frame_id: str
    contributor_id: str
    captured_at: datetime
    lat: float
    lon: float
    position_sigma_m: float
    camera: str
    focal_px: float
    width: int
    height: int
    size_bytes: int
    #: H3 cell at the working resolution.
    cell_id: str = ""
    #: Why the trigger fired: "novelty" | "scene_change" | "max_baseline".
    trigger: str = ""
    redacted: bool = False
    expires_at: datetime | None = None
    flags: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.captured_at.tzinfo is None:
            raise ValueError("captured_at must be timezone-aware")
        if self.position_sigma_m < 0:
            raise ValueError("position_sigma_m must be non-negative")
        if self.expires_at is None:
            object.__setattr__(self, "expires_at", self.captured_at + DEFAULT_RETENTION)

    def is_expired(self, now: datetime | None = None) -> bool:
        return (now or datetime.now(UTC)) >= self.expires_at  # type: ignore[operator]

    def to_json(self) -> dict[str, object]:
        payload = asdict(self)
        payload["captured_at"] = self.captured_at.isoformat()
        payload["expires_at"] = self.expires_at.isoformat()  # type: ignore[union-attr]
        payload["flags"] = list(self.flags)
        return payload

    @classmethod
    def from_json(cls, payload: dict[str, object]) -> FrameRecord:
        data = dict(payload)
        data["captured_at"] = datetime.fromisoformat(str(data["captured_at"]))
        data["expires_at"] = datetime.fromisoformat(str(data["expires_at"]))
        data["flags"] = tuple(data.get("flags", ()))  # type: ignore[arg-type]
        return cls(**data)  # type: ignore[arg-type]


@runtime_checkable
class FrameStore(Protocol):
    """Where frames live. Local on device and in tests, object storage in the cloud."""

    def put(self, payload: bytes, record: FrameRecord) -> str: ...
    def get(self, frame_id: str) -> bytes: ...
    def record(self, frame_id: str) -> FrameRecord: ...
    def list_records(self) -> list[FrameRecord]: ...


class LocalFrameStore:
    """Filesystem-backed store, sharded by id prefix.

    Sharding keeps directory sizes sane at a few hundred thousand frames, which a single pilot
    corridor reaches quickly. Records live beside blobs as JSON so a store is inspectable with
    ordinary tools and survives the loss of any database.
    """

    def __init__(self, root: Path | str) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def _paths(self, frame_id: str) -> tuple[Path, Path]:
        shard = self._root / frame_id[:2]
        return shard / f"{frame_id}.png", shard / f"{frame_id}.json"

    def put(self, payload: bytes, record: FrameRecord) -> str:
        expected = content_id(payload)
        if record.frame_id != expected:
            raise ValueError(
                f"frame_id {record.frame_id} does not match content hash {expected}; "
                "the blob and its record disagree"
            )
        blob_path, meta_path = self._paths(record.frame_id)
        blob_path.parent.mkdir(parents=True, exist_ok=True)
        if not blob_path.exists():
            blob_path.write_bytes(payload)
        meta_path.write_text(json.dumps(record.to_json(), indent=2) + "\n")
        return record.frame_id

    def get(self, frame_id: str) -> bytes:
        blob_path, _ = self._paths(frame_id)
        if not blob_path.exists():
            raise KeyError(f"no such frame: {frame_id}")
        return blob_path.read_bytes()

    def record(self, frame_id: str) -> FrameRecord:
        _, meta_path = self._paths(frame_id)
        if not meta_path.exists():
            raise KeyError(f"no record for frame: {frame_id}")
        return FrameRecord.from_json(json.loads(meta_path.read_text()))

    def list_records(self) -> list[FrameRecord]:
        return sorted(
            (FrameRecord.from_json(json.loads(p.read_text())) for p in self._root.glob("*/*.json")),
            key=lambda r: r.captured_at,
        )

    def purge_expired(self, now: datetime | None = None) -> int:
        """Delete frames past their retention. Returns how many blobs went.

        Records are kept: a fact's provenance has to outlive the pixels it came from, or the
        corroboration count becomes an unauditable number.
        """
        removed = 0
        for record in self.list_records():
            if record.is_expired(now):
                blob_path, _ = self._paths(record.frame_id)
                if blob_path.exists():
                    blob_path.unlink()
                    removed += 1
        return removed

    def total_bytes(self) -> int:
        return sum(p.stat().st_size for p in self._root.glob("*/*.png"))


def object_store_uri(base_url: str, frame_id: str) -> str:
    """Where a frame would live in GCS or S3. Mirrors the local layout deliberately."""
    if not base_url.startswith(("gs://", "s3://")):
        raise ValueError(f"expected a gs:// or s3:// URL, got {base_url!r}")
    return f"{base_url.rstrip('/')}/frames/{frame_id[:2]}/{frame_id}.png"
