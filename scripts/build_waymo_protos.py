#!/usr/bin/env python3
"""Compile the Waymo protobuf definitions into build/waymo_proto.

The .proto files are Apache-2.0 and are fetched from the Waymo repository rather than vendored,
so there is one copy and it is the upstream one. The generated modules are build artefacts and
stay out of version control; checking them in only invites the compiled and the source copies to
drift apart without anyone noticing.
"""

from __future__ import annotations

import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "waymo_proto"
BASE = "https://raw.githubusercontent.com/waymo-research/waymo-open-dataset/master/src/waymo_open_dataset"
FILES = ("dataset.proto", "label.proto", "protos/map.proto", "protos/vector.proto", "protos/keypoint.proto")


def main() -> int:
    for name in FILES:
        target = OUT / "waymo_open_dataset" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"{BASE}/{name}", timeout=60) as response:
            target.write_bytes(response.read())
        print(f"  fetched {name}")

    sources = [str(OUT / "waymo_open_dataset" / name) for name in FILES]
    result = subprocess.run(
        [sys.executable, "-m", "grpc_tools.protoc", f"-I{OUT}", f"--python_out={OUT}", *sources]
    )
    if result.returncode:
        return result.returncode

    # Namespace packages would work, but an explicit __init__ keeps the import predictable
    # whatever else is on the path.
    for directory in (OUT / "waymo_open_dataset", OUT / "waymo_open_dataset" / "protos"):
        (directory / "__init__.py").touch()
    print(f"compiled -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
