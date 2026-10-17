"""Build the installed runtime without changing global xcode-select or Epic sources."""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import tempfile
from pathlib import Path


def developer_dir(xcode: Path) -> Path:
    xcode = xcode.resolve(strict=True)
    if not (xcode / "Contents/Developer/usr/bin/xcodebuild").is_file():
        raise ValueError("Pass a complete installed Xcode.app")
    # UE's SDK plist discovery cannot handle spaces in some external-drive paths.
    # A stable, private bridge fixes discovery without moving Xcode or its SDK.
    parent = Path(tempfile.gettempdir()) / ("kerbside-sdk-" + hashlib.sha256(str(xcode).encode()).hexdigest()[:12])
    parent.mkdir(mode=0o700, exist_ok=True)
    if parent.is_symlink() or parent.stat().st_uid != os.getuid() or parent.stat().st_mode & 0o022:
        raise ValueError("SDK bridge directory is not private to this user")
    bridge = parent / "Xcode.app"
    if bridge.is_symlink():
        if bridge.resolve() != xcode:
            raise ValueError("Existing SDK bridge points elsewhere; refusing overwrite")
    elif bridge.exists():
        raise ValueError("SDK bridge is occupied; refusing overwrite")
    else:
        bridge.symlink_to(xcode, target_is_directory=True)
    return bridge / "Contents/Developer"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--xcode", type=Path, required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    project = args.project.resolve(strict=True)
    script = args.engine / "Engine/Build/BatchFiles/Mac/Build.sh"
    if project.suffix != ".uproject" or not script.is_file():
        parser.error("existing Unreal project and engine installation required")
    env = dict(os.environ, DEVELOPER_DIR=str(developer_dir(args.xcode)))
    if args.check_only:
        return subprocess.call(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-version"], env=env)
    return subprocess.call([str(script), project.stem + "Editor", "Mac", "Development",
                            "-Project=" + str(project), "-WaitMutex", "-NoHotReloadFromIDE",
                            "-MaxParallelActions=4"], env=env)


if __name__ == "__main__":
    raise SystemExit(main())
