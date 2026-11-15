"""The city's stop signs as clean paint facts.

SFMTA publishes a row for every approach a stop sign governs (DataSF 4542-gpa3, public domain):
the junction's position, the street the sign is on, the street it meets, and the way the
traffic it stops is travelling (``st_facing``: ``EB`` on Chestnut at Pierce is the eastbound
approach, whose sign stands on the south-west corner). That is exactly what the paint needs --
a stop line and STOP across the lane on that approach -- and it does not depend on anybody
having mapped a crosswalk there.

The rows are not clean. Some have no position, or one outside the city; some have no facing;
a sign replaced under a new work order is listed again; streets are spelled as the sign shop
spells them (``22ND ST``, ``RADIO``, ``O'FARRELL``). Everything the page would otherwise have
to guess at is settled here, and what is dropped is counted by reason so the build says what it
did. Nothing is invented: a row that cannot be placed is left out, not repaired.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Iterable
from typing import Any

SCHEMA = "kerbside.street_paint/1"

#: San Francisco, generously: a row outside this is a typing error, not a stop sign.
CITY_BOX = (-122.52, 37.70, -122.35, 37.84)
#: The way the stopped traffic is travelling, as a compass bearing (degrees clockwise of north).
FACING = {"NB": 0.0, "NE": 45.0, "EB": 90.0, "SE": 135.0, "SB": 180.0, "SW": 225.0, "WB": 270.0, "NW": 315.0,
          "N": 0.0, "E": 90.0, "S": 180.0, "W": 270.0}
#: Two rows for one approach are within this of each other (the same junction node, redigitised).
SAME_JUNCTION_M = 9.0
#: What a street is called once its kind is taken off: CHESTNUT ST and Chestnut Street are one.
STREET_KINDS = {"ST", "STREET", "AVE", "AV", "AVENUE", "BLVD", "BOULEVARD", "DR", "DRIVE", "RD", "ROAD", "WAY", "WY",
                "CT", "COURT", "PL", "PLACE", "LN", "LANE", "TER", "TERRACE", "HWY", "HIGHWAY", "CIR", "CIRCLE",
                "ALY", "ALLEY", "PLZ", "PLAZA", "WALK", "ROW", "PATH", "LOOP", "PARK", "STWY", "EXPY", "PKWY"}
LON_M, LAT_M = 88_000.0, 111_320.0
PRECISION = 6


def street_key(name: Any) -> str:
    """A street's name as both sources would agree on it: upper case, no kind, no punctuation.

    ``docs/street-paint.mjs`` has the same rule (``streetKey``); a test holds them together.
    """
    text = re.sub(r"[^A-Z0-9 ]", "", str(name or "").upper().replace("-", " "))
    words = [w for w in text.split() if w]
    # 03RD -> 3RD: the sign shop pads its ordinals.
    words = [re.sub(r"^0+(?=\d)", "", w) for w in words]
    while len(words) > 1 and words[-1] in STREET_KINDS:
        words.pop()
    return " ".join(words)


def facing_degrees(value: Any) -> float | None:
    """The bearing the stopped traffic travels on, or ``None`` when the row does not say."""
    return FACING.get(str(value or "").strip().upper())


def _position(row: dict) -> tuple[float, float] | None:
    shape = row.get("shape") or row.get("point") or {}
    coordinates = shape.get("coordinates") if isinstance(shape, dict) else None
    try:
        if coordinates and len(coordinates) >= 2:
            lon, lat = float(coordinates[0]), float(coordinates[1])
        else:
            lon, lat = float(row["longitude"]), float(row["latitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (math.isfinite(lon) and math.isfinite(lat)):
        return None
    return lon, lat


def clean_stop_signs(rows: Iterable[dict], box: tuple[float, float, float, float] = CITY_BOX,
                     ) -> tuple[list[dict], dict[str, int]]:
    """The approaches the city stops, one record each, and what was left out and why.

    A record is ``{"p": [lon, lat], "facing": degrees, "street": key, "cross": key, "id": ...}``:
    the junction, the bearing the stopped traffic travels on, and the two streets' keys.
    """
    dropped: Counter[str] = Counter()
    kept: list[dict] = []
    #: (street, facing) -> the records already kept, for the duplicate test.
    seen: dict[tuple[str, float], list[tuple[float, float]]] = {}
    for row in rows:
        position = _position(row)
        if position is None:
            dropped["no_position"] += 1
            continue
        lon, lat = position
        if not (box[0] <= lon <= box[2] and box[1] <= lat <= box[3]):
            dropped["outside_city"] += 1
            continue
        facing = facing_degrees(row.get("st_facing"))
        if facing is None:
            dropped["no_facing"] += 1
            continue
        street = street_key(row.get("street"))
        if not street:
            dropped["no_street"] += 1
            continue
        near = seen.setdefault((street, facing), [])
        if any(math.hypot((lon - a) * LON_M, (lat - b) * LAT_M) <= SAME_JUNCTION_M for a, b in near):
            dropped["duplicate"] += 1
            continue
        near.append((lon, lat))
        record = {"p": [round(lon, PRECISION), round(lat, PRECISION)], "facing": facing, "street": street,
                  "cross": street_key(row.get("x_street"))}
        identity = row.get("objectid") or row.get("cnn")
        if identity:
            record["id"] = str(identity)
        kept.append(record)
    kept.sort(key=lambda r: (r["p"][1], r["p"][0], r["facing"]))
    return kept, dict(sorted(dropped.items()))


def paint_document(stops: list[dict], dropped: dict[str, int], as_of: str | None = None) -> dict:
    """``docs/street-paint.json``: the facts, where they came from, and what the clean took out."""
    return {
        "schema": SCHEMA,
        "sources": [{"id": "sfmta_stop_signs", "name": "Stop Signs (SFMTA)", "url": "https://data.sfgov.org/d/4542-gpa3",
                     "licence": "Open Data Commons Public Domain Dedication and License", "as_of": as_of}],
        "certainty": "which approach is stopped is the city's record; where the line and the word lie on it is "
                     "the city standard, placed against the drawn kerbs and crosswalks",
        "cleaned": {"kept": len(stops), "dropped": dropped},
        "stop_approaches": stops,
    }
