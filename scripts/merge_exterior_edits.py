#!/usr/bin/env python3
"""Publish exterior edits people sent in, so everyone's page draws them.

An edit is what the exterior editor (docs/exterior-editor.mjs) exports: one building's front --
its windows, doors, garages, stairs and indents -- on one wall, named by that wall's two corners.
Each file given is checked before it is taken: its building must be on the page, the wall it
names must still be one of that building's walls (a footprint changed since drops the edit
rather than drawing it on the wrong wall), and every opening must be a size a real one is and
stand on the wall. What is published (docs/sf-corridor-exterior-edits.json) keeps only the edit
itself: no page path, no address, no time it was exported.

    python scripts/merge_exterior_edits.py edits/exterior-edit-263276308.json ...
    python scripts/merge_exterior_edits.py --remove 263276308
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORLD = ROOT / "docs" / "sf-corridor-3d.json"
PUBLISHED = ROOT / "docs" / "sf-corridor-exterior-edits.json"
SCHEMA = "kerbside.exterior_edit/1"
TYPES = {"window", "door", "garage", "shopfront"}
#: What an opening may carry, by key; anything else in an export is dropped.
OPENING_KEYS = {"id", "type", "u", "v", "w", "h", "shape", "panes", "glass", "frame", "style", "colour",
                "recess_m", "stairs", "door_at", "pair"}
EDIT_KEYS = {"schema", "osm_id", "wall", "length_m", "height_m", "wall_colour", "openings", "created", "updated"}


def _metres(a: list[float], b: list[float]) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * 111_320 * math.cos(lat), (b[1] - a[1]) * 110_950)


def check(edit: dict, buildings: dict[str, dict]) -> list[str]:
    """Why ``edit`` cannot be published, or nothing."""
    if edit.get("schema") != SCHEMA:
        return [f"not an exterior edit (schema {edit.get('schema')!r})"]
    way = buildings.get(str(edit.get("osm_id")))
    if way is None:
        return [f"building {edit.get('osm_id')} is not on the page"]
    wall = edit.get("wall") or {}
    a, b = wall.get("a"), wall.get("b")
    ring = [list(p) for p in way["points"]]
    edges = {(tuple(p), tuple(q)) for p, q in zip(ring, ring[1:] + ring[:1], strict=True)}
    if not (a and b and ((tuple(a), tuple(b)) in edges or (tuple(b), tuple(a)) in edges)):
        return ["the wall it names is not one of the building's walls now"]
    length = _metres(a, b)
    problems = []
    openings = edit.get("openings")
    if not isinstance(openings, list) or len(openings) > 200:
        return ["openings missing or too many"]
    for o in openings:
        name = f"{o.get('type')} {o.get('id', '?')}"
        if o.get("type") not in TYPES:
            problems.append(f"{name}: unknown kind")
            continue
        u, v, w, h = (o.get(k) for k in ("u", "v", "w", "h"))
        if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (u, v, w, h)):
            problems.append(f"{name}: size or place is not a number")
        elif not (0.15 <= w <= 30 and 0.15 <= h <= 25 and v >= 0 and u > -0.5 and u + w < length + 0.5):
            problems.append(f"{name}: {w:.2f} x {h:.2f} m at {u:.2f}, {v:.2f} is not on a {length:.1f} m wall")
        stairs = o.get("stairs") or {}
        if stairs and not (0 <= stairs.get("steps", 0) <= 20):
            problems.append(f"{name}: {stairs.get('steps')} steps")
    return problems


def clean(edit: dict) -> dict:
    out = {k: v for k, v in edit.items() if k in EDIT_KEYS}
    out["osm_id"] = str(out["osm_id"])
    out["openings"] = [{k: v for k, v in o.items() if k in OPENING_KEYS} for o in edit["openings"]]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--remove", nargs="*", default=[], help="building ids whose published edit to take down")
    args = ap.parse_args(argv)
    world = json.loads(WORLD.read_text())
    buildings = {str(w["osm_id"]): w for w in world["ways"] if w.get("kind") == "building"}
    published = json.loads(PUBLISHED.read_text()) if PUBLISHED.exists() else {}
    edits = dict(published.get("edits") or {})
    refused = 0
    for path in args.files:
        edit = json.loads(path.read_text())
        problems = check(edit, buildings)
        if problems:
            refused += 1
            print(f"{path.name}: not published -- " + "; ".join(problems), file=sys.stderr)
            continue
        edits[str(edit["osm_id"])] = clean(edit)
        print(f"{path.name}: published for building {edit['osm_id']} ({len(edit['openings'])} openings)")
    for gone in args.remove:
        if edits.pop(str(gone), None) is not None:
            print(f"took down the edit of building {gone}")
    PUBLISHED.write_text(json.dumps({"schema": "kerbside.exterior_edits/1",
                                     "note": published.get("note", "Fronts people corrected with the exterior editor."),
                                     "edits": dict(sorted(edits.items()))}, indent=1) + "\n")
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
