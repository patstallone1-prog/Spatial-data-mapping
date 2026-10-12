#!/usr/bin/env python3
"""Every region's flights of public steps, for the walker to climb tread by tread.

The payload keeps a footpath's points and name but not its highway tag, so the walker could not
tell the Filbert Steps from a path across a plaza: it went up both alike. OpenStreetMap's
``highway=steps`` ways in each region's area are matched by id to the payload's own paths, and
written beside it as ``sf-corridor-stairs.json`` -- each flight's points (the payload's, so the
treads lie on the drawn path), and ``step_count`` and ``incline`` where the map has them. The
payload itself is left alone: other files are bound to it by its hash.

    .venv/bin/python scripts/ingest_steps.py [--refresh]
"""

from __future__ import annotations

import argparse
import json
import runpy
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.net import use_certifi  # noqa: E402

KERB = runpy.run_path(str(ROOT / "scripts/ingest_kerb_assets.py"))
CACHE = ROOT / "build" / "kerb_assets"
MIRRORS = (*KERB["OVERPASS"], "https://overpass.private.coffee/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter")
SCHEMA = "kerbside.public_stairs/1"


def steps_in(bbox: dict, refresh: bool, name: str) -> dict[int, dict]:
    path = CACHE / f"osm-steps-{name}.json"
    if path.exists() and not refresh:
        data = json.loads(path.read_text())
    else:
        b = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
        query = f'[out:json][timeout:120];way["highway"="steps"]({b});out ids tags;'
        last = None
        # The public mirrors are busy and fail now and then: each is tried a few times, patiently.
        for attempt, mirror in enumerate(MIRRORS * 3):
            try:
                data = json.loads(KERB["fetch"](mirror, urllib.parse.urlencode({"data": query}).encode(), timeout=240))
                break
            except (OSError, ValueError) as error:
                last = error
                time.sleep(10 * (attempt % len(MIRRORS) + 1))
        else:
            raise RuntimeError(f"no Overpass mirror answered for {name}: {last}")
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
    out = {}
    for element in data.get("elements", []):
        tags = element.get("tags") or {}
        record = {}
        if str(tags.get("step_count", "")).isdigit():
            record["step_count"] = int(tags["step_count"])
        if tags.get("incline") in ("up", "down"):
            record["incline"] = tags["incline"]
        out[int(element["id"])] = record
    return out


def flights(ways: list[dict], steps: dict[int, dict]) -> list[dict]:
    out = []
    for way in ways:
        if way.get("kind") != "path" or len(way.get("points") or []) < 2:
            continue
        try:
            osm_id = int(way.get("osm_id"))
        except (TypeError, ValueError):
            continue
        if osm_id in steps:
            out.append({"osm_id": osm_id, "points": way["points"], **steps[osm_id]})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    use_certifi()
    files = [ROOT / "docs/sf-corridor-3d.json", *sorted((ROOT / "docs/regions").glob("*/sf-corridor-3d.json"))]
    # An app world whose page reads its own folder (an empty kerbside-assets) gets its own file.
    for page in sorted((ROOT / "docs/app-regions").glob("*/app-model.html")):
        if 'name="kerbside-assets" content=""' in page.read_text() and (page.parent / "sf-corridor-3d.json").exists():
            files.append(page.parent / "sf-corridor-3d.json")
    report = {}
    for path in files:
        document = json.loads(path.read_text())
        bbox = document.get("bbox")
        if not bbox or not document.get("ways"):
            continue
        region = path.parent.name if path.parent.name != "docs" else "sf-corridor"
        label = f"app:{region}" if path.parent.parent.name == "app-regions" else region
        try:
            steps = steps_in(bbox, args.refresh, region)
        except RuntimeError as error:
            report[label] = f"skipped: {error}"
            continue
        found = flights(document["ways"], steps)
        (path.parent / "sf-corridor-stairs.json").write_text(json.dumps({
            "schema": SCHEMA, "region": region, "bbox": bbox, "stairs": found,
            "source": "OpenStreetMap highway=steps (© OpenStreetMap contributors, ODbL)",
            "basis": "the payload's own path points, matched by OpenStreetMap id"}, separators=(",", ":")) + "\n")
        report[label] = len(found)
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
