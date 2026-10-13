"""RPD's inventories supply identities and semantics, not invented surveyed dimensions."""

from __future__ import annotations

from typing import Any


def _identity(prefix: str, row: dict, field: str) -> str:
    value = row.get(field) or row.get("objectid")
    if value is None or str(value).strip() == "":
        raise ValueError(f"missing stable {prefix} identity")
    return f"rpd:{prefix}:{str(value).strip()}"


def _feature(prefix: str, row: dict, field: str, dataset: str) -> dict[str, Any]:
    geometry = row.get("shape")
    if geometry and geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("RPD inventory geometry is not a polygon")
    kind_field = "facility_type" if prefix == "facility" else "functional_area_type"
    scope = str(row.get("property_id") or "unassigned").strip()
    return {
        # The real inventory reuses some legacy facility IDs across parks. Scope logical
        # identities by the authoritative property ID; OBJECTID remains each spatial part.
        "id": _identity(f"{prefix}:{scope}", row, field),
        "park_id": f"rpd:park:{row['property_id']}" if row.get("property_id") else None,
        "facility_id": f"rpd:facility:{scope}:{row['facility_id']}"
        if row.get("facility_id")
        else None,
        "name": row.get("facility_name") or row.get("property_name"),
        "kind": row.get(kind_field) or "unknown",
        "subtype": row.get("functional_area_subtype"),
        "floor": row.get("floor"),
        "geometry": geometry,
        "crs": "EPSG:4326",
        "geometry_basis": "city_inventory_polygon" if geometry else "unknown",
        "geometry_confidence": 0.70 if geometry else 0,
        "semantic_basis": "sf_rpd_inventory",
        "semantic_confidence": 0.95,
        "surface_material": "unknown",
        "surface_confidence": 0,
        "accessibility": {"status": "unknown", "confidence": 0},
        "status": "existing_inventory",
        "license": "PDDL",
        "provenance": {
            "dataset": dataset,
            "source_url": f"https://data.sf.gov/resource/{dataset}.json",
            "data_as_of": row.get("data_as_of"),
            "edited_at": row.get("last_edited_date"),
        },
        "attributes": {k: v for k, v in row.items() if k != "shape"},
    }


def build_inventory(properties: list[dict], facilities: list[dict], areas: list[dict]) -> dict:
    """Link with the publisher's stable property/facility IDs, never a nearest-name guess."""
    parks, objects, unresolved = {}, {}, []
    for row in properties:
        identity = _identity("park", row, "property_id")
        if identity in parks:
            raise ValueError(f"duplicate park identity: {identity}")
        parks[identity] = {
            "id": identity,
            "name": row.get("property_name"),
            "geometry": row.get("shape"),
            "children": [],
            "license": "PDDL",
            "attributes": {k: v for k, v in row.items() if k != "shape"},
        }
    for prefix, rows, field, dataset in (
        ("facility", facilities, "facility_id", "ib5c-xgwu"),
        ("functional_area", areas, "funcarea_id", "38b7-6db3"),
    ):
        for row in rows:
            feature = _feature(prefix, row, field, dataset)
            part = {
                "id": str(row.get("objectid") or feature["id"]),
                "geometry": feature["geometry"],
                "attributes": feature["attributes"],
                "provenance": feature["provenance"],
            }
            if feature["id"] in objects:
                parent = objects[feature["id"]]
                # A facility ID is a logical collection: Glen Canyon's landscaped areas,
                # for example, have multiple independent GIS rows with the same facility ID.
                # Preserve every spatial part and its dates/attributes instead of overwriting.
                if any(old["id"] == part["id"] for old in parent["parts"]):
                    raise ValueError(f"duplicate {prefix} GIS row: {part['id']}")
                parent["parts"].append(part)
                parent["aliases"].append(feature["name"])
                if parent["park_id"] != feature["park_id"] or parent["kind"] != feature["kind"]:
                    unresolved.append(
                        {
                            "id": feature["id"],
                            "part_id": part["id"],
                            "reason": "inconsistent_logical_facility_identity",
                        }
                    )
                    parent["semantic_confidence"] = 0
                    parent["kind"] = "unknown"
                polygons = []
                for old in parent["parts"]:
                    geometry = old["geometry"]
                    if geometry:
                        polygons.extend(
                            geometry["coordinates"]
                            if geometry["type"] == "MultiPolygon"
                            else [geometry["coordinates"]]
                        )
                parent["geometry"] = (
                    {"type": "MultiPolygon", "coordinates": polygons} if polygons else None
                )
                continue
            feature["parts"] = [part]
            feature["aliases"] = []
            objects[feature["id"]] = feature
            park = parks.get(feature["park_id"])
            if park:
                park["children"].append(feature["id"])
            else:
                unresolved.append({"id": feature["id"], "reason": "park_identity_not_in_snapshot"})
    # Functional areas belong to a facility too, but that membership is not proof of a surface.
    for feature in objects.values():
        if feature["id"].startswith("rpd:functional_area:"):
            parent = objects.get(feature["facility_id"])
            if parent:
                parent.setdefault("children", []).append(feature["id"])
    return {
        "schema_version": 1,
        "parks": list(parks.values()),
        "objects": list(objects.values()),
        "unresolved": unresolved,
        "geometry_policy": (
            "inventory evidence; enrich canonical geometry, never silently replace it"
        ),
    }
