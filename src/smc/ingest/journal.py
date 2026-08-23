"""The on-device photo journal — a real implementation, not an interface.

SQLite for metadata, the filesystem for pixels. Both are on every phone, both survive a crash
mid-write, and neither needs a service running. The journal is the only copy of a capture until
the server acknowledges it, so durability matters more than speed.

Frames are keyed by content hash. A glasses re-transfer, an app restart mid-copy, or a retried
upload therefore cannot produce two rows for one photograph — which would otherwise inflate a
cell's count and push out a genuinely new view.

State is explicit and ordered: CAPTURED to KEPT or REJECTED, KEPT to COMPRESSED, COMPRESSED to
ACKNOWLEDGED. Nothing deletes pixels except :meth:`purge`, and the runner only purges rejects
and acknowledged frames.
"""

from __future__ import annotations

import enum
import json
import sqlite3
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path

from smc.ingest.store import content_id


class EntryState(enum.StrEnum):
    CAPTURED = "captured"
    KEPT = "kept"
    REJECTED = "rejected"
    COMPRESSED = "compressed"
    ACKNOWLEDGED = "acknowledged"


@dataclass(frozen=True, slots=True)
class JournalEntry:
    frame_id: str
    captured_at: datetime
    #: When this frame entered the journal.
    #:
    #: Distinct from ``captured_at`` on purpose. Retention answers "how long has this been
    #: sitting on the phone", which is a storage question, not "when was the photograph taken".
    #: Conflating them expires a correctly-journalled photo of an old scene the instant it
    #: arrives — which is exactly what happened to a camera-roll import, where every file's
    #: modification time was months in the past.
    journaled_at: datetime
    source: str
    width: int
    height: int
    source_bytes: int
    cell_id: str = ""
    lat: float | None = None
    lon: float | None = None
    position_sigma_m: float | None = None
    state: EntryState = EntryState.CAPTURED
    sharpness: float | None = None
    perceptual_hash: int | None = None
    verdict: str = ""
    reason: str = ""
    compressed_bytes: int | None = None
    attempts: int = 0
    flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def bytes_on_disk(self) -> int:
        return self.compressed_bytes if self.compressed_bytes is not None else self.source_bytes


_SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    frame_id          TEXT PRIMARY KEY,
    captured_at       TEXT NOT NULL,
    journaled_at      TEXT NOT NULL,
    source            TEXT NOT NULL,
    width             INTEGER NOT NULL,
    height            INTEGER NOT NULL,
    source_bytes      INTEGER NOT NULL,
    cell_id           TEXT NOT NULL DEFAULT '',
    lat               REAL,
    lon               REAL,
    position_sigma_m  REAL,
    state             TEXT NOT NULL,
    sharpness         REAL,
    perceptual_hash   INTEGER,
    verdict           TEXT NOT NULL DEFAULT '',
    reason            TEXT NOT NULL DEFAULT '',
    compressed_bytes  INTEGER,
    attempts          INTEGER NOT NULL DEFAULT 0,
    flags             TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS entries_state ON entries(state);
