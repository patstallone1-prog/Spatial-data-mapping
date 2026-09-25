"""Small deterministic GLB compiler for visual-only cell meshes."""

from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

import numpy as np

from smc.reconstruction.geo import EnuFrame


def _pad(blob: bytes, fill: bytes = b"\x00") -> bytes:
    return blob + fill * (-len(blob) % 4)


def write_visual_glb(path: Path, positions: np.ndarray, normals: np.ndarray,
                     faces: np.ndarray, *, cell_id: str,
                     texcoords: np.ndarray | None = None,
                     base_colour_ktx2: bytes | None = None) -> int:
    """Write glTF 2.0 GLB, optionally with a KTX2 base-colour map.

    The later optimization pass adds EXT_meshopt_compression.  This writer itself
    does not claim that extension or fabricate textures.
    """
    vertices = np.asarray(positions, dtype="<f4")
    vertex_normals = np.asarray(normals, dtype="<f4")
    triangles = np.asarray(faces, dtype="<u4")
    if vertices.ndim != 2 or vertices.shape[1] != 3 or not np.isfinite(vertices).all():
        raise ValueError("positions must be finite Nx3 float32")
    if vertex_normals.shape != vertices.shape or not np.isfinite(vertex_normals).all():
        raise ValueError("normals must match positions")
    if triangles.ndim != 2 or triangles.shape[1] != 3 or triangles.size == 0:
        raise ValueError("faces must be nonempty Mx3 indices")
    if triangles.max() >= len(vertices):
        raise ValueError("face index exceeds vertices")
    if base_colour_ktx2 is not None and texcoords is None:
        raise ValueError("textured meshes need UV coordinates")
    if texcoords is not None and np.asarray(texcoords).shape != (len(vertices), 2):
        raise ValueError("UV coordinates must match vertices")

    binary = bytearray()
    views = []
    accessors = []

    def add_view(blob: bytes, target: int | None = None) -> int:
        offset = len(binary)
        binary.extend(_pad(blob))
        view: dict[str, int] = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob)}
        if target is not None:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    def add_accessor(view: int, count: int, component: int, kind: str,
                     minimum: list[float] | None = None,
                     maximum: list[float] | None = None) -> int:
        accessor: dict = {"bufferView": view, "componentType": component,
                          "count": count, "type": kind}
        if minimum is not None:
            accessor["min"] = minimum
            accessor["max"] = maximum
        accessors.append(accessor)
        return len(accessors) - 1

    position_view = add_view(vertices.tobytes(), 34962)
    normal_view = add_view(vertex_normals.tobytes(), 34962)
    face_view = add_view(triangles.tobytes(), 34963)
    attrs = {
        "POSITION": add_accessor(position_view, len(vertices), 5126, "VEC3",
                                 vertices.min(axis=0).astype(float).tolist(),
                                 vertices.max(axis=0).astype(float).tolist()),
        "NORMAL": add_accessor(normal_view, len(vertices), 5126, "VEC3"),
    }
    if texcoords is not None:
        uv = np.asarray(texcoords, dtype="<f4")
        attrs["TEXCOORD_0"] = add_accessor(add_view(uv.tobytes(), 34962), len(uv), 5126, "VEC2")
    indices = add_accessor(face_view, triangles.size, 5125, "SCALAR")
    document = {
        "asset": {"version": "2.0", "generator": "Kerbside visual-cell compiler"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": f"visual:{cell_id}",
                   "extras": {"cell_id": cell_id, "collision": False}}],
        "meshes": [{"primitives": [{"attributes": attrs, "indices": indices, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.6, 0.6, 0.6, 1.0],
                                                "metallicFactor": 0.0, "roughnessFactor": 0.9}}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views, "accessors": accessors,
    }
    if base_colour_ktx2 is not None:
        if not base_colour_ktx2.startswith(b"\xabKTX 20\xbb\r\n\x1a\n"):
            raise ValueError("base-colour payload is not KTX2")
        image_view = add_view(base_colour_ktx2)
        document["buffers"][0]["byteLength"] = len(binary)
        document["extensionsUsed"] = ["KHR_texture_basisu"]
        document["extensionsRequired"] = ["KHR_texture_basisu"]
        document["images"] = [{"mimeType": "image/ktx2", "bufferView": image_view}]
        document["textures"] = [{"extensions": {"KHR_texture_basisu": {"source": 0}}}]
        document["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
    json_chunk = _pad(json.dumps(document, separators=(",", ":")).encode(), b" ")
    binary_chunk = bytes(binary)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary_chunk)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        fh.write(struct.pack("<4sII", b"glTF", 2, total))
        fh.write(struct.pack("<I4s", len(json_chunk), b"JSON"))
        fh.write(json_chunk)
        fh.write(struct.pack("<I4s", len(binary_chunk), b"BIN\x00"))
        fh.write(binary_chunk)
    return total


