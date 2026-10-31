"""Stuck cells set aside, and the controller's lane running gates and publications at once."""
from __future__ import annotations

import threading
import time

import pytest

from smc.cloud import stuck
from smc.cloud.controller import _defer_policy, _Lane
from smc.cloud.queue import JobSpec, Queue

HOUR = 3600.0


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


def stage(cell, name, deps=(), **kw):
    return JobSpec(id=f"cell:{cell}:{name}", kind="cell_stage", subject=cell, stage=name,
                   resource="cpu", command=[["true"]], depends=[f"cell:{cell}:{d}" for d in deps], **kw)


@pytest.fixture
def q(tmp_path):
    clock = Clock()
    queue = Queue(tmp_path / "q.sqlite", clock=clock)
    queue.clock_ = clock
    yield queue
    queue.close()


def run(q, worker, job_id, seconds, ok=True):
    lease = q.lease(worker, ["cpu"], 3600)
    assert lease["job"]["id"] == job_id
    q.clock_.t += seconds
    if ok:
        q.complete(job_id, worker, lease["token"], {"tree": "t"}, {"seconds": seconds})
    else:
        q.fail(job_id, worker, lease["token"], "no curb profiles measured", permanent=True,
               metrics={"seconds": seconds})


def test_a_deferred_cell_is_not_run_not_blocked_and_kept_through_replans(q):
    q.submit(stage("water", "osm"))
    q.submit(stage("water", "lidar", ["osm"]))
    run(q, "w", "cell:water:osm", 60, ok=False)
    q.submit(stage("town", "osm"))
    assert q.blocked() == ["cell:water:lidar"]
    assert q.defer_subject("water", "ops", "open water") == ["cell:water:lidar", "cell:water:osm"]
    assert q.blocked() == [] and q.counts()["cell_stage"] == {"deferred": 2, "pending": 1}
    # The standing plan resubmits a changed spec with replace: a deferred job stays deferred.
    assert q.submit(stage("water", "osm", max_attempts=9), replace=True) == "kept"
    assert q.lease("w", ["cpu"], 60)["job"]["id"] == "cell:town:osm"
    assert q.lease("w2", ["cpu"], 60) is None
    assert q.undefer_subject("water", "ops") == ["cell:water:lidar", "cell:water:osm"]
    assert q.job("cell:water:osm")["state"] == "pending" and q.job("cell:water:osm")["attempts"] == 0


def test_usage_counts_every_attempt_and_the_quarantine(q):
    q.submit(stage("a", "osm"))
    q.submit(stage("b", "osm"))
    run(q, "w", "cell:a:osm", 5 * HOUR)
    run(q, "w", "cell:b:osm", 600, ok=False)
    usage = q.cell_usage()
    assert usage["a"]["finished"] and usage["a"]["worker_s"] == 5 * HOUR and usage["a"]["wall_s"] == 5 * HOUR
    assert not usage["b"]["finished"] and usage["b"]["quarantined_since"] == q.clock_.t


def cell(worker_h=1.0, *, finished=False, wall_h=None, started_h_ago=1.0, running=False,
         quarantined_h_ago=None, deferred=False, now=1_000_000.0):
    return {"worker_s": worker_h * HOUR, "wall_s": (wall_h or worker_h) * HOUR,
            "first_start": now - started_h_ago * HOUR, "finished": finished, "running": running,
            "quarantined_since": None if quarantined_h_ago is None else now - quarantined_h_ago * HOUR,
            "deferred": deferred}


def test_stuck_is_measured_against_the_cells_that_finished():
    now = 1_000_000.0
    usage = {
        "dense": cell(29.3, finished=True, wall_h=130, started_h_ago=200),
        "ordinary": cell(6.0, finished=True, wall_h=20),
        "water": cell(0.2, quarantined_h_ago=40),             # out of tries for days
        "just-failed": cell(0.2, quarantined_h_ago=0.5),      # an operator may still requeue it
        "spinning": cell(40.0, started_h_ago=60, running=True),  # past the densest by 1.25x
        "busy": cell(30.0, started_h_ago=60, running=True),      # dense, but within the margin
        "forgotten": cell(2.0, started_h_ago=170),           # 170 h > 130 h x 1.25, idle
        "queued-long": cell(2.0, started_h_ago=170, running=True),
        "set-aside": cell(0.1, quarantined_h_ago=99, deferred=True),
    }
    found = stuck.stuck_cells(usage, now)
    assert sorted(found) == ["forgotten", "spinning", "water"]
    assert "quarantined" in found["water"] and "29.3" not in found["spinning"]
    assert "36.6" in found["spinning"]                       # 29.3 x 1.25


def test_the_floors_hold_until_enough_cells_have_finished():
    usage = {"first": cell(1.0, finished=True), "slow": cell(10.0, started_h_ago=40)}
    assert stuck.stuck_cells(usage, 1_000_000.0) == {}    # 12 worker-hours and 48 h at least


def test_deferring_is_configured_or_off():
    assert _defer_policy({}) == stuck.Policy()
    assert _defer_policy({"enabled": False}) is None
    assert _defer_policy({"margin": 2.0}).margin == 2.0


def test_the_lane_runs_jobs_together_and_a_collect_alone():
    lane, log, lock = _Lane(), [], threading.Lock()

    def job(name, alone=False, hold=0.15):
        with lane.alone() if alone else lane.shared():
            with lock:
                log.append(("start", name))
            time.sleep(hold)
            with lock:
                log.append(("end", name))

    threads = [threading.Thread(target=job, args=(f"gate{i}",)) for i in range(3)]
    for t in threads:
        t.start()
    time.sleep(0.05)
    collect = threading.Thread(target=job, args=("collect", True))
    collect.start()
    time.sleep(0.02)
    late = threading.Thread(target=job, args=("late-gate",))
    late.start()
    for t in [*threads, collect, late]:
        t.join()
    starts = [n for kind, n in log if kind == "start"]
    assert starts[:3] == ["gate0", "gate1", "gate2"] or sorted(starts[:3]) == ["gate0", "gate1", "gate2"]
    # The gates overlapped; the collect began after all three ended and before the late gate.
    first_end = log.index(next(e for e in log if e[0] == "end"))
    assert first_end >= 3
    c_start = log.index(("start", "collect"))
    assert all(log.index(("end", f"gate{i}")) < c_start for i in range(3))
    assert log.index(("end", "collect")) < log.index(("start", "late-gate"))
