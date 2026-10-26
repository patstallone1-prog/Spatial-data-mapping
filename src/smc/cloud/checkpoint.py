"""Content-addressed trees: a folder saved as objects named by their sha256, plus a manifest.

``cas/<aa>/<sha256>`` holds each distinct file once, whatever folder or stage it came from, so a
cell's checkpoint after its lidar stage re-sends only what the lidar wrote; ``trees/<digest>.json``
lists ``path -> [sha256, size, mode]`` and is itself named by the sha256 of its canonical text.
A tree digest is therefore a complete, immutable description of a folder: a job's output is one,
and the next stage starts by restoring it. Every file restored is hashed and compared before it
is moved into place, so a truncated download is never mistaken for an input.
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from .store import ObjectStore

#: Never saved: caches the stage rebuilds, partial downloads, editor and OS litter.
EXCLUDE = ("lidar-cache", "points-cache", "*.part", ".*.part", "__pycache__", ".DS_Store",
           "*.pyc", ".kerbside-index.json", ".kerbside-index.json.part")
CHUNK = 1 << 20


@dataclass
class TreeStats:
    tree: str
    files: int
    bytes_total: int
    bytes_sent: int = 0
    bytes_received: int = 0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def cas_key(sha: str) -> str:
    return f"cas/{sha[:2]}/{sha}"


def _excluded(rel: str, exclude: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(part, pat) for part in Path(rel).parts for pat in exclude)


def walk(root: Path, paths: list[str], exclude: tuple[str, ...] = EXCLUDE) -> list[tuple[str, Path]]:
    """Every file under ``root/<path>`` for each path, following links (a cell's folder may be a
    link to the external drive), as ``(path relative to root, absolute path)``."""
    out = []
    for top in paths:
        base = root / top
        if base.is_file():
            out.append((top, base))
            continue
        for dirpath, dirnames, filenames in os.walk(base, followlinks=True):
            here = Path(dirpath)
            dirnames[:] = sorted(d for d in dirnames
                                 if not _excluded((here / d).relative_to(root).as_posix(), exclude))
            for name in sorted(filenames):
                rel = (here / name).relative_to(root).as_posix()
                if not _excluded(rel, exclude):
                    out.append((rel, here / name))
    return out


def manifest_digest(manifest: dict) -> str:
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


INDEX = ".kerbside-index.json"


def _load_index(root: Path) -> dict:
    try:
        return json.loads((root / INDEX).read_text())
    except (OSError, ValueError):
        return {}


def _save_index(root: Path, index: dict) -> None:
    path = root / INDEX
    tmp = path.with_name(f".{path.name}.part")
    tmp.write_text(json.dumps(index, separators=(",", ":")))
    os.replace(tmp, path)


def _sha(index: dict, rel: str, path: Path) -> str:
    """A file's sha256, from the index when its size and modification time are unchanged:
    a house run's 26 GB is not re-read before every batch."""
    st = path.stat()
    entry = index.get(rel)
    if entry and entry[1] == st.st_size and entry[2] == st.st_mtime_ns:
        return entry[0]
    sha = sha256_file(path)
    index[rel] = [sha, st.st_size, st.st_mtime_ns]
    return sha


#: Files sent at once. Each is a HEAD and maybe a PUT, a round trip apiece to the bucket, so
#: one at a time a folder of small files is bound by latency, not bandwidth.
UPLOADS = 16


def push_tree(store: ObjectStore, root: Path, paths: list[str], *,
              exclude: tuple[str, ...] = EXCLUDE, known: set[str] | None = None) -> TreeStats:
    """Save the folders ``paths`` under ``root``; returns the tree's digest and what was sent.
    ``known`` is a set of sha256 already in the store (skips a HEAD per file); it is updated."""
    root = Path(root)
    known = known if known is not None else set()
    index = _load_index(root)
    files: dict[str, list] = {}
    todo: dict[str, Path] = {}
    total = 0
    for rel, path in walk(root, paths, exclude):
        try:
            sha = _sha(index, rel, path)
            st = path.stat()
        except FileNotFoundError:  # a folder still being written (the house run) moved it on
            continue
        total += st.st_size
        files[rel] = [sha, st.st_size, st.st_mode & 0o777]
        if sha not in known:
            todo.setdefault(sha, path)
    _save_index(root, index)

    def send(item: tuple[str, Path]) -> int | None:
        sha, path = item
        if store.head(cas_key(sha)) is not None:
            return 0
        try:
            store.put_file(cas_key(sha), path)
        except FileNotFoundError:
            return None
        return path.stat().st_size

    with ThreadPoolExecutor(UPLOADS) as pool:
        results = dict(zip(todo, pool.map(send, todo.items()), strict=True))
    # A file gone before it was sent is left out of the tree, so the tree never names an
    # object the store doesn't have.
    gone = {sha for sha, n in results.items() if n is None}
    if gone:
        files = {rel: entry for rel, entry in files.items() if entry[0] not in gone}
        total = sum(entry[1] for entry in files.values())
    sent = sum(n for n in results.values() if n)
    known.update(sha for sha in todo if sha not in gone)
    manifest = {"schema": "kerbside.tree/1", "paths": sorted(paths), "files": files}
    digest = manifest_digest(manifest)
    key = f"trees/{digest}.json"
    if store.head(key) is None:
        store.put_json(key, manifest)
    return TreeStats(digest, len(files), total, bytes_sent=sent)


def read_tree(store: ObjectStore, digest: str) -> dict:
    manifest = store.get_json(f"trees/{digest}.json")
    if manifest is None:
        raise KeyError(f"tree {digest} is not in {store.name}")
    if manifest_digest(manifest) != digest:
        raise ValueError(f"tree {digest} does not hash to its name")
    return manifest


def pull_tree(store: ObjectStore, digest: str, root: Path, *, clean: bool = True) -> TreeStats:
    """Restore a tree under ``root``: files already there with the right content stay, the rest
    are fetched, hashed and moved into place. With ``clean``, any other file under the tree's
    folders is removed, so what is left is exactly the tree -- a failed attempt's leftovers
    cannot leak into the next one. Caches (:data:`EXCLUDE`) are left for the stage to reuse."""
    manifest = read_tree(store, digest)
    root = Path(root)
    index = _load_index(root)
    wanted = manifest["files"]
    if clean:
        for top in manifest["paths"]:
            if (root / top).exists():
                for rel, path in walk(root, [top]):
                    if rel not in wanted:
                        path.unlink()
                        index.pop(rel, None)
    received = total = 0
    try:
        for rel, (sha, size, mode) in sorted(wanted.items()):
            target = root / rel
            total += size
            if target.is_file() and target.stat().st_size == size and _sha(index, rel, target) == sha:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            part = target.with_name(f".{target.name}.part")
            store.get_file(cas_key(sha), part)
            got = sha256_file(part)
            if got != sha:
                part.unlink(missing_ok=True)
                raise ValueError(f"{rel}: fetched {got[:12]}, expected {sha[:12]}")
            os.chmod(part, mode)
            os.replace(part, target)
            st = target.stat()
            index[rel] = [sha, st.st_size, st.st_mtime_ns]
            received += size
    finally:
        _save_index(root, index)
    return TreeStats(digest, len(wanted), total, bytes_received=received)


def set_pointer(store: ObjectStore, name: str, digest: str, **extra) -> None:
    """``pointers/<name>.json``: the current tree of a shared input or a migrated folder."""
    store.put_json(f"pointers/{name}.json", {"tree": digest, **extra})


def get_pointer(store: ObjectStore, name: str) -> dict | None:
    return store.get_json(f"pointers/{name}.json")
