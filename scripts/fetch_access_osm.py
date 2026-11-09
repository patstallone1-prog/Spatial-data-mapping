#!/usr/bin/env python3
"""What OpenStreetMap records about getting in and around: entrances, wheelchair access, steps,
kerbs -- for the page to show, and to test the inferred entrances against.

    python scripts/fetch_access_osm.py --region sf-corridor
    python scripts/fetch_access_osm.py --region sf-haight-castro

Businesses publish their accessibility (the ADA's step-free entrance, accessible toilets) on
their own sites and in the big listing services; the open copy of it is OpenStreetMap's
``wheelchair=*`` (and Wheelmap, which writes the same tag). Google's and Yelp's listings carry
the same attributes but their terms forbid storing them, so they are not read here.

Read from the OpenStreetMap API (``/api/0.6/map``) in small squares -- Overpass refuses this Mac
-- and kept:

* entrances: nodes with ``entrance=*`` -- position, kind (main, service, ...), ``wheelchair``,
  ``door``, ``automatic_door``, ``step_count``, ``ramp``, and the building way they sit on;
* places: anything named with ``wheelchair=*`` -- yes, limited, no -- and its description and
  ``toilets:wheelchair``;
* steps: ``highway=steps`` ways with ``step_count``, ``handrail``, ``ramp:wheelchair``,
  ``ramp:stroller``, ``incline``;
* kerbs: nodes with ``kerb=*`` (flush, lowered, raised) and ``tactile_paving``.

Writes docs/(app-)regions/<name>/sf-corridor-access.json (docs/sf-corridor-access.json for the
corridor). Data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "kerbside.access/1"
API = "https://api.openstreetmap.org/api/0.6/map"
TILE_DEG = 0.004
CORRIDOR_BBOX = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}
ENTRANCE_KEYS = ("entrance", "wheelchair", "door", "automatic_door", "step_count", "ramp", "access", "ref", "name",
                 "addr:housenumber", "addr:street", "level")
PLACE_KEYS = ("name", "wheelchair", "wheelchair:description", "toilets:wheelchair", "amenity", "shop", "tourism", "office")
STEP_KEYS = ("step_count", "handrail", "ramp", "ramp:wheelchair", "ramp:stroller", "ramp:bicycle", "incline", "wheelchair", "name")
KERB_KEYS = ("kerb", "tactile_paving", "wheelchair")


def bbox_of(region: str) -> dict:
    if region == "sf-corridor":
        return CORRIDOR_BBOX
    payload = ROOT / "docs" / "regions" / region / "sf-corridor-3d.json"
    return json.loads(payload.read_text())["bbox"]


def fetch(w: float, s: float, e: float, n: float) -> ET.Element:
    req = urllib.request.Request(f"{API}?bbox={w:.6f},{s:.6f},{e:.6f},{n:.6f}",
                                 headers={"User-Agent": "kerbside-access/1 (open-data map viewer)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return ET.fromstring(r.read())
        except Exception:
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("unreachable")


def pick(tags: dict, keys: tuple[str, ...]) -> dict:
    return {k: tags[k] for k in keys if k in tags}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--region", required=True)
    args = parser.parse_args()
    box = bbox_of(args.region)
    entrances: dict[str, dict] = {}
    places: dict[str, dict] = {}
    steps: dict[str, dict] = {}
    kerbs: dict[str, dict] = {}
    ny = math.ceil((box["north"] - box["south"]) / TILE_DEG)
    nx = math.ceil((box["east"] - box["west"]) / TILE_DEG)
    for j in range(ny):
        for i in range(nx):
            w, s = box["west"] + i * TILE_DEG, box["south"] + j * TILE_DEG
            e, n = min(box["east"], w + TILE_DEG), min(box["north"], s + TILE_DEG)
            root = fetch(w, s, e, n)
            nodes = {}
            for nd in root.iter("node"):
                p = [round(float(nd.get("lon")), 7), round(float(nd.get("lat")), 7)]
                nodes[nd.get("id")] = p
                tags = {t.get("k"): t.get("v") for t in nd.iter("tag")}
                if not tags:
                    continue
                nid = "n" + nd.get("id")
                if "entrance" in tags:
                    entrances[nid] = {"p": p, **pick(tags, ENTRANCE_KEYS)}
                if "wheelchair" in tags and "name" in tags and "entrance" not in tags:
                    places[nid] = {"p": p, **pick(tags, PLACE_KEYS)}
                if "kerb" in tags:
                    kerbs[nid] = {"p": p, **pick(tags, KERB_KEYS)}
            for way in root.iter("way"):
                tags = {t.get("k"): t.get("v") for t in way.iter("tag")}
                refs = [nd.get("ref") for nd in way.iter("nd")]
                pts = [nodes[r] for r in refs if r in nodes]
                wid = "w" + way.get("id")
                if tags.get("highway") == "steps" and len(pts) >= 2:
                    steps[wid] = {"points": pts, **pick(tags, STEP_KEYS)}
                if "wheelchair" in tags and "name" in tags and len(pts) >= 3:
                    cx = sum(p[0] for p in pts) / len(pts)
                    cy = sum(p[1] for p in pts) / len(pts)
                    places[wid] = {"p": [round(cx, 7), round(cy, 7)], **pick(tags, PLACE_KEYS)}
                if "building" in tags:
                    for r in refs:
                        if "n" + r in entrances:
                            entrances["n" + r]["building"] = int(way.get("id"))
            print(f"  {args.region}: square {j * nx + i + 1}/{nx * ny}: {len(entrances)} entrances, "
                  f"{len(places)} places, {len(steps)} steps, {len(kerbs)} kerbs", flush=True)
            time.sleep(1.0)
    out = {"schema": SCHEMA, "region": args.region, "bbox": box,
           "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "OpenStreetMap API /map (c) OpenStreetMap contributors, ODbL",
           "entrances": list(entrances.values()), "places": list(places.values()),
           "steps": list(steps.values()), "kerbs": list(kerbs.values())}
    text = json.dumps(out, separators=(",", ":")) + "\n"
    targets = [ROOT / "docs" / "sf-corridor-access.json"] if args.region == "sf-corridor" else [
        ROOT / "docs" / base / args.region / "sf-corridor-access.json" for base in ("regions", "app-regions")
        if (ROOT / "docs" / base / args.region).exists()]
    for target in targets:
        target.write_text(text)
        print(f"wrote {target.relative_to(ROOT)} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
