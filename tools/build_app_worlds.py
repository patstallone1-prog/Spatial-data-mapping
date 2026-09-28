"""Publish app-only regional viewers without rewriting the frozen website pages.

The installed app uses the full renderer.  Existing website region datasets can be read in
place; Oakland gets its expanded estuary build and its own data beside the app viewer.
"""

from __future__ import annotations

import html
import hashlib
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
VIEWER = ROOT / "build" / "app-viewer.html"
REGISTRY = ROOT / "data" / "regions" / "regions.json"
APP_REGIONS = DOCS / "app-regions"


def app_page(template: str, *, title: str, index: str, assets: str = "", tile_base: str = "tiles/",
             local_payload: bool = False, local_ground: bool = False) -> str:
    page = template.replace("Kerbside SF Corridor 3D", f"Kerbside {html.escape(title)} 3D")
    page = page.replace('<meta name="kerbside-regions" content="regions.json" />',
                        f'<meta name="kerbside-regions" content="{index}" />', 1)
    page = page.replace('<meta name="kerbside-assets" content="" />',
                        f'<meta name="kerbside-assets" content="{assets}" />\n'
                        '<meta name="kerbside-app-mode" content="full-regional-view" />', 1)
    page = page.replace('const TILE_BASE = "tiles/";', f'const TILE_BASE = "{tile_base}";', 1)
    if local_payload:
        page = page.replace('fetch(asset("sf-corridor-3d.json")', 'fetch("sf-corridor-3d.json"', 1)
    if local_ground:
        page = page.replace('fetch(asset("sf-corridor-ground.json")',
                            'fetch("app-sf-corridor-ground.json"', 1)
    return page


def main() -> None:
    template = VIEWER.read_text(encoding="utf-8")
    index = json.loads((DOCS / "regions.json").read_text(encoding="utf-8"))
    registry = {entry["name"]: entry for entry in json.loads(REGISTRY.read_text(encoding="utf-8"))["regions"]}
    (DOCS / "app-model.html").write_text(app_page(template, title="SF Corridor", index="app-regions.json",
                                                   local_ground=(DOCS / "app-sf-corridor-ground.json").exists()),
                                          encoding="utf-8")
    published = 0
    for region in index["regions"]:
        if region["name"] == "sf-corridor":
            region["path"] = "app-model.html"
            continue
        if not region.get("built"):
            continue
        name = region["name"]
        target = APP_REGIONS / name
        target.mkdir(parents=True, exist_ok=True)
        assets = f"../../regions/{name}"
        if name == "oakland-downtown":
            site = ROOT / "data" / "regions" / name / "site"
            if not (site / "sf-corridor-3d.json").exists():
                raise FileNotFoundError("expanded Oakland app world has not been built")
            for source in site.glob("sf-corridor-*"):
                if source.suffix in (".json", ".bin"):
                    shutil.copy2(source, target / source.name)
            assets = ""
            region["bbox"] = registry[name]["bbox"]
            region["title"] = "Downtown Oakland and the Oakland-Alameda tubes"
            region["description"] = registry[name]["description"]
        page = app_page(template, title=region["title"], index="../../app-regions.json",
                        assets=assets, tile_base="../../tiles/",
                        local_payload=(target / "sf-corridor-3d.json").exists())
        (target / "app-model.html").write_text(page, encoding="utf-8")
        region["path"] = f"app-regions/{name}/app-model.html"
        published += 1
    (DOCS / "app-regions.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    digest = hashlib.blake2b(digest_size=8)
    app_assets = [DOCS / "app.html", DOCS / "app-model.html", DOCS / "app-regions.json"]
    if (DOCS / "app-sf-corridor-ground.json").exists():
        app_assets.append(DOCS / "app-sf-corridor-ground.json")
    app_assets += sorted(path for path in APP_REGIONS.rglob("*") if path.is_file())
    for path in app_assets:
        digest.update(str(path.relative_to(DOCS)).encode())
        digest.update(str(path.stat().st_size).encode())
        # A same-sized edit must invalidate the installed app's cache too.
        digest.update(hashlib.blake2b(path.read_bytes(), digest_size=8).digest())
    worker = (ROOT / "tools" / "pwa" / "sw.js").read_text(encoding="utf-8")
    (DOCS / "sw.js").write_text(worker.replace("__VERSION__", digest.hexdigest()), encoding="utf-8")
    print(f"App-only worlds: {published} regional viewers; website files untouched")


if __name__ == "__main__":
    main()
