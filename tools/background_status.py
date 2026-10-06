#!/usr/bin/env python3
"""Where every background task stands, read from its own journal.

Each long-running job keeps a journal it appends to as it goes (a log, a JSONL journal, a
status file). This reads them all and prints one line per task -- state, progress, the last
thing it wrote -- and writes the same to build/background-status.json. It runs nothing.

    python tools/background_status.py
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"


def last_line(path: Path) -> str:
    if not path.exists():
        return ""
    with path.open("rb") as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - 4096))
        lines = stream.read().decode("utf-8", "replace").strip().splitlines()
    return lines[-1][:160] if lines else ""


def running(pattern: str) -> bool:
    out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return bool(out.stdout.strip())


def facades() -> dict:
    chunks = json.loads((ROOT / "docs/sf-corridor-chunks.json").read_text())["chunks"]
    done = [c for c in chunks if (ROOT / f"docs/facades/{c['key']}/manifest.json").exists()]
    manifests = [ROOT / f"docs/facades/{c['key']}/manifest.json" for c in done]
    walls = sum(len(json.loads(m.read_text())["walls"]) for m in manifests)
    state = "running" if running("run_facades_background.sh") else (
        "complete" if len(done) == len(chunks) else "idle")
    return {"task": "photographed facades", "state": state,
            "progress": f"{len(done)}/{len(chunks)} chunks, {walls} walls textured",
            "journal": "build/facades-background.log",
            "last": last_line(BUILD / "facades-background.log")}


def photo_objects() -> list[dict]:
    out = []
    for summary in sorted((ROOT / "data/regions").glob("*/world/photo_objects.summary.json")):
        data = json.loads(summary.read_text())
        region = summary.parts[-3]
        complete = data["journaled_buildings"] >= data["surveyed_buildings"]
        out.append({"task": f"photo objects: {region}",
                    "state": "running" if running(f"build_photo_world_objects.py --region {region}")
                    else ("complete" if complete else "partial"),
                    "progress": f"{data['journaled_buildings']}/{data['surveyed_buildings']} "
                                f"buildings journaled, {data['accepted_buildings']} accepted",
                    "journal": data["journal"], "last": ""})
    return out


def furniture() -> dict:
    log = BUILD / "furniture-refresh.log"
    text = log.read_text() if log.exists() else ""
    # Regions finished, each counted once however many passes it took.
    finished = re.finditer(r"Z (\S+)(?: \(second pass\))? (?:done|FAILED)\n", text)
    done = len({m.group(1) for m in finished})
    state = ("running" if running("furniture-refresh.sh|build_street_furniture.py")
             else "complete" if "furniture refresh finished" in text else "not started")
    return {"task": "street furniture & electrical refresh", "state": state,
            "progress": f"{done}/8 regions", "journal": "build/furniture-refresh.log",
            "last": last_line(log)}


def facades_regions() -> dict:
    status = BUILD / "facades-regions.status.json"
    data = json.loads(status.read_text()) if status.exists() else {}
    rows = data.get("regions", {})
    done = sum(r["chunks_done"] for r in rows.values())
    total = sum(r["chunks_total"] for r in rows.values())
    walls = sum(r["walls"] for r in rows.values())
    state = "running" if running("run_facades_regions_background.sh") else data.get("state", "not started")
    return {"task": "photographed facades: other regions", "state": state,
            "progress": f"{done}/{total} chunks done, {walls} walls textured"
                        + (f"; now {data['current']}" if data.get("current") else ""),
            "journal": "build/facades-regions.log", "last": last_line(BUILD / "facades-regions.log")}


def photo_materials() -> dict:
    out = ROOT / "data/sf_public_works/facade_photo_materials.json"
    data = json.loads(out.read_text()) if out.exists() else {}
    buildings = data.get("buildings", {})
    classed = sum(1 for b in buildings.values() if b.get("class"))
    coloured = sum(1 for b in buildings.values() if b.get("colour"))
    state = "running" if running("build_facade_photo_materials.py") else (
        "complete" if data and data.get("walls_read") == data.get("walls_total") else "partial")
    return {"task": "wall cladding & colour from photos", "state": state,
            "progress": f"{data.get('walls_read', 0)}/{data.get('walls_total', 0)} walls read; "
                        f"{classed} buildings classed, {coloured} coloured",
            "journal": "build/facade-photo-materials/sf-corridor.jsonl",
            "last": last_line(BUILD / "facade-photo-materials.log")}


def photo_mesh() -> dict:
    # The dense photogrammetric mesh needs COLMAP (src/smc/reconstruction/colmap_runner.py)
    # and the source frames; neither is on this machine.
    have_colmap = subprocess.run(["which", "colmap"], capture_output=True).returncode == 0
    return {"task": "photogrammetric mesh (COLMAP)",
            "state": "ready" if have_colmap else "blocked",
            "progress": "not started" if have_colmap else
            "COLMAP not installed; needs the source frame corpus "
            "(docs/photogrammetry-audit-2026-09.md)",
            "journal": "docs/photogrammetry-audit-2026-09.md", "last": ""}


def main() -> None:
    rows = [facades(), facades_regions(), photo_materials(), *photo_objects(), furniture(), photo_mesh()]
    report = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tasks": rows}
    BUILD.mkdir(exist_ok=True)
    (BUILD / "background-status.json").write_text(json.dumps(report, indent=2) + "\n")
    width = max(len(r["task"]) for r in rows)
    for r in rows:
        print(f"{r['task']:<{width}}  {r['state']:<9}  {r['progress']}")
        if r["last"]:
            print(f"{'':<{width}}  {'':<9}  last: {r['last']}")


if __name__ == "__main__":
    main()
