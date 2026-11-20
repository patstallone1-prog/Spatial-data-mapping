"""Put a build of tools/build_npc_characters.mjs in the public store, where the page reads it.

    python tools/publish_npc_characters.py docs/city/models/npc [--store s3://bucket]

The near ring's Unreal characters are Epic content, kept out of the public repo, so the page
reads them from the store: every file goes under ``npc/<stamp>/`` (a hash of the build, so a name
never changes what it holds and is cached for good), and ``npc/current.json`` is written last,
naming the stamp, so a page never sees half a build. The store defaults to
$KERBSIDE_PUBLIC_STORE (docs/51-near-ring-people-and-surfaces.md).
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path

TYPES = {".glb": "model/gltf-binary", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json"}
FOREVER = "public, max-age=31536000, immutable"


def build_files(folder: Path) -> list[str]:
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*")
                  if p.is_file() and p.suffix in TYPES and not p.name.startswith("."))


def stamp(folder: Path) -> str:
    digest = hashlib.sha256()
    for name in build_files(folder):
        digest.update(name.encode())
        digest.update((folder / name).read_bytes())
    return digest.hexdigest()[:12]


def publish(folder: Path, store) -> dict:
    files = build_files(folder)
    if "manifest.json" not in files or "clips.glb" not in files:
        raise SystemExit(f"{folder} is not a build of tools/build_npc_characters.mjs")
    prefix = stamp(folder)
    for name in files:
        source = folder / name
        store.put_file(f"npc/{prefix}/{name}", source, content_type=TYPES[source.suffix], cache_control=FOREVER)
    current = {"build": prefix, "files": files}
    store.put_json("npc/current.json", current, cache_control="no-cache")
    return current


def main():
    p = argparse.ArgumentParser()
    p.add_argument("folder", type=Path)
    p.add_argument("--store", default=os.environ.get("KERBSIDE_PUBLIC_STORE"))
    a = p.parse_args()
    if not a.store:
        raise SystemExit("no store: pass --store or set KERBSIDE_PUBLIC_STORE")
    from smc.cloud.store import open_store
    out = publish(a.folder, open_store(a.store, role="public"))
    print(f"published npc build {out['build']}: {len(out['files'])} files")


if __name__ == "__main__":
    main()
