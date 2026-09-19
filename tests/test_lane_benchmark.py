"""The lane benchmark (docs/08 §1.5): sixty block faces across five strata, scored against
hand-checked truth wherever the truth has been filled in.

The faces are committed with what the map and the city say about them and a ``truth`` block
that starts null. A face whose truth is filled in is scored: kerb-to-kerb, parking band per
side, travel-lane count and widths. Faces with no truth yet count only toward the tally so
the file cannot quietly go stale -- the tally is printed with every run.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FACES = ROOT / "data" / "sf_corridor" / "benchmarks" / "lane_faces.json"
PAGE = ROOT / "docs" / "sf-corridor-3d.json"

#: What the cross-sections are held to on a face with truth (docs/08 §1.5 exit criteria).
KERB_TOL_M = 0.30
PARKING_TOL_M = 0.25
LANE_TOL_M = 0.30


@pytest.fixture(scope="module")
def faces() -> list[dict]:
    return json.loads(FACES.read_text(encoding="utf-8"))["faces"]


@pytest.fixture(scope="module")
def ways_by_id() -> dict:
    """The page's street ways, found for each face by name and the face's midpoint: a street
    way carries no id into the page, and the point is what the truth was checked at."""
    if not PAGE.exists():
        pytest.skip("no built corridor payload")
    page = json.loads(PAGE.read_text(encoding="utf-8"))
    faces = json.loads(FACES.read_text(encoding="utf-8"))["faces"]
    streets = [w for w in page["ways"] if w.get("kind") == "street" and w.get("name")]
    out = {}
    for face in faces:
        lon, lat = face["at"]
        best, best_d = None, 6.0
        for w in streets:
            if w["name"] != face["name"]:
                continue
            for p in w["points"]:
                d = math.hypot((p[0] - lon) * 88_000.0, (p[1] - lat) * 111_320.0)
                if d < best_d:
                    best, best_d = w, d
        if best is not None:
            out[_key(face)] = best
    return out


def _key(face: dict) -> tuple:
    return (face["name"], round(face["at"][0], 6), round(face["at"][1], 6))


def test_the_benchmark_covers_every_stratum_and_says_how_much_truth_it_holds(faces: list[dict]) -> None:
    strata = {f["stratum"] for f in faces}
    assert strata == {"bike", "divided", "oneway", "twoway_residential", "wide_arterial"}
    assert len(faces) >= 60
    filled = [f for f in faces if f["truth"].get("kerb_to_kerb_m") is not None]
    print(f"\nlane benchmark: {len(filled)} of {len(faces)} faces have hand-checked truth")


def _mid_station(way: dict) -> list:
    return way["xs"][len(way["xs"]) // 2]


def test_faces_with_truth_are_within_tolerance(faces: list[dict], ways_by_id: dict) -> None:
    filled = [f for f in faces if f["truth"].get("kerb_to_kerb_m") is not None]
    if not filled:
        pytest.skip("no face has hand-checked truth yet")
    failures = []
    for face in filled:
        way = ways_by_id.get(_key(face))
        if not way or not way.get("xs"):
            failures.append(f"{face['name']}: no cross-sections in the payload")
            continue
        row = _mid_station(way)
        truth = face["truth"]
        kerb = row[1] - row[2]
        if abs(kerb - truth["kerb_to_kerb_m"]) > KERB_TOL_M:
            failures.append(f"{face['name']}: kerb to kerb {kerb:.2f} vs {truth['kerb_to_kerb_m']:.2f}")
        bands = row[5]
        travel = [b for b in bands if b[0] in ("t", "n")]
        if truth.get("travel_lanes") is not None and len(travel) != truth["travel_lanes"]:
            failures.append(f"{face['name']}: {len(travel)} travel lanes vs {truth['travel_lanes']}")
        for side, key in ((0, "parking_left_m"), (-1, "parking_right_m")):
            want = truth.get(key)
            if want is None:
                continue
            band = bands[side] if bands and bands[side][0] == "p" else None
            got = band[1] if band else 0.0
            if abs(got - want) > PARKING_TOL_M:
                failures.append(f"{face['name']}: {key} {got:.2f} vs {want:.2f}")
        if truth.get("lane_widths_m"):
            got = sorted(b[1] for b in travel)
            want = sorted(truth["lane_widths_m"])
            if len(got) == len(want) and any(abs(g - w) > LANE_TOL_M for g, w in zip(got, want, strict=False)):
                failures.append(f"{face['name']}: lane widths {got} vs {want}")
    assert not failures, "\n".join(failures)


def test_the_map_and_city_fields_still_describe_the_payload(faces: list[dict], ways_by_id: dict) -> None:
    """The committed face must be the way it names, or the truth is about something else."""
    missing = [f["name"] for f in faces if _key(f) not in ways_by_id]
    assert len(missing) <= 3, missing
    drift = 0
    for face in faces:
        way = ways_by_id.get(_key(face))
        if not way or not way.get("xs") or face["city"]["kerb_to_kerb_m"] is None:
            continue
        row = _mid_station(way)
        if not math.isclose(row[1] - row[2], face["city"]["kerb_to_kerb_m"], abs_tol=0.5):
            drift += 1
    assert drift <= 6, f"{drift} faces no longer match the kerbs they were cut from"
