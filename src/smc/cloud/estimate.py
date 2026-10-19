"""What the plan will cost, from measured times -- the Mac's journals now, the cloud's own later.

Every stage the local pipeline ran left its wall time in the cell's journal
(``data/regions/<cell>/ingest.json``). Scaled by each cell's area, those give seconds per km^2
per stage; the plan's remaining stages times its cells' areas give the work left, and a pool's
price gives the money. Network-bound stages (terrain, lidar, imagery: most of their time is
waiting on USGS and the imagery providers) share a worker ``slots`` ways, so their cost per cell
divides by the slots a pool runs -- the reason a small CPU worker running four cells beats a big
one running one.

The Mac's times are a stand-in until the cloud has its own: ``bench`` jobs and every finished
attempt record seconds, CPU, memory, bytes and cost (``attempts`` in the queue), and
:func:`from_attempts` uses those instead once there are enough. The figures are estimates, not
quotes: prices are list prices on the date given and change (Hetzner raised CPX and CCX prices
113-176 % on 2026-06-15).
"""

from __future__ import annotations

import glob
import json
import statistics
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

#: List prices, per hour, checked 2026-10-18. EUR at 1.08 USD. Hetzner: docs.hetzner.com
#: price adjustment of 2026-06-15 (Germany/Finland, without IPv4; US locations differ).
#: RunPod: third-party listings (RunPod's own page varies by availability) -- verify at launch.
PRICES = {
    "hetzner:cpx22": {"usd_h": 0.0312 * 1.08, "vcpu": 2, "ram_gb": 4, "note": "shared vCPU"},
    "hetzner:cpx32": {"usd_h": 0.0569 * 1.08, "vcpu": 4, "ram_gb": 8, "note": "shared vCPU"},
    "hetzner:cpx42": {"usd_h": 0.1114 * 1.08, "vcpu": 8, "ram_gb": 16, "note": "shared vCPU"},
    "hetzner:ccx13": {"usd_h": 0.0689 * 1.08, "vcpu": 2, "ram_gb": 8, "note": "dedicated vCPU"},
    "hetzner:ccx23": {"usd_h": 0.1378 * 1.08, "vcpu": 4, "ram_gb": 16, "note": "dedicated vCPU"},
    # Cost-optimised CX line, Germany/Finland only ($6.49 and $18.49 a month, capped; 2026-10-18).
    "hetzner:cx23": {"usd_h": 6.49 / 730, "vcpu": 2, "ram_gb": 4, "note": "shared vCPU, EU only"},
    "hetzner:cx43": {"usd_h": 18.49 / 730, "vcpu": 8, "ram_gb": 16, "note": "shared vCPU, EU only"},
    "runpod:a5000-secure": {"usd_h": 0.27, "vram_gb": 24, "note": "secure cloud"},
    "runpod:rtx4090-community": {"usd_h": 0.34, "vram_gb": 24, "note": "community cloud"},
    "runpod:l4-secure": {"usd_h": 0.49, "vram_gb": 24, "note": "secure cloud"},
    "runpod:a40-secure": {"usd_h": 0.49, "vram_gb": 48, "note": "secure cloud"},
}
NETWORK_BOUND = {"discover", "osm", "terrain", "lidar", "imagery", "official"}


@dataclass
class StageTime:
    stage: str
    samples: int
    median_s: float
    per_km2_s: float | None


def journal_times(root: Path, plan_jobs: list[dict]) -> dict[str, StageTime]:
    """Seconds per stage, and per km^2 where the cell's area is known, from local journals."""
    areas = {j["name"]: j.get("area_km2") for j in plan_jobs}
    secs, per = defaultdict(list), defaultdict(list)
    for path in glob.glob(str(Path(root) / "data/regions/*/ingest.json")):
        try:
            journal = json.loads(Path(path).read_text())
        except (OSError, ValueError):
            continue
        name = Path(path).parent.name
        for stage, row in journal.get("stages", {}).items():
            if row.get("status") == "done" and row.get("seconds"):
                secs[stage].append(row["seconds"])
                if areas.get(name):
                    per[stage].append(row["seconds"] / areas[name])
    return {s: StageTime(s, len(v), statistics.median(v),
                         statistics.median(per[s]) if per[s] else None) for s, v in secs.items()}


