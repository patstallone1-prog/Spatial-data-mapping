"""Keep the lidar's median and island kerb lines out of the junctions (smc.regions.kerb_lines).

    PYTHONPATH=src python tools/clip_lidar_kerb_lines.py [--official docs/sf-corridor-official.json]

Cuts each lidar median or island line where it runs into a cross street's carriageway and its
crosswalk, and drops the lidar island edges the city's survey already has; then cuts the file
into its window cells again. scripts/measure_medians_lidar.py does the same when it writes them.
"""

from __future__ import annotations

import argparse
import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.regions.kerb_lines import clip_lidar_kerb_lines  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--official", type=Path, default=ROOT / "docs" / "sf-corridor-official.json")
    parser.add_argument("--osm", type=Path, default=ROOT / "docs" / "sf-corridor-3d.json")
    args = parser.parse_args()
    official = json.loads(args.official.read_text(encoding="utf-8"))
    ways = json.loads(args.osm.read_text(encoding="utf-8"))["ways"]
    lines, stats = clip_lidar_kerb_lines(official.get("curb_lines", []), ways)
    official["curb_lines"] = lines
    official.setdefault("summary", {})["lidar_kerb_clip"] = stats
    args.official.write_text(json.dumps(official, separators=(",", ":")), encoding="utf-8")
    cut = runpy.run_path(str(ROOT / "tools" / "build_window_cells.py"))["cut"]
    print(stats, cut(args.official))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
