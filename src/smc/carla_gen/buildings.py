"""Building facades along a corridor.

Not scenery. The re-spec's Step 3 anchors a capture by matching *fixed features* — building
corners, storefront edges, signs — against a reference. A simulated street with no buildings
gives the anchoring stack nothing of the kind to match, so any result measured against it would
be meaningless, and the frame would be mostly sky besides.

Facades are what make the simulation exercise the load-bearing step rather than route around it.
They also supply the occlusion that makes retrieval hard in the way real streets are hard:
repeating window bands are exactly the structure that produces perceptual aliasing.

Geometry is deliberately coarse — boxes with recessed window bands. The pipeline needs corners
and planar surfaces at believable scale, not architecture.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from smc.carla_gen.distributions import rng_for


@dataclass(frozen=True, slots=True)
class Facade:
    """One building frontage along the block."""

    start_m: float
    length_m: float
    height_m: float
    #: Distance from the kerb line to the building face.
    setback_m: float
    storey_height_m: float
    window_inset_m: float

    @property
    def storeys(self) -> int:
        return max(1, int(self.height_m / self.storey_height_m))


def sample_facades(
    world_seed: int,
    block_id: str,
    block_length_m: float,
    walk_edge_m: float,
) -> tuple[Facade, ...]:
    """Sample the frontages on one block face.

    Identity-seeded like everything else, so a second pass renders the same street.
    """
    rng = rng_for(world_seed, "facades", block_id)
    facades: list[Facade] = []
    cursor = 0.0
    while cursor < block_length_m - 4.0:
        width = float(rng.uniform(7.0, 26.0))
        width = min(width, block_length_m - cursor)
        # A gap is an alley or a vacant lot; both exist and both change the skyline.
        if rng.random() < 0.12:
            cursor += width
            continue
        storey = float(rng.uniform(3.1, 4.4))
        facades.append(
            Facade(
                start_m=cursor,
                length_m=width,
                height_m=float(rng.uniform(1, 8)) * storey,
                setback_m=walk_edge_m + float(rng.uniform(0.0, 2.5)),
                storey_height_m=storey,
                window_inset_m=float(rng.uniform(0.06, 0.22)),
            )
        )
        cursor += width
    return tuple(facades)


def facade_triangles(facade: Facade, offset_m: float = 0.0) -> np.ndarray:
    """Triangles for one facade: the front face plus recessed window bands.

    Window bands are recessed rather than painted on, so they cast the shading discontinuities
    a corner detector keys on. A flat coloured rectangle would look like a window and behave
    like nothing.
    """
    x0 = facade.start_m + offset_m
    x1 = x0 + facade.length_m
    y = facade.setback_m
    tris: list[list[list[float]]] = []

    def quad(p0, p1, p2, p3) -> None:
        tris.append([p0, p1, p2])
        tris.append([p0, p2, p3])

    quad(
        [x0, y, 0.0],
        [x1, y, 0.0],
        [x1, y, facade.height_m],
        [x0, y, facade.height_m],
    )

    inset = y + facade.window_inset_m
    for level in range(1, facade.storeys):
        z0 = level * facade.storey_height_m + 0.9
        z1 = z0 + 1.5
        if z1 > facade.height_m:
            break
        margin = 0.8
        quad(
            [x0 + margin, inset, z0],
            [x1 - margin, inset, z0],
            [x1 - margin, inset, z1],
            [x0 + margin, inset, z1],
        )

    # A return wall at each end gives the vertical corner that anchoring actually locks onto.
    for x in (x0, x1):
        quad([x, y, 0.0], [x, y + 1.2, 0.0], [x, y + 1.2, facade.height_m], [x, y, facade.height_m])

    return np.array(tris, dtype=np.float64)


def corridor_facades(corridor: object) -> tuple[np.ndarray, np.ndarray]:
    """Every facade triangle in a corridor, with per-triangle colours."""
    tris: list[np.ndarray] = []
    cols: list[np.ndarray] = []
    for cs in corridor.segments:  # type: ignore[attr-defined]
        walk_edge = 0.45 + cs.segment.total_width_m
        facades = sample_facades(
            corridor.world_seed,  # type: ignore[attr-defined]
            cs.segment.segment_id,
            cs.segment.length_m,
            walk_edge,
        )
        rng = rng_for(corridor.world_seed, "facade_colour", cs.segment.segment_id)  # type: ignore[attr-defined]
        for facade in facades:
            block = facade_triangles(facade, offset_m=cs.start_station_m)
            tris.append(block)
            base = rng.uniform([110, 96, 88], [205, 190, 176])
            cols.append(np.tile(base, (len(block), 1)))
    if not tris:
        return np.zeros((0, 3, 3)), np.zeros((0, 3))
    return np.vstack(tris), np.vstack(cols)
