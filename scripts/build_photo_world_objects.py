#!/usr/bin/env python3
"""Journal photo-observed SF facades as conservative, renderer-neutral world objects.

The footprint and height remain the existing map's priors. Only wall openings that
survive the multi-view survey gates become image-derived geometry. This output is
research evidence, not a replacement for canonical collision or a published mesh.
Each attempted building is appended to an fsynced JSONL journal before the next one
is processed, so an interrupted corridor run resumes without losing accepted work.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.geometry.building import Facade, FacadeElement, ParametricBuilding  # noqa: E402
from smc.reconstruction.geo import EnuFrame  # noqa: E402
from smc.world.object import (  # noqa: E402
    Evidence,
    EvidenceRef,
    GeometryBasis,
    WorldObject,
)

SURVEY = ROOT / "data/sf_public_works/facade_survey.json"
MODEL = ROOT / "docs/sf-corridor-3d.json"
OUT = ROOT / "data/regions/sf-corridor/world"
MIN_VIEWS = 3
MIN_AGREEMENT = 0.75
MIN_COVERAGE = 0.70
MAX_ENDPOINT_ERROR_M = 0.35


def _digest(way: dict, surveyed: dict) -> str:
    payload = json.dumps([way, surveyed], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _match_edge(
    a: tuple[float, float], b: tuple[float, float], ring: tuple[tuple[float, float], ...]
) -> tuple[int, bool, float]:
    candidates = []
    for index, start in enumerate(ring):
        end = ring[(index + 1) % len(ring)]
        forward = max(math.dist(a, start), math.dist(b, end))
        reverse = max(math.dist(a, end), math.dist(b, start))
        candidates.extend(((forward, index, False), (reverse, index, True)))
    error, index, reversed_wall = min(candidates)
    return index, reversed_wall, error


def _object(way: dict, surveyed: dict) -> tuple[WorldObject | None, Counter[str]]:
    reasons: Counter[str] = Counter()
    points = way.get("points") or []
    if len(points) < 3 or not (height := way.get("height_m")) or height <= 0:
        reasons["invalid_prior_geometry"] += 1
        return None, reasons
    anchor = (*way["centroid"], 0.0)
    frame = EnuFrame(*anchor)
    local = tuple(tuple(frame.to_enu(lon, lat, 0.0)[:2]) for lon, lat in points)
    try:
        prior = ParametricBuilding(local, 0.0, float(height))
    except ValueError:
        reasons["invalid_prior_geometry"] += 1
        return None, reasons

    facades: dict[int, Facade] = {}
    refs = [EvidenceRef("existing_geometry", "sf_corridor_osm",
                        f"way:{way['osm_id']}", "ODbL-1.0")]
    photo_frames: set[str] = set()
    quality: list[float] = []
    for wall in surveyed.get("walls", []):
        if (wall.get("views", 0) < MIN_VIEWS
                or wall.get("agreement", 0) < MIN_AGREEMENT
                or wall.get("coverage", 0) < MIN_COVERAGE):
            reasons["weak_multiview_wall"] += 1
            continue
        providers, licenses = wall.get("providers", []), wall.get("licenses", [])
        if len(providers) != 1 or len(licenses) != 1:
            reasons["ambiguous_photo_rights"] += 1
            continue
        a = tuple(frame.to_enu(*wall["a"], 0.0)[:2])
        b = tuple(frame.to_enu(*wall["b"], 0.0)[:2])
        edge, reversed_wall, error = _match_edge(a, b, prior.footprint)
        if error > MAX_ENDPOINT_ERROR_M or edge in facades:
            reasons["wall_prior_mismatch"] += 1
            continue
        length = math.dist(*prior.edge(edge))
        elements = []
        for entry in wall.get("openings", []):
            kind, u, v, width, opening_height, confidence = entry
            if kind not in {"window", "door", "storefront", "recess"}:
                reasons["unsupported_opening"] += 1
                continue
            if reversed_wall:
                u = length - float(u) - float(width)
            if (confidence < 0.65 or u < -0.05 or v < 0
                    or u + width > length + 0.05 or v + opening_height > height + 0.05):
                reasons["opening_outside_prior"] += 1
                continue
            elements.append(FacadeElement(kind, max(0.0, float(u)), float(v),
                                          float(width), float(opening_height), 0.0,
                                          grade="image", confidence=float(confidence),
                                          evidence=tuple(wall.get("frames", []))))
        if not elements:
            reasons["no_accepted_openings"] += 1
            continue
        start, end = prior.edge(edge)
        facades[edge] = Facade(edge, start, end, 0.0, float(height),
                               tuple(elements), grade="image")
        quality.append(min(float(wall["agreement"]), float(wall["coverage"])))
        for image_id in wall.get("frames", []):
            if image_id not in photo_frames:
                photo_frames.add(image_id)
                refs.append(EvidenceRef("image", providers[0], image_id, licenses[0]))
    if not facades:
        reasons["no_accepted_photo_wall"] += 1
        return None, reasons

    shape = ParametricBuilding(prior.footprint, 0.0, float(height),
                               facades=tuple(facades.values()))
    if problems := shape.validate():
        reasons["invalid_fitted_wall"] += len(problems)
        return None, reasons
    coverage = len(facades) / len(prior.footprint)
    evidence = Evidence(tuple(refs), grade="image", observation_count=len(photo_frames),
                        independent_sources=len({r.source_id for r in refs if r.observational}),
                        coverage=coverage)
    confidence = min(0.8, 0.35 + 0.3 * min(quality) + 0.15 * coverage)
    obj = WorldObject(f"sf:building:{way['osm_id']}", "building", shape,
                      GeometryBasis.INFERRED, confidence, evidence, anchor,
                      material="unknown", flags=("photo_openings_on_prior_footprint",
                                                 "not_canonical_collision"))
    return obj, reasons


def build(limit: int | None = None) -> dict:
    survey = json.loads(SURVEY.read_text())["buildings"]
    ways = {str(w["osm_id"]): w for w in json.loads(MODEL.read_text())["ways"]
            if w.get("kind") == "building" and w.get("osm_id") is not None}
    OUT.mkdir(parents=True, exist_ok=True)
    journal = OUT / "photo_objects.journal.jsonl"
    latest: dict[str, dict] = {}
    if journal.exists():
        for line in journal.read_text().splitlines():
            row = json.loads(line)
            latest[row["id"]] = row
    reasons: Counter[str] = Counter()
    processed = 0
    with journal.open("a") as stream:
        for osm_id, surveyed in sorted(survey.items(), key=lambda pair: int(pair[0])):
            if limit is not None and processed >= limit:
                break
            way = ways.get(osm_id)
            if way is None:
                reasons["missing_prior_building"] += 1
                continue
            object_id = f"sf:building:{osm_id}"
            source_hash = _digest(way, surveyed)
            if latest.get(object_id, {}).get("source_hash") == source_hash:
                continue
            obj, rejected = _object(way, surveyed)
            reasons.update(rejected)
            row = {"id": object_id, "source_hash": source_hash,
                   "status": "accepted" if obj else "rejected",
                   "object": obj.to_json() if obj else None, "reasons": dict(rejected)}
            stream.write(json.dumps(row, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
            latest[object_id] = row
            processed += 1
            if processed % 100 == 0:
                accepted = sum(r["status"] == "accepted" for r in latest.values())
                print(f"journaled {processed} buildings, {accepted} accepted", flush=True)
    summary = {"surveyed_buildings": len(survey), "attempted_this_run": processed,
               "journaled_buildings": len(latest),
               "accepted_buildings": sum(r["status"] == "accepted" for r in latest.values()),
               "reasons_this_run": dict(reasons),
               "journal": str(journal.relative_to(ROOT) if journal.is_relative_to(ROOT)
                              else journal)}
    (OUT / "photo_objects.summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    print(json.dumps(build(args.limit), indent=2))


if __name__ == "__main__":
    main()
