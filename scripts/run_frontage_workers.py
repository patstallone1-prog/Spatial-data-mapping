#!/usr/bin/env python3
"""Power-aware private proposal supervisor; never publishes or approves a facade."""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
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


def power_state() -> bool | None:
    try:
        power = subprocess.run(
            ["/usr/bin/pmset", "-g", "batt"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return on_ac(power.stdout) if power.returncode == 0 else None
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
    args = parser.parse_args()
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
            ac = power_state()
            capacity = shutil.disk_usage(folder).free >= 4 * 1024**3
            if ac is not True or not capacity:
                stop_children()
                if caffeine and caffeine.poll() is None:
                    caffeine.terminate()
                caffeine = None
                status(
                    folder / "status.json",
                    {
                        "state": "paused_power_query_unavailable"
                        if ac is None
                        else "waiting_for_ac_power"
                        if not ac
                        else "paused_disk_reserve",
                        "children_stopping": {k: p.pid for k, p in children.items()},
                        "automatically_publishes": False,
                    },
                )
            else:
                full = full_run_approved(
                    args.full_run_approval, ROOT / "scripts/build_sf_corridor_3d.py"
                )
                wanted = 256 if full else 24
                if sample is not None and sample != wanted:
                    stop_children()
                sample = wanted
                if caffeine is None or caffeine.poll() is not None:
                    caffeine = subprocess.Popen(
                        ["/usr/bin/caffeinate", "-s", "-w", str(os.getpid())]
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
                        "children": {k: p.pid for k, p in children.items()},
                        "batch_size": sample,
                        "full_run_approved": full,
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
