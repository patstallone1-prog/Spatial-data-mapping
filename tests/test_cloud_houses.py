"""The house pipeline past its eight regions: every published cloud cell screened from its own
saved tree, and the accepted houses promoted onto the site."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from smc.cloud.checkpoint import get_pointer, push_tree, read_tree
from smc.cloud.migrate import house_cells_input
from smc.cloud.plan import published_trees, submit_plan
from smc.cloud.queue import JobSpec, Queue
from smc.cloud.site import promote_houses
from smc.cloud.stages import HOUSE_REGIONS
from smc.cloud.store import LocalStore

ROOT = Path(__file__).resolve().parents[1]


def _cell(root: Path, name: str, *, catalogue: bool = True) -> None:
    """A published cell's folder as its stages leave it: the site and a photo catalogue."""
    site = root / f"data/regions/{name}/site"
    site.mkdir(parents=True)
    for part in ("sf-corridor-3d.json", "sf-corridor-terrain.json", "sf-corridor-terrain.bin"):
        (site / part).write_text(f"{name} {part}")
    if catalogue:
        observations = root / f"data/regions/{name}/catalog/observations"
        observations.mkdir(parents=True)
        pq.write_table(pa.table({"provider": ["mapillary", "google_streetview", "kartaview"],
                                 "id": ["1", "2", "3"]}), observations / "external-000.parquet")


def test_published_cells_are_composed_into_one_input_at_the_paths_the_filter_reads(tmp_path):
    private = LocalStore(tmp_path / "private")
    work = tmp_path / "work"
    _cell(work, "gap-a")
    _cell(work, "gap-b", catalogue=False)
    trees = {n: push_tree(private, work, [f"data/regions/{n}"]).tree for n in ("gap-a", "gap-b")}
    pointer = house_cells_input(private, {**trees, "gap-gone": "0" * 64})
    assert pointer["cells"] == ["gap-a"], "a cell without its catalogue (or tree) is left out"
    assert get_pointer(private, "shared-house-cells")["tree"] == pointer["tree"]
    files = read_tree(private, pointer["tree"])["files"]
    source = read_tree(private, trees["gap-a"])["files"]
    # The map is the cell's own object, not a copy; the catalogue keeps only the open providers.
    assert files["docs/regions/gap-a/sf-corridor-3d.json"] == source["data/regions/gap-a/site/sf-corridor-3d.json"]
    part = "data/regions/gap-a/catalog/observations/external-000.parquet"
    private.get_file(f"cas/{files[part][0][:2]}/{files[part][0]}", tmp_path / "kept.parquet")
    assert pq.read_table(tmp_path / "kept.parquet")["provider"].to_pylist() == ["mapillary", "kartaview"]
    assert house_cells_input(private, trees) == get_pointer(private, "shared-house-cells")


def test_house_batches_screen_every_published_cell_beside_the_regions(tmp_path):
    private = LocalStore(tmp_path / "private")
    work = tmp_path / "work"
    _cell(work, "gap-a")
    tree = push_tree(private, work, ["data/regions/gap-a"]).tree
    q = Queue(tmp_path / "q.sqlite")
    q.submit(JobSpec(id="cell:gap-a:publish", kind="publish", subject="gap-a", stage="publish",
                     resource="control"), state="done", output={"tree": "first"})
    q.submit(JobSpec(id="cell:gap-a:publish-roofs", kind="publish", subject="gap-a",
                     stage="publish-roofs", resource="control"), state="done", output={"tree": tree})
    assert published_trees(q) == {"gap-a": tree}, "the newest publication's tree"
    submit_plan(q, ROOT, private, cells=[], house_batches=1)
    batch = q.job("house:batch-00001")["spec"]
    regions = batch["command"][0][batch["command"][0].index("--regions") + 1:]
    assert regions[:len(HOUSE_REGIONS) + 1] == [*HOUSE_REGIONS, "gap-a"]
    assert "house-cells" in batch["shared"]
    q.close()


def test_promotion_publishes_the_newest_batchs_accepted_houses(tmp_path, monkeypatch):
    private = LocalStore(tmp_path / "private")
    work = tmp_path / "work"
    houses = work / "build/facade-match/houses"
    (houses / "sf-sunset").mkdir(parents=True)
    (houses / "index.json").write_text(json.dumps({"count": 1, "houses": [{"region": "sf-sunset", "building_id": "7"}]}))
    (houses / "sf-sunset/7.json").write_text("{}")
    (work / "build/frontage-live").mkdir(parents=True)
    (work / "build/frontage-live/big.bin").write_bytes(b"\0" * 1024)
    tree = push_tree(private, work, ["build/frontage-live", "build/facade-match"]).tree
    q = Queue(tmp_path / "q.sqlite")
    for number, output in ((1, {"tree": "older"}), (2, {"tree": tree})):
        q.submit(JobSpec(id=f"house:batch-{number:05d}", kind="house_batch", subject="houses",
                         stage=f"batch-{number:05d}", resource="gpu"), state="done", output=output)
    q.backup_to(tmp_path / "backup.sqlite")
    q.close()
    private.put_file("queue/backups/b.sqlite", tmp_path / "backup.sqlite")
    private.put_json("queue/latest.json", {"key": "queue/backups/b.sqlite"})
    repo = tmp_path / "repo"
    (repo / "docs/audits").mkdir(parents=True)
    seen = {}

    def run(cmd, **kw):
        folder = Path(cmd[cmd.index("--houses") + 1])
        seen["files"] = sorted(str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file())
        seen["outside"] = (folder.parents[1] / "frontage-live").exists()
        (repo / "docs/audits/house-publication-snapshot.json").write_text(json.dumps(
            {"eligible_worker_records": 1, "published": 4060, "net_added": 1}))
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(subprocess, "run", run)
    result = promote_houses(repo, private)
    assert result == {"tree": tree, "accepted": 1, "published": 4060, "added": 1}
    assert seen == {"files": ["index.json", "sf-sunset/7.json"], "outside": False}, "only the houses"
