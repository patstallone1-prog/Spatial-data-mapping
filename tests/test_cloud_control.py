"""The controller's API, the plan, the gate, site promotion, estimates and the data inventory."""

from __future__ import annotations

import json
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from smc.cloud import gate as gate_mod
from smc.cloud.budget import Budget
from smc.cloud.controller import Config, Controller, worker_token
from smc.cloud.estimate import from_attempts, plan_cost, report
from smc.cloud.inventory import classify
from smc.cloud.migrate import migrate_cell
from smc.cloud.plan import plan_cells, submit_plan
from smc.cloud.providers import Pool
from smc.cloud.queue import Queue
from smc.cloud.selftest import build_fixture
from smc.cloud.site import asset_map, commit_paths, update_regions
from smc.cloud.store import LocalStore

ROOT = Path(__file__).resolve().parents[1]


def post(url, body, token=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as exc:
        return exc.code, {}


@pytest.fixture
def ctl(tmp_path):
    private = LocalStore(tmp_path / "private")
    cfg = Config(url="", secret="s3cret", ops_token="ops", db=tmp_path / "q.sqlite", root=tmp_path,
                 private=private, public=LocalStore(tmp_path / "public"), public_base="http://x",
                 pools={"cpu": Pool("cpu", "fake", "t", 0.05, "img")}, budget=Budget(), providers={},
                 worker_env={"KERBSIDE_PRIVATE_STORE": "r2://kerbside-private"}, tick_s=3600,
                 backup_s=3600)
    c = Controller(cfg)
    port = c.start(0, "127.0.0.1")
    c.base = f"http://127.0.0.1:{port}"
    yield c
    c.shutdown()


def test_a_boot_token_works_once_and_a_stopped_worker_is_refused(ctl):
    boot = ctl.issue_boot("kw-cpu-1", ctl.c.pools["cpu"])
    ctl.queue.add_worker("kw-cpu-1", "fake", "cpu", "t", 0.05, "i1")
    code, out = post(f"{ctl.base}/api/bootstrap", {"worker": "kw-cpu-1", "boot": boot["KERBSIDE_BOOT_TOKEN"]})
    env = out["env"]
    assert code == 200 and env["KERBSIDE_WORKER_TOKEN"] == worker_token("s3cret", "kw-cpu-1")
    assert env["KERBSIDE_PRIVATE_STORE"] == "r2://kerbside-private" and env["KERBSIDE_RESOURCES"] == "cpu"
    assert post(f"{ctl.base}/api/bootstrap", {"worker": "kw-cpu-1", "boot": boot["KERBSIDE_BOOT_TOKEN"]})[0] == 403
    token = env["KERBSIDE_WORKER_TOKEN"]
    assert post(f"{ctl.base}/api/lease", {"worker": "kw-cpu-1"}, token) == (200, {"lease": None})
    assert post(f"{ctl.base}/api/lease", {"worker": "kw-cpu-1"}, "forged")[0] == 403
    ctl.queue.terminate_worker("kw-cpu-1", "test")
    assert post(f"{ctl.base}/api/lease", {"worker": "kw-cpu-1"}, token)[0] == 403


def test_operator_endpoints_need_the_ops_token(ctl):
    with pytest.raises(urllib.error.HTTPError):
        urllib.request.urlopen(f"{ctl.base}/api/status", timeout=10)
    req = urllib.request.Request(f"{ctl.base}/api/status", headers={"Authorization": "Bearer ops"})
    with urllib.request.urlopen(req, timeout=10) as r:
        status = json.loads(r.read())
    assert status["budget"]["hard_stop"] is False and status["cells"]["total"] == 0
    with urllib.request.urlopen(f"{ctl.base}/healthz", timeout=10) as r:
        assert r.status == 200


def test_the_plan_is_every_gap_cell_and_named_region_and_resubmitting_adds_nothing(tmp_path):
    cells = plan_cells(ROOT)
    gap = json.loads((ROOT / "data/regions/gap-plan.json").read_text())["jobs"]
    assert sum(c["gap"] for c in cells) == len(gap)
    assert "sf-corridor" not in {c["name"] for c in cells}
    q = Queue(tmp_path / "q.sqlite")
    store = LocalStore(tmp_path / "private")
    first = submit_plan(q, ROOT, store, cells=[gap[0]["name"]], house_batches=2)
    assert first["added"] == 8 + 2 + 2  # eight stages, the gate, the publication, two batches
    assert submit_plan(q, ROOT, store, cells=[gap[0]["name"]], house_batches=2)["added"] == 0
    q.close()


def test_a_migrated_cell_resumes_at_its_first_unfinished_stage(tmp_path):
    root = tmp_path / "repo"
    (root / "data/regions").mkdir(parents=True)
    for name in ("gap-plan.json", "regions.json"):
        (root / "data/regions" / name).write_text((ROOT / "data/regions" / name).read_text())
    name = json.loads((ROOT / "data/regions/gap-plan.json").read_text())["jobs"][0]["name"]
    cell = root / "data/regions" / name
    cell.mkdir()
    (cell / "ingest.json").write_text(json.dumps({"stages": {
        s: {"status": "done"} for s in ("discover", "osm", "terrain")}}))
    (cell / "points").mkdir()
    (cell / "points/c.npz").write_bytes(b"0" * 100)
    store = LocalStore(tmp_path / "private")
    result = migrate_cell(store, root, name)
    assert result["stages_done"] == ["discover", "osm", "terrain"] and result["files"] == 1
    q = Queue(tmp_path / "q.sqlite")
    out = submit_plan(q, root, store, cells=[name])
    assert out["recorded_done"] == 3
    assert q.job(f"cell:{name}:terrain")["state"] == "done"
    lease = q.lease("w", ["cpu"], 60)
    assert lease["job"]["id"] == f"cell:{name}:lidar"
    assert lease["restore"][0]["tree"] == result["tree"]
    q.close()


def test_restricted_data_is_never_migrated(tmp_path):
    assert classify("frontage-run-2026-10-10/private-datasets/3d-street-view")[0] == "restricted"
    assert classify("data/sf_corridor_pandaset")[0] == "restricted"
    assert classify("build/lidar-cache")[0] == "cache"
    assert classify("data/regions/sf-central-gap-p0-0-0")[0] == "upload_once"
    from smc.cloud.migrate import _refuse_restricted

    with pytest.raises(PermissionError):
        _refuse_restricted(["build/frontage-live/private-datasets/3d-street-view"])


def test_the_gate_uses_the_parity_audits_own_screen():
    source = (ROOT / "scripts/audit_region_parity.py").read_text()
    assert re.search(r"share < ref \* 0\.75", source)
    assert gate_mod.SHARE_SCREEN == 0.75


def test_the_gate_passes_a_cell_at_parity_and_holds_one_below_it_with_reasons(tmp_path):
    repo = build_fixture(tmp_path)
    chain = ("discover", "osm", "terrain", "lidar", "imagery", "official", "build", "audit")
    for cell in ("test-cell-a", "test-cell-b"):
        base = repo / "data/regions" / cell
        base.mkdir(parents=True)
        (base / "site").symlink_to(repo / "fixtures" / cell / "site")
        (base / "ingest.json").write_text(json.dumps({"stages": {s: {"status": "done"} for s in chain}}))
    gate_mod.reference_metrics.cache_clear()
    gate_mod._parity.cache_clear()
    good = gate_mod.evaluate(repo, "test-cell-a", chain)
    bad = gate_mod.evaluate(repo, "test-cell-b", chain)
    assert good["decision"] == "pass", good["reasons"]
    assert bad["decision"] == "hold" and any("sampled_colour" in r for r in bad["reasons"])
    unfinished = gate_mod.evaluate(repo, "test-cell-a", (*chain, "reconstruct"))
    assert unfinished["decision"] == "hold" and "stages not done: reconstruct" in unfinished["reasons"]


def test_site_promotion_lists_new_cells_and_commits_none_of_their_data(tmp_path):
    release = {"version": "v1", "base": "https://assets", "files": {
        "regions/gap-a/sf-corridor-3d.json": "chunks/aa.json"}, "cells": {"gap-a": {}}}
    assert asset_map(release) == {"schema": "kerbside.asset_map/1", "version": "v1",
                                  "base": "https://assets", "files": release["files"]}
    index = {"regions": [{"name": "sf-mission"}]}
    added = update_regions(index, release, {"regions": [{"name": "gap-a", "bbox": [1, 2, 3, 4]}]})
    assert added == ["gap-a"] and index["regions"][-1]["bbox"] == [1, 2, 3, 4]
    repo = tmp_path / "repo"
    (repo / "docs/regions/gap-a").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (repo / "docs/asset-map.json").write_text("{}")
    (repo / "docs/regions/gap-a/sf-corridor-3d.json").write_text("{}")
    (repo / "docs/app-regions/gap-a").mkdir(parents=True)
    (repo / "docs/app-regions/gap-a/app-model.html").write_text("<html>")
    assert commit_paths(repo, ["gap-a"]) == ["docs/app-regions/gap-a/app-model.html", "docs/asset-map.json"]


def test_estimates_divide_network_bound_work_by_the_slots():
    from smc.cloud.estimate import StageTime

    times = {"lidar": StageTime("lidar", 9, 1200, 3600), "build": StageTime("build", 7, 30, None)}
    jobs = [{"name": "a", "area_km2": 2.0}, {"name": "b", "area_km2": 1.0}]
    one = plan_cost(jobs, {"b": {"lidar"}}, times, cpu_usd_h=0.06, cpu_slots=1, chain=("lidar", "build"))
    four = plan_cost(jobs, {"b": {"lidar"}}, times, cpu_usd_h=0.06, cpu_slots=4, chain=("lidar", "build"))
    assert one["stage_hours"]["lidar"] == 2.0 and four["stage_usd"]["lidar"] == pytest.approx(0.03)
    assert one["stage_usd"]["build"] == four["stage_usd"]["build"]
    measured = from_attempts([{"job_id": f"cell:c{i}:lidar", "outcome": "done", "seconds": 100 + i,
                               "cost_usd": 0.01} for i in range(5)])
    assert measured["lidar"]["n"] == 5


def test_the_estimate_report_runs_on_this_repository():
    out = report(ROOT)
    assert out["plan"]["cells"] == len(json.loads((ROOT / "data/regions/gap-plan.json").read_text())["jobs"])
    assert set(out["options"]) and all(o["total_usd"] >= 0 for o in out["options"].values())


def test_a_restored_controller_continues_from_the_backup(tmp_path):
    private = LocalStore(tmp_path / "private")
    db = tmp_path / "ctl/q.sqlite"
    q = Queue(tmp_path / "live.sqlite")
    from smc.cloud.queue import JobSpec

    q.submit(JobSpec(id="c:a", kind="cell_stage", subject="c", stage="a", resource="cpu"))
    q.backup_to(tmp_path / "b.sqlite")
    private.put_file("queue/backups/x.sqlite", tmp_path / "b.sqlite")
    private.put_json("queue/latest.json", {"key": "queue/backups/x.sqlite", "at": 1})
    from smc.cloud.controller import restore_queue

    assert restore_queue(private, db) and Queue(db).job("c:a")["state"] == "pending"
    assert not restore_queue(private, db)  # never over a database that is there
