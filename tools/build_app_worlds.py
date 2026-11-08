"""Publish app-only regional viewers without rewriting the frozen website pages.

The installed app uses the full renderer.  Existing website region datasets can be read in
place; Oakland gets its expanded estuary build and its own data beside the app viewer.

This builds the data the pages point at (each region's land/water grid, docs/app-regions.json,
the search index) and then writes the pages themselves with smc.renderer.pages -- the same
code the deploy runs (tools/build_deploy_pages.py), so a page is never kept in the repository.
"""

from __future__ import annotations

import argparse
import json
import runpy
import shutil
from pathlib import Path

from smc.renderer.pages import app_template, write_app_pages
from smc.terrain.visual_support import write_visual_landwater

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
VIEWER = ROOT / "build" / "app-viewer.html"
REGISTRY = ROOT / "data" / "regions" / "regions.json"
APP_REGIONS = DOCS / "app-regions"


def build_visual_support(
    payload_source: Path, terrain_source: Path, target: Path, name: str
) -> str:
    payload = payload_source / "sf-corridor-3d.json"
    terrain_meta = terrain_source / "sf-corridor-terrain.json"
    terrain_bin = terrain_source / "sf-corridor-terrain.bin"
    if not all(path.is_file() for path in (payload, terrain_meta, terrain_bin)):
        return ""
    write_visual_landwater(payload, terrain_meta, terrain_bin, target / name)
    return name


def main(*, desktop_only: bool = True) -> None:
    # Never ship a stale hand-built app-viewer cache over a newer renderer.
    template = app_template()
    VIEWER.parent.mkdir(parents=True, exist_ok=True)
    VIEWER.write_text(template, encoding="utf-8")
    index = json.loads((DOCS / "regions.json").read_text(encoding="utf-8"))
    registry = {
        entry["name"]: entry
        for entry in json.loads(REGISTRY.read_text(encoding="utf-8"))["regions"]
    }
    build_visual_support(DOCS, DOCS, DOCS, "app-sf-corridor-landwater.bin")
    published = 0
    for region in index["regions"]:
        if region["name"] == "sf-corridor":
            region["path"] = "app-model.html"
            continue
        if not region.get("built"):
            # Listed, not yet built: no page to open (the browser map's page it used to name is
            # retired), and the app's area menu shows it disabled.
            region["path"] = None
            continue
        name = region["name"]
        target = APP_REGIONS / name
        target.mkdir(parents=True, exist_ok=True)
        if name == "oakland-downtown":
            site = ROOT / "data" / "regions" / name / "site"
            if (site / "sf-corridor-3d.json").exists():
                for source in site.glob("sf-corridor-*"):
                    # Never an older local build over newer published app data.
                    already = target / source.name
                    if source.suffix in (".json", ".bin") and not (
                        already.exists() and already.stat().st_mtime >= source.stat().st_mtime
                    ):
                        shutil.copy2(source, already)
            elif not (target / "sf-corridor-3d.json").exists():
                raise FileNotFoundError("expanded Oakland app world has not been built")
            # A clean checkout already carries the published app data. Rebuilding the
            # viewer must not require the much larger private source world on disk (its page
            # reads its data from beside it: smc.renderer.pages.LOCAL_DATA_REGION).
            region["bbox"] = registry[name]["bbox"]
            region["title"] = "Downtown Oakland and the Oakland-Alameda tubes"
            region["description"] = registry[name]["description"]
        terrain_source = target if name == "oakland-downtown" else DOCS / "regions" / name
        payload_source = target if (target / "sf-corridor-3d.json").exists() else terrain_source
        # The page names this grid when it is beside it (smc.renderer.pages); a cloud cell's
        # payload is in the bucket, and its grid came with its release.
        build_visual_support(payload_source, terrain_source, target, "app-landwater.bin")
        region["path"] = f"app-regions/{name}/app-model.html"
        published += 1
    (DOCS / "app-regions.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    # The nearby render window must not remove names from global search.
    runpy.run_path(str(ROOT / "tools/build_search_index.py"))["main"]()
    write_app_pages(DOCS, desktop_only=desktop_only, template=template)
    print(f"App-only worlds: {published} regional viewers; website files untouched")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--desktop-only", action="store_true", help="preserve the independently released Quest page (default)")
    mode.add_argument("--include-quest", action="store_true", help="explicitly rebuild and release the Quest consumer too")
    main(desktop_only=not parser.parse_args().include_quest)
