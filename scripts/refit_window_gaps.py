#!/usr/bin/env python3
"""Refit, with the current pipeline, the run's houses whose fronts have a window gap.

A house the run has decided is never refitted (match_frontage_facades.settled_houses), so the
houses fitted before the column-symmetry inference (smc.facades.coarse_openings.complete_columns)
and the other views' windows (smc.facades.multiview.unseen_windows) keep the windows they had.
This is a one-off pass over the ones where it matters: the accepted houses whose own openings
show a column gap -- three windows over two, the third column empty below -- that the new
pipeline may fill in.

It runs beside the run, not inside it: the matcher, as the run runs it, over only those houses'
photographs (staged as links), into a folder of its own, decided among the run's fits around
them (--neighbours). Then each refit is put back into the run's buckets, so the run keeps it:

  accepted again          replaces the house's record in houses/
  rejected this time      the earlier acceptance stands (recorded in the report)
  no photograph left      nothing changes (recorded)

and the accepted refits, with the run's materials, are written to ``accepted.json`` for
publishing over the run's fits (tools/tile_frontage_fits.py --overlay). Last it writes
``done.json`` and stops: the supervisor (run_frontage_workers.py) starts it only while
``build/frontage-supervisor/refit-window-gaps.request.json`` is there and ``done.json`` is not, so
once finished it is not run again. ``--request`` writes that request.

    refit_window_gaps.py --matcher-output build/facade-match \\
        --inputs build/frontage-live build/frontage-pilot-v2 \\
        --detail-model-cache build/facade-detail-model-cache --device mps
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.coarse_openings import complete_columns  # noqa: E402

STATE = "refit-window-gaps"
SUFFIXES = (".json", ".jpg", ".labels.png", ".context.jpg")
#: Fits this close to a refitted house are its neighbours (NeighbourIndex reaches about 150 m).
NEIGHBOUR_REACH_M = 250.0
#: A pass that fails this many times is given up, so the supervisor does not retry it forever.
MAX_ATTEMPTS = 5


def atomic(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, indent=1, default=str))
    os.replace(temp, path)


def records(output: Path, bucket: str):
    for path in sorted((output / bucket).glob("*/*.json")):
        try:
            record = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(record, dict) and record.get("building_id"):
            yield path.parent.name, str(record["building_id"]), record


def has_gap(fit: dict) -> bool:
    """The front's own openings leave a column empty that its other floors fill."""
    width, height = fit.get("width_m"), fit.get("height_m")
    if not (isinstance(width, (int, float)) and isinstance(height, (int, float)) and width > 0 and height > 0):
        return False
    openings = [o for o in fit.get("openings") or []
                if all(isinstance(o.get(k), (int, float)) for k in ("u", "v", "w", "h"))]
    return bool(complete_columns(openings, float(width), float(height)))


def targets(output: Path) -> list[list[str]]:
    return sorted([region, key] for region, key, record in records(output, "houses") if has_gap(record))


def stage(inputs: list[Path], houses: list[list[str]], folder: Path) -> dict:
    """Links to every review row (and its pixels) of the houses, one folder per input."""
    counts = {"rows": 0, "houses_with_rows": 0}
    seen = set()
    for index, root in enumerate(inputs):
        review = folder / str(index) / "review"
        review.mkdir(parents=True, exist_ok=True)
        for region, key in houses:
            for row in sorted((root / "review").glob(f"{region}-{key}-*.json")):
                for suffix in SUFFIXES:
                    source = row.with_suffix(suffix)
                    target = review / source.name
                    if source.is_file() and not target.exists():
                        target.symlink_to(source.resolve())
                counts["rows"] += 1
                seen.add((region, key))
    counts["houses_with_rows"] = len(seen)
    return counts


def lonlat_m(a, b) -> float:
    k = math.cos(math.radians((a[1] + b[1]) / 2)) * 111_320.0
    return math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110_540.0)


