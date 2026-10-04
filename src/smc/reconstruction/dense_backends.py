"""Optional dense engines; outputs are evidence candidates, never release approval.

fVDB uses upstream radiance-field/TSDF code, not a Kerbside meshing algorithm.
The stable 0.4 API is pinned deliberately; later releases require a different stack.
"""

from __future__ import annotations

import importlib.metadata
import math
import platform
from pathlib import Path
from typing import Any

import numpy as np

from smc.geometry.base import TriMesh
from smc.reconstruction.contracts import sha256_file

FVDB_PINS = {
    "fvdb-reality-capture": "0.4.0",
    "fvdb-core": "0.3.0+pt28.cu128",
    "torch": "2.8.0",
}
FVDB_SOURCE_SHA = "b94d1c9bbdd9b41d1c6c7eb643d126d968c92c47"


def fvdb_preflight() -> list[str]:
    """Cheap, actionable refusal before model loading or any downloads."""
    failures = []
    if platform.system() != "Linux":
        failures.append("fVDB requires Linux; this host is " + platform.system())
    for name, expected in FVDB_PINS.items():
        try:
            installed = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            failures.append(f"missing {name}=={expected}")
            continue
        # Torch wheels append a CUDA local version; fVDB's local suffix is significant.
        matches = installed.split("+")[0] == expected if name == "torch" else installed == expected
        if not matches:
            failures.append(f"{name}: expected {expected}, found {installed}")
    if failures:
        return failures
    import torch

    if not torch.cuda.is_available():
        failures.append("CUDA GPU unavailable")
    elif torch.cuda.get_device_capability() < (8, 0):
        failures.append("fVDB requires Ampere-or-later compute capability >=8.0")
    if torch.version.cuda != "12.8":
        failures.append("pinned fVDB worker requires CUDA 12.8 PyTorch")
    return failures


def reconstruct_fvdb(workspace: Path, output: Path, *,
                     truncation_margin_m: float = 0.12,
                     max_steps: int = 10_000) -> dict[str, Any]:
    """Undistorted, ENU-aligned COLMAP workspace -> unvalidated coloured mesh.

    No PCA normalization, inferred depth priors, or automatic DLNR weight download.
    Disable pose optimization to preserve the independently aligned metric frame.
    Black privacy masks are not evidence behind their occluders: downstream object
    promotion still requires independent visibility/geometry/privacy validation.
    """
    failures = fvdb_preflight()
    if failures:
        raise RuntimeError("; ".join(failures))
    if not math.isfinite(truncation_margin_m) or not 0.01 <= truncation_margin_m <= 0.5:
        raise ValueError("TSDF truncation margin must be within 0.01..0.5 metres")
    if not isinstance(max_steps, int) or not 1 <= max_steps <= 100_000:
        raise ValueError("max_steps must be within 1..100000")
    if output.exists():
        raise FileExistsError(f"refusing to replace dense evidence: {output}")
    import fvdb_reality_capture as frc
    import point_cloud_utils as pcu
    import torch
    from fvdb_reality_capture.radiance_fields.gaussian_splat_reconstruction import (
        GaussianSplatReconstructionConfig,
    )
    from fvdb_reality_capture.radiance_fields.gaussian_splat_reconstruction_writer import (
        GaussianSplatReconstructionWriter,
    )
    from fvdb_reality_capture.tools import mesh_from_splats

    scene = frc.sfm_scene.SfmScene.from_colmap(workspace)
    config = GaussianSplatReconstructionConfig(
        optimize_camera_poses=False, max_steps=max_steps, seed=42,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    writer = GaussianSplatReconstructionWriter("fvdb", output.parent / "checkpoints")
    runner = frc.radiance_fields.GaussianSplatReconstruction.from_sfm_scene(
        scene, config=config, writer=writer,
    )
    runner.optimize()
    vertices, faces, colours = mesh_from_splats(
        runner.model, scene.camera_to_world_matrices, scene.projection_matrices,
        scene.image_sizes, truncation_margin_m, dtype=torch.float32,
    )
    v, f, c = (tensor.detach().cpu().numpy() for tensor in (vertices, faces, colours))
    mesh = TriMesh(v, f)
    if mesh.empty or (mesh.face_areas() <= 1e-10).any() or c.shape != (len(v), 3) or \
            not np.isfinite(c).all() or (c < 0).any() or (c > 1).any():
        raise ValueError("fVDB returned empty, degenerate or non-finite dense evidence")
    pcu.save_mesh_vfc(str(output), v, f, c)
    return {"backend": "fvdb", "backend_source_sha": FVDB_SOURCE_SHA,
            "dense_mesh": str(output), "dense_mesh_sha256": sha256_file(output),
            "vertices": len(v), "faces": len(f), "parameters": {
                "truncation_margin_m": truncation_margin_m, "max_steps": max_steps,
                "optimize_camera_poses": False, "tsdf_precision": "float32",
            }, "promotion_state": "unvalidated"}
