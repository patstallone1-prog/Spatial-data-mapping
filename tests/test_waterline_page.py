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


def test_the_page_reads_the_measured_water_surface_and_draws_the_sea_from_it():
    source = _source()
    # The surface is read from the grid's metadata, not assumed; everything else follows it.
    assert "TERRAIN.meta.waterline.surface_m" in source
    assert "const WATERLINE_M = SEA_SURFACE_M + " in source
    assert "const SEA_Y = SEA_SURFACE_M + " in source
    assert "const BAY_Y = SEA_Y - " in source and "const WATER_Y = SEA_Y + " in source
    # The land plate stands above the water, so the apron never reads as sea over dry land.
    assert "const PENINSULA_Y = WATERLINE_M + " in source
    # Over open water with no returns the ground is the sea's, not zero.
    assert "if (!good.length) return OPEN_WATER_GROUND_M;" in source
    # The backdrop paints sea at or under the waterline and land above it.
    assert "if (wet === true || (wet === null && edge < WATERLINE_M)) return { y: SEA_Y - 0.02, colour: TERRAIN_SEA };" in source
    # The builder runs the waterline pass on the grid before the page reads it.
    assert "apply_waterline(terrain_bin, closed_water, coastlines)" in source
    # Coastline ways reach the payload for the pass, and are not drawn as anything.
    assert '"kind": "coastline"' in source
    assert 'way.kind === "coastline") continue;' in source


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


def test_a_separate_cycle_track_is_fetched_drawn_and_joined():
    """A road tagged cycleway=separate has its track as a highway=cycleway way of its own. Not
    fetched, 2nd Street's green stopped at every such block; fetched, it is drawn as a track
    and the road's lanes ease onto it."""
    source = _source()
    assert "footway|pedestrian|steps|path|cycleway)$" in source          # the query fetches them
    assert 'elif highway == "cycleway":' in source and 'kind = "cycleway"' in source
    assert 'if (way.kind === "cycleway") {' in source
    assert 'addMerged("bike:fill", fill, "bike");' in source
    assert 'if (way.kind === "cycleway" && way.points && way.points.length >= 2) {' in source  # join index


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


def test_the_page_draws_the_perimeter_and_the_bridges_and_the_backdrop_faces_up():
    source = _source()
    # The five-mile country: fetched with the rest, drawn as tiles, the apron classified by it.
    assert 'fetch(asset("sf-corridor-perimeter.json")' in source
    assert "function perimeterWaterAt(x, z)" in source
    assert "const wet = apron > 0 ? perimeterWaterAt(x, z) : null;" in source
    assert 'tile.userData.surface = "perimeter";' in source
    # Bridges: the map's ways whole, at clearance over water, down to the ground by the grade.
    assert "PERIMETER_BRIDGE_CLEARANCE_M" in source and 'deck.userData.surface = "bridge";' in source
    # The backdrop is wound to face up whichever way its rows run, and drawn double-sided: wound
    # the other way it was invisible from above and the bay showed through every gap.
    assert "const up = (zs[Math.min(1, h - 1)] - zs[0]) < 0;" in source
    assert "side: THREE.DoubleSide });" in source.split("const TERRAIN_MATERIAL")[1].split("\n")[0]
    # Ground cover is clipped to the region's box before it is lifted.
    assert "function clipRingToBox(ring)" in source and "const ring = clipRingToBox(raw);" in source
    # A station under the street is a record, not a slab over the junction.
    assert "if (feature.underground) return null;" in source
    assert 'tags.get("location") == "underground"' in source


@pytest.mark.skipif(not PAYLOAD.exists(), reason="no built corridor")
def test_the_built_corridor_keeps_underground_stations_and_the_corners():
    payload = json.loads(PAYLOAD.read_text())
    underground = [w for w in payload["ways"] if w.get("kind") == "building" and w.get("underground")]
    assert any("Montgomery" in (w.get("name") or "") for w in underground), [w.get("name") for w in underground]
    perimeter = ROOT / "docs" / "sf-corridor-perimeter.json"
    assert perimeter.exists()
    p = json.loads(perimeter.read_text())
    assert p["frame"]["cols"] > 400 and 0.4 < p["counts"]["cells_water"] / p["counts"]["cells"] < 0.75
    spans = [b for b in p["bridges"] if sum(b["over_water"]) >= 20]
    names = {b["name"] for b in spans}
    assert any("Golden Gate" in (n or "") for n in names) and any("Eisenhower" in (n or "") for n in names), names
