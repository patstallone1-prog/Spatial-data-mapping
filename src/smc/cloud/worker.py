"""The worker: lease a job, restore its inputs, run the existing commands, save, report.

A worker owns nothing. Its job's starting folder is a checkpoint in the private store, its
shared inputs are trees in the private store, and what it produces goes back there before the
job is reported done -- so a worker can vanish at any moment and the job simply runs again
elsewhere from the same checkpoint. While a job runs, a heartbeat keeps its lease; if the
controller says the lease is gone (the job was reaped, or another worker has it), the job's
processes are killed at once and nothing is reported.

It stops itself when there has been no work for ``KERBSIDE_IDLE_EXIT_S`` or the controller has
been unreachable for ``KERBSIDE_CONTROLLER_LOST_S`` -- a worker never runs on, billing, with
no one to report to. On RunPod it also deletes its own pod (``runpodctl``, with the pod's own
scoped key); on Hetzner the server powers off and the controller or the watchdog deletes it.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .checkpoint import get_pointer, pull_tree, push_tree
from .store import ObjectStore, open_store

log = logging.getLogger("kerbside.worker")

#: argparse's usage error: the command itself is wrong, and trying again cannot help.
PERMANENT_EXIT_CODES = {2}


class Transport:
    """How a worker talks to the queue: over HTTP (:class:`HttpTransport`) or in-process."""

    def lease(self, resources, ttl):  # pragma: no cover - interface
        raise NotImplementedError


class HttpTransport(Transport):
    def __init__(self, base: str, worker_id: str, token: str, timeout: float = 30):
        self.base = base.rstrip("/")
        self.worker_id = worker_id
        self.token = token
        self.timeout = timeout

    def call(self, path: str, body: dict) -> dict:
        req = urllib.request.Request(
            f"{self.base}{path}", data=json.dumps({"worker": self.worker_id, **body}).encode(),
            method="POST", headers={"Authorization": f"Bearer {self.token}",
                                    "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as response:
            return json.loads(response.read() or b"{}")

    def lease(self, resources, ttl):
        return self.call("/api/lease", {"resources": resources, "ttl": ttl}).get("lease")

    def heartbeat(self, job, token, ttl):
        return self.call("/api/heartbeat", {"job": job, "token": token, "ttl": ttl}).get("ok", False)

    def complete(self, job, token, output, metrics):
        return self.call("/api/complete", {"job": job, "token": token, "output": output,
                                           "metrics": metrics}).get("ok", False)

    def fail(self, job, token, error, metrics, permanent):
        return self.call("/api/fail", {"job": job, "token": token, "error": error,
                                       "metrics": metrics, "permanent": permanent}).get("state")

    def release(self, job, token, reason):
        return self.call("/api/release", {"job": job, "token": token, "reason": reason}).get("ok")

    def goodbye(self, reason):
        return self.call("/api/goodbye", {"reason": reason})

    def stored(self, nbytes):
        return self.call("/api/stored", {"bytes": nbytes})


def bootstrap(env=os.environ) -> dict:
    """Trade the one-time boot token for this worker's environment."""
    base = env["KERBSIDE_CONTROLLER"].rstrip("/")
    body = json.dumps({"worker": env["KERBSIDE_WORKER_ID"], "boot": env["KERBSIDE_BOOT_TOKEN"]})
    last = None
    for attempt in range(30):
        try:
            req = urllib.request.Request(f"{base}/api/bootstrap", data=body.encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read())["env"]
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403, 410):
                raise SystemExit(f"bootstrap refused ({exc.code}); this worker is not wanted") from exc
            last = exc
        except OSError as exc:
            last = exc
        time.sleep(min(60, 2 ** attempt))
    raise SystemExit(f"controller unreachable at boot: {last}")


