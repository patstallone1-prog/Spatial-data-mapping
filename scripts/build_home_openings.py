#!/usr/bin/env python3
"""Publish accepted image-backed window rectangles for the shared house shell."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.reconstruction.geo import EnuFrame  # noqa: E402


def compile_openings(rows: list[dict], ways: dict[str, dict]) -> dict:
    latest = {row["id"]: row for row in rows}
    buildings = {}
    for row in latest.values():
        obj = row.get("object")
        key = row["id"].split(":")[-1]
        way = ways.get(key)
        if row["status"] != "accepted" or not obj or not way:
            continue
        frame = EnuFrame(*obj["anchor"])
        points = way["points"]
        if points[0] == points[-1]:
            points = points[:-1]
        ring = [tuple(frame.to_enu(*p, 0.0)[:2]) for p in points]
        walls = {}
        for facade in obj["geometry"].get("facades", []):
            a, b = facade["start"], facade["end"]
            matches = []
            for edge, start in enumerate(ring):
                end = ring[(edge + 1) % len(ring)]
                matches.extend([(max(math.dist(a, start), math.dist(b, end)), edge, False),
                                (max(math.dist(b, start), math.dist(a, end)), edge, True)])
            error, edge, reverse = min(matches)
            if error > 0.05:
                continue
            length = math.dist(ring[edge], ring[(edge + 1) % len(ring)])
            windows = []
            for element in facade["elements"]:
                if element["kind"] != "window":
                    continue
                u, v, w, h = (element[k] for k in ("u", "v", "w", "h"))
                if reverse:
                    u = length - u - w
                if u < 0.1 or u + w > length - 0.1 or v < 0 or v + h > way["height_m"]:
                    continue
                windows.append([round(n, 3) for n in (u, v, w, h, element["confidence"])])
            if windows:
                walls[str(edge)] = windows
        if walls:
            buildings[key] = {"walls": walls, "source_hash": row["source_hash"],
                              "object_id": obj["id"], "grade": "image_on_prior_geometry"}
    return {"schema": "kerbside.home_openings/1", "buildings": buildings,
            "source": "data/regions/sf-corridor/world/photo_objects.journal.jsonl",
            "note": "Image-backed openings on prior footprints/heights; not measured collision."}


def build() -> dict:
    journal = ROOT / "data/regions/sf-corridor/world/photo_objects.journal.jsonl"
    ways = {str(w["osm_id"]): w for w in json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())["ways"]
            if w.get("kind") == "building"}
    result = compile_openings([json.loads(line) for line in journal.read_text().splitlines()], ways)
    (ROOT / "docs/sf-corridor-home-openings.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
    return result


if __name__ == "__main__":
    print(f"{len(build()['buildings'])} buildings with accepted window evidence")
