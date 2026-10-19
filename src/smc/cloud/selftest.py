"""The whole lifecycle on one machine, with no cloud account: the acceptance test.

What is real: the queue, the controller and its HTTP API, the scheduler, the worker processes
(launched by :class:`.providers.FakeProvider` as separate processes with their own empty work
trees -- nothing of the source checkout's data is visible to them), the content-addressed
checkpoints, the parity gate (``scripts/audit_region_parity.py``, copied from this repository,
on fixture payloads), the publisher, and a public origin served over HTTP with the headers R2's
bucket settings give. What is stood in: the stage commands (``scripts/fake_stage.py`` writes a
journal entry and the files a stage would) and the instance provider.

The run, in the order the acceptance criterion names:

1. submit two cells (one that passes the gate, one that does not) and a house batch chain;
2. workers are started for CPU and GPU work as it becomes ready;
3. each job restores its inputs from the private store and checks them;
4. the stages run;
5. a worker is killed mid-job; its lease expires and the job resumes elsewhere from the last
   checkpoint -- the stages before it are not run again;
6. the gate passes one cell and holds the other with its reasons; a review approves it;
7. both cells are published to the public store as one verified release;
8. the release is read over HTTP as the viewer reads it, and every chunk checks out;
9. idle workers are stopped;
10. the controller is stopped, its database deleted (a lost server) and a new one started from
    the backup in the private store; it carries on and finishes a third cell without redoing
    anything.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import budget as money
from .controller import Config, Controller
from .providers import FakeProvider, Pool
from .queue import JobSpec
from .stages import gate_job, publish_job
from .store import LocalStore

REPO = Path(__file__).resolve().parents[3]
CHAIN = ("discover", "osm", "terrain", "lidar", "imagery", "official", "build", "audit")

FAKE_STAGE = '''#!/usr/bin/env python3
"""Stands in for a stage: records it in the cell's journal and writes what it would."""
import json, os, shutil, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
cell, stage = sys.argv[1], sys.argv[2]
base = ROOT / "data/regions" / cell
base.mkdir(parents=True, exist_ok=True)
time.sleep(float(os.environ.get(f"FAKE_{stage.upper()}_SECONDS", os.environ.get("FAKE_STAGE_SECONDS", "0.2"))))
if stage == "build":
    shutil.copytree(ROOT / "fixtures" / cell / "site", base / "site", dirs_exist_ok=True)
else:
    (base / f"{stage}.out").write_text(f"{stage} of {cell}\\n")
with open(base / "runs.log", "a") as log:
    log.write(stage + "\\n")
path = base / "ingest.json"
journal = json.loads(path.read_text()) if path.exists() else {"region": cell, "stages": {}}
journal["stages"][stage] = {"status": "done", "seconds": 0.2}
path.write_text(json.dumps(journal))
'''

FAKE_HOUSE = '''#!/usr/bin/env python3
"""Stands in for a house batch: extends the shared house journal the next batch restores."""
import json, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
n = sys.argv[1]
time.sleep(0.2)
live = ROOT / "build/frontage-live"; live.mkdir(parents=True, exist_ok=True)
match = ROOT / "build/facade-match"; match.mkdir(parents=True, exist_ok=True)
with open(live / "journal.jsonl", "a") as f:
    f.write(json.dumps({"batch": n}) + "\\n")
