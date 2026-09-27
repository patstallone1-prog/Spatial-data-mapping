#!/usr/bin/env python3
"""Ingest a region end to end: discover, fetch, measure, build, audit -- and remember.

    python scripts/ingest_region.py oakland-downtown
    python scripts/ingest_region.py sf-mission --stages discover,osm,terrain
    python scripts/ingest_region.py --grid 37.70,-122.52,37.83,-122.35 --cell-km 2.5 --prefix sf
    python scripts/ingest_region.py --all

The corridor was built by running a dozen scripts by hand in an order only the person who
wrote them knew. This is that order, as code, for any region in data/regions/regions.json
(or a grid of cells over a box), with a journal under data/regions/<name>/ingest.json that
records every stage's start, end, result and the command that ran it, so a run that stops
resumes at the stage that did not finish and a person can read what a region is built from.

Stages, in order, each skipped when its journal entry is done and its output is present:

  discover   probe the sources; write capabilities.json (scripts/discover_region.py)
  osm        fetch OpenStreetMap for the box (the builder's own fetch, with its sanity guard)
  terrain    the lidar ground grid from the collection discovery found (scripts/build_terrain.py)
  lidar      kerb offsets and heights along every street and a roof height for every footprint,
             from the same lidar (scripts/measure_region_lidar.py)
  imagery    every observation Mapillary, Panoramax and KartaView hold in the box
             (scripts/harvest_region_observations.py)
  official   municipal records, where the city has them (scripts/build_sf_official_geometry.py)
  build      the page and its sidecars (scripts/build_sf_corridor_3d.py --region)
  audit      the render audit over the region's payload, held to nothing yet: written as the
             region's first baseline (scripts/audit_corridor_render.py)

What a region cannot have it does without: a region outside San Francisco has no municipal
records and the builder drops that rung; a region with no lidar collection builds flat and
says so in its capabilities. Nothing is invented to fill a gap.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import (  # noqa: E402
    SF_CORRIDOR,
    BBox,
    Region,
    get_region,
    grid_regions,
    load_regions,
)
from smc.net import use_certifi  # noqa: E402

use_certifi()

STAGES = ("discover", "osm", "terrain", "lidar", "imagery", "official", "build", "reconstruct", "audit")
# The visual pilot requires licensed aerial images and surveyed truth.  Routine
# region ingestion still finishes when that opt-in stage has no such inputs.
DEFAULT_STAGES = tuple(stage for stage in STAGES if stage != "reconstruct")
PY = sys.executable
#: The imagery harvest of a dense district can run for hours against a throttled service.
#: It gets this long; then it is stopped and the catalogue is built from what the journal
#: holds (--from-journal), the stage recorded as done with "partial" and the frame count.
#: A later run resumes the crawl from the journal.
IMAGERY_BUDGET_S = 90 * 60


def region_dir(region: Region) -> Path:
    return ROOT / "data" / "regions" / region.name


def journal_path(region: Region) -> Path:
    return region_dir(region) / "ingest.json"


def load_journal(region: Region) -> dict:
    path = journal_path(region)
    if path.exists():
        return json.loads(path.read_text())
    return {"region": region.name, "bbox": [region.bbox.south, region.bbox.west, region.bbox.north, region.bbox.east],
            "stages": {}}


def save_journal(region: Region, journal: dict) -> None:
    path = journal_path(region)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(journal, indent=1) + "\n")


def run(cmd: list[str], *, log: Path, budget_s: float | None = None) -> tuple[int, float, bool]:
    """Run one stage's command, its output to a log beside the journal. Returns the exit
    code, the seconds it took, and whether it was stopped at its budget."""
    started = time.time()
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a") as fh:
        fh.write(f"\n$ {' '.join(cmd)}\n")
        fh.flush()
        try:
            code = subprocess.call(cmd, cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT, env=os.environ,
                                   timeout=budget_s)
        except subprocess.TimeoutExpired:
            fh.write(f"\n[stopped at the stage's budget of {budget_s:.0f} s]\n")
            return -1, time.time() - started, True
    return code, time.time() - started, False


def stage_commands(region: Region) -> dict[str, tuple[list[str], list[Path]]]:
    """Each stage's command and the outputs that say it is done."""
    base = region_dir(region)
    corridor = region.name == SF_CORRIDOR.name
    site = ROOT / "docs" if corridor else base / "site"
    catalog = ROOT / "data" / "sf_corridor" if corridor else base / "catalog"
    return {
        "discover": ([PY, "scripts/discover_region.py", region.name], [base / "capabilities.json"]),
        "osm": ([PY, "scripts/fetch_region_osm.py", region.name],
                [base / "osm_ways.json"] if not corridor else [ROOT / "data/sf_corridor/stats/osm_ways.json"]),
        "terrain": ([PY, "scripts/build_terrain.py", "--region", region.name], [site / "sf-corridor-terrain.bin"]),
        # Kerbs and roofs from the lidar. Where a city has curb lines they outrank the lidar's
        # reading of the kerbs, but every region gets a roof height for every footprint.
        "lidar": ([PY, "scripts/measure_region_lidar.py", region.name],
                  [] if corridor else [base / "lidar" / "building_heights.json"]),
        "imagery": ([PY, "scripts/harvest_region_observations.py", "--region", region.name, "--out", str(catalog)],
                    [catalog / "observations" / "external-000.parquet"]),
        "official": ([PY, "scripts/build_sf_official_geometry.py", "--region", region.name],
                     [] if not corridor else [ROOT / "docs/sf-corridor-official.json"]),
        "build": ([PY, "scripts/build_sf_corridor_3d.py", "--region", region.name, "--reuse-osm"],
                  [site / "sf-corridor-3d.json"]),
        "reconstruct": ([PY, "scripts/build_surface_fusion.py", "--region", region.name],
                         [ROOT / "build/visual/pilot/c14r03/cell.json"] if corridor else []),
        "audit": ([PY, "scripts/audit_corridor_render.py", "--page", str(site / "sf-corridor-3d.json"),
                   "--official", str(site / "sf-corridor-official.json"), "--ground", str(site / "sf-corridor-ground.json"),
                   "--baseline", str(base / "audit_baseline.json")], [base / "audit_baseline.json"]),
    }


