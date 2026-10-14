#!/usr/bin/env python3
"""Cut the published house fits into small immutable tiles the page loads by area.

The fits went out as one file -- ``sf-corridor-frontage-fits.json``, 67 MB for 1,952 houses --
and every page of every region fetched all of it, uncached, before it drew a building. Most of it
was the reasoning behind each fit (detector proposals, opening decisions, neighbour comparisons),
which the page never reads. Here each fit is cut to what the page draws (``PAGE_FIELDS``) and the
houses are filed by region and a ~1 km grid cell into tiles:

  fits/<region>/<i>_<j>-<sha12>.json     immutable: the name is the content's hash, so a tile
                                         never changes once published and caches for a year
  sf-corridor-frontage-fits.manifest.json   small, always revalidated: the tiles, their areas and
                                         where they are (``base``: the object store, or the site)

The page reads the manifest and fetches only the tiles that overlap its own area. Tiles no longer
listed are removed from the site's copy; the object store keeps every version (publish_chunks.py).

    .venv/bin/python tools/tile_frontage_fits.py --fits <published fits json> [--base URL]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
MANIFEST = "sf-corridor-frontage-fits.manifest.json"
TILE_DEG = 0.01
#: What the page reads of a fit (scripts/build_sf_corridor_3d.py: frontageFitFor and its users).
PAGE_FIELDS = (
    "building_id", "region", "address", "a", "b", "front_normal_enu", "width_m", "height_m",
    "canonical_footprint", "canonical_geometry_modified", "conflicts", "review_status",
    "openings", "appearance", "entries", "primary_entry", "ground_reference", "outcrops",
    "details", "certainty", "inch_accuracy_verified", "image_sha256", "attribution", "license_id",
    "source_locator", "implementation_sha256",
)
OPENING_FIELDS = (
    "id", "kind", "role", "role_certainty", "u", "v", "w", "h", "design", "grade", "confidence",
    "render_allowed", "absorbed_into_entry", "recess", "size_inferred",
)
#: Detector boxes the page may draw as balconies (scripts/build_sf_corridor_3d.py: balconyProposal).
BALCONY_KINDS = ("balcony", "fire escape", "fire_escape")
DESIGN_DROP = ("panel_lines", "observed_glass_or_contents_colour", "glass_rendering", "grade", "colour_basis")


def slim(fit: dict) -> dict:
    out = {k: fit[k] for k in PAGE_FIELDS if k in fit}
    openings = []
    for o in fit.get("openings") or []:
        lean = {k: o[k] for k in OPENING_FIELDS if k in o}
        design = dict(o.get("design") or {})
        lines = design.get("panel_lines") or {}
        for key in DESIGN_DROP:
            design.pop(key, None)
        if lines.get("horizontal") or lines.get("vertical"):
            design["panel_lines"] = {"horizontal": lines.get("horizontal") or [],
                                     "vertical": lines.get("vertical") or []}
        lean["design"] = design
        openings.append(lean)
    out["openings"] = openings
    # Only the details the page draws: the reviewed ones whole, and the detector's balconies (and
    # short fire escapes) as boxes, which the page draws out from the wall at their window's foot
    # (inferredBalconies). Of the certainty, what it shows.
    out["details"] = [d if d.get("render") else {"kind": d["kind"], **{k: round(d[k], 3) for k in "uvwh"}}
                      for d in fit.get("details") or []
                      if d.get("render") or (d.get("kind") in BALCONY_KINDS
                                             and all(isinstance(d.get(k), (int, float)) for k in "uvwh"))]
    certainty = fit.get("certainty") or {}
    out["certainty"] = {k: certainty[k] for k in ("tier", "ai_review_required") if k in certainty}
    return out


def cell_of(fit: dict) -> tuple[int, int] | None:
    a = fit.get("a")
    if not (isinstance(a, list) and len(a) == 2 and all(isinstance(v, (int, float)) for v in a)):
        return None
    return math.floor(a[0] / TILE_DEG), math.floor(a[1] / TILE_DEG)


def tile(fits: dict, base: str = "") -> dict:
    groups: dict[tuple[str, int, int], dict] = defaultdict(dict)
    for key, fit in fits.items():
        cell = cell_of(fit)
        if cell is None:
            continue
        groups[(fit.get("region") or "unknown", *cell)][key] = slim(fit)
    tiles, written = [], set()
    for (region, i, j), buildings in sorted(groups.items()):
        lons = [p[0] for f in buildings.values() for p in (f.get("canonical_footprint") or [f["a"], f["b"]])]
        lats = [p[1] for f in buildings.values() for p in (f.get("canonical_footprint") or [f["a"], f["b"]])]
        body = json.dumps({"schema": "kerbside.facade_fits/1", "buildings": buildings},
                          separators=(",", ":"), sort_keys=True).encode()
        sha = hashlib.sha256(body).hexdigest()
        path = f"fits/{region}/{i}_{j}-{sha[:12]}.json"
        target = DOCS / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(body)
        written.add(target)
        tiles.append({"region": region, "cell": [i, j], "bbox": [min(lons), min(lats), max(lons), max(lats)],
                      "count": len(buildings), "path": path, "sha256": sha, "bytes": len(body)})
    for old in (DOCS / "fits").glob("*/*.json"):
        if old not in written:
            old.unlink()
    version = hashlib.sha256("".join(t["sha256"] for t in tiles).encode()).hexdigest()[:16]
    manifest = {"schema": "kerbside.facade_fit_tiles/1", "version": version, "base": base,
                "tile_degrees": TILE_DEG, "houses": sum(t["count"] for t in tiles), "tiles": tiles}
    (DOCS / MANIFEST).write_text(json.dumps(manifest, indent=1))
    return manifest


def contributed_fits(folder: Path) -> dict:
    """The accepted fits made from contributed photographs, by building: a photograph someone took
    of the house on purpose is preferred to the run's for the same house."""
    out = {}
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        fit = json.loads(path.read_text())
        if isinstance(fit, dict) and fit.get("building_id") and (fit.get("auto_review") or {}).get("accept"):
            out[str(fit["building_id"])] = fit
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fits", type=Path, required=True, help="the published fits (the matcher's output)")
    ap.add_argument("--base", default="", help="where the tiles are served from (empty: the site)")
    ap.add_argument("--contributed", type=Path, default=ROOT / "data" / "contributed_houses",
                    help="fits from contributed photographs (scripts/fit_contributed_photos.py), published with the run's")
    args = ap.parse_args()
    fits = json.loads(args.fits.read_text())["buildings"]
    fits.update(contributed_fits(args.contributed))
    manifest = tile(fits, args.base)
    total = sum(t["bytes"] for t in manifest["tiles"])
    print(f"{manifest['houses']} houses in {len(manifest['tiles'])} tiles, {total / 1e6:.1f} MB "
          f"(largest {max(t['bytes'] for t in manifest['tiles']) / 1e6:.2f} MB), version {manifest['version']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
