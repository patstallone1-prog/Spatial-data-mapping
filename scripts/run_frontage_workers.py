#!/usr/bin/env python3
"""Power-aware private proposal supervisor; never publishes or approves a facade."""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.version import implementation_sha256  # noqa: E402

REGIONS = [
    "sf-corridor",
    "sf-mission",
    "sf-haight-castro",
    "sf-sunset",
    "oakland-downtown",
    "berkeley-downtown",
    "palo-alto-downtown",
    "san-jose-downtown",
]


def on_ac(output: str) -> bool:
    return "Now drawing from 'AC Power'" in output


def parse_power(output: str) -> dict | None:
    if not on_ac(output) and "Now drawing from 'Battery Power'" not in output:
        return None
    match = re.search(r"\b(\d{1,3})%;", output)
    percent = int(match[1]) if match else None
    if percent is not None and not 0 <= percent <= 100:
        return None
    return {"on_ac": on_ac(output), "battery_percent": percent}


def power_eligible(power: dict | None, battery_min_percent: int | None) -> bool:
    if power is None:
        return False
    if power["on_ac"]:
        return True
    return (battery_min_percent is not None and power["battery_percent"] is not None
            and power["battery_percent"] > battery_min_percent)


def proposal_batch_size(reviewed_pilot: bool, full_private_proposals: bool) -> int:
    """Private throughput is independent of evidence approval or publication."""
    return 256 if reviewed_pilot or full_private_proposals else 24


