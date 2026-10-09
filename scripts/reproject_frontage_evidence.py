#!/usr/bin/env python3
"""Rebuild named private review crops from retained exact source pixels with terrain priors."""

import argparse
import dataclasses
import hashlib
import json
import struct
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.frontage_pixels import FrontagePixelScreen  # noqa: E402
from smc.facades.geometry import Camera, LocalFrame, Wall  # noqa: E402
from smc.facades.grounding import TerrainReference, street_readable_wall  # noqa: E402
from smc.facades.rectify import rectify_wall  # noqa: E402
from smc.reconstruction.pixel_store import MAGIC, LocalBlobStore  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model-cache", type=Path, required=True)
    args = parser.parse_args()
    screen = FrontagePixelScreen(args.model_cache)
    for path in args.reports:
        row = json.loads(path.read_text())
        if row["status"] == "pixel_rejected":
            raise ValueError("cannot recover pixels rejected by policy")
        raw = LocalBlobStore(path.parent.parent / "pixel-store").get(row["pixel_sha256"])
        if not raw.startswith(MAGIC):
            raise ValueError("invalid canonical pixel blob")
        n = struct.unpack(">I", raw[len(MAGIC) : len(MAGIC) + 4])[0]
        start = len(MAGIC) + 4
        header = json.loads(raw[start : start + n])
        if header["channels"] != 3 or header["bits_per_channel"] != 8:
            raise ValueError("RGB8 evidence required")
        image = np.frombuffer(raw[start + n :], np.uint8).reshape(
            header["height"], header["width"], 3
        )[..., ::-1]
        region = row["region"]
        model = ROOT / (
            "docs/sf-corridor-3d.json"
            if region == "sf-corridor"
            else f"docs/app-regions/{region}/sf-corridor-3d.json"
        )
        bbox = json.loads(model.read_text())["bbox"]
        local = LocalFrame((bbox["north"] + bbox["south"]) / 2, (bbox["east"] + bbox["west"]) / 2)
        terrain_path = model.parent / "sf-corridor-terrain.json"
        terrain = TerrainReference(terrain_path)
        wall = street_readable_wall(Wall(**row["candidate"]["wall"]))
        camera = Camera(**row["candidate"]["camera"])
        camera = dataclasses.replace(
            camera,
            width=header["width"],
            height=header["height"],
            focal_px=camera.focal_px * header["width"] / camera.width if camera.focal_px else None,
        )
        camera, grounding = terrain.ground_camera(camera, wall, local)
        ppm = min(35, row["candidate"]["pixels_per_m"], 1400 / max(wall.length_m, wall.height_m))
        view = rectify_wall(image, camera, wall, pixels_per_m=ppm, exact=True)
        if view is None:
            raise ValueError("corrected wall not visible")
        folder = args.output / "review"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / path.name
        cv2.imwrite(str(target.with_suffix(".jpg")), view.image)
        pixel = screen.screen(view.image, view.mask)
        cv2.imwrite(str(target.with_suffix(".labels.png")), pixel.pop("labels").astype(np.uint8))
        row["candidate"]["wall"] = dataclasses.asdict(wall)
        row["candidate"]["camera"] = dataclasses.asdict(camera)
        row["ground_reference"] = grounding
        row["ground_reference"]["terrain_sha256"] = hashlib.sha256(
            terrain_path.read_bytes() + terrain_path.with_suffix(".bin").read_bytes()
        ).hexdigest()
        row["reprojection_basis"] = (
            "readable_street_orientation_and_shared_terrain_delta; not surveyed camera height"
        )
        row["pixel_screen"] = pixel
        row["status"] = (
            "screened_candidate_needs_privacy_and_identity_review"
            if pixel["pass"]
            else "pixel_rejected"
        )
        target.write_text(json.dumps(row, indent=2, default=str))
        print(
            json.dumps({"image": path.name, "grounding": grounding, "status": row["status"]}),
            flush=True,
        )
