"""Every existing stage as a cloud job: its command, CPU or GPU, its inputs, its limits.

Nothing here re-implements a stage. A cell stage is ``scripts/ingest_gap_region.py <cell>
--allow-intake --stages <stage>`` (or ``scripts/ingest_region.py`` for a named region), exactly
what the local runners call, with the same journal (``data/regions/<cell>/ingest.json``), the
same skip-if-done and the same failure gates. What the cloud adds is where the cell's folder
comes from (the previous stage's checkpoint) and where it goes (the next one).

Why each is CPU or GPU, from the local runs (``smc.cloud.estimate``):

* discover, osm, official, build, audit -- seconds to a minute; network and Python. CPU.
* terrain, lidar -- 10 to 75 minutes a cell, almost all of it waiting on USGS's EPT tiles and
  decoding LAZ; numpy, no GPU path exists. CPU, several cells to a worker.
* imagery -- provider APIs, a few minutes. CPU.
* house filter, matcher, materials -- torch models (frontage pixel screen, detail detector,
  CLIP) that the Mac ran on MPS and that run on CUDA unchanged (``--device cuda``). GPU.
* colours, survey, ground, trees, facades -- what the Mac's facade and ground-cover runners
  added to a built region (sampled building colours, the facade survey, parks/yards/trees, lidar
  trees where no city inventory has them, facade textures). Photographs and city portals; CPU.
  Each is *optional*: one that keeps failing or stalls is skipped and the cell goes on to its
  gate, which judges what it has (:mod:`.gate`).

Not moved: Unreal (macOS/Windows editor, ``unreal/``), the Street View reference acquisition
(restricted imagery; it stays on the owner's machine under its own consent file), and the
contributor coordinator (it hands work to contributors' Macs by design).
"""

from __future__ import annotations

from dataclasses import dataclass

from .queue import JobSpec

PY = "python"

#: The local pipeline's own order (scripts/ingest_region.py DEFAULT_STAGES). A cell's stages
#: share one folder and one journal, so they run one after another; cells run side by side.
BASE_CHAIN = ("discover", "osm", "terrain", "lidar", "imagery", "official", "build", "audit")
#: After the audit: the photographs, the ground and the facade textures read against the built
#: page, the page built again with them, then the lidar's trees planted on the page it serves
#: and every roof's colour read from above (the aerial photographs: no street photo needed).
ENRICH_CHAIN = ("colours", "survey", "ground", "facades", "rebuild", "trees", "roofs")
CELL_CHAIN = BASE_CHAIN + ENRICH_CHAIN


@dataclass(frozen=True)
class StageRule:
    resource: str
    timeout_s: float
    max_attempts: int = 4
    #: Shared input trees (``pointers/shared-<name>.json`` in the private store).
    shared: tuple[str, ...] = ()
    #: Mostly waiting on the network: a worker can run several at once.
    network_bound: bool = False
    #: Seconds without a line of log or a written file before the job counts as stuck: it is
    #: stopped and put behind every other cell's work (:meth:`.queue.Queue.fail`).
    stall_s: float = 3600
    #: A stage the cell can go on without: when its tries run out it is skipped, not quarantined.
    optional: bool = False
    #: Work folders kept with the cell (``{cell}`` filled in) so a retry resumes, not restarts.
    keep: tuple[str, ...] = ()
    #: At most this many of the stage at once on one worker (0: no limit) -- a service that
    #: throttles by address turns a worker's burst into timeouts (:meth:`.queue.Queue.lease`).
    per_worker: int = 0


