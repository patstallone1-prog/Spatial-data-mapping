#!/usr/bin/env python3
"""Test the crosswalk paint reader against the crossings whose markings are already recorded.

    python scripts/test_paint_crosswalks.py [--region sf-corridor]

Truth, two independent records:

* OpenStreetMap's crossing tags on the corridor's crossings (docs/sf-corridor-3d.json):
  ``crossing:markings`` zebra / ladder (continental bars), lines (two edge lines), no (none);
* SFMTA's continental crosswalk inventory (docs/app-inventory-crossings.json): continental.

The reader (smc.imagery.crosswalks.crossing_paint) runs on NOAA's 0.25 m photograph of each.
Its thresholds are chosen on half the crossings (an even hash) for precision -- the target is
99% for both ``paint`` and ``no_paint``, recall be what it may -- and measured on the other half.
Nothing the page draws is changed: lanes and crossings stay as inferred.

Writes build/tests/paint-crosswalks.json and prints the tables.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
DATA = Path(os.environ.get("KERBSIDE_DATA_ROOT", ROOT))

import smc.imagery.ortho as ortho  # noqa: E402
from smc.imagery.crosswalks import crossing_paint  # noqa: E402

ortho.OUT = DATA / "data" / "ortho"

OSM_TRUTH = {"zebra": ("paint", "continental"), "ladder": ("paint", "continental"), "lines": ("paint", "lines"),
             "no": ("no_paint", None)}


def cases() -> list[dict]:
    out = []
    payload = json.loads((ROOT / "docs" / "sf-corridor-3d.json").read_text())
    for w in payload["ways"]:
        if w.get("kind") != "crossing" or len(w.get("points") or []) < 2:
            continue
        if w.get("marking_provenance") != "osm_crossing_tags" or w.get("crossing_markings") not in OSM_TRUTH:
            continue
        truth, style = OSM_TRUTH[w["crossing_markings"]]
        out.append({"id": f"osm:{w.get('osm_id')}", "points": w["points"], "truth": truth, "style": style, "record": "osm"})
    inv = json.loads((ROOT / "docs" / "app-inventory-crossings.json").read_text())
    for i, c in enumerate(inv["crossings"]):
        out.append({"id": f"sfmta:{i}", "points": c["points"], "truth": "paint", "style": "continental", "record": "sfmta"})
    return out


def half(case_id: str) -> str:
    return "tune" if hashlib.sha1(case_id.encode()).digest()[0] % 2 == 0 else "test"


def decide(s: dict, p: dict) -> str:
    """The answer from stored scores under thresholds ``p`` (as crossing_paint decides)."""
    if s.get("gate"):
        return "unknown"
    if s["period_share"] >= p["share"] and s["half_agreement"] >= p["agree"] and s["contrast"] >= p["contrast"] \
            and s.get("bright", 0) >= 150:
        return "paint"
    if s["edge_ridge"] >= p["ridge"] and s["contrast"] < p["contrast"]:
        return "paint"
    if s["contrast"] <= p["clean"] and s["edge_ridge"] < 0.2 and s["shadow"] < 0.05 and s["period_share"] < 0.2:
        return "no_paint"
    return "unknown"


def table(rows: list[dict], p: dict) -> dict:
    t = Counter((decide(r["scores"], p), r["truth"]) for r in rows)
    out = {}
    for a in ("paint", "no_paint"):
        said = sum(n for (x, _), n in t.items() if x == a)
        right = t.get((a, a), 0)
        truth_n = sum(n for (_, y), n in t.items() if y == a)
        out[a] = {"said": said, "right": right, "precision": round(right / said, 4) if said else None,
                  "recall": round(right / truth_n, 4) if truth_n else None}
    out["unknown"] = sum(n for (x, _), n in t.items() if x == "unknown")
    out["cases"] = len(rows)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--region", default="sf-corridor")
    args = parser.parse_args()
    O = ortho.Ortho(args.region)
    rows = []
    started = time.time()
    all_cases = cases()
    for n, c in enumerate(all_cases):
        (ax, bx), (ay, by) = (lambda x, y: ((x[0], x[-1]), (y[0], y[-1])))(*ortho.to_utm([c["points"][0][0], c["points"][-1][0]],
                                                                                         [c["points"][0][1], c["points"][-1][1]]))
        pad = 4.0
        bounds = (min(ax, bx) - pad, min(ay, by) - pad, max(ax, bx) + pad, max(ay, by) + pad)
        img = O.read(bounds, pixel_m=0.125)
        r = crossing_paint(img, (float(ax), float(ay)), (float(bx), float(by)))
        scores = {k: v for k, v in r.items() if k not in ("answer", "why", "style")}
        if r["answer"] == "unknown" and r.get("why") in ("photograph too coarse", "crossing too short", "outside the photograph",
                                                         "under canopy", "in shadow", "glare", "not road surface"):
            scores["gate"] = r["why"]
        rows.append({**c, "answer": r["answer"], "why": r.get("why"), "scores": scores, "half": half(c["id"]),
                     "gsd_m": img.get("gsd_m") if img else None})
        if n % 250 == 0:
            print(f"  {n}/{len(all_cases)} {time.time() - started:.0f} s", flush=True)
    gates = Counter(r["scores"].get("gate") for r in rows)
    tune = [r for r in rows if r["half"] == "tune" and not r["scores"].get("gate")]
    test = [r for r in rows if r["half"] == "test" and not r["scores"].get("gate")]
    # Thresholds: the most answers at >= 99% precision for each answer on the tuning half.
    best = None
    for share, agree, contrast, ridge, clean in itertools.product(
            (0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7), (0.3, 0.5, 0.7), (30, 40, 55, 70, 90),
            (0.6, 0.7, 0.8, 0.9, 1.01), (-1, 10, 15, 20, 25, 30)):
        p = {"share": share, "agree": agree, "contrast": contrast, "ridge": ridge, "clean": clean}
        t = table(tune, p)
        ok = all((t[a]["precision"] or 0) >= 0.99 or t[a]["said"] == 0 for a in ("paint", "no_paint"))
        answered = t["paint"]["said"] + t["no_paint"]["said"]
        if ok and (best is None or answered > best[0]):
            best = (answered, p, t)
    default = {"share": 0.35, "agree": 0.5, "contrast": 40, "ridge": 0.7, "clean": 25}
    report = {
        "cases": len(rows), "by_record": dict(Counter(r["record"] for r in rows)),
        "truth": dict(Counter(f"{r['record']}:{r['truth']}:{r['style']}" for r in rows)),
        "gated_unknown": {k or "answered": v for k, v in gates.items()},
        "gsd": dict(Counter(str(r["gsd_m"]) for r in rows)),
        "defaults": {"params": default, "tune": table(tune, default), "test": table(test, default)},
        "tuned_for_99": None if best is None else {"params": best[1], "tune": best[2], "test": table(test, best[1]),
                                                   "test_osm": table([r for r in test if r["record"] == "osm"], best[1]),
                                                   "test_sfmta": table([r for r in test if r["record"] == "sfmta"], best[1])},
    }
    out = ROOT / "build" / "tests"
    out.mkdir(parents=True, exist_ok=True)
    (out / "paint-crosswalks.json").write_text(json.dumps({**report, "rows": rows}))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
