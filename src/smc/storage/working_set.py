"""Internal-disk working state, verified atomic external checkpoints, no live USB SQLite.

An acknowledged file is durable before local pixels are eligible for cleanup.
An incomplete external .partial file is never a checkpoint. Loss of the verified
volume is ordinary backpressure: retain the local working set and stop new batches.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path

from smc.storage.external_volume import volume_ready


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def durable(stream):
    stream.flush()
    os.fsync(stream.fileno())
    # macOS: ask the device to flush its write cache as well as the kernel cache.
    import fcntl
    if hasattr(fcntl, "F_FULLFSYNC"):
        fcntl.fcntl(stream.fileno(), fcntl.F_FULLFSYNC)


class WorkingSet:
    def __init__(self, local: Path, archive: Path, volume: Path, uuid: str, *, ready=None):
        self.local, self.archive = local.resolve(), archive.resolve()
        if self.local.is_symlink() or self.local.is_relative_to(Path("/Volumes")):
            raise ValueError("working set must be a real internal directory")
        if self.local == self.archive or self.local.is_relative_to(self.archive) or self.archive.is_relative_to(self.local):
            raise ValueError("working and archival roots must be separate")
        self.volume, self.uuid = volume, uuid
        self._verified_device = None
        self._verified_at = 0.0
        self._ready = ready or self._verified_mount
        self.local.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.acknowledged: dict[str, str] = {}
        self.seeded: set[str] = set()
        ledger = self.local / ".imported-metadata.json"
        if ledger.exists():
            imported = json.loads(ledger.read_text())
            self.seeded.update(imported)
            self.acknowledged.update(imported)

    def ready(self):
        return bool(self._ready())

    def _verified_mount(self):
        if not self.volume.is_mount():
            self._verified_device = None
            return False
        try:
            device = self.volume.stat().st_dev
            if device != self._verified_device or time.monotonic()-self._verified_at > 5:
                if not volume_ready(self.volume, self.uuid):
                    self._verified_device = None
                    return False
                self._verified_device, self._verified_at = device, time.monotonic()
            return True
        except OSError:
            return False

    def can_begin(self):
        try:
            return self.ready() and self.capacity() and shutil.disk_usage(self.archive).free >= 4*1024**3
        except OSError:
            return False

    def capacity(self):
        return shutil.disk_usage(self.local).free >= 4 * 1024**3

    def seed_metadata(self):
        """Copy small selection/review metadata, never historical images or databases."""
        if not self.ready():
            return
        for source in self.archive.rglob("*.json"):
            relative = source.relative_to(self.archive)
            if any(p in {"pixel-store", "storefront-audit", "checkpoints"} for p in relative.parts):
                continue
            target = self.local / relative
            key = str(relative)
            if target.exists():
                local_hash = sha(target)
                if key not in self.seeded:
                    # A restart during the first seed may precede the ledger.
                    # Only exact equality proves this was an imported copy.
                    if local_hash == sha(source):
                        self.seeded.add(key)
                        self.acknowledged[key] = local_hash
                    continue
                if local_hash != self.acknowledged.get(key):
                    continue  # Pending local work wins over an older archive.
                if sha(source) == self.acknowledged.get(key):
                    continue
            json.loads(source.read_text())  # Torn external metadata is not adopted.
            target.parent.mkdir(parents=True, exist_ok=True)
            self._copy(source, target)
            self.acknowledged[str(relative)] = sha(target)
            self.seeded.add(str(relative))
        ledger = self.local / ".imported-metadata.json"
        temporary = ledger.with_suffix(".partial")
        with temporary.open("w") as stream:
            json.dump({key:self.acknowledged[key] for key in self.seeded}, stream)
            durable(stream)
        temporary.replace(ledger)

    @staticmethod
    def _copy(source: Path, target: Path, guard=lambda: True):
        if not guard():
            raise OSError("archive unavailable")
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=target.name + ".", suffix=".partial", dir=target.parent)
        temp = Path(name)
        try:
            with os.fdopen(fd, "wb") as out, source.open("rb") as incoming:
                shutil.copyfileobj(incoming, out, 1024 * 1024)
                durable(out)
            expected = sha(source)
            if sha(temp) != expected or not guard():
                raise OSError("checkpoint verification interrupted")
            os.replace(temp, target)
            directory = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            if not guard() or sha(target) != expected:
                raise OSError("checkpoint acknowledgement unavailable")
        finally:
            with contextlib.suppress(OSError):
                temp.unlink(missing_ok=True)

    def stage_database(self, archive_folder: Path) -> Path:
        """SQLite backup API captures committed rows; never copies a live WAL file."""
        relative = archive_folder.relative_to(self.archive)
        target = self.local / relative / "selection.sqlite"
        if target.exists():
            return target.parent
        source = archive_folder / "selection.sqlite"
        if not source.exists() or not self.ready():
            return target.parent
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".staging")
        with contextlib.closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as incoming, contextlib.closing(sqlite3.connect(temporary)) as out:
            incoming.backup(out)
            out.execute("PRAGMA journal_mode=DELETE")
            if out.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("archive selection failed integrity; not adopting it")
        with temporary.open("rb") as stream:
            durable(stream)
        temporary.replace(target)
        return target.parent

    def checkpoint_database(self, source: Path) -> bool:
        # Database stays local throughout processing. A consistent snapshot is the
        # only SQLite file ever handed to the external-drive writer.
        if not self.ready():
            return False
        snapshot = source.with_suffix(".snapshot")
        try:
            with contextlib.closing(sqlite3.connect(source)) as incoming, contextlib.closing(sqlite3.connect(snapshot)) as out:
                incoming.backup(out)
                out.execute("PRAGMA journal_mode=DELETE")
                if out.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise ValueError("local selection integrity failure")
            target = self.archive / source.relative_to(self.local)
            wal = Path(str(target) + "-wal")
            if wal.exists() and wal.stat().st_size:
                raise OSError("archival SQLite still has a live WAL; preserve local checkpoint")
            self._copy(snapshot, target, self.ready)
            return True
        except OSError:
            return False
        finally:
            snapshot.unlink(missing_ok=True)

    def copy_file(self, source: Path) -> bool:
        try:
            self._copy(source, self.archive / source.relative_to(self.local), self.ready)
            self.acknowledged[str(source.relative_to(self.local))] = sha(source)
            return True
        except OSError:
            return False

    def prune_stale_databases(self, keep: set[Path]):
        """Retain only the selected working runs; archival snapshots remain recoverable."""
        removed = 0
        for source in self.local.rglob("selection.sqlite"):
            if source.parent in keep or source.is_symlink() or not source.resolve().is_relative_to(self.local):
                continue
            if self.checkpoint_database(source):
                source.unlink()
                removed += 1
        return removed

    def checkpoint(self, batch: str, *, clean_pixels=False) -> bool:
        """Pixels first, their reports last, then a content-hashed commit marker."""
        if not self.ready():
            return False
        files = [p for p in self.local.rglob("*") if p.is_file() and not p.is_symlink()
                 and not any(part.startswith(".") for part in p.relative_to(self.local).parts)
                 and p.suffix not in {".sqlite", ".staging", ".snapshot", ".partial", ".tmp", ".image"}
                 and p.name != "contrib-assigned.json"
                 and not p.name.endswith(("-wal", "-shm"))]
        files.sort(key=lambda p: (p.suffix == ".json", str(p)))
        receipts, pixels = {}, []
        try:
            for source in files:
                relative = source.relative_to(self.local)
                key, digest = str(relative), sha(source)
                target = self.archive / relative
                if key in self.seeded and self.acknowledged.get(key) == digest:
                    continue  # Imported metadata is not this worker's writable output.
                if self.acknowledged.get(key) != digest or not target.exists() or sha(target) != digest:
                    self._copy(source, target, self.ready)
                    self.acknowledged[key] = digest
                receipts[key] = digest
                if relative.parts[0] == "pixel-store" or source.suffix in {".jpg", ".png", ".image"}:
                    pixels.append((source, digest))
            marker = self.local / ".checkpoint.json"
            marker.write_text(json.dumps({"batch": batch, "files": receipts, "complete": True}, sort_keys=True))
            self._copy(marker, self.archive / "checkpoints" / (hashlib.sha256(batch.encode()).hexdigest()[:20] + ".json"), self.ready)
            if clean_pixels:
                for path, digest in pixels:
                    # Only this private internal working set, after a durable batch ack.
                    if not path.is_symlink() and path.is_relative_to(self.local) and sha(path) == digest:
                        path.unlink()
            return True
        except OSError:
            return False  # Current batch remains locally recoverable, never "empty/measured".
