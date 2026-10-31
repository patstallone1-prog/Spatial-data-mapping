"""A block: the unit the world mesh is built in. Any rectangle on the map, with a halo.

A block owns the triangles whose centroids fall inside its rectangle and no others, so blocks
laid edge to edge cover the world once: a street, a cell, a city, built block by block in any
order and on any machine. Photographs are taken from a halo round it, because the cameras that
see a facade stand across the street from it.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from smc.reconstruction.geo import EnuFrame

#: Cameras up to this far outside the block are used: a street and a pavement's width and some.
HALO_M = 40.0


@dataclass(frozen=True)
class Block:
    name: str
    west: float
    south: float
    east: float
    north: float
    #: The origin's height on the ellipsoid. Street level in San Francisco is about -30 m
    #: (geoid) plus a few metres; any value works -- it only sets where the frame's zero is.
    height_m: float = 0.0
    halo_m: float = HALO_M

    def __post_init__(self) -> None:
        if not (self.west < self.east and self.south < self.north):
            raise ValueError(f"block {self.name}: west < east and south < north")

    @property
    def frame(self) -> EnuFrame:
        return EnuFrame((self.west + self.east) / 2, (self.south + self.north) / 2, self.height_m)

    def halo_bbox(self) -> tuple[float, float, float, float]:
        lat_pad = self.halo_m / 111_320.0
        lon_pad = self.halo_m / (111_320.0 * math.cos(math.radians((self.south + self.north) / 2)))
        return (self.west - lon_pad, self.south - lat_pad, self.east + lon_pad, self.north + lat_pad)

    def bounds_m(self) -> tuple[float, float, float, float]:
        """The block's own rectangle in its frame: west, south, east, north metres."""
        f = self.frame
        w, s, _ = f.to_enu(self.west, self.south, self.height_m)
        e, n, _ = f.to_enu(self.east, self.north, self.height_m)
        return w, s, e, n

    def to_json(self) -> dict:
        return {"name": self.name, "bbox": [self.west, self.south, self.east, self.north],
                "height_m": self.height_m, "halo_m": self.halo_m}


def parse_bbox(text: str) -> tuple[float, float, float, float]:
    west, south, east, north = (float(v) for v in text.split(","))
    return west, south, east, north


def block_for_region(name: str, root: Path) -> Block:
    """A published region or cloud cell by name, from the site's region list (whose boxes are
    south, west, north, east)."""
    data = json.loads((root / "docs/app-regions.json").read_text())
    for row in data["regions"]:
        if row.get("name") == name and row.get("bbox"):
            south, west, north, east = map(float, row["bbox"][:4])
            return Block(name, west, south, east, north)
    raise KeyError(f"no region or cell named {name!r} in the site's region list")


def tiles_of(block: Block, size_m: float) -> list[Block]:
    """``block`` cut into square blocks of about ``size_m``: how a cell is built in parallel."""
    w, s, e, n = block.bounds_m()
    cols, rows = max(1, round((e - w) / size_m)), max(1, round((n - s) / size_m))
    out = []
    for i in range(cols):
        for j in range(rows):
            out.append(Block(f"{block.name}-{i}-{j}",
                             block.west + (block.east - block.west) * i / cols,
                             block.south + (block.north - block.south) * j / rows,
                             block.west + (block.east - block.west) * (i + 1) / cols,
                             block.south + (block.north - block.south) * (j + 1) / rows,
                             block.height_m, block.halo_m))
    return out
