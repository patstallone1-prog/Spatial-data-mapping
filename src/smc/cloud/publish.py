"""Approved cells into the public bucket: immutable chunks, versioned releases, one atomic pointer.

Layout of ``kerbside-public``::

    chunks/<sha256[:24]><ext>   every published file, named by its content -- the naming of
                                tools/publish_chunks.py, so both write the same objects. Served
                                ``public, max-age=31536000, immutable``: once written it never
                                changes, and an old page keeps reading the version it knew.
    releases/<version>.json     a release: which chunk each site path is, which cells it holds,
                                its parent. It is also a valid ``asset-map.json``
                                (``kerbside.asset_map/1``: version, base, files), so the viewer's
                                own lookup (``viaStore`` in the renderer) reads it unchanged.
    releases/current.json       the pointer: which release is live, and the verified chain
                                behind it. Changed only by a conditional write against the
                                version read, so two publishers can never lose each other's cell.

Publishing a cell uploads only its new chunks, writes a release that is the current one plus
that cell, checks every chunk of the cell answers on the public origin, then moves the pointer.
If the check fails the pointer does not move. If a later check of the live release fails,
:func:`rollback` moves it back to the last release that passed. Nothing is ever deleted here.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.request
from collections.abc import Callable
from pathlib import Path

from .store import ObjectStore, PreconditionFailed

CONTENT_TYPES = {".json": "application/json", ".geojson": "application/geo+json",
                 ".bin": "application/octet-stream", ".glb": "model/gltf-binary",
                 ".pbf": "application/x-protobuf", ".png": "image/png", ".jpg": "image/jpeg",
                 ".jpeg": "image/jpeg", ".webp": "image/webp", ".ktx2": "image/ktx2"}
IMMUTABLE = "public, max-age=31536000, immutable"
POINTER = "releases/current.json"
#: The site path a cell's files are served under: what an app page for the cell asks for
#: ("../../regions/<cell>/<file>", tools/build_app_worlds.py), and what the asset map maps.
SITE_PREFIX = "regions"


def chunk_name(path: Path) -> str:
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    return f"chunks/{digest[:24]}{Path(path).suffix}"


def cell_files(cell_dir: Path) -> dict[str, Path]:
    """The servable files of a cell's build: its ``site`` folder, data and textures only."""
    site = Path(cell_dir) / "site"
    out = {}
    for path in sorted(site.rglob("*")):
        if path.is_file() and path.suffix in CONTENT_TYPES and not path.name.startswith("."):
            out[path.relative_to(site).as_posix()] = path
    return out


def http_answers(url: str, timeout: float = 20) -> bool:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=timeout) as r:
            return r.status == 200
    except OSError:
        return False


