"""A measured mesh cut into a tile pyramid: every triangle kept at the finest level, compressed.

Any mesh in a block's local metric frame (east, north, up in metres from an origin on the
ellipsoid) goes in; a directory of GLB tiles and a 3D Tiles 1.1 ``tileset.json`` comes out,
with a manifest of our own beside it. The same code serves one house or a whole cell: a block
is only a rectangle and an origin.

**Nothing is lost at the finest level.** A leaf holds every triangle of the master mesh whose
centroid falls in it -- whole, never clipped, never decimated -- so the leaves together are the
master mesh exactly, triangle for triangle. Positions are stored as 16-bit integers across the
tile's own box (KHR_mesh_quantization): the step is the tile's extent over 65,535, under two
millimetres for a 125 m tile and finer for smaller ones, and the largest rounding in each tile is
measured and recorded. Photogrammetry is good to centimetres at best, so the rounding is two
orders of magnitude below what the mesh can know. Texture coordinates get the same 16 bits
across the unit square (an 8,192-pixel page is addressed to an eighth of a texel). Textures are
the master's own pictures, byte for byte.

**Efficient everywhere above it.** A parent tile is its children merged and simplified with
meshoptimizer to about one leaf's worth of triangles, its open borders locked so that
neighbouring tiles still meet. Its geometric error is the error the simplifier reports, in
metres -- measured, not chosen by level -- and a viewer refines to the children only when that
error would show. Parents carry colour per vertex (sampled from the textures) rather than the
pictures, so a far view costs no texture memory. Every buffer is vertex-cache and fetch ordered
and packed with EXT_meshopt_compression, which three.js and every 3D Tiles client decode.

Coordinates: glTF is y-up, so a vertex is stored as (east, up, -north) -- which is also the
viewer's own world frame -- and the tileset's root transform takes the block's east-north-up
frame to Earth-centred coordinates, the 3D Tiles convention.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from smc.reconstruction.geo import EnuFrame

SCHEMA = "kerbside.worldmesh/1"
#: Triangles a leaf may hold before it is split. About 3-6 MB compressed with texture
#: coordinates; small enough that a phone streams a few around the walker.
LEAF_TRIANGLES = 200_000
#: Triangles a parent is simplified towards: one leaf's worth, so every tile costs about the
#: same to fetch and draw whatever its level.
PARENT_TRIANGLES = 160_000
#: A tile is never cut smaller than this, however dense: below it the tile count, not the
#: triangle count, is what a viewer pays for.
MIN_TILE_M = 4.0
QUANT = 65535


@dataclass
class Mesh:
    """A textured or vertex-coloured triangle mesh in a block's east-north-up metres."""

    positions: np.ndarray                      # (n, 3) float64: east, north, up
    faces: np.ndarray                          # (m, 3) integer vertex indices
    colours: np.ndarray | None = None          # (n, 3|4) uint8
    uvs: np.ndarray | None = None              # (n, 2) float, texture space
    face_texture: np.ndarray | None = None     # (m,) index into ``textures``; -1 for none
    textures: list[bytes] = field(default_factory=list)  # encoded pictures, kept as given

    def __post_init__(self) -> None:
        self.positions = np.ascontiguousarray(self.positions, dtype=np.float64)
        self.faces = np.ascontiguousarray(self.faces, dtype=np.uint32)
        if self.positions.ndim != 2 or self.positions.shape[1] != 3:
            raise ValueError("positions must be (n, 3)")
        if self.faces.ndim != 2 or self.faces.shape[1] != 3:
            raise ValueError("faces must be (m, 3)")
        if len(self.faces) and int(self.faces.max()) >= len(self.positions):
            raise ValueError("a face points past the last vertex")
        if not np.isfinite(self.positions).all():
            raise ValueError("positions must be finite")
        if self.colours is not None:
            self.colours = np.ascontiguousarray(self.colours, dtype=np.uint8)
            if self.colours.shape[1] == 3:
                self.colours = np.hstack([self.colours, np.full((len(self.colours), 1), 255, np.uint8)])
        if self.uvs is not None:
            self.uvs = np.ascontiguousarray(self.uvs, dtype=np.float64)
            if self.face_texture is None:
                self.face_texture = np.zeros(len(self.faces), np.int32)
        if self.face_texture is not None:
            self.face_texture = np.ascontiguousarray(self.face_texture, dtype=np.int32)
            if len(self.face_texture) != len(self.faces):
                raise ValueError("one texture index per face")
            if int(self.face_texture.max(initial=-1)) >= len(self.textures):
                raise ValueError("a face names a texture that is not there")

    def subset(self, face_ids: np.ndarray) -> Mesh:
        """The faces given, with only the vertices they use."""
        faces = self.faces[face_ids]
        used, inverse = np.unique(faces.ravel(), return_inverse=True)
        return Mesh(self.positions[used], inverse.reshape(-1, 3).astype(np.uint32),
                    None if self.colours is None else self.colours[used],
                    None if self.uvs is None else self.uvs[used],
                    None if self.face_texture is None else self.face_texture[face_ids],
                    self.textures)


