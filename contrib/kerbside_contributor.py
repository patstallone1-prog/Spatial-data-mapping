#!/usr/bin/env python3
"""Kerbside contributor: screen street photographs for the Kerbside map while this Mac is idle.

Installed by "Install Kerbside Contributor.command" from a bundle made for this Mac. It claims a
few photographs at a time from the Kerbside queue, screens each with the same filter the main Mac
runs (download, straighten onto the house front, check it is a clear view of a house), and sends
the result back. It is polite about it:

  background    it runs at macOS background priority (taskpolicy -b): the system gives it only
                what nothing else wants
  busy          whenever other programs are using more than BUSY_SHARE of the processors --
                Kerbside World loading, a video call, anything -- the work is paused (stopped
                mid-photograph, not killed) and resumed once things are quiet again
  battery       on battery below BATTERY_MIN percent it does nothing
  off           "Stop Kerbside Contributor.command" turns it off and keeps it off

Nothing is kept: each photograph's files are deleted once sent. Its log is in
~/Library/Logs/KerbsideContributor.log.
"""

from __future__ import annotations

import base64
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home() / "Library/Application Support/KerbsideContributor"
APP = HOME / "app"
WORK = HOME / "work"
OFF = HOME / "OFF"
VERSION = "1"
CLAIM = 16
#: Other programs' share of all the processors above which the work pauses.
BUSY_SHARE = 0.35
BATTERY_MIN = 50
QUIET_SECONDS = 60
IDLE_SLEEP = 300


def log(message: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}", flush=True)


def config() -> dict:
    return json.loads((HOME / "config.json").read_text())


def rpc(cfg: dict, name: str, body: dict, timeout: int = 120):
    request = urllib.request.Request(
        f"{cfg['supabase_url']}/rest/v1/rpc/{name}", data=json.dumps(body).encode(), method="POST",
        headers={"apikey": cfg["publishable_key"], "Authorization": f"Bearer {cfg['publishable_key']}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read() or b"null")


def on_battery_low() -> bool:
    try:
        out = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    if "Battery Power" not in out:
        return False
    for token in out.replace(";", " ").split():
        if token.endswith("%") and token[:-1].isdigit():
            return int(token[:-1]) < BATTERY_MIN
    return False


def others_busy(mine: set[int]) -> bool:
    """Whether programs other than this one are using more than BUSY_SHARE of the processors."""
    try:
        out = subprocess.run(["ps", "-A", "-o", "pid=,pcpu="], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    used = 0.0
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit() and int(parts[0]) not in mine:
            try:
                used += float(parts[1])
            except ValueError:
                continue
    return used > BUSY_SHARE * 100 * (os.cpu_count() or 4)


def children(pid: int) -> set[int]:
    found, frontier = {pid}, [pid]
    while frontier:
        out = subprocess.run(["pgrep", "-P", str(frontier.pop())], capture_output=True, text=True).stdout
        for line in out.split():
            if line.isdigit() and int(line) not in found:
                found.add(int(line))
                frontier.append(int(line))
    return found


def why_not_now() -> str | None:
    if OFF.exists():
        return "turned_off"
    if on_battery_low():
        return "battery"
    if others_busy({os.getpid()}):
        return "busy"
    return None


def screen(cfg: dict, items: list[dict]) -> Path:
    """Run the filter on the claimed photographs, pausing it while the Mac is busy."""
    WORK.mkdir(parents=True, exist_ok=True)
    out = WORK / "out"
    work_file = WORK / "work.json"
    work_file.write_text(json.dumps([i["payload"] for i in items]))
    env_file = WORK / "env"
    env_file.write_text(f"MAPILLARY_TOKEN={cfg.get('mapillary_token') or ''}\n")
    os.chmod(env_file, 0o600)
    command = ["/usr/sbin/taskpolicy", "-b", sys.executable, str(APP / "scripts/filter_frontage_photos.py"),
               "--work-file", str(work_file), "--output", str(out), "--env-file", str(env_file),
               "--pixel-screen", "--model-cache", str(HOME / "model-cache"), "--strict-houses",
               "--device", "auto"]
    process = subprocess.Popen(command, cwd=APP, env={**os.environ, "PYTHONPATH": str(APP / "src")})
    paused = False
    while process.poll() is None:
        time.sleep(15)
        busy = others_busy({os.getpid(), *children(process.pid)}) or on_battery_low() or OFF.exists()
        if busy and not paused:
            for pid in children(process.pid):
                os.kill(pid, signal.SIGSTOP)
            paused = True
            log("paused: the Mac is busy")
        elif not busy and paused:
            for pid in children(process.pid):
                os.kill(pid, signal.SIGCONT)
            paused = False
            log("resumed")
    return out


def send(cfg: dict, items: list[dict], out: Path) -> int:
    sent = 0
    for item in items:
        payload = item["payload"]
        uid = payload["candidate"]["observation"]["observation_uid"]
        key = f"{payload['region']}-{payload['row']['building_id']}-{uid[:16]}"
        report_path = out / "review" / f"{key}.json"
        result = {"outcome": "error", "device_name": cfg["name"]}
        if report_path.exists():
            report = json.loads(report_path.read_text())
            result = {"outcome": report.get("status"), "review": report, "device_name": cfg["name"], "files": {}}
            if str(report.get("status", "")).startswith(("screened", "verified")):
                for suffix in ("jpg", "labels.png"):
                    path = out / "review" / f"{key}.{suffix}"
                    if path.exists():
                        result["files"][suffix] = base64.b64encode(path.read_bytes()).decode()
        try:
            rpc(cfg, "kerbside_submit", {"token": cfg["contributor_token"], "device": cfg["device_id"],
                                         "work": item["id"], "result": result})
            sent += 1
        except (urllib.error.URLError, OSError) as error:
            log(f"could not send {key}: {type(error).__name__}")
        for path in (out / "review").glob(f"{key}*"):
            path.unlink(missing_ok=True)
    return sent


def main() -> int:
    cfg = config()
    log(f"Kerbside contributor {VERSION} for {cfg['name']} started")
    while True:
        reason = why_not_now()
        try:
            rpc(cfg, "kerbside_heartbeat", {"token": cfg["contributor_token"], "device": cfg["device_id"],
                                            "device_name": cfg["name"], "client_version": VERSION,
                                            "paused": reason})
            if reason:
                time.sleep(IDLE_SLEEP if reason != "busy" else QUIET_SECONDS)
                continue
            items = rpc(cfg, "kerbside_claim", {"token": cfg["contributor_token"], "device": cfg["device_id"],
                                                "how_many": CLAIM}) or []
            if not items:
                time.sleep(IDLE_SLEEP)
                continue
            out = screen(cfg, items)
            log(f"sent {send(cfg, items, out)} of {len(items)} photographs")
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as error:
            log(f"waiting: {type(error).__name__}")
            time.sleep(IDLE_SLEEP)


if __name__ == "__main__":
    raise SystemExit(main())