class Worker:
    def __init__(self, transport, private: ObjectStore, root: Path, *, worker_id: str,
                 resources: list[str], slots: int = 1, hourly_usd: float = 0.0,
                 lease_ttl_s: float = 120, idle_exit_s: float = 900, controller_lost_s: float = 1800,
                 poll_s: float = 10, env: dict | None = None, logs: Path | None = None):
        self.t = transport
        self.private = private
        self.root = Path(root)
        self.worker_id = worker_id
        self.resources = resources
        self.slots = slots
        self.hourly_usd = hourly_usd
        self.ttl = lease_ttl_s
        self.idle_exit_s = idle_exit_s
        self.controller_lost_s = controller_lost_s
        self.poll_s = poll_s
        self.env = env or {}
        self.logs = Path(logs or self.root / "build/cloud-logs")
        self.stopping = threading.Event()
        self.last_contact = time.time()
        self.last_work = time.time()
        self._shared_lock = threading.Lock()
        self._shared_done: dict[str, str] = {}
        self._busy = 0
        self._busy_lock = threading.Lock()
        self.completed: list[str] = []

    # -- the loop ---------------------------------------------------------------------------

    def run(self) -> str:
        threads = [threading.Thread(target=self._slot, name=f"slot-{i}", daemon=True)
                   for i in range(self.slots)]
        for th in threads:
            th.start()
        reason = "stopped"
        while not self.stopping.is_set():
            time.sleep(min(self.poll_s, 5))
            with self._busy_lock:
                busy = self._busy
            if not busy and time.time() - self.last_work > self.idle_exit_s:
                reason = "idle"
                break
            if time.time() - self.last_contact > self.controller_lost_s:
                reason = "controller lost"
                break
        self.stopping.set()
        for th in threads:
            th.join(timeout=60)
        with contextlib.suppress(Exception):  # the controller may be what is lost
            self.t.goodbye(reason)
        return reason

    def _slot(self) -> None:
        while not self.stopping.is_set():
            try:
                lease = self.t.lease(self.resources, self.ttl)
                self.last_contact = time.time()
            except Exception as exc:  # keep trying until the lost-controller limit
                log.warning("lease failed: %s", exc)
                self.stopping.wait(self.poll_s)
                continue
            if not lease:
                self.stopping.wait(self.poll_s)
                continue
            with self._busy_lock:
                self._busy += 1
            try:
                self.run_job(lease)
            finally:
                with self._busy_lock:
                    self._busy -= 1
                self.last_work = time.time()

    # -- one job ----------------------------------------------------------------------------

    def _restore_shared(self, names: list[str]) -> int:
        received = 0
        for name in names:
            pointer = get_pointer(self.private, f"shared-{name}")
            if pointer is None:
                raise RuntimeError(f"shared input {name!r} has not been uploaded (smc-cloud migrate)")
            with self._shared_lock:
                if self._shared_done.get(name) == pointer["tree"]:
                    continue
                received += pull_tree(self.private, pointer["tree"], self.root, clean=False).bytes_received
                self._shared_done[name] = pointer["tree"]
        return received

    def run_job(self, lease: dict) -> str:
        spec, token = lease["job"], lease["token"]
        job_id = spec["id"]
        started = time.time()
        lost = threading.Event()
        procs: list[subprocess.Popen] = []
        metrics = {"bytes_in": 0, "bytes_out": 0, "cpu_seconds": 0.0, "max_rss_mb": 0.0}

        def beat():
            while not lost.is_set() and not done.is_set():
                done.wait(self.ttl / 3)
                if done.is_set():
                    return
                try:
                    ok = self.t.heartbeat(job_id, token, self.ttl)
                    self.last_contact = time.time()
                except Exception as exc:  # one missed beat is not a lost lease
                    log.warning("heartbeat %s: %s", job_id, exc)
                    continue
                if not ok:
                    lost.set()
                    for p in procs:
                        _kill(p)

        done = threading.Event()
        beater = threading.Thread(target=beat, daemon=True)
        beater.start()
        log_path = self.logs / job_id.replace(":", "_") / f"{token}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(log_path, "ab") as out:
                for entry in lease.get("restore", []):
                    if entry.get("tree"):
                        metrics["bytes_in"] += pull_tree(self.private, entry["tree"], self.root).bytes_received
                metrics["bytes_in"] += self._restore_shared(spec.get("shared", []))
                env = {**os.environ, **self.env, **spec.get("env", {}),
                       "KERBSIDE_JOB": job_id, "KERBSIDE_ATTEMPT": str(token)}
                code = 0
                for step in spec.get("command", []):
                    if lost.is_set() or self.stopping.is_set():
                        break
                    argv = [sys.executable if step[0] == "python" else step[0], *step[1:]]
                    out.write(f"$ {' '.join(argv)}\n".encode())
                    out.flush()
                    proc = subprocess.Popen(argv, cwd=self.root, env=env, stdout=out,
                                            stderr=subprocess.STDOUT, start_new_session=True)
                    procs.append(proc)
                    code, usage = _wait(proc, deadline=started + spec.get("timeout_s", 8 * 3600),
                                        stop=lambda: lost.is_set() or self.stopping.is_set())
                    if usage:
                        metrics["cpu_seconds"] += usage.ru_utime + usage.ru_stime
                        # macOS reports bytes, Linux kilobytes.
                        rss = usage.ru_maxrss / (1 << 20 if sys.platform == "darwin" else 1024)
                        metrics["max_rss_mb"] = max(metrics["max_rss_mb"], rss)
                    if code != 0:
                        break
            metrics["seconds"] = round(time.time() - started, 1)
            metrics["exit_code"] = code
            metrics["cost_usd"] = round(metrics["seconds"] / 3600 * self.hourly_usd / max(1, self.slots), 6)
            if lost.is_set():
                return "lost"  # someone else has it now; a report would be refused
            if self.stopping.is_set() and code != 0:
                self.t.release(job_id, token, "worker stopping")
                return "released"
            tail = _tail(log_path)
            self._save_log(job_id, token, log_path)
            if code == -9999:
                self.t.fail(job_id, token, f"timed out after {spec.get('timeout_s')} s\n{tail}",
                            metrics, False)
                return "timeout"
            if code != 0:
                self.t.fail(job_id, token, f"exit {code}\n{tail}", metrics,
                            code in PERMANENT_EXIT_CODES)
                return "failed"
            stats = push_tree(self.private, self.root, spec.get("save", [])) if spec.get("save") else None
            output = {"tree": stats.tree, "files": stats.files, "bytes": stats.bytes_total} if stats else {}
            metrics["bytes_out"] = stats.bytes_sent if stats else 0
            if stats and stats.bytes_sent:
                with contextlib.suppress(Exception):  # storage accounting is best effort
                    self.t.stored(stats.bytes_sent)
            ok = self.t.complete(job_id, token, output, metrics)
            if ok:
                self.completed.append(job_id)
            return "done" if ok else "lost"
        except Exception as exc:  # any failure of ours is the attempt's failure
            metrics["seconds"] = round(time.time() - started, 1)
            if not lost.is_set():
                with contextlib.suppress(Exception):
                    self.t.fail(job_id, token, f"worker error: {type(exc).__name__}: {exc}", metrics, False)
            return "error"
        finally:
            done.set()
            for p in procs:
                _kill(p)

    def _save_log(self, job_id: str, token: int, path: Path) -> None:
        try:
            data = path.read_bytes()[-2_000_000:]
            self.private.put(f"logs/{job_id.replace(':', '/')}/{token}.log", data,
                             content_type="text/plain")
        except Exception as exc:  # a lost log is not a failed job
            log.warning("log upload %s: %s", job_id, exc)


