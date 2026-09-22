"""The page draws the sea where the grid says water, and stands nothing on it -- and the
built grid's waterline agrees with the map's water. Guards against the shoreline regressing."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "docs" / "sf-corridor-3d.html"
GRID = ROOT / "docs" / "sf-corridor-terrain.bin"
PAYLOAD = ROOT / "docs" / "sf-corridor-3d.json"


def _source() -> str:
    return (ROOT / "scripts" / "build_sf_corridor_3d.py").read_text()


@pytest.mark.skipif(not (GRID.exists() and PAYLOAD.exists()), reason="no built corridor")
def test_the_built_grid_is_water_under_the_maps_water_and_land_under_its_buildings():
    meta = json.loads(GRID.with_suffix(".json").read_text())
    frame = meta["frame"]
    record = meta.get("waterline") or {}
    assert record.get("surface_m") is not None, "the waterline pass has not run on this grid"
    surface = record["surface_m"]
    cm = np.frombuffer(GRID.read_bytes(), dtype=np.int16).reshape(frame["rows"], frame["cols"])
    height = np.where(cm == frame["nodata"], np.nan, frame["base_m"] + cm / 100.0)
    payload = json.loads(PAYLOAD.read_text())
    kx, ky, step = frame["metres_per_lon"], frame["metres_per_lat"], frame["step_m"]

    def cell(lon, lat):
        r = int(((lat - frame["mid_lat"]) * ky - frame["y0"]) / step)
        c = int(((lon - frame["mid_lon"]) * kx - frame["x0"]) / step)
        return (r, c) if 0 <= r < frame["rows"] and 0 <= c < frame["cols"] else None

    # Every building's centroid stands on ground above the waterline: no water under a house.
    # Piers are buildings over water; their decks are above the waterline too.
    wet_buildings = 0
    buildings = 0
    for way in payload["ways"]:
        if way.get("kind") != "building" or not way.get("centroid"):
            continue
        at = cell(*way["centroid"])
        if at is None:
            continue
        h = height[at]
        if np.isnan(h):
            continue
        buildings += 1
        if h < surface + 0.45:
            wet_buildings += 1
    assert buildings > 10_000
    assert wet_buildings / buildings < 0.002, f"{wet_buildings} of {buildings} buildings stand on water"
    # And the water is there: the grid has a body of cells at the surface.
    at_surface = np.isfinite(height) & (np.abs(height - surface) < 0.05)
    assert at_surface.sum() > 100_000


def test_regions_are_published_beside_the_corridor_with_an_index(tmp_path: Path):
    """Every built region is copied to regions/<name>/ and listed; the page's switcher and the
    landing page read regions.json. A deploy that dropped them would fail here."""
    import importlib.util
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    spec = importlib.util.spec_from_file_location("build_pages", ROOT / "tools" / "build_pages.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    index = module.publish_regions(tmp_path)
    names = [r["name"] for r in index]
    assert names[0] == "sf-corridor" and "oakland-downtown" in names
    built = [r for r in index if r["built"] and r["name"] != "sf-corridor"]
    for record in built:
        page = tmp_path / record["path"]
        assert page.exists(), record["path"]
        assert (page.parent / "sf-corridor-3d.json").exists()
        assert 'content="../../regions.json"' in page.read_text()
    listed = json.loads((tmp_path / "regions.json").read_text())["regions"]
    assert len(listed) == len(index)
    # The page and the landing template both read the index.
    assert 'name="kerbside-regions"' in _source()
    assert 'fetch("regions.json"' in (ROOT / "tools" / "landing_template.html").read_text()


@pytest.mark.skipif(not PAYLOAD.exists(), reason="no built corridor")
def test_the_built_corridor_carries_the_separate_tracks():
    payload = json.loads(PAYLOAD.read_text())
    tracks = [w for w in payload["ways"] if w.get("kind") == "cycleway"]
    separate = [w for w in payload["ways"] if w.get("kind") == "street" and w.get("cycleway") == "separate"]
    assert len(tracks) >= 20, len(tracks)
    # Every street whose track is mapped separately has a track within 40 m of its midpoint.
    import math
    missing = 0
    for street in separate:
        mid = street["points"][len(street["points"]) // 2]
        near = any(math.hypot((p[0] - mid[0]) * 88_000, (p[1] - mid[1]) * 111_320) < 40
                   for t in tracks for p in t["points"])
        missing += 0 if near else 1
    assert missing <= len(separate) // 4, f"{missing} of {len(separate)} separate-cycleway streets have no track nearby"


@pytest.mark.skipif(not PAYLOAD.exists(), reason="no built corridor")
def test_the_built_corridor_keeps_underground_stations_and_the_corners():
    payload = json.loads(PAYLOAD.read_text())
    underground = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("underground")]
    assert any("Montgomery" in (w.get("name") or "") for w in underground), [w.get("name") for w in underground]
    perimeter = ROOT / "docs" / "sf-corridor-perimeter.json"
    assert perimeter.exists()
    p = json.loads(perimeter.read_text())
    # The atlas: five miles round every built region, SF to San Jose, a fifth to a half water.
    assert p["frame"]["cols"] > 1500 and p["frame"]["rows"] > 1500 and len(p["regions"]) >= 8
    assert 0.2 < p["counts"]["cells_water"] / p["counts"]["cells"] < 0.5
    assert len(p["runs"]) == p["frame"]["rows"] and all(sum(r) == p["frame"]["cols"] for r in p["runs"])
    spans = [b for b in p["bridges"] if sum(b["over_water"]) >= 20]
    names = {b["name"] for b in spans}
    for bridge in ("Golden Gate", "Eisenhower", "San Mateo", "Dumbarton", "Richmond"):
        assert any(bridge in (n or "") for n in names), (bridge, names)
    # Every built region's site carries the same file.
    for name in p["regions"]:
        if name == "sf-corridor":
            continue
        assert (ROOT / "data" / "regions" / name / "site" / "sf-corridor-perimeter.json").exists(), name
