"""A generated page must not become a newer, unrepeatable renderer version."""

import hashlib
import json
import re
import runpy
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_world_object_renderer import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def test_every_installed_city_uses_the_current_house_and_collision_code() -> None:
    current = _page_js()
    pages = [ROOT / "docs/app-model.html", *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]
    assert len(pages) == 8
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
    assert 'renderer = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))' in source
    assert 'template = renderer["tuned"](renderer["HTML"], "app")' in source
    assert 'template = VIEWER.read_text' not in source


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
    pages = [ROOT / "docs/app-model.html", *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]
    assert set(release["consumers"]) == {str(p.relative_to(ROOT / "docs")) for p in pages}
    for page in pages:
        text = page.read_text()
        assert f'name="kerbside-renderer-sha256" content="{source_hash}"' in text
        assert release["consumers"][str(page.relative_to(ROOT / "docs"))] == hashlib.sha256(page.read_bytes()).hexdigest()
        module = text.split('<script type="module">', 1)[1].split("</script>", 1)[0]
        # These three routes are the only supported consumer substitutions.
        module = module.replace('const PAYLOAD_URL = "sf-corridor-3d.json";', 'const PAYLOAD_URL = asset("sf-corridor-3d.json");')
        module = module.replace('const GROUND_URL = "app-sf-corridor-ground.json";', 'const GROUND_URL = asset("sf-corridor-ground.json");')
        module = re.sub(r'const TILE_BASE = "[^"]*";', 'const TILE_BASE = "tiles/";', module)
        assert module == expected, f"stale shared renderer module: {page}"