CREATE INDEX IF NOT EXISTS entries_captured ON entries(captured_at);
"""


class LocalPhotoJournal:
    """Filesystem plus SQLite. The phone's working set."""

    def __init__(self, root: Path | str) -> None:
        self._root = Path(root)
        self._blobs = self._root / "blobs"
        self._blobs.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self._root / "journal.sqlite")
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> LocalPhotoJournal:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def root(self) -> Path:
        return self._root

    def _blob_path(self, frame_id: str) -> Path:
        return self._blobs / frame_id[:2] / f"{frame_id}.bin"

    # --- writing -------------------------------------------------------------------------

    def add(self, payload: bytes, entry: JournalEntry) -> JournalEntry:
        """Store a frame. Idempotent: re-adding the same bytes replaces the row, not the blob."""
        expected = content_id(payload)
        if entry.frame_id != expected:
            raise ValueError(
                f"frame_id {entry.frame_id} does not match content hash {expected}"
            )
        path = self._blob_path(entry.frame_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        self._write_row(entry)
        return entry

    def update(self, entry: JournalEntry) -> JournalEntry:
        """Update metadata without touching pixels."""
        if not self._blob_path(entry.frame_id).exists():
            raise KeyError(f"no blob for {entry.frame_id}")
        self._write_row(entry)
        return entry

    def _write_row(self, entry: JournalEntry) -> None:
        self._db.execute(
            """
            INSERT INTO entries (frame_id, captured_at, journaled_at, source, width, height,
                                 source_bytes, cell_id, lat, lon, position_sigma_m, state,
                                 sharpness, perceptual_hash, verdict, reason, compressed_bytes,
                                 attempts, flags)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(frame_id) DO UPDATE SET
                state=excluded.state, sharpness=excluded.sharpness,
                perceptual_hash=excluded.perceptual_hash, verdict=excluded.verdict,
                reason=excluded.reason, compressed_bytes=excluded.compressed_bytes,
                attempts=excluded.attempts, flags=excluded.flags, cell_id=excluded.cell_id
            """,
            (
                entry.frame_id, entry.captured_at.isoformat(), entry.journaled_at.isoformat(),
                entry.source, entry.width,
                entry.height, entry.source_bytes, entry.cell_id, entry.lat, entry.lon,
                entry.position_sigma_m, str(entry.state), entry.sharpness,
                _to_signed(entry.perceptual_hash), entry.verdict, entry.reason,
                entry.compressed_bytes,
                entry.attempts, json.dumps(list(entry.flags)),
            ),
        )
        self._db.commit()

    def replace_payload(self, frame_id: str, payload: bytes) -> None:
        """Overwrite the pixels in place, keeping the identity.

        Used by compression. The frame id stays the *source* hash on purpose: it is the
        identity of the capture, and re-hashing after re-encoding would break idempotency
        exactly when a retried upload needs it most.
        """
        path = self._blob_path(frame_id)
        if not path.exists():
            raise KeyError(f"no blob for {frame_id}")
        path.write_bytes(payload)

    # --- reading -------------------------------------------------------------------------

    def read(self, frame_id: str) -> bytes:
        path = self._blob_path(frame_id)
        if not path.exists():
            raise KeyError(f"no blob for {frame_id}")
        return path.read_bytes()

    def get(self, frame_id: str) -> JournalEntry:
        row = self._db.execute(
            "SELECT * FROM entries WHERE frame_id = ?", (frame_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"no entry for {frame_id}")
        return _row_to_entry(row)

    def entries(self, state: EntryState | None = None) -> list[JournalEntry]:
        if state is None:
            rows = self._db.execute("SELECT * FROM entries ORDER BY captured_at").fetchall()
        else:
            rows = self._db.execute(
                "SELECT * FROM entries WHERE state = ? ORDER BY captured_at", (str(state),)
            ).fetchall()
        return [_row_to_entry(r) for r in rows]

    def count(self, state: EntryState | None = None) -> int:
        if state is None:
            return int(self._db.execute("SELECT COUNT(*) FROM entries").fetchone()[0])
        return int(
            self._db.execute(
                "SELECT COUNT(*) FROM entries WHERE state = ?", (str(state),)
            ).fetchone()[0]
        )

    def total_bytes(self) -> int:
        return sum(p.stat().st_size for p in self._blobs.rglob("*.bin"))

    def oldest_capture(self) -> datetime | None:
        row = self._db.execute("SELECT MIN(captured_at) FROM entries").fetchone()
        return datetime.fromisoformat(row[0]) if row and row[0] else None

    # --- deleting ------------------------------------------------------------------------

    def purge(self, frame_ids: list[str]) -> int:
        """Delete pixels and rows. The only method that removes data.

        Returns how many blobs actually went, which is not necessarily how many ids were
        passed — a blob may already be gone, and that is not an error worth failing a nightly
        batch over.
        """
        removed = 0
        for frame_id in frame_ids:
            path = self._blob_path(frame_id)
            if path.exists():
                path.unlink()
                removed += 1
            self._db.execute("DELETE FROM entries WHERE frame_id = ?", (frame_id,))
        self._db.commit()
        self._prune_empty_shards()
        return removed

    def _prune_empty_shards(self) -> None:
        for shard in self._blobs.iterdir():
            if shard.is_dir() and not any(shard.iterdir()):
                shard.rmdir()

    def verify(self) -> dict[str, int]:
        """Check that rows and blobs agree. Cheap, and worth running before a send."""
        rows = {e.frame_id for e in self.entries()}
        blobs = {p.stem for p in self._blobs.rglob("*.bin")}
        return {
            "rows": len(rows),
            "blobs": len(blobs),
            "rows_without_blobs": len(rows - blobs),
            "blobs_without_rows": len(blobs - rows),
        }


#: SQLite INTEGER is a *signed* 64-bit value, and a 64-bit perceptual hash is unsigned — any
#: hash with the top bit set overflows on insert. Store it wrapped into the signed range and
#: unwrap on read; the bits are identical either way, which is all the Hamming distance needs.
_SIGN_BIT = 1 << 63
_WRAP = 1 << 64


def _to_signed(value: int | None) -> int | None:
    if value is None:
        return None
    return value - _WRAP if value >= _SIGN_BIT else value


def _to_unsigned(value: int | None) -> int | None:
    if value is None:
        return None
    return value + _WRAP if value < 0 else value


def _row_to_entry(row: sqlite3.Row) -> JournalEntry:
    return JournalEntry(
        frame_id=row["frame_id"],
        captured_at=datetime.fromisoformat(row["captured_at"]),
        journaled_at=datetime.fromisoformat(row["journaled_at"]),
        source=row["source"],
        width=row["width"],
        height=row["height"],
        source_bytes=row["source_bytes"],
        cell_id=row["cell_id"],
        lat=row["lat"],
        lon=row["lon"],
        position_sigma_m=row["position_sigma_m"],
        state=EntryState(row["state"]),
        sharpness=row["sharpness"],
        perceptual_hash=_to_unsigned(row["perceptual_hash"]),
        verdict=row["verdict"],
        reason=row["reason"],
        compressed_bytes=row["compressed_bytes"],
        attempts=row["attempts"],
        flags=tuple(json.loads(row["flags"])),
    )


def new_entry(payload: bytes, width: int, height: int, *, source: str,
              captured_at: datetime | None = None, cell_id: str = "",
              lat: float | None = None, lon: float | None = None) -> JournalEntry:
    """Build an entry for a payload, with the content hash as its identity."""
    now = datetime.now(UTC)
    return JournalEntry(
        frame_id=content_id(payload),
        captured_at=captured_at or now,
        journaled_at=now,
        source=source,
        width=width,
        height=height,
        source_bytes=len(payload),
        cell_id=cell_id,
        lat=lat,
        lon=lon,
    )


def mark(entry: JournalEntry, state: EntryState, **updates: object) -> JournalEntry:
    return replace(entry, state=state, **updates)  # type: ignore[arg-type]
