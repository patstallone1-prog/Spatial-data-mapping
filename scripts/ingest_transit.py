#!/usr/bin/env python3
"""The Bay Area's transit schedules, ingested: every agency's GTFS, kept for navigation later.

Nothing on the map shows the timetable yet. What this keeps is what a route planner and an
"arriving in 4 minutes" board need: every stop and station, every route, every trip and the
time it calls at each stop, and the service calendar -- one SQLite database
(data/transit/transit.sqlite), refreshed from each agency's published feed. The feeds are the
agencies' own (fetched through the Mobility Database's mirror where an agency's own address
needs a key or has moved); each download is kept with its checksum under data/transit/raw/.

It also writes, for each built region, the stops the renderer stands on the street:
transit-stops.json beside the region's payload -- every stop of every agency inside the region,
with the routes that call there, the stop's type where the agency publishes one (SFMTA's Muni
Stops: bus zone, flag stop, safety island, bus bulb), and what is physically there:

* ``shelter``  -- tagged so in OpenStreetMap (``osm``), or, where nobody has mapped it, inferred:
  a bus zone, bulb or rail island served by two or more routes or by a rapid or rail line
  (``inferred_from_stop_type_and_service``);
* ``bench``    -- another bus zone, bulb or island: a seat and a pole;
* ``pole``     -- a flag stop, or a stop with nothing published about it: the sign alone.

``painted`` says whether the stop has a marked zone in the road (SFMTA bus zones and bulbs).

    .venv/bin/python scripts/ingest_transit.py            # download, ingest, write the stops
    .venv/bin/python scripts/ingest_transit.py --offline  # re-ingest the last downloads
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import sqlite3
import sys
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "transit"
RAW = DATA / "raw"
DB = DATA / "transit.sqlite"
DOCS = ROOT / "docs"
MDB = "https://files.mobilitydatabase.org/mdb-{}/latest.zip"

#: agency key -> (name, mode hint, [feed URLs in order of preference]).
FEEDS = {
    "sfmta": ("San Francisco Municipal Transportation Agency (Muni)", "bus",
              [MDB.format(2886)]),
    "bart": ("Bay Area Rapid Transit", "subway",
             ["https://www.bart.gov/dev/schedules/google_transit.zip",
              MDB.format(53)]),
    "caltrain": ("Caltrain", "rail",
                 ["https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip",
                  MDB.format(54)]),
    "vta": ("Santa Clara Valley Transportation Authority", "bus",
            ["https://gtfs.vta.org/gtfs_vta.zip", MDB.format(57)]),
    "actransit": ("AC Transit", "bus",
                  [MDB.format(2455)]),
    "samtrans": ("SamTrans", "bus", [MDB.format(2708)]),
    "goldengate": ("Golden Gate Transit", "bus", [MDB.format(67)]),
}
#: SFMTA's own stop inventory (DataSF "Muni Stops"): the stop's type in the street.
MUNI_STOPS = "https://data.sfgov.org/resource/i28k-bkz6.json?$limit=50000"
#: GTFS route_type -> what kind of thing calls at the stop.
ROUTE_MODES = {0: "tram", 1: "subway", 2: "rail", 3: "bus", 5: "cable_car", 7: "funicular", 11: "trolleybus", 12: "monorail"}
TABLES = {
    "stops": ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station", "wheelchair_boarding"],
    "routes": ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"],
    "trips": ["route_id", "service_id", "trip_id", "trip_headsign", "direction_id", "shape_id"],
    "stop_times": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
    "calendar": ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
    "calendar_dates": ["service_id", "date", "exception_type"],
}


def fetch(url: str) -> bytes:
    import ssl
    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        context = None
    with urlopen(Request(url, headers={"User-Agent": "Kerbside transit ingest"}), timeout=180, context=context) as r:
        return r.read()


def download(agency: str, urls: list[str]) -> Path | None:
    folder = RAW / agency
    folder.mkdir(parents=True, exist_ok=True)
    for url in urls:
        try:
            data = fetch(url)
            zipfile.ZipFile(io.BytesIO(data)).testzip()
        except Exception as error:  # a moved feed, an HTML error page, a timeout
            print(f"  {agency}: {url[:70]}... failed ({error.__class__.__name__})", flush=True)
            continue
        path = folder / f"{dt.date.today().isoformat()}.zip"
        path.write_bytes(data)
        (folder / "latest.json").write_text(json.dumps({
            "url": url, "file": path.name, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "fetched_at": dt.datetime.now().isoformat(timespec="seconds"),
        }, indent=1) + "\n")
        return path
    return None


def latest(agency: str) -> Path | None:
    meta = RAW / agency / "latest.json"
    return RAW / agency / json.loads(meta.read_text())["file"] if meta.exists() else None


def ingest(db: sqlite3.Connection, agency: str, path: Path) -> dict:
    counts = {}
    with zipfile.ZipFile(path) as z:
        names = {Path(n).name: n for n in z.namelist()}
        for table, columns in TABLES.items():
            db.execute(f"DELETE FROM {table} WHERE agency = ?", (agency,))
            name = names.get(f"{table}.txt")
            if not name:
                counts[table] = 0
                continue
            with z.open(name) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
                rows = ([agency] + [row.get(c, "") for c in columns] for row in reader)
                cursor = db.executemany(
                    f"INSERT INTO {table} VALUES ({','.join('?' * (len(columns) + 1))})", rows)
                counts[table] = cursor.rowcount
    db.commit()
    return counts


def schema(db: sqlite3.Connection) -> None:
    for table, columns in TABLES.items():
        db.execute(f"CREATE TABLE IF NOT EXISTS {table} (agency TEXT, {', '.join(f'{c} TEXT' for c in columns)})")
    db.execute("CREATE INDEX IF NOT EXISTS stop_times_stop ON stop_times (agency, stop_id, departure_time)")
    db.execute("CREATE INDEX IF NOT EXISTS stop_times_trip ON stop_times (agency, trip_id)")
    db.execute("CREATE INDEX IF NOT EXISTS trips_id ON trips (agency, trip_id)")
    db.execute("CREATE TABLE IF NOT EXISTS feeds (agency TEXT PRIMARY KEY, name TEXT, file TEXT, url TEXT, sha256 TEXT, ingested_at TEXT, counts TEXT)")


def stop_routes(db: sqlite3.Connection) -> dict[tuple[str, str], dict]:
    """For every stop: the routes that call there, and their modes."""
    out: dict[tuple[str, str], dict] = {}
    query = """
        SELECT DISTINCT st.agency, st.stop_id, r.route_short_name, r.route_long_name, r.route_type
        FROM stop_times st JOIN trips t ON t.agency = st.agency AND t.trip_id = st.trip_id
        JOIN routes r ON r.agency = t.agency AND r.route_id = t.route_id"""
    for agency, stop_id, short, long, rtype in db.execute(query):
        entry = out.setdefault((agency, stop_id), {"routes": set(), "modes": set()})
        entry["routes"].add(short or long or "")
        try:
            entry["modes"].add(ROUTE_MODES.get(int(rtype), "bus"))
        except ValueError:
            entry["modes"].add("bus")
    return out


def muni_stop_types() -> dict[str, dict]:
    try:
        rows = json.loads(fetch(MUNI_STOPS))
    except Exception as error:
        print(f"  Muni Stops (DataSF) unavailable: {error.__class__.__name__}", flush=True)
        return {}
    out = {}
    for r in rows:
        if not r.get("stopid"):
            continue
        stop_type = (r.get("serviceplanningstoptype") or "").strip().upper()
        # Where the type field is blank the stop's name usually ends with it: "...NW-FS/BZ".
        if len(stop_type) != 2 and "/" in (r.get("stopname") or ""):
            stop_type = r["stopname"].rsplit("/", 1)[1].strip().upper()[:2]
        out[str(r["stopid"])] = {"type": stop_type, "position": r.get("position"), "orientation": r.get("orientation")}
    return out


def osm_shelters(region_dirs: list[Path]) -> list[tuple[float, float]]:
    """Shelters OpenStreetMap has, from the furniture survey each region already holds."""
    out = []
    for folder in region_dirs:
        path = folder / "sf-corridor-furniture.json"
        if not path.exists():
            continue
        inferred = json.loads(path.read_text()).get("inferred") or {}
        rows = list(inferred.get("shelters") or [])
        # A stop OpenStreetMap tags with its own shelter counts as one too.
        rows += [r for r in (inferred.get("bus_stops") or []) if (r.get("tags") or {}).get("shelter") == "yes"]
        for row in rows:
            point = row.get("p") or row.get("point") or [row.get("lon"), row.get("lat")]
            if point and point[0] is not None:
                out.append((float(point[0]), float(point[1])))
    return out


#: A rapid or rail line: the stops of these get shelters where nobody has said otherwise.
def busy(routes: set[str], modes: set[str]) -> bool:
    return len(routes) >= 2 or bool(modes & {"tram", "subway", "rail", "cable_car"}) \
        or any(r.endswith("R") for r in routes)


def classify(stop: dict, shelters_near: bool) -> tuple[str, str]:
    stop_type = stop.get("type")
    if shelters_near:
        return "shelter", "osm"
    if stop_type == "FL":
        return "pole", "sfmta_stop_type"
    if stop_type in ("BZ", "BB", "SI", "PS", "SB", "AB"):
        if busy(set(stop["routes"]), set(stop["modes"])):
            return "shelter", "inferred_from_stop_type_and_service"
        return "bench", "inferred_from_stop_type_and_service"
    if busy(set(stop["routes"]), set(stop["modes"])) and stop["agency"] != "sfmta":
        return "shelter", "inferred_from_service"
    return "pole", "nothing_published"


def region_targets() -> list[tuple[str, list, list[Path]]]:
    """(name, bbox [S, W, N, E], folders the region's page reads from) for every built region."""
    index = json.loads((DOCS / "app-regions.json").read_text())["regions"]
    out = []
    for region in index:
        if not region.get("built") or not region.get("bbox"):
            continue
        name = region["name"]
        folders = [DOCS] if name == "sf-corridor" else [
            folder for folder in (DOCS / "regions" / name, DOCS / "app-regions" / name) if folder.is_dir()]
        out.append((name, region["bbox"], folders))
    return out


def write_region_stops(db: sqlite3.Connection) -> None:
    served = stop_routes(db)
    types = muni_stop_types()
    targets = region_targets()
    shelters = osm_shelters([f for _, _, folders in targets for f in folders])
    import math
    for name, (south, west, north, east), folders in targets:
        pad = 0.002
        rows = db.execute("""SELECT agency, stop_id, stop_code, stop_name, stop_lat, stop_lon, location_type, parent_station
                             FROM stops WHERE CAST(stop_lat AS REAL) BETWEEN ? AND ? AND CAST(stop_lon AS REAL) BETWEEN ? AND ?""",
                          (south - pad, north + pad, west - pad, east + pad)).fetchall()
        stops, stations, entrances = [], [], []
        for agency, stop_id, code, stop_name, lat, lon, ltype, parent in rows:
            lat, lon = float(lat), float(lon)
            ltype = (ltype or "0").strip() or "0"
            if ltype == "1":
                stations.append({"agency": agency, "id": stop_id, "name": stop_name, "lon": round(lon, 6), "lat": round(lat, 6)})
                continue
            if ltype == "2":
                entrances.append({"agency": agency, "id": stop_id, "name": stop_name, "parent": parent,
                                  "lon": round(lon, 6), "lat": round(lat, 6)})
                continue
            if ltype not in ("0", ""):
                continue
            info = served.get((agency, stop_id), {"routes": set(), "modes": set()})
            if not info["routes"]:
                continue                     # a stop no trip calls at
            stop = {"agency": agency, "id": stop_id, "name": stop_name, "lon": round(lon, 6), "lat": round(lat, 6),
                    "routes": sorted(info["routes"]), "modes": sorted(info["modes"])}
            muni = (types.get(stop_id) or types.get(code or "")) if agency == "sfmta" else None
            if muni:
                stop["type"] = muni["type"]
                stop["position"] = muni.get("position")
            k = 111320.0 * math.cos(math.radians(lat))
            near = any(abs(slon - lon) * k < 18 and abs(slat - lat) * 111320.0 < 18 for slon, slat in shelters)
            stop["physical"], stop["physical_source"] = classify(stop, near)
            stop["painted"] = stop.get("type") in ("BZ", "BB")
            if set(stop["modes"]) <= {"subway", "rail"}:
                continue                     # a platform inside a station, not a stop in the street
            stops.append(stop)
        payload = {"schema": "kerbside.transit_stops/1", "region": name,
                   "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
                   "sources": {a: json.loads((RAW / a / "latest.json").read_text())["url"]
                               for a in FEEDS if (RAW / a / "latest.json").exists()},
                   "physical_grades": {"osm": "OpenStreetMap shelter tag within 18 m",
                                       "inferred_from_stop_type_and_service": "SFMTA stop type with the routes calling there",
                                       "inferred_from_service": "routes calling there",
                                       "sfmta_stop_type": "SFMTA flag stop",
                                       "nothing_published": "no stop type published: the sign alone"},
                   "stops": stops, "stations": stations, "entrances": entrances}
        text = json.dumps(payload, separators=(",", ":")) + "\n"
        for folder in folders:
            (folder / "transit-stops.json").write_text(text)
        from collections import Counter
        print(f"  {name}: {len(stops)} stops ({dict(Counter(s['physical'] for s in stops))}), "
              f"{len(stations)} stations, {len(entrances)} entrances", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--offline", action="store_true", help="re-ingest the last downloads only")
    ap.add_argument("--schedules-only", action="store_true",
                    help="refresh the database and leave the published stops alone (the daily job)")
    args = ap.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    schema(db)
    for agency, (name, _mode, urls) in FEEDS.items():
        path = latest(agency) if args.offline else download(agency, urls) or latest(agency)
        if not path:
            print(f"{agency}: no feed", flush=True)
            continue
        counts = ingest(db, agency, path)
        meta = json.loads((RAW / agency / "latest.json").read_text())
        db.execute("INSERT OR REPLACE INTO feeds VALUES (?,?,?,?,?,?,?)",
                   (agency, name, path.name, meta["url"], meta["sha256"], dt.datetime.now().isoformat(timespec="seconds"),
                    json.dumps(counts)))
        db.commit()
        print(f"{agency}: {counts}", flush=True)
    if not args.schedules_only:
        write_region_stops(db)
    return 0


if __name__ == "__main__":
    sys.exit(main())
