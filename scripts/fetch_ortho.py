#!/usr/bin/env python3
"""Fetch a region's aerial photographs, the sharpest public source for each 250 m square
(src/smc/imagery/ortho.py). ``--region all`` does every published region."""

from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc.imagery import ortho
from smc.regions.paths import region_paths

PUBLISHED = ("sf-corridor", "sf-mission", "sf-soma", "sf-haight-castro", "sf-richmond", "sf-sunset",
             "oakland-downtown", "berkeley-downtown", "palo-alto-downtown", "san-jose-downtown")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--region", nargs="+", default=["sf-corridor"])
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--workers", type=int, default=ortho.WORKERS)
    args = ap.parse_args()
    names = PUBLISHED if args.region == ["all"] else args.region
    for name in names:
        manifest = ortho.fetch_region(name, region_paths(name).bbox(), workers=args.workers, refresh=args.refresh)
        by = collections.Counter(r["source"] for r in manifest["squares"])
        print(name, dict(by), "missing", len(manifest["missing"]), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
