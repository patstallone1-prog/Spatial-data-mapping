"""The durable job queue: every cell stage, house batch, gate and publication, in one SQLite file.

The controller is the only process that opens the database; workers reach it over HTTP
(:mod:`.controller`). A job is leased, not taken: the lease names its worker, carries a fencing
token (the attempt number) and expires unless heartbeated, so a worker that dies or is cut off
loses its job to the next worker and a late report from it is refused. Everything a job did is
kept in ``attempts``: the seconds, CPU, memory, bytes moved and what it cost.

States::

    pending      waiting for its dependencies or a worker
    leased       a worker has it; ``lease_expires`` says until when
    failed       the last attempt failed; tried again after ``not_before``
    done         finished; ``output`` names what it produced
    held         a gate held it for review; its dependants wait for a person
    quarantined  failed for good (or ``max_attempts`` times); nothing else waits on its fate
    cancelled    withdrawn by an operator

A job's dependants run only once it is ``done``. A quarantined or held job blocks only its own
dependants: every unrelated job carries on. An *optional* job whose tries run out is not
quarantined but skipped: recorded done, its output the checkpoint it started from, with
``skipped`` saying why, so the cell goes on without it. A job that stalled or ran past its time
is *deferred*: put behind every other ready job, so the workers move on to other cells first.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    stage TEXT NOT NULL,
    resource TEXT NOT NULL,
    spec TEXT NOT NULL,
    spec_digest TEXT NOT NULL,
    depends TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    max_attempts INTEGER NOT NULL DEFAULT 4,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_token INTEGER,
    lease_expires REAL,
    heartbeat_at REAL,
    not_before REAL NOT NULL DEFAULT 0,
    output TEXT,
    error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, resource, priority);
CREATE INDEX IF NOT EXISTS jobs_subject ON jobs(subject);
CREATE TABLE IF NOT EXISTS attempts (
    job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    worker TEXT NOT NULL,
    instance_type TEXT,
    started_at REAL NOT NULL,
    ended_at REAL,
    outcome TEXT,
    exit_code INTEGER,
    seconds REAL,
    cpu_seconds REAL,
    max_rss_mb REAL,
    bytes_in INTEGER,
    bytes_out INTEGER,
    cost_usd REAL,
    error TEXT,
    PRIMARY KEY (job_id, attempt)
);
CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    instance_id TEXT,
    resource TEXT NOT NULL,
    instance_type TEXT NOT NULL,
    hourly_usd REAL NOT NULL,
    state TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_seen REAL,
    last_busy REAL,
    terminated_at REAL,
    note TEXT
);
CREATE TABLE IF NOT EXISTS ledger (
    at REAL NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    usd REAL NOT NULL,
    note TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
    job_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    decision TEXT NOT NULL,
    reasons TEXT NOT NULL,
    reviewer TEXT,
    at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    at REAL NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    detail TEXT
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

#: Seconds before a failed job is tried again: doubling from a minute, never more than two hours
#: (a provider's outage -- "Service ROW/rightofway/MapServer not started" -- comes back).
BACKOFF_BASE_S = 60.0
BACKOFF_MAX_S = 2 * 3600.0
#: Added to a stalled or timed-out job's priority (lower runs first): every other cell's ready
#: work goes ahead of it, and it is tried again when nothing else is waiting.
DEFER_PRIORITY = 1000


@dataclass
class JobSpec:
    """What to run. ``id`` is the idempotency key: submitting it twice changes nothing."""

    id: str
    kind: str  # cell_stage | house_batch | interior_batch | restaurant_round | mesh_block | gate | publish | collect | bench
    subject: str  # the cell, region or house batch
    stage: str
    resource: str  # cpu | gpu | control
    #: The steps, each an argv run from the repository root, in order; the job fails at the
    #: first step that exits non-zero. Empty for the controller's own jobs (gate, publish).
    command: list[list[str]] = field(default_factory=list)
    depends: list[str] = field(default_factory=list)
    #: The checkpoint the job starts from: the outputs of these jobs, newest last.
    restore_from: list[str] = field(default_factory=list)
    #: Shared input trees (by name) the worker restores before running.
    shared: list[str] = field(default_factory=list)
    #: Folders of the work tree saved as this job's output, relative to the repository.
    save: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    timeout_s: float = 8 * 3600.0
    priority: int = 100
    max_attempts: int = 4
    #: Seconds without new log output or a written file before the worker stops the job.
    stall_s: float = 3600.0
    #: Skipped rather than quarantined when its tries run out (module docstring).
    optional: bool = False
    #: Folders of the restored checkpoint the job only adds to: not fetched, and still referenced
    #: in its saved tree (checkpoint.carry_forward). The house pipeline's 43 GB pixel store.
    carry: list[str] = field(default_factory=list)

    def digest(self) -> str:
        # The later fields count only when set, so a job submitted before they existed keeps
        # its digest and is not taken for a changed one.
        late = {"stall_s": 3600.0, "optional": False, "carry": []}
        body = {k: v for k, v in asdict(self).items()
                if k != "priority" and not (k in late and v == late[k])}
        return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]


class Queue:
    def __init__(self, path: Path | str, *, clock=time.time, backoff_base_s: float = BACKOFF_BASE_S):
        self.path = str(path)
        self.clock = clock
        self.backoff_base_s = backoff_base_s
        self._lock = threading.RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.executescript(SCHEMA)

    # -- plumbing ---------------------------------------------------------------------------

    @contextlib.contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            self._db.execute("COMMIT")

    def _event(self, db, kind: str, ref: str | None, detail: Any = None) -> None:
        db.execute("INSERT INTO events VALUES (?,?,?,?)",
                   (self.clock(), kind, ref, json.dumps(detail) if detail is not None else None))

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def backup_to(self, target: Path) -> None:
        """A consistent copy of the live database (SQLite's online backup)."""
        with self._lock:
            out = sqlite3.connect(str(target))
            try:
                self._db.backup(out)
            finally:
                out.close()

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        with self._tx() as db:
            db.execute("INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (key, value))

    # -- submission -------------------------------------------------------------------------

    def submit(self, spec: JobSpec, *, replace: bool = False, state: str | None = None,
               output: dict | None = None) -> str:
        """Add a job. Returns ``added``, ``kept`` (already there, unchanged or not replaceable)
        or ``replaced`` (its spec changed and ``replace`` was asked; it runs again).
        ``state='done'`` with an ``output`` records work already finished elsewhere."""
        now = self.clock()
        digest = spec.digest()
        with self._tx() as db:
            row = db.execute("SELECT state, spec_digest FROM jobs WHERE id=?", (spec.id,)).fetchone()
            if row is None:
                db.execute(
                    "INSERT INTO jobs (id, kind, subject, stage, resource, spec, spec_digest, depends,"
                    " priority, max_attempts, state, output, created_at, updated_at, finished_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (spec.id, spec.kind, spec.subject, spec.stage, spec.resource,
                     json.dumps(asdict(spec)), digest, json.dumps(spec.depends), spec.priority,
                     spec.max_attempts, state or "pending",
                     json.dumps(output) if output is not None else None, now, now,
                     now if state == "done" else None))
                self._event(db, "submit", spec.id, {"state": state or "pending"})
                return "added"
            if (row["spec_digest"] == digest or not replace
                    or row["state"] in ("leased", "done")):
                return "kept"
            db.execute(
                "UPDATE jobs SET spec=?, spec_digest=?, depends=?, priority=?, max_attempts=?,"
                " state='pending', attempts=0, not_before=0, output=NULL, error=NULL,"
                " updated_at=?, finished_at=NULL WHERE id=?",
                (json.dumps(asdict(spec)), digest, json.dumps(spec.depends), spec.priority,
                 spec.max_attempts, now, spec.id))
            self._event(db, "replace", spec.id)
            return "replaced"

    # -- readiness and leasing --------------------------------------------------------------

    def _ready_rows(self, db, resources: list[str], now: float, limit: int | None = None):
        marks = ",".join("?" * len(resources))
        # Kinds the operator has paused (controller.paused_kinds) wait, without blocking the rest.
        held = db.execute("SELECT value FROM meta WHERE key='paused_kinds'").fetchone()
        paused = set(json.loads(held["value"])) if held and held["value"] else set()
        rows = db.execute(
            f"SELECT * FROM jobs WHERE resource IN ({marks}) AND state IN ('pending','failed')"
            " AND not_before <= ? ORDER BY priority, created_at, id", (*resources, now)).fetchall()
        rows = [row for row in rows if row["kind"] not in paused]
        done = {r["id"] for r in db.execute("SELECT id FROM jobs WHERE state='done'")}
        out = []
        for row in rows:
            if all(d in done for d in json.loads(row["depends"])):
                out.append(row)
                if limit and len(out) >= limit:
                    break
        return out

    def ready_count(self, resource: str) -> int:
        with self._lock:
            return len(self._ready_rows(self._db, [resource], self.clock()))

    def lease(self, worker: str, resources: list[str], ttl_s: float,
              instance_type: str | None = None, caps: dict[str, int] | None = None) -> dict | None:
        """The highest-priority ready job for these resources, leased to ``worker``.

        Two preferences on top of the priority order (2026-10-29, both to waste less time):
        a stage in ``caps`` is not leased to a worker already running that many of it (Overpass
        throttles one address's burst of cells into timeouts), and a worker is offered the next
        stage of a subject it has just worked on before anyone else's -- its restored files and
        its photo cache are already on its disk, where another worker would fetch them again."""
        now = self.clock()
        with self._tx() as db:
            rows = self._ready_rows(db, resources, now)
            if caps:
                running: dict[str, int] = {}
                for r in db.execute("SELECT stage FROM jobs WHERE state='leased' AND lease_owner=?",
                                    (worker,)):
                    running[r["stage"]] = running.get(r["stage"], 0) + 1
                rows = [r for r in rows if r["stage"] not in caps
                        or running.get(r["stage"], 0) < caps[r["stage"]]]
            if not rows:
                return None
            recent = {r["subject"] for r in db.execute(
                "SELECT j.subject FROM attempts a JOIN jobs j ON j.id = a.job_id WHERE a.worker=?"
                " AND a.started_at > ? ORDER BY a.started_at DESC LIMIT 24", (worker, now - 3 * 3600))}
            # Only a fresh next stage: a retry keeps its place (a stalled one goes to the back).
            row = next((r for r in rows if r["subject"] in recent and r["state"] == "pending"), rows[0])
            token = row["attempts"] + 1
            changed = db.execute(
                "UPDATE jobs SET state='leased', attempts=?, lease_owner=?, lease_token=?,"
                " lease_expires=?, heartbeat_at=?, updated_at=? WHERE id=? AND state=?",
                (token, worker, token, now + ttl_s, now, now, row["id"], row["state"])).rowcount
            if not changed:
                return None
            db.execute("INSERT OR REPLACE INTO attempts (job_id, attempt, worker, instance_type,"
                       " started_at) VALUES (?,?,?,?,?)", (row["id"], token, worker, instance_type, now))
            db.execute("UPDATE workers SET last_busy=?, last_seen=?, state='busy' WHERE id=?",
                       (now, now, worker))
            self._event(db, "lease", row["id"], {"worker": worker, "token": token})
            spec = json.loads(row["spec"])
            # Where to start from: the latest output among the jobs this one restores from.
            restore = []
            for dep in spec.get("restore_from", []):
                out = db.execute("SELECT output FROM jobs WHERE id=?", (dep,)).fetchone()
                if out and out["output"]:
                    restore.append({"job": dep, **json.loads(out["output"])})
            return {"job": spec, "token": token, "lease_expires": now + ttl_s, "restore": restore}

    def heartbeat(self, job_id: str, worker: str, token: int, ttl_s: float) -> bool:
        """Extend a lease. False means the lease is gone: the worker must stop the job."""
        now = self.clock()
        with self._tx() as db:
            changed = db.execute(
                "UPDATE jobs SET lease_expires=?, heartbeat_at=?, updated_at=? WHERE id=? AND"
                " state='leased' AND lease_owner=? AND lease_token=?",
                (now + ttl_s, now, now, job_id, worker, token)).rowcount
            db.execute("UPDATE workers SET last_seen=?, last_busy=? WHERE id=?", (now, now, worker))
        return bool(changed)

    def _finish_attempt(self, db, job_id: str, token: int, outcome: str, metrics: dict | None,
                        error: str | None) -> None:
        m = metrics or {}
        db.execute(
            "UPDATE attempts SET ended_at=?, outcome=?, exit_code=?, seconds=?, cpu_seconds=?,"
            " max_rss_mb=?, bytes_in=?, bytes_out=?, cost_usd=?, error=? WHERE job_id=? AND attempt=?",
            (self.clock(), outcome, m.get("exit_code"), m.get("seconds"), m.get("cpu_seconds"),
             m.get("max_rss_mb"), m.get("bytes_in"), m.get("bytes_out"), m.get("cost_usd"),
             (error or "")[-2000:] or None, job_id, token))
        if m.get("cost_usd"):
            db.execute("INSERT INTO ledger VALUES (?,?,?,?,?)",
                       (self.clock(), "job_compute", job_id, m["cost_usd"], outcome))

    def complete(self, job_id: str, worker: str, token: int, output: dict,
                 metrics: dict | None = None) -> bool:
        now = self.clock()
        with self._tx() as db:
            changed = db.execute(
                "UPDATE jobs SET state='done', output=?, error=NULL, lease_owner=NULL,"
                " lease_expires=NULL, updated_at=?, finished_at=? WHERE id=? AND state='leased'"
                " AND lease_owner=? AND lease_token=?",
                (json.dumps(output), now, now, job_id, worker, token)).rowcount
            if changed:
                self._finish_attempt(db, job_id, token, "done", metrics, None)
                self._event(db, "done", job_id, {"worker": worker})
        return bool(changed)

    def fail(self, job_id: str, worker: str, token: int, error: str, *,
             metrics: dict | None = None, permanent: bool = False,
             deferred: bool = False) -> str | None:
        """Record a failed attempt. Returns the job's new state (``skipped`` for an optional job
        recorded done without its work), or None for a stale report. ``deferred``: it stalled or
        ran out of time, so it goes behind every other ready job."""
        now = self.clock()
        with self._tx() as db:
            row = db.execute("SELECT attempts, max_attempts, priority, spec FROM jobs WHERE id=? AND"
                             " state='leased' AND lease_owner=? AND lease_token=?",
                             (job_id, worker, token)).fetchone()
            if row is None:
                return None
            state = "quarantined" if permanent or row["attempts"] >= row["max_attempts"] else "failed"
            if state == "quarantined" and self._skip(db, job_id, row, error, now):
                self._finish_attempt(db, job_id, token, "skipped", metrics, error)
                return "skipped"
            wait = min(self.backoff_base_s * 2 ** max(0, row["attempts"] - 1), BACKOFF_MAX_S)
            priority = row["priority"] + (DEFER_PRIORITY if deferred and state == "failed" else 0)
            db.execute(
                "UPDATE jobs SET state=?, error=?, lease_owner=NULL, lease_expires=NULL,"
                " not_before=?, priority=?, updated_at=?, finished_at=? WHERE id=?",
                (state, error[-4000:], now + wait, priority, now,
                 now if state == "quarantined" else None, job_id))
            self._finish_attempt(db, job_id, token, state, metrics, error)
            self._event(db, state, job_id, {"worker": worker, "error": error[-500:],
                                            **({"deferred": True} if deferred else {})})
        return state

    def _skip(self, db, job_id: str, row, error: str, now: float) -> bool:
        """An optional job out of tries: done, carrying forward the checkpoint it started from."""
        spec = json.loads(row["spec"])
        if not spec.get("optional"):
            return False
        output: dict = {}
        for dep in spec.get("restore_from", []):
            found = db.execute("SELECT output FROM jobs WHERE id=?", (dep,)).fetchone()
            if found and found["output"]:
                output = json.loads(found["output"])
        output = {k: v for k, v in output.items() if k in ("tree", "files", "bytes")}
        output["skipped"] = error.strip().splitlines()[0][:300] if error.strip() else "out of tries"
        db.execute("UPDATE jobs SET state='done', output=?, error=?, lease_owner=NULL,"
                   " lease_expires=NULL, updated_at=?, finished_at=? WHERE id=?",
                   (json.dumps(output), error[-4000:], now, now, job_id))
        self._event(db, "skipped", job_id, {"error": error[-500:]})
        return True

    def release(self, job_id: str, worker: str, token: int, reason: str) -> bool:
        """Give a job back without counting the attempt (the worker is being shut down)."""
        now = self.clock()
        with self._tx() as db:
            changed = db.execute(
                "UPDATE jobs SET state='pending', attempts=MAX(0, attempts-1), lease_owner=NULL,"
                " lease_expires=NULL, updated_at=? WHERE id=? AND state='leased' AND lease_owner=?"
                " AND lease_token=?", (now, job_id, worker, token)).rowcount
            if changed:
                db.execute("DELETE FROM attempts WHERE job_id=? AND attempt=?", (job_id, token))
                self._event(db, "release", job_id, {"worker": worker, "reason": reason})
        return bool(changed)

    def reap_expired(self) -> list[str]:
        """Leases whose worker stopped heartbeating: the attempt failed, the job is tried again."""
        now = self.clock()
        reaped = []
        with self._tx() as db:
            rows = db.execute("SELECT id, lease_owner, lease_token, attempts, max_attempts, spec"
                              " FROM jobs WHERE state='leased' AND lease_expires < ?",
                              (now,)).fetchall()
            for row in rows:
                error = f"lease expired: worker {row['lease_owner']} stopped reporting"
                state = "quarantined" if row["attempts"] >= row["max_attempts"] else "failed"
                if state == "quarantined" and self._skip(db, row["id"], row, error, now):
                    self._finish_attempt(db, row["id"], row["lease_token"], "skipped", None, error)
                    reaped.append(row["id"])
                    continue
                db.execute("UPDATE jobs SET state=?, error=?, lease_owner=NULL, lease_expires=NULL,"
                           " not_before=?, updated_at=? WHERE id=?",
                           (state, error, now, now, row["id"]))
                self._finish_attempt(db, row["id"], row["lease_token"], "lease_expired", None,
                                     "lease expired")
                self._event(db, "lease_expired", row["id"], {"worker": row["lease_owner"]})
                reaped.append(row["id"])
        return reaped

    # -- review -----------------------------------------------------------------------------

    def hold(self, job_id: str, worker: str, token: int, reasons: list[str], output: dict) -> bool:
        """A gate's verdict that a person must look: the job and its dependants wait."""
        now = self.clock()
        with self._tx() as db:
            row = db.execute("SELECT subject FROM jobs WHERE id=? AND state='leased' AND"
                             " lease_owner=? AND lease_token=?", (job_id, worker, token)).fetchone()
            if row is None:
                return False
            db.execute("UPDATE jobs SET state='held', output=?, error=?, lease_owner=NULL,"
                       " lease_expires=NULL, updated_at=?, finished_at=? WHERE id=?",
                       (json.dumps(output), "; ".join(reasons)[:4000], now, now, job_id))
            db.execute("INSERT INTO reviews VALUES (?,?,?,?,?,?)",
                       (job_id, row["subject"], "held", json.dumps(reasons), "gate", now))
            self._finish_attempt(db, job_id, token, "held", None, None)
            self._event(db, "held", job_id, {"reasons": reasons})
        return True

    def review(self, job_id: str, decision: str, reviewer: str, note: str) -> bool:
        """A person's decision on a held job: ``approve`` lets its dependants run, ``reject``
        quarantines it, ``rerun`` sends it back to the queue."""
        if decision not in ("approve", "reject", "rerun"):
            raise ValueError("decision is approve, reject or rerun")
        if not reviewer or not note:
            raise ValueError("a review names its reviewer and gives its reason")
        now = self.clock()
        with self._tx() as db:
            row = db.execute("SELECT subject, output FROM jobs WHERE id=? AND state='held'",
                             (job_id,)).fetchone()
            if row is None:
                return False
            output = json.loads(row["output"] or "{}")
            if decision == "approve":
                output.update(decision="approved", reviewer=reviewer, note=note)
                db.execute("UPDATE jobs SET state='done', output=?, updated_at=? WHERE id=?",
                           (json.dumps(output), now, job_id))
            elif decision == "reject":
                db.execute("UPDATE jobs SET state='quarantined', error=?, updated_at=? WHERE id=?",
                           (f"rejected by {reviewer}: {note}", now, job_id))
            else:
                db.execute("UPDATE jobs SET state='pending', attempts=0, not_before=0, output=NULL,"
                           " error=NULL, updated_at=? WHERE id=?", (now, job_id))
            db.execute("INSERT INTO reviews VALUES (?,?,?,?,?,?)",
                       (job_id, row["subject"], decision, json.dumps([note]), reviewer, now))
            self._event(db, f"review_{decision}", job_id, {"reviewer": reviewer})
        return True

    def requeue(self, job_id: str, operator: str) -> bool:
        """Send a quarantined or cancelled job back, its attempts reset."""
        now = self.clock()
        with self._tx() as db:
            changed = db.execute("UPDATE jobs SET state='pending', attempts=0, not_before=0,"
                                 " error=NULL, updated_at=? WHERE id=? AND state IN"
                                 " ('quarantined','cancelled','failed')", (now, job_id)).rowcount
            if changed:
                self._event(db, "requeue", job_id, {"operator": operator})
        return bool(changed)

    def redo(self, job_id: str, operator: str, note: str) -> list[str]:
        """Run a finished job again, and everything downstream of it: what it made was wrong
        (a stage that ran without a credential, skipped and recorded done). Each goes back to
        pending with its attempts and output cleared, so each restores from the one before it.
        A job being run now is left to finish. Returns the jobs sent back."""
        if not operator or not note:
            raise ValueError("a redo names its operator and gives its reason")
        now = self.clock()
        with self._tx() as db:
            rows = {r["id"]: (r["state"], json.loads(r["depends"]))
                    for r in db.execute("SELECT id, state, depends FROM jobs")}
            if job_id not in rows:
                return []
            wanted, frontier = {job_id}, [job_id]
            while frontier:
                current = frontier.pop()
                for other, (_, depends) in rows.items():
                    if current in depends and other not in wanted:
                        wanted.add(other)
                        frontier.append(other)
            sent = sorted(j for j in wanted if rows[j][0] != "leased")
            for j in sent:
                db.execute("UPDATE jobs SET state='pending', attempts=0, not_before=0, output=NULL,"
                           " error=NULL, updated_at=? WHERE id=?", (now, j))
            self._event(db, "redo", job_id, {"operator": operator, "note": note, "jobs": sent})
        return sent

    def failed_with(self, pattern: str, stages: tuple[str, ...]) -> list[str]:
        """The subjects whose attempts at any of ``stages`` failed with ``pattern`` in the error."""
        with self._lock:
            rows = self._db.execute(
                "SELECT DISTINCT j.subject FROM attempts a JOIN jobs j ON j.id = a.job_id"
                f" WHERE j.stage IN ({','.join('?' * len(stages))}) AND a.error LIKE ?",
                (*stages, f"%{pattern}%")).fetchall()
        return sorted(r["subject"] for r in rows)

    def cancel(self, job_id: str, operator: str) -> bool:
        now = self.clock()
        with self._tx() as db:
            changed = db.execute("UPDATE jobs SET state='cancelled', updated_at=? WHERE id=? AND"
                                 " state IN ('pending','failed')", (now, job_id)).rowcount
            if changed:
                self._event(db, "cancel", job_id, {"operator": operator})
        return bool(changed)

    # -- workers and money ------------------------------------------------------------------

    def add_worker(self, worker_id: str, provider: str, resource: str, instance_type: str,
                   hourly_usd: float, instance_id: str | None = None, note: str | None = None) -> None:
        now = self.clock()
        with self._tx() as db:
            db.execute("INSERT OR REPLACE INTO workers VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                       (worker_id, provider, instance_id, resource, instance_type, hourly_usd,
                        "starting", now, now, now, None, note))
            self._event(db, "worker_start", worker_id, {"provider": provider, "type": instance_type})

    def set_worker(self, worker_id: str, **fields: Any) -> None:
        if not fields:
            return
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._tx() as db:
            db.execute(f"UPDATE workers SET {cols} WHERE id=?", (*fields.values(), worker_id))

    def seen(self, worker_id: str) -> None:
        with self._tx() as db:
            db.execute("UPDATE workers SET last_seen=?, state=CASE WHEN state='starting' THEN"
                       " 'idle' ELSE state END WHERE id=?", (self.clock(), worker_id))

    def workers(self, live_only: bool = True) -> list[dict]:
        with self._lock:
            sql = "SELECT * FROM workers" + (" WHERE terminated_at IS NULL" if live_only else "")
            return [dict(r) for r in self._db.execute(sql)]

    def worker_busy(self, worker_id: str) -> bool:
        with self._lock:
            return self._db.execute("SELECT 1 FROM jobs WHERE state='leased' AND lease_owner=?",
                                    (worker_id,)).fetchone() is not None

    def terminate_worker(self, worker_id: str, reason: str) -> None:
        """The instance is gone (or being deleted): its leases are failed now, not at expiry."""
        now = self.clock()
        with self._tx() as db:
            row = db.execute("SELECT created_at, hourly_usd, terminated_at FROM workers WHERE id=?",
                             (worker_id,)).fetchone()
            if row is None or row["terminated_at"]:
                return
            db.execute("UPDATE workers SET state='terminated', terminated_at=?, note=? WHERE id=?",
                       (now, reason, worker_id))
            hours = max(0.0, now - row["created_at"]) / 3600
            db.execute("INSERT INTO ledger VALUES (?,?,?,?,?)",
                       (now, "instance", worker_id, hours * row["hourly_usd"], reason))
            for job in db.execute("SELECT id FROM jobs WHERE state='leased' AND lease_owner=?",
                                  (worker_id,)).fetchall():
                db.execute("UPDATE jobs SET lease_expires=? WHERE id=?", (now - 1, job["id"]))
            self._event(db, "worker_stop", worker_id, {"reason": reason})

    def spend(self, since: float) -> float:
        """Money spent since ``since``: instances already stopped (from the ledger) plus the
        running instances' time so far; job costs are a share of instance time, not added."""
        now = self.clock()
        with self._lock:
            stopped = self._db.execute("SELECT COALESCE(SUM(usd),0) FROM ledger WHERE kind IN"
                                       " ('instance','storage','transfer','controller') AND at >= ?",
                                       (since,)).fetchone()[0]
            running = sum(max(0.0, now - max(r["created_at"], since)) / 3600 * r["hourly_usd"]
                          for r in self._db.execute("SELECT * FROM workers WHERE terminated_at IS NULL"))
        return float(stopped) + running

    def charge(self, kind: str, usd: float, ref: str | None = None, note: str | None = None) -> None:
        with self._tx() as db:
            db.execute("INSERT INTO ledger VALUES (?,?,?,?,?)", (self.clock(), kind, ref, usd, note))

    # -- reading ----------------------------------------------------------------------------

    def job(self, job_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        return _row(row) if row else None

    def jobs(self, *, state: str | None = None, subject: str | None = None,
             kind: str | None = None) -> list[dict]:
        where, args = [], []
        for col, value in (("state", state), ("subject", subject), ("kind", kind)):
            if value is not None:
                where.append(f"{col}=?")
                args.append(value)
        sql = "SELECT * FROM jobs" + (" WHERE " + " AND ".join(where) if where else "")
        with self._lock:
            return [_row(r) for r in self._db.execute(sql + " ORDER BY created_at, id", args)]

    def attempts(self, job_id: str | None = None) -> list[dict]:
        with self._lock:
            sql = "SELECT * FROM attempts" + (" WHERE job_id=?" if job_id else "")
            return [dict(r) for r in self._db.execute(sql + " ORDER BY started_at",
                                                      (job_id,) if job_id else ())]

    def events(self, limit: int = 200) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._db.execute(
                "SELECT * FROM events ORDER BY at DESC LIMIT ?", (limit,))]

    def counts(self) -> dict[str, dict[str, int]]:
        with self._lock:
            out: dict[str, dict[str, int]] = {}
            for r in self._db.execute("SELECT kind, state, COUNT(*) n FROM jobs GROUP BY kind, state"):
                out.setdefault(r["kind"], {})[r["state"]] = r["n"]
        return out

    def blocked(self) -> list[str]:
        """Jobs that cannot run until a person acts: a dependency is held or quarantined."""
        with self._lock:
            stuck = {r["id"] for r in self._db.execute(
                "SELECT id FROM jobs WHERE state IN ('held','quarantined','cancelled')")}
            out = []
            for r in self._db.execute("SELECT id, depends FROM jobs WHERE state IN ('pending','failed')"):
                if stuck & set(json.loads(r["depends"])):
                    out.append(r["id"])
        return out


def _row(row: sqlite3.Row) -> dict:
    out = dict(row)
    for key in ("spec", "depends", "output"):
        if out.get(key):
            out[key] = json.loads(out[key])
    return out
