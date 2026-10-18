#!/usr/bin/env python3
"""Explicit, resumable connector intake; private acquisitions never auto-promote.

Run stages breadth-first over the planning envelopes so one large lidar job cannot
prevent every other corridor from starting. Storage/power failure stops the whole
process group; incomplete stages remain retryable, never measured-and-empty.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.streetview_reference import atomic_json  # noqa: E402
from smc.storage.external_volume import volume_ready  # noqa: E402


def interleaved(jobs):
    groups = defaultdict(list)
    for job in jobs:
        groups[job["name"].split("-p")[0]].append(job)
    return [
        rows[i]
        for i in range(max(map(len, groups.values()), default=0))
        for rows in groups.values()
        if i < len(rows)
    ]


def schedule(jobs, stages):
    # Get real map geometry beside discovery for each corridor immediately;
    # heavy ground/kerb measurements follow once every bounded job has a start.
    initial = [s for s in stages if s in {"discover", "osm"}]
    return [(job, stage) for job in jobs for stage in initial] + [
        (job, stage) for stage in stages if stage not in initial for job in jobs
    ]


def artifact_receipt(stage, folder):
    anchor = {
        "discover": "capabilities.json",
        "osm": "osm_ways.json",
        "terrain": "site/sf-corridor-terrain.bin",
        "lidar": "lidar/completion.json",
        "imagery": "catalog/observations/external-000.parquet",
        "official": "site/sf-corridor-official.json",
    }[stage]
    path = folder / anchor
    try:
        raw = path.read_bytes()
        if not raw or (path.suffix == ".json" and not json.loads(raw)):
            return None
        return {"path": anchor, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    except (OSError, ValueError):
        return None


def prepare(jobs, destination, registry_path, region_root):
    registry = json.loads(registry_path.read_text())
    by_name = {r["name"]: r for r in registry["regions"]}
    for job in jobs:
        name = job["name"]
        if not name.replace("-", "").isalnum() or "-gap-p" not in name:
            raise ValueError("only exact bounded connector jobs allowed")
        if name in by_name and by_name[name]["bbox"] != job["bbox"]:
            raise ValueError("refusing changed region bounds")
        local, external = region_root / name, destination / name
        external.mkdir(parents=True, exist_ok=True)
        if local.is_symlink():
            if local.resolve() != external.resolve():
                raise ValueError("region is linked to another storage run")
        elif local.exists():
            raise ValueError("refusing to move or overwrite existing region data")
        else:
            local.symlink_to(external, target_is_directory=True)
        if name not in by_name:
            registry["regions"].append(
                {
                    "name": name,
                    "bbox": job["bbox"],
                    "city": job["adapter"],
                    "description": job["reason"],
                    "built": False,
                    "intake_only": True,
                }
            )
    atomic_json(registry_path, registry)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--allow-intake", action="store_true", required=True)
    ap.add_argument("--volume", type=Path, required=True)
    ap.add_argument("--volume-uuid", required=True)
    ap.add_argument("--destination", type=Path, required=True)
    ap.add_argument("--stages", default="discover,osm,terrain,lidar")
    args = ap.parse_args()
    stages = args.stages.split(",")
    if any(s not in {"discover", "osm", "terrain", "lidar", "imagery", "official"} for s in stages):
        ap.error("intake only: build/promotion are deliberately separate")
    if not volume_ready(args.volume, args.volume_uuid):
        ap.error("verified external volume is not mounted")
    destination = args.destination.resolve()
    if (
        not destination.is_relative_to(args.volume / "Kerbside")
        or destination == args.volume / "Kerbside"
    ):
        ap.error("explicit acquisition directory inside external Kerbside required")
    folder = ROOT / "build/gap-intake"
    folder.mkdir(parents=True, exist_ok=True)
    lock = (folder / ".lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    plan_bytes = (ROOT / "data/regions/gap-plan.json").read_bytes()
    jobs = interleaved(json.loads(plan_bytes)["jobs"])
    prepare(jobs, destination, ROOT / "data/regions/regions.json", ROOT / "data/regions")
    state_path = folder / "status.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"jobs": {}}
    digest = hashlib.sha256(plan_bytes).hexdigest()
    if state.get("plan_sha256", digest) != digest:
        raise ValueError("plan changed; review existing run before resuming")
    state.update(
        schema="kerbside.connector_intake/1",
        plan_sha256=digest,
        pid=os.getpid(),
        destination=str(destination),
        total_jobs=len(jobs),
        stage_order=stages,
        automatically_publishes=False,
    )
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def save(status, **extra):
        state.update(state=status, at=time.time(), **extra)
        atomic_json(state_path, state)

    def eligible():
        if not volume_ready(args.volume, args.volume_uuid):
            return False
        if shutil.disk_usage(args.volume).free < 8 * 1024**3:
            return False
        from run_frontage_workers import power_eligible, power_state

        return power_eligible(power_state(), 30)

    while not stopping:
        pending = False
        for job, stage in schedule(jobs, stages):
            key = job["name"]
            records = state["jobs"].setdefault(key, {})
            previous = records.get(stage, {})
            receipt = artifact_receipt(stage, destination / key)
            if previous.get("status") == "done" and receipt and previous.get("artifact") == receipt:
                continue
            pending = True
            while not eligible() and not stopping:
                save("paused_power_or_storage", active=None)
                time.sleep(10)
            if stopping:
                break
            started = time.time()
            save("running", active={"job": key, "stage": stage})
            command = [
                sys.executable,
                str(ROOT / "scripts/ingest_gap_region.py"),
                key,
                "--allow-intake",
                "--stages",
                stage,
            ]
            with (destination / key / f"{stage}.log").open("a") as log:
                child = subprocess.Popen(
                    command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
                )
                limit = 900 if stage in {"discover", "osm"} else 6 * 3600
                while child.poll() is None:
                    if stopping or not eligible() or time.time() - started > limit:
                        os.killpg(child.pid, signal.SIGTERM)
                        try:
                            child.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL)
                            child.wait()
                        break
                    time.sleep(5)
                mounted = volume_ready(args.volume, args.volume_uuid)
                receipt = artifact_receipt(stage, destination / key) if mounted else None
                records[stage] = {
                    "status": "done" if child.returncode == 0 and receipt and mounted else "retry",
                    "artifact": receipt,
                    "exit_code": child.returncode,
                    "at": time.time(),
                    "seconds": round(time.time() - started, 1),
                }
            save("running", active=None)
            if stopping:
                break
            time.sleep(3)  # One upstream request group at a time; no Overpass fan-out.
        if not pending:
            save("complete", active=None)
            return
        save("retry_backoff", active=None)
        for _ in range(60):
            if stopping:
                break
            time.sleep(10)
    save("stopped", active=None)


if __name__ == "__main__":
    main()
