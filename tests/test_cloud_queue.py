"""The durable queue: leases, fencing, retries, quarantine, review and idempotent submission."""

from __future__ import annotations

import pytest

from smc.cloud.queue import JobSpec, Queue


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


def job(i, deps=(), resource="cpu", **kw):
    return JobSpec(id=i, kind="cell_stage", subject=i.split(":")[0], stage=i.split(":")[-1],
                   resource=resource, command=[["true"]], depends=list(deps), **kw)


@pytest.fixture
def q(tmp_path):
    clock = Clock()
    queue = Queue(tmp_path / "q.sqlite", clock=clock)
    queue.clock_ = clock
    yield queue
    queue.close()


def test_a_job_runs_only_after_its_dependencies_and_a_late_report_is_refused(q):
    q.submit(job("c:a"))
    q.submit(job("c:b", ["c:a"]))
    first = q.lease("w1", ["cpu"], 60)
    assert first["job"]["id"] == "c:a" and q.lease("w2", ["cpu"], 60) is None
    # w1 goes quiet; its lease expires and w2 takes the job with a newer fencing token.
    q.clock_.t += 61
    assert q.reap_expired() == ["c:a"]
    second = q.lease("w2", ["cpu"], 60)
    assert second["token"] == first["token"] + 1
    assert not q.complete("c:a", "w1", first["token"], {"tree": "stale"})
    assert not q.heartbeat("c:a", "w1", first["token"], 60)
    assert q.complete("c:a", "w2", second["token"], {"tree": "t1"})
    nxt = q.lease("w2", ["cpu"], 60)
    assert nxt["job"]["id"] == "c:b"
    assert q.attempts("c:a")[0]["outcome"] == "lease_expired"


def test_failures_back_off_then_quarantine_without_stopping_other_work(q):
    q.submit(job("x:bad", max_attempts=2))
    q.submit(job("y:good"))
    q.submit(job("x:after", ["x:bad"]))
    lease = q.lease("w", ["cpu"], 60)
    assert lease["job"]["id"] == "x:bad"
    assert q.fail("x:bad", "w", lease["token"], "HTTP 500") == "failed"
    # Backing off: the unrelated job runs meanwhile.
    assert q.lease("w", ["cpu"], 60)["job"]["id"] == "y:good"
    q.clock_.t += 61
    lease = q.lease("w", ["cpu"], 60)
    assert lease["job"]["id"] == "x:bad"
    assert q.fail("x:bad", "w", lease["token"], "HTTP 500") == "quarantined"
    assert q.blocked() == ["x:after"]
    assert q.requeue("x:bad", "ops") and q.job("x:bad")["attempts"] == 0


def test_a_permanent_failure_quarantines_at_once(q):
    q.submit(job("z:usage"))
    lease = q.lease("w", ["cpu"], 60)
    assert q.fail("z:usage", "w", lease["token"], "exit 2", permanent=True) == "quarantined"


def test_submission_is_idempotent_and_a_changed_spec_replaces_only_when_asked(q):
    assert q.submit(job("c:a")) == "added"
    assert q.submit(job("c:a")) == "kept"
    changed = job("c:a", timeout_s=5)
    assert q.submit(changed) == "kept"
    assert q.submit(changed, replace=True) == "replaced"
    assert q.submit(job("c:done"), state="done", output={"tree": "t"}) == "added"
    assert q.job("c:done")["output"] == {"tree": "t"}


def test_a_released_job_does_not_count_an_attempt(q):
    q.submit(job("c:a", max_attempts=1))
    lease = q.lease("w", ["cpu"], 60)
    assert q.release("c:a", "w", lease["token"], "shutting down")
    lease = q.lease("w", ["cpu"], 60)
    assert lease["token"] == 1


def test_a_held_gate_waits_for_a_named_reviewer_with_a_reason(q):
    q.submit(JobSpec(id="c:gate", kind="gate", subject="c", stage="gate", resource="control"))
    q.submit(JobSpec(id="c:publish", kind="publish", subject="c", stage="publish",
                     resource="control", depends=["c:gate"]))
    lease = q.lease("controller", ["control"], 60)
    assert q.hold("c:gate", "controller", lease["token"], ["sampled_colour low"], {"decision": "hold"})
    assert q.lease("controller", ["control"], 60) is None
    with pytest.raises(ValueError):
        q.review("c:gate", "approve", "", "")
    assert q.review("c:gate", "approve", "eli", "colour not surveyed in this city")
    assert q.job("c:gate")["output"]["decision"] == "approved"
    assert q.lease("controller", ["control"], 60)["job"]["id"] == "c:publish"


def test_spend_counts_running_instances_and_stopped_ones(q):
    q.add_worker("kw-cpu-1", "fake", "cpu", "t", 1.0, "i1")
    q.clock_.t += 1800
    assert q.spend(0) == pytest.approx(0.5)
    q.terminate_worker("kw-cpu-1", "idle")
    q.clock_.t += 3600
    assert q.spend(0) == pytest.approx(0.5)


