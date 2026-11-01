"""Cells that are not going to finish, set aside so they stop holding the queue.

A cell is deferred (:meth:`.queue.Queue.defer_subject`) when it is stuck past anything a
normal cell does, measured against the cells that did finish rather than guessed:

  * a stage of it is quarantined -- out of tries, nothing will move it without a person -- and
    has been for ``quarantined_after_h`` (time for an operator to requeue it with a fix);
  * it has used more worker time than the most expensive finished cell, by ``margin``: on
    2026-10-31 finished cells took 6.3 worker-hours on average and the densest 29.3;
  * it started longer ago than the slowest finished cell took from start to end, by
    ``margin`` (130 hours then, two account outages included) and is not running now.

The floors keep the first cells of a new run from setting the bar. A deferred cell's jobs are
never leased, never counted as blocked and survive replans; ``smc-cloud defer --undo`` brings
one back. The 71 cells this was written for (2026-10-31) were bay water, salt ponds and cells
whose lidar holds no kerbs: stages that fail the same way every try.
"""

from __future__ import annotations

from dataclasses import dataclass

HOUR = 3600.0


@dataclass(frozen=True)
class Policy:
    quarantined_after_h: float = 2.0
    margin: float = 1.25
    min_worker_h: float = 12.0
    min_wall_h: float = 48.0
    #: How often the controller looks, in seconds (the attempts table is read whole).
    every_s: float = 600.0


DEFAULT = Policy()


def limits(usage: dict[str, dict], policy: Policy) -> tuple[float, float]:
    """The worker seconds and wall seconds past which an unfinished cell is stuck."""
    done = [u for u in usage.values() if u["finished"] and u["first_start"] is not None]
    worker = max((u["worker_s"] for u in done), default=0.0) * policy.margin
    wall = max((u.get("wall_s") or 0.0 for u in done), default=0.0) * policy.margin
    return max(worker, policy.min_worker_h * HOUR), max(wall, policy.min_wall_h * HOUR)


def stuck_cells(usage: dict[str, dict], now: float, policy: Policy = DEFAULT) -> dict[str, str]:
    """``{cell: why}`` for every unfinished, undeferred cell past the limits."""
    worker_limit, wall_limit = limits(usage, policy)
    out: dict[str, str] = {}
    for cell, u in sorted(usage.items()):
        if u["finished"] or u["deferred"]:
            continue
        since = u["quarantined_since"]
        if since is not None and now - since >= policy.quarantined_after_h * HOUR:
            out[cell] = f"a stage has been quarantined for {(now - since) / HOUR:.1f} h"
        elif u["worker_s"] > worker_limit:
            out[cell] = (f"{u['worker_s'] / HOUR:.1f} worker-hours, past the "
                         f"{worker_limit / HOUR:.1f} any finished cell needed")
        elif (u["first_start"] is not None and not u["running"]
              and now - u["first_start"] > wall_limit):
            out[cell] = (f"started {(now - u['first_start']) / HOUR:.0f} h ago, past the "
                         f"{wall_limit / HOUR:.0f} h any finished cell took")
    return out


def defer_stuck(queue, now: float, policy: Policy = DEFAULT) -> dict[str, str]:
    """Defer every stuck cell; returns the ones deferred, with why."""
    usage = queue.cell_usage()
    deferred = {}
    for cell, why in stuck_cells(usage, now, policy).items():
        if queue.defer_subject(cell, "controller", why):
            deferred[cell] = why
    return deferred
