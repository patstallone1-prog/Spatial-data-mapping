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
CELL_CHAIN = ("discover", "osm", "terrain", "lidar", "imagery", "official", "build", "audit")


@dataclass(frozen=True)
class StageRule:
    resource: str
    timeout_s: float
    max_attempts: int = 4
    #: Shared input trees (``pointers/shared-<name>.json`` in the private store).
    shared: tuple[str, ...] = ()
    #: Mostly waiting on the network: a worker can run several at once.
    network_bound: bool = False


RULES: dict[str, StageRule] = {
    "discover": StageRule("cpu", 900, shared=("lidar-index",), network_bound=True),
    "osm": StageRule("cpu", 900, network_bound=True),
    "terrain": StageRule("cpu", 8 * 3600, shared=("lidar-index",), network_bound=True),
    "lidar": StageRule("cpu", 8 * 3600, shared=("lidar-index",), network_bound=True),
    "imagery": StageRule("cpu", 3 * 3600, network_bound=True),
    # A city service that is down fails this stage; the queue's backoff (to two hours) rides
    # it out, and six tries is two days of them before a person is asked.
    "official": StageRule("cpu", 3600, max_attempts=6, shared=("sf-city-cache",),
                          network_bound=True),
    "build": StageRule("cpu", 2 * 3600, shared=("sf-city-cache", "corridor-stats")),
    "audit": StageRule("cpu", 3600),
}

#: Shared inputs that are not in git and are not re-fetched by the stage that reads them.
#: ``smc.cloud.migrate`` uploads each once; workers restore the ones a stage names.
SHARED_INPUTS: dict[str, tuple[str, ...]] = {
    "lidar-index": ("build/regions/entwine-index.geojson",),
    "sf-city-cache": ("build/sf_public_works", "build/sfmta", "build/street_furniture"),
    "corridor-stats": ("data/sf_corridor/stats", "data/sf_corridor/depth"),
    "frontage-models": ("build/frontage-pilot-v2/model-cache", "build/facade-detail-model-cache"),
    "frontage-inputs": ("build/frontage-pilot-v2",),
}

#: The house pipeline's state: the filter's and the matcher's journals and buckets. One state
#: for every region, so batches run one after another (see :func:`house_batch`).
HOUSE_STATE = ("build/frontage-live", "build/facade-match")
HOUSE_REGIONS = ("sf-corridor", "sf-mission", "sf-haight-castro", "sf-sunset", "oakland-downtown",
                 "berkeley-downtown", "palo-alto-downtown", "san-jose-downtown")


def interior_batch(region: str, index: int, revision: str, input_digest: str,
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
        shared=list(rule.shared), save=[f"data/regions/{cell}"], timeout_s=rule.timeout_s,
        max_attempts=rule.max_attempts, priority=priority,
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


def house_batch(number: int, sample: int, previous: str | None, *, device: str = "cuda",
                regions: tuple[str, ...] = HOUSE_REGIONS) -> JobSpec:
    """One pass of the house pipeline over the next ``sample`` houses per region: the frontage
    filter, the matcher (which fits and accepts or rejects each house into its bucket) and the
    materials reader -- the local supervisor's three GPU workers, run once each instead of
    watching. Its fits stay private: publishing a house is a reviewed step, never a batch's."""
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
                   shared=["frontage-models", "frontage-inputs"], save=list(HOUSE_STATE),
                   timeout_s=6 * 3600, max_attempts=3, priority=200,
                   env={"KERBSIDE_HOUSES_PUBLISH": "0"})
