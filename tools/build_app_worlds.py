"""Publish app-only regional viewers without rewriting the frozen website pages.

The installed app uses the full renderer.  Existing website region datasets can be read in
place; Oakland gets its expanded estuary build and its own data beside the app viewer.
"""

from __future__ import annotations

import hashlib
import html
import json
import runpy
import shutil
from pathlib import Path

from smc.terrain.visual_support import write_visual_landwater

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
VIEWER = ROOT / "build" / "app-viewer.html"
REGISTRY = ROOT / "data" / "regions" / "regions.json"
APP_REGIONS = DOCS / "app-regions"


def app_page(
    template: str,
    *,
    title: str,
    index: str,
    assets: str = "",
    tile_base: str = "tiles/",
    local_payload: bool = False,
    local_ground: bool = False,
    visual_support: str = "",
) -> str:
    page = template.replace("Kerbside SF Corridor 3D", f"Kerbside {html.escape(title)} 3D")
    # Identifies the shared source, not a region's last hand-edited/generated copy.
    source_hash = hashlib.sha256(template.encode()).hexdigest()
    page = page.replace("</head>",
                        f'<meta name="kerbside-renderer-sha256" content="{source_hash}" />\n</head>', 1)
    page = page.replace(
        '<meta name="kerbside-regions" content="regions.json" />',
        f'<meta name="kerbside-regions" content="{index}" />',
        1,
    )
    page = page.replace(
        '<meta name="kerbside-assets" content="" />',
        f'<meta name="kerbside-assets" content="{assets}" />\n'
        '<meta name="kerbside-app-mode" content="full-regional-view" />\n'
        f'<meta name="kerbside-visual-support" content="{visual_support}" />',
        1,
    )
    page = page.replace('const TILE_BASE = "tiles/";', f'const TILE_BASE = "{tile_base}";', 1)
    # Every fetch of the payload and of the ground -- whole, or in its window cells -- goes to
    # the one URL the page names for each.
    if local_payload:
        page = page.replace('const PAYLOAD_URL = asset("sf-corridor-3d.json");',
                            'const PAYLOAD_URL = "sf-corridor-3d.json";', 1)
    if local_ground:
        page = page.replace('const GROUND_URL = asset("sf-corridor-ground.json");',
                            'const GROUND_URL = "app-sf-corridor-ground.json";', 1)
    return page


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


def main() -> None:
    # Never ship a stale hand-built app-viewer cache over a newer renderer.
    renderer = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
    template = renderer["tuned"](renderer["HTML"], "app")
    VIEWER.parent.mkdir(parents=True, exist_ok=True)
    VIEWER.write_text(template, encoding="utf-8")
    index = json.loads((DOCS / "regions.json").read_text(encoding="utf-8"))
    registry = {
        entry["name"]: entry
        for entry in json.loads(REGISTRY.read_text(encoding="utf-8"))["regions"]
    }
    sf_support = build_visual_support(DOCS, DOCS, DOCS, "app-sf-corridor-landwater.bin")
    (DOCS / "app-model.html").write_text(
        app_page(
            template,
            title="SF Corridor",
            index="app-regions.json",
            local_ground=(DOCS / "app-sf-corridor-ground.json").exists(),
            visual_support=sf_support,
        ),
        encoding="utf-8",
    )
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
        assets = f"../../regions/{name}"
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
            # viewer must not require the much larger private source world on disk.
            assets = ""
            region["bbox"] = registry[name]["bbox"]
            region["title"] = "Downtown Oakland and the Oakland-Alameda tubes"
            region["description"] = registry[name]["description"]
        terrain_source = target if name == "oakland-downtown" else DOCS / "regions" / name
        payload_source = target if (target / "sf-corridor-3d.json").exists() else terrain_source
        support = build_visual_support(payload_source, terrain_source, target, "app-landwater.bin")
        page = app_page(
            template,
            title=region["title"],
            index="../../app-regions.json",
            assets=assets,
            tile_base="../../tiles/",
            local_payload=(target / "sf-corridor-3d.json").exists(),
            visual_support=support,
        )
        (target / "app-model.html").write_text(page, encoding="utf-8")
        region["path"] = f"app-regions/{name}/app-model.html"
        published += 1
    (DOCS / "app-regions.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    viewers = [DOCS / "app-model.html", *sorted(APP_REGIONS.glob("*/app-model.html"))]
    release = {
        "schema": 1,
        "authoritative_branch": "main",
        "renderer_source": "scripts/build_sf_corridor_3d.py:HTML",
        "renderer_sha256": hashlib.sha256(template.encode()).hexdigest(),
        "consumers": {str(path.relative_to(DOCS)): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in viewers},
        "native_source": "unreal/Plugins/KerbsideWorld",
        "native_sources_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted((ROOT / "unreal/Plugins/KerbsideWorld").rglob("*"))
            if path.is_file() and path.suffix in (".cpp", ".h", ".cs", ".uplugin")
        },
        "app_shell_sha256": hashlib.sha256((DOCS / "app.html").read_bytes()).hexdigest(),
        "native_geometry": "Derived exports retain their own renderer_sha256; rebuild before native import.",
        "legacy_policy": "Other branches, regional website pages and build/app-viewer.html are not source templates.",
    }
    (DOCS / "runtime-release.json").write_text(json.dumps(release, indent=2) + "\n")
    digest = hashlib.blake2b(digest_size=8)
    app_assets = [DOCS / "app.html", DOCS / "app-model.html", DOCS / "app-regions.json",
                  DOCS / "runtime-release.json"]
    app_assets += [DOCS / name for name in ("sf-corridor-home-openings.json", "sf-corridor-materials.json",
                                           "sf-corridor-furniture.json") if (DOCS / name).exists()]
    app_assets += sorted(path for directory in ("interior-assets", "materials")
                         for path in (DOCS / directory).rglob("*") if path.is_file())
    if (DOCS / "app-sf-corridor-ground.json").exists():
        app_assets.append(DOCS / "app-sf-corridor-ground.json")
    if sf_support:
        app_assets.extend((DOCS / sf_support, (DOCS / sf_support).with_suffix(".json")))
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
