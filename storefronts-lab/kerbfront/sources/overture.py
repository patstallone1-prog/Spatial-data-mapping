"""Overture Maps places (local GeoParquet) and buildings (S3 GeoParquet via DuckDB).

Places come from the bay-area extract the main checkout already holds
(``data/places/overture-<release>-bay-area.parquet``); buildings are read straight from the
public release bucket, bbox-filtered, and cached as JSON. Verified 2026-11-23 against release
2026-10-21.0: 3,644 Marina buildings, 3,531 with a height, none with a roof shape, one with a
facade material -- so Overture contributes heights and floor counts, not style.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from ..config import CACHE, BBox, kerbside_root

RELEASE = "2026-10-21.0"
BUILDINGS = ("s3://overturemaps-us-west-2/release/{rel}/theme=buildings/type={kind}/*")


def places(b: BBox, parquet: Path | None = None) -> tuple[list[dict], dict]:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    path = parquet or kerbside_root() / "data/places" / f"overture-{RELEASE}-bay-area.parquet"
    t = pq.read_table(path)
    m = pc.and_(pc.and_(pc.greater_equal(t["lat"], b.south), pc.less_equal(t["lat"], b.north)),
                pc.and_(pc.greater_equal(t["lon"], b.west), pc.less_equal(t["lon"], b.east)))
    rows = t.filter(m).to_pylist()
    return rows, {"dataset": f"overture-places-{RELEASE}", "url": str(path.name),
                  "retrieved_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
                  .isoformat(timespec="seconds"), "licence": "CDLA-Permissive-2.0 (per-row)"}


def buildings(b: BBox, kind: str = "building", refresh: bool = False) -> tuple[list[dict], dict]:
    out = CACHE / "overture" / f"{kind}-{RELEASE}-{b.key()}.json"
    if out.exists() and not refresh:
        rec = json.loads(out.read_text())
        return rec["rows"], rec["prov"]
    import duckdb
    from shapely import wkb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    cols = ("id, height, num_floors, min_height, roof_shape, roof_material, roof_height, "
            "facade_material, facade_color, class, subtype, names.primary AS name, geometry")
    if kind == "building_part":
        cols = cols.replace("class, subtype, ", "building_id, ")
    q = (f"SELECT {cols} FROM read_parquet('{BUILDINGS.format(rel=RELEASE, kind=kind)}', "
         f"hive_partitioning=1) WHERE bbox.xmin >= {b.west} AND bbox.xmax <= {b.east} "
         f"AND bbox.ymin >= {b.south} AND bbox.ymax <= {b.north}")
    cur = con.execute(q)
    names = [d[0] for d in cur.description]
    rows = []
    for r in cur.fetchall():
        row = dict(zip(names, r))
        row["geometry"] = wkb.loads(bytes(row["geometry"])).wkt
        rows.append(row)
    prov = {"dataset": f"overture-{kind}-{RELEASE}", "url": BUILDINGS.format(rel=RELEASE, kind=kind),
            "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "licence": "ODbL (OSM-derived) / CDLA per source"}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"rows": rows, "prov": prov}, default=str))
    return rows, prov
