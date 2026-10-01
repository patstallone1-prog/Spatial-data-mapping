#!/usr/bin/env python3
"""Catalogue and import third-party 3D scans (docs/24 Part A).

  ingest_scans.py catalogue [--region R ...]   Sketchfab search, per region -> candidates
  ingest_scans.py import                        read data/scans/<source>/inbox/ files
  ingest_scans.py download --uid UID            one Sketchfab model, needs SKETCHFAB_API_TOKEN

Outputs under data/scans/: sketchfab/catalogue.json (candidates with licence, author and the
reason any was refused), <source>/scans.jsonl (imported files with their classification) and
summary.json. Nothing is placed in the world here.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.config import load_env_file  # noqa: E402
from smc.scans import inbox, sketchfab  # noqa: E402

SCANS = ROOT / "data" / "scans"
REGIONS = ROOT / "data" / "regions" / "regions.json"


def load_regions() -> dict[str, dict]:
    data = json.loads(REGIONS.read_text())
    regions = data.get("regions", data) if isinstance(data, dict) else data
    if isinstance(regions, dict):
        return {k: dict(v, name=v.get("name", k)) for k, v in regions.items()}
    return {r["name"]: r for r in regions}


def catalogue(names: list[str]) -> None:
    regions = load_regions()
    chosen = names or sorted(regions)
    queries: dict[str, list[str]] = {}
    for name in chosen:
        for query in sketchfab.region_queries(regions[name]):
            queries.setdefault(query, []).append(name)
    by_uid: dict[str, dict] = {}
    for query, region_names in queries.items():
        found = sketchfab.search(query)
        print(f"  {query!r}: {len(found)} results", flush=True)
        places = {regions[n].get("city", "").replace("-", " ") for n in region_names}
        for item in found:
            if item.usable and not any(sketchfab.names_place(item, p) for p in places):
                item.usable = False
                item.refused = "place not named: the search matched words, not the place"
            record = by_uid.setdefault(item.uid, item.to_json() | {"regions": []})
            record["queries"] = sorted(set(record["queries"]) | {query})
            record["regions"] = sorted(set(record["regions"]) | set(region_names))
    items = sorted(by_uid.values(), key=lambda r: (not r["usable"], r["name"]))
    out = SCANS / "sketchfab" / "catalogue.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    refusals: dict[str, int] = {}
    for item in items:
        if item["refused"]:
            key = item["refused"].split(":")[0]
            refusals[key] = refusals.get(key, 0) + 1
    payload = {"queries": queries, "candidates": len(items),
               "usable": sum(r["usable"] for r in items),
               "commercial_use": sum(r["usable"] and r["commercial_use"] for r in items),
               "refused": refusals, "placed": 0,
               "note": "Candidates only: Sketchfab has no coordinates, so none is placed until "
                       "the aligner fits it to the lidar.",
               "models": items}
    out.write_text(json.dumps(payload, indent=1) + "\n")
    print(f"{len(items)} candidates, {payload['usable']} usable -> {out.relative_to(ROOT)}")


def import_inbox() -> None:
    results = inbox.run(SCANS, ("polycam", "openheritage3d", "sketchfab"))
    summary = {}
    for source, records in results.items():
        with (SCANS / source / "scans.jsonl").open("w") as stream:
            for record in records:
                stream.write(json.dumps(record) + "\n")
        kinds: dict[str, int] = {}
        for record in records:
            kinds[record.get("kind", "?")] = kinds.get(record.get("kind", "?"), 0) + 1
        summary[source] = {"files": len(records), "kept": sum(r.get("keep", False)
                                                              for r in records), "kinds": kinds}
        print(f"  {source}: {summary[source]}")
    (SCANS / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")


def download(uid: str) -> None:
    token = sketchfab.token()
    if not token:
        sys.exit("SKETCHFAB_API_TOKEN is not set in .env.local; download the model from "
                 "Sketchfab yourself into data/scans/sketchfab/inbox/ with a sidecar instead.")
    catalogue_path = SCANS / "sketchfab" / "catalogue.json"
    models = {m["uid"]: m for m in json.loads(catalogue_path.read_text())["models"]} \
        if catalogue_path.exists() else {}
    model = models.get(uid)
    if model is None or not model["usable"]:
        sys.exit(f"{uid} is not a usable catalogued model "
                 f"({model['refused'] if model else 'not catalogued'})")
    links = sketchfab.download_url(uid, token)
    link = (links.get("glb") or links.get("gltf") or {}).get("url")
    if not link:
        sys.exit(f"no GLB or glTF archive offered for {uid}")
    target_dir = SCANS / "sketchfab" / "inbox"
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = ".glb" if "glb" in links else ".zip"
    target = target_dir / f"{uid}{suffix}"
    with urllib.request.urlopen(link, timeout=600) as response, target.open("wb") as stream:
        while block := response.read(1 << 20):
            stream.write(block)
    sidecar = {"licence": model["licence_label"], "author": model["author"],
               "source_url": model["viewer_url"], "title": model["name"],
               "attribution": model["attribution"]}
    target.with_suffix(target.suffix + ".json").write_text(json.dumps(sidecar, indent=1) + "\n")
    print(f"downloaded {target.relative_to(ROOT)}")


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    cat = sub.add_parser("catalogue")
    cat.add_argument("--region", action="append", default=[])
    sub.add_parser("import")
    dl = sub.add_parser("download")
    dl.add_argument("--uid", required=True)
    args = parser.parse_args()
    if args.command == "catalogue":
        catalogue(args.region)
    elif args.command == "import":
        import_inbox()
    else:
        download(args.uid)


if __name__ == "__main__":
    main()
