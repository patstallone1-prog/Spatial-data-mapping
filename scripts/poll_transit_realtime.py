#!/usr/bin/env python3
"""Live arrivals, kept: the agencies' GTFS-realtime trip updates, polled into the transit database.

The static schedules (scripts/ingest_transit.py) say when a train is meant to come; these say
when it is now predicted to. Each poll replaces an agency's rows in ``predictions`` (stop,
trip, route, predicted arrival and departure, delay) and appends the poll's time and size to
``realtime_polls``, so a navigator can ask "what is coming to this stop next" without the
network, and the history of how often the feed answered is there to look at.

Feeds polled where they need no key: BART's trip updates. Muni, AC Transit, VTA, SamTrans and
Caltrain publish theirs through 511.org, which needs a free token: set TRANSIT_511_TOKEN in
.env.local and they are polled too.

    .venv/bin/python scripts/poll_transit_realtime.py          # poll every 60 s, forever
    .venv/bin/python scripts/poll_transit_realtime.py --once   # one poll of every feed
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sqlite3
import ssl
import time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "transit" / "transit.sqlite"
INTERVAL_S = 60
#: agency key -> trip-updates URL; ``{token}`` is filled from TRANSIT_511_TOKEN.
FEEDS = {
    "bart": "https://api.bart.gov/gtfsrt/tripupdate.aspx",
}
FEEDS_511 = {
    "sfmta": "https://api.511.org/transit/tripupdates?api_key={token}&agency=SF",
    "actransit": "https://api.511.org/transit/tripupdates?api_key={token}&agency=AC",
    "vta": "https://api.511.org/transit/tripupdates?api_key={token}&agency=SC",
    "samtrans": "https://api.511.org/transit/tripupdates?api_key={token}&agency=SM",
    "caltrain": "https://api.511.org/transit/tripupdates?api_key={token}&agency=CT",
    "goldengate": "https://api.511.org/transit/tripupdates?api_key={token}&agency=GG",
}


def token() -> str | None:
    if os.environ.get("TRANSIT_511_TOKEN"):
        return os.environ["TRANSIT_511_TOKEN"]
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("TRANSIT_511_TOKEN="):
                return line.split("=", 1)[1].strip() or None
    return None


def fetch(url: str) -> bytes:
    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        context = None
    with urlopen(Request(url, headers={"User-Agent": "Kerbside transit realtime"}), timeout=30, context=context) as r:
        return r.read()


def schema(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS predictions (agency TEXT, trip_id TEXT, route_id TEXT, stop_id TEXT,
                  stop_sequence INTEGER, arrival INTEGER, departure INTEGER, delay INTEGER, polled_at TEXT)""")
    db.execute("CREATE INDEX IF NOT EXISTS predictions_stop ON predictions (agency, stop_id, arrival)")
    db.execute("CREATE TABLE IF NOT EXISTS realtime_polls (agency TEXT, polled_at TEXT, ok INTEGER, entities INTEGER, bytes INTEGER, error TEXT)")


def poll(db: sqlite3.Connection, agency: str, url: str) -> None:
    from google.transit import gtfs_realtime_pb2
    now = dt.datetime.now().isoformat(timespec="seconds")
    try:
        data = fetch(url)
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(data)
    except Exception as error:
        db.execute("INSERT INTO realtime_polls VALUES (?,?,?,?,?,?)", (agency, now, 0, 0, 0, f"{error.__class__.__name__}: {error}"[:200]))
        db.commit()
        return
    rows = []
    for entity in feed.entity:
        if not entity.HasField("trip_update"):
            continue
        update = entity.trip_update
        for stu in update.stop_time_update:
            arrival = stu.arrival.time if stu.HasField("arrival") else None
            departure = stu.departure.time if stu.HasField("departure") else None
            delay = stu.arrival.delay if stu.HasField("arrival") else (stu.departure.delay if stu.HasField("departure") else None)
            rows.append((agency, update.trip.trip_id, update.trip.route_id, stu.stop_id, stu.stop_sequence,
                         arrival, departure, delay, now))
    db.execute("DELETE FROM predictions WHERE agency = ?", (agency,))
    db.executemany("INSERT INTO predictions VALUES (?,?,?,?,?,?,?,?,?)", rows)
    db.execute("INSERT INTO realtime_polls VALUES (?,?,?,?,?,?)", (agency, now, 1, len(feed.entity), len(data), None))
    # The poll log is kept for a week.
    cutoff = (dt.datetime.now() - dt.timedelta(days=7)).isoformat(timespec="seconds")
    db.execute("DELETE FROM realtime_polls WHERE polled_at < ?", (cutoff,))
    db.commit()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=60)
    schema(db)
    feeds = dict(FEEDS)
    key = token()
    if key:
        feeds.update({a: u.format(token=key) for a, u in FEEDS_511.items()})
    while True:
        for agency, url in feeds.items():
            poll(db, agency, url)
        if args.once:
            for agency, ok, entities in db.execute(
                    "SELECT agency, ok, entities FROM realtime_polls WHERE polled_at = (SELECT max(polled_at) FROM realtime_polls)"):
                print(agency, "ok" if ok else "failed", entities)
            return 0
        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    raise SystemExit(main())
