"""Write docs/sf-corridor-parking-census.json: which side of each corridor block has kerbside
parking, from SFMTA's On-Street Parking Census (DataSF 9ivs-nf5y, public domain) and the city's
curb cuts (docs/75).

The census counts the public spaces on each street segment (a block, by its CNN), both sides
together, at 17 ft (5.18 m) a space where they are not marked. It does not say which side. Each
side's room is worked out from the block's length less a corner clearance at each end and the
driveways cut into that side's kerb (placed by their geometry, not their record's "side", which
is E or W on every street); the count then says whether one side or both are parked:

- both sides, where the count is at least BOTH_SIDES_SHARE of the room on both sides (fitted on
  the blocks OpenStreetMap tags: 77% right);
- one side otherwise: the side with more kerb free of driveways;
- none, where the count is nought. "5555" (a divided street's count put on one half) is kept
  as unknown.

    python3 tools/build_parking_census.py [--refresh]
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "sf_public_works" / "parking_census.json"
OUT = ROOT / "docs" / "sf-corridor-parking-census.json"
URL = "https://data.sf.gov/resource/9ivs-nf5y.json?$limit=50000"
#: The corridor's extent (its cells' ways), padded.
BBOX = (37.7820, -122.4500, 37.8115, -122.3890)
SPACE_M = 17 * 0.3048
CORNER_CLEAR_M = 4.0
DRIVEWAY_REACH_M = 9.0


def fetch() -> list[dict]:
    req = urllib.request.Request(URL, headers={"User-Agent": "kerbside-build/1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def _xy(lon: float, lat: float, lat0: float) -> tuple[float, float]:
    return (lon * 111_320.0 * math.cos(math.radians(lat0)), lat * 110_574.0)


def _side_of(px: float, py: float, line: list[tuple[float, float]]) -> tuple[int, float]:
    """+1 left of the line as it runs, -1 right; and the distance."""
    best = (math.inf, 0)
    for i in range(1, len(line)):
        (ax, ay), (bx, by) = line[i - 1], line[i]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
        qx, qy = ax + t * dx, ay + t * dy
        d = math.hypot(px - qx, py - qy)
        if d < best[0]:
            cross = dx * (py - ay) - dy * (px - ax)
            best = (d, 1 if cross > 0 else -1)
    return best[1], best[0]


#: Both sides are parked where the count is at least this share of the room on both sides together.
#: Fitted on the 1,618 corridor blocks whose OpenStreetMap tags say which sides are parked
#: (2026-11-26): 77% of them are called right at 0.40 (71% calling every block both sides; 68% at
#: 0.55). The room is an upper bound -- hydrants, bus and loading zones and red kerbs are not in it
#: -- so a two-sided block fills well under all of it.
BOTH_SIDES_SHARE = 0.40
BOTH_SIDES_ACCURACY = 0.77


def sides_for(supply: int, length: float, cuts_left: float, cuts_right: float) -> tuple[list[int], float, dict]:
    room = lambda cuts: max(0.0, length - 2 * CORNER_CLEAR_M - cuts) / SPACE_M  # noqa: E731
    left, right = room(cuts_left), room(cuts_right)
    info = {"room_left": round(left, 1), "room_right": round(right, 1)}
    if supply <= 0:
        return [], 0.9, info
    share = supply / max(left + right, 1e-6)
    if share >= BOTH_SIDES_SHARE and min(left, right) >= 1:
        return [1, -1], BOTH_SIDES_ACCURACY, info
    # One side: the side with more kerb free of driveways (a guess where they are alike).
    side = 1 if left >= right else -1
    sure = 0.5 + 0.3 * min(1.0, abs(left - right) / max(left, right, 1))
    return [side], round(sure, 2), info


def build(rows: list[dict], cuts: list[dict]) -> dict:
    s, w, n, e = BBOX
    lat0 = (s + n) / 2
    by_cnn: dict[str, list[dict]] = {}
    for cut in cuts:
        by_cnn.setdefault(str(cut.get("cnn")), []).append(cut)
    out = []
    unknown = 0
    for row in rows:
        shape = row.get("shape") or {}
        coords = shape.get("coordinates") or []
        if shape.get("type") == "MultiLineString":
            coords = [p for part in coords for p in part]
        if len(coords) < 2 or not any(w <= lon <= e and s <= lat <= n for lon, lat in coords):
            continue
        supply = int(float(row.get("prkg_sply") or 0))
        if supply == 5555:
            unknown += 1
            continue
        line = [_xy(lon, lat, lat0) for lon, lat in coords]
        length = sum(math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) for i in range(1, len(line)))
        cuts_by_side = {1: 0.0, -1: 0.0}
        for cut in by_cnn.get(str(row.get("cnn")), []):
            p = cut.get("p") or []
            if not p:
                continue
            mx = sum(q[0] for q in p) / len(p)
            my = sum(q[1] for q in p) / len(p)
            side, d = _side_of(*_xy(mx, my, lat0), line)
            if d <= DRIVEWAY_REACH_M:
                cuts_by_side[side] += float(cut.get("m") or 3.0)
        sides, sure, info = sides_for(supply, length, cuts_by_side[1], cuts_by_side[-1])
        out.append({"cnn": str(row.get("cnn")), "street": f"{row.get('st_name', '')} {row.get('st_type', '')}".strip(),
                    "p": [[round(lon, 7), round(lat, 7)] for lon, lat in coords], "supply": supply,
                    "year": row.get("year"), "length_m": round(length, 1), "sides": sides, "sure": sure, **info})
    return {
        "schema": "kerbside.parking_census/1",
        "source": {"name": "SFMTA On-Street Parking Census", "id": "9ivs-nf5y", "licence": "PDDL (DataSF)",
                   "space_m": round(SPACE_M, 2), "corner_clear_m": CORNER_CLEAR_M,
                   "both_sides_share": BOTH_SIDES_SHARE, "both_sides_accuracy": BOTH_SIDES_ACCURACY},
        "sides": "+1 left of the census line as its points run, -1 right",
        "unknown_divided": unknown,
        "segments": out,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    if args.refresh or not RAW.exists():
        RAW.write_text(json.dumps(fetch(), separators=(",", ":")))
    rows = json.loads(RAW.read_text())
    cuts = json.loads((ROOT / "data" / "sf_public_works" / "curb_cuts.json").read_text())
    out = build(rows, cuts)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    segs = out["segments"]
    print(json.dumps({"segments": len(segs), "parked": sum(1 for x in segs if x["sides"]),
                      "both": sum(1 for x in segs if len(x["sides"]) == 2),
                      "one": sum(1 for x in segs if len(x["sides"]) == 1),
                      "none": sum(1 for x in segs if not x["sides"]), "unknown_divided": out["unknown_divided"]}))


if __name__ == "__main__":
    main()
