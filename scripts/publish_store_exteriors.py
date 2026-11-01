#!/usr/bin/env python3
"""Put the researched storefront exteriors on the live map, for every world that has stores.

For every world named (default: every world a page reads -- the San Francisco corridor and each
region's own copy), the exteriors are inferred for every eligible building, as the review
builder does (scripts/build_store_exteriors.py), and the passing plans -- slimmed to what the
viewer reads -- are written beside the world as ``storefront-exteriors.json``. Then, at the site's
root, as the frontage fits are published (tools/tile_frontage_fits.py):

    storefront-exteriors.manifest.json   each world's plans by its area, with their hashes
    storefront-renderer.mjs              smc/exteriors/renderer.mjs
    storefront-assets/                   the chains' marks it draws

The manifest is what turns them on in the viewer. The worlds are read, never rewritten: names,
fits and photo audits are bound to their exact bytes. Run again after a world is rebuilt.

    .venv/bin/python scripts/publish_store_exteriors.py
    .venv/bin/python scripts/publish_store_exteriors.py docs/regions/sf-mission/sf-corridor-3d.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
from importlib.resources import files
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.exteriors.bundle import build_bundle, runtime_manifest  # noqa: E402

LIMIT = 5000
DOCS = ROOT / "docs"
MANIFEST = DOCS / "storefront-exteriors.manifest.json"
PLANS = "storefront-exteriors.json"


def default_worlds() -> list[Path]:
    """Every world a page reads (tools/build_search_index.py payload_for): the corridor, each app
    region's own expanded copy, and a website region's data only where the app has no copy --
    plans bind to the exact shell they were inferred from, and the copies differ. A cloud cell's
    world is in the bucket (docs/asset-map.json), and is read from there when not on disk."""
    worlds = [DOCS / "sf-corridor-3d.json"]
    app = sorted(DOCS.glob("app-regions/*/sf-corridor-3d.json"))
    worlds += app
    have = {p.parent.name for p in app}
    regions = {p.parent.name for p in DOCS.glob("regions/*/sf-corridor-3d.json")}
    stored = {k.split("/")[1] for k in cloud_files() if k.startswith("regions/") and k.endswith("/sf-corridor-3d.json")}
    worlds += [DOCS / "regions" / name / "sf-corridor-3d.json" for name in sorted((regions | stored) - have)]
    return worlds


def cloud_files() -> dict:
    path = DOCS / "asset-map.json"
    return json.loads(path.read_text()).get("files", {}) if path.exists() else {}


def world_bytes(world_path: Path) -> bytes | None:
    """The world as the page reads it: from this checkout, or the cell's object in the bucket."""
    if world_path.is_file():
        return world_path.read_bytes()
    amap = json.loads((DOCS / "asset-map.json").read_text())
    obj = amap.get("files", {}).get(str(world_path.relative_to(DOCS)))
    if not obj or not amap.get("origin"):
        return None
    with urllib.request.urlopen(f"{amap['origin'].rstrip('/')}/{obj}", timeout=120) as response:
        return response.read()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def publish(world_path: Path, raw: bytes) -> dict | None:
    world = json.loads(raw)
    with tempfile.TemporaryDirectory() as tmp:
        manifest = build_bundle(Path(tmp), world=world, limit=LIMIT)
    slim = runtime_manifest(manifest)
    plans = world_path.parent / PLANS
    if not slim["buildings"]:
        plans.unlink(missing_ok=True)
        return None
    plans.parent.mkdir(parents=True, exist_ok=True)  # a cloud cell's folder holds only its plans
    plans.write_text(json.dumps(slim, separators=(",", ":")) + "\n")
    b = world["bbox"]
    return {"world": str(world_path.relative_to(DOCS)), "path": str(plans.relative_to(DOCS)),
            "bbox": [b["west"], b["south"], b["east"], b["north"]], "buildings": len(slim["buildings"]),
            "rejected": slim["rejected"], "bytes": plans.stat().st_size, "sha256": sha256(plans),
            "source_sha256": hashlib.sha256(raw).hexdigest()}


def write_manifest(tiles: dict) -> None:
    tiles = {k: t for k, t in tiles.items() if (DOCS / t["path"]).exists()}
    package = files("smc.exteriors")
    shutil.copyfile(str(package.joinpath("renderer.mjs")), DOCS / "storefront-renderer.mjs")
    shutil.rmtree(DOCS / "storefront-assets", ignore_errors=True)
    shutil.copytree(str(package.joinpath("assets")), DOCS / "storefront-assets")
    MANIFEST.write_text(json.dumps({
        "schema": "kerbside.storefront_exterior_tiles/1",
        "renderer_sha256": sha256(DOCS / "storefront-renderer.mjs"),
        "buildings": sum(t["buildings"] for t in tiles.values()),
        "tiles": sorted(tiles.values(), key=lambda t: t["world"]),
    }, indent=1) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("worlds", nargs="*", type=Path)
    args = parser.parse_args()
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    tiles = {t["world"]: t for t in previous.get("tiles", [])}
    for path in args.worlds or default_worlds():
        path = path.resolve()
        raw = world_bytes(path)
        if raw is None:
            print(json.dumps({"world": str(path), "skipped": "no payload"}), flush=True)
            continue
        key = str(path.relative_to(DOCS))
        done = tiles.get(key)
        if done and done.get("source_sha256") == hashlib.sha256(raw).hexdigest() and (DOCS / done["path"]).exists():
            continue  # plans already made from exactly this world
        tile = publish(path, raw)
        tiles.pop(key, None)
        if tile:
            tiles[tile["world"]] = tile
        write_manifest(tiles)  # each world as it is done: a long run that stops keeps its work
        print(json.dumps(tile or {"world": str(path), "storefronts": 0}), flush=True)
    write_manifest(tiles)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
