"""Compile compact regional park sidecars, validating the immutable city snapshot."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from smc.parks.areas import build_areas
from smc.parks.courts import compile_courts
from smc.parks.enrichment import build_enrichment, rings
from smc.parks.paths import annotate_paths, official_paths
from smc.parks.surfaces import SurfaceEvidence

NATURAL = {"Natural Area", "Natural Resource Management Area", "Nature Exploration Area"}
#: What the renderer already draws every footway as (FOOTWAY_LOOK in the page).
FOOTWAY_LOOK = {"unknown", "concrete", "paved"}

ROOT = Path(__file__).resolve().parents[1]


def main(*, courts_only: bool = False) -> None:
    source = ROOT / "data/sf_rpd"
    manifest = json.loads((source / "manifest.json").read_text())
    content = (source / manifest["artifact"]).read_bytes()
    if hashlib.sha256(content).hexdigest() != manifest["sha256"]:
        raise ValueError("RPD snapshot hash mismatch")
    decoded = gzip.decompress(content)
    if hashlib.sha256(decoded).hexdigest() != manifest["decoded_sha256"]:
        raise ValueError("RPD decoded hash mismatch")
    inventory = json.loads(decoded)
    page_file = source / "page_evidence.json"
    pages = json.loads(page_file.read_text()) if page_file.exists() else {}
    official = official_paths(inventory)
    natural = [polygon[0] for obj in inventory["objects"] if obj["kind"] in NATURAL
               and obj.get("semantic_confidence", 0) > 0
               for part in obj["parts"] for polygon in rings(part["geometry"])]
    for payload in [
        ROOT / "docs/sf-corridor-3d.json",
        *sorted((ROOT / "docs/regions").glob("*/sf-corridor-3d.json")),
    ]:
        world = json.loads(payload.read_text())
        region = "sf-corridor" if payload.parent.name == "docs" else payload.parent.name
        ground_file = payload.with_name("app-sf-corridor-ground.json") if region == "sf-corridor" else payload.with_name("sf-corridor-ground.json")
        court_layout = compile_courts(inventory, json.loads(ground_file.read_text()),
                                     json.loads((ROOT / "data/park_courts/reviews.json").read_text())) if ground_file.exists() else None
        if courts_only:
            out = payload.with_name("sf-corridor-parks.json")
            artifact = json.loads(out.read_text())
            if court_layout is not None:
                artifact["court_layout"] = court_layout
            out.write_text(json.dumps(artifact, separators=(",", ":")) + "\n")
            app = ROOT / "docs/app-regions" / region
            if (app / "sf-corridor-3d.json").exists() and (app / "sf-corridor-3d.json").read_bytes() == payload.read_bytes():
                (app / "sf-corridor-parks.json").write_bytes(out.read_bytes())
            print(f"{region}: {len((court_layout or {}).get('pads', []))} city court slabs", flush=True)
            continue
        artifact = build_enrichment(inventory, world, pages)
        path_source = ROOT / "data/park_paths" / region / "surfaces.json"
        path_reviews = source / "path_reviews" / f"{region}.json"
        osm = json.loads(path_source.read_text()) if path_source.exists() else {}
        imagery_file = ROOT / "data/park_paths" / region / "imagery.json"
        imagery = {}
        if imagery_file.exists():
            for identity, runs in json.loads(imagery_file.read_text())["ways"].items():
                imagery[identity] = [
                    (run["lo"], run["hi"], SurfaceEvidence(
                        run["material"], run["basis"], f"mapillary_segmentation:{run['images'][0]}",
                        0.78 if run["basis"] == "imagery_auto_multiview" else 0.6,
                        independent_sequences=tuple(run["sequences"])))
                    for run in runs]
        paths, rejected = annotate_paths(
            world,
            artifact["parks"],
            osm,
            json.loads(path_reviews.read_text()) if path_reviews.exists() else {},
            official=official,
            natural_areas=natural,
            imagery=imagery,
        )
        artifact["areas"] = build_areas(inventory, world, osm, pages)
        if court_layout is not None:
            artifact["court_layout"] = court_layout
        artifact["paths"] = paths
        artifact["review"].extend(rejected)
        artifact["path_source_available"] = path_source.exists()
        artifact["source_snapshot_sha256"] = manifest["decoded_sha256"]
        # Full semantic geometry remains available on demand. Do not force every
        # visitor to parse thousands of indoor GIS room polygons under opaque roofs.
        # (An audit file, not served: the page never loads it.)
        detail = ROOT / "build/park-evidence" / f"{region}-parks-details.json"
        detail.parent.mkdir(parents=True, exist_ok=True)
        detail.write_text(json.dumps(artifact, separators=(",", ":")) + "\n")
        artifact["objects"] = [o for o in artifact["objects"] if o["render"] != "semantic_only"]
        artifact["parks"] = [{k: v for k, v in p.items() if k != "geometry"}
                             for p in artifact["parks"]]
        # The page needs where each material run lies and how sure it is; the full evidence
        # chain (alternatives, conflicts, rejections) stays in the details file.
        def slim(resolved):
            return {k: resolved.get(k) for k in
                    ("surface_class", "surface_material", "basis", "confidence", "source_id")}

        artifact["paths"] = {
            k: {"points": p["points"], "park_id": p["park_id"], "width_m": p.get("width_m"),
                "resolved": slim(p["resolved"]),
                "runs": [{"points": r["points"], "range_m": r["range_m"],
                          "resolved": slim(r["resolved"])} for r in p["runs"]]}
            for k, p in paths.items()
            # The page lays only paths whose material differs from footway concrete; the rest
            # (and every alternative, conflict and rejection) are in the details file.
            if any(r["resolved"]["surface_material"] not in FOOTWAY_LOOK for r in p["runs"])}
        out = payload.with_name("sf-corridor-parks.json")
        out.write_text(json.dumps(artifact, separators=(",", ":")) + "\n")
        app = ROOT / "docs/app-regions" / region
        same = (app / "sf-corridor-3d.json").exists() and (
            (app / "sf-corridor-3d.json").read_bytes() == payload.read_bytes())
        if same:
            # The expanded Oakland app world is the same payload; it reads its own folder.
            (app / "sf-corridor-parks.json").write_text(out.read_text())
        materials = {}
        for path in artifact["paths"].values():
            for run in path["runs"]:
                key = (run["resolved"]["surface_material"], run["resolved"]["basis"])
                materials[key] = materials.get(key, 0) + 1
        kinds = {}
        for area in artifact["areas"]:
            kinds[area["kind"]] = kinds.get(area["kind"], 0) + 1
        print(
            f"{region}: {len(artifact['parks'])} parks; {artifact['counts']}; areas {kinds}; "
            f"{len(artifact['review'])} join conflicts; path runs by (material, basis): "
            f"{dict(sorted(materials.items(), key=lambda kv: -kv[1])[:12])}",
            flush=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--courts-only", action="store_true", help="preserve all unrelated park evidence")
    main(courts_only=parser.parse_args().courts_only)
