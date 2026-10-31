"""Photographs to the block's master mesh, with COLMAP's command line.

Every phase writes its own folder under the block's work directory and is skipped when that
folder is already complete, so a retry -- a pod that ran out of time, a stage moved to another
machine -- resumes where it stopped. Nothing is reduced on the way: features are taken from the
full-size pictures, stereo runs at full size, and the Poisson surface is solved deep enough for
centimetre cells, so the master mesh holds everything the photographs can say.

    pairs      which pictures to match: neighbours in space and along each sequence
    features   SIFT on the originals (on the GPU when COLMAP has CUDA)
    matches    the pairs, geometrically verified
    sparse     incremental structure from motion, the frames' positions as priors: cameras, points
    aligned    the model moved into the block's east-north-up metres by the frames' positions
    dense      stereo depth for every picture, fused to a coloured point cloud (needs CUDA)
    anchored   the cloud moved rigidly onto the block's lidar (anchor.py)
    mesh       a watertight Poisson surface, trimmed back to where points support it

The sparse half runs anywhere (this Mac's COLMAP has no CUDA); the dense half needs a CUDA
build of COLMAP, which the cloud's GPU image has.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np

from smc.worldmesh.block import Block
from smc.worldmesh.ground import CAMERA_HEIGHT_M, Ground
from smc.worldmesh.photos import Frame
from smc.worldmesh.tiles import Mesh

MAX_PAIR_DISTANCE_M = 60.0
MAX_NEIGHBOURS = 20
SEQUENCE_NEIGHBOURS = 4
SIFT_FEATURES = 16384
#: Poisson octree depth: a 200 m block over 2^13 cells is about 2.4 cm a cell.
POISSON_DEPTH = 13
POISSON_TRIM = 7
#: The frames' positions are good to metres (Mapillary's own SfM, or GPS); a camera further
#: than this from where its frame says it was is left out of the alignment, not trusted.
ALIGNMENT_MAX_ERROR_M = 6.0


def colmap() -> str:
    path = shutil.which("colmap")
    if not path:
        raise RuntimeError("COLMAP is not installed")
    return path


def colmap_has_cuda() -> bool:
    out = subprocess.run([colmap(), "-h"], capture_output=True, text=True).stdout
    first = next((line for line in out.splitlines() if line.startswith("COLMAP")), "")
    return "with CUDA" in first


#: Memory one CPU matching thread holds: two pictures' 16k-18k descriptors compared all against
#: all is a distance matrix of about 1.3 GB, and the matcher keeps more than one. Ten threads,
#: then five, got it killed on a 16 GB Mac (2026-10-30); the GPU matcher needs no cap.
CPU_MATCH_THREAD_GB = 3.5


def cpu_match_threads() -> int:
    import os

    try:
        total_gb = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30
    except (ValueError, OSError):
        total_gb = 8.0
    return max(1, min(os.cpu_count() or 1, int(total_gb * 0.5 / CPU_MATCH_THREAD_GB)))


def _run(args: list[str], log: Path) -> None:
    with log.open("a") as handle:
        handle.write("$ " + " ".join(args) + "\n")
        handle.flush()
        done = subprocess.run(args, stdout=handle, stderr=subprocess.STDOUT)
    if done.returncode:
        raise RuntimeError(f"{Path(args[0]).name} {args[1]} failed ({done.returncode}); see {log}")


def frame_positions(frames: list[Frame], block: Block, ground: Ground | None = None) -> dict[str, np.ndarray]:
    """Each picture's position in the block's frame. A frame's own altitude is a phone's GPS or
    nothing, so a camera stands ``CAMERA_HEIGHT_M`` above the 3DEP ground where it was; the
    frame's zero is the ground at the block's centre (``Block.height_m`` on the ellipsoid)."""
    f = block.frame
    base = ground.at(f.lon, f.lat) if ground else 0.0
    out = {}
    for fr in frames:
        east, north, up = f.to_enu(fr.lon, fr.lat, block.height_m)
        if ground:
            up += ground.at(fr.lon, fr.lat) - base + CAMERA_HEIGHT_M
        out[fr.path] = np.array([east, north, up])
    return out


def write_pairs(frames: list[Frame], block: Block, path: Path) -> int:
    xyz = frame_positions(frames, block)
    names = [f.path for f in frames]
    pts = np.array([xyz[n] for n in names])
    pairs: set[tuple[str, str]] = set()
    from scipy.spatial import cKDTree

    tree = cKDTree(pts[:, :2])
    for i, name in enumerate(names):
        dist, idx = tree.query(pts[i, :2], k=min(len(names), MAX_NEIGHBOURS + 1),
                               distance_upper_bound=MAX_PAIR_DISTANCE_M)
        for d, j in zip(np.atleast_1d(dist), np.atleast_1d(idx), strict=False):
            if j < len(names) and j != i and math.isfinite(d):
                pairs.add(tuple(sorted((name, names[j]))))
    by_sequence: dict[str, list[Frame]] = {}
    for f in frames:
        by_sequence.setdefault(f.sequence, []).append(f)
    for run in by_sequence.values():
        run.sort(key=lambda f: (f.captured_at or 0, f.id))
        for i, a in enumerate(run):
            for b in run[i + 1:i + 1 + SEQUENCE_NEIGHBOURS]:
                pairs.add(tuple(sorted((a.path, b.path))))
    path.write_text("".join(f"{a} {b}\n" for a, b in sorted(pairs)))
    return len(pairs)


def _biggest_model(sparse: Path) -> Path | None:
    best, best_n = None, -1
    for model in sorted(p for p in sparse.iterdir() if p.is_dir()):
        images = model / "images.bin"
        if not images.exists():
            continue
        with images.open("rb") as handle:
            n = int.from_bytes(handle.read(8), "little")
        if n > best_n:
            best, best_n = model, n
    return best


#: COLMAP's RADIAL camera (f, cx, cy, k1, k2): the same distortion as Mapillary's perspective
#: camera (OpenSfM's), whose focal is a fraction of the larger side.
RADIAL = 3


def seed_intrinsics(database: Path, frames: list[Frame]) -> int:
    """Start each folder's camera from its sequence's lens as Mapillary's SfM calibrated it.

    Left to itself COLMAP guesses every lens at 1.2x the larger side; an action camera's wide
    lens is a third of that. Only a start: held fixed as a prior (``prior_focal_length``), it
    stopped images registering in the Chestnut trial, so the mapper is left to refine it.
    """
    import sqlite3

    lens: dict[str, list[tuple[float, float, float]]] = {}
    for f in frames:
        if f.focal and f.path:
            lens.setdefault(f.path.split("/")[0], []).append((f.focal, f.k1 or 0.0, f.k2 or 0.0))
    seeded = 0
    with sqlite3.connect(database) as db:
        folders = dict(db.execute("SELECT camera_id, MIN(name) FROM images GROUP BY camera_id").fetchall())
        for camera_id, width, height in db.execute("SELECT camera_id, width, height FROM cameras").fetchall():
            values = lens.get(str(folders.get(camera_id, "")).split("/")[0])
            if not values:
                continue
            focal, k1, k2 = np.median(np.array(values), axis=0)
            params = np.array([focal * max(width, height), width / 2, height / 2, k1, k2], np.float64)
            db.execute("UPDATE cameras SET model = ?, params = ?, prior_focal_length = 0 WHERE camera_id = ?",
                       (RADIAL, params.tobytes(), camera_id))
            seeded += 1
    return seeded


#: How far a frame's recorded position may be from where it was: Mapillary's SfM positions are
#: good to a metre or two across; the height is the 3DEP ground plus the camera's mount.
PRIOR_STD_HORIZONTAL_M = 2.0
PRIOR_STD_VERTICAL_M = 1.0
CARTESIAN = 1  # COLMAP's PosePrior::CoordinateSystem
CAMERA_SENSOR = 0


def write_pose_priors(database: Path, frames: list[Frame], block: Block, ground: Ground | None) -> int:
    """Every picture's position in the block's frame, as the mapper's pose prior.

    Straight-line sequences give structure from motion almost no parallax along the street: in
    the Chestnut trial (2026-10-31) the mapper shrank 66 m of a rear-facing car camera's run to
    2 m, and the model aligned at a 19 m median error. With the positions as priors the
    reconstruction is built in metres in the block's frame and every run kept its length; what
    is left is a steady offset per run (1-12 m there), each capture's own GPS bias, which the
    matches between runs settle and the lidar check measures.
    """
    import sqlite3

    xyz = frame_positions(frames, block, ground)
    covariance = np.diag([PRIOR_STD_HORIZONTAL_M ** 2, PRIOR_STD_HORIZONTAL_M ** 2, PRIOR_STD_VERTICAL_M ** 2])
    unknown = np.full(3, np.nan)
    written = 0
    with sqlite3.connect(database) as db:
        db.execute("DELETE FROM pose_priors")
        for image_id, name, camera_id in db.execute("SELECT image_id, name, camera_id FROM images").fetchall():
            if name not in xyz:
                continue
            db.execute("INSERT INTO pose_priors (corr_data_id, corr_sensor_id, corr_sensor_type, position,"
                       " position_covariance, gravity, coordinate_system) VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (image_id, camera_id, CAMERA_SENSOR, xyz[name].astype(np.float64).tobytes(),
                        covariance.astype(np.float64).tobytes(), unknown.tobytes(), CARTESIAN))
            written += 1
    return written


def registered_images(model: Path) -> int:
    with (model / "images.bin").open("rb") as handle:
        return int.from_bytes(handle.read(8), "little")


def solve(work: Path, block: Block, frames: list[Frame], *, ground: Ground | None = None,
          lidar: np.ndarray | None = None, gpu: bool | None = None, dense: bool | None = None) -> dict:
    """Run every phase not yet done. Returns what was made and what was measured."""
    exe = colmap()
    cuda = colmap_has_cuda() if gpu is None else gpu
    dense = cuda if dense is None else dense
    images, log = work / "images", work / "colmap.log"
    database = work / "colmap.db"
    report: dict = {"frames": len(frames), "cuda": cuda}

    pairs = work / "pairs.txt"
    if not pairs.exists():
        report["pairs"] = write_pairs(frames, block, pairs)
    use_gpu = "1" if cuda else "0"
    features_done = work / ".features"
    if not features_done.exists():
        database.unlink(missing_ok=True)
        _run([exe, "feature_extractor", "--database_path", str(database), "--image_path", str(images),
              "--ImageReader.single_camera_per_folder", "1", "--ImageReader.camera_model", "SIMPLE_RADIAL",
              "--FeatureExtraction.use_gpu", use_gpu, "--FeatureExtraction.max_image_size", "-1",
              "--SiftExtraction.max_num_features", str(SIFT_FEATURES)], log)
        features_done.touch()
    seeded = work / ".intrinsics"
    if not seeded.exists():
        report["seeded_cameras"] = seed_intrinsics(database, frames)
        seeded.touch()
    matches_done = work / ".matches"
    if not matches_done.exists():
        _run([exe, "matches_importer", "--database_path", str(database), "--match_list_path", str(pairs),
              "--match_type", "pairs", "--FeatureMatching.use_gpu", use_gpu,
              "--FeatureMatching.guided_matching", "1",
              "--FeatureMatching.num_threads", str(-1 if cuda else cpu_match_threads())], log)
        matches_done.touch()
    sparse = work / "sparse"
    if not sparse.exists() or _biggest_model(sparse) is None:
        shutil.rmtree(sparse, ignore_errors=True)
        sparse.mkdir()
        report["pose_priors"] = write_pose_priors(database, frames, block, ground)
        # Plain (not robust) priors: with the robust loss a run's matches still outvoted its
        # positions and two runs shrank to a third of their length.
        _run([exe, "pose_prior_mapper", "--database_path", str(database), "--image_path", str(images),
              "--output_path", str(sparse), "--use_robust_loss_on_prior_position", "0"], log)
    model = _biggest_model(sparse)
    if model is None:
        raise RuntimeError("structure from motion registered no model")
    report["registered"] = registered_images(model)
    report["registered_share"] = report["registered"] / max(1, len(frames))

    aligned = work / "aligned"
    if not (aligned / "images.bin").exists():
        aligned.mkdir(exist_ok=True)
        reference = work / "reference.txt"
        xyz = frame_positions(frames, block, ground)
        reference.write_text("".join(f"{name} {p[0]:.3f} {p[1]:.3f} {p[2]:.3f}\n" for name, p in xyz.items()))
        _run([exe, "model_aligner", "--input_path", str(model), "--output_path", str(aligned),
              "--ref_images_path", str(reference), "--ref_is_gps", "0", "--alignment_type", "custom",
              "--alignment_max_error", str(ALIGNMENT_MAX_ERROR_M), "--min_common_images", "6"], log)
    if not (aligned / "images.bin").exists():
        raise RuntimeError("the model could not be aligned to the frames' positions")
    report["aligned"] = True
    if not dense:
        report["stopped"] = "dense stereo needs a CUDA build of COLMAP"
        return report

    workspace = work / "dense"
    fused = workspace / "fused.ply"
    if not fused.exists():
        if not (workspace / "images").exists():
            _run([exe, "image_undistorter", "--image_path", str(images), "--input_path", str(aligned),
                  "--output_path", str(workspace), "--output_type", "COLMAP"], log)
        _run([exe, "patch_match_stereo", "--workspace_path", str(workspace), "--workspace_format", "COLMAP",
              "--PatchMatchStereo.geom_consistency", "true", "--PatchMatchStereo.max_image_size", "-1"], log)
        _run([exe, "stereo_fusion", "--workspace_path", str(workspace), "--workspace_format", "COLMAP",
              "--input_type", "geometric", "--output_path", str(fused),
              "--StereoFusion.max_image_size", "-1"], log)
    source = fused
    if lidar is not None and len(lidar):
        source, record = workspace / "fused-anchored.ply", work / "anchor.json"
        if not source.exists():
            from smc.worldmesh.anchor import anchor_cloud

            record.write_text(json.dumps(anchor_cloud(fused, source, lidar).to_json(), indent=1))
        report["anchor"] = json.loads(record.read_text())
    mesh = work / "mesh.ply"
    if not mesh.exists():
        _run([exe, "poisson_mesher", "--input_path", str(source), "--output_path", str(mesh),
              "--PoissonMeshing.depth", str(POISSON_DEPTH), "--PoissonMeshing.trim", str(POISSON_TRIM)], log)
    report["mesh"] = str(mesh.relative_to(work))
    return report


def load_mesh(path: Path, block: Block) -> Mesh:
    """The master mesh, the triangles the block owns: centroid inside its rectangle."""
    import trimesh

    loaded = trimesh.load(path, process=False, force="mesh")
    positions = np.asarray(loaded.vertices, dtype=np.float64)
    faces = np.asarray(loaded.faces, dtype=np.int64)
    colours = None
    visual = getattr(loaded, "visual", None)
    if visual is not None and getattr(visual, "kind", None) == "vertex":
        colours = np.asarray(visual.vertex_colors, dtype=np.uint8)
    w, s, e, n = block.bounds_m()
    centre = positions[faces].mean(axis=1)
    own = (centre[:, 0] >= w) & (centre[:, 0] < e) & (centre[:, 1] >= s) & (centre[:, 1] < n)
    return Mesh(positions, faces, colours).subset(np.flatnonzero(own))


def write_report(work: Path, report: dict) -> None:
    (work / "solve.json").write_text(json.dumps(report, indent=1))
