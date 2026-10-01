"""Surfaces kept as surfaces: whatever the other families cannot represent to tolerance.

A sculpture, a rock, an ornate bench end, a decorated bracket -- the honest representation
of something irregular is its measured surface, not the nearest shape in a catalogue. This
module turns fused surface points into a closed mesh:

1. the points are binned into voxels; gaps a voxel or two wide are closed, because a scan
   always misses some of the surface it saw;
2. everything not reachable from outside is filled, so the shell becomes a solid;
3. the boundary of the solid is extracted with naive surface nets (one vertex per boundary
   cell, one quad per boundary face) -- watertight by construction;
4. the vertices are relaxed within their own cells, which rounds the voxel steps off without
   ever letting the surface move more than a cell from where the evidence put it.

numpy only: there is no marching-cubes or morphology library in this environment, and none
of the four steps needs one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np

from smc.geometry.base import (
    GeometryFamily,
    Param,
    TriMesh,
    params_from_json,
    params_json,
    register,
)


@register
@dataclass(frozen=True)
class FreeformMesh:
    """A reconstructed surface, as measured."""

    family: ClassVar[GeometryFamily] = GeometryFamily.FREEFORM_MESH

    mesh: TriMesh
    params: dict[str, Param] = field(default_factory=dict)

    def to_mesh(self) -> TriMesh:
        return self.mesh

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        return self.mesh.bounds()

    def to_json(self) -> dict[str, Any]:
        return {"mesh": self.mesh.to_json(), "params": params_json(self.params)}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> FreeformMesh:
        return cls(TriMesh.from_json(data["mesh"]), params_from_json(data.get("params")))


def _shift(grid: np.ndarray, axis: int, step: int) -> np.ndarray:
    out = np.zeros_like(grid)
    src = [slice(None)] * 3
    dst = [slice(None)] * 3
    if step > 0:
        src[axis], dst[axis] = slice(None, -step), slice(step, None)
    else:
        src[axis], dst[axis] = slice(-step, None), slice(None, step)
    out[tuple(dst)] = grid[tuple(src)]
    return out


def _dilate(grid: np.ndarray) -> np.ndarray:
    out = grid.copy()
    for axis in range(3):
        out |= _shift(grid, axis, 1) | _shift(grid, axis, -1)
    return out


def _erode(grid: np.ndarray) -> np.ndarray:
    out = grid.copy()
    for axis in range(3):
        out &= _shift(grid, axis, 1) & _shift(grid, axis, -1)
    return out


def _fill_interior(solid: np.ndarray) -> np.ndarray:
    """Everything the outside cannot reach is inside."""
    outside = np.zeros_like(solid)
    outside[0, :, :] = outside[-1, :, :] = True
    outside[:, 0, :] = outside[:, -1, :] = True
    outside[:, :, 0] = outside[:, :, -1] = True
    outside &= ~solid
    while True:
        grown = _dilate(outside) & ~solid
        if (grown == outside).all():
            return ~outside
        outside = grown


def voxelise(points: np.ndarray, voxel_m: float, close_iterations: int = 2
             ) -> tuple[np.ndarray, np.ndarray]:
    """A solid occupancy grid from surface points, and the grid's origin (world metres)."""
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    margin = close_iterations + 2
    origin = pts.min(axis=0) - margin * voxel_m
    idx = np.floor((pts - origin) / voxel_m).astype(np.int64)
    shape = idx.max(axis=0) + margin + 1
    grid = np.zeros(tuple(int(s) for s in shape), dtype=bool)
    grid[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    closed = grid
    for _ in range(close_iterations):
        closed = _dilate(closed)
    for _ in range(close_iterations):
        closed = _erode(closed)
    return _fill_interior(closed | grid), origin


def surface_nets(solid: np.ndarray, origin: np.ndarray, voxel_m: float,
                 relax_iterations: int = 6) -> TriMesh:
    """Watertight boundary of a voxel solid: one vertex per boundary cell, one quad per face.

    A *cell* is the cube between eight voxel centres; a boundary cell has both inside and
    outside corners. Its vertex starts at the mean of the midpoints of its crossing edges.
    """
    g = np.pad(solid, 1)
    nx, ny, nz = g.shape
    corners = [g[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k]
               for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    total = np.sum([c.astype(np.int8) for c in corners], axis=0)
    active = (total > 0) & (total < 8)
    cell_index = np.full(active.shape, -1, dtype=np.int64)
    cells = np.argwhere(active)
    cell_index[tuple(cells.T)] = np.arange(len(cells))
    # Vertex: mean of crossing-edge midpoints, in cell-local coordinates (0..1 per axis).
    offsets = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    sums = np.zeros((len(cells), 3))
    counts = np.zeros(len(cells))
    lookup = {o: n for n, o in enumerate(offsets)}
    for a, oa in enumerate(offsets):
        for axis in range(3):
            if oa[axis] == 1:
                continue
            ob = list(oa)
            ob[axis] = 1
            b = lookup[tuple(ob)]
            crossing = (corners[a] != corners[b])[tuple(cells.T)]
            midpoint = np.array(oa, dtype=np.float64)
            midpoint[axis] = 0.5
            sums[crossing] += midpoint
            counts[crossing] += 1
    local = sums / np.maximum(counts[:, None], 1)
    vertices = cells + local  # cell (i,j,k) spans padded voxel centres i..i+1
    quads: list[np.ndarray] = []
    for axis in range(3):
        b_axis, c_axis = (axis + 1) % 3, (axis + 2) % 3
        lower = g
        upper = np.roll(g, -1, axis=axis)
        differ = lower != upper
        # Only edges whose four surrounding cells all exist.
        valid = np.zeros_like(differ)
        sl = [slice(1, n - 1) for n in g.shape]
        sl[axis] = slice(0, g.shape[axis] - 1)
        valid[tuple(sl)] = True
        edges = np.argwhere(differ & valid)
        if not len(edges):
            continue
        ring = []
        for db, dc in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            cell = edges.copy()
            cell[:, b_axis] += db
            cell[:, c_axis] += dc
            ring.append(cell_index[tuple(cell.T)])
        quad = np.column_stack(ring)
        inside_low = g[tuple(edges.T)]
        quad[~inside_low] = quad[~inside_low][:, ::-1]
        quads.append(quad[(quad >= 0).all(axis=1)])
    if not quads:
        return TriMesh(np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64))
    quad = np.concatenate(quads)
    faces = np.concatenate([quad[:, [0, 1, 2]], quad[:, [0, 2, 3]]])
    # Relax: each vertex toward its neighbours' mean, never leaving its own cell.
    neighbours: list[set[int]] = [set() for _ in range(len(vertices))]
    for a, b, c in faces:
        neighbours[a].update((b, c))
        neighbours[b].update((a, c))
        neighbours[c].update((a, b))
    lo = cells.astype(np.float64)
    hi = lo + 1.0
    for _ in range(relax_iterations):
        mean = np.array([vertices[list(nb)].mean(axis=0) if nb else vertices[i]
                         for i, nb in enumerate(neighbours)])
        vertices = np.clip(0.5 * vertices + 0.5 * mean, lo, hi)
    # Padded voxel centre i sits at origin + (i - 1 + 0.5) * voxel.
    world = origin + (vertices - 0.5) * voxel_m
    return TriMesh(world, faces).without_degenerate_faces().with_normals()


def reconstruct_surface(points: np.ndarray, voxel_m: float = 0.04) -> TriMesh:
    """Closed mesh of the surface the points were measured on."""
    solid, origin = voxelise(points, voxel_m)
    return surface_nets(solid, origin, voxel_m)


def boundary_edges(mesh: TriMesh) -> int:
    """Edges used by exactly one face: zero for a closed surface."""
    f = mesh.faces
    edges = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return int((counts == 1).sum())