def test_a_backup_is_a_complete_queue(q, tmp_path):
    q.submit(job("c:a"))
    q.backup_to(tmp_path / "copy.sqlite")
    other = Queue(tmp_path / "copy.sqlite")
    assert other.job("c:a")["state"] == "pending"
    other.close()


def test_an_optional_job_out_of_tries_is_skipped_and_its_chain_goes_on(q):
    q.submit(job("c:build"))
    q.submit(job("c:colours", ["c:build"], optional=True, max_attempts=2,
                 restore_from=["c:build"]))
    q.submit(job("c:gate", ["c:colours"]))
    lease = q.lease("w", ["cpu"], 60)
    q.complete("c:build", "w", lease["token"], {"tree": "t-build", "files": 3})
    for expected in ("failed", "skipped"):
        q.clock_.t += 3600
        lease = q.lease("w", ["cpu"], 60)
        assert lease["job"]["id"] == "c:colours"
        assert q.fail("c:colours", "w", lease["token"], "exit 1\nno photographs") == expected
    skipped = q.job("c:colours")
    assert skipped["state"] == "done"
    assert skipped["output"] == {"tree": "t-build", "files": 3, "skipped": "exit 1"}
    lease = q.lease("w", ["cpu"], 60)
    assert lease["job"]["id"] == "c:gate" and lease["restore"] == []


def test_a_stalled_job_goes_behind_every_other_cells_work(q):
    q.submit(job("a:lidar", priority=100))
    q.submit(job("b:lidar", priority=101))
    lease = q.lease("w", ["cpu"], 60)
    assert lease["job"]["id"] == "a:lidar"
    assert q.fail("a:lidar", "w", lease["token"], "stalled", deferred=True) == "failed"
    q.clock_.t += 3600
    assert q.lease("w", ["cpu"], 60)["job"]["id"] == "b:lidar"
    assert q.lease("w", ["cpu"], 60)["job"]["id"] == "a:lidar"


def test_replacing_a_spec_never_reruns_finished_work(q):
    q.submit(job("c:gate"), state="done", output={"tree": "t"})
    assert q.submit(job("c:gate", ["c:new-end"]), replace=True) == "kept"
    assert q.job("c:gate")["state"] == "done"


def test_a_job_submitted_before_the_new_fields_keeps_its_digest():
    old = job("c:a")
    assert old.digest() == job("c:a", stall_s=3600.0, optional=False).digest()
    assert old.digest() != job("c:a", optional=True).digest()


def test_a_paused_kind_waits_and_the_rest_runs(tmp_path) -> None:
    import json as _json

    from smc.cloud.queue import JobSpec, Queue

    q = Queue(tmp_path / "q.sqlite")
    q.submit(JobSpec(id="interior:a:000", kind="interior_batch", subject="a", stage="x", resource="cpu", priority=1))
    q.submit(JobSpec(id="cell:c:osm", kind="cell_stage", subject="c", stage="osm", resource="cpu", priority=5))
    q.set_meta("paused_kinds", _json.dumps(["interior_batch"]))
    assert q.ready_count("cpu") == 1
    assert q.lease("w", ["cpu"], 60)["job"]["id"] == "cell:c:osm"
    assert q.lease("w", ["cpu"], 60) is None
    q.set_meta("paused_kinds", "[]")
    assert q.lease("w", ["cpu"], 60)["job"]["id"] == "interior:a:000"


def test_a_redo_sends_a_finished_job_and_its_whole_chain_back(q):
    for i, deps in (("c:audit", ()), ("c:colours", ["c:audit"]), ("c:survey", ["c:colours"]),
                    ("c:gate", ["c:survey"]), ("d:audit", ())):
        q.submit(job(i, deps, restore_from=list(deps)))
    for _ in range(5):
        lease = q.lease("w", ["cpu"], 60)
        if lease:
            q.complete(lease["job"]["id"], "w", lease["token"], {"tree": "t", "files": 1})
    assert all(q.job(i)["state"] == "done" for i in ("c:audit", "c:gate", "d:audit"))
    with pytest.raises(ValueError):
        q.redo("c:colours", "ops", "")
    assert q.redo("c:colours", "ops", "ran without its credential") == ["c:colours", "c:gate", "c:survey"]
    assert q.job("c:audit")["state"] == "done" and q.job("d:audit")["state"] == "done"
    assert q.job("c:survey")["state"] == "pending" and q.job("c:survey")["output"] is None
    lease = q.lease("w", ["cpu"], 60)
    assert lease["job"]["id"] == "c:colours"


def test_cells_are_found_by_what_their_failures_said(q):
    q.submit(job("c:survey"))
    q.submit(job("d:survey"))
    for expected in ("c:survey", "d:survey"):
        lease = q.lease("w", ["cpu"], 60)
        assert lease["job"]["id"] == expected
        q.fail(expected, "w", lease["token"],
               "RuntimeError: set MAPILLARY_TOKEN" if expected == "c:survey" else "timed out")
    assert q.failed_with("MAPILLARY_TOKEN", ("survey",)) == ["c"]
