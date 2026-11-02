"""Put a build of build_makehuman_avatars.py in the public store, where the page reads it.

    python tools/avatars/publish_avatars.py build/avatars [--store s3://bucket]

Every file goes under ``avatars/<stamp>/`` (the stamp is a hash of the build), so a file's name
never changes what it holds and can be cached for good; ``avatars/catalogue.json`` is written
last, pointing at the new stamp, so a page never sees half a build. The store defaults to
$KERBSIDE_PUBLIC_STORE.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

TYPES = {".glb": "model/gltf-binary", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json"}
FOREVER = "public, max-age=31536000, immutable"


def stamp(folder: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(folder.rglob("*")):
        if path.is_file() and path.name != "catalogue.json":
            digest.update(path.relative_to(folder).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


def stamped(catalogue: dict, prefix: str) -> dict:
    """The catalogue with every file path under ``prefix``."""
    out = json.loads(json.dumps(catalogue))
    for body in out["bodies"].values():
        body["file"] = f"{prefix}/{body['file']}"
    for item in out["items"]:
        item["files"] = {sex: f"{prefix}/{path}" for sex, path in item["files"].items()}
    for key in ("skin_files", "eye_files"):
        out[key] = {name: f"{prefix}/{path}" for name, path in out[key].items()}
    out["build"] = prefix
    return out


def files_of(catalogue: dict) -> list[str]:
    paths = [b["file"] for b in catalogue["bodies"].values()]
    paths += [p for item in catalogue["items"] for p in item["files"].values()]
    paths += [*catalogue["skin_files"].values(), *catalogue["eye_files"].values()]
    return sorted(set(paths))


def publish(folder: Path, store) -> dict:
    catalogue = json.loads((folder / "catalogue.json").read_text())
    prefix = stamp(folder)
    for path in files_of(catalogue):
        source = folder / path
        store.put_file(f"avatars/{prefix}/{path}", source, content_type=TYPES[source.suffix],
                       cache_control=FOREVER)
    out = stamped(catalogue, prefix)
    store.put_json("avatars/catalogue.json", out, cache_control="no-cache")
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("folder", type=Path)
    p.add_argument("--store", default=os.environ.get("KERBSIDE_PUBLIC_STORE"))
    a = p.parse_args()
    if not a.store:
        raise SystemExit("no store: pass --store or set KERBSIDE_PUBLIC_STORE")
    from smc.cloud.store import open_store
    out = publish(a.folder, open_store(a.store, role="public"))
    print(f"published build {out['build']}: {len(files_of(out))} files")


if __name__ == "__main__":
    main()
