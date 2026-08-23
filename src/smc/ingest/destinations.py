"""Where the nightly batch goes.

Every destination must **confirm receipt**, not merely accept the bytes. The journal is the only
copy of a capture until the far end says it has it, so `send` returning True is what authorises
deletion — and a write that silently truncated on a full disk, or an upload that a proxy
swallowed, must not look like success.

Confirmation is therefore a read-back or a server-reported size, never the absence of an
exception.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from smc.ingest.journal import JournalEntry


@runtime_checkable
class Destination(Protocol):
    name: str

    def send(self, entry: JournalEntry, payload: bytes) -> bool: ...


class DirectoryDestination:
    """Write to a folder — a synced drive, an external disk, a mount point.

    Confirmed by re-reading the file's size after writing.
    """

    name = "directory"

    def __init__(self, root: Path | str, *, suffix: str = "avif") -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._suffix = suffix

    @property
    def root(self) -> Path:
        return self._root

    def object_path(self, entry: JournalEntry) -> Path:
        night = entry.captured_at.date().isoformat()
        return self._root / night / f"{entry.frame_id}.{self._suffix}"

    def send(self, entry: JournalEntry, payload: bytes) -> bool:
        target = self.object_path(entry)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        return target.exists() and target.stat().st_size == len(payload)


@dataclass(frozen=True, slots=True)
class GcsConfig:
    bucket: str
    prefix: str = "frames"
    project: str | None = None
    #: Storage class for the batch. Nearline is cheaper and this data is written once and read
    #: by the fusion pipeline within days, then expired.
    storage_class: str | None = None
    #: Lifecycle hint recorded on each object, so a bucket rule can expire raw imagery after
    #: fusion without needing a separate index of what is safe to delete.
    retention_days: int = 30

    @classmethod
    def from_url(cls, url: str, *, project: str | None = None) -> GcsConfig:
        """Parse ``gs://bucket/optional/prefix``."""
        if not url.startswith("gs://"):
            raise ValueError(f"expected a gs:// URL, got {url!r}")
        remainder = url[len("gs://") :].strip("/")
        if not remainder:
            raise ValueError("gs:// URL has no bucket")
        bucket, _, prefix = remainder.partition("/")
        return cls(bucket=bucket, prefix=prefix or "frames", project=project)


class GcsDestination:
    """Google Cloud Storage.

    Authentication is Application Default Credentials — ``gcloud auth application-default
    login`` for a person, or ``GOOGLE_APPLICATION_CREDENTIALS`` pointing at a service-account
    key for an unattended job. No credential is read or stored by this class.

    Two upload properties matter for a phone on a flaky link:

    * **Idempotent.** The object name is the frame's content hash, so a retried upload
      overwrites itself rather than creating a duplicate observation — and a duplicate would
      inflate the corroboration count, which is the number the confidence model rests on.
    * **Confirmed by the server's own size.** ``blob.reload()`` after upload returns what GCS
      believes it stored. Only if that matches the payload length is the local copy deletable.
    """

    name = "gcs"

    def __init__(self, config: GcsConfig, *, suffix: str = "avif") -> None:
        self._config = config
        self._suffix = suffix
        self._client = None
        self._bucket = None

    @property
    def config(self) -> GcsConfig:
        return self._config

    def _ensure_client(self) -> None:
        if self._bucket is not None:
            return
        try:
            from google.cloud import storage
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "GCS uploads need google-cloud-storage; install the 'gcs' extra"
            ) from exc
        self._client = storage.Client(project=self._config.project)
        self._bucket = self._client.bucket(self._config.bucket)

    def object_name(self, entry: JournalEntry) -> str:
        night = entry.captured_at.date().isoformat()
        return f"{self._config.prefix}/{night}/{entry.frame_id}.{self._suffix}"

    def send(self, entry: JournalEntry, payload: bytes) -> bool:
        self._ensure_client()
        assert self._bucket is not None
        blob = self._bucket.blob(self.object_name(entry))
        if self._config.storage_class:
            blob.storage_class = self._config.storage_class
        blob.metadata = {
            "captured_at": entry.captured_at.isoformat(),
            "cell_id": entry.cell_id,
            "source": entry.source,
            "retention_days": str(self._config.retention_days),
        }
        content_type = {"avif": "image/avif", "heic": "image/heic", "jpeg": "image/jpeg"}.get(
            self._suffix, "application/octet-stream"
        )
        blob.upload_from_string(payload, content_type=content_type)

        # Confirm from the server's view, not from the absence of an exception.
        blob.reload()
        return blob.size == len(payload)

    def check_access(self) -> tuple[bool, str]:
        """Verify credentials and bucket before a batch depends on them.

        Worth running at setup rather than discovering at 02:00 that nothing can be sent.
        """
        try:
            self._ensure_client()
            assert self._bucket is not None
            self._bucket.reload()
        except Exception as exc:
            return False, f"{type(exc).__name__}: {exc}"
        return True, f"gs://{self._config.bucket}/{self._config.prefix} reachable"


def build_destination(
    target: str, *, suffix: str = "avif", project: str | None = None
) -> Destination:
    """Build a destination from a URL or a path.

    ``gs://bucket/prefix`` gives GCS; anything else is treated as a local directory.
    """
    if target.startswith("gs://"):
        return GcsDestination(
            GcsConfig.from_url(target, project=project or os.environ.get("GOOGLE_CLOUD_PROJECT")),
            suffix=suffix,
        )
    if target.startswith("s3://"):
        raise NotImplementedError(
            "S3 is not implemented; use gs:// or a local path, or add an S3 destination "
            "following the GcsDestination pattern"
        )
    return DirectoryDestination(target, suffix=suffix)
