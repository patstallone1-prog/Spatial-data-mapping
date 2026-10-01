#!/usr/bin/env python3
"""How many storeys every building has, from the best evidence for it -- with no ceiling.

Ranked, per building, first that applies:

1. ``osm levels``: a mapper's ``building:levels`` -- a direct statement of the count.
2. ``measured height / calibrated storey``: the building's measured height (lidar, or a
   mapper's height tag) over the storey height that buildings of that height *have*, calibrated
   against every building in the regions whose storeys are tagged (graded inferred).
3. ``photographed height / calibrated storey``: nothing measured the height, and the facade
   survey saw the roofline.

Why not the photographs' own storey counts? They were scored against the 792 tagged buildings
of the corridor, and lost: storey spacing read from window rows was exactly right for 71 of
369 buildings where the measured height over a flat 3.2 m was right for 110, and storeys from
the photographed roofline for 11 of 104. A street view of a tower is steep and far; its window
rows are the podium's, a crown passes for the roof. A flat 3.2 m was itself biased -- 20% too
many storeys, 26% on towers -- which is what the calibration fixes. The photographed figures
are kept in each record (``photo_height_m``, ``photo_storey_m``) for the day they improve.

Nothing is clamped: a 60-storey tower is 60 storeys. Output: ``<official>/building_storeys.json``
keyed by OSM id -- storeys, the storey height used, the height used, and which rule gave them --
with the calibration and its leave-one-out error against the tagged buildings.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.net import overpass  # noqa: E402
from smc.regions.paths import region_paths  # noqa: E402

MEASURED_SOURCES = {"datasf_lidar_median_height", "lidar_region", "osm_height",
                    "overture_height", "photographed"}
LIDAR_SOURCES = {"datasf_lidar_median_height", "lidar_region"}
#: Height bands (m) the storey height is calibrated in: a house's storeys are not a tower's.
BANDS_M = (0.0, 8.0, 14.0, 25.0, 45.0, 90.0, float("inf"))
#: Below this many tagged buildings a band borrows the pooled storey height.
MIN_BAND_N = 15
#: Used only if no region has a single tagged building with a measured height.
FALLBACK_STOREY_M = 3.5
#: A photographed roofline lower than this is not a building's roof.
MIN_ROOFLINE_M = 2.5
#: Within this fraction a photographed height agrees with a measured one.
AGREES = 0.15
#: A tagged count implying a storey outside this is a typo or a different building part: it is
#: still the building's count, but not used to calibrate.
PLAUSIBLE_STOREY_M = (2.2, 8.0)
REGIONS = ["sf-corridor", "sf-mission", "sf-sunset", "sf-haight-castro", "oakland-downtown",
           "berkeley-downtown", "palo-alto-downtown", "san-jose-downtown"]


def tagged_levels(region: str) -> dict[str, int]:
    """``building:levels`` for every OSM building in the region's box, cached beside its
    official data. The region's own OSM extract drops the tag, so it is asked for here."""
    paths = region_paths(region)
    cache = paths.official / "osm_building_levels.json"
    if cache.exists():
        return json.loads(cache.read_text())["levels"]
    box = json.loads(paths.page.read_text())["bbox"]
    query = (f'[out:json][timeout:150];way["building"]["building:levels"]'
             f'({box["south"]},{box["west"]},{box["north"]},{box["east"]});out tags;')
    levels: dict[str, int] = {}
    for element in overpass(query, "storey calibration")["elements"]:
        try:
            value = int(float(element["tags"]["building:levels"]))
        except (KeyError, ValueError):
            continue
        if value >= 1:
            levels[str(element["id"])] = value
    cache.write_text(json.dumps({"source": "OpenStreetMap building:levels via Overpass (ODbL)",
                                 "levels": levels}, separators=(",", ":")))
    return levels


def _band(height: float) -> int:
    return int(np.searchsorted(BANDS_M, height, side="right") - 1)


def _score(predicted: np.ndarray, truth: np.ndarray) -> dict:
    error = predicted - truth
    return {"exact": int((error == 0).sum()), "within_one": int((np.abs(error) <= 1).sum()),
            "median_abs_error": float(np.median(np.abs(error))),
            "median_ratio": round(float(np.median(predicted / truth)), 3)}


