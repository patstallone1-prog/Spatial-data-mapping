"""The viewer pages the app serves, written from the renderer's source.

Every regional page is the same renderer with a few lines changed (its title, where its data
and tiles are, its land/water grid), so none of them is kept in the repository: the deploy
build writes them (tools/build_deploy_pages.py, Vercel's build command) and so does the
local build (tools/build_app_worlds.py, after it has made the data the pages point at).
With them the release manifest and the service worker, whose fingerprints are of the pages.

Standard library only (see smc.renderer.template).
"""

from __future__ import annotations

import hashlib
import html
import json
import re
from pathlib import Path

from smc.renderer.template import ROOT, page_template
from smc.renderer.tuning import tuned

DOCS = ROOT / "docs"
#: The SF corridor's own land/water grid beside docs/app-model.html.
SF_SUPPORT = "app-sf-corridor-landwater.bin"
#: A regional page's land/water grid beside it.
REGION_SUPPORT = "app-landwater.bin"
#: The one region whose data is published beside its page rather than read from the website's.
LOCAL_DATA_REGION = "oakland-downtown"
#: What the deploy writes and the repository no longer holds (see .gitignore).
GENERATED = ("app-model.html", "app-regions/*/app-model.html", "runtime-release.json", "sw.js")


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


def app_template() -> str:
    """The renderer cut for the app (--detail app): what every app page is made from."""
    return tuned(page_template(), "app")


