"""Fetch RPD properties, physical facilities and functional areas with reproducible provenance."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from smc.official.datasf import Dataset, _get, fetch
from smc.official.schema import DocumentStatus
from smc.parks.inventory import build_inventory

DATASETS = (
    Dataset("gtr9-ntp6", "Recreation and Parks Properties", "shape", "park_property",
            DocumentStatus.RECORDED),
    Dataset("ib5c-xgwu", "Recreation and Parks Facilities", "shape", "park_facility",
            DocumentStatus.RECORDED),
    Dataset("38b7-6db3", "RPD Functional Areas", "shape", "park_functional_area",
            DocumentStatus.RECORDED),
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("data/sf_rpd"))
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    sources, snapshots = [], []
    # SF only, not RPD's distant camps. Whole-city identities allow neighboring built regions
    # to share one park instead of manufacturing separate identities at their tile boundaries.
    bbox = {"west": -122.53, "east": -122.35, "south": 37.69, "north": 37.84}
    for dataset in DATASETS:
        metadata = json.loads(_get(f"https://data.sf.gov/api/views/{dataset.dataset_id}.json"))
        if metadata.get("licenseId") != "PDDL":
            raise ValueError(f"unreviewed rights for {dataset.dataset_id}")
        rows, document = fetch(dataset, bbox=bbox, cache_dir=args.out / "raw",
                               refresh=args.refresh, progress=lambda message: print(message, flush=True))
        snapshots.append(rows)
        sources.append({**asdict(document), "license": "PDDL",
                        "metadata_url": f"https://data.sf.gov/api/views/{dataset.dataset_id}.json",
                        "row_count": len(rows)})
    inventory = build_inventory(*snapshots)
    inventory["sources"] = sources
    args.out.mkdir(parents=True, exist_ok=True)
    canonical = (json.dumps(inventory, sort_keys=True, separators=(",", ":")) + "\n").encode()
    compressed = gzip.compress(canonical, mtime=0)
    (args.out / "inventory.json.gz").write_bytes(compressed)
    snapshot_dir = args.out / "snapshots"
    snapshot_dir.mkdir(exist_ok=True)
    for source, rows in zip(sources, snapshots, strict=True):
        content = json.dumps({"source": source, "rows": rows}, sort_keys=True,
                             separators=(",", ":")).encode()
        filename = source["sha256"] + ".json.gz"
        (snapshot_dir / filename).write_bytes(gzip.compress(content, mtime=0))
        source["snapshot"] = "snapshots/" + filename
    manifest = {
        "schema_version": 1, "license": "PDDL", "artifact": "inventory.json.gz",
        "sha256": hashlib.sha256(compressed).hexdigest(),
        "decoded_sha256": hashlib.sha256(canonical).hexdigest(),
        "decoded_bytes": len(canonical), "compressed_bytes": len(compressed),
        "sources": sources, "counts": {"parks": len(inventory["parks"]),
                                        "objects": len(inventory["objects"])},
        "unresolved": dict(Counter(record["reason"] for record in inventory["unresolved"])),
        "promotion_state": "source_ingested_not_yet_viewer_integrated",
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"RPD: {len(inventory['parks'])} parks, {len(inventory['objects'])} objects, "
          f"{len(inventory['unresolved'])} identity/semantic records requiring review", flush=True)


if __name__ == "__main__":
    main()
