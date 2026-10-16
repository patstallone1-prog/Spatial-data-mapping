#!/usr/bin/env python3
"""Fetch Berkeley ramp/crosswalk evidence; normalize ramps into the existing viewer contract.

Crosswalk paths/width strings remain reference evidence until their units, marking
domains and endpoint correspondence are validated. Never replace default curb geometry.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import get_region  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.official.berkeley import fetch_layer, merge_sidecar  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--region", default="berkeley-downtown", choices=["berkeley-downtown"])
    ap.add_argument("--out-dir", type=Path)
    ap.add_argument(
        "--publish", action="store_true", help="stage only the validated official sidecar in docs"
    )
    args = ap.parse_args()
    region = get_region(args.region)
    box = region.bbox
    bbox = [box.south, box.west, box.north, box.east]
    out = args.out_dir or ROOT / "data" / "regions" / region.name
    use_certifi()
    inventories = {kind: fetch_layer(kind, bbox) for kind in ("curb_ramps", "crosswalks")}
    path = out / "site" / "sf-corridor-official.json"
    previous = json.loads(path.read_text()) if path.exists() else {}
    # Validate everything before writing any outputs.
    payload = merge_sidecar(previous, inventories["curb_ramps"])
    (out / "official").mkdir(parents=True, exist_ok=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    for kind, inventory in inventories.items():
        (out / "official" / f"berkeley_{kind}.json").write_text(
            json.dumps(inventory, indent=1) + "\n"
        )
    path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    if args.publish:
        target = ROOT / "docs" / "regions" / region.name / path.name
        old = json.loads(target.read_text()) if target.exists() else {}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(merge_sidecar(old, inventories["curb_ramps"]), separators=(",", ":")) + "\n"
        )
    print(
        json.dumps(
            {
                "inventory": {kind: len(value["features"]) for kind, value in inventories.items()},
                "renderable_ramps": len(payload["curb_ramps"]),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