def write_app_pages(docs: Path = DOCS, *, desktop_only: bool = True, template: str | None = None) -> int:
    """Write the app pages, the release manifest and the service worker into docs.

    Reads the regions from docs/app-regions.json (written by the data build with each
    built region's page path) and each region's land/water grid from beside its page. Returns
    how many regional pages were written."""
    template = template if template is not None else app_template()
    app_regions = docs / "app-regions"
    regions = json.loads((docs / "app-regions.json").read_text(encoding="utf-8"))["regions"]
    sf_support = SF_SUPPORT if (docs / SF_SUPPORT).is_file() else ""
    local_ground = (docs / "app-sf-corridor-ground.json").exists()
    (docs / "app-model.html").write_text(
        app_page(template, title="SF Corridor", index="app-regions.json",
                 local_ground=local_ground, visual_support=sf_support),
        encoding="utf-8",
    )
    if not desktop_only:
        # The headset version: the same renderer in its META mode (docs/meta-xr.mjs), the SF
        # page's world, with its own web-app manifest so it can be installed on a Meta Quest.
        # Released on its own (docs/meta.html is kept in the repository): a Mac release leaves it.
        meta_page = app_page(
            template, title="for Meta Quest", index="app-regions.json",
            local_ground=local_ground, visual_support=sf_support,
        ).replace("<title>Kerbside for Meta Quest 3D</title>", "<title>Kerbside for Meta Quest</title>", 1).replace(
            "</head>", '<meta name="kerbside-mode" content="meta" />\n'
                  '<link rel="manifest" href="meta.webmanifest" />\n</head>', 1)
        (docs / "meta.html").write_text(meta_page, encoding="utf-8")
    published = 0
    for region in regions:
        path = region.get("path") or ""
        if not path.startswith("app-regions/"):
            continue
        name = region["name"]
        target = app_regions / name
        target.mkdir(parents=True, exist_ok=True)
        page = app_page(
            template,
            title=region["title"],
            index="../../app-regions.json",
            assets="" if name == LOCAL_DATA_REGION else f"../../regions/{name}",
            tile_base="../../tiles/",
            local_payload=(target / "sf-corridor-3d.json").exists(),
            visual_support=REGION_SUPPORT if (target / REGION_SUPPORT).is_file() else "",
        )
        (docs / path).write_text(page, encoding="utf-8")
        published += 1
    viewers = [docs / "app-model.html", docs / "meta.html", *sorted(app_regions.glob("*/app-model.html"))]
    release = {
        "schema": 1,
        "authoritative_branch": "main",
        "renderer_source": "src/smc/renderer/page (smc.renderer.template.page_template)",
        "renderer_sha256": hashlib.sha256(template.encode()).hexdigest(),
        "consumers": {str(path.relative_to(docs)): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in viewers},
        # Mac and Quest can deliberately ship different renderer revisions. A Mac release
        # must neither overwrite the headset nor describe it as running the Mac's source.
        "consumer_renderer_sha256": {
            str(path.relative_to(docs)): re.search(
                r'name="kerbside-renderer-sha256" content="([a-f0-9]+)"', path.read_text())[1]
            for path in viewers
        },
        "runtime_assets_sha256": {
            str(path.relative_to(docs)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in [docs / "recoverable-geometry.mjs", docs / "recoverable-geometry-worker.mjs", docs / "world-streaming.mjs",
                         docs / "environment-runtime.mjs", docs / "sky-clock.mjs", docs / "sky-history.mjs", docs / "municipal-context.manifest.json",
                         *sorted((docs / "municipal").glob("*.json")), docs / "nature-runtime.mjs",
                         docs / "nature-ecology.mjs", docs / "vegetation-geometry.mjs", docs / "grass-strands.mjs", docs / "foliage-motion.mjs", docs / "nature/ecology.json",
                         docs / "forest-floor.mjs", docs / "globe.mjs", docs / "teleport-map.mjs",
                         docs / "object-catalogue.mjs", docs / "object-catalogue.json", docs / "exterior-editor.mjs", docs / "multiplayer.mjs",
                         docs / "kerbside-account.mjs", docs / "home-lobby.mjs",
                         *sorted((docs / "city").glob("*")), docs / "managed-lanes.json",
                         *sorted((docs / "inferred-interiors").glob("*.mjs")),
                         docs / "inferred-interiors/map-overlay.json",
                         docs / "inferred-restaurants/map-overlay.json",
                         docs / "meta-xr.mjs", docs / "meta.webmanifest",
                         *sorted((docs / "nature/models").glob("*")), *sorted((docs / "world").glob("*")),
                         docs / "nature/manifest.json", docs / "nature/paths.json", docs / "nature/buildings.json",
                         *sorted((docs / "nature/bark").glob("*")),
                         *sorted(path for path in (docs / "vendor").rglob("*") if path.is_file())]
        },
        "native_source": "unreal/Plugins/KerbsideWorld",
        "native_sources_sha256": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted((ROOT / "unreal/Plugins/KerbsideWorld").rglob("*"))
            if path.is_file() and path.suffix in (".cpp", ".h", ".cs", ".uplugin")
        },
        "app_shell_sha256": hashlib.sha256((docs / "app.html").read_bytes()).hexdigest(),
        "photo_derived_houses": {
            "count": json.loads((docs / "sf-corridor-frontage-fits.manifest.json").read_text())["houses"],
            "manifest_sha256": hashlib.sha256((docs / "sf-corridor-frontage-fits.manifest.json").read_bytes()).hexdigest(),
        },
        "interior_engine": {
            "houses": len(json.loads((docs / "inferred-interiors/map-overlay.json").read_text())["buildings"]),
            "restaurants": len(json.loads((docs / "inferred-restaurants/map-overlay.json").read_text())["buildings"]),
            "grade": "inferred; validated layout hypotheses, not measured real interiors",
            "consumer": "Mac app only",
        },
        "native_geometry": "Derived exports retain their own renderer_sha256; rebuild before native import.",
        "legacy_policy": "Other branches, regional website pages and build/app-viewer.html are not source templates.",
    }
    (docs / "runtime-release.json").write_text(json.dumps(release, indent=2) + "\n")
    digest = hashlib.blake2b(digest_size=8)
    app_assets = [docs / "app.html", docs / "app-model.html", docs / "app-regions.json",
                  docs / "runtime-release.json", docs / "sf-corridor-frontage-fits.manifest.json"]
    app_assets += [docs / name for name in ("sf-corridor-home-openings.json", "sf-corridor-materials.json",
                                           "sf-corridor-furniture.json", "sf-corridor-building-shapes.json", "sf-corridor-islands.json", "sf-corridor-roofs.json")
                   if (docs / name).exists()]
    app_assets += [docs / "recoverable-geometry.mjs", docs / "recoverable-geometry-worker.mjs", docs / "sf-corridor-storefront-names.json",
                   docs / "search-index.json", docs / "world-streaming.mjs", docs / "environment-runtime.mjs",
                   docs / "sky-clock.mjs", docs / "sky-history.mjs", docs / "foliage-motion.mjs", docs / "municipal-context.manifest.json"]
    app_assets += sorted((docs / "municipal").glob("*.json"))
    # The living city's modules and rules, and the lanes it charges for (docs/city/view.mjs).
    app_assets += [*sorted((docs / "city").glob("*")), docs / "managed-lanes.json"]
    app_assets += [docs / "billboard-creatives.json"] if (docs / "billboard-creatives.json").exists() else []
    app_assets += sorted((docs / "billboards").glob("*"))
    app_assets += sorted(path for directory in ("interior-assets", "inferred-interiors", "inferred-restaurants", "materials", "vendor")
                         for path in (docs / directory).rglob("*") if path.is_file())
    for name in ("app-sf-corridor-ground.json", "app-inventory-crossings.json"):
        if (docs / name).exists():
            app_assets.append(docs / name)
    if sf_support:
        app_assets.extend((docs / sf_support, (docs / sf_support).with_suffix(".json")))
    app_assets += sorted(path for path in app_regions.rglob("*") if path.is_file())
    for path in app_assets:
        digest.update(str(path.relative_to(docs)).encode())
        digest.update(str(path.stat().st_size).encode())
        # A same-sized edit must invalidate the installed app's cache too.
        digest.update(hashlib.blake2b(path.read_bytes(), digest_size=8).digest())
    worker = (ROOT / "tools" / "pwa" / "sw.js").read_text(encoding="utf-8")
    # A worker-policy change must migrate returning visitors even with unchanged world data.
    digest.update(worker.encode("utf-8"))
    for name in ("manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"):
        digest.update(name.encode())
        digest.update((docs / name).read_bytes())
    (docs / "sw.js").write_text(worker.replace("__VERSION__", digest.hexdigest()), encoding="utf-8")
    return published
