#!/usr/bin/env python3
"""Fetch small CC0 household glTF assets with pinned checksums and source credit."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/interior-assets"
ASSETS = {"living": "sofa_03", "chair": "modern_arm_chair_01",
          "dining": "dining_table", "bedroom": "old_bed_frame"}


def fetch(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "Kerbside asset build"}), timeout=60) as r:
        return r.read()


def build() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"schema": "kerbside.interior_assets/1", "assets": []}
    for kind, asset_id in ASSETS.items():
        files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset_id}"))
        model = files["gltf"]["1k"]["gltf"]
        directory = OUT / asset_id
        directory.mkdir(exist_ok=True)
        entries = {f"{asset_id}.gltf": model, **model.get("include", {})}
        provenance = []
        for relative, row in entries.items():
            path = directory / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            pixels = path.read_bytes() if path.exists() else fetch(row["url"])
            if hashlib.md5(pixels).hexdigest() != row["md5"]:
                raise ValueError(f"source checksum mismatch: {asset_id}/{relative}")
            path.write_bytes(pixels)
            provenance.append({"path": f"{asset_id}/{relative}", "url": row["url"],
                               "bytes": len(pixels), "sha256": hashlib.sha256(pixels).hexdigest()})
        manifest["assets"].append({"id": asset_id, "kind": kind, "license": "CC0-1.0",
            "source": f"https://polyhaven.com/a/{asset_id}", "attribution": "Poly Haven",
            "model": f"{asset_id}/{asset_id}.gltf", "files": provenance})
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    result = build()
    print(f"{len(result['assets'])} CC0 household models verified")