class Publisher:
    def __init__(self, store: ObjectStore, base_url: str, *,
                 answers: Callable[[str], bool] = http_answers, clock=time.time):
        self.store = store
        self.base = base_url.rstrip("/")
        self.answers = answers
        self.clock = clock

    # -- reading ----------------------------------------------------------------------------

    def pointer(self) -> tuple[dict | None, str | None]:
        head = self.store.head(POINTER)
        if head is None:
            return None, None
        return json.loads(self.store.get(POINTER)), head.etag

    def release(self, version: str) -> dict:
        found = self.store.get_json(f"releases/{version}.json")
        if found is None:
            raise KeyError(f"release {version} is not in {self.store.name}")
        return found

    def current(self) -> dict | None:
        pointer, _ = self.pointer()
        return self.release(pointer["version"]) if pointer else None

    # -- writing ----------------------------------------------------------------------------

    def _upload(self, files: dict[str, Path]) -> tuple[dict[str, str], int]:
        mapping, sent = {}, 0
        for rel, path in files.items():
            name = chunk_name(path)
            mapping[rel] = name
            if self.store.head(name) is None:
                self.store.put_file(name, path, content_type=CONTENT_TYPES[path.suffix],
                                    cache_control=IMMUTABLE)
                sent += path.stat().st_size
        return mapping, sent

    def verify(self, files: dict[str, str]) -> list[str]:
        """The chunks that do not answer on the public origin (an empty list is a pass)."""
        return sorted({name for name in files.values() if not self.answers(f"{self.base}/{name}")})

    def _write_release(self, parent: dict | None, files: dict, cells: dict, note: str) -> dict:
        body = {"files": files, "cells": cells}
        version = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]
        release = {"schema": "kerbside.asset_map/1", "release_schema": "kerbside.release/1",
                   "version": version, "base": self.base, "files": files, "cells": cells,
                   "parent": parent["version"] if parent else None, "created_at": self.clock(),
                   "note": note}
        key = f"releases/{version}.json"
        if self.store.head(key) is None:
            self.store.put_json(key, release, cache_control=IMMUTABLE)
        return release

    def _move_pointer(self, release: dict, etag: str | None, pointer: dict | None) -> None:
        verified = [release["version"], *((pointer or {}).get("verified") or [])][:50]
        body = {"version": release["version"], "key": f"releases/{release['version']}.json",
                "at": self.clock(), "verified": verified}
        if etag is None:
            self.store.put_json(POINTER, body, if_none_match=True, cache_control="no-cache")
        else:
            self.store.put_json(POINTER, body, if_match=etag, cache_control="no-cache")

    def publish_cell(self, cell: str, cell_dir: Path, *, gate: dict, tree: str | None = None,
                     attempts: int = 8) -> dict:
        """Put one approved cell in the live release; returns what was done."""
        if gate.get("decision") not in ("pass", "approved"):
            raise PermissionError(f"{cell}: the gate's verdict is {gate.get('decision')!r}")
        files = cell_files(cell_dir)
        if "sf-corridor-3d.json" not in files:
            raise FileNotFoundError(f"{cell}: no site/sf-corridor-3d.json to publish")
        mapping, sent = self._upload(files)
        site = {f"{SITE_PREFIX}/{cell}/{rel}": name for rel, name in mapping.items()}
        missing = self.verify(site)
        if missing:
            raise RuntimeError(f"{cell}: {len(missing)} chunks do not answer publicly "
                               f"(first {missing[0]}); the release was not moved")
        record = {"files": sorted(site), "tree": tree, "decision": gate["decision"],
                  "reviewer": gate.get("reviewer"), "published_at": self.clock(),
                  "payload_sha256": gate.get("payload_sha256")}
        for _ in range(attempts):
            pointer, etag = self.pointer()
            parent = self.release(pointer["version"]) if pointer else None
            old = (parent or {}).get("files", {})
            # The cell's previous files go; everything else in the live release stays as it is.
            stale = set((parent or {}).get("cells", {}).get(cell, {}).get("files", []))
            merged = {k: v for k, v in old.items() if k not in stale}
            merged.update(site)
            cells = {**(parent or {}).get("cells", {}), cell: record}
            if parent and merged == old and parent.get("cells", {}).get(cell, {}).get("tree") == tree:
                return {"cell": cell, "version": parent["version"], "changed": False, "bytes_sent": sent}
            release = self._write_release(parent, merged, cells, f"publish {cell}")
            try:
                self._move_pointer(release, etag, pointer)
            except PreconditionFailed:
                continue  # another publisher moved it first: merge onto theirs and try again
            return {"cell": cell, "version": release["version"], "changed": True,
                    "bytes_sent": sent, "files": len(site), "parent": release["parent"]}
        raise RuntimeError(f"{cell}: the release pointer kept moving under {attempts} attempts")

    def withdraw_cell(self, cell: str, reason: str) -> dict:
        """Take a cell out of the live release (its chunks stay, for older pages)."""
        while True:
            pointer, etag = self.pointer()
            if not pointer:
                return {"changed": False}
            parent = self.release(pointer["version"])
            entry = parent.get("cells", {}).get(cell)
            if not entry:
                return {"changed": False, "version": parent["version"]}
            files = {k: v for k, v in parent["files"].items() if k not in set(entry["files"])}
            cells = {k: v for k, v in parent["cells"].items() if k != cell}
            release = self._write_release(parent, files, cells, f"withdraw {cell}: {reason}")
            try:
                self._move_pointer(release, etag, pointer)
            except PreconditionFailed:
                continue
            return {"changed": True, "version": release["version"]}

    def check_live(self) -> list[str]:
        """Every chunk of the live release, asked of the public origin."""
        live = self.current()
        return self.verify(live["files"]) if live else []

    def rollback(self, to: str | None = None, reason: str = "") -> dict:
        """Point at an earlier release -- ``to``, or the newest verified one behind the live one
        whose chunks all answer. The bad release stays in the bucket for inspection."""
        pointer, etag = self.pointer()
        if not pointer:
            raise RuntimeError("no release to roll back from")
        candidates = [to] if to else [v for v in pointer.get("verified", [])[1:]]
        for version in candidates:
            release = self.release(version)
            if self.verify(release["files"]):
                continue
            body = {"version": version, "key": f"releases/{version}.json", "at": self.clock(),
                    "verified": [v for v in pointer.get("verified", []) if v != pointer["version"]],
                    "rolled_back_from": pointer["version"], "reason": reason}
            self.store.put_json(POINTER, body, if_match=etag, cache_control="no-cache")
            return {"from": pointer["version"], "to": version}
        raise RuntimeError("no earlier release passes its check; the pointer was left as it is")