RULES: dict[str, StageRule] = {
    "discover": StageRule("cpu", 900, shared=("lidar-index",), network_bound=True),
    # Overpass throttles a worker's burst of cells; the queue's backoff (to two hours) spaces
    # the retries, and eight tries is about four hours of them before a person is asked.
    # Two at once per worker: overpass-api.de serves an address two queries at a time, and 164
    # osm attempts (21 hours) had timed out or been refused in a burst (2026-10-29).
    "osm": StageRule("cpu", 1800, max_attempts=8, network_bound=True, per_worker=2),
    "terrain": StageRule("cpu", 8 * 3600, shared=("lidar-index",), network_bound=True),
    "lidar": StageRule("cpu", 8 * 3600, shared=("lidar-index",), network_bound=True),
    "imagery": StageRule("cpu", 3 * 3600, network_bound=True),
    # A city service that is down fails this stage; the queue's backoff (to two hours) rides
    # it out, and six tries is two days of them before a person is asked.
    "official": StageRule("cpu", 3600, max_attempts=6, shared=("sf-city-cache",),
                          network_bound=True),
    "build": StageRule("cpu", 2 * 3600, shared=("sf-city-cache", "corridor-stats")),
    "audit": StageRule("cpu", 3600),
    "colours": StageRule("cpu", 4 * 3600, network_bound=True, stall_s=2700, optional=True,
                         max_attempts=3, keep=("build/building-colours/{cell}",)),
    "survey": StageRule("cpu", 6 * 3600, network_bound=True, stall_s=2700, optional=True,
                        max_attempts=3, keep=("build/facade-survey/{cell}",)),
    "ground": StageRule("cpu", 2 * 3600, network_bound=True, stall_s=2700, optional=True,
                        max_attempts=3),
    "rebuild": StageRule("cpu", 2 * 3600, shared=("sf-city-cache", "corridor-stats"),
                         optional=True, max_attempts=3),
    "trees": StageRule("cpu", 6 * 3600, shared=("lidar-index",), network_bound=True,
                       stall_s=2700, optional=True, max_attempts=3),
    "facades": StageRule("cpu", 8 * 3600, network_bound=True, stall_s=2700, optional=True,
                         max_attempts=3),
    "roofs": StageRule("cpu", 3600, network_bound=True, stall_s=1800, optional=True,
                       max_attempts=3),
}
OPTIONAL_STAGES = tuple(name for name, rule in RULES.items() if rule.optional)
PER_WORKER_CAPS = {name: rule.per_worker for name, rule in RULES.items() if rule.per_worker}

#: Shared inputs that are not in git and are not re-fetched by the stage that reads them.
#: ``smc.cloud.migrate`` uploads each once; workers restore the ones a stage names.
SHARED_INPUTS: dict[str, tuple[str, ...]] = {
    "lidar-index": ("build/regions/entwine-index.geojson",),
    "sf-city-cache": ("build/sf_public_works", "build/sfmta", "build/street_furniture"),
    "corridor-stats": ("data/sf_corridor/stats", "data/sf_corridor/depth"),
    "frontage-models": ("build/frontage-pilot-v2/model-cache", "build/facade-detail-model-cache"),
    "frontage-inputs": ("build/frontage-pilot-v2",),
    # The house filter's world: each region's map and its photographs' metadata. ``docs/`` and
    # the catalogues are kept out of the images, and without them every region came back
    # ``missing_input`` and batches 1-2 screened nothing (2026-10-28). Uploaded by
    # :func:`.migrate.migrate_house_inputs`, which keeps only the open providers' rows.
    "house-inputs": (),
    # Every published cloud cell's map, terrain and open-provider photo rows, at the paths the
    # filter reads a released cell from (docs/regions/<cell>/); composed by the controller from
    # the cells' own saved trees (:func:`.migrate.house_cells_input`), so nothing is uploaded
    # twice. The eight regions above had run out of photographs to screen (2026-10-29).
    "house-cells": (),
}

#: The house pipeline's state: the filter's and the matcher's journals and buckets. One state
#: for every region, so batches run one after another (see :func:`house_batch`).
HOUSE_STATE = ("build/frontage-live", "build/facade-match")
HOUSE_REGIONS = ("sf-corridor", "sf-mission", "sf-haight-castro", "sf-sunset", "oakland-downtown",
                 "berkeley-downtown", "palo-alto-downtown", "san-jose-downtown")
