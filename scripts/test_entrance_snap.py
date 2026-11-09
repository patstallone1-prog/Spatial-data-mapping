#!/usr/bin/env python3
"""Test where a building's way in is inferred against the entrances OpenStreetMap maps.

    python scripts/test_entrance_snap.py

The inference, from what every building has: its outline and its address. The wall the way in is
on is the outline's edge facing the addressed street (the edge, two metres long or more, whose
middle is nearest that street's centreline); the door on it is

* ``midpoint``: the middle of that wall;
* ``front_walk``: where a front walk (docs/app-sf-corridor-ground.json ``front_walks``, the paths
  from the pavement to the door) meets that wall, else its middle.

A baseline takes the edge nearest any street, with no address.

Truth: OpenStreetMap entrance nodes on a building's outline (docs/sf-corridor-access.json, from
scripts/fetch_access_osm.py; ``entrance`` main, yes, shop, secondary or staircase -- not the
service doors, exits and emergency doors). Scored: the right wall (the entrance within a metre of
the chosen edge) and the distance from the inferred door to the mapped one. The opening detector
(83% of doors found in the HABS test) would confirm a door on the photographed facade; it is not
run here. Writes build/tests/entrance-snap.json.
"""

from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONT_DOORS = {"main", "yes", "shop", "secondary", "staircase"}
MIN_EDGE_M = 2.0
WALL_TOL_M = 1.0
WALK_TOUCH_M = 1.5
FRONT_SLACK_M = 3.0


def project(lat0: float):
    ky = 111_320.0
    kx = ky * math.cos(math.radians(lat0))
    return lambda p: ((p[0] - LON0) * kx, (p[1] - lat0) * ky)


def seg_dist(p, a, b) -> tuple[float, tuple[float, float]]:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
    q = (ax + dx * t, ay + dy * t)
    return math.hypot(p[0] - q[0], p[1] - q[1]), q


def line_dist(p, pts) -> float:
    return min(seg_dist(p, a, b)[0] for a, b in zip(pts[:-1], pts[1:]))