@dataclass
class Tile:
    level: int
    x: int
    y: int
    west: float                  # metres east of the origin
    south: float
    size: float
    children: list[Tile] = field(default_factory=list)
    mesh: Mesh | None = None
    error_m: float = 0.0         # measured geometric error of this tile's content
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.level}/{self.x}/{self.y}"


# ---- the pyramid ----------------------------------------------------------------------------

def _square(mesh: Mesh) -> tuple[float, float, float]:
    lo, hi = mesh.positions[:, :2].min(axis=0), mesh.positions[:, :2].max(axis=0)
    size = float(max(hi - lo)) * 1.0001 + 1e-6
    return float(lo[0]), float(lo[1]), size


def build_pyramid(mesh: Mesh, *, leaf_triangles: int = LEAF_TRIANGLES,
                  parent_triangles: int = PARENT_TRIANGLES,
                  min_tile_m: float = MIN_TILE_M) -> Tile:
    """The quadtree over ``mesh``: leaves split by triangle count, parents simplified from them."""
    if not len(mesh.faces):
        raise ValueError("an empty mesh has no tiles")
    centroids = mesh.positions[mesh.faces].mean(axis=1)[:, :2]
    west, south, size = _square(mesh)

    def grow(level: int, x: int, y: int, ids: np.ndarray) -> Tile:
        tile = Tile(level, x, y, west + x * size / 2**level, south + y * size / 2**level, size / 2**level)
        if len(ids) <= leaf_triangles or tile.size / 2 < min_tile_m:
            tile.mesh = mesh.subset(ids)
            return tile
        half = tile.size / 2
        cx = centroids[ids, 0] >= tile.west + half
        cy = centroids[ids, 1] >= tile.south + half
        for dx in (0, 1):
            for dy in (0, 1):
                part = ids[(cx == bool(dx)) & (cy == bool(dy))]
                if len(part):
                    tile.children.append(grow(level + 1, 2 * x + dx, 2 * y + dy, part))
        _simplify_parent(tile, parent_triangles)
        return tile

    return grow(0, 0, 0, np.arange(len(mesh.faces)))


def _merge(meshes: list[Mesh]) -> Mesh:
    offset, faces, positions, colours = 0, [], [], []
    for m in meshes:
        faces.append(m.faces.astype(np.int64) + offset)
        positions.append(m.positions)
        colours.append(m.colours if m.colours is not None else vertex_colours(m))
        offset += len(m.positions)
    return Mesh(np.vstack(positions), np.vstack(faces), np.vstack(colours))


def _weld(mesh: Mesh) -> Mesh:
    """One vertex per position (texture seams split them; a simplifier needs them joined)."""
    key = np.round(mesh.positions * 1000.0).astype(np.int64)  # millimetres
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    faces = inverse.reshape(-1)[mesh.faces]
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return Mesh(mesh.positions[first], faces[keep],
                None if mesh.colours is None else mesh.colours[first])