def power_state() -> dict | None:
    try:
        power = subprocess.run(
            ["/usr/bin/pmset", "-g", "batt"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return parse_power(power.stdout) if power.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def stop_process(process):
    """A busy kernel may delay exit; keep tracking it instead of spawning a duplicate."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=1)


def full_run_approved(path: Path | None, renderer: Path) -> bool:
    if path is None or not path.is_file():
        return False
    try:
        approval = json.loads(path.read_text())
        if not isinstance(approval, dict):
            return False
        houses = approval["houses"]
        current_implementation = implementation_sha256(ROOT)
        if not isinstance(houses, list) or not all(isinstance(item, dict) for item in houses):
            return False
        if (
            len(houses) < 3
            or not approval.get("reviewer")
            or approval.get("renderer_sha256") != hashlib.sha256(renderer.read_bytes()).hexdigest()
            or approval.get("implementation_sha256") != current_implementation
        ):
            return False
        identities = set()
        for item in houses:
            fact_path = Path(item["fit_path"])
            if not fact_path.is_absolute() or fact_path.is_symlink():
                return False
            raw = fact_path.read_bytes()
            fact = json.loads(raw)
            if hashlib.sha256(raw).hexdigest() != item["fit_sha256"]:
                return False
            if (
                fact.get("certainty", {}).get("tier") != "high"
                or fact.get("review_status") != "reviewed_inferred_visual_parameters"
                or not fact.get("image_sha256")
                or not fact.get("source_locator")
                or fact.get("implementation_sha256") != current_implementation
                or not all(
                    item.get(k)
                    for k in (
                        "source_comparison_passed",
                        "outcrop_alignment_passed",
                        "openings_passed",
                        "material_passed",
                        "privacy_rights_passed",
                    )
                )
            ):
                return False
            identities.add((fact["region"], fact["building_id"]))
        return len(identities) >= 3
    except (OSError, ValueError, KeyError, TypeError):
        return False


def status(path: Path, value: dict):
    temp = path.with_suffix(".tmp")
    with temp.open("w") as stream:
        json.dump({"pid": os.getpid(), "at": time.time(), **value}, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--full-run-approval", type=Path)
    parser.add_argument("--battery-min-percent", type=int,
                        help="Allow battery processing only strictly above this percentage.")
    parser.add_argument(
        "--full-private-proposals", action="store_true",
        help="Process full batches privately; does not approve or publish any photo fit.",
    )
    args = parser.parse_args()
    if args.battery_min_percent is not None and not 0 <= args.battery_min_percent <= 100:
        parser.error("battery minimum must be between 0 and 100")
    folder = ROOT / "build/frontage-supervisor"
    folder.mkdir(parents=True, exist_ok=True)
    lock = (folder / ".lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("supervisor already running")
    children = {}
    logs = {}
    stopping = False
    caffeine = None
    sample = None

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def stop_children():
        for process in children.values():
            stop_process(process)
        for name in list(children):
            if children[name].poll() is not None:
                children.pop(name)

    environment = {**os.environ, "PYTHONPATH": str(ROOT / "src"), "PYTHONUNBUFFERED": "1"}
    try:
        while not stopping:
            power = power_state()
            eligible = power_eligible(power, args.battery_min_percent)
            capacity = shutil.disk_usage(folder).free >= 4 * 1024**3
            if not eligible or not capacity:
                stop_children()
                if caffeine and caffeine.poll() is None:
                    caffeine.terminate()
                caffeine = None
                status(
                    folder / "status.json",
                    {
                        "state": "paused_power_query_unavailable"
                        if power is None
                        else "waiting_for_ac_power"
                        if not eligible and args.battery_min_percent is None
                        else "paused_battery_threshold"
                        if not eligible
                        else "paused_disk_reserve",
                        "power": power,
                        "battery_min_percent": args.battery_min_percent,
                        "children_stopping": {k: p.pid for k, p in children.items()},
                        "full_private_proposals": args.full_private_proposals,
                        "configured_private_batch_size": proposal_batch_size(False, args.full_private_proposals),
                        "automatically_publishes": False,
                    },
                )
            else:
                full = full_run_approved(
                    args.full_run_approval, ROOT / "scripts/build_sf_corridor_3d.py"
                )
                wanted = proposal_batch_size(full, args.full_private_proposals)
                if sample is not None and sample != wanted:
                    stop_children()
                sample = wanted
                if caffeine is None or caffeine.poll() is not None:
                    caffeine = subprocess.Popen(
                        ["/usr/bin/caffeinate", "-i", "-w", str(os.getpid())]
                    )
                commands = {
                    "filter": [
                        str(args.python),
                        str(ROOT / "scripts/filter_frontage_photos.py"),
                        "--data-root",
                        str(args.data_root),
                        "--env-file",
                        str(args.env_file),
                        "--regions",
                        *REGIONS,
                        "--landmarks",
                        "--sample",
                        str(sample),
                        "--pixel-screen",
                        "--model-cache",
                        str(ROOT / "build/frontage-pilot-v2/model-cache"),
                        "--strict-houses",
                        "--device",
                        "mps",
                        "--watch-seconds",
                        "30",
                        "--output",
                        str(ROOT / "build/frontage-live"),
                    ],
                    "matcher": [
                        str(args.python),
                        str(ROOT / "scripts/match_frontage_facades.py"),
                        "--inputs",
                        str(ROOT / "build/frontage-live"),
                        str(ROOT / "build/frontage-pilot-v2"),
                        "--output",
                        str(ROOT / "build/facade-match"),
                        "--detail-model-cache",
                        str(ROOT / "build/facade-detail-model-cache"),
                        "--device",
                        "mps",
                        "--watch-seconds",
                        "30",
                    ],
                }
                for name, command in commands.items():
                    if name not in children or children[name].poll() is not None:
                        if name not in logs:
                            logs[name] = (folder / f"{name}.log").open("ab", buffering=0)
                        children[name] = subprocess.Popen(
                            command,
                            cwd=ROOT,
                            env=environment,
                            stdout=logs[name],
                            stderr=subprocess.STDOUT,
                        )
                status(
                    folder / "status.json",
                    {
                        "state": "running",
                        "power": power,
                        "battery_min_percent": args.battery_min_percent,
                        "children": {k: p.pid for k, p in children.items()},
                        "batch_size": sample,
                        "full_run_approved": full,
                        "full_private_proposals": args.full_private_proposals,
                        "automatically_publishes": False,
                        "power_assertion_pid": caffeine.pid,
                        "wake_limit": "cannot override shutdown or closed-lid sleep",
                    },
                )
            for _ in range(30):
                if stopping:
                    break
                time.sleep(1)
    finally:
        stop_children()
        if caffeine and caffeine.poll() is None:
            caffeine.terminate()
        for stream in logs.values():
            stream.close()
        status(
            folder / "status.json",
            {
                "state": "stopped",
                "children_stopping": {k: p.pid for k, p in children.items()},
                "automatically_publishes": False,
            },
        )


if __name__ == "__main__":
    main()
