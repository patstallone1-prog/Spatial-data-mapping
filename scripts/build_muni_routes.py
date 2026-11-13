#!/usr/bin/env python3
"""Muni's buses through the living city's district, as the timetable runs them.

From the transit database (scripts/ingest_transit.py: the agencies' GTFS, data/transit/
transit.sqlite; read only) -- SFMTA's, and Golden Gate Transit's commuter buses along Lombard
Street -- for each bus route and direction that calls in the district's box: the stops it calls
at there, in order -- from the first in the box to the last, and two either side, so a bus is
seen coming in and going out -- with the route's number, its name and the destination its sign
shows; the minutes after midnight each trip leaves the first of them, on a weekday, a Saturday
and a Sunday (Muni's three services); and the minutes the timetable gives it from that stop to
each of the others. The city (docs/city/transit.mjs) runs one bus per trip, at the time the
timetable sends it.

    .venv/bin/python scripts/build_muni_routes.py            # -> docs/city/muni-routes.json
    .venv/bin/python scripts/build_muni_routes.py --db PATH  # another copy of the database
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "transit" / "transit.sqlite"
OUT = ROOT / "docs" / "city" / "muni-routes.json"

#: The Marina, the living city's district (docs/city/rules.json cityLock): south, west, north, east.
BBOX = (37.7983, -122.4478, 37.8082, -122.4310)
#: Stops kept either side of the box.
SPILL = 2
#: A pattern run by fewer trips a week than this is a one-off (a pull-in, a detour): left out.
MIN_TRIPS = 3
#: The kinds of day a timetable is run for, by weekday (Monday 0).
DAYS = {"weekday": 4, "saturday": 5, "sunday": 6}
#: The agencies whose buses call in the box (ingest_transit.py's keys).
AGENCIES = ("sfmta", "goldengate")
#: GTFS route_type of a bus.
BUS = "3"


def destination(headsign: str | None) -> str:
    """The place a sign shows: Golden Gate's "Route 101 Northbound - Novato" as "Novato"."""
    text = (headsign or "").replace("`", "'").strip()
    return re.sub(r"^Route \S+ \w+bound\s*-\s*", "", text)


def minutes(hms: str) -> int:
    """GTFS time (may pass 24:00) as whole minutes after the service day's midnight."""
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 60 + m + (1 if s >= 30 else 0)


def inside(lat: float, lon: float) -> bool:
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


def services(db: sqlite3.Connection, agency: str) -> tuple[dict[str, str], dict[str, str]]:
    """Each kind of day's services, and the date they were read for: the feed's last such day.

    Muni's calendar has a service a weekday (1), Saturday (2) and Sunday (3), each replaced
    through calendar_dates for weeks at a time (M11, M21: the summer and the school-term
    weekdays) -- what runs is what the calendar says for that date, exceptions and all.
    """
    cal = list(
        db.execute(
            "SELECT service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, "
            "start_date, end_date FROM calendar WHERE agency = ?",
            (agency,),
        )
    )
    exceptions = defaultdict(list)
    for sid, date, kind in db.execute(
        "SELECT service_id, date, exception_type FROM calendar_dates WHERE agency = ?", (agency,)
    ):
        exceptions[str(date)].append((str(sid), str(kind)))
    if not cal:
        return {}, {}
    end = dt.datetime.strptime(max(str(r[9]) for r in cal), "%Y%m%d").date()
    out, dates = {}, {}
    for day, weekday in DAYS.items():
        date = end - dt.timedelta(days=(end.weekday() - weekday) % 7)
        key = date.strftime("%Y%m%d")
        on = {
            str(r[0]) for r in cal if str(r[1 + weekday]) == "1" and str(r[8]) <= key <= str(r[9])
        }
        for sid, kind in exceptions.get(key, []):
            (on.add if kind == "1" else on.discard)(sid)
        for sid in on:
            out[sid] = day
        dates[day] = key
    return out, dates