def _simplify_parent(tile: Tile, target_triangles: int) -> None:
    import meshoptimizer as mo

    merged = _weld(_merge([child.mesh for child in tile.children]))
    indices = merged.faces.ravel().astype(np.uint32)
    if len(merged.faces) <= target_triangles:
        tile.mesh, tile.error_m = merged, max(child.error_m for child in tile.children)
        return
    positions = merged.positions.astype(np.float32)
    out = np.zeros_like(indices)
    result = np.zeros(1, dtype=np.float32)
    count = mo.simplify(out, indices, positions, target_index_count=target_triangles * 3,
                        target_error=1.0, options=mo.SIMPLIFY_LOCK_BORDER | mo.SIMPLIFY_ERROR_ABSOLUTE,
                        result_error=result)
    if count > target_triangles * 3 * 1.5:
        # Locked borders can hold a dense tile above its budget; a sloppier pass decides it.
        count = mo.simplify(out, indices, positions, target_index_count=target_triangles * 3,
                            target_error=1.0, options=mo.SIMPLIFY_ERROR_ABSOLUTE, result_error=result)
    faces = out[:count].reshape(-1, 3)
    used, inverse = np.unique(faces.ravel(), return_inverse=True)
    tile.mesh = Mesh(merged.positions[used], inverse.reshape(-1, 3), merged.colours[used])
    # A parent is never sharper than its sharpest child claims to be.
    tile.error_m = max(float(result[0]), max(child.error_m for child in tile.children))


def vertex_colours(mesh: Mesh) -> np.ndarray:
    """Colour per vertex, sampled from the textures where there are any (grey where not)."""
    if mesh.colours is not None:
        return mesh.colours
    out = np.full((len(mesh.positions), 4), 160, np.uint8)
    out[:, 3] = 255
    if mesh.uvs is None or not mesh.textures:
        return out
    from PIL import Image

    pictures = [np.asarray(Image.open(io.BytesIO(t)).convert("RGBA")) for t in mesh.textures]
    for index, picture in enumerate(pictures):
        verts = np.unique(mesh.faces[mesh.face_texture == index].ravel())
        if not len(verts):
            continue
        h, w = picture.shape[:2]
        u = np.clip((mesh.uvs[verts, 0] % 1.0) * (w - 1), 0, w - 1).astype(int)
        v = np.clip((mesh.uvs[verts, 1] % 1.0) * (h - 1), 0, h - 1).astype(int)
        out[verts] = picture[v, u]
    return out


# ---- GLB with KHR_mesh_quantization and EXT_meshopt_compression ----------------------------

def _normals(positions: np.ndarray, faces: np.ndarray) -> np.ndarray:
    tri = positions[faces]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    out = np.zeros_like(positions)
    for k in range(3):
        np.add.at(out, faces[:, k], n)
    length = np.linalg.norm(out, axis=1, keepdims=True)
    out = np.divide(out, length, out=np.zeros_like(out), where=length > 0)
    out[length[:, 0] == 0] = (0.0, 0.0, 1.0)
    return out


def _gltf_axes(enu: np.ndarray) -> np.ndarray:
    """east, north, up -> glTF's (x, y, z) = (east, up, -north)."""
    return np.stack([enu[:, 0], enu[:, 2], -enu[:, 1]], axis=1)


def _mime(blob: bytes) -> str:
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if blob[:4] == b"\xabKTX":
        return "image/ktx2"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


