"""Local import: scans the user fetched themselves (Polycam, OpenHeritage3D, Sketchfab).

Each file in ``data/scans/<source>/inbox/`` needs a sidecar ``<file>.json`` saying where it came
from and under what licence -- ``{"licence": "CC Attribution", "author": ..., "source_url": ...,
"title": ..., "lonlat": [lon, lat] (optional), "scale_to_m": 1.0 (optional)}``. A file without
one is recorded as not usable: a scan whose licence is unknown is not a scan we may use. Nothing
is placed here; a kept scan waits for the aligner (docs/24 §A5).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from smc.scans.classify import classify
from smc.scans.readers import UnreadableScan, read
from smc.scans.sources import licence

SUFFIXES = {".glb", ".gltf", ".obj", ".ply", ".las", ".laz"}
MAX_POINTS = 2_000_000


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def import_file(path: Path, source: str) -> dict:
    sidecar = path.with_suffix(path.suffix + ".json")
    meta = json.loads(sidecar.read_text()) if sidecar.exists() else {}
    ident, usable, commercial, reason = licence(meta.get("licence"))
    if not sidecar.exists():
        reason = "no sidecar: licence and author unknown"
    record = {
        "source": source, "file": path.name, "sha256": sha256(path),
        "bytes": path.stat().st_size, "title": meta.get("title", path.stem),
        "author": meta.get("author"), "source_url": meta.get("source_url"),
        "licence_id": ident, "commercial_use": commercial, "lonlat": meta.get("lonlat"),
        "provenance_kind": "scan_point_cloud" if path.suffix.lower() in (".las", ".laz")
        else "scan_mesh",
        "placed": False,
    }
    try:
        points, mesh = read(path)
    except (UnreadableScan, OSError, ValueError, KeyError, IndexError) as err:
        record.update(kind="unreadable", keep=False, reason=f"unreadable: {err}")
        return record
    record["points"] = len(points)
    record["triangles"] = int(mesh.triangle_count) if mesh is not None else 0
    if len(points) > MAX_POINTS:
        points = points[np.random.default_rng(0).choice(len(points), MAX_POINTS, replace=False)]
    # glTF is y-up by its specification and LAS z-up; a sidecar may say so for the others.
    up = {"x": 0, "y": 1, "z": 2}.get(meta.get("up", ""))
    if up is None:
        up = {".glb": 1, ".gltf": 1, ".las": 2, ".laz": 2}.get(path.suffix.lower())
    verdict = classify(points, float(meta.get("scale_to_m", 1.0)), up)
    record.update(verdict.to_json())
    if not usable:
        record.update(keep=False, reason=reason)
    return record


def run(root: Path, sources: tuple[str, ...]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for source in sources:
        inbox = root / source / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        records = [import_file(path, source) for path in sorted(inbox.iterdir())
                   if path.suffix.lower() in SUFFIXES]
        out[source] = records
    return out
