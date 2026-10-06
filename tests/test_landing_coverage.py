"""The public landing page must list the app's published areas and honest install routes."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
APP_PATH = re.compile(r"^(app-model\.html|app-regions/[a-z0-9-]+/app-model\.html)$")


def test_live_coverage_index_only_points_at_published_full_app_pages() -> None:
    template = (ROOT / "tools/landing_template.html").read_text()
    page = (DOCS / "index.html").read_text()
    regions = json.loads((DOCS / "app-regions.json").read_text())["regions"]

    for source in (template, page):
        assert 'fetch("app-regions.json", { cache: "no-store" })' in source
        assert 'fetch("regions.json"' not in source
        assert 'id="coverage-status"' in source
        assert "region.built &&" in source

    live = [
        region
        for region in regions
        if region.get("built") and APP_PATH.fullmatch(region.get("path", ""))
    ]
    assert len(live) >= 8
    for region in live:
        assert (DOCS / region["path"]).is_file(), region["path"]


def test_install_controls_reach_the_published_app() -> None:
    page = (DOCS / "index.html").read_text()
    manifest = json.loads((DOCS / "manifest.webmanifest").read_text())
    assert (DOCS / "app.html").is_file()
    assert manifest["start_url"].startswith("./app.html")
    # The app installs from this page (its manifest starts the app); the page never sends anyone
    # to the browser map website, which is retired, and an installed icon goes into the app.
    assert '<link rel="manifest" href="manifest.webmanifest"' in page
    assert 'location.replace("app.html?from=home")' in page
    assert "github.io" not in page
    assert "Open the map" not in page and "sf-corridor-3d.html" not in page
    assert 'href="app.html"' not in page
    for control in ("get-android", "get-ios", "get-desktop"):
        assert f'id="{control}"' in page
    assert "Install on Android" in page and "Install on iPhone" in page
    assert "Install on this computer" in page
    assert "Download for Samsung" not in page and "Download for iPhone" not in page


def test_app_startup_does_not_write_removed_2d_map_counters() -> None:
    for path in (ROOT / "tools/app_template.html", DOCS / "app.html"):
        source = path.read_text()
        assert 'id="model"' in source
        assert 'getElementById("m-walk").textContent' not in source
        assert 'getElementById("m-cover").textContent' not in source


def test_the_browser_map_website_is_retired() -> None:
    """The site is the page that installs the app. The browser map's old addresses lead there,
    and no region publishes a map page of its own."""
    vercel = json.loads((ROOT / "vercel.json").read_text())
    sources = {r["source"]: r["destination"] for r in vercel["redirects"]}
    for path in ("/sf-corridor-3d.html", "/regions/:region/sf-corridor-3d.html", "/regions/:region/index.html"):
        assert sources.get(path) == "/#install", path
    assert not list((DOCS / "regions").glob("*/sf-corridor-3d.html"))
    assert not list((DOCS / "regions").glob("*/index.html"))