def produced_nothing(path: Path) -> bool:
    """Whether an output a stage declared is present but holds nothing.

    A stage that exits 0 having measured nothing writes a file of the right shape with no
    facts in it, and every stage after it reads that as an answer. Seven regions carried a
    curb-profile file of exactly this kind -- ``{"grade": "lidar", ..., "profiles": {}}`` --
    beside an empty list of centrelines, because the lidar pass had rejected every street for
    want of an id and had said so only in a count nobody read. Their maps have been drawn from
    class priors ever since, with the measurement sitting on disk as an empty promise.

    JSON only, and only the shape: a list with nothing in it, or an object whose every
    collection is empty. Anything else -- a binary grid, a parquet, a file we cannot parse --
    is judged by its size alone.
    """
    if not path.exists():
        return True
    if path.suffix != ".json":
        return path.stat().st_size == 0
    try:
        body = json.loads(path.read_text())
    except (ValueError, UnicodeDecodeError):
        return path.stat().st_size == 0
    if isinstance(body, list):
        return not body
    if isinstance(body, dict):
        collections = [v for v in body.values() if isinstance(v, (list, dict))]
        return bool(collections) and not any(collections)
    return False


#: A stage's outputs are the next stages' inputs, so finishing one makes everything after it
#: out of date. Without this, running a single stage by hand -- "just re-run the lidar" --
#: leaves the build, and the capability record derived from that build, describing the world
#: as it was before. That is how two San Francisco districts came to report "kerbs: none"
#: while their kerb profiles sat on disk: the lidar ran, nothing downstream was told, and the
#: record has been read ever since as though it were the truth about the region.
#: What each stage actually reads. Order alone is too blunt: re-fetching the map does not
#: invalidate a lidar grid that was flown years ago, and a twenty-seven minute terrain rebuild
#: is too expensive to trigger on a dependency that is not there.
DEPENDS_ON = {
    "discover": (),
    "osm": ("discover",),
    "terrain": ("discover",),
    "lidar": ("discover", "osm"),
    "imagery": ("discover",),
    "official": ("osm",),
    "build": ("osm", "terrain", "lidar", "imagery", "official"),
    "reconstruct": ("build",),
    "audit": ("build",),
}


