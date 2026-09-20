"""Which sources a region's build actually stood on -- counted from the payload, not promised.

Discovery says what a source *could* give a region. That is one of three questions, and
the honest answer to each is different:

* **available** -- the source has data over the box (discovery);
* **implemented** -- this project has an extractor that turns that data into facts;
* **active** -- the extractor ran on this build and the facts are in the payload, and how many.

A region whose kerbs are "available: lidar; implemented: yes; active: 0 stations" is a region
whose streets are drawn from the map, and it should say so. This reads the built payload and
writes the three columns per property into capabilities.json under ``activation``.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

#: The extractors this project has, by the property they feed and the source they read.
IMPLEMENTED: dict[str, dict[str, str]] = {
    "kerbs": {"official": "scripts/build_curb_profiles.py (city curb lines)",
              "lidar": "scripts/measure_region_lidar.py (street risers)"},
    "kerb_height": {"lidar": "scripts/measure_region_lidar.py / measure_curbs_lidar.py"},
    "sidewalk_width": {"official": "scripts/build_sf_official_geometry.py (survey)",
                       "lidar": "scripts/measure_curbs_lidar.py (walk run; corridor only so far)"},
    "terrain": {"lidar": "scripts/build_terrain.py"},
    "building_height": {"lidar": "scripts/measure_region_lidar.py (roof over foot)",
                        "official": "DataSF building heights (San Francisco)"},
    "building_colour": {"imagery": "scripts/build_facade_fingerprints.py"},
    "parking": {"official": "SFMTA parking policies", "imagery": "smc.measure.parking_band (no crawl yet)"},
    "curb_ramps": {"official": "SFMTA curb ramp inventory"},
    "signs": {"official": "SFMTA signs"},
    "crossings": {"official": "SFMTA crosswalks"},
    "lanes": {"osm+priors": "smc.facts.cross_section allocate"},
}


def _grade_counts(ways: list[dict]) -> Counter:
    counts: Counter = Counter()
    for way in ways:
        for row in way.get("xs") or ():
            # positional payload: [s, l, r, kerbGrade, status, bands, reasons]
            counts[row[3]] += 1
    return counts


def activation(payload: dict[str, Any], vector: dict[str, str],
               official: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """``official`` is the region's official-geometry sidecar (curb lines, ramps) when it has one."""
    ways = payload.get("ways", [])
    streets = [w for w in ways if w.get("kind") == "street"]
    buildings = [w for w in ways if w.get("kind") == "building"]
    grades = _grade_counts(streets)
    stations = sum(grades.values())
    height_sources = Counter(str(w.get("height_source") or "missing") for w in buildings)
    kerb_sources = Counter(str(w.get("kerb_source") or ("official" if w.get("kerb_m") else "none")) for w in streets)
    colours = sum(1 for w in buildings if w.get("colour"))
    parking_measured = sum(1 for w in streets for row in (w.get("xs") or ())
                           for band in row[5] if band[0] == "p" and band[2] == "I")
    ramps = len((official or {}).get("curb_ramps") or [])
    summary = payload.get("summary", {})
    terrain = summary.get("terrain") or {}

    def row(prop: str, active_source: str | None, count: int, of: int, note: str = "") -> dict[str, Any]:
        available = vector.get(prop, "none")
        implemented = IMPLEMENTED.get(prop, {}).get(available)
        return {"available": available,
                "implemented": bool(implemented), "extractor": implemented,
                "active": active_source if count else "none",
                "count": count, "of": of,
                "truthful": (active_source == available) if count else (available == "none"),
                "note": note}

    kerb_grade = "S" if grades.get("S") else "L" if grades.get("L") else None
    kerb_active = {"S": "official", "L": "lidar"}.get(kerb_grade or "")
    return {
        "kerbs": row("kerbs", kerb_active, grades.get("S", 0) + grades.get("L", 0), stations,
                     f"stations by kerb grade: {dict(grades)}"),
        "kerb_height": row("kerb_height", "lidar" if kerb_sources.get("lidar_region") else
                           ("official" if kerb_sources.get("official") else None),
                           kerb_sources.get("lidar_region", 0) + kerb_sources.get("official", 0), len(streets)),
        "building_height": row("building_height",
                               "lidar" if height_sources.get("lidar_region") or height_sources.get("datasf_lidar_median_height") else "osm",
                               height_sources.get("lidar_region", 0) + height_sources.get("datasf_lidar_median_height", 0),
                               len(buildings), f"by source: {dict(height_sources)}"),
        "building_colour": row("building_colour", "imagery", colours, len(buildings)),
        "terrain": row("terrain", "lidar" if terrain else None, 1 if terrain else 0, 1,
                       f"held-out RMSE {terrain.get('roadway_rmse_m')} m on the roadway" if terrain else "no grid"),
        "parking": row("parking", "imagery", parking_measured, stations,
                       "parking bands graded image; the rest are policy priors"),
        "curb_ramps": row("curb_ramps", "official", ramps, sum(1 for w in ways if w.get("kind") == "crossing"),
                          "the city's ramp inventory, as ramps; crossings end at them in the audit's endsAtRampShare"),
        "lanes": row("lanes", "osm+priors", stations, stations,
                     "every station is an allocation over priors; a measured lane boundary does not exist yet"),
    }
