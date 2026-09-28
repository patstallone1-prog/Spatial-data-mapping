#!/usr/bin/env python3
"""Refresh explicit OSM kerb nodes in an existing, otherwise unchanged map payload.

The main OSM map API is a fallback when Overpass cannot answer.  It returns
current source nodes; this script appends normalized kerb facts after all
existing features, preserving detail-shard indices and measured city geometry.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request
from urllib.error import HTTPError
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.build_sf_corridor_3d import normalize_osm_kerb_node  # noqa: E402


def fetch_kerb_nodes(bbox: dict[str, float]) -> list[dict]:
    found = {}

    def query(box: dict[str, float], depth: int = 0) -> None:
        params = urllib.parse.urlencode({"bbox": ",".join(str(box[key]) for key in
                                         ("west", "south", "east", "north"))})
        request = urllib.request.Request(
            f"https://api.openstreetmap.org/api/0.6/map?{params}",
            headers={"User-Agent": "Kerbside/0.1 (OSM kerb-node provenance refresh)"})
        try:
            response = urllib.request.urlopen(request, timeout=150)
        except HTTPError as error:
            # The map API caps source-node count.  Split only an oversized
            # query, retaining every tile and deduplicating overlap by ID.
            if error.code != 400 or depth >= 4:
                raise
            axis = ("west", "east") if box["east"] - box["west"] >= box["north"] - box["south"] \
                else ("south", "north")
            mid = (box[axis[0]] + box[axis[1]]) / 2
            left, right = dict(box), dict(box)
            left[axis[1]] = mid
            right[axis[0]] = mid
            query(left, depth + 1)
            query(right, depth + 1)
            return
        with response:
            for _, element in ElementTree.iterparse(response, events=("end",)):
                if element.tag == "node":
                    tags = {tag.get("k"): tag.get("v") for tag in element.findall("tag")}
                    if "kerb" in tags:
                        lon = float(element.attrib["lon"])
                        lat = float(element.attrib["lat"])
                        # The map API also returns out-of-box nodes needed by
                        # ways that cross its boundary.  They are not facts
                        # about this region and must not enter its payload.
                        if not (bbox["west"] <= lon <= bbox["east"]
                                and bbox["south"] <= lat <= bbox["north"]):
                            element.clear()
                            continue
                        feature = normalize_osm_kerb_node({
                            "type": "node", "id": int(element.attrib["id"]),
                            "lon": lon, "lat": lat, "tags": tags})
                        if feature is not None:
                            found[feature["osm_id"]] = feature
                if element.tag in {"node", "way", "relation"}:
                    element.clear()

    query(bbox)
    return [found[key] for key in sorted(found)]


def refresh(page_path: Path, *, reuse_existing: bool = False) -> dict[str, int]:
    payload = json.loads(page_path.read_text())
    if not payload.get("bbox") or len(payload.get("ways") or []) < 100:
        raise ValueError(f"refusing to alter incomplete map: {page_path}")
    old = [way for way in payload["ways"] if way.get("kind") == "curb_ramp"]
    ramps = old if reuse_existing else fetch_kerb_nodes(payload["bbox"])
    box = payload["bbox"]
    ramps = [way for way in ramps if box["west"] <= way["point"][0] <= box["east"]
             and box["south"] <= way["point"][1] <= box["north"]]
    if not ramps:
        raise ValueError("OSM response carried zero explicit kerb nodes; keep existing map")
    payload["ways"] = [way for way in payload["ways"] if way.get("kind") != "curb_ramp"] + ramps
    page_path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    return {"removed_stale": len(old), "mapped_kerb_nodes": len(ramps),
            "accessible_lips": sum(way["accessible_lip"] for way in ramps)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reuse-existing", action="store_true",
                        help="validate/prune already imported nodes without another API request")
    parser.add_argument("payload", type=Path, nargs="+")
    args = parser.parse_args()
    for path in args.payload:
        print(path, refresh(path, reuse_existing=args.reuse_existing), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
