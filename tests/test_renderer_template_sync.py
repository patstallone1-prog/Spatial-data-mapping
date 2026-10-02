"""A generated page must not become a newer, unrepeatable renderer version."""

from pathlib import Path
from tests.test_world_object_renderer import _extract, _page_js


ROOT = Path(__file__).resolve().parents[1]


def test_published_sf_renderer_matches_builder_template() -> None:
    builder = (ROOT / "scripts/build_sf_corridor_3d.py").read_text(encoding="utf-8")
    marker = 'HTML = r"""'
    start = builder.index(marker) + len(marker)
    end = builder.index('"""', start)
    template = builder[start:end]
    published = (ROOT / "docs/sf-corridor-3d.html").read_text(encoding="utf-8")
    assert template == published, (
        "docs/sf-corridor-3d.html has diverged from the canonical builder template; "
        "synchronize the complete page before shipping or rebuilding regions"
    )


def test_every_installed_city_uses_the_current_house_and_collision_code() -> None:
    current = _page_js()
    pages = [ROOT / "docs/app-model.html", *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]
    assert len(pages) == 8
    for page in pages:
        text = page.read_text()
        for name in ("wallPanels", "regularHomeWindows", "buildHomeShell", "batchHomeShell",
                     "buildInterior", "insideEntranceRecess", "nearestDoor", "wallSegmentsNear",
                     "planInwardStoop", "moveWalker", "maskedGrassMaterial"):
            assert _extract(name, text) == _extract(name, current), f"stale {name}: {page}"


def test_app_build_uses_source_not_an_old_viewer_cache() -> None:
    source = (ROOT / "tools/build_app_worlds.py").read_text()
    assert 'renderer = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))' in source
    assert 'template = renderer["tuned"](renderer["HTML"], "app")' in source
    assert 'template = VIEWER.read_text' not in source
