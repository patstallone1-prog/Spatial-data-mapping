#!/usr/bin/env python3
"""Carry chosen gap areas through every stage, cell by cell, beside the breadth-first intake.

``run_gap_intake.py`` takes all 337 planned cells a stage at a time -- discovery and streets for
every one, then an hour of terrain for each, then the lidar -- so a single area reaches its lidar
only after weeks. This takes the cells of the areas named (``--areas sf-central-gap,sf-south-gap``)
one at a time through every stage the region ingester has (streets, terrain, lidar, imagery,
official, build, audit), so whole areas come out finished, in the order the areas are named.

It shares the cells' journals with the intake (both checkouts link ``data/regions/<cell>`` to the
same folder on the external drive), and the ingester skips a stage its journal records done, so
the intake passes over whatever this has finished. Two processes must never work one cell at once
(the second would mark the first's stage interrupted and run it again over it), so:

* within an area, cells are taken in the reverse of the intake's order, so the two meet once;
* a cell the intake is on, or is about to start, is left for later;
* a stage that fails three times running rests two hours before the next try;
* if the intake starts the cell this is working on anyway, this one stops its own stage and
  returns to it afterwards.

Like the intake it pauses on battery at or under 30 % and when the drive is missing or under
8 GB free, and when the Mac's own disk is under 1.5 GB free. It publishes nothing: building a
cell's page is not promoting it to the site.

    .venv/bin/python scripts/run_gap_focus.py --areas sf-central-gap,sf-south-gap \\
        --volume "/Volumes/HP P700 1" --volume-uuid 65DF9122-13CE-4515-8C1A-73F608AB4171
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))
from run_gap_intake import interleaved, schedule  # noqa: E402

from smc.imagery.streetview_reference import atomic_json  # noqa: E402
from smc.storage.external_volume import volume_ready  # noqa: E402

STAGES = ("osm", "terrain", "lidar", "imagery", "official", "build", "audit")
INTAKE_STAGES = ("discover", "osm", "terrain", "lidar")
#: The intake's status (it runs from its own checkout); read to keep out of its way.
INTAKE_STATUS = Path(
    "/Applications/Spatial-data-mapping-tunnel-ground-safety/build/gap-intake/status.json"
)
UNFIT_GRACE_S = 60
REST_S = 2 * 3600
INTERNAL_MIN_FREE = 1.5 * 1024**3
LIMIT_S = {"osm": 900, "imagery": 3 * 3600}


def journal(cell: str) -> dict:
    try:
        return json.loads((ROOT / "data/regions" / cell / "ingest.json").read_text())
    except (OSError, ValueError):
        return {}


def stage_done(cell: str, stage: str) -> bool:
    return journal(cell).get("stages", {}).get(stage, {}).get("status") == "done"


def intake_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def intake_next(state: dict, plan_jobs: list[dict], horizon: int = 2) -> set[str]:
    """The cell the intake is on and the next few it will start, by its own order."""
    active = state.get("active") or {}
    if not active.get("job"):
        return set()
    order = schedule(interleaved(plan_jobs), list(state.get("stage_order") or INTAKE_STAGES))
    keys = [(job["name"], stage) for job, stage in order]
    try:
        at = keys.index((active["job"], active["stage"]))
    except ValueError:
        return {active["job"]}
    return {name for name, _ in keys[at : at + horizon + 1]}


def resting(record: dict, now: float) -> bool:
    """After three failures in a row a stage rests two hours before one more try: a city
    service that is down ("Service ROW/rightofway/MapServer not started") comes back, and a
    stage broken for good is tried a few times a day, not in a loop."""
    return record.get("failures", 0) >= 3 and now - record.get("at", 0) < REST_S


def focus_cells(plan_jobs: list[dict], areas: list[str]) -> list[str]:
    """Each area whole, in the order named; inside one, the reverse of the intake's order."""
    order = [job["name"] for job in reversed(interleaved(plan_jobs))]
    return [name for area in areas for name in order if name.split("-p")[0] == area]


def refresh_osm_probe(cell: str, counts=None) -> bool:
    """Discovery's street count can fail (Overpass 502), leaving the corridor-sized floor of 2000
    elements, which a small cell never reaches. Ask again; the floor then follows the cell."""
    path = ROOT / "data/regions" / cell / "capabilities.json"
    try:
        caps = json.loads(path.read_text())
    except (OSError, ValueError):
        return False
    if caps.get("osm"):
        return True
    from smc.imagery.region import get_region
    from smc.regions.discover import overpass_counts

    try:
        caps["osm"] = (counts or overpass_counts)(get_region(cell).bbox)
    except Exception as exc:
        print(f"{cell}: street count probe failed again ({exc})", flush=True)
        return False
    caps.setdefault("errors", {}).pop("osm", None)
    atomic_json(path, caps)
    return True


