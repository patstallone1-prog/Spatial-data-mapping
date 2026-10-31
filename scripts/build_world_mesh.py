#!/usr/bin/env python3
"""Build the measured world mesh for one block: photographs to a streamed tile pyramid.

Any rectangle works -- a house's frontage, a street, a cloud cell (``--region``) -- and a cell
can be cut into blocks built separately (``--split 200``): blocks own the triangles whose
centroids fall inside them, so their tiles meet without overlapping.

    .venv/bin/python scripts/build_world_mesh.py --bbox -122.4372,37.8000,-122.4360,37.8008 --name marina-test
    .venv/bin/python scripts/build_world_mesh.py --region c14r03 --stages photos,solve,tiles,check

Stages (each resumes from what is already in the work folder, build/worldmesh/<name>/):
    photos   find the frames in the block's halo, thin near-repeats, fetch originals
    solve    COLMAP: features, matches, sparse model, alignment; dense and mesh with CUDA
    tiles    the master mesh as a lossless-at-the-leaves 3D Tiles pyramid (tiles/)
    check    the mesh against the block's USGS 3DEP lidar (or --lidar): passed or held

Needs MAPILLARY_TOKEN in the environment for ``photos``.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.worldmesh import check, photos, reconstruct  # noqa: E402
from smc.worldmesh.block import Block, block_for_region, parse_bbox, tiles_of  # noqa: E402
from smc.worldmesh.ground import GEOID_BAY_M, fetch_ground  # noqa: E402
from smc.worldmesh.lidar import points_for as lidar_for  # noqa: E402
from smc.worldmesh.tiles import tile_mesh  # noqa: E402

STAGES = ("photos", "solve", "tiles", "check")


def build(block: Block, work: Path, stages: list[str], *, lidar: Path | None, max_frames: int | None) -> dict:
    work.mkdir(parents=True, exist_ok=True)
    state_path = work / "block.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    ground = None
    if "photos" in stages or "solve" in stages:
        ground = fetch_ground(block)
        centre = block.frame
        block = replace(block, height_m=ground.at(centre.lon, centre.lat) + GEOID_BAY_M)
    elif "block" in state:
        block = replace(block, height_m=state["block"]["height_m"])
    state["block"] = block.to_json()

    if "photos" in stages:
        found = photos.find_frames(block)
        kept = photos.thin(found)
        if max_frames:
            centre = block.frame
            kept.sort(key=lambda f: (f.lon - centre.lon) ** 2 + (f.lat - centre.lat) ** 2)
            kept = kept[:max_frames]
        fetched = photos.fetch(kept, work)
        photos.write_manifest(fetched, block, work)
        state["photos"] = {"found": len(found), "kept": len(kept), "fetched": len(fetched),
                           "sequences": len({f.sequence for f in fetched}),
                           "bytes": sum(f.bytes or 0 for f in fetched)}
        print("photos:", json.dumps(state["photos"]), flush=True)
    if "solve" in stages:
        frames = photos.read_manifest(work)
        state["solve"] = reconstruct.solve(work, block, frames, ground=ground)
        reconstruct.write_report(work, state["solve"])
        print("solve:", json.dumps(state["solve"]), flush=True)
    mesh = None
    if ("tiles" in stages or "check" in stages) and (work / "mesh.ply").exists():
        mesh = reconstruct.load_mesh(work / "mesh.ply", block)
    if "tiles" in stages:
        if mesh is None:
            state["tiles"] = {"skipped": "no master mesh yet (dense stereo needs CUDA)"}
        else:
            frames = photos.read_manifest(work)
            provenance = {"source": "street photographs", "licence": "CC-BY-SA-4.0",
                          "attribution": "© Mapillary contributors, CC BY-SA 4.0",
                          "frames": len(frames), "creators": sorted({f.creator for f in frames if f.creator}),
                          "solver": "COLMAP", "coverage": "DIRECT_OBSERVATION"}
            summary = tile_mesh(mesh, work / "tiles", block.frame, block=block.name, provenance=provenance)
            state["tiles"] = {k: summary[k] for k in ("tiles", "levels", "leaf_triangles", "bytes", "max_rounding_m")}
        print("tiles:", json.dumps(state["tiles"]), flush=True)
    if "check" in stages:
        if mesh is None:
            state["check"] = {"passed": False, "reasons": ["no master mesh"]}
        else:
            if lidar:
                points, source = load_lidar(lidar, block), str(lidar)
            else:
                points, source = lidar_for(block, ROOT)
            share = (state.get("solve") or {}).get("registered_share")
            state["check"] = {**check.judge(mesh, registered_share=share, lidar=points).to_json(),
                              "lidar": source}
        print("check:", json.dumps(state["check"]), flush=True)
    state_path.write_text(json.dumps(state, indent=1))
    return state


def load_lidar(path: Path, block: Block):
    """Hard-surface returns (ground 2, building 6) from a LAS/LAZ in lon/lat or the frame."""
    import laspy
    import numpy as np

    las = laspy.read(path)
    keep = np.isin(np.asarray(las.classification), (2, 6))
    xyz = np.stack([las.x, las.y, las.z], axis=1)[keep]
    frame = block.frame
    if np.abs(xyz[:, 0]).max() <= 180:  # geographic: into the block's frame
        return np.array([frame.to_enu(lon, lat, h) for lon, lat, h in xyz])
    return xyz


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--bbox", help="west,south,east,north")
    where.add_argument("--region", help="a region or cloud cell in docs/app-regions.json")
    parser.add_argument("--name")
    parser.add_argument("--split", type=float, help="cut into blocks of about this many metres")
    parser.add_argument("--stages", default=",".join(STAGES))
    parser.add_argument("--work", type=Path, default=ROOT / "build/worldmesh")
    parser.add_argument("--lidar", type=Path)
    parser.add_argument("--max-frames", type=int, help="the frames nearest the centre only (trials)")
    args = parser.parse_args()
    if args.bbox:
        block = Block(args.name or "block", *parse_bbox(args.bbox))
    else:
        block = block_for_region(args.region, ROOT)
    stages = [s for s in args.stages.split(",") if s]
    if unknown := set(stages) - set(STAGES):
        parser.error(f"unknown stages: {sorted(unknown)}")
    for part in tiles_of(block, args.split) if args.split else [block]:
        build(part, args.work / part.name, stages, lidar=args.lidar, max_frames=args.max_frames)


if __name__ == "__main__":
    main()
