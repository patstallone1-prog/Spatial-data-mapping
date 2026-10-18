"""Launch the installed world with its Xcode/Metal toolchain, without global changes.

Uses the project's existing default map. Does not install, rebuild, import, migrate
or replace any assets. Additional Unreal arguments may follow ``--``.
"""
from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path

from build_macos import developer_dir


def launch_command(project: Path, engine: Path, log: Path, extra: list[str]) -> list[str]:
    project = project.resolve(strict=True)
    binary = (engine.resolve(strict=True)
              / "Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor")
    if project.suffix != ".uproject" or not binary.is_file():
        raise ValueError("existing Unreal project and engine installation required")
    return [str(binary), str(project), "-game", "-windowed", "-NoSplash",
            "-abslog=" + str(log.resolve()), *extra]


def cache_arguments(cache: Path) -> list[str]:
    cache = cache.resolve()
    if cache.is_relative_to("/Volumes") and (
            len(cache.parts) < 4 or not Path(*cache.parts[:3]).is_mount()):
        raise ValueError("External cache volume is not mounted; refusing internal-disk fallback")
    # subprocess passes each argument intact. Embedded quotes would be quoted
    # twice by Unreal's macOS argv reconstruction and silently defeat the override.
    return [f"-LocalDataCachePath={cache}", f"-ZenDataPath={cache / 'Zen'}"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--xcode", type=Path, required=True)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True,
                        help="Writable derived-data cache (prefer the external drive)")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("unreal_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    extra = args.unreal_args[1:] if args.unreal_args[:1] == ["--"] else args.unreal_args
    command = launch_command(args.project, args.engine, args.log, extra)
    # Explicit command-line overrides also cover installed-editor launches where
    # macOS drops hyphenated UE environment variables. Zen has a separate override.
    cache = args.cache_dir.resolve()
    command += cache_arguments(cache)
    env = dict(os.environ, DEVELOPER_DIR=str(developer_dir(args.xcode)))
    # Xcode alone is not sufficient: the separately installed Metal toolchain must
    # resolve too. Refuse a launch that would simply repeat the shader stall.
    for check in (["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-version"],
                  ["/usr/bin/xcrun", "--sdk", "macosx", "--find", "metal"]):
        subprocess.run(check, env=env, check=True)
    if args.check_only:
        return 0
    cache.mkdir(parents=True, exist_ok=True)
    args.log.resolve().parent.mkdir(parents=True, exist_ok=True)
    return subprocess.call(command, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
