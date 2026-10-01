"""Swiss Dwellings v3 into layout templates: one template per building, every storey in it.

The archive's ``geometries.csv`` holds 3.26 million polygons -- rooms, walls, railings, columns,
windows, doors, fixtures -- each tagged with its site, building, floor, unit and apartment,
with the floor's elevation and the element's height. Rows for different buildings are
interleaved, so the file is read in a few passes, each gathering a group of buildings, instead
of holding all of it at once.
"""

from __future__ import annotations

import csv
import io
import sys
import zipfile
from collections import Counter, defaultdict
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from smc.interiors.geometry import polygons_from_wkt
from smc.interiors.schema import LayoutTemplate, Opening, Room, Storey, Structure, kind_of
from smc.interiors.sources import by_key

MEMBER = "swiss-dwellings-v3.0.0/geometries.csv"
ROWS_PER_PASS = 700_000
OPENING_KIND = {"WINDOW": "window", "DOOR": "door", "ENTRANCE_DOOR": "entrance"}
STRUCTURE_KIND = {"WALL": "wall", "RAILING": "railing", "COLUMN": "column"}


def _rows(archive: Path) -> Iterator[dict]:
    csv.field_size_limit(sys.maxsize)
    with zipfile.ZipFile(archive) as z, z.open(MEMBER) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8"))


def _float(text: str) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _outer(wkt: str) -> np.ndarray | None:
    polys = polygons_from_wkt(wkt)
    if not polys:
        return None
    return max((p[0] for p in polys), key=len)


def _building(building_id: str, rows: list[dict]) -> LayoutTemplate:
    by_floor: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_floor[row["floor_id"]].append(row)
    floors = sorted(by_floor.items(), key=lambda kv: _float(kv[1][0]["elevation"]) or 0.0)
    storeys = []
    for level, (_floor_id, members) in enumerate(floors):
        rooms, structure, openings, fixtures = [], [], [], []
        heights = [_float(r["height"]) for r in members if r["entity_type"] == "area"]
        for r in members:
            ring = _outer(r["geometry"])
            if ring is None or len(ring) < 3:
                continue
            kind, sub = r["entity_type"], r["entity_subtype"]
            if kind == "area":
                rooms.append(Room(kind_of(sub), sub, ring, r["unit_id"] or None))
            elif kind == "separator":
                structure.append(Structure(STRUCTURE_KIND.get(sub, sub.lower()), ring))
            elif kind == "opening":
                openings.append(Opening(OPENING_KIND.get(sub, sub.lower()), ring,
                                        None, _float(r["height"])))
            elif kind == "feature":
                fixtures.append((sub.lower(), ring))
        valid = [h for h in heights if h]
        storeys.append(Storey(level, _float(members[0]["elevation"]),
                              float(np.median(valid)) if valid else None,
                              tuple(rooms), tuple(structure), tuple(openings), tuple(fixtures)))
    dataset = by_key("swiss_dwellings")
    first = rows[0]
    return LayoutTemplate(
        f"sd:{building_id}", "swiss_dwellings", "building", dataset.license_id,
        "Swiss Dwellings v3.0.0, Archilyse AG, CC BY 4.0 (zenodo.org/records/7788422)",
        dataset.url, {"site_id": first["site_id"], "building_id": building_id,
                      "plans": sorted({r["plan_id"] for r in rows}),
                      "apartments": len({r["apartment_id"] for r in rows if r["apartment_id"]})},
        tuple(storeys), dataset.commercial_use,
        ("local coordinates: the dataset is published without positions",))


def templates(archive: Path, progress=print, limit: int | None = None) -> Iterator[LayoutTemplate]:
    """Every building in the archive, a pass over the file per group of buildings."""
    counts: Counter[str] = Counter(row["building_id"] for row in _rows(archive))
    order = sorted(counts)
    if limit:
        order = order[:limit]
    groups: list[set[str]] = [set()]
    running = 0
    for building in order:
        if running + counts[building] > ROWS_PER_PASS and groups[-1]:
            groups.append(set())
            running = 0
        groups[-1].add(building)
        running += counts[building]
    progress(f"swiss dwellings: {len(order)} buildings in {len(groups)} passes")
    for number, group in enumerate(groups, start=1):
        gathered: dict[str, list[dict]] = defaultdict(list)
        for row in _rows(archive):
            if row["building_id"] in group:
                gathered[row["building_id"]].append(row)
        for building_id in sorted(gathered):
            yield _building(building_id, gathered[building_id])
        progress(f"  pass {number}/{len(groups)}: {len(gathered)} buildings")