(match / f"batch-{n}.json").write_text(json.dumps({"batch": n, "fits": 3, "published": False}))
'''


def _payload(colour_share: float) -> dict:
    ways = []
    for i in range(20):
        ways.append({"kind": "building", "osm_id": 1000 + i,
                     "colour": "#a0a0a0" if i < 20 * colour_share else None,
                     "height_source": "lidar_region" if i % 2 == 0 else "inferred_default"})
    for i in range(6):
        ways.append({"kind": "street", "osm_id": 2000 + i, "name": f"Street {i}",
                     "xs": [[0, 4, -4, "L"], [4, 4, -4, "L"], [8, 4, -4, "M"]]})
    return {"ways": ways, "summary": {"observations": 10}}


def build_fixture(where: Path) -> Path:
    """A repository-shaped folder: the fake stages, the real parity audit, a reference corridor
    and two cells' builds."""
    repo = where / "repo"
    (repo / "scripts").mkdir(parents=True)
    (repo / "scripts/fake_stage.py").write_text(FAKE_STAGE)
    (repo / "scripts/fake_house.py").write_text(FAKE_HOUSE)
    shutil.copy(REPO / "scripts/audit_region_parity.py", repo / "scripts/audit_region_parity.py")
    ground = {"trees": [{"id": 1}], "yards": [{"id": 1}], "parks": [], "lawns": [],
              "front_walks": [], "courts": []}
    (repo / "docs").mkdir()
    (repo / "docs/sf-corridor-3d.json").write_text(json.dumps(_payload(0.5)))
    (repo / "docs/sf-corridor-ground.json").write_text(json.dumps(ground))
    for cell, share in (("test-cell-a", 0.5), ("test-cell-b", 0.0), ("test-cell-c", 0.5)):
        site = repo / "fixtures" / cell / "site"
        site.mkdir(parents=True)
        (site / "sf-corridor-3d.json").write_text(json.dumps(_payload(share)))
        (site / "sf-corridor-ground.json").write_text(json.dumps(ground))
        (site / "sf-corridor-terrain.bin").write_bytes(hashlib.sha256(cell.encode()).digest() * 512)
    (repo / "data/regions").mkdir(parents=True)
    return repo


def cell_jobs(cell: str, priority: int) -> list[JobSpec]:
    jobs, previous = [], None
    for stage in CHAIN:
        spec = JobSpec(id=f"cell:{cell}:{stage}", kind="cell_stage", subject=cell, stage=stage,
                       resource="cpu", command=[["python", "scripts/fake_stage.py", cell, stage]],
                       depends=[previous] if previous else [], restore_from=[previous] if previous else [],
                       save=[f"data/regions/{cell}"], timeout_s=120, priority=priority, max_attempts=4)
        jobs.append(spec)
        previous = spec.id
    gate = gate_job(cell, previous, priority)
    return [*jobs, gate, publish_job(cell, gate.id, priority)]


def house_jobs(n: int) -> list[JobSpec]:
    jobs, previous = [], None
    for i in range(1, n + 1):
        spec = JobSpec(id=f"house:batch-{i:05d}", kind="house_batch", subject="houses",
                       stage=f"batch-{i:05d}", resource="gpu",
                       command=[["python", "scripts/fake_house.py", str(i)]],
                       depends=[previous] if previous else [], restore_from=[previous] if previous else [],
                       save=["build/frontage-live", "build/facade-match"], timeout_s=120)
        jobs.append(spec)
        previous = spec.id
    return jobs


class _Public(SimpleHTTPRequestHandler):
    """The public bucket's origin: its objects, their content types, and R2's CORS answer."""

    store: LocalStore

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def guess_type(self, path):
        rel = Path(path).relative_to(Path(self.directory)).as_posix()
        return self.store.meta(rel).get("content_type") or super().guess_type(path)


def wait(predicate, timeout: float, what: str, every: float = 0.25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(every)
    raise TimeoutError(f"timed out waiting for {what}")


def run(keep: Path | None = None) -> dict:
    tmp = Path(keep or tempfile.mkdtemp(prefix="kerbside-selftest-"))
    checks: dict[str, object] = {}
    repo = build_fixture(tmp)
    private, public = LocalStore(tmp / "private", "private"), LocalStore(tmp / "public", "public")
    handler = partial(_Public, directory=str(public.root))
    _Public.store = public
    origin = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=origin.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{origin.server_address[1]}"
    provider = FakeProvider(tmp / "instances", extra_env={"FAKE_LIDAR_SECONDS": "4"})
    pools = {"cpu": Pool("cpu", "fake", "fake-cpu", 0.06, "local", max_workers=2, slots=1,
                         idle_minutes=0.1),
             "gpu": Pool("gpu", "fake", "fake-gpu", 0.40, "local", max_workers=1, idle_minutes=0.1)}
    controller_root = tmp / "controller-root"
    shutil.copytree(repo, controller_root)

    def config() -> Config:
        return Config(url="", secret="selftest-secret", ops_token="selftest-ops",
                      db=tmp / "controller/queue.sqlite", root=controller_root, private=private,
                      public=public, public_base=base, pools=pools,
                      budget=money.Budget(daily_usd=50, monthly_usd=200, hard_monthly_usd=300),
                      providers={"fake": provider},
                      worker_env={"KERBSIDE_PRIVATE_STORE": str(private.root),
                                  "KERBSIDE_ROOT": str(tmp / "workers" / "{worker_id}"),
                                  "KERBSIDE_SEED_REPO": str(repo), "KERBSIDE_POLL_S": "0.3"},
                      lease_ttl_s=3, tick_s=0.5, backup_s=2, control_poll_s=0.3,
                      silence_grace_s=15, boot_grace_s=60, backoff_base_s=1)

    def start() -> Controller:
        ctl = Controller(config())
        port = ctl.start(0, "127.0.0.1")
        ctl.c.url = f"http://127.0.0.1:{port}"
        return ctl

    ctl = start()
    q = ctl.queue
    try:
        # 1. submit
        for spec in [*cell_jobs("test-cell-a", 100), *cell_jobs("test-cell-b", 110), *house_jobs(2)]:
            q.submit(spec)
        # 2-5. run, and kill the worker holding cell a's lidar stage mid-job
        leased = wait(lambda: (q.job("cell:test-cell-a:lidar") or {}).get("state") == "leased"
                      and q.job("cell:test-cell-a:lidar"), 90, "cell a's lidar to start")
        provider.crash(leased["lease_owner"])
        checks["crashed_worker"] = leased["lease_owner"]
        wait(lambda: q.job("cell:test-cell-a:lidar")["state"] == "done", 120, "lidar to resume")
        lidar_attempts = q.attempts("cell:test-cell-a:lidar")
        checks["lidar_attempts"] = [a["outcome"] for a in lidar_attempts]
        assert lidar_attempts[0]["outcome"] == "lease_expired" and lidar_attempts[-1]["outcome"] == "done"
        assert lidar_attempts[0]["worker"] != lidar_attempts[-1]["worker"], "resumed on another worker"
        # 6. the gate: a passes, b is held, a person approves b
        wait(lambda: q.job("cell:test-cell-a:publish")["state"] == "done", 120, "cell a published")
        wait(lambda: q.job("cell:test-cell-b:gate")["state"] == "held", 120, "cell b held")
        held = q.job("cell:test-cell-b:gate")
        checks["held_reasons"] = held["error"]
        assert "sampled_colour" in held["error"]
        assert q.job("cell:test-cell-b:publish")["state"] == "pending"
        assert q.review("cell:test-cell-b:gate", "approve", "selftest", "fixture: colour not surveyed")
        wait(lambda: q.job("cell:test-cell-b:publish")["state"] == "done", 60, "cell b published")
        wait(lambda: q.job("house:batch-00002")["state"] == "done", 120, "house batches")
        # Earlier stages were not run again after the crash: each appears once in its journal.
        tree = q.job("cell:test-cell-a:audit")["output"]["tree"]
        runs = _file_from_tree(private, tree, "data/regions/test-cell-a/runs.log").decode().split()
        checks["cell_a_runs"] = runs
        assert runs == list(CHAIN), runs
        house_tree = q.job("house:batch-00002")["output"]["tree"]
        journal = _file_from_tree(private, house_tree, "build/frontage-live/journal.jsonl").decode()
        assert journal.count("batch") == 2, "batch 2 started from batch 1's state"
        # 7-8. the release, read the way the viewer reads it
        pointer = json.loads(_http(f"{base}/releases/current.json"))
        release = json.loads(_http(f"{base}/{pointer['key']}"))
        assert set(release["cells"]) == {"test-cell-a", "test-cell-b"}
        for site_path, chunk in release["files"].items():
            data, headers = _http(f"{base}/{chunk}", with_headers=True)
            assert chunk.startswith(f"chunks/{hashlib.sha256(data).hexdigest()[:24]}"), site_path
            assert headers.get("Access-Control-Allow-Origin") == "*"
        checks["release"] = {"version": release["version"], "files": len(release["files"])}
        # 9. idle workers stop
        wait(lambda: not provider.list() and not q.workers(), 90, "idle workers to stop")
        checks["workers_launched"] = len(provider.launched)
        # 10. lose the controller's server; a new one restores and carries on
        done_before = {j["id"]: j["attempts"] for j in q.jobs(state="done")}
        ctl.shutdown()
        (tmp / "controller/queue.sqlite").unlink()
        for side in (tmp / "controller").glob("queue.sqlite-*"):
            side.unlink()
        ctl = start()
        q = ctl.queue
        checks["restored_jobs"] = len(q.jobs())
        for spec in cell_jobs("test-cell-c", 120):
            q.submit(spec)
        wait(lambda: q.job("cell:test-cell-c:publish")["state"] == "done", 120, "cell c after restart")
        redone = [j for j, n in done_before.items() if (q.job(j) or {}).get("attempts") != n]
        assert not redone, f"redone after restart: {redone}"
        release = json.loads(_http(f"{base}/{json.loads(_http(f'{base}/releases/current.json'))['key']}"))
        assert set(release["cells"]) == {"test-cell-a", "test-cell-b", "test-cell-c"}
        wait(lambda: not provider.list(), 90, "idle workers to stop after restart")
        status = ctl.status()
        checks["final"] = {"cells_finished": status["cells"]["finished"],
                           "spend_usd": status["budget"]["month_usd"]}
        checks["ok"] = True
    finally:
        ctl.shutdown(stop_workers=True)
        for iid in list(provider.meta):
            provider.terminate(iid)
        origin.shutdown()
        if keep is None:
            shutil.rmtree(tmp, ignore_errors=True)
    return checks


def _file_from_tree(store, tree: str, path: str) -> bytes:
    from .checkpoint import cas_key, read_tree

    sha = read_tree(store, tree)["files"][path][0]
    return store.get(cas_key(sha))


def _http(url: str, with_headers: bool = False):
    import urllib.request

    with urllib.request.urlopen(url, timeout=20) as r:
        data = r.read()
        return (data, dict(r.headers)) if with_headers else data
