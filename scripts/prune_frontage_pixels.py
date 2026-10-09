#!/usr/bin/env python3
"""Remove rejected pixels from explicitly named filter scratch outputs; keep audit metadata."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from smc.facades.frontage_retention import prune_rejected

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outputs", type=Path, nargs="+")
    args = parser.parse_args()
    print(json.dumps([prune_rejected(path) for path in args.outputs], indent=2))
