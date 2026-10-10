"""Verified copy/cutover of this run's scratch data, never the repo or source catalogues.

Stops on any checksum mismatch before deleting a local copy. Existing absolute
fact receipts and worker paths remain valid through symlinks. A migration journal
on the external drive preserves every source/destination SHA-256 and recovery path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.storage.external_volume import volume_ready  # noqa: E402

RUN_PATHS = (
    "appearance-preview", "facade-detail-audit", "facade-detail-model-cache",
    "facade-match", "frontage-accuracy-audit", "frontage-live", "frontage-live.log",
    "frontage-pilot", "frontage-pilot-v2", "frontage-reprojected", "material-library",
    "frontage-supervisor/filter.log", "frontage-supervisor/matcher.log",
)


def inventory(root: Path) -> dict:
    """Include empty directories and links without dereferencing outside the tree."""
    rows = {}
    paths = [root]
    if root.is_dir() and not root.is_symlink():
        for folder, dirs, files in os.walk(root, followlinks=False):
            paths.extend(Path(folder) / name for name in sorted(dirs + files))
    for i, path in enumerate(paths):
        key = str(path.relative_to(root))
        if path.is_symlink():
            rows[key] = {"kind": "symlink", "target": os.readlink(path)}
        elif path.is_dir():
            rows[key] = {"kind": "directory"}
        else:
            before = path.stat()
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(8 * 1024**2), b""):
                    digest.update(block)
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise RuntimeError("source changed during hashing; pause its writer first")
            rows[key] = {"kind": "file", "bytes": after.st_size, "sha256": digest.hexdigest()}
        if i and i % 1000 == 0:
            print(f"Verified {i} entries in {root.name}", flush=True)
    return rows


def save(path: Path, value: dict):
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w") as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def cutover(source: Path, destination: Path, expected: dict) -> Path:
    if inventory(source) != expected or inventory(destination) != expected:
        raise RuntimeError("SHA-256 inventory mismatch; all local files retained")
    backup = source.with_name(source.name + ".verified-backup-" + uuid.uuid4().hex)
    source.rename(backup)
    try:
        source.symlink_to(destination, target_is_directory=destination.is_dir())
        if source.resolve() != destination.resolve():
            raise RuntimeError("alias did not resolve to verified destination")
    except Exception:
        if source.is_symlink():
            source.unlink()
        backup.rename(source)
        raise
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--volume", type=Path, required=True)
    parser.add_argument("--volume-uuid", required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    if not volume_ready(args.volume, args.volume_uuid):
        parser.error("expected external volume is not mounted")
    destination = args.destination.resolve()
    if (not args.destination.is_absolute() or args.destination.is_symlink()
            or not destination.is_relative_to(args.volume)
            or len(destination.relative_to(args.volume).parts) < 2):
        parser.error("explicit run directory inside the mounted volume required")
    status = ROOT / "build/frontage-supervisor/status.json"
    if not status.is_file() or json.loads(status.read_text()).get("state") != "stopped":
        parser.error("stop this run's supervisor before migration")
    if destination.exists():
        parser.error("destination already exists; inspect the saved journal before retrying")
    destination.mkdir(parents=True, mode=0o700)
    manifest = {"schema": "kerbside.run_storage_migration/1", "volume_uuid": args.volume_uuid,
                "state": "copying", "source_root": str(ROOT / "build"), "paths": {}}
    backups = []
    for name in RUN_PATHS:
        source, target = ROOT / "build" / name, destination / name
        if not source.exists():
            continue
        if source.is_symlink():
            raise RuntimeError(f"pre-existing alias requires review: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not volume_ready(args.volume, args.volume_uuid):
            raise RuntimeError("drive disconnected; local copies retained")
        print(f"Copying {name}", flush=True)
        if source.is_dir():
            target.mkdir()
            command = ["/usr/bin/rsync", "-aH", str(source) + "/", str(target) + "/"]
        else:
            command = ["/usr/bin/rsync", "-aH", str(source), str(target)]
        subprocess.run(command, check=True)
        expected = inventory(source)
        if inventory(target) != expected:
            raise RuntimeError(f"checksum mismatch: {name}; local copies retained")
        manifest["paths"][name] = {"source": str(source), "destination": str(target), "inventory": expected}
        save(destination / "migration-manifest.json", manifest)
    manifest["state"] = "verified"
    save(destination / "migration-manifest.json", manifest)
    for row in manifest["paths"].values():
        if not volume_ready(args.volume, args.volume_uuid):
            raise RuntimeError("drive disconnected; local backups retained")
        backups.append(cutover(Path(row["source"]), Path(row["destination"]), row["inventory"]))
    manifest["state"] = "linked_local_backups_retained"
    manifest["local_backups"] = [str(path) for path in backups]
    save(destination / "migration-manifest.json", manifest)
    subprocess.run(["/bin/sync"], check=True)
    if not volume_ready(args.volume, args.volume_uuid):
        raise RuntimeError("drive disconnected before cleanup; local backups retained")
    # Exact backups created above only; never recurse into a repository/volume root.
    for backup in backups:
        if not volume_ready(args.volume, args.volume_uuid):
            raise RuntimeError("drive disconnected during cleanup; remaining local backups retained")
        if backup.is_symlink() or ".verified-backup-" not in backup.name or not backup.is_relative_to(ROOT / "build"):
            raise RuntimeError("unsafe backup cleanup target")
        if backup.is_dir():
            shutil.rmtree(backup)
        else:
            backup.unlink()
    manifest["state"] = "complete_local_copies_removed"
    manifest["verified_bytes"] = sum(row.get("bytes", 0) for p in manifest["paths"].values() for row in p["inventory"].values())
    save(destination / "migration-manifest.json", manifest)
    save(status.parent / "storage.json", {"volume": str(args.volume), "volume_uuid": args.volume_uuid,
                                         "destination": str(destination), "manifest": str(destination / "migration-manifest.json")})
    print(json.dumps({"state": manifest["state"], "verified_bytes": manifest["verified_bytes"], "destination": str(destination)}), flush=True)


if __name__ == "__main__":
    main()
