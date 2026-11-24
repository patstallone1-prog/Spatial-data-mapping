"""DataSF (data.sf.gov, Socrata) datasets for storefronts, verified 2026-11-23.

| id          | dataset                                              | used for                        |
|-------------|------------------------------------------------------|---------------------------------|
| g8m3-pdis   | Registered Business Locations (6284-sbmj is its map)  | legal + DBA name, NAICS, dates  |
| dpch-7nr4   | Table and Chairs / Display Merchandise (Shared Spaces)| sidewalk seating, displays      |
| jczu-j2ku   | Parklet Permits                                       | parklets (roadway seating)      |
| bpc9-7sus   | Active and upcoming street surface permits            | parklet length/side/offsets     |
| ynuv-fyni   | Building Footprints (asx6-3trm is the 2017 FileGDB)   | outlines + LiDAR heights        |
| acdm-wktn   | Parcels - Active and Retired                          | APN, address range, zoning      |
| wv5m-vpq2   | Assessor Historical Secured Property Tax Rolls        | year built, stories, use, lot   |
| 3tsw-4idn   | Historic Resource Status by Parcel                    | CEQA historic status, year      |
| 43um-8u7u   | Historic Context Statements                           | architect, building type        |
| c5ge-t6pj   | San Francisco Land Use                                | retail/commercial sqft          |
| i98e-djp9   | Building Permits (DBI)                                | sign/awning/storefront permits  |
| qvu5-m3a2   | Planning Department Records - Projects                | facade alterations, formula ret.|
"""

from __future__ import annotations

import re

from ..config import BBox
from .http import get_json

BASE = "https://data.sf.gov/resource/{}.json"
PAGE = 20000

#: Words in a DBI permit description that touch a storefront's exterior.
FACADE_WORDS = ("SIGN", "AWNING", "CANOPY", "STOREFRONT", "STORE FRONT", "FACADE", "FAÇADE",
                "PARKLET", "BLADE", "NEON", "MARQUEE", "WINDOW", "EXTERIOR", "TILE", "PAINT")


def soql(dataset: str, where: str, select: str | None = None, order: str = ":id",
         refresh: bool = False) -> tuple[list[dict], dict]:
    """All rows (paged) plus a provenance stub {dataset, url, retrieved_at, where}."""
    rows: list[dict] = []
    retrieved = None
    offset = 0
    while True:
        params = {"$where": where, "$order": order, "$limit": PAGE, "$offset": offset}
        if select:
            params["$select"] = select
        rec = get_json("datasf", BASE.format(dataset), params, refresh=refresh)
        retrieved = retrieved or rec["retrieved_at"]
        rows.extend(rec["body"])
        if len(rec["body"]) < PAGE:
            break
        offset += PAGE
    return rows, {"dataset": dataset, "url": BASE.format(dataset), "retrieved_at": retrieved,
                  "where": where}


def _box(col: str, b: BBox) -> str:
    return f"within_box({col}, {b.north}, {b.west}, {b.south}, {b.east})"


def businesses(b: BBox, **kw):
    """Open registered locations: no location or DBA end date, not administratively closed."""
    where = (f"{_box('location', b)} AND location_end_date IS NULL AND dba_end_date IS NULL "
             "AND administratively_closed IS NULL")
    sel = ("uniqueid,ttxid,certificate_number,ownership_name,dba_name,full_business_address,"
           "business_zip,dba_start_date,location_start_date,self_reported_naics_code,"
           "lic_code_descriptions_list,business_corridor,location")
    return soql("g8m3-pdis", where, sel, **kw)


def shared_spaces(b: BBox, **kw):
    return soql("dpch-7nr4", _box("point", b), **kw)


def parklets(b: BBox, **kw):
    where = (f"latitude between {b.south} and {b.north} AND "
             f"longitude between {b.west} and {b.east}")
    return soql("jczu-j2ku", where, **kw)


def street_space_permits(b: BBox, **kw):
    """Parklet and additional-street-space permits; descriptions carry exact placement."""
    where = (f"{_box('point', b)} AND permit_type in ('Parklet', 'AddlStSpac')")
    return soql("bpc9-7sus", where, **kw)


PLACEMENT = re.compile(
    r"(?P<kind>Fixed/Movable|Fixed|Movable)?\s*(?:Commercial\s+)?Parklet\s+occupying approximately\s+"
    r"(?P<len>\d+(?:\.\d+)?) linear feet in the (?P<where>roadway|sidewalk) at (?P<addr>[^,]+), on the "
    r"(?P<side>NORTH|SOUTH|EAST|WEST) side of (?P<street>[^,]+), from (?P<a>\d+) feet to (?P<b>\d+) feet "
    r"(?P<dir>NORTH|SOUTH|EAST|WEST) of (?P<cross>[^.]+)\.", re.I)