def inspect_glb(path: Path) -> dict:
    with path.open("rb") as fh:
        magic, version, length = struct.unpack("<4sII", fh.read(12))
        if magic != b"glTF" or version != 2 or length != path.stat().st_size:
            raise ValueError("invalid GLB header")
        chunk_length, chunk_type = struct.unpack("<I4s", fh.read(8))
        if chunk_type != b"JSON":
            raise ValueError("GLB lacks JSON chunk")
        return json.loads(fh.read(chunk_length))


def massing_from_buildings(ways: list[dict[str, Any]],
                          bbox: tuple[float, float, float, float],
                          frame: EnuFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Visual LOD0 boxes, owned by the cell containing each building centroid."""
    vertices: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []

    def quad(corners: list[tuple[float, float, float]]) -> None:
        base = len(vertices)
        a, b, c, _ = (np.asarray(point, dtype=np.float64) for point in corners)
        normal = np.cross(b - a, c - a)
        normal /= max(float(np.linalg.norm(normal)), 1e-12)
        vertices.extend(corners)
        normals.extend([tuple(normal)] * 4)
        faces.extend(((base, base + 1, base + 2), (base, base + 2, base + 3)))

    for way in ways:
        if way.get("kind") != "building" or not way.get("points"):
            continue
        centroid = way.get("centroid")
        if not centroid or not (bbox[0] <= centroid[0] < bbox[2]
                                and bbox[1] <= centroid[1] < bbox[3]):
            continue
        ring = np.array([frame.to_enu(float(lon), float(lat), 0.0)[:2]
                         for lon, lat in way["points"]], dtype=np.float64)
        if len(ring) < 3 or not np.isfinite(ring).all():
            continue
        ring -= ring.mean(axis=0)
        _, _, vt = np.linalg.svd(ring, full_matrices=False)
        axes = vt.T
        local = ring @ axes
        lo, hi = local.min(axis=0), local.max(axis=0)
        if np.prod(hi - lo) < 4.0:
            continue
        centre = np.array(frame.to_enu(float(centroid[0]), float(centroid[1]), 0.0)[:2])
        # The centroid may not equal the mean of the ring (a concave footprint).
        original_mean = np.mean([frame.to_enu(float(lon), float(lat), 0.0)[:2]
                                 for lon, lat in way["points"]], axis=0)
        corners_2d = np.array([[lo[0], lo[1]], [hi[0], lo[1]],
                               [hi[0], hi[1]], [lo[0], hi[1]]]) @ axes.T + original_mean
        del centre
        height = max(3.0, min(300.0, float(way.get("height_m") or 10.5)))
        bottom = [(float(x), float(y), 0.0) for x, y in corners_2d]
        top = [(float(x), float(y), height) for x, y in corners_2d]
        for i in range(4):
            j = (i + 1) % 4
            quad([bottom[i], bottom[j], top[j], top[i]])
        quad(top)
    if not faces:
        raise ValueError("cell has no buildings for LOD0 massing")
    return np.asarray(vertices, dtype=np.float32), np.asarray(normals, dtype=np.float32), \
        np.asarray(faces, dtype=np.uint32)
