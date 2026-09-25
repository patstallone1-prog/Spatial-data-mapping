"""The quadtree the viewer streams: where each tile is, how wrong it is, and what is in it.

The map used to be one region at a time. A page loaded its region whole, drew every kerb of
it at once, and past the region's box there was nothing -- so the far side of the bay was a
green plate, and reaching another region meant loading another page. Both halves of that are
wrong for a Bay Area: the far city has to be there (crudely is fine), and walking east out of
downtown Oakland has to arrive somewhere.

So: one tree over the whole area, rooted on the atlas's box (smc.terrain.perimeter, which
already reaches five miles past every region). Each tile is a square; each has four children
covering its quarters; a tile exists only where there is something in it, so the tree is
sparse and deep only over the built regions.

What makes it silent is the *geometric error*: the metre-scale of the detail a tile leaves
out. A tile's error halves with depth, from ROOT_ERROR_M at the root to LEAF_ERROR_M at the
leaves -- the scale of a kerb. The viewer turns that into pixels (``screen_error``) and asks
for the children only when the tile it is drawing would be visibly wrong. Nothing in the tree
is chosen by zoom level.
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

#: How deep the tree goes. The root is the whole Bay Area; at MAX_DEPTH a tile is about 300 m
#: a side -- the block the walker stands in, and the size the Unreal export already uses.
MAX_DEPTH = 8

#: What each depth is *wrong by*, in metres, from the content it carries -- not from halving
#: the depth above it. The error is a property of the simplification, and the simplifications
#: are not evenly spaced: the step from crude massing to the real footprint is worth far more
#: than the step from a 20 m generalisation to a 10 m one. Set by halving instead, a real
#: building only appeared inside 400 m and the city was blocks from any height worth the name.
#:
#: These are what decide, through screen_error, when each thing appears. At 900 px and 50
#: degrees: massing out to 8 km, roads to 4.8, real footprints inside 970 m, kerbs inside
#: 390, the full street inside 130.
ERROR_AT_DEPTH = (60.0, 25.0, 15.0, 9.0, 5.0, 3.0, 1.2, 0.5, 0.15)
#: The leaf: full detail, and the error the kerb line itself is drawn to.
LEAF_ERROR_M = ERROR_AT_DEPTH[MAX_DEPTH]
ROOT_ERROR_M = ERROR_AT_DEPTH[0]


def error_at(depth: int) -> float:
    """The geometric error of a tile at ``depth``: what it leaves out, in metres."""
    return ERROR_AT_DEPTH[min(max(depth, 0), MAX_DEPTH)]


#: What each depth carries. A tile is a complete picture of its square at its own error, so
#: refining replaces rather than adds: showing a tile's children hides the tile.
#:
#: The tiers, in the language of the plan this was built to: the root is the Bay Area
#: silhouette (L0) -- terrain, water and bridges, which the atlas already gives every page at
#: no cost; depth 1-3 the skyline and major roads (L1); 4-5 massing and every road (L2-L3);
#: 6 real building shapes (L4); 7-8 the street itself -- carriageway, footways, crossings
#: (L5); and inside a built region the page's own street renderer is L6, from its kerb
#: readings to its facades.
LAYERS_AT_DEPTH: dict[int, tuple[str, ...]] = {
    0: (),
    1: ("massing",),
    2: ("massing", "roads_major"),
    3: ("massing", "roads_major"),
    4: ("massing", "roads"),
    5: ("massing", "roads"),
    6: ("buildings", "roads"),
    7: ("buildings", "carriageway", "pavement"),
    8: ("buildings", "carriageway", "pavement",
        "crossings_continental", "crossings_parallel"),
}
#: The deepest tile built. At depth 8 a tile is about 300 m -- the block you stand in -- and
#: carries the street as a street: the carriageway at the width the model drew, the footways
#: either side of it, the crossings, and the buildings with the colour their photographs gave
#: them. It is not the region renderer's leaf, which knows every kerb and every sign; it is
#: enough of a city to fly into and stand in, anywhere in the Bay Area, without loading a
#: page for it.
DEEPEST_BUILT = 8


def layers_for(depth: int) -> tuple[str, ...]:
    """The layers a tile at ``depth`` carries. A tile is a complete picture of its square at
    its own error, so this is what it holds, not what it adds to its parent."""
    return LAYERS_AT_DEPTH.get(min(max(depth, 0), MAX_DEPTH), ())


@dataclass(frozen=True)
class Frame:
    """The root square, in lon/lat with a metre scale at its middle."""

    west: float
    south: float
    east: float
    north: float

    @property
    def mid_lat(self) -> float:
        return (self.south + self.north) / 2.0

    @property
    def mid_lon(self) -> float:
        return (self.west + self.east) / 2.0

    @property
    def metres_per_lat(self) -> float:
        return 111_320.0

    @property
    def metres_per_lon(self) -> float:
        return self.metres_per_lat * math.cos(math.radians(self.mid_lat))

    @property
    def span_m(self) -> float:
        """The root's side, in metres: the larger of the two, so the tree covers the box."""
        return max((self.east - self.west) * self.metres_per_lon,
                   (self.north - self.south) * self.metres_per_lat)

    def squared(self) -> Frame:
        """The same box grown to a square about its middle: quadtree children stay square."""
        half_lon = self.span_m / self.metres_per_lon / 2.0
        half_lat = self.span_m / self.metres_per_lat / 2.0
        return Frame(self.mid_lon - half_lon, self.mid_lat - half_lat,
                     self.mid_lon + half_lon, self.mid_lat + half_lat)

    def to_json(self) -> dict[str, float]:
        return {"west": round(self.west, 7), "south": round(self.south, 7),
                "east": round(self.east, 7), "north": round(self.north, 7)}