def agency_lines(db: sqlite3.Connection, agency: str) -> tuple[list[dict], dict]:
    """One agency's lines through the box, and the dates its timetables were read for."""
    day_of, dates = services(db, agency)
    if not day_of:
        return [], {}
    stops = {
        sid: {
            "id": sid,
            "code": code,
            "name": name,
            "lat": round(float(lat), 6),
            "lon": round(float(lon), 6),
        }
        for sid, code, name, lat, lon in db.execute(
            "SELECT stop_id, stop_code, stop_name, stop_lat, stop_lon FROM stops WHERE agency = ?",
            (agency,),
        )
    }
    boxed = [sid for sid, s in stops.items() if inside(s["lat"], s["lon"])]
    marks = ",".join("?" * len(boxed))
    trip_ids = [
        r[0]
        for r in db.execute(
            f"SELECT DISTINCT trip_id FROM stop_times WHERE agency = ? AND stop_id IN ({marks})",
            [agency, *boxed],
        )
    ]
    trips = {}
    for tid, route_id, service, headsign, direction in db.execute(
        f"SELECT trip_id, route_id, service_id, trip_headsign, direction_id FROM trips "
        f"WHERE agency = ? AND trip_id IN ({','.join('?' * len(trip_ids))})",
        [agency, *trip_ids],
    ):
        trips[tid] = {
            "route_id": route_id,
            "service": str(service),
            "headsign": headsign,
            "direction": str(direction),
        }
    routes = {
        rid: {"short": short, "long": long_name, "colour": colour}
        for rid, short, long_name, colour, kind in db.execute(
            "SELECT route_id, route_short_name, route_long_name, route_color, route_type FROM routes "
            "WHERE agency = ?",
            (agency,),
        )
        if str(kind) == BUS
    }
    calls = defaultdict(list)
    for tid, stop_id, arrive, depart, seq in db.execute(
        f"SELECT trip_id, stop_id, arrival_time, departure_time, stop_sequence FROM stop_times "
        f"WHERE agency = ? AND trip_id IN ({','.join('?' * len(trip_ids))})",
        [agency, *trip_ids],
    ):
        calls[tid].append((int(seq), stop_id, arrive or depart, depart or arrive))

    # Each trip's run through the box: its stops from the first inside to the last, and SPILL more.
    groups: dict[tuple, list] = defaultdict(list)
    for tid, rows in calls.items():
        trip = trips.get(tid)
        if not trip or trip["service"] not in day_of or trip["route_id"] not in routes:
            continue
        rows.sort()
        idx = [
            i
            for i, (_, sid, _, _) in enumerate(rows)
            if sid in stops and inside(stops[sid]["lat"], stops[sid]["lon"])
        ]
        if not idx:
            continue
        a, b = max(0, idx[0] - SPILL), min(len(rows) - 1, idx[-1] + SPILL)
        run = rows[a : b + 1]
        if len(run) < 3:
            continue
        pattern = tuple(sid for _, sid, _, _ in run)
        t0 = minutes(run[0][3])
        offsets = tuple(minutes(r[2]) - t0 for r in run)
        groups[(trip["route_id"], trip["direction"], trip["headsign"], pattern)].append(
            (trip["service"], t0, offsets)
        )

    lines = []
    for (route_id, direction, headsign, pattern), runs in groups.items():
        if len(runs) < MIN_TRIPS:
            continue
        route = routes[route_id]
        departs = {
            day: sorted(t0 for service, t0, _ in runs if day_of[service] == day) for day in DAYS
        }
        # The minutes to each stop: the middle of the trips' (the timetable pads the rush hours).
        offsets = [
            round(statistics.median(o[k] for _, _, o in runs), 1) for k in range(len(pattern))
        ]
        lines.append(
            {
                "agency": agency,
                "route": route["short"] or route_id,
                "name": route["long"].title() if route["long"] else route["short"],
                "direction": int(direction),
                "headsign": destination(headsign),
                "colour": route["colour"],
                "stops": [stops[sid] for sid in pattern],
                "minutes": offsets,
                "departs": departs,
                "trips_a_week": sum(
                    len(departs["weekday"]) * 5 if d == "weekday" else len(departs[d]) for d in DAYS
                ),
            }
        )
    feed = db.execute(
        "SELECT MIN(start_date), MAX(end_date) FROM calendar WHERE agency = ?", (agency,)
    ).fetchone()
    return lines, {"service": [feed[0], feed[1]], **dates}


def build(db: sqlite3.Connection) -> dict:
    lines, read = [], {}
    for agency in AGENCIES:
        found, dates = agency_lines(db, agency)
        if dates:  # (an agency not in the database: none)
            read[agency] = dates
            lines += found
    lines.sort(
        key=lambda x: (
            x["agency"] != "sfmta",
            x["route"].zfill(4),
            x["direction"],
            -x["trips_a_week"],
        )
    )
    when = "; ".join(
        f"{a}: service {r['service'][0]} to {r['service'][1]}, the timetables of {r['weekday']} (a weekday), "
        f"{r['saturday']} and {r['sunday']}"
        for a, r in read.items()
    )
    return {
        "basis": (
            "The agencies' GTFS (scripts/ingest_transit.py -> data/transit/transit.sqlite; "
            f"{when}): each bus route and direction calling in the district's box "
            f"{list(BBOX)} (S, W, N, E), its stops there in order and {SPILL} either side, the "
            "minutes after midnight each trip leaves the first (weekday, Saturday, Sunday "
            "services; past 1440 is after midnight), and the timetable's minutes from it to "
            "each stop (the median of its trips). One entry per stopping pattern run by at least "
            f"{MIN_TRIPS} trips. Built by scripts/build_muni_routes.py."
        ),
        "read": read,
        "zone": "America/Los_Angeles",
        "bbox": list(BBOX),
        "lines": lines,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", type=Path, default=DB)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    db = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    data = build(db)
    args.out.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    for line in data["lines"]:
        d = line["departs"]
        print(
            f"{line['route']:>4} {line['direction']} to {line['headsign']:<22} {len(line['stops']):>2} stops, "
            f"{line['minutes'][-1]:>5} min, {len(d['weekday'])}/{len(d['saturday'])}/{len(d['sunday'])} trips"
        )
    print(f"{args.out}: {args.out.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
