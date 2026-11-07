#!/usr/bin/env python3
"""Resume presets sequentially on HP, reload each Blueprint, then install a strict roster.

One editor process at a time. Authentication remains in Epic/macOS UI. On failure the
queue stops and leaves source assets intact. A waiting Keychain request is never bypassed.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from build_macos import developer_dir
from metahuman_presets import NAMES, selected_names, write_report


def check_storage(project, volume, reserve_gib=12, internal_reserve_gib=8):
    volume = volume.resolve()
    if not volume.is_mount():
        raise RuntimeError("external volume is not mounted")
    for path in (project.parent / "Content/Characters", project.parent / "Saved"):
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(volume):
            raise RuntimeError(f"{path.name} must resolve beneath the external volume")
        if shutil.disk_usage(resolved).free < reserve_gib * 1024**3:
            raise RuntimeError("external volume needs 12 GiB reserve; no source assets removed")
    if shutil.disk_usage(project.parent).free < internal_reserve_gib * 1024**3:
        raise RuntimeError("internal volume needs 8 GiB swap reserve")


def editor_command(engine, project, script, log, cache):
    return [
        str(engine / "Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"),
        str(project),
        "/Engine/Maps/Entry",
        "-NoSplash",
        "-NoSound",
        "-ExecCmds=py " + str(script),
        "-abslog=" + str(log),
        "-LocalDataCachePath=" + str(cache),
        "-ZenDataPath=" + str(cache / "Zen"),
        "-asyncassetcompilationmaxconcurrency=1",
        "-asynctexturecompilationmaxconcurrency=1",
        "-asyncskeletalmeshcompilationmaxconcurrency=1",
        "-asyncgroomcompilationmaxconcurrency=1",
        "-ini:Engine:[DevOptions.Shaders]:PercentageUnusedShaderCompilingThreads=85",
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--xcode", type=Path, required=True)
    parser.add_argument("--volume", type=Path, required=True)
    parser.add_argument("--reports", type=Path, required=True)
    parser.add_argument("--presets", default=",".join(NAMES))
    parser.add_argument("--adopt-pid", type=int, help="wait for the already launched first preset")
    parser.add_argument(
        "--phase-timeout",
        type=int,
        default=14400,
        help="seconds per acquisition/cold-load phase (default: four hours)",
    )
    args = parser.parse_args()
    if args.phase_timeout < 300:
        parser.error("phase timeout must be at least 300 seconds")
    names = selected_names(args.presets)
    project = args.project.resolve(strict=True)
    volume = args.volume.resolve(strict=True)
    # Adopting only waits for an existing editor; preserve the full launch reserve
    # for the next process, after the existing editor has released its swap.
    check_storage(project, volume, internal_reserve_gib=0 if args.adopt_pid else 8)
    if not args.reports.resolve().is_relative_to(volume):
        parser.error("reports/staging must be on the external volume")
    reports = args.reports.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "tmp").mkdir(exist_ok=True)
    env = dict(
        os.environ,
        DEVELOPER_DIR=str(developer_dir(args.xcode)),
        TMPDIR=str(reports / "tmp"),
        KERBSIDE_MH_QUIT="1",
        KERBSIDE_MH_REPORT=str(reports / "batch.json"),
    )
    tools = Path(__file__).resolve().parent
    script = tools / "metahuman_presets.py"
    cache = volume / "Kerbside/unreal-ddc"
    state = dict(
        stage="started", names=names, verified=[], pending=names.copy(), started_at=time.time()
    )
    status = reports / "queue.json"

    def record(stage, **fields):
        state.update(stage=stage, at=time.time(), **fields)
        write_report(status, state)
        print(stage, fields, flush=True)

    def run(name, verify=False):
        check_storage(project, volume)
        suffix = "verify" if verify else "acquire"
        child_env = dict(env, KERBSIDE_MH_PRESETS=name)
        if verify:
            child_env["KERBSIDE_MH_VERIFY_ONLY"] = "1"
        else:
            child_env.pop("KERBSIDE_MH_VERIFY_ONLY", None)
        cmd = editor_command(
            args.engine.resolve(), project, script, reports / f"{name}-{suffix}.log", cache
        )
        started = time.time()
        with (reports / f"{name}-{suffix}-stdout.log").open("ab") as log:
            proc = subprocess.Popen(cmd, env=child_env, stdout=log, stderr=subprocess.STDOUT)
            os.setpriority(os.PRIO_PROCESS, proc.pid, 10)
            record(suffix, name=name, pid=proc.pid)
            # A hung auth dialog can stop the editor ticker. Leave it for the user, do not
            # start another process or terminate it during a possible package save.
            deadline = time.monotonic() + args.phase_timeout
            while proc.poll() is None:
                report = reports / "batch.json"
                if report.exists():
                    current = json.loads(report.read_text()).get("presets", {}).get(name, {})
                    if current.get("at", 0) >= started and current.get(
                        "editor_retained_for_pending_requests"
                    ):
                        raise RuntimeError(
                            f"{name} needs attention; editor {proc.pid} "
                            "retained for pending callbacks"
                        )
                if time.monotonic() > deadline:
                    raise RuntimeError(
                        f"editor {proc.pid} still waiting; resolve its prompt before resuming"
                    )
                time.sleep(3)
            code = proc.returncode
        batch = json.loads((reports / "batch.json").read_text())
        row = batch["presets"].get(name, {})
        if code or row.get("stage") != "ready" or row.get("at", 0) < started:
            raise RuntimeError(
                f"{name} did not finish ({code}): "
                + row.get("error", "inspect Epic authentication/service logs")
            )
        if not row.get("verified_class"):
            raise RuntimeError(f"{name} has no reloadable runtime class")

    try:
        if args.adopt_pid:
            pid = args.adopt_pid
            expected = str(
                args.engine.resolve()
                / "Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
            )
            existing = subprocess.run(
                ["ps", "-p", str(pid), "-o", "args="], capture_output=True, text=True
            ).stdout
            if str(project) not in existing or "metahuman_presets.py" not in existing:
                raise RuntimeError("adopted PID is not this project's MetaHuman acquisition")
            record("waiting_for_existing_editor", pid=pid, name=names[0])
            deadline = time.monotonic() + args.phase_timeout
            while True:
                row = subprocess.run(
                    ["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True
                )
                if row.returncode or row.stdout.strip() != expected:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError("existing editor still waiting; no second editor launched")
                time.sleep(5)
            batch = json.loads((reports / "batch.json").read_text())
            if batch["presets"].get(names[0], {}).get("stage") != "ready":
                # The first cloud phase may have timed out while Keychain was awaiting the user.
                # Once that editor has actually exited, allow one fresh request, then fail closed.
                run(names[0])
            run(names[0], verify=True)
            state["verified"].append(names[0])
            state["pending"].remove(names[0])
        for name in state["pending"].copy():
            run(name)
            run(name, verify=True)
            state["verified"].append(name)
            state["pending"].remove(name)
            record("preset_verified", name=name)
        # The existing character setup refuses any incomplete ten-MetaHuman roster. Only
        # this native roster is implemented; archived NPC/vehicle packs are never imported.
        roster_env = dict(env, KERBSIDE_REQUIRE_METAHUMANS="1")
        cmd = editor_command(
            args.engine.resolve(),
            project,
            tools / "characters_setup.py",
            reports / "roster.log",
            cache,
        )
        # characters_setup is synchronous, so use UE's synchronous-script process exit.
        cmd = [c for c in cmd if not c.startswith("-ExecCmds=")]
        cmd += ["-ExecutePythonScript=" + str(tools / "characters_setup.py")]
        roster_started = time.time()
        record("installing_strict_roster")
        with (reports / "roster-stdout.log").open("ab") as log:
            subprocess.run(
                cmd, env=roster_env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1200
            )
        report_path = project.parent / "Saved/KerbsideValidation/characters.json"
        if report_path.stat().st_mtime < roster_started:
            raise RuntimeError("strict roster did not write a fresh verification report")
        roster = json.loads(
            (project.parent / "Saved/KerbsideValidation/characters.json").read_text()
        )
        expected_names = {"Ada", *NAMES}
        if (
            roster.get("metahumans") != 10
            or {r["name"] for r in roster.get("roster", [])} != expected_names
            or any("/MetaHumans/" not in r["asset"] for r in roster.get("roster", []))
        ):
            raise RuntimeError("strict native roster report is incomplete")
        record("complete", roster=roster)
    except Exception as error:
        record("needs_attention", error=str(error))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