#: Photographs screened per region in one house batch. A batch's fixed cost is minutes -- the
#: models loaded, the matcher's journal read, the state saved -- whatever it screens; 24 a region
#: spent most of a batch on that (2026-10-29). Each photograph is screened exactly as before.
HOUSE_SAMPLE = 72
#: Photograph providers whose rows go to the cloud: openly licensed and fetched there by the
#: filter itself. PandaSet's rows point at local benchmark pixels and stay on the Mac.
HOUSE_PROVIDERS = ("mapillary", "kartaview", "panoramax")


def house_input_paths(region: str) -> list[str]:
    """What ``scripts/filter_frontage_photos.py`` (``paths_for``) reads for one region."""
    if region == "sf-corridor":
        page, catalog = "docs/sf-corridor-3d.json", "data/sf_corridor"
    else:
        page, catalog = f"docs/app-regions/{region}/sf-corridor-3d.json", f"data/regions/{region}/catalog"
    terrain = page.rsplit("/", 1)[0] + "/sf-corridor-terrain"
    return [page, f"{terrain}.json", f"{terrain}.bin", f"{catalog}/observations"]


def local_interior_batch(region: str, index: int, revision: str, input_digest: str,
                         priority: int = 100) -> JobSpec:
    """Independent CPU layout batch, using the same leased/checkpointed worker as facades.

    A completed batch records failures too: acceptance is per house, not a fake all-pass
    job. Only accepted hypotheses can subsequently be published by the existing publisher.
    All command/save paths are repository-relative and work unchanged on a cloud worker.
    """
    out = f"build/interior-production/{revision}"
    return JobSpec(id=f"interior:{region}:{index}:{revision}:{input_digest}", kind="house_batch",
                   subject=region, stage="interior", resource="cpu", priority=priority,
                   command=[[PY, "scripts/run_interior_engine.py", "--regions", region,
                             "--max-area", "500", "--marina-first", "--batch-index", str(index),
                             "--batch-key", input_digest, "--out", out]],
                   save=[f"{out}/{region}/batch-{index:03d}-{input_digest}"], timeout_s=3600)


def cell_command(cell: str, stage: str, *, gap: bool) -> list[list[str]]:
    if gap:
        return [[PY, "scripts/ingest_gap_region.py", cell, "--allow-intake", "--stages", stage]]
    return [[PY, "scripts/ingest_region.py", cell, "--stages", stage]]


def cell_job(cell: str, stage: str, previous: str | None, *, gap: bool,
             priority: int = 100) -> JobSpec:
    rule = RULES[stage]
    return JobSpec(
        id=f"cell:{cell}:{stage}", kind="cell_stage", subject=cell, stage=stage,
        resource=rule.resource, command=cell_command(cell, stage, gap=gap),
        depends=[previous] if previous else [], restore_from=[previous] if previous else [],
        shared=list(rule.shared),
        save=[f"data/regions/{cell}", *(k.format(cell=cell) for k in rule.keep)],
        timeout_s=rule.timeout_s, max_attempts=rule.max_attempts, priority=priority,
        stall_s=rule.stall_s, optional=rule.optional,
        env={"KERBSIDE_NETWORK_BOUND": "1"} if rule.network_bound else {})


def gate_job(cell: str, audit_job: str, priority: int = 100) -> JobSpec:
    """The Marina parity audit on the finished cell (:mod:`.gate`): pass, or hold for review."""
    return JobSpec(id=f"cell:{cell}:gate", kind="gate", subject=cell, stage="gate",
                   resource="control", depends=[audit_job], restore_from=[audit_job],
                   save=[f"data/regions/{cell}"], priority=priority, max_attempts=3)


def publish_job(cell: str, gate: str, priority: int = 100) -> JobSpec:
    """The cell's approved files into the public release (:mod:`.publish`)."""
    return JobSpec(id=f"cell:{cell}:publish", kind="publish", subject=cell, stage="publish",
                   resource="control", depends=[gate], restore_from=[gate],
                   save=[f"data/regions/{cell}"], priority=priority, max_attempts=6)


