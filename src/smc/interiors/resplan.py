"""ResPlan into layout templates: one single-level template per plan.

The archive is a Python pickle. Unpickling runs whatever code a pickle names, so it is read
through a restricted unpickler that allows exactly the three things this file was found to
reference (``shapely.io.from_wkb``, numpy's scalar and dtype -- listed with pickletools, which
executes nothing) and replaces the shapely call with one that keeps the raw WKB bytes. No other
code can run, and shapely is not needed: the WKB is read by :mod:`smc.interiors.geometry`.
"""

from __future__ import annotations

import io
import math
import pickle
import zipfile
from collections.abc import Iterator
from pathlib import Path

from smc.interiors.geometry import area, polygons_from_wkb
from smc.interiors.schema import LayoutTemplate, Opening, Room, Storey, Structure, kind_of
from smc.interiors.sources import by_key

MEMBER = "ResPlan.pkl"
ROOMS = ("living", "kitchen", "bedroom", "bathroom", "balcony", "storage", "stair",
         "garden", "parking", "pool")
OPENINGS = {"window": "window", "door": "door", "front_door": "entrance"}


class _Wkb(bytes):
    """Geometry kept as the WKB bytes it was pickled from."""


def _from_wkb(data, *args, **kwargs):  # stands in for shapely.io.from_wkb
    return _Wkb(data)


class _Restricted(pickle.Unpickler):
    ALLOWED = frozenset({("numpy._core.multiarray", "scalar"), ("numpy", "dtype")})

    def find_class(self, module: str, name: str):
        if (module, name) == ("shapely.io", "from_wkb"):
            return _from_wkb
        if (module, name) in self.ALLOWED:
            return super().find_class(module, name)
        raise pickle.UnpicklingError(f"refused to load {module}.{name}")


def load(archive: Path) -> list[dict]:
    with zipfile.ZipFile(archive) as z:
        return _Restricted(io.BytesIO(z.read(MEMBER))).load()


def _polys(value) -> list:
    if not isinstance(value, bytes) or len(value) <= 9:
        return []
    return [p[0] for p in polygons_from_wkb(value) if len(p[0]) >= 3]


#: A plan's walls, at the scale found for it, must come out this thick (the dataset's own
#: statement: wall thickness 10-40 cm for 99.3% of plans) or the scale is not trusted.
WALL_M = (0.08, 0.45)


def metric_scale(plan: dict) -> tuple[float | None, str]:
    """Metres per canvas unit for one plan, and how it was found.

    The plans are drawn on a 256-unit canvas; each carries its real area in square metres. The
    gross area over the interior-and-walls polygons gives the scale; the net area over the
    interior is the fallback. Either must make the plan's walls a plausible thickness."""
    inner = sum(abs(area(r)) for r in _polys(plan.get("inner")))
    walls = sum(abs(area(r)) for r in _polys(plan.get("wall")))
    depth = plan.get("wall_depth")
    candidates = []
    if plan.get("area") and inner + walls > 0:
        candidates.append(("gross area / (interior + walls)",
                           math.sqrt(float(plan["area"]) / (inner + walls))))
    if plan.get("net_area") and inner > 0:
        candidates.append(("net area / interior", math.sqrt(float(plan["net_area"]) / inner)))
    for how, scale in candidates:
        if depth and WALL_M[0] <= float(depth) * scale <= WALL_M[1]:
            return scale, how
    return None, "no scale found makes the walls a plausible thickness"


def _scaled(ring, scale: float):
    return ring * scale


def templates(archive: Path, progress=print, limit: int | None = None) -> Iterator[LayoutTemplate]:
    plans = load(archive)
    progress(f"resplan: {len(plans)} plans")
    dataset = by_key("resplan")
    refused = 0
    for plan in plans[:limit] if limit else plans:
        scale, how = metric_scale(plan)
        if scale is None:
            refused += 1
            continue
        rooms = tuple(Room(kind_of(name), name, _scaled(ring, scale)) for name in ROOMS
                      for ring in _polys(plan.get(name)))
        structure = tuple(Structure("wall", _scaled(ring, scale))
                          for ring in _polys(plan.get("wall")))
        openings = tuple(Opening(kind, _scaled(ring, scale)) for key, kind in OPENINGS.items()
                         for ring in _polys(plan.get(key)))
        storey = Storey(0, 0.0, None, rooms, structure, openings)
        yield LayoutTemplate(
            f"resplan:{plan['id']}", "resplan", "unit", dataset.license_id,
            "ResPlan (Agour et al., 2025), CC BY 4.0 (github.com/m-agour/ResPlan)", dataset.url,
            {"id": int(plan["id"]), "area_m2": float(plan.get("area") or 0),
             "net_area_m2": float(plan.get("net_area") or 0),
             "metres_per_unit": round(scale, 6), "scale_from": how},
            (storey,), dataset.commercial_use, ("single level; storey height not recorded",
                                                "drawn on a 256-unit canvas; scaled per plan"))
    progress(f"resplan: {refused} plans refused: no scale made their walls plausible")
