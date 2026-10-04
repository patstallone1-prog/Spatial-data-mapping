#!/usr/bin/env python3
"""The Redwood apartment scan at close to its own resolution, in chunks the app keeps locally.

``prepare_redwood_interior.py`` averages the 17 million source triangles into 6 cm voxels: a
149 thousand triangle first look that is quick to fetch, and blurred -- the colour is carried on
the vertices, so a 6 cm vertex is a 6 cm pixel. This builds the detail level that replaces it
once it has arrived: the same source, averaged at ``--voxel`` (1.2 cm by default, about 3.4
million triangles), under the *same* rigid gravity alignment the manifest already records, so
the layout, the bounds and every placement made from the first look still hold exactly.

It is written as a few glTF chunks split where the triangles balance, each well under the 100 MB
a hosted file may be, and quantized (KHR_mesh_quantization): positions as millimetre integers,
normals as bytes, colours as bytes -- 16 bytes a vertex rather than 40, with nothing visible lost.
Chunk names carry their content hash, so an installed app keeps them across releases.

Voxel averaging is a display level of detail, not a new measurement. Requires numpy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SCANS = ROOT / "docs" / "interior-scans"
SCAN_ID = "redwood-apartment-2017"
SOURCE_SHA256 = "4a0b71672237e497d158441f6273d955c9015f8edb832fbcb44d05e3470de19d"
#: A chunk holds at most this many triangles: a few chunks, each a modest single download.
MAX_CHUNK_TRIANGLES = 650_000
MM = 0.001


def read_source(path: Path):
    with path.open("rb") as stream:
        header = []
        while True:
            line = stream.readline().decode("ascii").strip()
            header.append(line)
            if line == "end_header":
                break
        offset = stream.tell()
    expected = [f"property double {n}" for n in ("x", "y", "z", "nx", "ny", "nz")] + [
        f"property uchar {n}" for n in ("red", "green", "blue")]
    if "format binary_little_endian 1.0" not in header or header[4:13] != expected:
        raise ValueError("Unexpected Redwood PLY schema; refuse to guess its layout")
    nv = int(next(s for s in header if s.startswith("element vertex ")).split()[-1])
    nf = int(next(s for s in header if s.startswith("element face ")).split()[-1])
    dtype = np.dtype([(n, "<f8") for n in ("x", "y", "z", "nx", "ny", "nz")]
                     + [(n, "u1") for n in ("red", "green", "blue")])
    vertices = np.memmap(path, dtype=dtype, offset=offset, shape=(nv,), mode="r")
    faces = np.memmap(path, dtype=[("count", "u1"), ("indices", "<u4", (3,))],
                      offset=offset + nv * dtype.itemsize, shape=(nf,), mode="r")
    return vertices, faces


def voxel_mesh(vertices, faces, voxel: float):
    positions = np.column_stack([vertices[n] for n in ("x", "y", "z")]).astype("f8")
    # The same camera-frame flip prepare_redwood_interior applies: y-up, not reflected.
    positions[:, 1:] *= -1
    q = np.floor(positions / voxel).astype("i8")
    q -= q.min(axis=0)
    span = q.max(axis=0) + 1
    keys = (q[:, 0] * span[1] + q[:, 1]) * span[2] + q[:, 2]
    del q
    _, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    del keys
    inverse = inverse.astype("u4")
    n = len(counts)
    reduced = np.column_stack([np.bincount(inverse, weights=positions[:, k], minlength=n) / counts
                               for k in range(3)])
    colours = np.column_stack([np.bincount(inverse, weights=vertices[k], minlength=n) / counts
                               for k in ("red", "green", "blue")]).round().astype("u1")
    del positions
    kept = []
    for start in range(0, len(faces), 1_000_000):
        chunk = faces[start:start + 1_000_000]
        if np.any(chunk["count"] != 3):
            raise ValueError("Non-triangular source face")
        f = inverse[chunk["indices"]]
        kept.append(f[(f[:, 0] != f[:, 1]) & (f[:, 0] != f[:, 2]) & (f[:, 1] != f[:, 2])])
    triangles = np.concatenate(kept)
    _, first = np.unique(np.sort(triangles, axis=1), axis=0, return_index=True)
    triangles = triangles[np.sort(first)]
    used = np.zeros(n, bool)
    used[triangles.ravel()] = True
    remap = np.cumsum(used) - 1
    return reduced[used], colours[used], remap[triangles].astype("u4")


def vertex_normals(positions: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    a, b, c = (positions[triangles[:, k]] for k in range(3))
    face = np.cross(b - a, c - a)                      # area-weighted
    normals = np.zeros_like(positions)
    for k in range(3):
        np.add.at(normals, triangles[:, k], face)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.where(length > 0, length, 1)


def split(triangles: np.ndarray, centres: np.ndarray, limit: int) -> list[np.ndarray]:
    """Triangle index sets, halved at the median of the longer horizontal extent until each
    holds no more than ``limit``."""
    out, stack = [], [np.arange(len(triangles))]
    while stack:
        ids = stack.pop()
        if len(ids) <= limit:
            out.append(ids)
            continue
        extent = np.ptp(centres[ids][:, [0, 2]], axis=0)
        axis = 0 if extent[0] >= extent[1] else 2
        order = ids[np.argsort(centres[ids, axis], kind="stable")]
        half = len(order) // 2
        stack += [order[:half], order[half:]]
    return out


def _pad(data: bytes, fill: bytes = b"\x00") -> bytes:
    return data + fill * (-len(data) % 4)


def chunk_glb(positions, normals, colours, triangles) -> bytes:
    """One quantized glTF binary: SHORT millimetre positions under a node scale, BYTE normals,
    UNSIGNED_BYTE colours, UNSIGNED_INT indices."""
    origin = positions.min(axis=0)
    quantized = np.round((positions - origin) / MM)
    if quantized.max() > 32767:
        raise ValueError("Chunk wider than 32 m cannot take millimetre SHORT positions")
    pos = np.zeros((len(positions), 4), "<i2")
    pos[:, :3] = quantized
    nrm = np.zeros((len(positions), 4), "i1")
    nrm[:, :3] = np.clip(np.round(normals * 127), -127, 127)
    col = np.zeros((len(positions), 4), "u1")
    col[:, :3] = colours
    views, blobs, offset = [], [], 0
    for blob, stride, target in ((triangles.astype("<u4").tobytes(), None, 34963),
                                 (pos.tobytes(), 8, 34962), (nrm.tobytes(), 4, 34962),
                                 (col.tobytes(), 4, 34962)):
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob), "target": target}
        if stride:
            view["byteStride"] = stride
        views.append(view)
        blobs.append(_pad(blob))
        offset += len(blobs[-1])
    q = pos[:, :3].astype(int)
    document = {
        "asset": {"version": "2.0", "generator": "kerbside build_redwood_detail"},
        "extensionsUsed": ["KHR_mesh_quantization"],
        "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "translation": origin.tolist(), "scale": [MM, MM, MM]}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 1, "NORMAL": 2, "COLOR_0": 3},
                                    "indices": 0, "material": 0, "mode": 4}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1],
                                                "metallicFactor": 0.0, "roughnessFactor": 0.9},
                       "doubleSided": False}],
        "accessors": [
            {"bufferView": 0, "componentType": 5125, "count": int(triangles.size), "type": "SCALAR",
             "min": [int(triangles.min())], "max": [int(triangles.max())]},
            {"bufferView": 1, "componentType": 5122, "count": len(pos), "type": "VEC3",
             "min": q.min(axis=0).tolist(), "max": q.max(axis=0).tolist()},
            {"bufferView": 2, "componentType": 5120, "normalized": True, "count": len(nrm),
             "type": "VEC3"},
            {"bufferView": 3, "componentType": 5121, "normalized": True, "count": len(col),
             "type": "VEC3"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": offset}],
    }
    text = _pad(json.dumps(document, separators=(",", ":")).encode(), b" ")
    binary = b"".join(blobs)
    total = 12 + 8 + len(text) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(text), 0x4E4F534A)
            + text + struct.pack("<II", len(binary), 0x004E4942) + binary)


def build(source: Path, voxel: float) -> dict:
    manifest = json.loads((SCANS / "manifest.json").read_text())
    scan = manifest["scans"][SCAN_ID]
    if scan["source_sha256"] != SOURCE_SHA256:
        raise ValueError("Manifest is not for the reviewed Redwood source")
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != SOURCE_SHA256:
            raise ValueError("Source PLY is not the reviewed Redwood file")
    vertices, faces = read_source(source)
    positions, colours, triangles = voxel_mesh(vertices, faces, voxel)
    # The first look's rigid alignment, applied unchanged: one rotation and translation.
    m = np.asarray(scan["gravity_alignment"], float)
    positions = positions @ m[:3, :3].T + m[:3, 3]
    low, high = np.asarray(scan["bounds"])
    print("detail bounds", positions.min(0).round(3).tolist(), positions.max(0).round(3).tolist(),
          "first look", low.round(3).tolist(), high.round(3).tolist(), flush=True)
    # Thin strands -- a reflection through a window, a sliver of a far wall -- that 6 cm voxels
    # collapsed to nothing survive at 1.2 cm and stand out past the scan's own bounds; the first
    # look's bounds are where every placement was proved to fit, so nothing leaves them.
    margin = voxel
    inside = np.all((positions >= low - margin) & (positions <= high + margin), axis=1)
    keep = inside[triangles].all(axis=1)
    print("cropped", int((~keep).sum()), "of", len(triangles), "triangles outside the first look",
          flush=True)
    triangles = triangles[keep]
    used = np.zeros(len(positions), bool)
    used[triangles.ravel()] = True
    remap = np.cumsum(used) - 1
    positions, colours, triangles = positions[used], colours[used], remap[triangles].astype("u4")
    if np.abs(positions.min(0) - low).max() > 0.1 or np.abs(positions.max(0) - high).max() > 0.1:
        raise ValueError("Detail level does not register with the first look")
    normals = vertex_normals(positions, triangles)
    centres = positions[triangles].mean(axis=1)
    out = SCANS / "detail"
    out.mkdir(exist_ok=True)
    for old in out.glob("apartment-detail-*.glb"):
        old.unlink()
    chunks = []
    for k, ids in enumerate(sorted(split(triangles, centres, MAX_CHUNK_TRIANGLES),
                                   key=lambda ids: tuple(centres[ids].mean(0).round(2)))):
        tri = triangles[ids]
        used, local = np.unique(tri.ravel(), return_inverse=True)
        glb = chunk_glb(positions[used], normals[used], colours[used],
                        local.reshape(-1, 3).astype("u4"))
        digest = hashlib.sha256(glb).hexdigest()
        name = f"apartment-detail-{k}-{digest[:12]}.glb"
        (out / name).write_bytes(glb)
        chunks.append({"asset": f"interior-scans/detail/{name}", "sha256": digest,
                       "bytes": len(glb), "triangles": len(tri), "vertices": len(used)})
        print(name, len(tri), "triangles", round(len(glb) / 1e6, 1), "MB", flush=True)
    detail = {"voxel_m": voxel, "triangles": len(triangles), "vertices": len(positions),
              "bytes": sum(c["bytes"] for c in chunks), "encoding": "KHR_mesh_quantization",
              "registration": "first-look gravity_alignment applied unchanged",
              "grade": "display_level_of_detail_not_new_measurement", "chunks": chunks}
    (out / "detail.json").write_text(json.dumps(detail, indent=2) + "\n")
    scan["detail"] = detail
    (SCANS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return detail


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Apartment/scene/integrated.ply")
    parser.add_argument("--voxel", type=float, default=0.012)
    args = parser.parse_args()
    summary = build(args.source, args.voxel)
    print(json.dumps({k: v for k, v in summary.items() if k != "chunks"}, indent=2))