def parse_placement(desc: str | None) -> dict | None:
    """'...Fixed Commercial Parklet occupying approximately 19 linear feet in the roadway at
    3244 SCOTT ST, on the EAST side of SCOTT ST, from 60 feet to 79 feet SOUTH of CHESTNUT ST.'"""
    m = PLACEMENT.search(desc or "")
    if not m:
        return None
    ft = 0.3048
    return {"kind": (m["kind"] or "unspecified").lower(), "length_m": round(float(m["len"]) * ft, 2),
            "in": m["where"].lower(), "address": m["addr"].strip(), "side": m["side"].upper(),
            "street": m["street"].strip().upper(), "from_m": round(int(m["a"]) * ft, 2),
            "to_m": round(int(m["b"]) * ft, 2), "direction": m["dir"].upper(),
            "cross_street": m["cross"].strip().upper()}


def footprints(b: BBox, **kw):
    sel = "sf16_bldgid,mblr,hgt_median_m,gnd_min_m,hgt_maxcm,shape"
    return soql("ynuv-fyni", _box("shape", b), sel, **kw)


def parcels(b: BBox, **kw):
    sel = ("blklot,block_num,lot_num,from_address_num,to_address_num,street_name,street_type,"
           "zoning_code,zoning_district,shape")
    return soql("acdm-wktn", _box("shape", b) + " AND active = true", sel, **kw)


def historic_status(b: BBox, **kw):
    return soql("3tsw-4idn", _box("the_geom", b), **kw)


def context_statements(b: BBox, **kw):
    return soql("43um-8u7u", _box("the_geom", b), **kw)


def land_use(b: BBox, **kw):
    return soql("c5ge-t6pj", _box("the_geom", b), **kw)


def _in(col: str, values: list[str]) -> str:
    return f"{col} in (" + ",".join(f"'{v}'" for v in sorted(set(values))) + ")"


def _chunks(values: list[str], n: int = 120):
    vals = sorted(set(values))
    for i in range(0, len(vals), n):
        yield vals[i:i + n]


def assessor(blocks: list[str], **kw):
    """Latest roll rows for the given blocks (closed_roll_year descending, deduped by parcel)."""
    rows, prov = [], None
    sel = ("closed_roll_year,parcel_number,block,lot,property_location,use_code,use_definition,"
           "property_class_code_definition,year_property_built,number_of_stories,number_of_units,"
           "construction_type,lot_frontage,lot_depth,lot_area,property_area,zoning_code")
    for part in _chunks(blocks):
        got, prov = soql("wv5m-vpq2", _in("block", part) + " AND closed_roll_year >= '2022'",
                         sel, **kw)
        rows.extend(got)
    latest: dict[str, dict] = {}
    for r in rows:
        k = r.get("parcel_number")
        if k and (k not in latest or r["closed_roll_year"] > latest[k]["closed_roll_year"]):
            latest[k] = r
    return list(latest.values()), prov


def facade_permits(blocks: list[str], since: str = "2000-01-01", **kw):
    """DBI permits on these blocks whose description mentions an exterior/storefront element."""
    words = " OR ".join(f"upper(description) like '%{w}%'" for w in FACADE_WORDS)
    sel = ("permit_number,permit_type_definition,block,lot,street_number,street_name,"
           "street_suffix,unit,description,status,filed_date,issued_date,completed_date,"
           "existing_use,proposed_use,estimated_cost,revised_cost")
    rows, prov = [], None
    for part in _chunks(blocks):
        got, prov = soql("i98e-djp9", f"{_in('block', part)} AND filed_date >= '{since}' "
                         f"AND ({words})", sel, order="filed_date DESC", **kw)
        rows.extend(got)
    return rows, prov


def planning_projects(blocks: list[str], **kw):
    sel = ("record_id,record_type,project_name,description,record_status,project_address,block,"
           "lot,open_date,close_date,facade_alt,formula_retail,change_of_use,"
           "other_non_res_desc,project_decision")
    rows, prov = [], None
    for part in _chunks(blocks):
        got, prov = soql("qvu5-m3a2", _in("block", part), sel, order="open_date DESC", **kw)
        rows.extend(got)
    return rows, prov
