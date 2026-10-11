#!/usr/bin/env python3
"""Acquire intact SF reference bundles privately under explicit noncommercial consent."""
from __future__ import annotations

import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.archive import RangedHttpFile  # noqa: E402
from smc.imagery.http import HttpClient  # noqa: E402
from smc.imagery.streetview_reference import (  # noqa: E402
    SOURCE_ROOT,
    atomic_json,
    download_asset,
    index_archive,
    index_test_archive,
    mesh_inventory,
    probe_archive,
    storage_guard,
)

LINKS = "https://raw.githubusercontent.com/amir32002/3D_Street_View/master/links/dataset_unaligned.txt"
LICENSE = "https://raw.githubusercontent.com/amir32002/3D_Street_View/master/LICENSE"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--storage-volume", type=Path, required=True)
    parser.add_argument("--volume-uuid", required=True)
    parser.add_argument("--noncommercial-consent", action="store_true", required=True)
    parser.add_argument("--download-sf", action="store_true")
    parser.add_argument("--dependencies", type=Path)
    parser.add_argument("--watch-seconds", type=int, default=0)
    args = parser.parse_args()
    storage_guard(args.output, args.storage_volume, args.volume_uuid)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.dependencies:
        sys.path.insert(0, str(args.dependencies))
    lock = (args.output / ".acquisition.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("this private acquisition is already running")
    if args.watch_seconds < 0:
        parser.error("negative watch interval")
    status = args.output / "status.json"
    client = HttpClient(max_attempts=2)
    license_bytes = client.fetch(LICENSE)
    (args.output / "LICENSE.source.txt").write_bytes(license_bytes)
    atomic_json(args.output / "consent.json", {
        "dataset": "3d-street-view", "scope": "private_noncommercial_research_and_reference",
        "authorization": "explicit_user_instruction_2026-10-10",
        "recorded_at": datetime.now(UTC), "license_url": LICENSE,
        "redistribute_sources": False, "automatically_publish_derivatives": False,
        "canonical_mutation_allowed": False,
        "raw_license_sha256": hashlib.sha256(license_bytes).hexdigest(),
    })
    model = args.output / "SanFrancisco.obj"
    atomic_json(status, {"stage": "downloading_sf_reference_mesh", "at": datetime.now(UTC)})
    receipt = download_asset(SOURCE_ROOT + "3D_models_of_cities/SanFrancisco.obj", model,
                             args.storage_volume, args.volume_uuid)
    inventory = mesh_inventory(model)
    atomic_json(args.output / "mesh-inventory.json", {**inventory, "asset": receipt})
    print(json.dumps({"model": receipt["size_bytes"], **inventory}), flush=True)
    plan_path = args.output / "acquisition-plan.json"
    if plan_path.exists() and not json.loads(plan_path.read_text()).get("unresolved_bundles"):
        plan = json.loads(plan_path.read_text())
    else:
        urls = [line.strip() for line in client.fetch(LINKS).decode().splitlines()
                if line.strip().endswith(".tar")]
        atomic_json(status, {"stage": "discovering_sf_bundles", "archives": len(urls),
                             "at": datetime.now(UTC)})
        probes, failures = [], []
        def attempt(url):
            try:
                return probe_archive(url)
            except Exception as exc:
                return {"url": url, "error_type": type(exc).__name__, "status": "unresolved"}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for probe in pool.map(attempt, urls):
                (failures if probe.get("status") == "unresolved" else probes).append(probe)
                atomic_json(status, {"stage": "discovering_sf_bundles", "probed": len(probes),
                                     "unresolved": len(failures), "archives": len(urls),
                                     "at": datetime.now(UTC)})
        selected = [probe for probe in probes if probe["sample_in_sf"]]
        plan = {"schema": "kerbside.private_reference_acquisition/1", "source_links": LINKS,
                "selected_sf_bundles": selected, "unresolved_bundles": failures,
                "other_city_bundles_not_downloaded": len(probes) - len(selected),
                "size_bytes": sum(row["size_bytes"] for row in selected),
                "retention": "intact_archives_all_correspondence_partners; no_spatial_thinning",
                "probe_results": probes,
                "production_eligible": False, "captured_at": None}
        atomic_json(plan_path, plan)
    # The probed training regions did not include SF. Keep the official mixed-city
    # evaluation acquisitions whole rather than guessing
    # identities from the first image or pairing positives with negative examples.
    if "test_bundles" not in plan:
        plan["test_bundles"] = [
            {"url": SOURCE_ROOT + "test_set/" + name,
             "size_bytes": RangedHttpFile(SOURCE_ROOT + "test_set/" + name).size,
             "basis": "official_evaluation_acquisition; per_record_city_and_pose_pending_import"}
            for name in ("test_matching.tar", "test_poseregression.tar")
        ]
        atomic_json(plan_path, plan)
    print(json.dumps({"sf_bundles": len(plan["selected_sf_bundles"]),
                      "bytes": plan["size_bytes"], "unresolved": len(plan["unresolved_bundles"])}), flush=True)
    imports = []
    if args.download_sf:
        # Reserve the entire requested working set before starting a large acquisition.
        selected = [*plan["selected_sf_bundles"], *plan["test_bundles"]]
        remaining = sum(row["size_bytes"] for row in selected
                        if not (args.output / Path(row["url"]).name).exists())
        storage_guard(args.output, args.storage_volume, args.volume_uuid, remaining)
        for row in selected:
            destination = args.output / Path(row["url"]).name
            atomic_json(status, {"stage": "downloading_intact_sf_bundle", "archive": destination.name,
                                 "at": datetime.now(UTC), "production_eligible": False})
            download_asset(row["url"], destination, args.storage_volume, args.volume_uuid)
            imported = (index_archive(destination, args.output / "reference.sqlite")
                        if "dataset_unaligned/" in row["url"] else
                        index_test_archive(destination, args.output / "reference.sqlite"))
            imports.append(imported)
            atomic_json(args.output / "imports.json", {"archives": imports,
                                                       "production_eligible": False})
            print(json.dumps(imported), flush=True)
    atomic_json(status, {"stage": "incomplete_discovery" if plan["unresolved_bundles"]
                         else "complete" if args.download_sf else "discovered",
                         "at": datetime.now(UTC), "mesh": inventory, "imports": imports,
                         "unresolved_bundles": len(plan["unresolved_bundles"]),
                         "source_files_publicly_served": False,
                         "production_eligible": False})
    while args.watch_seconds:
        time.sleep(args.watch_seconds)
        storage_guard(args.output, args.storage_volume, args.volume_uuid)


if __name__ == "__main__":
    main()
