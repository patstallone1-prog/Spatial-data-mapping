#!/usr/bin/env python3
"""Generic interior layouts: the floor-plan datasets, read into one template schema.

    .venv/bin/python scripts/ingest_interiors.py                 # every downloadable dataset
    .venv/bin/python scripts/ingest_interiors.py resplan --limit 100

For each dataset with an adapter (smc.interiors.sources), downloads the archive if it is not in
``data/interiors/<key>/raw/`` (gitignored), reads it into :class:`smc.interiors.LayoutTemplate`s,
and writes:

  data/interiors/<key>/templates.jsonl.gz   one template per line (gitignored: rebuilt from raw)
  data/interiors/<key>/summary.json         counts, descriptor ranges, licence, source
  data/interiors/catalogue.json             every dataset known, whether it is in, and why not

A dataset that needs an agreement is catalogued, never fetched.
"""

from __future__ import annotations

import argparse
import gzip
import importlib
import json
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402

from smc.interiors.sources import DATASETS, Dataset  # noqa: E402
from smc.net import use_certifi  # noqa: E402

use_certifi()
BASE = ROOT / "data" / "interiors"
DOWNLOADS = {"swiss_dwellings": ("swiss-dwellings-v3.0.0.zip",
                                 "https://zenodo.org/api/records/7788422/files/"
                                 "swiss-dwellings-v3.0.0.zip/content"),
             "resplan": ("ResPlan.zip",
                         "https://raw.githubusercontent.com/m-agour/ResPlan/main/ResPlan.zip")}


def fetch(dataset: Dataset) -> Path:
    name, url = DOWNLOADS[dataset.key]
    raw = BASE / dataset.key / "raw" / name
    if raw.exists() and (dataset.size_bytes is None or raw.stat().st_size == dataset.size_bytes):
        return raw
    raw.parent.mkdir(parents=True, exist_ok=True)
    partial = raw.with_suffix(".part")
    urllib.request.urlretrieve(url, partial)
    partial.rename(raw)
    return raw


def ingest(dataset: Dataset, limit: int | None) -> dict:
    raw = fetch(dataset)
    adapter = importlib.import_module(dataset.adapter)
    out_dir = BASE / dataset.key
    written = 0
    storeys: Counter = Counter()
    kinds: Counter = Counter()
    widths, areas, windows = [], [], []
    started = time.time()
    with gzip.open(out_dir / "templates.jsonl.gz", "wt", encoding="utf-8") as fh:
        for template in adapter.templates(raw, progress=lambda m: print(m, flush=True),
                                          limit=limit):
            record = template.to_json()
            fh.write(json.dumps(record, separators=(",", ":")) + "\n")
            d = record["descriptors"]
            written += 1
            storeys[d["storeys"]] += 1
            kinds.update(d["rooms_by_kind"])
            if "width_m" in d:
                widths.append(d["width_m"])
            areas.append(d["floor_area_m2"])
            windows.append(d["windows"])
    def pct(values):
        return [round(float(v), 1) for v in np.percentile(values, [5, 50, 95])] if values else None
    summary = {"dataset": dataset.key, "title": dataset.title, "license": dataset.license_id,
               "commercial_use": dataset.commercial_use, "url": dataset.url,
               "templates": written, "storeys": dict(sorted(storeys.items())),
               "rooms_by_kind": dict(kinds.most_common()),
               "width_m_p5_p50_p95": pct(widths), "floor_area_m2_p5_p50_p95": pct(areas),
               "windows_p5_p50_p95": pct(windows), "seconds": round(time.time() - started)}
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("datasets", nargs="*")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    catalogue = []
    for dataset in DATASETS:
        entry = {"key": dataset.key, "title": dataset.title, "license": dataset.license_id,
                 "commercial_use": dataset.commercial_use, "access": dataset.access,
                 "size_bytes": dataset.size_bytes, "url": dataset.url, "notes": dataset.notes}
        wanted = not args.datasets or dataset.key in args.datasets
        if dataset.adapter and dataset.access == "download" and wanted:
            summary = ingest(dataset, args.limit)
            entry["status"] = f"ingested: {summary['templates']} templates"
            print(json.dumps({k: summary[k] for k in ("dataset", "templates", "storeys",
                                                      "seconds")}), flush=True)
        elif dataset.adapter is None:
            entry["status"] = ("not ingested: needs an agreement" if dataset.access != "download"
                               else "not ingested: no adapter (see notes)")
        catalogue.append(entry)
    BASE.mkdir(parents=True, exist_ok=True)
    if not args.limit:
        (BASE / "catalogue.json").write_text(json.dumps(catalogue, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
