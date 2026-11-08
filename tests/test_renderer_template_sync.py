"""A generated page must not become a newer, unrepeatable renderer version."""

import hashlib
import json
import re
import runpy
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from tests.test_world_object_renderer import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def test_every_installed_city_uses_the_current_house_and_collision_code() -> None:
    current = _page_js()
    pages = [ROOT / "docs/app-model.html", *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]
    # One viewer per built region; cloud releases add regions (docs/app-regions.json).
    built = [r for r in json.loads((ROOT / "docs/app-regions.json").read_text())["regions"] if r.get("built")]
    assert {ROOT / "docs" / r["path"] for r in built} == set(pages)
    for page in pages:
        text = page.read_text()
        for name in ("wallPanels", "regularHomeWindows", "buildHomeShell", "batchHomeShell",
                     "buildInterior", "insideEntranceRecess", "nearestDoor", "wallSegmentsNear",
                     "planInwardStoop", "moveWalker", "maskedGrassMaterial", "grassRasterRows",
                     "homeStoreyCount", "furnishingPlacement", "addressLanding",
                     "placeCamera",
                     "pageToTerrain", "terrainToPage",
                     "rawTerrainHeightAt", "mappedWaterAt", "mappedBuiltAt", "terrainFlatRadius",
                     "homeWindowLayout", "pumpHomeDecals", "treeVariant", "addOfficialSignPlates",
                     "frontageFitFor", "frontageNormalFor", "frontageWindowsOnEdge", "homeDesignMaterial",
                     "houseCertainty",
                     "homeWindowArchSpring", "homeWindowCrown", "homeWindowShape", "homeWindowPaneGeometry", "homeWindowArchCorners",
                     "facadeAppearanceBands", "clipFacadeBand",
                     "frontageWallTriangles",
                     "photoDetailParts",
                     "photoOpeningTexture", "photoOpeningParts",
                     "frontageOutcropsOnEdge", "homeOutcropSurfaces", "homeOutcropCapGeometry",
                     "cornerStreetNameSigns", "backdropAt"):
            assert _extract(name, text) == _extract(name, current), f"stale {name}: {page}"


def test_every_published_viewer_has_valid_module_syntax():
    if not shutil.which("node"):
        pytest.skip("Node required for published JavaScript syntax checking")
    pages = [ROOT / "docs/app-model.html",
             *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]
    for page in pages:
        module = page.read_text().split('<script type="module">', 1)[1].split("</script>", 1)[0]
        result = subprocess.run(["node", "--check", "--input-type=module"], input=module,
                                text=True, capture_output=True, timeout=15, check=False)
        assert result.returncode == 0, f"{page}: {result.stderr}"


def test_app_build_uses_source_not_an_old_viewer_cache() -> None:
    source = (ROOT / "tools/build_app_worlds.py").read_text()
    assert "template = app_template()" in source
    assert "write_app_pages(DOCS, desktop_only=desktop_only, template=template)" in source
    assert 'template = VIEWER.read_text' not in source
    # The deploy writes the same pages from the same source, with nothing but the standard library.
    pages = (ROOT / "src/smc/renderer/pages.py").read_text()
    assert 'return tuned(page_template(), "app")' in pages
    deploy = (ROOT / "tools/build_deploy_pages.py").read_text()
    assert "write_app_pages(DOCS)" in deploy
    vercel = json.loads((ROOT / "vercel.json").read_text())
    assert vercel["buildCommand"] == "python3 tools/build_deploy_pages.py"


def test_the_generated_pages_are_not_kept_in_the_repository() -> None:
    ignored = (ROOT / ".gitignore").read_text()
    for path in ("/docs/app-model.html", "/docs/app-regions/*/app-model.html", "/docs/runtime-release.json", "/docs/sw.js"):
        assert path in ignored
    tracked = subprocess.run(["git", "ls-files", "docs/app-model.html", "docs/sw.js", "docs/runtime-release.json",
                              "docs/app-regions/*/app-model.html"], cwd=ROOT, capture_output=True, text=True, check=False)
    assert tracked.stdout.strip() == ""


