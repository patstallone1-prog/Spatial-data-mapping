"""Money: what has been spent, what a launch would add, and the hard stop.

Neither Hetzner nor Cloudflare R2 offers a hard spending cap; RunPod's account balance is one
(prepaid credit: a pod stops when it runs out). So the limits are enforced here, independently
of any provider, from the ledger the queue keeps:

* a launch is refused if it would take today's or this month's projected spend past its limit
  (an instance's hourly price times the hours it is billed for at least);
* at the hard monthly limit every worker is stopped and the scheduler pauses until a person
  raises the limit -- and the watchdog (``smc-cloud watchdog``, run outside the controller)
  does the same if the controller itself is gone.

Spend is instance time (running instances counted to now), plus storage charged daily from the
bytes the checkpoints have stored.
"""

from __future__ import annotations

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


def may_launch(queue: Queue, budget: Budget, pool: Pool, now: float | None = None) -> tuple[bool, str]:
    now = now or queue.clock()
    s = status(queue, budget, now)
    if s["hard_stop"]:
        return False, f"hard monthly limit reached (${s['month_usd']:.2f} of ${budget.hard_monthly_usd:.2f})"
    # The least this launch can cost: its billed minimum, or the rest of today's hours.
    least = pool.hourly_usd * max(pool.min_billed_hours, 0.25)
    running = sum(w["hourly_usd"] for w in queue.workers())
    rest_of_day = (day_start(now) + 86400 - now) / 3600
    # Today's projection: what is spent, plus every running instance (and this one) kept to
    # midnight at the worst -- the idle stop usually ends them sooner.
    projected_day = s["today_usd"] + least + (running + pool.hourly_usd) * min(rest_of_day, pool.max_hours)
    if s["today_usd"] + least > budget.daily_usd:
        return False, f"daily budget: ${s['today_usd']:.2f} spent of ${budget.daily_usd:.2f}"
    if s["month_usd"] + least > budget.monthly_usd:
        return False, f"monthly budget: ${s['month_usd']:.2f} spent of ${budget.monthly_usd:.2f}"
    if projected_day > budget.daily_usd * 1.5:
        return False, (f"projected ${projected_day:.2f} today with this worker against the daily "
                       f"budget ${budget.daily_usd:.2f}")
    return True, "within budget"


def charge_storage(queue: Queue, now: float | None = None) -> float:
    """Once a day: the stored bytes' share of a month's R2 storage."""
    now = now or time.time()
    last = float(queue.get_meta("storage_charged_at", "0") or 0)
    if now - last < 86400:
        return 0.0
    stored = float(queue.get_meta("stored_bytes", "0") or 0)
    usd = stored / 1e9 * R2_GB_MONTH_USD / 30
    queue.charge("storage", usd, "r2", f"{stored / 1e9:.1f} GB")
    queue.set_meta("storage_charged_at", str(now))
    return usd
