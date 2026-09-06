"""Cutting the mapped region into square chunks, and saying which of them a camera could dress.

Photorealism is not going to arrive across two and a half square kilometres in one pass, so the
region is divided into blocks that can be done one at a time and compared against each other.
A chunk is a square of ground in metres rather than a hexagon or a degree box, because the
question it has to answer -- can we photograph the buildings in here -- is a question about
distances.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from smc.facades.geometry import LocalFrame

#: A block of downtown San Francisco is about 90 m by 170 m, so a 250 m chunk holds a couple of
#: them: small enough to finish, large enough that its streets read as a place.
CHUNK_SIZE_M = 250.0


@dataclass
class Chunk:
    key: str
    col: int
    row: int
    west: float
    south: float
    east: float
    north: float
    buildings: list[int] = field(default_factory=list)
    observations: int = 0

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.west + self.east) / 2.0, (self.south + self.north) / 2.0)

    def contains(self, lon: float, lat: float) -> bool:
        return self.west <= lon < self.east and self.south <= lat < self.north


def chunk_grid(bbox: dict, *, size_m: float = CHUNK_SIZE_M) -> dict[str, Chunk]:
    """Lay a metric grid over a lon/lat bounding box.

    The grid is built in metres and converted back, so chunks are square on the ground rather
    than square in degrees -- at this latitude a degree box is half again as wide as it is tall.
    """
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0,
                       (bbox["west"] + bbox["east"]) / 2.0)
    x0, y0 = frame.to_xy(bbox["west"], bbox["south"])
    x1, y1 = frame.to_xy(bbox["east"], bbox["north"])
    cols = max(1, math.ceil((x1 - x0) / size_m))
    rows = max(1, math.ceil((y1 - y0) / size_m))
    chunks: dict[str, Chunk] = {}
    for col in range(cols):
        for row in range(rows):
            west, south = frame.to_lonlat(x0 + col * size_m, y0 + row * size_m)
            east, north = frame.to_lonlat(x0 + (col + 1) * size_m, y0 + (row + 1) * size_m)
            key = f"c{col:02d}r{row:02d}"
            chunks[key] = Chunk(key, col, row, west, south, east, north)
    return chunks


def assign(chunks: dict[str, Chunk], lon: float, lat: float) -> Chunk | None:
    for chunk in chunks.values():
        if chunk.contains(lon, lat):
            return chunk
    return None


def index_by_cell(chunks: dict[str, Chunk]) -> "ChunkIndex":
    return ChunkIndex(chunks)


class ChunkIndex:
    """Point-in-chunk lookup in constant time rather than by scanning every chunk.

    With sixteen thousand buildings and a quarter of a million observations, a linear scan over
    a few hundred chunks is a few hundred million comparisons -- minutes, for arithmetic that
    should be instant.
    """

    def __init__(self, chunks: dict[str, Chunk]) -> None:
        self._chunks = chunks
        first = next(iter(chunks.values()))
        by_col = sorted({c.col for c in chunks.values()})
        self._west = min(c.west for c in chunks.values())
        self._south = min(c.south for c in chunks.values())
        self._dlon = first.east - first.west
        self._dlat = first.north - first.south
        self._cols = len(by_col)
        self._rows = len({c.row for c in chunks.values()})

    def find(self, lon: float, lat: float) -> Chunk | None:
        col = int((lon - self._west) / self._dlon)
        row = int((lat - self._south) / self._dlat)
        if not (0 <= col < self._cols and 0 <= row < self._rows):
            return None
        return self._chunks.get(f"c{col:02d}r{row:02d}")
