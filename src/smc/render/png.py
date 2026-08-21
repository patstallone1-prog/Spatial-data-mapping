"""Minimal PNG writer.

Written against zlib from the standard library rather than pulling in an imaging dependency.
The pipeline needs to *emit* 8-bit RGB and nothing else; an imaging library would add a wheel,
a version constraint and a native build to every environment for a job that is forty lines.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np


def _chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def encode_png(image: np.ndarray) -> bytes:
    """Encode an (H, W, 3) uint8 array as PNG bytes."""
    array = np.asarray(image)
    if array.ndim != 3 or array.shape[2] != 3:
        raise ValueError(f"expected (H, W, 3), got {array.shape}")
    if array.dtype != np.uint8:
        array = np.clip(array, 0, 255).astype(np.uint8)

    height, width = array.shape[:2]
    # Each scanline is prefixed with a filter byte; 0 means "no filter".
    raw = b"".join(b"\x00" + array[y].tobytes() for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(raw, 6))
        + _chunk(b"IEND", b"")
    )


def write_png(image: np.ndarray, path: Path | str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode_png(image))
    return path
