"""Seeding the reference index — the bootstrapping answer.

Anchoring works by matching a capture against frames that are *already* anchored. Nothing
produces the first one, and that circularity was the largest open design question in the build.

This resolves it the way the hardware already suggested: **the RTK vehicle rig is the survey
backbone.** A car roof carries a multi-band GNSS antenna and a rigid stereo baseline; a pair of
glasses carries neither. So the rig drives a corridor once and produces reference frames whose
poses are known to centimetres and whose 3D structure is metric by construction from the stereo
baseline. Every later monocular capture — from glasses, from a phone, from anyone — localises
against that survey rather than against another guess.

Two consequences worth being explicit about:

* The reference layer is an **asset**, not a cache. It is the thing that makes crowdsourced
  monocular capture reach sub-metre at all, and it is what a competitor without a surveyed
  corridor cannot cheaply reproduce.
* Error cannot be laundered. Reference frames carry the rig's own sigma, and
  :class:`~smc.mapping.anchoring.AnchoringPipeline` propagates it, so a chain of frames anchored
  against each other degrades honestly instead of converging on false precision.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from smc import geo
from smc.carla_gen.gnss import PRESETS, Environment, GnssSimulator
from smc.mapping.descriptors import FrameDescriptor, TinyImageDescriptor
from smc.mapping.pose import Pose
from smc.mapping.retrieval import DescriptorIndex, ReferenceFrame
from smc.render.raster import RenderResult


@dataclass(frozen=True, slots=True)
class SeedingConfig:
    """How the survey pass is flown."""

    #: Points sampled per reference frame from the visible surface.
    points_per_frame: int = 400
    #: Depth noise standard deviation, as a fraction of range. Stereo error grows with Z^2, but
    #: a linear fraction is the right first-order stand-in and is deliberately pessimistic near.
    depth_relative_sigma: float = 0.01
    #: Environment used for the rig's RTK receiver.
    gnss_environment: Environment = Environment.RTK_FIXED
    #: Floor on a reference's reported sigma. No survey is better than its calibration.
    min_reference_sigma_m: float = 0.03


@dataclass(frozen=True, slots=True)
class SeedingReport:
    frames_seeded: int
    mean_reference_sigma_m: float
    mean_points_per_frame: float
    rejected: int

    @property
    def ok(self) -> bool:
        return self.frames_seeded > 0


def seed_reference_frame(
    frame_id: str,
    render: RenderResult,
    true_pose: Pose,
    origin: geo.Origin,
    *,
    gnss: GnssSimulator,
    descriptor_model: FrameDescriptor,
    config: SeedingConfig,
    rng: np.random.Generator,
) -> ReferenceFrame | None:
    """Turn one rig capture into a reference frame.

    The 3D points come from the stereo depth the rig actually measured — here, the render's
    world buffer with noise applied — never from the ground-truth mesh. Seeding from the mesh
    would produce a reference index that is perfect in a way no rig can be, and every accuracy
    number measured against it would be fiction.
    """
    points_world, pixels = render.sample_correspondences(
        np.eye(3), config.points_per_frame, rng
    )
    if len(points_world) < 20:
        return None

    # Perturb along the viewing ray, which is how stereo depth error actually behaves — not
    # isotropically, which would put error in the two directions stereo measures well.
    centre = true_pose.camera_centre
    rays = points_world - centre
    ranges = np.linalg.norm(rays, axis=1, keepdims=True)
    directions = rays / np.maximum(ranges, 1e-9)
    depth_error = rng.normal(0.0, config.depth_relative_sigma, size=ranges.shape) * ranges
    measured_points = centre + directions * (ranges + depth_error)

    error = gnss.step(1.0)
    east, north = float(centre[0] + error[0]), float(centre[1] + error[1])
    lat, lon = geo.enu_to_geodetic(origin, east, north)
    sigma = max(config.min_reference_sigma_m, float(np.hypot(error[0], error[1])))

    return ReferenceFrame(
        frame_id=frame_id,
        lat=lat,
        lon=lon,
        descriptor=descriptor_model.describe(render.image),
        points_world=measured_points,
        points_2d=pixels,
        position_sigma_m=sigma,
        source="rtk_rig",
    )


def seed_index(
    renders: list[tuple[str, RenderResult, Pose]],
    origin: geo.Origin,
    *,
    config: SeedingConfig | None = None,
    descriptor_model: FrameDescriptor | None = None,
    seed: int = 0,
) -> tuple[DescriptorIndex, SeedingReport]:
    """Build a reference index from a survey pass."""
    config = config or SeedingConfig()
    descriptor_model = descriptor_model or TinyImageDescriptor()
    rng = np.random.default_rng(seed)
    gnss = GnssSimulator(PRESETS[config.gnss_environment], np.random.default_rng(seed + 1))

    index = DescriptorIndex()
    sigmas: list[float] = []
    counts: list[int] = []
    rejected = 0

    for frame_id, render, pose in renders:
        frame = seed_reference_frame(
            frame_id,
            render,
            pose,
            origin,
            gnss=gnss,
            descriptor_model=descriptor_model,
            config=config,
            rng=rng,
        )
        if frame is None:
            rejected += 1
            continue
        index.add(frame)
        sigmas.append(frame.position_sigma_m)
        counts.append(len(frame.points_world))

    return index, SeedingReport(
        frames_seeded=len(index),
        mean_reference_sigma_m=float(np.mean(sigmas)) if sigmas else float("inf"),
        mean_points_per_frame=float(np.mean(counts)) if counts else 0.0,
        rejected=rejected,
    )
