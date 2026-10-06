from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_capture_and_glasses_import_survive_app_trim() -> None:
    for path in (ROOT / "tools/app_template.html", ROOT / "docs/app.html"):
        app = path.read_text()
        assert 'id="model"' in app
        assert 'data-view="map"' in app
        assert 'data-view="capture"' in app
        assert 'data-view="library"' in app
        assert 'data-view="tonight"' in app
        assert 'id="cam-toggle"' in app
        assert 'id="import-input"' in app
        assert 'id="import-btn"' in app
        assert 'data-view="about"' not in app
        assert 'id="full-3d-download"' not in app
        assert 'id="android-install-btn"' not in app
        assert 'id="ios-install-btn"' not in app
        assert "CACHE_FULL_3D" not in app


def test_install_help_lives_on_landing_page_without_direct_map_links() -> None:
    for path in (ROOT / "tools/landing_template.html", ROOT / "docs/index.html"):
        page = path.read_text()
        assert 'id="get-android"' in page
        assert 'id="get-ios"' not in page
        assert 'id="open-app"' not in page
        assert 'id="save-app"' not in page
        assert 'fetch("app-regions.json"' in page
        assert 'tick.textContent = "In app"' in page
        assert "link.href = region.path" not in page
        assert "tick.href = region.path" not in page


def test_full_world_download_handler_is_gone_but_app_shell_remains() -> None:
    for path in (ROOT / "tools/pwa/sw.js", ROOT / "docs/sw.js"):
        worker = path.read_text()
        assert "CACHE_FULL_3D" not in worker
        assert '"./app.html"' in worker
        assert '"./app-model.html"' in worker
        assert 'self.addEventListener("fetch"' in worker


def test_public_brand_uses_earth_accent() -> None:
    for path in (
        ROOT / "tools/app_template.html",
        ROOT / "docs/app.html",
        ROOT / "tools/landing_template.html",
        ROOT / "docs/index.html",
        ROOT / "docs/app-model.html",
    ):
        assert "#8c844c" in path.read_text()
    assert "EARTH = (140, 132, 76, 255)" in (ROOT / "tools/make_icons.py").read_text()
