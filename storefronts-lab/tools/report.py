"""Summarize a run into a committed markdown report (numbers only; no imagery, no bulk data).

    ../.venv/bin/python tools/report.py marina-union chestnut > reports/<date>-<area>-<corridor>.md
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kerbfront.config import OUT  # noqa: E402


def pct(a: int, b: int) -> str:
    return f"{a} ({100 * a / b:.0f}%)" if b else "0"


def main(area: str, corridor: str) -> None:
    out = OUT / area
    sw = json.loads((out / "sweep_summary.json").read_text())
    ph = json.loads((out / f"photos_{corridor}.json").read_text())
    px_path = out / f"pixels_{corridor}.json"
    px = json.loads(px_path.read_text()) if px_path.exists() else None
    biz = {z["id"]: z for z in json.loads((out / "businesses.json").read_text())}
    s = ph["summary"]
    R = ph["results"]
    p = print
    p(f"# Storefront lab run: {area}, corridor `{corridor}`\n")
    p(f"Sweep built {sw['built']}. Frames: {s['frames']:,} Mapillary images "
      f"({s['frame_source'].get('dataset')}, {s['frame_source'].get('tiles', '?')} tiles of "
      f"{s['frame_source'].get('tile_deg', '?')}°, retrieved {s['frame_source'].get('retrieved_at')}).\n")
    p("## Sweep (whole area)\n")
    p("| | count |\n|---|---|")
    for k, v in sw["observations"].items():
        p(f"| {k} rows | {v:,} |")
    for k in ("businesses", "storefronts", "storefronts_with_face", "storefronts_multi_source",
              "buildings", "faces", "street_faces"):
        p(f"| {k.replace('_', ' ')} | {sw[k]:,} |")
    p(f"| storefronts by corridor | {', '.join(f'{k} {v}' for k, v in sorted(sw['storefronts_by_corridor'].items(), key=lambda t: -t[1]))} |")
    p(f"| outdoor seating on record | {', '.join(f'{k} {v}' for k, v in sw['outdoor_seating'].items())} |\n")
    conf = [z["fields"]["name"]["confidence"] for z in biz.values()
            if z["storefront_likelihood"] >= 0.5 and z["fields"].get("name")]
    if conf:
        p(f"Storefront name confidence: median {statistics.median(conf):.2f}, "
          f"{pct(sum(c >= 0.8 for c in conf), len(conf))} at or above 0.8.\n")
    occ = Counter((z.get("occupancy") or {}).get("role") for z in biz.values() if z.get("occupancy"))
    if occ:
        p(f"Address contests: {', '.join(f'{k} {v}' for k, v in occ.items())}.\n")
    p(f"## Stage 1: geometric frame filter ({s['businesses']} storefronts)\n")
    total = sum(s["reject_reasons"].values())
    p(f"{total:,} frame-and-storefront pairs within range were assessed.\n")
    p("| outcome | pairs |\n|---|---|")
    for k, v in sorted(s["reject_reasons"].items(), key=lambda t: -t[1]):
        p(f"| {k} | {pct(v, total)} |")
    p("")
    slots = Counter(pk["slot"] for r in R for pk in r["picks"])
    p(f"* storefronts with at least one usable frame: {pct(s['with_picks'], s['businesses'])}")
    p(f"* with a `sign` slot (current tenant, sign-grade resolution): {pct(s['with_sign_shot'], s['businesses'])}")
    p(f"* slots filled: {', '.join(f'{k} {v}' for k, v in slots.most_common())}")
    flags = Counter(f for r in R for pk in r["picks"] for f in pk["flags"])
    p(f"* flags on picked frames: {', '.join(f'{k} {v}' for k, v in flags.most_common(8))}")
    ages = [pk["metrics"]["age_years"] for r in R for pk in r["picks"] if pk["slot"] == "sign"]
    if ages:
        p(f"* sign-slot frame age: median {statistics.median(ages):.1f} years")
    none = [r for r in R if not r["picks"]]
    if none:
        why = Counter()
        for r in none:
            why[max(r["rejects"], key=r["rejects"].get) if r["rejects"] else "no frames within 45 m"] += 1
        p(f"* no usable frame ({len(none)}), dominant reason: "
          f"{', '.join(f'{k} {v}' for k, v in why.most_common())}")
    p("")
    if px:
        ps = px["summary"]
        p(f"## Stage 2: pixel checks ({ps['businesses']} storefronts, top picks + one near-miss each)\n")
        tot = sum(ps["pixel_verdicts"].values())
        p("| verdict | frames |\n|---|---|")
        for k, v in sorted(ps["pixel_verdicts"].items(), key=lambda t: -t[1]):
            p(f"| {k} | {pct(v, tot)} |")
        rows = [x for r in px["results"] for x in r["pixels"] if "metrics" in x]
        kept = [x for x in rows if not x["rejects"] and x.get("geometry_ok")]
        if kept:
            med = lambda k: statistics.median(x["metrics"].get(k, 0) or 0 for x in kept)  # noqa: E731
            p(f"\nKept frames, medians: building share {med('building_share'):.2f}, storefront "
              f"occlusion {med('occluded_storefront'):.2f}, sign cover {med('sign_cover'):.3f}, "
              f"Laplacian variance {med('laplacian_var'):.0f}, exposure {med('exposure'):.2f}.")
        p("\nExamples (business: final shot list):\n")
        for r in px["results"][:12]:
            fin = ", ".join(f"{f['slot']} {f['frame_id']}" for f in r.get("final", []))
            p(f"* {r['name']} ({r['address']['number']} {r['address']['street']}): {fin}")
    p("\nImagery: Mapillary, CC BY-SA 4.0. Frame ids open at https://www.mapillary.com/app/?pKey=<id>.")


if __name__ == "__main__":
    main(*sys.argv[1:3])
