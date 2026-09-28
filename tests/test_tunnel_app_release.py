"""Regression gates for the app-only Oakland tubes and preserved curb evidence."""

from __future__ import annotations

import json
import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_immersed_tubes_do_not_depend_on_hill_cover() -> None:
    classify = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))["classify_tunnels"]
    ways = [
        {"kind": "street", "name": name, "tunnel": True, "points": [[-122.28, 37.787], [-122.27, 37.797]]}
        for name in ("Posey Tube", "Webster Street Tube")
    ]
    counts = classify(ways)
    assert counts["immersed road tube"] == 2
    assert [w["tunnel_design"]["clearance_m"] for w in ways] == [4.47, 4.52]
    assert all(w["tunnel_design"]["profile_source"] == "inferred_visual_not_measured" for w in ways)
    assert all(w["tunnel_kind"] == "road" and set(w["tunnel_mouths"]) == {"start", "end"} for w in ways)


def test_archived_heights_are_the_payload_not_the_uniform_visual_override() -> None:
    module = runpy.run_path(str(ROOT / "scripts/archive_measured_curbs.py"))
    expected = module["build_archive"]()
    archived = json.loads((ROOT / "data/curb_measurement/sf_per_way_heights_archive.json").read_text())
    assert archived == expected
    assert archived["count"] > 4_000
    renderer = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "const KERB_RENDER_UNIFORM = true;" in renderer


def test_app_only_worlds_and_map_default() -> None:
    app = (ROOT / "tools/app_template.html").read_text()
    assert '<div class="view on" id="v-map">' in app
    assert 'data-view="map" aria-selected="true"' in app
    index = json.loads((ROOT / "docs/app-regions.json").read_text())
    oakland = next(row for row in index["regions"] if row["name"] == "oakland-downtown")
    assert oakland["path"] == "app-regions/oakland-downtown/app-model.html"
    assert oakland["bbox"][0] <= 37.785
    page = (ROOT / "docs/app-regions/oakland-downtown/app-model.html").read_text()
    assert 'name="kerbside-app-mode"' in page
    payload = json.loads((ROOT / "docs/app-regions/oakland-downtown/sf-corridor-3d.json").read_text())
    assert {w["name"] for w in payload["ways"] if w.get("tunnel_design")} == {"Posey Tube", "Webster Street Tube"}


def test_central_freeway_remains_an_elevated_bridge() -> None:
    payload = json.loads((ROOT / "docs/regions/sf-mission/sf-corridor-3d.json").read_text())
    central = [w for w in payload["ways"] if w.get("name") == "Central Freeway"]
    assert len(central) >= 6
    assert all(w.get("bridge") and not w.get("tunnel") for w in central)
    renderer = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "function centralFreewayProfile(way)" in renderer
    assert 'support.userData.provenance = "inferred_visual";' in renderer


def test_unreal_export_ignores_startup_camera_culling() -> None:
    exporter = (ROOT / "tools/unreal/export_tiles.mjs").read_text()
    assert 'if (!o.isMesh || !o.geometry) return;' in exporter
    assert 'o.visible === false' not in exporter
