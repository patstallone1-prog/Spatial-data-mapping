#!/usr/bin/env python3
"""Put the site's spatial data in the object store as versioned, immutable chunks.

The site is a page and its code; the city is data. ``docs/`` carried both -- a gigabyte of region
payloads, ground, furniture and fit tiles, in several copies -- into every Vercel deployment.
This moves the data out:

  chunks/<sha256[:24]><ext>   every data file at least MIN_BYTES, named by its content: once
                              written it never changes, so it is cached for a year and an old
                              version stays readable by an old page for as long as it is kept
  asset-map.json              (on the site, revalidated) which chunk each site path is now; the
                              page looks every data file up in it and falls back to the site

Uploads go to SMC_OBJECT_STORE_URL (gs://...) with gcloud, and a chunk already there is not sent
again. The map is written only after every chunk in it answers publicly, so the page never points
at something it cannot read. --prune then takes the published files out of docs/ (the deployment
keeps the page); it never runs by itself.

    gcloud auth login                                  # once: the store's credentials are yours
    .venv/bin/python tools/publish_chunks.py --dry-run # what would go, and how much
    .venv/bin/python tools/publish_chunks.py           # upload, verify, write docs/asset-map.json
    .venv/bin/python tools/publish_chunks.py --prune   # and take the published data out of docs/

Making the bucket publicly readable, with CORS for the site, is a setting of the bucket and is
not done here; ``--print-bucket-setup`` shows the two commands for whoever owns it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
MAP = DOCS / "asset-map.json"
MIN_BYTES = 100_000
DATA_SUFFIXES = {".json", ".bin", ".glb", ".geojson", ".pbf"}
#: Files the page must find on the site itself: the map, manifests that are revalidated, the
#: service worker's and the app's own records.
KEEP_ON_SITE = {"asset-map.json", "regions.json", "runtime-release.json", "manifest.webmanifest",
                "sf-corridor-frontage-fits.manifest.json"}
CONTENT_TYPES = {".json": "application/json", ".geojson": "application/geo+json",
                 ".bin": "application/octet-stream", ".glb": "model/gltf-binary",
                 ".pbf": "application/x-protobuf"}


def bucket_url() -> str:
    url = os.environ.get("SMC_OBJECT_STORE_URL", "")
    if not url:
        env = ROOT / ".env.local"
        for line in env.read_text().splitlines() if env.exists() else []:
            if line.startswith("SMC_OBJECT_STORE_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
    if not url.startswith("gs://"):
        sys.exit("SMC_OBJECT_STORE_URL must be a gs:// bucket")
    return url.rstrip("/")


def public_base(bucket: str) -> str:
    return f"https://storage.googleapis.com/{bucket[len('gs://'):]}"


def data_files() -> list[Path]:
    return sorted(p for p in DOCS.rglob("*") if p.is_file() and p.suffix in DATA_SUFFIXES
                  and p.name not in KEEP_ON_SITE and p.stat().st_size >= MIN_BYTES)


def object_name(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return f"chunks/{digest[:24]}{path.suffix}"


def gcloud(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["gcloud", "storage", *args], capture_output=True, text=True)


def answers(url: str) -> bool:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=20) as r:
            return r.status == 200
    except OSError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--prune", action="store_true", help="remove published data files from docs/")
    ap.add_argument("--print-bucket-setup", action="store_true")
    args = ap.parse_args()
    bucket = bucket_url()
    base = public_base(bucket)
    if args.print_bucket_setup:
        print(f"gcloud storage buckets add-iam-policy-binding {bucket} "
              "--member=allUsers --role=roles/storage.objectViewer")
        print(f"gcloud storage buckets update {bucket} --cors-file=tools/storage-cors.json")
        return 0
    files = data_files()
    plan = {str(p.relative_to(DOCS)): object_name(p) for p in files}
    total = sum(p.stat().st_size for p in files)
    print(f"{len(files)} data files, {total / 1e6:.0f} MB -> {bucket}/chunks/ "
          f"({len(set(plan.values()))} distinct chunks)")
    if args.dry_run:
        return 0
    listed = gcloud("ls", f"{bucket}/chunks/")
    if listed.returncode not in (0, 1):
        sys.exit(f"gcloud could not list the store ({listed.stderr.strip().splitlines()[-1:]}); "
                 "run `gcloud auth login` first")
    present = {line.rsplit("/", 1)[-1] for line in listed.stdout.split()}
    for path in files:
        name = plan[str(path.relative_to(DOCS))]
        if name.rsplit("/", 1)[-1] in present:
            continue
        sent = gcloud("cp", str(path), f"{bucket}/{name}",
                      "--cache-control=public, max-age=31536000, immutable",
                      f"--content-type={CONTENT_TYPES.get(path.suffix, 'application/octet-stream')}")
        if sent.returncode:
            sys.exit(f"upload failed for {path.relative_to(DOCS)}: {sent.stderr.strip()[-300:]}")
        present.add(name.rsplit("/", 1)[-1])
    unreadable = [n for n in sorted(set(plan.values())) if not answers(f"{base}/{n}")]
    if unreadable:
        sys.exit(f"{len(unreadable)} chunks are not publicly readable (first: {unreadable[0]}); "
                 "the map was not written. See --print-bucket-setup.")
    version = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()[:16]
    MAP.write_text(json.dumps({"schema": "kerbside.asset_map/1", "version": version, "base": base,
                               "files": plan}, indent=1, sort_keys=True))
    print(f"asset map {version}: {len(plan)} files now served from {base}")
    if args.prune:
        for path in files:
            path.unlink()
        print(f"removed {len(files)} published data files ({total / 1e6:.0f} MB) from docs/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