def plan_cost(plan_jobs: list[dict], done: dict[str, set[str]], times: dict[str, StageTime],
              *, cpu_usd_h: float, cpu_slots: int, chain: tuple[str, ...]) -> dict:
    """CPU hours and money for every stage of every cell not yet done."""
    hours = defaultdict(float)
    for job in plan_jobs:
        for stage in chain:
            if stage in done.get(job["name"], set()) or stage not in times:
                continue
            t = times[stage]
            seconds = t.per_km2_s * job["area_km2"] if t.per_km2_s and job.get("area_km2") else t.median_s
            hours[stage] += seconds / 3600
    usd = {s: h * cpu_usd_h / (cpu_slots if s in NETWORK_BOUND else 1) for s, h in hours.items()}
    cells = len(plan_jobs)
    total = sum(usd.values())
    return {"stage_hours": {s: round(h, 1) for s, h in hours.items()},
            "stage_usd": {s: round(v, 2) for s, v in usd.items()},
            "total_usd": round(total, 2), "cells": cells,
            "usd_per_cell": round(total / cells, 3) if cells else None,
            "worker_hours": round(sum(h / (cpu_slots if s in NETWORK_BOUND else 1)
                                      for s, h in hours.items()), 1)}


def from_attempts(attempts: list[dict], minimum: int = 5) -> dict[str, dict]:
    """Measured cost and time per stage from the cloud's own finished attempts."""
    by = defaultdict(list)
    for a in attempts:
        if a.get("outcome") == "done" and a.get("seconds"):
            by[a["job_id"].split(":")[-1]].append(a)
    out = {}
    for stage, rows in by.items():
        if len(rows) < minimum:
            continue
        out[stage] = {"n": len(rows), "median_s": statistics.median(r["seconds"] for r in rows),
                      "median_usd": statistics.median(r.get("cost_usd") or 0 for r in rows),
                      "median_cpu_s": statistics.median(r.get("cpu_seconds") or 0 for r in rows),
                      "max_rss_mb": max(r.get("max_rss_mb") or 0 for r in rows)}
    return out


def report(root: Path, *, options: dict[str, tuple[str, int]] | None = None) -> dict:
    """The plan's cost on each candidate CPU pool (name -> (price key, slots))."""
    root = Path(root)
    plan = json.loads((root / "data/regions/gap-plan.json").read_text())["jobs"]
    times = journal_times(root, plan)
    done: dict[str, set[str]] = {}
    for job in plan:
        try:
            journal = json.loads((root / "data/regions" / job["name"] / "ingest.json").read_text())
        except (OSError, ValueError):
            continue
        done[job["name"]] = {s for s, r in journal.get("stages", {}).items() if r.get("status") == "done"}
    chain = ("discover", "osm", "terrain", "lidar", "imagery", "official", "build", "audit")
    options = options or {"cx43 x8 slots": ("hetzner:cx43", 8), "cpx22 x2 slots": ("hetzner:cpx22", 2), "cpx32 x4 slots": ("hetzner:cpx32", 4),
                          "cpx42 x8 slots": ("hetzner:cpx42", 8), "ccx13 x2 slots": ("hetzner:ccx13", 2)}
    costs = {name: plan_cost(plan, done, times, cpu_usd_h=PRICES[key]["usd_h"], cpu_slots=slots,
                             chain=chain) for name, (key, slots) in options.items()}
    area = sum(j["area_km2"] for j in plan)
    return {
        "measured_on": "the owner's Mac (Apple silicon), local journals; re-measure on the cloud "
                       "with bench jobs before fixing pool sizes",
        "stage_times": {s: {"samples": t.samples, "median_s": round(t.median_s),
                            "per_km2_s": round(t.per_km2_s) if t.per_km2_s else None}
                        for s, t in times.items()},
        "plan": {"cells": len(plan), "area_km2": round(area, 1),
                 "cells_with_local_journal": len(done)},
        "options": costs,
        "prices": PRICES,
    }
