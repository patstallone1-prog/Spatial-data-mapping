"""Archive new capture photos into a Git-friendly dataset folder.

The default stores downscaled JPEGs at glasses-like resolution plus a manifest.
That keeps enough pixels for repeatable mapping/CV audits without pushing huge
phone originals into the repository. Use ``--raw`` only for small, intentional
fixture sets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc.ingest.photos import discover_photos, load_photo  # noqa: E402


def archived_hashes(destination: Path) -> set[str]:
    hashes: set[str] = set()
    for manifest in destination.glob("*/manifest.json"):
        try:
            payload = json.loads(manifest.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for record in payload.get("records", []):
            if value := record.get("sha256"):
                hashes.add(str(value))
    return hashes


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def archive(
    source: Path,
    destination: Path,
    *,
    max_width: int,
    quality: int,
    include_raw: bool,
    include_unlabeled: bool,
    require_gps: bool,
) -> dict[str, object]:
    batch = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    out = destination / batch
    image_dir = out / "images"
    raw_dir = out / "raw"
    image_dir.mkdir(parents=True, exist_ok=True)
    if include_raw:
        raw_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, object]] = []
    skipped: list[dict[str, str]] = []
    seen: set[str] = set()
    already_archived = archived_hashes(destination)
    for path in discover_photos(source):
        if path.stat().st_size == 0:
            skipped.append({"file": path.name, "reason": "empty"})
            continue
        file_hash = digest(path)
        if file_hash in already_archived:
            skipped.append({"file": path.name, "reason": "already_archived"})
            continue
        if file_hash in seen:
            skipped.append({"file": path.name, "reason": "duplicate_in_batch"})
            continue
        seen.add(file_hash)
        try:
            image, meta = load_photo(path, max_width=max_width)
        except Exception as exc:
            skipped.append({"file": path.name, "reason": type(exc).__name__})
            continue
        is_capture_like = bool(
            meta.camera or meta.captured_at or meta.lat is not None or meta.lon is not None
        )
        if not include_unlabeled and not is_capture_like:
            skipped.append({"file": path.name, "reason": "missing_capture_metadata"})
            continue
        if require_gps and (meta.lat is None or meta.lon is None):
            skipped.append({"file": path.name, "reason": "missing_gps"})
            continue

        stem = f"{file_hash[:16]}_{path.stem}"
        archived_image = image_dir / f"{stem}.jpg"
        Image.fromarray(image).save(archived_image, "JPEG", quality=quality, optimize=True)
        raw_rel = None
        if include_raw:
            raw_target = raw_dir / f"{stem}{path.suffix.lower()}"
            shutil.copy2(path, raw_target)
            raw_rel = str(raw_target.relative_to(out))
        records.append(
            {
                "source_name": path.name,
                "source_path": str(path),
                "sha256": file_hash,
                "archived_image": str(archived_image.relative_to(out)),
                "raw": raw_rel,
                "bytes_original": path.stat().st_size,
                "bytes_archived": archived_image.stat().st_size,
                "width": meta.width,
                "height": meta.height,
                "camera": meta.camera,
                "focal_35mm": meta.focal_35mm,
                "lat": meta.lat,
                "lon": meta.lon,
                "captured_at": meta.captured_at.isoformat() if meta.captured_at else None,
            }
        )

    manifest = {
        "created_at": datetime.now(UTC).isoformat(),
        "source": str(source),
        "mode": "raw_and_jpeg" if include_raw else "jpeg_derived",
        "max_width": max_width,
        "quality": quality,
        "count": len(records),
        "skipped": skipped,
        "records": records,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return {"batch": str(out), "count": len(records), "skipped": len(skipped)}


def main() -> int:
    parser = argparse.ArgumentParser(prog="archive_capture_photos")
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "--destination",
        type=Path,
        default=Path("data/captures"),
        help="tracked archive root",
    )
    parser.add_argument("--max-width", type=int, default=1440)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--raw", action="store_true", help="also copy original files")
    parser.add_argument(
        "--include-unlabeled",
        action="store_true",
        help="include images with no camera, GPS, or capture-time metadata",
    )
    parser.add_argument(
        "--require-gps",
        action="store_true",
        help="skip photos that do not carry latitude and longitude",
    )
    args = parser.parse_args()

    result = archive(
        args.source,
        args.destination,
        max_width=args.max_width,
        quality=args.quality,
        include_raw=args.raw,
        include_unlabeled=args.include_unlabeled,
        require_gps=args.require_gps,
    )
    print(
        f"archived {result['count']} photos to {result['batch']} "
        f"({result['skipped']} skipped)"
    )
    return 0 if result["count"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
