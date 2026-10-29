"""The scheduler and the providers: launch for work, stop when idle, never past the budget,
delete what is not ours to keep, and send the providers' APIs what they expect."""

from __future__ import annotations

import json

import pytest

from smc.cloud.budget import Budget
from smc.cloud.providers import (
    HetznerProvider,
    Instance,
    Pool,
    Provider,
    RunPodProvider,
    worker_cloud_init,
)
from smc.cloud.queue import JobSpec, Queue
from smc.cloud.scheduler import Scheduler, Settings


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


class Stub(Provider):
    name = "stub"

    def __init__(self, clock):
        self.clock = clock
        self.live: dict[str, Instance] = {}
        self.n = 0

    def launch(self, worker_id, pool, boot):
        self.n += 1
        inst = Instance(f"i{self.n}", worker_id, pool.name, "running", self.clock())
        self.live[inst.id] = inst
        return inst

    def terminate(self, instance_id):
        self.live.pop(instance_id, None)

    def list(self):
        return list(self.live.values())


def setup(tmp_path, *, budget=None, max_workers=3, slots=1, min_fill=1):
    clock = Clock()
    q = Queue(tmp_path / "q.sqlite", clock=clock)
    stub = Stub(clock)
    pool = Pool("cpu", "stub", "cpx32", 0.06, "img", max_workers=max_workers, slots=slots,
                idle_minutes=10, min_billed_hours=1, min_fill=min_fill)
    sched = Scheduler(q, {"stub": stub}, Settings(pools={"cpu": pool},
                                                    budget=budget or Budget(25, 300, 400)),
                      lambda wid, pool: {"KERBSIDE_BOOT_TOKEN": "x"}, clock=clock)
    return clock, q, stub, sched


def jobs(q, n):
    for i in range(n):
        q.submit(JobSpec(id=f"c{i}:terrain", kind="cell_stage", subject=f"c{i}", stage="terrain",
                         resource="cpu", command=[["true"]]))


def test_workers_start_for_ready_work_up_to_the_pool_and_stop_when_idle(tmp_path):
    clock, q, stub, sched = setup(tmp_path, max_workers=3, slots=2)
    jobs(q, 5)
    report = sched.tick()
    assert len(report["launched"]) == 3  # ceil(5 / 2) = 3, the pool's limit
    assert sched.tick()["launched"] == []  # booting workers count as capacity
    for w in q.workers():
        q.seen(w["id"])
        while q.lease(w["id"], ["cpu"], 600):
            pass
    for j in q.jobs(state="leased"):
        q.complete(j["id"], j["lease_owner"], j["lease_token"], {"tree": "t"})
    clock.t += 11 * 60
    for w in q.workers():
        q.seen(w["id"])
    stopped = sched.tick()["stopped"]
    # Two emptied by packing (nothing ready, and the load fits one fewer), the last by idling.
    assert sorted(r for _, r in stopped) == ["idle", "packed", "packed"]
    assert not stub.live and not q.workers()


def test_an_instance_the_queue_does_not_know_is_deleted(tmp_path):
    clock, _q, stub, sched = setup(tmp_path)
    stub.live["stray"] = Instance("stray", "kw-cpu-lost", "cpu", "running", clock())
    assert sched.tick()["orphans"] == ["stray"] and "stray" not in stub.live


def test_a_vanished_or_silent_worker_loses_its_lease_at_once(tmp_path):
    clock, q, stub, sched = setup(tmp_path, max_workers=1)
    jobs(q, 1)
    worker = sched.tick()["launched"][0]
    q.seen(worker)
    lease = q.lease(worker, ["cpu"], 3600)
    stub.live.clear()  # the server was lost
    clock.t += 120
    report = sched.tick()
    assert (worker, "instance gone") in report["stopped"]
    clock.t += 1
    q.reap_expired()
    assert q.job(lease["job"]["id"])["state"] == "failed"


