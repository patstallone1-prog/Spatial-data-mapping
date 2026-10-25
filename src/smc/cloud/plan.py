"""The regional registry and the gap plan as jobs: one chain of stages per cell, then its gate and
its publication, and a chain of house batches.

Submission is idempotent (a job's id is its key), so the plan is simply submitted again whenever
it may have grown -- a new gap plan, a new region -- and only what is new is added. Work already
finished, here or on the Mac before the move, is recorded rather than redone: a cell whose
folder was migrated (``pointers/cell-<name>.json``) has a ``migrate:<name>`` job, done, whose
output is that folder; each stage its journal shows done is recorded done with the same output,
and the chain picks up at the first stage that is not.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from .checkpoint import get_pointer, read_tree
from .queue import JobSpec, Queue
from .stages import (
    CELL_CHAIN,
    INTERIOR_OUT,
    cell_job,
    gate_job,
    house_batch,
    interior_batch,
    interior_collect,
    publish_job,
    restaurant_collect,
    restaurant_round,
)
from .store import ObjectStore


def plan_cells(root: Path) -> list[dict]:
    """Every cell to build: the gap plan's jobs (in its own interleaved order, so each corridor
    advances) and the registry's named regions, each with its stage order."""
    gap = json.loads((root / "data/regions/gap-plan.json").read_text())["jobs"]
    registry = json.loads((root / "data/regions/regions.json").read_text())["regions"]
    gap_names = {job["name"] for job in gap}
    cells = [{"name": j["name"], "gap": True, "bbox": j["bbox"],
              "stages": [s for s in j.get("stage_order", CELL_CHAIN) if s in CELL_CHAIN]}
             for j in _interleave(gap)]
    for region in registry:
        if region["name"] in gap_names or region["name"] == "sf-corridor":
            continue  # the corridor is built by its own pipeline (scripts/update_sf_corridor.py)
        cells.append({"name": region["name"], "gap": False, "bbox": region.get("bbox"),
                      "stages": list(CELL_CHAIN)})
    return cells


def _interleave(jobs: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for job in jobs:
        groups.setdefault(job["name"].split("-p")[0], []).append(job)
    width = max((len(v) for v in groups.values()), default=0)
    return [rows[i] for i in range(width) for rows in groups.values() if i < len(rows)]


def journal_done(store: ObjectStore, tree: str, cell: str) -> set[str]:
    """The stages a migrated cell's own journal records done, read from its saved folder."""
    manifest = read_tree(store, tree)
    entry = manifest["files"].get(f"data/regions/{cell}/ingest.json")
    if not entry:
        return set()
    journal = json.loads(store.get(f"cas/{entry[0][:2]}/{entry[0]}"))
    return {name for name, row in journal.get("stages", {}).items() if row.get("status") == "done"}


def interior_batch_counts(root: Path, regions: list[str] | None = None) -> dict[str, int]:
    """Each region's batch count, from the engine runner's own eligibility rule."""
    spec = importlib.util.spec_from_file_location("run_interior_engine", root / "scripts/run_interior_engine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.batch_counts(regions or module.REGIONS)


def submit_interiors(queue: Queue, private: ObjectStore, counts: dict[str, int]) -> int:
    """Every region's interior batches and their collection. A batch the Mac finished (its
    manifest is in ``pointers/interiors-state-<region>.json``) is recorded done, not rerun."""
    added = 0
    for region, count in counts.items():
        migrated = None
        done: set[int] = set()
        pointer = get_pointer(private, f"interiors-state-{region}")
        if pointer:
            mig = JobSpec(id=f"migrate:interiors-{region}", kind="migrate", subject=region,
                          stage="migrate", resource="control")
            queue.submit(mig, state="done", output={"tree": pointer["tree"], "source": "migration"})
            migrated = mig.id
            files = read_tree(private, pointer["tree"])["files"]
            done = {i for i in range(count) if f"{INTERIOR_OUT}/{region}/batch-{i:03d}/manifest.json" in files}
        batches = []
        for index in range(count):
            spec = interior_batch(region, index)
            if index in done:
                queue.submit(spec, state="done", output={"tree": pointer["tree"], "source": "migration"})
                continue
            added += queue.submit(spec) == "added"
            batches.append(spec.id)
        if batches or migrated:
            added += queue.submit(interior_collect(region, batches, migrated)) == "added"
    return added


def submit_restaurants(queue: Queue, private: ObjectStore, rounds: int) -> int:
    added, previous = 0, None
    state = get_pointer(private, "restaurant-state")
    if state:
        queue.submit(JobSpec(id="migrate:restaurant-state", kind="migrate", subject="restaurants",
                             stage="migrate", resource="control"),
                     state="done", output={"tree": state["tree"], "source": "migration"})
        previous = "migrate:restaurant-state"
    for number in range(1, rounds + 1):
        spec = restaurant_round(number, previous)
        added += queue.submit(spec) == "added"
        previous = spec.id
    if rounds:
        added += queue.submit(restaurant_collect(previous)) == "added"
    return added


def submit_plan(queue: Queue, root: Path, private: ObjectStore, *, cells: list[str] | None = None,
                house_batches: int = 0, house_sample: int = 24, interiors: bool = False,
                restaurant_rounds: int = 0) -> dict:
    """Submit (or re-submit) the plan. ``cells`` limits it to those names, in plan order."""
    added = kept = recorded = 0
    planned = plan_cells(root)
    if cells is not None:
        wanted = set(cells)
        planned = [c for c in planned if c["name"] in wanted]
    for order, cell in enumerate(planned):
        name = cell["name"]
        priority = 100 + order  # earlier cells first, so whole cells finish rather than stages
        previous = None
        done: set[str] = set()
        pointer = get_pointer(private, f"cell-{name}")
        if pointer:
            mig = JobSpec(id=f"migrate:{name}", kind="migrate", subject=name, stage="migrate",
                          resource="control")
            queue.submit(mig, state="done", output={"tree": pointer["tree"], "source": "migration"})
            previous = mig.id
            done = journal_done(private, pointer["tree"], name)
        chain_done = True
        for stage in cell["stages"]:
            spec = cell_job(name, stage, previous, gap=cell["gap"], priority=priority)
            if chain_done and stage in done and pointer:
                result = queue.submit(spec, state="done",
                                      output={"tree": pointer["tree"], "source": "local journal"})
                recorded += result == "added"
            else:
                chain_done = False
                result = queue.submit(spec)
                added += result == "added"
                kept += result == "kept"
            previous = spec.id
        gate = gate_job(name, previous, priority)
        added += queue.submit(gate) == "added"
        added += queue.submit(publish_job(name, gate.id, priority)) == "added"
    previous = None
    house = get_pointer(private, "house-state")
    if house:
        queue.submit(JobSpec(id="migrate:house-state", kind="migrate", subject="houses",
                             stage="migrate", resource="control"),
                     state="done", output={"tree": house["tree"], "source": "migration"})
        previous = "migrate:house-state"
    for number in range(1, house_batches + 1):
        spec = house_batch(number, house_sample, previous)
        added += queue.submit(spec) == "added"
        previous = spec.id
    if interiors:
        added += submit_interiors(queue, private, interior_batch_counts(root))
    if restaurant_rounds:
        added += submit_restaurants(queue, private, restaurant_rounds)
    return {"cells": len(planned), "added": added, "kept": kept, "recorded_done": recorded}
