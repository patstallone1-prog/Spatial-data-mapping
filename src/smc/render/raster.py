"""A z-buffered triangle rasteriser.

CARLA renders far better images than this, and needs a source build, an Unreal content package,
and a GPU before it renders anything at all. This exists so the capture and compositing layers
can be exercised end to end today, on any machine, in CI: real image files, real pixel data,
real correspondences, with geometry that is exactly known because it was generated.

The one non-obvious property, and the one that makes the output usable at all:

**Surface detail is keyed on world position, not screen position.** Every shaded pixel hashes
its interpolated 3D world coordinate into a deterministic value. The same physical square
centimetre of kerb therefore produces the same appearance from any viewpoint, which is exactly
the invariant real feature matching relies on. Screen-space noise would look identical to a
human and be worthless to a matcher, because nothing would correspond between two views.

Interpolation is perspective-correct for the same reason: affine interpolation across a steeply
foreshortened kerb would slide the texture between viewpoints and quietly break correspondence.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from smc.mapping.pose import Pose

#: Direction the scene is lit from, world frame. Fixed so renders are reproducible.
LIGHT_DIRECTION = np.array([0.35, -0.5, 0.79])
SKY_COLOUR = np.array([168.0, 186.0, 208.0])
ROAD_COLOUR = np.array([74.0, 74.0, 78.0])
WALK_COLOUR = np.array([166.0, 163.0, 152.0])
KERB_COLOUR = np.array([150.0, 147.0, 138.0])


@dataclass(frozen=True, slots=True)
class RenderResult:
    """A rendered view and the buffers that make it useful as training or test data."""

    image: np.ndarray  # (H, W, 3) uint8
    depth: np.ndarray  # (H, W) float64, inf where nothing was hit
    #: World coordinate seen at each pixel; NaN where nothing was hit.
    world: np.ndarray  # (H, W, 3) float64

    @property
    def coverage(self) -> float:
        """Fraction of the frame showing geometry rather than sky."""
        return float(np.isfinite(self.depth).mean())

    def sample_correspondences(
        self, k: np.ndarray, count: int, rng: np.random.Generator
    ) -> tuple[np.ndarray, np.ndarray]:
        """Draw (world_point, pixel) pairs from surfaces actually visible in this view.

        This is what seeds a reference frame. Sampling from the depth buffer rather than from
        the mesh guarantees every correspondence is genuinely visible — occluded points would
        otherwise poison PnP with correspondences no camera could have observed.
        """
        ys, xs = np.nonzero(np.isfinite(self.depth))
        if len(ys) == 0:
            return np.zeros((0, 3)), np.zeros((0, 2))
        take = min(count, len(ys))
        idx = rng.choice(len(ys), size=take, replace=False)
        pixels = np.c_[xs[idx].astype(np.float64), ys[idx].astype(np.float64)]
        return self.world[ys[idx], xs[idx]], pixels


def _surface_detail(world: np.ndarray) -> np.ndarray:
    """Deterministic per-position detail in [0, 1], keyed on world coordinates.

    Two properties are load-bearing and they pull in opposite directions.

    *View consistency*: detail is a function of the 3D world position, so the same square
    centimetre of kerb looks the same from any viewpoint. Screen-space noise would look
    identical to a person and be worthless to a matcher, because nothing would correspond
    between two views.

    *Distinctiveness*: an earlier version used two octaves on a regular lattice, and it was
    pathologically repetitive. SIFT found plenty of keypoints and then Lowe's ratio test threw
    almost all of them away, exactly as it should — every descriptor had a dozen equally good
    matches elsewhere in the frame. Measured: 12 matches between rig frames six metres apart.
    Five octaves at irrational frequency ratios, with a decorrelating rotation between them,
    removes the repeat period that was manufacturing the ambiguity.

    Even so, synthetic texture validating a real matcher is close to circular. This makes the
    simulator a fair test of the *pipeline*; only real photographs test the matcher.
    """
    detail = np.zeros(world.shape[:-1])
    total_weight = 0.0
    # Irrational-ish ratios so octaves do not share a common period.
    frequencies = (3.1, 7.3, 17.9, 41.7, 97.1)
    rotation = np.array(
        [
            [0.8047, -0.5928, 0.0234],
            [0.5936, 0.8041, -0.0311],
            [-0.0018, 0.0389, 0.9992],
        ]
    )
    sample = world
    for octave, frequency in enumerate(frequencies):
        weight = 0.62**octave
        cell = np.floor(sample * frequency)
        h = (
            cell[..., 0] * 127.1 + cell[..., 1] * 311.7 + cell[..., 2] * 74.7
        ) * (1.0 + 0.37 * octave)
        h = np.sin(h) * 43758.5453
        detail += weight * (h - np.floor(h))
        total_weight += weight
        sample = sample @ rotation
    return detail / total_weight


def render_meshes(
    triangles: np.ndarray,
    colours: np.ndarray,
    pose: Pose,
    k: np.ndarray,
    width: int,
    height: int,
) -> RenderResult:
    """Rasterise triangles into an image, depth buffer and world-position buffer.

    ``triangles`` is (N, 3, 3) in world coordinates; ``colours`` is (N, 3) base RGB.
    """
    if triangles.ndim != 3 or triangles.shape[1:] != (3, 3):
        raise ValueError(f"triangles must be (N, 3, 3), got {triangles.shape}")
    if len(colours) != len(triangles):
        raise ValueError("colours and triangles must have the same length")

    image = np.tile(SKY_COLOUR, (height, width, 1))
    depth = np.full((height, width), np.inf)
    world_buffer = np.full((height, width, 3), np.nan)

    cam = pose.transform(triangles.reshape(-1, 3)).reshape(-1, 3, 3)
    # Drop triangles with any vertex at or behind the image plane rather than clipping them.
    # Clipping would be correct; at these framings the difference is a sliver at the edge.
    visible = np.all(cam[:, :, 2] > 0.05, axis=1)
    if not visible.any():
        return RenderResult(image.astype(np.uint8), depth, world_buffer)

    cam = cam[visible]
    tris = triangles[visible]
    base_colours = colours[visible]

    inv_z = 1.0 / cam[:, :, 2]
    screen = np.einsum("ij,nkj->nki", np.asarray(k, dtype=np.float64), cam * inv_z[:, :, None])
    xy = screen[:, :, :2]

    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.where(lengths == 0, 1.0, lengths)
    light = np.abs(normals @ LIGHT_DIRECTION)
    shading = 0.55 + 0.45 * light

    # Painter's order is not enough with interpenetrating geometry, so a real z-buffer is used;
    # sorting far-to-near only reduces overdraw.
    order = np.argsort(-cam[:, :, 2].mean(axis=1))

    for i in order:
        v = xy[i]
        min_x = max(int(np.floor(v[:, 0].min())), 0)
        max_x = min(int(np.ceil(v[:, 0].max())), width - 1)
        min_y = max(int(np.floor(v[:, 1].min())), 0)
        max_y = min(int(np.ceil(v[:, 1].max())), height - 1)
        if min_x > max_x or min_y > max_y:
            continue

        px, py = np.meshgrid(
            np.arange(min_x, max_x + 1, dtype=np.float64),
            np.arange(min_y, max_y + 1, dtype=np.float64),
        )
        area = (v[1, 0] - v[0, 0]) * (v[2, 1] - v[0, 1]) - (v[2, 0] - v[0, 0]) * (v[1, 1] - v[0, 1])
        if abs(area) < 1e-12:
            continue

        w0 = ((v[1, 0] - px) * (v[2, 1] - py) - (v[2, 0] - px) * (v[1, 1] - py)) / area
        w1 = ((v[2, 0] - px) * (v[0, 1] - py) - (v[0, 0] - px) * (v[2, 1] - py)) / area
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue

        # Perspective-correct interpolation: blend 1/z, then divide through.
        z_recip = w0 * inv_z[i, 0] + w1 * inv_z[i, 1] + w2 * inv_z[i, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            pixel_z = 1.0 / z_recip
        inside &= np.isfinite(pixel_z) & (pixel_z > 0)
        if not inside.any():
            continue

        window = depth[min_y : max_y + 1, min_x : max_x + 1]
        nearer = inside & (pixel_z < window)
        if not nearer.any():
            continue

        weights = np.stack(
            [w0 * inv_z[i, 0], w1 * inv_z[i, 1], w2 * inv_z[i, 2]], axis=-1
        ) / z_recip[..., None]
        world = weights @ tris[i]

        detail = _surface_detail(world)
        shade = shading[i] * (0.82 + 0.36 * detail)
        rgb = np.clip(base_colours[i] * shade[..., None], 0, 255)

        window[nearer] = pixel_z[nearer]
        image[min_y : max_y + 1, min_x : max_x + 1][nearer] = rgb[nearer]
        world_buffer[min_y : max_y + 1, min_x : max_x + 1][nearer] = world[nearer]

    return RenderResult(image.astype(np.uint8), depth, world_buffer)


def subdivide(triangles: np.ndarray, max_edge_m: float = 4.0, max_passes: int = 18) -> np.ndarray:
    """Split triangles until no edge exceeds ``max_edge_m``.

    Necessary because the rasteriser culls any triangle with a vertex behind the image plane
    rather than clipping it. For small triangles that costs a sliver at the frame edge; for a
    ground plane built from two 220 m triangles it costs the entire road, since one corner is
    always behind the camera. Subdividing bounds the error to ``max_edge_m`` of frame edge and
    keeps the renderer simple.

    Each pass splits only the longest edge of each oversized triangle, so convergence takes
    roughly ``log2(longest / max_edge)`` passes *per edge that needs splitting* — a 220 m road
    slab needs twelve, not the six that looks sufficient. Too few passes fails silently and
    invisibly: the road simply is not drawn near the camera, which reads as a rendering bug
    somewhere else entirely.
    """
    for _ in range(max_passes):
        edges = np.stack(
            [
                np.linalg.norm(triangles[:, 1] - triangles[:, 0], axis=1),
                np.linalg.norm(triangles[:, 2] - triangles[:, 1], axis=1),
                np.linalg.norm(triangles[:, 0] - triangles[:, 2], axis=1),
            ],
            axis=1,
        )
        if edges.max(initial=0.0) <= max_edge_m:
            break
        longest = np.argmax(edges, axis=1)
        keep = edges.max(axis=1) <= max_edge_m
        out = [triangles[keep]]
        for corner in range(3):
            selected = triangles[~keep & (longest == corner)]
            if not len(selected):
                continue
            a = selected[:, corner]
            b = selected[:, (corner + 1) % 3]
            c = selected[:, (corner + 2) % 3]
            mid = (a + b) / 2.0
            out.append(np.stack([a, mid, c], axis=1))
            out.append(np.stack([mid, b, c], axis=1))
        triangles = np.vstack(out)
    return triangles


def _subdivide_with_colours(
    triangles: np.ndarray, colour: np.ndarray, max_edge_m: float = 4.0
) -> tuple[np.ndarray, np.ndarray]:
    """Subdivide a uniformly coloured batch, keeping colours aligned."""
    divided = subdivide(triangles, max_edge_m)
    return divided, np.tile(colour, (len(divided), 1))


def corridor_triangles(
    corridor: object, *, road_width_m: float = 9.0
) -> tuple[np.ndarray, np.ndarray]:
    """Flatten a corridor's meshes into triangles plus per-triangle colours.

    A road slab is added underneath. Without it the kerb has nothing to rise from, and the
    ground-plane fitting that metric scale depends on would have no plane to find.
    """
    from smc.carla_gen.buildings import corridor_facades
    from smc.carla_gen.world import build_meshes

    tris: list[np.ndarray] = []
    cols: list[np.ndarray] = []

    for mesh in build_meshes(corridor):  # type: ignore[arg-type]
        verts = mesh.vertices[mesh.faces]
        tris.append(verts)
        # Vertical faces are the kerb; near-horizontal ones are the walking surface.
        normals = np.cross(verts[:, 1] - verts[:, 0], verts[:, 2] - verts[:, 0])
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = normals / np.where(lengths == 0, 1.0, lengths)
        vertical = np.abs(normals[:, 2]) < 0.5
        cols.append(np.where(vertical[:, None], KERB_COLOUR, WALK_COLOUR))

    facade_tris, facade_cols = corridor_facades(corridor)
    for triangle, colour in zip(facade_tris, facade_cols, strict=True):
        divided, divided_colours = _subdivide_with_colours(triangle[None, ...], colour)
        tris.append(divided)
        cols.append(divided_colours)

    length = float(getattr(corridor, "length_m", 100.0))
    # The ground plane runs from the far kerb to behind the building line. Stopping it at the
    # kerb leaves the setback strip empty, and empty renders as sky, which puts a band of
    # horizon in the middle of a street scene and gives a matcher a hard edge that is not there.
    def slab(y0: float, y1: float, z: float) -> np.ndarray:
        return np.array(
            [
                [[0.0, y0, z], [length, y0, z], [length, y1, z]],
                [[0.0, y0, z], [length, y1, z], [0.0, y1, z]],
            ]
        )

    road = slab(-road_width_m, 0.0, -0.02)
    backlot = slab(0.0, 18.0, -0.05)
    backlot_divided, backlot_colours = _subdivide_with_colours(backlot, WALK_COLOUR * 0.82)
    tris.append(backlot_divided)
    cols.append(backlot_colours)

    road_divided, road_colours = _subdivide_with_colours(road, ROAD_COLOUR)
    tris.append(road_divided)
    cols.append(road_colours)

    return np.vstack(tris), np.vstack(cols)


def render_corridor(
    corridor: object,
    pose: Pose,
    k: np.ndarray,
    width: int = 640,
    height: int = 400,
) -> RenderResult:
    """Render a simulated corridor from a camera pose."""
    triangles, colours = corridor_triangles(corridor)
    return render_meshes(triangles, colours, pose, k, width, height)
