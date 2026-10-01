#!/usr/bin/env python3
"""Reconstructed world objects for one region: its kerbs, fitted from measured curb lines.

This is the first real use of the geometry compiler (``docs/25-geometry-compiler.md``). Every
curb line the city has surveyed becomes a :class:`smc.world.object.WorldObject` whose shape is
the fitted line itself -- rounded returns stay rounded, square corners stay square, bulb-outs
keep their bulbs -- swept with a kerb section whose height is the lidar measurement for that
street where one exists and the corridor median, graded as such, where it does not.

Outputs:

``data/regions/<region>/world/world_objects.jsonl``
    The canonical objects, one per line, with their evidence and fit records.
``data/regions/<region>/world/summary.json``
    What was built, accepted, simplified and refused, and why lines were skipped.
``<page root>/sf-corridor-world-objects.json`` (the sf-corridor- prefix is what tools/build_pages.py publishes)
    The compiled sidecar the page reads (``smc.world.compile``). The page draws these kerbs
    and leaves out its own width-derived kerb where they stand.

Closed island and median rings are skipped on purpose: the page already raises them from the
same surveyed rings (``addClosedOfficialIslandSurfaces``), and drawing their kerb twice from
one measurement would be two claims about one thing.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402

from smc.geometry.base import Param  # noqa: E402
from smc.geometry.spline import CurveSamples  # noqa: E402
from smc.reconstruction.geo import EnuFrame  # noqa: E402
from smc.reconstruction.geometry_fit import decide, fit_curb_line  # noqa: E402
from smc.world.compile import compile_web  # noqa: E402
from smc.world.object import EvidenceRef, WorldObject  # noqa: E402

#: A curb line is oriented against the nearest street centreline within this reach; one with
#: no street near it cannot be told which side its footway is on, and is skipped with that
#: reason rather than guessed.
SIDE_REACH_M = 40.0
#: The lidar kerb height of a street applies to curb lines within this distance of it.
HEIGHT_REACH_M = 30.0
MIN_LENGTH_M = 1.0
SKIP_ROLES = {"other"}


def page_root(region: str) -> Path:
    return ROOT / "docs" if region == "sf-corridor" else ROOT / "docs" / "regions" / region


def data_root(region: str) -> Path:
    return ROOT / "data" / "regions" / region


class SegmentIndex:
    """Street centreline segments on a grid, for nearest-street lookups in local metres."""

    def __init__(self, frame: EnuFrame, ways: list[dict], cell: float = 50.0) -> None:
        self.cell = cell
        self.grid: dict[tuple[int, int], list[tuple[np.ndarray, np.ndarray, dict]]] = {}
        self.frame = frame
        for way in ways:
            pts = [self._local(lon, lat) for lon, lat in way.get("points", [])]
            for a, b in itertools.pairwise(pts):
                lo = np.minimum(a, b) // cell
                hi = np.maximum(a, b) // cell
                for i in range(int(lo[0]), int(hi[0]) + 1):
                    for j in range(int(lo[1]), int(hi[1]) + 1):
                        self.grid.setdefault((i, j), []).append((a, b, way))

    def _local(self, lon: float, lat: float) -> np.ndarray:
        e, n, _ = self.frame.to_enu(lon, lat, 0.0)
        return np.array([e, n])

    def nearest(self, p: np.ndarray, reach: float) -> tuple[float, np.ndarray, dict] | None:
        best: tuple[float, np.ndarray, dict] | None = None
        r = math.ceil(reach / self.cell)
        ci, cj = int(p[0] // self.cell), int(p[1] // self.cell)
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for a, b, way in self.grid.get((i, j), ()):
                    d = b - a
                    t = float(np.clip((p - a) @ d / max(d @ d, 1e-12), 0.0, 1.0))
                    foot = a + t * d
                    dist = float(np.linalg.norm(p - foot))
                    if dist <= reach and (best is None or dist < best[0]):
                        best = (dist, foot, way)
        return best


def curb_lines(region: str) -> tuple[list[dict], dict]:
    """Every surveyed curb line the region has, as {key, role, points, source...} rows."""
    rows: list[dict] = []
    sources: dict = {}
    official = page_root(region) / "sf-corridor-official.json"
    if official.exists():
        data = json.loads(official.read_text())
        for i, line in enumerate(data.get("curb_lines", [])):
            rows.append({"role": line.get("r") or "other", "points": line["p"],
                         "source_id": "sfmta_curbs",
                         "locator": f"sf-corridor-official.json#curb_lines/{i}",
                         "license_id": "unstated: SFMTA ArcGIS service (MTA.curbs)"})
        sources["sfmta_curbs"] = {"file": str(official.relative_to(ROOT)),
                                  "generated_from": data.get("generated_from"),
                                  "note": "SFMTA curb linework, thinned to 2 cm before publishing"}
    city = data_root(region) / "official" / "city_curb_line.json"
    if city.exists():
        data = json.loads(city.read_text())
        prov = data.get("provenance", {})
        for feature in data.get("features", []):
            geom = feature.get("geometry") or {}
            parts = [geom.get("coordinates", [])] if geom.get("type") == "LineString" else \
                geom.get("coordinates", []) if geom.get("type") == "MultiLineString" else []
            for k, part in enumerate(parts):
                rows.append({"role": "block", "points": part,
                             "source_id": f"{prov.get('city', 'city')}_curb_line",
                             "locator": f"city_curb_line.json#{feature.get('id')}/{k}",
                             "license_id": f"unstated: {prov.get('city', 'city')} ArcGIS service"})
        sources[f"{prov.get('city', 'city')}_curb_line"] = prov
    return rows, sources


def stable_id(points: list[list[float]], role: str) -> str:
    a, b = points[0], points[-1]
    key = f"{role}:{a[0]:.7f},{a[1]:.7f}:{b[0]:.7f},{b[1]:.7f}:{len(points)}"
    return "curb:" + hashlib.sha1(key.encode()).hexdigest()[:16]


def build(region: str, limit: int | None = None) -> dict:
    started = time.time()
    root = page_root(region)
    payload = json.loads((root / "sf-corridor-3d.json").read_text())
    streets = [w for w in payload.get("ways", []) if w.get("kind") == "street" and w.get("points")]
    median_kerb = float(payload.get("kerb_height_m") or 0.126)
    lines, sources = curb_lines(region)
    if limit:
        lines = lines[:limit]
    if not lines:
        raise SystemExit(f"{region}: no surveyed curb lines to build from")
    lon0, lat0 = lines[0]["points"][0]
    frame = EnuFrame(float(lon0), float(lat0), 0.0)
    index = SegmentIndex(frame, streets)
    objects: list[WorldObject] = []
    skipped: Counter = Counter()
    outcomes: Counter = Counter()
    corners: Counter = Counter()
    heights: Counter = Counter()
    for line in lines:
        pts = [p for p in line["points"] if len(p) >= 2]
        if len(pts) < 2 or line["role"] in SKIP_ROLES:
            skipped["no usable geometry or role 'other'"] += 1
            continue
        closed = math.dist(pts[0], pts[-1]) < 1e-7
        if closed and line["role"] in ("island", "median"):
            skipped["closed island/median ring: already raised from the same survey ring"] += 1
            continue
        local = np.array([frame.to_enu(p[0], p[1], 0.0) for p in pts])
        seg = np.linalg.norm(np.diff(local[:, :2], axis=0), axis=1)
        if float(seg.sum()) < MIN_LENGTH_M:
            skipped[f"shorter than {MIN_LENGTH_M} m"] += 1
            continue
        mid = local[len(local) // 2, :2]
        near = index.nearest(mid, SIDE_REACH_M)
        if near is None:
            skipped[f"no street within {SIDE_REACH_M:.0f} m to orient it by"] += 1
            continue
        # The footway is on the side of the kerb away from the road it bounds.
        k = min(len(local) // 2, len(local) - 2)
        direction = local[k + 1, :2] - local[k, :2]
        to_road = near[1] - mid
        cross = direction[0] * to_road[1] - direction[1] * to_road[0]
        side = -1 if cross > 0 else 1
        street = near[2]
        measured = street.get("kerb_m") if near[0] <= HEIGHT_REACH_M else None
        if measured:
            height = Param(float(measured), "lidar", None,
                           f"lidar kerb height of {street.get('name') or 'the street'} "
                           f"(osm:{street.get('osm_id')})")
            heights["lidar"] += 1
        else:
            height = Param(median_kerb, "inferred", None, "corridor median kerb height")
            heights["corridor median"] += 1
        refs = [EvidenceRef("survey_line", line["source_id"], line["locator"],
                            line["license_id"], count=len(pts))]
        if measured:
            refs.append(EvidenceRef("lidar_points", "usgs_3dep",
                                    f"kerb_m:osm:{street.get('osm_id')}",
                                    "public-domain (USGS 3DEP)"))
        anchor = EnuFrame(float(pts[0][0]), float(pts[0][1]), 0.0)
        xyz = np.array([anchor.to_enu(p[0], p[1], 0.0) for p in pts])
        xyz[:, 2] = 0.0  # a survey line is planimetric: the page stands it on its own ground
        samples = CurveSamples(xyz, ordered=True, closed=closed, exact=True)
        base_id = stable_id(pts, line["role"])
        for n, outcome in enumerate(fit_curb_line(samples, tuple(refs), anchor, height=height,
                                                  side=side)):
            decision = decide(outcome, object_id=base_id if n == 0 else f"{base_id}:{n}")
            outcomes[decision.outcome] += 1
            obj = decision.object
            if obj.geometry is not None:
                for c in outcome.parameters["path"]["corners"]:
                    corners[c["kind"]] += 1
            objects.append(obj)
    out_dir = data_root(region) / "world"
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "world_objects.jsonl").open("w") as fh:
        for obj in objects:
            fh.write(json.dumps(obj.to_json(), separators=(",", ":")) + "\n")
    web = compile_web(objects, region=region, sources=sources)
    web_path = root / "sf-corridor-world-objects.json"
    web_path.write_text(json.dumps(web, separators=(",", ":")))
    summary = {
        "region": region, "curb_lines": len(lines), "objects": len(objects),
        "decisions": dict(outcomes), "corners": dict(corners), "heights": dict(heights),
        "skipped": dict(skipped), "web_bytes": web_path.stat().st_size,
        "seconds": round(time.time() - started, 1), "sources": sources,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--limit", type=int, default=None,
                        help="build only the first N curb lines (for a quick look)")
    args = parser.parse_args()
    summary = build(args.region, args.limit)
    print(json.dumps({k: v for k, v in summary.items() if k != "sources"}, indent=2))


if __name__ == "__main__":
    main()
