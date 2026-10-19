"""What is on the Mac and its drive, by what must happen to it before the Mac can be switched off.

Every path is put in one class:

* ``git``             -- tracked; the container image is built from the repository and has it.
* ``upload_once``     -- Kerbside's own work that no provider can give back: cell folders after
                         their stages, the house pipeline's journals and fits, model weights.
                         ``smc-cloud migrate`` puts them in the private bucket once.
* ``reacquirable``    -- public data a stage fetches again when it needs it (USGS lidar tiles,
                         Natural Earth): never uploaded.
* ``cache``           -- a stage's own cache of the above: never uploaded, safe to rebuild.
* ``restricted``      -- licence-limited (Google Street View references: the terms forbid copying
                         them to other storage; Waymo/PandaSet: non-commercial research only).
                         Never uploaded by default; stays archived on the drive.
* ``local_only``      -- macOS or Unreal work (the editor's derived data, engine installs) and
                         one-off research outputs: archived where they are; nothing in the cloud
                         reads them.
* ``review``          -- not classified by any rule: a person decides.

Rules are matched in order on the path relative to its root (the repository or the drive).
"""

from __future__ import annotations

import fnmatch
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

RULES: list[tuple[str, str, str]] = [
    # pattern, class, why
    ("*/private-datasets/3d-street-view*", "restricted", "Google Street View: no copies to other storage"),
    ("*streetview-reference*", "restricted", "Google Street View: no copies to other storage"),
    ("*waymo*", "restricted", "Waymo Open Dataset: non-commercial licence"),
    ("*pandaset*", "restricted", "PandaSet benchmark (CC BY 4.0 but private research inputs)"),
    ("data/sf_corridor_pandaset*", "restricted", "PandaSet benchmark inputs"),
    ("build/photo-lidar-real-v1*", "restricted", "real photo/lidar benchmark pixels (private by audit)"),
    ("*lidar-cache*", "cache", "USGS 3DEP EPT tiles, fetched again by the stage"),
    ("*points-cache*", "cache", "USGS 3DEP EPT tiles for point cells"),
    ("*/model-cache/hub*", "upload_once", "model weights (public on Hugging Face; uploaded to avoid rate limits)"),
    ("build/facade-cache*", "cache", "facade photo cache, refetched from providers"),
    ("*electrical-imagery-cache*", "cache", "imagery cache, refetched"),
    ("*natural-earth*", "reacquirable", "Natural Earth, public domain"),
    ("data/regions/*/points*", "reacquirable", "point cells: rebuilt from USGS by build_point_cells.py"),
    ("data/regions/*", "upload_once", "a cell's folder after its stages"),
    ("connector-intake-*", "upload_once", "the gap cells' folders (linked as data/regions/<cell>)"),
    ("frontage-run-*", "upload_once", "the house pipeline's journals, buckets and fits"),
    ("build/frontage-*", "upload_once", "the house pipeline's journals and inputs"),
    ("build/facade-match*", "upload_once", "the matcher's buckets and fits"),
    ("build/facade-detail-model-cache*", "upload_once", "detail detector weights"),
    ("build/regions/entwine-index.geojson", "upload_once", "lidar coverage index"),
    ("build/sf_public_works*", "upload_once", "city records cache read by build"),
    ("build/sfmta*", "upload_once", "city records cache read by build"),
    ("build/street_furniture*", "upload_once", "street furniture inputs read by build"),
    ("data/sf_corridor/stats*", "upload_once", "corridor statistics read by build"),
    ("data/sf_corridor/depth*", "upload_once", "corridor lidar sections read by build"),
    ("data/interiors*", "upload_once", "interior scans (licensed inputs, private)"),
    ("data/transit*", "reacquirable", "transit feeds, refetched by ingest_transit.py"),
    ("*unreal*", "local_only", "Unreal editor data: macOS/Windows only"),
    ("*UE_5*", "local_only", "Unreal Engine install"),
    ("build/unreal*", "local_only", "Unreal builds"),
    ("*sky-build-*", "local_only", "shared sky build folder (kept, never deleted)"),
    ("*old-session-scratch*", "local_only", "old scratch, archived"),
    ("*curbphoto*", "local_only", "prototype photo kerb outputs (not canonical)"),
    ("build/photo-mesh*", "local_only", "photo mesh pilot outputs"),
    ("*plant-assets*", "local_only", "plant asset sources; the published scans are in git"),
    ("data/sf_corridor_mapillary_dense*", "upload_once", "Mapillary imagery (CC BY-SA; private bucket, attribution kept)"),
    ("data/captures*", "upload_once", "contributor captures (private imagery: private bucket only)"),
    ("data/electrical*", "upload_once", "electrical inputs read by build"),
    ("data/observation_enrichment*", "upload_once", "observation enrichment read by build"),
    ("data/sf_corridor*", "upload_once", "corridor inputs read by build"),
    ("data/sf_rpd*", "upload_once", "SF Rec and Park inputs read by build"),
    ("data/park_paths*", "upload_once", "park path inputs read by build"),
    ("data/curbmeasure*", "local_only", "kerb measurement prototype work (not canonical)"),
    ("build/*", "cache", "build outputs a stage rewrites"),
]


