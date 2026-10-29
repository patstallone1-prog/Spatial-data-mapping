"""The controller: the queue's only owner, the workers' API, the scheduler, gates and releases.

It runs on one small always-on server (``cloud/infra``), never on the Mac. Its state is the
SQLite queue on that server's disk, backed up to the private bucket every few minutes; a new
controller on a new server restores the latest backup and carries on (leases held at the time
expire and their jobs run again from their checkpoints, which is safe: every job is
idempotent and every output content-addressed).

Endpoints (JSON over HTTPS; TLS is the reverse proxy's, ``cloud/infra``)::

    POST /api/bootstrap  one-time boot token -> the worker's environment
    POST /api/lease      a job for this worker, or none
    POST /api/heartbeat  keep a lease; false means stop the job
    POST /api/complete | /api/fail | /api/release | /api/goodbye | /api/stored
    GET  /api/status     the dashboard's numbers                 (ops token)
    POST /api/review     approve, reject or rerun a held job     (ops token)
    POST /api/redo       a finished job and its chain, again     (ops token)
    POST /api/plan       submit or extend the plan               (ops token)
    GET  /               the dashboard                           (ops token)
    GET  /healthz        liveness, no auth

Workers authenticate with ``HMAC(KERBSIDE_SECRET, worker id)``; a worker the queue has stopped
is refused, so a stale instance cannot lease. Operators use ``KERBSIDE_OPS_TOKEN``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import statistics
import tempfile
import threading
import time
import tomllib
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import budget as money
from .checkpoint import pull_tree, push_tree, set_pointer
from .gate import evaluate
from .plan import submit_plan
from .providers import (
    FakeProvider,
    HetznerProvider,
    Pool,
    Provider,
    RunPodProvider,
    runpod_proxy_url,
)
from .publish import Publisher
from .queue import Queue
from .scheduler import Scheduler, Settings, work_waiting
from .stages import CELL_CHAIN, ENRICH_CHAIN, HOUSE_SAMPLE, PER_WORKER_CAPS
from .store import ObjectStore, open_store

log = logging.getLogger("kerbside.controller")
DASHBOARD = Path(__file__).with_name("dashboard.html")


@dataclass
class Config:
    url: str  # how workers reach the controller
    secret: str
    ops_token: str
    db: Path
    root: Path  # the repository checkout gates and publication run in
    private: ObjectStore
    public: ObjectStore
    public_base: str
    pools: dict[str, Pool]
    budget: money.Budget
    providers: dict[str, Provider]
    worker_env: dict[str, str] = field(default_factory=dict)
    lease_ttl_s: float = 120
    tick_s: float = 20
    backup_s: float = 300
    control_poll_s: float = 10
    silence_grace_s: float = 300
    boot_grace_s: float = 900
    publish_answers: object = None  # override the public-origin check (tests)
    backoff_base_s: float = 60.0
    #: The controller pod's own price, charged to the budget while it runs.
    hourly_usd: float = 0.0
    #: Minutes with nothing to do (scheduler.work_waiting) before the controller stops its own
    #: pod; 0 never. The watchdog starts it again when there is work the budget allows.
    sleep_after_min: float = 0.0
    #: Hours between resubmissions of the standing plan (the last ``plan --standing``).
    replan_h: float = 24.0
    #: Job kinds that wait however long the queue is (interior_batch while the houses and cells
    #: go first). Set from the config on every start, so a redeploy cannot forget it.
    paused_kinds: tuple[str, ...] = ()

    @classmethod
    def load(cls, path: Path, env=os.environ) -> Config:
        """``cloud/config/kerbside-cloud.example.toml``; secrets come from the environment."""
        # ``${NAME}`` in the file is filled from the environment, so the committed config names
        # its settings and the deployment supplies them; a secret is never written in it.
        text = Path(path).read_text()
        # The workers run the controller's own build: runpod-controller sets the tag it deployed.
        env = {"KERBSIDE_IMAGE_TAG": "main", **env}
        for key, value in env.items():
            text = text.replace("${" + key + "}", value)
        raw = tomllib.loads(text)
        need = ["KERBSIDE_SECRET", "KERBSIDE_OPS_TOKEN"]
        missing = [k for k in need if not env.get(k)]
        if missing:
            raise SystemExit(f"controller needs {', '.join(missing)} (cloud/docs/secrets.md)")
        pools = {name: Pool(name=name, **body) for name, body in raw["pools"].items()}
        providers: dict[str, Provider] = {}
        for pool in pools.values():
            if pool.provider == "hetzner" and "hetzner" not in providers:
                h = raw.get("hetzner", {})
                providers["hetzner"] = HetznerProvider(
                    _need(env, "HCLOUD_TOKEN"), ssh_keys=h.get("ssh_keys"),
                    firewall_ids=h.get("firewall_ids"), network_id=h.get("network_id"))
            elif pool.provider == "runpod" and "runpod" not in providers:
                providers["runpod"] = RunPodProvider(_need(env, "RUNPOD_API_KEY"))
            elif pool.provider == "fake" and "fake" not in providers:
                providers["fake"] = FakeProvider(Path(raw.get("fake_workdir", "build/cloud-fake")))
        stores = raw["stores"]
        passed = {k: env[k] for k in raw.get("pass_env", []) if env.get(k)}
        url = raw["controller"]["url"]
        if (not url or "${" in url) and env.get("RUNPOD_POD_ID"):
            # On RunPod the controller's address is its own pod's proxy, known only inside it.
            url = runpod_proxy_url(env["RUNPOD_POD_ID"], int(env.get("KERBSIDE_PORT", "8080")))
        return cls(
            url=url, secret=env["KERBSIDE_SECRET"],
            ops_token=env["KERBSIDE_OPS_TOKEN"], db=Path(raw["controller"]["db"]),
            root=Path(raw["controller"].get("root", ".")).resolve(),
            private=open_store(stores["private"], role="private", env=env),
            public=open_store(stores["public"], role="public", env=env),
            public_base=stores["public_base"], pools=pools, budget=money.Budget(**raw["budget"]),
            providers=providers, worker_env={**raw.get("worker_env", {}), **passed},
            lease_ttl_s=raw["controller"].get("lease_ttl_s", 120),
            tick_s=raw["controller"].get("tick_s", 20),
            backup_s=raw["controller"].get("backup_s", 300),
            hourly_usd=raw["controller"].get("hourly_usd", 0.0),
            sleep_after_min=raw["controller"].get("sleep_after_min", 0.0),
            replan_h=raw["controller"].get("replan_h", 24.0),
            paused_kinds=tuple(raw["controller"].get("paused_kinds", [])))


def _need(env, key):
    if not env.get(key):
        raise SystemExit(f"{key} is required for this pool (cloud/docs/secrets.md)")
    return env[key]


def worker_token(secret: str, worker_id: str) -> str:
    return hmac.new(secret.encode(), worker_id.encode(), hashlib.sha256).hexdigest()


class Controller:
    def __init__(self, config: Config, *, clock=time.time):
        self.c = config
        self.clock = clock
        restore_queue(config.private, config.db)
        self.queue = Queue(config.db, clock=clock, backoff_base_s=config.backoff_base_s)
        self.queue.set_meta("paused_kinds", json.dumps(sorted(config.paused_kinds)))
        self.publisher = Publisher(config.public, config.public_base, clock=clock,
                                   **({"answers": config.publish_answers}
                                      if config.publish_answers else {}))
        self.scheduler = Scheduler(
            self.queue, config.providers,
            Settings(pools=config.pools, budget=config.budget, silence_grace_s=config.silence_grace_s,
                     boot_grace_s=config.boot_grace_s, controller_hourly_usd=config.hourly_usd),
            self.issue_boot, clock=clock)
        self.idle_since: float | None = None
        self.slept_at = 0.0
        self._housekeeping_lock = threading.Lock()
        self.stop = threading.Event()
        self.threads: list[threading.Thread] = []
        self.server: ThreadingHTTPServer | None = None
        self._control_lock = threading.Lock()

    # -- workers' credentials ----------------------------------------------------------------

    def issue_boot(self, worker_id: str, pool: Pool) -> dict:
        token = secrets.token_urlsafe(24)
        self.queue.set_meta(f"boot:{worker_id}", json.dumps(
            {"sha": hashlib.sha256(token.encode()).hexdigest(), "pool": pool.name,
             "at": self.clock()}))
        return {"KERBSIDE_CONTROLLER": self.c.url, "KERBSIDE_WORKER_ID": worker_id,
                "KERBSIDE_BOOT_TOKEN": token}

    def redeem_boot(self, worker_id: str, token: str) -> dict | None:
        raw = self.queue.get_meta(f"boot:{worker_id}")
        if not raw:
            return None
        record = json.loads(raw)
        if record.get("used") or not hmac.compare_digest(
                record["sha"], hashlib.sha256(token.encode()).hexdigest()):
            return None
        record["used"] = self.clock()
        self.queue.set_meta(f"boot:{worker_id}", json.dumps(record))
        pool = self.c.pools[record["pool"]]
        env = {k: v.format(worker_id=worker_id, pool=pool.name) for k, v in self.c.worker_env.items()}
        env.update({
            "KERBSIDE_CONTROLLER": self.c.url, "KERBSIDE_WORKER_ID": worker_id,
            "KERBSIDE_WORKER_TOKEN": worker_token(self.c.secret, worker_id),
            "KERBSIDE_RESOURCES": pool.name, "KERBSIDE_SLOTS": str(pool.slots),
            "KERBSIDE_HOURLY_USD": str(pool.hourly_usd),
            "KERBSIDE_INSTANCE_TYPE": pool.instance_type,
            "KERBSIDE_IDLE_EXIT_S": str(pool.idle_minutes * 60 + 120),
            "KERBSIDE_LEASE_TTL_S": str(self.c.lease_ttl_s),
        })
        self.queue.seen(worker_id)
        return env

    def worker_ok(self, worker_id: str, token: str) -> bool:
        if not worker_id or not hmac.compare_digest(worker_token(self.c.secret, worker_id), token or ""):
            return False
        return any(w["id"] == worker_id for w in self.queue.workers())

    # -- gates and publication, run here ---------------------------------------------------

    def control_once(self) -> str | None:
        """Lease and run one gate or publish job; returns its id, or None if none was ready."""
        with self._control_lock:
            # Gates and publication run here without heartbeats: an hour's lease covers the
            # largest cell's audit, and a controller that dies mid-job loses it to the next one.
            lease = self.queue.lease("controller", ["control"], 3600)
            if not lease:
                return None
            spec, token = lease["job"], lease["token"]
            cell = spec["subject"]
            try:
                for entry in lease["restore"]:
                    if entry.get("tree"):
                        pull_tree(self.c.private, entry["tree"], self.c.root)
                tree = next((e["tree"] for e in reversed(lease["restore"]) if e.get("tree")), None)
                if spec["kind"] == "gate":
                    verdict = evaluate(self.c.root, cell, _chain(spec, self.queue))
                    output = {"tree": tree, **verdict}
                    if verdict["decision"] == "pass":
                        self.queue.complete(spec["id"], "controller", token, output)
                    else:
                        self.queue.hold(spec["id"], "controller", token, verdict["reasons"], output)
                elif spec["kind"] == "publish":
                    gate = next((e for e in lease["restore"] if e.get("decision")), {})
                    result = self.publisher.publish_cell(
                        cell, self.c.root / "data/regions" / cell, gate=gate, tree=tree)
                    self.queue.complete(spec["id"], "controller", token, {"tree": tree, **result})
                elif spec["kind"] == "collect":
                    # What the jobs it restored made, as one tree under a pointer that
                    # promotion reads (the interiors of a region, the restaurants' rounds).
                    stats = push_tree(self.c.private, self.c.root, spec["save"])
                    set_pointer(self.c.private, spec["stage"], stats.tree, job=spec["id"],
                                files=stats.files, bytes=stats.bytes_total)
                    self.queue.complete(spec["id"], "controller", token,
                                        {"tree": stats.tree, "pointer": spec["stage"], "files": stats.files})
                else:
                    self.queue.fail(spec["id"], "controller", token,
                                    f"no control handler for {spec['kind']}", permanent=True)
            except Exception as exc:  # the job's failure, recorded with its reason
                log.exception("control job %s", spec["id"])
                self.queue.fail(spec["id"], "controller", token, f"{type(exc).__name__}: {exc}",
                                permanent=isinstance(exc, PermissionError | FileNotFoundError))
            return spec["id"]

    # -- the standing plan and sleeping --------------------------------------------------

    def housekeeping(self) -> dict:
        """After each tick: resubmit the standing plan when it is due (new houses, new interior
        batches, a chain that has grown), and stop this pod when there has been nothing to do
        for ``sleep_after_min`` -- a controller up all month would cost more than the work."""
        with self._housekeeping_lock:
            return self._housekeeping()

    def _housekeeping(self) -> dict:
        now = self.clock()
        out: dict = {}
        standing = self.queue.get_meta("plan")
        last = float(self.queue.get_meta("planned_at", "0") or 0)
        if standing and now - last > self.c.replan_h * 3600:
            out["replanned"] = submit_plan(self.queue, self.c.root, self.c.private,
                                           **json.loads(standing))
            self.queue.set_meta("planned_at", str(now))
        busy, why = work_waiting(self.queue, self.scheduler.settings, now)
        out["work"] = why
        if busy:
            self.idle_since = None
            return out
        self.idle_since = self.idle_since or now
        idle_min = (now - self.idle_since) / 60
        pod = os.environ.get("RUNPOD_POD_ID")
        # Asked once; again only if the pod is somehow still here ten minutes on.
        recently = now - self.slept_at < 600
        if self.c.sleep_after_min and pod and idle_min >= self.c.sleep_after_min and not recently:
            self.slept_at = now
            log.warning("nothing to do for %.0f min (%s); stopping this pod until the watchdog "
                        "wakes it", idle_min, why)
            self.queue.set_meta("asleep", json.dumps({"at": now, "why": why}))
            money.charge_controller(self.queue, self.c.hourly_usd, now)
            self.backup()
            provider = self.c.providers.get("runpod")
            if provider is not None:
                provider.stop(pod)
            out["sleeping"] = why
        return out

    # -- loops ------------------------------------------------------------------------------

    def _loop(self, every: float, fn, name: str) -> None:
        while not self.stop.is_set():
            try:
                fn()
            except Exception:  # a loop that dies takes the controller with it
                log.exception("%s failed", name)
            self.stop.wait(every)

    def _tick(self) -> None:
        self.scheduler.tick()
        self.housekeeping()

    def _control_loop(self) -> None:
        while not self.stop.is_set():
            try:
                ran = self.control_once()
            except Exception:
                log.exception("control loop")
                ran = None
            if not ran:
                self.stop.wait(self.c.control_poll_s)

    def backup(self) -> str:
        stamp = time.strftime("%Y%m%d-%H", time.gmtime(self.clock()))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "queue.sqlite"
            self.queue.backup_to(path)
            key = f"queue/backups/{stamp}.sqlite"
            self.c.private.put_file(key, path, content_type="application/vnd.sqlite3")
        self.c.private.put_json("queue/latest.json", {"key": key, "at": self.clock()})
        return key

    def start(self, port: int | None = None, host: str = "0.0.0.0") -> int:
        handler = _handler(self)
        self.server = ThreadingHTTPServer((host, port or 0), handler)
        self.server.daemon_threads = True
        if not self.c.url:  # local runs: workers reach the controller where it is listening
            self.c.url = f"http://{host if host != '0.0.0.0' else '127.0.0.1'}:{self.server.server_address[1]}"
        loops = [
            threading.Thread(target=self.server.serve_forever, daemon=True, name="http"),
            threading.Thread(target=self._loop, args=(self.c.tick_s, self._tick, "tick"),
                             daemon=True, name="scheduler"),
            threading.Thread(target=self._control_loop, daemon=True, name="control"),
            threading.Thread(target=self._loop, args=(self.c.backup_s, self.backup, "backup"),
                             daemon=True, name="backup"),
        ]
        for th in loops:
            th.start()
        self.threads = loops
        return self.server.server_address[1]

    def shutdown(self, *, stop_workers: bool = False) -> None:
        self.stop.set()
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if stop_workers:
            self.scheduler.stop_all("controller shutdown")
        try:
            self.backup()
        except Exception:
            log.exception("final backup")
        self.queue.close()

    # -- the dashboard's numbers -------------------------------------------------------------

    def status(self) -> dict:
        q = self.queue
        jobs = q.jobs()
        attempts = q.attempts()
        cells: dict[str, dict] = {}
        for j in jobs:
            if j["kind"] not in ("cell_stage", "gate", "publish"):
                continue
            c = cells.setdefault(j["subject"], {"done": 0, "of": 0, "state": "pending", "stage": None})
            c["of"] += 1
            c["done"] += j["state"] == "done"
            if j["state"] in ("leased", "failed", "held", "quarantined") or (
                    j["state"] == "pending" and c["stage"] is None):
                c["stage"], c["state"] = j["stage"], j["state"]
        finished = [k for k, v in cells.items() if v["done"] == v["of"]]
        cost_by: dict[str, list[float]] = {}
        secs_by: dict[str, list[float]] = {}
        kind_of = {j["id"]: j["kind"] for j in jobs}
        for a in attempts:
            if a["outcome"] == "done" and a["seconds"]:
                key = a["job_id"].split(":")[-1] if a["job_id"].startswith("cell:") \
                    else kind_of.get(a["job_id"], "house_batch")
                cost_by.setdefault(key, []).append(a["cost_usd"] or 0)
                secs_by.setdefault(key, []).append(a["seconds"])
        remaining = 0.0
        for j in jobs:
            if j["state"] in ("pending", "failed", "leased"):
                key = j["stage"] if j["kind"] == "cell_stage" else j["kind"]
                if key in cost_by:
                    remaining += statistics.median(cost_by[key])
        workers = []
        now = self.clock()
        for w in q.workers():
            alive = max(1.0, now - w["created_at"])
            busy = sum((a["ended_at"] or now) - a["started_at"] for a in attempts
                       if a["worker"] == w["id"])
            workers.append({**w, "age_s": round(alive), "utilisation": round(min(1.0, busy / alive), 3)})
        return {
            "at": now, "counts": q.counts(), "cells": {"total": len(cells), "finished": len(finished),
                                                       "detail": cells},
            "houses": {s: n for s, n in q.counts().get("house_batch", {}).items()},
            "interiors": {s: n for s, n in q.counts().get("interior_batch", {}).items()},
            "restaurants": {s: n for s, n in q.counts().get("restaurant_round", {}).items()},
            "failures": [{"id": j["id"], "state": j["state"], "attempts": j["attempts"],
                          "error": (j["error"] or "")[-600:]}
                         for j in jobs if j["state"] in ("failed", "quarantined")],
            "held": [{"id": j["id"], "subject": j["subject"], "reasons": (j["error"] or "").split("; ")}
                     for j in jobs if j["state"] == "held"],
            "blocked": q.blocked(),
            "workers": workers,
            "budget": money.status(q, self.c.budget, now),
            "estimate": {"remaining_usd": round(remaining, 2),
                         "per_stage_median_usd": {k: round(statistics.median(v), 4) for k, v in cost_by.items()},
                         "per_stage_median_s": {k: round(statistics.median(v)) for k, v in secs_by.items()},
                         "basis": "median measured cost of finished attempts, times the jobs left"},
            "release": (self.publisher.pointer()[0] or {}),
            "paused": q.get_meta("paused"),
            "paused_kinds": json.loads(q.get_meta("paused_kinds") or "[]"),
            "warnings": self.scheduler.last.get("warnings", []),
            "idle_today_usd": self.scheduler.last.get("idle_today_usd"),
            "last_tick": self.scheduler.last,
        }


def _chain(spec: dict, queue: Queue) -> list[str]:
    stages = [j["stage"] for j in queue.jobs(subject=spec["subject"], kind="cell_stage")]
    return stages or list(CELL_CHAIN)


def restore_queue(private: ObjectStore, db: Path) -> bool:
    """A controller on a new server: the latest backup of the queue, if this one has none."""
    db = Path(db)
    if db.exists():
        return False
    latest = private.get_json("queue/latest.json")
    db.parent.mkdir(parents=True, exist_ok=True)
    if not latest:
        return False
    private.get_file(latest["key"], db)
    log.warning("queue restored from %s (%s)", latest["key"], latest.get("at"))
    return True


def _handler(ctl: Controller):
    class Handler(BaseHTTPRequestHandler):
        server_version = "kerbside-controller/1"

        def log_message(self, fmt, *args):  # quiet: the queue's events are the record
            log.debug(fmt, *args)

        def _send(self, code: int, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 4 << 20:
                raise ValueError("body too large")
            return json.loads(self.rfile.read(n) or b"{}")

        def _ops(self) -> bool:
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                given = auth[7:]
            elif auth.startswith("Basic "):
                given = base64.b64decode(auth[6:]).decode("utf-8", "replace").partition(":")[2]
            else:
                return False
            return hmac.compare_digest(given, ctl.c.ops_token)

        def do_GET(self):
            if self.path == "/healthz":
                return self._send(200, {"ok": True})
            if not self._ops():
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="kerbside"')
                self.end_headers()
                return None
            if self.path == "/api/status":
                return self._send(200, ctl.status())
            if self.path in ("/", "/dashboard"):
                return self._send(200, DASHBOARD.read_bytes(), "text/html; charset=utf-8")
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            try:
                body = self._body()
            except ValueError as exc:
                return self._send(400, {"error": str(exc)})
            q = ctl.queue
            if self.path == "/api/bootstrap":
                env = ctl.redeem_boot(body.get("worker", ""), body.get("boot", ""))
                return self._send(200, {"env": env}) if env else self._send(403, {"error": "refused"})
            if self.path in ("/api/review", "/api/plan", "/api/requeue", "/api/pause", "/api/redo"):
                if not self._ops():
                    return self._send(401, {"error": "ops token required"})
                if self.path == "/api/review":
                    ok = q.review(body["job"], body["decision"], body["reviewer"], body["note"])
                    return self._send(200 if ok else 409, {"ok": ok})
                if self.path == "/api/requeue":
                    return self._send(200, {"ok": q.requeue(body["job"], body.get("operator", "ops"))})
                if self.path == "/api/redo":
                    # One job and its chain, or every cell whose enrichment failed with
                    # ``failed_with`` in its log, each from ``from_stage`` on.
                    operator, note = body.get("operator", "ops"), body.get("note", "")
                    if body.get("failed_with"):
                        cells = q.failed_with(body["failed_with"], ENRICH_CHAIN)
                        start = body.get("from_stage", ENRICH_CHAIN[0])
                        sent = {c: q.redo(f"cell:{c}:{start}", operator, note) for c in cells}
                        return self._send(200, {"ok": True, "cells": sent})
                    return self._send(200, {"ok": True, "jobs": q.redo(body["job"], operator, note)})
                if self.path == "/api/pause":
                    q.set_meta("paused", body.get("reason", ""))
                    return self._send(200, {"ok": True})
                plan = {"cells": body.get("cells"),
                        "house_batches": int(body.get("house_batches", 0)),
                        "house_sample": int(body.get("house_sample", HOUSE_SAMPLE)),
                        "interiors": bool(body.get("interiors", False)),
                        "restaurant_rounds": int(body.get("restaurant_rounds", 0)),
                        "house_ahead": int(body.get("house_ahead", 0))}
                result = submit_plan(q, ctl.c.root, ctl.c.private, **plan)
                if body.get("standing"):
                    # Resubmitted by the controller every replan_h hours (housekeeping).
                    q.set_meta("plan", json.dumps(plan))
                    q.set_meta("planned_at", str(ctl.clock()))
                    result["standing"] = True
                return self._send(200, result)
            worker = body.get("worker", "")
            token = self.headers.get("Authorization", "")[7:]
            if not ctl.worker_ok(worker, token):
                return self._send(403, {"error": "unknown or stopped worker"})
            q.seen(worker)
            if self.path == "/api/lease":
                me = next((w for w in q.workers() if w["id"] == worker), {})
                if (me.get("state") == "draining" or q.get_meta("paused")
                        or worker in json.loads(q.get_meta("packing") or "[]")):
                    return self._send(200, {"lease": None})
                lease = q.lease(worker, body.get("resources") or [me.get("resource", "cpu")],
                                float(body.get("ttl", ctl.c.lease_ttl_s)), me.get("instance_type"),
                                caps=PER_WORKER_CAPS)
                return self._send(200, {"lease": lease})
            if self.path == "/api/heartbeat":
                return self._send(200, {"ok": q.heartbeat(body["job"], worker, int(body["token"]),
                                                          float(body.get("ttl", ctl.c.lease_ttl_s)))})
            if self.path == "/api/complete":
                return self._send(200, {"ok": q.complete(body["job"], worker, int(body["token"]),
                                                         body.get("output") or {}, body.get("metrics"))})
            if self.path == "/api/fail":
                return self._send(200, {"state": q.fail(body["job"], worker, int(body["token"]),
                                                        body.get("error", ""), metrics=body.get("metrics"),
                                                        permanent=bool(body.get("permanent")),
                                                        deferred=bool(body.get("deferred")))})
            if self.path == "/api/release":
                return self._send(200, {"ok": q.release(body["job"], worker, int(body["token"]),
                                                        body.get("reason", ""))})
            if self.path == "/api/stored":
                stored = float(q.get_meta("stored_bytes", "0") or 0) + float(body.get("bytes", 0))
                q.set_meta("stored_bytes", str(stored))
                return self._send(200, {"ok": True})
            if self.path == "/api/goodbye":
                q.set_worker(worker, state="leaving", note=body.get("reason"))
                me = next((w for w in q.workers() if w["id"] == worker), None)
                if me:
                    ctl.scheduler._stop(me, f"worker left: {body.get('reason')}")
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})

    return Handler
