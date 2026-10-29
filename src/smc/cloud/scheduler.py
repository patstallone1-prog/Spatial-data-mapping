"""Workers on when there is work, off when there is not, and never more than the money allows.

Each tick:

1. **Reap** leases whose worker stopped heartbeating: the attempt failed, the job goes back.
2. **Reconcile** with what the providers say exists. An instance labelled ours that the queue
   does not know (the controller crashed between launch and record, or a stop failed) is
   deleted; a worker the queue thinks is live but the provider has no instance for is recorded
   gone and its leases failed. A worker silent past its grace is deleted as hung.
3. **Budget**: at the hard limit every worker is stopped and nothing is launched (until the
   month turns); past today's limit every worker drains and nothing is launched until tomorrow.
4. **Pack**: with nothing ready, a pool whose jobs would fit on one worker fewer stops leasing to
   its emptiest worker, which is stopped as soon as it is empty; rented time always has work
   (2026-10-28, the owner). Work arriving lifts the packing before anything new is rented.
5. **Retire** workers idle past their pool's idle time, or older than its ``max_hours`` once they
   finish what they hold.
6. **Launch** workers where ready jobs outnumber free slots, one pool at a time, each launch
   checked against the budget; a second worker needs ``min_fill`` jobs of its own.
7. **Warn** when today's idle time has cost ``budget.warn_usd`` or a budget is nearly spent.
"""

from __future__ import annotations

import json
import logging
import math
import secrets
import time
from dataclasses import dataclass, field

from . import budget as money
from .providers import Pool, Provider, ProviderError
from .queue import Queue

log = logging.getLogger("kerbside.scheduler")

#: Hours of the running workers' spend the provider balance must cover, or they are stopped.
BALANCE_RESERVE_H = 0.5


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
    #: The controller's own pod, charged to the budget while it runs.
    controller_hourly_usd: float = 0.0
    extra: dict = field(default_factory=dict)