def test_the_deploy_build_needs_only_the_standard_library() -> None:
    """Vercel's build machine has Python and none of the pipeline's packages."""
    probe = (
        "import sys, importlib.abc\n"
        "class Block(importlib.abc.MetaPathFinder):\n"
        "    def find_spec(self, name, path=None, target=None):\n"
        "        if name.split('.')[0] in {'numpy', 'h3', 'pyarrow', 'shapely', 'PIL', 'scipy'}:\n"
        "            raise ImportError(name)\n"
        "sys.meta_path.insert(0, Block())\n"
        f"sys.path.insert(0, {str(ROOT / 'src')!r})\n"
        "import smc.renderer.pages, smc.renderer.template, smc.renderer.tuning\n"
        "print('ok')\n"
    )
    out = subprocess.run([sys.executable, "-I", "-c", probe], capture_output=True, text=True, check=False)
    assert out.stdout.strip() == "ok", out.stderr


def test_geometry_audit_uses_the_renderers_service_width_table() -> None:
    source = (ROOT / "scripts/audit_corridor_render.py").read_text()
    assert 'const SERVICE_ROAD_M = {' not in source
    assert 'DRIVER.replace("__SERVICE_ROAD_M__", service_table.group(0))' in source


def test_entire_app_module_and_release_manifest_match_authoritative_source() -> None:
    """An old road/furniture/tile implementation cannot hide behind current house functions."""
    builder = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
    template = builder["tuned"](builder["HTML"], "app")
    expected = template.split('<script type="module">', 1)[1].split("</script>", 1)[0]
    release = json.loads((ROOT / "docs/runtime-release.json").read_text())
    source_hash = hashlib.sha256(template.encode()).hexdigest()
    assert release["renderer_sha256"] == source_hash
    assert release["app_shell_sha256"] == hashlib.sha256((ROOT / "docs/app.html").read_bytes()).hexdigest()
    assert release["native_sources_sha256"]
    for name, expected_hash in release["native_sources_sha256"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected_hash, f"stale native release: {name}"
    pages = [ROOT / "docs/app-model.html", ROOT / "docs/meta.html",
             *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]
    assert set(release["consumers"]) == {str(p.relative_to(ROOT / "docs")) for p in pages}
    for page in pages:
        text = page.read_text()
        consumer_hash = release["consumer_renderer_sha256"][str(page.relative_to(ROOT / "docs"))]
        assert f'name="kerbside-renderer-sha256" content="{consumer_hash}"' in text
        assert release["consumers"][str(page.relative_to(ROOT / "docs"))] == hashlib.sha256(page.read_bytes()).hexdigest()
        if page.name == "meta.html":
            # The Quest build is independent: Mac-only releases intentionally leave it alone.
            continue
        assert consumer_hash == source_hash
        module = text.split('<script type="module">', 1)[1].split("</script>", 1)[0]
        # These three routes are the only supported consumer substitutions.
        module = module.replace('const PAYLOAD_URL = "sf-corridor-3d.json";', 'const PAYLOAD_URL = asset("sf-corridor-3d.json");')
        module = module.replace('const GROUND_URL = "app-sf-corridor-ground.json";', 'const GROUND_URL = asset("sf-corridor-ground.json");')
        module = re.sub(r'const TILE_BASE = "[^"]*";', 'const TILE_BASE = "tiles/";', module)
        assert module == expected, f"stale shared renderer module: {page}"


def test_the_page_is_its_shell_with_the_module_parts_joined_in_name_order() -> None:
    from smc.renderer import template

    parts = template.module_parts()
    assert len(parts) >= 2 and [p.name for p in parts] == sorted(p.name for p in parts)
    shell = template.SHELL.read_text(encoding="utf-8")
    assert shell.count(template.MODULE_MARKER) == 1
    page = template.page_template()
    module = "".join(p.read_text(encoding="utf-8") for p in parts)
    assert page == shell.replace(template.MODULE_MARKER, module, 1)
    assert template.MODULE_MARKER not in page
    head, _, tail = shell.partition(template.MODULE_MARKER)
    assert head.rstrip().endswith('<script type="module">') or '<script type="module">' in head[-400:]