def eligible(volume: Path, uuid: str) -> bool:
    if not volume_ready(volume, uuid) or shutil.disk_usage(volume).free < 8 * 1024**3:
        return False
    # The Mac's own disk too: logs, swap and any cache left at its default land there, and a
    # full one stops every process on the machine, not only this one.
    if shutil.disk_usage(ROOT).free < INTERNAL_MIN_FREE:
        return False
    from run_frontage_workers import power_eligible, power_state

    return power_eligible(power_state(), 30)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--areas", required=True, help="comma-separated gap areas, e.g. sf-central-gap,sf-south-gap"
    )
    ap.add_argument("--volume", type=Path, required=True)
    ap.add_argument("--volume-uuid", required=True)
    ap.add_argument("--stages", default=",".join(STAGES))
    ap.add_argument("--intake-status", type=Path, default=INTAKE_STATUS)
    args = ap.parse_args()
    stages = [s for s in args.stages.split(",") if s]
    if any(s not in STAGES for s in stages):
        ap.error(f"stages are {', '.join(STAGES)}")
    areas = [a for a in args.areas.split(",") if a]
    plan_jobs = json.loads((ROOT / "data/regions/gap-plan.json").read_text())["jobs"]
    cells = focus_cells(plan_jobs, areas)
    if not cells:
        ap.error("no planned cells in those areas")
    for cell in cells:
        if not (ROOT / "data/regions" / cell).is_dir():
            ap.error(f"{cell} has no data folder; run the intake's discovery first")
    folder = ROOT / "build/gap-focus"
    folder.mkdir(parents=True, exist_ok=True)
    state_path = folder / "status.json"
    state = intake_state(state_path) or {}
    state.update(
        schema="kerbside.gap_focus/1",
        pid=os.getpid(),
        areas=areas,
        cells=cells,
        stages=stages,
        publishes=False,
    )
    state.setdefault("runs", {})
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def save(status, **extra):
        done = {c: [s for s in stages if stage_done(c, s)] for c in cells}
        state.update(
            state=status,
            at=time.time(),
            done=done,
            finished=[c for c in cells if len(done[c]) == len(stages)],
            **extra,
        )
        atomic_json(state_path, state)

    while not stopping:
        progressed = waiting = False
        for cell in cells:
            for stage in stages:
                if stopping:
                    break
                if stage_done(cell, stage):
                    continue
                if resting(state["runs"].get(f"{cell}|{stage}", {}), time.time()):
                    break  # failed three times running; rest it and go on to the next cell
                if cell in intake_next(intake_state(args.intake_status), plan_jobs):
                    waiting = True
                    break  # the intake is here or nearly; come back to this cell later
                while not eligible(args.volume, args.volume_uuid) and not stopping:
                    save("paused_power_or_storage", active=None)
                    time.sleep(30)
                if stopping:
                    break
                if stage == "osm":
                    refresh_osm_probe(cell)
                started = time.time()
                save("running", active={"cell": cell, "stage": stage, "since": started})
                command = [
                    sys.executable,
                    str(ROOT / "scripts/ingest_gap_region.py"),
                    cell,
                    "--allow-intake",
                    "--stages",
                    stage,
                ]
                yielded = paused = False
                with (ROOT / "data/regions" / cell / f"focus-{stage}.log").open("a") as log:
                    child = subprocess.Popen(
                        command,
                        cwd=ROOT,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                    unfit_since = None
                    while child.poll() is None:
                        # A diskutil or pmset call slow under load reads as unfit; stop a stage
                        # only once the drive or power has stayed unfit for a minute.
                        if eligible(args.volume, args.volume_uuid):
                            unfit_since = None
                        elif unfit_since is None:
                            unfit_since = time.time()
                        unfit = (
                            unfit_since is not None and time.time() - unfit_since >= UNFIT_GRACE_S
                        )
                        intake_here = (intake_state(args.intake_status).get("active") or {}).get(
                            "job"
                        ) == cell
                        over = time.time() - started > LIMIT_S.get(stage, 8 * 3600)
                        if stopping or intake_here or over or unfit:
                            yielded = intake_here
                            paused = unfit and not (stopping or intake_here or over)
                            os.killpg(child.pid, signal.SIGTERM)
                            try:
                                child.wait(timeout=30)
                            except subprocess.TimeoutExpired:
                                os.killpg(child.pid, signal.SIGKILL)
                                child.wait()
                            break
                        time.sleep(5)
                record = state["runs"].setdefault(f"{cell}|{stage}", {"failures": 0})
                record.update(
                    exit_code=child.returncode,
                    seconds=round(time.time() - started, 1),
                    at=time.time(),
                )
                if stage_done(cell, stage):
                    record["failures"] = 0
                    progressed = True
                elif not (yielded or paused or stopping):
                    record["failures"] += 1
                save("running", active=None)
                if not stage_done(cell, stage):
                    break  # later stages need this one; next cell
        if all(stage_done(c, s) for c in cells for s in stages):
            save("complete", active=None)
            return 0
        if not progressed:
            # Waiting on the intake or on failed stages; look again in five minutes.
            save("waiting_on_intake" if waiting else "retry_backoff", active=None)
            for _ in range(60):
                if stopping:
                    break
                time.sleep(5)
    save("stopped", active=None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