def neighbours(output: Path, houses: list[list[str]]) -> dict:
    wanted = {(region, key) for region, key in houses}
    fits = {(region, key): record for bucket in ("houses", "rejected")
            for region, key, record in records(output, bucket)}
    centres = [fits[h]["a"] for h in wanted if h in fits and fits[h].get("a")]
    grid: dict[tuple[int, int], list] = {}
    for c in centres:
        grid.setdefault((int(c[0] * 400), int(c[1] * 400)), []).append(c)
    out = {}
    for (region, key), fit in fits.items():
        a = fit.get("a")
        if (region, key) in wanted or not a:
            continue
        cell = (int(a[0] * 400), int(a[1] * 400))
        near = [c for dx in (-1, 0, 1) for dy in (-1, 0, 1) for c in grid.get((cell[0] + dx, cell[1] + dy), [])]
        if any(lonlat_m(a, c) <= NEIGHBOUR_REACH_M for c in near):
            out[key] = fit
    return {"schema": "kerbside.facade_fits/1", "buildings": out}


def reuse_detections(shared: Path, own: Path, stage_dir: Path) -> dict:
    """The run's detections of these photographs, filed where this pass will look for them.

    The matcher keys its detection cache by the detector's manifest, which names the device:
    run on the CPU beside the run's GPU workers, this pass found none of the run's GPU
    detections and ran the detector again on every photograph, a minute each. A detection is the
    model's answer for the photograph whichever chip worked it out, so each one the run has is
    copied here under the CPU's key -- its own record still says the device it ran on. The run's
    cache is not touched.
    """
    own.mkdir(parents=True, exist_ok=True)
    by_digest: dict[str, list[Path]] = {}
    for path in shared.glob("*.json"):
        digest, _, _ = path.stem.rpartition("-")
        by_digest.setdefault(digest, []).append(path)
    counts = {"photographs": 0, "reused": 0, "already_here": 0, "none": 0}
    for photo in sorted(stage_dir.glob("*/review/*.jpg")):
        if photo.name.endswith(".context.jpg"):
            continue
        counts["photographs"] += 1
        digest = hashlib.sha256(photo.read_bytes()).hexdigest()
        found = by_digest.get(digest) or []
        reused = False
        for path in found:
            try:
                detection = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            manifest = detection.get("model")
            if not isinstance(manifest, dict):
                continue
            cpu_version = hashlib.sha256(json.dumps({**manifest, "device": "cpu"}, sort_keys=True).encode()).hexdigest()[:16]
            target = own / f"{digest}-{cpu_version}.json"
            if target.exists():
                counts["already_here"] += 1
            else:
                target.write_text(path.read_text())
                counts["reused"] += 1
            reused = True
            break
        counts["none"] += not reused
    return counts


def merge(output: Path, refit: Path, houses: list[list[str]]) -> dict:
    """Each refit put back into the run's buckets (accepted only; an earlier acceptance stands)."""
    report = {"replaced": [], "kept_earlier_acceptance": [], "not_refitted": []}
    accepted = {}
    for region, key in houses:
        fresh = refit / "houses" / region / f"{key}.json"
        if fresh.is_file():
            record = json.loads(fresh.read_text())
            atomic(output / "houses" / region / f"{key}.json", record)
            stale = output / "rejected" / region / f"{key}.json"
            if stale.exists():
                stale.unlink()
            accepted[key] = record
            report["replaced"].append(f"{region}:{key}")
        elif (refit / "rejected" / region / f"{key}.json").is_file():
            report["kept_earlier_acceptance"].append(f"{region}:{key}")
        else:
            report["not_refitted"].append(f"{region}:{key}")
    return {"report": report, "accepted": accepted}