def invalidate_downstream(journal: dict, stage: str) -> list[str]:
    """Mark every stage that reads ``stage``'s outputs stale, and say which ones were."""
    after = [name for name in STAGES if stage in DEPENDS_ON.get(name, ())]
    # A stage made stale makes its own readers stale in turn.
    spreading = True
    while spreading:
        spreading = False
        for name in STAGES:
            if name in after:
                continue
            if any(dep in after for dep in DEPENDS_ON.get(name, ())):
                after.append(name)
                spreading = True
    stale = []
    for later in after:
        entry = journal["stages"].get(later)
        if entry and entry.get("status") == "done":
            entry["status"] = "stale"
            entry["stale_because"] = stage
            stale.append(later)
    return stale


def mark_interrupted(region: Region, journal: dict) -> list[str]:
    """A stage left "running" by a process that is no longer here is not running.

    Nothing distinguished a live stage from one whose process died, so an interrupted run
    read as an in-flight one for as long as anybody cared to look. It is recorded as
    interrupted, with when it was last seen, and it will be run again.
    """
    interrupted = []
    for name, entry in journal.get("stages", {}).items():
        if entry.get("status") == "running":
            entry["status"] = "interrupted"
            entry["interrupted_noticed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            interrupted.append(name)
    if interrupted:
        save_journal(region, journal)
    return interrupted


#: What each capability is made of: if the file is there and the record still says "none",
#: the record is behind the region rather than the region behind the record.
CAPABILITY_ARTEFACTS = {
    "kerbs": ("official/curb_profiles_corridor.json", "official/curb_profiles_lidar.json"),
    "kerb_height": ("lidar/kerb_heights.json",),
    "building_height": ("lidar/building_heights.json",),
    "building_colour": ("official/building_colours.json",),
    "curb_ramps": ("official/curb_ramps.json",),
    "terrain": ("site/sf-corridor-terrain.bin",),
}


def status(region: Region) -> bool:
    """What this region's journal and capability record say, against what is on disk.

    A record is only worth reading if something checks it. These two have disagreed for
    months: a stage interrupted and never noticed, and a capability recorded before the
    artefact that would have changed it. Returns False when they disagree.
    """
    base = region_dir(region)
    journal = load_journal(region)
    stages = journal.get("stages", {})
    print(f"{region.name}")
    unhappy = [n for n, e in stages.items() if e.get("status") not in ("done", None)]
    line = ", ".join(f"{n}={e.get('status')}" for n, e in stages.items())
    print(f"  stages   {line or 'never run'}")
    caps_path = base / "capabilities.json"
    if not caps_path.exists():
        print("  record   none: discovery has not run")
        return False
    caps = json.loads(caps_path.read_text())
    activation = caps.get("activation") or {}
    behind = []
    for prop, files in CAPABILITY_ARTEFACTS.items():
        present = [f for f in files if not produced_nothing(base / f)]
        hollow = [f for f in files if (base / f).exists() and produced_nothing(base / f)]
        active = (activation.get(prop) or {}).get("active", "none")
        if present and active in (None, "none"):
            behind.append(f"{prop} says none but {present[0]} is here")
        elif hollow and active in (None, "none"):
            behind.append(f"{prop}: {hollow[0]} is here but holds nothing -- the stage that "
                          "wrote it measured nothing and said so only in a count")
    for prop, row in sorted(activation.items()):
        print(f"  {prop:16s} available={row.get('available'):8s} active={str(row.get('active')):8s}"
              f" {row.get('count', 0)}/{row.get('of', 0)}")
    for note in behind:
        print(f"  BEHIND   {note}")
    if unhappy:
        print(f"  UNFINISHED {', '.join(unhappy)}")
    return not behind and not unhappy


def ingest(region: Region, stages: list[str], *, force: bool = False, dry_run: bool = False) -> bool:
    journal = load_journal(region)
    commands = stage_commands(region)
    log = region_dir(region) / "ingest.log"
    ok = True
    for name in mark_interrupted(region, journal):
        print(f"  {name:9s} was left running by a process that is gone; recorded interrupted")
    for stage in STAGES:
        if stage not in stages:
            continue
        cmd, outputs = commands[stage]
        entry = journal["stages"].get(stage, {})
        if not force and entry.get("status") == "done" and all(p.exists() for p in outputs):
            print(f"  {stage:9s} done already ({entry.get('finished_at', '')})")
            continue
        print(f"  {stage:9s} running: {' '.join(cmd[1:])}")
        if dry_run:
            continue
        journal["stages"][stage] = {"status": "running", "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                    "command": cmd[1:]}
        save_journal(region, journal)
        budget = IMAGERY_BUDGET_S if stage == "imagery" else None
        code, seconds, stopped = run(cmd, log=log, budget_s=budget)
        partial = None
        if stopped and stage == "imagery":
            # What the crawl journalled is the catalogue for now; the crawl resumes another day.
            finish = [*cmd, "--from-journal"]
            code, more, _ = run(finish, log=log)
            seconds += more
            partial = "stopped at budget; catalogue built from the journal"
        present = all(p.exists() for p in outputs)
        hollow = [p for p in outputs if p.exists() and produced_nothing(p)]
        status = "done" if code == 0 and present and not hollow else "failed"
        if hollow:
            print(f"  {stage:9s} exited 0 but measured nothing: "
                  + ", ".join(str(p.relative_to(ROOT)) for p in hollow))
        journal["stages"][stage].update({"status": status, "exit_code": code, "seconds": round(seconds, 1),
                                         "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                         "outputs": [str(p.relative_to(ROOT)) for p in outputs if p.exists()],
                                         **({"produced_nothing": [str(p.relative_to(ROOT)) for p in hollow]} if hollow else {}),
                                         **({"partial": partial} if partial else {})})
        if status == "done":
            stale = invalidate_downstream(journal, stage)
            if stale:
                print(f"  {stage:9s} makes {', '.join(stale)} stale")
        save_journal(region, journal)
        print(f"  {stage:9s} {status} in {seconds:.0f} s" + ("" if status == "done" else f" (exit {code}; see {log})"))
        if status == "failed":
            ok = False
            break
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("region", nargs="*", help="region names; --all for every region in the registry")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--grid", help="south,west,north,east: ingest a grid of cells over this box")
    ap.add_argument("--cell-km", type=float, default=2.5)
    ap.add_argument("--prefix", default="cell")
    ap.add_argument("--stages", default=",".join(DEFAULT_STAGES),
                    help="comma-separated subset, in order; reconstruct is an opt-in pilot stage")
    ap.add_argument("--force", action="store_true", help="run stages that are already done")
    ap.add_argument("--dry-run", action="store_true", help="print what would run")
    ap.add_argument("--status", action="store_true",
                    help="report each region's stages and capabilities against what is on disk")
    args = ap.parse_args()

    stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    unknown = [s for s in stages if s not in STAGES]
    if unknown:
        ap.error(f"unknown stages {unknown}; the stages are {', '.join(STAGES)}")

    regions: list[Region] = []
    if args.grid:
        south, west, north, east = (float(v) for v in args.grid.split(","))
        regions = grid_regions(BBox(south=south, west=west, north=north, east=east), args.cell_km, args.prefix)
        registry = ROOT / "data" / "regions" / "regions.json"
        table = json.loads(registry.read_text())
        known = {r["name"] for r in table["regions"]}
        for cell in regions:
            if cell.name not in known:
                table["regions"].append({"name": cell.name, "bbox": [cell.bbox.south, cell.bbox.west, cell.bbox.north, cell.bbox.east],
                                         "city": args.prefix, "description": cell.description})
        registry.write_text(json.dumps(table, indent=1) + "\n")
        print(f"{len(regions)} cells of {args.cell_km} km over the box, registered as {args.prefix}-<col>-<row>")
    elif args.all:
        regions = [r for name, r in sorted(load_regions().items()) if name != SF_CORRIDOR.name]
    else:
        if not args.region:
            ap.error("a region name, --all or --grid is needed")
        regions = [get_region(name) for name in args.region]

    failed = []
    if args.status:
        disagreed = [r.name for r in regions if not status(r)]
        if disagreed:
            print(f"\nbehind or unfinished: {', '.join(disagreed)}", file=sys.stderr)
            return 1
        return 0
    for region in regions:
        print(f"{region.name}: {region.description} ({region.bbox.area_km2:.1f} km2)")
        if not ingest(region, stages, force=args.force, dry_run=args.dry_run):
            failed.append(region.name)
    if failed:
        print(f"failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
