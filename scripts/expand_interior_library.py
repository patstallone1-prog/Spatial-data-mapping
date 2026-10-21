#!/usr/bin/env python3
"""Expand, verify and measure the existing Kerbside household asset library.

Resumable: existing assets are retained; successful additions are checkpointed atomically.
Downloads are taken from Poly Haven's official file API with upstream checksum verification.
The existing Google Scanned Objects attribution and source hashes remain intact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from build_interior_assets import fetch, poly_haven  # noqa: E402

from smc.interiors.inference.catalog import asset_style  # noqa: E402

ADDITIONS = {
    "vintage_day_bed": "bed",
    "chinese_sofa": "sofa",
    "painted_wooden_sofa": "sofa",
    "chinese_armchair": "armchair",
    "GreenChair_01": "armchair",
    "Rockingchair_01": "armchair",
    "WoodenChair_01": "dining_chair",
    "dining_chair_02": "dining_chair",
    "gallinera_chair": "dining_chair",
    "bar_chair_round_01": "bar_stool",
    "gallinera_table": "dining_table",
    "round_wooden_table_02": "dining_table",
    "WoodenTable_01": "dining_table",
    "WoodenTable_02": "dining_table",
    "painted_wooden_table": "dining_table",
    "wooden_table_02": "desk",
    "chinese_console_table": "desk",
    "gothic_coffee_table": "coffee_table",
    "industrial_coffee_table": "coffee_table",
    "modern_coffee_table_02": "coffee_table",
    "chinese_tea_table": "coffee_table",
    "side_table_tall_01": "nightstand",
    "drawer_cabinet": "dresser",
    "modern_wooden_cabinet": "dresser",
    "painted_wooden_cabinet_02": "dresser",
    "vintage_cabinet_01": "dresser",
    "chinese_cabinet": "bookshelf",
    "GothicCabinet_01": "bookshelf",
    "desk_lamp_arm_01": "table_lamp",
    "industrial_pipe_lamp": "table_lamp",
    "vintage_oil_lamp": "table_lamp",
    "hanging_industrial_lamp": "ceiling_lamp",
    "throw_pillows_01": "cushion",
}
KHRONOS_COMMIT = "15cd02d304e54cb42a4db4eefe719f76190f4b68"


def khronos(name: str, role: str, directory: Path) -> dict:
    base = (
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/"
        f"{KHRONOS_COMMIT}/Models/{name}"
    )
    metadata = json.loads(fetch(base + "/metadata.json"))
    if any(row["license"] not in {"CC0-1.0", "CC-BY-4.0"} for row in metadata["legal"]):
        raise ValueError(f"{name}: unreviewed asset licence")
    folder = directory / "khronos" / name
    folder.mkdir(parents=True, exist_ok=True)
    files = []
    for relative, remote in (
        (f"{name}.glb", f"glTF-Binary/{name}.glb"),
        ("metadata.json", "metadata.json"),
    ):
        target = folder / relative
        payload = target.read_bytes() if target.exists() else fetch(base + "/" + remote)
        target.write_bytes(payload)
        files.append(
            {
                "path": str(target.relative_to(directory)),
                "url": base + "/" + remote,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        )
    return {
        "id": "khronos_" + name,
        "role": role,
        "model": f"khronos/{name}/{name}.glb",
        "license": "CC-BY-4.0"
        if any(r["license"] == "CC-BY-4.0" for r in metadata["legal"])
        else "CC0-1.0",
        "source": f"https://github.com/KhronosGroup/glTF-Sample-Assets/tree/{KHRONOS_COMMIT}/Models/{name}",
        "attribution": "; ".join(
            f"{r['artist']}, {r['owner']} ({r['license']})" for r in metadata["legal"]
        ),
        "files": files,
        "source_commit": KHRONOS_COMMIT,
    }


def write_manifest(path: Path, data: dict) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n")
    temporary.replace(path)


def enrich(row: dict, directory: Path) -> None:
    import numpy as np
    import trimesh

    scene = trimesh.load(directory / row["model"], force="scene", process=False)
    bounds = np.asarray(scene.bounds)
    row["bounds_m"] = bounds.round(6).tolist()
    row["dimensions_m"] = (bounds[1] - bounds[0]).round(6).tolist()  # X,Y-up,Z
    row["mesh_faces"] = sum(len(m.faces) for m in scene.geometry.values())
    row["style"] = asset_style(row["id"])
    row["tier"] = (
        "economy"
        if any(w in row["id"].lower() for w in ("worn", "old_", "painted_"))
        else "premium"
        if any(
            w in row["id"].lower() for w in ("gothic", "classic", "chinese", "modern_", "sofa_02")
        )
        else "standard"
    )
    row["scale_units"] = "metres"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=len(ADDITIONS))
    parser.add_argument("--measure-only", action="store_true")
    args = parser.parse_args()
    directory = ROOT / "docs/interior-assets"
    path = directory / "manifest.json"
    data = json.loads(path.read_text())
    existing = {r["id"] for r in data["assets"]}
    failures = []
    if not args.measure_only:
        for asset_id, role in list(ADDITIONS.items())[: args.limit]:
            if asset_id in existing:
                continue
            try:
                row = poly_haven(asset_id, role)
                enrich(row, directory)
                data["assets"].append(row)
                write_manifest(path, data)
                print(f"added {asset_id} ({role})", flush=True)
            except Exception as exc:
                failures.append({"id": asset_id, "reason": str(exc)})
                print(f"failed {asset_id}: {exc}", flush=True)
        for name, role in (("SheenChair", "armchair"), ("SheenWoodLeatherSofa", "sofa")):
            if "khronos_" + name in existing:
                continue
            row = khronos(name, role, directory)
            enrich(row, directory)
            row["tier"] = "premium"
            data["assets"].append(row)
            write_manifest(path, data)
            print(f"added Khronos {name}", flush=True)
    for row in data["assets"]:
        row["style"] = asset_style(row["id"])
        if row["id"] in ADDITIONS:
            row["role"] = ADDITIONS[row["id"]]
        if "dimensions_m" not in row:
            try:
                enrich(row, directory)
            except Exception as exc:
                failures.append({"id": row["id"], "reason": f"measurement: {exc}"})
    data["schema"] = "kerbside.interior_assets/3"
    data["expansion"] = {
        "source": "https://api.polyhaven.com/",
        "failures": failures,
        "dimensions_order": "X width, Y height, Z depth in metres",
        "tier_note": "illustrative selection allowance; not observed product prices",
    }
    write_manifest(path, data)
    print(f"{len(data['assets'])} local assets; {len(failures)} failures", flush=True)


if __name__ == "__main__":
    main()
