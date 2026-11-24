"""Minimal Mapbox Vector Tile ring decoder for Mapillary detection geometry.

A detection ``geometry`` is a base64 tile whose layer holds polygons in tile units across the
*image* (x right, y down, ``extent`` usually 4096). Only polygon rings are decoded.
"""

from __future__ import annotations

import base64


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = value = 0
    while True:
        b = buf[i]
        i += 1
        value |= (b & 0x7F) << shift
        if not b & 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes):
    i = 0
    while i < len(buf):
        key, i = _varint(buf, i)
        num, wire = key >> 3, key & 7
        if wire == 0:
            v, i = _varint(buf, i)
            yield num, v
        elif wire == 2:
            n, i = _varint(buf, i)
            yield num, buf[i:i + n]
            i += n
        elif wire == 5:
            yield num, buf[i:i + 4]
            i += 4
        elif wire == 1:
            yield num, buf[i:i + 8]
            i += 8
        else:
            raise ValueError(f"wire type {wire}")


def _packed(buf: bytes) -> list[int]:
    out, i = [], 0
    while i < len(buf):
        v, i = _varint(buf, i)
        out.append(v)
    return out


def _zz(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def decode_geometry(cmds: list[int], extent: int) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    x = y = 0
    i = 0
    cur: list[tuple[float, float]] = []
    while i < len(cmds):
        cid, count = cmds[i] & 7, cmds[i] >> 3
        i += 1
        if cid in (1, 2):
            for _ in range(count):
                x += _zz(cmds[i])
                y += _zz(cmds[i + 1])
                i += 2
                if cid == 1 and cur:
                    rings.append(cur)
                    cur = []
                cur.append((x / extent, y / extent))
        elif cid == 7:
            if cur:
                rings.append(cur)
            cur = []
    if cur:
        rings.append(cur)
    return rings


def rings(b64: str) -> list[list[tuple[float, float]]]:
    tile = base64.b64decode(b64)
    out: list[list[tuple[float, float]]] = []
    for num, layer in _fields(tile):
        if num != 3:
            continue
        extent = 4096
        feats = []
        for ln, lv in _fields(layer):
            if ln == 5:
                extent = lv
            elif ln == 2:
                feats.append(lv)
        for f in feats:
            for fn, fv in _fields(f):
                if fn == 4:
                    out.extend(decode_geometry(_packed(fv), extent))
    return out


def encode_polygon_tile(ring: list[tuple[int, int]], extent: int = 4096) -> str:
    """A one-feature tile, for tests: inverse of :func:`rings` for one integer ring."""
    def vint(n: int) -> bytes:
        out = bytearray()
        while True:
            b = n & 0x7F
            n >>= 7
            out.append(b | (0x80 if n else 0))
            if not n:
                return bytes(out)

    def zz(n: int) -> int:
        return (n << 1) ^ (n >> 31)

    def field(num: int, payload: bytes) -> bytes:
        return vint(num << 3 | 2) + vint(len(payload)) + payload

    cmds = [1 | (1 << 3), zz(ring[0][0]), zz(ring[0][1]), 2 | ((len(ring) - 1) << 3)]
    px, py = ring[0]
    for x, y in ring[1:]:
        cmds += [zz(x - px), zz(y - py)]
        px, py = x, y
    cmds.append(7 | (1 << 3))
    geom = b"".join(vint(c) for c in cmds)
    feature = vint(3 << 3 | 0) + vint(3) + field(4, geom)
    layer = vint(15 << 3 | 0) + vint(2) + field(1, b"mpy-or") + field(2, feature) + \
        vint(5 << 3 | 0) + vint(extent)
    return base64.b64encode(field(3, layer)).decode()
