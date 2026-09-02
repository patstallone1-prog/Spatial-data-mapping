#!/usr/bin/env python3
"""Build a release-sharded storage manifest for a city mapping catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.storage.release_shards import build_storage_manifest, write_storage_manifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("data/sf_corridor"))
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--city-slug", default="sf")
    parser.add_argument("--city-name", default="San Francisco")
    parser.add_argument("--release-tag", default="sf-current")
    parser.add_argument("--release-repo", default="patstallone1-prog/Spatial-data-mapping")
    parser.add_argument("--capture-root", type=Path, default=Path("data/captures"))
    parser.add_argument("--h3-resolution", type=int, default=10)
    parser.add_argument("--target-asset-mb", type=int, default=500)
    parser.add_argument("--max-asset-mb", type=int, default=750)
    args = parser.parse_args()

    out = args.out or args.catalog / "storage" / "release_shards.json"
    manifest = build_storage_manifest(
        args.catalog,
        city_slug=args.city_slug,
        city_name=args.city_name,
        release_tag=args.release_tag,
        release_repo=args.release_repo,
        capture_root=args.capture_root,
        h3_resolution=args.h3_resolution,
        target_asset_bytes=args.target_asset_mb * 1024 * 1024,
        max_asset_bytes=args.max_asset_mb * 1024 * 1024,
    )
    write_storage_manifest(out, manifest)
    print(json.dumps({"wrote": str(out), "summary": manifest["summary"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
