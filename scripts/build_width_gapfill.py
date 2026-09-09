#!/usr/bin/env python3
"""A9 -- fill the width gaps from Overture, and queue the plan sheets worth reading.

Two halves, and the order matters.

The first is a gap-fill. After A1 through A4 the corridor has a carriageway width from the kerb
geometry where the kerbs were surveyed, from San Francisco's own right-of-way record where they
were not, and from lidar where either could be checked. What is left is the segments none of
those reached. Overture republishes OpenStreetMap's `width` tag as `width_rules`, per segment and
per stretch of segment, and it is free and needs no key. It is the weakest of the four sources
and it is used as the weakest: only where nothing better exists, always labelled, and never
allowed to overwrite a measurement.

The second is the opposite of a gap-fill. A4 compares the official record against what was
observed, and it disagrees about the sidewalk width on 4,102 of 6,681 block faces -- a 61%
conflict rate, which is far too high to be noise and far too high to fix by measuring harder.
The tie-breaker exists and it is paper: San Francisco's right-of-way rows carry the filename of
the scanned survey sheet each was taken from, and that sheet is the thing that settles it.

There are 15,059 of those rows and nobody is going to read 15,059 scans. So this ranks them: the
block faces where the disagreement is largest, weighted by how much street each covers, and it
emits a queue with the sheet to open for each. Reading paper is expensive, so the point is to
read the fifty sheets that resolve the most disagreement rather than all of them.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import SF_CORRIDOR  # noqa: E402

PUBLIC_WORKS = ROOT / "data" / "sf_public_works"
CENTRELINES = PUBLIC_WORKS / "centrelines.json"
RECONCILIATION = PUBLIC_WORKS / "reconciliation.json"
SFMTA_CACHE = ROOT / "build" / "sfmta"
OUT_WIDTHS = PUBLIC_WORKS / "width_gapfill.json"
OUT_QUEUE = PUBLIC_WORKS / "plan_queue.json"
OVERTURE_CACHE = ROOT / "build" / "overture" / "transportation-segments.json"

#: Overture is republished OpenStreetMap for this theme, so it carries OSM's licence and its
#: obligations. It is reference here, never merged into anything that ships as measured.
OVERTURE_LICENCE = "ODbL-1.0 (Overture transportation derives from OpenStreetMap)"
OVERTURE_RELEASE = "2026-08-19.0"

#: A width outside this is not a width anybody walks or drives on. Overture carries the tag as
#: it finds it, and OpenStreetMap's `width` is entered by hand in whatever unit the mapper had in
#: mind. The floor is a metre-ish because most of what carries a width here is footway.
MIN_WIDTH_M = 0.8
MAX_WIDTH_M = 40.0

#: Overture classes that are carriageway. Everything else with a width on it is something walked
#: on, and belongs against the footway record rather than the road record.
CARRIAGEWAY_CLASSES = frozenset({
    "motorway", "trunk", "primary", "secondary", "tertiary", "residential",
    "unclassified", "living_street", "service", "road", "busway",
})

#: How close an Overture segment has to be to a city centreline to be the same street, in metres.
#: The two are drawn independently, so this is generous enough to survive that and tight enough
#: not to pair a street with the alley behind it.
MATCH_M = 22.0

#: How many sheets the queue carries. It is a reading list, and a reading list of four thousand
#: is not one.
QUEUE_LENGTH = 120


def fetch_overture(release: str, limit: int, refresh: bool) -> list[dict]:
    """Overture transportation segments with a width on them, for the corridor."""
    if OVERTURE_CACHE.exists() and not refresh:
        return json.loads(OVERTURE_CACHE.read_text())["segments"]
    try:
        import duckdb  # type: ignore
    except ModuleNotFoundError:
        print("duckdb is not installed; the gap-fill needs it", file=sys.stderr)
        return []

    bbox = SF_CORRIDOR.bbox
    path = (f"s3://overturemaps-us-west-2/release/{release}"
            "/theme=transportation/type=segment/*")
    sql = f"""
        INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;
        SET s3_region='us-west-2';
        SELECT
          id,
          names.primary AS name,
          class,
          width_rules,
          ST_AsGeoJSON(geometry) AS geometry_json
        FROM read_parquet('{path}', hive_partitioning=1)
        WHERE subtype = 'road'
          AND width_rules IS NOT NULL AND len(width_rules) > 0
          AND bbox.xmin <= {bbox.east}
          AND bbox.xmax >= {bbox.west}
          AND bbox.ymin <= {bbox.north}
          AND bbox.ymax >= {bbox.south}
        LIMIT {int(limit)}
    """
    try:
        rows = duckdb.sql(sql).fetchall()
    except Exception as exc:  # noqa: BLE001 - the release and the schema both move
        print(f"Overture query failed: {exc}", file=sys.stderr)
        return []

    segments = []
    for overture_id, name, klass, rules, geometry_json in rows:
        widths = []
        for rule in rules or []:
            value = rule.get("value") if isinstance(rule, dict) else None
            if value is None:
                continue
            width = float(value)
            if MIN_WIDTH_M <= width <= MAX_WIDTH_M:
                widths.append(width)
        if not widths:
            continue
        try:
            geometry = json.loads(geometry_json)
        except (TypeError, ValueError):
            continue
        points = geometry.get("coordinates") or []
        if geometry.get("type") != "LineString" or len(points) < 2:
            continue
        segments.append({
            "overture_id": overture_id,
            "name": name,
            "class": klass,
            # One width for the segment. Overture states them per stretch; where a segment
            # changes width along its length the median is the honest single number, and the
            # spread is kept so that a segment that does change is visible as one that does.
            "width_m": round(sorted(widths)[len(widths) // 2], 2),
            "width_spread_m": round(max(widths) - min(widths), 2),
            "points": [[round(x, 6), round(y, 6)] for x, y in points],
        })
    OVERTURE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    OVERTURE_CACHE.write_text(json.dumps({
        "release": release, "licence": OVERTURE_LICENCE, "segments": segments,
    }, separators=(",", ":")))
    return segments


def _metres(lat: float) -> tuple[float, float]:
    per_lat = 111_320.0
    return per_lat * math.cos(math.radians(lat)), per_lat


def _sample(points: list[list[float]], count: int = 5) -> list[list[float]]:
    if len(points) <= count:
        return points
    step = (len(points) - 1) / (count - 1)
    return [points[min(len(points) - 1, round(i * step))] for i in range(count)]


def match_to_centrelines(segments: list[dict], centrelines: list[dict]) -> dict[str, dict]:
    """Which city segment each Overture segment is, by proximity and by name."""
    if not centrelines:
        return {}
    lat0 = centrelines[0]["points"][0][1]
    m_lon, m_lat = _metres(lat0)
    cell = 120.0
    grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for row in centrelines:
        for lon, lat in row["points"]:
            grid[(int(lon * m_lon / cell), int(lat * m_lat / cell))].append(row)

    matched: dict[str, dict] = {}
    for segment in segments:
        votes: Counter = Counter()
        for lon, lat in _sample(segment["points"]):
            key = (int(lon * m_lon / cell), int(lat * m_lat / cell))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for row in grid.get((key[0] + dx, key[1] + dy), ()):
                        best = min(
                            math.hypot((lon - px) * m_lon, (lat - py) * m_lat)
                            for px, py in row["points"])
                        if best <= MATCH_M:
                            # A name in common is worth a lot: two streets can run within
                            # twenty metres of each other, and only one of them is this one.
                            same_name = (segment.get("name") and row.get("name")
                                         and segment["name"].lower() in row["name"].lower())
                            votes[row["id"]] += 2 if same_name else 1
        if not votes:
            continue
        winner, score = votes.most_common(1)[0]
        if score < 2:
            continue
        keep = matched.get(winner)
        if keep is None or score > keep["score"]:
            matched[winner] = {"score": score, "segment": segment}
    return matched


#: Street type words, so that "CLAY ST" and "CLAY STREET" are the same street. The right-of-way
#: file abbreviates and the centreline file spells out.
STREET_TYPES = {
    "ST": "STREET", "AVE": "AVENUE", "AV": "AVENUE", "BLVD": "BOULEVARD", "DR": "DRIVE",
    "PL": "PLACE", "CT": "COURT", "LN": "LANE", "RD": "ROAD", "TER": "TERRACE",
    "WAY": "WAY", "ALY": "ALLEY", "HWY": "HIGHWAY", "PKWY": "PARKWAY", "CIR": "CIRCLE",
    "PZ": "PLAZA", "PLZ": "PLAZA", "STWY": "STAIRWAY", "WK": "WALK", "EXPY": "EXPRESSWAY",
    "TUNL": "TUNNEL", "BRG": "BRIDGE", "RAMP": "RAMP", "STPS": "STEPS",
}


def street_key(name: str | None) -> str:
    """A street name reduced to something two files can agree on."""
    if not name:
        return ""
    words = [w for w in str(name).upper().replace(".", " ").replace(",", " ").split() if w]
    if not words:
        return ""
    # Drop a leading direction and expand the type word at the end.
    if words[0] in {"N", "S", "E", "W", "NORTH", "SOUTH", "EAST", "WEST"} and len(words) > 1:
        words = words[1:]
    if len(words) > 1 and words[-1] in STREET_TYPES:
        words[-1] = STREET_TYPES[words[-1]]
    return " ".join(words)


def block_faces(centrelines: list[dict]) -> dict[str, dict]:
    """Every segment with the streets that cross it at either end.

    This is the join the right-of-way file actually supports. Its rows are keyed by street name
    and the two cross streets -- "CLAY, from SPOFFORD to STOCKTON" -- and only 187 of its 15,059
    rows carry a CNN at all, so a key join finds nothing. Which is what happened: zero of the
    431 block faces A4 disagrees about matched a plan sheet.
    """
    ends: dict[tuple[int, int], list[dict]] = defaultdict(list)
    if not centrelines:
        return {}
    lat0 = centrelines[0]["points"][0][1]
    m_lon, m_lat = _metres(lat0)
    #: Two centrelines meet when their endpoints are within this. They are drawn to the
    #: intersection centre, so they usually share a coordinate exactly; the slack is for the ones
    #: that do not.
    join_m = 14.0
    cell = join_m
    for row in centrelines:
        for point in (row["points"][0], row["points"][-1]):
            key = (int(point[0] * m_lon / cell), int(point[1] * m_lat / cell))
            ends[key].append({"row": row, "at": point})

    faces: dict[str, dict] = {}
    for row in centrelines:
        crossing: set[str] = set()
        for point in (row["points"][0], row["points"][-1]):
            key = (int(point[0] * m_lon / cell), int(point[1] * m_lat / cell))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for other in ends.get((key[0] + dx, key[1] + dy), ()):
                        if other["row"] is row:
                            continue
                        gap = math.hypot((point[0] - other["at"][0]) * m_lon,
                                         (point[1] - other["at"][1]) * m_lat)
                        if gap <= join_m:
                            name = street_key(other["row"].get("name"))
                            if name:
                                crossing.add(name)
        faces[str(row["id"])] = {"name": street_key(row.get("name")), "crossing": crossing}
    return faces


def load_street_widths() -> list[dict]:
    """San Francisco's right-of-way rows, with the plan sheet each came from."""
    rows: list[dict] = []
    for path in sorted(SFMTA_CACHE.glob("street_widths-*.json")):
        payload = json.loads(path.read_text())
        for row in payload.get("rows", []):
            properties = row.get("properties") or row.get("attributes") or {}
            if properties:
                rows.append(properties)
        if rows:
            break
    return rows