def _wait(proc: subprocess.Popen, *, deadline: float, stop) -> tuple[int, object]:
    """Wait for ``proc``, with its own resource use; -9999 means it ran past ``deadline``."""
    while True:
        pid, status, usage = os.wait4(proc.pid, os.WNOHANG)
        if pid:
            proc.returncode = os.waitstatus_to_exitcode(status)
            return proc.returncode, usage
        if stop():
            _kill(proc)
            return -15, None
        if time.time() > deadline:
            _kill(proc)
            return -9999, None
        time.sleep(0.2)


def _kill(proc: subprocess.Popen) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        for _ in range(100):
            pid, status, _ = os.wait4(proc.pid, os.WNOHANG)
            if pid:
                proc.returncode = os.waitstatus_to_exitcode(status)
                return
            time.sleep(0.1)
        os.killpg(proc.pid, signal.SIGKILL)
        _, status, _ = os.wait4(proc.pid, 0)
        proc.returncode = os.waitstatus_to_exitcode(status)
    except (ProcessLookupError, ChildProcessError):
        proc.returncode = proc.returncode if proc.returncode is not None else -9


def _tail(path: Path, n: int = 4000) -> str:
    try:
        return path.read_bytes()[-n:].decode("utf-8", "replace")
    except OSError:
        return ""


def self_terminate(env=os.environ) -> None:
    """Delete this worker's own instance where the platform allows it (RunPod's ``runpodctl``,
    authorised by the pod's own scoped key); elsewhere the controller or watchdog deletes it."""
    pod = env.get("RUNPOD_POD_ID")
    if pod and shutil.which("runpodctl"):
        subprocess.run(["runpodctl", "remove", "pod", pod], check=False, timeout=60)


def main(env=os.environ) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if env.get("KERBSIDE_BOOT_TOKEN") and not env.get("KERBSIDE_WORKER_TOKEN"):
        os.environ.update(bootstrap(env))
        env = os.environ
    root = Path(env.get("KERBSIDE_ROOT", Path(__file__).resolve().parents[3]))
    seed = env.get("KERBSIDE_SEED_REPO")
    if seed and not root.exists():
        shutil.copytree(seed, root, symlinks=True)  # a fresh work tree (tests, scratch hosts)
    worker = Worker(
        HttpTransport(env["KERBSIDE_CONTROLLER"], env["KERBSIDE_WORKER_ID"], env["KERBSIDE_WORKER_TOKEN"]),
        open_store(env["KERBSIDE_PRIVATE_STORE"], role="private", env=env), root,
        worker_id=env["KERBSIDE_WORKER_ID"], resources=env.get("KERBSIDE_RESOURCES", "cpu").split(","),
        slots=int(env.get("KERBSIDE_SLOTS", "1")), hourly_usd=float(env.get("KERBSIDE_HOURLY_USD", "0")),
        lease_ttl_s=float(env.get("KERBSIDE_LEASE_TTL_S", "120")),
        idle_exit_s=float(env.get("KERBSIDE_IDLE_EXIT_S", "900")),
        controller_lost_s=float(env.get("KERBSIDE_CONTROLLER_LOST_S", "1800")),
        poll_s=float(env.get("KERBSIDE_POLL_S", "10")))
    signal.signal(signal.SIGTERM, lambda *_: worker.stopping.set())
    reason = worker.run()
    log.info("worker %s exiting: %s", worker.worker_id, reason)
    if reason in ("idle", "controller lost"):
        self_terminate(env)
    return 0