def republish_job(cell: str, gate: str, last: str, priority: int = 100) -> JobSpec:
    """A published cell again, with what stages added after its gate made: the gate's verdict
    (restored first; publication reads it) under the chain's new end (restored over it)."""
    stage = last.rsplit(":", 1)[-1]
    return JobSpec(id=f"cell:{cell}:publish-{stage}", kind="publish", subject=cell,
                   stage=f"publish-{stage}", resource="control", depends=[gate, last],
                   restore_from=[gate, last], save=[f"data/regions/{cell}"], priority=priority,
                   max_attempts=6)


def house_batch(number: int, sample: int, previous: str | None, *, device: str = "cuda",
                regions: tuple[str, ...] = HOUSE_REGIONS, cells: tuple[str, ...] = ()) -> JobSpec:
    """One pass of the house pipeline over the next ``sample`` houses per region: the frontage
    filter, the matcher (which fits and accepts or rejects each house into its bucket) and the
    materials reader -- the local supervisor's three GPU workers, run once each instead of
    watching. Its fits stay private: publishing a house is a reviewed step, never a batch's.
    ``cells`` are published cloud cells screened beside the regions (the ``house-cells`` input)."""
    regions = (*regions, *cells)
    common_inputs = ["build/frontage-live", "build/frontage-pilot-v2"]
    steps = [
        [PY, "scripts/filter_frontage_photos.py", "--regions", *regions, "--landmarks",
         "--sample", str(sample), "--pixel-screen", "--model-cache",
         "build/frontage-pilot-v2/model-cache", "--strict-houses", "--device", device,
         "--output", "build/frontage-live"],
        [PY, "scripts/match_frontage_facades.py", "--inputs", *common_inputs,
         "--output", "build/facade-match", "--detail-model-cache", "build/facade-detail-model-cache",
         "--device", device, "--auto-accept",
         "--publish-to", "build/facade-match/candidate-published-fits.json"],
        [PY, "scripts/classify_scanned_materials.py", "--matcher-output", "build/facade-match",
         "--reviews", *common_inputs, "--device", device],
    ]
    job_id = f"house:batch-{number:05d}"
    return JobSpec(id=job_id, kind="house_batch", subject="houses", stage=f"batch-{number:05d}",
                   resource="gpu", command=steps,
                   depends=[previous] if previous else [],
                   restore_from=[previous] if previous else ["migrate:house-state"],
                   shared=["frontage-models", "frontage-inputs", "house-inputs",
                           *(["house-cells"] if cells else [])],
                   save=list(HOUSE_STATE),
                   # The filter only adds to its pixel store (put_if_absent); the matcher reads the
                   # review JPEGs. 43 of the state's 56 GB stay in the bucket, referenced.
                   carry=["build/frontage-live/pixel-store"],
                   timeout_s=6 * 3600, max_attempts=3, priority=200,
                   env={"KERBSIDE_HOUSES_PUBLISH": "0"})


# ---- the interior engine -------------------------------------------------------------------
#
# The houses' inferred interiors (scripts/run_interior_engine.py): every eligible mapped house,
# twenty to a batch, each batch independent of the others and CPU only (shapely and the
# engine's own solver; no model). A batch is a job; a region's batches are collected into one
# tree, ``pointers/interiors-<region>.json``, which ``smc-cloud promote --interiors`` publishes
# onto the site (``--publish``: only houses whose validation passed). The restaurants' rounds
# (scripts/build_inferred_restaurants.py) share one history -- a round retains its failures and
# rotates its successes -- so they run one after another; their state is collected to
# ``pointers/restaurants-latest.json``. Google price evidence is never read in the cloud: the
# Places ingest (scripts/ingest_restaurant_prices.py) stays on the owner's machine.
INTERIOR_OUT = "build/inferred-interiors"
RESTAURANT_STATE = "build/inferred-restaurants"


