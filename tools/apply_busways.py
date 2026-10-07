"""Mark the busways in the published payloads, the way the full build now does.

The full build (scripts/build_sf_corridor_3d.py) keeps a busway out of the city-street matching
and gives it its own lanes' width (``busway``, ``road_source: busway_lanes``). This applies the
same rule to payloads already built -- reading each way's highway tag from the region's
OpenStreetMap cache, since the payload does not carry it -- so a busway is fixed without the
city's full source set to hand.

    .venv/bin/python tools/apply_busways.py
"""
from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("builder", ROOT / "scripts/build_sf_corridor_3d.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

TARGETS = [
    (ROOT / "docs/sf-corridor-3d.json", ROOT / "data/sf_corridor/stats/osm_ways.json"),
    *[(payload, ROOT / "data/regions" / payload.parent.name / "osm_ways.json")
      for payload in sorted((ROOT / "docs/regions").glob("*/sf-corridor-3d.json"))],
    *[(payload, ROOT / "data/regions" / payload.parent.name / "osm_ways.json")
      for payload in sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-3d.json"))],
]


class Frame:
    def __init__(self, lat0: float) -> None:
        self.k = 111320.0 * math.cos(math.radians(lat0))

    def to_xy(self, lon: float, lat: float) -> tuple[float, float]:
        return lon * self.k, lat * 111320.0


def main() -> None:
    for payload_path, cache_path in TARGETS:
        if not payload_path.exists():
            continue
        busway_ids: set = set()
        if cache_path.exists():
            busway_ids = {w.get("osm_id") for w in json.loads(cache_path.read_text())
                          if w.get("highway") == "busway"}
        payload = json.loads(payload_path.read_text())
        ways = payload.get("ways") or []
        marked = 0
        for way in ways:
            busway = way.get("osm_id") in busway_ids or "Bus Rapid Transit" in (way.get("name") or "")
            if way.get("kind") != "street" or not busway:
                continue
            lanes = max(1, min(2, int(way.get("lanes") or 1)))
            way["busway"] = True
            way["road_m"] = round(builder.BUSWAY_LANE_M * lanes, 2)
            way["road_source"] = "busway_lanes"
            way["osm_walk_sides"] = []
            for key in ("xs", "xs_junction", "walk_m", "walk_fallback_m", "row_m", "cnn", "cnn_name"):
                way.pop(key, None)
            marked += 1
        if not marked:
            continue
        bbox = payload.get("bbox") or {}
        builder.busway_widths(ways, Frame((bbox.get("south", 37.78) + bbox.get("north", 37.8)) / 2))
        payload_path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
        print(f"{payload_path.relative_to(ROOT)}: {marked} busway pieces")


if __name__ == "__main__":
    main()