def test_the_budget_holds_launches_back_and_the_hard_limit_stops_everything(tmp_path):
    clock, q, stub, sched = setup(tmp_path, budget=Budget(daily_usd=0.15, monthly_usd=300, hard_monthly_usd=400))
    jobs(q, 3)
    report = sched.tick()
    # The next hour of three $0.06/h workers would pass $0.15: two are started.
    assert len(report["launched"]) == 2 and report.get("held_back")
    q.charge("instance", 500.0, "earlier")
    report = sched.tick()
    assert report["budget"]["hard_stop"] and not stub.live
    assert q.get_meta("paused") == "hard budget limit"
    assert sched.tick()["launched"] == []
    # The month turns: the hard stop was the budget's, and lifts by itself.
    clock.t += 32 * 86400
    report = sched.tick()
    assert report.get("resumed") and report["launched"]


def test_a_spent_day_drains_its_workers_and_launches_none_until_tomorrow(tmp_path):
    _clock, q, _stub, sched = setup(tmp_path, budget=Budget(daily_usd=1.0, monthly_usd=300, hard_monthly_usd=400))
    jobs(q, 2)
    assert sched.tick()["launched"]
    worker = q.workers()[0]
    q.seen(worker["id"])
    lease = q.lease(worker["id"], ["cpu"], 600)
    q.charge("instance", 1.5, "earlier today")
    report = sched.tick()
    assert report["launched"] == [] and "draining" in report["held_back"][0]
    assert q.workers()[0]["state"] == "draining"
    q.complete(lease["job"]["id"], worker["id"], lease["token"], {})
    report = sched.tick()
    assert (worker["id"], "daily budget") in report["stopped"]


def test_the_controller_is_wanted_only_for_work_the_budget_allows(tmp_path):
    from smc.cloud.scheduler import work_waiting

    _clock, q, _stub, sched = setup(tmp_path, budget=Budget(daily_usd=1.0, monthly_usd=300, hard_monthly_usd=400))
    assert work_waiting(q, sched.settings) == (False, "nothing ready")
    jobs(q, 1)
    assert work_waiting(q, sched.settings)[0]
    q.charge("instance", 1.5, "earlier today")
    busy, why = work_waiting(q, sched.settings)
    assert not busy and "budget" in why
    q.submit(JobSpec(id="c:gate", kind="gate", subject="c", stage="gate", resource="control"))
    assert work_waiting(q, sched.settings) == (True, "a gate or publication is ready")


def test_budget_limits_are_consistent():
    with pytest.raises(ValueError):
        Budget(daily_usd=10, monthly_usd=100, hard_monthly_usd=50)


def recorder(responses):
    calls = []

    def request(method, url, token, body=None, timeout=60):
        calls.append({"method": method, "url": url, "token": token, "body": body})
        return responses.get((method, url.split("?")[0]), {})

    return calls, request


def test_hetzner_servers_carry_labels_and_no_secret_but_the_boot_token():
    calls, request = recorder({("POST", "https://api.hetzner.cloud/v1/servers"):
                               {"server": {"id": 42, "status": "initializing"}}})
    h = HetznerProvider("htoken", firewall_ids=[7], request=request)
    pool = Pool("cpu", "hetzner", "cpx32", 0.06, "ghcr.io/x/kerbside-cpu:sha", location="hil")
    inst = h.launch("kw-cpu-abc", pool, {"KERBSIDE_CONTROLLER": "https://c", "KERBSIDE_BOOT_TOKEN": "one-time"})
    body = calls[0]["body"]
    assert inst.id == "42" and body["server_type"] == "cpx32" and body["location"] == "hil"
    assert body["labels"] == {"kerbside": "worker", "worker": "kw-cpu-abc", "pool": "cpu"}
    assert body["firewalls"] == [{"firewall": 7}]
    assert "one-time" in body["user_data"] and "SECRET" not in body["user_data"]
    h.terminate("42")
    assert calls[-1]["method"] == "DELETE" and calls[-1]["url"].endswith("/servers/42")


def test_runpod_pods_have_no_volume_and_only_our_pods_are_listed():
    calls, request = recorder({("POST", "https://rest.runpod.io/v1/pods"): {"id": "p1"},
                               ("GET", "https://rest.runpod.io/v1/pods"): [
                                   {"id": "p1", "name": "kw-gpu-1", "desiredStatus": "RUNNING"},
                                   {"id": "p2", "name": "owners-own-pod", "desiredStatus": "RUNNING"}]})
    r = RunPodProvider("rkey", request=request)
    pool = Pool("gpu", "runpod", "NVIDIA GeForce RTX 4090", 0.34, "img", disk_gb=60,
                extra={"cuda_versions": ["13.0"]})
    r.launch("kw-gpu-1", pool, {"KERBSIDE_BOOT_TOKEN": "one-time"})
    body = calls[0]["body"]
    assert body["volumeInGb"] == 0 and body["gpuCount"] == 1 and body["dockerStartCmd"] == ["worker"]
    assert body["allowedCudaVersions"] == ["13.0"]  # the image's torch needs a CUDA 13 driver
    assert [i.id for i in r.list()] == ["p1"]


