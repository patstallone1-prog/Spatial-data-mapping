"""Workers on when there is work, off when there is not, and never more than the money allows.

Each tick:

1. **Reap** leases whose worker stopped heartbeating: the attempt failed, the job goes back.
2. **Reconcile** with what the providers say exists. An instance labelled ours that the queue
   does not know (the controller crashed between launch and record, or a stop failed) is
   deleted; a worker the queue thinks is live but the provider has no instance for is recorded
   gone and its leases failed. A worker silent past its grace is deleted as hung.
3. **Budget**: at the hard limit every worker is stopped and nothing is launched.
4. **Retire** workers idle past their pool's idle time, or older than its ``max_hours`` once they
   finish what they hold.
5. **Launch** workers where ready jobs outnumber free slots, one pool at a time, each launch
   checked against the budget.
"""

from __future__ import annotations

import logging
import math
import secrets
import time
from dataclasses import dataclass, field

from . import budget as money
from .providers import Pool, Provider, ProviderError
from .queue import Queue

log = logging.getLogger("kerbside.scheduler")


@dataclass
class Settings:
    pools: dict[str, Pool]
    budget: money.Budget
    #: Seconds a booting worker has to call in before it counts as lost.
    boot_grace_s: float = 900
    #: Seconds a running worker may go without reporting.
    silence_grace_s: float = 300
    max_launches_per_tick: int = 4
    paused: bool = False
    extra: dict = field(default_factory=dict)


class Scheduler:
    def __init__(self, queue: Queue, providers: dict[str, Provider], settings: Settings,
                 bootstrap, *, clock=time.time):
        """``bootstrap(worker_id, pool) -> dict`` issues the one-time boot environment."""
        self.queue = queue
        self.providers = providers
        self.settings = settings
        self.bootstrap = bootstrap
        self.clock = clock
        self.last: dict = {}

    def _provider(self, pool: Pool) -> Provider:
        return self.providers[pool.provider]

    def _stop(self, worker: dict, reason: str) -> None:
        provider = self.providers.get(worker["provider"])
        try:
            if provider and worker.get("instance_id"):
                provider.terminate(worker["instance_id"])
        except ProviderError as exc:
            # Recorded, and tried again next tick through reconciliation: the instance is
            # still labelled ours, so it will be found and deleted.
            log.warning("stop %s failed: %s", worker["id"], exc)
            self.queue.set_worker(worker["id"], state="stopping", note=f"stop failed: {exc}")
            return
        self.queue.terminate_worker(worker["id"], reason)

    def tick(self) -> dict:
        now = self.clock()
        report = {"reaped": self.queue.reap_expired(), "launched": [], "stopped": [], "orphans": []}
        live = self.queue.workers()
        known_instances = {w["instance_id"] for w in live if w.get("instance_id")}

        # 2. reconcile
        seen: set[str] = set()
        for name, provider in self.providers.items():
            try:
                instances = provider.list()
            except ProviderError as exc:
                log.warning("cannot list %s: %s", name, exc)
                report.setdefault("errors", []).append(f"{name}: {exc}")
                seen |= {w["instance_id"] for w in live if w["provider"] == name}
                continue
            for inst in instances:
                seen.add(inst.id)
                if inst.id not in known_instances:
                    try:
                        provider.terminate(inst.id)
                        report["orphans"].append(inst.id)
                    except ProviderError as exc:
                        log.warning("orphan %s not deleted: %s", inst.id, exc)
        for worker in live:
            age = now - worker["created_at"]
            silent = now - (worker["last_seen"] or worker["created_at"])
            if worker.get("instance_id") not in seen and age > 60:
                self.queue.terminate_worker(worker["id"], "instance gone")
                report["stopped"].append((worker["id"], "instance gone"))
            elif worker["state"] == "starting" and age > self.settings.boot_grace_s:
                self._stop(worker, "never called in")
                report["stopped"].append((worker["id"], "never called in"))
            elif worker["state"] != "starting" and silent > self.settings.silence_grace_s:
                self._stop(worker, "silent")
                report["stopped"].append((worker["id"], "silent"))
            elif worker["state"] == "stopping":
                self._stop(worker, "retrying stop")

        # 3. budget
        status = money.status(self.queue, self.settings.budget, now)
        report["budget"] = status
        if status["hard_stop"]:
            for worker in self.queue.workers():
                self._stop(worker, "hard budget limit")
                report["stopped"].append((worker["id"], "hard budget limit"))
            self.queue.set_meta("paused", "hard budget limit")
            self.last = report
            return report
        paused = self.settings.paused or self.queue.get_meta("paused") not in (None, "")

        # 4. retire idle and old workers
        for worker in self.queue.workers():
            pool = self.settings.pools.get(worker["resource"])
            if pool is None or worker["state"] in ("starting", "stopping"):
                continue
            busy = self.queue.worker_busy(worker["id"])
            idle_for = now - (worker["last_busy"] or worker["created_at"])
            too_old = now - worker["created_at"] > pool.max_hours * 3600
            nothing_ready = self.queue.ready_count(pool.name) == 0
            if not busy and (too_old or paused or (idle_for > pool.idle_minutes * 60 and nothing_ready)):
                reason = "too old" if too_old else "paused" if paused else "idle"
                self._stop(worker, reason)
                report["stopped"].append((worker["id"], reason))
            elif too_old:
                self.queue.set_worker(worker["id"], state="draining")

        # 5. launch
        launches = 0
        if not paused:
            for name, pool in self.settings.pools.items():
                ready = self.queue.ready_count(name)
                if not ready:
                    continue
                workers = [w for w in self.queue.workers() if w["resource"] == name
                           and w["state"] != "draining"]
                free = sum(pool.slots - self._busy_slots(w["id"]) for w in workers
                           if w["state"] != "starting") + pool.slots * sum(
                    1 for w in workers if w["state"] == "starting")
                want = min(pool.max_workers - len(workers),
                           math.ceil(max(0, ready - free) / pool.slots))
                for _ in range(max(0, want)):
                    if launches >= self.settings.max_launches_per_tick:
                        break
                    allowed, why = money.may_launch(self.queue, self.settings.budget, pool, now)
                    if not allowed:
                        report.setdefault("held_back", []).append(f"{name}: {why}")
                        break
                    worker_id = f"kw-{name}-{secrets.token_hex(4)}"
                    boot = self.bootstrap(worker_id, pool)
                    try:
                        instance = self._provider(pool).launch(worker_id, pool, boot)
                    except ProviderError as exc:
                        report.setdefault("errors", []).append(f"launch {name}: {exc}")
                        break
                    self.queue.add_worker(worker_id, pool.provider, name, pool.instance_type,
                                          pool.hourly_usd, instance.id)
                    report["launched"].append(worker_id)
                    launches += 1
        money.charge_storage(self.queue, now)
        self.last = report
        return report

    def _busy_slots(self, worker_id: str) -> int:
        return sum(1 for j in self.queue.jobs(state="leased") if j["lease_owner"] == worker_id)

    def stop_all(self, reason: str) -> list[str]:
        stopped = []
        for worker in self.queue.workers():
            self._stop(worker, reason)
            stopped.append(worker["id"])
        return stopped
