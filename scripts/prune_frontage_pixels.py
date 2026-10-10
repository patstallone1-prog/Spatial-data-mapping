#!/usr/bin/env python3
"""Remove rejected pixels from explicitly named filter scratch outputs; keep audit metadata."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from smc.facades.frontage_retention import prune_finalized, prune_rejected

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outputs", type=Path, nargs="+")
    parser.add_argument(
        "--finalized-receipts",
        type=Path,
        help="image-bound reviewed saved-fact receipts; never confidence scores alone",
    )
    args = parser.parse_args()
    if args.finalized_receipts:
        receipts = json.loads(args.finalized_receipts.read_text())
        print(json.dumps([prune_finalized(path, receipts) for path in args.outputs], indent=2))
    else:
        print(json.dumps([prune_rejected(path) for path in args.outputs], indent=2))
