"""Ingesting photographs from a folder into the journal.

The stand-in for the glasses feed, so the whole nightly loop can be exercised on real
photographs before the Meta channel opens. It is also how the curation thresholds get tuned on
real images rather than on rendered ones.

On macOS the Photos library at ``~/Pictures/Photos Library.photoslibrary`` is protected by TCC
and cannot be read without Full Disk Access granted to the calling program. That is a system
setting a person has to change deliberately, and it should stay that way — this module reads
ordinary folders and reports clearly when a protected path is refused, rather than trying to
work around the protection.

Nothing here uploads anything. Ingest, assessment and compression are entirely local; the only
thing that leaves is whatever the configured destination receives at 02:00.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from smc.ingest.journal import LocalPhotoJournal, new_entry
from smc.ingest.photos import discover_photos, load_photo

#: Common macOS photo locations, in the order worth trying.
CANDIDATE_ROOTS = (
    Path.home() / "Pictures",
    Path.home() / "Downloads",
    Path.home() / "Desktop",
)

PHOTOS_LIBRARY = Path.home() / "Pictures" / "Photos Library.photoslibrary"


@dataclass(frozen=True, slots=True)
class IngestReport:
    scanned: int = 0
    added: int = 0
    duplicates: int = 0
    unreadable: int = 0
    bytes_added: int = 0
    refused_paths: tuple[str, ...] = ()

    def describe(self) -> str:
        lines = [
            f"scanned {self.scanned}, added {self.added}, "
            f"duplicates {self.duplicates}, unreadable {self.unreadable}",
            f"{self.bytes_added / 1e6:.1f} MB into the journal",
        ]
        if self.refused_paths:
            lines.append("permission denied (needs Full Disk Access):")
            lines.extend(f"  {p}" for p in self.refused_paths)
        return "\n".join(lines)


def photos_library_readable() -> bool:
    try:
        next(iter(PHOTOS_LIBRARY.iterdir()), None)
    except (PermissionError, OSError):
        return False
    return True


def scan(directory: Path, *, recursive: bool = True, limit: int | None = None) -> list[Path]:
    """Find photographs, skipping paths the OS refuses."""
    if not directory.exists():
        return []
    try:
        if recursive:
            found = sorted(
                p for p in directory.rglob("*")
                if p.is_file() and p.suffix.lower() in _SUFFIXES
            )
        else:
            found = discover_photos(directory)
    except (PermissionError, OSError):
        return []
    return found[:limit] if limit else found


_SUFFIXES = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff", ".webp", ".bmp"}


def ingest(
    journal: LocalPhotoJournal,
    paths: list[Path],
    *,
    source: str = "camera_roll",
    cell_of: object = None,
    max_edge_px: int | None = None,
) -> IngestReport:
    """Load photographs and journal them, re-encoding to a common form.

    Photographs are stored as decoded-then-re-encoded PNG rather than the original file. Two
    reasons: EXIF orientation must be baked into the pixels before anything measures them, and
    the frame id is a hash of what the pipeline will actually read, so identity and content
    cannot drift apart.
    """
    import io

    from PIL import Image

    scanned = added = duplicates = unreadable = 0
    bytes_added = 0
    refused: list[str] = []

    for path in paths:
        scanned += 1
        try:
            image, meta = load_photo(path, max_width=max_edge_px)
        except PermissionError:
            refused.append(str(path))
            continue
        except Exception:
            unreadable += 1
            continue

        buffer = io.BytesIO()
        Image.fromarray(image).save(buffer, "PNG", optimize=False)
        payload = buffer.getvalue()

        cell = _cell_for(path, cell_of)
        captured = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        entry = new_entry(
            payload, meta.width, meta.height,
            source=source, captured_at=captured, cell_id=cell,
        )
        try:
            journal.get(entry.frame_id)
            duplicates += 1
            continue
        except KeyError:
            pass

        journal.add(payload, entry)
        added += 1
        bytes_added += len(payload)

    return IngestReport(
        scanned=scanned, added=added, duplicates=duplicates, unreadable=unreadable,
        bytes_added=bytes_added, refused_paths=tuple(refused),
    )


def _cell_for(path: Path, cell_of: object) -> str:
    """Assign a coverage cell.

    Real captures get an H3 cell from GPS. Camera-roll photographs usually have no usable
    position, so the parent folder stands in — enough to exercise the per-cell quota logic,
    which is what this ingest path is for.
    """
    if callable(cell_of):
        return str(cell_of(path))
    return path.parent.name or "unsorted"


def default_sources(limit_per_root: int | None = None) -> tuple[list[Path], list[str]]:
    """Photographs from the usual places, plus any roots the OS refused."""
    found: list[Path] = []
    refused: list[str] = []
    if not photos_library_readable():
        refused.append(str(PHOTOS_LIBRARY))
    for root in CANDIDATE_ROOTS:
        found.extend(scan(root, limit=limit_per_root))
    return found, refused
