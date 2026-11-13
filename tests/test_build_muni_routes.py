"""scripts/build_muni_routes.py: the district's buses from the GTFS database, as timetabled."""

from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _builder():
    spec = importlib.util.spec_from_file_location(
        "build_muni_routes", ROOT / "scripts/build_muni_routes.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _db(mod, path: str = ":memory:") -> sqlite3.Connection:
    """A feed of one route through the box: stops either side of it, a weekday and a Sunday service
    (the weekday's replaced for the last week by another, as Muni's are), trips each way."""
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE stops (agency, stop_id, stop_code, stop_name, stop_lat TEXT, stop_lon TEXT);
        CREATE TABLE routes (agency, route_id, route_short_name, route_long_name, route_color, route_type);
        CREATE TABLE trips (agency, route_id, service_id, trip_id, trip_headsign, direction_id);
        CREATE TABLE stop_times (agency, trip_id, arrival_time, departure_time, stop_id, stop_sequence TEXT);
        CREATE TABLE calendar (agency, service_id, monday, tuesday, wednesday, thursday, friday, saturday,
                               sunday, start_date, end_date);
        CREATE TABLE calendar_dates (agency, service_id, date, exception_type);
        """
    )
    s, w, n, e = mod.BBOX
    lon = (w + e) / 2
    # Seven stops north to south: two south of the box, three in it, two north.
    lats = [s - 0.004, s - 0.002, s + 0.002, (s + n) / 2, n - 0.002, n + 0.002, n + 0.004]
    for k, lat in enumerate(lats):
        db.execute(
            "INSERT INTO stops VALUES ('sfmta', ?, ?, ?, ?, ?)",
            (f"s{k}", k, f"Stop {k}", str(lat), str(lon)),
        )
    db.execute("INSERT INTO stops VALUES ('sfmta', 'far', 0, 'Far away', '37.70', '-122.40')")
    db.execute("INSERT INTO routes VALUES ('sfmta', 'R22', '22', 'FILLMORE', 'BB0000', '3')")
    db.execute("INSERT INTO routes VALUES ('sfmta', 'RF', 'F', 'MARKET & WHARVES', '', '0')")
    db.executemany(
        "INSERT INTO calendar VALUES ('sfmta', ?, ?, ?, ?, ?, ?, ?, ?, '20260701', '20260828')",
        [("1", 1, 1, 1, 1, 1, 0, 0), ("2", 0, 0, 0, 0, 0, 1, 0), ("3", 0, 0, 0, 0, 0, 0, 1)],
    )
    # The last Friday runs "M21" instead of "1".
    db.executemany(
        "INSERT INTO calendar_dates VALUES ('sfmta', ?, '20260828', ?)", [("1", "2"), ("M21", "1")]
    )
    trips = 0

    def trip(service, direction, headsign, start_min, route="R22"):
        nonlocal trips
        trips += 1
        tid = f"t{trips}"
        db.execute(
            "INSERT INTO trips VALUES ('sfmta', ?, ?, ?, ?, ?)",
            (route, service, tid, headsign, direction),
        )
        order = range(7) if direction == 1 else range(6, -1, -1)
        for seq, k in enumerate(order):
            m = start_min + seq * 2
            hms = f"{m // 60:02d}:{m % 60:02d}:00"
            db.execute(
                "INSERT INTO stop_times VALUES ('sfmta', ?, ?, ?, ?, ?)",
                (tid, hms, hms, f"s{k}", str(seq + 1)),
            )

    for m in (600, 610, 620, 1450):
        trip("M21", 1, "Bay Street", m)
    for m in (605, 615, 625):
        trip("M21", 0, "UCSF Mission Bay", m)
        trip("1", 0, "UCSF Mission Bay", m + 1)  # replaced that day: not run
    for m in (700, 730, 760):
        trip("3", 1, "Bay Street", m)
    for m in (600, 610, 620):
        trip("M21", 1, "Wharf", m, route="RF")  # a streetcar: not a bus
    db.commit()
    return db


def test_the_box_and_the_signs():
    mod = _builder()
    assert mod.inside(37.80, -122.44) and not mod.inside(37.79, -122.44)
    assert mod.minutes("25:10:40") == 25 * 60 + 11
    assert mod.destination("Route 101 Northbound - Novato") == "Novato"
    assert mod.destination("Fisherman`s Wharf") == "Fisherman's Wharf"


def test_a_route_through_the_box_is_kept_as_the_calendar_runs_it():
    mod = _builder()
    lines, read = mod.agency_lines(_db(mod), "sfmta")
    assert read["weekday"] == "20260828" and read["sunday"] == "20260823"
    assert {(x["route"], x["direction"], x["headsign"]) for x in lines} == {
        ("22", 1, "Bay Street"),
        ("22", 0, "UCSF Mission Bay"),
    }
    north = next(x for x in lines if x["direction"] == 1)
    # All seven stops: the three in the box and two either side, in the trips' order.
    assert [s["name"] for s in north["stops"]] == [f"Stop {k}" for k in range(7)]
    assert north["minutes"] == [0, 2, 4, 6, 8, 10, 12]
    # Leaving the first stop at the timetable's minutes; after midnight past 1440.
    assert north["departs"] == {
        "weekday": [600, 610, 620, 1450],
        "saturday": [],
        "sunday": [700, 730, 760],
    }
    south = next(x for x in lines if x["direction"] == 0)
    assert south["departs"]["weekday"] == [605, 615, 625], (
        "the replaced service's trips are not run"
    )
    assert south["name"] == "Fillmore" and south["agency"] == "sfmta"


def test_the_file_written_is_the_city_s(tmp_path):
    mod = _builder()
    db_path = tmp_path / "transit.sqlite"
    _db(mod, str(db_path)).close()
    data = mod.build(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True))
    assert data["zone"] == "America/Los_Angeles" and data["bbox"] == list(mod.BBOX)
    assert "GTFS" in data["basis"] and data["read"]["sfmta"]["service"] == ["20260701", "20260828"]
    assert [x["route"] for x in data["lines"]] == ["22", "22"]
