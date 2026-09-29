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
    # Coverage is by the outline, not its bounding box: an L-shaped collection whose box
    # holds the region but whose outline does not gets none of it.
    from smc.regions.discover import polygon_coverage
    ell = [[[-122.4, 37.7], [-122.1, 37.7], [-122.1, 37.75], [-122.30, 37.75], [-122.30, 37.9], [-122.4, 37.9], [-122.4, 37.7]]]
    assert polygon_coverage(ell, oakland.bbox) == 0.0
    assert polygon_coverage(ell, BBox(south=37.71, west=-122.39, north=37.74, east=-122.30)) == 1.0
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
    out = subprocess.run([sys.executable, str(ROOT / "scripts" / "ingest_region.py"), "oakland-downtown", "--dry-run", "--force"],
                         cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    for stage in ("discover", "osm", "terrain", "imagery", "official", "build", "audit"):
        assert stage in out.stdout
    assert "--region oakland-downtown" in out.stdout
    assert "reconstruct" not in out.stdout


def test_reconstruction_is_journalled_but_opt_in():
    sys.path.insert(0, str(ROOT / "scripts"))
    import ingest_region

    assert ingest_region.STAGES.index("build") < ingest_region.STAGES.index("reconstruct")
    assert ingest_region.STAGES.index("reconstruct") < ingest_region.STAGES.index("audit")
    assert "reconstruct" not in ingest_region.DEFAULT_STAGES
    command, outputs = ingest_region.stage_commands(SF_CORRIDOR)["reconstruct"]
    assert command[1:3] == ["scripts/build_surface_fusion.py", "--region"]
    assert outputs[0].name == "cell.json"


def test_activation_counts_what_the_build_stood_on_not_what_discovery_promised():
    """Available is discovery's word; active is counted from the payload. A region with lidar
    over it and no lidar stations in its cross-sections is not truthful on kerbs."""
    from smc.regions.activation import activation

    xs_lidar = [[2.0, 6.0, -6.0, "L", "r", [["t", 3.3, "N", 0.6, 1, None]], []]]
    xs_prior = [[2.0, 6.0, -6.0, "N", "r", [["p", 2.3, "I", 0.9, 0, "parallel"]], []]]
    payload = {"ways": [
        {"kind": "street", "xs": xs_lidar, "kerb_m": 0.12, "kerb_source": "lidar_region"},
        {"kind": "street", "xs": xs_prior},
        {"kind": "building", "height_source": "lidar_region", "colour": "#aaaaaa"},
        {"kind": "building", "height_source": "inferred_default"},
        {"kind": "crossing"},
    ], "summary": {"terrain": {"roadway_rmse_m": 0.04}}}
    vector = {"kerbs": "lidar", "kerb_height": "lidar", "building_height": "lidar", "building_colour": "imagery",
              "terrain": "lidar", "parking": "imagery", "curb_ramps": "osm", "lanes": "osm+priors"}
    act = activation(payload, vector)
    assert act["kerbs"] == {**act["kerbs"], "available": "lidar", "active": "lidar", "count": 1, "of": 2, "truthful": True}
    assert act["building_height"]["count"] == 1 and act["building_height"]["of"] == 2 and act["building_height"]["truthful"]
    assert act["parking"]["count"] == 1 and act["parking"]["active"] == "imagery"
    assert act["curb_ramps"]["active"] == "none" and act["curb_ramps"]["truthful"] is False
    # The same region before its lidar pass: kerbs available but nothing active, and said so.
    bare = activation({"ways": [{"kind": "street", "xs": xs_prior}], "summary": {}}, vector)
    assert bare["kerbs"]["active"] == "none" and bare["kerbs"]["truthful"] is False
    assert bare["terrain"]["active"] == "none"


def test_a_stage_is_stale_when_what_it_reads_has_been_rebuilt_under_it(tmp_path):
    """The journal records what was run; the disk records what is there. They part company.

    sf-haight-castro's map was re-fetched directly -- scripts/fetch_region_osm.py rather than
    the ingestion -- after an Overpass outage had left every one of its streets without an id.
    The journal still said "lidar: done" from a flight six days earlier, so the next run
    skipped the measurement, called the region finished and published a page built from a map
    the lidar had never read. Nothing had failed. Nothing had compared the dates.
    """
    sys.path.insert(0, str(ROOT / "scripts"))
    import importlib

    ingest_region = importlib.import_module("ingest_region")

    osm = tmp_path / "osm_ways.json"
    heights = tmp_path / "building_heights.json"
    commands = {
        "discover": ([], [tmp_path / "capabilities.json"]),
        "osm": ([], [osm]),
        "lidar": ([], [heights]),
    }
    heights.write_text("{}")
    osm.write_text("{}")
    import os
    import time

    # The map older than the measurement: nothing to redo.
    old = time.time() - 3600
    os.utime(osm, (old, old))
    assert ingest_region.overtaken_by_inputs("lidar", commands) is None

    # The map re-fetched since: the measurement read a map that is no longer there.
    now = time.time()
    os.utime(osm, (now, now))
    assert ingest_region.overtaken_by_inputs("lidar", commands) == "osm"


def test_discovery_being_rewritten_does_not_make_the_terrain_stale(tmp_path):
    """Every page build rewrites the capability record, and the terrain takes 27 minutes.

    Discovery says what a region could have, not what it holds, so it is not a dependency
    anything is redone for.
    """
    sys.path.insert(0, str(ROOT / "scripts"))
    import importlib
    import os
    import time

    ingest_region = importlib.import_module("ingest_region")
    caps = tmp_path / "capabilities.json"
    grid = tmp_path / "terrain.bin"
    grid.write_text("x")
    caps.write_text("{}")
    now = time.time()
    os.utime(caps, (now, now))
    commands = {"discover": ([], [caps]), "terrain": ([], [grid])}
    assert ingest_region.overtaken_by_inputs("terrain", commands) is None


def test_reading_a_wall_colour_does_not_depend_on_san_franciscos_centrelines():
    """The facade reading lived inside the function that joins the city's own geometry.

    ``annotate_official`` returns early for a region with no San Francisco centreline records,
    and the building colours and facade fingerprints were applied after that point -- so every
    region outside the city skipped them. 633 colours read for Oakland, 832 for San Jose, 311
    for Berkeley and 319 for Palo Alto sat in files beside pages that drew every wall from its
    archetype and reported ``building_colour: none``. Reading a colour off a photograph needs
    the sampled file and an osm_id; it has nothing to do with a centreline.
    """
    import importlib
    import inspect

    sys.path.insert(0, str(ROOT / "scripts"))
    builder = importlib.import_module("build_sf_corridor_3d")
    assert hasattr(builder, "annotate_facades"), "the facade reading has no function of its own"
    official = inspect.getsource(builder.annotate_official)
    assert "colour from a photograph" not in official, (
        "the facade reading is back inside the centreline-gated function")
    facades = inspect.getsource(builder.annotate_facades)
    assert "segments.json" not in facades and "centrelines.json" not in facades
    # And it is called whatever the region.
    source = inspect.getsource(builder)
    assert "annotate_facades(ways)" in source


def test_a_stage_is_not_finished_while_its_own_journal_still_has_work(tmp_path, monkeypatch):
    """"Done" and "finished" are not the same thing.

    The lidar measures each cell once per run and leaves the rest for the next, so its command
    exits 0 with every output written while cells it could not read are still marked to be
    tried again. The stage journal recorded that as done, and after the Haight-Castro pass it
    said done with twenty-one of two hundred and forty-four cells never read -- and every
    later run skipped the stage.
    """
    sys.path.insert(0, str(ROOT / "scripts"))
    import importlib

    ingest_region = importlib.import_module("ingest_region")

    class FakeRegion:
        name = "test-region"

    base = tmp_path / "test-region"
    (base / "lidar").mkdir(parents=True)
    monkeypatch.setattr(ingest_region, "region_dir", lambda r: base)

    cells = base / "lidar" / "cells.jsonl"
    rows = [
        {"cell": "0:0", "streets": {}, "buildings": {}},
        {"cell": "0:1", "streets": {}, "buildings": {}},
        # read, then lost to the network and marked to come round again
        {"cell": "0:2", "streets": {}, "buildings": {}},
        {"cell": "0:2", "error": "nodename nor servname", "retry": True},
    ]
    cells.write_text("".join(json.dumps(r) + "\n" for r in rows))
    assert ingest_region.work_outstanding(FakeRegion, "lidar") == 1

    # Once it is read, nothing is outstanding.
    cells.write_text(cells.read_text() + json.dumps({"cell": "0:2", "streets": {}, "buildings": {}}) + "\n")
    assert ingest_region.work_outstanding(FakeRegion, "lidar") == 0

    # And no other stage keeps an inner journal, so none of them claims work.
    assert ingest_region.work_outstanding(FakeRegion, "build") == 0


def test_a_stage_is_stale_when_the_region_itself_has_been_redrawn(tmp_path):
    """The journal records the box a run was made under, and nothing compared it.

    Oakland's south edge was taken from 37.795 to 37.785 to bring in the Posey and Webster
    tube approaches. The map was never asked again, so the strip between the two latitudes --
    the whole Alameda side -- arrived with one street and no buildings at all, and the tube
    portal stood in an empty field with its road tapering away to nothing. Every stage reported
    done, because every stage was done for a region that no longer existed.
    """
    sys.path.insert(0, str(ROOT / "scripts"))
    import importlib

    ingest_region = importlib.import_module("ingest_region")

    class Box:
        def __init__(self, s, w, n, e):
            self.south, self.west, self.north, self.east = s, w, n, e

    class FakeRegion:
        name = "test-region"
        bbox = Box(37.785, -122.285, 37.815, -122.26)

    # The box it ran under, and the box it is now: grown southward.
    assert ingest_region.bbox_changed(
        FakeRegion, {"bbox": [37.795, -122.285, 37.815, -122.26]}
    ) == "the region has grown since this ran"
    # Unchanged is unchanged.
    assert ingest_region.bbox_changed(
        FakeRegion, {"bbox": [37.785, -122.285, 37.815, -122.26]}
    ) == ""
    # A box that moved without growing still invalidates what was fetched for the old one.
    assert "moved" in ingest_region.bbox_changed(
        FakeRegion, {"bbox": [37.780, -122.290, 37.820, -122.255]}
    )
    # A journal with no box recorded cannot be judged, and is not guessed at.
    assert ingest_region.bbox_changed(FakeRegion, {}) == ""
    # Only the stages whose answer the box bounds.
    assert "osm" in ingest_region.BOUNDED_BY_BBOX
    assert "lidar" in ingest_region.BOUNDED_BY_BBOX
    assert "build" not in ingest_region.BOUNDED_BY_BBOX
