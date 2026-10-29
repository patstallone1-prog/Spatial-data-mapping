"""Money: what has been spent, what a launch would add, and the hard stop.

Neither Hetzner nor Cloudflare R2 offers a hard spending cap; RunPod's account balance is one
(prepaid credit: a pod stops when it runs out). So the limits are enforced here, independently
of any provider, from the ledger the queue keeps:

* a launch is refused if the next hour of every running worker and this one would take today
  past its limit, or this month's spend past its own;
* once today's limit is spent the workers drain -- they take no new job, finish what they hold
  and are stopped -- and work resumes the next UTC day; long jobs can carry a day a little over;
* at the hard monthly limit every worker is stopped and the scheduler pauses; the pause lifts
  by itself on the first of the next month (or when a person raises the limit) -- and the
  watchdog (``smc-cloud watchdog``, run outside the controller) stops workers if the
  controller itself is gone.

Spend is instance time (running instances counted to now), the controller's own pod while it is
up, plus storage charged daily from the bytes the checkpoints have stored.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from .providers import Pool
from .queue import Queue

#: Cloudflare R2 standard storage, per GB-month (https://developers.cloudflare.com/r2/pricing/,
#: checked 2026-10-18). Egress is free; operations are billed per million and are small here.
R2_GB_MONTH_USD = 0.023  # S3 Standard's list price (R2's is 0.015): the dearer of the two stores


@dataclass
class Budget:
    daily_usd: float = 25.0
    monthly_usd: float = 300.0
    #: Reaching this stops everything; must be at least ``monthly_usd``.
    hard_monthly_usd: float = 400.0
    #: A warning is raised when rented workers have sat idle this much today, or when less than
    #: this is left of the day's or the month's budget (:func:`warnings`).
    warn_usd: float = 0.5

    def __post_init__(self):
        if self.hard_monthly_usd < self.monthly_usd:
            raise ValueError("the hard monthly limit must be at least the monthly budget")


def day_start(now: float) -> float:
    d = datetime.fromtimestamp(now, UTC)
    return datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp()


def month_start(now: float) -> float:
    d = datetime.fromtimestamp(now, UTC)
    return datetime(d.year, d.month, 1, tzinfo=UTC).timestamp()


def status(queue: Queue, budget: Budget, now: float | None = None) -> dict:
    now = now or queue.clock()
    today = queue.spend(day_start(now))
    month = queue.spend(month_start(now))
    return {"today_usd": round(today, 4), "month_usd": round(month, 4),
            "daily_usd": budget.daily_usd, "monthly_usd": budget.monthly_usd,
            "hard_monthly_usd": budget.hard_monthly_usd,
            "hard_stop": month >= budget.hard_monthly_usd}


def charge_idle(queue: Queue, workers: list[dict], busy: set[str], seconds: float,
                now: float) -> float:
    """Add ``seconds`` of every live worker that held no job (booting included) to today's idle
    spend, and return today's total. Not a charge: the instance time is already counted."""
    day = day_start(now)
    row = json.loads(queue.get_meta("idle_spend") or "{}")
    if row.get("day") != day:
        row = {"day": day, "usd": 0.0}
    row["usd"] += sum(w["hourly_usd"] for w in workers if w["id"] not in busy) * max(0.0, seconds) / 3600
    queue.set_meta("idle_spend", json.dumps(row))
    return row["usd"]


def warnings(s: dict, budget: Budget, idle_today: float, now: float) -> list[dict]:
    """What the owner should hear about, each with a key that is stable for the day (the
    watchdog reports a key once)."""
    day = datetime.fromtimestamp(now, UTC).date().isoformat()
    out = []
    if idle_today >= budget.warn_usd:
        out.append({"key": f"idle:{day}", "text": f"rented workers sat idle: ${idle_today:.2f} today"})
    if budget.daily_usd - s["today_usd"] < budget.warn_usd:
        out.append({"key": f"daily:{day}", "text": f"today's budget nearly spent: ${s['today_usd']:.2f} "
                                                   f"of ${budget.daily_usd:.2f}"})
    if budget.monthly_usd - s["month_usd"] < budget.warn_usd:
        out.append({"key": f"monthly:{day[:7]}", "text": f"the month's budget nearly spent: "
                                                         f"${s['month_usd']:.2f} of ${budget.monthly_usd:.2f}"})
    return out


#: How far ahead a launch looks: the next hour of every running worker and the new one.
#: (Projecting every worker to midnight refused any launch early in the day once the daily
#: limit was small; the drain at the limit is what keeps a day near it.)
LOOKAHEAD_H = 1.0


def over_daily(queue: Queue, budget: Budget, now: float | None = None) -> bool:
    return status(queue, budget, now)["today_usd"] >= budget.daily_usd


def may_launch(queue: Queue, budget: Budget, pool: Pool, now: float | None = None) -> tuple[bool, str]:
    now = now or queue.clock()
    s = status(queue, budget, now)
    if s["hard_stop"]:
        return False, f"hard monthly limit reached (${s['month_usd']:.2f} of ${budget.hard_monthly_usd:.2f})"
    # The least this launch can cost: its billed minimum, or a quarter of an hour.
    least = pool.hourly_usd * max(pool.min_billed_hours, 0.25)
    running = sum(w["hourly_usd"] for w in queue.workers())
    if s["today_usd"] + least > budget.daily_usd:
        return False, f"daily budget: ${s['today_usd']:.2f} spent of ${budget.daily_usd:.2f}"
    if s["month_usd"] + least > budget.monthly_usd:
        return False, f"monthly budget: ${s['month_usd']:.2f} spent of ${budget.monthly_usd:.2f}"
    next_hour = s["today_usd"] + max(least, (running + pool.hourly_usd) * LOOKAHEAD_H)
    if next_hour > budget.daily_usd:
        return False, (f"${next_hour:.2f} by the next hour with this worker against the daily "
                       f"budget ${budget.daily_usd:.2f}")
    return True, "within budget"


def charge_controller(queue: Queue, hourly_usd: float, now: float | None = None,
                      most_s: float = 300) -> float:
    """The controller's own pod since the last charge (at most ``most_s``: a longer gap is time
    it was stopped, and a stopped pod costs nothing)."""
    now = now or queue.clock()
    last = float(queue.get_meta("controller_charged_at", "0") or 0)
    queue.set_meta("controller_charged_at", str(now))
    if not hourly_usd or not last:
        return 0.0
    usd = min(max(0.0, now - last), most_s) / 3600 * hourly_usd
    if usd:
        queue.charge("controller", usd, "controller")
    return usd


def charge_storage(queue: Queue, now: float | None = None) -> float:
    """Once a day: the stored bytes' share of a month's storage."""
    now = now or time.time()
    last = float(queue.get_meta("storage_charged_at", "0") or 0)
    if now - last < 86400:
        return 0.0
    stored = float(queue.get_meta("stored_bytes", "0") or 0)
    usd = stored / 1e9 * R2_GB_MONTH_USD / 30
    queue.charge("storage", usd, "r2", f"{stored / 1e9:.1f} GB")
    queue.set_meta("storage_charged_at", str(now))
    return usd