def classify(rel: str) -> tuple[str, str]:
    for pattern, cls, why in RULES:
        if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(rel + "/", pattern + "/"):
            return cls, why
    return "review", "no rule"


def du(path: Path, skip: set[str] | None = None, root: Path | None = None) -> tuple[int, int]:
    """Bytes and files under ``path`` (following the cell links), without loading anything;
    files in ``skip`` (repository-relative, the tracked ones) are not counted."""
    total = files = 0
    stack = [path]
    seen: set[tuple[int, int]] = set()
    while stack:
        p = stack.pop()
        try:
            st = p.stat()
        except OSError:
            continue
        key = (st.st_dev, st.st_ino)
        if key in seen:
            continue
        seen.add(key)
        if p.is_dir():
            try:
                stack.extend(p.iterdir())
            except OSError:
                continue
        elif not (skip and root and p.relative_to(root).as_posix() in skip):
            total += st.st_size
            files += 1
    return total, files


def tracked(root: Path) -> set[str]:
    try:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return set()
    return {p for p in out.stdout.decode().split("\0") if p}


def entries(root: Path, split: set[str], base: Path | None = None) -> list[tuple[str, Path]]:
    """The paths to measure: each top folder, split further where it is a mix (``split``)."""
    base = base or root
    out = []
    for child in sorted(base.iterdir()):
        rel = child.relative_to(root).as_posix()
        if child.name.startswith(".") and base == root:
            continue
        if rel in split and child.is_dir():
            out.extend(entries(root, split, child))
        else:
            out.append((rel, child))
    return out


def inventory(repo: Path, volumes: list[Path]) -> dict:
    repo = Path(repo)
    git = tracked(repo)
    # A tracked link counts as the link, not what it points at (a cell's folder on the drive).
    git_bytes = sum((repo / p).lstat().st_size for p in git if (repo / p).exists() or (repo / p).is_symlink())
    rows = []
    drives = [(Path(v) / "Kerbside").resolve() for v in volumes]
    for rel, path in entries(repo, {"build", "data", "data/regions"}):
        if path.is_symlink() and any(path.resolve().is_relative_to(d) for d in drives):
            continue  # a link to the drive: counted there
        if rel in ("src", "tests", "scripts", "tools", "docs", "supabase", "clients", "contrib",
                   "benchmarks", "config", "photos", ".claude", "graphify-out", "unreal") or (
                path.is_file() and rel in git):
            continue
        size, n = du(path, git, repo)  # untracked bytes only: tracked ones are the image's
        if not size:
            continue
        cls, why = classify(rel)
        rows.append({"root": "repo", "path": rel, "bytes": size, "files": n, "class": cls, "why": why})
    for volume in volumes:
        base = Path(volume) / "Kerbside"
        if not base.is_dir():
            continue
        for rel, path in entries(base, set()):
            size, n = du(path)
            cls, why = classify(rel)
            rows.append({"root": str(base), "path": rel, "bytes": size, "files": n,
                         "class": cls, "why": why})
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        totals[row["class"]] += row["bytes"]
    totals["git"] += git_bytes
    return {"schema": "kerbside.inventory/1", "git_tracked_bytes": git_bytes, "git_files": len(git),
            "totals": dict(totals), "rows": sorted(rows, key=lambda r: -r["bytes"])}


def markdown(inv: dict) -> str:
    gb = lambda b: f"{b / 1e9:,.2f} GB"  # noqa: E731
    lines = ["| class | size |", "|---|---:|"]
    for cls, size in sorted(inv["totals"].items(), key=lambda kv: -kv[1]):
        lines.append(f"| {cls} | {gb(size)} |")
    lines += ["", "| where | path | size | files | class | why |", "|---|---|---:|---:|---|---|"]
    for r in inv["rows"]:
        if r["bytes"] < 5e6:
            continue
        where = "repo" if r["root"] == "repo" else "drive"
        lines.append(f"| {where} | `{r['path']}` | {gb(r['bytes'])} | {r['files']:,} | {r['class']} | {r['why']} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="classify local data for the move to the cloud")
    ap.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[3])
    ap.add_argument("--volume", type=Path, action="append", default=[])
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    inv = inventory(args.repo, args.volume)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(inv, indent=1) + "\n")
        args.out.with_suffix(".md").write_text(markdown(inv))
    print(markdown(inv))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
