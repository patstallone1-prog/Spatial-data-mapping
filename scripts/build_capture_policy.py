#!/usr/bin/env python3
"""B9 -- where the next photograph should be taken, and what it is for.

The policy this replaces was a density target: about a dozen eligible frames per H3 cell, and a
cell with them is done. This asks a different question of every block face in the corridor --
can the kerb along it be measured yet, and how much would one more well-chosen photograph help.

Both halves matter. A face already measurable gains almost nothing from a thirteenth frame, and
a face whose forty frames all point at the buildings gains a great deal from the first one that
points the other way. Neither is visible to a count.

Faces come from the city's own centrelines rather than from the catalogue, so a block nobody has
ever photographed is in the output -- which is exactly where the policy should be sending people
and is precisely what a survey of existing frames cannot see.

Output: one row per block face with its readiness, the marginal value of the next frame, what
that frame is for, and where to stand; plus a small ranked file the viewer can draw.
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

import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.enrich.policy import FaceEvidence, READINESS, marginal_value, readiness_terms  # noqa: E402

CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
ENRICH = ROOT / "data" / "observation_enrichment"
CENTRELINES = ROOT / "data" / "sf_public_works" / "centrelines.json"
OUT = ENRICH / "capture_policy-000.parquet"
SUMMARY = ENRICH / "capture_policy_summary.json"
VIEWER = ROOT / "docs" / "sf-corridor-priority.json"

#: How many faces the viewer file carries. The whole table is in the parquet beside it; this is
#: the working list, and a working list nobody can hold in their head is not one.
VIEWER_ROWS = 400

SCHEMA = pa.schema([
    ("segment_id", pa.string()), ("street_name", pa.string()), ("side", pa.int8()),
    ("length_m", pa.float32()), ("frames", pa.int32()), ("frames_seeing_kerb", pa.int32()),
    ("kerb_view", pa.float32()), ("geometry", pa.float32()), ("pose", pa.float32()),
    ("along", pa.float32()), ("angles", pa.float32()),
    ("readiness", pa.float32()), ("marginal_value", pa.float32()),
    ("need", pa.string()), ("has_metric", pa.bool_()),
    ("latitude", pa.float64()), ("longitude", pa.float64()),
    ("suggested_heading_deg", pa.float32()),
])


def segment_geometry() -> dict[str, dict]:
    """Each centreline's length, midpoint and bearing, in the corridor's own local metres."""
    if not CENTRELINES.exists():
        return {}
    rows = json.loads(CENTRELINES.read_text())
    out: dict[str, dict] = {}
    for row in rows:
        points = row.get("points") or []
        if len(points) < 2:
            continue
        lat0 = sum(p[1] for p in points) / len(points)
        m_lat = 111_320.0
        m_lon = m_lat * math.cos(math.radians(lat0))
        length = 0.0
        for a, b in zip(points, points[1:]):
            length += math.hypot((b[0] - a[0]) * m_lon, (b[1] - a[1]) * m_lat)
        mid = points[len(points) // 2]
        first, last = points[0], points[-1]
        bearing = math.degrees(math.atan2((last[0] - first[0]) * m_lon,
                                          (last[1] - first[1]) * m_lat)) % 360.0
        out[str(row.get("id"))] = {"length_m": length, "lat": mid[1], "lon": mid[0],
                                   "bearing": bearing, "name": row.get("name")}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    def say(message: str) -> None:
        print(message, flush=True)

    segments = segment_geometry()
    say(f"centrelines: {len(segments)} segments, {2 * len(segments)} block faces")

    context = pq.read_table(ENRICH / "enrichment-000.parquet",
                            columns=["observation_uid", "segment_id", "street_name",
                                     "street_side", "station_m"]).to_pylist()
    value_rows = pq.read_table(ENRICH / "value-000.parquet",
                               columns=["observation_uid", "sees_kerb", "has_geometry",
                                        "pose_trust", "metric_truth"]).to_pylist()
    value = {row["observation_uid"]: row for row in value_rows}
    heading = {row["observation_uid"]: row.get("heading_deg")
               for row in pq.read_table(CATALOG, columns=["observation_uid",
                                                          "heading_deg"]).to_pylist()}
    say(f"frames with context: {len(context)}")

    gathered: dict[tuple[str, int], dict] = defaultdict(
        lambda: {"frames": 0, "kerb": [], "geometry": 0.0, "pose": 0.0, "metric": False,
                 "stations": [], "headings": [], "name": None})
    for row in context:
        seg = row.get("segment_id")
        side = row.get("street_side")
        if not seg or side not in (1, -1):
            continue
        v = value.get(row["observation_uid"])
        if v is None:
            continue
        bucket = gathered[(seg, int(side))]
        bucket["frames"] += 1
        bucket["name"] = bucket["name"] or row.get("street_name")
        bucket["geometry"] = max(bucket["geometry"], float(v["has_geometry"] or 0.0))
        bucket["pose"] = max(bucket["pose"], float(v["pose_trust"] or 0.0))
        bucket["metric"] = bucket["metric"] or bool((v["metric_truth"] or 0.0) > 0)
        kerb = float(v["sees_kerb"] or 0.0)
        bucket["kerb"].append(kerb)
        if kerb >= 0.10 and row.get("station_m") is not None:
            bucket["stations"].append(float(row["station_m"]))
            h = heading.get(row["observation_uid"])
            if h is not None:
                bucket["headings"].append(float(h))

    columns: dict[str, list] = {name: [] for name in SCHEMA.names}
    needs = Counter()
    ready_now = 0
    never_seen = 0
    faces = 0
    for seg_id, geom in sorted(segments.items()):
        for side in (1, -1):
            bucket = gathered.get((seg_id, side))
            face = FaceEvidence(
                segment_id=seg_id, side=side,
                street_name=(bucket or {}).get("name") or geom.get("name"),
                length_m=geom["length_m"],
                frames=(bucket or {}).get("frames", 0),
                kerb_views=tuple((bucket or {}).get("kerb", ())),
                best_geometry=(bucket or {}).get("geometry", 0.0),
                best_pose=(bucket or {}).get("pose", 0.0),
                has_metric=(bucket or {}).get("metric", False),
                kerb_stations=tuple((bucket or {}).get("stations", ())),
                kerb_headings=tuple((bucket or {}).get("headings", ())),
            )
            terms = readiness_terms(face)
            now, gain, need = marginal_value(face)
            faces += 1
            needs[need] += 1
            if now >= 0.5:
                ready_now += 1
            if not face.kerb_stations:
                never_seen += 1
            # Stand on the far side of the street and look across at this kerb: the bearing of
            # the segment, turned ninety degrees towards the side in question.
            suggested = (geom["bearing"] + (90.0 if side == 1 else -90.0)) % 360.0
            columns["segment_id"].append(seg_id)
            columns["street_name"].append(face.street_name)
            columns["side"].append(side)
            columns["length_m"].append(face.length_m)
            columns["frames"].append(face.frames)
            columns["frames_seeing_kerb"].append(len(face.kerb_stations))
            for name in READINESS:
                columns[name].append(float(terms[name]))
            columns["readiness"].append(float(now))
            columns["marginal_value"].append(float(gain))
            columns["need"].append(need)
            columns["has_metric"].append(bool(face.has_metric))
            columns["latitude"].append(geom["lat"])
            columns["longitude"].append(geom["lon"])
            columns["suggested_heading_deg"].append(float(suggested))

    table = pa.table({n: pa.array(columns[n], type=SCHEMA.field(n).type) for n in SCHEMA.names},
                     schema=SCHEMA)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, args.out, compression="zstd")

    # The comparison that justifies the change: what the density target says about the faces
    # this policy ranks highest, and vice versa.
    order = sorted(range(faces), key=lambda i: -columns["marginal_value"][i])
    top = order[:200]
    top_with_many = sum(1 for i in top if columns["frames"][i] >= 12)
    well_photographed = [i for i in range(faces) if columns["frames"][i] >= 12]
    done_by_count_not_ready = sum(1 for i in well_photographed if columns["readiness"][i] < 0.3)
    thin_but_ready = sum(1 for i in range(faces)
                         if columns["frames"][i] < 12 and columns["readiness"][i] >= 0.5)

    summary = {
        "block_faces": faces,
        "faces_with_no_frames": sum(1 for i in range(faces) if columns["frames"][i] == 0),
        "faces_never_seeing_their_own_kerb": never_seen,
        "faces_measurable_now": ready_now,
        "readiness_weights": READINESS,
        "need": dict(needs.most_common()),
        "against_the_density_target": {
            "faces_with_12_or_more_frames": len(well_photographed),
            "of_those_still_not_measurable": done_by_count_not_ready,
            "faces_under_12_frames_already_measurable": thin_but_ready,
            "top_200_by_marginal_value_that_already_have_12_frames": top_with_many,
        },
    }
    SUMMARY.write_text(json.dumps(summary, indent=1) + "\n")

    viewer = [
        {
            "s": columns["segment_id"][i],
            "n": columns["street_name"][i],
            "side": columns["side"][i],
            "p": [round(columns["longitude"][i], 6), round(columns["latitude"][i], 6)],
            "r": round(columns["readiness"][i], 3),
            "m": round(columns["marginal_value"][i], 3),
            "need": columns["need"][i],
            "f": columns["frames"][i],
            "h": round(columns["suggested_heading_deg"][i]),
        }
        for i in order[:VIEWER_ROWS]
    ]
    VIEWER.parent.mkdir(parents=True, exist_ok=True)
    VIEWER.write_text(json.dumps({"faces": viewer}, separators=(",", ":")))

    say(json.dumps(summary, indent=1))
    say(f"wrote {args.out.name}: {table.num_rows} faces, and {VIEWER.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
