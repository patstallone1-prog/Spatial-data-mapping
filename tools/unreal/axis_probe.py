"""Tiny glTF 2.0 axis/units fixture, independent of any city observations."""
import json
import struct
from pathlib import Path


def write_probe(path: Path) -> None:
    positions = [(10 + x * .5, 20 + y, 30 + z * 1.5)
                 for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                 (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    indices = (0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
               1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7)
    binary = struct.pack("<24f", *(v for p in positions for v in p)) + struct.pack("<36H", *indices)
    data = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0, "name": "AxisProbe"}],
            "meshes": [{"name": "AxisProbe", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
            "buffers": [{"byteLength": len(binary)}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 96, "target": 34962},
                            {"buffer": 0, "byteOffset": 96, "byteLength": 72, "target": 34963}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3",
                           "min": [9.5, 19, 28.5], "max": [10.5, 21, 31.5]},
                          {"bufferView": 1, "componentType": 5123, "count": 36, "type": "SCALAR"}]}
    text = json.dumps(data, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    size = 12 + 8 + len(text) + 8 + len(binary)
    glb = struct.pack("<III", 0x46546C67, 2, size) + struct.pack("<II", len(text), 0x4E4F534A) + text
    glb += struct.pack("<II", len(binary), 0x004E4942) + binary
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(glb)
