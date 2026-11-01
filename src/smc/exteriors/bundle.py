"""Compile a local review bundle. No renderer, overlay or live data is published here."""

from __future__ import annotations

import copy
import hashlib
import json
import shutil
from importlib.resources import files
from pathlib import Path

from smc.exteriors.engine import infer_exterior
from smc.exteriors.kerbside import from_kerbside
from smc.exteriors.library import category
from smc.exteriors.model import ExteriorInput


def build_bundle(
    out,
    *,
    inputs=(),
    world=None,
    fits=None,
    limit=20,
    viewer_html=None,
    support_site=None,
    selected_ids=None,
    station_inputs=(),
):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    package = files("smc.exteriors")
    for name in ("renderer.mjs", "preview.mjs", "preview.html", "references.json"):
        target = "index.html" if name == "preview.html" else name
        shutil.copyfile(str(package.joinpath(name)), out / target)
    shutil.copytree(str(package.joinpath("assets")), out / "assets", dirs_exist_ok=True)
    if station_inputs:
        from smc.exteriors.stations import infer_station

        index = out / "index.html"
        index.write_text(
            index.read_text().replace(
                "<main><aside>",
                '<main><aside><p><a href="stations.html">Fuel &amp; EV stations</a></p>',
            )
        )

        stations, station_rejected = {}, []
        for row in station_inputs:
            key = str(row["id"])
            if key in stations or any(r["id"] == key for r in station_rejected):
                raise ValueError("duplicate station identity")
            try:
                plan = infer_station(row)
                if plan["validation"]["passed"]:
                    stations[key] = plan
                else:
                    station_rejected.append(dict(id=key, errors=plan["validation"]["errors"]))
            except (ValueError, KeyError, TypeError) as exc:
                station_rejected.append(dict(id=key, errors=[str(exc)]))
        (out / "station-scenes.json").write_text(
            json.dumps(
                dict(
                    schema="kerbside.station_scenes/1",
                    selected=[str(r["id"]) for r in station_inputs],
                    stations=stations,
                    rejected=station_rejected,
                ),
                indent=2,
            )
            + "\n"
        )
        for name in ("station-renderer.mjs", "station-preview.mjs", "station-preview.html"):
            shutil.copyfile(
                str(package.joinpath(name)),
                out / ("stations.html" if name.endswith("html") else name),
            )
    plans, rejected = {}, []
    candidates = [
        (str(row["id"]), "synthetic", lambda row=row: ExteriorInput.from_json(row))
        for row in inputs
    ]
    if world:
        ways = world.get("ways", [])
        streets = [w for w in ways if w.get("kind") == "street"]
        eligible = [
            w
            for w in ways
            if w.get("kind") == "building"
            and (
                w.get("shops")
                or (
                    w.get("name")
                    and (
                        w.get("archetype")
                        in {
                            "retail",
                            "restaurant",
                            "office",
                            "hotel",
                            "school",
                            "civic",
                        }
                        or category(w.get("archetype"), w.get("tags"))
                        in {"senior_living", "clinic"}
                    )
                )
            )
        ]
        eligible.sort(key=lambda w: hashlib.sha256(str(w["osm_id"]).encode()).hexdigest())
        chosen = eligible[:limit]
        if selected_ids is not None:
            by_id = {str(w["osm_id"]): w for w in ways if w.get("kind") == "building"}
            if len(set(selected_ids)) != len(selected_ids) or not set(selected_ids) <= set(by_id):
                raise ValueError(
                    "fixed mapped cohort has duplicate or missing canonical identities"
                )
            chosen = [by_id[key] for key in selected_ids]
        for way in chosen:
            key = str(way["osm_id"])
            fit = (fits or {}).get("buildings", {}).get(key)
            candidates.append(
                (key, "mapped", lambda way=way, fit=fit: from_kerbside(way, streets, fit))
            )
    for key, cohort, make in candidates:
        if key in plans:
            raise ValueError("duplicate exterior case identity")
        try:
            plan = infer_exterior(make())
            if not plan["validation"]["passed"]:
                rejected.append(
                    {"id": key, "cohort": cohort, "errors": plan["validation"]["errors"]}
                )
                continue
            plan["cohort"] = cohort
            plans[key] = plan
        except (ValueError, KeyError, TypeError) as exc:
            rejected.append({"id": key, "cohort": cohort, "errors": [str(exc)]})
    manifest = {
        "schema": "kerbside.storefront_exteriors/1",
        "canonical_geometry_modified": False,
        "selection": "fixed programs plus SHA-256-ranked mapped candidates; failures retained",
        "selected": [key for key, _, _ in candidates],
        "rejected": rejected,
        "buildings": plans,
    }
    if station_inputs:
        manifest["station_summary"] = dict(
            selected=len(station_inputs), passed=len(stations), rejected=station_rejected
        )
    (out / "storefront-exteriors.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if world:
        # The map finds the plans as the live site does (scripts/publish_store_exteriors.py): by a
        # manifest over the world's area, with the renderer and marks at the names it accepts.
        # The world itself is copied untouched.
        prepared = copy.deepcopy(world)
        b = world.get("bbox") or {}
        (out / "storefront-exteriors.manifest.json").write_text(json.dumps({
            "schema": "kerbside.storefront_exterior_tiles/1",
            "tiles": [{"path": "storefront-exteriors.json", "buildings": len(plans),
                       "bbox": [b.get("west", -180), b.get("south", -90), b.get("east", 180), b.get("north", 90)]}],
        }, indent=1) + "\n")
        shutil.copyfile(out / "renderer.mjs", out / "storefront-renderer.mjs")
        shutil.copytree(out / "assets", out / "storefront-assets", dirs_exist_ok=True)
        (out / "world.json").write_text(json.dumps(prepared, separators=(",", ":")) + "\n")
        if viewer_html:
            from smc.exteriors.integration import instrument_viewer

            (out / "sf-corridor-3d.html").write_text(instrument_viewer(viewer_html))
            (out / "sf-corridor-3d.json").write_text(
                json.dumps(prepared, separators=(",", ":")) + "\n"
            )
            if support_site:
                # Read-only aliases for an isolated local map check, not a publication.
                for source in Path(support_site).iterdir():
                    target = out / source.name
                    if not target.exists() and not target.is_symlink():
                        target.symlink_to(source.resolve(), target_is_directory=source.is_dir())
    return manifest


#: What the map viewer reads of a plan (renderer.mjs: boundExterior, mount). The rest -- every
#: reference's citation, the geometry evidence, the validation's working -- is the review
#: browser's, and was two thirds of the bytes: 62 MB for San Francisco's 3,183 storefronts.
RUNTIME_KEYS = ("schema", "id", "canonical_geometry_modified", "canonical_points", "height_m",
                "origin_lon_lat", "footprint", "facades", "evidence", "geometry_sha256",
                "content_sha256", "reference_version", "replica_status", "not_an_as_built_survey")


#: Within a facade: the per-part working the review browser shows, which the viewer never reads.
FACADE_REVIEW_KEYS = {"evidence", "references", "frontage_basis", "basis"}
#: Compared exactly (renderer.mjs boundExterior against the footprint ring; the viewer's photo
#: openings against their source record), so kept to the bit.
EXACT_KEYS = {"a", "b", "kerbside_source_record"}


def _runtime_facade(value, key=None):
    """A facade as the viewer reads it: millimetres are plenty for a placed door or sign."""
    if key in EXACT_KEYS:
        return value
    if isinstance(value, dict):
        return {k: _runtime_facade(v, k) for k, v in value.items() if k not in FACADE_REVIEW_KEYS}
    if isinstance(value, list):
        return [_runtime_facade(v, key) for v in value]
    if isinstance(value, float):
        return round(value, 6 if key == "normal" else 3)
    return value


def runtime_manifest(manifest):
    """The manifest the live map loads: the passing plans, with only what the renderer reads.
    A reference is named by its id (the review build keeps the citations)."""
    buildings = {}
    for key, plan in manifest["buildings"].items():
        slim = {k: plan[k] for k in RUNTIME_KEYS if k in plan}
        if "facades" in slim:
            slim["facades"] = _runtime_facade(slim["facades"])
        slim["validation"] = {"passed": bool(plan.get("validation", {}).get("passed"))}
        slim["references"] = [r.get("id") if isinstance(r, dict) else r for r in plan.get("references") or []]
        buildings[key] = slim
    return {
        "schema": manifest["schema"],
        "canonical_geometry_modified": False,
        "selection": manifest.get("selection"),
        "selected": len(manifest.get("selected") or []),
        "rejected": len(manifest.get("rejected") or []),
        "buildings": buildings,
    }
