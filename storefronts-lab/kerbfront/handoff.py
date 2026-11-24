"""Write ``smc.exteriors`` input programs (docs/30 input contract) from a sweep.

One program per building with at least one storefront: the simplified CCW footprint in local
metres (first vertex at the origin, so ``edge`` indices match ``faces.json``), the LiDAR
height, one tenant per business and one frontage per tenant span. Openings and signs stay
empty with ``*_complete: false`` until stage 3 measures them from the selected photos; the
engine then infers them from its category priors, exactly as it does today. Everything the
lab knows beyond the contract travels under ``kerbfront`` (ignored by the engine).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict

from .config import AREAS, OUT
from .faces import _simplified_ring, buildings_from_datasf
from .geo import Frame
from .sources import datasf


def _category(fields: dict) -> str | None:
    for k in ("category", "osm_kind"):
        v = (fields.get(k) or {}).get("value")
        if v:
            return str(v).split("=")[-1].replace("_", " ")
    return None


def program(bd, ring, tenants: list[dict], picks: dict[str, list],
            frame: Frame | None = None) -> dict:
    ox, oy = ring[0]
    coords = [[round(x - ox, 3), round(y - oy, 3)] for x, y in ring]
    coords.append(coords[0])
    prog = {"id": f"kerbfront-{bd.id}", "units": "metres",
            "footprint": {"type": "Polygon", "coordinates": [coords]},
            "height_m": bd.height_m, "tenants": [], "frontages": [],
            "source": "kerbfront sweep: DataSF footprint + merged business records; spans inferred",
            "kerbfront": {"building": bd.id, "tenants": {}}}
    if frame is not None:
        lon, lat = frame.lonlat(ox, oy)
        prog["origin_lon_lat"] = [round(lon, 8), round(lat, 8)]
    for i, z in enumerate(tenants):
        tid = f"T{i + 1}"
        fl = z["fields"]
        t = {"id": tid, "name": (fl.get("name") or {}).get("value"), "category": _category(fl)}
        if (fl.get("brand") or {}).get("value"):
            t["brand"] = fl["brand"]["value"]
        if z.get("osm_tags"):
            t["tags"] = z["osm_tags"]
        prog["tenants"].append(t)
        edge = int(z["face"]["id"].rsplit(":", 1)[1])
        # clamp to the emitted (rounded) edge: the engine refuses a span a millimetre too long
        L = math.floor(math.dist(coords[edge], coords[edge + 1]) * 1000) / 1000
        span = z["face"].get("tenant_span_m") or [0.0, L]
        span = [max(0.0, min(span[0], L - 0.01)), min(span[1], L)]
        prog["frontages"].append({"edge": edge, "tenant_id": tid, "u0": span[0], "u1": span[1],
                                  "role": "public", "openings_complete": False,
                                  "signs_complete": False})
        prog["kerbfront"]["tenants"][tid] = {
            "business": z["id"], "confidence": {k: v["confidence"] for k, v in fl.items()},
            "outdoor": z.get("outdoor"), "span_inferred": z["face"].get("span_inferred", True),
            "photos": [p["frame_id"] for p in picks.get(z["id"], [])],
            "last_exterior_change": z.get("last_exterior_change")}
    return prog


def run(area: str = "marina-union", corridor: str | None = None) -> dict:
    out = OUT / area
    biz = json.loads((out / "businesses.json").read_text())
    fj = json.loads((out / "faces.json").read_text())
    frame = Frame(*fj["frame_origin"])
    picks: dict[str, list] = {}
    pfile = out / f"photos_{corridor or 'all'}.json"
    if pfile.exists():
        picks = {r["business"]: r["picks"] for r in json.loads(pfile.read_text())["results"]}
    fp_rows, _ = datasf.footprints(AREAS[area])
    blds = {bd.id: bd for bd in buildings_from_datasf(fp_rows, frame)}
    by_b = defaultdict(list)
    for z in biz:
        if z.get("face") and z["storefront_likelihood"] >= 0.5 and \
                (corridor is None or z.get("corridor") == corridor):
            by_b[z["building"]["id"]].append(z)
    progs, skipped = [], []
    for bid, ts in by_b.items():
        bd = blds[bid]
        if not bd.height_m or bd.height_m < 2.3:   # the engine refuses sub-storey shells
            skipped.append(bid)
            continue
        progs.append(program(bd, _simplified_ring(bd.poly), ts, picks, frame))
    dest = out / f"exterior_programs_{corridor or 'all'}.json"
    dest.write_text(json.dumps(progs, indent=1, default=str))
    return {"programs": len(progs), "tenants": sum(len(p["tenants"]) for p in progs),
            "skipped_no_height": len(skipped), "file": str(dest)}
