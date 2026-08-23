"""Seeding the reference index — the bootstrapping answer.

Anchoring works by matching a capture against frames that are *already* anchored. Nothing
produces the first one, and that circularity was the largest open design question in the build.

This resolves it the way the hardware already suggested: **the RTK vehicle rig is the survey
backbone.** A car roof carries a multi-band GNSS antenna and a rigid stereo baseline; a pair of
glasses carries neither. So the rig drives a corridor once and produces reference frames whose
poses are known to centimetres and whose 3D structure is metric by construction from the stereo
baseline. Every later monocular capture — from glasses, from a phone, from anyone — localises
against that survey rather than against another guess.

**The vantage constraint, measured.** A survey drives the lane; a wearer walks the pavement.
Those two cameras sit four metres apart laterally and a third of a metre apart vertically, and
in simulation an index built from one anchors captures from the other **not at all** — zero of
fifteen, against 12 of 15 for same-vantage captures. Isolating the stages showed retrieval was
never the problem (6 of 6 frames retrieved the right reference, similarity 0.47); local feature
matching returned 1-4 correspondences where 10 are needed, even with affine view simulation and
even bypassing retrieval entirely. Surface overlap between the two views is 43%, so the two
cameras genuinely see the same wall — the descriptors simply do not survive the change.

Whether that is a property of SIFT or of the simulator's synthetic texture **cannot be settled
in simulation**, because the renderer's procedural detail is already marginal for same-vantage
matching. It is settled by photographs; see ``python -m smc.calibrate vantage``.

Until it is settled, :func:`survey_vantages` treats it as real and surveys both positions. That
is more work per corridor and it is the only option that is known to work.

Two further consequences:

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
from smc.mapping.affine import AffineView, default_views, detect_multi_view
from smc.mapping.descriptors import FrameDescriptor, TinyImageDescriptor
from smc.mapping.features import FeatureConfig, detect
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
    #: Seed with real detected features and their descriptors rather than sampled surface
    #: points. Required for anything but the simulation oracle to match against the index.
    use_real_features: bool = True
    feature_config: FeatureConfig | None = None
    #: Detect across simulated viewpoints so the index can be matched from vantages the survey
    #: never occupied. Costs index build time and index size; see :mod:`smc.mapping.affine`.
    affine_views: bool = True
    views: tuple[AffineView, ...] | None = None


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
    descriptors: np.ndarray | None = None
    if config.use_real_features:
        points_world, pixels, descriptors = _feature_correspondences(render, config)
    else:
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
        local_descriptors=descriptors,
    )


def _feature_correspondences(
    render: RenderResult, config: SeedingConfig
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Detect features and look up the 3D position each one landed on.

    This is what a real stereo rig does: detect in the image, read depth at those pixels, keep
    the ones that hit geometry. Features that land on sky have no 3D position and are dropped —
    silently keeping them would put points at infinity into the index and wreck PnP.
    """
    feature_config = config.feature_config or FeatureConfig()
    features = (
        detect_multi_view(render.image, feature_config, config.views or default_views())
        if config.affine_views
        else detect(render.image, feature_config)
    )
    if len(features) == 0:
        return np.zeros((0, 3)), np.zeros((0, 2)), np.zeros((0, 128))

    columns = np.clip(np.round(features.keypoints[:, 0]).astype(int), 0, render.world.shape[1] - 1)
    rows = np.clip(np.round(features.keypoints[:, 1]).astype(int), 0, render.world.shape[0] - 1)
    world = render.world[rows, columns]
    hit = np.isfinite(world).all(axis=1)

    return world[hit], features.keypoints[hit], features.descriptors[hit]


@dataclass(frozen=True, slots=True)
class Vantage:
    """A camera position class the survey should cover.

    A vantage is not a viewpoint along the route — it is a *class* of viewpoint: out in the
    lane at dash height, on the pavement at eye height. Captures anchor against references from
    their own class, so an index that omits a class cannot serve the contributors who use it.
    """

    name: str
    #: Lateral offset from the kerb line. Negative is in the carriageway.
    lateral_m: float
    height_m: float
    #: Spacing between survey stations for this vantage.
    spacing_m: float = 4.0

    @property
    def is_footway(self) -> bool:
        return self.lateral_m > 0.0


#: The two classes that matter for this product. A rig that only drives cannot serve wearers.
DEFAULT_VANTAGES: tuple[Vantage, ...] = (
    Vantage("roadway", lateral_m=-4.2, height_m=1.30, spacing_m=4.0),
    Vantage("footway", lateral_m=1.10, height_m=1.60, spacing_m=3.0),
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


def survey_vantages(
    corridor: object,
    vantages: tuple[Vantage, ...] = DEFAULT_VANTAGES,
    *,
    width: int = 480,
    height: int = 360,
    focal_px: float = 360.0,
    config: SeedingConfig | None = None,
    descriptor_model: FrameDescriptor | None = None,
    seed: int = 0,
) -> tuple[DescriptorIndex, dict[str, SeedingReport]]:
    """Survey a corridor from every vantage class into one index.

    The practical answer to the vantage constraint. Each class is surveyed separately and the
    references land in a single index, so a query retrieves whichever class it resembles without
    anything downstream needing to know classes exist.

    The cost is honest: covering both classes means driving the corridor *and* walking it. That
    is the price of a reference layer that serves both a vehicle fleet and a wearer network, and
    it is cheaper than a corridor that silently fails to anchor half its contributors.
    """
    from smc.ingest.photobank import GlassesProfile, wearer_pose
    from smc.mapping.pose import Pose, intrinsics
    from smc.render.raster import corridor_triangles, render_meshes

    config = config or SeedingConfig()
    triangles, colours = corridor_triangles(corridor)
    k = intrinsics(focal_px, width / 2.0, height / 2.0)
    length = float(getattr(corridor, "length_m", 100.0))

    index = DescriptorIndex()
    reports: dict[str, SeedingReport] = {}

    for vantage in vantages:
        frames: list[tuple[str, RenderResult, Pose]] = []
        for i, station in enumerate(np.arange(4.0, max(length - 15.0, 5.0), vantage.spacing_m)):
            if vantage.is_footway:
                profile = GlassesProfile(
                    photo_width=width, photo_height=height,
                    eye_height_m=vantage.height_m, footway_offset_m=vantage.lateral_m,
                )
                pose = wearer_pose(float(station), profile, 0.0)
            else:
                eye = np.array([float(station), vantage.lateral_m, vantage.height_m])
                target = np.array([float(station) + 40.0, 1.0, vantage.height_m * 0.8])
                pose = Pose.look_at(eye, target)
            frames.append(
                (
                    f"{vantage.name}-{i:05d}",
                    render_meshes(triangles, colours, pose, k, width, height),
                    pose,
                )
            )

        partial, report = seed_index(
            frames,
            corridor.origin,  # type: ignore[attr-defined]
            config=config,
            descriptor_model=descriptor_model,
            seed=seed,
        )
        for frame in partial._frames:
            index.add(frame)
        reports[vantage.name] = report

    return index, reports
