"""The world-mesh tile pyramid: every triangle kept at the leaves, parents bounded, all decodable."""
import io
import json

import numpy as np
import pytest

pytest.importorskip("meshoptimizer")

from smc.reconstruction.geo import EnuFrame
from smc.worldmesh.tiles import Mesh, build_pyramid, read_tile, tile_mesh

FRAME = EnuFrame(-122.4194, 37.7749, 10.0)


def street(n: int = 300, size: float = 120.0) -> Mesh:
    """A rolling street-sized surface with a kerb step: n x n squares, two triangles each."""
    xs = np.linspace(0, size, n + 1)
    gx, gy = np.meshgrid(xs, xs * 0.8)
    gz = 0.6 * np.sin(gx / 9.0) * np.cos(gy / 13.0) + np.where(gx > size / 2, 0.15, 0.0)
    positions = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    i = np.arange(n * (n + 1)).reshape(n, n + 1)[:, :n].ravel()
    a, b, c, d = i, i + 1, i + n + 1, i + n + 2
    faces = np.vstack([np.stack([a, b, d], 1), np.stack([a, d, c], 1)])
    colours = np.clip(np.stack([gx.ravel() * 2, gy.ravel() * 2, 128 + 0 * gx.ravel()], 1), 0, 255)
    return Mesh(positions, faces, colours.astype(np.uint8))


def test_leaves_hold_every_triangle_exactly(tmp_path):
    mesh = street()
    summary = tile_mesh(mesh, tmp_path, FRAME, block="test", leaf_triangles=30_000, parent_triangles=20_000)
    leaves = [r for r in summary["rows"] if r["leaf"]]
    assert summary["leaf_triangles"] == len(mesh.faces)
    assert len(leaves) >= 4 and summary["levels"] >= 2
    # Decoded leaves give back the master's triangles, to the recorded rounding.
    assert summary["max_rounding_m"] < 0.002
    centroids = []
    for row in leaves:
        tile = read_tile((tmp_path / row["uri"]).read_bytes())
        assert len(tile["faces"]) == row["triangles"]
        centroids.append(tile["positions"][tile["faces"]].mean(axis=1))
    from scipy.spatial import cKDTree

    got = np.vstack(centroids)
    want = mesh.positions[mesh.faces].mean(axis=1)
    distance, match = cKDTree(want).query(got)
    assert distance.max() < 0.002
    assert len(np.unique(match)) == len(want)  # one decoded triangle for every master triangle


def test_parents_are_bounded_and_measured(tmp_path):
    summary = tile_mesh(street(), tmp_path, FRAME, block="test", leaf_triangles=30_000, parent_triangles=20_000)
    parents = [r for r in summary["rows"] if not r["leaf"]]
    assert parents
    for row in parents:
        assert row["triangles"] <= 20_000 * 1.5
        assert row["error_m"] > 0  # measured by the simplifier, never zero for a reduced tile
    tileset = json.loads((tmp_path / "tileset.json").read_text())
    assert tileset["asset"]["version"] == "1.1" and len(tileset["root"]["transform"]) == 16
    # Errors fall towards the leaves, which are exact.
    def walk(node, parent_error):
        assert node["geometricError"] <= parent_error + 1e-9
        for child in node.get("children", []):
            walk(child, node["geometricError"])
        if "children" not in node:
            assert node["geometricError"] == 0
    walk(tileset["root"], tileset["geometricError"])


def test_textured_leaves_keep_the_pictures_byte_for_byte(tmp_path):
    from PIL import Image

    mesh = street(40)
    picture = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 40, 40)).save(picture, format="PNG")
    span = mesh.positions[:, :2].max(axis=0)
    textured = Mesh(mesh.positions, mesh.faces, uvs=mesh.positions[:, :2] / span, textures=[picture.getvalue()])
    summary = tile_mesh(textured, tmp_path, FRAME, block="test")
    (row,) = summary["rows"]
    blob = (tmp_path / row["uri"]).read_bytes()
    assert picture.getvalue() in blob
    tile = read_tile(blob)
    assert np.abs(np.sort(tile["uvs"].ravel()) - np.sort(textured.uvs.ravel())).max() < 1 / 65535 + 1e-9


def test_a_dense_block_still_splits(tmp_path):
    root = build_pyramid(street(200), leaf_triangles=5_000, parent_triangles=5_000)
    def depth(tile):
        return 1 + max((depth(c) for c in tile.children), default=0)
    assert depth(root) >= 3
