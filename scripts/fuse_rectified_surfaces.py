#!/usr/bin/env python3
"""Build intermediate, provenance-bearing atlases from reviewed rectified views."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.reconstruction.rectified import fuse_rectified_manifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    output = fuse_rectified_manifest(
        args.manifest, ROOT / "data/reconstruction/source_rights.json", args.out,
        ROOT / "data/reconstruction/pilot_benchmark.json",
    )
    print(f"intermediate evidence: {output} (not publishable without full promotion)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