def calibrate(pairs: list[tuple[float, int]]) -> dict:
    """Storey height per height band from (measured height, tagged storeys) pairs, and its
    leave-one-out error: each building predicted from the others."""
    if not pairs:
        return {"pooled_m": FALLBACK_STOREY_M, "bands": [], "validation": None}
    h = np.array([p[0] for p in pairs])
    n = np.array([p[1] for p in pairs])
    per = h / n
    bands = np.array([_band(x) for x in h])
    pooled = float(np.median(per))

    def storey_for(band: int, exclude: int | None = None) -> float:
        mask = bands == band
        if exclude is not None:
            mask = mask.copy()
            mask[exclude] = False
        return float(np.median(per[mask])) if mask.sum() >= MIN_BAND_N else pooled

    loo = np.array([max(1, round(h[i] / storey_for(bands[i], i))) for i in range(len(h))])
    flat = np.array([max(1, round(x / 3.2)) for x in h])
    return {
        "pooled_m": round(pooled, 3),
        "bands": [{"from_m": BANDS_M[b], "to_m": None if BANDS_M[b + 1] == float("inf")
                   else BANDS_M[b + 1], "storey_m": round(storey_for(b), 3),
                   "n": int((bands == b).sum())} for b in range(len(BANDS_M) - 1)],
        "validation": {"tagged_buildings": len(h), "leave_one_out": _score(loo, n),
                       "flat_3_2_m": _score(flat, n)},
    }


def storey_height(calibration: dict, height: float) -> float:
    if not calibration["bands"]:
        return calibration["pooled_m"]
    return calibration["bands"][_band(height)]["storey_m"]


def _ways(region: str) -> list[dict]:
    paths = region_paths(region)
    return [w for w in json.loads(paths.page.read_text()).get("ways", [])
            if w.get("kind") == "building" and w.get("osm_id") is not None]


def build(region: str, calibration: dict, levels: dict[str, int]) -> dict:
    paths = region_paths(region)
    survey = {}
    if (paths.official / "facade_survey.json").exists():
        survey = json.loads((paths.official / "facade_survey.json").read_text()) \
            .get("buildings", {})
    out: dict[str, dict] = {}
    rules: Counter = Counter()
    agreement: Counter = Counter()
    tallest = (0, None)
    for way in _ways(region):
        key = str(way["osm_id"])
        b = (survey.get(key) or {}).get("b") or {}
        height = way.get("height_m")
        source = way.get("height_source")
        measured = height if height and source in MEASURED_SOURCES else None
        photo = b.get("photo_height_m")
        photo = photo if photo and photo >= MIN_ROOFLINE_M else None
        row: dict | None = None
        if key in levels:
            row = {"storeys": levels[key], "height_m": measured,
                   "storey_m": round(measured / levels[key], 2) if measured else None,
                   "rule": "osm levels", "grade": "mapped"}
        elif measured:
            storey = storey_height(calibration, measured)
            row = {"storeys": max(1, round(measured / storey)), "height_m": measured,
                   "storey_m": storey, "rule": f"{source} height / calibrated storey",
                   "grade": "inferred"}
        elif photo:
            storey = storey_height(calibration, photo)
            row = {"storeys": max(1, round(photo / storey)), "height_m": photo,
                   "storey_m": storey, "rule": "photographed height / calibrated storey",
                   "grade": "inferred"}
        elif source == "osm_levels" and height:
            row = {"storeys": max(1, round(height / 3.2)), "height_m": height, "storey_m": 3.2,
                   "rule": "osm levels", "grade": "mapped"}
        if row is None:
            rules["no evidence"] += 1
            continue
        if photo:
            row["photo_height_m"] = photo
            if measured:
                row["photo_agrees"] = abs(photo / measured - 1) <= AGREES
                agreement[row["photo_agrees"]] += 1
        if b.get("storey_m"):
            row["photo_storey_m"] = b["storey_m"]
        out[key] = row
        rules[row["rule"]] += 1
        if row["storeys"] > tallest[0]:
            tallest = (row["storeys"], key)
    (paths.official / "building_storeys.json").write_text(json.dumps(
        {"keyed_by": "osm_id", "note": __doc__.split("\n\n")[1],
         "calibration": calibration, "buildings": out}, separators=(",", ":")))
    return {"region": region, "buildings": len(out), "rules": dict(rules),
            "photo_height_agrees": agreement[True], "photo_height_disagrees": agreement[False],
            "most_storeys": tallest[0], "tallest_osm_id": tallest[1]}


def main() -> int:
    regions = [r for r in (sys.argv[1:] or REGIONS) if region_paths(r).page.exists()]
    # One calibration from every region's tagged buildings: towns differ less in how tall a
    # storey is than any one town's tagged sample varies.
    pairs: list[tuple[float, int]] = []
    levels_by_region = {}
    for region in regions:
        levels_by_region[region] = levels = tagged_levels(region)
        for way in _ways(region):
            n = levels.get(str(way["osm_id"]))
            height = way.get("height_m")
            source = way.get("height_source")
            # Lidar heights only: a mapper's height tag is often computed from the levels tag
            # itself, which would make the calibration circular.
            if n and height and source in LIDAR_SOURCES \
                    and PLAUSIBLE_STOREY_M[0] <= height / n <= PLAUSIBLE_STOREY_M[1]:
                pairs.append((float(height), int(n)))
    calibration = calibrate(pairs)
    print(json.dumps({"calibration": calibration}), flush=True)
    for region in regions:
        print(json.dumps(build(region, calibration, levels_by_region[region])), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
