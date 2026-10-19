"""Write the app's crosswalks from SFMTA's inventory where OpenStreetMap maps none.

    .venv/bin/python tools/build_inventory_crossings.py

Reads the corridor payload (docs/sf-corridor-3d.json) and the city's inventory
(data/sf_public_works/crosswalks.json); writes docs/app-inventory-crossings.json, which the
app's page adds to the payload's crossings (smc.render.inventory_crossings says how they are
placed). The website's payload is not touched.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.render.inventory_crossings import inventory_crossings  # noqa: E402


def main() -> int:
    payload = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    inventory = json.loads((ROOT / "data/sf_public_works/crosswalks.json").read_text())
    crossings = inventory_crossings(payload["ways"], inventory, payload.get("bbox"))
    junctions = {c["crossing_style_group"] for c in crossings}
    out = {"schema": "kerbside.inventory_crossings/1", "source": "SFMTA continental crosswalk inventory",
           "certainty": "junction and widths measured; band position on each leg is the city standard",
           "junctions": len(junctions), "crossings": crossings}
    (ROOT / "docs/app-inventory-crossings.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{len(crossings)} crossings at {len(junctions)} junctions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