def interior_batch(region: str, index: int, *, priority: int = 300) -> JobSpec:
    folder = f"{INTERIOR_OUT}/{region}/batch-{index:03d}"
    return JobSpec(id=f"interior:{region}:{index:03d}", kind="interior_batch", subject=region,
                   stage=f"batch-{index:03d}", resource="cpu",
                   command=[[PY, "scripts/run_interior_engine.py", "--batch", f"{region}:{index}",
                             "--out", INTERIOR_OUT]],
                   save=[folder], timeout_s=2 * 3600, max_attempts=3, priority=priority)


def interior_collect(region: str, batches: list[str], migrated: str | None) -> JobSpec:
    """A region's finished batches as one tree, for promotion. The migrated folder (the Mac's
    batches) is restored first: each later batch tree then adds its own folder beside it."""
    restore = ([migrated] if migrated else []) + batches
    return JobSpec(id=f"interiors:{region}:collect-{len(batches) + (1 if migrated else 0)}",
                   kind="collect", subject=region, stage=f"interiors-{region}", resource="control",
                   depends=restore, restore_from=restore, save=[f"{INTERIOR_OUT}/{region}"],
                   priority=310, max_attempts=3)


def restaurant_round(number: int, previous: str | None, *, priority: int = 320) -> JobSpec:
    return JobSpec(id=f"restaurant:round-{number:05d}", kind="restaurant_round", subject="restaurants",
                   stage=f"round-{number:05d}", resource="cpu",
                   command=[[PY, "scripts/build_inferred_restaurants.py", "--out", RESTAURANT_STATE,
                             "--seed-from", "docs/inferred-restaurants"]],
                   depends=[previous] if previous else [], restore_from=[previous] if previous else [],
                   save=[RESTAURANT_STATE], timeout_s=2 * 3600, max_attempts=3, priority=priority)


def restaurant_collect(last: str) -> JobSpec:
    return JobSpec(id=f"restaurants:collect:{last.split(':')[-1]}", kind="collect", subject="restaurants",
                   stage="restaurants-latest", resource="control", depends=[last], restore_from=[last],
                   save=[RESTAURANT_STATE], priority=330, max_attempts=3)


# ---- the measured world mesh -----------------------------------------------------------------
#
# A cell's mesh (scripts/build_world_mesh.py, cloud/docs/detail-mesh-scope.md) is built in
# blocks of about WORLDMESH_BLOCK_M, each in two jobs: its photographs fetched on a CPU worker
# (waiting on the network is not GPU time), then on the GPU the solve, the tile pyramid and the
# check against the lidar. A block's work folder is its saved tree, pictures included: the
# lossless record its tiles came from. Nothing reaches the site from here; publishing a block's
# tiles is a reviewed step, like a house's.
WORLDMESH_OUT = "build/worldmesh"
WORLDMESH_BLOCK_M = 200.0


def worldmesh_jobs(cell: str, block: str, bbox: tuple[float, float, float, float], *,
                   priority: int = 400) -> list[JobSpec]:
    folder = f"{WORLDMESH_OUT}/{block}"
    where = ["--bbox=" + ",".join(f"{v:.7f}" for v in bbox), "--name", block]
    photos_id, solve_id = f"mesh:{block}:photos", f"mesh:{block}:solve"
    photos = JobSpec(id=photos_id, kind="mesh_block", subject=cell, stage="mesh-photos",
                     resource="cpu", command=[[PY, "scripts/build_world_mesh.py", *where, "--stages", "photos"]],
                     save=[folder], timeout_s=3 * 3600, max_attempts=4, priority=priority,
                     stall_s=2700, optional=True, env={"KERBSIDE_NETWORK_BOUND": "1"})
    solve = JobSpec(id=solve_id, kind="mesh_block", subject=cell, stage="mesh-solve",
                    resource="gpu",
                    command=[[PY, "scripts/build_world_mesh.py", *where, "--stages", "solve,tiles,check"]],
                    depends=[photos_id], restore_from=[photos_id], save=[folder],
                    timeout_s=12 * 3600, max_attempts=2, priority=priority, stall_s=5400, optional=True)
    return [photos, solve]

