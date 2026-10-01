"""Scan files into vertices and faces (or points), with numpy and laspy only.

GLB and glTF (with node transforms), OBJ, binary and ASCII PLY, and LAS/LAZ. Compressed glTF
(Draco, meshopt) is refused by name: decoding it needs a library this environment does not have,
and a scan that cannot be read is recorded as such rather than half-read.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

from smc.geometry.base import TriMesh

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32,
             5126: np.float32}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
COMPRESSED = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression"}


class UnreadableScan(ValueError):
    pass


def _node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4).T
    t = np.asarray(node.get("translation", [0, 0, 0]), dtype=np.float64)
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    s = np.asarray(node.get("scale", [1, 1, 1]), dtype=np.float64)
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def _gltf(doc: dict, buffers: list[bytes]) -> TriMesh:
    used = set(doc.get("extensionsUsed", [])) | set(doc.get("extensionsRequired", []))
    if used & COMPRESSED:
        raise UnreadableScan(f"compressed glTF ({', '.join(sorted(used & COMPRESSED))})")

    def accessor(index: int) -> np.ndarray:
        acc = doc["accessors"][index]
        view = doc["bufferViews"][acc["bufferView"]]
        dtype = np.dtype(COMPONENT[acc["componentType"]])
        width = WIDTH[acc["type"]]
        data = buffers[view["buffer"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or dtype.itemsize * width
        count = acc["count"]
        if stride == dtype.itemsize * width:
            arr = np.frombuffer(data, dtype=dtype, count=count * width, offset=start)
            return arr.reshape(count, width) if width > 1 else arr
        span = stride * (count - 1) + dtype.itemsize * width
        raw = np.frombuffer(data, dtype=np.uint8, count=span, offset=start)
        rows = [np.frombuffer(raw[k * stride:k * stride + dtype.itemsize * width].tobytes(),
                              dtype=dtype) for k in range(count)]
        return np.stack(rows)

    meshes: list[TriMesh] = []

    def visit(node_index: int, parent: np.ndarray) -> None:
        node = doc["nodes"][node_index]
        world = parent @ _node_matrix(node)
        if "mesh" in node:
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4 or "POSITION" not in prim["attributes"]:
                    continue
                pos = accessor(prim["attributes"]["POSITION"]).astype(np.float64)
                idx = accessor(prim["indices"]).astype(np.int64).reshape(-1, 3) \
                    if "indices" in prim else np.arange(len(pos)).reshape(-1, 3)
                homogeneous = np.column_stack([pos, np.ones(len(pos))]) @ world.T
                meshes.append(TriMesh(homogeneous[:, :3], idx))
        for child in node.get("children", []):
            visit(child, world)

    scene = doc.get("scenes", [{"nodes": list(range(len(doc.get("nodes", []))))}])[
        doc.get("scene", 0)]
    for root in scene.get("nodes", []):
        visit(root, np.eye(4))
    return TriMesh.merge(meshes)


def read_glb(path: Path) -> TriMesh:
    data = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise UnreadableScan("not a GLB file")
    offset, doc, binary = 12, None, b""
    while offset < len(data):
        size, kind = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == b"JSON":
            doc = json.loads(chunk)
        elif kind == b"BIN\x00":
            binary = chunk
        offset += 8 + size
    if doc is None:
        raise UnreadableScan("GLB without a JSON chunk")
    return _gltf(doc, [binary])


def read_gltf(path: Path) -> TriMesh:
    doc = json.loads(path.read_text())
    buffers = []
    for buf in doc.get("buffers", []):
        uri = buf.get("uri", "")
        if uri.startswith("data:"):
            import base64
            buffers.append(base64.b64decode(uri.split(",", 1)[1]))
        else:
            buffers.append((path.parent / uri).read_bytes())
    return _gltf(doc, buffers)


def read_obj(path: Path) -> TriMesh:
    verts, faces = [], []
    for line in path.read_text(errors="replace").splitlines():
        if line.startswith("v "):
            verts.append([float(v) for v in line.split()[1:4]])
        elif line.startswith("f "):
            idx = [int(tok.split("/")[0]) for tok in line.split()[1:]]
            idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
            faces.extend([idx[0], idx[k], idx[k + 1]] for k in range(1, len(idx) - 1))
    return TriMesh(np.asarray(verts, dtype=np.float64), np.asarray(faces, dtype=np.int64))


PLY_TYPES = {"char": "i1", "uchar": "u1", "int8": "i1", "uint8": "u1", "short": "i2",
             "ushort": "u2", "int16": "i2", "uint16": "u2", "int": "i4", "uint": "u4",
             "int32": "i4", "uint32": "u4", "float": "f4", "float32": "f4", "double": "f8",
             "float64": "f8"}


def read_ply(path: Path) -> tuple[np.ndarray, np.ndarray | None]:
    """Vertices, and faces when the file has them (None for a point cloud)."""
    data = path.read_bytes()
    end = data.index(b"end_header") + len(b"end_header")
    end = data.index(b"\n", end) + 1
    header = data[:end].decode("ascii", "replace").splitlines()
    fmt = next(h.split()[1] for h in header if h.startswith("format"))
    elements: list[tuple[str, int, list]] = []
    for h in header:
        parts = h.split()
        if parts[:1] == ["element"]:
            elements.append((parts[1], int(parts[2]), []))
        elif parts[:1] == ["property"]:
            elements[-1][2].append(parts[1:])
    order = "<" if "little" in fmt else ">"
    pos = end
    verts, faces = None, None
    if fmt == "ascii":
        lines = data[end:].decode("ascii", "replace").split("\n")
        k = 0
        for name, count, props in elements:
            rows = [lines[k + i].split() for i in range(count)]
            k += count
            if name == "vertex":
                names = [p[-1] for p in props]
                cols = [names.index(a) for a in ("x", "y", "z")]
                verts = np.array([[float(r[c]) for c in cols] for r in rows])
            elif name == "face":
                faces = np.array([[int(v) for v in r[1:4]] for r in rows if int(r[0]) == 3])
        return verts, faces
    for name, count, props in elements:
        if all(p[0] != "list" for p in props):
            dtype = np.dtype([(p[-1], order + PLY_TYPES[p[0]]) for p in props])
            block = np.frombuffer(data, dtype=dtype, count=count, offset=pos)
            pos += dtype.itemsize * count
            if name == "vertex":
                verts = np.column_stack([block["x"], block["y"], block["z"]]).astype(np.float64)
        else:
            count_t = np.dtype(order + PLY_TYPES[props[0][1]])
            index_t = np.dtype(order + PLY_TYPES[props[0][2]])
            out = []
            for _ in range(count):
                n = int(np.frombuffer(data, dtype=count_t, count=1, offset=pos)[0])
                pos += count_t.itemsize
                idx = np.frombuffer(data, dtype=index_t, count=n, offset=pos)
                pos += index_t.itemsize * n
                out.extend([idx[0], idx[k], idx[k + 1]] for k in range(1, n - 1))
            if name == "face":
                faces = np.asarray(out, dtype=np.int64).reshape(-1, 3)
    return verts, faces


def read_points(path: Path) -> np.ndarray:
    import laspy

    las = laspy.read(str(path))
    return np.column_stack([las.x, las.y, las.z]).astype(np.float64)


def read(path: Path) -> tuple[np.ndarray, TriMesh | None]:
    """Any supported file to (points, mesh-or-None). A mesh's points are its vertices."""
    suffix = path.suffix.lower()
    if suffix == ".glb":
        mesh = read_glb(path)
    elif suffix == ".gltf":
        mesh = read_gltf(path)
    elif suffix == ".obj":
        mesh = read_obj(path)
    elif suffix == ".ply":
        verts, faces = read_ply(path)
        if verts is None:
            raise UnreadableScan("PLY without vertices")
        mesh = TriMesh(verts, faces) if faces is not None and len(faces) else None
        return verts, mesh
    elif suffix in (".las", ".laz"):
        return read_points(path), None
    else:
        raise UnreadableScan(f"unsupported format {suffix}")
    return mesh.vertices, mesh