@dataclass(frozen=True)
class TileId:
    depth: int
    x: int
    y: int

    def __str__(self) -> str:
        return f"{self.depth}/{self.x}/{self.y}"

    @property
    def children(self) -> tuple[TileId, ...]:
        return tuple(TileId(self.depth + 1, self.x * 2 + dx, self.y * 2 + dy)
                     for dy in (0, 1) for dx in (0, 1))

    @property
    def parent(self) -> TileId | None:
        return None if self.depth == 0 else TileId(self.depth - 1, self.x // 2, self.y // 2)


def tile_box(root: Frame, tile: TileId) -> Frame:
    """The lon/lat box of one tile of the tree rooted on ``root`` (which must be squared)."""
    n = 2 ** tile.depth
    dlon = (root.east - root.west) / n
    dlat = (root.north - root.south) / n
    west = root.west + tile.x * dlon
    south = root.south + tile.y * dlat
    return Frame(west, south, west + dlon, south + dlat)


def tile_at(root: Frame, depth: int, lon: float, lat: float) -> TileId:
    """The tile of ``depth`` a point falls in, clamped to the tree."""
    n = 2 ** depth
    x = int((lon - root.west) / ((root.east - root.west) / n))
    y = int((lat - root.south) / ((root.north - root.south) / n))
    return TileId(depth, min(max(x, 0), n - 1), min(max(y, 0), n - 1))


def tiles_covering(root: Frame, depth: int, box: dict[str, float]) -> Iterator[TileId]:
    """Every tile of ``depth`` a lon/lat box touches."""
    a = tile_at(root, depth, box["west"], box["south"])
    b = tile_at(root, depth, box["east"], box["north"])
    for y in range(a.y, b.y + 1):
        for x in range(a.x, b.x + 1):
            yield TileId(depth, x, y)


def screen_error(geometric_error_m: float, distance_m: float,
                 screen_height_px: float, fov_deg: float) -> float:
    """How many pixels of error a tile's own representation would show from here.

    The same rule the viewer applies, kept here so the build can check its own numbers: a
    tile's error, projected. ``focal`` is the pinhole focal length in pixels for this view.
    """
    if distance_m <= 1e-6:
        return float("inf")
    focal = screen_height_px / (2.0 * math.tan(math.radians(fov_deg) / 2.0))
    return geometric_error_m * focal / distance_m


def refine_distance_m(depth: int, max_screen_error_px: float,
                      screen_height_px: float, fov_deg: float) -> float:
    """The distance inside which a tile of ``depth`` is no longer good enough. The viewer
    never uses this -- it measures the error it actually has -- but it is what the ranges in
    the manifest mean, and what the build reports."""
    focal = screen_height_px / (2.0 * math.tan(math.radians(fov_deg) / 2.0))
    return error_at(depth) * focal / max_screen_error_px


@dataclass
class Tile:
    """One tile of the tree as it is written: what is in it, how wrong it is, what it costs."""

    id: TileId
    box: Frame
    assets: dict[str, dict[str, Any]] = field(default_factory=dict)
    children: list[TileId] = field(default_factory=list)

    @property
    def geometric_error_m(self) -> float:
        return error_at(self.id.depth)

    @property
    def bytes(self) -> int:
        return sum(int(a.get("bytes", 0)) for a in self.assets.values())

    def to_json(self) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "bbox": [self.box.west, self.box.south, self.box.east, self.box.north],
            "geometric_error_m": round(self.geometric_error_m, 4),
            "children": [str(c) for c in self.children],
            "assets": self.assets,
        }
