"""Delete rejected scratch pixels, never source catalogues or shared retained evidence."""

from __future__ import annotations

import json
import re
from pathlib import Path

from smc.reconstruction.pixel_store import blob_key


def prune_rejected(root: Path) -> dict:
    root = root.resolve()
    review = root / "review"
    store = root / "pixel-store"
    if not review.is_dir() or not store.is_dir() or root == root.parent:
        raise ValueError("expected an explicit frontage scratch output with review and pixel-store")
    reports = []
    for path in sorted(review.glob("*.json")):
        row = json.loads(path.read_text())
        if isinstance(row, dict) and row.get("building_id"):
            reports.append((path, row))
    protected = {
        row.get("pixel_sha256") for _, row in reports if row.get("status") != "pixel_rejected"
    }
    deleted, bytes_removed = [], 0
    for path, row in reports:
        if row.get("status") != "pixel_rejected":
            continue
        digest = row.get("pixel_sha256", "")
        targets = [path.with_suffix(suffix) for suffix in (".jpg", ".context.jpg", ".labels.png")]
        if re.fullmatch(r"[a-f0-9]{64}", digest) and digest not in protected:
            targets.append(store / blob_key(digest))
        for target in targets:
            # Symlinks are not followed; no report-controlled pathname is trusted.
            if target.is_symlink():
                raise ValueError("unexpected symlink in scratch retention target")
            if target.is_file():
                if not target.resolve().is_relative_to(root):
                    raise ValueError("scratch retention escaped output")
                bytes_removed += target.stat().st_size
                target.unlink()
                deleted.append(str(target.relative_to(root)))
        row["local_pixels_deleted"] = True
        row["pixel_blob_retained_for_other_candidate"] = digest in protected
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(row, default=str, indent=2))
        temporary.replace(path)
    return {
        "root": str(root),
        "files_removed": len(deleted),
        "bytes_removed": bytes_removed,
        "removed": deleted,
        "source_catalogues_untouched": True,
    }
