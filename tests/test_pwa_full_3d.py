from __future__ import annotations

import inspect
import re
from pathlib import Path

import tools.build_pages as build_pages

ROOT = Path(__file__).resolve().parents[1]


def _worker_version(path: Path) -> str:
    match = re.search(r'const VERSION = "([0-9a-f]+)";', path.read_text())
    assert match
    return match.group(1)


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


def test_the_app_opens_on_the_model_and_says_how_far_in_it_is():
    """The app is the measured model with a camera attached, not a camera with a map tab.

    It used to open on Capture with the map four tabs away and a flat canvas when you got
    there. The model is what the app is for and it is the thing that takes time to build, so it
    is the view that opens and it starts loading the moment the app does -- and while it builds,
    the bar reports the model's own stage and its own percentage rather than a spinner that
    means nothing.
    """
    app = (ROOT / "tools" / "app_template.html").read_text()
    # The map view is the one marked on, and its tab is the selected one, and it comes first.
    assert '<div class="view on" id="v-map">' in app
    assert '<button class="tab" data-view="map" aria-selected="true">' in app
    assert '<div class="view" id="v-capture">' in app
    order = re.findall(r'class="tab" data-view="([a-z]+)"', app)
    assert order[0] == "map", f"the map is not the first tab: {order}"
    # It opens the real viewer, eagerly.
    assert 'id="model"' in app and 'src="__MODEL_SRC__"' in app and 'loading="eager"' in app
    # And the bar reads the model rather than guessing.
    assert "kerbsideReady" in app and "MODEL_STAGES" in app
    assert 'getElementById("progress")' in app


def test_the_app_ships_a_finer_model_than_the_site():
    """The app has the file on the device and no page weight to keep to, so it is cut finer.

    The site build stops at a four-metre lattice: past that the corridor went to 83 ms a frame
    for centimetres nobody can see, in a browser tab sharing a GPU. Neither constraint applies
    to a downloaded mirror.
    """
    import importlib
    import sys as _sys

    _sys.path.insert(0, str(ROOT / "scripts"))
    builder = importlib.import_module("build_sf_corridor_3d")
    assert "app" in builder.DETAIL_TUNING and "site" in builder.DETAIL_TUNING
    assert not builder.DETAIL_TUNING["site"], "the site build is the untuned one"
    swaps = builder.DETAIL_TUNING["app"]
    assert any("LATTICE_BY_INCLINE" in old for old in swaps), "the app does not re-cut the ground"
    # Every rule the app swaps has to still exist in the page it swaps them into.
    page = builder.HTML
    for old in swaps:
        assert old in page, f"the app tuning is stale: {old[:60]!r} is no longer in the renderer"
    # And the tuner refuses rather than silently shipping the site's cut.
    assert "the tuning has drifted" in inspect.getsource(builder.tuned)
