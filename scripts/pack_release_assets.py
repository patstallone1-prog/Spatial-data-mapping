#!/usr/bin/env python3
"""Pack storage-manifest release assets for upload to GitHub Releases."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.storage.release_pack import pack_release_assets  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("data/sf_corridor/storage/release_shards.json"))
    parser.add_argument("--capture-root", type=Path, default=Path("data/captures"))
    parser.add_argument("--out-dir", type=Path, default=Path("build/release_assets/sf-current"))
    args = parser.parse_args()

    packed = pack_release_assets(
        args.manifest,
        capture_root=args.capture_root,
        out_dir=args.out_dir,
    )
    print(json.dumps({"out_dir": str(args.out_dir), "assets": packed}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
