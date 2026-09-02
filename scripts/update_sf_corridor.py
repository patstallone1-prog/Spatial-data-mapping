#!/usr/bin/env python3
"""Incrementally refresh the SF corridor catalog.

For v1 this delegates to the deterministic ingestion pass. Stable provider ids
mean repeated runs overwrite the same shards rather than creating duplicates.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    script = Path(__file__).with_name("ingest_sf_corridor.py")
    return subprocess.call([sys.executable, str(script), *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
