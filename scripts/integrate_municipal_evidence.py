#!/usr/bin/env python3
"""Consume acquired snapshots, publish typed appearance/validation sidecars; no network intake."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.streetview_reference import atomic_json  # noqa: E402
from smc.official.integration import integrate_inventory  # noqa: E402


def main():
    acquisitions = json.loads((ROOT / "data/benchmarks/regional-municipal-acquisitions-2026-10-16.json").read_text())
    contexts = {}
    for receipt in acquisitions["sources"]:
        name = receipt["raw_path"].split("/")[-2]
        snapshot = json.loads((ROOT / receipt["raw_path"]).read_text())
        if snapshot["sha256"] != receipt["sha256"]:
            raise ValueError("acquisition receipt no longer matches source")
        part = integrate_inventory(name, snapshot)
        # Validation uses the full private, checksummed acquisition. The viewer
        # needs reference IDs/counts, not a duplicate GIS database or contact data.
        # In particular, do not redistribute mixed historic road-edge geometries
        # while the dataset-specific downstream rights are still under review.
        for reference in part["references"]:
            reference.pop("geometry", None)
            reference["geometry_retained_in_acquisition"] = True
        region = receipt["source"]["region"]
        context = contexts.setdefault(region, {"schema": part["schema"], "bbox": receipt["bbox_s_w_n_e"],
                                               "sources": [], "sidewalks": [], "curb_colours": [], "references": [], "excluded": {}})
        for key in ("sources", "sidewalks", "curb_colours", "references"):
            context[key].extend(part[key])
        context["excluded"][name] = part["excluded"]
    entries = []
    for region, context in sorted(contexts.items()):
        raw = json.dumps(context, sort_keys=True, separators=(",", ":")).encode()
        sha = hashlib.sha256(raw).hexdigest()
        path = f"municipal/{region}-{sha[:12]}.json"
        target = ROOT / "docs" / path
        atomic_json(target, context)
        entries.append({"region": region, "bbox": context["bbox"], "path": path,
                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                        "sources": len(context["sources"]), "sidewalks": len(context["sidewalks"]),
                        "curb_colours": len(context["curb_colours"]), "validation_references": len(context["references"])})
    atomic_json(ROOT / "docs/municipal-context.manifest.json", {"schema": "kerbside.municipal_context_index/1", "regions": entries})
    print(json.dumps(entries, indent=2))


if __name__ == "__main__":
    main()