def work_waiting(queue: Queue, settings: Settings, now: float | None = None) -> tuple[bool, str]:
    """Whether the controller has anything it could do now: a worker running or a job leased,
    a gate or publication ready, or a pool's ready work the budget would launch a worker for.
    The controller sleeps when this has been false a while; the watchdog wakes it when true."""
    now = now or queue.clock()
    if queue.workers():
        return True, "workers running"
    if queue.jobs(state="leased"):
        return True, "a job is leased"
    status = money.status(queue, settings.budget, now)
    if status["hard_stop"]:
        return False, "hard monthly limit reached"
    if queue.get_meta("paused") not in (None, "", "hard budget limit"):
        return False, f"paused: {queue.get_meta('paused')}"
    if queue.ready_count("control"):
        return True, "a gate or publication is ready"
    for name, pool in settings.pools.items():
        if queue.ready_count(name):
            allowed, why = money.may_launch(queue, settings.budget, pool, now)
            if allowed:
                return True, f"{name} work is ready"
            return False, f"{name} work waits on the budget: {why}"
    return False, "nothing ready"


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
        self._ticked_at: float | None = None
        self._balance: tuple[float, float | None] | None = None  # (asked at, prepaid balance)

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
        money.charge_controller(self.queue, self.settings.controller_hourly_usd, now)
        status = money.status(self.queue, self.settings.budget, now)
        report["budget"] = status
        if status["hard_stop"]:
            for worker in self.queue.workers():
                self._stop(worker, "hard budget limit")
                report["stopped"].append((worker["id"], "hard budget limit"))
            self.queue.set_meta("paused", "hard budget limit")
            self.last = report
            return report
        # The provider's prepaid balance: at $0 RunPod deletes every pod, the controller's too
        # (2026-10-29). Under half an hour of what is running, the workers are stopped -- their
        # jobs go back to the queue -- so the controller and its queue outlive the balance.
        balance = self.balance(now)
        burn = sum(w["hourly_usd"] for w in self.queue.workers()) + self.settings.controller_hourly_usd
        if balance is not None and self.queue.workers() and balance < burn * BALANCE_RESERVE_H:
            for worker in self.queue.workers():
                self._stop(worker, "provider balance low")
                report["stopped"].append((worker["id"], "provider balance low"))
        if self.queue.get_meta("paused") == "hard budget limit":
            # A new month (or a raised limit): the stop was the budget's, and the budget allows.
            self.queue.set_meta("paused", "")
            report["resumed"] = "below the hard limit again"
        paused = self.settings.paused or self.queue.get_meta("paused") not in (None, "")
        spent_today = money.over_daily(self.queue, self.settings.budget, now)
        if spent_today:
            report["held_back"] = [f"daily budget spent (${status['today_usd']:.2f} of "
                                   f"${self.settings.budget.daily_usd:.2f}); draining until tomorrow"]
            for worker in self.queue.workers():
                if worker["state"] not in ("starting", "stopping", "draining"):
                    self.queue.set_worker(worker["id"], state="draining")

        # 4. pack
        packing = self._pack(report)

        # 5. retire idle, emptied and old workers
        for worker in self.queue.workers():
            pool = self.settings.pools.get(worker["resource"])
            if pool is None or worker["state"] in ("starting", "stopping"):
                continue
            busy = self.queue.worker_busy(worker["id"])
            idle_for = now - (worker["last_busy"] or worker["created_at"])
            too_old = now - worker["created_at"] > pool.max_hours * 3600
            nothing_ready = self.queue.ready_count(pool.name) == 0
            draining = worker["state"] == "draining"
            packed = worker["id"] in packing
            if not busy and (too_old or paused or draining or packed
                             or (idle_for > pool.idle_minutes * 60 and nothing_ready)):
                reason = ("too old" if too_old else "paused" if paused
                          else "daily budget" if draining else "packed" if packed else "idle")
                self._stop(worker, reason)
                report["stopped"].append((worker["id"], reason))
            elif too_old:
                self.queue.set_worker(worker["id"], state="draining")

        # 6. launch
        launches = 0
        if not paused and not spent_today:
            for name, pool in self.settings.pools.items():
                ready = self.queue.ready_count(name)
                if not ready:
                    continue
                workers = [w for w in self.queue.workers() if w["resource"] == name
                           and w["state"] != "draining"]
                free = sum(pool.slots - self._busy_slots(w["id"]) for w in workers
                           if w["state"] != "starting") + pool.slots * sum(
                    1 for w in workers if w["state"] == "starting")
                overflow = max(0, ready - free)
                if workers and overflow < pool.min_fill:
                    continue
                want = min(pool.max_workers - len(workers), math.ceil(overflow / pool.slots))
                for _ in range(max(0, want)):
                    if launches >= self.settings.max_launches_per_tick:
                        break
                    allowed, why = money.may_launch(self.queue, self.settings.budget, pool, now,
                                                    balance=self.balance(now))
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

        # 7. warn
        live = self.queue.workers()
        busy_ids = {j["lease_owner"] for j in self.queue.jobs(state="leased")}
        seconds = now - self._ticked_at if self._ticked_at is not None else 0.0
        self._ticked_at = now
        idle = money.charge_idle(self.queue, live, busy_ids, min(seconds, 300), now)
        report["idle_today_usd"] = round(idle, 4)
        report["balance_usd"] = self.balance(now)
        report["warnings"] = money.warnings(money.status(self.queue, self.settings.budget, now),
                                            self.settings.budget, idle, now, report["balance_usd"])
        raised = set(json.loads(self.queue.get_meta("warned") or "[]"))
        for w in report["warnings"]:
            if w["key"] not in raised:
                log.warning("%s", w["text"])
                raised.add(w["key"])
        self.queue.set_meta("warned", json.dumps(sorted(raised)[-50:]))
        self.last = report
        return report

    def balance(self, now: float) -> float | None:
        """The lowest prepaid balance among the providers in use, asked at most every 5 minutes."""
        if self._balance and now - self._balance[0] < 300:
            return self._balance[1]
        values = []
        for name in {pool.provider for pool in self.settings.pools.values()}:
            provider = self.providers.get(name)
            try:
                value = provider.balance() if provider else None
            except ProviderError as exc:
                log.warning("balance of %s unknown: %s", name, exc)
                value = None
            if value is not None:
                values.append(value)
        self._balance = (now, min(values) if values else None)
        return self._balance[1]

    def _pack(self, report: dict) -> set[str]:
        """The workers that take no new job (``meta packing``, read by the lease endpoint)."""
        live = self.queue.workers()
        packing = set(json.loads(self.queue.get_meta("packing") or "[]")) & {w["id"] for w in live}
        for name, pool in self.settings.pools.items():
            workers = [w for w in live if w["resource"] == name
                       and w["state"] not in ("starting", "stopping", "draining", "leaving")]
            if self.queue.ready_count(name):
                packing -= {w["id"] for w in workers}
                continue
            held = [w for w in workers if w["id"] not in packing]
            load = {w["id"]: self._busy_slots(w["id"]) for w in held}
            while len(held) > 1 and sum(load[w["id"]] for w in held) <= (len(held) - 1) * pool.slots:
                # The emptiest, and of those the youngest (the oldest is nearest its max_hours).
                worker = min(held, key=lambda w: (load[w["id"]], -w["created_at"]))
                held.remove(worker)
                packing.add(worker["id"])
                report.setdefault("packing", []).append(worker["id"])
        self.queue.set_meta("packing", json.dumps(sorted(packing)))
        return packing

    def _busy_slots(self, worker_id: str) -> int:
        return sum(1 for j in self.queue.jobs(state="leased") if j["lease_owner"] == worker_id)

    def stop_all(self, reason: str) -> list[str]:
        stopped = []
        for worker in self.queue.workers():
            self._stop(worker, reason)
            stopped.append(worker["id"])
        return stopped
