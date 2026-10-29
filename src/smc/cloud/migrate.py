"""The one-time move: Kerbside's own work from the Mac and its drive into the private bucket.

After this, no job reads a file that exists only on the Mac. Three kinds of upload, each a
content-addressed tree (:mod:`.checkpoint`) with a pointer the plan and the workers read:

* ``pointers/cell-<name>.json``   -- a cell's folder as its stages left it (``data/regions/<name>``,
  which for a gap cell is a link to the drive). The plan records every stage its journal shows
  done as done, so nothing finished is run again.
* ``pointers/shared-<name>.json`` -- an input no stage re-fetches (:data:`.stages.SHARED_INPUTS`);
  ``shared-house-inputs`` is built by :func:`migrate_house_inputs`.
* ``pointers/house-state.json``   -- the house pipeline's journals and fits.
* ``pointers/interiors-state-<region>.json`` -- the interior engine's finished batches
  (``build/inferred-interiors/<region>``); the plan records each batch with a manifest done.
* ``pointers/restaurant-state.json`` -- the restaurants' rounds so far (``docs/inferred-
  restaurants``, saved as ``build/inferred-restaurants``, where the round jobs keep it).

Refused, whatever is asked: anything :mod:`.inventory` classes ``restricted`` (Street View
references, Waymo, PandaSet pixels). Skipped: caches and data the stages fetch again (point
cells unless ``--with-points``). Re-running is cheap: an object already in the bucket is not
sent again.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from .checkpoint import (
    EXCLUDE,
    cas_key,
    get_pointer,
    manifest_digest,
    push_tree,
    read_tree,
    set_pointer,
    sha256_file,
)
from .inventory import classify
from .stages import (
    HOUSE_PROVIDERS,
    HOUSE_REGIONS,
    HOUSE_STATE,
    INTERIOR_OUT,
    RESTAURANT_STATE,
    SHARED_INPUTS,
    house_input_paths,
)
from .store import ObjectStore, open_store

POINT_EXCLUDE = (*EXCLUDE, "points")


def _refuse_restricted(paths: list[str]) -> None:
    bad = [p for p in paths if classify(p)[0] == "restricted"]
    if bad:
        raise PermissionError(f"restricted data is never uploaded: {', '.join(bad)}")


def migrate_cell(store: ObjectStore, root: Path, name: str, *, with_points: bool = False,
                 known: set[str] | None = None) -> dict:
    rel = f"data/regions/{name}"
    if not (root / rel).is_dir():
        raise FileNotFoundError(f"{rel} is not here (is the drive mounted?)")
    _refuse_restricted([rel])
    stats = push_tree(store, root, [rel], exclude=EXCLUDE if with_points else POINT_EXCLUDE,
                      known=known)
    journal = root / rel / "ingest.json"
    done = []
    if journal.is_file():
        done = [s for s, row in json.loads(journal.read_text()).get("stages", {}).items()
                if row.get("status") == "done"]
    set_pointer(store, f"cell-{name}", stats.tree, files=stats.files, bytes=stats.bytes_total,
                stages_done=done)
    return {"cell": name, "tree": stats.tree, "files": stats.files, "bytes": stats.bytes_total,
            "sent": stats.bytes_sent, "stages_done": done}


def migrate_shared(store: ObjectStore, root: Path, name: str, known: set[str] | None = None) -> dict:
    if name == "house-inputs":
        return migrate_house_inputs(store, root, known)
    paths = [p for p in SHARED_INPUTS[name] if (root / p).exists()]
    if not paths:
        return {"shared": name, "skipped": "not present here"}
    _refuse_restricted(paths)
    stats = push_tree(store, root, paths, known=known)
    set_pointer(store, f"shared-{name}", stats.tree, paths=paths)
    return {"shared": name, "tree": stats.tree, "files": stats.files, "bytes": stats.bytes_total,
            "sent": stats.bytes_sent}


HOUSE_POSES = "data/observation_enrichment/mapillary_poses.jsonl"
CELL_MAPS = ("sf-corridor-3d.json", "sf-corridor-terrain.json", "sf-corridor-terrain.bin")


def _open_rows(store: ObjectStore, sha: str) -> list:
    """A photo catalogue part with only :data:`.stages.HOUSE_PROVIDERS`' rows, stored; its
    ``[sha, size]``."""
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    with tempfile.TemporaryDirectory() as tmp:
        source, kept = Path(tmp) / "in.parquet", Path(tmp) / "out.parquet"
        store.get_file(cas_key(sha), source)
        table = pq.read_table(source)
        pq.write_table(table.filter(pc.is_in(table["provider"], value_set=pa.array(HOUSE_PROVIDERS))), kept)
        digest = sha256_file(kept)
        if store.head(cas_key(digest)) is None:
            store.put_file(cas_key(digest), kept)
        return [digest, kept.stat().st_size]


def house_cells_input(store: ObjectStore, cells: dict[str, str]) -> dict:
    """``shared-house-cells``: each published cell's map and terrain (``cells``: name -> its
    saved tree) at docs/regions/<cell>/, where the filter and the matcher read a released cell,
    and its photo catalogue with only the open providers' rows. Maps are referenced, not copied;
    a catalogue part is filtered once (``filtered`` in the pointer). A cell without its map or
    catalogue is left out. Returns the pointer."""
    previous = get_pointer(store, "shared-house-cells") or {}
    filtered = dict(previous.get("filtered", {}))
    files: dict[str, list] = {}
    paths, used = [], []
    for cell, tree in sorted(cells.items()):
        try:
            source = read_tree(store, tree)["files"]
        except KeyError:
            continue
        site, catalog = f"data/regions/{cell}/site", f"data/regions/{cell}/catalog/observations"
        parts = sorted(p for p in source if p.startswith(f"{catalog}/") and p.endswith(".parquet"))
        if not parts or not all(f"{site}/{n}" in source for n in CELL_MAPS):
            continue
        for name in CELL_MAPS:
            files[f"docs/regions/{cell}/{name}"] = source[f"{site}/{name}"]
        for part in parts:
            sha = source[part][0]
            if sha not in filtered:
                filtered[sha] = _open_rows(store, sha)
            files[part] = [*filtered[sha], 0o644]
        paths += [f"docs/regions/{cell}", catalog]
        used.append(cell)
    if not used:
        return previous
    _refuse_restricted(paths)
    manifest = {"schema": "kerbside.tree/1", "paths": sorted(paths), "files": files}
    digest = manifest_digest(manifest)
    if previous.get("tree") == digest:
        return previous
    if store.head(f"trees/{digest}.json") is None:
        store.put_json(f"trees/{digest}.json", manifest)
    pointer = {"tree": digest, "cells": used, "filtered": filtered, "providers": list(HOUSE_PROVIDERS)}
    set_pointer(store, "shared-house-cells", digest, **{k: v for k, v in pointer.items() if k != "tree"})
    return pointer


def migrate_house_inputs(store: ObjectStore, root: Path, known: set[str] | None = None, *,
                         regions: tuple[str, ...] = HOUSE_REGIONS) -> dict:
    """The house filter's maps and catalogues, at the paths it reads them from. A catalogue is
    rewritten with only :data:`.stages.HOUSE_PROVIDERS`' rows; maps and poses are linked as
    they are. A region missing here is left out (and named), not an error."""
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    root = Path(root)
    with tempfile.TemporaryDirectory() as tmp:
        farm = Path(tmp)
        paths, missing, dropped = [], [], 0
        for region in regions:
            page, *rest = house_input_paths(region)
            if not (root / page).is_file():
                missing.append(region)
                continue
            for rel in (page, *rest):
                source, target = root / rel, farm / rel
                if rel.endswith("/observations"):
                    parts = sorted(source.glob("*.parquet"))
                    if not parts:
                        missing.append(region)
                        break
                    target.mkdir(parents=True, exist_ok=True)
                    for part in parts:
                        table = pq.read_table(part)
                        kept = table.filter(pc.is_in(table["provider"],
                                                     value_set=pa.array(HOUSE_PROVIDERS)))
                        dropped += table.num_rows - kept.num_rows
                        pq.write_table(kept, target / part.name)
                elif source.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.symlink_to(source.resolve())
                else:
                    continue
                paths.append(rel)
        if (root / HOUSE_POSES).is_file():
            (farm / HOUSE_POSES).parent.mkdir(parents=True, exist_ok=True)
            (farm / HOUSE_POSES).symlink_to((root / HOUSE_POSES).resolve())
            paths.append(HOUSE_POSES)
        if not paths:
            return {"shared": "house-inputs", "skipped": "not present here"}
        _refuse_restricted(paths)
        stats = push_tree(store, farm, paths, known=known)
    set_pointer(store, "shared-house-inputs", stats.tree, paths=paths, missing=missing,
                providers=list(HOUSE_PROVIDERS))
    return {"shared": "house-inputs", "tree": stats.tree, "files": stats.files,
            "bytes": stats.bytes_total, "sent": stats.bytes_sent, "missing": missing,
            "rows_left_out": dropped}


def migrate_house_state(store: ObjectStore, run_dir: Path, known: set[str] | None = None, *,
                        farm_dir: Path | None = None) -> dict:
    """``run_dir`` holds ``frontage-live``, ``facade-match``... (the drive's frontage run folder,
    linked into a worktree's ``build/``); they are saved as ``build/<name>``, where the workers'
    commands find them. ``farm_dir`` keeps the links and the hash index between runs, so a
    second run after a dropped connection does not read the drive's tens of gigabytes again."""
    run_dir = Path(run_dir)
    with tempfile.TemporaryDirectory() as tmp:
        farm = Path(farm_dir) if farm_dir else Path(tmp)
        (farm / "build").mkdir(parents=True, exist_ok=True)
        paths = []
        for rel in HOUSE_STATE:
            name = rel.split("/", 1)[1]
            link = farm / rel
            if link.is_symlink():
                link.unlink()
            if (run_dir / name).exists():
                link.symlink_to(run_dir / name)
                paths.append(rel)
        if not paths:
            raise FileNotFoundError(f"no house state under {run_dir}")
        stats = push_tree(store, farm, paths, known=known)
    set_pointer(store, "house-state", stats.tree, source=str(run_dir), paths=paths)
    return {"house_state": stats.tree, "files": stats.files, "bytes": stats.bytes_total,
            "sent": stats.bytes_sent}


def migrate_interiors(store: ObjectStore, root: Path, known: set[str] | None = None) -> list[dict]:
    """Each region's finished interior batches, one tree a region."""
    out = []
    base = Path(root) / INTERIOR_OUT
    for region in sorted(p.name for p in base.iterdir() if p.is_dir()) if base.is_dir() else []:
        rel = f"{INTERIOR_OUT}/{region}"
        done = sorted(m.parent.name for m in (base / region).glob("batch-*/manifest.json"))
        if not done:
            continue
        stats = push_tree(store, root, [rel], known=known)
        set_pointer(store, f"interiors-state-{region}", stats.tree, batches_done=done)
        out.append({"interiors": region, "tree": stats.tree, "batches_done": len(done),
                    "bytes": stats.bytes_total, "sent": stats.bytes_sent})
    return out


def migrate_restaurants(store: ObjectStore, root: Path, known: set[str] | None = None) -> dict:
    source = Path(root) / "docs/inferred-restaurants"
    if not (source / "history.json").is_file():
        return {"restaurants": "skipped", "why": "no rounds here"}
    with tempfile.TemporaryDirectory() as tmp:
        farm = Path(tmp)
        (farm / RESTAURANT_STATE).parent.mkdir(parents=True)
        (farm / RESTAURANT_STATE).symlink_to(source)
        stats = push_tree(store, farm, [RESTAURANT_STATE], known=known)
    set_pointer(store, "restaurant-state", stats.tree, source="docs/inferred-restaurants")
    return {"restaurants": stats.tree, "files": stats.files, "bytes": stats.bytes_total, "sent": stats.bytes_sent}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--private", default=os.environ.get("KERBSIDE_PRIVATE_STORE"),
                    help="s3://kerbside (or r2://...), or a folder")
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    ap.add_argument("--cells", default="", help="comma-separated, or 'all' for every folder present")
    ap.add_argument("--shared", default="", help="comma-separated names, or 'all'")
    ap.add_argument("--house-run", type=Path, help="the drive's frontage run folder")
    ap.add_argument("--with-points", action="store_true")
    ap.add_argument("--interiors", action="store_true", help="the interior engine's finished batches")
    ap.add_argument("--restaurants", action="store_true", help="the restaurants' rounds so far")
    ap.add_argument("--only-missing", action="store_true", help="skip cells already migrated")
    args = ap.parse_args(argv)
    if not args.private:
        ap.error("--private (or KERBSIDE_PRIVATE_STORE) is required")
    store = open_store(args.private, role="private")
    known: set[str] = set()
    if args.cells:
        regions = args.root / "data/regions"
        names = (sorted(p.name for p in regions.iterdir() if (p / "ingest.json").is_file())
                 if args.cells == "all" else args.cells.split(","))
        for name in names:
            if args.only_missing and get_pointer(store, f"cell-{name}"):
                continue
            try:
                print(json.dumps(migrate_cell(store, args.root, name, with_points=args.with_points,
                                              known=known)), flush=True)
            except (FileNotFoundError, PermissionError) as exc:
                print(json.dumps({"cell": name, "error": str(exc)}), flush=True)
    if args.shared:
        for name in (SHARED_INPUTS if args.shared == "all" else args.shared.split(",")):
            print(json.dumps(migrate_shared(store, args.root, name, known)), flush=True)
    if args.house_run:
        print(json.dumps(migrate_house_state(store, args.house_run, known,
                                             farm_dir=args.root / "build/cloud-house-farm")),
              flush=True)
    if args.interiors:
        for row in migrate_interiors(store, args.root, known):
            print(json.dumps(row), flush=True)
    if args.restaurants:
        print(json.dumps(migrate_restaurants(store, args.root, known)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
