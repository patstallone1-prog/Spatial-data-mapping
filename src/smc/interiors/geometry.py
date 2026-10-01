"""Just enough WKB and WKT to read floor plans, with numpy and nothing else.

The datasets ship their geometry as WKT strings (Swiss Dwellings) or as shapely-pickled WKB
(ResPlan, read through :mod:`smc.interiors.resplan`'s restricted unpickler). Polygons and
multipolygons are all a plan needs; anything else is refused by name rather than guessed at.
"""

from __future__ import annotations

import struct

import numpy as np

Ring = np.ndarray  # (n, 2) float64, not closed


def _ring(values: np.ndarray) -> Ring:
    pts = values.reshape(-1, 2)
    if len(pts) > 1 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    return pts


def polygons_from_wkt(text: str) -> list[list[Ring]]:
    """``POLYGON`` / ``MULTIPOLYGON`` text to a list of polygons, each [outer, *holes]."""
    text = text.strip()
    kind, _, body = text.partition(" ")
    kind = kind.upper()
    if kind not in ("POLYGON", "MULTIPOLYGON"):
        raise ValueError(f"not a polygon: {kind}")
    if body.strip().upper() == "EMPTY":
        return []
    body = body.strip()
    polygons_text = [body[1:-1]] if kind == "POLYGON" else \
        [p.strip("() ") for p in body[1:-1].split(")), ((")]
    out = []
    for poly in polygons_text:
        rings = []
        for ring_text in poly.strip("() ").split("), ("):
            values = np.array(ring_text.replace(",", " ").split(), dtype=np.float64)
            rings.append(_ring(values))
        out.append(rings)
    return out


def polygons_from_wkb(blob: bytes) -> list[list[Ring]]:
    """Polygon / multipolygon WKB (either byte order) to a list of polygons."""
    polygons, _ = _read(memoryview(blob), 0)
    return polygons


def _read(buf: memoryview, pos: int) -> tuple[list[list[Ring]], int]:
    order = "<" if buf[pos] == 1 else ">"
    kind = struct.unpack_from(order + "I", buf, pos + 1)[0]
    pos += 5
    if kind == 3:
        count = struct.unpack_from(order + "I", buf, pos)[0]
        pos += 4
        rings = []
        for _ in range(count):
            n = struct.unpack_from(order + "I", buf, pos)[0]
            pos += 4
            values = np.frombuffer(buf, dtype=order + "f8", count=2 * n, offset=pos)
            pos += 16 * n
            rings.append(_ring(values.astype(np.float64)))
        return ([rings] if rings else []), pos
    if kind == 6:
        count = struct.unpack_from(order + "I", buf, pos)[0]
        pos += 4
        out = []
        for _ in range(count):
            polys, pos = _read(buf, pos)
            out.extend(polys)
        return out, pos
    raise ValueError(f"unsupported WKB geometry type {kind}")


def area(ring: Ring) -> float:
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def min_area_rect(points: np.ndarray) -> tuple[float, float, float]:
    """Width, depth (width >= depth) and bearing (deg) of the smallest enclosing rectangle."""
    from smc.geometry.primitives import min_area_rectangle

    _centre, yaw, length, width = min_area_rectangle(points)
    if width > length:
        length, width, yaw = width, length, yaw + np.pi / 2
    return float(length), float(width), float(np.degrees(yaw) % 180.0)
