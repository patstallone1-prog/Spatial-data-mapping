from __future__ import annotations

import re
from pathlib import Path

import tools.build_pages as build_pages

ROOT = Path(__file__).resolve().parents[1]


def _worker_version(path: Path) -> str:
    match = re.search(r'const VERSION = "([0-9a-f]+)";', path.read_text())
    assert match
    return match.group(1)


def test_phone_app_exposes_full_3d_offline_download() -> None:
    app = (ROOT / "tools" / "app_template.html").read_text()
    worker = (ROOT / "tools" / "pwa" / "sw.js").read_text()

    assert 'href="sf-corridor-3d.html"' in app
    assert 'id="full-3d-download"' in app
    assert 'id="full-3d-status"' in app
    assert 'postMessage({ type: "CACHE_FULL_3D" })' in app
    assert 'message.type !== "CACHE_FULL_3D"' in worker
    assert 'sf-corridor-detail-manifest.json' in worker
    assert "manifest.offline_assets" in worker
    assert 'state: failed ? "partial" : "complete"' in worker


def test_detail_shard_change_invalidates_installed_phone_cache(
    tmp_path: Path, monkeypatch,
) -> None:
    source = tmp_path / "source"
    build = tmp_path / "build"
    published = tmp_path / "published"
    source.mkdir()
    build.mkdir()
    (source / "sf-corridor-3d.html").write_text("map")
    (source / "sf-corridor-3d.json").write_text("{}")
    detail = source / "sf-corridor-detail-west.json"
    detail.write_text("west")
    (build / "kerbside-app.html").write_text("app")
    (build / "landing.html").write_text("landing")

    monkeypatch.setattr(build_pages, "OUT", source)
    monkeypatch.setattr(build_pages, "BUILD", build)
    monkeypatch.setattr(build_pages.make_icons, "main", lambda out: None)

    build_pages.main(published)
    first = _worker_version(published / "sw.js")
    detail.write_text("west-detail-expanded")
    build_pages.main(published)
    second = _worker_version(published / "sw.js")

    assert first != second


def test_the_page_can_fetch_its_data_from_an_asset_origin_instead_of_beside_itself(tmp_path):
    """The data files are the bulk of the repository; published to object storage, the page
    points at them through one meta tag and nothing is copied beside it. Without an origin
    the page fetches beside itself, which is what GitHub Pages serves today."""
    import importlib.util
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("build_pages", root / "tools" / "build_pages.py")
    build_pages = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build_pages)
    page = (root / "docs" / "sf-corridor-3d.html").read_text()
    assert '<meta name="kerbside-assets" content="" />' in page
    assert page.count("fetch(asset(") >= 5 and 'fetch("sf-corridor-3d.json"' not in page
    pointed = build_pages.point_assets_at(page, "https://assets.example.org/")
    assert '<meta name="kerbside-assets" content="https://assets.example.org" />' in pointed
    assert build_pages.point_assets_at(page, None) == page
    assert (root / "tools" / "publish_assets.sh").exists()
