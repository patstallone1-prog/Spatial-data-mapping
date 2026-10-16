"""Masked ALIKED/LightGlue SfM followed by COLMAP dense stereo.

All source files are local, hashed, rights checked, and excluded from the held-out
benchmark.  The runner refuses to start when its optional GPU dependencies are
unavailable; preparation of blocked cell manifests does not need those packages.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from smc.reconstruction.contracts import build_uses, load_rights, sha256_file
from smc.reconstruction.fusion import mask_temporary_objects
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.matching_benchmark import assert_holdout_disjoint

MIN_IMAGES = 20
MIN_INDEPENDENT_SEQUENCES = 3
MAX_PAIR_DISTANCE_M = 80.0
MAX_NEIGHBOURS = 24


@dataclass(frozen=True)
class InputImage:
    observation_uid: str
    source_id: str
    license_id: str
    attribution: str
    image_path: Path
    image_sha256: str
    masks_npz: Path
    sequence_id: str
    camera_group: str
    lon: float
    lat: float
    altitude_m_ellipsoid: float
    reprojection_sigma_px: float

    @classmethod
    def from_json(cls, row: dict[str, Any]) -> InputImage:
        return cls(
            observation_uid=str(row["observation_uid"]), source_id=str(row["source_id"]),
            license_id=str(row["license_id"]), attribution=str(row["attribution"]),
            image_path=Path(row["image_path"]), image_sha256=str(row["image_sha256"]),
            masks_npz=Path(row["masks_npz"]), sequence_id=str(row["sequence_id"]),
            camera_group=str(row["camera_group"]), lon=float(row["lon"]),
            lat=float(row["lat"]), altitude_m_ellipsoid=float(row["altitude_m_ellipsoid"]),
            reprojection_sigma_px=float(row["reprojection_sigma_px"]),
        )


def preflight_inputs(input_manifest: Path, rights_path: Path,
                     benchmark_path: Path) -> tuple[list[InputImage], EnuFrame]:
    document = json.loads(input_manifest.read_text())
    if document.get("vertical_datum") != "WGS84_ellipsoid":
        raise ValueError("camera altitudes must be converted to the WGS84 ellipsoid")
    origin = document["enu_origin_wgs84"]
    frame = EnuFrame(float(origin[0]), float(origin[1]), float(origin[2]))
    rows = [InputImage.from_json(row) for row in document["images"]]
    if len(rows) < MIN_IMAGES or len({r.sequence_id for r in rows}) < MIN_INDEPENDENT_SEQUENCES:
        raise ValueError("SfM needs at least 20 images from three independent sequences")
    if len({r.observation_uid for r in rows}) != len(rows):
        raise ValueError("duplicate observation in reconstruction input")
    assert_holdout_disjoint(document["images"], json.loads(benchmark_path.read_text())[
        "held_out_observations"])
    rights = load_rights(rights_path)
    for item in rows:
        source = rights.get(item.source_id)
        if source is None:
            raise ValueError(f"unregistered image source {item.source_id}")
        source.require(*build_uses(
            "cv_processing", "texture_baking", "derived_mesh",
            "persistent_hosting", "redistribution",
        ))
        if item.license_id != source.license_id or not item.attribution:
            raise ValueError(f"license or attribution mismatch on {item.observation_uid}")
        if not item.image_path.is_file() or not item.masks_npz.is_file():
            raise FileNotFoundError(f"missing image or mask for {item.observation_uid}")
        if sha256_file(item.image_path) != item.image_sha256:
            raise ValueError(f"image hash mismatch on {item.observation_uid}")
        if not all(math.isfinite(v) for v in (item.lon, item.lat, item.altitude_m_ellipsoid)):
            raise ValueError(f"non-finite camera position on {item.observation_uid}")
        if (not math.isfinite(item.reprojection_sigma_px) or item.reprojection_sigma_px < 0
                or not item.observation_uid.replace("-", "").replace("_", "").isalnum()):
            raise ValueError("safe observation ID and finite nonnegative mask uncertainty required")
        if not item.camera_group or any(
            not (c.isascii() and (c.isalnum() or c in "-_")) for c in item.camera_group
        ):
            raise ValueError("camera group must be a safe exact ID; do not merge sanitized aliases")
    if len({r.image_sha256 for r in rows}) != len(rows):
        raise ValueError("identical source-image aliases are not independent SfM views")
    return rows, frame


def _redact_inputs(
    images: list[InputImage], work_dir: Path,
) -> tuple[Path, dict[str, tuple[float, float, float]]]:
    image_dir = work_dir / "redacted_images"
    positions: dict[str, tuple[float, float, float]] = {}
    for item in images:
        image = cv2.imread(str(item.image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"unreadable image {item.image_path}")
        with np.load(item.masks_npz, allow_pickle=False) as archive:
            masks = {name: archive[name].astype(bool) for name in archive.files}
        required = {"person", "face", "license_plate", "car", "sky"}
        if not required <= masks.keys():
            missing = sorted(required - masks.keys())
            raise ValueError(f"mask classes missing on {item.observation_uid}: {missing}")
        if any(mask.shape != image.shape[:2] for mask in masks.values()):
            raise ValueError(f"mask size mismatch on {item.observation_uid}")
        blocked = mask_temporary_objects(masks, item.reprojection_sigma_px)
        image[blocked] = 0
        group = item.camera_group
        if not group:
            raise ValueError("camera group must contain a safe name")
        name = f"{group}/{item.observation_uid}.png"
        target = image_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(target), image):
            raise OSError(f"cannot write redacted image {target}")
        positions[name] = (item.lon, item.lat, item.altitude_m_ellipsoid)
    return image_dir, positions


def _write_pairs(names: list[str], frame: EnuFrame,
                 positions: dict[str, tuple[float, float, float]], path: Path) -> int:
    xyz = {name: np.array(frame.to_enu(*positions[name])) for name in names}
    pairs: set[tuple[str, str]] = set()
    for name in names:
        near = sorted(((float(np.linalg.norm(xyz[name] - xyz[other])), other)
                       for other in names if other != name), key=lambda item: item[0])
        eligible = [(distance, other) for distance, other in near
                    if 0.25 <= distance <= MAX_PAIR_DISTANCE_M]
        for _distance, other in eligible[:MAX_NEIGHBOURS]:
            pairs.add(tuple(sorted((name, other))))
    if len(pairs) < len(names):
        raise ValueError("camera graph has too few overlapping candidate pairs")
    pending, seen = [names[0]], set()
    adjacency = {name: set() for name in names}
    for a, b in pairs:
        adjacency[a].add(b)
        adjacency[b].add(a)
    while pending:
        name = pending.pop()
        if name not in seen:
            seen.add(name)
            pending.extend(adjacency[name] - seen)
    if len(seen) != len(names):
        raise ValueError("disconnected candidate camera graph: reconstruct components separately")
    path.write_text("".join(f"{a} {b}\n" for a, b in sorted(pairs)))
    return len(pairs)


def _run(args: list[str]) -> None:
    subprocess.run(args, check=True, capture_output=True, text=True)


def require_metric_alignment_support(targets: np.ndarray) -> None:
    """Check control geometry before invoking the Sim3 optimizer.

    Collinear camera centres leave rotation about their trajectory unobservable.
    GNSS coordinates alone are not independent survey validation afterward.
    """
    targets = np.asarray(targets, dtype=np.float64)
    if targets.ndim != 2 or targets.shape[1] != 3 or not np.isfinite(targets).all():
        raise ValueError("finite ENU camera positions required")
    if len(targets) < 6:
        raise ValueError("metric alignment needs six registered controls")
    singular = np.linalg.svd(targets - targets.mean(axis=0), compute_uv=False)
    if singular[1] < max(0.25, singular[0] * 0.01):
        raise ValueError("unobservable metric alignment: need non-collinear independent controls")


def reconstruct_cell(input_manifest: Path, rights_path: Path, benchmark_path: Path,
                     work_dir: Path) -> dict[str, Any]:
    rows, frame = preflight_inputs(input_manifest, rights_path, benchmark_path)
    if shutil.which("colmap") is None:
        raise RuntimeError("COLMAP executable is required for dense reconstruction")
    try:
        import pycolmap
        from hloc import extract_features, match_features, reconstruction
    except ImportError as exc:
        raise RuntimeError("pinned PyCOLMAP and hloc (ALIKED/LightGlue) are required") from exc
    work_dir.mkdir(parents=True, exist_ok=True)
    image_dir, positions = _redact_inputs(rows, work_dir)
    names = sorted(positions)
    pairs_path = work_dir / "pairs.txt"
    pair_count = _write_pairs(names, frame, positions, pairs_path)
    features = extract_features.main(extract_features.confs["aliked-n16"], image_dir,
                                     export_dir=work_dir, image_list=names)
    matches = match_features.main(match_features.confs["aliked+lightglue"], pairs_path,
                                  features, export_dir=work_dir)
    sparse_dir = work_dir / "sparse"
    model = reconstruction.main(sparse_dir, image_dir, pairs_path, features, matches,
                                camera_mode=pycolmap.CameraMode.PER_FOLDER, image_list=names)
    if model is None or model.num_reg_images() < MIN_IMAGES:
        raise ValueError("sparse reconstruction registered too few cameras")
    targets = np.asarray([frame.to_enu(*positions[name]) for name in names], dtype=np.float64)
    # A collinear trajectory cannot orient an absolute Sim3 around that line.
    # Do not let an alignment optimizer invent that missing degree of freedom.
    registered_names = {model.images[i].name for i in model.reg_image_ids()}
    common = targets[[name in registered_names for name in names]]
    require_metric_alignment_support(common)
    transform = pycolmap.align_reconstruction_to_locations(
        model, names, targets, min_common_images=6,
        ransac_options=pycolmap.RANSACOptions(),
    )
    if transform is None:
        raise ValueError("metric alignment failed")
    model.transform(transform)
    aligned = work_dir / "aligned_sparse"
    aligned.mkdir(exist_ok=True)
    model.write(aligned)
    dense = work_dir / "dense"
    _run(["colmap", "image_undistorter", "--image_path", str(image_dir),
          "--input_path", str(aligned), "--output_path", str(dense),
          "--output_type", "COLMAP"])
    _run(["colmap", "patch_match_stereo", "--workspace_path", str(dense),
          "--workspace_format", "COLMAP", "--PatchMatchStereo.geom_consistency", "true"])
    cloud = dense / "fused.ply"
    _run(["colmap", "stereo_fusion", "--workspace_path", str(dense),
          "--workspace_format", "COLMAP", "--input_type", "geometric",
          "--output_path", str(cloud)])
    if not cloud.exists() or cloud.stat().st_size < 1024:
        raise ValueError("dense stereo yielded no usable point cloud")
    summary = {
        "input_images": len(rows), "candidate_pairs": pair_count,
        "registered_images": model.num_reg_images(),
        "dense_cloud": str(cloud), "dense_cloud_sha256": sha256_file(cloud),
        "coordinate_frame": "ENU_m_WGS84_ellipsoid",
        "promotion_state": "unvalidated",
    }
    (work_dir / "reconstruction.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary
