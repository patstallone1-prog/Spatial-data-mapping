"""Reuse immutable broad selections only across an audited compatible implementation."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

# SHA of the five filter inputs deployed at 31762e09. The new selector differs
# only by refusing restricted providers, none of which were in those catalogues.
# Scheduling/pixel readers cannot confer pose approval or alter these candidates.
COMPATIBLE_LEGACY = {"1ec2dff35c84375139906c99760fe08440f7b692af25817442d7bbc379a6df4b"}
AUDITED_REUSE_SELECTOR_SHA256 = "effdb8b60cb1d6efa58d4a5c9ea1e75ded5439432578ea47dcc3ae1847f4cf32"
SUPPORTED = {"mapillary", "kartaview", "panoramax", "pandaset"}


def compatible_selection(root: Path, stamp: dict, implementation: str) -> dict | None:
    for path in sorted(root.glob("*/run.json")):
        old = json.loads(path.read_text())
        old_hash = old.get("implementation_sha256")
        same_selector = (bool(stamp.get("selection_sha256"))
                         and old.get("selection_sha256") == stamp["selection_sha256"])
        legacy_compatible = (old_hash in COMPATIBLE_LEGACY
                             and stamp.get("selection_sha256") == AUDITED_REUSE_SELECTOR_SHA256)
        if not (same_selector or legacy_compatible):
            continue
        if {k: v for k, v in old.items() if k not in {"implementation_sha256", "selection_sha256"}} != {
            k: v for k, v in stamp.items() if k not in {"implementation_sha256", "selection_sha256"}
        }:
            continue
        summary_path, database = path.parent / "summary.json", path.parent / "selection.sqlite"
        if not summary_path.is_file() or not database.is_file():
            continue
        summary = json.loads(summary_path.read_text())
        if summary.get("status") != "indexed" or not set(summary.get("source_frames", {})) <= SUPPORTED:
            continue
        if not summary.get("source_frames"):
            continue
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as conn:
            if conn.execute("SELECT count(*) FROM buildings").fetchone()[0] != summary["buildings"]:
                continue
        digest = hashlib.sha256()
        with database.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        return {
            **summary, "folder": str(path.parent),
            "selection_reuse": {
                "original_implementation_sha256": old_hash,
                "current_worker_implementation_sha256": implementation,
                "selection_database_sha256": digest.hexdigest(),
                "original_run_manifest_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "basis": "identical_world_catalogues_terrain_poses_date_policy; audited_selector",
                "pose_or_privacy_approval_granted": False,
            },
        }
    return None