def main() -> int:
    global LON0
    payload = json.loads((ROOT / "docs" / "sf-corridor-3d.json").read_text())
    access = json.loads((ROOT / "docs" / "sf-corridor-access.json").read_text())
    ground = json.loads((ROOT / "docs" / "app-sf-corridor-ground.json").read_text())
    LON0 = (payload["bbox"]["west"] + payload["bbox"]["east"]) / 2
    to_m = project((payload["bbox"]["south"] + payload["bbox"]["north"]) / 2)
    buildings = {w["osm_id"]: w for w in payload["ways"] if w.get("kind") == "building" and w.get("points")}
    streets: dict[str, list] = defaultdict(list)
    every_street = []
    for w in payload["ways"]:
        if w.get("kind") == "street" and w.get("name") and len(w.get("points") or []) >= 2:
            pts = [to_m(p) for p in w["points"]]
            streets[w["name"]].append(pts)
            every_street.append(pts)
    walks = [[to_m(p) for p in fw["p"]] for fw in ground.get("front_walks", []) if len(fw.get("p") or []) >= 2]
    walk_grid: dict[tuple[int, int], list] = defaultdict(list)
    for wpts in walks:
        for q in wpts:
            walk_grid[(int(q[0] // 50), int(q[1] // 50))].append(wpts)

    rows = []
    for e in access["entrances"]:
        b = buildings.get(e.get("building"))
        if not b or e.get("entrance") not in FRONT_DOORS:
            continue
        ring = [to_m(p) for p in b["points"]]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        edges = [(a, c) for a, c in zip(ring[:-1], ring[1:]) if math.dist(a, c) >= MIN_EDGE_M]
        if not edges:
            continue
        door = to_m(e["p"])
        street = (b.get("address") or {}).get("street")
        lines = streets.get(street or "", [])
        row = {"building": b["osm_id"], "entrance": e.get("entrance"), "addressed": bool(lines)}

        def facing(candidates) -> tuple:
            scored = []
            for a, c in edges:
                mid = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
                scored.append((min(line_dist(mid, pts) for pts in candidates), a, c, mid))
            best = min(scored, key=lambda s: s[0])
            # The whole street front: the edges as near the street as the nearest (within
            # FRONT_SLACK_M) and running with it -- an outline cuts one facade into several.
            ux, uy = best[2][0] - best[1][0], best[2][1] - best[1][1]
            n = math.hypot(ux, uy)
            front = [s for s in scored if s[0] <= best[0] + FRONT_SLACK_M and
                     abs(((s[2][0] - s[1][0]) * ux + (s[2][1] - s[1][1]) * uy) / (math.dist(s[1], s[2]) * n)) > 0.9]
            return best, front

        for name, cands in (("address", lines), ("nearest_street", every_street)):
            if not cands:
                continue
            near = [pts for pts in cands if line_dist(ring[0], pts) < 400] or cands
            (_, a, c, mid), front = facing(near)
            on_wall = seg_dist(door, a, c)[0] <= WALL_TOL_M
            row[f"{name}_wall"] = on_wall
            row[f"{name}_front"] = any(seg_dist(door, s[1], s[2])[0] <= WALL_TOL_M for s in front)
            row["on_outline"] = any(seg_dist(door, a0, c0)[0] <= WALL_TOL_M for a0, c0 in zip(ring[:-1], ring[1:]))
            row["area_m2"] = round(abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(ring[:-1], ring[1:]))) / 2)
            row[f"{name}_mid_m"] = round(math.dist(door, mid), 2)
            if name == "address":
                # Where a front walk meets that wall.
                touch = None
                key = (int(mid[0] // 50), int(mid[1] // 50))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for wpts in walk_grid.get((key[0] + dx, key[1] + dy), []):
                            for q in (wpts[0], wpts[-1]):
                                d, on = seg_dist(q, a, c)
                                if d <= WALK_TOUCH_M and (touch is None or d < touch[0]):
                                    touch = (d, on)
                row["walk_found"] = touch is not None
                row["address_walk_m"] = round(math.dist(door, touch[1] if touch else mid), 2)
        rows.append(row)

    def share(xs, f):
        xs = list(xs)
        return round(sum(1 for x in xs if f(x)) / len(xs), 3) if xs else None

    addr = [r for r in rows if r["addressed"]]
    report = {
        "entrances_scored": len(rows), "with_address_street": len(addr),
        "entrance_on_outline": share(rows, lambda r: r["on_outline"]),
        "address_facing_wall": {"right_wall": share(addr, lambda r: r["address_wall"]),
                                "right_street_front": share(addr, lambda r: r["address_front"]),
                                "right_street_front_small": share([r for r in addr if r["area_m2"] < 600], lambda r: r["address_front"]),
                                "small_buildings": sum(1 for r in addr if r["area_m2"] < 600),
                                "midpoint_median_m": statistics.median(r["address_mid_m"] for r in addr) if addr else None,
                                "midpoint_within_3m": share(addr, lambda r: r["address_mid_m"] <= 3),
                                "front_walk_found": share(addr, lambda r: r["walk_found"]),
                                "front_walk_median_m": statistics.median(r["address_walk_m"] for r in addr) if addr else None,
                                "front_walk_within_3m": share(addr, lambda r: r["address_walk_m"] <= 3)},
        "baseline_nearest_street": {"right_wall": share(rows, lambda r: r.get("nearest_street_wall")),
                                    "right_street_front": share(rows, lambda r: r.get("nearest_street_front")),
                                    "midpoint_median_m": statistics.median(r["nearest_street_mid_m"] for r in rows) if rows else None,
                                    "midpoint_within_3m": share(rows, lambda r: r["nearest_street_mid_m"] <= 3)},
    }
    out = ROOT / "build" / "tests"
    out.mkdir(parents=True, exist_ok=True)
    (out / "entrance-snap.json").write_text(json.dumps({**report, "rows": rows}))
    print(json.dumps(report, indent=1))
    return 0


LON0 = 0.0

if __name__ == "__main__":
    raise SystemExit(main())
