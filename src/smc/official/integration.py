"""Typed municipal consumers; GIS appearance is not a certified physical survey."""
from __future__ import annotations

from itertools import pairwise

import numpy as np

from smc.official.regional_evidence import digest

ROLES = {"san-jose-sidewalks": "sidewalk_appearance", "san-jose-curbfaces": "curb_colour",
         "san-jose-survey-controls": "control_review", "san-jose-project-lines": "change_review",
         "palo-alto-road-edges": "edge_validation", "oakland-curb-inventory": "historic_parking_validation"}


def integrate_inventory(name: str, inventory: dict) -> dict:
    if inventory.get("horizontal_crs") != "EPSG:4326":
        raise ValueError("municipal integration requires explicit WGS84 coordinates")
    features = inventory["features"]
    if digest(features) != inventory["sha256"]:
        raise ValueError("municipal source checksum changed")
    role = ROLES[name]
    out = {"schema": "kerbside.municipal_context/1", "sources": [{
        "id": name, "sha256": inventory["sha256"], "url": inventory["source"]["url"],
        "attribution": inventory["source"]["attribution"], "retrieved_at": inventory["retrieved_at"],
        "role": role, "features": len(features), "geometry_accuracy_m": None,
        "measured_physical_geometry": False}],
        "sidewalks": [], "curb_colours": [], "references": [], "excluded": {}}
    for feature in features:
        p = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if not geometry.get("coordinates"):
            out["excluded"]["no_geometry"] = out["excluded"].get("no_geometry", 0) + 1
            continue
        ident = str(p.get("OBJECTID", feature.get("id", p.get("block_face", ""))))
        base = {"source_id": name, "feature_id": ident, "source_sha256": inventory["sha256"],
                "basis": "municipal_GIS_inventory_not_field_survey", "geometry_accuracy_m": None}
        if role == "sidewalk_appearance":
            polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"] if geometry["type"] == "MultiPolygon" else []
            for polygon in polygons:
                # The current planar renderer accepts one ring. Never fill a courtyard hole.
                if len(polygon) != 1:
                    out["excluded"]["polygon_with_holes"] = out["excluded"].get("polygon_with_holes", 0) + 1
                    continue
                out["sidewalks"].append({**base, "p": polygon[0], "material": "concrete",
                                         "material_basis": "sidewalk_default_not_observed_material"})
        elif role == "curb_colour":
            colour = str(p.get("CURBCOLOR", "")).strip().lower()
            lines = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"] if geometry["type"] == "MultiLineString" else []
            if colour in {"red", "yellow", "white", "green", "blue"} and lines:
                out["curb_colours"].append({**base, "curb_color": colour, "lines": lines,
                                            "observed_at_source_ms": p.get("LASTUPDATE"),
                                            "legal_restriction_claim": False})
        else:
            # Controls are not fit anchors until datum, correspondence and freshness pass.
            # Projects are not as-built kerbs; the 2015 inventory is not live parking policy.
            fields = ("SOURCE", "INPUTMETHOD", "MODIFIEDDATE", "ELEVATIONFT", "REFERENCEMARK",
                      "PRJID", "PRJNAME", "PHASE", "LASTUPDATE", "LASTREVIEWED", "space_reg", "total_sp_1")
            out["references"].append({**base, "role": role, "geometry": geometry,
                                       "attributes": {k: p[k] for k in fields if k in p},
                                       "eligible_as_fit_control": False, "physical_rendering": False})
    return out


def road_edge_check(features: list[dict], payload: dict) -> dict:
    """Compare mixed GIS edges to nominal roads; never optimize/select truth by error.

    Closest centreline establishes the tentative match, not whichever width fits
    best. Parallelism and endpoint screens reject ambiguous junction geometry.
    This is a disagreement screen, not curb accuracy against surveyed truth.
    """
    b = payload["bbox"]
    origin = np.array([(b["west"]+b["east"])/2, (b["south"]+b["north"])/2])
    scale = np.array([111320*np.cos(np.deg2rad(origin[1])),111320])
    segments, widths = [], []
    for way in payload["ways"]:
        if way.get("kind") != "street" or not way.get("road_m"):
            continue
        p = (np.asarray(way["points"])[:,:2]-origin)*scale
        for a, c in pairwise(p):
            if np.linalg.norm(c-a)>1:
                segments.append([a,c])
                widths.append(way["road_m"]/2)
    if not segments:
        return {"attempted": len(features), "supported": 0, "independent_accuracy_claim": False}
    ab = np.asarray(segments)
    a, delta = ab[:,0], ab[:,1]-ab[:,0]
    length = np.linalg.norm(delta,axis=1)
    direction = delta/length[:,None]
    errors, cohorts = [], {}
    for feature in features:
        g = feature.get("geometry") or {}
        lines = [g["coordinates"]] if g.get("type")=="LineString" else g.get("coordinates",[]) if g.get("type")=="MultiLineString" else []
        values = []
        for line in lines:
            p = (np.asarray(line)[:,:2]-origin)*scale
            if len(p)<2:
                continue
            i = len(p)//2
            tangent = p[min(i+1,len(p)-1)]-p[max(0,i-1)]
            norm = np.linalg.norm(tangent)
            if norm<.1:
                continue
            t = np.clip(((p[i]-a)*direction).sum(axis=1),0,length)
            distances = np.linalg.norm(p[i]-(a+direction*t[:,None]),axis=1)
            j = int(np.argmin(distances))
            if 1<distances[j]<30 and abs(direction[j] @ (tangent/norm))>.96 and 2<t[j]<length[j]-2:
                values.append(abs(float(distances[j])-widths[j]))
        if values:
            errors.append(float(np.mean(values)))
            props = feature.get("properties") or {}
            cohort = f"{props.get('SOURCE','unknown')} / {props.get('INPUTMETHOD','unknown')}"
            cohorts[cohort] = cohorts.get(cohort,0)+1
    return {"attempted":len(features),"supported":len(errors),
            "median_discrepancy_m":float(np.median(errors)) if errors else None,
            "p90_discrepancy_m":float(np.percentile(errors,90)) if errors else None,
            "source_cohorts":cohorts,"independent_accuracy_claim":False,
            "note":"Mixed edge inventory vs nominal road; correspondence/edge role need review before fitting."}
