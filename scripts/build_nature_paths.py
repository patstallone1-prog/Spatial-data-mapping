"""Keep mapped paths/road clearances as a separate OSM-attributed visual layer.

No invented pole connections, paths or trail switchbacks. Unknown widths/materials
are explicitly inferred defaults. Bridge/tunnel ways are retained but not draped.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from smc.terrain.nature import write_manifest
from smc.terrain.perimeter import chain_rings

ROOT = Path(__file__).resolve().parents[1]
SERVERS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)


def extract_pbf(path: Path, box: dict) -> dict:
    import numpy as np
    import osmium

    landscape = json.loads((ROOT / "docs/nature/manifest.json").read_text())
    frame = landscape["frame"]
    cover = np.frombuffer(
        gzip.decompress((ROOT / "docs/nature/cover-40m.bin").read_bytes()), dtype=np.uint8
    ).reshape(frame["rows"], frame["cols"])

    def near_nature(nodes) -> bool:
        for n in nodes:
            if not n.location.valid():
                continue
            c = round(((n.lon - frame["mid_lon"]) * frame["metres_per_lon"] - frame["x0"]) / 40)
            r = round(((n.lat - frame["mid_lat"]) * frame["metres_per_lat"] - frame["y0"]) / 40)
            patch = cover[max(0, r - 1) : r + 2, max(0, c - 1) : c + 2]
            if np.isin(patch, [21, 41, 42, 43, 52, 71, 90]).any():
                return True
        return False

    class Ways(osmium.SimpleHandler):
        def __init__(self) -> None:
            super().__init__()
            self.found = {}

        def way(self, way) -> None:
            tags = dict(way.tags)
            building = "building" in tags and tags["building"] != "no"
            if not (
                "highway" in tags
                or building
                or tags.get("leisure") in {"pitch", "swimming_pool", "playground"}
                or tags.get("natural") in {"bare_rock", "scree", "shingle", "beach"}
            ):
                return
            if not any(
                n.location.valid()
                and box["west"] <= n.lon <= box["east"]
                and box["south"] <= n.lat <= box["north"]
                for n in way.nodes
            ):
                return
            if building and not near_nature(way.nodes):
                return
            points = [{"lon": n.lon, "lat": n.lat} for n in way.nodes if n.location.valid()]
            if len(points) >= 2:
                self.found[way.id] = {"id": way.id, "tags": tags, "geometry": points}

    with path.open("rb") as stream:
        source_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    cache_key = hashlib.sha256(
        json.dumps(
            [source_hash, box, landscape["arrays"]["cover"]["sha256"], "clearances-v2"]
        ).encode()
    ).hexdigest()[:16]
    cache = ROOT / "build/nature" / f"pbf-ways-{cache_key}.json"
    if cache.exists():
        return {int(k): v for k, v in json.loads(cache.read_text()).items()}
    handler = Ways()
    # Disk-backed proven node index, not a Python dict of an entire state's coordinates.
    with tempfile.TemporaryDirectory(prefix="osm-index-", dir=ROOT / "build/nature") as tmp:
        handler.apply_file(str(path), locations=True, idx=f"sparse_file_array,{tmp}/nodes.idx")
    cache.write_text(json.dumps(handler.found, separators=(",", ":")))
    return handler.found


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbf", type=Path)
    parser.add_argument(
        "--coast-cache",
        type=Path,
        help="Reuse the existing perimeter builder's Overpass cache read-only",
    )
    args = parser.parse_args()
    frame = json.loads((ROOT / "docs/sf-corridor-perimeter.json").read_text())["frame"]
    b = frame["bbox"]
    found = extract_pbf(args.pbf, b) if args.pbf else {}
    coast_sources = []
    if args.coast_cache:
        for path in sorted(args.coast_cache.glob("atlas-overpass-*.json")):
            data = json.loads(path.read_text())
            coast_sources.append(
                {
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "timestamp": data.get("osm3s", {}).get("timestamp_osm_base"),
                }
            )
            for item in data.get("elements", []):
                natural = item.get("tags", {}).get("natural")
                if item.get("type") == "way" and natural in {"coastline", "beach"}:
                    found[item["id"]] = item
                elif item.get("type") == "relation" and natural == "beach":
                    members = item.get("members", [])

                    def rings(role, pieces=tuple(members)):
                        chains = [
                            [[p["lon"], p["lat"]] for p in m.get("geometry", [])]
                            for m in pieces
                            if m.get("role", "outer") == role
                        ]
                        return chain_rings([p for p in chains if len(p) >= 2])

                    holes = rings("inner")
                    for index, ring in enumerate(rings("outer")):
                        identity = -item["id"] * 1000 - index
                        found[identity] = {
                            "id": identity,
                            "source_id": f"osm:relation/{item['id']}",
                            "tags": item["tags"],
                            "holes": holes,
                            "geometry": [{"lon": p[0], "lat": p[1]} for p in ring],
                        }
    for row in range(0 if args.pbf else 6):
        for col in range(6):
            path = ROOT / "build/nature" / f"osm-{col}-{row}.json"
            if path.exists():
                data = json.loads(path.read_text())
            else:
                west = b["west"] + (b["east"] - b["west"]) * col / 6
                east = b["west"] + (b["east"] - b["west"]) * (col + 1) / 6
                south = b["south"] + (b["north"] - b["south"]) * row / 6
                north = b["south"] + (b["north"] - b["south"]) * (row + 1) / 6
                box = f"{south},{west},{north},{east}"
                query = (
                    f"[out:json][timeout:120];(way[highway]({box});"
                    f'way[leisure~"^(pitch|swimming_pool|playground)$"]({box});'
                    f'way[natural~"^(bare_rock|scree|shingle|beach)$"]({box}););out tags geom;'
                )
                for attempt in range(6):
                    try:
                        request = urllib.request.Request(
                            SERVERS[attempt % len(SERVERS)],
                            data=urllib.parse.urlencode({"data": query}).encode(),
                            headers={"User-Agent": "KerbsideNatureAtlas/1.0"},
                        )
                        with urllib.request.urlopen(request, timeout=150) as response:
                            data = json.load(response)
                        if "remark" in data:
                            raise ValueError(data["remark"])
                        if "elements" not in data:
                            raise ValueError("No valid OSM response")
                        path.write_text(json.dumps(data))
                        break
                    except Exception:
                        if attempt == 5:
                            raise
                        time.sleep(5 * (attempt + 1))
            for item in data["elements"]:
                if len(item.get("geometry", [])) >= 2:
                    found[item["id"]] = item
            print(f"OSM {col},{row}: {len(found)} unique ways", flush=True)
    tiles = {}
    for item in found.values():
        tags = item.get("tags", {})
        points = [[p["lon"], p["lat"]] for p in item["geometry"]]
        h = tags.get("highway", "")
        trail = h in {"path", "footway", "cycleway", "bridleway", "steps", "pedestrian", "track"}
        try:
            width = float(tags.get("width", "").replace(" m", ""))
            measured_width = True
        except ValueError:
            width = 1.4 if h in {"path", "bridleway"} else 2.5 if trail else 7
            measured_width = False
        width = min(40, max(0.6, width))
        record = {
            "id": item.get("source_id", f"osm:way/{item['id']}"),
            "points": points,
            "kind": h
            or ("building" if "building" in tags else tags.get("leisure", tags.get("natural"))),
            "width_m": width,
            "width_source": "mapped" if measured_width else "inferred",
            "surface": tags.get("surface", "unknown"),
            "trail": trail,
            "grade_separated": tags.get("bridge", "no") != "no" or tags.get("tunnel", "no") != "no",
            "area": tags.get("area") == "yes"
            or bool(
                tags.get("leisure")
                or (tags.get("natural") and tags["natural"] != "coastline")
                or tags.get("building")
            ),
            "natural": tags.get("natural"),
            "source_tags": tags,
            "holes": item.get("holes", []),
        }
        # Long ways are indexed in every touched 4 km cell, not only at their centroid.
        xs = [(p[0] - frame["mid_lon"]) * frame["metres_per_lon"] - frame["x0"] for p in points]
        ys = [(p[1] - frame["mid_lat"]) * frame["metres_per_lat"] - frame["y0"] for p in points]
        for r in range(math.floor(min(ys) / 4000), math.floor(max(ys) / 4000) + 1):
            for c in range(math.floor(min(xs) / 4000), math.floor(max(xs) / 4000) + 1):
                tiles.setdefault(f"{c}-{r}", []).append(record)
    out = ROOT / "docs/nature/paths"
    out.mkdir(parents=True, exist_ok=True)
    assets = {}
    for key, ways in tiles.items():
        raw = json.dumps({"ways": ways}, separators=(",", ":")).encode()
        encoded = gzip.compress(raw, mtime=0)
        target = out / f"{key}.bin"
        temporary = target.with_suffix(".bin.part")
        temporary.write_bytes(encoded)
        temporary.replace(target)
        assets[key] = {
            "file": f"paths/{key}.bin",
            "sha256": hashlib.sha256(encoded).hexdigest(),
            "encoding": "gzip",
            "decoded_bytes": len(raw),
            "bytes": len(encoded),
        }
        # Only this builder's previous uncommitted generated format; no source data removed.
        (out / f"{key}.json").unlink(missing_ok=True)
    manifest = {
        "schema": 1,
        "frame": frame,
        "tile_m": 4000,
        "tiles": assets,
        "unique_ways": len(found),
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL-1.0",
        "source": "https://www.openstreetmap.org/copyright",
        "role": "Separate mapped visual/exclusion layer, not survey truth",
        "unknown_trail_surface": "inferred natural earth; paved only when tagged",
        "coastline_source_snapshots": coast_sources,
    }
    if args.pbf:
        manifest["extract"] = {
            "provider": "Geofabrik Northern California",
            "url": "https://download.geofabrik.de/north-america/us/california/norcal.html",
            "sha256": hashlib.file_digest(args.pbf.open("rb"), "sha256").hexdigest(),
        }
    write_manifest(out.parent / "paths.json", manifest)


if __name__ == "__main__":
    main()
