"""Regions are data; what each can know is found by asking; the ingestion remembers."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from smc.imagery.region import SF_CORRIDOR, BBox, Region, get_region, grid_regions, load_regions
from smc.regions.discover import (
    capability_vector,
    discover,
    lidar_collections,
    municipal_records,
    overpass_counts,
)

ROOT = Path(__file__).resolve().parents[1]


def test_the_registry_has_the_corridor_and_the_bay_area_and_a_grid_cuts_a_box_into_cells():
    regions = load_regions()
    assert SF_CORRIDOR.name in regions and "oakland-downtown" in regions and "sf-mission" in regions
    assert get_region("berkeley-downtown").bbox.area_km2 > 1
    cells = grid_regions(BBox(south=37.70, west=-122.52, north=37.83, east=-122.35), 2.5, "sf")
    assert 30 <= len(cells) <= 40 and cells[0].name == "sf-0-0"
    # The cells tile the box: every corner of the box is in exactly one cell.
    inside = [c for c in cells if c.bbox.contains(37.75, -122.45)]
    assert len(inside) == 1


def fake_fetch(url: str, **_) -> bytes:
    if "overpass" in url:
        return json.dumps({"elements": [{"type": "count", "tags": {"ways": "4295", "total": "4295"}},
                                        {"type": "count", "tags": {"ways": "3000", "relations": "96", "total": "3096"}}]}).encode()
    if "entwine" in url:
        return json.dumps({"features": [
            {"properties": {"name": "CA_AlamedaCo_2_2021", "count": 10}, "geometry": {"type": "Polygon",
             "coordinates": [[[-122.4, 37.7], [-122.1, 37.7], [-122.1, 37.9], [-122.4, 37.9], [-122.4, 37.7]]]}},
            {"properties": {"name": "USGS_LPC_CA_NoCAL_Wildfires_B5b_2018"}, "geometry": {"type": "Polygon",
             "coordinates": [[[-123, 37], [-121, 37], [-121, 39], [-123, 39], [-123, 37]]]}},
            {"properties": {"name": "CA_SanFrancisco_1_B23"}, "geometry": {"type": "Polygon",
             "coordinates": [[[-122.55, 37.7], [-122.35, 37.7], [-122.35, 37.84], [-122.55, 37.84], [-122.55, 37.7]]]}},
        ]}).encode()
    if "mapillary" in url:
        return json.dumps({"data": [{"id": str(i)} for i in range(120)]}).encode()
    if "panoramax" in url:
        return json.dumps({"features": []}).encode()
    raise AssertionError(url)


def test_discovery_finds_the_lidar_over_oakland_and_no_municipal_records_there(monkeypatch):
    monkeypatch.setenv("MAPILLARY_TOKEN", "test")
    oakland = get_region("oakland-downtown")
    assert overpass_counts(oakland.bbox, fake_fetch) == {"highway_ways": 4295, "buildings": 3096}
    collections = lidar_collections(oakland.bbox, fetch=fake_fetch)
    assert [c["dataset"] for c in collections][:2] == ["CA_AlamedaCo_2_2021", "USGS_LPC_CA_NoCAL_Wildfires_B5b_2018"]
    assert collections[0]["coverage"] == 1.0
    assert municipal_records(oakland.bbox)["city"] is None
    caps = discover(oakland, fetch=fake_fetch)
    assert caps.vector["kerbs"] == "lidar" and caps.vector["parking"] == "imagery" and caps.vector["terrain"] == "lidar"
    assert caps.imagery["mapillary"]["images_seen"] == 120 and not caps.errors


def test_san_francisco_regions_get_the_citys_records_and_the_top_rung(monkeypatch):
    monkeypatch.setenv("MAPILLARY_TOKEN", "test")
    mission = get_region("sf-mission")
    records = municipal_records(mission.bbox)
    assert records["city"] == "san-francisco" and "curb_lines" in records["records"]
    caps = discover(mission, fetch=fake_fetch)
    assert caps.vector["kerbs"] == "official" and caps.vector["curb_ramps"] == "official"
    assert caps.lidar["collections"][0]["dataset"] == "CA_SanFrancisco_1_B23"


def test_a_region_with_nothing_builds_to_the_bottom_rungs_and_says_so():
    vector = capability_vector({"highway_ways": 0, "buildings": 0}, [], {}, {"records": []})
    assert vector == {"kerbs": "none", "sidewalk_width": "osm", "kerb_height": "none", "terrain": "none",
                      "buildings": "overture", "building_height": "osm", "building_colour": "none",
                      "parking": "none", "curb_ramps": "osm", "signs": "osm", "crossings": "osm",
                      "lanes": "osm+priors", "streets": "none"}


def test_the_ingestion_journals_every_stage_and_resumes(tmp_path: Path, monkeypatch):
    """A stage that fails stops the run and is recorded; a stage that finished is skipped on
    the next run; --dry-run prints the plan and touches nothing."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import ingest_region

    region = Region(name="test-cell", bbox=BBox(south=37.79, west=-122.29, north=37.81, east=-122.26), description="a test")
    monkeypatch.setattr(ingest_region, "ROOT", tmp_path)
    (tmp_path / "data" / "regions").mkdir(parents=True)

    def commands(_region):
        base = tmp_path / "data" / "regions" / _region.name
        return {
            "discover": ([sys.executable, "-c", f"open({str(base / 'capabilities.json')!r}, 'w').write('{{}}')"], [base / "capabilities.json"]),
            "osm": ([sys.executable, "-c", "import sys; sys.exit(3)"], [base / "osm_ways.json"]),
            "terrain": ([sys.executable, "-c", "pass"], []),
            "imagery": ([sys.executable, "-c", "pass"], []),
            "official": ([sys.executable, "-c", "pass"], []),
            "build": ([sys.executable, "-c", "pass"], []),
            "audit": ([sys.executable, "-c", "pass"], []),
        }

    monkeypatch.setattr(ingest_region, "stage_commands", commands)
    (tmp_path / "data" / "regions" / region.name).mkdir(parents=True)
    ok = ingest_region.ingest(region, ["discover", "osm", "terrain"])
    assert not ok
    journal = json.loads((tmp_path / "data" / "regions" / region.name / "ingest.json").read_text())
    assert journal["stages"]["discover"]["status"] == "done"
    assert journal["stages"]["osm"]["status"] == "failed" and journal["stages"]["osm"]["exit_code"] == 3
    assert "terrain" not in journal["stages"]
    # Second run: discover is skipped, osm fails again, nothing else runs.
    assert not ingest_region.ingest(region, ["discover", "osm"])
    assert ingest_region.ingest(region, ["discover"], dry_run=True)
    assert (tmp_path / "data" / "regions" / region.name / "ingest.log").exists()


def test_the_orchestrator_plans_every_stage_for_a_named_region():
    out = subprocess.run([sys.executable, str(ROOT / "scripts" / "ingest_region.py"), "oakland-downtown", "--dry-run"],
                         cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    for stage in ("discover", "osm", "terrain", "imagery", "official", "build", "audit"):
        assert stage in out.stdout
    assert "--region oakland-downtown" in out.stdout
