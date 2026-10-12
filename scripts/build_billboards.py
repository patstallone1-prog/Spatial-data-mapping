#!/usr/bin/env python3
"""Upgrade only advertising records; preserve every unrelated furniture feature."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.billboards import enrich_advertisement, safe_website  # noqa: E402
from smc.net import use_certifi  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-osm-tags", action="store_true")
    args = parser.parse_args()
    use_certifi()
    manifest = json.loads((ROOT / "data/billboard-creatives.json").read_text())
    if manifest.get("schema") != "kerbside.billboard_creatives/1" or not isinstance(
        manifest.get("boards"), dict
    ):
        raise ValueError("invalid creative registry")
    # Validate before changing any served sidecars. The same path whitelist is
    # used by the viewer, so a successfully registered image cannot silently fail there.
    for identity, creative in manifest["boards"].items():
        if (
            not creative.get("approved")
            or not creative.get("license")
            or not safe_website(creative.get("href"))
            or not re.fullmatch(
                r"billboards/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|svg)", creative.get("image", ""), re.I
            )
        ):
            raise ValueError(f"unapproved image/license or unsafe asset/destination: {identity}")
        image = (ROOT / "docs" / creative["image"]).resolve()
        if not image.is_relative_to((ROOT / "docs/billboards").resolve()) or not image.is_file():
            raise ValueError("billboard image is missing or outside its registered asset directory")
        creative["sha256"] = hashlib.sha256(image.read_bytes()).hexdigest()
    files = [
        ROOT / "docs/sf-corridor-furniture.json",
        *sorted((ROOT / "docs/regions").glob("*/sf-corridor-furniture.json")),
        *sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-furniture.json")),
    ]
    documents = {p: json.loads(p.read_text()) for p in files if p.is_file()}
    tags = {}
    if args.refresh_osm_tags:
        for kind in ("node", "way"):
            ids = sorted(
                {
                    r["id"].split(":")[-1]
                    for d in documents.values()
                    for r in d.get("inferred", {}).get("ad_panels", [])
                    if r["id"].startswith(f"osm:ad_panel:{kind}:")
                }
            )
            if not ids:
                continue
            url = f"https://api.openstreetmap.org/api/0.6/{kind}s?{kind}s={','.join(ids)}"
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read(4 * 1024**2 + 1)
            if len(data) > 4 * 1024**2:
                raise ValueError("unexpectedly large OSM advertising response")
            for element in ET.fromstring(data).findall(kind):
                tags[f"osm:ad_panel:{kind}:{element.attrib['id']}"] = {
                    t.attrib["k"]: t.attrib["v"] for t in element.findall("tag")
                }
    count = 0
    for path, document in documents.items():
        records = document.get("inferred", {}).get("ad_panels", [])
        if not records:
            continue
        document["inferred"]["ad_panels"] = [
            enrich_advertisement(r, tags.get(r["id"])) for r in records
        ]
        count += sum(r.get("ad_kind") == "billboard" for r in records)
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        # The app reads these windowed cells rather than the full sidecar.
        import runpy

        if (path.parent / "cells/sf-corridor-furniture/manifest.json").exists():
            runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"](path)
    (ROOT / "docs/billboard-creatives.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        json.dumps(
            {
                "furniture_files": len(documents),
                "billboard_records": count,
                "fresh_source_tag_records": len(tags),
                "registered_creatives": len(manifest["boards"]),
            }
        )
    )


if __name__ == "__main__":
    main()