def test_cloud_init_powers_the_server_off_when_the_worker_exits():
    text = worker_cloud_init(Pool("cpu", "hetzner", "cpx32", 0.06, "img"), {"A": "1"})
    assert text.startswith("#cloud-config") and "poweroff" in text and "0600" in text
    json.dumps(text)



def test_jobs_are_packed_onto_the_fewest_workers_and_work_arriving_lifts_the_packing(tmp_path):
    """Rented time always has work: with nothing ready, a worker whose jobs would fit on the
    others stops leasing (and is stopped once empty); new work lifts that before a new rental."""
    _clock, q, _stub, sched = setup(tmp_path, max_workers=2, slots=4)
    jobs(q, 6)
    assert len(sched.tick()["launched"]) == 2
    a, b = (w["id"] for w in q.workers())
    for w in (a, b):
        q.seen(w)
    for worker, n in ((a, 4), (b, 2)):
        for _ in range(n):
            q.lease(worker, ["cpu"], 600)

    def finish(worker, n):
        for j in [j for j in q.jobs(state="leased") if j["lease_owner"] == worker][:n]:
            q.complete(j["id"], worker, j["lease_token"], {"tree": "t"})

    finish(b, 1)
    assert "packing" not in sched.tick()  # 5 jobs do not fit on one worker of 4 slots
    finish(a, 3)
    report = sched.tick()  # 1 + 1 do
    assert len(report["packing"]) == 1 and report["stopped"] == []  # still holding its job
    packed = report["packing"][0]
    assert packed in json.loads(q.get_meta("packing"))
    q.submit(JobSpec(id="late:terrain", kind="cell_stage", subject="late", stage="terrain",
                     resource="cpu", command=[["true"]]))
    report = sched.tick()
    assert report["launched"] == [] and json.loads(q.get_meta("packing")) == []
    finish(a, 1)
    finish(b, 1)
    q.lease(a, ["cpu"], 600)
    report = sched.tick()  # nothing ready, the empty worker packs and is stopped at once
    assert report["stopped"] == [(b, "packed")]


def test_a_second_worker_needs_min_fill_jobs_of_its_own(tmp_path):
    _clock, q, _stub, sched = setup(tmp_path, max_workers=3, slots=4, min_fill=3)
    jobs(q, 4)
    assert len(sched.tick()["launched"]) == 1
    (w,) = q.workers()
    q.seen(w["id"])
    while q.lease(w["id"], ["cpu"], 600):
        pass
    for i in range(2):
        q.submit(JobSpec(id=f"x{i}:terrain", kind="cell_stage", subject=f"x{i}", stage="terrain",
                         resource="cpu", command=[["true"]]))
    assert sched.tick()["launched"] == []  # two jobs wait for a free slot rather than a new pod
    q.submit(JobSpec(id="x2:terrain", kind="cell_stage", subject="x2", stage="terrain",
                     resource="cpu", command=[["true"]]))
    assert len(sched.tick()["launched"]) == 1


def test_idle_rented_time_and_a_nearly_spent_budget_raise_warnings(tmp_path):
    clock, q, _stub, sched = setup(tmp_path, budget=Budget(daily_usd=10, monthly_usd=100,
                                                          hard_monthly_usd=100, warn_usd=0.004))
    jobs(q, 1)
    report = sched.tick()
    assert report["warnings"] == [] and report["idle_today_usd"] == 0
    for _ in range(2):  # a booting worker holds no job: its time is idle
        clock.t += 300
        report = sched.tick()
    assert report["idle_today_usd"] == pytest.approx(0.01)
    assert [w["key"].split(":")[0] for w in report["warnings"]] == ["idle"]
    q.charge("instance", 9.999, "elsewhere")
    report = sched.tick()
    assert {w["key"].split(":")[0] for w in report["warnings"]} == {"idle", "daily"}