class _GlbWriter:
    """Accumulates compressed buffer views into one GLB."""

    def __init__(self) -> None:
        self.gltf: dict[str, Any] = {
            "asset": {"version": "2.0", "generator": SCHEMA},
            "extensionsUsed": ["EXT_meshopt_compression", "KHR_mesh_quantization"],
            "extensionsRequired": ["EXT_meshopt_compression", "KHR_mesh_quantization"],
            "buffers": [], "bufferViews": [], "accessors": [], "meshes": [], "nodes": [],
            "materials": [], "scenes": [{"nodes": []}], "scene": 0,
        }
        self.blob = bytearray()
        self.fallback = 0  # bytes the uncompressed views would take

    def _append(self, data: bytes) -> int:
        while len(self.blob) % 4:
            self.blob.append(0)
        offset = len(self.blob)
        self.blob += data
        return offset

    def compressed_view(self, raw: np.ndarray, *, mode: str, stride: int, count: int,
                        target: int | None = None) -> int:
        import meshoptimizer as mo

        if mode == "ATTRIBUTES":
            encoded = mo.encode_vertex_buffer(raw, count, stride)
        else:
            encoded = mo.encode_index_buffer(raw, count, max(int(raw.max(initial=0)) + 1, 1))
        offset = self._append(encoded)
        while self.fallback % 4:
            self.fallback += 1
        view = {"buffer": 1, "byteOffset": self.fallback, "byteLength": count * stride,
                "extensions": {"EXT_meshopt_compression": {
                    "buffer": 0, "byteOffset": offset, "byteLength": len(encoded),
                    "byteStride": stride, "count": count, "mode": mode}}}
        if mode == "ATTRIBUTES":
            view["byteStride"] = stride
        if target is not None:
            view["target"] = target
        self.fallback += count * stride
        self.gltf["bufferViews"].append(view)
        return len(self.gltf["bufferViews"]) - 1

    def plain_view(self, data: bytes) -> int:
        offset = self._append(data)
        self.gltf["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        return len(self.gltf["bufferViews"]) - 1

    def accessor(self, view: int, component: int, count: int, kind: str, *, offset: int = 0,
                 normalized: bool = False, lo: list | None = None, hi: list | None = None) -> int:
        acc: dict[str, Any] = {"bufferView": view, "byteOffset": offset, "componentType": component,
                               "count": count, "type": kind}
        if normalized:
            acc["normalized"] = True
        if lo is not None:
            acc["min"], acc["max"] = lo, hi
        self.gltf["accessors"].append(acc)
        return len(self.gltf["accessors"]) - 1

    def finish(self) -> bytes:
        self.gltf["buffers"] = [
            {"byteLength": len(self.blob)},
            {"byteLength": max(self.fallback, 4), "extensions": {"EXT_meshopt_compression": {"fallback": True}}},
        ]
        while len(self.blob) % 4:
            self.blob.append(0)
        self.gltf["buffers"][0]["byteLength"] = len(self.blob)
        text = json.dumps(self.gltf, separators=(",", ":")).encode()
        text += b" " * (-len(text) % 4)
        body = struct.pack("<II", len(text), 0x4E4F534A) + text
        body += struct.pack("<II", len(self.blob), 0x004E4942) + bytes(self.blob)
        return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body


UBYTE, USHORT, UINT, BYTE, FLOAT = 5121, 5123, 5125, 5120, 5126


def encode_tile(mesh: Mesh, *, textured: bool, name: str = "tile") -> tuple[bytes, dict[str, Any]]:
    """One tile as a GLB; returns it with what was measured on the way (rounding, counts)."""
    import meshoptimizer as mo

    mo.encode_vertex_version(0)  # the version every shipped decoder reads
    writer = _GlbWriter()
    positions = _gltf_axes(mesh.positions)
    lo, hi = positions.min(axis=0), positions.max(axis=0)
    extent = np.maximum(hi - lo, 1e-6)
    q = np.round((positions - lo) / extent * QUANT)
    rounding = float(np.abs(q / QUANT * extent + lo - positions).max(initial=0.0))
    normals = _normals(positions, mesh.faces)
    use_texture = textured and mesh.uvs is not None and mesh.face_texture is not None and mesh.textures
    colours = None if use_texture else vertex_colours(mesh)

    # The vertex record, 4-byte aligned: position u16x4 | normal i8x4 | colour u8x4 or uv u16x2.
    stride = 8 + 4 + 4
    record = np.zeros((len(positions), stride), np.uint8)
    record[:, 0:6] = q.astype("<u2").view(np.uint8).reshape(-1, 6)
    record[:, 8:11] = np.round(normals * 127).astype(np.int8).view(np.uint8)
    if use_texture:
        uv = np.clip(mesh.uvs, 0.0, 1.0)
        uv = np.stack([uv[:, 0], 1.0 - uv[:, 1]], axis=1)  # glTF's v runs down the picture
        record[:, 12:16] = np.round(uv * QUANT).astype("<u2").view(np.uint8).reshape(-1, 4)
    else:
        record[:, 12:16] = colours

    groups = (sorted(set(mesh.face_texture.tolist())) if use_texture else [None])
    primitives, texture_index = [], {}
    # One vertex buffer shared by every primitive, reordered for the cache and fetch.
    faces_all = mesh.faces.astype(np.uint32)
    order = np.argsort(mesh.face_texture, kind="stable") if use_texture else np.arange(len(faces_all))
    faces_all = faces_all[order]
    group_of = mesh.face_texture[order] if use_texture else np.zeros(len(faces_all), np.int32)
    remap = np.zeros(len(positions), np.uint32)
    indices = faces_all.ravel().copy()
    for g in groups:
        sel = np.flatnonzero(group_of == (g if g is not None else 0))
        span = indices.reshape(-1, 3)[sel].ravel().copy()
        out = np.zeros_like(span)
        mo.optimize_vertex_cache(out, span, len(span), len(positions))
        indices.reshape(-1, 3)[sel] = out.reshape(-1, 3)
    vertex_count = mo.optimize_vertex_fetch_remap(remap, indices, len(indices), len(positions))
    # remap[old] = new: every vertex of a tile is used (Mesh.subset), so none is dropped.
    reordered = np.zeros((vertex_count, stride), np.uint8)
    reordered[remap] = record
    indices = remap[indices]
    record = reordered

    vview = writer.compressed_view(np.ascontiguousarray(record), mode="ATTRIBUTES", stride=stride,
                                   count=vertex_count, target=34962)
    position_acc = writer.accessor(vview, USHORT, vertex_count, "VEC3", offset=0,
                                   lo=[0, 0, 0], hi=[int(q[:, k].max()) for k in range(3)])
    normal_acc = writer.accessor(vview, BYTE, vertex_count, "VEC3", offset=8, normalized=True)
    extra_acc = (writer.accessor(vview, USHORT, vertex_count, "VEC2", offset=12, normalized=True)
                 if use_texture else writer.accessor(vview, UBYTE, vertex_count, "VEC4", offset=12, normalized=True))
    start = 0
    for g in groups:
        n = int(np.count_nonzero(group_of == (g if g is not None else 0))) * 3
        span = np.ascontiguousarray(indices[start:start + n], dtype=np.uint32)
        start += n
        iview = writer.compressed_view(span, mode="TRIANGLES", stride=4, count=n, target=34963)
        iacc = writer.accessor(iview, UINT, n, "SCALAR")
        attributes = {"POSITION": position_acc, "NORMAL": normal_acc}
        if g is None:
            attributes["COLOR_0"] = extra_acc
            material = {"name": "measured-colour", "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.9}}
        else:
            attributes["TEXCOORD_0"] = extra_acc
            if g not in texture_index:
                image_view = writer.plain_view(mesh.textures[g])
                writer.gltf.setdefault("images", []).append({"bufferView": image_view, "mimeType": _mime(mesh.textures[g])})
                writer.gltf.setdefault("samplers", [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}])
                writer.gltf.setdefault("textures", []).append({"source": len(writer.gltf["images"]) - 1, "sampler": 0})
                texture_index[g] = len(writer.gltf["textures"]) - 1
            material = {"name": f"measured-texture-{g}", "pbrMetallicRoughness": {
                "baseColorTexture": {"index": texture_index[g]}, "metallicFactor": 0.0, "roughnessFactor": 0.9}}
        writer.gltf["materials"].append(material)
        primitives.append({"attributes": attributes, "indices": iacc, "mode": 4,
                           "material": len(writer.gltf["materials"]) - 1})
    writer.gltf["meshes"].append({"name": name, "primitives": primitives})
    scale = (extent / QUANT).tolist()
    writer.gltf["nodes"].append({"name": name, "mesh": 0, "translation": lo.tolist(), "scale": scale})
    writer.gltf["scenes"][0]["nodes"] = [0]
    glb = writer.finish()
    return glb, {"triangles": len(mesh.faces), "vertices": int(vertex_count),
                 "rounding_m": rounding, "step_m": float(max(scale)), "textured": bool(use_texture)}


# ---- writing a tileset -----------------------------------------------------------------------

def _box(tile: Tile) -> list[float]:
    """The 3D Tiles box (z-up east-north-up) round a tile's content."""
    p = tile.mesh.positions
    lo, hi = p.min(axis=0), p.max(axis=0)
    centre, half = (lo + hi) / 2, np.maximum((hi - lo) / 2, 0.01)
    return [*centre.tolist(), half[0], 0, 0, 0, half[1], 0, 0, 0, half[2]]


def write_tileset(root: Tile, out: Path, frame: EnuFrame, *, block: str,
                  provenance: dict[str, Any] | None = None) -> dict[str, Any]:
    """Every tile as ``tiles/<level>/<x>/<y>.glb``, the 3D Tiles tileset and our manifest."""
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []

    def emit(tile: Tile) -> dict[str, Any]:
        textured = not tile.children
        glb, measured = encode_tile(tile.mesh, textured=textured, name=f"{block}:{tile.key}")
        path = out / "tiles" / f"{tile.key}.glb"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(glb)
        uri = f"tiles/{tile.key}.glb"
        row = {"key": tile.key, "level": tile.level, "uri": uri, "bytes": len(glb),
               "sha256": hashlib.sha256(glb).hexdigest(), "error_m": tile.error_m,
               "leaf": not tile.children, "west_m": tile.west, "south_m": tile.south,
               "size_m": tile.size, **measured}
        rows.append(row)
        node = {"boundingVolume": {"box": _box(tile)}, "geometricError": tile.error_m,
                "refine": "REPLACE", "content": {"uri": uri}}
        if tile.children:
            node["children"] = [emit(child) for child in tile.children]
        return node

    tree = emit(root)
    tree["transform"] = frame.enu_to_ecef()
    leaves = [r for r in rows if r["leaf"]]
    summary = {
        "schema": SCHEMA, "block": block,
        "origin": {"lon": frame.lon, "lat": frame.lat, "height_m": frame.height_m},
        "frame": "east-north-up metres; glTF stores (east, up, -north)",
        "tiles": len(rows), "levels": max(r["level"] for r in rows) + 1,
        "leaf_triangles": sum(r["triangles"] for r in leaves),
        "bytes": sum(r["bytes"] for r in rows), "leaf_bytes": sum(r["bytes"] for r in leaves),
        "max_rounding_m": max(r["rounding_m"] for r in leaves),
        "provenance": provenance or {},
        "rows": sorted(rows, key=lambda r: (r["level"], r["key"])),
    }
    tileset = {"asset": {"version": "1.1", "generator": SCHEMA},
               "geometricError": max(_diagonal(root), root.error_m), "root": tree,
               "extras": {"block": block, "provenance": provenance or {}}}
    (out / "tileset.json").write_text(json.dumps(tileset, separators=(",", ":")))
    (out / "manifest.json").write_text(json.dumps(summary, indent=1))
    return summary


def _diagonal(tile: Tile) -> float:
    p = tile.mesh.positions
    return float(math.dist(p.min(axis=0), p.max(axis=0)))


def tile_mesh(mesh: Mesh, out: Path, frame: EnuFrame, *, block: str,
              provenance: dict[str, Any] | None = None, **pyramid: Any) -> dict[str, Any]:
    return write_tileset(build_pyramid(mesh, **pyramid), out, frame, block=block, provenance=provenance)


def read_tile(glb: bytes) -> dict[str, np.ndarray]:
    """A tile decoded back to east-north-up positions and faces: how a tile is checked."""
    import meshoptimizer as mo

    length, kind = struct.unpack_from("<II", glb, 12)
    if kind != 0x4E4F534A:
        raise ValueError("not a GLB")
    gltf = json.loads(glb[20:20 + length])
    blob_at = 20 + length + 8
    blob = glb[blob_at:blob_at + struct.unpack_from("<I", glb, 20 + length)[0]]

    def view(index: int) -> np.ndarray:
        ext = gltf["bufferViews"][index]["extensions"]["EXT_meshopt_compression"]
        data = blob[ext["byteOffset"]:ext["byteOffset"] + ext["byteLength"]]
        if ext["mode"] == "ATTRIBUTES":
            return mo.decode_vertex_buffer(ext["count"], ext["byteStride"], data).view(np.uint8).reshape(ext["count"], -1)
        return mo.decode_index_buffer(ext["count"], ext["byteStride"], data).astype(np.uint32)

    node = gltf["nodes"][0]
    prims = gltf["meshes"][0]["primitives"]
    pos = gltf["accessors"][prims[0]["attributes"]["POSITION"]]
    record = view(pos["bufferView"])
    q = record[:, :6].copy().view("<u2").reshape(-1, 3).astype(np.float64)
    gl = q * np.asarray(node["scale"]) + np.asarray(node["translation"])
    enu = np.stack([gl[:, 0], -gl[:, 2], gl[:, 1]], axis=1)
    faces = np.vstack([view(gltf["accessors"][p["indices"]]["bufferView"]).reshape(-1, 3) for p in prims])
    out = {"positions": enu, "faces": faces}
    if "TEXCOORD_0" in prims[0]["attributes"]:
        uv = record[:, 12:16].copy().view("<u2").reshape(-1, 2) / QUANT
        out["uvs"] = np.stack([uv[:, 0], 1.0 - uv[:, 1]], axis=1)
    else:
        out["colours"] = record[:, 12:16].copy()
    return out
