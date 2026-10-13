"""Decode the Mapbox vector tiles Mapillary uses for an image's segmentation polygons.

A detection's ``geometry`` is a base64 tile whose one layer holds the region in tile units
(``extent``, normally 4096) across the *image*: x right, y down, so dividing by the extent gives
normalized image coordinates. Only what the segmentation uses is decoded: polygon rings.
"""

from __future__ import annotations

import base64


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = value = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes):
    i = 0
    while i < len(buf):
        key, i = _varint(buf, i)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(buf, i)
        elif wire == 2:
            size, i = _varint(buf, i)
            value, i = buf[i:i + size], i + size
        elif wire == 1:
            value, i = buf[i:i + 8], i + 8
        elif wire == 5:
            value, i = buf[i:i + 4], i + 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        yield number, wire, value


def _packed(buf: bytes) -> list[int]:
    out, i = [], 0
    while i < len(buf):
        value, i = _varint(buf, i)
        out.append(value)
    return out


def _zigzag(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def _rings(commands: list[int], extent: int) -> list[list[tuple[float, float]]]:
    rings, ring, x, y, i = [], [], 0, 0, 0
    while i < len(commands):
        command, count = commands[i] & 7, commands[i] >> 3
        i += 1
        if command == 7:  # ClosePath
            if ring:
                rings.append(ring)
            ring = []
            continue
        for _ in range(count):
            x += _zigzag(commands[i])
            y += _zigzag(commands[i + 1])
            i += 2
            if command == 1 and ring:  # MoveTo starts a new ring
                rings.append(ring)
                ring = []
            ring.append((x / extent, y / extent))
    if ring:
        rings.append(ring)
    return rings


def polygons(geometry_b64: str) -> list[list[tuple[float, float]]]:
    """Every ring in the tile, in normalized image coordinates (0..1, y down)."""
    tile = base64.b64decode(geometry_b64)
    out = []
    for number, _wire, layer in _fields(tile):
        if number != 3:
            continue
        extent, features = 4096, []
        for field, _w, value in _fields(layer):
            if field == 5:
                extent = value
            elif field == 2:
                features.append(value)
        for feature in features:
            for field, _w, value in _fields(feature):
                if field == 4:
                    out.extend(_rings(_packed(value), extent))
    return out
