"""The interior engine in the cloud: batches as jobs, the Mac's batches not redone, a region's
batches collected under a pointer, and promotion publishing only validated houses."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from smc.cloud.budget import Budget
from smc.cloud.checkpoint import get_pointer, push_tree, read_tree, set_pointer
from smc.cloud.controller import Config, Controller
from smc.cloud.migrate import migrate_interiors
from smc.cloud.plan import interior_batch_counts, submit_interiors, submit_restaurants
from smc.cloud.providers import Pool
from smc.cloud.queue import Queue
from smc.cloud.site import promote_interiors
from smc.cloud.stages import interior_batch
from smc.cloud.store import LocalStore

ROOT = Path(__file__).resolve().parents[1]


def _batch(root: Path, region: str, index: int, houses: dict[str, bool]) -> None:
    """A finished batch as the engine leaves it: its manifest, overlay and house files."""
    folder = root / "build/inferred-interiors" / region / f"batch-{index:03d}"
    folder.mkdir(parents=True)
    records, refs = [], {}
    for osm_id, passed in houses.items():
        (folder / f"osm-{osm_id}.json").write_text(json.dumps(
            {"validation": {"passed": passed}, "grade": "inferred", "id": osm_id}))
        records.append({"id": f"osm-{osm_id}", "passed": passed, "file": f"osm-{osm_id}.json"})
        refs[osm_id] = {"file": f"osm-{osm_id}.json"}
    (folder / "manifest.json").write_text(json.dumps({"houses": records}))
    (folder / "map-overlay.json").write_text(json.dumps({"buildings": refs}))


def test_a_batch_job_runs_that_one_batch_and_saves_its_own_folder() -> None:
    spec = interior_batch("oakland-downtown", 7)
    assert spec.resource == "cpu" and spec.id == "interior:oakland-downtown:007"
    assert spec.command == [["python", "scripts/run_interior_engine.py", "--batch", "oakland-downtown:7",
                             "--out", "build/inferred-interiors"]]
    assert spec.save == ["build/inferred-interiors/oakland-downtown/batch-007"]


def test_the_plan_counts_batches_with_the_runners_own_rule() -> None:
    counts = interior_batch_counts(ROOT, ["sf-haight-castro"])
    assert set(counts) == {"sf-haight-castro"} and counts["sf-haight-castro"] >= 1


def test_batches_the_mac_finished_are_recorded_done_and_the_rest_run(tmp_path) -> None:
    root = tmp_path / "mac"
    _batch(root, "berkeley-downtown", 0, {"1": True})
    store = LocalStore(tmp_path / "private")
    [row] = migrate_interiors(store, root)
    assert row["batches_done"] == 1
    q = Queue(tmp_path / "q.sqlite")
    added = submit_interiors(q, store, {"berkeley-downtown": 3})
    assert q.job("interior:berkeley-downtown:000")["state"] == "done"
    assert q.job("interior:berkeley-downtown:001")["state"] == "pending"
    collect = q.job("interiors:berkeley-downtown:collect-3")
    assert collect["kind"] == "collect" and collect["resource"] == "control"
    spec = collect["spec"]
    restore = spec["restore_from"]
    # The migrated folder first: each later batch tree then lands beside it.
    assert restore[0] == "migrate:interiors-berkeley-downtown"
    assert submit_interiors(q, store, {"berkeley-downtown": 3}) == 0 and added == 3
    assert submit_restaurants(q, store, 2) == 3
    assert q.job("restaurant:round-00002")["state"] == "pending"
    q.close()


def test_the_controller_collects_a_regions_batches_under_its_pointer(tmp_path) -> None:
    private = LocalStore(tmp_path / "private")
    cfg = Config(url="", secret="s", ops_token="ops", db=tmp_path / "q.sqlite", root=tmp_path / "ctl",
                 private=private, public=LocalStore(tmp_path / "public"), public_base="http://x",
                 pools={"cpu": Pool("cpu", "fake", "t", 0.05, "img")}, budget=Budget(), providers={},
                 worker_env={}, tick_s=3600, backup_s=3600)
    (tmp_path / "ctl").mkdir()
    ctl = Controller(cfg)
    try:
        q = ctl.queue
        submit_interiors(q, private, {"sf-mission": 2})
        for index in range(2):
            worker_root = tmp_path / f"w{index}"
            _batch(worker_root, "sf-mission", index, {str(10 + index): True})
            lease = q.lease("w", ["cpu"], 60)
            stats = push_tree(private, worker_root, lease["job"]["save"])
            assert q.complete(lease["job"]["id"], "w", lease["token"], {"tree": stats.tree}, {})
        assert ctl.control_once() == "interiors:sf-mission:collect-2"
        pointer = get_pointer(private, "interiors-sf-mission")
        files = read_tree(private, pointer["tree"])["files"]
        assert {f"build/inferred-interiors/sf-mission/batch-{i:03d}/manifest.json" for i in range(2)} <= set(files)
    finally:
        ctl.shutdown()


def test_promotion_publishes_only_the_houses_that_passed(tmp_path) -> None:
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy(ROOT / "scripts/run_interior_engine.py", repo / "scripts/run_interior_engine.py")
    worker = tmp_path / "worker"
    _batch(worker, "sf-sunset", 0, {"5": True, "6": False})
    private = LocalStore(tmp_path / "private")
    stats = push_tree(private, worker, ["build/inferred-interiors/sf-sunset"])
    set_pointer(private, "interiors-sf-sunset", stats.tree)
    result = promote_interiors(repo, private)
    assert result == {"interior_regions": ["sf-sunset"], "restaurants": False}
    overlay = json.loads((repo / "docs/inferred-interiors/map-overlay.json").read_text())["buildings"]
    assert set(overlay) == {"5"}
    assert (repo / "docs/inferred-interiors/houses/sf-sunset/osm-5.json").is_file()
