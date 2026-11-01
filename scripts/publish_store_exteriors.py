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
    plans bind to the exact shell they were inferred from, and the copies differ."""
    worlds = [DOCS / "sf-corridor-3d.json"]
    app = sorted(DOCS.glob("app-regions/*/sf-corridor-3d.json"))
    worlds += app
    have = {p.parent.name for p in app}
    worlds += [p for p in sorted(DOCS.glob("regions/*/sf-corridor-3d.json")) if p.parent.name not in have]
    return worlds


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def publish(world_path: Path) -> dict | None:
    world = json.loads(world_path.read_bytes())
    with tempfile.TemporaryDirectory() as tmp:
        manifest = build_bundle(Path(tmp), world=world, limit=LIMIT)
    slim = runtime_manifest(manifest)
    plans = world_path.parent / PLANS
    if not slim["buildings"]:
        plans.unlink(missing_ok=True)
        return None
    plans.write_text(json.dumps(slim, separators=(",", ":")) + "\n")
    b = world["bbox"]
    return {"world": str(world_path.relative_to(DOCS)), "path": str(plans.relative_to(DOCS)),
            "bbox": [b["west"], b["south"], b["east"], b["north"]], "buildings": len(slim["buildings"]),
            "rejected": slim["rejected"], "bytes": plans.stat().st_size, "sha256": sha256(plans)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("worlds", nargs="*", type=Path)
    args = parser.parse_args()
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    tiles = {t["world"]: t for t in previous.get("tiles", [])}
    for path in args.worlds or default_worlds():
        path = path.resolve()
        if not path.is_file():
            print(json.dumps({"world": str(path), "skipped": "no payload"}), flush=True)
            continue
        tile = publish(path)
        tiles.pop(str(path.relative_to(DOCS)), None)
        if tile:
            tiles[tile["world"]] = tile
        print(json.dumps(tile or {"world": str(path), "storefronts": 0}), flush=True)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
