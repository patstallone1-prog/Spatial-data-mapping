"""Optional pinned ALIKED/LightGlue backend; no fallback mislabelled as learned."""

from __future__ import annotations

import hashlib
import json
import tempfile
import urllib.request
from importlib.metadata import distribution
from pathlib import Path

import cv2
import numpy as np

from smc.reconstruction.matching import Frame, candidate_pairs, cycle_tracks, overlap_groups

LIGHTGLUE_COMMIT = "eb42fee2d71449efb0aa5c10549752b5d75384d8"


class LearnedMatcher:
    def __init__(self, model_dir: Path):
        import torch
        from lightglue import ALIKED, LightGlue

        record = json.loads(distribution("lightglue").read_text("direct_url.json") or "{}")
        if record.get("vcs_info", {}).get("commit_id") != LIGHTGLUE_COMMIT:
            raise ValueError("LightGlue installation does not match the reviewed source commit")
        registry = json.loads(
            (
                Path(__file__).resolve().parents[3] / "data/reconstruction/matching_models.json"
            ).read_text()
        )
        checkpoints = model_dir / "checkpoints"
        checkpoints.mkdir(parents=True, exist_ok=True)
        for model in registry["models"]:
            path = checkpoints / model["file"]
            if not path.exists():
                with urllib.request.urlopen(model["url"], timeout=60) as response:
                    payload = response.read(64 * 1024**2 + 1)
                if (
                    len(payload) > 64 * 1024**2
                    or hashlib.sha256(payload).hexdigest() != model["sha256"]
                ):
                    raise ValueError("model download failed reviewed checksum/size gate")
                with tempfile.NamedTemporaryFile(dir=checkpoints, delete=True) as stream:
                    stream.write(payload)
                    stream.flush()
                    path.write_bytes(Path(stream.name).read_bytes())
            if hashlib.sha256(path.read_bytes()).hexdigest() != model["sha256"]:
                raise ValueError("model checkpoint differs from reviewed bytes; do not load it")
        self.registry = registry
        torch.set_num_threads(4)
        torch.hub.set_dir(str(model_dir))
        self.torch = torch
        self.extractor = ALIKED(max_num_keypoints=4096).eval()
        self.matcher = LightGlue(features="aliked", depth_confidence=-1, width_confidence=-1).eval()

    def match(
        self,
        frames: list[Frame],
        images: list[np.ndarray],
        masks: list[np.ndarray],
        max_tracks: int = 64,
    ):
        torch = self.torch
        features, points = [], []
        with torch.inference_mode():
            for image, mask in zip(images, masks, strict=True):
                rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                tensor = torch.from_numpy(rgb.copy()).permute(2, 0, 1).float() / 255
                result = self.extractor.extract(tensor, resize=None)
                pixels = result["keypoints"][0].cpu().numpy()
                x, y = np.round(pixels).astype(int).T
                x = np.clip(x, 0, mask.shape[1] - 1)
                y = np.clip(y, 0, mask.shape[0] - 1)
                clearance = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 3)
                keep = torch.from_numpy(clearance[y, x] > 16)
                for key in ("keypoints", "descriptors", "keypoint_scores"):
                    if key in result:
                        result[key] = result[key][:, keep]
                features.append(result)
                points.append(result["keypoints"][0].cpu().numpy())
            edges, verified = [], []
            pairs = candidate_pairs(frames)
            for a, b in pairs:
                if min(len(points[a]), len(points[b])) < 12:
                    continue
                result = self.matcher({"image0": features[a], "image1": features[b]})
                matches = result["matches"][0].cpu().numpy()
                if len(matches) < 12:
                    continue
                pa, pb = points[a][matches[:, 0]], points[b][matches[:, 1]]
                _, inliers = cv2.findFundamentalMat(pa, pb, cv2.FM_RANSAC, 1.5, 0.999)
                if inliers is None or inliers.sum() < 12:
                    continue
                verified.append((frames[a].camera.image_id, frames[b].camera.image_id))
                edges.extend(
                    (a, int(i), b, int(j))
                    for (i, j), good in zip(matches, inliers.ravel(), strict=True)
                    if good
                )
        names = [f.camera.image_id for f in frames]
        tracks = cycle_tracks(points, edges, names)
        # Stable, pre-truth spatial spread rather than selecting by lidar agreement.
        selected = []
        buckets = {}
        by_name = {f.camera.image_id: f.camera for f in frames}
        for track in tracks:
            name = min(track.pixels)
            x, y = track.pixels[name]
            c = by_name[name]
            buckets.setdefault((name, int(x * 8 / c.width), int(y * 6 / c.height)), []).append(
                track
            )
        while buckets and len(selected) < max_tracks:
            for key in list(buckets):
                selected.append(buckets[key].pop(0))
                if not buckets[key]:
                    del buckets[key]
                if len(selected) == max_tracks:
                    break
        return selected, {
            "backend": "ALIKED + LightGlue CPU",
            "source_commit": LIGHTGLUE_COMMIT,
            "candidate_pairs": len(pairs),
            "verified_pairs": verified,
            "candidate_three_view_tracks": len(tracks),
            "three_view_tracks": len(selected),
            "overlap_groups": overlap_groups(names, verified),
            "input_frames": len(frames),
        }
