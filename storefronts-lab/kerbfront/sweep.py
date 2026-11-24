"""The data sweep: every public record about every storefront in an area, merged.

    python -m kerbfront sweep --area marina-union

writes ``out/<area>/businesses.json`` (one record per business, provenance on every field),
``faces.json`` (street faces of every footprint), ``buildings.json`` (per-building shell facts)
and ``sweep_summary.json``.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

from shapely.geometry import Point, Polygon, shape
from shapely.ops import nearest_points
from shapely.strtree import STRtree
from shapely import wkt as shapely_wkt

from . import faces as facemod
from .config import AREAS, OUT, BBox, corridor_of
from .geo import Frame, point_seg_dist
from .merge import merge
from .normalize import osm_address, parse_address, same_address, street_key
from .sources import datasf, kerbside, osm, overture

OSM_KINDS = osm.KINDS
EXTERIOR_PERMIT = re.compile(r"\b(SIGN|SIGNS|SIGNAGE|AWNING|CANOPY|STOREFRONT|STORE FRONT|FACADE|"
                             r"FAÇADE|BLADE|NEON|PARKLET)\b", re.I)


def _pt(geom) -> tuple[float, float] | None:
    g = facemod._geom(geom) if geom else None
    if g and g.get("type") == "Point":
        return tuple(g["coordinates"][:2])
    return None


def _first(v):
    if isinstance(v, (list, tuple)):
        return v[0] if v else None
    return v


def observations(b: BBox) -> tuple[list[dict], dict]:
    obs: list[dict] = []
    provs: dict = {}

    rows, provs["registry"] = datasf.businesses(b)
    for r in rows:
        p = _pt(r.get("location"))
        obs.append({"source": "registry", "source_id": r["uniqueid"],
                    "retrieved_at": provs["registry"]["retrieved_at"],
                    "name": r.get("dba_name") or r.get("ownership_name") or "",
                    "alt_names": [r["ownership_name"]] if r.get("ownership_name") else [],
                    "lon": p[0] if p else None, "lat": p[1] if p else None,
                    "address": parse_address(r.get("full_business_address")),
                    "attrs": {"legal_name": r.get("ownership_name"),
                              "naics": r.get("self_reported_naics_code"),
                              "license_codes": r.get("lic_code_descriptions_list"),
                              "location_start_date": (r.get("location_start_date") or "")[:10] or None,
                              "business_corridor": r.get("business_corridor")}})

    rows, provs["overture"] = overture.places(b)
    for r in rows:
        if not r.get("name"):
            continue
        obs.append({"source": "overture", "source_id": r["id"],
                    "retrieved_at": provs["overture"]["retrieved_at"], "name": r["name"],
                    "alt_names": [], "lon": r["lon"], "lat": r["lat"],
                    "address": parse_address(r.get("address")),
                    "attrs": {"category": r.get("category") or r.get("basic_category"),
                              "category_path": list(r.get("category_path") or []) or None,
                              "brand": r.get("brand"), "brand_wikidata": r.get("brand_wikidata"),
                              "website": _first(r.get("websites")), "phone": _first(r.get("phones")),
                              "operating_status": r.get("operating_status"),
                              "confidence": r.get("confidence"), "updated": r.get("updated")}})

    els, provs["osm"] = osm.fetch(b)
    parts = osm.split(els)
    for p in parts["pois"]:
        t = p["tags"]
        name = t.get("name") or t.get("brand")
        if not name:
            continue
        kind = next((f"{k}={t[k]}" for k in OSM_KINDS if k in t), None)
        bldg = {k: v for k, v in t.items() if k.startswith(("building", "roof"))} or None
        obs.append({"source": "osm", "source_id": p["id"], "retrieved_at": provs["osm"]["retrieved_at"],
                    "name": name, "alt_names": [t[k] for k in ("alt_name", "old_name", "official_name")
                                                if t.get(k)],
                    "lon": p["lon"], "lat": p["lat"], "address": osm_address(t),
                    "osm_tags": t,
                    "attrs": {"osm_kind": kind, "brand": t.get("brand"),
                              "brand_wikidata": t.get("brand:wikidata"),
                              "cuisine": t.get("cuisine"), "opening_hours": t.get("opening_hours"),
                              "outdoor_seating": t.get("outdoor_seating"),
                              "wheelchair": t.get("wheelchair"),
                              "website": t.get("website") or t.get("contact:website"),
                              "phone": t.get("phone") or t.get("contact:phone"),
                              "osm_building_tags": json.dumps(bldg, sort_keys=True) if bldg else None}})

    rows, provs["shared_spaces"] = datasf.shared_spaces(b)
    for r in rows:
        p = _pt(r.get("point"))
        obs.append({"source": "shared_spaces", "source_id": r["id"],
                    "retrieved_at": provs["shared_spaces"]["retrieved_at"],
                    "name": r.get("dbaname") or r.get("businessname") or "",
                    "alt_names": [r["businessname"]] if r.get("businessname") else [],
                    "lon": p[0] if p else None, "lat": p[1] if p else None,
                    "address": parse_address(r.get("streetaddress")),
                    "details": {"shared_spaces": {k: r.get(k) for k in (
                        "id", "tablesandchairs", "displaymerchandise", "sidewalk_width",
                        "hoursofoperation", "submission_created", "busstartdate")}},
                    "attrs": {"sidewalk_tables": str(r.get("tablesandchairs")).lower() == "true",
                              "display_merchandise": str(r.get("displaymerchandise")).lower() == "true",
                              "sidewalk_width_ft": r.get("sidewalk_width")}})

    rows, provs["parklet"] = datasf.parklets(b)
    for r in rows:
        if r.get("permit_status", "").upper() not in ("APPROVED", "ACTIVE", "ISSUED"):
            continue
        obs.append({"source": "parklet", "source_id": r["permit_number"],
                    "retrieved_at": provs["parklet"]["retrieved_at"],
                    "name": r.get("applicant") or "", "alt_names": [],
                    "lon": float(r["longitude"]), "lat": float(r["latitude"]),
                    "address": parse_address(r.get("permit_address")),
                    "details": {"parklet": {k: r.get(k) for k in (
                        "permit_number", "permit_purpose", "permit_status", "permit_approval_date",
                        "permit_end_date", "cross_street_1", "cross_street_2", "cnn")}},
                    "attrs": {"parklet": True}})
    rows, provs["street_permits"] = datasf.street_space_permits(b)
    for r in rows:
        if (r.get("status") or "").upper() not in ("APPROVED", "ACTIVE", "ISSUED"):
            continue
        place = datasf.parse_placement(r.get("permit_description"))
        p = _pt(r.get("point"))
        obs.append({"source": "parklet", "source_id": r["permit_number"],
                    "retrieved_at": provs["street_permits"]["retrieved_at"],
                    "name": r.get("dba_name") or "", "alt_names": [],
                    "lon": p[0] if p else None, "lat": p[1] if p else None,
                    "address": parse_address(place["address"]) if place else None,
                    "details": {"parklet_placement": place,
                                "street_permit": {k: r.get(k) for k in (
                                    "permit_number", "permit_type", "status", "approved_date",
                                    "permit_start_date", "permit_end_date", "permit_description")}},
                    "attrs": {"parklet": r.get("permit_type") == "Parklet"}})

    # rows without a point still merge by address; rows placed outside the area are dropped
    obs = [o for o in obs if o["lat"] is None or b.contains(o["lat"], o["lon"])]
    return obs, {"provenance": provs, "osm_parts": parts}


def _iou(a: Polygon, b: Polygon) -> float:
    try:
        inter = a.intersection(b).area
    except Exception:  # noqa: BLE001 - invalid geometry from a source
        return 0.0
    return inter / (a.area + b.area - inter) if inter else 0.0


def _best_match(poly: Polygon, tree: STRtree, polys: list[Polygon], min_iou: float = 0.3):
    best, bi = 0.0, None
    for j in tree.query(poly):
        v = _iou(poly, polys[j])
        if v > best:
            best, bi = v, j
    return (bi, best) if best >= min_iou else (None, best)


COMMERCIAL_ZONING = re.compile(r"^(NC|NCD|NCT|C-|RC-|CRNC|UMU)")


def _currency(z: dict) -> float:
    """How strongly the record says the business is there *now* (for one-address contests)."""
    src = set(z["sources"])
    s = 0.35 * ("osm" in src) + 0.3 * ("registry" in src) + 0.3 * bool(src & {"shared_spaces", "parklet"})
    for o in z["observations"]:
        if o["source"] == "overture":
            conf = (z["fields"].get("name") or {}).get("confidence", 0)
            s += 0.25 if conf >= 0.8 else 0.1
            break
    return s + 0.02 * len(src)


def refine_storefronts(businesses: list[dict], bfacts: dict) -> None:
    """Add building context (zoning, land use) and settle one occupant per shopfront address.

    Overture keeps closed and moved businesses at their old address for a long time, and the
    registry keeps upstairs offices at the street number. When several plausible storefronts
    share one street number (and unit) on one face, the one with the most current evidence is
    the occupant; the rest are kept but marked ``previous_or_upstairs`` and capped below the
    storefront threshold.
    """
    for z in businesses:
        b = bfacts.get((z.get("building") or {}).get("id"), {})
        zoning = (b.get("parcel") or {}).get("zoning") or ""
        lu = b.get("land_use") or {}
        s, why = z["storefront_likelihood"], z["storefront_evidence"]
        if COMMERCIAL_ZONING.match(zoning):
            s += 0.2
            why.append(f"commercial_zoning:{zoning}")
        elif zoning.startswith("RH"):
            s -= 0.15
            why.append(f"house_zoning:{zoning}")
        try:
            if float(lu.get("retail") or 0) + float(lu.get("visitor") or 0) > 0:
                s += 0.1
                why.append("parcel_has_retail_floorspace")
        except ValueError:
            pass
        z["storefront_likelihood"] = round(max(0.0, min(1.0, s)), 2)
    contests = defaultdict(list)
    for z in businesses:
        a = z.get("address")
        if a and z.get("face") and z["storefront_likelihood"] >= 0.5:
            contests[(z["face"]["id"], a["street"], a["number"], a.get("unit"))].append(z)
    for group in contests.values():
        if len(group) < 2:
            continue
        group.sort(key=_currency, reverse=True)
        lead = group[0]
        lead["occupancy"] = {"role": "occupant", "rivals": [g["id"] for g in group[1:]]}
        for g in group[1:]:
            if _currency(g) >= 0.9 and len(g["sources"]) >= 3:
                g["occupancy"] = {"role": "co_tenant", "rivals": [lead["id"]]}
                continue
            g["occupancy"] = {"role": "previous_or_upstairs", "occupant": lead["id"]}
            g["storefront_likelihood"] = min(g["storefront_likelihood"], 0.45)
            g["storefront_evidence"].append("lost_address_contest")


def run(area: str = "marina-union") -> dict:
    b = AREAS[area]
    out = OUT / area
    out.mkdir(parents=True, exist_ok=True)
    frame = Frame(*b.centre)

    obs, extra = observations(b)
    provs, parts = extra["provenance"], extra["osm_parts"]
    details = defaultdict(dict)
    osm_tags = {}
    for o in obs:
        if o.get("details"):
            details[f"{o['source']}:{o['source_id']}"].update(o["details"])
        if o.get("osm_tags"):
            osm_tags[o["source_id"]] = o["osm_tags"]
    businesses = merge(obs)

    # ---- buildings and faces -------------------------------------------------------------
    fp_rows, provs["footprints"] = datasf.footprints(b)
    buildings = facemod.buildings_from_datasf(fp_rows, frame)
    streets = facemod.streets_from_osm(parts["streets"], frame)
    all_faces = facemod.build_faces(buildings, streets)
    faces_by_b = defaultdict(list)
    for f in all_faces:
        faces_by_b[f.building_id].append(f)
    bpolys = [x.poly for x in buildings]
    btree = STRtree(bpolys)

    # OSM + Overture building matches (by IoU)
    osm_b = [(p, Polygon([frame.xy(x, y) for x, y in p["geometry"]]))
             for p in parts["buildings"] if len(p["geometry"]) >= 4]
    osm_b = [(p, g if g.is_valid else g.buffer(0)) for p, g in osm_b]
    otree = STRtree([g for _, g in osm_b]) if osm_b else None
    ov_rows, provs["overture_buildings"] = overture.buildings(b)
    ov = []
    for r in ov_rows:
        g = shapely_wkt.loads(r["geometry"])
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda x: x.area)
        if g.geom_type == "Polygon":
            lg = Polygon([frame.xy(x, y) for x, y in g.exterior.coords])
            ov.append((r, lg if lg.is_valid else lg.buffer(0)))
    vtree = STRtree([g for _, g in ov]) if ov else None

    # parcels -> assessor / historic / land use / permits / planning
    par_rows, provs["parcels"] = datasf.parcels(b)
    parcels = []
    for r in par_rows:
        g = shape(facemod._geom(r["shape"]))
        g = max(g.geoms, key=lambda x: x.area) if g.geom_type == "MultiPolygon" else g
        lg = Polygon([frame.xy(x, y) for x, y in g.exterior.coords])
        parcels.append((r, lg if lg.is_valid else lg.buffer(0)))
    ptree = STRtree([g for _, g in parcels])
    blocks = sorted({r["block_num"] for r, _ in parcels})
    roll, provs["assessor"] = datasf.assessor(blocks)
    roll_by = {r["parcel_number"]: r for r in roll}
    hist, provs["historic_status"] = datasf.historic_status(b)
    hist_by = {r.get("apn"): r for r in hist}
    ctx, provs["context_statements"] = datasf.context_statements(b)
    ctx_by = {r.get("apn"): r for r in ctx}
    lu, provs["land_use"] = datasf.land_use(b)
    lu_by = {r.get("mapblklot"): r for r in lu}
    permits, provs["permits"] = datasf.facade_permits(blocks)
    permits_by = defaultdict(list)
    for p in permits:
        permits_by[(p.get("block") or "") + (p.get("lot") or "")].append(p)
    planning, provs["planning"] = datasf.planning_projects(blocks)
    plan_by = defaultdict(list)
    for p in planning:
        plan_by[(p.get("block") or "") + (p.get("lot") or "")].append(p)

    # the live app's own buildings (canonical shells, photo-backed openings, materials, roofs)
    kb = kerbside.buildings(b)
    provs["kerbside"] = kerbside.provenance()
    kb_rows = []
    for oid, r in kb.items():
        g = Polygon([frame.xy(x, y) for x, y in r["points"]])
        kb_rows.append((oid, g if g.is_valid else g.buffer(0)))
    ktree = STRtree([g for _, g in kb_rows]) if kb_rows else None
    services, provs["google_services"] = kerbside.restaurant_services()

    bfacts: dict[str, dict] = {}
    for bi, bd in enumerate(buildings):
        rec: dict = {"id": bd.id, "source": bd.source, "height_m": bd.height_m,
                     "ground_m": bd.ground_m, "area_m2": round(bd.poly.area, 1)}
        if otree is not None:
            j, v = _best_match(bd.poly, otree, [g for _, g in osm_b])
            if j is not None:
                p = osm_b[j][0]
                rec["osm"] = {"id": p["id"], "iou": round(v, 2),
                              "tags": {k: t for k, t in p["tags"].items()
                                       if k.startswith(("building", "roof", "addr", "start_date",
                                                        "height", "name", "historic"))}}
        if vtree is not None:
            j, v = _best_match(bd.poly, vtree, [g for _, g in ov])
            if j is not None:
                r = ov[j][0]
                rec["overture"] = {"id": r["id"], "iou": round(v, 2), "height": r.get("height"),
                                   "num_floors": r.get("num_floors"), "class": r.get("class"),
                                   "facade_material": r.get("facade_material"),
                                   "roof_shape": r.get("roof_shape")}
        if ktree is not None:
            j, v = _best_match(bd.poly, ktree, [g for _, g in kb_rows])
            if j is not None:
                oid = kb_rows[j][0]
                r = kb[oid]
                rec["kerbside"] = {"osm_id": oid, "iou": round(v, 2), "height_m": r.get("height_m"),
                                   "archetype": r.get("archetype"),
                                   "wall_material": r.get("wall_material"),
                                   "wall_colour": (r.get("wall_assigned") or {}).get("colour"),
                                   "roof_colour": (r.get("roof") or {}).get("c"),
                                   "photo_openings": sum(len(x) for x in ((r.get("openings") or {}).get("walls") or {}).values()),
                                   "storefront_programs": len(r.get("storefront_programs") or []),
                                   "tenants": [s.get("n") for s in (r.get("shops") or [])]}
        # parcel = the one holding most of the footprint
        best, bp = 0.0, None
        for j in ptree.query(bd.poly):
            a = bd.poly.intersection(parcels[j][1]).area
            if a > best:
                best, bp = a, parcels[j][0]
        if bp is not None:
            apn = bp["blklot"]
            ar = roll_by.get(apn, {})
            rec["parcel"] = {"apn": apn, "address_range": [bp.get("from_address_num"), bp.get("to_address_num")],
                             "street": street_key(f"{bp.get('street_name', '')} {bp.get('street_type', '')}"),
                             "zoning": bp.get("zoning_code"), "zoning_district": bp.get("zoning_district")}
            if ar:
                rec["assessor"] = {k: ar.get(k) for k in (
                    "closed_roll_year", "year_property_built", "number_of_stories", "number_of_units",
                    "use_definition", "property_class_code_definition", "construction_type",
                    "lot_frontage", "lot_depth", "lot_area", "property_area")}
            if apn in hist_by:
                h = hist_by[apn]
                rec["historic"] = {k: h.get(k) for k in ("ceqacode", "ceqacodereason", "yearbuilt", "name")}
            if apn in ctx_by:
                c = ctx_by[apn]
                rec["context_statement"] = {k: c.get(k) for k in (
                    "hbuilding_type", "architect", "yr_built", "historic_context_statement_name", "notes")}
            if apn in lu_by:
                u = lu_by[apn]
                rec["land_use"] = {k: u.get(k) for k in ("retail", "total_comm", "resunits", "visitor", "cie", "med")}
            rec["permit_count"] = len(permits_by.get(apn, []))
            rec["planning_count"] = len(plan_by.get(apn, []))
        rec["street_faces"] = [f.id for f in faces_by_b[bd.id] if f.role == "street"]
        bfacts[bd.id] = rec

    # ---- business -> building -> face ------------------------------------------------------
    def building_for(biz: dict):
        pos = biz.get("position")
        if not pos:
            return None, None
        pt = Point(frame.xy(pos["lon"], pos["lat"]))
        cands = []
        for j in btree.query(pt.buffer(30)):
            d = bpolys[j].distance(pt)
            par = bfacts[buildings[j].id].get("parcel") or {}
            addr_ok = False
            a = biz.get("address")
            if a and par.get("street") == a["street"]:
                lo, hi = par.get("address_range") or [None, None]
                try:
                    lo, hi = int(lo), int(hi)
                    addr_ok = lo - 1 <= a["number"] <= hi + 1
                except (TypeError, ValueError):
                    pass
            cands.append((0 if d == 0 else 1, 0 if addr_ok else 1, d, j, addr_ok))
        if not cands:
            return None, None
        # an address-confirmed building within 30 m beats a containing one that disagrees
        addr = sorted([c for c in cands if c[4]], key=lambda c: c[2])
        inside = [c for c in cands if c[0] == 0]
        if addr and (not inside or not inside[0][4]):
            c = addr[0]
            how = "address" if c[2] > 0 else "inside+address"
        else:
            c = min(cands, key=lambda c: (c[2], c[1]))
            if c[2] > 15:
                return None, None
            how = ("inside" if c[2] == 0 else f"nearest {c[2]:.1f} m") + ("+address" if c[4] else "")
        return buildings[c[3]], how

    street_lines = defaultdict(list)
    for name, line in streets:
        street_lines[name].append(line)

    def setback_face(bd, biz: dict):
        """No edge fronts a street (a rear-lot shop, a pier shed): the exposed edge that
        looks most directly at the addressed street within 120 m, flagged as a setback."""
        a = biz.get("address")
        lines = street_lines.get(a["street"]) if a else None
        if not lines:
            return None
        best, score = None, 0.5
        for f in faces_by_b[bd.id]:
            if f.role != "open" or f.length_m < 2.5:
                continue
            mx, my = f.mid
            near = min((ln for ln in lines), key=lambda ln: ln.distance(Point(mx, my)))
            q = nearest_points(Point(mx, my), near)[1]
            dx, dy = q.x - mx, q.y - my
            d = (dx * dx + dy * dy) ** 0.5
            if d == 0 or d > 120:
                continue
            nx, ny = f.normal
            c = (dx * nx + dy * ny) / d
            if c > score:
                best, score = f, c
        return best

    def face_for(bd, biz: dict):
        fs = [f for f in faces_by_b[bd.id] if f.role == "street"]
        if not fs:
            return setback_face(bd, biz)
        a = biz.get("address")
        pos = biz["position"]
        pt = frame.xy(pos["lon"], pos["lat"])
        named = [f for f in fs if a and f.street == a["street"]]
        pool = named or fs
        # a short jog in the frontage (a pier, a bay return) is not where a shop's sign is
        long = [f for f in pool if f.length_m >= 2.5]
        pool = long or pool
        return min(pool, key=lambda f: point_seg_dist(pt, f.p0, f.p1)[0])

    by_face = defaultdict(list)
    for biz in businesses:
        bd, how = building_for(biz)
        st = (biz.get("address") or {}).get("street")
        biz["corridor"] = corridor_of(st)
        if bd is None:
            biz["building"] = None
            biz["face"] = None
            continue
        bf = bfacts[bd.id]
        biz["building"] = {"id": bd.id, "match": how}
        f = face_for(bd, biz)
        if f is not None:
            pos = biz["position"]
            _, u = point_seg_dist(frame.xy(pos["lon"], pos["lat"]), f.p0, f.p1)
            biz["face"] = {"id": f.id, "street": f.street or (biz.get("address") or {}).get("street"),
                           "normal_bearing": round(f.normal_bearing, 1),
                           "length_m": round(f.length_m, 2), "u_norm": round(u, 3),
                           "setback": f.role != "street"}
        else:
            biz["face"] = None
        # permits/planning at this business's own address on the parcel
        apn = (bf.get("parcel") or {}).get("apn")
        mine = []
        for p in permits_by.get(apn, []):
            pa = parse_address(f"{p.get('street_number', '')} {p.get('street_name', '')} {p.get('street_suffix', '')}")
            if biz.get("address") and pa and not same_address(pa, biz["address"]):
                continue
            mine.append({k: p.get(k) for k in ("permit_number", "description", "status", "filed_date",
                                               "issued_date", "completed_date", "existing_use",
                                               "proposed_use", "estimated_cost")})
        biz["permits"] = mine[:25]
        ext = [p for p in mine if EXTERIOR_PERMIT.search(p.get("description") or "")
               and p.get("completed_date")]
        biz["last_exterior_change"] = max((p["completed_date"][:10] for p in ext), default=None)
        biz["planning"] = [{k: p.get(k) for k in ("record_id", "record_type", "description", "record_status",
                                                  "open_date", "facade_alt", "formula_retail",
                                                  "other_non_res_desc")}
                           for p in plan_by.get(apn, [])
                           if not biz.get("address") or (p.get("project_address") or "").upper()
                           .startswith(str(biz["address"]["number"]))][:15]
        biz["details"] = {k: v for o in biz["observations"]
                          for k, v in details.get(f"{o['source']}:{o['id']}", {}).items()}
        biz["osm_tags"] = next((osm_tags[o["id"]] for o in biz["observations"]
                                if o["source"] == "osm" and o["id"] in osm_tags), None)
        # outdoor seating summary
        fl = biz["fields"]
        seats = []
        if (fl.get("sidewalk_tables") or {}).get("value"):
            seats.append(("sidewalk", fl["sidewalk_tables"]["confidence"], "shared_spaces"))
        if (fl.get("parklet") or {}).get("value"):
            seats.append(("parklet", fl["parklet"]["confidence"], "parklet"))
        lic = kerbside.licence_facts((fl.get("license_codes") or {}).get("value"))
        biz["licence"] = lic
        if lic.get("parklet"):
            seats.append(("parklet", 0.85, "registry_licence"))
        osv = (fl.get("outdoor_seating") or {}).get("value")
        if osv in ("yes", "sidewalk", "parklet", "patio", "garden", "terrace", "veranda", "pavement"):
            seats.append(({"parklet": "parklet", "patio": "patio", "garden": "patio",
                           "terrace": "patio"}.get(osv, "sidewalk"), fl["outdoor_seating"]["confidence"], "osm"))
        biz["outdoor"] = {"kinds": sorted({s[0] for s in seats}),
                          "confidence": round(max((s[1] for s in seats), default=0.0), 3),
                          "sources": sorted({s[2] for s in seats}),
                          "osm_says_no": osv == "no"}

    refine_storefronts(businesses, bfacts)
    food_in = defaultdict(list)
    for biz in businesses:
        biz["business_type"] = kerbside.business_type(biz)
        kos = (bfacts.get((biz.get("building") or {}).get("id"), {}).get("kerbside") or {}).get("osm_id")
        if kos and biz["business_type"]["render"] == "restaurant":
            food_in[kos].append(biz)
    # the paid Google lookup matched one venue per app building: attach it where that building
    # has exactly one restaurant storefront, otherwise it cannot be told whose it is
    for kos, group in food_in.items():
        sv = services.get(kos)
        if sv and len(group) == 1:
            group[0]["services"] = {k: sv.get(k) for k in (
                "primaryType", "types", "dineIn", "takeout", "reservable", "servesDinner",
                "servesBreakfast", "servesCocktails", "userRatingCount", "fetched_at")}
    for biz in businesses:
        if biz.get("face") and biz["storefront_likelihood"] >= 0.5:
            by_face[biz["face"]["id"]].append(biz)

    # tenant spans along each face: order by projected position, split at midpoints
    face_index = {f.id: f for f in all_faces}
    for fid, group in by_face.items():
        f = face_index[fid]
        group.sort(key=lambda z: (z["face"]["u_norm"], (z.get("address") or {}).get("number", 0)))
        us = [z["face"]["u_norm"] for z in group]
        # points stacked on one spot (a parcel-centroid geocode) say nothing about order or
        # width: fall back to address order and equal shares of the face
        degenerate = any(b - a < 0.03 for a, b in zip(us, us[1:]))
        if degenerate:
            group.sort(key=lambda z: ((z.get("address") or {}).get("number", 0), z["face"]["u_norm"]))
            n = len(group)
            bounds = [(i / n, (i + 1) / n) for i in range(n)]
        else:
            bounds = [(0.0 if i == 0 else (us[i - 1] + us[i]) / 2,
                       1.0 if i == len(group) - 1 else (us[i] + us[i + 1]) / 2)
                      for i in range(len(group))]
        for i, z in enumerate(group):
            u0, u1 = bounds[i]
            z["face"]["tenant_span_m"] = [round(u0 * f.length_m, 2), round(u1 * f.length_m, 2)]
            z["face"]["span_inferred"] = True
            z["face"]["span_method"] = "equal_split_by_address" if degenerate else "midpoints"
            z["face"]["tenants_on_face"] = len(group)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    store = [z for z in businesses if z["storefront_likelihood"] >= 0.5]
    summary = {
        "area": area, "bbox": b.__dict__, "built": now, "frame_origin": [frame.lat0, frame.lon0],
        "observations": dict(Counter(o["source"] for o in obs)),
        "businesses": len(businesses), "storefronts": len(store),
        "storefronts_with_face": sum(1 for z in store if z.get("face")),
        "storefronts_by_corridor": dict(Counter(z.get("corridor") or "other" for z in store)),
        "storefronts_multi_source": sum(1 for z in store if len(z["sources"]) >= 2),
        "outdoor_seating": dict(Counter(k for z in store for k in (z.get("outdoor") or {}).get("kinds", []))),
        "render_as": dict(Counter(z["business_type"]["render"] for z in store)),
        "kerbside_buildings_matched": sum(1 for r in bfacts.values() if r.get("kerbside")),
        "buildings": len(buildings), "faces": len(all_faces),
        "street_faces": sum(1 for f in all_faces if f.role == "street"),
        "provenance": provs,
    }
    (out / "businesses.json").write_text(json.dumps(businesses, indent=1, default=str))
    (out / "faces.json").write_text(json.dumps(
        {"frame_origin": [frame.lat0, frame.lon0], "faces": [f.to_json() for f in all_faces]}))
    (out / "buildings.json").write_text(json.dumps(bfacts, indent=1, default=str))
    (out / "sweep_summary.json").write_text(json.dumps(summary, indent=1, default=str))
    return summary
