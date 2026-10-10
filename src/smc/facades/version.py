"""One implementation fingerprint for facts, worker restarts and bulk approvals."""

from __future__ import annotations

import hashlib
from pathlib import Path

IMPLEMENTATION_FILES = (
    "scripts/match_frontage_facades.py",
    "src/smc/facades/fit.py",
    "src/smc/facades/window_shapes.py",
    "src/smc/facades/opening_reasoning.py",
    "src/smc/facades/appearance_bands.py",
    "src/smc/facades/detail_detection.py",
    "src/smc/facades/edge_support.py",
    "src/smc/facades/consensus.py",
    "src/smc/facades/frontage_retention.py",
    "src/smc/facades/outcrops.py",
    "src/smc/facades/architecture_logic.py",
    "src/smc/facades/version.py",
    "src/smc/facades/geometry.py",
    "src/smc/facades/survey.py",
    "scripts/build_sf_corridor_3d.py",
)


def implementation_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for name in IMPLEMENTATION_FILES:
        content = (root / name).read_bytes()
        digest.update(name.encode() + b"\0" + str(len(content)).encode() + b"\0" + content)
    return digest.hexdigest()