def windows(fit: dict) -> int:
    return sum((o.get("role") or o.get("kind")) == "window" for o in fit.get("openings") or [])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--matcher-output", type=Path, required=True)
    ap.add_argument("--inputs", type=Path, nargs="+", required=True)
    ap.add_argument("--detail-model-cache", type=Path)
    ap.add_argument("--device", default="cpu", help="accepted for the supervisor; the pass runs on the CPU")
    ap.add_argument("--request", action="store_true", help="ask the supervisor for the pass, and stop")
    args = ap.parse_args()
    output = args.matcher_output.resolve()
    state = output / STATE
    if args.request:
        request = ROOT / "build/frontage-supervisor/refit-window-gaps.request.json"
        atomic(request, {"requested_at": time.time(), "by": "refit_window_gaps.py --request"})
        print(f"requested: {request}")
        return 0
    if (state / "done.json").is_file():
        print(f"finished: {state / 'done.json'}")
        return 0
    attempts = json.loads((state / "attempts.json").read_text()) if (state / "attempts.json").is_file() else []
    if len(attempts) >= MAX_ATTEMPTS:
        atomic(state / "done.json", {"status": "gave_up", "attempts": attempts, "finished_at": time.time()})
        return 1
    started = time.time()
    if not (state / "targets.json").is_file():
        atomic(state / "targets.json", {"houses": targets(output), "chosen_at": started,
                                        "rule": "accepted house whose openings complete_columns would add to"})
    houses = json.loads((state / "targets.json").read_text())["houses"]
    print(f"{len(houses)} houses with a window gap", flush=True)
    staged = stage([p.resolve() for p in args.inputs], houses, state / "stage")
    atomic(state / "neighbours.json", neighbours(output, houses))
    refit = state / "match"
    refit.mkdir(parents=True, exist_ok=True)
    detections = refit / "detections"
    if detections.is_symlink():
        detections.unlink()
    if (output / "detections").is_dir():
        atomic(state / "detections-reused.json",
               reuse_detections(output / "detections", detections, state / "stage"))
    command = [sys.executable, str(ROOT / "scripts/match_frontage_facades.py"),
               "--inputs", *[str(state / "stage" / str(i)) for i in range(len(args.inputs))],
               "--output", str(refit), "--publish-to", str(refit / "published.json"),
               # On the CPU: beside the run's own GPU workers (filter, matcher) this pass's detector
               # waited on the GPU for a quarter of an hour without a fit. Its houses' detections
               # are mostly cached already, so the CPU costs it little.
               "--neighbours", str(state / "neighbours.json"), "--device", "cpu",
               "--auto-accept", "--refit-all"]
    if args.detail_model_cache:
        command += ["--detail-model-cache", str(args.detail_model_cache)]
    run = subprocess.run(command, cwd=ROOT, env={**os.environ, "PYTHONPATH": str(ROOT / "src")})
    if run.returncode != 0:
        atomic(state / "attempts.json", [*attempts, {"at": started, "returncode": run.returncode}])
        return run.returncode
    before = {key: record for _, key, record in records(output, "houses")}
    merged = merge(output, refit, houses)
    sys.path.insert(0, str(ROOT / "scripts"))
    from match_frontage_facades import with_materials
    accepted = with_materials(output, merged["accepted"])
    atomic(state / "accepted.json", {"schema": "kerbside.facade_fits/1", "buildings": accepted,
                                     "note": "Refitted with column symmetry and other views' windows; "
                                             "published over the run's fits."})
    gained = {key: windows(fit) - windows(before.get(key) or {}) for key, fit in accepted.items()}
    summary = {"status": "finished", "houses": len(houses), "staged": staged,
               "replaced": len(merged["report"]["replaced"]),
               "kept_earlier_acceptance": len(merged["report"]["kept_earlier_acceptance"]),
               "not_refitted": len(merged["report"]["not_refitted"]),
               "windows_gained": sum(v for v in gained.values() if v > 0),
               "houses_gaining_windows": sum(v > 0 for v in gained.values()),
               "seconds": round(time.time() - started), "finished_at": time.time()}
    atomic(state / "report.json", {**summary, **merged["report"], "windows_gained_by_house": gained})
    atomic(state / "done.json", summary)
    print(json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
