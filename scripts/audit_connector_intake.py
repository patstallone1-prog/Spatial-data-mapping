"""Publish a bounded progress receipt; acquisitions remain private and unpromoted."""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.streetview_reference import atomic_json  # noqa: E402


def main():
    plan = json.loads((ROOT / "data/regions/gap-plan.json").read_text())
    status = json.loads((ROOT / "build/gap-intake/status.json").read_text())
    envelopes = {}
    acquisitions = []
    for job in plan["jobs"]:
        name = job["name"]
        parent = name.split("-p")[0]
        row = envelopes.setdefault(parent, {"region": parent, "adapter": job["adapter"],
                                           "purpose": job["reason"], "jobs": 0, "completed_stages": Counter()})
        row["jobs"] += 1
        for stage, result in status["jobs"].get(name, {}).items():
            if result["status"] == "done":
                row["completed_stages"][stage] += 1
        osm = ROOT / "data/regions" / name / "osm_ways.json"
        if osm.is_file():
            raw = osm.read_bytes()
            acquisitions.append({"job": name, "dataset": "OpenStreetMap", "license": "ODbL-1.0",
                                 "bbox": job["bbox"], "bytes": len(raw),
                                 "sha256": hashlib.sha256(raw).hexdigest(), "ways": len(json.loads(raw))})
    report = {"schema": "kerbside.connector_intake_snapshot/1", "snapshot_at": status["at"],
              "run_state": status["state"], "active_at_snapshot": status.get("active"),
              "planned_jobs": len(plan["jobs"]), "corridors": list(envelopes.values()),
              "acquisitions": acquisitions, "new_coverage_published": False,
              "scope": "Discovery, OSM geometry, then 3DEP terrain/kerb intake; private until built and audited.",
              "note": "Point-in-time receipt, not a live completion counter. Runner status is build/gap-intake/status.json."}
    atomic_json(ROOT / "docs/audits/connector-intake-2026-10-17.json", report)
    print(json.dumps({"corridors": len(envelopes), "jobs": len(plan["jobs"]),
                      "osm_acquisitions": len(acquisitions), "active": status.get("active")}))


if __name__ == "__main__":
    main()
