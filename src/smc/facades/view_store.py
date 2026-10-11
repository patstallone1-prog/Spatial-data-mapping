"""Every photograph of a house, kept together, for reconstruction from several views later.

The run files each screened photograph by itself (``frontage-live/review/<region>-<id>-<uid>``),
and a fit is made from the best one. Several views of one front -- different days, different
cameras, from either side -- are what a multiview reconstruction needs, so each house gets a
folder of its own with every view the filter passed and what is needed to use it:

  views/<region>/<id>/manifest.json   per view: the camera and its pose, the wall it was
                                      rectified onto, how it ranked, when and by whom it was taken,
                                      and the hash of the full original frame in the filter's
                                      lossless pixel store
  views/<region>/<id>/<key>.jpg       the rectified front, its segmentation (.labels.png) and its
                                      wider context (.context.jpg), hard-linked, not copied

Private, like the rest of the run: nothing here is published.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

SCHEMA = "kerbside.house_views/1"
SUFFIXES = (".jpg", ".labels.png", ".context.jpg")
SCREENED = {"verified", "screened_candidate_needs_privacy_and_identity_review",
            "screened_candidate_needs_pose_review"}


def _link(source: Path, target: Path) -> bool:
    if target.exists():
        return True
    try:
        os.link(source, target)
    except OSError:
        try:
            shutil.copy2(source, target)
        except OSError:
            return False
    return True


class ViewStore:
    def __init__(self, root: Path):
        self.root = root
        self._manifests: dict[tuple[str, str], dict] = {}

    def _manifest(self, region: str, building_id: str) -> dict:
        key = (region, building_id)
        if key not in self._manifests:
            path = self.root / region / building_id / "manifest.json"
            try:
                self._manifests[key] = json.loads(path.read_text())
            except (OSError, ValueError):
                self._manifests[key] = {"schema": SCHEMA, "region": region, "building_id": building_id,
                                        "views": []}
        return self._manifests[key]

    def file(self, row: dict, review_path: Path) -> bool:
        """File one screened view with its house; True when it was new."""
        if row.get("status") not in SCREENED or not isinstance(row.get("candidate"), dict):
            return False
        region, building_id = row["region"], str(row["building_id"])
        manifest = self._manifest(region, building_id)
        view_key = review_path.stem
        if any(v["key"] == view_key for v in manifest["views"]):
            return False
        folder = self.root / region / building_id
        folder.mkdir(parents=True, exist_ok=True)
        files = {}
        for suffix in SUFFIXES:
            source = review_path.with_suffix(suffix)
            if source.is_file() and _link(source, folder / f"{view_key}{suffix}"):
                files[suffix.lstrip(".")] = f"{view_key}{suffix}"
        if "jpg" not in files:
            return False
        candidate = row["candidate"]
        observation = candidate.get("observation") or {}
        manifest["address"] = row.get("address") or manifest.get("address")
        manifest["views"].append({
            "key": view_key,
            "observation_uid": observation.get("observation_uid"),
            "provider": observation.get("provider"),
            "provider_image_id": observation.get("provider_image_id"),
            "captured_at": observation.get("captured_at"),
            "camera_position": [observation.get("longitude"), observation.get("latitude"),
                                observation.get("altitude")],
            "heading_deg": observation.get("heading_deg"),
            "projection_type": observation.get("projection_type"),
            "camera": candidate.get("camera"),
            "wall": candidate.get("wall"),
            "pose_status": candidate.get("pose_status"),
            "rank": candidate.get("rank"),
            "angle_deg": candidate.get("angle_deg"),
            "distance_m": candidate.get("distance_m"),
            "pixels_per_m": candidate.get("pixels_per_m"),
            "full_frame_pixel_sha256": row.get("pixel_sha256"),
            "license_id": observation.get("license_id"),
            "attribution": observation.get("attribution"),
            "files": files,
        })
        manifest["views"].sort(key=lambda v: str(v.get("captured_at")))
        manifest["view_count"] = len(manifest["views"])
        tmp = folder / "manifest.json.tmp"
        tmp.write_text(json.dumps(manifest, indent=1, default=str))
        os.replace(tmp, folder / "manifest.json")
        return True
