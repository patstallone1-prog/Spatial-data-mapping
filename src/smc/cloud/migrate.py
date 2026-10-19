"""The one-time move: Kerbside's own work from the Mac and its drive into the private bucket.

After this, no job reads a file that exists only on the Mac. Three kinds of upload, each a
content-addressed tree (:mod:`.checkpoint`) with a pointer the plan and the workers read:

* ``pointers/cell-<name>.json``   -- a cell's folder as its stages left it (``data/regions/<name>``,
  which for a gap cell is a link to the drive). The plan records every stage its journal shows
  done as done, so nothing finished is run again.
* ``pointers/shared-<name>.json`` -- an input no stage re-fetches (:data:`.stages.SHARED_INPUTS`).
* ``pointers/house-state.json``   -- the house pipeline's journals and fits.

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

from .checkpoint import EXCLUDE, get_pointer, push_tree, set_pointer
from .inventory import classify
from .stages import HOUSE_STATE, SHARED_INPUTS
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
    paths = [p for p in SHARED_INPUTS[name] if (root / p).exists()]
    if not paths:
        return {"shared": name, "skipped": "not present here"}
    _refuse_restricted(paths)
    stats = push_tree(store, root, paths, known=known)
    set_pointer(store, f"shared-{name}", stats.tree, paths=paths)
    return {"shared": name, "tree": stats.tree, "files": stats.files, "bytes": stats.bytes_total,
            "sent": stats.bytes_sent}


def migrate_house_state(store: ObjectStore, run_dir: Path, known: set[str] | None = None) -> dict:
    """``run_dir`` holds ``frontage-live``, ``facade-match``... (the drive's frontage run folder,
    linked into a worktree's ``build/``); they are saved as ``build/<name>``, where the workers'
    commands find them."""
    run_dir = Path(run_dir)
    with tempfile.TemporaryDirectory() as tmp:
        farm = Path(tmp)
        (farm / "build").mkdir()
        paths = []
        for rel in HOUSE_STATE:
            name = rel.split("/", 1)[1]
            if (run_dir / name).exists():
                (farm / rel).symlink_to(run_dir / name)
                paths.append(rel)
        if not paths:
            raise FileNotFoundError(f"no house state under {run_dir}")
        stats = push_tree(store, farm, paths, known=known)
    set_pointer(store, "house-state", stats.tree, source=str(run_dir), paths=paths)
    return {"house_state": stats.tree, "files": stats.files, "bytes": stats.bytes_total,
            "sent": stats.bytes_sent}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--private", default=os.environ.get("KERBSIDE_PRIVATE_STORE"),
                    help="r2://kerbside-private, or a folder")
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    ap.add_argument("--cells", default="", help="comma-separated, or 'all' for every folder present")
    ap.add_argument("--shared", default="", help="comma-separated names, or 'all'")
    ap.add_argument("--house-run", type=Path, help="the drive's frontage run folder")
    ap.add_argument("--with-points", action="store_true")
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
        print(json.dumps(migrate_house_state(store, args.house_run, known)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
