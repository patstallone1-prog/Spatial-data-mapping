"""Refresh explicit pedestrian material tags without refetching/replacing city geometry."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
from datetime import UTC, datetime
from pathlib import Path

from smc.official.datasf import _get

ROOT = Path(__file__).resolve().parents[1]
MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)


def extract(document: dict) -> dict:
    out = {}
    for element in document.get("elements", []):
        if element.get("type") != "way":
            continue
        tags = element.get("tags") or {}
        if tags.get("highway") not in {"path", "footway", "steps", "pedestrian"}:
            continue
        out[str(element["id"])] = {
            "tags": tags,
            "timestamp": element.get("timestamp"),
            "geometry": element.get("geometry", []),
            "source_url": f"https://www.openstreetmap.org/way/{element['id']}",
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    payload = ROOT / (
        "docs/sf-corridor-3d.json"
        if args.region == "sf-corridor"
        else f"docs/regions/{args.region}/sf-corridor-3d.json"
    )
    box = json.loads(payload.read_text())["bbox"]
    cache = ROOT / "data/park_paths" / args.region
    cache.mkdir(parents=True, exist_ok=True)
    raw_file = cache / "osm-response.json"
    bounds = f"({box['south']},{box['west']},{box['north']},{box['east']})"
    query = (
        "[out:json][timeout:50];("
        f'way["highway"~"^(footway|path|steps|pedestrian)$"]{bounds};'
        f'way["natural"~"^(beach|wood)$"]{bounds};way["landuse"="forest"]{bounds};'
        f'way["waterway"="riverbank"]["intermittent"="yes"]{bounds};'
        # The landscape a path runs through (weak context only), and what a playground holds.
        f'way["waterway"~"^(stream|river|ditch|drain)$"]{bounds};'
        f'way["natural"~"^(sand|wetland|scrub|heath|water)$"]{bounds};'
        f'way["leisure"~"^(playground|dog_park)$"]{bounds};'
        f'node["playground"]{bounds};way["playground"]{bounds};'
        f'node["barrier"~"^(gate|entrance|kissing_gate)$"]{bounds};'
        f'node["leisure"="picnic_table"]{bounds};'
        ');out meta geom;'
    )
    endpoint = None
    if args.refresh or not raw_file.exists():
        failures = []
        for endpoint in MIRRORS:
            try:
                response = _get(endpoint + "?" + urllib.parse.urlencode({"data": query}))
                doc = json.loads(response)
                if "elements" not in doc or doc.get("remark"):
                    raise ValueError("incomplete Overpass response")
                raw_file.write_bytes(response)
                break
            except Exception as error:
                failures.append(f"{endpoint}: {error}")
        else:
            raise RuntimeError("path material refresh failed: " + "; ".join(failures))
    raw = raw_file.read_bytes()
    out = {
        "schema": "kerbside.osm_path_evidence/1",
        "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        "bbox": box,
        "retrieved_at": datetime.now(UTC).isoformat(),
        "endpoint": endpoint,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "ways": extract(json.loads(raw)),
        "contexts": [
            e
            for e in json.loads(raw).get("elements", [])
            if e.get("type") == "way" and not e.get("tags", {}).get("highway")
            and not e.get("tags", {}).get("playground")
        ],
        # Playground equipment and gates: point evidence placed where it was mapped.
        "features": [
            {"id": f"osm:{e['type']}:{e['id']}", "tags": e.get("tags", {}),
             "p": [e["lon"], e["lat"]] if e["type"] == "node"
             else [[g["lon"], g["lat"]] for g in e.get("geometry", [])]}
            for e in json.loads(raw).get("elements", [])
            if e.get("tags", {}).get("playground") or e.get("tags", {}).get("barrier")
            or e.get("tags", {}).get("leisure") == "picnic_table"
        ],
    }
    (cache / "surfaces.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(
        f"{args.region}: {len(out['ways'])} pedestrian ways; "
        f"{sum(bool(w['tags'].get('surface')) for w in out['ways'].values())} explicit surfaces"
    )


if __name__ == "__main__":
    main()
