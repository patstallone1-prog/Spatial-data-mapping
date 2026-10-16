#!/usr/bin/env python3
"""Explicit, user-authorized raw-pixel purge; never remove facts or application assets.

Run once without --apply, inspect the immutable plan, then pass that plan to --apply.
Workers MUST be stopped first. New imagery may subsequently be downloaded by them.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.storage.external_volume import volume_ready  # noqa: E402

PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic"}
PROTECTED = {"model-cache", "facade-detail-model-cache", "material-library",
             "dependency-cache", "reference-dependencies", "private-datasets"}


def raw_target(relative: Path) -> bool:
    parts = relative.parts
    if any(p in PROTECTED for p in parts):
        return False
    if "pixel-store" in parts:
        return "pixels" in parts and relative.suffix == ".zlib"
    # Only run-generated crops/masks/audit photographs, never arbitrary volume images.
    return (relative.suffix.lower() in PHOTO_SUFFIXES
            and parts[0].startswith(("frontage-", "facade-", "appearance-")))


def inventory(root: Path) -> list[dict]:
    entries = []
    for folder, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d not in PROTECTED and not (Path(folder) / d).is_symlink()]
        for name in files:
            path = Path(folder) / name
            relative = path.relative_to(root)
            if path.is_symlink() or not raw_target(relative):
                continue
            stat = path.stat()
            entries.append({"path": str(relative), "bytes": stat.st_size,
                            "mtime_ns": stat.st_mtime_ns})
    return sorted(entries, key=lambda r: r["path"])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, required=True)
    ap.add_argument("--volume", type=Path, required=True)
    ap.add_argument("--volume-uuid", required=True)
    ap.add_argument("--plan", type=Path, required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    root = args.root.resolve()
    if not volume_ready(args.volume, args.volume_uuid) or root.parent != args.volume / "Kerbside":
        raise ValueError("verified external Kerbside run root required")
    if not root.name.startswith("frontage-run-") or args.plan.resolve().is_relative_to(root):
        raise ValueError("explicit run root and separate local plan required")
    if not args.apply:
        entries = inventory(root)
        plan = {"root": str(root), "volume_uuid": args.volume_uuid, "entries": entries,
                "files": len(entries), "bytes": sum(r["bytes"] for r in entries),
                "by_suffix": dict(Counter(Path(r["path"]).suffix for r in entries)),
                "preserved": ["facts", "provenance", "licenses", "flight/sequence manifests",
                              "models", "materials", "mixed reference dataset archives"]}
        args.plan.parent.mkdir(parents=True, exist_ok=True)
        with args.plan.open("x") as sink:
            json.dump(plan, sink, indent=1)
            sink.flush()
            os.fsync(sink.fileno())
        print(json.dumps({k: v for k, v in plan.items() if k != "entries"}))
        return
    plan = json.loads(args.plan.read_text())
    if plan["root"] != str(root) or plan["volume_uuid"] != args.volume_uuid:
        raise ValueError("plan/volume mismatch")
    # Check the complete set before deleting anything. A worker write invalidates the plan.
    for row in plan["entries"]:
        path = root / row["path"]
        if not raw_target(Path(row["path"])) or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("unsafe deletion target")
        stat = path.stat()
        if (stat.st_size, stat.st_mtime_ns) != (row["bytes"], row["mtime_ns"]):
            raise ValueError("raw target changed since planning; stop workers and replan")
    receipt = args.plan.with_suffix(".deleted.jsonl")
    with receipt.open("x") as sink:
        for row in plan["entries"]:
            (root / row["path"]).unlink()
            sink.write(json.dumps(row) + "\n")
        sink.flush()
        os.fsync(sink.fileno())
    # Preserve original screening decisions; explicitly record why evidence is unavailable.
    for path in root.glob("*/review/*.json"):
        if path.name == "index.json":
            continue
        row = json.loads(path.read_text())
        if isinstance(row, dict) and row.get("building_id"):
            row["local_pixels_deleted"] = True
            row["retention_basis"] = "explicit_user_raw_purge"
            row["raw_purge_plan"] = str(args.plan)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(row, indent=2) + "\n")
            temporary.replace(path)
    print(json.dumps({"deleted_files": plan["files"], "deleted_bytes": plan["bytes"],
                      "receipt": str(receipt), "facts_and_provenance_retained": True}))


if __name__ == "__main__":
    main()