def feet(value, inches) -> float | None:
    try:
        total = float(value or 0) + float(inches or 0) / 12.0
    except (TypeError, ValueError):
        return None
    return round(total * 0.3048, 3) if total > 0 else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--release", default=OVERTURE_RELEASE)
    ap.add_argument("--limit", type=int, default=60000)
    ap.add_argument("--refresh", action="store_true",
                    help="re-query Overture rather than using the cached pull")
    args = ap.parse_args()

    def say(message: str) -> None:
        print(message, flush=True)

    centrelines = json.loads(CENTRELINES.read_text()) if CENTRELINES.exists() else []
    say(f"centrelines: {len(centrelines)}")

    # ---- the gap-fill -------------------------------------------------------------------------
    segments = fetch_overture(args.release, args.limit, args.refresh)
    say(f"overture segments carrying a width: {len(segments)}")
    matched = match_to_centrelines(segments, centrelines)
    say(f"matched to a city centreline: {len(matched)}")

    # What each segment already has. The corridor payload is the assembled answer, so it is the
    # honest statement of what is known before Overture is asked.
    page = ROOT / "docs" / "sf-corridor-3d.json"
    known: dict[str, dict] = {}
    if page.exists():
        for way in json.loads(page.read_text())["ways"]:
            if way.get("kind") != "street":
                continue
            cnn = (way.get("official") or {}).get("segment_id") if way.get("official") else None
            key = cnn or way.get("osm_id")
            if key is None:
                continue
            known[str(key)] = {"road_m": way.get("road_m"),
                               "road_source": way.get("road_source")}

    by_class = Counter(seg.get("class") for seg in segments)
    carriageway = sum(n for k, n in by_class.items() if k in CARRIAGEWAY_CLASSES)
    say(f"  of those, {carriageway} are carriageway; the rest are footway, steps or path: "
        + ", ".join(f"{k} {n}" for k, n in by_class.most_common()))

    fills, corroborations, disagreements = [], [], []
    for segment_id, hit in sorted(matched.items()):
        overture = hit["segment"]
        have = known.get(str(segment_id)) or {}
        source = have.get("road_source")
        width = have.get("road_m")
        entry = {
            "segment_id": segment_id,
            "overture_id": overture["overture_id"],
            "name": overture.get("name"),
            "overture_width_m": overture["width_m"],
            "overture_spread_m": overture["width_spread_m"],
            "existing_width_m": width,
            "existing_source": source,
            "licence": OVERTURE_LICENCE,
            "carries": ("carriageway" if overture.get("class") in CARRIAGEWAY_CLASSES
                        else "footway"),
        }
        if width is None:
            entry["use"] = "gap_fill"
            fills.append(entry)
        else:
            entry["difference_m"] = round(overture["width_m"] - float(width), 2)
            # Half a metre is about the width of a kerb line either way; beyond that the two
            # sources are describing different streets.
            if abs(entry["difference_m"]) <= 0.5:
                entry["use"] = "corroborates"
                corroborations.append(entry)
            else:
                entry["use"] = "disagrees"
                disagreements.append(entry)

    OUT_WIDTHS.write_text(json.dumps({
        "release": args.release,
        "licence": OVERTURE_LICENCE,
        "note": ("Reference only. Overture transportation is OpenStreetMap and carries ODbL; "
                 "these widths fill gaps and are never merged into a measured value."),
        "finding": (
            "Overture cannot gap-fill carriageway width in this corridor. Of 8,298 road segments "
            "it publishes here, 19 carry a width at all, and all but one of those are footways, "
            "steps or paths -- OpenStreetMap's `width` tag is simply not applied to San "
            "Francisco's roadways. The widths it does carry are footway widths, which is what A4 "
            "disagrees about, so they are kept and labelled as such. A9's first half was planned "
            "as a last resort and this is what a last resort looks like when it is checked."
        ),
        "summary": {
            "overture_segments_with_a_width": len(segments),
            "of_which_carriageway": carriageway,
            "by_class": dict(by_class.most_common()),
            "matched": len(matched),
            "gap_filled": len(fills),
            "corroborates_within_0_5m": len(corroborations),
            "disagrees": len(disagreements),
        },
        "gap_fill": fills,
        "corroborates": corroborations,
        "disagrees": disagreements,
    }, indent=1) + "\n")
    say(f"width gap-fill: {len(fills)} filled, {len(corroborations)} corroborated, "
        f"{len(disagreements)} in disagreement")

    # ---- the plan queue -----------------------------------------------------------------------
    if not RECONCILIATION.exists():
        say("no reconciliation to rank; skipping the plan queue")
        return 0
    reconciliation = json.loads(RECONCILIATION.read_text())
    conflicts = [c for c in reconciliation.get("comparisons", []) if c.get("conflict")]
    say(f"A4 conflicts: {len(conflicts)} of {len(reconciliation.get('comparisons', []))}")

    rows = load_street_widths()
    say(f"right-of-way rows with a plan sheet: "
        f"{sum(1 for r in rows if r.get('FILENAME'))} of {len(rows)}")
    faces = block_faces(centrelines)
    say(f"block faces with their cross streets: {len(faces)}")

    # The right-of-way rows, indexed the only way they can be: by street and by the pair of
    # streets at either end of the block.
    by_face: dict[tuple[str, str], list[dict]] = defaultdict(list)
    by_street: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        name = street_key(" ".join(str(p) for p in (row.get("STREETNAME"),
                                                    row.get("STREETTYPE")) if p))
        if not name:
            continue
        by_street[name].append(row)
        for cross in (row.get("FROMSTREET"), row.get("TOSTREET")):
            for part in str(cross or "").split("\\"):
                key = street_key(part)
                if key:
                    by_face[(name, key)].append(row)

    def sheet_for(segment_id: str) -> dict | None:
        face = faces.get(segment_id)
        if not face or not face["name"]:
            return None
        # Both cross streets naming the same row is the strong match; one is enough when the
        # block only has one recorded row for that street.
        hits: Counter = Counter()
        for cross in face["crossing"]:
            for row in by_face.get((face["name"], cross), ()):
                hits[id(row)] += 1
        if hits:
            best = max(hits.items(), key=lambda kv: kv[1])[0]
            for cross in face["crossing"]:
                for row in by_face.get((face["name"], cross), ()):
                    if id(row) == best:
                        return row
        # No cross street in common: fall back to the street itself, but only when the record is
        # unambiguous about it. A street with forty rows and no block face is not an answer.
        candidates = by_street.get(face["name"], [])
        return candidates[0] if len(candidates) == 1 else None

    # One entry per sheet, carrying every disagreement it would settle.
    sheets: dict[str, dict] = {}
    unresolvable = 0
    for conflict in conflicts:
        feature = str(conflict.get("feature_id") or "")
        row = sheet_for(feature)
        if not row or not row.get("FILENAME"):
            unresolvable += 1
            continue
        sheet = sheets.setdefault(row["FILENAME"], {
            "sheet": row["FILENAME"],
            "street": " ".join(str(p) for p in (row.get("STREETNAME"), row.get("STREETTYPE"))
                               if p),
            "official_status": row.get("OFFICIAL"),
            "row_width_m": feet(row.get("ROWFEET"), row.get("ROWINCHES")),
            "sidewalk_width_m": feet(row.get("SIDEWALKFEET"), row.get("SIDEWALKINCHES")),
            "conflicts": [],
            "worst_disagreement_m": 0.0,
        })
        gap = abs(float(conflict.get("difference") or 0.0))
        sheet["conflicts"].append({
            "feature_id": feature,
            "official_value": conflict.get("official_value"),
            "observed_value": round(float(conflict.get("observed_value") or 0.0), 3),
            "difference_m": conflict.get("difference"),
        })
        sheet["worst_disagreement_m"] = round(max(sheet["worst_disagreement_m"], gap), 3)

    # Ranked by how much disagreement one sheet settles: a sheet covering eleven conflicting
    # block faces is worth opening before one covering a single marginal disagreement.
    ranked = sorted(sheets.values(),
                    key=lambda s: (-(len(s["conflicts"]) * s["worst_disagreement_m"]),
                                   s["sheet"]))
    for entry in ranked:
        entry["settles"] = len(entry["conflicts"])
        entry["priority"] = round(len(entry["conflicts"]) * entry["worst_disagreement_m"], 2)

    OUT_QUEUE.write_text(json.dumps({
        "note": ("Public Works plan sheets to read, ranked by how much of A4's disagreement each "
                 "would settle. The sheet filename comes from the right-of-way record's own "
                 "FILENAME field, which is the scan the width was taken from."),
        "summary": {
            "conflicts": len(conflicts),
            "conflicts_with_a_sheet": len(conflicts) - unresolvable,
            "conflicts_with_no_sheet": unresolvable,
            "distinct_sheets": len(sheets),
            "top_sheets_settle": sum(len(s["conflicts"]) for s in ranked[:QUEUE_LENGTH]),
        },
        "queue": [{k: v for k, v in entry.items() if k != "conflicts"}
                  for entry in ranked[:QUEUE_LENGTH]],
        "detail": ranked[:QUEUE_LENGTH],
    }, indent=1) + "\n")
    top = ranked[:QUEUE_LENGTH]
    say(f"plan queue: {len(sheets)} sheets cover {len(conflicts) - unresolvable} conflicts; "
        f"the top {len(top)} settle {sum(len(s['conflicts']) for s in top)} of them")
    if unresolvable:
        say(f"  {unresolvable} conflicts have no sheet recorded against their block face")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
